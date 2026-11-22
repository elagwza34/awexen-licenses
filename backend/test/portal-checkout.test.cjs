require('ts-node/register/transpile-only');
const {test}=require('node:test');const assert=require('node:assert/strict');
const {CustomerPortalService}=require('../src/customer-portal/customer-portal.service');
const {PaymentsService}=require('../src/payments/payments.service');
function service(plan){let created;let payment;const quotes=new Map();let serial=0;const prisma={customer:{findUnique:async()=>null,create:async({data})=>(created={id:9,...data}),findUniqueOrThrow:async()=>({id:9,status:'ACTIVE',downloadEnabled:false})},plan:{findFirst:async()=>plan,findUnique:async()=>plan},checkoutQuote:{create:async({data})=>{const q={id:`00000000-0000-4000-8000-${String(++serial).padStart(12,'0')}`,...data};quotes.set(q.id,q);return q;},findFirst:async({where})=>quotes.get(where.id)},payment:{findUnique:async({where})=>payment?.checkoutQuoteId===where.checkoutQuoteId?payment:null,create:async({data})=>(payment={id:4,...data})},$queryRaw:async()=>[]};prisma.$transaction=async cb=>cb(prisma);const s=new CustomerPortalService(prisma,{hashPassword:async()=> 'hash'},{signAsync:async()=> 'token'},{get:(_k,v)=>v},{complete:(_email,_code,create)=>prisma.$transaction(create)},{welcome:async()=>{},payment:async()=>{}});s.recordAudit=async()=>{};return {s,created:()=>created};}

test('registration persists the validated selected yearly plan without unlocking downloads',async()=>{const {s,created}=service({id:12,key:'PMS_PRO_YEARLY'});await s.register({email:' Buyer@example.com ',name:'Buyer',password:'SafePassword12!',planKey:'PMS_PRO_YEARLY'},{});assert.equal(created().requestedPlanId,12);assert.equal(created().downloadEnabled,false);assert.equal(created().email,'buyer@example.com');});
test('unavailable selected plans never create an account',async()=>{const {s,created}=service(null);await assert.rejects(s.register({email:'a@example.com',name:'Buyer',password:'SafePassword12!',planKey:'ARCHIVED'},{}),/not available/);assert.equal(created(),undefined);});
test('checkout rejects an altered amount and binds a valid payment to its exact plan',async()=>{const {s}=service({id:12,key:'PMS_PRO_YEARLY',name:'Growth annual',price:3360000,setupFee:500000,enforceEntitlements:true,status:'ACTIVE',currency:'EGP'});await assert.rejects(s.requestActivation(9,{planId:12,amount:1,receipt:{url:'receipt',size:100}},{}),/price changed/);const result=await s.requestActivation(9,{planId:12,amount:3860000,receipt:{url:'receipt',size:100}},{});assert.equal(result.plan.id,12);assert.equal(result.status,'PENDING');});
test('payment approval resolves its stored plan even when other plans have the same price',async()=>{const s=new PaymentsService({plan:{findMany:async()=>assert.fail('must not guess by price')}},{},{});assert.equal(await s.resolvePlanFor({amount:350000,planId:12,subscription:null}),12);});

test('portal notifies once for registration and once for a retried subscription quote', async () => {
  const plan = { id: 12, key: 'GROWTH', name: 'Growth', price: 350000, billingInterval: 'YEARLY',
    enforceEntitlements: true, status: 'ACTIVE', currency: 'EGP' };
  const { s } = service(plan);
  const notices = [];
  s.ownerNotifications = {
    registration: async (customer, name) => notices.push(['registration', customer.email, name]),
    subscription: async (payment, name, interval) => notices.push(['subscription', payment.id, name, interval]),
  };
  await s.register({ email: 'Buyer@example.com', name: 'Buyer', password: 'SafePassword12!', planKey: plan.key }, {});
  const quote = await s.quote(9, { planId: plan.id, billingInterval: 'YEARLY' });
  const input = { planId: plan.id, quoteId: quote.id, amount: 350000, receipt: { url: 'receipt', size: 100 } };
  await assert.rejects(s.requestActivation(9, { ...input, amount: 1 }, {}), /price changed/);
  const first = await s.requestActivation(9, input, {});
  const retried = await s.requestActivation(9, input, {});
  assert.equal(retried.id, first.id);
  assert.deepEqual(notices, [
    ['registration', 'buyer@example.com', 'Growth'],
    ['subscription', first.id, 'Growth', 'YEARLY'],
  ]);
});
