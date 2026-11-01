-- INERT candidate only. Not a migration, not applied to production.
-- Original upsert_contact; current deployed definition and metadata guards.
DO $exp03_contact_authority$
DECLARE
  target regprocedure := 'public.upsert_contact(jsonb,uuid,uuid,uuid,text)'::regprocedure;
  original text;
  revised text;
  old_gate text := $old$  IF _actor IS NULL OR NOT public.has_any_role(_actor, ARRAY['admin','super_admin']) THEN
    RAISE EXCEPTION 'CONTACT_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;

$old$;
  tenant_anchor text := $anchor$  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_TENANT' USING ERRCODE = '22023';
  END IF;
$anchor$;
  new_gate text := $new$
  IF _actor IS NULL OR NOT (
    public.is_platform_owner(_actor) OR public.is_tenant_admin_as(_actor, _tenant)
  ) THEN
    RAISE EXCEPTION 'CONTACT_FORBIDDEN: current business owner or admin required' USING ERRCODE = '42501';
  END IF;
$new$;
  current_hash text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid=target
      AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
      AND p.proconfig=ARRAY['search_path=""']::text[]
      AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
  ) THEN RAISE EXCEPTION 'EXP03 contact writer metadata drift'; END IF;
  original := pg_get_functiondef(target);
  current_hash := md5(original);
  IF current_hash='bb9b4de901b59d776ec3c82fa649770f' THEN RETURN; END IF;
  IF current_hash<>'0b3e44a65443104b2068168faf452b0f' THEN
    RAISE EXCEPTION 'EXP03 contact writer source drift';
  END IF;
  IF strpos(original,old_gate)=0 OR strpos(original,tenant_anchor)=0 THEN
    RAISE EXCEPTION 'EXP03 contact writer missing reviewed span';
  END IF;
  revised := replace(replace(original,old_gate,''),tenant_anchor,tenant_anchor||new_gate);
  IF md5(revised)<>'bb9b4de901b59d776ec3c82fa649770f' THEN
    RAISE EXCEPTION 'EXP03 contact writer revised source mismatch';
  END IF;
  EXECUTE revised;
  IF md5(pg_get_functiondef(target))<>'bb9b4de901b59d776ec3c82fa649770f' THEN
    RAISE EXCEPTION 'EXP03 contact writer readback mismatch';
  END IF;
END;
$exp03_contact_authority$;
