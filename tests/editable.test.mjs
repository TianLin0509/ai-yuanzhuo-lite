import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../scripts/browser-config.mjs';

test('Rich editors receive one complete paste with blank lines and code indentation',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  for(const editor of ['paragraphs','lexical']){
   const page=await browser.newPage();
   await page.setContent('<main><div contenteditable="true" role="textbox"></div><button data-testid="send-button">Send</button></main>');
   await page.evaluate(editor=>{
    const input=document.querySelector('[contenteditable]');window.sent=[];
    if(editor==='paragraphs')input.classList.add('ProseMirror');
    const read=()=>[...input.children].map(p=>p.textContent).join('\n');
    input.addEventListener('paste',event=>{event.preventDefault();const html=event.clipboardData.getData('text/html');if(editor==='paragraphs'&&html){input.innerHTML=html;return;}input.replaceChildren(...event.clipboardData.getData('text/plain').split(editor==='paragraphs'?/\n+/:/\n/).map(line=>{const p=document.createElement('p');if(line)p.textContent=line;else p.append(document.createElement('br'));return p;}));});
    // Lexical can interpret a synthetic insertText InputEvent as another edit.
    input.addEventListener('input',event=>{if(editor==='lexical'&&!event.isTrusted&&event.data)input.append(document.createTextNode(event.data));});
    document.querySelector('button').onclick=()=>{window.sent.push(read());input.replaceChildren();};
    window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async()=>({ok:true})}};
    window.request=(message)=>new Promise(resolve=>window.listener(message,{id:'test'},resolve));
   },editor);
   await page.addScriptTag({content:fs.readFileSync(new URL('../src/adapters.js',import.meta.url),'utf8')});
   await page.addScriptTag({content:fs.readFileSync(new URL('../src/content.js',import.meta.url),'utf8')});
   const prep=await page.evaluate(()=>request({type:'YZ_PREPARE',provider:'kimi'}));assert.equal(prep.ok,true);
   const prompt='first line\n\n— second item\n  const value = "<x>";\n    third line';
   const response=await page.evaluate(({prompt,baseline})=>request({type:'YZ_SEND',provider:'kimi',requestId:'editor-test',prompt,baseline}),{prompt,baseline:prep.baseline});
   assert.equal(response.ok,true,editor+': '+response.error);
   assert.deepEqual(await page.evaluate(()=>sent),[prompt]);
   await page.evaluate(()=>request({type:'YZ_STOP',requestId:'editor-test'}));
   const diagnostic=await page.evaluate(()=>__yuanzhuoLite.diagnostics);assert.equal(diagnostic.observers,0);assert.equal(diagnostic.timers,0);
   // STOP may arrive before SEND/REREAD when a debugger connection is cancelled.
   await page.evaluate(()=>request({type:'YZ_STOP',requestId:'cancel-before-arrival'}));
   for(const type of ['YZ_SEND','YZ_REREAD']){const cancelled=await page.evaluate(({type,baseline})=>request({type,provider:'kimi',requestId:'cancel-before-arrival',prompt:'must never arrive',baseline}),{type,baseline:prep.baseline});assert.equal(cancelled.ok,true);assert.equal(cancelled.status,'stopped');}
   assert.deepEqual(await page.evaluate(()=>sent),[prompt]);assert.equal((await page.evaluate(()=>__yuanzhuoLite.diagnostics)).observers,0);
   await page.close();
  }
 }finally{await browser.close();}
});

