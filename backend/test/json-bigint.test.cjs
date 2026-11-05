require('ts-node/register/transpile-only');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {jsonBigIntReplacer}=require('../src/common/json-bigint');
test('release file sizes serialize as numbers in admin and portal envelopes',()=>{
 const fileSize=119349246n;
 const result=JSON.parse(JSON.stringify({data:[{fileSize}],latestRelease:{fileSize},release:{fileSize}},jsonBigIntReplacer));
 assert.equal(result.data[0].fileSize,119349246);
 assert.equal(result.latestRelease.fileSize,119349246);
 assert.equal(result.release.fileSize,119349246);
});
test('integers beyond JSON number precision preserve all digits as strings',()=>{
 const value=9007199254740993n;
 assert.equal(JSON.parse(JSON.stringify({value,negative:-value},jsonBigIntReplacer)).value,'9007199254740993');
 assert.equal(JSON.parse(JSON.stringify({value,negative:-value},jsonBigIntReplacer)).negative,'-9007199254740993');
});
