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
