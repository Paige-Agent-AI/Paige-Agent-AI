import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {prepareAgreementFields,prepareAgreementFieldInput} from '../../supabase/functions/_shared/agreements/field-preparation.ts';
import {canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/preparation-json.ts';

/** The ORIGINAL disposable native fixture. Native13 signatures are real local
 * transactions; preparation/answer projections below are controlled synthetic
 * records, NOT the still-unavailable prepared-send/signing customer journey. */
export async function provePreparedSealSource({sql,read,context,tenant,actor,client,fresh,quote,startSession,observe}){
 let checks=0;const check=(v,message)=>{assert(v,message);checks++;};
 const json=q=>JSON.parse(sql(q)),q=quote;
 const identity='public._record_agreement_signature(text,integer,text,text,text,text,boolean,boolean,text,integer,text,inet,text)';
 const originalBody=sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${identity}'::regprocedure;`);
 check(originalBody==='3a2fa340fca9838aa9c6737f1e41ae61','Original actual signature13 positive source control');
 const existing=fresh();check(existing.id&&existing.version===1,'Original authenticated draft writer remains usable');
 const migration=read('supabase/migrations/20271113850004_e04_prepared_seal_source.sql');
 if(!process.argv.includes('--prepared-seal-source-baseline')){sql(migration);sql(migration);}
 const readSource=id=>json(`SET ROLE service_role;SELECT public._read_prepared_agreement_seal('${id}');`);
 check(readSource(existing.id).state==='legacy','Only an actual native no-preparation read permits legacy rendering');
 check(readSource(randomUUID()).state==='unavailable','Unknown agreement never becomes a legacy permission');
 const seed=async(mutator=()=>{},withFact=true,duplicate=false)=>{
  const a=fresh(),before=json(`SELECT row_to_json(a) FROM paige_agreements a WHERE id='${a.id}';`);
  const signer=json(`SELECT row_to_json(s) FROM paige_agreement_signers s WHERE agreement_id='${a.id}';`);
  const prepId=randomUUID(),document={sha256:'a'.repeat(64),byte_length:1234,pages:[{page:1,crop_x:0,crop_y:0,crop_width:600,crop_height:800,rotation:0,width:600,height:800}]};
  const source={tenant_id:tenant,agreement_id:a.id,client_id:client,version:a.version,updated_at:before.updated_at,status:'draft',
   signers:[{id:signer.id,full_name:signer.full_name,email:signer.email,signer_role:signer.signer_role,signing_order:signer.signing_order,status:signer.status}]};
  const field=randomUUID();
  const preparation=await prepareAgreementFields(source,document,[{id:field,signer_id:signer.id,kind:'signature',page:1,x:20,y:20,width:200,height:40,required:true,label:'Signature'}]);
  const retention=json(`INSERT INTO paige_agreement_events(tenant_id,agreement_id,event_type,actor_kind,actor_user_id,detail)
   VALUES('${tenant}','${a.id}','edited','owner','${actor}',${q(JSON.stringify({action:'document_preparation_recorded',preparation_id:prepId,preparation_sha256:preparation.preparation_sha256,document_sha256:document.sha256,source_version:a.version}))}::jsonb) RETURNING row_to_json(paige_agreement_events);`);
  const token=createHash('sha256').update(randomUUID()).digest('hex'),key=`${tenant}/${a.id}/synthetic-source.pdf`;
  sql(`UPDATE paige_agreements SET status='sent',content_storage_key=${q(key)},content_sha256=repeat('a',64) WHERE id='${a.id}';
   UPDATE paige_agreement_signers SET token_hash='${token}',token_expires_at=clock_timestamp()+interval '1 day' WHERE id='${signer.id}';`);
  const receipt=json(`SET ROLE service_role;SELECT public._record_agreement_signature('${token}',${a.version},repeat('a',64),${q(key)},'Synthetic Field Signer',NULL,true,true,'synthetic-esign',1,repeat('c',64),NULL,'Synthetic native proof');`);
  check(receipt.state==='recorded'&&receipt.audit_complete,'Actual original13 signature and consent recorded before controlled projection setup');
  const signed=json(`SELECT row_to_json(s) FROM paige_agreement_signers s WHERE id='${signer.id}';`);
  const input=await prepareAgreementFieldInput(preparation,{tenant_id:tenant,agreement_id:a.id,client_id:client,preparation_id:prepId,preparation_sha256:preparation.preparation_sha256,signer_id:signer.id,signed_at:signed.signed_at},[{field_id:field,value:true}]);
  const state={manifest:structuredClone(preparation.manifest),input:structuredClone(input),fact:{signed_event_id:receipt.signed_event_id,consented_event_id:receipt.consented_event_id},email:signer.email,key,client,version:a.version,createdAt:retention.created_at};
  mutator(state);
  const canonical=canonicalPresentationJson(state.manifest),prepHash=createHash('sha256').update(canonical).digest('hex');
  // Direct controlled metadata seeding ONLY; no native hold is disabled and
  // this deliberately does not claim an approved prepared-signature journey.
  sql(`INSERT INTO paige_agreement_document_preparations(id,agreement_id,tenant_id,revision_no,client_id,source_version,source_updated_at,actor_user_id,content_storage_key,document_sha256,document_byte_length,manifest_canonical,preparation_sha256,event_id,created_at)
   VALUES('${prepId}','${a.id}','${tenant}',1,'${state.client}',${state.version},${q(before.updated_at)}::timestamptz,'${actor}',${q(state.key)},repeat('a',64),1234,${q(canonical)},'${prepHash}','${retention.id}',${q(state.createdAt)}::timestamptz);`);
  const fact={...state.fact,field_input:state.input};
  const append=`INSERT INTO paige_agreement_events(tenant_id,agreement_id,signer_id,event_type,actor_kind,actor_email,detail,created_at)
   VALUES('${tenant}','${a.id}','${signer.id}','field_values_recorded','signer',${q(state.email)},${q(JSON.stringify(fact))}::jsonb,${q(signed.signed_at)}::timestamptz);`;
  if(withFact)sql(append);if(duplicate)sql(append);
  return {a,signer,signed,prepId,input,receipt};
 };
 const positive=await seed(),beforeEvents=sql('SELECT count(*) FROM paige_agreement_events;');
 const result=readSource(positive.a.id);
 check(result.state==='prepared'&&result.prepared_fields.preparation_id===positive.prepId,'Private read joins original selected source and actual signature/consent IDs');
 check(canonicalPresentationJson(result.prepared_fields.inputs[0])===canonicalPresentationJson(positive.input),'Exact canonical assigned values and timestamp survive native read');
 check(result.signers[0].id===positive.signer.id&&result.signers[0].signed_at===positive.input.signed_at,'Actual immutable signer identity and exact timestamp spelling preserved');
 check(JSON.stringify(readSource(positive.a.id))===JSON.stringify(result)&&sql('SELECT count(*) FROM paige_agreement_events;')===beforeEvents,'A repeated source read has no signature/event/completion/provider effect');
 const cases=[
  ['missing actual field fact',()=>{},false,false],
  ['duplicate field facts',()=>{},true,true],
  ['foreign actual signature receipt',s=>s.fact.signed_event_id=positive.receipt.signed_event_id],
  ['foreign actual consent receipt',s=>s.fact.consented_event_id=positive.receipt.consented_event_id],
  ['wrong actual field signer',s=>s.input={...s.input,signer_id:positive.signer.id}],
  ['wrong field document',s=>s.input={...s.input,document_sha256:'b'.repeat(64)}],
  ['wrong field digest',s=>s.input={...s.input,field_input_sha256:'d'.repeat(64)}],
  ['wrong field author',s=>s.email='different@example.invalid'],
  ['wrong private source path',s=>s.key=s.key.replace('synthetic-source','different-source')],
  ['wrong source version',s=>s.version++],
  ['different manifest party',s=>s.manifest.signers[0].identity_sha256='e'.repeat(64)],
  ['different manifest schema',s=>s.manifest.schema_version=0],
  ['different native signed microsecond despite a valid input hash',s=>{
   const input={...s.input};delete input.field_input_sha256;const original=input.signed_at;
   input.signed_at=json(`SELECT to_jsonb(date_trunc('milliseconds',${q(original)}::timestamptz)
    +CASE WHEN extract(microseconds FROM ${q(original)}::timestamptz)::bigint%1000=1 THEN interval '2 microseconds' ELSE interval '1 microsecond' END);`);
   check(Date.parse(input.signed_at)===Date.parse(original)&&input.signed_at!==original,'Precision control changes the native instant within the same JavaScript millisecond');
   s.input={...input,field_input_sha256:createHash('sha256').update(canonicalPresentationJson(input)).digest('hex')};
  }],
  ['preparation dated after actual signing',s=>s.createdAt=json(`SELECT to_jsonb(${q(s.input.signed_at)}::timestamptz+interval '1 microsecond');`)],
 ];
 for(const [label,change,fact=true,duplicate=false] of cases){const v=await seed(change,fact,duplicate);check(readSource(v.a.id).state==='unavailable',label);}
 const deselected=await seed();sql(`UPDATE paige_agreement_document_preparations SET is_current=false WHERE id='${deselected.prepId}';`);
 check(readSource(deselected.a.id).state==='unavailable','A historical preparation with unavailable current selection never becomes legacy');
 for(const role of ['anon','authenticated']){
  assert.throws(()=>sql(`SET ROLE ${role};SELECT public._read_prepared_agreement_seal('${positive.a.id}');`),/permission denied/);checks++;
 }
 assert.throws(()=>sql('SET ROLE service_role;SELECT count(*) FROM paige_agreement_document_preparations;'),/permission denied/);checks++;
 const meta=json("SELECT jsonb_build_object('definer',prosecdef,'config',proconfig,'defaults',pronargdefaults,'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE')) FROM pg_proc WHERE oid='public._read_prepared_agreement_seal(uuid)'::regprocedure;");
 check(meta.definer&&meta.defaults===0&&meta.config.includes('search_path=""')&&!meta.anon&&!meta.authenticated&&meta.service,'Private empty-search-path service-only read ABI; no owner/staff/client grant');
 check(sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${identity}'::regprocedure;`)===originalBody,'Original13 body and ABI unchanged');
 const definition=sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.paige_agreement_events'::regclass AND conname='paige_agreement_events_event_type_check';");
 const future=definition.replace("'field_values_recorded'::text","'field_values_recorded'::text, 'future_test_only'::text");
 check(future!==definition,'Forward-owner extension control really changes the original type contract');
 sql(`ALTER TABLE paige_agreement_events DROP CONSTRAINT paige_agreement_events_event_type_check;ALTER TABLE paige_agreement_events ADD CONSTRAINT paige_agreement_events_event_type_check ${future};`);
 assert.throws(()=>sql(migration),/Original agreement event types changed; reconcile before applying/);checks++;
 check(sql("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.paige_agreement_events'::regclass AND conname='paige_agreement_events_event_type_check';")===future,'Failed migration preserves a later owner event-type extension');
 sql(`ALTER TABLE paige_agreement_events DROP CONSTRAINT paige_agreement_events_event_type_check;ALTER TABLE paige_agreement_events ADD CONSTRAINT paige_agreement_events_event_type_check ${definition};`);
 sql(migration);
 check(readSource(positive.a.id).state==='prepared','Restored exact contract replays without losing original signature or field evidence');
 const name='e04_prepared_seal_'+randomUUID().slice(0,8);
 const holder=startSession(name+'_void',`BEGIN;UPDATE paige_agreements SET status='voided' WHERE id='${positive.a.id}';SELECT pg_sleep(0.8);COMMIT;`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(name+'_void')} AND wait_event='PgSleep');`);
 const waiting=startSession(name+'_read',`SET ROLE service_role;SELECT public._read_prepared_agreement_seal('${positive.a.id}');`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(name+'_read')} AND wait_event_type='Lock');`);checks++;
 const [,afterVoid]=await Promise.all([holder,waiting]);
 check(JSON.parse(afterVoid).state==='unavailable','Actual parent-lock wait observes committed void instead of returning earlier prepared evidence');
 return {result:'PASS',checks,migrationReplay:3,forwardGuardRefusals:1,concurrentSessions:2,observedLockWaits:1,scope:'Actual local original13 controls plus controlled private metadata projection; no real prepared send/signing/Storage/customer acceptance'};
}
