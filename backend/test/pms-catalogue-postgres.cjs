require('ts-node/register/transpile-only');
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {PrismaClient}=require('@prisma/client');
const {CustomerPortalService}=require('../src/customer-portal/customer-portal.service');

test('isolated migration preserves contracts and overrides while aligning canonical PMS plans and setup services',async()=>{
 const url=new URL(process.env.PMS_LMS_TEST_URL||'');
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.username,'pms_remediation_test_admin');
 assert.notEqual(url.port,'5432');assert.match(url.pathname,/^\/pms_lms_test_[0-9a-f]{32}$/);
 const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
 try{
  const actual=await db.$queryRawUnsafe('SHOW data_directory');
  assert.equal(path.resolve(actual[0].data_directory).toLowerCase(),path.resolve(process.env.PMS_TEST_DATA_DIRECTORY).toLowerCase());
  const expected={PMS_STARTER:[1,1,1,1,[]],PMS_PRO:[5,2,2,4,['WOOCOMMERCE_SETUP']],PMS_BUSINESS:[20,5,5,10,['WOOCOMMERCE_SETUP','SHIPPING_SETUP']]};
  const portal=new CustomerPortalService(db,{}, {},{get:(_key,fallback)=>fallback});
  const {plans}=await portal.catalogue();
  for(const [key,limits] of Object.entries(expected)){
   const plan=plans.find(p=>p.key===key);assert.ok(plan);
   assert.deepEqual([plan.maxUsers,plan.maxBranches,plan.maxWarehouses,plan.maxDevices,plan.includedServices],limits);
   const month=plan.billingOptions.find(x=>x.billingInterval==='MONTHLY'),year=plan.billingOptions.find(x=>x.billingInterval==='YEARLY');
   assert.equal(year.price,Math.round(month.price*12*0.85));
   assert.equal(plan.setupFee,{PMS_STARTER:300000,PMS_PRO:500000,PMS_BUSINESS:800000}[key]);
   assert.equal(plan.features.some(x=>x.feature.key==='WOOCOMMERCE_SETUP'||x.feature.key==='SHIPPING_SETUP'),false);
  }
  assert.ok(plans.find(p=>p.key==='PMS_PRO').features.some(x=>x.feature.key==='MULTI_BRANCH'));
  const rows=await db.license.findMany({where:{licenseKey:{startsWith:'MIGRATION-FIXTURE-'}},orderBy:{licenseKey:'asc'}});
  assert.equal(rows.length,3);
  for(const row of rows){
   assert.equal(row.version,8);
   assert.equal(row.startsAt.toISOString(),'2026-11-01T00:00:00.000Z');
   assert.equal(row.expiresAt.toISOString(),'2027-11-01T00:00:00.000Z');
   assert.equal(row.maxDevices,{'MIGRATION-FIXTURE-STARTER':1,'MIGRATION-FIXTURE-PRO':4,'MIGRATION-FIXTURE-CUSTOM':99}[row.licenseKey]);
  }
 }finally{await db.$disconnect();}
});
