// One additional mode of the original fenced E09 runner. Original native Action
// Bus bodies execute; local Auth/role/autonomy and nonexecuted graph are ports.
// Full-schema customer_portal_access.sql remains the normative role/trigger proof.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export async function privateRequestProof({sql,check,assert,fs,root,path,fixture,baseline,historyBaseline=false,publicationBaseline=false,publicationCandidate=false,spawn,exe,args,transcripts}) {
 const read=file=>fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
 const preparationFile='supabase/migrations/20271114150009_e09_private_request_preparation.sql';
 const historyFile='supabase/migrations/20271114150019_e09_private_request_history.sql';
 const nativeMigration=historyBaseline
  ?execFileSync('git',['show','ba786f11b52c71b4ed87e7eb7a022b5aaa376e18:supabase/migrations/20271114150009_e09_private_request_preparation.sql'],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n')
  :read(preparationFile)+'\n'+read(historyFile);
 const original=(file,name)=>{
  const source=read(file),start=source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end=source.indexOf('END $function$;',start)+'END $function$;'.length;
  assert(start>=0&&end>start,'Original native source required: '+name);return source.slice(start,end);
 };
 sql(`ALTER TABLE public.paige_actions
  ADD COLUMN action_kind text,ADD COLUMN from_department text,ADD COLUMN to_department text,
  ADD COLUMN contact_id uuid,ADD COLUMN conversation_id uuid,ADD COLUMN parent_action_id uuid,
  ADD COLUMN title text,ADD COLUMN summary text,ADD COLUMN payload jsonb DEFAULT '{}',
  ADD COLUMN draft_content jsonb,ADD COLUMN status text,ADD COLUMN priority text,
  ADD COLUMN autonomy_lane text,ADD COLUMN approval_id uuid,ADD COLUMN assigned_subagent_slug text,
  ADD COLUMN invocation_id uuid,ADD COLUMN assigned_to_user_id uuid,ADD COLUMN created_by uuid,
  ADD COLUMN created_by_agent text,ADD COLUMN due_at timestamptz,ADD COLUMN expires_at timestamptz,
  ADD COLUMN error text,ADD COLUMN decision_rationale text,ADD COLUMN filed_at timestamptz DEFAULT now(),
  ADD COLUMN assigned_at timestamptz,ADD COLUMN drafted_at timestamptz,ADD COLUMN executed_at timestamptz,
  ADD COLUMN resolved_at timestamptz,ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN workflow_run_id uuid;
  ALTER TABLE public.paige_actions ALTER COLUMN updated_at SET DEFAULT now();
  CREATE TABLE public.paige_action_kinds(slug text PRIMARY KEY,tenant_id uuid,label text,description text,
   executor text,requires_approval boolean,approval_type text,draft_subagent_slug text,
   default_from_department text,default_to_department text,default_autonomy_lane text,
   default_priority text,enabled boolean);
  INSERT INTO public.paige_action_kinds VALUES('client.portal_recommendation',NULL,'Portal recommendation',NULL,
   'surface_to_client',false,'other',NULL,'client_experience','client_experience','confirm','low',true);
  CREATE TABLE public.paige_workflow_registry(id uuid,key text,tenant_id uuid,is_active boolean,requires_approval boolean);
  CREATE TABLE public.paige_subagents(slug text,tenant_id uuid,enabled boolean);
  CREATE TABLE IF NOT EXISTS public.messages(id uuid,tenant_id uuid,meta jsonb);
  CREATE FUNCTION public.has_any_role(uuid,text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
   SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role=ANY($2))$$;
  CREATE FUNCTION public.is_tenant_member(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
   SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=$1 AND user_id=auth.uid() AND status='active')$$;
  CREATE FUNCTION public.is_platform_owner(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
  CREATE FUNCTION public.paige_resolve_autonomy(uuid,text,text) RETURNS text LANGUAGE sql STABLE AS $$SELECT $3$$;
 `);
 sql(original('supabase/migrations/20260714092000_growth_submission_processor.sql','file_action'));
 sql(original('supabase/migrations/20271110220000_followup_email_origin_admission.sql','advance_action'));
 const fileSig='file_action(text,text,text,uuid,jsonb,text,text,text,timestamptz,uuid,uuid,text,uuid,text)',advanceSig='advance_action(uuid,text,jsonb,text,uuid,uuid,jsonb,text,text,uuid)';
 const retirement=read('supabase/migrations/20270504000000_retire_title_role_from_functions.sql');
 const retirementStart=retirement.indexOf('CREATE FUNCTION pg_temp.reads_retired_role('),retirementEnd=retirement.indexOf('-- Lists and separate branches');
 assert(retirementStart>=0&&retirementEnd>retirementStart,'Original role-retirement helper required');
 sql(retirement.slice(retirementStart,retirementEnd)+`\nSELECT pg_temp.retire_role('public.${fileSig}'::regprocedure);`);
 sql(`REVOKE ALL ON FUNCTION public.${fileSig},public.${advanceSig} FROM PUBLIC,anon;
  GRANT EXECUTE ON FUNCTION public.${fileSig},public.${advanceSig} TO authenticated,service_role;`);
 // The recorded old production file_action retains 64 CRLFs. Canonical replay
 // is the SAME retired-role body with LF; both exact fingerprints were read
 // from production, including md5(replace(prosrc, CRLF, LF)). Reproduce its
 // transport server-side, without copying production code or weakening a guard.
 const replayFileHash=sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='public.${fileSig}'::regprocedure`);
 assert.equal(replayFileHash,'8389ea7b5589ad7ce939d9f8b01b6188');
 sql(`DO $proof_eol$ BEGIN EXECUTE replace(replace(pg_get_functiondef('public.${fileSig}'::regprocedure),E'\\r\\n',E'\\n'),E'\\n',E'\\r\\n'); END $proof_eol$;`);
 const fingerprints=()=>JSON.parse(sql(`SELECT jsonb_object_agg(proname,md5(prosrc)) FROM pg_proc WHERE oid IN('public.${fileSig}'::regprocedure,'public.${advanceSig}'::regprocedure,'public._client_portal_access_authorize(uuid,uuid,boolean)'::regprocedure)`));
 const before=fingerprints();
 const nativeMetadata=()=>sql(`SELECT jsonb_agg(jsonb_build_object('oid',oid,'name',proname,'body',md5(prosrc),
  'owner',proowner,'acl',proacl,'config',proconfig,'security_definer',prosecdef,'volatility',provolatile,
  'arguments',pg_get_function_arguments(oid),'result',pg_get_function_result(oid)) ORDER BY oid)
  FROM pg_proc WHERE oid IN('public.${fileSig}'::regprocedure,'public.${advanceSig}'::regprocedure,
  'public._client_portal_access_authorize(uuid,uuid,boolean)'::regprocedure)`);
 const nativeBefore=nativeMetadata();
 assert.equal(before.file_action,'40349ee33cf5f77ef6fc228087fdc67f','Current original file_action body required');
 assert.equal(before.advance_action,'66dcedb5e40dd43a54373c0e0ded1884','Current original advance_action body required');
 assert.equal(before._client_portal_access_authorize,'7c3eb55c866321fed052ae742b75e42d','Original Portal owner authority required');
 if(!baseline)sql(nativeMigration);
 const f=fixture();
 sql(`INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${f.other}','${f.tenant}');
  INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner)VALUES('${f.tenant}','${f.other}','owner','active',true);
  INSERT INTO public.user_roles(user_id,role)VALUES('${f.other}','admin');`);
 const intent='e09df000-0000-4000-8000-000000000001';
 const lit=x=>x===null?'NULL':`'${String(x).replaceAll("'","''")}'`;
 const asActor=(statement,actor=f.other,role='authenticated')=>{
  const out=sql(`BEGIN;SELECT set_config('test.actor',${lit(actor??'')},true);SET LOCAL ROLE ${role};${statement};COMMIT;`);
  const row=out.split('\n').find(x=>x.startsWith('{'));assert(row,'Closed native result required');return JSON.parse(row);
 };
 const statement=(o={},readOnly=false)=>{
  const x={actor:f.other,tenant:f.tenant,contact:f.contact,expected:f.other,intent,title:'Review your welcome guide',body:'Read the shared guide.',role:'authenticated',...o};
  return {actor:x.actor,role:x.role,text:`SELECT public.${readOnly?'read_client_portal_request_draft':'prepare_client_portal_request'}(${lit(x.expected)},${lit(x.tenant)},${lit(x.contact)},${lit(x.intent)}${readOnly?'':','+lit(x.title)+','+lit(x.body)})`};
 };
 const invoke=(o={},readOnly=false)=>{const s=statement(o,readOnly);return asActor(s.text,s.actor,s.role);};
 const prepare=()=>invoke();
 const status=()=>invoke({},true);
 const snapshot=()=>sql(`SELECT jsonb_build_object('work',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.paige_actions x),
  'work_audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.audit_logs x),
  'customer',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.paige_customer_actions x),
  'responses',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.paige_customer_responses x),
  'notices',(SELECT jsonb_agg(to_jsonb(x)) FROM public.notifications x),
  'approvals',(SELECT jsonb_agg(to_jsonb(x)) FROM public.paige_pending_approvals x))`);
 const customerSnapshot=()=>sql(`SELECT jsonb_build_object('actions',(SELECT count(*) FROM public.paige_customer_actions),
  'responses',(SELECT count(*) FROM public.paige_customer_responses),'notices',(SELECT count(*) FROM public.notifications),
  'approvals',(SELECT count(*) FROM public.paige_pending_approvals))`);
 const customerBefore=customerSnapshot();
 check('Private request status distinguishes missing committed work from a rejected request',()=>{const r=status();assert.equal(r.found,false);assert.equal(r.missing_is_rejection,false);assert.equal(r.request,null);});
 let first;
 check('Owner prepares one original private Work record without customer publication',()=>{
  first=prepare();assert.equal(first.replayed,false);assert.equal(first.found,true);assert.equal(first.request.status,'assigned');
  assert.equal(first.request.title,'Review your welcome guide');assert.equal(first.request.body,'Read the shared guide.');assert.equal(first.request.customer_action_id,null);
 });
 check('Same prepared intent returns original Work without another filing',()=>{
  const r=prepare();assert.equal(r.replayed,true);assert.equal(r.request.work_id,first.request.work_id);
 });
 if(!baseline&&first?.request){
  check('Status/replay keep one original version and exactly the original two writer audits',()=>{
   const before=snapshot(),r=status();assert.equal(r.request.work_id,first.request.work_id);assert.equal(r.request.version,first.request.version);assert.equal(snapshot(),before);
   assert.equal(sql(`SELECT count(*) FROM public.audit_logs WHERE entity_id='${first.request.work_id}' AND user_id='${f.other}' AND action IN('file_action','advance_action')`),'2');
   assert.equal(sql(`SELECT assigned_to_user_id FROM public.paige_actions WHERE id='${first.request.work_id}'`),f.other);
  });
  check('Whitespace normalization preserves exact original private words on replay',()=>{const r=invoke({title:'  Review your welcome guide\n',body:'\tRead the shared guide.  '});assert.equal(r.replayed,true);assert.equal(r.request.work_id,first.request.work_id);});
  for(const [name,options]of[
   ['changed content',{body:'Changed wording'}],['changed title',{title:'Another title'}],
   ['blank title',{title:' \t\n'}],['blank body',{body:''}],['null body',{body:null}],
   ['long title',{title:'x'.repeat(161)}],['long body',{body:'x'.repeat(4001)}],
   ['wrong expected actor',{expected:f.actor}],['missing expected actor',{expected:null}],
   ['wrong selected business',{tenant:'e09df000-0000-4000-8000-000000000099'}],
   ['missing intent',{intent:null}],['customer identity',{actor:f.actor,expected:f.actor}],
   ['service principal',{role:'service_role'}],['anonymous principal',{role:'anon',actor:null}]
  ])check('Private preparation refuses '+name+' without effects',()=>{const before=snapshot();assert.throws(()=>invoke(options));assert.equal(snapshot(),before);});
  const g=fixture();
  sql(`INSERT INTO public.profiles(user_id,active_tenant_id)VALUES('${g.other}','${g.tenant}');
   INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner)VALUES('${g.tenant}','${g.other}','owner','active',true);
   INSERT INTO public.user_roles(user_id,role)VALUES('${g.other}','admin');`);
  check('Foreign CRM contact cannot be prepared or read in the current business',()=>{const before=snapshot();for(const readOnly of [false,true])assert.throws(()=>invoke({contact:g.contact},readOnly));assert.equal(snapshot(),before);});
  check('Second eligible business gets its own original private Work and history',()=>{
   const r=invoke({actor:g.other,expected:g.other,tenant:g.tenant,contact:g.contact});assert.notEqual(r.request.work_id,first.request.work_id);
   assert.equal(r.tenant_id,g.tenant);assert.equal(r.contact_id,g.contact);assert.equal(r.request.status,'assigned');
  });
  check('Same intent at another own CRM record never recovers the previous contact content',()=>{
   const h=fixture();sql(`UPDATE public.clients SET tenant_id='${f.tenant}' WHERE id='${h.contact}'`);
   const r=invoke({contact:h.contact},true);assert.equal(r.found,false);assert.equal(r.request,null);
  });
  check('A global admin title on an ordinary member grants no Portal owner authority',()=>{
   sql(`INSERT INTO public.tenant_members(tenant_id,user_id,role,status)VALUES('${f.tenant}','${f.actor}','member','active');
    UPDATE public.profiles SET active_tenant_id='${f.tenant}' WHERE user_id='${f.actor}';INSERT INTO public.user_roles(user_id,role)VALUES('${f.actor}','admin') ON CONFLICT DO NOTHING;`);
   const before=snapshot();for(const readOnly of [false,true])assert.throws(()=>invoke({actor:f.actor,expected:f.actor},readOnly));assert.equal(snapshot(),before);
  });
  check('Losing original Work staff standing refuses both read and preparation',()=>{
   sql(`DELETE FROM public.user_roles WHERE user_id='${f.other}'`);try{const before=snapshot();for(const readOnly of [false,true])assert.throws(()=>invoke({},readOnly));assert.equal(snapshot(),before);}finally{sql(`INSERT INTO public.user_roles(user_id,role)VALUES('${f.other}','admin')`);}
  });
  check('Revoked membership refuses returning status and prepare without another filing',()=>{
   sql(`UPDATE public.tenant_members SET status='inactive' WHERE user_id='${f.other}'`);try{const before=snapshot();for(const readOnly of [false,true])assert.throws(()=>invoke({},readOnly));assert.equal(snapshot(),before);}finally{sql(`UPDATE public.tenant_members SET status='active' WHERE user_id='${f.other}'`);}
  });
  for(const [field,value]of[['account_type','agency'],['account_type','sub_account'],['status','trial'],['status','past_due'],['status','suspended']])check('Original Portal eligibility refuses '+value+' without widening a cohort',()=>{
   sql(`UPDATE public.tenants SET ${field}='${value}' WHERE id='${f.tenant}'`);try{const before=snapshot();assert.throws(()=>invoke());assert.equal(snapshot(),before);}finally{sql(`UPDATE public.tenants SET ${field}='${field==='status'?'active':'standalone'}' WHERE id='${f.tenant}'`);}
  });
  check('Paused, ended and nonconsenting relationships stay private and their preferences stay unchanged',()=>{
   for(const [i,state]of ['paused','ended'].entries()){
    sql(`UPDATE public.clients SET portal_access_state='${state}',paige_shared_context_consent=false WHERE id='${f.contact}'`);
    const r=invoke({intent:`e09df000-0000-4000-8000-00000000001${i}`});assert.equal(r.request.status,'assigned');assert.equal(r.request.customer_action_id,null);
    assert.equal(sql(`SELECT portal_access_state||':'||paige_shared_context_consent::text FROM public.clients WHERE id='${f.contact}'`),state+':false');
   }
  });
  check('Known intent reconciles before a changed kind admission; new intent refuses',()=>{
   sql("UPDATE public.paige_action_kinds SET enabled=false");try{
    const before=snapshot();assert.equal(prepare().replayed,true);assert.throws(()=>invoke({intent:'e09df000-0000-4000-8000-000000000020'}));assert.equal(snapshot(),before);
   }finally{sql("UPDATE public.paige_action_kinds SET enabled=true");}
  });
  check('A draft-agent change cannot silently turn private preparation into model work',()=>{
   sql("UPDATE public.paige_action_kinds SET draft_subagent_slug='unexpected-agent'");try{const before=snapshot();assert.throws(()=>invoke({intent:'e09df000-0000-4000-8000-000000000021'}));assert.equal(snapshot(),before);}finally{sql("UPDATE public.paige_action_kinds SET draft_subagent_slug=NULL");}
  });
  check('Changing original Work content invalidates the prepared preview rather than exposing a stale version',()=>{
   sql(`UPDATE public.paige_actions SET draft_content='{"body":"New unreviewed words"}',status='drafted' WHERE id='${first.request.work_id}'`);
   try{const r=status();assert.equal(r.found,true);assert.equal(r.request.content_state,'changed');assert.equal(r.request.body,null);assert.equal(r.request.title,null);}finally{sql(`UPDATE public.paige_actions SET draft_content=NULL,status='assigned' WHERE id='${first.request.work_id}'`);}
  });
  check('Closed preparation result never projects arbitrary Work payload or staff routing',()=>{
   sql(`UPDATE public.paige_actions SET payload=payload||'{"private_reasoning":"HIDDEN_SENTINEL"}' WHERE id='${first.request.work_id}'`);
   const s=JSON.stringify(status());for(const text of ['HIDDEN_SENTINEL','payload','from_department','assigned_subagent_slug','linked_user_id'])assert(!s.includes(text),text);
  });
  check('Failure of the original assignment audit rolls back filing and every original audit',()=>{
   sql(`CREATE FUNCTION public.proof_reject_assignment() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='advance_action' THEN RAISE EXCEPTION 'controlled assignment audit failure'; END IF;RETURN NEW;END$$;
    CREATE TRIGGER proof_assignment_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.proof_reject_assignment()`);
   try{const before=snapshot();assert.throws(()=>invoke({intent:'e09df000-0000-4000-8000-000000000022'}));assert.equal(snapshot(),before);}finally{sql('DROP TRIGGER proof_assignment_audit ON public.audit_logs;DROP FUNCTION public.proof_reject_assignment()');}
  });
  check('New public API is authenticated-only and never exposes the private original authorizer',()=>{
   for(const sig of ['prepare_client_portal_request(uuid,uuid,uuid,uuid,text,text)','read_client_portal_request_draft(uuid,uuid,uuid,uuid)']){
    const r=JSON.parse(sql(`SELECT jsonb_build_object('auth',has_function_privilege('authenticated','public.${sig}','EXECUTE'),'anon',has_function_privilege('anon','public.${sig}','EXECUTE'),'service',has_function_privilege('service_role','public.${sig}','EXECUTE'),'path',(SELECT proconfig FROM pg_proc WHERE oid='public.${sig}'::regprocedure))`));
    assert.equal(r.auth,true);assert.equal(r.anon,false);assert.equal(r.service,false);assert.deepEqual(r.path,['search_path=""']);
   }
   assert.equal(sql("SELECT has_function_privilege('authenticated','public._client_portal_access_authorize(uuid,uuid,boolean)','EXECUTE')"),'f');
  });
  // Two real psql connections, with observable database blocking rather than a
  // timing assumption. These sessions are confined to this runner's loopback DB.
  const launch=(body,name)=>{
   const child=spawn(exe('psql'),args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
   child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);
   const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{
    transcripts.push({command:'psql-private-request-'+name,args,exitCode:code,stdout:out,stderr:err});
    resolve({code,out,err,result:out.split(/\r?\n/).filter(v=>v.startsWith('{')).map(v=>JSON.parse(v))});
   });});
   child.stdin.write(`SET application_name='e09_private_${name}';SET statement_timeout='12s';${body}\n`);
   return {child,done};
  };
  const waitFor=async(predicate)=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,40));}throw new Error('Controlled native session did not reach its expected lock');};
  const locked=name=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='e09_private_${name}' AND wait_event_type='Lock'`)==='1';
  const parallelIntent='e09df000-0000-4000-8000-000000000030';
  let concurrentResults;
  const hold=launch(`BEGIN;SELECT 1 FROM public.profiles WHERE user_id='${f.other}' FOR UPDATE;`,'same_holder');
  let one,two;
  try{
   await waitFor(()=>sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='e09_private_same_holder' AND state='idle in transaction'")==='1');
   const s=statement({intent:parallelIntent});
   one=launch(`BEGIN;SELECT set_config('test.actor','${f.other}',true);SET LOCAL ROLE authenticated;${s.text};COMMIT;`,'same_one');one.child.stdin.end();
   two=launch(`BEGIN;SELECT set_config('test.actor','${f.other}',true);SET LOCAL ROLE authenticated;${s.text};COMMIT;`,'same_two');two.child.stdin.end();
   await waitFor(()=>locked('same_one')&&locked('same_two'));
  }finally{hold.child.stdin.end('COMMIT;\n');await hold.done;}
  concurrentResults=await Promise.all([one.done,two.done]);
  check('Concurrent same-intent preparations wait on the original profile and commit one original Work record',()=>{
   for(const r of concurrentResults)assert.equal(r.code,0,r.err);
   const [a,b]=concurrentResults.map(r=>r.result.at(-1));assert.equal(a.request.work_id,b.request.work_id);assert.notEqual(a.replayed,b.replayed);
   assert.equal(sql(`SELECT count(*) FROM public.paige_actions WHERE payload#>>'{client_portal_private_request,intent_id}'='${parallelIntent}'`),'1');
   assert.equal(sql(`SELECT count(*) FROM public.audit_logs WHERE entity_id='${a.request.work_id}'`),'2');
  });
  const switchIntent='e09df000-0000-4000-8000-000000000031',switchBefore=snapshot();
  // Both businesses are legitimate fixture memberships. Only the active pointer
  // changes while the old request waits; no frontend label grants its old scope.
  sql(`INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner)VALUES('${g.tenant}','${f.other}','owner','active',true)`);
  const switcher=launch(`BEGIN;UPDATE public.profiles SET active_tenant_id='${g.tenant}' WHERE user_id='${f.other}';`,'switch_holder');
  let switched;
  try{
   await waitFor(()=>sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='e09_private_switch_holder' AND state='idle in transaction'")==='1');
   const s=statement({intent:switchIntent});switched=launch(`BEGIN;SELECT set_config('test.actor','${f.other}',true);SET LOCAL ROLE authenticated;${s.text};COMMIT;`,'switched');switched.child.stdin.end();
   await waitFor(()=>locked('switched'));
  }finally{switcher.child.stdin.end('COMMIT;\n');await switcher.done;}
  const switchedResult=await switched.done;
  check('A workspace switch committed during the profile wait refuses the stale request without effects',()=>{assert.notEqual(switchedResult.code,0);assert.equal(snapshot(),switchBefore);});
  sql(`UPDATE public.profiles SET active_tenant_id='${f.tenant}' WHERE user_id='${f.other}'`);
  const revokedBefore=snapshot(),revokedIntent='e09df000-0000-4000-8000-000000000032';
  const contactHolder=launch(`BEGIN;SELECT 1 FROM public.clients WHERE id='${f.contact}' FOR UPDATE;`,'contact_holder');
  let revoked;
  try{
   await waitFor(()=>sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='e09_private_contact_holder' AND state='idle in transaction'")==='1');
   const s=statement({intent:revokedIntent});revoked=launch(`BEGIN;SELECT set_config('test.actor','${f.other}',true);SET LOCAL ROLE authenticated;${s.text};COMMIT;`,'revoked');revoked.child.stdin.end();
   await waitFor(()=>locked('revoked'));
   sql(`UPDATE public.tenant_members SET status='inactive' WHERE tenant_id='${f.tenant}' AND user_id='${f.other}'`);
  }finally{contactHolder.child.stdin.end('COMMIT;\n');await contactHolder.done;}
  const revokedResult=await revoked.done;
  check('Membership revoked during a contact wait is revalidated before any filing or words return',()=>{assert.notEqual(revokedResult.code,0);assert.equal(snapshot(),revokedBefore);});
  sql(`UPDATE public.tenant_members SET status='active' WHERE tenant_id='${f.tenant}' AND user_id='${f.other}'`);
  check('Ambiguous original intent history refuses instead of arbitrarily choosing a record',()=>{
   sql(`CREATE TABLE public.proof_private_backup AS SELECT * FROM public.paige_actions WHERE id='${first.request.work_id}';
    INSERT INTO public.paige_actions SELECT (jsonb_populate_record(NULL::public.paige_actions,to_jsonb(x)||jsonb_build_object('id',gen_random_uuid()))).* FROM public.proof_private_backup x`);
   try{assert.throws(status,/PORTAL_REQUEST_AMBIGUOUS/);}finally{sql(`DELETE FROM public.paige_actions WHERE id<>'${first.request.work_id}' AND payload#>>'{client_portal_private_request,intent_id}'='${intent}' AND created_by='${f.other}';DROP TABLE public.proof_private_backup`);}
  });
  check('An unrelated customer-action link is rejected rather than presented as a shared result',()=>{
   const action=sql(`SELECT id FROM public.paige_customer_actions WHERE tenant_id<>'${f.tenant}' LIMIT 1`);assert(action,'Existing foreign fixture action required');
   sql(`UPDATE public.paige_actions SET customer_action_id='${action}' WHERE id='${first.request.work_id}'`);
   try{assert.throws(status,/PORTAL_REQUEST_SOURCE_CHANGED/);}finally{sql(`UPDATE public.paige_actions SET customer_action_id=NULL WHERE id='${first.request.work_id}'`);}
  });
  const migration=nativeMigration;
  const ownSigs=['read_client_portal_request_draft(uuid,uuid,uuid,uuid)','prepare_client_portal_request(uuid,uuid,uuid,uuid,text,text)',...(!historyBaseline?['list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid)']:[])];
  sql(`CREATE TABLE public.proof_private_sources AS SELECT oid,proname,prosrc,pg_get_functiondef(oid) definition
   FROM pg_proc WHERE oid IN('public.${fileSig}'::regprocedure,'public.${advanceSig}'::regprocedure,
    'public._client_portal_access_authorize(uuid,uuid,boolean)'::regprocedure,${ownSigs.map(s=>`'public.${s}'::regprocedure`).join(',')})`);
  check('Replaying the same migration preserves original Work, source metadata and private history',()=>{
   const before=snapshot();sql(migration);assert.equal(snapshot(),before);assert.equal(nativeMetadata(),nativeBefore);assert.equal(prepare().replayed,true);
  });
  for(const name of ['file_action','advance_action','_client_portal_access_authorize','read_client_portal_request_draft','prepare_client_portal_request',...(!historyBaseline?['list_client_portal_request_drafts']:[])])check('Migration refuses unknown forward '+name+' without overwriting it',()=>{
   sql(`DO $proof$ DECLARE x record;BEGIN SELECT * INTO x FROM public.proof_private_sources WHERE proname='${name}';
    EXECUTE replace(x.definition,x.prosrc,x.prosrc||E'\n-- controlled forward source\n');END $proof$`);
   const changed=sql(`SELECT md5(prosrc) FROM pg_proc WHERE proname='${name}'`);
   try{assert.throws(()=>sql(migration),/source changed|contract changed/);assert.equal(sql(`SELECT md5(prosrc) FROM pg_proc WHERE proname='${name}'`),changed);}
   finally{sql(`DO $proof$ BEGIN EXECUTE (SELECT definition FROM public.proof_private_sources WHERE proname='${name}');END $proof$`);}
  });
  check('Exact canonical LF original writer form replays without changing its permissions or words',()=>{
   sql(`DO $proof$ BEGIN EXECUTE replace((SELECT definition FROM public.proof_private_sources WHERE proname='file_action'),E'\\r\\n',E'\\n');END $proof$`);
   try{assert.equal(fingerprints().file_action,replayFileHash);sql(migration);assert.equal(fingerprints().file_action,replayFileHash);assert.equal(prepare().replayed,true);}
   finally{sql("DO $proof$ BEGIN EXECUTE (SELECT definition FROM public.proof_private_sources WHERE proname='file_action');END $proof$");}
  });
  sql('DROP TABLE public.proof_private_sources');
  check('Native source ABI, OID, owner, grants, search path and body are all preserved',()=>assert.equal(nativeMetadata(),nativeBefore));
  check('Private preparation and every refusal create no customer action, response, notice or approval',()=>assert.equal(customerSnapshot(),customerBefore));
  await privateHistoryProof({sql,check,assert,fixture,f,first,invoke,asActor,snapshot,customerSnapshot,historyBaseline,launch,waitFor,locked});
 }
 check('Original native file, advance and Portal authority remain byte-exact',()=>assert.deepEqual(fingerprints(),before));
 const publication=publicationBaseline?privatePublicationBaselineProof({sql,check,assert,fixture,asActor,invoke,read,customerSnapshot}):publicationCandidate?await privatePublicationCandidateProof({sql,check,assert,fixture,asActor,invoke,read,customerSnapshot,spawn,exe,args,transcripts}):null;
 return {baseline,historyBaseline,baselineSource:historyBaseline?'ba786f11b52c71b4ed87e7eb7a022b5aaa376e18':null,originalFingerprints:before,canonicalReplayFileHash:replayFileHash,
  migration:'20271114150009_e09_private_request_preparation.sql',
  migrationNormalizedSHA256:createHash('sha256').update(read(preparationFile)).digest('hex'),
  historyMigration:historyBaseline?null:'20271114150019_e09_private_request_history.sql',
  historyMigrationNormalizedSHA256:historyBaseline?null:createHash('sha256').update(read(historyFile)).digest('hex'),
  appliedMigrationOrder:baseline?[]:['20271114150009',...(!historyBaseline?['20271114150019']:[])],
  fixture:'synthetic Auth/role/autonomy/graph ports; original native writers, canonical role retirement, recorded CRLF transport and owner authority',customerPublication:publicationCandidate?'NATIVE_CANDIDATE_ONLY':publicationBaseline?'ORIGINAL_NATIVE_BASELINE_ONLY':'NOT_RUN',fullSchema:'PROOF_OWED',...((publicationBaseline||publicationCandidate)?{publication}:{})};
}

