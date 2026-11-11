import { ForbiddenException, Injectable } from '@nestjs/common';
import { AuditEntity, DeviceStatus, Prisma } from '@prisma/client';
import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { LicenseCryptoService } from '../common/crypto/license-crypto.service';
import { SecurityService } from '../common/crypto/security.service';
import { normalizeLicenseKey } from './license-key.util';
import { pmsLeaseWindow } from './pms-license-policy';

type Installation = { license_id: number; installation_id: string; server_fingerprint: string };
export interface PmsWorkstationRequest { licenseKey: string; serverInstanceId: string; deviceFingerprint: string; devicePublicKey: string; deviceName?: string; appVersion?: string; }
@Injectable()
export class PmsInstallationsService {
  constructor(private readonly db: PrismaService, private readonly crypto: LicenseCryptoService, private readonly security: SecurityService) {}
  private async license(tx: Prisma.TransactionClient, key: string) {
    const normalized = normalizeLicenseKey(key);
    await tx.$queryRaw`SELECT id FROM licenses WHERE license_key=${normalized} FOR UPDATE`;
    const row = await tx.license.findUnique({ where: { licenseKey: normalized }, include: { customer: true, plan: { include: { features: { include: { feature: true } } } } } });
    if (!row || row.customer.status !== 'ACTIVE' || row.customer.deletedAt || ['REVOKED','SUSPENDED'].includes(row.status)
      || row.startsAt.getTime() > Date.now() || pmsLeaseWindow(row.expiresAt).expired || row.status === 'EXPIRED' && !row.expiresAt)
      throw new ForbiddenException('Company license is unavailable, revoked or outside its 14-day grace.');
    return row;
  }
  private plan(row: Awaited<ReturnType<PmsInstallationsService['license']>>) {
    return { schemaVersion: 1, enforced: row.plan.enforceEntitlements, planKey: row.plan.key, planName: row.plan.nameAr ?? row.plan.name,
      features: row.plan.features.map(p=>p.feature.key).sort(), maxUsers: row.plan.maxUsers, maxBranches: row.plan.maxBranches, maxWarehouses: row.plan.maxWarehouses };
  }
  async register(licenseKey: string, fingerprint: string, replaceApproved: boolean, reason: string, actor: {id:number;email:string}) {
    return this.db.$transaction(async tx => {
      const row = await this.license(tx, licenseKey); const hash = this.security.hashFingerprint([fingerprint]);
      const previous = (await tx.$queryRaw<Installation[]>`SELECT * FROM pms_installations WHERE license_id=${row.id}`)[0];
      if (previous && previous.server_fingerprint !== hash && (!replaceApproved || reason.trim().length < 10))
        throw new ForbiddenException('Server replacement requires explicit administrator approval and a reason.');
      const replacing = previous && previous.server_fingerprint !== hash;
      const id = replacing || !previous ? randomUUID() : previous.installation_id;
      // A new installation identity invalidates all old workstation grants; it never consumes a device seat.
      await tx.$executeRaw`INSERT INTO pms_installations(license_id,installation_id,server_fingerprint) VALUES(${row.id},${id}::uuid,${hash}) ON CONFLICT(license_id) DO UPDATE SET installation_id=EXCLUDED.installation_id,server_fingerprint=EXCLUDED.server_fingerprint`;
      if (replacing) { await tx.device.updateMany({where:{licenseId:row.id},data:{status:DeviceStatus.REVOKED,revokedAt:new Date()}}); await tx.license.update({where:{id:row.id},data:{version:{increment:1}}}); }
      await tx.auditLog.create({data:{adminId:actor.id,adminEmail:actor.email,action:replacing?'pms.server.replace':'pms.server.enroll',entity:AuditEntity.LICENSE,entityId:String(row.id),metadata:{installationId:id,reason:reason.trim()}}});
      return { installationId:id, serverOnlyConsumesSeat:false, replacement:!!replacing };
    });
  }
  async serverGrant(licenseKey: string, fingerprint: string) {
    return this.db.$transaction(async tx => {
      const row = await this.license(tx, licenseKey);
      const binding=(await tx.$queryRaw<Installation[]>`SELECT * FROM pms_installations WHERE license_id=${row.id}`)[0];
      if(!binding || binding.server_fingerprint!==this.security.hashFingerprint([fingerprint])) throw new ForbiddenException('Server is not enrolled.');
      const now=Date.now(),window=pmsLeaseWindow(row.expiresAt,now);
      return this.crypto.signDocument({purpose:'pms-company-server-v1',licenseKey:row.licenseKey,installationId:binding.installation_id,serverFingerprint:fingerprint,
        validatedAt:new Date(now).toISOString(),nextCheckAt:new Date(window.nextCheckAt).toISOString(),offlineUntil:new Date(window.offlineUntil).toISOString(),
        subscriptionExpiresAt:row.expiresAt?.toISOString()??null,version:row.version,maxDevices:row.maxDevices,entitlements:this.plan(row)});
    });
  }
  async reset(licenseKey:string,deviceId:number,reason:string,actor:{id:number;email:string}){
    return this.db.$transaction(async tx=>{
      const row=await this.license(tx,licenseKey);
      const device=await tx.device.findFirst({where:{id:deviceId,licenseId:row.id}});
      if(!device)throw new ForbiddenException('Unknown workstation.');
      if(device.status!==DeviceStatus.ACTIVE && await tx.device.count({where:{licenseId:row.id,status:DeviceStatus.ACTIVE}})>=row.maxDevices)throw new ForbiddenException('Workstation limit reached.');
      await tx.$executeRaw`DELETE FROM pms_device_keys WHERE device_id=${deviceId}`;
      await tx.device.update({where:{id:deviceId},data:{status:DeviceStatus.ACTIVE,revokedAt:null,blockedAt:null,blockedReason:null}});
      await tx.license.update({where:{id:row.id},data:{version:{increment:1}}});
      await tx.auditLog.create({data:{adminId:actor.id,adminEmail:actor.email,action:'pms.workstation.reset',entity:AuditEntity.LICENSE,entityId:String(row.id),metadata:{deviceId,reason}}});
      return {reenrollmentRequired:true};
    });
  }
  async validate(input: PmsWorkstationRequest) {
    try {
      return await this.db.$transaction(async tx => {
        const row=await this.license(tx,input.licenseKey);
        const binding=(await tx.$queryRaw<Installation[]>`SELECT * FROM pms_installations WHERE license_id=${row.id}`)[0];
        if(!binding || binding.installation_id!==input.serverInstanceId) throw new ForbiddenException('Wrong or replaced company server.');
        if(input.devicePublicKey.includes('PRIVATE KEY'))throw new ForbiddenException('A public device key is required.');
        const key=createPublicKey(input.devicePublicKey);
        if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength??0)<2048)throw new ForbiddenException('RSA device key must be at least 2048 bits.');
        const hash=createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
        const fingerprint=this.security.hashFingerprint([input.deviceFingerprint]);
        let device=await tx.device.findUnique({where:{licenseId_deviceFingerprint:{licenseId:row.id,deviceFingerprint:fingerprint}}});
        if(device && device.status!==DeviceStatus.ACTIVE)throw new ForbiddenException('Workstation is revoked or blocked.');
        if(!device){
          if(await tx.device.count({where:{licenseId:row.id,status:DeviceStatus.ACTIVE}})>=row.maxDevices)throw new ForbiddenException('Workstation device limit reached.');
          device=await tx.device.create({data:{licenseId:row.id,deviceFingerprint:fingerprint,deviceName:input.deviceName??null,platform:'WINDOWS',appVersion:input.appVersion??null,status:DeviceStatus.ACTIVE,lastValidationAt:new Date(),lastSeenAt:new Date()}});
        }
        const enrolled=(await tx.$queryRaw<{public_key_hash:string;installation_id:string}[]>`SELECT public_key_hash,installation_id FROM pms_device_keys WHERE device_id=${device.id}`)[0];
        if(enrolled && (enrolled.public_key_hash!==hash||enrolled.installation_id!==binding.installation_id))throw new ForbiddenException('Device identity changed; administrator reset is required.');
        await tx.$executeRaw`INSERT INTO pms_device_keys(device_id,installation_id,public_key_hash) VALUES(${device.id},${binding.installation_id}::uuid,${hash}) ON CONFLICT(device_id) DO NOTHING`;
        await tx.device.update({where:{id:device.id},data:{lastValidationAt:new Date(),lastSeenAt:new Date(),appVersion:input.appVersion??device.appVersion}});
        const now=Date.now(),window=pmsLeaseWindow(row.expiresAt,now),plan=this.plan(row);
        const payload={licenseKey:row.licenseKey,planKey:row.plan.key,edition:row.plan.name,features:plan.features,maxDevices:row.maxDevices,issuedAt:row.createdAt.toISOString(),expiresAt:row.expiresAt?.toISOString()??null,version:row.version};
        const signed=this.crypto.sign(payload);
        const lease=this.crypto.signDocument({purpose:'desktop-offline-lease',licenseKey:row.licenseKey,deviceFingerprint:input.deviceFingerprint,
          companyInstallationId:binding.installation_id,deviceId:String(device.id),devicePublicKey:input.devicePublicKey,
          validatedAt:new Date(now).toISOString(),nextCheckAt:new Date(window.nextCheckAt).toISOString(),offlineUntil:new Date(window.offlineUntil).toISOString(),
          subscriptionExpiresAt:payload.expiresAt,version:row.version,maxDevices:row.maxDevices,entitlements:plan});
        return {valid:true,status:'SUCCESS',message:'Workstation verified',validUntil:new Date(window.nextCheckAt).toISOString(),payload,signature:signed.signature,lease,serverTime:new Date(now).toISOString(),publicKey:this.crypto.getPublicKeyPem(),release:null};
      });
    }catch(error){ if(error instanceof ForbiddenException)return {valid:false,status:'REVOKED',message:error.message,payload:null,signature:null,validUntil:null,serverTime:new Date().toISOString(),publicKey:null,release:null};throw error; }
  }
  async status(input:PmsWorkstationRequest){
    try{return await this.db.$transaction(async tx=>{
      const row=await this.license(tx,input.licenseKey);
      const binding=(await tx.$queryRaw<Installation[]>`SELECT * FROM pms_installations WHERE license_id=${row.id}`)[0];
      const device=await tx.device.findUnique({where:{licenseId_deviceFingerprint:{licenseId:row.id,deviceFingerprint:this.security.hashFingerprint([input.deviceFingerprint])}}});
      if(!binding||binding.installation_id!==input.serverInstanceId||!device||device.status!==DeviceStatus.ACTIVE)throw new ForbiddenException('Device or installation unavailable.');
      const key=createPublicKey(input.devicePublicKey),hash=createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
      const enrolled=(await tx.$queryRaw<{public_key_hash:string;installation_id:string}[]>`SELECT public_key_hash,installation_id FROM pms_device_keys WHERE device_id=${device.id}`)[0];
      if(!enrolled||enrolled.public_key_hash!==hash||enrolled.installation_id!==binding.installation_id)throw new ForbiddenException('Device key is not enrolled.');
      return {valid:true,status:'SUCCESS',version:row.version,message:'Device remains authorized; lease was not renewed.'};
    });}catch(error){if(error instanceof ForbiddenException)return {valid:false,status:'REVOKED',message:error.message};throw error;}
  }
}
