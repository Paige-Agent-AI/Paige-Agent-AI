-- ============================================================================
-- Connected MCP Gateway — owner_only visibility + caller-capability mapping (INT-082/INT-089, DB proof).
--
-- Proves migration 20270328000000 (MCP PR-1B-c) at the DB layer:
--
--   (A)  get_mcp_connection_secret returns `visibility` for a configured connection — 'owner_only' for a
--        restricted row, 'tenant' for an ordinary one — AND still returns `endpoint_hash` (INT-078) on the
--        same body, so the 4th CREATE OR REPLACE did not drop the earlier change. (The url exemption,
--        INT-079, is re-proven by mcp_gateway_url_auth_configured.sql running against this same body.)
--
--   (B)  _mcp_caller_capabilities — the ONE server-side mapping — is the role matrix the coordinator
--        asked for:
--          • owner of the tenant           → holds mcp.connections.use_restricted
--          • admin of the tenant           → holds it
--          • ordinary member               → does NOT hold it (fail closed) — and STILL does not when the
--                                             member carries a GLOBAL staff role (the §59 global-role trap:
--                                             the mapping keys on TENANT membership, never user_roles)
--          • NULL actor (missing authority)→ holds NOTHING (INT-089: no silent service-role bypass — the
--                                             mapping drops get_mcp_connections_v2's auth.uid()-IS-NULL
--                                             `_full` branch)
--          • platform owner (super_admin)  → holds it (mirrors get_mcp_connections_v2 `_full`)
--          • owner of a DIFFERENT tenant   → does NOT hold it for THIS tenant (cross-tenant; §9)
--
-- The "a delegated non-owner grant holder is ALLOWED" half of the matrix is proven where enforcement
-- lives — the runner smoke (scripts/mcp-gateway-smoke.mjs) authorizes purely on the CAPABILITY, so a
-- non-owner presenting the capability is allowed with no role check. This file proves the MAPPING that
-- FEEDS it (owner+admin today; a delegated grant is added HERE, in _mcp_caller_capabilities, alone).
--
-- Synthetic fixtures only; self-contained; ROLLS BACK. Runs as the superuser test role (auth.uid() is
-- NULL), so RLS is bypassed for seeding and the DEFINER functions are exercised directly with EXPLICIT
-- actors — exactly how the trusted server caller invokes them (never a request-body identity, §588/§59).
-- Any RAISE = fail (ON_ERROR_STOP); reaching the terminal notice = pass.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/mcp_gateway_owner_only_visibility.sql "$DB_URL"
-- ============================================================================
BEGIN;

-- Actors: owner / admin / member of tenant T, a platform super_admin, and the owner of a DIFFERENT
-- tenant (the cross-tenant control).
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('e9c00000-0000-0000-0000-0000000000d1', 'authenticated', 'authenticated', 'mcpgw-oo-owner@tests.invalid'),
  ('e9c00000-0000-0000-0000-0000000000d2', 'authenticated', 'authenticated', 'mcpgw-oo-admin@tests.invalid'),
  ('e9c00000-0000-0000-0000-0000000000d3', 'authenticated', 'authenticated', 'mcpgw-oo-member@tests.invalid'),
  ('e9c00000-0000-0000-0000-0000000000d4', 'authenticated', 'authenticated', 'mcpgw-oo-super@tests.invalid'),
  ('e9c00000-0000-0000-0000-0000000000d5', 'authenticated', 'authenticated', 'mcpgw-oo-otherowner@tests.invalid');

INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('e9c00000-0000-0000-0000-0000000000da', 'mcpgw-oo-t',     'MCPGW OO T',     'active', 'standalone', 'MOV', '{}'::jsonb),
  ('e9c00000-0000-0000-0000-0000000000db', 'mcpgw-oo-other', 'MCPGW OO Other', 'active', 'standalone', 'MOW', '{}'::jsonb);

-- Seats: owner+admin+member of T; the other-owner owns tenant OTHER (a plain member seat of T would make
-- the cross-tenant control uninteresting, so they hold NO seat in T at all).
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('e9c00000-0000-0000-0000-0000000000da', 'e9c00000-0000-0000-0000-0000000000d1', 'owner',  'active', true,  now()),
  ('e9c00000-0000-0000-0000-0000000000da', 'e9c00000-0000-0000-0000-0000000000d2', 'admin',  'active', false, now()),
  ('e9c00000-0000-0000-0000-0000000000da', 'e9c00000-0000-0000-0000-0000000000d3', 'member', 'active', false, now()),
  ('e9c00000-0000-0000-0000-0000000000db', 'e9c00000-0000-0000-0000-0000000000d5', 'owner',  'active', true,  now());

