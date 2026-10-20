-- Compose the existing customer identity/presentation readers in one stable
-- database snapshot. Three separate browser reads can mix relationship A's
-- identity with B's presentation during a session/context transition.
-- This read grants no membership, selects no business and runs no client action.
CREATE OR REPLACE FUNCTION public.client_portal_frame()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _actor uuid := auth.uid();
  _profile jsonb;
  _brand jsonb;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501';
  END IF;
  _profile := public.client_portal_self_profile();
  IF _profile IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
    'tenant_id', b.tenant_id, 'tenant_name', b.tenant_name,
    'tenant_slug', b.tenant_slug, 'logo_url', b.logo_url,
    'primary_color', b.primary_color, 'support_email', b.support_email
  ) INTO _brand
  FROM public.get_client_portal_brand() b
  WHERE b.tenant_id = (_profile->>'tenant_id')::uuid;
  IF _brand IS NULL THEN
    RAISE EXCEPTION 'customer presentation unavailable' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'actor_id', _actor, 'profile', _profile, 'brand', _brand,
    'config', public.get_client_portal_config()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_frame() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_frame() TO authenticated;
COMMENT ON FUNCTION public.client_portal_frame() IS
  'One read-only snapshot of the existing strict own-customer profile and tenant presentation. No staff/route/email fallback, new identity registry, business selection or execution authority.';
