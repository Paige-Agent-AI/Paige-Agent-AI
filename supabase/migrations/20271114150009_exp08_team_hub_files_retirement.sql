-- EXP08 Team Hub increment 3, §6: the team_hub_files storage retirement provider. Contract:
-- docs/delivery/exp08-team-hub-increment3-attachments-contract.md. Modelled on generated_media
-- (20270602000304): the same private journal, the same claimed finalizer, Storage API byte removal
-- with absence readback, and no SQL metadata deletion. Scope is exactly the Team Hub sub-prefix
-- <tenant_id>/team-hub/<file uuid> of the private comms-attachments bucket. Every other comms
-- object in that bucket stays a deletion blocker exactly as before; that gap predates this increment.
-- Each function below is its newest definition re-emitted in full with only its team_hub_files
-- branch added (fingerprint/ready/claim/assert/finish from 20270602000304; preview/begin/read from
-- 20271020000100; the deletion plan from 20271020000420). Forward-only and replay-safe.
CREATE OR REPLACE FUNCTION public.operator_team_hub_files_manifest(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE objects jsonb; invalid boolean;
BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='comms-attachments' AND split_part(name,'/',1)=_tenant_id::text AND split_part(name,'/',2)='team-hub')
 AND NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='comms-attachments' AND NOT public) THEN RAISE EXCEPTION 'Team Hub file bucket is not private' USING ERRCODE='55000'; END IF;
 -- Only the canonical three-segment path the server builds. Anything else under the prefix
 -- (a nested name, an upper-case id, a versioned object) refuses the whole scope.
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'fingerprint',md5((to_jsonb(o)-'last_accessed_at')::text)) ORDER BY name),'[]'),
 coalesce(bool_or(name !~ ('^'||_tenant_id::text||'/team-hub/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') OR coalesce((to_jsonb(o)->>'is_versioned')::boolean,false) OR coalesce((to_jsonb(o)->>'is_delete_marker')::boolean,false)),false)
 INTO objects,invalid FROM storage.objects o WHERE bucket_id='comms-attachments' AND split_part(name,'/',1)=_tenant_id::text AND split_part(name,'/',2)='team-hub';
 IF invalid OR jsonb_array_length(objects)>100 THEN RAISE EXCEPTION 'Team Hub files require a bounded unversioned canonical scope' USING ERRCODE='55000'; END IF;
 RETURN objects;
