-- list_integration_surface: Paige can SEE her MCP connections, and the list does not lie.
-- Synthetic fixtures; always rolled back.
--
-- WHY THIS FILE EXISTS. Before 20270410214500, list_integration_surface read only
-- public.channel_connectors, so every MCP connection a tenant owned was invisible to Paige —
-- absent, not stale. Asked "am I connected to Zapier?" she had nothing to answer from.
--
-- The dangerous half of the fix is the one these assertions target. The gateway registry
-- (public.mcp_connections) was filled by a ONE-TIME backfill with no trigger keeping it current,
-- while the legacy writers remain the live write path. So reading the gateway ALONE would hand
-- Paige a list with a hole in it — and a hole in a list is indistinguishable from an absence, which
-- turns honest silence into a confident false "no, you aren't connected." (C) is that invariant.
--
-- (D) is the §9 crown jewel: list_integration_surface is SECURITY DEFINER and so bypasses RLS on a
-- table whose only policy is is_platform_owner(). The owner_only visibility gate therefore has to
-- survive being reached through a nested definer call. It does, because SECURITY DEFINER changes
-- the executing privilege and NOT auth.uid() — but that is the kind of claim that must be proven
-- rather than reasoned about, so it is proven here, from both sides.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/integrations_surface_sees_mcp.sql "$DB_URL"

BEGIN;

-- ── Grant surface (§59 — the grant is never the guard, but it is still the outer boundary) ──
DO $$ BEGIN
  IF has_function_privilege('anon', 'public.list_integration_surface()', 'EXECUTE') THEN
    RAISE EXCEPTION '(0) anon must not reach list_integration_surface';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.list_integration_surface()', 'EXECUTE') THEN
    RAISE EXCEPTION '(0) authenticated must reach list_integration_surface';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.list_integration_surface()', 'EXECUTE') THEN
    RAISE EXCEPTION '(0) service_role must reach list_integration_surface';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.list_integration_surface()'::regprocedure) THEN
    RAISE EXCEPTION '(0) list_integration_surface must be SECURITY DEFINER';
  END IF;
END $$;

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('f1a00000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', 'isurf-admin@tests.invalid'),
  ('f1a00000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', 'isurf-member@tests.invalid');

INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('f1a00000-0000-0000-0000-0000000000b1', 'isurf-t', 'ISURF T', 'active', 'standalone', 'ISF', '{}'::jsonb);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('f1a00000-0000-0000-0000-0000000000b1', 'f1a00000-0000-0000-0000-0000000000a1', 'admin',  'active', true,  now()),
  ('f1a00000-0000-0000-0000-0000000000b1', 'f1a00000-0000-0000-0000-0000000000a2', 'member', 'active', false, now());

-- The pre-existing capability this change must NOT disturb (§58).
INSERT INTO public.channel_connectors (tenant_id, channel_type, provider, status, active, display_name, from_address, inbound_domain, inbound_address, updated_at)
VALUES ('f1a00000-0000-0000-0000-0000000000b1', 'email', 'resend', 'active', true, 'ISURF Resend', 'hi@isurf.test', 'isurf.test', 'in@isurf.test', now());

-- GATEWAY registry: one ordinary connection, one owner_only.
-- The zapier row is the one-time backfill's PROJECTION (legacy_source set) and is
-- deliberately STALE — it still says enabled/connected/healthy. The live legacy row
-- below says the owner disconnected it. 'Restricted' is NATIVE (legacy_source NULL),
-- so the gateway is its live store and it must survive.
-- EXP10 PR4: 'Restricted' carries last_checked_at=now() so it remains the FRESH-healthy
-- proof under the staleness derivation (a NULL probe age derives degraded+stale by design).
INSERT INTO public.mcp_connections (connection_id, tenant_id, provider_key, label, server_url_ct, auth_kind, visibility, enabled, status, health, legacy_source, legacy_provider, last_checked_at) VALUES
  ('f1a00000-0000-0000-0000-0000000000c1', 'f1a00000-0000-0000-0000-0000000000b1', 'zapier', 'Zapier (STALE projection)',
     public.platform_encrypt('https://mcp.zapier.example/rpc'), 'none', 'tenant',     true, 'connected', 'healthy',
     'tenant_mcp_connections', 'zapier', now()),
  ('f1a00000-0000-0000-0000-0000000000c2', 'f1a00000-0000-0000-0000-0000000000b1', 'generic-remote', 'Restricted',
     public.platform_encrypt('https://restricted.example/rpc'), 'none', 'owner_only', true, 'connected', 'healthy',
     NULL, NULL, now());

