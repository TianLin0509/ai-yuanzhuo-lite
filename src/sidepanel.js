import {PROVIDERS,ACTIVE,LABELS,busy,toMarkdown} from './core.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let model,selectedRoundId,lastLatestId,refreshTimer,draftTimer,noticeTimer;
const cards=new Map(),expanded=new Set();
const currentRound=()=>model?.session.rounds.find(r=>r.id===selectedRoundId)||model?.session.rounds.at(-1);
function error(text){$('#error-banner').textContent=text;$('#error-banner').hidden=!text;}
function notice(text){$('#notice').textContent=text;$('#notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').hidden=true,4500);}
async function request(action,data={}){const response=await chrome.runtime.sendMessage({type:'YZ_COMMAND',action,...data});if(!response?.ok)throw new Error(response?.error||'扩展连接暂不可用，请重新打开侧栏。');return response;}
async function act(action,data={}){error('');try{const next=await request(action,{sessionId:model?.session.id,...data});await adopt(next);return true;}catch(e){error(e.message);return false;}}
async function adopt(next){const switched=model?.session.id!==next.session.id;model=next;const latest=model.session.rounds.at(-1)?.id;if(switched||latest!==lastLatestId){selectedRoundId=latest;lastLatestId=latest;cards.clear();expanded.clear();$('#answers').replaceChildren();}if(switched){const draft=await chrome.storage.session.get('draft.'+model.session.id);$('#prompt').value=draft['draft.'+model.session.id]||'';}render();}
async function refresh(){try{await adopt(await request('state'));}catch(e){error(e.message);}}
function actionButton(operation,label,emphasis=false){return `<button data-job-op="${operation}" ${emphasis?'class="emphasis"':''}>${label}</button>`;}
function renderText(card,job){const target=card.querySelector('.text');if(!card.open)return;const signature=job.status+'|'+job.format+'|'+job.text;if(card._signature===signature)return;card._signature=signature;
  if(!job.text){target.textContent=ACTIVE.has(job.status)?'等待这位成员的网页回答…':'';target.classList.add('plain');return;}
  if(job.format!=='markdown'){target.textContent=job.text;target.classList.add('plain');return;}
  target.classList.remove('plain');target.innerHTML=DOMPurify.sanitize(marked.parse(job.text,{gfm:true,breaks:true}),{ALLOWED_TAGS:['p','br','strong','em','h1','h2','h3','h4','h5','h6','ul','ol','li','pre','code','blockquote','a','table','thead','tbody','tr','td','th','hr','del'],ALLOWED_ATTR:['href','title','start']});
  target.querySelectorAll('a').forEach(a=>{if(!/^https?:\/\//i.test(a.getAttribute('href')||''))a.removeAttribute('href');else{a.target='_blank';a.rel='noopener noreferrer';}});
}
function renderAnswers(round){const ids=new Set(round.jobs.map(j=>j.id));for(const [id,card] of cards)if(!ids.has(id)){card.remove();cards.delete(id);}
  const latest=round.id===model.session.rounds.at(-1)?.id;
  for(const job of round.jobs){let card=cards.get(job.id);if(!card){card=document.createElement('details');card.className='answer';card.dataset.job=job.id;const p=PROVIDERS[job.provider];card.innerHTML=`<summary><div class="answer-head"><span class="avatar ${job.provider}">${p.short}</span><div><div class="member-name">${p.name}</div><div class="member-desc">网页会话</div></div><span class="state"></span><span class="chevron">⌄</span></div><div class="preview"></div></summary><div class="answer-body"><div class="answer-error" hidden></div><div class="text"></div><div class="actions"></div></div>`;cards.set(job.id,card);$('#answers').append(card);card.addEventListener('toggle',()=>{card.open?expanded.add(job.id):expanded.delete(job.id);const latest=currentRound()?.jobs.find(j=>j.id===job.id);if(latest)renderText(card,latest);});}
    card._job=job;const state=card.querySelector('.state');state.textContent=(job.status==='done'?'✓ ':'')+LABELS[job.status];state.dataset.status=job.status;card.querySelector('.preview').textContent=(job.text||job.error||LABELS[job.status]).replace(/\s+/g,' ').slice(0,110);
    const warning=card.querySelector('.answer-error');warning.hidden=!job.error;warning.textContent=job.error;
    const statusKey=job.status+'|'+job.phase+'|'+!!job.text+'|'+latest;
    if(card._statusKey!==statusKey){card._statusKey=statusKey;let actions=actionButton('open','原网页');if(job.text)actions+=actionButton('copy','复制全文');if(ACTIVE.has(job.status))actions+=actionButton('stop','停止');else if(latest){if(job.baseline&&job.phase==='attempted')actions+=actionButton('reread','重新提取');if(job.status!=='done'&&job.status!=='skipped')actions+=actionButton('retry','重试发送')+actionButton('skip','跳过');if(job.status==='attention'&&job.text)actions+=actionButton('confirm','确认已完成',true);}card.querySelector('.actions').innerHTML=actions;if(['error','attention'].includes(job.status))card.open=true;}
    renderText(card,job);
  }
}
function render(){if(!model)return;if(model.supportWarning)error(model.supportWarning);const s=model.session,r=currentRound(),active=busy(s);$('#member-strip').innerHTML=s.members.map(k=>`<button class="member-chip ${s.bindings[k]?'connected':''}" data-open-provider="${k}" title="打开 ${PROVIDERS[k].name} 网页">${PROVIDERS[k].name}</button>`).join('')+`<button class="edit-members" id="edit-members" ${active?'disabled':''}>成员</button>`;$('#member-count').textContent=s.members.length+' 位成员';$('#empty').hidden=!!r;$('#conversation').hidden=!r;
  $('#connect').textContent='打开并连接'+s.members.length+'家网页';$('#send').textContent=active?'停止本轮 ■':r?'继续追问 ↑':'开始圆桌 ↑';$('#new').disabled=active;
  $('#summary').disabled=active||!r?.jobs.some(j=>j.status==='done'&&j.text);$('#discuss').disabled=active||(r?.jobs.filter(j=>j.status==='done'&&j.text).length||0)<2;$('#iterate').disabled=active||!r;
  if(r){$('#session-title').textContent=s.title;$('#question').textContent=r.prompt;$('#kind').textContent={ask:'独立回答',iterate:'独立迭代',discuss:'观点讨论',summary:'队长总结'}[r.kind];$('#rounds').textContent='第 '+(s.rounds.indexOf(r)+1)+' 轮 ⌄';$('#progress-text').textContent=r.jobs.filter(j=>j.status==='done').length+' / '+r.jobs.length+' 已完成';renderAnswers(r);}else{cards.clear();$('#answers').replaceChildren();}
}
function dialog(title,html){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;$('#dialog').showModal();}
function close(){ $('#dialog').close(); }
function members(isNew){dialog(isNew?'新建一场圆桌':'选择圆桌成员',`<p>${isNew?'新问题使用独立的网页对话；现有圆桌保留在历史中。':'更改从下一轮生效，已有回答完整保留。'}选择 2–3 位成员。</p><div class="member-options">${Object.keys(PROVIDERS).map(k=>`<label class="member-option"><input type="checkbox" name="member" value="${k}" ${model.session.members.includes(k)?'checked':''}>${PROVIDERS[k].name}</label>`).join('')}</div><div class="dialog-error" role="status"></div><div class="dialog-footer"><button data-modal="close">取消</button><button class="primary" data-modal="members" data-new="${isNew}">${isNew?'新建圆桌':'保存'}</button></div>`);}
async function start(kind,options){if(['ask','iterate'].includes(kind)&&!$('#prompt').value.trim()){error('请先输入问题或迭代要求。');$('#prompt').focus();return;}if(currentRound()!==model.session.rounds.at(-1)&&kind!=='ask'){error('请切到最新一轮后再继续讨论或总结。');return;}const original=$('#prompt').value;const ok=await act('start',{kind,text:original,options});if(ok&&$('#prompt').value===original){clearTimeout(draftTimer);$('#prompt').value='';await chrome.storage.session.remove('draft.'+model.session.id);}}
function summary(){const answers=currentRound().jobs.filter(j=>j.status==='done'&&j.text);dialog('请一位队长收拢观点',`<p>交给队长本轮 ${answers.length} 份完整回答。未完成的成员不会混入总结材料。</p><label class="field">队长<select id="captain">${model.session.members.map(k=>`<option value="${k}">${PROVIDERS[k].name}</option>`).join('')}</select></label><label class="field">总结深度<select id="depth"><option>简要结论</option><option>深入分析</option></select></label><div class="dialog-footer"><button data-modal="close">取消</button><button data-modal="summary" class="primary">开始总结</button></div>`);}
async function copy(text){try{await navigator.clipboard.writeText(text);notice('已复制完整内容。');}catch{dialog('选择文字复制',`<p>浏览器未允许自动复制，可以选择下方完整文字复制。</p><textarea readonly class="copy-area">${escape(text)}</textarea>`);$('.copy-area').select();}}
function download(){const text=toMarkdown(model.session),url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;const date=new Date().toISOString().slice(0,10).replaceAll('-','');a.download=date+'-AI圆桌lite-'+model.session.id.slice(0,8)+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);notice('已导出完整圆桌记录。');}
$('#send').addEventListener('click',()=>{const active=model.session.rounds.find(r=>r.jobs.some(j=>ACTIVE.has(j.status)));if(active)act('stop',{roundId:active.id});else start('ask');});
$('#prompt').addEventListener('keydown',event=>{if(event.ctrlKey&&event.key==='Enter'&&!event.isComposing&&!busy(model.session)){event.preventDefault();start('ask');}});
$('#prompt').addEventListener('input',()=>{clearTimeout(draftTimer);const sessionId=model?.session.id,text=$('#prompt').value;draftTimer=setTimeout(()=>{chrome.storage.session.set({['draft.'+sessionId]:text}).catch(e=>error('草稿保存失败：'+e.message));},250);});
$('#new').addEventListener('click',()=>members(true));$('#connect').addEventListener('click',()=>act('connect'));
$('#member-strip').addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.id==='edit-members')members(false);else act('open',{provider:button.dataset.openProvider});});
$('#summary').addEventListener('click',summary);$('#discuss').addEventListener('click',()=>start('discuss'));$('#iterate').addEventListener('click',()=>start('iterate'));
$('#rounds').addEventListener('click',()=>dialog('回看轮次',`<div class="history-list">${model.session.rounds.map((r,i)=>`<button data-modal="round" data-round="${r.id}">第 ${i+1} 轮 · ${escape(r.prompt.slice(0,28))}</button>`).join('')}</div>`));
$('#history').addEventListener('click',()=>dialog('最近的圆桌',`<div class="history-list">${model.index.sessions.map(s=>`<div class="history-row"><button data-modal="session" data-session="${s.id}"><span>${escape(s.title)}</span><small>${s.rounds} 轮</small></button><button data-modal="delete" data-session="${s.id}" aria-label="删除 ${escape(s.title)}">×</button></div>`).join('')}</div>`));
$('#menu').addEventListener('click',()=>dialog('这场圆桌',`<div class="history-list"><button data-modal="export">导出完整 Markdown</button><button data-modal="connect">打开并连接成员网页</button></div><p class="version">AI圆桌lite 0.1.0 · 首批 DeepSeek / Kimi / 豆包。<br>网页未完成登录或暂停时，请打开对应原网页处理。</p>`));
$('#answers').addEventListener('click',event=>{const button=event.target.closest('[data-job-op]');if(!button)return;const card=button.closest('[data-job]'),job=card._job,operation=button.dataset.jobOp;const args={roundId:currentRound().id,jobId:job.id,operation};
  if(operation==='copy')copy(job.text);else if(operation==='open')act('open',{provider:job.provider});else if(operation==='retry'&&job.phase==='attempted')dialog('确认重新发送？',`<p>此前已经尝试发送，重发可能在网页上产生重复问题。建议先“重新提取”确认是否已有回答。</p><div class="dialog-footer"><button data-modal="close">先不重发</button><button class="primary" data-modal="retry" data-job="${job.id}" data-round="${currentRound().id}">确认重发这一家</button></div>`);else act('job',args);
});
$('#dialog-close').addEventListener('click',close);
$('#dialog-body').addEventListener('click',async event=>{const b=event.target.closest('[data-modal]');if(!b)return;const op=b.dataset.modal;
  if(op==='close')close();else if(op==='members'){const selected=$$('input[name="member"]:checked').map(e=>e.value);if(selected.length<2){$('.dialog-error').textContent='至少选择两位成员。';return;}const isNew=b.dataset.new==='true';close();await act(isNew?'new':'members',{members:selected});}
  else if(op==='summary'){const options={captain:$('#captain').value,depth:$('#depth').value};close();start('summary',options);}
  else if(op==='round'){selectedRoundId=b.dataset.round;cards.clear();$('#answers').replaceChildren();close();render();}
  else if(op==='session'){close();await act('select',{sessionId:b.dataset.session});}
  else if(op==='retry'){const args={roundId:b.dataset.round,jobId:b.dataset.job,operation:'retry',confirmDuplicate:true};close();await act('job',args);}
  else if(op==='export'){close();download();}else if(op==='connect'){close();await act('connect');}
  else if(op==='delete'){const sessionId=b.dataset.session;close();dialog('删除这场圆桌？',`<p>删除后无法在本扩展中恢复。请先导出需要保留的内容。原网页对话不会被删除。</p><div class="dialog-footer"><button data-modal="close">取消</button><button data-modal="delete-confirm" data-session="${sessionId}">确认删除</button></div>`);}
  else if(op==='delete-confirm'){close();await act('delete',{sessionId:b.dataset.session,confirm:true});}
});
$('#open-sidepanel').addEventListener('click',()=>{chrome.windows.getCurrent().then(window=>chrome.sidePanel.open({windowId:window.id})).catch(e=>error(e.message));});
chrome.tabs.getCurrent().then(tab=>{$('#open-sidepanel').hidden=!tab;}).catch(e=>error(e.message));
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&Object.keys(changes).some(k=>k.startsWith('arena.'))){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,70);}});
refresh();