test('Initial route finalization preserves the live user anchor and reads only final Kimi answer',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();
  await page.route('https://www.kimi.com/**',route=>route.fulfill({contentType:'text/html',body:'<main><div id="messages"></div><textarea></textarea><button data-testid="send-button">Send</button><div class="send-button-container" hidden></div></main>'}));
  await page.goto('https://www.kimi.com/');
  await page.evaluate(()=>{
   window.events=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async e=>{events.push(e);return {ok:true};}}};
   window.request=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));
   document.querySelector('button').onclick=()=>{
    const input=document.querySelector('textarea'),user=document.createElement('div');user.className='segment-user';const body=document.createElement('span');body.className='user-content__text';body.textContent=input.value;user.append(body);document.querySelector('#messages').append(user);input.value='';
    const answer=document.createElement('div');answer.className='segment-assistant';answer.innerHTML='<div class="markdown-container toolcall-content-text"><div class="markdown">THINK_ONLY</div></div>';document.querySelector('#messages').append(answer);
    const stop=document.querySelector('.send-button-container');stop.hidden=false;stop.classList.add('stop');
    history.replaceState({},'', '/chat/p4204afc-provisional');
    setTimeout(()=>history.replaceState({},'', '/chat/final-server-id'),1350);
    setTimeout(()=>user.insertAdjacentHTML('beforeend','<div class="segment-user-action-row">Edit Copy Share</div>'),1800);
    setTimeout(()=>{answer.insertAdjacentHTML('beforeend','<div class="markdown-container"><div class="markdown"><p>FINAL_ONLY</p><pre><code class="language-js">const lite = 1;</code></pre></div></div><div class="segment-assistant-actions"><div class="icon-button">Copy</div></div>');stop.classList.remove('stop');stop.hidden=true;},2000);
   };
  });
  for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
  const prep=await page.evaluate(()=>request({type:'YZ_PREPARE',provider:'kimi'}));
  const sent=await page.evaluate(baseline=>request({type:'YZ_SEND',provider:'kimi',requestId:'route-test',prompt:'one\ntwo',baseline}),prep.baseline);assert.equal(sent.ok,true,sent.error);
  try{await page.waitForFunction(()=>events.some(e=>e.status==='done'),{},{timeout:10000});}catch(error){throw new Error(error.message+' '+JSON.stringify(await page.evaluate(()=>events)));}
  const events=await page.evaluate(()=>window.events);assert(!events.some(e=>e.status==='attention'));assert(!events.some(e=>e.text?.includes('THINK_ONLY')));
  const result=events.find(e=>e.status==='done');assert(result.text.includes('FINAL_ONLY'));assert(result.text.includes('```js\nconst lite = 1;'));assert.equal(result.url,'https://www.kimi.com/chat/final-server-id');
  const reread=await page.evaluate(({baseline,anchor})=>request({type:'YZ_REREAD',provider:'kimi',requestId:'own-reread',prompt:'one\ntwo',baseline,anchor}),{baseline:prep.baseline,anchor:result.anchor});assert.equal(reread.ok,true);
  await page.waitForFunction(()=>events.some(e=>e.requestId==='own-reread'&&e.status==='done'),{},{timeout:8000});
  await page.evaluate(()=>document.querySelector('#messages').insertAdjacentHTML('beforeend','<div class="segment-user">manual question</div><div class="segment-assistant"><div class="markdown-container"><div class="markdown">MANUAL_ANSWER</div></div></div>'));
  const rejected=await page.evaluate(({baseline,anchor})=>request({type:'YZ_REREAD',provider:'kimi',requestId:'manual-reread',prompt:'one\ntwo',baseline,anchor}),{baseline:prep.baseline,anchor:result.anchor});assert.equal(rejected.ok,false);assert(rejected.error.includes('不属于本轮'));
  const d=await page.evaluate(()=>__yuanzhuoLite.diagnostics);assert.equal(d.observers,0);assert.equal(d.timers,0);
  const next=await page.evaluate(()=>request({type:'YZ_PREPARE',provider:'kimi'}));
  await page.evaluate(baseline=>request({type:'YZ_SEND',provider:'kimi',requestId:'different-chat',prompt:'another test',baseline}),next.baseline);
  await page.evaluate(()=>{history.replaceState({},'', '/chat/unrelated-existing');setTimeout(()=>{document.querySelector('#messages').innerHTML='<div class="segment-user">someone else</div><div class="segment-assistant"><div class="markdown-container"><div class="markdown">DO_NOT_LEAK</div></div></div>';},1500);});
  await page.waitForFunction(()=>events.some(e=>e.requestId==='different-chat'&&e.status==='attention'),{},{timeout:5000});
  assert(!(await page.evaluate(()=>events)).some(e=>e.text?.includes('DO_NOT_LEAK')));
 }finally{await browser.close();}
});

