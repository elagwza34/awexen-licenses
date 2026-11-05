require('ts-node/register/transpile-only');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LicenseValidationService}=require('../src/licenses/license-validation.service');
function fixture(overrides={}){
 const license={status:'ACTIVE',expiresAt:null,isTrial:false,startsAt:new Date(0),customer:{status:'ACTIVE',deletedAt:null},devices:[{status:'ACTIVE'}],...overrides};
 const prisma={license:{findUnique:async(query)=>{assert.equal(query.include.devices.where.deviceFingerprint,'HASH');return license;}}};
 const status={derive:row=>({status:row.status})};
 return new LicenseValidationService(prisma,{}, {hashFingerprint:()=> 'HASH'}, {},status);
}
for(const [title,changes,expected] of [
 ['active account',{},'SUCCESS'],
 ['suspended customer',{customer:{status:'SUSPENDED',deletedAt:null}},'SUSPENDED'],
 ['inactive customer',{customer:{status:'INACTIVE',deletedAt:null}},'SUSPENDED'],
 ['deleted customer',{customer:{status:'ACTIVE',deletedAt:new Date()}},'SUSPENDED'],
 ['revoked licence',{status:'REVOKED'},'REVOKED'],
 ['suspended licence',{status:'SUSPENDED'},'SUSPENDED'],
 ['expired licence',{expiresAt:new Date(0)},'EXPIRED'],
 ['unactivated device',{devices:[]},'INVALID'],
 ['blocked device',{devices:[{status:'BLOCKED'}]},'REVOKED']]){
 test(`read-only heartbeat: ${title}`,async()=>{
  const result=await fixture(changes).checkStatus({licenseKey:'FIXTURE-KEY',deviceFingerprint:'DEVICE'});
  assert.equal(result.status,expected);assert.equal(result.valid,expected==='SUCCESS');
  assert.equal(result.lease,undefined);assert.equal(result.payload,undefined);
 });
}
