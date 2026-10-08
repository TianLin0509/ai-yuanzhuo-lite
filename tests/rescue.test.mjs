import test from 'node:test';
import assert from 'node:assert/strict';
import {newSession,makeRound,composePrompts,presetView,validateTemplate,replaceMember,canTakeOver,jobFor,relayNext,busy,toMarkdown,KIND_NAMES} from '../src/core.js';

// 2026-10-08: 互相激发 between 观点讨论 and 队长总结, and 换人 as an escape hatch at any time.
const answered=(members=['deepseek','kimi','doubao'])=>{const s=newSession(members),r=makeRound('iterate','原问题',s);r.jobs.forEach(j=>{j.status='done';j.text=j.provider.toUpperCase()+'_ANSWER';});s.rounds.push(r);return s;};

test('互相激发：每位只收到其他成员的完整回答，提示词与 Android 端一致，独立计轮',()=>{
  const s=answered();assert.equal(KIND_NAMES.inspire,'互相激发');
  const prompts=composePrompts('inspire','请用表格',s);
  for(const {provider,prompt} of prompts){
    assert(prompt.startsWith('这是第1轮互相激发。'));
    assert(prompt.includes('供你参考和启发。请不要逐条点评或复述，而是把它们当作灵感'));
    assert(prompt.includes('不必为了一致而趋同'));assert(prompt.includes('请直接在对话正文中完整写出你的回答。'));
    assert(!prompt.includes(provider.toUpperCase()+'_ANSWER'),'own answer excluded');
    assert.equal(prompt.match(/_ANSWER/g).length,2,'both peers included');
    assert(prompt.endsWith('用户补充要求：\n请用表格'));
  }
  // A discussion round does not advance the 激发 count, and vice versa.
  const r=makeRound('inspire','',s);r.jobs.forEach(j=>{j.status='done';j.text=j.provider+' 升级版';});s.rounds.push(r);
  assert(composePrompts('inspire','',s)[0].prompt.startsWith('这是第2轮互相激发。'));
  assert(composePrompts('discuss','',s)[0].prompt.startsWith('这是第1轮辩论。'));
  assert.equal(r.prompt,'参考彼此的回答，各自给出更好的答案');assert.equal(r.supplement,'');
});
test('互相激发与观点讨论同样要求完整材料，预设可编辑但必须保留队友回答',()=>{
  const s=answered();s.rounds[0].jobs[1].status='error';s.rounds[0].jobs[1].text='';
  assert.throws(()=>composePrompts('inspire','',s),/不完整的回答.*互相激发/);
  s.rounds[0].jobs[1].status='skipped';assert.equal(composePrompts('inspire','',s).length,3);
  const view=presetView('inspire',s,{});assert.equal(view.name,'互相激发');assert.deepEqual(view.parts.filter(p=>p.slot).map(p=>p.slot),['队友1的回答','队友2的回答']);
  assert.throws(()=>validateTemplate('inspire','{轮次引导}'),/\{队友回答\}/);
  const custom=composePrompts('inspire','',s,{templates:{inspire:'自定义激发\n{队友回答}'}});assert(custom[0].prompt.startsWith('自定义激发\n【'));
});
test('换人：进行中、排队、出错的位置由新成员接手同一材料；旧记录保留为已跳过',()=>{
  const s=answered(),r=makeRound('inspire','补充',s);s.rounds.push(r);
  const kimi=jobFor(r,'kimi');Object.assign(kimi,{status:'streaming',tabId:7,text:'半截'});
  assert(canTakeOver(r,'kimi'));const {job,previous}=replaceMember(s,'kimi','qwen');
  assert.deepEqual(s.members,['deepseek','qwen','doubao'],'position kept');
  assert.equal(previous.status,'streaming','the running page must be stopped by the caller');
  assert.equal(kimi.status,'skipped');assert.equal(kimi.replacedBy,'qwen');assert.equal(kimi.text,'半截','record kept');
  assert.equal(job.provider,'qwen');assert.equal(job.status,'queued');assert.equal(r.jobs.indexOf(job),r.jobs.indexOf(kimi)+1);
  // The newcomer has no answer of its own in the source round, so it receives all three.
  for(const p of ['DEEPSEEK','KIMI','DOUBAO'])assert(job.prompt.includes(p+'_ANSWER'));
  assert(job.prompt.startsWith('这是第1轮互相激发。'));assert(job.prompt.endsWith('用户补充要求：\n补充'));
  assert.equal(jobFor(r,'qwen'),job);assert(busy(s));
  // Swap back: the latest job of a provider is the current one.
  const back=replaceMember(s,'qwen','kimi');assert.equal(jobFor(r,'kimi'),back.job);assert.equal(job.replacedBy,'kimi');
});
test('换人：已完成、已跳过或整轮停止时只从下一轮起换，不自动发送',()=>{
  for(const status of ['done','skipped','stopped']){const s=answered();const r=s.rounds[0];jobFor(r,'kimi').status=status;
    const before=r.jobs.length,result=replaceMember(s,'kimi','grok');assert.equal(result.job,null,status);assert.equal(r.jobs.length,before);assert.deepEqual(s.members,['deepseek','grok','doubao']);}
  const s=answered(),r=makeRound('iterate','Q2',s);s.rounds.push(r);r.stopped=true;jobFor(r,'kimi').status='error';
  assert.equal(replaceMember(s,'kimi','grok').job,null,'a stopped round never restarts itself');
  assert.throws(()=>replaceMember(answered(),'kimi','doubao'),/圆桌外/);assert.throws(()=>replaceMember(answered(),'qwen','grok'),/已不在/);
});
test('换人：工作流在同一位置接力；排队中的位置继续排队',()=>{
  const s=answered(),r=makeRound('relay','接力问题',s,{order:['deepseek','kimi','doubao']});s.rounds.push(r);
  Object.assign(r.jobs[0],{status:'done',text:'DS_RELAY'});Object.assign(r.jobs[1],{status:'error',prompt:'旧材料'});
  const {job}=replaceMember(s,'kimi','qwen');assert.equal(job.status,'queued');assert(job.prompt.includes('DS_RELAY'));assert(job.prompt.startsWith('接力问题'));
  const t=answered(),q=makeRound('relay','排队',t);t.rounds.push(q);q.jobs[0].status='sent';
  const waiting=replaceMember(t,'doubao','grok');assert.equal(waiting.job,null);assert.equal(jobFor(q,'grok').status,'waiting');
  q.jobs[0].status='done';q.jobs[0].text='A';q.jobs[1].status='done';q.jobs[1].text='B';assert.equal(q.jobs[relayNext(q)].provider,'grok','the newcomer takes its turn');
});
test('导出保留被换下的成员与重新发送前的回答',()=>{
  const s=answered(),r=s.rounds[0];jobFor(r,'deepseek').earlier=[{text:'第一版回答',at:1}];
  const r2=makeRound('iterate','Q2',s);s.rounds.push(r2);jobFor(r2,'kimi').status='error';replaceMember(s,'kimi','qwen');
  const md=toMarkdown(s);assert(md.includes('之前的回答 1\n\n第一版回答'));assert(md.includes('Kimi · 已跳过（已换成 千问）'));
});
