import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {compareVersions,validPath,verifyManifest,openBundle,findUpdate,downloadBundle,writeOrder,UPDATE_SOURCES,MANIFEST_NAME,SIGNATURE_NAME} from '../src/update-core.js';
import {packRelease} from '../scripts/update-pack.mjs';

const root=path.resolve(import.meta.dirname,'..');
const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
const pem=privateKey.export({type:'pkcs8',format:'pem'}),key=publicKey.export({type:'spki',format:'der'}).toString('base64');
function fakeDist(version='9.9.9'){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yz-update-'));
  fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({name:'AI圆桌lite',version}));
  fs.writeFileSync(path.join(dir,'build.json'),JSON.stringify({version,commit:'abc',builtAt:'now'}));
  fs.writeFileSync(path.join(dir,'background.js'),'console.log("新版本 ✓")\n');
  fs.mkdirSync(path.join(dir,'vendor'));fs.writeFileSync(path.join(dir,'vendor','lib.js'),Buffer.from([0,1,2,255]));
  return dir;
}
const release=(over={})=>packRelease({distDir:fakeDist(over.version),notes:'说明',privateKeyPem:pem,...over});

test('versions compare numerically',()=>{
  assert.equal(compareVersions('0.7.0','0.6.10'),1);assert.equal(compareVersions('0.10.0','0.9.9'),1);assert.equal(compareVersions('1.0.0','1.0.0'),0);assert.equal(compareVersions('0.6.3','0.7.0'),-1);
});
test('only plain relative paths may be written',()=>{
  for(const ok of ['manifest.json','vendor/marked.umd.js','icon-16.png'])assert(validPath(ok),ok);
  for(const bad of ['../x.js','a/../b.js','/abs.js','C:/x.js','a\\b.js','.hidden','vendor/.x','',null])assert(!validPath(bad),String(bad));
});
test('a signed release verifies and unpacks to the exact bytes',async()=>{
  const {version,assets}=release();
  const m=await verifyManifest(assets[MANIFEST_NAME],assets[SIGNATURE_NAME].toString(),{key});
  assert.equal(m.version,version);assert.equal(m.notes,'说明');
  const files=await openBundle(assets[m.bundle.name],m);
  assert.deepEqual(files.map(f=>f.path).sort(),['background.js','build.json','manifest.json','vendor/lib.js']);
  assert.deepEqual([...files.find(f=>f.path==='vendor/lib.js').data],[0,1,2,255]);
  assert.equal(new TextDecoder().decode(files.find(f=>f.path==='background.js').data),'console.log("新版本 ✓")\n');
});
test('a changed manifest, a wrong key or an interception page is rejected',async()=>{
  const {assets}=release();const sig=assets[SIGNATURE_NAME].toString();
  const changed=Buffer.from(assets[MANIFEST_NAME].toString().replace('"9.9.9"','"9.9.8"'));
  await assert.rejects(verifyManifest(changed,sig,{key}),/签名校验未通过/);
  await assert.rejects(verifyManifest(assets[MANIFEST_NAME],sig),/签名校验未通过/,'production key must not accept a test signature');
  await assert.rejects(verifyManifest(Buffer.from('<html>公司网络拦截</html>'),sig,{key}),/签名/);
});
test('a bundle that does not match its signed manifest is rejected',async()=>{
  const {assets}=release(),m=await verifyManifest(assets[MANIFEST_NAME],assets[SIGNATURE_NAME].toString(),{key});
  const bundle=assets[m.bundle.name],tampered=Buffer.from(bundle);tampered[tampered.length-5]^=1;
  await assert.rejects(openBundle(tampered,m),/更新包校验未通过/);
  await assert.rejects(openBundle(bundle.subarray(0,bundle.length-1),m),/更新包校验未通过/);
});
test('a manifest listing an unsafe path is refused even when signed',async()=>{
  const {assets}=release(),m=JSON.parse(assets[MANIFEST_NAME].toString());m.files.push({path:'../evil.js',size:1,sha256:'0'.repeat(64)});
  const bytes=Buffer.from(JSON.stringify(m)),sig=crypto.sign('sha256',bytes,{key:pem,dsaEncoding:'ieee-p1363'}).toString('base64');
  await assert.rejects(verifyManifest(bytes,sig,{key}),/文件 \.\.\/evil\.js/);
});
function fakeFetch(routes){return async(url,init)=>{const r=routes[url.split('?')[0]];if(typeof r==='function')return r(init);if(!r)return new Response('not found',{status:404});return new Response(r);};}
test('sources are tried in order: GitHub 404 (not signed in) or an interception page falls back to the backup server',async()=>{
  const {assets}=release(),[gh,backup]=UPDATE_SOURCES;let credentials;
  const routes={[backup.base+MANIFEST_NAME]:assets[MANIFEST_NAME],[backup.base+SIGNATURE_NAME]:assets[SIGNATURE_NAME],[gh.base+MANIFEST_NAME]:init=>{credentials=init.credentials;return new Response('x',{status:404});}};
  const found=await findUpdate({fetchImpl:fakeFetch(routes),key});
  assert.equal(found.source.name,'备用服务器');assert.equal(credentials,'include','GitHub request carries the browser login');
  assert.equal(found.results[0].ok,false);assert.match(found.results[0].error,/没登录 GitHub/);assert.equal(found.results[1].ok,true);
  routes[gh.base+MANIFEST_NAME]='<html>proxy</html>';routes[gh.base+SIGNATURE_NAME]='AAAA';
  const again=await findUpdate({fetchImpl:fakeFetch(routes),key});
  assert.equal(again.source.name,'备用服务器');assert.match(again.results[0].error,/校验未通过/);
  const none=await findUpdate({fetchImpl:fakeFetch({}),key});assert.equal(none.manifest,null);assert.equal(none.results.length,2);
});
test('the bundle download reports progress and falls back when the first source fails',async()=>{
  const {assets}=release(),m=JSON.parse(assets[MANIFEST_NAME].toString()),[gh,backup]=UPDATE_SOURCES,seen=[];
  const got=await downloadBundle(m,{fetchImpl:fakeFetch({[backup.base+m.bundle.name]:assets[m.bundle.name]}),onProgress:p=>seen.push(p.source)});
  assert.equal(got.source,'备用服务器');assert.equal(got.bytes.length,m.bundle.size);assert(seen.includes('GitHub')&&seen.includes('备用服务器'));
  assert.equal(got.failures[0].name,'GitHub');
});
test('files announcing the new version are written last',()=>{
  assert.deepEqual(writeOrder([{path:'build.json'},{path:'a.js'},{path:'manifest.json'},{path:'vendor/b.js'}]).map(f=>f.path),['a.js','vendor/b.js','manifest.json','build.json']);
});
test('the extension may fetch from every update source; the release key in the source is a valid P-256 key',async()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'src','manifest.json'),'utf8'));
  for(const s of UPDATE_SOURCES)assert(manifest.host_permissions.includes(new URL(s.base).origin+'/*'),s.name);
  for(const host of ['objects.githubusercontent.com','release-assets.githubusercontent.com'])assert(manifest.host_permissions.includes(`https://${host}/*`),host);
  const {UPDATE_KEY}=await import('../src/update-core.js');
  await crypto.webcrypto.subtle.importKey('spki',Buffer.from(UPDATE_KEY,'base64'),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
});
