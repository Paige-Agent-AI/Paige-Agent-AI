-- INERT original EXP08 outcome4 candidate. No migration version or remote application.
-- Original departure writer, original authority helpers, same receipt and membership store.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $departure_currentness$
DECLARE target regprocedure:=to_regprocedure('public.remove_solo_team_member(uuid,uuid)');
 p pg_proc; prior_metadata jsonb; original text; changed text; definition text;
 anchor text:=$anchor$  -- Every owner is refused, which is what makes "the sole owner is never removable" true without$anchor$;
 guard text:=$guard$  -- exp08_departure_currentness_v1: a target-row wait cannot retain earlier authority.
  -- Keep existing actor-seat and workspace-pointer rows stable until the original act completes.
  -- Missing rows do not invent a new seat requirement: the original scope/owner helpers still decide.
  PERFORM 1 FROM public.profiles current_profile WHERE current_profile.user_id = _actor FOR SHARE;
  PERFORM 1 FROM public.tenant_members current_actor
    WHERE current_actor.tenant_id = _tenant AND current_actor.user_id = _actor FOR SHARE;
  IF public.current_user_tenant_id() IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could run; nothing was removed'
      USING ERRCODE = '42501';
  END IF;
  _caller_owner := public.is_tenant_owner(_actor, _tenant);
  IF NOT _caller_owner AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members current_actor
    WHERE current_actor.tenant_id = _tenant AND current_actor.user_id = _actor
      AND current_actor.status = 'active' AND current_actor.role = 'admin'::public.tenant_role
  ) THEN
    RAISE EXCEPTION 'only an owner or an admin may remove someone from this workspace'
      USING ERRCODE = '42501';
  END IF;

$guard$;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=target;
 IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
  OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
  OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>'jsonb'::regtype
  OR pg_get_function_arguments(target) IS DISTINCT FROM '_member_user_id uuid, _expected_tenant_id uuid'
  OR NOT has_function_privilege('authenticated',target,'EXECUTE')
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
  RAISE EXCEPTION 'EXP08 departure currentness metadata drift';
 END IF;
 original:=p.prosrc;
 IF strpos(original,'exp08_departure_currentness_v1')>0 THEN
  IF md5(replace(original,guard,''))<>'d8c0eb6a8fdc3fef52eda7df4f9274e1'
   OR length(original)-length(replace(original,guard,''))<>length(guard) THEN
   RAISE EXCEPTION 'EXP08 departure currentness replay drift';
  END IF;
  RETURN;
 END IF;
 IF md5(original)<>'d8c0eb6a8fdc3fef52eda7df4f9274e1'
  OR length(original)-length(replace(original,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'EXP08 departure currentness source drift';
 END IF;
 prior_metadata:=to_jsonb(p)-'prosrc';
 changed:=replace(original,anchor,guard||anchor);
 IF replace(changed,guard,'') IS DISTINCT FROM original THEN
  RAISE EXCEPTION 'EXP08 departure currentness inverse failed';
 END IF;
 definition:=pg_get_functiondef(target);
 EXECUTE replace(definition,original,changed);
 SELECT * INTO p FROM pg_proc WHERE oid=target;
 IF p.prosrc IS DISTINCT FROM changed OR (to_jsonb(p)-'prosrc') IS DISTINCT FROM prior_metadata THEN
  RAISE EXCEPTION 'EXP08 departure currentness final readback failed';
 END IF;
END $departure_currentness$;
COMMIT;
