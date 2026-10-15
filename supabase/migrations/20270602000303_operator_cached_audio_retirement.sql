-- Forward extension of the canonical retirement journal. Storage API owns byte deletion.
CREATE OR REPLACE FUNCTION public.operator_tts_cache_manifest(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE objects jsonb; invalid boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='tts-cache' AND split_part(name,'/',1)=_tenant_id::text)
 AND NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='tts-cache' AND NOT public) THEN RAISE EXCEPTION 'cached audio bucket is not private' USING ERRCODE='55000'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'fingerprint',md5((to_jsonb(o)-'last_accessed_at')::text)) ORDER BY name),'[]'),
 coalesce(bool_or(name !~ ('^'||_tenant_id::text||'/[0-9a-f]{64}\.mp3$') OR coalesce((to_jsonb(o)->>'is_versioned')::boolean,false) OR coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)),false)
 INTO objects,invalid FROM storage.objects o WHERE bucket_id='tts-cache' AND split_part(name,'/',1)=_tenant_id::text;
 IF invalid OR jsonb_array_length(objects)>100 THEN RAISE EXCEPTION 'cached audio requires a bounded unversioned canonical scope' USING ERRCODE='55000'; END IF;
 RETURN objects;
END $$;
CREATE OR REPLACE FUNCTION public.operator_tts_cache_subset(_tenant_id uuid,_manifest jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT _manifest @> public.operator_tts_cache_manifest(_tenant_id)
$$;
REVOKE ALL ON FUNCTION public.operator_tts_cache_manifest(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.operator_tts_cache_subset(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Prevent late background audio uploads after Archive/retirement. Does not delete metadata
-- or change a Storage policy; platform audio and active businesses retain their contract.
CREATE OR REPLACE FUNCTION public.guard_operator_retired_tts_cache()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE path text; value jsonb; tenant uuid;
BEGIN
 FOR value IN SELECT v FROM unnest(ARRAY[to_jsonb(OLD),to_jsonb(NEW)]) v LOOP
  IF value->>'bucket_id' IS DISTINCT FROM 'tts-cache' THEN CONTINUE; END IF;
  path:=split_part(value->>'name','/',1);
  IF path='_platform' THEN CONTINUE; END IF;
  IF path !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'invalid cached audio scope' USING ERRCODE='42501'; END IF;
  tenant:=path::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=tenant AND t.archived_at IS NULL AND NOT t.lifecycle_execution_paused) THEN
   IF TG_OP='UPDATE' AND (to_jsonb(OLD)-'last_accessed_at')=(to_jsonb(NEW)-'last_accessed_at') THEN CONTINUE; END IF;
   RAISE EXCEPTION 'cached audio workspace is retired or paused' USING ERRCODE='55000';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_operator_retired_tts_cache() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE TRIGGER a01_operator_retired_tts_cache BEFORE INSERT OR UPDATE ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION public.guard_operator_retired_tts_cache();

CREATE OR REPLACE FUNCTION public.operator_resource_fingerprint(_provider text,_tenant_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE value text;
BEGIN
 IF _provider='twilio' THEN SELECT md5(to_jsonb(t)::text) INTO value FROM public.tenant_twilio_subaccounts t WHERE tenant_id=_tenant_id;
 ELSIF _provider='n8n' THEN SELECT md5(jsonb_build_object('connection',to_jsonb(t),'projection',(SELECT jsonb_agg(to_jsonb(m) ORDER BY connection_id) FROM public.mcp_connections m WHERE m.tenant_id=_tenant_id AND m.legacy_source='tenant_n8n_connections'))::text) INTO value FROM public.tenant_n8n_connections t WHERE tenant_id=_tenant_id;
 ELSIF _provider='tts_cache' THEN value:=md5(public.operator_tts_cache_manifest(_tenant_id)::text);
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
 WHEN _provider='tts_cache' THEN _mode='delete' AND result.value->>'provider_status'='removed' AND public.operator_tts_cache_manifest(_tenant_id)='[]'::jsonb
 ELSE result.value->>'provider_status'='disconnected' AND (result.value->>'external_retention')::boolean END)
$$;

CREATE OR REPLACE FUNCTION public.operator_preview_retirement_resources(_tenant_id uuid,_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p jsonb; ids uuid[]; blockers jsonb:='[]'; resources jsonb:='[]'; item record; version text; n bigint; storage_supported boolean; cache_tenant uuid;
BEGIN
 IF NOT public.operator_can_retire_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 IF _mode NOT IN ('archive','delete') THEN RAISE EXCEPTION 'invalid resource action' USING ERRCODE='22023'; END IF;
 p:=CASE WHEN _mode='archive' THEN public.operator_preview_account_archive(_tenant_id) ELSE public.operator_preview_account_deletion(_tenant_id) END;
 SELECT array_agg((a->>'id')::uuid) INTO ids FROM jsonb_array_elements(p->'accounts') a;
 storage_supported:=NOT EXISTS(SELECT 1 FROM storage.objects o WHERE (split_part(o.name,'/',1)=ANY(ARRAY(SELECT unnest(ids)::text)) OR (split_part(o.name,'/',1)='tenants' AND split_part(o.name,'/',2)=ANY(ARRAY(SELECT unnest(ids)::text)))) AND (o.bucket_id IS DISTINCT FROM 'tts-cache' OR split_part(o.name,'/',1)='tenants'));
 SELECT coalesce(jsonb_agg(b),'[]') INTO blockers FROM jsonb_array_elements_text(p->'blockers') b
 WHERE b NOT LIKE 'tenant_twilio_subaccounts:%' AND b NOT LIKE 'tenant_n8n_connections:%' AND b NOT LIKE 'tenant_phone_numbers:%' AND NOT(_mode='delete' AND storage_supported AND b LIKE '% tenant-prefixed storage objects require the canonical Storage API cleanup and absence readback.');
 FOR item IN SELECT t.* FROM public.tenant_twilio_subaccounts t WHERE tenant_id=ANY(ids) ORDER BY tenant_id LOOP
  IF EXISTS(SELECT 1 FROM public.tenant_twilio_subaccounts other WHERE other.twilio_subaccount_sid=item.twilio_subaccount_sid AND other.tenant_id<>item.tenant_id) THEN
   blockers:=blockers||jsonb_build_array('Twilio identity is shared or ambiguously mapped; resolve its canonical ownership before retirement.');
  END IF;
  resources:=resources||jsonb_build_array(jsonb_build_object('provider','twilio','tenant_id',item.tenant_id,'action',CASE WHEN _mode='archive' THEN 'suspend' ELSE 'close' END));
 END LOOP;
 FOR item IN SELECT tenant_id FROM public.tenant_n8n_connections WHERE tenant_id=ANY(ids) ORDER BY tenant_id LOOP
  resources:=resources||jsonb_build_array(jsonb_build_object('provider','n8n','tenant_id',item.tenant_id,'action','disconnect','external_retention',true));
 END LOOP;
 IF _mode='delete' THEN
  FOREACH cache_tenant IN ARRAY ids LOOP
   BEGIN
    n:=jsonb_array_length(public.operator_tts_cache_manifest(cache_tenant));
    IF n>0 THEN resources:=resources||jsonb_build_array(jsonb_build_object('provider','tts_cache','tenant_id',cache_tenant,'action','remove_cache','object_count',n)); END IF;
   EXCEPTION WHEN SQLSTATE '55000' THEN blockers:=blockers||jsonb_build_array('Cached audio needs a private, bounded, unversioned canonical scope.'); END;
  END LOOP;
 END IF;
 IF jsonb_array_length(resources)>50 THEN blockers:=blockers||jsonb_build_array('Provider preparation exceeds the supported bounded scope.'); END IF;
 -- Bind the review to current account state and every resource row without exposing credentials.
 SELECT md5(coalesce(p->>'version','')||_mode||resources::text||coalesce(string_agg(public.operator_resource_fingerprint(provider,tenant_id),'' ORDER BY provider,tenant_id),'')) INTO version
 FROM jsonb_to_recordset(resources) AS x(provider text,tenant_id uuid);
 RETURN jsonb_build_object('tenant_id',_tenant_id,'mode',_mode,'version',version,'accounts',p->'accounts','resources',resources,'blockers',blockers,
 'execution_available',jsonb_array_length(blockers)=0 AND jsonb_array_length(resources)>0);
END $$;

CREATE OR REPLACE FUNCTION public.operator_begin_retirement_resources(_tenant_id uuid,_mode text,_expected_version text,_confirmation_name text,_operation_id uuid,_retain_external_n8n boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p jsonb; ids uuid[]; plan jsonb:='[]'; item record; existing public.operator_account_archives; name text; cache_tenant uuid; objects jsonb;
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
 IF _mode='delete' THEN
  FOREACH cache_tenant IN ARRAY ids LOOP
   objects:=public.operator_tts_cache_manifest(cache_tenant);
   IF objects<>'[]'::jsonb THEN plan:=plan||jsonb_build_array(jsonb_build_object('key','tts_cache:'||cache_tenant,'provider','tts_cache','tenant_id',cache_tenant,'objects',objects,'fingerprint',public.operator_resource_fingerprint('tts_cache',cache_tenant))); END IF;
  END LOOP;
 END IF;
 INSERT INTO public.operator_account_archives(id,root_tenant_id,actor_user_id,root_name,state,scope_ids,prior_tenants,prior_members,resource_mode,resource_plan)
 VALUES(_operation_id,_tenant_id,auth.uid(),name,'resources_preparing',ids,(SELECT jsonb_agg(to_jsonb(t)) FROM public.tenants t WHERE id=ANY(ids)),'[]',_mode,plan);
 UPDATE public.tenants SET lifecycle_execution_paused=true WHERE id=ANY(ids);
 INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(auth.uid(),'tenant.resources_prepare','tenant',_tenant_id,jsonb_build_object('operation_id',_operation_id,'mode',_mode,'account_count',cardinality(ids),'external_n8n_retained',_retain_external_n8n));
 RETURN public.operator_read_retirement_resources(_tenant_id,_operation_id);
END $$;

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
  IF NOT(r.resource_results ? (item->>'key')) AND (CASE WHEN item->>'provider'='tts_cache' THEN NOT public.operator_tts_cache_subset((item->>'tenant_id')::uuid,item->'objects') ELSE item->>'fingerprint' IS DISTINCT FROM public.operator_resource_fingerprint(item->>'provider',(item->>'tenant_id')::uuid) END) THEN RAISE EXCEPTION 'resource binding changed; reconcile exact provider identity' USING ERRCODE='40001'; END IF;
 END LOOP;
 UPDATE public.operator_account_archives SET resource_claim=_claim,resource_started_at=clock_timestamp() WHERE id=r.id;
 RETURN jsonb_build_object('complete',false,'mode',r.resource_mode,'resources',r.resource_plan,'results',r.resource_results);
END $$;

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
 AND (CASE WHEN item->>'provider'='tts_cache' THEN public.operator_tts_cache_subset((item->>'tenant_id')::uuid,item->'objects') ELSE public.operator_resource_fingerprint(item->>'provider',(item->>'tenant_id')::uuid)=coalesce(r.resource_results->(_key)->>'fingerprint',item->>'fingerprint') END);
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
 IF NOT(r.resource_results ? _key) AND (CASE WHEN item->>'provider'='tts_cache' THEN NOT public.operator_tts_cache_subset(t,item->'objects') ELSE item->>'fingerprint' IS DISTINCT FROM public.operator_resource_fingerprint(item->>'provider',t) END) THEN RAISE EXCEPTION 'resource binding changed' USING ERRCODE='40001'; END IF;
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
  ELSIF item->>'provider'='tts_cache' THEN
   IF r.resource_mode<>'delete' OR _provider_status<>'removed' OR public.operator_tts_cache_manifest(t)<>'[]'::jsonb THEN RAISE EXCEPTION 'Storage API absence is unverified' USING ERRCODE='55000'; END IF;
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
