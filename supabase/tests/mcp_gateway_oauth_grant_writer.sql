-- ============================================================================
-- Connected MCP Gateway — Slice ② OAuth GRANT WRITER proof (migration 20270333000000).
--
-- Proves, against a freshly replayed schema, that complete_mcp_oauth_grant (the connection-keyed,
-- service_role-only writer the JWT-less mcp-oauth-callback calls):
--   1. HAPPY PATH — re-keys a 'none' shell to 'oauth', stores the access/refresh tokens ENCRYPTED,
--      records the granted scopes, resets status→pending_verification, BUMPS config_generation (via
--      trg_mcp_bump_config_generation), and returns the tenant's account_type/account_number routing
--      facts. A round-trip through get_mcp_connection_secret returns the decrypted access token + oauth
--      bundle (the runtime can load it).
--   2. §9/§59 — refuses (a) a connection that is not in the passed tenant AND (b) a caller-supplied
--      _actor who is not a member of the passed tenant, both MCP_FORBIDDEN, even though the EXECUTE grant
--      is service_role: the in-body FOR UPDATE tenant re-check + the actor-membership check are the
--      guards, not the grant. A legitimate member _actor (c) is accepted — the guard rejects only a
--      MISMATCH, never every non-null actor.
--   3. VALIDATION REUSE (§18 one home) — an empty access token, a missing issuer, and a missing
--      client_id each raise MCP_BAD_CREDENTIAL_BUNDLE; an already-EXPIRED access token raises
--      MCP_OAUTH_TOKEN_EXPIRED — the exact _mcp_assert_credential_bundle('oauth', …) contract create/set
--      enforce, so a broken exchange can never persist an unusable grant.
--
-- Any failed assertion RAISEs, so under `psql -v ON_ERROR_STOP=1` the exit code alone reports pass(0)/
-- fail(non-zero) — no pass-count to trust (§13/§32). Disposable test database only. NEVER run
-- against production, even with BEGIN..ROLLBACK. Test records are not production evidence.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/mcp_gateway_oauth_grant_writer.sql "$DB_URL"
-- ============================================================================
BEGIN;
\ir helpers/mcp_oauth_binding.sql

