-- The OAuth flow could destroy an n8n API key, and only one direction of the conversion was guarded.
--
-- THE DEFECT, measured rather than inferred. `set_mcp_rest_connection_endpoint` refuses a
-- connection whose auth_kind is not 'api_key' (20270331000000:788-790) and says why in terms:
-- "so an MCP-executable connection cannot be silently converted into a non-MCP REST facet."
-- The opposite direction had NO such precondition. `complete_mcp_oauth_grant` sets
-- auth_kind = 'oauth' and overwrites auth_token_ct unconditionally (20270333000000:103-105), and
-- `begin_mcp_oauth` checked only that the connection was in the caller's tenant.
--
-- CONSEQUENCE. A tenant admin could start the gateway's OAuth flow against their OWN n8n
-- API-key connection, complete provider consent, and have the callback overwrite the encrypted
-- key with a provider token. `auth_token_ct` is write-only — nothing reads it back to a person —
-- so the key is unrecoverable and must be reissued at n8n. No cross-tenant exposure: every
-- existing tenant gate holds, and this is a tenant destroying its own credential.
--
-- REACHABILITY, stated honestly. The UI does not offer it: "Sign in again" renders only for an
-- OAuth row (settings-integrations-gateway.tsx, gated on isOAuth). The edge door is reachable by
-- any admin of that tenant with the connection id, which their own list response carries.
-- Production holds one connected api_key row today, so this is live rather than theoretical.
--
-- THE FIX is the symmetry that was missing, applied in BOTH places rather than one: `begin` so a
-- flow never starts and the person is refused before being sent to a provider, and `complete` as
-- the backstop, because it is service-role and JWT-less and a row's facet could change while a
-- flow is in the air. Defence in depth, not one gate chosen over the other.
--
-- §37 PRODUCER INVENTORY, walked before narrowing a contract. `complete_mcp_oauth_grant` has ONE
-- production caller, _shared/mcp-gateway/oauth-callback.ts:171. `begin_mcp_oauth` has ONE,
-- _shared/mcp-gateway/oauth.ts:146. Both are the gateway's own OAuth flow, which no api_key row
-- has any legitimate reason to enter. The rest are this repo's own pgTAP tests and a captured
-- stub in scripts/mcp-gateway-smoke.mjs. No cron, trigger, workflow, webhook or external provider
-- calls either function. Nothing legitimate is narrowed.
--
-- BODIES ARE REPRODUCED VERBATIM from 20270332000000 and 20270333000000 with only the guard and
-- its declaration added, because plpgsql has no partial amendment and a hand-retyped body is how
-- an unrelated line changes by accident.

CREATE OR REPLACE FUNCTION public.begin_mcp_oauth(
  _connection_id uuid,
  _tenant_id     uuid,
  _state         text,
  _verifier      text,
  _redirect_uri  text,
  _issuer        text,
  _resource      text DEFAULT NULL,
  _client_id     text DEFAULT NULL,
  _client_secret text DEFAULT NULL,
  _actor         uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _conn_tenant    uuid;
  _conn_auth_kind text;
BEGIN
  IF _connection_id IS NULL OR _tenant_id IS NULL THEN
    RAISE EXCEPTION 'MCP_NO_CONNECTION' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(_state), '') = '' OR COALESCE(btrim(_verifier), '') = ''
     OR COALESCE(btrim(_redirect_uri), '') = '' OR COALESCE(btrim(_issuer), '') = ''
     OR COALESCE(btrim(_client_id), '') = '' THEN
    RAISE EXCEPTION 'MCP_OAUTH_BAD_REQUEST' USING ERRCODE = '22023';
  END IF;

  -- §9/§59: the flow may only be started for a connection that is actually in the passed tenant.
  SELECT tenant_id INTO _conn_tenant FROM public.mcp_connections WHERE connection_id = _connection_id;
  IF _conn_tenant IS NULL OR _conn_tenant <> _tenant_id THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN: connection not in tenant' USING ERRCODE = '42501';
  END IF;

  -- THE FACET GATE (added 2026-09-24). An `api_key` connection is the n8n REST facet: it has no
  -- OAuth flow, and its credential is a key the tenant pasted and can never read back. Starting a
  -- consent flow against one can only end by overwriting that key with a provider token.
  --
  -- The symmetric refusal has existed since 20270331000000:788-790, where the REST endpoint setter
  -- refuses a connection of any other auth_kind so that "an MCP-executable connection cannot be
  -- silently converted into a non-MCP REST facet". Only one direction was ever guarded. This is
  -- the other one.
  --
  -- The set mirrors MCP_EXECUTABLE_AUTH_KINDS in _shared/mcp-gateway/connection.ts, so `url`,
  -- `none`, `bearer` and `header` rows keep every path they have today; `api_key` is the only
  -- value this refuses, and it is the only one that has no OAuth flow to begin with.
  --
  -- ORDER MATTERS: this sits AFTER the tenant check above, so a caller probing a connection in
  -- another tenant still gets the tenant refusal and learns nothing about the row's shape.
  SELECT auth_kind INTO _conn_auth_kind FROM public.mcp_connections WHERE connection_id = _connection_id;
  IF _conn_auth_kind = 'api_key' THEN
    RAISE EXCEPTION 'MCP_NOT_AN_MCP_CONNECTION' USING ERRCODE = '22023';
  END IF;

  -- Only one un-consumed flow at a time per connection. A second attempt replaces the first rather
  -- than leaving an older, still-redeemable state behind.
  DELETE FROM public.mcp_connection_oauth_state
   WHERE connection_id = _connection_id AND consumed_at IS NULL;

  -- Opportunistic cleanup of anything aged out anywhere. This table is small and write-rare, so an
  -- expired verifier does not sit at rest waiting for a retention job that does not exist yet.
  DELETE FROM public.mcp_connection_oauth_state WHERE expires_at < now() - interval '1 hour';

  INSERT INTO public.mcp_connection_oauth_state
    (connection_id, tenant_id, state, code_verifier_ct, redirect_uri, issuer, resource,
     client_id, client_secret_ct, created_by)
  VALUES
    (_connection_id, _tenant_id, _state, public.platform_encrypt(_verifier), _redirect_uri, _issuer,
     NULLIF(btrim(COALESCE(_resource, '')), ''), _client_id,
     CASE WHEN _client_secret IS NULL OR _client_secret = '' THEN NULL
          ELSE public.platform_encrypt(_client_secret) END,
     _actor);
