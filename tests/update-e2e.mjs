// One-click update, end to end in native Chrome (Windows): an installed build checks a local copy of the release
// sources (the "GitHub" one answers 404, as when Chrome is not signed in), the user clicks 立即更新 in the real side
// panel, Chrome's own folder dialog selects the install folder, the files are written and the extension reloads in
// place as the new version with its records kept. The release is signed with a test key; the install under test is
// the real build with only its key and source addresses swapped. No AI website is contacted.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {launchNativeBrowser,enableExtensionDeveloperMode} from '../scripts/native-browser.mjs';
import {packRelease} from './../scripts/update-pack.mjs';
if(process.platform!=='win32'){console.log('SKIP update-e2e: needs Windows for the native folder dialog');process.exit(0);}
await import('../scripts/build.mjs');
const root=path.resolve(import.meta.dirname,'..'),stamp=Date.now();
const work=path.join(root,'artifacts',`20261015-update-e2e-claude-${stamp}`);fs.mkdirSync(work,{recursive:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,what,ms=20000){const start=Date.now();for(;;){const v=await Promise.resolve().then(fn).catch(()=>false);if(v)return v;if(Date.now()-start>ms)throw new Error('Timed out: '+what);await wait(200);}}

// Test release key and local sources.
const {privateKey,publicKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
const pem=privateKey.export({type:'pkcs8',format:'pem'}),key=publicKey.export({type:'spki',format:'der'}).toString('base64');
const served=new Map();let requests=[];
const server=http.createServer((req,res)=>{const url=req.url.split('?')[0];requests.push(url);const origin=req.headers.origin||'*';const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Cache-Control':'no-store'};
  if(url.startsWith('/gh/')){res.writeHead(404,headers);res.end('Not Found');return;}
  const body=served.get(url);if(!body){res.writeHead(404,headers);res.end();return;}res.writeHead(200,{...headers,'Content-Length':body.length});res.end(body);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
function patchUpdateCore(dir){const f=path.join(dir,'update-core.js');let s=fs.readFileSync(f,'utf8');
  s=s.replace(/export const UPDATE_KEY='[^']+';/,`export const UPDATE_KEY='${key}';`).replace('https://github.com/TianLin0509/ai-yuanzhuo-lite/releases/latest/download/',`http://127.0.0.1:${port}/gh/`).replace('https://me.lt-stockpartner.tech/pptutor/yuanzhuo-lite/',`http://127.0.0.1:${port}/backup/`);
  assert(s.includes(`/backup/`)&&s.includes(key),'update-core patched');fs.writeFileSync(f,s);}
const dist=path.join(root,'dist'),installed=path.join(work,'install'),next=path.join(work,'next');
fs.cpSync(dist,installed,{recursive:true});patchUpdateCore(installed);
fs.cpSync(dist,next,{recursive:true});patchUpdateCore(next);
const oldVersion=JSON.parse(fs.readFileSync(path.join(installed,'manifest.json'),'utf8')).version,newVersion=oldVersion.replace(/\d+$/,n=>String(Number(n)+90));
for(const f of ['manifest.json','build.json']){const p=path.join(next,f),j=JSON.parse(fs.readFileSync(p,'utf8'));j.version=newVersion;if(f==='build.json'){j.builtAt=new Date().toISOString();j.commit='e2e';}fs.writeFileSync(p,JSON.stringify(j,null,f==='manifest.json'?2:0)+'\n');}
fs.writeFileSync(path.join(next,'update-e2e-marker.txt'),'written by the one-click update\n');
const {assets}=packRelease({distDir:next,notes:'端到端测试版本\n第二行说明',privateKeyPem:pem});
for(const [name,data] of Object.entries(assets))served.set('/backup/'+name,data);

const profile=path.join('C:/VibeData/BrowserProfiles/AI-Yuanzhuo-Lite/tests',`update-e2e-${stamp}`);
const evidence={result:'FAIL',oldVersion,newVersion,checks:[]};const t0=Date.now();const log=c=>{evidence.checks.push(c);console.log(((Date.now()-t0)/1000).toFixed(1)+'s',c);};
const extensionId=async context=>{const isArena=w=>w.url().startsWith('chrome-extension:')&&w.url().endsWith('/background.js');const w=context.serviceWorkers().find(isArena)||await context.waitForEvent('serviceworker',{predicate:isArena});return new URL(w.url()).host;};
let owned,inPanel,shot;
try{
  // First start: learn the extension id and leave a record that must survive the update.
  owned=await launchNativeBrowser({profile,extension:installed});
  await enableExtensionDeveloperMode(owned.context);
  const id=await extensionId(owned.context);
  const page=owned.context.pages()[0];await page.goto(`chrome-extension://${id}/main.html`);await page.waitForSelector('#prompt');
  await page.evaluate(()=>chrome.storage.local.set({'e2e.keep':'圆桌记录'}));
  await owned.close();owned=null;
  // Chrome opens its folder dialog in the folder last picked for this id; point it at the install folder.
  const prefsFile=path.join(profile,'Default','Preferences'),prefs=JSON.parse(fs.readFileSync(prefsFile,'utf8')),entry={'display-name':path.basename(installed),path:installed,'path-type':0,timestamp:String(Date.now()*1000)};
  prefs.profile??={};prefs.profile.content_settings??={};prefs.profile.content_settings.exceptions??={};
  prefs.profile.content_settings.exceptions.file_system_last_picked_directory={[`chrome-extension://${id}/,*`]:{last_modified:String(Date.now()*1000),setting:{'custom-id-ai-yuanzhuo-lite-install':entry,'default-id':entry}}};
  fs.writeFileSync(prefsFile,JSON.stringify(prefs));

  owned=await launchNativeBrowser({profile,extension:installed});
  const {context,metadata}=owned;assert.equal(await extensionId(context),id);
  const main=context.pages()[0];await main.goto(`chrome-extension://${id}/main.html`);await main.waitForSelector('#prompt');
  await main.locator('#open-sidepanel').click({force:true});
  const panel=await until(async()=>(await (await fetch(`http://127.0.0.1:${metadata.cdpPort}/json/list`)).json()).find(t=>t.url===`chrome-extension://${id}/sidepanel.html`),'side panel target');
  const ws=new WebSocket(panel.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0;const pending=new Map();ws.onmessage=m=>{const d=JSON.parse(m.data);pending.get(d.id)?.(d);pending.delete(d.id);};
  const cdp=(method,params={})=>new Promise((r,j)=>{const i=++seq;const t=setTimeout(()=>{pending.delete(i);j(new Error('CDP timeout '+method));},10000);pending.set(i,d=>{clearTimeout(t);r(d);});ws.send(JSON.stringify({id:i,method,params}));});
  // userGesture: a real click, which Chrome requires before it shows the folder dialog.
  inPanel=async expr=>(await cdp('Runtime.evaluate',{expression:expr,userGesture:true,awaitPromise:true,returnByValue:true})).result?.result?.value;
  await until(()=>inPanel(`!!document.querySelector('.app-version[role=button]')`),'version pill is a button');
  await inPanel(`document.querySelector('.app-version').click()`);
  const offered=await until(async()=>{const t=await inPanel(`document.querySelector('#dialog[open] .update-box')?.innerText||''`);return t.includes('v'+newVersion)&&t.includes('立即更新')&&t;},'dialog offers the new version');
  assert.match(offered,/端到端测试版本/);assert.match(offered,/备用服务器：可用/);assert.match(offered,/GitHub：/);
  log('Version pill opens the update dialog; it shows the new version, its notes and why GitHub failed (404 as when not signed in) before the backup server answered');
  shot=async name=>{const r=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(work,name),Buffer.from(r.result.data,'base64'));};
  await shot('01-offer.png');
  assert.equal(await inPanel(`(()=>{const b=document.querySelector('#error-banner');return b&&!b.hidden?b.textContent:''})()`),'','side panel shows no error');
  const headerButton=await inPanel(`(()=>{const b=document.querySelector('#update');return b&&!b.hidden?b.textContent:''})()`);
  assert.equal(headerButton,'可更新');log('Header shows a 可更新 button once a newer release is known');
  // A round running in another window: nothing may be written (the service worker answers canUpdate with an error).
  const before=fs.readFileSync(path.join(installed,'manifest.json'),'utf8');
  await inPanel(`(()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);window.__realSend=send;chrome.runtime.sendMessage=(m,...r)=>m&&m.action==='canUpdate'?Promise.resolve({ok:false,error:'还有进行中的圆桌（可能在其他窗口），请等本轮结束或停止后再更新。'}):send(m,...r);return true;})()`);
  await inPanel(`document.querySelector('[data-up=install]').click()`);
  const refused=await until(async()=>{const t=await inPanel(`document.querySelector('.update-error')?.innerText||''`);return /进行中的圆桌/.test(t)&&t;},'update refused while a round runs elsewhere');
  await wait(1500);
  assert.equal(fs.readFileSync(path.join(installed,'manifest.json'),'utf8'),before,'nothing written');
  let dialogOpen=true;try{execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tests','helpers','dialog-button.ps1'),'-procId',String(metadata.browserPid),'-name','选择文件夹'],{encoding:'utf8'});}catch(error){dialogOpen=!String(error.stdout).includes('NOTFOUND');}
  assert.equal(dialogOpen,false,'no folder dialog was opened');
  log('A round running in another window blocks the update before the folder dialog; nothing is written ('+refused.trim()+')');
  await inPanel(`(()=>{chrome.runtime.sendMessage=window.__realSend;return true;})()`);
  requests=[];
  await inPanel(`document.querySelector('[data-up=install]').click()`);
  // Chrome's folder dialog opens in the install folder; press its 选择文件夹 button.
  await until(()=>Promise.resolve(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tests','helpers','dialog-button.ps1'),'-procId',String(metadata.browserPid),'-name','选择文件夹'],{encoding:'utf8'}).includes('CLICKED')).catch(()=>false),'folder dialog',15000);
  log('立即更新 asks for the folder with Chrome\'s own dialog (opened from the side panel)');
  const clickedAt=Date.now();const watcher=setInterval(async()=>{try{const t=await inPanel(`document.querySelector('.update-progress p,.update-error')?.innerText||''`);const recent=fs.readdirSync(installed).filter(n=>fs.statSync(path.join(installed,n)).mtimeMs>clickedAt);console.log('  progress:',t,'| written:',recent.length);}catch(e){console.log('  watch error',e.message);}},1000);
  await until(()=>JSON.parse(fs.readFileSync(path.join(installed,'manifest.json'),'utf8')).version===newVersion,'new manifest written');
  clearInterval(watcher);
  const released=JSON.parse(assets['update-manifest.json']).files,onDisk=f=>{try{return crypto.createHash('sha256').update(fs.readFileSync(path.join(installed,f.path))).digest('hex')===f.sha256;}catch{return false;}};
  await until(()=>released.every(onDisk),'every released file on disk',30000);
  log(`Writing finished ${((Date.now()-clickedAt)/1000).toFixed(1)} s after 立即更新`);
  log('Every released file is on disk byte for byte, including a new file in the release');
  assert(requests.includes('/backup/'+JSON.parse(assets['update-manifest.json']).bundle.name),'bundle downloaded from the backup source');
  // The extension reloads itself in place: same id, new version, records kept.
  const reloaded=await until(async()=>{const w=context.serviceWorkers().find(w=>w.url()===`chrome-extension://${id}/background.js`);if(!w)return false;const v=await w.evaluate(()=>chrome.runtime.getManifest().version).catch(()=>'');return v===newVersion&&w;},'extension reloaded as the new version',30000);
  const kept=await reloaded.evaluate(()=>chrome.storage.local.get('e2e.keep'));assert.equal(kept['e2e.keep'],'圆桌记录');
  log('The extension reloaded in place: same id, now v'+newVersion+', saved records kept');
  const after=await context.newPage();await after.goto(`chrome-extension://${id}/main.html`);await after.waitForSelector('#prompt');
  assert.equal(await after.locator('.app-version').first().textContent(),'v'+newVersion);
  await after.locator('.app-version').first().click();await after.waitForSelector('#dialog[open] .update-box');
  await until(async()=>/已是最新版本/.test(await after.locator('.update-box').innerText()),'dialog says up to date after updating');
  await after.screenshot({path:path.join(work,'02-after.png')});
  assert.equal(await after.locator('#error-banner').isVisible()?await after.locator('#error-banner').textContent():'','','main page shows no error');
  log('After the update the page shows v'+newVersion+' and the dialog reports 已是最新版本');
  ws.close();evidence.result='PASS';
}catch(error){
  evidence.error=error.message;try{evidence.dialog=await inPanel?.(`document.querySelector('#dialog')?.innerText||document.body.innerText.slice(0,500)`);await shot?.('99-failure.png');}catch{}
  throw error;
}finally{
  server.close();if(owned)await owned.close().catch(e=>console.error(e.message));
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify(evidence,null,2));
}
console.log(JSON.stringify(evidence,null,1));console.log('Evidence:',work);
