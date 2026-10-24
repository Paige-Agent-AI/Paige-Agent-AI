import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=process.cwd(),folder='scripts/proof/e09-client-account-ui',baseline=process.argv.includes('--baseline'),curaIdentity=process.argv.includes('--cura-identity');
const output=path.resolve(root,'../../outputs',curaIdentity?'e09-cura-chat-ui':process.argv.includes('--customer-chat')?'e09-customer-chat-ui':baseline?'e09-mobile-fit-baseline':'e09-mobile-fit-local');await fs.mkdir(output,{recursive:true});
const prior=await fs.readFile(`${folder}/check.mjs`,'utf8');
const fixtureText=prior.match(/const fixtures = (\[[^;]+\]);/)[1];
const fixtures=JSON.parse(fixtureText).filter(x=>!['components/app/PaigeChat','components/dashboard/NotificationBell'].includes(x));
fixtures.push('hooks/useClientChatContext','hooks/useProfileSnapshot','hooks/usePaigeMemory','hooks/useChatDocumentUpload','hooks/use-toast','lib/voice/useDictation','hooks/useNotifications','hooks/useCreditAlerts');
const bundle=await build({entryPoints:[`${folder}/mobile-source.tsx`],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty','.png':'dataurl'},define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false'},plugins:[{name:'explicit-mobile-source-boundaries',setup(api){api.onResolve({filter:/^@\//},args=>fixtures.includes(args.path.slice(2))?{path:path.join(root,folder,'mobile-adapter.tsx')}:undefined);api.onResolve({filter:/^@tanstack\/react-query$/},()=>({path:path.join(root,folder,'mobile-adapter.tsx')}));}}]});
const stylesheet=(await fs.readdir('dist/assets')).find(x=>/^main-.*\.css$/.test(x));assert(stylesheet,'Compile the actual application CSS first');
let css=await fs.readFile(`dist/assets/${stylesheet}`,'utf8');
for(const match of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]){const file=match[1].replace(/["']/g,'');if(file.startsWith('/assets/'))css=css.replaceAll(match[0],`url(data:font/woff2;base64,${(await fs.readFile(path.join('dist',file.slice(1)))).toString('base64')})`);}
const browser=await chromium.launch({headless:true,executablePath:process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined});
const results=[],errors=[];
try{
 for(const[width,height,theme,context]of [[390,744,'light','a'],[320,568,'dark','b'],[700,390,'light','b'],[844,390,'light','b'],[1536,770,'light','a'],[1366,768,'dark','b'],[1024,768,'light','b'],[900,1000,'dark','a']]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
  await page.route('https://portal-mobile.tests.invalid/',route=>route.fulfill({contentType:'text/html',body:`<html class="${theme}" data-pg="${theme}"><head></head><body><div id="root"></div></body></html>`}));
  await page.goto('https://portal-mobile.tests.invalid/');await page.addStyleTag({content:css});await page.evaluate(accountSeed=>{window.accountSeed=accountSeed;},{context,state:'ready',...(curaIdentity?{agentName:context==='a'?'PAIGE':'River Guide'}:{})});
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  try{await page.locator('textarea').waitFor();}catch(error){console.error(JSON.stringify({errors,body:(await page.locator('body').innerText()).slice(0,700)}));throw error;}
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  const measure=()=>page.evaluate(()=>{const input=document.querySelector('textarea'),r=input.getBoundingClientRect();const buttons=[...input.parentElement.querySelectorAll('button')];return {width:innerWidth,height:innerHeight,input:{top:r.top,bottom:r.bottom,width:r.width,height:r.height,font:getComputedStyle(input).fontSize},buttons:buttons.map(b=>({name:b.getAttribute('aria-label')||b.title,height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width,bottom:b.getBoundingClientRect().bottom})),documentHeight:document.documentElement.scrollHeight,documentWidth:document.documentElement.scrollWidth,transcript:document.querySelector('[data-paige-transcript-scroll]')?.getBoundingClientRect().height};});
  const before=await measure();
  if(curaIdentity){const expected=context==='a'?'Cura':'River Guide';assert.equal(await page.getByRole('heading',{name:expected,exact:true}).count(),1);assert.equal(await page.getByRole('textbox',{name:`Message ${expected}`,exact:true}).count(),1);assert.equal(await page.locator('[data-paige-transcript-scroll]').getAttribute('aria-label'),`${expected} conversation`);assert.equal(await page.getByAltText('Paige',{exact:true}).count(),0);assert((await page.locator('body').innerText()).includes(`I’m ${expected}`));assert(!(await page.locator('body').innerText()).includes('Your conversation couldn’t be loaded.'));if(width>=768)assert((await page.locator('body').innerText()).includes(`${expected} is here to help`));before.customerAgent=expected;}

  before.layout=await page.evaluate(()=>{const input=document.querySelector('textarea');const rows=[];for(let e=input;e;e=e.parentElement){const r=e.getBoundingClientRect(),s=getComputedStyle(e);rows.push({tag:e.tagName,class:e.className,top:r.top,bottom:r.bottom,height:r.height,cssHeight:s.height,minHeight:s.minHeight,flex:s.flex,padding:s.padding});}return rows;});
  before.headerControls=await page.evaluate(()=>[...document.querySelector('.h-dvh').firstElementChild.querySelectorAll('button,a')].map(e=>{const r=e.getBoundingClientRect();return {name:e.getAttribute('aria-label')||e.textContent.trim().slice(0,45),left:r.left,right:r.right,width:r.width};}).filter(r=>r.width>0));
  await fs.writeFile(path.join(output,`${width}-${theme}-geometry.json`),JSON.stringify(before,null,2));await page.screenshot({path:path.join(output,`${width}-${theme}.png`),fullPage:true});
  assert(before.input.bottom<=height+1 && before.buttons.every(b=>b.bottom<=height+1),'Composer and controls remain inside the viewport');assert(before.documentWidth<=width,'No page horizontal overflow');
  assert(before.headerControls.every(r=>r.left>=-1&&r.right<=width+1),'Every header control remains reachable without parent clipping');
  await page.locator('textarea').fill('My draft stays here');
  if(width<768){
   assert(parseFloat(before.input.font)>=16,'Mobile input avoids browser auto-zoom');assert(before.buttons.every(b=>b.height>=44&&b.width>=44),'Frequent touch controls are 44px');
   await page.getByRole('button',{name:'Open navigation',exact:true}).click();await page.getByRole('button',{name:'Sign Out',exact:true}).scrollIntoViewIfNeeded();await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open navigation');
   await page.getByRole('button',{name:'Open navigation',exact:true}).click();const close=page.getByRole('button',{name:'Close',exact:true});const closeBox=await close.boundingBox();assert(closeBox.width>=44&&closeBox.height>=44);await close.click();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Open navigation');
   assert.equal(await page.locator('textarea').inputValue(),'My draft stays here','Opening navigation preserves draft');
   before.keyboard=[];
   for(const keyboardHeight of [350,180]){
    await page.evaluate(height=>{const viewport=new EventTarget();Object.assign(viewport,{width:innerWidth,height,scale:1,offsetTop:0});Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});window.dispatchEvent(new Event('resize'));},keyboardHeight);
    await page.waitForFunction(height=>document.querySelector('.h-dvh').style.height===`${height}px`,keyboardHeight);
    await page.waitForFunction(height=>Math.abs(document.querySelector('.h-dvh').getBoundingClientRect().height-height)<1,keyboardHeight);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const keyboard=await measure();
    keyboard.ancestors=await page.locator('textarea').evaluate(input=>{const rows=[];for(let e=input;e;e=e.parentElement){
      const r=e.getBoundingClientRect(),s=getComputedStyle(e);rows.push({class:e.className,style:e.getAttribute('style'),
        top:r.top,bottom:r.bottom,height:s.height,minHeight:s.minHeight,flex:s.flex,display:s.display,visibility:s.visibility});}return rows;});
    await fs.writeFile(path.join(output,`${width}-${theme}-keyboard-${keyboardHeight}-geometry.json`),JSON.stringify(keyboard,null,2));
    assert(keyboard.input.bottom<=keyboardHeight+1&&keyboard.buttons.every(b=>b.bottom<=keyboardHeight+1),'Composer remains reachable in the short keyboard viewport');
    if(keyboardHeight===180){
     await page.getByRole('button',{name:'My progress',exact:true}).scrollIntoViewIfNeeded();
     const afterScroll=await measure();assert(afterScroll.input.bottom<=keyboardHeight+1,'Scrolling the chrome does not hide the composer');
     assert(await page.locator('[data-paige-content-scroll]').evaluate(e=>e.scrollTop>0),'Short keyboard chrome remains reachable through its own scroll owner');
    }
    before.keyboard.push({height:keyboardHeight,result:'PASS',geometry:keyboard,chromeReachable:true,draftRetained:true});
    assert.equal(await page.locator('textarea').inputValue(),'My draft stays here','Keyboard resize preserves the same composer');
    await page.screenshot({path:path.join(output,`${width}-${theme}-keyboard${keyboardHeight===350?'':`-${keyboardHeight}`}-synthetic.png`),fullPage:true});
   }
  }
  results.push({width,height,theme,context,result:'PASS',geometry:before});await page.close();
 }
 assert.deepEqual(errors,[]);const hashes={};for(const file of ['src/pages/AppShell.tsx','src/components/app/AppNav.tsx','src/components/app/PaigeChat.tsx','src/hooks/useClientViewportHeight.ts',`${folder}/mobile-source.tsx`,`${folder}/mobile-adapter.tsx`,`${folder}/mobile-check.mjs`,'supabase/functions/_shared/client-portal-identity.ts'])hashes[file]=createHash('sha256').update(await fs.readFile(file)).digest('hex');
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({evidenceClass:'actual-AppShell-AppNav-PaigeChat-offline-with-explicit-data-provider-doubles',nativeAuth:'NOT_EXECUTED',providerChat:'NOT_EXECUTED',physicalSafariKeyboard:'UNVERIFIED',keyboard:'synthetic VisualViewport event',network:'blocked',hashes,results,errors},null,2));console.log(JSON.stringify({passed:results.length,output}));
}finally{await browser.close();}
