import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as core from '../src/core.js';

async function harness({oldRound=false,wrongTab=false,sendFails=false,onSend}={}){
 const s=core.newSession(['deepseek','kimi']);const first=core.makeRound('ask','first question',s);s.rounds.push(first);
 s.bindings={deepseek:{tabId:1,url:'https://chat.deepseek.com/a/chat/s/original'},kimi:{tabId:2,url:'https://www.kimi.com/chat/original'}};
 for(const j of first.jobs)Object.assign(j,{status:'done',text:'FIRST ANSWER',format:'markdown',phase:'attempted',tabId:s.bindings[j.provider].tabId,url:s.bindings[j.provider].url,baseline:{count:0,lastHash:'',userCount:0,url:s.bindings[j.provider].url}});
 if(oldRound){const next=core.makeRound('iterate','second question',s);s.rounds.push(next);for(const j of next.jobs)Object.assign(j,{status:'streaming',tabId:s.bindings[j.provider].tabId});}
 const data={'arena.index':{schema:1,currentId:s.id,sessions:[{id:s.id,title:s.title,updatedAt:0,rounds:s.rounds.length}]},['arena.session.'+s.id]:s},calls=[];
 const noop=()=>{};const chrome={
  storage:{local:{get:async key=>structuredClone({[key]:data[key]}),set:async values=>Object.assign(data,structuredClone(values)),remove:async key=>{delete data[key];}}},
  sidePanel:{setPanelBehavior:async()=>{}},scripting:{executeScript:async()=>[]},windows:{update:async()=>{}},
  tabs:{get:async id=>({id,status:'complete',url:id===1&&wrongTab?'https://chat.deepseek.com/a/chat/s/unrelated':Object.values(s.bindings).find(b=>b.tabId===id).url}),sendMessage:async(tabId,message)=>{calls.push({tabId,...message});if(message.type==='YZ_SEND'&&onSend)return onSend(message);if(message.type==='YZ_SEND'&&sendFails)throw Error('test send failure');if(message.type==='YZ_PREPARE'){const url=Object.values(s.bindings).find(b=>b.tabId===tabId).url;return {ok:true,baseline:{count:1,lastHash:'base',userCount:1,url},url};}return {ok:true};}},
  alarms:{get:async()=>null,create:async()=>{},clear:async()=>{},onAlarm:{addListener:noop}},
  runtime:{onMessage:{addListener:noop},onInstalled:{addListener:noop},onStartup:{addListener:noop}}
 };
 const box={...core,chrome,structuredClone,console,setTimeout,URL,Date};
 const source=fs.readFileSync(new URL('../src/background.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/,'');
 vm.runInNewContext(source+'\nglobalThis.audit={ready,command};',box);await box.audit.ready;
 const job=first.jobs[0],args={sessionId:s.id,roundId:first.id,jobId:job.id};
 return {command:box.audit.command,calls,args,s,job,data};
}

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
