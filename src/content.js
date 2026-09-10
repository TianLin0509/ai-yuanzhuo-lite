(() => {
  'use strict';
  if(globalThis.__yuanzhuoLite) return;
  const jobs=new Map();
  const diagnostics={observers:0,timers:0,reads:0,lastError:'',activeRequest:null};
  const cleanUrl=()=>location.origin+location.pathname;
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const visible=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
  const available=el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true';
  // innerText inserts extra blank lines between <p> nodes in rich editors.
  function editableText(node){
    if(node.nodeType===Node.TEXT_NODE)return node.textContent;
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    if(node.tagName==='BR')return '\n';
    const children=[...node.childNodes];let text='';
    for(let i=0;i<children.length;i++){const child=children[i],block=child.nodeType===Node.ELEMENT_NODE&&['P','DIV'].includes(child.tagName);if(i&&block)text+='\n';text+=block&&child.childNodes.length===1&&child.firstChild.nodeName==='BR'?'':editableText(child);}
    return text;
  }
  const value=el=>el?.tagName==='TEXTAREA'?el.value:el?editableText(el):'';
  const normalized=s=>String(s).replace(/\r\n/g,'\n').replace(/\u00a0/g,' ').trim();
  function find(selectors,root=document){for(const selector of selectors){const found=[...root.querySelectorAll(selector)].find(visible);if(found)return found;}return null;}
  function answers(config){for(const selector of config.answer){const found=[...document.querySelectorAll(selector)].filter(el=>visible(el)&&normalized(el.textContent));if(found.length)return found;}return [];}
  function users(config){for(const selector of config.user){const found=[...document.querySelectorAll(selector)].filter(visible);if(found.length)return found;}return [];}
  const bodyNodes=(element,config)=>!element?[]:config.body&&!element.matches('[data-role="assistant"]')?[...element.querySelectorAll(config.body)]:[element];
  const answerText=(element,config)=>bodyNodes(element,config).map(node=>node.textContent).join('\n\n');
  function answerMarkdown(element,config){
    const lines=bodyNodes(element,config).map(markdown).join('\n\n').split('\n'),output=[];let fence=null,blank=false;
    for(const line of lines){const marker=line.match(/^\s*(`{3,}|~{3,})/);if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length)fence=null;}
      if(!fence&&!line.trim()){if(!blank)output.push('');blank=true;}else{output.push(line);blank=false;}}
    return output.join('\n').trim();
  }
  function hash(text){let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return (h>>>0).toString(36)+':'+text.length;}
  function userText(node,config){if(!node)return '';const copy=(config.userBody&&node.querySelector(config.userBody)||node).cloneNode(true);copy.querySelectorAll('button,[role="button"],svg,.icon-button,.kimi-tooltip').forEach(el=>el.remove());
    // Rendered Markdown lists keep their numbers in CSS counters, not textContent.
    // Reconstruct those numbers in the clone; never drop digits from the prompt.
    for(const list of copy.querySelectorAll('ol')){const items=[...list.children].filter(n=>n.tagName==='LI'),step=list.reversed?-1:1;let number=list.hasAttribute('start')?list.start:list.reversed?items.length:1;for(const item of items){if(item.hasAttribute('value'))number=item.value;item.prepend(document.createTextNode(number+'. '));number+=step;}}
    return normalized(value(copy));}
  const promptLetters=text=>String(text).replace(/[\s\p{P}\p{Z}]/gu,'');
  function ownsUser(job,nodes){
    const last=nodes.at(-1);if(!last)return false;
    const text=userText(last,job.config),key=job.config.userKeyAttribute?last.getAttribute(job.config.userKeyAttribute):null;
    const messageId=job.config.userIdAttribute?last.querySelector('['+job.config.userIdAttribute+']')?.getAttribute(job.config.userIdAttribute):null;
    if(job.anchor){const same=(job.anchor.key?key===job.anchor.key||job.anchor.messageId&&messageId===job.anchor.messageId:nodes.length===job.anchor.userCount)&&hash(text)===job.anchor.textHash;if(same&&messageId)job.anchor.messageId=messageId;return !!same;}
    // Virtual lists may remove older rows; stable site message IDs take precedence over row counts.
    if((key?key===job.baseline.userKey:nodes.length!==job.baseline.userCount+1)||!job.prompt||!promptLetters(text).includes(promptLetters(job.prompt)))return false;
    job.anchor={userCount:nodes.length,textHash:hash(text),key,messageId};return true;
  }
  function markdown(node){
    if(node.nodeType===Node.TEXT_NODE)return node.textContent;
    if(node.nodeType!==Node.ELEMENT_NODE)return '';
    const tag=node.tagName;
    if(['SCRIPT','STYLE','BUTTON','SVG','NOSCRIPT'].includes(tag)||node.getAttribute('role')==='button'||node.getAttribute('aria-hidden')==='true'||node.matches('.segment-code-header,.icon-button,.kimi-tooltip'))return '';
    if(tag==='PRE'||node.matches('.md-code-block,.custom-code-block-container')){const code=node.querySelector('pre code,code,pre')||node;const language=(code.className||'').match(/language-([\w-]+)/)?.[1]||node.querySelector('.md-code-block-banner span')?.textContent?.trim()||'';const body=code.textContent;const fence='`'.repeat(Math.max(3,...(body.match(/`+/g)||[]).map(s=>s.length+1)));return '\n\n'+fence+language+'\n'+body+'\n'+fence+'\n\n';}
    if(tag==='BR')return '\n';
    if(tag==='IMG')return node.getAttribute('alt')?'['+node.getAttribute('alt')+']':'';
    const text=[...node.childNodes].map(markdown).join('');
    if(/^H[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+text.trim()+'\n\n';
    if(tag==='CODE')return '`'+text+'`';
    if(tag==='STRONG'||tag==='B')return '**'+text+'**';
    if(tag==='EM'||tag==='I')return '*'+text+'*';
    if(tag==='LI')return '\n'+(node.parentElement?.tagName==='OL'?[...node.parentElement.children].indexOf(node)+1+'. ':'- ')+text.trim()+'\n';
    if(tag==='BLOCKQUOTE')return '\n\n'+text.trim().split('\n').map(line=>'> '+line).join('\n')+'\n\n';
    if(tag==='A'){const href=node.getAttribute('href')||'';return /^https?:\/\//i.test(href)?'['+text+']('+href.replaceAll(')','%29')+')':text;}
    if(tag==='TR')return '\n| '+[...node.children].map(cell=>markdown(cell).trim().replaceAll('|','\\|')).join(' | ')+' |'+(node.parentElement?.tagName==='THEAD'?'\n| '+[...node.children].map(()=>'---').join(' | ')+' |':'');
    return ['P','DIV','SECTION','ARTICLE','UL','OL','TABLE'].includes(tag)?'\n'+text+'\n':text;
  }
  function snapshot(config){const nodes=answers(config),last=nodes.at(-1),userNodes=users(config);return {count:nodes.length,lastHash:hash(answerText(last,config)),userCount:userNodes.length,userKey:config.userKeyAttribute?userNodes.at(-1)?.getAttribute(config.userKeyAttribute):null,url:cleanUrl()};}
  function cleanup(job){if(job.observer){job.observer.disconnect();job.observer=null;diagnostics.observers--;}if(job.timer){clearTimeout(job.timer);job.timer=null;diagnostics.timers--;}if(job.flushTimer){clearTimeout(job.flushTimer);job.flushTimer=null;diagnostics.timers--;}if(diagnostics.activeRequest===job.requestId)diagnostics.activeRequest=null;}
  function retire(job){cleanup(job);job.cancelled=true;job.lastElement=null;job.userAnchor=null;job.lastText='';delete job.prompt;jobs.set(job.requestId,{requestId:job.requestId,status:job.status,sequence:job.sequence,cancelled:true});for(const [key,value] of jobs){if(jobs.size<=32)break;if(value.cancelled)jobs.delete(key);}}
  function emit(job,status,text=job.lastText,error='',extra={}){
    if(job.cancelled)return;
    job.sequence++;job.status=status;
    const message={type:'YZ_EVENT',requestId:job.requestId,sequence:job.sequence,status,text,error,url:job.expectedUrl,anchor:job.anchor,phase:job.dispatched?'attempted':'not_sent',...extra};
    chrome.runtime.sendMessage(message).then(result=>{if(result?.ok===false){diagnostics.lastError=result.error;retire(job);console.warn('[AI圆桌lite] 状态保存失败：',result.error);}}).catch(error=>{diagnostics.lastError=error.message;retire(job);console.warn('[AI圆桌lite] 扩展连接中断：',error.message);});
  }
  function schedule(job,ms=3000){if(job.cancelled||job.timer)return;diagnostics.timers++;job.timer=setTimeout(()=>{diagnostics.timers--;job.timer=null;inspect(job);schedule(job);},ms);}
  function changed(job){job.dirty=true;if(job.cancelled||job.flushTimer)return;diagnostics.timers++;job.flushTimer=setTimeout(()=>{diagnostics.timers--;job.flushTimer=null;inspect(job);},900);}
  function completionMarker(config,element){let root=element;for(let depth=0;root&&depth<4;depth++,root=root.parentElement){if(depth&&config.answer.some(selector=>root.querySelectorAll(selector).length>1))break;if(find(config.complete,root))return true;}return false;}
  const followsUser=(element,user)=>!!element?.isConnected&&!!user?.isConnected&&!user.contains(element)&&!!(user.compareDocumentPosition(element)&Node.DOCUMENT_POSITION_FOLLOWING);
  function inspect(job,force=false){
    if(job.cancelled||!job.dispatched)return;
    if(job.config.blocked&&find(job.config.blocked)){emit(job,'attention',job.lastText,'网页要求人机验证。请在原网页完成后重新提取；不会自动重发。');retire(job);return;}
    const userNodes=users(job.config),hadAnchor=!!job.anchor,owns=ownsUser(job,userNodes);
    // Revalidate on every read, including after a SPA changes URL before replacing DOM.
    if(hadAnchor&&!owns){emit(job,'attention',job.lastText,'网页中的提问已变化，已停止读取，防止混入其他回答。');retire(job);return;}
    if(!job.sending&&cleanUrl()!==job.expectedUrl){
      if(owns&&job.navigationOpen&&Date.now()-job.startedAt<60000&&job.config.conversation.test(location.pathname)){job.expectedUrl=cleanUrl();}
      else if(hadAnchor||job.boundConversation){emit(job,'attention',job.lastText,'网页已切换到其他对话，已停止读取，防止混入别的回答。');retire(job);return;}
    }
    const busy=!!find(job.config.stop)||!!(job.config.busy&&find(job.config.busy));job.sawBusy ||= busy;
    if(Date.now()-job.startedAt>10*60*1000){emit(job,'attention',job.lastText,'等待超过 10 分钟，已停止自动读取。可打开网页查看，再重新提取。');retire(job);return;}
    if(!owns){if(Date.now()-job.startedAt>45000){emit(job,'attention',job.lastText,'无法确认网页中本轮提问的位置，请打开原网页核对；不会自动重发。');retire(job);}return;}
    const currentInput=find(job.config.input);
    if(!job.acknowledged&&job.dispatched&&currentInput&&!normalized(value(currentInput))&&(busy||users(job.config).length>job.baseline.userCount)){job.acknowledged=true;emit(job,'sent');}
    // Virtualized nodes can disappear between reads. Keep the partial text, but
    // never complete from a detached or relocated cached answer.
    if(job.lastElement&&!followsUser(job.lastElement,userNodes.at(-1))){job.lastElement=null;job.dirty=true;}
    if(job.lastElement&&job.lastText&&!busy&&Date.now()-job.changedAt>45000&&!completionMarker(job.config,job.lastElement)&&!job.sawBusy){emit(job,'attention',answerMarkdown(job.lastElement,job.config),'已读到回答，但网页没有可靠的结束信号。请核对全文后确认完成，或重新提取。',{format:'markdown'});retire(job);return;}
    if(!job.dirty&&!force){if(job.lastElement&&job.lastText&&!busy&&Date.now()-job.changedAt>=2200&&(job.sawBusy||completionMarker(job.config,job.lastElement)))finish(job);return;}
    job.dirty=false;diagnostics.reads++;
    const nodes=answers(job.config),candidate=nodes.at(-1);if(!candidate)return;
    // A virtual list may remount older answers and change counts/hashes. Only
    // an answer after this request's user message can belong to this request.
    if(!followsUser(candidate,userNodes.at(-1)))return;
    const raw=answerText(candidate,job.config),currentHash=hash(raw);
    const isNew=nodes.length>job.baseline.count||currentHash!==job.baseline.lastHash;
    if(!isNew)return;
    if(job.config.unsupported&&find(job.config.unsupported,candidate)){emit(job,'attention',answerMarkdown(candidate,job.config)||job.lastText,'网页生成了文档卡片，文档内容尚未提取完整。请打开原网页查看，或在新一轮要求 AI 直接在聊天正文输出。',{format:'markdown'});retire(job);return;}
    if(!normalized(raw))return;
    job.lastElement=candidate;
    if(currentHash!==job.lastHash){job.lastHash=currentHash;job.lastText=raw.trim();job.changedAt=Date.now();job.acknowledged=true;emit(job,'streaming');}
    if(!busy&&Date.now()-job.changedAt>=2200&&(job.sawBusy||completionMarker(job.config,candidate)))finish(job);
    else if(!busy&&Date.now()-job.changedAt>45000){emit(job,'attention',answerMarkdown(candidate,job.config),'已读到回答，但网页没有可靠的结束信号。请核对全文后确认完成，或重新提取。',{format:'markdown'});retire(job);}
  }
  function finish(job){if(!followsUser(job.lastElement,users(job.config).at(-1))){job.lastElement=null;job.dirty=true;return;}const text=answerMarkdown(job.lastElement,job.config);if(!text){emit(job,'attention',job.lastText,'网页答案为空，未标记完成。');}else emit(job,'done',text,'',{format:'markdown'});retire(job);}
  function watch(job){
    for(const other of jobs.values())if(other!==job&&!other.cancelled)retire(other);
    const root=find(job.config.root)||document.body;
    job.observer=new MutationObserver(()=>changed(job));job.observer.observe(root,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','aria-disabled','aria-label','class']});diagnostics.observers++;diagnostics.activeRequest=job.requestId;job.dirty=true;schedule(job,1000);
  }
  function assertNoAttachments(config){if(config.draftAttachment&&find(config.draftAttachment))throw new Error('该网页有尚未发送的附件，请先处理原网页附件草稿；未发送本轮提问。');}
  async function fill(input,text,config,isCancelled){
    input.focus();
    if(input.tagName==='TEXTAREA'){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,text);input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));input.dispatchEvent(new Event('change',{bubbles:true}));}
    else{
      const selection=getSelection(),range=document.createRange();range.selectNodeContents(input);selection.removeAllRanges();selection.addRange(range);
      // Let Lexical / ProseMirror perform their own complete multiline paste.
      // Do not dispatch a second insertText event: Lexical may insert it twice.
      // Kimi Lexical converts one long clipboard payload into a TXT file.
      // Insert bounded Unicode-safe chunks into ONE editor, verify the entire
      // assembled prompt below, and click Send only once after all chunks finish.
      const chunked=config.chunkedPaste&&input.matches(config.chunkedPaste),chars=chunked?Array.from(text):null,chunks=chunked?Array.from({length:Math.ceil(chars.length/1000)},(_,i)=>chars.slice(i*1000,(i+1)*1000).join('')):[text];
      for(const chunk of chunks){
        if(isCancelled())return;
        const clipboardData=new DataTransfer();clipboardData.setData('text/plain',chunk);
        if(input.matches('.ProseMirror'))clipboardData.setData('text/html',chunk.split('\n').map(line=>'<p style="white-space: pre-wrap">'+(line?line.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'):'<br>')+'</p>').join(''));
        const paste=new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true});input.dispatchEvent(paste);await sleep(50);if(isCancelled())return;
        assertNoAttachments(config);
        if(!paste.defaultPrevented&&!value(input)){const inserted=document.execCommand('insertText',false,chunk);if(!inserted)throw new Error('该网页未接受文字输入，请打开原网页检查。');}
      }
    }
    await sleep(120);
    if(normalized(value(input))!==normalized(text))throw new Error('网页输入内容与原文不一致，已取消发送，请检查原网页。');
  }
  function prepare(message){
    const config=globalThis.YuanzhuoAdapters[message.provider];if(!config)throw new Error('不支持该网页。');
    if(config.blocked&&find(config.blocked))throw new Error('网页要求人机验证，请先在原网页完成验证。');
    assertNoAttachments(config);
    const input=find(config.input);if(!input)throw new Error('未找到可用输入框。请先打开网页完成登录或验证。');
    if(normalized(value(input)))throw new Error('该网页有尚未发送的内容。请先处理原网页草稿，再重试。');
    if(find(config.stop)||(config.busy&&find(config.busy)))throw new Error('该网页仍在生成其他回答，请等待结束。');
    return {baseline:snapshot(config),url:cleanUrl()};
  }
  async function send(message){
    if(jobs.has(message.requestId))return {status:jobs.get(message.requestId).status,duplicate:true};
    const config=globalThis.YuanzhuoAdapters[message.provider];if(!config)throw new Error('不支持该网页。');
    assertNoAttachments(config);
    const input=find(config.input);if(!input)throw new Error('输入框已消失，请检查登录状态。');
    if(normalized(value(input)))throw new Error('发送前发现网页已有草稿，未覆盖或发送。');
    if(cleanUrl()!==message.baseline.url)throw new Error('发送前网页对话已变化，已取消发送。');
    const job={...message,config,sequence:0,startedAt:Date.now(),changedAt:Date.now(),lastText:'',lastHash:'',expectedUrl:cleanUrl(),boundConversation:config.conversation.test(location.pathname),cancelled:false,dispatched:false,sawBusy:false,acknowledged:false,sending:true,status:'sending'};
    job.navigationOpen=!job.boundConversation||/\/chat\/local[_-]/.test(location.pathname);
    jobs.set(job.requestId,job);
    try{
      await fill(input,message.prompt,config,()=>job.cancelled);if(job.cancelled)return {status:'stopped'};assertNoAttachments(config);
      let button=find(config.send);
      for(let i=0;i<8&&!available(button);i++){await sleep(160);if(job.cancelled)return {status:'stopped'};button=find(config.send);}
      if(!available(button)){retire(job);throw new Error('未找到可用发送按钮，文字保留在网页中，未自动按回车或重试。');}
      // Nothing may yield between final ownership/integrity checks and the click.
      assertNoAttachments(config);
      if(!input.isConnected||find(config.input)!==input)throw new Error('发送前网页输入框已变化，已取消发送，请检查原网页。');
      if(cleanUrl()!==message.baseline.url)throw new Error('发送前网页对话已变化，已取消发送。');
      if(normalized(value(input))!==normalized(message.prompt))throw new Error('发送前网页输入内容已变化，已取消发送，请检查原网页。');
      job.dispatched=true;watch(job);button.click();job.sending=false;
      emit(job,'unconfirmed','', '已点击发送，正在核对网页响应；不要重复发送。');
      await sleep(450);inspect(job,true);
      return {status:job.status,phase:'attempted'};
    }catch(error){retire(job);throw error;}
  }
  function reread(message){
    if(jobs.has(message.requestId))return {status:jobs.get(message.requestId).status,duplicate:true};
    const config=globalThis.YuanzhuoAdapters[message.provider];
    if(!config||!message.baseline)throw new Error('缺少本轮回答锚点，无法安全重新提取。');
    if(message.url&&cleanUrl()!==message.url){
      const before=new URL(message.url),finalizing=message.provider==='doubao'&&/^block_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(message.anchor?.key||'')&&message.anchor?.textHash&&before.origin===location.origin&&/^\/chat\/local[_-][^/]+\/?$/.test(before.pathname)&&/^\/chat\/\d+\/?$/.test(location.pathname);
      if(config.conversation.test(before.pathname)&&!finalizing)throw new Error('原网页已切换对话，请先回到本轮原网页。');
    }
    const job={...message,config,sequence:0,startedAt:Date.now(),changedAt:Date.now(),lastText:'',lastHash:'',expectedUrl:cleanUrl(),boundConversation:config.conversation.test(location.pathname),cancelled:false,dispatched:true,sawBusy:false,acknowledged:true,sending:false,status:'sent'};
    if(!ownsUser(job,users(config)))throw new Error('网页最新提问不属于本轮，无法安全重新提取。请保留原回答并在圆桌中新开一轮。');
    jobs.set(job.requestId,job);watch(job);inspect(job,true);return {status:job.status};
  }
  function stop(message){const job=jobs.get(message.requestId);if(job&&!job.cancelled){const button=message.stopGeneration?find(job.config.stop):null;job.status='stopped';retire(job);if(available(button)){button.click();return {stopped:true,pageStopped:true};}}else if(!job){retire({requestId:message.requestId,status:'stopped',sequence:0});}return {stopped:true,pageStopped:false};}
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id||!message.type?.startsWith('YZ_'))return false;
    (async()=>{switch(message.type){case 'YZ_PING':return {ready:true,diagnostics};case 'YZ_PREPARE':return prepare(message);case 'YZ_SEND':return send(message);case 'YZ_REREAD':return reread(message);case 'YZ_STOP':return stop(message);case 'YZ_STATUS':{const job=jobs.get(message.requestId);return {known:!!job,status:job?.status,active:!!job&&!job.cancelled,sequence:job?.sequence||0};}default:throw new Error('未知网页操作。');}})().then(result=>respond({ok:true,...result}),error=>respond({ok:false,error:error.message}));return true;
  });
  addEventListener('pagehide',()=>{for(const job of jobs.values()){cleanup(job);job.cancelled=true;}});
  globalThis.__yuanzhuoLite={diagnostics};
})();
