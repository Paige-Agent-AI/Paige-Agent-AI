// Original Work projection, real PostgreSQL roles and current Metric authority.
// Disposable fixture only; modeled surrounding Auth/Operator helpers are not
// authenticated customer or production Operator acceptance.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {OperatorPostgresFixture} from './operator-postgres-fixture.mjs';
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Explicit disposable loopback PostgreSQL port required');
const root=new URL('../../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
const migration=read('supabase/migrations/20271114250102_e02_manual_systems_work_read.sql');
const knowledge=read('supabase/migrations/20270531600000_knowledge_durable_authority.sql');
const marker='create or replace function public.get_paige_durable_work(';
const original=knowledge.slice(knowledge.indexOf(marker));
const originalDefinition=original.slice(0,original.indexOf('$$;')+3);
const definition=migration.slice(migration.indexOf(marker),migration.lastIndexOf('$$;')+3);
const branchStart="case when w.work_kind='systems_check' or w.capability_key='systems.check' then";
const branchEnd="when w.work_kind in ('knowledge_extract','knowledge_publish') then";
const from=definition.indexOf(branchStart),to=definition.indexOf(branchEnd,from);
assert.ok(from>0&&to>from);
assert.equal(definition.slice(0,from)+'case '+definition.slice(to),originalDefinition);
assert.equal(/\b(grant|revoke|create\s+table|create\s+trigger)\b/i.test(migration.replace(/^--.*$/gm,'')),false);
const body=definition.slice(definition.indexOf('$$')+2,definition.lastIndexOf('$$'));
const bodyMd5=createHash('md5').update(body).digest('hex');assert.ok(migration.includes("'"+bodyMd5+"'"));
const fixture=new OperatorPostgresFixture(port),ids=Object.fromEntries(['actor','admin','member','outsider','operator','tenant','other'].map(k=>[k,randomUUID()]));
const key='public.get_paige_durable_work(uuid)',cases=[];
const decode=s=>JSON.parse(s.split(/\r?\n/).find(x=>x.startsWith('{')||x.startsWith('[')));
const check=(name,fn)=>{fn();cases.push(name);};
const as=(actor,role,sql,args=[])=>{const prior=[fixture.actor,fixture.role];fixture.actor=actor??'';fixture.role=role;try{return fixture.run(sql,args);}finally{[fixture.actor,fixture.role]=prior;}};
const visible=(actor=ids.actor,id=ids.work)=>Number(as(actor,'authenticated','SELECT count(*) FROM public.get_paige_durable_work($1)',[id]).split(/\r?\n/).at(-1));
const snapshot=()=>fixture.run('SELECT jsonb_agg(to_jsonb(w)ORDER BY id)::text FROM public.paige_durable_work w');
const metadata=()=>fixture.run(`SELECT (to_jsonb(p)-'prosrc'-'prosqlbody')::text FROM pg_proc p WHERE oid='${key}'::regprocedure`);
function changed(table,column,value,keyColumn,keyValue,restore,fn){
 fixture.run(`UPDATE ${table} SET ${column}=$1 WHERE ${keyColumn}=$2`,[value,keyValue]);
 try{fn();}finally{fixture.run(`UPDATE ${table} SET ${column}=$1 WHERE ${keyColumn}=$2`,[restore,keyValue]);}
}
function causal(){
 const results=[visible()===1];
 for(const [t,c,v,k,id,restore]of [
  ['public.profiles','active_tenant_id',ids.other,'user_id',ids.actor,ids.tenant],
  ['auth.users','banned_until','2099-01-01','id',ids.actor,null],
  ['auth.users','deleted_at','2099-01-01','id',ids.actor,null],
  ['public.tenants','account_type','agency','id',ids.tenant,'standalone'],
  ['public.tenants','parent_tenant_id',ids.other,'id',ids.tenant,null],
 ])changed(t,c,v,k,id,restore,()=>results.push(visible()===0));
 changed('public.tenant_members','status','inactive','user_id',ids.actor,'active',()=>results.push(visible()===0));
 results.push(snapshot()===saved);return results;
}
let saved;
try{
 assert.deepEqual(fixture.args(),['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d',fixture.database,'-A','-t','-v','ON_ERROR_STOP=1']);
 assert.equal(fixture.run('SELECT current_database()=$1',[fixture.database]),'t');
 if(port===5432){assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(fixture.run("SELECT current_setting('port')='5432' AND inet_server_addr() IS NOT NULL"),'t');}
 else assert.equal(fixture.run("SELECT inet_server_addr()='127.0.0.1'::inet"),'t');
 fixture.run(`CREATE EXTENSION pgcrypto;
 DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon')THEN CREATE ROLE anon NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')THEN CREATE ROLE authenticated NOLOGIN;END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role')THEN CREATE ROLE service_role NOLOGIN BYPASSRLS;END IF;END$$;
 CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz,deleted_at timestamptz);
 CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
 CREATE TABLE public.tenants(id uuid PRIMARY KEY,status text,account_type text,parent_tenant_id uuid);
 CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role text,status text,is_owner boolean DEFAULT false,PRIMARY KEY(tenant_id,user_id));
 CREATE TABLE public.paige_chat_threads(id uuid PRIMARY KEY,tenant_id uuid,caller_user_id uuid,audience text,is_archived boolean DEFAULT false);
 CREATE FUNCTION auth.uid()RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
 CREATE FUNCTION public.current_user_tenant_id()RETURNS uuid LANGUAGE sql STABLE AS $$SELECT active_tenant_id FROM public.profiles WHERE user_id=auth.uid()$$;
 -- Controlled incumbent helper boundary. Never represents actual Operator access.
 CREATE FUNCTION public.is_platform_owner()RETURNS boolean LANGUAGE sql STABLE AS $$SELECT current_setting('test.operator',true)='on'$$;
 CREATE FUNCTION public.is_platform_owner(uuid)RETURNS boolean LANGUAGE sql STABLE AS $$SELECT current_setting('test.operator',true)='on'$$;
 CREATE FUNCTION public.is_tenant_admin_as(uuid,uuid)RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$;
 CREATE TABLE public.marketing_content(id uuid PRIMARY KEY);CREATE TABLE public.paige_chat_turns(id uuid PRIMARY KEY);`);
 for(const t of ['paige_workflow_runs','paige_skill_runs','business_verification_runs','security_canary_runs','paige_readiness_scan_runs','research_runs','paige_eval_run','paige_systems_check_run','paige_authority_act_runs','paige_media_jobs','paige_social_jobs','paige_act_executions'])fixture.run(`CREATE TABLE public.${t}(id uuid PRIMARY KEY)`);
 fixture.run(read('supabase/migrations/20270417000000_paige_durable_work_envelope.sql'));
 const doc=read('supabase/migrations/20270418000000_paige_durable_document_work.sql');fixture.run(doc.slice(0,doc.indexOf('-- Authenticated submission:')));
 const creator=read('supabase/migrations/20271108201000_e09_customer_private_chat.sql'),a=creator.indexOf('CREATE OR REPLACE FUNCTION public.create_paige_durable_work('),b=creator.indexOf('$function$;',a);assert.ok(a>0&&b>a);fixture.run(creator.slice(a,b+11));
 fixture.run(read('supabase/migrations/20271110031000_durable_work_thread_detach.sql'));
 fixture.run(read('supabase/migrations/20271113360002_exp02_metric_actor_authority.sql'));
 fixture.run(read('supabase/migrations/20271114240002_e02_manual_systems_work_request.sql'));
 // Actual original Knowledge authority and full original getter, not a mocked result.
 const ka=knowledge.indexOf('CREATE OR REPLACE FUNCTION public.knowledge_actor_authorized('),kb=knowledge.indexOf('create or replace function public.create_paige_durable_work(');assert.ok(ka>0&&kb>ka);fixture.run(knowledge.slice(ka,kb));fixture.run(original);
 for(const name of ['actor','admin','member','outsider','operator'])fixture.run('INSERT INTO auth.users(id)VALUES($1)',[ids[name]]);
 fixture.run("INSERT INTO public.tenants VALUES($1,'active','standalone',NULL),($2,'active','standalone',NULL)",[ids.tenant,ids.other]);
 for(const name of ['actor','admin','member','outsider','operator'])fixture.run('INSERT INTO public.profiles VALUES($1,$2)',[ids[name],ids.tenant]);
 for(const [name,role]of [['actor','owner'],['admin','admin'],['member','member']])fixture.run("INSERT INTO public.tenant_members VALUES($1,$2,$3,'active',false)",[ids.tenant,ids[name],role]);
 ids.work=decode(as(ids.actor,'service_role',"SELECT json_build_object('id',work_id)FROM public._create_manual_systems_check_work($1,$2,$3,NULL)",[ids.actor,ids.tenant,randomUUID()])).id;
 saved=snapshot();const baseline=causal();assert.deepEqual(baseline,[true,false,false,false,false,false,true,true]);
 const unrelated=()=>fixture.run(`SELECT md5(jsonb_agg(to_jsonb(p)ORDER BY p.oid)::text) FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.oid<>'${key}'::regprocedure`);
 const beforeMetadata=metadata(),beforeUnrelated=unrelated();fixture.run(migration);
 check('same OID, complete ABI/owner/ACL/config and planner attributes',()=>assert.equal(metadata(),beforeMetadata));
 check('every other public function remains byte-for-byte unchanged',()=>assert.equal(unrelated(),beforeUnrelated));
 check('actual causal new-flow red3/5 to green8/0',()=>assert.deepEqual(causal(),Array(8).fill(true)));
 check('replay preserves the entire original Work row and function identity',()=>{fixture.run(migration);assert.equal(snapshot(),saved);assert.equal(metadata(),beforeMetadata);});
 check('current ordinary Admin can read the original prepared request',()=>assert.equal(visible(ids.admin),1));
 for(const name of ['member','outsider','operator'])check(name+' without current Metric authority is denied',()=>assert.equal(visible(ids[name]),0));
 check('null Auth and unknown UUID stay privacy-safe empty',()=>{assert.equal(visible(null),0);assert.equal(visible(ids.actor,randomUUID()),0);});
 check('anonymous role remains unable to execute reader',()=>assert.throws(()=>as(null,'anon','SELECT * FROM public.get_paige_durable_work($1)',[ids.work]),e=>e.code==='42501'));
 for(const status of ['active','trial','past_due'])changed('public.tenants','status',status,'id',ids.tenant,'active',()=>check('current '+status+' tenant can read historical request',()=>assert.equal(visible(),1)));
 changed('public.tenants','status','inactive','id',ids.tenant,'active',()=>check('ineligible tenant denied',()=>assert.equal(visible(),0)));
 fixture.run('DELETE FROM public.profiles WHERE user_id=$1',[ids.admin]);check('missing selected profile denied',()=>assert.equal(visible(ids.admin),0));fixture.run('INSERT INTO public.profiles VALUES($1,$2)',[ids.admin,ids.tenant]);
 changed('public.tenant_members','is_owner',true,'user_id',ids.actor,false,()=>changed('public.tenant_members','role','member','user_id',ids.actor,'owner',()=>check('stale owner flag does not replace role authority',()=>assert.equal(visible(),0))));
 // New synthetic rows exercise purpose boundaries; no protected identity UPDATE.
 function clone(patch){return decode(fixture.run(`WITH c AS(INSERT INTO public.paige_durable_work SELECT (jsonb_populate_record(NULL::public.paige_durable_work,to_jsonb(w)||jsonb_build_object('id',gen_random_uuid(),'intent_id',gen_random_uuid(),'idempotency_key',gen_random_uuid()::text)||$1::jsonb)).* FROM public.paige_durable_work w WHERE id=$2 RETURNING id)SELECT json_build_object('id',id)FROM c`,[JSON.stringify(patch),ids.work])).id;}
 for(const [name,patch]of Object.entries({foreign:{tenant_id:ids.other},payloadNull:{request_payload:null},extraPayload:{request_payload:{version:1,scope:'tenant',scan_flavor:'manual',action_filing:'none',extra:true}},recurring:{scope_epoch:'recurring'},retryCeiling:{max_attempts:2},wrongKind:{work_kind:'document_ingest'},wrongCapability:{capability_key:'document.ingest'}})){
  const id=clone(patch);check('closed manual purpose denies '+name,()=>assert.equal(visible(ids.actor,id),0));
 }
 const stopped=clone({status:'outcome_unknown'}),cancelled=clone({status:'cancelled',settled_at:new Date().toISOString(),terminal_outcome:{cancelled:true}});const allBefore=snapshot();
 for(const id of [stopped,cancelled])check('terminal or unknown Work read preserves original status',()=>assert.equal(visible(ids.actor,id),1));
 check('all reads preserve every Work field, version, lease and dispatch marker',()=>assert.equal(snapshot(),allBefore));
 check('projection exposes only the existing safe fields',()=>assert.deepEqual(Object.keys(decode(as(ids.actor,'authenticated','SELECT row_to_json(w)::text FROM public.get_paige_durable_work($1)w',[ids.work]))).sort(),['work_id','capability_key','work_kind','work_status','attempt_count','max_attempts','blocked_reason','error_code','safe_summary','created_at','updated_at','settled_at'].sort()));
 check('an Operator-helper positive cannot bypass manual Metric authority',()=>assert.equal(Number(as(ids.operator,'authenticated',"SELECT set_config('test.operator','on',false);SELECT count(*) FROM public.get_paige_durable_work($1)",[ids.work]).split(/\r?\n/).at(-1)),0));
 // Complete incumbent branches are characterized before/after with unchanged
 // actual Knowledge authority and controlled surrounding Operator helpers.
 const legacy=clone({capability_key:'document.ingest',work_kind:'document_ingest'}),known=clone({capability_key:'knowledge.extract',work_kind:'knowledge_extract'}),malformed=clone({capability_key:'document.ingest',work_kind:'knowledge_extract'});
 const samples=()=>[...['actor','admin','member','outsider','operator'].flatMap(n=>[legacy,known,malformed].map(id=>visible(ids[n],id))),Number(as(ids.operator,'authenticated',"SELECT set_config('test.operator','on',false);SELECT count(*) FROM public.get_paige_durable_work($1)",[legacy]).split(/\r?\n/).at(-1))];
 const repaired=samples();fixture.run(original);const old=samples();assert.deepEqual(repaired,old);assert.equal(old[0],1);assert.equal(old[1],1);assert.equal(old[2],0);fixture.run(migration);
 check('16 incumbent caller/kind scope and refusal results unchanged',()=>{assert.deepEqual(samples(),old);assert.equal(old.at(-1),1);});
 check('unexpected incumbent source change is refused without replacing it',()=>{
  fixture.run(definition.replace('where w.id = _work_id','where w.id = _work_id /* fixture drift */'));
  const drift=fixture.run(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${key}'::regprocedure`);
  assert.throws(()=>fixture.run(migration),e=>e.code==='P0001');assert.equal(fixture.run(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${key}'::regprocedure`),drift);fixture.run(original);fixture.run(migration);
 });
 check('native body equals reviewed source and original metadata remains exact',()=>{assert.equal(fixture.run(`SELECT md5(prosrc) FROM pg_proc WHERE oid='${key}'::regprocedure`),bodyMd5);assert.equal(metadata(),beforeMetadata);});
 console.log(JSON.stringify({pass:true,nativeCheckpoints:cases.length,causalBaseline:{pass:3,fail:5},causalRepaired:{pass:8,fail:0},incumbentComparisons:16,wholeNonSystemsSourceExact:true,originalNativeMetadataUnchanged:true,bodyMd5,migrationSha256:createHash('sha256').update(migration).digest('hex'),dispatchOrCustomerScan:false,productionAcceptance:false}));
}finally{await fixture.close();assert.match(fixture.database,/^operator_account_lifecycle_proof_[0-9_]+$/);fixture.role='';fixture.run('DROP DATABASE '+fixture.database,[],'postgres');}
