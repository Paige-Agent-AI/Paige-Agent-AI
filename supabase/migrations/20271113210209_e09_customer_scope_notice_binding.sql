-- Preserve the already Preview-applied180000 source. Add scoped notice readback
-- through a guarded forward correction, without rewriting a migration ledger.
BEGIN;
DO $lease$
DECLARE p record;
BEGIN
 SELECT md5(prosrc) digest,pg_get_userbyid(proowner) owner,prosecdef,provolatile INTO p
 FROM pg_proc WHERE oid=to_regprocedure('public.client_portal_access_state()');
 IF p.digest IS DISTINCT FROM '6d1b563971c7eb4df886b24ad46f5bc4' OR p.owner IS DISTINCT FROM 'postgres'
  OR p.prosecdef IS DISTINCT FROM true OR p.provolatile IS DISTINCT FROM 's' THEN
  RAISE EXCEPTION 'Customer scoped notice source changed; review composition' USING ERRCODE='42501';
 END IF;
END $lease$;

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
      'logo_dark_url', v_brand.logo_dark_url))
    -- A scoped browser must be able to reject a pre-migration/ignored hint:
    -- a public brand alone does not identify the requested business.
    || CASE WHEN v_business IS NOT NULL THEN jsonb_build_object('request_business_id',v_business) ELSE '{}'::jsonb END;
END $$;
REVOKE ALL ON FUNCTION public.client_portal_access_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_access_state() TO authenticated, service_role;
COMMENT ON FUNCTION public.client_portal_access_state() IS
 'Original own access read. Optional untrusted request business narrows the original linked/former-user notice and cannot fall back to another business. No private reason/note or identity grant.';

COMMIT;