function privatePublicationBaselineProof({sql,check,assert,fixture,asActor,invoke,read,customerSnapshot,setupOnly=false}) {
 const sourceFile='supabase/migrations/20271111010000_e09_customer_portal_access.sql';
 const publisher=read(sourceFile).match(/CREATE OR REPLACE FUNCTION public\.admin_propose_paige_actions\(p_contact_id uuid, p_actions jsonb\)[\s\S]*?END; \$function\$;/)?.[0];
 assert(publisher,'Actual original customer-action writer required, never a stub');
 // Complete only the existing fixture's role graph. This remains an explicit
 // synthetic Auth/role port; original domain tables/constraint/writer execute.
 sql(`CREATE TYPE public.app_role AS ENUM('admin','super_admin','client');
  CREATE FUNCTION public.has_role(uuid,public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$
   SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=$1 AND role=$2::text)$$;`);
 sql(publisher);
 const acl=read('supabase/migrations/20271110215000_e09_customer_portal_profile_consent.sql').split('\n')
  .filter(line=>line.includes('ON FUNCTION public.admin_propose_paige_actions(')).join('\n');
 assert(acl.includes('REVOKE')&&acl.includes('GRANT'),'Original published ACL statements required');sql(acl);
 const publisherHash=sql("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.admin_propose_paige_actions(uuid,jsonb)'::regprocedure");
 check('Publication baseline executes the exact observed original customer-action writer',()=>assert.equal(publisherHash,'21bd99c7a036f28f82a677fa25c6db04'));
 const f=fixture(),foreign=fixture(),member=fixture();
 sql(`INSERT INTO public.profiles(user_id,active_tenant_id) VALUES('${f.other}','${f.tenant}');
  INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner)VALUES('${f.tenant}','${f.other}','owner','active',true);
  INSERT INTO public.user_roles(user_id,role)VALUES('${f.other}','admin');
  INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner)VALUES('${f.tenant}','${member.other}','member','active',false);
  INSERT INTO public.profiles(user_id,active_tenant_id)VALUES('${member.other}','${f.tenant}');
  UPDATE public.clients SET linked_user_id='${f.actor}',portal_access_state='open',paige_shared_context_consent=true WHERE id='${f.contact}';`);
 const lit=x=>`'${String(x).replaceAll("'","''")}'`;
 const direct=(actor=f.other,contact=f.contact)=>asActor(`SELECT public.admin_propose_paige_actions(${lit(contact)},'[{
  "action_type":"recommendation","title":"Read the welcome guide","body":"Start with section one.","payload":{}}]'::jsonb)`,actor);
 const snapshot=()=>customerSnapshot()+':'+sql('SELECT count(*) FROM public.paige_audit_log');
 check('Original direct publisher positive control creates one exact customer item and notice',()=>{
  const before=JSON.parse(customerSnapshot()),r=direct();assert.equal(r.ok,true);assert.equal(r.count,1);assert.equal(r.ids.length,1);
  const after=JSON.parse(customerSnapshot());assert.equal(after.actions,before.actions+1);assert.equal(after.notices,before.notices+1);
  const saved=JSON.parse(sql(`SELECT to_jsonb(x) FROM public.paige_customer_actions x WHERE id='${r.ids[0]}'`));
  assert.equal(saved.tenant_id,f.tenant);assert.equal(saved.contact_id,f.contact);assert.equal(saved.initiated_by_admin_id,f.other);
  assert.equal(saved.action_type,'recommendation');assert.equal(saved.title,'Read the welcome guide');
  assert.equal(sql(`SELECT count(*) FROM public.notifications WHERE user_id='${f.actor}' AND metadata->>'action_id'='${r.ids[0]}'`),'1');
 });
 // Portal clients deliberately have no owner-workspace profile pointer. Never
 // grant them staff standing merely to force a later refusal branch in a test.
 check('Original direct publisher refuses customer authority without customer effects',()=>{const before=snapshot();const r=direct(f.actor);assert.equal(r.ok,false);assert.equal(r.error,'NO_TENANT');assert.equal(snapshot(),before);});
 check('Original direct publisher refuses an ordinary team member inside the same business',()=>{const before=snapshot();const r=direct(member.other);assert.equal(r.ok,false);assert.equal(r.error,'FORBIDDEN');assert.equal(snapshot(),before);});
 check('Original direct publisher refuses another business without customer effects',()=>{const before=snapshot();const r=direct(f.other,foreign.contact);assert.equal(r.ok,false);assert.equal(r.error,'CROSS_TENANT_FORBIDDEN');assert.equal(snapshot(),before);});
 check('Original direct publisher preserves client-controlled consent',()=>{
  sql(`UPDATE public.clients SET paige_shared_context_consent=false WHERE id='${f.contact}'`);const before=snapshot();
  try{const r=direct();assert.equal(r.ok,false);assert.equal(r.error,'CONSENT_NOT_GRANTED');assert.equal(snapshot(),before);}
  finally{sql(`UPDATE public.clients SET paige_shared_context_consent=true WHERE id='${f.contact}'`);}
 });
 if(setupOnly)return {f,foreign,member,publisherHash};
 const prepared=invoke({actor:f.other,expected:f.other,tenant:f.tenant,contact:f.contact,intent:'e09df200-0000-4000-8000-000000000001'});
 assert.equal(prepared.found,true);assert.equal(prepared.request.status,'assigned');const beforePublication=snapshot();
 let observed,observedError;
 check('Prepared original Work can publish one recommendation linked to that same customer',()=>{
  observed=asActor(`SELECT public.advance_action(p_action_id=>'${prepared.request.work_id}',p_to_status=>'executing',p_tenant_id=>'${f.tenant}')`,f.other);
  observedError=sql(`SELECT error FROM public.paige_actions WHERE id='${prepared.request.work_id}'`);
  // Intentionally RED on the unmodified incumbent. Retain the actual enum
  // constraint error; never bless blocked as the desired customer outcome.
  assert.equal(observed.status,'done',JSON.stringify({observed,observedError}));assert(observed.customer_action_id);
 });
 check('Original publication baseline isolates the real action-type constraint gap',()=>assert.match(observedError,/paige_customer_actions_action_type_check/));
 check('Original failed publication leaves no partial customer item, notice, response or publisher audit',()=>assert.equal(snapshot(),beforePublication));
 let mappingOnlyCounterfactual=null;
 check('Rolled-back mapping-only counterfactual diagnoses missing approval and private-payload exposure',()=>{
  const intent='e09df200-0000-4000-8000-000000000002';
  const draft=invoke({actor:f.other,expected:f.other,tenant:f.tenant,contact:f.contact,intent});
  assert.equal(draft.request.status,'assigned');
  const definition=sql("SELECT pg_get_functiondef('public.advance_action(uuid,text,jsonb,text,uuid,uuid,jsonb,text,text,uuid)'::regprocedure)");
  const original="'action_type', _row.action_kind,";
  assert.equal(definition.split(original).length,2,'Exactly one hypothetical mapping change');
  const variant=definition.replace(original,"'action_type', 'recommendation',");
  const before=snapshot();
  // Diagnostic counterfactual only. DDL and customer effects roll back in the
  // same isolated transaction; this variant is never a product implementation.
  let out;
  try{out=sql(`BEGIN;${variant};SELECT set_config('test.actor','${f.other}',true);SET LOCAL ROLE authenticated;
   SELECT public.advance_action(p_action_id=>'${draft.request.work_id}',p_to_status=>'executing',p_tenant_id=>'${f.tenant}');
   RESET ROLE;SELECT jsonb_build_object('status',a.status,'approval_id',a.approval_id,'action_type',c.action_type,
    'private_intent',c.payload_json#>>'{client_portal_private_request,intent_id}')
   FROM public.paige_actions a JOIN public.paige_customer_actions c ON c.id=a.customer_action_id
   WHERE a.id='${draft.request.work_id}';ROLLBACK;`);}
  finally{
   assert.equal(snapshot(),before,'Counterfactual must leave no customer effects, even on a diagnostic error');
   assert.equal(sql("SELECT pg_get_functiondef('public.advance_action(uuid,text,jsonb,text,uuid,uuid,jsonb,text,text,uuid)'::regprocedure)"),definition,'Original native definition restored by rollback');
  }
  const rows=out.split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
  assert.equal(rows.length,2);assert.equal(rows[0].status,'done');assert.equal(rows[1].status,'done');
  assert.equal(rows[1].approval_id,null);assert.equal(rows[1].action_type,'recommendation');assert.equal(rows[1].private_intent,intent);
  mappingOnlyCounterfactual={evidenceClass:'isolated transactional counterfactual; not deployed or authenticated Chat',
   nativeStatus:rows[1].status,approvalAbsent:true,privateIntentWouldBeProjected:true,rolledBack:true};
 });
 return {sourceFile,publisherHash,advanceSource:'66dcedb5e40dd43a54373c0e0ded1884',directPositiveControl:'original writer/constraint/notification/audit',
  observed,observedError,mappingOnlyCounterfactual,fixture:'synthetic Auth/role/relationship setup and outer graph; original PCA table constraint, publisher and Action Bus bodies',
  productionOperation:false,fixApplied:false,fullCustomerJourney:'UNVERIFIED'};
}

