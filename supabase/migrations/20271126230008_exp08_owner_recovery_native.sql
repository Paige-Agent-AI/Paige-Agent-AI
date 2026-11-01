-- EXP08 original owner recovery: prospective guarded native carrier.
-- Generated once from the original reviewed atomic components; their embedded
-- preparation comments describe their source context, not this carrier's state.
-- Never rewrite after application. Changes require a new guarded forward carrier.
-- Requires current exact-head review/CI, real schema proof and normal native order.
-- No provider/email dispatch, automatic recovery or new approval/result authority.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog;
DO $exp08_bundle_preflight$
DECLARE s record; p pg_proc; present integer:=0; kernels integer; doors integer;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 recovery bundle requires postgres';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
  WHERE n.nspname='public' AND f.proname=ANY(ARRAY['_exp08_prepare_owner_change','_exp08_lock_recovery_actor','_exp08_lock_owner_recovery','_exp08_set_recovery_holder','_exp08_require_recovery_audit','_exp08_read_owner_recovery','_exp08_lock_recovery_effect','_exp08_record_recovery_notices','_exp08_read_recovery_notice_for_recipient','_exp08_read_recovery_notice','_exp08_read_my_recovery_notice','_exp08_read_recovery_delivery_event','_exp08_apply_owner_recovery','_exp08_grant_co_owner','_exp08_revoke_co_owner','grant_co_owner','revoke_co_owner'])
   AND NOT (f.oid::regprocedure=ANY(array_remove(ARRAY[to_regprocedure('public._exp08_prepare_owner_change(uuid,uuid,text,boolean)'),to_regprocedure('public._exp08_lock_recovery_actor()'),to_regprocedure('public._exp08_lock_owner_recovery(uuid)'),to_regprocedure('public._exp08_set_recovery_holder(uuid,uuid)'),to_regprocedure('public._exp08_require_recovery_audit()'),to_regprocedure('public._exp08_read_owner_recovery(uuid,uuid)'),to_regprocedure('public._exp08_lock_recovery_effect(uuid,uuid,uuid,text)'),to_regprocedure('public._exp08_record_recovery_notices(uuid,uuid)'),to_regprocedure('public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)'),to_regprocedure('public._exp08_read_recovery_notice(uuid,uuid)'),to_regprocedure('public._exp08_read_my_recovery_notice(uuid)'),to_regprocedure('public._exp08_read_recovery_delivery_event(uuid,uuid)'),to_regprocedure('public._exp08_apply_owner_recovery(uuid,text,uuid,text,uuid)'),to_regprocedure('public._exp08_grant_co_owner(uuid,uuid,boolean)'),to_regprocedure('public._exp08_revoke_co_owner(uuid,uuid,uuid)'),to_regprocedure('public.grant_co_owner(uuid,uuid)'),to_regprocedure('public.revoke_co_owner(uuid,uuid)')],NULL)))) THEN
  RAISE EXCEPTION 'EXP08 recovery bundle unsupported original/private overload';
 END IF;
 FOR s IN SELECT * FROM (VALUES ('public._exp08_prepare_owner_change(uuid,uuid,text,boolean)','a2ff0de800693b78a405248b169b53ed','void',ARRAY['_tenant','_target','_act','_recovery']),
('public._exp08_lock_recovery_actor()','9692d6200993b8bf6d423db38c1b4d47','uuid',NULL::text[]),
('public._exp08_lock_owner_recovery(uuid)','167f4b8f8c3258c03f3e85802bc842b3','uuid',ARRAY['_tenant']),
('public._exp08_set_recovery_holder(uuid,uuid)','c203eb8e9f6bb2498ab6b9047adff169','uuid',ARRAY['_tenant','_user']),
('public._exp08_require_recovery_audit()','defee9e1d221f1858669985f56ffad3d','void',NULL::text[]),
('public._exp08_read_owner_recovery(uuid,uuid)','8930f6094db5dc87a55a693b06d60857','jsonb',ARRAY['_tenant','_request']),
('public._exp08_lock_recovery_effect(uuid,uuid,uuid,text)','b34a0ca159e146090a7b2370badab19a','uuid',ARRAY['_tenant','_user','_request','_act']),
('public._exp08_record_recovery_notices(uuid,uuid)','d8292ada178b6ef275e7bc4e0608b501','void',ARRAY['_tenant','_request']),
('public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)','ddcdb478a4956181fc99dd8ebee80d0b','jsonb',ARRAY['_expected_tenant','_notice','_recipient','_require_profile']),
('public._exp08_read_recovery_notice(uuid,uuid)','a16a4d793c2440aad2bd5b48cec2ee34','jsonb',ARRAY['_expected_tenant','_notice']),
('public._exp08_read_my_recovery_notice(uuid)','3502ca4bdad1ba029b73b2b6c0a370af','jsonb',ARRAY['_notice']),
('public._exp08_read_recovery_delivery_event(uuid,uuid)','ab105e060e570fc095c24f4602f1cca5','jsonb',ARRAY['_tenant','_audit']),
('public._exp08_apply_owner_recovery(uuid,text,uuid,text,uuid)','b28866ce3be2085643433cf3ba104036','jsonb',ARRAY['_tenant','_act','_user','_reason','_request'])) v(signature,body_hash,result_type,argument_names) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(s.signature);
  IF FOUND THEN
   present:=present+1;
   IF md5(p.prosrc)<>s.body_hash OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
    OR p.prokind<>'f' OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
    OR p.provolatile<>'v' OR p.prorettype IS DISTINCT FROM to_regtype(s.result_type)
    OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
    OR p.prosupport<>0 OR p.probin IS NOT NULL OR p.prosqlbody IS NOT NULL
    OR p.proargnames IS DISTINCT FROM s.argument_names OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL
    OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL OR p.provariadic<>0 OR p.procost<>100 OR p.prorows<>0
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
     RAISE EXCEPTION 'EXP08 recovery bundle preflight drift: %',s.signature;
   END IF;
  END IF;
 END LOOP;
 -- The two kernels retain original search_path/ABI and are conserved by their
 -- component guards. Validate their complete execution metadata before any DDL,
 -- alongside the original public owner doors whose OID/ACL must be preserved.
 FOR s IN SELECT * FROM (VALUES
  ('public.grant_co_owner(uuid,uuid)',ARRAY['_tenant','_user'],false),
  ('public.revoke_co_owner(uuid,uuid)',ARRAY['_tenant','_user'],false),
  ('public._exp08_grant_co_owner(uuid,uuid,boolean)',ARRAY['_tenant','_user','_recovery'],true),
  ('public._exp08_revoke_co_owner(uuid,uuid,uuid)',ARRAY['_tenant','_user','_recovery_request'],true)
 ) v(signature,argument_names,is_private) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(s.signature);
  IF NOT FOUND THEN
   IF NOT s.is_private THEN RAISE EXCEPTION 'EXP08 recovery bundle original owner door missing: %',s.signature;END IF;
   CONTINUE;
  END IF;
  IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.prokind<>'f'
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR p.provolatile<>'v' OR p.prorettype<>'void'::regtype
   OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prosupport<>0
   OR p.probin IS NOT NULL OR p.prosqlbody IS NOT NULL OR p.proargnames IS DISTINCT FROM s.argument_names
   OR p.proallargtypes IS NOT NULL OR p.proargmodes IS NOT NULL OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL
   OR p.provariadic<>0 OR p.procost<>100 OR p.prorows<>0 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE NOT(a.grantee=ANY(CASE WHEN s.is_private THEN ARRAY[p.proowner] ELSE ARRAY[p.proowner,'authenticated'::regrole,'service_role'::regrole] END))
     OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR (NOT s.is_private AND (NOT has_function_privilege('authenticated',p.oid,'EXECUTE') OR NOT has_function_privilege('service_role',p.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'EXP08 recovery bundle original/kernel metadata drift: %',s.signature;
  END IF;
 END LOOP;
 SELECT count(*) INTO kernels FROM pg_proc WHERE oid IN(
  to_regprocedure('public._exp08_grant_co_owner(uuid,uuid,boolean)'),to_regprocedure('public._exp08_revoke_co_owner(uuid,uuid,uuid)'));
 SELECT count(*) INTO doors FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
  WHERE n.nspname='public' AND f.proname IN('platform_owner_recovery','platform_owner_recovery_receipt','get_owner_recovery_notice','get_my_owner_recovery_notice','get_owner_recovery_delivery_event');
 IF NOT ((present=0 AND kernels=0 AND doors=0) OR (present=13 AND kernels=2 AND doors=6)) THEN
  RAISE EXCEPTION 'EXP08 recovery bundle partial installation: reconcile before changing source';
 END IF;
END $exp08_bundle_preflight$;
-- ORIGINAL COMPONENT exp08-owner-recovery-provenance.sql SHA256 28d123723a8c4ef1e2c344fffd30f2e320905c5b8da6cb9d6bd9fba4de7612c7
-- INERT local candidate: original owner-recovery audit namespace only.
-- This is NOT a migration, a recovery writer, an authenticated receipt or an activation.

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

-- ORIGINAL COMPONENT exp08-owner-recovery-writers.sql SHA256 388597368cad7d3189f978e101939812e105ea2649b5b311f637b080109b860f
-- INERT local recovery writer preparation. NOT a migration or a public recovery endpoint.
-- The original holder-state and eligibility helpers are reused, never reimplemented here.
-- The first private lock step alone produces no effect, audit, notification or receipt.
-- The later private R12 effect is incomplete until composed into the original recovery transaction.
-- Mechanical context/lock prelude for the original owner doors, not another authority resolver.
CREATE OR REPLACE FUNCTION public._exp08_prepare_owner_change(_tenant uuid,_target uuid,_act text,_recovery boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE actor uuid:=auth.uid(); seats uuid[]; old_holder uuid; allowed boolean;
BEGIN
  IF _tenant IS NULL OR _recovery IS NULL OR _act IS NULL
    OR _act NOT IN ('grant_owner','revoke_owner','set_account_holder') THEN
    RAISE EXCEPTION 'CO_OWNER_BAD_ARGS' USING ERRCODE='22023';
  END IF;
  IF NOT _recovery AND public._solo_shell_tenant(_tenant) IS DISTINCT FROM true THEN RETURN;END IF;
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=statement_timestamp())) THEN
    RAISE EXCEPTION 'CO_OWNER_IDENTITY_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF _recovery THEN
    allowed:=public.is_super_admin(actor) AND public._solo_shell_tenant(_tenant)
      AND public._tenant_account_holder_state(_tenant)='none';
  ELSE
    allowed:=EXISTS(SELECT 1 FROM public.profiles WHERE user_id=actor AND active_tenant_id=_tenant)
      AND (public.is_tenant_account_holder(actor,_tenant)
        OR (_act='revoke_owner' AND actor=_target AND public.is_tenant_owner(actor,_tenant)));
  END IF;
  IF allowed IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'CO_OWNER_FORBIDDEN: current owner context required' USING ERRCODE='42501';
  END IF;
  SELECT owner_user_id INTO old_holder FROM public.tenants WHERE id=_tenant;
  SELECT coalesce(array_agg(user_id ORDER BY user_id),'{}'::uuid[]) INTO seats FROM public.tenant_members WHERE tenant_id=_tenant;
  -- Match the original retirement table gate before taking row locks. Ordinary DML remains compatible.
  LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
  -- Match original Hub identity locks BEFORE membership/profile locks, including notice recipients.
  PERFORM 1 FROM auth.users WHERE id=ANY(array_remove(seats||ARRAY[actor,old_holder],NULL)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=ANY(seats) ORDER BY user_id FOR UPDATE;
  IF NOT _recovery THEN
    PERFORM 1 FROM public.profiles WHERE user_id=actor AND active_tenant_id=_tenant FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CO_OWNER_SCOPE_CHANGED' USING ERRCODE='42501';END IF;
  END IF;
  PERFORM 1 FROM public.tenants WHERE id=_tenant AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND OR old_holder IS DISTINCT FROM (SELECT owner_user_id FROM public.tenants WHERE id=_tenant)
    OR seats IS DISTINCT FROM (SELECT coalesce(array_agg(user_id ORDER BY user_id),'{}'::uuid[]) FROM public.tenant_members WHERE tenant_id=_tenant) THEN
    RAISE EXCEPTION 'CO_OWNER_SCOPE_CHANGED' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=statement_timestamp())) THEN
    RAISE EXCEPTION 'CO_OWNER_IDENTITY_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF _recovery THEN
    allowed:=public.is_super_admin(actor) AND public._tenant_account_holder_state(_tenant)='none';
  ELSE
    allowed:=public.is_tenant_account_holder(actor,_tenant)
      OR (_act='revoke_owner' AND actor=_target AND public.is_tenant_owner(actor,_tenant));
  END IF;
  IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'CO_OWNER_FORBIDDEN' USING ERRCODE='42501';END IF;
  IF _act='grant_owner' AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=_target AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=statement_timestamp())) THEN
    RAISE EXCEPTION 'CO_OWNER_TARGET_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_prepare_owner_change(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._exp08_lock_recovery_actor()
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.is_super_admin(actor) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=statement_timestamp()) FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role='super_admin' FOR SHARE;
  IF NOT FOUND OR NOT public.is_super_admin(actor) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  RETURN actor;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_lock_recovery_actor()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._exp08_lock_owner_recovery(_tenant uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := public._exp08_lock_recovery_actor();
  previous_holder uuid;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  -- Preserve the original owner writer's members -> tenant lock order.
  PERFORM 1 FROM public.tenant_members
    WHERE tenant_id=_tenant AND is_owner AND status='active'
    ORDER BY id FOR UPDATE;
  SELECT owner_user_id INTO previous_holder FROM public.tenants
    WHERE id=_tenant FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  -- Every earlier wait may have changed the tenant or its authority. Re-read now.
  IF public._exp08_lock_recovery_actor() IS DISTINCT FROM actor
    OR NOT public.is_super_admin(actor)
    OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL
      AND (banned_until IS NULL OR banned_until<=statement_timestamp()))
    OR public._solo_shell_tenant(_tenant) IS DISTINCT FROM true
    OR public._tenant_account_holder_state(_tenant) IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  RETURN previous_holder;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_lock_owner_recovery(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Private R12 effect for the future original recovery transaction. No client EXECUTE.
-- The outer transaction still owes recovery audit, private notices and durable replay.
CREATE OR REPLACE FUNCTION public._exp08_set_recovery_holder(_tenant uuid,_user uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  previous_holder uuid;
  previous_flag text := current_setting('paige.owner_recovery',true);
BEGIN
  previous_holder := public._exp08_lock_owner_recovery(_tenant);
  IF _user IS NULL THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_TARGET_NOT_ACTIVE_OWNER' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM auth.users WHERE id=_user AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=statement_timestamp()) FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_TARGET_NOT_ACTIVE_OWNER' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_user
    AND is_owner AND status='active' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_TARGET_NOT_ACTIVE_OWNER' USING ERRCODE='42501';
  END IF;
  -- The target wait can also change the precondition; no cached holder-none authority.
  PERFORM public._exp08_lock_owner_recovery(_tenant);
  BEGIN
    PERFORM set_config('paige.owner_recovery','on',true);
    UPDATE public.tenants SET owner_user_id=_user WHERE id=_tenant;
    PERFORM set_config('paige.owner_recovery',coalesce(previous_flag,''),true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('paige.owner_recovery',coalesce(previous_flag,''),true);
    RAISE;
  END;
  IF public._tenant_account_holder_state(_tenant) IS DISTINCT FROM 'working' THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_RESULT_UNVERIFIED' USING ERRCODE='42501';
  END IF;
  RETURN previous_holder;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_set_recovery_holder(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Move the ORIGINAL grant body into one private kernel; the public ABI delegates.
-- This is local preparation only. The public recovery transaction is still absent.
DO $grant_kernel$
DECLARE
  p pg_proc;
  original_definition text;
  original_body text;
  kernel_body text;
  before_metadata jsonb;
  wrapper constant text := E'\nBEGIN\n  PERFORM public._exp08_prepare_owner_change(_tenant,_user,''grant_owner'',false);\n  PERFORM public._exp08_grant_co_owner(_tenant,_user,false);\nEND;\n';
  old_platform constant text := '_is_platform boolean := public.is_platform_owner();';
  new_platform constant text := '_is_platform boolean := public.is_platform_owner() AND NOT public._solo_shell_tenant(_tenant);';
  old_begin constant text := E'BEGIN\n  IF _caller IS NULL THEN';
  new_begin constant text := E'BEGIN\n  -- exp08_recovery_grant_kernel_v1: private mode, never a caller flag.\n  IF _recovery IS NULL THEN\n    RAISE EXCEPTION ''OWNER_RECOVERY_FORBIDDEN'' USING ERRCODE=''42501'';\n  ELSIF _recovery THEN\n    PERFORM public._exp08_lock_owner_recovery(_tenant);\n    _is_platform := true;\n  END IF;\n  IF _caller IS NULL THEN';
  old_target constant text := '  -- Elevate ONLY an existing, active member of THIS tenant.';
  new_target constant text := E'  IF _recovery THEN\n    PERFORM 1 FROM auth.users WHERE id=_user AND deleted_at IS NULL\n      AND (banned_until IS NULL OR banned_until<=statement_timestamp()) FOR SHARE;\n    IF NOT FOUND THEN\n      RAISE EXCEPTION ''CO_OWNER_NOT_ACTIVE_MEMBER'' USING ERRCODE=''42501'';\n    END IF;\n    PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_user FOR UPDATE;\n    PERFORM public._exp08_lock_owner_recovery(_tenant);\n  END IF;\n  -- Elevate ONLY an existing, active member of THIS tenant.';
BEGIN
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.grant_co_owner(uuid,uuid)');
  IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
    OR p.provolatile<>'v' OR p.proretset OR p.prorettype<>'void'::regtype
    OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_user']::text[]
    OR p.pronargdefaults<>0 OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole,'service_role'::regrole)
        OR a.privilege_type<>'EXECUTE' OR (a.is_grantable AND a.grantee<>p.proowner))
    OR NOT has_function_privilege('postgres',p.oid,'EXECUTE')
    OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'EXP08 recovery original grant metadata drift';
  END IF;
  IF p.prosrc=wrapper THEN
    SELECT prosrc INTO kernel_body FROM pg_proc
      WHERE oid=to_regprocedure('public._exp08_grant_co_owner(uuid,uuid,boolean)');
    original_body:=replace(replace(replace(kernel_body,new_platform,old_platform),new_begin,old_begin),new_target,old_target);
    IF md5(original_body) IS DISTINCT FROM '2a75180de63325dd7e328a73e494e6dc'
      OR (length(kernel_body)-length(replace(kernel_body,new_platform,'')))/length(new_platform)<>1
      OR (length(kernel_body)-length(replace(kernel_body,new_begin,'')))/length(new_begin)<>1
      OR (length(kernel_body)-length(replace(kernel_body,new_target,'')))/length(new_target)<>1
      OR kernel_body IS DISTINCT FROM replace(replace(replace(original_body,
        old_platform,new_platform),old_begin,new_begin),old_target,new_target) THEN
      RAISE EXCEPTION 'EXP08 recovery grant kernel replay drift';
    END IF;
  ELSE
    IF md5(p.prosrc)<>'2a75180de63325dd7e328a73e494e6dc'
      OR to_regprocedure('public._exp08_grant_co_owner(uuid,uuid,boolean)') IS NOT NULL THEN
      RAISE EXCEPTION 'EXP08 recovery grant original source or partial kernel drift';
    END IF;
    original_body:=p.prosrc;
    kernel_body:=replace(replace(replace(original_body,old_platform,new_platform),old_begin,new_begin),old_target,new_target);
    IF kernel_body=original_body OR
      replace(replace(replace(kernel_body,new_platform,old_platform),new_begin,old_begin),new_target,old_target)<>original_body THEN
      RAISE EXCEPTION 'EXP08 recovery grant exact original-body conservation failed';
    END IF;
    original_definition:=pg_get_functiondef(p.oid);
    before_metadata:=to_jsonb(p)-'prosrc';
    EXECUTE replace(replace(original_definition,
      'public.grant_co_owner(_tenant uuid, _user uuid)',
      'public._exp08_grant_co_owner(_tenant uuid, _user uuid, _recovery boolean)'),original_body,kernel_body);
    REVOKE ALL ON FUNCTION public._exp08_grant_co_owner(uuid,uuid,boolean)
      FROM PUBLIC,anon,authenticated,service_role;
    EXECUTE replace(original_definition,original_body,wrapper);
    IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=p.oid) IS DISTINCT FROM before_metadata THEN
      RAISE EXCEPTION 'EXP08 recovery original public grant metadata changed';
    END IF;
  END IF;
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public._exp08_grant_co_owner(uuid,uuid,boolean)');
  IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
    OR p.proretset OR p.prorettype<>'void'::regtype OR p.pronargdefaults<>0
    OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_user','_recovery']::text[]
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
    OR NOT has_function_privilege('postgres',p.oid,'EXECUTE') THEN
    RAISE EXCEPTION 'EXP08 recovery private grant metadata or ACL drift';
  END IF;
END;
$grant_kernel$;

-- Original audit is the durable receipt; no second operation/result table.
-- Private operator receipt only. Current recipient/private-notice readers remain separate work.
CREATE OR REPLACE FUNCTION public._exp08_require_recovery_audit()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid='public.paige_audit_log'::regclass
    AND c.relowner='postgres'::regrole AND c.relrowsecurity AND NOT c.relforcerowsecurity)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid='public.paige_audit_log'::regclass
      AND p.polname='exp08_owner_recovery_native_rows' AND NOT p.polpermissive AND p.polcmd='*'
      AND ARRAY(SELECT x FROM unnest(p.polroles) r(x) ORDER BY x)=
        ARRAY(SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY oid)
      AND pg_catalog.pg_get_expr(p.polqual,p.polrelid)='(NOT starts_with(action, ''tenant:owner_recovery.''::text))'
      AND pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)='(NOT starts_with(action, ''tenant:owner_recovery.''::text))')
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc f ON f.oid=t.tgfoid
      WHERE t.tgrelid='public.paige_audit_log'::regclass AND t.tgname='trg_owner_recovery_audit_truncate'
      AND t.tgenabled='O' AND t.tgtype=34 AND NOT t.tgisinternal
      AND f.oid=to_regprocedure('public.guard_owner_recovery_audit_truncate()')
      AND f.proowner='postgres'::regrole AND f.prosecdef
      AND md5(f.prosrc)='10797adfc24d314cdd592312eed9c3ab'
      AND f.proconfig=ARRAY['search_path=""']::text[]
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
        WHERE a.grantee<>f.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_AUDIT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_require_recovery_audit()
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._exp08_read_owner_recovery(_tenant uuid,_request uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE actor uuid := public._exp08_lock_recovery_actor(); a public.paige_audit_log%ROWTYPE;
BEGIN
  PERFORM public._exp08_require_recovery_audit();
  IF _tenant IS NULL OR _request IS NULL THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_BAD_REQUEST' USING ERRCODE='22023';
  END IF;
  SELECT * INTO a FROM public.paige_audit_log WHERE id=_request;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','request_id',_request);END IF;
  IF a.tenant_id IS DISTINCT FROM _tenant OR a.actor_user_id IS DISTINCT FROM actor
    OR a.actor_role IS DISTINCT FROM 'super_admin'
    OR a.action NOT IN ('tenant:owner_recovery.grant_owner','tenant:owner_recovery.set_account_holder','tenant:owner_recovery.revoke_owner')
    OR a.payload->>'request_id' IS DISTINCT FROM _request::text
    OR a.payload->>'outcome' IS DISTINCT FROM 'effect_verified' THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_RECEIPT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('status','found','audit_id',a.id,'tenant_id',a.tenant_id,
    'action',a.action,'target_user_id',a.target_id,
    'receipt',a.payload-ARRAY['transaction_id','backend_pid']::text[],'recorded_at',a.created_at);
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_read_owner_recovery(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Effect-time domain integration only, never a post-commit receipt/delivery predicate.
CREATE OR REPLACE FUNCTION public._exp08_lock_recovery_effect(
  _tenant uuid,_user uuid,_request uuid,_act text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE actor uuid := public._exp08_lock_recovery_actor(); a public.paige_audit_log%ROWTYPE;
BEGIN
  PERFORM public._exp08_require_recovery_audit();
  PERFORM public._exp08_lock_owner_recovery(_tenant);
  SELECT * INTO a FROM public.paige_audit_log WHERE id=_request FOR UPDATE;
  IF NOT FOUND OR _user IS NULL OR _request IS NULL OR _act IS NULL
    OR _act NOT IN ('grant_owner','revoke_owner','set_account_holder')
    OR a.actor_user_id IS DISTINCT FROM actor OR a.actor_role IS DISTINCT FROM 'super_admin'
    OR a.tenant_id IS DISTINCT FROM _tenant OR a.target_id IS DISTINCT FROM _user
    OR a.action IS DISTINCT FROM 'tenant:owner_recovery.'||_act
    OR a.payload->>'request_id' IS DISTINCT FROM _request::text
    OR a.payload->>'target' IS DISTINCT FROM _user::text
    OR a.payload->>'outcome' IS DISTINCT FROM 'preparing'
    OR a.payload->>'transaction_id' IS DISTINCT FROM pg_current_xact_id()::text
    OR a.payload->>'backend_pid' IS DISTINCT FROM pg_backend_pid()::text THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_EFFECT_CONTEXT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  RETURN actor;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_lock_recovery_effect(uuid,uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;

-- Native in-app records only. Raw legacy notification surfaces get no private recovery detail.
CREATE OR REPLACE FUNCTION public._exp08_record_recovery_notices(_tenant uuid,_request uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := public._exp08_lock_recovery_actor(); a public.paige_audit_log%ROWTYPE;
  recipient uuid; notice uuid; notices jsonb := '[]'; notified jsonb := '[]'; membership jsonb;
BEGIN
  PERFORM public._exp08_require_recovery_audit();
  SELECT * INTO a FROM public.paige_audit_log WHERE id=_request FOR UPDATE;
  IF NOT FOUND OR a.tenant_id IS DISTINCT FROM _tenant OR a.actor_user_id IS DISTINCT FROM actor
    OR a.actor_role IS DISTINCT FROM 'super_admin'
    OR a.action NOT IN ('tenant:owner_recovery.grant_owner','tenant:owner_recovery.revoke_owner','tenant:owner_recovery.set_account_holder')
    OR a.payload->>'outcome' IS DISTINCT FROM 'effect_verified'
    OR a.payload->>'transaction_id' IS DISTINCT FROM pg_current_xact_id()::text
    OR a.payload->>'backend_pid' IS DISTINCT FROM pg_backend_pid()::text THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_CONTEXT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF a.payload->>'notice_status' IN ('in_app_recorded','no_recipients') THEN RETURN;END IF;
  IF a.payload->>'notice_status' IS DISTINCT FROM 'not_prepared' THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_CONTEXT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  FOR recipient IN SELECT u.id FROM auth.users u WHERE u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp())
    AND u.id IN (SELECT user_id FROM public.tenant_members WHERE tenant_id=_tenant AND is_owner AND status='active'
      UNION SELECT (a.payload->>'previous_owner_user_id')::uuid)
    ORDER BY u.id FOR SHARE LOOP
    SELECT jsonb_build_object('id',m.id,'status',m.status,'is_owner',m.is_owner,'role',m.role,'updated_at',m.updated_at)
      INTO membership FROM public.tenant_members m WHERE tenant_id=_tenant AND user_id=recipient;
    notice := gen_random_uuid();
    INSERT INTO public.notifications(id,user_id,type,title,message,action_url,is_read,metadata)
      VALUES(notice,recipient,'system','Team ownership update','A team ownership change is available to review.',NULL,false,
        jsonb_build_object('kind','exp08_owner_recovery','audit_id',_request));
    notices:=notices||jsonb_build_array(jsonb_build_object('user_id',recipient,'notification_id',notice,
      'audience',CASE WHEN recipient=(a.payload->>'previous_owner_user_id')::uuid THEN 'holder_of_record' ELSE 'active_owner' END,
      'membership',membership));
    notified:=notified||jsonb_build_array(recipient);
  END LOOP;
  UPDATE public.paige_audit_log SET payload=payload||jsonb_build_object('notices',notices,'notified',notified,
    'notice_status',CASE WHEN jsonb_array_length(notices)=0 THEN 'no_recipients' ELSE 'in_app_recorded' END,
    'email_status','not_requested') WHERE id=_request;
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_record_recovery_notices(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- ONE original recipient predicate. Customer wrapper supplies auth.uid()/true;
-- the personal notice wrapper derives native scope and supplies auth.uid()/false.
-- A future service event reader supplies only a native bound recipient/false.
-- This private flag is never client input or authority to execute recovery.
CREATE OR REPLACE FUNCTION public._exp08_read_recovery_notice_for_recipient(
  _expected_tenant uuid,_notice uuid,_recipient uuid,_require_profile boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := _recipient; n public.notifications%ROWTYPE; a public.paige_audit_log%ROWTYPE;
  member_state jsonb; binding jsonb; business_name text; active_owner boolean := false;
BEGIN
  PERFORM public._exp08_require_recovery_audit();
  IF actor IS NULL OR _require_profile IS NULL THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  -- Original retirement acquires its table gate before member/profile rows.
  -- Match it before taking recipient locks, without blocking ordinary tenant DML.
  LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
  PERFORM 1 FROM auth.users WHERE id=actor AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=statement_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  SELECT jsonb_build_object('id',m.id,'status',m.status,'is_owner',m.is_owner,'role',m.role,'updated_at',m.updated_at),
    m.is_owner AND m.status='active' INTO member_state,active_owner FROM public.tenant_members m
    WHERE tenant_id=_expected_tenant AND user_id=actor FOR SHARE;
  -- Original removal locks membership before clearing this same profile pointer.
  -- Even an eventually refused stale reader must retain that order.
  IF _require_profile THEN
    PERFORM 1 FROM public.profiles WHERE user_id=actor AND active_tenant_id=_expected_tenant FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  END IF;
  SELECT name INTO business_name FROM public.tenants WHERE id=_expected_tenant AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND OR public._solo_shell_tenant(_expected_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  SELECT * INTO n FROM public.notifications WHERE id=_notice AND user_id=actor FOR SHARE;
  IF NOT FOUND OR n.metadata->>'kind' IS DISTINCT FROM 'exp08_owner_recovery' THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF coalesce(n.metadata->>'audit_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  SELECT * INTO a FROM public.paige_audit_log WHERE id=(n.metadata->>'audit_id')::uuid FOR SHARE;
  IF NOT FOUND OR a.tenant_id IS DISTINCT FROM _expected_tenant OR a.actor_role IS DISTINCT FROM 'super_admin'
    OR a.payload->>'outcome' IS DISTINCT FROM 'effect_verified'
    OR a.action NOT IN ('tenant:owner_recovery.grant_owner','tenant:owner_recovery.revoke_owner','tenant:owner_recovery.set_account_holder') THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  SELECT x INTO binding FROM jsonb_array_elements(a.payload->'notices') x
    WHERE x->>'user_id'=actor::text AND x->>'notification_id'=_notice::text;
  IF binding IS NULL OR (coalesce(active_owner,false) OR
    (binding->>'audience'='holder_of_record' AND a.payload->>'previous_owner_user_id'=actor::text
      AND binding->'membership' IS NOT DISTINCT FROM coalesce(member_state,'null'::jsonb))) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('audit_id',a.id,'notification_id',n.id,'tenant_id',a.tenant_id,
    'business_name',business_name,'action',a.action,'target_user_id',a.target_id,
    'reason',a.payload->>'reason','recorded_at',a.created_at,'is_read',n.is_read);
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._exp08_read_recovery_notice(_expected_tenant uuid,_notice uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  RETURN public._exp08_read_recovery_notice_for_recipient(_expected_tenant,_notice,auth.uid(),true);
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_read_recovery_notice(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Personal notification context only: derive the business from this actual user's
-- native notice. This does not select a workspace or grant any business surface.
CREATE OR REPLACE FUNCTION public._exp08_read_my_recovery_notice(_notice uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE actor uuid:=auth.uid(); n public.notifications%ROWTYPE; tenant uuid;
BEGIN
  PERFORM public._exp08_require_recovery_audit();
  IF actor IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  -- No early row locks: the common predicate acquires the retirement table gate
  -- and revalidates BOTH rows after recipient/tenant locks in the original order.
  SELECT * INTO n FROM public.notifications WHERE id=_notice AND user_id=actor;
  IF NOT FOUND OR n.metadata->>'kind' IS DISTINCT FROM 'exp08_owner_recovery'
    OR coalesce(n.metadata->>'audit_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  SELECT tenant_id INTO tenant FROM public.paige_audit_log WHERE id=(n.metadata->>'audit_id')::uuid;
  IF tenant IS NULL THEN RAISE EXCEPTION 'OWNER_RECOVERY_NOTICE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  RETURN public._exp08_read_recovery_notice_for_recipient(tenant,_notice,actor,false);
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_read_my_recovery_notice(uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- Original Communications consumer only. The public service wrapper admits two
-- native IDs, never an actor, address, reason, recipient list or recovery flag.
-- This is a read of a COMMITTED event, not another recovery admission or sender.
CREATE OR REPLACE FUNCTION public._exp08_read_recovery_delivery_event(_tenant uuid,_audit uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  a public.paige_audit_log%ROWTYPE; current_event public.paige_audit_log%ROWTYPE;
  binding jsonb; recipients jsonb := '[]'; recipient_ids uuid[]; notice_ids uuid[];
  eligible boolean;
BEGIN
  PERFORM public._exp08_require_recovery_audit();
  IF _tenant IS NULL OR _audit IS NULL THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_DELIVERY_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
  -- Snapshot only: never lock the audit ahead of native recipient/member rows.
  SELECT * INTO a FROM public.paige_audit_log WHERE id=_audit AND tenant_id=_tenant;
  IF NOT FOUND OR a.actor_role IS DISTINCT FROM 'super_admin'
    OR a.action NOT IN ('tenant:owner_recovery.grant_owner','tenant:owner_recovery.revoke_owner','tenant:owner_recovery.set_account_holder')
    OR a.payload->>'request_id' IS DISTINCT FROM _audit::text
    OR a.payload->>'outcome' IS DISTINCT FROM 'effect_verified'
    OR coalesce(a.payload->>'notice_status','') NOT IN ('in_app_recorded','no_recipients')
    OR jsonb_typeof(a.payload->'notices') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_DELIVERY_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(a.payload->'notices') x
    WHERE coalesce(x->>'user_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR coalesce(x->>'notification_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_DELIVERY_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  SELECT array_agg((x->>'user_id')::uuid ORDER BY (x->>'user_id')::uuid),
    array_agg((x->>'notification_id')::uuid ORDER BY (x->>'notification_id')::uuid)
    INTO recipient_ids,notice_ids FROM jsonb_array_elements(a.payload->'notices') x;
  IF (SELECT count(DISTINCT u) FROM unnest(recipient_ids) u)<>coalesce(cardinality(recipient_ids),0)
    OR (SELECT count(DISTINCT n) FROM unnest(notice_ids) n)<>coalesce(cardinality(notice_ids),0)
    OR ((a.payload->>'notice_status'='no_recipients') IS DISTINCT FROM (coalesce(cardinality(recipient_ids),0)=0)) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_DELIVERY_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  -- Lock the WHOLE recorded audience before any tenant/notice/audit row, in the
  -- same order as recovery. No per-recipient subtransaction may release these.
  PERFORM 1 FROM auth.users WHERE id=ANY(recipient_ids) ORDER BY id FOR SHARE;
  PERFORM 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=ANY(recipient_ids)
    ORDER BY user_id FOR SHARE;
  PERFORM 1 FROM public.tenants WHERE id=_tenant AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND OR public._solo_shell_tenant(_tenant) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_DELIVERY_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.notifications WHERE id=ANY(notice_ids) ORDER BY id FOR SHARE;
  SELECT * INTO current_event FROM public.paige_audit_log WHERE id=_audit FOR SHARE;
  IF NOT FOUND OR to_jsonb(current_event) IS DISTINCT FROM to_jsonb(a) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_DELIVERY_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  FOR binding IN SELECT x FROM jsonb_array_elements(a.payload->'notices') x ORDER BY x->>'user_id' LOOP
    eligible:=true;
    BEGIN
      PERFORM public._exp08_read_recovery_notice_for_recipient(
        _tenant,(binding->>'notification_id')::uuid,(binding->>'user_id')::uuid,false);
    EXCEPTION WHEN SQLSTATE '42501' THEN
      IF SQLERRM<>'OWNER_RECOVERY_NOTICE_UNAVAILABLE' THEN RAISE;END IF;
      eligible:=false;
    END;
    -- Ineligible recorded identities remain available ONLY for original sender
    -- receipt reconciliation. They confer no dispatch or current business access.
    recipients:=recipients||jsonb_build_array(jsonb_build_object(
      'user_id',binding->>'user_id','notification_id',binding->>'notification_id','eligible',eligible));
  END LOOP;
  RETURN jsonb_build_object('event','owner_recovery','version',1,'audit_id',a.id,
    'tenant_id',a.tenant_id,'action',a.action,'recorded_at',a.created_at,'recipients',recipients);
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_read_recovery_delivery_event(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._exp08_apply_owner_recovery(
  _tenant uuid,_act text,_user uuid,_reason text,_request uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  actor uuid := auth.uid();
  reason text := btrim(_reason);
  previous_holder uuid;
  a public.paige_audit_log%ROWTYPE;
BEGIN
  PERFORM public._exp08_require_recovery_audit();
  IF _tenant IS NULL OR _user IS NULL OR _request IS NULL OR _act IS NULL
    OR _act NOT IN ('grant_owner','revoke_owner','set_account_holder')
    OR reason IS NULL OR char_length(reason) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_BAD_REQUEST' USING ERRCODE='22023';
  END IF;
  IF actor IS NULL OR NOT public.is_super_admin(actor) THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('exp08_owner_recovery_request:'||_request::text,0));
  SELECT * INTO a FROM public.paige_audit_log WHERE id=_request;
  IF FOUND THEN
    IF a.actor_user_id IS DISTINCT FROM actor OR a.tenant_id IS DISTINCT FROM _tenant
      OR a.action IS DISTINCT FROM 'tenant:owner_recovery.'||_act OR a.target_id IS DISTINCT FROM _user
      OR a.payload->>'reason' IS DISTINCT FROM reason THEN
      RAISE EXCEPTION 'OWNER_RECOVERY_REQUEST_MISMATCH' USING ERRCODE='42501';
    END IF;
    -- Post-act working state is valid receipt/replay, not a new recovery admission.
    RETURN public._exp08_read_owner_recovery(_tenant,_request);
  END IF;
  PERFORM public._exp08_prepare_owner_change(_tenant,_user,_act,true);
  actor:=public._exp08_lock_recovery_actor();
  previous_holder := public._exp08_lock_owner_recovery(_tenant);
  -- Reserve the native identity BEFORE effects, in this same transaction/backend.
  -- A dependent private domain writer can bind to this actual row, never caller JSON/GUC.
  INSERT INTO public.paige_audit_log(id,actor_user_id,actor_role,action,target_type,target_id,tenant_id,payload)
  VALUES(_request,actor,'super_admin','tenant:owner_recovery.'||_act,'user',_user,_tenant,
    jsonb_build_object('request_id',_request,'reason',reason,'target',_user,
      'previous_owner_user_id',previous_holder,'outcome','preparing',
      'transaction_id',pg_current_xact_id()::text,'backend_pid',pg_backend_pid(),
      'notice_status','not_prepared','notified','[]'::jsonb));
  IF _act='grant_owner' THEN
    PERFORM public._exp08_grant_co_owner(_tenant,_user,true);
    IF NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant
      AND user_id=_user AND is_owner AND status='active' AND role='owner') THEN
      RAISE EXCEPTION 'OWNER_RECOVERY_RESULT_UNVERIFIED' USING ERRCODE='42501';
    END IF;
  ELSIF _act='set_account_holder' THEN
    PERFORM public._exp08_set_recovery_holder(_tenant,_user);
  ELSE
    IF to_regprocedure('public._exp08_revoke_co_owner(uuid,uuid,uuid)') IS NULL THEN
      RAISE EXCEPTION 'OWNER_RECOVERY_REVOKE_UNAVAILABLE' USING ERRCODE='42501';
    END IF;
    PERFORM public._exp08_revoke_co_owner(_tenant,_user,_request);
    IF NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_user
      AND NOT is_owner AND role='admin' AND status='active' AND business_owner_id IS NULL) THEN
      RAISE EXCEPTION 'OWNER_RECOVERY_RESULT_UNVERIFIED' USING ERRCODE='42501';
    END IF;
  END IF;
  UPDATE public.paige_audit_log SET payload=jsonb_set(payload,'{outcome}','"effect_verified"'::jsonb)
    WHERE id=_request AND tenant_id=_tenant AND actor_user_id=actor AND target_id=_user
      AND action='tenant:owner_recovery.'||_act AND payload->>'outcome'='preparing'
      AND payload->>'transaction_id'=pg_current_xact_id()::text
      AND payload->>'backend_pid'=pg_backend_pid()::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OWNER_RECOVERY_RESULT_UNVERIFIED' USING ERRCODE='42501';
  END IF;
  PERFORM public._exp08_record_recovery_notices(_tenant,_request);
  RETURN public._exp08_read_owner_recovery(_tenant,_request);
END;
$function$;
REVOKE ALL ON FUNCTION public._exp08_apply_owner_recovery(uuid,text,uuid,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role;

-- ORIGINAL COMPONENT exp02-billing-recovery.sql SHA256 b2638ef3001dc5bcbea5a418fd9cf9bae046b9c2f00b8685fc26018b39e9cdb3
-- INERT preparation, not a migration or recovery activation. Original EXP08 ABI65264 required.
-- One original Billing revoke body, private native recovery consumer, no client/service grant.

SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog;
DO $billing_recovery$
DECLARE
  p pg_proc; spec record; original_body text; kernel_body text; definition text; before_metadata jsonb;
  present integer;
  wrapper constant text := E'\nBEGIN\n  RETURN public._exp02_billing_contact_revoke(p_contact_id,NULL,NULL,NULL);\nEND;\n';
  old_scope constant text := 'public.platform_billing_workspace_owner_scope()';
  new_scope constant text := 'public._exp02_billing_revoke_scope(p_recovery_tenant,p_recovery_user,p_recovery_request)';
  old_select constant text := '  SELECT r.designation, r.user_id INTO _des, _uid';
  new_select constant text := E'  -- Recovery binds and locks the original target before reading its designation.\n'
    '  IF p_recovery_request IS NOT NULL THEN\n'
    '    PERFORM 1 FROM public.platform_billing_contacts r\n'
    '      WHERE r.id=p_contact_id AND r.tenant_id=_t AND r.user_id=p_recovery_user AND r.revoked_at IS NULL FOR UPDATE;\n'
    '    IF NOT FOUND THEN\n'
    '      RAISE EXCEPTION ''billing_contact_not_found'' USING ERRCODE=''P0002'';\n'
    '    END IF;\n'
    '    PERFORM public._exp02_billing_revoke_scope(p_recovery_tenant,p_recovery_user,p_recovery_request);\n'
    '  END IF;\n'
    '  SELECT r.designation, r.user_id INTO _des, _uid';
  old_actor constant text := 'VALUES (auth.uid(), ''owner'', ''platform_billing_contact_revoked''';
  new_actor constant text := 'VALUES (auth.uid(), CASE WHEN p_recovery_request IS NULL THEN ''owner'' ELSE ''super_admin'' END, ''platform_billing_contact_revoked''';
  old_payload constant text := 'jsonb_build_object(''designation'', _des, ''recipient_user_id'', _uid));';
  new_payload constant text := 'jsonb_build_object(''designation'', _des, ''recipient_user_id'', _uid)'
    ' || CASE WHEN p_recovery_request IS NULL THEN ''{}''::jsonb'
    ' ELSE jsonb_build_object(''owner_recovery_request_id'',p_recovery_request) END);';
  scope_body constant text := $scope$
DECLARE actual_actor uuid;
BEGIN
  IF p_recovery_tenant IS NULL AND p_recovery_user IS NULL AND p_recovery_request IS NULL THEN
    RETURN public.platform_billing_workspace_owner_scope();
  END IF;
  IF p_recovery_tenant IS NULL OR p_recovery_user IS NULL OR p_recovery_request IS NULL THEN
    RAISE EXCEPTION 'billing_recovery_context_unavailable' USING ERRCODE='42501';
  END IF;
  actual_actor := public._exp08_lock_recovery_effect(p_recovery_tenant,p_recovery_user,p_recovery_request,'revoke_owner');
  IF actual_actor IS NULL OR actual_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'billing_recovery_context_unavailable' USING ERRCODE='42501';
  END IF;
  -- Original Billing applicability, not another ownership/recovery authority resolver.
  IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_recovery_tenant
    AND t.parent_tenant_id IS NULL AND t.account_type NOT IN ('agency','enterprise','sub_account')) THEN
    RAISE EXCEPTION 'billing_not_applicable' USING ERRCODE='42501';
  END IF;
  RETURN p_recovery_tenant;
END;
$scope$;
  cleanup_body constant text := $cleanup$
DECLARE contact_id uuid; audit_id uuid; result jsonb;
  contacts uuid[] := '{}'; audits uuid[] := '{}';
BEGIN
  IF p_tenant IS NULL OR p_user IS NULL OR p_request IS NULL THEN
    RAISE EXCEPTION 'billing_recovery_context_unavailable' USING ERRCODE='42501';
  END IF;
  PERFORM public._exp02_billing_revoke_scope(p_tenant,p_user,p_request);
  PERFORM pg_advisory_xact_lock(hashtextextended('platform_billing_contacts:'||p_tenant::text,0));
  PERFORM public._exp02_billing_revoke_scope(p_tenant,p_user,p_request);
  FOR contact_id IN SELECT r.id FROM public.platform_billing_contacts r
    WHERE r.tenant_id=p_tenant AND r.user_id=p_user AND r.revoked_at IS NULL ORDER BY r.id FOR UPDATE
  LOOP
    result := public._exp02_billing_contact_revoke(contact_id,p_tenant,p_user,p_request);
    IF result->>'id' IS DISTINCT FROM contact_id::text OR result->'revoked' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'billing_recovery_result_unverified' USING ERRCODE='42501';
    END IF;
    SELECT a.id INTO STRICT audit_id FROM public.paige_audit_log a
      WHERE a.tenant_id=p_tenant AND a.actor_user_id=auth.uid() AND a.actor_role='super_admin'
        AND a.action='platform_billing_contact_revoked' AND a.target_id=contact_id
        AND a.payload->>'owner_recovery_request_id'=p_request::text;
    contacts := array_append(contacts,contact_id); audits := array_append(audits,audit_id);
  END LOOP;
  PERFORM public._exp02_billing_revoke_scope(p_tenant,p_user,p_request);
  IF EXISTS(SELECT 1 FROM public.platform_billing_contacts WHERE tenant_id=p_tenant AND user_id=p_user AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'billing_recovery_result_unverified' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('status',CASE WHEN cardinality(contacts)=0 THEN 'not_required' ELSE 'revoked' END,
    'contact_ids',to_jsonb(contacts),'audit_ids',to_jsonb(audits));
END;
$cleanup$;
BEGIN
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.platform_billing_workspace_owner_scope()');
  IF NOT FOUND OR md5(p.prosrc) IS DISTINCT FROM '3d33a31f95f308784853f7b3816b1e8c'
    OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'s'
    OR p.prorettype<>'uuid'::regtype OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR p.proacl IS NULL OR (SELECT count(*) FROM aclexplode(p.proacl))<>1
    OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee<>p.proowner
      OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
    RAISE EXCEPTION 'EXP02 original Billing scope drift' USING ERRCODE='23514';
  END IF;
  -- Compatibility only: the actual EXP08 gate still enforces actor/tenant/request at every call.
  FOR spec IN SELECT * FROM (VALUES
    ('public._exp08_lock_recovery_actor()', '9692d6200993b8bf6d423db38c1b4d47', 'uuid'),
    ('public._exp08_lock_owner_recovery(uuid)', '167f4b8f8c3258c03f3e85802bc842b3', 'uuid'),
    ('public._exp08_require_recovery_audit()', 'defee9e1d221f1858669985f56ffad3d', 'void'),
    ('public._exp08_lock_recovery_effect(uuid,uuid,uuid,text)', 'b34a0ca159e146090a7b2370badab19a', 'uuid')
  ) v(signature,digest,returns)
  LOOP
    SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(spec.signature);
    IF NOT FOUND OR md5(p.prosrc) IS DISTINCT FROM spec.digest OR p.proowner<>'postgres'::regrole
      OR NOT p.prosecdef OR p.provolatile<>'v' OR p.proretset OR p.pronargdefaults<>0
      OR p.prorettype<>spec.returns::regtype OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR p.proacl IS NULL OR (SELECT count(*) FROM aclexplode(p.proacl))<>1
      OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee<>p.proowner
        OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
      RAISE EXCEPTION 'EXP02 Billing requires exact private EXP08 recovery ABI' USING ERRCODE='23514';
    END IF;
  END LOOP;
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.platform_billing_contact_revoke(uuid)');
  IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
    OR p.proretset OR p.prorettype<>'jsonb'::regtype OR p.pronargdefaults<>0
    OR p.proargnames IS DISTINCT FROM ARRAY['p_contact_id']::text[]
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR p.proacl IS NULL OR (SELECT count(*) FROM aclexplode(p.proacl))<>2
    OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee NOT IN (p.proowner,'authenticated'::regrole)
      OR a.grantor<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
    RAISE EXCEPTION 'EXP02 original Billing revoke metadata drift' USING ERRCODE='23514';
  END IF;
  before_metadata := to_jsonb(p)-'prosrc'; definition := pg_get_functiondef(p.oid);
  SELECT count(*) INTO present FROM pg_proc WHERE oid IN (
    to_regprocedure('public._exp02_billing_revoke_scope(uuid,uuid,uuid)'),
    to_regprocedure('public._exp02_billing_contact_revoke(uuid,uuid,uuid,uuid)'),
    to_regprocedure('public._exp02_billing_recovery_cleanup(uuid,uuid,uuid)'));
  IF present=0 AND md5(p.prosrc)='f8fa3a425f70d301f47b5b5750c57ad3' THEN
    original_body := p.prosrc;
    IF (length(original_body)-length(replace(original_body,old_scope,'')))/length(old_scope)<>3
      OR (length(original_body)-length(replace(original_body,old_select,'')))/length(old_select)<>1
      OR (length(original_body)-length(replace(original_body,old_actor,'')))/length(old_actor)<>1
      OR (length(original_body)-length(replace(original_body,old_payload,'')))/length(old_payload)<>1 THEN
      RAISE EXCEPTION 'EXP02 original Billing source anchors drift' USING ERRCODE='23514';
    END IF;
    kernel_body := replace(replace(replace(replace(original_body,old_scope,new_scope),old_select,new_select),old_actor,new_actor),old_payload,new_payload);
  ELSIF present=3 AND p.prosrc=wrapper THEN
    SELECT prosrc INTO kernel_body FROM pg_proc WHERE oid=to_regprocedure('public._exp02_billing_contact_revoke(uuid,uuid,uuid,uuid)');
    original_body := replace(replace(replace(replace(kernel_body,new_payload,old_payload),new_actor,old_actor),new_select,old_select),new_scope,old_scope);
  ELSE
    RAISE EXCEPTION 'EXP02 original Billing source or partial kernel drift' USING ERRCODE='23514';
  END IF;
  IF md5(original_body) IS DISTINCT FROM 'f8fa3a425f70d301f47b5b5750c57ad3'
    OR kernel_body IS DISTINCT FROM replace(replace(replace(replace(original_body,old_scope,new_scope),old_select,new_select),old_actor,new_actor),old_payload,new_payload) THEN
    RAISE EXCEPTION 'EXP02 Billing original-body conservation failed' USING ERRCODE='23514';
  END IF;
  -- Never repair a partial/drifting existing private function or broaden its permissions.
  FOR spec IN SELECT * FROM (VALUES
    ('public._exp02_billing_revoke_scope(uuid,uuid,uuid)',scope_body,ARRAY['p_recovery_tenant','p_recovery_user','p_recovery_request'], 'uuid'),
    ('public._exp02_billing_contact_revoke(uuid,uuid,uuid,uuid)',kernel_body,ARRAY['p_contact_id','p_recovery_tenant','p_recovery_user','p_recovery_request'], 'jsonb'),
    ('public._exp02_billing_recovery_cleanup(uuid,uuid,uuid)',cleanup_body,ARRAY['p_tenant','p_user','p_request'], 'jsonb')
  ) v(signature,body,names,returns)
  LOOP
    IF present=0 THEN
      EXECUTE format('CREATE FUNCTION %s(%s) RETURNS %s LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='''' AS %L',
        split_part(spec.signature,'(',1), (SELECT string_agg(quote_ident(x)||' uuid',',' ORDER BY ord) FROM unnest(spec.names) WITH ORDINALITY a(x,ord)), spec.returns, spec.body);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',spec.signature);
    END IF;
    SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(spec.signature);
    IF NOT FOUND OR p.prosrc IS DISTINCT FROM spec.body OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef
      OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proisstrict OR p.proleakproof OR p.proretset
      OR p.prokind<>'f' OR p.provariadic<>0 OR p.prosupport<>0 OR p.procost<>100 OR p.prorows<>0
      OR p.prorettype<>spec.returns::regtype OR p.pronargdefaults<>0 OR p.proargdefaults IS NOT NULL
      OR p.proargnames IS DISTINCT FROM spec.names OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
      OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR p.proacl IS NULL OR (SELECT count(*) FROM aclexplode(p.proacl))<>1
      OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner
        OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
      RAISE EXCEPTION 'EXP02 private Billing source or metadata drift' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF present=0 THEN EXECUTE replace(definition,original_body,wrapper); END IF;
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.platform_billing_contact_revoke(uuid)');
  IF p.prosrc IS DISTINCT FROM wrapper OR to_jsonb(p)-'prosrc' IS DISTINCT FROM before_metadata THEN
    RAISE EXCEPTION 'EXP02 original Billing wrapper metadata changed' USING ERRCODE='23514';
  END IF;
END $billing_recovery$;

-- ORIGINAL COMPONENT exp08-owner-recovery-revoke.sql SHA256 0a5f49d6dc03033d08ab2f16537a954a558f13b3cdb5438edcdc0cc808cf8a52
-- INERT E08 original revoke integration; apply only after reviewed E08 base + original E02 consumer.
-- No migration/public recovery activation. Ordinary ABI and original body are conserved.

SET LOCAL lock_timeout='2s';
DO $revoke_kernel$
DECLARE
 p pg_proc; original_body text; kernel_body text; definition text; before_metadata jsonb;
 wrapper constant text:=E'\nBEGIN\n  PERFORM public._exp08_prepare_owner_change(_tenant,_user,''revoke_owner'',false);\n  PERFORM public._exp08_revoke_co_owner(_tenant,_user,NULL);\nEND;\n';
 old_platform constant text:='_is_platform boolean := public.is_platform_owner();';
 new_platform constant text:='_is_platform boolean := public.is_platform_owner() AND NOT public._solo_shell_tenant(_tenant);';
 old_begin constant text:=E'BEGIN\n  IF _caller IS NULL THEN';
 new_begin constant text:=E'BEGIN\n  IF _recovery_request IS NOT NULL THEN\n    PERFORM public._exp08_lock_recovery_effect(_tenant,_user,_recovery_request,''revoke_owner'');\n    _is_platform := true;\n  END IF;\n  IF _caller IS NULL THEN';
 old_declaration constant text:='_owner_count int;';
 new_declaration constant text:=E'_owner_count int;\n  _billing jsonb;';
 old_billing constant text:=$old_billing$  -- exp08_owner_billing_interlock_v1: original current-workspace Billing door only.
  IF public._solo_shell_tenant(_tenant) THEN
    -- The original authorization preceded owner-row waits. Re-resolve it now; no cached grant.
    _is_platform := public.is_platform_owner();
    IF NOT (public.is_tenant_account_holder(_caller, _tenant) OR _is_platform
        OR (_user = _caller AND EXISTS (SELECT 1 FROM public.tenant_members
          WHERE tenant_id = _tenant AND user_id = _caller AND is_owner AND status = 'active'))) THEN
      RAISE EXCEPTION 'CO_OWNER_FORBIDDEN: authority changed while waiting' USING ERRCODE = '42501';
    END IF;
    -- Intersection with the original Billing applicability contract: a SOLO sub-account or
    -- parented workspace has no public Billing writer. Do not regress its ordinary seat change.
    IF EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant
      AND account_type = 'standalone' AND parent_tenant_id IS NULL) THEN
    IF public.platform_billing_workspace_owner_scope() IS DISTINCT FROM _tenant THEN
      RAISE EXCEPTION 'CO_OWNER_BILLING_SCOPE_MISMATCH' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('platform_billing_contacts:' || _tenant::text, 0));
    IF public.platform_billing_workspace_owner_scope() IS DISTINCT FROM _tenant THEN
      RAISE EXCEPTION 'CO_OWNER_BILLING_SCOPE_MISMATCH' USING ERRCODE = '42501';
    END IF;
    DECLARE _contact uuid;
    BEGIN
      FOR _contact IN SELECT b.id FROM public.platform_billing_contacts b
        WHERE b.tenant_id = _tenant AND b.user_id = _user AND b.revoked_at IS NULL
        ORDER BY b.id LOOP
        PERFORM public.platform_billing_contact_revoke(_contact);
      END LOOP;
    END;
    ELSIF EXISTS (SELECT 1 FROM public.platform_billing_contacts b
      WHERE b.tenant_id = _tenant AND b.user_id = _user AND b.revoked_at IS NULL) THEN
      -- Inconsistent legacy designations need an original supported cleanup seam, not a bypass.
      RAISE EXCEPTION 'CO_OWNER_BILLING_CLEANUP_UNAVAILABLE' USING ERRCODE = '42501';
    END IF;
  END IF;
$old_billing$;
 new_billing text;
BEGIN
 new_billing:=$recovery$
  IF _recovery_request IS NOT NULL THEN
    PERFORM public._exp08_lock_recovery_effect(_tenant,_user,_recovery_request,'revoke_owner');
    IF EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant AND account_type='standalone' AND parent_tenant_id IS NULL) THEN
      _billing:=public._exp02_billing_recovery_cleanup(_tenant,_user,_recovery_request);
    ELSE
      -- Preserve the original non-Billing SOLO compatibility; never silently clean unsupported contacts.
      IF EXISTS(SELECT 1 FROM public.platform_billing_contacts WHERE tenant_id=_tenant AND user_id=_user AND revoked_at IS NULL) THEN
        RAISE EXCEPTION 'CO_OWNER_BILLING_CLEANUP_UNAVAILABLE' USING ERRCODE='42501';
      END IF;
      _billing:=jsonb_build_object('status','not_applicable','contact_ids','[]'::jsonb,'audit_ids','[]'::jsonb);
    END IF;
    IF coalesce(_billing->>'status','') NOT IN ('revoked','not_required','not_applicable')
      OR jsonb_typeof(_billing->'contact_ids') IS DISTINCT FROM 'array'
      OR jsonb_typeof(_billing->'audit_ids') IS DISTINCT FROM 'array'
      OR jsonb_array_length(_billing->'contact_ids')<>jsonb_array_length(_billing->'audit_ids')
      OR ((_billing->>'status'='revoked') IS DISTINCT FROM (jsonb_array_length(_billing->'contact_ids')>0)) THEN
      RAISE EXCEPTION 'CO_OWNER_BILLING_RESULT_UNVERIFIED' USING ERRCODE='42501';
    END IF;
    IF (SELECT count(DISTINCT c.id) FROM jsonb_array_elements_text(_billing->'contact_ids') WITH ORDINALITY x(id,n)
      JOIN public.platform_billing_contacts c ON c.id=x.id::uuid AND c.tenant_id=_tenant AND c.user_id=_user
        AND c.revoked_at IS NOT NULL AND c.revoked_by=_caller
      JOIN public.paige_audit_log a ON a.id=(_billing->'audit_ids'->>(x.n::int-1))::uuid
        AND a.tenant_id=_tenant AND a.target_id=c.id AND a.actor_user_id=_caller AND a.actor_role='super_admin'
        AND a.action='platform_billing_contact_revoked' AND a.payload->>'owner_recovery_request_id'=_recovery_request::text)
      <>jsonb_array_length(_billing->'contact_ids')
      OR EXISTS(SELECT 1 FROM public.platform_billing_contacts WHERE tenant_id=_tenant AND user_id=_user AND revoked_at IS NULL) THEN
      RAISE EXCEPTION 'CO_OWNER_BILLING_RESULT_UNVERIFIED' USING ERRCODE='42501';
    END IF;
    UPDATE public.paige_audit_log SET payload=payload||jsonb_build_object('billing',_billing)
      WHERE id=_recovery_request AND tenant_id=_tenant AND target_id=_user AND actor_user_id=_caller
        AND action='tenant:owner_recovery.revoke_owner' AND payload->>'outcome'='preparing'
        AND payload->>'transaction_id'=pg_current_xact_id()::text AND payload->>'backend_pid'=pg_backend_pid()::text;
    IF NOT FOUND THEN RAISE EXCEPTION 'OWNER_RECOVERY_EFFECT_CONTEXT_UNAVAILABLE' USING ERRCODE='42501';END IF;
    PERFORM public._exp08_lock_recovery_effect(_tenant,_user,_recovery_request,'revoke_owner');
  ELSE
$recovery$||replace(old_billing,'_is_platform := public.is_platform_owner();',
 '_is_platform := public.is_platform_owner() AND NOT public._solo_shell_tenant(_tenant);')||E'\n  END IF;\n';
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public._exp02_billing_recovery_cleanup(uuid,uuid,uuid)');
 IF NOT FOUND OR md5(p.prosrc)<>'69ff592a571b61bc3d0aaebf6271f4cd'
   OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
   OR p.prorettype<>'jsonb'::regtype OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 original E02 private cleanup unavailable';
 END IF;
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.revoke_co_owner(uuid,uuid)');
 IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
   OR p.prorettype<>'void'::regtype OR p.proretset OR p.pronargdefaults<>0
   OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_user']::text[]
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE a.grantee NOT IN (p.proowner,'authenticated'::regrole,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)
   OR NOT has_function_privilege('authenticated',p.oid,'EXECUTE') OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN
   RAISE EXCEPTION 'EXP08 original revoke metadata drift';
 END IF;
 before_metadata:=to_jsonb(p)-'prosrc';definition:=pg_get_functiondef(p.oid);
 IF p.prosrc=wrapper THEN
   SELECT prosrc INTO kernel_body FROM pg_proc WHERE oid=to_regprocedure('public._exp08_revoke_co_owner(uuid,uuid,uuid)');
   original_body:=replace(replace(replace(replace(kernel_body,new_billing,old_billing),new_declaration,old_declaration),new_begin,old_begin),new_platform,old_platform);
 ELSE
   IF md5(p.prosrc)<>'7d62c3fac37e2af0b6f2a3029d892752' OR to_regprocedure('public._exp08_revoke_co_owner(uuid,uuid,uuid)') IS NOT NULL THEN
     RAISE EXCEPTION 'EXP08 original revoke source or partial kernel drift';
   END IF;
   original_body:=p.prosrc;
   kernel_body:=replace(replace(replace(replace(original_body,old_platform,new_platform),old_begin,new_begin),old_declaration,new_declaration),old_billing,new_billing);
 END IF;
 IF md5(original_body) IS DISTINCT FROM '7d62c3fac37e2af0b6f2a3029d892752'
   OR kernel_body IS DISTINCT FROM replace(replace(replace(replace(original_body,old_platform,new_platform),old_begin,new_begin),old_declaration,new_declaration),old_billing,new_billing)
   OR (length(kernel_body)-length(replace(kernel_body,new_platform,'')))/length(new_platform)<>1
   OR (length(kernel_body)-length(replace(kernel_body,new_begin,'')))/length(new_begin)<>1
   OR (length(kernel_body)-length(replace(kernel_body,new_declaration,'')))/length(new_declaration)<>1
   OR (length(kernel_body)-length(replace(kernel_body,new_billing,'')))/length(new_billing)<>1 THEN
   RAISE EXCEPTION 'EXP08 original revoke kernel conservation drift';
 END IF;
 IF p.prosrc<>wrapper THEN
   EXECUTE replace(replace(definition,'public.revoke_co_owner(_tenant uuid, _user uuid)',
     'public._exp08_revoke_co_owner(_tenant uuid, _user uuid, _recovery_request uuid)'),original_body,kernel_body);
   REVOKE ALL ON FUNCTION public._exp08_revoke_co_owner(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
   EXECUTE replace(definition,original_body,wrapper);
 END IF;
 IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=p.oid) IS DISTINCT FROM before_metadata THEN
   RAISE EXCEPTION 'EXP08 original public revoke metadata changed';
 END IF;
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public._exp08_revoke_co_owner(uuid,uuid,uuid)');
 IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v' OR p.proretset
   OR p.prorettype<>'void'::regtype OR p.pronargdefaults<>0 OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_user','_recovery_request']::text[]
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 private revoke metadata drift';
 END IF;
END;
$revoke_kernel$;

-- ORIGINAL COMPONENT exp08-owner-recovery-doors.sql SHA256 93a1239290ad1c903e29d970ea50b0e6878afb31d2df38a021f4172cf9d3d30c
-- INERT original recovery/public-reader preparation; not a migration or activation.
-- Requires the reviewed original native transaction; no new writer/ledger/approval.

SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog;
DO $original_recovery_doors$
DECLARE s record; p pg_proc; signature regprocedure; door_role name;
BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 recovery installer requires postgres';END IF;
  IF EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace
    WHERE n.nspname='public' AND f.proname IN('platform_owner_recovery','platform_owner_recovery_receipt','get_owner_recovery_notice','get_my_owner_recovery_notice','get_owner_recovery_delivery_event')
      AND NOT (f.oid::regprocedure=ANY(array_remove(ARRAY[
        to_regprocedure('public.platform_owner_recovery(uuid,text,uuid,text,uuid)'),
        to_regprocedure('public.platform_owner_recovery(uuid,text,uuid,text)'),
        to_regprocedure('public.platform_owner_recovery_receipt(uuid,uuid)'),
        to_regprocedure('public.get_owner_recovery_notice(uuid,uuid)'),
        to_regprocedure('public.get_my_owner_recovery_notice(uuid)'),
        to_regprocedure('public.get_owner_recovery_delivery_event(uuid,uuid)')],NULL)))) THEN
    RAISE EXCEPTION 'EXP08 original recovery unsupported overload';
  END IF;
  FOR s IN SELECT * FROM (VALUES
    ('public._exp08_lock_recovery_actor()','9692d6200993b8bf6d423db38c1b4d47','uuid',NULL::text[]),
    ('public._exp08_require_recovery_audit()','defee9e1d221f1858669985f56ffad3d','void',NULL::text[]),
    ('public._exp08_apply_owner_recovery(uuid,text,uuid,text,uuid)','b28866ce3be2085643433cf3ba104036','jsonb',ARRAY['_tenant','_act','_user','_reason','_request']),
    ('public._exp08_read_owner_recovery(uuid,uuid)','8930f6094db5dc87a55a693b06d60857','jsonb',ARRAY['_tenant','_request']),
    ('public._exp08_read_recovery_notice(uuid,uuid)','a16a4d793c2440aad2bd5b48cec2ee34','jsonb',ARRAY['_expected_tenant','_notice']),
    ('public._exp08_read_recovery_notice_for_recipient(uuid,uuid,uuid,boolean)','ddcdb478a4956181fc99dd8ebee80d0b','jsonb',ARRAY['_expected_tenant','_notice','_recipient','_require_profile']),
    ('public._exp08_read_my_recovery_notice(uuid)','3502ca4bdad1ba029b73b2b6c0a370af','jsonb',ARRAY['_notice']),
    ('public._exp08_read_recovery_delivery_event(uuid,uuid)','ab105e060e570fc095c24f4602f1cca5','jsonb',ARRAY['_tenant','_audit'])
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
$notice$),
    ('get_my_owner_recovery_notice','_notice uuid','uuid',
      $personal$
BEGIN
  RETURN public._exp08_read_my_recovery_notice(_notice);
END;
$personal$),
    ('get_owner_recovery_delivery_event','_tenant uuid,_audit uuid','uuid,uuid',
      $delivery$
BEGIN
  RETURN public._exp08_read_recovery_delivery_event(_tenant,_audit);
END;
$delivery$)
  ) v(name,arguments,types,body) LOOP
    door_role:=CASE WHEN s.name='get_owner_recovery_delivery_event' THEN 'service_role' ELSE 'authenticated' END;
    signature:=to_regprocedure('public.'||s.name||'('||s.types||')');
    IF signature IS NULL THEN
      EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='''' AS %L',s.name,s.arguments,s.body);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated,service_role',s.name,s.types);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO %I',s.name,s.types,door_role);
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
        OR NOT has_function_privilege(door_role,p.oid,'EXECUTE')
        OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role')
          AND r.rolname<>door_role AND has_function_privilege(r.oid,p.oid,'EXECUTE'))
        OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantee NOT IN(p.proowner,door_role::regrole) OR a.privilege_type<>'EXECUTE'
            OR (a.is_grantable AND a.grantee<>p.proowner)) THEN
        RAISE EXCEPTION 'EXP08 original recovery public door drift: %',s.name;
      END IF;
  END LOOP;
END;
$original_recovery_doors$;

COMMIT;