-- LEGACY registry: the SAME zapier — listed exactly ONCE, and the LIVE row is the one that must
-- win, NOT the projection above it. Precedence keys on lineage, never on the provider name: the
-- projection carries legacy_source='tenant_mcp_connections' and is therefore excluded from the
-- gateway half, while this row answers in its place. (An earlier draft had the gateway win on a
-- matching provider string, which let the frozen snapshot outrank the live record it was copied
-- FROM — assertion B below is what fails if that ever comes back.) Plus an n8n the backfill never
-- projected (must still appear — this is the anti-lie case).
INSERT INTO public.tenant_mcp_connections (tenant_id, provider, label, server_url_ct, auth_token_ct, auth_token_last4, transport, auth_kind, enabled, status, last_probed_at) VALUES
  -- auth_kind MUST be 'oauth' (or 'url') for zapier — tenant_mcp_connections_provider_auth_chk
  -- (20261201000000:12). A first draft used 'bearer' here, which the schema forbids, and CI is
  -- where that surfaced; the fixture now models a shape the platform can actually hold.
  -- LIVE: the owner disconnected this yesterday (enabled=false). The stale projection
  -- above still claims healthy. If the projection wins, Paige reports a dead connection
  -- as live — the defect this file's (B) assertion now pins.
  ('f1a00000-0000-0000-0000-0000000000b1', 'zapier', 'Zapier (LIVE)',
     public.platform_encrypt('https://live.zapier.example/rpc'), public.platform_encrypt('tok-zapier-legacy'), 'gacy', 'http', 'oauth', false, 'connected', now()),
  -- EXP10 PR4: probe 12 days old ON PURPOSE — under the staleness derivation a connected
  -- legacy row whose last probe predates 7 days derives degraded+stale, and this row is
  -- the LEGACY half's proof of exactly that (assertion F3, asserted inside C).
  ('f1a00000-0000-0000-0000-0000000000b1', 'n8n', 'My n8n',
     public.platform_encrypt('https://n8n.isurf.test/mcp'),     public.platform_encrypt('tok-n8n-unprojected'), 'cted', 'http', 'bearer', true, 'connected', now() - interval '12 days');

-- The n8n API-KEY facet lives in its OWN table with its OWN projection lineage
-- ('tenant_n8n_connections'). A first version of the migration suppressed that projection while
-- reading back only tenant_mcp_connections, so this live connection became INVISIBLE — the very
-- defect the migration exists to fix, one table over. The projection below is stale on purpose.
INSERT INTO public.tenant_n8n_connections (tenant_id, label, base_url_ct, api_key_ct, api_key_last4, status, last_sync_at, workflow_count)
VALUES ('f1a00000-0000-0000-0000-0000000000b1', 'My n8n API',
        public.platform_encrypt('https://n8n.live.isurf.test/api/v1/secret-path'),
        public.platform_encrypt('tok-n8n-api-key'), '9zQ4', 'connected', now(), 7);

INSERT INTO public.mcp_connections (connection_id, tenant_id, provider_key, label, server_url_ct, auth_kind, visibility, enabled, status, health, legacy_source, legacy_provider) VALUES
  ('f1a00000-0000-0000-0000-0000000000c3', 'f1a00000-0000-0000-0000-0000000000b1', 'n8n', 'n8n (API) [STALE projection]',
     public.platform_encrypt('https://stale.n8n.example/api'), 'api_key', 'tenant', true, 'connected', 'healthy',
     'tenant_n8n_connections', NULL);

-- EXP10 PR4 fixtures: the gateway half's staleness + closed-error-code proofs.
-- 'Stale Checked' claims connected/healthy with a 12-day-old probe — the derivation must
-- downgrade it to degraded WITH stale=true (distinguishable from a hard error).
-- 'Failed Refused' carries the gateway's CLOSED refusal vocabulary on its row — the code
-- must cross to the projection (so "why isn't it working" answers from real evidence),
-- and it must NOT be flagged stale (its check is fresh; its problem is the refusal).
INSERT INTO public.mcp_connections (connection_id, tenant_id, provider_key, label, server_url_ct, auth_kind, visibility, enabled, status, health, legacy_source, legacy_provider, last_checked_at, last_error_code) VALUES
  ('f1a00000-0000-0000-0000-0000000000c4', 'f1a00000-0000-0000-0000-0000000000b1', 'generic-remote', 'Stale Checked',
     public.platform_encrypt('https://stale-checked.example/mcp'), 'none', 'tenant', true, 'connected', 'healthy',
     NULL, NULL, now() - interval '12 days', NULL),
  ('f1a00000-0000-0000-0000-0000000000c5', 'f1a00000-0000-0000-0000-0000000000b1', 'generic-remote', 'Failed Refused',
     public.platform_encrypt('https://failed-refused.example/mcp'), 'none', 'tenant', true, 'error', 'needs_attention',
     NULL, NULL, now(), 'provider_reflected_credential');

