-- INERT original recovery/public-reader preparation; not a migration or activation.
-- Requires the reviewed original native transaction; no new writer/ledger/approval.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog;
DO $original_recovery_doors$
DECLARE s record; p pg_proc; signature regprocedure;
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 recovery installer requires postgres';END IF;
  IF EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
    WHERE n.nspname='public' AND f.proname IN('platform_owner_recovery','platform_owner_recovery_receipt','get_owner_recovery_notice')
      AND NOT (f.oid::regprocedure=ANY(array_remove(ARRAY[
        to_regprocedure('public.platform_owner_recovery(uuid,text,uuid,text,uuid)'),
        to_regprocedure('public.platform_owner_recovery(uuid,text,uuid,text)'),
        to_regprocedure('public.platform_owner_recovery_receipt(uuid,uuid)'),
        to_regprocedure('public.get_owner_recovery_notice(uuid,uuid)')],NULL)))) THEN
    RAISE EXCEPTION 'EXP08 original recovery unsupported overload';
  END IF;
  FOR s IN SELECT * FROM (VALUES
    ('public._exp08_lock_recovery_actor()','9692d6200993b8bf6d423db38c1b4d47','uuid',NULL::text[]),
    ('public._exp08_require_recovery_audit()','defee9e1d221f1858669985f56ffad3d','void',NULL::text[]),
    ('public._exp08_apply_owner_recovery(uuid,text,uuid,text,uuid)','b28866ce3be2085643433cf3ba104036','jsonb',ARRAY['_tenant','_act','_user','_reason','_request']),
    ('public._exp08_read_owner_recovery(uuid,uuid)','8930f6094db5dc87a55a693b06d60857','jsonb',ARRAY['_tenant','_request']),
    ('public._exp08_read_recovery_notice(uuid,uuid)','a16a4d793c2440aad2bd5b48cec2ee34','jsonb',ARRAY['_expected_tenant','_notice']),
    ('public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)','ddcdb478a4956181fc99dd8ebee80d0b','jsonb',ARRAY['_expected_tenant','_notice','_recipient','_require_profile'])
  ) v(signature,body_hash,result_type,argument_names) LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(s.signature);
    IF NOT FOUND OR md5(p.prosrc)<>s.body_hash OR p.proowner<>'postgres'::regrole
      OR NOT p.prosecdef OR p.provolatile<>'v' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR p.prokind<>'f' OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      OR p.prorettype IS DISTINCT FROM to_regtype(s.result_type) OR p.proretset OR p.proisstrict
      OR p.proleakproof OR p.proparallel<>'u' OR p.prosupport<>0 OR p.probin IS NOT NULL OR p.prosqlbody IS NOT NULL
      OR p.proargnames IS DISTINCT FROM s.argument_names OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL
      OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.provariadic<>0 OR p.procost<>100 OR p.prorows<>0
      OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
      RAISE EXCEPTION 'EXP08 original recovery door prerequisite drift: %',s.signature;
    END IF;
  END LOOP;
  PERFORM public._exp08_require_recovery_audit();
  -- The original four-argument door was specified but never released. An omitted
  -- stable request receives an authored refusal, never a fresh unrepeatable effect.
  FOR s IN SELECT * FROM (VALUES
    ('platform_owner_recovery','_tenant uuid,_act text,_user uuid,_reason text,_request uuid','uuid,text,uuid,text,uuid',
      $invoke$
BEGIN
  RETURN public._exp08_apply_owner_recovery(_tenant,_act,_user,_reason,_request);
END;
$invoke$),
    ('platform_owner_recovery','_tenant uuid,_act text,_user uuid,_reason text','uuid,text,uuid,text',
      $legacy$
BEGIN
  PERFORM public._exp08_lock_recovery_actor();
  RAISE EXCEPTION 'OWNER_RECOVERY_REQUEST_REQUIRED' USING ERRCODE='22023',
    HINT='Use the same stable request identifier for submission and outcome reconciliation.';
END;
$legacy$),
    ('platform_owner_recovery_receipt','_tenant uuid,_request uuid','uuid,uuid',
      $receipt$
BEGIN
  RETURN public._exp08_read_owner_recovery(_tenant,_request);
END;
$receipt$),
    ('get_owner_recovery_notice','_expected_tenant uuid,_notice uuid','uuid,uuid',
      $notice$
BEGIN
  RETURN public._exp08_read_recovery_notice(_expected_tenant,_notice);
END;
$notice$)
  ) v(name,arguments,types,body) LOOP
    signature:=to_regprocedure('public.'||s.name||'('||s.types||')');
    IF signature IS NULL THEN
      EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='''' AS %L',s.name,s.arguments,s.body);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated,service_role',s.name,s.types);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',s.name,s.types);
    END IF;
      -- Validate effective privileges and complete ABI on FIRST creation too;
      -- direct ACL entries alone cannot exclude inherited role access.
      SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.'||s.name||'('||s.types||')');
      IF p.prosrc IS DISTINCT FROM s.body OR p.proowner<>'postgres'::regrole
        OR NOT p.prosecdef OR p.provolatile<>'v' OR p.prorettype<>'jsonb'::regtype
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
        OR p.prokind<>'f' OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
        OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
        OR p.prosupport<>0 OR p.probin IS NOT NULL OR p.prosqlbody IS NOT NULL
        OR p.proargnames IS DISTINCT FROM ARRAY(SELECT split_part(btrim(a),' ',1) FROM unnest(string_to_array(s.arguments,',')) a)
        OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL
        OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.provariadic<>0 OR p.procost<>100 OR p.prorows<>0
        OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
        OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE')
        OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee NOT IN(p.proowner,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE'
            OR (a.is_grantable AND a.grantee<>p.proowner)) THEN
        RAISE EXCEPTION 'EXP08 original recovery public door drift: %',s.name;
      END IF;
  END LOOP;
END;
$original_recovery_doors$;
COMMIT;