END;
$$;

REVOKE ALL ON FUNCTION public.begin_mcp_oauth(uuid, uuid, text, text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_mcp_oauth(uuid, uuid, text, text, text, text, text, text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_mcp_oauth_grant(
  _connection_id           uuid,
  _tenant_id               uuid,
  _access_token            text,
  _refresh_token           text        DEFAULT NULL,
  _oauth_issuer            text        DEFAULT NULL,
  _oauth_client_id         text        DEFAULT NULL,
  _oauth_client_secret     text        DEFAULT NULL,
  _oauth_scopes            text[]      DEFAULT NULL,
  _access_token_expires_at timestamptz DEFAULT NULL,
  _actor                   uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _conn         public.mcp_connections;
  _account_type text;
  _account_num  bigint;
BEGIN
  IF _connection_id IS NULL OR _tenant_id IS NULL THEN
    RAISE EXCEPTION 'MCP_NO_CONNECTION' USING ERRCODE = '22023';
  END IF;

  -- §9/§59: the connection this grant lands on must actually be in the passed tenant. The tenant came
  -- from a consumed single-use OAuth state, but this writer never trusts that alone — it proves it here.
  -- FOR UPDATE serializes against a concurrent INT-152 probe (which also locks the row), so the re-key
  -- and a verify cannot interleave a stale write. A missing/foreign row is MCP_FORBIDDEN — the same
  -- closed refusal begin_mcp_oauth uses; no cross-tenant oracle.
  SELECT * INTO _conn FROM public.mcp_connections
   WHERE connection_id = _connection_id FOR UPDATE;
  IF _conn.connection_id IS NULL OR _conn.tenant_id IS DISTINCT FROM _tenant_id THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN: connection not in tenant' USING ERRCODE = '42501';
  END IF;

  -- THE FACET GATE (added 2026-09-24). An `api_key` connection is the n8n REST facet: it has no
  -- OAuth flow, and its credential is a key the tenant pasted and can never read back. Starting a
  -- consent flow against one can only end by overwriting that key with a provider token.
  --
  -- The symmetric refusal has existed since 20270331000000:788-790, where the REST endpoint setter
  -- refuses a connection of any other auth_kind so that "an MCP-executable connection cannot be
  -- silently converted into a non-MCP REST facet". Only one direction was ever guarded. This is
  -- the other one.
  --
  -- The set mirrors MCP_EXECUTABLE_AUTH_KINDS in _shared/mcp-gateway/connection.ts, so `url`,
  -- `none`, `bearer` and `header` rows keep every path they have today; `api_key` is the only
  -- value this refuses, and it is the only one that has no OAuth flow to begin with.
  --
  -- ORDER MATTERS: this sits AFTER the tenant check above, so a caller probing a connection in
  -- another tenant still gets the tenant refusal and learns nothing about the row's shape.
  IF _conn.auth_kind = 'api_key' THEN
    RAISE EXCEPTION 'MCP_NOT_AN_MCP_CONNECTION' USING ERRCODE = '22023';
  END IF;

  -- §59: the caller-supplied _actor is NEVER trusted as tenant-legitimate. A provider redirect has no
  -- authenticated user, so the sole caller (mcp-oauth-callback) passes _actor = NULL and this is skipped.
  -- But because the parameter EXISTS and is caller-supplied, a mismatched actor must not be able to buy
  -- attribution: when non-null it MUST be an active member of the passed tenant, else the same uniform
  -- MCP_FORBIDDEN. This closes the "caller-supplied _actor" surface the way the tenant check closes the
  -- connection surface — proven now (a future authenticated re-auth path may pass a real member).
  IF _actor IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant_id AND user_id = _actor AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN: actor not a member of the tenant' USING ERRCODE = '42501';
  END IF;

  -- §18: validate the oauth bundle through the ONE home (the exact check create/set use). It REQUIRES
  -- an access token + issuer + client_id (F3 — the runtime has no refresh step, so a refresh-only grant
  -- loads unusable), REJECTS a custom header name (that is the 'header' scheme), and REJECTS an already
  -- EXPIRED access token. A freshly-exchanged token passes; a broken exchange can never persist an
  -- unusable grant. RAISEs a closed code (MCP_BAD_CREDENTIAL_BUNDLE / MCP_OAUTH_TOKEN_EXPIRED), never a
  -- value. scopes are optional-additional for oauth, so passing the granted set here is accepted.
  PERFORM public._mcp_assert_credential_bundle(
    'oauth', _access_token, NULL, _refresh_token,
    _oauth_issuer, _oauth_client_id, _oauth_client_secret, _oauth_scopes, _access_token_expires_at
  );

  -- Persist the grant: re-key to oauth, store the tokens ENCRYPTED, clear the header-scheme field, and
  -- reset to pending_verification/unknown so the already-shipped verify action probes the live endpoint
  -- with the new token (a granted token is not yet a proven connection). trg_mcp_bump_config_generation
  -- fires on this UPDATE (auth_kind / credentials / oauth-* / status→pending_verification all change),
  -- so any probe still in flight against the OLD config no-ops (INT-152) instead of clobbering this grant.
  -- oauth_scopes AND granted_scopes both record the granted set: what the connection actually holds
  -- (granted_scopes is what refreshTokens re-asserts; oauth_scopes is the config-identity record).
  UPDATE public.mcp_connections SET
    auth_kind               = 'oauth',
    auth_token_ct           = public.platform_encrypt(_access_token),
    refresh_token_ct        = CASE WHEN _refresh_token IS NULL OR btrim(_refresh_token) = '' THEN NULL
                                   ELSE public.platform_encrypt(_refresh_token) END,
    oauth_issuer            = _oauth_issuer,
    oauth_client_id         = _oauth_client_id,
    oauth_client_secret_ct  = CASE WHEN _oauth_client_secret IS NULL OR btrim(_oauth_client_secret) = '' THEN NULL
                                   ELSE public.platform_encrypt(_oauth_client_secret) END,
    -- granted_scopes is NOT NULL (20270319000000: text[] NOT NULL DEFAULT '{}'); oauth_scopes is
    -- nullable. COALESCE both to '{}' so a grant whose response omitted `scope` (tokens.scopes = [], or
    -- a caller passing NULL) records an empty set rather than violating the NOT NULL constraint — and the
    -- two stay consistent ("both record the granted set"). The callback always passes an array, so this
    -- is defense the pgTAP exercises directly via a NULL-scopes call.
    oauth_scopes            = COALESCE(_oauth_scopes, '{}'),
    granted_scopes          = COALESCE(_oauth_scopes, '{}'),
    access_token_expires_at = _access_token_expires_at,
    auth_header_name        = NULL,
    status                  = 'pending_verification',
    health                  = 'unknown',
    last_error_code         = NULL,
    updated_at              = now()
  WHERE connection_id = _connection_id;

  -- Non-secret ROUTING facts for the callback's landing redirect (the just-connected tenant's own
  -- Connections page, resolved by resolveCanonicalAppPath). Returned here so the JWT-less callback needs
  -- only this one rpc — no second .from() read — keeping the callback fully headless-provable (§32). An
  -- address, never a grant (§9/§65): the mounted shell still resolves session + tenant server-side.
  SELECT account_type, account_number INTO _account_type, _account_num
    FROM public.tenants WHERE id = _tenant_id;

  RETURN jsonb_build_object(
    'connection_id', _connection_id,
    'status', 'pending_verification',
    'account_type', _account_type,
    'account_number', _account_num
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_mcp_oauth_grant(uuid, uuid, text, text, text, text, text, text[], timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mcp_oauth_grant(uuid, uuid, text, text, text, text, text, text[], timestamptz, uuid) TO service_role;
