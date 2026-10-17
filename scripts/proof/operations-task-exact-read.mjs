// Owned disposable PostgreSQL proof. Native authority/read functions are loaded
// from their canonical sources. Auth plumbing/non-SOLO helpers are fixture ports.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseline = process.argv.includes('--baseline'), ci = process.argv.includes('--postgres');
assert.ok(!ci || process.env.CI === 'true', '--postgres requires disposable CI');
assert.ok(!ci || !process.env.PGHOST || ['127.0.0.1', 'localhost'].includes(process.env.PGHOST), 'loopback only');
const directory = resolve(root, 'work/operations-task-exact-proof');
mkdirSync(directory, { recursive: true });
const scratch = mkdtempSync(resolve(directory, baseline ? 'red-' : 'green-'));
const bin = process.env.TASK_READ_PG_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/16/bin' : '');
const exe = name => bin ? resolve(bin, name + (process.platform === 'win32' ? '.exe' : '')) : name;
const port = Number(process.env.TASK_READ_PG_PORT ?? (ci ? 5432 : 65493));
const database = `operations_task_read_${process.pid}`, data = resolve(scratch, 'data');
const argv = db => ['-X', '-q', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', db, '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
const call = (name, args, options = {}) => execFileSync(exe(name), args, { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8_000_000, ...options });
const sql = (statement, db = database) => call('psql', argv(db), { input: statement }).trim();
const text = path => readFileSync(resolve(root, path), 'utf8');
const paths = {
  reader: 'supabase/migrations/20271020000250_operations_native_crm_work_read.sql',
  seats: 'supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql',
  tenant: 'supabase/migrations/20260714144656_tier_rail_phaseB_agency_standing.sql',
  roles: 'supabase/migrations/20251009234919_3d7566f7-15b7-462f-90a3-b74b713298b6.sql',
  roleMap: 'supabase/migrations/20270509000000_nothing_reads_the_retired_title_role.sql',
  roleSync: 'supabase/migrations/20260721002907_move2_slice1_tenant_scope_pii_admin.sql',
  roleTrigger: 'supabase/migrations/20260701012156_526687dc-9adb-46c8-bb99-ff3f0737dc1c.sql',
  migration: 'supabase/migrations/20271110012000_operations_crm_task_exact_read.sql',
  incumbent: 'supabase/tests/operations_native_crm_work_read.sql',
  proof: 'supabase/tests/operations_crm_task_exact_read.sql',
};
const extract = (source, name) => {
  const match = source.match(new RegExp('create(?: or replace)? function public\\.' + name + '\\s*\\([\\s\\S]*?\\bas\\s+(\\$[a-z_0-9]*\\$)[\\s\\S]*?\\1;', 'i'));
  assert.ok(match, 'actual canonical function ' + name); return match[0];
};
const cases = [], compatibility = {};
const check = (name, run) => {
  try { run(); cases.push({ name, status: 'PASS' }); console.log('PASS ' + name); }
  catch (error) { cases.push({ name, status: 'FAIL', error: error.message }); console.log('FAIL ' + name + ': ' + error.message); }
};
const sourceHashes = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, { path, sha256: createHash('sha256').update(text(path)).digest('hex') }]));
let started = false, created = false, nativePass = 0, incumbentPass = 0;
try {
  if (!ci) {
    const probe = createServer();
    await new Promise((yes, no) => { probe.once('error', no); probe.listen(port, '127.0.0.1', yes); });
    await new Promise(yes => probe.close(yes));
    call('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--no-locale', '--encoding=UTF8', '--no-sync']);
    call('pg_ctl', ['-D', data, '-l', resolve(scratch, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -F`, '-w', '-t', '30', 'start'], { stdio: 'ignore' }); started = true;
  }
  sql('create database ' + database, 'postgres'); created = true;
  sql(`do $$begin
    if not exists(select from pg_roles where rolname='authenticated') then create role authenticated;end if;
    if not exists(select from pg_roles where rolname='anon') then create role anon;end if;
    if not exists(select from pg_roles where rolname='service_role') then create role service_role;end if;
  end$$;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
  create type public.app_role as enum('admin','super_admin','platform_admin','developer','user');
  create type public.tenant_role as enum('owner','admin','member');
  create table auth.users(id uuid primary key,email text);
  create table public.profiles(id uuid primary key default gen_random_uuid(),user_id uuid unique,active_tenant_id uuid);
  create table public.tenants(id uuid primary key,slug text,name text,status text,account_type text,parent_tenant_id uuid,account_number_prefix text,account_number bigint,features jsonb);
  create table public.tenant_members(id uuid primary key default gen_random_uuid(),tenant_id uuid,user_id uuid,status text,role public.tenant_role,joined_at timestamptz default now(),is_owner boolean,unique(tenant_id,user_id));
  create table public.user_roles(user_id uuid,role public.app_role,unique(user_id,role));
  create table public.clients(id uuid primary key,tenant_id uuid,created_by uuid,first_name text,last_name text,account_number text,linked_user_id uuid,assigned_coach_user_id uuid);
  create table public.tasks(id uuid primary key default gen_random_uuid(),tenant_id uuid,user_id uuid,title text,description text,status text,due_date timestamptz,updated_at timestamptz default now(),created_at timestamptz default now(),deal_id uuid,biz_id uuid,metadata jsonb);
  create index fixture_tasks_tenant on public.tasks(tenant_id);
  create index fixture_tasks_user on public.tasks(user_id);
  create function public.is_company_workspace(uuid) returns boolean language sql stable as $$select false$$;
  create function public.is_platform_operator() returns boolean language sql stable as $$select false$$;
  create function public.is_platform_owner() returns boolean language sql stable as $$select false$$;
  create function public.agency_can_manage_child(uuid,uuid) returns boolean language sql stable as $$select false$$;
  create function public.agency_team_role(uuid,uuid) returns text language sql stable as $$select null::text$$;
  create function public.is_platform_admin(uuid) returns boolean language sql stable as $$select false$$;
  ${extract(text(paths.seats), 'is_tenant_member')}
  ${extract(text(paths.seats), 'is_tenant_admin')}
  ${extract(text(paths.tenant), 'current_user_tenant_id')}
  ${extract(text(paths.roles), 'has_role')}
  ${extract(text(paths.roleMap), 'map_tenant_role_to_app_role')}
  ${extract(text(paths.roleSync), 'sync_tenant_member_to_user_roles')}
  ${text(paths.roleTrigger).match(/CREATE TRIGGER trg_sync_tenant_member_to_user_roles[\s\S]*?EXECUTE FUNCTION public\.sync_tenant_member_to_user_roles\(\);/i)?.[0] ?? assert.fail('actual canonical member-role trigger')}
  grant usage on schema public,auth to authenticated,anon,service_role;
  grant select on public.tasks,public.profiles,public.tenants,public.clients,public.tenant_members to authenticated;
  grant update on public.profiles to authenticated;
  alter table public.tasks enable row level security;
  create policy "Users can view own tasks" on public.tasks for select using(auth.uid()=user_id);
  create policy "Admins manage all tasks" on public.tasks for all to authenticated
    using(public.is_platform_owner() or public.has_role(auth.uid(),'admin'::public.app_role) or public.has_role(auth.uid(),'super_admin'::public.app_role))
    with check(public.is_platform_owner() or public.has_role(auth.uid(),'admin'::public.app_role) or public.has_role(auth.uid(),'super_admin'::public.app_role));
  create policy "Assigned staff read their clients' tasks" on public.tasks for select to authenticated using(exists(select 1 from public.clients c where c.linked_user_id=tasks.user_id and c.tenant_id=tasks.tenant_id and c.assigned_coach_user_id=auth.uid() and public.is_tenant_member(c.tenant_id)));
  create policy tenant_isolation on public.tasks as restrictive to authenticated using(public.is_platform_owner() or tenant_id is null or tenant_id=public.current_user_tenant_id());
  ${text(paths.reader)}
  `);
  const runProof = (path, name) => {
    const result = spawnSync(exe('psql'), argv(database), { input: text(path), encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8_000_000 });
    writeFileSync(resolve(scratch, name + '.log'), result.stdout + '\n' + result.stderr);
    const passes = (result.stderr.match(/NOTICE:\s+PASS:/g) ?? []).length;
    assert.equal(result.status, 0, result.stderr); assert.ok(passes > 0, 'actual native assertions must execute');
    return passes;
  };
  check('unchanged incumbent caller-RLS campaign before migration', () => { incumbentPass += runProof(paths.incumbent, 'incumbent-before'); });
  const signature = 'public.operations_crm_work_read(uuid,uuid)';
  const metadata = () => sql(`select json_build_object('oid',oid,'owner',pg_get_userbyid(proowner),'acl',proacl,'defaults',proargdefaults,'names',proargnames,'types',proargtypes::text,'lang',(select lanname from pg_language where oid=prolang),'volatile',provolatile,'definer',prosecdef,'config',proconfig) from pg_proc where oid='${signature}'::regprocedure;`);
  compatibility.before = metadata();
  const snapshot = () => {
    const fixture = text(paths.proof).split("select set_config('request.jwt.claims'")[0];
    return sql(fixture + `update public.tasks set created_at='2026-01-01T00:00:00Z',updated_at='2026-01-02T00:00:00Z';
      set local request.jwt.claims='{"sub":"ed350000-0000-4000-8000-000000000001","role":"authenticated"}';set local role authenticated;
      select md5(public.operations_crm_work_read('ed350000-0000-4000-8000-000000000001','ed350000-0000-4000-8000-000000001111')::text);
      reset role;rollback;`);
  };
  compatibility.beforeRows = snapshot();
  check('incumbent projection exposes no exact overload before this migration', () => assert.equal(sql("select to_regprocedure('public.operations_crm_work_read(uuid,uuid,uuid)') is null;"), 't'));
  if (!baseline) {
    check('failed migration rolls back both signatures and original ABI', () => {
      const failed = text(paths.migration).replace("NOTIFY pgrst, 'reload schema';", () => "DO $rollback$ BEGIN IF to_regprocedure('public.operations_crm_work_read(uuid,uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'exact overload missing before rollback';END IF;RAISE EXCEPTION 'fixture rollback';END $rollback$;");
      assert.notEqual(failed, text(paths.migration), 'rollback injection uses actual migration boundary');
      const result = spawnSync(exe('psql'), argv(database), { input: failed, encoding: 'utf8', windowsHide: true, timeout: 10000 });
      writeFileSync(resolve(scratch, 'rollback.log'), result.stdout + '\n' + result.stderr);
      assert.notEqual(result.status, 0); assert.match(result.stderr, /ERROR:\s+fixture rollback/);
      assert.equal(metadata(), compatibility.before);
      assert.equal(sql("select to_regprocedure('public.operations_crm_work_read(uuid,uuid,uuid)') is null;"), 't');
    });
    sql(text(paths.migration));
  }
  check('two-argument OID owner ACL search_path language and argument ABI remain unchanged', () => { compatibility.after = metadata(); assert.equal(compatibility.after, compatibility.before); });
  check('complete capped list JSON and explicit has_more are byte-equivalent before and after', () => { compatibility.afterRows = snapshot(); assert.equal(compatibility.afterRows, compatibility.beforeRows); });
  check('unchanged incumbent caller-RLS campaign after composition', () => { incumbentPass += runProof(paths.incumbent, 'incumbent-after'); });
  check('actual exact-ID/native compatibility and isolation cases', () => { nativePass = runProof(paths.proof, 'exact-native'); });
} catch (error) { cases.push({ name: 'setup-or-native-proof', status: 'FAIL', error: error.message }); console.error(error); }
finally {
  if (created) { sql('drop database ' + database + ' with(force)', 'postgres'); created = false; }
  if (started) { call('pg_ctl', ['-D', data, '-w', '-t', '30', 'stop', '-m', 'fast'], { stdio: 'ignore' }); started = false; }
  const failures = cases.filter(row => row.status !== 'PASS').length;
  writeFileSync(resolve(scratch, 'receipt.json'), JSON.stringify({ baseline, cases, nativePass, incumbentPass, failures, sourceHashes, compatibility, databaseDropped: !created, ownedClusterStopped: !started, boundary: 'Actual isolated PostgreSQL; Auth/non-SOLO helper ports and fixture schema/RLS are explicit. Not full-schema/PostgREST/production/customer/Live proof.' }, null, 2));
  console.log(JSON.stringify({ scratch, nativePass, incumbentPass, failures, databaseDropped: !created, ownedClusterStopped: !started }));
  process.exitCode = failures ? 1 : 0;
}
