-- LOCAL, unversioned original Memory producer candidate. Not a migration or
-- release. Existing per-user rows and original eight-argument insert are reused.
BEGIN;
DO $guard$
DECLARE f record; body text; old_block text; new_block text;
BEGIN
 SELECT * INTO f FROM pg_proc WHERE oid='public.record_paige_memory(text,text,uuid,jsonb,boolean,text,uuid,uuid)'::regprocedure;
 IF md5(f.prosrc) NOT IN ('2ca751faa9d87bc6c4a586fd607847d0','11f56fb9590bbb1d7fec074f2fb3c67e')
  OR f.proowner<>current_user::regrole OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
  OR has_function_privilege('anon',f.oid,'EXECUTE')
  OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE') OR NOT has_function_privilege('service_role',f.oid,'EXECUTE')
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
   OR a.grantee NOT IN (f.proowner,'authenticated'::regrole::oid,'service_role'::regrole::oid) OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
  RAISE EXCEPTION 'PAIGE_MEMORY_SOURCE_DRIFT';
 END IF;
 IF md5(f.prosrc)='2ca751faa9d87bc6c4a586fd607847d0' THEN
  old_block:=E'  IF p_supersede_prior THEN\n    UPDATE public.paige_owner_memory\n       SET is_active = false\n     WHERE user_id = v_uid\n       AND memory_type = p_memory_type\n       AND is_active = true\n       AND tenant_id IS NOT DISTINCT FROM v_tenant;\n  END IF;';
  new_block:=E'  IF p_supersede_prior THEN\n    RAISE EXCEPTION ''PAIGE_MEMORY_SELECTED_REVIEW_REQUIRED'' USING ERRCODE=''22023'';\n  END IF;';
  body:=pg_get_functiondef(f.oid);
  IF strpos(body,old_block)=0 THEN RAISE EXCEPTION 'PAIGE_MEMORY_SOURCE_DRIFT'; END IF;
  EXECUTE replace(body,old_block,new_block);
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.record_paige_memory(
 p_memory_type text,p_content text,p_source_thread_id uuid,p_metadata jsonb,
 p_supersede_prior boolean,p_confirmation_state text,p_user_id uuid,p_tenant_id uuid,p_review jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $reviewed$
DECLARE
 actor uuid:=auth.uid(); tenant uuid; intent uuid; source_id uuid; source jsonb; doc jsonb;
 ref jsonb; fingerprint text; prior public.paige_owner_memory; target public.paige_owner_memory;
 metadata jsonb; saved public.paige_owner_memory; saved_id uuid; matches integer;
BEGIN
 IF auth.role()='service_role' OR actor IS NULL THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_CALLER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_review IS NULL OR jsonb_typeof(p_review)<>'object' OR pg_column_size(p_review)>16384
  OR NOT (p_review ?& ARRAY['schema_version','expected_actor','expected_tenant','intent_id','source_reference','source_quote'])
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_review) k WHERE k NOT IN ('schema_version','expected_actor','expected_tenant','intent_id','source_reference','source_quote','supersedes'))
  OR p_review->'schema_version'<>'1'::jsonb OR jsonb_typeof(p_review->'source_reference')<>'object'
  OR jsonb_typeof(p_review->'source_quote')<>'string' OR char_length(p_review->>'source_quote') NOT BETWEEN 1 AND 2000
  OR p_confirmation_state IS DISTINCT FROM 'confirmed' OR p_content IS NULL OR char_length(btrim(p_content)) NOT BETWEEN 1 AND 4000
  OR (p_metadata IS NOT NULL AND (jsonb_typeof(p_metadata)<>'object' OR pg_column_size(p_metadata)>16384
   OR p_metadata ?| ARRAY['reviewed_save','reviewed_request_sha256','confirmed_by','confirmed_at','confirmation_state','audience'])) THEN
  RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INVALID' USING ERRCODE='22023';
 END IF;
 BEGIN
  tenant:=(p_review->>'expected_tenant')::uuid; intent:=(p_review->>'intent_id')::uuid;
  IF actor IS DISTINCT FROM (p_review->>'expected_actor')::uuid OR tenant IS NULL OR intent IS NULL THEN
   RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501';
  END IF;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INVALID' USING ERRCODE='22023'; END;
 -- UUID text spelling cannot create another identity or a different lock/lookup.
 p_review:=p_review||jsonb_build_object('expected_actor',actor,'expected_tenant',tenant,'intent_id',intent);
 IF (p_user_id IS NOT NULL AND p_user_id<>actor) OR (p_tenant_id IS NOT NULL AND p_tenant_id<>tenant) THEN
  RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 -- Existing native Knowledge read owns scope/membership permission and holds
 -- the profile scope lock. Locks below prevent source/identity retirement while
 -- the original Memory writer commits; they grant no new role or audience.
 ref:=p_review->'source_reference';
 IF NOT(ref ?& ARRAY['contractVersion','tenantId','documentId','revision','contentSha256'])
  OR (SELECT count(*) FROM jsonb_object_keys(ref))<>5 OR ref->'contractVersion'<>'1'::jsonb
  OR ref->>'tenantId' IS DISTINCT FROM tenant::text OR ref->>'revision' !~ '^[1-9][0-9]*$'
  OR ref->>'contentSha256' !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
 BEGIN source_id:=(ref->>'documentId')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_SOURCE_INVALID' USING ERRCODE='22023'; END;
 source:=public.read_tenant_knowledge(tenant,source_id,1,0);
 PERFORM 1 FROM auth.users u WHERE u.id=actor AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_ACTOR_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenant_members m WHERE m.user_id=actor AND m.tenant_id=tenant FOR SHARE;
 PERFORM 1 FROM public.tenant_knowledge_docs d WHERE d.id=source_id AND d.tenant_id=tenant AND d.record_state='canonical' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 source:=public.read_tenant_knowledge(tenant,source_id,1,0);
 IF jsonb_array_length(source->'documents') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 doc:=source->'documents'->0;
 IF doc->>'id' IS DISTINCT FROM source_id::text OR doc->>'tenant_id' IS DISTINCT FROM tenant::text
  OR doc->>'revision' IS DISTINCT FROM ref->>'revision'
  OR encode(sha256(convert_to(doc->>'content','UTF8')),'hex') IS DISTINCT FROM ref->>'contentSha256'
  OR strpos(doc->>'content',p_review->>'source_quote')=0 THEN
  RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_SOURCE_CHANGED' USING ERRCODE='40001';
 END IF;
 IF p_source_thread_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.paige_chat_threads t WHERE t.id=p_source_thread_id AND t.tenant_id=tenant AND t.caller_user_id=actor AND NOT t.is_archived) THEN
  RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_THREAD_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_supersede_prior IS NULL OR p_supersede_prior IS DISTINCT FROM (p_review ? 'supersedes') THEN RAISE EXCEPTION 'PAIGE_MEMORY_SELECTED_REVIEW_REQUIRED' USING ERRCODE='22023'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('type',p_memory_type,'content',p_content,'thread',p_source_thread_id,'metadata',coalesce(p_metadata,'{}'::jsonb),'review',p_review)::text,'UTF8')),'hex');
 metadata:=coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('audience','owner_personal','reviewed_save',p_review,'reviewed_request_sha256',fingerprint,'confirmed_by',actor,'confirmation_state','confirmed');
 PERFORM pg_advisory_xact_lock(hashtextextended('paige_memory_review:'||tenant::text||':'||actor::text||':'||intent::text,0));
 SELECT count(*) INTO matches FROM public.paige_owner_memory m WHERE m.tenant_id=tenant AND m.user_id=actor AND lower(m.metadata#>>'{reviewed_save,intent_id}')=intent::text;
 IF matches>1 THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INTENT_CONFLICT' USING ERRCODE='40001'; END IF;
 IF matches=1 THEN
  SELECT * INTO prior FROM public.paige_owner_memory m WHERE m.tenant_id=tenant AND m.user_id=actor AND lower(m.metadata#>>'{reviewed_save,intent_id}')=intent::text FOR UPDATE;
  IF NOT prior.is_active THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_RETIRED' USING ERRCODE='40001'; END IF;
  IF prior.content IS DISTINCT FROM p_content OR prior.memory_type IS DISTINCT FROM p_memory_type
   OR prior.source_thread_id IS DISTINCT FROM p_source_thread_id OR prior.created_by IS DISTINCT FROM actor
   OR (prior.metadata-'confirmed_at') IS DISTINCT FROM metadata
   OR jsonb_typeof(prior.metadata->'confirmed_at') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INTENT_CONFLICT' USING ERRCODE='40001';
  END IF;
  RETURN prior.id;
 END IF;
 IF p_supersede_prior THEN
  IF jsonb_typeof(p_review->'supersedes')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_review->'supersedes'))<>2
   OR NOT ((p_review->'supersedes') ?& ARRAY['memory_id','updated_at']) THEN RAISE EXCEPTION 'PAIGE_MEMORY_SELECTED_REVIEW_REQUIRED' USING ERRCODE='22023'; END IF;
  BEGIN
   SELECT * INTO target FROM public.paige_owner_memory m WHERE m.id=(p_review#>>'{supersedes,memory_id}')::uuid AND m.tenant_id=tenant AND m.user_id=actor AND m.is_active FOR UPDATE;
   IF NOT FOUND OR target.updated_at IS DISTINCT FROM (p_review#>>'{supersedes,updated_at}')::timestamptz THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_TARGET_CHANGED' USING ERRCODE='40001'; END IF;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INVALID' USING ERRCODE='22023'; END;
  UPDATE public.paige_owner_memory SET is_active=false,updated_at=now() WHERE public.paige_owner_memory.id=target.id;
 END IF;
 metadata:=metadata||jsonb_build_object('confirmed_at',now());
 -- The ORIGINAL eight-argument producer performs the insertion, vocabulary,
 -- confirmation and attribution. No raw INSERT or second Memory home.
 saved_id:=public.record_paige_memory(p_memory_type,p_content,p_source_thread_id,metadata,false,'confirmed',NULL,NULL);
 SELECT * INTO saved FROM public.paige_owner_memory m WHERE m.id=saved_id AND m.tenant_id=tenant AND m.user_id=actor;
 IF NOT FOUND OR NOT saved.is_active OR saved.created_by IS DISTINCT FROM actor OR saved.memory_type IS DISTINCT FROM p_memory_type
  OR saved.content IS DISTINCT FROM p_content OR saved.metadata->>'reviewed_request_sha256' IS DISTINCT FROM fingerprint
  OR saved.metadata->>'confirmation_state' IS DISTINCT FROM 'confirmed' THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_READBACK_MISMATCH' USING ERRCODE='55000'; END IF;
 RETURN saved_id;
END $reviewed$;
REVOKE ALL ON FUNCTION public.record_paige_memory(text,text,uuid,jsonb,boolean,text,uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_paige_memory(text,text,uuid,jsonb,boolean,text,uuid,uuid,jsonb) TO authenticated;
COMMIT;
