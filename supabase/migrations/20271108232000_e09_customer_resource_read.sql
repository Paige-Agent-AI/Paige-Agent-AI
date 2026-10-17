-- Full text paging over the same explicit canonical Knowledge grants.
-- No copied content, public URL, model execution or engagement assertion.
BEGIN;
DO $reader_lease$
DECLARE p pg_proc;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public.client_portal_knowledge_context(uuid,jsonb,integer,integer,boolean)');
 IF p.prosrc IS NULL OR md5(p.prosrc)<>'13a90bbbf1cfbd20c944c7a116e7f418'
  OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'s'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
  RAISE EXCEPTION 'Customer resource authority changed; review before composition' USING ERRCODE='42501';
 END IF;
END $reader_lease$;

CREATE FUNCTION public.client_portal_knowledge_document(
 p_tenant_id uuid,p_share_id uuid,p_share_revision integer,p_source_fingerprint text,
 p_offset integer DEFAULT 0,p_limit integer DEFAULT 12000)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE context jsonb; source jsonb; d public.tenant_knowledge_docs; piece text; total integer; next_offset integer;
BEGIN
 IF p_tenant_id IS NULL OR p_share_id IS NULL OR p_share_revision IS NULL OR p_share_revision<=0
  OR p_source_fingerprint IS NULL OR p_source_fingerprint !~ '^[a-f0-9]{64}$'
  OR p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>12000 THEN
  RAISE EXCEPTION 'CUSTOMER_RESOURCE_ARGUMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 -- This actual caller-JWT authority owns relationship, tenant, source and Auth
 -- health. A staff workspace pointer or known document ID never substitutes.
 context:=public.client_portal_knowledge_context(p_tenant_id,jsonb_build_array(jsonb_build_object(
  'share_id',p_share_id,'share_revision',p_share_revision,'source_fingerprint',p_source_fingerprint)),1,0,false);
 IF jsonb_array_length(context->'sources')<>1 THEN
  RAISE EXCEPTION 'CUSTOMER_RESOURCE_SOURCE_WITHDRAWN' USING ERRCODE='42501';
 END IF;
 source:=context#>'{sources,0}';
 SELECT * INTO d FROM public.tenant_knowledge_docs
  WHERE id=(source->>'document_id')::uuid AND tenant_id=p_tenant_id;
 IF NOT FOUND OR d.content IS NULL OR d.record_state<>'canonical' OR d.revision IS DISTINCT FROM (source->>'document_revision')::integer
  OR public._client_knowledge_source(d)->>'source_fingerprint' IS DISTINCT FROM p_source_fingerprint THEN
  RAISE EXCEPTION 'CUSTOMER_RESOURCE_SOURCE_WITHDRAWN' USING ERRCODE='42501';
 END IF;
 total:=char_length(d.content);
 IF p_offset>total THEN RAISE EXCEPTION 'CUSTOMER_RESOURCE_RANGE_INVALID' USING ERRCODE='22023'; END IF;
 piece:=substring(d.content FROM p_offset+1 FOR p_limit); next_offset:=p_offset+char_length(piece);
 RETURN jsonb_build_object('actor_id',context->'actor_id','contact_id',context->'contact_id','tenant_id',context->'tenant_id',
  'source_ref',jsonb_build_object('share_id',p_share_id,'share_revision',p_share_revision,'source_fingerprint',p_source_fingerprint),
  'document',jsonb_build_object('id',d.id,'revision',d.revision,'generation_id',d.active_generation_id,'title',left(d.title,300)),
  'content',piece,'offset',p_offset,'next_offset',next_offset,'total_characters',total,'has_more',next_offset<total);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_knowledge_document(uuid,uuid,integer,text,integer,integer)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_knowledge_document(uuid,uuid,integer,text,integer,integer) TO authenticated;
COMMIT;
