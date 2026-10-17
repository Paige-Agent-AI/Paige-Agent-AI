// Extends the existing isolated native customer projection proof; no new QA runtime.
import {spawnSync} from 'node:child_process';
export function customerChatProof({sql,check,assert,fs,root,path,uid,other,tenant,foreign,contact}) {
 const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8').replaceAll('\r\n','\n');
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
  CREATE TABLE public.user_roles(user_id uuid,role text);
  CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role text,status text DEFAULT 'active');
  CREATE TABLE public.paige_coach_assignments(contact_id uuid,rep_user_id uuid,active boolean);
  ALTER TABLE public.clients ADD COLUMN lead_owner_user_id uuid,ADD COLUMN cs_primary_user_id uuid,ADD COLUMN assigned_coach_user_id uuid;
  CREATE TYPE public.task_status AS ENUM('pending');
  CREATE TABLE public.tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,title text,description text,due_date timestamptz,status task_status,metadata jsonb);
  CREATE TABLE public.client_notes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),contact_id uuid,author_user_id uuid,body text,tags text[]);
  CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
   SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role::text IN('admin','super_admin','sales_rep','cs_rep','finance')) $$;
  CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
   SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role='super_admin') $$;
  CREATE OR REPLACE FUNCTION public.agency_can_manage_child(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
  CREATE OR REPLACE FUNCTION public.is_tenant_owner(_user_id uuid,_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
   SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_user_id AND role='owner' AND status='active') $$;
  CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
   SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=auth.uid() AND status='active') $$;
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
 const legacySource=read('20260704224220_1238a682-6108-4fee-bca8-ba0f3e0e2b27.sql');
 const contactSource=read('20260721020716_move2_can_access_contact_tenant_scope.sql');
 const contactDefinition=contactSource.match(/CREATE OR REPLACE FUNCTION public\.can_access_contact\([\s\S]*?\$function\$;/)?.[0];
 assert(contactDefinition,'Actual canonical contact predicate must be present');sql(contactDefinition);
 for(const tool of ['paige_tool_create_task','paige_tool_add_client_note']){
  const statement=legacySource.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+tool+'\\([\\s\\S]*?END;\\$\\$;'))?.[0];
  assert(statement,'Actual incumbent writer must be present: '+tool);sql(statement);
 }
 sql(`REVOKE ALL ON FUNCTION public.paige_tool_create_task(uuid,uuid,text,text,timestamptz,text),public.paige_tool_add_client_note(uuid,uuid,text,text) FROM PUBLIC,anon;
  GRANT EXECUTE ON FUNCTION public.paige_tool_create_task(uuid,uuid,text,text,timestamptz,text),public.paige_tool_add_client_note(uuid,uuid,text,text) TO authenticated,service_role;`);
 const durableTable=read('20270417000000_paige_durable_work_envelope.sql').match(/create table public\.paige_durable_work \([\s\S]*?\n\);/i)?.[0];
 const durableDefinition=read('20270531600000_knowledge_durable_authority.sql').match(/create or replace function public\.create_paige_durable_work\([\s\S]*?\$\$;/i)?.[0];
 assert(durableTable&&durableDefinition,'Actual durable table and canonical creator must be present');
 sql(durableTable);sql(durableDefinition);
 sql(`REVOKE ALL ON FUNCTION public.create_paige_durable_work(uuid,uuid,uuid,uuid,text,text,jsonb,text,integer,integer) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.create_paige_durable_work(uuid,uuid,uuid,uuid,text,text,jsonb,text,integer,integer) TO service_role;`);
 const candidate=read('20271108201000_e09_customer_private_chat.sql');
 const scopeLease=candidate.match(/DO \$scope_lease\$[\s\S]*?\$scope_lease\$;/)?.[0];
 assert(scopeLease,'Protected source lease must be present');
 check('Migration refuses an unreviewed change to the canonical contact predicate',()=>{
  sql(contactDefinition.replace('  SELECT','  -- unreviewed source mutation\n  SELECT'));
  try {assert.throws(()=>sql(scopeLease),/canonical contact or staff writer source changed/);}
  finally {sql(contactDefinition);}
 });
 sql(candidate);
 const quote=x=>x===null?'NULL':"'"+String(x).replaceAll("'","''")+"'";
 const auth=(actor=uid,workspace=null)=>`SELECT set_config('test.actor',${quote(actor??'')},false);SELECT set_config('test.tenant',${quote(workspace??'')},false);SET ROLE authenticated;`;
 const as=(statement,actor=uid,workspace=null)=>sql(auth(actor,workspace)+statement+';RESET ROLE;').split('\n').at(-2)?.trim();
 const create=()=>as("SELECT paige_chat_thread_create(NULL,'customer','Private customer conversation','{}'::jsonb)");
 check('Legacy staff-focused thread and private customer thread can coexist',()=>{
  sql(`INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES('${tenant}','${uid}','owner')`);
  const legacy=as(`SELECT paige_chat_thread_create('${contact}','client','Staff-focused conversation','{}')`,uid,tenant);
  assert.match(legacy,/^[0-9a-f-]{36}$/);
  sql(`DELETE FROM public.tenant_members WHERE user_id='${uid}'`);
 });
 let thread;
 check('Customer without staff membership creates its native private thread',()=>{
  thread=create();assert.match(thread,/^[0-9a-f-]{36}$/);
  assert.equal(sql(`SELECT audience||':'||contact_id::text||':'||tenant_id::text FROM paige_chat_threads WHERE id='${thread}'`),
    'customer_private:'+contact+':'+tenant);
 });
 check('Returning customer resumes the same canonical thread',()=>assert.equal(create(),thread));
 check('A request cannot choose a different customer relationship',()=>assert.throws(()=>as(`SELECT paige_chat_thread_create('${contact}','customer','Forged','{}')`)));
 const legacySubject=sql(`SELECT id FROM public.clients WHERE linked_user_id='${other}' AND tenant_id='${foreign}'`);
 sql(`INSERT INTO public.user_roles VALUES('${uid}','sales_rep');
  INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES('${foreign}','${uid}','owner');`);
 const legacySnapshot=()=>sql('SELECT jsonb_build_object(\'tasks\',(SELECT count(*) FROM public.tasks),\'notes\',(SELECT count(*) FROM public.client_notes),\'audit\',(SELECT count(*) FROM public.paige_audit_log));');
 const beforeLegacy=legacySnapshot();
 check('Mixed-role fixture is native staff elsewhere and the customer in this relationship',()=>{
  assert.equal(sql(`SELECT public.is_staff('${uid}')`),'t');
  assert.equal(as('SELECT public.client_portal_relationship_id()',uid,foreign),contact);
 });
 check('Canonical contact reads preserve customer self-access without granting staff authority',()=>{
  assert.equal(as(`SELECT public.can_access_contact('${uid}','${contact}')`,uid,foreign),'t');
  assert.equal(sql(`SELECT public.can_access_contact('${uid}','${contact}',false)`),'f');
 });
 check('Internal contact narrowing grants no actor-selector RPC to browser or service callers',()=>{
  for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`SELECT has_function_privilege('${role}','public.can_access_contact(uuid,uuid,boolean)','EXECUTE')`),'f');
  assert.throws(()=>as(`SELECT public.can_access_contact('${uid}','${contact}',false)`,uid,foreign),/permission denied for function can_access_contact/);
 });
 check('Linked-customer read permission cannot create a staff workspace conversation',()=>assert.throws(
  ()=>as(`SELECT paige_chat_thread_create('${contact}','client','Must not borrow customer access','{}')`,uid,foreign),/workspace contact unavailable/));
 check('A contact argument cannot bypass the native platform-lens authority check',()=>assert.throws(
  ()=>as(`SELECT paige_chat_thread_create('${legacySubject}','platform','Must not borrow platform lens','{}')`,uid,foreign),/platform lens requires authorized self scope/));
 check('A declared workspace without native membership cannot authorize self Chat',()=>assert.throws(
  ()=>as("SELECT paige_chat_thread_create(NULL,'coach','Must not borrow workspace pointer','{}')",uid,tenant),/workspace membership unavailable/));
 for(const assigned of [false,true]){
  if(assigned)sql(`UPDATE public.clients SET cs_primary_user_id='${uid}' WHERE id='${contact}'`);
  for(const tool of ['paige_tool_create_task','paige_tool_add_client_note'])check(
   'Private audience cannot authorize incumbent '+tool+'; assigned staff='+assigned,()=>{
    const args=tool==='paige_tool_create_task'?`'${thread}','${contact}','PRIVATE_AUDIENCE_MUST_NOT_WRITE',NULL,NULL,NULL`
     :`'${thread}','${contact}','PRIVATE_AUDIENCE_MUST_NOT_WRITE',NULL`;
    assert.throws(()=>as(`SELECT public.${tool}(${args})`,uid,foreign),/thread not found/);
   });
 }
 check('Rejected private-context staff tools leave no business task, note or audit effect',()=>assert.equal(legacySnapshot(),beforeLegacy));
 sql(`UPDATE public.clients SET cs_primary_user_id=NULL WHERE id='${contact}'`);
 const durable=(threadId,workspace)=>`SELECT work_id FROM public.create_paige_durable_work('${workspace}','${uid}',gen_random_uuid(),'${threadId}',
  'document_generate','document_authoring',jsonb_build_object('tenant_id','${workspace}','actor_user_id','${uid}'),'test-native-scope',60,5)`;
 sql(`INSERT INTO public.tenant_members(tenant_id,user_id,role) VALUES('${tenant}','${uid}','owner')`);
 const durableBefore=sql('SELECT count(*) FROM public.paige_durable_work');
 check('Even current business members cannot use private Chat for canonical owner-work envelopes',()=>{
  assert.throws(()=>sql('SET ROLE service_role;'+durable(thread,tenant)+';RESET ROLE;'),/DURABLE_WORK_THREAD_FORBIDDEN/);
  assert.equal(sql('SELECT count(*) FROM public.paige_durable_work'),durableBefore);
 });
 sql(`DELETE FROM public.tenant_members WHERE user_id='${uid}' AND tenant_id='${tenant}'`);
 const selfThread=as("SELECT paige_chat_thread_create(NULL,'coach','Authorized own workspace','{}')",uid,foreign);
 check('Native workspace membership preserves self Chat and its personal task writer',()=>{
  assert.match(selfThread,/^[0-9a-f-]{36}$/);
  assert.equal(JSON.parse(as(`SELECT public.paige_tool_create_task('${selfThread}',NULL,'Authorized personal task',NULL,NULL,NULL)`,uid,foreign)).ok,true);
 });
 const staffThread=as(`SELECT paige_chat_thread_create('${legacySubject}','client','Authorized staff conversation','{}')`,uid,foreign);
 check('Canonical durable owner-work still accepts a native authorized workspace thread',()=>{
  assert.match(sql('SET ROLE service_role;'+durable(staffThread,foreign)+';RESET ROLE;'),/[0-9a-f-]{36}/);
  assert.equal(Number(sql('SELECT count(*) FROM public.paige_durable_work')),Number(durableBefore)+1);
 });
 for(const tool of ['paige_tool_create_task','paige_tool_add_client_note'])check('Authorized workspace preserves '+tool,()=>{
  const args=tool==='paige_tool_create_task'?`'${staffThread}','${legacySubject}','Authorized staff task',NULL,NULL,NULL`
   :`'${staffThread}','${legacySubject}','Authorized staff note',NULL`;
  assert.equal(JSON.parse(as(`SELECT public.${tool}(${args})`,uid,foreign)).ok,true);
 });
 sql(`DELETE FROM public.tenant_members WHERE user_id='${uid}';DELETE FROM public.user_roles WHERE user_id='${uid}'`);
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
 return {customerChatMigration:'20271108201000_e09_customer_private_chat.sql'};
}
