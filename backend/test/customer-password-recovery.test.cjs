require('ts-node/register/transpile-only');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {ConfigService}=require('@nestjs/config');
const {CustomerPasswordRecoveryService,CustomerPasswordMailService}=require('../src/customer-portal/customer-password-recovery.service');
const {CustomerJwtGuard}=require('../src/customer-portal/customer-jwt.guard');

test('recovery requests hide account existence and persist only a token digest',async()=>{
 let stored,sent;
 const tx={$queryRaw:async()=>[],customerPasswordReset:{findFirst:async()=>null,create:async({data})=>(stored={id:1,...data})}};
 const db={customer:{findFirst:async()=>({id:1,email:'owner@example.invalid'})},$transaction:async callback=>callback(tx)};
 const mail={configuration:()=>({}),send:async(email,token)=>{sent={email,token};}};
 const service=new CustomerPasswordRecoveryService(db,{},mail);
 const known=await service.request('OWNER@example.invalid');
 db.customer.findFirst=async()=>null;const unknown=await service.request('unknown@example.invalid');
 assert.deepEqual(known,unknown);assert.match(sent.token,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(stored.tokenHash,createHash('sha256').update(sent.token).digest('hex'));
 assert.ok(!JSON.stringify(stored).includes(sent.token));assert.ok(!JSON.stringify(known).includes(sent.token));
 assert.ok(stored.expiresAt-Date.now()<=30*60000);
});

test('expired, used and unknown recovery links cannot change any password',async()=>{
 for(const row of [null,{usedAt:new Date(),expiresAt:new Date(Date.now()+60000)},{usedAt:null,expiresAt:new Date(0)}]){
  const service=new CustomerPasswordRecoveryService({customerPasswordReset:{findUnique:async()=>row},$transaction:()=>assert.fail('must not mutate')},{hashPassword:()=>assert.fail('must not hash')},{});
  await assert.rejects(service.reset('x'.repeat(43),'New-Secure-Password-42!'),/invalid or expired/);
 }
});

test('SMTP requires configuration and verified TLS; reset links never trust request host',async()=>{
 const missing=new CustomerPasswordMailService(new ConfigService({}));assert.throws(()=>missing.configuration(),/not configured/);
 const config={SMTP_HOST:'smtp.example.invalid',SMTP_USER:'synthetic',SMTP_PASSWORD:'synthetic',SMTP_FROM:'PMS <sender@example.invalid>',PORTAL_PUBLIC_URL:'https://portal.example.invalid',SMTP_PORT:'587'};
 const nodemailer=require('nodemailer'),original=nodemailer.createTransport;let options,message;
 nodemailer.createTransport=value=>(options=value,{sendMail:async mail=>{message=mail;},close:()=>{}});
 try{
  await new CustomerPasswordMailService(new ConfigService(config)).send('owner@example.invalid','x'.repeat(43));
  assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.auth.pass,'synthetic');
  assert.ok(message.text.includes('https://portal.example.invalid/portal/reset-password#token='));
  assert.ok(!message.text.includes('?token='));
  assert.throws(()=>new CustomerPasswordMailService(new ConfigService({...config,PORTAL_PUBLIC_URL:'http://portal.example.invalid'})).configuration(),/HTTPS/);
 }finally{nodemailer.createTransport=original;}
});

test('password reset ends old customer JWTs and suspended accounts remain blocked',async()=>{
 const request={headers:{authorization:'Bearer synthetic'}};const context={switchToHttp:()=>({getRequest:()=>request})};
 let version=0,status='ACTIVE';
 const jwt={verifyAsync:async(_token,options)=>{assert.equal(options.audience,'customer-portal');return {sub:'1',authVersion:version};}};
 const db={customer:{findUnique:async()=>({status,deletedAt:null,authVersion:1})}};
 const guard=new CustomerJwtGuard(jwt,db);
 await assert.rejects(guard.canActivate(context),/session has ended/);
 version=1;assert.equal(await guard.canActivate(context),true);
 status='SUSPENDED';await assert.rejects(guard.canActivate(context),/session has ended/);
});
