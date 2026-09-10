import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackgroundSupport} from '../src/background-support.js';

function fake({failFocus=false,failAttach=false}={}){
 const calls=[],attached=new Set(),data={},sessionData={},tabs=new Map([[1,{id:1,url:'https://chat.deepseek.com/a/chat/s/test',autoDiscardable:true}],[2,{id:2,url:'https://www.kimi.com/chat/test',autoDiscardable:false}]]);let detachListener,updateListener;
 const area=data=>({get:async key=>({[key]:data[key]}),set:async obj=>Object.assign(data,structuredClone(obj)),remove:async key=>{delete data[key];}});
 const chrome={storage:{session:area(sessionData),local:area(data)},tabs:{get:async id=>{if(!tabs.has(id))throw Error('No tab with id: '+id);return {...tabs.get(id)};},update:async(id,options)=>{calls.push(['tab',id,options]);Object.assign(tabs.get(id),options);},onUpdated:{addListener:fn=>{updateListener=fn;}}},debugger:{getTargets:async()=>[...tabs.values()].map(t=>({tabId:t.id,id:t.targetId||'target-'+t.id,type:'page'})),attach:async({tabId})=>{calls.push(['attach',tabId]);if(failAttach)throw Error('Another debugger is already attached');attached.add(tabId);},sendCommand:async({tabId},method,params)=>{calls.push([method,tabId,params]);if(failFocus&&method==='Emulation.setFocusEmulationEnabled'&&params.enabled)throw Error('focus unavailable');},detach:async({tabId})=>{calls.push(['detach',tabId]);attached.delete(tabId);},onDetach:{addListener:fn=>{detachListener=fn;}}}};
 const lost=[],errors=[],manager=createBackgroundSupport(chrome,{onLost:async e=>lost.push(e),onError:e=>errors.push(e.message)});
 return {manager,chrome,calls,attached,tabs,data,sessionData,lost,errors,cancel:(id)=>{attached.delete(id);detachListener({tabId:id},'canceled_by_user');},navigate:(id,url)=>{tabs.get(id).url=url;updateListener(id,{url},tabs.get(id));}};
}
test('Only a claimed AI tab receives focus support, and original discard policy is restored',async()=>{
 const h=fake();await h.manager.ready;await h.manager.acquire(1,'one','deepseek');assert(h.attached.has(1));assert.equal(h.tabs.get(1).autoDiscardable,false);assert(h.calls.some(c=>c[0]==='Emulation.setFocusEmulationEnabled'&&c[2].enabled));assert(!h.calls.some(c=>c[1]===2));assert(!h.calls.some(c=>c[0]==='tab'&&'active' in c[2]));await h.manager.release(1,'one');assert.equal(h.attached.size,0);assert.equal(h.tabs.get(1).autoDiscardable,true);
 await h.manager.acquire(2,'two','kimi');await h.manager.release(2,'two');assert.equal(h.tabs.get(2).autoDiscardable,false);
});
test('Focus or attach failure rejects the request and restores all acquired resources',async()=>{
 for(const options of [{failFocus:true},{failAttach:true}]){const h=fake(options);await h.manager.ready;await assert.rejects(()=>h.manager.acquire(1,'one','deepseek'),/focus unavailable|Another debugger/);assert.equal(h.attached.size,0);assert.equal(h.tabs.get(1).autoDiscardable,true);}
});
test('Lease identity prevents stale completion releasing a newer request; a busy tab cannot be stolen',async()=>{
 const h=fake();await h.manager.ready;await h.manager.acquire(1,'one','deepseek');await assert.rejects(()=>h.manager.acquire(1,'two','deepseek'),/进行中/);await h.manager.release(1,'one');await h.manager.acquire(1,'two','deepseek');await h.manager.release(1,'one');assert(h.attached.has(1));await h.manager.release(1,'two');assert.equal(h.attached.size,0);
});
test('User cancellation reports loss without silently reattaching or resending',async()=>{
 const h=fake();await h.manager.ready;await h.manager.acquire(1,'one','deepseek');h.cancel(1);await h.manager.idle();assert.equal(h.lost.length,1);assert.equal(h.lost[0].requestId,'one');assert.equal(h.calls.filter(c=>c[0]==='attach').length,1);assert.equal(h.tabs.get(1).autoDiscardable,true);
});
test('Non-provider navigation releases support and reports the affected request',async()=>{
 const h=fake();await h.manager.ready;await h.manager.acquire(1,'one','deepseek');h.navigate(1,'https://example.org/');await h.manager.idle();assert.equal(h.lost.length,1);assert.equal(h.attached.size,0);assert.equal(h.tabs.get(1).autoDiscardable,true);
 await assert.rejects(()=>h.manager.acquire(1,'two','deepseek'),/网站/);
});
test('Startup restores persisted interrupted leases before accepting a new request',async()=>{
 const h=fake();await h.manager.ready;await h.manager.acquire(1,'one','deepseek');const restarted=createBackgroundSupport(h.chrome,{onLost:async e=>h.lost.push(e),onError:e=>h.errors.push(e.message)});await restarted.ready;assert.equal(h.attached.size,0);assert.equal(h.tabs.get(1).autoDiscardable,true);assert(h.lost.some(e=>e.requestId==='one'));await restarted.acquire(1,'two','deepseek');await restarted.release(1,'two');
});

