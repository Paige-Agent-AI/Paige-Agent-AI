// Extends the existing isolated native customer projection proof; no new QA runtime.
import {spawnSync} from 'node:child_process';
export function customerChatProof({sql,check,assert,fs,root,path,uid,other,tenant,foreign,contact}) {
 const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
 const emit=spawnSync(process.execPath,[path.join(root,'scripts/int336-database-check.mjs'),'--emit-fixture','--emit-baseline'],
   {encoding:'utf8',windowsHide:true,env:{...process.env,INT336_DATABASE_URL:'postgres://localhost/int336_test_e09_emit'}});
 assert.equal(emit.status,0,emit.stderr);
 let baseline=emit.stdout.slice(0,emit.stdout.indexOf('insert into paige_chat_threads(id,caller_user_id,tenant_id)values'));
 baseline=baseline.replace('create schema auth;','').replaceAll('create function auth.uid()','create or replace function auth.uid()')
   .replaceAll('create function public.current_user_tenant_id()','create or replace function public.current_user_tenant_id()')
   .replaceAll('create function public.is_platform_owner()','create or replace function public.is_platform_owner()');
 sql(baseline+' COMMIT;');
 sql(`ALTER TABLE paige_chat_threads ADD COLUMN contact_id uuid REFERENCES clients(id) ON DELETE SET NULL,ADD COLUMN lens text DEFAULT 'coach',
  ADD COLUMN title text,ADD COLUMN consent_snapshot jsonb,ADD COLUMN is_archived boolean DEFAULT false,
  ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN studio_session_id uuid;
  ALTER TABLE paige_chat_threads ALTER COLUMN id SET DEFAULT gen_random_uuid();
  CREATE UNIQUE INDEX idx_paige_chat_threads_single_active ON paige_chat_threads(caller_user_id,contact_id,lens)
    WHERE is_archived=false AND studio_session_id IS NULL;
  CREATE TABLE profiles(user_id uuid,active_tenant_id uuid);
  CREATE TABLE auth.users(id uuid PRIMARY KEY);
  INSERT INTO auth.users VALUES('${uid}'),('${other}');
  ALTER TABLE paige_chat_threads ADD CONSTRAINT paige_chat_threads_caller_user_id_fkey
    FOREIGN KEY(caller_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
  CREATE OR REPLACE FUNCTION public.is_tenant_admin(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
  ALTER TABLE paige_chat_threads ENABLE ROW LEVEL SECURITY;ALTER TABLE paige_chat_turns ENABLE ROW LEVEL SECURITY;
  GRANT USAGE ON SCHEMA auth TO anon,service_role;
  -- Supabase's native service_role bypasses RLS; the ordinary authenticated
  -- privacy/forgery assertions continue using the non-bypass caller role.
  ALTER ROLE service_role BYPASSRLS;
  GRANT SELECT,INSERT,UPDATE,DELETE ON paige_chat_threads,paige_chat_turns TO authenticated;
  GRANT ALL ON paige_chat_threads,paige_chat_turns TO service_role;
  CREATE POLICY threads_select_owner_or_admin ON paige_chat_threads FOR SELECT TO authenticated USING
    (public.is_platform_owner() OR (tenant_id=public.current_user_tenant_id() AND (caller_user_id=auth.uid() OR public.is_tenant_admin(tenant_id))));
  CREATE POLICY threads_tenant_isolation ON paige_chat_threads AS RESTRICTIVE FOR ALL TO authenticated
    USING(public.is_platform_owner() OR tenant_id=public.current_user_tenant_id())
    WITH CHECK(public.is_platform_owner() OR tenant_id=public.current_user_tenant_id());
  CREATE POLICY threads_update_self ON paige_chat_threads FOR UPDATE TO authenticated USING(caller_user_id=auth.uid()) WITH CHECK(caller_user_id=auth.uid());
  CREATE POLICY turns_select_via_thread ON paige_chat_turns FOR SELECT TO authenticated USING
    (EXISTS(SELECT 1 FROM paige_chat_threads t WHERE t.id=thread_id AND (public.is_platform_owner() OR
      (t.tenant_id=public.current_user_tenant_id() AND (t.caller_user_id=auth.uid() OR public.is_tenant_admin(t.tenant_id))))));`);
 for(const name of ['20270601000008_int346_server_issued_interactive_receipts.sql',
  '20270602000301_int346_conversational_admission.sql','20271108110000_int346_database_executor_isolation.sql'])
   sql(read(name));
 sql(read('20271108191000_e09_customer_private_chat.sql'));
 const quote=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
 const auth=(actor=uid,workspace=null)=>`SELECT set_config('test.actor',${quote(actor??'')},false);SELECT set_config('test.tenant',${quote(workspace??'')},false);SET ROLE authenticated;`;
 const as=(statement,actor=uid,workspace=null)=>sql(auth(actor,workspace)+statement+';RESET ROLE;').split('\n').at(-2)?.trim();
 const create=()=>as("SELECT paige_chat_thread_create(NULL,'customer','Private customer conversation','{}'::jsonb)");
 check('Legacy staff-focused thread and private customer thread can coexist',()=>{
  const legacy=as(`SELECT paige_chat_thread_create('${contact}','client','Staff-focused conversation','{}')`,uid,tenant);
  assert.match(legacy,/^[0-9a-f-]{36}$/);
 });
 let thread;
 check('Customer without staff membership creates its native private thread',()=>{
  thread=create();assert.match(thread,/^[0-9a-f-]{36}$/);
  assert.equal(sql(`SELECT audience||':'||contact_id::text||':'||tenant_id::text FROM paige_chat_threads WHERE id='${thread}'`),
    'customer_private:'+contact+':'+tenant);
 });
 check('Returning customer resumes the same canonical thread',()=>assert.equal(create(),thread));
 check('A request cannot choose a different customer relationship',()=>assert.throws(()=>as(`SELECT paige_chat_thread_create('${contact}','customer','Forged','{}')`)));
 const intent='e0941000-0000-4000-8000-000000000001';
 check('Existing v2 staged admission records exactly one issued user turn',()=>{
  assert(as(`SELECT paige_chat_interactive_begin_v2('${thread}','${intent}',NULL,'My private customer question',false,false,false)`).includes('accepted'));
  assert.equal(sql(`SELECT count(*) FROM paige_chat_turns WHERE thread_id='${thread}' AND interactive_intent_id='${intent}' AND interactive_actor_id='${uid}'`),'1');
 });
 check('A customer cannot forge a saved assistant reply or change private audience',()=>{
  assert.throws(()=>as(`SELECT paige_chat_turn_append('${thread}','assistant','Forged answer',NULL,NULL,NULL,NULL,NULL,NULL,NULL)`));
  assert.throws(()=>as(`UPDATE paige_chat_threads SET audience='workspace' WHERE id='${thread}'`));
  assert.throws(()=>as(`UPDATE paige_chat_threads SET contact_id=NULL WHERE id='${thread}'`));
 });
 check('Canonical service settlement and native publication complete the private turn',()=>{
  sql(`SET ROLE service_role;SELECT paige_chat_interactive_settle('${thread}','${uid}','${tenant}','${intent}',
    'A private customer answer',NULL,NULL,'{"interactive":{"request_intent_id":"e0941000-0000-4000-8000-000000000001"},"turn_state":{"v":1,"state":"FINAL"}}',NULL);RESET ROLE;`);
  assert.equal(as(`SELECT paige_chat_interactive_publication_context_v2('${thread}','${intent}')`),'t');
  assert.equal(as(`SELECT count(*) FROM paige_chat_turns WHERE thread_id='${thread}'`),'2');
 });
 check('Another customer and same-business staff cannot read the private history',()=>{
  assert.equal(as(`SELECT count(*) FROM paige_chat_threads WHERE id='${thread}'`,other,tenant),'0');
  assert.equal(as(`SELECT count(*) FROM paige_chat_turns WHERE thread_id='${thread}'`,other,tenant),'0');
  sql("CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql AS $$SELECT true$$;");
  try {
   assert.equal(as(`SELECT count(*) FROM paige_chat_threads WHERE id='${thread}'`,other,tenant),'0');
   assert.equal(as(`SELECT count(*) FROM paige_chat_turns WHERE thread_id='${thread}'`,other,tenant),'0');
  } finally {sql("CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;");}
 });
 check('Dual-role customer keeps customer history despite a staff workspace elsewhere',()=>{
  assert.equal(as(`SELECT paige_chat_customer_thread_authorized('${thread}')`,uid,foreign),'t');
  assert.equal(as(`SELECT count(*) FROM paige_chat_turns WHERE thread_id='${thread}'`,uid,foreign),'2');
 });
 check('Revocation hides retained history and prevents new admission/publication',()=>{
  sql(`UPDATE clients SET linked_user_id=NULL WHERE id='${contact}'`);
  try {
   assert.equal(as(`SELECT count(*) FROM paige_chat_turns WHERE thread_id='${thread}'`),'0');
   assert.equal(as(`SELECT paige_chat_interactive_publication_context_v2('${thread}','${intent}')`),'f');
   assert.throws(()=>as(`SELECT paige_chat_interactive_begin_v2('${thread}',gen_random_uuid(),NULL,'Revoked',false,false,false)`));
   assert.equal(sql(`SELECT count(*) FROM paige_chat_turns WHERE thread_id='${thread}'`),'2');
  } finally {sql(`UPDATE clients SET linked_user_id='${uid}' WHERE id='${contact}'`);}
 });
 check('Private-history ACL refuses anonymous and service-role customer authorization',()=>{
  assert.equal(sql("SELECT has_function_privilege('authenticated','paige_chat_customer_thread_authorized(uuid)','EXECUTE') AND NOT has_function_privilege('anon','paige_chat_customer_thread_authorized(uuid)','EXECUTE') AND NOT has_function_privilege('service_role','paige_chat_customer_thread_authorized(uuid)','EXECUTE')"),'t');
 });
 check('Expired history cannot be revived; a fresh conversation archives the expired native thread',()=>{
  sql(`UPDATE paige_chat_threads SET auto_delete_at=now()-interval '1 second' WHERE id='${thread}'`);
  assert.equal(as(`SELECT count(*) FROM paige_chat_turns WHERE thread_id='${thread}'`),'0');
  const next=create();assert.notEqual(next,thread);assert.match(next,/^[0-9a-f-]{36}$/);
  assert.equal(sql(`SELECT is_archived FROM paige_chat_threads WHERE id='${thread}'`),'t');
 });
 check('Canonical contact deletion detaches and archives private threads without exposing retained receipts',()=>{
  sql(`DELETE FROM clients WHERE id='${contact}'`);
  assert.equal(sql(`SELECT contact_id IS NULL AND is_archived FROM paige_chat_threads WHERE id='${thread}'`),'t');
  assert.equal(sql(`SELECT count(*) FROM paige_chat_turns WHERE thread_id='${thread}'`),'2');
  assert.equal(as(`SELECT count(*) FROM paige_chat_turns WHERE thread_id='${thread}'`),'0');
 });
 check('Canonical private cleanup permits Auth deletion while retaining the unlinked CRM contact',()=>{
  const otherThread=as("SELECT paige_chat_thread_create(NULL,'customer','Private second customer','{}')",other);
  assert.match(otherThread,/^[0-9a-f-]{36}$/);
  assert.throws(()=>sql(`DELETE FROM auth.users WHERE id='${other}'`));
  sql(`UPDATE clients SET linked_user_id=NULL WHERE linked_user_id='${other}';
    SET ROLE service_role;DELETE FROM paige_chat_threads WHERE caller_user_id='${other}' AND audience='customer_private';RESET ROLE;
    DELETE FROM auth.users WHERE id='${other}';`);
  assert.equal(sql(`SELECT count(*) FROM clients WHERE tenant_id='${foreign}'`),'1');
  assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id='${other}'`),'0');
 });
 return {customerChatMigration:'20271108191000_e09_customer_private_chat.sql'};
}
