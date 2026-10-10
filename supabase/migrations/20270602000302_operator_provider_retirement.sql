-- CLI-created forward repair of PR #1892's blocked provider dependencies.
-- Reuse the canonical archive operation journal; provider resources are not a tenant registry.
ALTER TABLE public.operator_account_archives DROP CONSTRAINT IF EXISTS operator_account_archives_state_check;
ALTER TABLE public.operator_account_archives ADD CONSTRAINT operator_account_archives_state_check
 CHECK(state IN ('preparing','archived','restoring','restored','deleting','deleted','resources_preparing','resources_ready','resources_unknown','resources_failed'));
ALTER TABLE public.operator_account_archives
 ADD COLUMN IF NOT EXISTS resource_mode text CHECK(resource_mode IN ('archive','delete')),
 ADD COLUMN IF NOT EXISTS resource_plan jsonb NOT NULL DEFAULT '[]',
 ADD COLUMN IF NOT EXISTS resource_results jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS resource_claim uuid,
 ADD COLUMN IF NOT EXISTS resource_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.operator_resource_fingerprint(_provider text,_tenant_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE value text;
BEGIN
 IF _provider='twilio' THEN SELECT md5(to_jsonb(t)::text) INTO value FROM public.tenant_twilio_subaccounts t WHERE tenant_id=_tenant_id;
 ELSIF _provider='n8n' THEN SELECT md5(jsonb_build_object('connection',to_jsonb(t),'projection',(SELECT jsonb_agg(to_jsonb(m) ORDER BY connection_id) FROM public.mcp_connections m WHERE m.tenant_id=_tenant_id AND m.legacy_source='tenant_n8n_connections'))::text) INTO value FROM public.tenant_n8n_connections t WHERE tenant_id=_tenant_id;
 ELSE RAISE EXCEPTION 'unsupported retirement provider' USING ERRCODE='22023'; END IF;
 RETURN value;
END $$;

CREATE OR REPLACE FUNCTION public.operator_resource_ready(_provider text,_tenant_id uuid,_mode text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.operator_account_archives r,
 jsonb_each(r.resource_results) result WHERE r.state='resources_ready' AND _tenant_id=ANY(r.scope_ids)
 AND result.value->>'provider'=_provider AND result.value->>'tenant_id'=_tenant_id::text
 AND result.value->>'fingerprint'=public.operator_resource_fingerprint(_provider,_tenant_id)
 AND CASE WHEN _provider='twilio' THEN result.value->>'provider_status'=ANY(CASE WHEN _mode='delete' THEN ARRAY['closed'] ELSE ARRAY['suspended','closed'] END)
 ELSE result.value->>'provider_status'='disconnected' AND (result.value->>'external_retention')::boolean END)
$$;

CREATE OR REPLACE FUNCTION public.operator_preview_retirement_resources(_tenant_id uuid,_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p jsonb; ids uuid[]; blockers jsonb:='[]'; resources jsonb:='[]'; item record; version text; n bigint;
BEGIN
 IF NOT public.operator_can_retire_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 IF _mode NOT IN ('archive','delete') THEN RAISE EXCEPTION 'invalid resource action' USING ERRCODE='22023'; END IF;
 p:=CASE WHEN _mode='archive' THEN public.operator_preview_account_archive(_tenant_id) ELSE public.operator_preview_account_deletion(_tenant_id) END;
 SELECT array_agg((a->>'id')::uuid) INTO ids FROM jsonb_array_elements(p->'accounts') a;
 SELECT coalesce(jsonb_agg(b),'[]') INTO blockers FROM jsonb_array_elements_text(p->'blockers') b
 WHERE b NOT LIKE 'tenant_twilio_subaccounts:%' AND b NOT LIKE 'tenant_n8n_connections:%' AND b NOT LIKE 'tenant_phone_numbers:%';
 FOR item IN SELECT t.* FROM public.tenant_twilio_subaccounts t WHERE tenant_id=ANY(ids) ORDER BY tenant_id LOOP
  IF EXISTS(SELECT 1 FROM public.tenant_twilio_subaccounts other WHERE other.twilio_subaccount_sid=item.twilio_subaccount_sid AND other.tenant_id<>item.tenant_id) THEN
   blockers:=blockers||jsonb_build_array('Twilio identity is shared or ambiguously mapped; resolve its canonical ownership before retirement.');
  END IF;
  resources:=resources||jsonb_build_array(jsonb_build_object('provider','twilio','tenant_id',item.tenant_id,'action',CASE WHEN _mode='archive' THEN 'suspend' ELSE 'close' END));
 END LOOP;
 FOR item IN SELECT tenant_id FROM public.tenant_n8n_connections WHERE tenant_id=ANY(ids) ORDER BY tenant_id LOOP
  resources:=resources||jsonb_build_array(jsonb_build_object('provider','n8n','tenant_id',item.tenant_id,'action','disconnect','external_retention',true));
 END LOOP;
 IF jsonb_array_length(resources)>50 THEN blockers:=blockers||jsonb_build_array('Provider preparation exceeds the supported bounded scope.'); END IF;
 -- Bind the review to current account state and every resource row without exposing credentials.
 SELECT md5(coalesce(p->>'version','')||_mode||resources::text||coalesce(string_agg(public.operator_resource_fingerprint(provider,tenant_id),'' ORDER BY provider,tenant_id),'')) INTO version
 FROM jsonb_to_recordset(resources) AS x(provider text,tenant_id uuid);
 RETURN jsonb_build_object('tenant_id',_tenant_id,'mode',_mode,'version',version,'accounts',p->'accounts','resources',resources,'blockers',blockers,
 'execution_available',jsonb_array_length(blockers)=0 AND jsonb_array_length(resources)>0);
END $$;

CREATE OR REPLACE FUNCTION public.operator_begin_retirement_resources(_tenant_id uuid,_mode text,_expected_version text,_confirmation_name text,_operation_id uuid,_retain_external_n8n boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p jsonb; ids uuid[]; plan jsonb:='[]'; item record; existing public.operator_account_archives; name text;
BEGIN
 IF NOT public.operator_can_retire_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
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
 IF EXISTS(SELECT 1 FROM public.operator_account_archives r WHERE r.resource_mode IS NOT NULL AND r.state IN ('resources_preparing','resources_unknown') AND r.scope_ids&&ids) THEN RAISE EXCEPTION 'read the existing resource operation before another preparation' USING ERRCODE='55000'; END IF;
 FOR item IN SELECT t.tenant_id,t.twilio_subaccount_sid FROM public.tenant_twilio_subaccounts t WHERE t.tenant_id=ANY(ids) ORDER BY t.tenant_id LOOP
  plan:=plan||jsonb_build_array(jsonb_build_object('key','twilio:'||item.tenant_id,'provider','twilio','tenant_id',item.tenant_id,'sid',item.twilio_subaccount_sid,'fingerprint',public.operator_resource_fingerprint('twilio',item.tenant_id)));
 END LOOP;
 FOR item IN SELECT tenant_id FROM public.tenant_n8n_connections WHERE tenant_id=ANY(ids) ORDER BY tenant_id LOOP
  plan:=plan||jsonb_build_array(jsonb_build_object('key','n8n:'||item.tenant_id,'provider','n8n','tenant_id',item.tenant_id,'external_retention',true,'fingerprint',public.operator_resource_fingerprint('n8n',item.tenant_id)));
 END LOOP;
 INSERT INTO public.operator_account_archives(id,root_tenant_id,actor_user_id,root_name,state,scope_ids,prior_tenants,prior_members,resource_mode,resource_plan)
 VALUES(_operation_id,_tenant_id,auth.uid(),name,'resources_preparing',ids,(SELECT jsonb_agg(to_jsonb(t)) FROM public.tenants t WHERE id=ANY(ids)),'[]',_mode,plan);
 UPDATE public.tenants SET lifecycle_execution_paused=true WHERE id=ANY(ids);
 INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(auth.uid(),'tenant.resources_prepare','tenant',_tenant_id,jsonb_build_object('operation_id',_operation_id,'mode',_mode,'account_count',cardinality(ids),'external_n8n_retained',_retain_external_n8n));
 RETURN public.operator_read_retirement_resources(_tenant_id,_operation_id);
END $$;

CREATE OR REPLACE FUNCTION public.operator_read_retirement_resources(_tenant_id uuid,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives; summary jsonb;
BEGIN
 IF NOT public.operator_can_retire_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.operator_account_archives WHERE (_operation_id IS NULL OR id=_operation_id) AND root_tenant_id=_tenant_id AND resource_mode IS NOT NULL
 AND actor_user_id=auth.uid() ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'resource operation not found' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('provider',value->>'provider','state',value->>'state','provider_status',value->>'provider_status','reason',value->>'reason')),'[]') INTO summary FROM jsonb_each(r.resource_results);
 RETURN jsonb_build_object('tenant_id',r.root_tenant_id,'operation_id',r.id,'mode',r.resource_mode,'state',r.state,'account_count',cardinality(r.scope_ids),'results',summary);
END $$;

-- Service-only claims bind the verified caller, exact database plan, and one claim token.
CREATE OR REPLACE FUNCTION public.operator_claim_retirement_resources(_tenant_id uuid,_operation_id uuid,_actor uuid,_claim uuid,_read_only boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives; item jsonb;
BEGIN
 SELECT * INTO r FROM public.operator_account_archives WHERE id=_operation_id AND root_tenant_id=_tenant_id AND resource_mode IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR r.actor_user_id<>_actor OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role IN ('super_admin','platform_admin')) THEN RAISE EXCEPTION 'resource caller refused' USING ERRCODE='42501'; END IF;
 IF r.state='resources_ready' THEN RETURN jsonb_build_object('complete',true); END IF;
 IF _claim IS NULL THEN RAISE EXCEPTION 'claim required' USING ERRCODE='22023'; END IF;
 IF r.resource_started_at>clock_timestamp()-interval '10 minutes' THEN RAISE EXCEPTION 'resource operation is processing; read later' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=r.root_tenant_id AND name=r.root_name)
 OR (SELECT count(*) FROM public.tenants WHERE id=ANY(r.scope_ids))<>cardinality(r.scope_ids)
 OR EXISTS(SELECT 1 FROM public.tenants WHERE parent_tenant_id=ANY(r.scope_ids) AND NOT(id=ANY(r.scope_ids)))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.prior_tenants) p JOIN public.tenants t ON t.id=(p->>'id')::uuid
 WHERE (to_jsonb(t)-'lifecycle_execution_paused'-'updated_at') IS DISTINCT FROM (p-'lifecycle_execution_paused'-'updated_at')) THEN RAISE EXCEPTION 'account scope changed; reconcile before provider retirement' USING ERRCODE='40001'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(r.resource_plan) LOOP
  IF NOT(r.resource_results ? (item->>'key')) AND item->>'fingerprint' IS DISTINCT FROM public.operator_resource_fingerprint(item->>'provider',(item->>'tenant_id')::uuid) THEN RAISE EXCEPTION 'resource binding changed; reconcile exact provider identity' USING ERRCODE='40001'; END IF;
 END LOOP;
 UPDATE public.operator_account_archives SET resource_claim=_claim,resource_started_at=clock_timestamp() WHERE id=r.id;
 RETURN jsonb_build_object('complete',false,'mode',r.resource_mode,'resources',r.resource_plan,'results',r.resource_results);
