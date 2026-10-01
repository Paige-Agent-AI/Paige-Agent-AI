-- ============================================================================
-- The OAuth flow must refuse an API-key connection (migration 20270423081500).
--
-- THE DEFECT THIS PINS. `set_mcp_rest_connection_endpoint` has always refused a connection whose
-- auth_kind is not 'api_key' (20270331000000:788-790), so an MCP connection cannot be converted
-- into a REST one. The opposite direction had no guard at all: `complete_mcp_oauth_grant` set
-- auth_kind='oauth' and overwrote auth_token_ct unconditionally, and `begin_mcp_oauth` checked
-- only tenancy. A tenant admin could therefore run the gateway's OAuth flow against their own
-- n8n API-key connection and have the callback overwrite the pasted key with a provider token.
-- `auth_token_ct` is write-only, so that key is unrecoverable and must be reissued at n8n.
--
-- WHAT IS ASSERTED, and why each one is here rather than assumed:
--   1. begin_mcp_oauth REFUSES an api_key row          — the flow never starts, so nobody is sent
--                                                        to a provider only to be refused on return.
--   2. complete_mcp_oauth_grant REFUSES an api_key row — the backstop. It is service_role and
--                                                        JWT-less, and a row's facet could change
--                                                        while a flow is already in the air.
--   3. The api_key row's credential SURVIVES the refusal — the actual harm is the overwrite, so
--                                                        proving the refusal without proving the
--                                                        key is still there proves the wrong half.
--   4. BOTH still accept a 'none' shell               — the guard must narrow exactly one facet.
--                                                        Without this, a guard that refused
--                                                        everything would pass 1-3.
--   5. The TENANT refusal still fires FIRST on a foreign api_key row — ordering matters: if the
--                                                        facet check ran first it would answer a
--                                                        question about a connection in another
--                                                        tenant, which is an existence oracle.
--
-- Any failed assertion RAISEs, so under `psql -v ON_ERROR_STOP=1` the exit code alone reports
-- pass(0)/fail(non-zero) (§13/§32). BEGIN..ROLLBACK: nothing persists.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/mcp_oauth_refuses_the_rest_facet.sql "$DB_URL"
-- ============================================================================
BEGIN;
\ir helpers/mcp_oauth_binding.sql

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('fa0e0000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'facet-admin@tests.invalid'),
  ('fa0e0000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'facet-other@tests.invalid');

INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('fa0e0000-0000-0000-0000-0000000000a1', 'facet-t',  'FACET T',  'active', 'standalone', 'FCA', '{}'::jsonb),
  ('fa0e0000-0000-0000-0000-0000000000a2', 'facet-t2', 'FACET T2', 'active', 'standalone', 'FCB', '{}'::jsonb);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('fa0e0000-0000-0000-0000-0000000000a1', 'fa0e0000-0000-0000-0000-000000000001', 'admin', 'active', false, now()),
  ('fa0e0000-0000-0000-0000-0000000000a2', 'fa0e0000-0000-0000-0000-000000000002', 'admin', 'active', false, now());

DO $$
DECLARE
  _rest uuid; _shell uuid; _foreign uuid; _msg text; _kind text; _tok_before text; _tok_after text;
  T  uuid := 'fa0e0000-0000-0000-0000-0000000000a1';
  T2 uuid := 'fa0e0000-0000-0000-0000-0000000000a2';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"fa0e0000-0000-0000-0000-000000000001","role":"authenticated"}', true);

  -- The REST facet, created through the real writer exactly as the n8n API-key path leaves it.
  _rest := (public.create_mcp_rest_connection('n8n','facet-rest','https://facet.example.com','rest-api-key-123456')->>'connection_id')::uuid;
  SELECT auth_kind INTO _kind FROM public.mcp_connections WHERE connection_id = _rest;
  IF _kind <> 'api_key' THEN RAISE EXCEPTION '(facet) fixture is not an api_key row, got %', _kind; END IF;
  SELECT auth_token_ct::text INTO _tok_before FROM public.mcp_connections WHERE connection_id = _rest;
  IF _tok_before IS NULL THEN RAISE EXCEPTION '(facet) fixture holds no credential, so the overwrite cannot be observed'; END IF;

  -- An OAuth-eligible shell in the same tenant — the control.
  _shell := (public.create_mcp_connection('generic-remote','facet-shell','https://facet-shell.example.com/rpc','none')->>'connection_id')::uuid;

  -- ── 1. begin_mcp_oauth refuses the REST facet ────────────────────────────────────────────────
  BEGIN
    PERFORM public.begin_mcp_oauth(_rest, T, 'state-facet-1', 'verifier-facet-1',
      'https://cb.example.com/cb', 'https://iss.example.com', NULL, 'client-123', NULL, NULL);
    RAISE EXCEPTION '(facet) begin_mcp_oauth ACCEPTED an api_key connection';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
    IF _msg NOT LIKE 'MCP_NOT_AN_MCP_CONNECTION%' THEN
      RAISE EXCEPTION '(facet) begin refused for the wrong reason: %', _msg;
    END IF;
  END;

  -- ── 2. complete_mcp_oauth_grant refuses it too (the backstop) ────────────────────────────────
  BEGIN
    PERFORM public.complete_mcp_oauth_grant(_rest, T, 'tok-facet-123456', NULL,
      'https://iss.example.com', 'client-123', NULL, NULL, NULL, NULL);
    RAISE EXCEPTION '(facet) complete_mcp_oauth_grant ACCEPTED an api_key connection';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
    IF _msg NOT LIKE 'MCP_NOT_AN_MCP_CONNECTION%' THEN
      RAISE EXCEPTION '(facet) complete refused for the wrong reason: %', _msg;
    END IF;
  END;

  -- ── 3. …and the credential the refusal exists to protect is UNTOUCHED ────────────────────────
  SELECT auth_token_ct::text, auth_kind INTO _tok_after, _kind
    FROM public.mcp_connections WHERE connection_id = _rest;
  IF _tok_after IS DISTINCT FROM _tok_before THEN
    RAISE EXCEPTION '(facet) the api_key credential was modified by a refused OAuth grant';
  END IF;
  IF _kind <> 'api_key' THEN
    RAISE EXCEPTION '(facet) the facet was converted despite the refusal, now %', _kind;
  END IF;

  -- ── 4. The guard narrows EXACTLY one facet — a 'none' shell still runs both ──────────────────
  PERFORM public.complete_mcp_oauth_grant(_shell, T, 'tok-shell-123456', NULL,
    'https://iss.example.com', 'client-123', NULL, NULL, NULL, auth.uid(),
    pg_temp.mcp_oauth_binding(_shell, T, auth.uid()));
  SELECT auth_kind INTO _kind FROM public.mcp_connections WHERE connection_id = _shell;
  IF _kind <> 'oauth' THEN
    RAISE EXCEPTION '(facet) a legitimate shell did not become oauth, got % — the guard is too wide', _kind;
  END IF;

  -- ── 5. Tenancy is still answered BEFORE the facet, so this is no existence oracle ────────────
  PERFORM set_config('request.jwt.claims', '{"sub":"fa0e0000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  _foreign := (public.create_mcp_rest_connection('n8n','facet-foreign','https://foreign.example.com','foreign-key-123456')->>'connection_id')::uuid;
  PERFORM set_config('request.jwt.claims', '{"sub":"fa0e0000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  BEGIN
    -- T2's api_key row, probed as T. Both refusals could apply; the TENANT one must win, or the
    -- answer would reveal the shape of a row in someone else's tenant.
    PERFORM public.begin_mcp_oauth(_foreign, T, 'state-facet-x', 'verifier-facet-x',
      'https://cb.example.com/cb', 'https://iss.example.com', NULL, 'client-123', NULL, NULL);
    RAISE EXCEPTION '(facet) a foreign connection was accepted';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
    IF _msg LIKE 'MCP_NOT_AN_MCP_CONNECTION%' THEN
      RAISE EXCEPTION '(facet) the facet check answered before the tenant check — that leaks the row shape across tenants';
    END IF;
    IF _msg NOT LIKE 'MCP_FORBIDDEN%' THEN
      RAISE EXCEPTION '(facet) foreign probe refused for an unexpected reason: %', _msg;
    END IF;
  END;
END $$;

ROLLBACK;