SET LOCAL ROLE authenticated;

-- ── (A) the channel half is untouched, and (B) the gateway connection is now visible ───────────
SELECT set_config('request.jwt.claims', '{"sub":"f1a00000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
DO $$
DECLARE _v jsonb; _e jsonb;
BEGIN
  _v := public.list_integration_surface();

  -- Identify THIS fixture's row by its label, never by channel alone. Creating a tenant
  -- auto-provisions its own sending identity, so `channel='email'` matches more than one row
  -- and a bare SELECT..INTO silently takes an arbitrary one. A first draft did exactly that,
  -- picked the platform's connector, and reported a §58 regression that had not happened —
  -- an assertion failing for a reason unrelated to what it guards is worse than no assertion.
  SELECT e INTO _e FROM jsonb_array_elements(_v) e
   WHERE e->>'channel' = 'email' AND e->>'display_name' = 'ISURF Resend';
  IF _e IS NULL THEN
    RAISE EXCEPTION '(A) §58 REGRESSION: the channel_connectors half no longer returns this row: %', _v;
  END IF;
  IF _e->>'from_address' IS DISTINCT FROM 'hi@isurf.test'
     OR _e->>'inbound_address' IS DISTINCT FROM 'in@isurf.test'
     OR _e->>'provider' IS DISTINCT FROM 'resend' THEN
    RAISE EXCEPTION '(A) §58 REGRESSION: channel fields dropped: %', _e;
  END IF;

  -- (B) EACH CONNECTION IS READ FROM ITS LIVE STORE. The gateway row for zapier is a
  -- backfill PROJECTION and is frozen; the legacy row is the one connect/rotate/
  -- disconnect/probe still write. So the LIVE row must win, and the projection must not
  -- be able to mask it. Listed exactly once, keyed on lineage rather than provider name.
  SELECT e INTO _e FROM jsonb_array_elements(_v) e WHERE e->>'provider' = 'zapier';
  IF _e IS NULL THEN RAISE EXCEPTION '(B) the zapier connection is invisible to Paige: %', _v; END IF;
  IF _e->>'channel' IS DISTINCT FROM 'mcp' THEN RAISE EXCEPTION '(B) channel=%', _e->>'channel'; END IF;
  IF _e->>'display_name' IS DISTINCT FROM 'Zapier (LIVE)' THEN
    RAISE EXCEPTION '(B) THE STALE PROJECTION WON. Paige would report a connection the owner disconnected as still live. got: %', _e->>'display_name';
  END IF;
  IF _e->>'health' IS DISTINCT FROM 'disconnected' OR _e->>'status' IS DISTINCT FROM 'disabled' THEN
    RAISE EXCEPTION '(B) the live disconnect was masked by the frozen projection: health=%, status=%', _e->>'health', _e->>'status';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(_v) e WHERE e->>'provider' = 'zapier') <> 1 THEN
    RAISE EXCEPTION '(B) zapier listed twice — the projection was not suppressed: %', _v;
  END IF;
  -- ...and a NATIVE gateway connection (legacy_source NULL) is still read from the gateway.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_v) e WHERE e->>'display_name' = 'Restricted') THEN
    RAISE EXCEPTION '(B) a NATIVE gateway connection vanished with the projections: %', _v;
  END IF;
END $$;

