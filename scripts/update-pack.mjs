// Builds the one-click update assets from a built dist folder:
//   update-manifest.json   version, notes, bundle hash and every file's path / size / sha256 (signed)
//   update-manifest.sig    ECDSA P-256 signature of the exact manifest bytes (base64, IEEE P1363)
//   ai-yuanzhuo-lite-<v>-update.json   all files, base64, in one download
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {UPDATE_PRODUCT,MANIFEST_NAME,SIGNATURE_NAME,validPath} from '../src/update-core.js';

const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
export function listFiles(dir){
  const out=[];
  const walk=(abs,rel)=>{for(const e of fs.readdirSync(abs,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const r=rel?rel+'/'+e.name:e.name;if(e.isSymbolicLink())throw new Error('Links are not allowed in a release: '+r);if(e.isDirectory())walk(path.join(abs,e.name),r);else{if(!validPath(r))throw new Error('File name not allowed in a release: '+r);out.push(r);}}};
  walk(dir,'');return out;
}
export function packRelease({distDir,notes,privateKeyPem,publishedAt=new Date().toISOString()}){
  const version=JSON.parse(fs.readFileSync(path.join(distDir,'manifest.json'),'utf8')).version;
  const bundleName=`${UPDATE_PRODUCT}-${version}-update.json`,files={},entries=[];
  for(const rel of listFiles(distDir)){const data=fs.readFileSync(path.join(distDir,rel));files[rel]=data.toString('base64');entries.push({path:rel,size:data.length,sha256:sha256(data)});}
  const bundle=Buffer.from(JSON.stringify({product:UPDATE_PRODUCT,version,files}),'utf8');
  const manifest=Buffer.from(JSON.stringify({product:UPDATE_PRODUCT,version,publishedAt,notes,bundle:{name:bundleName,size:bundle.length,sha256:sha256(bundle)},files:entries},null,1)+'\n','utf8');
  const signature=crypto.sign('sha256',manifest,{key:privateKeyPem,dsaEncoding:'ieee-p1363'}).toString('base64')+'\n';
  return {version,assets:{[MANIFEST_NAME]:manifest,[SIGNATURE_NAME]:Buffer.from(signature,'utf8'),[bundleName]:bundle}};
}
