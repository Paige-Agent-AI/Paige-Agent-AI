-- Systems Check runner read grants: the complete `.from()` set is service_role-readable, and
-- the §9 boundary tables stay customer-facing-closed.
-- Synthetic; always rolled back.
--
-- WHY THIS FILE EXISTS. 20260816160000 fixed this exact class once (three runner read targets
-- with no service_role grant, found by a live drive) and its comment declared the grant set
-- COMPLETE for every table the runner modules `.from()`. PR7 (#2707) then added two new read
-- targets — public.mcp_connections and public.tenant_n8n_connections — without extending the
-- grants, and every scheduled tenant sweep since has filed `connections_healthy` as an error
-- (production evidence: 2026-10-26 09:00 UTC fleet sweep, every tenant, an empty-message
-- PostgREST refusal). This test pins BOTH directions so the class cannot recur silently:
--
--   (A) every table the runner modules read today carries service_role SELECT — derived by
--       enumerating `admin.from("` across supabase/functions/_shared/systems-check-runners/
--       (tenant + operator subdirectory). A future runner that reads a NEW table without its
--       grant fails HERE at CI time, not in the fleet.
--   (B) authenticated has NO table-level SELECT on the two §9 boundary stores — the grant that
--       fixes the monitor must not quietly open the customer-facing surface. Tenant- and
--       owner-facing reads of these stores flow through the SECURITY DEFINER doors
--       (list_integration_surface, the gateway actions), never a direct table grant.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/systems_check_runner_read_grants.sql "$DB_URL"
-- (Lives in the REBUILT-database workflow — paige-spine-contract — beside
--  integrations_surface_sees_mcp.sql: it asserts real roles/tables/ACLs, which the
--  fixture-transaction databases of the comms job do not hold at step time.)

\set ON_ERROR_STOP on

BEGIN;

-- ── (A) the complete enumerated runner read-set is service_role-readable ──────────────────
-- Maintained list: regenerate with
--   grep -rhoE 'from\("[a-z0-9_]+"' supabase/functions/_shared/systems-check-runners/ | sort -u
-- and keep this array EXACTLY equal to it (the maintenance rule 20260816160000 set: the grant
-- set covers every `.from()` target; this test is that rule made executable). The character
-- class must include 0-9 — tenant_n8n_connections and tenant_a2p_registrations carry digits
-- and a digits-less recipe silently drops them (review P3/P2 of 5c6a8a0ab).
DO $$ DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients',
    'deals',
    'growth_pages',
    'mcp_connections',
    'paige_llm_trace',
    'paige_owner_memory',
    'pipelines',
    'pipeline_stages',
    'security_canary_runs',
    'signup_intake',
    'stripe_event_log',
    'tenant_a2p_registrations',
    'tenant_email_identities',
    'tenant_mcp_connections',
    'tenant_n8n_connections',
    'tenant_phone_numbers',
    'tenant_twilio_subaccounts',
    'tenant_workflows',
    'tenants',
    'user_roles',
    'webhook_event_log'
  ] LOOP
    IF NOT has_table_privilege('service_role', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION '(A) service_role lacks SELECT on public.% — a Systems Check runner reads this table; add the grant (see 20260816160000 and 20271115100000) or stop reading it', t;
    END IF;
  END LOOP;
END $$;

-- ── (B) the §9 boundary stores stay closed to the customer-facing role ────────────────────
-- The two tables the 20271115100000 grant touches are deliberately NOT customer-readable at
-- the table level: everything authenticated can see of them arrives through the SECURITY
-- DEFINER doors. If a future change grants authenticated SELECT here directly, that is a §9
-- boundary change and must be its own reviewed decision — not a side effect of a monitor fix.
DO $$ BEGIN
  IF has_table_privilege('authenticated', 'public.mcp_connections', 'SELECT') THEN
    RAISE EXCEPTION '(B) authenticated must not hold direct SELECT on public.mcp_connections (§9 boundary)';
  END IF;
  IF has_table_privilege('authenticated', 'public.tenant_n8n_connections', 'SELECT') THEN
    RAISE EXCEPTION '(B) authenticated must not hold direct SELECT on public.tenant_n8n_connections (§9 boundary)';
  END IF;
END $$;

-- ── (C) the writer tables the runner core needs stay writable (regression guard) ──────────
DO $$ BEGIN
  IF NOT has_table_privilege('service_role', 'public.paige_systems_check_registry', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.paige_systems_check_run', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.paige_systems_check_finding', 'INSERT') THEN
    RAISE EXCEPTION '(C) the systems-check writer tables lost a service_role privilege (20260816160000 regression)';
  END IF;
END $$;

ROLLBACK;
