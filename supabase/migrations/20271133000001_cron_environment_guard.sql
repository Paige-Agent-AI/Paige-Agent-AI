-- ANT-165 — cron environment guard (preview-to-production scheduled-execution leakage).
--
-- CONTEXT (2026-11-05 incident): migration files call cron.schedule() with commands
-- embedding the literal production URL. Preview branches are created by replaying the
-- whole migration history (with_data=false), so every branch re-creates every job and
-- fires it at PRODUCTION: measured ~199,000 unauthorized 401s/day across 23 active
-- previews vs ~11,000 legitimate 200s/day, ~350ms edge time per rejected call. Older
-- migrations also embed a dead legacy project ref (bfmyebsjyuoecmjskqhs) in 8 further
-- jobs production removed manually — branches resurrect them.
--
-- SCOPE HONESTLY STATED: this migration secures the STEADY STATE of newly created
-- branches (after their replay completes; minutes-long provisioning windows still
-- expose raw jobs) and reconciles the legacy-job drift. It cannot rewrite applied
-- history, and ALREADY-PROVISIONED preview branches do not receive forward migrations
-- — those are remediated per-branch (owner-approved rollout), not by this file.
--
-- CONTRACT (default-off): rewrite the 21 production-URL http jobs to guarded commands
-- and leave them ACTIVE=FALSE everywhere; unschedule dead legacy jobs. Production is
-- re-enabled exactly once by a runbook-only operation (below) that sets
-- app.settings.project_ref and flips the allowlisted jobs on — never by a migration,
-- so no branch can inherit authorization to invoke production (verified: database-
-- level settings DO reach branches — prod's app.settings.jwt_exp is present on live
-- branches — so "setting presence" alone could never be the gate; the gate is the
-- combination of default-off jobs + ops-only enable).
--
-- IDENTITY: idempotent end-to-end (create-if-not-exists, or-replace, capture-once
-- backup, reschedule-by-name, unschedule-if-present loops); db push applies files
-- statement-by-statement, tolerated by design. Filenames continue the chain's
-- existing future-dated sequence (20271132...) because deploy-migrations refuses any
-- file versioned below production's newest recorded migration.
--
-- CONTINUITY: the 16 interval-scheduled jobs miss at most one tick each between this
-- migration landing and the runbook enable (same supervised window) — durable queues
-- hold the work. FIXED-TIME jobs (systems-check-scheduled 09:00, paige-evaluator-daily
-- 05:30, paige-heartbeat-daily 13:00, paige-model-watch-daily 03:17, n8n-keepalive
-- every 6h) lose a whole cycle if the enable lands after their fire time — schedule
-- the window accordingly. The 7 local-SQL jobs (growth sweeper, operator-mrr,
-- meter-llm, resend-receipt, native-event sweeper, orchestration reconciler,
-- agreements expiry) are untouched: they address only their own database's data.

-- 0) Capture current state BEFORE any change. First capture per jobid is authoritative
--    so the restoration path always restores the ORIGINAL pre-migration definitions,
--    never a later remediated state.

create table if not exists public.cron_job_backup (
  captured_at timestamptz not null default now(),
  jobid       bigint,
  jobname     text,
  schedule    text,
  command     text,
  database    text,
  username    text,
  active      boolean,
  primary key (captured_at, jobid)
);

insert into public.cron_job_backup (jobid, jobname, schedule, command, database, username, active)
select j.jobid, j.jobname, j.schedule, j.command, j.database, j.username, j.active
from cron.job j
where not exists (
  select 1 from public.cron_job_backup b where b.jobid = j.jobid
);

-- 1) Helpers.

create or replace function public.cron_edge_url(p_function text)
returns text
language sql
stable
as $fn$
  select 'https://' || nullif(btrim(current_setting('app.settings.project_ref', true)), '')
         || '.supabase.co/functions/v1/' || p_function
$fn$;

