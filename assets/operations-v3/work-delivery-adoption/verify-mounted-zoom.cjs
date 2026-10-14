const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{chromium}=require('../../../node_modules/playwright');
const id=n=>`ee910000-0000-4000-8000-${String(n).padStart(12,'0')}`;
(async()=>{const results=[],errors=[],out=path.join(__dirname,'mounted-zoom-captures');fs.mkdirSync(out,{recursive:true});
for(const factor of [2,4]){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'operations-mounted-zoom-'));fs.mkdirSync(path.join(profile,'Default'));const level=Math.log(factor)/Math.log(1.2);
 fs.writeFileSync(path.join(profile,'Default','Preferences'),JSON.stringify({partition:{default_zoom_level:{x:level,'14695981039346656037':level}}}));
 const context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chrome',viewport:null,args:['--window-size=1366,768','--no-first-run','--no-default-browser-check']});
 try{const p=context.pages()[0];p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));await p.emulateMedia({reducedMotion:'reduce'});
 for(const theme of ['dark','light'])for(const mode of ['review','prepare']){
  await p.goto(`http://127.0.0.1:8841/shell.html?delivery=${mode}`,{waitUntil:'commit'});await p.evaluate(t=>{localStorage.clear();sessionStorage.clear();localStorage.setItem('theme',t)},theme);await p.reload({waitUntil:'commit'});
  await p.getByRole('heading',{name:'Keep the promises moving'}).waitFor();await p.getByRole('navigation',{name:'Department views'}).getByRole('button',{name:'Work',exact:true}).click();
  if(mode==='review'){await p.getByRole('button',{name:'Review deliverable',exact:true}).click();await p.getByRole('heading',{name:'Workshop delivery outline',exact:true}).waitFor();}
  else{await p.locator('.ops-work-card').filter({hasText:'Prepare stakeholder review'}).click();await p.getByRole('button',{name:'Delivery details',exact:true}).click();await p.getByRole('button',{name:'Prepare a version',exact:true}).click();await p.getByLabel('Studio session',{exact:true}).selectOption(id(20));await p.getByLabel('Saved artifact',{exact:true}).selectOption(id(21));await p.getByLabel('Artifact version',{exact:true}).selectOption(id(17));await p.getByLabel('Independent reviewer',{exact:true}).selectOption(id(4));}
  const zoom=await p.evaluate(()=>({innerWidth,innerHeight,devicePixelRatio}));if(Math.abs(zoom.devicePixelRatio-factor)>.01)throw Error('Native browser zoom not established');
  const doc=p.locator('.ops-staff-document');await doc.focus();await p.keyboard.press('PageDown');const documentGeometry=await doc.evaluate(el=>({contained:el.scrollWidth<=el.clientWidth,scrollTop:el.scrollTop,scrollable:el.scrollHeight>el.clientHeight}));if(!documentGeometry.contained||documentGeometry.scrollable&&documentGeometry.scrollTop===0)throw Error('Artifact keyboard scrolling failed');
  const action=p.getByRole('button',{name:mode==='review'?'Approve internally':'Review submission',exact:true});await action.scrollIntoViewIfNeeded();
  for(let i=0;i<45&&!await action.evaluate(el=>document.activeElement===el);i++)await p.keyboard.press('Tab');
  const focus=await action.evaluate(el=>({active:document.activeElement===el,style:getComputedStyle(el).outlineStyle,width:getComputedStyle(el).outlineWidth}));if(!focus.active||focus.style!=='solid'||parseFloat(focus.width)<2)throw Error('Visible keyboard focus missing');
  await p.keyboard.press('Enter');const confirm=p.getByRole('alertdialog');await confirm.waitFor();const cancel=confirm.getByRole('button',{name:mode==='review'?'Keep reviewing':'Keep preparing',exact:true});await cancel.scrollIntoViewIfNeeded();
  const geometry=await confirm.evaluate(el=>({contained:el.scrollWidth<=el.clientWidth,height:el.getBoundingClientRect().height}));if(!geometry.contained||geometry.height>zoom.innerHeight)throw Error('Confirmation clipped at native zoom');
  await p.screenshot({path:path.join(out,`${theme}-${factor*100}-${mode}.png`)});await cancel.click();await confirm.waitFor({state:'hidden'});
  if((await p.evaluate(()=>window.__opsMountedFixture.calls())).some(c=>['operations_delivery_submit_scoped','operations_delivery_review_scoped','operations_delivery_release_scoped'].includes(c.name)))throw Error('Cancelled confirmation wrote');
  if(!await action.evaluate(el=>document.activeElement===el))throw Error('Confirmation did not restore focus');
  results.push({theme,zoomPercent:factor*100,mode,zoom,documentGeometry,focus,geometry,cancelNoWrite:true,focusRestored:true,reducedMotion:true});console.log('ZOOM_PASS',theme,factor,mode);
 }
 }finally{await context.close();}
}
fs.writeFileSync(path.join(__dirname,'mounted-zoom-verification.json'),JSON.stringify({boundary:'Actual Solo shell and mounted Operations with synthetic RPCs in isolated signed-out native Chrome 200/400 percent browser zoom. No real customer account/persistence/provider/INT346 proof.',results,errors},null,2));console.log(JSON.stringify({cases:results.length,errors}));if(results.length!==8||errors.length)throw Error('Incomplete native zoom proof');
})().catch(e=>{console.error(e);process.exitCode=1});
