-- Foundation only. No lifecycle writer is enabled by this migration.
-- Unknown is intentional: successful indexing cannot establish extraction coverage.
CREATE OR REPLACE FUNCTION public.knowledge_source_binding_valid(v jsonb,t uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 IF v IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(v)<>'object' OR NOT v ?& ARRAY['bucket','object_id','object_name','sha256','byte_size','mime_type','bound_at']
    OR v - ARRAY['bucket','object_id','object_name','sha256','byte_size','mime_type','bound_at'] <> '{}'::jsonb THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(v) x WHERE x.key<>'byte_size' AND jsonb_typeof(x.value)<>'string') THEN RETURN false; END IF;
 RETURN coalesce(v->>'bucket'='tenant-knowledge'
  AND (v->>'object_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND length(v->>'object_name') BETWEEN 38 AND 1024
  AND left(v->>'object_name',37)=t::text||'/'
  AND (v->>'object_name') !~ '(^|/)\.\.?(/|$)|\\|%|//'
  AND (v->>'sha256') ~ '^[0-9a-f]{64}$'
  AND jsonb_typeof(v->'byte_size')='number' AND (v->>'byte_size') ~ '^[0-9]+$'
  AND (v->>'byte_size')::numeric BETWEEN 1 AND 26214400
  AND length(v->>'mime_type') BETWEEN 1 AND 255
  AND (v->>'bound_at') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$' AND (v->>'bound_at')::timestamptz IS NOT NULL,false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE OR REPLACE FUNCTION public.knowledge_pending_review_valid(v jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF v IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(v)<>'object' OR NOT v ?& ARRAY['schema_version','extracted_content','reviewed_content','extraction_version','coverage']
    OR v - ARRAY['schema_version','extracted_content','reviewed_content','extraction_version','coverage'] <> '{}'::jsonb THEN RETURN false; END IF;
 RETURN coalesce(v->'schema_version'='1'::jsonb
  AND jsonb_typeof(v->'extracted_content')='string' AND length(v->>'extracted_content') BETWEEN 1 AND 480000
  AND jsonb_typeof(v->'reviewed_content') IN ('string','null')
  AND (v->'reviewed_content'='null'::jsonb OR length(v->>'reviewed_content') BETWEEN 1 AND 480000)
  AND jsonb_typeof(v->'extraction_version')='string' AND length(v->>'extraction_version') BETWEEN 1 AND 100
  AND jsonb_typeof(v->'coverage')='string' AND v->>'coverage' IN ('complete','partial','unknown')
  AND octet_length(v::text)<=4000000,false);
END $$;
ALTER TABLE public.tenant_knowledge_docs
 ADD COLUMN IF NOT EXISTS record_state text NOT NULL DEFAULT 'canonical',
 ADD COLUMN IF NOT EXISTS source_coverage text NOT NULL DEFAULT 'unknown',
 ADD COLUMN IF NOT EXISTS source_binding jsonb,
 ADD COLUMN IF NOT EXISTS pending_review jsonb;
ALTER TABLE public.tenant_knowledge_docs DROP CONSTRAINT IF EXISTS knowledge_lifecycle_shape;
ALTER TABLE public.tenant_knowledge_docs ADD CONSTRAINT knowledge_lifecycle_shape CHECK (
 record_state IN ('canonical','draft') AND source_coverage IN ('unknown','partial','complete')
 AND public.knowledge_source_binding_valid(source_binding,tenant_id)
 AND public.knowledge_pending_review_valid(pending_review)
 AND (record_state<>'draft' OR (content='' AND chunk_count=0 AND share_to_network=false AND network_review_status='none')));
-- An unconditional, fail-closed activation barrier, including service-role writers.
-- A later reviewed migration must replace this after adopting ALL privileged consumers.
-- No session setting, JWT claim or caller flag bypasses this barrier.
CREATE OR REPLACE FUNCTION public.freeze_knowledge_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.record_state<>'canonical' OR NEW.source_coverage<>'unknown' OR NEW.source_binding IS NOT NULL OR NEW.pending_review IS NOT NULL THEN
   RAISE EXCEPTION 'KNOWLEDGE_LIFECYCLE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
 ELSIF ROW(NEW.record_state,NEW.source_coverage,NEW.source_binding,NEW.pending_review)
     IS DISTINCT FROM ROW(OLD.record_state,OLD.source_coverage,OLD.source_binding,OLD.pending_review) THEN
  RAISE EXCEPTION 'KNOWLEDGE_LIFECYCLE_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS knowledge_lifecycle_frozen ON public.tenant_knowledge_docs;
CREATE TRIGGER knowledge_lifecycle_frozen BEFORE INSERT OR UPDATE ON public.tenant_knowledge_docs
 FOR EACH ROW EXECUTE FUNCTION public.freeze_knowledge_lifecycle();
REVOKE ALL ON FUNCTION public.freeze_knowledge_lifecycle() FROM PUBLIC,anon,authenticated,service_role;

-- Existing explicit column consumers retain every legacy SELECT privilege. New
-- internal columns are deliberately excluded; table-level SELECT would override this.
REVOKE SELECT ON public.tenant_knowledge_docs FROM authenticated;
GRANT SELECT (id,tenant_id,title,content,summary,category,tags,source,source_url,
 share_to_network,network_review_status,network_reviewed_at,network_reviewed_by,
 promoted_to_canon_id,token_count,chunk_count,created_by,created_at,updated_at,revision)
 ON public.tenant_knowledge_docs TO authenticated;
DROP POLICY IF EXISTS knowledge_canonical_read ON public.tenant_knowledge_docs;
CREATE POLICY knowledge_canonical_read ON public.tenant_knowledge_docs AS RESTRICTIVE
 FOR SELECT TO authenticated USING (record_state='canonical');
DROP POLICY IF EXISTS knowledge_canonical_chunk_read ON public.tenant_knowledge_chunks;
CREATE POLICY knowledge_canonical_chunk_read ON public.tenant_knowledge_chunks AS RESTRICTIVE
 FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.tenant_knowledge_docs d
 WHERE d.id=doc_id AND d.tenant_id=tenant_knowledge_chunks.tenant_id));

