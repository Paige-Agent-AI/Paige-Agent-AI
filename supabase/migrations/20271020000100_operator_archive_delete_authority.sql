-- ANT-47 owner rule (2026-10-10): Platform Operator Super Admin and Platform Admin may
-- permanently delete eligible accounts; other appropriately authorized Platform Operator
-- members may archive and restore, but never permanently delete. Authority is derived
-- server-side from the R0 capability registry (operator_may), never from UI state, emails
-- or tenant membership. Ordinary tenant users, CRM staff and business owners hold no
-- operator lifecycle authority through this change.
--
-- Gate classes:
--   archive class  (preview/archive/restore/receipts/status transition) -> operator_can_archive_accounts()
--   delete class   (deletion preview/execute, retired credentials, journal delete branch)
--                  -> operator_can_permanently_delete_accounts()
--   provider/file resource prep keeps its mode: archive-mode prep is archive class,
--   delete-mode prep is delete class.
-- operator_can_retire_accounts() is retained unchanged (both admin tiers) for the existing
-- proof harness and account-detail editing, which stays administrator-only.
-- Function bodies below are the current deployed definitions with only their authority
-- gate lines changed; every other line is byte-identical.

INSERT INTO public.platform_operator_capabilities (capability, description, ruling) VALUES
  ('fleet.account.archive',
   'Archive and restore eligible accounts through the canonical Fleet lifecycle, including its audited status transitions.',
   'ANT-47 owner rule 2026-10-10; CLAUDE.md §53'),
  ('fleet.account.permanent_delete',
   'Permanently delete archived eligible accounts. Irreversible; Super Admin and Platform Admin only.',
   'ANT-47 owner rule 2026-10-10; CLAUDE.md §53')
ON CONFLICT (capability) DO NOTHING;

-- Explicit rows for both admin tiers, mirroring R0: the owner tier never depends on
-- holds_unlisted alone for a listed capability, and no tier below Platform Admin receives
-- permanent deletion through this change.
INSERT INTO public.platform_operator_role_capabilities (role, capability, ruling, in_force, pending) VALUES
  ('super_admin', 'fleet.account.archive', 'ANT-47 owner rule 2026-10-10', true, NULL),
  ('super_admin', 'fleet.account.permanent_delete', 'ANT-47 owner rule 2026-10-10', true, NULL),
  ('platform_admin', 'fleet.account.archive', 'ANT-47 owner rule 2026-10-10', true, NULL),
  ('platform_admin', 'fleet.account.permanent_delete', 'ANT-47 owner rule 2026-10-10', true, NULL)
ON CONFLICT (role, capability) DO NOTHING;

-- R0 convention (20270510000000): the slice that moves a gate flips its registry row in the
-- same change. operator_set_tenant_status now moves with the archive lifecycle gate, which
-- admits platform_admin, so the platform_admin tenant.status.set row records that truth. No
-- enforcement consumes tenant.status.set; this keeps the registry the one honest answer.
UPDATE public.platform_operator_role_capabilities
   SET in_force = true, pending = NULL,
       ruling = 'ANT-47 owner rule 2026-10-10; operator_set_tenant_status moves with the archive lifecycle gate'
 WHERE role = 'platform_admin' AND capability = 'tenant.status.set';

CREATE OR REPLACE FUNCTION public.operator_can_archive_accounts()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT auth.uid() IS NOT NULL AND public.operator_may('fleet.account.archive')
$$;
REVOKE ALL ON FUNCTION public.operator_can_archive_accounts() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_can_archive_accounts() TO authenticated;

CREATE OR REPLACE FUNCTION public.operator_can_permanently_delete_accounts()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT auth.uid() IS NOT NULL AND public.is_platform_admin() AND public.operator_may('fleet.account.permanent_delete')
$$;
REVOKE ALL ON FUNCTION public.operator_can_permanently_delete_accounts() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_can_permanently_delete_accounts() TO authenticated;


CREATE OR REPLACE FUNCTION public.operator_read_account_details(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tenants;
BEGIN
 IF NOT public.operator_can_archive_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.tenants WHERE id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'account_type',t.account_type,'parent_tenant_id',t.parent_tenant_id,
 'version',md5(to_jsonb(t)::text),'archived_at',t.archived_at,'archive_operation_id',t.archive_operation_id,
 'archive_root_tenant_id',(SELECT root_tenant_id FROM public.operator_account_archives WHERE id=t.archive_operation_id),'execution_paused',t.lifecycle_execution_paused);
END $$;

REVOKE ALL ON FUNCTION public.operator_read_account_details FROM PUBLIC,anon,service_role;

