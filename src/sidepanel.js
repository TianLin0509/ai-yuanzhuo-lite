import {PROVIDERS,MAX_MEMBERS,DISCUSSION_STYLES,ACTIVE,LABELS,busy,toMarkdown} from './core.js';
import {escapeHtml,fmtTime,fmtDateGroup,renderMarkdown,roundMatches} from './view.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],esc=escapeHtml;
const main=document.body.dataset.surface==='main',kinds={ask:'同题提问',iterate:'独立迭代',discuss:'观点讨论',summary:'队长总结'};
let windowId,model,reader={roundId:null,provider:'deepseek',pair:['deepseek','kimi'],expanded:[]},readerKey='',refreshTimer,noticeTimer,port;
let refreshing=false,refreshAgain=false,draftQueue=Promise.resolve(),pendingDrafts=0,starting=false,viewSignature='';
const textCache=new WeakMap();
const confirmedDrafts=new Map(),editorId=crypto.randomUUID();
const latest=()=>model?.session.rounds.at(-1),selected=()=>model?.session.rounds.find(r=>r.id===reader.roundId)||latest();
// Characters of the answer body, not counting whitespace; shown next to member names.
const length=text=>String(text||'').replace(/\s/g,'').length;
const placeholders={ask:'输入问题，原文完整发给每位成员。',iterate:'输入迭代要求，每家在自己的对话里改进。',discuss:'补充要求（可选）。每家会收到其他成员上一轮的完整回答。',summary:'补充要求（可选）。完整材料只交给队长。'};
const sendLabels={ask:'同题提问',iterate:'独立迭代',discuss:'发起讨论',summary:'请队长总结'};
function error(text){$('#error-banner').textContent=text;$('#error-banner').hidden=!text;}
function notice(text){$('#notice').textContent=text;$('#notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').hidden=true,4000);}
async function request(action,data={}){const r=await chrome.runtime.sendMessage({type:'YZ_COMMAND',windowId,sessionId:model?.session.id,action,...data});if(!r?.ok)throw new Error(r?.error||'扩展连接暂不可用，请重新打开界面。');const sessionId=r.sessionId||r.session?.id;if(sessionId&&r.draft){const known=confirmedDrafts.get(sessionId);if(known&&(known.revision||0)>(r.draft.revision||0))r.draft=known;else confirmedDrafts.set(sessionId,r.draft);}return r;}
async function act(action,data={}){error('');try{const result=await request(action,data);await refresh();return result;}catch(e){error(e.message);return null;}}
function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,80);}
async function refresh(){
  if(refreshing){refreshAgain=true;return;}refreshing=true;
  try{
    const wanted=main&&!model?new URL(location.href).searchParams.get('session'):undefined;
    const next=await request('state',wanted?{sessionId:wanted}:{}),changed=model?.session.id!==next.session.id;
    const previousLatest=latest()?.id;
    if(model&&!changed&&reader.roundId===previousLatest)reader.roundId=next.session.rounds.at(-1)?.id||null;
    model=next;
    if(changed){readerKey='arena.reader.'+model.session.id;const data=await chrome.storage.local.get(readerKey);reader={roundId:null,provider:'deepseek',pair:['deepseek','kimi'],expanded:[],...data[readerKey]};viewSignature='';if(main)history.replaceState(null,'','main.html?session='+encodeURIComponent(model.session.id));}
    if(!model.session.rounds.some(r=>r.id===reader.roundId))reader.roundId=latest()?.id||null;
    if(!pendingDrafts)await recoverDraft();const acknowledged=confirmedDrafts.get(model.session.id);if(acknowledged&&(acknowledged.revision||0)>(model.draft.revision||0))model.draft=acknowledged;
    document.title=model.session.title+' · AI圆桌lite';renderUpdate();renderController();if(main)renderMain();if(model.supportWarning)error(model.supportWarning);
  }catch(e){error(e.message);}finally{refreshing=false;if(refreshAgain){refreshAgain=false;scheduleRefresh();}}
}
// A newer build in the installed folder: offer an in-place reload (history and windows are kept).
function renderUpdate(){const b=$('#update');if(!b)return;const available=model.build?.available;b.hidden=!available;if(available){b.textContent='更新到新版本';b.title=`当前 ${model.build.running}，可更新到 ${available}。本轮进行中时不能更新。`;b.disabled=busy(model.session);}}
function persistReader(){chrome.storage.local.set({[readerKey]:reader}).catch(e=>error('阅读位置保存失败：'+e.message));}
const draftBackupKey=()=> 'arena.pending-draft.'+model.session.id;
async function recoverDraft(){
  const backup=JSON.parse(localStorage.getItem(draftBackupKey())||'null');if(!backup)return;
  if(backup.revision>(model.draft.lastInputRevision||0)){try{const result=await request('draft',backup);model.draft=result.draft;}catch(e){showDraftConflict(backup,e.message);return;}}
  const current=JSON.parse(localStorage.getItem(draftBackupKey())||'null');if(current?.revision<=(model.draft.lastInputRevision||0))localStorage.removeItem(draftBackupKey());
}
function showDraftConflict(backup,message){error(message);let button=$('#recover-draft');if(!button){button=document.createElement('button');button.id='recover-draft';button.textContent='查看未保存的草稿';$('#error-banner').append(button);}button.onclick=()=>{dialog('核对保留的草稿',`<p>下方是尚未保存的输入。可以复制保留，或明确用它替换当前草稿。</p><textarea class="copy-area" readonly>${esc(backup.patch.text||'')}</textarea><button id="use-backup">用这份输入替换当前草稿</button>`);$('#use-backup').onclick=async()=>{const current=await request('state');localStorage.removeItem(draftBackupKey());model.draft=current.draft;close();await saveDraft(backup.patch);await refresh();};};}
function saveDraft(patch){
  // Synchronous write-ahead copy also survives closing a view while the worker wakes.
  const key=draftBackupKey();let backup;
  try{const prior=JSON.parse(localStorage.getItem(key)||'null');backup={patch:{...prior?.patch,...patch},revision:Math.max(Date.now()*1000,(prior?.revision||0)+1,(model.draft.revision||0)+1),baseRevision:prior?.baseRevision??model.draft.revision??0,writer:editorId};localStorage.setItem(key,JSON.stringify(backup));}
  catch(e){error('草稿本地备份失败：'+e.message);backup={patch,revision:Date.now()*1000,baseRevision:model.draft.revision||0,writer:editorId};}
  pendingDrafts++;const write=request('draft',backup);draftQueue=Promise.all([draftQueue.catch(()=>{}),write]);
  write.then(result=>{pendingDrafts--;try{const pending=JSON.parse(localStorage.getItem(key)||'null');if(pending?.revision<=result.draft.lastInputRevision)localStorage.removeItem(key);}catch(e){error('草稿备份清理失败：'+e.message);}if(!pendingDrafts){model.draft=confirmedDrafts.get(model.session.id)||result.draft;renderController();}},e=>{pendingDrafts--;showDraftConflict(backup,'草稿保存失败，已保留本地备份：'+e.message);});draftQueue.catch(()=>{});return write;
}
function initController(){
  $('#controller').innerHTML=`<section class="members"><div class="section-head"><strong>成员 <small id="member-count"></small></strong><span><button id="edit-members" class="link">编辑成员</button><button id="connect" class="link">连接网页</button></span></div><div id="member-strip"></div><p id="connection-hint" class="hint">先在各家网页完成登录，再开始圆桌。</p></section><section class="compose"><p class="base-round"><span id="base-time"></span>回看历史不会改变这里。</p><input type="hidden" id="kind" value="ask"><div id="kinds" class="seg modes" role="group" aria-label="下一轮做什么">${Object.entries(kinds).map(([v,n])=>`<button data-kind="${v}" aria-pressed="false">${n}</button>`).join('')}</div><div id="style-options" class="summary-options" hidden><span>讨论方式</span><input type="hidden" id="style" value="debate"><span id="styles" class="seg" role="group" aria-label="讨论方式">${Object.entries(DISCUSSION_STYLES).map(([v,n])=>`<button data-style="${v}" aria-pressed="false">${n}</button>`).join('')}</span></div><div id="summary-options" class="summary-options" hidden><label>队长<select id="captain">${Object.entries(PROVIDERS).map(([id,p])=>`<option value="${id}">${p.name}</option>`).join('')}</select></label><label>深度<select id="depth"><option>简要结论</option><option>深入分析</option></select></label></div><label for="prompt" id="prompt-label" class="sr-only">问题或补充要求</label><textarea id="prompt" rows="4"></textarea><div class="send-footer"><button id="preview" class="link">预览各家收到的内容</button><button id="send" class="primary"><span id="send-label">开始圆桌</span><kbd>Ctrl Enter</kbd></button></div><details class="support-note"><summary>后台回答说明</summary><p>回答期间 Chrome 会显示调试提示，用来保持后台成员网页更新；本轮结束自动释放。取消提示会中断后台支持，可核对网页后重新提取。</p></details></section>`;
  $('#prompt').addEventListener('input',()=>saveDraft({text:$('#prompt').value}));
  for(const id of ['captain','depth'])$('#'+id).addEventListener('change',()=>{saveDraft({[id]:$('#'+id).value});renderMode();});
  $('#styles').addEventListener('click',e=>{const b=e.target.closest('[data-style]');if(!b||b.disabled||$('#style').value===b.dataset.style)return;$('#style').value=b.dataset.style;saveDraft({style:b.dataset.style});renderMode();});
  $('#kinds').addEventListener('click',e=>{const b=e.target.closest('[data-kind]');if(!b||b.disabled||$('#kind').value===b.dataset.kind)return;$('#kind').value=b.dataset.kind;saveDraft({kind:b.dataset.kind});renderMode();});
  $('#send').addEventListener('click',send);
  $('#prompt').addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter'&&!e.isComposing){e.preventDefault();send();}});
  $('#connect').addEventListener('click',()=>act('connect'));$('#edit-members').addEventListener('click',members);$('#preview').addEventListener('click',preview);
  $('#member-strip').addEventListener('click',e=>{const b=e.target.closest('[data-op]');if(!b||b.disabled)return;const p=b.dataset.provider,op=b.dataset.op,list=model.session.members;
    // Member edits reuse the validated 2–3 member save; answers already collected stay in the record.
    if(op==='replace')pickMember(`把 ${PROVIDERS[p].name} 换成`,q=>act('members',{members:list.map(m=>m===p?q:m)}));
    else if(op==='remove')act('members',{members:list.filter(m=>m!==p)});
    else if(op==='add')pickMember('添加成员',q=>act('members',{members:[...list,q]}));
    else if(op==='open')act('open',{provider:p});
    else{const j=latest()?.jobs.find(j=>j.provider===p);if(j)jobAction(j,op);}});
  if(!main)document.body.insertBefore($('.send-footer'),$('#dialog'));
}
function renderMode(){const kind=$('#kind').value;for(const b of $$('#kinds [data-kind]'))b.setAttribute('aria-pressed',String(b.dataset.kind===kind));$('#summary-options').hidden=kind!=='summary';$('#style-options').hidden=kind!=='discuss';for(const b of $$('#styles [data-style]'))b.setAttribute('aria-pressed',String(b.dataset.style===$('#style').value));$('#prompt').placeholder=placeholders[kind];$('#prompt-label').textContent=['ask','iterate'].includes(kind)?'问题或迭代要求':'补充要求（可选）';const active=busy(model?.session);$('#send').classList.toggle('stop',active);$('#send-label').textContent=active?'停止本轮':starting?'正在发起…':latest()?sendLabels[kind]:'开始圆桌';}
function renderController(){
  const s=model.session,r=latest(),active=busy(s),draft=model.draft;
  if(!pendingDrafts){for(const key of ['text','kind','captain','depth','style']){const el=$('#'+(key==='text'?'prompt':key));const value=draft[key]??({text:'',kind:'ask',captain:s.members[0],depth:'简要结论',style:'debate'}[key]);if(el.value!==value)el.value=value;}}
  $('#captain').querySelectorAll('option').forEach(o=>o.disabled=!s.members.includes(o.value));if(!s.members.includes($('#captain').value))$('#captain').value=s.members[0];
  $('.base-round').dataset.baseId=r?.id||'';$('#base-time').textContent=r?`下一轮基于第 ${s.rounds.length} 轮（${fmtTime(r.createdAt)}）。`:'这是第一轮。';
  const signature=JSON.stringify([s.members,s.bindings,r?.jobs.map(j=>[j.provider,j.status,j.error,length(j.text),!!j.baseline,j.phase,j.mode])]);
  if($('#member-strip').dataset.signature!==signature){$('#member-strip').dataset.signature=signature;$('#member-strip').innerHTML=s.members.map(p=>{
    const j=r?.jobs.find(j=>j.provider===p),bound=s.bindings[p]?.tabId,status=j?LABELS[j.status]+(j.text?`，${length(j.text)} 字`:''):(bound?'网页已连接':'未连接'),dot=j?j.status:bound?'connected':'idle';const action=(op,label)=>`<button data-provider="${p}" data-op="${op}">${label}</button>`;
    let recovery='';if(j&&!ACTIVE.has(j.status)){recovery+=action('reread','重新提取');if(!['done','skipped'].includes(j.status))recovery+=action('retry','重试发送')+action('skip','跳过');if(j.status==='attention'&&j.text)recovery+=action('confirm','确认已完成');}
    const edit=`<button class="edit-op" data-provider="${p}" data-op="replace" title="换成其他 AI">换人</button>${s.members.length>2?`<button class="edit-op" data-provider="${p}" data-op="remove" title="从下一轮移出">移出</button>`:''}`;
    return `<div class="member-row" data-status="${j?.status||'idle'}"><span class="dot" data-status="${dot}"></span><button class="member-chip ${bound?'connected':''}" data-provider="${p}" data-op="open" title="打开 ${PROVIDERS[p].name} 网页">${PROVIDERS[p].name}</button>${j?.mode?`<small class="mode" title="发送时网页显示的模型与模式">${esc(j.mode)}</small>`:''}<span class="state" data-status="${j?.status||'idle'}">${status}</span><span class="recovery">${recovery}${edit}</span>${j?.error?`<p class="member-error">${esc(j.error)}</p>`:''}</div>`;
  }).join('')+(s.members.length<MAX_MEMBERS?`<button class="add-member" data-op="add">＋ 添加成员</button>`:'');}
  $('#member-count').textContent=`${s.members.length}/${MAX_MEMBERS}`;for(const b of $$('#member-strip .edit-op,#member-strip .add-member'))b.disabled=active;
  $('#edit-members').disabled=active;$('#connect').disabled=active;$('#connection-hint').hidden=!!r;$('#send').disabled=starting&&!active;for(const b of $$('#kinds [data-kind]'))b.disabled=active;$('#preview').disabled=active;renderMode();
}
function renderMain(){
  if(document.hidden)return;
  const s=model.session,r=selected();$('#session-title').textContent=s.title;$('#question').textContent=r?.prompt||'一个问题，多种视角。';$('#latest').hidden=!r||r.id===latest()?.id;
  const done=r?r.jobs.filter(j=>j.status==='done').length:0;$('#round-meta').innerHTML=r?`<span>${kinds[r.kind]}${r.style==='collab'?'（取长补短）':''}</span><span>${new Date(r.createdAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})} ${fmtTime(r.createdAt)}</span><span>${done===r.jobs.length?`${done} 份完整回答`:`${done}/${r.jobs.length} 份完整回答`}</span>`:'';
  for(const b of $$('#layouts button')){const on=b.dataset.layout===(model.preferences.layout||'a');b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));}
  const q=$('#time-search').value.trim(),rounds=s.rounds.map((r,i)=>({...r,number:i+1})).reverse().filter(r=>roundMatches(r,q));let group='';
  const timeline=rounds.map(r=>{const date=fmtDateGroup(r.createdAt),head=date!==group?`<div class="date-group">${esc(date)}</div>`:'';group=date;return head+`<button class="time-item ${r.id===reader.roundId?'selected':''}" data-round="${r.id}"><span class="l1"><time>${fmtTime(r.createdAt)}</time><span>${kinds[r.kind]}</span><span class="count">${r.jobs.filter(j=>j.status==='done').length}/${r.jobs.length}</span></span><span class="l2">${esc(r.prompt)}</span></button>`;}).join('')||`<p class="hint">${q?'没有匹配的提问或回答':'提问后，这里会记录时间。'}</p>`;
  if($('#time-list')._html!==timeline){$('#time-list')._html=timeline;$('#time-list').innerHTML=timeline;}
  const source=s.rounds.find(x=>x.id===(r?.sourceRoundId||(r?.kind==='summary'?s.rounds[s.rounds.indexOf(r)-1]?.id:null)));
  $('#source').hidden=r?.kind!=='summary'||!source;if(!$('#source').hidden)$('#source').innerHTML=`${PROVIDERS[r.jobs[0]?.provider]?.name||'队长'} 的总结，材料来自<button data-source="${source.id}">第 ${s.rounds.indexOf(source)+1} 轮（${fmtTime(source.createdAt)}）</button>`;
  if(r)renderAnswers(r);else if(!$('#empty')){$('#reader').innerHTML='<section id="empty"><h2>先提出你的第一个问题</h2><p>在操作区选择成员并连接网页，完成登录后开始。</p></section>';viewSignature='';}
}
function answerShell(j,layout){const p=PROVIDERS[j.provider],content=`<div class="answer-error" hidden></div><div class="text"></div><div class="answer-actions"><button data-job="${j.id}" data-read="copy">复制全文</button><button data-job="${j.id}" data-read="quote">引用到下一轮</button><button data-job="${j.id}" data-read="open">打开原网页</button></div>`;
  return layout==='c'?`<details class="answer" data-job="${j.id}" ${reader.expanded.includes(j.id)?'open':''}><summary><span class="dot"></span><strong>${p.name}</strong><span class="preview"></span><span class="answer-status"></span><span class="chevron" aria-hidden="true">›</span></summary><div class="answer-body">${content}</div></details>`:`<article class="answer" data-job="${j.id}"><div class="answer-head"><span class="dot"></span><strong>${p.name}</strong>${j.mode?`<small class="mode">${esc(j.mode)}</small>`:''}<span class="answer-status"></span></div><div class="answer-body">${content}</div></article>`;
}
function renderAnswers(r){
  const layout=r.kind==='summary'?'a':model.preferences.layout||'a',providers=r.jobs.map(j=>j.provider);if(!providers.includes(reader.provider))reader.provider=providers[0];
  let pair=reader.pair.filter(p=>providers.includes(p));for(const p of providers)if(pair.length<2&&!pair.includes(p))pair.push(p);if(r.kind!=='summary')reader.pair=pair;
  const jobs=layout==='a'?r.jobs.filter(j=>j.provider===reader.provider):layout==='b'?pair.map(p=>r.jobs.find(j=>j.provider===p)):r.jobs,signature=JSON.stringify([r.id,layout,reader.provider,pair,r.jobs.map(j=>j.id)]);
  if(viewSignature!==signature){viewSignature=signature;const options=chosen=>providers.map(p=>`<option value="${p}" ${p===chosen?'selected':''}>${PROVIDERS[p].name}</option>`).join('');
    const nav=layout==='a'&&r.kind!=='summary'?`<div class="ai-tabs" role="group" aria-label="本轮回答者">${providers.map(p=>`<button data-ai="${p}" aria-pressed="${p===reader.provider}" class="${p===reader.provider?'active':''}"><span class="dot"></span>${PROVIDERS[p].name}<small></small></button>`).join('')}</div>`:layout==='b'?`<div class="pair-select"><label>左侧 <select id="pair-left">${options(pair[0])}</select></label><label>右侧 <select id="pair-right">${options(pair[1])}</select></label></div>`:'';
    $('#reader').innerHTML=nav+`<div id="answers" class="answers layout-${layout}">${jobs.map(j=>answerShell(j,layout)).join('')}</div>`;
    for(const card of $$('#answers details'))card.addEventListener('toggle',()=>{if(!card.isConnected)return;reader.expanded=card.open?[...new Set([...reader.expanded,card.dataset.job])]:reader.expanded.filter(id=>id!==card.dataset.job);persistReader();updateAnswer(card,selected()?.jobs.find(j=>j.id===card.dataset.job));});
    for(const id of ['pair-left','pair-right'])$('#'+id)?.addEventListener('change',e=>{const i=id==='pair-left'?0:1,other=1-i,previous=reader.pair[i];reader.pair[i]=e.target.value;if(reader.pair[other]===e.target.value)reader.pair[other]=previous;persistReader();renderAnswers(selected());});
  }
  for(const card of $$('#answers .answer'))updateAnswer(card,r.jobs.find(j=>j.id===card.dataset.job));
  for(const tab of $$('.ai-tabs [data-ai]')){const j=r.jobs.find(j=>j.provider===tab.dataset.ai);if(!j)continue;tab.querySelector('.dot').dataset.status=j.status;tab.querySelector('small').textContent=j.text?`${length(j.text)} 字`:LABELS[j.status];}
}
function updateAnswer(card,j){if(!j)return;card.querySelector('.answer-status').textContent=j.text&&j.status==='done'?`${length(j.text)} 字`:LABELS[j.status]+(j.text?`，${length(j.text)} 字`:'');card.dataset.status=j.status;card.querySelector('.dot').dataset.status=j.status;const warning=card.querySelector('.answer-error');warning.hidden=!j.error;warning.textContent=j.error;if(card.querySelector('.preview'))card.querySelector('.preview').textContent=(j.text||j.error||LABELS[j.status]).slice(0,180).replace(/[#*`>]+/g,'').replace(/\s+/g,' ').trim();
  for(const b of card.querySelectorAll('[data-read="copy"],[data-read="quote"]'))b.disabled=!j.text;
  if(card.tagName==='DETAILS'&&!card.open)return;const target=card.querySelector('.text'),signature=j.format+'|'+j.text+'|'+j.status;if(textCache.get(target)===signature)return;textCache.set(target,signature);if(!j.text){target.textContent=ACTIVE.has(j.status)?'等待这位成员的网页回答…':'尚无完整回答，请在侧栏核对成员状态。';return;}renderMarkdown(target,j.text,j.format);
}
function dialog(title,html){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal();}
function close(){$('#dialog').close();}
async function send(){
  if(!model)return;const active=model.session.rounds.find(r=>r.jobs.some(j=>ACTIVE.has(j.status)));if(active){await act('stop',{roundId:active.id});return;}if(starting)return;
  const text=$('#prompt').value,kind=$('#kind').value;if(['ask','iterate'].includes(kind)&&!text.trim()){error('请先输入问题或迭代要求。');$('#prompt').focus();return;}
  const options={captain:$('#captain').value,depth:$('#depth').value,style:$('#style').value},baseRoundId=latest()?.id||null;starting=true;renderController();try{await draftQueue;await act('start',{kind,text,options,baseRoundId});}catch(e){error(e.message);}finally{starting=false;await refresh();}
}
async function preview(){const r=await act('preview',{kind:$('#kind').value,text:$('#prompt').value,options:{captain:$('#captain').value,depth:$('#depth').value,style:$('#style').value}});if(!r)return;dialog('各家将收到的完整材料',`<p>下一轮基于最新记录；回看历史不会替换这些材料。</p>${r.prompts.map(p=>`<details class="prompt-preview"><summary>${PROVIDERS[p.provider].name}</summary><pre>${esc(p.prompt)}</pre></details>`).join('')}`);}
// Single choice among AIs not yet in this roundtable (swap one, or add one while under the limit).
function pickMember(title,onPick){const taken=new Set(model.session.members),group=(label,abroad)=>{const items=Object.entries(PROVIDERS).filter(([id,p])=>!!p.abroad===abroad&&!taken.has(id));return items.length?`<fieldset><legend>${label}</legend>${items.map(([id,p])=>`<button data-pick="${id}">${p.name}</button>`).join('')}</fieldset>`:'';};
  dialog(title,`<p>已有回答完整保留。新成员会在下一轮发送时打开它的网页，需要先在网页登录。</p><div class="member-options pick">${group('国内',false)}${group('海外（需能访问该网站）',true)}</div>`);
  for(const b of $$('#dialog-body [data-pick]'))b.onclick=()=>{close();onPick(b.dataset.pick);};}
function members(){
  const option=([id,p])=>`<label><input type="checkbox" name="member" value="${id}" ${model.session.members.includes(id)?'checked':''}>${p.name}</label>`,group=(title,abroad)=>`<fieldset><legend>${title}</legend>${Object.entries(PROVIDERS).filter(([,p])=>!!p.abroad===abroad).map(option).join('')}</fieldset>`;
  dialog('选择参与下一轮的成员',`<p>选择 2–${MAX_MEMBERS} 位成员，已有回答完整保留；之后新建的圆桌也沿用这组成员。每家都需要先在自己的网页登录。</p><div class="member-options">${group('国内',false)}${group('海外（需能访问该网站）',true)}</div><p id="member-limit" class="hint" hidden>已选满 ${MAX_MEMBERS} 位，取消一位后可换成其他成员。</p><button class="primary" id="save-members">保存成员</button>`);
  const boxes=$$('input[name="member"]'),limit=()=>{const full=boxes.filter(x=>x.checked).length>=MAX_MEMBERS;for(const x of boxes)x.disabled=full&&!x.checked;$('#member-limit').hidden=!full;};boxes.forEach(x=>x.addEventListener('change',limit));limit();
  $('#save-members').onclick=async()=>{const members=boxes.filter(x=>x.checked).map(x=>x.value);if(members.length<2){error('至少选择两位成员。');return;}close();await act('members',{members});};
}
async function jobAction(j,operation){const args={roundId:latest().id,jobId:j.id,operation};if(operation==='retry'&&j.phase==='attempted'){dialog('确认重新发送？','<p>此前已尝试发送，重发可能在网页产生重复问题。建议先重新提取。</p><button id="confirm-retry">确认重发这一家</button>');$('#confirm-retry').onclick=()=>{close();act('job',{...args,confirmDuplicate:true});};return;}
  const result=await act('job',args);
  // AI-Arena's manual extraction: when the page's latest question cannot be matched to this round
  // (edited or sent by hand on the site), show it and read its answer only after the user confirms.
  if(operation==='reread'&&result?.forceable){const f=result.forceable,name=PROVIDERS[f.provider].name;dialog(`读取 ${name} 网页的最新回答？`,`<p>${esc(name)} 网页里最新的提问和本轮原文对不上，常见于你在网页里手动改过或手动发送过。</p><p>网页最新提问：${f.question?'“'+esc(f.question)+(f.question.length>=120?'…':'')+'”':'（未读到）'}</p><p>确认后读取这条提问下的回答；若还在生成会等它写完，记录里会注明“未核对提问原文”。</p><button id="force-read" class="primary">读取这条回答</button>`);$('#force-read').onclick=()=>{close();act('job',{...args,force:true});};}
}
async function copy(text){try{await navigator.clipboard.writeText(text);notice('已复制完整内容。');}catch{dialog('选择全文复制',`<textarea class="copy-area" readonly>${esc(text)}</textarea>`);$('.copy-area').select();}}
function download(session=model.session){const url=URL.createObjectURL(new Blob([toMarkdown(session)],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=new Date().toISOString().slice(0,10).replaceAll('-','')+'-AI圆桌-'+session.id.slice(0,8)+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function historyList(){const data=await act('state');if(!data)return;dialog('历史圆桌',`<p>每场圆桌在自己的 Chrome 窗口打开，记录和草稿分别保存。</p><div class="history-list">${model.index.sessions.map(s=>`<div><button data-session="${s.id}">${esc(s.title)} <small>${s.rounds} 轮</small></button><button data-delete="${s.id}" aria-label="删除 ${esc(s.title)}">×</button></div>`).join('')}</div>`);}
$('#dialog-close').addEventListener('click',close);
$('#dialog-body').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.session){close();act('select',{sessionId:b.dataset.session});}else if(b.dataset.delete){const sessionId=b.dataset.delete;dialog('删除这场圆桌？','<p>请先导出需要保留的记录。删除只影响扩展历史，原网页对话不受影响。</p><button id="delete-confirm">确认删除记录</button>');$('#delete-confirm').onclick=async()=>{close();await act('delete',{sessionId,confirm:true});};}});
initController();
if(main){
  $('#layouts').addEventListener('click',e=>{const b=e.target.closest('[data-layout]');if(b)act('preferences',{layout:b.dataset.layout});});$('#time-search').addEventListener('input',()=>{if(model)renderMain();});
  $('#time-list').addEventListener('click',e=>{const b=e.target.closest('[data-round]');if(b){reader.roundId=b.dataset.round;persistReader();renderMain();$('#reader').scrollTop=0;}});$('#latest').onclick=()=>{reader.roundId=latest()?.id;persistReader();renderMain();};$('#source').onclick=e=>{const b=e.target.closest('[data-source]');if(b){reader.roundId=b.dataset.source;persistReader();renderMain();}};
  $('#reader').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.ai){reader.provider=b.dataset.ai;persistReader();renderMain();return;}const r=selected(),j=r?.jobs.find(j=>j.id===b.dataset.job);if(!j)return;if(b.dataset.read==='copy')copy(j.text);else if(b.dataset.read==='open')act('open-answer',{roundId:r.id,jobId:j.id});else if(b.dataset.read==='quote'){try{await draftQueue;if(await act('quote',{roundId:r.id,jobId:j.id}))notice('已将完整原文引用到下一轮草稿。');}catch(e){error(e.message);}}});
  $('#new').onclick=()=>act('new');$('#history').onclick=historyList;$('#export').onclick=()=>download();$('#open-sidepanel').onclick=()=>chrome.sidePanel.open({windowId}).catch(e=>error('侧栏打开失败：'+e.message));
}else $('#open-main').onclick=()=>act('main');
$('#update').onclick=async()=>{const r=await act('update');if(r?.reloading)notice('正在更新，稍后会自动重新打开圆桌记录。');};
async function panelVisibility(){if(!main)return;const data=await chrome.storage.session.get('arena.panel.'+windowId),open=!!data['arena.panel.'+windowId];$('#dock').hidden=open;$('#panel-active').hidden=!open;if(!open&&model)scheduleRefresh();}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes['arena.panel.'+windowId])panelVisibility().catch(e=>error(e.message));if(area!=='local')return;const draft=changes['arena.draft.'+model?.session.id]?.newValue;if(draft&&model){const known=confirmedDrafts.get(model.session.id);if(!known||(draft.revision||0)>=(known.revision||0)){confirmedDrafts.set(model.session.id,draft);if(!pendingDrafts){model.draft=draft;renderController();}}}if(Object.keys(changes).some(k=>k==='arena.preferences'||k==='arena.index'||k==='arena.session.'+model?.session.id))scheduleRefresh();});
function connectPanel(){port=chrome.runtime.connect({name:'arena-panel:'+windowId});port.postMessage({visible:!document.hidden});port.onDisconnect.addListener(()=>{setTimeout(()=>{try{connectPanel();scheduleRefresh();}catch(e){error('侧栏重新连接失败：'+e.message);}},300);});}
document.addEventListener('visibilitychange',()=>{if(!main&&port){try{port.postMessage({visible:!document.hidden});}catch(e){error('侧栏状态同步失败：'+e.message);}}else if(main&&!document.hidden)scheduleRefresh();});
async function init(){windowId=(await chrome.windows.getCurrent()).id;if(!main)connectPanel();await panelVisibility();await refresh();}
init().catch(e=>error(e.message));
