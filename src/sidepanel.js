import {PROVIDERS,MAX_MEMBERS,DISCUSSION_STYLES,ACTIVE,LABELS,KIND_NAMES,busy,toMarkdown,presetView,relayOrder,jobFor,canTakeOver} from './core.js';
import {initUpdates,remoteUpdate,openUpdates} from './update-ui.js';
import {escapeHtml,fmtTime,fmtDateGroup,fmtRelative,historyGroup,renderMarkdown,roundMatches} from './view.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],esc=escapeHtml;
const main=document.body.dataset.surface==='main',kinds=KIND_NAMES,modes={iterate:'独立迭代',relay:'工作流',discuss:'观点讨论',inspire:'互相激发',summary:'队长总结'};
// One line under the mode buttons says what the next round does, so 观点讨论 and 互相激发 are told apart at a glance.
const modeNotes={iterate:'原文完整发给每位成员，各自在自己的对话里回答，不附加任何预设。',relay:'按顺序接力：第 1 位回答问题，之后每位还会收到前面各位的完整回答。',discuss:'每位收到其他成员上一轮的回答，互相评判，找出分歧与共识。',inspire:'每位把其他成员上一轮的回答当作灵感，各自写出更好的独立答案，不追求一致。',summary:'由队长汇总上一轮各家的完整回答，给出结论。'};
// Line icons (currentColor) for the member escape actions and answer actions.
const ICON={reread:'<path d="M13.2 8.6A5.3 5.3 0 1 1 11.6 4.1M12.2 1.9v2.6H9.6"/>',retry:'<path d="M2.4 7.6 13.6 2.4 9.9 13.6 7.7 9.2zM7.7 9.2l5.9-6.8"/>',skip:'<path d="M3.2 3.4 9 8l-5.8 4.6zM12.6 3.4v9.2"/>',replace:'<path d="M2.6 5.4h10.2M10.3 2.9l2.5 2.5-2.5 2.5M13.4 10.6H3.2M5.7 8.1l-2.5 2.5 2.5 2.5"/>',open:'<path d="M9.2 2.6h4.2v4.2M13.4 2.6 7.6 8.4M11.8 9.6v3.8H2.6V4.2h3.8"/>',check:'<path d="M2.8 8.4 6.3 11.8 13.2 4.4"/>',clear:'<path d="M3 4.4h10M6.2 4.4V2.8h3.6v1.6M4.4 4.4l.7 8.8h5.8l.7-8.8"/>'};
const icon=name=>`<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">${ICON[name]}</svg>`;
const avatar=p=>`<span class="avatar" data-p="${p}" aria-hidden="true">${esc(PROVIDERS[p]?.short||'?')}</span>`;
let windowId,model,reader={roundId:null,provider:'deepseek',pair:['deepseek','kimi'],expanded:[]},readerKey='',refreshTimer,noticeTimer,port;
let refreshing=false,refreshAgain=false,draftQueue=Promise.resolve(),pendingDrafts=0,starting=false,viewSignature='';
const textCache=new WeakMap();
const confirmedDrafts=new Map(),editorId=crypto.randomUUID();
const latest=()=>model?.session.rounds.at(-1),selected=()=>model?.session.rounds.find(r=>r.id===reader.roundId)||latest();
// Characters of the answer body, not counting whitespace; shown next to member names.
const length=text=>String(text||'').replace(/\s/g,'').length;
const placeholders={iterate:'输入问题或迭代要求，原文完整发给每位成员，各自在自己的对话里回答。',relay:'输入问题。第 1 位直接收到，之后每位还会收到前面各位的回答。',discuss:'想额外强调的要求，可留空。',inspire:'想额外强调的要求，可留空。',summary:'想额外强调的要求，可留空。'};
const slotHelp={relay:'{问题} 是你这次输入的问题；{前面回答} 会换成前面各位的完整回答（跳过的成员不算），两者都必须保留。第 1 位只收到问题本身。',discuss:'{轮次引导} 会换成“这是第 N 轮…”；{队友回答} 会换成其他成员上一轮的完整回答，必须保留。',inspire:'{轮次引导} 会换成“这是第 N 轮互相激发…”；{队友回答} 会换成其他成员上一轮的完整回答，必须保留。',summary:'{总结要求} 随“深度”变化；{问题} 是上一轮的问题；{各家回答} 会换成全部完整回答，必须保留。'};
const sendLabels={iterate:'独立迭代',relay:'开始工作流',discuss:'发起讨论',inspire:'互相激发',summary:'请队长总结'};
// Earlier drafts may still say “同题提问”, which is now the same as 独立迭代.
const modeOf=kind=>modes[kind]?kind:'iterate';
const inProgress=r=>r.jobs.some(j=>ACTIVE.has(j.status)||j.status==='waiting');
// What a member page needs from the user, found right after connecting (read-only check).
const HEALTH={login:'需要登录',verify:'需要人机验证',quota:'额度已用完',noinput:'网页未就绪'};
const elapsed=ms=>{const s=Math.max(0,Math.floor(ms/1000));return s<60?s+'秒':Math.floor(s/60)+'分'+String(s%60).padStart(2,'0')+'秒';};
function error(text){$('#error-banner').textContent=text;$('#error-banner').hidden=!text;}
function notice(text){$('#notice').textContent=text;$('#notice').hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').hidden=true,4000);}
async function request(action,data={}){const r=await chrome.runtime.sendMessage({type:'YZ_COMMAND',windowId,sessionId:model?.session.id,action,...data});if(!r?.ok)throw new Error(r?.error||'扩展连接暂不可用，请重新打开界面。');const sessionId=r.sessionId||r.session?.id;if(sessionId&&r.draft){const known=confirmedDrafts.get(sessionId);if(known&&(known.revision||0)>(r.draft.revision||0))r.draft=known;else confirmedDrafts.set(sessionId,r.draft);}return r;}
async function act(action,data={}){error('');try{const result=await request(action,data);await refresh();return result;}catch(e){error(e.message);return null;}}
function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,80);}
async function refresh(){
  if(refreshing){refreshAgain=true;return;}refreshing=true;
  try{
    const wanted=main&&!model?new URL(location.href).searchParams.get('session'):undefined;
    const next=await request('state',{sessionId:wanted}),changed=model?.session.id!==next.session.id;
    const previousLatest=latest()?.id;
    if(model&&!changed&&reader.roundId===previousLatest)reader.roundId=next.session.rounds.at(-1)?.id||null;
    model=next;
    if(changed){readerKey='arena.reader.'+model.session.id;const data=await chrome.storage.local.get(readerKey);reader={roundId:null,provider:'deepseek',pair:['deepseek','kimi'],expanded:[],...data[readerKey]};viewSignature='';if(main)history.replaceState(null,'','main.html?session='+encodeURIComponent(model.session.id));}
    if(!model.session.rounds.some(r=>r.id===reader.roundId))reader.roundId=latest()?.id||null;
    if(!pendingDrafts)await recoverDraft();const acknowledged=confirmedDrafts.get(model.session.id);if(acknowledged&&(acknowledged.revision||0)>(model.draft.revision||0))model.draft=acknowledged;
    document.title=model.session.title+' · AI圆桌lite';if($('#panel-title'))$('#panel-title').textContent=model.session.title;renderUpdate();renderController();if(main)renderMain();if(model.supportWarning)error(model.supportWarning);
  }catch(e){error(e.message);}finally{refreshing=false;if(refreshAgain){refreshAgain=false;scheduleRefresh();}}
}
// A newer build in the installed folder: offer an in-place reload (history and windows are kept).
// The version is always visible so the user can tell at a glance which build is running.
function renderVersion(){const v='v'+chrome.runtime.getManifest().version,build=model?.build?.running;for(const el of $$('.app-version')){el.textContent=v;el.title=`AI圆桌lite ${v}${build?' · 构建 '+build:''}`;}}
// A newer release online (one-click update) shows the same button; it opens the update dialog.
function renderUpdate(){renderVersion();const b=$('#update');if(!b)return;const available=model?.build?.available,online=!available&&remoteUpdate();b.hidden=!available&&!online;b.dataset.kind=available?'disk':online?'online':'';if(available){b.textContent='更新到新版本';b.title=`当前 ${model.build.running}，可更新到 ${available}。本轮进行中时不能更新。`;b.disabled=busy(model.session);}else if(online){b.textContent='可更新';b.title=`新版本 v${online.version}：点开查看更新内容并一键更新`;b.disabled=false;}for(const el of $$('.app-version'))el.classList.toggle('has-update',!!online);}
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
  $('#controller').innerHTML=`<section class="members"><div class="section-head"><strong>成员 <small id="member-count"></small></strong><span><button id="edit-members" class="link">编辑成员</button><button id="connect" class="link">连接网页</button></span></div><div id="member-strip"></div><p id="connection-hint" class="hint">先在各家网页完成登录，再开始圆桌。</p></section><section class="compose"><div class="section-head"><strong>下一轮</strong><p class="base-round" title="回看历史不会改变下一轮的基准"><span id="base-time"></span></p></div><input type="hidden" id="kind" value="ask"><div id="kinds" class="seg modes" role="group" aria-label="下一轮做什么">${Object.entries(modes).map(([v,n])=>`<button data-kind="${v}" data-k="${v}" aria-pressed="false">${n}</button>`).join('')}</div><p id="plain-note" class="mode-note"></p><div id="style-options" class="summary-options" hidden><span>讨论方式</span><input type="hidden" id="style" value="debate"><span id="styles" class="seg" role="group" aria-label="讨论方式">${Object.entries(DISCUSSION_STYLES).map(([v,n])=>`<button data-style="${v}" aria-pressed="false">${n}</button>`).join('')}</span></div><div id="relay-options" class="summary-options" hidden><span>顺序</span><input type="hidden" id="order" value=""><span id="relay-order" class="relay-order" aria-label="工作流回答顺序"></span></div><div id="summary-options" class="summary-options" hidden><label>队长<select id="captain">${Object.entries(PROVIDERS).map(([id,p])=>`<option value="${id}">${p.name}</option>`).join('')}</select></label><label>深度<select id="depth"><option>简要结论</option><option>深入分析</option></select></label></div><div id="preset" class="preset" hidden><div class="preset-head"><span>预设提示词 · <span id="preset-name"></span></span><small id="preset-custom" hidden>已自定义</small><button id="edit-preset" class="link">编辑</button></div><div id="preset-body" class="preset-body"></div><div id="preset-editor" hidden><label for="preset-text" class="sr-only">编辑预设提示词</label><textarea id="preset-text" rows="7"></textarea><p id="preset-help" class="hint"></p><div class="preset-actions"><button id="preset-save" class="primary">保存预设</button><button id="preset-reset">恢复默认</button><button id="preset-cancel" class="link">取消</button></div></div></div><label for="prompt" id="prompt-label" class="sr-only">问题或补充要求</label><textarea id="prompt" rows="4"></textarea><div class="send-footer"><button id="preview" class="link">预览各家收到的内容</button><button id="send" class="primary"><span id="send-label">开始圆桌</span><kbd>Ctrl Enter</kbd></button></div><details class="support-note"><summary>后台回答说明</summary><p>回答期间 Chrome 会显示调试提示，用来保持后台成员网页更新；本轮结束自动释放。取消提示会中断后台支持，可核对网页后重新提取。</p></details></section>`;
  $('#prompt').addEventListener('input',()=>saveDraft({text:$('#prompt').value}));
  for(const id of ['captain','depth'])$('#'+id).addEventListener('change',()=>{saveDraft({[id]:$('#'+id).value});renderMode();});
  $('#styles').addEventListener('click',e=>{const b=e.target.closest('[data-style]');if(!b||b.disabled||$('#style').value===b.dataset.style)return;$('#style').value=b.dataset.style;saveDraft({style:b.dataset.style});renderMode();});
  $('#kinds').addEventListener('click',e=>{const b=e.target.closest('[data-kind]');if(!b||b.disabled||$('#kind').value===b.dataset.kind)return;$('#kind').value=b.dataset.kind;saveDraft({kind:b.dataset.kind});renderMode();});
  $('#send').addEventListener('click',send);
  // Workflow order: “↑” moves a member one place earlier; the order is part of this roundtable's draft.
  $('#relay-order').addEventListener('click',e=>{const b=e.target.closest('[data-up]');if(!b||b.disabled)return;const list=relayOrder(model.session,$('#order').value),i=Number(b.dataset.up);[list[i-1],list[i]]=[list[i],list[i-1]];$('#order').value=list.join(',');saveDraft({order:$('#order').value});renderMode();});
  $('#edit-preset').addEventListener('click',()=>{const view=currentPreset();if(!view)return;$('#preset-editor').dataset.key=view.key;$('#preset-text').value=view.template;$('#preset-help').textContent=slotHelp[view.key.split('.')[0]]+'修改对之后所有圆桌生效。';$('#preset-editor').hidden=false;$('#preset-body').hidden=true;$('#edit-preset').hidden=true;$('#preset-text').focus();});
  const closeEditor=()=>{$('#preset-editor').hidden=true;$('#preset-body').hidden=false;$('#edit-preset').hidden=false;};
  $('#preset-cancel').addEventListener('click',closeEditor);
  $('#preset-save').addEventListener('click',async()=>{if(await act('template',{key:$('#preset-editor').dataset.key,text:$('#preset-text').value})){closeEditor();notice('预设已保存，之后所有圆桌都用这一版。');}});
  $('#preset-reset').addEventListener('click',async()=>{if(await act('template',{key:$('#preset-editor').dataset.key,text:null})){closeEditor();notice('已恢复默认预设。');}});
  $('#prompt').addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter'&&!e.isComposing){e.preventDefault();send();}});
  $('#connect').addEventListener('click',()=>act('connect'));$('#edit-members').addEventListener('click',members);$('#preview').addEventListener('click',preview);
  $('#member-strip').addEventListener('click',e=>{const b=e.target.closest('[data-op]');if(!b||b.disabled)return;const p=b.dataset.provider,op=b.dataset.op,list=model.session.members;
    // 换人 is available at any time: a member this round still waits on hands its seat to the replacement.
    if(op==='replace'){const name=PROVIDERS[p].name,takeover=canTakeOver(latest(),p);
      pickMember(`把 ${name} 换成`,async q=>{const order=$('#order').value;if(await act('replace',{provider:p,replacement:q})){if(order.split(',').includes(p))saveDraft({order:order.split(',').map(m=>m===p?q:m).join(',')});notice(takeover?`${PROVIDERS[q].name} 已接手本轮。`:`已换成 ${PROVIDERS[q].name}，从下一轮起参加。`);}},
        takeover?`<strong>${esc('选中的 AI 会立刻接手本轮')}</strong>：收到与 ${esc(name)} 这个位置相同的材料并发送；${esc(name)} 本轮记为“已跳过”，已有记录完整保留。`:`本轮 ${esc(name)} 已结束（完成、跳过或停止），新成员从下一轮起参加；已有回答完整保留。`);}
    // Member edits reuse the validated 2–3 member save; answers already collected stay in the record.
    else if(op==='remove')act('members',{members:list.filter(m=>m!==p)});
    else if(op==='add')pickMember('添加成员',q=>act('members',{members:[...list,q]}));
    else if(op==='open')act('open',{provider:p});
    else{const j=jobFor(latest(),p);if(j)jobAction(j,op);}});
  if(!main)document.body.insertBefore($('.send-footer'),$('#dialog'));
}
function currentPreset(){return model?presetView($('#kind').value,model.session,{style:$('#style').value,depth:$('#depth').value,templates:model.templates||{}}):null;}
function renderPreset(){
  const view=currentPreset(),kind=$('#kind').value;$('#preset').hidden=!view;$('#plain-note').textContent=modeNotes[kind]||'';
  $('#prompt-label').classList.toggle('sr-only',!view);$('#prompt-label').textContent=kind==='relay'?'你的问题（第 1 位直接收到）':view?'你的补充（可选，附在预设之后）':'问题或迭代要求';
  if(!view)return;$('#preset-name').textContent=view.name;$('#preset-custom').hidden=!view.custom;
  // Editing one preset while switching to another would save the text under the wrong name.
  if(!$('#preset-editor').hidden&&$('#preset-editor').dataset.key!==view.key)$('#preset-cancel').click();
  const html=view.parts.map(p=>p.slot?`<span class="slot">${esc(p.slot)}</span>`:esc(p.text)).join('');if($('#preset-body')._html!==html){$('#preset-body')._html=html;$('#preset-body').innerHTML=html;}
}
function renderOrder(){
  if(!model)return;const list=relayOrder(model.session,$('#order').value),active=busy(model.session);
  const html=list.map((p,i)=>`${i?'<span class="arrow" aria-hidden="true">→</span>':''}<span class="step"><b>${i+1}</b>${esc(PROVIDERS[p].name)}${i?`<button data-up="${i}" title="提前一位" ${active?'disabled':''}>↑</button>`:''}</span>`).join('');
  if($('#relay-order')._html!==html){$('#relay-order')._html=html;$('#relay-order').innerHTML=html;}
}
function renderMode(){const kind=$('#kind').value;$('#relay-options').hidden=kind!=='relay';if(kind==='relay')renderOrder();for(const b of $$('#kinds [data-kind]'))b.setAttribute('aria-pressed',String(b.dataset.kind===kind));$('#summary-options').hidden=kind!=='summary';$('#style-options').hidden=kind!=='discuss';for(const b of $$('#styles [data-style]'))b.setAttribute('aria-pressed',String(b.dataset.style===$('#style').value));$('#prompt').placeholder=placeholders[kind];renderPreset();const active=busy(model?.session);$('#send').classList.toggle('stop',active);$('#send-label').textContent=active?'停止本轮':starting?'正在发起…':latest()?sendLabels[kind]:'开始圆桌';}
// One member card. Its four escape actions (重新提取 / 重新发送 / 跳过 / 换人) are always on screen: automation
// does the routine work, and these keep a round going when a site misbehaves. Suggestions for the current state
// (open the page, clear a site draft, confirm) sit in front of them.
function memberRow(s,r,p){
  const j=jobFor(r,p),name=PROVIDERS[p].name,bound=s.bindings[p]?.tabId,health=bound&&HEALTH[s.bindings[p]?.health],idle=!j||!ACTIVE.has(j.status)&&j.status!=='waiting';
  const status=j?LABELS[j.status]+(j.text?`，${length(j.text)} 字`:''):(bound?health||'网页已连接':'未连接'),dot=j?j.status:health?'attention':bound?'connected':'idle';
  const since=j&&ACTIVE.has(j.status)?(j.startedAt||r.createdAt):0,quiet=since&&!j.text&&['sent','unconfirmed'].includes(j.status)&&Date.now()-since>90000,blocked=j&&/登录|验证|额度|captcha/i.test(j.error||'');
  const hint=(op,label,ico)=>`<button class="suggest" data-provider="${p}" data-op="${op}">${icon(ico)}<span>${label}</span></button>`;
  let suggest='';if(quiet||health&&idle||blocked)suggest+=hint('open','打开网页','open');if(j?.pageDraft&&!ACTIVE.has(j.status))suggest+=hint('cleardraft','清空网页草稿并重试','clear');if(j?.status==='attention'&&j.text)suggest+=hint('confirm','确认已完成','check');
  const escape=(op,label,title,disabled=false)=>`<button class="escape" data-provider="${p}" data-op="${op}" title="${esc(title)}" ${disabled?'disabled':''}>${icon(op)}<span>${label}</span></button>`;
  const actions=(j?escape('reread','重新提取',j.status==='waiting'?'还没轮到它：可读取网页里最新一条提问的回答（需你确认）':'只读：从网页重新读取本轮回答，不重发')+escape('retry','重新发送',j.status==='waiting'?'还没轮到它：现在就发送，不等前面的成员':'把本轮内容再发给它一次')+escape('skip','跳过',j.status==='skipped'?'本轮已跳过它；可重新提取或重新发送找回':'本轮不再等它，讨论、激发与总结不带它',j.status==='skipped'):'')+escape('replace','换人',canTakeOver(r,p)?'换另一家 AI 立刻接手本轮这个位置':'换另一家 AI，从下一轮起参加');
  const replaced=r?.jobs.findLast(x=>x.provider!==p&&x.replacedBy===p),notes=[j?.error,quiet&&!j.error?`${name} 超过 90 秒还没开始回答，网页可能卡住了（未登录、验证、网络或网页未加载完）。可以打开网页看一眼；回答出现后会自动继续读取。`:'',!j?.error&&s.bindings[p]?.note].filter(Boolean);
  return `<div class="member-row" data-status="${j?.status||'idle'}"><div class="m-line">${avatar(p)}<button class="member-chip ${bound?'connected':''}" data-provider="${p}" data-op="open" title="打开 ${name} 网页">${name}</button>${j?.mode?`<small class="mode" title="发送时网页显示的模型与模式">${esc(j.mode)}</small>`:''}${replaced?`<small class="mode" title="本轮接替的成员">接替 ${esc(PROVIDERS[replaced.provider].name)}</small>`:''}${s.members.length>2?`<button class="remove" data-provider="${p}" data-op="remove" title="从下一轮移出">移出</button>`:''}<span class="state" data-status="${j?.status||(health?'attention':'idle')}"><span class="dot" data-status="${dot}"></span><span>${status}${since?` · <span class="elapsed" data-since="${since}">${elapsed(Date.now()-since)}</span>`:''}${health&&j&&idle&&j.status==='done'?` · ${health}`:''}</span></span></div><div class="recovery">${suggest?`<div class="suggests">${suggest}</div>`:''}<div class="escapes${j?'':' solo'}">${actions}</div></div>${notes.map(n=>`<p class="member-error">${esc(n)}</p>`).join('')}</div>`;
}
function renderController(){
  const s=model.session,r=latest(),active=busy(s),draft=model.draft;
  if(!pendingDrafts){for(const key of ['text','kind','captain','depth','style','order']){const el=$('#'+(key==='text'?'prompt':key));let value=draft[key]??({text:'',kind:'iterate',captain:s.members[0],depth:'简要结论',style:'debate',order:''}[key]);if(key==='kind')value=modeOf(value);if(el.value!==value)el.value=value;}}
  $('#captain').querySelectorAll('option').forEach(o=>o.disabled=!s.members.includes(o.value));if(!s.members.includes($('#captain').value))$('#captain').value=s.members[0];
  $('.base-round').dataset.baseId=r?.id||'';$('#base-time').textContent=r?`基于第 ${s.rounds.length} 轮 · ${fmtTime(r.createdAt)}`:'这是第一轮';
  const signature=JSON.stringify([s.members,s.bindings,r?.jobs.map(j=>[j.provider,j.status,j.error,length(j.text),!!j.baseline,j.phase,j.mode,j.replacedBy,ACTIVE.has(j.status)&&!j.text&&Date.now()-(j.startedAt||r.createdAt)>90000])]);
  if($('#member-strip').dataset.signature!==signature){$('#member-strip').dataset.signature=signature;$('#member-strip').innerHTML=s.members.map(p=>memberRow(s,r,p)).join('')+(s.members.length<MAX_MEMBERS?`<button class="add-member" data-op="add">＋ 添加成员</button>`:'');}
  $('#member-count').textContent=`${s.members.length}/${MAX_MEMBERS}`;for(const b of $$('#member-strip [data-op="remove"],#member-strip .add-member'))b.disabled=active;
  $('#edit-members').disabled=active;$('#connect').disabled=active;$('#connection-hint').hidden=!!r;$('#send').disabled=starting&&!active;for(const b of $$('#kinds [data-kind]'))b.disabled=active;$('#preview').disabled=active;$('#edit-preset').disabled=active;$('#close-roundtable').disabled=active;renderMode();
}
function renderMain(){
  if(document.hidden)return;
  const s=model.session,r=selected();$('#session-title').textContent=s.title;$('#question').textContent=r?.prompt||'一个问题，多种视角。';$('#latest').hidden=!r||r.id===latest()?.id;
  const seats=r?r.jobs.filter(j=>!j.replacedBy):[],done=seats.filter(j=>j.status==='done').length;$('#round-meta').innerHTML=r?`<span class="kind" data-round-kind="${r.kind}">${kinds[r.kind]}${r.style==='collab'?' · 取长补短':''}</span><span>${new Date(r.createdAt).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})} ${fmtTime(r.createdAt)}</span><span>${done===seats.length?`${done} 份完整回答`:`${done}/${seats.length} 份完整回答`}</span>`:'';
  for(const b of $$('#layouts button')){const on=b.dataset.layout===(model.preferences.layout||'a');b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));}
  const q=$('#time-search').value.trim(),rounds=s.rounds.map((r,i)=>({...r,number:i+1})).reverse().filter(r=>roundMatches(r,q));let group='';
  const timeline=rounds.map(r=>{const date=fmtDateGroup(r.createdAt),head=date!==group?`<div class="date-group">${esc(date)}</div>`:'';group=date;return head+`<button class="time-item ${r.id===reader.roundId?'selected':''}" data-round="${r.id}"><span class="l1"><time>${fmtTime(r.createdAt)}</time><span class="kind" data-round-kind="${r.kind}">${kinds[r.kind]}</span><span class="count">${r.jobs.filter(j=>j.status==='done'&&!j.replacedBy).length}/${r.jobs.filter(j=>!j.replacedBy).length}</span></span><span class="l2">${esc(r.prompt)}</span></button>`;}).join('')||`<p class="hint">${q?'没有匹配的提问或回答':'提问后，这里会记录时间。'}</p>`;
  if($('#time-list')._html!==timeline){$('#time-list')._html=timeline;$('#time-list').innerHTML=timeline;}
  const source=s.rounds.find(x=>x.id===(r?.sourceRoundId||(r?.kind==='summary'?s.rounds[s.rounds.indexOf(r)-1]?.id:null)));
  $('#source').hidden=r?.kind!=='summary'||!source;if(!$('#source').hidden)$('#source').innerHTML=`${PROVIDERS[r.jobs[0]?.provider]?.name||'队长'} 的总结，材料来自<button data-source="${source.id}">第 ${s.rounds.indexOf(source)+1} 轮（${fmtTime(source.createdAt)}）</button>`;
  if(r)renderAnswers(r);else if(!$('#empty')){$('#reader').innerHTML='<section id="empty"><h2>先提出你的第一个问题</h2><p>在操作区选择成员并连接网页，完成登录后开始。</p></section>';viewSignature='';}
}
function answerShell(j,layout){const p=PROVIDERS[j.provider],content=`<div class="answer-error" hidden></div><div class="text"></div><div class="answer-actions"><button data-job="${j.id}" data-read="copy">复制全文</button><button data-job="${j.id}" data-read="quote">引用到下一轮</button><button data-job="${j.id}" data-read="open">${icon('open')}打开原网页</button></div>`;
  return layout==='c'?`<details class="answer" data-job="${j.id}" ${reader.expanded.includes(j.id)?'open':''}><summary><span class="dot"></span>${avatar(j.provider)}<strong>${p.name}</strong><span class="preview"></span><span class="answer-status"></span><span class="chevron" aria-hidden="true">›</span></summary><div class="answer-body">${content}</div></details>`:`<article class="answer" data-job="${j.id}"><div class="answer-head">${avatar(j.provider)}<strong>${p.name}</strong><span class="dot"></span>${j.mode?`<small class="mode">${esc(j.mode)}</small>`:''}<span class="answer-status"></span></div><div class="answer-body">${content}</div></article>`;
}
function renderAnswers(r){
  const layout=r.kind==='summary'?'a':model.preferences.layout||'a',shown=p=>jobFor(r,p)||r.jobs.findLast(j=>j.provider===p),providers=[...new Set(r.jobs.map(j=>j.provider))].sort((a,b)=>!!shown(a).replacedBy-!!shown(b).replacedBy);if(!providers.includes(reader.provider))reader.provider=providers[0];
  let pair=reader.pair.filter(p=>providers.includes(p));for(const p of providers)if(pair.length<2&&!pair.includes(p))pair.push(p);if(r.kind!=='summary')reader.pair=pair;
  const jobs=layout==='a'?[shown(reader.provider)]:layout==='b'?pair.map(shown):providers.map(shown),signature=JSON.stringify([r.id,layout,reader.provider,pair,jobs.map(j=>j.id)]);
  if(viewSignature!==signature){viewSignature=signature;const options=chosen=>providers.map(p=>`<option value="${p}" ${p===chosen?'selected':''}>${PROVIDERS[p].name}</option>`).join('');
    const nav=layout==='a'&&r.kind!=='summary'?`<div class="ai-tabs" role="group" aria-label="本轮回答者">${providers.map(p=>`<button data-ai="${p}" aria-pressed="${p===reader.provider}" class="${p===reader.provider?'active':''}">${avatar(p)}${PROVIDERS[p].name}<span class="dot"></span><small></small></button>`).join('')}</div>`:layout==='b'?`<div class="pair-select"><label>左侧 <select id="pair-left">${options(pair[0])}</select></label><label>右侧 <select id="pair-right">${options(pair[1])}</select></label></div>`:'';
    $('#reader').innerHTML=nav+`<div id="answers" class="answers layout-${layout}">${jobs.map(j=>answerShell(j,layout)).join('')}</div>`;
    for(const card of $$('#answers details'))card.addEventListener('toggle',()=>{if(!card.isConnected)return;reader.expanded=card.open?[...new Set([...reader.expanded,card.dataset.job])]:reader.expanded.filter(id=>id!==card.dataset.job);persistReader();updateAnswer(card,selected()?.jobs.find(j=>j.id===card.dataset.job));});
    for(const id of ['pair-left','pair-right'])$('#'+id)?.addEventListener('change',e=>{const i=id==='pair-left'?0:1,other=1-i,previous=reader.pair[i];reader.pair[i]=e.target.value;if(reader.pair[other]===e.target.value)reader.pair[other]=previous;persistReader();renderAnswers(selected());});
  }
  for(const card of $$('#answers .answer'))updateAnswer(card,r.jobs.find(j=>j.id===card.dataset.job));
  for(const tab of $$('.ai-tabs [data-ai]')){const j=shown(tab.dataset.ai);if(!j)continue;tab.querySelector('.dot').dataset.status=j.status;tab.classList.toggle('replaced',!!j.replacedBy);tab.querySelector('small').textContent=j.text&&!j.replacedBy?`${length(j.text)} 字`:statusText(j);}
}
const statusText=j=>(j.text&&j.status==='done'?`${length(j.text)} 字`:LABELS[j.status]+(j.text?`，${length(j.text)} 字`:''))+(j.replacedBy?` · 已换成 ${PROVIDERS[j.replacedBy]?.name||''}`:'');
function updateAnswer(card,j){if(!j)return;card.querySelector('.answer-status').textContent=statusText(j);card.dataset.status=j.status;card.classList.toggle('replaced',!!j.replacedBy);card.querySelector('.dot').dataset.status=j.status;const warning=card.querySelector('.answer-error');warning.hidden=!j.error;warning.textContent=j.error;if(card.querySelector('.preview'))card.querySelector('.preview').textContent=(j.text||j.error||LABELS[j.status]).slice(0,180).replace(/[#*`>]+/g,'').replace(/\s+/g,' ').trim();
  for(const b of card.querySelectorAll('[data-read="copy"],[data-read="quote"]'))b.disabled=!j.text;
  renderEarlier(card,j);if(card.tagName==='DETAILS'&&!card.open)return;const target=card.querySelector('.text'),signature=j.format+'|'+j.text+'|'+j.status;if(textCache.get(target)===signature)return;textCache.set(target,signature);if(!j.text){target.textContent=j.replacedBy?`本轮已换成 ${PROVIDERS[j.replacedBy]?.name||'其他成员'}，这里保留原记录。`:ACTIVE.has(j.status)?'等待这位成员的网页回答…':'尚无完整回答，请在侧栏核对成员状态。';return;}renderMarkdown(target,j.text,j.format);
}
// A resend keeps every earlier complete answer; they stay readable under the current one.
function renderEarlier(card,j){const list=j.earlier||[];let box=card.querySelector('.earlier');if(!list.length){box?.remove();return;}
  // Created only when there is something to show, so a card without earlier answers has a single <summary>.
  if(!box){card.querySelector('.answer-actions').insertAdjacentHTML('beforebegin','<details class="earlier"><summary></summary><div class="earlier-list"></div></details>');box=card.querySelector('.earlier');}box.querySelector('summary').textContent=`之前的回答（${list.length}）· 重新发送前保留`;const sig=list.map(e=>e.at+':'+e.text.length).join();if(box._sig===sig)return;box._sig=sig;const holder=box.querySelector('.earlier-list');holder.innerHTML=list.map((e,i)=>`<div class="earlier-item"><div class="earlier-meta">第 ${i+1} 版 · ${fmtTime(e.at)} · ${length(e.text)} 字</div><div class="text"></div></div>`).join('');[...holder.querySelectorAll('.text')].forEach((t,i)=>renderMarkdown(t,list[i].text,list[i].format));}
function dialog(title,html){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal();}
function close(){$('#dialog').close();}
async function send(){
  if(!model)return;const active=model.session.rounds.find(inProgress);if(active){await act('stop',{roundId:active.id});return;}if(starting)return;
  const text=$('#prompt').value,kind=$('#kind').value;if(['iterate','relay'].includes(kind)&&!text.trim()){error('请先输入问题或迭代要求。');$('#prompt').focus();return;}
  // Light guidance: members whose page is not open yet are opened by sending, but a login is often missing.
  const recipients=kind==='summary'?[$('#captain').value]:model.session.members,unconnected=recipients.filter(p=>!model.session.bindings[p]?.tabId);
  const blocked=recipients.filter(p=>model.session.bindings[p]?.tabId&&HEALTH[model.session.bindings[p]?.health]);
  if(blocked.length&&!unconnected.length&&!send.confirmed){const list=blocked.map(p=>`${PROVIDERS[p].name}（${HEALTH[model.session.bindings[p].health]}）`).join('、');dialog('有成员网页需要处理',`<p>${esc(list)}。可以先打开网页处理，或换人；直接发送时这几位会报错，其他成员照常回答。</p><div class="choices"><button id="guide-fix" class="primary"><strong>先去处理</strong><span>打开第一位的网页，处理完点“连接网页”重新检查</span></button><button id="guide-send"><strong>直接发送</strong><span>其他成员照常回答</span></button></div>`);$('#guide-fix').onclick=()=>{close();act('open',{provider:blocked[0]});};$('#guide-send').onclick=()=>{close();send.confirmed=true;send().finally(()=>{send.confirmed=false;});};return;}
  if(unconnected.length&&!send.confirmed){const names=unconnected.map(p=>PROVIDERS[p].name).join('、');dialog('先连接网页？',`<p>${esc(names)} 还没有连接网页。建议先点“连接网页”打开各家，确认已经登录，再发送。</p><div class="choices"><button id="guide-connect" class="primary"><strong>连接网页</strong><span>打开各家网页，登录后再点发送</span></button><button id="guide-send"><strong>直接发送</strong><span>发送时自动打开网页；未登录的成员会提示你处理</span></button></div>`);$('#guide-connect').onclick=()=>{close();act('connect');};$('#guide-send').onclick=()=>{close();send.confirmed=true;send().finally(()=>{send.confirmed=false;});};return;}
  const options={captain:$('#captain').value,depth:$('#depth').value,style:$('#style').value,order:relayOrder(model.session,$('#order').value)},baseRoundId=latest()?.id||null;starting=true;renderController();try{await draftQueue;await act('start',{kind,text,options,baseRoundId});}catch(e){error(e.message);}finally{starting=false;await refresh();}
}
async function preview(){const kind=$('#kind').value,r=await act('preview',{kind,text:$('#prompt').value,options:{captain:$('#captain').value,depth:$('#depth').value,style:$('#style').value,order:relayOrder(model.session,$('#order').value)}});if(!r)return;dialog('各家将收到的完整材料',`<p>${kind==='relay'?'按顺序依次发送：第 1 位收到下面的问题；之后每位在轮到时收到“问题 + 前面各位的完整回答”（格式见预设）。':'下一轮基于最新记录；回看历史不会替换这些材料。'}</p>${r.prompts.map((p,i)=>`<details class="prompt-preview"><summary>${kind==='relay'?`${i+1}. `:''}${PROVIDERS[p.provider].name}</summary><pre>${esc(p.prompt||'轮到时生成：你的问题 + 前面各位的完整回答。')}</pre></details>`).join('')}`);}
// Single choice among AIs not yet in this roundtable (swap one, or add one while under the limit).
function pickMember(title,onPick,note='已有回答完整保留。新成员会在下一轮发送时打开它的网页，需要先在网页登录。'){const taken=new Set(model.session.members),group=(label,abroad)=>{const items=Object.entries(PROVIDERS).filter(([id,p])=>!!p.abroad===abroad&&!taken.has(id));return items.length?`<fieldset><legend>${label}</legend>${items.map(([id,p])=>`<button data-pick="${id}">${p.name}</button>`).join('')}</fieldset>`:'';};
  dialog(title,`<p>${note}</p><div class="member-options pick">${group('国内',false)}${group('海外（需能访问该网站）',true)}</div>`);
  for(const b of $$('#dialog-body [data-pick]'))b.onclick=()=>{close();onPick(b.dataset.pick);};}
function members(){
  const option=([id,p])=>`<label><input type="checkbox" name="member" value="${id}" ${model.session.members.includes(id)?'checked':''}>${p.name}</label>`,group=(title,abroad)=>`<fieldset><legend>${title}</legend>${Object.entries(PROVIDERS).filter(([,p])=>!!p.abroad===abroad).map(option).join('')}</fieldset>`;
  dialog('选择参与下一轮的成员',`<p>选择 2–${MAX_MEMBERS} 位成员，已有回答完整保留；之后新建的圆桌也沿用这组成员。每家都需要先在自己的网页登录。</p><div class="member-options">${group('国内',false)}${group('海外（需能访问该网站）',true)}</div><p id="member-limit" class="hint" hidden>已选满 ${MAX_MEMBERS} 位，取消一位后可换成其他成员。</p><button class="primary" id="save-members">保存成员</button>`);
  const boxes=$$('input[name="member"]'),limit=()=>{const full=boxes.filter(x=>x.checked).length>=MAX_MEMBERS;for(const x of boxes)x.disabled=full&&!x.checked;$('#member-limit').hidden=!full;};boxes.forEach(x=>x.addEventListener('change',limit));limit();
  $('#save-members').onclick=async()=>{const members=boxes.filter(x=>x.checked).map(x=>x.value);if(members.length<2){error('至少选择两位成员。');return;}close();await act('members',{members});};
}
async function jobAction(j,operation){const args={roundId:latest().id,jobId:j.id,operation};
  // Clearing the site's box needs the user's explicit look at exactly what will be removed.
  if(operation==='cleardraft'){dialog(`清空 ${PROVIDERS[j.provider].name} 输入框里的文字？`,`<p>网页输入框里有下面这段还没发出的文字，可能是你写的，也可能是之前没发出去的提问。确认后只删掉这段，再发送本轮。</p><pre class="draft-preview">${esc(j.pageDraft)}</pre><button id="confirm-clear" class="primary">清空并重试发送</button>`);$('#confirm-clear').onclick=()=>{close();act('job',{...args,operation:'retry',clearDraft:j.pageDraft});};return;}if(operation==='retry'){const name=PROVIDERS[j.provider].name,reached=ACTIVE.has(j.status)||j.status==='done'||!['not_sent','prepared',undefined].includes(j.phase);
    if(reached){const why=ACTIVE.has(j.status)?`${esc(name)} 正在处理本轮。重新发送会先停止它，再把本轮内容发一次。`:j.status==='done'?`${esc(name)} 已有完整回答。重新发送会让它再答一次；当前回答保留为“之前的回答”，在记录页可以查看。`:`${esc(name)} 此前可能已经收到本轮内容。建议先点“重新提取”看看网页里有没有回答。`;
      dialog(`重新发送给 ${name}？`,`<p>${why}网页里会出现两次同样的提问。</p><button id="confirm-retry" class="primary">确认重新发送</button>`);$('#confirm-retry').onclick=()=>{close();act('job',{...args,confirmDuplicate:true}).then(r=>r&&notice(`已重新发送给 ${name}。`));};return;}}
  const result=await act('job',args);
  if(result&&!result.forceable){const name=PROVIDERS[j.provider].name,done={retry:j.status==='waiting'?`已立即发送给 ${name}。`:`已重新发送给 ${name}。`,reread:`正在重新读取 ${name} 的回答。`,skip:`已跳过 ${name}：本轮讨论、激发与总结不带它；需要时点“重新提取”或“重新发送”找回。`,confirm:`已确认 ${name} 的回答完整。`}[operation];if(done)notice(done);}
  // AI-Arena's manual extraction: when the page's latest question cannot be matched to this round
  // (edited or sent by hand on the site), show it and read its answer only after the user confirms.
  if(operation==='reread'&&result?.forceable){const f=result.forceable,name=PROVIDERS[f.provider].name;dialog(`读取 ${name} 网页的最新回答？`,`<p>${j.status==='waiting'?`还没轮到 ${esc(name)}，本轮没有发给它。如果你已在网页里手动提问，可以读取那条提问下的回答。`:`${esc(name)} 网页里最新的提问和本轮原文对不上，常见于你在网页里手动改过或手动发送过。`}</p><p>网页最新提问：${f.question?'“'+esc(f.question)+(f.question.length>=120?'…':'')+'”':'（未读到）'}</p><p>确认后读取这条提问下的回答；若还在生成会等它写完，记录里会注明“未核对提问原文”。</p><button id="force-read" class="primary">读取这条回答</button>`);$('#force-read').onclick=()=>{close();act('job',{...args,force:true});};}
}
async function copy(text){try{await navigator.clipboard.writeText(text);notice('已复制完整内容。');}catch{dialog('选择全文复制',`<textarea class="copy-area" readonly>${esc(text)}</textarea>`);$('.copy-area').select();}}
function download(session=model.session){const url=URL.createObjectURL(new Blob([toMarkdown(session)],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=new Date().toISOString().slice(0,10).replaceAll('-','')+'-AI圆桌-'+session.id.slice(0,8)+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function historyList(){
  const data=await act('state');if(!data)return;const now=Date.now(),open=model.open||{},here=model.session.id;let group='';
  // Roundtables that never got a question are not history, unless a window has one open right now.
  const at=m=>m.activeAt||m.updatedAt,list=model.index.sessions.filter(m=>m.rounds>0||open[m.id]).sort((a,b)=>at(b)-at(a));
  const rows=list.map(m=>{const g=historyGroup(at(m),now),head=g!==group?`<div class="date-group">${g}</div>`:'';group=g;
    const members=(m.members||[]).map(p=>PROVIDERS[p]?.name).filter(Boolean).join('、'),other=open[m.id]&&m.id!==here;
    const badge=m.id===here?'<span class="badge">当前</span>':other?'<span class="badge other">在其他窗口</span>':'';
    const actions=m.id===here?'':other?`<button data-select="${m.id}">切换到该窗口</button>`:`<button data-open-here="${m.id}">本窗口打开</button><button data-select="${m.id}">新窗口</button><button data-delete="${m.id}" class="danger" aria-label="删除 ${esc(m.title)}">删除</button>`;
    const created=m.createdAt?'创建于 '+new Date(m.createdAt).toLocaleString('zh-CN',{hour12:false}):'';
    return head+`<div class="history-row${m.id===here?' current':''}"><div class="h-title"><span>${esc(m.title)}</span>${badge}</div><div class="h-meta"><time title="${created}">${fmtRelative(at(m),now)}</time><span>${m.rounds} 轮</span>${members?`<span>${esc(members)}</span>`:''}<span class="h-actions">${actions}</span></div></div>`;}).join('');
  dialog('历史圆桌',`<p>所有窗口的圆桌都保存在这里。“本窗口打开”会先关闭当前圆桌，再打开当时各家的对话网页；“新窗口”在独立窗口打开。</p><div class="history-list">${rows||'<p class="hint">还没有提问过的圆桌。</p>'}</div>`);
}
function newRoundtable(){
  const active=busy(model.session),names=model.session.members.map(p=>PROVIDERS[p].name).join('、');
  dialog('新建圆桌',`<p>新圆桌沿用当前成员（${esc(names)}），并自动打开各家网页。</p><div class="choices"><button data-new="here" ${active?'disabled':''}><strong>在本窗口新建</strong><span>先关闭当前圆桌和它的 AI 网页，记录保留在历史</span></button><button data-new="window"><strong>在新窗口新建</strong><span>当前圆桌原样保留，两场各自独立</span></button></div>${active?'<p class="hint">本轮还在进行，只能在新窗口新建。</p>':''}`);
}
function closeRoundtable(){
  const s=model.session;if(busy(s)){error('本轮还在进行，请先停止再关闭这场圆桌。');return;}
  const tabs=s.members.filter(p=>s.bindings[p]?.tabId).map(p=>PROVIDERS[p].name);
  dialog('关闭这场圆桌？',`<p>${tabs.length?`会关闭 ${esc(tabs.join('、'))} 的网页标签页。`:''}${s.rounds.length?'问答记录保留在“历史”里，之后可以找回并回到当时各家的对话。':'这场圆桌还没有提问，关闭后不留记录。'}</p><button id="close-confirm" class="primary">关闭圆桌</button>`);
  $('#close-confirm').onclick=async()=>{close();if(await act('close-here'))notice(s.rounds.length?'已关闭，记录在“历史”里。':'已关闭。');};
}
$('#dialog-close').addEventListener('click',close);
$('#dialog-body').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.dataset.new){close();const r=await act(b.dataset.new==='here'?'new-here':'new');if(r&&b.dataset.new==='here')notice('已新建，正在打开各家网页。');}else if(b.dataset.select){close();act('select',{sessionId:b.dataset.select});}else if(b.dataset.openHere){close();if(await act('open-here',{sessionId:b.dataset.openHere}))notice('已找回，正在打开当时的对话网页。');}else if(b.dataset.delete){const sessionId=b.dataset.delete;dialog('删除这场圆桌？','<p>请先导出需要保留的记录。删除只影响扩展历史，原网页对话不受影响。</p><button id="delete-confirm">确认删除记录</button>');$('#delete-confirm').onclick=async()=>{close();await act('delete',{sessionId,confirm:true});};}});
initController();
if(main){
  $('#layouts').addEventListener('click',e=>{const b=e.target.closest('[data-layout]');if(b)act('preferences',{layout:b.dataset.layout});});$('#time-search').addEventListener('input',()=>{if(model)renderMain();});
  $('#time-list').addEventListener('click',e=>{const b=e.target.closest('[data-round]');if(b){reader.roundId=b.dataset.round;persistReader();renderMain();$('#reader').scrollTop=0;}});$('#latest').onclick=()=>{reader.roundId=latest()?.id;persistReader();renderMain();};$('#source').onclick=e=>{const b=e.target.closest('[data-source]');if(b){reader.roundId=b.dataset.source;persistReader();renderMain();}};
  $('#reader').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.ai){reader.provider=b.dataset.ai;persistReader();renderMain();return;}const r=selected(),j=r?.jobs.find(j=>j.id===b.dataset.job);if(!j)return;if(b.dataset.read==='copy')copy(j.text);else if(b.dataset.read==='open')act('open-answer',{roundId:r.id,jobId:j.id});else if(b.dataset.read==='quote'){try{await draftQueue;if(await act('quote',{roundId:r.id,jobId:j.id}))notice('已将完整原文引用到下一轮草稿。');}catch(e){error(e.message);}}});
  $('#export').onclick=()=>download();$('#open-sidepanel').onclick=()=>chrome.sidePanel.open({windowId}).catch(e=>error('侧栏打开失败：'+e.message));
}else $('#open-main').onclick=()=>act('main');
$('#new').onclick=newRoundtable;$('#history').onclick=historyList;$('#close-roundtable').onclick=closeRoundtable;
$('#update').onclick=async()=>{if($('#update').dataset.kind==='online'){openUpdates();return;}const r=await act('update');if(r?.reloading)notice('正在更新，稍后会自动重新打开圆桌记录。');};
initUpdates({dialog,act,busy:()=>busy(model?.session),changed:()=>{if(model)renderUpdate();}});
async function panelVisibility(){if(!main)return;const data=await chrome.storage.session.get('arena.panel.'+windowId),open=!!data['arena.panel.'+windowId];$('#dock').hidden=open;$('#panel-active').hidden=!open;if(!open&&model)scheduleRefresh();}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes['arena.panel.'+windowId])panelVisibility().catch(e=>error(e.message));if(area!=='local')return;const draft=changes['arena.draft.'+model?.session.id]?.newValue;if(draft&&model){const known=confirmedDrafts.get(model.session.id);if(!known||(draft.revision||0)>=(known.revision||0)){confirmedDrafts.set(model.session.id,draft);if(!pendingDrafts){model.draft=draft;renderController();}}}if(Object.keys(changes).some(k=>k==='arena.preferences'||k==='arena.index'||k==='arena.session.'+model?.session.id))scheduleRefresh();});
function connectPanel(){port=chrome.runtime.connect({name:'arena-panel:'+windowId});port.postMessage({visible:!document.hidden});port.onDisconnect.addListener(()=>{setTimeout(()=>{try{connectPanel();scheduleRefresh();}catch(e){error('侧栏重新连接失败：'+e.message);}},300);});}
document.addEventListener('visibilitychange',()=>{if(!main&&port){try{port.postMessage({visible:!document.hidden});}catch(e){error('侧栏状态同步失败：'+e.message);}}else if(main&&!document.hidden)scheduleRefresh();});
async function init(){windowId=(await chrome.windows.getCurrent()).id;if(!main)connectPanel();await panelVisibility();await refresh();}
init().catch(e=>error(e.message));
// Elapsed time on answering members ticks every second without re-rendering the rows.
setInterval(()=>{for(const el of $$('.elapsed[data-since]')){const ms=Date.now()-Number(el.dataset.since);el.textContent=elapsed(ms);if(ms>90000&&ms<91500&&model)renderController();}},1000);
