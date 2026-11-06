-- ANT-165 follow-up — blank-value hardening for the cron guard provision.
--
-- Independent-review P3 (2026-11-05): a provision row like ('project_ref','')
-- or ('project_ref','   ') would pass 20271133000003's `is null` test, mint the
-- URL "https://.supabase.co/...", and turn every tick into a doomed call. Two
-- layers now treat blank exactly like missing:
--   * a CHECK on the table (rejects the bad write at insert/update time), and
--   * nullif(btrim(value),'') in the guard (fails closed even if a blank row
--     somehow exists — e.g. a migration written before this one replays).
-- Production's live row is non-blank, so this applies as a no-op besides the
-- tightened functions; legitimate provisioning is unchanged.

alter table public.cron_environment
  drop constraint if exists cron_environment_value_nonblank;

alter table public.cron_environment
  add constraint cron_environment_value_nonblank
  check (value = btrim(value) and value <> '');

create or replace function public.cron_edge_url(p_function text)
returns text
language sql
stable
security definer
set search_path = 'public'
as $fn$
  select 'https://' || (
           select btrim(value) from public.cron_environment
           where name = 'project_ref' and nullif(btrim(value), '') is not null
         )
         || '.supabase.co/functions/v1/' || p_function
$fn$;

create or replace function public.cron_guarded_edge_command(p_function text)
returns text
language sql
stable
as $fn$
  select format($cmd$
    select case
      when nullif(btrim((select value from public.cron_environment where name = 'project_ref')), '') is null
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
