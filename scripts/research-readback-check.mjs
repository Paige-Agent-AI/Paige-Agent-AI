// Actual PostgreSQL proof over canonical Research DDL and the incumbent scope proof.
// Empty, credential-free loopback fixtures only; no provider or hosted connection.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = file => readFileSync(file, 'utf8');
const baseline = process.argv.includes('--baseline');
const scope = spawnSync(process.execPath, ['scripts/research-scope-check.mjs', '--emit-fixture'], { encoding: 'utf8', windowsHide: true });
if (scope.status !== 0) throw new Error(scope.stderr || 'Canonical scope fixture unavailable');
const original = scope.stdout;
const initial = read('supabase/migrations/20260712231157_paige_deep_research.sql');
const tableStart = initial.indexOf('CREATE TABLE IF NOT EXISTS public.research_runs');
const tableEnd = initial.indexOf('CREATE INDEX IF NOT EXISTS', tableStart);
if (tableStart < 0 || tableEnd < 0) throw new Error('Canonical Research DDL unavailable');
const lineage = [...read('supabase/migrations/20270545000000_research_tenant_lineage.sql')
  .matchAll(/ALTER TABLE public\.research_(?:runs|sources)\s+ADD COLUMN tenant_id[^;]+;/g)].map(x => x[0]).join('\n');
if (!lineage.includes('research_runs') || !lineage.includes('research_sources')) throw new Error('Canonical lineage DDL unavailable');
const migration = read('supabase/migrations/20271108181000_research_native_readback.sql')
  .replace(/^begin;\s*$/im, '').replace(/^commit;\s*$/im, '');
