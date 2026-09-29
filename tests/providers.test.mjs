import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '../scripts/browser-config.mjs';
import {PROVIDERS,DEFAULT_MEMBERS,MAX_MEMBERS,validMembers,sameConversation,newSession} from '../src/core.js';

const source=name=>fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const adapters=(()=>{const g={};new Function('globalThis',source('adapters.js'))(g);return g.YuanzhuoAdapters;})();

test('every provider has an adapter, a host permission and the same conversation rule',()=>{
  const manifest=JSON.parse(source('manifest.json'));
  for(const [id,p] of Object.entries(PROVIDERS)){
    assert(adapters[id],id+' adapter');
    assert.equal(String(adapters[id].conversation),String(p.conversation),id+' conversation rule must match core');
    for(const host of p.hosts)assert(manifest.host_permissions.includes(`https://${host}/*`),id+' host permission '+host);
    assert(p.hosts.includes(new URL(p.url).hostname),id+' start page belongs to its hosts');
  }
  assert.deepEqual(Object.keys(adapters).sort(),Object.keys(PROVIDERS).sort());
});

test('member sets are 2–3 distinct known providers; defaults stay valid',()=>{
  assert.equal(MAX_MEMBERS,3);assert(validMembers([...DEFAULT_MEMBERS]));
  assert(validMembers(['chatgpt','claude','gemini']));
  for(const bad of [['chatgpt'],['kimi','kimi'],['deepseek','kimi','doubao','qwen'],['deepseek','nope'],null])assert.equal(validMembers(bad),false);
  assert.throws(()=>newSession(['deepseek','kimi','doubao','qwen']),/2–3/);
});

test('blank landing pages are interchangeable; saved conversations must match exactly',()=>{
  assert(sameConversation('yuanbao','https://yuanbao.tencent.com/chat','https://yuanbao.tencent.com/chat/naQivTmsDa'));
  assert(!sameConversation('yuanbao','https://yuanbao.tencent.com/chat/naQivTmsDa','https://yuanbao.tencent.com/chat/naQivTmsDa/5b1c'));
  assert(sameConversation('chatgpt','https://chatgpt.com/','https://chatgpt.com/?model=auto'));
  assert(!sameConversation('chatgpt','https://chatgpt.com/c/1','https://chatgpt.com/c/2'));
  assert(!sameConversation('chatgpt','https://chatgpt.com/uc/1','https://chatgpt.com/'));
  assert(sameConversation('gemini','https://gemini.google.com/app','https://gemini.google.com/app/'));
  assert(!sameConversation('gemini','https://gemini.google.com/app/abc','https://gemini.google.com/app'));
  assert(!sameConversation('qwen','https://www.qianwen.com/','https://evil.example/'));
  assert(sameConversation('doubao','https://www.doubao.com/chat/','https://www.doubao.com/chat/'));
  assert(!sameConversation('doubao','https://www.doubao.com/chat/local_1','https://www.doubao.com/chat/'));
});

