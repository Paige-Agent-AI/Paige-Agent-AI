-- GENERATED from original notice-state template/source; execution UNVERIFIED.
-- Original personal notice read-state installation on the actual replayed schema.
-- Rollback-only; no Auth users, customer rows, provider or business effects.
BEGIN;
SELECT plan(67);
CREATE TEMP TABLE exp08_notice_original_private AS
SELECT p.oid,to_jsonb(p) AS metadata FROM pg_catalog.pg_proc p
WHERE p.oid IN (to_regprocedure('public._exp08_read_my_recovery_notice(uuid)'),to_regprocedure('public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)'),to_regprocedure('public._exp08_require_recovery_audit()'));
SELECT is((SELECT count(*)::integer FROM exp08_notice_original_private),3,'all three original released personal eligibility dependencies exist');
SELECT lives_ok($install$
-- Canonical original notice-state SHA256 bbea6619dea05884a45e0c14d669172c04f2f215a08359e26c09b943fc6e1a85
-- INERT original R9 recipient read-state preparation, no version/apply/host activation.
-- Reuses original notifications and personal eligibility; no business grant or recovery effect.
DO $notice_state_patch$
DECLARE dependency record; p pg_catalog.pg_proc; target regprocedure;
 body constant text:=$notice_state_body$
DECLARE actor uuid:=auth.uid(); n public.notifications%ROWTYPE; verified jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF _notice IS NULL OR _is_read IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_STATE_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM public._exp08_require_recovery_audit();
 -- Same retirement/Auth/member/tenant/notice order as the original personal reader.
 -- One same-actor mark holds Auth UPDATE before the reader takes SHARE; two marks
 -- cannot both hold notice SHARE and deadlock while upgrading it to UPDATE.
 LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM public._exp08_read_my_recovery_notice(_notice);
 IF actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 UPDATE public.notifications SET is_read=_is_read,
   read_at=CASE WHEN _is_read THEN clock_timestamp() ELSE NULL END
  WHERE id=_notice AND user_id=actor AND
   (is_read IS DISTINCT FROM _is_read OR (_is_read AND read_at IS NULL) OR (NOT _is_read AND read_at IS NOT NULL))
 ;
 verified:=public._exp08_read_my_recovery_notice(_notice);
 -- RETURNING predates AFTER-trigger work. Read the actual stored state while
 -- the original eligibility/recipient locks are still held.
 SELECT * INTO n FROM public.notifications WHERE id=_notice AND user_id=actor;
 IF NOT FOUND OR actor IS DISTINCT FROM auth.uid() OR verified->>'notification_id' IS DISTINCT FROM _notice::text
  OR (verified->>'is_read')::boolean IS DISTINCT FROM _is_read OR n.is_read IS DISTINCT FROM _is_read
  OR (_is_read AND n.read_at IS NULL) OR (NOT _is_read AND n.read_at IS NOT NULL) THEN
  RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_STATE_UNKNOWN' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('notification_id',n.id,'is_read',n.is_read,'read_at',n.read_at);
END;
$notice_state_body$;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 notice-state installer requires postgres'; END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._exp08_read_my_recovery_notice(uuid)','3502ca4bdad1ba029b73b2b6c0a370af','jsonb','_notice uuid'),
  ('public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)','ddcdb478a4956181fc99dd8ebee80d0b','jsonb','_expected_tenant uuid, _notice uuid, _recipient uuid, _require_profile boolean'),
  ('public._exp08_require_recovery_audit()','defee9e1d221f1858669985f56ffad3d','void',''))
  expected(signature,hash,result,arguments) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(dependency.signature);
  IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>dependency.hash OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
   OR p.provolatile<>'v' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset
   OR p.prorettype<>pg_catalog.to_regtype(dependency.result) OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM dependency.arguments
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
   RAISE EXCEPTION 'EXP08 notice-state original eligibility drift: %',dependency.signature;
  END IF;
 END LOOP;
 target:=pg_catalog.to_regprocedure('public.set_my_owner_recovery_notice_read(uuid,boolean)');
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
  WHERE n.nspname='public' AND f.proname='set_my_owner_recovery_notice_read' AND f.oid IS DISTINCT FROM target::oid) THEN
  RAISE EXCEPTION 'EXP08 notice-state unsupported overload';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=target;
 IF FOUND THEN
  IF p.prosrc IS DISTINCT FROM body OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
   OR p.provolatile<>'v' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset
   OR p.prorettype<>'jsonb'::regtype OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_notice uuid, _is_read boolean'
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
   RAISE EXCEPTION 'EXP08 notice-state existing door drift';
  END IF;
 ELSE
  EXECUTE pg_catalog.format($create$CREATE FUNCTION public.set_my_owner_recovery_notice_read(_notice uuid,_is_read boolean)
   RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS %L$create$,body);
  REVOKE ALL ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) TO authenticated;
 END IF;
END $notice_state_patch$;

