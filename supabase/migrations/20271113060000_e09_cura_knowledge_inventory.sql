-- Teach CURA: an owner-safe inventory over the existing Knowledge/share records.
-- Read only. This does not publish, prepare, embed, share, withdraw or create a
-- receipt. Customer access still resolves through the original relationship and
-- current-source predicates. A business share is not evidence of a client visit.
BEGIN;

DO $source_lease$
DECLARE expected record; actual record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public._client_knowledge_business_publisher(uuid)','75e906ec37604c0ab71d92f8070a1cdd'),
  ('public._tenant_brand_manager_member(uuid)','00278372f844f7bee53a2d5a69ca3df9'),
  ('public._knowledge_doc_is_finance(public.tenant_knowledge_docs)','5f7d223b7a96dbf8e96a2564ceee9ad3'),
  ('public._tenant_finance_entitled(uuid)','82150f6b9e86214afa522d629fed0deb'),
  ('public._client_knowledge_source(public.tenant_knowledge_docs)','c65c3ac5988f156e2c7fbe3cf8a8786f')
 ) e(signature,body_md5) LOOP
  SELECT md5(prosrc) body_md5,proowner INTO actual FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF actual.body_md5 IS DISTINCT FROM expected.body_md5
   OR pg_get_userbyid(actual.proowner) IS DISTINCT FROM 'postgres' THEN
   RAISE EXCEPTION 'CURA Knowledge inventory dependency changed (%); review before composition',expected.signature USING ERRCODE='42501';
  END IF;
 END LOOP;
END $source_lease$;

CREATE FUNCTION public.read_client_portal_business_knowledge(
 p_tenant_id uuid,p_document_id uuid DEFAULT NULL,p_query text DEFAULT NULL,
 p_limit integer DEFAULT 20,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tenant_knowledge_docs; s public.tenant_knowledge_client_shares;
 docs jsonb:='[]'::jsonb; seen integer:=0; more boolean:=false;
 fingerprint text; source_state text; share_state text; entitled boolean;
BEGIN
 -- Use exactly the incumbent business publisher contract. An owner display
 -- label, a document ID, a customer login or bare platform role grants nothing.
 IF NOT public._client_knowledge_business_publisher(p_tenant_id) THEN
  RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
  OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 100000
  OR length(coalesce(p_query,''))>200 THEN
  RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 entitled:=public._tenant_finance_entitled(p_tenant_id);
 FOR d IN SELECT k.* FROM public.tenant_knowledge_docs k
  WHERE k.tenant_id=p_tenant_id AND (p_document_id IS NULL OR k.id=p_document_id)
   AND (btrim(coalesce(p_query,''))='' OR strpos(lower(k.title),lower(btrim(p_query)))>0)
  ORDER BY k.updated_at DESC,k.id LIMIT p_limit+1 OFFSET p_offset LOOP
  seen:=seen+1;
  IF seen>p_limit THEN more:=true; EXIT; END IF;
  SELECT * INTO s FROM public.tenant_knowledge_client_shares
   WHERE tenant_id=p_tenant_id AND document_id=d.id AND audience='business';
  fingerprint:=public._client_knowledge_source(d)->>'source_fingerprint';
  source_state:=CASE
   WHEN d.record_state IS DISTINCT FROM 'canonical' THEN 'draft'
   WHEN d.content IS NULL OR btrim(d.content)='' THEN 'empty'
   WHEN public._knowledge_doc_is_finance(d) AND NOT entitled THEN 'not_entitled'
   WHEN d.active_generation_id IS NULL THEN 'needs_publication'
   ELSE 'prepared' END;
  share_state:=CASE
   WHEN s.id IS NULL THEN 'not_shared'
   WHEN s.revoked_at IS NOT NULL THEN 'withdrawn'
   WHEN source_state='not_entitled' THEN 'not_entitled'
   WHEN source_state<>'prepared' OR s.document_revision IS DISTINCT FROM d.revision
    OR s.generation_id IS DISTINCT FROM d.active_generation_id
    OR s.source_fingerprint IS DISTINCT FROM fingerprint THEN 'source_changed'
   WHEN s.valid_from IS NOT NULL AND now()<s.valid_from THEN 'scheduled'
   WHEN s.valid_until IS NOT NULL AND now()>=s.valid_until THEN 'expired'
   ELSE 'shared' END;
  docs:=docs||jsonb_build_array(jsonb_build_object(
   'document_id',d.id,'document_revision',d.revision,'title',left(d.title,300),
   'source_state',source_state,'pending_review',d.pending_review IS NOT NULL,
   'source_fingerprint',fingerprint,'generation_id',d.active_generation_id,
   'share',CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object(
    'share_id',s.id,'share_revision',s.revision,'document_revision',s.document_revision,
    'generation_id',s.generation_id,'source_fingerprint',s.source_fingerprint,
    'customer_kind',s.customer_kind,'valid_from',s.valid_from,'valid_until',s.valid_until,
    'state',share_state,'granted_at',s.granted_at,'revoked_at',s.revoked_at,
    'receipt_id',s.last_operation_id) END,
   'share_state',share_state,'updated_at',d.updated_at));
 END LOOP;
 RETURN jsonb_build_object('tenant_id',p_tenant_id,'audience','business','as_of',now(),
  'documents',docs,'next_offset',p_offset+jsonb_array_length(docs),'has_more',more);
END $$;
REVOKE ALL ON FUNCTION public.read_client_portal_business_knowledge(uuid,uuid,text,integer,integer)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_client_portal_business_knowledge(uuid,uuid,text,integer,integer) TO authenticated;

COMMIT;