-- ── (C) THE ANTI-LIE INVARIANT: a legacy connection the one-time backfill never projected ──────
DO $$
DECLARE _e jsonb;
BEGIN
  -- Identified by LABEL: two connections legitimately carry provider 'n8n' here — the OAuth facet
  -- (tenant_mcp_connections) and the API-key facet (tenant_n8n_connections). Selecting on provider
  -- alone would take an arbitrary one, which is how an earlier assertion in this file failed for a
  -- reason unrelated to what it guards.
  SELECT e INTO _e FROM jsonb_array_elements(public.list_integration_surface()) e
   WHERE e->>'provider' = 'n8n' AND e->>'display_name' = 'My n8n';
  IF _e IS NULL THEN
    RAISE EXCEPTION '(C) a LIVE legacy MCP connection is invisible. Paige would answer "you are not connected" about a connection that works — the exact failure 20270410214500 exists to prevent.';
  END IF;
  -- EXP10 PR4: this fixture's probe is 12 days old, so under the staleness derivation the
  -- honest health is degraded WITH stale=true (the legacy half's proof — F3). The old
  -- 'healthy' assertion pinned the pre-derivation behavior this PR deliberately replaces.
  IF _e->>'health' IS DISTINCT FROM 'degraded' THEN RAISE EXCEPTION '(C) health=%', _e->>'health'; END IF;
  IF (_e->>'stale')::boolean IS NOT TRUE THEN RAISE EXCEPTION '(C) stale flag missing on the 12-day-old legacy probe: %', _e; END IF;

  -- (C2) THE SAME INVARIANT FOR THE OTHER LEGACY STORE. Its projection is stale; the live row wins.
  SELECT e INTO _e FROM jsonb_array_elements(public.list_integration_surface()) e
   WHERE e->>'display_name' = 'My n8n API';
  IF _e IS NULL THEN
    RAISE EXCEPTION '(C2) the LIVE n8n API connection is invisible — the original defect re-created for tenant_n8n_connections.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(public.list_integration_surface()) e
              WHERE e->>'display_name' = 'n8n (API) [STALE projection]') THEN
    RAISE EXCEPTION '(C2) the stale n8n API projection was emitted alongside its live row.';
  END IF;
  IF _e->>'server_host' IS DISTINCT FROM 'n8n.live.isurf.test' THEN
    RAISE EXCEPTION '(C2) host-only projection broken: %', _e->>'server_host';
  END IF;
END $$;

-- ── (F) EXP10 PR4: staleness derives degraded+stale, and the closed error code crosses ─────────
DO $$
DECLARE _e jsonb;
BEGIN
  -- (F1) FRESH + HEALTHY stays healthy with stale=false and no error code.
  SELECT e INTO _e FROM jsonb_array_elements(public.list_integration_surface()) e
   WHERE e->>'display_name' = 'Restricted';
  IF _e->>'health' IS DISTINCT FROM 'healthy' THEN RAISE EXCEPTION '(F1) a freshly-checked healthy row degraded: %', _e; END IF;
  IF (_e->>'stale')::boolean IS NOT FALSE THEN RAISE EXCEPTION '(F1) fresh row flagged stale: %', _e; END IF;
  IF _e->>'last_error_code' IS NOT NULL THEN RAISE EXCEPTION '(F1) error code invented for a healthy row: %', _e; END IF;

  -- (F2) HEALTHY-CLAIMED but 12-day-old probe derives degraded + stale=true (gateway half).
  SELECT e INTO _e FROM jsonb_array_elements(public.list_integration_surface()) e
   WHERE e->>'display_name' = 'Stale Checked';
  IF _e->>'health' IS DISTINCT FROM 'degraded' THEN RAISE EXCEPTION '(F2) stale row still reads healthy: %', _e; END IF;
  IF (_e->>'stale')::boolean IS NOT TRUE THEN RAISE EXCEPTION '(F2) stale flag missing: %', _e; END IF;

  -- (F3) is asserted in (C) above on the LEGACY half's 12-day-old row ('My n8n').

  -- (F4) A REFUSED row carries its CLOSED error code and is NOT flagged stale (fresh check).
  SELECT e INTO _e FROM jsonb_array_elements(public.list_integration_surface()) e
   WHERE e->>'display_name' = 'Failed Refused';
  IF _e->>'health' IS DISTINCT FROM 'degraded' THEN RAISE EXCEPTION '(F4) refused row health=%', _e->>'health'; END IF;
  IF _e->>'last_error_code' IS DISTINCT FROM 'provider_reflected_credential' THEN
    RAISE EXCEPTION '(F4) the closed refusal code did not cross to the projection: %', _e;
  END IF;
  IF (_e->>'stale')::boolean IS NOT FALSE THEN RAISE EXCEPTION '(F4) a freshly-checked refused row flagged stale: %', _e; END IF;

  -- (F5) the n8n API facet derives the same way from its own last_sync_at (fresh here).
  SELECT e INTO _e FROM jsonb_array_elements(public.list_integration_surface()) e
   WHERE e->>'display_name' = 'My n8n API';
  IF _e->>'health' IS DISTINCT FROM 'healthy' THEN RAISE EXCEPTION '(F5) n8n API health=%', _e->>'health'; END IF;
  IF (_e->>'stale')::boolean IS NOT FALSE THEN RAISE EXCEPTION '(F5) fresh n8n API row flagged stale: %', _e; END IF;
