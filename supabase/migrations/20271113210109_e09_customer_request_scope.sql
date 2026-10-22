-- An untrusted per-request business hint only NARROWS the original Auth-bound
-- relationship. No identity, staff workspace, preference or authority is stored.
BEGIN;

DO $lease$
DECLARE expected record; actual record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.client_portal_relationship_id(uuid)','da4f00851ef119e4a364aecad7292543'),
  ('public.client_portal_access_state()','c9538b7351e68ea8a9e99c3c50d76200'),
  ('public.client_portal_frame()','b3826e6b52ba34cd40348112b8145883')
 ) e(signature,body_md5) LOOP
  SELECT md5(prosrc) body_md5,pg_get_userbyid(proowner) owner,prosecdef,provolatile
   INTO actual FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF actual.body_md5 IS DISTINCT FROM expected.body_md5 OR actual.owner IS DISTINCT FROM 'postgres'
    OR actual.prosecdef IS DISTINCT FROM true OR actual.provolatile IS DISTINCT FROM 's' THEN
   RAISE EXCEPTION 'Customer request source changed (%); review composition',expected.signature
    USING ERRCODE='42501';
  END IF;
 END LOOP;
END $lease$;

CREATE FUNCTION public._client_portal_request_business()
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE headers jsonb; value text;
BEGIN
 BEGIN
  headers:=coalesce(nullif(pg_catalog.current_setting('request.headers',true),''),'{}')::jsonb;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'customer business selection invalid' USING ERRCODE='42501';
 END;
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'customer business selection invalid' USING ERRCODE='42501';
 END IF;
 IF NOT headers ? 'x-client-portal-business' THEN RETURN NULL; END IF;
 value:=headers->>'x-client-portal-business';
 IF jsonb_typeof(headers->'x-client-portal-business') IS DISTINCT FROM 'string'
   OR value !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
  RAISE EXCEPTION 'customer business selection invalid' USING ERRCODE='42501';
 END IF;
 RETURN value::uuid;
END $$;
REVOKE ALL ON FUNCTION public._client_portal_request_business() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public._client_portal_request_business() IS
 'Internal untrusted request-input parser only. No relationship, identity, authority or persisted state; the original Auth-bound resolver must authorize every use.';

CREATE OR REPLACE FUNCTION public.client_portal_relationship_id(p_tenant_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _ids uuid[];
  _business uuid;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  _business := public._client_portal_request_business();
  IF _business IS NOT NULL AND p_tenant_id IS NOT NULL AND _business <> p_tenant_id THEN RETURN NULL; END IF;
  SELECT array_agg(c.id ORDER BY c.id) INTO _ids
  FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active'
    AND c.portal_access_state = 'open'
    AND (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id)
    AND (_business IS NULL OR c.tenant_id = _business);
  IF COALESCE(cardinality(_ids), 0) > 1 THEN
    -- A request hint or argument narrows existing authority; neither supplies it.
    RAISE EXCEPTION 'select an authorized customer relationship' USING ERRCODE = '42501';
  END IF;
  RETURN _ids[1];
END;
$$;
-- Preserve the incumbent grants; a service caller with no Auth subject still
-- resolves nothing. The browser never receives a privileged execution channel.
REVOKE ALL ON FUNCTION public.client_portal_relationship_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_relationship_id(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.client_portal_relationship_id(uuid) IS
 'Original Auth-subject-bound active/open/unmerged client relationship. Optional request business and tenant argument only narrow authority; conflicting inputs withhold. No staff/email fallback or persisted selection.';

CREATE OR REPLACE FUNCTION public.client_portal_access_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_hit record;
  v_brand record;
  v_business uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  v_business := public._client_portal_request_business();
  BEGIN
    v_id := public.client_portal_relationship_id(NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('state', 'multiple');
  END;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('state', 'open'); END IF;
  SELECT c.tenant_id, c.portal_access_state AS state, c.portal_access_changed_at AS since INTO v_hit
  FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE ((c.linked_user_id = v_uid AND c.portal_access_state = 'paused' AND c.status = 'active'
          AND c.merged_into_contact_id IS NULL AND t.status = 'active')
     OR (c.portal_access_former_user_id = v_uid AND c.portal_access_state = 'ended' AND c.linked_user_id IS NULL))
    AND (v_business IS NULL OR c.tenant_id = v_business)
  ORDER BY c.portal_access_changed_at DESC NULLS LAST, c.id
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'none'); END IF;
  SELECT rb.tenant_name, COALESCE(rb.logo_url, p.brand_logo_url) AS logo_url, rb.logo_dark_url INTO v_brand
  FROM public.resolve_tenant_brand(v_hit.tenant_id) rb
  LEFT JOIN public.tenant_legal_profile p ON p.tenant_id = v_hit.tenant_id;
  RETURN jsonb_build_object('state', v_hit.state, 'since', v_hit.since,
    'business', jsonb_build_object('name', v_brand.tenant_name, 'logo_url', v_brand.logo_url,
      'logo_dark_url', v_brand.logo_dark_url));
END $$;
REVOKE ALL ON FUNCTION public.client_portal_access_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_access_state() TO authenticated, service_role;
COMMENT ON FUNCTION public.client_portal_access_state() IS
 'Original own access read. Optional untrusted request business narrows the original linked/former-user notice and cannot fall back to another business. No private reason/note or identity grant.';

COMMIT;
