// One additional mode of the original fenced E09 runner. Original native Action
// Bus bodies execute; local Auth/role/autonomy and nonexecuted graph are ports.
// Full-schema customer_portal_access.sql remains the normative role/trigger proof.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
export async function privateRequestProof({sql,check,assert,fs,root,path,fixture,baseline,historyBaseline=false,spawn,exe,args,transcripts}) {
 const read=file=>fs.readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
 const nativeMigration=historyBaseline
  ?execFileSync('git',['show','ba786f11b52c71b4ed87e7eb7a022b5aaa376e18:supabase/migrations/20271114150009_e09_private_request_preparation.sql'],{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n')
  :read('supabase/migrations/20271114150009_e09_private_request_preparation.sql');
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
 return {baseline,historyBaseline,baselineSource:historyBaseline?'ba786f11b52c71b4ed87e7eb7a022b5aaa376e18':null,originalFingerprints:before,canonicalReplayFileHash:replayFileHash,
  migration:'20271114150009_e09_private_request_preparation.sql',
  migrationNormalizedSHA256:createHash('sha256').update(nativeMigration).digest('hex'),
  fixture:'synthetic Auth/role/autonomy/graph ports; original native writers, canonical role retirement, recorded CRLF transport and owner authority',customerPublication:'NOT_RUN',fullSchema:'PROOF_OWED'};
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
