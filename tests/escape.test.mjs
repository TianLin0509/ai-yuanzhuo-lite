import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../scripts/browser-config.mjs';

// 2026-09-24 user report: a long Doubao discussion prompt stayed in the composer with
// "网页输入内容与原文不一致", retry was blocked by that leftover text, and a manual Send on the
// site could not be picked up. These pages reproduce each path with Doubao's 2026-09 DOM.
const source=name=>fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const html=`<main><div id="list"></div><div class="composer"><div class="tiptap ProseMirror" contenteditable="true"></div></div><button id="flow-end-msg-send">发送</button></main>`;
function setup(options){
  window.sent=[];window.events=[];let n=0;
  const editor=document.querySelector('.tiptap'),send=document.querySelector('#flow-end-msg-send'),list=document.querySelector('#list');
  window.lines=()=>[...editor.children].map(p=>p.textContent);
  // Like the reported composer, optionally drop empty paragraphs when pasting.
  editor.addEventListener('paste',e=>{e.preventDefault();const text=e.clipboardData.getData('text/plain');editor.replaceChildren(...text.split('\n').filter(line=>!options.dropBlank||line).map(line=>{const p=document.createElement('p');if(line)p.textContent=line;else p.append(document.createElement('br'));return p;}));});
  send.disabled=!!options.neverEnabled;
  window.siteSend=()=>{const text=window.lines().join('\n');window.sent.push(text);editor.replaceChildren();n++;
    list.insertAdjacentHTML('beforeend',`<div data-testid="send_message"><div data-testid="message_content" data-message-id="u${n}"><div class="md-box-root"></div></div></div><div data-testid="receive_message"><div data-testid="message_content" data-message-id="a${n}"><div class="md-box-root" data-streaming="true"><p>正在回答</p></div></div><div data-foundation-type="receive-message-action-bar"></div></div>`);
    list.querySelector(`[data-message-id="u${n}"] .md-box-root`).textContent=text;
    setTimeout(()=>{const body=list.querySelector(`[data-message-id="a${n}"] .md-box-root`);body.innerHTML='<p>ANSWER_'+n+'</p>';body.dataset.streaming='false';list.querySelector(`[data-message-id="a${n}"]`).parentElement.querySelector('[data-foundation-type="receive-message-action-bar"]').innerHTML='<button>复制</button>';},500);};
  send.onclick=window.siteSend;
  window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async e=>{events.push(e);return {ok:true};}}};
  window.request=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));
}
async function page(browser,options={}){
  const p=await browser.newPage();await p.setContent(html);await p.evaluate(setup,options);
  for(const name of ['adapters.js','content.js'])await p.addScriptTag({content:source(name)});
  return p;
}
const done=p=>p.waitForFunction(()=>window.events.some(e=>['done','attention'].includes(e.status)),{},{timeout:10000}).then(()=>p.evaluate(()=>window.events.find(e=>['done','attention'].includes(e.status))));
const PROMPT='【讨论】第一段\n\n第二段 **加粗**\n\n\n- 列表项\n  缩进保留';

test('a composer that drops blank lines still sends the complete prompt exactly once',async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const p=await page(browser,{dropBlank:true});
    const prep=await p.evaluate(prompt=>request({type:'YZ_PREPARE',provider:'doubao',prompt}),PROMPT);assert.equal(prep.ok,true,prep.error);
    const sent=await p.evaluate(({prompt,baseline})=>request({type:'YZ_SEND',provider:'doubao',requestId:'r1',prompt,baseline}),{prompt:PROMPT,baseline:prep.baseline});
    assert.equal(sent.ok,true,sent.error);
    assert.deepEqual(await p.evaluate(()=>window.sent),['【讨论】第一段\n第二段 **加粗**\n- 列表项\n  缩进保留']);
    assert.equal((await done(p)).status,'done');
  }finally{await browser.close();}
});

test('a missing character is still refused, reported as not sent, with the first difference',async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const p=await page(browser);
    await p.evaluate(()=>{const editor=document.querySelector('.tiptap');editor.addEventListener('paste',()=>setTimeout(()=>{editor.lastElementChild.textContent=editor.lastElementChild.textContent.slice(0,-1);},0));});
    const prep=await p.evaluate(prompt=>request({type:'YZ_PREPARE',provider:'doubao',prompt}),PROMPT);
    const sent=await p.evaluate(({prompt,baseline})=>request({type:'YZ_SEND',provider:'doubao',requestId:'r2',prompt,baseline}),{prompt:PROMPT,baseline:prep.baseline});
    assert.equal(sent.ok,false);assert.equal(sent.notSent,true);assert.match(sent.error,/不一致.*第 \d+ 字起不同/);
    assert.equal((await p.evaluate(()=>window.sent)).length,0);
  }finally{await browser.close();}
});

