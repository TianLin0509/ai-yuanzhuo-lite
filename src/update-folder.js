// The folder Chrome loads this unpacked extension from. The user picks it once (Chrome's own folder permission);
// the handle is kept in IndexedDB and permission is re-requested on the next update click when Chrome asks for it.
import {writeOrder} from './update-core.js';
const DB='yuanzhuo-update',STORE='handles',KEY='install-folder';
function db(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function tx(mode,fn){const d=await db();try{return await new Promise((resolve,reject)=>{const t=d.transaction(STORE,mode),req=fn(t.objectStore(STORE));t.oncomplete=()=>resolve(req?.result);t.onerror=()=>reject(t.error);});}finally{d.close();}}
export const savedFolder=()=>tx('readonly',s=>s.get(KEY)).catch(()=>null);
export const forgetFolder=()=>tx('readwrite',s=>s.delete(KEY));
const saveFolder=handle=>tx('readwrite',s=>s.put(handle,KEY));

// The chosen folder must hold this very extension: same name, same running version.
export async function checkFolder(handle,running=chrome.runtime.getManifest()){
  let text;try{text=await (await (await handle.getFileHandle('manifest.json')).getFile()).text();}catch{throw new Error(`「${handle.name}」里没有 manifest.json，不是 AI圆桌lite 的文件夹。请选当初「加载已解压的扩展程序」时选的那个文件夹。`);}
  let m;try{m=JSON.parse(text);}catch{throw new Error(`「${handle.name}」里的 manifest.json 读不懂，请重新选择。`);}
  if(m.name!==running.name)throw new Error(`「${handle.name}」里是「${m.name}」，不是 AI圆桌lite。`);
  if(m.version!==running.version)throw new Error(`「${handle.name}」里的版本是 v${m.version}，和正在运行的 v${running.version} 不同，可能不是当前加载的那个文件夹。`);
  return true;
}

// Returns a folder with write permission. interactive=true may show Chrome's folder picker; it needs a click.
export async function installFolder({interactive=true,repick=false}={}){
  let handle=repick?null:await savedFolder();
  if(handle){
    const ok=await handle.queryPermission({mode:'readwrite'})==='granted'||interactive&&await handle.requestPermission({mode:'readwrite'})==='granted';
    if(!ok)throw new Error('Chrome 没有给写入这个文件夹的权限。请再点一次「立即更新」并选择允许。');
    try{await checkFolder(handle);return handle;}catch(error){if(!interactive)throw error;handle=null;}
  }
  if(!interactive)return null;
  if(typeof window.showDirectoryPicker!=='function')throw new Error('这个 Chrome 不支持选择文件夹，无法一键更新。请手动下载新版。');
  try{handle=await window.showDirectoryPicker({id:'ai-yuanzhuo-lite-install',mode:'readwrite'});}
  catch(error){if(error.name==='AbortError')throw Object.assign(new Error('已取消选择文件夹，没有更新。'),{cancelled:true});throw new Error('Chrome 不允许选择这个文件夹（系统目录不能授权）。请把扩展文件夹放到 D 盘或「下载」等普通位置后重新加载，再更新。');}
  await checkFolder(handle);await saveFolder(handle);return handle;
}

// Writes each file atomically (Chrome writes a temporary copy and swaps it in on close). Files whose bytes are
// unchanged are skipped (most of a release); the rest go four at a time, then manifest.json and the build stamp last.
// If any write fails, every file already replaced is put back, so the folder never holds a mix of two versions.
export async function writeRelease(handle,files,onProgress=()=>{}){
  const ordered=writeOrder(files),undo=[];let done=0,written=0;
  const locate=async path=>{const parts=path.split('/');let dir=handle;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part,{create:true});return {dir,name:parts.at(-1)};};
  const put=async(dir,name,data)=>{const writable=await (await dir.getFileHandle(name,{create:true})).createWritable();try{await writable.write(data);await writable.close();}catch(error){await writable.abort().catch(()=>{});throw error;}};
  const same=(a,b)=>a&&a.length===b.length&&a.every((x,i)=>x===b[i]);
  const one=async file=>{
    const {dir,name}=await locate(file.path);
    let before=null;try{before=new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());}catch(error){if(error.name!=='NotFoundError')throw error;}
    if(!same(before,file.data)){undo.push({dir,name,before});try{await put(dir,name,file.data);}catch(error){throw new Error(`写入 ${file.path} 失败：${error.message}`);}written++;}
    onProgress(++done,ordered.length,file.path);
  };
  try{
    const last=ordered.filter(f=>f.path==='manifest.json'||f.path==='build.json'),rest=ordered.filter(f=>!last.includes(f));
    for(let i=0;i<rest.length;i+=4)await Promise.all(rest.slice(i,i+4).map(one));
    for(const file of last)await one(file);
    return {written,total:ordered.length};
  }catch(error){
    const failed=[];
    for(const {dir,name,before} of undo.reverse()){try{if(before)await put(dir,name,before);else await dir.removeEntry(name);}catch{failed.push(name);}}
    throw new Error(error.message+(failed.length?`；另有 ${failed.length} 个文件没能还原（${failed.slice(0,3).join('、')}），请重新下载完整安装包`:'；已还原为原来的版本'));
  }
}
