import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareCommercialPresentation,canonicalPresentationJson,commercialPresentationText} from '../../supabase/functions/_shared/agreements/commercial-presentation.ts';
import {commercialPreparationCommand,hasCommercialPreparationReceipt,readCommercialPreparationConsequence} from '../../supabase/functions/_shared/sales-commercial/preparation-command.ts';
import {hasCommercialEffectuationReceipt} from '../../supabase/functions/_shared/sales-commercial/effectuation-command.ts';

/** Actual canonical freeze/retained bodies, in the caller's checked disposable
 * database. A fixed PDF digest here is a labeled SQL fixture, not storage proof. */
export async function provePreparationCommercialSchema({sql,concurrent,read,scope,tenant,actor,client,offer,termsId,invoiceId,agreementId,prepared,input,migration}){
 let checks=0;
 const json=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const text=value=>`'${value.replaceAll("'","''")}'`;
 const digest=value=>createHash('sha256').update(value).digest('hex');
 sql('ALTER TABLE tenant_client_agreements ADD COLUMN IF NOT EXISTS ends_on date;');
 sql(read('supabase/migrations/20270532110000_agreement_link_provenance.sql'));
 const oldIssue=sql("SELECT pg_get_functiondef('issue_agreement_signing_link(uuid,uuid,integer)'::regprocedure);");
 const oldRead=sql("SELECT pg_get_functiondef('read_sales_collection_command_result(uuid,uuid,uuid,jsonb)'::regprocedure);"),oldPreview=sql("SELECT pg_get_functiondef('preview_sales_collection_command(uuid,uuid,jsonb)'::regprocedure);");
 const catalogue=filter=>`SELECT jsonb_agg(to_jsonb(t) ORDER BY tool_key) FROM list_tool_autonomy('${tenant}') t ${filter??''};`;
 const oldCatalogue=sql(scope+'SET ROLE authenticated;'+catalogue());
 sql(read(migration));sql(read(migration));
 assert.equal(sql("SELECT pg_get_functiondef('_read_sales_collection_before_preparation(uuid,uuid,uuid,jsonb)'::regprocedure);"),oldRead.replace('public.read_sales_collection_command_result(','public._read_sales_collection_before_preparation('));checks++;
 assert.equal(sql("SELECT pg_get_functiondef('_preview_sales_collection_before_preparation(uuid,uuid,jsonb)'::regprocedure);"),oldPreview.replace('public.preview_sales_collection_command(','public._preview_sales_collection_before_preparation('));checks++;
 assert.equal(sql("SELECT pg_get_functiondef('_issue_signing_link_before_commercial_preparation(uuid,uuid,integer)'::regprocedure);"),oldIssue.replace('public.issue_agreement_signing_link(','public._issue_signing_link_before_commercial_preparation('));checks++;
 assert.equal(sql(scope+'SET ROLE authenticated;'+catalogue("WHERE tool_key<>'sales_prepare_agreement'")),oldCatalogue);checks++;
 assert.equal(sql(scope+`SET ROLE authenticated;SELECT mode||':'||is_default FROM list_tool_autonomy() WHERE tool_key='sales_prepare_agreement';`),'confirm:true');checks++;
 for(const key of ['set_business_time_zone','sales_effectuate_commercial_terms','other_key'])for(const outcome of ['capability_succeeded','capability_failed']){
  assert.equal(sql(`SELECT _workspace_event_display('capability_run','${outcome}','${key}')=_workspace_event_display_before_e04_preparation('capability_run','${outcome}','${key}');`),'t');checks++;
 }
 assert.equal(JSON.parse(sql("SELECT _workspace_event_display('capability_run','capability_succeeded','sales_prepare_agreement');")).actor_type,'owner_staff');checks++;
 const retained=id=>JSON.parse(sql(`SELECT _paige_retained_commercial_payload(a) FROM paige_agreements a WHERE id='${id}';`));
 assert.deepEqual(retained(agreementId),prepared.payload);checks++;
 assert.deepEqual(JSON.parse(sql(`SELECT _paige_accepted_commercial_payload(a) FROM paige_agreements a WHERE id='${agreementId}';`)),prepared.payload);checks++;
 for(const version of [1,2]){
  const t=`55555555-0000-4000-8000-00000000010${version}`,i=`66666666-0000-4000-8000-00000000010${version}`;
  sql(`INSERT INTO tenant_client_agreements(id,tenant_id,contact_id,offer_id,status,agreed_amount_minor,agreed_currency,collection_terms_version,collection_terms,updated_at,starts_on,ends_on,price_basis)
    SELECT '${t}',tenant_id,contact_id,offer_id,'draft',agreed_amount_minor,agreed_currency,collection_terms_version,collection_terms,now(),'2026-10-01',NULL,'negotiated' FROM tenant_client_agreements WHERE id='${termsId}';`);
  const saved=JSON.parse(sql(scope+`SET ROLE authenticated;SELECT save_paige_agreement(_expected_tenant_id=>'${tenant}',_agreement_id=>NULL,_contact_id=>'${client}',_offer_id=>'${offer}',_commercial_terms_id=>'${t}',_title=>'Synthetic prepared version${version}',_body_markdown=>'Recorded synthetic service responsibilities.');`));
  const a=saved.id;assert(a);checks++;
  assert.throws(()=>sql(scope+`SET ROLE authenticated;SELECT issue_agreement_signing_link('${tenant}','${a}',14);`),/23514.*Prepare and review/);checks++;
  assert.equal(sql(scope+`SET ROLE service_role;SELECT check_sales_agreement_preparation('${actor}','${tenant}','${a}');`),'f');checks++;
  sql(`INSERT INTO paige_invoices SELECT (jsonb_populate_record(NULL::paige_invoices,to_jsonb(p)||${json({id:i,status:'draft',billing_lifecycle_version:1,billing_draft_version:1})}
    ||jsonb_build_object('updated_at',now(),'billing_draft',p.billing_draft||jsonb_build_object('agreement_id','${a}','agreement_snapshot',jsonb_build_object('id','${a}','version',1),'commercial_terms_reference',jsonb_build_object('id','${t}','version',1))))).* FROM paige_invoices p WHERE p.id='${invoiceId}';`);
  const facts=JSON.parse(sql(`SELECT jsonb_build_object('a',to_jsonb(a),'t',to_jsonb(t),'i',to_jsonb(i)) FROM paige_agreements a,tenant_client_agreements t,paige_invoices i WHERE a.id='${a}' AND t.id='${t}' AND i.id='${i}';`));
  const next={...structuredClone(input),schema_version:version,title:facts.a.title,body_markdown:facts.a.body_markdown,
   source:{...input.source,agreement_id:a,agreement_version:facts.a.version,agreement_updated_at:facts.a.updated_at,
    terms_id:t,terms_version:facts.t.collection_terms_version,terms_updated_at:facts.t.updated_at,
    invoice_id:i,invoice_version:facts.i.billing_lifecycle_version,invoice_draft_version:facts.i.billing_draft_version,invoice_updated_at:facts.i.updated_at},
   ...(version===2?{engagement:{starts_on:'2026-10-01',ends_on:null,price_basis:'negotiated'}}:{})};
  const presentation=await prepareCommercialPresentation(next),body=commercialPresentationText(next.body_markdown,presentation);
  const op='99999999-0000-4000-8000-000000000102';let key=version===2?`${tenant}/${a}/presented-commercial-${op}-${presentation.payload_digest}.pdf`:`${tenant}/${a}/presented-synthetic-preparation.pdf`;
  const freeze=(payload=presentation.payload)=>`SELECT _freeze_paige_commercial_presentation('${actor}','${tenant}',${json(payload)},'${digest(canonicalPresentationJson(payload))}',${text(body)},'${digest(body)}','${key}','${'a'.repeat(64)}','owner_ui');`;
  if(version===2){
   for(const delta of [{starts_on:null},{starts_on:'2026-10-02'},{ends_on:'2027-10-01'},{price_basis:'catalog'},{price_basis:null},{approved:true}]){
    assert.throws(()=>sql(scope+'SET ROLE service_role;'+freeze({...presentation.payload,engagement:{...presentation.payload.engagement,...delta}})),/40001/);checks++;
   }
   const missing=structuredClone(presentation.payload);delete missing.engagement;
   assert.throws(()=>sql(scope+'SET ROLE service_role;'+freeze(missing)),/40001/);checks++;
   assert.throws(()=>sql(scope+'SET ROLE service_role;'+freeze({...presentation.payload,schema_version:1})),/22023/);checks++;
  }
  if(version===2){
   const command=commercialPreparationCommand(presentation),governance={actor_user_id:actor,tenant_id:tenant,tool:'sales_prepare_agreement',action:command.action,approval_channel:'operator_card',approved_fingerprint:'a'.repeat(16),decision_receipt_recorded:true};
   const artifact={payload:presentation.payload,payload_digest:presentation.payload_digest,presented_body_markdown:body,presented_body_sha256:digest(body),content_storage_key:key,document_sha256:'a'.repeat(64)};
   const execute=(id=op,g=governance,c=command,doc=artifact)=>`SELECT execute_sales_agreement_preparation('${actor}','${tenant}','${id}',${json(c)},${json(g)},${json(doc)});`;
   const preview=JSON.parse(sql(scope+`SET ROLE service_role;SELECT preview_sales_collection_command('${actor}','${tenant}',${json(command)});`));
   assert.equal(preview.eligible,true);checks++;assert(readCommercialPreparationConsequence(preview.consequence,command));checks++;
   for(const [prefix,g]of [
    ['',{...governance,approval_channel:'standing_autonomy_setting'}],['',{...governance,approved_fingerprint:null}],['',{...governance,decision_receipt_recorded:false}],
    [`BEGIN;UPDATE tenant_members SET role='member' WHERE user_id='${actor}';`,governance],
    [`BEGIN;INSERT INTO tenant_tool_autonomy VALUES('${tenant}','sales_prepare_agreement','off',now());`,governance],
   ]){assert.throws(()=>sql(scope+prefix+'SET ROLE service_role;'+execute(op,g)),/42501/);checks++;}
   for(const role of ['anon','authenticated']){assert.throws(()=>sql(scope+`SET ROLE ${role};`+execute()),/42501/);checks++;}
   assert.throws(()=>sql(scope+'SET ROLE service_role;'+execute(op,governance,{...command,approved:true})),/22023/);checks++;
   assert.throws(()=>sql(scope+'SET ROLE service_role;'+execute(op,governance,command,{...artifact,content_storage_key:`${tenant}/${a}/caller-chosen.pdf`})),/40001/);checks++;
   assert.throws(()=>sql(scope+`BEGIN;ALTER TABLE paige_workspace_events ADD CONSTRAINT fail_preparation_receipt CHECK(capability_key IS DISTINCT FROM 'sales_prepare_agreement');SET ROLE service_role;`+execute()),/23514/);checks++;
   assert.equal(sql(`SELECT commercial_presentation IS NULL FROM paige_agreements WHERE id='${a}';`),'t');checks++;
   assert.equal(sql("SELECT count(*) FROM paige_sales_collection_operations WHERE command->>'action'='collection.prepare_agreement';"),'0');checks++;
   assert.equal(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${a}' AND detail->>'action'='commercial_presentation_frozen';`),'0');checks++;
   assert.throws(()=>sql(scope+`BEGIN;INSERT INTO paige_workspace_events(tenant_id,actor_id,source_kind,source_id,source_revision,outcome,capability_key) VALUES('${tenant}','${actor}','capability_run','${op}',0,'capability_succeeded','other_key');SET ROLE service_role;`+execute()),/55000/);checks++;
   const other='99999999-0000-4000-8000-000000000103';
   const race=await concurrent([scope+'SET ROLE service_role;'+execute(),scope+'SET ROLE service_role;'+execute(other,governance,command,{...artifact,content_storage_key:key.replace(op,other)})]);
   const first=JSON.parse(race[0]);assert.deepEqual(first,JSON.parse(race[1]));checks++;assert(hasCommercialPreparationReceipt(first,tenant,command));checks++;
   key=key.replace(op,first.operation.id);
   assert.equal(sql("SELECT count(*) FROM paige_sales_collection_operations WHERE command->>'action'='collection.prepare_agreement';"),'1');checks++;
   assert.equal(sql("SELECT count(*) FROM paige_workspace_events WHERE capability_key='sales_prepare_agreement';"),'1');checks++;
   const current=JSON.parse(sql(scope+`SET ROLE authenticated;SELECT read_sales_prepared_agreement('${tenant}','${i}','${a}');`));
   assert.equal(current.state,'retained');checks++;assert.equal(current.current_status,'draft');checks++;
   assert.deepEqual(current.payload,presentation.payload);checks++;assert.deepEqual(current.preparation,first);checks++;
   assert.deepEqual(JSON.parse(sql(scope+'SET ROLE service_role;'+execute(first.operation.id))),first);checks++;
   assert.throws(()=>sql(scope+'SET ROLE service_role;'+execute(op,governance,{...command,payload_digest:'b'.repeat(64)})),/22023/);checks++;
   assert.throws(()=>sql(scope+`SET test.tenant='bbbbbbbb-0000-4000-8000-000000000002';SET ROLE authenticated;SELECT read_sales_prepared_agreement('${tenant}','${i}','${a}');`),/42501/);checks++;
  }else{
   const first=JSON.parse(sql(scope+'SET ROLE service_role;'+freeze()));assert.equal(first.state,'frozen');checks++;
  }
  const again=JSON.parse(sql(scope+'SET ROLE service_role;'+freeze()));assert.equal(again.replayed,true);checks++;
  assert.deepEqual(retained(a),presentation.payload);checks++;
  assert.equal(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${a}' AND detail->>'action'='commercial_presentation_frozen';`),'1');checks++;
  assert.throws(()=>sql(`UPDATE paige_agreements SET presented_body_markdown='Changed retained text' WHERE id='${a}';`),/23514/);checks++;
  if(version===2){
   // Signature metadata is a SQL fixture in this disposable database only.
   // Each open transaction rolls back on connection exit; no real signature,
   // token consumption, provider act or customer acceptance is established.
   const completion=`BEGIN;INSERT INTO paige_agreement_signers(agreement_id,tenant_id,full_name,email,signing_order,status,signed_at,typed_name,esign_consent_at,esign_consent_slug,esign_consent_version,esign_consent_sha256)
    VALUES('${a}','${tenant}','Synthetic completed signer','synthetic@example.invalid',1,'signed',now(),'Synthetic completed signer',now(),'synthetic-consent',1,repeat('c',64));
    UPDATE paige_agreements SET status='sent',sent_at=now(),expires_at=now()+interval '14 days' WHERE id='${a}';
    UPDATE paige_agreements SET status='completed',completed_at=now(),sealed_sha256=repeat('b',64),sealed_storage_key='${tenant}/${a}/sealed-synthetic.pdf' WHERE id='${a}';`;
   const accepted=JSON.parse(sql(scope+completion+`SET ROLE authenticated;SELECT read_sales_accepted_agreement('${tenant}','${i}','${a}');`));
   assert.equal(accepted.state,'recorded');checks++;assert.deepEqual(accepted.payload,presentation.payload);checks++;assert.equal(accepted.presented_body_markdown,body);checks++;
   const source=presentation.payload.source,effect={action:'collection.effectuate_terms',agreement_id:t,expected_version:source.terms_version,expected_updated_at:source.terms_updated_at,
    signing_id:a,signing_version:source.agreement_version,invoice_id:i,invoice_draft_version:source.invoice_draft_version,payload_digest:presentation.payload_digest,sealed_sha256:'b'.repeat(64)};
   const effectPreview=JSON.parse(sql(scope+completion+`SET ROLE service_role;SELECT preview_sales_collection_command('${actor}','${tenant}',${json(effect)});`));
   assert.equal(effectPreview.eligible,true);checks++;
   const governance={actor_user_id:actor,tenant_id:tenant,tool:'sales_effectuate_commercial_terms',action:effect.action,approval_channel:'operator_card',approved_fingerprint:'a'.repeat(16),decision_receipt_recorded:true};
   const effectCall=`SET ROLE service_role;SELECT execute_sales_collection_command('${actor}','${tenant}','99999999-0000-4000-8000-000000000104',${json(effect)},${json(governance)});`;
   // The preceding catalogue proof deliberately retains saved Off. Prove it
   // still refuses, then model Ask First only inside this rolled-back fixture.
   assert.throws(()=>sql(scope+completion+effectCall),/42501.*Current commercial write authority unavailable/);checks++;
   const askFirst=completion+`UPDATE tenant_tool_autonomy SET mode='confirm' WHERE tenant_id='${tenant}' AND tool_key='sales_effectuate_commercial_terms';`;
   // The old fixture also deliberately retains a paused arrangement for this
   // same client/offer. Preserve that business refusal, then end it through the
   // real human status writer only inside the rolled-back positive case.
   assert.throws(()=>sql(scope+askFirst+effectCall),/PA002.*already has a live arrangement/);checks++;
   const endPrior=`SET LOCAL ROLE authenticated;DO $fixture$ BEGIN PERFORM public.set_client_agreement_status('${tenant}','${termsId}','completed',NULL);END $fixture$;RESET ROLE;`;
   const effectReceipt=JSON.parse(sql(scope+askFirst+endPrior+effectCall));
   assert(hasCommercialEffectuationReceipt(effectReceipt,tenant,effect));checks++;
   assert.equal(effectReceipt.row.status_at_execution,'active');checks++;
   assert.equal(sql(`SELECT mode FROM tenant_tool_autonomy WHERE tenant_id='${tenant}' AND tool_key='sales_effectuate_commercial_terms';`),'off');checks++;
   assert.equal(sql(`SELECT status FROM tenant_client_agreements WHERE id='${termsId}';`),'paused');checks++;
  }
  sql(`UPDATE tenant_client_agreements SET starts_on='2026-10-03',price_basis='catalog' WHERE id='${t}';`);
  assert.deepEqual(retained(a),presentation.payload);checks++;
  assert.equal(sql(scope+`SET ROLE service_role;SELECT check_sales_agreement_preparation('${actor}','${tenant}','${a}');`),'t');checks++;
  if(version===2){
   const absent=`BEGIN;SET LOCAL session_replication_role=replica;DELETE FROM paige_workspace_events WHERE capability_key='sales_prepare_agreement';`;
   assert.equal(sql(scope+absent+`SET ROLE service_role;SELECT check_sales_agreement_preparation('${actor}','${tenant}','${a}');`),'f');checks++;
   assert.throws(()=>sql(scope+absent+`SET ROLE authenticated;SELECT issue_agreement_signing_link('${tenant}','${a}',14);`),/23514.*Prepare and review/);checks++;
   const missingReceipt=JSON.parse(sql(scope+absent+`SET ROLE authenticated;SELECT read_sales_prepared_agreement('${tenant}','${i}','${a}');`));
   assert.equal(missingReceipt.preparation,null);checks++;
  }
  sql(`INSERT INTO paige_agreement_signers(agreement_id,tenant_id,full_name,email,signing_order) VALUES('${a}','${tenant}','Synthetic Signer','synthetic@example.invalid',1);`);
  const issued=JSON.parse(sql(scope+`SET ROLE authenticated;SELECT issue_agreement_signing_link('${tenant}','${a}',14);`));
  assert.equal(typeof issued.token,'string');checks++;assert.equal(issued.token.length,64);checks++;
  const shown=JSON.parse(sql(`SET ROLE anon;SELECT row_to_json(p) FROM peek_agreement_signing(${text(issued.token)}) p;`));
  assert.equal(shown.is_valid,true);checks++;assert.equal(shown.amount_minor,350000);checks++;
  assert.equal(shown.document_path,'retained-document');checks++;assert.equal(shown.document_body,null);checks++;
  assert(!JSON.stringify(shown).includes(key));checks++;
 }
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(sql(`SELECT has_function_privilege('${role}','public._paige_retained_commercial_payload(public.paige_agreements)','EXECUTE');`),'f');checks++;
 }
 for(const role of ['anon','authenticated','service_role'])for(const signature of ['_validate_sales_preparation(jsonb)','_preview_sales_preparation(uuid,uuid,jsonb)','_read_sales_collection_before_preparation(uuid,uuid,uuid,jsonb)','_preview_sales_collection_before_preparation(uuid,uuid,jsonb)','_list_tool_autonomy_before_e04_preparation(uuid)','_agreement_commercial_ready(public.paige_agreements)','_issue_signing_link_before_commercial_preparation(uuid,uuid,integer)']){
  assert.equal(sql(`SELECT has_function_privilege('${role}','public.${signature}','EXECUTE');`),'f');checks++;
 }
 return {checks,migrationReplay:2,legacy:'existing accepted v1 and fresh v1 preserved',v2:'explicit service facts, tamper refusal, immutable retention independent of current terms'};
}