$install$,'original read-state preparation installs against the actual full schema');
SELECT ok(EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid='public.set_my_owner_recovery_notice_read(uuid,boolean)'::regprocedure AND proowner='postgres'::regrole AND prosecdef AND provolatile='v' AND NOT proisstrict AND NOT proleakproof AND proparallel='u' AND NOT proretset AND prorettype='jsonb'::regtype AND proconfig=ARRAY['search_path=""']::text[] AND pg_get_function_arguments(oid)='_notice uuid, _is_read boolean'),'read-state native ABI and security metadata are exact');
SELECT ok(has_function_privilege('authenticated','public.set_my_owner_recovery_notice_read(uuid,boolean)','EXECUTE') AND NOT has_function_privilege('anon','public.set_my_owner_recovery_notice_read(uuid,boolean)','EXECUTE') AND NOT has_function_privilege('service_role','public.set_my_owner_recovery_notice_read(uuid,boolean)','EXECUTE'),'only authenticated callers receive the new native execute grant');
SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_notice_original_private o JOIN pg_catalog.pg_proc p ON p.oid=o.oid WHERE to_jsonb(p) IS DISTINCT FROM o.metadata),'original private eligibility bodies and every catalog attribute stay exact');
CREATE TEMP TABLE exp08_notice_installed AS SELECT to_jsonb(p) AS metadata FROM pg_catalog.pg_proc p WHERE oid='public.set_my_owner_recovery_notice_read(uuid,boolean)'::regprocedure;
SELECT lives_ok($replay$
-- Canonical original notice-state SHA256 bbea6619dea05884a45e0c14d669172c04f2f215a08359e26c09b943fc6e1a85
-- INERT original R9 recipient read-state preparation, no version/apply/host activation.
-- Reuses original notifications and personal eligibility; no business grant or recovery effect.
DO $notice_state_patch$
DECLARE dependency record; p pg_catalog.pg_proc; target regprocedure;
 body constant text:=$notice_state_body$
DECLARE actor uuid:=auth.uid(); n public.notifications%ROWTYPE; verified jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF _notice IS NULL OR _is_read IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_STATE_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM public._exp08_require_recovery_audit();
 -- Same retirement/Auth/member/tenant/notice order as the original personal reader.
 -- One same-actor mark holds Auth UPDATE before the reader takes SHARE; two marks
 -- cannot both hold notice SHARE and deadlock while upgrading it to UPDATE.
 LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM public._exp08_read_my_recovery_notice(_notice);
 IF actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 UPDATE public.notifications SET is_read=_is_read,
   read_at=CASE WHEN _is_read THEN clock_timestamp() ELSE NULL END
  WHERE id=_notice AND user_id=actor AND
   (is_read IS DISTINCT FROM _is_read OR (_is_read AND read_at IS NULL) OR (NOT _is_read AND read_at IS NOT NULL))
 ;
 verified:=public._exp08_read_my_recovery_notice(_notice);
 -- RETURNING predates AFTER-trigger work. Read the actual stored state while
 -- the original eligibility/recipient locks are still held.
 SELECT * INTO n FROM public.notifications WHERE id=_notice AND user_id=actor;
 IF NOT FOUND OR actor IS DISTINCT FROM auth.uid() OR verified->>'notification_id' IS DISTINCT FROM _notice::text
  OR (verified->>'is_read')::boolean IS DISTINCT FROM _is_read OR n.is_read IS DISTINCT FROM _is_read
  OR (_is_read AND n.read_at IS NULL) OR (NOT _is_read AND n.read_at IS NOT NULL) THEN
  RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_STATE_UNKNOWN' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('notification_id',n.id,'is_read',n.is_read,'read_at',n.read_at);
END;
$notice_state_body$;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 notice-state installer requires postgres'; END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._exp08_read_my_recovery_notice(uuid)','3502ca4bdad1ba029b73b2b6c0a370af','jsonb','_notice uuid'),
  ('public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)','ddcdb478a4956181fc99dd8ebee80d0b','jsonb','_expected_tenant uuid, _notice uuid, _recipient uuid, _require_profile boolean'),
  ('public._exp08_require_recovery_audit()','defee9e1d221f1858669985f56ffad3d','void',''))
  expected(signature,hash,result,arguments) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(dependency.signature);
  IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>dependency.hash OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
   OR p.provolatile<>'v' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset
   OR p.prorettype<>pg_catalog.to_regtype(dependency.result) OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM dependency.arguments
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
   RAISE EXCEPTION 'EXP08 notice-state original eligibility drift: %',dependency.signature;
  END IF;
 END LOOP;
 target:=pg_catalog.to_regprocedure('public.set_my_owner_recovery_notice_read(uuid,boolean)');
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
  WHERE n.nspname='public' AND f.proname='set_my_owner_recovery_notice_read' AND f.oid IS DISTINCT FROM target::oid) THEN
  RAISE EXCEPTION 'EXP08 notice-state unsupported overload';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=target;
 IF FOUND THEN
  IF p.prosrc IS DISTINCT FROM body OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
   OR p.provolatile<>'v' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset
   OR p.prorettype<>'jsonb'::regtype OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_notice uuid, _is_read boolean'
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
   RAISE EXCEPTION 'EXP08 notice-state existing door drift';
  END IF;
 ELSE
  EXECUTE pg_catalog.format($create$CREATE FUNCTION public.set_my_owner_recovery_notice_read(_notice uuid,_is_read boolean)
   RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS %L$create$,body);
  REVOKE ALL ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) TO authenticated;
 END IF;
END $notice_state_patch$;

