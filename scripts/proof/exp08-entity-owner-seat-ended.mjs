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
const migration = readFileSync(new URL('../../supabase/migrations/20271126060008_exp08_entity_owner_seat_ended.sql', import.meta.url), 'utf8');
const invitationSource = readFileSync(new URL('../../supabase/migrations/20271120010008_exp08_owner_invitations.sql', import.meta.url), 'utf8');
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
function sql(query, db = database, expectFailure = false) {
  const r = spawnSync(executable, connectionArgs(db),
  { input: query, encoding: 'utf8', timeout: 30_000, env: process.env });
  if (r.error) throw r.error;
  if (expectFailure) {
    assert.notEqual(r.status, 0, 'Drifted candidate unexpectedly applied');
    assert.match(r.stderr, /EXP08 entity seat lifecycle (already exists|trigger drift|requires the original)/);
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
function restore() {
  for (const [signature, body] of definitions) sql(`ALTER FUNCTION ${signature} OWNER TO postgres;\n${body}\nREVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated, service_role;`);
  sql('ALTER TABLE public.tenant_members ENABLE TRIGGER trg_tenant_members_business_owner_seat_ended; ALTER TABLE public.tenant_business_owners ENABLE TRIGGER trg_business_owner_representative_deleted;');
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
  console.log(JSON.stringify({ evidence: 'isolated native component only; no Auth/RLS/writer/customer proof', records }, null, 2));
} finally {
  if (created) { sql(`DROP DATABASE ${database};`, 'postgres'); console.log('Disposed only the database created by this run.'); }
}