CREATE OR REPLACE FUNCTION public.knowledge_public_document(d public.tenant_knowledge_docs,include_content boolean)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',d.id,'tenant_id',d.tenant_id,'title',d.title,'summary',d.summary,
 'category',d.category,'tags',d.tags,'source',d.source,'source_url',d.source_url,
 'share_to_network',d.share_to_network,'network_review_status',d.network_review_status,
 'network_reviewed_at',d.network_reviewed_at,'network_reviewed_by',d.network_reviewed_by,
 'promoted_to_canon_id',d.promoted_to_canon_id,'token_count',d.token_count,'chunk_count',d.chunk_count,
 'created_by',d.created_by,'created_at',d.created_at,'updated_at',d.updated_at,'revision',d.revision)
 || CASE WHEN include_content THEN jsonb_build_object('content',d.content) ELSE '{}'::jsonb END
$$;
REVOKE ALL ON FUNCTION public.knowledge_public_document(public.tenant_knowledge_docs,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.read_tenant_knowledge(
  p_expected_tenant uuid, p_doc_id uuid DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_tenant uuid; v_docs jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  SELECT active_tenant_id INTO v_tenant FROM public.profiles WHERE user_id=v_actor FOR SHARE;
  IF v_tenant IS NULL OR p_expected_tenant IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
  END IF;
  IF NOT (COALESCE(public.is_platform_owner(),false) OR COALESCE(public.is_tenant_member(v_tenant),false)) THEN
    RAISE EXCEPTION 'KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'KNOWLEDGE_PAGE_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT COALESCE(jsonb_agg(x.doc ORDER BY x.created_at DESC, x.id), '[]'::jsonb) INTO v_docs FROM (
    SELECT d.id, d.created_at, public.knowledge_public_document(d,p_doc_id IS NOT NULL) AS doc
    FROM public.tenant_knowledge_docs d WHERE d.tenant_id=v_tenant AND d.record_state='canonical' AND (p_doc_id IS NULL OR d.id=p_doc_id)
    ORDER BY d.created_at DESC, d.id LIMIT p_limit OFFSET p_offset
  ) x;
  RETURN jsonb_build_object('tenant_id',v_tenant,'documents',v_docs);
END $$;
REVOKE ALL ON FUNCTION public.read_tenant_knowledge(uuid,uuid,integer,integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.read_tenant_knowledge(uuid,uuid,integer,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_knowledge_metadata(
  p_expected_tenant uuid, p_doc_id uuid, p_expected_revision integer, p_patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid(); v_tenant uuid; v_doc public.tenant_knowledge_docs;
  v_run uuid; v_outcome text := 'capability_succeeded';
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  SELECT active_tenant_id INTO v_tenant FROM public.profiles WHERE user_id=v_actor FOR SHARE;
  IF v_tenant IS NULL OR p_expected_tenant IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
  END IF;
  IF NOT (COALESCE(public.is_platform_owner(),false) OR COALESCE(public.is_tenant_member(v_tenant),false)) THEN
    RAISE EXCEPTION 'KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch='{}'::jsonb THEN
    RAISE EXCEPTION 'KNOWLEDGE_PATCH_INVALID' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('title','summary','category','tags')) THEN
    RAISE EXCEPTION 'KNOWLEDGE_PATCH_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_patch ? 'title' AND (jsonb_typeof(p_patch->'title') <> 'string' OR length(btrim(p_patch->>'title')) NOT BETWEEN 1 AND 300) THEN
    RAISE EXCEPTION 'KNOWLEDGE_PATCH_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_patch ? 'summary' AND (jsonb_typeof(p_patch->'summary') NOT IN ('string','null') OR length(p_patch->>'summary') > 2000) THEN
    RAISE EXCEPTION 'KNOWLEDGE_PATCH_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_patch ? 'category' AND (jsonb_typeof(p_patch->'category') NOT IN ('string','null') OR length(p_patch->>'category') > 100) THEN
    RAISE EXCEPTION 'KNOWLEDGE_PATCH_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_patch ? 'tags' THEN
    IF jsonb_typeof(p_patch->'tags') <> 'array' THEN RAISE EXCEPTION 'KNOWLEDGE_PATCH_INVALID' USING ERRCODE='22023'; END IF;
    IF jsonb_array_length(p_patch->'tags') > 20 OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_patch->'tags') t WHERE jsonb_typeof(t) <> 'string' OR length(t#>>'{}') > 60
    ) THEN RAISE EXCEPTION 'KNOWLEDGE_PATCH_INVALID' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT * INTO v_doc FROM public.tenant_knowledge_docs WHERE tenant_id=v_tenant AND id=p_doc_id FOR UPDATE;
  IF NOT FOUND OR v_doc.record_state<>'canonical' THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR v_doc.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001';
  END IF;
  UPDATE public.tenant_knowledge_docs SET
    title=CASE WHEN p_patch ? 'title' THEN btrim(p_patch->>'title') ELSE title END,
    summary=CASE WHEN p_patch ? 'summary' THEN p_patch->>'summary' ELSE summary END,
    category=CASE WHEN p_patch ? 'category' THEN p_patch->>'category' ELSE category END,
    tags=CASE WHEN p_patch ? 'tags' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'tags')) ELSE tags END
  WHERE tenant_id=v_tenant AND id=p_doc_id AND revision=p_expected_revision RETURNING * INTO v_doc;
  IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
  -- One committed revision identifies one operation. No raw content enters the receipt.
  v_run := md5('knowledge_update:'||v_tenant::text||':'||p_doc_id::text||':'||v_doc.revision::text)::uuid;
  BEGIN
    PERFORM public.record_capability_run(v_tenant,v_actor,'knowledge_update','capability_succeeded',v_run,
      NULL::text,NULL::text,NULL::uuid,NULL::text,
      jsonb_build_object('document_id',p_doc_id,'revision',v_doc.revision,'operation','metadata_update'));
  EXCEPTION WHEN OTHERS THEN
    v_outcome := 'capability_completed_unrecorded';
  END;
  RETURN jsonb_build_object('tenant_id',v_tenant,'document',public.knowledge_public_document(v_doc,false),'outcome',v_outcome,'run_id',v_run);
END $$;
REVOKE ALL ON FUNCTION public.update_tenant_knowledge_metadata(uuid,uuid,integer,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_tenant_knowledge_metadata(uuid,uuid,integer,jsonb) TO authenticated;

-- Read only: the selected workspace and existing tenant predicates remain authority.
CREATE OR REPLACE FUNCTION public.read_tenant_knowledge_review(p_expected_tenant uuid,p_doc_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_tenant uuid; v_doc public.tenant_knowledge_docs;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
 SELECT active_tenant_id INTO v_tenant FROM public.profiles WHERE user_id=v_actor FOR SHARE;
 IF v_tenant IS NULL OR p_expected_tenant IS DISTINCT FROM v_tenant THEN
  RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
 IF NOT (coalesce(public.is_platform_owner(),false) OR coalesce(public.is_tenant_member(v_tenant),false)) THEN
  RAISE EXCEPTION 'KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_doc FROM public.tenant_knowledge_docs WHERE tenant_id=v_tenant AND id=p_doc_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('tenant_id',v_tenant,'document_id',v_doc.id,'revision',v_doc.revision,
  'record_state',v_doc.record_state,'source_coverage',v_doc.source_coverage,
  'source_binding',v_doc.source_binding,'pending_review',v_doc.pending_review);
END $$;
REVOKE ALL ON FUNCTION public.read_tenant_knowledge_review(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_tenant_knowledge_review(uuid,uuid) TO authenticated;

-- Preserve established search authority; filter drafts even for definer/service callers.
CREATE OR REPLACE FUNCTION public.match_tenant_knowledge(
  p_tenant_id uuid,
  p_query_embedding extensions.vector,
  p_match_count integer DEFAULT 6
)
 RETURNS TABLE(source_tier text, doc_id uuid, chunk_id uuid, title text, content text, similarity double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- §9: a JWT caller may only search their own tenant; service-role (edge fn) is pre-scoped.
  IF auth.uid() IS NOT NULL
     AND p_tenant_id IS DISTINCT FROM public.current_user_tenant_id()
     AND NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'KB_FORBIDDEN: cross-tenant knowledge search denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    'tenant'::text                                 AS source_tier,
    c.doc_id                                        AS doc_id,
    c.id                                            AS chunk_id,
    d.title                                         AS title,
    c.content                                       AS content,
    1 - (c.embedding <=> p_query_embedding)::float  AS similarity
  FROM public.tenant_knowledge_chunks c
  JOIN public.tenant_knowledge_docs d ON d.id = c.doc_id
  WHERE c.tenant_id = p_tenant_id
    AND d.tenant_id = c.tenant_id
    AND d.record_state = 'canonical'
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
END
$function$;

REVOKE ALL ON FUNCTION public.match_tenant_knowledge(uuid,extensions.vector,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_tenant_knowledge(uuid,extensions.vector,integer) TO authenticated,service_role;