$replay$,'unchanged original read-state preparation replays');
SELECT is((SELECT to_jsonb(p) FROM pg_catalog.pg_proc p WHERE oid='public.set_my_owner_recovery_notice_read(uuid,boolean)'::regprocedure),(SELECT metadata FROM exp08_notice_installed),'read-state replay preserves actual native body and complete metadata');
GRANT EXECUTE ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) TO anon;
SELECT throws_ok($acl$
-- Canonical original notice-state SHA256 bbea6619dea05884a45e0c14d669172c04f2f215a08359e26c09b943fc6e1a85
-- INERT original R9 recipient read-state preparation, no version/apply/host activation.
-- Reuses original notifications and personal eligibility; no business grant or recovery effect.
DO $notice_state_patch$
DECLARE dependency record; p pg_catalog.pg_proc; target regprocedure;
 body constant text:=$notice_state_body$
DECLARE actor uuid:=auth.uid(); n public.notifications%ROWTYPE; verified jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF _notice IS NULL OR _is_read IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_STATE_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM public._exp08_require_recovery_audit();
 -- Same retirement/Auth/member/tenant/notice order as the original personal reader.
 -- One same-actor mark holds Auth UPDATE before the reader takes SHARE; two marks
 -- cannot both hold notice SHARE and deadlock while upgrading it to UPDATE.
 LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM public._exp08_read_my_recovery_notice(_notice);
 IF actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 UPDATE public.notifications SET is_read=_is_read,
   read_at=CASE WHEN _is_read THEN clock_timestamp() ELSE NULL END
  WHERE id=_notice AND user_id=actor AND
   (is_read IS DISTINCT FROM _is_read OR (_is_read AND read_at IS NULL) OR (NOT _is_read AND read_at IS NOT NULL))
 ;
 verified:=public._exp08_read_my_recovery_notice(_notice);
 -- RETURNING predates AFTER-trigger work. Read the actual stored state while
 -- the original eligibility/recipient locks are still held.
 SELECT * INTO n FROM public.notifications WHERE id=_notice AND user_id=actor;
 IF NOT FOUND OR actor IS DISTINCT FROM auth.uid() OR verified->>'notification_id' IS DISTINCT FROM _notice::text
  OR (verified->>'is_read')::boolean IS DISTINCT FROM _is_read OR n.is_read IS DISTINCT FROM _is_read
  OR (_is_read AND n.read_at IS NULL) OR (NOT _is_read AND n.read_at IS NOT NULL) THEN
  RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_STATE_UNKNOWN' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('notification_id',n.id,'is_read',n.is_read,'read_at',n.read_at);
END;
$notice_state_body$;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 notice-state installer requires postgres'; END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._exp08_read_my_recovery_notice(uuid)','3502ca4bdad1ba029b73b2b6c0a370af','jsonb','_notice uuid'),
  ('public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)','ddcdb478a4956181fc99dd8ebee80d0b','jsonb','_expected_tenant uuid, _notice uuid, _recipient uuid, _require_profile boolean'),
  ('public._exp08_require_recovery_audit()','defee9e1d221f1858669985f56ffad3d','void',''))
  expected(signature,hash,result,arguments) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(dependency.signature);
  IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>dependency.hash OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
   OR p.provolatile<>'v' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset
   OR p.prorettype<>pg_catalog.to_regtype(dependency.result) OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM dependency.arguments
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
   RAISE EXCEPTION 'EXP08 notice-state original eligibility drift: %',dependency.signature;
  END IF;
 END LOOP;
 target:=pg_catalog.to_regprocedure('public.set_my_owner_recovery_notice_read(uuid,boolean)');
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
  WHERE n.nspname='public' AND f.proname='set_my_owner_recovery_notice_read' AND f.oid IS DISTINCT FROM target::oid) THEN
  RAISE EXCEPTION 'EXP08 notice-state unsupported overload';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=target;
 IF FOUND THEN
  IF p.prosrc IS DISTINCT FROM body OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
   OR p.provolatile<>'v' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset
   OR p.prorettype<>'jsonb'::regtype OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_notice uuid, _is_read boolean'
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
   RAISE EXCEPTION 'EXP08 notice-state existing door drift';
  END IF;
 ELSE
  EXECUTE pg_catalog.format($create$CREATE FUNCTION public.set_my_owner_recovery_notice_read(_notice uuid,_is_read boolean)
   RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS %L$create$,body);
  REVOKE ALL ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) TO authenticated;
 END IF;
END $notice_state_patch$;