END $$;
CREATE OR REPLACE FUNCTION public.operator_team_hub_files_subset(_tenant_id uuid,_manifest jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT _manifest @> public.operator_team_hub_files_manifest(_tenant_id)
$$;
REVOKE ALL ON FUNCTION public.operator_team_hub_files_manifest(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.operator_team_hub_files_subset(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- No new Team Hub object once the account is archived or its execution is paused for retirement.
-- Storage can still touch last_accessed_at; removal (DELETE) is never guarded. Inbox attachments
-- in the same bucket, outside the team-hub segment, keep their contract unchanged.
CREATE OR REPLACE FUNCTION public.guard_operator_retired_team_hub_files()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE value jsonb; path text; tenant uuid;
BEGIN
 FOR value IN SELECT v FROM unnest(ARRAY[to_jsonb(OLD),to_jsonb(NEW)]) v LOOP
  IF value->>'bucket_id' IS DISTINCT FROM 'comms-attachments' OR split_part(value->>'name','/',2) IS DISTINCT FROM 'team-hub' THEN CONTINUE; END IF;
  path:=split_part(value->>'name','/',1);
  IF path !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'invalid Team Hub file scope' USING ERRCODE='42501'; END IF;
  tenant:=path::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=tenant AND t.archived_at IS NULL AND NOT t.lifecycle_execution_paused) THEN
   IF TG_OP='UPDATE' AND (to_jsonb(OLD)-'last_accessed_at')=(to_jsonb(NEW)-'last_accessed_at') THEN CONTINUE; END IF;
   RAISE EXCEPTION 'Team Hub workspace is retired or paused' USING ERRCODE='55000';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_operator_retired_team_hub_files() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE TRIGGER a01_operator_retired_team_hub_files BEFORE INSERT OR UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.guard_operator_retired_team_hub_files();

CREATE OR REPLACE FUNCTION public.operator_resource_fingerprint(_provider text,_tenant_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE value text;
BEGIN
 IF _provider='twilio' THEN SELECT md5(to_jsonb(t)::text) INTO value FROM public.tenant_twilio_subaccounts t WHERE tenant_id=_tenant_id;
 ELSIF _provider='n8n' THEN SELECT md5(jsonb_build_object('connection',to_jsonb(t),'projection',(SELECT jsonb_agg(to_jsonb(m) ORDER BY connection_id) FROM public.mcp_connections m WHERE m.tenant_id=_tenant_id AND m.legacy_source='tenant_n8n_connections'))::text) INTO value FROM public.tenant_n8n_connections t WHERE tenant_id=_tenant_id;
 ELSIF _provider='tts_cache' THEN value:=md5(public.operator_tts_cache_manifest(_tenant_id)::text);
 ELSIF _provider='generated_media' THEN value:=md5(public.operator_generated_media_manifest(_tenant_id)::text);
 ELSIF _provider='team_hub_files' THEN value:=md5(public.operator_team_hub_files_manifest(_tenant_id)::text);
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
 WHEN _provider='generated_media' THEN _mode='delete' AND result.value->>'provider_status'='removed' AND public.operator_generated_media_manifest(_tenant_id)='[]'::jsonb
 WHEN _provider='team_hub_files' THEN _mode='delete' AND result.value->>'provider_status'='removed' AND public.operator_team_hub_files_manifest(_tenant_id)='[]'::jsonb
 ELSE result.value->>'provider_status'='disconnected' AND (result.value->>'external_retention')::boolean END)
$$;

CREATE OR REPLACE FUNCTION public.operator_preview_retirement_resources(_tenant_id uuid,_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p jsonb; ids uuid[]; blockers jsonb:='[]'; resources jsonb:='[]'; item record; version text; n bigint; storage_supported boolean; cache_tenant uuid;
BEGIN
 IF NOT (CASE WHEN _mode='archive' THEN public.operator_can_archive_accounts() ELSE public.operator_can_permanently_delete_accounts() END) THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 IF _mode NOT IN ('archive','delete') THEN RAISE EXCEPTION 'invalid resource action' USING ERRCODE='22023'; END IF;
 p:=CASE WHEN _mode='archive' THEN public.operator_preview_account_archive(_tenant_id) ELSE public.operator_preview_account_deletion(_tenant_id) END;
 SELECT array_agg((a->>'id')::uuid) INTO ids FROM jsonb_array_elements(p->'accounts') a;
 storage_supported:=NOT EXISTS(SELECT 1 FROM storage.objects o WHERE (split_part(o.name,'/',1)=ANY(ARRAY(SELECT unnest(ids)::text)) OR (split_part(o.name,'/',1)='tenants' AND split_part(o.name,'/',2)=ANY(ARRAY(SELECT unnest(ids)::text)))) AND ((o.bucket_id IS DISTINCT FROM 'tts-cache' AND o.bucket_id IS DISTINCT FROM 'paige-generated' AND NOT(o.bucket_id='comms-attachments' AND split_part(o.name,'/',2)='team-hub')) OR split_part(o.name,'/',1)='tenants'));
 SELECT coalesce(jsonb_agg(b),'[]') INTO blockers FROM jsonb_array_elements_text(p->'blockers') b
 WHERE NOT(_mode='delete' AND storage_supported AND b LIKE '% tenant-prefixed storage objects require the canonical Storage API cleanup and absence readback.')
 -- Team Hub file records whose objects this provider purges; the deletion plan keeps refusing
 -- until each object is absent, so this lifts only the resource review, never the deletion.
 AND NOT(_mode='delete' AND storage_supported AND b LIKE 'team\_hub\_files: % file-bearing records require canonical object cleanup and absence verification before deletion.');
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
   BEGIN
    n:=jsonb_array_length(public.operator_team_hub_files_manifest(cache_tenant));
    IF n>0 THEN resources:=resources||jsonb_build_array(jsonb_build_object('provider','team_hub_files','tenant_id',cache_tenant,'action','remove_files','object_count',n)); END IF;
   EXCEPTION WHEN SQLSTATE '55000' THEN blockers:=blockers||jsonb_build_array('Team Hub files need a private, bounded, unversioned canonical scope.'); END;
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
   objects:=public.operator_team_hub_files_manifest(cache_tenant);
   IF objects<>'[]'::jsonb THEN plan:=plan||jsonb_build_array(jsonb_build_object('key','team_hub_files:'||cache_tenant,'provider','team_hub_files','tenant_id',cache_tenant,'objects',objects,'fingerprint',public.operator_resource_fingerprint('team_hub_files',cache_tenant))); END IF;
  END LOOP;
 END IF;
 INSERT INTO public.operator_account_archives(id,root_tenant_id,actor_user_id,root_name,state,scope_ids,prior_tenants,prior_members,resource_mode,resource_plan)
 VALUES(_operation_id,_tenant_id,auth.uid(),name,'resources_preparing',ids,(SELECT jsonb_agg(to_jsonb(t)) FROM public.tenants t WHERE id=ANY(ids)),'[]',_mode,plan);
 UPDATE public.tenants SET lifecycle_execution_paused=true WHERE id=ANY(ids) AND NOT lifecycle_execution_paused;
 INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES(auth.uid(),'tenant.resources_prepare','tenant',_tenant_id,jsonb_build_object('operation_id',_operation_id,'mode',_mode,'account_count',cardinality(ids),'external_n8n_retained',_retain_external_n8n));
 RETURN public.operator_read_retirement_resources(_tenant_id,_operation_id);
END $$;

CREATE OR REPLACE FUNCTION public.operator_read_retirement_resources(_tenant_id uuid,_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.operator_account_archives; summary jsonb;
BEGIN
 IF NOT public.operator_can_archive_accounts() THEN RAISE EXCEPTION 'platform administrator only' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.operator_account_archives WHERE (_operation_id IS NULL OR id=_operation_id) AND root_tenant_id=_tenant_id AND resource_mode IS NOT NULL
 AND actor_user_id=auth.uid() ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'resource operation not found' USING ERRCODE='P0002'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('provider',value->>'provider','state',value->>'state','provider_status',value->>'provider_status','reason',value->>'reason')),'[]') INTO summary FROM jsonb_each(r.resource_results);
 RETURN jsonb_build_object('tenant_id',r.root_tenant_id,'operation_id',r.id,'mode',r.resource_mode,'state',r.state,'account_count',cardinality(r.scope_ids),'file_only',jsonb_array_length(r.resource_plan)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.resource_plan) p WHERE p->>'provider' NOT IN ('tts_cache','generated_media','team_hub_files')),'results',summary);
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
  IF NOT(r.resource_results ? (item->>'key')) AND (CASE WHEN item->>'provider'='tts_cache' THEN NOT public.operator_tts_cache_subset((item->>'tenant_id')::uuid,item->'objects') WHEN item->>'provider'='generated_media' THEN NOT public.operator_generated_media_subset((item->>'tenant_id')::uuid,item->'objects') WHEN item->>'provider'='team_hub_files' THEN NOT public.operator_team_hub_files_subset((item->>'tenant_id')::uuid,item->'objects') ELSE item->>'fingerprint' IS DISTINCT FROM public.operator_resource_fingerprint(item->>'provider',(item->>'tenant_id')::uuid) END) THEN RAISE EXCEPTION 'resource binding changed; reconcile exact provider identity' USING ERRCODE='40001'; END IF;
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
 AND (CASE WHEN item->>'provider'='tts_cache' THEN public.operator_tts_cache_subset((item->>'tenant_id')::uuid,item->'objects') WHEN item->>'provider'='generated_media' THEN public.operator_generated_media_subset((item->>'tenant_id')::uuid,item->'objects') WHEN item->>'provider'='team_hub_files' THEN public.operator_team_hub_files_subset((item->>'tenant_id')::uuid,item->'objects') ELSE public.operator_resource_fingerprint(item->>'provider',(item->>'tenant_id')::uuid)=coalesce(r.resource_results->(_key)->>'fingerprint',item->>'fingerprint') END);
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
 IF NOT(r.resource_results ? _key) AND (CASE WHEN item->>'provider'='tts_cache' THEN NOT public.operator_tts_cache_subset(t,item->'objects') WHEN item->>'provider'='generated_media' THEN NOT public.operator_generated_media_subset(t,item->'objects') WHEN item->>'provider'='team_hub_files' THEN NOT public.operator_team_hub_files_subset(t,item->'objects') ELSE item->>'fingerprint' IS DISTINCT FROM public.operator_resource_fingerprint(item->>'provider',t) END) THEN RAISE EXCEPTION 'resource binding changed' USING ERRCODE='40001'; END IF;
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
  ELSIF item->>'provider'='generated_media' THEN
   IF r.resource_mode<>'delete' OR _provider_status<>'removed' OR public.operator_generated_media_manifest(t)<>'[]'::jsonb THEN RAISE EXCEPTION 'generated-media API absence is unverified' USING ERRCODE='55000'; END IF;
  ELSIF item->>'provider'='team_hub_files' THEN
   IF r.resource_mode<>'delete' OR _provider_status<>'removed' OR public.operator_team_hub_files_manifest(t)<>'[]'::jsonb THEN RAISE EXCEPTION 'Team Hub file API absence is unverified' USING ERRCODE='55000'; END IF;
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

