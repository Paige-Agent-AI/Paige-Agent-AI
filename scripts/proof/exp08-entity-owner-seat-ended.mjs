// Original EXP08 I2/R6/R11 component proof. Local disposable PostgreSQL ONLY.
// Usage: EXP08_DISPOSABLE=1 PGHOST=127.0.0.1 PGPORT=... [PSQL=...] node this-file
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

assert.equal(process.env.EXP08_DISPOSABLE, '1', 'Explicit disposable proof opt-in required');
const host = process.env.PGHOST;
assert.ok(host === '127.0.0.1' || host === 'localhost' || host === '::1', 'Loopback database only');
assert.match(process.env.PGPORT ?? '', /^\d+$/, 'Explicit local port required');
const executable = process.env.PSQL || 'psql';
assert.ok(process.argv.slice(2).every(arg=>['--only-owner-read','--only-billing','--only-owner-history'].includes(arg)),'Unknown native proof selection');
const onlyOwnerHistory=process.argv.includes('--only-owner-history');
const onlyOwnerRead=process.argv.includes('--only-owner-read');
const onlyBilling=process.argv.includes('--only-billing');
assert.ok([onlyOwnerRead,onlyBilling,onlyOwnerHistory].filter(Boolean).length<=1,'Select only one local proof group');
const database = `exp08_entity_seat_proof_${Date.now()}`;
const fixture = readFileSync(new URL('../../supabase/tests/exp08_entity_owner_seat_ended.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/20271126080008_exp08_entity_owner_seat_ended.sql', import.meta.url), 'utf8');
const invitationSource = readFileSync(new URL('../../supabase/migrations/20271120010008_exp08_owner_invitations.sql', import.meta.url), 'utf8');
const coOwnerSource = readFileSync(new URL('../../supabase/migrations/20271116020008_exp08_co_owner_authority.sql', import.meta.url), 'utf8');
const tenantAuthoritySource = readFileSync(new URL('../../supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql', import.meta.url), 'utf8');
const revokeFixture = readFileSync(new URL('../../supabase/tests/exp08_entity_owner_revoke_integration.sql', import.meta.url), 'utf8');
const revokeMigration = readFileSync(new URL('../../supabase/migrations/20271126090008_exp08_entity_owner_revoke_link.sql', import.meta.url), 'utf8');
const billingFixture=readFileSync(new URL('../../supabase/tests/exp08_owner_billing_interlock.sql',import.meta.url),'utf8');
const billingFoundation=readFileSync(new URL('../../supabase/migrations/20261045000000_platform_billing_accounts_foundation_a.sql',import.meta.url),'utf8');
const billingRevokeSource=readFileSync(new URL('../../supabase/migrations/20261111050000_the_workspace_can_connect_a_payment_method.sql',import.meta.url),'utf8');
function billingBootstrap(){
  sql(billingFixture);
  for(const [source,name] of [[billingFoundation,'platform_billing_workspace_owner_scope'],[billingRevokeSource,'platform_billing_contact_revoke']]){
    const start=source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);const end=source.indexOf('$$;',start);
    assert.ok(start>=0&&end>start);sql(source.slice(start,end+3));
  }
  sql('REVOKE ALL ON FUNCTION public.platform_billing_workspace_owner_scope() FROM PUBLIC,anon,authenticated,service_role; REVOKE ALL ON FUNCTION public.platform_billing_contact_revoke(uuid) FROM PUBLIC,anon,service_role; GRANT EXECUTE ON FUNCTION public.platform_billing_contact_revoke(uuid) TO authenticated;');
}
function billingCases(requirePass=true){
  const rows=sql('select row_to_json(t) from proof.billing_cases() t;').split('\n').filter(Boolean).map(JSON.parse);
  console.log(JSON.stringify({phase:'original-billing-interlock',cases:rows}));
  assert.equal(rows.length,13);if(requirePass)assert.ok(rows.every(r=>r.passed),JSON.stringify(rows));
  return rows;
}
function billingMutationControls(){
  const saved=sql("select pg_get_functiondef('public.revoke_co_owner(uuid,uuid)'::regprocedure);").replace(/\r\n/g,'\n');
  for(const [name,mutate] of [
    ['original Billing writer bypassed',s=>s.replace('PERFORM public.platform_billing_contact_revoke(_contact);','PERFORM 1;')],
    ['current-workspace binding removed',s=>s.replaceAll('IF public.platform_billing_workspace_owner_scope() IS DISTINCT FROM _tenant THEN','IF false THEN')],
    ['target person scope removed',s=>s.replace('AND b.user_id = _user','')],
    ['revoked designation scope removed',s=>s.replace('AND b.revoked_at IS NULL','')],
    ['non-billable compatibility removed',s=>s.replace("AND account_type = 'standalone' AND parent_tenant_id IS NULL",'')],
    ['unsupported cleanup refusal removed',s=>s.replace('ELSIF EXISTS (SELECT 1 FROM public.platform_billing_contacts b','ELSIF false AND EXISTS (SELECT 1 FROM public.platform_billing_contacts b')],
  ]){
    try{
      const changed=mutate(saved);assert.notEqual(changed,saved,name);sql(changed);
      const failures=billingCases(false).filter(r=>!r.passed).map(r=>r.case_name);
      assert.ok(failures.length,name);console.log(JSON.stringify({phase:'billing-interlock-mutant',name,killed_by:failures}));
    }finally{sql(saved);}
  }
  assert.ok(billingCases().every(r=>r.passed));
}
function billingMigrationChecks(){
  const state=()=>sql("select jsonb_build_object('members',(select jsonb_agg(to_jsonb(m) order by id) from public.tenant_members m),'owners',(select jsonb_agg(to_jsonb(b) order by id) from public.tenant_business_owners b),'contacts',(select jsonb_agg(to_jsonb(b) order by id) from public.platform_billing_contacts b),'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.paige_audit_log a));");
  const before=state();const metadata=sql("select (to_jsonb(p)-'prosrc')::text from pg_proc p where oid='public.revoke_co_owner(uuid,uuid)'::regprocedure;");
  sql(revokeMigration);assert.equal(state(),before);assert.equal(sql("select (to_jsonb(p)-'prosrc')::text from pg_proc p where oid='public.revoke_co_owner(uuid,uuid)'::regprocedure;"),metadata);
  console.log(JSON.stringify({phase:'billing-interlock-replay',row_changes:0,writer_metadata_conserved:true}));
  for(const signature of ['public.platform_billing_workspace_owner_scope()','public.platform_billing_contact_revoke(uuid)']){
    const saved=sql(`select pg_get_functiondef('${signature}'::regprocedure);`);
    for(const [name,change] of [
      ['body',saved.replace('BEGIN','BEGIN\n PERFORM 1;')],
      ['anonymous execute',`GRANT EXECUTE ON FUNCTION ${signature} TO anon;`],
      ['service execute',`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`],
      ['path',`ALTER FUNCTION ${signature} SET search_path='pg_catalog';`],
    ]){
      try{sql(change);sql(revokeMigration,database,true,/EXP08 entity revoke Billing prerequisite drift/);console.log(JSON.stringify({phase:'billing-prerequisite-drift',signature,name,refused:true}));}
      finally{sql(`${saved}; REVOKE ALL ON FUNCTION ${signature} FROM anon,service_role;`);}
    }
  }
}
async function billingAuthorityRace(team){
  sql("select proof.revoke_setup(); TRUNCATE public.platform_billing_contacts; INSERT INTO public.platform_billing_contacts(id,tenant_id,user_id,designation) VALUES ('e8000000-0000-4000-8000-000000063001','e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060100','delegate');");
  // An unaffected third owner keeps the owner floor from masking a stale-caller defect.
  sql("INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,role) VALUES ('e8000000-0000-4000-8000-000000061004','e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060200',true,'owner');");
  const first=spawn(executable,connectionArgs(database),{env:process.env,stdio:['pipe','pipe','pipe']});
  const firstDone=new Promise((resolve,reject)=>{first.on('error',reject);first.on('close',resolve);});
  let second,secondDone,timer,output='',errors='';
  try{
    const ready=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('Billing race lock not acquired')),10000);
      first.stdout.on('data',c=>{output+=c;if(output.includes('EXP08_BILLING_LOCKED'))resolve();});first.on('error',reject);
    });
    first.stdin.write(team
      ? "BEGIN; UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='e8000000-0000-4000-8000-000000060010' AND user_id='e8000000-0000-4000-8000-000000060300';\n\\echo EXP08_BILLING_LOCKED\n"
      : "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('platform_billing_contacts:e8000000-0000-4000-8000-000000060010',0));\n\\echo EXP08_BILLING_LOCKED\n");
    await ready;clearTimeout(timer);
    const app=team?'exp08_team_billing_authority_race':'exp08_original_billing_authority_race';
    second=spawn(executable,connectionArgs(database),{env:{...process.env,PGAPPNAME:app},stdio:['pipe','pipe','pipe']});
    secondDone=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',resolve);});
    second.stderr.on('data',c=>{errors+=c;});
    second.stdin.end("SET request.jwt.claim.sub='e8000000-0000-4000-8000-000000060300';\n"+(team
      ? "SELECT public.revoke_co_owner('e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060100');\n"
      : "SELECT public.platform_billing_contact_revoke('e8000000-0000-4000-8000-000000063001');\n"));
    let waited=false;
    for(let i=0;i<40;i++){
      waited=sql(`select exists(select 1 from pg_stat_activity where datname='${database}' and application_name='${app}' and wait_event_type='Lock');`)==='t';
      if(waited)break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(waited,'Actual second-session lock wait required');
    if(!team)sql("UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='e8000000-0000-4000-8000-000000060010' AND user_id='e8000000-0000-4000-8000-000000060300';");
    first.stdin.end('COMMIT;\n\\q\n');assert.equal(await firstDone,0);
    const exit=await secondDone;
    const state=JSON.parse(sql("select json_build_object('revoked',(select revoked_at IS NOT NULL from public.platform_billing_contacts where id='e8000000-0000-4000-8000-000000063001'),'audits',(select count(*) from public.paige_audit_log),'target_owner',(select is_owner from public.tenant_members where tenant_id='e8000000-0000-4000-8000-000000060010' AND user_id='e8000000-0000-4000-8000-000000060100'));"));
    console.log(JSON.stringify({phase:'original-billing-authority-loss-race',door:team?'Team':'Billing',wait_observed:waited,exit,state,error:errors.trim()}));
    assert.notEqual(exit,0,'Authority lost while waiting must refuse');
    assert.deepEqual(state,{revoked:false,audits:0,target_owner:true});
  }finally{
    clearTimeout(timer);if(first.exitCode===null)first.stdin.end('ROLLBACK;\n\\q\n');
    if(second&&second.exitCode===null)second.kill();
    await Promise.allSettled([firstDone,...(secondDone?[secondDone]:[])]);
  }
}
const collaborationSource=readFileSync(new URL('../../supabase/migrations/20271113850008_exp08_team_hub_collaboration.sql',import.meta.url),'utf8');
const lifecycleSource=readFileSync(new URL('../../supabase/migrations/20271115040008_exp08_team_lifecycle.sql',import.meta.url),'utf8');
const actorFixture=readFileSync(new URL('../../supabase/tests/exp08_team_hub_actor_lifecycle.sql',import.meta.url),'utf8');
const actorMigration=readFileSync(new URL('../../supabase/migrations/20271126100008_exp08_team_hub_actor_lifecycle.sql',import.meta.url),'utf8');
const holderStateFixture=readFileSync(new URL('../../supabase/tests/exp08_account_holder_state.sql',import.meta.url),'utf8');
const identityFixture=readFileSync(new URL('../../supabase/tests/exp08_team_hub_identity_currentness.sql',import.meta.url),'utf8');
const identityMigration=readFileSync(new URL('../../supabase/migrations/20271126140008_exp08_team_hub_identity_currentness.sql',import.meta.url),'utf8');
const ownerReadFixture=readFileSync(new URL('../../supabase/tests/exp08_owner_read_projection.sql',import.meta.url),'utf8');
const workspaceReadSource=readFileSync(new URL('../../supabase/migrations/20261107000000_the_headline_is_the_furthest_the_email_got.sql',import.meta.url),'utf8');
const contextReadSource=readFileSync(new URL('../../supabase/migrations/20260901150000_solo_paige_team_invitation_context.sql',import.meta.url),'utf8');
// Use the canonical Git/LF candidate on Windows too. Database MD5/source guards are NOT normalized.
const ownerReadPatch=readFileSync(new URL('./exp08-owner-read-projection-patch.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function privateHelper(source,name,signature) {
  const start=source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const endPattern=`REVOKE ALL ON FUNCTION public.${name}(${signature})`;
  const revoke=source.indexOf(endPattern,start);const end=source.indexOf(';',revoke);
  assert.ok(start>=0&&revoke>start&&end>revoke,`Original ${name} with its private ACL required`);
  return source.slice(start,end+1);
}
function originalFunction(source, name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `Original ${name} missing`);
  const end = source.indexOf('$function$;', start);
  assert.ok(end > start, `Original ${name} body delimiter missing`);
  return source.slice(start, end + '$function$;'.length);
}
const scopeHelper = invitationSource.match(/CREATE OR REPLACE FUNCTION public\._solo_shell_tenant\(_tenant uuid\)[\s\S]*?REVOKE ALL ON FUNCTION public\._solo_shell_tenant\(uuid\)[^;]*;/)?.[0];
assert.ok(scopeHelper, 'Original I1 scope helper required; never replace it with a second eligibility rule');
const definition = migration.match(/CREATE OR REPLACE FUNCTION public\._business_owner_seat_ended\(\)[\s\S]*?END \$\$;/)?.[0];
assert.ok(definition, 'Original candidate function required');
const representativeDefinition = migration.match(/CREATE OR REPLACE FUNCTION public\._business_owner_representative_deleted\(\)[\s\S]*?END \$\$;/)?.[0];
assert.ok(representativeDefinition, 'Original FK companion required');
const definitions = [['public._business_owner_seat_ended()', definition, '75d4a8e014e495c5e0a819881b6a79bd'],
  ['public._business_owner_representative_deleted()', representativeDefinition, 'f95cbff2d3f69c274b287ef0b9bc0067']];
