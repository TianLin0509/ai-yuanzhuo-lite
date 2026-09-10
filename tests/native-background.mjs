import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {launchNativeBrowser} from '../scripts/native-browser.mjs';
import {fixture} from './fixture.mjs';
import {providerFor,PROVIDERS} from '../src/core.js';

await import('../scripts/build.mjs');
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts');fs.mkdirSync(out,{recursive:true});
const profileRoot=process.platform==='win32'?'C:\\VibeData\\BrowserProfiles\\AI-Yuanzhuo-Lite\\tests':path.join(os.tmpdir(),'ai-yuanzhuo-lite-tests');
fs.mkdirSync(profileRoot,{recursive:true});
const profile=fs.mkdtempSync(path.join(profileRoot,'native-background-'));
const baselineOnly=process.argv.includes('--baseline-only'),longHidden=process.argv.includes('--long-hidden'),minimized=process.argv.includes('--minimized');
const runId=`${process.pid}-${Date.now()}`;
const evidencePath=path.join(out,`20260909-lite-native-background-${baselineOnly?'baseline':longHidden?'long':'check'}${minimized?'-minimized':''}-codex-${runId}.json`);
// A concurrent build must not replace files under a browser that is already
// running a long test. Load and hash this run's own immutable extension snapshot.
const extension=path.join(profile,'unpacked-extension');
fs.cpSync(path.join(root,'dist'),extension,{recursive:true,force:false,errorOnExist:true});
function hashes(directory,prefix=''){
  const result={};
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const relative=prefix+entry.name,absolute=path.join(directory,entry.name);
    if(entry.isDirectory())Object.assign(result,hashes(absolute,relative+'/'));
    else if(entry.isFile())result[relative]=createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    else throw new Error('Unexpected non-file in extension snapshot: '+absolute);
  }return result;
}
const extensionHashes=hashes(extension);
const testScriptHash=createHash('sha256').update(fs.readFileSync(import.meta.filename)).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// This is deliberately a visibility-dependent website fixture, not a patch to
// browser APIs. Both the control and supported run use identical native rAF.
function backgroundFixture(provider){
  const script=`<script>
  window.__backgroundFixture={frames:0,generating:false,completed:0,sequence:0};
  __fixture.hold=true;
  const tick=()=>{if(document.visibilityState==='visible')__backgroundFixture.frames++;requestAnimationFrame(tick);};requestAnimationFrame(tick);
  document.querySelector('#stop').addEventListener('click',()=>{__backgroundFixture.sequence++;__backgroundFixture.generating=false;});
  document.querySelector('#send').addEventListener('click',()=>{
    const sent=__fixture.sent.at(-1);if(!sent)return;
    const sequence=++__backgroundFixture.sequence,start=__backgroundFixture.frames,startedAt=performance.now();
    __backgroundFixture.generating=true;const el=answer('${provider} generating',false);
    const render=()=>{
      if(sequence!==__backgroundFixture.sequence)return;
      // Native background rAF can be low frequency even when visibility is
      // emulated. Prove progress without assuming a foreground 60 fps rate.
      if(document.visibilityState!=='visible'||__backgroundFixture.frames-start<8||performance.now()-startedAt<4000){requestAnimationFrame(render);return;}
      el.textContent='${provider} native background answer: '+sent+' NATIVE_BACKGROUND_END';
      const copy=document.createElement('button');copy.setAttribute('aria-label','复制');copy.dataset.testid='copy-button';copy.textContent='复制';el.parentElement.append(copy);
      document.querySelector('#stop').hidden=true;__backgroundFixture.generating=false;__backgroundFixture.completed++;
    };requestAnimationFrame(render);
  });
  </script>`;
  return fixture(provider).replace('</html>',script+'</html>');
}
const native=await launchNativeBrowser({profile,extension,headless:false});
const {context}=native,failures=[];
const evidence={createdAt:new Date().toISOString(),runId,result:'RUNNING',kind:'controlled website fixture, not real provider acceptance',baselineOnly,longHidden,minimized,environment:native.metadata,extensionHashes,testScriptHash,checks:[],failures};
const save=()=>fs.writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n','utf8');
context.on('page',page=>page.on('pageerror',error=>failures.push(error.message)));
save();
try{
  await assert.rejects(()=>launchNativeBrowser({profile,extension}),/already has a running browser/);
  evidence.checks.push('Launcher rejects an already-running profile before spawning another browser');
  await context.route('https://**/*',route=>{const provider=providerFor(route.request().url());return provider?route.fulfill({contentType:'text/html',body:backgroundFixture(provider)}):route.abort();});
  const isArenaWorker=worker=>worker.url().startsWith('chrome-extension:')&&worker.url().endsWith('/background.js');
  let worker=context.serviceWorkers().find(isArenaWorker);if(!worker)worker=await context.waitForEvent('serviceworker',{predicate:isArenaWorker});
  const extensionId=new URL(worker.url()).host,panel=context.pages()[0]||await context.newPage();
  evidence.extensionId=extensionId;
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.waitForFunction(()=>document.querySelector('#empty')?.hidden===false,undefined,{polling:100});
  const windowId=await panel.evaluate(async()=>(await chrome.tabs.getCurrent()).windowId);
  const windowState=()=>panel.evaluate(async id=>(await chrome.windows.get(id)).state,windowId);
  const command=(action,data={})=>panel.evaluate(async({action,data})=>{const response=await chrome.runtime.sendMessage({type:'YZ_COMMAND',action,...data});if(!response.ok)throw new Error(response.error);return response;},{action,data});
  await panel.locator('#connect').dispatchEvent('click');
  await panel.waitForFunction(()=>document.querySelectorAll('.member-chip.connected').length===3,undefined,{polling:100});
  let state=await command('state');const bindings=state.session.bindings,tabs={};evidence.bindings=bindings;
  for(const provider of Object.keys(PROVIDERS)){
    for(let attempt=0;attempt<100;attempt++){tabs[provider]=context.pages().find(page=>providerFor(page.url())===provider);if(tabs[provider])break;await delay(50);}
    assert(tabs[provider],provider+' tab must exist');
    // Native extension-created tabs can navigate before the CDP client installs
    // request interception. Navigate once under our installed fixture route.
    await tabs[provider].goto(PROVIDERS[provider].url);
    await tabs[provider].waitForFunction(()=>!!globalThis.__backgroundFixture,undefined,{polling:100});
  }
  // Match the participants' native creation path. CDP Target.createTarget (used
  // by context.newPage) can leave an inactive page visible even with noDefaults.
  const controlTab=await panel.evaluate(()=>chrome.tabs.create({url:'https://chat.deepseek.com/native-control',active:false}));
  let control;
  for(let attempt=0;attempt<100;attempt++){control=context.pages().find(page=>page.url()==='https://chat.deepseek.com/native-control');if(control)break;await delay(50);}
  assert(control,'Native control tab must exist');await control.goto('https://chat.deepseek.com/native-control');
  await control.waitForFunction(()=>!!globalThis.__backgroundFixture,undefined,{polling:100});
  const controlSession=await context.newCDPSession(control);
  try{const {targetInfo}=await controlSession.send('Target.getTargetInfo');evidence.controlTarget={tabId:controlTab.id,targetId:targetInfo.targetId,url:targetInfo.url,browserContextId:targetInfo.browserContextId};}finally{await controlSession.detach();}
  const controlView=async()=>{
    const tab=await panel.evaluate(tabId=>chrome.tabs.get(tabId),controlTab.id);
    const owned=await panel.evaluate(async tabId=>{try{await chrome.debugger.sendCommand({tabId},'Page.getFrameTree');return true;}catch(error){if(/Debugger is not attached/i.test(error.message))return false;throw error;}},controlTab.id);
    const injected=await panel.evaluate(async tabId=>(await chrome.scripting.executeScript({target:{tabId},func:()=>typeof globalThis.__yuanzhuoLite!=='undefined'}))[0].result,controlTab.id);
    return {tabId:tab.id,windowId:tab.windowId,active:tab.active,owned,injected,...await control.evaluate(()=>({visibility:document.visibilityState,hidden:document.hidden,focus:document.hasFocus(),frames:__backgroundFixture.frames,nativeApis:requestAnimationFrame===__native.raf&&setTimeout===__native.timer&&setInterval===__native.interval}))};
  };
  const assertControl=(view,initialFrames)=>{
    assert.equal(view.active,false,'Control tab must stay inactive');assert.equal(view.visibility,'hidden','Control tab must stay natively hidden');assert.equal(view.hidden,true);
    assert.equal(view.frames,initialFrames,'Control native rAF must not advance');assert.equal(view.nativeApis,true);
    assert.equal(view.owned,false,'Extension must not own control debugger');assert.equal(view.injected,false,'Product content script must not be injected into control');
  };
  const views=async()=>{
    const result={};
    for(const [provider,page] of Object.entries(tabs)){
      const tab=await panel.evaluate(tabId=>chrome.tabs.get(tabId),bindings[provider].tabId);
      result[provider]={tabId:tab.id,active:tab.active,discarded:tab.discarded,autoDiscardable:tab.autoDiscardable,...await page.evaluate(()=>({visibility:document.visibilityState,hidden:document.hidden,focus:document.hasFocus(),wasDiscarded:document.wasDiscarded,frames:__backgroundFixture.frames,generating:__backgroundFixture.generating,completed:__backgroundFixture.completed,nativeApis:requestAnimationFrame===__native.raf&&setTimeout===__native.timer&&setInterval===__native.interval}))};
    }return result;
  };
  const debuggerOwned=()=>panel.evaluate(async bindings=>{
    const result={};for(const [provider,binding] of Object.entries(bindings)){
      if(!chrome.debugger){result[provider]={attached:false,error:'debugger API unavailable'};continue;}
      try{await chrome.debugger.sendCommand({tabId:binding.tabId},'Page.getFrameTree');result[provider]={attached:true};}catch(error){result[provider]={attached:false,error:error.message};}
    }return result;
  },bindings);
  // Native Windows occlusion can leave even the selected tab hidden. The positive
  // rendering control is the later extension-supported phase, not a test override.
  await panel.bringToFront();
  if(minimized)await panel.evaluate(id=>chrome.windows.update(id,{state:'minimized'}),windowId);
  await delay(300);evidence.windowBaseline=await windowState();
  if(minimized)assert.equal(evidence.windowBaseline,'minimized');
  const baselineStart=await views();
  evidence.controlBaseline=await controlView();
  assertControl(evidence.controlBaseline,evidence.controlBaseline.frames);
  assert(Object.values(baselineStart).every(view=>!view.active&&view.hidden&&view.visibility==='hidden'&&!view.discarded&&view.nativeApis),'Native background baseline must really be hidden');
  evidence.hiddenSince=new Date().toISOString();save();
  const hiddenDuration=longHidden?330000:1200;
  for(let remaining=hiddenDuration;remaining>0;){const wait=Math.min(remaining,30000);await delay(wait);remaining-=wait;if(longHidden)console.log(`Native hidden baseline: ${Math.round((hiddenDuration-remaining)/1000)}s / 330s`);}
  const baselineEnd=await views();
  evidence.controlBaselineEnd=await controlView();assertControl(evidence.controlBaselineEnd,evidence.controlBaseline.frames);
  for(const provider of Object.keys(PROVIDERS)){
    assert.equal(baselineEnd[provider].frames,baselineStart[provider].frames,provider+' hidden rAF must not advance');
    assert.equal(baselineEnd[provider].active,false);assert.equal(baselineEnd[provider].visibility,'hidden');
  }
  evidence.baseline={durationMs:hiddenDuration,start:baselineStart,end:baselineEnd,debugger:await debuggerOwned()};
  assert(Object.values(evidence.baseline.debugger).every(value=>!value.attached),'No extension debugger is attached during baseline');
  evidence.checks.push('Native non-selected tabs are hidden and visibility-dependent rendering stalls without support');save();
  console.log('PASS native hidden baseline: all three tabs hidden; native rAF stalled; no extension debugger ownership.');
  if(!baselineOnly){
    const prompt='NATIVE_BACKGROUND_CHECK：三家后台提取验证';
    await panel.locator('#prompt').fill(prompt);
    // Dispatch the same UI handler without restoring/focusing the window just to
    // make Playwright's rAF-based pointer stability checks pass. After five minutes
    // the unselected/occluded control window must not become a test focus override.
    await panel.locator('#send').dispatchEvent('click');
    await panel.waitForFunction(()=>document.querySelectorAll('.answer').length===3,undefined,{polling:100});
    const startDeadline=Date.now()+20000;
    while(Date.now()<startDeadline){const current=await views();if(Object.values(current).every(view=>view.generating)){evidence.during=current;break;}await delay(100);}
    assert(evidence.during,'All three fixture renderers must start under extension control');
    evidence.duringDebugger=await debuggerOwned();
    evidence.windowDuring=await windowState();if(minimized)assert.equal(evidence.windowDuring,'minimized');
    evidence.controlDuring=await controlView();
    assertControl(evidence.controlDuring,evidence.controlBaseline.frames);
    assert(Object.values(evidence.during).every(view=>!view.active&&!view.hidden&&view.visibility==='visible'&&view.nativeApis),'Only extension support makes three inactive tabs visible; original JS APIs remain unchanged');
    assert(Object.values(evidence.duringDebugger).every(value=>value.attached),'Extension owns all three debug attachments while collecting');
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){state=await command('state');if(state.session.rounds.at(-1)?.jobs.every(job=>job.status==='done'))break;await delay(200);}
    const jobs=state.session.rounds.at(-1)?.jobs;
    evidence.completionViews=await views();evidence.completionJobs=jobs?.map(job=>({provider:job.provider,status:job.status,text:job.text,error:job.error}));
    assert(jobs?.length===3&&jobs.every(job=>job.status==='done'),'All three must complete: '+JSON.stringify(jobs?.map(job=>({provider:job.provider,status:job.status,error:job.error}))));
    for(const job of jobs){assert(job.text.includes('NATIVE_BACKGROUND_END'));assert.equal(job.prompt,prompt);assert.deepEqual(await tabs[job.provider].evaluate(()=>__fixture.sent),[prompt]);}
    for(let attempt=0;attempt<50;attempt++){evidence.after=await views();evidence.afterDebugger=await debuggerOwned();if(Object.values(evidence.after).every(view=>view.hidden)&&Object.values(evidence.afterDebugger).every(value=>!value.attached))break;await delay(100);}
    assert(Object.values(evidence.after).every(view=>!view.active&&view.hidden&&view.visibility==='hidden'&&view.nativeApis),'Completed tabs return to native hidden state');
    assert(Object.values(evidence.afterDebugger).every(value=>!value.attached),'Completion releases all extension debug attachments');
    for(const provider of Object.keys(PROVIDERS))assert.equal(evidence.after[provider].autoDiscardable,baselineStart[provider].autoDiscardable,provider+' auto-discard policy restored');
    evidence.controlAfter=await controlView();assertControl(evidence.controlAfter,evidence.controlBaseline.frames);
    evidence.windowAfter=await windowState();if(minimized)assert.equal(evidence.windowAfter,'minimized');
    evidence.jobs=jobs.map(job=>({provider:job.provider,status:job.status,text:job.text}));
    evidence.checks.push('Real MV3 dispatch enables extension-owned support on three inactive tabs, receives complete answers, then releases support and restores hidden state');
    evidence.checks.push('Native-created control stays hidden with stalled rAF, no extension debugger ownership and no product injection before, during and after collection; completed participants regain original auto-discard policy');
    if(minimized)evidence.checks.push('Only the test-owned browser window remains minimized before, during and after collection');
    console.log('PASS extension background collection: three inactive tabs done; native hidden state and detached ownership restored.');
  }
  assert.deepEqual(failures,[]);evidence.result='PASS';save();
}catch(error){evidence.result='FAIL';evidence.error=error.stack;save();throw error;}finally{
  try{await native.close();evidence.browserClosedAt=new Date().toISOString();save();}
  catch(error){evidence.result='FAIL';evidence.cleanupError=error.stack;save();throw error;}
}
console.log(JSON.stringify({result:evidence.result,checks:evidence.checks,evidencePath}));
