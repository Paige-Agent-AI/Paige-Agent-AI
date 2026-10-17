-- Preserve the existing Portal configuration writer and permission contract.
-- A row lock serializes patches; a partial assistant edit preserves other
-- saved presentation settings. This grants no Knowledge, tool or role access.
BEGIN;
DO $source_lease$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=to_regprocedure('public.set_tenant_portal_config(uuid,jsonb)')
      AND md5(p.prosrc)='d708b31ad83607f7fb7198717aa9077c'
      AND pg_get_userbyid(p.proowner)='postgres'
      AND p.prosecdef AND p.proconfig=ARRAY['search_path=public']::text[]
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
      AND cardinality(p.proacl)=2
      AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
        WHERE a.grantor<>p.proowner OR a.is_grantable OR a.privilege_type<>'EXECUTE'
          OR a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='authenticated')))
  ) THEN
    RAISE EXCEPTION 'Portal configuration source changed; review before composition'
      USING ERRCODE='42501';
  END IF;
END $source_lease$;

CREATE OR REPLACE FUNCTION public.set_tenant_portal_config(_tenant_id uuid, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _current jsonb; _merged jsonb; _assistant jsonb;
BEGIN
  IF _patch IS NULL OR jsonb_typeof(_patch)<>'object' THEN
    RAISE EXCEPTION 'portal config patch must be a JSON object' USING ERRCODE='22023';
  END IF;
  IF _patch ? 'modules' AND jsonb_typeof(_patch->'modules')<>'array' THEN
    RAISE EXCEPTION 'invalid_portal_config' USING ERRCODE='22023';
  END IF;
  IF NOT public.can_manage_tenant_brand(_tenant_id) THEN
    RAISE EXCEPTION 'portal_config_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(features->'portal_config','{}'::jsonb) INTO _current
    FROM public.tenants WHERE id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant % not found',_tenant_id USING ERRCODE='P0002';
  END IF;
  -- Recheck after waiting for the canonical row, before changing saved state.
  IF NOT public.can_manage_tenant_brand(_tenant_id) THEN
    RAISE EXCEPTION 'portal_config_forbidden' USING ERRCODE='42501';
  END IF;
  _merged := _current || _patch;
  IF jsonb_typeof(_patch->'assistant')='object' THEN
    _assistant := CASE WHEN jsonb_typeof(_current->'assistant')='object'
      THEN _current->'assistant' ELSE '{}'::jsonb END;
    _merged := jsonb_set(_merged,'{assistant}',_assistant || (_patch->'assistant'),true);
  END IF;
  UPDATE public.tenants SET features=COALESCE(features,'{}'::jsonb)
    || jsonb_build_object('portal_config',_merged) WHERE id=_tenant_id;
  RETURN _merged;
END $$;
-- CREATE OR REPLACE retains the existing owner and exact authenticated-only ACL.
COMMIT;
