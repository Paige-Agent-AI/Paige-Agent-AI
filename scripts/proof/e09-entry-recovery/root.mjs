// Additional actual-main mode of the original local recovery renderer.
// Only App/context/analytics and global CSS are synthetic boundary ports.
// Real React, the original main, PageLoadBoundary and failure CSS execute.
import path from 'node:path';
import assert from 'node:assert/strict';

export async function buildRootRecovery({build,root,out}) {
 const main=path.join(root,'src/main.tsx');
 const fixtures={
  './App.tsx':`import React,{useState}from'react';export default function AppFixture(){const[count,setCount]=useState(0);const p=new URLSearchParams(location.search);if(p.get('flow')!=='root-success'&&p.get('flow')!=='root-provider'&&document.documentElement.dataset.proofRootReady!=='true')throw new Error('Synthetic private application detail');return <main><p>Original context fixture</p><button onClick={()=>setCount(count+1)}>Original action</button><output>{count}</output></main>}`,
  './lib/observability':'export function initObservability(){}',
  'react-helmet-async':`export function HelmetProvider({children}){if(new URLSearchParams(location.search).get('flow')==='root-provider')throw new Error('Synthetic private provider detail');return children}`,
  './index.css':'',
 };
 await build({entryPoints:[main],bundle:true,outfile:path.join(out,'root.js'),format:'esm',jsx:'automatic',alias:{'@':path.join(root,'src')},define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'isolated-original-main-ports',setup(b){
  b.onResolve({filter:/^(?:\.\/App\.tsx|\.\/lib\/observability|react-helmet-async|\.\/index\.css)$/},args=>args.importer===main?{path:args.path,namespace:'root-proof-port'}:null);
  b.onLoad({filter:/.*/,namespace:'root-proof-port'},args=>({contents:fixtures[args.path],loader:args.path.endsWith('.css')?'css':'tsx',resolveDir:root}));
 }}]});
}

export async function checkRootRecovery({page,origin,out,report,rootVisits}) {
 for(const [flow,theme,viewport]of [
  ['root-error','light',{width:1536,height:770}],
  ['root-provider','dark',{width:390,height:844}],
 ]){
  await page.setViewportSize(viewport);await page.goto(`${origin}/app?mode=root&theme=${theme}&flow=${flow}`);
  await page.getByRole('heading',{name:'This page couldn’t open'}).waitFor();
  assert.equal(await page.locator('[data-app-ready]').count(),0);
  assert.equal(await page.getByText(/Synthetic private/).count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(out,`${flow}-${theme}-${viewport.width}.png`),fullPage:true});
  report.checks.push({originalMain:flow,theme,viewport,readyMarker:false,privateErrorText:false});
 }
 await page.goto(`${origin}/app?mode=root&flow=root-success`);await page.getByText('Original context fixture',{exact:true}).waitFor();
 assert.equal(await page.locator('[data-app-ready]').count(),1);
 await page.getByRole('button',{name:'Original action',exact:true}).click();assert.equal(await page.locator('output').textContent(),'1');
 report.checks.push({originalMain:'healthy original stateful child and ready marker retained'});
 await page.goto(`${origin}/app?mode=root&flow=root-retry`);await page.getByRole('heading',{name:'This page couldn’t open'}).waitFor();assert.equal(rootVisits(),1);
 await page.keyboard.press('Tab');assert(await page.getByRole('button',{name:'Reload page'}).evaluate(el=>el===document.activeElement));
 await page.keyboard.press('Enter');await page.getByText('Original context fixture',{exact:true}).waitFor();
 assert.equal(rootVisits(),2);assert.equal(await page.locator('[data-app-ready]').count(),1);
 report.checks.push({originalMain:'explicit keyboard reload resumes the same original address after fixture recovery',documentLoads:2});
}
