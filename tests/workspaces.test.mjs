import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaces} from '../src/workspaces.js';
import {newSession,PROVIDERS,DEFAULT_MEMBERS,providerFor} from '../src/core.js';

function harness(){
  const first=newSession([...DEFAULT_MEMBERS]),sessions=new Map([[first.id,first]]),data={},windows=new Map([[1,{id:1}]]),tabs=new Map();let nextWindow=2,nextTab=10,created=0;
  const chrome={runtime:{getURL:p=>'chrome-extension://test/'+p},storage:{session:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,structuredClone(value))}},windows:{get:async id=>{if(!windows.has(id))throw Error('No window with id: '+id);return windows.get(id);},create:async({url})=>{const w={id:nextWindow++};windows.set(w.id,w);tabs.set(nextTab,{id:nextTab++,windowId:w.id,url});created++;return w;},update:async()=>{}},tabs:{get:async id=>{if(!Number.isInteger(id))throw Error('No matching signature');if(!tabs.has(id))throw Error('No tab');return tabs.get(id);},query:async({windowId})=>[...tabs.values()].filter(t=>t.windowId===windowId),create:async({windowId,url})=>{const t={id:nextTab++,windowId,url};tabs.set(t.id,t);return t;},update:async id=>tabs.get(id)}};
  const api=createWorkspaces(chrome,{loadSession:async id=>{if(!sessions.has(id))throw Error('session absent');return sessions.get(id);},createSession:async members=>{if(sessions.size>=30)throw Error('capacity exceeded');const s=newSession(members);sessions.set(s.id,s);return s;},mutate:async(id,fn)=>fn(sessions.get(id)),getIndex:()=>({currentId:first.id,sessions:[...sessions.values()].map(s=>({id:s.id}))}),providers:PROVIDERS,providerFor});
  return {api,chrome,first,sessions,data,windows,tabs,get created(){return created;}};
}
test('One window cannot claim two roundtables; a session cannot belong to two windows',async()=>{const h=harness();assert.equal(await h.api.claim(1),h.first.id);const other=newSession([...DEFAULT_MEMBERS]);h.sessions.set(other.id,other);await assert.rejects(()=>h.api.claim(1,other.id),/已有另一场/);h.windows.set(2,{id:2});await assert.rejects(()=>h.api.claim(2,h.first.id),/另一个窗口/);});
test('Parallel reopening uses one window and preserves all saved answers',async()=>{const h=harness();h.first.rounds=[{id:'history',prompt:'Original',jobs:[{text:'FULL'.repeat(50000)}]}];const before=structuredClone(h.first.rounds),opened=await Promise.all([h.api.main(h.first.id),h.api.main(h.first.id)]);assert.equal(opened[0].windowId,opened[1].windowId);assert.equal(h.created,1);assert.deepEqual(h.first.rounds,before);});
test('URL-only legacy bindings are never passed to tabs.get and stale IDs cannot be adopted',async()=>{const h=harness();h.first.bindings={deepseek:{url:PROVIDERS.deepseek.url}};const id=await h.api.claim(1);assert.notEqual(id,h.first.id);h.windows.set(2,{id:2});h.first.bindings={deepseek:{tabId:12,url:PROVIDERS.deepseek.url}};h.tabs.set(12,{id:12,windowId:1,url:PROVIDERS.deepseek.url});await h.api.claim(2,h.first.id);assert.equal(h.first.bindings.deepseek.tabId,undefined);});
test('Window loss and moved member tabs fail closed without choosing another current window',async()=>{const h=harness();await h.api.claim(1);await assert.rejects(()=>h.api.validateTab(h.first.id,{windowId:2}),/移到其他窗口/);h.windows.delete(1);await assert.rejects(()=>h.api.requireWindow(h.first.id),/No window/);await h.api.forget(1);await assert.rejects(()=>h.api.validateTab(h.first.id,{windowId:2}),/已关闭或尚未绑定/);assert.equal(h.created,0);});
test('At the 30-roundtable limit, closed history remains reachable after restart',async()=>{const h=harness();while(h.sessions.size<30){const s=newSession([...DEFAULT_MEMBERS]);h.sessions.set(s.id,s);}h.first.bindings={deepseek:{tabId:404,url:PROVIDERS.deepseek.url}};h.first.rounds=[{id:'original',prompt:'must remain accessible',jobs:[]}];assert.equal(await h.api.claim(1),h.first.id);assert.equal(h.sessions.size,30);assert.equal(h.first.rounds[0].prompt,'must remain accessible');assert.equal(h.first.bindings.deepseek.tabId,undefined);});

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
