-- LOCAL unversioned extension of the original get/forget producer. No new store.
BEGIN;
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
