-- Canonical MCP OAuth return and completion binding. Disposable proof databases may apply this.
-- Production or any real-tenant/shared/persistent target requires Antonio Cook's named written approval.
-- Existing consent rows deliberately receive no authority backfill: they must restart.
-- Caller inventory: oauth.ts begins; oauth-callback.ts consumes/completes. No browser or other
-- provider writer uses these service-only RPCs. Old signatures are removed, not left as bypasses.
-- Deploy migration before both edge functions. Old edge revisions fail closed during this interval.
ALTER TABLE public.mcp_connection_oauth_state
  ADD COLUMN return_destination text CHECK (return_destination IN ('integrations', 'connections')),
  ADD COLUMN return_account_type text,
  ADD COLUMN return_account_number bigint,
  ADD COLUMN config_generation bigint,
  ADD COLUMN requested_scopes text[],
  ADD COLUMN completion_allowed boolean NOT NULL DEFAULT false,
  ADD COLUMN completed_at timestamptz;

DROP FUNCTION public.begin_mcp_oauth(uuid, uuid, text, text, text, text, text, text, text, uuid);
CREATE FUNCTION public.begin_mcp_oauth(
  _connection_id uuid, _tenant_id uuid, _state text, _verifier text,
  _redirect_uri text, _issuer text, _resource text DEFAULT NULL,
  _client_id text DEFAULT NULL, _client_secret text DEFAULT NULL, _actor uuid DEFAULT NULL,
  _expected_generation bigint DEFAULT NULL, _requested_scopes text[] DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _conn public.mcp_connections; _tier text; _account bigint; _destination text;
BEGIN
  IF _connection_id IS NULL OR _tenant_id IS NULL THEN
    RAISE EXCEPTION 'MCP_NO_CONNECTION' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _conn FROM public.mcp_connections WHERE connection_id = _connection_id FOR UPDATE;
  IF _conn.connection_id IS NULL OR _conn.tenant_id IS DISTINCT FROM _tenant_id THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  -- Keep the specialized n8n REST facet protected; never convert its key to OAuth.
  IF _conn.auth_kind = 'api_key' THEN
    RAISE EXCEPTION 'MCP_NOT_AN_MCP_CONNECTION' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.tenant_members
    WHERE tenant_id = _tenant_id AND user_id = _actor FOR SHARE;
  IF NOT ('mcp.connections.manage' = ANY(public._mcp_caller_capabilities(_tenant_id, _actor))) THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _conn.enabled IS NOT TRUE OR _expected_generation IS NULL
     OR _conn.config_generation IS DISTINCT FROM _expected_generation THEN
    RAISE EXCEPTION 'MCP_OAUTH_STALE' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(_state), '') = '' OR COALESCE(btrim(_verifier), '') = ''
     OR COALESCE(btrim(_redirect_uri), '') = '' OR COALESCE(btrim(_issuer), '') = ''
     OR COALESCE(btrim(_client_id), '') = '' OR COALESCE(btrim(_resource), '') = ''
     OR _requested_scopes IS NULL OR array_position(_requested_scopes, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'MCP_OAUTH_BAD_REQUEST' USING ERRCODE = '22023';
  END IF;
  SELECT account_type, account_number INTO _tier, _account FROM public.tenants WHERE id = _tenant_id;
  -- Solo owns Integrations. Preserve other mounted tiers' existing Connections return contract.
  _destination := CASE WHEN _tier IN ('solo', 'standalone') THEN 'integrations'
    WHEN _tier IN ('agency', 'sub_account') THEN 'connections' END;
  IF _destination IS NULL OR _account IS NULL THEN
    RAISE EXCEPTION 'MCP_OAUTH_RETURN_UNAVAILABLE' USING ERRCODE = '22023';
  END IF;
  -- Lock order is connection -> membership -> state everywhere. Supersede even a state whose
  -- exchange is already in flight; a newer consent must not be overwritten by the old callback.
  UPDATE public.mcp_connection_oauth_state SET completed_at = clock_timestamp(), completion_allowed = false
    WHERE connection_id = _connection_id AND completed_at IS NULL;
  -- Bound retention without taking another connection's locks during this connection's begin.
  DELETE FROM public.mcp_connection_oauth_state
    WHERE connection_id = _connection_id AND expires_at < clock_timestamp() - interval '1 hour';
  INSERT INTO public.mcp_connection_oauth_state
    (connection_id, tenant_id, state, code_verifier_ct, redirect_uri, issuer, resource,
     client_id, client_secret_ct, created_by, return_destination, return_account_type,
     return_account_number, config_generation, requested_scopes)
  VALUES
    (_connection_id, _tenant_id, _state, public.platform_encrypt(_verifier), _redirect_uri, _issuer,
     _resource, _client_id,
     CASE WHEN COALESCE(_client_secret, '') = '' THEN NULL ELSE public.platform_encrypt(_client_secret) END,
     _actor, _destination, _tier, _account, _conn.config_generation, _requested_scopes);
END;
$$;
REVOKE ALL ON FUNCTION public.begin_mcp_oauth(uuid, uuid, text, text, text, text, text, text, text, uuid, bigint, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_mcp_oauth(uuid, uuid, text, text, text, text, text, text, text, uuid, bigint, text[]) TO service_role;

DROP FUNCTION public.consume_mcp_oauth_state(text);
CREATE FUNCTION public.consume_mcp_oauth_state(_state text, _purpose text DEFAULT 'cancel')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _row public.mcp_connection_oauth_state; _conn public.mcp_connections;
BEGIN
  IF _purpose IS NULL OR _purpose NOT IN ('exchange', 'cancel') THEN
    RETURN jsonb_build_object('found', false);
  END IF;
  -- Initial lookup only determines lock ordering. Redemption below repeats every predicate.
  SELECT * INTO _row FROM public.mcp_connection_oauth_state WHERE state = _state;
  IF _row.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO _conn FROM public.mcp_connections WHERE connection_id = _row.connection_id FOR UPDATE;
  PERFORM 1 FROM public.tenant_members
    WHERE tenant_id = _row.tenant_id AND user_id = _row.created_by FOR SHARE;
  UPDATE public.mcp_connection_oauth_state
    SET consumed_at = clock_timestamp(), completion_allowed = (_purpose = 'exchange'),
        completed_at = CASE WHEN _purpose = 'cancel' THEN clock_timestamp() ELSE NULL END
    WHERE id = _row.id AND consumed_at IS NULL AND completed_at IS NULL
      AND expires_at > clock_timestamp()
    RETURNING * INTO _row;
  IF _row.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  IF _conn.connection_id IS NULL OR _conn.tenant_id IS DISTINCT FROM _row.tenant_id
     OR _conn.enabled IS NOT TRUE OR _conn.auth_kind = 'api_key'
     OR _row.config_generation IS NULL OR _conn.config_generation IS DISTINCT FROM _row.config_generation
     OR _row.return_destination IS NULL OR _row.return_account_number IS NULL
     OR _row.return_destination IS DISTINCT FROM (CASE
       WHEN _row.return_account_type IN ('solo','standalone') THEN 'integrations'
       WHEN _row.return_account_type IN ('agency','sub_account') THEN 'connections' END)
     OR _row.requested_scopes IS NULL
     OR NOT ('mcp.connections.manage' = ANY(public._mcp_caller_capabilities(_row.tenant_id, _row.created_by))) THEN
    UPDATE public.mcp_connection_oauth_state SET completed_at = clock_timestamp(), completion_allowed = false WHERE id = _row.id;
    RETURN jsonb_build_object('found', false);
  END IF;
  RETURN jsonb_build_object(
    'found', true, 'state', _row.state, 'state_id', _row.id,
    'connection_id', _row.connection_id, 'tenant_id', _row.tenant_id,
    'code_verifier', public.platform_decrypt(_row.code_verifier_ct),
    'redirect_uri', _row.redirect_uri, 'issuer', _row.issuer, 'resource', _row.resource,
    'client_id', _row.client_id,
    'client_secret', CASE WHEN _row.client_secret_ct IS NULL THEN NULL ELSE public.platform_decrypt(_row.client_secret_ct) END,
    'actor', _row.created_by, 'config_generation', _row.config_generation,
    'requested_scopes', _row.requested_scopes, 'return_destination', _row.return_destination,
    'account_type', _row.return_account_type, 'account_number', _row.return_account_number
  );
END;
$$;
REVOKE ALL ON FUNCTION public.consume_mcp_oauth_state(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_mcp_oauth_state(text, text) TO service_role;

DROP FUNCTION public.complete_mcp_oauth_grant(uuid, uuid, text, text, text, text, text, text[], timestamptz, uuid);
CREATE FUNCTION public.complete_mcp_oauth_grant(
  _connection_id uuid, _tenant_id uuid, _access_token text,
  _refresh_token text DEFAULT NULL, _oauth_issuer text DEFAULT NULL,
  _oauth_client_id text DEFAULT NULL, _oauth_client_secret text DEFAULT NULL,
  _oauth_scopes text[] DEFAULT NULL, _access_token_expires_at timestamptz DEFAULT NULL,
  _actor uuid DEFAULT NULL, _state_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _conn public.mcp_connections; _flow public.mcp_connection_oauth_state;
BEGIN
  IF _connection_id IS NULL OR _tenant_id IS NULL THEN
    RAISE EXCEPTION 'MCP_NO_CONNECTION' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _conn FROM public.mcp_connections WHERE connection_id = _connection_id FOR UPDATE;
  IF _conn.connection_id IS NULL OR _conn.tenant_id IS DISTINCT FROM _tenant_id THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _conn.auth_kind = 'api_key' THEN
    RAISE EXCEPTION 'MCP_NOT_AN_MCP_CONNECTION' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.tenant_members WHERE tenant_id = _tenant_id AND user_id = _actor FOR SHARE;
  SELECT * INTO _flow FROM public.mcp_connection_oauth_state WHERE id = _state_id FOR UPDATE;
  IF _flow.id IS NULL OR _flow.connection_id IS DISTINCT FROM _connection_id
     OR _flow.tenant_id IS DISTINCT FROM _tenant_id OR _flow.created_by IS DISTINCT FROM _actor
     OR _actor IS NULL
     OR NOT ('mcp.connections.manage' = ANY(public._mcp_caller_capabilities(_tenant_id, _flow.created_by))) THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _conn.enabled IS NOT TRUE OR _flow.config_generation IS NULL
     OR _conn.config_generation IS DISTINCT FROM _flow.config_generation
     OR _flow.consumed_at IS NULL OR _flow.completed_at IS NOT NULL
     OR _flow.completion_allowed IS NOT TRUE OR _flow.expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'MCP_OAUTH_STALE' USING ERRCODE = '22023';
  END IF;
  IF _oauth_issuer IS DISTINCT FROM _flow.issuer OR _oauth_client_id IS DISTINCT FROM _flow.client_id
     OR NULLIF(_oauth_client_secret, '') IS DISTINCT FROM
       (CASE WHEN _flow.client_secret_ct IS NULL THEN NULL ELSE public.platform_decrypt(_flow.client_secret_ct) END)
     OR _flow.requested_scopes IS NULL
     OR array_position(_oauth_scopes, NULL) IS NOT NULL
     -- Empty requested set means no scope parameter: OAuth permits provider-default scopes.
     -- Preserve the provider's returned scopes as facts, never as tool execution permission.
     OR (cardinality(_flow.requested_scopes) > 0 AND NOT (COALESCE(_oauth_scopes, '{}'::text[]) <@ _flow.requested_scopes)) THEN
    RAISE EXCEPTION 'MCP_BAD_CREDENTIAL_BUNDLE' USING ERRCODE = '22023';
  END IF;
  PERFORM public._mcp_assert_credential_bundle(
    'oauth', _access_token, NULL, _refresh_token, _oauth_issuer, _oauth_client_id,
    _oauth_client_secret, _oauth_scopes, _access_token_expires_at
  );
  UPDATE public.mcp_connections SET
    auth_kind = 'oauth', auth_token_ct = public.platform_encrypt(_access_token),
    refresh_token_ct = CASE WHEN COALESCE(btrim(_refresh_token), '') = '' THEN NULL ELSE public.platform_encrypt(_refresh_token) END,
    oauth_issuer = _flow.issuer, oauth_client_id = _flow.client_id,
    oauth_client_secret_ct = _flow.client_secret_ct,
    oauth_scopes = COALESCE(_oauth_scopes, '{}'), granted_scopes = COALESCE(_oauth_scopes, '{}'),
    access_token_expires_at = _access_token_expires_at, auth_header_name = NULL,
    status = 'pending_verification', health = 'unknown', last_error_code = NULL, updated_at = now()
    WHERE connection_id = _connection_id;
  UPDATE public.mcp_connection_oauth_state SET completed_at = clock_timestamp(), completion_allowed = false WHERE id = _flow.id;
  RETURN jsonb_build_object('connection_id', _connection_id, 'status', 'pending_verification',
    'account_type', _flow.return_account_type, 'account_number', _flow.return_account_number);
END;
$$;
REVOKE ALL ON FUNCTION public.complete_mcp_oauth_grant(uuid, uuid, text, text, text, text, text, text[], timestamptz, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mcp_oauth_grant(uuid, uuid, text, text, text, text, text, text[], timestamptz, uuid, uuid) TO service_role;
