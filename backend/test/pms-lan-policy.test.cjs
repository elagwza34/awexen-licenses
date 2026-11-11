require('ts-node/register/transpile-only');
const {test}=require('node:test');const assert=require('node:assert/strict');
const {pmsLeaseWindow,PMS_DAY}=require('../src/licenses/pms-license-policy');
test('PMS checks every 7 days and last-success grace is capped at 14 days',()=>{
  const now=Date.UTC(2026,10,11),result=pmsLeaseWindow(null,now);
  assert.equal(result.nextCheckAt,now+7*PMS_DAY);assert.equal(result.offlineUntil,now+14*PMS_DAY);
});
test('PMS expiry grace is 14 days and does not add another interval',()=>{
  const now=Date.UTC(2026,10,11),expires=new Date(now-13*PMS_DAY),result=pmsLeaseWindow(expires,now);
  assert.equal(result.expired,false);assert.equal(result.offlineUntil,now+PMS_DAY);assert.equal(result.nextCheckAt,now+PMS_DAY);
  assert.equal(pmsLeaseWindow(expires,now+PMS_DAY+1).expired,true);
});
test('PMS status/scheduler honors 14 days while unrelated product settings are preserved',()=>{
  const {LicenseStatusService}=require('../src/licenses/license-status.service');const service=new LicenseStatusService({});
  const now=new Date(),row={status:'ACTIVE',expiresAt:new Date(now.getTime()-10*PMS_DAY),isTrial:false,startsAt:new Date(0)};
  assert.equal(service.derive({...row,plan:{key:'PMS_FIXTURE'}},now).status,'EXPIRING');
  assert.equal(service.derive({...row,plan:{key:'OTHER_PRODUCT'}},now).status,'EXPIRED');
});
