// Protected native PostgreSQL proof. Only an empty loopback fixture is accepted;
// no provider, hosted database, credential or product data is used.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = path => readFileSync(path, 'utf8');
function declaration(path, name) {
  const source = read(path);
  const start = source.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i'));
  const marker = source.indexOf('$function$', start);
  const end = source.indexOf('$function$;', marker + 10);
  if (start < 0 || marker < 0 || end < 0) throw new Error('Canonical fixture declaration unavailable');
  return source.slice(start, end + 11);
}
const canonical = declaration('supabase/migrations/20260714144656_tier_rail_phaseB_agency_standing.sql', 'current_user_tenant_id')
  + '\n' + declaration('supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql', 'is_tenant_member');
const migration = read('supabase/migrations/20271108180000_research_current_scope.sql')
  .replace(/^begin;\s*$/im, '').replace(/^commit;\s*$/im, '');
const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000003';
const t = 'aa000000-0000-4000-8000-000000000002';
const u = 'bb000000-0000-4000-8000-000000000004';
const sql = `begin;
do $$begin if to_regclass('auth.users') is not null or to_regclass('public.profiles') is not null then
 raise exception 'An empty protected fixture database is required'; end if; end$$;
do $$begin
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if;
 if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
end$$;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$;
create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
create table public.profiles(user_id uuid primary key,active_tenant_id uuid);
create table public.tenant_members(user_id uuid,tenant_id uuid,status text,joined_at timestamptz default now());
-- Neutral dependency ports, not substitute current-tenant/member predicates:
-- those TWO complete canonical declarations are loaded verbatim below.
create function public.agency_can_manage_child(uuid,uuid) returns boolean language sql as $$select false$$;
create function public.agency_team_role(uuid,uuid) returns text language sql as $$select null::text$$;
create function public.is_platform_admin(uuid) returns boolean language sql as $$select coalesce(current_setting('fixture.operator',true),'')='yes'$$;
create function public.is_platform_operator() returns boolean language sql as $$select coalesce(current_setting('fixture.operator',true),'')='yes'$$;
create function public.is_company_workspace(uuid) returns boolean language sql as $$select $1='${u}'::uuid$$;
grant usage on schema auth,public to authenticated,service_role,anon;
${canonical}
${migration}
create function public.scope_fixture_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'FAIL: %',label; end if; end$$;
create function public.scope_fixture_denied(statement text,label text) returns void language plpgsql as $$begin
 begin execute statement; exception when insufficient_privilege then return; end;
 raise exception 'FAIL: % admitted',label; end$$;
insert into auth.users(id) values('${a}'),('${b}');
insert into profiles values('${a}','${t}'),('${b}','${u}');
insert into tenant_members(user_id,tenant_id,status) values('${a}','${t}','active'),('${a}','${u}','active'),('${b}','${u}','active');
select scope_fixture_assert(not has_function_privilege('anon','public.research_assert_current_scope(uuid,uuid)','execute'),'anon ACL');
select scope_fixture_assert(has_function_privilege('authenticated','public.research_assert_current_scope(uuid,uuid)','execute'),'JWT ACL');
select scope_fixture_assert(has_function_privilege('service_role','public.research_assert_current_scope(uuid,uuid)','execute'),'service ACL');
select scope_fixture_assert(not exists(select from pg_proc p cross join lateral aclexplode(p.proacl) x where p.oid='public.research_assert_current_scope(uuid,uuid)'::regprocedure and x.grantee=0),'PUBLIC ACL');
select scope_fixture_assert((select provolatile='s' from pg_proc where oid='public.research_assert_current_scope(uuid,uuid)'::regprocedure),'read-only stable');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"${a}"}',true);
set local role authenticated;
select scope_fixture_assert(research_assert_current_scope('${a}','${t}')=jsonb_build_object('actor_id','${a}'::uuid,'tenant_id','${t}'::uuid),'ordinary scope');
select scope_fixture_assert(research_assert_current_scope('${a}','${t.toUpperCase()}')->>'tenant_id'='${t}','uppercase UUID');
select scope_fixture_denied($q$select research_assert_current_scope('${b}','${u}')$q$,'forged actor');
select scope_fixture_denied($q$select research_assert_current_scope('${a}','${u}')$q$,'foreign workspace');
reset role;
update profiles set active_tenant_id=null where user_id='${a}';
set local role authenticated;
select scope_fixture_denied($q$select research_assert_current_scope('${a}',null)$q$,'first-membership fallback');
reset role;
update profiles set active_tenant_id='${t}' where user_id='${a}';
update tenant_members set status='revoked' where user_id='${a}' and tenant_id='${t}';
set local role authenticated;
select scope_fixture_denied($q$select research_assert_current_scope('${a}','${t}')$q$,'revoked member');
reset role;
update tenant_members set status='active' where user_id='${a}' and tenant_id='${t}';
update auth.users set banned_until=now()+interval '1 hour' where id='${a}';
set local role authenticated;
select scope_fixture_denied($q$select research_assert_current_scope('${a}','${t}')$q$,'banned actor');
reset role;
update auth.users set banned_until=null,deleted_at=now() where id='${a}';
set local role authenticated;
select scope_fixture_denied($q$select research_assert_current_scope('${a}','${t}')$q$,'deleted actor');
reset role;
update auth.users set deleted_at=null where id='${a}';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select scope_fixture_assert(research_assert_current_scope('${a}','${t}')->>'actor_id'='${a}','delegated service');
select scope_fixture_denied($q$select research_assert_current_scope('00000000-0000-4000-8000-000000000099','${t}')$q$,'missing delegated actor');
reset role;
update profiles set active_tenant_id='${u}' where user_id='${a}';
set local role service_role;
select scope_fixture_denied($q$select research_assert_current_scope('${a}','${t}')$q$,'workspace switch between checkpoints');
reset role;
update tenant_members set status='revoked' where user_id='${a}' and tenant_id='${u}';
select set_config('fixture.operator','yes',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"${a}"}',true);
set local role authenticated;
select scope_fixture_assert(research_assert_current_scope('${a}','${u}')->>'tenant_id'='${u}','incumbent JWT company-operator composition');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select scope_fixture_denied($q$select research_assert_current_scope('${a}','${u}')$q$,'service never inherits JWT operator exception');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select scope_fixture_denied($q$select research_assert_current_scope('${a}','${u}')$q$,'anon call');
reset role;
select 'PASS 19 native scope/ACL/current identity/workspace/member/UUID controls';
rollback;`;
if (process.argv.includes('--emit-fixture')) { process.stdout.write(sql); process.exit(0); }
const url = process.env.RESEARCH_SCOPE_TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:65451/postgres';
const parsed = new URL(url);
if (!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) || parsed.password) throw new Error('Only a credential-free loopback fixture is allowed');
const result = spawnSync(process.env.PSQL_BIN ?? 'psql', ['-X','-v','ON_ERROR_STOP=1',url], { input: sql, encoding: 'utf8' });
if (result.status !== 0) { console.error(result.stderr); process.exit(result.status ?? 1); }
console.log('PASS 19 native scope/ACL/current identity/workspace/member/UUID controls; original canonical predicates; fixture rolled back');
