// Original fenced native cluster/records, not customer acceptance or another runner.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {prepareCommercialPresentation,commercialPresentationText} from '../../supabase/functions/_shared/agreements/commercial-presentation.ts';

export async function proveAcceptedCommercial({sql,read,quote,tenant,actor,client,makeCommercial,startSession,observe}){
 let checks=0;const check=(v,message)=>{assert(v,message);checks++;};
 const json=q=>JSON.parse(sql(q)),literal=v=>quote(JSON.stringify(v))+'::jsonb';
 const refused=(statement,pattern)=>{assert.throws(()=>sql(statement),pattern);checks++;};
 if(!process.argv.includes('--accepted-commercial-baseline')){
  sql(read('supabase/migrations/20271113530004_e04_atomic_original_signature.sql'));
  const migration=read('supabase/migrations/20271113810004_e04_accepted_commercial_evidence.sql');sql(migration);sql(migration);
 }
 check(sql("SELECT to_regprocedure('public._paige_retained_commercial_payload(public.paige_agreements)') IS NOT NULL;")==='t',
  'Original retained commercial validator must be available before accepted economics can be claimed');
 const c=await makeCommercial(),id=c.p.source.agreement_id,manifest=JSON.parse(c.p.manifest),commercial=manifest.commercial;
 const retained=patch=>json(`SELECT coalesce(public._paige_retained_commercial_payload(jsonb_populate_record(NULL::public.paige_agreements,to_jsonb(a)||${literal(patch??{})})),'null'::jsonb) FROM paige_agreements a WHERE id='${id}';`);
 const accepted=(recordId=id,patch={})=>json(`SELECT coalesce(public._paige_accepted_commercial_payload(jsonb_populate_record(NULL::public.paige_agreements,to_jsonb(a)||${literal(patch)})),'null'::jsonb) FROM paige_agreements a WHERE id='${recordId}';`);
 check(retained()===null,'Unfrozen wording never becomes a retained commercial agreement');
 const freeze=`SET ROLE service_role;SELECT _freeze_paige_commercial_presentation('${actor}','${tenant}',${literal(commercial.payload)},${quote(commercial.payload_digest)},${quote(commercial.presented_body_markdown)},${quote(commercial.presented_body_sha256)},${quote(c.p.storage)},${quote(manifest.document.sha256)});`;
 check(json(freeze).state==='frozen','The original validated freeze records this exact commercial source');
 assert.deepEqual(retained(),commercial.payload);checks++;
 check(accepted()===null,'Retained draft terms do not imply any signature or accepted engagement');
 sql(read('supabase/migrations/20271113530004_e04_atomic_original_signature.sql'));
 sql(`UPDATE paige_agreements SET status='sent',expires_at=clock_timestamp()+interval '1 day' WHERE id='${id}';`);
 const signers=json(`SELECT jsonb_agg(jsonb_build_object('id',id,'name',full_name) ORDER BY signing_order,id) FROM paige_agreement_signers WHERE agreement_id='${id}';`);
 check(Array.isArray(signers)&&signers.length>0,'Original create path supplies the actual required counterparty');
 for(const signer of signers){
  const token=createHash('sha256').update(randomUUID()).digest('hex');
  sql(`UPDATE paige_agreement_signers SET token_hash=${quote(token)},token_expires_at=clock_timestamp()+interval '1 day' WHERE id='${signer.id}';`);
  const receipt=json(`SET ROLE service_role;SELECT _record_agreement_signature(${quote(token)},${c.p.source.version},${quote(manifest.document.sha256)},${quote(c.p.storage)},${quote(signer.name)},NULL,true,true,'esign-consent',1,repeat('c',64),NULL,'Synthetic native evidence proof');`);
  check(receipt.state==='recorded'&&receipt.audit_complete===true,'Only the original atomic native transaction supplies the signature and two audit events');
 }
 check(accepted()===null,'Signature recording alone is not verified completion');
 sql(`UPDATE paige_agreements SET status='completed',completed_at=clock_timestamp(),sealed_storage_key='${tenant}/${id}/sealed-proof.pdf',sealed_sha256=repeat('d',64) WHERE id='${id}';`);
 check(accepted()===null,'Missing completion audit stays unverified rather than being invented');
 sql(`INSERT INTO paige_agreement_events(agreement_id,tenant_id,event_type,actor_kind,detail)
  VALUES('${id}','${tenant}','sealed','system',jsonb_build_object('sealed_sha256',repeat('d',64),'presented_sha256',${quote(manifest.document.sha256)})),
  ('${id}','${tenant}','completed','system','{}');`);
 assert.deepEqual(accepted(),commercial.payload);checks++;
 check(accepted().schema_version===2&&accepted().principal_minor===350000,'Current schema2 service facts and accepted principal survive exactly');
 const original=accepted(),before=sql(`SELECT to_jsonb(a) FROM paige_agreements a WHERE id='${id}';`);
 sql(`UPDATE tenant_client_agreements SET agreed_amount_minor=999,collection_terms_version=99 WHERE id='${c.terms}';
  UPDATE paige_invoices SET billing_draft_version=99 WHERE id='${c.invoice}';`);
 assert.deepEqual(accepted(),original);checks++;
 check(sql(`SELECT to_jsonb(a) FROM paige_agreements a WHERE id='${id}';`)===before,'Reading accepted history never edits the original agreement');
 for(const patch of [{status:'voided'},{completed_at:null},{sealed_sha256:'bad'},{sealed_storage_key:`${tenant}/other/sealed.pdf`},
  {sealed_storage_key:`${tenant}/${id}/../sealed.pdf`},{content_sha256:'e'.repeat(64)},{version:c.p.source.version+1},{contact_id:randomUUID()}]){
  check(accepted(id,patch)===null,'Changed, incomplete or foreign evidence cannot describe the accepted agreement');
 }
 for(const name of ['_paige_retained_commercial_payload','_paige_accepted_commercial_payload']){
  const metadata=json(`SELECT jsonb_build_object('definer',prosecdef,'config',proconfig,'volatility',provolatile,'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE')) FROM pg_proc WHERE oid=('public.${name}(public.paige_agreements)')::regprocedure;`);
  check(!metadata.definer&&metadata.volatility==='s'&&metadata.config.includes('search_path=""')&&!metadata.anon&&!metadata.authenticated&&!metadata.service,
   'Private stable evidence validation grants no new caller authority');
  for(const role of ['anon','authenticated','service_role']){
   refused(`SET ROLE ${role};SELECT public.${name}(NULL::public.paige_agreements);`,/permission denied for function/);
  }
  const identity=`public.${name}(public.paige_agreements)`,definition=sql(`SELECT pg_get_functiondef('${identity}'::regprocedure);`);
  sql(definition.replace('BEGIN','BEGIN\n -- Disposable fixture only: simulate a later independently changed validator.'));
  refused(read('supabase/migrations/20271113810004_e04_accepted_commercial_evidence.sql'),/Existing accepted commercial validator changed; reconcile before applying/);
  sql(definition);
 }
 const nativeIdentity='public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)';
 const native=sql(`SELECT pg_get_functiondef('${nativeIdentity}'::regprocedure);`);
 sql(native.replace('BEGIN','BEGIN\n -- Disposable fixture only: source drift must refuse migration.'));
 refused(read('supabase/migrations/20271113810004_e04_accepted_commercial_evidence.sql'),/Original native signature writer changed; reconcile accepted evidence before applying/);
 sql(native);
 const capsule=json(`SELECT commercial_presentation FROM paige_agreements WHERE id='${id}';`);
 for(const change of [v=>delete v.schema_version,v=>v.schema_version='1',v=>v.extra=true,v=>v.payload=null,
  v=>delete v.payload.schema_version,v=>v.payload.schema_version=3,v=>v.payload.schema_version='2',v=>v.payload.extra=true,
  v=>v.payload.source.extra=true,v=>v.payload.source.invoice_id=randomUUID(),v=>v.payload.source.terms_version=9007199254740992,
  v=>v.payload.principal_minor=0,v=>v.payload.currency='eur',v=>v.payload.engagement=null,
  v=>v.payload_digest='f'.repeat(64),v=>v.presented_body_sha256='f'.repeat(64)]){
  const changed=structuredClone(capsule);change(changed);
  check(retained({commercial_presentation:changed})===null,'Malformed or changed capsule/source cannot become accepted history');
 }
 // Exercise an actual original schema1 freeze, not a hand-authored replacement
 // capsule. It remains retained history and never invents schema2 service dates.
 const legacy=await makeCommercial(),legacyInput={...legacy.input,schema_version:1};delete legacyInput.engagement;
 const old=await prepareCommercialPresentation(legacyInput),oldBody=commercialPresentationText(legacy.input.body_markdown,old);
 const hex=v=>createHash('sha256').update(v).digest('hex');
 const legacyId=legacy.p.source.agreement_id,legacyDoc=JSON.parse(legacy.p.manifest).document.sha256;
 check(json(`SET ROLE service_role;SELECT _freeze_paige_commercial_presentation('${actor}','${tenant}',${literal(old.payload)},${quote(old.payload_digest)},${quote(oldBody)},${quote(hex(oldBody))},${quote(legacy.p.storage)},${quote(legacyDoc)});`).state==='frozen',
  'The incumbent native producer still accepts its original exact schema1 document');
 const oldRetained=json(`SELECT public._paige_retained_commercial_payload(a) FROM paige_agreements a WHERE id='${legacyId}';`);
 assert.deepEqual(oldRetained,old.payload);checks++;
 check(!('engagement' in oldRetained),'Legacy accepted source never fabricates a service commencement date');
 // Explicitly synthetic legacy rows, without new credentials or disabled
 // immutability: reproduce old separate-writer history before atomic C16.
 sql(`UPDATE paige_agreements SET status='sent',expires_at=clock_timestamp()+interval '1 day' WHERE id='${legacyId}';
  UPDATE paige_agreement_signers SET status='signed',typed_name=full_name,signed_at=statement_timestamp(),
   esign_consent_at=statement_timestamp(),esign_consent_slug='esign-consent',esign_consent_version=1,esign_consent_sha256=repeat('c',64)
   WHERE agreement_id='${legacyId}';
  UPDATE paige_agreements SET status='completed',completed_at=clock_timestamp(),sealed_storage_key='${tenant}/${legacyId}/legacy-sealed.pdf',sealed_sha256=repeat('d',64) WHERE id='${legacyId}';
  INSERT INTO paige_agreement_events(agreement_id,tenant_id,event_type,actor_kind,detail)
   VALUES('${legacyId}','${tenant}','sealed','system',jsonb_build_object('sealed_sha256',repeat('d',64),'presented_sha256',${quote(legacyDoc)})),
   ('${legacyId}','${tenant}','completed','system','{}');`);
 check(accepted(legacyId)===null,'A completed legacy row without original consent/signing events remains unverified');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${legacyId}' AND event_type IN ('consented','signed');`)==='0',
  'Accepted-source inspection never backfills missing historical audit events');
 // Fixture construction only: a wrong-version event must not satisfy that gap.
 sql(`INSERT INTO paige_agreement_events(agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_email,created_at,detail)
  SELECT s.agreement_id,s.tenant_id,s.id,k.kind,'signer',s.email,s.signed_at,
   jsonb_build_object('signature_record_id',gen_random_uuid(),'document_version',${legacy.p.source.version},'document_sha256',${quote(legacyDoc)})
  FROM paige_agreement_signers s CROSS JOIN (VALUES('consented'),('signed')) AS k(kind) WHERE s.agreement_id='${legacyId}';`);
 check(accepted(legacyId)===null,'Audit evidence attributed to a different signature record stays unverified');
 sql(`INSERT INTO paige_agreement_events(agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_email,created_at,detail)
  SELECT s.agreement_id,s.tenant_id,s.id,k.kind,'signer',s.email,s.signed_at,
   jsonb_build_object('signature_record_id',s.id,'document_version',999,'document_sha256',${quote(legacyDoc)})
  FROM paige_agreement_signers s CROSS JOIN (VALUES('consented'),('signed')) AS k(kind) WHERE s.agreement_id='${legacyId}';`);
 check(accepted(legacyId)===null,'Audit events for another document revision cannot confirm accepted terms');
 sql(`INSERT INTO paige_agreement_events(agreement_id,tenant_id,signer_id,event_type,actor_kind,actor_email,created_at,detail)
  SELECT s.agreement_id,s.tenant_id,s.id,k.kind,'signer',s.email,s.signed_at,
   jsonb_build_object('signature_record_id',s.id,'document_version',${legacy.p.source.version},'document_sha256',${quote(legacyDoc)})
  FROM paige_agreement_signers s CROSS JOIN (VALUES('consented'),('signed')) AS k(kind) WHERE s.agreement_id='${legacyId}';`);
 assert.deepEqual(accepted(legacyId),old.payload);checks++;
 const {proveAcceptedCommercialRecord}=await import('./accepted-commercial-proof.mjs');
 const ownerRead=await proveAcceptedCommercialRecord({sql,read,quote,tenant,actor,client,invoiceId:c.invoice,agreementId:id,expected:commercial.payload,legacyId,startSession,observe});
 checks+=ownerRead.checks;
 if(process.argv.includes('--effective-commercial-baseline')){
  // The original accepted history survives changed current terms. The intended
  // new canonical review must refuse to activate that mismatch, not infer a
  // new accepted source. Before C19 the native review contract is absent.
  console.log(JSON.stringify({checkpoint:'Original retained/schema2/native signing/owner controls before effectuation',acceptedChecks:checks,ownerChecks:ownerRead.checks}));
  const source=commercial.payload.source;
  const command={action:'collection.effectuate_terms',agreement_id:c.terms,expected_version:source.terms_version,expected_updated_at:source.terms_updated_at,
   signing_id:id,signing_version:source.agreement_version,invoice_id:c.invoice,invoice_draft_version:source.invoice_draft_version,
   payload_digest:commercial.payload_digest,sealed_sha256:'d'.repeat(64)};
  const preview=json(`SELECT public._preview_sales_effectuation('${actor}','${tenant}',${literal(command)});`);
  check(preview.eligible===false,'Changed current economics cannot become effective from historical signed terms');
 }
 let effectiveCommercial=null;
 if(process.argv.includes('--effective-commercial')){
  const {proveEffectiveCommercialCurrent}=await import('./effective-commercial-proof.mjs');
  effectiveCommercial=await proveEffectiveCommercialCurrent({sql,read,quote,tenant,actor,makeCommercial,startSession,observe});
  checks+=effectiveCommercial.checks;
 }
 return {checks,migrationReplay:2,ownerRead,...(effectiveCommercial?{effectiveCommercial}:{}),scope:'Synthetic original native evidence only; metadata PDF hashes are not actual file/provider/customer acceptance'};
}