$acl$,'P0001','EXP08 notice-state existing door drift','unexpected own execute permission is refused rather than normalized');
SELECT ok(has_function_privilege('anon','public.set_my_owner_recovery_notice_read(uuid,boolean)','EXECUTE'),'refusal preserves the observed drift for diagnosis');
REVOKE EXECUTE ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) FROM anon;
ALTER FUNCTION public._exp08_read_my_recovery_notice(uuid) STRICT;
SELECT throws_ok($dependency$
-- Canonical original notice-state SHA256 bbea6619dea05884a45e0c14d669172c04f2f215a08359e26c09b943fc6e1a85
-- INERT original R9 recipient read-state preparation, no version/apply/host activation.
-- Reuses original notifications and personal eligibility; no business grant or recovery effect.
DO $notice_state_patch$
DECLARE dependency record; p pg_catalog.pg_proc; target regprocedure;
 body constant text:=$notice_state_body$
DECLARE actor uuid:=auth.uid(); n public.notifications%ROWTYPE; verified jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF _notice IS NULL OR _is_read IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_STATE_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM public._exp08_require_recovery_audit();
 -- Same retirement/Auth/member/tenant/notice order as the original personal reader.
 -- One same-actor mark holds Auth UPDATE before the reader takes SHARE; two marks
 -- cannot both hold notice SHARE and deadlock while upgrading it to UPDATE.
 LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM public._exp08_read_my_recovery_notice(_notice);
 IF actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 UPDATE public.notifications SET is_read=_is_read,
   read_at=CASE WHEN _is_read THEN clock_timestamp() ELSE NULL END
  WHERE id=_notice AND user_id=actor AND
   (is_read IS DISTINCT FROM _is_read OR (_is_read AND read_at IS NULL) OR (NOT _is_read AND read_at IS NOT NULL))
 ;
 verified:=public._exp08_read_my_recovery_notice(_notice);
 -- RETURNING predates AFTER-trigger work. Read the actual stored state while
 -- the original eligibility/recipient locks are still held.
 SELECT * INTO n FROM public.notifications WHERE id=_notice AND user_id=actor;
 IF NOT FOUND OR actor IS DISTINCT FROM auth.uid() OR verified->>'notification_id' IS DISTINCT FROM _notice::text
  OR (verified->>'is_read')::boolean IS DISTINCT FROM _is_read OR n.is_read IS DISTINCT FROM _is_read
  OR (_is_read AND n.read_at IS NULL) OR (NOT _is_read AND n.read_at IS NOT NULL) THEN
  RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_STATE_UNKNOWN' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('notification_id',n.id,'is_read',n.is_read,'read_at',n.read_at);
END;
$notice_state_body$;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 notice-state installer requires postgres'; END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._exp08_read_my_recovery_notice(uuid)','3502ca4bdad1ba029b73b2b6c0a370af','jsonb','_notice uuid'),
  ('public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)','ddcdb478a4956181fc99dd8ebee80d0b','jsonb','_expected_tenant uuid, _notice uuid, _recipient uuid, _require_profile boolean'),
  ('public._exp08_require_recovery_audit()','defee9e1d221f1858669985f56ffad3d','void',''))
  expected(signature,hash,result,arguments) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(dependency.signature);
  IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>dependency.hash OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
   OR p.provolatile<>'v' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset
   OR p.prorettype<>pg_catalog.to_regtype(dependency.result) OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM dependency.arguments
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
   RAISE EXCEPTION 'EXP08 notice-state original eligibility drift: %',dependency.signature;
  END IF;
 END LOOP;
 target:=pg_catalog.to_regprocedure('public.set_my_owner_recovery_notice_read(uuid,boolean)');
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
  WHERE n.nspname='public' AND f.proname='set_my_owner_recovery_notice_read' AND f.oid IS DISTINCT FROM target::oid) THEN
  RAISE EXCEPTION 'EXP08 notice-state unsupported overload';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=target;
 IF FOUND THEN
  IF p.prosrc IS DISTINCT FROM body OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
   OR p.provolatile<>'v' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset
   OR p.prorettype<>'jsonb'::regtype OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_notice uuid, _is_read boolean'
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
   RAISE EXCEPTION 'EXP08 notice-state existing door drift';
  END IF;
 ELSE
  EXECUTE pg_catalog.format($create$CREATE FUNCTION public.set_my_owner_recovery_notice_read(_notice uuid,_is_read boolean)
   RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS %L$create$,body);
  REVOKE ALL ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) TO authenticated;
 END IF;
END $notice_state_patch$;

