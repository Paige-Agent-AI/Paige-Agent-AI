-- ANT-165 follow-up — provision the cron guard from a DBA-owned table, not a GUC.
--
-- PRODUCTION REALITY (2026-11-05 cutover): `alter database postgres set
-- app.settings.project_ref = ...` requires database ownership; the operational
-- MCP/admin role is `postgres` WITHOUT superuser and cannot run it. The cutover
-- therefore provisioned `public.cron_environment` instead, and this migration
-- brings git in lockstep with what production is actually running (drift
-- discipline: the live functions below already exist in production).
--
-- Semantics are identical to the GUC design, with one improvement: the
-- provision is an inspectable, revocable table row instead of a hidden
-- database setting. Branches replay this migration with an EMPTY table —
-- the guard fails closed (jobs stay inactive) exactly as before, and only
-- a DBA-inserted row provisions an environment.
--
-- RUNBOOK (replaces the ALTER DATABASE step in 20271133000001's tail):
--   production only, one supervised window:
--     insert into public.cron_environment (name, value)
--       values ('project_ref', '<this environment''s project ref>')
--       on conflict (name) do update set value = excluded.value;
--     select cron.alter_job(c.jobid, active := true)
--       from public.cron_production_allowlist a join cron.job c on c.jobname = a.jobname;
--   verify: select * from public.cron_verify_enabled();  -- 21 rows active=true
--   rollback: delete from public.cron_environment where name = 'project_ref';
--             (every guarded job then fails closed on its next tick) or
--             select public.cron_restore_backup();

create table if not exists public.cron_environment (
  name  text primary key,
  value text not null
);

alter table public.cron_environment enable row level security;
alter table public.cron_environment force row level security;
revoke all on public.cron_environment from public, anon, authenticated;

create or replace function public.cron_edge_url(p_function text)
returns text
language sql
stable
security definer
set search_path = 'public'
as $fn$
  select 'https://' || (select value from public.cron_environment where name = 'project_ref')
         || '.supabase.co/functions/v1/' || p_function
$fn$;

create or replace function public.cron_guarded_edge_command(p_function text)
returns text
language sql
stable
as $fn$
  select format($cmd$
    select case
      when (select value from public.cron_environment where name = 'project_ref') is null
        then 'cron skipped: environment not provisioned'
      else (select net.http_post(
             url     := public.cron_edge_url(%1$L),
             headers := jsonb_build_object('Content-Type','application/json',
                                           'x-cron-token', public.cron_token_header()),
             body    := '{}'::jsonb
           ))::text
    end;$cmd$, p_function)
$fn$;

revoke all on function public.cron_edge_url(text) from public, anon, authenticated;
revoke all on function public.cron_guarded_edge_command(text) from public, anon, authenticated;