-- The platform owner (super_admin, a GLOBAL role in user_roles) — the is_platform_owner branch — and a
-- GLOBAL staff role on the ORDINARY MEMBER, to prove the §59 trap: user_roles is tenant-agnostic, so a
-- gate written against a global role would wrongly admit this member. The mapping must NOT.
INSERT INTO public.user_roles (user_id, role) VALUES
  ('e9c00000-0000-0000-0000-0000000000d4', 'super_admin'),
  ('e9c00000-0000-0000-0000-0000000000d3', 'sales_rep')
ON CONFLICT DO NOTHING;

-- Two connections on tenant T: one owner_only, one ordinary (default 'tenant'). auth_kind='none' (a
-- public tokenless MCP server) so get_mcp_connection_secret resolves them configured:true.
INSERT INTO public.mcp_connections (connection_id, tenant_id, provider_key, label, server_url_ct, auth_kind, visibility) VALUES
  ('e9c00000-0000-0000-0000-0000000000e1', 'e9c00000-0000-0000-0000-0000000000da', 'generic-remote', 'oo-restricted',
     public.platform_encrypt('https://mcp-oo-a.example/rpc'), 'none', 'owner_only'),
  ('e9c00000-0000-0000-0000-0000000000e2', 'e9c00000-0000-0000-0000-0000000000da', 'generic-remote', 'oo-open',
     public.platform_encrypt('https://mcp-oo-b.example/rpc'), 'none', 'tenant');

-- ── (A) get_mcp_connection_secret returns visibility AND still returns endpoint_hash ───────────
DO $$
DECLARE _oo jsonb; _open jsonb;
BEGIN
  _oo   := public.get_mcp_connection_secret('e9c00000-0000-0000-0000-0000000000e1');
  _open := public.get_mcp_connection_secret('e9c00000-0000-0000-0000-0000000000e2');
  IF (_oo->>'configured') IS DISTINCT FROM 'true' OR (_oo->>'enabled') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '(A) the owner_only connection should be configured+enabled: %', _oo;
  END IF;
  IF (_oo->>'visibility') IS DISTINCT FROM 'owner_only' THEN
    RAISE EXCEPTION '(A) get_mcp_connection_secret must return visibility=owner_only for a restricted row: %', _oo;
  END IF;
  IF (_open->>'visibility') IS DISTINCT FROM 'tenant' THEN
    RAISE EXCEPTION '(A) get_mcp_connection_secret must return visibility=tenant for an ordinary row: %', _open;
  END IF;
  -- The 4th CREATE OR REPLACE must NOT have dropped INT-078's endpoint_hash (proven load-bearing here:
  -- reverting this migration to omit it would fail THIS assertion, independent of the load-binding pgTAP).
  IF (_oo->>'endpoint_hash') IS DISTINCT FROM public._mcp_endpoint_hash('https://mcp-oo-a.example/rpc') THEN
    RAISE EXCEPTION '(A) get_mcp_connection_secret must STILL return endpoint_hash (INT-078 survived the replace): %', _oo;
  END IF;
END $$;

-- ── (B) _mcp_caller_capabilities role matrix ──────────────────────────────────────────────────
DO $$
DECLARE
  _T   uuid := 'e9c00000-0000-0000-0000-0000000000da';
  _OTH uuid := 'e9c00000-0000-0000-0000-0000000000db';
  -- INT-099/G1a-1: the mapping grants `mcp.connections.manage` (appended SECOND) and
  -- `mcp.connections.delete` (appended THIRD) to owner/tenant-admin, so exact-equality arrays are
  -- [use_restricted, manage, delete]. A platform owner is EXCLUDED from BOTH manage and delete (A2) —
  -- they hold use_restricted ONLY. Assertions stay EXACT equality against the full set.
  _FULL       text[] := ARRAY['mcp.connections.use_restricted','mcp.connections.manage','mcp.connections.delete'];
  _USE_ONLY   text[] := ARRAY['mcp.connections.use_restricted'];
  _EMPTY      text[] := ARRAY[]::text[];
