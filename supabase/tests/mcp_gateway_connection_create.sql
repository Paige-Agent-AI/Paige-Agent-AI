-- ============================================================================
-- Connected MCP Gateway — NATIVE-connection WRITERS (G1a-1 / MCP PR-G1a, DB proof).
--
-- Proves migration 20270331000000 at the DB layer, mirroring mcp_gateway_endpoint_setter.sql style
-- (synthetic fixtures, request.jwt.claims mocking of the caller, ON_ERROR_STOP, terminal RAISE NOTICE,
-- ROLLBACK). Coverage:
--   • create_mcp_connection ACCEPTs each MCP-executable kind (header/bearer/oauth/url/none); the created
--     row is NATIVE (legacy_source IS NULL), status='pending_verification', transport='http', the
--     credential columns are encrypted, and get_mcp_connection_secret derives a 64-hex endpoint_hash.
--   • create_mcp_connection REJECTs: reserved / bad-grammar header name, no-token bearer, refresh-only
--     oauth, expired oauth (MCP_OAUTH_TOKEN_EXPIRED), api_key (MCP_AUTH_KIND_NOT_EXECUTABLE), bad /
--     private-IP / http / userinfo endpoint (MCP_BAD_ENDPOINT), duplicate label (MCP_DUPLICATE_LABEL),
--     bad visibility, bad provider, empty label — each with the EXPECTED closed code, and no row created.
--   • F4 accept-set: every auth_kind in the mcp_connections CHECK set driven THROUGH create_mcp_connection;
--     the accepted set EQUALS the documented executable set {oauth,bearer,header,url,none}; api_key rejects
--     with the DISTINCT MCP_AUTH_KIND_NOT_EXECUTABLE.
--   • REST lane: create_mcp_rest_connection stores auth_kind='api_key' / transport='http' /
--     auth_header_name IS NULL / server_url_ct=base_url / auth_token_ct=api_key; get_mcp_connection_secret
--     returns the REST shape (auth_kind='api_key', server_url=base_url, auth_token=api_key); missing api_key
--     and bad base_url reject; set_mcp_rest_connection_endpoint re-keys (last4 updated, approvals revoked,
--     tools cleared) and refuses a non-api_key connection with MCP_NOT_A_REST_CONNECTION.
--   • disconnect: disable → enabled=false + every secret scrubbed NULL + approvals/tools deleted +
--     idempotent already_disabled; a HARD delete → row GONE, approvals+tools GONE, but a pre-existing
--     mcp_connection_receipts row SURVIVES with connection_id NULL (history-preserving, G1a-1 Correction 2)
--     and the 'mcp_connection.deleted' audit row exists; the hard path keys on mcp.connections.delete and
--     the soft path on mcp.connections.manage (proven by the refusal MESSAGES); a second hard delete →
--     uniform MCP_FORBIDDEN.
--   • §51 per-tier write matrix (create): platform-owner-as-itself → MCP_FORBIDDEN (manage EXCLUDES
--     platform owner); tenant admin (own) → success; a member (no manage) → MCP_FORBIDDEN; a cross-tenant
--     _tenant_id → tenant-mismatch refusal; a NULL actor → refused (no service-role bypass).
--   • A1/A3: the audit payload carries NO url/token substring (hashes/enums/name/last4 only); the return
--     carries only the write-only keys (no secret, no decrypted URL).
--   • P1(a) re-key = reconnect: a soft-disconnected (enabled=false) MCP row and REST row each RECONNECT
--     (enabled=true, status='pending_verification') on a fresh-cred re-key, and get_mcp_connection_secret
--     then returns a USABLE shape (configured/enabled true, server_url + auth_token loadable) after a probe;
--     re-keying an ALREADY-enabled row is a no-op for enabled (stays true, no error, no flip).
--   • P2 list-side configured: get_mcp_connections_v2 reports configured:true for a credentialless url/none
--     row (server_url_ct present, both tokens null) and STILL configured:false for a tokenless bearer row
--     (a soft-disabled bearer — guard against over-widening).
--   • P2 (Codex) url-credential scrub on disable: a soft disable of an auth_kind='url' connection (whose
--     credential is EMBEDDED in the endpoint) nulls server_url_ct → get_mcp_connections_v2 reports
--     configured:false (a NON-VACUITY negative control re-populates server_url_ct in place and shows the
--     SAME row would report configured:true without the scrub); a subsequent url re-key RESTORES the row
--     (enabled=true, status='pending_verification', configured:true — the P1(a) path); a disabled BEARER row
--     RETAINS server_url_ct (the fix must not touch non-url; a bearer endpoint alone is not a credential);
--     a disabled 'none' row also RETAINS server_url_ct and stays configured:true (documented — the
--     coordinator scoped the credential scrub to 'url' only, as 'none' has no embedded credential).
--
-- NOTE (§13): a "manage-only, no-delete" actor is NOT constructible today — _mcp_caller_capabilities
-- co-grants manage AND delete to owner/tenant-admin — so the delete gate is proven two ways instead: the
-- member (no caps) hard-delete refusal NAMES the delete capability (soft-disable NAMES manage), and the
-- owner_only pgTAP's exact-equality mapping proves delete is a DISTINCT third capability a platform owner
-- never holds.
--
-- Run: psql -v ON_ERROR_STOP=1 -f supabase/tests/mcp_gateway_connection_create.sql "$DB_URL"
-- ============================================================================
BEGIN;

