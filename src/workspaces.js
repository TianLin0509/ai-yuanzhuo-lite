// Window ownership is browser-session state. Durable answers never depend on a tab ID.
import {cleanUrl,DEFAULT_MEMBERS,MAX_SESSIONS} from './core.js';
export function createWorkspaces(chrome, {loadSession, createSession, mutate, getIndex, providers, defaultMembers, providerFor}) {
  const key='arena.windows'; let owners={}, queue=Promise.resolve(),openQueue=Promise.resolve();
  const ready=chrome.storage.session.get(key).then(data=>{owners=data[key]||{};});
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  // Session storage is cleared when the extension reloads; the local mirror lets an update reopen main pages.
  const persist=async next=>{await chrome.storage.session.set({[key]:next});owners=next;try{await chrome.storage.local.set({[key+'.mirror']:next});}catch(error){console.info('[AI圆桌lite] 窗口归属备份失败，更新后需手动打开记录',error.message);}};
  const mainUrl=id=>chrome.runtime.getURL('main.html')+'?session='+encodeURIComponent(id);
  async function prune(){
    const next={...owners};
    for(const win of Object.keys(next)){try{await chrome.windows.get(Number(win));}catch(e){if(!/No window|Invalid window/i.test(e.message))throw e;delete next[win];}}
    if(Object.keys(next).length!==Object.keys(owners).length)await persist(next);
  }
  async function claim(windowId, wanted){
    await ready;
    return serial(async()=>{
      await prune();
      if(owners[windowId]){
        if(wanted&&owners[windowId]!==wanted)throw new Error('这个窗口已有另一场圆桌。请从历史列表在独立窗口打开。');
        return owners[windowId];
      }
      const tabs=await chrome.tabs.query({windowId});
      let sessionId=wanted;
      if(!sessionId){
        // Browser/extension restarts clear session ownership. The restored main
        // Tab is the durable window identity even when its sidebar starts first.
        const restored=new Set();
        for(const tab of tabs){
          const url=tab.pendingUrl||tab.url||'';
          if(url.split(/[?#]/,1)[0]!==chrome.runtime.getURL('main.html'))continue;
          const id=new URL(url).searchParams.get('session');
          if(id)restored.add(id);
        }
        if(restored.size>1)throw new Error('这个窗口有多场圆桌的主页面，请将它们移到各自独立窗口后重试。');
        sessionId=[...restored][0];
        // Missing/deleted saved sessions fail explicitly instead of silently
        // replacing a restored roundtable with an empty one.
        if(sessionId)await loadSession(sessionId);
      }
      if(sessionId&&Object.values(owners).includes(sessionId))throw new Error('这场圆桌已在另一个窗口打开，请从历史列表切回对应窗口。');
      if(!sessionId){
        // On first upgrade adopt the old current session only in its original window.
        const old=await loadSession(getIndex().currentId);
        const bindings=Object.values(old.bindings||{});
        let belongs=!Object.values(owners).includes(old.id);
        for(const binding of bindings){if(!Number.isInteger(binding.tabId)){belongs=false;continue;}try{const tab=await chrome.tabs.get(binding.tabId);if(tab.windowId!==windowId)belongs=false;}catch(e){if(!/No tab|Invalid tab/i.test(e.message))throw e;belongs=false;}}
        // Capacity must never lock users out of the history needed to free space.
        const closedHistory=getIndex().sessions?.find(s=>!Object.values(owners).includes(s.id));
        sessionId=belongs?old.id:getIndex().sessions?.length>=MAX_SESSIONS&&closedHistory?closedHistory.id:(await createSession([...(typeof defaultMembers==='function'?defaultMembers():defaultMembers||DEFAULT_MEMBERS)])).id;
      }
      const session=await loadSession(sessionId);
      // Browser restarts can reuse numeric tab IDs. Match saved conversation URLs
      // inside this window, never trust a durable ID by itself. Sites append query
      // parameters (Kimi ?chat_enter_method=...), so compare origin and path only.
      if(Object.keys(session.bindings||{}).length)await mutate(sessionId,s=>{
        for(const [p,b] of Object.entries(s.bindings)){
          // Prefer the bound tab itself (still valid after an extension update); several tabs can share a landing URL.
          const matches=t=>providerFor(t.url||t.pendingUrl)===p&&cleanUrl(t.url||t.pendingUrl)===cleanUrl(b.url);
          // The bound tab may also have moved from a new-chat page into the chat our send created.
          const started=t=>{const pattern=providers[p]?.conversation;try{return !!pattern&&providerFor(t.url||t.pendingUrl)===p&&!pattern.test(new URL(b.url).pathname)&&pattern.test(new URL(t.url||t.pendingUrl).pathname);}catch{return false;}};
          const tab=tabs.find(t=>t.id===b.tabId&&(matches(t)||started(t)))||tabs.find(matches);
          s.bindings[p]=tab?{tabId:tab.id,url:b.url}:{url:b.url};
        }
      });
      await persist({...owners,[windowId]:sessionId});
      return sessionId;
    });
  }
  // Moves this window to another roundtable (close / new / recover in place). Tabs are handled by the caller.
  async function assign(windowId,sessionId){
    await ready;
    return serial(async()=>{
      await prune();await loadSession(sessionId);
      const holder=Object.keys(owners).find(k=>owners[k]===sessionId);
      if(holder&&Number(holder)!==windowId)throw new Error('这场圆桌已在另一个窗口打开，请从历史列表切到那个窗口。');
      const previous=owners[windowId]||null;await persist({...owners,[windowId]:sessionId});return previous;
    });
  }
  // sessionId -> windowId for every open roundtable, so history can show where each one lives.
  async function snapshot(){await ready;await queue;return Object.fromEntries(Object.entries(owners).map(([win,id])=>[id,Number(win)]));}
  async function owner(sessionId){await ready;await queue;return Number(Object.keys(owners).find(k=>owners[k]===sessionId))||null;}
  async function assertOwner(windowId,sessionId){const actual=await claim(windowId);if(actual!==sessionId)throw new Error('此操作属于另一场圆桌，已阻止跨窗口发送。请回到对应窗口。');}
  async function openMain(sessionId){
    await ready;
    let windowId=await owner(sessionId);
    if(windowId){try{await chrome.windows.get(windowId);}catch(e){if(!/No window|Invalid window/i.test(e.message))throw e;await forget(windowId);windowId=null;}}
    if(!windowId){
      const session=await loadSession(sessionId);
      const win=await chrome.windows.create({type:'normal',url:mainUrl(sessionId),focused:true});
      windowId=win.id;
      await claim(windowId,sessionId);
      // Reopening restores URLs into fresh tabs; it never reuses durable stale tab IDs.
      await mutate(sessionId,s=>{s.bindings=Object.fromEntries(Object.entries(s.bindings).map(([p,b])=>[p,{url:b.url}]));});
    }
    const tabs=await chrome.tabs.query({windowId});
    let tab=tabs.find(t=>(t.url||t.pendingUrl)===mainUrl(sessionId));
    if(!tab)tab=await chrome.tabs.create({windowId,url:mainUrl(sessionId),active:true});
    else await chrome.tabs.update(tab.id,{active:true});
    await chrome.windows.update(windowId,{focused:true});
    return {windowId,tabId:tab.id};
  }
  function main(sessionId){const result=openQueue.then(()=>openMain(sessionId));openQueue=result.catch(()=>{});return result;}
  async function forget(windowId){await ready;await serial(()=>persist(Object.fromEntries(Object.entries(owners).filter(([id])=>Number(id)!==windowId))));}
  async function requireWindow(sessionId){const windowId=await owner(sessionId);if(!windowId)throw new Error('圆桌窗口已关闭或尚未绑定，已取消网页操作。请从历史列表重新打开。');await chrome.windows.get(windowId);return windowId;}
  async function validateTab(sessionId,tab){const windowId=await requireWindow(sessionId);if(tab.windowId!==windowId)throw new Error('成员标签页已移到其他窗口。请移回本圆桌窗口，或点“连接成员网页”重新连接。');}
  async function ownerForWindow(windowId){await ready;await queue;return owners[windowId]||null;}
  // After an extension update Chrome closes main pages but keeps windows and member tabs (same IDs).
  async function restoreAfterReload(){
    await ready;const mirror=(await chrome.storage.local.get(key+'.mirror'))[key+'.mirror']||{};const reopened=[];
    for(const [win,sessionId] of Object.entries(mirror)){
      const windowId=Number(win);try{await chrome.windows.get(windowId);await loadSession(sessionId);}catch{continue;}
      try{await claim(windowId,sessionId);}catch(error){console.info('[AI圆桌lite] 更新后未恢复窗口',windowId,error.message);continue;}
      const tabs=await chrome.tabs.query({windowId});if(!tabs.some(t=>(t.url||t.pendingUrl||'').startsWith(chrome.runtime.getURL('main.html'))))await chrome.tabs.create({windowId,url:mainUrl(sessionId),active:false});
      reopened.push(windowId);
    }
    return reopened;
  }
  return {ready,claim,assign,snapshot,owner,ownerForWindow,requireWindow,assertOwner,main,forget,validateTab,restoreAfterReload};
}
