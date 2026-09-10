import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {chromium} from '../scripts/browser-config.mjs';

test('A recycled partial answer cannot complete from the cached element while the current answer is absent',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<main><textarea></textarea><article data-role="assistant">OLD_ANSWER</article><div data-role="user">current question</div><article data-role="assistant" id="partial">PARTIAL</article><button id="busy">Stop</button></main>');
 await page.evaluate(()=>{window.events=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async e=>{events.push(e);return {ok:true};}}};window.request=m=>new Promise(resolve=>listener(m,{id:'test'},resolve));});
 for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
 await page.evaluate(()=>YuanzhuoAdapters.doubao.stop=['#busy']);
 const response=await page.evaluate(()=>request({type:'YZ_REREAD',provider:'doubao',requestId:'recycled',prompt:'current question',baseline:{count:1,lastHash:'old',userCount:0}}));assert.equal(response.ok,true,response.error);
 assert((await page.evaluate(()=>events)).some(e=>e.status==='streaming'&&e.text==='PARTIAL'));
 await page.evaluate(()=>{document.querySelector('#partial').remove();document.querySelector('#busy').remove();document.querySelector('[data-role="assistant"]').textContent='REMOUNTED_OLD';});
 await new Promise(resolve=>setTimeout(resolve,5200));
 assert(!(await page.evaluate(()=>events)).some(e=>['done','attention'].includes(e.status)),'Detached partial must remain streaming while the answer is recycled');
 await page.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<article data-role="assistant">FULL_RECOVERED_END<button data-testid="copy-button">Copy</button></article>'));
 await page.waitForFunction(()=>events.some(e=>e.status==='done'),undefined,{timeout:8000});assert.equal(await page.evaluate(()=>events.find(e=>e.status==='done').text),'FULL_RECOVERED_END');
 const d=await page.evaluate(()=>__yuanzhuoLite.diagnostics);assert.equal(d.observers,0);assert.equal(d.timers,0);
 }finally{await browser.close();}
});

test('Verified Doubao local-to-server route recovery retains the message anchor and refuses a different message or stable conversation',async()=>{
 const browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage();await page.route('https://www.doubao.com/**',r=>r.fulfill({contentType:'text/html',body:'<main><textarea></textarea><div class="v_list_row" data-observe-row="own-row"><div class="bg-g-send"><div class="md-box-root">own prompt</div></div></div><article data-role="assistant">OWN_ANSWER<button data-testid="copy-button">Copy</button></article></main>'}));
 await page.goto('https://www.doubao.com/chat/local_123');await page.evaluate(()=>{document.querySelector('[data-observe-row]').setAttribute('data-observe-row','block_c036e5b0-acb4-11f1-ad19-afd4128d612e');window.events=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async e=>{events.push(e);return {ok:true};}}};window.request=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));});
 for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
 const base={provider:'doubao',type:'YZ_REREAD',prompt:'own prompt',baseline:{count:0,lastHash:'',userCount:0,url:'https://www.doubao.com/chat/'},url:'https://www.doubao.com/chat/local_123'};
 assert.equal((await page.evaluate(m=>request(m),{...base,requestId:'initial'})).ok,true);
 await page.waitForFunction(()=>events.some(e=>e.requestId==='initial'&&e.status==='done'),undefined,{timeout:8000});const anchor=await page.evaluate(()=>events.find(e=>e.status==='done').anchor);
 await page.evaluate(()=>history.replaceState({},'', '/chat/987654'));
 const recovered=await page.evaluate(m=>request(m),{...base,anchor,requestId:'recovered'});assert.equal(recovered.ok,true,recovered.error);
 await page.waitForFunction(()=>events.some(e=>e.requestId==='recovered'&&e.status==='done'),undefined,{timeout:8000});const answer=await page.evaluate(()=>events.find(e=>e.requestId==='recovered'&&e.status==='done'));assert.equal(answer.text,'OWN_ANSWER');assert.equal(answer.url,'https://www.doubao.com/chat/987654');
 const stable=await page.evaluate(m=>request(m),{...base,url:'https://www.doubao.com/chat/111',anchor,requestId:'stable-switch'});assert.equal(stable.ok,false);
 const rowIndex=await page.evaluate(m=>request(m),{...base,anchor:{...anchor,key:'0'},requestId:'row-index'});assert.equal(rowIndex.ok,false);assert(rowIndex.error.includes('切换对话'));
 await page.evaluate(()=>document.querySelector('[data-observe-row]').setAttribute('data-observe-row','different-row'));
 const unrelated=await page.evaluate(m=>request(m),{...base,anchor,requestId:'wrong-row'});assert.equal(unrelated.ok,false);assert(unrelated.error.includes('不属于本轮'));
 const d=await page.evaluate(()=>__yuanzhuoLite.diagnostics);assert.equal(d.observers,0);assert.equal(d.timers,0);
 }finally{await browser.close();}
});

