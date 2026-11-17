const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
test('encrypted deployment receipts restore exact bytes, reject tampering and never overwrite existing files',()=>{
 const {restoreReleaseReceipts}=require('../scripts/restore-release-receipts.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pms-receipt-restore-'));
 const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
 const data=Buffer.from('synthetic-image-bytes'),name='11111111-1111-4111-8111-111111111111.png';
 function snapshot(fileName=name){
  const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const bytes=Buffer.concat([cipher.update(JSON.stringify([{name:fileName,data:data.toString('base64'),sha256:crypto.createHash('sha256').update(data).digest('hex')}])),cipher.final()]);
  return {version:1,key:crypto.publicEncrypt({key:publicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')};
 }
 const file=path.join(dir,'snapshot.json'),target=path.join(dir,'receipts');
 const write=x=>fs.writeFileSync(file,JSON.stringify(x));
 try{
  write(snapshot());assert.equal(restoreReleaseReceipts(file,target,privateKey),1);assert.deepEqual(fs.readFileSync(path.join(target,name)),data);
  write(snapshot());assert.equal(restoreReleaseReceipts(file,target,privateKey),0);
  fs.writeFileSync(path.join(target,name),'existing-newer-data');write(snapshot());assert.throws(()=>restoreReleaseReceipts(file,target,privateKey),/conflict/);
  const bad=snapshot();bad.tag=Buffer.alloc(16).toString('base64');write(bad);assert.throws(()=>restoreReleaseReceipts(file,target,privateKey));
  write(snapshot('../escape.png'));assert.throws(()=>restoreReleaseReceipts(file,target,privateKey),/filename/);
  assert.equal(fs.existsSync(path.join(dir,'escape.png')),false);
 }finally{if(path.basename(dir).startsWith('pms-receipt-restore-'))fs.rmSync(dir,{recursive:true,force:true});}
});
