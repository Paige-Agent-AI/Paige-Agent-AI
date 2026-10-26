import http from 'node:http';
import path from 'node:path';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../..'),output=path.join(root,process.env.E09_RENDER_OUTPUT??'outputs/e09-private-record-controls'),out=path.join(output,'render');
mkdirSync(out,{recursive:true});
const css=readFileSync(path.join(root,'src/index.css'),'utf8');
const selectors=['[data-pg]','[data-pg="dark"]','[data-pg="light"]'];
let tokens='';
for(const selector of selectors){const needle=selector+' {';const start=css.indexOf(needle);if(start<0)throw Error('Missing original token block');const end=css.indexOf('}',start);tokens+=css.slice(start,end+1)+'\n';}
copyFileSync(path.join(root,'public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2'),path.join(out,'font.woff2'));
await build({entryPoints:[path.join(here,'source.tsx')],bundle:true,outfile:path.join(out,'app.js'),format:'esm',jsx:'automatic',alias:{'@/integrations/supabase/client':path.join(here,'adapter.ts'),'@':path.join(root,'src')},define:{'process.env.NODE_ENV':'"development"'}});
writeFileSync(path.join(out,'tokens.css'),tokens+'\n@font-face{font-family:"Schibsted Grotesk";src:url("./font.woff2") format("woff2");font-weight:100 900;font-display:swap;}\n*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--pg-canvas);color:var(--pg-ink);font:14px/1.5 var(--pg-font-ui)}main{max-width:960px;margin:auto;border:1px solid var(--pg-line);border-radius:var(--pg-r-plate);background:var(--pg-canvas)}button,input,textarea{font-family:inherit}@media(max-width:480px){body{padding:12px}}');
writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="en" data-pg="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Customer requests</title><link rel="stylesheet" href="./tokens.css"><link rel="stylesheet" href="./app.css"></head><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>');