// Controlled pages mirror DOM shapes recorded on the live sites on 2026-09-23 (see
// docs/20260923-more-providers-verification-claude.md). They prove adapter wiring and
// extraction rules, never that a third-party site still matches today.
const PAGES={
  gemini:{
    html:`<main><chat-window><div id="messages"></div>
      <rich-textarea><div class="ql-editor textarea new-input-ui ql-blank" contenteditable="true" role="textbox" aria-label="Enter a prompt for Gemini"><p><br></p></div></rich-textarea>
      <button aria-label="Upload &amp; tools"></button><button aria-label="Open mode picker, currently Flash-Lite"></button>
      <button aria-label="Send message"></button><button aria-label="Stop response" hidden></button></chat-window></main>`,
    setup:()=>{
      const editor=document.querySelector('.ql-editor'),send=document.querySelector('[aria-label="Send message"]'),stop=document.querySelector('[aria-label="Stop response"]'),messages=document.querySelector('#messages');
      // Quill keeps one <p> per line; an empty line is <p><br></p>.
      const text=()=>[...editor.children].map(p=>p.textContent).join('\n');
      editor.addEventListener('paste',e=>{e.preventDefault();editor.replaceChildren(...e.clipboardData.getData('text/plain').split('\n').map(line=>{const p=document.createElement('p');if(line)p.textContent=line;else p.append(document.createElement('br'));return p;}));});
      send.onclick=()=>{
        const sent=text();window.sent.push(sent);editor.innerHTML='<p><br></p>';send.hidden=true;stop.hidden=false;
        const q=document.createElement('user-query');q.innerHTML='<span class="user-query-container"><div class="query-text gds-body-l"><h5 class="cdk-visually-hidden">You said</h5></div></span>';
        q.querySelector('.query-text').append(...sent.split('\n').map(line=>{const p=document.createElement('p');p.className='query-text-line';p.textContent=line;return p;}));
        messages.append(q);
        const r=document.createElement('model-response');
        r.innerHTML='<div class="response-container"><div class="model-response-label-announcer"><h6 class="cdk-visually-hidden">Gemini said</h6></div><model-response-content><structured-content-container class="model-response-text processing-state-visible"><message-content><div class="markdown markdown-main-panel md-content" aria-busy="true"><p>正在回答</p></div></message-content></structured-content-container></model-response-content><div class="response-footer gap"></div></div>';
        messages.append(r);
        setTimeout(()=>{
          r.querySelector('.markdown').innerHTML='<p>回答：'+sent.split('\n')[0]+'</p><response-element class="no-md"><code-block><div class="code-block"><div class="code-block-decoration header-formatted"><span>Python</span><div class="buttons"><button aria-label="Copy code"></button></div></div><pre><code class="code-container formatted" data-test-id="code-content">print("CODE_OK")</code></pre></div></code-block></response-element><p>END_GEMINI</p>';
          stop.hidden=true;
          // Stop disappears before the body drops aria-busy; actions come last.
          setTimeout(()=>{r.querySelector('.markdown').setAttribute('aria-busy','false');r.querySelector('.response-footer').classList.add('complete');const actions=document.createElement('message-actions');actions.innerHTML='<button aria-label="Redo"></button><button aria-label="Copy"></button>';r.append(actions);send.hidden=false;},1200);
        },900);
      };
    },
    prompt:'第一行 GEMINI\n\n  缩进保留 <x> & y',
    expect:{text:['回答：第一行 GEMINI','```python\nprint("CODE_OK")\n```','END_GEMINI'],absent:['Gemini said','Python\n','正在回答'],mode:'Flash-Lite'}
  },
  chatgpt:{
    html:`<main><ol aria-label="Conversation" data-conversation-transcript id="transcript"></ol>
      <form><textarea id="mobile-composer-prompt" name="prompt" placeholder="Ask ChatGPT"></textarea>
      <button type="button" aria-label="Start dictation"></button><button type="button" aria-label="Send message"></button><button type="button" aria-label="Stop streaming" hidden></button></form></main>`,
    setup:()=>{
      const input=document.querySelector('#mobile-composer-prompt'),send=document.querySelector('[aria-label="Send message"]'),stop=document.querySelector('[aria-label="Stop streaming"]'),list=document.querySelector('#transcript');let n=0;
      send.onclick=()=>{
        const sent=input.value;window.sent.push(sent);input.value='';send.hidden=true;stop.hidden=false;n++;
        const u=document.createElement('li');u.dataset.messageRole='user';u.id='user-'+n;u.innerHTML='<div data-submit-message-animation-target><button data-user-message-bubble type="button"><p data-user-message-copy></p></button></div>';u.querySelector('p').textContent=sent;list.append(u);
        const a=document.createElement('li');a.dataset.messageRole='assistant';a.id='assistant-'+n;a.innerHTML='<h4 data-message-attribution>ChatGPT said:</h4><div><span aria-hidden="true" data-assistant-placeholder-slot hidden></span><div><div data-assistant-markdown><p data-assistant-stream-block>正在回答</p></div></div></div>';list.append(a);
        setTimeout(()=>{a.dataset.assistantContentStarted='';a.querySelector('[data-assistant-markdown]').innerHTML='<p dir="ltr" data-assistant-stream-block>回答：'+sent.split('\n')[0]+'</p><ol data-assistant-stream-block><li><p>第一点</p></li><li><p>第二点</p></li></ol><pre dir="ltr" data-assistant-stream-block><code class="language-python" data-assistant-syntax-highlighted><span><span>print</span><span>("CODE_OK")</span></span></code><span data-message-content-controls><button type="button">Copy</button></span></pre><p dir="ltr" data-assistant-stream-block>END_GPT</p>';},500);
        setTimeout(()=>{a.dataset.messageComplete='';const actions=document.createElement('div');actions.setAttribute('role','group');actions.setAttribute('aria-label','Response actions');actions.dataset.assistantMessageActions='';actions.innerHTML='<button aria-label="Copy"></button>';a.append(actions);stop.hidden=true;send.hidden=false;},1100);
      };
    },
    prompt:'第一行 GPT\n\n  缩进保留 <x> & y',
    expect:{text:['回答：第一行 GPT','1. 第一点','2. 第二点','```python\nprint("CODE_OK")\n```','END_GPT'],absent:['ChatGPT said','Copy','正在回答']}
  },
  // 豆包 2026-09-23 home page: typing into the textarea makes the page replace it with its tiptap
  // editor carrying the same text; new conversations render send_message / receive_message.
  doubao:{
    html:`<main><div id="list"></div><div class="composer"><textarea class="textarea-YelHeN" placeholder="发消息或按住空格说话..."></textarea></div>
      <button id="flow-end-msg-send" class="send-msg-btn" disabled></button></main>`,
    setup:()=>{
      const box=document.querySelector('.composer'),send=document.querySelector('#flow-end-msg-send'),list=document.querySelector('#list');let editor=null,n=0;
      const toTiptap=text=>{editor=document.createElement('div');editor.className='tiptap ProseMirror';editor.contentEditable='true';editor.innerHTML=text.split('\n').map(line=>'<p>'+(line?line.replaceAll('&','&amp;').replaceAll('<','&lt;'):'<br>')+'</p>').join('');box.replaceChildren(editor);send.disabled=false;};
      document.querySelector('textarea').addEventListener('input',e=>setTimeout(()=>toTiptap(e.target.value),60));
      send.onclick=()=>{
        const text=[...editor.children].map(p=>p.textContent).join('\n');window.sent.push(text);editor.innerHTML='<p><br></p>';send.disabled=true;n++;
        list.insertAdjacentHTML('beforeend',`<div class="v_list_row"><div data-testid="send_message" data-message-role="user"><div data-testid="message_content" data-message-id="u${n}"><div data-testid="message_text_content" class="md-box-root" data-streaming="false"></div></div></div></div><div class="v_list_row"><div data-testid="receive_message" data-message-role="assistant"><div data-testid="message_content" data-message-id="a${n}"><div data-testid="message_text_content" class="md-box-root" data-streaming="true"><p>正在回答</p></div></div><div data-foundation-type="receive-message-action-bar"></div></div></div>`);
        list.querySelector(`[data-message-id="u${n}"] .md-box-root`).textContent=text;
        setTimeout(()=>{const body=list.querySelector(`[data-message-id="a${n}"] .md-box-root`);body.innerHTML='<p>回答：'+text.split('\n')[0].replaceAll('<','&lt;')+'</p><p>END_DOUBAO</p>';body.dataset.streaming='false';list.querySelector(`[data-message-id="a${n}"]`).parentElement.querySelector('[data-foundation-type="receive-message-action-bar"]').innerHTML='<button data-testid="message_action_copy">复制</button>';},800);
      };
    },
    prompt:'第一行 豆包\n\n  缩进保留 <x> & y',
    expect:{text:['回答：第一行 豆包','END_DOUBAO'],absent:['正在回答']}
  },
  // DeepSeek 2026-09-26 with DeepThink on: reasoning is a .ds-markdown inside .ds-think-content; the reply is
  // .ds-markdown.ds-assistant-message-main-content. Toggles report their state through aria-pressed.
  deepseek:{
    html:`<main><div id="list"></div><textarea id="chat-input" placeholder="给 DeepSeek 发送消息"></textarea>
      <div class="ds-toggle-button" aria-pressed="true">DeepThink</div><div class="ds-toggle-button" aria-pressed="false">Search</div>
      <button data-testid="send-button">发送</button><div role="button" aria-label="停止" hidden>■</div></main>`,
    setup:()=>{
      const input=document.querySelector('#chat-input'),send=document.querySelector('[data-testid="send-button"]'),stop=document.querySelector('[aria-label="停止"]'),list=document.querySelector('#list');let n=0;
      send.onclick=()=>{const sent=input.value;window.sent.push(sent);input.value='';n+=2;stop.hidden=false;
        list.insertAdjacentHTML('beforeend',`<div data-virtual-list-item-key="${n}"><div class="fbb737a4"></div></div><div data-virtual-list-item-key="${n+1}"><div class="ds-message"><div class="ds-think-content"><div class="ds-markdown"><p>THINK_SECRET 正在思考</p></div></div></div></div>`);
        list.querySelector(`[data-virtual-list-item-key="${n}"] .fbb737a4`).textContent=sent;
        const turn=list.querySelector(`[data-virtual-list-item-key="${n+1}"] .ds-message`);
        setTimeout(()=>{turn.querySelector('.ds-think-content .ds-markdown').innerHTML='<p>THINK_SECRET 思考完毕</p>';turn.insertAdjacentHTML('beforeend','<div class="ds-markdown ds-assistant-message-main-content"><p>回答：'+sent.split('\n')[0]+'</p><p>DS_FINAL</p></div>');},500);
        setTimeout(()=>{stop.hidden=true;turn.insertAdjacentHTML('afterend','<div><div role="button" data-testid="copy-button">复制</div></div>');},1100);};
    },
    prompt:'第一行 DS\n\n  缩进保留 <x> & y',
    expect:{text:['回答：第一行 DS','DS_FINAL'],absent:['THINK_SECRET'],mode:'深度思考'}
  },
  // A page still building its composer when the round starts: preparing waits for it instead of failing.
  'deepseek#late-composer':{
    html:`<main><div id="list"></div><textarea id="chat-input" placeholder="给 DeepSeek 发送消息"></textarea>
      <div class="ds-toggle-button" aria-pressed="true">DeepThink</div><div class="ds-toggle-button" aria-pressed="false">Search</div>
      <button data-testid="send-button">发送</button><div role="button" aria-label="停止" hidden>■</div></main>`,
    setup:()=>{
      const input=document.querySelector('#chat-input'),send=document.querySelector('[data-testid="send-button"]'),stop=document.querySelector('[aria-label="停止"]'),list=document.querySelector('#list');let n=0;
      send.onclick=()=>{const sent=input.value;window.sent.push(sent);input.value='';n+=2;stop.hidden=false;
        list.insertAdjacentHTML('beforeend',`<div data-virtual-list-item-key="${n}"><div class="fbb737a4"></div></div><div data-virtual-list-item-key="${n+1}"><div class="ds-message"><div class="ds-think-content"><div class="ds-markdown"><p>THINK_SECRET 正在思考</p></div></div></div></div>`);
        list.querySelector(`[data-virtual-list-item-key="${n}"] .fbb737a4`).textContent=sent;
        const turn=list.querySelector(`[data-virtual-list-item-key="${n+1}"] .ds-message`);
        setTimeout(()=>{turn.querySelector('.ds-think-content .ds-markdown').innerHTML='<p>THINK_SECRET 思考完毕</p>';turn.insertAdjacentHTML('beforeend','<div class="ds-markdown ds-assistant-message-main-content"><p>回答：'+sent.split('\n')[0]+'</p><p>DS_FINAL</p></div>');},500);
        setTimeout(()=>{stop.hidden=true;turn.insertAdjacentHTML('afterend','<div><div role="button" data-testid="copy-button">复制</div></div>');},1100);};
      const box=document.querySelector('#chat-input');box.remove();setTimeout(()=>document.querySelector('main').prepend(box),1500);
    },
    prompt:'第一行 DS\n\n  缩进保留 <x> & y',
    expect:{text:['回答：第一行 DS','DS_FINAL'],absent:['THINK_SECRET'],mode:'深度思考'}
  },
  // 豆包 new chat: only the placeholder textarea is mounted at first; typing into it goes nowhere until the
  // tiptap editor loads (AI圆桌 Android 2026-09-23). The adapter must wait for the real editor.
  'doubao#transitional':{
    html:`<main><div id="list"></div><div class="composer"><textarea data-testid="chat_input_input" class="textarea-YelHeN"></textarea></div><button id="flow-end-msg-send" class="send-msg-btn" disabled></button></main>`,
    setup:()=>{
      const box=document.querySelector('.composer'),send=document.querySelector('#flow-end-msg-send'),list=document.querySelector('#list');let editor=null,n=0;
      setTimeout(()=>{editor=document.createElement('div');editor.className='tiptap ProseMirror';editor.contentEditable='true';box.append(editor);},1500);
      // Before the editor exists the placeholder swallows input; afterwards it hands the text over.
      document.querySelector('textarea').addEventListener('input',e=>{if(!editor)return;const text=e.target.value;setTimeout(()=>{editor.innerHTML=text.split('\n').map(line=>'<p>'+(line?line.replaceAll('&','&amp;').replaceAll('<','&lt;'):'<br>')+'</p>').join('');e.target.remove();send.disabled=false;},60);});
      send.onclick=()=>{const text=[...editor.children].map(p=>p.textContent).join('\n');window.sent.push(text);editor.innerHTML='<p><br></p>';send.disabled=true;n++;
        list.insertAdjacentHTML('beforeend',`<div data-testid="send_message"><div data-testid="message_content" data-message-id="u${n}"><div class="md-box-root"></div></div></div><div data-testid="receive_message"><div data-testid="message_content" data-message-id="a${n}"><div class="md-box-root" data-streaming="true"><p>正在回答</p></div></div><div data-foundation-type="receive-message-action-bar"></div></div>`);
        list.querySelector(`[data-message-id="u${n}"] .md-box-root`).textContent=text;
        setTimeout(()=>{const body=list.querySelector(`[data-message-id="a${n}"] .md-box-root`);body.innerHTML='<p>回答：'+text.split('\n')[0].replaceAll('<','&lt;')+'</p>';body.dataset.streaming='false';list.querySelector(`[data-message-id="a${n}"]`).parentElement.querySelector('[data-foundation-type="receive-message-action-bar"]').innerHTML='<button>复制</button>';},600);};
    },
    prompt:'第一行 过渡\n\n  缩进保留 <x> & y',
    expect:{text:['回答：第一行 过渡'],absent:['正在回答']}
  },
  // ChatGPT 2026-09-27 (logged in, live): composer "Send" button, turns as search units "…:user" / "…:assistant",
  // answer body [data-markdown-text-style], code blocks as div[data-markdown-copy="code-block"] without <pre>,
  // and the action row with "Regenerate response" only after the answer is complete.
  'chatgpt#2026-09-27':{
    html:`<main><div id="thread"></div><form><div class="ProseMirror" contenteditable="true" aria-label="Ask ChatGPT"></div>
      <button type="button" aria-label="Select ChatGPT model" data-codex-intelligence-trigger="true">Medium</button><button type="button" aria-label="Dictate"></button>
      <button type="submit" aria-label="Send">↑</button></form></main>`,
    setup:()=>{
      const input=document.querySelector('.ProseMirror'),thread=document.querySelector('#thread');let n=0;
      document.querySelector('form').addEventListener('submit',e=>e.preventDefault());
      // Like ProseMirror: a paste becomes one paragraph per line, and the message is the paragraphs joined.
      input.addEventListener('paste',e=>{e.preventDefault();const text=e.clipboardData.getData('text/plain');input.innerHTML=text.split('\n').map(line=>'<p>'+(line?line.replaceAll('&','&amp;').replaceAll('<','&lt;'):'<br>')+'</p>').join('');});
      document.querySelector('[aria-label="Send"]').onclick=()=>{const text=[...input.children].map(p=>p.textContent).join('\n');window.sent.push(text);input.innerHTML='';n++;
        const send=document.querySelector('[aria-label="Send"]');send.setAttribute('aria-label','Stop streaming');
        thread.insertAdjacentHTML('beforeend',`<div class="group flex flex-col"><div class="flex flex-col gap-3"><div><h4 class="sr-only">You said:</h4><div data-chatgpt-search-unit-key="t-${n}:0:user" data-chatgpt-search-message-ids="u-${n}"><div class="bg-user-message"><div class="whitespace-pre-wrap"></div></div><button aria-label="Copy message"></button></div></div><div><div data-chatgpt-search-unit-key="t-${n}:2:assistant" data-chatgpt-search-message-ids="a-${n}"><h4 class="sr-only">ChatGPT said:</h4><div data-markdown-text-style="assistant-message"><p>正在回答</p></div></div></div></div></div>`);
        const turn=thread.lastElementChild;turn.querySelector('.whitespace-pre-wrap').textContent=text;
        setTimeout(()=>{turn.querySelector('[data-markdown-text-style]').innerHTML='<p>回答：'+text.split('\n')[0].replaceAll('<','&lt;')+'</p><div><div data-markdown-copy="code-block"><div data-markdown-copy="exclude"><div class="truncate">Python</div></div><div dir="ltr"><code class="whitespace-pre! block"><span>def add(a, b):\n    return a + b</span></code></div></div></div><p>END_GPT</p>';},500);
        setTimeout(()=>{send.setAttribute('aria-label','Send');turn.insertAdjacentHTML('beforeend','<div class="turn-action-controls"><button aria-label="Copy"></button><button aria-label="Regenerate response"></button></div>');},1100);};
    },
    prompt:'第一行 GPT\n\n  缩进保留 <x> & y',
    expect:{text:['回答：第一行 GPT','```python\ndef add(a, b):\n    return a + b\n```','END_GPT'],absent:['ChatGPT said','正在回答','Python\n'],mode:'Medium'}
  },
  // ChatGPT 2026-09-29 (live): an earlier answer holds an editable email writing block (a ProseMirror "Start writing"
  // editor placed before the composer), an earlier question shows an edit box's own "Send", and the new answer's
  // writing block gets its body a few seconds after the answer ends. Only the composer may be typed into and sent.
  'chatgpt#writing-blocks':{
    html:`<main><div id="thread"><div class="group"><div data-chatgpt-search-unit-key="t-0:0:user" data-chatgpt-search-message-ids="u-0"><div class="whitespace-pre-wrap">旧问题</div><button aria-label="Send">编辑后发送</button></div>
      <div data-chatgpt-search-unit-key="t-0:2:assistant" data-chatgpt-search-message-ids="a-0"><div data-markdown-text-style="assistant-message"><p>旧回答</p>
      <div data-testid="chatgpt-writing-block" data-markdown-copy="rich-block" data-markdown-copy-text="旧邮件正文"><header><div>Email</div><button>Connect email</button></header><div class="ProseMirror" contenteditable="true" aria-label="Start writing"><p>旧邮件正文</p></div></div></div></div>
      <div class="turn-action-controls"><button aria-label="Regenerate response"></button></div></div></div>
      <form><div class="ProseMirror" contenteditable="true" aria-label="Ask ChatGPT"></div><button type="button" aria-label="Select ChatGPT model">Medium</button><button type="submit" aria-label="Send">↑</button></form></main>`,
    setup:()=>{
      const input=document.querySelector('[aria-label="Ask ChatGPT"]'),thread=document.querySelector('#thread'),old=document.querySelector('[aria-label="Start writing"]');let n=0;
      document.querySelector('form').addEventListener('submit',e=>e.preventDefault());
      for(const editor of [input,old])editor.addEventListener('paste',e=>{e.preventDefault();const text=e.clipboardData.getData('text/plain');editor.innerHTML=text.split('\n').map(line=>'<p>'+(line?line.replaceAll('&','&amp;').replaceAll('<','&lt;'):'<br>')+'</p>').join('');});
      document.querySelector('[data-chatgpt-search-unit-key="t-0:0:user"] [aria-label="Send"]').onclick=()=>window.sent.push('EDIT-BOX-SEND:'+old.innerText);
      const send=document.querySelector('form [aria-label="Send"]');
      send.onclick=()=>{const text=[...input.children].map(p=>p.textContent).join('\n');window.sent.push(text);window.oldEmail=old.innerText;input.innerHTML='';n++;send.setAttribute('aria-label','Stop streaming');
        thread.insertAdjacentHTML('beforeend',`<div class="group"><div data-chatgpt-search-unit-key="t-${n}:0:user" data-chatgpt-search-message-ids="u-${n}"><div class="whitespace-pre-wrap"></div></div><div data-chatgpt-search-unit-key="t-${n}:2:assistant" data-chatgpt-search-message-ids="a-${n}"><div data-markdown-text-style="assistant-message"><p>正在回答</p></div></div></div>`);
        const turn=thread.lastElementChild;turn.querySelector('.whitespace-pre-wrap').textContent=text;
        setTimeout(()=>{turn.querySelector('[data-markdown-text-style]').innerHTML='<p>INTRO_LINE</p><div data-testid="chatgpt-writing-block" data-markdown-copy="rich-block"><header><div>Email</div><button>Connect email</button></header><div><span>Recipients</span></div><div><textarea>SUBJECT_LINE</textarea></div><div data-markdown-copy-content="true"><div role="textbox"></div></div></div><div><button><span>增加后续建议</span></button></div><p>OUTRO_LINE</p>';},400);
        setTimeout(()=>{send.setAttribute('aria-label','Send');turn.insertAdjacentHTML('beforeend','<div class="turn-action-controls"><button aria-label="Regenerate response"></button></div>');},900);
        // The body arrives well after the end signal, as observed live in background tabs.
        setTimeout(()=>{const wb=turn.querySelector('[data-testid="chatgpt-writing-block"]');wb.setAttribute('data-markdown-copy-text','EMAIL_BODY 第一行\n\n第二行');wb.querySelector('[role="textbox"]').innerHTML='<p>EMAIL_BODY 第一行</p><p>第二行</p>';},4200);};
    },
    prompt:'新问题 WB\n\n  第二段',
    expect:{text:['INTRO_LINE','**SUBJECT_LINE**','EMAIL_BODY 第一行\n\n第二行','OUTRO_LINE'],absent:['Connect email','Recipients','增加后续建议','正在回答','旧邮件正文'],mode:'Medium',check:async page=>{assert.equal(await page.evaluate(()=>window.oldEmail),'旧邮件正文','the earlier email block is untouched');}}
  },
  // No usable send button: sites verified to send on Enter get a scripted Enter; the watcher still confirms the turn.
  'chatgpt#enter-only':{
    html:`<main><div id="thread"></div><form><div class="ProseMirror" contenteditable="true" aria-label="Ask ChatGPT"></div><button type="button" aria-label="Dictate"></button></form></main>`,
    setup:()=>{
      const input=document.querySelector('[aria-label="Ask ChatGPT"]'),thread=document.querySelector('#thread');let n=0;
      input.addEventListener('paste',e=>{e.preventDefault();const text=e.clipboardData.getData('text/plain');input.innerHTML=text.split('\n').map(line=>'<p>'+(line?line.replaceAll('&','&amp;').replaceAll('<','&lt;'):'<br>')+'</p>').join('');});
      input.addEventListener('keydown',e=>{if(e.key!=='Enter'||e.shiftKey||e.isComposing)return;e.preventDefault();const text=[...input.children].map(p=>p.textContent).join('\n');if(!text.trim())return;window.sent.push(text);input.innerHTML='';n++;
        thread.insertAdjacentHTML('beforeend',`<div class="group"><div data-chatgpt-search-unit-key="t-${n}:0:user" data-chatgpt-search-message-ids="u-${n}"><div class="whitespace-pre-wrap"></div></div><div data-chatgpt-search-unit-key="t-${n}:2:assistant" data-chatgpt-search-message-ids="a-${n}"><div data-markdown-text-style="assistant-message"><p>回答：ENTER_OK</p></div></div></div>`);
        thread.lastElementChild.querySelector('.whitespace-pre-wrap').textContent=text;
        setTimeout(()=>thread.lastElementChild.insertAdjacentHTML('beforeend','<div class="turn-action-controls"><button aria-label="Regenerate response"></button></div>'),500);});
    },
    prompt:'回车发送 ENTER',
    expect:{text:['回答：ENTER_OK'],absent:[]}
  },
  qwen:{
    html:`<div class="chat-room-outer-wrap"><div id="list"></div>
      <div role="textbox" aria-multiline="true" data-slate-editor="true" data-slate-node="value" contenteditable="true" id="editor"></div>
      <button type="button" aria-label="添加附件"></button><button type="button">Qwen3.7-千问</button><button type="button" aria-label="快速">快速</button><button type="button" aria-label="发送消息" data-session-switch-target="send-query"></button><button type="button" aria-label="停止回答" hidden></button></div>`,
    setup:()=>{
      const editor=document.querySelector('#editor'),send=document.querySelector('[aria-label="发送消息"]'),stop=document.querySelector('[aria-label="停止回答"]'),list=document.querySelector('#list');let model='',n=0;
      // Slate: one element block per line; an empty line (and the empty editor) is a zero-width span with a <br>.
      const block=line=>`<div data-slate-node="element"><span data-slate-node="text"><span data-slate-leaf="true">${line?'<span data-slate-string="true"></span>':'<span data-slate-zero-width="n" data-slate-length="0">﻿<br></span>'}</span></span></div>`;
      const render=()=>{if(!model){editor.innerHTML='<div data-slate-node="element"><span data-slate-node="text"><span data-slate-leaf="true"><span data-slate-placeholder="true" contenteditable="false">向千问提问</span><span data-slate-zero-width="n" data-slate-length="0">﻿<br></span></span></span></div>';return;}const lines=model.split('\n');editor.innerHTML=lines.map(block).join('');[...editor.querySelectorAll('[data-slate-string]')].forEach((s,i)=>{s.textContent=lines.filter(Boolean)[i];});};
      render();
      editor.addEventListener('paste',e=>{e.preventDefault();model+=e.clipboardData.getData('text/plain');render();});
      send.onclick=()=>{
        const sent=model;window.sent.push(sent);model='';render();send.disabled=true;stop.hidden=false;n++;const id='chat-'+n;
        const round=document.createElement('div');round.className='chat-round last-message-item';round.dataset.chat=id;
        round.innerHTML=`<div class="chat-question-wrap"><div class="chat-question-card-wrap" data-chat-question-wrap="${id}"><div class="message-card-wrap question"><div class="question-text-card"></div></div><div class="qs-bottom"><div class="qs-bottom-icon"><svg></svg></div></div></div></div><div data-chat-answers-wrap="${id}" class="chat-answers-card-wrap"><div><div class="answer-common-card"><div class="markdown-pc-special-class"><div class="qk-markdown"><div class="qk-md-paragraph"><span class="qk-md-text">正在回答</span></div></div></div></div></div></div>`;
        round.querySelector('.question-text-card').textContent=sent;list.append(round);
        setTimeout(()=>{
          round.querySelector('.qk-markdown').innerHTML='<div class="qk-md-paragraph"><span class="qk-md-text complete">回答：'+sent.split('\n')[0]+'</span></div><div class="qw-md-code"><div class="rounded"><div class="h-[36px] sticky top-0"><div><span class="font-medium">python</span><div><button type="button"><span>编辑</span></button></div></div></div><div class="codeHighlighterWrapper"><pre><code><span><span class="linenumber react-syntax-highlighter-line-number">1</span><span class="token">print</span><span class="token">("CODE_OK")</span></span></code></pre></div></div></div><div class="qk-md-paragraph"><span class="qk-md-text complete">END_QWEN</span></div><div class="video_note_list-AbC12">相关视频推荐 NOISE_CARD</div>';
          stop.hidden=true;send.disabled=false;
          const bar=document.createElement('div');bar.dataset.answerFeedbackToolbar='true';bar.innerHTML='<div class="flex"><div>复制</div></div>';round.querySelector('[data-chat-answers-wrap] > div').append(bar);
        },900);
      };
    },
    prompt:'第一行 千问\n\n  缩进保留 <x> & y',
    expect:{text:['回答：第一行 千问','```python\nprint("CODE_OK")\n```','END_QWEN'],absent:['NOISE_CARD','编辑','1print','正在回答'],mode:'Qwen3.7-千问 快速'}
  }
};

