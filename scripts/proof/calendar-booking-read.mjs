// Disposable PostgreSQL proof of the EXISTING caller-JWT Calendar reader.
// Auth claim plumbing and non-SOLO privilege helpers are fixture ports; the reader,
// ordinary membership/admin and active-tenant functions are loaded from source.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = process.argv.includes('--baseline');
const ci = process.argv.includes('--postgres');
assert.ok(!ci || process.env.CI === 'true', '--postgres requires disposable CI');
assert.ok(!ci || !process.env.PGHOST || ['127.0.0.1', 'localhost'].includes(process.env.PGHOST), 'loopback only');
const directory = resolve(root, 'work/calendar-booking-read-proof');
mkdirSync(directory, { recursive: true });
const scratch = mkdtempSync(resolve(directory, baseline ? 'red-' : 'green-'));
const bin = process.env.CALENDAR_READ_PG_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/16/bin' : '');
const exe = name => bin ? resolve(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
const port = Number(process.env.CALENDAR_READ_PG_PORT ?? (ci ? 5432 : 65488));
const database = `calendar_booking_read_${process.pid}`;
const data = resolve(scratch, 'data');
const args = db => ['-X', '-q', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', db, '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
const call = (name, argv, options = {}) => execFileSync(exe(name), argv, { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8_000_000, ...options });
const sql = (statement, db = database) => call('psql', args(db), { input: statement }).trim();
const text = path => readFileSync(resolve(root, path), 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const paths = {
  reader: 'supabase/migrations/20260712100000_internal_bookings_team_read_and_realtime.sql',
  seats: 'supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql',
  tenant: 'supabase/migrations/20260714144656_tier_rail_phaseB_agency_standing.sql',
  migration: 'supabase/migrations/20271109030000_calendar_booking_exact_read.sql',
  retiredSeat: 'supabase/migrations/20270508000000_forbid_title_role_value.sql',
};
function extract(source, name, acl = false) {
  const match = source.match(new RegExp('create(?: or replace)? function public\\.' + name + '\\s*\\([\\s\\S]*?\\bas\\s+(\\$[a-z_0-9]*\\$)[\\s\\S]*?\\1;', 'i'));
  assert.ok(match, 'actual canonical function ' + name);
  return match[0] + (acl ? [...source.matchAll(new RegExp('^\\s*(?:revoke|grant)\\b[^;]*on function public\\.' + name + '\\([^;]*;', 'gim'))].map(m => m[0]).join('\n') : '');
}
// Production has the identical statement tokens with source-only comment lines
// omitted. Normalize only those comments/CRLF; the native body MD5 is asserted.
const reader = extract(text(paths.reader).replace(/\r\n/g, '\n').replace(/^ *--[^\n]*\n/gm, ''), 'list_team_bookings', true);
const member = extract(text(paths.seats), 'is_tenant_member');
const admin = extract(text(paths.seats), 'is_tenant_admin');
const tenant = extract(text(paths.tenant), 'current_user_tenant_id', true);
const retiredSeatConstraint = text(paths.retiredSeat).match(/ALTER TABLE public\.tenant_members\s+ADD CONSTRAINT tenant_members_role_not_retired_title_role\s+CHECK \(role IS DISTINCT FROM 'coach'::public\.tenant_role\);/);
assert.ok(retiredSeatConstraint, 'the actual current membership constraint must exist');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ta = id(1), tb = id(2), owner = id(3), staff = id(4), inactive = id(5), outsider = id(6), adminUser = id(7);
const memberBooking = id(200001), foreignBooking = id(200002);
const claims = actor => `set role authenticated;set request.jwt.claims='${JSON.stringify({ role: 'authenticated', ...(actor ? { sub: actor } : {}) })}';`;
const columns = 'id,tenant_id,calendar_id,host_user_id,contact_id,title,start_at,end_at,timezone,status,booking_kind,guest_name';
const query = (booking, workspace = ta, range = "'-infinity','infinity'") => `select ${columns} from public.list_team_bookings(${range},null,'${workspace}'${baseline ? '' : ",'" + booking + "'"}) where id='${booking}' limit 2`;
const rows = (actor, booking, workspace = ta) => JSON.parse(sql(claims(actor) + `select coalesce(json_agg(r),'[]') from (${query(booking, workspace)}) r;`));
const cases = [], measurements = [], compatibility = {};
const check = (name, run) => {
  try { run(); cases.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
  catch (error) { cases.push({ name, status: 'FAIL', error: error.message }); console.log('FAIL ' + name + ': ' + error.message); }
};
const refusal = (actor, workspace = ta, role = 'authenticated') => {
  const result = spawnSync(exe('psql'), args(database), { input: claims(actor).replace('set role authenticated;', `set role ${role};`) + query(id(100000), workspace) + ';', encoding: 'utf8', windowsHide: true, timeout: 10000 });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /BOOKING_FORBIDDEN/);
};
let started = false, created = false;
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
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;
    if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
    if not exists(select from pg_roles where rolname='service_role') then create role service_role;end if;
  end$$;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    create table public.profiles(id uuid primary key default gen_random_uuid(),user_id uuid unique,full_name text,active_tenant_id uuid);
    create table public.tenant_members(id uuid primary key default gen_random_uuid(),tenant_id uuid,user_id uuid,status text,role text,joined_at timestamptz default now(),unique(tenant_id,user_id));
    ${retiredSeatConstraint[0].replace('::public.tenant_role', '')}
    create index idx_tenant_members_tenant on public.tenant_members(tenant_id,status);
    create index idx_tenant_members_user on public.tenant_members(user_id,status);
    create index idx_tenant_members_team_workspace on public.tenant_members(tenant_id,status,role,user_id);
    create function public.is_company_workspace(uuid) returns boolean language sql stable as $$select false$$;
    create function public.is_platform_operator() returns boolean language sql stable as $$select false$$;
    create function public.is_platform_owner() returns boolean language sql stable as $$select false$$;
    create function public.agency_can_manage_child(uuid,uuid) returns boolean language sql stable as $$select false$$;
    create function public.agency_team_role(uuid,uuid) returns text language sql stable as $$select null::text$$;
    create function public.is_platform_admin(uuid) returns boolean language sql stable as $$select false$$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    create table public.internal_bookings(id uuid primary key,tenant_id uuid,calendar_id uuid,host_user_id uuid,contact_id uuid,title text not null,start_at timestamptz not null,end_at timestamptz not null,timezone text,status text,source text,guest_name text,guest_email text,guest_phone text,notes text,location_type text,location_value text,booking_kind text,class_session_id uuid,capacity integer,collective_group_id uuid,appointment_type jsonb,intake_answers jsonb);
    create index idx_internal_bookings_host_start on public.internal_bookings(host_user_id,start_at);
    create index idx_internal_bookings_tenant_start on public.internal_bookings(tenant_id,start_at);
    alter table public.internal_bookings enable row level security;
    create policy fixture_host_read on public.internal_bookings for select to authenticated using(host_user_id=auth.uid());
    grant select on public.internal_bookings to authenticated;
    ${member}\n${admin}\n${tenant}\n${reader}
    insert into public.profiles(user_id,full_name,active_tenant_id) values('${owner}','Neutral owner','${ta}'),('${staff}','Neutral member','${ta}'),('${inactive}','Inactive member','${ta}'),('${outsider}','No membership','${ta}'),('${adminUser}','Neutral admin','${ta}');
    insert into public.tenant_members(tenant_id,user_id,status,role) values('${ta}','${owner}','active','owner'),('${ta}','${staff}','active','member'),('${ta}','${inactive}','inactive','owner'),('${ta}','${adminUser}','active','admin');
    insert into public.internal_bookings
      select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${ta}',null,'${owner}',null,'Neutral booking '||n,'2026-01-01'::timestamptz+n*interval '1 hour','2026-01-01'::timestamptz+n*interval '1 hour'+interval '30 minutes','UTC','scheduled','internal','Neutral guest',null,null,repeat('bounded neutral note ',24),'none',null,'single',null,null,null,jsonb_build_object('neutral',repeat('x',256)),jsonb_build_object('answer',repeat('y',256)) from generate_series(10000,109999) n;
    insert into public.internal_bookings(id,tenant_id,host_user_id,title,start_at,end_at,timezone,status,source,booking_kind) values('${memberBooking}','${ta}','${staff}','Member booking','2026-01-01','2026-01-02','UTC','scheduled','internal','single'),('${foreignBooking}','${tb}','${owner}','Foreign booking','2026-01-01','2026-01-02','UTC','scheduled','internal','single');
    update public.internal_bookings set booking_kind='collective' where id='${id(10001)}';
    update public.internal_bookings set booking_kind='class_session',capacity=8 where id='${id(10002)}';
    update public.internal_bookings set booking_kind='class_seat',class_session_id='${id(10002)}' where id='${id(10003)}';
    analyze public.internal_bookings;analyze public.profiles;analyze public.tenant_members;`);
  check('100000 neutral same-tenant bookings plus distinct member/foreign fixtures', () => assert.equal(Number(sql(`select count(*) from public.internal_bookings where tenant_id='${ta}';`)), 100001));
  check('original reader body matches inspected production native contract', () => assert.equal(sql("select md5(prosrc) from pg_proc where oid='public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid)'::regprocedure;"), 'f9ef7a06dae772a896873e32273041ca'));
  const signature = 'public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid)';
  const metadata = () => sql(`select json_build_object('oid',p.oid,'owner',pg_get_userbyid(proowner),'acl',proacl,'defaults',pg_get_expr(proargdefaults,0),'names',proargnames,'types',proallargtypes,'language',(select lanname from pg_language where oid=prolang),'stable',provolatile,'definer',prosecdef,'config',proconfig) from pg_proc p where oid='${signature}'::regprocedure;`);
  const snapshot = (actor, argumentsSql) => sql(claims(actor) + `select md5(coalesce(string_agg(row_to_json(r)::text,'|' order by r.start_at,r.id),'')) from public.list_team_bookings(${argumentsSql}) r;`);
  compatibility.beforeMetadata = metadata();
  const oldCalls = [
    // Compatibility compares complete rows in a bounded canonical Calendar range,
    // including every booking kind. The separate efficiency cases retain100k.
    [owner, "'2027-02-01','2027-03-01',null,'" + ta + "'"],
    [staff, "'-infinity','infinity',null,'" + ta + "'"],
    [owner, "'2026-01-01','2026-01-02',null,'" + ta + "'"],
    [owner, "'-infinity','infinity',array['" + staff + "']::uuid[],'" + ta + "'"],
    [owner, "'2026-01-01','2026-01-02'"],
    [owner, "'2026-01-01','2026-01-02',null"],
  ];
  compatibility.beforeRows = oldCalls.map(([actor, parameters]) => snapshot(actor, parameters));
  if (!baseline) {
    check('failed migration transaction rolls back both native signatures completely', () => {
      const failed = text(paths.migration).replace("NOTIFY pgrst, 'reload schema';", "DO $$BEGIN RAISE EXCEPTION 'fixture rollback';END$$;");
      const result = spawnSync(exe('psql'), args(database), { input: failed, encoding: 'utf8', windowsHide: true, timeout: 10000 });
      assert.notEqual(result.status, 0); assert.match(result.stderr, /fixture rollback/);
      assert.equal(sql("select to_regprocedure('public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid,uuid)') is null;"), 't');
      assert.equal(metadata(), compatibility.beforeMetadata);
    });
    sql(text(paths.migration));
  }
  check('existing four-argument OID defaults owner ACL and projection ABI unchanged', () => assert.equal(metadata(), compatibility.beforeMetadata));
  check('original two/three/four-argument calls return identical complete representative rows', () => {
    compatibility.afterRows = oldCalls.map(([actor, parameters]) => snapshot(actor, parameters)); assert.deepEqual(compatibility.afterRows, compatibility.beforeRows);
  });
  if (!baseline) {
    check('required five-argument overload is unambiguous and preserves native security metadata', () => {
      const row = JSON.parse(sql("select json_build_object('defaults',pronargdefaults,'names',proargnames[1:5],'owner',pg_get_userbyid(proowner),'config',proconfig,'definer',prosecdef,'stable',provolatile,'auth',has_function_privilege('authenticated',oid,'execute'),'service',has_function_privilege('service_role',oid,'execute'),'anon',has_function_privilege('anon',oid,'execute')) from pg_proc where oid='public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid,uuid)'::regprocedure;"));
      assert.deepEqual(row, { defaults: 0, names: ['_from', '_to', '_host_ids', '_tenant_id', '_booking_id'], owner: 'postgres', config: ['search_path=public'], definer: true, stable: 's', auth: true, service: true, anon: false });
    });
  }
  check('owner exact-ID read preserves selected booking only', () => { const r = rows(owner, id(100000)); assert.equal(r.length, 1); assert.equal(r[0].id, id(100000)); assert.equal(r[0].tenant_id, ta); });
  check('admin reads another host through canonical native authority', () => assert.equal(rows(adminUser, memberBooking).length, 1));
  check('active member reads own booking', () => assert.equal(rows(staff, memberBooking).length, 1));
  check('member cannot read another host booking', () => assert.deepEqual(rows(staff, id(100000)), []));
  check('foreign booking ID does not leak despite same host', () => assert.deepEqual(rows(owner, foreignBooking), []));
  check('explicit foreign tenant denied', () => refusal(owner, tb));
  check('missing membership denied', () => refusal(outsider));
  check('inactive owner membership denied', () => refusal(inactive));
  check('missing authenticated actor denied', () => refusal(null));
  check('service role without real actor cannot read bookings', () => refusal(null, ta, 'service_role'));
  check('anon and PUBLIC have no reader execute permission', () => assert.equal(sql("select has_function_privilege('anon','public.list_team_bookings(timestamptz,timestamptz,uuid[],uuid)','execute');"), 'f'));
  check('canonical active tenant is resolved from current membership/profile', () => assert.equal(sql(claims(owner) + 'select public.current_user_tenant_id();'), ta));
  if (!baseline) {
    check('original four-argument wrapper still refuses missing and inactive membership', () => {
      for (const actor of [inactive, outsider]) {
        const result = spawnSync(exe('psql'), args(database), { input: claims(actor) + `select count(*) from public.list_team_bookings('-infinity','infinity',null,'${ta}');`, encoding: 'utf8', windowsHide: true, timeout: 10000 });
        assert.notEqual(result.status, 0); assert.match(result.stderr, /BOOKING_FORBIDDEN/);
      }
    });
    check('anon cannot invoke the exact overload', () => {
      const result = spawnSync(exe('psql'), args(database), { input: 'set role anon;' + query(id(100000)) + ';', encoding: 'utf8', windowsHide: true, timeout: 10000 });
      assert.notEqual(result.status, 0); assert.match(result.stderr, /permission denied for function list_team_bookings/);
    });
    check('a distinct newly provisioned ordinary tenant uses the same exact contract', () => {
      const secondOwner = id(8);
      sql(`insert into public.profiles(user_id,full_name,active_tenant_id) values('${secondOwner}','Neutral second owner','${tb}');insert into public.tenant_members(tenant_id,user_id,status,role) values('${tb}','${secondOwner}','active','owner');`);
      const result = rows(secondOwner, foreignBooking, tb); assert.equal(result.length, 1); assert.equal(result[0].tenant_id, tb);
      assert.deepEqual(rows(secondOwner, id(100000), tb), []);
    });
    check('single collective session and seat kinds retain exact canonical identity/projection', () => {
      for (const [index, kind] of ['single', 'collective', 'class_session', 'class_seat'].entries()) {
        const booking = id(10000 + index);
        sql(`update public.internal_bookings set booking_kind='${kind}',class_session_id=${kind === 'class_seat' ? "'" + id(10002) + "'" : 'null'},capacity=${kind === 'class_session' ? '8' : 'null'} where id='${booking}';`);
        const exact = sql(claims(owner) + `select row_to_json(r) from public.list_team_bookings('-infinity','infinity',null,'${ta}','${booking}') r;`);
        const legacy = sql(claims(owner) + `select row_to_json(r) from public.list_team_bookings((select start_at-interval '1 minute' from public.internal_bookings where id='${booking}'),(select end_at+interval '1 minute' from public.internal_bookings where id='${booking}'),null,'${ta}') r where id='${booking}';`);
        assert.equal(exact, legacy); assert.equal(JSON.parse(exact).booking_kind, kind); assert.equal(JSON.parse(exact).id, booking);
      }
    });
  }
  for (const [name, actor, booking] of [['owner_first', owner, id(10000)], ['owner_late', owner, id(109999)], ['owner_absent', owner, id(999999)], ['member_own', staff, memberBooking]]) {
    check('bounded actual exact-ID plan ' + name, () => {
      const plan = JSON.parse(sql(`set temp_file_limit='256MB';` + claims(actor) + `set work_mem='4MB';set statement_timeout='8000ms';explain(analyze,buffers,format json) ${query(booking)};`))[0];
      measurements.push({ name, executionMs: plan['Execution Time'], planningMs: plan['Planning Time'], plan: plan.Plan, workMem: '4MB', statementTimeoutMs: 8000, tempFileLimitMB: 256 });
      assert.ok(plan['Execution Time'] < 8000, 'must settle within fixed read budget');
      assert.ok(plan.Plan['Actual Rows'] <= 1, 'outer exact ID and limit do not return unrelated records');
      assert.equal(plan.Plan['Temp Written Blocks'], 0, 'exact-ID read must not spill whole-tenant records');
      assert.equal(plan.Plan['Temp Read Blocks'], 0, 'exact-ID read must not materialize historical tenant data');
      assert.ok((plan.Plan.Plans?.[0]?.['Rows Removed by Filter'] ?? 0) <= 1, 'native function must select ID before materialization');
    });
  }
  if (!baseline) {
    check('forced generic plan and twelve repeated same-session exact lookups stay selective', () => {
      const prepared = query(id(109999)).replaceAll("'" + id(109999) + "'", '$1');
      const plans = sql(claims(owner) + `set plan_cache_mode=force_generic_plan;set work_mem='4MB';set statement_timeout='8000ms';prepare fixture_exact(uuid) as ${prepared};` + Array.from({ length: 12 }, (_, index) => `explain(analyze,buffers,format json) execute fixture_exact('${index % 2 ? id(109999) : id(999999)}');`).join('\n'));
      // psql emits one JSON array per statement, separated by newlines.
      const parsed = JSON.parse('[' + plans.trim().replace(/\]\s*\[/g, '],[') + ']').flat();
      assert.equal(parsed.length, 12);
      for (const plan of parsed) { assert.equal(plan.Plan['Temp Written Blocks'], 0); assert.ok(plan['Execution Time'] < 8000); assert.ok((plan.Plan.Plans?.[0]?.['Rows Removed by Filter'] ?? 0) <= 1); }
      measurements.push({ name: 'generic_repeated_12', plans: parsed });
    });
    check('native exact branch still honors date range and requested host subset', () => {
      assert.equal(sql(claims(owner) + `select count(*) from public.list_team_bookings('2026-01-01','2026-01-02',null,'${ta}','${id(109999)}');`), '0');
      assert.equal(sql(claims(owner) + `select count(*) from public.list_team_bookings('-infinity','infinity',array['${staff}']::uuid[],'${ta}','${id(100000)}');`), '0');
    });
    check('null exact ID retains the complete legacy listing contract', () => assert.equal(sql(claims(owner) + `select count(*) from public.list_team_bookings('-infinity','infinity',null,'${ta}',null);`), '100001'));
    check('migration replay retains the original wrapper OID and exact row outcome', () => { sql(text(paths.migration)); assert.equal(metadata(), compatibility.beforeMetadata); assert.equal(rows(owner, id(109999)).length, 1); });
  }
  check('active member retains own-host visibility and cannot read another host', () => {
    assert.equal(rows(staff, memberBooking).length, 1); assert.equal(rows(staff, id(100000)).length, 0);
    sql(`update public.tenant_members set status='inactive' where user_id='${staff}' and tenant_id='${ta}';`);
    refusal(staff);
  });
  check('the incumbent retired-title constraint refuses a manufactured coach permission', () => {
    const result = spawnSync(exe('psql'), args(database), { input: `update public.tenant_members set role='coach' where user_id='${staff}' and tenant_id='${ta}';`, encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /check constraint/);
    assert.equal(sql(`select role from public.tenant_members where user_id='${staff}' and tenant_id='${ta}';`), 'member');
  });
  check('read operations preserve total fixture row count after intentional class-fixture preparation', () => assert.equal(Number(sql('select count(*) from public.internal_bookings;')), 100002));
} catch (error) { cases.push({ name: 'proof setup/runtime', status: 'FAIL', error: String(error.stack) }); console.error(error); }
finally {
  const report = { cases, measurements, compatibility, baseline, fixtureOnly: true, noProductionOrProviderCalls: true,
    sourceHashes: Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, { path, sha256: sha256(text(path)) }])),
    canonicalFunctionHashes: { reader: sha256(reader), member: sha256(member), admin: sha256(admin), tenant: sha256(tenant) },
    ports: 'auth.uid reads synthetic request claims; platform/agency privilege branches disabled, ordinary role helpers are actual committed functions; table projection fixture, not full migration replay',
    cleanup: { created, started, database, port } };
  if (created) { try { sql('drop database ' + database, 'postgres'); report.cleanup.databaseDropped = true; } catch (error) { report.cleanup.databaseDropError = error.message; } }
  if (started) { try { call('pg_ctl', ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop']); report.cleanup.clusterStopped = true; } catch (error) { report.cleanup.stopError = error.message; } }
  writeFileSync(resolve(scratch, 'result.json'), JSON.stringify(report, null, 2));
  console.log(`RESULT ${cases.filter(c => c.status === 'PASS').length} PASS / ${cases.filter(c => c.status === 'FAIL').length} FAIL; ${scratch}`);
  if (cases.some(c => c.status === 'FAIL') || (started && !report.cleanup.clusterStopped)) process.exitCode = 1;
}
