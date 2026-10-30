import {chromium} from 'playwright';
import {mkdirSync,writeFileSync} from 'node:fs';
const out='docs/evidence/ui-delivery/assets/exp08-team-hub-card-recovery';mkdirSync(out,{recursive:true});
const report={label:'harness render · not live',records:[],failures:[]};
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-proxy-server']});
try {for(const theme of ['dark','light'])for(const width of [1536,1366,1024,900])for(const paige of ['closed','open']) {
 const page=await browser.newPage({viewport:{width,height:width===1536?770:width===900?1000:768}});const errors=[];page.on('pageerror',e=>errors.push(String(e).slice(0,200)));
 await page.goto(`http://127.0.0.1:5297/solo/3855/team-hub?theme=${theme}&recovery=ready`,{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('.th-list').waitFor({timeout:60000});
 if(await page.locator('[data-tenant-shell]').getAttribute('data-paige')!=='closed')await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).first().click();
 await page.locator('.th-conv-item',{hasText:/^daily-management$/}).click();
 const resume=page.getByRole('button',{name:'Resume this approved action',exact:true});await resume.waitFor({state:'visible',timeout:15000});
 await resume.focus();
 if(paige==='open')await page.locator('[data-tenant-paige-command]').click();await page.waitForTimeout(400);
 const measured=await resume.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {viewport:{width:innerWidth,height:innerHeight},rect:{x:r.x,y:r.y,w:r.width,h:r.height},visible:r.width>0&&r.height>0,covered:!hit||!el.contains(hit),disabled:el.disabled,focused:document.activeElement===el,overflowX:document.documentElement.scrollWidth-innerWidth,overflowY:document.documentElement.scrollHeight-innerHeight,paige:document.querySelector('[data-tenant-shell]')?.getAttribute('data-paige')};});
 const name=`${theme}-${width}-${paige}`;report.records.push({name,...measured,errors});
 if(!measured.visible||measured.disabled||measured.overflowX>1||measured.overflowY>1||measured.paige!==paige||(paige==='closed'&&measured.covered)||errors.length)report.failures.push(name);
 await page.evaluate(label=>{const e=document.createElement('div');e.textContent=label;e.dataset.harnessLabel='';e.style.cssText='position:fixed;bottom:4px;left:4px;background:#111;color:#fff;padding:3px 6px;font:11px sans-serif;z-index:2147483647';document.body.append(e);},report.label);
 if(!await page.locator('[data-harness-label]').isVisible())throw Error('Missing synthetic label');
 await page.screenshot({path:`${out}/${name}.png`});await page.close();
}}finally{await browser.close();writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({records:report.records.length,failures:report.failures}));if(report.failures.length)process.exitCode=1;
