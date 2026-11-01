-- INERT original recovery/public-reader preparation; not a migration or activation.
-- Requires the reviewed original native transaction; no new writer/ledger/approval.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog;
DO $original_recovery_doors$
DECLARE s record; p pg_proc; signature regprocedure;
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 recovery installer requires postgres';END IF;
  FOR s IN SELECT * FROM (VALUES
    ('public._exp08_lock_recovery_actor()','9692d6200993b8bf6d423db38c1b4d47'),
    ('public._exp08_apply_owner_recovery(uuid,text,uuid,text,uuid)','b28866ce3be2085643433cf3ba104036'),
    ('public._exp08_read_owner_recovery(uuid,uuid)','8930f6094db5dc87a55a693b06d60857'),
    ('public._exp08_read_recovery_notice(uuid,uuid)','06f8a39a3ff415d97e0b6aa8aad91d20')
  ) v(signature,body_hash) LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(s.signature);
    IF NOT FOUND OR md5(p.prosrc)<>s.body_hash OR p.proowner<>'postgres'::regrole
      OR NOT p.prosecdef OR p.provolatile<>'v' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
      RAISE EXCEPTION 'EXP08 original recovery door prerequisite drift: %',s.signature;
    END IF;
  END LOOP;
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
    IF signature IS NOT NULL THEN
      SELECT * INTO p FROM pg_proc WHERE oid=signature;
      IF p.prosrc IS DISTINCT FROM s.body OR p.proowner<>'postgres'::regrole
        OR NOT p.prosecdef OR p.provolatile<>'v' OR p.prorettype<>'jsonb'::regtype
        OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
        OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
        OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee NOT IN(p.proowner,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE'
            OR (a.is_grantable AND a.grantee<>p.proowner)) THEN
        RAISE EXCEPTION 'EXP08 original recovery public door drift: %',s.name;
      END IF;
    ELSE
      EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='''' AS %L',s.name,s.arguments,s.body);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated,service_role',s.name,s.types);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',s.name,s.types);
    END IF;
  END LOOP;
END;
$original_recovery_doors$;
COMMIT;