const served=out,screens=path.join(output,'screens');mkdirSync(screens,{recursive:true});
const allowed=new Set(['index.html','app.js','app.css','tokens.css','font.woff2']);
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://127.0.0.1').pathname.slice(1)||'index.html';if(!allowed.has(name)){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':name.endsWith('.js')?'application/javascript':'font/woff2');res.end(readFileSync(path.join(served,name)));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;const report={sources:['src/components/tenant-relationships/ClientPrivateRequests.tsx','src/components/tenant-relationships/client-private-requests.css','src/components/tenant-relationships/ClientActionItems.tsx','src/hooks/useClientPrivateRequest.ts','src/index.css'].map(file=>({file,sha256:createHash('sha256').update(readFileSync(path.join(root,file))).digest('hex')})),kind:'isolated original-component render; local deterministic ports; no authenticated or full-shell proof',checks:[],screenshots:[],failures:[],externalRequests:[]};
try{
 if(!existsSync(chromium.executablePath()))throw Error(`Local test Chromium unavailable: ${chromium.executablePath()}`);
 browser=await chromium.launch({headless:true});const context=await browser.newContext({reducedMotion:'reduce'});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();report.externalRequests.push(route.request().url());return route.abort();});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const theme of ['light','dark'])for(const viewport of [{width:1536,height:770},{width:1366,height:768},{width:1024,height:768},{width:900,height:1000},{width:390,height:844},{width:320,height:700}]){
  await page.setViewportSize(viewport);await page.goto(`${origin}/?theme=${theme}`);await page.getByLabel('Request title').waitFor();await page.evaluate(()=>document.fonts.ready);
  const geometry=await page.evaluate(()=>{const root=document.documentElement;return {width:innerWidth,scrollWidth:root.scrollWidth,font:getComputedStyle(document.querySelector('input')).fontFamily,targets:[...document.querySelectorAll('button,input')].filter(e=>e.getClientRects().length).map(e=>({label:e.getAttribute('aria-label')||e.textContent,rect:{height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width}}))};});
  assert(geometry.scrollWidth<=geometry.width+1,`Horizontal overflow ${theme}/${viewport.width}`);assert(geometry.targets.every(x=>x.rect.height>=44&&x.rect.width>=44),'Touch target');
  const colors=await page.evaluate(()=>{const style=getComputedStyle(document.querySelector('.trc-private-request')),body=getComputedStyle(document.body);const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);const luminance=color=>rgb(color).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);const ratio=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);const muted=getComputedStyle(document.querySelector('.trc-private-note')).color;return {ink:style.color,muted,background:body.backgroundColor,inkContrast:ratio(style.color,body.backgroundColor),mutedContrast:ratio(muted,body.backgroundColor),fontLoaded:document.fonts.check('14px "Schibsted Grotesk"')};});
  assert(colors.inkContrast>=4.5&&colors.mutedContrast>=4.5,'Text contrast');assert(colors.fontLoaded,'Original font');
  const filename=`${theme}-${viewport.width}.png`;await page.screenshot({path:path.join(screens,filename),fullPage:true});report.screenshots.push(filename);report.checks.push({theme,viewport,geometry,colors});
 }
 for(const theme of ['light','dark'])for(const viewport of [{width:1536,height:770},{width:1366,height:768},{width:1024,height:768},{width:900,height:1000},{width:390,height:844},{width:320,height:700}]){
  await page.setViewportSize(viewport);await page.goto(`${origin}/?theme=${theme}&state=saved`);const review=page.getByRole('button',{name:'Review sharing with PAIGE',exact:true});await review.waitFor();
  const geometry=await review.evaluate(e=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,rect:{width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}}));
  assert(geometry.scrollWidth<=geometry.width+1,'Saved review overflow');assert(geometry.rect.width>=44&&geometry.rect.height>=44,'Saved review target');
  const filename=`saved-review-${theme}-${viewport.width}.png`;await page.screenshot({path:path.join(screens,filename),fullPage:true});report.screenshots.push(filename);report.checks.push({state:'saved-review',theme,viewport,geometry,result:'PASS'});
 }
 await page.setViewportSize({width:1280,height:900});await page.goto(`${origin}/?theme=light&state=saved`);await page.evaluate(()=>{document.documentElement.style.zoom='2';});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Saved review 200% reflow');await page.getByRole('button',{name:'Review sharing with PAIGE',exact:true}).scrollIntoViewIfNeeded();
 report.checks.push({state:'saved-review',interaction:'200% reflow and review reachability',result:'PASS'});
 await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/?theme=light`);
 await page.getByLabel('Request title').fill('Choose your next step');await page.getByLabel('What should the customer do?').fill('Read the guide.\nBring one question.');
 await page.getByRole('button',{name:'Collapse private preparation'}).click();await page.getByRole('button',{name:'Prepare request',exact:true}).click();assert.equal(await page.getByLabel('Request title').inputValue(),'Choose your next step');
 await page.getByRole('button',{name:'Save private request',exact:true}).click();await page.getByText('Saved privately.',{exact:false}).waitFor();assert.equal(await page.getByText('Read the guide.\nBring one question.',{exact:true}).count(),1);
 assert(await page.locator('h5[tabindex]').evaluate(e=>document.activeElement===e));
 const review=page.getByRole('button',{name:'Review sharing with PAIGE',exact:true});
 await review.focus();assert(await review.evaluate(e=>document.activeElement===e));await review.press('Enter');
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.reviewedWork),'test-work');
 await page.screenshot({path:path.join(screens,'review-sharing-390.png'),fullPage:true});report.screenshots.push('review-sharing-390.png');
 report.checks.push({interaction:'actual original review button/keyboard/full saved words; callback is a local port, not Chat or sharing',result:'PASS'});
 await page.getByRole('button',{name:'Prepare another request'}).click();assert.equal(await page.getByLabel('Request title').inputValue(),'');assert(await page.getByLabel('Request title').evaluate(e=>document.activeElement===e));
 report.checks.push({interaction:'type/collapse/reopen/private-save/original readback/start-another/focus',result:'PASS'});
 for(const state of ['unknown','saved','loading','error','refused','recipient-unavailable']){await page.goto(`${origin}/?theme=dark&state=${state}`);await page.getByRole('heading',{name:'Customer action items'}).waitFor();if(state==='unknown'){await page.getByText('Save not confirmed.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Save private request',exact:true}).count(),0);}if(state==='recipient-unavailable'){await page.getByText('Sharing is not available for this customer yet.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Review sharing with PAIGE',exact:true}).count(),0);}await page.screenshot({path:path.join(screens,`${state}-390.png`),fullPage:true});report.screenshots.push(`${state}-390.png`);report.checks.push({state,result:'rendered'});}
 assert.deepEqual(errors,[]);assert.deepEqual(report.externalRequests,[]);
}catch(error){report.failures.push(error.message);process.exitCode=1;}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));writeFileSync(path.join(output,'render-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({checks:report.checks.length,screenshots:report.screenshots.length,failures:report.failures,externalRequests:report.externalRequests.length}));}
