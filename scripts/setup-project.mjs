import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const result=spawnSync('git',['config','core.hooksPath','.githooks'],{cwd:root,stdio:'inherit'});
if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
console.log('project-prep hooks enabled. Future implementation belongs in a dedicated worktree.');
