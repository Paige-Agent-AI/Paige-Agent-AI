-- EXP09 exact original customer intent over the existing S7 and Agreements engine.
-- Original functions, locks, frozen signer/document authority, grants and receipts remain unchanged.
BEGIN;

CREATE FUNCTION public.client_portal_agreements_scoped(p_tenant_id uuid, p_expected_client_id uuid, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $original$
BEGIN
  IF p_tenant_id IS NULL OR p_expected_client_id IS NULL THEN
    RAISE EXCEPTION 'CLIENT_AGREEMENT_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  -- Reuse the original Auth-account authority and its established read-lock order
  -- (Auth user before the S7 client/tenant SHARE gate), without financial permissions.
  PERFORM 1 FROM auth.users u WHERE u.id=auth.uid() AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<now()) FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENT_AGREEMENT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  -- The original S7 gate resolves actual Auth and holds the exact open relationship through
  -- the original call. No role/email inference, financial helper or Account write-lock upgrade.
  IF public._client_portal_lock_relationship(p_tenant_id,'share') IS DISTINCT FROM p_expected_client_id THEN
    RAISE EXCEPTION 'CLIENT_AGREEMENT_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  RETURN public.client_portal_agreements(p_tenant_id,p_limit);
END;
$original$;
REVOKE ALL ON FUNCTION public.client_portal_agreements_scoped(uuid,uuid,integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_agreements_scoped(uuid,uuid,integer) TO authenticated;

CREATE FUNCTION public.client_portal_open_agreement_signing_scoped(p_agreement_id uuid, p_tenant_id uuid, p_expected_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $original$
BEGIN
  IF p_tenant_id IS NULL OR p_expected_client_id IS NULL THEN
    RAISE EXCEPTION 'CLIENT_AGREEMENT_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  -- Reuse the original Auth-account authority and its established read-lock order
  -- (Auth user before the S7 client/tenant SHARE gate), without financial permissions.
  PERFORM 1 FROM auth.users u WHERE u.id=auth.uid() AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<now()) FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENT_AGREEMENT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  -- The original S7 gate resolves actual Auth and holds the exact open relationship through
  -- the original call. No role/email inference, financial helper or Account write-lock upgrade.
  IF public._client_portal_lock_relationship(p_tenant_id,'share') IS DISTINCT FROM p_expected_client_id THEN
    RAISE EXCEPTION 'CLIENT_AGREEMENT_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  RETURN public.client_portal_open_agreement_signing(p_agreement_id,p_tenant_id);
END;
$original$;
REVOKE ALL ON FUNCTION public.client_portal_open_agreement_signing_scoped(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_open_agreement_signing_scoped(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.client_portal_agreement_document_access_scoped(p_agreement_id uuid, p_tenant_id uuid, p_expected_client_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $original$
BEGIN
  IF p_tenant_id IS NULL OR p_expected_client_id IS NULL THEN
    RAISE EXCEPTION 'CLIENT_AGREEMENT_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  -- Reuse the original Auth-account authority and its established read-lock order
  -- (Auth user before the S7 client/tenant SHARE gate), without financial permissions.
  PERFORM 1 FROM auth.users u WHERE u.id=auth.uid() AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<now()) FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLIENT_AGREEMENT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  -- The original S7 gate resolves actual Auth and holds the exact open relationship through
  -- the original call. No role/email inference, financial helper or Account write-lock upgrade.
  IF public._client_portal_lock_relationship(p_tenant_id,'share') IS DISTINCT FROM p_expected_client_id THEN
    RAISE EXCEPTION 'CLIENT_AGREEMENT_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  RETURN public.client_portal_agreement_document_scope(p_agreement_id,p_tenant_id) IS NOT NULL;
END;
$original$;
REVOKE ALL ON FUNCTION public.client_portal_agreement_document_access_scoped(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_agreement_document_access_scoped(uuid,uuid,uuid) TO authenticated;

COMMENT ON FUNCTION public.client_portal_agreement_document_access_scoped(uuid,uuid,uuid) IS
  'Exact-intent boolean over the original signed-copy scope; no private storage address, token or document metadata is exposed. Original document Edge and signing engine remain unchanged.';
NOTIFY pgrst, 'reload schema';
COMMIT;
