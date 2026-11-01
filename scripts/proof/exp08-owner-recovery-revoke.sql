-- INERT E08 original revoke integration; apply only after reviewed E08 base + original E02 consumer.
-- No migration/public recovery activation. Ordinary ABI and original body are conserved.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $revoke_kernel$
DECLARE
 p pg_proc; original_body text; kernel_body text; definition text; before_metadata jsonb;
 wrapper constant text:=E'\nBEGIN\n  PERFORM public._exp08_revoke_co_owner(_tenant,_user,NULL);\nEND;\n';
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
COMMIT;

