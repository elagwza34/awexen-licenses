require('ts-node/register/transpile-only');
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {PrismaClient}=require('@prisma/client');const {SecurityService}=require('../src/common/crypto/security.service');
const {ConfigService}=require('@nestjs/config');const {CustomerPasswordRecoveryService}=require('../src/customer-portal/customer-password-recovery.service');

test('isolated PostgreSQL recovery: email cooldown, single-use race, credential version and expiry',async()=>{
 const url=new URL(process.env.PMS_LMS_TEST_URL||'');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.username,'pms_remediation_test_admin');assert.notEqual(url.port,'5432');assert.match(url.pathname,/^\/pms_lms_test_[0-9a-f]{32}$/);
 const db=new PrismaClient({datasources:{db:{url:url.toString()}}});
 try{
  const actual=await db.$queryRawUnsafe('SHOW data_directory');assert.equal(path.resolve(actual[0].data_directory).toLowerCase(),path.resolve(process.env.PMS_TEST_DATA_DIRECTORY).toLowerCase());
  const security=new SecurityService(new ConfigService({}));
  const customer=await db.customer.create({data:{name:'Synthetic owner',email:'recovery@example.invalid',passwordHash:await security.hashPassword('Old-Secure-Password-42!')}});
  const sent=[];const mail={configuration:()=>({}),send:async(email,token)=>{sent.push({email,token});}};
  const service=new CustomerPasswordRecoveryService(db,security,mail);
  await Promise.all([service.request(customer.email),service.request(customer.email)]);assert.equal(sent.length,1);
  assert.equal(await db.customerPasswordReset.count(),1);
  const password='New-Secure-Password-42!';const attempts=await Promise.allSettled([service.reset(sent[0].token,password),service.reset(sent[0].token,password)]);
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
  const updated=await db.customer.findUniqueOrThrow({where:{id:customer.id}});assert.equal(updated.authVersion,1);
  assert.equal(await security.verifyPassword(password,updated.passwordHash),true);
  assert.equal(await security.verifyPassword('Old-Secure-Password-42!',updated.passwordHash),false);
  assert.equal(await db.auditLog.count({where:{action:'customer.password_reset'}}),1);
  await assert.rejects(service.reset(sent[0].token,password),/invalid or expired/);
  await db.customerPasswordReset.updateMany({data:{usedAt:null,expiresAt:new Date(0)}});
  await assert.rejects(service.reset(sent[0].token,password),/invalid or expired/);
 }finally{await db.$disconnect();}
});