CREATE OR REPLACE FUNCTION public.operator_preview_account_archive(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[]; accounts jsonb; fingerprint text; blockers jsonb:='[]'; rel text; n bigint; members bigint; shared bigint;
BEGIN
  IF NOT public.operator_can_archive_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
  WITH RECURSIVE tree AS (
    SELECT id FROM public.tenants WHERE id=_tenant_id
    UNION SELECT t.id FROM public.tenants t JOIN tree p ON t.parent_tenant_id=p.id
  ) SELECT array_agg(id ORDER BY id) INTO ids FROM tree;
  IF ids IS NULL THEN RAISE EXCEPTION 'account not found' USING ERRCODE='P0002'; END IF;
  IF cardinality(ids)>100 THEN RAISE EXCEPTION 'account tree exceeds the bounded operation limit' USING ERRCODE='54000'; END IF;
  SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'account_type',account_type,'status',status,'parent_tenant_id',parent_tenant_id) ORDER BY id) INTO accounts FROM public.tenants WHERE id=ANY(ids);
  SELECT md5(jsonb_build_object('tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenants t WHERE id=ANY(ids)),
    'external_resources',public.operator_external_retirement_inventory(ids),'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tenant_members m WHERE tenant_id=ANY(ids)))::text) INTO fingerprint;
  IF EXISTS(SELECT 1 FROM public.tenants WHERE id=ANY(ids) AND ((id=_tenant_id AND archived_at IS NOT NULL) OR (archived_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.operator_account_archives a WHERE a.id=archive_operation_id AND a.state='archived' AND tenants.id=ANY(a.scope_ids))) OR features->'system_workspace'='true'::jsonb OR account_type NOT IN ('agency','sub_account','standalone'))) THEN
    blockers:=blockers||jsonb_build_array('Platform workspaces, unsupported types, an archived selected account and invalid child archives are protected.');
  END IF;
  -- No archive can race a worker already executing an external operation.
  IF EXISTS(SELECT 1 FROM public.platform_subscriptions WHERE tenant_id=ANY(ids) AND (stripe_subscription_id IS NOT NULL OR stripe_customer_id IS NOT NULL) AND status NOT IN ('canceled','expired')) THEN blockers:=blockers||jsonb_build_array('Live billing references require authoritative billing retirement before archive.'); END IF;
  FOREACH rel IN ARRAY ARRAY['paige_durable_work','paige_workflow_runs','paige_actions','paige_media_jobs','paige_social_jobs','email_campaign_dispatches','growth_submission_dispatches'] LOOP
    IF to_regclass('public.'||rel) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I t WHERE tenant_id=ANY($1) AND coalesce(to_jsonb(t)->>''status'',to_jsonb(t)->>''state'') IN (''running'',''claimed'',''drafting'',''dispatching'',''processing'',''sending'',''executing'')',rel) INTO n USING ids;
    IF n>0 THEN blockers:=blockers||jsonb_build_array(format('%s: %s operations are in flight. Quiesce and verify the existing worker before archiving.',rel,n)); END IF;
  END LOOP;
  -- PAIGE archive owns access/execution. Vendor termination is tracked separately.
  IF EXISTS(SELECT 1 FROM public.operator_account_archives r WHERE r.resource_mode IS NOT NULL AND r.scope_ids&&ids AND r.resource_started_at>clock_timestamp()-interval '10 minutes') THEN
    blockers:=blockers||jsonb_build_array('A confirmed cleanup operation is still processing. Read its outcome before changing the account.');
  END IF;
  IF to_regclass('public.paige_invoice_provider_operations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.paige_invoice_provider_operations WHERE tenant_id=ANY($1) AND state NOT IN (''failed'',''expired'',''cancelled'')' INTO n USING ids;
    IF n>0 THEN blockers:=blockers||jsonb_build_array('An unresolved payment-provider operation must be reconciled before archive.'); END IF;
  END IF;
  SELECT count(*),count(DISTINCT m.user_id) FILTER(WHERE EXISTS(SELECT 1 FROM public.tenant_members other WHERE other.user_id=m.user_id AND NOT(other.tenant_id=ANY(ids)))) INTO members,shared FROM public.tenant_members m WHERE tenant_id=ANY(ids);
  RETURN jsonb_build_object('tenant_id',_tenant_id,'accounts',accounts,'version',fingerprint,'blockers',blockers,'memberships',members,'shared_identities',shared,'warnings',public.operator_external_retirement_warnings(ids),'execution_available',jsonb_array_length(blockers)=0);
END $$;

REVOKE ALL ON FUNCTION public.operator_preview_account_archive FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.operator_archive_account(_tenant_id uuid,_expected_version text,_confirmation_name text,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p jsonb; ids uuid[]; row public.tenants; existing public.operator_account_archives;
BEGIN
  IF NOT public.operator_can_archive_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
  IF _operation_id IS NULL THEN RAISE EXCEPTION 'operation id required' USING ERRCODE='22023'; END IF;
  PERFORM public.operator_lock_retirement_scope();
  SELECT * INTO existing FROM public.operator_account_archives WHERE id=_operation_id;
  IF FOUND THEN
    IF existing.root_tenant_id<>_tenant_id OR existing.root_name IS DISTINCT FROM _confirmation_name THEN RAISE EXCEPTION 'operation id belongs to another request' USING ERRCODE='22023'; END IF;
    RETURN public.operator_read_archive_receipt(_tenant_id,_operation_id);
  END IF;
  p:=public.operator_preview_account_archive(_tenant_id);
  IF p->>'version' IS DISTINCT FROM _expected_version THEN RAISE EXCEPTION 'account changed; refresh archive review' USING ERRCODE='40001'; END IF;
  IF NOT(p->>'execution_available')::boolean THEN RAISE EXCEPTION 'archive blocked; resolve preflight' USING ERRCODE='55000'; END IF;
  SELECT * INTO row FROM public.tenants WHERE id=_tenant_id;
  IF _confirmation_name IS DISTINCT FROM row.name THEN RAISE EXCEPTION 'type the exact account name' USING ERRCODE='22023'; END IF;
  SELECT array_agg((a->>'id')::uuid) INTO ids FROM jsonb_array_elements(p->'accounts') a;
  INSERT INTO public.operator_account_archives(id,root_tenant_id,actor_user_id,root_name,state,scope_ids,prior_tenants,prior_members)
    SELECT _operation_id,_tenant_id,auth.uid(),row.name,'preparing',ids,
      (SELECT jsonb_agg(jsonb_build_object('id',t.id,'status',t.status,'archived_at',t.archived_at,'archive_operation_id',t.archive_operation_id) ORDER BY t.id) FROM public.tenants t WHERE t.id=ANY(ids)),
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'tenant_id',m.tenant_id,'user_id',m.user_id,'role',m.role,'status',m.status,'is_owner',to_jsonb(m)->'is_owner') ORDER BY m.id) FROM public.tenant_members m WHERE m.tenant_id=ANY(ids)),'[]');
  PERFORM public.operator_detach_pending_provider_preparation(ids);
  UPDATE public.operator_account_archives SET external_cleanup=public.operator_external_retirement_inventory(ids) WHERE id=_operation_id;
  -- Same canonical status transition/audit for both privileged operator roles.
  FOR row IN SELECT * FROM public.tenants WHERE id=ANY(ids) AND archived_at IS NULL ORDER BY id LOOP
    PERFORM public.operator_set_tenant_status(row.id,'canceled','Account archived through Fleet');
  END LOOP;
  UPDATE public.tenants SET archived_at=now(),archive_operation_id=_operation_id,lifecycle_execution_paused=true WHERE id=ANY(ids);
  UPDATE public.tenant_members SET status='archived' WHERE tenant_id=ANY(ids) AND status='active';
  UPDATE public.profiles SET active_tenant_id=NULL WHERE active_tenant_id=ANY(ids);
  UPDATE public.operator_account_archives SET state='archived' WHERE id=_operation_id;
  INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(auth.uid(),'tenant.archive','tenant',_tenant_id,jsonb_build_object('operation_id',_operation_id,'account_count',cardinality(ids)));
  RETURN public.operator_read_archive_receipt(_tenant_id,_operation_id);
