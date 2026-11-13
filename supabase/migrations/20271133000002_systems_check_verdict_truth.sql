-- ANT-165 — Systems Check verdict truth: fix the two original SQL verdict functions
-- from 20260816170000_systems_check_l3_operator_scope (never edit that applied file).
--
-- DEFECT 1 (operator_db_health_snapshot): the longest-active-query measure filtered
--   only on state='active', so the Realtime logical-replication walsender —
--   permanently 'active' while executing START_REPLICATION — made
--   longest_active_seconds track walsender uptime (3985.3s observed on a healthy
--   database, 47/90 connections, cache hit 1.0, zero deadlocks) and the
--   (v_longest_sec < 300) rule failed every run. Fix: restrict the measure to
--   client backends; report replication slot lag as its own truthful signal.
--
-- DEFECT 2 (operator_rls_coverage_audit): the function reported RLS-enabled tables
--   with zero policies (117) with no effective-permission evaluation, and the Edge
--   runner treated that count as blocking. Verified reality: 513/513 public tables
--   RLS-enabled and NONE of the 117 carries a direct INSERT/UPDATE/DELETE grant to
--   anon/authenticated — default-deny, not exposure. Fix: the audit now computes a
--   blocking exposure verdict = RLS-disabled ∪ (RLS-enabled ∧ no policy ∧ direct DML
--   grant to anon/authenticated/public); no-policy without grants stays reported as
--   informational default-deny. All existing fields are preserved; new fields are
--   additive. The companion Edge consumer change (blocking on the new verdict) ships
--   in the same PR.
--
-- Signatures, STABLE, SECURITY DEFINER, search_path and the operator/service_role
-- authorization gate are preserved verbatim. Fail-closed semantics are preserved:
-- real exposure still fails the check.

create or replace function public.operator_db_health_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_max_conn      int;
  v_conns         int;
  v_active        int;
  v_idle          int;
  v_idle_in_txn   int;
  v_longest_sec   numeric;
  v_db_size       bigint;
  v_hit           bigint;
  v_read          bigint;
  v_hit_ratio     numeric;
  v_deadlocks     bigint;
  v_healthy       boolean;
  v_slot_lag      bigint;
  v_slots_active  int;
begin
  if not (public.is_platform_operator() or auth.role() = 'service_role') then
    raise exception 'operator_scope_forbidden' using errcode = '42501';
  end if;

  v_max_conn := coalesce(nullif(current_setting('max_connections', true), '')::int, 0);

  -- client backends ONLY: a walsender executing START_REPLICATION is 'active' for its
  -- whole lifetime by design — counting it made this check fail every healthy run
  -- (ANT-165). Genuine runaway application queries are still caught here.
  select
    count(*),
    count(*) filter (where state = 'active'),
    count(*) filter (where state = 'idle'),
    count(*) filter (where state = 'idle in transaction'),
    coalesce(max(extract(epoch from (now() - query_start)))
             filter (where state = 'active' and query_start is not null
                     and backend_type = 'client backend'), 0)
  into v_conns, v_active, v_idle, v_idle_in_txn, v_longest_sec
  from pg_catalog.pg_stat_activity
  where datname = current_database();

  v_db_size := pg_catalog.pg_database_size(current_database());

  select coalesce(sum(blks_hit), 0), coalesce(sum(blks_read), 0), coalesce(sum(deadlocks), 0)
  into v_hit, v_read, v_deadlocks
  from pg_catalog.pg_stat_database
  where datname = current_database();

  v_hit_ratio := case when (v_hit + v_read) > 0 then round(v_hit::numeric / (v_hit + v_read), 4) else null end;

  -- Realtime health signal (its own axis; measured 2026-11-05: healthy at ~1.8MB).
  select coalesce(max(pg_catalog.pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)), 0),
         count(*) filter (where active)
  into v_slot_lag, v_slots_active
  from pg_catalog.pg_replication_slots;

  -- Healthy iff: connection headroom (<90% of max), no runaway CLIENT query (>300s),
  -- and — only when there is enough read traffic to judge — a cache hit ratio above
  -- 0.90. A pre-traffic DB with a NULL hit ratio is NOT failed on that axis (§13).
  v_healthy :=
       (v_max_conn = 0 or v_conns < (v_max_conn * 0.9))
   and (v_longest_sec < 300)
   and (v_hit_ratio is null or (v_hit + v_read) < 10000 or v_hit_ratio >= 0.90);

  return jsonb_build_object(
    'healthy',              v_healthy,
    'max_connections',      v_max_conn,
    'connections',          v_conns,
    'active',               v_active,
    'idle',                 v_idle,
    'idle_in_transaction',  v_idle_in_txn,
    'longest_active_seconds', round(v_longest_sec, 1),
    'replication_slots_active', v_slots_active,
    'replication_slot_lag_bytes', v_slot_lag,
    'db_size_bytes',        v_db_size,
    'cache_hit_ratio',      v_hit_ratio,
    'deadlocks',            v_deadlocks,
    'measured_at',          now()
  );
