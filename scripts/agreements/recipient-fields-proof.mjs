import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {prepareAgreementFields} from '../../supabase/functions/_shared/agreements/field-preparation.ts';
import {canonicalPresentationJson} from '../../supabase/functions/_shared/agreements/preparation-json.ts';

// Additional cases in the ORIGINAL disposable native fixture. Controlled local
// metadata is not an approved prepared send, real recipient or customer proof.
export async function proveRecipientFields({sql,read,context,tenant,actor,client,fresh,quote,startSession,observe}){
 let checks=0;const check=(v,m)=>{assert(v,m);checks++;},q=quote;
 const json=s=>JSON.parse(sql(s));
 const snapshot=()=>sql("SELECT jsonb_build_object('agreements',(SELECT count(*) FROM paige_agreements),'signers',(SELECT count(*) FROM paige_agreement_signers),'events',(SELECT count(*) FROM paige_agreement_events),'preparations',(SELECT count(*) FROM paige_agreement_document_preparations));");
 const originals=()=>sql("SELECT jsonb_agg(jsonb_build_object('name',oid::regprocedure::text,'body',md5(prosrc),'owner',proowner,'acl',proacl::text,'config',proconfig,'definer',prosecdef) ORDER BY oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('_record_agreement_signature','_read_prepared_agreement_seal','_paige_preparation_legacy_effect_hold','_paige_preparation_legacy_token_hold','_agreement_preparation_parties');");
 const original=originals(),before=snapshot();
 const originalOwner=sql("SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public._read_prepared_agreement_seal(uuid)'::regprocedure;");
 const migration=read('supabase/migrations/20271113870004_e04_recipient_field_read.sql');
 if(!process.argv.includes('--recipient-fields-baseline')){sql(migration);sql(migration);}
 check(snapshot()===before,'Installing private read creates no commercial/signature/event/preparation record');
 const invoke=token=>json(`SET ROLE service_role;SELECT public._read_agreement_signing_fields(${q(token)});`);
 const refused=(token,code='42501',role='service_role')=>{
  sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN PERFORM public._read_agreement_signing_fields(${token===null?'NULL':q(token)});RAISE EXCEPTION 'Expected recipient refusal ${code}';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);checks++;
 };
 const base=()=>{
  const a=fresh();
  sql(context+`SELECT add_agreement_signer('${tenant}','${a.id}','Separate Witness','witness@example.test','witness',NULL);`);
  const agreement=json(`SELECT row_to_json(a) FROM paige_agreements a WHERE id='${a.id}';`);
  const signers=json(`SELECT jsonb_agg(to_jsonb(s) ORDER BY signing_order,id) FROM paige_agreement_signers s WHERE agreement_id='${a.id}';`);
  const token=createHash('sha256').update(randomUUID()).digest('hex'),other=createHash('sha256').update(randomUUID()).digest('hex');
  const key=`${tenant}/${a.id}/synthetic-recipient.pdf`;
  sql(`UPDATE paige_agreements SET status='sent',content_storage_key=${q(key)},content_sha256=repeat('a',64) WHERE id='${a.id}';
   UPDATE paige_agreement_signers SET token_hash=CASE WHEN id='${signers[0].id}' THEN '${token}' ELSE '${other}' END,token_expires_at=clock_timestamp()+interval '1 day' WHERE agreement_id='${a.id}';`);
  // Adding the real second party advances the original saved revision.
  return {a:{...a,version:agreement.version},agreement,signers,token,other,key};
 };
 const seed=async(change=()=>{})=>{
  const x=base(),id=randomUUID();
  const source={tenant_id:tenant,agreement_id:x.a.id,client_id:client,version:x.a.version,updated_at:x.agreement.updated_at,status:'draft',signers:x.signers.map(({id,full_name,email,signer_role,signing_order,status})=>({id,full_name,email,signer_role,signing_order,status}))};
  const document={sha256:'a'.repeat(64),byte_length:1234,pages:[{page:1,crop_x:0,crop_y:0,crop_width:600,crop_height:800,rotation:0,width:600,height:800}]};
  const fields=x.signers.map((s,i)=>({id:randomUUID(),signer_id:s.id,kind:'signature',page:1,x:20,y:20+i*80,width:200,height:40,required:true,label:'Signature'}));
  fields.push({id:randomUUID(),signer_id:x.signers[0].id,kind:'text',page:1,x:20,y:180,width:200,height:40,required:true,label:'Service contact'});
  const prepared=await prepareAgreementFields(source,document,fields);assert(prepared.ready_for_review);
  const state={manifest:structuredClone(prepared.manifest),eventAction:'document_preparation_recorded',client,version:x.a.version,key:x.key,documentHash:document.sha256,byteLength:1234};
  change(state,x);
  const canonical=canonicalPresentationJson(state.manifest),digest=createHash('sha256').update(canonical).digest('hex');
  const event=json(`INSERT INTO paige_agreement_events(tenant_id,agreement_id,event_type,actor_kind,actor_user_id,detail)
   VALUES('${tenant}','${x.a.id}','edited','owner','${actor}',${q(JSON.stringify({action:state.eventAction,preparation_id:id,preparation_sha256:digest,document_sha256:state.documentHash,source_version:state.version}))}::jsonb) RETURNING row_to_json(paige_agreement_events);`);
  sql(`INSERT INTO paige_agreement_document_preparations(id,agreement_id,tenant_id,revision_no,client_id,source_version,source_updated_at,actor_user_id,content_storage_key,document_sha256,document_byte_length,manifest_canonical,preparation_sha256,event_id)
   VALUES('${id}','${x.a.id}','${tenant}',1,'${state.client}',${state.version},${q(x.agreement.updated_at)}::timestamptz,'${actor}',${q(state.key)},${q(state.documentHash)},${state.byteLength},${q(canonical)},'${digest}','${event.id}');`);
  return {...x,id,fields,digest};
 };

 const legacy=base(),beforeRead=snapshot();
 check(invoke(legacy.token).kind==='legacy','Only actual absence of every preparation permits legacy');
 check(snapshot()===beforeRead,'Legacy read adds no event or view/signature status');
 const positive=await seed(),positiveBefore=snapshot();
 const result=invoke(positive.token);
 check(result.kind==='prepared'&&result.signer_id===positive.signers[0].id&&result.agreement_id===positive.a.id&&result.tenant_id===tenant,'Original token binds actual native tenant/agreement/recipient');
 check(result.preparation_id===positive.id&&result.preparation_sha256===positive.digest&&result.document.sha256==='a'.repeat(64),'Exact retained preparation and document retained');
 check(result.fields.length===2&&result.fields.every(f=>['signature','text'].includes(f.kind)),'Only own two assigned fields projected');
 check(result.fields.every(f=>Object.keys(f).sort().join(',')==='height,id,kind,label,page,required,width,x,y'),'Closed field DTO omits all private signer/source authority');
 check(!JSON.stringify(result.fields).includes(positive.signers[1].id)&&!JSON.stringify(result).includes('witness@example.test'),'Other recipient identity and fields withheld');
 check(snapshot()===positiveBefore,'Prepared read does not append a view, consent, signature or preparation');
 check(sql(`SELECT status FROM paige_agreement_signers WHERE id='${positive.signers[0].id}';`)==='pending','Ordinary field read never manufactures viewing');
 refused(positive.other);
 refused(null);refused('');refused('not-a-digest');refused('a'.repeat(64));
 for(const [label,change] of [
  ['different original client',s=>s.client=randomUUID()],
  ['different original version',s=>s.version++],
  ['different private source',s=>s.key+='changed'],
  ['different native document hash',s=>s.documentHash='b'.repeat(64)],
  ['manifest client mismatch',s=>s.manifest.source.client_id=randomUUID()],
  ['manifest version mismatch',s=>s.manifest.source.version++],
  ['document byte mismatch',s=>s.manifest.document.byte_length++],
  ['party identity changed',s=>s.manifest.signers[0].identity_sha256='f'.repeat(64)],
  ['wrong original preparation event',s=>s.eventAction='different_action'],
  ['own signature absent',s=>s.manifest.fields=s.manifest.fields.filter(f=>f.kind!=='signature'||f.signer_id!==s.manifest.signers[0].id)],
 ]){const x=await seed(change);refused(x.token,'23514');check(invoke(positive.token).preparation_id===positive.id,`${label} refusal preserves original positive preparation`);}
 const deselected=await seed();sql(`UPDATE paige_agreement_document_preparations SET is_current=false WHERE id='${deselected.id}';`);refused(deselected.token,'23514');
 for(const [label,statement] of [
  ['revoked',s=>`UPDATE paige_agreement_signers SET token_revoked_at=clock_timestamp() WHERE id='${s.signers[0].id}';`],
  ['expired token',s=>`UPDATE paige_agreement_signers SET token_expires_at=clock_timestamp()-interval '1 second' WHERE id='${s.signers[0].id}';`],
  ['expired agreement',s=>`UPDATE paige_agreements SET expires_at=clock_timestamp()-interval '1 second' WHERE id='${s.a.id}';`],
  ['void agreement',s=>`UPDATE paige_agreements SET status='voided' WHERE id='${s.a.id}';`],
 ]){const x=base();sql(statement(x));try{refused(x.token);}catch(error){throw new Error(label+' did not refuse',{cause:error});}}
 const bounded=base();
 assert.throws(()=>sql(`UPDATE paige_agreement_signers SET token_expires_at=NULL WHERE id='${bounded.signers[0].id}';`),/pas_token_needs_expiry_ck/);checks++;
 check(invoke(bounded.token).kind==='legacy','Original non-null credential deadline constraint rejects invalid setup and preserves the usable link');
 for(const statement of [
  `UPDATE paige_agreement_signers SET status='viewed' WHERE id='${positive.signers[0].id}';`,
  `UPDATE paige_agreement_signers SET token_hash=repeat('d',64) WHERE id='${positive.signers[0].id}';`,
  `UPDATE paige_agreements SET status='viewed' WHERE id='${positive.a.id}';`,
 ]){assert.throws(()=>sql(statement),/Prepared-document .*canonical approved send integration/);checks++;}
 check(invoke(positive.token).preparation_id===positive.id,'Field read does not release prepared token, view or effect holds');
 for(const role of ['anon','authenticated'])refused(positive.token,'42501',role);
 const meta=json("SELECT jsonb_build_object('definer',prosecdef,'owner',pg_get_userbyid(proowner),'config',proconfig,'defaults',pronargdefaults,'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),'service',has_function_privilege('service_role',oid,'EXECUTE')) FROM pg_proc WHERE oid='public._read_agreement_signing_fields(text)'::regprocedure;");
 check(meta.definer&&meta.owner===originalOwner&&meta.defaults===0&&meta.config.includes('search_path=""')&&!meta.anon&&!meta.authenticated&&meta.service,'Original native owner and service-only empty-search-path ABI; no browser grant');
 check(originals()===original,'Original13 signature, seal reader, party constructor and both token/effect holds unchanged');

 const race=base(),name='e04_recipient_'+randomUUID().slice(0,8);
 const holder=startSession(name+'_revoke',`BEGIN;UPDATE paige_agreement_signers SET token_revoked_at=clock_timestamp() WHERE id='${race.signers[0].id}';SELECT pg_sleep(0.8);COMMIT;`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(name+'_revoke')} AND wait_event='PgSleep');`);
 const waiting=startSession(name+'_read',`SET ROLE service_role;DO $proof$ BEGIN BEGIN PERFORM public._read_agreement_signing_fields('${race.token}');RAISE EXCEPTION 'Expected concurrent revocation refusal';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;SELECT 'refused';`);
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(name+'_read')} AND wait_event_type='Lock');`);checks++;
 const [,outcome]=await Promise.all([holder,waiting]);check(outcome==='refused','Waiting native read revalidates committed revocation');
 return {result:'PASS',checks,migrationReplay:2,concurrentSessions:2,observedLockWaits:1,scope:'Original local native read and controlled preparation projections only; approved send/signing/Storage/customer journey remains unavailable'};
}