-- One guarded invocation command for every scheduled edge worker: a no-op string
-- unless app.settings.project_ref is provisioned (production-only, runbook step).
create or replace function public.cron_guarded_edge_command(p_function text)
returns text
language sql
stable
as $fn$
  select format($cmd$
    select case
      when nullif(btrim(current_setting('app.settings.project_ref', true)), '') is null
        then 'cron skipped: environment not provisioned'
      else (select net.http_post(
             url     := public.cron_edge_url(%1$L),
             headers := jsonb_build_object('Content-Type','application/json',
                                           'x-cron-token', public.cron_token_header()),
             body    := '{}'::jsonb
           ))::text
    end;$cmd$, p_function)
$fn$;

-- Allowlist = the 21 verified production-URL http jobs (2026-11-05 reconciliation:
-- 28 active jobs total = these 21 + 7 local-SQL jobs). Nothing else may ever be
-- re-enabled by the runbook.
create table if not exists public.cron_production_allowlist (
  jobname  text primary key,
  function text not null,
  schedule text not null
);

insert into public.cron_production_allowlist (jobname, function, schedule) values
  ('booking-notifications','process-booking-notifications','*/5 * * * *'),
  ('plan-reminder-runner','plan-reminder-cron','* * * * *'),
  ('paige-action-worker','paige-action-worker','*/2 * * * *'),
  ('comms-scheduled-drain','comms-scheduled-drain','* * * * *'),
  ('systems-check-scheduled','systems-check-run-scheduled','0 9 * * *'),
  ('systems-check-operator','systems-check-run-operator','0 * * * *'),
  ('alerting-evaluate','alerting-evaluate','*/5 * * * *'),
  ('alerting-deliver','alerting-deliver','2-59/5 * * * *'),
  ('security-canary-probe','security-canary-probe','20 * * * *'),
  ('paige-heartbeat-daily','paige-heartbeat','0 13 * * *'),
  ('paige-evaluator-daily','paige-evaluator','30 5 * * *'),
  ('paige-inbox-triage','paige-inbox-triage','*/5 * * * *'),
  ('paige-media-sweeper','paige-media-sweeper','*/2 * * * *'),
  ('solo-beta-welcome-drain','solo-beta-welcome-drainer','*/5 * * * *'),
  ('paige-document-worker','paige-document-worker','* * * * *'),
  ('n8n-oauth-keepalive','n8n-oauth-keepalive','0 */6 * * *'),
  ('email-campaign-worker','email-campaign-worker','* * * * *'),
  ('sales-payment-reconcile','sales-payment-reconcile','*/5 * * * *'),
  ('gmail-mailbox-sync','gmail-mailbox-sync','*/5 * * * *'),
  ('paige-model-watch-daily','paige-model-watch','17 3 * * *'),
  ('team-hub-file-sweep','team-hub-file-sweep','41 * * * *')
on conflict (jobname) do update
  set function = excluded.function,
      schedule = excluded.schedule;

-- Both tables and the helpers are operator/DBA-only: RLS on (forced, the repo
-- convention) and no anon/authenticated/public access of any kind — without this,
-- the rollback path and the enable allowlist would be anon-writable AND the new
-- operator_rls_coverage_audit would correctly fail on these very tables.
alter table public.cron_job_backup enable row level security;
alter table public.cron_job_backup force row level security;
revoke all on public.cron_job_backup from public, anon, authenticated;

alter table public.cron_production_allowlist enable row level security;
alter table public.cron_production_allowlist force row level security;
revoke all on public.cron_production_allowlist from public, anon, authenticated;


-- 2) Reschedule allowlisted jobs to guarded commands and deactivate them.
--    cron.schedule() replaces by jobname (keeping the existing jobid); alter_job
--    takes the bigint job id.

do $blk$
declare
  j record;
begin
  for j in
    select a.jobname, a.function, a.schedule, c.jobid
    from public.cron_production_allowlist a
    join cron.job c on c.jobname = a.jobname
  loop
    perform cron.schedule(j.jobname, j.schedule, public.cron_guarded_edge_command(j.function));
    perform cron.alter_job(j.jobid, active := false);
  end loop;
