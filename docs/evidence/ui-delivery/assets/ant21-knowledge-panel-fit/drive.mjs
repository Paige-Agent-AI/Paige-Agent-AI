import assert from 'node:assert/strict';
import {buildLaunchOptions,resolvePlaywright} from '../../../../../scripts/live-drive/live-drive.mjs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const out=new URL('./',import.meta.url),repo=new URL('../../../../../',import.meta.url);
fs.mkdirSync(out,{recursive:true});
const baseline=process.argv.includes('--baseline');
const originalCss=baseline?execFileSync('git',['show','8232051a66d5a26446a8ae6dd139743debd0c808:src/solo/solo-paige-workspace.css'],{cwd:fileURLToPath(repo),encoding:'utf8'}):null;
const {chromium}=await resolvePlaywright();
const browser=await chromium.launch({...buildLaunchOptions(),timeout:15000}),results=[];
async function mount({width=1514,height=774,theme='light',full=false,second=false,mode='available'}={}){
 const context=await browser.newContext({viewport:{width,height},colorScheme:theme,reducedMotion:'reduce'}),page=await context.newPage();
 page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(20000);
 const errors=[];page.on('pageerror',error=>errors.push(String(error)));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:5277/solo/10001/settings/team?'+new URLSearchParams({theme,...(full?{paige:'full'}:{}),...(second?{tenant:'second'}:{})}));
 await page.getByLabel('Direct PAIGE',{exact:true}).waitFor({state:'attached'});
 await page.evaluate(async({mode,second})=>{
  const moduleUrl=performance.getEntriesByType('resource').find(entry=>entry.name.includes('/supabase-paige-stub.ts'))?.name;
  if(!moduleUrl)throw new Error('Existing synthetic transport module not loaded');
  const {supabase}=await import(moduleUrl);const original=supabase.rpc;
  window.__knowledgeMode=mode;window.__knowledgeCalls=[];
  supabase.rpc=(name,args)=>{
   if(name!=='read_tenant_knowledge')return original(name,args);
   window.__knowledgeCalls.push({name,args});
   if(window.__knowledgeMode==='loading')return new Promise(()=>{});
   if(window.__knowledgeMode==='error')return Promise.resolve({data:null,error:{code:'42501',message:'Synthetic read refusal'}});
   return Promise.resolve({error:null,data:{tenant_id:args.p_expected_tenant,documents:window.__knowledgeMode==='empty'?[]:[1,2,3,4].map(n=>({
    id:'fixture-doc-'+n,tenant_id:args.p_expected_tenant,revision:1,
    title:n===1?'Example operating knowledge for the customer onboarding process':n===2?'LongSourceIdentifier'.repeat(9):(second?'Second context source ':'Synthetic source ')+n,
    summary:'A synthetic source summary for local geometry and interaction verification. '+'LongSourceSummary'.repeat(9),
    category:'process',tags:[],source:'SyntheticSourceIdentifier'.repeat(7),source_url:null,chunk_count:1,
    created_at:'2026-10-16T00:00:00Z',updated_at:'2026-10-16T00:00:00Z',share_to_network:false,network_review_status:'none',
   }))}});
  };
 },{mode,second});
 if(!full&&await page.getByLabel('Direct PAIGE',{exact:true}).getAttribute('aria-expanded')!=='true')await page.getByLabel('Direct PAIGE',{exact:true}).click();
 await page.getByRole('tab',{name:'Knowledge',exact:true}).click();await page.locator('#spw-panel-knowledge:not([hidden])').waitFor();
 if(mode==='available')await page.locator('.spw-source-card').first().waitFor();
 if(originalCss)await page.locator('style[data-vite-dev-id$="/solo-paige-workspace.css"]').evaluate((style,css)=>style.textContent=css,originalCss);
 return {page,context,errors};
}
async function measure(page){return page.evaluate(()=>{
 const panel=document.querySelector('#spw-panel-knowledge'),scroll=panel.querySelector('.spw-scroll'),layout=panel.querySelector('.spw-knowledge-layout');
 const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 const cards=[...panel.querySelectorAll('.spw-source-card')],aside=panel.querySelector('.spw-explainer'),a=rect(aside);
 return {panel:rect(panel),columns:getComputedStyle(layout).gridTemplateColumns,card:cards[0]?rect(cards[0]):null,aside:a,
  overlap:cards.some(el=>{const c=rect(el);return Math.min(c.right,a.right)-Math.max(c.x,a.x)>1&&Math.min(c.bottom,a.bottom)-Math.max(c.y,a.y)>1;}),
  escaping:[...panel.querySelectorAll('.spw-source-card,.spw-card-copy,.spw-provenance,.spw-explainer')].filter(el=>el.scrollWidth-el.clientWidth>1).map(el=>el.className),
  scroll:{height:scroll.clientHeight,content:scroll.scrollHeight,top:scroll.scrollTop,overflow:getComputedStyle(scroll).overflowY},
  horizontalOverflow:scroll.scrollWidth-scroll.clientWidth,pageOverflow:document.documentElement.scrollWidth-innerWidth,
  reducedMotion:matchMedia('(prefers-reduced-motion:reduce)').matches};
 });}
