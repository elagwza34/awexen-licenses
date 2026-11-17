import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'node:crypto';
import * as nodemailer from 'nodemailer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecurityService } from '../common/crypto/security.service';

export class ForgotCustomerPasswordDto { @IsEmail() @MaxLength(180) email!: string; }
export class ResetCustomerPasswordDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
  @IsString() @Length(12,128) password!: string;
}
@Injectable()
export class CustomerPasswordMailService {
  constructor(private readonly config:ConfigService){}
  configuration(){
    const host=this.config.get<string>('SMTP_HOST'),user=this.config.get<string>('SMTP_USER'),pass=this.config.get<string>('SMTP_PASSWORD');
    const from=this.config.get<string>('SMTP_FROM'),base=this.config.get<string>('PORTAL_PUBLIC_URL');
    const port=Number(this.config.get<string>('SMTP_PORT','587'));
    if(!host||!user||!pass||!from||!base||![465,587].includes(port))throw new ServiceUnavailableException('Password recovery email is not configured. Contact support.');
    let portal:URL;try{portal=new URL(base);}catch{throw new ServiceUnavailableException('Password recovery email is not configured.');}
    if(portal.protocol!=='https:'||portal.username||portal.password)throw new ServiceUnavailableException('Password recovery requires an approved HTTPS portal URL.');
    return {host,user,pass,from,port,portal};
  }
  async send(email:string,token:string){
    const c=this.configuration(),link=new URL('/portal/reset-password',c.portal);link.hash='token='+token;
    const transport=nodemailer.createTransport({host:c.host,port:c.port,secure:c.port===465,requireTLS:true,auth:{user:c.user,pass:c.pass},
      tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});
    try{await transport.sendMail({from:c.from,to:email,subject:'PMS — استعادة كلمة المرور',
      text:`لتعيين كلمة مرور جديدة افتح الرابط التالي خلال 30 دقيقة. الرابط يعمل مرة واحدة فقط.\n${link.toString()}\nإن لم تطلب الاستعادة فتجاهل الرسالة.`});}finally{transport.close();}
  }
}
@Injectable()
export class CustomerPasswordRecoveryService {
  private readonly logger=new Logger(CustomerPasswordRecoveryService.name);
  constructor(private readonly db:PrismaService,private readonly security:SecurityService,private readonly mail:CustomerPasswordMailService){}
  async request(email:string){
    this.mail.configuration();
    const started=Date.now();
    try {
    const message='If the account is available, a password-reset link will be sent.';
    const customer=await this.db.customer.findFirst({where:{email:email.trim().toLowerCase(),status:'ACTIVE',deletedAt:null,passwordHash:{not:null}}});
    if(!customer)return {message};
    const token=randomBytes(32).toString('base64url'),tokenHash=createHash('sha256').update(token).digest('hex');
    const row=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM customers WHERE id=${customer.id} FOR UPDATE`;
      const recent=await tx.customerPasswordReset.findFirst({where:{customerId:customer.id,createdAt:{gt:new Date(Date.now()-60000)}}});
      if(recent)return null;
      return tx.customerPasswordReset.create({data:{customerId:customer.id,tokenHash,expiresAt:new Date(Date.now()+30*60000)}});
    });
    if(row)void this.mail.send(customer.email,token).catch(async()=>{
      this.logger.warn('Password recovery email delivery failed.');
      try{await this.db.customerPasswordReset.delete({where:{id:row.id}});}catch{this.logger.warn('Password recovery cleanup failed.');}
    });
    return {message};
    } finally { await new Promise(resolve=>setTimeout(resolve,Math.max(0,500-(Date.now()-started)))); }
  }
  async reset(token:string,password:string){
    if(password.length>128)throw new BadRequestException('Password is too long.');
    const problems=SecurityService.assertPasswordStrength(password);if(problems.length)throw new BadRequestException(problems.join('. '));
    const tokenHash=createHash('sha256').update(token).digest('hex');
    const candidate=await this.db.customerPasswordReset.findUnique({where:{tokenHash}});
    const invalid=()=>new BadRequestException('The recovery link is invalid or expired. Request a new link.');
    if(!candidate||candidate.usedAt||candidate.expiresAt<=new Date())throw invalid();
    const passwordHash=await this.security.hashPassword(password);
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM customers WHERE id=${candidate.customerId} FOR UPDATE`;
      const customer=await tx.customer.findUnique({where:{id:candidate.customerId}});
      if(!customer||customer.status!=='ACTIVE'||customer.deletedAt)throw invalid();
      const claimed=await tx.customerPasswordReset.updateMany({where:{id:candidate.id,usedAt:null,expiresAt:{gt:new Date()}},data:{usedAt:new Date()}});
      if(claimed.count!==1)throw invalid();
      await tx.customer.update({where:{id:customer.id},data:{passwordHash,authVersion:{increment:1}}});
      await tx.customerPasswordReset.updateMany({where:{customerId:customer.id,usedAt:null},data:{usedAt:new Date()}});
      await tx.auditLog.create({data:{entity:'CUSTOMER',entityId:String(customer.id),action:'customer.password_reset'}});
    });
    return {message:'Password changed. Sign in again using your new password.'};
  }
}
