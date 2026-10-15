// One-click update (2026-10-15, user-approved exception to "no remote code"): only when the user clicks, only a
// release whose manifest carries a valid signature from the release key, and every file is checked against it.
// Pure functions shared by the service worker (checking), the pages (downloading) and node tests.
export const UPDATE_PRODUCT='ai-yuanzhuo-lite';
// ECDSA P-256 public key (SPKI, base64). The private key never leaves the release machine.
export const UPDATE_KEY='MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEfwzStsMTKl+jQPGTX2F31/nPMyz9F0383pJ8TDqRzrmAtC2AmDO+oZn83duYcaIG8gNIeMWjk5t00jA+OaNf1g==';
// Tried in order. The GitHub repository is private: it answers only when this Chrome is signed in to GitHub,
// otherwise 404 and the backup server (also used by the company inbox, reachable from the company network) serves.
export const UPDATE_SOURCES=[
  {name:'GitHub',base:'https://github.com/TianLin0509/ai-yuanzhuo-lite/releases/latest/download/',credentials:'include'},
  {name:'备用服务器',base:'https://me.lt-stockpartner.tech/pptutor/yuanzhuo-lite/',credentials:'omit'}
];
export const MANIFEST_NAME='update-manifest.json',SIGNATURE_NAME='update-manifest.sig';
const HEX64=/^[0-9a-f]{64}$/,VERSION=/^\d+\.\d+\.\d+$/,ASSET=/^[A-Za-z0-9._-]+$/;

