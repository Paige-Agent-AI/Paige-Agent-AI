-- Preserve the existing member receipt projection while protecting exact destinations.
-- Only account-bound receipts add the owner-internal Social destination.
CREATE OR REPLACE FUNCTION public.content_publication_list(p_content_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF content_publications
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _caller uuid := auth.uid(); _tenant uuid; _can_read_destination boolean;
BEGIN
  IF _caller IS NOT NULL THEN
    _tenant := public.current_user_tenant_id();
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
    END IF;
    IF p_tenant_id IS NOT NULL AND p_tenant_id <> _tenant THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: that is not the workspace you are working in' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.is_tenant_member(_tenant) OR public.agency_can_manage_child(_tenant)) THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: a workspace member is required' USING ERRCODE = '42501';
    END IF;
  ELSE
    _tenant := p_tenant_id;
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
  END IF;
  _can_read_destination := _caller IS NULL OR public.is_tenant_admin(_tenant)
    OR public.agency_can_manage_child(_tenant);
  RETURN QUERY
  SELECT (CASE
    WHEN _can_read_destination IS TRUE OR NOT (e.request_args ? 'account_id') THEN e
    ELSE jsonb_populate_record(e, jsonb_build_object(
      'connection_id', NULL,
      'provider_post_id', NULL,
      'provider_post_url', NULL,
      'provider_request_id', NULL,
      'provider_response', '{}'::jsonb,
      'request_args', e.request_args - ARRAY['account_id', 'connection_id', 'channel_id', 'channel_label']
    ))
  END).* FROM public.content_publications e
  WHERE e.tenant_id = _tenant AND (p_content_id IS NULL OR e.content_id = p_content_id)
  ORDER BY e.created_at DESC, e.id DESC;
END $function$;