async function inspect(page,name,{shot=true}={}){
 const data=await measure(page);assert.equal(data.overlap,false,name+': source/aside overlap');assert.equal(data.horizontalOverflow,0,name+': Knowledge horizontal overflow');
 assert.deepEqual(data.escaping,[],name+': content must wrap within card');assert.ok(data.scroll.height>0);assert.equal(data.scroll.overflow,'auto');
 if(shot)await page.screenshot({path:fileURLToPath(new URL(name+'.png',out))});results.push({name,...data});console.log('PASS '+name);return data;
}
try{
 const scene=await mount();
 if(baseline){const data=await measure(scene.page);console.log(JSON.stringify(data));fs.writeFileSync(new URL('baseline.json',out),JSON.stringify({expectedFailure:'baseline source/aside overlap',...data},null,2)+'\n');await scene.page.screenshot({path:fileURLToPath(new URL('baseline-overlap.png',out))});assert.equal(data.overlap,false,'baseline source/aside overlap');}
 await scene.page.locator('.spw-source-card').first().getByRole('button',{name:'Review provenance',exact:true}).click();await inspect(scene.page,'after-narrow-light');await scene.context.close();
 for(const [width,height]of [[1536,770],[1366,768],[1024,768],[900,1000]])for(const theme of ['light','dark'])for(const full of [false,true]){
  const {page,context,errors}=await mount({width,height,theme,full}),name=`matrix-${width}x${height}-${theme}-${full?'workspace':'dock'}`;
  const card=page.locator('.spw-source-card').first(),review=card.locator('button[aria-expanded]');
  await page.getByRole('tab',{name:'Knowledge',exact:true}).focus();await page.keyboard.press('Tab');
  assert.equal(await review.evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Enter');
  await page.locator('.spw-provenance').waitFor();await inspect(page,name);
  assert.equal(await review.getAttribute('aria-expanded'),'true');assert.equal(await card.getByRole('button',{name:'Disconnect unavailable',exact:true}).isDisabled(),true);
  await review.focus();assert.equal(await review.evaluate(el=>el.matches(':focus-visible')),true);
  const focus=await review.evaluate(el=>({width:getComputedStyle(el).outlineWidth,style:getComputedStyle(el).outlineStyle}));assert.equal(focus.width,'2px');assert.equal(focus.style,'solid');
  const textContrast=await page.evaluate(()=>{
   const luminance=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
   const background=el=>{for(let p=el;p;p=p.parentElement){const color=getComputedStyle(p).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent')return color;}return 'rgb(255, 255, 255)';};
   return [...document.querySelectorAll('#spw-panel-knowledge .spw-card-copy h3,#spw-panel-knowledge .spw-card-copy p,#spw-panel-knowledge .spw-provenance dt,#spw-panel-knowledge .spw-provenance dd,#spw-panel-knowledge .spw-explainer p')].map(el=>{const a=luminance(getComputedStyle(el).color),b=luminance(background(el));return {tag:el.tagName,ratio:Number(((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2))};});
  });
  await page.keyboard.press('Tab');assert.equal(await card.getByRole('button',{name:'Open in Mind',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('.spw-source-card').nth(1).getByRole('button',{name:'Review provenance',exact:true}).evaluate(el=>el===document.activeElement),true);
  const final=page.locator('.spw-explainer').getByRole('button',{name:'Open in Mind',exact:true}),before=await final.boundingBox();await final.focus();await final.scrollIntoViewIfNeeded();
  const reachable=await final.boundingBox();assert.ok(reachable.y>=0&&reachable.y+reachable.height<=height+1);
  const scrollOwner=await page.evaluate(()=>({knowledgeScroll:document.querySelector('#spw-panel-knowledge .spw-scroll').scrollTop,pageScroll:scrollY}));
  assert.equal(scrollOwner.pageScroll,0);if(before.y+before.height>height)assert.ok(scrollOwner.knowledgeScroll>0);
  await page.keyboard.press('Enter');await page.waitForURL(/\/command-center\/mind/);assert.deepEqual(errors,[],name+': page errors');
  results.push({name:name+'-interaction',focus,textContrast,scrollOwner,finalControlReachable:true,nativeMindRoute:true,sourceCount:4,pageErrors:errors});
  if(!full){await page.locator('#tenant-paige-workspace').getByRole('button',{name:'Fold PAIGE conversation',exact:true}).click();await page.locator('#tenant-paige-workspace[hidden]').waitFor({state:'attached'});await page.screenshot({path:fileURLToPath(new URL(`closed-${width}x${height}-${theme}.png`,out))});results.push({name:`closed-${width}x${height}-${theme}`,workspaceHidden:true});}
  await context.close();
 }
 for(const panelWidth of [320,440,518,640,779,780,900,1040]){
  const {page,context}=await mount({full:true});await page.locator('#spw-panel-knowledge').evaluate((el,width)=>{el.style.width=width+'px';el.style.maxWidth='100%';},panelWidth);
  await page.locator('.spw-source-card').first().getByRole('button',{name:'Review provenance',exact:true}).click();
  const m=await inspect(page,'container-'+panelWidth,{shot:panelWidth===320||panelWidth===780});assert.equal(m.aside.y>m.card.y,panelWidth<780,'content-width breakpoint');await context.close();
 }
 for(const mode of ['loading','empty','error']){
  const {page,context,errors}=await mount({mode,second:true});
  await page.getByText(mode==='loading'?'Loading this account’s knowledge…':mode==='empty'?'No indexed knowledge yet':'Knowledge could not be loaded.',{exact:true}).waitFor();await inspect(page,'state-'+mode);
  if(mode==='error'){
   await page.evaluate(()=>window.__knowledgeMode='available');await page.getByRole('button',{name:'Retry',exact:true}).click();await page.locator('.spw-source-card').first().waitFor();
   assert.equal(await page.locator('.spw-source-card').count(),4);await inspect(page,'state-retried-second-context');
   assert.ok((await page.evaluate(()=>window.__knowledgeCalls)).every(call=>call.args.p_expected_tenant==='harness-tenant-second'));
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 const reflow=await mount({width:683,height:384,full:true,theme:'dark'});await reflow.page.locator('.spw-source-card').first().getByRole('button',{name:'Review provenance',exact:true}).click();await inspect(reflow.page,'reflow-683-dark');await reflow.context.close();
 const sourceCssLfSha256=createHash('sha256').update(fs.readFileSync(new URL('src/solo/solo-paige-workspace.css',repo),'utf8').replaceAll('\r\n','\n')).digest('hex');
 fs.writeFileSync(new URL('results.json',out),JSON.stringify({proof:'LOCAL SYNTHETIC REAL COMPONENT/SHELL; NOT AUTHENTICATED ACCEPTANCE',sourceCssLfSha256,results},null,2)+'\n');
 console.log('PASS '+results.length+' local Knowledge geometry/interaction observations');
}finally{await browser.close();}
