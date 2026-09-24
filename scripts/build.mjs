import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'dist');
if(fs.existsSync(out)&&fs.lstatSync(out).isSymbolicLink())throw new Error('dist must not be a link');
fs.mkdirSync(path.join(out,'vendor'),{recursive:true});
for(const name of fs.readdirSync(path.join(root,'src'))){const source=path.join(root,'src',name);if(fs.statSync(source).isFile())fs.copyFileSync(source,path.join(out,name));}
for(const [source,target] of [['node_modules/dompurify/dist/purify.min.js','purify.min.js'],['node_modules/marked/lib/marked.umd.js','marked.umd.js'],['node_modules/dompurify/LICENSE','DOMPurify-LICENSE'],['node_modules/marked/LICENSE','marked-LICENSE']])fs.copyFileSync(path.join(root,source),path.join(out,'vendor',target));
const manifest=JSON.parse(fs.readFileSync(path.join(out,'manifest.json'),'utf8')),pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(manifest.version!==pkg.version)throw new Error('Version mismatch');
// The running extension compares this stamp with the copy on disk to offer "update" after a merge.
let commit='unknown';try{commit=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();if(execFileSync('git',['status','--porcelain','--','src'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim())commit+='+';}catch{}
fs.writeFileSync(path.join(out,'build.json'),JSON.stringify({version:manifest.version,commit,builtAt:new Date().toISOString()})+'\n','utf8');
console.log(`Built ${manifest.name} ${manifest.version} (${commit}): ${out}`);
