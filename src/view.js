export const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmtTime=ts=>new Date(ts).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'});
export function fmtDateGroup(ts){const d=new Date(ts),today=new Date();today.setHours(0,0,0,0);const yesterday=new Date(today);yesterday.setDate(yesterday.getDate()-1);const date=new Date(d);date.setHours(0,0,0,0);return date.getTime()===today.getTime()?'今天':date.getTime()===yesterday.getTime()?'昨天':d.toLocaleDateString('zh-CN');}
const dayStart=(now,back=0)=>{const d=new Date(now);d.setHours(0,0,0,0);d.setDate(d.getDate()-back);return d.getTime();};
// History list times, in the style of the AI Hub sidebar: recent ones relative, older ones as a date.
export function fmtRelative(ts,now=Date.now()){
  const minutes=Math.floor((now-ts)/60000);if(minutes<1)return '刚刚';if(minutes<60)return minutes+'分钟前';
  if(ts>=dayStart(now))return Math.floor(minutes/60)+'小时前';if(ts>=dayStart(now,1))return '昨天 '+fmtTime(ts);
  const d=new Date(ts);return (d.getFullYear()===new Date(now).getFullYear()?'':d.getFullYear()+'年')+(d.getMonth()+1)+'月'+d.getDate()+'日 '+fmtTime(ts);
}
export function historyGroup(ts,now=Date.now()){return ts>=dayStart(now)?'今天':ts>=dayStart(now,1)?'昨天':ts>=dayStart(now,6)?'近 7 天':ts>=dayStart(now,29)?'近 30 天':'更早';}
export const roundMatches=(r,q)=>!q||[r.prompt,...r.jobs.map(j=>j.text)].some(t=>String(t||'').toLocaleLowerCase().includes(q.toLocaleLowerCase()));
export function renderMarkdown(target,text,format){
  target.classList.toggle('plain',format!=='markdown');if(format!=='markdown'){target.textContent=text;return;}
  target.innerHTML=globalThis.DOMPurify.sanitize(globalThis.marked.parse(text,{gfm:true,breaks:true}),{ALLOWED_TAGS:['p','br','strong','em','h1','h2','h3','h4','h5','h6','ul','ol','li','pre','code','blockquote','a','table','thead','tbody','tr','td','th','hr','del'],ALLOWED_ATTR:['href','title','start']});
  for(const a of target.querySelectorAll('a')){if(!/^https?:\/\//i.test(a.getAttribute('href')||''))a.removeAttribute('href');else{a.target='_blank';a.rel='noopener noreferrer';}}
}