CREATE OR REPLACE FUNCTION public.operator_account_deletion_plan(_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE plan jsonb:='{}'; blockers jsonb:='[]'; r record; tids jsonb; old jsonb; round int; changed boolean; n bigint; hash text; invalid bigint; cond text; entry jsonb; resource record; frontier text[]; next_frontier text[];
BEGIN
 -- Vacuous-today deltas kept in mind: a future uuid-DOMAIN tenant column or a partitioned
 -- base table would resolve differently (information_schema folds domains; relkind r
 -- excludes p) — neither exists in this schema; the proof pins output equality.
 -- ANT-47 round 2: the same discovery against pg_catalog directly; information_schema
 -- views cost ~45ms per query as this definer and the walk issued ~17 of them.
 FOR r IN SELECT cl.relname table_name,string_agg(format('t.%I=ANY($1)',a.attname),' OR ' ORDER BY a.attname) predicate
   FROM pg_attribute a JOIN pg_class cl ON cl.oid=a.attrelid
   JOIN pg_namespace ns ON ns.oid=cl.relnamespace AND ns.nspname='public'
   JOIN pg_type ty ON ty.oid=a.atttypid AND ty.typname='uuid'
   WHERE cl.relkind='r' AND a.attnum>0 AND NOT a.attisdropped AND cl.relname<>'operator_account_archives' AND a.attname NOT IN ('retired_tenant_id','retired_working_context_tenant_id')
     AND (a.attname='tenant_id' OR a.attname LIKE '%\_tenant\_id' ESCAPE '\' OR (cl.relname='tenants' AND a.attname='id'))
   GROUP BY cl.relname ORDER BY cl.relname
 LOOP
   -- tenants are only the exact confirmed IDs; parent_tenant_id never widens them here.
   cond:=CASE WHEN r.table_name='tenants' THEN 't.id=ANY($1)' ELSE r.predicate END;
   EXECUTE format('SELECT coalesce(jsonb_agg(ctid::text ORDER BY ctid),''[]'') FROM public.%I t WHERE %s',r.table_name,cond) INTO tids USING _ids;
   IF jsonb_array_length(tids)>0 THEN plan:=plan||jsonb_build_object(r.table_name,tids); END IF;
 END LOOP;
 -- Discover all FK descendants, including records that lack a tenant column.
 -- ANT-47 timeout repair: a worklist frontier probes each foreign key only when its parent
 -- relation changed in the previous round (or just entered the plan) instead of re-probing
 -- every candidate FK every round. The fixpoint, the 30-round ceiling and each probe are
 -- unchanged in result; only redundant re-probes of unchanged parents are skipped, so the
 -- walk keeps the API role's bounded statement budget on real data volumes.
 frontier:=ARRAY(SELECT jsonb_object_keys(plan));
 FOR round IN 1..30 LOOP
   changed:=false; next_frontier:='{}';
   FOR r IN SELECT k.oid,c.relname child,p.relname parent FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class p ON p.oid=k.confrelid
     WHERE k.contype='f' AND n.nspname='public' AND plan ? p.relname AND p.relname<>'profiles' AND public.operator_retirement_disposition(p.relname)='delete' AND p.relname=ANY(frontier) ORDER BY c.relname,k.oid
   LOOP
     cond:=public.operator_retirement_fk_join(r.oid);
     old:=coalesce(plan->r.child,'[]');
     EXECUTE format('SELECT coalesce(jsonb_agg(ctid::text ORDER BY ctid),''[]'') FROM public.%I WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) OR ctid IN (SELECT c.ctid FROM public.%I c JOIN public.%I p ON %s WHERE p.ctid::text IN (SELECT value FROM jsonb_array_elements_text($2)))',r.child,r.child,r.parent,cond) INTO tids USING old,plan->r.parent;
     IF tids<>old THEN plan:=plan||jsonb_build_object(r.child,tids); changed:=true; next_frontier:=next_frontier||ARRAY[r.child]; END IF;
   END LOOP;
   frontier:=next_frontier;
   EXIT WHEN NOT changed;
 END LOOP;
 IF changed THEN blockers:=blockers||jsonb_build_array('Dependency graph exceeded the bounded review depth. Administrator disposition required.'); END IF;
 -- PAIGE phone mappings are deletable without a vendor call. Foreign ownership still refuses.
 IF EXISTS(SELECT 1 FROM public.tenant_phone_numbers p JOIN public.tenant_twilio_subaccounts t ON t.id=p.subaccount_id WHERE p.tenant_id=ANY(_ids) AND t.tenant_id<>p.tenant_id) THEN
  blockers:=blockers||jsonb_build_array('tenant_phone_numbers has cross-account ownership. Preserve the surviving account; reconcile its relationship first.');
 END IF;
 IF EXISTS(SELECT 1 FROM public.mcp_connections WHERE tenant_id=ANY(_ids) AND (legacy_source IS DISTINCT FROM 'tenant_n8n_connections' OR provider_key<>'n8n')) THEN blockers:=blockers||jsonb_build_array('mcp_connections: An independent connector requires its canonical disconnection and credential disposition.'); END IF;
 IF EXISTS(SELECT 1 FROM public.platform_subscriptions WHERE tenant_id=ANY(_ids) AND (stripe_subscription_id IS NOT NULL OR stripe_customer_id IS NOT NULL)) THEN blockers:=blockers||jsonb_build_array('Live billing references require authoritative billing retirement before account deletion.'); END IF;
 IF EXISTS(SELECT 1 FROM public.paige_voice_cost_reservations WHERE tenant_id=ANY(_ids) AND state IN ('reserved','ambiguous')) THEN
  blockers:=blockers||jsonb_build_array('Unsettled voice cost reservations require canonical settlement before deletion.');
 END IF;
 FOR r IN SELECT key relation,value tids FROM jsonb_each(plan) ORDER BY key LOOP
   n:=jsonb_array_length(r.tids);
   IF n>20000 THEN blockers:=blockers||jsonb_build_array(format('%s exceeds the bounded cleanup size; use a reviewed maintenance operation.',r.relation)); END IF;
   -- Every explicit scope field on a selected row must be empty or within the confirmed tree.
   SELECT string_agg(format('(t.%I IS NOT NULL AND NOT(t.%I=ANY($2)))',a.attname,a.attname),' OR ') INTO cond FROM pg_attribute a
     JOIN pg_class cl ON cl.oid=a.attrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace AND ns.nspname='public' JOIN pg_type ty ON ty.oid=a.atttypid AND ty.typname='uuid'
     WHERE cl.relkind='r' AND a.attnum>0 AND NOT a.attisdropped AND cl.relname=r.relation AND (a.attname='tenant_id' OR a.attname LIKE '%\_tenant\_id' ESCAPE '\') AND NOT(cl.relname='tenants' AND a.attname='parent_tenant_id');
   IF cond IS NOT NULL AND public.operator_retirement_disposition(r.relation)<>'preserve' THEN
     EXECUTE format('SELECT count(*) FROM public.%I t WHERE t.ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) AND (%s)',r.relation,cond) INTO invalid USING r.tids,_ids;
     IF invalid>0 THEN blockers:=blockers||jsonb_build_array(format('%s has cross-account dependencies. Preserve the surviving account; resolve its relationship first.',r.relation)); END IF;
   END IF;
   EXECUTE format('SELECT md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)),'''')) FROM public.%I t WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1))',r.relation) INTO hash USING r.tids;
   -- File references are obligations even when their storage path is not tenant-prefixed.
   -- Only counts leave this helper; file URLs/keys and attachment payloads never do.
   -- A Team Hub file record is released only once its exact canonical object is absent from
   -- Storage, which is the team_hub_files provider's removal and readback. A present object keeps
   -- blocking. Absence-gated, never row-gated; every other relation is unchanged.
   IF r.relation='team_hub_files' AND to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.team_hub_files t WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) AND nullif(t.storage_path,'''') IS NOT NULL AND (t.storage_path IS DISTINCT FROM t.tenant_id::text||''/team-hub/''||t.id::text OR EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=''comms-attachments'' AND o.name=t.storage_path))' INTO invalid USING r.tids;
   ELSE
   EXECUTE format('SELECT count(*) FROM public.%I t WHERE ctid::text IN (SELECT value FROM jsonb_array_elements_text($1)) AND (nullif(to_jsonb(t)->>''storage_path'','''') IS NOT NULL OR nullif(to_jsonb(t)->>''file_path'','''') IS NOT NULL OR nullif(to_jsonb(t)->>''storage_key'','''') IS NOT NULL OR nullif(to_jsonb(t)->>''file_url'','''') IS NOT NULL OR coalesce(to_jsonb(t)->''attachments'',''null''::jsonb) NOT IN (''null''::jsonb,''[]''::jsonb,''{}''::jsonb))',r.relation) INTO invalid USING r.tids;
   END IF;
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
REVOKE ALL ON FUNCTION public.operator_assert_retirement_resource(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_assert_retirement_resource(uuid,uuid,uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.operator_finish_retirement_resource(uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.operator_finish_retirement_resource(uuid,uuid,uuid,uuid,text,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.operator_account_deletion_plan(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