const records = [];
async function firstOwnerInvitationWait(expire,stage='tenant',scopeChange=null){
  assert.ok(['tenant','profile','mint'].includes(stage));
  assert.ok([null,'to_solo','to_enterprise','agency_lost','agency_retained','platform_lost'].includes(scopeChange));
  const agencyCase=scopeChange?.startsWith('agency_');
  const lateAuthorityCase=agencyCase||scopeChange==='platform_lost';
  assert.ok(!scopeChange||(!expire&&(stage==='mint'||stage===(lateAuthorityCase?'profile':'tenant'))));
  const ids=JSON.parse(sql(`WITH p AS (SELECT gen_random_uuid() AS p,gen_random_uuid() AS u,gen_random_uuid() AS t,gen_random_uuid() AS i)
    SELECT row_to_json(seed) FROM p seed;`));
  const {p,u,t,i}=ids;for(const id of Object.values(ids))assert.match(id,/^[0-9a-f-]{36}$/);
  sql(`INSERT INTO auth.users(id,email) VALUES('${p}','platform@example.invalid'),('${u}','invitee@example.invalid');
    INSERT INTO proof.platform_owners VALUES('${p}'); INSERT INTO public.tenants(id,account_type) VALUES('${t}','${scopeChange==='to_solo'?'enterprise':'standalone'}');
    INSERT INTO public.profiles VALUES('${u}',NULL);`);
  if(stage!=='mint')sql(`INSERT INTO public.tenant_invite_tokens(id,tenant_id,token,kind,default_role,created_by,max_uses)
      VALUES('${i}','${t}','${i}','subaccount_owner','admin','${p}',1);`);
  if(scopeChange&&scopeChange!=='platform_lost')sql(`UPDATE public.tenants SET first_owner_seated_at='2021-01-01Z' WHERE id='${t}';`);
  if(agencyCase)sql(`INSERT INTO proof.agency_managers VALUES('${t}','${p}');`);
  const first=spawn(executable,connectionArgs(database),{env:process.env,stdio:['pipe','pipe','pipe']});
  const firstDone=new Promise((resolve,reject)=>{first.on('error',reject);first.on('close',resolve);});
  let second,secondDone,timer,output='',errors='';
  try{
    const ready=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('First-owner tenant lock not acquired')),10000);
      first.stdout.on('data',c=>{output+=c;if(output.includes('EXP08_FIRST_OWNER_LOCKED'))resolve();});first.on('error',reject);
    });
    const lock=stage==='mint'?'LOCK TABLE public.tenant_invite_tokens IN SHARE MODE;'
      :scopeChange&&!lateAuthorityCase?`UPDATE public.tenants SET account_type='${scopeChange==='to_solo'?'standalone':'enterprise'}' WHERE id='${t}';`
      :stage==='tenant'?`SELECT 1 FROM public.tenants WHERE id='${t}' FOR UPDATE;`
      :`UPDATE public.profiles SET active_tenant_id=active_tenant_id WHERE user_id='${u}';`;
    first.stdin.write(`BEGIN; ${lock}\n\\echo EXP08_FIRST_OWNER_LOCKED\n`);
    await ready;clearTimeout(timer);
    if(expire)sql(`UPDATE public.tenant_invite_tokens SET expires_at=clock_timestamp()+interval '5 seconds' WHERE id='${i}';`);
    const app='exp08_first_owner_wait_'+stage+'_'+(scopeChange||(expire?'expiry':'valid'));
    second=spawn(executable,connectionArgs(database),{env:{...process.env,PGAPPNAME:app},stdio:['pipe','pipe','pipe']});
    secondDone=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',resolve);});
    second.stderr.on('data',c=>{errors+=c;});
    second.stdin.end(stage==='mint'
      ?`SET statement_timeout='20000'; SET request.jwt.claim.sub='${p}'; SELECT public.create_tenant_invite_token('${t}','subaccount_owner','admin',7,1,NULL,NULL);`
      :`SET statement_timeout='20000'; SET request.jwt.claim.sub='${u}'; SELECT public.accept_tenant_invite('${i}');`);
    let waited=false;
    for(let attempt=0;attempt<40;attempt++){
      waited=sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname='${database}' AND application_name='${app}' AND wait_event_type='Lock'${stage==='mint'?" AND wait_event='relation'":''});`)==='t';
      if(waited)break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(waited,`Original acceptance must actually wait on the original ${stage} row`);
    if(scopeChange==='agency_lost')sql(`DELETE FROM proof.agency_managers WHERE tenant_id='${t}' AND user_id='${p}';`);
    if(scopeChange==='platform_lost')sql(`DELETE FROM proof.platform_owners WHERE user_id='${p}';`);
    if(expire){
      sql(`SELECT pg_sleep(greatest(0,extract(epoch FROM expires_at-clock_timestamp())+0.05)) FROM public.tenant_invite_tokens WHERE id='${i}';`);
      assert.equal(sql(`SELECT expires_at<clock_timestamp() FROM public.tenant_invite_tokens WHERE id='${i}';`),'t');
    }
    first.stdin.end('COMMIT;\n\\q\n');assert.equal(await firstDone,0);const exit=await secondDone;
    const state=JSON.parse(sql(`SELECT json_build_object('seats',(SELECT count(*) FROM public.tenant_members WHERE tenant_id='${t}'),
      'pointer',(SELECT owner_user_id IS NOT NULL FROM public.tenants WHERE id='${t}'),
      ${stage==='mint'?`'tokens',(SELECT count(*) FROM public.tenant_invite_tokens WHERE tenant_id='${t}')`:`'uses',(SELECT uses FROM public.tenant_invite_tokens WHERE id='${i}')`},
      'profile',(SELECT active_tenant_id IS NOT NULL FROM public.profiles WHERE user_id='${u}'),
      'audit',(SELECT count(*) FROM public.paige_audit_log WHERE tenant_id='${t}'));`));
    console.log(JSON.stringify({phase:'first-owner-invitation-actual-wait',case:scopeChange||((expire?'expired during ':'valid ')+stage+' wait'),wait_observed:true,exit,state,error:errors.trim()}));
    if(stage==='mint'){
      const refused=scopeChange==='agency_lost'||scopeChange==='platform_lost';
      if(refused){assert.notEqual(exit,0,'Authority lost during actual token INSERT must refuse');assert.match(errors,scopeChange==='platform_lost'?/OWNER_INVITE_AUTHORITY_CHANGED/:/OWNER_HISTORY_REQUIRES_RECOVERY/);}
      else assert.equal(exit,0,errors);
      assert.deepEqual(state,{seats:0,pointer:false,tokens:refused?0:1,profile:false,audit:0});
    }
    else if(scopeChange==='to_solo'||scopeChange==='agency_lost'||scopeChange==='platform_lost'){assert.notEqual(exit,0,'Current Solo/agency authority after the actual wait must enforce existing owner history');assert.match(errors,scopeChange==='platform_lost'?/OWNER_INVITE_AUTHORITY_CHANGED/:/OWNER_HISTORY_REQUIRES_RECOVERY/);assert.deepEqual(state,{seats:0,pointer:false,uses:0,profile:false,audit:0});}
    else if(expire){assert.notEqual(exit,0,'An invitation expiring during the actual tenant wait must refuse');assert.match(errors,/invite has expired/);assert.deepEqual(state,{seats:0,pointer:false,uses:0,profile:false,audit:0});}
    else{assert.equal(exit,0,errors);assert.deepEqual(state,{seats:1,pointer:true,uses:1,profile:true,audit:1});}
  }finally{
    clearTimeout(timer);if(first.exitCode===null)first.stdin.end('ROLLBACK;\n\\q\n');
    if(second&&second.exitCode===null)second.kill();
    await Promise.allSettled([firstDone,...(secondDone?[secondDone]:[])]);
  }
}
async function firstOwnerTwoTokenRace(){
  const ids=JSON.parse(sql(`WITH seed AS (SELECT gen_random_uuid() AS p,gen_random_uuid() AS u,
    gen_random_uuid() AS v,gen_random_uuid() AS t,gen_random_uuid() AS i,gen_random_uuid() AS j)
    SELECT row_to_json(seed) FROM seed;`));
  for(const id of Object.values(ids))assert.match(id,/^[0-9a-f-]{36}$/);
  const {p,u,v,t,i,j}=ids;
  sql(`INSERT INTO auth.users(id,email) VALUES('${p}','platform@example.invalid'),('${u}','first@example.invalid'),('${v}','second@example.invalid');
    INSERT INTO proof.platform_owners VALUES('${p}');INSERT INTO public.tenants(id,account_type) VALUES('${t}','standalone');
    INSERT INTO public.profiles VALUES('${u}',NULL),('${v}',NULL);
    INSERT INTO public.tenant_invite_tokens(id,tenant_id,token,kind,default_role,created_by,max_uses)
      VALUES('${i}','${t}','${i}','subaccount_owner','admin','${p}',1),('${j}','${t}','${j}','subaccount_owner','admin','${p}',1);`);
  const first=spawn(executable,connectionArgs(database),{env:{...process.env,PGAPPNAME:'exp08_first_owner_token_first'},stdio:['pipe','pipe','pipe']});
  const firstDone=new Promise((resolve,reject)=>{first.on('error',reject);first.on('close',resolve);});
  let second,secondDone,timer,output='',errors='';
  try{
    const ready=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('First original invitation did not settle under its transaction')),10000);
      first.stdout.on('data',c=>{output+=c;if(output.includes('EXP08_FIRST_OWNER_ACCEPTED'))resolve();});first.on('error',reject);
    });
    first.stdin.write(`BEGIN;SET request.jwt.claim.sub='${u}';SELECT public.accept_tenant_invite('${i}');\n\\echo EXP08_FIRST_OWNER_ACCEPTED\n`);
    await ready;clearTimeout(timer);
    second=spawn(executable,connectionArgs(database),{env:{...process.env,PGAPPNAME:'exp08_first_owner_token_second'},stdio:['pipe','pipe','pipe']});
    secondDone=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',resolve);});
    second.stderr.on('data',c=>{errors+=c;});
    second.stdin.end(`SET statement_timeout='20000';SET request.jwt.claim.sub='${v}';SELECT public.accept_tenant_invite('${j}');`);
    let waited=false;
    for(let attempt=0;attempt<40;attempt++){
      waited=sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity s WHERE s.datname='${database}'
        AND s.application_name='exp08_first_owner_token_second' AND s.wait_event_type='Lock'
        AND EXISTS(SELECT 1 FROM pg_stat_activity f WHERE f.datname='${database}'
          AND f.application_name='exp08_first_owner_token_first' AND f.pid=ANY(pg_blocking_pids(s.pid))));`)==='t';
      if(waited)break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(waited,'The second actual invitation must wait on the first original writer');
    first.stdin.end('COMMIT;\n\\q\n');assert.equal(await firstDone,0);const exit=await secondDone;
    const state=JSON.parse(sql(`SELECT json_build_object('seats',(SELECT count(*) FROM public.tenant_members WHERE tenant_id='${t}'),
      'owners',(SELECT count(*) FROM public.tenant_members WHERE tenant_id='${t}' AND is_owner),
      'holder',(SELECT owner_user_id='${u}' AND first_owner_seated_at IS NOT NULL FROM public.tenants WHERE id='${t}'),
      'first_uses',(SELECT uses FROM public.tenant_invite_tokens WHERE id='${i}'),
      'second_uses',(SELECT uses FROM public.tenant_invite_tokens WHERE id='${j}'),
      'first_profile',(SELECT active_tenant_id='${t}' FROM public.profiles WHERE user_id='${u}'),
      'second_profile',(SELECT active_tenant_id IS NOT NULL FROM public.profiles WHERE user_id='${v}'),
      'audits',(SELECT count(*) FROM public.paige_audit_log WHERE tenant_id='${t}'));`));
    console.log(JSON.stringify({phase:'first-owner-two-token-race',wait_on_first_writer:true,exit,state,error:errors.trim()}));
    assert.notEqual(exit,0,'The second first-owner token must refuse after the first owner commits');
    assert.match(errors,/OWNER_HISTORY_REQUIRES_RECOVERY/);
    assert.deepEqual(state,{seats:1,owners:1,holder:true,first_uses:1,second_uses:0,first_profile:true,second_profile:false,audits:1});
  }finally{
    clearTimeout(timer);if(first.exitCode===null)first.stdin.end('ROLLBACK;\n\\q\n');
    if(second&&second.exitCode===null)second.kill();
    await Promise.allSettled([firstDone,...(secondDone?[secondDone]:[])]);
  }
}
function connectionArgs(db) {
  return ['-X', '-q', '-A', '-t', '-h', host, '-p', process.env.PGPORT,
    '-U', process.env.PGUSER || 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'];
}
function sql(query, db = database, expectFailure = false, failurePattern = /EXP08 entity seat lifecycle (already exists|trigger drift|requires the original)/) {
  const r = spawnSync(executable, connectionArgs(db),
  { input: query, encoding: 'utf8', timeout: 30_000, env: process.env });
  if (r.error) throw r.error;
  if (expectFailure) {
    assert.notEqual(r.status, 0, 'Drifted candidate unexpectedly applied');
    assert.match(r.stderr, failurePattern);
  } else assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
async function replacementRace() {
  sql('select proof.reset_rows();');
  const first = spawn(executable, connectionArgs(database), { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const firstDone = new Promise((resolve, reject) => { first.on('error', reject); first.on('close', resolve); });
  let second; let secondDone; let output = ''; let timer;
  try {
    const locked = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Replacement lock was not acquired')), 10_000);
      first.stdout.on('data', chunk => { output += chunk; if (output.includes('EXP08_LOCKED')) resolve(); });
      first.on('error', reject);
    });
    first.stdin.write("BEGIN;\nUPDATE public.tenant_business_owners SET representative_user_id='e8000000-0000-4000-8000-000000060300' WHERE id='e8000000-0000-4000-8000-000000060001';\n\\echo EXP08_LOCKED\n");
    await locked; clearTimeout(timer);
    second = spawn(executable, connectionArgs(database), { env: { ...process.env, PGAPPNAME: 'exp08_entity_departure_race' }, stdio: ['pipe', 'pipe', 'pipe'] });
    secondDone = new Promise((resolve, reject) => { second.on('error', reject); second.on('close', resolve); });
    second.stdin.end("DELETE FROM public.tenant_members WHERE id='e8000000-0000-4000-8000-000000061001';\n");
    let observedLock = false;
    for (let i = 0; i < 20; i++) {
      observedLock = sql(`select exists(select 1 from pg_stat_activity where datname='${database}' and application_name='exp08_entity_departure_race' and wait_event_type='Lock');`) === 't';
      if (observedLock) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(observedLock, 'Second transaction must actually wait on the replacement row lock');
    first.stdin.end('COMMIT;\n\\q\n');
    assert.equal(await firstDone, 0); assert.equal(await secondDone, 0);
    assert.equal(sql("select representative_user_id='e8000000-0000-4000-8000-000000060300' and owner_seat_vacant_since is null from public.tenant_business_owners where id='e8000000-0000-4000-8000-000000060001';"), 't');
    assert.equal(sql("select count(*) from public.tenant_members where id='e8000000-0000-4000-8000-000000061001';"), '0');
    records.push({ phase: 'two-session-replacement-race', observed_lock_wait: true, replacement_preserved: true, original_seat_deleted: true });
  } finally {
    clearTimeout(timer);
    if (first.exitCode === null) first.kill();
    if (second && second.exitCode === null) second.kill();
    await Promise.allSettled([firstDone, ...(secondDone ? [secondDone] : [])]);
  }
}
function cases() {
  return sql('select row_to_json(t) from proof.run_cases() t;').split('\n').filter(Boolean).map(JSON.parse);
}
async function originalOwnerFloorRace() {
  sql("select proof.revoke_setup(); update public.tenants set owner_user_id=null where id='e8000000-0000-4000-8000-000000060010';");
  const first=spawn(executable,connectionArgs(database),{env:process.env,stdio:['pipe','pipe','pipe']});
  const firstDone=new Promise((resolve,reject)=>{first.on('error',reject);first.on('close',resolve);});
  let second;let secondDone;let output='';let secondError='';let timer;
  try {
    const locked=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('Original revoke did not acquire floor locks')),10_000);
      first.stdout.on('data',chunk=>{output+=chunk;if(output.includes('EXP08_FLOOR_LOCKED'))resolve();});
      first.on('error',reject);
    });
    first.stdin.write("BEGIN;\nselect set_config('request.jwt.claim.sub','e8000000-0000-4000-8000-000000060100',false);\nselect public.revoke_co_owner('e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060100');\n\\echo EXP08_FLOOR_LOCKED\n");
    await locked;clearTimeout(timer);
    second=spawn(executable,connectionArgs(database),{env:{...process.env,PGAPPNAME:'exp08_original_owner_floor_race'},stdio:['pipe','pipe','pipe']});
    secondDone=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',resolve);});
    second.stderr.on('data',chunk=>{secondError+=chunk;});
    second.stdin.end("select set_config('request.jwt.claim.sub','e8000000-0000-4000-8000-000000060300',false);\nselect public.revoke_co_owner('e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060300');\n");
    let observed=false;
    for(let i=0;i<20;i++) {
      observed=sql(`select exists(select 1 from pg_stat_activity where datname='${database}' and application_name='exp08_original_owner_floor_race' and wait_event_type='Lock');`)==='t';
      if(observed)break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(observed,'Original concurrent second step-down must actually wait on the owner lock');
    first.stdin.end('COMMIT;\n\\q\n');
    assert.equal(await firstDone,0);assert.notEqual(await secondDone,0);assert.match(secondError,/CO_OWNER_LAST/);
    assert.equal(sql("select count(*) from public.tenant_members where tenant_id='e8000000-0000-4000-8000-000000060010' and is_owner and status='active';"),'1');
    assert.equal(sql("select count(*) from public.paige_audit_log where action='tenant:revoke_co_owner';"),'1');
    records.push({phase:'original-revoke-two-session-floor-race',observed_lock_wait:true,remaining_active_owners:1,original_audits:1});
  } finally {
    clearTimeout(timer);if(first.exitCode===null)first.kill();if(second&&second.exitCode===null)second.kill();
    await Promise.allSettled([firstDone,...(secondDone?[secondDone]:[])]);
  }
}
function restore() {
  for (const [signature, body] of definitions) sql(`ALTER FUNCTION ${signature} OWNER TO postgres;\n${body}\nREVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated, service_role;`);
  sql('ALTER TABLE public.tenant_members ENABLE TRIGGER trg_tenant_members_business_owner_seat_ended; ALTER TABLE public.tenant_business_owners ENABLE TRIGGER trg_business_owner_representative_deleted;');
}
async function identityAdmissionRace(revocationFirst) {
  sql('select proof.reset_rows();');
  const target="'e8000000-0000-4000-8000-000000060010'";
  const person="'e8000000-0000-4000-8000-000000060100'";
  const hold=`SELECT public._team_hub_hold_seats(${target},ARRAY[${person}::uuid]);`;
  const revoke=`UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=${person};`;
  const first=spawn(executable,connectionArgs(database),{env:process.env,stdio:['pipe','pipe','pipe']});
  const firstDone=new Promise((resolve,reject)=>{first.on('error',reject);first.on('close',resolve);});
  let second;let secondDone;let firstOutput='';let secondOutput='';let secondError='';let timer;
  const application=`exp08_identity_${revocationFirst?'revocation':'admission'}_race`;
  try {
    const locked=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('Original identity/admission lock not acquired')),10000);
      first.stdout.on('data',chunk=>{firstOutput+=chunk;if(firstOutput.includes('EXP08_IDENTITY_LOCKED'))resolve();});
      first.on('error',reject);
    });
    first.stdin.write(`BEGIN;\n${revocationFirst?revoke:hold}\n\\echo EXP08_IDENTITY_LOCKED\n`);
    await locked;clearTimeout(timer);
    second=spawn(executable,connectionArgs(database),{env:{...process.env,PGAPPNAME:application},stdio:['pipe','pipe','pipe']});
    second.stdout.on('data',chunk=>{secondOutput+=chunk;});second.stderr.on('data',chunk=>{secondError+=chunk;});
    secondDone=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',resolve);});
    second.stdin.end(revocationFirst?hold:revoke);
    let waited=false;
    for(let i=0;i<20;i++){
      waited=sql(`select exists(select 1 from pg_stat_activity where datname='${database}' and application_name='${application}' and wait_event_type='Lock');`)==='t';
      if(waited)break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(waited,'Competing transaction must really wait on the current identity row');
    first.stdin.end('COMMIT;\n\\q\n');assert.equal(await firstDone,0);assert.equal(await secondDone,0,secondError);
    if(revocationFirst)assert.equal(secondOutput.trim(),'f','Admission must recheck the identity changed while its lock waited');
    else assert.ok(firstOutput.split(/\r?\n/).includes('t'),'The first admission must actually have held a valid identity');
    assert.equal(sql(hold),'f');
    records.push({phase:'original-identity-two-session-race',order:revocationFirst?'revocation-first':'admission-first',observed_lock_wait:true,current_admission_after_revocation:false});
  }finally{
    clearTimeout(timer);if(first.exitCode===null)first.kill();if(second&&second.exitCode===null)second.kill();
    await Promise.allSettled([firstDone,...(secondDone?[secondDone]:[])]);
  }
}
async function ownerReadDemotionRace(context) {
  sql("SELECT proof.owner_read_setup('admin');");
  const first=spawn(executable,connectionArgs(database),{env:process.env,stdio:['pipe','pipe','pipe']});
  const firstDone=new Promise((resolve,reject)=>{first.on('error',reject);first.on('close',resolve);});
  const application=`exp08_owner_reader_${context?'context':'screen'}_race`;
  let second;let secondDone;let timer;let firstOutput='';let secondOutput='';let secondError='';
  try{
    const locked=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('Original invitation read barrier not acquired')),10000);
      first.stdout.on('data',chunk=>{firstOutput+=chunk;if(firstOutput.includes('OWNER_READ_LOCKED'))resolve();});first.on('error',reject);
    });
    first.stdin.write('BEGIN; LOCK TABLE public.tenant_invite_tokens IN ACCESS EXCLUSIVE MODE;\n\\echo OWNER_READ_LOCKED\n');
    await locked;clearTimeout(timer);
    second=spawn(executable,connectionArgs(database),{env:{...process.env,PGAPPNAME:application},stdio:['pipe','pipe','pipe']});
    secondDone=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',resolve);});
    second.stdout.on('data',chunk=>{secondOutput+=chunk;});second.stderr.on('data',chunk=>{secondError+=chunk;});
    const reader=context?'public.get_paige_team_context()':'public.get_solo_team_workspace()';
    second.stdin.end(`SET request.jwt.claim.sub='e8000000-0000-4000-8000-000000060300'; SET proof.current_tenant='e8000000-0000-4000-8000-000000060010'; SELECT coalesce(${reader},'null'::jsonb);\n`);
    let waited=false;
    for(let i=0;i<40;i++){
      waited=sql(`select exists(select 1 from pg_stat_activity where datname='${database}' and application_name='${application}' and wait_event_type='Lock');`)==='t';
      if(waited)break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(waited,'Original reader must actually wait after its first Admin check');
    first.stdin.end("UPDATE public.tenant_members SET role='member' WHERE tenant_id='e8000000-0000-4000-8000-000000060010' AND user_id='e8000000-0000-4000-8000-000000060300'; COMMIT;\n\\q\n");
    assert.equal(await firstDone,0);assert.equal(await secondDone,0,secondError);
    const value=JSON.parse(secondOutput.trim());
    assert.equal(value,null,'Original read must abstain after role changed while waiting, including its old invitation fields');
    records.push({phase:'original-owner-read-two-session-demotion',reader:context?'context':'screen',observed_lock_wait:true,whole_stale_read_withheld:true,seat_change_is_fixture_port:true});
  }finally{
    clearTimeout(timer);if(first.exitCode===null)first.stdin.end('ROLLBACK;\n\\q\n');
    if(second&&second.exitCode===null)second.kill();await Promise.allSettled([firstDone,...(secondDone?[secondDone]:[])]);
  }
}
async function ownerReadAfterAdmissionRace(context,identity=false) {
  sql("SELECT proof.owner_read_setup('admin');");
  const first=spawn(executable,connectionArgs(database),{env:process.env,stdio:['pipe','pipe','pipe']});
  const firstDone=new Promise((resolve,reject)=>{first.on('error',reject);first.on('close',resolve);});
  const application=`exp08_owner_after_admission_${context?'context':'screen'}_${identity?'identity':'seat'}`;
  const mutatorApplication=application+'_change';
  let second;let third;let secondDone;let thirdDone;let timer;let output='';let readOutput='';let readError='';let mutationError='';
  try{
    const locked=new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error('Post-admission projection barrier not acquired')),10000);
      first.stdout.on('data',chunk=>{output+=chunk;if(output.includes('PROJECTION_LOCKED'))resolve();});first.on('error',reject);
    });
    first.stdin.write('BEGIN; LOCK TABLE public.platform_billing_contacts IN ACCESS EXCLUSIVE MODE;\n\\echo PROJECTION_LOCKED\n');
    await locked;clearTimeout(timer);
    second=spawn(executable,connectionArgs(database),{env:{...process.env,PGAPPNAME:application},stdio:['pipe','pipe','pipe']});
    secondDone=new Promise((resolve,reject)=>{second.on('error',reject);second.on('close',resolve);});
    second.stdout.on('data',chunk=>{readOutput+=chunk;});second.stderr.on('data',chunk=>{readError+=chunk;});
    const reader=context?'public.get_paige_team_context()':'public.get_solo_team_workspace()';
    second.stdin.end(`SET request.jwt.claim.sub='e8000000-0000-4000-8000-000000060300'; SET proof.current_tenant='e8000000-0000-4000-8000-000000060010'; SELECT coalesce(${reader},'null'::jsonb);\n`);
    let readWait=false;
    for(let i=0;i<40;i++){
      readWait=sql(`select exists(select 1 from pg_stat_activity where datname='${database}' and application_name='${application}' and wait_event_type='Lock');`)==='t';
      if(readWait)break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    assert.ok(readWait,'Native projection must wait AFTER its initial terminal admission');
    third=spawn(executable,connectionArgs(database),{env:{...process.env,PGAPPNAME:mutatorApplication},stdio:['pipe','pipe','pipe']});
    thirdDone=new Promise((resolve,reject)=>{third.on('error',reject);third.on('close',resolve);});
    third.stderr.on('data',chunk=>{mutationError+=chunk;});
    third.stdin.end(identity
      ? "UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id='e8000000-0000-4000-8000-000000060300';\n"
      : "UPDATE public.tenant_members SET role='member' WHERE tenant_id='e8000000-0000-4000-8000-000000060010' AND user_id='e8000000-0000-4000-8000-000000060300';\n");
    let changeWait=false;
    for(let i=0;i<40;i++){
      changeWait=sql(`select exists(select 1 from pg_stat_activity where datname='${database}' and application_name='${mutatorApplication}' and wait_event_type='Lock');`)==='t';
      if(changeWait || third.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,50));
    }
    const changedBeforeReturn=third.exitCode===0;
    first.stdin.end('COMMIT;\n\\q\n');
    assert.equal(await firstDone,0);assert.equal(await secondDone,0,readError);assert.equal(await thirdDone,0,mutationError);
    const value=JSON.parse(readOutput.trim());
    if(!changeWait)console.error(`EXP08 post-admission counterexample: reader=${context?'context':'screen'}; change_committed_before_projection_release=${changedBeforeReturn}; cached_invitations=${value?.invitations?.length??0}`);
    assert.ok(changeWait,'Actor change must wait until the already-authorized projection returns');
    assert.ok(value && value.invitations.length===1,'The first authorized read completes before the grant changes');
    const next=JSON.parse(sql(`SET request.jwt.claim.sub='e8000000-0000-4000-8000-000000060300'; SET proof.current_tenant='e8000000-0000-4000-8000-000000060010'; SELECT coalesce(${reader},'null'::jsonb);`));
    if(identity)assert.equal(next,null);else{assert.deepEqual(next.invitations,[]);assert.equal(next.account_holder_state,null);}
    records.push({phase:'original-owner-read-after-admission-race',reader:context?'context':'screen',change:identity?'identity-ban':'seat-demotion',projection_wait_observed:true,grant_change_wait_observed:true,current_followup_private_fields_withheld:true,authority_changes_are_fixture_ports:true});
  }finally{
    clearTimeout(timer);if(first.exitCode===null)first.stdin.end('ROLLBACK;\n\\q\n');
    if(second&&second.exitCode===null)second.kill();if(third&&third.exitCode===null)third.kill();
    await Promise.allSettled([firstDone,...(secondDone?[secondDone]:[]),...(thirdDone?[thirdDone]:[])]);
  }
}
const snapshot = `select json_build_object('members',(select json_agg(m order by id) from public.tenant_members m),
 'owners',(select json_agg(b order by id) from public.tenant_business_owners b));`;
