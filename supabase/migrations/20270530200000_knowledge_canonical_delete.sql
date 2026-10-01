-- Canonical deletion only. Uploaded source objects are not bound to these rows.
CREATE OR REPLACE FUNCTION public.delete_tenant_knowledge(
  p_expected_tenant uuid, p_doc_id uuid, p_expected_revision integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_doc public.tenant_knowledge_docs;
  v_child_tenant uuid;
  v_deleted uuid;
  v_run uuid;
  v_outcome text := 'capability_succeeded';
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'KNOWLEDGE_UNAUTHENTICATED' USING ERRCODE='42501'; END IF;
  SELECT active_tenant_id INTO v_tenant FROM public.profiles WHERE user_id=v_actor FOR SHARE;
  IF v_tenant IS NULL OR p_expected_tenant IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
  END IF;
  IF NOT (COALESCE(public.is_platform_owner(),false) OR COALESCE(public.is_tenant_member(v_tenant),false)) THEN
    RAISE EXCEPTION 'KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_doc FROM public.tenant_knowledge_docs WHERE tenant_id=v_tenant AND id=p_doc_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 1 OR v_doc.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'KNOWLEDGE_REVISION_CONFLICT' USING ERRCODE='40001';
  END IF;
  -- Parent FOR UPDATE blocks new FK references. Lock children before checking their
  -- tenant: the existing FK covers doc_id only, so a cascade alone is insufficient.
  FOR v_child_tenant IN
    SELECT tenant_id FROM public.tenant_knowledge_chunks WHERE doc_id=p_doc_id ORDER BY id FOR UPDATE
  LOOP
    IF v_child_tenant IS DISTINCT FROM v_tenant THEN
      RAISE EXCEPTION 'KNOWLEDGE_CHILD_SCOPE_INVALID' USING ERRCODE='42501';
    END IF;
  END LOOP;
  DELETE FROM public.tenant_knowledge_docs
  WHERE tenant_id=v_tenant AND id=p_doc_id AND revision=p_expected_revision RETURNING id INTO v_deleted;
  IF NOT FOUND THEN RAISE EXCEPTION 'KNOWLEDGE_DELETE_NOT_VERIFIED' USING ERRCODE='P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_knowledge_docs WHERE id=p_doc_id)
     OR EXISTS (SELECT 1 FROM public.tenant_knowledge_chunks WHERE doc_id=p_doc_id) THEN
    RAISE EXCEPTION 'KNOWLEDGE_DELETE_NOT_VERIFIED' USING ERRCODE='P0001';
  END IF;
  v_run := md5('knowledge_delete:'||v_tenant::text||':'||p_doc_id::text||':'||v_doc.revision::text)::uuid;
  BEGIN
    PERFORM public.record_capability_run(v_tenant,v_actor,'knowledge_delete','capability_succeeded',v_run,
      NULL::text,NULL::text,NULL::uuid,NULL::text,
      jsonb_build_object('document_id',p_doc_id,'revision',v_doc.revision,
        'operation','document_delete','source_cleanup','not_attempted'));
  EXCEPTION WHEN OTHERS THEN
    v_outcome := 'capability_completed_unrecorded';
  END;
  RETURN jsonb_build_object('tenant_id',v_tenant,'document_id',p_doc_id,'deleted_revision',v_doc.revision,
    'document_absent',true,'chunks_absent',true,'outcome',v_outcome,'run_id',v_run,
    'source_cleanup',jsonb_build_object('status','not_attempted','reason','canonical_source_binding_unavailable'));
END $$;
REVOKE ALL ON FUNCTION public.delete_tenant_knowledge(uuid,uuid,integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_tenant_knowledge(uuid,uuid,integer) TO authenticated;
