// Release: build, pack + sign the one-click update, zip for a first manual install, then (optionally) publish.
//   node scripts/release.mjs                 build everything into artifacts/release/v<version>/ and self-check
//   node scripts/release.mjs --publish       also create the GitHub Release (HEAD must be pushed to origin/main)
//   node scripts/release.mjs --mirror        also upload to the backup server (needs ECS_PWD; uses uv + paramiko)
// Publishing is outward-facing: run it only when the user has approved this release.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {packRelease} from './update-pack.mjs';
import {verifyManifest,openBundle,MANIFEST_NAME,SIGNATURE_NAME} from '../src/update-core.js';

const root=path.resolve(import.meta.dirname,'..'),args=new Set(process.argv.slice(2));
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
const keyFile=process.env.YZ_UPDATE_KEY_FILE||'C:\\VibeData\\Secrets\\ai-yuanzhuo-lite\\update-signing-key.pem';
if(!fs.existsSync(keyFile))throw new Error('Signing key not found: '+keyFile);
if(git('status','--porcelain','--','src','scripts','package.json'))throw new Error('Commit src/, scripts/ and package.json before releasing.');
await import('./build.mjs');
const dist=path.join(root,'dist'),version=JSON.parse(fs.readFileSync(path.join(dist,'manifest.json'),'utf8')).version;
const notesFile=path.join(root,'docs','releases',`${version}.md`);
if(!fs.existsSync(notesFile))throw new Error('Release notes missing: '+notesFile);
const notesDoc=fs.readFileSync(notesFile,'utf8').replace(/\r\n/g,'\n');
// The part before "---" is what the update dialog shows; the whole file is the GitHub Release text.
const notes=notesDoc.split(/\n---\n/)[0].replace(/^#.*\n+/,'').trim();
const out=path.join(root,'artifacts','release','v'+version);fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const {assets}=packRelease({distDir:dist,notes,privateKeyPem:fs.readFileSync(keyFile,'utf8')});
for(const [name,data] of Object.entries(assets))fs.writeFileSync(path.join(out,name),data);
// Self-check with the public key built into the extension: what users will verify is what was signed.
const manifest=await verifyManifest(assets[MANIFEST_NAME],assets[SIGNATURE_NAME].toString('utf8'));
const files=await openBundle(assets[manifest.bundle.name],manifest);
if(manifest.version!==version||files.length!==manifest.files.length)throw new Error('Release self-check failed');
// A plain zip for the one manual install (folder inside the zip: ai-yuanzhuo-lite).
const stage=path.join(out,'stage','ai-yuanzhuo-lite');fs.mkdirSync(stage,{recursive:true});fs.cpSync(dist,stage,{recursive:true});
const zipName=`ai-yuanzhuo-lite-v${version}.zip`,tar=process.platform==='win32'?'C:\\Windows\\System32\\tar.exe':'zip';
if(process.platform==='win32')execFileSync(tar,['-a','-c','-f',path.join(out,zipName),'-C',path.join(out,'stage'),'ai-yuanzhuo-lite']);else execFileSync('zip',['-qr',path.join(out,zipName),'ai-yuanzhuo-lite'],{cwd:path.join(out,'stage')});
fs.rmSync(path.join(out,'stage'),{recursive:true,force:true});
fs.copyFileSync(notesFile,path.join(out,'release-notes.md'));
console.log(`Release v${version} ready (${files.length} files, bundle ${manifest.bundle.size} bytes): ${out}`);

if(args.has('--publish')){
  const head=git('rev-parse','HEAD');git('fetch','-q','origin','main');
  if(git('rev-parse','origin/main')!==head)throw new Error('HEAD is not origin/main; push main first.');
  const uploads=[zipName,MANIFEST_NAME,SIGNATURE_NAME,manifest.bundle.name].map(n=>path.join(out,n));
  execFileSync('gh',['release','create','v'+version,'--repo','TianLin0509/ai-yuanzhuo-lite','--target',head,'--title',`AI圆桌lite v${version}`,'--notes-file',notesFile,'--latest',...uploads],{stdio:'inherit'});
  console.log('GitHub Release v'+version+' published.');
}
if(args.has('--mirror')){
  execFileSync('uv',['run','-q','--with','paramiko','python',path.join(root,'scripts','mirror_update.py'),out,manifest.bundle.name],{stdio:'inherit',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
}
