// Installs the current build into one stable folder that Chrome loads once ("加载已解压的扩展程序").
// After each merge this mirrors dist there; the running extension notices the new build.json and
// offers an in-place update, so the extension ID and all saved roundtables stay the same.
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),dist=path.join(root,'dist');
const target=path.resolve(process.env.YZ_INSTALL_DIR||(process.platform==='win32'?'C:\\VibeData\\Extensions\\AI-Yuanzhuo-Lite':path.join(process.env.HOME||'.','.ai-yuanzhuo-lite-extension')));
const marker=path.join(target,'.ai-yuanzhuo-lite-install');
await import('./build.mjs');
// Only ever write into an empty folder or one this script created; never follow links.
if(fs.existsSync(target)){
  if(fs.lstatSync(target).isSymbolicLink())throw new Error('Install folder must not be a link: '+target);
  if(fs.readdirSync(target).length&&!fs.existsSync(marker))throw new Error('Install folder has other files and no install marker; refusing to touch it: '+target);
}
fs.mkdirSync(target,{recursive:true});fs.writeFileSync(marker,'Managed by ai-yuanzhuo-lite scripts/install-local.mjs\n','utf8');
const files=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const full=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Links are not allowed in the build: '+full);return e.isDirectory()?files(full):[full];});
const wanted=new Set(files(dist).map(f=>path.relative(dist,f)));
// Copy everything but the stamp first; write build.json last so the extension never sees a half-copied build as new.
for(const rel of [...wanted].filter(r=>r!=='build.json')){const to=path.join(target,rel);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(path.join(dist,rel),to);}
for(const full of files(target)){const rel=path.relative(target,full);if(rel==='.ai-yuanzhuo-lite-install'||wanted.has(rel))continue;fs.rmSync(full);}
fs.copyFileSync(path.join(dist,'build.json'),path.join(target,'build.json'));
const stamp=JSON.parse(fs.readFileSync(path.join(target,'build.json'),'utf8'));
console.log(`Installed ${stamp.version} (${stamp.commit}) to ${target}`);