END $$;

CREATE OR REPLACE FUNCTION public.operator_finish_retirement_resource(_tenant_id uuid,_operation_id uuid,_actor uuid,_claim uuid,_key text,_state text,_provider_status text,_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives; item jsonb; t uuid; result jsonb; reference text; shared boolean; rel record; count_refs bigint;
BEGIN
 PERFORM public.operator_lock_retirement_scope();
 SELECT * INTO r FROM public.operator_account_archives WHERE id=_operation_id AND root_tenant_id=_tenant_id FOR UPDATE;
 IF NOT FOUND OR r.actor_user_id<>_actor OR r.resource_claim IS DISTINCT FROM _claim OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role IN ('super_admin','platform_admin')) THEN RAISE EXCEPTION 'resource claim refused' USING ERRCODE='42501'; END IF;
 SELECT value INTO item FROM jsonb_array_elements(r.resource_plan) WHERE value->>'key'=_key;
 IF item IS NULL OR _state NOT IN ('verified','blocked','unknown') THEN RAISE EXCEPTION 'invalid resource result' USING ERRCODE='22023'; END IF;
 t:=(item->>'tenant_id')::uuid;
 IF NOT(r.resource_results ? _key) AND item->>'fingerprint' IS DISTINCT FROM public.operator_resource_fingerprint(item->>'provider',t) THEN RAISE EXCEPTION 'resource binding changed' USING ERRCODE='40001'; END IF;
 IF _state='verified' THEN
  PERFORM set_config('paige.operator_retirement_claim',_claim::text,true);
  IF item->>'provider'='twilio' THEN
   IF NOT(_provider_status=ANY(CASE WHEN r.resource_mode='delete' THEN ARRAY['closed'] ELSE ARRAY['suspended','closed'] END)) THEN RAISE EXCEPTION 'provider state not retired' USING ERRCODE='55000'; END IF;
   IF EXISTS(SELECT 1 FROM public.tenant_twilio_subaccounts other WHERE other.twilio_subaccount_sid=item->>'sid' AND other.tenant_id<>t) THEN RAISE EXCEPTION 'provider identity has another tenant binding' USING ERRCODE='55000'; END IF;
   UPDATE public.tenant_twilio_subaccounts SET status=_provider_status,active=false WHERE tenant_id=t AND twilio_subaccount_sid=item->>'sid';
   IF NOT FOUND THEN RAISE EXCEPTION 'resource identity changed' USING ERRCODE='40001'; END IF;
   IF r.resource_mode='delete' THEN
    SELECT auth_token_vault_ref INTO reference FROM public.tenant_twilio_subaccounts WHERE tenant_id=t;
    IF reference IS NOT NULL THEN
     shared:=false;
     FOR rel IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND data_type='text' AND (column_name LIKE '%vault%ref%' OR column_name='auth_token_vault_ref') LOOP
      EXECUTE format('SELECT count(*) FROM public.%I WHERE %I=$1 %s',rel.table_name,rel.column_name,CASE WHEN rel.table_name='tenant_twilio_subaccounts' THEN 'AND tenant_id<>$2' ELSE '' END) INTO count_refs USING reference,t;
      IF count_refs>0 THEN shared:=true; END IF;
     END LOOP;
     IF NOT shared THEN
      IF reference<>'twilio_subaccount_api_key_secret:'||t::text THEN RAISE EXCEPTION 'legacy credential requires its canonical Vault disposition' USING ERRCODE='55000'; END IF;
      DELETE FROM vault.secrets WHERE name=reference;
     END IF;
    END IF;
    UPDATE public.tenant_twilio_subaccounts SET auth_token_vault_ref=NULL,api_key_sid=NULL,inbound_webhook_secret=NULL,twiml_app_sid=NULL WHERE tenant_id=t;
   END IF;
  ELSIF item->>'provider'='n8n' THEN
   IF _provider_status<>'disconnected' THEN RAISE EXCEPTION 'n8n disposition unverified' USING ERRCODE='55000'; END IF;
   -- Exact equivalent of the existing encrypted-credential clear operation, scoped to the
   -- protected operator plan instead of entering/impersonating the tenant owner.
   PERFORM public.clear_tenant_n8n_connection(t);
   UPDATE public.tenant_n8n_connections SET updated_by=_actor WHERE tenant_id=t;
   -- This read-only projection cannot be disconnected through the native MCP tenant
   -- writer. Retire its exact legacy source on the same protected lifecycle claim.
   DELETE FROM public.mcp_connection_approvals WHERE connection_id IN (SELECT connection_id FROM public.mcp_connections WHERE tenant_id=t AND legacy_source='tenant_n8n_connections');
   DELETE FROM public.mcp_connection_tools WHERE connection_id IN (SELECT connection_id FROM public.mcp_connections WHERE tenant_id=t AND legacy_source='tenant_n8n_connections');
   UPDATE public.mcp_connections SET enabled=false,server_url_ct=NULL,auth_token_ct=NULL,auth_token_last4=NULL,refresh_token_ct=NULL,oauth_client_secret_ct=NULL,
    inbound_contact_secret_hash=NULL,inbound_contact_actor=NULL,granted_scopes='{}',provider_state='{}',status='unconfigured',health='unknown',last_error_code=NULL,last_checked_at=NULL,updated_by=_actor,updated_at=now()
   WHERE tenant_id=t AND legacy_source='tenant_n8n_connections' AND provider_key='n8n';
  END IF;
 END IF;
 result:=jsonb_build_object('provider',item->>'provider','tenant_id',t,'state',_state,'provider_status',_provider_status,'reason',CASE WHEN _reason~'^[a-z0-9_]{1,100}$' THEN _reason ELSE NULL END,'external_retention',item->'external_retention','fingerprint',public.operator_resource_fingerprint(item->>'provider',t));
 UPDATE public.operator_account_archives SET resource_results=jsonb_set(resource_results,ARRAY[_key],result) WHERE id=r.id;
