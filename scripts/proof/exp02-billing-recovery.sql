-- INERT preparation, not a migration or recovery activation. Original EXP08 ABI65264 required.
-- One original Billing revoke body, private native recovery consumer, no client/service grant.
BEGIN;
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
COMMIT;
