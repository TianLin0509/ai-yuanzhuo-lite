import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {launchNativeBrowser,enableExtensionDeveloperMode} from '../scripts/native-browser.mjs';
await import('../scripts/build.mjs');
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts','20260912-desktop-codex');fs.mkdirSync(out,{recursive:true});
const profiles=process.platform==='win32'?'C:/VibeData/BrowserProfiles/AI-Yuanzhuo-Lite/tests':os.tmpdir();fs.mkdirSync(profiles,{recursive:true});
const owned=await launchNativeBrowser({profile:fs.mkdtempSync(path.join(profiles,'native-desktop-')),extension:path.join(root,'dist')});
const {context,browser}=owned;const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,description){const start=Date.now();while(Date.now()-start<15000){if(await fn())return;await wait(100);}throw Error('Timed out: '+description);}
let socket;
try{
  await enableExtensionDeveloperMode(context);
  const isArena=w=>w.url().startsWith('chrome-extension:')&&w.url().endsWith('/background.js');let worker=context.serviceWorkers().find(isArena);if(!worker)worker=await context.waitForEvent('serviceworker',{predicate:isArena});const base=`chrome-extension://${new URL(worker.url()).host}/`;
  const page=context.pages()[0];await page.goto(base+'main.html');await page.waitForSelector('#prompt');await page.waitForFunction(()=>document.querySelector('#base-time').textContent.length>0);
  const windowId=(await page.evaluate(()=>chrome.tabs.getCurrent())).windowId;
  await page.bringToFront();await page.evaluate(id=>chrome.windows.update(id,{focused:true}),windowId);
  await page.locator('#prompt').fill('原生侧栏草稿 · GPT / 128\n保留多行。');
  await page.locator('#open-sidepanel').click({force:true});await until(()=>page.locator('#dock').isHidden(),'native sidepanel hides main composer');
  const contexts=await page.evaluate(()=>chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']}));assert(contexts.some(c=>c.documentUrl.endsWith('/sidepanel.html')),JSON.stringify({windowId,contexts}));
  const cdp=await browser.newBrowserCDPSession();const targets=(await cdp.send('Target.getTargets')).targetInfos;const target=targets.find(t=>t.url===base+'sidepanel.html');assert(target,'native sidebar target');
  socket=new WebSocket(owned.metadata.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let nextId=0;const pending=new Map();socket.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id&&pending.has(r.id)){const {resolve,reject,timer}=pending.get(r.id);clearTimeout(timer);pending.delete(r.id);r.error?reject(Error(r.error.message)):resolve(r.result);}});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const attach=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true}),sid=attach.sessionId;
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sid);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  assert.equal(await evaluate('chrome.windows.getCurrent().then(w=>w.id)'),windowId,'sidepanel own window (getContexts reports -1 for a global panel)');
  await until(async()=>(await evaluate('document.querySelector("#prompt")?.value'))==='原生侧栏草稿 · GPT / 128\n保留多行。','native panel draft');
  assert.equal(await evaluate('document.querySelectorAll(".answer").length'),0);
  // A freshly opened native panel can report innerHeight 0 before its first layout.
  await until(()=>evaluate('innerHeight>0'),'native panel layout');
  assert(await evaluate('(()=>{const r=document.querySelector("#send").getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()'),'native primary action stays visible');
  await evaluate('document.querySelector("#prompt").value="Native panel survives close 256";document.querySelector("#prompt").dispatchEvent(new Event("input",{bubbles:true}));');
  fs.writeFileSync(path.join(out,'20260912-native-sidepanel-codex.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'},sid)).data,'base64'));
  const sw=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.startsWith(base));await cdp.send('Target.closeTarget',{targetId:sw.targetId});
  await until(async()=>{const contexts=await page.evaluate(()=>chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']}));return contexts.length===1&&await page.locator('#dock').isHidden();},'native panel after worker restart');
  await page.evaluate(id=>chrome.sidePanel.close({windowId:id}),windowId);await until(()=>page.locator('#dock').isVisible(),'native sidepanel close');await until(async()=>(await page.locator('#prompt').inputValue())==='Native panel survives close 256','native draft restored');
  await page.screenshot({path:path.join(out,'20260912-native-main-codex.png')});
  fs.writeFileSync(path.join(out,'20260912-native-desktop-codex.json'),JSON.stringify({result:'PASS',windowId,contexts,checks:['Real SIDE_PANEL context in correct Chrome window','One visible composer across native main/sidebar','Draft shared without rewriting English/numbers/multiline','Worker restart and native sidepanel close restore main draft'],browser:owned.metadata.browser,scope:'Native Chrome UI only; no AI website messages'},null,2));console.log('PASS native Chrome sidepanel, draft, worker restart and close');
}catch(e){const p=context.pages().find(p=>p.url().includes('/main.html'));if(p){fs.writeFileSync(path.join(out,'20260912-native-desktop-failure-codex.json'),JSON.stringify(await p.evaluate(async()=>({session:await chrome.storage.session.get(null),contexts:await chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']}),error:document.querySelector('#error-banner')?.textContent,visibility:document.visibilityState,dockHidden:document.querySelector('#dock').hidden})),null,2));}throw e;}finally{socket?.close();await owned.close();}
