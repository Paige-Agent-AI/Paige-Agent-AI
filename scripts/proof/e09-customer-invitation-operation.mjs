// Extends the existing native invitation proof, using its actual owner predicates/producer.
import {randomUUID,createHash} from 'node:crypto';
export async function invitationOperationProof({sql,check,assert,fs,path,root,actual,ids,lit,spawn,exe,port,transcript}){
 const file='supabase/migrations/20271108233000_e09_customer_invitation_operation.sql';
 const migration=fs.readFileSync(path.join(root,file),'utf8');
 sql(`CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT 'authenticated'::text$$;
 CREATE TABLE clients(id uuid PRIMARY KEY,tenant_id uuid,updated_at timestamptz DEFAULT now(),status text DEFAULT 'active',
   merged_into_contact_id uuid,do_not_contact boolean DEFAULT false,linked_user_id uuid);
 CREATE TABLE client_contact_methods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,client_id uuid,
   kind text,value text,is_primary boolean DEFAULT true,updated_at timestamptz DEFAULT now());
 CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,action text NOT NULL,entity text NOT NULL,entity_id uuid,data jsonb);
 ALTER TABLE tenant_invite_tokens ALTER COLUMN id SET DEFAULT gen_random_uuid(),ALTER COLUMN created_at SET DEFAULT now(),
   ADD COLUMN default_role public.tenant_role DEFAULT 'member',ADD COLUMN created_by uuid,
   ADD COLUMN max_uses integer,ADD COLUMN uses integer DEFAULT 0;
 ALTER TABLE tenant_invite_tokens ADD CONSTRAINT operation_fixture_contact_fk FOREIGN KEY(contact_id) REFERENCES clients(id) ON DELETE SET NULL;
 REVOKE ALL ON clients,client_contact_methods,audit_logs FROM PUBLIC,anon,authenticated,service_role;`);
 sql(actual('is_tenant_owner(_user_id uuid','20270521000000_operator_authority_in_company_workspaces.sql'));
 sql(actual('create_tenant_invite_token(','20260824000000_enterprise_hybrid_consumer_invite.sql'));
 assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='create_tenant_invite_token(uuid,text,tenant_role,integer,integer,uuid,text)'::regprocedure"),'3a91af3aeb67fb8dbbf450eb3d612ade');
 const contact=randomUUID(),peer=randomUUID();
 sql(`INSERT INTO clients(id,tenant_id) VALUES('${contact}','${ids.ta}'),('${peer}','${ids.tb}');
 INSERT INTO client_contact_methods(tenant_id,client_id,kind,value) VALUES('${ids.ta}','${contact}','email',' Customer@tests.invalid '),('${ids.tb}','${peer}','email','other@tests.invalid');`);
 check('Invitation operation refuses a changed producer source lease before DDL',()=>{
  assert.throws(()=>sql(migration.replace('3a91af3aeb67fb8dbbf450eb3d612ade','0'.repeat(32))),/producer authority changed/);
  assert.equal(sql("SELECT to_regprocedure('prepare_client_portal_invitation(uuid,uuid)') IS NULL"),'t');
 });
 sql(migration);
 const invoke=(name,args,actor=ids.a,role='authenticated')=>{
  const raw=sql(`BEGIN;SELECT set_config('test.actor',${lit(actor)},true);SET LOCAL ROLE ${role};SELECT public.${name}(${args});COMMIT;`);
  return JSON.parse(raw.split(/\r?\n/).find(line=>line.startsWith('{')));
 };
 const prepare=(customer=contact,tenant=ids.ta,actor=ids.a,role='authenticated')=>invoke('prepare_client_portal_invitation',`'${tenant}','${customer}'`,actor,role);
 const create=(proposal,operation,actor=ids.a)=>invoke('create_client_portal_invitation',`'${proposal.tenant_id}','${proposal.contact_id}','${proposal.proposal_hash}','${operation}'`,actor);
 const read=(operation,tenant=ids.ta,actor=ids.a,role='authenticated')=>invoke('read_client_portal_invitation_operation',`'${tenant}','${operation}'`,actor,role);
 const snapshot=()=>sql("SELECT jsonb_build_object('invites',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id)FROM tenant_invite_tokens i),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id)FROM audit_logs a))");
 const proposal=prepare(),operation=randomUUID();let saved;
 check('Exact owner reviews a closed current recipient without creating an invitation',()=>{
  const before=snapshot();assert.deepEqual(Object.keys(proposal).sort(),['actor_id','tenant_id','contact_id','recipient','proposal_hash'].sort());
  assert.equal(proposal.recipient,'customer@tests.invalid');assert.match(proposal.proposal_hash,/^[0-9a-f]{64}$/);assert.deepEqual(prepare(),proposal);assert.equal(snapshot(),before);
 });
 check('One native operation reuses the actual producer and returns no token or fabricated send',()=>{
  saved=create(proposal,operation);assert.equal(saved.found,true);assert.equal(saved.state,'prepared');assert.equal(saved.replayed,false);
  assert.equal(saved.actor_id,ids.a);assert.equal(saved.contact_id,contact);assert(!JSON.stringify(saved).includes('token'));
  assert.equal(sql(`SELECT count(*)FROM tenant_invite_tokens WHERE portal_operation_id='${operation}'`),'1');
  assert.equal(sql(`SELECT kind||':'||default_role||':'||max_uses||':'||uses FROM tenant_invite_tokens WHERE id='${saved.invitation_id}'`),'consumer:member:1:0');
  assert.equal(sql(`SELECT count(*)FROM audit_logs WHERE id='${saved.receipt_id}' AND entity_id='${saved.invitation_id}' AND user_id='${ids.a}' AND data->>'operation_id'='${operation}'`),'1');
  assert(!sql(`SELECT data FROM audit_logs WHERE id='${saved.receipt_id}'`).includes('customer@'));
 });
 check('Lost-response replay returns the same token identity/receipt with no second mutation',()=>{
  const before=snapshot(),again=create(proposal,operation);assert.equal(again.replayed,true);assert.equal(again.invitation_id,saved.invitation_id);
  assert.equal(again.receipt_id,saved.receipt_id);assert.equal(snapshot(),before);assert.equal(read(operation).invitation_id,saved.invitation_id);
 });
 check('Operation collision with changed intent refuses without effects',()=>{
  const before=snapshot();assert.throws(()=>create({...proposal,proposal_hash:'0'.repeat(64)},operation),/OPERATION_CONFLICT/);assert.equal(snapshot(),before);
 });
 check('Changed saved recipient cannot redeem an earlier proposal',()=>{
  sql(`UPDATE client_contact_methods SET value='changed@tests.invalid' WHERE client_id='${contact}'`);
  const before=snapshot();assert.throws(()=>create(proposal,randomUUID()),/PROPOSAL_CHANGED/);assert.equal(snapshot(),before);
  sql(`UPDATE client_contact_methods SET value=' Customer@tests.invalid ' WHERE client_id='${contact}'`);
 });
 for(const [name,customer,tenant,actor,role]of[
  ['foreign customer',peer,ids.ta,ids.a,'authenticated'],['wrong business',contact,ids.tb,ids.a,'authenticated'],
  ['ordinary unprivileged actor',contact,ids.ta,ids.b,'authenticated'],['missing Auth',contact,ids.ta,null,'authenticated'],
  ['anonymous API caller',contact,ids.ta,ids.a,'anon'],['service API caller',contact,ids.ta,ids.a,'service_role']
 ])check('Native preparation refuses '+name,()=>{const before=snapshot();assert.throws(()=>prepare(customer,tenant,actor,role));assert.equal(snapshot(),before);});
 check('A second eligible enterprise business uses the same operation and native producer',()=>{
  sql(`UPDATE tenants SET account_type='enterprise' WHERE id='${ids.tb}'`);
  try{const p=prepare(peer,ids.tb,ids.b),op=randomUUID(),result=create(p,op,ids.b);assert.equal(result.state,'prepared');assert.equal(result.contact_id,peer);assert.equal(result.tenant_id,ids.tb);assert.equal(read(op,ids.tb,ids.b).receipt_id,result.receipt_id)}
  finally{sql(`UPDATE tenants SET account_type='standalone' WHERE id='${ids.tb}'`)}
 });
 check('Explicit NULL owner predicates cannot turn a missing authority result into a grant',()=>{
  const before=snapshot();assert.throws(()=>sql(`BEGIN;
   CREATE OR REPLACE FUNCTION public.is_platform_owner()RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT NULL::boolean$$;
   CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT NULL::boolean$$;
   CREATE OR REPLACE FUNCTION public.agency_can_manage_child(_child uuid,_actor uuid)RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT NULL::boolean$$;
   SELECT set_config('test.actor','${ids.a}',true);SET LOCAL ROLE authenticated;SELECT prepare_client_portal_invitation('${ids.ta}','${contact}');ROLLBACK;`),/NOT_AUTHORIZED/);assert.equal(snapshot(),before);
 });
 for(const [label,change,restore]of[
  ['do-not-contact',`do_not_contact=true`,`do_not_contact=false`],['unknown preference',`do_not_contact=NULL`,`do_not_contact=false`],
  ['archived customer',`status='archived'`,`status='active'`],['merged customer',`merged_into_contact_id='${peer}'`,`merged_into_contact_id=NULL`],
  ['already linked customer',`linked_user_id='${ids.b}'`,`linked_user_id=NULL`]
 ])check('Current target refuses '+label,()=>{sql(`UPDATE clients SET ${change} WHERE id='${contact}'`);try{assert.throws(()=>prepare(),/TARGET_CHANGED/)}finally{sql(`UPDATE clients SET ${restore} WHERE id='${contact}'`)}});
 check('Duplicate primary addresses refuse even if both spell the same email',()=>{
  sql(`INSERT INTO client_contact_methods(tenant_id,client_id,kind,value)VALUES('${ids.ta}','${contact}','email','customer@tests.invalid')`);
  try{assert.throws(()=>prepare(),/RECIPIENT_CHANGED/)}finally{sql(`DELETE FROM client_contact_methods WHERE client_id='${contact}' AND value='customer@tests.invalid'`)}
 });
 check('Missing and malformed primary address refuse',()=>{
  sql(`UPDATE client_contact_methods SET is_primary=false WHERE client_id='${contact}'`);try{assert.throws(()=>prepare(),/RECIPIENT_CHANGED/)}finally{sql(`UPDATE client_contact_methods SET is_primary=true,value='bad address' WHERE client_id='${contact}'`)}
  try{assert.throws(()=>prepare(),/RECIPIENT_CHANGED/)}finally{sql(`UPDATE client_contact_methods SET value=' Customer@tests.invalid ' WHERE client_id='${contact}'`)}
 });
 check('Audit failure rolls back the actual minted invitation and operation',()=>{
  sql("CREATE FUNCTION public.e09_proof_refuse_invite_audit()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic audit refused';END$$;CREATE TRIGGER refuse_invite_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.e09_proof_refuse_invite_audit();");
  try{const before=snapshot();assert.throws(()=>create(proposal,randomUUID()),/synthetic audit refused/);assert.equal(snapshot(),before)}finally{sql('DROP TRIGGER refuse_invite_audit ON audit_logs;DROP FUNCTION public.e09_proof_refuse_invite_audit()')}
 });
 for(const [label,change,restore]of[['accepted','uses=1,last_used_at=now()','uses=0,last_used_at=NULL'],['revoked','revoked_at=now()','revoked_at=NULL'],['expired',"expires_at=now()-interval '1 minute'","expires_at=now()+interval '1 day'"]])
 check('Replaying '+label+' recovers history without minting or authorizing a send',()=>{
  sql(`UPDATE tenant_invite_tokens SET ${change} WHERE id='${saved.invitation_id}'`);try{const before=snapshot();assert.equal(create(proposal,operation).state,label);assert.equal(snapshot(),before)}finally{sql(`UPDATE tenant_invite_tokens SET ${restore} WHERE id='${saved.invitation_id}'`)}
 });
 check('Current owner revocation prevents operation readback as well as creation',()=>{
  sql(`UPDATE tenant_members SET status='revoked' WHERE tenant_id='${ids.ta}' AND user_id='${ids.a}'`);
  try{assert.throws(()=>read(operation),/NOT_AUTHORIZED/);assert.throws(()=>create(proposal,operation),/NOT_AUTHORIZED/)}finally{sql(`UPDATE tenant_members SET status='active' WHERE tenant_id='${ids.ta}' AND user_id='${ids.a}'`)}
 });
 check('Operation lookup cannot cross actor/business; absence is only an inconclusive read',()=>{
  assert.throws(()=>read(operation,ids.tb,ids.a));const absent=read(randomUUID());assert.equal(absent.found,false);assert(!('state'in absent));
 });
 check('Readback verifies the original audit rather than trusting a dangling receipt pointer',()=>{
  const before=snapshot();assert.throws(()=>sql(`BEGIN;DELETE FROM audit_logs WHERE id='${saved.receipt_id}';SELECT set_config('test.actor','${ids.a}',true);SET LOCAL ROLE authenticated;SELECT read_client_portal_invitation_operation('${ids.ta}','${operation}');ROLLBACK;`),/RECEIPT_UNAVAILABLE/);assert.equal(snapshot(),before);
 });
 const concurrentOperation=randomUUID(),concurrentProposal=prepare();
 sql("CREATE FUNCTION public.e09_proof_pause_invite()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_sleep(0.15);RETURN NEW;END$$;CREATE TRIGGER e09_proof_pause_invite BEFORE INSERT ON tenant_invite_tokens FOR EACH ROW EXECUTE FUNCTION public.e09_proof_pause_invite();");
 let concurrent;
 try{
  const statement=`BEGIN;SELECT set_config('test.actor','${ids.a}',true);SET LOCAL ROLE authenticated;SELECT create_client_portal_invitation('${ids.ta}','${contact}','${concurrentProposal.proposal_hash}','${concurrentOperation}');COMMIT;`;
  const query=()=>new Promise((resolve,reject)=>{
   const args=['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-A','-t','-v','ON_ERROR_STOP=1'];
   const child=spawn(exe('psql'),args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
   const timer=setTimeout(()=>{child.kill();reject(Error('Concurrent local proof timed out'));},20000);
   child.stdout.on('data',v=>{stdout+=v});child.stderr.on('data',v=>{stderr+=v});child.on('error',error=>{clearTimeout(timer);reject(error)});
   child.on('close',exit=>{clearTimeout(timer);transcript.push({name:'psql-concurrent-invitation',args,exit,stdout,stderr});
    if(exit!==0)reject(Error(stderr));else resolve(JSON.parse(stdout.split(/\r?\n/).find(line=>line.startsWith('{'))));});child.stdin.end(statement);
  });
  concurrent=await Promise.all([query(),query()]);
 }finally{sql('DROP TRIGGER e09_proof_pause_invite ON tenant_invite_tokens;DROP FUNCTION public.e09_proof_pause_invite()')}
 check('Two concurrent actual API calls mint one invitation and return the same native receipt',()=>{
  assert.equal(concurrent[0].invitation_id,concurrent[1].invitation_id);assert.equal(concurrent[0].receipt_id,concurrent[1].receipt_id);
  assert.deepEqual(concurrent.map(row=>row.replayed).sort(),[false,true]);
  assert.equal(sql(`SELECT count(*)FROM tenant_invite_tokens WHERE portal_operation_id='${concurrentOperation}'`),'1');
 });
 check('Existing table access cannot forge or retarget a native operation binding',()=>{
  sql('GRANT UPDATE ON tenant_invite_tokens TO authenticated;CREATE POLICY operation_test_update ON tenant_invite_tokens FOR UPDATE TO authenticated USING(true) WITH CHECK(true);GRANT SELECT ON tenant_invite_tokens TO authenticated;CREATE POLICY operation_test_read ON tenant_invite_tokens FOR SELECT TO authenticated USING(true);');
  try{for(const assignment of [`portal_operation_id='${randomUUID()}'`,`portal_receipt_id='${randomUUID()}'`,`email='forged@tests.invalid'`,`contact_id='${peer}'`])assert.throws(()=>sql(`BEGIN;SET LOCAL ROLE authenticated;UPDATE tenant_invite_tokens SET ${assignment} WHERE id='${saved.invitation_id}';COMMIT;`),/NATIVE_BINDING_REQUIRED/)}
  finally{sql('DROP POLICY operation_test_update ON tenant_invite_tokens;DROP POLICY operation_test_read ON tenant_invite_tokens;REVOKE ALL ON tenant_invite_tokens FROM authenticated;')}
 });
 check('A retired CRM contact can follow existing SET NULL deletion without a new FK blocker',()=>{
  sql(`DELETE FROM clients WHERE id='${contact}'`);assert.equal(read(operation).state,'unavailable');assert.equal(sql(`SELECT count(*)FROM audit_logs WHERE id='${saved.receipt_id}'`),'1');
 });
 check('Public native APIs remain authenticated-only; private helpers grant no API execute',()=>{
  for(const name of ['prepare_client_portal_invitation(uuid,uuid)','read_client_portal_invitation_operation(uuid,uuid)','create_client_portal_invitation(uuid,uuid,text,uuid)'])for(const role of ['anon','service_role'])assert.equal(sql(`SELECT has_function_privilege('${role}','${name}','EXECUTE')`),'f');
  for(const name of ['_client_portal_invitation_owner(uuid)','_client_portal_invitation_target(uuid,uuid)','_client_portal_invitation_binding_guard()'])for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`SELECT has_function_privilege('${role}','${name}','EXECUTE')`),'f');
 });
 return {migration:file,migrationSHA256:createHash('sha256').update(migration).digest('hex'),authority:'actual consumer producer and native owner predicates; synthetic Auth/schema only',hostedQA:'UNVERIFIED',provider:'NOT_CALLED'};
}
