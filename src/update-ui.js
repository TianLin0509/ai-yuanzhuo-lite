// "检查更新 / 立即更新" for the side panel and the main page. The service worker checks in the background and keeps
// a summary in storage; the actual update runs here because choosing and writing the folder needs the user's click.
import {findUpdate,downloadBundle,openBundle,compareVersions} from './update-core.js';
import {installFolder,savedFolder,writeRelease,forgetFolder} from './update-folder.js';
import {escapeHtml as esc} from './view.js';
const KEY='arena.update';
let status=null,running=false,hooks;
const current=()=>chrome.runtime.getManifest().version;
export const remoteUpdate=()=>status?.latest&&compareVersions(status.latest.version,current())>0?status.latest:null;
const kb=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
const when=t=>{if(!t)return '还没检查过';const m=Math.round((Date.now()-t)/60000);return m<1?'刚刚':m<60?m+' 分钟前':m<1440?Math.round(m/60)+' 小时前':new Date(t).toLocaleDateString();};

export function initUpdates(h){
  hooks=h;
  chrome.storage.local.get(KEY).then(d=>{status=d[KEY]||null;hooks.changed();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes[KEY]){status=changes[KEY].newValue||null;hooks.changed();if(document.querySelector('#dialog[open] .update-box'))render();}});
  for(const el of document.querySelectorAll('.app-version')){el.setAttribute('role','button');el.tabIndex=0;el.addEventListener('click',openUpdates);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openUpdates();}});}
}
export function openUpdates(){hooks.dialog('检查更新','<div class="update-box"></div>');render();if(!running&&(!status||Date.now()-status.checkedAt>10*60000))check();}

let progress=null,failure='',folderName='';
async function render(){
  const box=document.querySelector('#dialog .update-box');if(!box)return;
  const latest=status?.latest,newer=remoteUpdate(),busy=hooks.busy();
  folderName=(await savedFolder())?.name||'';
  const sources=(status?.results||[]).map(r=>`<li class="${r.ok?'ok':'bad'}"><b>${esc(r.name)}</b>${r.ok?`：可用，最新 v${esc(r.version)}`:`：${esc(r.error)}`}</li>`).join('');
  box.innerHTML=`
    <div class="update-versions"><span>当前 <b>v${esc(current())}</b></span>${newer?`<span class="arrow">→</span><span>新版本 <b>v${esc(newer.version)}</b></span>`:latest?'<span class="uptodate">已是最新版本</span>':''}</div>
    ${newer?`<div class="update-notes">${esc(newer.notes||'').replace(/\n/g,'<br>')}</div><p class="update-meta">需要下载 ${kb(newer.size)} · 来自 ${esc(newer.source)}${newer.publishedAt?' · '+esc(newer.publishedAt.slice(0,10))+' 发布':''}</p>`:''}
    ${progress?`<div class="update-progress"><div class="bar"><span style="width:${Math.round(progress.ratio*100)}%"></span></div><p>${esc(progress.text)}</p></div>`:''}
    ${failure?`<p class="update-error" role="alert">${esc(failure)}</p>`:''}
    <div class="update-actions">
      ${newer?`<button class="primary" data-up="install" ${running||busy?'disabled':''}>立即更新</button>`:''}
      <button data-up="check" ${running?'disabled':''}>${running&&!progress?'正在检查…':'检查更新'}</button>
    </div>
    ${newer&&busy?'<p class="update-meta">还有进行中的圆桌，等本轮结束或停止后再更新。</p>':''}
    <p class="update-meta">上次检查：${when(status?.checkedAt)}${sources?'':'。'}</p>${sources?`<ul class="update-sources">${sources}</ul>`:''}
    <details class="update-help"><summary>更新会做什么</summary>
      <p>从 GitHub 下载新版（没登录 GitHub 时自动改用备用服务器），逐个文件核对官方签名，写回扩展所在的文件夹，然后原地重新加载。圆桌记录、草稿和窗口都保留。</p>
      <p>${folderName?`已授权文件夹：<b>${esc(folderName)}</b> <button class="link" data-up="repick">换一个</button>`:'第一次更新时，Chrome 会让你选择扩展所在的文件夹——就是当初在「扩展程序」页面「加载已解压的扩展程序」时选的那个。之后不用再选。'}</p>
    </details>`;
  box.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>({install:()=>install(false),check,repick:async()=>{await forgetFolder();render();}})[b.dataset.up]());
}

async function check(){
  if(running)return;running=true;failure='';render();
  try{const r=await hooks.act('checkUpdate');if(r?.update){status=r.update;}}finally{running=false;render();}
}

const step=(ratio,text)=>{progress={ratio,text};render();};
async function install(repick){
  if(running)return;running=true;failure='';
  try{
    if(hooks.busy())throw new Error('还有进行中的圆桌，等本轮结束或停止后再更新。');
    // The folder first: it needs this click, and nothing is downloaded for a folder that cannot be written.
    step(0.02,'正在确认扩展文件夹…');
    const folder=await installFolder({interactive:true,repick});
    step(0.05,'正在重新核对新版本的签名…');
    const found=await findUpdate();
    if(!found.manifest)throw new Error('现在连不上任何更新源：'+found.results.map(r=>r.name+' '+r.error).join('；'));
    if(compareVersions(found.manifest.version,current())<=0)throw new Error('已经是最新版本，不需要更新。');
    const m=found.manifest;
    const {bytes,source}=await downloadBundle(m,{first:found.source,onProgress:p=>step(0.05+0.65*p.received/p.total,`正在从 ${p.source} 下载 ${kb(p.received)} / ${kb(p.total)}`)});
    step(0.72,`正在逐个核对 ${m.files.length} 个文件…`);
    const files=await openBundle(bytes,m);
    await writeRelease(folder,files,(done,total)=>step(0.75+0.2*done/total,`正在写入 ${done} / ${total}（内容没变的文件会跳过）`));
    step(1,`v${m.version} 已写入（来自 ${source}），正在重新加载…`);
    const r=await hooks.act('update');
    if(!r?.reloading)throw new Error('新版文件已写入，但没能自动重新加载。请到 Chrome「扩展程序」页面点 AI圆桌lite 的刷新按钮。');
  }catch(error){progress=null;failure=error.cancelled?error.message:'没有更新：'+error.message;}
  finally{running=false;render();}
}
