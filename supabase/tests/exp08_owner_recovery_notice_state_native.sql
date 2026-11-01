-- GENERATED from original notice-state template/source; execution UNVERIFIED.
-- Original personal notice read-state installation on the actual replayed schema.
-- Rollback-only; no Auth users, customer rows, provider or business effects.
BEGIN;
SELECT plan(16);
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
SELECT * FROM finish();
ROLLBACK;