$dependency$,'P0001','EXP08 notice-state original eligibility drift: public._exp08_read_my_recovery_notice(uuid)','changed original private eligibility blocks installation');
SELECT is((SELECT to_jsonb(p) FROM pg_catalog.pg_proc p WHERE oid='public.set_my_owner_recovery_notice_read(uuid,boolean)'::regprocedure),(SELECT metadata FROM exp08_notice_installed),'dependency refusal preserves the entire installed native door');
ALTER FUNCTION public._exp08_read_my_recovery_notice(uuid) CALLED ON NULL INPUT;
ALTER FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) STRICT;
SELECT throws_ok($metadata$
-- Canonical original notice-state SHA256 bbea6619dea05884a45e0c14d669172c04f2f215a08359e26c09b943fc6e1a85
-- INERT original R9 recipient read-state preparation, no version/apply/host activation.
-- Reuses original notifications and personal eligibility; no business grant or recovery effect.
DO $notice_state_patch$
DECLARE dependency record; p pg_catalog.pg_proc; target regprocedure;
 body constant text:=$notice_state_body$
DECLARE actor uuid:=auth.uid(); n public.notifications%ROWTYPE; verified jsonb;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF _notice IS NULL OR _is_read IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_STATE_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM public._exp08_require_recovery_audit();
 -- Same retirement/Auth/member/tenant/notice order as the original personal reader.
 -- One same-actor mark holds Auth UPDATE before the reader takes SHARE; two marks
 -- cannot both hold notice SHARE and deadlock while upgrading it to UPDATE.
 LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
 PERFORM 1 FROM auth.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM public._exp08_read_my_recovery_notice(_notice);
 IF actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 UPDATE public.notifications SET is_read=_is_read,
   read_at=CASE WHEN _is_read THEN clock_timestamp() ELSE NULL END
  WHERE id=_notice AND user_id=actor AND
   (is_read IS DISTINCT FROM _is_read OR (_is_read AND read_at IS NULL) OR (NOT _is_read AND read_at IS NOT NULL))
 ;
 verified:=public._exp08_read_my_recovery_notice(_notice);
 -- RETURNING predates AFTER-trigger work. Read the actual stored state while
 -- the original eligibility/recipient locks are still held.
 SELECT * INTO n FROM public.notifications WHERE id=_notice AND user_id=actor;
 IF NOT FOUND OR actor IS DISTINCT FROM auth.uid() OR verified->>'notification_id' IS DISTINCT FROM _notice::text
  OR (verified->>'is_read')::boolean IS DISTINCT FROM _is_read OR n.is_read IS DISTINCT FROM _is_read
  OR (_is_read AND n.read_at IS NULL) OR (NOT _is_read AND n.read_at IS NOT NULL) THEN
  RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_STATE_UNKNOWN' USING ERRCODE='40001';
 END IF;
 RETURN jsonb_build_object('notification_id',n.id,'is_read',n.is_read,'read_at',n.read_at);
END;
$notice_state_body$;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 notice-state installer requires postgres'; END IF;
 FOR dependency IN SELECT * FROM (VALUES
  ('public._exp08_read_my_recovery_notice(uuid)','3502ca4bdad1ba029b73b2b6c0a370af','jsonb','_notice uuid'),
  ('public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)','ddcdb478a4956181fc99dd8ebee80d0b','jsonb','_expected_tenant uuid, _notice uuid, _recipient uuid, _require_profile boolean'),
  ('public._exp08_require_recovery_audit()','defee9e1d221f1858669985f56ffad3d','void',''))
  expected(signature,hash,result,arguments) LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(dependency.signature);
  IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>dependency.hash OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
   OR p.provolatile<>'v' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset
   OR p.prorettype<>pg_catalog.to_regtype(dependency.result) OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM dependency.arguments
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' THEN
   RAISE EXCEPTION 'EXP08 notice-state original eligibility drift: %',dependency.signature;
  END IF;
 END LOOP;
 target:=pg_catalog.to_regprocedure('public.set_my_owner_recovery_notice_read(uuid,boolean)');
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid=f.pronamespace
  WHERE n.nspname='public' AND f.proname='set_my_owner_recovery_notice_read' AND f.oid IS DISTINCT FROM target::oid) THEN
  RAISE EXCEPTION 'EXP08 notice-state unsupported overload';
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=target;
 IF FOUND THEN
  IF p.prosrc IS DISTINCT FROM body OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.prokind<>'f'
   OR p.provolatile<>'v' OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.proretset
   OR p.prorettype<>'jsonb'::regtype OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_notice uuid, _is_read boolean'
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
   RAISE EXCEPTION 'EXP08 notice-state existing door drift';
  END IF;
 ELSE
  EXECUTE pg_catalog.format($create$CREATE FUNCTION public.set_my_owner_recovery_notice_read(_notice uuid,_is_read boolean)
   RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS %L$create$,body);
  REVOKE ALL ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) TO authenticated;
 END IF;
END $notice_state_patch$;

$metadata$,'P0001','EXP08 notice-state existing door drift','changed own metadata blocks replay');
SELECT ok((SELECT proisstrict FROM pg_catalog.pg_proc WHERE oid='public.set_my_owner_recovery_notice_read(uuid,boolean)'::regprocedure),'metadata refusal does not normalize the observed drift');
ALTER FUNCTION public.set_my_owner_recovery_notice_read(uuid,boolean) CALLED ON NULL INPUT;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.set_my_owner_recovery_notice_read(NULL,true)$$,'42501','permission denied for function set_my_owner_recovery_notice_read','anonymous native execute is actually denied');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.set_my_owner_recovery_notice_read(NULL,true)$$,'42501','permission denied for function set_my_owner_recovery_notice_read','service role cannot impersonate a personal notice recipient');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_my_owner_recovery_notice_read(NULL,true)$$,'42501','OWNER_RECOVERY_NOTICE_UNAVAILABLE','an authenticated SQL role without actual Auth identity is refused');
RESET ROLE;
CREATE TEMP TABLE exp08_notice_read_state_probe(kind text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON exp08_notice_read_state_probe TO authenticated;
-- Preserved original native39 SHA256 a1808f900497cabd135599326d309453d5171e712528eb8ec3a4afef23d8d5c2
-- Full replayed schema, original functions/triggers/RLS. Synthetic identities only.
-- Every write rolls back; this is engineering evidence, not customer authentication.


SELECT ok(has_function_privilege('authenticated','public.platform_owner_recovery(uuid,text,uuid,text,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.platform_owner_recovery(uuid,text,uuid,text,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.platform_owner_recovery(uuid,text,uuid,text,uuid)','EXECUTE'),
 'original recovery door admits authenticated body checks only');
SELECT ok(has_function_privilege('service_role','public.get_owner_recovery_delivery_event(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.get_owner_recovery_delivery_event(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.get_owner_recovery_delivery_event(uuid,uuid)','EXECUTE'),
 'delivery event has the separate original service principal ACL');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname LIKE '\_exp08\_%' ESCAPE '\'
 AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
  OR has_function_privilege('service_role',p.oid,'EXECUTE'))),
 'all private recovery kernels/helpers exclude direct client and service execution');

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO auth.users(id,aud,role,email) VALUES
 ('e8b00000-0000-4000-8000-000000000001','authenticated','authenticated','e8-recovery-operator@tests.invalid'),
 ('e8b00000-0000-4000-8000-000000000002','authenticated','authenticated','e8-recovery-owner@tests.invalid'),
 ('e8b00000-0000-4000-8000-000000000003','authenticated','authenticated','e8-recovery-target@tests.invalid'),
 ('e8b00000-0000-4000-8000-000000000004','authenticated','authenticated','e8-recovery-former@tests.invalid');
