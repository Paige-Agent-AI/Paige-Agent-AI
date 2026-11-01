-- INERT local candidate: original owner-recovery audit namespace only.
-- This is NOT a migration, a recovery writer, an authenticated receipt or an activation.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog;
DO $recovery_provenance$
DECLARE
 target regclass:=to_regclass('public.paige_audit_log');
 policy_name constant text:='exp08_owner_recovery_native_rows';
 expected_expression constant text:='(NOT starts_with(action, ''tenant:owner_recovery.''::text))';
 body constant text:=$body$
BEGIN
 IF EXISTS(SELECT 1 FROM public.paige_audit_log
   WHERE pg_catalog.starts_with(action,'tenant:owner_recovery.')) THEN
  RAISE EXCEPTION 'OWNER_RECOVERY_AUDIT_RETAINED: recovery audit records must be retained'
   USING ERRCODE='42501';
 END IF;
 RETURN NULL;
END;
$body$;
 original_metadata jsonb; after_metadata jsonb;
 f pg_proc; pol pg_policy; tr pg_trigger; objects integer; client_roles oid[];
BEGIN
 IF target IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=target
   AND c.relkind='r' AND c.relowner='postgres'::regrole AND c.relrowsecurity
   AND NOT c.relforcerowsecurity) THEN
  RAISE EXCEPTION 'EXP08 recovery provenance requires original postgres-owned RLS audit table';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=target AND attname='action'
   AND atttypid='text'::regtype AND attnotnull AND attnum>0 AND NOT attisdropped) THEN
  RAISE EXCEPTION 'EXP08 recovery provenance original audit action column drift';
 END IF;
 SELECT array_agg(oid ORDER BY oid) INTO client_roles FROM pg_roles
  WHERE rolname IN ('anon','authenticated');
 IF cardinality(client_roles)<>2 OR client_roles IS NULL OR EXISTS(
  SELECT 1 FROM pg_roles c WHERE c.oid=ANY(client_roles) AND
   (c.rolsuper OR c.rolbypassrls OR EXISTS(SELECT 1 FROM pg_roles elevated
     WHERE (elevated.rolsuper OR elevated.rolbypassrls OR elevated.oid='postgres'::regrole)
      AND pg_has_role(c.oid,elevated.oid,'MEMBER')))) THEN
  RAISE EXCEPTION 'EXP08 recovery provenance requires original non-bypass client roles';
 END IF;

 -- Serialize bootstrap against client writes; never hide, delete or bless old rows.
 LOCK TABLE public.paige_audit_log IN SHARE ROW EXCLUSIVE MODE;
 SELECT jsonb_build_object('table',jsonb_build_object('oid',c.oid,'owner',c.relowner,
   'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity),
  'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a
    WHERE a.attrelid=target AND a.attnum>0),
  'constraints',(SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.oid),'[]') FROM pg_constraint k WHERE k.conrelid=target),
  'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.polname),'[]') FROM pg_policy p
    WHERE p.polrelid=target AND p.polname<>policy_name),
  'triggers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.tgname),'[]') FROM pg_trigger t
    WHERE t.tgrelid=target AND t.tgname<>'trg_owner_recovery_audit_truncate'))
 INTO original_metadata FROM pg_class c WHERE c.oid=target;

 SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.guard_owner_recovery_audit_truncate()');
 SELECT * INTO pol FROM pg_policy WHERE polrelid=target AND polname=policy_name;
 SELECT * INTO tr FROM pg_trigger WHERE tgrelid=target AND tgname='trg_owner_recovery_audit_truncate';
 objects:=(f.oid IS NOT NULL)::int+(pol.oid IS NOT NULL)::int+(tr.oid IS NOT NULL)::int;
 IF objects NOT IN (0,3) THEN RAISE EXCEPTION 'EXP08 recovery provenance incomplete original boundary'; END IF;
 IF objects=0 THEN
  IF EXISTS(SELECT 1 FROM public.paige_audit_log
    WHERE pg_catalog.starts_with(action,'tenant:owner_recovery.')) THEN
   RAISE EXCEPTION 'EXP08 recovery provenance refuses preexisting untrusted recovery rows';
  END IF;
  EXECUTE format('CREATE FUNCTION public.guard_owner_recovery_audit_truncate() RETURNS trigger
   LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='''' AS %L',body);
  REVOKE ALL ON FUNCTION public.guard_owner_recovery_audit_truncate() FROM PUBLIC,anon,authenticated,service_role;
  CREATE POLICY exp08_owner_recovery_native_rows ON public.paige_audit_log
   AS RESTRICTIVE FOR ALL TO anon,authenticated
   USING (NOT pg_catalog.starts_with(action,'tenant:owner_recovery.'))
   WITH CHECK (NOT pg_catalog.starts_with(action,'tenant:owner_recovery.'));
  CREATE TRIGGER trg_owner_recovery_audit_truncate BEFORE TRUNCATE ON public.paige_audit_log
   FOR EACH STATEMENT EXECUTE FUNCTION public.guard_owner_recovery_audit_truncate();
 END IF;

 SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public.guard_owner_recovery_audit_truncate()');
 SELECT * INTO pol FROM pg_policy WHERE polrelid=target AND polname=policy_name;
 SELECT * INTO tr FROM pg_trigger WHERE tgrelid=target AND tgname='trg_owner_recovery_audit_truncate';
 IF f.proowner IS DISTINCT FROM 'postgres'::regrole OR f.prosrc IS DISTINCT FROM body
   OR NOT f.prosecdef OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.proleakproof
   OR f.prokind<>'f' OR f.proisstrict OR f.provariadic<>0 OR f.prosupport<>0
   OR f.proargnames IS NOT NULL OR f.proallargtypes IS NOT NULL OR f.proargmodes IS NOT NULL
   OR f.proargdefaults IS NOT NULL OR f.procost<>100 OR f.prorows<>0
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR f.prorettype<>'trigger'::regtype OR f.proretset OR f.pronargs<>0 OR f.pronargdefaults<>0
   OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
     WHERE a.grantee<>f.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
     WHERE a.grantee=f.proowner AND a.privilege_type='EXECUTE') THEN
  RAISE EXCEPTION 'EXP08 recovery provenance private guard source or metadata drift';
 END IF;
 IF pol.polcmd IS DISTINCT FROM '*'::"char" OR pol.polpermissive IS DISTINCT FROM false
   -- PostgreSQL retains input order here; require the exact complete role set.
   OR ARRAY(SELECT role_oid FROM unnest(pol.polroles) r(role_oid) ORDER BY role_oid)
     IS DISTINCT FROM client_roles
   OR pg_get_expr(pol.polqual,pol.polrelid) IS DISTINCT FROM expected_expression
   OR pg_get_expr(pol.polwithcheck,pol.polrelid) IS DISTINCT FROM expected_expression THEN
  RAISE EXCEPTION 'EXP08 recovery provenance client policy drift (%)',
   jsonb_build_object('roles',pol.polroles,'expected_roles',client_roles,
    'using',pg_get_expr(pol.polqual,pol.polrelid),'check',pg_get_expr(pol.polwithcheck,pol.polrelid),
    'command',pol.polcmd,'permissive',pol.polpermissive);
 END IF;
 IF tr.tgfoid IS DISTINCT FROM f.oid OR tr.tgtype IS DISTINCT FROM 34::smallint
   OR tr.tgenabled IS DISTINCT FROM 'O'::"char" OR tr.tgisinternal OR tr.tgnargs<>0
   OR tr.tgqual IS NOT NULL OR tr.tgargs IS DISTINCT FROM ''::bytea
   OR tr.tgconstraint<>0 OR tr.tgdeferrable OR tr.tginitdeferred
   OR tr.tgattr::text<>'' OR tr.tgoldtable IS NOT NULL OR tr.tgnewtable IS NOT NULL THEN
  RAISE EXCEPTION 'EXP08 recovery provenance truncate trigger drift';
 END IF;

 SELECT jsonb_build_object('table',jsonb_build_object('oid',c.oid,'owner',c.relowner,
   'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity),
  'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM pg_attribute a
    WHERE a.attrelid=target AND a.attnum>0),
  'constraints',(SELECT coalesce(jsonb_agg(to_jsonb(k) ORDER BY k.oid),'[]') FROM pg_constraint k WHERE k.conrelid=target),
  'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.polname),'[]') FROM pg_policy p
    WHERE p.polrelid=target AND p.polname<>policy_name),
  'triggers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.tgname),'[]') FROM pg_trigger t
    WHERE t.tgrelid=target AND t.tgname<>'trg_owner_recovery_audit_truncate'))
 INTO after_metadata FROM pg_class c WHERE c.oid=target;
 IF after_metadata IS DISTINCT FROM original_metadata THEN
  RAISE EXCEPTION 'EXP08 recovery provenance changed unrelated original audit metadata';
 END IF;
END $recovery_provenance$;
COMMIT;