END $$;

-- ── (G) EXP10 PR4 review hardening: last_error_code's closedness is SCHEMA-enforced ───────────
-- Runs as the JOB role (RESET ROLE): (G) reads and writes public.mcp_connections DIRECTLY,
-- and no authenticated caller — not even a tenant admin — holds a table grant on it (the
-- §9 boundary this very suite proves in (D)/(E)). The claim set persists across the role
-- reset, so (D) below re-establishes only the ROLE it needs.
RESET ROLE;
-- (G) body: last_error_code's closedness is SCHEMA-enforced ───────────
-- The projection carries the code to a model-facing surface; the boundary that makes that safe
-- is the table's own constraint, so the constraint itself is what this proves — from both sides.
DO $$
BEGIN
  -- (G1) a bounded closed code writes fine (this fixture row already carries one).
  IF NOT EXISTS (SELECT 1 FROM public.mcp_connections WHERE label = 'Failed Refused'
                  AND last_error_code = 'provider_reflected_credential') THEN
    RAISE EXCEPTION '(G1) the closed-code fixture row is missing';
  END IF;
  -- (G2) provider PROSE is refused at the write — the constraint, not a writer's goodwill,
  -- keeps unbounded provider text out of a model-facing field.
  BEGIN
    INSERT INTO public.mcp_connections (connection_id, tenant_id, provider_key, label, server_url_ct, auth_kind, visibility, enabled, status, health, last_error_code)
    VALUES ('f1a00000-0000-0000-0000-0000000000c6', 'f1a00000-0000-0000-0000-0000000000b1', 'generic-remote', 'Prose Refused',
            public.platform_encrypt('https://prose.example/mcp'), 'none', 'tenant', true, 'error', 'needs_attention',
            'Provider said: quota exceeded for account 12345, contact support');
    RAISE EXCEPTION '(G2) REGRESSION: provider prose was accepted into last_error_code';
  EXCEPTION WHEN check_violation THEN
    NULL; -- the constraint refused it — exactly the proof
  END;
END $$;

SET LOCAL ROLE authenticated;

-- ── (D) §9: owner_only is hidden from an ordinary member and shown to an admin ─────────────────
DO $$
DECLARE _n int;
BEGIN
  -- admin (claims already set above)
  SELECT count(*) INTO _n FROM jsonb_array_elements(public.list_integration_surface()) e
   WHERE e->>'display_name' = 'Restricted';
  IF _n <> 1 THEN RAISE EXCEPTION '(D) a tenant ADMIN must see the owner_only connection (saw %)', _n; END IF;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"f1a00000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
DO $$
DECLARE _v jsonb; _n int;
BEGIN
  _v := public.list_integration_surface();
  SELECT count(*) INTO _n FROM jsonb_array_elements(_v) e WHERE e->>'display_name' = 'Restricted';
  IF _n <> 0 THEN
    RAISE EXCEPTION '(D) §9 LEAK: an ordinary member saw an owner_only connection through the nested SECURITY DEFINER call: %', _v;
  END IF;
  -- ...while still seeing the ordinary ones, so the gate is a gate and not a blackout.
  IF (SELECT count(*) FROM jsonb_array_elements(_v) e WHERE e->>'provider' = 'zapier') <> 1 THEN
    RAISE EXCEPTION '(D) the member lost the ordinary connection too — that is a blackout, not a visibility gate: %', _v;
  END IF;

  -- ── (E) nothing credential-bearing ever crosses ──
  IF _v::text ~* 'auth_token|refresh_token|last4|_ct"|tok-|9zQ4|secret-path|/api/v1' THEN
    RAISE EXCEPTION '(E) credential material reached the caller: %', _v;
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'INTEGRATIONS_SURFACE_SEES_MCP_PROVEN'; END $$;

ROLLBACK;
