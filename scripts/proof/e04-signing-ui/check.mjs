import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {buildLaunchOptions} from '../../live-drive/live-drive.mjs';
const exe=[chromium.executablePath(),'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(existsSync);
assert(exe);const server=await createServer({configFile:fileURLToPath(new URL('./vite.config.mjs',import.meta.url))});await server.listen();
const launch=buildLaunchOptions();
// Fixed local proof only; every remote request is denied below. Reuse the
// incumbent launcher's sandbox-safe args while retaining full Chromium's PDF viewer.
delete launch.proxy;
const browser=await chromium.launch({...launch,executablePath:exe}),context=await browser.newContext({serviceWorkers:'block'});
const errors=[],external=[],cases=[];let nativeViewerResources=0;
await context.route('**/*',route=>{
  const parsed=new URL(route.request().url());
  if(parsed.origin==='http://127.0.0.1:54383')return route.continue();
  // Chromium's bundled PDF viewer resources are local browser assets, not
  // external provider requests. Keep all remote HTTP(S) and other extensions blocked.
  if((parsed.protocol==='chrome-extension:'&&parsed.hostname==='mhjfbmdgcfjbbpaeojofohoefgiehjai')||(parsed.protocol==='chrome:'&&parsed.hostname==='resources')){nativeViewerResources++;return route.continue();}
  external.push(parsed.origin);return route.abort();
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const proofSources=['src/pages/sign/AgreementSigning.tsx','src/pages/sign/agreement-signing.css','scripts/proof/e04-signing-ui/fixtures/sdk.ts','scripts/proof/e04-signing-ui/fixtures/source.tsx','scripts/proof/e04-signing-ui/vite.config.mjs'];
const sourceHashes=()=>Object.fromEntries(proofSources.map(p=>[p,createHash('sha256').update(readFileSync(p,'utf8').replaceAll('\r\n','\n')).digest('hex')]));
const before=sourceHashes();
async function waitForNativePdf(){
  const isViewer=frame=>frame.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html');
  const viewer=page.frames().find(isViewer)??await page.waitForEvent('framenavigated',{predicate:isViewer});
  assert(viewer,'the native PDF viewer must exist before a result-path action');
  await viewer.waitForFunction(()=>document.querySelector('pdf-viewer')?.loadState_==='success');
  await viewer.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}
const directory='docs/evidence/ui-delivery/assets/e04-signing-exact-record';mkdirSync(directory,{recursive:true});
const url='http://127.0.0.1:54383/scripts/proof/e04-signing-ui/fixtures/index.html';
const widths=[{width:1536,height:770},{width:1366,height:768},{width:1024,height:768},{width:900,height:1000},{width:390,height:844},{width:320,height:720}];
const resultsOnly=process.argv.includes('--results-only');
if(resultsOnly){
  const previous=JSON.parse(readFileSync(`${directory}/result.json`,'utf8'));
  assert.equal(previous.result,'PASS');assert.equal(previous.cases,12);
  assert.deepEqual(previous.sourceSHA256,before,'Viewport evidence may be reused only for identical owning source and fixtures');
  cases.push(...previous.details);
}
try{
  if(!resultsOnly){
  for(const viewport of widths){
    await page.setViewportSize(viewport);
    for(const colorScheme of ['light','dark']){
      await page.emulateMedia({colorScheme});
      await page.goto(url+'?mode=pending',{waitUntil:'domcontentloaded'});
      await page.getByText('Synthetic service agreement',{exact:true}).waitFor();
      assert(await page.locator('input.ags-sig').isDisabled());
      await page.evaluate(()=>window.signingFixture.release());
      await page.locator('iframe').waitFor();await page.waitForFunction(()=>document.querySelector('.ags-gate')?.getAttribute('data-locked')==='false');
      const isViewer=frame=>frame.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html');
      const viewer=page.frames().find(isViewer)??await page.waitForEvent('framenavigated',{predicate:isViewer});
      assert(viewer,'the native PDF viewer must exist, not just the outer iframe');
      await viewer.waitForFunction(()=>document.querySelector('pdf-viewer')?.loadState_==='success');
      await viewer.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const signature=page.locator('input.ags-sig');assert(await signature.isEnabled());
      const sign=page.getByRole('button',{name:'Sign agreement',exact:true});assert(await sign.isDisabled());
      await signature.focus();await page.keyboard.press('Tab');assert(await page.locator('input[type=checkbox]').first().evaluate(el=>el===document.activeElement));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
      assert.equal(await page.locator('.ags').evaluate(el=>el.getBoundingClientRect().top+scrollY),0,'Native signing canvas starts at the document top, without collapsed white margins');
      await page.screenshot({path:`${directory}/${viewport.width}-${colorScheme}.png`,fullPage:true});
      cases.push({viewport,colorScheme,phase:'actual-PDF-load-with-consent-still-required',result:'PASS'});
    }
  }
  await page.goto(url+'?mode=failed');await page.getByText('The document could not be shown, so signing stays locked.',{exact:true}).waitFor();assert(await page.locator('input.ags-sig').isDisabled());assert.equal(await page.locator('iframe').count(),0);
  await page.screenshot({path:`${directory}/320-document-failure.png`,fullPage:true});
  await page.goto(url+'?mode=text');await page.getByText('Historical text-only agreement.',{exact:false}).waitFor();assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.getByText('$3,500.00',{exact:true}).count(),0);
  await page.goto(url);await page.locator('iframe').waitFor();await page.waitForFunction(()=>document.querySelector('.ags-gate')?.getAttribute('data-locked')==='false');
  await page.evaluate(()=>window.signingFixture.navigate('b'.repeat(64),'pending'));await page.waitForFunction(()=>window.signingFixture.calls.some(name=>name.includes('b'.repeat(64))));assert.equal(await page.locator('iframe').count(),0);assert(await page.locator('input.ags-sig').isDisabled());
  await page.evaluate(()=>window.signingFixture.release());await page.waitForFunction(()=>document.querySelector('.ags-gate')?.getAttribute('data-locked')==='false');assert(await page.getByRole('button',{name:'Sign agreement',exact:true}).isDisabled());
  await page.goto(url+'?mode=denied');await page.getByRole('heading',{name:'This signing link is no longer available',exact:true}).waitFor();assert.equal(await page.locator('iframe').count(),0);
  await page.goto(url+'?mode=ready');await page.locator('iframe').waitFor();await page.emulateMedia({reducedMotion:'reduce'});assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
  const calls=await page.evaluate(()=>window.signingFixture.calls);assert(calls.every(name=>name==='peek_agreement_signing'||name.startsWith('agreement-document?token=')));assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  }
  await page.setViewportSize({width:320,height:720});await page.emulateMedia({colorScheme:'dark'});
  for(const mode of ['signature-recorded','completed','uncertain']){
    await page.goto(url+'?mode='+mode);await page.waitForFunction(()=>document.querySelector('.ags-gate')?.getAttribute('data-locked')==='false');
    await waitForNativePdf();
    await page.locator('input[type=checkbox]').first().check();await page.locator('input[type=checkbox]').nth(1).check();
    await page.getByRole('button',{name:'Sign agreement',exact:true}).click();
    if(mode==='uncertain')await page.getByText('Signing could not be confirmed.',{exact:false}).waitFor();
    else await page.getByRole('heading',{name:mode==='completed'?'Signed and completed':'Your signature is recorded',exact:true}).waitFor();
    if(mode!=='uncertain')assert(await page.locator('h2').evaluate(el=>el===document.activeElement));
    assert.equal(await page.locator('.ags').evaluate(el=>el.getBoundingClientRect().top+scrollY),0);
    assert.equal(await page.getByText('a copy is on its way',{exact:false}).count(),0);
    if(mode==='uncertain')await page.getByRole('alert').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${directory}/320-${mode}.png`});
    assert.equal((await page.evaluate(()=>window.signingFixture.calls)).filter(name=>name==='sign-agreement').length,1);
  }
  for(const mode of ['decline-refused','decline-confirmed']){
    await page.goto(url+'?mode='+mode);await page.waitForFunction(()=>document.querySelector('.ags-gate')?.getAttribute('data-locked')==='false');
    await waitForNativePdf();
    page.once('dialog',dialog=>dialog.accept('Synthetic review reason'));
    await page.getByRole('button',{name:"I don't agree to these terms",exact:true}).click();
    if(mode==='decline-refused'){await page.getByText('Declining could not be confirmed.',{exact:false}).waitFor();assert.equal(await page.getByRole('heading',{name:'You declined this agreement',exact:true}).count(),0);}
    else await page.getByRole('heading',{name:'You declined this agreement',exact:true}).waitFor();
    if(mode==='decline-confirmed')assert(await page.locator('h2').evaluate(el=>el===document.activeElement));
    assert.equal(await page.getByText('has been told',{exact:false}).count(),0);
    if(mode==='decline-refused')await page.getByRole('alert').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${directory}/320-${mode}.png`});
  }
  assert.deepEqual(sourceHashes(),before,'Owning source changed during browser proof');assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  const result={result:'PASS',cases:cases.length,details:cases,nativeViewerResourcesThisRun:nativeViewerResources,reusedViewportMatrixFromIdenticalSources:resultsOnly,sourceSHA256:before,additional:'Actual component/PDF load, keyboard, failure, text fallback, token retirement and reduced-motion preference; five explicit result/decline fixtures, no actual signature/send/payment or authenticated acceptance. Native zoom/print remain unverified.'};writeFileSync(`${directory}/result.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,details:undefined}));
}finally{await context.close();await browser.close();await server.close();}
