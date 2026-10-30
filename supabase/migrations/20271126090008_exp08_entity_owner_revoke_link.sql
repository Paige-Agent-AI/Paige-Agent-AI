-- EXP08 I2/R5/R6/R11, original revoke writer compatibility with I1's owner-link CHECK.
-- Unmerged candidate revision, not applied. Prior revision exists only in our disposable Preview.
-- Ordered after peer70005 and own80008; production-applied history is never rewritten.
-- Preserve the complete existing authorization, owner-floor, locks, person path and audit.
-- Unmerged repair: original Billing writer composition is atomic with SOLO demotion.
-- Arbitrary-target recovery and Setup guards remain separate I2 integration.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $revoke_link$
DECLARE
 target regprocedure:=to_regprocedure('public.revoke_co_owner(uuid,uuid)');
 original_source text; original_definition text; before_metadata jsonb; prerequisite record; p pg_proc;
 t pg_trigger; columns text[];
 old_span text:=$old$  UPDATE public.tenant_members
     SET is_owner = false,
         role     = 'admin'::public.tenant_role,$old$;
 new_span text:=$new$  -- exp08_owner_billing_interlock_v1: original current-workspace Billing door only.
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

  UPDATE public.tenant_members
     SET is_owner = false,
         -- exp08_entity_revoke_link_v1: only the original SOLO link ends with its owner seat.
         business_owner_id = CASE WHEN public._solo_shell_tenant(_tenant) THEN NULL ELSE business_owner_id END,
         role     = 'admin'::public.tenant_role,$new$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'EXP08 entity revoke original writer missing'; END IF;
 -- Consume E02's exact original writers, never clone or weaken their financial rules.
 FOR prerequisite IN SELECT * FROM (VALUES
  ('public.platform_billing_workspace_owner_scope()','3d33a31f95f308784853f7b3816b1e8c','s'),
  ('public.platform_billing_contact_revoke(uuid)','c67dc4c18e72fde1dbc89d15be09edd9','v'))
  v(signature,body_hash,volatility) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(prerequisite.signature);
  IF NOT FOUND OR md5(p.prosrc)<>prerequisite.body_hash OR p.proowner<>'postgres'::regrole
   OR NOT p.prosecdef OR p.provolatile::text<>prerequisite.volatility
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR p.proretset OR p.pronargdefaults<>0
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE (a.grantee<>'postgres'::regrole AND
       (prerequisite.volatility='s' OR a.grantee<>'authenticated'::regrole OR a.is_grantable))
       OR a.privilege_type<>'EXECUTE')
   OR has_function_privilege('anon',p.oid,'EXECUTE')
   OR (prerequisite.volatility='s' AND has_function_privilege('authenticated',p.oid,'EXECUTE'))
   OR (prerequisite.volatility='v' AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')) THEN
   RAISE EXCEPTION 'EXP08 entity revoke Billing prerequisite drift: %',prerequisite.signature;
  END IF;
 END LOOP;
 -- An unlink without the original held-seat derivation would lose its provenance.
 FOR prerequisite IN SELECT * FROM (VALUES
  ('public._business_owner_seat_ended()','75d4a8e014e495c5e0a819881b6a79bd','v','search_path=""'),
  ('public._business_owner_representative_deleted()','f95cbff2d3f69c274b287ef0b9bc0067','v','search_path=""'),
  ('public._solo_shell_tenant(uuid)','9ade6efeff0689b78ff57b116a28c9d4','s','search_path=public'))
  v(signature,body_hash,volatility,path) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(prerequisite.signature);
  IF NOT FOUND OR md5(p.prosrc)<>prerequisite.body_hash OR p.proowner<>'postgres'::regrole
   OR NOT p.prosecdef OR p.provolatile::text<>prerequisite.volatility
   OR p.proconfig IS DISTINCT FROM ARRAY[prerequisite.path]::text[]
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE') THEN
   RAISE EXCEPTION 'EXP08 entity revoke prerequisite drift: %',prerequisite.signature;
  END IF;
 END LOOP;
 FOR prerequisite IN SELECT * FROM (VALUES
  ('public.tenant_members','trg_tenant_members_business_owner_seat_ended','public._business_owner_seat_ended()',25,
   ARRAY['business_owner_id','is_owner','status','tenant_id','user_id']::text[]),
  ('public.tenant_business_owners','trg_business_owner_representative_deleted','public._business_owner_representative_deleted()',19,
   ARRAY['representative_user_id']::text[])) v(relation,name,signature,kind,attributes) LOOP
  SELECT * INTO t FROM pg_trigger WHERE tgrelid=prerequisite.relation::regclass AND tgname=prerequisite.name;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXP08 entity revoke held-seat trigger missing'; END IF;
  SELECT array_agg(a.attname::text ORDER BY a.attname) INTO columns FROM pg_attribute a
   WHERE a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr::smallint[]);
  IF t.tgfoid<>prerequisite.signature::regprocedure OR t.tgtype<>prerequisite.kind OR t.tgenabled<>'O'
   OR t.tgisinternal OR t.tgnargs<>0 OR t.tgqual IS NOT NULL OR t.tgconstraint<>0
   OR columns IS DISTINCT FROM prerequisite.attributes THEN
   RAISE EXCEPTION 'EXP08 entity revoke held-seat trigger drift';
  END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
  OR p.prorettype<>'void'::regtype OR p.proretset OR p.pronargdefaults<>0
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_user']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole,'service_role'::regrole)
     OR a.privilege_type<>'EXECUTE' OR (a.is_grantable AND a.grantee<>'postgres'::regrole))
  OR NOT has_function_privilege('authenticated',target,'EXECUTE')
  OR NOT has_function_privilege('service_role',target,'EXECUTE') THEN
  RAISE EXCEPTION 'EXP08 entity revoke original writer metadata drift';
 END IF;
 SELECT prosrc,pg_get_functiondef(oid),to_jsonb(f)-'prosrc' INTO original_source,original_definition,before_metadata
  FROM pg_proc f WHERE oid=target;
 IF position('exp08_entity_revoke_link_v1' IN original_source)>0 THEN
  IF (length(original_source)-length(replace(original_source,new_span,'')))/length(new_span)<>1
   OR md5(replace(original_source,new_span,old_span))<>'e2ba8ca80d63df58ebc93b34e5dc5f01' THEN
   RAISE EXCEPTION 'EXP08 entity revoke partial or drifted source';
  END IF;
  RETURN;
 END IF;
 IF md5(original_source)<>'e2ba8ca80d63df58ebc93b34e5dc5f01'
  OR (length(original_source)-length(replace(original_source,old_span,'')))/length(old_span)<>1 THEN
  RAISE EXCEPTION 'EXP08 entity revoke original source drift';
 END IF;
 EXECUTE replace(original_definition,old_span,new_span);
 IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
  OR (SELECT md5(replace(prosrc,new_span,old_span)) FROM pg_proc WHERE oid=target)
    <>'e2ba8ca80d63df58ebc93b34e5dc5f01' THEN
  RAISE EXCEPTION 'EXP08 entity revoke source or metadata conservation failed';
 END IF;
END $revoke_link$;
COMMIT;
