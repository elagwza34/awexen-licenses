require('ts-node/register/transpile-only');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript'),helper={exports:{}};
const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../../frontend/src/lib/checkout-selection.ts'),'utf8');
new Function('exports','require','module',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(helper.exports,require,helper);
const {checkoutDestination,resolveCheckoutSelection,parseBillingInterval}=helper.exports;
const plans=[{id:6,key:'PMS_STARTER',system:{key:'PMS'},billingOptions:[{billingInterval:'MONTHLY',price:150000},{billingInterval:'YEARLY',price:1530000}]},{id:7,key:'PMS_PRO',system:{key:'PMS'},billingOptions:[{billingInterval:'MONTHLY',price:350000}]}];
test('registration destination preserves the selected system, plan and yearly interval',()=>{
 assert.equal(checkoutDestination(plans[0],'YEARLY'),'/portal/subscription/PMS?plan=PMS_STARTER&billingInterval=YEARLY');
 assert.equal(checkoutDestination(undefined,'MONTHLY'),'/portal/subscription');
});
test('checkout selection prioritizes a valid explicit choice over an older account preference',()=>{
 assert.deepEqual(resolveCheckoutSelection(plans,'PMS',new URLSearchParams('plan=PMS_STARTER&billingInterval=YEARLY'),7),{planId:6,interval:'YEARLY'});
 assert.deepEqual(resolveCheckoutSelection(plans,'PMS',new URLSearchParams(),7),{planId:7,interval:'MONTHLY'});
});
test('unavailable intervals and plans never silently fall back to a different purchase',()=>{
 for(const query of ['plan=PMS_PRO&billingInterval=YEARLY','plan=UNKNOWN','plan=PMS_STARTER&billingInterval=BAD']){
  const result=resolveCheckoutSelection(plans,'PMS',new URLSearchParams(query),7);
  assert.equal(result.planId,null);assert.ok(result.error);
 }
 assert.equal(resolveCheckoutSelection(plans,'OTHER',new URLSearchParams('plan=PMS_STARTER'),6).planId,null);
 assert.equal(parseBillingInterval(null),'MONTHLY');
 assert.equal(parseBillingInterval('BAD'),null);
});
