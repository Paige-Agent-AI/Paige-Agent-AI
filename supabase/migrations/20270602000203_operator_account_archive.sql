-- Extend the canonical Operator lifecycle. No account backfill, Auth deletion or provider calls.
-- The one existing Super Admin is the Platform Owner. Owner-invited administrators use
-- platform_admin; inviting an administrator must not create another Platform Owner.
CREATE UNIQUE INDEX IF NOT EXISTS operator_single_platform_owner ON public.user_roles(role) WHERE role='super_admin';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS archive_operation_id uuid;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS lifecycle_execution_paused boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.operator_account_archives (
  id uuid PRIMARY KEY, root_tenant_id uuid NOT NULL, actor_user_id uuid NOT NULL,
  root_name text NOT NULL, state text NOT NULL CHECK(state IN ('preparing','archived','restoring','restored','deleting','deleted')),
  scope_ids uuid[] NOT NULL, prior_tenants jsonb NOT NULL, prior_members jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
ALTER TABLE public.operator_account_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_account_archives FROM PUBLIC,anon,authenticated,service_role;

-- One existing protected role predicate. Neither ordinary Platform membership nor tenant admin qualifies.
CREATE OR REPLACE FUNCTION public.operator_can_retire_accounts()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT auth.uid() IS NOT NULL AND public.is_platform_admin()
$$;

CREATE OR REPLACE FUNCTION public.operator_read_archive_receipt(_tenant_id uuid,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives;
BEGIN
  IF NOT public.operator_can_retire_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM public.operator_account_archives WHERE id=_operation_id AND root_tenant_id=_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'operation not found' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('tenant_id',r.root_tenant_id,'operation_id',r.id,'state',r.state,'account_count',cardinality(r.scope_ids));
END $$;

CREATE OR REPLACE FUNCTION public.operator_preview_account_archive(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ids uuid[]; accounts jsonb; fingerprint text; blockers jsonb:='[]'; rel text; n bigint; members bigint; shared bigint;
BEGIN
  IF NOT public.operator_can_retire_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
  WITH RECURSIVE tree AS (
    SELECT id FROM public.tenants WHERE id=_tenant_id
    UNION SELECT t.id FROM public.tenants t JOIN tree p ON t.parent_tenant_id=p.id
  ) SELECT array_agg(id ORDER BY id) INTO ids FROM tree;
  IF ids IS NULL THEN RAISE EXCEPTION 'account not found' USING ERRCODE='P0002'; END IF;
  IF cardinality(ids)>100 THEN RAISE EXCEPTION 'account tree exceeds the bounded operation limit' USING ERRCODE='54000'; END IF;
  SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'account_type',account_type,'status',status,'parent_tenant_id',parent_tenant_id) ORDER BY id) INTO accounts FROM public.tenants WHERE id=ANY(ids);
  SELECT md5(jsonb_build_object('tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenants t WHERE id=ANY(ids)),
    'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.tenant_members m WHERE tenant_id=ANY(ids)))::text) INTO fingerprint;
  IF EXISTS(SELECT 1 FROM public.tenants WHERE id=ANY(ids) AND (archived_at IS NOT NULL OR features->'system_workspace'='true'::jsonb OR account_type NOT IN ('agency','sub_account','standalone'))) THEN
    blockers:=blockers||jsonb_build_array('Platform workspaces, unsupported types and already archived accounts are protected.');
  END IF;
  -- No archive can race a worker already executing an external operation.
  FOREACH rel IN ARRAY ARRAY['paige_durable_work','paige_workflow_runs','paige_actions','paige_media_jobs','paige_social_jobs','email_campaign_dispatches','growth_submission_dispatches'] LOOP
    IF to_regclass('public.'||rel) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I t WHERE tenant_id=ANY($1) AND coalesce(to_jsonb(t)->>''status'',to_jsonb(t)->>''state'') IN (''running'',''claimed'',''drafting'',''dispatching'',''processing'',''sending'',''executing'')',rel) INTO n USING ids;
    IF n>0 THEN blockers:=blockers||jsonb_build_array(format('%s: %s operations are in flight. Quiesce and verify the existing worker before archiving.',rel,n)); END IF;
  END LOOP;
  -- External services can run independently of PAIGE. Archive never claims to terminate them.
  IF EXISTS(SELECT 1 FROM public.tenants WHERE id=ANY(ids) AND (stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL)) THEN
    blockers:=blockers||jsonb_build_array('Billing references require verified cancellation or retention disposition through the existing billing lifecycle before archive.');
  END IF;
  FOREACH rel IN ARRAY ARRAY['tenant_twilio_subaccounts','tenant_n8n_connections','tenant_mcp_connections','tenant_stripe_accounts','tenant_paypal_accounts','tenant_zapier_api_connections'] LOOP
    IF to_regclass('public.'||rel) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=ANY($1)',rel) INTO n USING ids;
    IF n>0 THEN blockers:=blockers||jsonb_build_array(format('%s: %s external-resource references require verified provider retirement or approved retention before archive.',rel,n)); END IF;
  END LOOP;
  IF to_regclass('public.channel_connectors') IS NOT NULL THEN
    IF EXISTS(SELECT 1 FROM public.channel_connectors c WHERE tenant_id=ANY(ids) AND (c.credentials_vault_ref IS NOT NULL OR c.external_account_id IS NOT NULL OR NOT(coalesce(c.config->>'managed_default','false')='true' AND c.provider='resend'))) THEN
      blockers:=blockers||jsonb_build_array('External connector credentials or resources require documented disconnection before archive.');
    END IF;
  END IF;
  IF to_regclass('public.paige_invoice_provider_operations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.paige_invoice_provider_operations WHERE tenant_id=ANY($1) AND state NOT IN (''failed'',''expired'',''cancelled'')' INTO n USING ids;
    IF n>0 THEN blockers:=blockers||jsonb_build_array('An unresolved payment-provider operation must be reconciled before archive.'); END IF;
  END IF;
  SELECT count(*),count(DISTINCT m.user_id) FILTER(WHERE EXISTS(SELECT 1 FROM public.tenant_members other WHERE other.user_id=m.user_id AND NOT(other.tenant_id=ANY(ids)))) INTO members,shared FROM public.tenant_members m WHERE tenant_id=ANY(ids);
  RETURN jsonb_build_object('tenant_id',_tenant_id,'accounts',accounts,'version',fingerprint,'blockers',blockers,'memberships',members,'shared_identities',shared,'execution_available',jsonb_array_length(blockers)=0);
END $$;

CREATE OR REPLACE FUNCTION public.guard_operator_account_archive()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF NOT public.operator_can_retire_accounts() OR NOT EXISTS(SELECT 1 FROM public.operator_account_archives r WHERE r.state='deleting' AND OLD.id=ANY(r.scope_ids) AND OLD.archive_operation_id=r.id) THEN
      RAISE EXCEPTION 'permanent deletion requires the canonical confirmed operation' USING ERRCODE='42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.archived_at IS NOT NULL OR NEW.archive_operation_id IS NOT NULL OR NEW.lifecycle_execution_paused THEN RAISE EXCEPTION 'archive requires the canonical operation' USING ERRCODE='42501'; END IF;
  ELSIF NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archive_operation_id IS DISTINCT FROM OLD.archive_operation_id
    OR NEW.lifecycle_execution_paused IS DISTINCT FROM OLD.lifecycle_execution_paused THEN
    IF NOT public.operator_can_retire_accounts() OR NOT EXISTS(
      SELECT 1 FROM public.operator_account_archives r WHERE NEW.id=ANY(r.scope_ids)
      AND ((NEW.archived_at IS NOT NULL AND NEW.archive_operation_id=r.id AND NEW.lifecycle_execution_paused AND r.state='preparing')
        OR (NEW.archived_at IS NULL AND NEW.archive_operation_id IS NULL AND NEW.lifecycle_execution_paused AND OLD.archive_operation_id=r.id AND r.state='restoring'))
    ) THEN RAISE EXCEPTION 'archive requires the canonical operation' USING ERRCODE='42501'; END IF;
  ELSIF OLD.archived_at IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
    RAISE EXCEPTION 'restore the archived account before editing it' USING ERRCODE='55000';
  END IF;
  IF NEW.parent_tenant_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.tenants WHERE id=NEW.parent_tenant_id AND archived_at IS NOT NULL) THEN
    IF TG_OP='INSERT' OR NEW.parent_tenant_id IS DISTINCT FROM OLD.parent_tenant_id THEN RAISE EXCEPTION 'restore the parent before adding a child' USING ERRCODE='55000'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a01_operator_account_archive ON public.tenants;
CREATE TRIGGER a01_operator_account_archive BEFORE INSERT OR UPDATE OR DELETE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.guard_operator_account_archive();
DROP POLICY IF EXISTS operator_archived_tenant_read_guard ON public.tenants;
CREATE POLICY operator_archived_tenant_read_guard ON public.tenants AS RESTRICTIVE FOR SELECT TO authenticated USING(archived_at IS NULL OR public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.guard_archived_tenant_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status='active' AND EXISTS(SELECT 1 FROM public.tenants WHERE id=NEW.tenant_id AND archived_at IS NOT NULL) THEN RAISE EXCEPTION 'restore before granting access' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a01_archived_tenant_membership ON public.tenant_members;
CREATE TRIGGER a01_archived_tenant_membership BEFORE INSERT OR UPDATE ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public.guard_archived_tenant_membership();

-- The canonical account-entry and act-as paths both persist this pointer. Guard that seam,
-- including service writes, so an archived account cannot be entered through a stale tab/RPC.
CREATE OR REPLACE FUNCTION public.guard_archived_tenant_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.active_tenant_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.tenants WHERE id=NEW.active_tenant_id AND archived_at IS NOT NULL) THEN
  RAISE EXCEPTION 'restore the archived account before entering it' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a01_archived_tenant_entry ON public.profiles;
CREATE TRIGGER a01_archived_tenant_entry BEFORE INSERT OR UPDATE OF active_tenant_id ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_archived_tenant_entry();

-- Reject queue claims/writes to archived data even for service workers. This is not an egress engine.
CREATE OR REPLACE FUNCTION public.guard_archived_tenant_work()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.tenants WHERE id=(to_jsonb(NEW)->>'tenant_id')::uuid AND (archived_at IS NOT NULL OR lifecycle_execution_paused)) THEN
    RAISE EXCEPTION 'workspace execution paused by lifecycle' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY['paige_durable_work','paige_workflow_runs','paige_actions','paige_media_jobs','paige_social_jobs','email_campaign_dispatches','growth_submission_dispatches','paige_automations','paige_native_events'] LOOP
    IF to_regclass('public.'||rel) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS a01_archived_tenant_work ON public.%I',rel);
    EXECUTE format('CREATE TRIGGER a01_archived_tenant_work BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_archived_tenant_work()',rel);
  END LOOP;
END $$;

-- Private catalog lock: freeze scoped tables AND all inbound FK descendants. No constraints are disabled.
CREATE OR REPLACE FUNCTION public.operator_lock_retirement_scope()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record;
BEGIN
  PERFORM set_config('lock_timeout','3s',true);
  LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE;
  FOR r IN WITH RECURSIVE relations(oid) AS (
    SELECT DISTINCT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname='public' AND c.relkind='r' AND NOT a.attisdropped AND (a.attname='tenant_id' OR a.attname LIKE '%\_tenant\_id' ESCAPE '\')
    UNION SELECT k.conrelid FROM pg_constraint k JOIN relations p ON k.confrelid=p.oid WHERE k.contype='f'
  ) SELECT n.nspname,c.relname FROM relations p JOIN pg_class c ON c.oid=p.oid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' ORDER BY c.relname
  LOOP EXECUTE format('LOCK TABLE %I.%I IN SHARE ROW EXCLUSIVE MODE',r.nspname,r.relname); END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.operator_archive_account(_tenant_id uuid,_expected_version text,_confirmation_name text,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p jsonb; ids uuid[]; row public.tenants; existing public.operator_account_archives;
BEGIN
  IF NOT public.operator_can_retire_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
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
      (SELECT jsonb_agg(jsonb_build_object('id',t.id,'status',t.status) ORDER BY t.id) FROM public.tenants t WHERE t.id=ANY(ids)),
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'tenant_id',m.tenant_id,'user_id',m.user_id,'role',m.role,'status',m.status,'is_owner',to_jsonb(m)->'is_owner') ORDER BY m.id) FROM public.tenant_members m WHERE m.tenant_id=ANY(ids)),'[]');
  -- Same canonical status transition/audit for both privileged operator roles.
  FOR row IN SELECT * FROM public.tenants WHERE id=ANY(ids) ORDER BY id LOOP
    PERFORM public.operator_set_tenant_status(row.id,'canceled','Account archived through Fleet');
  END LOOP;
  UPDATE public.tenants SET archived_at=now(),archive_operation_id=_operation_id,lifecycle_execution_paused=true WHERE id=ANY(ids);
  UPDATE public.tenant_members SET status='archived' WHERE tenant_id=ANY(ids) AND status='active';
  UPDATE public.profiles SET active_tenant_id=NULL WHERE active_tenant_id=ANY(ids);
  UPDATE public.operator_account_archives SET state='archived' WHERE id=_operation_id;
  INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(auth.uid(),'tenant.archive','tenant',_tenant_id,jsonb_build_object('operation_id',_operation_id,'account_count',cardinality(ids)));
  RETURN public.operator_read_archive_receipt(_tenant_id,_operation_id);
