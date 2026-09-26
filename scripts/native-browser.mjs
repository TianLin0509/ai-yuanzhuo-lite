import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from './browser-config.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Use Chrome's own developer-mode control, never profile preference edits or
// command-line workarounds for a managed policy. Only close the page we create.
export async function enableExtensionDeveloperMode(context){
  const page=await context.newPage();
  try{
    await page.goto('chrome://extensions/');
    const toggle=()=>document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-toolbar')?.shadowRoot?.querySelector('#devMode');
    await page.waitForFunction(toggle,undefined,{polling:100});
    const control=page.locator('#devMode');
    const state=await control.evaluate(element=>({checked:element.checked,disabled:element.disabled||element.getAttribute('aria-disabled')==='true'}));
    if(state.disabled)throw new Error('Chrome 开发者模式被管理策略或账号限制禁用，无法准备未打包扩展。');
    if(!state.checked)await control.dispatchEvent('click');
    await page.waitForFunction(()=>document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-toolbar')?.shadowRoot?.querySelector('#devMode')?.checked===true,undefined,{polling:100});
    return {developerMode:true};
  }finally{await page.close();}
}

// Native Chromium owns its lifecycle. Attaching with noDefaults avoids Playwright's
// focus emulation and launch-time switches that disable normal background throttling.
export async function launchNativeBrowser({profile,extension,headless=false,windowSize='1460,1040'}={}){
  if(!profile)throw new Error('A dedicated browser profile is required.');
  profile=path.resolve(profile);
  if(extension){extension=path.resolve(extension);if(!fs.existsSync(path.join(extension,'manifest.json')))throw new Error('Run npm run build first.');}
  fs.mkdirSync(profile,{recursive:true});
  const executable=chromium.executablePath();
  if(!fs.existsSync(executable))throw new Error('Chromium is missing. Run npx playwright install chromium.');
  const activePortFile=path.join(profile,'DevToolsActivePort');
  const previousPort=fs.existsSync(activePortFile)?fs.readFileSync(activePortFile,'utf8'):'';
  if(previousPort){
    const [port,webSocketPath]=previousPort.trim().split(/\r?\n/);
    if(/^\d+$/.test(port)&&webSocketPath?.startsWith('/devtools/browser/')){
      let existing;
      try{const response=await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(1000)});if(response.ok)existing=await response.json();}
      catch(error){if(error.name!=='TimeoutError'&&error.name!=='TypeError')throw error;}
      if(existing?.webSocketDebuggerUrl&&new URL(existing.webSocketDebuggerUrl).pathname===webSocketPath)throw new Error(`Dedicated profile already has a running browser at 127.0.0.1:${port}: ${profile}`);
    }
  }
  const args=[`--user-data-dir=${profile}`,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--no-first-run','--no-default-browser-check',`--window-size=${windowSize}`];
  if(extension)args.push(`--disable-extensions-except=${extension}`,`--load-extension=${extension}`);
  if(headless)args.push('--headless=new');
  if(process.platform==='linux'&&process.getuid?.()===0)args.push('--no-sandbox');
  args.push('about:blank');
  const stderrPath=path.join(profile,'native-launch.stderr.log'),stderr=fs.openSync(stderrPath,'a');
  let child;
  try{child=spawn(executable,args,{detached:true,stdio:['ignore','ignore',stderr],windowsHide:false});}finally{fs.closeSync(stderr);}
  let exitInfo=null,spawnError=null;
  child.on('error',error=>{spawnError=error;});
  child.once('exit',(code,signal)=>{exitInfo={code,signal};});
  child.unref();
  let browser,version,cdpPort,endpoint;
  try{
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      if(spawnError)throw spawnError;
      if(exitInfo)throw new Error(`Native Chromium exited before CDP was ready: ${JSON.stringify(exitInfo)}. See ${stderrPath}`);
      if(fs.existsSync(activePortFile)){
        // Chromium may still hold the file while writing it on Windows (EBUSY/EPERM); read again next tick.
        let current;try{current=fs.readFileSync(activePortFile,'utf8');}catch(error){if(!['EBUSY','EPERM','ENOENT'].includes(error.code))throw error;await delay(100);continue;}
        if(current!==previousPort){
          const [port,webSocketPath]=current.trim().split(/\r?\n/);
          if(/^\d+$/.test(port)&&webSocketPath?.startsWith('/devtools/browser/')){
            try{
              endpoint=`http://127.0.0.1:${port}`;
              const response=await fetch(endpoint+'/json/version',{signal:AbortSignal.timeout(1000)});
              if(response.ok){const found=await response.json();if(new URL(found.webSocketDebuggerUrl).pathname===webSocketPath){version=found;cdpPort=Number(port);break;}}
            }catch(error){if(error.name!=='TimeoutError'&&error.name!=='TypeError')throw error;}
          }
        }
      }
      await delay(100);
    }
    if(!version)throw new Error(`Native Chromium CDP startup timed out. See ${stderrPath}`);
    browser=await chromium.connectOverCDP(endpoint,{noDefaults:true});
    const context=browser.contexts()[0];
    if(!context)throw new Error('Native Chromium did not expose its default context.');
    let closed=false;
    const close=async()=>{
      if(closed)return;closed=true;
      if(exitInfo)return;
      // This endpoint must still belong to the exact browser launched by this call.
      const current=await (await fetch(endpoint+'/json/version',{signal:AbortSignal.timeout(1500)})).json();
      if(current.webSocketDebuggerUrl!==version.webSocketDebuggerUrl)throw new Error('Refusing to close a different browser instance.');
      const session=await browser.newBrowserCDPSession();
      try{await session.send('Browser.close');}catch(error){if(!/closed|disconnected/i.test(error.message))throw error;}
      for(let attempt=0;attempt<80&&!exitInfo;attempt++)await delay(100);
      if(!exitInfo)throw new Error(`Owned browser PID ${child.pid} did not exit after Browser.close.`);
    };
    return {browser,context,close,process:child,metadata:{startedAt:new Date().toISOString(),helperPid:process.pid,browserPid:child.pid,profile,extension,executable,args,cdpPort,webSocketDebuggerUrl:version.webSocketDebuggerUrl,browser:version.Browser,attachment:{noDefaults:true},stderrPath}};
  }catch(error){
    // No broad process search or profile deletion: only this spawn's live process.
    if(!exitInfo&&!spawnError)child.kill();
    throw error;
  }
}
