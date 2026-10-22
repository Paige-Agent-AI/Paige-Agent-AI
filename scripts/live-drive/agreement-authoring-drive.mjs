// Extend the existing Sales source-mount drive; actual owning components/SDK,
// synthetic authority/network only. Never authenticated or provider acceptance.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { buildLaunchOptions, resolvePlaywright } from './live-drive.mjs';
import { exerciseAgreementSignerPaths } from './agreement-signer-paths.mjs';
import {exerciseAgreementDocumentFields} from './agreement-document-fields-paths.mjs';
import {installDocumentPreparationPorts} from './agreement-document-preparation-ports.mjs';
import {exerciseDocumentPreparationPaths} from './agreement-document-preparation-paths.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const historyProof = process.argv.includes('--history');
const correctionProof = process.argv.includes('--correction');
const editorLabelsProof = process.argv.includes('--editor-labels');
const templateProof = process.argv.includes('--templates') || editorLabelsProof;
const signerProof = process.argv.includes('--recipients');
const fieldsProof=process.argv.includes('--document-fields');
const preparationsProof=process.argv.includes('--preparations');
const documentFixturePath=path.resolve(root,preparationsProof?'src/solo/sales/fixtures/agreement-document-source.json':'../../outputs/e04-native-document-fixture.json');
const documentFixture=fieldsProof||preparationsProof?JSON.parse(await fs.readFile(documentFixturePath,'utf8')):null;
const documentFixtureSHA=fieldsProof||preparationsProof?createHash('sha256').update(await fs.readFile(documentFixturePath)).digest('hex'):null;
let documentFixtureMode='normal';
const pdfIntakeProof = process.argv.includes('--pdf-intake');
const uploadProof = process.argv.includes('--upload-intent') || pdfIntakeProof;
const sources = ['src/solo/sales-ops.tsx','src/solo/SalesWorkspace.tsx','src/solo/sales-dialog.tsx','src/hooks/useBeforeUnloadGuard.ts','src/solo/sales/AgreementPreparationWorkspace.tsx','src/solo/sales/AgreementBodyEditor.tsx','src/solo/sales/agreementPreparationApi.ts','src/solo/sales/agreementVocabulary.ts','src/solo/sales/agreement-body-editor.css','src/solo/sales/agreement-preparation.css','package.json','package-lock.json',...['agreement-authoring.tsx','agreement-authoring-ports.ts','agreement-authoring-client.ts','vite.agreement-authoring.config.ts','agreement-authoring.html'].map(file=>'scripts/live-drive/harness/sales-mount/'+file)];
const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async file => [file,createHash('sha256').update((await fs.readFile(path.join(root,file),'utf8')).replaceAll('\r\n','\n')).digest('hex')])));
sources.push('scripts/live-drive/agreement-authoring-drive.mjs');
if(historyProof)sources.push('src/solo/sales/AgreementWordingHistory.tsx','src/solo/sales/agreementRevisionApi.ts');
if(correctionProof)sources.push('src/solo/sales/AgreementWordingHistory.tsx','src/solo/sales/agreementRevisionApi.ts','src/solo/sales/AgreementDraftCorrection.tsx','src/solo/sales/agreementCorrectionApi.ts');
if(templateProof)sources.push('src/solo/sales/AgreementTemplateWorkspace.tsx','src/solo/sales/agreementTemplateApi.ts','src/solo/sales/agreement-templates.css','src/solo/sales/AgreementWordingHistory.tsx','src/solo/sales/agreementRevisionApi.ts','src/solo/sales/AgreementDraftCorrection.tsx','src/solo/sales/agreementCorrectionApi.ts');
if(signerProof)sources.push('src/solo/sales/AgreementSignerPreparation.tsx','src/solo/sales/agreementSignerApi.ts','scripts/live-drive/agreement-signer-paths.mjs','src/solo/sales/AgreementWordingHistory.tsx','src/solo/sales/agreementRevisionApi.ts','src/solo/sales/AgreementDraftCorrection.tsx','src/solo/sales/agreementCorrectionApi.ts','src/solo/sales/AgreementTemplateWorkspace.tsx','src/solo/sales/agreementTemplateApi.ts','src/solo/sales/agreement-templates.css');
if(uploadProof)sources.push('src/solo/useSoloAgreementSignings.ts','src/solo/sales/agreementPdfIntake.ts','src/solo/sales-ops.css');
if(fieldsProof)sources.push('src/solo/sales/AgreementDocumentFields.tsx','src/solo/sales/AgreementPdfPage.tsx','src/solo/sales/agreementDocumentModel.ts','src/solo/sales/agreementPdfRenderer.ts','src/solo/sales/agreement-document-fields.css','scripts/live-drive/agreement-document-fields-paths.mjs','scripts/live-drive/harness/sales-mount/agreement-document-fields-mount.tsx','scripts/live-drive/harness/sales-mount/agreement-document-fixture.ts','supabase/functions/_shared/agreements/field-preparation.ts','supabase/functions/_shared/agreements/preparation-json.ts','supabase/functions/_shared/agreements/token.ts','supabase/functions/_shared/sales-collections/primitives.ts');
if(preparationsProof)sources.push('src/solo/sales/AgreementDocumentPreparation.tsx','src/solo/sales/agreementDocumentApi.ts','src/solo/sales/AgreementDocumentFields.tsx','src/solo/sales/AgreementPdfPage.tsx','src/solo/sales/agreementDocumentModel.ts','src/solo/sales/agreementPdfRenderer.ts','src/solo/sales/agreement-document-fields.css','src/solo/sales/fixtures/agreement-document-source.json','scripts/live-drive/agreement-document-preparation-ports.mjs','scripts/live-drive/agreement-document-preparation-paths.mjs','supabase/functions/_shared/agreements/field-preparation.ts','supabase/functions/_shared/agreements/preparation-json.ts','supabase/functions/_shared/agreements/token.ts','supabase/functions/_shared/agreements/retained-document.ts','supabase/functions/_shared/sales-collections/primitives.ts');
console.log('Pinning actual source');
const pinned = await hashes();
let compiledRoot = null;
if (process.argv.includes('--compiled')) {
  // Native Vite build of the SAME source-mount graph. Route fulfillment below
  // replaces only local static transport, not components, routing or execution.
  const { build } = await import('vite');
  compiledRoot = path.resolve(root, '../../outputs', `e04-authoring-build-${Date.now()}-${randomUUID()}`);
  console.log('Building actual source-mount bundle');
  await build({ configFile:path.join(root,'scripts/live-drive/harness/sales-mount/vite.agreement-authoring.config.ts'),
    build:{outDir:compiledRoot,emptyOutDir:false,rollupOptions:{input:path.join(root,'scripts/live-drive/harness/sales-mount/agreement-authoring.html')}} });
}
const out = process.argv.includes('--diagnose-narrow')?path.resolve(root,'../../outputs/e04-document-narrow-diagnostic'):path.join(root,'docs/evidence/ui-delivery/assets',preparationsProof?'e04-mounted-document-preparation':fieldsProof?'e04-agreement-document-fields':pdfIntakeProof?'e04-agreement-pdf-intake':signerProof?'e04-agreement-recipients':editorLabelsProof?'e04-agreement-editor-labels':templateProof?'e04-agreement-templates':uploadProof?'e04-agreement-upload-intent':correctionProof?'e04-agreement-correction':historyProof?'e04-agreement-wording-history':'e04-agreement-authoring');
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
const signerName = 'Alexandra Montgomery — Advisory Services Client';
const signerEmail = 'alexandra.montgomery.advisory.engagements@example.test';
const records = new Map(), requests = new Map(), calls = [], frames = [], behavior = [], errors = [], blocked = [];
const histories = new Map();
const revision = (row,number) => ({id:randomUUID(),agreement_id:row.agreement.id,revision_no:number,
  source_body_version:row.agreement.version,source_updated_at:row.agreement.updated_at,title:row.agreement.title,
  body_source:row.agreement.body_source,retained_at:row.agreement.updated_at,retained_by:null,
  snapshot_sha256:number.toString(16).padStart(64,'0'),contact_id:row.agreement.contact_id,offer_id:null,
  commercial_terms_id:null,source_version_id:null,body_markdown:row.agreement.body_markdown,has_source_document:false});
