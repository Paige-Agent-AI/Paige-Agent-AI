-- Extend the existing encrypted MCP bundle; no new secret store, provider call, or backfill.
-- DELETED: old create/set overloads, replaced by one signature each with a defaulted header argument.
-- Existing callers bind unchanged. Callers: canonical gateway/create, useMcpGateway re-key,
-- SQL tests, and RPC consumers; no persisted SQL-language dependent views/triggers.
-- Rollback: restore the previous seven function definitions and writer grants from main,
-- then drop custom_headers_ct/helper. Dropping the column destroys newly saved header values:
-- rollback is NOT data-reversible without an encrypted backup and requires owner authorization.
BEGIN;
ALTER TABLE public.mcp_connections ADD COLUMN custom_headers_ct bytea;
COMMENT ON COLUMN public.mcp_connections.custom_headers_ct IS
  'Supplementary MCP request headers encrypted by platform_encrypt; service-only loader. Never provider_state or audit.';
-- Canonical supplementary headers: private values, no raw input in errors or audit.
-- Same wire limits as mcp-client.ts. Reserved names belong to the transport, not a connection.
CREATE FUNCTION public._mcp_assert_custom_headers(_headers jsonb, _primary_name text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $$
DECLARE _entry record; _seen text[] := '{}'; _name text; _value text; _bytes integer := 0;
BEGIN
  IF _headers IS NULL OR jsonb_typeof(_headers) <> 'object' THEN
    RAISE EXCEPTION 'MCP_BAD_CREDENTIAL_BUNDLE' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(_headers)) > 16 THEN
    RAISE EXCEPTION 'MCP_BAD_CREDENTIAL_BUNDLE' USING ERRCODE='22023';
  END IF;
  FOR _entry IN SELECT * FROM jsonb_each(_headers) LOOP
    _name := lower(_entry.key);
    IF length(_entry.key) > 64 OR _entry.key !~ '^[A-Za-z0-9!#$%&''*+.^_`|~-]+$'
      OR _name = ANY(_seen) OR _name = lower(_primary_name)
      OR _name ~ '^(proxy-|sec-|x-forwarded-)'
      OR _name = ANY(ARRAY['authorization','content-type','accept','mcp-protocol-version','mcp-session-id',
        'host','content-length','connection','transfer-encoding','forwarded','via','origin','referer',
        'cookie','set-cookie','te','trailer','upgrade','accept-encoding'])
      OR jsonb_typeof(_entry.value) <> 'string'
    THEN RAISE EXCEPTION 'MCP_BAD_CREDENTIAL_BUNDLE' USING ERRCODE='22023'; END IF;
    _value := _entry.value #>> '{}';
    IF length(_value) < 1 OR length(_value) > 4096 OR _value COLLATE "C" !~ '^[ -~]+$'
      OR btrim(_value) <> _value
    THEN RAISE EXCEPTION 'MCP_BAD_CREDENTIAL_BUNDLE' USING ERRCODE='22023'; END IF;
    _seen := array_append(_seen,_name);
    _bytes := _bytes + octet_length(_entry.key) + octet_length(_value);
  END LOOP;
  IF _bytes > 16384 THEN RAISE EXCEPTION 'MCP_BAD_CREDENTIAL_BUNDLE' USING ERRCODE='22023'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._mcp_assert_custom_headers(jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._mcp_assert_custom_headers(jsonb,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public._mcp_bump_config_generation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.server_url_ct           IS DISTINCT FROM OLD.server_url_ct
     OR NEW.custom_headers_ct    IS DISTINCT FROM OLD.custom_headers_ct
     OR NEW.auth_token_ct        IS DISTINCT FROM OLD.auth_token_ct
     OR NEW.refresh_token_ct     IS DISTINCT FROM OLD.refresh_token_ct
     OR NEW.oauth_client_secret_ct IS DISTINCT FROM OLD.oauth_client_secret_ct
     OR NEW.auth_kind            IS DISTINCT FROM OLD.auth_kind
     OR NEW.auth_header_name     IS DISTINCT FROM OLD.auth_header_name
     OR NEW.oauth_issuer         IS DISTINCT FROM OLD.oauth_issuer
     OR NEW.oauth_client_id      IS DISTINCT FROM OLD.oauth_client_id
     OR NEW.oauth_scopes         IS DISTINCT FROM OLD.oauth_scopes
     OR NEW.access_token_expires_at IS DISTINCT FROM OLD.access_token_expires_at
     OR (NEW.status IS DISTINCT FROM OLD.status
         AND NEW.status IN ('pending_verification', 'unconfigured'))
  THEN
    NEW.config_generation := OLD.config_generation + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.get_mcp_connection_secret(
  _connection_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _row public.mcp_connections;
BEGIN
  IF _connection_id IS NULL THEN RAISE EXCEPTION 'MCP_NO_CONNECTION' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _row FROM public.mcp_connections WHERE connection_id = _connection_id;
  IF _row.connection_id IS NULL OR _row.server_url_ct IS NULL
     OR (_row.auth_token_ct IS NULL AND _row.refresh_token_ct IS NULL AND _row.auth_kind NOT IN ('none', 'url')) THEN
    RETURN jsonb_build_object('configured', false);
  END IF;
  IF _row.enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('configured', true, 'enabled', false);
  END IF;
  RETURN jsonb_build_object(
    'configured', true, 'enabled', true,
    'connection_id', _row.connection_id, 'tenant_id', _row.tenant_id,
    'provider_key', _row.provider_key,
    'server_url', public.platform_decrypt(_row.server_url_ct),
    'endpoint_hash', public._mcp_endpoint_hash(public.platform_decrypt(_row.server_url_ct)),
    'auth_token', CASE WHEN _row.auth_token_ct IS NULL THEN NULL ELSE public.platform_decrypt(_row.auth_token_ct) END,
    'refresh_token', CASE WHEN _row.refresh_token_ct IS NULL THEN NULL ELSE public.platform_decrypt(_row.refresh_token_ct) END,
    'auth_kind', _row.auth_kind,
    'auth_header_name', _row.auth_header_name,
    'custom_headers', COALESCE(public.platform_decrypt(_row.custom_headers_ct)::jsonb, '{}'::jsonb),
    'expires_at', _row.access_token_expires_at,
    'oauth_issuer', _row.oauth_issuer,
    'oauth_client_id', _row.oauth_client_id,
    'oauth_client_secret', CASE WHEN _row.oauth_client_secret_ct IS NULL THEN NULL ELSE public.platform_decrypt(_row.oauth_client_secret_ct) END,
    'transport', _row.transport,
    'granted_scopes', _row.granted_scopes,
    'visibility', _row.visibility,
    'config_generation', _row.config_generation
  );
END;
$$;
-- Replace signatures rather than keeping ambiguous PostgREST overloads.
DROP FUNCTION public.set_mcp_connection_endpoint(uuid, text, text, text, text, text, text, text, text, text[], timestamptz, uuid);
CREATE OR REPLACE FUNCTION public.set_mcp_connection_endpoint(
  _connection_id           uuid,
  _server_url              text,
  _auth_kind               text,
  _auth_token              text        DEFAULT NULL,
  _auth_header_name        text        DEFAULT NULL,
  _refresh_token           text        DEFAULT NULL,
  _oauth_issuer            text        DEFAULT NULL,
  _oauth_client_id         text        DEFAULT NULL,
  _oauth_client_secret     text        DEFAULT NULL,
  _oauth_scopes            text[]      DEFAULT NULL,
  _access_token_expires_at timestamptz DEFAULT NULL,
  _tenant_id               uuid        DEFAULT NULL,
  _custom_headers          jsonb       DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _conn               public.mcp_connections%ROWTYPE;
  _tenant             uuid;
  _old_hash           text;
  _new_hash           text;
  _new_last4          text;
  _old_last4          text;      -- round-6 cont.: redacted before-hint (>=12-char last4 only), from _old_token
  _old_token          text;      -- decrypted in-definer to derive _credential_changed AND _old_last4; PLAINTEXT never logged
  _old_refresh        text;      -- ditto
  _old_client_secret  text;      -- ditto
  _endpoint_changed   boolean;
  _credential_changed boolean;
  _approvals_revoked  integer := 0;
  _tools_cleared      integer := 0;
BEGIN
  IF _connection_id IS NULL THEN
    RAISE EXCEPTION 'MCP_NO_CONNECTION' USING ERRCODE = '22023';
  END IF;

  _tenant := public._mcp_resolve_tenant(_tenant_id, false);
  IF NOT ('mcp.connections.manage' = ANY(public._mcp_caller_capabilities(_tenant, auth.uid()))) THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN: mcp.connections.manage capability required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _conn FROM public.mcp_connections WHERE connection_id = _connection_id FOR UPDATE;
  IF _conn.connection_id IS NULL OR _conn.tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN: connection not in tenant' USING ERRCODE = '42501';
  END IF;

  IF _conn.legacy_source IS NOT NULL THEN
    RAISE EXCEPTION 'MCP_LEGACY_CONNECTION_READONLY: managed by the legacy connection path' USING ERRCODE = '42501';
  END IF;

  IF _auth_kind IS NULL OR _auth_kind NOT IN ('oauth','bearer','header','api_key','url','none') THEN
    RAISE EXCEPTION 'MCP_BAD_AUTH_KIND' USING ERRCODE = '22023';
  END IF;
  IF _auth_kind = 'api_key' THEN
    RAISE EXCEPTION 'MCP_AUTH_KIND_NOT_EXECUTABLE' USING ERRCODE = '22023';   -- closed code; never echoes a value
  END IF;
  IF NOT public._mcp_endpoint_write_safe(_server_url) THEN
    RAISE EXCEPTION 'MCP_BAD_ENDPOINT' USING ERRCODE = '22023';   -- closed code; never echoes the URL
  END IF;

  PERFORM public._mcp_assert_credential_bundle(
            _auth_kind, _auth_token, _auth_header_name, _refresh_token,
            _oauth_issuer, _oauth_client_id, _oauth_client_secret, _oauth_scopes, _access_token_expires_at);
  PERFORM public._mcp_assert_custom_headers(_custom_headers, CASE WHEN _auth_kind='header' THEN _auth_header_name END);

  _old_hash  := CASE WHEN _conn.server_url_ct IS NULL THEN NULL
                     ELSE public._mcp_endpoint_hash(public.platform_decrypt(_conn.server_url_ct)) END;
  _new_hash  := public._mcp_endpoint_hash(_server_url);
  _new_last4 := CASE WHEN _auth_token IS NULL OR length(_auth_token) < 12 THEN NULL ELSE right(_auth_token, 4) END;

  _old_token          := CASE WHEN _conn.auth_token_ct IS NULL THEN NULL
                              ELSE public.platform_decrypt(_conn.auth_token_ct) END;
  _old_refresh        := CASE WHEN _conn.refresh_token_ct IS NULL THEN NULL
                              ELSE public.platform_decrypt(_conn.refresh_token_ct) END;
  _old_client_secret  := CASE WHEN _conn.oauth_client_secret_ct IS NULL THEN NULL
                              ELSE public.platform_decrypt(_conn.oauth_client_secret_ct) END;
  _old_last4          := CASE WHEN _old_token IS NULL OR length(_old_token) < 12 THEN NULL ELSE right(_old_token, 4) END;
  _endpoint_changed   := _old_hash IS DISTINCT FROM _new_hash;
  _credential_changed :=
       _conn.auth_kind               IS DISTINCT FROM _auth_kind
    OR _conn.auth_header_name        IS DISTINCT FROM _auth_header_name
    OR COALESCE(public.platform_decrypt(_conn.custom_headers_ct)::jsonb, '{}'::jsonb) IS DISTINCT FROM _custom_headers
    OR _old_token                    IS DISTINCT FROM _auth_token
    OR _old_refresh                  IS DISTINCT FROM _refresh_token
    OR _conn.oauth_issuer            IS DISTINCT FROM _oauth_issuer
    OR _conn.oauth_client_id         IS DISTINCT FROM _oauth_client_id
    OR _old_client_secret            IS DISTINCT FROM _oauth_client_secret
    OR _conn.oauth_scopes            IS DISTINCT FROM _oauth_scopes
    OR _conn.access_token_expires_at IS DISTINCT FROM _access_token_expires_at;

  DELETE FROM public.mcp_connection_approvals WHERE connection_id = _connection_id;
  GET DIAGNOSTICS _approvals_revoked = ROW_COUNT;

  DELETE FROM public.mcp_connection_tools WHERE connection_id = _connection_id;
  GET DIAGNOSTICS _tools_cleared = ROW_COUNT;

  UPDATE public.mcp_connections SET
    server_url_ct           = public.platform_encrypt(_server_url),
    auth_kind               = _auth_kind,
    auth_header_name        = _auth_header_name,
    auth_token_ct           = CASE WHEN _auth_token IS NULL THEN NULL ELSE public.platform_encrypt(_auth_token) END,
    auth_token_last4        = _new_last4,
    custom_headers_ct      = CASE WHEN _custom_headers = '{}'::jsonb THEN NULL ELSE public.platform_encrypt(_custom_headers::text) END,
    refresh_token_ct        = CASE WHEN _refresh_token IS NULL THEN NULL ELSE public.platform_encrypt(_refresh_token) END,
    oauth_issuer            = _oauth_issuer,
    oauth_client_id         = _oauth_client_id,
    oauth_client_secret_ct  = CASE WHEN _oauth_client_secret IS NULL THEN NULL ELSE public.platform_encrypt(_oauth_client_secret) END,
    oauth_scopes            = _oauth_scopes,
    granted_scopes          = '{}',                       -- the old grant ceiling is void on re-bind
    provider_state          = '{}'::jsonb,                -- old-endpoint operational state does not carry over
    access_token_expires_at = _access_token_expires_at,
    enabled                 = true,                       -- P1(a): a successful re-key RECONNECTS. Re-keying an
    status                  = 'pending_verification',
    health                  = 'unknown',
    last_error_code         = NULL,
    last_checked_at         = NULL,               -- the old endpoint's observation time must not carry over
    updated_by              = auth.uid(),
    updated_at              = now()
  WHERE connection_id = _connection_id;

  INSERT INTO public.paige_audit_log (actor_user_id, tenant_id, action, target_type, target_id, payload)
  VALUES (
    auth.uid(), _conn.tenant_id, 'mcp_connection.endpoint_changed', 'mcp_connections', _connection_id,
    jsonb_build_object(
      'old_endpoint_hash',        _old_hash,
      'new_endpoint_hash',        _new_hash,
      'endpoint_changed',         _endpoint_changed,
      'credential_changed',       _credential_changed,
      'auth_kind_before',         _conn.auth_kind,
      'auth_kind_after',          _auth_kind,
      'auth_token_last4_before',  _old_last4,
      'auth_token_last4_after',   _new_last4,
      'approvals_revoked',        _approvals_revoked,
      'tools_cleared',            _tools_cleared
    )
  );

  RETURN jsonb_build_object(
    'connection_id',    _connection_id,
    'status',           'pending_verification',
    'endpoint_hash',    _new_hash,
    'auth_token_last4', _new_last4,
    'address_configured', true,
    'credentials_configured', (_auth_token IS NOT NULL OR _refresh_token IS NOT NULL OR _auth_kind='url' OR _custom_headers <> '{}'::jsonb),
    'custom_header_count', (SELECT count(*) FROM jsonb_object_keys(_custom_headers)),
    'config_generation', (SELECT config_generation FROM public.mcp_connections WHERE connection_id = _connection_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.set_mcp_connection_endpoint(uuid, text, text, text, text, text, text, text, text, text[], timestamptz, uuid, jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_mcp_connection_endpoint(uuid, text, text, text, text, text, text, text, text, text[], timestamptz, uuid, jsonb) TO authenticated;
DROP FUNCTION public.create_mcp_connection(text, text, text, text, text, text, text, text, text, text, text[], timestamptz, text, uuid);
CREATE OR REPLACE FUNCTION public.create_mcp_connection(
  _provider_key            text,
  _label                   text,
  _server_url              text,
  _auth_kind               text,
  _auth_token              text        DEFAULT NULL,
  _auth_header_name        text        DEFAULT NULL,
  _refresh_token           text        DEFAULT NULL,
  _oauth_issuer            text        DEFAULT NULL,
  _oauth_client_id         text        DEFAULT NULL,
  _oauth_client_secret     text        DEFAULT NULL,
  _oauth_scopes            text[]      DEFAULT NULL,
  _access_token_expires_at timestamptz DEFAULT NULL,
  _visibility              text        DEFAULT 'tenant',
  _tenant_id               uuid        DEFAULT NULL,
  _custom_headers          jsonb       DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tenant    uuid;
  _new_id    uuid;
  _new_hash  text;
  _new_last4 text;
BEGIN
  _tenant := public._mcp_resolve_tenant(_tenant_id, false);
  IF NOT ('mcp.connections.manage' = ANY(public._mcp_caller_capabilities(_tenant, auth.uid()))) THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN: mcp.connections.manage capability required' USING ERRCODE = '42501';
  END IF;

  IF btrim(COALESCE(_label, '')) = '' THEN
    RAISE EXCEPTION 'MCP_BAD_LABEL' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mcp_providers WHERE provider_key = _provider_key) THEN
    RAISE EXCEPTION 'MCP_BAD_PROVIDER' USING ERRCODE = '22023';
  END IF;
  IF _visibility IS NULL OR _visibility NOT IN ('tenant','owner_only') THEN
    RAISE EXCEPTION 'MCP_BAD_VISIBILITY' USING ERRCODE = '22023';
  END IF;

  IF _auth_kind IS NULL OR _auth_kind NOT IN ('oauth','bearer','header','api_key','url','none') THEN
    RAISE EXCEPTION 'MCP_BAD_AUTH_KIND' USING ERRCODE = '22023';
  END IF;
  IF _auth_kind = 'api_key' THEN
    RAISE EXCEPTION 'MCP_AUTH_KIND_NOT_EXECUTABLE' USING ERRCODE = '22023';   -- REST facet; use create_mcp_rest_connection
  END IF;
  IF NOT public._mcp_endpoint_write_safe(_server_url) THEN
    RAISE EXCEPTION 'MCP_BAD_ENDPOINT' USING ERRCODE = '22023';   -- closed code; never echoes the URL
  END IF;
  PERFORM public._mcp_assert_credential_bundle(
            _auth_kind, _auth_token, _auth_header_name, _refresh_token,
            _oauth_issuer, _oauth_client_id, _oauth_client_secret, _oauth_scopes, _access_token_expires_at);
  PERFORM public._mcp_assert_custom_headers(_custom_headers, CASE WHEN _auth_kind='header' THEN _auth_header_name END);

  _new_hash  := public._mcp_endpoint_hash(_server_url);
  _new_last4 := CASE WHEN _auth_token IS NULL OR length(_auth_token) < 12 THEN NULL ELSE right(_auth_token, 4) END;

  BEGIN
    INSERT INTO public.mcp_connections (
      tenant_id, provider_key, label, server_url_ct, transport, auth_kind, auth_header_name,
      auth_token_ct, auth_token_last4, refresh_token_ct, oauth_issuer, oauth_client_id,
      oauth_client_secret_ct, oauth_scopes, access_token_expires_at, granted_scopes, provider_state,
      visibility, status, health, enabled, legacy_source, legacy_provider, created_by, updated_by, custom_headers_ct
    ) VALUES (
      _tenant, _provider_key, _label, public.platform_encrypt(_server_url), 'http', _auth_kind, _auth_header_name,
      CASE WHEN _auth_token IS NULL THEN NULL ELSE public.platform_encrypt(_auth_token) END,
      _new_last4,
      CASE WHEN _refresh_token IS NULL THEN NULL ELSE public.platform_encrypt(_refresh_token) END,
      _oauth_issuer, _oauth_client_id,
      CASE WHEN _oauth_client_secret IS NULL THEN NULL ELSE public.platform_encrypt(_oauth_client_secret) END,
      _oauth_scopes, _access_token_expires_at, '{}', '{}'::jsonb,
      _visibility, 'pending_verification', 'unknown', true, NULL, NULL, auth.uid(), auth.uid(),
      CASE WHEN _custom_headers = '{}'::jsonb THEN NULL ELSE public.platform_encrypt(_custom_headers::text) END
    )
    RETURNING connection_id INTO _new_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'MCP_DUPLICATE_LABEL' USING ERRCODE = '22023';
  END;

  INSERT INTO public.paige_audit_log (actor_user_id, tenant_id, action, target_type, target_id, payload)
  VALUES (
    auth.uid(), _tenant, 'mcp_connection.created', 'mcp_connections', _new_id,
    jsonb_build_object(
      'provider_key',      _provider_key,
      'label',             _label,
      'auth_kind',         _auth_kind,
      'transport',         'http',
      'visibility',        _visibility,
      'new_endpoint_hash', _new_hash,
      'auth_token_last4',  _new_last4
    )
  );

  RETURN jsonb_build_object(
    'connection_id',    _new_id,
    'status',           'pending_verification',
    'endpoint_hash',    _new_hash,
    'auth_token_last4', _new_last4,
    'address_configured', true,
    'credentials_configured', (_auth_token IS NOT NULL OR _refresh_token IS NOT NULL OR _auth_kind='url' OR _custom_headers <> '{}'::jsonb),
    'custom_header_count', (SELECT count(*) FROM jsonb_object_keys(_custom_headers)),
    'config_generation', (SELECT config_generation FROM public.mcp_connections WHERE connection_id = _new_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_mcp_connection(text, text, text, text, text, text, text, text, text, text, text[], timestamptz, text, uuid, jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_mcp_connection(text, text, text, text, text, text, text, text, text, text, text[], timestamptz, text, uuid, jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.disconnect_mcp_connection(
  _connection_id uuid,
  _hard          boolean DEFAULT false,
  _tenant_id     uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _conn              public.mcp_connections%ROWTYPE;
  _tenant            uuid;
  _caps              text[];
  _old_hash          text;
  _approvals_revoked integer := 0;
  _tools_cleared     integer := 0;
BEGIN
  IF _connection_id IS NULL THEN
    RAISE EXCEPTION 'MCP_NO_CONNECTION' USING ERRCODE = '22023';
  END IF;

  _tenant := public._mcp_resolve_tenant(_tenant_id, false);
  _caps := public._mcp_caller_capabilities(_tenant, auth.uid());
  IF _hard THEN
    IF NOT ('mcp.connections.delete' = ANY(_caps)) THEN
      RAISE EXCEPTION 'MCP_FORBIDDEN: mcp.connections.delete capability required' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT ('mcp.connections.manage' = ANY(_caps)) THEN
      RAISE EXCEPTION 'MCP_FORBIDDEN: mcp.connections.manage capability required' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO _conn FROM public.mcp_connections WHERE connection_id = _connection_id FOR UPDATE;
  IF _conn.connection_id IS NULL OR _conn.tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'MCP_FORBIDDEN: connection not in tenant' USING ERRCODE = '42501';
  END IF;
  IF _conn.legacy_source IS NOT NULL THEN
    RAISE EXCEPTION 'MCP_LEGACY_CONNECTION_READONLY: managed by the legacy connection path' USING ERRCODE = '42501';
  END IF;

  _old_hash := CASE WHEN _conn.server_url_ct IS NULL THEN NULL
                    ELSE public._mcp_endpoint_hash(public.platform_decrypt(_conn.server_url_ct)) END;

  IF _hard THEN
    SELECT count(*) INTO _approvals_revoked FROM public.mcp_connection_approvals WHERE connection_id = _connection_id;
    SELECT count(*) INTO _tools_cleared     FROM public.mcp_connection_tools     WHERE connection_id = _connection_id;

    INSERT INTO public.paige_audit_log (actor_user_id, tenant_id, action, target_type, target_id, payload)
    VALUES (
      auth.uid(), _conn.tenant_id, 'mcp_connection.deleted', 'mcp_connections', _connection_id,
      jsonb_build_object(
        'old_endpoint_hash', _old_hash,
        'provider_key',      _conn.provider_key,
        'auth_kind',         _conn.auth_kind,
        'approvals_revoked', _approvals_revoked,
        'tools_cleared',     _tools_cleared
      )
    );

    DELETE FROM public.mcp_connections WHERE connection_id = _connection_id;

    RETURN jsonb_build_object(
      'connection_id',    _connection_id,
      'deleted',          true,
      'mode',             'delete',
      'approvals_revoked', _approvals_revoked,
      'tools_cleared',     _tools_cleared
    );
  END IF;

  IF _conn.enabled IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'connection_id',   _connection_id,
      'disconnected',    true,
      'mode',            'disable',
      'already_disabled', true
    );
  END IF;

  DELETE FROM public.mcp_connection_approvals WHERE connection_id = _connection_id;
  GET DIAGNOSTICS _approvals_revoked = ROW_COUNT;
  DELETE FROM public.mcp_connection_tools WHERE connection_id = _connection_id;
  GET DIAGNOSTICS _tools_cleared = ROW_COUNT;

  UPDATE public.mcp_connections SET
    enabled                = false,
    auth_token_ct          = NULL,
    custom_headers_ct      = NULL,
    refresh_token_ct       = NULL,
    oauth_client_secret_ct = NULL,
    auth_token_last4       = NULL,
    server_url_ct          = CASE WHEN auth_kind = 'url' THEN NULL ELSE server_url_ct END,
    granted_scopes         = '{}',
    provider_state         = '{}'::jsonb,
    status                 = 'unconfigured',
    health                 = 'unknown',
    last_error_code        = NULL,
    last_checked_at        = NULL,
    updated_by             = auth.uid(),
    updated_at             = now()
  WHERE connection_id = _connection_id;

  INSERT INTO public.paige_audit_log (actor_user_id, tenant_id, action, target_type, target_id, payload)
  VALUES (
    auth.uid(), _conn.tenant_id, 'mcp_connection.disabled', 'mcp_connections', _connection_id,
    jsonb_build_object(
      'old_endpoint_hash', _old_hash,
      'mode',              'disable',
      'status_after',      'unconfigured',
      'approvals_revoked', _approvals_revoked,
      'tools_cleared',     _tools_cleared
    )
  );

  RETURN jsonb_build_object(
    'connection_id',    _connection_id,
    'disconnected',     true,
    'mode',             'disable',
    'status',           'unconfigured',
    'approvals_revoked', _approvals_revoked,
    'tools_cleared',     _tools_cleared
  );
END;
$$;
CREATE OR REPLACE FUNCTION public.get_mcp_connections_v2(
  _tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _tenant uuid; _out jsonb; _full boolean;
BEGIN
  _tenant := public._mcp_resolve_tenant(_tenant_id, false);
  _full := auth.uid() IS NULL OR public.is_tenant_admin(_tenant) OR public.is_platform_owner();
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'connection_id', c.connection_id,
           'provider_key', c.provider_key,
           'label', c.label,
           'transport', c.transport,
           'auth_kind', c.auth_kind,
           'configured', (c.auth_token_ct IS NOT NULL OR c.refresh_token_ct IS NOT NULL OR (c.auth_kind IN ('url','none') AND c.server_url_ct IS NOT NULL)),
           'address_configured', c.server_url_ct IS NOT NULL,
           'credentials_configured', (c.auth_token_ct IS NOT NULL OR c.refresh_token_ct IS NOT NULL OR c.custom_headers_ct IS NOT NULL OR (c.auth_kind='url' AND c.server_url_ct IS NOT NULL)),
           'custom_header_count', (SELECT count(*) FROM jsonb_object_keys(COALESCE(public.platform_decrypt(c.custom_headers_ct)::jsonb, '{}'::jsonb))),
           'config_generation', c.config_generation,
           'enabled', c.enabled,
           'status', c.status,
           'health', c.health,
           'last_checked_at', c.last_checked_at,
           'granted_scopes', c.granted_scopes,
           'visibility', c.visibility,
           'server_url_host', CASE WHEN c.server_url_ct IS NOT NULL
             THEN split_part(split_part(public.platform_decrypt(c.server_url_ct), '://', 2), '/', 1)
             ELSE NULL END,
           'tool_count', (SELECT count(*) FROM public.mcp_connection_tools t WHERE t.connection_id = c.connection_id),
           'approved_count', (SELECT count(*) FROM public.mcp_connection_approvals a WHERE a.connection_id = c.connection_id)
         ) ORDER BY c.created_at), '[]'::jsonb)
    INTO _out
    FROM public.mcp_connections c
   WHERE c.tenant_id = _tenant
     AND (_full OR c.visibility <> 'owner_only');
  RETURN _out;
END;
$$;
CREATE OR REPLACE FUNCTION public.complete_mcp_oauth_grant(
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
     OR (cardinality(_flow.requested_scopes) > 0 AND NOT (COALESCE(_oauth_scopes, '{}'::text[]) <@ _flow.requested_scopes)) THEN
    RAISE EXCEPTION 'MCP_BAD_CREDENTIAL_BUNDLE' USING ERRCODE = '22023';
  END IF;
  PERFORM public._mcp_assert_credential_bundle(
    'oauth', _access_token, NULL, _refresh_token, _oauth_issuer, _oauth_client_id,
    _oauth_client_secret, _oauth_scopes, _access_token_expires_at
  );
  -- Explicit owner authorization replaces the credential identity. This is NOT automatic refresh.
  -- Old consent/catalog cannot follow a new grant just because its endpoint stayed unchanged.
  DELETE FROM public.mcp_connection_approvals WHERE connection_id = _connection_id;
  DELETE FROM public.mcp_connection_tools WHERE connection_id = _connection_id;
  UPDATE public.mcp_connections SET
    auth_kind = 'oauth', auth_token_ct = public.platform_encrypt(_access_token),
    refresh_token_ct = CASE WHEN COALESCE(btrim(_refresh_token), '') = '' THEN NULL ELSE public.platform_encrypt(_refresh_token) END,
    oauth_issuer = _flow.issuer, oauth_client_id = _flow.client_id,
    oauth_client_secret_ct = _flow.client_secret_ct,
    oauth_scopes = COALESCE(_oauth_scopes, '{}'), granted_scopes = COALESCE(_oauth_scopes, '{}'),
    access_token_expires_at = _access_token_expires_at, auth_header_name = NULL,
    -- OAuth completion starts a new credential mode; never inherit token-mode supplemental secrets.
    custom_headers_ct = CASE WHEN auth_kind='oauth' THEN custom_headers_ct ELSE NULL END,
    status = 'pending_verification', health = 'unknown', last_error_code = NULL, updated_at = now()
    WHERE connection_id = _connection_id;
  UPDATE public.mcp_connection_oauth_state SET completed_at = clock_timestamp(), completion_allowed = false WHERE id = _flow.id;
  RETURN jsonb_build_object('connection_id', _connection_id, 'status', 'pending_verification',
    'account_type', _flow.return_account_type, 'account_number', _flow.return_account_number);
END;
$$;
COMMIT;