INSERT INTO public.user_roles(user_id,role) VALUES('e8b00000-0000-4000-8000-000000000001','super_admin') ON CONFLICT DO NOTHING;
INSERT INTO public.tenants(id,name,slug,account_type,owner_user_id) VALUES
 ('e8b00000-0000-4000-8000-000000000010','Recovery native probe','test-exp08-recovery-native-probe','standalone','e8b00000-0000-4000-8000-000000000004');
INSERT INTO public.tenant_members(tenant_id,user_id,status,role,is_owner) VALUES
 ('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000002','active','owner',true),
 ('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000003','active','owner',true);
INSERT INTO public.profiles(user_id,active_tenant_id)
 SELECT id,'e8b00000-0000-4000-8000-000000000010'::uuid FROM auth.users
 WHERE id IN('e8b00000-0000-4000-8000-000000000001','e8b00000-0000-4000-8000-000000000002','e8b00000-0000-4000-8000-000000000003')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
UPDATE public.profiles SET active_tenant_id=NULL WHERE user_id='e8b00000-0000-4000-8000-000000000004';
CREATE TEMP TABLE exp08_recovery_probe_ids(k text PRIMARY KEY,v uuid NOT NULL);
GRANT SELECT ON exp08_recovery_probe_ids TO authenticated,service_role;

SELECT set_config('request.jwt.claim.sub','e8b00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8b00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.platform_owner_recovery('e8b00000-0000-4000-8000-000000000010','set_account_holder',
 'e8b00000-0000-4000-8000-000000000003','Synthetic native recovery reason','e8b00000-0000-4000-8000-000000000020')->>'audit_id',
 'e8b00000-0000-4000-8000-000000000020','original authenticated recovery executes with stable native audit identity');
SELECT is(public.platform_owner_recovery('e8b00000-0000-4000-8000-000000000010','set_account_holder',
 'e8b00000-0000-4000-8000-000000000003','Synthetic native recovery reason','e8b00000-0000-4000-8000-000000000020')->>'audit_id',
 'e8b00000-0000-4000-8000-000000000020','same request reconciles original result after holder becomes working');
SELECT is(public.platform_owner_recovery_receipt('e8b00000-0000-4000-8000-000000000010',
 'e8b00000-0000-4000-8000-000000000020')->>'status','found','original operator reopens durable receipt without another effect');
SELECT is((SELECT count(*) FROM public.paige_audit_log WHERE id='e8b00000-0000-4000-8000-000000000020'),0::bigint,
 'even authenticated operator cannot read protected native audit row directly');
RESET ROLE;
SELECT is(public._tenant_account_holder_state('e8b00000-0000-4000-8000-000000000010'),'working',
 'the new-request negative exercises an actually working original account holder');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.platform_owner_recovery('e8b00000-0000-4000-8000-000000000010','set_account_holder',
 'e8b00000-0000-4000-8000-000000000003','Synthetic native recovery reason','e8b00000-0000-4000-8000-000000000021')$$,
 '42501','CO_OWNER_FORBIDDEN: current owner context required','new recovery refuses a now-working holder at the original first context gate');
RESET ROLE;
SELECT is((SELECT owner_user_id FROM public.tenants WHERE id='e8b00000-0000-4000-8000-000000000010'),
 'e8b00000-0000-4000-8000-000000000003'::uuid,'actual original tenant pointer reflects verified recovery');
SELECT is((SELECT count(*) FROM public.paige_audit_log WHERE action='tenant:owner_recovery.set_account_holder'
 AND tenant_id='e8b00000-0000-4000-8000-000000000010'),1::bigint,'retry has one original committed recovery event');
INSERT INTO exp08_recovery_probe_ids SELECT x->>'user_id',(x->>'notification_id')::uuid
 FROM public.paige_audit_log a CROSS JOIN LATERAL jsonb_array_elements(a.payload->'notices') x
 WHERE a.id='e8b00000-0000-4000-8000-000000000020';
SELECT is((SELECT count(*) FROM exp08_recovery_probe_ids),3::bigint,'actual native audience contains both owners and the former holder without a seat');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.notifications n JOIN exp08_recovery_probe_ids p ON p.v=n.id
 WHERE n.action_url IS NOT NULL OR n.title<>'Team ownership update' OR n.message<>'A team ownership change is available to review.'
 OR n.metadata<>jsonb_build_object('kind','exp08_owner_recovery','audit_id','e8b00000-0000-4000-8000-000000000020')),
 'native notification rows contain generic presentation and opaque binding only');