let mode = 'normal';
const signerRequests=new Map();
let releaseSignerRecovery=null,signerRecoveryEntered=false,signerRecoveryFinished=false;
// Synthetic native ports only; production components/SDK and parsers stay actual.
const templates=new Map();
let releaseTemplateRecovery=null,templateRecoveryEntered=false,templateRecoveryFinished=false;
const originalTemplate=randomUUID();
const suppliedOptions={jurisdiction:null,review_route:'unspecified',reviewer:null};
const templateReceipt=row=>Object.fromEntries(['id','template_slug','title','body_markdown','version','is_active','preparation_options','preparation_purpose','source_template_version_id','source_template_updated_at','created_at','updated_at'].map(key=>[key,row[key]]));
if(templateProof)templates.set(originalTemplate,{id:originalTemplate,template_slug:'service-'+originalTemplate,title:'Supplied service wording',body_markdown:'# Business-supplied scope\n\nSynthetic retained wording for UI proof. No legal sufficiency or completed review is implied.\n',version:1,is_active:true,source_mode:'tenant_fork',has_uploaded_source:false,preparation_purpose:'client_engagement',preparation_options:{...suppliedOptions},source_template_version_id:null,source_template_updated_at:null,created_at:'2026-10-21T20:00:00.123456+00:00',updated_at:'2026-10-21T20:00:00.123456+00:00'});