end;
$function$;


create or replace function public.operator_rls_coverage_audit()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_total       int;
  v_rls_on      int;
  v_forced      int;
  v_no_rls      text[];
  v_rls_no_pol  text[];
  v_coverage    numeric;
  v_exposed     text[];   -- blocking: RLS-enabled, no policy, AND direct DML grant
  v_exposed_ct  int;
begin
  if not (public.is_platform_operator() or auth.role() = 'service_role') then
    raise exception 'operator_scope_forbidden' using errcode = '42501';
  end if;

  with base as (
    select c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl, c.relowner
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'                       -- ordinary base tables only
      and c.relname not like 'pg_%'
  ),
  pol as (
    select pc.oid, count(p.polname) as npol
    from base pc
    left join pg_catalog.pg_policy p on p.polrelid = pc.oid
    group by pc.oid
  ),
  dml_grant as (               -- direct table grants that make no-policy RLS a real exposure
    select distinct pc.oid
    from base pc
    cross join lateral pg_catalog.aclexplode(coalesce(pc.relacl,
                         pg_catalog.acldefault('r', pc.relowner))) acl
    left join pg_catalog.pg_roles gr on gr.oid = acl.grantee
    where coalesce(gr.rolname, 'public') in ('anon','authenticated','public')
      and acl.privilege_type in ('INSERT','UPDATE','DELETE')
  )
  select
    (select count(*) from base),
    (select count(*) from base where relrowsecurity),
    (select count(*) from base where relforcerowsecurity),
    (select coalesce(array_agg(relname order by relname), '{}')
       from base where not relrowsecurity),
    (select coalesce(array_agg(b.relname order by b.relname), '{}')
       from base b join pol on pol.oid = b.oid
      where b.relrowsecurity and pol.npol = 0),
    (select coalesce(array_agg(b.relname order by b.relname), '{}')
       from base b join pol on pol.oid = b.oid join dml_grant g on g.oid = b.oid
      where b.relrowsecurity and pol.npol = 0)
  into v_total, v_rls_on, v_forced, v_no_rls, v_rls_no_pol, v_exposed;

  v_coverage := case when v_total > 0 then round(v_rls_on::numeric / v_total, 4) else null end;
  v_exposed_ct := coalesce(array_length(v_exposed, 1), 0);

  return jsonb_build_object(
    'total_tables',            v_total,
    'rls_enabled',             v_rls_on,
    'rls_forced',              v_forced,
    'coverage_ratio',          v_coverage,
    'tables_without_rls_count', coalesce(array_length(v_no_rls, 1), 0),
    'tables_without_rls',      (select coalesce(array_agg(t), '{}') from unnest(v_no_rls) with ordinality u(t, ord) where ord <= 50),
    'tables_rls_no_policy_count', coalesce(array_length(v_rls_no_pol, 1), 0),
    'tables_rls_no_policy',    (select coalesce(array_agg(t), '{}') from unnest(v_rls_no_pol) with ordinality u(t, ord) where ord <= 50),
    -- NEW: the effective-exposure verdict (ANT-165). Blocking = tables_without_rls
    -- (unchanged contract) ∪ tables with RLS, no policy, AND a direct anon/
    -- authenticated/public DML grant. no-policy WITHOUT grants = default-deny,
    -- reported informationally above, not blocking.
    'blocking_exposure_count',  coalesce(array_length(v_no_rls, 1), 0) + v_exposed_ct,
    'blocking_exposure_tables', (select coalesce(array_agg(t), '{}') from (
                                   select t from unnest(v_no_rls) with ordinality u(t, ord) where ord <= 50
                                   union all
                                   select t from unnest(v_exposed) with ordinality u(t, ord) where ord <= 50
                                 ) x),
    'rls_no_policy_with_dml_grant_count', v_exposed_ct,
    'rls_no_policy_with_dml_grant', (select coalesce(array_agg(t), '{}') from unnest(v_exposed) with ordinality u(t, ord) where ord <= 50),
    'measured_at',             now()
  );
end;
$function$;
