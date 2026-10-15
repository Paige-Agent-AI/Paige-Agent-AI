import {build} from 'esbuild';import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';import {resolve} from 'node:path';import {chromium} from 'playwright';import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['scripts/proof/e04-agreement-preview-ui/source.tsx'],bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':JSON.stringify('production')},alias:{'@/integrations/supabase/client':resolve('scripts/proof/e04-agreement-preview-ui/sdk.ts'),'@':resolve('src')},loader:{'.css':'empty'}});
const cssFile=readdirSync('dist/assets').find(name=>/^main-.*\.css$/.test(name));assert(cssFile,'build the current application first');
const css=readFileSync('dist/assets/'+cssFile,'utf8')+['src/solo/solo-tokens.css','src/solo/sales/sales-billing.css','src/solo/sales/commercial-agreement-preview.css'].map(path=>readFileSync(path,'utf8')).join('\n');
const exe=[chromium.executablePath(),'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);assert(exe);
const browser=await chromium.launch({executablePath:exe,headless:true}),context=await browser.newContext({serviceWorkers:'block'}),errors=[],requests=[],cases=[];
await context.route('**/*',route=>{requests.push(new URL(route.request().url()).origin);return route.abort();});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.route('https://e04-review.invalid/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'}));
const directory='docs/evidence/ui-delivery/assets/e04-commercial-agreement-review';mkdirSync(directory,{recursive:true});
const open=async()=>{await page.getByRole('button',{name:/Inspect commercial package|Refresh commercial package/}).click();await page.getByRole('button',{name:'Review saved agreement',exact:true}).click();await page.getByRole('dialog').waitFor();};
try{
 await page.goto('https://e04-review.invalid/');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
 assert(await page.evaluate(()=>isSecureContext&&!!crypto.subtle));
 const viewports=[{width:1536,height:770},{width:1366,height:768},{width:1024,height:768},{width:900,height:1000},{width:390,height:844},{width:320,height:720}];
 for(const viewport of viewports){await page.setViewportSize(viewport);for(const theme of ['light','dark']){
  await page.getByLabel('Theme',{exact:true}).selectOption(theme);await open();const dialog=page.getByRole('dialog');await dialog.getByText('Original saved service responsibilities.',{exact:false}).waitFor();
  assert(await dialog.getByText('Principal: USD 3,500.00',{exact:false}).isVisible());assert((await dialog.textContent()).includes('2027-08-15 - USD 300.00'));assert((await dialog.textContent()).includes('Invoice draft version 3'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);assert.equal(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth),0);
  const bounds=await dialog.boundingBox();assert(bounds.y>=11&&bounds.y+bounds.height<=viewport.height-11,JSON.stringify({viewport,bounds,error:'Reader must remain inside the actual viewport'}));
  const close=dialog.getByRole('button',{name:'Close',exact:true});const box=await close.boundingBox();assert(box.width>=44&&box.height>=44);
  assert.equal(await dialog.getAttribute('data-theme'),theme);assert(await dialog.evaluate(el=>el.classList.contains('paige-solo')));await page.screenshot({path:`${directory}/${viewport.width}-${theme}.png`});
  await dialog.evaluate(el=>{el.scrollTop=el.scrollHeight;});const back=dialog.getByRole('button',{name:'Back to invoice',exact:true}),exitBounds=await back.boundingBox();assert(exitBounds.y>=bounds.y&&exitBounds.y+exitBounds.height<=bounds.y+bounds.height+1);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement?.textContent==='Review saved agreement');cases.push({viewport,theme,phase:'canonical-reader-proposal',result:'PASS'});
 }}
 for(const mode of ['pending','missing','denied','error','long']){
  await page.getByLabel('State',{exact:true}).selectOption(mode);await open();const dialog=page.getByRole('dialog');
  if(mode==='pending'){await dialog.getByText('Preparing agreement text…',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(()=>window.reviewFixture.release());assert.equal(await page.getByRole('dialog').count(),0);}
  else if(mode==='missing'){await dialog.getByText('Record tax and fee treatment in the invoice draft.',{exact:true}).waitFor();assert.equal(await dialog.getByText('Original saved service responsibilities.',{exact:false}).count(),0);await page.keyboard.press('Escape');}
  else if(mode==='denied'||mode==='error'){await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByText('Original saved service responsibilities.',{exact:false}).count(),0);await page.keyboard.press('Escape');}
  else{await dialog.getByText('Very long recorded service description',{exact:false}).waitFor();assert.equal(await dialog.evaluate(el=>el.scrollWidth-el.clientWidth),0);await page.keyboard.press('Escape');}
  await page.getByRole('dialog').waitFor({state:'detached'});cases.push({mode,result:'PASS'});
 }
 await page.getByLabel('State',{exact:true}).selectOption('ready');await open();await page.getByText('Original saved service responsibilities.',{exact:false}).waitFor();await page.evaluate(()=>window.reviewFixture.retire());await page.getByRole('dialog').waitFor({state:'detached'});
 await page.emulateMedia({reducedMotion:'reduce'});assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));assert.deepEqual(errors,[]);assert(requests.every(origin=>origin==='https://fonts.googleapis.com'),'only inherited font requests may be attempted and blocked');
 const result={result:'PASS',cases:cases.length,details:cases,requestsBlocked:requests.length,additional:'Actual mounted inspection and canonical proposal/source/schedule/hash modules; fake database transports, no authentication or writes. Portal, Escape focus, late close, scope retirement, missing/denied/error, long body. Native zoom and provider acceptance unverified.'};writeFileSync(`${directory}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,details:undefined}));
}finally{await context.close();await browser.close();}
