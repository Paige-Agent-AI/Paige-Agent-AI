import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=process.cwd(),folder='scripts/proof/e09-customer-entry-ui',output='docs/evidence/ui-delivery/assets/e09-customer-documents';
await fs.mkdir(output,{recursive:true});
const compiled=await build({entryPoints:[`${folder}/documents-source.tsx`],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'explicit-offline-document-sdk',setup(api){api.onResolve({filter:/^@\/integrations\/supabase\/client$/},()=>({path:path.join(root,folder,'documents-adapter.ts')}));}}]});
const cssFile=(await fs.readdir('dist/assets')).find(name=>/^main-.*\.css$/.test(name));assert(cssFile,'Supporting application CSS build required');
let css=await fs.readFile(`dist/assets/${cssFile}`,'utf8');
for(const m of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]){const p=m[1].replace(/["']/g,'');if(p.startsWith('/assets/'))css=css.replaceAll(m[0],`url(data:font/woff2;base64,${(await fs.readFile(path.join('dist',p.slice(1)))).toString('base64')})`);}
const browser=await chromium.launch({headless:true,executablePath:process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined});
const results=[],errors=[];
let activePage=null,activeCase=null;
const cases=[[1536,770,'ready','a'],[1366,768,'ready','b'],[1024,768,'ready','a'],[900,1000,'ready','b'],[390,844,'ready','a'],[320,720,'long','b'],[390,844,'empty','b'],[390,844,'error','a'],[390,844,'revoked','b'],[390,844,'loading','a'],[390,844,'pending','b'],[390,844,'unknown','a'],[390,844,'stored','b'],[390,844,'retry','a'],[390,844,'prior','a'],[390,844,'download-error','b']];
try{
 for(const[width,height,state,context]of cases){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});activePage=page;activeCase={width,height,state,context};page.on('pageerror',e=>errors.push(e.message));
  // Fulfill only the synthetic top-level origin in-process. This preserves real
  // browser secure-context crypto.randomUUID/Blob behavior without any network.
  await page.route('**/*',r=>r.request().isNavigationRequest()&&r.request().url()==='https://e09-documents.tests.invalid/'?r.fulfill({contentType:'text/html',body:`<html data-pg="${context==='b'?'dark':'light'}"><head></head><body><div id="root"></div></body></html>`}):r.abort());
  await page.goto('https://e09-documents.tests.invalid/');await page.addStyleTag({content:css});
  await page.evaluate(seed=>{window.documentSeed=seed;},{state,context});await page.addScriptTag({content:compiled.outputFiles[0].text});await page.getByRole('heading',{name:'Documents',exact:true}).waitFor();
  if(state==='loading'){await page.getByRole('status').waitFor();assert(await page.locator('svg.animate-spin').evaluateAll(es=>es.every(e=>getComputedStyle(e).animationName==='none')));}
  else if(state==='revoked'||state==='error'){await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Upload a document',{exact:true}).count(),0);}
  else{
   const picker=page.getByLabel('Upload a document',{exact:true});await picker.waitFor();const g=await picker.evaluate(e=>({font:parseFloat(getComputedStyle(e).fontSize),height:e.getBoundingClientRect().height}));assert(g.font>=16&&g.height>=44,'Native picker fits phone interaction standard');
   if(['ready','pending','unknown','stored','retry'].includes(state)){
    await picker.setInputFiles({name:'Uploaded.pdf',mimeType:'application/pdf',buffer:Buffer.from('test')});
    page.once('dialog',d=>d.dismiss());await page.getByRole('link',{name:'Back to portal',exact:true}).click();assert.equal(await page.getByText('Existing portal test destination',{exact:true}).count(),0,'Dirty navigation stays on source');
    await page.getByRole('button',{name:'Upload document',exact:true}).click();
    if(state==='pending'){await page.getByRole('button',{name:'Stop waiting',exact:true}).waitFor();await page.getByRole('button',{name:'Stop waiting',exact:true}).click();await page.getByRole('button',{name:'Check saved upload',exact:true}).waitFor();}
    else if(['unknown','stored','retry'].includes(state)){
     await page.getByRole('button',{name:'Check saved upload',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Upload document',exact:true}).isDisabled());await page.screenshot({path:path.join(output,`${width}-${state}-${context}-recovery.png`),fullPage:true});
     await page.getByRole('button',{name:'Check saved upload',exact:true}).click();if(state!=='unknown')await page.getByRole('button',{name:state==='stored'?'Finish saved upload':'Continue upload',exact:true}).click();
     await page.getByText('Document uploaded. It is saved for your team.',{exact:true}).waitFor();
     const c=await page.evaluate(()=>window.documentProof.counts());assert.equal(c.finishes,1);assert.equal(c.transfers,state==='retry'?2:1);
    }else{await page.getByText('Document uploaded. It is saved for your team.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'client-documents-title');}
   }
   if(state==='ready'||state==='download-error'){
    const open=page.getByRole('button',{name:/^Open (Preparation|Other customer)/});await open.click();const dialog=page.getByRole('dialog');await dialog.waitFor();
    if(state==='download-error'){await dialog.getByRole('alert').waitFor();assert.equal(await dialog.getByRole('link',{name:'Download',exact:true}).count(),0);}
    else{const download=page.waitForEvent('download');await dialog.getByRole('link',{name:'Download',exact:true}).click();assert.equal((await download).suggestedFilename(),context==='b'?'Other customer notes.pdf':'Preparation.pdf');await dialog.getByText('Download started.',{exact:true}).waitFor();}
    await page.screenshot({path:path.join(output,`${width}-${state}-${context}-document.png`),fullPage:true});
    const close=dialog.getByRole('button',{name:'Close',exact:true});const box=await close.boundingBox();assert(box.width>=44&&box.height>=44);
    if(state==='ready'&&width===390){await page.keyboard.press('Tab');assert(await dialog.evaluate(e=>e.contains(document.activeElement)),'Keyboard remains in the document dialog');await page.keyboard.press('Escape');}else await close.click();
    assert(await open.evaluate(e=>e===document.activeElement),'Dialog returns focus to the original file');
   }
   if(state==='prior')await page.getByText('Customer upload',{exact:false}).waitFor();
   if(state==='ready'&&width===390){await picker.setInputFiles({name:'PrivateDraft.pdf',mimeType:'application/pdf',buffer:Buffer.from('test')});await page.evaluate(()=>window.documentProof.switchActor());await page.getByRole('button',{name:'Open Other customer notes.pdf',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Upload document',exact:true}).isDisabled());assert.equal(await page.getByText('PrivateDraft.pdf',{exact:false}).count(),0);}
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  const targets=await page.getByRole('button').evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().width>0).map(e=>({h:e.getBoundingClientRect().height,text:e.textContent})));assert(targets.every(t=>t.h>=44),'Reachable44px controls');
  await page.screenshot({path:path.join(output,`${width}-${state}-${context}.png`),fullPage:true});results.push({width,height,state,context,result:'PASS'});await page.close();
 }
 assert.deepEqual(errors,[]);
 const files=['src/pages/app/ClientDocuments.tsx','src/hooks/useClientDocuments.ts','src/lib/client-portal-documents.ts','src/components/client/useClientAccountExit.ts',`${folder}/documents-source.tsx`,`${folder}/documents-adapter.ts`];
 const hashes={};for(const file of files)hashes[file]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({evidenceClass:'actual-source-offline-chromium-leaf',authenticatedAcceptance:'NOT_RUN',fullShell:'NOT_TESTED',physicalSafari:'UNVERIFIED',network:'blocked',hashes,cssSHA256:createHash('sha256').update(css).digest('hex'),results,errors},null,2));console.log(JSON.stringify({passed:results.length,output,evidenceClass:'offline leaf only'}));
}catch(error){
 const destination=path.resolve(root,'../../work',`e09-documents-ui-failure-${Date.now()}`);
 if(activePage&&!activePage.isClosed()){await fs.writeFile(destination+'.json',JSON.stringify({case:activeCase,error:String(error),body:await activePage.locator('body').innerText(),errors},null,2));await activePage.screenshot({path:destination+'.png',fullPage:true});}
 throw error;
}finally{await browser.close();}
