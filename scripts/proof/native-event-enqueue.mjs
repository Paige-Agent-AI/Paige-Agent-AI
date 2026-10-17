// Actual PostgreSQL producer/enqueue/claim contracts; transport is an isolated recorder.
// No real HTTP, Vault secret, business account, dispatcher, or task executor is invoked.
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const legacyMode = process.argv.includes('--baseline');
const ci = process.argv.includes('--postgres');
assert.ok(!ci || process.env.CI === 'true', '--postgres requires disposable CI');
assert.ok(!ci || !process.env.PGHOST || ['127.0.0.1', 'localhost'].includes(process.env.PGHOST), 'loopback only');
const port = ci ? 5432 : Number(process.env.NATIVE_EVENT_PG_PORT ?? 65486);
const directory = resolve(root, 'work/native-event-enqueue-proof');
mkdirSync(directory, { recursive: true });
const scratch = mkdtempSync(resolve(directory, legacyMode ? 'red-' : 'green-'));
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
const cases = [];
const check = async (name, run) => {
  try { await run(); cases.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
  catch (error) { cases.push({ name, status: 'FAIL', error: String(error.message) }); console.log('FAIL ' + name + ': ' + error.message); }
};
const denied = statement => assert.throws(() => sql(statement), /permission denied|row-level security/);
let started = false;
let created = false;
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
  create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
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
  sql(fn(legacy, 'trg_clients_emit_contact_created'));
  sql('create trigger trg_clients_emit_contact_created after insert on public.clients for each row execute function public.trg_clients_emit_contact_created();');
  if (!legacyMode) sql(text(migrationPath));
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
    sql(text(migrationPath));assert.equal(sql("select md5(prosrc)||':'||coalesce(proacl::text,'') from pg_proc where oid='public.paige_fire_event_processor(uuid,uuid)'::regprocedure;"), before);
  });
} catch (error) {
  cases.push({ name: 'proof setup or infrastructure', status: 'FAIL', error: String(error.message) });
  console.error('FAIL proof setup or infrastructure: ' + error.message);
} finally {
  try {
    if (created) { assert.match(database, /^native_event_enqueue_[0-9]+$/);sql('drop database ' + database, 'postgres'); }
  } finally {
    if (started) call('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
  }
  const report = { mode: legacyMode ? 'baseline' : 'candidate', cases, passed: cases.filter(c => c.status === 'PASS').length, failed: cases.filter(c => c.status === 'FAIL').length, skipped: 0, cleanup: { ownedDatabaseCreated: created, ownedDatabaseDropped: created, ownedLocalClusterStarted: started, ownedLocalClusterStopped: started, sharedCIServiceStopped: false }, boundary: 'Actual native SQL producer/enqueue/claim/roles; synthetic transport/auth projection ports. No real HTTP, model/provider, task execution, ordinary customer, full-schema or Live proof.', migrationSha256: legacyMode ? null : createHash('sha256').update(text(migrationPath)).digest('hex') };
  writeFileSync(resolve(scratch, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: resolve(scratch, 'report.json'), passed: report.passed, failed: report.failed, skipped: report.skipped }));
}
if (cases.some(c => c.status === 'FAIL')) process.exitCode = 1;
