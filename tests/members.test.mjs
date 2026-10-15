import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../scripts/browser-config.mjs';
import {newSession,makeRound,PROVIDERS,providerFor} from '../src/core.js';

// 2026-09-26 user report: no visible way to edit members (swap a skipped Kimi for another AI).
// 2026-10-15 user request: members and pages go together, as in AI-Arena — adding a member opens its page, closing
// the page takes the member out, so nobody has to remember a "connect pages" step.
// Loads the built extension in an isolated headless browser; no AI site is contacted (DNS is blocked).
test('side panel swaps, removes and adds members inline, each member page opening and closing with it; a skipped member no longer blocks discussion',async()=>{
  await import('../scripts/build.mjs');
  const root=path.resolve(import.meta.dirname,'..'),profiles=process.platform==='win32'?'C:/VibeData/BrowserProfiles/AI-Yuanzhuo-Lite/tests':os.tmpdir();fs.mkdirSync(profiles,{recursive:true});
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(profiles,'members-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${path.join(root,'dist')}`,`--load-extension=${path.join(root,'dist')}`,'--host-resolver-rules=MAP * ~NOTFOUND'],viewport:{width:384,height:900}});
  const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  try{
    await context.route('https://**/*',route=>route.abort());
    let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');const base=`chrome-extension://${new URL(worker.url()).host}/`;
    const page=await context.newPage();await page.goto(base+'sidepanel.html');await page.waitForSelector('.member-row');
    const command=(action,data={})=>page.evaluate(async({action,data})=>{const w=await chrome.windows.getCurrent();const r=await chrome.runtime.sendMessage({type:'YZ_COMMAND',action,windowId:w.id,...data});if(!r?.ok)throw Error(r?.error);return r;},{action,data});
    const until=async(fn,label,ms=10000)=>{const end=Date.now()+ms;let last;while(Date.now()<end){last=await fn();if(last)return last;await page.waitForTimeout(100);}throw new Error('Timed out: '+label);};
    // Member pages in this window, by provider (several tabs of one site would show up twice).
    const pages=async()=>(await page.evaluate(async()=>(await chrome.tabs.query({windowId:(await chrome.windows.getCurrent()).id})).map(t=>t.url||t.pendingUrl))).map(providerFor).filter(Boolean).sort();
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify([...b].sort());
    // Opening the panel opens every member's page by itself; there is no connect button any more.
    assert.equal(await page.locator('#connect').count(),0,'no connect button');
    const initial=await until(async()=>{const st=await command('state');return st.session.members.every(p=>st.session.bindings[p]?.tabId)&&st;},'member pages opened when the panel loaded');
    await until(async()=>same(await pages(),initial.session.members),'one page per member');
    // Seed one finished round: DeepSeek and Doubao answered, Kimi was skipped (quota used up).
    const s=newSession(['deepseek','kimi','doubao']);s.id=initial.session.id;s.bindings=initial.session.bindings;assert.deepEqual(initial.session.members,['deepseek','kimi','doubao']);
    const r=makeRound('ask','成员编辑测试',s);for(const j of r.jobs)Object.assign(j,j.provider==='kimi'?{status:'skipped'}:{status:'done',format:'markdown',text:j.provider.toUpperCase()+'_ANSWER',phase:'attempted'});s.rounds.push(r);
    await page.evaluate(async s=>{const index=(await chrome.storage.local.get('arena.index'))['arena.index'];index.sessions=index.sessions.map(m=>m.id===s.id?{...m,rounds:1}:m);await chrome.storage.local.set({['arena.session.'+s.id]:s,'arena.index':index});},s);
    const cdp=await context.browser().newBrowserCDPSession();const sw=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===worker.url());await cdp.send('Target.closeTarget',{targetId:sw.targetId});
    await page.reload();await page.waitForSelector('.member-row[data-status="skipped"]');await page.waitForTimeout(500);
    assert.deepEqual(await pages(),['deepseek','doubao','kimi'],'reloading the panel does not open the pages again');
    const shot=async name=>{if(process.env.YZ_SHOT)await page.screenshot({path:path.join(process.env.YZ_SHOT,name+'.png'),clip:{x:0,y:0,width:384,height:260}});};
    await shot('1-skipped');
    const members=async()=>(await command('state')).session.members;
    assert.equal(await page.locator('#member-count').textContent(),'3/3');
    assert.equal(await page.locator('.add-member').count(),0,'no add row at the limit');
    // The skipped member offers 换人 without hovering.
    const swap=page.locator('.member-row[data-status="skipped"] [data-op="replace"]');assert(await swap.isVisible(),'换人 is visible on a skipped member');
    await swap.click();await page.waitForSelector('#dialog[open] [data-pick]');if(process.env.YZ_SHOT)await page.screenshot({path:path.join(process.env.YZ_SHOT,'2-pick.png')});
    const offered=await page.locator('#dialog [data-pick]').evaluateAll(b=>b.map(x=>x.dataset.pick));
    assert(!offered.includes('deepseek')&&!offered.includes('kimi')&&!offered.includes('doubao')&&offered.includes('qwen'),'only AIs outside the roundtable are offered');
    await page.locator('#dialog [data-pick="qwen"]').click();await page.waitForFunction(()=>[...document.querySelectorAll('.member-chip')].map(b=>b.textContent).join()==='DeepSeek,千问,豆包');
    assert.deepEqual(await members(),['deepseek','qwen','doubao'],'swap keeps the position');
    await until(async()=>same(await pages(),['deepseek','qwen','doubao']),'swap closes the Kimi page and opens the Qwen page');
    // Remove on hover, then the add row appears.
    await page.locator('.member-row',{hasText:'豆包'}).hover();await page.locator('.member-row',{hasText:'豆包'}).locator('[data-op="remove"]').click();
    await page.waitForSelector('.add-member');await shot('3-two-members');assert.deepEqual(await members(),['deepseek','qwen']);
    await until(async()=>same(await pages(),['deepseek','qwen']),'removing Doubao closes its page');assert.equal(await page.locator('#member-count').textContent(),'2/3');
    await page.locator('.member-row',{hasText:'千问'}).hover();assert.equal(await page.locator('.member-row',{hasText:'千问'}).locator('[data-op="remove"]').count(),0,'two members cannot be reduced further');
    await page.locator('.add-member').click();await page.locator('#dialog [data-pick="grok"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.member-chip').length===3);assert.deepEqual(await members(),['deepseek','qwen','grok']);
    await until(async()=>same(await pages(),['deepseek','qwen','grok']),'adding Grok opens its page');
    // The new roundtable default follows the last choice.
    assert.deepEqual((await page.evaluate(()=>chrome.storage.local.get('arena.members')))['arena.members'],['deepseek','qwen','grok']);
    // Discussion is allowed with Kimi skipped: new members receive the completed answers only.
    const preview=await command('preview',{kind:'discuss',text:'',options:{}});
    const prompts=Object.fromEntries(preview.prompts.map(p=>[p.provider,p.prompt]));
    assert.deepEqual(Object.keys(prompts),['deepseek','qwen','grok']);assert(prompts.grok.includes('DEEPSEEK_ANSWER')&&prompts.grok.includes('DOUBAO_ANSWER'));
    // The user closes Grok's page while Grok is still answering: Grok leaves, its seat is skipped, the round goes on.
    const st=await command('state'),grokTab=st.session.bindings.grok.tabId,live=structuredClone(st.session),round=makeRound('ask','关闭网页测试',{...live,rounds:[]});
    for(const j of round.jobs)Object.assign(j,j.provider==='grok'?{status:'streaming',tabId:grokTab,phase:'attempted',startedAt:Date.now()}:{status:'done',format:'markdown',text:j.provider+' 第二轮',phase:'attempted'});live.rounds.push(round);
    await page.evaluate(async s=>chrome.storage.local.set({['arena.session.'+s.id]:s}),live);
    await cdp.send('Target.closeTarget',{targetId:(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===worker.url()).targetId});
    await page.evaluate(id=>chrome.tabs.remove(id),grokTab);
    const after=await until(async()=>{const x=await command('state');return x.session.members.length===2&&x;},'closing the Grok page takes Grok out');
    assert.deepEqual(after.session.members,['deepseek','qwen']);const grokJob=after.session.rounds.at(-1).jobs.find(j=>j.provider==='grok');
    assert.equal(grokJob.status,'skipped');assert.match(grokJob.error,/网页已关闭/);
    assert.deepEqual((await page.evaluate(()=>chrome.storage.local.get('arena.members')))['arena.members'],['deepseek','qwen'],'the next roundtable follows');
    await page.waitForFunction(()=>[...document.querySelectorAll('.member-chip')].map(b=>b.textContent).join()==='DeepSeek,千问');
    // With two members left, closing a page keeps the member: its row says the page is not open, and a click reopens it.
    const qwenTab=after.session.bindings.qwen.tabId;await page.evaluate(id=>chrome.tabs.remove(id),qwenTab);
    await until(async()=>!(await command('state')).session.bindings.qwen?.tabId,'qwen unbound');assert.deepEqual(await members(),['deepseek','qwen'],'two members stay');
    await page.waitForFunction(()=>document.querySelector('.member-row:nth-child(2) .state').textContent.includes('网页未打开'));await shot('4-page-closed');
    await page.locator('.member-chip',{hasText:'千问'}).click();
    await until(async()=>{const b=(await command('state')).session.bindings.qwen;return b?.tabId&&b.tabId!==qwenTab;},'clicking the name reopens the page');
    await until(async()=>same(await pages(),['deepseek','qwen']),'one page per member again');
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