END $$;

CREATE OR REPLACE FUNCTION public.operator_restore_archived_account(_tenant_id uuid,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives; saved jsonb;
BEGIN
  IF NOT public.operator_can_retire_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
  PERFORM public.operator_lock_retirement_scope();
  SELECT * INTO r FROM public.operator_account_archives WHERE id=_operation_id AND root_tenant_id=_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'archive operation not found' USING ERRCODE='P0002'; END IF;
  IF r.state='restored' THEN RETURN public.operator_read_archive_receipt(_tenant_id,_operation_id); END IF;
  IF r.state<>'archived' OR (SELECT count(*) FROM public.tenants WHERE id=ANY(r.scope_ids) AND archive_operation_id=r.id)<>cardinality(r.scope_ids) THEN RAISE EXCEPTION 'archive changed; recovery required' USING ERRCODE='55000'; END IF;
  UPDATE public.operator_account_archives SET state='restoring' WHERE id=r.id;
  UPDATE public.tenants SET archived_at=NULL,archive_operation_id=NULL WHERE id=ANY(r.scope_ids);
  FOR saved IN SELECT value FROM jsonb_array_elements(r.prior_tenants) LOOP
    PERFORM public.operator_set_tenant_status((saved->>'id')::uuid,saved->>'status','Restore Fleet archive; execution remains paused');
  END LOOP;
  FOR saved IN SELECT value FROM jsonb_array_elements(r.prior_members) LOOP
    UPDATE public.tenant_members m SET status=saved->>'status' WHERE id=(saved->>'id')::uuid AND tenant_id=(saved->>'tenant_id')::uuid AND user_id=(saved->>'user_id')::uuid
      AND role::text=saved->>'role' AND coalesce(to_jsonb(m)->'is_owner','null'::jsonb) IS NOT DISTINCT FROM saved->'is_owner' AND status='archived';
  END LOOP;
  UPDATE public.operator_account_archives SET state='restored' WHERE id=r.id;
  INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(auth.uid(),'tenant.archive_restore','tenant',_tenant_id,jsonb_build_object('operation_id',r.id,'account_count',cardinality(r.scope_ids),'execution_paused',true));
  RETURN public.operator_read_archive_receipt(_tenant_id,_operation_id);
END $$;

-- A reviewed source allowlist grants disposition; catalog discovery alone NEVER grants deletion.
-- Independent financial/legal/security records and external resources are not in this list.
CREATE OR REPLACE FUNCTION public.operator_retirement_disposition(_table text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN _table=ANY(ARRAY[
 'tenants','tenant_members','tenant_features','tenant_account_number_seq','tenant_provisioning','tenant_revenue_classification',
 'clients','client_contact_methods','client_custom_field_values','client_memory','client_notes','client_types','custom_field_definitions',
 'businesses','business_public_presence','business_certifications','business_vendors','tenant_business_owners','tenant_business_representatives','tenant_entity_relationships',
 'deals','deal_activities','tasks','plans','plan_items','pipelines','pipeline_stages','pipeline_folders','pipeline_deal_outcomes',
 'pipeline_command_results','pipeline_archive_confirmations','pipeline_folder_archive_confirmations','pipeline_move_approvals','crm_command_previews','crm_command_results',
 'paige_chat_threads','paige_chat_turns','paige_owner_memory','paige_prompt_memory','paige_prompt_template','paige_conversations','paige_conversation_labels','paige_message_labels',
 'messages','message_classifications','message_labels','threads','paige_context_loads','tenant_knowledge_docs','tenant_knowledge_chunks','kb_coverage_signal','kb_query_telemetry',
 'tenant_setup_business_context_meta','tenant_setup_knowledge_sources','tenant_setup_paige_profiles','tenant_setup_private_context','tenant_setup_voice_examples',
 'tenant_tool_autonomy','tenant_journey_stages','tenant_invite_tokens','agency_team_members','agency_item_allowlist','tenant_comms_preferences','invitations','staff_calendar_settings',
 'calendars','calendar_groups','calendar_hosts','internal_bookings','booking_notifications_sent','email_templates','email_segments','snippets','signatures','marketing_content',
 'email_campaigns','email_campaign_versions','email_campaign_recipients','email_sequences','email_sequence_versions','email_sequence_steps','email_sequence_enrollments','email_unsubscribe_tokens',
 'campaign_briefs','campaign_brief_command_results','growth_pages','growth_forms','growth_form_submissions','growth_funnels','growth_funnel_steps','growth_funnel_sessions','growth_form_automations',
 'paige_automations','paige_automation_acts','paige_actions','paige_action_kinds','paige_approval_policies','paige_pending_approvals','paige_pending_confirmations','paige_tool_confirmations','paige_approval_comments',
 'paige_durable_work','paige_workflow_registry','paige_workflow_runs','paige_native_events','paige_event_dispatches','paige_event_kinds','paige_workspace_events','paige_unassigned_queue','paige_unclassified_inbound',
 'paige_readiness_proposals','paige_readiness_scan_runs','paige_systems_check_baseline','paige_systems_check_run','paige_systems_check_finding','paige_systems_check_signal_reference',
 'business_missions','business_mission_brief_versions','business_mission_mutation_receipts','paige_client_events','paige_customer_actions','paige_customer_responses',
 'paige_data_source_sync_state','paige_subagent_factory_quota','paige_subagents','paige_subagent_proposals','paige_subagent_invocations',
 'research_runs','research_sources','response_quality_feedback','team_handoff_queue','team_scoreboard_metrics','push_subscriptions','user_presence',
 'paige_sales_export_snapshots','paige_sales_export_members','paige_sales_import_batches','paige_sales_import_bindings','mcp_connection_contacts','mcp_connection_oauth_state','mcp_connection_tools','mcp_connection_approvals',
 'tenant_n8n_discoveries','tenant_n8n_oauth_attempts','tenant_mcp_oauth_state','tenant_zapier_api_oauth_attempts','tenant_zapier_intake_routes','tenant_zapier_intake_events','mailbox_sync_state',
 'channel_connectors','tenant_email_identities','tenant_workflows',
 'paige_eval_case','paige_eval_dataset','paige_eval_result','paige_eval_run','paige_live_tenant_availability',
 'programs','program_phases','program_enrollments','program_phase_item_states','program_messages','program_document_requests','program_approvals'
 ]) THEN 'delete' WHEN _table=ANY(ARRAY['profiles','paige_audit_log']) THEN 'preserve' ELSE 'blocked' END
$$;

CREATE OR REPLACE FUNCTION public.operator_retirement_fk_join(_constraint oid)
RETURNS text LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT string_agg(format('c.%I=p.%I',ca.attname,pa.attname),' AND ' ORDER BY z.n)
 FROM pg_constraint k CROSS JOIN LATERAL generate_subscripts(k.conkey,1) z(n)
 JOIN pg_attribute ca ON ca.attrelid=k.conrelid AND ca.attnum=k.conkey[z.n]
 JOIN pg_attribute pa ON pa.attrelid=k.confrelid AND pa.attnum=k.confkey[z.n] WHERE k.oid=_constraint
$$;

-- Private, transaction-local row plan. It returns CTIDs/hashes, never business content.
CREATE OR REPLACE FUNCTION public.operator_account_deletion_plan(_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE plan jsonb:='{}'; blockers jsonb:='[]'; r record; tids jsonb; old jsonb; round int; changed boolean; n bigint; hash text; invalid bigint; cond text; entry jsonb;
BEGIN
 FOR r IN SELECT c.table_name,string_agg(format('t.%I=ANY($1)',c.column_name),' OR ' ORDER BY c.column_name) predicate
   FROM information_schema.columns c JOIN information_schema.tables b USING(table_schema,table_name)
   WHERE c.table_schema='public' AND b.table_type='BASE TABLE' AND c.udt_name='uuid' AND c.table_name<>'operator_account_archives'
     AND (c.column_name='tenant_id' OR c.column_name LIKE '%\_tenant\_id' ESCAPE '\' OR (c.table_name='tenants' AND c.column_name='id'))
   GROUP BY c.table_name ORDER BY c.table_name
 LOOP
   -- tenants are only the exact confirmed IDs; parent_tenant_id never widens them here.
   cond:=CASE WHEN r.table_name='tenants' THEN 't.id=ANY($1)' ELSE r.predicate END;
   EXECUTE format('SELECT coalesce(jsonb_agg(ctid::text ORDER BY ctid),''[]'') FROM public.%I t WHERE %s',r.table_name,cond) INTO tids USING _ids;
   IF jsonb_array_length(tids)>0 THEN plan:=plan||jsonb_build_object(r.table_name,tids); END IF;
 END LOOP;
 -- Discover all FK descendants, including records that lack a tenant column.
 FOR round IN 1..30 LOOP
   changed:=false;
   FOR r IN SELECT k.oid,c.relname child,p.relname parent FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class p ON p.oid=k.confrelid
     WHERE k.contype='f' AND n.nspname='public' AND plan ? p.relname AND p.relname<>'profiles' AND public.operator_retirement_disposition(p.relname)='delete' ORDER BY c.relname,k.oid
   LOOP
     cond:=public.operator_retirement_fk_join(r.oid);
     old:=coalesce(plan->r.child,'[]');
     EXECUTE format('SELECT coalesce(jsonb_agg(ctid::text ORDER BY ctid),''[]'') FROM public.%I WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) OR ctid IN (SELECT c.ctid FROM public.%I c JOIN public.%I p ON %s WHERE p.ctid::text IN (SELECT value FROM jsonb_array_elements_text($2)))',r.child,r.child,r.parent,cond) INTO tids USING old,plan->r.parent;
     IF tids<>old THEN plan:=plan||jsonb_build_object(r.child,tids); changed:=true; END IF;
   END LOOP;
   EXIT WHEN NOT changed;
 END LOOP;
 IF changed THEN blockers:=blockers||jsonb_build_array('Dependency graph exceeded the bounded review depth. Administrator disposition required.'); END IF;
 FOR r IN SELECT key relation,value tids FROM jsonb_each(plan) ORDER BY key LOOP
   n:=jsonb_array_length(r.tids);
   IF n>20000 THEN blockers:=blockers||jsonb_build_array(format('%s exceeds the bounded cleanup size; use a reviewed maintenance operation.',r.relation)); END IF;
   -- Every explicit scope field on a selected row must be empty or within the confirmed tree.
   SELECT string_agg(format('(t.%I IS NOT NULL AND NOT(t.%I=ANY($2)))',column_name,column_name),' OR ') INTO cond FROM information_schema.columns
     WHERE table_schema='public' AND table_name=r.relation AND udt_name='uuid' AND (column_name='tenant_id' OR column_name LIKE '%\_tenant\_id' ESCAPE '\') AND NOT(table_name='tenants' AND column_name='parent_tenant_id');
   IF cond IS NOT NULL AND r.relation<>'profiles' THEN
     EXECUTE format('SELECT count(*) FROM public.%I t WHERE t.ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) AND (%s)',r.relation,cond) INTO invalid USING r.tids,_ids;
     IF invalid>0 THEN blockers:=blockers||jsonb_build_array(format('%s has cross-account dependencies. Preserve the surviving account; resolve its relationship first.',r.relation)); END IF;
   END IF;
   EXECUTE format('SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)),'''')) FROM public.%I t WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1))',r.relation) INTO hash USING r.tids;
   -- File references are obligations even when their storage path is not tenant-prefixed.
   -- Only counts leave this helper; file URLs/keys and attachment payloads never do.
   EXECUTE format('SELECT count(*) FROM public.%I t WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) AND (nullif(to_jsonb(t)->>''storage_path'','''') IS NOT NULL OR nullif(to_jsonb(t)->>''file_path'','''') IS NOT NULL OR nullif(to_jsonb(t)->>''storage_key'','''') IS NOT NULL OR nullif(to_jsonb(t)->>''file_url'','''') IS NOT NULL OR coalesce(to_jsonb(t)->''attachments'',''null''::jsonb) NOT IN (''null''::jsonb,''[]''::jsonb,''{}''::jsonb))',r.relation) INTO invalid USING r.tids;
   IF invalid>0 THEN blockers:=blockers||jsonb_build_array(format('%s: %s file-bearing records require canonical object cleanup and absence verification before deletion.',r.relation,invalid)); END IF;
   IF r.relation='tenant_knowledge_docs' THEN
    EXECUTE 'SELECT count(*) FROM public.tenant_knowledge_docs t WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) AND (to_jsonb(t)->>''promoted_to_canon_id'' IS NOT NULL OR coalesce(to_jsonb(t)->>''share_to_network'',''false'')=''true'')' INTO invalid USING r.tids;
    IF invalid>0 THEN blockers:=blockers||jsonb_build_array('Network-shared Knowledge requires the canonical shared-record disposition before deletion.'); END IF;
   END IF;
   entry:=jsonb_build_object('tids',r.tids,'count',n,'hash',hash,'disposition',public.operator_retirement_disposition(r.relation));
   plan:=jsonb_set(plan,ARRAY[r.relation],entry);
   IF entry->>'disposition'='blocked' THEN blockers:=blockers||jsonb_build_array(format('%s: %s records require supported provider, file, financial, legal or security disposition.',r.relation,n)); END IF;
 END LOOP;
 RETURN jsonb_build_object('tables',plan,'blockers',blockers);
END $$;

-- Preflight must not promise READY for an unsupported FK cycle. Constraints stay enabled.
CREATE OR REPLACE FUNCTION public.operator_retirement_order_blocked(_tables jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pending jsonb:=_tables-'profiles'-'paige_audit_log'; item record; fk record; linked boolean; progressed boolean;
BEGIN
 LOOP
  EXIT WHEN pending='{}'::jsonb;
  progressed:=false;
  FOR item IN SELECT key,value FROM jsonb_each(pending) LOOP
   linked:=false;
   FOR fk IN SELECT k.oid,c.relname child FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE k.contype='f' AND k.confrelid=to_regclass(format('public.%I',item.key)) AND k.conrelid<>k.confrelid AND n.nspname='public' AND pending ? c.relname LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I c JOIN public.%I p ON %s WHERE c.ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) AND p.ctid::text IN (SELECT value FROM jsonb_array_elements_text($2)))',fk.child,item.key,public.operator_retirement_fk_join(fk.oid)) INTO linked USING pending->fk.child->'tids',item.value->'tids';
    EXIT WHEN linked;
   END LOOP;
   IF NOT linked THEN pending:=pending-item.key; progressed:=true; END IF;
  END LOOP;
  IF NOT progressed THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.operator_preview_account_deletion(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tenants; r public.operator_account_archives; p jsonb; summary jsonb; accounts jsonb; blockers jsonb:='[]'; version text; storage_count bigint:=0; members bigint; shared bigint;
BEGIN
 IF NOT public.operator_can_retire_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.tenants WHERE id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO r FROM public.operator_account_archives WHERE id=t.archive_operation_id AND root_tenant_id=t.id AND state='archived';
 IF NOT FOUND THEN RETURN jsonb_build_object('tenant_id',t.id,'accounts',jsonb_build_array(jsonb_build_object('id',t.id,'name',t.name,'account_type',t.account_type,'status',t.status,'parent_tenant_id',t.parent_tenant_id)),'blockers',jsonb_build_array('Archive this account and its children before permanent deletion.'),'version',md5(to_jsonb(t)::text),'dependencies','[]'::jsonb,'execution_available',false); END IF;
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
  'memberships',members,'shared_identities',shared,
  'preserved',jsonb_build_array('Shared Auth identities and survivor memberships','Necessary platform audit evidence and scheduled backups under existing retention policies'),
  'blockers',blockers,'execution_available',jsonb_array_length(blockers)=0);
END $$;

CREATE OR REPLACE FUNCTION public.operator_delete_archived_account(_tenant_id uuid,_expected_version text,_confirmation_name text,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tenants; p jsonb; plan jsonb; r public.operator_account_archives; item record; fk record; exists_ref boolean; progressed boolean; remaining int; target text;
BEGIN
 IF NOT public.operator_can_retire_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
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
 plan:=(public.operator_account_deletion_plan(r.scope_ids))->'tables';
 UPDATE public.operator_account_archives SET state='deleting' WHERE id=r.id;
 -- Preserve shared identities; clear only their pointer into the deleted scope.
 UPDATE public.profiles SET active_tenant_id=NULL WHERE active_tenant_id=ANY(r.scope_ids);
 plan:=plan-'profiles';
 IF plan ? 'paige_audit_log' THEN
   UPDATE public.paige_audit_log SET operator_rows_server_only=true,tenant_id=NULL WHERE tenant_id=ANY(r.scope_ids);
   plan:=plan-'paige_audit_log';
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
 UPDATE public.operator_account_archives SET state='deleted',deleted_at=now(),prior_tenants='[]',prior_members='[]' WHERE id=r.id;
 INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(auth.uid(),'tenant.permanent_delete','tenant',_tenant_id,jsonb_build_object('operation_id',r.id,'account_count',cardinality(r.scope_ids),'preflight_version',_expected_version));
 RETURN public.operator_read_archive_receipt(_tenant_id,_operation_id);
END $$;

REVOKE ALL ON FUNCTION public.guard_operator_account_archive(),public.guard_archived_tenant_membership(),public.guard_archived_tenant_entry(),public.guard_archived_tenant_work(),public.operator_lock_retirement_scope(),public.operator_retirement_disposition(text),public.operator_retirement_fk_join(oid),public.operator_account_deletion_plan(uuid[]),public.operator_retirement_order_blocked(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.operator_can_retire_accounts(),public.operator_read_archive_receipt(uuid,uuid),public.operator_preview_account_archive(uuid),public.operator_archive_account(uuid,text,text,uuid),public.operator_restore_archived_account(uuid,uuid),public.operator_delete_archived_account(uuid,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_can_retire_accounts(),public.operator_read_archive_receipt(uuid,uuid),public.operator_preview_account_archive(uuid),public.operator_archive_account(uuid,text,text,uuid),public.operator_restore_archived_account(uuid,uuid),public.operator_delete_archived_account(uuid,text,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.operator_preview_account_deletion(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operator_preview_account_deletion(uuid) TO authenticated;
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
  IF NOT public.operator_can_retire_accounts() THEN
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
create or replace function public.comms_provider_execution_allowed(
  _tenant_id uuid default null, _actor_user_id uuid default null, _recipient_email text default null
) returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare subject_id uuid; owner_id uuid; restricted boolean; recipient_id uuid;
begin
  if _tenant_id is null and _actor_user_id is null and _recipient_email is null then return false; end if;
  if _recipient_email is not null and (_recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then return false; end if;
  if _tenant_id is not null then
    select owner_user_id, comms_provider_execution_disabled into owner_id, restricted
      from public.tenants where id = _tenant_id AND archived_at IS NULL AND NOT lifecycle_execution_paused;
    if not found or restricted then return false; end if;
  end if;
  if _actor_user_id is not null and not exists(select 1 from auth.users where id = _actor_user_id) then return false; end if;
  if _recipient_email is not null then
    select id into recipient_id from auth.users where lower(email) = lower(_recipient_email);
  end if;
  foreach subject_id in array array[owner_id, _actor_user_id, recipient_id] loop
    if subject_id is null then continue; end if;
    if exists(select 1 from auth.users where id = subject_id
      and raw_app_meta_data->>'comms_provider_execution' = 'disabled') then return false; end if;
    if exists(select 1 from public.tenants t where t.comms_provider_execution_disabled
      and (t.owner_user_id = subject_id or exists(select 1 from public.tenant_members m
        where m.tenant_id = t.id and m.user_id = subject_id and m.status = 'active'))) then return false; end if;
  end loop;
  -- An unmatched recipient is legitimate for existing platform invite delivery.
  return true;
end $$;

CREATE OR REPLACE FUNCTION public.operator_read_account_details(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.tenants;
BEGIN
 IF NOT public.operator_can_retire_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.tenants WHERE id=_tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'account_type',t.account_type,'parent_tenant_id',t.parent_tenant_id,
 'version',md5(to_jsonb(t)::text),'archived_at',t.archived_at,'archive_operation_id',t.archive_operation_id,
 'archive_root_tenant_id',(SELECT root_tenant_id FROM public.operator_account_archives WHERE id=t.archive_operation_id),'execution_paused',t.lifecycle_execution_paused);
END $$;
REVOKE ALL ON FUNCTION public.operator_read_account_details(uuid),public.operator_set_tenant_status(uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.operator_read_account_details(uuid),public.operator_set_tenant_status(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.comms_provider_execution_allowed(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.comms_provider_execution_allowed(uuid,uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.operator_edit_account_details(
  _tenant_id uuid, _name text, _status text, _expected_version text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tenants; before_value jsonb;
BEGIN
  IF NOT public.operator_can_retire_accounts() THEN
    RAISE EXCEPTION 'platform owner only' USING ERRCODE = '42501';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) NOT BETWEEN 1 AND 200 OR _status IS NULL
    OR _status NOT IN ('trial','active','past_due','suspended','canceled') THEN
    RAISE EXCEPTION 'valid account name and status required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.tenants WHERE id = _tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE = 'P0002'; END IF;
  IF _expected_version IS NULL OR md5(to_jsonb(t)::text) <> _expected_version THEN
    RAISE EXCEPTION 'account changed; reload before editing' USING ERRCODE = '40001';
  END IF;
  -- The existing internal classification is server-owned, never inferred from a name.
  IF EXISTS (SELECT 1 FROM public.tenant_revenue_classification WHERE tenant_id=t.id AND revenue_class='internal_test') THEN
    RAISE EXCEPTION 'internal account edits require the existing administrative procedure' USING ERRCODE = '42501';
  END IF;
  before_value := jsonb_build_object('name',t.name,'status',t.status);
  UPDATE public.tenants SET name=btrim(_name) WHERE id=t.id;
  -- Reuse canonical lifecycle transition and its transactional audit.
  IF t.status::text <> _status THEN
    PERFORM public.operator_set_tenant_status(t.id,_status,'Fleet account details');
  END IF;
  INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data)
    VALUES(auth.uid(),'tenant.details_edit','tenant',t.id,
      jsonb_build_object('before',before_value,'after',jsonb_build_object('name',btrim(_name),'status',_status)));
  RETURN public.operator_read_account_details(t.id);
END $$;



-- Preserve the canonical claim contract; paused rows must not abort a mixed-tenant batch.
CREATE OR REPLACE FUNCTION public.claim_filed_actions(p_limit int DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _n int := GREATEST(LEAST(COALESCE(p_limit, 25), 100), 1);
  _claimed jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_FORBIDDEN: service role only' USING ERRCODE = '42501';
  END IF;

  -- Self-heal: a row stuck 'drafting' with no draft after 10 min is a crashed prior run — reopen it.
  UPDATE public.paige_actions
     SET status = 'filed'
   WHERE status = 'drafting'
     AND draft_content IS NULL
     AND assigned_at IS NOT NULL
     AND assigned_at < now() - interval '10 minutes'
     AND EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=paige_actions.tenant_id AND t.archived_at IS NULL AND NOT t.lifecycle_execution_paused);

  WITH picked AS (
    SELECT a.id
    FROM public.paige_actions a
    JOIN public.paige_action_kinds k ON k.slug = a.action_kind
    WHERE a.status = 'filed'
      AND EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=a.tenant_id AND t.archived_at IS NULL AND NOT t.lifecycle_execution_paused)
      AND k.enabled
      AND k.draft_subagent_slug IS NOT NULL
      AND a.autonomy_lane IS DISTINCT FROM 'off'   -- §16: never draft a human-only action
    ORDER BY
      CASE a.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
      a.filed_at ASC
    LIMIT _n
    FOR UPDATE OF a SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.paige_actions a
       SET status = 'drafting',
           assigned_at = now(),
           assigned_subagent_slug = COALESCE(a.assigned_subagent_slug, k.draft_subagent_slug)
      FROM public.paige_action_kinds k
     WHERE a.id IN (SELECT id FROM picked)
       AND k.slug = a.action_kind
    RETURNING a.id, a.tenant_id, a.action_kind, a.contact_id, a.conversation_id,
              a.title, a.summary, a.payload, k.draft_subagent_slug
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', id, 'tenant_id', tenant_id, 'action_kind', action_kind,
           'contact_id', contact_id, 'conversation_id', conversation_id,
           'title', title, 'summary', summary, 'payload', payload,
           'draft_subagent_slug', draft_subagent_slug
         )), '[]'::jsonb)
  INTO _claimed
  FROM claimed;

  RETURN jsonb_build_object('ok', true, 'claimed', _claimed);
END $$;
REVOKE ALL ON FUNCTION public.claim_filed_actions(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_filed_actions(integer) TO service_role;
