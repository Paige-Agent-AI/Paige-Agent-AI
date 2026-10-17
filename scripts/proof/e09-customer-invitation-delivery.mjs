// Existing isolated invitation runner extension. Provider effects are not exercised here.
import {randomUUID,createHash} from 'node:crypto';
export function invitationDeliveryProof({sql,check,assert,fs,path,root,ids,lit}){
 const file='supabase/migrations/20271108234000_e09_customer_invitation_delivery.sql';
 const migration=fs.readFileSync(path.join(root,file),'utf8'),contact=randomUUID(),operation=randomUUID(),digest='d'.repeat(64);
 sql(`DELETE FROM email_send_log;
  ALTER TABLE email_send_log ADD COLUMN idempotency_key text,ADD COLUMN sender_account text,ALTER COLUMN id SET DEFAULT gen_random_uuid(),
    ALTER COLUMN created_at SET DEFAULT now(),ALTER COLUMN template_name SET NOT NULL,
    ALTER COLUMN recipient_email SET NOT NULL,ALTER COLUMN status SET NOT NULL;
  ALTER TABLE email_send_log ADD CONSTRAINT delivery_fixture_status CHECK(status IN('pending','sent','failed','suppressed','bounced','complained','delivered','opened','clicked','dlq','dropped','delivery_delayed'));
  ALTER TABLE email_send_log ADD CONSTRAINT delivery_fixture_tenant FOREIGN KEY(tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
  CREATE UNIQUE INDEX delivery_fixture_provider_sent ON email_send_log(message_id) WHERE status='sent';
  ALTER ROLE service_role BYPASSRLS;
  INSERT INTO clients(id,tenant_id)VALUES('${contact}','${ids.ta}');
  INSERT INTO client_contact_methods(tenant_id,client_id,kind,value)VALUES('${ids.ta}','${contact}','email','delivery@tests.invalid');`);
 const api=(name,args,actor=ids.a,role='authenticated')=>{
  const raw=sql(`BEGIN;SELECT set_config('test.actor',${lit(actor)},true);SET LOCAL ROLE ${role};SELECT public.${name}(${args});COMMIT;`);
  return JSON.parse(raw.split(/\r?\n/).find(line=>line.startsWith('{')));
 };
 const p=api('prepare_client_portal_invitation',`'${ids.ta}','${contact}'`);
 const prepared=api('create_client_portal_invitation',`'${ids.ta}','${contact}','${p.proposal_hash}','${randomUUID()}'`),invite=prepared.invitation_id;
 sql(migration);
 const claim=(op=operation,hash=digest,actor=ids.a,tenant=ids.ta,invitation=invite,role='authenticated')=>api('claim_client_portal_invitation_delivery',`'${tenant}','${invitation}','${op}','${hash}'`,actor,role);
 const read=(op=operation,actor=ids.a,tenant=ids.ta,role='authenticated')=>api('read_client_portal_invitation_delivery',`'${tenant}','${op}'`,actor,role);
 const finish=(ticket,outcome='provider_accepted',message=randomUUID(),role='service_role',hash=digest)=>api('finalize_client_portal_invitation_delivery',`'${ids.ta}','${operation}','${ticket}','${hash}','${outcome}',${lit(message)}`,null,role);
 const snapshot=()=>sql('SELECT coalesce(jsonb_agg(to_jsonb(l)ORDER BY id),\'[]\'::jsonb)FROM email_send_log l');
 let first;
 check('Native delivery claims one canonical pending log row, not a provider acceptance',()=>{
  first=claim();assert.equal(first.disposition,'dispatch');assert.equal(first.outcome,'pending');assert.equal(first.provider_message_id,null);
  assert.equal(first.requested_by,ids.a);assert.match(first.claim_id,/^[0-9a-f-]{36}$/);assert(first.provider_key.length<256);
  assert.equal(sql(`SELECT count(*)FROM email_send_log WHERE metadata->>'operation_id'='${operation}'`),'1');
 });
 check('Current delivery readback has no raw token, payload, key or claim authority',()=>{
  const result=read();assert.equal(result.outcome,'pending');for(const key of ['claim_id','provider_key','payload_digest','token','join_url'])assert(!(key in result));
  assert(!JSON.stringify(result).includes('delivery@'));assert.equal(result.receipt_id,first.receipt_id);
 });
 check('Concurrent repeated dispatch is busy and does not grant another provider request',()=>{
  const before=snapshot(),again=claim();assert.equal(again.disposition,'busy');assert(!('provider_key'in again));assert.equal(snapshot(),before);
 });
 check('A new operation cannot bypass a pending invitation delivery',()=>{
  const before=snapshot();assert.throws(()=>claim(randomUUID()),/PREVIOUS_SEND_UNCONFIRMED/);assert.equal(snapshot(),before);
 });
 check('A reused operation cannot change its exact payload',()=>{
  const before=snapshot();assert.throws(()=>claim(operation,'c'.repeat(64)),/DELIVERY_CONFLICT/);assert.equal(snapshot(),before);
 });
 for(const [label,actor,tenant,role]of[['wrong owner',ids.b,ids.ta,'authenticated'],['wrong business',ids.a,ids.tb,'authenticated'],['no Auth',null,ids.ta,'authenticated'],['anonymous',ids.a,ids.ta,'anon'],['service API caller',ids.a,ids.ta,'service_role']])
 check('Delivery claim refuses '+label,()=>{const before=snapshot();assert.throws(()=>claim(operation,digest,actor,tenant,invite,role));assert.equal(snapshot(),before)});
 check('Ordinary owners cannot finalize a provider outcome',()=>{assert.throws(()=>finish(first.claim_id,'provider_accepted',randomUUID(),'authenticated'));assert.equal(read().outcome,'pending')});
 check('Transport uncertainty is durable unknown, not failed or sent',()=>{
  const result=finish(first.claim_id,'outcome_unknown',null);assert.equal(result.outcome,'outcome_unknown');assert.equal(read().outcome,'outcome_unknown');
  assert.equal(sql(`SELECT status||':'||(metadata->>'reason')FROM email_send_log WHERE id='${first.receipt_id}'`),'failed:transport');
 });
 let recovery;
 check('Recovery reuses the exact provider key and original record after the claim expires',()=>{
  recovery=claim();assert.equal(recovery.disposition,'reconcile');assert.equal(recovery.provider_key,first.provider_key);
  assert.equal(recovery.receipt_id,first.receipt_id);assert.notEqual(recovery.claim_id,first.claim_id);
 });
 check('A stale claim cannot overwrite the current recovery outcome',()=>{
  assert.throws(()=>finish(first.claim_id,'failed',null),/CLAIM_CHANGED/);assert.equal(read().outcome,'outcome_unknown');
 });
 let message;
 check('Verified provider acceptance settles the original row and survives reload without another dispatch',()=>{
  message=randomUUID();const accepted=finish(recovery.claim_id,'provider_accepted',message);assert.equal(accepted.outcome,'provider_accepted');
  const before=snapshot(),recorded=claim();assert.equal(recorded.disposition,'recorded');assert.equal(recorded.provider_message_id,message);assert(!('provider_key'in recorded));
  assert.equal(read().provider_message_id,message);assert.equal(snapshot(),before);
 });
 check('A late uncertainty does not downgrade a recorded acceptance',()=>{
  const before=snapshot();assert.equal(finish(recovery.claim_id,'outcome_unknown',null).outcome,'provider_accepted');assert.equal(snapshot(),before);
 });
 const next=randomUUID();let second;
 check('A deliberate fresh resend can claim a new operation after known acceptance',()=>{second=claim(next);assert.equal(second.disposition,'dispatch');assert.notEqual(second.provider_key,first.provider_key)});
 check('After the provider key window, an unknown request stays held and never invents a new key',()=>{
  sql(`UPDATE email_send_log SET metadata=metadata||jsonb_build_object('started_at',now()-interval '24 hours','claim_expires_at',now()-interval '1 minute','outcome','outcome_unknown')WHERE id='${second.receipt_id}'`);
  const before=snapshot(),held=claim(next);assert.equal(held.disposition,'held');assert(!('provider_key'in held));assert.equal(snapshot(),before);
  assert.throws(()=>claim(randomUUID()),/PREVIOUS_SEND_UNCONFIRMED/);
 });
 check('Existing service log grants cannot forge native delivery claims',()=>{
  sql('GRANT INSERT,SELECT,UPDATE ON email_send_log TO service_role');
  try{assert.throws(()=>sql(`BEGIN;SET LOCAL ROLE service_role;INSERT INTO email_send_log(id,tenant_id,template_name,recipient_email,status,idempotency_key)VALUES(gen_random_uuid(),'${ids.ta}','portal_invite','delivery@tests.invalid','pending','customer-portal-delivery/v1/forged');COMMIT;`),/NATIVE_DELIVERY_REQUIRED/);
   assert.throws(()=>sql(`BEGIN;SET LOCAL ROLE service_role;UPDATE email_send_log SET status='sent',message_id='forged'WHERE id='${first.receipt_id}';COMMIT;`),/NATIVE_DELIVERY_REQUIRED/);
   assert(sql("BEGIN;SET LOCAL ROLE service_role;INSERT INTO email_send_log(template_name,recipient_email,status)VALUES('legacy-template','legacy@tests.invalid','pending')RETURNING template_name;ROLLBACK;").includes('legacy-template'));
  }finally{sql('REVOKE ALL ON email_send_log FROM service_role')}
 });
 check('Private/native delivery ACLs remain explicit',()=>{
  for(const name of ['read_client_portal_invitation_delivery(uuid,uuid)','claim_client_portal_invitation_delivery(uuid,uuid,uuid,text)'])for(const role of ['anon','service_role'])assert.equal(sql(`SELECT has_function_privilege('${role}','${name}','EXECUTE')`),'f');
  for(const role of ['anon','authenticated'])assert.equal(sql(`SELECT has_function_privilege('${role}','finalize_client_portal_invitation_delivery(uuid,uuid,uuid,text,text,text)','EXECUTE')`),'f');
  for(const name of ['_client_portal_invitation_delivery_guard()','_client_portal_invitation_delivery_result(email_send_log,uuid)'])for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`SELECT has_function_privilege('${role}','${name}','EXECUTE')`),'f');
 });
 return {migration:file,migrationSHA256:createHash('sha256').update(migration).digest('hex'),provider:'NOT_CALLED',hostedQA:'UNVERIFIED'};
}