END $$;

REVOKE ALL ON FUNCTION public.operator_archive_account FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.operator_restore_archived_account(_tenant_id uuid,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives; saved jsonb;
BEGIN
  IF NOT public.operator_can_archive_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
  PERFORM public.operator_lock_retirement_scope();
  SELECT * INTO r FROM public.operator_account_archives WHERE id=_operation_id AND root_tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'archive operation not found' USING ERRCODE='P0002'; END IF;
  IF r.state='restored' THEN RETURN public.operator_read_archive_receipt(_tenant_id,_operation_id); END IF;
  IF r.state<>'archived' OR (SELECT count(*) FROM public.tenants WHERE id=ANY(r.scope_ids) AND archive_operation_id=r.id)<>cardinality(r.scope_ids) THEN RAISE EXCEPTION 'archive changed; recovery required' USING ERRCODE='55000'; END IF;
  UPDATE public.operator_account_archives SET state='restoring' WHERE id=r.id;
  -- Restore each prior lifecycle, including independently archived children.
  UPDATE public.tenants t SET archived_at=(s.value->>'archived_at')::timestamptz,
    archive_operation_id=(s.value->>'archive_operation_id')::uuid
  FROM jsonb_array_elements(r.prior_tenants) s(value) WHERE t.id=(s.value->>'id')::uuid AND t.id=ANY(r.scope_ids);
  FOR saved IN SELECT value FROM jsonb_array_elements(r.prior_tenants) LOOP
    IF saved->>'archived_at' IS NULL THEN
      PERFORM public.operator_set_tenant_status((saved->>'id')::uuid,saved->>'status','Restore Fleet archive; execution remains paused');
    END IF;
  END LOOP;
  FOR saved IN SELECT value FROM jsonb_array_elements(r.prior_members) LOOP
    UPDATE public.tenant_members m SET status=saved->>'status' WHERE id=(saved->>'id')::uuid AND tenant_id=(saved->>'tenant_id')::uuid AND user_id=(saved->>'user_id')::uuid
      AND role::text=saved->>'role' AND coalesce(to_jsonb(m)->'is_owner','null'::jsonb) IS NOT DISTINCT FROM saved->'is_owner' AND status='archived';
  END LOOP;
  UPDATE public.operator_account_archives SET state='restored' WHERE id=r.id;
  INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(auth.uid(),'tenant.archive_restore','tenant',_tenant_id,jsonb_build_object('operation_id',r.id,'account_count',cardinality(r.scope_ids),'execution_paused',true));
  RETURN public.operator_read_archive_receipt(_tenant_id,_operation_id);
END $$;

REVOKE ALL ON FUNCTION public.operator_restore_archived_account FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.operator_read_archive_receipt(_tenant_id uuid,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives;
BEGIN
  IF NOT public.operator_can_archive_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.operator_account_archives WHERE id=_operation_id AND root_tenant_id=_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'operation not found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('tenant_id',r.root_tenant_id,'operation_id',r.id,'state',r.state,'account_count',cardinality(r.scope_ids),'external_cleanup_pending',jsonb_array_length(r.external_cleanup)>0);
END $$;

REVOKE ALL ON FUNCTION public.operator_read_archive_receipt FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.operator_set_tenant_status(
  _tenant_id uuid,
  _status text,
  _reason text DEFAULT NULL
) RETURNS public.tenants
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant public.tenants;
BEGIN
  -- §9/§51: server-derived God-tier gate. Bypassing RLS via SECURITY DEFINER is
  -- exactly why this explicit check is the FIRST statement — never trust the RLS
  -- policy alone under a definer, and never trust a caller-supplied identity.
  IF NOT public.operator_can_archive_accounts() THEN
    RAISE EXCEPTION 'platform owner only' USING ERRCODE = '42501';
  END IF;
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant id required' USING ERRCODE = '22000';
  END IF;
  IF _status NOT IN ('trial', 'active', 'past_due', 'suspended', 'canceled') THEN
    RAISE EXCEPTION 'invalid tenant status: %', _status USING ERRCODE = '22000';
  END IF;

  UPDATE public.tenants
     SET status = _status::public.tenant_status
   WHERE id = _tenant_id
  RETURNING * INTO _tenant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'P0002';
  END IF;

  -- Audit trail (actor = the operator; satisfies audit_logs "own row" policy).
  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, data)
  VALUES (
    _actor, 'tenant.status_change', 'tenant', _tenant_id,
    jsonb_strip_nulls(jsonb_build_object('status', _status, 'reason', _reason))
  );

  RETURN _tenant;
END;
$$;

REVOKE ALL ON FUNCTION public.operator_set_tenant_status(uuid,text,text) FROM PUBLIC,anon,service_role;

CREATE OR REPLACE FUNCTION public.guard_operator_account_archive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND NOT OLD.lifecycle_execution_paused AND NEW.lifecycle_execution_paused
   AND (to_jsonb(NEW)-'lifecycle_execution_paused')=(to_jsonb(OLD)-'lifecycle_execution_paused')
   AND EXISTS(SELECT 1 FROM public.operator_account_archives r WHERE r.state='resources_preparing' AND r.actor_user_id=auth.uid() AND NEW.id=ANY(r.scope_ids)) THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' THEN
    IF NOT public.operator_can_permanently_delete_accounts() OR NOT EXISTS(SELECT 1 FROM public.operator_account_archives r WHERE r.state='deleting' AND OLD.id=ANY(r.scope_ids) AND OLD.archive_operation_id=r.id) THEN
      RAISE EXCEPTION 'permanent deletion requires the canonical confirmed operation' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.archived_at IS NOT NULL OR NEW.archive_operation_id IS NOT NULL OR NEW.lifecycle_execution_paused THEN RAISE EXCEPTION 'archive requires the canonical operation' USING ERRCODE='42501'; END IF;
  ELSIF NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archive_operation_id IS DISTINCT FROM OLD.archive_operation_id
    OR NEW.lifecycle_execution_paused IS DISTINCT FROM OLD.lifecycle_execution_paused THEN
    IF NOT public.operator_can_archive_accounts() OR NOT EXISTS(
      SELECT 1 FROM public.operator_account_archives r WHERE NEW.id=ANY(r.scope_ids)
      AND ((NEW.archived_at IS NOT NULL AND NEW.archive_operation_id=r.id AND NEW.lifecycle_execution_paused AND r.state='preparing')
        OR (NEW.archived_at IS NULL AND NEW.archive_operation_id IS NULL AND NEW.lifecycle_execution_paused AND OLD.archive_operation_id=r.id AND r.state='restoring')
        OR (NEW.archived_at IS NOT NULL AND NEW.lifecycle_execution_paused AND OLD.archive_operation_id=r.id AND r.state='restoring'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.prior_tenants) saved WHERE (saved->>'id')::uuid=NEW.id
            AND (saved->>'archived_at')::timestamptz=NEW.archived_at AND (saved->>'archive_operation_id')::uuid=NEW.archive_operation_id
            AND EXISTS(SELECT 1 FROM public.operator_account_archives child WHERE child.id=NEW.archive_operation_id AND child.state='archived' AND NEW.id=ANY(child.scope_ids)))))
    ) THEN RAISE EXCEPTION 'archive requires the canonical operation' USING ERRCODE='42501'; END IF;
  ELSIF OLD.archived_at IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'restore the archived account before editing it' USING ERRCODE='55000';
  END IF;
  IF NEW.parent_tenant_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.tenants WHERE id=NEW.parent_tenant_id AND archived_at IS NOT NULL) THEN
    IF TG_OP='INSERT' OR NEW.parent_tenant_id IS DISTINCT FROM OLD.parent_tenant_id THEN RAISE EXCEPTION 'restore the parent before adding a child' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_operator_account_archive() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.operator_preview_account_deletion(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tenants; r public.operator_account_archives; p jsonb; summary jsonb; accounts jsonb; blockers jsonb:='[]'; version text; storage_count bigint:=0; members bigint; shared bigint;
BEGIN
 IF NOT public.operator_can_permanently_delete_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.tenants WHERE id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.operator_account_archives WHERE id=t.archive_operation_id AND root_tenant_id=t.id AND state='archived';
 IF NOT FOUND THEN RETURN jsonb_build_object('tenant_id',t.id,'accounts',jsonb_build_array(jsonb_build_object('id',t.id,'name',t.name,'account_type',t.account_type,'status',t.status,'parent_tenant_id',t.parent_tenant_id)),'blockers',jsonb_build_array(CASE WHEN t.archived_at IS NOT NULL THEN 'This account belongs to an archived parent scope. Open that scope to delete it.' WHEN EXISTS(SELECT 1 FROM public.tenants WHERE parent_tenant_id=t.id) THEN 'Archive this account and its children before permanent deletion.' ELSE 'Archive this account before permanent deletion.' END),'version',md5(to_jsonb(t)::text),'dependencies','[]'::jsonb,'execution_available',false); END IF;
 SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'account_type',account_type,'status',status,'parent_tenant_id',parent_tenant_id) ORDER BY id) INTO accounts FROM public.tenants WHERE id=ANY(r.scope_ids);
 IF (SELECT count(*) FROM public.tenants WHERE id=ANY(r.scope_ids) AND archived_at IS NOT NULL AND archive_operation_id=r.id)<>cardinality(r.scope_ids)
   OR EXISTS(SELECT 1 FROM public.tenants WHERE parent_tenant_id=ANY(r.scope_ids) AND NOT(id=ANY(r.scope_ids))) THEN blockers:=blockers||jsonb_build_array('Archived scope changed; reconcile the exact account tree.'); END IF;
 IF EXISTS(SELECT 1 FROM public.tenants WHERE id=ANY(r.scope_ids) AND (features->'system_workspace'='true'::jsonb OR account_type NOT IN ('agency','standalone','sub_account'))) THEN blockers:=blockers||jsonb_build_array('Platform workspaces and unsupported account types are protected.'); END IF;
 IF EXISTS(SELECT 1 FROM public.tenants WHERE id=ANY(r.scope_ids) AND (stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL)) THEN blockers:=blockers||jsonb_build_array('Verify billing retirement through the canonical provider lifecycle before removing billing references. Database deletion never cancels billing.'); END IF;
 p:=public.operator_account_deletion_plan(r.scope_ids); blockers:=blockers||(p->'blockers');
 IF public.operator_retirement_order_blocked(p->'tables') THEN blockers:=blockers||jsonb_build_array('A restrictive dependency cycle requires a reviewed relationship cleanup before deletion.'); END IF;
 IF EXISTS(WITH RECURSIVE paths AS (SELECT id,parent_tenant_id,ARRAY[id] path,false cycle FROM public.tenants WHERE id=ANY(r.scope_ids)
   UNION ALL SELECT p.id,ancestor.parent_tenant_id,p.path||ancestor.id,ancestor.id=ANY(p.path) FROM paths p JOIN public.tenants ancestor ON ancestor.id=p.parent_tenant_id WHERE NOT p.cycle)
   SELECT 1 FROM paths WHERE cycle) THEN blockers:=blockers||jsonb_build_array('The account hierarchy contains a cycle. Correct the canonical relationship before deletion.'); END IF;
 IF to_regclass('public.channel_connectors') IS NOT NULL THEN
   IF EXISTS(SELECT 1 FROM public.channel_connectors c WHERE tenant_id=ANY(r.scope_ids) AND (c.credentials_vault_ref IS NOT NULL OR c.external_account_id IS NOT NULL OR NOT(coalesce(c.config->>'managed_default','false')='true' AND c.provider='resend'))) THEN
     blockers:=blockers||jsonb_build_array('Connected provider accounts or Vault credentials require documented disconnect/revocation and secure cleanup before deletion.');
   END IF;
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('relation',key,'count',(value->>'count')::bigint,'disposition',value->>'disposition') ORDER BY key),'[]') INTO summary FROM jsonb_each(p->'tables');
 -- Storage metadata is inventory only. SQL deletion would orphan actual object bytes.
 IF to_regclass('storage.objects') IS NOT NULL THEN
   EXECUTE 'SELECT count(*) FROM storage.objects o WHERE split_part(o.name,''/'',1)=ANY($1) OR (split_part(o.name,''/'',1)=''tenants'' AND split_part(o.name,''/'',2)=ANY($1))'
     INTO storage_count USING ARRAY(SELECT unnest(r.scope_ids)::text);
   IF storage_count>0 THEN blockers:=blockers||jsonb_build_array(format('%s tenant-prefixed storage objects require the canonical Storage API cleanup and absence readback.',storage_count)); END IF;
 END IF;
 -- No CTID or payload in the public preflight/version.
 SELECT md5(jsonb_build_object('scope',accounts,'tables',coalesce(jsonb_object_agg(key,value-'tids'),'{}'),'blockers',blockers,'storage_count',storage_count)::text) INTO version FROM jsonb_each(p->'tables');
 SELECT count(*),count(DISTINCT m.user_id) FILTER(WHERE EXISTS(SELECT 1 FROM public.tenant_members other WHERE other.user_id=m.user_id AND NOT(other.tenant_id=ANY(r.scope_ids)))) INTO members,shared FROM public.tenant_members m WHERE tenant_id=ANY(r.scope_ids);
 RETURN jsonb_build_object('tenant_id',t.id,'archive_operation_id',r.id,'accounts',accounts,'version',version,'dependencies',summary,'storage_count',storage_count,
  'memberships',members,'shared_identities',shared,'data_version',(SELECT md5(jsonb_build_object('scope',accounts,'tables',coalesce(jsonb_object_agg(key,value-'tids'),'{}'))::text) FROM jsonb_each(p->'tables')),
  'warnings',public.operator_external_retirement_warnings(r.scope_ids),'preserved',jsonb_build_array('Shared Auth identities and survivor memberships','Necessary platform audit evidence and scheduled backups under existing retention policies'),
  'blockers',blockers,'execution_available',jsonb_array_length(blockers)=0);
