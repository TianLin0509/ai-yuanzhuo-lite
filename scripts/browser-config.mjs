import fs from 'node:fs';
const cache='C:\\VibeData\\BrowserCache\\playwright';
if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&fs.existsSync(cache))process.env.PLAYWRIGHT_BROWSERS_PATH=cache;
export const {chromium}=await import('playwright');
