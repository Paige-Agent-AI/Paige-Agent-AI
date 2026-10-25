import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {renderPresentedPdf,sealAgreementPdf} from '../../supabase/functions/_shared/agreements/document.ts';
import {inspectAgreementPreparationPdf} from '../../supabase/functions/_shared/agreements/document-preparation.ts';
import {verifyRetainedAgreementPdf} from '../../supabase/functions/_shared/agreements/retained-document.ts';
import {canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/preparation-json.ts';
import {sha256Hex} from '../../supabase/functions/_shared/agreements/token.ts';

// SAME original fenced native program and original PDF renderer. The bytes are
// real; outer Auth/provider/storage ports are controlled local fixtures only.
export async function provePreparedSealCompletion({sql,read,q,tenant,acceptedFixture,publish,write,readFields,payload,startSession,observe}){
 let checks=0,sessions=0,waits=0;const check=(value,message)=>{assert(value,message);checks++;};
 const native=s=>'SET ROLE service_role;'+s,json=s=>JSON.parse(sql(s));
 const bytes=await renderPresentedPdf({title:'Synthetic nonbinding native proof',bodyMarkdown:'Controlled native completion proof. No real customer, payment or service obligation.'});
 const document=await inspectAgreementPreparationPdf(bytes,await sha256Hex(bytes));
 const v=await acceptedFixture({document,allFieldTypes:true,secondSigner:true});json(native(publish(v)));
 for(let index=0;index<v.hashes.length;index++){
  const fields=readFields(v,index);check(json(native(write(v,fields,payload(fields)))).audit_complete===true,'Actual original canonical signatures precede sealing');
 }
 const source=json(native(`SELECT _read_prepared_agreement_seal('${v.a.id}');`));
 check(source.state==='prepared'&&source.document_sha256===document.sha256&&source.signers.length===2,
  'Original native preparation/signature/field source binds the exact real presented bytes');
 const events=json(`SELECT jsonb_agg(jsonb_build_object('eventType',event_type,'at',created_at,'actorKind',actor_kind,'actorLabel',actor_email,'ip',ip) ORDER BY created_at,seq)
  FROM paige_agreement_events WHERE tenant_id='${tenant}' AND agreement_id='${v.a.id}';`);
 const sealed=await sealAgreementPdf({presentedBytes:bytes,presentedSha256:document.sha256,presentedKind:'file',
  agreementTitle:'Synthetic nonbinding native proof',agreementId:v.a.id,tenantName:'Synthetic native proof business',sealedAtIso:new Date().toISOString(),
  preparedFields:source.prepared_fields,parties:source.signers.map(s=>({signerId:s.id,fullName:s.full_name,email:s.email,role:s.signer_role,
   signingOrder:s.signing_order,status:s.status,typedName:s.typed_name,signedAt:s.signed_at,consentAt:s.esign_consent_at,
   consentSlug:s.esign_consent_slug,consentVersion:s.esign_consent_version,signingIp:s.signing_ip,signingUserAgent:s.signing_user_agent,signatureImagePng:null})),events});
 const sealedSha256=await sha256Hex(sealed),sourceSha256=await sha256Hex(canonicalPresentationJson(source));
 check(await verifyRetainedAgreementPdf(sealed,sealedSha256),'Real original sealed PDF bytes and digest verify; no fabricated PDF metadata');
 const key=tenant+'/'+v.a.id+'/sealed-'+randomUUID()+'.pdf';
 const migration=read('supabase/migrations/20271114230404_e04_prepared_field_signature.sql');
 for(const identity of ['public._read_prepared_agreement_seal(uuid)','private.e04_prepared_completion_record(public.paige_agreements)',
  'public._complete_prepared_agreement_seal(uuid,uuid,text,text,text)']){
  const original=sql(`SELECT pg_get_functiondef(${q(identity)}::regprocedure);`).replaceAll('\r\n','\n');
  const before=sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid=${q(identity)}::regprocedure;`);
  const changed=original.replace('BEGIN\n','BEGIN\n -- isolated completion drift refusal\n');assert(changed!==original);sql(changed);
  try{assert.throws(()=>sql(migration),/Original prepared signing source changed/);checks++;}
  finally{sql(original);check(sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid=${q(identity)}::regprocedure;`)===before,'Exact original completion/source bytes restored after guard refusal');}
 }
 const call=(f,patch={})=>{const args={tenant,agreement:f.id,source:f.sourceSha,key:f.key,sha:f.sha,...patch};
  return `SELECT _complete_prepared_agreement_seal('${args.tenant}','${args.agreement}',${args.source===null?'NULL':q(args.source)},${args.key===null?'NULL':q(args.key)},${args.sha===null?'NULL':q(args.sha)});`;};
 const snapshot=id=>sql(`SELECT md5(jsonb_build_object('agreement',(SELECT to_jsonb(a) FROM paige_agreements a WHERE id='${id}'),
  'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY seq) FROM paige_agreement_events e WHERE agreement_id='${id}'))::text);`);
 const refused=(f,statement,code='23514',role='service_role')=>{
  const before=snapshot(f.id);sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${statement.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};
   RAISE EXCEPTION 'Expected original completion refusal';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);
  check(snapshot(f.id)===before,'Refused completion leaves original record and both audit events unchanged');
 };
 const current={id:v.a.id,sourceSha:sourceSha256,key,sha:sealedSha256};
 const beforeEmpty=snapshot(current.id),empty=json(native(call(current,{source:null,key:null,sha:null})));
 check(empty.state==='unavailable'&&snapshot(current.id)===beforeEmpty,'Empty-evidence status reconciliation cannot complete an agreement');
 for(const role of ['anon','authenticated'])refused(current,call(current),'42501',role);
 for(const patch of [{tenant:randomUUID()},{agreement:randomUUID()}])refused(current,call(current,patch),'42501');
 for(const patch of [{source:'0'.repeat(64)},{source:null},{sha:'not-a-digest'},
  {key:'foreign/'+key},{key:key.replace('/sealed-','/%2fsealed-')},{key:key.replace('/sealed-','/../sealed-')}])refused(current,call(current,patch));
 const unsigned=await acceptedFixture({document,allFieldTypes:true,secondSigner:true});json(native(publish(unsigned)));
 const noSignature={id:unsigned.a.id,sourceSha:sourceSha256,key:tenant+'/'+unsigned.a.id+'/sealed-'+randomUUID()+'.pdf',sha:sealedSha256};
 refused(noSignature,call(noSignature));
 // Causal baseline: the original prepared hold still prevents the old direct
 // status update. A canonical atomic completion contract must actually exist.
 const receipt=json(native(call(current)));
 check(receipt.state==='recorded'&&receipt.agreement_id===v.a.id&&receipt.sealed_sha256===sealedSha256,
  'Original completed record and its actual seal/complete receipts are authoritative');
 const after=snapshot(current.id),replay=json(native(call(current))),readback=json(native(call(current,{source:null,key:null,sha:null})));
 check(replay.replayed&&readback.replayed&&receipt.completed_event_id===replay.completed_event_id
  &&receipt.completed_event_id===readback.completed_event_id&&snapshot(current.id)===after,'Replay and empty-evidence recovery retain the SAME original completion and events');
 const other=json(native(call(current,{key:tenant+'/'+current.id+'/sealed-'+randomUUID()+'.pdf',sha:'f'.repeat(64)})));
 check(other.replayed&&other.sealed_storage_key===key&&other.sealed_sha256===sealedSha256&&snapshot(current.id)===after,
  'A later candidate cannot replace the immutable winning file or fabricate another completion');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${current.id}' AND event_type IN ('sealed','completed') AND detail->>'action'='prepared_seal_recorded';`)==='2',
  'Exactly one original sealed/completed event pair accompanies the record');
 const fresh=async()=>{
  const f=await acceptedFixture({document,allFieldTypes:true,secondSigner:true});json(native(publish(f)));
  for(let index=0;index<f.hashes.length;index++){const fields=readFields(f,index);check(json(native(write(f,fields,payload(fields)))).audit_complete,'Actual original signatures precede each new completion scenario');}
  const original=json(native(`SELECT _read_prepared_agreement_seal('${f.a.id}');`));
  const retained=await sealAgreementPdf({presentedBytes:bytes,presentedSha256:document.sha256,presentedKind:'file',
   agreementTitle:'Synthetic nonbinding native proof',agreementId:f.a.id,tenantName:'Synthetic native proof business',sealedAtIso:new Date().toISOString(),
   preparedFields:original.prepared_fields,parties:original.signers.map(s=>({signerId:s.id,fullName:s.full_name,email:s.email,role:s.signer_role,
    signingOrder:s.signing_order,status:s.status,typedName:s.typed_name,signedAt:s.signed_at,consentAt:s.esign_consent_at,
    consentSlug:s.esign_consent_slug,consentVersion:s.esign_consent_version,signingIp:s.signing_ip,signingUserAgent:s.signing_user_agent,signatureImagePng:null})),events:[]});
  return{id:f.a.id,sourceSha:await sha256Hex(canonicalPresentationJson(original)),key:tenant+'/'+f.a.id+'/sealed-'+randomUUID()+'.pdf',sha:await sha256Hex(retained)};
 };
 const rollback=await fresh(),constraint='e04_completion_abort_'+randomUUID().replaceAll('-','');
 sql(`ALTER TABLE paige_agreements ADD CONSTRAINT ${constraint} CHECK(id<>'${rollback.id}'::uuid OR status<>'completed');`);
 try{refused(rollback,call(rollback));}
 finally{sql(`ALTER TABLE paige_agreements DROP CONSTRAINT ${constraint};`);}
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${rollback.id}' AND event_type IN ('sealed','completed');`)==='0',
  'A genuine row-constraint failure rolls back BOTH original completion events');
 const concurrent=await fresh(),tag='e04_seal_'+randomUUID().replaceAll('-','');
 const holder=startSession(tag+'holder','BEGIN;SET LOCAL ROLE service_role;'+call(concurrent)+'SELECT pg_sleep(1.5);COMMIT;');sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'holder')} AND wait_event='PgSleep');`);
 const duplicate=startSession(tag+'duplicate',native(call(concurrent,{key:tenant+'/'+concurrent.id+'/sealed-'+randomUUID()+'.pdf'})));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'duplicate')} AND wait_event_type='Lock');`);waits++;
 const [left,right]=await Promise.all([holder,duplicate]),first=JSON.parse(left),second=JSON.parse(right);
 check(first.completed_event_id===second.completed_event_id&&first.replayed!==second.replayed&&first.sealed_storage_key===second.sealed_storage_key,
  'Two genuine simultaneous completions serialize on the SAME original record and immutable file');
 return {checks,sourceSha256,sealedSha256,sealedByteLength:sealed.byteLength,concurrentSessions:sessions,observedLockWaits:waits,
  scope:'Real original local PDF/native state with synthetic Auth/provider/storage ports; no hosted Storage or customer acceptance'};
}
