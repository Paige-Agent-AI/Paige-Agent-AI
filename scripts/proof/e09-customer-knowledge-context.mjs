// Extends existing native customer Chat/projection proof. No hosted identity/LLM.
// Context/admission/output integration is WIP; these first cases prove primitives.
import {createHash,randomUUID} from 'node:crypto';
export async function knowledgeContextProof({sql,check,assert,fs,root,path,uid,other,tenant,foreign,contact,otherContact,unsafe=false}){
 const read=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8').replaceAll('\r\n','\n');
 const owner='e091b000-0000-4000-8000-000000000001',doc='e094b000-0000-4000-8000-000000000001';
 const ownership=read('20260803190000_slice_a_multi_owner_is_owner.sql');
 const nativeOwner=read('20270521000000_operator_authority_in_company_workspaces.sql').match(/CREATE OR REPLACE FUNCTION public\.is_tenant_owner\([\s\S]*?\$function\$;/)?.[0];
 const nativeBrand=ownership.match(/CREATE OR REPLACE FUNCTION public\.can_manage_tenant_brand\([\s\S]*?\$function\$;/)?.[0];
 const nativeKnowledge=read('20270531600000_knowledge_durable_authority.sql').match(/CREATE OR REPLACE FUNCTION public\.knowledge_actor_authorized\([\s\S]*?\$\$;/)?.[0];
 const nativeLock=read('20270532000000_knowledge_extraction_work.sql').match(/CREATE OR REPLACE FUNCTION public\.lock_knowledge_extraction_authority\([\s\S]*?\$\$;/)?.[0];
 assert(nativeOwner&&nativeBrand&&nativeKnowledge&&nativeLock,'Actual current native helper definitions must exist');
 // The incumbent Chat proof intentionally exercises canonical account/contact
 // cleanup. New synthetic data reuses those exact native tables after that proof.
 const nativeSequence=read('20260711300000_paige_owner_chat_persistence.sql').match(/ALTER TABLE public\.paige_chat_turns ADD COLUMN IF NOT EXISTS seq bigserial;/)?.[0];
 assert(nativeSequence,'Actual canonical turn sequence definition must exist');
 sql(`${nativeSequence}
  ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz,ADD COLUMN banned_until timestamptz;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'$$;
  ALTER TABLE tenant_members ADD COLUMN is_owner boolean DEFAULT false;
  CREATE UNIQUE INDEX e09_context_profiles_user ON profiles(user_id);
  CREATE TABLE public.agency_team_members(agency_tenant_id uuid,user_id uuid,status text);
  CREATE FUNCTION public.is_company_workspace(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
  CREATE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
  CREATE FUNCTION public.is_platform_owner(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
  CREATE FUNCTION public.is_tenant_admin_as(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
  INSERT INTO auth.users(id) VALUES('${owner}'),('${other}') ON CONFLICT DO NOTHING;
  INSERT INTO profiles VALUES('${owner}','${tenant}'),('${uid}','${foreign}'),('${other}','${tenant}');
  INSERT INTO tenant_members(tenant_id,user_id,role,status,is_owner) VALUES('${tenant}','${owner}','owner','active',true);
  INSERT INTO clients(id,tenant_id,linked_user_id,first_name,last_name,status,onboarding_stage,source)
   VALUES('${contact}','${tenant}','${uid}','Test','Customer','active','completed','invitation');
  UPDATE clients SET linked_user_id='${other}',status='active',merged_into_contact_id=NULL WHERE id='${otherContact}';
  CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,action text,entity text,entity_id uuid,data jsonb,created_at timestamptz DEFAULT now());
  CREATE TABLE public.tenant_knowledge_docs(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),revision int DEFAULT 1,
   record_state text DEFAULT 'canonical',active_generation_id uuid,publication_manifest jsonb DEFAULT '{}',title text,content text);
  INSERT INTO tenant_knowledge_docs(id,tenant_id,title,content) VALUES('${doc}','${tenant}','Program guide','Approved customer program');
  -- Replace only the preceding proof's modeled stub. Native input parameter
  -- names differ; CREATE OR REPLACE cannot rename them. No hosted DDL.
  DROP FUNCTION public.is_tenant_owner(uuid,uuid);
  ${nativeOwner} ${nativeBrand} ${nativeKnowledge} ${nativeLock}
  REVOKE ALL ON FUNCTION public.lock_knowledge_extraction_authority(uuid,uuid) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.lock_knowledge_extraction_authority(uuid,uuid) TO service_role;
  REVOKE ALL ON FUNCTION public.knowledge_actor_authorized(uuid,uuid) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.knowledge_actor_authorized(uuid,uuid) TO service_role;
  REVOKE ALL ON tenant_knowledge_docs,audit_logs,profiles FROM PUBLIC,anon,authenticated,service_role;`);
 sql(read('20271108230000_e09_customer_knowledge_shares.sql'));
 const as=(query,actor=owner,role='authenticated')=>{
  const out=sql(`BEGIN; SELECT set_config('test.actor','${actor??''}',true);
   DO $claims$ BEGIN PERFORM set_config('request.jwt.claims',jsonb_build_object('sub','${actor??''}','role','${role}')::text,true); END $claims$;
   SET LOCAL ROLE ${role}; ${query}; COMMIT;`);
  const lines=out.split(/\r?\n/),row=lines.find(s=>s.startsWith('{'));
  return row?JSON.parse(row):(lines.find(s=>s==='t'||s==='f')??out);
 };
 const p=as(`SELECT prepare_client_portal_knowledge_share('${tenant}','${contact}','${doc}');`);
 const saved=as(`SELECT set_client_portal_knowledge_share('${tenant}','${contact}','${doc}',true,${p.expected_share_revision},'${p.proposal_hash}','${randomUUID()}');`);
 const fingerprint=sql(`SELECT source_fingerprint FROM tenant_knowledge_client_shares WHERE id='${saved.share_id}';`);
 const refs=[{share_id:saved.share_id,share_revision:1,source_fingerprint:fingerprint}];
 const snapshot={version:1,retrieval_refs:refs,source_refs:refs};
 const json=value=>`$json$${JSON.stringify(value)}$json$::jsonb`;
 const migration=read('20271108231000_e09_customer_knowledge_context.sql');
 check('Context support refuses a changed protected private helper owner before creating functions',()=>{
  sql('ALTER FUNCTION public._client_knowledge_share_current(public.tenant_knowledge_client_shares) OWNER TO authenticated;');
  try{assert.throws(()=>sql(migration),/source or permission changed/)}
  finally{sql('ALTER FUNCTION public._client_knowledge_share_current(public.tenant_knowledge_client_shares) OWNER TO postgres;')}
  assert.equal(sql("SELECT to_regprocedure('public._client_knowledge_refs_valid(jsonb)') IS NULL;"),'t');
 });
 const originalPublication=sql("SELECT pg_get_functiondef('public.paige_chat_interactive_publication_context_v2(uuid,uuid)'::regprocedure);");
 sql(migration);
 check('Protected begin and settle stay unchanged and only the customer publication branch extends',()=>{
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.paige_chat_interactive_begin_v2(uuid,uuid,uuid,text,boolean,boolean,boolean)'::regprocedure;"),'0120d7a89a86905d65eff99a0ebcc1bf');
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.paige_chat_interactive_settle(uuid,uuid,uuid,uuid,text,text[],text,jsonb,jsonb)'::regprocedure;"),'1f5deb1c10203c3ab210966385c3e437');
  const actual=sql("SELECT pg_get_functiondef('public.paige_chat_interactive_publication_context_v2(uuid,uuid)'::regprocedure);");
  assert.equal(actual.replace(' and public._client_knowledge_publication_current(p_thread,p_intent)',''),originalPublication);
 });
 if(unsafe){
  sql("CREATE OR REPLACE FUNCTION public._client_knowledge_refs_current(p_tenant uuid,p_contact uuid,p_refs jsonb) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT true$$;");
 }
 check('Closed source references and versioned snapshots accept actual canonical grant metadata',()=>{
  assert.equal(sql(`SELECT _client_knowledge_refs_valid(${json(refs)}) AND _client_knowledge_snapshot_valid(${json(snapshot)});`),'t');
 });
 for(const [label,value]of[
  ['null',null],['object',{}],['scalar',1],['scalar row',[1]],['missing fields',[{}]],['extra fields',[{...refs[0],actor_id:uid}]],
  ['duplicate',[refs[0],refs[0]]],['noncanonical ID',[{...refs[0],share_id:'NOT-AN-ID'}]],
  ['null revision',[{...refs[0],share_revision:null}]],['too many',Array.from({length:21},()=>refs[0])]])
  check('Native reference validation returns false for '+label,()=>assert.equal(sql(`SELECT _client_knowledge_refs_valid(${json(value)});`),'f'));
 for(const [label,value]of[['null',null],['scalar',1],['array',[]],['wrong version',{...snapshot,version:2}],['missing refs',{version:1}],
  ['extra field',{...snapshot,actor:uid}],['retrieval outside sources',{...snapshot,source_refs:[]}]])
  check('Native snapshot validation returns false for '+label,()=>assert.equal(sql(`SELECT _client_knowledge_snapshot_valid(${json(value)});`),'f'));
 check('Current reference validation uses the same canonical tenant/client/version predicate',()=>{
  assert.equal(sql(`SELECT _client_knowledge_refs_current('${tenant}','${contact}',${json(refs)});`),'t');
  assert.equal(sql(`SELECT _client_knowledge_refs_current('${foreign}','${contact}',${json(refs)});`),'f');
  assert.equal(sql(`SELECT _client_knowledge_refs_current('${tenant}','${otherContact}',${json(refs)});`),'f');
 });
 check('Publication locks preserve actual customer actor and current source authority',()=>{
  assert.equal(sql(`SELECT _client_knowledge_refs_lock('${uid}','${tenant}','${contact}',${json(refs)});`),'t');
  assert.equal(sql(`SELECT _client_knowledge_refs_lock('${other}','${tenant}','${contact}',${json(refs)});`),'f');
 });
 check('All source/snapshot/lock primitives are private to canonical native callers',()=>{
  for(const role of ['anon','authenticated','service_role'])assert.equal(sql(`SELECT bool_or(has_function_privilege('${role}',oid,'EXECUTE')) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('_client_knowledge_refs_valid','_client_knowledge_snapshot_valid','_client_knowledge_refs_current','_client_knowledge_refs_lock','_client_knowledge_terminal_guard','_client_knowledge_publication_current');`),'f');
 });
 const thread=as("SELECT jsonb_build_object('thread_id',paige_chat_thread_create(NULL,'customer','Customer context test','{}'));",uid).thread_id;
 const intent=randomUUID();
 const context=(actor=uid,role='authenticated')=>as(`SELECT client_portal_assistant_context('${thread}','${intent}');`,actor,role);
 const captured=context();
 check('Native assistant projection binds the actual customer/private thread and approved canonical content',()=>{
  assert.equal(captured.frame.actor_id,uid);assert.equal(captured.frame.profile.id,contact);assert.equal(captured.frame.profile.tenant_id,tenant);
  assert.equal(captured.thread_id,thread);assert.equal(captured.sources[0].document_id,doc);assert.equal(captured.sources[0].content,'Approved customer program');
  assert.deepEqual(captured.history,[]);assert.deepEqual(captured.snapshot.source_refs,refs);
 });
 check('Native assistant projection stays identical across a read without mutations',()=>assert.deepEqual(context(),captured));
 check('Wrong customer cannot read this private context even with another legitimate relationship',()=>assert.throws(()=>context(other)));
 for(const role of ['anon','service_role'])check(role+' cannot execute the customer assistant projection',()=>assert.throws(()=>context(uid,role)));
 const activeRollout=sql('SELECT active FROM paige_chat_interactive_rollout WHERE singleton;');
 as(`SELECT paige_chat_interactive_begin_v2('${thread}','${intent}',NULL,'Legacy accepted question',false,false,${activeRollout==='t'});`,uid);
 check('Recovering a legacy accepted intent never retroactively acquires Knowledge',()=>{
  const legacy=context();assert.deepEqual(legacy.sources,[]);assert.equal(legacy.snapshot,null);
 });
 if(activeRollout==='t')sql(`SET ROLE service_role; SELECT paige_chat_interactive_executor_v2('${thread}','${uid}','${tenant}','${intent}','acquire'); RESET ROLE;`);
 sql(`SET ROLE service_role; SELECT paige_chat_interactive_settle('${thread}','${uid}','${tenant}','${intent}',
  'UNATTESTED OLD ANSWER',NULL,NULL,'{"interactive":{"request_intent_id":"${intent}"},"turn_state":{"v":1,"state":"FINAL"}}',NULL); RESET ROLE;`);
 if(activeRollout==='t')sql(`SET ROLE service_role; SELECT paige_chat_interactive_executor_v2('${thread}','${uid}','${tenant}','${intent}','release'); RESET ROLE;`);
 const intent2=randomUUID(),contextFor=id=>as(`SELECT client_portal_assistant_context('${thread}','${id}');`,uid);
 const beforeBegin=contextFor(intent2);
 check('Unattested legacy assistant prose never becomes new model context',()=>{
  assert(!beforeBegin.history.some(x=>x.content==='UNATTESTED OLD ANSWER'));assert.equal(beforeBegin.history_limited,true);
 });
 const begin=(id,content='Customer program question')=>as(`SELECT client_portal_assistant_begin('${thread}','${id}',NULL,${json(content)}#>>'{}',false,false,${activeRollout==='t'});`,uid);
 check('Customer adapter atomically captures the actual native source snapshot in its issued user turn',()=>{
  assert.equal(begin(intent2).status,'accepted');
  const stored=JSON.parse(sql(`SELECT bundle_ref->'customer_knowledge' FROM paige_chat_turns WHERE thread_id='${thread}' AND interactive_intent_id='${intent2}' AND role='user';`));
  assert.deepEqual(stored,beforeBegin.snapshot);assert.deepEqual(contextFor(intent2),beforeBegin);
 });
 check('Customer duplicate admission cannot change or retrofit its captured source references',()=>{
  begin(intent2,'Changed browser prose');assert.deepEqual(contextFor(intent2),beforeBegin);
  as(`SELECT client_portal_assistant_begin('${thread}','${intent}',NULL,'Cannot retrofit',false,false,${activeRollout==='t'});`,uid);
  assert.deepEqual(context().sources,[]);
 });
 check('Wrong customer, anonymous and service callers cannot use the customer admission adapter',()=>{
  for(const [actor,role]of[[other,'authenticated'],[uid,'anon'],[uid,'service_role']])assert.throws(()=>as(`SELECT client_portal_assistant_begin('${thread}','${randomUUID()}',NULL,'No',false,false,${activeRollout==='t'});`,actor,role));
 });
 const bundle=(id,state='FINAL',sources=beforeBegin.snapshot)=>({interactive:{request_intent_id:id},turn_state:{v:1,state},...(sources?{customer_knowledge:sources}:{})});
 const service=query=>sql(`SET ROLE service_role; ${query}; RESET ROLE;`);
 const settle=(id,content,metadata)=>service(`SELECT paige_chat_interactive_settle('${thread}','${uid}','${tenant}','${id}',${json(content)}#>>'{}',NULL,NULL,${json(metadata)},NULL)`);
 const acquire=id=>{if(activeRollout==='t')service(`SELECT paige_chat_interactive_executor_v2('${thread}','${uid}','${tenant}','${id}','acquire')`)};
 const release=id=>{if(activeRollout==='t')service(`SELECT paige_chat_interactive_executor_v2('${thread}','${uid}','${tenant}','${id}','release')`)};
 acquire(intent2);
 check('Source-bearing settlement refuses forged metadata without inserting a terminal',()=>{
  assert.throws(()=>settle(intent2,'Forged',{...bundle(intent2),customer_knowledge:{version:1,retrieval_refs:[],source_refs:[]}}),/CUSTOMER_CONTEXT_BINDING_INVALID/);
  assert.equal(sql(`SELECT count(*) FROM paige_chat_turns WHERE interactive_intent_id='${intent2}' AND role='assistant';`),'0');
 });
 check('Canonical settlement accepts the exact captured snapshot and preserves exact replay',()=>{
  const result=settle(intent2,'Approved program answer',bundle(intent2));assert.equal(settle(intent2,'Approved program answer',bundle(intent2)),result);
  assert.throws(()=>settle(intent2,'Changed answer',bundle(intent2)),/interactive receipt conflict/);
 });
 release(intent2);
 check('Native publication accepts the current source-bearing canonical answer',()=>assert.equal(as(`SELECT paige_chat_interactive_publication_context_v2('${thread}','${intent2}');`,uid),'t'));
 check('Current terminal publication retires when the actual Auth customer is banned',()=>{
  sql(`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${uid}';`);
  try{assert.equal(as(`SELECT paige_chat_interactive_publication_context_v2('${thread}','${intent2}');`,uid),'f')}
  finally{sql(`UPDATE auth.users SET banned_until=NULL WHERE id='${uid}';`)}
 });
 check('The current terminal loses publication permission when its source changes after settlement',()=>{
  sql(`UPDATE tenant_knowledge_docs SET content='WITHDRAWN PROGRAM' WHERE id='${doc}';`);
  try{assert.equal(as(`SELECT paige_chat_interactive_publication_context_v2('${thread}','${intent2}');`,uid),'f')}
  finally{sql(`UPDATE tenant_knowledge_docs SET content='Approved customer program' WHERE id='${doc}';`)}
 });
 const intent3=randomUUID(),third=contextFor(intent3);begin(intent3);acquire(intent3);
 check('A returning context rehydrates only attested private history and current source references',()=>{
  assert(third.history.some(x=>x.content==='Approved program answer'));assert.deepEqual(third.snapshot.source_refs,refs);
 });
 const withdrawal=as(`SELECT prepare_client_portal_knowledge_share('${tenant}','${contact}','${doc}',false);`);
 as(`SELECT set_client_portal_knowledge_share('${tenant}','${contact}','${doc}',false,${withdrawal.expected_share_revision},'${withdrawal.proposal_hash}','${randomUUID()}');`);
 check('Withdrawn source denies accepted context and old publication',()=>{
  assert.throws(()=>contextFor(intent3),/CUSTOMER_(CONTEXT|KNOWLEDGE)_SOURCE_WITHDRAWN/);
  assert.equal(as(`SELECT paige_chat_interactive_publication_context_v2('${thread}','${intent2}');`,uid),'f');
 });
 check('Withdrawn source cannot insert a new source-bearing terminal',()=>{
  assert.throws(()=>sql(`BEGIN; SET LOCAL ROLE service_role;
   SELECT paige_chat_interactive_settle('${thread}','${uid}','${tenant}','${intent3}',
   'Must not publish',NULL,NULL,${json(bundle(intent3,'FINAL',third.snapshot))},NULL); ROLLBACK;`),/CUSTOMER_CONTEXT_SOURCE_WITHDRAWN/);
 });
 check('Empty WITHHELD cleanup remains settleable after source withdrawal without falsifying an answer',()=>{
  settle(intent3,'',bundle(intent3,'WITHHELD',null));release(intent3);
  assert.equal(as(`SELECT paige_chat_interactive_publication_context_v2('${thread}','${intent3}');`,uid),'t');
 });
 check('Withdrawn generated prose is excluded from future model history while private canonical UI history persists',()=>{
  const after=contextFor(randomUUID());assert.deepEqual(after.sources,[]);assert(!after.history.some(x=>x.content==='Approved program answer'));
  assert.equal(as(`SELECT jsonb_build_object('count',count(*)) FROM paige_chat_turns WHERE thread_id='${thread}' AND content='Approved program answer';`,uid).count,1);
 });
 const rolloutOriginal=sql('SELECT active FROM paige_chat_interactive_rollout WHERE singleton;');
 sql('UPDATE paige_chat_interactive_rollout SET active=true WHERE singleton;');
 try{
  const activeIntent=randomUUID();
  const activeSnapshot=contextFor(activeIntent).snapshot;
  check('Customer adapter preserves ACTIVE admission and cannot bypass the existing executor gate',()=>{
   assert.equal(as(`SELECT client_portal_assistant_begin('${thread}','${activeIntent}',NULL,'Active customer question',false,false,true);`,uid).status,'accepted');
   assert.throws(()=>settle(activeIntent,'Premature',bundle(activeIntent,'FINAL',activeSnapshot)),/interactive executor mismatch/);
   assert.equal(JSON.parse(service(`SELECT paige_chat_interactive_executor_v2('${thread}','${uid}','${tenant}','${activeIntent}','acquire')`).split(/\r?\n/).find(x=>x.startsWith('{'))).acquired,true);
   settle(activeIntent,'Current authorized answer',bundle(activeIntent,'FINAL',activeSnapshot));
   service(`SELECT paige_chat_interactive_executor_v2('${thread}','${uid}','${tenant}','${activeIntent}','release')`);
   assert.equal(as(`SELECT paige_chat_interactive_publication_context_v2('${thread}','${activeIntent}');`,uid),'t');
  });
  check('Customer adapter delegates Stop and refuses owner-style bound-answer resumption',()=>{
   assert.equal(as(`SELECT client_portal_assistant_begin('${thread}',NULL,'${activeIntent}','',false,true,true);`,uid).status,'stopped');
   assert.throws(()=>as(`SELECT client_portal_assistant_begin('${thread}','${randomUUID()}',NULL,'No',true,false,true);`,uid),/CUSTOMER_CONTEXT_RESUME_UNAVAILABLE/);
  });
 }finally{sql(`UPDATE paige_chat_interactive_rollout SET active=${rolloutOriginal==='t'} WHERE singleton;`)}
 return {knowledgeContextMigrationSHA256:createHash('sha256').update(migration).digest('hex'),knowledgeContextControl:unsafe?'CURRENT_REFERENCES_REMOVED':'NONE',knowledgeContextStage:'NATIVE_ADMISSION_PROJECTION_TERMINAL_PUBLICATION; actual handler integration unfinished',knowledgeContextProof:'isolated PostgreSQL; actual native definitions with modeled surrounding metadata/platform predicates; hosted acceptance NOT_RUN'};
}
