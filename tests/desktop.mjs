import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../scripts/browser-config.mjs';
import {fixture} from './fixture.mjs';
import {newSession,makeRound,PROVIDERS,DEFAULT_MEMBERS,providerFor} from '../src/core.js';
await import('../scripts/build.mjs');
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts','20260912-desktop-codex');fs.mkdirSync(out,{recursive:true});
const profileRoot=process.platform==='win32'?'C:/VibeData/BrowserProfiles/AI-Yuanzhuo-Lite/tests':os.tmpdir();fs.mkdirSync(profileRoot,{recursive:true});
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(profileRoot,'desktop-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${path.join(root,'dist')}`,`--load-extension=${path.join(root,'dist')}`],viewport:{width:1440,height:1000}});
const failures=[],checks=[];context.on('page',p=>p.on('pageerror',e=>failures.push(e.message)));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,description){const start=Date.now();while(Date.now()-start<15000){if(await fn())return;await wait(80);}throw Error('Timed out: '+description);}
const command=(p,action,data={})=>p.evaluate(async({action,data})=>{const r=await chrome.runtime.sendMessage({type:'YZ_COMMAND',action,...data});if(!r?.ok)throw Error(r?.error||'No response');return r;},{action,data});
try{
  await context.route('https://**/*',route=>{const provider=providerFor(route.request().url());return provider?route.fulfill({contentType:'text/html',body:fixture(provider)}):route.abort();});
  let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');const extensionId=new URL(worker.url()).host,base=`chrome-extension://${extensionId}/`;
  const page=await context.newPage();await page.goto(base+'main.html');await until(async()=>!!(await command(page,'state')).session,'initial state');
  const initial=await command(page,'state'),s=newSession([...DEFAULT_MEMBERS]);s.id=initial.session.id;s.title='桌面圆桌 · 三种阅读方式';
  const samples=[['主界面和侧栏应该怎样分工？','ask'],['比较其他两家的方案，重点讨论重复信息。','discuss'],['请 Kimi 总结已确认的设计。','summary']];
  for(const [i,[prompt,kind]] of samples.entries()){
    const r=makeRound(kind,prompt,s,{captain:'kimi'});r.createdAt=Date.now()-(samples.length-i)*60000;
    for(const j of r.jobs)Object.assign(j,{status:'done',format:'markdown',text:`## ${PROVIDERS[j.provider].name} 的观点\n\n保留提问时间，主界面集中阅读同一轮记录。\n\n### 核心操作\n\n1. 回看历史不替换下一轮材料。\n2. 三种视图共用完整回答。\n\n\`\`\`js\nconst value = "<safe>";\n\`\`\`\n\n[不允许脚本链接](javascript:alert(1))\n\n${j.provider}_ROUND_${i}_END`,url:PROVIDERS[j.provider].url,phase:'attempted',baseline:{count:0,url:PROVIDERS[j.provider].url}});
    s.rounds.push(r);
  }
  // Seed deterministic reading records before first adoption; site sending is covered separately.
  await page.evaluate(async s=>{const data=await chrome.storage.local.get('arena.index'),index=data['arena.index'];index.sessions[0]={id:s.id,title:s.title,rounds:s.rounds.length,updatedAt:Date.now()};await chrome.storage.local.set({['arena.session.'+s.id]:s,'arena.index':index});},s);
  // Reload the worker to force it to read the persisted records, as after a browser restart.
  const cdp=await context.browser().newBrowserCDPSession();
  const targets=(await cdp.send('Target.getTargets')).targetInfos;const sw=targets.find(t=>t.url===worker.url());await cdp.send('Target.closeTarget',{targetId:sw.targetId});
  await page.reload();await page.waitForSelector('.answer');
  assert.equal(await page.locator('[data-layout="a"]').getAttribute('aria-pressed'),'true');
  await page.locator(`[data-round="${s.rounds[0].id}"]`).click();assert.equal(await page.locator('.base-round').getAttribute('data-base-id'),s.rounds[2].id);
  for(const layout of ['a','b','c']){
    await page.locator(`[data-layout="${layout}"]`).click();await page.waitForSelector('.layout-'+layout);
    if(layout==='a'){await page.locator('[data-ai="kimi"]').click();assert((await page.locator('.text').innerText()).includes('kimi_ROUND_0_END'));}
    if(layout==='b'){await page.locator('#pair-left').selectOption('doubao');await page.locator('#pair-right').selectOption('doubao');assert.equal(await page.locator('#pair-left').inputValue(),'kimi');assert.equal(await page.locator('.answer').count(),2);}
    if(layout==='c'){assert.equal(await page.locator('.answer[open]').count(),0);await page.locator('.answer summary').nth(0).click();await page.locator('.answer summary').nth(1).click();assert.equal(await page.locator('.answer[open]').count(),2);}
    assert.equal(await page.locator('a[href^="javascript:"]').count(),0);
    await page.screenshot({path:path.join(out,`20260912-desktop-${layout}-codex.png`)});
    assert.equal(await page.locator('.time-item.selected').getAttribute('data-round'),s.rounds[0].id);
  }
  await page.reload();await page.waitForSelector('.layout-c');assert.equal(await page.locator('.answer[open]').count(),2);checks.push('A default; A/B/C use same full records; B swap; C multi-expand and reload preference; Markdown sanitization');
  await page.locator('#time-search').fill('kimi_ROUND_0_END');assert.equal(await page.locator('.time-item').count(),1);await page.locator('#time-search').fill('');
  const panel=await context.newPage();await panel.goto(base+'sidepanel.html');await panel.waitForSelector('#prompt');await until(()=>page.locator('#dock').isHidden(),'one controller');assert.equal(await panel.locator('.answer').count(),0);
  await panel.locator('#prompt').fill('侧栏草稿\n英文 GPT 与数字 128 保留。');await until(async()=>(await command(panel,'state')).draft.text.includes('128'),'draft persisted');
  await page.locator('.answer[open] [data-read="quote"]').first().click();await until(async()=>(await panel.locator('#prompt').inputValue()).includes('deepseek_ROUND_0_END'),'full quote');assert((await panel.locator('#prompt').inputValue()).startsWith('侧栏草稿'));
  assert.equal(await panel.locator('.base-round').getAttribute('data-base-id'),s.rounds[2].id);const draft=await panel.locator('#prompt').inputValue();
  // A background restart must reconnect the panel and then release the main dock on close.
  const swNow=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.type==='service_worker'&&t.url.startsWith(base));await cdp.send('Target.closeTarget',{targetId:swNow.targetId});
  await until(async()=>{const data=await page.evaluate(()=>chrome.storage.session.get(null));return Object.entries(data).some(([k,v])=>k.startsWith('arena.panel.')&&v===true);},'panel reconnect');
  await panel.locator('#prompt').fill(draft+'\n快速输入立即关闭：TAIL');await panel.close();await until(()=>page.locator('#dock').isVisible(),'closed panel releases dock');
  await until(async()=>(await page.locator('#prompt').inputValue()).endsWith('TAIL'),'draft survives immediate close');checks.push('Main history remains separate from send baseline; panel only operations; atomic full quote; worker restart; draft survives immediate close');
  await page.evaluate(()=>{const original=chrome.runtime.sendMessage.bind(chrome.runtime);window.__holdNextState=true;chrome.runtime.sendMessage=async message=>{const result=await original(message);if(message.action==='state'&&window.__holdNextState){window.__holdNextState=false;window.__stateHeld=true;await new Promise(r=>{window.__releaseState=r;});}return result;};return chrome.storage.local.set({'arena.preferences':{layout:'a'}});});
  await until(()=>page.evaluate(()=>!!window.__stateHeld),'old state response held');await page.locator('#prompt').fill('新草稿不能被旧回包覆盖 512');await until(async()=>(await command(page,'state')).draft.text.endsWith('512'),'newer draft saved');await page.evaluate(()=>window.__releaseState());await until(async()=>(await page.locator('#prompt').inputValue()).endsWith('512'),'newer draft remains after old state');
  checks.push('Delayed stale state response cannot revert an acknowledged draft');
  await command(page,'connect',{sessionId:s.id});const firstState=await command(page,'state'),oldBindings=structuredClone(firstState.session.bindings),oldWindow=(await page.evaluate(()=>chrome.tabs.getCurrent())).windowId;
  await page.locator('#new').click();await page.locator('[data-new="window"]').click();let second;
  await until(async()=>{second=context.pages().find(p=>p!==page&&p.url().startsWith(base+'main.html?'));return !!second;},'new roundtable window');await second.waitForSelector('#prompt');
  const secondState=await command(second,'state');assert.notEqual(secondState.session.id,s.id);assert.equal(secondState.session.rounds.length,0);assert.equal(secondState.draft.text,'');
  await until(async()=>Object.keys((await command(second,'state')).session.bindings).length===3,'three own tabs');const secondWindow=(await second.evaluate(()=>chrome.tabs.getCurrent())).windowId;assert.notEqual(secondWindow,oldWindow);
  const secondBindings=(await command(second,'state')).session.bindings;for(const b of Object.values(secondBindings)){const tab=await second.evaluate(id=>chrome.tabs.get(id),b.tabId);assert.equal(tab.windowId,secondWindow);assert(!Object.values(oldBindings).some(old=>old.tabId===b.tabId));}
  await assert.rejects(()=>command(second,'start',{sessionId:s.id,kind:'ask',text:'MUST NOT SEND'}),/跨窗口/);
  assert.deepEqual((await command(page,'state')).session.bindings,oldBindings);assert.equal((await command(page,'state')).session.rounds.length,3);
  await second.locator('#prompt').fill('第二个窗口独立草稿');await until(async()=>(await command(second,'state')).draft.text==='第二个窗口独立草稿','window two draft');
  await second.evaluate(id=>chrome.windows.remove(id),secondWindow).catch(e=>{if(!/closed/i.test(e.message))throw e;});await until(async()=>!(await page.evaluate(()=>chrome.windows.getAll())).some(w=>w.id===secondWindow),'window closed');
  const reopened=await command(page,'select',{sessionId:secondState.session.id});assert.notEqual(reopened.opened.windowId,oldWindow);await until(()=>context.pages().some(p=>p.url().includes(secondState.session.id)),'history reopen');
  const restored=context.pages().find(p=>p.url().includes(secondState.session.id));await restored.waitForSelector('#prompt');await until(async()=>(await restored.locator('#prompt').inputValue())==='第二个窗口独立草稿','reopened draft');assert.equal((await command(page,'state')).session.id,s.id);
  checks.push('Actual separate Chrome windows; three owned provider tabs; cross-window SEND denied; close/reopen preserves draft and original window');
  for(const width of [375,768,1024,1440,1920]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`overflow ${width}`);}
  assert.deepEqual(failures,[]);fs.writeFileSync(path.join(out,'20260912-desktop-checks-codex.json'),JSON.stringify({result:'PASS',checks,failures,scope:'Real extension with deterministic stored records and fixture provider pages; not live websites'},null,2));console.log(JSON.stringify({result:'PASS',checks}));
}catch(e){for(const p of context.pages().filter(p=>p.url().includes('/main.html'))){await p.screenshot({path:path.join(out,'20260912-desktop-failure-codex.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'20260912-desktop-failure-codex.json'),JSON.stringify(await p.evaluate(async()=>({storage:await chrome.storage.local.get(null),backup:{...localStorage},error:document.querySelector('#error-banner').textContent})),null,2));break;}throw e;}finally{await context.close();}
