import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {chromium} from './browser-config.mjs';
import {providerFor} from '../src/core.js';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts');fs.mkdirSync(out,{recursive:true});
const metadataPath=path.join(out,'20260909-lite-live-browser-codex.json');
const profile=process.platform==='win32'?'C:\\VibeData\\BrowserProfiles\\AI-Yuanzhuo-Lite\\live':path.join(os.homedir(),'.ai-yuanzhuo-lite-browser');
if(fs.existsSync(metadataPath)){
  const previous=JSON.parse(fs.readFileSync(metadataPath,'utf8'));
  try{const response=await fetch(`http://127.0.0.1:${previous.cdpPort}/json/version`,{signal:AbortSignal.timeout(1200)});const version=await response.json();if(version.webSocketDebuggerUrl===previous.webSocketDebuggerUrl){console.log('The dedicated live browser is already running:',metadataPath);process.exit(0);}}catch(error){console.log('Previous dedicated browser is no longer reachable:',error.message);}
}
fs.mkdirSync(profile,{recursive:true});
const cdpPort=await new Promise((resolve,reject)=>{const server=net.createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});
const extension=path.join(root,'dist');
if(!fs.existsSync(path.join(extension,'manifest.json')))throw new Error('Run npm run build first.');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,viewport:null,ignoreDefaultArgs:['--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,`--remote-debugging-port=${cdpPort}`,'--remote-debugging-address=127.0.0.1','--window-size=1460,1040']});
let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');
const extensionId=new URL(worker.url()).host;
const panel=context.pages()[0]||await context.newPage();await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);await panel.waitForSelector('#prompt');
const connect=await panel.evaluate(async()=>{const state=await chrome.runtime.sendMessage({type:'YZ_COMMAND',action:'state'});return chrome.runtime.sendMessage({type:'YZ_COMMAND',action:'connect',sessionId:state.session.id});});
if(!connect.ok)throw new Error(connect.error);
await panel.locator('#open-sidepanel').click();
const version=await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
const metadata={startedAt:new Date().toISOString(),helperPid:process.pid,profile,extension,extensionId,cdpPort,webSocketDebuggerUrl:version.webSocketDebuggerUrl,browser:version.Browser,login:'pending-user-login'};
fs.writeFileSync(metadataPath,JSON.stringify(metadata,null,2)+'\n','utf8');
console.log(JSON.stringify(metadata,null,2));
for(let i=0;i<30;i++){const page=context.pages().find(p=>providerFor(p.url())==='deepseek');if(page){await page.bringToFront();break;}await new Promise(resolve=>setTimeout(resolve,100));}
console.log('Dedicated browser is ready. Log in on DeepSeek, Kimi and Doubao. Leave this helper running.');
context.on('close',()=>process.exit(0));
process.on('SIGTERM',()=>context.close().catch(error=>{console.error(error);process.exitCode=1;}));
await new Promise(()=>{});
