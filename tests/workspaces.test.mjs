import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaces} from '../src/workspaces.js';
import {newSession,PROVIDERS,DEFAULT_MEMBERS,MAX_SESSIONS,providerFor} from '../src/core.js';

function harness(){
  const first=newSession([...DEFAULT_MEMBERS]),sessions=new Map([[first.id,first]]),data={},windows=new Map([[1,{id:1}]]),tabs=new Map();let nextWindow=2,nextTab=10,created=0;
  const chrome={runtime:{getURL:p=>'chrome-extension://test/'+p},storage:{session:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,structuredClone(value))}},windows:{get:async id=>{if(!windows.has(id))throw Error('No window with id: '+id);return windows.get(id);},create:async({url})=>{const w={id:nextWindow++};windows.set(w.id,w);tabs.set(nextTab,{id:nextTab++,windowId:w.id,url});created++;return w;},update:async()=>{}},tabs:{get:async id=>{if(!Number.isInteger(id))throw Error('No matching signature');if(!tabs.has(id))throw Error('No tab');return tabs.get(id);},query:async({windowId})=>[...tabs.values()].filter(t=>t.windowId===windowId),create:async({windowId,url})=>{const t={id:nextTab++,windowId,url};tabs.set(t.id,t);return t;},update:async id=>tabs.get(id)}};
  const api=createWorkspaces(chrome,{loadSession:async id=>{if(!sessions.has(id))throw Error('session absent');return sessions.get(id);},createSession:async members=>{if(sessions.size>=MAX_SESSIONS)throw Error('capacity exceeded');const s=newSession(members);sessions.set(s.id,s);return s;},mutate:async(id,fn)=>fn(sessions.get(id)),getIndex:()=>({currentId:first.id,sessions:[...sessions.values()].map(s=>({id:s.id}))}),providers:PROVIDERS,providerFor});
  return {api,chrome,first,sessions,data,windows,tabs,get created(){return created;}};
}
test('One window cannot claim two roundtables; a session cannot belong to two windows',async()=>{const h=harness();assert.equal(await h.api.claim(1),h.first.id);const other=newSession([...DEFAULT_MEMBERS]);h.sessions.set(other.id,other);await assert.rejects(()=>h.api.claim(1,other.id),/已有另一场/);h.windows.set(2,{id:2});await assert.rejects(()=>h.api.claim(2,h.first.id),/另一个窗口/);});
test('Parallel reopening uses one window and preserves all saved answers',async()=>{const h=harness();h.first.rounds=[{id:'history',prompt:'Original',jobs:[{text:'FULL'.repeat(50000)}]}];const before=structuredClone(h.first.rounds),opened=await Promise.all([h.api.main(h.first.id),h.api.main(h.first.id)]);assert.equal(opened[0].windowId,opened[1].windowId);assert.equal(h.created,1);assert.deepEqual(h.first.rounds,before);});
test('URL-only legacy bindings are never passed to tabs.get and stale IDs cannot be adopted',async()=>{const h=harness();h.first.bindings={deepseek:{url:PROVIDERS.deepseek.url}};const id=await h.api.claim(1);assert.notEqual(id,h.first.id);h.windows.set(2,{id:2});h.first.bindings={deepseek:{tabId:12,url:PROVIDERS.deepseek.url}};h.tabs.set(12,{id:12,windowId:1,url:PROVIDERS.deepseek.url});await h.api.claim(2,h.first.id);assert.equal(h.first.bindings.deepseek.tabId,undefined);});
test('Window loss and moved member tabs fail closed without choosing another current window',async()=>{const h=harness();await h.api.claim(1);await assert.rejects(()=>h.api.validateTab(h.first.id,{windowId:2}),/移到其他窗口/);h.windows.delete(1);await assert.rejects(()=>h.api.requireWindow(h.first.id),/No window/);await h.api.forget(1);await assert.rejects(()=>h.api.validateTab(h.first.id,{windowId:2}),/已关闭或尚未绑定/);assert.equal(h.created,0);});
test('At the saved-roundtable limit, closed history remains reachable after restart',async()=>{const h=harness();while(h.sessions.size<MAX_SESSIONS){const s=newSession([...DEFAULT_MEMBERS]);h.sessions.set(s.id,s);}h.first.bindings={deepseek:{tabId:404,url:PROVIDERS.deepseek.url}};h.first.rounds=[{id:'original',prompt:'must remain accessible',jobs:[]}];assert.equal(await h.api.claim(1),h.first.id);assert.equal(h.sessions.size,MAX_SESSIONS);assert.equal(h.first.rounds[0].prompt,'must remain accessible');assert.equal(h.first.bindings.deepseek.tabId,undefined);});