test('retry reuses a leftover draft that is exactly this prompt, but never someone else\'s draft',async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const p=await page(browser,{dropBlank:true});
    await p.evaluate(prompt=>{const dt=new DataTransfer();dt.setData('text/plain',prompt);document.querySelector('.tiptap').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},PROMPT);
    const other=await p.evaluate(()=>request({type:'YZ_PREPARE',provider:'doubao',prompt:'另一个问题'}));
    assert.equal(other.ok,false);assert.match(other.error,/尚未发送的内容/);
    const prep=await p.evaluate(prompt=>request({type:'YZ_PREPARE',provider:'doubao',prompt}),PROMPT);assert.equal(prep.ok,true,prep.error);assert.equal(prep.reuse,true);
    const sent=await p.evaluate(({prompt,baseline})=>request({type:'YZ_SEND',provider:'doubao',requestId:'r3',prompt,baseline}),{prompt:PROMPT,baseline:prep.baseline});
    assert.equal(sent.ok,true,sent.error);assert.equal((await p.evaluate(()=>window.sent)).length,1);
    assert.equal((await done(p)).status,'done');
  }finally{await browser.close();}
});

test('a disabled Send is reported as not sent so retry needs no duplicate warning',async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const p=await page(browser,{neverEnabled:true});
    const prep=await p.evaluate(prompt=>request({type:'YZ_PREPARE',provider:'doubao',prompt}),PROMPT);
    const sent=await p.evaluate(({prompt,baseline})=>request({type:'YZ_SEND',provider:'doubao',requestId:'r4',prompt,baseline}),{prompt:PROMPT,baseline:prep.baseline});
    assert.equal(sent.ok,false);assert.equal(sent.notSent,true);assert.equal((await p.evaluate(()=>window.sent)).length,0);
  }finally{await browser.close();}
});

test('reread after a manual Send: matching question is followed; an edited question needs confirmation, then force reads it',async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const p=await page(browser,{dropBlank:true});
    const prep=await p.evaluate(prompt=>request({type:'YZ_PREPARE',provider:'doubao',prompt}),PROMPT);
    // The user pasted the prompt and clicked Send on the site; the round never saw the click.
    await p.evaluate(prompt=>{const dt=new DataTransfer();dt.setData('text/plain',prompt);document.querySelector('.tiptap').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));window.siteSend();},PROMPT);
    const same=await p.evaluate(({prompt,baseline})=>request({type:'YZ_REREAD',provider:'doubao',requestId:'m1',prompt,baseline,url:baseline.url}),{prompt:PROMPT,baseline:prep.baseline});
    assert.equal(same.ok,true,same.error);let d=await done(p);assert.equal(d.status,'done');assert.equal(d.text,'ANSWER_1');assert.equal(d.error,'');
    // Now the user edited the question before sending it by hand.
    await p.evaluate(()=>{window.events.length=0;const dt=new DataTransfer();dt.setData('text/plain','我改过的问题');document.querySelector('.tiptap').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));window.siteSend();});
    const refused=await p.evaluate(({prompt,baseline})=>request({type:'YZ_REREAD',provider:'doubao',requestId:'m2',prompt,baseline,url:baseline.url}),{prompt:PROMPT,baseline:prep.baseline});
    assert.equal(refused.ok,false);assert.equal(refused.code,'NOT_OWNED');assert.equal(refused.question,'我改过的问题');
    const forced=await p.evaluate(prompt=>request({type:'YZ_REREAD',provider:'doubao',requestId:'m3',prompt,baseline:null,force:true}),PROMPT);
    assert.equal(forced.ok,true,forced.error);d=await done(p);assert.equal(d.status,'done');assert.equal(d.text,'ANSWER_2');assert.match(d.error,/未核对提问原文/);
    const diag=await p.evaluate(()=>__yuanzhuoLite.diagnostics);assert.equal(diag.observers,0);assert.equal(diag.timers,0);
  }finally{await browser.close();}
});

test('a Doubao artifact card is flagged as not fully extracted instead of done',async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
    const p=await page(browser);
    await p.evaluate(()=>{window.siteSend=()=>{const list=document.querySelector('#list');const text=window.lines().join('\n');window.sent.push(text);document.querySelector('.tiptap').replaceChildren();
      list.insertAdjacentHTML('beforeend',`<div data-testid="send_message"><div data-testid="message_content" data-message-id="u9"><div class="md-box-root"></div></div></div><div data-testid="receive_message"><div data-testid="message_content" data-message-id="a9"><div data-plugin-identifier="block_type:10000"><div class="md-box-root" data-streaming="false"><p>我将整理成文档。</p></div></div><div data-plugin-identifier="block_type:10030 | artifact_block.resource_type:10"><div data-office-artifact-scale-container><div data-assembly-preview-card>30人团队管理方案</div></div></div></div><div data-foundation-type="receive-message-action-bar"><button>复制</button></div></div>`);
      list.querySelector('[data-message-id="u9"] .md-box-root').textContent=text;};document.querySelector('#flow-end-msg-send').onclick=window.siteSend;});
    const prep=await p.evaluate(prompt=>request({type:'YZ_PREPARE',provider:'doubao',prompt}),PROMPT);
    const sent=await p.evaluate(({prompt,baseline})=>request({type:'YZ_SEND',provider:'doubao',requestId:'c1',prompt,baseline}),{prompt:PROMPT,baseline:prep.baseline});
    assert.equal(sent.ok,true,sent.error);
    const d=await done(p);assert.equal(d.status,'attention');assert.match(d.error,/文档卡片/);
  }finally{await browser.close();}
});
