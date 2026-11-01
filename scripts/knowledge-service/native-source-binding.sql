-- LOCAL unversioned PRIVATE integration candidate. Original domain writers must
-- invoke this in THEIR transaction, then validate their own selected-fact receipt,
-- approval, current action authority and mutation/readback. Returned evidence is
-- neither a reusable authority token nor domain/Memory confirmation.
BEGIN;
CREATE FUNCTION public.lock_knowledge_source_evidence(
 p_actor uuid,p_tenant uuid,p_reference jsonb,p_excerpts jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $binding$
DECLARE
 source_id uuid; source public.tenant_knowledge_docs; permitted jsonb;
 excerpt jsonb; start_at integer; end_at integer; total_units integer:=0;
 reference jsonb; excerpts jsonb:='[]'::jsonb;
BEGIN
 IF p_actor IS NULL OR p_tenant IS NULL OR p_actor IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 IF p_reference IS NULL OR jsonb_typeof(p_reference) IS DISTINCT FROM 'object'
  OR p_excerpts IS NULL OR jsonb_typeof(p_excerpts) IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023';
 END IF;
 IF pg_column_size(p_reference)>4096 OR pg_column_size(p_excerpts)>65536
  OR jsonb_array_length(p_excerpts)>20
  OR NOT(p_reference ?& ARRAY['contractVersion','tenantId','documentId','revision','contentSha256'])
  OR (SELECT count(*) FROM jsonb_object_keys(p_reference))<>5
  OR p_reference->'contractVersion' IS DISTINCT FROM '1'::jsonb
  OR p_reference->>'tenantId' IS DISTINCT FROM p_tenant::text
  OR jsonb_typeof(p_reference->'documentId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(p_reference->'revision') IS DISTINCT FROM 'number'
  OR (p_reference->>'revision' COLLATE pg_catalog."C") !~ '^[1-9][0-9]{0,9}$'
  OR jsonb_typeof(p_reference->'contentSha256') IS DISTINCT FROM 'string'
  OR (p_reference->>'contentSha256' COLLATE pg_catalog."C") !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023';
 END IF;
 BEGIN source_id:=(p_reference->>'documentId')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023'; END;
 IF source_id IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
 -- Reuse the ORIGINAL identity/member/profile/tenant locks and visibility door.
 -- No service-role existence lookup, role taxonomy or replacement resolver.
 IF NOT public.lock_knowledge_extraction_authority(p_actor,p_tenant) THEN
  RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 permitted:=public.read_tenant_knowledge(p_tenant,source_id,1,0);
 IF permitted->>'tenant_id' IS DISTINCT FROM p_tenant::text
  OR jsonb_array_length(permitted->'documents') IS DISTINCT FROM 1 THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 SELECT * INTO source FROM public.tenant_knowledge_docs d
  WHERE d.id=source_id AND d.tenant_id=p_tenant AND d.record_state='canonical' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 reference:=jsonb_build_object('contractVersion',1,'tenantId',source.tenant_id,'documentId',source.id,
  'revision',source.revision,'contentSha256',encode(sha256(convert_to(source.content,'UTF8')),'hex'));
 IF source.revision::text IS DISTINCT FROM p_reference->>'revision'
  OR reference->>'contentSha256' IS DISTINCT FROM p_reference->>'contentSha256' THEN
  RAISE EXCEPTION 'KNOWLEDGE_SOURCE_CHANGED' USING ERRCODE='40001';
 END IF;
 FOR excerpt IN SELECT value FROM jsonb_array_elements(p_excerpts) LOOP
  IF jsonb_typeof(excerpt) IS DISTINCT FROM 'object' THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023';
  END IF;
  IF NOT(excerpt ?& ARRAY['start','end','text']) OR (SELECT count(*) FROM jsonb_object_keys(excerpt))<>3
   OR jsonb_typeof(excerpt->'start') IS DISTINCT FROM 'number' OR jsonb_typeof(excerpt->'end') IS DISTINCT FROM 'number'
   OR (excerpt->>'start' COLLATE pg_catalog."C") !~ '^[0-9]{1,6}$'
   OR (excerpt->>'end' COLLATE pg_catalog."C") !~ '^[0-9]{1,6}$'
   OR jsonb_typeof(excerpt->'text') IS DISTINCT FROM 'string' THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023';
  END IF;
  start_at:=(excerpt->>'start')::integer; end_at:=(excerpt->>'end')::integer;
  IF NOT public.knowledge_utf16_excerpt_matches(source.content,start_at,end_at,excerpt->>'text') THEN
   RAISE EXCEPTION 'KNOWLEDGE_SOURCE_QUOTE_CHANGED' USING ERRCODE='40001';
  END IF;
  total_units:=total_units+end_at-start_at;
  IF total_units>12000 THEN RAISE EXCEPTION 'KNOWLEDGE_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
  excerpts:=excerpts||jsonb_build_array(jsonb_build_object('start',start_at,'end',end_at,'text',excerpt->>'text'));
 END LOOP;
 RETURN jsonb_build_object('status','available','reference',reference,'title',source.title,'excerpts',excerpts,
  'factConfirmation','not_asserted','originalFileEvidence','unavailable');
END $binding$;
REVOKE ALL ON FUNCTION public.lock_knowledge_source_evidence(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