const schema = `
create table public.tenants(id uuid primary key);
${initial.slice(tableStart, tableEnd)}
${read('supabase/migrations/20260713004633_research_runs_entity_profile.sql')}
${lineage}
${read('supabase/migrations/20270588000000_research_dossier_column.sql')}
alter table public.research_runs enable row level security;
alter table public.research_sources enable row level security;
-- Match the production service role's RLS bypass, without granting table reads.
alter role service_role bypassrls;
${read('supabase/migrations/20270565000000_research_persist_service_grants.sql')}
${baseline ? '' : migration}
`;
const a='00000000-0000-4000-8000-000000000001', b='00000000-0000-4000-8000-000000000003';
const t='aa000000-0000-4000-8000-000000000002', u='bb000000-0000-4000-8000-000000000004';
const run='00000000-0000-4000-8000-000000000005', foreign='00000000-0000-4000-8000-000000000006';
const missing='00000000-0000-4000-8000-000000000099';
const rpc=(r=run,tenant=t,actor=a)=>`public.research_readback_persisted_run('${r}','${tenant}','${actor}')`;
let expected=0;
const ok=(expression,label)=>{expected++;return `select public.readback_fixture_assert(${expression},'${label}');`;};
const denied=(statement,label)=>{expected++;return `select public.readback_fixture_denied($deny$${statement}$deny$,'${label}');`;};
let checks=`
create function public.readback_fixture_assert(ok boolean,label text) returns void language plpgsql as $$begin
 perform public.scope_fixture_assert(ok,label); raise notice 'READBACK_OK:%',label; end$$;
create function public.readback_fixture_denied(statement text,label text) returns void language plpgsql as $$begin
 perform public.scope_fixture_denied(statement,label); raise notice 'READBACK_OK:%',label; end$$;
update public.profiles set active_tenant_id='${t}' where user_id in ('${a}','${b}');
update public.tenant_members set status='active' where user_id='${a}' and tenant_id='${t}';
insert into public.tenant_members(user_id,tenant_id,status) values('${b}','${t}','active');
insert into public.tenants values('${t}'),('${u}');
insert into public.research_runs(id,tenant_id,user_id,question,findings,coverage,stop_reason)
 values('${run}','${t}','${a}','Protected existing run','[{"text":"supported","citations":[1]}]','{"stop_reason":"max_hops"}','max_hops'),
 ('${foreign}','${u}','${b}','Foreign protected run','[]','{}','answered');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
${denied('select * from public.research_runs','baseline INSERT-only parent SELECT refuses')}
${denied('select * from public.research_sources','baseline INSERT-only source SELECT refuses')}
reset role;
`;
if (!baseline) {
  checks+=`
${ok(`not has_table_privilege('service_role','public.research_runs','SELECT') and not has_table_privilege('service_role','public.research_sources','SELECT')`,'base service reads remain denied')}
${ok(`has_table_privilege('service_role','public.research_runs','INSERT') and has_table_privilege('service_role','public.research_sources','INSERT')`,'base service inserts retained')}
${ok(`not has_table_privilege('anon','public.research_runs','SELECT') and not has_table_privilege('authenticated','public.research_runs','SELECT') and not has_table_privilege('anon','public.research_sources','SELECT') and not has_table_privilege('authenticated','public.research_sources','SELECT')`,'browser base reads remain denied')}
${ok(`not has_function_privilege('anon','public.research_readback_persisted_run(uuid,uuid,uuid)','EXECUTE') and not has_function_privilege('authenticated','public.research_readback_persisted_run(uuid,uuid,uuid)','EXECUTE')`,'browser RPC ACL refuses')}
${ok(`has_function_privilege('service_role','public.research_readback_persisted_run(uuid,uuid,uuid)','EXECUTE')`,'service-only RPC ACL')}
${ok(`not exists(select from pg_proc p cross join lateral aclexplode(p.proacl) x where p.oid='public.research_readback_persisted_run(uuid,uuid,uuid)'::regprocedure and x.grantee=0)`,'PUBLIC execute revoked')}
${ok(`(select prosecdef and provolatile='s' and proconfig=array['search_path=pg_catalog, public'] from pg_proc where oid='public.research_readback_persisted_run(uuid,uuid,uuid)'::regprocedure)`,'stable definer fixed search path')}
set local role service_role;
${ok(`${rpc()}->>'id'='${run}' and ${rpc()}->'sources'='[]'::jsonb`,'existing parent available before source insert')}
${ok(`${rpc(missing)} is null and ${rpc(foreign)} is null and ${rpc(run,t,b)} is null`,'unknown foreign and wrong-owner runs reveal no record')}
${denied(`select ${rpc(run,u,a)}`,'foreign active workspace refuses')}
${denied(`select public.research_readback_persisted_run(null,'${t}','${a}')`,'missing run identity refuses')}
insert into public.research_sources(run_id,tenant_id,user_id,source_index,url,reliability_score,published_at,fetched_at)
 values('${run}','${t}','${a}',2,'https://fixture.invalid/two',0.800,null,'2026-10-16T00:00:00Z'),
 ('${run}','${t}','${a}',1,'https://fixture.invalid/one',0.900,'2026-10-15T00:00:00Z','2026-10-16T00:00:00Z');
${ok(`jsonb_array_length(${rpc()}->'sources')=2 and ${rpc()}#>>'{sources,0,source_index}'='1' and ${rpc()}#>>'{sources,1,source_index}'='2'`,'all sources ordered by canonical index')}
${ok(`${rpc()}#>>'{sources,0,tenant_id}'='${t}' and ${rpc()}#>>'{sources,0,user_id}'='${a}' and ${rpc()}#>>'{sources,0,run_id}'='${run}'`,'exact source lineage retained')}
${ok(`(${rpc()}#>>'{sources,0,reliability_score}')::numeric=0.900 and (${rpc()}#>>'{sources,0,published_at}')::timestamptz='2026-10-15T00:00:00Z'::timestamptz and ${rpc()}#>'{sources,1,published_at}'='null'::jsonb`,'native numeric and null timestamp semantics')}
${ok(`not (${rpc()} ? 'dossier') and not (${rpc()} ? 'client_user_id')`,'unneeded diagnostic and client fields withheld')}
reset role;
-- Reapplying this additive migration cannot replace records or widen table ACL.
${migration}
set local role service_role;
${ok(`jsonb_array_length(${rpc()}->'sources')=2`,'migration replay preserves existing records')}
insert into public.research_runs(id,tenant_id,user_id,question) values('${missing}','${t}','${a}','Protected newly created run');
${ok(`${rpc(missing)}->>'id'='${missing}' and ${rpc(missing)}->'sources'='[]'::jsonb`,'standard new record works without a backfill')}
reset role;
update public.research_sources set user_id='${b}' where run_id='${run}' and source_index=1;
set local role service_role;
${denied(`select ${rpc()}`,'wrong-actor child refuses without source disclosure')}
reset role;
update public.research_sources set user_id='${a}',tenant_id='${u}' where run_id='${run}' and source_index=1;
set local role service_role;
${denied(`select ${rpc()}`,'wrong-tenant child refuses without source disclosure')}
reset role;
update public.research_sources set tenant_id='${t}' where run_id='${run}' and source_index=1;
update public.profiles set active_tenant_id='${u}' where user_id='${a}';
set local role service_role;
${denied(`select ${rpc()}`,'workspace switch refuses')}
reset role;
update public.profiles set active_tenant_id='${t}' where user_id='${a}';
update public.tenant_members set status='revoked' where user_id='${a}' and tenant_id='${t}';
set local role service_role;
${denied(`select ${rpc()}`,'revoked seat refuses')}
reset role;
update public.tenant_members set status='active' where user_id='${a}' and tenant_id='${t}';
update auth.users set banned_until=now()+interval '1 hour' where id='${a}';
set local role service_role;
${denied(`select ${rpc()}`,'banned actor refuses')}
reset role;
update auth.users set banned_until=null,deleted_at=now() where id='${a}';
set local role service_role;
${denied(`select ${rpc()}`,'deleted actor refuses')}
reset role;
update auth.users set deleted_at=null where id='${a}';
select set_config('request.jwt.claims','{"role":"authenticated","sub":"${a}"}',true);
set local role service_role;
${denied(`select ${rpc()}`,'SQL service role with a customer JWT refuses')}
reset role;
set local role authenticated;
${denied(`select ${rpc()}`,'ordinary owner cannot call service reader')}
${denied('select * from public.research_runs','ordinary owner base read remains denied')}
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role anon;
${denied(`select ${rpc()}`,'anon role cannot forge service authority via claims')}
reset role;
`;
}
const marker='create function public.scope_fixture_assert';
if (!original.includes(marker) || !original.trimEnd().endsWith('rollback;')) throw new Error('Incumbent scope fixture changed');
// Functional replacements preserve SQL dollar quotes verbatim ($$ is special
// inside JavaScript's string-replacement syntax).
const sql=original.replace(marker,()=>schema+'\n'+marker).replace(/rollback;\s*$/,()=>checks+'\nrollback;');
if (process.argv.includes('--emit-fixture')) { process.stdout.write(sql); process.exit(0); }
const url=new URL(process.env.RESEARCH_READBACK_TEST_DATABASE_URL??'postgresql://postgres@127.0.0.1:65476/postgres');
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.password||!url.port||url.port==='5432'||url.username!=='postgres'||url.pathname!=='/postgres') throw new Error('An empty credential-free dedicated loopback fixture is required');
const result=spawnSync(process.env.PSQL_BIN??'psql',['-X','-v','ON_ERROR_STOP=1',url.toString()],{input:sql,encoding:'utf8',windowsHide:true,timeout:60_000});
if (result.status!==0) { console.error(result.stderr); process.exit(result.status??1); }
const passed=(result.stderr.match(/READBACK_OK:/g)??[]).length;
if(passed!==expected)throw new Error(`Native assertion transcript incomplete: ${passed}/${expected}`);
console.log(`PASS ${passed} native ${baseline?'baseline permission-denial':'readback ACL/lineage/replay'} controls + incumbent19 scope controls; actual canonical Research DDL; transaction rolled back`);