const receipt = (row,state='created') => ({state,signing_id:row.agreement.id,signature_state:row.agreement.status,version:row.agreement.version,updated_at:row.agreement.updated_at,creation_event_id:row.eventId});
await context.route('**/*',async route=>{
  const url = new URL(route.request().url());
  if(compiledRoot && url.hostname==='127.0.0.1'){
    const relative=url.pathname.startsWith('/assets/')?decodeURIComponent(url.pathname).slice(1):'agreement-authoring.html';
    const target=path.resolve(compiledRoot,relative);
    assert.ok(target.startsWith(compiledRoot+path.sep),'Compiled fixture path escaped build');
    const contentType=/\.m?js$/.test(target)?'text/javascript':target.endsWith('.css')?'text/css':target.endsWith('.html')?'text/html':'application/octet-stream';
    return route.fulfill({status:200,contentType,body:await fs.readFile(target)});
  }
  if (url.hostname==='127.0.0.1' || ['blob:','data:'].includes(url.protocol)) return route.continue();
  blocked.push(url.origin); return route.abort();
});
if(fieldsProof)await context.route('**/__e04_document_fixture__',async route=>{
  const fixture=structuredClone(documentFixture);
  if(documentFixtureMode==='corrupt'){const bytes=Buffer.from(fixture.bytes,'base64');bytes[0]^=1;fixture.bytes=bytes.toString('base64');}
  if(documentFixtureMode==='geometry')fixture.document.pages[0].width+=7;
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)});
});
await context.route('**/__e04_rpc__/**',async route=>{
  const name = new URL(route.request().url()).pathname.split('/').at(-1), args = route.request().postDataJSON();
  calls.push({name,requestId:args._request_id ?? args._version_id ?? args._signer_id ?? null,expectedAt:args._expected_updated_at??null,commandDigest:['save_paige_agreement','create_agreement_template_version','prepare_agreement_signer'].includes(name)?createHash('sha256').update(JSON.stringify(args)).digest('hex'):null});
  const answer = value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  if(args._expected_tenant_id!==tenant || mode==='refused') return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'42501',message:'Synthetic refusal'})});
  if(name==='prepare_agreement_signer'){
    const row=records.get(args._signing_id);assert.ok(row,'Original agreement must exist');
    const prior=signerRequests.get(args._signer_id),fingerprint=JSON.stringify(args);
    if(prior)return prior.fingerprint===fingerprint?answer({...prior.receipt,state:'replayed'}):route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001'})});
    if(mode==='signer-unknown-pending')return route.abort('failed');
    if(mode==='signer-conflict'){row.agreement.version++;row.agreement.updated_at='2026-10-22T04:59:00.123456+00:00';}
    if(row.agreement.contact_id!==args._expected_contact_id||row.agreement.version!==args._expected_version||row.agreement.updated_at!==args._expected_updated_at)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001'})});
    if(row.signers.some(signer=>signer.email===args._email||args._signing_order!==null&&signer.signing_order===args._signing_order))return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'23505'})});
    const signer={id:args._signer_id,full_name:args._full_name,email:args._email,signer_role:args._signer_role,signing_order:args._signing_order??Math.max(0,...row.signers.map(s=>s.signing_order))+1,status:'pending',signed_at:null,declined_at:null};
    row.signers.push(signer);row.agreement.version++;row.agreement.updated_at=`2026-10-22T04:${String(row.agreement.version).padStart(2,'0')}:00.123456+00:00`;
    const retained={schema_version:1,state:'recorded',agreement_id:row.agreement.id,client_id:row.agreement.contact_id,signer_id:signer.id,full_name:signer.full_name,email:signer.email,signer_role:signer.signer_role,signing_order:signer.signing_order,status:'pending',source_version:row.agreement.version,source_updated_at:row.agreement.updated_at,event_id:randomUUID()};
    signerRequests.set(signer.id,{fingerprint,receipt:retained});histories.get(row.agreement.id).push(revision(row,histories.get(row.agreement.id).length+1));
    if(mode==='signer-unknown-saved')return route.abort('failed');return answer(retained);
  }
  if(name==='recover_agreement_signer_preparation'){
    if(mode==='signer-recovery-held'){signerRecoveryEntered=true;await new Promise(resolve=>{releaseSignerRecovery=resolve;});}
    const prior=signerRequests.get(args._signer_id);await answer(prior?{...prior.receipt,state:'recovered'}:{state:'unconfirmed'});signerRecoveryFinished=true;return;
  }
  if(name==='list_agreement_template_versions'){
    if(mode==='template-read-error')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'55000'})});
    const all=[...templates.values()].filter(row=>(!args._active_only||row.is_active)&&(!args._before_created_at||row.created_at<args._before_created_at||row.created_at===args._before_created_at&&row.id<args._before_id)).sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
    const rows=all.slice(0,20),last=rows.at(-1);return answer({items:rows.map(({body_markdown,...row})=>row),next_cursor:all.length>20?{created_at:last.created_at,id:last.id}:null});
  }
  if(name==='read_agreement_template_version'){const row=templates.get(args._version_id);return row?answer(row):route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'42501'})});}
  if(name==='recover_agreement_template_creation'){const row=templates.get(args._version_id);if(mode==='template-recovery-held'){templateRecoveryEntered=true;await new Promise(resolve=>{releaseTemplateRecovery=resolve;});}await answer(row?{state:'recovered',version_record:row}:{state:'unconfirmed'});templateRecoveryFinished=true;return;}
  if(name==='create_agreement_template_version'){
    if(mode==='template-conflict')return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001'})});
    if(mode==='template-unknown-pending')return route.abort('failed');
    if(templates.has(args._version_id))return answer(templateReceipt(templates.get(args._version_id)));
    const source=templates.get(args._previous_version_id),stamp=new Date().toISOString();
    if(source)assert.equal(source.updated_at,args._expected_source_updated_at);
    const row={id:args._version_id,template_slug:source?.template_slug??'service-'+args._version_id,title:args._title.replace(/^ +| +$/g,''),body_markdown:args._body_markdown,version:source?source.version+1:1,is_active:true,source_mode:'tenant_fork',has_uploaded_source:false,preparation_purpose:'client_engagement',preparation_options:args._preparation_options,source_template_version_id:args._previous_version_id,source_template_updated_at:args._expected_source_updated_at,created_at:stamp,updated_at:stamp};
    templates.set(row.id,row);if(source){source.is_active=false;source.updated_at=stamp;}
    if(mode==='template-unknown-saved')return route.abort('failed');return answer(templateReceipt(row));
  }
  if(name==='save_paige_agreement'){
    const row=records.get(args._agreement_id);assert.ok(row,'Synthetic same original must exist');
    assert.equal(args._contact_id,row.agreement.contact_id);assert.equal(args._offer_id,row.agreement.offer_id);assert.equal(args._commercial_terms_id,row.agreement.commercial_terms_id);
    assert.equal(args._body_source,row.agreement.body_source);assert.equal(args._source_version_id,row.agreement.source_version_id);assert.equal(args._document_path,null);
    if(mode==='correction-conflict') { row.agreement.body_markdown='A different authorized correction is currently recorded.';row.agreement.version++;row.agreement.updated_at='2026-10-21T20:20:00Z'; }
    if(args._expected_updated_at!==row.agreement.updated_at)return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001'})});
    if(!row.agreement.can_edit||mode==='correction-blocked')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'23514'})});
    if(mode==='correction-unknown-pending')return route.abort('failed');
    const trim=value=>{let a=0,b=value.length;while(a<b&&value[a]===' ')a++;while(b>a&&value[b-1]===' ')b--;return value.slice(a,b);};
    row.agreement.version+=trim(args._body_markdown)===row.agreement.body_markdown?0:1;
    row.agreement.title=trim(args._title);row.agreement.body_markdown=trim(args._body_markdown);
    row.agreement.updated_at=`2026-10-21T20:10:${String(calls.filter(call=>call.name==='save_paige_agreement').length).padStart(2,'0')}Z`;
    histories.get(args._agreement_id).push(revision(row,histories.get(args._agreement_id).length+1));
    if(mode==='correction-unknown-committed')return route.abort('failed');
    return answer({...row.agreement,tenant_id:tenant});
  }
  if(name==='create_paige_agreement_draft_once'){
    assert.equal(args._contact_id,client); const fingerprint=JSON.stringify(args);
    const previous=requests.get(args._request_id);
    if(previous){
      if(previous.fingerprint!==fingerprint) return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'40001',message:'Synthetic conflict'})});
      return answer(receipt(records.get(previous.id),'recovered'));
    }
    const id=randomUUID(),row={agreement:{id,contact_id:client,offer_id:null,commercial_terms_id:null,title:args._title,body_source:args._body_source??'paige_draft',source_version_id:args._source_version_id??null,body_markdown:args._body_markdown,has_source_document:false,status:'draft',version:1,updated_at:'2026-10-21T20:00:00Z',expires_at:null,can_edit:true,content_sha256:null,sealed_sha256:null},signers:[{id:randomUUID(),full_name:signerName,email:signerEmail,signer_role:'counterparty',signing_order:1,status:'pending',signed_at:null,declined_at:null}],eventId:randomUUID()};
    records.set(id,row);requests.set(args._request_id,{id,fingerprint});histories.set(id,[revision(row,1)]);
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
  if(name==='read_paige_agreement_draft_revisions'||name==='read_paige_agreement_draft_revision'){
    if(mode==='history-refused')return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'42501'})});
    if(mode==='history-list-error'&&name==='read_paige_agreement_draft_revisions'||mode==='history-wording-error'&&name==='read_paige_agreement_draft_revision')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'55000'})});
    const row=records.get(args._signing_id),saved=histories.get(args._signing_id)??[];
    if(name==='read_paige_agreement_draft_revision')return answer(saved.find(item=>item.id===args._revision_id));
    const rows=mode==='history-empty'?[]:saved.filter(item=>args._before_revision_no===null||item.revision_no<args._before_revision_no).toReversed(),take=rows.slice(0,20);
    return answer({agreement_id:row.agreement.id,current_source_version:row.agreement.version,current_updated_at:row.agreement.updated_at,
      revisions:take.map(({id,revision_no,source_body_version,source_updated_at,title,body_source,retained_at,retained_by,snapshot_sha256})=>({id,revision_no,source_body_version,source_updated_at,title,body_source,retained_at,retained_by,snapshot_sha256})),truncated:rows.length>20,next_before_revision_no:rows.length>20?take.at(-1).revision_no:null});
  }
  return answer([]);
});
const documentPorts=preparationsProof?await installDocumentPreparationPorts({context,records,fixture:documentFixture}):null;
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
  if(preparationsProof){
    await exerciseDocumentPreparationPaths({page,url,capture,frames,behavior,ports:documentPorts,agreementId:documentFixture.source.agreement_id});
  }else if(fieldsProof){
    await exerciseAgreementDocumentFields({page,url,capture,frames,behavior,setFixtureMode:value=>{documentFixtureMode=value;}});
  }else if(signerProof){
    await exerciseAgreementSignerPaths({page,url,newDraft,fill,capture,frames,behavior,calls,records,
      setMode:value=>{mode=value;},
      holdRecovery:()=>{mode='signer-recovery-held';signerRecoveryEntered=false;signerRecoveryFinished=false;},
      recoveryState:()=>({entered:signerRecoveryEntered,finished:signerRecoveryFinished}),releaseRecovery:()=>releaseSignerRecovery?.()});
  }else if(templateProof){

    const library=async()=>{await page.getByRole('button',{name:'Business templates',exact:true}).first().click();await page.getByRole('button',{name:'New template',exact:true}).waitFor();};
    let labelsCaptured=false;
    const enter=async()=>{
      await page.getByRole('button',{name:'New template',exact:true}).click();await page.getByRole('textbox',{name:'Template title',exact:true}).waitFor();
      if(editorLabelsProof){
        await page.getByRole('radio',{name:/^Undo (Ctrl\+Z|⌘Z)$/}).waitFor();
        await page.getByRole('radio',{name:/^Redo (Ctrl\+Y|⌘Y)$/}).waitFor();
        await page.getByRole('textbox',{name:'Agreement content',exact:true}).waitFor();
        await page.getByRole('combobox',{name:'Block type',exact:true}).click();
        for(const level of [1,2,3])await page.getByRole('option',{name:`Heading ${level}`,exact:true}).waitFor();
        if(!labelsCaptured){await capture('actual-editor-heading-options');labelsCaptured=true;behavior.push('actual native Undo/Redo shortcuts are expanded','all three real heading options and Agreement content label remain accessible');}
        await page.getByRole('option',{name:'Heading 1',exact:true}).press('Escape');
      }
    };
    const exactWords='# Supplied advisory scope\n\nRetain the actual business responsibilities.\n\tAnd the supplied line breaks.\n';
    const proposal=async()=>{await page.getByRole('textbox',{name:'Template title',exact:true}).fill('Supplied client-service wording');await page.getByRole('button',{name:'Text source',exact:true}).click();await page.getByRole('textbox',{name:'Agreement text source',exact:true}).fill(exactWords);};
    const options=async()=>{const panel=page.locator('.e04-template-options');if(!await panel.evaluate(el=>el.open))await panel.locator('summary').click();await page.getByRole('textbox',{name:'Jurisdiction',exact:true}).fill('Business-specified jurisdiction');await page.getByRole('combobox',{name:'Requested wording review',exact:true}).selectOption('qualified_legal');await page.getByRole('textbox',{name:'Reviewer or review team',exact:true}).fill('Designated review team');};
    const submit=()=>page.getByRole('button',{name:'Save template version',exact:true}).click();
    const stored=()=>page.getByRole('article',{name:'Retained template wording',exact:true}).waitFor();
    for(const theme of ['light','dark'])for(const [width,height]of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[320,740]])for(const paige of width>=900?['closed','open']:['closed']){
      await page.setViewportSize({width,height});await page.goto(url(theme,paige),{waitUntil:'domcontentloaded'});
      const overlay=width<=1080&&paige==='open';if(overlay)await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
      await library();await enter();await proposal();await options();const submitButton=page.getByRole('button',{name:'Save template version',exact:true});await submitButton.scrollIntoViewIfNeeded();
      const fit=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,pageScroll:scrollY,button:document.querySelector('[aria-label="Template version editor"] button[type=submit]')?.getBoundingClientRect().toJSON(),navigation:document.querySelector('.sales-tabs')?.getBoundingClientRect().toJSON(),selected:document.querySelector('.sales-tabs [aria-selected=true]')?.getBoundingClientRect().toJSON(),destinations:document.querySelectorAll('.sales-tabs [role=tab]').length}));
      assert.ok(fit.document<=width+1,JSON.stringify(fit));assert.equal(fit.pageScroll,0);assert.ok(fit.button.left>=0&&fit.button.right<=width+1&&fit.button.bottom<=height+1,JSON.stringify(fit));
      if(editorLabelsProof&&width<600){assert.ok(fit.navigation.height<=60,JSON.stringify(fit));assert.ok(fit.selected.left>=0&&fit.selected.right<=width+1,JSON.stringify(fit));assert.equal(fit.destinations,6);}
      if(width<600)await capture(`${width}-${height}-${theme}-action`);
      await page.locator('.e04-templates h2').scrollIntoViewIfNeeded();if(overlay)await page.getByRole('button',{name:'Direct PAIGE',exact:true}).click();await page.evaluate(()=>document.fonts.ready);await capture(`${width}-${height}-${theme}-${paige}`);frames.push({theme,width,height,paige,fit,nativePaigeOverlay:overlay});
      if(overlay){await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();assert.equal(await page.getByRole('textbox',{name:'Template title',exact:true}).inputValue(),'Supplied client-service wording');}
      page.once('dialog',dialog=>dialog.accept());
    }
    await page.setViewportSize({width:1366,height:768});await page.goto(url(),{waitUntil:'domcontentloaded'});await library();await capture('actual-business-library');await enter();
    await submit();assert.equal(await page.getByRole('textbox',{name:'Template title',exact:true}).evaluate(el=>el===document.activeElement),true);await proposal();await options();
    const request=new URL(page.url()).searchParams.get('template_request');assert.ok(request);await submit();await stored();assert.equal(new URL(page.url()).searchParams.get('agreement_templates'),request);assert.equal(templates.get(request).body_markdown,exactWords);await page.getByText('No completed wording review is recorded by these options.',{exact:true}).waitFor();await capture('retained-native-template');behavior.push('actual Sales library/editor/native SDK mounting','required title focus','exact native wording/options receipt and original version navigation');
    await page.getByRole('button',{name:'Use this version',exact:true}).click();await page.getByRole('textbox',{name:'Agreement content',exact:true}).waitFor();assert.equal(await page.getByRole('combobox',{name:'Client',exact:true}).inputValue(),'');await page.getByRole('button',{name:'Save agreement draft',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'Client',exact:true}).evaluate(el=>el===document.activeElement),true);await page.getByRole('combobox',{name:'Client',exact:true}).selectOption(client);await page.getByRole('button',{name:'Text source',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Agreement text source',exact:true}).inputValue(),exactWords);await page.getByRole('button',{name:'Save agreement draft',exact:true}).click();await page.getByText('Recorded wording · content version 1',{exact:true}).waitFor();
    const agreementId=new URL(page.url()).searchParams.get('agreement'),original=records.get(agreementId);assert.ok(original);assert.equal(original.agreement.body_source,'tenant_template');assert.equal(original.agreement.source_version_id,request);assert.equal(original.agreement.contact_id,client);assert.equal(original.agreement.body_markdown,exactWords);await page.reload();await page.getByText('Recorded wording · content version 1',{exact:true}).waitFor();await page.getByRole('button',{name:'Inspect source template',exact:true}).click();await stored();assert.equal(new URL(page.url()).searchParams.get('agreement_templates'),request);behavior.push('actual client is required, never invented','same original template ID/body into original agreement writer','same agreement reload and source-record navigation');
    await page.getByRole('button',{name:'Prepare a new version',exact:true}).click();await page.getByRole('textbox',{name:'Template title',exact:true}).waitFor();await page.getByRole('button',{name:'Text source',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Agreement text source',exact:true}).inputValue(),exactWords);await page.getByRole('textbox',{name:'Agreement text source',exact:true}).fill(exactWords+'\nReviewed revision supplied by the business.\n');await submit();await stored();const secondVersion=new URL(page.url()).searchParams.get('agreement_templates');assert.notEqual(secondVersion,request);assert.equal(templates.get(secondVersion).source_template_version_id,request);assert.equal(templates.get(request).body_markdown,exactWords);await page.getByRole('button',{name:'Inspect earlier source version',exact:true}).click();await stored();assert.equal(await page.getByRole('button',{name:'Use this version',exact:true}).count(),0);behavior.push('new retained version preserves old original words and source identity','earlier source remains inspectable and inactive use withheld');
    await library();await enter();await proposal();mode='template-unknown-pending';await submit();await page.getByRole('button',{name:'Retry same reviewed request',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Agreement text source',exact:true}).getAttribute('readonly'),'');const pendingCommand=calls.filter(row=>row.name==='create_agreement_template_version').at(-1);await page.getByRole('button',{name:'Check original template request',exact:true}).click();await page.getByText('The same original request is still unconfirmed. Its first save may still finish.',{exact:true}).waitFor();await capture('unconfirmed-original-request');mode='normal';await page.getByRole('button',{name:'Retry same reviewed request',exact:true}).click();await stored();const retryCommand=calls.filter(row=>row.name==='create_agreement_template_version').at(-1);assert.equal(pendingCommand.requestId,retryCommand.requestId);assert.equal(pendingCommand.commandDigest,retryCommand.commandDigest);behavior.push('readonly unknown proposal and original request read','explicit same-UUID same-payload retry');
    await library();await enter();await proposal();mode='template-unknown-saved';await submit();await page.getByRole('button',{name:'Check original template request',exact:true}).waitFor();const beforeRecovery=calls.filter(row=>row.name==='create_agreement_template_version').length;mode='template-recovery-held';templateRecoveryEntered=false;templateRecoveryFinished=false;const heldVersion=new URL(page.url()).searchParams.get('template_request');const heldResponse=page.waitForResponse(response=>response.url().endsWith('/__e04_rpc__/recover_agreement_template_creation')&&response.request().postDataJSON()._version_id===heldVersion);await page.getByRole('button',{name:'Check original template request',exact:true}).click();const readStarted=Date.now();while(!templateRecoveryEntered&&Date.now()-readStarted<4000)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(templateRecoveryEntered);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{authorityUnknown:true}})));await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{authorityUnknown:false}})));const recoveredReadButton=page.getByRole('button',{name:'Check original template request',exact:true});await recoveredReadButton.waitFor();assert.equal(await recoveredReadButton.isEnabled(),true);releaseTemplateRecovery();await(await heldResponse).finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.ok(templateRecoveryFinished);assert.equal(await page.getByRole('article',{name:'Retained template wording',exact:true}).count(),0);mode='normal';await recoveredReadButton.click();await stored();behavior.push('interrupted recovery releases read lock and discards stale authorized response');assert.equal(calls.filter(row=>row.name==='create_agreement_template_version').length,beforeRecovery);behavior.push('lost acknowledgment recovers original stored words without another create');
    await page.getByRole('button',{name:'Prepare a new version',exact:true}).click();await page.getByRole('textbox',{name:'Template title',exact:true}).waitFor();mode='template-conflict';await submit();await page.getByRole('heading',{name:'Source version changed',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Retry same reviewed request',exact:true}).count(),0);mode='normal';await page.getByRole('button',{name:'Return to agreements',exact:true}).click();await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'Continue editing',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Agreement content',exact:true}).getAttribute('contenteditable'),'false');await page.getByRole('button',{name:'Return to agreements',exact:true}).click();await page.getByRole('button',{name:'Leave and check later',exact:true}).or(page.getByRole('button',{name:'Discard changes',exact:true})).click();behavior.push('stale source remains readonly and cannot overwrite','actual canonical leave dialog preserves or discards scoped proposal');
    await library();await enter();await proposal();await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{authorityUnknown:true}})));assert.equal(await page.getByRole('textbox',{name:'Template title',exact:true}).count(),0);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{authorityUnknown:false}})));assert.equal(await page.getByRole('textbox',{name:'Template title',exact:true}).inputValue(),'Supplied client-service wording');mode='refused';await submit();await page.getByRole('heading',{name:'Template access changed',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Template title',exact:true}).count(),0);mode='normal';await page.getByRole('button',{name:'Agreements and terms',exact:true}).click();await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'Leave and check later',exact:true}).click();await library();await enter();await proposal();behavior.push('unknown authority hides/restores RAM, conclusive native refusal retires private words','native refusal releases the pending-save lock and preserves a usable canonical exit');
    const beforeForeign=calls.length;await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{activeTenantId:'aaaaaaaa-0000-4000-8000-000000000002'}})));assert.equal(await page.getByRole('textbox',{name:'Template title',exact:true}).count(),0);assert.equal(calls.length,beforeForeign);behavior.push('business switch retires selection and blocks foreign request read');
  }else if(uploadProof){
    let observed=0;page.on('console',message=>{if(message.text()==='[e04-local-proof] Storage upload request observed')observed++;});
    for(const theme of ['light','dark'])for(const [width,height]of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[320,740]])for(const paige of width>=900?['closed','open']:['closed']){
      await page.setViewportSize({width,height});await page.goto(url(theme,paige)+'&uploadProof=1',{waitUntil:'domcontentloaded'});
      const overlay=width<=1080&&paige==='open';
      if(overlay){
        // The original native conversation backdrop intentionally blocks the
        // underlying form entry. Record it, then use its actual Fold control;
        // never force-click through it or claim a simultaneous open dialog.
        await capture(`${width}-${height}-${theme}-open-background`);
        await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
      }
      await page.getByRole('button',{name:'Record terms or upload',exact:true}).click();
      if(pdfIntakeProof){
        const choices=page.getByRole('radiogroup',{name:'The document',exact:true});
        const sourceFit=await choices.evaluate(el=>({height:el.clientHeight,width:el.clientWidth,scrollWidth:el.scrollWidth,cards:[...el.querySelectorAll('[role=radio]')].map(card=>({height:card.getBoundingClientRect().height,scrollWidth:card.scrollWidth,width:card.clientWidth}))}));
        assert.equal(sourceFit.cards.length,3,'All three actual document-source choices remain present');
        assert.ok(sourceFit.height>=sourceFit.cards.reduce((sum,card)=>sum+card.height,0),'Document choices must not collapse or clip their actual cards');
        assert.ok(sourceFit.scrollWidth<=sourceFit.width+1&&sourceFit.cards.every(card=>card.height>=44&&card.scrollWidth<=card.width+1),'Document choices wrap and retain touch targets');
        await choices.scrollIntoViewIfNeeded();
        if(width===320||width===1366)await capture(`${width}-${height}-${theme}-${paige}-document-choices`);
      }
      await page.getByRole('radio',{name:/Upload a contract/}).click();
      await page.getByRole('combobox',{name:'Client',exact:true}).selectOption(client);
      const fileInput=page.getByLabel('The contract file',{exact:true});
      assert.equal(await fileInput.getAttribute('accept'),'.pdf,application/pdf');
      assert.equal(await page.getByLabel('The wording they sign',{exact:true}).count(),0);
      if(pdfIntakeProof){
        assert.equal(await fileInput.evaluate(el=>document.getElementById(el.getAttribute('aria-describedby'))?.textContent.includes('25 MB')),true);
        await fileInput.focus();await page.keyboard.press('Tab');
        assert.equal(await page.getByLabel('What to call it',{exact:true}).evaluate(el=>document.activeElement===el),true,'Native file/title keyboard order remains usable');
      }
      if(pdfIntakeProof){
        const beforeInvalid=observed;
        await fileInput.setInputFiles({name:'agreement.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('Controlled unsupported document.')});
        assert.equal(await page.getByRole('button',{name:'Review and send →',exact:true}).isDisabled(),true);
        await page.getByRole('alert').filter({hasText:'Choose a PDF. Export Word or other documents to PDF before uploading.'}).waitFor();
        assert.equal(observed,beforeInvalid,'Invalid selection must not reach Storage');
        if(width===320&&theme==='dark')await capture('correctable-invalid-selection');
      }
      await page.getByLabel('The contract file',{exact:true}).setInputFiles({name:'controlled.pdf',mimeType:'application/pdf',buffer:Buffer.from('Controlled upload fixture, not a signed PDF.')});
      const before=observed;await page.getByRole('button',{name:'Review and send →',exact:true}).click();
      const notice=page.getByText('The upload result could not be confirmed. The file may already be stored. This response does not confirm an agreement or a signing request.',{exact:true});
      await notice.waitFor();assert.equal(observed,before+1,'Actual original SDK upload reached the controlled transport');
      await notice.scrollIntoViewIfNeeded();
      const fit=await notice.evaluate(el=>({viewport:innerWidth,document:document.documentElement.scrollWidth,bounds:el.getBoundingClientRect().toJSON()}));
      assert.ok(fit.document<=width+1,JSON.stringify(fit));assert.ok(fit.bounds.x>=0&&fit.bounds.x+fit.bounds.width<=width+1,JSON.stringify(fit));
      assert.equal(calls.some(call=>call.name==='create_agreement_signing'),false,'Unknown upload must not proceed to original signing creation');
      await page.evaluate(()=>document.fonts.ready);await capture(`${width}-${height}-${theme}-${paige}`);frames.push({theme,width,height,requestedPaige:paige,actualPaige:overlay?'folded-before-modal':paige,fit});
    }
    behavior.push('original owning Sales upload form and actual hook/SDK','controlled lost upload acknowledgement is visibly unconfirmed','no signing record call after unknown upload','notice wraps on narrow viewports','unchanged private bucket/no-overwrite behavior proven separately by actual-hook cases');
    if(pdfIntakeProof)behavior.push('PDF-only selection matches canonical native document path','invalid selection is correctable before any upload','no second ignored contract or false text-signing explanation','actual native file-to-title Tab route and associated PDF guidance','all three source choices wrap without clipping and retain touch targets');
  }else if(correctionProof){
    const draftTitle=()=>page.getByRole('textbox',{name:'Draft title',exact:true});
    const enter=async()=>{await page.getByRole('button',{name:'Correct draft wording',exact:true}).click();await draftTitle().waitFor();};
    const proposal=async()=>{await draftTitle().fill('Reviewed correction');await page.getByRole('button',{name:'Text source',exact:true}).click();await page.getByRole('textbox',{name:'Agreement text source',exact:true}).fill('# Revised advisory wording\n\nRetain the actual responsibilities.\n');await page.getByRole('button',{name:'Document',exact:true}).click();};
    const submit=()=>page.getByRole('button',{name:'Save revised draft',exact:true}).click();
    await page.goto(url(),{waitUntil:'domcontentloaded'});await newDraft();await fill();await page.getByRole('button',{name:'Save agreement draft',exact:true}).click();await page.getByText('Recorded wording · content version 1',{exact:true}).waitFor();
    const originalUrl=page.url(),id=new URL(originalUrl).searchParams.get('agreement');assert.ok(records.has(id),'Original selection remains canonical');
    for(const theme of ['light','dark'])for(const [width,height]of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[320,740]])for(const paige of width>=900?['closed','open']:['closed']){
      await page.setViewportSize({width,height});const target=new URL(originalUrl);target.searchParams.set('theme',theme);target.searchParams.set('paige',paige);await page.goto(target.href,{waitUntil:'domcontentloaded'});
      const overlay=width<=1080&&paige==='open';if(overlay)await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
      await enter();await proposal();await page.getByRole('button',{name:'Save revised draft',exact:true}).scrollIntoViewIfNeeded();
      const fit=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,pageScroll:scrollY,button:document.querySelector('[aria-label="Correct draft wording"] button[type=submit]')?.getBoundingClientRect().toJSON()}));
      assert.ok(fit.document<=width+1,JSON.stringify(fit));assert.equal(fit.pageScroll,0);assert.ok(fit.button.left>=0&&fit.button.right<=width+1&&fit.button.bottom<=height+1,JSON.stringify(fit));
      if(width<600)await capture(`${width}-${height}-${theme}-action`);
      await page.locator('.e04-preparation h2').scrollIntoViewIfNeeded();if(overlay)await page.getByRole('button',{name:'Direct PAIGE',exact:true}).click();
      await page.evaluate(()=>document.fonts.ready);await capture(`${width}-${height}-${theme}-${paige}`);frames.push({theme,width,height,paige,fit,nativePaigeOverlay:overlay});
      if(overlay){await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();assert.equal(await draftTitle().inputValue(),'Reviewed correction');}
      page.once('dialog',dialog=>dialog.accept());
    }
    await page.setViewportSize({width:1366,height:768});await page.goto(originalUrl,{waitUntil:'domcontentloaded'});await enter();await proposal();
    const beforeCreates=calls.filter(call=>call.name==='create_paige_agreement_draft_once').length;
    await submit();await page.getByText('Recorded wording · content version 2',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('agreement'),id);assert.equal(calls.filter(call=>call.name==='create_paige_agreement_draft_once').length,beforeCreates);
    assert.equal(await page.getByRole('button',{name:'Correct draft wording',exact:true}).evaluate(el=>el===document.activeElement),true);const acknowledged=page.getByRole('status').filter({hasText:'Draft correction acknowledged · content version 2.'});await acknowledged.waitFor();const acknowledgedBounds=await acknowledged.boundingBox();assert.ok(acknowledgedBounds&&acknowledgedBounds.y>=0&&acknowledgedBounds.y+acknowledgedBounds.height<=page.viewportSize().height,'Original correction acknowledgment remains visible at restored focus');await capture('acknowledged-original');await page.reload();await page.getByText('Recorded wording · content version 2',{exact:true}).waitFor();behavior.push('acknowledgment preserves same original/no create','fresh original read and focus','normal saved record reload','only actual native acknowledgment displays a success receipt');
    await enter();await page.getByRole('button',{name:'Text source',exact:true}).click();await page.getByRole('textbox',{name:'Agreement text source',exact:true}).fill('Uncertain proposed correction.');
    mode='correction-unknown-pending';await submit();await page.getByText('Correction not confirmed',{exact:true}).waitFor();await page.getByRole('button',{name:'Read current agreement',exact:true}).click();await page.getByRole('button',{name:'Retry original correction',exact:true}).waitFor();
    const first=calls.filter(call=>call.name==='save_paige_agreement').at(-1);mode='normal';await page.getByRole('button',{name:'Retry original correction',exact:true}).click();await page.getByText('Recorded wording · content version 3',{exact:true}).waitFor();const second=calls.filter(call=>call.name==='save_paige_agreement').at(-1);assert.equal(first.commandDigest,second.commandDigest);assert.equal(first.expectedAt,second.expectedAt);behavior.push('unknown read separate from acknowledgment','explicit retry same frozen CAS and reviewed payload');
    await enter();await page.getByRole('button',{name:'Text source',exact:true}).click();await page.getByRole('textbox',{name:'Agreement text source',exact:true}).fill('Committed but unacknowledged proposal.');mode='correction-unknown-committed';await submit();await page.getByText('Correction not confirmed',{exact:true}).waitFor();mode='normal';await page.getByRole('button',{name:'Read current agreement',exact:true}).click();await page.getByRole('region',{name:'Current stored wording',exact:true}).getByText('Committed but unacknowledged proposal.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Retry original correction',exact:true}).count(),0);await capture('uncertain-committed');
    await page.getByRole('button',{name:'Return to current agreement',exact:true}).click();await page.getByRole('alertdialog').waitFor();await page.getByRole('button',{name:'Continue editing',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Agreement text source',exact:true}).inputValue(),'Committed but unacknowledged proposal.');behavior.push('matching stored wording is not acknowledgment','unknown leave warning/cancel preserves proposal');
    await page.getByRole('button',{name:'Return to current agreement',exact:true}).click();await page.getByRole('button',{name:'Leave and check later',exact:true}).click();await page.getByText('Recorded wording · content version 4',{exact:true}).waitFor();
    await enter();await page.getByRole('button',{name:'Text source',exact:true}).click();await page.getByRole('textbox',{name:'Agreement text source',exact:true}).fill('Proposed wording must not overwrite current.');mode='correction-conflict';await submit();await page.getByText('Current agreement has changed',{exact:true}).waitFor();mode='normal';await page.getByRole('button',{name:'Read current agreement',exact:true}).click();await page.getByRole('region',{name:'Current stored wording',exact:true}).getByText('A different authorized correction is currently recorded.',{exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Agreement text source',exact:true}).inputValue(),'Proposed wording must not overwrite current.');assert.equal(await page.getByRole('button',{name:'Retry original correction',exact:true}).count(),0);await capture('conflict');behavior.push('concurrent current source and proposal separate/no auto overwrite');
    mode='read-error';await page.getByRole('button',{name:'Read current agreement',exact:true}).click();await page.getByText('The current agreement could not be verified. Your proposal remains here; retry the read when the connection is available.',{exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'Current stored wording',exact:true}).count(),0);behavior.push('failed current read clears stale stored view and preserves proposal');
    mode='refused';await page.getByRole('button',{name:'Read current agreement',exact:true}).click();await page.getByText('Agreement access could not be confirmed. Recheck the original business and record.',{exact:true}).waitFor();assert.equal(await draftTitle().count(),0);behavior.push('native access refusal retires proposal');
    mode='normal';await page.goto(originalUrl,{waitUntil:'domcontentloaded'});await enter();await draftTitle().fill('Private unsaved correction');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{authorityUnknown:true}})));await page.getByText('Agreement access is being checked',{exact:true}).waitFor();assert.equal(await draftTitle().count(),0);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{authorityUnknown:false}})));await draftTitle().waitFor();assert.equal(await draftTitle().inputValue(),'Private unsaved correction');behavior.push('unknown authority hides and restores scoped RAM proposal');
    await draftTitle().focus();await page.keyboard.press('Escape');await page.getByRole('alertdialog').waitFor();assert.equal(await page.getByRole('button',{name:'Continue editing',exact:true}).evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Discard changes',exact:true}).evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await draftTitle().inputValue(),'Private unsaved correction');behavior.push('one canonical Escape/Tab/leave focus contract');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{canManage:false}})));await page.getByText('Agreement author access required',{exact:true}).waitFor();assert.equal(await draftTitle().count(),0);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{canManage:true}})));await page.getByRole('button',{name:'Correct draft wording',exact:true}).waitFor();await enter();assert.notEqual(await draftTitle().inputValue(),'Private unsaved correction');behavior.push('conclusive role revocation erases proposal');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{activeTenantId:'aaaaaaaa-0000-4000-8000-000000000002'}})));await page.getByText('The agreement could not be opened',{exact:true}).waitFor();assert.equal(await draftTitle().count(),0);behavior.push('business change retires original correction without foreign read/write');
    await page.evaluate(tenant=>window.dispatchEvent(new CustomEvent('e04-authoring-port',{detail:{activeTenantId:tenant}})),tenant);await page.getByRole('button',{name:'Correct draft wording',exact:true}).waitFor();
    records.get(id).agreement.can_edit=false;await page.reload();await page.getByText('Agreement details',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Correct draft wording',exact:true}).count(),0);behavior.push('native retained/frozen state withholds correction entry');
  }else{
  for(const theme of historyProof?[]:['light','dark'])for(const [width,height]of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[320,740]])for(const paige of width>=900?['closed','open']:['closed']){
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
  await page.getByText('Recorded wording · content version 1',{exact:true}).waitFor();
  const originalUrl=page.url(),id=new URL(originalUrl).searchParams.get('agreement');assert.equal(id,requests.get(requestId).id);
  assert.match(await page.locator('.e04-preparation-paper').innerText(),/Retained final sentence/);
  assert.match(await page.locator('.e04-preparation').innerText(),/does not establish payment or completion/);
  await page.getByRole('button',{name:'View signing history',exact:true}).click();await page.getByText('Draft recorded',{exact:true}).waitFor();
  await page.reload();await page.getByText('Recorded wording · content version 1',{exact:true}).waitFor();assert.equal(page.url(),originalUrl);await capture('retained-record-reload');
  assert.match(await page.locator('.e04-preparation-signers').innerText(),/Client signer · Order 1 · Awaiting signature/);
  for(const theme of ['light','dark'])for(const [width,height]of [[390,844],[320,740]]){
    await page.setViewportSize({width,height});
    const retainedUrl=new URL(originalUrl);retainedUrl.searchParams.set('theme',theme);
    await page.goto(retainedUrl.toString(),{waitUntil:'domcontentloaded'});
    const signer=page.getByText(signerEmail,{exact:true});await signer.waitFor();await signer.scrollIntoViewIfNeeded();
    assert.equal(await page.getByText(signerName,{exact:true}).count(),1);
    const fit=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,pageScroll:scrollY,signer:document.querySelector('.e04-preparation-signers')?.getBoundingClientRect().toJSON()}));
    assert.ok(fit.document<=width+1,JSON.stringify(fit));assert.equal(fit.pageScroll,0,JSON.stringify(fit));
    assert.ok(fit.signer.left>=0&&fit.signer.right<=width+1&&fit.signer.bottom<=height+1,JSON.stringify(fit));
    await capture(`${width}-${height}-${theme}-retained-signer`);
  }
  await page.setViewportSize({width:1366,height:850});await page.goto(originalUrl,{waitUntil:'domcontentloaded'});await page.getByText('Recorded wording · content version 1',{exact:true}).waitFor();
  behavior.push('pending native counterparty with long identity remains readable after reload at 320/390 in both themes');
  behavior.push('required-field focus','actual rich keyboard/source round trip','single original native receipt navigation','same-record normal reload','canonical history port','signature/payment/service distinction');
  if(historyProof){
    // Explicit synthetic native port states only. Actual SQL retention/races are
    // independently proven by the original PostgreSQL integrity runner.
    const original=records.get(id),saved=histories.get(id);
    for(let number=2;number<=21;number++){
      original.agreement.version=number;original.agreement.updated_at=`2026-10-21T20:01:${String(number).padStart(2,'0')}Z`;
      original.agreement.body_markdown=`# Current advisory wording ${number}\n\nSynthetic correction ${number} under the same original agreement.`;saved.push(revision(original,number));
    }
    const enter=async()=>{await page.getByRole('button',{name:'Inspect wording history',exact:true}).click();await page.getByText('Retained revision 21 · Content version 21',{exact:true}).waitFor();};
    for(const theme of ['light','dark'])for(const [width,height]of [[1536,770],[1366,768],[1024,768],[900,1000],[390,844],[320,740]])for(const paige of width>=900?['closed','open']:['closed']){
      await page.setViewportSize({width,height});const target=new URL(originalUrl);target.searchParams.set('theme',theme);target.searchParams.set('paige',paige);
      await page.goto(target.toString(),{waitUntil:'domcontentloaded'});await page.getByText('Recorded wording · content version 21',{exact:true}).waitFor();
      const overlay=width<=1080&&paige==='open';if(overlay)await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
      await enter();const picker=page.getByRole('combobox',{name:'Saved revision',exact:true});assert.equal(await picker.locator('option').count(),20);
      await picker.selectOption(saved[19].id);await page.getByText('Retained revision 20 · Content version 20',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Read older wording',exact:true}).click();await page.getByText('Retained revision 1 · Content version 1',{exact:true}).waitFor();
      assert.match(await page.getByRole('region',{name:'Selected saved wording',exact:true}).innerText(),/Retained final sentence/);
      const fit=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,pageScroll:scrollY}));assert.ok(fit.document<=width+1,JSON.stringify(fit));assert.equal(fit.pageScroll,0);
      if(overlay)await page.getByRole('button',{name:'Direct PAIGE',exact:true}).click();await capture(`${width}-${height}-${theme}-${paige}`);frames.push({theme,width,height,paige,fit});
      if(overlay)await page.getByRole('button',{name:'Fold PAIGE conversation',exact:true}).last().click();
      await page.getByRole('button',{name:'Return to current agreement',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Inspect wording history',exact:true}).evaluate(el=>el===document.activeElement),true);
    }
    await page.setViewportSize({width:1366,height:850});await page.goto(originalUrl,{waitUntil:'domcontentloaded'});await enter();
    await page.getByRole('button',{name:'Return to current agreement',exact:true}).click();
    for(const state of ['history-empty','history-list-error','history-wording-error']){
      mode=state;await page.getByRole('button',{name:'Inspect wording history',exact:true}).click();
      if(state==='history-empty')await page.getByText('No retained wording was returned. The current document remains available.',{exact:true}).waitFor();
      else await page.getByRole('button',{name:state==='history-list-error'?'Retry history read':'Retry selected wording',exact:true}).waitFor();
      assert.equal(await page.getByText('Synthetic correction 21 under the same original agreement.',{exact:true}).count(),0);await capture(state);
      mode='normal';if(state!=='history-empty'){await page.getByRole('button',{name:state==='history-list-error'?'Retry history read':'Retry selected wording',exact:true}).click();await page.getByText('Retained revision 21 · Content version 21',{exact:true}).waitFor();}
      await page.getByRole('button',{name:'Return to current agreement',exact:true}).click();
    }
    mode='history-refused';await page.getByRole('button',{name:'Inspect wording history',exact:true}).click();await page.getByRole('heading',{name:'The agreement could not be opened',exact:true}).waitFor();assert.equal(await page.locator('.e04-preparation-paper').count(),0);await capture('history-refused-retires-original');
    mode='normal';await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('Recorded wording · content version 21',{exact:true}).waitFor();
    await enter();original.agreement.version=22;original.agreement.updated_at='2026-10-21T20:02:00Z';original.agreement.body_markdown='Current wording changed while history was open.';saved.push(revision(original,22));
    await page.getByRole('button',{name:'Return to current agreement',exact:true}).click();await page.getByText('Recorded wording · content version 22',{exact:true}).waitFor();assert.match(await page.locator('.e04-preparation-paper').innerText(),/Current wording changed while history was open/);await capture('history-return-fresh-current');
    behavior.push('history twenty-row page and native older cursor','actual earlier wording under same original ID','history source timestamps and content/occurrence distinction','history narrow/desktop original return focus','empty history is not fabricated prior wording','history failed reads hide wording and explicit retry','native history refusal retires original cached wording');
    behavior.push('history return rereads the current original instead of showing an obsolete cached version');
  }
  await page.getByRole('button',{name:'Agreements and terms',exact:true}).click();await newDraft();await fill('Uncertain response recovery');
  mode='uncertain-committed';const uncertainUrl=page.url(),uncertainRequest=new URL(uncertainUrl).searchParams.get('agreement_request');
  await page.getByRole('button',{name:'Save agreement draft',exact:true}).click();await page.getByRole('heading',{name:'Check the original save',exact:true}).waitFor();
  assert.equal(requests.has(uncertainRequest),true);await capture('uncertain-committed');mode='normal';
  await page.getByRole('button',{name:'Check original save',exact:true}).click();await page.getByRole('button',{name:'Open recorded draft',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open recorded draft',exact:true}).click();const choice=page.getByRole('alertdialog');await choice.waitFor();
  assert.match(await choice.innerText(),/does not apply its current wording/);assert.equal(await page.getByRole('button',{name:'Continue editing',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Leave current editor',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'Leave current editor',exact:true}).click();await page.getByText('Recorded wording · content version 1',{exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('agreement'),requests.get(uncertainRequest).id);
  await page.goto(uncertainUrl);await page.getByText('Recorded wording · content version 1',{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('agreement'),requests.get(uncertainRequest).id);
  assert.equal(calls.filter(call=>call.name==='create_paige_agreement_draft_once'&&call.requestId===uncertainRequest).length,1);
  behavior.push('committed lost-response truth','RAM wording retained until explicit leave','leave focus/keyboard trap','opaque request reload recovery without another create');
  mode='read-error';await page.reload();await page.getByText('Record unavailable',{exact:true}).waitFor();assert.equal(await page.getByText('Draft preparation',{exact:true}).count(),0);await capture('read-error');mode='normal';
  await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByText('Recorded wording · content version 1',{exact:true}).waitFor();
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
  }
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(blocked.filter(origin=>origin!=='https://fonts.googleapis.com').length,0,blocked.join(','));
  assert.deepEqual(await hashes(),pinned,'Source changed during native browser drive');
  assert.equal(createHash('sha256').update(await fs.readFile(fontPath)).digest('hex'),fontSHA256,'Shared font changed during proof');
  if(fieldsProof||preparationsProof)assert.equal(createHash('sha256').update(await fs.readFile(documentFixturePath)).digest('hex'),documentFixtureSHA,'Native PDF fixture changed during proof');
  const report={proofClass:preparationsProof?'actual mounted Sales/router/controller/SDK/private PDF byte verification/browser field renderer; synthetic Auth/API/RPC transport, NO HOSTED PERSISTENCE/ACCEPTANCE':fieldsProof?'actual native PDF bytes/browser canvas/assigned-field components/shared validator; synthetic source/identity/network, NO NATIVE SAVE':'actual Sales shell/components/editor/SDK; synthetic identity/network only',staticTransport:compiledRoot?'native Vite compiled fixture':'loopback Vite',normalizedLFSourceSHA256:pinned,sharedUIFontSHA256:fontSHA256,documentFixtureSHA,frames,behavior,errors,blocked,canonicalRecords:records.size,authenticated:'UNVERIFIED',providers:'NOT_EXERCISED'};
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:'PASS',frames:frames.length,behavior:behavior.length,pageErrors:errors.length}));
}catch(error){await capture('failure').catch(()=>{});await fs.writeFile(path.join(out,'failure.json'),JSON.stringify({error:String(error),errors,blocked,frames,behavior},null,2));throw error;}
finally{await browser.close();}
