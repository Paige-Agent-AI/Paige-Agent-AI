import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='docs/evidence/ui-delivery/assets/exp08-team-hub-scoped-handoff';mkdirSync(out,{recursive:true});
const report={label:'harness render · not live',records:[],failures:[]};
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-proxy-server']});
try {for(const tenant of [{account:3855,key:'a'},{account:4120,key:'b'}]) {
 const page=await browser.newPage({viewport:{width:1366,height:864}});const errors=[];page.on('pageerror',e=>errors.push(String(e).slice(0,200)));
 await page.goto(`http://127.0.0.1:5297/solo/${tenant.account}/team-hub?theme=dark&tenant=${tenant.key}`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('.th-list').waitFor({timeout:60000});
 if(await page.locator('[data-tenant-shell]').getAttribute('data-paige')!=='closed')await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).first().click();
 const box=page.getByRole('combobox').first();await box.fill('/PAIGE request approval Review the onboarding checklist');await box.press('Enter');
 await page.getByRole('button',{name:'Continue in PAIGE',exact:true}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('textarea')].some(el=>el.value.startsWith('Help me request approval: Review the onboarding checklist')),{timeout:15000});
 const measured=await page.evaluate(()=>({paige:document.querySelector('[data-tenant-shell]')?.getAttribute('data-paige'),drafts:[...document.querySelectorAll('textarea')].map(e=>({value:e.value,disabled:e.disabled})),calls:window.__harnessCalls?.calls,overflowX:document.documentElement.scrollWidth-innerWidth,overflowY:document.documentElement.scrollHeight-innerHeight}));
 const sent=(measured.calls??[]).some(c=>String(c).includes('team_hub_post_message')||String(c).includes('paige-ai-chat'));
 if(sent||errors.length||measured.overflowX>1||measured.overflowY>1)report.failures.push({tenant:tenant.key,measured,errors});
 report.records.push({tenant:tenant.key,...measured,errors,sendPressed:false});
 await page.evaluate(label=>{const e=document.createElement('div');e.textContent=label;e.dataset.harnessLabel='';e.style.cssText='position:fixed;bottom:4px;left:4px;background:#111;color:#fff;padding:3px 6px;font:11px sans-serif;z-index:2147483647';document.body.append(e);},report.label);
 if(!await page.locator('[data-harness-label]').isVisible())throw Error('Missing synthetic label');
 await page.screenshot({path:`${out}/tenant-${tenant.key}-unsent.png`});await page.close();
}}finally{await browser.close();writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({records:report.records.length,failures:report.failures}));if(report.failures.length)process.exitCode=1;