let created = false;
try {
  sql(`CREATE DATABASE ${database};`, 'postgres'); created = true;
  sql(fixture);
  sql(scopeHelper);
  if(!onlyOwnerRead&&!onlyBilling){
    const historyFixture=readFileSync(new URL('../../supabase/tests/exp08_first_owner_history.sql',import.meta.url),'utf8');
    const historyPatch=readFileSync(new URL('./exp08-first-owner-history-patch.sql',import.meta.url),'utf8');
    const historyRun=patch=>sql(`BEGIN;\n${historyFixture}\n${patch}\nSELECT row_to_json(t) FROM proof.owner_history_cases() t;\nROLLBACK;`).split('\n').filter(Boolean).map(JSON.parse);
    const rows=historyRun(historyPatch);
    console.log(JSON.stringify({phase:'first-owner-history-component',cases:rows}));
    assert.equal(rows.length,22);assert.ok(rows.every(r=>r.passed),JSON.stringify(rows));
    for(const [name,from,to] of [
      ['owner role evidence removed',"m.is_owner OR m.role='owner'::public.tenant_role",'m.is_owner'],
      ['injected parent counted as child owner',"'tenant:subaccount_owner_established','tenant:grant_co_owner'","'tenant:deleted_injected_owner','tenant:subaccount_owner_established','tenant:grant_co_owner'"],
      ['first history rewrite permitted','IF OLD.first_owner_seated_at IS NOT NULL','IF false AND OLD.first_owner_seated_at IS NOT NULL'],
      ['owner tenant move forgotten','UPDATE OF is_owner,role,tenant_id','UPDATE OF is_owner,role'],
      ['guard hides caller as definer','RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER','RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER'],
      ['initial history write admission removed',"AND current_user<>'postgres'",'AND false'],
    ]){
      const mutated=historyPatch.replaceAll(from,to);assert.notEqual(mutated,historyPatch,name);
      const failed=historyRun(mutated).filter(r=>!r.passed).map(r=>r.case_name);
      assert.ok(failed.length,`${name}: survived`);
      console.log(JSON.stringify({phase:'first-owner-history-mutant',name,killed_by:failed}));
    }
    const replay=sql(`BEGIN;\n${historyFixture}\n${historyPatch}\nCREATE TEMP TABLE history_before AS SELECT jsonb_agg(to_jsonb(t) ORDER BY id) AS rows FROM public.tenants t;\n${historyPatch}\nSELECT jsonb_build_object('rows_unchanged',(SELECT rows FROM history_before)=(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenants t));\nROLLBACK;`);
    assert.deepEqual(JSON.parse(replay),{rows_unchanged:true});
    console.log(JSON.stringify({phase:'first-owner-history-replay',rows_unchanged:true}));
    const invitationFixture=readFileSync(new URL('../../supabase/tests/exp08_first_owner_invitations.sql',import.meta.url),'utf8');
    const invitationBodies=['create_tenant_invite_token','accept_tenant_invite'].map(name=>originalFunction(invitationSource,name)).join('\n');
    // Exact live original ACLs, including the incumbent public mint EXECUTE: preserve, never widen.
    const invitationACL="REVOKE ALL ON FUNCTION public.accept_tenant_invite(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.accept_tenant_invite(text) TO authenticated,service_role; GRANT EXECUTE ON FUNCTION public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text) TO authenticated;";
    const invitationSetup=`BEGIN;\n${historyFixture}\n${historyPatch}\n${invitationFixture}\n${invitationBodies}\n${invitationACL}\n`;
    const invitationBefore=sql(`${invitationSetup}SELECT row_to_json(t) FROM proof.owner_invitation_cases() t;\nROLLBACK;`).split('\n').filter(Boolean).map(JSON.parse);
    console.log(JSON.stringify({phase:'first-owner-original-invitations-before',cases:invitationBefore}));
    assert.equal(invitationBefore.length,13);
    assert.deepEqual(invitationBefore.filter(r=>!r.passed).map(r=>r.case_name),['mint_pointer','mint_suspended','mint_history','accept_pointer','accept_suspended','accept_history'],'Only approved missing platform-only first-owner gates may fail; original compatibility controls must work');
    const invitationPatch=readFileSync(new URL('./exp08-first-owner-invitation-patch.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
    const invitationRun=patch=>sql(`${invitationSetup}${patch}\nSELECT row_to_json(t) FROM proof.owner_invitation_cases() t;\n${patch}\nROLLBACK;`).split('\n').filter(Boolean).map(JSON.parse);
    const invitationAfter=invitationRun(invitationPatch);
    console.log(JSON.stringify({phase:'first-owner-original-invitations-after',cases:invitationAfter}));
    assert.equal(invitationAfter.length,13);assert.ok(invitationAfter.every(r=>r.passed),JSON.stringify(invitationAfter));
    for(const [name,from,to] of [
      ['all mint history gates bypassed','public._tenant_never_owned(_tenant_id)','true'],
      ['accept history gate bypassed','AND NOT _exp08_never_owned THEN','AND false THEN'],
      ['agency exception removed','AND NOT public.agency_can_manage_child(_tok.tenant_id, _tok.created_by)',''],
      ['non-shell acceptance incorrectly restricted','IF public._solo_shell_tenant(_tok.tenant_id) THEN','IF true THEN'],
    ]){
      const mutated=invitationPatch.replaceAll(from,to);assert.notEqual(mutated,invitationPatch,name);
      const failed=invitationRun(mutated).filter(r=>!r.passed).map(r=>r.case_name);
      assert.ok(failed.length,`${name}: survived`);console.log(JSON.stringify({phase:'first-owner-invitation-mutant',name,killed_by:failed}));
    }
    for(const [name,drift] of [
      ['accept path',"ALTER FUNCTION public.accept_tenant_invite(text) SET search_path TO public,auth;"],
      ['accept ACL',"GRANT EXECUTE ON FUNCTION public.accept_tenant_invite(text) TO anon;"],
      ['mint ACL',"REVOKE EXECUTE ON FUNCTION public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text) FROM PUBLIC;"],
      ['accept security',"ALTER FUNCTION public.accept_tenant_invite(text) SECURITY INVOKER;"],
      ['accept source',originalFunction(invitationSource,'accept_tenant_invite').replace('\nBEGIN','\nBEGIN\n  PERFORM 1;')],
    ]){
      sql(`${invitationSetup}${invitationPatch}\n${drift}\n${invitationPatch}\nROLLBACK;`,database,true,/EXP08 first owner invitation requires (original writer metadata|exact original source)/);
      console.log(JSON.stringify({phase:'first-owner-invitation-drift',name,refused:true}));
    }
    // Same uniquely-created database, real original writer and independent psql sessions. Restore
    // the original fixture afterward so no history/invitation ports leak into older proof groups.
    sql(`${invitationSetup}${invitationPatch}\nCOMMIT;`);
    await firstOwnerTwoTokenRace();
    await firstOwnerInvitationWait(false,'mint','agency_retained');await firstOwnerInvitationWait(false,'mint','platform_lost');await firstOwnerInvitationWait(false,'mint','agency_lost');
    await firstOwnerInvitationWait(false,'profile','agency_retained');await firstOwnerInvitationWait(false,'profile','agency_lost');
    await firstOwnerInvitationWait(false,'profile','platform_lost');
    await firstOwnerInvitationWait(false,'tenant','to_solo');await firstOwnerInvitationWait(false,'tenant','to_enterprise');
    await firstOwnerInvitationWait(false);await firstOwnerInvitationWait(true);
    await firstOwnerInvitationWait(false,'profile');await firstOwnerInvitationWait(true,'profile');
    const finalExpiryDefinition=sql("SELECT pg_get_functiondef('public.accept_tenant_invite(text)'::regprocedure);").replace(/\r\n/g,'\n');
    try{
      const mutant=finalExpiryDefinition.replace('PERFORM 1 FROM public.tenants WHERE id=_tok.tenant_id FOR UPDATE;','PERFORM 1;');
      assert.notEqual(mutant,finalExpiryDefinition);sql(mutant);
      await assert.rejects(()=>firstOwnerTwoTokenRace(),/The second first-owner token must refuse after the first owner commits/);
      console.log(JSON.stringify({phase:'first-owner-two-token-mutant',name:'original tenant serialization removed',killed_by:'two actual original acceptances'}));
    }finally{sql(finalExpiryDefinition);}
    try{
      const mutant=finalExpiryDefinition.replace("IF _tok.kind='subaccount_owner' AND _tok.expires_at<=pg_catalog.clock_timestamp() THEN",'IF false THEN');
      assert.notEqual(mutant,finalExpiryDefinition);sql(mutant);
      await assert.rejects(()=>firstOwnerInvitationWait(true,'profile'),/An invitation expiring during the actual tenant wait must refuse/);
      console.log(JSON.stringify({phase:'first-owner-invitation-expiry-mutant',name:'final expiry recheck removed',killed_by:'actual profile-write wait'}));
    }finally{sql(finalExpiryDefinition);}
    for(const [name,from,to,scenario] of [
      ['final agency/history recheck removed','IF public._solo_shell_tenant(_tok.tenant_id) AND public.is_platform_owner(_tok.created_by)','IF false','agency_lost'],
      ['final minter authority recheck removed','IF _minter_ok AND NOT (public.is_platform_owner(_tok.created_by)','IF false AND NOT (public.is_platform_owner(_tok.created_by)','platform_lost'],
    ]){
      try{
        const mutant=finalExpiryDefinition.replace(from,to);assert.notEqual(mutant,finalExpiryDefinition);sql(mutant);
        await assert.rejects(()=>firstOwnerInvitationWait(false,'profile',scenario),/Current Solo\/agency authority after the actual wait must enforce existing owner history/);
        console.log(JSON.stringify({phase:'first-owner-invitation-authority-mutant',name,killed_by:scenario+' actual profile-write wait'}));
      }finally{sql(finalExpiryDefinition);}
    }
    const finalMintDefinition=sql("SELECT pg_get_functiondef('public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text)'::regprocedure);").replace(/\r\n/g,'\n');
    for(const [name,from,to,scenario] of [
      ['final mint authority removed','IF NOT (public.is_platform_owner() OR public.agency_can_manage_child(_tenant_id,auth.uid())) THEN','IF false THEN','platform_lost'],
      ['final mint history removed','AND NOT public._tenant_never_owned(_tenant_id) THEN','AND false THEN','agency_lost'],
    ]){
      try{
        const mutant=finalMintDefinition.replace(from,to);assert.notEqual(mutant,finalMintDefinition);sql(mutant);
        await assert.rejects(()=>firstOwnerInvitationWait(false,'mint',scenario),/Authority lost during actual token INSERT must refuse/);
        console.log(JSON.stringify({phase:'first-owner-invitation-mint-mutant',name,killed_by:scenario+' actual token INSERT wait'}));
      }finally{sql(finalMintDefinition);}
    }
    sql(`DROP DATABASE ${database};`,'postgres');sql(`CREATE DATABASE ${database};`,'postgres');
    sql(fixture);sql(scopeHelper);
  }
  if(onlyOwnerHistory){
    console.log('Selected original first-owner history component only; NOT full native release proof.');
  } else {
  if(onlyBilling){
    sql(migration);
    sql(originalFunction(tenantAuthoritySource,'is_tenant_owner'));
    sql(originalFunction(coOwnerSource,'is_tenant_account_holder'));
    sql(originalFunction(coOwnerSource,'revoke_co_owner'));
    sql('REVOKE ALL ON FUNCTION public.revoke_co_owner(uuid,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.revoke_co_owner(uuid,uuid) TO authenticated,service_role;');
    sql(revokeFixture);billingBootstrap();
    console.log(sql("select json_agg(json_build_object('signature',oid::regprocedure::text,'body',md5(prosrc))) from pg_proc where proname in ('platform_billing_workspace_owner_scope','platform_billing_contact_revoke');"));
    sql(revokeMigration);billingCases();billingMigrationChecks();billingMutationControls();
    await billingAuthorityRace(true);await billingAuthorityRace(false);
    console.log('Selected original Billing integration only; NOT full native release proof.');
  } else {
  if(onlyOwnerRead){
    // Local development selection only. Normal CI invokes this runner WITHOUT arguments and
    // still executes every earlier lifecycle/admission assertion, mutant and two-session race.
    sql(migration);
    sql(originalFunction(tenantAuthoritySource,'is_tenant_owner'));
    sql(originalFunction(coOwnerSource,'is_tenant_account_holder'));
    const acl=coOwnerSource.match(/REVOKE ALL ON FUNCTION public\.is_tenant_account_holder\(uuid, uuid\) FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE ON FUNCTION public\.is_tenant_account_holder\(uuid, uuid\) TO service_role;/)?.[0];
    assert.ok(acl);sql(acl);
    sql(holderStateFixture);
    sql(originalFunction(invitationSource,'_tenant_account_holder_state'));
    const stateAcl=invitationSource.match(/REVOKE ALL ON FUNCTION public\._tenant_account_holder_state\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/)?.[0];
    assert.ok(stateAcl);sql(stateAcl);sql(actorFixture);
  } else {
  const baseline = cases();
  assert.deepEqual(baseline.filter(r => !r.passed).map(r => r.case_name),
    ['delete', 'demote', 'unlink', 'identity_move', 'first_vacancy', 'other_tenant_unchanged',
      'admin_delete_order', 'auth_fk_delete_first', 'auth_only_delete']);
  records.push({ phase: 'unchanged-baseline', cases: baseline });
  sql(migration);
  const current = cases(); assert.equal(current.length, 20); assert.ok(current.every(r => r.passed), JSON.stringify(current));
  records.push({ phase: 'candidate', cases: current });
  const beforeReplay = sql(snapshot); sql(migration); assert.equal(sql(snapshot), beforeReplay);
  records.push({ phase: 'exact-replay', passed: true, row_changes: 0 });

  const mutations = [
    ['Solo scope removed', s => s.replace('  IF public._solo_shell_tenant(OLD.tenant_id) IS DISTINCT FROM true THEN RETURN NULL; END IF;', '')],
    ['replacement predicate removed', s => s.replace('AND bo.representative_user_id = OLD.user_id', '')],
    ['billing and same-link preservation removed', s => s.replace(/  IF TG_OP = 'UPDATE' THEN[\s\S]*?  END IF;\n  -- Recheck/, '  -- Recheck')],
    ['first vacancy overwritten', s => s.replace('coalesce(bo.owner_seat_vacant_since, now())', 'now()')],
    ['metadata effect removed', s => s.replace(/  UPDATE public\.tenant_business_owners[\s\S]*?OLD\.user_id;/, '  PERFORM 1;')],
  ];
  for (const [name, mutate] of mutations) {
    const changed = mutate(definition); assert.notEqual(changed, definition, `${name}: mutation did not edit source`);
    sql(changed); const failed = cases().filter(r => !r.passed).map(r => r.case_name);
    assert.ok(failed.length, `${name}: survived`); records.push({ phase: 'mutant', name, killed_by: failed }); restore();
  }
  const fkMutants = [
    ['FK Solo scope removed', s => s.replace('  IF public._solo_shell_tenant(OLD.tenant_id) IS DISTINCT FROM true THEN RETURN NEW; END IF;', '')],
    ['living person deletion predicate removed', s => s.replace('AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.representative_user_id)', '')],
    ['original owner seat predicate removed', s => s.replace(/    AND EXISTS \(SELECT 1 FROM public\.tenant_members[\s\S]*?AND m\.is_owner\)/, '')],
    ['FK vacancy effect removed', s => s.replace('NEW.owner_seat_vacant_since := coalesce(OLD.owner_seat_vacant_since, now());', 'NULL;')],
  ];
  for (const [name, mutate] of fkMutants) {
    const changed = mutate(representativeDefinition); assert.notEqual(changed, representativeDefinition);
    sql(changed); const failed = cases().filter(r => !r.passed).map(r => r.case_name);
    assert.ok(failed.length, `${name}: survived`); records.push({ phase: 'mutant', name, killed_by: failed }); restore();
  }
  for (const [signature, body] of definitions) {
    const drift = [
      ['body', body.replace('BEGIN', 'BEGIN\n  PERFORM 1;')],
      ['security', `ALTER FUNCTION ${signature} SECURITY INVOKER;`],
      ['path', `ALTER FUNCTION ${signature} SET search_path='public';`],
      ['ACL', `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`],
      ['owner', `ALTER FUNCTION ${signature} OWNER TO service_role;`],
    ];
    for (const [name, mutation] of drift) {
      sql(mutation); sql(migration, database, true); restore(); records.push({ phase: 'drift-guard', signature, name, refused: true });
    }
  }
  for (const [table, trigger] of [['tenant_members', 'trg_tenant_members_business_owner_seat_ended'],
    ['tenant_business_owners', 'trg_business_owner_representative_deleted']]) {
    sql(`ALTER TABLE public.${table} DISABLE TRIGGER ${trigger};`); sql(migration, database, true); restore();
    records.push({ phase: 'drift-guard', name: trigger, refused: true });
  }
  sql(scopeHelper.replace('SELECT EXISTS', 'SELECT /* unknown implementation */ EXISTS'));
  sql(migration, database, true); sql(scopeHelper);
  records.push({ phase: 'drift-guard', name: 'original Solo scope helper', refused: true });
  for (const [signature, , hash] of definitions) {
    const metadata = JSON.parse(sql(`select json_build_object('body',md5(p.prosrc),'owner',p.proowner::regrole::text,
   'definer',p.prosecdef,'path',p.proconfig,'volatility',p.provolatile,
   'browser',has_function_privilege('authenticated',p.oid,'EXECUTE'),
   'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
   'service',has_function_privilege('service_role',p.oid,'EXECUTE'))
   from pg_proc p where p.oid='${signature}'::regprocedure;`));
    assert.deepEqual(metadata, { body: hash, owner: 'postgres', definer: true,
    path: ['search_path=""'], volatility: 'v', browser: false, anon: false, service: false });
    records.push({ phase: 'metadata', signature, metadata });
  }
  assert.ok(cases().every(r => r.passed));
  records.push({ phase: 'final-cases', passed: true });
  await replacementRace();
  sql(originalFunction(tenantAuthoritySource, 'is_tenant_owner'));
  sql(originalFunction(coOwnerSource, 'is_tenant_account_holder'));
  // Load the incumbent's REAL private/service ACL too; default CREATE FUNCTION PUBLIC execution
  // is not the production prerequisite and must not be accepted by the candidate's drift guard.
  const holderAcl=coOwnerSource.match(/REVOKE ALL ON FUNCTION public\.is_tenant_account_holder\(uuid, uuid\) FROM PUBLIC, anon, authenticated;\s*GRANT EXECUTE ON FUNCTION public\.is_tenant_account_holder\(uuid, uuid\) TO service_role;/)?.[0];
  assert.ok(holderAcl,'Original account-holder helper ACL required');sql(holderAcl);
  sql(originalFunction(coOwnerSource, 'revoke_co_owner'));
  sql('REVOKE ALL ON FUNCTION public.revoke_co_owner(uuid,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.revoke_co_owner(uuid,uuid) TO authenticated,service_role;');
  assert.equal(sql("select md5(prosrc) from pg_proc where oid='public.is_tenant_owner(uuid,uuid)'::regprocedure;"),'f392787e7469ed325960850ad091473d');
  assert.equal(sql("select md5(prosrc) from pg_proc where oid='public.is_tenant_account_holder(uuid,uuid)'::regprocedure;"),'4a3cab59aad7a70ff06a9054aa4aa60e');
  assert.equal(sql("select md5(prosrc) from pg_proc where oid='public.revoke_co_owner(uuid,uuid)'::regprocedure;"),'e2ba8ca80d63df58ebc93b34e5dc5f01');
  sql(revokeFixture);
  billingBootstrap();
  const writerCases = sql('select row_to_json(t) from proof.revoke_cases() t;').split('\n').filter(Boolean).map(JSON.parse);
  assert.deepEqual(writerCases.filter(r=>!r.passed).map(r=>r.case_name),
    ['holder_demotes_entity','entity_steps_down','replacement_preserved','repeat_refused']);
  assert.ok(writerCases.filter(r=>!r.passed).every(r=>r.detail.includes('23514')),'Original owner-link CHECK must be the actual baseline failure');
  records.push({phase:'original-revoke-before-repair',cases:writerCases});
  const writerMetadata="select (to_jsonb(p)-'prosrc')::text from pg_proc p where oid='public.revoke_co_owner(uuid,uuid)'::regprocedure;";
  const beforeWriter=sql(writerMetadata);
  sql(revokeMigration);
  assert.equal(sql(writerMetadata),beforeWriter,'Original writer OID/ACL/security/defaults/arguments conserved');
  const integratedCases=sql('select row_to_json(t) from proof.revoke_cases() t;').split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(integratedCases.length,12);assert.ok(integratedCases.every(r=>r.passed),JSON.stringify(integratedCases));
  records.push({phase:'original-revoke-after-repair',cases:integratedCases});
  records.push({phase:'original-billing-interlock',cases:billingCases()});
  billingMigrationChecks();billingMutationControls();
  await billingAuthorityRace(true);
  const writerSnapshot=sql(snapshot);const auditSnapshot=sql('select json_agg(a order by id) from public.paige_audit_log a;');
  sql(revokeMigration);
  assert.equal(sql(snapshot),writerSnapshot);assert.equal(sql('select json_agg(a order by id) from public.paige_audit_log a;'),auditSnapshot);
  records.push({phase:'original-revoke-migration-replay',row_changes:0});
  const patchedRevoke=sql("select pg_get_functiondef('public.revoke_co_owner(uuid,uuid)'::regprocedure);");
  const revokeCases=()=>sql('select row_to_json(t) from proof.revoke_cases() t;').split('\n').filter(Boolean).map(JSON.parse);
  for(const [name,mutate] of [
    ['SOLO scope removed',s=>s.replace('CASE WHEN public._solo_shell_tenant(_tenant) THEN NULL ELSE business_owner_id END','NULL')],
    ['original authority and currentness removed',s=>s.replaceAll('IF NOT (public.is_tenant_account_holder','IF false AND NOT (public.is_tenant_account_holder')],
    ['original holder protection removed',s=>s.replace('IF EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant AND owner_user_id = _user) THEN','IF false THEN')],
    ['original last-owner floor removed',s=>s.replace('IF _owner_count <= 1 THEN','IF false THEN')],
  ]) {
    const changed=mutate(patchedRevoke);assert.notEqual(changed,patchedRevoke,name);
    sql(changed);const failures=revokeCases().filter(r=>!r.passed).map(r=>r.case_name);
    assert.ok(failures.length,`${name}: integration mutant survived`);
    records.push({phase:'original-revoke-mutant',name,killed_by:failures});sql(patchedRevoke);
  }
  const drift=[
    ['unknown body',patchedRevoke.replace('BEGIN','BEGIN\n PERFORM 1;')],
    ['partial link patch',patchedRevoke.replace('THEN NULL ELSE business_owner_id END','THEN business_owner_id ELSE business_owner_id END')],
    ['ACL','GRANT EXECUTE ON FUNCTION public.revoke_co_owner(uuid,uuid) TO anon;'],
    ['grant option','GRANT EXECUTE ON FUNCTION public.revoke_co_owner(uuid,uuid) TO authenticated WITH GRANT OPTION;'],
    ['owner','ALTER FUNCTION public.revoke_co_owner(uuid,uuid) OWNER TO service_role;'],
    ['path',"ALTER FUNCTION public.revoke_co_owner(uuid,uuid) SET search_path='pg_catalog';"],
    ['security','ALTER FUNCTION public.revoke_co_owner(uuid,uuid) SECURITY INVOKER;'],
    ['volatility','ALTER FUNCTION public.revoke_co_owner(uuid,uuid) STABLE;'],
  ];
  for(const [name,changed] of drift) {
    sql(changed);const before=sql("select pg_get_functiondef('public.revoke_co_owner(uuid,uuid)'::regprocedure);");
    sql(revokeMigration,database,true,/EXP08 entity revoke/);
    assert.equal(sql("select pg_get_functiondef('public.revoke_co_owner(uuid,uuid)'::regprocedure);"),before);
    sql(`ALTER FUNCTION public.revoke_co_owner(uuid,uuid) OWNER TO postgres;\n${patchedRevoke};\nREVOKE ALL ON FUNCTION public.revoke_co_owner(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.revoke_co_owner(uuid,uuid) TO authenticated,service_role;`);
    records.push({phase:'original-revoke-drift',name,refused:true});
  }
  for(const [name,changed] of [
    ['seat helper body',definition.replace('BEGIN','BEGIN\n PERFORM 1;')],
    ['representative helper body',representativeDefinition.replace('BEGIN','BEGIN\n PERFORM 1;')],
    ['Solo helper body',scopeHelper.replace('SELECT EXISTS','SELECT /* unknown */ EXISTS')],
  ]) {
    sql(changed);sql(revokeMigration,database,true,/EXP08 entity revoke/);restore();sql(scopeHelper);
    records.push({phase:'original-revoke-drift',name,refused:true});
  }
  for(const [relation,name] of [['tenant_members','trg_tenant_members_business_owner_seat_ended'],['tenant_business_owners','trg_business_owner_representative_deleted']]) {
    const trigger=sql(`select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.${relation}'::regclass and tgname='${name}';`);
    sql(`DROP TRIGGER ${name} ON public.${relation}; ${trigger.replace(' FOR EACH ROW',' FOR EACH ROW WHEN (false)')};`);
    sql(revokeMigration,database,true,/EXP08 entity revoke/);
    sql(`DROP TRIGGER ${name} ON public.${relation}; ${trigger};`);
    records.push({phase:'original-revoke-drift',name:`${name} disabled by WHEN`,refused:true});
  }
  assert.ok(revokeCases().every(r=>r.passed));
  const revokeMetadata=JSON.parse(sql("select json_build_object('body',md5(prosrc),'owner',proowner::regrole::text,'definer',prosecdef,'path',proconfig,'acl',proacl::text) from pg_proc where oid='public.revoke_co_owner(uuid,uuid)'::regprocedure;"));
  records.push({phase:'original-revoke-final-metadata',metadata:revokeMetadata});
  await originalOwnerFloorRace();
  sql(privateHelper(collaborationSource,'_team_hub_is_active','uuid,uuid'));
  sql(privateHelper(lifecycleSource,'_team_hub_participates','uuid,uuid'));
  sql(privateHelper(lifecycleSource,'_team_hub_refusal','uuid'));
  assert.equal(sql("select md5(prosrc) from pg_proc where oid='public._team_hub_refusal(uuid)'::regprocedure;"),'b6ee98245fdbb9e0229547061a9391d2');
  sql(actorFixture);
  const actorCases=()=>sql('select row_to_json(t) from proof.actor_cases() t;').split('\n').filter(Boolean).map(JSON.parse);
  const actorBaseline=actorCases();
  assert.deepEqual(actorBaseline.filter(r=>!r.passed).map(r=>r.case_name),['deleted_identity','missing_identity_member','foreign_expected_ended_identity']);
  records.push({phase:'original-actor-lifecycle-before',cases:actorBaseline});
  const actorMetadata="select (to_jsonb(p)-'prosrc')::text from pg_proc p where oid='public._team_hub_refusal(uuid)'::regprocedure;";
  const actorBefore=sql(actorMetadata);
  sql(actorMigration);assert.equal(sql(actorMetadata),actorBefore);
  const actorCurrent=actorCases();assert.equal(actorCurrent.length,15);assert.ok(actorCurrent.every(r=>r.passed),JSON.stringify(actorCurrent));
  records.push({phase:'original-actor-lifecycle-after',cases:actorCurrent});
  const actorSnapshot=sql(snapshot);sql(actorMigration);assert.equal(sql(snapshot),actorSnapshot);
  records.push({phase:'original-actor-lifecycle-replay',row_changes:0});
  const patchedActor=sql("select pg_get_functiondef('public._team_hub_refusal(uuid)'::regprocedure);");
  for(const [name,mutate] of [
    ['identity correlation removed',s=>s.replace('WHERE u.id=actor','WHERE true')],
    ['identity predicate inverted',s=>s.replace('OR NOT EXISTS(SELECT 1 FROM auth.users','OR EXISTS(SELECT 1 FROM auth.users')],
    ['original active-seat refusal removed',s=>s.replace('IF resolved IS NULL OR NOT public._team_hub_is_active(resolved, actor)','IF resolved IS NULL')],
    ['original workspace fence removed',s=>s.replace('IF p_expected_tenant IS DISTINCT FROM resolved','IF false AND p_expected_tenant IS DISTINCT FROM resolved')],
    ['original tier restriction removed',s=>s.replace('IF NOT EXISTS(SELECT 1 FROM public.tenants','IF false AND NOT EXISTS(SELECT 1 FROM public.tenants')],
    ['original conversations switch removed',s=>s.replace('IF NOT public._team_hub_participates','IF false AND NOT public._team_hub_participates')],
  ]) {
    const changed=mutate(patchedActor);assert.notEqual(changed,patchedActor,name);sql(changed);
    const failed=actorCases().filter(r=>!r.passed).map(r=>r.case_name);assert.ok(failed.length,`${name}: actor mutant survived`);
    records.push({phase:'original-actor-lifecycle-mutant',name,killed_by:failed});sql(patchedActor);
  }
  for(const [name,changed] of [
    ['unknown body',patchedActor.replace('BEGIN','BEGIN\n PERFORM 1;')],
    ['partial guard',patchedActor.replace('WHERE u.id=actor','WHERE false')],
    ['ACL','GRANT EXECUTE ON FUNCTION public._team_hub_refusal(uuid) TO authenticated;'],
    ['owner','ALTER FUNCTION public._team_hub_refusal(uuid) OWNER TO service_role;'],
    ['path',"ALTER FUNCTION public._team_hub_refusal(uuid) SET search_path='public';"],
    ['security','ALTER FUNCTION public._team_hub_refusal(uuid) SECURITY DEFINER;'],
    ['volatility','ALTER FUNCTION public._team_hub_refusal(uuid) VOLATILE;'],
    ['strictness','ALTER FUNCTION public._team_hub_refusal(uuid) STRICT;'],
    ['leakproof','ALTER FUNCTION public._team_hub_refusal(uuid) LEAKPROOF;'],
    ['parallel','ALTER FUNCTION public._team_hub_refusal(uuid) PARALLEL SAFE;'],
  ]) {
    sql(changed);const before=sql("select pg_get_functiondef('public._team_hub_refusal(uuid)'::regprocedure);");
    sql(actorMigration,database,true,/EXP08 actor lifecycle/);
    assert.equal(sql("select pg_get_functiondef('public._team_hub_refusal(uuid)'::regprocedure);"),before);
    sql(`ALTER FUNCTION public._team_hub_refusal(uuid) OWNER TO postgres;\n${patchedActor};\nREVOKE ALL ON FUNCTION public._team_hub_refusal(uuid) FROM PUBLIC,anon,authenticated,service_role;`);
    records.push({phase:'original-actor-lifecycle-drift',name,refused:true});
  }
  sql(actorMigration);assert.ok(actorCases().every(r=>r.passed));
  records.push({phase:'original-actor-lifecycle-final-metadata',metadata:JSON.parse(sql("select json_build_object('body',md5(prosrc),'owner',proowner::regrole::text,'definer',prosecdef,'path',proconfig,'acl',proacl::text) from pg_proc where oid='public._team_hub_refusal(uuid)'::regprocedure;"))});
  sql(holderStateFixture);
  // Already shipped in I1: characterize the REAL source, never install a duplicate I2 implementation.
  const originalHolderState=originalFunction(invitationSource,'_tenant_account_holder_state');
  const stateAcl=invitationSource.match(/REVOKE ALL ON FUNCTION public\._tenant_account_holder_state\(uuid\) FROM PUBLIC, anon, authenticated, service_role;/)?.[0];
  assert.ok(stateAcl,'Original private holder-state ACL required');sql(`${originalHolderState}\n${stateAcl}`);
  const holderCases=()=>sql('select row_to_json(t) from proof.holder_state_cases() t;').split('\n').filter(Boolean).map(JSON.parse);
  const holderCurrent=holderCases();assert.equal(holderCurrent.length,20);
  assert.ok(holderCurrent.every(r=>r.passed),JSON.stringify(holderCurrent));
  records.push({phase:'original-holder-state-current-I1',cases:holderCurrent});
  const incumbentHolderMetadata="select (to_jsonb(p)-'prosrc')::text from pg_proc p where oid='public.is_tenant_account_holder(uuid,uuid)'::regprocedure;";
  const holderSnapshot="select json_build_object('tenants',(select json_agg(t order by id) from public.tenants t),'users',(select json_agg(u order by id) from auth.users u),'members',(select json_agg(m order by id) from public.tenant_members m),'owners',(select json_agg(o order by id) from public.tenant_business_owners o),'audit',(select json_agg(a order by id) from public.paige_audit_log a));";
  const incumbentBefore=sql(incumbentHolderMetadata);
  const holderSignature='public._tenant_account_holder_state(uuid)';
  const holderDefinition=sql(`select pg_get_functiondef('${holderSignature}'::regprocedure);`);
  const holderMetadata=()=>sql(`select to_jsonb(p)::text from pg_proc p where oid='${holderSignature}'::regprocedure;`);
  assert.equal(sql(`select md5(prosrc) from pg_proc where oid='${holderSignature}'::regprocedure;`),'8f9d27463a4c825994f165a5777aca1f');
  const holderBeforeReplay=holderMetadata();const holderBeforeRows=sql(holderSnapshot);
  sql(`${originalHolderState}\n${stateAcl}`);
  assert.equal(holderMetadata(),holderBeforeReplay);assert.equal(sql(holderSnapshot),holderBeforeRows);
  assert.equal(sql(incumbentHolderMetadata),incumbentBefore);
  records.push({phase:'original-holder-state-original-definition-replay',row_changes:0,metadata_changes:0});
  for(const role of ['anon','authenticated','service_role']){
    sql(`BEGIN; SET LOCAL ROLE ${role}; SELECT public._tenant_account_holder_state('e8000000-0000-4000-8000-000000060010');`,database,true,/permission denied for function _tenant_account_holder_state/);
    records.push({phase:'original-holder-state-private-role',role,execution_denied:true});
  }
  for(const [name,mutate] of [
    ['archive precedence removed',s=>s.replace('WHEN t.archived_at IS NOT NULL','WHEN false AND t.archived_at IS NOT NULL')],
    ['current identity check removed',s=>s.replace('OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.owner_user_id)','')],
    ['incumbent holder check removed',s=>s.replace('WHEN public.is_tenant_account_holder(t.owner_user_id, t.id)','WHEN false AND public.is_tenant_account_holder(t.owner_user_id, t.id)')],
    ['paused tenant correlation removed',s=>s.replace('m.tenant_id = t.id AND ','')],
    ['paused person correlation removed',s=>s.replace('m.user_id = t.owner_user_id','true')],
    ['paused owner predicate removed',s=>s.replace('AND m.is_owner = true ', '')],
    ['missing target abstention removed',s=>s.replace('WHERE t.id = _tenant','WHERE true')],
  ]){
    const changed=mutate(holderDefinition);assert.notEqual(changed,holderDefinition,name);sql(changed);
    const failed=holderCases().filter(r=>!r.passed).map(r=>r.case_name);assert.ok(failed.length,`${name}: holder mutant survived`);
    records.push({phase:'original-holder-state-mutant',name,killed_by:failed});sql(holderDefinition);
  }
  assert.ok(holderCases().every(r=>r.passed));
  assert.equal(holderMetadata(),holderBeforeReplay);assert.equal(sql(incumbentHolderMetadata),incumbentBefore);
  records.push({phase:'original-holder-state-final-metadata',metadata:JSON.parse(holderMetadata())});
  sql(privateHelper(lifecycleSource,'_team_hub_hold_seats','uuid,uuid[]'));
  sql(identityFixture);
  const identityCases=()=>sql('select row_to_json(t) from proof.identity_cases() t;').split('\n').filter(Boolean).map(JSON.parse);
  const identityBefore=identityCases();assert.equal(identityBefore.length,22);
  assert.deepEqual(identityBefore.filter(r=>!r.passed).map(r=>r.case_name),['deleted_actor','deleted_target','soft_deleted_actor','soft_deleted_target','banned_actor','banned_target','indefinite_ban','mixed_banned_selection']);
  records.push({phase:'original-identity-before',cases:identityBefore});
  const identitySignatures=['public._team_hub_is_active(uuid,uuid)','public._team_hub_participates(uuid,uuid)','public._team_hub_hold_seats(uuid,uuid[])'];
  const identityMetadata=()=>sql(`select json_agg(to_jsonb(p)-'prosrc' order by p.oid)::text from pg_proc p where p.oid in (${identitySignatures.map(s=>`'${s}'::regprocedure`).join(',')});`);
  const identityInitialMetadata=identityMetadata();const identityInitialRows=sql(holderSnapshot);
  sql(identityMigration);assert.equal(identityMetadata(),identityInitialMetadata);assert.equal(sql(holderSnapshot),identityInitialRows);
  const identityAfter=identityCases();assert.ok(identityAfter.every(r=>r.passed),JSON.stringify(identityAfter));
  records.push({phase:'original-identity-after',cases:identityAfter});
  const identityDefinitions=identitySignatures.map(signature=>({signature,definition:sql(`select pg_get_functiondef('${signature}'::regprocedure);`)}));
  const identityReplayRows=sql(holderSnapshot);sql(identityMigration);
  assert.equal(identityMetadata(),identityInitialMetadata);assert.equal(sql(holderSnapshot),identityReplayRows);
  records.push({phase:'original-identity-replay',row_changes:0,metadata_changes:0});
  const identityRestore=()=>{for(const {signature,definition} of identityDefinitions)
    sql(`ALTER FUNCTION ${signature} OWNER TO postgres;\n${definition};\nREVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated,service_role;\nREVOKE GRANT OPTION FOR EXECUTE ON FUNCTION ${signature} FROM postgres;`);};
  for(const [index,name,mutate] of [
    [0,'active identity correlation removed',s=>s.replace('u.id=p_user','true')],
    [0,'soft deletion ignored',s=>s.replace('u.deleted_at IS NULL','true')],
    [0,'ban ignored',s=>s.replace('(u.banned_until IS NULL OR u.banned_until<=now())','true')],
    [0,'expired ban remains blocked',s=>s.replace('(u.banned_until IS NULL OR u.banned_until<=now())','u.banned_until IS NULL')],
    [1,'participation current identity bypassed',s=>s.replace('AND public._team_hub_is_active(p_tenant,p_user)','')],
    [2,'held identity correlation removed',s=>s.replace('ON u.id=m.user_id','ON true')],
    [2,'held soft deletion ignored',s=>s.replace('u.deleted_at IS NULL','true')],
    [2,'held ban ignored',s=>s.replace('(u.banned_until IS NULL OR u.banned_until<=now())','true')],
  ]){
    const original=identityDefinitions[index].definition;const changed=mutate(original);assert.notEqual(changed,original,name);sql(changed);
    const failed=identityCases().filter(r=>!r.passed).map(r=>r.case_name);assert.ok(failed.length,`${name}: identity mutant survived`);
    records.push({phase:'original-identity-mutant',name,killed_by:failed});identityRestore();
  }
  for(const {signature,definition} of identityDefinitions){
    for(const [name,change] of [
      ['unknown source',definition.replace('/* exp08_current_identity_v1 */','')],
      ['partial source',definition.replace('exp08_current_identity_v1','exp08_current_identity_v1 altered')],
      ['authenticated ACL',`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`],
      ['service ACL',`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`],
      ['grant option',`GRANT EXECUTE ON FUNCTION ${signature} TO postgres WITH GRANT OPTION;`],
      ['owner',`ALTER FUNCTION ${signature} OWNER TO service_role;`],
      ['security',`ALTER FUNCTION ${signature} SECURITY DEFINER;`],
      ['path',`ALTER FUNCTION ${signature} SET search_path='public';`],
      ['volatility',`ALTER FUNCTION ${signature} ${signature.includes('_hold_seats')?'STABLE':'VOLATILE'};`],
      ['strictness',`ALTER FUNCTION ${signature} STRICT;`],
      ['parallel',`ALTER FUNCTION ${signature} PARALLEL SAFE;`],
      ['leakproof',`ALTER FUNCTION ${signature} LEAKPROOF;`],
    ]){
      sql(change);const before=sql(`select to_jsonb(p)::text from pg_proc p where oid='${signature}'::regprocedure;`);
      sql(identityMigration,database,true,/EXP08 identity currentness/);
      assert.equal(sql(`select to_jsonb(p)::text from pg_proc p where oid='${signature}'::regprocedure;`),before);
      identityRestore();records.push({phase:'original-identity-drift',signature,name,refused:true,drift_not_rewritten:true});
    }
  }
  sql(identityMigration);assert.ok(identityCases().every(r=>r.passed));
  assert.equal(identityMetadata(),identityInitialMetadata);
  await identityAdmissionRace(false);await identityAdmissionRace(true);
  records.push({phase:'original-identity-final-metadata',metadata:JSON.parse(sql(`select json_agg(json_build_object('signature',p.oid::regprocedure::text,'body',md5(p.prosrc),'owner',p.proowner::regrole::text,'definer',p.prosecdef,'path',p.proconfig,'acl',p.proacl::text) order by p.oid) from pg_proc p where p.oid in (${identitySignatures.map(s=>`'${s}'::regprocedure`).join(',')});`))});
  }
  if(!onlyOwnerRead)sql('DROP TABLE public.platform_billing_contacts;');
  sql(ownerReadFixture);
  sql(originalFunction(workspaceReadSource,'get_solo_team_workspace'));
  sql(originalFunction(contextReadSource,'get_paige_team_context'));
  sql('REVOKE ALL ON FUNCTION public.get_solo_team_workspace(text,text,integer,integer),public.get_paige_team_context() FROM PUBLIC,anon,service_role; GRANT EXECUTE ON FUNCTION public.get_solo_team_workspace(text,text,integer,integer),public.get_paige_team_context() TO authenticated;');
  assert.equal(sql("select md5(prosrc) from pg_proc where oid='public.get_solo_team_workspace(text,text,integer,integer)'::regprocedure;"),'ded4ae3cb9d57f2c1ed0cef52493590b');
  assert.equal(sql("select md5(prosrc) from pg_proc where oid='public.get_paige_team_context()'::regprocedure;"),'623d712d745867ed8f7d29374e3a6078');
  // Each group retains the same assertions. Bound expensive fixture TRUNCATE/reset work per
  // psql call instead of weakening the original 30-second command timeout or omitting cases.
  const ownerReadNames=['holder','admin','coowner','member','owner_label_only','holder_missing','holder_paused','holder_archived',
    'self_billing','other_billing_private','revoked_billing','foreign_billing','entity_label','private_legal_fields','held_seat',
    'holder_options','options_private','pending_option','expired_option','individual_excluded','foreign_entity_excluded',
    'search_paging','invitations_preserved','conversations_off','suspended_viewer','no_actor','no_workspace',
    'missing_identity','soft_deleted_identity','banned_identity','expired_ban','unsupported_tier'];
  const ownerReadCases=()=>{
    const result=[];
    for(let i=0;i<ownerReadNames.length;i+=9){
      const names=ownerReadNames.slice(i,i+9);
      const group=sql(`select row_to_json(t) from proof.owner_read_cases(ARRAY[${names.map(n=>`'${n}'`).join(',')}]) t;`).split('\n').filter(Boolean).map(JSON.parse);
      assert.deepEqual(group.map(r=>r.case_name),names,'Every original case must execute exactly once in order');result.push(...group);
    }
    return result;
  };
  const ownerReadBefore=ownerReadCases();
  records.push({phase:'original-owner-read-before',cases:ownerReadBefore});
  assert.equal(ownerReadBefore.length,32);
  assert.deepEqual(ownerReadBefore.filter(r=>r.passed).map(r=>r.case_name),['suspended_viewer','no_actor','no_workspace']);
  console.error(`EXP08 owner read baseline: ${ownerReadBefore.filter(r=>!r.passed).length} expected failing / ${ownerReadBefore.length} cases`);
  const readerSignatures=['public.get_solo_team_workspace(text,text,integer,integer)','public.get_paige_team_context()'];
  const readerMetadata=()=>sql(`select jsonb_agg((to_jsonb(p)-'prosrc'-'proargdefaults')||jsonb_build_object('proargdefaults',pg_get_expr(proargdefaults,0)) order by p.oid)::text from pg_proc p where p.oid in (${readerSignatures.map(s=>`'${s}'::regprocedure`).join(',')});`);
  const readRows=()=>sql("select jsonb_build_object('tenants',(select jsonb_agg(to_jsonb(t) order by id) from public.tenants t),'members',(select jsonb_agg(to_jsonb(m) order by id) from public.tenant_members m),'owners',(select jsonb_agg(to_jsonb(b) order by id) from public.tenant_business_owners b),'invites',(select jsonb_agg(to_jsonb(i) order by id) from public.tenant_invite_tokens i),'billing',(select jsonb_agg(to_jsonb(b) order by id) from public.platform_billing_contacts b),'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.paige_audit_log a))::text;");
  const readerBeforeMetadata=readerMetadata();const readerBeforeRows=readRows();
  sql(ownerReadPatch);assert.equal(readerMetadata(),readerBeforeMetadata);assert.equal(readRows(),readerBeforeRows);
  const ownerReadAfter=ownerReadCases();records.push({phase:'original-owner-read-after',cases:ownerReadAfter});
  assert.ok(ownerReadAfter.every(r=>r.passed),JSON.stringify(ownerReadAfter));
  console.error(`EXP08 owner read candidate: ${ownerReadAfter.length} cases passed; original metadata/rows conserved`);
  await ownerReadAfterAdmissionRace(false);await ownerReadAfterAdmissionRace(true);
  await ownerReadAfterAdmissionRace(false,true);await ownerReadAfterAdmissionRace(true,true);
  // psql's Windows text stdout uses CRLF; source-edit mutants must target the actual LF SQL
  // rather than silently missing a multiline predicate. Native stored-body MD5s remain exact.
  const readerDefinitions=readerSignatures.map(signature=>({signature,definition:sql(`select pg_get_functiondef('${signature}'::regprocedure);`).replace(/\r\n/g,'\n')}));
  const readerReplayRows=readRows();sql(ownerReadPatch);assert.equal(readRows(),readerReplayRows);assert.equal(readerMetadata(),readerBeforeMetadata);
  records.push({phase:'original-owner-read-replay',row_changes:0,metadata_changes:0});
  const restoreReaders=()=>{for(const {signature,definition} of readerDefinitions)sql(`ALTER FUNCTION ${signature} OWNER TO postgres;\n${definition};\nREVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`);};
  for(const [name,mutate] of [
    ['holder options widened to admin',s=>s.replace("AND public.is_tenant_account_holder(_actor,_tenant) THEN","AND _can_manage THEN")],
    ['billing privacy removed',s=>s.replace('(public.is_tenant_account_holder(_actor,_tenant) OR tm.user_id=_actor)','true')],
    ['member entity privacy removed',s=>s.replace(/AND \(public\.is_tenant_owner\(_actor,_tenant\) OR EXISTS\(SELECT 1 FROM public\.tenant_members current_admin[^\n]*?\)\) THEN/,'THEN')],
    ['owner role label treated as actual owner',s=>s.replace(/\(public\.is_tenant_owner\(_actor,_tenant\) OR EXISTS\(SELECT 1 FROM public\.tenant_members current_admin[^\n]*?\)\)/,'_can_manage')],
    ['option live expiry removed',s=>s.replace('AND ti.expires_at>now()','')],
    ['held individual filter removed',s=>s.replace("AND bo.owner_kind<>'individual' AND bo.owner_seat_vacant_since",'AND bo.owner_seat_vacant_since')],
    ['option individual filter removed',s=>s.replace("AND bo.owner_kind<>'individual'),'[]'::jsonb)","),'[]'::jsonb)")],
    ['billing tenant scope removed',s=>s.replace('bc.tenant_id=_tenant AND','')],
    ['billing revocation removed',s=>s.replace('AND bc.revoked_at IS NULL','')],
  ]){
    const original=readerDefinitions[0].definition;const changed=mutate(original);assert.notEqual(changed,original,name);sql(changed);
    const failed=ownerReadCases().filter(r=>!r.passed).map(r=>r.case_name);assert.ok(failed.length,`${name}: owner read mutant survived`);
    records.push({phase:'original-owner-read-mutant',name,killed_by:failed});restoreReaders();
  }
  for(const {signature,definition} of readerDefinitions){
    for(const [name,statement] of [
      ['source',definition.replace('exp08_original_owner_read_v1','changed_owner_read')],
      ['public grant',`GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC;`],
      ['service grant',`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`],
      ['grant option',`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated WITH GRANT OPTION;`],
      ['owner',`ALTER FUNCTION ${signature} OWNER TO authenticated;`],
      ['security',`ALTER FUNCTION ${signature} SECURITY INVOKER;`],
      ['path',`ALTER FUNCTION ${signature} SET search_path=public;`],
      ['stability',`ALTER FUNCTION ${signature} STABLE;`],
      ['strict',`ALTER FUNCTION ${signature} STRICT;`],
      ['parallel',`ALTER FUNCTION ${signature} PARALLEL SAFE;`],
      ['leakproof',`ALTER FUNCTION ${signature} LEAKPROOF;`],
    ]){
      sql(statement);const before=readerSignatures.map(s=>sql(`select pg_get_functiondef('${s}'::regprocedure);`));const beforeRows=readRows();
      sql(ownerReadPatch,database,true,/EXP08 owner read/);
      assert.deepEqual(readerSignatures.map(s=>sql(`select pg_get_functiondef('${s}'::regprocedure);`)),before);assert.equal(readRows(),beforeRows);
      records.push({phase:'original-owner-read-drift',signature,name,refused:true,no_partial_rewrite:true});restoreReaders();
    }
  }
  const defaultDrift=readerDefinitions[0].definition.replace('_limit integer DEFAULT 25','_limit integer DEFAULT 26');
  assert.notEqual(defaultDrift,readerDefinitions[0].definition);sql(defaultDrift);
  sql(ownerReadPatch,database,true,/EXP08 owner read original reader metadata drift/);restoreReaders();
  records.push({phase:'original-owner-read-default-drift',refused:true});
  sql(ownerReadPatch);assert.ok(ownerReadCases().every(r=>r.passed));
  sql("SELECT proof.owner_read_setup('holder');");
  assert.equal(sql("BEGIN; SET LOCAL request.jwt.claim.sub='e8000000-0000-4000-8000-000000060100'; SET LOCAL proof.current_tenant='e8000000-0000-4000-8000-000000060010'; SET LOCAL ROLE authenticated; SELECT (public.get_solo_team_workspace()->>'viewer_is_account_holder')::boolean AND (public.get_paige_team_context()->>'viewer_is_account_holder')::boolean; ROLLBACK;"),'t');
  records.push({phase:'original-owner-read-authenticated-role',admitted:true,claims_resolver_are_ports:true});
  for(const role of ['anon','service_role'])for(const signature of readerSignatures){
    const call=signature.includes('workspace')?'public.get_solo_team_workspace()':'public.get_paige_team_context()';
    sql(`BEGIN; SET LOCAL ROLE ${role}; SELECT ${call};`,database,true,/permission denied for function/);
    records.push({phase:'original-owner-read-other-role',role,signature,execution_denied:true});
  }
  records.push({phase:'original-owner-read-final-metadata',metadata:JSON.parse(readerMetadata()),bodies:JSON.parse(sql(`select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',md5(p.prosrc))) from pg_proc p where p.oid in (${readerSignatures.map(s=>`'${s}'::regprocedure`).join(',')});`))});
  for(let index=0;index<readerDefinitions.length;index++){
    const original=readerDefinitions[index].definition;
    const changed=original.replace("    AND current_member.role=_viewer_role AND (current_member.is_owner OR current_member.role='owner'::public.tenant_role)=_viewer_is_owner",'');
    assert.notEqual(changed,original,'Current role race mutant must edit the real predicate');sql(changed);
    await assert.rejects(()=>ownerReadDemotionRace(index===1),/Original read must abstain after role changed/);
    records.push({phase:'original-owner-read-race-mutant',reader:index===1?'context':'screen',killed:true});restoreReaders();
    for(const identity of [true,false]){
      const lockRemoved=identity ? original.replace('   FOR SHARE;','   ;')
        : original.replace('   FOR SHARE;\n  IF NOT FOUND THEN RETURN NULL; END IF;\n  SELECT _result','   ;\n  IF NOT FOUND THEN RETURN NULL; END IF;\n  SELECT _result');
      assert.notEqual(lockRemoved,original,'Post-admission lock mutant must edit the real lock');sql(lockRemoved);
      await assert.rejects(()=>ownerReadAfterAdmissionRace(index===1,identity),/Actor change must wait until/);
      records.push({phase:'original-owner-read-lock-mutant',reader:index===1?'context':'screen',change:identity?'identity-ban':'seat-demotion',killed:true});restoreReaders();
    }
  }
  await ownerReadDemotionRace(false);await ownerReadDemotionRace(true);
  console.log(JSON.stringify({ selection:onlyOwnerRead?'owner-read-only; NOT full native release proof':'full-original-runner',evidence: 'isolated native component and original revoke source integration; Auth/platform/tables are ports; no authenticated/RLS/provider/customer proof', records }, null, 2));
  // Do not suppress the upstream current-authority failure. Keep it in the complete release suite.
  // Its fixture uses the original Billing table shape, separate from owner-read projection ports.
  if(!onlyOwnerRead){sql('DROP TABLE public.platform_billing_contacts; DROP FUNCTION proof.billing_cases(); DROP FUNCTION public.billing_active_tenant_id();');billingBootstrap();await billingAuthorityRace(false);}
  }
  }
} finally {
  if (created) { sql(`DROP DATABASE ${database};`, 'postgres'); console.log('Disposed only the database created by this run.'); }
}
