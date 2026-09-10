import {providerFor} from './core.js';

// Reuse AI-Arena's CDP wake/focus mechanism, scoped to one active request.
// No MAIN-world patches, Network interception, foreground tab switching or idle spoofing.
export function createBackgroundSupport(api,{onLost,onError}){
 const KEY='arena.background.leases',leases=new Map();let queue=Promise.resolve();
 const run=fn=>{const task=queue.then(fn);queue=task.catch(()=>{});return task;};
 const persist=()=>api.storage.session.set({[KEY]:[...leases.values()].map(({tabId,requestId,provider,autoDiscardable,attached})=>({tabId,requestId,provider,autoDiscardable,attached}))});
 const gone=e=>/No tab with id|Invalid tab ID|not attached|No target with given id/i.test(e.message);
 async function cleanup(lease){
  lease.releasing=true;const errors=[];
  if(lease.attached){
   try{await api.debugger.detach({tabId:lease.tabId});lease.attached=false;}catch(e){if(gone(e))lease.attached=false;else errors.push(e);}
  }
  try{const tab=await api.tabs.get(lease.tabId);if(tab.autoDiscardable!==lease.autoDiscardable)await api.tabs.update(lease.tabId,{autoDiscardable:lease.autoDiscardable});}catch(e){if(!gone(e))errors.push(e);}
  if(!errors.length&&leases.get(lease.tabId)===lease)leases.delete(lease.tabId);
  await persist();
  if(errors.length)throw new Error('后台支持释放失败：'+errors.map(e=>e.message).join('；'));
 }
 async function lost(lease,reason){
  let cleanupError;try{await cleanup(lease);}catch(e){cleanupError=e;}
  await onLost({tabId:lease.tabId,requestId:lease.requestId,reason:reason+(cleanupError?'；'+cleanupError.message:'')});
  if(cleanupError)throw cleanupError;
 }
 function interrupt(lease,reason,detached=false){
  if(!lease||lease.releasing||lease.lost)return;lease.lost=true;if(detached)lease.attached=false;
  // Invalidate the business request immediately, even if another tab's attach is pending.
  const notified=Promise.resolve(onLost({tabId:lease.tabId,requestId:lease.requestId,reason}));notified.catch(onError);
  run(async()=>{await cleanup(lease);await notified;}).catch(onError);
 }
 api.debugger.onDetach.addListener((source,reason)=>interrupt(leases.get(source.tabId),'Chrome 已断开后台支持（'+reason+'）',true));
 api.tabs.onUpdated.addListener((tabId,change,tab)=>{const lease=leases.get(tabId);if(lease&&change.url&&providerFor(tab.url)!==lease.provider)interrupt(lease,'标签页已离开本轮 AI 网站');});
 const ready=run(async()=>{
  const stored=await api.storage.session.get(KEY);
  // Restore the whole journal before any cleanup persists a new snapshot.
  for(const item of stored[KEY]||[])leases.set(item.tabId,{...item});
  for(const lease of [...leases.values()])try{await lost(lease,'扩展连接已重新启动，请核对原网页后重新提取');}catch(error){onError(error);}
 });
 return {
  ready,
  idle:()=>queue,
  acquire:(tabId,requestId,provider)=>run(async()=>{
   const existing=leases.get(tabId);if(existing){if(existing.requestId===requestId&&!existing.lost&&!existing.releasing)return;throw new Error('该网页已有进行中的后台读取，请先等待或停止。');}
   const tab=await api.tabs.get(tabId);if(providerFor(tab.url)!==provider)throw new Error('后台支持仅用于本轮绑定的 AI 网站。');
   if(tab.discarded)throw new Error('网页已被 Chrome 回收，请先打开原网页恢复，再重试；尚未发送。');
   const lease={tabId,requestId,provider,autoDiscardable:tab.autoDiscardable,attached:false,lost:false,releasing:false};leases.set(tabId,lease);
   try{
    await persist();await api.tabs.update(tabId,{autoDiscardable:false});
    await api.debugger.attach({tabId},'1.3');lease.attached=true;await persist();
    await api.debugger.sendCommand({tabId},'Page.enable',{});
    await api.debugger.sendCommand({tabId},'Page.setWebLifecycleState',{state:'active'});
    await api.debugger.sendCommand({tabId},'Emulation.setFocusEmulationEnabled',{enabled:true});
    if(lease.lost)throw new Error('后台支持已被取消，请核对原网页。');
   }catch(e){
    let detail='';try{await cleanup(lease);}catch(cleanupError){detail='；'+cleanupError.message;}
    throw new Error('无法启用后台支持：'+e.message+detail+'。请检查 Chrome 调试提示、开发者工具或公司浏览器策略；不会自动重发。');
   }
  }),
  release:(tabId,requestId)=>run(async()=>{const lease=leases.get(tabId);if(lease?.requestId===requestId)await cleanup(lease);}),
  reconcile:isActive=>run(async()=>{const errors=[];for(const lease of [...leases.values()])if(!await isActive(lease.requestId))try{await cleanup(lease);}catch(error){errors.push(error.message);}if(errors.length)throw new Error(errors.join('；'));}),
  has:(tabId,requestId)=>{const lease=leases.get(tabId);return !!lease&&lease.requestId===requestId&&!lease.lost&&!lease.releasing;}
 };
}
