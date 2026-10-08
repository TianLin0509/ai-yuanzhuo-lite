// conversation: path of a saved chat. Other paths on the same site are blank "new chat" pages.
// Must match the adapter of the same provider (tests/providers.test.mjs checks both).
export const PROVIDERS = Object.freeze({
  deepseek: {name:'DeepSeek', short:'DS', url:'https://chat.deepseek.com/', hosts:['chat.deepseek.com'], conversation:/\/a\/chat\/s\/[^/]+|\/chat\/[^/]+/},
  kimi: {name:'Kimi', short:'K', url:'https://www.kimi.com/', hosts:['www.kimi.com','kimi.com','kimi.moonshot.cn'], conversation:/\/chat\/[^/]+/},
  doubao: {name:'豆包', short:'豆', url:'https://www.doubao.com/chat/', hosts:['www.doubao.com'], conversation:/\/chat\/[^/?]+/},
  qwen: {name:'千问', short:'千', url:'https://www.qianwen.com/', hosts:['www.qianwen.com'], conversation:/\/chat\/[^/]+/},
  yuanbao: {name:'元宝', short:'元', url:'https://yuanbao.tencent.com/chat', hosts:['yuanbao.tencent.com'], conversation:/\/chat\/[^/]+\/[^/]+/},
  chatgpt: {name:'ChatGPT', short:'GPT', url:'https://chatgpt.com/', hosts:['chatgpt.com'], conversation:/\/u?c\/[^/]+/, abroad:true},
  claude: {name:'Claude', short:'C', url:'https://claude.ai/new', hosts:['claude.ai'], conversation:/\/chat\/[^/]+/, abroad:true},
  gemini: {name:'Gemini', short:'G', url:'https://gemini.google.com/app', hosts:['gemini.google.com'], conversation:/\/app\/[^/]+/, abroad:true},
  grok: {name:'Grok', short:'Gk', url:'https://grok.com/', hosts:['grok.com'], conversation:/\/c\/[^/]+/, abroad:true}
});
// First-run members; afterwards new roundtables reuse the members the user last chose.
export const DEFAULT_MEMBERS = Object.freeze(['deepseek','kimi','doubao']);
export const MAX_MEMBERS = 3;
// Saved roundtables across all windows (unlimitedStorage keeps full answers without the 10 MB quota).
export const MAX_SESSIONS = 200;
export function validMembers(members){return Array.isArray(members)&&members.length>=2&&members.length<=MAX_MEMBERS&&new Set(members).size===members.length&&members.every(k=>PROVIDERS[k]);}
export const ACTIVE = new Set(['queued','preparing','sending','sent','streaming','unconfirmed']);
export const LABELS = {queued:'准备连接',preparing:'检查网页',sending:'正在发送',sent:'等待回答',streaming:'正在回答',unconfirmed:'发送待确认',done:'已完成',attention:'需要确认',error:'需要处理',stopped:'已停止',skipped:'已跳过',waiting:'排队中'};
export const MAX_PROMPT = 120000;
export function id(){return crypto.randomUUID();}
export function providerFor(url){try{const host=new URL(url).hostname;return Object.keys(PROVIDERS).find(k=>PROVIDERS[k].hosts.includes(host))||null;}catch{return null;}}
export function cleanUrl(url){try{const u=new URL(url);return u.origin+u.pathname;}catch{return '';}}
// Sites redirect their landing page (e.g. 元宝 /chat → /chat/<agent>). Two blank pages hold no
// conversation that could be mixed up, so they count as the same place; saved chats must match exactly.
export function sameConversation(provider,a,b){
  if(cleanUrl(a)&&cleanUrl(a)===cleanUrl(b))return true;
  const pattern=PROVIDERS[provider]?.conversation;
  try{const x=new URL(a),y=new URL(b);return !!pattern&&x.origin===y.origin&&PROVIDERS[provider].hosts.includes(x.hostname)&&!pattern.test(x.pathname)&&!pattern.test(y.pathname);}catch{return false;}
}
export function newSession(memberIds){
  if(!validMembers(memberIds))throw new Error(`请选择 2–${MAX_MEMBERS} 位不同的成员。`);
  return {id:id(),title:'新的圆桌',createdAt:Date.now(),updatedAt:Date.now(),members:memberIds,bindings:{},rounds:[]};
}
// A workflow member still waiting for its turn keeps the round going, like one that is answering.
export function busy(session){return session?.rounds.some(r=>r.jobs.some(j=>ACTIVE.has(j.status)||j.status==='waiting'))||false;}
export const KIND_NAMES={ask:'同题提问',iterate:'独立迭代',relay:'工作流',discuss:'观点讨论',inspire:'互相激发',summary:'队长总结'};
// Kinds whose recipients each get the other members' latest answers.
const PEER_KINDS=new Set(['discuss','inspire']);
// AI-Arena: templates-builtin.js debate.free and debate-engine.js buildDebatePrompt.
// Keep its peer-only relay and round guidance without the template manager or compression.
const DISCUSSION_MAIN='以下是其他 AI 对同一问题的回答，请分析他们的观点，指出你认同和不认同的地方，并给出你的改进回答。';
// AI-Arena templates-builtin.js debate.collab, worded as the behaviour wanted.
const COLLAB_MAIN='以下是队友们对同一问题的回答。你们是协作关系，目标是共同得出最优方案。请吸收队友回答中的亮点和你没想到的角度，补充你认为重要而尚未覆盖的内容，整合各方优势，给出一个更完善的综合回答。';
const COLLAB_HINTS=[
  '这是第1轮协作。请仔细阅读队友们的回答，找出各自的亮点和你没想到的角度。',
  '这是第2轮协作。队友们已经互相补充了一轮，请在此基础上进一步整合，查漏补缺。',
  '这是第3轮协作。方案已趋于成熟，请做最终打磨：精简冗余，强化核心结论，形成一份完整方案。'
];
// 互相激发 (2026-10-08): others' answers are a source of ideas, not something to judge or merge; each member keeps an
// independent, upgraded answer. Same wording as AI圆桌 Android 0.19.0.
const INSPIRE_MAIN='以下是其他 AI 对同一问题的回答，供你参考和启发。请不要逐条点评或复述，而是把它们当作灵感：先找出其中你没想到、能让答案更好的思路、事实或角度，再与你自己的思考碰撞、组合、延伸，争取提出任何一方单独都没想到的新想法；你原有回答中仍然站得住的独到之处请保留，不必为了一致而趋同。请直接给出你升级后的完整回答，最后用一两句话说明受到了哪些启发、新增了什么。';
const INSPIRE_HINTS=[
  '这是第1轮互相激发。请先读完其他 AI 的回答，留意哪些地方触动了你、补上了你的盲区。',
  '这是第2轮互相激发。大家已经互相启发过一轮，请寻找还没被挖掘的方向，让答案再上一个台阶。'
];
export const DISCUSSION_STYLES={debate:'互挑错',collab:'取长补短'};
// Some sites move long replies into document cards the roundtable cannot read (AI圆桌 Android 0.11).
const IN_BODY='请直接在对话正文中完整写出你的回答。';
// A captain summary this short, or a short offer to continue, is an opening line rather than the summary.
export function looksLikePlaceholder(text){const t=String(text||'').trim();return t.length<40||t.length<200&&/需要我|要不要我|是否需要|已为你生成|已生成|文档|点击查看|下载/.test(t);}
const DISCUSSION_HINTS=[
  '这是第1轮辩论。请仔细阅读其他参与者的初始回答，找出核心分歧和共识。',
  '这是第2轮辩论。经过上一轮交锋，请聚焦于仍存在分歧的关键点，深化你的论证或修正你的观点。',
  '这是第3轮辩论。辩论已进入深水区，请避免重复已达成共识的内容，集中攻克剩余分歧点，给出最终立场。'
];
// Preset prompts are templates the user may edit (saved per kind). Slots are filled at send time; the
// user's own supplement is always appended after the preset, which is also how the side panel shows it.
const SUMMARY_DEPTH={'简要结论':'简要结论与可执行的下一步','深入分析':'深入分析（共识、分歧、依据、仍待确认的问题与建议）'};
export const DEFAULT_TEMPLATES=Object.freeze({
  'discuss.debate':`{轮次引导}\n\n${DISCUSSION_MAIN}${IN_BODY}\n\n{队友回答}`,
  'discuss.collab':`{轮次引导}\n\n${COLLAB_MAIN}${IN_BODY}\n\n{队友回答}`,
  inspire:`{轮次引导}\n\n${INSPIRE_MAIN}${IN_BODY}\n\n{队友回答}`,
  summary:'请作为圆桌队长，总结以下讨论，输出{总结要求}。成员之间的一致意见同样需要依据，未经核实之处请标明。请直接在对话正文中完整写出总结。\n\n问题：\n{问题}\n\n{各家回答}',
  relay:'{问题}\n\n前面的成员已按顺序回答了这个问题。请认真阅读后给出你的回答：可以补充新的角度、纠正或反驳，重点写出前面还没有覆盖的内容。请直接在对话正文中完整写出你的回答。\n\n{前面回答}'
});
export const TEMPLATE_NAMES=Object.freeze({'discuss.debate':'观点讨论 · 互挑错','discuss.collab':'观点讨论 · 取长补短',inspire:'互相激发',summary:'队长总结',relay:'工作流 · 第 2 位起'});
const REQUIRED_SLOTS={'discuss.debate':['{队友回答}'],'discuss.collab':['{队友回答}'],inspire:['{队友回答}'],summary:['{各家回答}'],relay:['{问题}','{前面回答}']};
export function templateKey(kind,style){return kind==='discuss'?(style==='collab'?'discuss.collab':'discuss.debate'):['summary','relay','inspire'].includes(kind)?kind:null;}
export function validateTemplate(key,text){
  if(!DEFAULT_TEMPLATES[key])throw new Error('未知的预设提示词。');
  if(typeof text!=='string'||!text.trim())throw new Error('预设提示词不能为空；要恢复默认请点“恢复默认”。');
  const missing=REQUIRED_SLOTS[key].filter(slot=>!text.includes(slot));
  if(missing.length)throw new Error(`预设提示词必须保留 ${missing.join('、')}，否则各家收不到讨论材料。`);
  return text;
}
// Single pass, so a question or answer that happens to contain "{各家回答}" is never substituted again.
const fill=(template,values)=>template.replace(/\{(轮次引导|队友回答|总结要求|问题|各家回答|前面回答)\}/g,(slot,name)=>name in values?values[name]:slot);
function roundHint(session,style,kind='discuss'){
  if(kind==='inspire'){const n=session.rounds.filter(r=>r.kind==='inspire').length+1;return INSPIRE_HINTS[n-1]||`这是第${n}轮互相激发。请聚焦仍可突破的地方，避免重复已有内容。`;}
  const collab=style==='collab',number=session.rounds.filter(r=>r.kind==='discuss'&&(r.style||'debate')===(collab?'collab':'debate')).length+1;
  return collab?COLLAB_HINTS[number-1]||`这是第${number}轮协作。请继续整合，聚焦尚未完善的部分。`:DISCUSSION_HINTS[number-1]||`这是第${number}轮辩论。请只针对仍有分歧的核心问题发表精炼观点。`;
}
// One unified view of the preset for display: every recipient's answers become "队友1的回答"… slots.
export function presetView(kind,session,{style='debate',depth='简要结论',templates={}}={}){
  const key=templateKey(kind,style);if(!key)return null;
  const template=templates[key]||DEFAULT_TEMPLATES[key],latest=session.rounds.at(-1),answers=latest?.jobs.filter(j=>j.status==='done'&&j.text)||[];
  const peers=Math.max(0,...session.members.map(m=>answers.filter(a=>a.provider!==m).length));
  const slots={'{队友回答}':Array.from({length:peers||2},(_,i)=>`队友${i+1}的回答`),'{各家回答}':Array.from({length:answers.length||2},(_,i)=>`成员${i+1}的回答`),'{问题}':[key==='relay'?'你的问题':'上一轮的问题'],'{前面回答}':Array.from({length:Math.max(1,session.members.length-1)},(_,i)=>`第${i+1}位的回答`)};
  const text=fill(template,{轮次引导:roundHint(session,style,kind),总结要求:SUMMARY_DEPTH[depth]||SUMMARY_DEPTH['简要结论']});
  const parts=[];let rest=text;
  while(rest){const hit=Object.keys(slots).map(s=>[s,rest.indexOf(s)]).filter(([,i])=>i>=0).sort((a,b)=>a[1]-b[1])[0];
    if(!hit){parts.push({text:rest});break;}parts.push({text:rest.slice(0,hit[1])});for(const label of slots[hit[0]])parts.push({slot:label});rest=rest.slice(hit[1]+hit[0].length);}
  return {key,name:TEMPLATE_NAMES[key],custom:!!templates[key],template,parts:parts.filter(p=>p.slot||p.text)};
}
export function composePrompts(kind,text,session,{captain,depth='简要结论',style='debate',templates={},order}={}){
  if(!['ask','iterate','relay','discuss','inspire','summary'].includes(kind))throw new Error('不支持的圆桌操作。');
  if(typeof text!=='string')throw new Error('问题必须是文字。');
  const latest=session.rounds.at(-1),answers=latest?.jobs.filter(j=>j.status==='done'&&j.text)||[];
  if(['ask','iterate','relay'].includes(kind)&&!text.trim())throw new Error('请先输入问题或迭代要求。');
  if(PEER_KINDS.has(kind)&&answers.length<2)throw new Error(`至少需要两份完整回答才能进行${KIND_NAMES[kind]}。`);
  if(PEER_KINDS.has(kind)&&latest.jobs.some(j=>j.status!=='skipped'&&(j.status!=='done'||!j.text)))throw new Error(`本轮仍有不完整的回答，请先重新提取、核对完成，或跳过该成员，再${kind==='inspire'?'互相激发':'讨论'}。`);
  if(kind==='summary'&&(!answers.length||!session.members.includes(captain)))throw new Error('请为已有回答选择一位队长。');
  const targets=kind==='summary'?[captain]:kind==='relay'?relayOrder(session,order):session.members;
  const prompts=targets.map(provider=>{
    let prompt=text;
    const supplement=text.trim()?`\n\n用户补充要求：\n${text}`:'';
    if(PEER_KINDS.has(kind)){
      const key=templateKey(kind,style),peers=answers.filter(a=>a.provider!==provider);
      prompt=fill(templates[key]||DEFAULT_TEMPLATES[key],{轮次引导:roundHint(session,style,kind),队友回答:peers.map(a=>`【${PROVIDERS[a.provider].name} 的回答】:\n${a.text}`).join('\n\n')})+supplement;
    }
    if(kind==='summary')prompt=fill(templates.summary||DEFAULT_TEMPLATES.summary,{总结要求:SUMMARY_DEPTH[depth]||SUMMARY_DEPTH['简要结论'],问题:latest.prompt,各家回答:answers.map(a=>`--- ${PROVIDERS[a.provider].name} ---\n${a.text}`).join('\n\n')})+supplement;
    // Workflow: only the first member gets the question now; the others are composed when their turn comes.
    if(kind==='relay'&&provider!==targets[0])prompt='';
    if(prompt)prompt=forNewcomer(session,provider,prompt);
    if(prompt.length>MAX_PROMPT)throw new Error(`完整上下文超过 ${MAX_PROMPT.toLocaleString()} 字符，尚未发送。请导出后缩短材料或另开圆桌；不会自动截断。`);
    return {provider,prompt};
  });
  return prompts;
}
// A member that joins after the first round has none of the earlier conversation on its site. Unless its material
// already contains the roundtable's original question, one line in front says what is being discussed. Same wording
// as AI圆桌 Android 0.19.0 (RoundMaterials.forNewcomer). `before` is the number of earlier rounds to look at.
export function forNewcomer(session,provider,prompt,before=session.rounds.length){
  const original=session.rounds[0]?.prompt||'';
  if(!prompt||!original.trim()||before<1||prompt.includes(original))return prompt;
  const reached=session.rounds.slice(0,before).some(r=>r.jobs.some(j=>j.provider===provider&&(j.status==='done'||!!j.text||!!j.phase&&j.phase!=='not_sent')));
  if(reached)return prompt;
  // The added line counts toward the limit like everything else: too long is refused, never truncated.
  const full=`（你是中途加入这场讨论的成员。原始问题：\n${original}）\n\n${prompt}`;
  if(full.length>MAX_PROMPT)throw new Error(`完整上下文超过 ${MAX_PROMPT.toLocaleString()} 字符，尚未发送。请跳过这位成员或另开圆桌；不会自动截断。`);
  return full;
}
// The workflow order is the user's chosen order when it names exactly this roundtable's members.
export function relayOrder(session,order){const list=Array.isArray(order)?order:String(order||'').split(',').filter(Boolean);return list.length===session.members.length&&session.members.every(m=>list.includes(m))&&new Set(list).size===list.length?list:[...session.members];}
// Next workflow prompt: the question plus every earlier member's finished answer, in order. Skipped or failed
// members contribute nothing; without any earlier answer the member simply receives the question.
export function relayPrompt(round,index,templates={}){
  const earlier=round.jobs.slice(0,index).filter(j=>j.status==='done'&&j.text);
  const prompt=earlier.length?fill(templates.relay||DEFAULT_TEMPLATES.relay,{问题:round.prompt,前面回答:earlier.map(j=>`【${PROVIDERS[j.provider].name} 的回答】:\n${j.text}`).join('\n\n')}):round.prompt;
  if(prompt.length>MAX_PROMPT)throw new Error(`完整上下文超过 ${MAX_PROMPT.toLocaleString()} 字符，尚未发送。请跳过这位成员或另开圆桌；不会自动截断。`);
  return prompt;
}
// Whose turn it is in a workflow round: the first waiting member, once everyone before it has finished or been
// skipped. A member that failed or needs attention pauses the workflow until the user retries or skips it.
export function relayNext(round){
  if(round?.kind!=='relay'||round.stopped||round.jobs.some(j=>ACTIVE.has(j.status)))return -1;
  const index=round.jobs.findIndex(j=>j.status==='waiting');
  return index>0&&round.jobs.slice(0,index).every(j=>j.status==='done'||j.status==='skipped')?index:-1;
}
export function makeRound(kind,text,session,options={}){
  if(busy(session))throw new Error('本轮仍在进行，请等待或停止后再继续。');
  const prompts=composePrompts(kind,text,session,options);
  if(kind==='relay'&&prompts.length<2)throw new Error('工作流至少需要两位成员。');
  // supplement keeps the user's own text so a member who takes over a seat mid-round gets the same material.
  return {id:id(),kind,...(kind==='discuss'?{style:options.style==='collab'?'collab':'debate'}:{}),sourceRoundId:session.rounds.at(-1)?.id||null,supplement:text,prompt:text||({discuss:'比较各家的最新观点',inspire:'参考彼此的回答，各自给出更好的答案',summary:'请队长总结本轮观点'}[kind]||''),createdAt:Date.now(),jobs:prompts.map((p,i)=>({...p,id:id(),requestId:id(),status:kind==='relay'&&i>0?'waiting':'queued',phase:'not_sent',text:'',error:'',tabId:null,url:'',baseline:null,sequence:0,updatedAt:Date.now()}))};
}
// The member's current job in a round. A replaced job stays in the record (skipped, replacedBy) beside its successor.
export function jobFor(round,provider){return round?.jobs.findLast(j=>j.provider===provider&&!j.replacedBy)||null;}
// A seat still waiting on its member (sending, answering, queued in a workflow, failed or unconfirmed) is handed to the
// replacement in the same round. Done, skipped or stopped seats change from the next round on: skipping already said
// "not this round", and a stopped round must not start sending again by itself.
const TAKEOVER=new Set([...ACTIVE,'waiting','error','attention']);
export function canTakeOver(round,provider){const j=jobFor(round,provider);return !!j&&!round.stopped&&TAKEOVER.has(j.status);}
// Swaps a member in place (mutates the session). Returns the replacement's job when it must be sent now, and a copy of
// the replaced job when it was still running (its page must be told to stop).
export function replaceMember(session,provider,replacement,templates={}){
  if(!session.members.includes(provider))throw new Error('这位成员已不在圆桌里，请刷新后再试。');
  if(!PROVIDERS[replacement]||session.members.includes(replacement))throw new Error('请选择圆桌外的另一位 AI。');
  const members=session.members.map(m=>m===provider?replacement:m),round=session.rounds.at(-1);
  if(!validMembers(members))throw new Error(`请选择 2–${MAX_MEMBERS} 位不同的成员。`);
  const takeover=canTakeOver(round,provider),old=jobFor(round,provider);session.members=members;
  if(!takeover)return {job:null,previous:null};
  const previous=structuredClone(old),index=round.jobs.indexOf(old);
  Object.assign(old,{status:'skipped',replacedBy:replacement,error:'',updatedAt:Date.now()});
  const job={provider:replacement,prompt:'',id:id(),requestId:id(),status:'queued',phase:'not_sent',text:'',error:'',tabId:null,url:'',baseline:null,sequence:0,updatedAt:Date.now(),replaces:provider};
  round.jobs.splice(index+1,0,job);
  try{
    if(round.kind==='relay'){if(previous.status==='waiting')job.status='waiting';else job.prompt=relayPrompt(round,index+1,templates);}
    else if(PEER_KINDS.has(round.kind))job.prompt=peerPrompt(session,round,replacement,templates)??previous.prompt;
    else job.prompt=previous.prompt;
    job.prompt=forNewcomer(session,replacement,job.prompt,session.rounds.length-1);
  }catch(error){job.status='error';job.error=error.message;}
  return {job:job.status==='queued'?job:null,previous:ACTIVE.has(previous.status)?previous:null};
}
// Discussion material for a member joining mid-round: every answer of the source round (it has none of its own there).
// Rounds saved before 0.6.0 have no supplement; the replaced member's material is then reused as is.
function peerPrompt(session,round,provider,templates){
  const at=session.rounds.findIndex(x=>x.id===round.sourceRoundId);if(at<0||typeof round.supplement!=='string')return null;
  return composePrompts(round.kind,round.supplement,{...session,members:[provider],rounds:session.rounds.slice(0,at+1)},{style:round.style,templates})[0].prompt;
}
export function acceptEvent(job,event,tabId){return !!job&&job.requestId===event.requestId&&job.tabId===tabId&&ACTIVE.has(job.status)&&Number.isInteger(event.sequence)&&event.sequence>job.sequence;}
export function toMarkdown(session){return `# ${session.title}\n\n`+session.rounds.map((r,i)=>`## 第 ${i+1} 轮 · ${KIND_NAMES[r.kind]}${r.style==='collab'?'（取长补短）':''}\n\n${r.prompt}\n\n`+r.jobs.map(j=>`### ${PROVIDERS[j.provider].name} · ${LABELS[j.status]}${j.replacedBy?`（已换成 ${PROVIDERS[j.replacedBy]?.name||j.replacedBy}）`:''}\n\n${j.text||j.error||'尚无回答'}\n`+(j.earlier||[]).map((e,k)=>`\n#### ${PROVIDERS[j.provider].name} · 之前的回答 ${k+1}\n\n${e.text}\n`).join('')).join('\n')).join('\n');}
