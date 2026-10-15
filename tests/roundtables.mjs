// Close / new / recover roundtables inside one window, cross-window history and editable presets,
// driven through the real extension UI with fixture provider pages (not live websites).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../scripts/browser-config.mjs';
import {fixture} from './fixture.mjs';
import {newSession,makeRound,PROVIDERS,DEFAULT_MEMBERS,providerFor,cleanUrl} from '../src/core.js';
await import('../scripts/build.mjs');
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts');fs.mkdirSync(out,{recursive:true});
const profileRoot=process.platform==='win32'?'C:/VibeData/BrowserProfiles/AI-Yuanzhuo-Lite/tests':os.tmpdir();fs.mkdirSync(profileRoot,{recursive:true});
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(profileRoot,'roundtables-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${path.join(root,'dist')}`,`--load-extension=${path.join(root,'dist')}`,'--host-resolver-rules=MAP * ~NOTFOUND'],viewport:{width:1280,height:900}});
const failures=[],checks=[];context.on('page',p=>p.on('pageerror',e=>failures.push(e.message+' @ '+p.url())));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
// The record page reloads when its window changes roundtable, so a check may land mid-navigation.
async function until(fn,description,timeout=15000){const start=Date.now();let last;while(Date.now()-start<timeout){try{if(await fn())return;}catch(e){last=e;}await wait(100);}throw Error("Timed out: "+description+(last?" ("+last.message+")":""));}
try{
  // Tabs the extension opens load before Playwright can intercept them; DNS is blocked so they never reach the real sites.
  await context.route('https://**/*',route=>{const provider=providerFor(route.request().url());return provider?route.fulfill({contentType:'text/html',body:fixture(provider)}):route.abort();});
  let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');const base=`chrome-extension://${new URL(worker.url()).host}/`;
  const page=await context.newPage();await page.goto(base+'main.html');
  const command=(action,data={})=>page.evaluate(async({action,data})=>{const windowId=(await chrome.windows.getCurrent()).id;const r=await chrome.runtime.sendMessage({type:'YZ_COMMAND',windowId,action,...data});if(!r?.ok)throw Error(r?.error||'No response');return r;},{action,data});
  await until(async()=>!!(await command('state')).session,'initial state');
  const windowId=await page.evaluate(async()=>(await chrome.windows.getCurrent()).id);
  const providerTabs=async()=>(await page.evaluate(id=>chrome.tabs.query({windowId:id}),windowId)).filter(t=>providerFor(t.url||t.pendingUrl));

  // The record page opens its members' pages by itself; this test replaces that roundtable, so close them below.
  await until(async()=>(await providerTabs()).length===3,'member pages opened on load');const firstPages=(await providerTabs()).map(t=>t.id);
  // A finished roundtable whose members were in saved conversations.
  const initial=await command('state'),s=newSession([...DEFAULT_MEMBERS]);s.id=initial.session.id;s.title='找回测试 · 旧圆桌';
  const r=makeRound('ask','旧圆桌的问题',s);r.createdAt=Date.now()-5*60000;s.createdAt=r.createdAt-60000;
  const conversation={deepseek:'https://chat.deepseek.com/a/chat/s/rt-deepseek-1',kimi:'https://www.kimi.com/chat/rt-kimi-1',doubao:'https://www.doubao.com/chat/123456789'};
  for(const j of r.jobs)Object.assign(j,{status:'done',text:j.provider+'_OLD_ANSWER',url:conversation[j.provider],updatedAt:r.createdAt+30000});
  s.rounds.push(r);s.bindings=Object.fromEntries(Object.entries(conversation).map(([p,url])=>[p,{url}]));
  await page.evaluate(async s=>{const data=await chrome.storage.local.get('arena.index'),index=data['arena.index'];index.sessions[0]={id:s.id,title:s.title,rounds:1,updatedAt:Date.now()-5*60000};await chrome.storage.local.set({['arena.session.'+s.id]:s,'arena.index':index});},s);
  const cdp=await context.browser().newBrowserCDPSession();const sw=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===worker.url());await cdp.send('Target.closeTarget',{targetId:sw.targetId});
  await page.evaluate(ids=>chrome.tabs.remove(ids),firstPages);
  await page.reload();await until(async()=>(await command('state')).session.rounds.length===1,'seeded record');
  const migrated=(await command('state')).index.sessions.find(m=>m.id===s.id);assert.deepEqual(migrated.members,DEFAULT_MEMBERS);assert(migrated.createdAt);
  checks.push('Older index entries gain members and creation time without losing their order');

  await command('connect');await until(async()=>(await providerTabs()).length===3,'members connected');
  for(const tab of await providerTabs())assert.equal(cleanUrl(tab.url||tab.pendingUrl),cleanUrl(conversation[providerFor(tab.url||tab.pendingUrl)]));

  // 1. Close this roundtable from the UI: its AI tabs close, the record stays, the window gets an empty one.
  const unrelated=await context.newPage();await unrelated.goto('https://chat.deepseek.com/unrelated-user-tab');
  await page.locator('#close-roundtable').click();await page.locator('#close-confirm').click();
  await until(async()=>(await command('state')).session.id!==s.id,'window moved to an empty roundtable');
  const empty=(await command('state')).session;assert.equal(empty.rounds.length,0);
  await until(async()=>(await providerTabs()).every(t=>(t.url||'').includes('unrelated-user-tab')),'member tabs closed, unrelated tab kept');
  assert(context.pages().includes(unrelated)&&!unrelated.isClosed(),'a tab the roundtable did not open stays open');
  await until(()=>page.url().includes(encodeURIComponent(empty.id)),'record page follows the window');
  await page.waitForTimeout(1500);assert((await providerTabs()).every(t=>(t.url||'').includes('unrelated-user-tab')),'the empty roundtable left by closing does not open member pages by itself');
  const kept=await page.evaluate(id=>chrome.storage.local.get('arena.session.'+id).then(d=>d['arena.session.'+id]),s.id);
  assert.equal(kept.rounds[0].jobs[0].text,'deepseek_OLD_ANSWER');for(const [p,b] of Object.entries(kept.bindings)){assert.equal(b.tabId,undefined);assert.equal(b.url,conversation[p]);}
  checks.push('Close keeps the full record and conversation URLs, closes only its own AI tabs, and leaves an empty roundtable in the window');

  // 2. History lists every roundtable with relative time; recover the old one into this window.
  await page.locator('#history').click();await page.waitForSelector('.history-row');
  const row=page.locator('.history-row',{hasText:'找回测试'});assert.match(await row.locator('time').innerText(),/分钟前/);
  assert.equal(await page.locator('.history-list .date-group').first().innerText(),'今天');assert(await row.innerText().then(t=>t.includes('DeepSeek、Kimi、豆包')));
  assert.equal(await page.locator('.history-row',{hasText:'新的圆桌'}).locator('.badge').innerText(),'当前');
  await row.locator('[data-open-here]').click();
  // The saved 豆包 chat can no longer be loaded: like the real site, its tab lands on a new chat.
  let bounced;await until(async()=>(bounced=(await providerTabs()).find(t=>(t.url||'').includes('/chat/123456789'))),'豆包 tab reopened');await page.evaluate(id=>chrome.tabs.update(id,{url:'https://www.doubao.com/chat/'}),bounced.id);
  await until(async()=>(await command('state')).session.id===s.id,'recovered roundtable owns the window');
  await until(async()=>(await providerTabs()).filter(t=>!(t.url||'').includes('unrelated')).length===3,'recovered member tabs');
  for(const tab of (await providerTabs()).filter(t=>!(t.url||'').includes('unrelated'))){const p=providerFor(tab.url||tab.pendingUrl);if(p!=='doubao')assert.equal(cleanUrl(tab.url||tab.pendingUrl),cleanUrl(conversation[p]),p+' reopens the saved conversation');}
  await until(async()=>!!(await command('state')).session.bindings.doubao?.note,'bounced chat is reported on its member');
  const recovered=(await command('state')).session;assert.equal(cleanUrl(recovered.bindings.doubao.url),'https://www.doubao.com/chat/');assert.equal(recovered.bindings.deepseek.note,undefined);assert.equal(recovered.bindings.kimi.note,undefined);
  await until(async()=>(await page.locator('.member-row',{hasText:'豆包'}).innerText()).includes('没能回到当时的对话'),'member row explains the lost chat');
  assert.equal(recovered.rounds[0].jobs.find(j=>j.provider==='doubao').url,conversation.doubao,'the record keeps the original chat address');
  const afterRecover=await command('state');assert(!afterRecover.index.sessions.some(m=>m.id===empty.id),'a roundtable that never got a question is not kept as history');
  checks.push('History (grouped, relative time, members) recovers a roundtable into this window at each AI\'s saved conversation; a site that bounces to a new chat is reported and continues there; the unused empty one is discarded');

  // 3. New in this window: closes the recovered one and auto-opens fresh member pages.
  await page.locator('#new').click();await page.locator('[data-new="here"]').click();
  await until(async()=>{const st=await command('state');return st.session.id!==s.id&&st.session.rounds.length===0;},'new roundtable in this window');
  const fresh=(await command('state')).session;
  await until(async()=>Object.values((await command('state')).session.bindings).filter(b=>b.tabId).length===3,'new roundtable opened its members');
  let freshTabs;await until(async()=>(freshTabs=(await providerTabs()).filter(t=>!(t.url||'').includes('unrelated'))).length===3,'three fresh member tabs');
  for(const t of freshTabs)assert.equal(cleanUrl(t.url||t.pendingUrl),cleanUrl(PROVIDERS[providerFor(t.url||t.pendingUrl)].url),'new roundtable starts on each site\'s new-chat page');
  assert((await command('state')).index.sessions.some(m=>m.id===s.id),'record of the closed roundtable remains');
  checks.push('New-in-this-window closes the current roundtable (record kept) and opens the new one\'s AI pages');
  // A double click sends two switches at once; they run one after another and leave one set of member tabs.
  await page.evaluate(async({url,windowId})=>chrome.tabs.create({windowId,url,active:false}),{url:base+'sidepanel.html',windowId});
  let stable;await until(()=>(stable=context.pages().find(p=>p.url()===base+'sidepanel.html')),'stable command page');
  await stable.evaluate(async windowId=>{const send=()=>chrome.runtime.sendMessage({type:'YZ_COMMAND',windowId,action:'new-here'});const r=await Promise.all([send(),send()]);if(!r.every(x=>x?.ok))throw Error(JSON.stringify(r));},windowId);
  await until(async()=>(await providerTabs()).filter(t=>!(t.url||'').includes('unrelated')).length===3,'double switch leaves exactly three member tabs');
  const doubled=(await command('state')).session;assert.equal(Object.values(doubled.bindings).filter(b=>b.tabId).length,3);
  for(const t of (await providerTabs()).filter(t=>!(t.url||'').includes('unrelated')))assert(Object.values(doubled.bindings).some(b=>b.tabId===t.id),'every open member tab belongs to the current roundtable');
  await stable.close();
  checks.push('Two simultaneous new-here requests run in turn: no orphan member tabs');

  // 4. A roundtable open in another window is shown as such and cannot be pulled into this one.
  const other=await command('new');await until(async()=>(await command('state')).index.sessions.length>=3,'second window roundtable');
  const otherId=Object.entries((await command('state')).open).find(([,w])=>w===other.opened.windowId)[0];
  await assert.rejects(()=>command('delete',{sessionId:otherId,confirm:true}),/关闭这场圆桌的窗口/);
  const moved=await command('open-here',{sessionId:otherId});assert.equal(moved.opened.windowId,other.opened.windowId);assert.equal((await command('state')).session.id,doubled.id);
  await page.bringToFront();await page.locator('#history').click();await page.waitForSelector('.history-row');
  assert.equal(await page.locator('.history-row',{has:page.locator('.badge.other')}).count(),1);await page.locator('#dialog-close').click();
  checks.push('History covers every window; a roundtable open elsewhere is switched to, never duplicated');
  // Both windows recover the same closed roundtable at once: one gets it, the other keeps its own roundtable and tabs.
  const commandPage=async win=>{await page.evaluate(({url,win})=>chrome.tabs.create({windowId:win,url,active:false}),{url:base+'sidepanel.html?race='+win,win});let p;await until(()=>(p=context.pages().find(x=>x.url()===base+'sidepanel.html?race='+win)),'command page '+win);return p;};
  const [pa,pb]=[await commandPage(windowId),await commandPage(other.opened.windowId)];
  const rawState=(p,win)=>p.evaluate(async win=>chrome.runtime.sendMessage({type:'YZ_COMMAND',windowId:win,action:'state'}),win);
  await until(async()=>Object.values((await rawState(pb,other.opened.windowId)).session.bindings).filter(b=>b.tabId).length===3,'other window members connected');
  const before={[windowId]:(await rawState(pa,windowId)).session,[other.opened.windowId]:(await rawState(pb,other.opened.windowId)).session};
  const race=await Promise.all([[pa,windowId],[pb,other.opened.windowId]].map(([p,win])=>p.evaluate(async({win,id})=>chrome.runtime.sendMessage({type:'YZ_COMMAND',windowId:win,action:'open-here',sessionId:id}),{win,id:s.id})));
  assert(race.every(r=>r.ok||/另一个窗口/.test(r.error)),JSON.stringify(race.map(r=>r.error)));
  const owners=Object.entries((await rawState(pa,windowId)).open).filter(([id])=>id===s.id);assert.equal(owners.length,1,'exactly one window holds the recovered roundtable');
  const winner=owners[0][1];
  for(const [win,p] of [[windowId,pa],[other.opened.windowId,pb]]){
    const now=(await rawState(p,win)).session;
    if(win===winner)continue;
    assert.equal(now.id,before[win].id,'the other window keeps its own roundtable');
    await until(async()=>{const tabs=(await p.evaluate(w=>chrome.tabs.query({windowId:w}),win)).filter(t=>providerFor(t.url||t.pendingUrl)&&!(t.url||'').includes('unrelated'));const bound=Object.values((await rawState(p,win)).session.bindings).map(b=>b.tabId);return tabs.length===3&&tabs.every(t=>bound.includes(t.id));},'losing window keeps its three bound member tabs');
  }
  const settled=(await rawState(pa,windowId)).session.id;await pa.close();await pb.close();
  await until(()=>page.url().includes(encodeURIComponent(settled)),'record page follows the race winner');await page.waitForSelector('#prompt');
  checks.push('Two windows recovering the same roundtable at once: one wins, the other keeps its roundtable and bound tabs');

  // 5. Presets: shown with unified 队友N placeholders, editable, validated, used when sending, restorable.
  const seed=await command('state');const t=structuredClone(seed.session);const rr=makeRound('ask','预设测试问题',t);for(const j of rr.jobs)Object.assign(j,{status:'done',text:j.provider+'_PRESET_ANSWER',url:PROVIDERS[j.provider].url});t.rounds.push(rr);
  await page.evaluate(async t=>{await chrome.storage.local.set({['arena.session.'+t.id]:t});},t);await cdp.send('Target.closeTarget',{targetId:(await cdp.send('Target.getTargets')).targetInfos.find(x=>x.url===worker.url()).targetId});
  await page.reload();await until(async()=>(await command('state')).session.rounds.length===t.rounds.length,'preset seed');
  await page.locator('[data-kind="discuss"]').click();await page.waitForSelector('#preset:not([hidden])');
  assert.deepEqual(await page.locator('#preset-body .slot').allInnerTexts(),['队友1的回答','队友2的回答']);
  assert((await page.locator('#preset-body').innerText()).includes('这是第1轮辩论'));
  assert.equal(await page.locator('#prompt-label').innerText(),'你的补充（可选，附在预设之后）');
  await page.locator('#edit-preset').click();await page.locator('#preset-text').fill('只保留我的要求：{轮次引导}');await page.locator('#preset-save').click();
  await until(async()=>(await page.locator('#error-banner').innerText()).includes('{队友回答}'),'template without its material is rejected');
  await page.locator('#preset-text').fill('{轮次引导}\n请逐条反驳：\n{队友回答}');await page.locator('#preset-save').click();
  await until(async()=>!(await page.locator('#preset-custom').isHidden()),'custom preset marked');
  assert((await page.locator('#preset-body').innerText()).includes('请逐条反驳'));
  await page.locator('#prompt').fill('请用表格');await until(async()=>(await command('state')).draft.text==='请用表格','draft saved');
  const preview=await command('preview',{kind:'discuss',text:'请用表格',options:{style:'debate'}});
  for(const p of preview.prompts){assert(p.prompt.startsWith('这是第1轮辩论'));assert(p.prompt.includes('请逐条反驳：\n【'));assert(p.prompt.endsWith('用户补充要求：\n请用表格'));assert(!p.prompt.includes(p.provider+'_PRESET_ANSWER'));}
  await page.screenshot({path:path.join(out,'20260927-roundtables-preset-claude.png')});
  await page.locator('#edit-preset').click();await page.locator('#preset-reset').click();await until(async()=>await page.locator('#preset-custom').isHidden(),'default restored');
  assert(!(await command('preview',{kind:'discuss',text:'',options:{style:'debate'}})).prompts[0].prompt.includes('请逐条反驳'));
  await page.locator('[data-kind="iterate"]').click();assert(await page.locator('#preset').isHidden());assert(!(await page.locator('#plain-note').isHidden()));
  checks.push('Preset shown with unified 队友N placeholders, user text styled separately and appended last; edit validates required slots, applies to sending, and restores default');

  // 6. The side panel page: its own toolbar replaces the brand row.
  const panel=await context.newPage();await panel.goto(base+'sidepanel.html');await panel.waitForSelector('#panel-title:not(:empty)');
  assert.equal(await panel.locator('.brand-name').count(),0);for(const id of ['open-main','history','new','close-roundtable'])assert(await panel.locator('#'+id).isVisible(),id);
  await panel.setViewportSize({width:360,height:760});await panel.locator('[data-kind="discuss"]').click();await panel.waitForSelector('#preset:not([hidden])');
  assert(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'panel toolbar fits 360px');
  await panel.screenshot({path:path.join(out,'20260927-roundtables-panel-claude.png')});
  checks.push('Side panel toolbar (title, 记录/历史/新建/关闭) fits a 360px panel');

  assert.deepEqual(failures,[]);fs.writeFileSync(path.join(out,'20260927-roundtables-checks-claude.json'),JSON.stringify({result:'PASS',checks,scope:'Real extension with fixture provider pages; not live websites'},null,2));console.log(JSON.stringify({result:'PASS',checks}));
}catch(e){for(const p of context.pages().filter(p=>p.url().includes('/main.html'))){await p.screenshot({path:path.join(out,'20260927-roundtables-failure-claude.png')}).catch(()=>{});break;}throw e;}finally{await context.close();}