END $$;

CREATE OR REPLACE FUNCTION public.operator_complete_retirement_resources(_tenant_id uuid,_operation_id uuid,_actor uuid,_claim uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives; outcome text;
BEGIN
 SELECT * INTO r FROM public.operator_account_archives WHERE id=_operation_id AND root_tenant_id=_tenant_id FOR UPDATE;
 IF NOT FOUND OR r.actor_user_id<>_actor OR r.resource_claim IS DISTINCT FROM _claim OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role IN ('super_admin','platform_admin')) THEN RAISE EXCEPTION 'resource claim refused' USING ERRCODE='42501'; END IF;
 outcome:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_each(r.resource_results) WHERE value->>'state'<>'verified' OR value->>'fingerprint' IS DISTINCT FROM public.operator_resource_fingerprint(value->>'provider',(value->>'tenant_id')::uuid)) THEN 'resources_unknown'
 WHEN (SELECT count(*) FROM jsonb_each(r.resource_results))=jsonb_array_length(r.resource_plan) THEN 'resources_ready' ELSE 'resources_preparing' END;
 UPDATE public.operator_account_archives SET state=outcome,resource_started_at=NULL WHERE id=r.id;
 INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(_actor,'tenant.resources_readback','tenant',_tenant_id,jsonb_build_object('operation_id',r.id,'state',outcome,'mode',r.resource_mode));
