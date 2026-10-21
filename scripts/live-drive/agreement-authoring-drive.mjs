// Extend the existing Sales source-mount drive; actual owning components/SDK,
// synthetic authority/network only. Never authenticated or provider acceptance.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { buildLaunchOptions, resolvePlaywright } from './live-drive.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const sources = ['src/solo/sales-ops.tsx','src/solo/SalesWorkspace.tsx','src/solo/sales-dialog.tsx','src/hooks/useBeforeUnloadGuard.ts','src/solo/sales/AgreementPreparationWorkspace.tsx','src/solo/sales/AgreementBodyEditor.tsx','src/solo/sales/agreementPreparationApi.ts','src/solo/sales/agreementVocabulary.ts','src/solo/sales/agreement-body-editor.css','src/solo/sales/agreement-preparation.css','package.json','package-lock.json',...['agreement-authoring.tsx','agreement-authoring-ports.ts','agreement-authoring-client.ts','vite.agreement-authoring.config.ts','agreement-authoring.html'].map(file=>'scripts/live-drive/harness/sales-mount/'+file)];
const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async file => [file,createHash('sha256').update((await fs.readFile(path.join(root,file),'utf8')).replaceAll('\r\n','\n')).digest('hex')])));
sources.push('scripts/live-drive/agreement-authoring-drive.mjs');
console.log('Pinning actual source');
const pinned = await hashes();
let compiledRoot = null;
if (process.argv.includes('--compiled')) {
  // Native Vite build of the SAME source-mount graph. Route fulfillment below
  // replaces only local static transport, not components, routing or execution.
  const { build } = await import('vite');
  compiledRoot = path.resolve(root, '../../outputs', `e04-authoring-build-${Date.now()}`);
  console.log('Building actual source-mount bundle');
  await build({ configFile:path.join(root,'scripts/live-drive/harness/sales-mount/vite.agreement-authoring.config.ts'),
    build:{outDir:compiledRoot,emptyOutDir:false,rollupOptions:{input:path.join(root,'scripts/live-drive/harness/sales-mount/agreement-authoring.html')}} });
}
const out = path.join(root,'docs/evidence/ui-delivery/assets/e04-agreement-authoring');
await fs.mkdir(out,{recursive:true});
console.log('Resolving owned Playwright');
const { chromium } = await resolvePlaywright();
console.log('Launching owned headless browser');
const localLaunch = buildLaunchOptions();
// This drive accepts loopback only and denies every remote origin below. Match
// the already verified local editor trial; no relay or production transport.
delete localLaunch.proxy;
const browser = await chromium.launch(localLaunch);
console.log('Owned browser ready');
const context = await browser.newContext({ reducedMotion:'reduce' });
const fontPath = path.join(root,'public/fonts/schibsted-grotesk/schibsted-grotesk-latin-wght-normal.woff2');
const font = await fs.readFile(fontPath);
const fontSHA256 = createHash('sha256').update(font).digest('hex');
await context.addInitScript(({encoded})=>{
  const face = new FontFace('Schibsted Grotesk',`url(data:font/woff2;base64,${encoded})`,{weight:'100 900',style:'normal'});
  document.fonts.add(face);void face.load();
},{encoded:font.toString('base64')});
const tenant = 'aaaaaaaa-0000-4000-8000-000000000001';
const client = 'cccccccc-0000-4000-8000-000000000001';
const records = new Map(), requests = new Map(), calls = [], frames = [], behavior = [], errors = [], blocked = [];
let mode = 'normal';
const receipt = (row,state='created') => ({state,signing_id:row.agreement.id,signature_state:row.agreement.status,version:row.agreement.version,updated_at:row.agreement.updated_at,creation_event_id:row.eventId});
await context.route('**/*',async route=>{
  const url = new URL(route.request().url());
  if(compiledRoot && url.hostname==='127.0.0.1'){
    const relative=url.pathname.startsWith('/assets/')?decodeURIComponent(url.pathname).slice(1):'agreement-authoring.html';
    const target=path.resolve(compiledRoot,relative);
    assert.ok(target.startsWith(compiledRoot+path.sep),'Compiled fixture path escaped build');
    const contentType=target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':'text/html';
    return route.fulfill({status:200,contentType,body:await fs.readFile(target)});
  }
  if (url.hostname==='127.0.0.1' || ['blob:','data:'].includes(url.protocol)) return route.continue();
  blocked.push(url.origin); return route.abort();
});
await context.route('**/__e04_rpc__/**',async route=>{
  const name = new URL(route.request().url()).pathname.split('/').at(-1), args = route.request().postDataJSON();
  calls.push({name,requestId:args._request_id ?? null});
  const answer = value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  if(args._expected_tenant_id!==tenant || mode==='refused') return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'42501',message:'Synthetic refusal'})});
  if(name==='create_paige_agreement_draft_once'){
    assert.equal(args._contact_id,client); const fingerprint=JSON.stringify(args);
    const previous=requests.get(args._request_id);
    if(previous){
      if(previous.fingerprint!==fingerprint) return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001',message:'Synthetic conflict'})});
      return answer(receipt(records.get(previous.id),'recovered'));
    }
    const id=randomUUID(),row={agreement:{id,contact_id:client,offer_id:null,commercial_terms_id:null,title:args._title,body_source:'paige_draft',source_version_id:null,body_markdown:args._body_markdown,has_source_document:false,status:'draft',version:1,updated_at:'2026-10-21T20:00:00Z',expires_at:null,can_edit:true,content_sha256:null,sealed_sha256:null},signers:[],eventId:randomUUID()};
    records.set(id,row);requests.set(args._request_id,{id,fingerprint});
    if(mode==='uncertain-committed')return route.abort('failed');
    return answer(receipt(row));
  }
  if(name==='recover_paige_agreement_draft_creation'){
    const previous=requests.get(args._request_id);return answer(previous?receipt(records.get(previous.id),'recovered'):{state:'unconfirmed'});
  }
  if(name==='read_paige_agreement_preparation'){
    if(mode==='read-error')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'55000',message:'Synthetic read failure'})});
    const row=records.get(args._signing_id);if(row)return answer({agreement:row.agreement,signers:row.signers});
  }
  return answer([]);
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
page.setDefaultNavigationTimeout(30_000);
page.on('pageerror',error=>errors.push(error.message));
const url = (theme='light',paige='closed')=>`http://127.0.0.1:5293/agreement-authoring.html?theme=${theme}&paige=${paige}`;
const newDraft = async()=>{await page.getByRole('button',{name:'New agreement',exact:true}).first().click();await page.getByRole('textbox',{name:'Agreement content'}).waitFor();};
const fill = async(title='Client services agreement')=>{
  await page.getByRole('textbox',{name:'Agreement title',exact:true}).fill(title);
  await page.getByRole('combobox',{name:'Client',exact:true}).selectOption(client);
  const wording='Services and responsibilities\n\nThis synthetic draft records the agreed advisory scope.';
  const content=page.getByRole('textbox',{name:'Agreement content'});
  await content.click();
  // Exercise the editor's paste handler, not Playwright's contenteditable fill
  // shortcut (which mutates DOM without updating this Lexical editor's model).
  // Synthetic known text only; never read or overwrite the system clipboard.
  await content.evaluate((element,text)=>{
    const data=new DataTransfer();data.setData('text/plain',text);
    element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
  },wording);
  await page.getByRole('button',{name:'Text source',exact:true}).click();
  assert.match(await page.getByRole('textbox',{name:'Agreement text source'}).inputValue(),/agreed advisory scope/);
  await page.getByRole('button',{name:'Document',exact:true}).click();
  await page.getByRole('textbox',{name:'Agreement content'}).waitFor();
};
const capture = async(name)=>{await page.screenshot({path:path.join(out,name+'.png')});};
try{
  for(const theme of ['light','dark'])for(const [width,height]of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[320,740]])for(const paige of width>=900?['closed','open']:['closed']){
    console.log(`Rendering ${width}x${height} ${theme} ${paige}`);
    await page.setViewportSize({width,height});await page.goto(url(theme,paige),{waitUntil:'domcontentloaded'});
    if(frames.length===0){await capture('initial-register-diagnostic');console.log('Initial register rendered; opening actual authoring entry');}
    const overlay = width <= 1080 && paige === 'open';
    if(overlay) await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
    await newDraft();await fill();
    await page.getByRole('button',{name:'Save agreement draft',exact:true}).scrollIntoViewIfNeeded();
    const fit=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,pageScroll:scrollY,editor:document.querySelector('.e04-agreement-editor')?.getBoundingClientRect().toJSON(),button:document.querySelector('.e04-preparation button[type=submit]')?.getBoundingClientRect().toJSON()}));
    assert.ok(fit.document<=width+1,JSON.stringify(fit));assert.equal(fit.pageScroll,0,JSON.stringify(fit));
    assert.ok(fit.button.left>=0&&fit.button.right<=width+1&&fit.button.bottom<=height+1,JSON.stringify(fit));
    if(width<600) await capture(`${width}-${height}-${theme}-action`);
    await page.locator('.e04-preparation h2').scrollIntoViewIfNeeded();
    if(overlay) await page.getByRole('button',{name:'Direct PAIGE',exact:true}).click();
    await page.evaluate(()=>document.fonts.ready);await capture(`${width}-${height}-${theme}-${paige}`);frames.push({theme,width,height,paige,fit,nativePaigeOverlay:overlay});
    if(overlay){
      assert.equal(await page.locator('.tcs-paige-backdrop').isVisible(),true);
      await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
      assert.equal(await page.getByRole('textbox',{name:'Agreement title',exact:true}).inputValue(),'Client services agreement');
      assert.match(await page.getByRole('textbox',{name:'Agreement content'}).innerText(),/agreed advisory scope/);
      await capture(`${width}-${height}-${theme}-returned`);
      behavior.push(`${theme} tablet PAIGE overlay fold/reopen retains draft`);
    }
    // A fixture reload can dismiss its genuine native draft warning explicitly.
    page.once('dialog',dialog=>dialog.accept());
  }
  await page.setViewportSize({width:1366,height:850});await page.goto(url(),{waitUntil:'domcontentloaded'});await newDraft();
  await page.getByRole('button',{name:'Save agreement draft',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'Client',exact:true}).evaluate(el=>el===document.activeElement),true);
  await fill();const requestId=new URL(page.url()).searchParams.get('agreement_request');assert.ok(requestId);
  const editor=page.getByRole('textbox',{name:'Agreement content'});await editor.click();await page.keyboard.press('End');await page.keyboard.type(' Retained final sentence.');
  await page.getByRole('button',{name:'Text source',exact:true}).click();
  assert.match(await page.getByRole('textbox',{name:'Agreement text source'}).inputValue(),/Retained final sentence/);
  await page.getByRole('button',{name:'Document',exact:true}).click();await editor.waitFor();
  await page.getByRole('button',{name:'Save agreement draft',exact:true}).click();
  await page.getByText('Recorded wording · revision 1',{exact:true}).waitFor();
  const originalUrl=page.url(),id=new URL(originalUrl).searchParams.get('agreement');assert.equal(id,requests.get(requestId).id);
  assert.match(await page.locator('.e04-preparation-paper').innerText(),/Retained final sentence/);
  assert.match(await page.locator('.e04-preparation').innerText(),/does not establish payment or completion/);
  await page.getByRole('button',{name:'View signing history',exact:true}).click();await page.getByText('Draft recorded',{exact:true}).waitFor();
  await page.reload();await page.getByText('Recorded wording · revision 1',{exact:true}).waitFor();assert.equal(page.url(),originalUrl);await capture('retained-record-reload');
  behavior.push('required-field focus','actual rich keyboard/source round trip','single original native receipt navigation','same-record normal reload','canonical history port','signature/payment/service distinction');
  await page.getByRole('button',{name:'Agreements and terms',exact:true}).click();await newDraft();await fill('Uncertain response recovery');
  mode='uncertain-committed';const uncertainUrl=page.url(),uncertainRequest=new URL(uncertainUrl).searchParams.get('agreement_request');
  await page.getByRole('button',{name:'Save agreement draft',exact:true}).click();await page.getByRole('heading',{name:'Check the original save',exact:true}).waitFor();
  assert.equal(requests.has(uncertainRequest),true);await capture('uncertain-committed');mode='normal';
  await page.getByRole('button',{name:'Check original save',exact:true}).click();await page.getByRole('button',{name:'Open recorded draft',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open recorded draft',exact:true}).click();const choice=page.getByRole('alertdialog');await choice.waitFor();
  assert.match(await choice.innerText(),/does not apply its current wording/);assert.equal(await page.getByRole('button',{name:'Continue editing',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Leave current editor',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'Leave current editor',exact:true}).click();await page.getByText('Recorded wording · revision 1',{exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('agreement'),requests.get(uncertainRequest).id);
  await page.goto(uncertainUrl);await page.getByText('Recorded wording · revision 1',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('agreement'),requests.get(uncertainRequest).id);
  assert.equal(calls.filter(call=>call.name==='create_paige_agreement_draft_once'&&call.requestId===uncertainRequest).length,1);
  behavior.push('committed lost-response truth','RAM wording retained until explicit leave','leave focus/keyboard trap','opaque request reload recovery without another create');
  mode='read-error';await page.reload();await page.getByText('Record unavailable',{exact:true}).waitFor();assert.equal(await page.getByText('Draft preparation',{exact:true}).count(),0);await capture('read-error');mode='normal';
  await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('Recorded wording · revision 1',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Agreements and terms',exact:true}).click();await newDraft();await fill('Private scope fence');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{authorityUnknown:true}})));await page.getByRole('heading',{name:'Agreement access is being checked',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Agreement title',exact:true}).count(),0);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{authorityUnknown:false}})));assert.equal(await page.getByRole('textbox',{name:'Agreement title',exact:true}).inputValue(),'Private scope fence');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{canManage:false}})));await page.getByRole('heading',{name:'Agreement author access required',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Agreement author access required',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{canManage:true}})));assert.equal(await page.getByRole('textbox',{name:'Agreement title',exact:true}).inputValue(),'');
  const callsBeforeBusinessChange=calls.length;
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{activeTenantId:'aaaaaaaa-0000-4000-8000-000000000002'}})));
  await page.getByRole('heading',{name:'Return to the original agreement business',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Agreement content'}).count(),0);assert.equal(calls.length,callsBeforeBusinessChange);
  await page.evaluate(tenant=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{activeTenantId:tenant}})),tenant);
  await page.getByRole('textbox',{name:'Agreement content'}).waitFor();
  behavior.push('original business request fence/no foreign reconciliation','access-state focus');
  behavior.push('selected read failure is not draft/empty','read retry original record','unknown authority hides/restores RAM','revocation erases private RAM');
  // Exercise actual production editor parser fallback; no images/JSX plugin or remote fetch.
  await page.getByRole('button',{name:'Text source',exact:true}).click();const source=page.getByRole('textbox',{name:'Agreement text source'});
  const hostile='Original wording\n\n![diagram](https://blocked.example.test/private.png)';await source.fill(hostile);await page.getByRole('button',{name:'Document',exact:true}).click();
  await page.getByText(/Some document formatting could not be opened/).waitFor();assert.equal(await source.inputValue(),hostile);await capture('source-fallback');
  behavior.push('unregistered formatting preserves exact source without remote fetch');
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(blocked.filter(origin=>origin!=='https://fonts.googleapis.com').length,0,blocked.join(','));
  assert.deepEqual(await hashes(),pinned,'Source changed during native browser drive');
  assert.equal(createHash('sha256').update(await fs.readFile(fontPath)).digest('hex'),fontSHA256,'Shared font changed during proof');
  const report={proofClass:'actual Sales shell/components/editor/SDK; synthetic identity/network only',staticTransport:compiledRoot?'native Vite compiled fixture':'loopback Vite',normalizedLFSourceSHA256:pinned,sharedUIFontSHA256:fontSHA256,frames,behavior,errors,blocked,canonicalRecords:records.size,authenticated:'UNVERIFIED',providers:'NOT_EXERCISED'};
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:'PASS',frames:frames.length,behavior:behavior.length,pageErrors:errors.length}));
}catch(error){await capture('failure').catch(()=>{});await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),errors,blocked,frames,behavior},null,2));throw error;}
finally{await browser.close();}
