// Synthetic local shell proof only. No signed-in account, provider or live outcome.
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='docs/evidence/ui-delivery/assets/exp08-team-hub-source-return'; mkdirSync(out,{recursive:true});
const report={label:'harness render · not live',records:[],failures:[]};
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-proxy-server']});
try {
 for(const theme of ['dark','light']) for(const width of [1536,1366,1024,900]) for(const paige of ['closed','open']) {
  const page=await browser.newPage({viewport:{width,height:864}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e).slice(0,200)));
  await page.goto(`http://127.0.0.1:5297/solo/3855/team-hub?theme=${theme}&message=e8000000-0000-4000-8000-0000000a0001`,{waitUntil:'domcontentloaded',timeout:60000});
  const row=page.locator('aside[aria-label="Thread"] #th-msg-e8000000-0000-4000-8000-0000000a0001');
  await row.waitFor({state:'visible',timeout:60000});
  const current=await page.locator('[data-tenant-shell]').getAttribute('data-paige');
  if(current!==paige) {
    if(paige==='open') await page.locator('[data-tenant-paige-command]').click();
    else await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).first().click();
  }
  await page.waitForTimeout(500);
  const measured=await row.evaluate(el=>{const r=el.getBoundingClientRect();return {visible:r.width>0&&r.height>0,rect:{x:r.x,y:r.y,w:r.width,h:r.height},focused:document.activeElement===el,pageOverflowX:document.documentElement.scrollWidth-innerWidth,pageOverflowY:document.documentElement.scrollHeight-innerHeight,paige:document.querySelector('[data-tenant-shell]')?.getAttribute('data-paige'),text:el.textContent};});
  const name=`${theme}-${width}-${paige}`;
  if(!measured.visible||measured.pageOverflowX>1||measured.pageOverflowY>1||measured.paige!==paige||errors.length)report.failures.push({name,measured,errors});
  report.records.push({name,theme,width,paige,...measured,errors});
  await page.evaluate(label=>{const e=document.createElement('div');e.textContent=label;e.dataset.harnessLabel='';e.style.cssText='position:fixed;bottom:4px;left:4px;background:#111;color:#fff;padding:3px 6px;font:11px sans-serif;z-index:2147483647';document.body.append(e);},report.label);
  if(!await page.locator('[data-harness-label]').isVisible())throw Error('Missing synthetic label');
  await page.screenshot({path:`${out}/${name}.png`});await page.close();
 }
} finally {await browser.close();writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({records:report.records.length,failures:report.failures}));if(report.failures.length)process.exitCode=1;