END $$;

-- Freeze provider bindings during preparation/reconciliation. Only the claimed private
-- finalizer may change them; reconnecting after completion invalidates its fingerprint.
CREATE OR REPLACE FUNCTION public.guard_operator_retirement_resource()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives; ids uuid[];
BEGIN
 ids:=ARRAY[(to_jsonb(OLD)->>'tenant_id')::uuid,(to_jsonb(NEW)->>'tenant_id')::uuid];
 FOR r IN SELECT * FROM public.operator_account_archives WHERE resource_mode IS NOT NULL AND state IN ('resources_preparing','resources_unknown') AND scope_ids&&ids LOOP
  IF r.resource_claim IS NULL OR nullif(current_setting('paige.operator_retirement_claim',true),'') IS DISTINCT FROM r.resource_claim::text THEN RAISE EXCEPTION 'provider resource belongs to a pending retirement; reconcile that operation first' USING ERRCODE='55000'; END IF;
 END LOOP;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS a01_operator_retirement_resource ON public.tenant_twilio_subaccounts;
CREATE TRIGGER a01_operator_retirement_resource BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_twilio_subaccounts FOR EACH ROW EXECUTE FUNCTION public.guard_operator_retirement_resource();
DROP TRIGGER IF EXISTS a01_operator_retirement_resource ON public.tenant_n8n_connections;
CREATE TRIGGER a01_operator_retirement_resource BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_n8n_connections FOR EACH ROW EXECUTE FUNCTION public.guard_operator_retirement_resource();
DROP TRIGGER IF EXISTS a01_operator_retirement_resource ON public.mcp_connections;
CREATE TRIGGER a01_operator_retirement_resource BEFORE INSERT OR UPDATE OR DELETE ON public.mcp_connections FOR EACH ROW EXECUTE FUNCTION public.guard_operator_retirement_resource();
REVOKE ALL ON FUNCTION public.guard_operator_retirement_resource() FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION public.operator_resource_fingerprint(text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.operator_resource_ready(text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.operator_preview_retirement_resources(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_preview_retirement_resources(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.operator_begin_retirement_resources(uuid,text,text,text,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_begin_retirement_resources(uuid,text,text,text,uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.operator_read_retirement_resources(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_read_retirement_resources(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.operator_claim_retirement_resources(uuid,uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_claim_retirement_resources(uuid,uuid,uuid,uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.operator_finish_retirement_resource(uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_finish_retirement_resource(uuid,uuid,uuid,uuid,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.operator_complete_retirement_resources(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_complete_retirement_resources(uuid,uuid,uuid,uuid) TO service_role;

-- A current protected claim is checked again immediately before each external mutation.
CREATE OR REPLACE FUNCTION public.operator_assert_retirement_resource(_tenant_id uuid,_operation_id uuid,_actor uuid,_claim uuid,_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives; item jsonb;
BEGIN
 SELECT * INTO r FROM public.operator_account_archives WHERE id=_operation_id AND root_tenant_id=_tenant_id;
 IF NOT FOUND OR r.actor_user_id<>_actor OR r.resource_claim IS DISTINCT FROM _claim OR r.state NOT IN ('resources_preparing','resources_unknown')
 OR r.resource_started_at IS NULL OR r.resource_started_at<clock_timestamp()-interval '10 minutes'
 OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_actor AND role IN ('super_admin','platform_admin')) THEN RETURN false; END IF;
 SELECT value INTO item FROM jsonb_array_elements(r.resource_plan) WHERE value->>'key'=_key;
 IF item IS NULL THEN RETURN false; END IF;
 RETURN NOT EXISTS(SELECT 1 FROM public.tenants WHERE parent_tenant_id=ANY(r.scope_ids) AND NOT(id=ANY(r.scope_ids)))
 AND (SELECT count(*) FROM public.tenants WHERE id=ANY(r.scope_ids) AND lifecycle_execution_paused)=cardinality(r.scope_ids)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.prior_tenants) p JOIN public.tenants t ON t.id=(p->>'id')::uuid
 WHERE (to_jsonb(t)-'lifecycle_execution_paused'-'updated_at') IS DISTINCT FROM (p-'lifecycle_execution_paused'-'updated_at'))
 AND public.operator_resource_fingerprint(item->>'provider',(item->>'tenant_id')::uuid)=coalesce(r.resource_results->(_key)->>'fingerprint',item->>'fingerprint');
END $$;
REVOKE ALL ON FUNCTION public.operator_assert_retirement_resource(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_assert_retirement_resource(uuid,uuid,uuid,uuid,text) TO service_role;

-- Canonical contracts updated narrowly; all other obligations remain unchanged.
-- Keep necessary financial/provider accounting in its canonical tables, outside active
-- tenancy. No shadow archive, invoice rewrite, cost reset, or provider termination.
DO $$DECLARE rel text; BEGIN
 FOREACH rel IN ARRAY ARRAY['platform_subscriptions','platform_usage_events','paige_llm_trace'] LOOP
  EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS operator_rows_server_only boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS retired_tenant_id uuid',rel);
  EXECUTE format('DROP POLICY IF EXISTS operator_retired_record_read_guard ON public.%I',rel);
  EXECUTE format('CREATE POLICY operator_retired_record_read_guard ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(NOT operator_rows_server_only OR public.is_platform_admin()) WITH CHECK(NOT operator_rows_server_only OR public.is_platform_admin())',rel);
 END LOOP;
 FOREACH rel IN ARRAY ARRAY['platform_subscriptions','platform_usage_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN tenant_id DROP NOT NULL',rel);
  EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS operator_retired_tenant_binding',rel);
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT operator_retired_tenant_binding CHECK(tenant_id IS NOT NULL OR (operator_rows_server_only AND retired_tenant_id IS NOT NULL))',rel);
 END LOOP;
END $$;
ALTER TABLE public.paige_llm_trace ADD COLUMN IF NOT EXISTS retired_working_context_tenant_id uuid;

CREATE OR REPLACE FUNCTION public.guard_operator_retained_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE before jsonb:=to_jsonb(OLD); after jsonb:=to_jsonb(NEW); own uuid; working uuid;
BEGIN
 IF TG_OP='INSERT' THEN
  IF coalesce((after->>'operator_rows_server_only')::boolean,false) OR after->>'retired_tenant_id' IS NOT NULL OR after->>'retired_working_context_tenant_id' IS NOT NULL THEN RAISE EXCEPTION 'retention requires canonical account retirement' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF (after->'retired_tenant_id') IS NOT DISTINCT FROM (before->'retired_tenant_id')
 AND (after->'retired_working_context_tenant_id') IS NOT DISTINCT FROM (before->'retired_working_context_tenant_id')
 AND (after->'operator_rows_server_only') IS NOT DISTINCT FROM (before->'operator_rows_server_only') THEN RETURN NEW; END IF;
 own:=(before->>'tenant_id')::uuid;working:=(before->>'working_context_tenant_id')::uuid;
 IF NOT public.operator_can_retire_accounts() OR NOT EXISTS(SELECT 1 FROM public.operator_account_archives r WHERE r.state='deleting'
 AND (own=ANY(r.scope_ids) OR working=ANY(r.scope_ids))
 AND (after->'retired_tenant_id' IS NOT DISTINCT FROM before->'retired_tenant_id' OR (after->>'retired_tenant_id')::uuid=own AND own=ANY(r.scope_ids))
 AND (after->'retired_working_context_tenant_id' IS NOT DISTINCT FROM before->'retired_working_context_tenant_id' OR (after->>'retired_working_context_tenant_id')::uuid=working AND working=ANY(r.scope_ids))) THEN RAISE EXCEPTION 'retention requires canonical account retirement' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_operator_retained_record() FROM PUBLIC,anon,authenticated,service_role;
DO $$DECLARE rel text; BEGIN
 FOREACH rel IN ARRAY ARRAY['platform_subscriptions','platform_usage_events','paige_llm_trace'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS a01_operator_retained_record ON public.%I',rel);
  EXECUTE format('CREATE TRIGGER a01_operator_retained_record BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_operator_retained_record()',rel);
 END LOOP;
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
  IF EXISTS(SELECT 1 FROM public.platform_subscriptions WHERE tenant_id=ANY(ids) AND (stripe_subscription_id IS NOT NULL OR stripe_customer_id IS NOT NULL) AND status NOT IN ('canceled','expired')) THEN blockers:=blockers||jsonb_build_array('Live billing references require authoritative billing retirement before archive.'); END IF;
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
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=ANY($1) %s',rel,CASE WHEN rel IN ('tenant_twilio_subaccounts','tenant_n8n_connections') THEN format('AND NOT public.operator_resource_ready(%L,tenant_id,''archive'')',CASE WHEN rel='tenant_twilio_subaccounts' THEN 'twilio' ELSE 'n8n' END) ELSE '' END) INTO n USING ids;
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
  IF TG_OP='UPDATE' AND NOT OLD.lifecycle_execution_paused AND NEW.lifecycle_execution_paused
   AND (to_jsonb(NEW)-'lifecycle_execution_paused')=(to_jsonb(OLD)-'lifecycle_execution_paused')
   AND EXISTS(SELECT 1 FROM public.operator_account_archives r WHERE r.state='resources_preparing' AND r.actor_user_id=auth.uid() AND NEW.id=ANY(r.scope_ids)) THEN RETURN NEW; END IF;
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
 'tenant_twilio_subaccounts','tenant_n8n_connections','tenant_phone_numbers',
 'email_send_log','mcp_connections','mcp_connection_approvals','mcp_connection_tools',
 'programs','program_phases','program_enrollments','program_phase_item_states','program_messages','program_document_requests','program_approvals'
 ]) THEN 'delete' WHEN _table=ANY(ARRAY['profiles','paige_audit_log','platform_subscriptions','platform_usage_events','paige_llm_trace']) THEN 'preserve' ELSE 'blocked' END
$$;

CREATE OR REPLACE FUNCTION public.operator_account_deletion_plan(_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE plan jsonb:='{}'; blockers jsonb:='[]'; r record; tids jsonb; old jsonb; round int; changed boolean; n bigint; hash text; invalid bigint; cond text; entry jsonb; resource record;
BEGIN
 FOR r IN SELECT c.table_name,string_agg(format('t.%I=ANY($1)',c.column_name),' OR ' ORDER BY c.column_name) predicate
   FROM information_schema.columns c JOIN information_schema.tables b USING(table_schema,table_name)
   WHERE c.table_schema='public' AND b.table_type='BASE TABLE' AND c.udt_name='uuid' AND c.table_name<>'operator_account_archives' AND c.column_name NOT IN ('retired_tenant_id','retired_working_context_tenant_id')
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
 FOR resource IN SELECT tenant_id,'twilio' provider FROM public.tenant_twilio_subaccounts WHERE tenant_id=ANY(_ids)
 UNION ALL SELECT tenant_id,'n8n' FROM public.tenant_n8n_connections WHERE tenant_id=ANY(_ids) LOOP
  IF NOT public.operator_resource_ready(resource.provider,resource.tenant_id,'delete') THEN blockers:=blockers||jsonb_build_array(CASE WHEN resource.provider='twilio' THEN 'tenant_twilio_subaccounts: Verify Twilio closure and credential retirement before deletion.' ELSE 'tenant_n8n_connections: Disconnect the exact n8n connection with explicit external workflow retention before deletion.' END); END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.tenant_phone_numbers p LEFT JOIN public.tenant_twilio_subaccounts t ON t.id=p.subaccount_id
 WHERE p.tenant_id=ANY(_ids) AND (t.id IS NULL OR t.tenant_id<>p.tenant_id OR NOT public.operator_resource_ready('twilio',t.tenant_id,'delete'))) THEN blockers:=blockers||jsonb_build_array('tenant_phone_numbers: Verify exact subaccount ownership and provider closure before removing phone records.'); END IF;
 IF EXISTS(SELECT 1 FROM public.mcp_connections WHERE tenant_id=ANY(_ids) AND (legacy_source IS DISTINCT FROM 'tenant_n8n_connections' OR provider_key<>'n8n')) THEN blockers:=blockers||jsonb_build_array('mcp_connections: An independent connector requires its canonical disconnection and credential disposition.'); END IF;
 IF EXISTS(SELECT 1 FROM public.mcp_connections WHERE tenant_id=ANY(_ids) AND legacy_source='tenant_n8n_connections' AND (enabled OR auth_token_ct IS NOT NULL OR refresh_token_ct IS NOT NULL OR oauth_client_secret_ct IS NOT NULL OR server_url_ct IS NOT NULL OR NOT public.operator_resource_ready('n8n',tenant_id,'delete'))) THEN blockers:=blockers||jsonb_build_array('tenant_n8n_connections: Disconnect the legacy MCP credential projection before deletion.'); END IF;
 IF EXISTS(SELECT 1 FROM public.platform_subscriptions WHERE tenant_id=ANY(_ids) AND (stripe_subscription_id IS NOT NULL OR stripe_customer_id IS NOT NULL)) THEN blockers:=blockers||jsonb_build_array('Live billing references require authoritative billing retirement before account deletion.'); END IF;
 FOR r IN SELECT key relation,value tids FROM jsonb_each(plan) ORDER BY key LOOP
   n:=jsonb_array_length(r.tids);
   IF n>20000 THEN blockers:=blockers||jsonb_build_array(format('%s exceeds the bounded cleanup size; use a reviewed maintenance operation.',r.relation)); END IF;
   -- Every explicit scope field on a selected row must be empty or within the confirmed tree.
   SELECT string_agg(format('(t.%I IS NOT NULL AND NOT(t.%I=ANY($2)))',column_name,column_name),' OR ') INTO cond FROM information_schema.columns
     WHERE table_schema='public' AND table_name=r.relation AND udt_name='uuid' AND (column_name='tenant_id' OR column_name LIKE '%\_tenant\_id' ESCAPE '\') AND NOT(table_name='tenants' AND column_name='parent_tenant_id');
   IF cond IS NOT NULL AND public.operator_retirement_disposition(r.relation)<>'preserve' THEN
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
 -- Retain accounting in its one canonical home; historical amounts and quantities remain.
 FOREACH target IN ARRAY ARRAY['platform_subscriptions','platform_usage_events'] LOOP
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
 UPDATE public.operator_account_archives SET state='deleted',deleted_at=now(),prior_tenants='[]',prior_members='[]' WHERE id=r.id;
 INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(auth.uid(),'tenant.permanent_delete','tenant',_tenant_id,jsonb_build_object('operation_id',r.id,'account_count',cardinality(r.scope_ids),'preflight_version',_expected_version));
 RETURN public.operator_read_archive_receipt(_tenant_id,_operation_id);
END $$;
CREATE OR REPLACE FUNCTION public.operator_commercial_tenant_eligible(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenants t JOIN public.tenant_revenue_classification c ON c.tenant_id=t.id
 WHERE t.id=_tenant_id AND c.revenue_class='real' AND t.archived_at IS NULL
 AND t.status NOT IN ('canceled','suspended') AND coalesce(t.features->>'system_workspace','false')<>'true')
$$;
REVOKE ALL ON FUNCTION public.operator_commercial_tenant_eligible(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.operator_snapshot_mrr_daily_internal()
RETURNS public.platform_mrr_snapshot
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mrr     bigint;
  v_paying  int;
  v_tiers   jsonb;
  v_row     public.platform_mrr_snapshot;
BEGIN
  -- MRR (monthly-equivalent) + distinct payer count across all live subscriptions.
  SELECT COALESCE(sum(
           CASE WHEN ps.billing_period = 'annual'
                THEN round(pl.annual_price_cents::numeric / 12)::bigint
                ELSE pl.monthly_price_cents END
         ), 0)::bigint,
         count(DISTINCT ps.tenant_id)
  INTO v_mrr, v_paying
  FROM public.platform_subscriptions ps
  JOIN public.platform_subscription_plans pl ON pl.id = ps.plan_id
  WHERE ps.status='active' AND NOT ps.operator_rows_server_only AND ps.stripe_subscription_id IS NOT NULL AND public.operator_commercial_tenant_eligible(ps.tenant_id) AND EXISTS(SELECT 1 FROM public.tenants paid_tenant WHERE paid_tenant.id=ps.tenant_id AND paid_tenant.status='active');

  -- Tier breakdown of that MRR, grouped by the paying tenant's account_type.
  SELECT COALESCE(
    jsonb_object_agg(tier, mrr_cents), '{}'::jsonb
  ) INTO v_tiers
  FROM (
    SELECT COALESCE(t.account_type, 'unknown') AS tier,
           sum(
             CASE WHEN ps.billing_period = 'annual'
                  THEN round(pl.annual_price_cents::numeric / 12)::bigint
                  ELSE pl.monthly_price_cents END
           )::bigint AS mrr_cents
    FROM public.platform_subscriptions ps
    JOIN public.platform_subscription_plans pl ON pl.id = ps.plan_id
    JOIN public.tenants t ON t.id = ps.tenant_id
    WHERE ps.status='active' AND NOT ps.operator_rows_server_only AND ps.stripe_subscription_id IS NOT NULL AND public.operator_commercial_tenant_eligible(ps.tenant_id) AND EXISTS(SELECT 1 FROM public.tenants paid_tenant WHERE paid_tenant.id=ps.tenant_id AND paid_tenant.status='active')
    GROUP BY COALESCE(t.account_type, 'unknown')
  ) g;

  INSERT INTO public.platform_mrr_snapshot
    (snapshot_date, mrr_cents, arr_cents, active_tenants, tier_breakdown)
  VALUES
    (current_date, v_mrr, v_mrr * 12, v_paying, v_tiers)
  ON CONFLICT (snapshot_date) DO UPDATE SET
    mrr_cents      = EXCLUDED.mrr_cents,
    arr_cents      = EXCLUDED.arr_cents,
    active_tenants = EXCLUDED.active_tenants,
    tier_breakdown = EXCLUDED.tier_breakdown,
    created_at     = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.operator_dashboard_metrics(p_window_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  win_days int := GREATEST(COALESCE(p_window_days, 30), 1); win_start timestamptz;
  v_mrr bigint; v_paying int; v_dun_cnt int; v_dun_mrr bigint; v_at_risk int; v_users int;
  v_actions int; v_wau int; v_new int; v_tenants jsonb; v_trial_conv numeric;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'operator_scope_forbidden' USING ERRCODE = '42501'; END IF;
  win_start := now() - make_interval(days => win_days);
  SELECT COALESCE(sum(CASE WHEN ps.billing_period = 'annual' THEN round(pl.annual_price_cents::numeric / 12)::bigint ELSE pl.monthly_price_cents END), 0)::bigint, count(DISTINCT ps.tenant_id)
  INTO v_mrr, v_paying FROM public.platform_subscriptions ps JOIN public.platform_subscription_plans pl ON pl.id = ps.plan_id WHERE ps.status='active' AND NOT ps.operator_rows_server_only AND ps.stripe_subscription_id IS NOT NULL AND public.operator_commercial_tenant_eligible(ps.tenant_id) AND EXISTS(SELECT 1 FROM public.tenants paid_tenant WHERE paid_tenant.id=ps.tenant_id AND paid_tenant.status='active');
  SELECT count(DISTINCT ps.tenant_id), COALESCE(sum(CASE WHEN ps.billing_period = 'annual' THEN round(pl.annual_price_cents::numeric / 12)::bigint ELSE pl.monthly_price_cents END), 0)::bigint
  INTO v_dun_cnt, v_dun_mrr FROM public.platform_subscriptions ps JOIN public.platform_subscription_plans pl ON pl.id = ps.plan_id WHERE ps.status IN ('past_due', 'unpaid') AND NOT ps.operator_rows_server_only AND public.operator_commercial_tenant_eligible(ps.tenant_id);
  SELECT count(*) INTO v_at_risk FROM public.tenants t
  LEFT JOIN (SELECT e.tenant_id, max(e.occurred_at) AS last_active FROM public.paige_client_events e GROUP BY e.tenant_id) la ON la.tenant_id = t.id
  WHERE public.operator_commercial_tenant_eligible(t.id) AND (
    t.status IN ('past_due', 'suspended')
    OR EXISTS (SELECT 1 FROM public.platform_subscriptions ps WHERE ps.tenant_id = t.id AND ps.status IN ('past_due', 'unpaid'))
    OR (t.status = 'active' AND t.created_at < now() - interval '14 days' AND (la.last_active IS NULL OR la.last_active < now() - interval '14 days')));
  SELECT count(*) INTO v_users FROM public.profiles;
  SELECT count(*) INTO v_actions FROM public.paige_actions WHERE public.operator_commercial_tenant_eligible(tenant_id) AND status NOT IN ('done', 'dismissed', 'failed', 'expired');
  SELECT count(DISTINCT tenant_id) INTO v_wau FROM public.paige_client_events WHERE public.operator_commercial_tenant_eligible(tenant_id) AND occurred_at >= now() - interval '7 days';
  SELECT count(*) INTO v_new FROM public.tenants WHERE public.operator_commercial_tenant_eligible(id) AND created_at >= win_start;
  SELECT jsonb_build_object(
    'total', count(*) FILTER (WHERE status IN ('trial', 'active', 'past_due')),
    'individual', count(*) FILTER (WHERE status IN ('trial', 'active', 'past_due') AND account_type = 'individual'),
    'standalone', count(*) FILTER (WHERE status IN ('trial', 'active', 'past_due') AND account_type = 'standalone'),
    'agency', count(*) FILTER (WHERE status IN ('trial', 'active', 'past_due') AND account_type = 'agency'),
    'enterprise', count(*) FILTER (WHERE status IN ('trial', 'active', 'past_due') AND account_type = 'enterprise')
  ) INTO v_tenants FROM public.tenants WHERE public.operator_commercial_tenant_eligible(id);
  SELECT CASE WHEN count(*) FILTER (WHERE trial_ends_at < now()) > 0
    THEN round(100.0 * count(*) FILTER (WHERE trial_ends_at < now() AND status = 'active') / count(*) FILTER (WHERE trial_ends_at < now()), 1) ELSE NULL END
  INTO v_trial_conv FROM public.tenants WHERE public.operator_commercial_tenant_eligible(id) AND trial_ends_at IS NOT NULL;
  RETURN jsonb_build_object('mrr_cents', v_mrr, 'arr_cents', v_mrr * 12, 'active_tenants', v_tenants, 'new_tenants', v_new,
    'dunning', jsonb_build_object('count', v_dun_cnt, 'mrr_cents', v_dun_mrr), 'at_risk_count', v_at_risk,
    'total_platform_users', v_users, 'fleet_paige_actions', v_actions, 'wau_tenants', v_wau,
    'arpa_cents', CASE WHEN v_paying > 0 THEN (v_mrr / v_paying) ELSE NULL END, 'trial_conversion_pct', v_trial_conv);
END; $$;