BEGIN
  -- owner → holds use_restricted + manage + delete
  IF public._mcp_caller_capabilities(_T, 'e9c00000-0000-0000-0000-0000000000d1') IS DISTINCT FROM _FULL THEN
    RAISE EXCEPTION '(B) owner of the tenant must hold use_restricted + manage + delete: %',
      public._mcp_caller_capabilities(_T, 'e9c00000-0000-0000-0000-0000000000d1');
  END IF;
  -- admin → holds use_restricted + manage + delete
  IF public._mcp_caller_capabilities(_T, 'e9c00000-0000-0000-0000-0000000000d2') IS DISTINCT FROM _FULL THEN
    RAISE EXCEPTION '(B) admin of the tenant must hold use_restricted + manage + delete: %',
      public._mcp_caller_capabilities(_T, 'e9c00000-0000-0000-0000-0000000000d2');
  END IF;
  -- ordinary member → holds NOTHING, EVEN THOUGH they carry a GLOBAL 'coach' staff role (§59 trap:
  -- the mapping keys on TENANT membership via is_tenant_admin_as, never on the tenant-agnostic user_roles).
  IF public._mcp_caller_capabilities(_T, 'e9c00000-0000-0000-0000-0000000000d3') IS DISTINCT FROM _EMPTY THEN
    RAISE EXCEPTION '(B) an ordinary member (even with a global staff role) must hold NOTHING: %',
      public._mcp_caller_capabilities(_T, 'e9c00000-0000-0000-0000-0000000000d3');
  END IF;
  -- NULL actor → holds NOTHING (missing authority; INT-089: no silent service-role bypass)
  IF public._mcp_caller_capabilities(_T, NULL) IS DISTINCT FROM _EMPTY THEN
    RAISE EXCEPTION '(B) a NULL actor must hold NOTHING (no service-role bypass): %',
      public._mcp_caller_capabilities(_T, NULL);
  END IF;
  -- platform owner (super_admin) → holds use_restricted ONLY, NEVER manage OR delete (INT-099/G1a-1/A2:
  -- platform authority is not tenant-management authority; manage AND the destructive delete are
  -- owner/tenant-admin of THIS tenant only).
  IF public._mcp_caller_capabilities(_T, 'e9c00000-0000-0000-0000-0000000000d4') IS DISTINCT FROM _USE_ONLY THEN
    RAISE EXCEPTION '(B) a platform owner must hold use_restricted ONLY (never manage/delete): %',
      public._mcp_caller_capabilities(_T, 'e9c00000-0000-0000-0000-0000000000d4');
  END IF;
  -- explicit belt-and-suspenders (G1a-1): a platform owner must NOT hold the destructive delete key.
  IF 'mcp.connections.delete' = ANY(public._mcp_caller_capabilities(_T, 'e9c00000-0000-0000-0000-0000000000d4')) THEN
    RAISE EXCEPTION '(B) a platform owner must NOT hold mcp.connections.delete (A2 — destructive tenant action is not a platform power)';
  END IF;
  -- owner of a DIFFERENT tenant, acting on T → holds NOTHING for T (cross-tenant; §9)
  IF public._mcp_caller_capabilities(_T, 'e9c00000-0000-0000-0000-0000000000d5') IS DISTINCT FROM _EMPTY THEN
    RAISE EXCEPTION '(B) the owner of another tenant must hold NOTHING for THIS tenant: %',
      public._mcp_caller_capabilities(_T, 'e9c00000-0000-0000-0000-0000000000d5');
  END IF;
  -- ...and that same actor DOES hold use_restricted + manage + delete for THEIR OWN tenant (mapping not broken).
  IF public._mcp_caller_capabilities(_OTH, 'e9c00000-0000-0000-0000-0000000000d5') IS DISTINCT FROM _FULL THEN
    RAISE EXCEPTION '(B) the owner of tenant OTHER must hold use_restricted + manage + delete for tenant OTHER: %',
      public._mcp_caller_capabilities(_OTH, 'e9c00000-0000-0000-0000-0000000000d5');
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'MCP_GW_OWNER_ONLY_VISIBILITY_PROVEN'; END $$;

ROLLBACK;
