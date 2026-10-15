import {chromium} from 'playwright';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const executablePath=[chromium.executablePath(),'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);assert(executablePath);
const browser=await chromium.launch({executablePath,headless:true});
const context=await browser.newContext({serviceWorkers:'block',deviceScaleFactor:1});
const errors=[],external=[];let cases=0;
await context.route('**/*',route=>{external.push(route.request().url());return route.abort();});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
const origin='https://e04-preparation-prototype.invalid';
const html='docs/evidence/experience-04-prototype/retained-agreement-preparation.html';
await page.route(origin+'/**',route=>{
 const path=new URL(route.request().url()).pathname;
 const file=path==='/'+html?html:path==='/src/solo/solo-tokens.css'?'src/solo/solo-tokens.css':path==='/src/solo/sales/collections/collections.css'?'src/solo/sales/collections/collections.css':null;
 assert(file,'Unexpected local prototype resource');
 let body=readFileSync(file,'utf8');if(file.endsWith('.css'))body=body.replace(/^@import[^\r\n]*(?:\r?\n|$)/m,'');
 return route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/html',body});
});
const directory='work/retained-agreement-preparation-prototype';mkdirSync(directory,{recursive:true});
const state=()=>page.evaluate(()=>window.preparationPrototype.state());
const dialog=page.getByRole('dialog');
const close=async()=>{await dialog.getByRole('button',{name:'Back to invoice',exact:true}).click();await dialog.waitFor({state:'hidden'});};
try{
 await page.goto(origin+'/'+html);
 for(const viewport of [{width:1366,height:768},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  for(const theme of ['light','dark'])for(const mode of ['ready','missing','changed','denied','off','unknown','receipt_failed','prepared']){
   await page.evaluate(value=>window.preparationPrototype.reset(value),mode);
   await page.getByLabel('Theme',{exact:true}).selectOption(theme);
   if(mode==='prepared'){
    await page.locator('#inspect').click();await dialog.getByText('Service agreement — sample version 4',{exact:false}).waitFor();
    const text=await dialog.locator('.document').textContent();assert(text.includes('\n\n'));assert(!text.includes('\\n'));assert(text.includes('Service start: November 1, 2026'));
    await close();assert.equal((await state()).writes,1);cases++;continue;
   }
   await page.locator('#prepare').click();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
   assert.equal(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth),0);
   const bounds=await dialog.boundingBox();assert(bounds.y>=15&&bounds.y+bounds.height<=viewport.height-15);
   assert.equal(await dialog.getAttribute('data-theme'),theme);
   const appearance=await dialog.evaluate(el=>({font:getComputedStyle(el).fontFamily,background:getComputedStyle(el).backgroundColor}));
   assert(appearance.font.includes('Geist'));assert.equal(appearance.background,theme==='dark'?'rgb(20, 17, 41)':'rgb(255, 255, 255)');
   if(['missing','changed','denied','off'].includes(mode)){
    await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByRole('button',{name:'Retain version 4 for signatures',exact:true}).count(),0);
    assert.equal((await state()).writes,0);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
   }else{
    const approve=dialog.getByRole('button',{name:'Retain version 4 for signatures',exact:true});
    await approve.waitFor();
    for(const button of await dialog.getByRole('button').all()){const box=await button.boundingBox();assert(box.height>=44);}
    if(mode==='ready'){
     await page.screenshot({path:`${directory}/${viewport.width}-${theme}.png`});
     await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal((await state()).writes,0);
     await page.locator('#inspect').click();assert((await dialog.locator('.document').textContent()).includes('ten monthly advisory sessions'));await close();
     await page.locator('#prepare').click();
    }
    await approve.click();
    if(mode==='unknown'){
     assert(await dialog.getByRole('button',{name:'Cancel',exact:true}).isDisabled());await page.keyboard.press('Escape');assert(await dialog.isVisible());
     await dialog.getByRole('button',{name:'Recover original operation',exact:true}).click();assert.equal((await state()).writes,1);
    }else if(mode==='receipt_failed'){
     await dialog.getByRole('alert').waitFor();assert.equal((await state()).writes,0);assert(await approve.isDisabled());await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    }else{
     assert.equal((await state()).writes,1);assert(await page.locator('#prepare').isHidden());
     await page.locator('#signatures').click();await dialog.getByText('Existing agreement signature management · exact retained version 4',{exact:true}).waitFor();
     await dialog.getByRole('button',{name:'Review signing-link request',exact:true}).click();assert.equal((await state()).linkRequests,0);
     await dialog.getByRole('button',{name:'Generate link (simulation)',exact:true}).click();assert.equal((await state()).linkRequests,1);await close();
     await page.reload();assert.equal((await state()).prepared,true);assert.equal((await state()).writes,1);
     await page.locator('#refresh').click();assert.equal((await state()).writes,1);
    }
   }
   await dialog.waitFor({state:'hidden'});
   if(mode!=='ready'){const focus=(await state()).prepared?'inspect':'prepare';await page.waitForFunction(id=>document.activeElement.id===id,focus);}
   cases++;
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const result={result:'PASS',cases,errors,externalRequests:external,scope:'Synthetic local prototype only; incumbent tokens/Collections CSS with external font imports omitted. No product/Auth/storage/approval/signing/send/payment/provider proof.'};
 writeFileSync(`${directory}/result.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await context.close();await browser.close();}
