-- INERT original EXP08 outcome4 candidate. No migration version or remote application.
-- Original departure writer, original authority helpers, same receipt and membership store.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $departure_currentness$
DECLARE target regprocedure:=to_regprocedure('public.remove_solo_team_member(uuid,uuid)');
 p pg_proc; helper record; prior_metadata jsonb; original text; changed text; definition text;
 anchor text:=$anchor$  -- Every owner is refused, which is what makes "the sole owner is never removable" true without$anchor$;
 target_anchor text:=$target_anchor$  -- Locked, and deliberately NOT filtered by status.$target_anchor$;
 identity_guard text:=$identity_guard$  -- exp08_departure_identity_v1: serialize current identity before membership/profile locks.
  PERFORM 1 FROM auth.users current_identity WHERE current_identity.id = _actor FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM auth.users current_identity
    WHERE current_identity.id = _actor AND current_identity.deleted_at IS NULL
      AND (current_identity.banned_until IS NULL OR current_identity.banned_until <= clock_timestamp())) THEN
    RAISE EXCEPTION 'TEAM_MEMBER_IDENTITY_UNAVAILABLE: current account access could not be confirmed; nothing was removed'
      USING ERRCODE = '42501';
  END IF;

$identity_guard$;
 delete_anchor text:=$delete_anchor$  DELETE FROM public.tenant_members WHERE id = _target.id;$delete_anchor$;
 protected_guard text:=$protected_guard$  -- exp08_departure_protected_v1: preserve the original platform-admin protection before writing.
  IF public.map_tenant_role_to_app_role(_target.role) = 'admin'::public.app_role
     AND EXISTS (SELECT 1 FROM public.user_roles protected_role
       WHERE protected_role.user_id = _member_user_id AND protected_role.role = 'admin'::public.app_role)
     AND EXISTS (SELECT 1 FROM auth.users protected_user
       WHERE protected_user.id = _member_user_id
         AND protected_user.email = (SELECT configured.owner_email FROM public.app_settings_owner configured LIMIT 1))
     AND NOT EXISTS (SELECT 1 FROM public.tenant_members other_seat
       WHERE other_seat.user_id = _member_user_id AND other_seat.id <> _target.id
         AND other_seat.status = 'active'
         AND public.map_tenant_role_to_app_role(other_seat.role) = 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'TEAM_MEMBER_PROTECTED: this Paige account is protected; nothing was changed'
      USING ERRCODE = '42501';
  END IF;

$protected_guard$;
 ordered_locks text:=$ordered_locks$  -- exp08_departure_pair_locks_v1: opposing departures take the same membership lock order.
  -- The existing authority check still precedes every target lookup or lock.
  PERFORM 1 FROM public.tenant_members departure_seat
    WHERE departure_seat.tenant_id = _tenant AND departure_seat.user_id IN (_actor, _member_user_id)
    ORDER BY departure_seat.user_id FOR UPDATE;

$ordered_locks$;
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
 IF EXISTS(SELECT 1 FROM (VALUES ('id','uuid'),('deleted_at','timestamptz'),('banned_until','timestamptz')) c(name,kind)
  WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('auth.users')
   AND a.attname=c.name AND a.atttypid=to_regtype(c.kind) AND a.attnum>0 AND NOT a.attisdropped)) THEN
  RAISE EXCEPTION 'EXP08 departure currentness original Auth columns missing or drifted';
 END IF;
 -- These original role-sync/protection functions are dependencies, never rewritten here.
 FOR helper IN SELECT * FROM (VALUES
  ('public.map_tenant_role_to_app_role(public.tenant_role)','60dfcc70ea811ca2ac255d9e19c20714',false,'i','sql',true),
  ('public.sync_tenant_member_to_user_roles()','be8cc66ffe2f226a62a0d34c11303023',true,'v','plpgsql',false),
  ('public.prevent_owner_admin_removal()','daeb1b91408969a62224140148a99414',true,'v','plpgsql',false)
 ) expected(signature,body_md5,definer,volatility,language_name,public_mapping) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(helper.signature);
  IF NOT FOUND OR md5(p.prosrc) IS DISTINCT FROM helper.body_md5
   OR p.proowner<>'postgres'::regrole OR p.prosecdef IS DISTINCT FROM helper.definer
   OR p.provolatile::text IS DISTINCT FROM helper.volatility
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname=helper.language_name)
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR p.prorettype<>to_regtype(CASE WHEN helper.public_mapping THEN 'public.app_role' ELSE 'trigger' END)
   OR p.proretset OR p.prokind<>'f' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
   OR p.provariadic<>0 OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL
   OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
   OR p.proargnames IS DISTINCT FROM (CASE WHEN helper.public_mapping THEN ARRAY['_tenant_role']::text[] ELSE NULL::text[] END)
   OR pg_get_function_arguments(p.oid) IS DISTINCT FROM (CASE WHEN helper.public_mapping THEN '_tenant_role tenant_role' ELSE '' END)
   -- Fresh managed rebuilds retain the mapping's PUBLIC default and tighter owner-only
   -- trigger grants; production may explicitly repeat PUBLIC access or grant service.
   -- Preserve either observed form verbatim, never normalize or widen a helper's ACL.
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
   OR (helper.public_mapping AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE a.grantee=0 AND a.privilege_type='EXECUTE' AND NOT a.is_grantable))
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable
      OR (helper.public_mapping AND a.grantee NOT IN (0,'postgres'::regrole,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole))
      OR (NOT helper.public_mapping AND a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole))) THEN
   RAISE EXCEPTION 'EXP08 departure currentness original helper drift: %',helper.signature;
  END IF;
 END LOOP;
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
  IF md5(replace(replace(replace(replace(original,guard,''),ordered_locks,''),protected_guard,''),identity_guard,''))<>'d8c0eb6a8fdc3fef52eda7df4f9274e1'
   OR length(original)-length(replace(original,guard,''))<>length(guard)
   OR length(original)-length(replace(original,ordered_locks,''))<>length(ordered_locks)
   OR length(original)-length(replace(original,protected_guard,''))<>length(protected_guard)
   OR length(original)-length(replace(original,identity_guard,''))<>length(identity_guard) THEN
   RAISE EXCEPTION 'EXP08 departure currentness replay drift';
  END IF;
  RETURN;
 END IF;
 IF md5(original)<>'d8c0eb6a8fdc3fef52eda7df4f9274e1'
  OR length(original)-length(replace(original,anchor,''))<>length(anchor)
  OR length(original)-length(replace(original,target_anchor,''))<>length(target_anchor)
  OR length(original)-length(replace(original,delete_anchor,''))<>length(delete_anchor) THEN
  RAISE EXCEPTION 'EXP08 departure currentness source drift';
 END IF;
 prior_metadata:=to_jsonb(p)-'prosrc';
 changed:=replace(replace(replace(original,anchor,guard||anchor),target_anchor,identity_guard||ordered_locks||target_anchor),delete_anchor,protected_guard||delete_anchor);
 IF replace(replace(replace(replace(changed,guard,''),ordered_locks,''),protected_guard,''),identity_guard,'') IS DISTINCT FROM original THEN
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
