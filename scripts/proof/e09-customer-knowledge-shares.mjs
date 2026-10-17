// Extends the existing isolated PostgreSQL proof. No hosted identity or provider.
import {createHash,randomUUID} from 'node:crypto';
export async function knowledgeSharesProof({sql,check,assert,fs,root,path,uid,other,tenant,foreign,contact,otherContact,spawn,exe,port,transcripts,unsafe}){
 const owner='e091a000-0000-4000-8000-000000000001',admin='e091a000-0000-4000-8000-000000000002',
  foreignOwner='e091a000-0000-4000-8000-000000000003',member='e091a000-0000-4000-8000-000000000004';
 const doc='e094a000-0000-4000-8000-000000000001',foreignDoc='e094a000-0000-4000-8000-000000000002',
  secondDoc='e094a000-0000-4000-8000-000000000003';
 const peer='e091a000-0000-4000-8000-000000000006',peerContact='e093a000-0000-4000-8000-000000000003',peerDoc='e094a000-0000-4000-8000-000000000004';
 const clientScopeControl=unsafe&&process.env.E09_KNOWLEDGE_CONTROL==='client_scope';
 const authorityLockControl=unsafe&&process.env.E09_KNOWLEDGE_CONTROL==='authority_lock';
 const source=name=>fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8');
 const actorSource=source('20270531600000_knowledge_durable_authority.sql').match(/CREATE OR REPLACE FUNCTION public\.knowledge_actor_authorized\([\s\S]*?\$\$;/)?.[0];
 const contactSource=source('20271108201000_e09_customer_private_chat.sql').match(/CREATE OR REPLACE FUNCTION public\.can_access_contact\(_user_id uuid, _contact_id uuid, _allow_linked_customer boolean\)[\s\S]*?\$function\$;/)?.[0];
 const lockSource=source('20270532000000_knowledge_extraction_work.sql').match(/CREATE OR REPLACE FUNCTION public\.lock_knowledge_extraction_authority\([\s\S]*?\$\$;/)?.[0];
 assert(actorSource&&contactSource&&lockSource,'Use the current native Knowledge/contact permission and lock bodies');
 sql(`CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
  CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
  CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,action text,entity text,entity_id uuid,data jsonb,created_at timestamptz DEFAULT now());
  CREATE TABLE public.tenant_knowledge_docs(id uuid PRIMARY KEY,tenant_id uuid REFERENCES tenants(id),revision int DEFAULT 1,
    record_state text DEFAULT 'canonical',active_generation_id uuid,publication_manifest jsonb DEFAULT '{}',title text,content text,
    source_url text,metadata jsonb,pending_review jsonb,extraction_input text,created_by uuid);
  ALTER TABLE clients ADD COLUMN lead_owner_user_id uuid,ADD COLUMN cs_primary_user_id uuid,ADD COLUMN assigned_coach_user_id uuid;
  CREATE TABLE public.paige_coach_assignments(contact_id uuid,active boolean,rep_user_id uuid);
  CREATE TABLE public.user_roles(user_id uuid,role text);
  CREATE TABLE public.agency_team_members(agency_tenant_id uuid,user_id uuid,status text);
  CREATE FUNCTION public.is_super_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
  CREATE FUNCTION public.agency_can_manage_child(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
  CREATE FUNCTION public.is_platform_owner(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
  CREATE FUNCTION public.is_tenant_admin_as(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
  INSERT INTO auth.users(id) VALUES('${uid}'),('${other}'),('${owner}'),('${admin}'),('${foreignOwner}'),('${member}');
  INSERT INTO auth.users(id) VALUES('${peer}');
  INSERT INTO profiles VALUES('${uid}','${foreign}'),('${other}','${tenant}'),('${owner}','${tenant}'),('${admin}','${tenant}'),('${foreignOwner}','${foreign}'),('${member}','${tenant}');
  INSERT INTO profiles VALUES('${peer}','${foreign}');
  INSERT INTO clients(id,tenant_id,linked_user_id,first_name,last_name,status,source)
   VALUES('${peerContact}','${tenant}','${peer}','Peer','Customer','active','invitation');
  INSERT INTO tenant_knowledge_docs(id,tenant_id,title,content,source_url,metadata,pending_review,extraction_input,created_by) VALUES
   ('${doc}','${tenant}','Program guide','Approved customer program','https://internal.example.test/private','{"private":"SECRET METADATA"}','{"draft":"UNAPPROVED DRAFT"}','PRIVATE EXTRACTION','${owner}'),
   ('${foreignDoc}','${foreign}','Foreign program','FOREIGN SECRET',NULL,NULL,NULL,NULL,'${foreignOwner}'),
   ('${secondDoc}','${tenant}','Second guide','Approved next steps',NULL,NULL,NULL,NULL,'${owner}');
  INSERT INTO tenant_knowledge_docs(id,tenant_id,title,content,created_by)
   VALUES('${peerDoc}','${tenant}','Peer program','ANOTHER CUSTOMER PROGRAM','${owner}');
  ${actorSource} ${contactSource} ${lockSource}
  REVOKE ALL ON FUNCTION public.lock_knowledge_extraction_authority(uuid,uuid) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.lock_knowledge_extraction_authority(uuid,uuid) TO service_role;
  REVOKE ALL ON FUNCTION public.knowledge_actor_authorized(uuid,uuid) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.knowledge_actor_authorized(uuid,uuid) TO service_role;
  REVOKE ALL ON FUNCTION public.can_access_contact(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
  REVOKE ALL ON tenant_knowledge_docs,audit_logs,profiles FROM PUBLIC,anon,authenticated,service_role;`);
 const migration=source('20271108230000_e09_customer_knowledge_shares.sql');
 const as=(query,actor=owner,role='authenticated')=>{
  const out=sql(`BEGIN; SELECT set_config('test.actor','${actor??''}',true); SET LOCAL ROLE ${role}; ${query}; COMMIT;`);
  const row=out.split('\n').find(x=>x.startsWith('{')||x.startsWith('['));return row?JSON.parse(row):out;
 };
 const json=value=>`$json$${JSON.stringify(value)}$json$::jsonb`;
 const prepare=(actor=owner,business=tenant,client=contact,document=doc,available=true)=>as(`SELECT prepare_client_portal_knowledge_share('${business}','${client}','${document}',${available})`,actor);
 const save=(p,actor=owner,operation=randomUUID())=>as(`SELECT set_client_portal_knowledge_share('${p.tenant_id}','${p.contact_id}','${p.document_id}',${p.available},${p.expected_share_revision},'${p.proposal_hash}','${operation}')`,actor);
 const context=(actor=uid,business=tenant,refs=null,limit=5,offset=0,include=true,role='authenticated')=>as(`SELECT client_portal_knowledge_context('${business}',${refs===null?'NULL':json(refs)},${limit},${offset},${include})`,actor,role);
 const list=(actor=owner,business=tenant,client=contact)=>as(`SELECT list_client_portal_knowledge_shares('${business}','${client}')`,actor);
 const snapshot=()=>sql("SELECT jsonb_build_object('shares',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM tenant_knowledge_client_shares s),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_logs a));");
 check('Native source lease matches the observed current Knowledge and relationship authority',()=>{
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.knowledge_actor_authorized(uuid,uuid)'::regprocedure;"),'a05876e786e8a6e7e3e15783cde684aa');
  assert.equal(sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_relationship_id(uuid)'::regprocedure;"),'f79189022b4dc36760b618a086a80e28');
 });
 check('Changed native authority source lease refuses before creating any sharing table',()=>{
  assert.throws(()=>sql(migration.replace('a05876e786e8a6e7e3e15783cde684aa','0'.repeat(32))),/authority source changed/);
  assert.equal(sql("SELECT to_regclass('public.tenant_knowledge_client_shares') IS NULL;"),'t');
 });
 check('Changed protected contact helper ownership refuses before creating any sharing table',()=>{
  sql('ALTER FUNCTION public.can_access_contact(uuid,uuid,boolean) OWNER TO authenticated;');
  try{assert.throws(()=>sql(migration),/authority source changed/)}finally{sql('ALTER FUNCTION public.can_access_contact(uuid,uuid,boolean) OWNER TO postgres;')}
  assert.equal(sql("SELECT to_regclass('public.tenant_knowledge_client_shares') IS NULL;"),'t');
 });
 check('Changed protected Knowledge security mode refuses before creating any sharing table',()=>{
  sql('ALTER FUNCTION public.knowledge_actor_authorized(uuid,uuid) SECURITY INVOKER;');
  try{assert.throws(()=>sql(migration),/authority source changed/)}finally{sql('ALTER FUNCTION public.knowledge_actor_authorized(uuid,uuid) SECURITY DEFINER;')}
  assert.equal(sql("SELECT to_regclass('public.tenant_knowledge_client_shares') IS NULL;"),'t');
 });
 sql(migration);
 check('RPC-only metadata deny policy stays restrictive if a later policy is added',()=>
  assert.equal(sql("SELECT NOT polpermissive FROM pg_policy WHERE polrelid='public.tenant_knowledge_client_shares'::regclass AND polname='customer_knowledge_shares_no_direct_access';"),'t'));
 if(authorityLockControl){
  const current=sql("SELECT pg_get_functiondef('public.set_client_portal_knowledge_share(uuid,uuid,uuid,boolean,integer,text,uuid)'::regprocedure);");
  const region=/IF NOT public\.lock_knowledge_extraction_authority\(auth\.uid\(\),p_tenant_id\) THEN[\s\S]*?(?=SELECT \* INTO c FROM public\.clients)/;
  assert(region.test(current),'Actual authority lock region must exist');
  sql(current.replace(region,"PERFORM 1 FROM public.profiles WHERE user_id=auth.uid() AND active_tenant_id=p_tenant_id FOR SHARE; IF NOT FOUND OR NOT public._client_knowledge_owner_authorized(p_tenant_id,p_contact_id) THEN RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501'; END IF; "));
 }else if(clientScopeControl){
  const current=sql("SELECT pg_get_functiondef('public.client_portal_knowledge_context(uuid,jsonb,integer,integer,boolean)'::regprocedure);");
  const guard='s.tenant_id=business AND s.contact_id=customer';assert.equal(current.split(guard).length-1,2,'Both native reader client predicates must exist');
  sql(current.replaceAll(guard,'s.tenant_id=business'));
 }else if(unsafe)sql('CREATE OR REPLACE FUNCTION public._client_knowledge_share_current(s public.tenant_knowledge_client_shares) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=\'\' AS $$SELECT true$$;');
 check('Internal canonical Knowledge remains unavailable before an explicit share',()=>assert.deepEqual(context().sources,[]));
 check('Prepare binds actual owner, client, source and expected grant revision without writing',()=>{
  const before=snapshot(),p=prepare();assert.equal(p.contact_id,contact);assert.equal(p.document_id,doc);assert.equal(p.expected_share_revision,0);assert.equal(p.preview,'Approved customer program');assert.match(p.proposal_hash,/^[a-f0-9]{64}$/);assert.equal(snapshot(),before);
 });
 for(const [label,actor,business,client,document]of[
  ['Customer',uid,tenant,contact,doc],['Ordinary staff',member,tenant,contact,doc],['Foreign owner',foreignOwner,tenant,contact,doc],
  ['Foreign recipient',owner,tenant,otherContact,doc],['Foreign source',owner,tenant,contact,foreignDoc]])
  check(label+' cannot prepare a Knowledge publication',()=>assert.throws(()=>prepare(actor,business,client,document)));
 const proposed=prepare(),operation=randomUUID();let saved;
 check('Owner publication and native audit receipt are one persistent operation',()=>{
  saved=save(proposed,owner,operation);assert.equal(saved.currently_available,true);assert.equal(saved.changed,true);assert.equal(saved.current_revision,1);assert.equal(saved.receipt_id,operation);
  assert.equal(sql(`SELECT user_id::text||'|'||action||'|'||entity_id FROM audit_logs WHERE id='${operation}';`),`${owner}|share_customer_knowledge|${saved.share_id}`);
 });
 const refs=()=>context().sources.map(s=>({share_id:s.share_id,share_revision:s.share_revision,source_fingerprint:s.source_fingerprint}));
 const firstRefs=refs();
 check('Customer context comes from its own native relationship, never its staff workspace pointer',()=>{
  const c=context();assert.equal(c.actor_id,uid);assert.equal(c.contact_id,contact);assert.equal(c.tenant_id,tenant);assert.equal(c.sources.length,1);assert.equal(c.sources[0].content,'Approved customer program');
 });
 check('Returned Knowledge projection contains only the explicit closed fields',()=>{
  const s=context().sources[0];assert.deepEqual(Object.keys(s).sort(),['share_id','share_revision','document_id','document_revision','generation_id','source_fingerprint','title','content','content_truncated'].sort());
  const text=JSON.stringify(s);for(const secret of ['SECRET','UNAPPROVED','EXTRACTION','source_url','metadata','created_by'])assert(!text.includes(secret));
 });
 check('Exact replay returns the saved receipt without writing or increasing revision',()=>{const before=snapshot();const r=save(proposed,owner,operation);assert.equal(r.replayed,true);assert.equal(r.changed,false);assert.equal(r.current_revision,1);assert.equal(snapshot(),before)});
 check('Generic audit metadata cannot forge the revision returned by native replay',()=>{
  sql(`UPDATE audit_logs SET data=jsonb_set(data,'{share_revision}','99'::jsonb) WHERE id='${operation}';`);
  try{const r=save(proposed,owner,operation);assert.equal(r.original_revision,1);assert.equal(r.current_revision,1)}
  finally{sql(`UPDATE audit_logs SET data=jsonb_set(data,'{share_revision}','1'::jsonb) WHERE id='${operation}';`)}
 });
 check('The same proposal is bound to the preparing actor',()=>assert.throws(()=>save(proposed,admin)));
 check('A stale share revision cannot be replayed under a new operation',()=>{const before=snapshot();assert.throws(()=>save(proposed));assert.equal(snapshot(),before)});
 check('Owner readback reports the same native share and receipt',()=>{const l=list();assert.equal(l.shares.length,1);assert.equal(l.shares[0].receipt_id,operation);assert.equal(l.shares[0].currently_available,true);assert(!JSON.stringify(l).includes('Approved customer program'))});
 check('An administrator uses the same native owner/configuration/CRM predicates',()=>assert.equal(save(prepare(admin,tenant,contact,secondDoc),admin).currently_available,true));
 const peerShare=save(prepare(owner,tenant,peerContact,peerDoc));
 const peerRefs=[{share_id:peerShare.share_id,share_revision:peerShare.current_revision,source_fingerprint:sql(`SELECT source_fingerprint FROM tenant_knowledge_client_shares WHERE id='${peerShare.share_id}';`)}];
 check('Another customer in the same business receives only its own authorized program',()=>assert.deepEqual(context(peer).sources.map(s=>s.document_id),[peerDoc]));
 check('Same-business membership cannot list or name another customer grant',()=>{
  assert(!context().sources.some(s=>s.document_id===peerDoc));assert.throws(()=>context(uid,tenant,peerRefs));
 });
 check('A customer cannot read staff sharing administration',()=>assert.throws(()=>list(uid)));
 for(const [label,actor,business]of[['Wrong client',other,tenant],['Wrong business',uid,foreign],['Unlinked actor',member,tenant],['Missing actor',null,tenant]])
  check(label+' cannot obtain Knowledge context',()=>assert.throws(()=>context(actor,business)));
 for(const role of ['anon','service_role'])check(role+' cannot execute a customer reader or impersonate a customer',()=>assert.throws(()=>context(uid,tenant,null,5,0,true,role)));
 check('Exact authorized source references validate without expanding authority',()=>assert.equal(context(uid,tenant,firstRefs).sources[0].share_id,saved.share_id));
 check('Authorized UUID case aliases resolve the same exact canonical source',()=>assert.equal(context(uid,tenant,[{...firstRefs[0],share_id:firstRefs[0].share_id.toUpperCase()}]).sources[0].share_id,saved.share_id));
 check('Duplicate UUID case aliases cannot masquerade as distinct source references',()=>assert.throws(()=>context(uid,tenant,[firstRefs[0],{...firstRefs[0],share_id:firstRefs[0].share_id.toUpperCase()}])));
 check('An empty exact reference set does not acquire newly shared content',()=>assert.deepEqual(context(uid,tenant,[]).sources,[]));
 for(const [label,ref]of[['Foreign share',{...firstRefs[0],share_id:randomUUID()}],['Wrong share revision',{...firstRefs[0],share_revision:50}],['Wrong fingerprint',{...firstRefs[0],source_fingerprint:'0'.repeat(64)}]])
  check(label+' is refused instead of silently dropping or widening references',()=>assert.throws(()=>context(uid,tenant,[ref])));
 for(const [label,value]of[['Extra ref property',[{...firstRefs[0],tenant_id:foreign}]],['Duplicate source',[firstRefs[0],firstRefs[0]]],['Malformed refs',{}],['Null ref property',[{...firstRefs[0],share_revision:null}]]])
  check(label+' is refused',()=>assert.throws(()=>context(uid,tenant,value)));
 check('Pagination remains scoped and metadata-only reads omit body text',()=>{
  const first=context(uid,tenant,null,1,0,false),next=context(uid,tenant,null,1,first.next_offset,false);assert.equal(first.sources.length,1);assert.equal(next.sources.length,1);assert.notEqual(first.sources[0].share_id,next.sources[0].share_id);assert.equal(first.sources[0].content,null);
 });
 for(const [label,patch]of[['Changed revision','revision=revision+1'],['Changed content',"content='Unreviewed content'"],['Changed title',"title='Unreviewed title'"],['Changed generation',`active_generation_id='${randomUUID()}'`],['Changed manifest',"publication_manifest='{\"changed\":true}'"],['Quarantined document',"record_state='review'" ]]){
  check(label+' withdraws the old grant on the next read and exact-ref validation',()=>{
   const before=sql(`SELECT row_to_json(d) FROM tenant_knowledge_docs d WHERE id='${doc}';`);sql(`UPDATE tenant_knowledge_docs SET ${patch} WHERE id='${doc}';`);
   try{assert(!context().sources.some(s=>s.document_id===doc));assert.throws(()=>context(uid,tenant,firstRefs));}
   finally{sql(`UPDATE tenant_knowledge_docs SET (revision,content,title,active_generation_id,publication_manifest,record_state)=(SELECT r.revision,r.content,r.title,r.active_generation_id,r.publication_manifest,r.record_state FROM json_populate_record(NULL::tenant_knowledge_docs,$row$${before}$row$::json) r) WHERE id='${doc}';`)}
  });
 }
 check('Source changed after preview cannot be published by its old proposal',()=>{
  const p=prepare(),before=snapshot();sql(`UPDATE tenant_knowledge_docs SET content='New unreviewed content' WHERE id='${doc}';`);
  try{assert.throws(()=>save(p));assert.equal(snapshot(),before)}finally{sql(`UPDATE tenant_knowledge_docs SET content='Approved customer program' WHERE id='${doc}';`)}
 });
 check('Client-controlled shared workspace consent is not repurposed as a Knowledge publication grant',()=>{
  const prior=sql(`SELECT coalesce(paige_shared_context_consent,false) FROM clients WHERE id='${contact}';`);
  sql(`UPDATE clients SET paige_shared_context_consent=false WHERE id='${contact}';`);
  try{assert(context().sources.some(s=>s.document_id===doc))}finally{sql(`UPDATE clients SET paige_shared_context_consent=${prior==='t'} WHERE id='${contact}';`)}
 });
 for(const [label,change,restore]of[
  ['Revoked relationship',`UPDATE clients SET linked_user_id=NULL WHERE id='${contact}'`,`UPDATE clients SET linked_user_id='${uid}' WHERE id='${contact}'`],
  ['Archived client',`UPDATE clients SET status='archived' WHERE id='${contact}'`,`UPDATE clients SET status='active' WHERE id='${contact}'`],
  ['Inactive business',`UPDATE tenants SET status='suspended' WHERE id='${tenant}'`,`UPDATE tenants SET status='active' WHERE id='${tenant}'`],
  ['Banned Auth user',`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${uid}'`,`UPDATE auth.users SET banned_until=NULL WHERE id='${uid}'`]])
  check(label+' retires the customer context',()=>{sql(change);try{assert.throws(()=>context())}finally{sql(restore)}});
 check('A staff workspace switch retires the owner proposal without changing customer context',()=>{
  const p=prepare();sql(`UPDATE profiles SET active_tenant_id='${foreign}' WHERE user_id='${owner}';`);
  try{assert.throws(()=>save(p));assert.equal(context().contact_id,contact)}finally{sql(`UPDATE profiles SET active_tenant_id='${tenant}' WHERE user_id='${owner}';`)}
 });
 check('A forged generic audit row cannot establish a new native grant or successful replay',()=>{
  const p=prepare(),op=randomUUID();sql(`INSERT INTO audit_logs(id,user_id,entity,entity_id,data) VALUES('${op}','${owner}','client_portal_knowledge_share','${saved.share_id}','{"request_hash":"${'0'.repeat(64)}"}');`);
  const before=snapshot();assert.throws(()=>save(p,owner,op));assert.equal(snapshot(),before);
 });
 check('Explicit withdrawal removes context, invalidates references and records the actual owner',()=>{
  const r=save(prepare(owner,tenant,contact,doc,false));assert.equal(r.currently_available,false);assert(!context().sources.some(s=>s.document_id===doc));assert.throws(()=>context(uid,tenant,firstRefs));
  assert.equal(sql(`SELECT action FROM audit_logs WHERE id='${r.receipt_id}';`),'withdraw_customer_knowledge');
 });
 check('Replaying an older publication cannot reactivate a subsequently withdrawn grant',()=>{const before=snapshot();assert.throws(()=>save(proposed,owner,operation));assert.equal(snapshot(),before)});
 check('Returning users see the persisted remaining authorized source',()=>assert.deepEqual(context().sources.map(s=>s.document_id),[secondDoc]));
 check('Private helpers and raw grants are not executable/readable by external API roles',()=>{
  for(const role of ['anon','authenticated','service_role']){
   assert.equal(sql(`SELECT has_table_privilege('${role}','public.tenant_knowledge_client_shares','SELECT,INSERT,UPDATE,DELETE');`),'f');
   assert.equal(sql(`SELECT bool_or(has_function_privilege('${role}',oid,'EXECUTE')) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname ~ '^_client_knowledge_';`),'f');
  }
  assert.throws(()=>as('SELECT * FROM tenant_knowledge_client_shares',uid));
 });
 const background=(query)=>new Promise((resolve,reject)=>{const child=spawn(exe('psql'),['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{windowsHide:true});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('close',code=>{transcripts.push({command:'knowledge-authority-revoker',exitCode:code,stdout,stderr});resolve(code)});child.stdin.end(query)});
 const p=prepare(owner,tenant,contact,secondDoc),before=snapshot();
 const revoker=background(`BEGIN; SET LOCAL application_name='knowledge-authority-revoker'; UPDATE tenant_members SET status='inactive' WHERE user_id='${owner}' AND tenant_id='${tenant}'; SELECT pg_sleep(2); COMMIT;`);
 try{
  let locked=false;for(let i=0;i<40;i++){if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='knowledge-authority-revoker' AND wait_event='PgSleep');")==='t'){locked=true;break}await new Promise(r=>setTimeout(r,20))}assert(locked,'Native revoker reached its lock barrier');
  let refused=false;try{save(p)}catch{refused=true}assert.equal(await revoker,0);
  check('Owner authority withdrawn while acquiring canonical authority locks prevents both grant and receipt',()=>{assert(refused);assert.equal(snapshot(),before)});
 }finally{await revoker;sql(`UPDATE tenant_members SET status='active' WHERE user_id='${owner}' AND tenant_id='${tenant}';`)}
 sql(`INSERT INTO user_roles VALUES('${owner}','fixture-role');
  INSERT INTO agency_team_members VALUES('${tenant}','${owner}','active');
  INSERT INTO paige_coach_assignments VALUES('${contact}',true,'${owner}');`);
 const lockProposal=prepare(owner,tenant,contact,secondDoc),lockOperation=randomUUID();
 const writer=background(`BEGIN; SET LOCAL application_name='knowledge-share-lock-holder';
  SELECT set_config('test.actor','${owner}',true); SET LOCAL ROLE authenticated;
  SELECT set_client_portal_knowledge_share('${tenant}','${contact}','${secondDoc}',true,${lockProposal.expected_share_revision},'${lockProposal.proposal_hash}','${lockOperation}');
  SELECT pg_sleep(4); COMMIT;`);
 try{
  let locked=false;for(let i=0;i<60;i++){if(sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='knowledge-share-lock-holder' AND wait_event='PgSleep');")==='t'){locked=true;break}await new Promise(r=>setTimeout(r,20))}assert(locked,'Native writer reached its commit barrier');
  for(const [label,change]of[
   ['Auth',`UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='${owner}'`],
   ['business',`UPDATE tenants SET status='suspended' WHERE id='${tenant}'`],
   ['membership',`UPDATE tenant_members SET status='inactive' WHERE user_id='${owner}' AND tenant_id='${tenant}'`],
   ['role',`UPDATE user_roles SET role='revoked' WHERE user_id='${owner}'`],
   ['workspace',`UPDATE profiles SET active_tenant_id='${foreign}' WHERE user_id='${owner}'`],
   ['agency assignment',`UPDATE agency_team_members SET status='inactive' WHERE user_id='${owner}'`],
   ['coach assignment',`UPDATE paige_coach_assignments SET active=false WHERE rep_user_id='${owner}'`]])
   check('Concurrent '+label+' revocation cannot pass the in-flight share commit',()=>assert.throws(()=>sql(`BEGIN; SET LOCAL lock_timeout='150ms'; ${change}; ROLLBACK;`),/lock timeout/));
  assert.equal(await writer,0);
 }finally{await writer}
 return {knowledgeSharesMigrationSHA256:createHash('sha256').update(migration).digest('hex'),knowledgeSharesControl:authorityLockControl?'AUTHORITY_LOCK_REMOVED':clientScopeControl?'CLIENT_SCOPE_REMOVED':unsafe?'SOURCE_CURRENT_REMOVED':'NONE',knowledgeSharesProof:'isolated native PostgreSQL; actual authority bodies, surrounding Auth/metadata shapes modeled; hosted customer/Chat integration unverified'};
}