export function compareVersions(a,b){const x=String(a).split('.').map(Number),y=String(b).split('.').map(Number);for(let i=0;i<3;i++){if((x[i]||0)!==(y[i]||0))return (x[i]||0)>(y[i]||0)?1:-1;}return 0;}
// Relative paths of plain names only: no "..", no leading dot, no backslash, no drive letter.
export function validPath(p){return typeof p==='string'&&p.length<=200&&/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(p)&&!p.split('/').includes('..');}
const bytesOf=data=>data instanceof Uint8Array?data:new Uint8Array(data);
export async function sha256Hex(data,subtle=globalThis.crypto.subtle){return [...new Uint8Array(await subtle.digest('SHA-256',bytesOf(data)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const fromBase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));

// The signature (IEEE P1363 r||s, base64) covers the exact manifest bytes. Anything else is rejected before parsing.
export async function verifyManifest(manifestBytes,signatureText,{key=UPDATE_KEY,subtle=globalThis.crypto.subtle}={}){
  const bytes=bytesOf(manifestBytes);let signature;
  try{signature=fromBase64(String(signatureText).trim());}catch{throw new Error('签名格式不对');}
  const publicKey=await subtle.importKey('spki',fromBase64(key),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  if(!await subtle.verify({name:'ECDSA',hash:'SHA-256'},publicKey,signature,bytes))throw new Error('签名校验未通过');
  let m;try{m=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new Error('更新清单不是有效的 JSON');}
  const bad=what=>{throw new Error('更新清单格式不对：'+what);};
  if(m?.product!==UPDATE_PRODUCT)bad('产品名');if(!VERSION.test(m.version||''))bad('版本号');
  if(!m.bundle||!ASSET.test(m.bundle.name||'')||!HEX64.test(m.bundle.sha256||'')||!Number.isInteger(m.bundle.size)||m.bundle.size<=0||m.bundle.size>50e6)bad('更新包');
  if(!Array.isArray(m.files)||!m.files.length||m.files.length>500)bad('文件列表');
  const seen=new Set();for(const f of m.files){if(!validPath(f?.path)||seen.has(f.path)||!HEX64.test(f.sha256||'')||!Number.isInteger(f.size)||f.size<0)bad('文件 '+String(f?.path).slice(0,60));seen.add(f.path);}
  if(!seen.has('manifest.json')||!seen.has('build.json'))bad('缺少 manifest.json 或 build.json');
  if(typeof m.notes!=='string'||m.notes.length>4000)bad('更新说明');
  return m;
}

// A bundle is JSON {product, version, files:{path: base64}}; its hash is in the signed manifest and every file is
// checked again, so the bytes written are exactly the released ones.
export async function openBundle(bundleBytes,manifest,{subtle=globalThis.crypto.subtle}={}){
  const bytes=bytesOf(bundleBytes);
  if(bytes.length!==manifest.bundle.size||await sha256Hex(bytes,subtle)!==manifest.bundle.sha256)throw new Error('更新包校验未通过（可能下载不完整或被网络改写）');
  const bundle=JSON.parse(new TextDecoder().decode(bytes));
  if(bundle.product!==UPDATE_PRODUCT||bundle.version!==manifest.version)throw new Error('更新包与清单版本不一致');
  const names=Object.keys(bundle.files||{});
  if(names.length!==manifest.files.length)throw new Error('更新包文件数与清单不一致');
  const files=[];
  for(const entry of manifest.files){
    if(typeof bundle.files[entry.path]!=='string')throw new Error('更新包缺少文件 '+entry.path);
    const data=fromBase64(bundle.files[entry.path]);
    if(data.length!==entry.size||await sha256Hex(data,subtle)!==entry.sha256)throw new Error('文件校验未通过：'+entry.path);
    files.push({path:entry.path,data});
  }
  return files;
}

// Reason shown per source, in words the user can act on.
export function describeFailure(source,error){
  const m=String(error?.message||error);
  if(/HTTP 404/.test(m))return source.name==='GitHub'?'找不到更新文件（这台 Chrome 没登录 GitHub 时会这样）':'找不到更新文件';
  if(/HTTP \d+/.test(m))return '服务器返回 '+m.match(/HTTP \d+/)[0];
  if(/签名|格式|JSON/.test(m))return '内容校验未通过，可能被公司网络拦截或改写';
  if(/abort|timeout|超时/i.test(m))return '连接超时';
  return '连不上（'+m.slice(0,60)+'）';
}

async function fetchBytes(url,source,fetchImpl,timeoutMs){
  const response=await fetchImpl(url,{cache:'no-store',credentials:source.credentials||'omit',redirect:'follow',signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw new Error('HTTP '+response.status);
  return new Uint8Array(await response.arrayBuffer());
}
// First source whose manifest verifies wins. Every source tried is reported, successful or not.
export async function findUpdate({sources=UPDATE_SOURCES,fetchImpl=globalThis.fetch,key=UPDATE_KEY,timeoutMs=10000}={}){
  const results=[];
  for(const source of sources){
    try{
      const [manifestBytes,signature]=await Promise.all([fetchBytes(source.base+MANIFEST_NAME,source,fetchImpl,timeoutMs),fetchBytes(source.base+SIGNATURE_NAME,source,fetchImpl,timeoutMs)]);
      const manifest=await verifyManifest(manifestBytes,new TextDecoder().decode(signature),{key});
      results.push({name:source.name,ok:true,version:manifest.version});
      return {manifest,source,results};
    }catch(error){results.push({name:source.name,ok:false,error:describeFailure(source,error)});}
  }
  return {manifest:null,source:null,results};
}

// Streams the bundle so the page can show progress; tries the source that served the manifest first.
export async function downloadBundle(manifest,{sources=UPDATE_SOURCES,first,fetchImpl=globalThis.fetch,onProgress=()=>{},timeoutMs=60000}={}){
  const order=first?[first,...sources.filter(s=>s.name!==first.name)]:sources,failures=[];
  for(const source of order){
    try{
      onProgress({source:source.name,received:0,total:manifest.bundle.size});
      const response=await fetchImpl(source.base+manifest.bundle.name,{cache:'no-store',credentials:source.credentials||'omit',redirect:'follow',signal:AbortSignal.timeout(timeoutMs)});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const chunks=[];let received=0;
      if(response.body?.getReader){const reader=response.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.length;if(received>manifest.bundle.size)throw new Error('更新包比清单写的大');onProgress({source:source.name,received,total:manifest.bundle.size});}}
      else{const all=new Uint8Array(await response.arrayBuffer());chunks.push(all);received=all.length;}
      const bytes=new Uint8Array(received);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
      return {bytes,source:source.name,failures};
    }catch(error){failures.push({name:source.name,error:describeFailure(source,error)});}
  }
  throw Object.assign(new Error('所有下载源都失败：'+failures.map(f=>f.name+' '+f.error).join('；')),{failures});
}

// Files that announce a new version go last, so an interrupted write never looks like a finished one.
export function writeOrder(files){const rank=p=>p==='build.json'?2:p==='manifest.json'?1:0;return [...files].sort((a,b)=>rank(a.path)-rank(b.path));}
