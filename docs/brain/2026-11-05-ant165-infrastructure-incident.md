# ANT-165 Infrastructure Incident — Engineering Second Brain Record

**Incident:** ANT-165 / INT-364 (Evidence Register → Intake & Gaps → Row 365)
**Date:** 2026-11-05 · **Resolution PRs:** #3283 (cron guard + Systems Check truth) and
#3287 (ignoreCommand script, `cron_environment` provisioning, this record) + blank-value
hardening follow-up (`20271133000004`)
**Status:** closed in production — cron cutover verified (21/21 guarded, ticks green);
Vercel production build green on the #3287 merge (`d81b65f`). This note records durable
engineering knowledge so no future agent repeats the incident's mistakes or reverts its
corrections.

## What happened (measured)

1. **Preview cron leakage.** Migration files called `cron.schedule()` with commands
   hardcoding the production URL. Every Supabase preview branch (created
   `with_data=false`) replays the full migration history, so every branch re-created
   every job and fired it at production: **~199,000 unauthorized 401s/day** (user
   agents `pg_net/0.20.4`/`0.20.3`) vs **~11,000 legitimate 200s/day**
   (`pg_net/0.19.5`), a 21:1 ratio per one-minute job, ~350ms edge time per rejected
   call. Old migrations also embed dead project ref `bfmyebsjyuoecmjskqhs` in 8 more
   jobs that production had removed manually — branches resurrected them.
2. **Vercel build waste.** No `ignoreCommand`; ~35% of builds were docs/evidence-only
   commits, and same-SHA duplicate builds were `source:"redeploy"` calls issued by
   the automation account ~51s after the Git build started.
3. **Systems Check false failures.** `operator_db_health_snapshot` counted the
   Realtime walsender (permanently `state='active'`) as a runaway query;
   `operator_rls_coverage_audit` returned no-policy counts with no effective-permission
   verdict, and the runner blocked on the count (117 default-deny tables failed).
4. **Offer retry flood.** ~85K/day SQLSTATE 40001 refusals — an out-of-repo
   authenticated automation replaying a stale `_expected_updated_at`; the shipped UI
   contract (`useCatalogOffers.ts`) was already correct (reload, not retry).

## The corrections (do not undo these)

- **Cron default-off contract** (`20271133000001_cron_environment_guard.sql`): all 21
  production-URL http jobs carry guarded commands and are `active=false` everywhere;
  `public.cron_production_allowlist` is the only enable path; production enable is a
  runbook-only step (never a migration) that inserts the provision row into
  `public.cron_environment` and flips allowlisted jobs on:
  `insert into public.cron_environment (name,value) values ('project_ref','<ref>') on conflict (name) do update set value=excluded.value;`
  then `select cron.alter_job(c.jobid, active := true) from public.cron_production_allowlist a join cron.job c on c.jobname=a.jobname;`
  — **not** `alter database … set app.settings.project_ref`: that was the original
  design, but it requires database ownership the operator role lacks, and the
  `cron_environment` table (`20271133000003`, blank-values hardened in `20271133000004`)
  is what production actually runs. Note the intentional materialized-text split:
  production's `cron.job.command` rows embed the 000003-text guard, fresh branches'
  embed the 000001 GUC-text guard (000003/000004 replace functions without
  rescheduling), and both fail closed — the else-branch resolves `cron_edge_url` at
  tick time, so every environment benefits from later hardening. The 7
  local-SQL jobs are untouched. `cron_job_backup` + `cron_restore_backup()` is the
  tested verbatim rollback. **Do not "fix" a preview by re-enabling its jobs; do not
  delete the backup/allowlist tables; do not add cron.schedule migrations with
  hardcoded project URLs — use `public.cron_guarded_edge_command('<fn>')` and add the
  job to the allowlist.**
- **Database-level settings reach preview branches** (verified: production's
  `app.settings.jwt_exp` is present on live branches). Never treat a setting's
  presence as proof of environment identity; only ops-run provisioning outside
  migrations discriminates.
- **Systems Check truth** (`20271133000002_systems_check_verdict_truth.sql`): longest
  active query filters `backend_type='client backend'`; replication slot lag is its
  own signal; RLS verdict blocks on `blocking_exposure_count` (RLS-off ∪ no-policy
  WITH a direct anon/authenticated/public DML grant), no-policy-without-grants is
  informational default-deny.
- **vercel.json `ignoreCommand`**: docs-only (`docs/**`, `*.md/.mdx`, `.zcode/**`)
  changes and empty same-SHA diffs skip; `public/` short-circuits to build.

## Traps that bit during the fix (learn from them)

1. **Vercel ignoreCommand exit polarity is inverted from intuition:** `exit 0` =
  build CANCELED, `exit 1` = build continues. The first draft had it backwards and
  would have silently canceled every application deploy.
2. **`cron.alter_job` takes a bigint job id** — there is no name overload (only
  `cron.schedule`/`cron.unschedule` accept names).
3. **New public tables must be RLS-enabled + force + revoked** per repo convention
  (default privileges grant anon/authenticated broad table rights) — otherwise the
  new RLS audit correctly fails on your own tables.
4. **Migration filenames must stay newer than production's newest recorded version**
  (`deploy-migrations` refuses older files; the chain already sits at future-dated
  `20271132…`). Renumber forward only.
5. **aclexplode returns `grantee = 0` for PUBLIC**, which is not in `pg_roles` —
  left-join and coalesce, or PUBLIC grants are invisible.
6. **Catalog searches need no `LIMIT`** (or a high one): a `limit 20` alphabetical
  truncation once "proved" a function didn't exist when it did.
7. **Deployments duplicated by `vercel redeploy`** are visible as `source:"redeploy"`
  in the Vercel API — check `source` before assuming double Git triggers.
8. **An inline `ignoreCommand` string in vercel.json breaks builds.**
  Vercel's runner evaluates the inline command through JSON-shell escaping that the
  heavy quoting in our script did not survive; the failure exits >1, which Vercel
  reports as build **ERROR**. Three inline attempts errored — one production build
  (`2dbd9040`) and two preview builds (`62a1948`/`dbfcdbd`) — before the fix: keep
  the logic in `scripts/vercel-ignore.sh` and reference it by path
  (`"ignoreCommand": "bash scripts/vercel-ignore.sh"`). Verified green on main at
  `d81b65f`.

## Workload facts (for future CPU attribution)

- Real external HTTP through PostgREST ≈ 3/s; the 700–850/s short-form session-config
  statement + matching rollback count is Supavisor/PostgREST pool transaction-handoff
  churn (hypothesis; escalation draft prepared for Supabase support with counters).
- Sessions do not churn (~852K lifetime); Realtime WAL decode ≈ 1.7/s with healthy
  slot lag; `pg_stat_statements` deltas are the cheap way to attribute rates.

## Remaining follow-ups (owner-tracked)

- Two preview branches created 2026-11-05 evening (`exp10-connect-consent-approve`,
- `platform-operator/integrations-resolver-hotfix`) were under active migration load
  and need the guard applied when quiescent (retry the rollout body).
- Offer-retry caller identity (JWT `sub`) belongs to the Catalog/Commercial owner.
- Drift checks remain honestly skipped pending the CI git reader (`edge-live`/`db-live`).
- Supabase support escalation draft (BUG workspace `ANT-165/supabase-support-escalation.md`).
