// Read-only selector inspection. Never reads cookies, passwords, input values or chat bodies.
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from './browser-config.mjs';
import {providerFor} from '../src/core.js';
const root=path.resolve(import.meta.dirname,'..');
const meta=JSON.parse(fs.readFileSync(path.join(root,'artifacts','20260909-lite-live-browser-codex.json'),'utf8'));
const version=await (await fetch(`http://127.0.0.1:${meta.cdpPort}/json/version`)).json();
if(version.webSocketDebuggerUrl!==meta.webSocketDebuggerUrl)throw new Error('Dedicated browser identity mismatch');
const browser=await chromium.connectOverCDP(`http://127.0.0.1:${meta.cdpPort}`);
const results=[];
for(const page of browser.contexts()[0].pages()){
  const provider=providerFor(page.url());if(!provider)continue;
  const selectors=await page.evaluate(()=>{
    const visible=e=>e.getClientRects().length>0;
    const attributes=e=>Object.fromEntries(['id','class','role','aria-label','data-testid','placeholder','contenteditable','type','disabled','aria-disabled'].filter(name=>e.hasAttribute(name)).map(name=>[name,e.getAttribute(name)]));
    return {inputs:[...document.querySelectorAll('textarea,[contenteditable="true"]')].filter(visible).map(e=>({tag:e.tagName,...attributes(e)})),buttons:[...document.querySelectorAll('button,[role="button"]')].filter(visible).map(e=>({tag:e.tagName,...attributes(e),label:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,35)})).filter(e=>/send|submit|stop|发送|停止|登录|log.in|login|复制|copy/i.test(JSON.stringify(e))).slice(-24)};
  });
  results.push({provider,url:new URL(page.url()).origin+new URL(page.url()).pathname,...selectors});
}
fs.writeFileSync(path.join(root,'artifacts','20260909-lite-live-selectors-codex.json'),JSON.stringify(results,null,2)+'\n','utf8');
console.log(JSON.stringify(results,null,2));
// This process only attached to the user's test browser. Exiting disconnects its socket; never send Browser.close.
process.exit(0);
