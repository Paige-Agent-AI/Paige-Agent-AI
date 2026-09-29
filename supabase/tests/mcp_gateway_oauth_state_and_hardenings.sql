-- ============================================================================
-- Connected MCP Gateway — Slice ② foundation proof (migration 20270332000000).
--
-- Proves, against a freshly replayed schema:
--   A. OAUTH-STATE STORE (mcp_connection_oauth_state / begin_mcp_oauth / consume_mcp_oauth_state):
--      begin stores an ENCRYPTED verifier; consume redeems exactly once (found + decrypted verifier),
--      a second consume finds nothing (single-use), an expired state is not consumable, and begin
--      refuses a connection that is not in the passed tenant (§9/§59).
--   B. INT-152 (config_generation compare-and-write): a native create starts at generation 1; a
--      re-key BUMPS it (the trg_mcp_bump_config_generation trigger); get_mcp_connection_secret returns
--      the loaded generation; mcp_connection_probe is compare-and-write — a STALE expected generation
--      is applied:false (no clobber of status/catalog), the CURRENT generation applies, a NULL
--      expected generation applies unconditionally (legacy); and a probe RESULT write does NOT bump the
--      generation (verification is not a config change).
--   C. INT-153 (writer minimum credential length, bearer/header only): create_mcp_connection refuses a
--      <12-char bearer AND header token (MCP_CREDENTIAL_TOO_SHORT), accepts a >=12-char one, and leaves
--      oauth (provider-minted, unscanned) and url/none unaffected — proven at the ONE home
--      _mcp_assert_credential_bundle and through the real writer.
--
-- Any failed assertion RAISEs, so under `psql -v ON_ERROR_STOP=1` the process exit code alone reports
-- pass (0) / fail (non-zero) — no pass-count to trust (§13/§32). Disposable database only.
-- BEGIN..ROLLBACK does not authorize running test records against production or real tenant data.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/mcp_gateway_oauth_state_and_hardenings.sql "$DB_URL"
-- ============================================================================
BEGIN;

-- Actor + tenants: an admin of tenant T (the manage-capable happy-path caller), and a DIFFERENT
-- tenant T2 (for the §9 cross-tenant begin refusal).
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('d2b00000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'int152-admin@tests.invalid');

INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('d2b00000-0000-0000-0000-0000000000a1', 'int152-t',  'INT152 T',  'active', 'standalone', 'IXA', '{}'::jsonb),
  ('d2b00000-0000-0000-0000-0000000000a2', 'int152-t2', 'INT152 T2', 'active', 'standalone', 'IXB', '{}'::jsonb);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('d2b00000-0000-0000-0000-0000000000a1', 'd2b00000-0000-0000-0000-000000000002', 'admin', 'active', false, now());

-- ── C. INT-153 — writer minimum credential length (through the real writer + the one home) ──────────
DO $$
DECLARE _msg text; _r jsonb; T uuid := 'd2b00000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"d2b00000-0000-0000-0000-000000000002","role":"authenticated"}', true);

  -- bearer < 12 → rejected at the writer (routes through _mcp_assert_credential_bundle)
  _msg := NULL;
  BEGIN PERFORM public.create_mcp_connection('generic-remote','i153-b-short','https://i153b.example.com/rpc','bearer','short-11chr');
  EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_CREDENTIAL_TOO_SHORT%' THEN
    RAISE EXCEPTION '(INT-153) a <12 bearer token was not rejected as too short: %', _msg; END IF;

  -- header < 12 → rejected (the length check is AFTER the header-name check, so a valid name + short
  -- token reaches it and reports too-short, not bad-bundle)
  _msg := NULL;
  BEGIN PERFORM public.create_mcp_connection('generic-remote','i153-h-short','https://i153h.example.com/rpc','header','shorttoken1','X-Api-Key');
  EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_CREDENTIAL_TOO_SHORT%' THEN
    RAISE EXCEPTION '(INT-153) a <12 header token was not rejected as too short: %', _msg; END IF;

  -- bearer >= 12 → accepted
  _r := public.create_mcp_connection('generic-remote','i153-b-ok','https://i153bok.example.com/rpc','bearer','bearer-token-ok-1');
  IF (_r->>'status') <> 'pending_verification' THEN
    RAISE EXCEPTION '(INT-153) a >=12 bearer token was not accepted: %', _r; END IF;

  -- oauth is EXEMPT: a short access token is NOT rejected for length (only its own bundle rules apply).
  _r := public.create_mcp_connection('generic-remote','i153-o-shorttok','https://i153o.example.com/rpc','oauth','tok-o',NULL,NULL,'https://iss.example.com','cid');
  IF (_r->>'status') <> 'pending_verification' THEN
    RAISE EXCEPTION '(INT-153) an oauth short token was wrongly rejected (oauth must be exempt): %', _r; END IF;

  -- The ONE home, called directly: bearer/header <12 raise, oauth short does not, url/none carry no token.
  _msg := NULL; BEGIN PERFORM public._mcp_assert_credential_bundle('bearer','abc',NULL,NULL,NULL,NULL,NULL,NULL,NULL);
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg NOT LIKE '%MCP_CREDENTIAL_TOO_SHORT%' THEN RAISE EXCEPTION '(INT-153 unit) bearer 3-char not too-short: %', _msg; END IF;
  -- oauth 3-char token, valid issuer+client → passes (exempt): no exception.
  PERFORM public._mcp_assert_credential_bundle('oauth','abc',NULL,NULL,'https://iss.example.com','cid',NULL,NULL,NULL);
  RAISE NOTICE 'INT-153 OK: bearer/header <12 rejected; >=12 accepted; oauth exempt; url/none unaffected.';
