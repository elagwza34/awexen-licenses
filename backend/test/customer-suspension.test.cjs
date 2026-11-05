require('ts-node/register/transpile-only');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LicenseValidationService}=require('../src/licenses/license-validation.service');

for(const [status,deletedAt] of [['SUSPENDED',null],['INACTIVE',null],['ACTIVE',new Date()]]){
 test(`validation blocks an active licence for customer ${status}, deleted=${Boolean(deletedAt)}`,async()=>{
  const validations=[];
  const prisma={license:{findUnique:async()=>({id:8,customerId:3,status:'ACTIVE',customer:{status,deletedAt}})},
   licenseValidation:{create:async({data})=>{validations.push(data);return data;}},
   device:{findUnique:async()=>{throw Error('Blocked accounts must not activate devices');}}};
  const service=new LicenseValidationService(prisma,{}, {hashFingerprint:()=> 'HASH'}, {},
   {derive:()=>{throw Error('Account suspension must precede licence validity checks');}});
  const result=await service.validate({licenseKey:'FIXTURE',deviceFingerprint:'DEVICE'},{ip:'127.0.0.1'});
  assert.equal(result.valid,false);assert.equal(result.status,'SUSPENDED');
  assert.equal(result.payload,null);assert.equal(result.signature,null);assert.equal(result.lease,undefined);
  assert.equal(validations[0].customerId,3);assert.equal(validations[0].status,'SUSPENDED');
 });
}
test('an active customer still reaches independent licence revocation checks',async()=>{
 const service=new LicenseValidationService({license:{findUnique:async()=>({id:8,customerId:3,status:'REVOKED',customer:{status:'ACTIVE',deletedAt:null}})},licenseValidation:{create:async()=>{}}},
  {},{hashFingerprint:()=> 'HASH'},{},{});
 const result=await service.validate({licenseKey:'FIXTURE',deviceFingerprint:'DEVICE'},{ip:'127.0.0.1'});
 assert.equal(result.status,'REVOKED');assert.equal(result.valid,false);
});
