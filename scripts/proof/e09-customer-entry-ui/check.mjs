import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
if(process.argv.includes('--actions')){
 await import('./actions-check.mjs');
}else{
const gateway=process.argv.includes('--gateway');
const root=process.cwd(),output=path.join(root,'docs/evidence/ui-delivery/assets',gateway?'e09-customer-return':'e09-customer-direct-entry');
await fs.mkdir(output,{recursive:true});
const bundle=await build({entryPoints:[`scripts/proof/e09-customer-entry-ui/${gateway?'gateway-source':'source'}.tsx`],bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'explicit-offline-sdk',setup(api){api.onResolve({filter:/^@\/integrations\/supabase\/client$/},()=>({path:path.join(root,`scripts/proof/e09-customer-entry-ui/${gateway?'gateway-adapter':'adapter'}.ts`)}));}}]});
const styles=(await fs.readdir('dist/assets')).filter(n=>/^main-.*\.css$/.test(n));assert.equal(styles.length,1);
let css=await fs.readFile(path.join('dist/assets',styles[0]),'utf8');
css+='\n'+await fs.readFile('src/pages/ConsumerInvitation.css','utf8');
for(const m of [...css.matchAll(/url\(([^)]*\.woff2)\)/g)]){const p=m[1].replace(/["']/g,'');if(p.startsWith('/assets/'))css=css.replaceAll(m[0],`url(data:font/woff2;base64,${(await fs.readFile(path.join('dist',p.slice(1)))).toString('base64')})`);}
const browser=await chromium.launch({headless:true,executablePath:process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined});
const results=[],errors=[];
try{
 const sizes=[[1536,770,'choice','a'],[1366,768,'choice','b'],[1024,768,'choice','a'],[900,1000,'choice','b'],[390,844,'choice','a'],[320,720,'choice','b']];
 for(const [width,height,state,context] of gateway?sizes:[...sizes,[390,844,'ready','a'],[390,844,'accepted','b'],[390,844,'wrong','a'],[390,844,'invalid','b'],[390,844,'error','a']]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
  await page.setContent('<html data-pg="light"><head></head><body><div id="root"></div></body></html>');await page.addStyleTag({content:css});
  await page.evaluate(entrySeed=>{window.entrySeed=entrySeed;},{state,context});await page.addScriptTag({content:bundle.outputFiles[0].text});
  if(gateway){
   await page.getByLabel('Email',{exact:true}).waitFor();
   const geometry=await page.getByLabel('Password',{exact:true}).evaluate(e=>({fontSize:getComputedStyle(e).fontSize,height:e.getBoundingClientRect().height}));
   assert(parseFloat(geometry.fontSize)>=16,'Gateway inputs must remain at least16px');assert(geometry.height>=44);
   const toggle=await page.getByRole('button',{name:'Show password',exact:true}).boundingBox();assert(toggle.width>=44&&toggle.height>=44,'Password toggle touch target');
   await page.screenshot({path:path.join(output,`${width}-signin-${context}.png`),fullPage:true});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal gateway overflow');
   await page.getByLabel('Email',{exact:true}).fill('recipient@tests.invalid');await page.getByLabel('Password',{exact:true}).fill('synthetic-password-123');
   await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByText('Verified gateway test destination',{exact:true}).waitFor();
   results.push({width,height,state:'gateway-signin-return',context,result:'PASS',transport:'synthetic-offline',destination:'explicit-test-double'});await page.close();continue;
  }
  await page.getByRole('heading',{level:1}).waitFor();
  if(state==='choice'){
   await page.getByRole('button',{name:'Create your account',exact:true}).click();
   await page.getByLabel('Password',{exact:true}).fill('synthetic-password-123');await page.getByRole('checkbox').check();
   await page.getByRole('button',{name:'Create account and join',exact:true}).scrollIntoViewIfNeeded();
   const geometry=await page.getByLabel('Password',{exact:true}).evaluate(e=>({fontSize:getComputedStyle(e).fontSize,height:e.getBoundingClientRect().height}));
   assert(parseFloat(geometry.fontSize)>=16);assert(geometry.height>=44);
   await page.screenshot({path:path.join(output,`${width}-create-${context}.png`),fullPage:true});
   await page.getByRole('button',{name:'Create account and join',exact:true}).click();
   await page.getByRole('heading',{name:'Check your email',exact:true}).waitFor();
   assert.equal(await page.getByLabel('Password',{exact:true}).count(),0);
   assert(!(await page.evaluate(()=>window.entryProof.calls())).includes('accept_tenant_invite'));
   await page.evaluate(()=>window.entryProof.confirmed());
   await page.getByRole('heading',{name:'Verified portal test destination',exact:true}).waitFor();
   assert.equal((await page.evaluate(()=>window.entryProof.calls())).filter(x=>x==='accept_tenant_invite').length,1);
  }else{
   const expected={ready:'Open your portal',wrong:'Sign out of this session',error:'Try again'}[state];
   if(state==='accepted')await page.getByRole('heading',{name:'Verified portal test destination',exact:true}).waitFor();
   else if(expected)await page.getByRole('button',{name:expected,exact:true}).waitFor();else await page.getByText('Ask the business for a new invitation.',{exact:false}).waitFor();
   await page.screenshot({path:path.join(output,`${width}-${state}-${context}.png`),fullPage:true});
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
  await page.keyboard.press('Tab');results.push({width,height,state,context,result:'PASS',transport:'synthetic-offline'});await page.close();
 }
 assert.deepEqual(errors,[]);
 const hashes=[];for(const p of [...(gateway?['src/pages/PortalGateway.tsx']:['src/pages/JoinWorkspace.tsx','src/pages/ConsumerInvitation.tsx']),'src/pages/ConsumerInvitation.css',styles[0]&&`dist/assets/${styles[0]}`])hashes.push({path:p,sha256:createHash('sha256').update(await fs.readFile(p)).digest('hex')});
 await fs.writeFile(path.join(output,'report.json'),JSON.stringify({engine:'isolated Chromium',authenticated:'NOT_RUN',results,hashes},null,2));
 console.log(JSON.stringify({passed:results.length,output}));
}finally{await browser.close();}
}
