-- LOCAL UNVERSIONED CARRIER. NOT RELEASED OR APPLIED. Native verification owed.
BEGIN;
DO $original_guard$
DECLARE expected record; f record; target oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.record_paige_memory(text,text,uuid,jsonb,boolean,text,uuid,uuid)',
   ARRAY['2ca751faa9d87bc6c4a586fd607847d0','11f56fb9590bbb1d7fec074f2fb3c67e'],
   'uuid','v',false,6,'NULL::uuid, ''{}''::jsonb, false, ''proposed''::text, NULL::uuid, NULL::uuid'),
  ('public.get_paige_memory(text[],integer,uuid,uuid)',
   ARRAY['6f0ecfc77ce855160db184e6770000f4','6f815ab77dac205aa2fef761716f8e30'],
   'record','s',true,4,'NULL::text[], 50, NULL::uuid, NULL::uuid'),
  ('public.forget_paige_memory(uuid,uuid,uuid)',
   ARRAY['f145788514336a0ae4e48aa950c82b55'],
   'boolean','v',false,2,'NULL::uuid, NULL::uuid')
 ) v(signature,body_hashes,return_type,volatility,returns_set,defaults_count,defaults_text) LOOP
  target:=to_regprocedure(expected.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'PAIGE_MEMORY_SOURCE_DRIFT'; END IF;
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
  IF NOT(md5(f.prosrc)=ANY(expected.body_hashes)) OR f.proowner<>current_user::regrole
   OR f.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR f.prokind<>'f' OR f.prorettype<>expected.return_type::regtype
   OR f.provolatile::text<>expected.volatility OR f.proretset IS DISTINCT FROM expected.returns_set
   OR f.pronargdefaults<>expected.defaults_count
   OR pg_get_expr(f.proargdefaults,0) IS DISTINCT FROM expected.defaults_text
   OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof OR NOT f.prosecdef
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR has_function_privilege('anon',f.oid,'EXECUTE')
   OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
   OR NOT has_function_privilege('service_role',f.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR a.grantee NOT IN (f.proowner,'authenticated'::regrole::oid,'service_role'::regrole::oid)
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'PAIGE_MEMORY_SOURCE_DRIFT';
  END IF;
 END LOOP;
END $original_guard$;
CREATE OR REPLACE FUNCTION public.get_paige_memory(
  p_memory_types text[] DEFAULT NULL,   -- optional audience/kind filter; NULL = all active
  p_limit        integer DEFAULT 50,
  p_user_id      uuid    DEFAULT NULL,   -- honored ONLY for service_role
  p_tenant_id    uuid    DEFAULT NULL    -- honored ONLY for service_role
)
RETURNS TABLE(id uuid, memory_type text, content text, source_thread_id uuid, metadata jsonb, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean := auth.role() = 'service_role';
  v_uid    uuid;
  v_tenant uuid;
BEGIN
  IF v_is_service THEN
    v_uid := p_user_id;
    v_tenant := p_tenant_id;
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'PAIGE_MEMORY_SERVICE_USER_REQUIRED' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'PAIGE_MEMORY_UNAUTHENTICATED' USING ERRCODE = '42501';
    END IF;
    v_tenant := public.current_user_tenant_id();
    IF v_tenant IS NULL AND NOT public.is_platform_owner() THEN
      RAISE EXCEPTION 'PAIGE_MEMORY_NO_WORKSPACE' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT m.id, m.memory_type, m.content, m.source_thread_id, m.metadata, m.created_at, m.updated_at
  FROM public.paige_owner_memory m
  WHERE m.is_active = true
    AND m.user_id = v_uid
    AND m.tenant_id IS NOT DISTINCT FROM v_tenant
    AND (p_memory_types IS NULL OR m.memory_type = ANY(p_memory_types))
  AND (
    NOT (m.metadata ? 'reviewed_save')
    OR (
      (SELECT public.knowledge_actor_authorized(v_uid,v_tenant))
      AND m.metadata#>'{reviewed_save,schema_version}'='1'::jsonb
      AND m.metadata#>>'{reviewed_save,expected_actor}'=v_uid::text
      AND m.metadata#>>'{reviewed_save,expected_tenant}'=v_tenant::text
      AND m.metadata#>'{reviewed_save,source_reference,contractVersion}'='1'::jsonb
      AND m.metadata#>>'{reviewed_save,source_reference,tenantId}'=v_tenant::text
      AND EXISTS (
        SELECT 1 FROM public.tenant_knowledge_docs d
        WHERE d.tenant_id=v_tenant AND d.record_state='canonical'
          AND d.id=CASE WHEN (m.metadata#>>'{reviewed_save,source_reference,documentId}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (m.metadata#>>'{reviewed_save,source_reference,documentId}')::uuid ELSE NULL::uuid END
          AND d.revision::text=m.metadata#>>'{reviewed_save,source_reference,revision}'
          AND encode(sha256(convert_to(d.content,'UTF8')),'hex')=m.metadata#>>'{reviewed_save,source_reference,contentSha256}'
          AND char_length(m.metadata#>>'{reviewed_save,source_quote}') BETWEEN 1 AND 2000
          AND strpos(d.content,m.metadata#>>'{reviewed_save,source_quote}')>0
      )
    )
  )
  ORDER BY m.created_at DESC
  LIMIT GREATEST(1, LEAST(200, COALESCE(p_limit, 50)));
END;
$function$;
-- LOCAL, unversioned original Memory producer candidate. Not a migration or
-- release. Existing per-user rows and original eight-argument insert are reused.
DO $reviewed_guard$
DECLARE f record; target oid;
BEGIN
 target:=to_regprocedure('public.record_paige_memory(text,text,uuid,jsonb,boolean,text,uuid,uuid,jsonb)');
 IF target IS NOT NULL THEN
  SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
  IF md5(f.prosrc)<>'ccdb8e22f84d12777787c411c1159dc1'
   OR f.proowner<>current_user::regrole OR f.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname='plpgsql')
   OR f.prokind<>'f' OR f.prorettype<>'uuid'::regtype OR f.proretset OR f.pronargdefaults<>0
   OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof
   OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('service_role',f.oid,'EXECUTE')
   OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
     OR a.grantee NOT IN (f.proowner,'authenticated'::regrole::oid)
     OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
   RAISE EXCEPTION 'PAIGE_MEMORY_SOURCE_DRIFT';
  END IF;
 END IF;
END $reviewed_guard$;
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

-- LOCAL unversioned extension of the original get/forget producer. No new store.
DO $lifecycle_guard$
DECLARE expected record; f record; target oid;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.get_paige_memory(text[],integer,uuid,uuid,jsonb)','0ac860f25b1a2548cefc12107d95bb6b'),
  ('public.forget_paige_memory(uuid,uuid,uuid,jsonb)','91c3334e44331e1b5f3663a2fa25d416')
 ) v(signature,body_hash) LOOP
  target:=to_regprocedure(expected.signature);
  IF target IS NOT NULL THEN
   SELECT * INTO STRICT f FROM pg_proc WHERE oid=target;
   IF md5(f.prosrc)<>expected.body_hash
    OR f.proowner<>current_user::regrole OR f.prolang IS DISTINCT FROM (SELECT oid FROM pg_language WHERE lanname='plpgsql')
    OR f.prokind<>'f' OR f.prorettype<>'jsonb'::regtype OR f.proretset OR f.pronargdefaults<>0
    OR f.provolatile<>'v' OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof
    OR NOT f.prosecdef OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('service_role',f.oid,'EXECUTE')
    OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
    OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
     WHERE a.privilege_type<>'EXECUTE' OR a.grantor<>f.proowner
      OR a.grantee NOT IN (f.proowner,'authenticated'::regrole::oid)
      OR (a.grantee<>f.proowner AND a.is_grantable)) THEN
    RAISE EXCEPTION 'PAIGE_MEMORY_SOURCE_DRIFT';
   END IF;
  END IF;
 END LOOP;
END $lifecycle_guard$;
CREATE OR REPLACE FUNCTION public.get_paige_memory(
 p_memory_types text[],p_limit integer,p_user_id uuid,p_tenant_id uuid,p_review jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $read$
DECLARE
 actor uuid:=auth.uid(); tenant uuid; current_tenant uuid; memory_id uuid; intent uuid;
 item public.paige_owner_memory; matches integer; ref jsonb; source jsonb; doc jsonb;
 source_state text:='not_bound'; metadata jsonb; eligible boolean;
BEGIN
 IF actor IS NULL OR auth.role()='service_role' THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_CALLER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_memory_types IS NOT NULL OR p_limit IS DISTINCT FROM 1 OR p_review IS NULL OR jsonb_typeof(p_review)<>'object'
  OR NOT(p_review ?& ARRAY['schema_version','expected_actor','expected_tenant']) OR p_review->'schema_version'<>'1'::jsonb
  OR (p_review ? 'memory_id')=(p_review ? 'intent_id')
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_review) k WHERE k NOT IN ('schema_version','expected_actor','expected_tenant','memory_id','intent_id')) THEN
  RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INVALID' USING ERRCODE='22023';
 END IF;
 BEGIN
  tenant:=(p_review->>'expected_tenant')::uuid;
  IF actor IS DISTINCT FROM (p_review->>'expected_actor')::uuid OR tenant IS NULL THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
  IF p_review ? 'memory_id' THEN memory_id:=(p_review->>'memory_id')::uuid; ELSE intent:=(p_review->>'intent_id')::uuid; END IF;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INVALID' USING ERRCODE='22023'; END;
 IF memory_id IS NULL AND intent IS NULL THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
 IF (p_user_id IS NOT NULL AND p_user_id<>actor) OR (p_tenant_id IS NOT NULL AND p_tenant_id<>tenant) THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 SELECT active_tenant_id INTO current_tenant FROM public.profiles WHERE user_id=actor FOR SHARE;
 IF current_tenant IS DISTINCT FROM tenant THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM auth.users u WHERE u.id=actor AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_ACTOR_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenant_members m WHERE m.tenant_id=tenant AND m.user_id=actor FOR SHARE;
 IF NOT(coalesce(public.is_tenant_member(tenant),false) OR coalesce(public.is_platform_owner(),false)) THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF intent IS NOT NULL THEN
  -- Wait on the SAME original save intent before declaring committed absence.
  PERFORM pg_advisory_xact_lock(hashtextextended('paige_memory_review:'||tenant::text||':'||actor::text||':'||intent::text,0));
  SELECT count(*) INTO matches FROM public.paige_owner_memory m WHERE m.tenant_id=tenant AND m.user_id=actor AND lower(m.metadata#>>'{reviewed_save,intent_id}')=intent::text;
  IF matches>1 THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INTENT_CONFLICT' USING ERRCODE='40001'; END IF;
 END IF;
 SELECT * INTO item FROM public.paige_owner_memory m WHERE m.tenant_id=tenant AND m.user_id=actor
  AND ((memory_id IS NOT NULL AND m.id=memory_id) OR (intent IS NOT NULL AND lower(m.metadata#>>'{reviewed_save,intent_id}')=intent::text));
 IF NOT FOUND THEN RETURN jsonb_build_object('status','absent','tenant_id',tenant,'eligible_for_context',false); END IF;
 metadata:=item.metadata;
 IF metadata ? 'reviewed_save' THEN
  source_state:='unavailable'; ref:=metadata#>'{reviewed_save,source_reference}';
  BEGIN
   IF jsonb_typeof(ref)='object' AND ref->>'tenantId'=tenant::text AND ref->'contractVersion'='1'::jsonb THEN
    source:=public.read_tenant_knowledge(tenant,(ref->>'documentId')::uuid,1,0);
    IF jsonb_array_length(source->'documents')=1 THEN
     doc:=source->'documents'->0;
     source_state:=CASE WHEN doc->>'id'=ref->>'documentId' AND doc->>'tenant_id'=tenant::text AND doc->>'revision'=ref->>'revision'
      AND encode(sha256(convert_to(doc->>'content','UTF8')),'hex')=ref->>'contentSha256' THEN 'current' ELSE 'changed' END;
    END IF;
   END IF;
  EXCEPTION WHEN OTHERS THEN source_state:='unavailable'; END;
  -- Source revocation never turns the stored quote into renewed source access.
  IF source_state<>'current' THEN metadata:=metadata#-'{reviewed_save,source_quote}'; END IF;
 END IF;
 IF NOT item.is_active THEN
  metadata:=jsonb_build_object('confirmation_state','retired');
 END IF;
 eligible:=item.is_active AND item.metadata->>'confirmation_state'='confirmed' AND source_state IN ('current','not_bound');
 RETURN jsonb_build_object('status',CASE WHEN item.is_active THEN 'present' ELSE 'retired' END,'tenant_id',tenant,
  'source_state',source_state,'eligible_for_context',coalesce(eligible,false),'memory',jsonb_build_object(
   'id',item.id,'memory_type',item.memory_type,'content',CASE WHEN item.is_active THEN item.content ELSE NULL END,'source_thread_id',item.source_thread_id,
   'metadata',metadata,'created_at',item.created_at,'updated_at',item.updated_at,'is_active',item.is_active));
END $read$;
REVOKE ALL ON FUNCTION public.get_paige_memory(text[],integer,uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_paige_memory(text[],integer,uuid,uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.forget_paige_memory(p_id uuid,p_user_id uuid,p_tenant_id uuid,p_review jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $forget$
DECLARE actor uuid:=auth.uid(); tenant uuid; target public.paige_owner_memory; inspected jsonb; expected_time timestamptz; forgotten boolean;
BEGIN
 IF p_review IS NULL OR jsonb_typeof(p_review)<>'object' OR NOT(p_review ? 'expected_updated_at') OR p_id IS NULL THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
 BEGIN
  IF (p_review->>'memory_id')::uuid IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INVALID' USING ERRCODE='22023'; END IF;
  expected_time:=(p_review->>'expected_updated_at')::timestamptz;
 EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_INVALID' USING ERRCODE='22023'; END;
 -- Original reader extension owns current actor/tenant/member admission. No
 -- source availability is required to remove one's own approved Memory.
 inspected:=public.get_paige_memory(NULL,1,p_user_id,p_tenant_id,p_review-'expected_updated_at');
 tenant:=(inspected->>'tenant_id')::uuid;
 SELECT * INTO target FROM public.paige_owner_memory m WHERE m.id=p_id AND m.tenant_id=tenant AND m.user_id=actor FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','absent','memory_id',p_id,'verified_readback',true,'replayed',false); END IF;
 IF NOT target.is_active THEN RETURN jsonb_build_object('status','retired','memory_id',p_id,'verified_readback',true,'replayed',false,'effect','already_retired'); END IF;
 IF expected_time IS NULL OR expected_time IS DISTINCT FROM target.updated_at THEN RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_TARGET_CHANGED' USING ERRCODE='40001'; END IF;
 forgotten:=public.forget_paige_memory(p_id,NULL,NULL);
 IF NOT forgotten OR EXISTS(SELECT 1 FROM public.paige_owner_memory m WHERE m.id=p_id AND m.tenant_id=tenant AND m.user_id=actor AND m.is_active) THEN
  RAISE EXCEPTION 'PAIGE_MEMORY_REVIEW_READBACK_MISMATCH' USING ERRCODE='55000';
 END IF;
 UPDATE public.paige_owner_memory SET updated_at=now() WHERE id=p_id AND tenant_id=tenant AND user_id=actor;
 RETURN jsonb_build_object('status','retired','memory_id',p_id,'verified_readback',true,'replayed',false,'effect','retired_now');
END $forget$;
REVOKE ALL ON FUNCTION public.forget_paige_memory(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.forget_paige_memory(uuid,uuid,uuid,jsonb) TO authenticated;

COMMIT;
