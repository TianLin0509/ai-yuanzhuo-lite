// Workflow (serial) rounds, recovery after a failed member is skipped, and the connect-first hint,
// driven through the real extension UI with fixture provider pages (not live websites).
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
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(profileRoot,'workflow-')),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${path.join(root,'dist')}`,`--load-extension=${path.join(root,'dist')}`,'--host-resolver-rules=MAP * ~NOTFOUND'],viewport:{width:1280,height:900}});
const failures=[],checks=[];context.on('page',p=>p.on('pageerror',e=>failures.push(e.message+' @ '+p.url())));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,description,timeout=30000){const start=Date.now();let last;while(Date.now()-start<timeout){try{if(await fn())return;}catch(e){last=e;}await wait(150);}throw Error('Timed out: '+description+(last?' ('+last.message+')':''));}
try{
  await context.route('https://**/*',route=>{const provider=providerFor(route.request().url());return provider?route.fulfill({contentType:'text/html',body:fixture(provider)}):route.abort();});
  let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');const base=`chrome-extension://${new URL(worker.url()).host}/`;
  const page=await context.newPage();await page.goto(base+'main.html');await page.waitForSelector('#base-time');
  const state=()=>page.evaluate(async()=>{const windowId=(await chrome.windows.getCurrent()).id;const r=await chrome.runtime.sendMessage({type:'YZ_COMMAND',windowId,action:'state'});if(!r?.ok)throw Error(r?.error);return r;});
  const latestJobs=async()=>(await state()).session.rounds.at(-1).jobs;
  // The panel refreshes a moment after the worker; until then its button still reads “停止本轮”.
  const sendReady=()=>until(async()=>(await page.locator('#send-label').innerText())!=='停止本轮','send button ready');

  // 1. Asking before any member page is open suggests connecting first.
  assert.equal(await page.locator('[data-kind="ask"]').count(),0,'同题提问 is gone; 独立迭代 covers it');
  await page.locator('#prompt').fill('先不连接就提问');await page.locator('#send').click();
  await page.waitForSelector('#guide-connect');assert.match(await page.locator('#dialog-body').innerText(),/还没有连接网页/);
  assert.equal((await state()).session.rounds.length,0,'nothing is sent while the hint is open');
  const before=new Set(context.pages());await page.locator('#guide-connect').click();
  await until(async()=>Object.values((await state()).session.bindings).filter(b=>b.tabId).length===3,'members connected from the hint');
  let opened;await until(()=>(opened=context.pages().filter(p=>!before.has(p))).length===3,'three member pages');
  // connect opens members in order; load each one's fixture into the tab the extension owns.
  const members=(await state()).session.members,site={};
  for(const [i,p] of members.entries()){site[p]=opened[i];await opened[i].goto(PROVIDERS[p].url);await opened[i].waitForFunction(()=>!!globalThis.__fixture);}
  checks.push('Sending with unconnected members first offers to connect; nothing is sent meanwhile');

  // 2. Workflow in a custom order: each member sees the question plus every earlier answer.
  await page.locator('[data-kind="relay"]').click();await page.waitForSelector('#relay-options:not([hidden])');
  assert.deepEqual(await page.locator('#relay-order .step').allInnerTexts().then(t=>t.map(x=>x.replace(/[↑\s]/g,''))),['1DeepSeek','2Kimi','3豆包']);
  await page.locator('#relay-order [data-up="2"]').click();
  await until(async()=>(await state()).draft.order==='deepseek,doubao,kimi','order saved in the draft');
  assert.equal(await page.locator('#prompt-label').innerText(),'你的问题（第 1 位直接收到）');
  assert.deepEqual(await page.locator('#preset-body .slot').allInnerTexts(),['你的问题','第1位的回答','第2位的回答']);
  await page.locator('#prompt').fill('工作流问题 Q1');await page.locator('#send').click();
  await until(async()=>(await latestJobs()).every(j=>j.status==='done'),'workflow round done',60000);
  const r1=(await state()).session.rounds.at(-1);assert.equal(r1.kind,'relay');assert.deepEqual(r1.jobs.map(j=>j.provider),['deepseek','doubao','kimi']);
  const sent=async p=>site[p].evaluate(()=>window.__fixture.sent.at(-1));
  assert.equal(await sent('deepseek'),'工作流问题 Q1','first member gets the question only');
  const second=await sent('doubao');assert(second.startsWith('工作流问题 Q1\n\n'));assert(second.includes('deepseek 完整回答：工作流问题 Q1'));assert(!second.includes('kimi 完整回答'));
  const third=await sent('kimi');assert(third.includes('deepseek 完整回答'));assert(third.includes('doubao 完整回答'));assert(third.indexOf('【DeepSeek 的回答】')<third.indexOf('【豆包 的回答】'),'answers keep the workflow order');
  assert(r1.jobs[1].updatedAt>=r1.jobs[0].updatedAt&&r1.jobs[2].updatedAt>=r1.jobs[1].updatedAt);
  checks.push('Workflow runs in the user\'s order; member N receives the question and all earlier answers in order');

  // 3. The middle member fails: the workflow pauses; skipping it continues without its answer.
  await site.doubao.evaluate(()=>{document.querySelector('#send').style.display='none';});
  await sendReady();await page.locator('#prompt').fill('工作流问题 Q2');await page.locator('#send').click();
  await until(async()=>(await latestJobs())[1].status==='error','middle member fails to send',40000).catch(async e=>{const st=await state();throw Error(e.message+' rounds='+st.session.rounds.length+' last='+st.session.rounds.at(-1).prompt+' err='+await page.locator('#error-banner').innerText()+' dialog='+(await page.locator('#dialog').getAttribute('open'))+' '+JSON.stringify(st.session.rounds.at(-1).jobs.map(j=>[j.provider,j.status,j.error.slice(0,80)])));});
  let jobs=await latestJobs();assert.equal(jobs[2].status,'waiting','the next member waits while the failed one is unresolved');
  assert.equal(await sent('kimi'),third,'the waiting member has not been sent anything');
  assert.equal(await page.locator('#send-label').innerText(),'停止本轮','a paused workflow is still in progress');
  await page.locator('.member-row [data-provider="doubao"][data-op="skip"]').click();
  await until(async()=>(await latestJobs())[2].status==='done','workflow continues after skip',40000);
  const afterSkip=await sent('kimi');assert(afterSkip.includes('deepseek 完整回答：工作流问题 Q2'));assert(!afterSkip.includes('doubao 完整回答：工作流问题 Q2'),'a skipped member contributes nothing');
  checks.push('A failed member pauses the workflow; skipping it resumes with the remaining answers');

  // 4. The next round works for everyone, including the member whose unsent question is still in its box.
  await site.doubao.evaluate(()=>{document.querySelector('#send').style.display='';});
  assert((await site.doubao.evaluate(()=>document.querySelector('textarea').value)).includes('工作流问题 Q2'),'the unsent workflow question is still in 豆包\'s box');
  await sendReady();await page.locator('[data-kind="iterate"]').click();await page.locator('#prompt').fill('下一轮 Q3');await page.locator('#send').click();
  await until(async()=>{const j=await latestJobs();return j.length===3&&j.every(x=>x.status==='done');},'next round completes for all members',60000);
  assert.equal(await sent('doubao'),'下一轮 Q3','our own leftover question is replaced, not sent');
  checks.push('After a skipped failure the next round completes for every member; our own unsent leftover is cleared');

  // 5. Stopping a workflow also stops members still waiting for their turn.
  await sendReady();await page.locator('[data-kind="relay"]').click();await site.deepseek.evaluate(()=>{window.__fixture.hold=true;});
  await page.locator('#prompt').fill('工作流问题 Q4');await page.locator('#send').click();
  await until(async()=>(await latestJobs())[0].status==='sent'||(await latestJobs())[0].status==='streaming','first member answering');
  await page.locator('#send').click();
  await until(async()=>(await latestJobs()).every(j=>['stopped'].includes(j.status)),'every member stopped');
  assert.equal(await sent('kimi'),'下一轮 Q3','no later member was sent anything');
  checks.push('Stopping a workflow stops the waiting members too');

  await page.screenshot({path:path.join(out,'20260927-workflow-claude.png')});
  assert.deepEqual(failures,[]);fs.writeFileSync(path.join(out,'20260927-workflow-checks-claude.json'),JSON.stringify({result:'PASS',checks,scope:'Real extension with fixture provider pages; not live websites'},null,2));console.log(JSON.stringify({result:'PASS',checks}));
}catch(e){for(const p of context.pages().filter(p=>p.url().includes('/main.html'))){await p.screenshot({path:path.join(out,'20260927-workflow-failure-claude.png')}).catch(()=>{});break;}throw e;}finally{await context.close();}
