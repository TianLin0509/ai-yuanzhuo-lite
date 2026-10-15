import {PROVIDERS,DEFAULT_MEMBERS,MAX_SESSIONS,ACTIVE,id,newSession,validMembers,makeRound,composePrompts,busy,providerFor,cleanUrl,sameConversation,acceptEvent,looksLikePlaceholder,validateTemplate,relayNext,relayPrompt,replaceMember,forNewcomer} from './core.js';
import {createBackgroundSupport} from './background-support.js';
import {createWorkspaces} from './workspaces.js';
import {findUpdate,compareVersions} from './update-core.js';

const INDEX='arena.index',PREFIX='arena.session.',ALARM='arena-active-recovery',MEMBERS='arena.members',TEMPLATES='arena.templates';
let index,queue=Promise.resolve(),supportWarning='';
// build.json is written by scripts/build.mjs; an unpacked extension reads the current disk copy on fetch.
const readBuild=async()=>{try{const r=await fetch(chrome.runtime.getURL('build.json'),{cache:'no-store'});return r.ok?await r.json():null;}catch{return null;}};
const runningBuild=readBuild();let diskBuild={at:0,value:null};
async function buildInfo(){if(Date.now()-diskBuild.at>15000)diskBuild={at:Date.now(),value:await readBuild()};const running=await runningBuild,disk=diskBuild.value;return {running:running?.commit||'',available:disk&&running&&disk.builtAt!==running.builtAt?disk.commit:''};}const sessions=new Map(),nativePanelState=new Map();
// One-click update: check the release sources every 6 hours (and when asked); the pages read the summary from storage.
const UPDATE='arena.update',UPDATE_ALARM='arena-update-check';
async function checkForUpdate(){
  const current=chrome.runtime.getManifest().version;let found;
  try{found=await findUpdate();}catch(error){found={manifest:null,results:[{name:'检查',ok:false,error:error.message}]};}
  const m=found.manifest,update={checkedAt:Date.now(),current,results:found.results,latest:m?{version:m.version,notes:m.notes,size:m.bundle.size,publishedAt:m.publishedAt||'',source:found.source.name}:null,available:!!m&&compareVersions(m.version,current)>0};
  await chrome.storage.local.set({[UPDATE]:update});return update;
}
chrome.alarms.get(UPDATE_ALARM).then(alarm=>{if(!alarm)return chrome.alarms.create(UPDATE_ALARM,{delayInMinutes:1,periodInMinutes:360});}).catch(error=>console.info('[AI圆桌lite] 更新检查定时器未建立',error.message));
const run=fn=>{const operation=queue.then(fn);queue=operation.catch(()=>{});return operation;};
async function loadSession(sessionId){if(!sessions.has(sessionId)){const data=await chrome.storage.local.get(PREFIX+sessionId);if(!data[PREFIX+sessionId])throw new Error('会话不存在，请刷新历史列表。');sessions.set(sessionId,data[PREFIX+sessionId]);}return sessions.get(sessionId);}
async function save(session){session.updatedAt=Date.now();const next=structuredClone(index);const meta=summarize(session);next.sessions=next.sessions.filter(s=>s.id!==session.id);next.sessions.unshift(meta);await chrome.storage.local.set({[PREFIX+session.id]:session,[INDEX]:next});index=next;sessions.set(session.id,session);}
// activeAt is the last question or answer: closing or reconnecting a roundtable does not make it look recent.
function summarize(session){const createdAt=session.createdAt||session.updatedAt;return {id:session.id,title:session.title,createdAt,updatedAt:session.updatedAt,activeAt:Math.max(createdAt,...session.rounds.flatMap(r=>[r.createdAt||0,...r.jobs.map(j=>j.updatedAt||0)])),rounds:session.rounds.length,members:[...session.members]};}
async function mutate(sessionId,fn){return run(async()=>{const copy=structuredClone(await loadSession(sessionId));const result=fn(copy);await save(copy);return result;});}
async function init(){
  const data=await chrome.storage.local.get(INDEX);index=data[INDEX];
  if(!index){const session=newSession([...DEFAULT_MEMBERS]);index={schema:1,currentId:session.id,sessions:[]};await save(session);}
  // Earlier builds kept only id/title/updatedAt/rounds; fill in the rest once, keeping the order and timestamps.
  if(index.sessions.some(m=>!m.members||!m.activeAt)){const next=structuredClone(index);for(let i=0;i<next.sessions.length;i++){const m=next.sessions[i];if(m.members&&m.activeAt)continue;const data=await chrome.storage.local.get(PREFIX+m.id),full=data[PREFIX+m.id];if(full)next.sessions[i]={...summarize(full),updatedAt:m.updatedAt};}await chrome.storage.local.set({[INDEX]:next});index=next;}
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});
  const ephemeral=await chrome.storage.session.get(null),panelKeys=Object.keys(ephemeral).filter(k=>k.startsWith('arena.panel.'));
  const livePanels=chrome.runtime.getContexts?new Set((await chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']})).map(c=>c.documentId)):new Set();
  for(const key of panelKeys){const windowId=Number(key.slice('arena.panel.'.length));if(chrome.sidePanel.onClosed&&livePanels.has(ephemeral['arena.panel-document.'+windowId]))nativePanelState.set(windowId,ephemeral[key]);else await chrome.storage.session.remove(key);}
}
const initialized=init();
// The members last chosen by the user seed new roundtables; unknown or invalid saved sets fall back.
let preferredMembers=[...DEFAULT_MEMBERS];const membersLoaded=chrome.storage.local.get(MEMBERS).then(data=>{if(validMembers(data[MEMBERS]))preferredMembers=data[MEMBERS];});
async function createSession(members){return run(async()=>{if(index.sessions.length>=MAX_SESSIONS)throw new Error(`已保存 ${MAX_SESSIONS} 场圆桌。请先导出并删除旧记录。`);const session=newSession(members);await save(session);return session;});}
const workspaces=createWorkspaces(chrome,{loadSession,createSession,mutate,getIndex:()=>index,providers:PROVIDERS,defaultMembers:()=>preferredMembers,providerFor});
const support=createBackgroundSupport(chrome,{onLost:async event=>{await initialized;await supportLost(event);},onError:error=>{supportWarning=error.message;console.error('[AI圆桌lite] 后台支持异常',error);}});
const ready=Promise.all([initialized,support.ready,workspaces.ready,membersLoaded]);
function findJob(session,roundId,jobId){return session.rounds.find(r=>r.id===roundId)?.jobs.find(j=>j.id===jobId);}
async function updateJob(ref,fn){return mutate(ref.sessionId,s=>{const job=findJob(s,ref.roundId,ref.jobId);if(!job)throw new Error('本轮任务已不存在。');if(ref.requestId&&job.requestId!==ref.requestId)return null;return fn(job,s);});}
async function readJob(ref){const job=findJob(await loadSession(ref.sessionId),ref.roundId,ref.jobId);return ref.requestId&&job?.requestId!==ref.requestId?null:job;}
async function supportedJob(ref){const job=await readJob(ref);if(!job||!ACTIVE.has(job.status))return null;if(!support.has(job.tabId,job.requestId))throw new Error('本轮后台支持已中断，尚未执行后续网页操作；请核对原网页。');await workspaces.validateTab(ref.sessionId,await chrome.tabs.get(job.tabId));return job;}
async function removeSession(sessionId){await run(async()=>{if(!index.sessions.some(m=>m.id===sessionId))return;const next={...index,sessions:index.sessions.filter(m=>m.id!==sessionId)};if(next.currentId===sessionId)next.currentId=next.sessions[0].id;await chrome.storage.local.set({[INDEX]:next});index=next;await chrome.storage.local.remove([PREFIX+sessionId,'arena.draft.'+sessionId,'arena.reader.'+sessionId]);sessions.delete(sessionId);});}
async function discardIfEmpty(sessionId){
  // Owner check stays outside run(): workspaces may be waiting on run() to create a session.
  if(!sessionId||await workspaces.owner(sessionId)||index.sessions.length<=1)return false;
  const s=await loadSession(sessionId).catch(()=>null),draft=(await chrome.storage.local.get('arena.draft.'+sessionId))['arena.draft.'+sessionId];
  if(!s||s.rounds.length||draft?.text?.trim())return false;
  await removeSession(sessionId);return true;
}
async function requestActive(requestId){await queue;for(const meta of index.sessions){for(const round of (await loadSession(meta.id)).rounds)if(round.jobs.some(job=>(!requestId||job.requestId===requestId)&&ACTIVE.has(job.status)))return true;}return false;}
let alarmQueue=Promise.resolve();
function alarm(){const task=alarmQueue.then(async()=>{
  try{await support.reconcile(requestActive);supportWarning='';}catch(error){supportWarning=error.message;console.error('[AI圆桌lite] 后台支持释放失败',error);}
  if(await requestActive()||supportWarning){if(!await chrome.alarms.get(ALARM))await chrome.alarms.create(ALARM,{periodInMinutes:0.5});}else await chrome.alarms.clear(ALARM);
 });alarmQueue=task.catch(()=>{});return task;
}
async function supportLost(event){
  for(const meta of index.sessions){const s=await loadSession(meta.id);for(const r of s.rounds){const job=r.jobs.find(j=>j.requestId===event.requestId&&j.tabId===event.tabId);if(!job||!ACTIVE.has(job.status))continue;
    await updateJob({sessionId:s.id,roundId:r.id,jobId:job.id,requestId:job.requestId},j=>{if(ACTIVE.has(j.status)){j.status=j.phase==='attempted'?'attention':'error';j.error=event.reason+'。请打开原网页核对后重新提取；不会自动重发。';j.updatedAt=Date.now();}});
    try{const target=(await chrome.debugger.getTargets()).find(t=>t.tabId===event.tabId&&t.type==='page');if(event.targetId&&target?.id===event.targetId)await pageMessage(event.tabId,{type:'YZ_STOP',requestId:event.requestId,stopGeneration:false});}catch(error){console.info('[AI圆桌lite] 已中断的网页读取无法确认停止：',error.message);}
  }}
}
async function releaseSupport(ref){const job=await readJob(ref);if(job?.tabId)try{await support.release(job.tabId,ref.requestId||job.requestId);}catch(error){supportWarning=error.message;await updateJob(ref,j=>{j.error=[j.error,error.message].filter(Boolean).join('；');});}}
// Chrome reclaims idle background tabs (Memory Saver). A reclaimed member page is reloaded in place, in the
// background and without switching tabs, before anything is typed; its address (the bound chat) is kept.
async function restoreIfDiscarded(tab){if(!tab.discarded)return tab;await chrome.tabs.reload(tab.id);return chrome.tabs.get(tab.id);}
async function waitForTab(tabId){const start=Date.now();while(Date.now()-start<20000){const tab=await chrome.tabs.get(tabId);if(tab.status==='complete')return tab;await new Promise(resolve=>setTimeout(resolve,300));}throw new Error('网页仍在加载。请打开网页检查网络或登录，再重试。');}
function provisionalRecovery(provider,binding,url,job){
  if(provider!=='doubao'||job?.phase!=='attempted'||!/^block_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(job.anchor?.key||'')||!job.anchor?.textHash||cleanUrl(job.url)!==cleanUrl(binding?.url))return false;
  try{const before=new URL(binding.url),after=new URL(url);return before.origin===after.origin&&/^\/chat\/local[_-][^/]+\/?$/.test(before.pathname)&&/^\/chat\/\d+\/?$/.test(after.pathname);}catch{return false;}
}
const LOST_CHAT='没能回到当时的对话：网站打开了新对话（常见于未登录或对话已删除）。旧回答仍在记录里；下一轮在新对话继续，这一家看不到之前的上下文。';
function startedChat(provider,saved,here){const pattern=PROVIDERS[provider].conversation;try{return !!pattern&&providerFor(here)===provider&&!pattern.test(new URL(saved).pathname)&&pattern.test(new URL(here).pathname);}catch{return false;}}
// After a send from a new-chat page the site moves to the chat it created. If reading then fails, record that
// address now (the tab id is certainly valid in this browser session) so later reloads re-bind by exact address.
// Only right after our own send fails, only for this roundtable's tab in its own window, and only with positive
// evidence: the chat's latest question must be this round's text. A chat the user opened is never adopted.
// Same rule as promptShown in the content script: the site may render Markdown or linkify URLs in the question.
const letters=text=>String(text).replace(/[\s\p{P}\p{S}\p{Z}]/gu,'').toLowerCase();
function promptShown(text,prompt){const page=letters(text),want=[...letters(prompt)];if(!want.length)return false;if(page.includes(want.join('')))return true;if(page.length>want.length*1.2+40)return false;let i=0;for(const ch of page)if(ch===want[i]&&++i===want.length)return true;return false;}
async function followStartedChat(ref){try{
  const s=await loadSession(ref.sessionId),job=findJob(s,ref.roundId,ref.jobId),binding=s.bindings[job?.provider];if(!job?.tabId||!job.prompt||job.phase!=='attempted'||binding?.tabId!==job.tabId)return;
  const tab=await chrome.tabs.get(job.tabId),here=tab.url||'';if(tab.windowId!==await workspaces.owner(ref.sessionId)||!startedChat(job.provider,binding.url,here))return;
  const page=await pageMessage(tab.id,{type:'YZ_LATEST_QUESTION',provider:job.provider});if(!page.question||cleanUrl(page.url)!==cleanUrl(here)||!promptShown(page.question,job.prompt))return;
  await mutate(ref.sessionId,x=>{if(x.bindings[job.provider]?.tabId===tab.id&&x.bindings[job.provider].url===binding.url)x.bindings[job.provider]={tabId:tab.id,url:here};});
}catch(error){console.info('[AI圆桌lite] 未能记录新对话地址',error.message);}}
function fellBack(provider,saved,here){const pattern=PROVIDERS[provider].conversation;try{return !!pattern&&providerFor(here)===provider&&pattern.test(new URL(saved).pathname)&&!pattern.test(new URL(here).pathname);}catch{return false;}}
async function connection(sessionId,provider,{focus=false,verifyConversation=false,rereadJob=null}={}){
  const ownerWindow=await workspaces.requireWindow(sessionId);
  const session=await loadSession(sessionId);let tab=null,binding=session.bindings[provider];
  if(binding?.tabId){try{tab=await chrome.tabs.get(binding.tabId);}catch(error){if(!/No tab|Invalid tab/i.test(error.message))throw error;}}
  if(tab)await workspaces.validateTab(sessionId,tab);
  if(tab&&providerFor(tab.url||tab.pendingUrl)!==provider)throw new Error(`${PROVIDERS[provider].name} 的标签页已离开对应网站，请重新连接。`);
  if(tab&&binding?.url&&verifyConversation&&!sameConversation(provider,tab.url||tab.pendingUrl,binding.url)&&!provisionalRecovery(provider,binding,tab.url||tab.pendingUrl,rereadJob)){
    // A saved chat the site could not load (signed out, deleted) falls back to its new-chat page. Nothing is sent;
    // the member continues in the new chat only after the user presses retry, knowing the context is gone.
    const here=tab.url||tab.pendingUrl;
    if(!rereadJob&&fellBack(provider,binding.url,here)){await mutate(sessionId,s=>{if(s.bindings[provider]?.tabId===tab.id)s.bindings[provider]={tabId:tab.id,url:here,note:LOST_CHAT};});throw Object.assign(new Error(`${PROVIDERS[provider].name} 网页没有停在原来的对话，打开的是新对话，本次没有发送。点“重试发送”会在新对话里继续，这一家看不到之前的上下文。`),{notSent:true});}
    // Sent from a new-chat page, the site then moved to the chat it created; reading failed before the address was
    // recorded. Re-reading there is allowed: the page must still show this round's question (unless the user forces).
    if(rereadJob?.phase==='attempted'&&startedChat(provider,binding.url,here))return tab;
    throw new Error('该标签页已切换到其他对话。请点“原网页”回到本轮绑定的对话，再重试。');
  }
  if(!tab){tab=await chrome.tabs.create({windowId:ownerWindow,url:binding?.url||PROVIDERS[provider].url,active:focus});await mutate(sessionId,s=>{s.bindings[provider]={tabId:tab.id,url:tab.url||tab.pendingUrl||PROVIDERS[provider].url};});}
  if(focus){await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});}
  return tab;
}
async function inject(tabId,provider){const tab=await chrome.tabs.get(tabId);if(providerFor(tab.url)!==provider)throw new Error('网页地址不属于本轮 AI，已停止操作。');await chrome.scripting.executeScript({target:{tabId},files:['adapters.js','content.js'],world:'ISOLATED'});}
async function pageMessage(tabId,message){const result=await chrome.tabs.sendMessage(tabId,message,{frameId:0});if(!result?.ok)throw Object.assign(new Error(result?.error||'网页没有确认操作，请打开原网页检查。'),{code:result?.code,question:result?.question,notSent:result?.notSent});return result;}
async function dispatch(ref){
  try{
    let job=await readJob(ref);if(!job||!ACTIVE.has(job.status))return;
    ref={...ref,requestId:job.requestId};
    await updateJob(ref,j=>{if(ACTIVE.has(j.status)){j.status='preparing';j.startedAt=Date.now();}});
    const tab=await restoreIfDiscarded(await connection(ref.sessionId,job.provider,{verifyConversation:true}));await waitForTab(tab.id);
    job=await readJob(ref);if(!job||!ACTIVE.has(job.status))return;
    await updateJob(ref,j=>{j.tabId=tab.id;});await support.acquire(tab.id,job.requestId,job.provider);
    job=await readJob(ref);if(!job||!ACTIVE.has(job.status)){await support.release(tab.id,ref.requestId);return;}
    await inject(tab.id,job.provider);
    job=await supportedJob(ref);if(!job){await support.release(tab.id,ref.requestId);return;}
    // Our own earlier questions to this site (recent rounds): if one never went out, the page may still hold it.
    const stale=(await loadSession(ref.sessionId)).rounds.slice(-6).flatMap(r=>r.jobs).filter(j=>j.provider===job.provider&&j.id!==job.id&&j.prompt).map(j=>j.prompt);
    const preparation=await pageMessage(tab.id,{type:'YZ_PREPARE',provider:job.provider,prompt:job.prompt,stale,clearDraft:ref.clearDraft||''});
    await workspaces.validateTab(ref.sessionId,await chrome.tabs.get(tab.id));
    if(!sameConversation(job.provider,preparation.url,(await loadSession(ref.sessionId)).bindings[job.provider].url))throw new Error('准备发送时网页已切换对话，已取消发送。请点“原网页”核对。');
    await updateJob(ref,j=>{if(ACTIVE.has(j.status)){j.baseline=preparation.baseline;j.url=preparation.url;j.mode=preparation.mode||'';j.status='sending';j.phase='prepared';}});
    job=await supportedJob(ref);if(!job){await support.release(tab.id,ref.requestId);return;}
    // Persist the uncertain boundary BEFORE the page can click. A restart never blindly repeats SEND.
    await updateJob(ref,j=>{if(ACTIVE.has(j.status))j.phase='attempted';});
    job=await supportedJob(ref);if(!job){await support.release(tab.id,ref.requestId);return;}
    await pageMessage(tab.id,{type:'YZ_SEND',provider:job.provider,requestId:job.requestId,prompt:job.prompt,baseline:job.baseline});
  }catch(error){await followStartedChat(ref);await updateJob(ref,j=>{if(ACTIVE.has(j.status)){
    // The page reports a failure before its Send click as definitely not sent, so a retry cannot duplicate it.
    if(error.notSent===true)j.phase='not_sent';
    // Text found in the site's box that is not ours: kept so the user can see it and choose to clear it.
    j.pageDraft=error.code==='PAGE_DRAFT'&&typeof error.question==='string'?error.question:'';
    j.status=j.phase==='attempted'?'attention':'error';j.error=error.message;j.updatedAt=Date.now();}});await releaseSupport(ref);}
}
async function locateEvent(event,sender){
  if(!sender.tab||sender.frameId!==0)return false;
  for(const meta of index.sessions){const session=await loadSession(meta.id);for(const round of session.rounds){const job=round.jobs.find(j=>j.requestId===event.requestId);if(!job)continue;
    if(!acceptEvent(job,event,sender.tab.id)||providerFor(sender.url)!==job.provider||providerFor(event.url)!==job.provider)return false;
    if(!['sent','unconfirmed','streaming','done','attention'].includes(event.status))return false;
    const ref={sessionId:session.id,roundId:round.id,jobId:job.id,requestId:job.requestId};
    await updateJob(ref,(j,s)=>{if(!acceptEvent(j,event,sender.tab.id))return;j.sequence=event.sequence;j.status=event.status;j.text=typeof event.text==='string'?event.text:j.text;j.format=event.format||'plain';j.error=event.error||'';j.url=event.url;j.phase=event.phase;if(event.anchor)j.anchor=event.anchor;j.updatedAt=Date.now();s.bindings[j.provider]={tabId:j.tabId,url:j.url};
      if(j.status==='done'&&s.rounds.find(x=>x.id===round.id)?.kind==='summary'&&looksLikePlaceholder(j.text)){j.status='attention';j.error='队长总结只有开场白或很短，完整内容可能写进了网页的文档或卡片。请打开原网页核对，写完后点“确认已完成”，或在新一轮要求直接在对话正文写出。';}});
    await alarm();if(round.kind==='relay')advanceLater(session.id,round.id);return true;
  }}return false;
}
// Workflow rounds: when a member finishes (or is skipped), compose the next member's prompt from the answers so
// far and send it. Claiming the job inside mutate() means two events can never send the same turn twice.
async function advanceRelay(sessionId,roundId){
  const templates=(await chrome.storage.local.get(TEMPLATES))[TEMPLATES]||{};
  const jobId=await mutate(sessionId,s=>{
    const r=s.rounds.find(x=>x.id===roundId);if(!r||s.rounds.at(-1)?.id!==roundId)return null;const i=relayNext(r);if(i<0)return null;const job=r.jobs[i];
    try{job.prompt=forNewcomer(s,job.provider,relayPrompt(r,i,templates),s.rounds.length-1);job.status='queued';}catch(error){job.status='error';job.phase='not_sent';job.error=error.message;}
    job.updatedAt=Date.now();return job.status==='queued'?job.id:null;
  });
  if(jobId){await alarm();await dispatch({sessionId,roundId,jobId});await alarm();}
}
const advanceLater=(sessionId,roundId)=>{advanceRelay(sessionId,roundId).catch(error=>console.error('[AI圆桌lite] 工作流推进失败',error));};
// Marks the round stopped in the same transaction, so a workflow turn being claimed right now either sees the mark
// (and never starts) or was claimed first (and is then stopped with the other active members).
async function stopWaiting(sessionId,roundId){await mutate(sessionId,s=>{const r=s.rounds.find(x=>x.id===roundId);if(!r)return;if(r.kind==='relay')r.stopped=true;for(const j of r.jobs)if(j.status==='waiting'){j.status='stopped';j.updatedAt=Date.now();}});}
async function recover(){
  for(const meta of index.sessions){const session=await loadSession(meta.id);for(const round of session.rounds){for(const job of round.jobs){if(!ACTIVE.has(job.status)||Date.now()-job.updatedAt<45000)continue;
    let active=false;try{if(job.tabId&&support.has(job.tabId,job.requestId)){const result=await pageMessage(job.tabId,{type:'YZ_STATUS',requestId:job.requestId});active=result.active;}}catch(error){console.info('[AI圆桌lite] 恢复检查：',error.message);}
    if(!active)await updateJob({sessionId:session.id,roundId:round.id,jobId:job.id,requestId:job.requestId},j=>{if(ACTIVE.has(j.status)){j.status='attention';j.error='网页或扩展连接已重启。请打开原网页并重新提取；不会自动重发。';}});
  }}
    const last=session.rounds.at(-1);if(relayNext(last)>=0&&await workspaces.owner(session.id))advanceLater(session.id,last.id);
  }await alarm();
}
// Detaches the roundtable from a member's earlier request (its page reader and debugger hold) without touching the
// record. stopGeneration also asks the site to stop answering, which a resend needs and a re-read must not do.
async function detach(job,{stopGeneration}){if(!job.tabId)return;try{await pageMessage(job.tabId,{type:'YZ_STOP',requestId:job.requestId,stopGeneration});}catch(error){console.info('[AI圆桌lite] 旧请求停止未确认',error.message);}try{await support.release(job.tabId,job.requestId);}catch(error){supportWarning=error.message;}}
async function stopJob(ref,{skip=false}={}){
  const job=await readJob(ref);if(!job)return;
  ref={...ref,requestId:job.requestId};
  await updateJob(ref,j=>{j.status=skip?'skipped':'stopped';j.error='';j.updatedAt=Date.now();});
  // Only a running member has anything to stop on its page; skipping a finished answer just leaves it out of the round.
  if(job.tabId&&ACTIVE.has(job.status)){try{const result=await pageMessage(job.tabId,{type:'YZ_STOP',requestId:job.requestId,stopGeneration:true});if(!result.pageStopped&&!skip)await updateJob(ref,j=>{j.error='已停止圆桌读取。原网页若仍在生成，可在原网页手动停止。';});}catch(error){await updateJob(ref,j=>{j.error='已停止圆桌读取；原网页未确认停止：'+error.message;});}}
  await releaseSupport(ref);
}
const urlOnly=bindings=>Object.fromEntries(Object.entries(bindings||{}).map(([p,b])=>[p,{url:b.url}]));
const mainPage=sessionId=>chrome.runtime.getURL('main.html')+'?session='+encodeURIComponent(sessionId);
// Leaves this window's roundtable (record kept) and puts `next` (or a new empty one) in its place.
async function switchWindow(windowId,next){
  const currentId=await workspaces.ownerForWindow(windowId),current=currentId&&await loadSession(currentId);
  if(current&&busy(current))throw new Error('本轮还在进行，请先停止再关闭这场圆桌。');
  if(next){await loadSession(next);const holder=await workspaces.owner(next);if(holder&&holder!==windowId)throw new Error('这场圆桌已在另一个窗口打开，请从历史列表切到那个窗口。');if(busy(await loadSession(next)))throw new Error('这场圆桌还有进行中的回答，请在它的窗口停止后再打开。');}
  if(next&&next===currentId)return next;
  // A tab opened a moment ago may not have committed its address yet; it is still the one this roundtable opened.
  const closing=[];
  if(current)for(const [provider,binding] of Object.entries(current.bindings||{})){if(!binding.tabId)continue;try{const tab=await chrome.tabs.get(binding.tabId);const address=tab.url||tab.pendingUrl||'';if(tab.windowId===windowId&&(providerFor(address)===provider||/^(about:blank)?$/.test(address)))closing.push(tab.id);}catch(error){if(!/No tab|Invalid tab/i.test(error.message))throw error;}}
  const target=next||(await createSession([...preferredMembers])).id;
  // Reserve the window first. If another window takes `next` meanwhile, nothing here has changed yet.
  try{await workspaces.assign(windowId,target);}catch(error){if(!next)await discardIfEmpty(target);throw error;}
  if(current)await mutate(current.id,s=>{s.bindings=urlOnly(s.bindings);});
  // Recovered bindings keep only the saved conversation URLs; stale tab IDs are never trusted.
  if(next)await mutate(next,s=>{s.bindings=urlOnly(s.bindings);});
  const tabs=await chrome.tabs.query({windowId}),mains=tabs.filter(t=>(t.url||t.pendingUrl||'').split(/[?#]/,1)[0]===chrome.runtime.getURL('main.html'));
  for(const tab of mains)await chrome.tabs.update(tab.id,{url:mainPage(target)});
  // Closing every tab would close the window (and its side panel), so keep the record page open.
  if(!mains.length&&tabs.every(t=>closing.includes(t.id)))await chrome.tabs.create({windowId,url:mainPage(target),active:true});
  if(closing.length)await chrome.tabs.remove(closing);
  if(currentId)await discardIfEmpty(currentId);
  return target;
}
// One switch per window at a time, including opening the new members: a double click must not interleave
// two switches and leave the first one's freshly opened tabs behind.
const windowSwitches=new Map();
function perWindow(windowId,fn){const previous=windowSwitches.get(windowId)||Promise.resolve(),next=previous.catch(()=>{}).then(fn);windowSwitches.set(windowId,next);next.finally(()=>{if(windowSwitches.get(windowId)===next)windowSwitches.delete(windowId);}).catch(()=>{});return next;}
async function openMembers(sessionId){const s=await loadSession(sessionId);for(const provider of s.members)await connection(sessionId,provider);checkLater(sessionId);}
// Right after connecting, find out which pages need the user (sign in, verification, quota) before anything is sent.
async function checkMembers(sessionId){
  const s=await loadSession(sessionId);
  await Promise.all(s.members.map(async provider=>{const tabId=s.bindings[provider]?.tabId;if(!tabId)return;let health='';
    try{await restoreIfDiscarded(await chrome.tabs.get(tabId));await waitForTab(tabId);await inject(tabId,provider);health=(await pageMessage(tabId,{type:'YZ_PROBE',provider})).state;}catch(error){console.info('[AI圆桌lite] 成员网页检查未完成',provider,error.message);return;}
    await mutate(sessionId,x=>{const b=x.bindings[provider];if(b?.tabId===tabId)x.bindings[provider]={...b,health,checkedAt:Date.now()};});}));
}
const checkLater=sessionId=>{checkMembers(sessionId).catch(error=>console.info('[AI圆桌lite] 成员网页检查失败',error.message));};
// After reopening saved conversations, check that each site really stayed there. A site that cannot load the
// chat (signed out, chat deleted) sends the tab to a new chat; say so on the member row and continue there.
async function verifyRecovered(sessionId){
  const s=await loadSession(sessionId);
  await Promise.all(s.members.map(async provider=>{
    const b=s.bindings[provider],pattern=PROVIDERS[provider].conversation;let saved;
    try{saved=new URL(b?.url);}catch{return;}
    if(!b.tabId||!pattern?.test(saved.pathname))return;
    // Watch the address rather than the load state: some sites keep loading long after they have redirected.
    let url='';for(let i=0;i<120;i++){const tab=await chrome.tabs.get(b.tabId).catch(()=>null);if(!tab)return;url=tab.url||tab.pendingUrl||'';if(url&&!sameConversation(provider,url,b.url))break;await new Promise(r=>setTimeout(r,500));}
    if(sameConversation(provider,url,b.url)||providerFor(url)!==provider)return;
    const landing=fellBack(provider,b.url,url),note=landing?LOST_CHAT:'网站打开了另一个对话，不是当时那一个。请在网页核对后再继续。';
    await mutate(sessionId,x=>{const now=x.bindings[provider];if(now?.tabId!==b.tabId)return;x.bindings[provider]=landing?{tabId:b.tabId,url,note}:{...now,note};});
  }));
}
const verifyLater=sessionId=>{verifyRecovered(sessionId).catch(error=>console.info('[AI圆桌lite] 找回核对失败',error.message));};
async function state(sessionId=index.currentId,windowId=null){await queue;const key='arena.draft.'+sessionId,data=await chrome.storage.local.get(['arena.preferences',key]);if(!data[key]){const legacy=await chrome.storage.session.get('draft.'+sessionId);if(typeof legacy['draft.'+sessionId]==='string')data[key]=await run(async()=>{const current=await chrome.storage.local.get(key);if(current[key])return current[key];const draft={text:legacy['draft.'+sessionId],kind:'ask',revision:Date.now()*1000,writer:'migration'};await chrome.storage.local.set({[key]:draft});return draft;});}const templates=(await chrome.storage.local.get(TEMPLATES))[TEMPLATES]||{};return {index:structuredClone(index),session:structuredClone(await loadSession(sessionId)),open:await workspaces.snapshot(),windowId,templates,providers:PROVIDERS,supportWarning,build:await buildInfo(),preferences:data['arena.preferences']||{layout:'a'},draft:data[key]||{text:'',kind:'ask',captain:'deepseek',depth:'简要结论',style:'debate'}};}
async function command(message){
  let callerSessionId=message.sessionId||index.currentId;
  if(Number.isInteger(message.windowId)){
    const owned=await workspaces.claim(message.windowId,message.action==='state'?message.sessionId:undefined);
    callerSessionId=owned;
    if(!['state','new','select','delete','preferences','template','close-here','new-here','open-here'].includes(message.action)&&message.sessionId&&message.sessionId!==owned)throw new Error('此操作属于另一场圆桌，已阻止跨窗口发送。');
    if(!['select','delete','open-here'].includes(message.action))message={...message,sessionId:owned};
    const own=await loadSession(owned),last=own.rounds.at(-1);if(relayNext(last)>=0)advanceLater(owned,last.id);
  }
  // Window moves change the owner mid-command, so state follows the window rather than the old id.
  const state=async()=>globalState(Number.isInteger(message.windowId)?await workspaces.ownerForWindow(message.windowId)||callerSessionId:callerSessionId,message.windowId??null);
  const templates=async()=>(await chrome.storage.local.get(TEMPLATES))[TEMPLATES]||{};
  switch(message.action){
    case 'state':return state();
    case 'checkUpdate':return {update:await checkForUpdate()};
    case 'update':{
      // Reload in place so the extension ID, history and window ownership survive (see restoreAfterReload).
      for(const meta of index.sessions)if(busy(await loadSession(meta.id)))throw new Error('还有进行中的圆桌，请等本轮结束或停止后再更新。');
      setTimeout(()=>chrome.runtime.reload(),150);return {...await state(),reloading:true};
    }
    case 'preferences':{if(!['a','b','c'].includes(message.layout))throw new Error('未知阅读视图。');await chrome.storage.local.set({'arena.preferences':{layout:message.layout}});return state();}
    case 'draft':{const draft=await run(async()=>{const key='arena.draft.'+message.sessionId,data=await chrome.storage.local.get(key),draft=data[key]||{};if(message.revision&&message.revision<=(draft.lastInputRevision||0))return draft;if(message.baseRevision!==undefined&&message.baseRevision!==(draft.revision||0)&&message.writer!==draft.writer)throw new Error('草稿已在另一处改变。未保存的输入仍在本地备份中，请核对两份文字后再使用。');for(const k of ['text','kind','captain','depth','style','order'])if(typeof message.patch?.[k]==='string')draft[k]=message.patch[k];draft.revision=Math.max(Date.now()*1000,(draft.revision||0)+1,message.revision||0);draft.lastInputRevision=message.revision||draft.revision;draft.writer=message.writer||'command';await chrome.storage.local.set({[key]:draft});return draft;});return {sessionId:message.sessionId,draft};}
    case 'quote':{await run(async()=>{const s=await loadSession(message.sessionId),r=s.rounds.find(r=>r.id===message.roundId),j=r?.jobs.find(j=>j.id===message.jobId);if(!j?.text)throw new Error('这份回答暂无可引用的正文。');const key='arena.draft.'+s.id,data=await chrome.storage.local.get(key),draft=data[key]||{},stamp=new Date(r.createdAt).toLocaleString('zh-CN',{hour12:false});await chrome.storage.local.set({[key]:{...draft,text:(draft.text||'')+`\n\n【引用 ${stamp} · ${PROVIDERS[j.provider].name}】\n${j.text}\n【引用结束】`,revision:Math.max(Date.now()*1000,(draft.revision||0)+1),writer:'quote'}});});return state();}
    case 'preview':{const s=await loadSession(message.sessionId);return {...await state(),prompts:composePrompts(message.kind,message.text,s,{...message.options,templates:await templates()}),baseRoundId:s.rounds.at(-1)?.id||null};}
    case 'main':{const opened=await workspaces.main(message.sessionId);return {...await state(),opened};}
    case 'template':{
      // Presets are shared by every roundtable; null restores the built-in text.
      await run(async()=>{const all=await templates();if(message.text===null)delete all[message.key];else all[message.key]=validateTemplate(message.key,message.text);await chrome.storage.local.set({[TEMPLATES]:all});});return state();
    }
    case 'close-here':{requireWindowId(message);await perWindow(message.windowId,()=>switchWindow(message.windowId,null));return state();}
    case 'new-here':{requireWindowId(message);await perWindow(message.windowId,async()=>openMembers(await switchWindow(message.windowId,null)));return state();}
    case 'open-here':{requireWindowId(message);const holder=await workspaces.owner(message.sessionId);if(holder&&holder!==message.windowId){const opened=await workspaces.main(message.sessionId);return {...await state(),opened};}await perWindow(message.windowId,async()=>openMembers(await switchWindow(message.windowId,message.sessionId)));verifyLater(message.sessionId);return state();}
    case 'new':{const session=await createSession(message.members||[...preferredMembers]);const opened=await workspaces.main(session.id);for(const provider of session.members)await connection(session.id,provider);return {...await state(),opened};}
    case 'select':{await loadSession(message.sessionId);const reopening=!await workspaces.owner(message.sessionId);const opened=await workspaces.main(message.sessionId);const s=await loadSession(message.sessionId);for(const p of s.members)await connection(s.id,p);if(reopening)verifyLater(s.id);return {...await state(),opened};}
    case 'members':{await mutate(message.sessionId,s=>{if(busy(s))throw new Error('请先等待或停止本轮，再更改成员。');newSession(message.members);s.members=message.members;});preferredMembers=[...message.members];await chrome.storage.local.set({[MEMBERS]:preferredMembers});return state();}
    case 'replace':{
      const all=await templates(),result=await mutate(message.sessionId,s=>{const r=replaceMember(s,message.provider,message.replacement,all);return {roundId:s.rounds.at(-1)?.id,kind:s.rounds.at(-1)?.kind,job:r.job&&r.job.id,previous:r.previous,members:[...s.members]};});
      preferredMembers=result.members;await chrome.storage.local.set({[MEMBERS]:preferredMembers});
      if(result.previous)await detach(result.previous,{stopGeneration:true});
      await alarm();if(result.job)await dispatch({sessionId:message.sessionId,roundId:result.roundId,jobId:result.job});
      if(result.kind==='relay')advanceLater(message.sessionId,result.roundId);await alarm();return state();
    }
    case 'connect':{const s=await loadSession(message.sessionId);for(const provider of s.members){const binding=s.bindings[provider],windowId=await workspaces.owner(s.id);if(binding?.tabId&&windowId){let tab;try{tab=await chrome.tabs.get(binding.tabId);}catch(e){if(!/No tab|Invalid tab/i.test(e.message))throw e;}if(tab&&(tab.windowId!==windowId||providerFor(tab.url||tab.pendingUrl)!==provider)){if(busy(s))throw new Error('请先停止本轮，再重新连接已移动的成员。');await mutate(s.id,copy=>{copy.bindings[provider]={url:binding.url};});}}await connection(s.id,provider);}checkLater(s.id);return state();}
    case 'open-answer':{const s=await loadSession(message.sessionId),r=s.rounds.find(r=>r.id===message.roundId),j=r?.jobs.find(j=>j.id===message.jobId);if(!j?.url||providerFor(j.url)!==j.provider)throw new Error('这份记录尚无可核对的原网页地址。');const windowId=await workspaces.owner(s.id),tabs=await chrome.tabs.query(windowId?{windowId}:{});const tab=tabs.find(t=>cleanUrl(t.url)===cleanUrl(j.url));if(tab)await chrome.tabs.update(tab.id,{active:true});else await chrome.tabs.create({...(windowId?{windowId}:{}),url:j.url,active:true});return state();}
    case 'open':{if(!PROVIDERS[message.provider])throw new Error('未知成员。');const session=await loadSession(message.sessionId);const bound=session.bindings[message.provider];const tab=await connection(session.id,message.provider,{focus:true});if(bound?.url&&cleanUrl(tab.url)!==cleanUrl(bound.url))await chrome.tabs.update(tab.id,{url:bound.url});return state();}
    case 'start':{
      const options={...message.options,templates:await templates()};
      // Starting a round shares the window's switch queue, so closing or replacing this roundtable either sees
      // the new round (and refuses) or runs first (and this start is refused), never half of each.
      const create=async()=>{if(Number.isInteger(message.windowId)&&await workspaces.ownerForWindow(message.windowId)!==message.sessionId)throw new Error('这个窗口已换成另一场圆桌，本次没有发送。');return mutate(message.sessionId,s=>{if(message.baseRoundId!==undefined&&message.baseRoundId!==(s.rounds.at(-1)?.id||null))throw new Error('最新轮次已经改变，请核对侧栏后再发送。');const r=makeRound(message.kind,message.text,s,options);s.rounds.push(r);if(s.rounds.length===1)s.title=r.prompt.slice(0,32)||'新的圆桌';return structuredClone(r);});};
      const round=await (Number.isInteger(message.windowId)?perWindow(message.windowId,create):create());
      await run(async()=>{const key='arena.draft.'+message.sessionId,data=await chrome.storage.local.get(key);if(data[key]?.text===message.text)await chrome.storage.local.set({[key]:{...data[key],text:'',revision:Math.max(Date.now()*1000,(data[key].revision||0)+1),writer:'sent'}});});
      await alarm();await Promise.all(round.jobs.map(j=>dispatch({sessionId:message.sessionId,roundId:round.id,jobId:j.id})));await alarm();return state();
    }
    case 'stop':{const s=await loadSession(message.sessionId),r=s.rounds.find(r=>r.id===message.roundId);if(!r)throw new Error('轮次不存在。');await stopWaiting(s.id,r.id);const fresh=(await loadSession(s.id)).rounds.find(x=>x.id===r.id);await Promise.all(fresh.jobs.filter(j=>ACTIVE.has(j.status)).map(j=>stopJob({sessionId:s.id,roundId:r.id,jobId:j.id})));await alarm();return state();}
    case 'job':{
      const ref={sessionId:message.sessionId,roundId:message.roundId,jobId:message.jobId},job=await readJob(ref);if(!job)throw new Error('回答不存在。');let forceable=null;
      ref.requestId=job.requestId;
      if(message.operation==='confirm'&&job.status==='waiting')throw new Error('还没轮到这位成员；可以先跳过它。');
      // A replaced seat stays in the record only; its successor is the one to act on.
      if(job.replacedBy)throw new Error(`这位成员本轮已换成 ${PROVIDERS[job.replacedBy]?.name||'其他成员'}，请对接替它的成员操作。`);
      if(['retry','reread'].includes(message.operation)){
        const s=await loadSession(ref.sessionId);
        if(s.rounds.at(-1)?.id!==ref.roundId)throw new Error('历史轮次不能重新发送或提取，请在最新一轮继续提问。');
        if(s.rounds.some(r=>r.jobs.some(other=>other.id!==job.id&&ACTIVE.has(other.status)&&(other.provider===job.provider||job.tabId&&other.tabId===job.tabId))))throw new Error('该网页还有其他进行中的回答，请先等待或停止。');
      }
      if(message.operation==='stop'||message.operation==='skip')await stopJob(ref,{skip:message.operation==='skip'});
      else if(message.operation==='confirm'){if(!job.text||job.status!=='attention')throw new Error('只有已提取但待确认的回答可以手动确认。');await updateJob(ref,j=>{j.status='done';j.error='用户核对后确认完成。';});}
      else if(message.operation==='retry'){
        // Resend is always offered. Anything that may already be on the site (answering, finished, uncertain) needs the
        // user's explicit confirmation, because the site will then show the question twice.
        const reached=ACTIVE.has(job.status)||job.status==='done'||!['not_sent','prepared',undefined].includes(job.phase);
        if(reached&&!message.confirmDuplicate)throw new Error('这位成员可能已经收到过本轮内容，重新发送会在网页里重复提问。请先重新提取，或明确确认重发。');
        if(ACTIVE.has(job.status))await detach(job,{stopGeneration:true});
        const all=await templates();
        const requestId=await updateJob(ref,(j,s)=>{const r=s.rounds.find(x=>x.id===ref.roundId);if(s.rounds.at(-1)?.id!==ref.roundId)throw new Error('该回答状态已变化，请刷新后重试。');
          // A workflow member still in the queue is sent now, with the answers finished so far.
          if(j.status==='waiting')j.prompt=forNewcomer(s,j.provider,relayPrompt(r,r.jobs.indexOf(j),all),s.rounds.length-1);
          // The earlier answer is kept with the record; a resend never throws a complete answer away.
          if(j.text)j.earlier=[...(j.earlier||[]),{text:j.text,format:j.format||'plain',mode:j.mode||'',url:j.url||'',status:j.status,at:j.updatedAt||Date.now()}];
          j.requestId=id();j.sequence=0;j.status='queued';j.phase='not_sent';j.pageDraft='';j.text='';j.format='plain';j.baseline=null;j.anchor=null;j.url='';j.error='';j.updatedAt=Date.now();return j.requestId;});if(!requestId)throw new Error('该回答状态已变化，请刷新后重试。');await alarm();await dispatch({...ref,requestId,clearDraft:typeof message.clearDraft==='string'?message.clearDraft:''});
      }else if(message.operation==='reread'){
        // Without force the page must prove the latest question is this round's; force follows the user's confirmation.
        const force=message.force===true;
        const tab=await restoreIfDiscarded(await connection(ref.sessionId,job.provider,{verifyConversation:!force,rereadJob:job}));await waitForTab(tab.id);
        // A queued workflow member has sent nothing, so there is no question to match: show the page's latest one and
        // read it only after the user confirms (for instance after asking it by hand on the site).
        if(job.status==='waiting'&&!force){await inject(tab.id,job.provider);const page=await pageMessage(tab.id,{type:'YZ_LATEST_QUESTION',provider:job.provider});return {...await state(),forceable:{jobId:job.id,provider:job.provider,question:String(page.question||'').slice(0,120)}};}
        // Re-reading a member that is still running restarts the reading only; the site keeps answering.
        const requestId=id();const claimed=await updateJob(ref,(j,s)=>{if(s.rounds.at(-1)?.id!==ref.roundId||j.requestId!==job.requestId)throw new Error('该回答状态已变化，请刷新后重试。');j.requestId=requestId;j.sequence=0;j.status='sent';j.tabId=tab.id;j.error='';j.startedAt=Date.now();j.updatedAt=Date.now();return true;});if(!claimed)throw new Error('该回答状态已变化，请刷新后重试。');
        if(ACTIVE.has(job.status))await detach(job,{stopGeneration:false});
        try{await support.acquire(tab.id,requestId,job.provider);if(!await supportedJob({...ref,requestId})){await support.release(tab.id,requestId);return state();}await inject(tab.id,job.provider);if(!await supportedJob({...ref,requestId})){await support.release(tab.id,requestId);return state();}await pageMessage(tab.id,{type:'YZ_REREAD',provider:job.provider,requestId,baseline:job.phase==='attempted'?job.baseline:null,url:job.url,prompt:job.prompt,anchor:force?null:job.anchor,force});}catch(error){await updateJob({...ref,requestId},j=>{if(ACTIVE.has(j.status)){j.status='attention';j.error=error.message;}});await releaseSupport({...ref,requestId});if(error.code==='NOT_OWNED'&&!force)forceable={jobId:job.id,provider:job.provider,question:error.question||''};}
      }else throw new Error('未知回答操作。');await alarm();
      if(['skip','confirm'].includes(message.operation)&&(await loadSession(ref.sessionId)).rounds.find(r=>r.id===ref.roundId)?.kind==='relay')advanceLater(ref.sessionId,ref.roundId);
      return {...await state(),forceable};
    }
    case 'delete':{const s=await loadSession(message.sessionId);if(busy(s))throw new Error('进行中的圆桌不能删除，请先停止。');if(await workspaces.owner(s.id))throw new Error('请先关闭这场圆桌的窗口，再从其他窗口删除历史。');if(!message.confirm)throw new Error('删除历史需要确认。');if(index.sessions.length===1)throw new Error('请先新建一场圆桌，再删除最后一条历史。');await removeSession(s.id);return state();}
    default:throw new Error('未知圆桌操作。');
  }
}
const globalState=state;
function requireWindowId(message){if(!Number.isInteger(message.windowId))throw new Error('无法确认当前圆桌窗口，请重新打开界面。');}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return false;
  if(message.type==='YZ_EVENT'){ready.then(()=>locateEvent(message,sender)).then(accepted=>respond({ok:true,accepted}),error=>respond({ok:false,error:error.message}));return true;}
  if(message.type!=='YZ_COMMAND'||sender.tab&&providerFor(sender.url))return false;
  const windowId=sender.tab?.windowId??message.windowId;
  if(!Number.isInteger(windowId)){respond({ok:false,error:'无法确认当前圆桌窗口，请重新打开界面。'});return false;}
  ready.then(()=>command({...message,windowId})).then(value=>respond({ok:true,...value}),error=>respond({ok:false,error:error.message}));return true;
});
const panelPorts=new Map(),closedPanels=new Set();
function publishPanel(windowId){return ready.then(()=>{const visible=nativePanelState.get(windowId)??(!closedPanels.has(windowId)&&[...(panelPorts.get(windowId)?.values()||[])].some(Boolean));return chrome.storage.session.set({['arena.panel.'+windowId]:visible});}).catch(e=>console.error('[AI圆桌lite] 侧栏状态保存失败',e));}
chrome.runtime.onConnect?.addListener(port=>{
  const match=/^arena-panel:(\d+)$/.exec(port.name);if(!match||port.sender?.id!==chrome.runtime.id)return;const windowId=Number(match[1]),ports=panelPorts.get(windowId)||new Map();ports.set(port,false);panelPorts.set(windowId,ports);
  if(port.sender.documentId)ready.then(()=>chrome.storage.session.set({['arena.panel-document.'+windowId]:port.sender.documentId})).catch(e=>console.error('[AI圆桌lite] 侧栏文档状态保存失败',e));
  port.onMessage.addListener(message=>{ports.set(port,message.visible===true);publishPanel(windowId);});
  port.onDisconnect.addListener(()=>{ports.delete(port);if(!ports.size)nativePanelState.delete(windowId);publishPanel(windowId);});
});
chrome.sidePanel.onOpened?.addListener(({windowId})=>{ready.then(()=>{closedPanels.delete(windowId);nativePanelState.set(windowId,true);return publishPanel(windowId);}).catch(e=>console.error('[AI圆桌lite] 侧栏打开状态保存失败',e));});
chrome.sidePanel.onClosed?.addListener(({windowId})=>{ready.then(()=>{closedPanels.add(windowId);nativePanelState.set(windowId,false);return publishPanel(windowId);}).catch(e=>console.error('[AI圆桌lite] 侧栏关闭状态保存失败',e));});
chrome.windows.onRemoved?.addListener(windowId=>{ready.then(async()=>{const sessionId=await workspaces.ownerForWindow(windowId);await workspaces.forget(windowId);if(sessionId){const s=await loadSession(sessionId);for(const r of s.rounds)if(r.jobs.some(j=>j.status==='waiting'))await stopWaiting(sessionId,r.id);for(const r of (await loadSession(sessionId)).rounds)for(const j of r.jobs)if(ACTIVE.has(j.status))await stopJob({sessionId,roundId:r.id,jobId:j.id});await alarm();await discardIfEmpty(sessionId);}await chrome.storage.session.remove('arena.panel.'+windowId);}).catch(e=>console.error('[AI圆桌lite] 关闭窗口清理失败',e));});
chrome.alarms.onAlarm.addListener(event=>{if(event.name===UPDATE_ALARM){checkForUpdate().catch(error=>console.info('[AI圆桌lite] 检查更新失败',error.message));return;}if(event.name===ALARM)ready.then(recover).catch(error=>console.error('[AI圆桌lite] 恢复失败',error));});
chrome.runtime.onInstalled.addListener(details=>{ready.then(()=>details.reason==='update'?workspaces.restoreAfterReload():null).catch(error=>console.error('[AI圆桌lite] 初始化失败',error));});
chrome.runtime.onStartup.addListener(()=>{ready.then(recover).catch(error=>console.error('[AI圆桌lite] 启动恢复失败',error));});
ready.then(alarm).catch(error=>console.error('[AI圆桌lite] 后台支持恢复失败',error));
