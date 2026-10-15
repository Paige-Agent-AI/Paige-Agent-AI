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
  const geometry=await confirm.evaluate(el=>{const r=el.getBoundingClientRect();return{contained:el.scrollWidth<=el.clientWidth,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight}});
  const controlBounds=await confirm.getByRole('button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return{name:el.textContent.trim(),left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,visible:getComputedStyle(el).visibility==='visible',viewportWidth:innerWidth,viewportHeight:innerHeight}}));
  const inside=r=>r.left>=-.5&&r.top>=-.5&&r.right<=r.viewportWidth+.5&&r.bottom<=r.viewportHeight+.5&&r.width>0&&r.height>0;
  if(!geometry.contained||!inside(geometry)||controlBounds.length!==2||controlBounds.some(r=>!r.visible||!inside(r)))throw Error('Confirmation or decision controls clipped at native zoom: '+JSON.stringify({geometry,controlBounds}));
  const confirmationScroll=await confirm.evaluate(el=>({scrollable:el.scrollHeight>el.clientHeight,scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
  const cdp=await context.newCDPSession(p);
  if(confirmationScroll.scrollable){
   await p.mouse.move(geometry.left+geometry.width/2,geometry.top+geometry.height/2);await p.mouse.wheel(0,-2000);await p.waitForFunction(()=>{const el=document.querySelector('[role=alertdialog]');return el&&el.scrollTop===0;});
   const titleBounds=await confirm.getByRole('heading').evaluate(el=>{const r=el.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight}});if(!inside(titleBounds))throw Error('Confirmation title not reachable at native zoom');
   const topShot=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});fs.writeFileSync(path.join(out,`${theme}-${factor*100}-${mode}-top.png`),Buffer.from(topShot.data,'base64'));
   await cancel.scrollIntoViewIfNeeded();confirmationScroll.topReachable=true;confirmationScroll.titleBounds=titleBounds;confirmationScroll.bottomRestored=await cancel.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight});if(!confirmationScroll.bottomRestored)throw Error('Cancel not restored after confirmation scrolling');
  }
  const shot=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});await cdp.detach();const png=Buffer.from(shot.data,'base64');const capture={width:png.readUInt32BE(16),height:png.readUInt32BE(20),mechanism:'CDP compositor surface, captureBeyondViewport=false'};
  if(capture.width<zoom.innerWidth*factor-2||capture.height<zoom.innerHeight*factor-2)throw Error('Capture lost physical browser viewport: '+JSON.stringify({capture,zoom}));
  fs.writeFileSync(path.join(out,`${theme}-${factor*100}-${mode}.png`),png);await cancel.click();await confirm.waitFor({state:'hidden'});
  if((await p.evaluate(()=>window.__opsMountedFixture.calls())).some(c=>['operations_delivery_submit_scoped','operations_delivery_review_scoped','operations_delivery_release_scoped'].includes(c.name)))throw Error('Cancelled confirmation wrote');
  if(!await action.evaluate(el=>document.activeElement===el))throw Error('Confirmation did not restore focus');
  results.push({theme,zoomPercent:factor*100,mode,zoom,documentGeometry,focus,geometry,controlBounds,confirmationScroll,capture,cancelNoWrite:true,focusRestored:true,reducedMotion:true});console.log('ZOOM_PASS',theme,factor,mode);
 }
 }finally{await context.close();}
}
fs.writeFileSync(path.join(__dirname,'mounted-zoom-verification.json'),JSON.stringify({supersedes:'Original Playwright screenshots were reduced CSS-frame crops and did not establish visual zoom PASS; retained in native-zoom-original-evidence.json and legacy-zoom-capture-failure.png. No product clipping was established by those captures.',boundary:'Actual Solo shell and mounted Operations with synthetic RPCs in isolated signed-out native Chrome 200/400 percent browser zoom. No real customer account/persistence/provider/INT346 proof.',results,errors},null,2));console.log(JSON.stringify({cases:results.length,errors}));if(results.length!==8||errors.length)throw Error('Incomplete native zoom proof');
})().catch(e=>{console.error(e);process.exitCode=1});