-- Admin of tenant T (create the shell), a DIFFERENT tenant T2 (the §9 cross-tenant refusal), and a
-- FOREIGN actor who is an active member of T2 ONLY (the mismatched-_actor refusal).
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('c3a00000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'grant-admin@tests.invalid'),
  ('c3a00000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'grant-foreign@tests.invalid');

INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('c3a00000-0000-0000-0000-0000000000a1', 'grant-t',  'GRANT T',  'active', 'standalone', 'GRA', '{}'::jsonb),
  ('c3a00000-0000-0000-0000-0000000000a2', 'grant-t2', 'GRANT T2', 'active', 'standalone', 'GRB', '{}'::jsonb);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('c3a00000-0000-0000-0000-0000000000a1', 'c3a00000-0000-0000-0000-000000000002', 'admin', 'active', false, now()),
  ('c3a00000-0000-0000-0000-0000000000a2', 'c3a00000-0000-0000-0000-000000000003', 'admin', 'active', false, now());

DO $$
DECLARE
  _cid uuid; _r jsonb; _sec jsonb; _gen bigint; _status text; _kind text; _msg text;
  _acct_type text; _acct_num bigint; _scopes text[];
  T  uuid := 'c3a00000-0000-0000-0000-0000000000a1';
  T2 uuid := 'c3a00000-0000-0000-0000-0000000000a2';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c3a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);

  -- A 'none' shell (created via the real writer, exactly as create → oauth_begin leaves it).
  _cid := (public.create_mcp_connection('generic-remote','grant-shell','https://grant.example.com/rpc','none')->>'connection_id')::uuid;
  SELECT config_generation INTO _gen FROM public.mcp_connections WHERE connection_id = _cid;
  IF _gen <> 1 THEN RAISE EXCEPTION '(grant) fresh shell generation should be 1, got %', _gen; END IF;

  -- The tenant's real routing facts (however account_number is populated) — the writer must echo THESE.
  SELECT account_type, account_number INTO _acct_type, _acct_num FROM public.tenants WHERE id = T;

  -- ── 1. HAPPY PATH ────────────────────────────────────────────────────────────────────────────────
  _r := public.complete_mcp_oauth_grant(
    _cid, T,
    'provider-access-token-xyz', 'provider-refresh-token-xyz',
    'https://iss.example.com', 'client-123', NULL,
    ARRAY['mcp.read','mcp.write']::text[], now() + interval '1 hour', auth.uid(),
    pg_temp.mcp_oauth_binding(_cid, T, auth.uid()));

  IF (_r->>'status') <> 'pending_verification' THEN RAISE EXCEPTION '(grant) status not pending_verification: %', _r; END IF;
  IF (_r->>'connection_id') <> _cid::text THEN RAISE EXCEPTION '(grant) wrong connection_id returned: %', _r; END IF;
  IF (_r->>'account_type') IS DISTINCT FROM _acct_type THEN
    RAISE EXCEPTION '(grant) returned account_type % != tenant %', _r->>'account_type', _acct_type; END IF;
  IF COALESCE(_r->>'account_number','∅') IS DISTINCT FROM COALESCE(_acct_num::text,'∅') THEN
    RAISE EXCEPTION '(grant) returned account_number % != tenant %', _r->>'account_number', _acct_num; END IF;

  -- The row was re-keyed to oauth, status reset, generation bumped (auth_kind + credentials + oauth-* changed).
  SELECT auth_kind, status, config_generation, oauth_scopes, granted_scopes
    INTO _kind, _status, _gen, _scopes, _scopes
    FROM public.mcp_connections WHERE connection_id = _cid;
  IF _kind <> 'oauth' THEN RAISE EXCEPTION '(grant) auth_kind not re-keyed to oauth, got %', _kind; END IF;
  IF _status <> 'pending_verification' THEN RAISE EXCEPTION '(grant) row status not pending_verification, got %', _status; END IF;
  IF _gen <> 2 THEN RAISE EXCEPTION '(grant) config_generation did not bump to 2, got %', _gen; END IF;

  -- oauth_scopes AND granted_scopes both record the granted set.
  IF (SELECT oauth_scopes FROM public.mcp_connections WHERE connection_id=_cid) IS DISTINCT FROM ARRAY['mcp.read','mcp.write']::text[]
     OR (SELECT granted_scopes FROM public.mcp_connections WHERE connection_id=_cid) IS DISTINCT FROM ARRAY['mcp.read','mcp.write']::text[] THEN
    RAISE EXCEPTION '(grant) oauth_scopes/granted_scopes not recorded as the granted set'; END IF;

  -- Tokens stored ENCRYPTED (never the raw bytes; ciphertext is longer than and unequal to the plaintext).
  IF EXISTS (SELECT 1 FROM public.mcp_connections WHERE connection_id=_cid
               AND (auth_token_ct = convert_to('provider-access-token-xyz','UTF8')
                    OR octet_length(auth_token_ct) <= octet_length('provider-access-token-xyz'))) THEN
    RAISE EXCEPTION '(grant) the access token is stored in PLAINTEXT (must be encrypted)'; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_connections WHERE connection_id=_cid
               AND (refresh_token_ct = convert_to('provider-refresh-token-xyz','UTF8')
                    OR octet_length(refresh_token_ct) <= octet_length('provider-refresh-token-xyz'))) THEN
    RAISE EXCEPTION '(grant) the refresh token is stored in PLAINTEXT (must be encrypted)'; END IF;

  -- Round-trip: the runtime loader returns the decrypted access token + oauth bundle (it can drive the row).
  _sec := public.get_mcp_connection_secret(_cid);
  IF (_sec->>'auth_kind') <> 'oauth' OR (_sec->>'auth_token') <> 'provider-access-token-xyz'
     OR (_sec->>'refresh_token') <> 'provider-refresh-token-xyz' OR (_sec->>'oauth_issuer') <> 'https://iss.example.com'
     OR (_sec->>'oauth_client_id') <> 'client-123' THEN
    RAISE EXCEPTION '(grant) loader did not round-trip the oauth grant: %', _sec; END IF;

  -- ── 2. §9/§59 — cross-tenant refusal (the EXECUTE grant is not the guard) ──────────────────────────
  -- (a) a connection that is not in the passed tenant → MCP_FORBIDDEN (the connection surface).
  _msg := NULL;
  BEGIN PERFORM public.complete_mcp_oauth_grant(_cid, T2, 'tok-cross-123456', NULL,
          'https://iss.example.com', 'client-123', NULL, NULL, NULL, auth.uid(),
          pg_temp.mcp_oauth_binding(_cid, T, auth.uid()));
  EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_FORBIDDEN%' THEN
    RAISE EXCEPTION '(grant §9) a grant for a connection not in the passed tenant was allowed: %', _msg; END IF;

  -- (b) a MISMATCHED _actor — a caller-supplied actor who is NOT a member of the passed tenant (they are a
  -- member of T2, foreign to T) → MCP_FORBIDDEN. The connection IS in T, so ONLY the actor gate can catch
  -- this: it proves the caller-supplied _actor cannot buy attribution/authority (the _actor surface).
  _msg := NULL;
  BEGIN PERFORM public.complete_mcp_oauth_grant(_cid, T, 'tok-actor-123456', NULL,
          'https://iss.example.com', 'client-123', NULL, NULL, NULL,
          'c3a00000-0000-0000-0000-000000000003'::uuid,
          pg_temp.mcp_oauth_binding(_cid, T, auth.uid()));  -- foreign actor against real initiating owner binding
  EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_FORBIDDEN%' THEN
    RAISE EXCEPTION '(grant §59) a grant with a non-member _actor was allowed: %', _msg; END IF;

  -- (c) a legitimate member _actor (the T admin) is accepted — the guard rejects only a MISMATCH, never a
  -- real member (proves it is not just refusing every non-null actor).
  -- This call also passes NULL scopes, so it doubles as the COALESCE proof: granted_scopes is NOT NULL
  -- (20270319000000), so a NULL _oauth_scopes must land as '{}', never a NOT NULL violation.
  _r := public.complete_mcp_oauth_grant(_cid, T, 'tok-member-123456', NULL,
          'https://iss.example.com', 'client-123', NULL, NULL, NULL,
          'c3a00000-0000-0000-0000-000000000002'::uuid,
          pg_temp.mcp_oauth_binding(_cid, T, auth.uid()));  -- the real T admin (member of T)
  IF (_r->>'status') <> 'pending_verification' THEN
    RAISE EXCEPTION '(grant §59) a grant with a legitimate member _actor was wrongly refused: %', _r; END IF;
  IF (SELECT granted_scopes FROM public.mcp_connections WHERE connection_id=_cid) IS DISTINCT FROM '{}'::text[]
     OR (SELECT oauth_scopes FROM public.mcp_connections WHERE connection_id=_cid) IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION '(grant) a NULL-scopes grant did not COALESCE oauth_scopes/granted_scopes to {} (NOT NULL guard)'; END IF;

  -- ── 3. VALIDATION REUSE — an unusable oauth bundle can never persist ───────────────────────────────
  -- empty access token
  _msg := NULL;
  BEGIN PERFORM public.complete_mcp_oauth_grant(_cid, T, '', NULL, 'https://iss.example.com', 'client-123', NULL, NULL, NULL, auth.uid(), pg_temp.mcp_oauth_binding(_cid, T, auth.uid()));
  EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_CREDENTIAL_BUNDLE%' THEN RAISE EXCEPTION '(grant) empty access token not rejected: %', _msg; END IF;
  -- missing issuer
  _msg := NULL;
  BEGIN PERFORM public.complete_mcp_oauth_grant(_cid, T, 'tok-ok-123456', NULL, NULL, 'client-123', NULL, NULL, NULL, auth.uid(), pg_temp.mcp_oauth_binding(_cid, T, auth.uid()));
  EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_CREDENTIAL_BUNDLE%' THEN RAISE EXCEPTION '(grant) missing issuer not rejected: %', _msg; END IF;
  -- missing client_id
  _msg := NULL;
  BEGIN PERFORM public.complete_mcp_oauth_grant(_cid, T, 'tok-ok-123456', NULL, 'https://iss.example.com', NULL, NULL, NULL, NULL, auth.uid(), pg_temp.mcp_oauth_binding(_cid, T, auth.uid()));
  EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_CREDENTIAL_BUNDLE%' THEN RAISE EXCEPTION '(grant) missing client_id not rejected: %', _msg; END IF;
  -- already-expired access token
  _msg := NULL;
  BEGIN PERFORM public.complete_mcp_oauth_grant(_cid, T, 'tok-ok-123456', NULL, 'https://iss.example.com', 'client-123', NULL, NULL, now() - interval '1 minute', auth.uid(), pg_temp.mcp_oauth_binding(_cid, T, auth.uid()));
  EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_OAUTH_TOKEN_EXPIRED%' THEN RAISE EXCEPTION '(grant) expired access token not rejected: %', _msg; END IF;

  RAISE NOTICE 'OAUTH-GRANT-WRITER OK: re-key+encrypt+bump+routing facts; §9 cross-tenant refusal; bundle validation reused.';
END $$;

ROLLBACK;

-- Same native CI entrypoint; exercise the state-bound writer after the legacy grant cases.
-- This file and its include are disposable-database tests, never production smoke tests.
\ir mcp_oauth_completion_binding.sql