test('A visible site captcha refuses sending and does not create a watcher',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();await page.route('https://rmc.bytedance.com/**',route=>route.fulfill({body:'manual verification'}));
  await page.setContent('<main><textarea></textarea><iframe src="https://rmc.bytedance.com/verifycenter/captcha/v2"></iframe></main>');
  await page.evaluate(()=>{window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async()=>({ok:true})}};window.request=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));});
  for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
  const r=await page.evaluate(()=>request({type:'YZ_PREPARE',provider:'doubao'}));assert.equal(r.ok,false);assert(r.error.includes('人机验证'));
  const d=await page.evaluate(()=>__yuanzhuoLite.diagnostics);assert.equal(d.observers,0);assert.equal(d.timers,0);
 }finally{await browser.close();}
});

test('DeepSeek code banners are excluded while language and empty code lines are preserved',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<main><textarea></textarea><div data-role="user">code question</div><article><div class="ds-markdown"><p>Answer</p><div class="md-code-block"><div class="md-code-block-banner"><span>javascript</span><div role="button">Copy</div><div role="button">Download</div></div><pre><span>const lite = 3;\n\n\nconsole.log(lite);</span></pre></div></div><button data-testid="copy-button">Copy</button></article></main>');
  await page.evaluate(()=>{window.events=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async e=>{events.push(e);return {ok:true};}}};window.request=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));});
  for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
  await page.evaluate(()=>request({type:'YZ_REREAD',provider:'deepseek',requestId:'code-test',prompt:'code question',baseline:{count:0,lastHash:'',userCount:0,url:location.href}}));
  await page.waitForFunction(()=>events.some(e=>e.status==='done'),{},{timeout:8000});
  const text=await page.evaluate(()=>events.find(e=>e.status==='done').text);assert(text.includes('```javascript\nconst lite = 3;\n\n\nconsole.log(lite);\n```'));assert(!text.includes('Copy'));assert(!text.includes('Download'));
 }finally{await browser.close();}
});

test('Virtualized user rows use stable message identity and exclude changing timestamps',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<main><textarea></textarea><div class="v_list_row" data-observe-row="own-message"><div class="bg-g-send"><div class="md-box-root">own prompt</div><time>today</time></div></div><article data-role="assistant">OWN_ANSWER<button data-testid="copy-button">Copy</button></article></main>');
  await page.evaluate(()=>{window.events=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async e=>{events.push(e);return {ok:true};}}};window.request=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));});
  for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
  const request={type:'YZ_REREAD',provider:'doubao',requestId:'virtual',prompt:'own prompt',baseline:{count:2,lastHash:'old',userCount:2,userKey:'previous-message'}};
  const r=await page.evaluate(message=>request(message),request);assert.equal(r.ok,true,r.error);
  await page.evaluate(()=>document.querySelector('time').textContent='changed timestamp');
  await page.waitForFunction(()=>events.some(e=>e.status==='done'),{},{timeout:8000});const event=await page.evaluate(()=>events.find(e=>e.status==='done'));assert.equal(event.text,'OWN_ANSWER');assert.equal(event.anchor.key,'own-message');
  await page.evaluate(()=>document.querySelector('[data-observe-row]').setAttribute('data-observe-row','manual-new-message'));
  const bad=await page.evaluate(message=>request(message),{...request,requestId:'virtual-manual',anchor:event.anchor});assert.equal(bad.ok,false);assert(bad.error.includes('不属于本轮'));
 }finally{await browser.close();}
});

