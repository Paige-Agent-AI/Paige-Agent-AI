// Actual PostgreSQL producer/enqueue/claim contracts; transport is an isolated recorder.
// No real HTTP, Vault secret, business account, dispatcher, or task executor is invoked.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const legacyMode = process.argv.includes('--baseline');
const cutoverBaseline = process.argv.includes('--cutover-baseline');
const enteredFocus = process.argv.includes('--entered-claim-focus');
assert.ok(!legacyMode || !cutoverBaseline, 'choose one failing baseline');
const ci = process.argv.includes('--postgres');
assert.ok(!ci || process.env.CI === 'true', '--postgres requires disposable CI');
assert.ok(!ci || !process.env.PGHOST || ['127.0.0.1', 'localhost'].includes(process.env.PGHOST), 'loopback only');
const port = ci ? 5432 : Number(process.env.NATIVE_EVENT_PG_PORT ?? 65486);
const directory = resolve(root, 'work/native-event-enqueue-proof');
mkdirSync(directory, { recursive: true });
const scratch = mkdtempSync(resolve(directory, legacyMode ? 'red-' : cutoverBaseline ? 'cutover-red-' : 'green-'));
const bin = process.env.NATIVE_EVENT_PG_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/16/bin' : '');
const exe = name => bin ? resolve(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
const database = `native_event_enqueue_${process.pid}`;
const data = resolve(scratch, 'data');
const args = db => ['-X', '-q', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', db, '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
const call = (name, argv, opts = {}) => execFileSync(exe(name), argv, { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8_000_000, ...opts });
const sql = (statement, db = database) => call('psql', args(db), { input: statement, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const detailed = statement => spawnSync(exe('psql'), args(database), { input: statement, encoding: 'utf8', windowsHide: true, timeout: 30000 });
const text = file => readFileSync(resolve(root, file), 'utf8');
const legacy = text('supabase/migrations/20270119000000_contact_created_native_event.sql');
const cronSource = text('supabase/migrations/20260712150000_cron_token_to_vault.sql');
const migrationPath = 'supabase/migrations/20271109020000_native_event_enqueue_cron_auth.sql';
const migration = cutoverBaseline ? execFileSync('git', ['show', '8eb7e56d33eb6d18cc07966ebd8d7594d6f47748:' + migrationPath], { cwd: root, encoding: 'utf8', windowsHide: true }) : text(migrationPath);
const weekly = text('supabase/migrations/20271028000000_experience05_weekly_commitment_check.sql');
const cutoverFunction = 'public.paige_native_event_transport_cutover_at()';
const fn = (source, name, acl = false) => {
  const found = source.match(new RegExp('create(?: or replace)? function public\\.' + name + '\\s*\\([\\s\\S]*?\\bas\\s+(\\$[a-z_0-9]*\\$)[\\s\\S]*?\\1;', 'i'));
  assert.ok(found, 'actual source function ' + name);
  return found[0] + (acl ? [...source.matchAll(new RegExp('^\\s*(?:revoke|grant)\\b[^;]*on function public\\.' + name + '\\([^;]*;', 'gim'))].map(m => m[0]).join('\n') : '');
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tenantA = id(1), tenantB = id(2), actorA = id(3);
const literal = v => "'" + String(v).replaceAll("'", "''") + "'";
const service = "set role service_role;set request.jwt.claims='{\"role\":\"service_role\"}';";
const owner = `set role authenticated;set request.jwt.claims='{\"role\":\"authenticated\",\"sub\":\"${actorA}\"}';set fixture.tenant='${tenantA}';`;
let next = 10;
const contact = (prefix = owner, tenant = tenantA) => {
  const contactId = id(next++);
  sql(prefix + `insert into public.clients(id,tenant_id,first_name) values('${contactId}','${tenant}','Protected native fixture');`);
  return JSON.parse(sql(`select row_to_json(e) from public.paige_native_events e where subject_id='${contactId}';`));
};
const queueCount = () => Number(sql('select count(*) from net.fixture_requests;'));
const eventSnapshot = event => sql(`select row_to_json(e) from public.paige_native_events e where id='${event.id}';`);
const claim = event => JSON.parse(sql(service + `select public.paige_claim_event('${event.id}');`));
const enqueue = event => sql(service + `select public.paige_fire_event_processor('${event.id}','${event.tenant_id}');`);
const queuedFor = event => Number(sql(`select count(*) from net.fixture_requests where body->>'event_id'='${event.id}';`));
const cases = [];
const check = async (name, run) => {
  try { await run(); cases.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
  catch (error) { cases.push({ name, status: 'FAIL', error: String(error.message) }); console.log('FAIL ' + name + ': ' + error.message); }
};
const denied = statement => assert.throws(() => sql(statement), /permission denied|row-level security/);
let started = false;
let created = false;
let crossingSession;
try {
  if (!ci) {
    const probe = createServer();
    await new Promise((yes, no) => { probe.once('error', no); probe.listen(port, '127.0.0.1', yes); });
    await new Promise(yes => probe.close(yes));
    call('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8', '--no-sync']);
    call('pg_ctl', ['-D', data, '-l', resolve(scratch, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -F`, '-w', '-t', '30', 'start'], { stdio: 'ignore' });
    started = true;
  }
  sql('create database ' + database, 'postgres'); created = true;
  sql(`do $$begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
  end$$;
  create schema auth;create schema vault;create schema net;
  create function auth.uid() returns uuid language plpgsql stable as $$begin
    if current_setting('fixture.claim_barrier',true)='true' then
      perform pg_catalog.pg_advisory_lock(4252306);perform pg_catalog.pg_advisory_unlock(4252306);
    end if;
    return (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
  end$$;
  create function public.current_user_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('fixture.tenant',true),'')::uuid$$;
  create table public.tenants(id uuid primary key);
  create table public.paige_automation_triggers(key text primary key);
  insert into public.paige_automation_triggers values('contact.created');
  insert into public.tenants values('${tenantA}'),('${tenantB}');
  create table public.clients(id uuid primary key,tenant_id uuid references public.tenants(id),account_number text,first_name text,lifecycle_stage text,source text);
  alter table public.clients enable row level security;
  grant usage on schema public,auth to authenticated,anon,service_role;
  grant insert,select on public.clients to authenticated;
  create policy fixture_clients_scope on public.clients to authenticated using(tenant_id=public.current_user_tenant_id()) with check(tenant_id=public.current_user_tenant_id());
  create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
  insert into vault.decrypted_secrets values('cron_token','SYNTHETIC_CRON_TOKEN');
  create table net.fixture_requests(id bigserial primary key,url text,body jsonb,headers jsonb);
  create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{}'::jsonb,timeout_milliseconds int default 2000) returns bigint language plpgsql as $$
  declare request_id bigint;begin
    insert into net.fixture_requests(url,body,headers) values(url,body,headers) returning id into request_id;
    if current_setting('fixture.net_throw',true)='true' then raise exception 'SYNTHETIC_CRON_TOKEN transport payload must not leak';end if;
    return request_id;
  end$$;`);
  const begin = legacy.indexOf('CREATE TABLE IF NOT EXISTS public.paige_native_events');
  const end = legacy.indexOf('-- ── 2.', begin);
  assert.ok(begin > 0 && end > begin);
  sql(legacy.slice(begin, end));
  sql(fn(cronSource, 'cron_token_header', true));
  for (const name of ['paige_claim_event', 'paige_complete_event', 'paige_fail_event']) sql(fn(legacy, name, true));
  sql(fn(legacy, 'paige_fire_event_processor', true));
  sql(fn(legacy, 'paige_sweep_stuck_events', true));
  sql('alter function public.paige_sweep_stuck_events() rename to paige_sweep_stuck_events_before_weekly;');
  // Only the existing weekly publisher's effects are ported. Both real sweep
  // bodies and their native claim/transport paths execute unchanged in SQL.
  sql(`create table public.fixture_weekly_calls(n int);insert into public.fixture_weekly_calls values(0);
    create function public.publish_due_weekly_commitment_checks() returns integer language plpgsql as $$begin
      update public.fixture_weekly_calls set n=n+1;return 0;end$$;`);
  sql(fn(weekly, 'paige_sweep_stuck_events', true));
  sql(fn(legacy, 'trg_clients_emit_contact_created'));
  sql('create trigger trg_clients_emit_contact_created after insert on public.clients for each row execute function public.trg_clients_emit_contact_created();');
  const historical = legacyMode ? [] : Array.from({ length: 4 }, () => contact());
  const crossingEvent = legacyMode ? null : contact();
  if (!legacyMode) {
    sql(`update public.paige_native_events set occurred_at=now()-interval '1 day',created_at=now()-interval '1 day' where id in (${[...historical, crossingEvent].map(e => literal(e.id)).join(',')});
      update public.paige_native_events set processing_state='claimed',attempts=1,claimed_at=now()-interval '1 day' where id='${historical[1].id}';`);
  }
  const historicalBefore = historical.map(eventSnapshot);
  const wrapperBefore = sql("select pg_get_functiondef('public.paige_sweep_stuck_events()'::regprocedure);");
  const lifecycleBefore = ['paige_complete_event(uuid)', 'paige_fail_event(uuid,text)'].map(signature => sql(`select pg_get_functiondef('public.${signature}'::regprocedure);`));
  let crossingResult;
  if (!legacyMode) {
    // A real connection/transaction exists before deployment; its delayed HTTP
    // claim statement executes after the atomic migration commit.
    crossingSession = spawn(exe('psql'), args(database), { windowsHide: true });
    let output = '', errors = '';
    crossingSession.stdout.setEncoding('utf8');crossingSession.stderr.setEncoding('utf8');
    crossingSession.stdout.on('data', chunk => { output += chunk; });
    crossingSession.stderr.on('data', chunk => { errors += chunk; });
    const ready = new Promise((yes, no) => {
      const timer = setTimeout(() => no(new Error('pre-migration connection readiness timeout')), 30000);
      crossingSession.stdout.on('data', () => { if (output.includes('CUTOVER_CONNECTION_READY')) { clearTimeout(timer);yes(); } });
      crossingSession.once('error', error => { clearTimeout(timer);no(error); });
    });
    crossingSession.stdin.write("begin isolation level read committed;select clock_timestamp();\n\\echo CUTOVER_CONNECTION_READY\n");
    await ready;
    crossingResult = new Promise((yes, no) => {
      const timer = setTimeout(() => { crossingSession.kill();no(new Error('post-migration claim timeout')); }, 30000);
      crossingSession.once('close', code => {
        clearTimeout(timer);if (code !== 0) no(new Error(errors));
        else { try { yes(JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{')))); } catch (error) { no(error); } }
      });
    });
  }
  const mintStart = sql('select clock_timestamp();');
  if (!legacyMode) sql(migration);
  const mintEnd = sql('select clock_timestamp();');
  let crossingClaim;
  if (!legacyMode) {
    crossingSession.stdin.end(service + `select public.paige_claim_event('${crossingEvent.id}');commit;\n`);
    crossingClaim = await crossingResult;crossingSession = null;
  }
  if (!enteredFocus) {
  await check('ordinary actor insert reaches real native enqueue without legacy aliases', () => {
    const before = queueCount(); const event = contact();
    assert.equal(queueCount(), before + 1);
    const row = JSON.parse(sql(`select row_to_json(q) from net.fixture_requests q where body->>'event_id'='${event.id}';`));
    assert.equal(row.url, 'https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/paige-native-event-dispatch');
    assert.deepEqual(row.body, { event_id: event.id, tenant_id: tenantA });
    assert.equal(row.headers['x-cron-token'], 'SYNTHETIC_CRON_TOKEN');
    assert.equal(row.headers.Authorization, undefined);
  });
  await check('producer creates canonical deduplicated pending occurrence', () => {
    const event = contact(); assert.equal(event.dedup_key, 'contact.created:' + event.subject_id);
    assert.equal(event.processing_state, 'pending'); assert.equal(event.attempts, 0);
    sql(`insert into public.clients(id,tenant_id) values('${event.subject_id}','${tenantA}') on conflict do nothing;`);
    assert.equal(Number(sql(`select count(*) from public.paige_native_events where subject_id='${event.subject_id}';`)), 1);
  });
  await check('native helper ABI owner and least privilege remain', () => {
    assert.equal(sql("select pg_get_function_result('public.paige_fire_event_processor(uuid,uuid)'::regprocedure);"), 'void');
    assert.equal(sql("select pg_get_userbyid(proowner)||':'||prosecdef::text from pg_proc where oid='public.paige_fire_event_processor(uuid,uuid)'::regprocedure;"), 'postgres:true');
    assert.equal(sql("select has_function_privilege('anon','public.paige_fire_event_processor(uuid,uuid)','execute')::text||':'||has_function_privilege('authenticated','public.paige_fire_event_processor(uuid,uuid)','execute')::text||':'||has_function_privilege('service_role','public.paige_fire_event_processor(uuid,uuid)','execute')::text;"), 'false:false:true');
  });
  await check('anonymous direct enqueue denied', () => denied(`set role anon;select public.paige_fire_event_processor('${id(10)}','${tenantA}');`));
  await check('authenticated direct enqueue denied even for own tenant', () => denied(owner + `select public.paige_fire_event_processor('${id(10)}','${tenantA}');`));
  await check('transport recorder and cron token remain inaccessible to clients', () => {
    denied(owner + 'select * from net.fixture_requests;'); denied(owner + 'select public.cron_token_header();');
  });
  await check('foreign contact insertion is refused before outbox', () => {
    const before = Number(sql('select count(*) from public.paige_native_events;'));
    denied(owner + `insert into public.clients(id,tenant_id) values('${id(next++)}','${tenantB}');`);
    assert.equal(Number(sql('select count(*) from public.paige_native_events;')), before);
  });
  await check('second tenant uses same implementation with isolated payload/read', () => {
    const event = contact(`set role authenticated;set fixture.tenant='${tenantB}';`, tenantB);
    assert.equal(sql(`select body->>'tenant_id' from net.fixture_requests where body->>'event_id'='${event.id}';`), tenantB);
    assert.equal(Number(sql(owner + `select count(*) from public.paige_native_events where id='${event.id}';`)), 0);
  });
  await check('enqueue replay stays at-least-once and native claim remains once', () => {
    const event = contact(); const before = queueCount();
    sql(service + `select public.paige_fire_event_processor('${event.id}','${tenantA}');select public.paige_fire_event_processor('${event.id}','${tenantA}');`);
    assert.equal(queueCount(), before + 2);
    const claim = JSON.parse(sql(service + `select public.paige_claim_event('${event.id}');`));
    assert.equal(claim.claimed, true); assert.equal(claim.tenant_id, tenantA);
    assert.equal(JSON.parse(sql(service + `select public.paige_claim_event('${event.id}');`)).claimed, false);
    sql(service + `select public.paige_complete_event('${event.id}');`);
    assert.equal(JSON.parse(sql(service + `select public.paige_claim_event('${event.id}');`)).claimed, false);
    assert.equal(Number(sql(`select attempts from public.paige_native_events where id='${event.id}';`)), 1);
  });
  await check('claim authority comes from native row, not transport tenant', () => {
    const event = contact();sql(service + `select public.paige_fire_event_processor('${event.id}','${tenantB}');`);
    const claim = JSON.parse(sql(service + `select public.paige_claim_event('${event.id}');`));assert.equal(claim.tenant_id, tenantA);
  });
  await check('eight actual PostgreSQL claim sessions have one winner', async () => {
    const event = contact();const winners = await Promise.all(Array.from({ length: 8 }, () => new Promise((yes, no) => {
      const child = execFile(exe('psql'), args(database), { encoding: 'utf8', windowsHide: true, timeout: 30000 }, (error, stdout) => error ? no(error) : yes(JSON.parse(stdout.trim()).claimed));
      child.stdin.end(service + `select public.paige_claim_event('${event.id}');`);
    })));
    assert.equal(winners.filter(Boolean).length, 1);
  });
  for (const token of [null, '', '   ']) await check('missing/blank token preserves outbox without enqueue: ' + JSON.stringify(token), () => {
    sql('update vault.decrypted_secrets set decrypted_secret=' + (token === null ? 'null' : literal(token)) + " where name='cron_token';");
    const before = queueCount();const event = contact();assert.equal(queueCount(), before);assert.equal(event.processing_state, 'pending');assert.equal(event.attempts, 0);
    sql("update vault.decrypted_secrets set decrypted_secret='SYNTHETIC_CRON_TOKEN' where name='cron_token';");
  });
  await check('absent cron-token row preserves pending outbox without enqueue', () => {
    sql("delete from vault.decrypted_secrets where name='cron_token';");
    const before = queueCount();const event = contact();assert.equal(queueCount(), before);assert.equal(event.processing_state, 'pending');assert.equal(event.attempts, 0);
    sql("insert into vault.decrypted_secrets values('cron_token','SYNTHETIC_CRON_TOKEN');");
  });
  await check('transport exception rolls back partial queue and redacts diagnostics', () => {
    const contactId = id(next++);const before = queueCount();
    const result = detailed(owner + `set fixture.net_throw='true';insert into public.clients(id,tenant_id) values('${contactId}','${tenantA}');`);
    assert.equal(result.status, 0);assert.equal(queueCount(), before);
    assert.ok(!result.stderr.includes('SYNTHETIC_CRON_TOKEN'));
    assert.match(result.stderr, /native_event_enqueue_failed/);
    assert.equal(Number(sql(`select count(*) from public.paige_native_events where subject_id='${contactId}' and processing_state='pending' and attempts=0;`)), 1);
  });
  await check('producer transaction rollback also removes recorded enqueue', () => {
    const before = queueCount();const contactId = id(next++);
    sql(owner + `begin;insert into public.clients(id,tenant_id) values('${contactId}','${tenantA}');rollback;`);
    assert.equal(queueCount(), before);assert.equal(Number(sql(`select count(*) from public.paige_native_events where subject_id='${contactId}';`)), 0);
  });
  if (!legacyMode) await check('forward migration reapplication is body/ACL idempotent', () => {
    const before = sql("select md5(prosrc)||':'||coalesce(proacl::text,'') from pg_proc where oid='public.paige_fire_event_processor(uuid,uuid)'::regprocedure;");
    sql(migration);assert.equal(sql("select md5(prosrc)||':'||coalesce(proacl::text,'') from pg_proc where oid='public.paige_fire_event_processor(uuid,uuid)'::regprocedure;"), before);
  });
  if (!legacyMode) {
    await check('migration does not rewrite historical event rows or lifecycle/wrapper bodies', () => {
      assert.deepEqual(historical.map(eventSnapshot), historicalBefore);
      assert.equal(sql("select pg_get_functiondef('public.paige_sweep_stuck_events()'::regprocedure);"), wrapperBefore);
      assert.deepEqual(['paige_complete_event(uuid)', 'paige_fail_event(uuid,text)'].map(signature => sql(`select pg_get_functiondef('public.${signature}'::regprocedure);`)), lifecycleBefore);
    });
    await check('pre-migration connection cannot late-claim history after migration commit', () => {
      assert.equal(crossingClaim.claimed, false);
      assert.equal(Number(sql(`select attempts from public.paige_native_events where id='${crossingEvent.id}';`)), 0);
    });
    await check('cutover is server-minted once, immutable, postgres-owned and service-only', () => {
      assert.equal(sql(`select (${cutoverFunction} between ${literal(mintStart)}::timestamptz and ${literal(mintEnd)}::timestamptz)::text;`), 'true');
      assert.equal(sql(`select pg_get_userbyid(proowner)||':'||provolatile::text||':'||prosecdef::text||':'||array_to_string(proconfig,',') from pg_proc where oid='${cutoverFunction}'::regprocedure;`), 'postgres:i:false:search_path=""');
      assert.equal(sql(`select has_function_privilege('anon','${cutoverFunction}','execute')::text||':'||has_function_privilege('authenticated','${cutoverFunction}','execute')::text||':'||has_function_privilege('service_role','${cutoverFunction}','execute')::text;`), 'false:false:true');
      denied(owner + `select ${cutoverFunction};`);denied(`set role anon;select ${cutoverFunction};`);
      denied(service + `create or replace function ${cutoverFunction} returns timestamptz language sql as $$select now()$$;`);
      const before = sql(`select pg_get_functiondef('${cutoverFunction}'::regprocedure)||'|'||${cutoverFunction}::text;`);
      sql(migration);assert.equal(sql(`select pg_get_functiondef('${cutoverFunction}'::regprocedure)||'|'||${cutoverFunction}::text;`), before);
    });
    await check('late direct historical enqueue is refused without touching the event', () => {
      const event = historical[0], before = eventSnapshot(event), count = queuedFor(event);enqueue(event);
      assert.equal(queuedFor(event), count);assert.equal(eventSnapshot(event), before);
    });
    await check('late direct historical pending claim is refused atomically', () => {
      const event = historical[2], before = eventSnapshot(event);assert.equal(claim(event).claimed, false);assert.equal(eventSnapshot(event), before);
    });
    await check('historical stale claim cannot resume an old act', () => {
      const event = historical[1], before = eventSnapshot(event);assert.equal(claim(event).claimed, false);assert.equal(eventSnapshot(event), before);
    });
    await check('existing weekly wrapper excludes old pending/claimed recovery and preserves publisher', () => {
      const counts = historical.map(queuedFor), before = historical.map(eventSnapshot);
      const published = Number(sql('select n from public.fixture_weekly_calls;'));
      sql(service + 'select public.paige_sweep_stuck_events();');
      assert.deepEqual(historical.map(queuedFor), counts);assert.deepEqual(historical.map(eventSnapshot), before);
      assert.equal(Number(sql('select n from public.fixture_weekly_calls;')), published + 1);
    });
    for (const field of ['occurred_at', 'created_at']) await check('both timestamps required at enqueue and claim: old ' + field, () => {
      const event = contact();sql(`update public.paige_native_events set ${field}=now()-interval '1 day' where id='${event.id}';`);
      const before = eventSnapshot(event), count = queuedFor(event);enqueue(event);assert.equal(queuedFor(event), count);
      assert.equal(claim(event).claimed, false);assert.equal(eventSnapshot(event), before);
    });
    for (const field of ['occurred_at', 'created_at']) for (const value of ['infinity', '-infinity']) await check('nonfinite ' + field + '=' + value + ' is fail closed', () => {
      const event = contact();sql(`update public.paige_native_events set ${field}='${value}'::timestamptz where id='${event.id}';`);
      const before = eventSnapshot(event), count = queuedFor(event);enqueue(event);assert.equal(queuedFor(event), count);
      assert.equal(claim(event).claimed, false);assert.equal(eventSnapshot(event), before);
      sql(service + 'select public.paige_sweep_stuck_events();');assert.equal(queuedFor(event), count);
    });
    await check('missing event and null timestamp cannot invent transport authority', () => {
      const before = queueCount();enqueue({ id: id(9999), tenant_id: tenantA });assert.equal(queueCount(), before);
      assert.equal(claim({ id: id(9999) }).claimed, false);
      const event = contact();for (const field of ['occurred_at', 'created_at']) assert.throws(() => sql(`update public.paige_native_events set ${field}=null where id='${event.id}';`), /not-null constraint/);
    });
    await check('future failed delivery remains retryable across fixed-cutoff reapplication', () => {
      const event = contact();assert.equal(claim(event).claimed, true);
      sql(service + `select public.paige_fail_event('${event.id}','synthetic unknown acknowledgement');`);
      sql(migration);const before = queuedFor(event);enqueue(event);assert.equal(queuedFor(event), before + 1);
      assert.equal(claim(event).claimed, true);assert.equal(Number(sql(`select attempts from public.paige_native_events where id='${event.id}';`)), 2);
      sql(service + `select public.paige_complete_event('${event.id}');`);assert.equal(claim(event).claimed, false);
    });
    await check('native claim and lower recovery retain service-only ABI and client denial', () => {
      for (const signature of ['public.paige_claim_event(uuid)', 'public.paige_sweep_stuck_events_before_weekly()']) {
        assert.equal(sql(`select pg_get_userbyid(proowner)||':'||prosecdef::text from pg_proc where oid='${signature}'::regprocedure;`), 'postgres:true');
        assert.equal(sql(`select has_function_privilege('anon','${signature}','execute')::text||':'||has_function_privilege('authenticated','${signature}','execute')::text||':'||has_function_privilege('service_role','${signature}','execute')::text;`), 'false:false:true');
      }
      denied(owner + `select public.paige_claim_event('${historical[0].id}');`);
      denied(owner + 'select public.paige_sweep_stuck_events_before_weekly();');
      denied('set role anon;select public.paige_sweep_stuck_events_before_weekly();');
    });
    // PostgreSQL-superuser-only test clock port: after proving the real minting
    // above, move only the fixture constant back one hour to exercise the real
    // five-minute SQL recovery predicates without wall-clock sleeps. There is
    // no production GUC/input override. Restore its exact function/ACL below.
    const constantExists = sql(`select to_regprocedure('${cutoverFunction}') is not null;`) === 't';
    const constantDefinition = constantExists ? sql(`select pg_get_functiondef('${cutoverFunction}'::regprocedure);`) : null;
    const restoreConstant = () => {
      if (constantDefinition) sql(constantDefinition + `;revoke all on function ${cutoverFunction} from public,anon,authenticated;grant execute on function ${cutoverFunction} to service_role;`);
      else sql(`drop function if exists ${cutoverFunction};`);
    };
    const fixtureConstant = expression => sql(`create or replace function ${cutoverFunction} returns timestamptz language sql immutable parallel safe set search_path='' as $$select ${expression}$$;
      revoke all on function ${cutoverFunction} from public,anon,authenticated;grant execute on function ${cutoverFunction} to service_role;`);
    const fixtureCutover = sql("select clock_timestamp()-interval '1 hour';");
    try {
      fixtureConstant(literal(fixtureCutover) + '::timestamptz');
      for (const state of ['pending', 'claimed']) await check('future aged ' + state + ' uses actual weekly/lower sweep and native recovery', () => {
        const event = contact();sql(`update public.paige_native_events set occurred_at=now()-interval '10 minutes',created_at=now()-interval '10 minutes',processing_state='${state}',attempts=1,claimed_at=now()-interval '10 minutes' where id='${event.id}';`);
        const before = eventSnapshot(event), count = queuedFor(event);
        sql(service + 'select public.paige_sweep_stuck_events();');
        assert.equal(queuedFor(event), count + 1);assert.equal(eventSnapshot(event), before);
        assert.equal(claim(event).claimed, true);assert.equal(Number(sql(`select attempts from public.paige_native_events where id='${event.id}';`)), 2);
        assert.equal(claim(event).claimed, false); // live lease, no immediate repeat
        sql(service + `select public.paige_fail_event('${event.id}','synthetic lost acknowledgement');`);
        const retryCount = queuedFor(event);sql(service + 'select public.paige_sweep_stuck_events();');
        assert.equal(queuedFor(event), retryCount + 1);assert.equal(claim(event).claimed, true);
        sql(service + `select public.paige_complete_event('${event.id}');`);assert.equal(claim(event).claimed, false);
      });
      await check('aged terminal and attempt-capped events are not resumed', () => {
        for (const state of ['done', 'error', 'pending', 'claimed']) {
          const event = contact();sql(`update public.paige_native_events set occurred_at=now()-interval '10 minutes',created_at=now()-interval '10 minutes',processing_state='${state}',attempts=5,claimed_at=now()-interval '10 minutes' where id='${event.id}';`);
          const before = eventSnapshot(event), count = queuedFor(event);sql(service + 'select public.paige_sweep_stuck_events();');
          assert.equal(queuedFor(event), count);assert.equal(claim(event).claimed, false);assert.equal(eventSnapshot(event), before);
        }
      });
      await check('future recovery is not starved by more than 100 historical rows', () => {
        sql(`insert into public.paige_native_events(tenant_id,event_key,subject_table,subject_id,payload,dedup_key,occurred_at,created_at)
          select '${tenantA}','contact.created','clients','${id(9998)}','{}'::jsonb,'fixture-old-'||n,now()-interval '1 day',now()-interval '1 day' from generate_series(1,101) n;`);
        const event = contact();sql(`update public.paige_native_events set occurred_at=now()-interval '10 minutes',created_at=now()-interval '10 minutes' where id='${event.id}';`);
        const before = eventSnapshot(event), count = queuedFor(event);sql(service + 'select public.paige_sweep_stuck_events();');
        assert.equal(queuedFor(event), count + 1);assert.equal(eventSnapshot(event), before);
        assert.equal(Number(sql("select count(*) from net.fixture_requests q join public.paige_native_events e on e.id::text=q.body->>'event_id' where e.dedup_key like 'fixture-old-%';")), 0);
      });
      for (const expression of ['null::timestamptz', "'infinity'::timestamptz"]) await check('unknown/nonfinite cutoff fails all gates without event mutation: ' + expression, () => {
        fixtureConstant(literal(fixtureCutover) + '::timestamptz');const event = contact();
        sql(`update public.paige_native_events set occurred_at=now()-interval '10 minutes',created_at=now()-interval '10 minutes' where id='${event.id}';`);
        fixtureConstant(expression);const before = eventSnapshot(event), count = queuedFor(event);
        enqueue(event);assert.equal(queuedFor(event), count);assert.equal(claim(event).claimed, false);
        sql(service + 'select public.paige_sweep_stuck_events_before_weekly();');assert.equal(queuedFor(event), count);assert.equal(eventSnapshot(event), before);
      });
      await check('row constraint prevents dropping its fixed cutoff dependency', () => {
        const before = sql(`select pg_get_constraintdef(oid)||':'||convalidated::text from pg_constraint where conrelid='public.paige_native_events'::regclass and conname='paige_native_events_transport_cutover_claim';`);
        assert.ok(before.endsWith(':false'), 'historical rows remain unvalidated and untouched');
        const result = detailed(`drop function ${cutoverFunction};`);assert.notEqual(result.status, 0);
        assert.match(result.stderr, /paige_native_events_transport_cutover_claim/);
        assert.equal(sql(`select pg_get_constraintdef(oid)||':'||convalidated::text from pg_constraint where conrelid='public.paige_native_events'::regclass and conname='paige_native_events_transport_cutover_claim';`), before);
      });
      await check('absent cutoff cannot enqueue, claim or sweep an attributable future row', () => {
        fixtureConstant(literal(fixtureCutover) + '::timestamptz');const event = contact();
        // Destructive fault injection is restricted to this owned disposable
        // schema. Remove the dependent constraint explicitly; never CASCADE.
        const before = eventSnapshot(event), count = queuedFor(event);
        sql(`alter table public.paige_native_events drop constraint if exists paige_native_events_transport_cutover_claim;drop function ${cutoverFunction};`);
        enqueue(event);assert.equal(queuedFor(event), count);
        const result = detailed(service + `select public.paige_claim_event('${event.id}');`);
        assert.notEqual(result.status, 0);assert.match(result.stderr, /paige_native_event_transport_cutover_at/);
        const sweep = detailed(service + 'select public.paige_sweep_stuck_events_before_weekly();');assert.notEqual(sweep.status, 0);
        assert.equal(queuedFor(event), count);assert.equal(eventSnapshot(event), before);
      });
    } finally { restoreConstant();sql(migration); }
    await check('pre-existing app-owned cutoff is rejected before migration evaluates it', () => {
      const event = historical[0], before = eventSnapshot(event), count = queueCount();
      try {
        sql(`create or replace function ${cutoverFunction} returns timestamptz language plpgsql volatile as $$begin raise exception 'UNTRUSTED_CUTOVER_EVALUATED';end;$$;
          alter function ${cutoverFunction} owner to authenticated;`);
        const result = detailed(migration);assert.notEqual(result.status, 0);
        assert.match(result.stderr, /NATIVE_EVENT_CUTOVER_OWNER_INVALID/);
        assert.ok(!result.stderr.includes('UNTRUSTED_CUTOVER_EVALUATED'));
        assert.equal(queueCount(), count);assert.equal(eventSnapshot(event), before);
      } finally {
        sql(`alter function ${cutoverFunction} owner to postgres;`);restoreConstant();
      }
    });
    await check('test-only clock port restores exact database-minted constant', () => {
      assert.ok(constantDefinition, 'candidate supplies the production constant');
      assert.equal(sql(`select pg_get_functiondef('${cutoverFunction}'::regprocedure);`), constantDefinition);
      assert.equal(sql(`select (${cutoverFunction} between ${literal(mintStart)}::timestamptz and ${literal(mintEnd)}::timestamptz)::text;`), 'true');
      const before = sql(`select ${cutoverFunction};`);sql(migration);assert.equal(sql(`select ${cutoverFunction};`), before);
    });
  }
  }
  if (!legacyMode) await check('already-entered old claim frame cannot mutate history after migration commit', async () => {
    const event = contact();sql(`update public.paige_native_events set occurred_at=now()-interval '1 day',created_at=now()-interval '1 day' where id='${event.id}';`);
    // Model the pre-deployment generation. Only the fixture's Auth resolver
    // supplies a barrier; there is no production hook or timing override.
    sql(fn(legacy, 'paige_claim_event', true));
    const before = eventSnapshot(event), count = queuedFor(event);
    const holder = spawn(exe('psql'), args(database), { windowsHide: true });
    let output = '';
    holder.stdout.setEncoding('utf8');holder.stdout.on('data', chunk => { output += chunk; });
    const ready = new Promise((yes, no) => {
      const timer = setTimeout(() => { holder.kill();no(new Error('entered-frame barrier timeout')); }, 30000);
      holder.stdout.on('data', () => { if (output.includes('ENTERED_FRAME_BARRIER_READY')) { clearTimeout(timer);yes(); } });
      holder.once('error', error => { clearTimeout(timer);no(error); });
    });
    holder.stdin.write("select pg_advisory_lock(4252306);\n\\echo ENTERED_FRAME_BARRIER_READY\n");
    await ready;
    let oldChild;
    const oldResult = new Promise(yes => {
      oldChild = execFile(exe('psql'), args(database), { encoding: 'utf8', windowsHide: true, timeout: 30000 }, (error, stdout, stderr) => yes({ error: error ? String(error.message) : null, stdout, stderr }));
      oldChild.stdin.end(service + `set fixture.claim_barrier='true';select public.paige_claim_event('${event.id}') /* ENTERED_OLD_CLAIM */;`);
    });
    let migrationError;
    try {
      const until = Date.now() + 15000;
      while (sql("select exists(select 1 from pg_locks where locktype='advisory' and objid=4252306 and not granted);") !== 't') {
        assert.ok(Date.now() < until, 'old frame entered Auth barrier before its UPDATE');
        await new Promise(yes => setTimeout(yes, 25));
      }
      try { sql("set lock_timeout='3s';" + migration); } catch (error) { migrationError = error; }
    } finally {
      holder.stdin.end('select pg_advisory_unlock(4252306);\n');
    }
    const result = await oldResult;
    assert.equal(migrationError, undefined, 'migration must commit while the already-entered frame is paused');
    if (result.error) assert.match(result.stderr, /paige_native_events_transport_cutover_claim/);
    else assert.equal(JSON.parse(result.stdout.trim()).claimed, false);
    assert.equal(eventSnapshot(event), before);assert.equal(queuedFor(event), count);
  });
} catch (error) {
  cases.push({ name: 'proof setup or infrastructure', status: 'FAIL', error: String(error.message) });
  console.error('FAIL proof setup or infrastructure: ' + error.message);
} finally {
  if (crossingSession) crossingSession.kill();
  try {
    if (created) { assert.match(database, /^native_event_enqueue_[0-9]+$/);sql('drop database ' + database, 'postgres'); }
  } finally {
    if (started) call('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
  }
  const report = { mode: (enteredFocus ? 'entered-claim-focus:' : '') + (legacyMode ? 'baseline' : cutoverBaseline ? 'cutover-baseline-8eb7e56d' : 'candidate'), cases, passed: cases.filter(c => c.status === 'PASS').length, failed: cases.filter(c => c.status === 'FAIL').length, skipped: 0, cleanup: { ownedDatabaseCreated: created, ownedDatabaseDropped: created, ownedLocalClusterStarted: started, ownedLocalClusterStopped: started, sharedCIServiceStopped: false }, boundary: 'Actual native SQL producer/enqueue/claim/recovery/roles; synthetic transport/auth/weekly-publisher projection ports. No real HTTP, model/provider, task execution, ordinary customer, full-schema or Live proof.', migrationSha256: legacyMode ? null : createHash('sha256').update(migration).digest('hex') };
  writeFileSync(resolve(scratch, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: resolve(scratch, 'report.json'), passed: report.passed, failed: report.failed, skipped: report.skipped }));
}
if (cases.some(c => c.status === 'FAIL')) process.exitCode = 1;
