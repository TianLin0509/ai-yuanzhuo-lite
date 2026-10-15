import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from '../scripts/browser-config.mjs';
import {fixture} from './fixture.mjs';
import {providerFor,PROVIDERS} from '../src/core.js';
// Always test this checkout's current source, never an older unpacked dist.
await import('../scripts/build.mjs');
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts');fs.mkdirSync(out,{recursive:true});
const profileRoot=process.platform==='win32'?'C:\\VibeData\\BrowserProfiles\\AI-Yuanzhuo-Lite\\tests':path.join(os.tmpdir(),'ai-yuanzhuo-lite-tests');fs.mkdirSync(profileRoot,{recursive:true});const profile=fs.mkdtempSync(path.join(profileRoot,'fixture-'));
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${path.join(root,'dist')}`,`--load-extension=${path.join(root,'dist')}`],viewport:{width:1200,height:900}});
const failures=[],checks=[];context.on('page',page=>page.on('pageerror',e=>failures.push(e.message)));
try{
 await context.route('https://**/*',route=>{const provider=providerFor(route.request().url());if(provider)return route.fulfill({contentType:'text/html',body:fixture(provider)});return route.abort();});
 let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker');
 const extensionId=new URL(worker.url()).host,panel=await context.newPage();
 await panel.goto(`chrome-extension://${extensionId}/main.html`);await panel.waitForSelector('#base-time');
 const command=(action,data={})=>panel.evaluate(async({action,data})=>{const r=await chrome.runtime.sendMessage({type:'YZ_COMMAND',action,...data});if(!r.ok)throw new Error(r.error);return r;},{action,data});
 const getState=()=>command('state');
 await panel.locator('[data-layout="c"]').click();await panel.waitForFunction(()=>document.querySelector('[data-layout="c"]').getAttribute('aria-pressed')==='true');
 const done=async(expectedRounds)=>{const deadline=Date.now()+30000;let state;while(Date.now()<deadline){state=await getState();const jobs=state.session.rounds.at(-1)?.jobs;if((!expectedRounds||state.session.rounds.length===expectedRounds)&&jobs?.length===3&&jobs.every(j=>j.status==='done')){await panel.waitForFunction(()=>document.querySelectorAll('.state[data-status="done"]').length===3);return;}await new Promise(resolve=>setTimeout(resolve,150));}throw new Error('Completion timeout: '+JSON.stringify(state.session.rounds.at(-1)?.jobs.map(j=>({provider:j.provider,status:j.status,error:j.error}))));};
 const untouched=await context.newPage();await untouched.goto('https://chat.deepseek.com/unrelated');
 // Member pages open by themselves when the roundtable page loads (no connect step).
 await panel.waitForFunction(()=>document.querySelectorAll('.member-chip.connected').length===3);
 let state=await getState();const tabs={};for(const [provider,binding] of Object.entries(state.session.bindings)){for(let attempt=0;attempt<100;attempt++){tabs[provider]=context.pages().find(p=>providerFor(p.url())===provider&&p!==untouched);if(tabs[provider])break;await new Promise(resolve=>setTimeout(resolve,50));}assert(tabs[provider],provider+' tab must finish navigation');await tabs[provider].goto(PROVIDERS[provider].url);await tabs[provider].waitForFunction(()=>!!globalThis.__fixture);}
 checks.push('Real MV3 service worker, storage, sidepanel page, and three isolated site bindings');
 const prompt='第一轮原文\n— 第二行 <>&\n不要拆成多条问题';
 await panel.locator('#prompt').fill(prompt);await panel.locator('#send').click();
 await panel.waitForFunction(()=>document.querySelectorAll('.answer').length===3);
 await panel.waitForTimeout(1100);state=await getState();assert(state.session.rounds[0].jobs.every(j=>!j.text.includes('OLD_RESPONSE')));
 fs.writeFileSync(path.join(out,'20260909-lite-first-dispatch-codex.json'),JSON.stringify(state,null,2));
 await done();state=await getState();
 for(const [provider,page] of Object.entries(tabs)){assert.deepEqual(await page.evaluate(()=>__fixture.sent),[prompt]);const job=state.session.rounds[0].jobs.find(j=>j.provider===provider);assert(job.text.includes('END_MARKER'));assert(job.text.includes('```js'));assert(job.text.includes('const value = "<safe>";'));assert.equal(await page.evaluate(()=>requestAnimationFrame===__native.raf&&setTimeout===__native.timer&&setInterval===__native.interval),true);}
 checks.push('One exact multiline send per provider, no old-answer leakage during thinking, full fenced code extraction, native timers unchanged');
 const diagnostic=await worker.evaluate(async bindings=>{const result={};for(const [provider,b] of Object.entries(bindings)){const [entry]=await chrome.scripting.executeScript({target:{tabId:b.tabId},func:()=>globalThis.__yuanzhuoLite.diagnostics});result[provider]=entry.result;}return result;},state.session.bindings);
 assert(Object.values(diagnostic).every(d=>d.observers===0&&d.timers===0));
 const untouchedTabs=await worker.evaluate(()=>chrome.tabs.query({url:'https://chat.deepseek.com/unrelated'}));
 const noInjection=await worker.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:()=>typeof globalThis.__yuanzhuoLite}))[0].result,untouchedTabs[0].id);assert.equal(noInjection,'undefined');
 checks.push('No observers/timers after completion; non-participant page has no Arena injection');
 await panel.locator('.answer summary').first().click();await panel.locator('.answer summary').nth(1).click();assert.equal(await panel.locator('.answer[open]').count(),2);assert(await panel.locator('.text pre code').first().textContent());
 for(const width of [320,390,530]){await panel.setViewportSize({width,height:900});assert(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await panel.screenshot({path:path.join(out,'20260909-lite-sidepanel-fixture-codex.png'),fullPage:true});
 checks.push('Accordion multi-expand, safe Markdown/code rendering, 320/390/530px without overflow');
 const sessionId=state.session.id,firstJob=state.session.rounds[0].jobs[0];
 await command('job',{sessionId,roundId:state.session.rounds[0].id,jobId:firstJob.id,operation:'reread'});await done();assert.equal((await tabs.deepseek.evaluate(()=>__fixture.sent)).length,1);
 checks.push('Reread reuses response boundary and never sends a second prompt');
 await panel.locator('#prompt').fill('第二轮：只补充检查清单。');await panel.locator('[data-kind="iterate"]').click();await panel.locator('#send').click();await done(2);state=await getState();assert.equal(state.session.rounds.length,2);for(const page of Object.values(tabs))assert.equal((await page.evaluate(()=>__fixture.sent))[1],'第二轮：只补充检查清单。');
 await panel.reload();await panel.waitForSelector('.answer');state=await getState();assert.equal(state.session.rounds.length,2);checks.push('Independent iteration exact text and sidepanel reload/history persistence');
 const preservedFirst=state.session.rounds[0].jobs.map(j=>j.text);
 for(const operation of ['reread','retry'])await assert.rejects(()=>command('job',{sessionId,roundId:state.session.rounds[0].id,jobId:firstJob.id,operation,confirmDuplicate:true}),/历史轮次/);
 state=await getState();assert.deepEqual(state.session.rounds[0].jobs.map(j=>j.text),preservedFirst);assert.equal((await tabs.deepseek.evaluate(()=>__fixture.sent)).length,2);
 checks.push('Historical reread/retry rejected without replacing old answers or dispatching another prompt');
 const priorAnswers=Object.fromEntries(state.session.rounds.at(-1).jobs.map(j=>[j.provider,j.text]));
 await panel.locator('#prompt').fill('请比较分歧。');await panel.locator('[data-kind="discuss"]').click();await panel.locator('#send').click();await done(3);state=await getState();assert.equal(state.session.rounds.at(-1).kind,'discuss');
 const peerMatrix={deepseek:['kimi','doubao'],kimi:['deepseek','doubao'],doubao:['deepseek','kimi']};
 for(const [provider,page] of Object.entries(tabs)){
  const sent=await page.evaluate(()=>__fixture.sent);assert.equal(sent.length,3);const prompt=sent[2];
  assert.equal(prompt,state.session.rounds.at(-1).jobs.find(j=>j.provider===provider).prompt);
  assert(!prompt.includes(priorAnswers[provider]),provider+' must not receive its own answer');
  assert(!prompt.includes('【'+PROVIDERS[provider].name+' 的回答】:'));
  for(const peer of peerMatrix[provider]){assert(prompt.includes(priorAnswers[peer]),provider+' must receive full '+peer+' answer');assert(prompt.includes('【'+PROVIDERS[peer].name+' 的回答】:'));}
 }
 checks.push('Actual three-site discussion delivery contains each recipient\'s two peers in full and excludes its own answer');
 await panel.locator('[data-kind="summary"]').click();await panel.locator('#captain').selectOption('kimi');await panel.locator('#depth').selectOption('深入分析');await panel.locator('#send').click();
 if(await panel.locator('#latest').isVisible())await panel.locator('#latest').click();
 await panel.waitForFunction(()=>document.querySelectorAll('.answer').length===1&&document.querySelector('.answer')?.dataset.status==='done',{},{timeout:30000});state=await getState();assert.equal(state.session.rounds.at(-1).jobs[0].provider,'kimi');checks.push('Captain summary dispatches only selected provider');
 // New round must remain stopped even if fixture answers arrive afterwards.
 await panel.locator('[data-kind="iterate"]').click();await panel.locator('#prompt').fill('第三题等待停止');await panel.locator('#send').click();await panel.waitForFunction(()=>document.querySelectorAll('.answer').length===3);await panel.locator('#send').click();await panel.waitForTimeout(4500);state=await getState();assert(state.session.rounds.at(-1).jobs.every(j=>j.status==='stopped'));
 checks.push('Stop closes all watchers and rejects late terminal events');
 assert.deepEqual(failures,[]);fs.writeFileSync(path.join(out,'20260909-lite-extension-fixture-codex.json'),JSON.stringify({createdAt:new Date().toISOString(),browser:context.browser()?.version()||'Chromium',extensionId,checks,diagnostic,failures,profile},null,2));console.log(JSON.stringify({checks,diagnostic,failures},null,2));
}catch(error){fs.writeFileSync(path.join(out,'20260909-lite-test-error-codex.txt'),error.stack+'\n'+JSON.stringify(failures));const extensionPage=context.pages().find(p=>p.url().startsWith('chrome-extension:'));if(extensionPage){await extensionPage.screenshot({path:path.join(out,'20260909-lite-fixture-failure-codex.png'),fullPage:true});fs.writeFileSync(path.join(out,'20260909-lite-fixture-failure-state-codex.json'),JSON.stringify(await extensionPage.evaluate(()=>chrome.storage.local.get(null)),null,2));}throw error;}finally{await context.close();}