test('Sidebar-first browser restart restores this window from its main Tab before global current session',async()=>{
  for(const pending of [false,true]){
    const h=harness(),second=newSession([...DEFAULT_MEMBERS]);h.sessions.set(second.id,second);h.windows.set(2,{id:2});
    h.first.bindings={deepseek:{tabId:7,url:PROVIDERS.deepseek.url}};
    h.tabs.set(7,{id:7,windowId:1,url:PROVIDERS.deepseek.url});
    const main='chrome-extension://test/main.html?session='+second.id;
    h.tabs.set(8,{id:8,windowId:2,...pending?{url:'chrome://newtab/',pendingUrl:main}:{url:main}});
    second.bindings={kimi:{tabId:404,url:PROVIDERS.kimi.url}};second.rounds=[{id:'saved',prompt:'Preserved second roundtable',jobs:[]}];
    h.tabs.set(9,{id:9,windowId:2,url:PROVIDERS.kimi.url});
    assert.equal(await h.api.claim(2),second.id);
    assert.equal(await h.api.claim(2,second.id),second.id);
    assert.equal(h.sessions.size,2);assert.equal(second.bindings.kimi.tabId,9);assert.equal(second.rounds[0].prompt,'Preserved second roundtable');
    assert.equal(await h.api.claim(1),h.first.id);assert.equal(await h.api.owner(second.id),2);
  }
});

test('Restored main Tabs reject conflicting, deleted or already owned roundtables without creating replacements',async()=>{
  const h=harness(),second=newSession([...DEFAULT_MEMBERS]);h.sessions.set(second.id,second);
  h.tabs.set(7,{id:7,windowId:1,url:'chrome-extension://test/main.html?session='+h.first.id});
  h.tabs.set(8,{id:8,windowId:1,url:'chrome-extension://test/main.html?session='+second.id});
  await assert.rejects(()=>h.api.claim(1),/多场圆桌/);assert.equal(await h.api.ownerForWindow(1),null);
  h.tabs.delete(8);h.tabs.get(7).url='chrome-extension://test/main.html?session=deleted';
  await assert.rejects(()=>h.api.claim(1),/session absent/);assert.equal(await h.api.ownerForWindow(1),null);
  h.tabs.get(7).url='chrome-extension://test/main.html?session='+h.first.id;
  assert.equal(await h.api.claim(1),h.first.id);
  h.windows.set(2,{id:2});h.tabs.set(8,{id:8,windowId:2,url:h.tabs.get(7).url});
  await assert.rejects(()=>h.api.claim(2),/另一个窗口/);assert.equal(h.sessions.size,2);
});

test('Restart rebinding ignores site query parameters but never adopts a different conversation',async()=>{
  const h=harness(),conversation='https://www.kimi.com/chat/1a0b01b5-real';
  h.first.bindings={kimi:{tabId:404,url:conversation},deepseek:{tabId:405,url:'https://chat.deepseek.com/a/chat/s/own'}};
  // Kimi appends ?chat_enter_method=... to the live tab URL after navigation.
  h.tabs.set(21,{id:21,windowId:1,url:conversation+'?chat_enter_method=home'});
  h.tabs.set(22,{id:22,windowId:1,url:'https://chat.deepseek.com/a/chat/s/other?x=1'});
  h.tabs.set(23,{id:23,windowId:1,url:'chrome-extension://test/main.html?session='+h.first.id});
  assert.equal(await h.api.claim(1),h.first.id);
  assert.equal(h.first.bindings.kimi.tabId,21);assert.equal(h.first.bindings.kimi.url,conversation);
  assert.equal(h.first.bindings.deepseek.tabId,undefined);
});

