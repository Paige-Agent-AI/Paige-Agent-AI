// Native producer proof ONLY. Auth/current-workspace helpers are explicit fixture ports,
// not evidence of hosted Auth, RLS, tenant permissions or customer acceptance.
// EXP02_DISPOSABLE=1 PGHOST=127.0.0.1 PGPORT=... PGUSER=... PSQL=...
// EXP02_PG_DATA_DIRECTORY=<verified existing disposable cluster> node this-file [--baseline]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

assert.equal(process.env.EXP02_DISPOSABLE, '1', 'Explicit disposable opt-in required');
assert.equal(process.env.PGHOST, '127.0.0.1', 'Loopback only');
assert.match(process.env.PGPORT ?? '', /^\d+$/);
assert.ok(Number(process.env.PGPORT) >= 1024 && Number(process.env.PGPORT) <= 65535, 'Explicit unprivileged local port required');
assert.ok(process.env.PGUSER && process.env.PSQL && process.env.EXP02_PG_DATA_DIRECTORY);
assert.ok(process.argv.slice(2).every(a => a === '--baseline'), 'Unknown proof option');
const baseline = process.argv.includes('--baseline');
const database = `exp02_billing_${randomUUID().replaceAll('-', '')}`;
const binary = process.env.PSQL;
const args = db => ['-X', '--no-password', '-q', '-A', '-t', '-h', '127.0.0.1', '-p', process.env.PGPORT,
  '-U', process.env.PGUSER, '-d', db, '-v', 'ON_ERROR_STOP=1'];
function sql(query, db = database, failure) {
  const r = spawnSync(binary, args(db), { input: query, encoding: 'utf8', timeout: 30000, env: process.env, windowsHide: true });
  if (r.error) throw r.error;
  if (failure) { assert.notEqual(r.status, 0); assert.match(r.stderr, failure); }
  else assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const normalized = p => p.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
assert.equal(normalized(sql('SHOW data_directory;', 'postgres')),
  normalized(process.env.EXP02_PG_DATA_DIRECTORY), 'Refuse any other cluster');
assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname IN ('postgres','authenticated','anon','service_role');", 'postgres'), '4',
  'Use existing roles; never create or alter shared cluster roles');
const source = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const foundation = source('20261045000000_platform_billing_accounts_foundation_a.sql');
const revokeSource = source('20261111050000_the_workspace_can_connect_a_payment_method.sql');
function original(text, name) {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = text.indexOf('$$;', start);
  assert.ok(start >= 0 && end > start, `Original ${name} required`);
  return text.slice(start, end + 3);
}
const originals = [
  original(foundation, 'platform_billing_workspace_owner_scope'),
  original(foundation, 'platform_billing_contact_designate'),
  original(revokeSource, 'platform_billing_contact_revoke'),
];
const names = ['platform_billing_contact_designate', 'platform_billing_contact_revoke', 'platform_billing_workspace_owner_scope'];
const expectedBodies = ['7a5ee44d62f25eae831ca9c3883ff906', 'c67dc4c18e72fde1dbc89d15be09edd9', '3d33a31f95f308784853f7b3816b1e8c'];
const A = 'e2000000-0000-4000-8000-000000000001', B = 'e2000000-0000-4000-8000-000000000002';
const actor = 'e2000000-0000-4000-8000-000000000010', recipient = 'e2000000-0000-4000-8000-000000000011';
const contact = 'e2000000-0000-4000-8000-000000000020';
const identity = `SET test.actor='${actor}'; SET ROLE authenticated;`;
const call = door => door === 'revoke' ? `SELECT public.platform_billing_contact_revoke('${contact}');`
  : `SELECT public.platform_billing_contact_designate('${recipient}','delegate');`;
