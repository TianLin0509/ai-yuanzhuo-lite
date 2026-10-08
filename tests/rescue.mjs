// 2026-10-08: every member always offers 重新提取 / 重新发送 / 跳过 / 换人, and 互相激发 sits between 观点讨论 and 队长总结.
// Driven through the real extension UI with fixture provider pages (not live websites).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../scripts/browser-config.mjs';
import {fixture} from './fixture.mjs';
import {PROVIDERS,providerFor} from '../src/core.js';
await import('../scripts/build.mjs');
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts');fs.mkdirSync(out,{recursive:true});
const profileRoot=process.platform==='win32'?'C:/VibeData/BrowserProfiles/AI-Yuanzhuo-Lite/tests':os.tmpdir();fs.mkdirSync(profileRoot,{recursive:true});
// DNS is blocked so tabs the extension opens never reach the real sites before a fixture is loaded into them.
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(profileRoot,'rescue-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${path.join(root,'dist')}`,`--load-extension=${path.join(root,'dist')}`,'--host-resolver-rules=MAP * ~NOTFOUND'],viewport:{width:1280,height:900}});
const failures=[],checks=[];context.on('page',p=>p.on('pageerror',e=>failures.push(e.message+' @ '+p.url())));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,description,timeout=30000){const start=Date.now();let last;while(Date.now()-start<timeout){try{if(await fn())return;}catch(e){last=e;}await wait(150);}throw Error('Timed out: '+description+(last?' ('+last.message+')':''));}
try{
  await context.route('https://**/*',route=>{const provider=providerFor(route.request().url());return provider?route.fulfill({contentType:'text/html',body:fixture(provider)}):route.abort();});
  let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');const base=`chrome-extension://${new URL(worker.url()).host}/`;
  const page=await context.newPage();await page.goto(base+'main.html');await page.waitForSelector('#base-time');
  const command=(action,data={})=>page.evaluate(async({action,data})=>{const windowId=(await chrome.windows.getCurrent()).id;const r=await chrome.runtime.sendMessage({type:'YZ_COMMAND',windowId,action,...data});if(!r?.ok)throw Error(r?.error);return r;},{action,data});
  const state=()=>command('state');
  const jobs=async()=>(await state()).session.rounds.at(-1).jobs,current=async p=>(await jobs()).findLast(j=>j.provider===p&&!j.replacedBy);
  const sendReady=()=>until(async()=>(await page.locator('#send-label').innerText())!=='停止本轮','send button ready');
  const row=name=>page.locator('.member-row',{hasText:name});
  const escapes=async name=>(await row(name).locator('.escapes button').allInnerTexts()).map(t=>t.trim());
  const site={},sent=p=>site[p].evaluate(()=>window.__fixture.sent);
  // Load a fixture into the tab the extension opened for a member (its first load happens before routing).
  async function adopt(p){let tab;await until(()=>(tab=context.pages().find(x=>providerFor(x.url())===p||x.url().startsWith('chrome-error')&&!Object.values(site).includes(x)))&&true,p+' tab opened');await tab.goto(PROVIDERS[p].url);await tab.waitForFunction(()=>!!globalThis.__fixture);site[p]=tab;return tab;}

  // Two members, so a third AI is free to take over a seat later.
  await command('members',{members:['deepseek','kimi']});await page.waitForFunction(()=>document.querySelectorAll('.member-row').length===2);
  assert.deepEqual(await escapes('DeepSeek'),['换人'],'before any round only 换人 applies');
  const before=new Set(context.pages());await page.locator('#connect').click();
  let opened;await until(()=>(opened=context.pages().filter(p=>!before.has(p))).length===2,'two member pages');
  for(const [i,p] of ['deepseek','kimi'].entries()){site[p]=opened[i];await opened[i].goto(PROVIDERS[p].url);await opened[i].waitForFunction(()=>!!globalThis.__fixture);}

  // 1. First round; every member shows the four escape actions in every state.
  await page.locator('[data-kind="iterate"]').click();await page.locator('#prompt').fill('救援测试 R1');await page.locator('#send').click();
  await until(async()=>(await jobs()).every(j=>j.status==='done'),'round 1 done');await sendReady();
  for(const name of ['DeepSeek','Kimi'])assert.deepEqual(await escapes(name),['重新提取','重新发送','跳过','换人'],name+' done');
  checks.push('Each member always shows 重新提取 / 重新发送 / 跳过 / 换人 once it has a job; before that only 换人');

  // 2. 互相激发 sits between 观点讨论 and 队长总结 and sends each member the others' answers.
  assert.deepEqual(await page.locator('#kinds button').allInnerTexts(),['独立迭代','工作流','观点讨论','互相激发','队长总结']);
  await page.locator('[data-kind="inspire"]').click();await page.waitForSelector('#preset:not([hidden])');
  assert.match(await page.locator('#plain-note').innerText(),/当作灵感/);assert.equal(await page.locator('#preset-name').innerText(),'互相激发');
  assert.equal(await page.locator('#send-label').innerText(),'互相激发');
  await site.kimi.evaluate(()=>{window.__fixture.hold=true;});
  await page.locator('#send').click();
  await until(async()=>(await current('deepseek')).status==='done','deepseek inspired answer');
  const inspired=(await sent('deepseek')).at(-1);assert(inspired.startsWith('这是第1轮互相激发。'));assert(inspired.includes('kimi 完整回答：救援测试 R1'));assert(!inspired.includes('deepseek 完整回答'),'own answer excluded');
  assert.equal((await state()).session.rounds.at(-1).kind,'inspire');
  await until(async()=>['sent','streaming'].includes((await current('kimi')).status),'kimi held');
  assert.deepEqual(await escapes('Kimi'),['重新提取','重新发送','跳过','换人'],'running member keeps all four');
  checks.push('互相激发 is the fourth mode; each member receives the other members\' complete answers with the 激发 preset');

  // 3. 重新提取 while running restarts reading only: nothing is sent again.
  const kimiSends=(await sent('kimi')).length,oldRequest=(await current('kimi')).requestId;
  await row('Kimi').locator('[data-op="reread"]').click();
  await until(async()=>(await current('kimi')).requestId!==oldRequest,'reread took over the reading');
  await wait(800);assert.equal((await sent('kimi')).length,kimiSends,'re-read never resends');
  checks.push('重新提取 on a running member restarts the reading without sending again');

  // 4. 换人 on the running member: 豆包 takes over this round with the same material; Kimi's page is told to stop.
  await row('Kimi').locator('[data-op="replace"]').click();await page.waitForSelector('#dialog[open] [data-pick]');
  assert.match(await page.locator('#dialog-body').innerText(),/立刻接手本轮/);
  await page.locator('#dialog [data-pick="doubao"]').click();
  await until(async()=>(await state()).session.members.join()==='deepseek,doubao','members swapped in place');
  const replaced=(await jobs()).find(j=>j.provider==='kimi');assert.equal(replaced.status,'skipped');assert.equal(replaced.replacedBy,'doubao');
  assert(await site.kimi.evaluate(()=>document.querySelector('#stop').hidden),'the replaced member was asked to stop answering');
  await adopt('doubao');
  // The newcomer's first send may hit the page before its fixture loaded; 重新发送 is the escape hatch for exactly that.
  await until(async()=>!['queued','preparing'].includes((await current('doubao')).status),'doubao attempted',20000);
  if((await current('doubao')).status==='error'){await row('豆包').locator('[data-op="retry"]').click();}
  await until(async()=>(await current('doubao')).status==='done','doubao answered the taken-over seat',30000);
  const takeover=(await sent('doubao')).at(-1);// Fixture answers quote the question, so the material already holds it and no newcomer line is added (rescue.test.mjs covers the line).
  assert(takeover.startsWith('这是第1轮互相激发。')&&takeover.includes('救援测试 R1'),'same material, question present');assert(takeover.includes('deepseek 完整回答：救援测试 R1')&&takeover.includes('kimi 完整回答：救援测试 R1'),'newcomer gets every source answer');
  assert.match(await row('豆包').innerText(),/接替 Kimi/);await sendReady();
  checks.push('换人 during a round: the newcomer takes over the seat with the same material; the replaced job stays as 已跳过 · 已换成');

  // 5. 重新发送 a finished member: confirmed, sent again, and the earlier answer is kept.
  const dsSends=(await sent('deepseek')).length;
  await row('DeepSeek').locator('[data-op="retry"]').click();await page.waitForSelector('#confirm-retry');
  assert.match(await page.locator('#dialog-body').innerText(),/之前的回答/);await page.locator('#confirm-retry').click();
  await until(async()=>(await sent('deepseek')).length===dsSends+1,'deepseek sent again');
  await until(async()=>(await current('deepseek')).status==='done','deepseek answered again');
  const ds=await current('deepseek');assert.equal(ds.earlier.length,1);assert(ds.earlier[0].text.includes('deepseek 完整回答'));
  await page.locator('[data-ai="deepseek"]').click();await page.waitForSelector('.earlier:not([hidden])');
  assert.match(await page.locator('.earlier summary').innerText(),/之前的回答（1）/);
  checks.push('重新发送 a finished member asks first, sends once more and keeps the earlier answer readable');

  // 6. 跳过 a finished answer leaves it out; 重新提取 brings it back.
  await row('DeepSeek').locator('[data-op="skip"]').click();await until(async()=>(await current('deepseek')).status==='skipped','skipped');
  assert(await row('DeepSeek').locator('[data-op="skip"]').isDisabled());
  await row('DeepSeek').locator('[data-op="reread"]').click();await until(async()=>(await current('deepseek')).status==='done','re-read restores the answer');
  checks.push('跳过 works on a finished answer and 重新提取 restores it');

  // 7. Workflow: a member still waiting for its turn can be sent now (重新发送 = 立即发送).
  await sendReady();await site.deepseek.evaluate(()=>{window.__fixture.hold=true;});
  await page.locator('[data-kind="relay"]').click();await page.locator('#prompt').fill('救援测试 接力');await page.locator('#send').click();
  await until(async()=>(await current('doubao'))?.status==='waiting'&&(await row('豆包').innerText()).includes('排队中'),'second member waiting');
  assert.deepEqual(await escapes('豆包'),['重新提取','重新发送','跳过','换人'],'waiting member keeps all four');
  await row('豆包').locator('[data-op="retry"]').click();
  await until(async()=>(await current('doubao')).status==='done','waiting member sent now');
  assert.equal((await sent('doubao')).at(-1),'救援测试 接力','no earlier answer yet, so the question only');
  await page.locator('#send').click();await until(async()=>(await jobs()).every(j=>!['queued','preparing','sending','sent','streaming','unconfirmed','waiting'].includes(j.status)),'workflow stopped');
  checks.push('A queued workflow member can be sent at once without waiting for the stuck member before it');

  await page.screenshot({path:path.join(out,'20261008-rescue-claude.png')});
  assert.deepEqual(failures,[]);fs.writeFileSync(path.join(out,'20261008-rescue-checks-claude.json'),JSON.stringify({result:'PASS',checks,scope:'Real extension with fixture provider pages; not live websites'},null,2));console.log(JSON.stringify({result:'PASS',checks}));
}catch(e){for(const p of context.pages().filter(p=>p.url().includes('/main.html'))){await p.screenshot({path:path.join(out,'20261008-rescue-failure-claude.png')}).catch(()=>{});break;}throw e;}finally{await context.close();}
