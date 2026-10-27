// Extends the ORIGINAL disposable Work/heartbeat/finalizer proof. No runner,
// remote database, customer identity, new authority or replacement test engine.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export async function proveManualSystemsObservation({fixture,ids,read,create,sourceRun,finding,finish}) {
 const key='public.read_paige_durable_observation(uuid,uuid,uuid)',cases=[];
 const migration=read('supabase/migrations/20271118100002_e02_manual_systems_observation.sql');
 const check=(name,fn)=>{fn();cases.push(name);};
 const value=(sql,params=[])=>fixture.run(sql,params).replaceAll('\r\n','\n');
 const metadata=()=>value(`SELECT (to_jsonb(p)-'prosrc')::text FROM pg_proc p WHERE oid='${key}'::regprocedure`);
 const body=()=>value(`SELECT prosrc FROM pg_proc WHERE oid='${key}'::regprocedure`);
 fixture.run(`CREATE FUNCTION auth.role()RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 ALTER TABLE public.paige_chat_threads ADD COLUMN interactive_latest_intent uuid;
 ALTER TABLE public.paige_chat_turns ADD COLUMN thread_id uuid,ADD COLUMN role text,
  ADD COLUMN interactive_intent_id uuid,ADD COLUMN interactive_actor_id uuid,
  ADD COLUMN interactive_tenant_id uuid,ADD COLUMN interactive_terminal_state text,ADD COLUMN bundle_ref jsonb;
 CREATE FUNCTION public.has_tenant_role(a uuid,t uuid,r text)RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT exists(select 1 from public.tenant_members where user_id=a and tenant_id=t and role=r and status='active')$$;`);
 // The older heartbeat fixture predates the canonical Knowledge getter. Receive
 // its ACTUAL definition first, just as the original Work-read proof does.
 const knowledge=read('supabase/migrations/20270531600000_knowledge_durable_authority.sql');
 const getter=knowledge.indexOf('create or replace function public.get_paige_durable_work(');assert.ok(getter>0);
 fixture.run(knowledge.slice(getter));
 fixture.run(read('supabase/migrations/20271114250102_e02_manual_systems_work_read.sql'));
 fixture.run(read('supabase/migrations/20270601000014_int304_durable_observation.sql'));
 fixture.run(read('supabase/migrations/20271113430002_exp02_metric_report_artifact_scope.sql').split('CREATE POLICY')[0].replace(/^BEGIN;\r?\n/m,''));
 fixture.run(read('supabase/migrations/20271117140002_exp02_report_observation.sql'));
 const originalMetadata=metadata(),originalBody=body();
 const intent=randomUUID(),work=create();
 fixture.run('UPDATE public.paige_chat_threads SET interactive_latest_intent=$1 WHERE id=$2',[intent,ids.thread]);
 const effects=[{tool:'systems.check',outcome:'durable_accepted',work_id:work.id}];
 const turn=randomUUID();
 fixture.run(`INSERT INTO public.paige_chat_turns(id,thread_id,role,interactive_intent_id,interactive_actor_id,interactive_tenant_id,interactive_terminal_state,bundle_ref)
 VALUES($1,$2,'assistant',$3,$4,$5,'WAIT_WORK',$6::jsonb)`,[turn,ids.thread,intent,ids.actor,ids.tenant,JSON.stringify({interactive:{effects}})]);
 const observe=(actor=ids.actor,role='authenticated')=>{
  const prior=[fixture.actor,fixture.role];fixture.actor=actor??'';fixture.role=role;
  try {const out=fixture.run(`SELECT set_config('request.jwt.claim.role',$1,false);SELECT coalesce(public.read_paige_durable_observation($2,$3,$4)::text,'null')`,[role,ids.thread,intent,work.id]);return JSON.parse(out.split(/\r?\n/).find(s=>s==='null'||s.startsWith('{')));}finally{[fixture.actor,fixture.role]=prior;}
 };
 check('causal original observer refuses the otherwise authorized accepted manual Work',()=>assert.equal(observe(),null));
 const otherFunctions=()=>value(`SELECT md5(jsonb_agg(to_jsonb(p)ORDER BY p.oid)::text)FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.oid<>'${key}'::regprocedure`);
 const originalOthers=otherFunctions();fixture.run(migration);
 check('same original OID, full ABI/owner/ACL/config/planner metadata',()=>assert.equal(metadata(),originalMetadata));
 check('every other public function including original Work permission reader stays exact',()=>assert.equal(otherFunctions(),originalOthers));
 const changedBody=body();
 check('entire original source is retained outside five reviewed purpose-specific fragments',()=>{
  const fragments=[...migration.matchAll(/\$a\$([\s\S]*?)\$a\$/g)].map(m=>m[1]);assert.equal(fragments.length,10);
  let restored=changedBody;for(let i=4;i>=0;i--){assert.equal(restored.split(fragments[i+5]).length,2);restored=restored.replace(fragments[i+5],fragments[i]);}assert.equal(restored,originalBody);
 });
 check('prepared/claimed is observed without scan or completion inference',()=>assert.deepEqual([observe().state,observe().artifactVerified,observe().artifactRef,observe().receiptVerified,observe().receiptRef],['claimed',false,null,false,null]));
 check('exact original migration replay preserves metadata and source',()=>{fixture.run(migration);assert.equal(metadata(),originalMetadata);assert.equal(body(),changedBody);});
 finding(sourceRun(work));finish(work);
 const completed=observe(),receipt=value('SELECT id FROM public.paige_workspace_events WHERE source_id=$1',[work.id]);
 check('actual original finalizer/run/Rail identity verifies, never a document artifact',()=>{
  assert.deepEqual([completed.state,completed.observationKind,completed.receiptVerified,completed.receiptRef,completed.artifactVerified,completed.artifactRef],['succeeded','systems_check',true,receipt,false,null]);
  assert.equal(completed.workIntentId,work.intent_id);assert.equal(completed.intentId,intent);
  assert.doesNotMatch(JSON.stringify(completed),/request_payload|terminal_outcome|detail|idempotency|eligibleForExecution/);
 });
 const snapshot=()=>value(`SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(w)ORDER BY id)FROM public.paige_durable_work w),(SELECT jsonb_agg(to_jsonb(e)ORDER BY id)FROM public.paige_workspace_events e),(SELECT jsonb_agg(to_jsonb(r)ORDER BY id)FROM public.paige_systems_check_run r))::text`);
 const saved=snapshot();
 check('repeat observation is stable and writes/dispatches/replays nothing',()=>{assert.deepEqual(observe(),completed);assert.equal(snapshot(),saved);});
 const change=(table,column,next,keyColumn,keyValue,previous,fn)=>{fixture.run(`UPDATE ${table} SET ${column}=$1 WHERE ${keyColumn}=$2`,[next,keyValue]);try{fn();}finally{fixture.run(`UPDATE ${table} SET ${column}=$1 WHERE ${keyColumn}=$2`,[previous,keyValue]);}};
 for(const status of ['trial','past_due'])change('public.tenants','status',status,'id',ids.tenant,'active',()=>check('original '+status+' manual Work eligibility is retained',()=>assert.equal(observe()?.receiptVerified,true)));
 const originalWork=value('SELECT row_to_json(w)::text FROM public.paige_durable_work w WHERE id=$1',[work.id]);
 for(const state of ['claimed','blocked','failed','cancelled','expired','outcome_unknown']){
  // Perturb the entire valid state tuple atomically; retain the original native
  // outcome/settlement/blocked/lease constraints rather than disabling them.
  fixture.run(`UPDATE public.paige_durable_work SET status=$1,
   blocked_reason=case when $1='blocked' then 'Original source needs review' else null end,
   terminal_outcome=case when $1 in('failed','cancelled')then '{"reason":"recorded fixture state"}'::jsonb else null end,
   settled_at=case when $1 in('failed','cancelled')then clock_timestamp()else null end,
   lease_until=case when $1='claimed'then claimed_at+interval '5 minutes' else null end WHERE id=$2`,[state,work.id]);
  try{check(state+' cannot borrow an earlier completion receipt',()=>{const r=observe();assert.equal(r.state,state);assert.equal(r.receiptVerified,false);assert.equal(r.receiptRef,null);assert.equal(r.recoveryState,['expired','outcome_unknown'].includes(state)?'reconciliation_required':'observed');});}
  finally{fixture.run(`UPDATE public.paige_durable_work w SET(status,blocked_reason,terminal_outcome,settled_at,lease_until)=
   (select x.status,x.blocked_reason,x.terminal_outcome,x.settled_at,x.lease_until from jsonb_populate_record(NULL::public.paige_durable_work,$1::jsonb)x)WHERE w.id=$2`,[originalWork,work.id]);}
 }
 for(const [name,table,column,next,keyColumn,keyValue,previous]of[
  ['foreign run','public.paige_systems_check_run','tenant_id',ids.other,'id',work.id,ids.tenant],
  ['detached run','public.paige_systems_check_run','work_id',null,'id',work.id,work.id],
  ['wrong receipt source','public.paige_workspace_events','source_id',randomUUID(),'id',receipt,work.id],
  ['wrong receipt actor','public.paige_workspace_events','actor_id',ids.admin,'id',receipt,ids.actor],
  ['wrong receipt revision','public.paige_workspace_events','source_revision',1,'id',receipt,0],
  ['wrong run totals','public.paige_systems_check_run','check_count',2,'id',work.id,1],
 ])change(table,column,next,keyColumn,keyValue,previous,()=>check(name+' withdraws completion proof',()=>{const r=observe();assert.equal(r.receiptVerified,false);assert.equal(r.receiptRef,null);assert.equal(r.recoveryState,'terminal_unverified');}));
 const detail=JSON.parse(value('SELECT detail::text FROM public.paige_workspace_events WHERE id=$1',[receipt]));
 change('public.paige_workspace_events','detail',JSON.stringify({...detail,check_count:2}),'id',receipt,JSON.stringify(detail),()=>check('changed original receipt detail cannot verify',()=>assert.equal(observe().receiptVerified,false)));
 for(const [name,table,column,next,keyColumn,keyValue,previous]of[
  ['selected tenant','public.profiles','active_tenant_id',ids.other,'user_id',ids.actor,ids.tenant],
  ['banned actor','auth.users','banned_until','2099-01-01','id',ids.actor,null],
  ['deleted actor','auth.users','deleted_at','2099-01-01','id',ids.actor,null],
  ['current role','public.tenant_members','role','member','user_id',ids.actor,'owner'],
  ['membership','public.tenant_members','status','inactive','user_id',ids.actor,'active'],
  ['SOLO boundary','public.tenants','account_type','agency','id',ids.tenant,'standalone'],
  ['parent boundary','public.tenants','parent_tenant_id',ids.other,'id',ids.tenant,null],
  ['ineligible tenant status','public.tenants','status','inactive','id',ids.tenant,'active'],
  ['latest intent','public.paige_chat_threads','interactive_latest_intent',randomUUID(),'id',ids.thread,intent],
  ['thread archival','public.paige_chat_threads','is_archived',true,'id',ids.thread,false],
  ['client audience','public.paige_chat_threads','audience','client','id',ids.thread,'workspace'],
 ])change(table,column,next,keyColumn,keyValue,previous,()=>check(name+' withdraws the original observation',()=>assert.equal(observe(),null)));
 check('another current Admin cannot inherit the private initiating conversation',()=>assert.equal(observe(ids.admin),null));
 check('missing actor is denied even with original receipt present',()=>assert.equal(observe(null),null));
 for(const role of ['anon','service_role'])check(role+' cannot execute the authenticated observer',()=>assert.throws(()=>observe(ids.actor,role),e=>e.code==='42501'));
 for(const [name,mutated]of[
  ['missing original accepted effect',[]],
  ['duplicate original accepted effect',[...effects,...effects]],
  ['foreign tool',[{...effects[0],tool:'document_generate'}]],
  ['unknown original outcome',[{...effects[0],outcome:'outcome_unknown'}]],
 ])change('public.paige_chat_turns','bundle_ref',JSON.stringify({interactive:{effects:mutated}}),'id',turn,JSON.stringify({interactive:{effects}}),()=>check(name+' cannot bind Work',()=>assert.equal(observe(),null)));
 check('raw Rail remains unavailable to authenticated callers',()=>{const prior=fixture.role;fixture.role='authenticated';try{assert.throws(()=>fixture.run('SELECT *FROM public.paige_workspace_events'),e=>e.code==='42501');}finally{fixture.role=prior;}});
 const definition=value(`SELECT pg_get_functiondef('${key}'::regprocedure)`),getterDefinition=value("SELECT pg_get_functiondef('public.get_paige_durable_work(uuid)'::regprocedure)");
 check('unreviewed observer source drift refuses without replacement',()=>{
  fixture.run(definition.replace('\nbegin\n','\nbegin\n -- fixture source drift\n'));const drift=body();
  try{assert.throws(()=>fixture.run(migration),e=>e.code==='P0001');assert.equal(body(),drift);}finally{fixture.run(definition);}
 });
 check('Work permission source drift refuses without replacing observation',()=>{
  fixture.run(getterDefinition.replace('where w.id = _work_id','where w.id = _work_id /* fixture source drift */'));
  try{assert.throws(()=>fixture.run(migration),e=>e.code==='P0001');assert.equal(body(),changedBody);}finally{fixture.run(getterDefinition);}
 });
 check('an expanded observer ACL refuses and the original ACL is restored',()=>{
  fixture.run(`GRANT EXECUTE ON FUNCTION ${key} TO anon`);
  try{assert.throws(()=>fixture.run(migration),e=>e.code==='P0001');assert.equal(body(),changedBody);}finally{fixture.run(`REVOKE EXECUTE ON FUNCTION ${key} FROM anon`);}
 });
 check('final source and original metadata remain exact',()=>{assert.equal(body(),changedBody);assert.equal(metadata(),originalMetadata);assert.equal(snapshot(),saved);});
 // Run the SAME unchanged legacy Document/Research cases against the native
 // definition produced by the guarded migration, in a separate empty database.
 const candidate=new URL('../../outputs/e2-manual-observation-candidate.sql',import.meta.url),database='int336_test_e2_manual_'+randomUUID().replaceAll('-','');
 // pg_get_functiondef is a definition, not necessarily a terminated command.
 writeFileSync(candidate,value(`SELECT pg_get_functiondef('${key}'::regprocedure)`).trimEnd()+';\n');
 console.log(JSON.stringify({manualObservationNativeCases:cases.length,legacyNativeCompatibility:'PENDING',customerAcceptance:false}));
 fixture.run('CREATE DATABASE '+database,[],'postgres');
 try {
  const p=spawnSync(process.execPath,[fileURLToPath(new URL('../int304-durable-observation-check.mjs',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:60000,env:{...process.env,PSQL_BIN:fixture.psql,INT336_DATABASE_URL:`postgresql://postgres@127.0.0.1:${fixture.port}/${database}`,E2_OBSERVATION_CANDIDATE:'manual'},maxBuffer:2000000});
  if(p.error)throw p.error;assert.equal(p.status,0,(p.stderr??'').slice(-2200));
  const legacy=(p.stdout??'').split(/\r?\n/).filter(s=>s.includes('OBSERVATION_PROOF'));
  assert.equal(legacy.length,34);console.log('PASS unchanged legacy Document/Research native cases: '+legacy.length);
 }finally{unlinkSync(candidate);fixture.run('DROP DATABASE '+database+' WITH (FORCE)',[],'postgres');}
 console.log(JSON.stringify({manualObservationNativeCases:cases.length,legacyNativeCases:34,originalFunctionMetadataUnchanged:true,originalWorkAndRailWritersUsed:true,controlledSurroundingAuth:true,fullSchemaAndAuthenticatedCustomerAcceptance:false,workerScanProviderOrExecutionActivation:false}));
 return {cases:cases.length,originalBody,changedBody};
}