END $$;

REVOKE ALL ON FUNCTION public.operator_preview_account_deletion(uuid) FROM PUBLIC,anon,service_role;

CREATE OR REPLACE FUNCTION public.operator_delete_archived_account(_tenant_id uuid,_expected_version text,_confirmation_name text,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tenants; p jsonb; plan jsonb; r public.operator_account_archives; item record; fk record; exists_ref boolean; progressed boolean; remaining int; target text;
BEGIN
 IF NOT public.operator_can_permanently_delete_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 PERFORM public.operator_lock_retirement_scope();
 SELECT * INTO r FROM public.operator_account_archives WHERE id=_operation_id AND root_tenant_id=_tenant_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'archive operation not found' USING ERRCODE='55000'; END IF;
 IF r.state='deleted' AND r.root_name=_confirmation_name THEN RETURN public.operator_read_archive_receipt(_tenant_id,_operation_id); END IF;
 IF r.state<>'archived' THEN RAISE EXCEPTION 'archive before deletion' USING ERRCODE='55000'; END IF;
 p:=public.operator_preview_account_deletion(_tenant_id);
 IF p->>'version' IS DISTINCT FROM _expected_version THEN RAISE EXCEPTION 'scope changed; refresh deletion preflight' USING ERRCODE='40001'; END IF;
 IF NOT(p->>'execution_available')::boolean THEN RAISE EXCEPTION 'deletion blocked; resolve preflight dependencies' USING ERRCODE='55000'; END IF;
 SELECT * INTO t FROM public.tenants WHERE id=_tenant_id;
 IF _confirmation_name IS DISTINCT FROM t.name THEN RAISE EXCEPTION 'type the exact account name' USING ERRCODE='22023'; END IF;
 PERFORM public.operator_detach_pending_provider_preparation(r.scope_ids);
 UPDATE public.operator_account_archives SET state='deleting',external_cleanup=public.operator_external_retirement_inventory(r.scope_ids) WHERE id=r.id;
 PERFORM public.operator_remove_retired_credentials(r.scope_ids);
 plan:=(public.operator_account_deletion_plan(r.scope_ids))->'tables';
 -- Preserve shared identities; clear only their pointer into the deleted scope.
 UPDATE public.profiles SET active_tenant_id=NULL WHERE active_tenant_id=ANY(r.scope_ids);
 plan:=plan-'profiles';
 IF plan ? 'paige_audit_log' THEN
   UPDATE public.paige_audit_log SET operator_rows_server_only=true,tenant_id=NULL WHERE tenant_id=ANY(r.scope_ids);
   plan:=plan-'paige_audit_log';
 END IF;
 -- Retain accounting in its one canonical home; historical amounts and quantities remain.
 FOREACH target IN ARRAY ARRAY['platform_subscriptions','platform_usage_events','paige_voice_cost_reservations'] LOOP
  IF plan ? target THEN
   EXECUTE format('UPDATE public.%I SET retired_tenant_id=tenant_id,tenant_id=NULL,operator_rows_server_only=true WHERE tenant_id=ANY($1)',target) USING r.scope_ids;
   plan:=plan-target;
  END IF;
 END LOOP;
 IF plan ? 'paige_llm_trace' THEN
  -- Only a trace whose primary tenant is deleted loses business excerpts. A surviving
  -- primary tenant retains its trace and data; only the retired working-context link moves.
  UPDATE public.paige_llm_trace SET retired_tenant_id=tenant_id,tenant_id=NULL,operator_rows_server_only=true,
   input_excerpt=NULL,output_excerpt=NULL,error_message=NULL,task_id=NULL,deliverable_id=NULL,metadata='{}'
   WHERE tenant_id=ANY(r.scope_ids);
  UPDATE public.paige_llm_trace SET retired_working_context_tenant_id=working_context_tenant_id,working_context_tenant_id=NULL WHERE working_context_tenant_id=ANY(r.scope_ids);
  plan:=plan-'paige_llm_trace';
 END IF;
 -- Explicit row cleanup, child before parent. Restrictive/cyclic unknown paths fail atomically.
 LOOP
   remaining:=0; progressed:=false;
   FOR item IN SELECT key relation,value FROM jsonb_each(plan) ORDER BY key LOOP
     remaining:=remaining+1; exists_ref:=false;
     FOR fk IN SELECT k.oid,c.relname child FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE k.contype='f' AND k.confrelid=to_regclass(format('public.%I',item.relation)) AND k.conrelid<>k.confrelid AND n.nspname='public' ORDER BY k.oid LOOP
       EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I c JOIN public.%I p ON %s WHERE p.ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)))',fk.child,item.relation,public.operator_retirement_fk_join(fk.oid)) INTO exists_ref USING item.value->'tids';
       EXIT WHEN exists_ref;
     END LOOP;
     IF exists_ref THEN CONTINUE; END IF;
     IF item.value->>'disposition'<>'delete' THEN RAISE EXCEPTION 'unsupported disposition' USING ERRCODE='55000'; END IF;
     IF item.relation='tenants' THEN
       -- Explicit child-before-parent removal even for restrictive self-references.
       WHILE EXISTS(SELECT 1 FROM public.tenants WHERE id=ANY(r.scope_ids)) LOOP
         DELETE FROM public.tenants victim WHERE victim.id=ANY(r.scope_ids) AND NOT EXISTS(SELECT 1 FROM public.tenants child WHERE child.parent_tenant_id=victim.id);
         IF NOT FOUND THEN RAISE EXCEPTION 'account tree cannot be retired without orphaning children' USING ERRCODE='55000'; END IF;
       END LOOP;
     ELSE
       EXECUTE format('DELETE FROM public.%I WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1))',item.relation) USING item.value->'tids';
     END IF;
     plan:=plan-item.relation; progressed:=true;
   END LOOP;
   EXIT WHEN remaining=0;
   IF NOT progressed THEN RAISE EXCEPTION 'restrictive or cyclic dependencies require supported cleanup; nothing deleted' USING ERRCODE='55000'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.tenants WHERE id=ANY(r.scope_ids)) OR EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=ANY(r.scope_ids)) THEN RAISE EXCEPTION 'retirement absence readback failed' USING ERRCODE='55000'; END IF;
 IF (public.operator_account_deletion_plan(r.scope_ids))->'tables'<>'{}'::jsonb THEN RAISE EXCEPTION 'scoped data absence readback failed; transaction rolled back' USING ERRCODE='55000'; END IF;
 UPDATE public.operator_account_archives SET prior_tenants='[]',resource_plan='[]' WHERE resource_mode IS NOT NULL AND state='resources_ready' AND scope_ids<@r.scope_ids;
 UPDATE public.operator_account_archives SET state='deleted',deleted_at=now(),prior_tenants='[]',prior_members='[]' WHERE scope_ids<@r.scope_ids AND state IN ('archived','restored','deleting');
 INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(auth.uid(),'tenant.permanent_delete','tenant',_tenant_id,jsonb_build_object('operation_id',r.id,'account_count',cardinality(r.scope_ids),'preflight_version',_expected_version));
 RETURN public.operator_read_archive_receipt(_tenant_id,_operation_id);
