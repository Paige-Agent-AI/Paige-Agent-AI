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
const database = `exp08_entity_seat_proof_${Date.now()}`;
const fixture = readFileSync(new URL('../../supabase/tests/exp08_entity_owner_seat_ended.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../supabase/migrations/20271126080008_exp08_entity_owner_seat_ended.sql', import.meta.url), 'utf8');
const invitationSource = readFileSync(new URL('../../supabase/migrations/20271120010008_exp08_owner_invitations.sql', import.meta.url), 'utf8');
const coOwnerSource = readFileSync(new URL('../../supabase/migrations/20271116020008_exp08_co_owner_authority.sql', import.meta.url), 'utf8');
const tenantAuthoritySource = readFileSync(new URL('../../supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql', import.meta.url), 'utf8');
const revokeFixture = readFileSync(new URL('../../supabase/tests/exp08_entity_owner_revoke_integration.sql', import.meta.url), 'utf8');
const revokeMigration = readFileSync(new URL('../../supabase/migrations/20271126090008_exp08_entity_owner_revoke_link.sql', import.meta.url), 'utf8');
const collaborationSource=readFileSync(new URL('../../supabase/migrations/20271113850008_exp08_team_hub_collaboration.sql',import.meta.url),'utf8');
const lifecycleSource=readFileSync(new URL('../../supabase/migrations/20271115040008_exp08_team_lifecycle.sql',import.meta.url),'utf8');
const actorFixture=readFileSync(new URL('../../supabase/tests/exp08_team_hub_actor_lifecycle.sql',import.meta.url),'utf8');
const actorMigration=readFileSync(new URL('../../supabase/migrations/20271126100008_exp08_team_hub_actor_lifecycle.sql',import.meta.url),'utf8');
const holderStateFixture=readFileSync(new URL('../../supabase/tests/exp08_account_holder_state.sql',import.meta.url),'utf8');
const identityFixture=readFileSync(new URL('../../supabase/tests/exp08_team_hub_identity_currentness.sql',import.meta.url),'utf8');
const identityMigration=readFileSync(new URL('../../supabase/migrations/20271126140008_exp08_team_hub_identity_currentness.sql',import.meta.url),'utf8');
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
const snapshot = `select json_build_object('members',(select json_agg(m order by id) from public.tenant_members m),
 'owners',(select json_agg(b order by id) from public.tenant_business_owners b));`;
let created = false;
try {
  sql(`CREATE DATABASE ${database};`, 'postgres'); created = true;
  sql(fixture);
  sql(scopeHelper);
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
  assert.equal(integratedCases.length,11);assert.ok(integratedCases.every(r=>r.passed),JSON.stringify(integratedCases));
  records.push({phase:'original-revoke-after-repair',cases:integratedCases});
  const writerSnapshot=sql(snapshot);const auditSnapshot=sql('select json_agg(a order by id) from public.paige_audit_log a;');
  sql(revokeMigration);
  assert.equal(sql(snapshot),writerSnapshot);assert.equal(sql('select json_agg(a order by id) from public.paige_audit_log a;'),auditSnapshot);
  records.push({phase:'original-revoke-migration-replay',row_changes:0});
  const patchedRevoke=sql("select pg_get_functiondef('public.revoke_co_owner(uuid,uuid)'::regprocedure);");
  const revokeCases=()=>sql('select row_to_json(t) from proof.revoke_cases() t;').split('\n').filter(Boolean).map(JSON.parse);
  for(const [name,mutate] of [
    ['SOLO scope removed',s=>s.replace('CASE WHEN public._solo_shell_tenant(_tenant) THEN NULL ELSE business_owner_id END','NULL')],
    ['original authority removed',s=>s.replace('IF NOT (public.is_tenant_account_holder','IF false AND NOT (public.is_tenant_account_holder')],
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
  console.log(JSON.stringify({ evidence: 'isolated native component and original revoke source integration; Auth/platform/tables are ports; no authenticated/RLS/billing/provider/customer proof', records }, null, 2));
} finally {
  if (created) { sql(`DROP DATABASE ${database};`, 'postgres'); console.log('Disposed only the database created by this run.'); }
}