function metadata() {
  return JSON.parse(sql(`SELECT jsonb_agg((to_jsonb(p)-'prosrc') || jsonb_build_object('comment',obj_description(p.oid,'pg_proc')) ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${names.map(x => `'${x}'`).join(',')});`));
}
function reset() {
  sql(`TRUNCATE public.tenants,public.tenant_members,proof.active_workspaces,public.platform_billing_contacts,public.paige_audit_log;
    INSERT INTO public.tenants VALUES ('${A}',NULL,'standalone'),('${B}',NULL,'standalone');
    INSERT INTO public.tenant_members VALUES ('${A}','${actor}',true,'active'),('${B}','${actor}',true,'active');
    INSERT INTO proof.active_workspaces VALUES ('${actor}','${A}');`);
}
const results = [];
let created = false;
async function waitRace(door, change, expectedRefusal = true, collect = true) {
  reset();
  if (door === 'revoke') sql(`INSERT INTO public.platform_billing_contacts(id,tenant_id,user_id,designation) VALUES ('${contact}','${A}','${recipient}','delegate');`);
  const first = spawn(binary, args(database), { env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const firstDone = new Promise((resolve, reject) => { first.on('error', reject); first.on('close', resolve); });
  let second, secondDone, timer, out = '', errors = '';
  try {
    const ready = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Error('First session did not acquire original lock')), 10000);
      first.stdout.on('data', c => { out += c; if (out.includes('EXP02_LOCKED')) resolve(); });
      first.on('error', reject);
    });
    first.stdin.write(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('platform_billing_contacts:${A}',0));\n\\echo EXP02_LOCKED\n`);
    await ready; clearTimeout(timer);
    const app = `exp02_billing_${door}_${randomUUID().slice(0,8)}`;
    second = spawn(binary, args(database), { env: { ...process.env, PGAPPNAME: app }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    secondDone = new Promise((resolve, reject) => { second.on('error', reject); second.on('close', resolve); });
    second.stderr.on('data', c => { errors += c; });
    second.stdin.end('\\set VERBOSITY verbose\nSET statement_timeout=15000;\n' + identity + '\n' + call(door));
    let waited = false;
    for (let i = 0; i < 50; i++) {
      waited = sql(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname='${database}' AND application_name='${app}' AND wait_event_type='Lock');`) === 't';
      if (waited) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(waited, 'Second session must be observed waiting on the actual original lock');
    if (change === 'owner-lost') sql(`UPDATE public.tenant_members SET is_owner=false WHERE tenant_id='${A}' AND user_id='${actor}';`);
    if (change === 'suspended') sql(`UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='${A}' AND user_id='${actor}';`);
    if (change === 'workspace-changed') sql(`UPDATE proof.active_workspaces SET tenant_id='${B}' WHERE actor='${actor}';`);
    if (change === 'parented') sql(`UPDATE public.tenants SET parent_tenant_id='${B}' WHERE id='${A}';`);
    first.stdin.end('COMMIT;\n\\q\n'); assert.equal(await firstDone, 0);
    const exit = await secondDone;
    const state = JSON.parse(sql(`SELECT json_build_object('contacts',(SELECT count(*) FROM public.platform_billing_contacts),
      'revoked',(SELECT count(*) FROM public.platform_billing_contacts WHERE revoked_at IS NOT NULL),'audits',(SELECT count(*) FROM public.paige_audit_log));`));
    const expectedError = change === 'suspended' ? 'no_active_workspace'
      : change === 'parented' ? 'billing_not_applicable' : 'billing_workspace_owner_only';
    const passed = expectedRefusal ? exit !== 0 && errors.includes(`42501: ${expectedError}`) && state.contacts === (door === 'revoke' ? 1 : 0) && state.revoked === 0 && state.audits === 0
      : exit === 0 && state.contacts === 1 && state.revoked === (door === 'revoke' ? 1 : 0) && state.audits === 1;
    const row = { phase: collect ? 'original-billing-wait' : 'causal-mutant-wait', door, change, waited, exit, state, passed };
    if (collect) results.push(row);
    console.log(JSON.stringify(row));
    return row;
  } finally {
    clearTimeout(timer);
    if (first.exitCode === null) first.stdin.end('ROLLBACK;\n\\q\n');
    if (second && second.exitCode === null) second.kill();
    await Promise.allSettled([firstDone, ...(secondDone ? [secondDone] : [])]);
  }
}
try {
  sql(`CREATE DATABASE ${database};`, 'postgres'); created = true;
  sql(`CREATE SCHEMA auth; CREATE SCHEMA proof;
    CREATE TABLE public.tenants(id uuid PRIMARY KEY,parent_tenant_id uuid,account_type text);
    CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,is_owner boolean,status text,PRIMARY KEY(tenant_id,user_id));
    CREATE TABLE proof.active_workspaces(actor uuid PRIMARY KEY,tenant_id uuid);
    CREATE TABLE public.platform_billing_contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid,designation text,
      designated_by uuid,revoked_at timestamptz,revoked_by uuid);
    CREATE UNIQUE INDEX fixture_live_contact ON public.platform_billing_contacts(tenant_id,user_id) WHERE revoked_at IS NULL;
    CREATE TABLE public.paige_audit_log(actor_user_id uuid,actor_role text,action text,target_type text,target_id uuid,tenant_id uuid,payload jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
    CREATE FUNCTION public.billing_active_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT w.tenant_id FROM proof.active_workspaces w
      JOIN public.tenant_members m ON m.tenant_id=w.tenant_id AND m.user_id=w.actor AND m.status='active' WHERE w.actor=auth.uid()$$;
    CREATE FUNCTION public.is_tenant_owner(u uuid,t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM public.tenant_members
      WHERE user_id=u AND tenant_id=t AND is_owner AND status='active')$$;
    ${originals.join('\n')}
    REVOKE ALL ON FUNCTION public.platform_billing_workspace_owner_scope() FROM PUBLIC,anon,authenticated,service_role;
    REVOKE ALL ON FUNCTION public.platform_billing_contact_designate(uuid,text),public.platform_billing_contact_revoke(uuid) FROM PUBLIC,anon,service_role;
    GRANT EXECUTE ON FUNCTION public.platform_billing_contact_designate(uuid,text),public.platform_billing_contact_revoke(uuid) TO authenticated;
    COMMENT ON FUNCTION public.platform_billing_workspace_owner_scope() IS 'Test-only incumbent scope comment';
    COMMENT ON FUNCTION public.platform_billing_contact_designate(uuid,text) IS 'Test-only incumbent designation comment';
    COMMENT ON FUNCTION public.platform_billing_contact_revoke(uuid) IS 'Test-only incumbent revoke comment';`);
  assert.deepEqual(JSON.parse(sql(`SELECT jsonb_agg(md5(prosrc) ORDER BY proname) FROM pg_proc WHERE proname IN (${names.map(x => `'${x}'`).join(',')});`)), expectedBodies);
  const before = metadata();
  let migration;
  if (!baseline) {
    migration = source('20271126080006_exp02_billing_current_authority.sql');
    sql(migration); assert.deepEqual(metadata(), before, 'Whole pg_proc metadata, OIDs, ACLs and comments preserved');
    const once = sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY proname) FROM pg_proc p WHERE proname IN (${names.map(x => `'${x}'`).join(',')});`);
    sql(migration); assert.equal(sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY proname) FROM pg_proc p WHERE proname IN (${names.map(x => `'${x}'`).join(',')});`), once, 'Replay is byte/metadata-identical');
    console.log(JSON.stringify({ phase: 'migration-metadata-and-replay', passed: true }));
  }
  for (const door of ['revoke','designate']) {
    for (const change of ['owner-lost','suspended','workspace-changed','parented']) await waitRace(door, change);
    await waitRace(door, 'unchanged', false);
  }
  if (!baseline) {
    reset(); sql(`INSERT INTO public.platform_billing_contacts(id,tenant_id,user_id,designation) VALUES ('${contact}','${A}','${recipient}','primary_contact');`);
    sql(identity + call('revoke'), database, /billing_primary_contact_required/);
    assert.equal(sql('SELECT count(*) FROM public.paige_audit_log;'), '0');
    sql(identity + `SELECT public.platform_billing_contact_revoke('${randomUUID()}');`, database, /billing_contact_not_found/);
    sql(identity + `SELECT public.platform_billing_contact_designate(NULL,'delegate');`, database, /billing_contact_bad_user/);
    sql(identity + `SELECT public.platform_billing_contact_designate('${recipient}','invalid');`, database, /billing_contact_bad_designation/);
    sql(identity + `SELECT public.platform_billing_contact_designate('${recipient}','delegate');`, database, /billing_contact_already_designated/);
    reset(); sql(`ALTER TABLE public.paige_audit_log ADD CONSTRAINT fixture_audit_unavailable CHECK(false);`);
    sql(identity + call('designate'), database, /fixture_audit_unavailable/);
    assert.equal(sql('SELECT count(*) FROM public.platform_billing_contacts;'), '0', 'Audit failure rolls back original contact insertion');
    sql('ALTER TABLE public.paige_audit_log DROP CONSTRAINT fixture_audit_unavailable;');
    console.log(JSON.stringify({ phase: 'original-validation-and-audit-rollback', passed: true }));
    const signatures = ['public.platform_billing_contact_designate(uuid,text)', 'public.platform_billing_contact_revoke(uuid)'];
    // psql uses the client platform's line endings; database body digests remain exact.
    const repaired = signatures.map(s => sql(`SELECT pg_get_functiondef('${s}'::regprocedure);`).replaceAll('\r\n', '\n'));
    const guard = "  -- Re-resolve after waiting, retaining the workspace whose lock was acquired.\n"
      + "  IF public.platform_billing_workspace_owner_scope() IS DISTINCT FROM _t THEN\n"
      + "    RAISE EXCEPTION 'billing_workspace_owner_only' USING ERRCODE = '42501';\n  END IF;\n";
    for (const [label, index, change, replacement] of [
      ['revoke post-wait check removed', 1, 'owner-lost', ''],
      ['designate post-wait check removed', 0, 'owner-lost', ''],
      ['workspace silently retargeted after locking', 0, 'workspace-changed', '  _t := public.platform_billing_workspace_owner_scope();\n'],
      ['workspace comparison removed', 0, 'workspace-changed', '  PERFORM public.platform_billing_workspace_owner_scope();\n'],
    ]) {
      const mutant = repaired[index].replace(guard, replacement);
      assert.notEqual(mutant, repaired[index], 'Mutant must actually change the production body');
      try {
        sql(mutant);
        assert.equal((await waitRace(index === 0 ? 'designate' : 'revoke', change, true, false)).passed, false, label);
        console.log(JSON.stringify({ phase: 'causal-mutant-killed', label, passed: true }));
      } finally { sql(repaired[index]); }
    }
    const allState = () => sql(`SELECT jsonb_agg(to_jsonb(p) ORDER BY proname) FROM pg_proc p WHERE proname IN (${names.map(x => `'${x}'`).join(',')});`);
    const restore = () => {
      sql(originals.join('\n'));
      sql(`ALTER FUNCTION public.platform_billing_contact_designate(uuid,text) OWNER TO postgres;
        REVOKE ALL ON FUNCTION public.platform_billing_contact_designate(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
        GRANT EXECUTE ON FUNCTION public.platform_billing_contact_designate(uuid,text) TO authenticated;`);
    };
    for (const [label, drift] of [
      ['scope body drift', originals[0].replace('  RETURN _t;', '  RETURN _t; -- fixture drift')],
      ['second writer body drift', originals[2].replace('  _des text;', '  _des text; -- fixture drift')],
      ['PUBLIC execution drift', 'GRANT EXECUTE ON FUNCTION public.platform_billing_contact_designate(uuid,text) TO PUBLIC;'],
      ['anon execution drift', 'GRANT EXECUTE ON FUNCTION public.platform_billing_contact_designate(uuid,text) TO anon;'],
      ['service role execution drift', 'GRANT EXECUTE ON FUNCTION public.platform_billing_contact_designate(uuid,text) TO service_role;'],
      ['security invoker drift', 'ALTER FUNCTION public.platform_billing_contact_designate(uuid,text) SECURITY INVOKER;'],
      ['stable writer drift', 'ALTER FUNCTION public.platform_billing_contact_designate(uuid,text) STABLE;'],
      ['search path drift', "ALTER FUNCTION public.platform_billing_contact_designate(uuid,text) SET search_path='';"],
      ['owner drift', 'ALTER FUNCTION public.platform_billing_contact_designate(uuid,text) OWNER TO authenticated;'],
    ]) {
      restore(); sql(drift);
      const drifted = allState();
      sql(migration, database, /Original Billing current-authority prerequisite drift/);
      assert.equal(allState(), drifted, 'Any prerequisite refusal rolls the entire migration back, including a prior writer correction');
      console.log(JSON.stringify({ phase: 'prerequisite-drift-refused', label, passed: true }));
    }
    restore(); sql(migration);
    assert.deepEqual(metadata(), before, 'All fixture mutations restored; production metadata preserved');
  }
  assert.ok(results.every(r => r.passed), `${results.filter(r => !r.passed).length} original post-wait authority requirements failed`);
  console.log(JSON.stringify({ phase: 'complete', baseline, races: results.length, passed: true,
    boundary: 'Native original bodies and real roles/concurrency with explicit minimal Auth/scope fixture ports; not hosted/full-schema/customer acceptance' }));
} finally {
  if (created) { sql(`DROP DATABASE ${database};`, 'postgres'); console.log('Only this run\'s disposable Billing database removed.'); }
}
