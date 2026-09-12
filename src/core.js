export const PROVIDERS = Object.freeze({
  deepseek: {name:'DeepSeek', short:'DS', url:'https://chat.deepseek.com/', hosts:['chat.deepseek.com']},
  kimi: {name:'Kimi', short:'K', url:'https://www.kimi.com/', hosts:['www.kimi.com','kimi.com','kimi.moonshot.cn']},
  doubao: {name:'豆包', short:'豆', url:'https://www.doubao.com/chat/', hosts:['www.doubao.com']}
});
export const ACTIVE = new Set(['queued','preparing','sending','sent','streaming','unconfirmed']);
export const LABELS = {queued:'准备连接',preparing:'检查网页',sending:'正在发送',sent:'等待回答',streaming:'正在回答',unconfirmed:'发送待确认',done:'已完成',attention:'需要确认',error:'需要处理',stopped:'已停止',skipped:'已跳过'};
export const MAX_PROMPT = 120000;
export function id(){return crypto.randomUUID();}
export function providerFor(url){try{const host=new URL(url).hostname;return Object.keys(PROVIDERS).find(k=>PROVIDERS[k].hosts.includes(host))||null;}catch{return null;}}
export function cleanUrl(url){try{const u=new URL(url);return u.origin+u.pathname;}catch{return '';}}
export function newSession(memberIds){
  if(!Array.isArray(memberIds)||memberIds.length<2||memberIds.length>3||new Set(memberIds).size!==memberIds.length||memberIds.some(k=>!PROVIDERS[k]))throw new Error('请选择 2–3 位不同的成员。');
  return {id:id(),title:'新的圆桌',createdAt:Date.now(),updatedAt:Date.now(),members:memberIds,bindings:{},rounds:[]};
}
export function busy(session){return session?.rounds.some(r=>r.jobs.some(j=>ACTIVE.has(j.status)))||false;}
// AI-Arena: templates-builtin.js debate.free and debate-engine.js buildDebatePrompt.
// Keep its peer-only relay and round guidance without the template manager or compression.
const DISCUSSION_MAIN='以下是其他 AI 对同一问题的回答，请分析他们的观点，指出你认同和不认同的地方，并给出你的改进回答。';
const DISCUSSION_HINTS=[
  '这是第1轮辩论。请仔细阅读其他参与者的初始回答，找出核心分歧和共识。',
  '这是第2轮辩论。经过上一轮交锋，请聚焦于仍存在分歧的关键点，深化你的论证或修正你的观点。',
  '这是第3轮辩论。辩论已进入深水区，请避免重复已达成共识的内容，集中攻克剩余分歧点，给出最终立场。'
];
export function composePrompts(kind,text,session,{captain,depth='简要结论'}={}){
  if(!['ask','iterate','discuss','summary'].includes(kind))throw new Error('不支持的圆桌操作。');
  if(typeof text!=='string')throw new Error('问题必须是文字。');
  const latest=session.rounds.at(-1),answers=latest?.jobs.filter(j=>j.status==='done'&&j.text)||[];
  if(['ask','iterate'].includes(kind)&&!text.trim())throw new Error('请先输入问题或迭代要求。');
  if(kind==='discuss'&&answers.length<2)throw new Error('至少需要两份完整回答才能进行观点讨论。');
  if(kind==='discuss'&&latest.jobs.some(j=>j.status!=='done'||!j.text))throw new Error('本轮仍有不完整的回答，请先重新提取或核对完成，再讨论。');
  if(kind==='summary'&&(!answers.length||!session.members.includes(captain)))throw new Error('请为已有回答选择一位队长。');
  const targets=kind==='summary'?[captain]:session.members;
  const prompts=targets.map(provider=>{
    let prompt=text;
    if(kind==='discuss'){
      const peers=answers.filter(a=>a.provider!==provider),number=session.rounds.filter(r=>r.kind==='discuss').length+1;
      const hint=DISCUSSION_HINTS[number-1]||`这是第${number}轮辩论。请只针对仍有分歧的核心问题发表精炼观点。`;
      prompt=`${text?'用户补充要求：'+text+'\n\n':''}${hint}\n\n${DISCUSSION_MAIN}\n\n${peers.map(a=>`【${PROVIDERS[a.provider].name} 的回答】:\n${a.text}`).join('\n\n')}`;
    }
    if(kind==='summary')prompt=`请作为圆桌队长，总结以下讨论，输出${depth==='深入分析'?'深入分析（共识、分歧、依据、仍待确认的问题与建议）':'简要结论与可执行的下一步'}。不要把成员之间的互相同意当成事实已核实。\n\n问题：\n${latest.prompt}\n\n${answers.map(a=>`--- ${PROVIDERS[a.provider].name} ---\n${a.text}`).join('\n\n')}\n\n${text?'用户补充要求：\n'+text:''}`;
    if(prompt.length>MAX_PROMPT)throw new Error(`完整上下文超过 ${MAX_PROMPT.toLocaleString()} 字符，尚未发送。请导出后缩短材料或另开圆桌；不会自动截断。`);
    return {provider,prompt};
  });
  return prompts;
}
export function makeRound(kind,text,session,options={}){
  if(busy(session))throw new Error('本轮仍在进行，请等待或停止后再继续。');
  const prompts=composePrompts(kind,text,session,options);
  return {id:id(),kind,sourceRoundId:session.rounds.at(-1)?.id||null,prompt:text||({discuss:'比较各家的最新观点',summary:'请队长总结本轮观点'}[kind]||''),createdAt:Date.now(),jobs:prompts.map(p=>({...p,id:id(),requestId:id(),status:'queued',phase:'not_sent',text:'',error:'',tabId:null,url:'',baseline:null,sequence:0,updatedAt:Date.now()}))};
}
export function acceptEvent(job,event,tabId){return !!job&&job.requestId===event.requestId&&job.tabId===tabId&&ACTIVE.has(job.status)&&Number.isInteger(event.sequence)&&event.sequence>job.sequence;}
export function toMarkdown(session){return `# ${session.title}\n\n`+session.rounds.map((r,i)=>`## 第 ${i+1} 轮 · ${{ask:'独立回答',iterate:'独立迭代',discuss:'观点讨论',summary:'队长总结'}[r.kind]}\n\n${r.prompt}\n\n`+r.jobs.map(j=>`### ${PROVIDERS[j.provider].name} · ${LABELS[j.status]}\n\n${j.text||j.error||'尚无回答'}\n`).join('\n')).join('\n');}
