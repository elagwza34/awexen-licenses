require('ts-node/register/transpile-only');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ValidationPipe}=require('@nestjs/common');
const {UpdatePlanDto}=require('../src/plans/dto/plan.dto');
const {entitlementHash}=require('../src/plans/billing-pricing');
test('setup service selections are validated independently from runtime capabilities',async()=>{
 const pipe=new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true});
 const metadata={type:'body',metatype:UpdatePlanDto};
 for(const services of [[],['WOOCOMMERCE_SETUP'],['WOOCOMMERCE_SETUP','SHIPPING_SETUP']])
  assert.deepEqual((await pipe.transform({includedServices:services},metadata)).includedServices,services);
 for(const services of [['UNKNOWN'],['WOOCOMMERCE_SETUP','WOOCOMMERCE_SETUP'],'SHIPPING_SETUP'])
  await assert.rejects(pipe.transform({includedServices:services},metadata));
});
test('changing promised setup services invalidates quotes, while empty defaults preserve existing hashes',()=>{
 const plan={features:[],maxDevices:1,maxUsers:1,maxBranches:1,maxWarehouses:1,enforceEntitlements:true};
 assert.equal(entitlementHash(plan),entitlementHash({...plan,includedServices:[]}));
 assert.notEqual(entitlementHash(plan),entitlementHash({...plan,includedServices:['WOOCOMMERCE_SETUP']}));
 assert.equal(entitlementHash({...plan,includedServices:['SHIPPING_SETUP','WOOCOMMERCE_SETUP']}),entitlementHash({...plan,includedServices:['WOOCOMMERCE_SETUP','SHIPPING_SETUP']}));
});
