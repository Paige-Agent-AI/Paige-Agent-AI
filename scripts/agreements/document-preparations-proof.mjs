// Additional cases in the EXISTING fenced disposable native cluster. No new
// runner, customer identity, hosted object, signature, provider or acceptance.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {prepareAgreementFields,prepareCommercialAgreementFields} from '../../supabase/functions/_shared/agreements/field-preparation.ts';
import {canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/commercial-presentation.ts';
import {assembleFixedRepaymentSchedule} from '../../supabase/functions/_shared/sales-collections/model.ts';

export async function proveDocumentPreparations({sql,read,context,tenant,actor,client,fresh,quote,startSession,observe,onCommercialFixture}){
 let checks=0;const check=(v,message)=>{assert(v,message);checks++;};
 const value=v=>v===null?'NULL':quote(v);
 const json=statement=>JSON.parse(sql(statement));
 const refused=(statement,code='23514',prefix='SET ROLE service_role;')=>{
  sql(prefix+`DO $proof$ BEGIN BEGIN ${statement.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};RAISE EXCEPTION 'Expected refusal ${code}';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;
 };
 sql(`ALTER TABLE tenants ADD COLUMN status text DEFAULT 'active';
   CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
   CREATE TABLE profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
   CREATE TABLE tenant_members(user_id uuid,tenant_id uuid,status text,role text);
   INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO profiles VALUES('${actor}','${tenant}');
   INSERT INTO tenant_members VALUES('${actor}','${tenant}','active','owner');
   ALTER TABLE paige_agreements ADD COLUMN commercial_presentation jsonb,ADD COLUMN presented_body_markdown text;`);
 const floor=read('supabase/migrations/20270543000000_sales_invoice_lifecycle.sql');
 const floorStart=floor.indexOf('CREATE OR REPLACE FUNCTION public._sales_invoice_actor('),floorEnd=floor.indexOf('\nCREATE OR REPLACE FUNCTION public._sales_invoice_read(',floorStart);
 assert(floorStart>=0&&floorEnd>floorStart);sql(floor.slice(floorStart,floorEnd));
 const commercial=read('supabase/migrations/20271113230004_agreement_commercial_presentation.sql');
 const canonicalStart=commercial.indexOf('CREATE OR REPLACE FUNCTION public._paige_commercial_canonical_json('),canonicalEnd=commercial.indexOf('\nCREATE OR REPLACE FUNCTION public._paige_commercial_presentation_immutable()',canonicalStart);
 assert(canonicalStart>=0&&canonicalEnd>canonicalStart);sql(commercial.slice(canonicalStart,canonicalEnd));
 const migration=read('supabase/migrations/20271113300004_agreement_document_preparation_versions.sql');sql(migration);sql(migration);
 const commercialProof=process.argv.includes('--commercial-document-preparations');
 if(commercialProof){
  // The original parent fixture already retains the canonical offer foreign key.
  sql(`ALTER TABLE tenant_client_agreements ADD COLUMN status text DEFAULT 'draft',
    ADD COLUMN collection_terms jsonb,ADD COLUMN collection_terms_version bigint DEFAULT 1,ADD COLUMN installments_total integer,
    ADD COLUMN starts_on date,ADD COLUMN ends_on date,ADD COLUMN price_basis text,ADD COLUMN updated_at timestamptz DEFAULT now();
    CREATE TABLE paige_invoices(id uuid PRIMARY KEY,tenant_id uuid,contact_id uuid,status text,currency text,
      billing_lifecycle_version bigint,billing_draft_version bigint,billing_draft jsonb,updated_at timestamptz DEFAULT now());`);
  sql(commercial);
  const validation=read('supabase/migrations/20271113340004_agreement_commercial_source_validation.sql');sql(validation);sql(validation);
  if(!process.argv.includes('--commercial-document-baseline')){
   const extension=read('supabase/migrations/20271113350004_agreement_commercial_document_preparation.sql');sql(extension);sql(extension);
  }
 }
 check(sql('SELECT count(*) FROM paige_agreement_document_preparations;')==='0','No backfill or activation');
 const originalSave=sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.save_paige_agreement(uuid,uuid,uuid,text,text,uuid,uuid,text,uuid,text,timestamptz)'::regprocedure;");
 check(originalSave==='1bd28e75afa0f50bb07b717795a5be0e','Actual original agreement writer retained');
 const readSource=id=>json(`SELECT jsonb_build_object('tenant_id',a.tenant_id,'agreement_id',a.id,'client_id',a.contact_id,'version',a.version,'updated_at',a.updated_at,'status',a.status,'signers',coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'full_name',s.full_name,'email',s.email,'signer_role',s.signer_role,'signing_order',s.signing_order,'status',s.status) ORDER BY s.signing_order,s.id) FROM paige_agreement_signers s WHERE s.agreement_id=a.id),'[]'::jsonb)) FROM paige_agreements a WHERE a.id='${id}';`);
 const original=()=>readSource(fresh().id);
 const stamp=id=>sql(`SELECT jsonb_build_object('version',version,'updated_at',updated_at,'words',body_markdown) FROM paige_agreements WHERE id='${id}';`);
 const prepare=async(source,{id=randomUUID(),current=null,storage=null}={})=>{
  const fields=source.signers.map((s,i)=>({id:randomUUID(),signer_id:s.id,kind:'signature',page:1,x:20,y:30+i*50,width:140,height:30,required:true,label:'Signature'}));
  // Metadata-only fixture: real PDF parsing is tested separately by the original
  // native document/field tests. No hosted Storage existence is inferred here.
  const p=await prepareAgreementFields(source,{sha256:'a'.repeat(64),byte_length:500,pages:[{page:1,crop_x:0,crop_y:0,crop_width:612,crop_height:792,rotation:0,width:612,height:792}]},fields);
  assert(p.ready_for_review);return {source,id,current,storage:storage??`${tenant}/${source.agreement_id}/${id}.pdf`,manifest:canonicalPresentationJson(p.manifest),digest:p.preparation_sha256,commercial:null};
 };
 const command=(p,patch={})=>{const v={...p,...patch},s=v.source;return `SELECT _retain_agreement_document_preparation(${value(v.actor??actor)},${value(v.tenant??tenant)},${value(s.agreement_id)},${value(s.client_id)},${s.version},${value(s.updated_at)},${value(v.id)},${value(v.current)},${value(v.storage)},${value(v.manifest)},${value(v.digest)},${value(v.commercial)});`;};
 const run=p=>json('SET ROLE service_role;'+command(p));
 const mutated=(p,edit)=>{const manifest=JSON.parse(p.manifest);edit(manifest);const bytes=canonicalPresentationJson(manifest);return {...p,id:randomUUID(),manifest:bytes,digest:createHash('sha256').update(bytes).digest('hex')};};
 const readCurrent=(source,id=null)=>json(context+`SELECT read_agreement_document_preparation('${tenant}','${source.agreement_id}',${value(id)});`);
 const source=original(),p=await prepare(source),before=stamp(source.agreement_id);
 check(readCurrent(source).state==='none','Authorized empty is explicit');
 const receipt=run(p);check(receipt.state==='recorded'&&!receipt.replayed&&receipt.historical_receipt,'One truthful original native receipt');
 check(stamp(source.agreement_id)===before,'Selection does not mutate original source timestamp or version');
 const projected=readCurrent(source);check(projected.source_matches&&projected.source_scope==='agreement_and_parties','Actual canonical source and party hashes match');
 check(projected.commercial_verification==='not_applicable'&&!('content_storage_key' in projected)&&!('manifest_canonical' in projected),'Owner projection omits private key/raw bytes and makes no financial readiness claim');
 check(projected.document_sha256==='a'.repeat(64)&&projected.preparation_sha256===p.digest,'Exact original document/map hashes retained');
 assert.deepEqual(projected.manifest,JSON.parse(p.manifest),'Original field assignment survives native persistence');checks++;
 const repeated=run(p);check(repeated.replayed&&repeated.event_id===receipt.event_id,'Same request returns one original historical receipt');
 check(sql(`SELECT count(*) FROM paige_agreement_document_preparations WHERE agreement_id='${source.agreement_id}'`)==='1','No duplicate version on replay');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${source.agreement_id}' AND detail->>'action'='document_preparation_recorded'`)==='1','One original event, no second execution/event store');
 for(const patch of [{storage:`${tenant}/${source.agreement_id}/changed.pdf`},{commercial:'b'.repeat(64)},{current:randomUUID(),digest:'f'.repeat(64)}])refused(command(p,patch),patch.digest?'22023':'23514');
 refused(command(mutated(p,m=>m.unexpected=true)),'22023');
 refused(command(mutated(p,m=>m.source.tenant_id='bbbbbbbb-0000-4000-8000-000000000002')),'22023');
 refused(command(mutated(p,m=>m.signers[0].identity_sha256='b'.repeat(64))));
 refused(command(mutated(p,m=>m.fields[0].signer_id=randomUUID())));
 refused(command(mutated(p,m=>m.fields.push({...m.fields[0]}))));
 const stale=mutated(p,m=>m.source.version++);stale.source={...source,version:source.version+1};refused(command(stale));
 refused(command({...p,id:randomUUID(),storage:`${tenant}/foreign/${p.id}.pdf`}),'22023');
 refused(command(p,{actor:randomUUID()}),'42501');
 refused(command(p,{tenant:'bbbbbbbb-0000-4000-8000-000000000002'}),'42501');
 refused(command(p),'42501',context);refused(command(p),'42501','SET ROLE anon;');
 for(const role of ['anon','authenticated','service_role']){
  refused('SELECT count(*) FROM paige_agreement_document_preparations;','42501',`SET ROLE ${role};`);
  refused("SELECT _agreement_preparation_parties(NULL,NULL);",'42501',`SET ROLE ${role};`);
 }
 const history=`SELECT list_agreement_document_preparations('${tenant}','${source.agreement_id}',1,NULL);`;
 refused(history,'42501',context+"SET test.uid='';");refused(history,'42501',context+"SET test.tenant='bbbbbbbb-0000-4000-8000-000000000002';");
 for(const change of ["UPDATE tenant_members SET role='member';","UPDATE tenant_members SET status='inactive';","UPDATE profiles SET active_tenant_id=NULL;","UPDATE auth.users SET deleted_at=now();","UPDATE auth.users SET banned_until=now()+interval '1 day';","UPDATE tenants SET status='suspended';"]){
  sql(change); // Each actual authority mutation commits before the refused calls.
  refused(command(p),'42501');refused(history,'42501',context);
  sql("UPDATE tenant_members SET role='owner',status='active';UPDATE profiles SET active_tenant_id='"+tenant+"';UPDATE auth.users SET deleted_at=NULL,banned_until=NULL;UPDATE tenants SET status='active';");
 }
 const second=await prepare(source,{current:p.id}),r2=run(second);
 check(r2.revision_no===2&&r2.event_id!==receipt.event_id,'New exact preparation advances original child revision');
 check(!readCurrent(source,p.id).is_selected&&readCurrent(source).id===second.id,'History retained; only new selection current');
 check(run(p).replayed&&readCurrent(source).id===second.id,'Historical retry never reselects obsolete document');
 const page1=json(context+history);check(page1.items.length===1&&page1.items[0].id===second.id&&page1.has_more,'Bounded actual history page');
 const page2=json(context+`SELECT list_agreement_document_preparations('${tenant}','${source.agreement_id}',1,2);`);check(page2.items[0].id===p.id&&!page2.has_more,'Original immutable older version remains inspectable');
 check(!('manifest' in page1.items[0])&&!('content_storage_key' in page1.items[0]),'List never leaks object key or private field map');
 refused(`SELECT list_agreement_document_preparations('${tenant}','${source.agreement_id}',21,NULL);`,'22023',context);
 for(const statement of [`UPDATE paige_agreement_document_preparations SET document_sha256=repeat('c',64) WHERE id='${p.id}'`,`UPDATE paige_agreement_document_preparations SET is_current=true WHERE id='${p.id}'`,`DELETE FROM paige_agreement_document_preparations WHERE id='${p.id}'`,'TRUNCATE paige_agreement_document_preparations'])refused(statement,'23514','');
 refused(command(await prepare(source)),'23514');
 const legacy=original();sql(`SET ROLE service_role;UPDATE paige_agreements SET content_storage_key='${tenant}/${legacy.agreement_id}/legacy.pdf',content_sha256=repeat('b',64) WHERE id='${legacy.agreement_id}';UPDATE paige_agreement_signers SET token_hash=repeat('c',64),token_expires_at=now()+interval '1 day' WHERE agreement_id='${legacy.agreement_id}';`);
 check(sql(`SELECT content_sha256 IS NOT NULL FROM paige_agreements WHERE id='${legacy.agreement_id}';`)==='t','Legacy service writer unaffected without selected preparation');
 for(const assignment of ["status='sent'","content_storage_key='unexpected.pdf'","content_sha256=repeat('b',64)","sealed_storage_key='sealed.pdf'","sealed_sha256=repeat('c',64)"]){assert.throws(()=>sql(`SET ROLE service_role;UPDATE paige_agreements SET ${assignment} WHERE id='${source.agreement_id}';`),/Prepared-document signature requests require the canonical approved send integration/);checks++;}
 for(const assignment of ["token_hash=repeat('d',64)","status='viewed'","status='signed'"]){assert.throws(()=>sql(`SET ROLE service_role;UPDATE paige_agreement_signers SET ${assignment} WHERE agreement_id='${source.agreement_id}';`),/Prepared-document signing requires the canonical approved send integration/);checks++;}
 check(stamp(source.agreement_id)===before,'Refused legacy effects leave original source unchanged');
 sql(`UPDATE paige_agreement_signers SET full_name='Corrected original party' WHERE agreement_id='${source.agreement_id}';`);
 check(!readCurrent(source).source_matches&&stamp(source.agreement_id)===before,'Party fingerprint detects drift even without source timestamp update');
 check(run(second).replayed,'Historical receipt remains retrievable after party correction');
 const changed=json(`SELECT to_json(a) FROM paige_agreements a WHERE id='${source.agreement_id}'`);
 sql(context+`SELECT save_paige_agreement('${tenant}','${source.agreement_id}','${client}','Corrected title','Corrected supplied words',NULL,NULL,'paige_draft',NULL,NULL,'${changed.updated_at}');`);
 check(!readCurrent(source).source_matches&&run(second).replayed,'Source revision drift is stale, never a false new signing result');
 sql(`UPDATE paige_agreements SET status='voided' WHERE id='${source.agreement_id}';`);
 check(run(second).replayed&&!readCurrent(source).source_matches,'Void retains historical receipts, not current readiness');
 const raceSource=original(),race=await prepare(raceSource),tag='e04_document_prep_'+randomUUID().replaceAll('-','');
 const held=startSession(tag+'holder',`BEGIN;SELECT id FROM paige_agreements WHERE id='${raceSource.agreement_id}' FOR UPDATE;SELECT pg_sleep(1.5);COMMIT;`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}holder' AND wait_event='PgSleep');`);
 const left=startSession(tag+'left','SET ROLE service_role;'+command(race));
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}left' AND wait_event_type='Lock');`);
 const right=startSession(tag+'right','SET ROLE service_role;'+command(race));
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}right' AND wait_event_type='Lock');`);
 await held;const pair=(await Promise.all([left,right])).map(JSON.parse);
 check(pair[0].event_id===pair[1].event_id&&pair.filter(r=>r.replayed).length===1,'Real concurrent same-request retry converges on one event/version');
 check(sql(`SELECT count(*) FROM paige_agreement_document_preparations WHERE agreement_id='${raceSource.agreement_id}'`)==='1','Concurrent request creates one retained version');
 const competingSource=original(),one=await prepare(competingSource),two=await prepare(competingSource),competingTag='e04_document_cas_'+randomUUID().replaceAll('-','');
 const barrier=startSession(competingTag+'holder',`BEGIN;SELECT id FROM paige_agreements WHERE id='${competingSource.agreement_id}' FOR UPDATE;SELECT pg_sleep(1.5);COMMIT;`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${competingTag}holder' AND wait_event='PgSleep');`);
 const concurrent=p=>'SET ROLE service_role;DO $proof$ BEGIN BEGIN '+command(p).replace(/^SELECT\s+/,'PERFORM ')+'EXCEPTION WHEN SQLSTATE \'23514\' THEN IF SQLERRM<>\'Selected preparation changed\' THEN RAISE;END IF;END;END $proof$;';
 const oneSession=startSession(competingTag+'one',concurrent(one));
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${competingTag}one' AND wait_event_type='Lock');`);
 const twoSession=startSession(competingTag+'two',concurrent(two));
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${competingTag}two' AND wait_event_type='Lock');`);
 await Promise.all([barrier,oneSession,twoSession]);
 check(sql(`SELECT count(*) FROM paige_agreement_document_preparations WHERE agreement_id='${competingSource.agreement_id}'`)==='1','Real competing selected-version CAS retains only one winner');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${competingSource.agreement_id}' AND detail->>'action'='document_preparation_recorded'`)==='1','Losing concurrent selection creates no success event');
 let commercialChecks=0,acceptedEvidence=null;
 if(commercialProof){
  const start=checks,hex=value=>createHash('sha256').update(value).digest('hex');
  const literal=value=>quote(JSON.stringify(value))+'::jsonb';
  const makeCommercial=async({currency='USD'}={})=>{
   const initial=original(),offer=randomUUID(),terms=randomUUID(),invoice=randomUUID();
   const schedule=assembleFixedRepaymentSchedule({total_cents:350000,currency:'usd',deposit_cents:50000,deposit_date:'2026-10-15',installment_cents:30000,first_installment_date:'2026-11-15',cadence:'monthly'});
   assert.equal(schedule.state,'ready');
   const treatment={state:'not_applicable',charges:[],source:'Synthetic owner decision',policy:'No applicable charge recorded'},conditions={schema_version:1,tax:treatment,fees:treatment};
   sql(`INSERT INTO tenant_products(id,tenant_id) VALUES('${offer}','${tenant}');
    INSERT INTO tenant_client_agreements(id,tenant_id,contact_id,offer_id,agreed_amount_minor,agreed_currency,term_kind,installments_total,collection_terms,starts_on,price_basis)
      VALUES('${terms}','${tenant}','${client}','${offer}',350000,${quote(currency)},'installment',10,${literal(schedule.terms)},'2026-10-15','negotiated');
    UPDATE paige_agreements SET offer_id='${offer}',commercial_terms_id='${terms}' WHERE id='${initial.agreement_id}';`);
   const source=readSource(initial.agreement_id),words=json(`SELECT jsonb_build_object('title',title,'body',body_markdown) FROM paige_agreements WHERE id='${source.agreement_id}';`);
   const draft={schema_version:3,agreement_id:source.agreement_id,total_minor:350000,agreement_snapshot:{id:source.agreement_id,version:source.version},commercial_terms_reference:{id:terms,version:1},commercial_conditions:conditions,
    items:[{unit_minor:350000,quantity:1,catalog_facts:{product_id:offer,unit_minor:350000,currency:'usd'}}]};
   sql(`INSERT INTO paige_invoices VALUES('${invoice}','${tenant}','${client}','draft','usd',1,1,${literal(draft)},now());`);
   const times=json(`SELECT jsonb_build_object('terms',t.updated_at,'invoice',i.updated_at) FROM tenant_client_agreements t,paige_invoices i WHERE t.id='${terms}' AND i.id='${invoice}';`);
   const input={schema_version:2,engagement:{starts_on:'2026-10-15',ends_on:null,price_basis:'negotiated'},
    source:{tenant_id:tenant,client_id:client,offer_id:offer,agreement_id:source.agreement_id,agreement_version:source.version,agreement_updated_at:source.updated_at,body_source:'paige_draft',status:'draft',content_sha256:null,
     terms_id:terms,terms_version:1,terms_updated_at:times.terms,invoice_id:invoice,invoice_version:1,invoice_draft_version:1,invoice_updated_at:times.invoice},
    title:words.title,body_markdown:words.body,principal_minor:350000,currency:'usd',collection_terms:schedule.terms,conditions,lines:[{unit_minor:350000,quantity:1}]};
   const base=await prepare(source),baseManifest=JSON.parse(base.manifest);
   const prepared=await prepareCommercialAgreementFields(source,baseManifest.document,baseManifest.fields,input);
   return {p:{...base,manifest:canonicalPresentationJson(prepared.manifest),digest:prepared.preparation_sha256,
    commercial:prepared.manifest.commercial.payload_digest},terms,invoice,input};
  };
  onCommercialFixture?.(makeCommercial);
  const c=await makeCommercial(),cp=c.p,sourceBefore=stamp(cp.source.agreement_id);
  const financialState=()=>sql(`SELECT jsonb_build_object('terms',to_jsonb(t),'invoice',to_jsonb(i)) FROM tenant_client_agreements t,paige_invoices i WHERE t.id='${c.terms}' AND i.id='${c.invoice}';`);
  const financialBefore=financialState(),cr=run(cp);
  check(cr.state==='recorded'&&cr.historical_receipt&&!cr.replayed,'Exact commercial document/map retained without consequential execution');
  check(stamp(cp.source.agreement_id)===sourceBefore&&financialState()===financialBefore,'Preparation does not freeze or change original commercial/financial sources');
  const cv=readCurrent(cp.source);assert.deepEqual(cv.manifest,JSON.parse(cp.manifest));checks++;
  check(cv.commercial_payload_digest===cp.commercial&&cv.commercial_verification==='not_checked'&&cv.source_scope==='agreement_and_parties','Retention is not a current financial validation or approval claim');
  check(sql(`SELECT commercial_presentation IS NULL AND content_sha256 IS NULL AND status='draft' FROM paige_agreements WHERE id='${cp.source.agreement_id}';`)==='t','Private commercial preparation does not invoke the original freeze');
  check(sql(`SELECT count(*) FROM paige_agreement_signers WHERE agreement_id='${cp.source.agreement_id}' AND (token_hash IS NOT NULL OR signed_at IS NOT NULL OR esign_consent_at IS NOT NULL);`)==='0','No signing link, signature or consent is manufactured');
  const replay=run(cp);check(replay.replayed&&replay.event_id===cr.event_id,'Same exact commercial request returns its original event');
  const changeCommercial=(edit)=>{
   const next=mutated(cp,m=>{edit(m.commercial);m.commercial.payload_digest=hex(canonicalPresentationJson(m.commercial.payload));});
   return {...next,current:cp.id,commercial:JSON.parse(next.manifest).commercial.payload_digest};
  };
  refused(command(changeCommercial(c=>c.payload.principal_minor++)),'40001');
  refused(command(changeCommercial(c=>c.payload.source.agreement_id=randomUUID())),'23514');
  refused(command(changeCommercial(c=>c.payload.schema_version=1)),'22023');
  refused(command(changeCommercial(c=>c.payload=null)),'22023');
  refused(command(changeCommercial(c=>c.extra=true)),'22023');
  refused(command(changeCommercial(c=>c.presented_body_markdown+=' changed')),'22023');
  refused(command({...cp,id:randomUUID(),current:cp.id,commercial:'f'.repeat(64)}),'22023');
  refused(command({...cp,id:randomUUID(),actor:randomUUID()}),'42501');
  sql(`UPDATE paige_invoices SET billing_draft_version=2 WHERE id='${c.invoice}';`);
  refused(command({...cp,id:randomUUID(),current:cp.id}),'40001');
  sql(`UPDATE paige_invoices SET billing_draft_version=1 WHERE id='${c.invoice}';`);
  refused(`UPDATE paige_agreement_document_preparations SET manifest_canonical='{}' WHERE id='${cp.id}';`,'23514','');
  check(sql(`SELECT count(*) FROM paige_agreement_document_preparations WHERE agreement_id='${cp.source.agreement_id}';`)==='1','All refused commercial attempts leave one immutable original preparation');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${cp.source.agreement_id}' AND detail->>'action'='document_preparation_recorded';`)==='1','All refused commercial attempts leave one original event');
  sql(`UPDATE tenant_client_agreements SET collection_terms_version=2 WHERE id='${c.terms}';`);
  const historical=run(cp);check(historical.replayed&&historical.historical_receipt&&historical.event_id===cr.event_id,'Changed current economics do not replace an exact historical receipt');
  refused(command({...cp,id:randomUUID(),current:cp.id}),'40001');
  check(readCurrent(cp.source).commercial_verification==='not_checked','Historical replay never reports current financial verification');
  const race=await makeCommercial(),tag='e04_commercial_document_'+randomUUID().replaceAll('-','');
  const holder=startSession(tag+'terms',`BEGIN;UPDATE tenant_client_agreements SET collection_terms_version=2 WHERE id='${race.terms}';SELECT pg_sleep(1.5);COMMIT;`);
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}terms' AND wait_event='PgSleep');`);
  const waiting=startSession(tag+'retain','SET ROLE service_role;DO $proof$ BEGIN BEGIN '+command(race.p).replace(/^SELECT\s+/,'PERFORM ')+"RAISE EXCEPTION 'Expected changed original economics';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;END $proof$;");
  await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='${tag}retain' AND wait_event_type='Lock');`);checks++;
  await Promise.all([holder,waiting]);
  check(sql(`SELECT count(*) FROM paige_agreement_document_preparations WHERE agreement_id='${race.p.source.agreement_id}';`)==='0','Waiting commercial preparation refuses changed committed terms');
  check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${race.p.source.agreement_id}' AND detail->>'action'='document_preparation_recorded';`)==='0','Concurrent commercial refusal leaves no preparation event');
  const identity='public._retain_agreement_document_preparation(uuid,uuid,uuid,uuid,integer,timestamptz,uuid,uuid,text,text,text,text)';
  const meta=json(`SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl::text,'defaults',pronargdefaults) FROM pg_proc WHERE oid='${identity}'::regprocedure;`);
  check(meta.owner==='proofrunner'&&meta.definer&&meta.config.includes('search_path=""')&&meta.defaults===1&&meta.acl.includes('service_role=X/')&&!meta.acl.includes('authenticated=X/')&&!meta.acl.includes('anon=X/'),'Original private writer ABI, owner, search path and grants preserved');
  const extension=read('supabase/migrations/20271113350004_agreement_commercial_document_preparation.sql');
  const retained=sql(`SELECT pg_get_functiondef('${identity}'::regprocedure);`);
  sql(retained.replace('BEGIN','BEGIN\n  -- A later source writer, in this disposable fixture only.'));
  assert.throws(()=>sql(extension),/Original preparation writer changed; reconcile before applying/);checks++;
  sql(retained);
  const validationIdentity='public._validate_paige_commercial_presentation(uuid,uuid,jsonb,text,text,text,text,text,text)';
  const validation=sql(`SELECT pg_get_functiondef('${validationIdentity}'::regprocedure);`);
  sql(validation.replace('BEGIN','BEGIN\n  -- A later source validator, in this disposable fixture only.'));
  assert.throws(()=>sql(extension),/Original commercial validator changed; reconcile before applying/);checks++;
  sql(validation);
  check(sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${validationIdentity}'::regprocedure;`)==='61056f39c2e8c9a5fa7aab3641820a1b','Original commercial validator is not rewritten by the document extension');
  commercialChecks=checks-start;
  if(process.argv.includes('--accepted-commercial')){
   const {proveAcceptedCommercial}=await import('./accepted-commercial-evidence-proof.mjs');
   const accepted=await proveAcceptedCommercial({sql,read,quote,tenant,actor,client,makeCommercial,startSession,observe});
   acceptedEvidence=accepted;
   checks+=accepted.checks;
  }
 }
 return {checks,migrationReplay:2,concurrentSessions:6,observedLockWaits:4,commercial:commercialProof?{checks:commercialChecks,migrationReplay:2,concurrentSessions:2,observedLockWaits:1}:null,acceptedEvidence,scope:'Native metadata only; actual PDF tests separate, no hosted Storage/JWT/provider/customer acceptance'};
}
