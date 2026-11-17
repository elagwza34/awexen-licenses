require('ts-node/register/transpile-only');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {latestEligibleRelease,compareReleaseVersions,planReleaseChannel}=require('../src/releases/release-policy');
const {CustomerPortalService}=require('../src/customer-portal/customer-portal.service');
test('plan-scoped releases never select another plan and version ordering is numeric',async()=>{
 const all=[{version:'1.9.0',buildNumber:1,channel:'stable'},{version:'1.10.0',buildNumber:2,channel:planReleaseChannel(1)},{version:'9.0.0',buildNumber:99,channel:planReleaseChannel(2)}];
 const db={appVersion:{findMany:async({where})=>all.filter(row=>where.channel.in.includes(row.channel))}};
 assert.equal((await latestEligibleRelease(db,[1])).version,'1.10.0');assert.equal((await latestEligibleRelease(db,[2])).version,'9.0.0');
 assert.equal(await latestEligibleRelease(db,[]),null);assert.equal(compareReleaseVersions('1.4.3','1.4.3.0'),0);
});
test('installer access is paid and derived from the customer licence rather than a supplied plan',async()=>{
 let query;const db={customer:{findUniqueOrThrow:async()=>({downloadEnabled:true,status:'ACTIVE',deletedAt:null})},license:{findMany:async input=>(query=input,[])},appVersion:{findMany:()=>assert.fail('no eligible licence')}};
 const service=new CustomerPortalService(db,{},{},{});
 await assert.rejects(service.download(1,'OTHER_PLAN'),/No installer/);assert.equal(query.where.customerId,1);assert.equal(query.where.plan.key,'OTHER_PLAN');
 db.customer.findUniqueOrThrow=async()=>({downloadEnabled:false,status:'ACTIVE'});await assert.rejects(service.download(1),/Forbidden/);
});
