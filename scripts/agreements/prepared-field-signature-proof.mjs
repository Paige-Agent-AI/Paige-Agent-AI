import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareAgreementFieldInput} from '../../supabase/functions/_shared/agreements/field-preparation.ts';

// Continue the ORIGINAL fenced native program. Synthetic provider acceptance
// reaches the exact retained document before exercising actual signing writes.
// No second signer store, real recipient act, provider operation or QA account.
export async function provePreparedFieldSignature({sql,read,q,tenant,context,acceptedFixture,publish,startSession,observe}){
 let checks=0,sessions=0,waits=0;const check=(value,message)=>{assert(value,message);checks++;};
 const native=s=>'SET ROLE service_role;'+s,json=s=>JSON.parse(sql(s));
 const v=await acceptedFixture(),published=json(native(publish(v)));
 check(published.state==='recorded'&&published.delivery_confirmed===false,'Original accepted message is recorded without invented delivery');
 const signer=json(native(`SELECT _read_agreement_signing_fields(${q(v.hashes[0].token_hash)});`));
 check(signer.kind==='prepared'&&signer.agreement_id===v.a.id&&signer.signer_id===v.hashes[0].signer_id,'Actual original token-derived assigned fields authorize only this recipient');
 const agreement=json(`SELECT jsonb_build_object('version',version,'sha256',content_sha256,'key',content_storage_key) FROM paige_agreements WHERE id='${v.a.id}';`);
 const values=signer.fields.filter(f=>f.kind!=='signed_date').map(f=>({field_id:f.id,value:f.kind==='signature'?true:f.kind==='checkbox'?false:f.kind==='initials'?'SS':'Synthetic field value'}));
 check(values.length>0&&signer.fields.some(f=>f.kind==='signature'),'Original retained preparation supplies the actual fields; no invented form');
 const prepared={preparation_id:signer.preparation_id,preparation_sha256:signer.preparation_sha256,values};
 // Desired authoritative overload extends the SAME canonical signature writer.
 // Baseline must fail here until its atomic field/consent/evidence contract is
 // implemented. The original13 ABI and all legacy controls remain required.
 // Existing production service role already has private-schema USAGE (read-only metadata confirmed); complete the older disposable fixture to the same contract.
 if(!process.argv.includes('--prepared-field-signature-baseline')){
  sql('GRANT USAGE ON SCHEMA private TO service_role;');
  const migration=read('supabase/migrations/20271114220004_e04_prepared_field_signature.sql');sql(migration);sql(migration);
 }
 const receipt=json(native(`SELECT _record_agreement_signature(${q(v.hashes[0].token_hash)},${agreement.version},${q(agreement.sha256)},${q(agreement.key)},'Synthetic Signer',NULL,true,true,'synthetic-consent',1,repeat('a',64),NULL,'synthetic-local-proof',${q(JSON.stringify(prepared))}::jsonb);`));
 check(receipt.state==='recorded'&&receipt.audit_complete===true,'Actual signature, consent and assigned fields must commit atomically');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${v.a.id}' AND signer_id='${signer.signer_id}' AND event_type='field_values_recorded';`)==='1','One exact original field receipt, never a separate execution ledger');
 const readFields=(f,index=0)=>json(native(`SELECT _read_agreement_signing_fields(${q(f.hashes[index].token_hash)});`));
 const retained=f=>json(`SELECT jsonb_build_object('manifest',manifest_canonical::jsonb,'preparation_sha256',preparation_sha256,'ready_for_review',true,'issues','[]'::jsonb)
  FROM paige_agreement_document_preparations WHERE id='${f.preparation}' AND agreement_id='${f.a.id}' AND tenant_id='${tenant}';`);
 const answers=source=>source.fields.filter(f=>f.kind!=='signed_date'&&f.required).map(f=>({field_id:f.id,
  value:f.kind==='signature'?true:f.kind==='checkbox'?false:f.kind==='initials'?'SS':'Synthetic text\nwith a permitted tab\tand carriage return\r'}));
 const payload=(source,values=answers(source))=>({preparation_id:source.preparation_id,preparation_sha256:source.preparation_sha256,values});
 const write=(f,source,input,options={})=>{
  const a=json(`SELECT jsonb_build_object('version',version,'sha256',content_sha256,'key',content_storage_key) FROM paige_agreements WHERE id='${f.a.id}';`);
  const token=f.hashes.find(x=>x.signer_id===source.signer_id).token_hash;
  const fields=options.expression??(input===null?'NULL::jsonb':q(JSON.stringify(input))+'::jsonb');
  return `SELECT _record_agreement_signature(${q(token)},${a.version},${q(a.sha256)},${q(a.key)},'Synthetic Signer',NULL,true,true,'synthetic-consent',1,repeat('a',64),NULL,'synthetic-local-proof'${options.legacy?'':','+fields});`;
 };
 const snapshot=f=>sql(`SELECT md5(jsonb_build_object('agreement',(SELECT to_jsonb(a) FROM paige_agreements a WHERE a.id='${f.a.id}'),
  'signers',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM paige_agreement_signers s WHERE s.agreement_id='${f.a.id}'),
  'events',(SELECT jsonb_agg(to_jsonb(e) ORDER BY seq) FROM paige_agreement_events e WHERE e.agreement_id='${f.a.id}'))::text);`);
 const refused=(f,statement,code='23514',role='service_role')=>{
  const before=snapshot(f);
  sql(`SET ROLE ${role};DO $proof$ BEGIN BEGIN ${statement.replace(/^SELECT\s+/,'PERFORM ').replace(/;\s*$/,'')};
   RAISE EXCEPTION 'Expected exact assigned-field refusal';EXCEPTION WHEN SQLSTATE '${code}' THEN NULL;END;END $proof$;`);
  check(snapshot(f)===before,'Exact refusal rolls back every original signer, agreement and audit record');
 };
 const all=await acceptedFixture({allFieldTypes:true,secondSigner:true});
 const allPublished=json(native(publish(all))),first=readFields(all),full=retained(all),input=payload(first);
 check(allPublished.accepted_count===2&&allPublished.recipient_count===2&&allPublished.provider_outcome==='provider_accepted',
  'Both original signer messages have distinct canonical accepted/provider/Rail records');
 check(first.fields.length===6&&new Set(first.fields.map(x=>x.kind)).size===5,'Actual native source has all five field types plus an optional field');
 const secondParty=all.source.signers[1],second={...first,signer_id:secondParty.id,
  fields:full.manifest.fields.filter(f=>f.signer_id===secondParty.id).map(({signer_id,...f})=>f)};
 refused(all,write(all,second,payload(second)));
 refused(all,write(all,first,null,{legacy:true}));
 const clone=x=>structuredClone(x),signatureId=first.fields.find(f=>f.kind==='signature').id,
  textId=first.fields.find(f=>f.kind==='text'&&f.required).id,initialsId=first.fields.find(f=>f.kind==='initials').id,
  checkboxId=first.fields.find(f=>f.kind==='checkbox').id,dateId=first.fields.find(f=>f.kind==='signed_date').id;
 const set=(id,value)=>({...input,values:input.values.map(x=>x.field_id===id?{...x,value}:x)});
 const invalid=[null,[],{...input,extra:true},{...input,preparation_id:randomUUID()},
  {...input,preparation_sha256:'0'.repeat(64)},{...input,values:[]},
  {...input,values:[...input.values,input.values[0]]},
  {...input,values:[...input.values,{field_id:randomUUID(),value:'foreign'}]},
  {...input,values:[...input.values,{field_id:second.fields[0].id,value:true}]},
  {...input,values:[...input.values,{field_id:dateId,value:'2026-01-01T00:00:00Z'}]},
  {...input,values:input.values.filter(x=>x.field_id!==checkboxId)},
  {...input,values:input.values.map((x,i)=>i?x:{...x,hidden:'unreviewed'})},
  set(signatureId,false),set(checkboxId,'false'),set(textId,'\u00a0\u2007\u202f\ufeff'),
  set(textId,'invalid\u0001control'),set(initialsId,'invalid\tinitials')];
 for(const candidate of invalid)refused(all,write(all,first,candidate));
 for(const role of ['anon','authenticated'])refused(all,write(all,first,input),'42501',role);
 const textIndex=input.values.findIndex(x=>x.field_id===textId);
 refused(all,write(all,first,input,{expression:`jsonb_set(${q(JSON.stringify(input))}::jsonb,'{values,${textIndex},value}',to_jsonb(repeat('x',524289)))`}));
 const firstReceipt=json(native(write(all,first,input)));
 check(firstReceipt.state==='recorded'&&!firstReceipt.replayed&&firstReceipt.outstanding_count===1&&firstReceipt.agreement_status==='partially_signed',
  'First ordered signer records partial progress with the other original signer still outstanding');
 const fieldEvent=json(`SELECT detail FROM paige_agreement_events WHERE signer_id='${first.signer_id}' AND event_type='field_values_recorded';`);
 const expected=await prepareAgreementFieldInput(full,{tenant_id:tenant,agreement_id:all.a.id,client_id:all.source.client_id,
  preparation_id:first.preparation_id,preparation_sha256:first.preparation_sha256,signer_id:first.signer_id,signed_at:fieldEvent.field_input.signed_at},input.values);
 assert.deepEqual(fieldEvent.field_input,JSON.parse(JSON.stringify(expected)));checks++;
 check(fieldEvent.field_input.values.find(f=>f.kind==='checkbox').value===false&&
  fieldEvent.field_input.values.find(f=>f.kind==='signed_date').value===fieldEvent.field_input.signed_at&&
  fieldEvent.field_input.values.length===5,'False checkbox is retained, native date is authoritative, and optional omitted text stays omitted');
 check(fieldEvent.consented_event_id===firstReceipt.consented_event_id&&fieldEvent.signed_event_id===firstReceipt.signed_event_id,
  'Exact field input refers to the original consent/signature pair');
 const beforeReplay=snapshot(all),again=json(native(write(all,first,clone(input))));
 check(again.replayed&&again.signed_event_id===firstReceipt.signed_event_id&&snapshot(all)===beforeReplay,'Exact prepared replay retains original act and audit identities');
 refused(all,write(all,first,set(checkboxId,true)));
 check(json(native(write(all,first,null,{legacy:true}))).signed_event_id===firstReceipt.signed_event_id&&snapshot(all)===beforeReplay,
  'Original13 replay can retrieve the recorded act without inventing new field answers');
 const next=readFields(all,1),nextReceipt=json(native(write(all,next,payload(next))));
 check(nextReceipt.outstanding_count===0&&nextReceipt.agreement_status!=='completed'&&
  sql(`SELECT sealed_storage_key IS NULL AND completed_at IS NULL FROM paige_agreements WHERE id='${all.a.id}';`)==='t',
  'Both original signatures do not fabricate a completed seal or payment/service fulfillment');
 check(sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${all.a.id}' AND event_type='field_values_recorded';`)==='2',
  'Each original signer has exactly one distinct retained assigned-field act');
 const simultaneous=await acceptedFixture();json(native(publish(simultaneous)));const current=readFields(simultaneous),proposed=payload(current),tag='e04_fields_'+randomUUID().replaceAll('-','');
 const holder=startSession(tag+'holder','BEGIN;SET LOCAL ROLE service_role;'+write(simultaneous,current,proposed)+'SELECT pg_sleep(1.5);COMMIT;');sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'holder')} AND wait_event='PgSleep');`);
 const duplicate=startSession(tag+'duplicate',native(write(simultaneous,current,proposed)));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(tag+'duplicate')} AND wait_event_type='Lock');`);waits++;
 const [left,right]=await Promise.all([holder,duplicate]),leftReceipt=JSON.parse(left),rightReceipt=JSON.parse(right);
 check(leftReceipt.signed_event_id===rightReceipt.signed_event_id&&leftReceipt.replayed!==rightReceipt.replayed&&
  sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${simultaneous.a.id}' AND event_type IN ('consented','signed','field_values_recorded');`)==='3',
  'Two genuine concurrent prepared acts retain one exact consent/signature/field transaction');
 const voided=await acceptedFixture();json(native(publish(voided)));const voidSource=readFields(voided),voidTag='e04_fields_void_'+randomUUID().replaceAll('-','');
 const voidHolder=startSession(voidTag+'holder','BEGIN;'+context+`SELECT void_agreement_signing('${tenant}','${voided.a.id}');SELECT pg_sleep(1.5);COMMIT;`);sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(voidTag+'holder')} AND wait_event='PgSleep');`);
 const voidReader=startSession(voidTag+'signer',native(`DO $proof$ BEGIN BEGIN ${write(voided,voidSource,payload(voidSource)).replace(/^SELECT\s+/,'PERFORM ')}
  RAISE EXCEPTION 'Expected post-wait revoked credential refusal';EXCEPTION WHEN SQLSTATE '42501' THEN NULL;END;END $proof$;SELECT 'refused';`));sessions++;
 await observe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=${q(voidTag+'signer')} AND wait_event_type='Lock');`);waits++;
 const [,voidResult]=await Promise.all([voidHolder,voidReader]);
 check(voidResult==='refused'&&sql(`SELECT count(*) FROM paige_agreement_events WHERE agreement_id='${voided.a.id}' AND event_type IN ('consented','signed','field_values_recorded');`)==='0',
  'Observed parent-lock wait rechecks the original void and cannot record a late signing act');
 console.log(JSON.stringify({checkpoint:'Original prepared-field signature transaction',checks,scope:'Synthetic native fixture only; full original regression and customer acceptance remain separate'}));
 return{checks,concurrentSessions:sessions,observedLockWaits:waits,scope:'Original native prepared field/signature transaction with synthetic provider input; not hosted recipient/provider/customer acceptance'};
}