async function privatePublicationCandidateProof(env) {
 const {sql,check,assert,fixture,asActor,invoke,read,customerSnapshot}=env;
 const setup=privatePublicationBaselineProof({...env,setupOnly:true});
 const canonical=read('supabase/migrations/20261023000000_confirmations_bind_the_approval_to_the_call.sql');
 const start=canonical.indexOf('CREATE TABLE IF NOT EXISTS public.paige_pending_confirmations (');
 const stop=canonical.indexOf('\n);',start)+4;
 assert(start>=0&&stop>start,'Original common confirmation DDL required');
 sql(canonical.slice(start,stop));
 for(const [file,column]of [
  ['20261026000000_a_token_cannot_be_redeemed_by_the_turn_that_minted_it.sql','issued_in_request'],
  ['20271112130000_experience05_confirmed_weekly_draft.sql','claimed_in_request']
 ]) {
  const statement=read('supabase/migrations/'+file).match(new RegExp('ALTER TABLE public\\.paige_pending_confirmations\\s+ADD COLUMN IF NOT EXISTS '+column+' uuid;','i'))?.[0];
  assert(statement,'Original trusted proposal column required: '+column);sql(statement);
 }
 sql('ALTER TABLE public.paige_pending_confirmations ENABLE ROW LEVEL SECURITY;GRANT SELECT ON public.paige_pending_confirmations TO authenticated;');
 sql('ALTER TABLE public.clients ADD COLUMN portal_access_changed_at timestamptz;');
 sql(read('supabase/migrations/20261201000400_canonical_proposal_integrity.sql'));
 // Explicit synthetic current-autonomy port. The outer stored-call admission,
 // genuine human approval and actual authenticated session remain separate proof.
 sql(`CREATE TABLE public.proof_publication_autonomy(lane text);INSERT INTO public.proof_publication_autonomy VALUES('confirm');
  CREATE FUNCTION public.resolve_tool_autonomy(uuid,text) RETURNS text LANGUAGE sql STABLE AS $$
   SELECT lane FROM public.proof_publication_autonomy WHERE $2='client_portal_request_share'$$;`);
 const migrationFile='supabase/migrations/20271114210009_e09_approved_private_request_publication.sql';
 const advanceSig='public.advance_action(uuid,text,jsonb,text,uuid,uuid,jsonb,text,text,uuid)';
 const advanceBefore=sql(`SELECT pg_get_functiondef('${advanceSig}'::regprocedure)`).replaceAll('\r\n','\n');
 const metadata=()=>sql(`SELECT jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,
  'definer',prosecdef,'args',pg_get_function_arguments(oid),'result',pg_get_function_result(oid)) FROM pg_proc WHERE oid='${advanceSig}'::regprocedure`);
 const advanceMetadata=metadata();
 sql(read(migrationFile));
 const lit=x=>x===null?'NULL':`'${String(x).replaceAll("'","''")}'`;
 const snapshot=()=>sql(`SELECT jsonb_build_object('work',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.paige_actions x),
  'work_audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.audit_logs x),
  'customer',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.paige_customer_actions x),
  'notices',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x),
  'publisher_audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.paige_audit_log x),
  'common_proposals',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.paige_pending_confirmations x),
  'other_approvals',(SELECT jsonb_agg(to_jsonb(x)) FROM public.paige_pending_approvals x))`);
 let serial=0;
 const prepare=()=>{
  const f=fixture();
  sql(`INSERT INTO public.profiles(user_id,active_tenant_id)VALUES('${f.other}','${f.tenant}');
   INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner)VALUES('${f.tenant}','${f.other}','owner','active',true);
   INSERT INTO public.user_roles(user_id,role)VALUES('${f.other}','admin');
   UPDATE public.clients SET linked_user_id='${f.actor}',portal_access_state='open',paige_shared_context_consent=true WHERE id='${f.contact}';`);
  const intent=`e09df300-0000-4000-8000-${String(++serial).padStart(12,'0')}`;
  const request=invoke({actor:f.other,expected:f.other,tenant:f.tenant,contact:f.contact,intent}).request;
  const approved={expected_tenant_id:f.tenant,contact_id:f.contact,work_id:request.work_id,version:request.version,title:request.title,body:request.body,recipient_user_id:f.actor,access_version:null};
  sql(`INSERT INTO public.paige_pending_confirmations(id,user_id,tenant_id,tool_name,fingerprint,args,summary,
   server_issued_at,issued_in_request,consumed_at,claimed_in_request,expires_at)
   VALUES('${f.invite}','${f.other}','${f.tenant}','client_portal_request_share','0123456789abcdef',${lit(JSON.stringify(approved))}::jsonb,
    'Share the exact saved request with this customer',now()-interval '1 second','${f.invite}',now(),'${f.foreign}',now()+interval '5 minutes');`);
  return {...f,request,approved,intent};
 };
 const statement=(f,o={})=>{
  const x={expected:f.other,tenant:f.tenant,confirmation:f.invite,fingerprint:'0123456789abcdef',claim:f.foreign,thread:null,...o};
  return `SELECT public.share_client_portal_request(${lit(x.expected)},${lit(x.tenant)},${lit(x.confirmation)},${lit(x.fingerprint)},${lit(x.claim)},${lit(x.thread)})`;
 };
 const publish=(f,o={})=>asActor(statement(f,o),o.actor===undefined?f.other:o.actor,o.role??'authenticated');
 const f=prepare();let first;
 check('Approved native publication creates one original customer record linked to the same Work',()=>{
  const before=JSON.parse(customerSnapshot());first=publish(f);
  assert.equal(first.status,'shared');assert.equal(first.work_id,f.request.work_id);assert.equal(first.replayed,false);assert(first.customer_action_id);
  const after=JSON.parse(customerSnapshot());assert.equal(after.actions,before.actions+1);assert.equal(after.notices,before.notices+1);assert.equal(after.approvals,before.approvals);
 });
 // Keep running negatives when the initial desired API is absent on baseline.
 if(!first)return {source: migrationFile,desiredPositive:'FAIL',outerApproval:'SYNTHETIC_PORT; NOT_PROVEN',productionOperation:false};
 check('Customer gets only exact approved words and an empty closed public payload',()=>{
  const row=JSON.parse(sql(`SELECT to_jsonb(x) FROM public.paige_customer_actions x WHERE id='${first.customer_action_id}'`));
  assert.equal(row.tenant_id,f.tenant);assert.equal(row.contact_id,f.contact);assert.equal(row.initiated_by_admin_id,f.other);
  assert.equal(row.action_type,'recommendation');assert.equal(row.title,f.approved.title);assert.equal(row.body,f.approved.body);assert.deepEqual(row.payload_json,{});
  assert(!JSON.stringify(row).includes(f.intent));
  const work=JSON.parse(sql(`SELECT to_jsonb(x) FROM public.paige_actions x WHERE id='${f.request.work_id}'`));
  assert.equal(work.status,'done');assert.equal(work.customer_action_id,row.id);assert.equal(work.approval_id,null);
  assert.equal(sql(`SELECT count(*) FROM public.notifications WHERE user_id='${f.actor}' AND metadata->>'action_id'='${row.id}'`),'1');
  assert.equal(sql(`SELECT count(*) FROM public.audit_logs WHERE entity_id='${f.request.work_id}' AND action='advance_action' AND user_id='${f.other}'`),'2');
 });
 check('Lost acknowledgment reconciles the same claimed proposal and Work without another effect',()=>{
  const before=snapshot(),again=publish(f);assert.equal(again.replayed,true);assert.equal(again.customer_action_id,first.customer_action_id);assert.equal(snapshot(),before);
 });
 check('A historical replay after proposal expiry returns the same record and never reexecutes',()=>{
  sql(`UPDATE public.paige_pending_confirmations SET expires_at=consumed_at+interval '1 microsecond' WHERE id='${f.invite}'`);
  const before=snapshot();assert.equal(publish(f).customer_action_id,first.customer_action_id);assert.equal(snapshot(),before);
 });
 check('Original private recovery and returning history reconcile shared Work without exposing metadata',()=>{
  const r=invoke({actor:f.other,expected:f.other,tenant:f.tenant,contact:f.contact,intent:f.intent},true);
  assert.equal(r.request.content_state,'shared');assert.equal(r.request.title,null);assert.equal(r.request.customer_action_id,first.customer_action_id);
  const history=asActor(`SELECT public.list_client_portal_request_drafts('${f.other}','${f.tenant}','${f.contact}',NULL,NULL)`,f.other);
  assert.equal(history.requests[0].request.customer_action_id,first.customer_action_id);assert(!JSON.stringify(history).includes('client_portal_publication'));
 });
 check('The original customer reader returns the shared request and excludes another customer',()=>{
  const customerRead=actor=>asActor(`SELECT public.list_pending_customer_actions('${f.contact}')`,actor);
  const own=customerRead(f.actor);assert(own.actions.some(a=>a.id===first.customer_action_id));
  const foreign=customerRead(setup.foreign.actor);assert(!foreign.actions.some(a=>a.id===first.customer_action_id));
 });
 check('Customer completion and owner return use the same original action, response, Work and records',()=>{
  const version=sql(`SELECT updated_at FROM public.paige_customer_actions WHERE id='${first.customer_action_id}'`);
  const response=asActor(`SELECT public.customer_respond_to_action('${first.customer_action_id}','completed',NULL,${lit(version)}::timestamptz)`,f.actor);
  assert.equal(response.ok,true);
  const owner=asActor(`SELECT public.list_pending_customer_actions('${f.other}','${f.tenant}','${f.contact}')`,f.other);
  const action=owner.actions.find(a=>a.id===first.customer_action_id);assert(action);assert.equal(action.status,'customer_acted');
  assert.equal(action.responses.length,1);assert.equal(action.responses[0].response_type,'completed');
  assert.equal(sql(`SELECT result->>'client_response' FROM public.paige_actions WHERE id='${f.request.work_id}'`),'completed');
  const before=snapshot(),again=publish(f);assert.equal(again.replayed,true);assert.equal(again.customer_action_id,first.customer_action_id);assert.equal(snapshot(),before);
 });
 const pending=prepare();
 for(const [name,options]of [
  ['wrong expected actor',{expected:pending.actor}],['null expected actor',{expected:null}],
  ['wrong business',{tenant:pending.foreign}],['missing proposal',{confirmation:null}],
  ['unknown proposal',{confirmation:pending.actor}],['wrong fingerprint',{fingerprint:'fedcba9876543210'}],
  ['missing claim',{claim:null}],['wrong claim',{claim:pending.invite}],['foreign conversation',{thread:pending.actor}],
  ['customer principal',{actor:pending.actor,expected:pending.actor}],['anonymous principal',{actor:null,role:'anon'}],['service principal',{role:'service_role'}]
 ])check('Publication refuses '+name+' without durable effects',()=>{const before=snapshot();assert.throws(()=>publish(pending,options));assert.equal(snapshot(),before);});
 const refuseMutation=(name,change)=>check(name,()=>{
  const before=snapshot();assert.throws(()=>sql(`BEGIN;${change};SELECT set_config('test.actor','${pending.other}',true);SET LOCAL ROLE authenticated;${statement(pending)};ROLLBACK;`));assert.equal(snapshot(),before);
 });
 const cp=`public.paige_pending_confirmations WHERE id='${pending.invite}'`;
 for(const [name,assignment]of [
  ['unclaimed proposal','consumed_at=NULL'],['untrusted legacy proposal','server_issued_at=NULL'],
  ['same request that minted the proposal',`issued_in_request='${pending.foreign}'`],
  ['unbound claim','claimed_in_request=NULL'],['expired proposal',"expires_at=now()-interval '1 second'"],
  ['foreign actor',`user_id='${pending.actor}'`],['foreign tenant',`tenant_id='${pending.foreign}'`],
  ['different tool',"tool_name='action_advance'"],['client persona focus',`scoped_client_id='${pending.contact}'`],
  ['a changed exact title',`args=jsonb_set(args,'{title}','"Other words"')`],
  ['a changed exact body',`args=jsonb_set(args,'{body}','"Other words"')`],
  ['another joined identity',`args=jsonb_set(args,'{recipient_user_id}',to_jsonb('${pending.other}'::text))`],
  ['another access version',`args=jsonb_set(args,'{access_version}','"2000-01-01T00:00:00Z"')`],
  ['an obsolete version',`args=jsonb_set(args,'{version}','"2000-01-01T00:00:00Z"')`],
  ['foreign CRM relationship',`args=jsonb_set(args,'{contact_id}',to_jsonb('${setup.foreign.contact}'::text))`],
  ['foreign original Work',`args=jsonb_set(args,'{work_id}',to_jsonb('${f.request.work_id}'::text))`],
  ['arbitrary internal payload',`args=args||'{"payload":{"private":true}}'::jsonb`],
  ['nonobject approved arguments',"args='[]'::jsonb"]
 ])refuseMutation('Stored-call publication refuses '+name,`UPDATE ${cp.replace(' WHERE',' SET '+assignment+' WHERE')}`);
 for(const [name,change]of [
  ['revoked membership',`UPDATE public.tenant_members SET status='inactive' WHERE tenant_id='${pending.tenant}' AND user_id='${pending.other}'`],
  ['lost original staff standing',`DELETE FROM public.user_roles WHERE user_id='${pending.other}'`],
  ['ordinary member with a global title',`UPDATE public.tenant_members SET role='member',is_owner=false WHERE tenant_id='${pending.tenant}' AND user_id='${pending.other}';UPDATE public.tenants SET owner_user_id='${pending.actor}' WHERE id='${pending.tenant}'`],
  ['paused client',`UPDATE public.clients SET portal_access_state='paused' WHERE id='${pending.contact}'`],
  ['ended client',`UPDATE public.clients SET portal_access_state='ended' WHERE id='${pending.contact}'`],
  ['customer consent off',`UPDATE public.clients SET paige_shared_context_consent=false WHERE id='${pending.contact}'`],
  ['missing joined identity',`UPDATE public.clients SET linked_user_id=NULL WHERE id='${pending.contact}'`],
  ['changed joined identity',`UPDATE public.clients SET linked_user_id='${setup.foreign.actor}' WHERE id='${pending.contact}'`],
  ['changed access version',`UPDATE public.clients SET portal_access_changed_at=clock_timestamp() WHERE id='${pending.contact}'`],
  ['inactive client',`UPDATE public.clients SET status='archived' WHERE id='${pending.contact}'`],
  ['a disabled original kind',"UPDATE public.paige_action_kinds SET enabled=false WHERE slug='client.portal_recommendation'"],
  ['automation disabled',"UPDATE public.proof_publication_autonomy SET lane='off'"],
  ['unexpected draft',`UPDATE public.paige_actions SET draft_content='{}' WHERE id='${pending.request.work_id}'`],
  ['an attached second approval',`UPDATE public.paige_actions SET approval_id='${pending.invite}' WHERE id='${pending.request.work_id}'`],
  ['changed private intent schema',`UPDATE public.paige_actions SET payload=jsonb_set(payload,'{client_portal_private_request,schema_version}','2') WHERE id='${pending.request.work_id}'`]
 ])refuseMutation('Execution revalidation refuses '+name,change);
 for(const status of ['drafted','executing'])check('Ordinary native '+status+' cannot publish the private-request kind',()=>{
  const before=snapshot();assert.throws(()=>asActor(`SELECT public.advance_action(p_action_id=>'${pending.request.work_id}',p_to_status=>'${status}',p_tenant_id=>'${pending.tenant}')`,pending.other),/PORTAL_REQUEST_APPROVED_PUBLICATION_REQUIRED/);assert.equal(snapshot(),before);
 });
 check('A publisher-audit failure rolls back the customer item, notice, Work and original receipt atomically',()=>{
  sql(`CREATE FUNCTION public.proof_reject_publication() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'controlled publisher audit failure';END$$;
   CREATE TRIGGER proof_publication_audit BEFORE INSERT ON public.paige_audit_log FOR EACH ROW EXECUTE FUNCTION public.proof_reject_publication()`);
  try{const before=snapshot();assert.throws(()=>publish(pending),/controlled publisher audit failure/);assert.equal(snapshot(),before);}
  finally{sql('DROP TRIGGER proof_publication_audit ON public.paige_audit_log;DROP FUNCTION public.proof_reject_publication()');}
 });
 check('Browser cannot insert or rewrite canonical proposal evidence',()=>{
  for(const privilege of ['INSERT','UPDATE','DELETE'])assert.equal(sql(`SELECT has_table_privilege('authenticated','public.paige_pending_confirmations','${privilege}')`),'f');
 });
 check('New native executor is caller-JWT-only with the original advance ABI and grants unchanged',()=>{
  const sig='public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid)';
  assert.equal(sql(`SELECT has_function_privilege('authenticated','${sig}','EXECUTE')`),'t');
  for(const role of ['anon','service_role'])assert.equal(sql(`SELECT has_function_privilege('${role}','${sig}','EXECUTE')`),'f');
  assert.equal(metadata(),advanceMetadata);
 });
 check('Same forward migration replays without rewriting data or duplicating the original native guard',()=>{
  const before=snapshot(),definition=sql(`SELECT pg_get_functiondef('${advanceSig}'::regprocedure)`);sql(read(migrationFile));assert.equal(snapshot(),before);assert.equal(sql(`SELECT pg_get_functiondef('${advanceSig}'::regprocedure)`),definition);
 });
 const guard="\n\n  -- E09: private customer requests publish only through the original HIGH stored-call gate.\n  IF _row.action_kind = 'client.portal_recommendation' AND _next IN ('drafted','executing') THEN\n    RAISE EXCEPTION 'PORTAL_REQUEST_APPROVED_PUBLICATION_REQUIRED' USING ERRCODE='42501';\n  END IF;";
 check('Removing only the fixed-kind guard restores the entire original native advance definition',()=>{
  const definition=sql(`SELECT pg_get_functiondef('${advanceSig}'::regprocedure)`).replaceAll('\r\n','\n');assert.equal(definition.split(guard).length,2);assert.equal(definition.replace(guard,''),advanceBefore);
 });
 for(const sig of [advanceSig,'public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid)',
  'public.admin_propose_paige_actions(uuid,jsonb)','public._client_portal_access_authorize(uuid,uuid,boolean)'])check('Forward replay refuses a changed protected dependency: '+sig,()=>{
  const saved=JSON.parse(sql(`SELECT jsonb_build_object('definition',pg_get_functiondef(oid),'body',prosrc) FROM pg_proc WHERE oid='${sig}'::regprocedure`));
  sql(saved.definition.replace(saved.body,()=>saved.body+'\n-- controlled forward implementation\n'));
  const changed=sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${sig}'::regprocedure`);
  try{assert.throws(()=>sql(read(migrationFile)),/changed/);assert.equal(sql(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${sig}'::regprocedure`),changed);}
  finally{sql(saved.definition);}
 });
 check('Unrelated original record-only Work execution still uses the original advance branch',()=>{
  sql(`INSERT INTO public.paige_action_kinds(slug,label,executor,requires_approval,default_autonomy_lane,enabled)
   VALUES('proof.e09_unrelated','Unrelated native proof','record_only',false,'confirm',true)`);
  const filed=asActor(`SELECT public.file_action(p_action_kind=>'proof.e09_unrelated',p_title=>'Unrelated work',p_tenant_id=>'${pending.tenant}')`,pending.other);
  const advanced=asActor(`SELECT public.advance_action(p_action_id=>'${filed.action_id}',p_to_status=>'executing',p_tenant_id=>'${pending.tenant}')`,pending.other);
  assert.equal(advanced.status,'done');assert.equal(advanced.customer_action_id,null);
 });
 // Real concurrent psql connections within the SAME original runner/cluster.
 // Waits are observed in pg_stat_activity; no sleep-based assertion of ordering.
 const {spawn,exe,args,transcripts}=env;
 const launch=(body,name)=>{
  const child=spawn(exe('psql'),args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';
  child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>{
   transcripts.push({command:'psql-e09-publication-'+name,args,exitCode:code,stdout:out,stderr:err});
   resolve({code,out,err,results:out.split(/\r?\n/).filter(v=>v.startsWith('{')).map(v=>JSON.parse(v))});
  });});
  child.stdin.write(`SET application_name='e09_publication_${name}';SET statement_timeout='12s';${body}\n`);return {child,done};
 };
 const waitFor=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error('Publication proof did not observe its required native lock');};
 const idle=name=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='e09_publication_${name}' AND state='idle in transaction'`)==='1';
 const blocked=name=>sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='e09_publication_${name}' AND wait_event_type='Lock'`)==='1';
 const asRequest=(x,o={})=>`BEGIN;SELECT set_config('test.actor','${x.other}',true);SET LOCAL ROLE authenticated;${statement(x,o)};COMMIT;`;
 const concurrent=prepare(),countsBefore=JSON.parse(customerSnapshot());
 const holder=launch(`BEGIN;SELECT 1 FROM public.profiles WHERE user_id='${concurrent.other}' FOR UPDATE;`,'duplicate_holder');let one,two,waits=0;
 try{
  await waitFor(()=>idle('duplicate_holder'));
  one=launch(asRequest(concurrent),'duplicate_one');one.child.stdin.end();
  two=launch(asRequest(concurrent),'duplicate_two');two.child.stdin.end();
  await waitFor(()=>blocked('duplicate_one')&&blocked('duplicate_two'));waits+=2;
 }finally{holder.child.stdin.end('COMMIT;\n');await holder.done;}
 const duplicates=await Promise.all([one.done,two.done]);
 check('Concurrent identical approved claims wait and commit one original customer item/notice',()=>{
  duplicates.forEach(r=>assert.equal(r.code,0,r.err));const [a,b]=duplicates.map(r=>r.results.at(-1));
  assert.equal(a.customer_action_id,b.customer_action_id);assert.notEqual(a.replayed,b.replayed);
  const after=JSON.parse(customerSnapshot());assert.equal(after.actions,countsBefore.actions+1);assert.equal(after.notices,countsBefore.notices+1);
 });
 for(const [name,mutation]of [
  ['consent',x=>`UPDATE public.clients SET paige_shared_context_consent=false WHERE id='${x.contact}'`],
  ['membership',x=>`UPDATE public.tenant_members SET status='inactive' WHERE user_id='${x.other}' AND tenant_id='${x.tenant}'`],
  ['expiry',x=>`UPDATE public.paige_pending_confirmations SET expires_at=consumed_at+interval '1 microsecond' WHERE id='${x.invite}'`],
  ['recipient',x=>`UPDATE public.clients SET linked_user_id=NULL WHERE id='${x.contact}'`]
 ]){
  const x=prepare();const beforeCustomer=customerSnapshot(),auditBefore=sql('SELECT count(*) FROM public.audit_logs');
  const lock=launch(`BEGIN;SELECT 1 FROM public.clients WHERE id='${x.contact}' FOR UPDATE;`,'change_holder_'+name);let request;
  try{
   await waitFor(()=>idle('change_holder_'+name));request=launch(asRequest(x),'change_'+name);request.child.stdin.end();
   await waitFor(()=>blocked('change_'+name));waits++;
   // The lock owner performs contact changes; a second session may revoke
   // membership/expiry while the first is blocked at the original contact.
   if(name==='consent'||name==='recipient')lock.child.stdin.write(mutation(x)+';\n');else sql(mutation(x));
  }finally{lock.child.stdin.end('COMMIT;\n');await lock.done;}
  const result=await request.done;
  check('A real contact-lock wait revalidates changed '+name+' before any publication',()=>{
   assert.notEqual(result.code,0);assert.match(result.err,/PORTAL_REQUEST_(NOT_AUTHORIZED|APPROVAL_UNAVAILABLE)|PORTAL_ACCESS_NOT_AUTHORIZED/);
   assert.equal(customerSnapshot(),beforeCustomer);assert.equal(sql('SELECT count(*) FROM public.audit_logs'),auditBefore);
   assert.equal(sql(`SELECT status FROM public.paige_actions WHERE id='${x.request.work_id}'`),'assigned');
  });
 }
 check('Native publication proof actually observed every required concurrency wait',()=>assert.equal(waits,6));
 const responding=prepare(),shared=publish(responding);
 const responseVersion=sql(`SELECT updated_at FROM public.paige_customer_actions WHERE id='${shared.customer_action_id}'`);
 const responder=launch(`BEGIN;SELECT 1 FROM public.paige_customer_actions WHERE id='${shared.customer_action_id}' FOR UPDATE;`,'response_holder');
 let replay,replayFinished=false,replayWaited=false;
 try{
  await waitFor(()=>idle('response_holder'));replay=launch(asRequest(responding),'response_replay');replay.child.stdin.end();
  replay.done.then(()=>{replayFinished=true;});
  await waitFor(()=>replayFinished||blocked('response_replay'));replayWaited=!replayFinished;
  responder.child.stdin.end(`SELECT set_config('test.actor','${responding.actor}',true);SET LOCAL ROLE authenticated;
   SELECT public.customer_respond_to_action('${shared.customer_action_id}','completed',NULL,${lit(responseVersion)}::timestamptz);COMMIT;\n`);
 }catch(error){responder.child.stdin.end('ROLLBACK;\n');throw error;}
 const [responseRace,replayRace]=await Promise.all([responder.done,replay.done]);
 check('Customer completion and historical owner reconciliation preserve the original lock order without deadlock',()=>{
  assert.equal(responseRace.code,0,responseRace.err);assert.equal(replayRace.code,0,replayRace.err);
  assert.equal(replayRace.results.at(-1).customer_action_id,shared.customer_action_id);assert.equal(responseRace.results.at(-1).ok,true);
  assert.equal(sql(`SELECT count(*) FROM public.paige_customer_responses WHERE action_id='${shared.customer_action_id}'`),'1');
 });
 return {migration: migrationFile,advanceBeforeSHA256:createHash('sha256').update(advanceBefore).digest('hex'),
  originalPublisher:setup.publisherHash,outerApproval:'SYNTHETIC_TRUSTED_ISSUER_AND_AUTONOMY_PORT; NOT_REAL_CHAT_APPROVAL',
  observedLockWaits:waits,responseReplayWaited:replayWaited,authenticatedCustomer:'NOT_RUN',productionOperation:false,
  sourceFingerprints:JSON.parse(sql(`SELECT jsonb_object_agg(proname,md5(prosrc)) FROM pg_proc WHERE oid IN('${advanceSig}'::regprocedure,'public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure)`))};
}