-- Actors: owner / admin / member of tenant T; a platform super_admin (NOT a member of T); the owner of a
-- DIFFERENT tenant. A global 'coach' staff role on the member proves the §59 trap (the mapping keys on
-- TENANT membership, never the tenant-agnostic user_roles).
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('c1a00000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'g1a-owner@tests.invalid'),
  ('c1a00000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'g1a-admin@tests.invalid'),
  ('c1a00000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'g1a-member@tests.invalid'),
  ('c1a00000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'g1a-super@tests.invalid'),
  ('c1a00000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'g1a-otherowner@tests.invalid');

INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
  ('c1a00000-0000-0000-0000-0000000000a1', 'g1a-t',     'G1A T',     'active', 'standalone', 'GXA', '{}'::jsonb),
  ('c1a00000-0000-0000-0000-0000000000a2', 'g1a-other', 'G1A Other', 'active', 'standalone', 'GXB', '{}'::jsonb);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('c1a00000-0000-0000-0000-0000000000a1', 'c1a00000-0000-0000-0000-000000000001', 'owner',  'active', true,  now()),
  ('c1a00000-0000-0000-0000-0000000000a1', 'c1a00000-0000-0000-0000-000000000002', 'admin',  'active', false, now()),
  ('c1a00000-0000-0000-0000-0000000000a1', 'c1a00000-0000-0000-0000-000000000003', 'member', 'active', false, now()),
  ('c1a00000-0000-0000-0000-0000000000a2', 'c1a00000-0000-0000-0000-000000000005', 'owner',  'active', true,  now());

INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1a00000-0000-0000-0000-000000000004', 'super_admin'),
  ('c1a00000-0000-0000-0000-000000000003', 'sales_rep')
ON CONFLICT DO NOTHING;

-- The admin (c1a...002) holds mcp.connections.{use_restricted,manage,delete} for T — the happy-path caller;
-- each block below mocks its caller via set_config('request.jwt.claims', ...).

-- ── (create ACCEPT) each MCP-executable kind creates a NATIVE row of the right shape ─────────────
DO $$
DECLARE _r jsonb; _row public.mcp_connections%ROWTYPE; _sec jsonb; _cid uuid;
  T uuid := 'c1a00000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);

  -- header
  -- INT-153 (20270332000000): the writer floor rejects a bearer/header token < 12 chars, so accept-case
  -- tokens must be >= 12 (the value is arbitrary; the row-shape asserts below do not check the token).
  _r := public.create_mcp_connection('generic-remote','acc-header','https://acc-header.example.com/rpc','header','tok-header-key-1','X-Api-Key');
  IF (SELECT count(*) FROM jsonb_object_keys(_r)) <> 8
     OR _r->>'address_configured' IS DISTINCT FROM 'true'
     OR _r->>'credentials_configured' IS DISTINCT FROM 'true'
     OR _r->>'custom_header_count' IS DISTINCT FROM '0'
     OR _r->>'config_generation' IS DISTINCT FROM '1'
     OR (_r->>'status') <> 'pending_verification'
     OR (_r->>'endpoint_hash') IS DISTINCT FROM public._mcp_endpoint_hash('https://acc-header.example.com/rpc')
     OR (_r ? 'server_url') OR (_r ? 'auth_token') OR (_r ? 'refresh_token') OR (_r ? 'oauth_client_secret') THEN
    RAISE EXCEPTION '(accept header) bad/leaky return: %', _r; END IF;
  _cid := (_r->>'connection_id')::uuid;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _cid;
  IF _row.legacy_source IS NOT NULL OR _row.status <> 'pending_verification' OR _row.transport <> 'http'
     OR _row.auth_kind <> 'header' OR _row.auth_header_name <> 'X-Api-Key'
     OR _row.server_url_ct IS NULL OR _row.auth_token_ct IS NULL
     OR _row.tenant_id <> T OR _row.enabled IS NOT TRUE
     OR _row.granted_scopes <> '{}' OR _row.provider_state <> '{}'::jsonb THEN
    RAISE EXCEPTION '(accept header) bad row: kind=% legacy=% status=%', _row.auth_kind, _row.legacy_source, _row.status; END IF;
  _sec := public.get_mcp_connection_secret(_cid);
  IF (_sec->>'endpoint_hash') !~ '^[0-9a-f]{64}$'
     OR (_sec->>'endpoint_hash') IS DISTINCT FROM public._mcp_endpoint_hash('https://acc-header.example.com/rpc') THEN
    RAISE EXCEPTION '(accept header) get_mcp_connection_secret endpoint_hash wrong: %', _sec; END IF;

  -- bearer (>=12-char token so last4 is emitted)
  _r := public.create_mcp_connection('generic-remote','acc-bearer','https://acc-bearer.example.com/rpc','bearer','tok-bearer-9999');
  IF (_r->>'auth_token_last4') <> '9999' THEN RAISE EXCEPTION '(accept bearer) last4 wrong: %', _r; END IF;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = (_r->>'connection_id')::uuid;
  IF _row.auth_kind <> 'bearer' OR _row.auth_token_ct IS NULL OR public.platform_decrypt(_row.auth_token_ct) <> 'tok-bearer-9999' THEN
    RAISE EXCEPTION '(accept bearer) token not stored'; END IF;

  -- oauth (token + issuer + client_id; future expiry accepted)
  _r := public.create_mcp_connection('generic-remote','acc-oauth','https://acc-oauth.example.com/rpc','oauth',
          'tok-o', NULL, 'refresh-o', 'https://iss.example.com', 'cid-1', 'sec-1', ARRAY['read']::text[], now() + interval '1 hour');
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = (_r->>'connection_id')::uuid;
  IF _row.auth_kind <> 'oauth' OR public.platform_decrypt(_row.auth_token_ct) <> 'tok-o'
     OR _row.oauth_issuer <> 'https://iss.example.com' OR _row.oauth_client_id <> 'cid-1'
     OR public.platform_decrypt(_row.refresh_token_ct) <> 'refresh-o'
     OR public.platform_decrypt(_row.oauth_client_secret_ct) <> 'sec-1' THEN
    RAISE EXCEPTION '(accept oauth) bundle not stored'; END IF;

  -- url (no credential material)
  _r := public.create_mcp_connection('zapier','acc-url','https://acc-url.example.com/rpc','url');
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = (_r->>'connection_id')::uuid;
  IF _row.auth_kind <> 'url' OR _row.auth_token_ct IS NOT NULL OR _row.auth_header_name IS NOT NULL
     OR (_r ? 'auth_token_last4') IS NOT TRUE OR (_r->>'auth_token_last4') IS NOT NULL THEN
    RAISE EXCEPTION '(accept url) must carry no credential'; END IF;

  -- none (public tokenless MCP server)
  _r := public.create_mcp_connection('generic-remote','acc-none','https://acc-none.example.com/rpc','none');
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = (_r->>'connection_id')::uuid;
  IF _row.auth_kind <> 'none' OR _row.auth_token_ct IS NOT NULL THEN
    RAISE EXCEPTION '(accept none) must carry no credential'; END IF;
END $$;

-- ── (create REJECT) each bad bundle/endpoint/label/provider/visibility RAISEs its closed code, no row ─
DO $$
DECLARE _msg text; _n int;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);

  -- reserved header name
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('generic-remote','rej-1','https://rej1.example.com/rpc','header','tok','Authorization');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_CREDENTIAL_BUNDLE%' THEN RAISE EXCEPTION 'reject reserved header: got %', _msg; END IF;
  -- bad-grammar header name
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('generic-remote','rej-2','https://rej2.example.com/rpc','header','tok','Bad Header');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_CREDENTIAL_BUNDLE%' THEN RAISE EXCEPTION 'reject bad-grammar header: got %', _msg; END IF;
  -- bearer no token
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('generic-remote','rej-3','https://rej3.example.com/rpc','bearer');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_CREDENTIAL_BUNDLE%' THEN RAISE EXCEPTION 'reject bearer-no-token: got %', _msg; END IF;
  -- refresh-only oauth
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('generic-remote','rej-4','https://rej4.example.com/rpc','oauth',NULL,NULL,'refresh-only','https://iss.example.com','cid');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_CREDENTIAL_BUNDLE%' THEN RAISE EXCEPTION 'reject oauth-refresh-only: got %', _msg; END IF;
  -- expired oauth
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('generic-remote','rej-5','https://rej5.example.com/rpc','oauth','tok',NULL,NULL,'https://iss.example.com','cid',NULL,NULL, now() - interval '1 minute');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_OAUTH_TOKEN_EXPIRED%' THEN RAISE EXCEPTION 'reject oauth-expired: got %', _msg; END IF;
  -- api_key (recognized but non-executable)
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('n8n','rej-6','https://rej6.example.com/rpc','api_key','tok-k');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_AUTH_KIND_NOT_EXECUTABLE%' THEN RAISE EXCEPTION 'reject api_key: got %', _msg; END IF;
  -- bad endpoint: http scheme
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('generic-remote','rej-7','http://rej7.example.com/rpc','none');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_ENDPOINT%' THEN RAISE EXCEPTION 'reject http endpoint: got %', _msg; END IF;
  -- bad endpoint: private IP
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('generic-remote','rej-8','https://10.0.0.5/rpc','none');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_ENDPOINT%' THEN RAISE EXCEPTION 'reject private-IP endpoint: got %', _msg; END IF;
  -- bad endpoint: userinfo
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('generic-remote','rej-9','https://user:pass@rej9.example.com/rpc','none');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_ENDPOINT%' THEN RAISE EXCEPTION 'reject userinfo endpoint: got %', _msg; END IF;
  -- bad visibility
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection(_provider_key=>'generic-remote',_label=>'rej-10',_server_url=>'https://rej10.example.com/rpc',_auth_kind=>'none',_visibility=>'public');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_VISIBILITY%' THEN RAISE EXCEPTION 'reject bad visibility: got %', _msg; END IF;
  -- bad provider
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('nope-provider','rej-11','https://rej11.example.com/rpc','none');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_PROVIDER%' THEN RAISE EXCEPTION 'reject bad provider: got %', _msg; END IF;
  -- empty label
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('generic-remote','   ','https://rej12.example.com/rpc','none');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_LABEL%' THEN RAISE EXCEPTION 'reject empty label: got %', _msg; END IF;

  -- NO rejected call created a row (all failed before/at the insert).
  SELECT count(*) INTO _n FROM public.mcp_connections
    WHERE tenant_id = 'c1a00000-0000-0000-0000-0000000000a1'
      AND label IN ('rej-1','rej-2','rej-3','rej-4','rej-5','rej-6','rej-7','rej-8','rej-9','rej-10','rej-11');
  IF _n <> 0 THEN RAISE EXCEPTION '(reject) a rejected create left % row(s)', _n; END IF;

  -- duplicate label: first create succeeds, second (same tenant+provider+label) → MCP_DUPLICATE_LABEL.
  PERFORM public.create_mcp_connection('generic-remote','dup-x','https://dup1.example.com/rpc','none');
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('generic-remote','dup-x','https://dup2.example.com/rpc','none');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_DUPLICATE_LABEL%' THEN RAISE EXCEPTION 'reject duplicate label: got %', _msg; END IF;
END $$;

-- ── (F4) accept-set enumeration THROUGH create_mcp_connection == {oauth,bearer,header,url,none} ────
DO $$
DECLARE _kind text; _accepted text[] := '{}'::text[];
  _expected text[] := ARRAY['oauth','bearer','header','url','none'];
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  FOREACH _kind IN ARRAY ARRAY['oauth','bearer','header','api_key','url','none'] LOOP
    BEGIN
      CASE _kind
        WHEN 'oauth'   THEN PERFORM public.create_mcp_connection('generic-remote','f4-oauth','https://f4-oauth.example.com/rpc','oauth','tok',NULL,NULL,'https://iss.example.com','cid');
        WHEN 'bearer'  THEN PERFORM public.create_mcp_connection('generic-remote','f4-bearer','https://f4-bearer.example.com/rpc','bearer','f4-bearer-tok-1');
        WHEN 'header'  THEN PERFORM public.create_mcp_connection('generic-remote','f4-header','https://f4-header.example.com/rpc','header','f4-header-tok-1','X-Api-Key');
        WHEN 'api_key' THEN PERFORM public.create_mcp_connection('n8n','f4-apikey','https://f4-apikey.example.com/rpc','api_key','tok');
        WHEN 'url'     THEN PERFORM public.create_mcp_connection('zapier','f4-url','https://f4-url.example.com/rpc','url');
        WHEN 'none'    THEN PERFORM public.create_mcp_connection('generic-remote','f4-none','https://f4-none.example.com/rpc','none');
      END CASE;
      _accepted := array_append(_accepted, _kind);
    EXCEPTION WHEN OTHERS THEN
      IF _kind = 'api_key' THEN
        IF SQLERRM NOT LIKE '%MCP_AUTH_KIND_NOT_EXECUTABLE%' THEN
          RAISE EXCEPTION '(F4) api_key must reject with MCP_AUTH_KIND_NOT_EXECUTABLE, got: %', SQLERRM; END IF;
      ELSE
        RAISE EXCEPTION '(F4) documented-executable kind % unexpectedly rejected: %', _kind, SQLERRM;
      END IF;
    END;
  END LOOP;
  IF NOT (_accepted @> _expected AND _expected @> _accepted) THEN
    RAISE EXCEPTION '(F4) create accept-set % != documented executable set %', _accepted, _expected; END IF;
END $$;

-- ── (REST lane) create_mcp_rest_connection stores the api_key facet; get_mcp_connection_secret REST shape ─
DO $$
DECLARE _r jsonb; _row public.mcp_connections%ROWTYPE; _sec jsonb; _cid uuid; _msg text;
  BASE text := 'https://rest1.example.com/mcp-server/http';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);

  _r := public.create_mcp_rest_connection(_label=>'rest-1', _base_url=>BASE, _api_key=>'n8n-api-key-1234');   -- provider defaults 'n8n'
  _cid := (_r->>'connection_id')::uuid;
  IF (_r->>'status') <> 'pending_verification' OR (_r->>'auth_token_last4') <> '1234'
     OR (_r->>'endpoint_hash') IS DISTINCT FROM public._mcp_endpoint_hash(BASE) THEN
    RAISE EXCEPTION '(rest create) bad return: %', _r; END IF;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _cid;
  IF _row.auth_kind <> 'api_key' OR _row.transport <> 'http' OR _row.auth_header_name IS NOT NULL
     OR _row.legacy_source IS NOT NULL OR _row.provider_key <> 'n8n' OR _row.status <> 'pending_verification'
     OR public.platform_decrypt(_row.server_url_ct) <> BASE
     OR public.platform_decrypt(_row.auth_token_ct) <> 'n8n-api-key-1234' THEN
    RAISE EXCEPTION '(rest create) bad row'; END IF;
  _sec := public.get_mcp_connection_secret(_cid);
  IF (_sec->>'auth_kind') <> 'api_key' OR (_sec->>'server_url') <> BASE OR (_sec->>'auth_token') <> 'n8n-api-key-1234' THEN
    RAISE EXCEPTION '(rest create) get_mcp_connection_secret REST shape wrong: %', _sec; END IF;

  -- reject missing api_key / bad base_url / empty label / bad provider.
  _msg := NULL; BEGIN PERFORM public.create_mcp_rest_connection(_label=>'rest-bad1', _base_url=>'https://restbad.example.com/x', _api_key=>NULL);
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_CREDENTIAL_BUNDLE%' THEN RAISE EXCEPTION '(rest) missing api_key: got %', _msg; END IF;
  _msg := NULL; BEGIN PERFORM public.create_mcp_rest_connection(_label=>'rest-bad2', _base_url=>'https://restbad.example.com/x', _api_key=>'   ');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_CREDENTIAL_BUNDLE%' THEN RAISE EXCEPTION '(rest) whitespace api_key: got %', _msg; END IF;
  _msg := NULL; BEGIN PERFORM public.create_mcp_rest_connection(_label=>'rest-bad3', _base_url=>'http://restbad.example.com/x', _api_key=>'k');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_ENDPOINT%' THEN RAISE EXCEPTION '(rest) bad base_url: got %', _msg; END IF;
  _msg := NULL; BEGIN PERFORM public.create_mcp_rest_connection(_label=>'', _base_url=>'https://restbad.example.com/x', _api_key=>'k');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_LABEL%' THEN RAISE EXCEPTION '(rest) empty label: got %', _msg; END IF;
  _msg := NULL; BEGIN PERFORM public.create_mcp_rest_connection(_provider_key=>'nope', _label=>'rest-bad4', _base_url=>'https://restbad.example.com/x', _api_key=>'k');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_BAD_PROVIDER%' THEN RAISE EXCEPTION '(rest) bad provider: got %', _msg; END IF;
END $$;

-- ── (REST re-key) set_mcp_rest_connection_endpoint rotates + revokes consent + clears tools; refuses non-REST ─
DO $$
DECLARE _r jsonb; _row public.mcp_connections%ROWTYPE; _cid uuid; _bearer_cid uuid; _appr int; _tools int; _msg text;
  OLDB text := 'https://rest1.example.com/mcp-server/http';
  NEWB text := 'https://rest1-new.example.com/mcp-server/http';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  SELECT connection_id INTO _cid FROM public.mcp_connections
    WHERE tenant_id='c1a00000-0000-0000-0000-0000000000a1' AND provider_key='n8n' AND label='rest-1';

  -- seed an endpoint-bound approval + a discovered tool on the REST connection.
  INSERT INTO public.mcp_connection_approvals (connection_id, tool_name, pin, approved_by, endpoint_hash)
  VALUES (_cid, 'rest.tool', repeat('a',64), 'c1a00000-0000-0000-0000-000000000002', public._mcp_endpoint_hash(OLDB));
  INSERT INTO public.mcp_connection_tools (connection_id, tool_name, schema_hash)
  VALUES (_cid, 'rest.tool', repeat('a',64));

  _r := public.set_mcp_rest_connection_endpoint(_cid, NEWB, 'n8n-api-key-5678');
  IF (_r->>'auth_token_last4') <> '5678'
     OR (_r->>'endpoint_hash') IS DISTINCT FROM public._mcp_endpoint_hash(NEWB)
     OR (_r->>'status') <> 'pending_verification' THEN
    RAISE EXCEPTION '(rest re-key) bad return: %', _r; END IF;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _cid;
  IF _row.auth_kind <> 'api_key' OR public.platform_decrypt(_row.server_url_ct) <> NEWB
     OR public.platform_decrypt(_row.auth_token_ct) <> 'n8n-api-key-5678' THEN
    RAISE EXCEPTION '(rest re-key) row not updated'; END IF;
  SELECT count(*) INTO _appr  FROM public.mcp_connection_approvals WHERE connection_id = _cid;
  SELECT count(*) INTO _tools FROM public.mcp_connection_tools     WHERE connection_id = _cid;
  IF _appr <> 0 THEN RAISE EXCEPTION '(rest re-key) approvals not revoked: %', _appr; END IF;
  IF _tools <> 0 THEN RAISE EXCEPTION '(rest re-key) tools not cleared: %', _tools; END IF;

  -- set_mcp_rest_connection_endpoint on a NON-api_key connection (the bearer one) → MCP_NOT_A_REST_CONNECTION.
  SELECT connection_id INTO _bearer_cid FROM public.mcp_connections
    WHERE tenant_id='c1a00000-0000-0000-0000-0000000000a1' AND label='acc-bearer';
  _msg := NULL; BEGIN PERFORM public.set_mcp_rest_connection_endpoint(_bearer_cid, NEWB, 'k-1234567890');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%MCP_NOT_A_REST_CONNECTION%' THEN RAISE EXCEPTION '(rest re-key) non-REST must reject: got %', _msg; END IF;
END $$;

-- ── (disconnect: DISABLE) scrub secrets + delete live child state + idempotent; receipts untouched ──
DO $$
DECLARE _r jsonb; _row public.mcp_connections%ROWTYPE; _cid uuid; _appr int; _tools int; _rcpt int;
  T uuid := 'c1a00000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  _r := public.create_mcp_connection('generic-remote','dis-1','https://dis1.example.com/rpc','bearer','tok-dis-123456');
  _cid := (_r->>'connection_id')::uuid;
  INSERT INTO public.mcp_connection_approvals (connection_id, tool_name, pin, approved_by, endpoint_hash)
  VALUES (_cid, 'dis.tool', repeat('b',64), 'c1a00000-0000-0000-0000-000000000002', public._mcp_endpoint_hash('https://dis1.example.com/rpc'));
  INSERT INTO public.mcp_connection_tools (connection_id, tool_name, schema_hash) VALUES (_cid, 'dis.tool', repeat('b',64));
  INSERT INTO public.mcp_connection_receipts (connection_id, tenant_id, tool_name, outcome, run_id)
  VALUES (_cid, T, 'dis.tool', 'executed', gen_random_uuid());

  _r := public.disconnect_mcp_connection(_cid);   -- _hard defaults false
  IF (_r->>'disconnected') <> 'true' OR (_r->>'mode') <> 'disable' OR (_r->>'status') <> 'unconfigured' THEN
    RAISE EXCEPTION '(disable) bad return: %', _r; END IF;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _cid;
  IF _row.enabled IS NOT FALSE OR _row.auth_token_ct IS NOT NULL OR _row.refresh_token_ct IS NOT NULL
     OR _row.oauth_client_secret_ct IS NOT NULL OR _row.auth_token_last4 IS NOT NULL
     OR _row.granted_scopes <> '{}' OR _row.provider_state <> '{}'::jsonb OR _row.status <> 'unconfigured' THEN
    RAISE EXCEPTION '(disable) row not scrubbed'; END IF;
  SELECT count(*) INTO _appr  FROM public.mcp_connection_approvals WHERE connection_id = _cid;
  SELECT count(*) INTO _tools FROM public.mcp_connection_tools     WHERE connection_id = _cid;
  IF _appr <> 0 OR _tools <> 0 THEN RAISE EXCEPTION '(disable) live child state not deleted (appr=% tools=%)', _appr, _tools; END IF;
  -- the receipt (HISTORY) is untouched by a disable and still points at the connection.
  SELECT count(*) INTO _rcpt FROM public.mcp_connection_receipts WHERE connection_id = _cid;
  IF _rcpt <> 1 THEN RAISE EXCEPTION '(disable) receipt must be untouched, found %', _rcpt; END IF;

  -- idempotent second disable → already_disabled.
  _r := public.disconnect_mcp_connection(_cid);
  IF (_r->>'already_disabled') <> 'true' OR (_r->>'mode') <> 'disable' THEN
    RAISE EXCEPTION '(disable) second call must be idempotent already_disabled: %', _r; END IF;
END $$;

-- ── (disconnect: HARD DELETE, history-preserving — G1a-1 Correction 2) ───────────────────────────
DO $$
DECLARE _r jsonb; _cid uuid; _n int; _rcpt_conn uuid; _rcpt_tenant uuid; _aud int;
  T uuid := 'c1a00000-0000-0000-0000-0000000000a1'; _rid uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  _r := public.create_mcp_connection('generic-remote','del-1','https://del1.example.com/rpc','bearer','tok-del-123456');
  _cid := (_r->>'connection_id')::uuid;
  INSERT INTO public.mcp_connection_approvals (connection_id, tool_name, pin, approved_by, endpoint_hash)
  VALUES (_cid, 'del.tool', repeat('c',64), 'c1a00000-0000-0000-0000-000000000002', public._mcp_endpoint_hash('https://del1.example.com/rpc'));
  INSERT INTO public.mcp_connection_tools (connection_id, tool_name, schema_hash) VALUES (_cid, 'del.tool', repeat('c',64));
  INSERT INTO public.mcp_connection_receipts (connection_id, tenant_id, tool_name, outcome, run_id)
  VALUES (_cid, T, 'del.tool', 'executed', _rid);

  _r := public.disconnect_mcp_connection(_cid, true);   -- HARD delete (admin holds mcp.connections.delete)
  IF (_r->>'deleted') <> 'true' OR (_r->>'mode') <> 'delete' THEN RAISE EXCEPTION '(delete) bad return: %', _r; END IF;

  -- connection GONE; LIVE child state GONE (cascade).
  SELECT count(*) INTO _n FROM public.mcp_connections WHERE connection_id = _cid;
  IF _n <> 0 THEN RAISE EXCEPTION '(delete) connection row survived'; END IF;
  SELECT count(*) INTO _n FROM public.mcp_connection_approvals WHERE connection_id = _cid;
  IF _n <> 0 THEN RAISE EXCEPTION '(delete) approvals did not cascade away'; END IF;
  SELECT count(*) INTO _n FROM public.mcp_connection_tools WHERE connection_id = _cid;
  IF _n <> 0 THEN RAISE EXCEPTION '(delete) tools did not cascade away'; END IF;

  -- HISTORY survives: the receipt row still exists, connection_id SET NULL, tenant_id retained.
  SELECT connection_id, tenant_id INTO _rcpt_conn, _rcpt_tenant FROM public.mcp_connection_receipts WHERE run_id = _rid;
  IF NOT FOUND THEN RAISE EXCEPTION '(delete) receipt (HISTORY) was destroyed by the hard delete'; END IF;
  IF _rcpt_conn IS NOT NULL THEN RAISE EXCEPTION '(delete) receipt connection_id must be SET NULL, got %', _rcpt_conn; END IF;
  IF _rcpt_tenant <> T THEN RAISE EXCEPTION '(delete) receipt tenant_id must be retained'; END IF;

  -- the 'mcp_connection.deleted' audit row exists and leaks no url/token.
  SELECT count(*) INTO _aud FROM public.paige_audit_log
    WHERE action = 'mcp_connection.deleted' AND target_type = 'mcp_connections' AND target_id = _cid;
  IF _aud <> 1 THEN RAISE EXCEPTION '(delete) expected exactly one mcp_connection.deleted audit row, got %', _aud; END IF;

  -- a SECOND hard delete finds no row → uniform MCP_FORBIDDEN (no existence oracle).
  DECLARE _msg text;
  BEGIN
    _msg := NULL;
    BEGIN PERFORM public.disconnect_mcp_connection(_cid, true);
      EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
    IF _msg IS NULL OR _msg NOT LIKE '%connection not in tenant%' THEN
      RAISE EXCEPTION '(delete) second hard delete must be uniform MCP_FORBIDDEN, got %', _msg; END IF;
  END;
END $$;

-- ── (delete gate keys on the RIGHT capability) member refusals name delete/manage; platform owner excluded ─
DO $$
DECLARE _cid uuid; _msg text;
BEGIN
  -- create a fresh connection as admin for the member/owner to attempt against.
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  _cid := (public.create_mcp_connection('generic-remote','gate-1','https://gate1.example.com/rpc','none')->>'connection_id')::uuid;

  -- member (holds {}, even with a global 'coach' role, §59): HARD delete refused, message NAMES delete.
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000003","role":"authenticated"}', true);
  _msg := NULL; BEGIN PERFORM public.disconnect_mcp_connection(_cid, true);
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%delete capability required%' THEN RAISE EXCEPTION '(gate) member hard-delete must name delete: got %', _msg; END IF;
  -- ...and SOFT disable refused, message NAMES manage (proves the two gates read different capabilities).
  _msg := NULL; BEGIN PERFORM public.disconnect_mcp_connection(_cid, false);
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%manage capability required%' THEN RAISE EXCEPTION '(gate) member disable must name manage: got %', _msg; END IF;

  -- platform owner (super_admin), tenant match → still refused delete (platform owner EXCLUDED, A2).
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000004","role":"authenticated"}', true);
  _msg := NULL; BEGIN PERFORM public.disconnect_mcp_connection(_cid, true, 'c1a00000-0000-0000-0000-0000000000a1');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%delete capability required%' THEN RAISE EXCEPTION '(gate) platform owner hard-delete must be refused: got %', _msg; END IF;

  -- the connection is untouched by any refused call (still present + enabled).
  IF NOT EXISTS (SELECT 1 FROM public.mcp_connections WHERE connection_id = _cid AND enabled) THEN
    RAISE EXCEPTION '(gate) a refused disconnect changed the connection'; END IF;
END $$;

-- ── (§51 per-tier CREATE matrix) each tier resolves to its EXPECTED outcome ───────────────────────
-- §51 tier coverage — the six canonical tiers, and the assertion covering each (names the tier per row):
--   • God / platform-owner-as-itself   → REFUSED (manage EXCLUDES platform owner) — tested below (super).
--   • Agency-as-a-tenant (admin)        → own-tenant SUCCESS — same code path as the Standalone admin
--                                          success below (an agency-as-tenant is a top-level tenant whose
--                                          owner/admin holds manage for its OWN tenant, exactly like a
--                                          standalone; no separate fixture needed).
--   • Standalone tenant admin           → own-tenant SUCCESS — tested below (admin of T).
--   • Sub-account admin                 → own-tenant SUCCESS, and acting on the PARENT is mechanically the
--                                          tested cross-tenant `_tenant_id` MISMATCH refusal below (a
--                                          sub-account admin naming a foreign tenant is refused by
--                                          _mcp_resolve_tenant, §9 — the identical guard).
--   • Client (tenant_member, no manage) → REFUSED — tested below (member; §59 global-role trap holds).
--   • Anonymous                         → no EXECUTE grant at all (REVOKE ... FROM PUBLIC, anon in the
--                                          migration §4 grants) — refused by construction, before any body.
DO $$
DECLARE _msg text; _cid uuid;
  T   uuid := 'c1a00000-0000-0000-0000-0000000000a1';
BEGIN
  -- tenant admin (own) → SUCCESS.
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  _cid := (public.create_mcp_connection('generic-remote','tier-admin','https://tier-admin.example.com/rpc','none')->>'connection_id')::uuid;
  IF _cid IS NULL THEN RAISE EXCEPTION '(tier) admin create must succeed'; END IF;

  -- platform-owner-as-itself (tenant match) → MCP_FORBIDDEN (manage EXCLUDES platform owner).
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000004","role":"authenticated"}', true);
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection(_provider_key=>'generic-remote',_label=>'tier-super',_server_url=>'https://tier-super.example.com/rpc',_auth_kind=>'none',_tenant_id=>T);
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%manage capability required%' THEN RAISE EXCEPTION '(tier) platform owner must be refused: got %', _msg; END IF;

  -- member (no manage) → MCP_FORBIDDEN.
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000003","role":"authenticated"}', true);
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection('generic-remote','tier-member','https://tier-member.example.com/rpc','none');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%manage capability required%' THEN RAISE EXCEPTION '(tier) member must be refused: got %', _msg; END IF;

  -- cross-tenant _tenant_id (admin of T naming OTHER) → tenant-mismatch refusal (from _mcp_resolve_tenant).
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection(_provider_key=>'generic-remote',_label=>'tier-xt',_server_url=>'https://tier-xt.example.com/rpc',_auth_kind=>'none',_tenant_id=>'c1a00000-0000-0000-0000-0000000000a2');
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%tenant mismatch%' THEN RAISE EXCEPTION '(tier) cross-tenant must be tenant-mismatch: got %', _msg; END IF;

  -- NULL actor (no JWT) even naming the tenant → refused (no service-role bypass).
  PERFORM set_config('request.jwt.claims', '', true);
  _msg := NULL; BEGIN PERFORM public.create_mcp_connection(_provider_key=>'generic-remote',_label=>'tier-null',_server_url=>'https://tier-null.example.com/rpc',_auth_kind=>'none',_tenant_id=>T);
    EXCEPTION WHEN OTHERS THEN _msg := SQLERRM; END;
  IF _msg IS NULL OR _msg NOT LIKE '%manage capability required%' THEN RAISE EXCEPTION '(tier) NULL actor must be refused (no bypass): got %', _msg; END IF;
END $$;

-- ── (A1/A3) the created audit carries NO url/token; hashes/enums/name/last4 only ─────────────────
DO $$
DECLARE _p jsonb; _cid uuid;
  U text := 'https://audit-check.example.com/rpc';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  _cid := (public.create_mcp_connection('generic-remote','audit-1',U,'bearer','super-secret-token-ABCD')->>'connection_id')::uuid;
  SELECT payload INTO _p FROM public.paige_audit_log
    WHERE action = 'mcp_connection.created' AND target_type = 'mcp_connections' AND target_id = _cid LIMIT 1;
  IF _p IS NULL THEN RAISE EXCEPTION '(A1) no created audit row'; END IF;
  IF (_p->>'new_endpoint_hash') IS DISTINCT FROM public._mcp_endpoint_hash(U) THEN RAISE EXCEPTION '(A1) endpoint_hash wrong: %', _p; END IF;
  IF (_p->>'auth_kind') <> 'bearer' OR (_p->>'transport') <> 'http' OR (_p->>'auth_token_last4') <> 'ABCD' THEN
    RAISE EXCEPTION '(A1) enums/last4 wrong: %', _p; END IF;
  -- no URL / token substring anywhere in the payload.
  IF _p::text ~* 'audit-check\.example|https://|super-secret-token' THEN
    RAISE EXCEPTION '(A1) audit payload leaked a URL/token: %', _p; END IF;
END $$;

-- ── (P1(a) — MCP setter: a successful re-key RECONNECTS a soft-disabled connection) ───────────────
-- A soft disconnect leaves enabled=false; the endpoint setter with fresh creds must set enabled=true
-- (re-key = reconnect). Before the P1(a) fix the row stayed disabled and the secret loader returned a
-- non-usable {configured:true, enabled:false} shape.
DO $$
DECLARE _r jsonb; _row public.mcp_connections%ROWTYPE; _sec jsonb; _cid uuid;
  U1 text := 'https://rekey-oauth-1.example.com/rpc';
  U2 text := 'https://rekey-oauth-2.example.com/rpc';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);

  -- create an oauth native connection (enabled=true by construction).
  _r := public.create_mcp_connection('generic-remote','rekey-oauth',U1,'oauth',
          'tok-rk', NULL, 'refresh-rk', 'https://iss.example.com', 'cid-rk', 'sec-rk', ARRAY['read']::text[], now() + interval '1 hour');
  _cid := (_r->>'connection_id')::uuid;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _cid;
  IF _row.enabled IS NOT TRUE THEN RAISE EXCEPTION '(rekey mcp) freshly-created row must be enabled'; END IF;

  -- soft-disconnect it → enabled=false, status='unconfigured'.
  _r := public.disconnect_mcp_connection(_cid, false);
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _cid;
  IF _row.enabled IS NOT FALSE OR _row.status <> 'unconfigured' THEN
    RAISE EXCEPTION '(rekey mcp) disable must set enabled=false/status=unconfigured, got enabled=% status=%', _row.enabled, _row.status; END IF;

  -- re-key with FRESH creds (a different endpoint + a fresh bearer token) → RECONNECT.
  _r := public.set_mcp_connection_endpoint(_cid, U2, 'bearer', 'tok-fresh-9999');
  IF (_r->>'status') <> 'pending_verification' THEN RAISE EXCEPTION '(rekey mcp) return status wrong: %', _r; END IF;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _cid;
  IF _row.enabled IS NOT TRUE THEN RAISE EXCEPTION '(rekey mcp) re-key must RECONNECT (enabled=true), got %', _row.enabled; END IF;
  IF _row.status <> 'pending_verification' THEN RAISE EXCEPTION '(rekey mcp) status must be pending_verification, got %', _row.status; END IF;

  -- as the service-role probe writer, flip status→connected; the secret loader now returns a USABLE shape.
  PERFORM public.mcp_connection_probe(_cid, 'connected', 'healthy', NULL, NULL);
  _sec := public.get_mcp_connection_secret(_cid);
  IF (_sec->>'configured') <> 'true' OR (_sec->>'enabled') <> 'true'
     OR (_sec->>'server_url') <> U2 OR (_sec->>'auth_token') <> 'tok-fresh-9999'
     OR (_sec->>'auth_kind') <> 'bearer' THEN
    RAISE EXCEPTION '(rekey mcp) get_mcp_connection_secret not usable after reconnect: %', _sec; END IF;
END $$;

-- ── (P1(a) — REST setter: a successful re-key RECONNECTS a soft-disabled api_key connection) ───────
DO $$
DECLARE _r jsonb; _row public.mcp_connections%ROWTYPE; _sec jsonb; _cid uuid;
  B1 text := 'https://rekey-rest-1.example.com/mcp-server/http';
  B2 text := 'https://rekey-rest-2.example.com/mcp-server/http';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);

  _r := public.create_mcp_rest_connection(_label=>'rekey-rest', _base_url=>B1, _api_key=>'n8n-api-key-1111');
  _cid := (_r->>'connection_id')::uuid;

  -- soft-disconnect → enabled=false / status=unconfigured (auth_kind stays api_key).
  PERFORM public.disconnect_mcp_connection(_cid, false);
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _cid;
  IF _row.enabled IS NOT FALSE OR _row.status <> 'unconfigured' OR _row.auth_kind <> 'api_key' THEN
    RAISE EXCEPTION '(rekey rest) disable state wrong: enabled=% status=% kind=%', _row.enabled, _row.status, _row.auth_kind; END IF;

  -- re-key → RECONNECT.
  _r := public.set_mcp_rest_connection_endpoint(_cid, B2, 'n8n-api-key-2222');
  IF (_r->>'status') <> 'pending_verification' THEN RAISE EXCEPTION '(rekey rest) return status wrong: %', _r; END IF;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _cid;
  IF _row.enabled IS NOT TRUE THEN RAISE EXCEPTION '(rekey rest) re-key must RECONNECT (enabled=true), got %', _row.enabled; END IF;
  IF _row.status <> 'pending_verification' THEN RAISE EXCEPTION '(rekey rest) status must be pending_verification, got %', _row.status; END IF;

  PERFORM public.mcp_connection_probe(_cid, 'connected', 'healthy', NULL, NULL);
  _sec := public.get_mcp_connection_secret(_cid);
  IF (_sec->>'configured') <> 'true' OR (_sec->>'enabled') <> 'true'
     OR (_sec->>'server_url') <> B2 OR (_sec->>'auth_token') <> 'n8n-api-key-2222'
     OR (_sec->>'auth_kind') <> 'api_key' THEN
    RAISE EXCEPTION '(rekey rest) get_mcp_connection_secret not usable after reconnect: %', _sec; END IF;
END $$;

-- ── (P1(a) — no-op: re-keying an ALREADY-enabled row leaves enabled=true, no error, no flip) ───────
DO $$
DECLARE _r jsonb; _row public.mcp_connections%ROWTYPE; _cid uuid;
  U1 text := 'https://rekey-noop-1.example.com/rpc';
  U2 text := 'https://rekey-noop-2.example.com/rpc';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
  _cid := (public.create_mcp_connection('generic-remote','rekey-noop',U1,'bearer','tok-noop-123456')->>'connection_id')::uuid;
  -- the row is enabled from creation; a re-key must NOT error and must NOT flip enabled to false.
  _r := public.set_mcp_connection_endpoint(_cid, U2, 'bearer', 'tok-noop-654321');
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _cid;
  IF _row.enabled IS NOT TRUE THEN RAISE EXCEPTION '(rekey no-op) an already-enabled re-key must stay enabled=true, got %', _row.enabled; END IF;
  IF _row.status <> 'pending_verification' THEN RAISE EXCEPTION '(rekey no-op) status must be pending_verification, got %', _row.status; END IF;
END $$;

-- ── (P2 — get_mcp_connections_v2.configured is TRUE for credentialless url/none, FALSE for tokenless bearer) ─
DO $$
DECLARE _cfg text; _none_cid uuid; _url_cid uuid; _bearer_cid uuid;
  T uuid := 'c1a00000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);

  -- a 'none' connection (no credential material) → configured:true (the credential is not token-borne).
  _none_cid := (public.create_mcp_connection('generic-remote','p2-none','https://p2-none.example.com/rpc','none')->>'connection_id')::uuid;
  -- a 'url' connection (credential inside the endpoint) → configured:true.
  _url_cid  := (public.create_mcp_connection('zapier','p2-url','https://p2-url.example.com/rpc','url')->>'connection_id')::uuid;

  SELECT elem->>'configured' INTO _cfg
    FROM jsonb_array_elements(public.get_mcp_connections_v2(T)) elem
   WHERE (elem->>'connection_id')::uuid = _none_cid;
  IF _cfg IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '(p2) none-auth row must be configured:true, got %', _cfg; END IF;

  SELECT elem->>'configured' INTO _cfg
    FROM jsonb_array_elements(public.get_mcp_connections_v2(T)) elem
   WHERE (elem->>'connection_id')::uuid = _url_cid;
  IF _cfg IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '(p2) url-auth row must be configured:true, got %', _cfg; END IF;

  -- guard against over-widening: a bearer row with NO token still reports configured:false. A soft
  -- disable scrubs the bearer token (auth_token_ct→NULL) while leaving auth_kind='bearer' — the exact
  -- shape the url/none widening must NOT catch.
  _bearer_cid := (public.create_mcp_connection('generic-remote','p2-bearer','https://p2-bearer.example.com/rpc','bearer','tok-p2-123456')->>'connection_id')::uuid;
  PERFORM public.disconnect_mcp_connection(_bearer_cid, false);   -- nulls auth_token_ct, keeps auth_kind='bearer'
  SELECT elem->>'configured' INTO _cfg
    FROM jsonb_array_elements(public.get_mcp_connections_v2(T)) elem
   WHERE (elem->>'connection_id')::uuid = _bearer_cid;
  IF _cfg IS DISTINCT FROM 'false' THEN RAISE EXCEPTION '(p2) tokenless bearer row must stay configured:false, got %', _cfg; END IF;
END $$;

-- ── (P2 Codex — url-embedded credential is SCRUBBED on soft disable; non-url endpoints retained) ───
-- For auth_kind='url' the credential lives INSIDE the endpoint (server_url_ct). A soft disconnect must
-- clear it, or the disabled shell keeps a live secret that get_mcp_connections_v2's url/none widening
-- STILL reports configured:true. The fix nulls server_url_ct ONLY for a url row; every other auth_kind
-- keeps its endpoint on the disabled shell (the endpoint alone is not a credential there).
DO $$
DECLARE _cfg text; _row public.mcp_connections%ROWTYPE; _r jsonb;
  _url_cid uuid; _bearer_cid uuid; _none_cid uuid;
  T uuid := 'c1a00000-0000-0000-0000-0000000000a1';
  U  text := 'https://host.example.com/mcp/SECRETTOKEN';           -- credential embedded in the URL path
  U2 text := 'https://host2.example.com/mcp/NEWTOKEN';             -- re-key endpoint (new embedded credential)
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"c1a00000-0000-0000-0000-000000000002","role":"authenticated"}', true);

  -- create a url-auth connection: server_url_ct present (the credential), both token columns NULL.
  _url_cid := (public.create_mcp_connection('zapier','urldis-1',U,'url')->>'connection_id')::uuid;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _url_cid;
  IF _row.auth_kind <> 'url' OR _row.server_url_ct IS NULL OR _row.auth_token_ct IS NOT NULL THEN
    RAISE EXCEPTION '(url scrub) precondition wrong: kind=% url_ct_null=% token_ct_null=%',
      _row.auth_kind, (_row.server_url_ct IS NULL), (_row.auth_token_ct IS NULL); END IF;

  -- soft disconnect → the url-embedded credential (server_url_ct) is scrubbed to NULL.
  _r := public.disconnect_mcp_connection(_url_cid, false);
  IF (_r->>'disconnected') <> 'true' OR (_r->>'mode') <> 'disable' THEN
    RAISE EXCEPTION '(url scrub) bad disable return: %', _r; END IF;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _url_cid;
  IF _row.server_url_ct IS NOT NULL THEN
    RAISE EXCEPTION '(url scrub) server_url_ct must be NULL after a url disable — the credential survived'; END IF;
  IF _row.enabled IS NOT FALSE THEN RAISE EXCEPTION '(url scrub) disabled row must be enabled=false'; END IF;
  -- and the list-side reports configured:false (nothing left to be configured with).
  SELECT elem->>'configured' INTO _cfg
    FROM jsonb_array_elements(public.get_mcp_connections_v2(T)) elem
   WHERE (elem->>'connection_id')::uuid = _url_cid;
  IF _cfg IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION '(url scrub) disabled url row must report configured:false, got %', _cfg; END IF;

  -- NON-VACUITY negative control: re-populate server_url_ct IN PLACE on the SAME disabled row (the exact
  -- pre-fix shape — a disabled url row whose endpoint credential was retained). get_mcp_connections_v2's
  -- url/none widening then reports configured:true, proving the assertion above is driven by the scrub and
  -- would FAIL without the fix. Restore to NULL afterwards to leave the true post-fix disabled state.
  UPDATE public.mcp_connections SET server_url_ct = public.platform_encrypt(U) WHERE connection_id = _url_cid;
  SELECT elem->>'configured' INTO _cfg
    FROM jsonb_array_elements(public.get_mcp_connections_v2(T)) elem
   WHERE (elem->>'connection_id')::uuid = _url_cid;
  IF _cfg IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '(url scrub NEG-CONTROL) a retained server_url_ct on a disabled url row MUST report configured:true (so the scrub is what drives configured:false), got %', _cfg; END IF;
  UPDATE public.mcp_connections SET server_url_ct = NULL WHERE connection_id = _url_cid;

  -- re-key restores (P1(a)): a fresh url endpoint reconnects → enabled=true, pending_verification, configured:true.
  _r := public.set_mcp_connection_endpoint(_url_cid, U2, 'url');
  IF (_r->>'status') <> 'pending_verification' THEN RAISE EXCEPTION '(url re-key) return status wrong: %', _r; END IF;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _url_cid;
  IF _row.enabled IS NOT TRUE OR _row.status <> 'pending_verification' OR _row.server_url_ct IS NULL THEN
    RAISE EXCEPTION '(url re-key) must RECONNECT (enabled=true/pending/url present), got enabled=% status=% url_null=%',
      _row.enabled, _row.status, (_row.server_url_ct IS NULL); END IF;
  SELECT elem->>'configured' INTO _cfg
    FROM jsonb_array_elements(public.get_mcp_connections_v2(T)) elem
   WHERE (elem->>'connection_id')::uuid = _url_cid;
  IF _cfg IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '(url re-key) reconnected url row must be configured:true, got %', _cfg; END IF;

  -- NON-URL UNCHANGED (bearer): a disabled bearer row RETAINS server_url_ct (the endpoint kept on the
  -- disabled shell) — the fix must not touch non-url rows. Its token IS scrubbed, so configured stays false.
  _bearer_cid := (public.create_mcp_connection('generic-remote','urldis-bearer','https://bearer-keep.example.com/rpc','bearer','tok-keep-123456')->>'connection_id')::uuid;
  PERFORM public.disconnect_mcp_connection(_bearer_cid, false);
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _bearer_cid;
  IF _row.server_url_ct IS NULL THEN
    RAISE EXCEPTION '(non-url unchanged) a disabled BEARER row must RETAIN server_url_ct (fix must not touch non-url)'; END IF;
  IF _row.auth_token_ct IS NOT NULL THEN RAISE EXCEPTION '(non-url unchanged) bearer token must still be scrubbed'; END IF;
  SELECT elem->>'configured' INTO _cfg
    FROM jsonb_array_elements(public.get_mcp_connections_v2(T)) elem
   WHERE (elem->>'connection_id')::uuid = _bearer_cid;
  IF _cfg IS DISTINCT FROM 'false' THEN RAISE EXCEPTION '(non-url unchanged) disabled tokenless bearer must be configured:false, got %', _cfg; END IF;

  -- 'none' behavior DOCUMENTED, unchanged (coordinator scoped the scrub to 'url'): a 'none' row has NO
  -- embedded credential, so its endpoint is retained on disable and it stays configured:true. Asserted to
  -- lock the current behavior, NOT to change it.
  _none_cid := (public.create_mcp_connection('generic-remote','urldis-none','https://none-keep.example.com/rpc','none')->>'connection_id')::uuid;
  PERFORM public.disconnect_mcp_connection(_none_cid, false);
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _none_cid;
  IF _row.server_url_ct IS NULL THEN
    RAISE EXCEPTION '(none documented) a disabled NONE row must RETAIN server_url_ct (no embedded credential; fix scoped to url)'; END IF;
  SELECT elem->>'configured' INTO _cfg
    FROM jsonb_array_elements(public.get_mcp_connections_v2(T)) elem
   WHERE (elem->>'connection_id')::uuid = _none_cid;
  IF _cfg IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '(none documented) a disabled none row keeps its endpoint and stays configured:true (unchanged), got %', _cfg; END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'MCP_GW_CONNECTION_CREATE_PROVEN'; END $$;

ROLLBACK;

-- Keep the supplementary-header contract in this already-executed Linux database CI entry.
\ir mcp_connection_header_bundle.sql
-- Fixed-business intake is part of the same canonical connection contract, not a new CI workflow.
\ir mcp_connection_contact_binding.sql
