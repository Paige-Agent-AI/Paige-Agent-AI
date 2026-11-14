// Existing original database-contract LOCAL Supabase stack only.
// --sql is rollback-only; --http-final commits synthetic fixture rows solely
// until the ORIGINAL final grant-ordering reset / ephemeral CI runner teardown.
import assert from 'node:assert/strict';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sqlPath=resolve(repo,'supabase/tests/exp06_studio_confirmation_full_schema.sql');
const carrierPath=resolve(repo,'supabase/migrations/20271133000035_exp06_studio_source_binding.sql');
const minimalPath=resolve(repo,'supabase/tests/exp06_studio_source_binding.sql');
const expectedCarrier='abce7dc033efb585dbc5733a4249276b6a466a10b10dc48149df5a9356076a44';
const expectedMinimal='00f73a8eb3f4141371ac96d367fb47e8da29b392f86fb5f0a11de286ff818a9a';
const read=path=>readFileSync(path,'utf8');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const proofSql=read(sqlPath).replaceAll('\r\n','\n');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
function localEndpoints(state){
 const db=new URL(state.DB_URL),api=new URL(state.API_URL);
 assert(['postgres:','postgresql:'].includes(db.protocol)&&['127.0.0.1','localhost'].includes(db.hostname)
  &&db.port==='54322'&&db.pathname==='/postgres'&&db.username==='postgres'&&!db.search,
  'Existing disposable LOCAL database-contract DB_URL127/localhost:54322/postgres required');
 assert(api.protocol==='http:'&&['127.0.0.1','localhost'].includes(api.hostname)
  &&api.port==='54321'&&['','/'].includes(api.pathname)&&!api.search&&!api.username&&!api.password,
  'Existing disposable LOCAL Supabase API54321 required; managed/prod URL refused');
 return {db,api};
}
function staticContract(){
 assert.equal(hash(carrierPath),expectedCarrier,'Frozen native35 source changed; review actual schema before proof');
 assert.equal(hash(minimalPath),expectedMinimal,'Frozen isolated347 proof must remain unchanged');
 assert.equal((proofSql.match(/^BEGIN;$/gm)||[]).length,1,'one SQL rollback transaction');
 assert.equal((proofSql.match(/^ROLLBACK;$/gm)||[]).length,1);
 assert.equal((proofSql.match(/^COMMIT;$/gm)||[]).length,0);
 assert(!/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public|auth|private)\./i.test(proofSql),'no original function/authority replacement');
 assert(!/DISABLE\s+TRIGGER|session_replication_role|^\s*DELETE\s+FROM\s+(?:public|auth)\./im.test(proofSql),'no trigger bypass or seeded-record deletion');
 for(const statement of ['studio_page_save_source','studio_save_page','studio_page_save_state',
  'read_weekly_commitment_draft','claimed_in_request','SET LOCAL ROLE authenticated','SET LOCAL ROLE service_role','SET LOCAL ROLE anon']){
  assert(proofSql.includes(statement),'Full-schema composition coverage missing: '+statement);
 }
 const local={DB_URL:'postgresql://postgres:postgres@127.0.0.1:54322/postgres',API_URL:'http://127.0.0.1:54321'};
 localEndpoints(local);
 assert.throws(()=>localEndpoints({...local,DB_URL:'postgresql://postgres:unused@db.example.supabase.co:5432/postgres'}));
 assert.throws(()=>localEndpoints({...local,API_URL:'https://example.supabase.co'}));
 assert.throws(()=>localEndpoints({...local,DB_URL:'postgresql://postgres:postgres@127.0.0.1:55486/postgres'}),'minimal port is not full-schema CI');
}
staticContract();
if(process.argv.includes('--self-test')){
 console.log('PASS preparation only: pinned candidate sources; rollback-only SQL; no function/trigger ports; managed/minimal URLs rejected. Full-schema execution UNVERIFIED.');
}else{
 const mode=process.argv.includes('--http-final')?'http':process.argv.includes('--sql')?'sql':null;
 assert(mode,'Use --sql or --http-final --original-ci-teardown; no implicit fixture creation');
 if(mode==='http'){
  assert(process.argv.includes('--original-ci-teardown')&&process.env.GITHUB_ACTIONS==='true',
   'HTTP committed fixtures require original ephemeral database-contract job and its existing final reset');
 }
 const stateResult=spawnSync(process.env.SUPABASE_BIN??'supabase',['status','-o','json'],{cwd:repo,encoding:'utf8',timeout:30000});
 assert(stateResult.status===0,'Existing LOCAL full Supabase stack/CLI unavailable; no minimal/managed fallback');
 const state=JSON.parse(stateResult.stdout),{db,api}=localEndpoints(state);
 const psqlArgs=['-X','-qAt','--dbname',db.toString(),'-v','ON_ERROR_STOP=1'];
 function query(sql,label){
  const result=spawnSync(process.env.PSQL_BIN??'psql',psqlArgs,{cwd:repo,input:sql,encoding:'utf8',timeout:120000});
  if(result.status!==0){
   if(result.stderr)process.stderr.write(result.stderr.replaceAll(db.toString(),'[original local CI database]'));
   throw Error(label+' failed on original full schema; no fallback/fixture port');
  }
  return result.stdout.trim();
 }
 const metadata=JSON.parse(query(`select json_build_object(
  'guard',(select md5(pg_get_functiondef(oid)) from pg_proc where oid=to_regprocedure('public._paige_confirmation_studio_source_immutable()')),
  'signup',(select md5(pg_get_functiondef(oid)) from pg_proc where oid=to_regprocedure('public.handle_new_user()')),
  'tenant_delete',(select md5(pg_get_functiondef(oid)) from pg_proc where oid=to_regprocedure('public.guard_operator_account_archive()')),
  'auth_source',has_column_privilege('authenticated','public.paige_pending_confirmations','studio_page_save_source','SELECT'),
  'anon_source',has_column_privilege('anon','public.paige_pending_confirmations','studio_page_save_source','SELECT'),
  'columns',(select count(*) from pg_attribute where attrelid='public.paige_pending_confirmations'::regclass and attnum>0 and not attisdropped),
  'tag_guard',(select md5(pg_get_functiondef(oid)) from pg_proc where oid=to_regprocedure('public._growth_submission_contact_tags_guard()')),
  'tag_apply',(select md5(pg_get_functiondef(oid)) from pg_proc where oid=to_regprocedure('public.growth_apply_submission_contact_tags(uuid,integer,uuid,uuid,uuid,text,text[])')),
  'tag_state',(select md5(pg_get_functiondef(oid)) from pg_proc where oid=to_regprocedure('public.growth_submission_contact_tags_state(uuid,uuid,uuid)')),
  'auth_tags',has_column_privilege('authenticated','public.growth_form_submissions','contact_tags_result','SELECT'),
  'anon_tags',has_column_privilege('anon','public.growth_form_submissions','contact_tags_result','SELECT'),
  'tag_columns',(select count(*) from pg_attribute where attrelid='public.growth_form_submissions'::regclass and attnum>0 and not attisdropped),
  'private_publications',(select count(*) from pg_publication_tables where schemaname='public'
   and tablename in ('paige_pending_confirmations','growth_form_submissions')));`,'Actual native35 prerequisite metadata'));
 assert(metadata.guard==='7858e187f58d2c824b70093e0fcc8ea1'
  &&metadata.signup==='9a1e676ad5daab60e9c9d79c6df8bbe4'&&metadata.tenant_delete==='c960dc79a2c86f63045aa16e4bd01e2f'
  &&metadata.auth_source===false&&metadata.anon_source===false&&metadata.columns===16
  &&metadata.tag_guard==='6b3dc1efe7182da53d3c8a358057f0e0'&&metadata.tag_apply==='da223c05b9495be6c475b387eb99d9c9'
  &&metadata.tag_state==='b6145ef929d90b3966d646a46a090563'&&metadata.auth_tags===false&&metadata.anon_tags===false
  &&metadata.tag_columns===28&&metadata.private_publications===0,
  'Actual full-schema35/signup/lifecycle/private grants missing or changed; do not install ports or relax pins');
 if(mode==='sql'){
  const result=spawnSync(process.env.PSQL_BIN??'psql',[...psqlArgs,'-f',sqlPath],{cwd:repo,stdio:'inherit',timeout:120000});
  assert.equal(result.status,0,'Original full-schema ROLLBACK-only composition proof failed');
 }else{
  for(const name of ['ANON_KEY','SERVICE_ROLE_KEY','JWT_SECRET'])assert(typeof state[name]==='string'&&state[name].length>20,
   'Original local Supabase '+name+' unavailable; no credential/identity workaround');
  const token=(role,sub)=>{
   const body={role,sub,exp:Math.floor(Date.now()/1000)+600,iss:'exp06-explicit-synthetic-local-ci'};
   const message=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')+'.'
    +Buffer.from(JSON.stringify(body)).toString('base64url');
   return message+'.'+createHmac('sha256',state.JWT_SECRET).update(message).digest('base64url');
  };
  const f={actorA:randomUUID(),actorB:randomUUID(),tenantA:randomUUID(),tenantB:randomUUID(),request:randomUUID(),nonce:randomUUID(),claim:randomUUID(),
   tag:'e06http-'+randomUUID().replaceAll('-',''),fingerprint:randomUUID().replaceAll('-','').slice(0,16)};
  const catalogSql="select md5(string_agg(p.oid::text||to_jsonb(p)::text,'' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth','private');";
  const originalCatalog=query(catalogSql,'Original function catalog before fixtures');
  console.log(JSON.stringify({proof:'EXP06 full-schema populated HTTP',fixture_ids:f,
   fixture_lifetime:'TEMPORARILY COMMITTED until ORIGINAL grant-ordering reset / ephemeral CI runner teardown',customer_identity:false}));
  // No DELETE cleanup: the ORIGINAL tenant lifecycle guard requires a genuine
  // confirmed archive operation even for postgres. The existing CI reset owns
  // this disposable fixture lifetime, after every data-sensitive proof.
  query(`begin;
   select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
   insert into auth.users(id,email) values(${literal(f.actorA)},${literal(f.tag+'-a@example.invalid')}),(${literal(f.actorB)},${literal(f.tag+'-b@example.invalid')});
   insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,features) values
    (${literal(f.tenantA)},${literal(f.tag+'-a')},'EXP06 isolated HTTP A','active','standalone','EXA','{}'),
    (${literal(f.tenantB)},${literal(f.tag+'-b')},'EXP06 isolated HTTP B','active','standalone','EXB','{}');
   insert into public.tenant_members(tenant_id,user_id,role,status,is_owner) values
    (${literal(f.tenantA)},${literal(f.actorA)},'owner','active',true),(${literal(f.tenantB)},${literal(f.actorB)},'owner','active',true);
   update public.profiles set active_tenant_id=${literal(f.tenantA)} where user_id=${literal(f.actorA)};
   update public.profiles set active_tenant_id=${literal(f.tenantB)} where user_id=${literal(f.actorB)};
   commit;`,'Original native HTTP fixture creation');
  const tokens={a:token('authenticated',f.actorA),b:token('authenticated',f.actorB)};
  const cases=[];
  async function call(method,path,who,payload){
   const service=who==='service',headers={apikey:service?state.SERVICE_ROLE_KEY:state.ANON_KEY,Accept:'application/json',Prefer:'return=representation'};
   if(service)headers.Authorization='Bearer '+state.SERVICE_ROLE_KEY;
   else if(who)headers.Authorization='Bearer '+tokens[who];
   if(payload!==undefined)headers['Content-Type']='application/json';
   const response=await fetch(new URL('/rest/v1'+path,api),{method,headers,body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(15000)});
   let data;try{data=await response.json();}catch{data=null;}
   return {status:response.status,data};
  }
  function check(name,result,condition){
   cases.push({name,status:result.status,pass:Boolean(condition)});
   assert(condition,name+' failed: HTTP'+result.status+' code'+(typeof result.data?.code==='string'?result.data.code:'unavailable'));
  }
  let r=await call('POST','/rpc/studio_start_project','a',{p_expected_tenant:f.tenantA,p_request_id:f.request,
   p_brief:'Original full-schema HTTP source',p_project_context:{target:{kind:'workspace'},values:{offers:'Observed CI fixture source'}}});
  check('original authenticated Studio start',r,r.status===200&&r.data?.ok===true&&r.data.created===true);
  const session=r.data.session_id,thread=r.data.thread_id;
  r=await call('POST','/rpc/studio_page_save_source','a',{p_expected_tenant:f.tenantA,p_session_id:session,p_page_id:null});
  check('server/native-observed complete source',r,r.status===200&&r.data?.ok===true&&r.data.session_id===session&&r.data.tenant_id===f.tenantA);
  const source=r.data,args={slug:f.tag+'-page',title:'Original full-schema HTTP page',blocks:[{type:'hero',title:'Reviewed fixture draft'}]};
  const p={user_id:f.actorA,tenant_id:f.tenantA,thread_id:thread,scoped_client_id:null,tool_name:'growth_page_save',fingerprint:f.fingerprint,args,
   summary:'Original Studio confirmation fixture',issued_in_request:f.nonce,server_issued_at:new Date().toISOString(),studio_page_save_source:source};
  r=await call('POST','/paige_pending_confirmations','service',p);
  check('original service INSERT preserves separate private source',r,r.status===201&&r.data?.length===1&&same(r.data[0].args,args)&&same(r.data[0].studio_page_save_source,source));
  const proposal=r.data[0].id;
  r=await call('POST','/paige_pending_confirmations','service',{user_id:f.actorB,tenant_id:f.tenantB,tool_name:'other_tool',
   fingerprint:randomUUID().replaceAll('-','').slice(0,16),args:{},summary:'Foreign actor fixture'});
  check('foreign actual original row populated',r,r.status===201&&r.data?.length===1);
  const foreign=r.data[0].id;
  r=await call('POST','/paige_pending_confirmations','service',{user_id:f.actorA,tenant_id:f.tenantA,thread_id:thread,tool_name:'growth_page_save',
   fingerprint:randomUUID().replaceAll('-','').slice(0,16),args:{},summary:'Legacy NULL source fixture'});
  check('legacy nullable source retained',r,r.status===201&&r.data?.length===1&&r.data[0].studio_page_save_source===null);
  const legacy=r.data[0].id,oldColumns='id,user_id,tenant_id,thread_id,scoped_client_id,tool_name,fingerprint,args,summary,created_at,expires_at,consumed_at,issued_in_request,server_issued_at,claimed_in_request';
  r=await call('GET','/paige_pending_confirmations?'+new URLSearchParams({select:oldColumns}),'a');
  check('all15 actual fields and populated current caller RLS',r,r.status===200&&r.data?.length===2&&r.data.every(row=>row.user_id===f.actorA&&Object.keys(row).length===15));
  r=await call('GET','/paige_pending_confirmations?select=id,user_id','b');
  check('populated foreign caller RLS isolation',r,r.status===200&&r.data?.length===1&&r.data[0].id===foreign&&r.data[0].user_id===f.actorB);
  for(const who of ['a',null])for(const select of ['studio_page_save_source','*']){
   r=await call('GET','/paige_pending_confirmations?'+new URLSearchParams({select}),who);
   check((who?'authenticated':'anon')+' '+select+' denied',r,[401,403].includes(r.status));
  }
  for(const [method,payload] of [['POST',{...p,fingerprint:randomUUID().replaceAll('-','').slice(0,16)}],['PATCH',{args:{forged:true}}],['DELETE',undefined]]){
   r=await call(method,'/paige_pending_confirmations'+(method==='POST'?'':'?id=eq.'+proposal),'a',payload);
   check('authenticated '+method+' original table DML denied',r,[401,403].includes(r.status));
  }
  for(const payload of [{studio_page_save_source:null},{studio_page_save_source:{changed:true}},{args:{changed:true}},{issued_in_request:randomUUID()}]){
   r=await call('PATCH','/paige_pending_confirmations?id=eq.'+proposal,'service',payload);
   check('immutable original source/binding refuses update',r,r.status>=400&&r.data?.code==='40001');
  }
  r=await call('PATCH','/paige_pending_confirmations?id=eq.'+legacy,'service',{studio_page_save_source:source});
  check('legacy NULL source cannot be attached later',r,r.status>=400&&r.data?.code==='40001');
  const filters=new URLSearchParams([['id','eq.'+proposal],['user_id','eq.'+f.actorA],['tenant_id','eq.'+f.tenantA],['thread_id','eq.'+thread],
   ['scoped_client_id','is.null'],['tool_name','eq.growth_page_save'],['fingerprint','eq.'+f.fingerprint],['issued_in_request','eq.'+f.nonce],
   ['issued_in_request','neq.'+f.claim],['issued_in_request','not.is.null'],['server_issued_at','not.is.null'],['consumed_at','is.null'],
   ['expires_at','gt.'+new Date().toISOString()],['select','id,args,studio_page_save_source']]);
  const claimPath='/paige_pending_confirmations?'+filters;
  r=await call('PATCH',claimPath,'service',{consumed_at:new Date().toISOString()});
  check('SAME original conditional claim returns source separately',r,r.status===200&&r.data?.length===1&&same(r.data[0].args,args)&&same(r.data[0].studio_page_save_source,source));
  r=await call('PATCH',claimPath,'service',{consumed_at:new Date().toISOString()});
  check('original UNKNOWN claim cannot be spent twice',r,r.status===200&&r.data?.length===0);
  r=await call('PATCH','/paige_pending_confirmations?id=eq.'+proposal,'service',{claimed_in_request:f.claim,expires_at:new Date(Date.now()+2400000).toISOString()});
  check('original claim/expiry updates retain immutable metadata',r,r.status===200&&same(r.data?.[0]?.studio_page_save_source,source));
  r=await call('PATCH','/paige_pending_confirmations?id=eq.'+foreign,'service',{args:{ordinary:'updated'},consumed_at:new Date().toISOString(),claimed_in_request:randomUUID(),expires_at:new Date().toISOString()});
  check('nonStudio NULL-source behavior preserved',r,r.status===200&&r.data?.[0]?.studio_page_save_source===null&&r.data[0].args.ordinary==='updated');
  const write={p_expected_tenant:f.tenantA,p_session_id:session,p_expected_artifact_refs:source.artifact_refs,p_expected_project_context:source.project_context,
   p_page_id:null,p_expected_updated_at:null,p_expected_conversion:null,p_slug:args.slug,p_title:args.title,p_blocks_json:args.blocks,p_theme_json:null,p_seo_json:null,p_form_schema_json:null};
  r=await call('POST','/rpc/studio_save_page','a',write);
  check('claimed source composes original page/version writer',r,r.status===200&&r.data?.ok===true&&r.data.changed===true&&typeof r.data.version_id==='string');
  const version=r.data.version_id;
  r=await call('POST','/rpc/studio_page_save_state','a',write);
  check('unknown save reconciles exact original version without retry',r,r.status===200&&r.data?.ok===true&&r.data.reconciled===true&&r.data.version_id===version);
  r=await call('POST','/paige_pending_confirmations','service',{user_id:f.actorA,tenant_id:f.tenantA,tool_name:'weekly_commitment_draft',
   fingerprint:randomUUID().replaceAll('-','').slice(0,16),args:{_request_id:randomUUID(),_name:'Original specialized HTTP projection',_weekday:1,_local_time:'09:00',_timezone:'America/New_York'},
   summary:'Native wrapper fixture',issued_in_request:randomUUID(),server_issued_at:new Date().toISOString()});
  check('specialized original NULL-source proposal populated',r,r.status===201&&r.data?.length===1);
  r=await call('POST','/rpc/read_weekly_commitment_draft','a',{_confirmation_id:r.data[0].id});
  check('actual original whole-row wrapper projection stays private',r,r.status===200&&r.data?.phase==='awaiting_approval'&&!Object.hasOwn(r.data,'studio_page_save_source'));

  // The new causal field shares the ORIGINAL submission, retaining exactly the
  // 27 incumbent read columns. All fixtures use the same original CI stack.
  const intake={form:randomUUID(),foreignForm:randomUUID(),submission:randomUUID(),foreignSubmission:randomUUID()};
  console.log(JSON.stringify({additional_fixture_ids:intake,fixture_lifetime:'ORIGINAL final reset / ephemeral runner teardown'}));
  r=await call('POST','/rpc/upsert_contact','service',{p_patch:{first_name:'Local',last_name:'Intake',tags:['Legacy','Legacy']},
   p_contact_id:null,p_tenant_id:f.tenantA,p_actor_user_id:f.actorA,p_channel:'api'});
  check('original native contact fixture writer',r,r.status===200&&typeof r.data==='string');
  intake.contact=r.data;
  query(`begin;select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
   insert into public.growth_forms(id,tenant_id,slug,name,status,created_by,schema_json) values
    (${literal(intake.form)},${literal(f.tenantA)},${literal(f.tag+'-intake')},'Original local HTTP form','active',${literal(f.actorA)},
     '{"sections":[{"fields":[{"key":"email","type":"email","label":"Email"}]}]}'),
    (${literal(intake.foreignForm)},${literal(f.tenantB)},${literal(f.tag+'-foreign-intake')},'Foreign local HTTP form','draft',${literal(f.actorB)},'{"sections":[]}');
   commit;`,'Original native form fixture');
  r=await call('POST','/rpc/growth_form_set_intake','a',{p_form_id:intake.form,p_auto_create_deal:false,p_pipeline_id:null,
   p_stage_id:null,p_notify_email:null,_lead_reply_enabled:null,p_future_tags:[' Campaign ','Campaign','North']});
  check('original intake7 config normalization',r,r.status===200&&same(r.data?.future_tags,['Campaign','North']));
  r=await call('POST','/growth_form_submissions','service',{id:intake.submission,form_id:intake.form,tenant_id:f.tenantA,
   contact_id:intake.contact,payload_json:{},source:'paige_form'});
  check('original service submission INSERT starts with no causal result',r,r.status===201&&r.data?.[0]?.contact_tags_result===null);
  r=await call('POST','/growth_form_submissions','service',{id:intake.foreignSubmission,form_id:intake.foreignForm,tenant_id:f.tenantB,payload_json:{},source:'paige_form'});
  check('foreign populated submission fixture',r,r.status===201&&r.data?.length===1);
  const submissionColumns='id,form_id,tenant_id,contact_id,deal_id,source,external_source_id,payload_json,utm_json,referrer,ip,user_agent,consent_json,funnel_session_id,processed,processed_at,created_at,processing_state,attempts,claimed_at,last_error,alert_sent_at,alert_skipped_reason,visit_id,campaign_brief_id,campaign_attribution,lead_reply_skipped_reason';
  r=await call('GET','/growth_form_submissions?'+new URLSearchParams({select:submissionColumns,id:'eq.'+intake.submission}),'a');
  check('all27 original fields populated under current tenant RLS',r,r.status===200&&r.data?.length===1&&Object.keys(r.data[0]).length===27);
  r=await call('GET','/growth_form_submissions?'+new URLSearchParams({select:'id,tenant_id',id:'eq.'+intake.foreignSubmission}),'b');
  check('foreign original source RLS has actual populated row',r,r.status===200&&r.data?.length===1&&r.data[0].tenant_id===f.tenantB);
  r=await call('GET','/growth_form_submissions?'+new URLSearchParams({select:'id',id:'eq.'+intake.foreignSubmission}),'a');
  check('foreign submission isolation on populated source',r,r.status===200&&r.data?.length===0);
  for(const who of ['a',null])for(const select of ['contact_tags_result','*']){
   r=await call('GET','/growth_form_submissions?'+new URLSearchParams({select}),who);
   check((who?'auth':'anon')+' private submission '+select+' denied',r,[401,403].includes(r.status));
  }
  r=await call('POST','/rpc/growth_claim_submission','service',{p_submission_id:intake.submission});
  check('original native claim preserves minimal projection',r,r.status===200&&r.data?.claimed===true&&!Object.hasOwn(r.data,'contact_tags_result'));
  const attempt=r.data.attempts;
  r=await call('GET','/clients?'+new URLSearchParams({select:'id,updated_at',id:'eq.'+intake.contact,tenant_id:'eq.'+f.tenantA}),'service');
  check('raw native contact version projection',r,r.status===200&&r.data?.length===1&&typeof r.data[0].updated_at==='string');
  const tagArgs={p_submission_id:intake.submission,p_claim_attempt:attempt,p_automation_id:null,p_contact_id:intake.contact,
   p_actor_user_id:f.actorA,p_expected_updated_at:r.data[0].updated_at,p_expected_future_tags:['Campaign','North']};
  const tagState={p_submission_id:intake.submission,p_contact_id:intake.contact,p_automation_id:null};
  r=await call('POST','/rpc/growth_apply_submission_contact_tags','service',tagArgs);
  check('atomic original contact tag write and private causal checkpoint',r,r.status===200&&r.data?.ok===true&&r.data.result?.outcome==='applied'
   &&typeof r.data.result.audit_id==='string'&&r.data.result.source_updated_at===tagArgs.p_expected_updated_at);
  const originalTagResult=r.data.result;
  r=await call('POST','/rpc/growth_submission_contact_tags_state','service',tagState);
  check('same original causal result reads after HTTP response loss',r,r.status===200&&r.data?.replayed===true&&same(r.data.result,originalTagResult));
  for(const method of ['POST','PATCH']){
   r=await call(method,'/growth_form_submissions'+(method==='POST'?'':'?id=eq.'+intake.submission),'service',method==='POST'
    ?{form_id:intake.form,tenant_id:f.tenantA,contact_tags_result:originalTagResult}:{contact_tags_result:null});
   check('raw service '+method+' cannot forge/reset causal checkpoint',r,r.status>=400&&['42501','40001'].includes(r.data?.code));
  }
  r=await call('POST','/rpc/growth_submission_contact_tags_state','a',tagState);
  check('causal projection remains service-only',r,[401,403].includes(r.status));
  r=await call('POST','/rpc/growth_complete_submission','service',{p_submission_id:intake.submission});
  check('original completion remains compatible without private return field',r,r.status===200&&r.data?.status==='done'&&!Object.hasOwn(r.data,'contact_tags_result'));
  r=await call('POST','/rpc/growth_submission_contact_tags_state','service',tagState);
  check('original completion retains immutable historical result',r,r.status===200&&same(r.data?.result,originalTagResult));
  r=await call('POST','/rpc/growth_public_form',null,{p_form_id:intake.form});
  check('public form projection excludes routing/future tags/causal metadata',r,r.status===200&&r.data?.length===1
   &&same(Object.keys(r.data[0]).sort(),['id','slug','name','schema_json','success_action_json'].sort()));

  const unicodeTags=Array.from({length:50},(_,n)=>String.fromCodePoint(0x1f600).repeat(79)+String.fromCodePoint(0x1f601+n));
  r=await call('POST','/rpc/growth_form_set_intake','a',{p_form_id:intake.form,p_auto_create_deal:false,p_pipeline_id:null,
   p_stage_id:null,p_notify_email:null,_lead_reply_enabled:null,p_future_tags:unicodeTags});
  check('valid maximum50-by80 Unicode setting accepted',r,r.status===200&&same(r.data?.future_tags,unicodeTags));
  r=await call('POST','/rpc/upsert_contact','service',{p_patch:{first_name:'Local',last_name:'Unicode'},
   p_contact_id:null,p_tenant_id:f.tenantA,p_actor_user_id:f.actorA,p_channel:'api'});
  check('original fresh Unicode boundary contact',r,r.status===200&&typeof r.data==='string');
  const wideContact=r.data,wideSubmission=randomUUID();
  console.log(JSON.stringify({additional_fixture_ids:{wideContact,wideSubmission},fixture_lifetime:'ORIGINAL final reset / ephemeral runner teardown'}));
  r=await call('POST','/growth_form_submissions','service',{id:wideSubmission,form_id:intake.form,tenant_id:f.tenantA,
   contact_id:wideContact,payload_json:{},source:'paige_form'});
  check('original Unicode boundary submission populated',r,r.status===201&&r.data?.length===1);
  r=await call('POST','/rpc/growth_claim_submission','service',{p_submission_id:wideSubmission});
  check('original claim for Unicode maximum',r,r.status===200&&r.data?.claimed===true);
  const wideAttempt=r.data.attempts;
  r=await call('GET','/clients?'+new URLSearchParams({select:'id,updated_at',id:'eq.'+wideContact,tenant_id:'eq.'+f.tenantA}),'service');
  check('raw exact Unicode boundary source version',r,r.status===200&&r.data?.length===1&&typeof r.data[0].updated_at==='string');
  r=await call('POST','/rpc/growth_apply_submission_contact_tags','service',{p_submission_id:wideSubmission,p_claim_attempt:wideAttempt,
   p_automation_id:null,p_contact_id:wideContact,p_actor_user_id:f.actorA,p_expected_updated_at:r.data[0].updated_at,p_expected_future_tags:unicodeTags});
  check('valid Unicode checkpoint above former16KiB cap applies',r,r.status===200&&r.data?.result?.outcome==='applied'
   &&same(r.data.result.future_tags,unicodeTags)&&Buffer.byteLength(JSON.stringify(r.data.result),'utf8')>16384);
  const wideResult=r.data.result;
  r=await call('POST','/rpc/growth_submission_contact_tags_state','service',{p_submission_id:wideSubmission,p_contact_id:wideContact,p_automation_id:null});
  check('valid maximum Unicode result reopens unchanged',r,r.status===200&&same(r.data?.result,wideResult));
  r=await call('POST','/rpc/growth_submission_contact_tags_state','service',tagState);
  check('later maximum setting preserves earlier original receipt',r,r.status===200&&same(r.data?.result,originalTagResult));

  r=await call('POST','/rpc/upsert_contact','service',{p_patch:{entity_type:'business',entity_name:'B'.repeat(201)},
   p_contact_id:null,p_tenant_id:f.tenantA,p_actor_user_id:f.actorA,p_channel:'api'});
  check('original business identity fixture writer',r,r.status===200&&typeof r.data==='string');
  const businessId=r.data;
  r=await call('POST','/rpc/studio_business_targets','a',{p_expected_tenant:f.tenantA,p_query:'B'.repeat(120),p_limit:20});
  check('real authenticated Business selector exact minimal projection',r,r.status===200&&r.data?.ok===true&&r.data.businesses.length===1
   &&r.data.businesses[0].id===businessId&&r.data.businesses[0].entity_name.length===201
   &&same(Object.keys(r.data.businesses[0]).sort(),['id','entity_name','updated_at'].sort()));
  const business=r.data.businesses[0],businessRequest=randomUUID(),businessContext={target:{kind:'client',reference:business.id},
   business_source:{id:business.id,updated_at:business.updated_at},business_name:business.entity_name,values:{publicName:''}};
  const startBusiness={p_expected_tenant:f.tenantA,p_request_id:businessRequest,p_brief:'Explicit selected business',p_project_context:businessContext};
  r=await call('POST','/rpc/studio_start_project','a',startBusiness);
  check('201-char Business default binds without optional label and preserves manual blank',r,r.status===200&&r.data?.created===true);
  const businessSession=r.data.session_id;
  r=await call('POST','/rpc/studio_start_project','a',{...startBusiness,p_request_id:randomUUID(),p_project_context:{...businessContext,business_name:'Previous selected name'}});
  check('wrong observed Business default refuses before start',r,r.status===200&&r.data?.code==='scope_changed');
  r=await call('POST','/rpc/studio_business_targets','b',{p_expected_tenant:f.tenantA,p_query:'',p_limit:20});
  check('Business selector refuses foreign expected workspace',r,r.status===200&&r.data?.code==='scope_changed');
  assert.equal(query(catalogSql,'Original function catalog after fixtures'),originalCatalog,'Original auth/authority/function bodies and metadata changed');
  assert.equal(hash(carrierPath),expectedCarrier);assert.equal(hash(minimalPath),expectedMinimal);
  console.log(JSON.stringify({proof:'EXP06 REAL full-schema LOCAL HTTP',passed_checks:cases.length,cases,
   original_native_auth:true,fixture_tokens:'synthetic local only',fixture_cleanup:'ORIGINAL grant-ordering reset / ephemeral runner teardown',
   managed_writes:false,customer_authentication:false,public_edge_submit_http:'UNVERIFIED: original CI stack excludes edge-runtime'}));
 }
}
