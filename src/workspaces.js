// Window ownership is browser-session state. Durable answers never depend on a tab ID.
export function createWorkspaces(chrome, {loadSession, createSession, mutate, getIndex, providers, providerFor}) {
  const key='arena.windows'; let owners={}, queue=Promise.resolve(),openQueue=Promise.resolve();
  const ready=chrome.storage.session.get(key).then(data=>{owners=data[key]||{};});
  const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
  const persist=async next=>{await chrome.storage.session.set({[key]:next});owners=next;};
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
      let sessionId=wanted;
      if(sessionId&&Object.values(owners).includes(sessionId))throw new Error('这场圆桌已在另一个窗口打开，请从历史列表切回对应窗口。');
      if(!sessionId){
        // On first upgrade adopt the old current session only in its original window.
        const old=await loadSession(getIndex().currentId);
        const bindings=Object.values(old.bindings||{});
        let belongs=!Object.values(owners).includes(old.id);
        for(const binding of bindings){if(!Number.isInteger(binding.tabId)){belongs=false;continue;}try{const tab=await chrome.tabs.get(binding.tabId);if(tab.windowId!==windowId)belongs=false;}catch(e){if(!/No tab|Invalid tab/i.test(e.message))throw e;belongs=false;}}
        // Capacity must never lock users out of the history needed to free space.
        const closedHistory=getIndex().sessions?.find(s=>!Object.values(owners).includes(s.id));
        sessionId=belongs?old.id:getIndex().sessions?.length>=30&&closedHistory?closedHistory.id:(await createSession(Object.keys(providers))).id;
      }
      const session=await loadSession(sessionId);
      const tabs=await chrome.tabs.query({windowId});
      // Browser restarts can reuse numeric tab IDs. Match saved conversation URLs
      // inside this window, never trust a durable ID by itself.
      if(Object.keys(session.bindings||{}).length)await mutate(sessionId,s=>{
        for(const [p,b] of Object.entries(s.bindings)){
          const tab=tabs.find(t=>providerFor(t.url||t.pendingUrl)===p&&(t.url||t.pendingUrl)===b.url);
          s.bindings[p]=tab?{tabId:tab.id,url:b.url}:{url:b.url};
        }
      });
      await persist({...owners,[windowId]:sessionId});
      return sessionId;
    });
  }
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
  return {ready,claim,owner,ownerForWindow,requireWindow,assertOwner,main,forget,validateTab};
}
