import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=process.cwd(),folder='scripts/proof/e09-customer-entry-ui',output='docs/evidence/ui-delivery/assets/e09-customer-actions';
await fs.mkdir(output,{recursive:true});
const compiled=await build({entryPoints:[`${folder}/actions-source.tsx`],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'explicit-action-capsule-doubles',setup(api){
 api.onResolve({filter:/^@\/integrations\/supabase\/client$/},()=>({path:path.join(root,folder,'actions-adapter.ts')}));
 api.onResolve({filter:/^@\/components\/app\/ClientActivityFeed$/},()=>({path:path.join(root,folder,'actions-leaf.tsx')}));
}}]});
const cssFile=(await fs.readdir('dist/assets')).find(name=>/^main-.*\.css$/.test(name));assert(cssFile,'Supporting application CSS build required');
let css=await fs.readFile(`dist/assets/${cssFile}`,'utf8');
for(const m of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]){const p=m[1].replace(/["']/g,'');if(p.startsWith('/assets/'))css=css.replaceAll(m[0],`url(data:font/woff2;base64,${(await fs.readFile(path.join('dist',p.slice(1)))).toString('base64')})`);}
const browser=await chromium.launch({headless:true,executablePath:process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined});
const errors=[],results=[];
try{
 for(const [width,height,state,context]of [[1536,770,'ready','a'],[1366,768,'ready','b'],[1024,768,'ready','a'],[900,1000,'ready','b'],[390,844,'ready','a'],[320,720,'ready','b'],[320,720,'long','a'],[390,844,'unknown','a'],[390,844,'error','b'],[390,844,'revoked','a'],[390,844,'empty','b'],[390,844,'expired','a'],[390,844,'loading','a'],[390,844,'pending','a'],[390,844,'switch','a'],[900,1000,'exit','b']]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
  await page.setContent(`<html class="${context==='b'?'dark':''}" data-pg="${context==='b'?'dark':'light'}"><head></head><body><div id="root"></div></body></html>`);await page.addStyleTag({content:css});
  await page.evaluate(seed=>{window.actionSeed=seed;},{state,context});await page.addScriptTag({content:compiled.outputFiles[0].text});
  await page.getByRole('heading',{name:'Your action items',exact:true}).waitFor();
  if(['ready','long','unknown','pending','switch','exit'].includes(state)){
   await page.getByRole('button',{name:'Mark complete',exact:true}).waitFor();
   if(state==='switch'||state==='exit'){
    await page.getByRole('button',{name:'Ask a question',exact:true}).focus();await page.keyboard.press('Enter');
    const field=page.getByRole('textbox',{name:'Your question for your team'});await field.fill('Unsent private question');
    if(state==='switch'){
     await page.evaluate(()=>window.actionProof.switchActor());await page.getByText('Other customer request',{exact:true}).waitFor();
     assert.equal(await field.count(),0,'Previous customer draft retired');assert.equal(await page.getByText('Prepare for your session',{exact:true}).count(),0);
     await page.getByRole('button',{name:'Ask a question',exact:true}).click();assert.equal(await field.inputValue(),'');
    }else{
     page.once('dialog',d=>d.dismiss());await page.getByRole('link',{name:'Back to portal'}).click();assert.equal(await field.inputValue(),'Unsent private question');
     page.once('dialog',d=>d.accept());await page.getByRole('link',{name:'Back to portal'}).click();await page.getByText('Existing portal test destination',{exact:true}).waitFor();
     assert.equal(await page.evaluate(()=>window.actionProof.writes()),0);results.push({width,height,state,context,result:'PASS',transport:'synthetic-offline',scope:'actual router/exit guard, keyboard Enter, canceled and confirmed exit; destination is double'});await page.close();continue;
    }
   }else if(state==='ready'){
    await page.getByRole('button',{name:'Ask a question',exact:true}).click();await page.getByRole('textbox',{name:'Your question for your team'}).fill('Which preparation document should I use?');
    const input=await page.getByRole('textbox',{name:'Your question for your team'}).evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),height:el.getBoundingClientRect().height}));assert(input.font>=16&&input.height>=44);
    await page.screenshot({path:path.join(output,`${width}-question-${context}.png`),fullPage:true});
    await page.getByRole('button',{name:'Cancel',exact:true}).click();assert(await page.getByRole('button',{name:'Ask a question',exact:true}).evaluate(el=>el===document.activeElement),'Cancel restores focus');
    await page.getByRole('button',{name:'Mark complete',exact:true}).click();await page.getByText('You completed',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.actionProof.writes()),1);
   }else if(state==='pending'){
    await page.getByRole('button',{name:'Mark complete',exact:true}).click();assert(await page.getByRole('button',{name:'Mark complete',exact:true}).isDisabled());
    assert.equal(await page.getByRole('region',{name:'Your action items'}).locator('svg.animate-spin').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).animationName==='none')),true,'Reduced-motion pending feedback');
   }else if(state==='unknown'){
    await page.getByRole('button',{name:'Mark complete',exact:true}).click();await page.getByRole('button',{name:'Check saved response',exact:true}).waitFor();assert(await page.getByRole('button',{name:'Mark complete',exact:true}).isDisabled());
    await page.screenshot({path:path.join(output,`${width}-unknown-${context}.png`),fullPage:true});await page.getByRole('button',{name:'Check saved response',exact:true}).click();await page.getByText('You completed',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.actionProof.writes()),1);
   }
  }else if(state==='error'||state==='revoked'){
   await page.getByRole('alert').waitFor();assert.equal(await page.getByText("You're all caught up",{exact:true}).count(),0);
   await page.screenshot({path:path.join(output,`${width}-${state}-${context}.png`),fullPage:true});
   if(state==='error'){await page.evaluate(()=>window.actionProof.recover());await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('button',{name:'Mark complete',exact:true}).waitFor();}
  }else if(state==='empty'){await page.getByText("You're all caught up",{exact:true}).waitFor();}
  else if(state==='expired'){await page.getByText('Expired',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Mark complete',exact:true}).count(),0);}
  else await page.getByText('Loading your action items…',{exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No action-page horizontal overflow');
  if(state!=='loading')for(const box of await page.getByRole('region',{name:'Your action items'}).getByRole('button').evaluateAll(buttons=>buttons.filter(b=>b.getBoundingClientRect().height>0).map(b=>b.getBoundingClientRect().height)))assert(box>=44,'Action-page touch targets are at least44px');
  await page.screenshot({path:path.join(output,`${width}-${state}-${context}-final.png`),fullPage:true});results.push({width,height,state,context,result:'PASS',transport:'synthetic-offline',scope:'actual page/hook/brand/router/guard/toaster; Rail and destination are doubles'});await page.close();
 }
 assert.deepEqual(errors,[]);const hashes=[];
 for(const p of ['src/hooks/useMyActions.ts','src/pages/app/ActionItems.tsx',`dist/assets/${cssFile}`])hashes.push({path:p,sha256:createHash('sha256').update(await fs.readFile(p)).digest('hex')});
 await fs.writeFile(`${output}/report.json`,JSON.stringify({engine:'isolated Chromium',authenticated:'NOT_RUN',nativeDevice:'NOT_RUN',fullShell:'UNVERIFIED',font:'incumbent offline fallback',results,hashes},null,2));
 console.log(JSON.stringify({passed:results.length,output}));
}finally{await browser.close();}