SELECT set_config('request.jwt.claim.sub','e8b00000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"sub":"e8b00000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
-- Inserted at the ORIGINAL native39 former-holder personal-read point.
-- Same synthetic recipient, original notice/audit and transaction; no added Auth rows.
INSERT INTO exp08_notice_read_state_probe VALUES('read',public.set_my_owner_recovery_notice_read((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004'),true));
SELECT is((SELECT array_agg(k ORDER BY k) FROM exp08_notice_read_state_probe p,jsonb_object_keys(p.value) k WHERE p.kind='read'),ARRAY['is_read','notification_id','read_at']::text[],'actual eligible recipient receives exactly the three native read-state fields');
SELECT ok((SELECT value->>'notification_id'=(SELECT v::text FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004') AND value->'is_read'='true'::jsonb AND value->'read_at'<>'null'::jsonb FROM exp08_notice_read_state_probe WHERE kind='read'),'native read receipt confirms requested original notice, true state and timestamp');
SELECT is((SELECT to_jsonb(read_at) FROM public.notifications WHERE id=(SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004')),(SELECT value->'read_at' FROM exp08_notice_read_state_probe WHERE kind='read'),'receipt timestamp equals actual stored native notification state');
INSERT INTO exp08_notice_read_state_probe SELECT 'tuple',to_jsonb(ctid::text) FROM public.notifications WHERE id=(SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004');
SELECT is(public.set_my_owner_recovery_notice_read((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004'),true),(SELECT value FROM exp08_notice_read_state_probe WHERE kind='read'),'same original read-state call returns the same native result and timestamp');
SELECT is((SELECT to_jsonb(ctid::text) FROM public.notifications WHERE id=(SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004')),(SELECT value FROM exp08_notice_read_state_probe WHERE kind='tuple'),'repeated same state creates no second native tuple write');
SELECT is(public.get_my_owner_recovery_notice((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004'))->'is_read','true'::jsonb,'original GET reconciles committed read state');
SELECT throws_ok($$SELECT public.set_my_owner_recovery_notice_read((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000002'),true)$$,'42501','OWNER_RECOVERY_NOTICE_UNAVAILABLE','actual recipient cannot mark another original recipient notice');
SELECT is((SELECT to_jsonb(ctid::text) FROM public.notifications WHERE id=(SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004')),(SELECT value FROM exp08_notice_read_state_probe WHERE kind='tuple'),'foreign refusal changes no tuple in the original own notice');
INSERT INTO exp08_notice_read_state_probe VALUES('unread',public.set_my_owner_recovery_notice_read((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004'),false));
SELECT ok((SELECT value->'is_read'='false'::jsonb AND value->'read_at'='null'::jsonb FROM exp08_notice_read_state_probe WHERE kind='unread'),'actual unread receipt clears the stored timestamp');
SELECT is(public.get_my_owner_recovery_notice((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004'))->'is_read','false'::jsonb,'same original GET reopens the native unread state');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id='e8b00000-0000-4000-8000-000000000004') AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id='e8b00000-0000-4000-8000-000000000004' AND active_tenant_id IS NOT NULL),'read/unread native effects give the former holder no seat or active workspace');
SELECT throws_ok($$SELECT public.set_my_owner_recovery_notice_read(NULL,true)$$,'22023','OWNER_RECOVERY_NOTICE_STATE_INVALID','actual recipient null input refuses through the native door');

SELECT is(public.get_my_owner_recovery_notice((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004'))->>'reason',
 'Synthetic native recovery reason','former holder reopens its own bounded event without a workspace or seat');
SELECT throws_ok($$SELECT public.get_my_owner_recovery_notice((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000002'))$$,
 '42501','OWNER_RECOVERY_NOTICE_UNAVAILABLE','personal context does not disclose another original recipient notice');
SELECT throws_ok($$SELECT public.get_owner_recovery_notice('e8b00000-0000-4000-8000-000000000010',
 (SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004'))$$,
 '42501','OWNER_RECOVERY_NOTICE_UNAVAILABLE','the original workspace-scoped reader still requires current workspace');
SELECT throws_ok($$SELECT public.get_owner_recovery_delivery_event('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')$$,
 '42501','permission denied for function get_owner_recovery_delivery_event','ordinary recipient cannot use the service event reader');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id='e8b00000-0000-4000-8000-000000000004')
 AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id='e8b00000-0000-4000-8000-000000000004' AND active_tenant_id IS NOT NULL),
 'personal event read does not grant membership or select a workspace');

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
-- The real registry permits exactly one super-admin and protects its last row.
-- Retain that protection; suspension exercises lost actor eligibility instead.
SELECT throws_ok($$DELETE FROM public.user_roles WHERE user_id='e8b00000-0000-4000-8000-000000000001' AND role='super_admin'$$,
 '42501','Refusing to remove the last super_admin (platform-owner lockout protection)',
 'native platform lockout protection remains effective during the recovery fixture');
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='e8b00000-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT is(public.get_owner_recovery_delivery_event('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')->>'event',
 'owner_recovery','service reads the original event after operator suspension without impersonation');
SELECT is(jsonb_array_length(public.get_owner_recovery_delivery_event('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')->'recipients'),
 3,'service returns only the three original recipient-notice bindings');
SELECT ok(NOT EXISTS(SELECT 1 FROM jsonb_object_keys(public.get_owner_recovery_delivery_event(
 'e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')) k
 WHERE k NOT IN('event','version','audit_id','tenant_id','action','recorded_at','recipients')),
 'service event excludes private reason, addresses, target and raw audit context');
SELECT throws_ok($$SELECT public.get_owner_recovery_delivery_event('e8b00000-0000-4000-8000-000000000099','e8b00000-0000-4000-8000-000000000020')$$,
 '42501','OWNER_RECOVERY_DELIVERY_UNAVAILABLE','service cannot substitute another business');
RESET ROLE;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='e8b00000-0000-4000-8000-000000000004';
SET LOCAL ROLE service_role;
SELECT ok(EXISTS(SELECT 1 FROM jsonb_array_elements(public.get_owner_recovery_delivery_event(
 'e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')->'recipients') x
 WHERE x->>'user_id'='e8b00000-0000-4000-8000-000000000004' AND x->>'eligible'='false'),
 'current Auth ban preserves only original identity for receipt reconciliation and denies eligibility');
RESET ROLE;
UPDATE auth.users SET banned_until=NULL WHERE id='e8b00000-0000-4000-8000-000000000004';
INSERT INTO public.tenant_members(tenant_id,user_id,status,role,is_owner) VALUES
 ('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000004','active','member',false);
SELECT set_config('request.jwt.claim.sub','e8b00000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"sub":"e8b00000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.get_my_owner_recovery_notice((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000004'))$$,
 '42501','OWNER_RECOVERY_NOTICE_UNAVAILABLE','changed reentry membership does not resurrect a stale former-holder grant');
RESET ROLE;
-- Restore this synthetic actor's live status, retaining the original registry.
-- Exercise whole original lifecycle APIs, not copies of their UPDATE statements.
UPDATE auth.users SET banned_until=NULL WHERE id='e8b00000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','e8b00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8b00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.operator_archive_account('e8b00000-0000-4000-8000-000000000010',
 public.operator_preview_account_archive('e8b00000-0000-4000-8000-000000000010')->>'version',
 'Recovery native probe','e8b00000-0000-4000-8000-000000000030')->>'state','archived',
 'canonical archive executes after recovery through the original permission and receipt');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT public.get_owner_recovery_delivery_event('e8b00000-0000-4000-8000-000000000010','e8b00000-0000-4000-8000-000000000020')$$,
 '42501','OWNER_RECOVERY_DELIVERY_UNAVAILABLE','archived native business refuses delivery-event access');
RESET ROLE;
SELECT is((SELECT count(*) FROM public.paige_audit_log WHERE action='tenant:owner_recovery.set_account_holder'
 AND tenant_id='e8b00000-0000-4000-8000-000000000010'),1::bigint,'all read/refusal/reentry checks leave one original recovery event');
SELECT is((SELECT count(*) FROM public.notifications WHERE id IN(SELECT v FROM exp08_recovery_probe_ids)),3::bigint,
 'event reads create no duplicate original in-app notices');
SELECT is((SELECT payload->>'email_status' FROM public.paige_audit_log WHERE id='e8b00000-0000-4000-8000-000000000020'),
 'not_requested','native recovery and event reads never claim an email send');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.paige_audit_log WHERE id='e8b00000-0000-4000-8000-000000000021'),
 'refused new recovery leaves no partial receipt');

SELECT set_config('request.jwt.claim.sub','e8b00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8b00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.operator_restore_archived_account('e8b00000-0000-4000-8000-000000000010',
 'e8b00000-0000-4000-8000-000000000030')->>'state','restored',
 'canonical restore retains its original native receipt after recovery');
RESET ROLE;
SELECT ok(EXISTS(SELECT 1 FROM public.tenants WHERE id='e8b00000-0000-4000-8000-000000000010'
 AND archived_at IS NULL AND lifecycle_execution_paused)
 AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE active_tenant_id='e8b00000-0000-4000-8000-000000000010'),
 'restore keeps execution paused and does not silently restore active workspace pointers');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE service_role;
SELECT is(public.get_owner_recovery_delivery_event('e8b00000-0000-4000-8000-000000000010',
 'e8b00000-0000-4000-8000-000000000020')->>'event','owner_recovery',
 'restored historical event read remains separate from execution or sender permission');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8b00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8b00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.operator_archive_account('e8b00000-0000-4000-8000-000000000010',
 public.operator_preview_account_archive('e8b00000-0000-4000-8000-000000000010')->>'version',
 'Recovery native probe','e8b00000-0000-4000-8000-000000000031')->>'state','archived',
 'canonical fresh archive has its own operation before permanent deletion');
SELECT is(public.operator_delete_archived_account('e8b00000-0000-4000-8000-000000000010',
 public.operator_preview_account_deletion('e8b00000-0000-4000-8000-000000000010')->>'version',
 'Recovery native probe','e8b00000-0000-4000-8000-000000000031')->>'state','deleted',
 'canonical permanent deletion returns the original verified native receipt');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM public.tenants WHERE id='e8b00000-0000-4000-8000-000000000010')
 AND NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id='e8b00000-0000-4000-8000-000000000010'),
 'canonical deletion removes the retired tenant and its memberships');
SELECT ok(EXISTS(SELECT 1 FROM public.paige_audit_log WHERE id='e8b00000-0000-4000-8000-000000000020'
 AND tenant_id IS NULL AND operator_rows_server_only AND payload->>'outcome'='effect_verified'),
 'canonical deletion retains the original recovery audit with server-only privacy');
SELECT set_config('request.jwt.claim.sub','e8b00000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"e8b00000-0000-4000-8000-000000000002","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.get_my_owner_recovery_notice((SELECT v FROM exp08_recovery_probe_ids WHERE k='e8b00000-0000-4000-8000-000000000002'))$$,
 '42501','OWNER_RECOVERY_NOTICE_UNAVAILABLE','retired native audit never grants private personal notice detail');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
