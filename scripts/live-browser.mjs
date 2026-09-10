import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {launchNativeBrowser} from './native-browser.mjs';
import {providerFor} from '../src/core.js';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts');fs.mkdirSync(out,{recursive:true});
const metadataPath=path.join(out,'20260909-lite-live-native-browser-codex.json');
// Keep the earlier Playwright-owned live profile and all its logins untouched.
const profile=process.platform==='win32'?'C:\\VibeData\\BrowserProfiles\\AI-Yuanzhuo-Lite\\live-native':path.join(os.homedir(),'.ai-yuanzhuo-lite-native-browser');
if(fs.existsSync(metadataPath)){
  const previous=JSON.parse(fs.readFileSync(metadataPath,'utf8'));
  try{const response=await fetch(`http://127.0.0.1:${previous.cdpPort}/json/version`,{signal:AbortSignal.timeout(1200)});const version=await response.json();if(version.webSocketDebuggerUrl===previous.webSocketDebuggerUrl){console.log('The dedicated native live browser is already running:',metadataPath);process.exit(0);}}catch(error){console.log('Previous dedicated native browser is no longer reachable:',error.message);}
}
const {browser,context,metadata}=await launchNativeBrowser({profile,extension:path.join(root,'dist')});
// Persist ownership immediately, even when a later navigation/login step fails.
fs.writeFileSync(metadataPath,JSON.stringify({...metadata,login:'pending-user-login'},null,2)+'\n','utf8');
const isArenaWorker=worker=>worker.url().startsWith('chrome-extension:')&&worker.url().endsWith('/background.js');
let worker=context.serviceWorkers().find(isArenaWorker);if(!worker)worker=await context.waitForEvent('serviceworker',{predicate:isArenaWorker});
const extensionId=new URL(worker.url()).host;
const panel=context.pages()[0]||await context.newPage();await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);await panel.waitForSelector('#prompt');
const connect=await panel.evaluate(async()=>{const state=await chrome.runtime.sendMessage({type:'YZ_COMMAND',action:'state'});return chrome.runtime.sendMessage({type:'YZ_COMMAND',action:'connect',sessionId:state.session.id});});
if(!connect.ok)throw new Error(connect.error);
await panel.locator('#open-sidepanel').click();
Object.assign(metadata,{extensionId,login:'pending-user-login'});
fs.writeFileSync(metadataPath,JSON.stringify(metadata,null,2)+'\n','utf8');
console.log(JSON.stringify(metadata,null,2));
for(let i=0;i<30;i++){const page=context.pages().find(p=>providerFor(p.url())==='deepseek');if(page){await page.bringToFront();break;}await new Promise(resolve=>setTimeout(resolve,100));}
console.log('Native browser ready. Log in on DeepSeek, Kimi and Doubao. Existing live browser/profile are unchanged.');
console.log('Stopping this helper only disconnects automation; it does not close the native browser.');
browser.on('disconnected',()=>process.exit(0));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>process.exit(0));
await new Promise(()=>{});
