export const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmtTime=ts=>new Date(ts).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'});
export function fmtDateGroup(ts){const d=new Date(ts),today=new Date();today.setHours(0,0,0,0);const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);const date=new Date(d);date.setHours(0,0,0,0);return date.getTime()===today.getTime()?'今天':date.getTime()===yesterday.getTime()?'昨天':d.toLocaleDateString('zh-CN');}
export const roundMatches=(r,q)=>!q||[r.prompt,...r.jobs.map(j=>j.text)].some(t=>String(t||'').toLocaleLowerCase().includes(q.toLocaleLowerCase()));
export function renderMarkdown(target,text,format){
  target.classList.toggle('plain',format!=='markdown');if(format!=='markdown'){target.textContent=text;return;}
  target.innerHTML=globalThis.DOMPurify.sanitize(globalThis.marked.parse(text,{gfm:true,breaks:true}),{ALLOWED_TAGS:['p','br','strong','em','h1','h2','h3','h4','h5','h6','ul','ol','li','pre','code','blockquote','a','table','thead','tbody','tr','td','th','hr','del'],ALLOWED_ATTR:['href','title','start']});
  for(const a of target.querySelectorAll('a')){if(!/^https?:\/\//i.test(a.getAttribute('href')||''))a.removeAttribute('href');else{a.target='_blank';a.rel='noopener noreferrer';}}
}
