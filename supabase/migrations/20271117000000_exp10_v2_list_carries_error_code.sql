-- EXP10 PR15 — the connection list carries the closed error code (the A6/A10 customer-visible half).
--
-- WHY: get_mcp_connections_v2 already returns status/health/last_checked_at, but the drawer's
-- "Couldn't reach it" chip cannot say WHY, and PR14's http_rate_limited split (wait-and-retry,
-- never reconnect) is invisible on the very surface an owner lands on when something breaks.
-- last_error_code is the table's CLOSED refusal vocabulary (schema-enforced
-- mcp_connections_last_error_code_shape_chk: ^[a-z0-9_]{1,64}$ — provider prose is refused at
-- the write), so exposing it to the owning tenant leaks no third-party content; the client
-- re-validates the same shape and drops anything that is not a closed code. The reader copy in
-- list_integration_surface already carries this field for chat; this is the settings half.
--
-- The function body is the incumbent byte-for-byte (extracted from 20270520000000) with exactly
-- one added jsonb field after last_checked_at.

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
           'last_error_code', c.last_error_code,
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
