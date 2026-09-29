import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../src/core.js';
import {createBackgroundSupport} from '../src/background-support.js';
import {createWorkspaces} from '../src/workspaces.js';

async function harness({oldRound=false,wrongTab=false,sendFails=false,onSend,onPage,focusFails=false,onInject,onAttach,configure,tabUrl,onTargets}={}){
 const s=core.newSession(['deepseek','kimi']);const first=core.makeRound('ask','first question',s);s.rounds.push(first);
 s.bindings={deepseek:{tabId:1,url:'https://chat.deepseek.com/a/chat/s/original'},kimi:{tabId:2,url:'https://www.kimi.com/chat/original'}};
 for(const j of first.jobs)Object.assign(j,{status:'done',text:'FIRST ANSWER',format:'markdown',phase:'attempted',tabId:s.bindings[j.provider].tabId,url:s.bindings[j.provider].url,baseline:{count:0,lastHash:'',userCount:0,url:s.bindings[j.provider].url}});
 if(oldRound){const next=core.makeRound('iterate','second question',s);s.rounds.push(next);for(const j of next.jobs)Object.assign(j,{status:'streaming',tabId:s.bindings[j.provider].tabId});}
 if(configure)configure(s);
 const data={'arena.windows':{'1':s.id},'arena.index':{schema:1,currentId:s.id,sessions:[{id:s.id,title:s.title,updatedAt:0,rounds:s.rounds.length}]},['arena.session.'+s.id]:s},calls=[];
 const get=async key=>structuredClone(key===null?data:Object.fromEntries((Array.isArray(key)?key:[key]).map(k=>[k,data[k]])));
 const noop=()=>{};let onDetach;const debuggerCalls=[];const chrome={
  storage:{session:{get,set:async values=>Object.assign(data,structuredClone(values)),remove:async keys=>{for(const key of [keys].flat())delete data[key];}},local:{get,set:async values=>Object.assign(data,structuredClone(values)),remove:async keys=>{for(const key of [keys].flat())delete data[key];}}},
  debugger:{getTargets:async()=>onTargets?onTargets():Object.values(s.bindings).map(b=>({tabId:b.tabId,id:'target-'+b.tabId,type:'page'})),attach:async({tabId})=>{debuggerCalls.push(['attach',tabId]);if(onAttach)await onAttach(tabId);},sendCommand:async({tabId},method)=>{debuggerCalls.push([method,tabId]);if(focusFails&&method==='Emulation.setFocusEmulationEnabled')throw Error('test focus failure');},detach:async({tabId})=>debuggerCalls.push(['detach',tabId]),onDetach:{addListener:fn=>{onDetach=fn;}}},
  sidePanel:{setPanelBehavior:async()=>{}},scripting:{executeScript:async args=>{if(onInject)await onInject(args.target.tabId);return [];}},windows:{update:async()=>{},get:async id=>({id})},
  tabs:{get:async id=>({id,windowId:1,status:'complete',url:tabUrl?.(id)??(id===1&&wrongTab?'https://chat.deepseek.com/a/chat/s/unrelated':Object.values(s.bindings).find(b=>b.tabId===id).url)}),sendMessage:async(tabId,message)=>{calls.push({tabId,...message});if(onPage){const r=await onPage(tabId,message);if(r!==undefined)return r;}if(message.type==='YZ_SEND'&&onSend)return onSend(message);if(message.type==='YZ_SEND'&&sendFails)throw Error('test send failure');if(message.type==='YZ_PREPARE'){const url=Object.values(s.bindings).find(b=>b.tabId===tabId).url;return {ok:true,baseline:{count:1,lastHash:'base',userCount:1,url},url};}return {ok:true};}},
  alarms:{get:async()=>null,create:async()=>{},clear:async()=>{},onAlarm:{addListener:noop}},
  runtime:{onMessage:{addListener:noop},onInstalled:{addListener:noop},onStartup:{addListener:noop}}
 };
 chrome.tabs.onUpdated={addListener:noop};chrome.tabs.update=async()=>{};
 const box={...core,createBackgroundSupport,createWorkspaces,chrome,structuredClone,console,setTimeout,URL,Date};
 const source=fs.readFileSync(new URL('../src/background.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'');
 vm.runInNewContext(source+'\nglobalThis.audit={ready,command,supportLost};',box);await box.audit.ready;
 const job=first.jobs[0],args={sessionId:s.id,roundId:first.id,jobId:job.id};
 return {command:box.audit.command,supportLost:box.audit.supportLost,calls,args,s,job,data,debuggerCalls,onDetach,chrome};
}

test('Quoted content and sent-draft clearing cannot be overwritten by replayed or unobserved edits',async()=>{
 const h=await harness(),base={sessionId:h.s.id},written=await h.command({action:'draft',...base,patch:{text:'my draft'},revision:100,baseRevision:0,writer:'editor'});
 const quoted=await h.command({action:'quote',...h.args});assert(quoted.draft.text.includes('FIRST ANSWER'));assert(quoted.draft.revision>written.draft.revision);
 const replay=await h.command({action:'draft',...base,patch:{text:'my draft'},revision:100,baseRevision:0,writer:'editor'});assert.equal(replay.draft.text,quoted.draft.text);
 await assert.rejects(()=>h.command({action:'draft',...base,patch:{text:'unseen overwrite'},revision:quoted.draft.revision+1,baseRevision:written.draft.revision,writer:'editor'}),/另一处改变/);
 const sent=await h.command({action:'start',...base,kind:'ask',text:quoted.draft.text});assert.equal(sent.draft.text,'');assert(sent.draft.revision>quoted.draft.revision);
 const late=await h.command({action:'draft',...base,patch:{text:'my draft'},revision:100,baseRevision:0,writer:'editor'});assert.equal(late.draft.text,'');
});
test('Closing the owning window during injection cannot send in any other window',async()=>{
 let reached,release;const blocked=new Promise(r=>{reached=r;}),hold=new Promise(r=>{release=r;});const h=await harness({onInject:async()=>{reached();await hold;}});
 const started=h.command({action:'start',sessionId:h.s.id,kind:'ask',text:'must cancel'});await blocked;h.chrome.windows.get=async()=>{throw Error('No window with id: 1');};release();const state=await started;
 assert(!h.calls.some(c=>c.type==='YZ_SEND'));assert(state.session.rounds.at(-1).jobs.every(j=>j.status==='error'));
});

test('Restart loss updates the old job but cannot message a replacement or unverified debugger target',async()=>{
 for(const mode of ['replacement','lookup-failure','same']){const h=await harness({oldRound:true,onTargets:()=>{if(mode==='lookup-failure')throw Error('target lookup failed');return [{tabId:1,type:'page',id:mode==='same'?'target-1':'replacement'}];}});const job=h.s.rounds.at(-1).jobs[0];
 await h.supportLost({tabId:1,targetId:'target-1',requestId:job.requestId,reason:'restart'});assert.equal(h.calls.filter(c=>c.type==='YZ_STOP').length,mode==='same'?1:0,mode+' must not receive an unowned STOP');assert(!core.ACTIVE.has((await h.command({action:'state'})).session.rounds.at(-1).jobs[0].status));}
});

test('Required background support failure blocks the website SEND boundary',async()=>{
 const h=await harness({focusFails:true});const result=await h.command({action:'start',sessionId:h.s.id,kind:'ask',text:'background required'});
 assert(result.session.rounds.at(-1).jobs.every(j=>j.status==='error'&&j.phase!=='attempted'&&j.error.includes('test focus failure')));assert(!h.calls.some(c=>c.type==='YZ_SEND'));assert.equal(h.debuggerCalls.filter(c=>c[0]==='detach').length,2);
});
test('Stopping reread during injection cannot restart a released page watcher',async()=>{
 let injected,unblock;const reached=new Promise(r=>{injected=r;}),hold=new Promise(r=>{unblock=r;});const h=await harness({onInject:async()=>{injected();await hold;}});
 const reread=h.command({action:'job',...h.args,operation:'reread'});await reached;await h.command({action:'job',...h.args,operation:'stop'});unblock();await reread;
 assert(!h.calls.some(c=>c.type==='YZ_REREAD'));assert.equal((await h.command({action:'state'})).session.rounds[0].jobs[0].status,'stopped');
});
test('Cancellation prevents SEND while another AI occupies the support queue',async()=>{
 let injected,unblockInject,attaching,unblockAttach;const reached=new Promise(r=>{injected=r;}),hold=new Promise(r=>{unblockInject=r;}),second=new Promise(r=>{attaching=r;}),waitAttach=new Promise(r=>{unblockAttach=r;});
 const h=await harness({onInject:async tab=>{if(tab===1){injected();await hold;}},onAttach:async tab=>{if(tab===2){attaching();await waitAttach;}}});
 const started=h.command({action:'start',sessionId:h.s.id,kind:'ask',text:'cancel before send'});await Promise.all([reached,second]);h.onDetach({tabId:1},'canceled_by_user');unblockInject();await new Promise(r=>setTimeout(r,20));
 const sent=h.calls.some(c=>c.tabId===1&&c.type==='YZ_SEND');unblockAttach();await started;assert.equal(sent,false);assert(!h.calls.some(c=>c.tabId===1&&c.type==='YZ_SEND'));
});

test('Historical operations cannot interrupt or overwrite the current round',async()=>{
 const h=await harness({oldRound:true});
 for(const operation of ['reread','retry'])await assert.rejects(()=>h.command({action:'job',...h.args,operation,confirmDuplicate:true}),/历史轮次/);
 assert.equal(h.calls.length,0);const state=await h.command({action:'state'});assert.equal(state.session.rounds[0].jobs[0].text,'FIRST ANSWER');assert.equal(state.session.rounds[1].jobs[0].status,'streaming');
});

test('Same-site navigation blocks both new dispatch and reread',async()=>{
 const h=await harness({wrongTab:true});
 await assert.rejects(()=>h.command({action:'job',...h.args,operation:'reread'}),/其他对话/);
 const state=await h.command({action:'start',sessionId:h.args.sessionId,kind:'iterate',text:'new question'});
 const job=state.session.rounds.at(-1).jobs[0];assert.equal(job.status,'error');assert(job.error.includes('其他对话'));assert(!h.calls.some(c=>c.tabId===1&&['YZ_SEND','YZ_REREAD'].includes(c.type)));
});

test('Doubao provisional route can be reread with a saved message anchor, but cannot send or accept a stable-route switch',async()=>{
 const configure=s=>{s.members[0]='doubao';delete s.bindings.deepseek;s.bindings.doubao={tabId:1,url:'https://www.doubao.com/chat/local_123'};Object.assign(s.rounds[0].jobs[0],{provider:'doubao',status:'attention',url:s.bindings.doubao.url,anchor:{key:'block_c036e5b0-acb4-11f1-ad19-afd4128d612e',textHash:'saved-hash'}});};
 const h=await harness({configure,tabUrl:id=>id===1?'https://www.doubao.com/chat/987654':undefined});
 const state=await h.command({action:'job',...h.args,operation:'reread'});assert.equal(h.calls.filter(c=>c.type==='YZ_REREAD').length,1);assert(!h.calls.some(c=>c.type==='YZ_SEND'));assert.equal(state.session.bindings.doubao.url,'https://www.doubao.com/chat/local_123','Binding must await page identity verification');
 for(const stable of [false,true]){const bad=await harness({configure:s=>{configure(s);if(stable){s.bindings.doubao.url='https://www.doubao.com/chat/111';s.rounds[0].jobs[0].url=s.bindings.doubao.url;}else delete s.rounds[0].jobs[0].anchor;},tabUrl:id=>id===1?'https://www.doubao.com/chat/987654':undefined});await assert.rejects(()=>bad.command({action:'job',...bad.args,operation:'reread'}),/其他对话/);assert(!bad.calls.some(c=>c.type==='YZ_REREAD'));}
 for(const key of ['0','own-row']){const bad=await harness({configure:s=>{configure(s);s.rounds[0].jobs[0].anchor.key=key;},tabUrl:id=>id===1?'https://www.doubao.com/chat/987654':undefined});await assert.rejects(()=>bad.command({action:'job',...bad.args,operation:'reread'}),/其他对话/);assert(!bad.calls.some(c=>c.type==='YZ_REREAD'));}
 const send=await harness({configure,tabUrl:id=>id===1?'https://www.doubao.com/chat/987654':undefined});await send.command({action:'start',sessionId:send.s.id,kind:'ask',text:'must not send across routes'});assert(!send.calls.some(c=>c.tabId===1&&c.type==='YZ_SEND'));
});

test('Failed retry has no stale answer that could be confirmed as success',async()=>{
 const h=await harness({sendFails:true});h.data['arena.session.'+h.s.id].rounds[0].jobs[0].status='attention';
 // loadSession has not been cached before this initial operation.
 const result=await h.command({action:'job',...h.args,operation:'retry',confirmDuplicate:true});
 const j=result.session.rounds[0].jobs[0];assert.equal(j.status,'attention');assert.equal(j.text,'');assert.equal(j.format,'plain');assert(j.error.includes('test send failure'));
 await assert.rejects(()=>h.command({action:'job',...h.args,operation:'confirm'}),/只有已提取/);
});

test('Concurrent reread clicks claim a terminal job only once',async()=>{
 const h=await harness();const actions=await Promise.allSettled([1,2].map(()=>h.command({action:'job',...h.args,operation:'reread'})));
 assert.equal(actions.filter(x=>x.status==='fulfilled').length,1);assert.equal(h.calls.filter(c=>c.type==='YZ_REREAD').length,1);
});

test('A late rejection from a stopped attempt cannot overwrite its newer retry',async()=>{
 let rejectFirst,started;const sent=new Promise(resolve=>{started=resolve;});let count=0;
 const h=await harness({onSend:()=>{if(++count===1){started();return new Promise((resolve,reject)=>{rejectFirst=reject;});}return {ok:true};}});
 h.data['arena.session.'+h.s.id].rounds[0].jobs[0].status='attention';
 const first=h.command({action:'job',...h.args,operation:'retry',confirmDuplicate:true});await sent;
 await h.command({action:'job',...h.args,operation:'stop'});
 const second=await h.command({action:'job',...h.args,operation:'retry',confirmDuplicate:true});const expected=second.session.rounds[0].jobs[0];
 rejectFirst(Error('late old rejection'));await first;
 const latest=(await h.command({action:'state'})).session.rounds[0].jobs[0];assert.equal(latest.requestId,expected.requestId);assert.equal(latest.status,expected.status);assert.equal(latest.error,'');assert.equal(count,2);
});
test('A saved chat the site could not reopen is never sent to; retry continues in the new chat',async()=>{
 const h=await harness({tabUrl:id=>id===1?'https://chat.deepseek.com/':'https://www.kimi.com/chat/original'});
 const state=await h.command({action:'start',sessionId:h.s.id,kind:'iterate',text:'follow up'});
 const ds=state.session.rounds.at(-1).jobs.find(j=>j.provider==='deepseek');
 assert.equal(ds.status,'error');assert.equal(ds.phase,'not_sent');assert.match(ds.error,/新对话/);
 assert(!h.calls.some(c=>c.type==='YZ_SEND'&&c.tabId===1),'nothing is typed into the fallen-back page');
 assert.equal(state.session.bindings.deepseek.url,'https://chat.deepseek.com/');assert.match(state.session.bindings.deepseek.note,/没能回到/);
 assert.equal(state.session.rounds[0].jobs.find(j=>j.provider==='deepseek').url,'https://chat.deepseek.com/a/chat/s/original','the record keeps the original chat address');
});
test('Sending and closing the same window at once: either the close is refused or nothing is sent',async()=>{
 for(const order of ['start-first','close-first']){
  const h=await harness(),removed=[];Object.assign(h.chrome.tabs,{query:async()=>[{id:1,windowId:1,url:'https://chat.deepseek.com/a/chat/s/original'},{id:2,windowId:1,url:'https://www.kimi.com/chat/original'},{id:9,windowId:1,url:'chrome-extension://test/main.html?session='+h.s.id}],remove:async ids=>{removed.push(...[ids].flat());},create:async t=>({id:50,...t})});
  h.chrome.runtime.getURL=path=>'chrome-extension://test/'+path;
  const start=()=>h.command({action:'start',windowId:1,sessionId:h.s.id,kind:'iterate',text:'race'}),close=()=>h.command({action:'close-here',windowId:1});
  const [a,b]=await Promise.allSettled(order==='start-first'?[start(),close()]:[close(),start()]),[started,closed]=order==='start-first'?[a,b]:[b,a];
  const sent=h.calls.some(c=>c.type==='YZ_SEND');
  assert(!(closed.status==='fulfilled'&&sent),order+': a closed roundtable must not have sent');
  if(closed.status==='fulfilled')assert.equal(started.status,'rejected',order+': start after close is refused');
  if(sent)assert.equal(removed.length,0,order+': tabs in use are never closed');
 }
});
test('A send from a new-chat page whose reading fails records the chat the site created, so a reload re-binds by address',async()=>{
 for(const [question,adopted] of [['from a new chat',true],['a chat the user opened',false]]){
 let sent=false;
 const h=await harness({onPage:(tabId,m)=>m.type==='YZ_LATEST_QUESTION'?{ok:true,question,url:'https://chat.deepseek.com/a/chat/s/created-by-send'}:undefined,configure:s=>{s.bindings.deepseek={tabId:1,url:'https://chat.deepseek.com/'};},tabUrl:id=>id===1?(sent?'https://chat.deepseek.com/a/chat/s/created-by-send':'https://chat.deepseek.com/'):'https://www.kimi.com/chat/original',
  onSend:m=>{if(m.provider==='deepseek'){sent=true;throw Error('reading failed after the click');}return {ok:true};}});
 const state=await h.command({action:'start',sessionId:h.s.id,kind:'iterate',text:'from a new chat'});
 const ds=state.session.rounds.at(-1).jobs.find(j=>j.provider==='deepseek');assert.equal(ds.status,'attention');assert.equal(ds.phase,'attempted');
 assert.equal(state.session.bindings.deepseek.url,adopted?'https://chat.deepseek.com/a/chat/s/created-by-send':'https://chat.deepseek.com/',question);assert.equal(state.session.bindings.deepseek.tabId,1);
 }
});
test('Stopping a workflow while the next turn is being claimed: afterwards nothing is active or waiting and nothing more is sent',async()=>{
 const h=await harness({configure:s=>{const r=core.makeRound('relay','relay question',s,{order:['deepseek','kimi']});r.jobs[0].status='done';r.jobs[0].text='DS';r.jobs[0].phase='attempted';s.rounds.push(r);}});
 const round=h.s.rounds.at(-1);
 await Promise.all([h.command({action:'state',windowId:1}),h.command({action:'stop',windowId:1,sessionId:h.s.id,roundId:round.id})]);
 await new Promise(r=>setTimeout(r,50));const after=h.calls.length;
 const st=await h.command({action:'state',windowId:1}),r=st.session.rounds.at(-1);
 assert(r.stopped,'the round is marked stopped');assert(r.jobs.every(j=>!core.ACTIVE.has(j.status)&&j.status!=='waiting'),JSON.stringify(r.jobs.map(j=>j.status)));
 await h.command({action:'state',windowId:1});await new Promise(r=>setTimeout(r,50));
 assert.equal(h.calls.filter(c=>c.type==='YZ_SEND').length,h.calls.slice(0,after).filter(c=>c.type==='YZ_SEND').length,'no send after the stop');
});
test('A member page Chrome reclaimed (discarded) is reloaded in place before sending, without switching tabs',async()=>{
 const h=await harness();let discarded=true;const reloads=[],updates=[];
 const get=h.chrome.tabs.get;h.chrome.tabs.get=async id=>({...await get(id),discarded:id===1&&discarded});
 h.chrome.tabs.reload=async id=>{reloads.push(id);discarded=false;};
 const update=h.chrome.tabs.update;h.chrome.tabs.update=async(id,props)=>{updates.push(props);return update(id,props);};
 const state=await h.command({action:'start',sessionId:h.s.id,kind:'iterate',text:'after a long break'});
 assert.deepEqual(reloads,[1],'the reclaimed page is reloaded once');
 assert(!updates.some(p=>p.active),'no tab is brought to the front');
 assert(h.calls.some(c=>c.type==='YZ_SEND'&&c.tabId===1),'the question is then sent to it');
 assert.equal(state.session.rounds.at(-1).jobs.find(j=>j.provider==='deepseek').status!=='error',true);
});
