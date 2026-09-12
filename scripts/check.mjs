import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
function run(args){const started=Date.now();const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);console.log(`PASS ${args.join(' ')} (${Date.now()-started}ms)`);}
run(['scripts/build.mjs']);
for(const file of fs.readdirSync(path.join(root,'src')).filter(f=>f.endsWith('.js')))run(['--check','src/'+file]);
run(['--test',...fs.readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.mjs')).map(f=>'tests/'+f)]);
run(['tests/extension.mjs']);
run(['tests/desktop.mjs']);
run(['tests/native-desktop.mjs']);
run(['tests/native-background.mjs']);
