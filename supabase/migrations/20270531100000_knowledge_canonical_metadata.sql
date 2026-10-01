-- Native Knowledge seam. No Chat binding/authority or new Knowledge store.
ALTER TABLE public.tenant_knowledge_docs ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

CREATE OR REPLACE FUNCTION public.advance_knowledge_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS knowledge_revision ON public.tenant_knowledge_docs;
CREATE TRIGGER knowledge_revision BEFORE UPDATE ON public.tenant_knowledge_docs
FOR EACH ROW EXECUTE FUNCTION public.advance_knowledge_revision();
REVOKE ALL ON FUNCTION public.advance_knowledge_revision() FROM PUBLIC, anon, authenticated;

-- Expected workspace is a stale-tab precondition, never identity or authority.
-- Definer is needed to lock the caller profile and use the existing service-only receipt seam.
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
    SELECT d.id, d.created_at, CASE WHEN p_doc_id IS NULL THEN to_jsonb(d)-'content' ELSE to_jsonb(d) END AS doc
    FROM public.tenant_knowledge_docs d WHERE d.tenant_id=v_tenant AND (p_doc_id IS NULL OR d.id=p_doc_id)
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
  IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
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
  RETURN jsonb_build_object('tenant_id',v_tenant,'document',to_jsonb(v_doc)-'content','outcome',v_outcome,'run_id',v_run);
END $$;
REVOKE ALL ON FUNCTION public.update_tenant_knowledge_metadata(uuid,uuid,integer,jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_tenant_knowledge_metadata(uuid,uuid,integer,jsonb) TO authenticated;
