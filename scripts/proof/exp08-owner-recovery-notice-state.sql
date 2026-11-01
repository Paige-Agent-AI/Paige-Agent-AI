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
  RETURNING * INTO n;
 IF NOT FOUND THEN
  SELECT * INTO n FROM public.notifications WHERE id=_notice AND user_id=actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_STATE_UNKNOWN' USING ERRCODE='40001'; END IF;
 END IF;
 verified:=public._exp08_read_my_recovery_notice(_notice);
 IF actor IS DISTINCT FROM auth.uid() OR verified->>'notification_id' IS DISTINCT FROM _notice::text
  OR (verified->>'is_read')::boolean IS DISTINCT FROM _is_read OR n.is_read IS DISTINCT FROM _is_read THEN
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
