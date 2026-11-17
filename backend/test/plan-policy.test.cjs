require('ts-node/register/transpile-only');
const {test}=require('node:test');const assert=require('node:assert/strict');
const {PMS_PLAN_PRESETS,validatePmsPolicy}=require('../src/plans/pms-plan-policy');
const {supportsPmsEntitlements}=require('../src/plans/pms-client-version');
test('enforced plans require a compatible client and reject missing or malformed versions',()=>{
 for(const version of [undefined,'','1.3.0','1.40','bad','1.3.999'])assert.equal(supportsPmsEntitlements(version),false);
 for(const version of ['1.4.0','1.4.0.0','1.5.0','2.0.0'])assert.equal(supportsPmsEntitlements(version),true);
});
test('all three PMS presets have valid dependencies and distinct installation limits',()=>{
 assert.equal(PMS_PLAN_PRESETS.length,3);
 for(const p of PMS_PLAN_PRESETS)assert.equal(validatePmsPolicy(p.features,p),undefined);
 assert.deepEqual(PMS_PLAN_PRESETS.map(p=>[p.maxUsers,p.maxBranches,p.maxWarehouses,p.maxDevices]),[[1,1,1,1],[5,2,2,4],[20,5,5,10]]);
 assert.deepEqual(PMS_PLAN_PRESETS.map(p=>p.includedServices),[[],['WOOCOMMERCE_SETUP'],['WOOCOMMERCE_SETUP','SHIPPING_SETUP']]);
});
test('unsupported integrations and incomplete capability sets cannot be sold as enforced PMS plans',()=>{
 assert.ok(validatePmsPolicy(['PRODUCTS','WOOCOMMERCE'],{maxBranches:1,maxWarehouses:1}));
 assert.ok(validatePmsPolicy(['PRODUCTS','ATTENDANCE'],{maxBranches:1,maxWarehouses:1}));
 assert.ok(validatePmsPolicy(['PRODUCTS','INVENTORY'],{maxBranches:1,maxWarehouses:2}));
});