end
$blk$;

-- 3) Unschedule the dead legacy jobs (present in branches via old migrations;
--    production removed them manually long ago — this reconciles the drift).

do $blk$
declare
  j record;
begin
  for j in
    select jobid from cron.job where jobname in (
      'send-automated-reminders','sync-business-credit-daily','quickbooks-weekly-sync',
      'affiliate-monthly-statement','refresh-fundability-scores-january',
      'refresh-fundability-scores-july','mma-os-bridge-flush-every-5min',
      'rebuild-client-financial-brief-nightly','scan-soft-subagents-tool-refs',
      'doctrine_124_weekly_sweep','doctrine_116_weekly_sweep','doctrine_120_weekly_sweep',
      'readiness_scan_monthly','readiness_proposals_ttl_sweep',
      'doctrine_200_weekly_sweep','doctrine_201_weekly_sweep',
      'pmedl_retry_scan_every_15m'
    )
  loop
    perform cron.unschedule(j.jobid);
  end loop;
end
$blk$;

-- 4) Verification + restoration helpers (used by the runbook, tests and rollback).

create or replace function public.cron_verify_enabled()
returns table (jobname text, active boolean, schedule_matches boolean)
language sql
stable
as $fn$
  select a.jobname, c.active, c.schedule = a.schedule
  from public.cron_production_allowlist a
  left join cron.job c on c.jobname = a.jobname
  order by a.jobname
$fn$;

-- Restores the FIRST captured (pre-migration) state of every job verbatim — original
-- command AND active flag. Capture-once semantics keep this authoritative even if the
-- migration body is later re-run.
create or replace function public.cron_restore_backup(p_as_of timestamptz default now())
returns integer
language plpgsql
as $fn$
declare
  v_job record;
  v_restored int := 0;
begin
  for v_job in
    select distinct on (jobid) jobid, jobname, schedule, command, active
    from public.cron_job_backup
    where captured_at <= p_as_of
    order by jobid, captured_at asc
  loop
    perform cron.schedule(v_job.jobname, v_job.schedule, v_job.command);
    perform cron.alter_job(
      (select jobid from cron.job where jobname = v_job.jobname),
      active := v_job.active
    );
    v_restored := v_restored + 1;
  end loop;
  return v_restored;
end
$fn$;

-- Functions are operator/DBA-only too (see step 1 note); placed here because
-- cron_restore_backup/cron_verify_enabled are defined above.

revoke all on function public.cron_restore_backup(timestamptz) from public, anon, authenticated;
revoke all on function public.cron_verify_enabled() from public, anon, authenticated;
revoke all on function public.cron_edge_url(text) from public, anon, authenticated;
revoke all on function public.cron_guarded_edge_command(text) from public, anon, authenticated;

-- RUNBOOK — PRODUCTION ENABLE (never commit this as a migration; branches must never
-- receive it). One supervised window timed BEFORE the day's fixed-time jobs fire, in order:
--   0. Confirm this migration applied:  select * from public.cron_verify_enabled();
--      (expect 21 rows, active=false — intentional pause)
--   1. begin;
--        alter database postgres set app.settings.project_ref = 'xygzykjyynhzqytbqnzu';
--        select cron.alter_job(c.jobid, active := true)
--          from public.cron_production_allowlist a join cron.job c on c.jobname = a.jobname;
--      commit;   -- any failure aborts the whole transaction: jobs stay off (fail-closed)
--   2. Verify: select * from public.cron_verify_enabled();  (21 rows active=true)
--   3. Within 70s observe one 200 per one-minute job (user_agent pg_net/0.19.5) in logs.
--   Rollback at any point: select public.cron_restore_backup();
--   NOTE: re-running this migration body on production after the enable re-deactivates
--   the 21 jobs (default-off by design); re-run the runbook to re-enable.
