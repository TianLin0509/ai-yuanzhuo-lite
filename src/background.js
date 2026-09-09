import {PROVIDERS,ACTIVE,id,newSession,makeRound,busy,providerFor,cleanUrl,acceptEvent} from './core.js';

const INDEX='arena.index',PREFIX='arena.session.',ALARM='arena-active-recovery';
let index,queue=Promise.resolve();const sessions=new Map();
const run=fn=>{const operation=queue.then(fn);queue=operation.catch(()=>{});return operation;};
async function loadSession(sessionId){if(!sessions.has(sessionId)){const data=await chrome.storage.local.get(PREFIX+sessionId);if(!data[PREFIX+sessionId])throw new Error('会话不存在，请刷新历史列表。');sessions.set(sessionId,data[PREFIX+sessionId]);}return sessions.get(sessionId);}
async function save(session){session.updatedAt=Date.now();const next=structuredClone(index);const meta={id:session.id,title:session.title,updatedAt:session.updatedAt,rounds:session.rounds.length};next.sessions=next.sessions.filter(s=>s.id!==session.id);next.sessions.unshift(meta);await chrome.storage.local.set({[PREFIX+session.id]:session,[INDEX]:next});index=next;sessions.set(session.id,session);}
async function mutate(sessionId,fn){return run(async()=>{const copy=structuredClone(await loadSession(sessionId));const result=fn(copy);await save(copy);return result;});}
async function init(){
  const data=await chrome.storage.local.get(INDEX);index=data[INDEX];
  if(!index){const session=newSession(Object.keys(PROVIDERS));index={schema:1,currentId:session.id,sessions:[]};await save(session);}
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true});
}
const ready=init();
function findJob(session,roundId,jobId){return session.rounds.find(r=>r.id===roundId)?.jobs.find(j=>j.id===jobId);}
async function updateJob(ref,fn){return mutate(ref.sessionId,s=>{const job=findJob(s,ref.roundId,ref.jobId);if(!job)throw new Error('本轮任务已不存在。');if(ref.requestId&&job.requestId!==ref.requestId)return null;return fn(job,s);});}
async function readJob(ref){const job=findJob(await loadSession(ref.sessionId),ref.roundId,ref.jobId);return ref.requestId&&job?.requestId!==ref.requestId?null:job;}
async function alarm(){let active=false;for(const meta of index.sessions){if(busy(await loadSession(meta.id))){active=true;break;}}if(active){if(!await chrome.alarms.get(ALARM))await chrome.alarms.create(ALARM,{periodInMinutes:0.5});}else await chrome.alarms.clear(ALARM);}
async function waitForTab(tabId){const start=Date.now();while(Date.now()-start<20000){const tab=await chrome.tabs.get(tabId);if(tab.status==='complete')return tab;await new Promise(resolve=>setTimeout(resolve,300));}throw new Error('网页仍在加载。请打开网页检查网络或登录，再重试。');}
async function connection(sessionId,provider,{focus=false,verifyConversation=false}={}){
  const session=await loadSession(sessionId);let tab=null,binding=session.bindings[provider];
  if(binding){try{tab=await chrome.tabs.get(binding.tabId);}catch(error){if(!/No tab|Invalid tab/i.test(error.message))throw error;}}
  if(tab&&providerFor(tab.url||tab.pendingUrl)!==provider)throw new Error(`${PROVIDERS[provider].name} 的标签页已离开对应网站，请重新连接。`);
  if(tab&&binding?.url&&verifyConversation&&cleanUrl(tab.url||tab.pendingUrl)!==cleanUrl(binding.url))throw new Error('该标签页已切换到其他对话。请点“原网页”回到本轮绑定的对话，再重试。');
  if(!tab){tab=await chrome.tabs.create({url:binding?.url||PROVIDERS[provider].url,active:focus});await mutate(sessionId,s=>{s.bindings[provider]={tabId:tab.id,url:tab.url||tab.pendingUrl||PROVIDERS[provider].url};});}
  if(focus){await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});}
  return tab;
}
async function inject(tabId,provider){const tab=await chrome.tabs.get(tabId);if(providerFor(tab.url)!==provider)throw new Error('网页地址不属于本轮 AI，已停止操作。');await chrome.scripting.executeScript({target:{tabId},files:['adapters.js','content.js'],world:'ISOLATED'});}
async function pageMessage(tabId,message){const result=await chrome.tabs.sendMessage(tabId,message,{frameId:0});if(!result?.ok)throw new Error(result?.error||'网页没有确认操作，请打开原网页检查。');return result;}
async function dispatch(ref){
  try{
    let job=await readJob(ref);if(!job||!ACTIVE.has(job.status))return;
    ref={...ref,requestId:job.requestId};
    await updateJob(ref,j=>{if(ACTIVE.has(j.status))j.status='preparing';});
    const tab=await connection(ref.sessionId,job.provider,{verifyConversation:true});await waitForTab(tab.id);
    job=await readJob(ref);if(!job||!ACTIVE.has(job.status))return;
    await updateJob(ref,j=>{j.tabId=tab.id;});await inject(tab.id,job.provider);
    const preparation=await pageMessage(tab.id,{type:'YZ_PREPARE',provider:job.provider});
    if(cleanUrl(preparation.url)!==cleanUrl((await loadSession(ref.sessionId)).bindings[job.provider].url))throw new Error('准备发送时网页已切换对话，已取消发送。请点“原网页”核对。');
    await updateJob(ref,j=>{if(ACTIVE.has(j.status)){j.baseline=preparation.baseline;j.url=preparation.url;j.status='sending';j.phase='prepared';}});
    job=await readJob(ref);if(!job||!ACTIVE.has(job.status))return;
    // Persist the uncertain boundary BEFORE the page can click. A restart never blindly repeats SEND.
    await updateJob(ref,j=>{if(ACTIVE.has(j.status))j.phase='attempted';});
    job=await readJob(ref);if(!job||!ACTIVE.has(job.status))return;
    await pageMessage(tab.id,{type:'YZ_SEND',provider:job.provider,requestId:job.requestId,prompt:job.prompt,baseline:job.baseline});
  }catch(error){await updateJob(ref,j=>{if(ACTIVE.has(j.status)){j.status=j.phase==='attempted'?'attention':'error';j.error=error.message;j.updatedAt=Date.now();}});}
}
async function locateEvent(event,sender){
  if(!sender.tab||sender.frameId!==0)return false;
  for(const meta of index.sessions){const session=await loadSession(meta.id);for(const round of session.rounds){const job=round.jobs.find(j=>j.requestId===event.requestId);if(!job)continue;
    if(!acceptEvent(job,event,sender.tab.id)||providerFor(sender.url)!==job.provider||providerFor(event.url)!==job.provider)return false;
    if(!['sent','unconfirmed','streaming','done','attention'].includes(event.status))return false;
    const ref={sessionId:session.id,roundId:round.id,jobId:job.id,requestId:job.requestId};
    await updateJob(ref,(j,s)=>{if(!acceptEvent(j,event,sender.tab.id))return;j.sequence=event.sequence;j.status=event.status;j.text=typeof event.text==='string'?event.text:j.text;j.format=event.format||'plain';j.error=event.error||'';j.url=event.url;j.phase=event.phase;if(event.anchor)j.anchor=event.anchor;j.updatedAt=Date.now();s.bindings[j.provider]={tabId:j.tabId,url:j.url};});
    await alarm();return true;
  }}return false;
}
async function recover(){
  for(const meta of index.sessions){const session=await loadSession(meta.id);for(const round of session.rounds){for(const job of round.jobs){if(!ACTIVE.has(job.status)||Date.now()-job.updatedAt<45000)continue;
    let active=false;try{if(job.tabId){const result=await pageMessage(job.tabId,{type:'YZ_STATUS',requestId:job.requestId});active=result.active;}}catch(error){console.info('[AI圆桌lite] 恢复检查：',error.message);}
    if(!active)await updateJob({sessionId:session.id,roundId:round.id,jobId:job.id,requestId:job.requestId},j=>{if(ACTIVE.has(j.status)){j.status='attention';j.error='网页或扩展连接已重启。请打开原网页并重新提取；不会自动重发。';}});
  }}}await alarm();
}
async function stopJob(ref,{skip=false}={}){
  const job=await readJob(ref);if(!job)return;
  ref={...ref,requestId:job.requestId};
  await updateJob(ref,j=>{j.status=skip?'skipped':'stopped';j.error='';j.updatedAt=Date.now();});
  if(job.tabId){try{const result=await pageMessage(job.tabId,{type:'YZ_STOP',requestId:job.requestId,stopGeneration:true});if(!result.pageStopped&&!skip)await updateJob(ref,j=>{j.error='已停止圆桌读取。原网页若仍在生成，可在原网页手动停止。';});}catch(error){await updateJob(ref,j=>{j.error='已停止圆桌读取；原网页未确认停止：'+error.message;});}}
}
async function state(){await queue;return {index:structuredClone(index),session:structuredClone(await loadSession(index.currentId)),providers:PROVIDERS};}
async function command(message){
  switch(message.action){
    case 'state':return state();
    case 'new':{if(index.sessions.length>=30)throw new Error('已保存 30 场圆桌。请先导出并删除不再需要的历史，再新建。');const session=newSession(message.members);await run(async()=>{const before=index.currentId;index.currentId=session.id;try{await save(session);}catch(error){index.currentId=before;throw error;}});return state();}
    case 'select':{await loadSession(message.sessionId);await run(async()=>{const next={...index,currentId:message.sessionId};await chrome.storage.local.set({[INDEX]:next});index=next;});return state();}
    case 'members':{await mutate(message.sessionId,s=>{if(busy(s))throw new Error('请先等待或停止本轮，再更改成员。');newSession(message.members);s.members=message.members;});return state();}
    case 'connect':{const s=await loadSession(message.sessionId);for(const provider of s.members)await connection(s.id,provider);return state();}
    case 'open':{if(!PROVIDERS[message.provider])throw new Error('未知成员。');const session=await loadSession(message.sessionId);const bound=session.bindings[message.provider];const tab=await connection(session.id,message.provider,{focus:true});if(bound?.url&&cleanUrl(tab.url)!==cleanUrl(bound.url))await chrome.tabs.update(tab.id,{url:bound.url});return state();}
    case 'start':{
      const round=await mutate(message.sessionId,s=>{const r=makeRound(message.kind,message.text,s,message.options);s.rounds.push(r);if(s.rounds.length===1)s.title=r.prompt.slice(0,32)||'新的圆桌';return structuredClone(r);});
      await alarm();await Promise.all(round.jobs.map(j=>dispatch({sessionId:message.sessionId,roundId:round.id,jobId:j.id})));await alarm();return state();
    }
    case 'stop':{const s=await loadSession(message.sessionId),r=s.rounds.find(r=>r.id===message.roundId);if(!r)throw new Error('轮次不存在。');await Promise.all(r.jobs.filter(j=>ACTIVE.has(j.status)).map(j=>stopJob({sessionId:s.id,roundId:r.id,jobId:j.id})));await alarm();return state();}
    case 'job':{
      const ref={sessionId:message.sessionId,roundId:message.roundId,jobId:message.jobId},job=await readJob(ref);if(!job)throw new Error('回答不存在。');
      ref.requestId=job.requestId;
      if(['retry','reread'].includes(message.operation)){
        const s=await loadSession(ref.sessionId);
        if(s.rounds.at(-1)?.id!==ref.roundId)throw new Error('历史轮次不能重新发送或提取，请在最新一轮继续提问。');
        if(s.rounds.some(r=>r.jobs.some(other=>other.id!==job.id&&ACTIVE.has(other.status)&&(other.provider===job.provider||job.tabId&&other.tabId===job.tabId))))throw new Error('该网页还有其他进行中的回答，请先等待或停止。');
      }
      if(message.operation==='stop'||message.operation==='skip')await stopJob(ref,{skip:message.operation==='skip'});
      else if(message.operation==='confirm'){if(!job.text||job.status!=='attention')throw new Error('只有已提取但待确认的回答可以手动确认。');await updateJob(ref,j=>{j.status='done';j.error='用户核对后确认完成。';});}
      else if(message.operation==='retry'){
        if(ACTIVE.has(job.status))throw new Error('该成员仍在进行，请先停止。');
        if(job.phase==='attempted'&&!message.confirmDuplicate)throw new Error('此前发送结果不确定，重新发送可能重复。请先重新提取，或明确确认重发。');
        const requestId=await updateJob(ref,(j,s)=>{if(s.rounds.at(-1)?.id!==ref.roundId||ACTIVE.has(j.status))throw new Error('该回答状态已变化，请刷新后重试。');if(['done','skipped'].includes(j.status))throw new Error('该轮已经结束，请在新一轮继续提问。');j.requestId=id();j.sequence=0;j.status='queued';j.phase='not_sent';j.text='';j.format='plain';j.baseline=null;j.anchor=null;j.url='';j.error='';j.updatedAt=Date.now();return j.requestId;});if(!requestId)throw new Error('该回答状态已变化，请刷新后重试。');await alarm();await dispatch({...ref,requestId});
      }else if(message.operation==='reread'){
        if(ACTIVE.has(job.status))throw new Error('请先停止该成员的自动读取。');
        if(!job.baseline||job.phase!=='attempted')throw new Error('本轮没有已发送的回答锚点，请检查原网页后重试发送。');
        const tab=await connection(ref.sessionId,job.provider,{verifyConversation:true});await waitForTab(tab.id);await inject(tab.id,job.provider);
        const requestId=id();const claimed=await updateJob(ref,(j,s)=>{if(s.rounds.at(-1)?.id!==ref.roundId||ACTIVE.has(j.status))throw new Error('该回答状态已变化，请刷新后重试。');j.requestId=requestId;j.sequence=0;j.status='sent';j.tabId=tab.id;j.error='';j.updatedAt=Date.now();return true;});if(!claimed)throw new Error('该回答状态已变化，请刷新后重试。');
        try{await pageMessage(tab.id,{type:'YZ_REREAD',provider:job.provider,requestId,baseline:job.baseline,url:job.url,prompt:job.prompt,anchor:job.anchor});}catch(error){await updateJob({...ref,requestId},j=>{if(ACTIVE.has(j.status)){j.status='attention';j.error=error.message;}});}
      }else throw new Error('未知回答操作。');await alarm();return state();
    }
    case 'delete':{const s=await loadSession(message.sessionId);if(busy(s))throw new Error('进行中的圆桌不能删除，请先停止。');if(!message.confirm)throw new Error('删除历史需要确认。');if(index.sessions.length===1)throw new Error('请先新建一场圆桌，再删除最后一条历史。');await run(async()=>{const next={...index,sessions:index.sessions.filter(m=>m.id!==s.id)};if(next.currentId===s.id)next.currentId=next.sessions[0].id;await chrome.storage.local.set({[INDEX]:next});index=next;await chrome.storage.local.remove(PREFIX+s.id);sessions.delete(s.id);});return state();}
    default:throw new Error('未知圆桌操作。');
  }
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return false;
  if(message.type==='YZ_EVENT'){ready.then(()=>locateEvent(message,sender)).then(accepted=>respond({ok:true,accepted}),error=>respond({ok:false,error:error.message}));return true;}
  if(message.type!=='YZ_COMMAND'||sender.tab&&providerFor(sender.url))return false;
  ready.then(()=>command(message)).then(value=>respond({ok:true,...value}),error=>respond({ok:false,error:error.message}));return true;
});
chrome.alarms.onAlarm.addListener(event=>{if(event.name===ALARM)ready.then(recover).catch(error=>console.error('[AI圆桌lite] 恢复失败',error));});
chrome.runtime.onInstalled.addListener(()=>{ready.catch(error=>console.error('[AI圆桌lite] 初始化失败',error));});
chrome.runtime.onStartup.addListener(()=>{ready.then(recover).catch(error=>console.error('[AI圆桌lite] 启动恢复失败',error));});