for(const [key,spec] of Object.entries(PAGES)){
 const provider=key.split('#')[0];
 test(`${key} adapter sends once, reads the full answer and sees the completion marker`,async()=>{
  const browser=await chromium.launch({channel:'chromium',headless:true});
  try{
   const page=await browser.newPage();
   await page.setContent(spec.html);
   await page.evaluate(()=>{window.sent=[];window.events=[];window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.listener=fn;}},sendMessage:async e=>{events.push(e);return {ok:true};}}};window.request=message=>new Promise(resolve=>listener(message,{id:'test'},resolve));});
   await page.evaluate(spec.setup);
   for(const name of ['adapters.js','content.js'])await page.addScriptTag({content:source(name)});
   const prep=await page.evaluate(p=>request({type:'YZ_PREPARE',provider:p}),provider);assert.equal(prep.ok,true,prep.error);
   if('mode' in spec.expect)assert.equal(prep.mode,spec.expect.mode,provider+' reads the model / mode shown by the site');
   const sent=await page.evaluate(({p,prompt,baseline})=>request({type:'YZ_SEND',provider:p,requestId:'live-'+p,prompt,baseline}),{p:provider,prompt:spec.prompt,baseline:prep.baseline});
   assert.equal(sent.ok,true,sent.error);
   assert.deepEqual(await page.evaluate(()=>window.sent),[spec.prompt],provider+' must deliver the exact prompt once');
   await page.waitForFunction(()=>window.events.some(e=>['done','attention'].includes(e.status)),{},{timeout:15000});
   const done=await page.evaluate(()=>window.events.find(e=>['done','attention'].includes(e.status)));
   assert.equal(done.status,'done',provider+' must finish from its completion signal: '+done.error);
   for(const part of spec.expect.text)assert(done.text.includes(part),provider+' answer must include '+JSON.stringify(part)+' — got: '+JSON.stringify(done.text));
   for(const part of spec.expect.absent)assert(!done.text.includes(part),provider+' answer must not include '+JSON.stringify(part)+' — got: '+JSON.stringify(done.text));
   if(spec.expect.check)await spec.expect.check(page);
   await page.evaluate(p=>request({type:'YZ_STOP',requestId:'live-'+p}),provider);
   const d=await page.evaluate(()=>__yuanzhuoLite.diagnostics);assert.equal(d.observers,0);assert.equal(d.timers,0);
   // A second prompt must not be confused with the first answer.
   const again=await page.evaluate(p=>request({type:'YZ_PREPARE',provider:p}),provider);assert.equal(again.ok,true,again.error);
  }finally{await browser.close();}
 });
}