test('Extension reload clears session storage but still restores true and false discard policies before new work',async()=>{
 const h=fake();await h.manager.ready;await h.manager.acquire(1,'one','deepseek');await h.manager.acquire(2,'two','kimi');
 for(const key of Object.keys(h.sessionData))delete h.sessionData[key];h.attached.clear();
 const restarted=createBackgroundSupport(h.chrome,{onLost:async e=>h.lost.push(e),onError:e=>h.errors.push(e.message)});await restarted.ready;
 assert.equal(h.tabs.get(1).autoDiscardable,true,'Reload must not leave a previously discardable tab pinned');assert.equal(h.tabs.get(2).autoDiscardable,false);assert.equal(h.lost.length,2);assert.deepEqual(h.data['arena.background.leases'],[]);
});

test('A persisted lease cannot detach or modify a reused tab ID with a different debugger target',async()=>{
 const h=fake();await h.manager.ready;await h.manager.acquire(1,'one','deepseek');h.tabs.get(1).targetId='new-browser-target';h.attached.clear();const before=h.calls.length;
 const restarted=createBackgroundSupport(h.chrome,{onLost:async e=>h.lost.push(e),onError:e=>h.errors.push(e.message)});await restarted.ready;
 assert.deepEqual(h.calls.slice(before),[],'Stale tab identity must not touch the replacement page');assert.equal(h.tabs.get(1).autoDiscardable,false);assert.deepEqual(h.data['arena.background.leases'],[]);assert.equal(h.lost.length,1);
});

test('A target lookup failure retains every recovery record and permits a later cleanup retry',async()=>{
 const h=fake();await h.manager.ready;await h.manager.acquire(1,'one','deepseek');await h.manager.acquire(2,'two','kimi');const lookup=h.chrome.debugger.getTargets;
 h.chrome.debugger.getTargets=async()=>{throw Error('temporary target lookup failure');};const before=h.calls.length;
 const restarted=createBackgroundSupport(h.chrome,{onLost:async e=>h.lost.push(e),onError:e=>h.errors.push(e.message)});await restarted.ready;
 assert.deepEqual(h.calls.slice(before),[]);assert.equal(h.data['arena.background.leases'].length,2);assert.equal(h.errors.length,2);assert(h.errors.every(e=>e.includes('lookup failure')));
 h.chrome.debugger.getTargets=lookup;await restarted.reconcile(async()=>false);assert.deepEqual(h.data['arena.background.leases'],[]);assert.equal(h.tabs.get(1).autoDiscardable,true);assert.equal(h.tabs.get(2).autoDiscardable,false);
});

test('Failure to persist the original discard setting blocks all tab mutation and debugger attachment',async()=>{
 const h=fake();await h.manager.ready;const set=h.chrome.storage.local.set;let first=true;h.chrome.storage.local.set=async value=>{if(first){first=false;throw Error('local storage unavailable');}return set(value);};
 await assert.rejects(()=>h.manager.acquire(1,'one','deepseek'),/local storage unavailable/);assert.deepEqual(h.calls,[]);assert.equal(h.tabs.get(1).autoDiscardable,true);assert.equal(h.attached.size,0);
});
test('A transient cleanup failure preserves other persisted leases and leaves recovery usable',async()=>{
 const h=fake();await h.manager.ready;await h.manager.acquire(1,'one','deepseek');await h.manager.acquire(2,'two','kimi');
 const detach=h.chrome.debugger.detach;let failed=false;h.chrome.debugger.detach=async target=>{if(target.tabId===1&&!failed){failed=true;throw Error('temporary detach failure');}return detach(target);};
 const restarted=createBackgroundSupport(h.chrome,{onLost:async e=>h.lost.push(e),onError:e=>h.errors.push(e.message)});
 await assert.doesNotReject(()=>restarted.ready);assert(h.attached.has(1));assert(!h.attached.has(2));assert.deepEqual(h.data['arena.background.leases'].map(x=>x.tabId),[1]);assert.equal(h.lost.length,2);assert.equal(h.errors.length,1);
 await restarted.reconcile(async()=>false);assert.equal(h.attached.size,0);assert.deepEqual(h.data['arena.background.leases'],[]);
});
