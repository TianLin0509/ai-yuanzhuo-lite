import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../scripts/browser-config.mjs';
import {newSession,makeRound,PROVIDERS} from '../src/core.js';

// 2026-09-26 user report: no visible way to edit members (swap a skipped Kimi for another AI).
// Loads the built extension in an isolated headless browser; no AI site is contacted.
test('side panel swaps, removes and adds members inline; a skipped member no longer blocks discussion',async()=>{
  await import('../scripts/build.mjs');
  const root=path.resolve(import.meta.dirname,'..'),profiles=process.platform==='win32'?'C:/VibeData/BrowserProfiles/AI-Yuanzhuo-Lite/tests':os.tmpdir();fs.mkdirSync(profiles,{recursive:true});
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(profiles,'members-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${path.join(root,'dist')}`,`--load-extension=${path.join(root,'dist')}`],viewport:{width:384,height:900}});
  const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  try{
    await context.route('https://**/*',route=>route.abort());
    let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');const base=`chrome-extension://${new URL(worker.url()).host}/`;
    const page=await context.newPage();await page.goto(base+'sidepanel.html');await page.waitForSelector('.member-row');
    const command=(action,data={})=>page.evaluate(async({action,data})=>{const w=await chrome.windows.getCurrent();const r=await chrome.runtime.sendMessage({type:'YZ_COMMAND',action,windowId:w.id,...data});if(!r?.ok)throw Error(r?.error);return r;},{action,data});
    // Seed one finished round: DeepSeek and Doubao answered, Kimi was skipped (quota used up).
    const initial=await command('state'),s=newSession(['deepseek','kimi','doubao']);s.id=initial.session.id;
    const r=makeRound('ask','成员编辑测试',s);for(const j of r.jobs)Object.assign(j,j.provider==='kimi'?{status:'skipped'}:{status:'done',format:'markdown',text:j.provider.toUpperCase()+'_ANSWER',phase:'attempted'});s.rounds.push(r);
    await page.evaluate(async s=>{const index=(await chrome.storage.local.get('arena.index'))['arena.index'];index.sessions=index.sessions.map(m=>m.id===s.id?{...m,rounds:1}:m);await chrome.storage.local.set({['arena.session.'+s.id]:s,'arena.index':index});},s);
    const cdp=await context.browser().newBrowserCDPSession();const sw=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===worker.url());await cdp.send('Target.closeTarget',{targetId:sw.targetId});
    await page.reload();await page.waitForSelector('.member-row[data-status="skipped"]');
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
    // Remove on hover, then the add row appears.
    await page.locator('.member-row',{hasText:'豆包'}).hover();await page.locator('.member-row',{hasText:'豆包'}).locator('[data-op="remove"]').click();
    await page.waitForSelector('.add-member');await shot('3-two-members');assert.deepEqual(await members(),['deepseek','qwen']);assert.equal(await page.locator('#member-count').textContent(),'2/3');
    await page.locator('.member-row',{hasText:'千问'}).hover();assert.equal(await page.locator('.member-row',{hasText:'千问'}).locator('[data-op="remove"]').count(),0,'two members cannot be reduced further');
    await page.locator('.add-member').click();await page.locator('#dialog [data-pick="grok"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.member-chip').length===3);assert.deepEqual(await members(),['deepseek','qwen','grok']);
    // The new roundtable default follows the last choice.
    assert.deepEqual((await page.evaluate(()=>chrome.storage.local.get('arena.members')))['arena.members'],['deepseek','qwen','grok']);
    // Discussion is allowed with Kimi skipped: new members receive the completed answers only.
    const preview=await command('preview',{kind:'discuss',text:'',options:{}});
    const prompts=Object.fromEntries(preview.prompts.map(p=>[p.provider,p.prompt]));
    assert.deepEqual(Object.keys(prompts),['deepseek','qwen','grok']);assert(prompts.grok.includes('DEEPSEEK_ANSWER')&&prompts.grok.includes('DOUBAO_ANSWER'));
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
