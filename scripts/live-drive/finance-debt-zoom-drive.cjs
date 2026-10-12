// DEV-ONLY browser zoom proof of real source components; no authenticated data.
const fs = require('fs'), path = require('path'), os = require('os');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'finance-debt-zoom-'));
 fs.mkdirSync(path.join(profile,'Default'));
 fs.writeFileSync(path.join(profile,'Default','Preferences'),JSON.stringify({partition:{default_zoom_level:{x:Math.log(2)/Math.log(1.2)}}}));
 const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROME_BIN,headless:true,viewport:null,args:['--window-size=1536,770']});
 const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('paige.agentRail.sessionCount','10');localStorage.setItem('paige.agentRail.collapsed','true');});
 await page.goto('http://127.0.0.1:5199/finance-debt-credit.html?theme=light&paige=closed',{waitUntil:'domcontentloaded'});
 await page.locator('.debt-credit-workspace').waitFor();await page.evaluate(()=>document.fonts.ready);
 if(await page.locator('[data-tenant-shell]').getAttribute('data-paige')==='open')await page.keyboard.press('Control+Backslash');
 const geometry=await page.evaluate(()=>({width:innerWidth,dpr:devicePixelRatio,bodyWidth:document.documentElement.scrollWidth,scrollOwner:getComputedStyle(document.querySelector('.finance-content')).overflowY}));
 await page.getByLabel('Financing type').selectOption('business_card');
 const opener=page.getByRole('button',{name:'Travel & supplier card',exact:true});await opener.click();await page.getByRole('dialog').waitFor();await page.waitForTimeout(350);await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
 const drawerClosed=await page.getByRole('dialog').count()===0, focusRestored=await opener.evaluate(n=>n===document.activeElement);
 const folder='docs/evidence/ui-delivery/assets/finance-debt-credit';fs.mkdirSync(folder,{recursive:true});await page.screenshot({path:folder+'/finance-debt-zoom-200.png'});
 const result={kind:'actual Chrome browser zoom 200 percent; synthetic source only',codeCommit:process.env.FINANCE_CODE_COMMIT,geometry,drawerClosed,focusRestored,errors};fs.writeFileSync(folder+'/finance-debt-zoom-proof.json',JSON.stringify(result,null,2));await context.close();console.log(JSON.stringify(result));process.exitCode=errors.length||geometry.dpr!==2||geometry.bodyWidth>geometry.width||!drawerClosed||!focusRestored?1:0;
})().catch(e=>{console.error(e);process.exit(1)});
