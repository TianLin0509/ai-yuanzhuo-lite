import test from 'node:test';
import assert from 'node:assert/strict';
import {newSession,makeRound,composePrompts,MAX_PROMPT,acceptEvent,toMarkdown,providerFor,busy} from '../src/core.js';
const seed=()=>newSession(['deepseek','kimi','doubao']);
test('原文与多行边界不被隐式改变；各家独立迭代不携带互评材料',()=>{const s=seed(),text='  第一行\n— 第二行\n\n第三行 <>&  ';for(const kind of ['ask','iterate'])assert.deepEqual(composePrompts(kind,text,s).map(p=>p.prompt),[text,text,text]);});
test('三人讨论逐接收者仅转发另外两家的完整回答',()=>{
 const s=seed(),r=makeRound('ask','问题',s);s.rounds.push(r);
 const texts={deepseek:'DEEPSEEK_BEGIN\n'+'完整长回答\n'.repeat(3000)+'DEEPSEEK_END',kimi:'KIMI_ONLY\n```js\nconst kimi = 1;\n```',doubao:'DOUBAO_ONLY\n豆包全文'};
 r.jobs.forEach(j=>{j.status='done';j.text=texts[j.provider];});
 const expected={deepseek:['kimi','doubao'],kimi:['deepseek','doubao'],doubao:['deepseek','kimi']};
 const guidance='  保留我的原文\n— 核对分歧\n\n第二段  ';
 for(const {provider,prompt} of composePrompts('discuss',guidance,s)){
  assert(!prompt.includes(texts[provider]),provider+' 不应收到自己的回答');
  for(const peer of expected[provider])assert(prompt.includes(texts[peer]),provider+' 应收到 '+peer+' 的完整回答');
  // The preset comes first and the user's supplement last, matching the side panel's preview order.
  assert(prompt.endsWith('\n\n用户补充要求：\n'+guidance));assert(prompt.startsWith('这是第1轮辩论'));
  assert(prompt.includes('以下是其他 AI 对同一问题的回答，请分析他们的观点，指出你认同和不认同的地方，并给出你的改进回答。'));
  assert(prompt.includes('这是第1轮辩论。请仔细阅读其他参与者的初始回答，找出核心分歧和共识。'));
 }
});
test('两人讨论互换回答；连续讨论仅转发上一轮并推进旧版轮次引导',()=>{
 const s=newSession(['deepseek','kimi']),r=makeRound('ask','原始问题',s);s.rounds.push(r);r.jobs.forEach(j=>{j.status='done';j.text=j.provider+'_INITIAL';});
 for(let n=1;n<=4;n++){
  const round=makeRound('discuss','',s);s.rounds.push(round);
  for(const job of round.jobs){const peer=job.provider==='deepseek'?'kimi':'deepseek';const previous=n===1?'INITIAL':'ROUND_'+(n-1);assert(job.prompt.includes(peer+'_'+previous));assert(!job.prompt.includes(job.provider+'_'+previous));assert(job.prompt.includes('这是第'+n+'轮辩论。'));if(n>1)assert(!job.prompt.includes('_INITIAL'));job.status='done';job.text=job.provider+'_ROUND_'+n;}
 }
});
test('失败文本不参与讨论；队长总结仍接收全部有效回答（含自己的）',()=>{
 const s=seed(),r=makeRound('ask','问题',s);s.rounds.push(r);r.jobs[0].status=r.jobs[1].status='done';r.jobs[0].text='DS_COMPLETE';r.jobs[1].text='KIMI_COMPLETE';r.jobs[2].status='error';r.jobs[2].text='ERROR_MUST_NOT_BE_INCLUDED';
 assert.throws(()=>composePrompts('discuss','原文要求',s),/不完整的回答/);
 const summary=composePrompts('summary','',s,{captain:'kimi',depth:'深入分析'});assert.equal(summary.length,1);assert.equal(summary[0].provider,'kimi');assert(summary[0].prompt.includes('深入分析'));assert(summary[0].prompt.includes('DS_COMPLETE'));assert(summary[0].prompt.includes('KIMI_COMPLETE'));assert(!summary[0].prompt.includes('ERROR_MUST_NOT_BE_INCLUDED'));
});
test('超限明确拒绝，不截断；未满足讨论条件不启动新请求',()=>{const s=seed();assert.throws(()=>composePrompts('ask','字'.repeat(MAX_PROMPT+1),s),/不会自动截断/);assert.throws(()=>composePrompts('discuss','',s),/至少需要两份/);assert.throws(()=>makeRound('ask',' ',s),/先输入/);});
test('轮次忙时阻止重复发起，新请求身份互不混用',()=>{const s=seed(),r=makeRound('ask','第一题',s);s.rounds.push(r);assert(busy(s));assert.equal(new Set(r.jobs.map(j=>j.requestId)).size,3);assert.throws(()=>makeRound('ask','第二题',s),/本轮仍在进行/);r.jobs.forEach(j=>j.status='done');assert(!busy(s));assert.notEqual(makeRound('ask','第二题',s).id,r.id);});
test('迟到、乱序、其他标签页与终止后的结果不能覆盖本轮',()=>{const job={requestId:'current',tabId:123,status:'streaming',sequence:5};const event={requestId:'current',sequence:6};assert(acceptEvent(job,event,123));assert(!acceptEvent(job,event,124));assert(!acceptEvent(job,{...event,requestId:'old'},123));assert(!acceptEvent(job,{...event,sequence:5},123));assert(!acceptEvent({...job,status:'stopped'},event,123));assert(!acceptEvent({...job,status:'done'},event,123));});
test('平台域名完整匹配，不接受伪造子域；成员数量与重复项受约束',()=>{assert.equal(providerFor('https://www.kimi.com/chat/123'),'kimi');assert.equal(providerFor('https://chat.deepseek.com.evil.test/'),null);assert.throws(()=>newSession(['deepseek','deepseek']),/不同/);assert.throws(()=>newSession(['unknown','kimi']),/不同/);});
test('导出保留全部轮次、原始问题、完整答案和失败原因',()=>{const s=seed();for(let i=0;i<2;i++){const r=makeRound('ask','第'+i+'问\n完整原文',s);r.jobs.forEach((j,k)=>{j.status=k===2?'error':'done';j.text=k===2?'':'全文'.repeat(10000);j.error=k===2?'登录未完成':'';});s.rounds.push(r);}const md=toMarkdown(s);assert(md.includes('第0问\n完整原文'));assert(md.includes('第1问\n完整原文'));assert(md.includes('全文'.repeat(10000)));assert(md.includes('登录未完成'));});
test('跳过的成员不阻塞讨论，换进来的新成员收到其他人的完整回答；未跳过的失败仍阻塞',()=>{
 const s=seed(),r=makeRound('ask','问题',s);s.rounds.push(r);r.jobs[0].status=r.jobs[2].status='done';r.jobs[0].text='DS_COMPLETE';r.jobs[2].text='DOUBAO_COMPLETE';r.jobs[1].status='attention';r.jobs[1].text='KIMI_PARTIAL';
 assert.throws(()=>composePrompts('discuss','',s),/跳过该成员/);
 r.jobs[1].status='skipped';s.members=['deepseek','qwen','doubao'];
 const prompts=Object.fromEntries(composePrompts('discuss','',s).map(p=>[p.provider,p.prompt]));
 assert.deepEqual(Object.keys(prompts),['deepseek','qwen','doubao']);
 assert(prompts.qwen.includes('DS_COMPLETE')&&prompts.qwen.includes('DOUBAO_COMPLETE'));
 assert(!prompts.deepseek.includes('DS_COMPLETE')&&prompts.deepseek.includes('DOUBAO_COMPLETE'));
 for(const p of Object.values(prompts))assert(!p.includes('KIMI_PARTIAL'));
});
test('讨论两种风格各自计轮；提示词要求在正文写完整；队长总结的开场白能被识别',async()=>{
 const {looksLikePlaceholder}=await import('../src/core.js');
 const s=seed(),r=makeRound('ask','问题',s);s.rounds.push(r);for(const j of r.jobs){j.status='done';j.text=j.provider+'_ANSWER';}
 const debate=composePrompts('discuss','',s)[0].prompt,collab=composePrompts('discuss','',s,{style:'collab'})[0].prompt;
 assert(debate.includes('这是第1轮辩论')&&debate.includes('指出你认同和不认同的地方')&&debate.includes('请直接在对话正文中完整写出你的回答'));
 assert(collab.includes('这是第1轮协作')&&collab.includes('取长补短')===false&&collab.includes('整合各方优势')&&collab.includes('请直接在对话正文中完整写出你的回答'));
 const d=makeRound('discuss','',s,{style:'collab'});assert.equal(d.style,'collab');s.rounds.push(d);for(const j of d.jobs){j.status='done';j.text=j.provider+'_2';}
 assert(composePrompts('discuss','',s,{style:'collab'})[0].prompt.includes('这是第2轮协作'));
 assert(composePrompts('discuss','',s)[0].prompt.includes('这是第1轮辩论'),'debate rounds count separately');
 assert.equal(makeRound('ask','x',s).style,undefined);
 const summary=composePrompts('summary','',s,{captain:'kimi'})[0].prompt;assert(summary.includes('请直接在对话正文中完整写出总结')&&summary.includes('未经核实之处请标明'));
 assert(toMarkdown(s).includes('观点讨论（取长补短）'));
 assert(looksLikePlaceholder('我将整理成文档。'));assert(looksLikePlaceholder('已为你生成总结文档，需要我压缩到 300 字吗？'.repeat(2)));
 assert(!looksLikePlaceholder('共识：三家都认为需要分层管理，每位组长直接管理 5 到 7 人。分歧：是否设副组长。下一步：先按两层结构试运行一个月，再根据反馈调整。'));
});
test('预设提示词：统一占位展示、可自定义、必须保留材料占位、单次替换',async()=>{
 const {presetView,validateTemplate,DEFAULT_TEMPLATES}=await import('../src/core.js');
 const s=seed(),r=makeRound('ask','原问题 {各家回答}',s);s.rounds.push(r);for(const j of r.jobs){j.status='done';j.text=j.provider+'_A {队友回答}';}
 const view=presetView('discuss',s);assert.deepEqual(view.parts.filter(p=>p.slot).map(p=>p.slot),['队友1的回答','队友2的回答']);assert(view.parts[0].text.startsWith('这是第1轮辩论'));assert.equal(view.custom,false);
 assert.equal(presetView('ask',s),null);assert.deepEqual(presetView('summary',s).parts.filter(p=>p.slot).map(p=>p.slot),['上一轮的问题','成员1的回答','成员2的回答','成员3的回答']);
 assert.throws(()=>validateTemplate('discuss.debate','只要轮次 {轮次引导}'),/\{队友回答\}/);assert.throws(()=>validateTemplate('summary','  '),/不能为空/);assert.throws(()=>validateTemplate('nope','x'),/未知/);
 const templates={'discuss.debate':'自定义开头\n{队友回答}'};
 for(const {provider,prompt} of composePrompts('discuss','补充',s,{templates})){assert(prompt.startsWith('自定义开头\n【'));assert(prompt.endsWith('用户补充要求：\n补充'));assert(!prompt.includes(provider+'_A'));}
 assert(composePrompts('discuss','',s,{style:'collab',templates})[0].prompt.startsWith('这是第1轮协作'),'a custom debate preset leaves the collab preset alone');assert(DEFAULT_TEMPLATES['discuss.collab'].includes('{队友回答}'));
 // Answers and questions containing slot names are inserted verbatim, never expanded again.
 const summary=composePrompts('summary','',s,{captain:'kimi'})[0].prompt;assert(summary.includes('原问题 {各家回答}'));assert(summary.includes('deepseek_A {队友回答}'));assert.equal(summary.split('--- DeepSeek ---').length,2);
});
test('工作流：按顺序依次回答，后者收到问题与前面全部完整回答；跳过或失败的成员不提供材料',async()=>{
 const {relayOrder,relayPrompt,relayNext,busy:isBusy}=await import('../src/core.js');
 const s=seed();assert.deepEqual(relayOrder(s,'doubao,deepseek,kimi'),['doubao','deepseek','kimi']);assert.deepEqual(relayOrder(s,'doubao,deepseek'),s.members,'an order that does not name every member falls back');assert.deepEqual(relayOrder(s,'kimi,kimi,doubao'),s.members);
 assert.throws(()=>makeRound('relay','  ',s),/先输入/);
 const r=makeRound('relay','工作流问题',s,{order:'kimi,deepseek,doubao'});s.rounds.push(r);
 assert.deepEqual(r.jobs.map(j=>[j.provider,j.status,j.prompt]),[['kimi','queued','工作流问题'],['deepseek','waiting',''],['doubao','waiting','']]);
 assert(isBusy(s));assert.equal(relayNext(r),-1,'nobody else goes while the first answers');
 r.jobs[0].status='done';r.jobs[0].text='KIMI_ANSWER';assert.equal(relayNext(r),1);
 const second=relayPrompt(r,1);assert(second.startsWith('工作流问题\n\n'));assert(second.includes('【Kimi 的回答】:\nKIMI_ANSWER'));
 r.jobs[1].status='error';assert.equal(relayNext(r),-1,'a failed member pauses the workflow');
 r.jobs[1].status='skipped';r.jobs[1].text='PARTIAL_MUST_NOT_PASS';assert.equal(relayNext(r),2);
 const third=relayPrompt(r,2);assert(third.includes('KIMI_ANSWER'));assert(!third.includes('PARTIAL_MUST_NOT_PASS'));
 assert.equal(relayPrompt({...r,jobs:[{...r.jobs[0],status:'skipped'},r.jobs[1],r.jobs[2]]},2),'工作流问题','with no earlier answer the member simply gets the question');
 assert(relayPrompt(r,2,{relay:'自定义：{问题}｜{前面回答}'}).startsWith('自定义：工作流问题｜【Kimi'));
 assert.throws(()=>relayPrompt({...r,jobs:[{...r.jobs[0],text:'长'.repeat(MAX_PROMPT)},r.jobs[1],r.jobs[2]]},2),/不会自动截断/);
 r.jobs[2].status='done';r.jobs[2].text='DOUBAO';assert(!isBusy(s));
 const discuss=composePrompts('discuss','',s);assert.equal(discuss.find(p=>p.provider==='doubao').prompt.includes('KIMI_ANSWER'),true,'a workflow round can be discussed');
});
