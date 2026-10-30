// Run Vite with this folder's config on5251, then this read-only synthetic drive.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {resolvePlaywright,buildLaunchOptions} from '../../live-drive.mjs';
const out=path.resolve('docs/evidence/ui-delivery/assets/exp03-lead-draft-allowance');fs.mkdirSync(out,{recursive:true});
const results=[];const {chromium}=await resolvePlaywright();const browser=await chromium.launch(buildLaunchOptions());
async function open({theme='light',paige='closed',width=1366,height=768,draft='eligible',door='ok'}={}){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Any unexpected remote request is blocked: no analytics/provider/auth may escape the prototype.
  await page.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
  await page.goto(`http://127.0.0.1:5251/solo/42/clients/conversations?${new URLSearchParams({theme,paige,draft,door})}`,{timeout:60000});
  const row=page.locator('[data-thread-key]').filter({hasText:'Jordan Rivera'}).first();
  // Narrow PAIGE is the inherited harness's placeholder overlay, not actual dock proof.
  if(paige==='open'&&width<=1024)await row.dispatchEvent('click');else await row.click();
  await page.getByText('You write and send every reply.',{exact:true}).waitFor();
  return {page,errors};
}
async function capture(page,name,extra={}){
  const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
    scrollOwners:[...document.querySelectorAll('*')].filter(e=>e.scrollHeight>e.clientHeight+2&&['auto','scroll'].includes(getComputedStyle(e).overflowY)).map(e=>e.getAttribute('data-canonical-conversations')!==null?'canonical-inbox':e.tagName.toLowerCase()).slice(0,8)}));
  await page.screenshot({path:path.join(out,`${name}.jpg`),type:'jpeg',quality:75});results.push({name,...geometry,...extra});
}
try{
  for(const theme of ['light','dark'])for(const [width,height] of [[1536,770],[1366,768],[1024,768],[900,1000]])for(const paige of ['closed','open']){
    const {page,errors}=await open({theme,width,height,paige});
    await page.getByRole('button',{name:'Edit and review reply',exact:true}).waitFor();
    assert.deepEqual(errors,[]);await capture(page,`${theme}-${width}-${paige}`,{draftVisible:true,errors,proof:paige==='open'&&width<=1024?'UNVERIFIED inherited dock placeholder obscures pointer path':'synthetic native inbox'});await page.close();
  }
  for(const draft of ['hourly','contact','optout','foreign','member','error','malformed']){
    const {page,errors}=await open({draft});
    if(draft==='member')await page.getByText('An owner or admin can review and approve this reply.',{exact:true}).waitFor();
    else if(draft==='error')await page.getByText("Reply drafts couldn't load.",{exact:false}).waitFor();
    else if(draft==='malformed')await page.getByText('No complete email draft is available.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Edit and review reply',exact:true}).count(),0);
    assert.deepEqual(errors,[]);await capture(page,`case-${draft}`,{noApprovalEntry:true,errors});await page.close();
  }
  for(const theme of ['light','dark']){
    const {page,errors}=await open({theme});
    const entry=page.getByRole('button',{name:'Edit and review reply',exact:true});
    await entry.focus();await page.keyboard.press('Enter');
    const subject=page.getByPlaceholder('Subject',{exact:true});assert.equal(await subject.inputValue(),'Your kitchen inquiry');
    const review=page.getByRole('button',{name:'Review reply',exact:true});
    await review.focus();await page.keyboard.press('Enter');
    const approve=page.getByRole('button',{name:'Approve',exact:true});await approve.waitFor();
    await approve.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>window.__harness.rpc.filter(r=>r.name==='functions:comms-email-command'&&r.args?.approved_fingerprint).length),0);
    await capture(page,`${theme}-approval-required`,{nothingApproved:true,keyboardEntryAndReview:true,approvalFocus:await page.evaluate(()=>document.activeElement?.tagName)});
    await page.getByRole('button',{name:'Not now',exact:true}).click();assert.equal(await subject.inputValue(),'Your kitchen inquiry');
    await page.getByRole('button',{name:'Cancel reply edit',exact:true}).click();
    assert.equal(await subject.inputValue(),'');await page.reload();
    await page.locator('[data-thread-key]').filter({hasText:'Jordan Rivera'}).first().click();
    await page.getByRole('button',{name:'Edit and review reply',exact:true}).waitFor();
    assert.deepEqual(errors,[]);await capture(page,`${theme}-reopened`,{syntheticDraftStillAvailable:true,errors});await page.close();
  }
}finally{await browser.close();}
const files=['supabase/functions/growth-process-submission/lead-reply.ts','supabase/functions/growth-process-submission/lead-reply.test.ts','src/pages/admin/ClientsConversations.tsx','src/pages/admin/conversations/LeadReplyDrafts.tsx','src/pages/admin/conversations/useLeadReplyReview.tsx',...['index.html','main.tsx','stubs.ts','vite.config.ts','drive.mjs'].map(n=>`scripts/live-drive/harness/exp03-lead-draft-allowance-mount/${n}`)];
fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify({proof:'synthetic post-worker projection; server eligibility separately tested; not live intake, auth, worker, database or provider execution',files:Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))},null,2)+'\n');
fs.writeFileSync(path.join(out,'state-proof.json'),JSON.stringify({at:new Date().toISOString(),results},null,2)+'\n');
console.log(JSON.stringify({frames:results.length,errors:results.filter(r=>r.errors?.length),out}));