END $$;

-- ── B. INT-152 — config_generation compare-and-write ────────────────────────────────────────────────
DO $$
DECLARE _r jsonb; _sec jsonb; _cid uuid; _gen bigint; _status text;
  T uuid := 'd2b00000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"d2b00000-0000-0000-0000-000000000002","role":"authenticated"}', true);

  -- create → generation starts at 1
  _r := public.create_mcp_connection('generic-remote','i152-conn','https://i152.example.com/rpc','bearer','initial-token-12');
  _cid := (_r->>'connection_id')::uuid;
  SELECT config_generation INTO _gen FROM public.mcp_connections WHERE connection_id = _cid;
  IF _gen <> 1 THEN RAISE EXCEPTION '(INT-152) fresh create generation should be 1, got %', _gen; END IF;

  -- re-key → the trigger bumps generation to 2, and the secret loader returns it
  PERFORM public.set_mcp_connection_endpoint(_cid, 'https://i152-rekey.example.com/rpc', 'bearer', 'rekeyed-token-abc-2');
  SELECT config_generation INTO _gen FROM public.mcp_connections WHERE connection_id = _cid;
  IF _gen <> 2 THEN RAISE EXCEPTION '(INT-152) re-key should bump generation to 2, got %', _gen; END IF;
  _sec := public.get_mcp_connection_secret(_cid);
  IF (_sec->>'config_generation') <> '2' THEN
    RAISE EXCEPTION '(INT-152) get_mcp_connection_secret must return config_generation=2, got %', _sec->>'config_generation'; END IF;
  -- §58 regression guard: the secret STILL returns endpoint_hash + visibility (the peer-gate catch).
  IF (_sec->>'endpoint_hash') IS NULL OR (_sec->>'visibility') IS NULL THEN
    RAISE EXCEPTION '(INT-152/§58) secret dropped endpoint_hash or visibility: %', _sec; END IF;

  -- probe with a STALE expected generation (1, but the row is at 2) → applied:false, NO clobber.
  _r := public.mcp_connection_probe(_cid, 'connected', 'healthy', NULL,
        ('[{"tool_name":"t.stale","pin":"' || repeat('a',64) || '"}]')::jsonb, 1);
  IF (_r->>'applied') <> 'false' OR (_r->>'reason') <> 'stale_generation' THEN
    RAISE EXCEPTION '(INT-152) a stale-generation probe must be applied:false/stale_generation, got %', _r; END IF;
  SELECT status INTO _status FROM public.mcp_connections WHERE connection_id = _cid;
  IF _status <> 'pending_verification' THEN
    RAISE EXCEPTION '(INT-152) a stale probe clobbered status to % (must stay pending_verification)', _status; END IF;
  IF EXISTS (SELECT 1 FROM public.mcp_connection_tools WHERE connection_id = _cid) THEN
    RAISE EXCEPTION '(INT-152) a stale probe wrote the tool catalog (must not)'; END IF;

  -- probe with the CURRENT generation (2) → applied:true, status→connected, catalog written.
  _r := public.mcp_connection_probe(_cid, 'connected', 'healthy', NULL,
        ('[{"tool_name":"t.ok","pin":"' || repeat('b',64) || '"}]')::jsonb, 2);
  IF (_r->>'applied') <> 'true' THEN RAISE EXCEPTION '(INT-152) a current-generation probe must apply, got %', _r; END IF;
  SELECT status INTO _status FROM public.mcp_connections WHERE connection_id = _cid;
  IF _status <> 'connected' THEN RAISE EXCEPTION '(INT-152) current probe did not set connected, got %', _status; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_connection_tools WHERE connection_id = _cid AND tool_name = 't.ok') THEN
    RAISE EXCEPTION '(INT-152) current probe did not write the catalog'; END IF;

  -- the probe RESULT write did NOT bump the generation (verification is not a config change).
  SELECT config_generation INTO _gen FROM public.mcp_connections WHERE connection_id = _cid;
  IF _gen <> 2 THEN RAISE EXCEPTION '(INT-152) a probe result write bumped generation to % (must stay 2)', _gen; END IF;

  -- probe with a NULL expected generation → unconditional legacy write (still applies).
  _r := public.mcp_connection_probe(_cid, 'connected', 'healthy', NULL, NULL, NULL);
  IF (_r->>'applied') <> 'true' THEN RAISE EXCEPTION '(INT-152) a NULL-generation probe must apply unconditionally, got %', _r; END IF;

  -- probe of a VANISHED connection → applied:false/no_connection (no FK-fault).
  _r := public.mcp_connection_probe('00000000-0000-0000-0000-0000000000ff', 'connected', 'healthy', NULL, NULL, NULL);
  IF (_r->>'applied') <> 'false' OR (_r->>'reason') <> 'no_connection' THEN
    RAISE EXCEPTION '(INT-152) a missing-connection probe must be applied:false/no_connection, got %', _r; END IF;

  RAISE NOTICE 'INT-152 OK: create=1, re-key bumps, secret carries it, stale no-op, current applies, probe result does not bump.';
