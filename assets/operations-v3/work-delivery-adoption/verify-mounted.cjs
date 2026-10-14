const {chromium}=require('../../../node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const root=__dirname, out=path.join(root,'mounted-captures');fs.mkdirSync(out,{recursive:true});
const id=n=>`ee910000-0000-4000-8000-${String(n).padStart(12,'0')}`;
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.OPERATIONS_BROWSER_EXECUTABLE?{executablePath:process.env.OPERATIONS_BROWSER_EXECUTABLE}:{})});
 const results=[],errors=[];
 try{
  async function open(theme,width,height,mode='review',paigeOpen=false){
   const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'}),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(30000);
   await p.goto(`http://127.0.0.1:8841/shell.html?delivery=${mode}`,{waitUntil:'commit'});await p.evaluate(t=>localStorage.setItem('theme',t),theme);await p.reload({waitUntil:'commit'});
   await p.getByRole('heading',{name:'Keep the promises moving'}).waitFor();
   await p.getByRole('navigation',{name:'Department views'}).getByRole('button',{name:'Work',exact:true}).click();
   if(paigeOpen){await p.getByRole('button',{name:'Direct PAIGE',exact:true}).click();await p.screenshot({path:path.join(out,`work-${theme}-${width}-paige-open.png`)});if(await p.locator('.tcs-paige-backdrop').isVisible())await p.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();}
   return {p,context};
  }
  for(const theme of process.env.OPS_TEST_PART==='prepare'?[]:['dark','light'])for(const[width,height]of[[1536,770],[1366,768],[1024,768],[900,1000],[390,844]])for(const paigeOpen of width===390?[false]:[false,true]){
   const {p,context}=await open(theme,width,height,'review',paigeOpen);
   const entry=p.getByRole('button',{name:'Review deliverable',exact:true});await entry.focus();await p.keyboard.press('Enter');
   await p.getByRole('heading',{name:'Workshop delivery outline',exact:true}).waitFor();
   const panel=p.getByRole('dialog');
   if(await panel.getByRole('button',{name:'Prepare a version',exact:true}).count())throw Error('Nomination lent preparation access');
   if(await panel.getByText('Manage this work',{exact:true}).count())throw Error('Nomination lent Planning editor');
   await p.getByLabel('Review note',{exact:true}).fill('Clarify the workshop handoff.');
   await p.keyboard.press('Escape');if(!await panel.isVisible())throw Error('Dirty review disappeared on Escape');
   if(await p.evaluate(()=>window.__opsMountedFixture.switchWorkspace())!==false)throw Error('Dirty review permitted workspace departure');
   await p.getByRole('button',{name:'Clear review note',exact:true}).click();
   const approve=p.getByRole('button',{name:'Approve internally',exact:true});await approve.focus();await p.keyboard.press('Enter');
   const confirmation=p.getByRole('alertdialog');await confirmation.waitFor();
   await p.screenshot({path:path.join(out,`review-${theme}-${width}-${paigeOpen?'open':'closed'}.png`)});
   if(await confirmation.evaluate(el=>el.scrollWidth>el.clientWidth||el.getBoundingClientRect().height>innerHeight))throw Error('Confirmation clipped');
   await confirmation.getByRole('button',{name:'Keep reviewing',exact:true}).click();await confirmation.waitFor({state:'hidden'});
   if((await p.evaluate(()=>window.__opsMountedFixture.calls())).some(c=>c.name==='operations_delivery_review_scoped'))throw Error('Cancel wrote review');
   await approve.click();await p.getByRole('button',{name:'Confirm internal approval',exact:true}).click();await p.getByRole('button',{name:'Release for client review',exact:true}).waitFor();
   await p.getByRole('button',{name:'Release for client review',exact:true}).click();await p.getByRole('button',{name:'Confirm client release',exact:true}).click();
   await p.getByRole('heading',{name:'Awaiting client review',exact:true}).waitFor();
   if(await p.getByRole('heading',{name:'Client acceptance recorded',exact:true}).count())throw Error('Employee release claimed client acceptance');
   const contained=await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),pageContained=await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
   if(!contained||!pageContained)throw Error('Work drawer horizontal overflow');
   await p.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
   results.push({theme,width,height,paigeInitiallyOpen:paigeOpen,reviewOnly:true,dirtyEscapeHeld:true,workspaceGuard:true,cancelNoWrite:true,approvalReadback:true,releaseReadback:true,clientAcceptanceNotInferred:true,contained,pageContained});console.log('REVIEW_PASS',theme,width,paigeOpen);await context.close();
  }
  for(const theme of ['dark','light'])for(const[width,height]of[[1366,768],[390,844]]){
   const{p,context}=await open(theme,width,height,'prepare');
   console.log('PREPARATION_ENTRY',theme,width);await p.locator('.ops-work-card').filter({hasText:'Prepare stakeholder review'}).click();await p.getByRole('button',{name:'Delivery details',exact:true}).click();await p.getByRole('button',{name:'Prepare a version',exact:true}).click();console.log('PREPARATION_OPEN');
   await p.getByLabel('Studio session',{exact:true}).selectOption(id(20));await p.getByLabel('Saved artifact',{exact:true}).selectOption(id(21));await p.getByLabel('Artifact version',{exact:true}).selectOption(id(17));await p.getByLabel('Independent reviewer',{exact:true}).selectOption(id(4));
   await p.keyboard.press('Escape');if(!await p.getByRole('dialog').isVisible())throw Error('Dirty preparation closed');
   await p.getByRole('button',{name:'Review submission',exact:true}).click();await p.getByRole('button',{name:'Keep preparing',exact:true}).click();
   if((await p.evaluate(()=>window.__opsMountedFixture.calls())).some(c=>c.name==='operations_delivery_submit_scoped'))throw Error('Cancel submitted');
   await p.getByRole('button',{name:'Review submission',exact:true}).click();await p.getByRole('button',{name:'Confirm submission',exact:true}).click();
   await p.getByText('Submission is recorded and verified. Internal review and client acceptance remain separate decisions.',{exact:true}).waitFor();
   await p.screenshot({path:path.join(out,`preparation-${theme}-${width}.png`)});
   results.push({theme,width,height,mode:'preparation',entryFromRealWork:true,dirtyCloseHeld:true,cancelNoWrite:true,submissionReadback:true});console.log('PREPARATION_PASS',theme,width);await context.close();
  }
  fs.writeFileSync(path.join(root,'mounted-verification.json'),JSON.stringify({base:'1203b58b130b3d0f28abd9dd965b76e82cf65be7',boundary:'Actual Solo shell, Work mount and real domain clients with explicit synthetic RPC/readback doubles in isolated Chromium. No production persistence, customer authentication, real employee photos or provider effect. Native Chrome/OS zoom remains unverified.',results,errors},null,2));
  console.log(JSON.stringify({cases:results.length,errors}));if(results.length!==(process.env.OPS_TEST_PART==='prepare'?4:22)||errors.length)throw Error('Incomplete mounted proof');
 }catch(error){console.error('PROOF_FAILURE',error.message);throw error;}finally{await Promise.race([browser.close(),new Promise(r=>setTimeout(r,3000))]);}
})().catch(e=>{console.error(e);process.exitCode=1});