test('Rendered ordered user lists preserve indices for full prompt identity instead of discarding meaningful digits',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<main><textarea></textarea><div data-role="user"><div class="md-box-root"><p>Peer views:</p><ol><li>First 17</li><li>Second 42</li></ol></div></div><article data-role="assistant">COMPLETE_END<button data-testid="copy-button">Copy</button></article></main>');
 await page.evaluate(()=>{window.events=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async e=>{events.push(e);return {ok:true};}}};window.request=m=>new Promise(resolve=>listener(m,{id:'test'},resolve));});
 for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
 const base={type:'YZ_REREAD',provider:'doubao',prompt:'Peer views:\n1. First 17\n2. Second 42',baseline:{count:0,lastHash:'',userCount:0}};
 const correct=await page.evaluate(m=>request(m),{...base,requestId:'numbered'});assert.equal(correct.ok,true,correct.error);await page.waitForFunction(()=>events.some(e=>e.status==='done'),undefined,{timeout:8000});
 await page.evaluate(()=>document.querySelector('ol').setAttribute('start','9'));const wrongIndex=await page.evaluate(m=>request(m),{...base,requestId:'wrong-index'});assert.equal(wrongIndex.ok,false);
 await page.evaluate(()=>{document.querySelector('ol').removeAttribute('start');document.querySelector('li:last-child').textContent='Second 43';});const wrongText=await page.evaluate(m=>request(m),{...base,requestId:'wrong-text'});assert.equal(wrongText.ok,false);assert.equal((await page.evaluate(()=>__yuanzhuoLite.diagnostics)).observers,0);
 }finally{await browser.close();}
});

test('DeepSeek virtualized history uses message keys when visible user counts stay constant or shrink',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<main><textarea></textarea><div data-virtual-list-item-key="-4"><div class="fbb737a4">old question</div></div><div data-virtual-list-item-key="-6"><div class="fbb737a4">current question</div></div><article><div class="ds-markdown">CURRENT_END</div><button data-testid="copy-button">Copy</button></article></main>');
 await page.evaluate(()=>{window.events=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async e=>{events.push(e);return {ok:true};}}};window.request=m=>new Promise(resolve=>listener(m,{id:'test'},resolve));});
 for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
 const base={type:'YZ_REREAD',provider:'deepseek',prompt:'current question',baseline:{count:2,lastHash:'old',userCount:2,userKey:'-4'}};const first=await page.evaluate(m=>request(m),{...base,requestId:'virtual-ds'});assert.equal(first.ok,true,first.error);await page.waitForFunction(()=>events.some(e=>e.status==='done'),undefined,{timeout:8000});const anchor=await page.evaluate(()=>events.find(e=>e.status==='done').anchor);assert.equal(anchor.key,'-6');
 await page.evaluate(()=>document.querySelector('[data-virtual-list-item-key="-4"]').remove());const shrink=await page.evaluate(m=>request(m),{...base,anchor,requestId:'shrink'});assert.equal(shrink.ok,true,shrink.error);await page.evaluate(()=>request({type:'YZ_STOP',requestId:'shrink'}));
 await page.evaluate(()=>document.querySelector('[data-virtual-list-item-key]').setAttribute('data-virtual-list-item-key','-8'));const wrong=await page.evaluate(m=>request(m),{...base,anchor,requestId:'wrong-key'});assert.equal(wrong.ok,false);assert.equal((await page.evaluate(()=>__yuanzhuoLite.diagnostics)).observers,0);
 }finally{await browser.close();}
});

test('Doubao document cards explicitly report incomplete collection instead of declaring their caption a complete answer',async()=>{
 const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<main><textarea></textarea><div data-role="user">document question</div><div class="v_list_row" data-observe-row="answer"><div class="md-box-root">CAPTION_ONLY</div><div class="flow-product-card"><div data-feishu-office-current-doc-old-card="true">Document title</div></div><button data-testid="copy-button">Copy</button></div></main>');
 await page.evaluate(()=>{window.events=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async e=>{events.push(e);return {ok:true};}}};window.request=m=>new Promise(resolve=>listener(m,{id:'test'},resolve));});
 for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8')});
 const response=await page.evaluate(()=>request({type:'YZ_REREAD',provider:'doubao',requestId:'document',prompt:'document question',baseline:{count:0,lastHash:'',userCount:0}}));assert.equal(response.ok,true,response.error);await page.waitForFunction(()=>events.some(e=>['attention','done'].includes(e.status)),undefined,{timeout:8000});const events=await page.evaluate(()=>window.events);assert(!events.some(e=>e.status==='done'),'A document caption is not the full answer');const warning=events.find(e=>e.status==='attention');assert(warning.error.includes('文档'));assert(warning.text.includes('CAPTION_ONLY'));const d=await page.evaluate(()=>__yuanzhuoLite.diagnostics);assert.equal(d.observers,0);assert.equal(d.timers,0);
 const next=await page.evaluate(()=>request({type:'YZ_PREPARE',provider:'doubao'}));await page.evaluate(()=>{const old=document.querySelector('[data-observe-row]'),remounted=old.cloneNode(true);remounted.setAttribute('data-observe-row','remounted-old');remounted.querySelector('.md-box-root').textContent='UPDATED_OLD_CAPTION';document.querySelector('main').append(remounted);document.querySelector('main').insertAdjacentHTML('beforeend','<div data-role="user">plain question</div>');});
 const waiting=await page.evaluate(baseline=>request({type:'YZ_REREAD',provider:'doubao',requestId:'after-document',prompt:'plain question',baseline}),next.baseline);assert.equal(waiting.ok,true,waiting.error);assert(!(await page.evaluate(()=>window.events)).some(e=>e.requestId==='after-document'&&e.status==='attention'),'An old card must not stop the next response');
 await page.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<div class="v_list_row" data-observe-row="new-answer"><div class="md-box-root">INLINE_END</div><button data-testid="copy-button">Copy</button></div>'));await page.waitForFunction(()=>events.some(e=>e.requestId==='after-document'&&e.status==='done'),undefined,{timeout:8000});assert.equal(await page.evaluate(()=>events.find(e=>e.requestId==='after-document'&&e.status==='done').text),'INLINE_END');
 }finally{await browser.close();}
});