test('An extension update reopens each owned main page in its original window and keeps member bindings',async()=>{
  const {createWorkspaces:make}=await import('../src/workspaces.js');
  const first=newSession([...DEFAULT_MEMBERS]),second=newSession([...DEFAULT_MEMBERS]),sessions=new Map([[first.id,first],[second.id,second]]);
  const session={},local={},windows=new Map([[1,{id:1}],[2,{id:2}]]),tabs=new Map([[4,{id:4,windowId:1,url:PROVIDERS.kimi.url}],[5,{id:5,windowId:1,url:PROVIDERS.kimi.url}]]);let nextTab=10;
  const area=store=>({get:async key=>({[key]:store[key]}),set:async value=>Object.assign(store,structuredClone(value))});
  const chrome={runtime:{getURL:p=>'chrome-extension://test/'+p},storage:{session:area(session),local:area(local)},windows:{get:async id=>{if(!windows.has(id))throw Error('No window with id: '+id);return windows.get(id);}},tabs:{query:async({windowId})=>[...tabs.values()].filter(t=>t.windowId===windowId),create:async({windowId,url,active})=>{const t={id:nextTab++,windowId,url,active};tabs.set(t.id,t);return t;},get:async id=>tabs.get(id)}};
  const deps={loadSession:async id=>{if(!sessions.has(id))throw Error('session absent');return sessions.get(id);},createSession:async()=>{throw Error('must not create');},mutate:async(id,fn)=>fn(sessions.get(id)),getIndex:()=>({currentId:first.id,sessions:[...sessions.values()].map(s=>({id:s.id}))}),providers:PROVIDERS,providerFor};
  // Another Kimi tab on the same landing page sits earlier in the window; the binding must stay on tab 5.
  first.bindings={kimi:{tabId:5,url:PROVIDERS.kimi.url}};
  const before=make(chrome,deps);assert.equal(await before.claim(1,first.id),first.id);assert.equal(await before.claim(2,second.id),second.id);
  // Reload: session storage and main pages are gone; windows, member tabs and the local mirror remain.
  for(const k of Object.keys(session))delete session[k];windows.delete(2);
  const after=make(chrome,deps);
  assert.deepEqual(await after.restoreAfterReload(),[1]);
  assert.equal(await after.ownerForWindow(1),first.id);assert.equal(await after.ownerForWindow(2),null);
  const reopened=[...tabs.values()].filter(t=>t.url.startsWith('chrome-extension://test/main.html'));
  assert.deepEqual(reopened.map(t=>[t.windowId,t.url,t.active]),[[1,'chrome-extension://test/main.html?session='+encodeURIComponent(first.id),false]]);
  assert.equal(first.bindings.kimi.tabId,5);
  // Running it again does not open a second main page.
  await after.restoreAfterReload();assert.equal([...tabs.values()].filter(t=>t.url.startsWith('chrome-extension://test/main.html')).length,1);
});
test('A window can move to another roundtable in place, but never take one open in another window',async()=>{
  const h=harness();assert.equal(await h.api.claim(1),h.first.id);const other=newSession([...DEFAULT_MEMBERS]);h.sessions.set(other.id,other);
  assert.equal(await h.api.assign(1,other.id),h.first.id);assert.equal(await h.api.ownerForWindow(1),other.id);assert.equal(await h.api.owner(h.first.id),null);
  h.windows.set(2,{id:2});await assert.rejects(()=>h.api.assign(2,other.id),/另一个窗口/);assert.deepEqual(await h.api.snapshot(),{[other.id]:1});
  await assert.rejects(()=>h.api.assign(1,'missing'),/session absent/);
});
test('After an extension reload the bound tab is kept when it moved from a new-chat page into its chat; other chats are not adopted',async()=>{
  const h=harness();
  h.first.bindings={chatgpt:{tabId:21,url:'https://chatgpt.com/'},deepseek:{tabId:22,url:'https://chat.deepseek.com/a/chat/s/saved'}};
  h.tabs.set(21,{id:21,windowId:1,url:'https://chatgpt.com/c/created-by-send'});
  h.tabs.set(22,{id:22,windowId:1,url:'https://chat.deepseek.com/a/chat/s/someone-else'});
  assert.equal(await h.api.claim(1),h.first.id);
  assert.equal(h.first.bindings.chatgpt.tabId,21,'new chat that became a conversation stays bound');
  assert.equal(h.first.bindings.deepseek.tabId,undefined,'a saved chat that now shows another chat is not adopted');
});