END $$;

REVOKE ALL ON FUNCTION public.operator_delete_archived_account(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_delete_archived_account(uuid,text,text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.operator_remove_retired_credentials(_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item record; rel record; shared boolean; refs bigint;
BEGIN
 IF NOT public.operator_can_permanently_delete_accounts() OR NOT EXISTS(SELECT 1 FROM public.operator_account_archives
  WHERE state='deleting' AND scope_ids @> _ids AND scope_ids <@ _ids) THEN
  RAISE EXCEPTION 'confirmed administrator deletion required' USING ERRCODE='42501';
 END IF;
 -- Remove only exact, exclusively tenant-owned canonical Vault entries. Shared or
 -- legacy credential references remain protected pending their independent disposition.
 FOR item IN SELECT tenant_id,auth_token_vault_ref reference FROM public.tenant_twilio_subaccounts WHERE tenant_id=ANY(_ids) LOOP
  IF item.reference IS NULL OR item.reference<>'twilio_subaccount_api_key_secret:'||item.tenant_id::text THEN CONTINUE; END IF;
  shared:=false;
  FOR rel IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND data_type='text'
   AND (column_name LIKE '%vault%ref%' OR column_name='auth_token_vault_ref') LOOP
   EXECUTE format('SELECT count(*) FROM public.%I WHERE %I=$1 %s',rel.table_name,rel.column_name,
    CASE WHEN rel.table_name='tenant_twilio_subaccounts' THEN 'AND NOT(tenant_id=ANY($2))' ELSE '' END) INTO refs USING item.reference,_ids;
   IF refs>0 THEN shared:=true; END IF;
  END LOOP;
  IF NOT shared THEN DELETE FROM vault.secrets WHERE name=item.reference; END IF;
 END LOOP;
 -- These are PAIGE-owned encrypted credentials, not external workflow deletion.
 -- This private finalizer is called only by the Admin-authorized deletion RPC.
 -- Keep the ordinary tenant connection writer's authorization unchanged.
 UPDATE public.tenant_n8n_connections SET base_url_ct=NULL,api_key_ct=NULL,api_key_last4=NULL,
  status='unconfigured',last_error=NULL,workflow_count=0,updated_by=auth.uid(),updated_at=now()
 WHERE tenant_id=ANY(_ids);
 DELETE FROM public.mcp_connection_approvals WHERE connection_id IN (SELECT connection_id FROM public.mcp_connections WHERE tenant_id=ANY(_ids) AND legacy_source='tenant_n8n_connections');
 DELETE FROM public.mcp_connection_tools WHERE connection_id IN (SELECT connection_id FROM public.mcp_connections WHERE tenant_id=ANY(_ids) AND legacy_source='tenant_n8n_connections');
 UPDATE public.mcp_connections SET enabled=false,server_url_ct=NULL,auth_token_ct=NULL,auth_token_last4=NULL,refresh_token_ct=NULL,oauth_client_secret_ct=NULL,
  inbound_contact_secret_hash=NULL,inbound_contact_actor=NULL,granted_scopes='{}',provider_state='{}',status='unconfigured',health='unknown',last_error_code=NULL,last_checked_at=NULL,updated_by=auth.uid(),updated_at=now()
 WHERE tenant_id=ANY(_ids) AND legacy_source='tenant_n8n_connections' AND provider_key='n8n';
END $$;

REVOKE ALL ON FUNCTION public.operator_remove_retired_credentials(uuid[]) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.operator_preview_account_deletion(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.operator_read_account_details(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.operator_preview_account_archive(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.operator_archive_account(uuid,text,text,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.operator_restore_archived_account(uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.operator_read_archive_receipt(uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.operator_set_tenant_status(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.operator_preview_retirement_resources(_tenant_id uuid,_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p jsonb; ids uuid[]; blockers jsonb:='[]'; resources jsonb:='[]'; item record; version text; n bigint; storage_supported boolean; cache_tenant uuid;
BEGIN
 IF NOT (CASE WHEN _mode='archive' THEN public.operator_can_archive_accounts() ELSE public.operator_can_permanently_delete_accounts() END) THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 IF _mode NOT IN ('archive','delete') THEN RAISE EXCEPTION 'invalid resource action' USING ERRCODE='22023'; END IF;
 p:=CASE WHEN _mode='archive' THEN public.operator_preview_account_archive(_tenant_id) ELSE public.operator_preview_account_deletion(_tenant_id) END;
 SELECT array_agg((a->>'id')::uuid) INTO ids FROM jsonb_array_elements(p->'accounts') a;
 storage_supported:=NOT EXISTS(SELECT 1 FROM storage.objects o WHERE (split_part(o.name,'/',1)=ANY(ARRAY(SELECT unnest(ids)::text)) OR (split_part(o.name,'/',1)='tenants' AND split_part(o.name,'/',2)=ANY(ARRAY(SELECT unnest(ids)::text)))) AND ((o.bucket_id IS DISTINCT FROM 'tts-cache' AND o.bucket_id IS DISTINCT FROM 'paige-generated') OR split_part(o.name,'/',1)='tenants'));
 SELECT coalesce(jsonb_agg(b),'[]') INTO blockers FROM jsonb_array_elements_text(p->'blockers') b
 WHERE NOT(_mode='delete' AND storage_supported AND b LIKE '% tenant-prefixed storage objects require the canonical Storage API cleanup and absence readback.');
 IF _mode='delete' THEN
  FOREACH cache_tenant IN ARRAY ids LOOP
   BEGIN
    n:=jsonb_array_length(public.operator_tts_cache_manifest(cache_tenant));
    IF n>0 THEN resources:=resources||jsonb_build_array(jsonb_build_object('provider','tts_cache','tenant_id',cache_tenant,'action','remove_cache','object_count',n)); END IF;
   EXCEPTION WHEN SQLSTATE '55000' THEN blockers:=blockers||jsonb_build_array('Cached audio needs a private, bounded, unversioned canonical scope.'); END;
   BEGIN
    n:=jsonb_array_length(public.operator_generated_media_manifest(cache_tenant));
    IF n>0 THEN resources:=resources||jsonb_build_array(jsonb_build_object('provider','generated_media','tenant_id',cache_tenant,'action','remove_media','object_count',n)); END IF;
   EXCEPTION WHEN SQLSTATE '55000' THEN blockers:=blockers||jsonb_build_array('Generated media needs a bounded canonical scope without shared, published or retention dependencies.'); END;
  END LOOP;
 END IF;
 IF jsonb_array_length(resources)>50 THEN blockers:=blockers||jsonb_build_array('Provider preparation exceeds the supported bounded scope.'); END IF;
 -- Bind the review to current account state and every resource row without exposing credentials.
 SELECT md5(coalesce(p->>'version','')||_mode||resources::text||coalesce(string_agg(public.operator_resource_fingerprint(provider,tenant_id),'' ORDER BY provider,tenant_id),'')) INTO version
 FROM jsonb_to_recordset(resources) AS x(provider text,tenant_id uuid);
 RETURN jsonb_build_object('tenant_id',_tenant_id,'mode',_mode,'version',version,'accounts',p->'accounts','resources',resources,'blockers',blockers,
 'execution_available',jsonb_array_length(blockers)=0 AND jsonb_array_length(resources)>0);
END $$;

REVOKE ALL ON FUNCTION public.operator_preview_retirement_resources(uuid,text) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.operator_preview_retirement_resources(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.operator_begin_retirement_resources(_tenant_id uuid,_mode text,_expected_version text,_confirmation_name text,_operation_id uuid,_retain_external_n8n boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p jsonb; ids uuid[]; plan jsonb:='[]'; item record; existing public.operator_account_archives; name text; cache_tenant uuid; objects jsonb;
BEGIN
 IF NOT (CASE WHEN _mode='archive' THEN public.operator_can_archive_accounts() ELSE public.operator_can_permanently_delete_accounts() END) THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 IF _operation_id IS NULL THEN RAISE EXCEPTION 'operation id required' USING ERRCODE='22023'; END IF;
 PERFORM public.operator_lock_retirement_scope();
 SELECT * INTO existing FROM public.operator_account_archives WHERE id=_operation_id;
 IF FOUND THEN
  IF existing.root_tenant_id<>_tenant_id OR existing.root_name<>_confirmation_name OR existing.resource_mode IS DISTINCT FROM _mode OR existing.actor_user_id<>auth.uid() THEN RAISE EXCEPTION 'operation belongs to another request' USING ERRCODE='22023'; END IF;
  RETURN public.operator_read_retirement_resources(_tenant_id,_operation_id);
 END IF;
 p:=public.operator_preview_retirement_resources(_tenant_id,_mode);
 IF p->>'version' IS DISTINCT FROM _expected_version THEN RAISE EXCEPTION 'resources changed; refresh review' USING ERRCODE='40001'; END IF;
 IF NOT(p->>'execution_available')::boolean THEN RAISE EXCEPTION 'resource preparation blocked' USING ERRCODE='55000'; END IF;
 SELECT t.name INTO name FROM public.tenants t WHERE id=_tenant_id;
 IF _confirmation_name IS DISTINCT FROM name THEN RAISE EXCEPTION 'type the exact account name' USING ERRCODE='22023'; END IF;
 SELECT array_agg((a->>'id')::uuid) INTO ids FROM jsonb_array_elements(p->'accounts') a;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'resources') a WHERE a->>'provider'='n8n') AND NOT coalesce(_retain_external_n8n,false) THEN RAISE EXCEPTION 'explicit external n8n retention acknowledgement required' USING ERRCODE='22023'; END IF;
 PERFORM public.operator_detach_pending_provider_preparation(ids);
 IF EXISTS(SELECT 1 FROM public.operator_account_archives r WHERE r.resource_mode IS NOT NULL AND r.state IN ('resources_preparing','resources_unknown') AND r.scope_ids&&ids) THEN RAISE EXCEPTION 'read the existing resource operation before another preparation' USING ERRCODE='55000'; END IF;
 IF _mode='delete' THEN
  FOREACH cache_tenant IN ARRAY ids LOOP
   objects:=public.operator_tts_cache_manifest(cache_tenant);
   IF objects<>'[]'::jsonb THEN plan:=plan||jsonb_build_array(jsonb_build_object('key','tts_cache:'||cache_tenant,'provider','tts_cache','tenant_id',cache_tenant,'objects',objects,'fingerprint',public.operator_resource_fingerprint('tts_cache',cache_tenant))); END IF;
   objects:=public.operator_generated_media_manifest(cache_tenant);
   IF objects<>'[]'::jsonb THEN plan:=plan||jsonb_build_array(jsonb_build_object('key','generated_media:'||cache_tenant,'provider','generated_media','tenant_id',cache_tenant,'objects',objects,'fingerprint',public.operator_resource_fingerprint('generated_media',cache_tenant))); END IF;
  END LOOP;
 END IF;
 INSERT INTO public.operator_account_archives(id,root_tenant_id,actor_user_id,root_name,state,scope_ids,prior_tenants,prior_members,resource_mode,resource_plan)
 VALUES(_operation_id,_tenant_id,auth.uid(),name,'resources_preparing',ids,(SELECT jsonb_agg(to_jsonb(t)) FROM public.tenants t WHERE id=ANY(ids)),'[]',_mode,plan);
 UPDATE public.tenants SET lifecycle_execution_paused=true WHERE id=ANY(ids) AND NOT lifecycle_execution_paused;
 INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(auth.uid(),'tenant.resources_prepare','tenant',_tenant_id,jsonb_build_object('operation_id',_operation_id,'mode',_mode,'account_count',cardinality(ids),'external_n8n_retained',_retain_external_n8n));
 RETURN public.operator_read_retirement_resources(_tenant_id,_operation_id);
END $$;

REVOKE ALL ON FUNCTION public.operator_begin_retirement_resources(uuid,text,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.operator_begin_retirement_resources(uuid,text,text,text,uuid,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.operator_read_retirement_resources(_tenant_id uuid,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives; summary jsonb;
BEGIN
 IF NOT public.operator_can_archive_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.operator_account_archives WHERE (_operation_id IS NULL OR id=_operation_id) AND root_tenant_id=_tenant_id AND resource_mode IS NOT NULL
 AND actor_user_id=auth.uid() ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'resource operation not found' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('provider',value->>'provider','state',value->>'state','provider_status',value->>'provider_status','reason',value->>'reason')),'[]') INTO summary FROM jsonb_each(r.resource_results);
 RETURN jsonb_build_object('tenant_id',r.root_tenant_id,'operation_id',r.id,'mode',r.resource_mode,'state',r.state,'account_count',cardinality(r.scope_ids),'file_only',jsonb_array_length(r.resource_plan)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.resource_plan) p WHERE p->>'provider' NOT IN ('tts_cache','generated_media')),'results',summary);
END $$;

REVOKE ALL ON FUNCTION public.operator_read_retirement_resources(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE ON FUNCTION public.operator_read_retirement_resources(uuid,uuid) TO authenticated;