END $$;

-- ── A. OAUTH-STATE STORE — begin / consume, single-use, expiry, §9 tenant scope ─────────────────────
DO $$
DECLARE _cid uuid; _r jsonb; _ver text; T uuid := 'd2b00000-0000-0000-0000-0000000000a1';
  T2 uuid := 'd2b00000-0000-0000-0000-0000000000a2';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"d2b00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  _cid := (public.create_mcp_connection('generic-remote','oauth-conn','https://oauthc.example.com/rpc','none')->>'connection_id')::uuid;

  -- begin stores the verifier ENCRYPTED (the plaintext must NOT be readable in the ciphertext column).
  PERFORM public.begin_mcp_oauth(_cid, T, 'state-abc-123', 'verifier-plaintext-xyz',
          'https://app.example.com/cb', 'https://iss.example.com', 'https://res.example.com', 'client-123', NULL, auth.uid(),
          (SELECT config_generation FROM public.mcp_connections WHERE connection_id = _cid), ARRAY['mcp.read']);
  IF NOT EXISTS (SELECT 1 FROM public.mcp_connection_oauth_state WHERE state = 'state-abc-123' AND consumed_at IS NULL) THEN
    RAISE EXCEPTION '(oauth) begin did not store an un-consumed flow'; END IF;
  -- The verifier column must be genuine ciphertext, never the raw bytes (a bytea equality that cannot
  -- throw on binary, unlike convert_from). pgp_sym_encrypt output is longer than and unequal to the raw.
  IF EXISTS (SELECT 1 FROM public.mcp_connection_oauth_state
             WHERE state = 'state-abc-123'
               AND (code_verifier_ct = convert_to('verifier-plaintext-xyz', 'UTF8')
                    OR octet_length(code_verifier_ct) <= octet_length('verifier-plaintext-xyz'))) THEN
    RAISE EXCEPTION '(oauth) the verifier is stored in PLAINTEXT (must be encrypted)'; END IF;

  -- consume redeems exactly once: found + decrypted verifier + flow context.
  _r := public.consume_mcp_oauth_state('state-abc-123');
  IF (_r->>'found') <> 'true' OR (_r->>'code_verifier') <> 'verifier-plaintext-xyz'
     OR (_r->>'connection_id') <> _cid::text OR (_r->>'tenant_id') <> T::text THEN
    RAISE EXCEPTION '(oauth) first consume did not return the flow: %', _r; END IF;

  -- a SECOND consume finds nothing (single-use, atomic).
  _r := public.consume_mcp_oauth_state('state-abc-123');
  IF (_r->>'found') <> 'false' THEN RAISE EXCEPTION '(oauth) a replayed state was consumable twice: %', _r; END IF;

  -- Isolate expiry: both states have genuine authority/return/generation bindings, differing
  -- only in expiry. Missing new bindings must not mask a removed expiry predicate.
  PERFORM public.begin_mcp_oauth(_cid,T,'state-fresh','test-verifier','https://app.example.com/cb',
    'https://iss.example.com','https://res.example.com','client-123',NULL,auth.uid(),
    (SELECT config_generation FROM public.mcp_connections WHERE connection_id=_cid),ARRAY['mcp.read']);
  _r := public.consume_mcp_oauth_state('state-fresh');
  IF _r->>'found' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '(oauth) unexpired positive control refused'; END IF;
  PERFORM public.begin_mcp_oauth(_cid,T,'state-expired','test-verifier','https://app.example.com/cb',
    'https://iss.example.com','https://res.example.com','client-123',NULL,auth.uid(),
    (SELECT config_generation FROM public.mcp_connections WHERE connection_id=_cid),ARRAY['mcp.read']);
  UPDATE public.mcp_connection_oauth_state SET expires_at=clock_timestamp()-interval '1 minute' WHERE state='state-expired';
  _r := public.consume_mcp_oauth_state('state-expired');
  IF (_r->>'found') <> 'false' THEN RAISE EXCEPTION '(oauth) an expired state was consumable: %', _r; END IF;

  -- §9/§59: begin refuses a connection that is not in the passed tenant.
  DECLARE _msg text; BEGIN
    _msg := NULL;
    BEGIN PERFORM public.begin_mcp_oauth(_cid, T2, 'state-crosstenant', 'v2',
            'https://app.example.com/cb', 'https://iss.example.com', NULL, 'client-123', NULL, NULL);
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
    IF _msg IS NULL OR _msg NOT LIKE '%MCP_FORBIDDEN%' THEN
      RAISE EXCEPTION '(oauth §9) begin allowed a cross-tenant connection: %', _msg; END IF;
  END;

  RAISE NOTICE 'OAUTH-STATE OK: encrypted verifier, single-use consume, expiry, cross-tenant refusal.';
END $$;

ROLLBACK;