test('2026-09 live DOM: Doubao dual editor and DeepSeek send icon revision each send the exact prompt once',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const prompt='第一行 YZ\n\n  缩进保留 <x> & y';
  const cases={
   // Logged-in Doubao home renders a textarea with a tiptap editor stacked on top.
   // A paste into tiptap is forwarded to the textarea and tiptap stays empty.
   doubao:{html:'<main><textarea class="textarea-YelHeN"></textarea><div contenteditable="true" class="tiptap ProseMirror"></div><button id="flow-end-msg-send" disabled>Send</button></main>',setup:()=>{const ta=document.querySelector('textarea'),rich=document.querySelector('.ProseMirror'),button=document.querySelector('#flow-end-msg-send');ta.addEventListener('input',()=>{button.disabled=!ta.value;});rich.addEventListener('paste',e=>{e.preventDefault();ta.value=e.clipboardData.getData('text/plain');ta.dispatchEvent(new Event('input',{bubbles:true}));});button.onclick=()=>{sent.push(ta.value);ta.value='';button.disabled=true;};}},
   deepseek:{html:'<main><textarea placeholder="Message DeepSeek"></textarea><div role="button" class="ds-button ds-button--primary ds-button--filled ds-button--circle ds-button--m" tabindex="0"><svg><path d="M8.3125 0.980206C8.66767 0.980206 9 1.2 9 1.5"></path></svg></div></main>',setup:()=>{const ta=document.querySelector('textarea');document.querySelector('[role="button"]').onclick=()=>{sent.push(ta.value);ta.value='';};}}
  };
  for(const [provider,{html,setup}] of Object.entries(cases)){
   const page=await browser.newPage();await page.setContent(html);
   await page.evaluate(()=>{window.sent=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async()=>({ok:true})}};window.request=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));});
   await page.evaluate(setup);
   for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
   const prep=await page.evaluate(p=>request({type:'YZ_PREPARE',provider:p}),provider);assert.equal(prep.ok,true,provider+': '+prep.error);
   const r=await page.evaluate(({p,prompt,baseline})=>request({type:'YZ_SEND',provider:p,requestId:'live-dom-'+p,prompt,baseline}),{p:provider,prompt,baseline:prep.baseline});
   assert.equal(r.ok,true,provider+': '+r.error);
   assert.deepEqual(await page.evaluate(()=>sent),[prompt],provider);
   await page.evaluate(p=>request({type:'YZ_STOP',requestId:'live-dom-'+p}),provider);
   await page.close();
  }
 }finally{await browser.close();}
});

test('2026-09 live DOM: Doubao conversation index entries that echo prompts are never controls',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();
  // Each index entry's aria-label is a full earlier prompt; peer answers can contain 停止/发送/复制/Stop/Copy.
  await page.setContent('<main><nav><button data-index-entry-key="a" aria-label="旧问题：请停止 Stop 发送 复制 Copy" class="stop-entry">.</button></nav><textarea class="textarea-YelHeN"></textarea><button id="flow-end-msg-send" disabled>Send</button></main>');
  await page.evaluate(()=>{window.sent=[];window.entryClicks=0;const ta=document.querySelector('textarea'),button=document.querySelector('#flow-end-msg-send');document.querySelector('[data-index-entry-key]').onclick=()=>entryClicks++;ta.addEventListener('input',()=>{button.disabled=!ta.value;});button.onclick=()=>{sent.push(ta.value);ta.value='';button.disabled=true;};window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async()=>({ok:true})}};window.request=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));});
  for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
  const prep=await page.evaluate(()=>request({type:'YZ_PREPARE',provider:'doubao'}));assert.equal(prep.ok,true,prep.error);
  const r=await page.evaluate(baseline=>request({type:'YZ_SEND',provider:'doubao',requestId:'index-entry',prompt:'新问题',baseline}),prep.baseline);assert.equal(r.ok,true,r.error);
  assert.deepEqual(await page.evaluate(()=>sent),['新问题']);
  const stopped=await page.evaluate(()=>request({type:'YZ_STOP',requestId:'index-entry',stopGeneration:true}));assert.equal(stopped.pageStopped,false);
  assert.equal(await page.evaluate(()=>entryClicks),0);
  const controls=await page.evaluate(()=>['send','stop','complete'].map(k=>YuanzhuoAdapters.doubao[k].filter(s=>document.querySelector(s)?.hasAttribute('data-index-entry-key'))).flat());
  assert.deepEqual(controls,[]);
 }finally{await browser.close();}
});