async function privateHistoryProof({sql,check,assert,fixture,f,first,invoke,asActor,snapshot,customerSnapshot,historyBaseline,launch,waitFor,locked}) {
 const lit=x=>x===null?'NULL':`'${String(x).replaceAll("'","''")}'`;
 const history=(options={})=>{
  const x={actor:f.other,expected:f.other,tenant:f.tenant,contact:f.contact,beforeTime:null,beforeId:null,role:'authenticated',...options};
  return asActor(`SELECT public.list_client_portal_request_drafts(${lit(x.expected)},${lit(x.tenant)},${lit(x.contact)},${lit(x.beforeTime)},${lit(x.beforeId)})`,x.actor,x.role);
 };
 const start=snapshot(),customerBefore=customerSnapshot();let sample;
 check('Returning owner discovers original private requests without a browser-stored intent',()=>{
  sample=history();assert.equal(sample.schema_version,1);assert.equal(sample.actor_id,f.other);assert.equal(sample.tenant_id,f.tenant);assert.equal(sample.contact_id,f.contact);
  assert.equal(sample.missing_is_rejection,false);assert(sample.requests.some(x=>x.request.work_id===first.request.work_id&&x.intent_id==='e09df000-0000-4000-8000-000000000001'));
  assert(!JSON.stringify(sample).includes('HIDDEN_SENTINEL'));assert.equal(snapshot(),start);
 });
 if(historyBaseline||!sample)return;
 check('History API keeps the same authenticated-only empty-path native contract',()=>{
  const r=JSON.parse(sql("SELECT jsonb_build_object('auth',has_function_privilege('authenticated','public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE'),'anon',has_function_privilege('anon','public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE'),'service',has_function_privilege('service_role','public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE'),'config',(SELECT proconfig FROM pg_proc WHERE oid='public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid)'::regprocedure))"));
  assert.equal(r.auth,true);assert.equal(r.anon,false);assert.equal(r.service,false);assert.deepEqual(r.config,['search_path=""']);
 });
 for(const [name,options]of[
  ['wrong actor',{expected:f.actor}],['missing actor',{expected:null}],['wrong business',{tenant:f.foreign}],
  ['customer identity',{actor:f.actor,expected:f.actor}],['service',{role:'service_role'}],['anonymous',{role:'anon',actor:null}],
  ['partial time cursor',{beforeTime:'2026-10-25T10:00:00Z'}],['partial ID cursor',{beforeId:first.request.work_id}],
  ['infinite cursor',{beforeTime:'infinity',beforeId:first.request.work_id}]
 ])check('Private Work history refuses '+name+' without effects',()=>{const before=snapshot();assert.throws(()=>history(options));assert.equal(snapshot(),before);});
 check('Private Work history cannot widen missing original Work standing',()=>{
  sql(`DELETE FROM public.user_roles WHERE user_id='${f.other}'`);try{assert.throws(history);}finally{sql(`INSERT INTO public.user_roles(user_id,role)VALUES('${f.other}','admin')`);}
 });
 check('Malformed original intent metadata fails closed instead of inventing a replacement identity',()=>{
  sql(`UPDATE public.paige_actions SET payload=jsonb_set(payload,'{client_portal_private_request,intent_id}','"invalid-intent"') WHERE id='${first.request.work_id}'`);
  try{assert.throws(history,/PORTAL_REQUEST_SOURCE_CHANGED/);}finally{sql(`UPDATE public.paige_actions SET payload=jsonb_set(payload,'{client_portal_private_request,intent_id}','"e09df000-0000-4000-8000-000000000001"') WHERE id='${first.request.work_id}'`);}
 });
 check('History uses the original changed-content projection rather than showing old prepared words',()=>{
  sql(`UPDATE public.paige_actions SET draft_content='{"body":"Changed elsewhere"}',status='drafted' WHERE id='${first.request.work_id}'`);
  try{const x=history().requests.find(x=>x.request.work_id===first.request.work_id);assert(x);assert.equal(x.request.content_state,'changed');assert.equal(x.request.body,null);assert.equal(x.request.title,null);}
  finally{sql(`UPDATE public.paige_actions SET draft_content=NULL,status='assigned' WHERE id='${first.request.work_id}'`);}
 });
 const concurrentIntent='e09df000-0000-4000-8000-000000000040';
 const pending=launch(`BEGIN;SELECT set_config('test.actor','${f.other}',true);SET LOCAL ROLE authenticated;
  SELECT public.prepare_client_portal_request('${f.other}','${f.tenant}','${f.contact}','${concurrentIntent}','Review the guide','Read it.');`,'history_prepare');
 let waiting;
 try{
  await waitFor(()=>sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='e09_private_history_prepare' AND state='idle in transaction'")==='1');
  waiting=launch(`BEGIN;SELECT set_config('test.actor','${f.other}',true);SET LOCAL ROLE authenticated;
   SELECT public.list_client_portal_request_drafts('${f.other}','${f.tenant}','${f.contact}');COMMIT;`,'history_wait');waiting.child.stdin.end();
  await waitFor(()=>locked('history_wait'));
 }finally{pending.child.stdin.end('COMMIT;\n');}
 const prepared=await pending.done,listed=await waiting.done;
 check('Reload history waits for the original pending preparation and reads its committed Work once',()=>{
  assert.equal(prepared.code,0,prepared.err);assert.equal(listed.code,0,listed.err);
  const row=prepared.result.at(-1),matches=listed.result.at(-1).requests.filter(x=>x.intent_id===concurrentIntent);
  assert.equal(matches.length,1);assert.equal(matches[0].request.work_id,row.request.work_id);
 });
 const beforeRevocation=snapshot();
 const holder=launch(`BEGIN;SELECT 1 FROM public.clients WHERE id='${f.contact}' FOR UPDATE;`,'history_contact');
 let revoked;
 try{
  await waitFor(()=>sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='e09_private_history_contact' AND state='idle in transaction'")==='1');
  revoked=launch(`BEGIN;SELECT set_config('test.actor','${f.other}',true);SET LOCAL ROLE authenticated;
   SELECT public.list_client_portal_request_drafts('${f.other}','${f.tenant}','${f.contact}');COMMIT;`,'history_revoked');revoked.child.stdin.end();
  await waitFor(()=>locked('history_revoked'));
  sql(`UPDATE public.tenant_members SET status='inactive' WHERE tenant_id='${f.tenant}' AND user_id='${f.other}'`);
 }finally{holder.child.stdin.end('COMMIT;\n');await holder.done;}
 const refused=await revoked.done;
 check('History rechecks revoked membership after waiting before returning any private page',()=>{
  assert.notEqual(refused.code,0);assert.equal(refused.result.length,0);assert.equal(snapshot(),beforeRevocation);
 });
 sql(`UPDATE public.tenant_members SET status='active' WHERE tenant_id='${f.tenant}' AND user_id='${f.other}'`);
 const h=fixture();
 sql(`INSERT INTO public.profiles(user_id,active_tenant_id)VALUES('${h.other}','${h.tenant}');
  INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner)VALUES('${h.tenant}','${h.other}','owner','active',true);
  INSERT INTO public.user_roles(user_id,role)VALUES('${h.other}','admin')`);
 const selected={actor:h.other,expected:h.other,tenant:h.tenant,contact:h.contact};
 check('A new legitimate owner scope has empty history without implying a rejected request',()=>{
  const r=history(selected);assert.deepEqual(r.requests,[]);assert.equal(r.more,false);assert.equal(r.next_cursor,null);assert.equal(r.missing_is_rejection,false);
 });
 check('Foreign CRM record is refused by the history reader even when a real Work ID is known',()=>assert.throws(()=>history({contact:h.contact,beforeTime:'2026-10-25T10:00:00Z',beforeId:first.request.work_id})));
 const made=[];for(let i=1;i<=21;i++)made.push(invoke({...selected,intent:`e09df100-0000-4000-8000-${String(i).padStart(12,'0')}`}));
 sql(`UPDATE public.paige_actions SET created_at='2026-10-25T10:00:00.123456Z' WHERE tenant_id='${h.tenant}' AND created_by='${h.other}'`);
 check('Original Work keyset pages preserve all tied timestamps and IDs once, without browser state',()=>{
  const firstPage=history(selected);assert.equal(firstPage.requests.length,20);assert.equal(firstPage.more,true);
  assert.equal(firstPage.next_cursor.created_at,firstPage.requests.at(-1).request.created_at);
  assert.match(firstPage.next_cursor.created_at,/\.123456(?:Z|[+-])/);
  assert.equal(Date.parse(firstPage.next_cursor.created_at),Date.parse('2026-10-25T10:00:00.123456Z'));
  const second=history({...selected,beforeTime:firstPage.next_cursor.created_at,beforeId:firstPage.next_cursor.work_id});
  assert.equal(second.requests.length,1);assert.equal(second.more,false);assert.equal(second.next_cursor,null);
  const ids=[...firstPage.requests,...second.requests].map(x=>x.request.work_id);assert.equal(new Set(ids).size,21);
  assert.deepEqual([...ids].sort(),made.map(x=>x.request.work_id).sort());
 });
 check('History cursor is a filter, never authority to view another actor or business',()=>{
  const other=history({...selected,beforeTime:'2099-01-01',beforeId:first.request.work_id});assert.equal(other.requests.length,20);
  assert(!JSON.stringify(other).includes(first.request.work_id));assert(other.requests.every(x=>made.some(y=>y.request.work_id===x.request.work_id)));
 });
 check('Returning history and pagination never create customer actions, notices, approvals or responses',()=>assert.equal(customerSnapshot(),customerBefore));
}
