// Existing isolated invitation runner extension. Provider effects are not exercised here.
import {randomUUID,createHash} from 'node:crypto';
export async function invitationDeliveryProof({sql,check,assert,fs,path,root,ids,lit,spawn,exe,port,transcript}){
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
 const finish=(ticket,outcome='provider_accepted',message=randomUUID(),role='service_role',hash=digest,op=operation)=>api('finalize_client_portal_invitation_delivery',`'${ids.ta}','${op}','${ticket}','${hash}','${outcome}',${lit(message)}`,null,role);
 const snapshot=()=>sql('SELECT coalesce(jsonb_agg(to_jsonb(l)ORDER BY id),\'[]\'::jsonb)FROM email_send_log l');
 let first,originalAttemptAt;
 check('Native delivery claims one canonical pending log row, not a provider acceptance',()=>{
  first=claim();assert.equal(first.disposition,'dispatch');assert.equal(first.outcome,'pending');assert.equal(first.provider_message_id,null);
  assert.equal(first.requested_by,ids.a);assert.match(first.claim_id,/^[0-9a-f-]{36}$/);assert(first.provider_key.length<256);
  assert.equal(sql(`SELECT count(*)FROM email_send_log WHERE metadata->>'operation_id'='${operation}'`),'1');
  sql(`UPDATE email_send_log SET created_at=now()-interval '1 hour' WHERE id='${first.receipt_id}';
   INSERT INTO email_send_log(tenant_id,template_name,recipient_email,status,message_id,metadata,created_at)
    SELECT tenant_id,template_name,recipient_email,'delivered','early-provider-observation',metadata-'claim_id'-'claim_expires_at',created_at+interval '1 second'
    FROM email_send_log WHERE id='${first.receipt_id}';`);
  originalAttemptAt=sql(`SELECT created_at::text FROM email_send_log WHERE id='${first.receipt_id}'`);
 });
 check('Current delivery readback has no raw token, payload, key or claim authority',()=>{
  const result=read();assert.equal(result.outcome,'pending');for(const key of ['claim_id','provider_key','payload_digest','token','join_url'])assert(!(key in result));
  assert(!JSON.stringify(result).includes('delivery@'));assert.equal(result.receipt_id,first.receipt_id);
 });
 check('Repeated dispatch during a live claim is busy and does not grant another provider request',()=>{
  const before=snapshot(),again=claim();assert.equal(again.disposition,'busy');assert(!('provider_key'in again));assert.equal(snapshot(),before);
 });
 check('A new operation cannot bypass a pending invitation delivery',()=>{
  const before=snapshot();assert.throws(()=>claim(randomUUID()),/PREVIOUS_SEND_UNCONFIRMED/);assert.equal(snapshot(),before);
 });
 check('A newly minted invitation for the same CRM customer cannot bypass the original unknown send',()=>{
  const freshTarget=api('prepare_client_portal_invitation',`'${ids.ta}','${contact}'`);
  const other=api('create_client_portal_invitation',`'${ids.ta}','${contact}','${freshTarget.proposal_hash}','${randomUUID()}'`);
  assert.notEqual(other.invitation_id,invite);const before=snapshot();
  assert.throws(()=>claim(randomUUID(),digest,ids.a,ids.ta,other.invitation_id),/PREVIOUS_SEND_UNCONFIRMED/);assert.equal(snapshot(),before);
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
 check('Finalization retains the original attempt timestamp and records its observation separately',()=>{
  assert(originalAttemptAt);assert.equal(sql(`SELECT metadata ? 'recorded_at' FROM email_send_log WHERE id='${first.receipt_id}'`),'t');
  assert.equal(sql(`SELECT created_at::text FROM email_send_log WHERE id='${first.receipt_id}'`),originalAttemptAt);
  assert.equal(sql(`SELECT (_client_portal_invitation_delivery_result(l,'${ids.a}')->>'observed_at')::timestamptz=(metadata->>'recorded_at')::timestamptz FROM email_send_log l WHERE id='${first.receipt_id}'`),'t');
 });
 let recovery;
 check('Recovery reuses the exact provider key and original record after the claim expires',()=>{
  recovery=claim();assert.equal(recovery.disposition,'reconcile');assert.equal(recovery.provider_key,first.provider_key);
  assert.equal(recovery.receipt_id,first.receipt_id);assert.notEqual(recovery.claim_id,first.claim_id);
 });
 check('A stale claim cannot overwrite the current recovery outcome',()=>{
  assert.throws(()=>finish(first.claim_id,'failed',null),/CLAIM_CHANGED/);assert.equal(read().outcome,'outcome_unknown');
 });
 check('A refusal during recovery preserves the original send uncertainty',()=>{
  assert.equal(finish(recovery.claim_id,'refused',null).outcome,'outcome_unknown');
  assert.throws(()=>claim(randomUUID()),/PREVIOUS_SEND_UNCONFIRMED/);
 });
 check('Another current authorized owner can recover without rewriting original attribution',()=>{
  sql(`INSERT INTO tenant_members(tenant_id,user_id,status,role,is_owner)VALUES('${ids.ta}','${ids.delegate}','active','admin',false)`);
  recovery=claim(operation,digest,ids.delegate);assert.equal(recovery.disposition,'reconcile');
  assert.equal(recovery.actor_id,ids.delegate);assert.equal(recovery.requested_by,ids.a);assert.equal(recovery.reconciled_by,ids.delegate);
  assert.equal(recovery.provider_key,first.provider_key);assert.equal(recovery.receipt_id,first.receipt_id);
 });
 check('A rejected recovery response also preserves uncertainty',()=>{
  assert.equal(finish(recovery.claim_id,'failed',null).outcome,'outcome_unknown');
  recovery=claim(operation,digest,ids.delegate);
 });
 let message;
 check('Repeated reconciliation preserves the original attempt time and webhook ordering',()=>{
  assert.equal(sql(`SELECT created_at::text FROM email_send_log WHERE id='${first.receipt_id}'`),originalAttemptAt);
  assert.equal(sql(`SELECT (metadata->>'recorded_at')::timestamptz >= created_at FROM email_send_log WHERE id='${first.receipt_id}'`),'t');
  assert.equal(sql(`SELECT created_at < (SELECT created_at FROM email_send_log WHERE status='delivered' AND message_id='early-provider-observation') FROM email_send_log WHERE id='${first.receipt_id}'`),'t');
 });
 check('Verified provider acceptance settles the original row and survives reload without another dispatch',()=>{
  message=randomUUID();const accepted=finish(recovery.claim_id,'provider_accepted',message);assert.equal(accepted.outcome,'provider_accepted');
  const before=snapshot(),recorded=claim();assert.equal(recorded.disposition,'recorded');assert.equal(recorded.provider_message_id,message);assert(!('provider_key'in recorded));
  assert.equal(read().provider_message_id,message);assert.equal(snapshot(),before);
 });
 check('A late uncertainty does not downgrade a recorded acceptance',()=>{
  const before=snapshot();assert.equal(finish(recovery.claim_id,'outcome_unknown',null).outcome,'provider_accepted');assert.equal(snapshot(),before);
 });
 for(const outcome of ['failed','refused'])check('A known first-dispatch '+outcome+' stays terminal and allows a deliberate new operation',()=>{
  const op=randomUUID(),fresh=claim(op);assert.equal(fresh.disposition,'dispatch');
  assert.equal(finish(fresh.claim_id,outcome,null,'service_role',digest,op).outcome,outcome);
  assert.equal(finish(fresh.claim_id,'outcome_unknown',null,'service_role',digest,op).outcome,outcome);
  assert.equal(claim(op).disposition,'recorded');assert.equal(read(op).outcome,outcome);
 });
 check('After claim, service can record the actual result while a revoked owner cannot read or send',()=>{
  const op=randomUUID(),fresh=claim(op);
  sql(`UPDATE tenant_members SET status='revoked'WHERE tenant_id='${ids.ta}' AND user_id='${ids.a}'`);
  try{assert.throws(()=>read(op));assert.throws(()=>claim(op));
   assert.equal(finish(fresh.claim_id,'provider_accepted',randomUUID(),'service_role',digest,op).outcome,'provider_accepted');
  }finally{sql(`UPDATE tenant_members SET status='active'WHERE tenant_id='${ids.ta}' AND user_id='${ids.a}'`)}
  assert.equal(read(op).outcome,'provider_accepted');
 });
 const concurrentOperation=randomUUID();let concurrent;
 const statement=`BEGIN;SELECT set_config('test.actor','${ids.a}',true);SET LOCAL ROLE authenticated;SELECT claim_client_portal_invitation_delivery('${ids.ta}','${invite}','${concurrentOperation}','${digest}');COMMIT;`;
 const query=()=>new Promise((resolve,reject)=>{
  const args=['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-A','-t','-v','ON_ERROR_STOP=1'];
  const child=spawn(exe('psql'),args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>{child.kill();reject(Error('Concurrent local delivery proof timed out'));},20000);
  child.stdout.on('data',v=>{stdout+=v});child.stderr.on('data',v=>{stderr+=v});child.on('error',e=>{clearTimeout(timer);reject(e)});
  child.on('close',exit=>{clearTimeout(timer);transcript.push({name:'psql-concurrent-invitation-delivery',args,exit,stdout,stderr});
   if(exit!==0)reject(Error(stderr));else resolve(JSON.parse(stdout.split(/\r?\n/).find(line=>line.startsWith('{'))));});child.stdin.end(statement);
 });
 concurrent=await Promise.all([query(),query()]);
 check('Two simultaneous native API calls grant exactly one provider attempt and one durable row',()=>{
  assert.deepEqual(concurrent.map(v=>v.disposition).sort(),['busy','dispatch']);
  assert.equal(concurrent[0].receipt_id,concurrent[1].receipt_id);
  assert.equal(sql(`SELECT count(*)FROM email_send_log WHERE metadata->>'operation_id'='${concurrentOperation}'`),'1');
 });
 finish(concurrent.find(v=>v.disposition==='dispatch').claim_id,'provider_accepted',randomUUID(),'service_role',digest,concurrentOperation);
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