test('2026-09 live DOM: Kimi waits for a class-disabled send control instead of clicking it',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  const page=await browser.newPage();
  // Right after an answer, Kimi keeps .send-button-container.disabled for a moment; clicks do nothing.
  await page.setContent('<main><div contenteditable="true" role="textbox"></div><div class="send-button-container disabled"><svg name="Send"></svg></div></main>');
  await page.evaluate(()=>{window.sent=[];window.ignored=0;const input=document.querySelector('[contenteditable]'),button=document.querySelector('.send-button-container');
   input.addEventListener('paste',e=>{e.preventDefault();input.textContent=e.clipboardData.getData('text/plain');setTimeout(()=>button.classList.remove('disabled'),600);});
   button.onclick=()=>{if(button.classList.contains('disabled')){ignored++;return;}sent.push(input.textContent);input.textContent='';};
   window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async()=>({ok:true})}};window.request=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));});
  for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
  const prep=await page.evaluate(()=>request({type:'YZ_PREPARE',provider:'kimi'}));assert.equal(prep.ok,true,prep.error);
  const r=await page.evaluate(baseline=>request({type:'YZ_SEND',provider:'kimi',requestId:'kimi-disabled',prompt:'等按钮可用',baseline}),prep.baseline);assert.equal(r.ok,true,r.error);
  assert.deepEqual(await page.evaluate(()=>({sent,ignored})),{sent:['等按钮可用'],ignored:0});
  await page.evaluate(()=>request({type:'YZ_STOP',requestId:'kimi-disabled'}));
 }finally{await browser.close();}
});

test('2026-09 live DOM: a Kimi quota notice fails explicitly before or after Send without resending',async()=>{
 const browser=await chromium.launch({channel:'chromium',headless:true});
 try{
  // Before Send: the composer bar already says the free quota is used up.
  let page=await browser.newPage();
  await page.setContent('<main><div class="chat-editor"><div class="chat-input-bar"><div class="chat-input-bar-content"><span>Your free quota is used up. Refreshes at 09-19.</span></div></div><div contenteditable="true" role="textbox"></div><div class="send-button-container"><svg name="Send"></svg></div></div></main>');
  const harness=async()=>{await page.evaluate(()=>{window.events=[];window.sent=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async e=>{events.push(e);return {ok:true};}}};window.request=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));});for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});};
  await harness();
  const refused=await page.evaluate(()=>request({type:'YZ_PREPARE',provider:'kimi'}));
  assert.equal(refused.ok,false);assert.match(refused.error,/额度/);assert.match(refused.error,/free quota is used up/);
  await page.close();
  // After Send: the click only opens a quota modal; the prompt stays in the editor.
  page=await browser.newPage();
  await page.setContent('<main><div class="chat-editor"><div contenteditable="true" role="textbox"></div><div class="send-button-container"><svg name="Send"></svg></div></div></main>');
  await harness();
  await page.evaluate(()=>{const input=document.querySelector('[contenteditable]');input.addEventListener('paste',e=>{e.preventDefault();input.textContent=e.clipboardData.getData('text/plain');});document.querySelector('.send-button-container').onclick=()=>{document.body.insertAdjacentHTML('beforeend','<div class="modal-mask"></div><div class="modal-container">Tips Credits used up. Got it</div>');};});
  const prep=await page.evaluate(()=>request({type:'YZ_PREPARE',provider:'kimi'}));assert.equal(prep.ok,true,prep.error);
  const r=await page.evaluate(baseline=>request({type:'YZ_SEND',provider:'kimi',requestId:'quota',prompt:'额度测试',baseline}),prep.baseline);assert.equal(r.ok,true,r.error);
  await page.waitForFunction(()=>events.some(e=>e.status==='attention'),{},{timeout:8000});
  const event=await page.evaluate(()=>events.find(e=>e.status==='attention'));
  assert.equal(event.phase,'attempted');assert.match(event.error,/额度/);assert.match(event.error,/不会自动重发/);
  const d=await page.evaluate(()=>__yuanzhuoLite.diagnostics);assert.equal(d.observers,0);assert.equal(d.timers,0);
 }finally{await browser.close();}
});
