// 关闭圆桌 while member pages ask "leave site?" (beforeunload): Chrome holds the close until the user answers, and the
// record page meanwhile reloads on the empty roundtable it leaves. That empty roundtable must not open member pages by
// itself (found in the 0.8.0 merge review: 2 of 2 runs opened three new pages before the fix).
// Real MV3 with fixture pages; DNS is blocked so no AI site is contacted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../scripts/browser-config.mjs';
import {fixture} from './fixture.mjs';
import {PROVIDERS,providerFor} from '../src/core.js';
await import('../scripts/build.mjs');
const root=path.resolve(import.meta.dirname,'..');
const profileRoot=process.platform==='win32'?'C:/VibeData/BrowserProfiles/AI-Yuanzhuo-Lite/tests':os.tmpdir();fs.mkdirSync(profileRoot,{recursive:true});
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(profileRoot,'close-quiet-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${path.join(root,'dist')}`,`--load-extension=${path.join(root,'dist')}`,'--host-resolver-rules=MAP * ~NOTFOUND']});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,d,t=15000){const s=Date.now();while(Date.now()-s<t){try{if(await fn())return;}catch{}await wait(100);}throw Error('Timed out: '+d);}
try{
  await context.route('https://**/*',route=>{const p=providerFor(route.request().url());return p?route.fulfill({contentType:'text/html',body:fixture(p)+'<script>addEventListener("beforeunload",e=>{e.preventDefault();e.returnValue="";});</script>'}):route.abort();});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const base=`chrome-extension://${new URL(worker.url()).host}/`;
  const page=await context.newPage();await page.goto(base+'main.html');
  const ctl=await context.newPage();await ctl.goto(base+'sidepanel.html');
  const command=(action,data={})=>ctl.evaluate(async({action,data})=>{const windowId=(await chrome.windows.getCurrent()).id;const r=await chrome.runtime.sendMessage({type:'YZ_COMMAND',windowId,action,...data});if(!r?.ok)throw Error(r?.error);return r;},{action,data});
  const windowId=await ctl.evaluate(async()=>(await chrome.windows.getCurrent()).id);
  const providerTabs=async()=>(await ctl.evaluate(id=>chrome.tabs.query({windowId:id}),windowId)).filter(t=>providerFor(t.url||t.pendingUrl));
  await until(async()=>(await providerTabs()).length===3,'3 member pages on load');
  const s=await command('state');
  for(const p of s.session.members)await ctl.evaluate(({id,url})=>chrome.tabs.update(id,{url}),{id:s.session.bindings[p].tabId,url:PROVIDERS[p].url});
  let first;await until(async()=>{first=context.pages().find(x=>providerFor(x.url())===s.session.members[0]);return !!first&&await first.evaluate(()=>!!globalThis.__fixture).catch(()=>false);},'fixture loaded');
  await until(async()=>(await providerTabs()).every(t=>t.status==='complete'&&providerFor(t.url)),'all fixtures');
  for(const p of context.pages())p.on('dialog',d=>setTimeout(()=>d.accept().catch(()=>{}),2500));// the user takes 2.5 s to answer "leave site?"
  const before=(await providerTabs()).map(t=>t.id);
  await command('close-here');await wait(3500);
  const after=await providerTabs(),st=await command('state');
  assert.notEqual(st.session.id,s.session.id,'the window moved to an empty roundtable');
  assert.deepEqual(after.filter(t=>!before.includes(t.id)).map(t=>t.url),[],'the empty roundtable opened no member pages by itself');
  assert(Object.values(st.session.bindings||{}).every(b=>!b.tabId),'no member of the empty roundtable is bound to a page');
  console.log(JSON.stringify({result:'PASS',checks:['关闭圆桌 with pages asking "leave site?": the empty roundtable it leaves opens no member pages']}));
}finally{await context.close();}
