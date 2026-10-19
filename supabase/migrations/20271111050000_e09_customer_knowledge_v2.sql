-- E09 K1: customer Knowledge share contract v2 (database only).
--
-- What this adds to the ONE customer audience table (tenant_knowledge_client_shares):
--   * a business-wide audience next to the existing per-customer audience;
--   * a customer kind (information/offer/promotion/faq/campaign_explainer/policy; there is no finance kind);
--   * a validity window (valid_from / valid_until), checked at every read, at begin and at settle.
-- Nothing is published by this migration: it creates no share and backfills nothing. A business-wide
-- share exists only after an owner's explicit prepare -> set, which writes an audit_logs receipt.
-- Business-wide shares require a pinned (published) generation, so drafts and legacy (unpinned)
-- documents are never business-wide customer material. A canonical document with newer text awaiting
-- review can be shared only as its reviewed canonical text; the pending_review text is never shared.
--
-- Finance: a document that reads as funding/credit (text heuristic) or carries a finance Marketplace
-- tag is customer-visible only while its business holds the finance entitlement
-- (_tenant_finance_entitled, live since F1a). The check runs at read, so an uninstall hides it.
--
-- Replaced (each leased to its exact production body first): _client_knowledge_share_current,
-- _client_knowledge_snapshot_valid, _client_knowledge_refs_current, _client_knowledge_refs_lock,
-- client_portal_knowledge_context (same signature) and client_portal_assistant_context (same signature;
-- v1 behaviour unchanged, v2 history turns are skipped as "limited").
-- No policy and no table grant is added: the share table stays RPC-only.
BEGIN;

DO $k1_lease$
DECLARE expected record; actual record;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public._client_knowledge_share_current(public.tenant_knowledge_client_shares)','d14c0ae79549791e27338a040a3fe296'),
  ('public._client_knowledge_snapshot_valid(jsonb)','dffca90a7599287d14b5a6fc30942624'),
  ('public._client_knowledge_refs_valid(jsonb)','98c991c88c18e8ce179fc6156c266b9f'),
  ('public._client_knowledge_refs_current(uuid,uuid,jsonb)','0baa7109722c6062947b3c1ae42f9786'),
  ('public._client_knowledge_refs_lock(uuid,uuid,uuid,jsonb)','18cc7e8606742a393e861d815f2fd392'),
  ('public.client_portal_knowledge_context(uuid,jsonb,integer,integer,boolean)','13a90bbbf1cfbd20c944c7a116e7f418'),
  ('public.client_portal_assistant_context(uuid,uuid)','90bd6982ea54f0822714705053f09ed3'),
  ('public._client_knowledge_source(public.tenant_knowledge_docs)','c65c3ac5988f156e2c7fbe3cf8a8786f'),
  ('public._tenant_finance_entitled(uuid)','82150f6b9e86214afa522d629fed0deb'),
  ('public.client_portal_relationship_id(uuid)','da4f00851ef119e4a364aecad7292543'),
  ('public.knowledge_actor_authorized(uuid,uuid)','a05876e786e8a6e7e3e15783cde684aa'),
  ('public.can_manage_tenant_brand(uuid)','83ab60b34ee249bdad4e73e8aafbdcd8'),
  ('public.lock_knowledge_extraction_authority(uuid,uuid)','788d27bc980fee58e6272c3e53ca6096')
 ) e(signature,body_md5) LOOP
  SELECT md5(prosrc) body_md5,proowner,prosecdef INTO actual FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF actual.body_md5 IS DISTINCT FROM expected.body_md5 OR pg_get_userbyid(actual.proowner) IS DISTINCT FROM 'postgres' THEN
   RAISE EXCEPTION 'Customer Knowledge v2 source changed (%); review before composition',expected.signature USING ERRCODE='42501';
  END IF;
 END LOOP;
END $k1_lease$;

-- ─── 1. The share table: audience, kind, window ────────────────────────────────────────────────────
ALTER TABLE public.tenant_knowledge_client_shares
  ALTER COLUMN contact_id DROP NOT NULL,
  ADD COLUMN audience text NOT NULL DEFAULT 'contact' CHECK (audience IN ('contact','business')),
  ADD COLUMN customer_kind text NOT NULL DEFAULT 'information'
    CHECK (customer_kind IN ('information','offer','promotion','faq','campaign_explainer','policy')),
  ADD COLUMN valid_from timestamptz,
  ADD COLUMN valid_until timestamptz,
  ADD CONSTRAINT tkcs_audience_shape CHECK ((audience='contact') = (contact_id IS NOT NULL)),
  ADD CONSTRAINT tkcs_window CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from),
  ADD CONSTRAINT tkcs_business_pinned CHECK (audience<>'business' OR generation_id IS NOT NULL);
CREATE UNIQUE INDEX tkcs_business_doc_uidx ON public.tenant_knowledge_client_shares(tenant_id,document_id)
  WHERE audience='business';
CREATE INDEX tkcs_business_live ON public.tenant_knowledge_client_shares(tenant_id,updated_at DESC,id)
  WHERE audience='business' AND revoked_at IS NULL;

-- ─── 2. Finance classification (a heuristic that fails toward hiding, plus a structural marker) ──────
-- Superset of _shared/finance-gate.ts FINANCE_KEYWORDS (loan, lender, credit repair, credit score, funding,
-- fundability, underwrit, tradeline, dispute letter); src/__tests__/finance-keyword-drift.test.ts and
-- supabase/tests/e09_customer_knowledge_v2.sql pin SQL ⊇ TS. It is a heuristic, not a guarantee.
CREATE FUNCTION public._text_looks_financial(p_text text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
 SELECT coalesce(p_text ~* ('\m('
   'loans?|lenders?|lending|credit\s*repair|credit\s*scores?|credit\s*reports?|credit\s*builder|business\s*credit'
   '|line\s*of\s*credit|lines\s*of\s*credit|funding|fundability|fundable|financing|capital|cash\s*advances?'
   '|merchant\s*advances?|merchant\s*cash|fico|debts?|underwrit\w*|tradelines?|dispute\s*letters?'
   ')\M'),false)
$$;
REVOKE ALL ON FUNCTION public._text_looks_financial(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._knowledge_doc_is_finance(d public.tenant_knowledge_docs)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(
   -- Text: title, summary, category, the owner's own tags and the content. Marketplace provenance
   -- tags are judged structurally below, by the item's is_finance, never by their slug text.
   public._text_looks_financial(concat_ws(' ',d.title,d.summary,d.category,
     (SELECT string_agg(tag,' ') FROM unnest(coalesce(d.tags,'{}'::text[])) tag WHERE tag NOT LIKE 'marketplace:%'),
     d.content))
   OR EXISTS(SELECT 1 FROM unnest(coalesce(d.tags,'{}'::text[])) tag
     JOIN public.marketplace_items it ON it.slug=substr(tag,13)
     WHERE tag LIKE 'marketplace:%' AND it.is_finance),
   true)
$$;
REVOKE ALL ON FUNCTION public._knowledge_doc_is_finance(public.tenant_knowledge_docs)
 FROM PUBLIC,anon,authenticated,service_role;

-- ─── 3. Current-for-this-customer: one predicate for contact and business audiences ─────────────────
CREATE FUNCTION public._client_knowledge_share_current_for(s public.tenant_knowledge_client_shares,p_contact uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(s.revoked_at IS NULL AND p_contact IS NOT NULL
   AND (s.valid_from IS NULL OR s.valid_from<=now())
   AND (s.valid_until IS NULL OR now()<s.valid_until)
   AND (s.audience='business' OR s.contact_id=p_contact)
   AND EXISTS(
   SELECT 1 FROM public.tenant_knowledge_docs d
   JOIN public.clients c ON c.id=p_contact AND c.tenant_id=s.tenant_id
   JOIN public.tenants t ON t.id=s.tenant_id
   WHERE d.id=s.document_id AND d.tenant_id=s.tenant_id
     AND d.record_state='canonical' AND c.status='active'
     AND c.merged_into_contact_id IS NULL AND c.portal_access_state='open' AND t.status='active'
     AND d.revision=s.document_revision
     AND d.active_generation_id IS NOT DISTINCT FROM s.generation_id
     AND public._client_knowledge_source(d)->>'source_fingerprint'=s.source_fingerprint
     AND (NOT public._knowledge_doc_is_finance(d) OR public._tenant_finance_entitled(s.tenant_id))),false)
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_share_current_for(public.tenant_knowledge_client_shares,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- The owner-side "currently available" readers (set_/list_ for one customer) keep their name and now
-- include the window, the paused/ended portal state and the finance rule.
CREATE OR REPLACE FUNCTION public._client_knowledge_share_current(s public.tenant_knowledge_client_shares)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public._client_knowledge_share_current_for(s,s.contact_id)
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_share_current(public.tenant_knowledge_client_shares)
 FROM PUBLIC,anon,authenticated,service_role;

-- A retrieval chunk is admissible only when it is exactly a chunk of the shared, pinned generation,
-- in the one voyage-3/1024 space, inside the manifest, and its text hashes to the manifest's hash.
-- A member-inserted row with a bad index, generation, model or text is never admissible.
CREATE FUNCTION public._client_knowledge_chunk_admissible(
 ch public.tenant_knowledge_chunks,d public.tenant_knowledge_docs,s public.tenant_knowledge_client_shares)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(ch.tenant_id=s.tenant_id AND d.tenant_id=s.tenant_id
   AND ch.doc_id=s.document_id AND d.id=s.document_id
   AND s.generation_id IS NOT NULL AND ch.generation_id=s.generation_id
   AND d.active_generation_id=s.generation_id
   AND ch.embedding_model='voyage-3' AND ch.embedding_dim=1024
   AND ch.chunk_index>=0 AND ch.chunk_index<(d.publication_manifest->>'chunk_count')::int
   AND encode(sha256(convert_to(ch.content,'UTF8')),'hex')=d.publication_manifest->'chunk_hashes'->>ch.chunk_index,false)
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_chunk_admissible(
 public.tenant_knowledge_chunks,public.tenant_knowledge_docs,public.tenant_knowledge_client_shares)
 FROM PUBLIC,anon,authenticated,service_role;

-- ─── 4. Who may publish business-wide: the membership branch of can_manage_tenant_brand only ───────
-- (owner, admin, ancestor-agency owner/admin). The bare platform operator is NOT a publisher of a
-- business's Knowledge to that business's customers (security F-18). can_manage_tenant_brand is unchanged.
CREATE FUNCTION public._tenant_brand_manager_member(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH RECURSIVE chain AS (
   SELECT id,parent_tenant_id,0 AS depth FROM public.tenants WHERE id=_tenant
   UNION ALL
   SELECT p.id,p.parent_tenant_id,c.depth+1 FROM public.tenants p JOIN chain c ON p.id=c.parent_tenant_id
    WHERE c.depth<10)
 SELECT coalesce(auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM chain
   WHERE EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=chain.id AND m.user_id=auth.uid()
     AND m.status='active' AND (m.is_owner OR m.role IN ('owner','admin')))),false)
$$;
REVOKE ALL ON FUNCTION public._tenant_brand_manager_member(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_knowledge_business_publisher(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(auth.uid() IS NOT NULL
   AND public.knowledge_actor_authorized(auth.uid(),_tenant)
   AND public._tenant_brand_manager_member(_tenant),false)
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_business_publisher(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- ─── 5. Snapshot refs v2 (kind-aware). Version 1 keeps today's exact 3-key validator. ───────────────
--   {kind:'knowledge_share', share_id, share_revision, source_fingerprint, passages?:int[] (1..8, ascending)}
-- | {kind:'campaign_delivery', recipient_id, version_id, content_hash}
-- | {kind:'catalog_offer', product_id, offer_fingerprint}
-- Caps per kind: knowledge_share 20, campaign_delivery 5, catalog_offer 10 (retrieval: knowledge 5).
CREATE FUNCTION public._client_knowledge_ref_key(r jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE coalesce(r->>'kind','knowledge_share')
   WHEN 'knowledge_share' THEN 'knowledge_share:'||(r->>'share_id')
   WHEN 'campaign_delivery' THEN 'campaign_delivery:'||(r->>'recipient_id')
   WHEN 'catalog_offer' THEN 'catalog_offer:'||(r->>'product_id') END
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_ref_key(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_knowledge_refs_within_caps(p_refs jsonb,p_knowledge integer DEFAULT 20)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_typeof(p_refs)='array'
  AND (SELECT count(*) FROM jsonb_array_elements(p_refs) r WHERE coalesce(r->>'kind','knowledge_share')='knowledge_share')<=p_knowledge
  AND (SELECT count(*) FROM jsonb_array_elements(p_refs) r WHERE r->>'kind'='campaign_delivery')<=5
  AND (SELECT count(*) FROM jsonb_array_elements(p_refs) r WHERE r->>'kind'='catalog_offer')<=10,false)
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_refs_within_caps(jsonb,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_knowledge_refs_valid_v2(p_refs jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE r jsonb; k text; prior integer; p jsonb;
 uuid_re text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
 IF p_refs IS NULL OR jsonb_typeof(p_refs)<>'array' OR jsonb_array_length(p_refs)>35 THEN RETURN false; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_refs) LOOP
  IF jsonb_typeof(r)<>'object' OR jsonb_typeof(r->'kind') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  k:=r->>'kind';
  IF k='knowledge_share' THEN
   IF NOT r ?& ARRAY['kind','share_id','share_revision','source_fingerprint']
    OR r-ARRAY['kind','share_id','share_revision','source_fingerprint','passages']<>'{}'::jsonb
    OR jsonb_typeof(r->'share_id')<>'string' OR r->>'share_id' !~ uuid_re
    OR jsonb_typeof(r->'share_revision')<>'number' OR r->>'share_revision' !~ '^[1-9][0-9]{0,8}$'
    OR jsonb_typeof(r->'source_fingerprint')<>'string' OR r->>'source_fingerprint' !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
   IF r ? 'passages' THEN
    IF jsonb_typeof(r->'passages')<>'array' OR jsonb_array_length(r->'passages') NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
    prior:=-1;
    FOR p IN SELECT value FROM jsonb_array_elements(r->'passages') LOOP
     IF jsonb_typeof(p)<>'number' OR p#>>'{}' !~ '^(0|[1-9][0-9]{0,2})$' OR (p#>>'{}')::integer<=prior THEN RETURN false; END IF;
     prior:=(p#>>'{}')::integer;
    END LOOP;
   END IF;
  ELSIF k='campaign_delivery' THEN
   IF NOT r ?& ARRAY['kind','recipient_id','version_id','content_hash']
    OR r-ARRAY['kind','recipient_id','version_id','content_hash']<>'{}'::jsonb
    OR jsonb_typeof(r->'recipient_id')<>'string' OR r->>'recipient_id' !~ uuid_re
    OR jsonb_typeof(r->'version_id')<>'string' OR r->>'version_id' !~ uuid_re
    OR jsonb_typeof(r->'content_hash')<>'string' OR r->>'content_hash' !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  ELSIF k='catalog_offer' THEN
   IF NOT r ?& ARRAY['kind','product_id','offer_fingerprint']
    OR r-ARRAY['kind','product_id','offer_fingerprint']<>'{}'::jsonb
    OR jsonb_typeof(r->'product_id')<>'string' OR r->>'product_id' !~ uuid_re
    OR jsonb_typeof(r->'offer_fingerprint')<>'string' OR r->>'offer_fingerprint' !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  ELSE RETURN false;
  END IF;
 END LOOP;
 IF NOT public._client_knowledge_refs_within_caps(p_refs,20) THEN RETURN false; END IF;
 RETURN (SELECT count(DISTINCT public._client_knowledge_ref_key(value)) FROM jsonb_array_elements(p_refs))=jsonb_array_length(p_refs);
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_refs_valid_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._client_knowledge_snapshot_valid(p_snapshot jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot)<>'object' THEN RETURN false; END IF;
 IF NOT p_snapshot ?& ARRAY['version','retrieval_refs','source_refs']
  OR p_snapshot-ARRAY['version','retrieval_refs','source_refs']<>'{}'::jsonb THEN RETURN false; END IF;
 IF p_snapshot->'version'='1'::jsonb THEN
  IF NOT public._client_knowledge_refs_valid(p_snapshot->'retrieval_refs')
   OR NOT public._client_knowledge_refs_valid(p_snapshot->'source_refs') THEN RETURN false; END IF;
  RETURN jsonb_array_length(p_snapshot->'retrieval_refs')<=5
    AND (p_snapshot->'source_refs') @> (p_snapshot->'retrieval_refs');
 ELSIF p_snapshot->'version'='2'::jsonb THEN
  IF NOT public._client_knowledge_refs_valid_v2(p_snapshot->'retrieval_refs')
   OR NOT public._client_knowledge_refs_valid_v2(p_snapshot->'source_refs') THEN RETURN false; END IF;
  RETURN public._client_knowledge_refs_within_caps(p_snapshot->'retrieval_refs',5)
    AND (p_snapshot->'source_refs') @> (p_snapshot->'retrieval_refs');
 END IF;
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_snapshot_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Merge two ref lists for a history turn; NULL when the union exceeds any per-kind cap.
-- For v1 refs the order (by share_id) and the 20-ref cap are exactly today's.
CREATE FUNCTION public._client_knowledge_refs_merge(p_a jsonb,p_b jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 WITH merged AS (
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'kind' NULLS FIRST,
    coalesce(value->>'share_id',value->>'recipient_id',value->>'product_id'),value::text),'[]'::jsonb) refs
  FROM (SELECT DISTINCT value FROM jsonb_array_elements(coalesce(p_a,'[]'::jsonb)||coalesce(p_b,'[]'::jsonb))) x)
 SELECT CASE WHEN public._client_knowledge_refs_within_caps(refs,20) THEN refs END FROM merged
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_refs_merge(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- ─── 6. Currency and settle lock: dispatch by kind; K1 admits only knowledge_share ─────────────────
CREATE OR REPLACE FUNCTION public._client_knowledge_refs_current(p_tenant uuid,p_contact uuid,p_refs jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT (public._client_knowledge_refs_valid(p_refs) OR public._client_knowledge_refs_valid_v2(p_refs)) THEN RETURN false; END IF;
 -- campaign_delivery (C2) and catalog_offer (P1) are not admitted until their slices add a branch.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_refs) r WHERE coalesce(r->>'kind','knowledge_share')<>'knowledge_share') THEN
  RETURN false;
 END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_refs) r
  WHERE NOT EXISTS(SELECT 1 FROM public.tenant_knowledge_client_shares s
   WHERE s.id=(r->>'share_id')::uuid AND s.tenant_id=p_tenant
    AND (s.audience='business' OR s.contact_id=p_contact)
    AND s.revision=(r->>'share_revision')::integer AND s.source_fingerprint=r->>'source_fingerprint'
    AND public._client_knowledge_share_current_for(s,p_contact)
    AND (NOT r ? 'passages' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'passages') p
      WHERE NOT EXISTS(SELECT 1 FROM public.tenant_knowledge_chunks ch
       JOIN public.tenant_knowledge_docs d ON d.id=s.document_id AND d.tenant_id=s.tenant_id
       WHERE ch.doc_id=s.document_id AND ch.tenant_id=s.tenant_id AND ch.generation_id=s.generation_id
        AND ch.chunk_index=(p#>>'{}')::integer
        AND public._client_knowledge_chunk_admissible(ch,d,s))))));
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_refs_current(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._client_knowledge_refs_lock(p_actor uuid,p_tenant uuid,p_contact uuid,p_refs jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT (public._client_knowledge_refs_valid(p_refs) OR public._client_knowledge_refs_valid_v2(p_refs))
  OR p_actor IS NULL THEN RETURN false; END IF;
 PERFORM 1 FROM auth.users WHERE id=p_actor AND deleted_at IS NULL
  AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM public.tenants WHERE id=p_tenant AND status='active' FOR SHARE;
 IF NOT FOUND THEN RETURN false; END IF;
 -- A paused or ended customer (Slice 7) is refused at the client lock (S2).
 PERFORM 1 FROM public.clients WHERE id=p_contact AND tenant_id=p_tenant
  AND linked_user_id=p_actor AND status='active' AND merged_into_contact_id IS NULL
  AND portal_access_state='open' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_actor AND u.deleted_at IS NULL
  AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN RETURN false; END IF;
 -- Same canonical document-before-grant ordering as the owner share writers. Business-wide rows are
 -- locked too, so a concurrent withdraw waits for (or is seen by) this settle (F-10).
 PERFORM d.id FROM public.tenant_knowledge_docs d
  JOIN public.tenant_knowledge_client_shares s ON s.document_id=d.id AND s.tenant_id=d.tenant_id
  JOIN jsonb_array_elements(p_refs) r ON s.id=(r->>'share_id')::uuid
  WHERE coalesce(r->>'kind','knowledge_share')='knowledge_share'
   AND s.tenant_id=p_tenant AND (s.audience='business' OR s.contact_id=p_contact)
  ORDER BY d.id FOR SHARE OF d;
 PERFORM s.id FROM public.tenant_knowledge_client_shares s
  JOIN jsonb_array_elements(p_refs) r ON s.id=(r->>'share_id')::uuid
  WHERE coalesce(r->>'kind','knowledge_share')='knowledge_share'
   AND s.tenant_id=p_tenant AND (s.audience='business' OR s.contact_id=p_contact)
  ORDER BY s.id FOR SHARE OF s;
 -- A new statement after any lock wait rechecks the winning committed source state.
 RETURN public._client_knowledge_refs_current(p_tenant,p_contact,p_refs);
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_refs_lock(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- ─── 7. The customer read: contact rows UNION business rows, one source per document ───────────────
-- Same signature, same per-source keys (the edge decoder and the Resources page decode them exactly).
-- Adds two top-level keys: authorized_count (current authorized documents) and sources_limited
-- (true when more authorized material exists than was returned). Contact shares win over a
-- business share of the same document.
CREATE OR REPLACE FUNCTION public.client_portal_knowledge_context(
 p_tenant_id uuid DEFAULT NULL,p_source_refs jsonb DEFAULT NULL,
 p_limit integer DEFAULT 5,p_offset integer DEFAULT 0,p_include_content boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE customer uuid; business uuid; sources jsonb; expected_count integer; matched integer; content_limit integer;
 authorized integer;
BEGIN
 customer:=public.client_portal_relationship_id(p_tenant_id);
 IF auth.uid() IS NULL OR customer IS NULL OR NOT EXISTS(
   SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.deleted_at IS NULL
     AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 SELECT tenant_id INTO business FROM public.clients WHERE id=customer AND linked_user_id=auth.uid();
 IF business IS NULL OR (p_tenant_id IS NOT NULL AND business<>p_tenant_id) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 OR p_offset IS NULL OR p_offset<0
   OR p_include_content IS NULL THEN RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023'; END IF;
 IF p_source_refs IS NOT NULL THEN
   IF jsonb_typeof(p_source_refs)<>'array' OR jsonb_array_length(p_source_refs)>p_limit OR p_offset<>0 THEN
     RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023';
   END IF;
   FOR sources IN SELECT value FROM jsonb_array_elements(p_source_refs) LOOP
     IF jsonb_typeof(sources)<>'object' OR NOT sources ?& ARRAY['share_id','share_revision','source_fingerprint']
       OR sources-ARRAY['share_id','share_revision','source_fingerprint']<>'{}'::jsonb
       OR jsonb_typeof(sources->'share_id')<>'string' OR sources->>'share_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR jsonb_typeof(sources->'share_revision')<>'number' OR sources->>'share_revision' !~ '^[1-9][0-9]{0,8}$'
       OR jsonb_typeof(sources->'source_fingerprint')<>'string' OR sources->>'source_fingerprint' !~ '^[0-9a-f]{64}$' THEN
       RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023';
     END IF;
   END LOOP;
   expected_count:=jsonb_array_length(p_source_refs);
   IF (SELECT count(DISTINCT (value->>'share_id')::uuid) FROM jsonb_array_elements(p_source_refs))<>expected_count THEN
     RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023';
   END IF;
   SELECT count(*) INTO matched FROM public.tenant_knowledge_client_shares s
   JOIN jsonb_array_elements(p_source_refs) r ON s.id=(r->>'share_id')::uuid
   WHERE s.tenant_id=business AND (s.audience='business' OR s.contact_id=customer)
     AND s.revision=(r->>'share_revision')::integer
     AND s.source_fingerprint=r->>'source_fingerprint' AND public._client_knowledge_share_current_for(s,customer);
   IF matched<>expected_count THEN RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
   authorized:=matched;
 END IF;
 content_limit:=least(12000,24000/p_limit);
 SELECT coalesce(jsonb_agg(q.source ORDER BY q.updated_at DESC,q.id),'[]'::jsonb) INTO sources FROM (
   SELECT s.id,s.updated_at,jsonb_build_object('share_id',s.id,'share_revision',s.revision,
     'document_id',d.id,'document_revision',d.revision,'generation_id',d.active_generation_id,
     'source_fingerprint',s.source_fingerprint,'title',left(d.title,300),
     'content',CASE WHEN p_include_content THEN left(d.content,content_limit) ELSE NULL END,
     'content_truncated',p_include_content AND length(d.content)>content_limit) AS source
   FROM (
     -- One source per document when listing; an exact replay by refs returns exactly those refs.
     SELECT DISTINCT ON (CASE WHEN p_source_refs IS NULL THEN c.document_id ELSE c.id END) c.*
     FROM public.tenant_knowledge_client_shares c
     WHERE c.tenant_id=business AND (c.audience='business' OR c.contact_id=customer)
       AND public._client_knowledge_share_current_for(c,customer)
       AND (p_source_refs IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_source_refs) r WHERE (r->>'share_id')::uuid=c.id))
     ORDER BY CASE WHEN p_source_refs IS NULL THEN c.document_id ELSE c.id END,
       (c.audience='contact') DESC,c.updated_at DESC,c.id
   ) s
   JOIN public.tenant_knowledge_docs d ON d.id=s.document_id AND d.tenant_id=s.tenant_id
   ORDER BY s.updated_at DESC,s.id LIMIT p_limit OFFSET p_offset
 ) q;
 IF p_source_refs IS NULL THEN
   SELECT count(DISTINCT s.document_id) INTO authorized FROM public.tenant_knowledge_client_shares s
    WHERE s.tenant_id=business AND (s.audience='business' OR s.contact_id=customer)
      AND public._client_knowledge_share_current_for(s,customer);
 END IF;
 RETURN jsonb_build_object('actor_id',auth.uid(),'contact_id',customer,'tenant_id',business,
   'sources',sources,'next_offset',p_offset+jsonb_array_length(sources),
   'page_may_continue',p_source_refs IS NULL AND jsonb_array_length(sources)=p_limit,
   'authorized_count',authorized,
   'sources_limited',p_source_refs IS NULL AND authorized>p_offset+jsonb_array_length(sources));
END $$;
REVOKE ALL ON FUNCTION public.client_portal_knowledge_context(uuid,jsonb,integer,integer,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_knowledge_context(uuid,jsonb,integer,integer,boolean) TO authenticated;

-- ─── 8. The v1 assistant context: unchanged for v1 bindings; a v2 history turn is skipped (limited),
-- because a v1 snapshot cannot carry v2 refs. The per-kind merge and (kind, ref) cache key are shared
-- helpers that the v2 context (K2) reuses.
CREATE OR REPLACE FUNCTION public.client_portal_assistant_context(p_thread uuid,p_intent uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); frame jsonb; t public.paige_chat_threads; accepted boolean;
 snapshot jsonb; retrieval jsonb; retrieval_refs jsonb; permitted_refs jsonb; history jsonb:='[]';
 turn record; turn_snapshot jsonb; turn_refs jsonb; merged_refs jsonb; ref jsonb;
 ref_cache jsonb:='{}'; cache_key text; current_ref boolean; valid_turn boolean;
 legacy boolean:=false; limited boolean:=false; remaining integer:=48000; piece text;
BEGIN
 IF actor IS NULL OR p_thread IS NULL OR p_intent IS NULL OR NOT EXISTS(
  SELECT 1 FROM auth.users u WHERE u.id=actor AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=now())) THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 frame:=public.client_portal_frame();
 SELECT * INTO t FROM public.paige_chat_threads WHERE id=p_thread;
 IF NOT FOUND OR NOT public.paige_chat_customer_thread_authorized(p_thread)
  OR frame->>'actor_id' IS DISTINCT FROM actor::text
  OR frame#>>'{profile,id}' IS DISTINCT FROM t.contact_id::text
  OR frame#>>'{profile,tenant_id}' IS DISTINCT FROM t.tenant_id::text THEN
  RAISE EXCEPTION 'CUSTOMER_CONTEXT_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 SELECT bundle_ref->'customer_knowledge' INTO snapshot FROM public.paige_chat_turns
  WHERE thread_id=t.id AND role='user' AND interactive_intent_id=p_intent
   AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id LIMIT 1;
 accepted:=FOUND;
 IF accepted THEN
  legacy:=snapshot IS NULL;
  IF legacy THEN snapshot:='{"version":1,"retrieval_refs":[],"source_refs":[]}';
  ELSIF NOT public._client_knowledge_snapshot_valid(snapshot) OR snapshot->'version' IS DISTINCT FROM '1'::jsonb THEN
   -- This v1 context only replays v1 bindings; a v2 binding is the v2 context's (K2).
   RAISE EXCEPTION 'CUSTOMER_CONTEXT_BINDING_INVALID' USING ERRCODE='42501';
  END IF;
  IF NOT public._client_knowledge_refs_current(t.tenant_id,t.contact_id,snapshot->'source_refs') THEN
   RAISE EXCEPTION 'CUSTOMER_CONTEXT_SOURCE_WITHDRAWN' USING ERRCODE='42501';
  END IF;
  retrieval_refs:=snapshot->'retrieval_refs';
  retrieval:=public.client_portal_knowledge_context(t.tenant_id,retrieval_refs,5,0,true)->'sources';
  permitted_refs:=snapshot->'source_refs';
 ELSE
  retrieval:=public.client_portal_knowledge_context(t.tenant_id,NULL,5,0,true)->'sources';
  SELECT coalesce(jsonb_agg(jsonb_build_object('share_id',s->'share_id','share_revision',s->'share_revision',
   'source_fingerprint',s->'source_fingerprint') ORDER BY ord),'[]'::jsonb) INTO retrieval_refs
   FROM jsonb_array_elements(retrieval) WITH ORDINALITY x(s,ord);
  permitted_refs:=retrieval_refs;
 END IF;
 FOR turn IN SELECT role,content,bundle_ref,seq FROM public.paige_chat_turns
  WHERE thread_id=t.id AND interactive_actor_id=actor AND interactive_tenant_id=t.tenant_id
   AND interactive_intent_id IS NOT NULL AND interactive_intent_id<>p_intent
   AND role IN('user','assistant') AND content IS NOT NULL AND content<>''
   AND (role='user' OR interactive_terminal_state IS NOT NULL)
  ORDER BY seq DESC LIMIT 49 LOOP
  turn_snapshot:=turn.bundle_ref->'customer_knowledge';
  IF turn_snapshot IS NULL THEN
   -- Preserve private UI history, but unattested old assistant prose is not
   -- evidence for a new model turn. The customer's own words remain user data.
   IF turn.role='assistant' THEN limited:=true; CONTINUE; END IF;
   turn_refs:='[]';
  ELSIF NOT public._client_knowledge_snapshot_valid(turn_snapshot)
   OR turn_snapshot->'version' IS DISTINCT FROM '1'::jsonb THEN limited:=true; CONTINUE;
  ELSE turn_refs:=turn_snapshot->'source_refs'; END IF;
  IF accepted THEN
   IF NOT permitted_refs @> turn_refs THEN limited:=true; CONTINUE; END IF;
   merged_refs:=permitted_refs;
  ELSE
   -- Per-kind caps (knowledge 20, campaign 5, catalog 10); for v1 refs exactly today's order and cap.
   merged_refs:=public._client_knowledge_refs_merge(permitted_refs,turn_refs);
   IF merged_refs IS NULL THEN limited:=true; CONTINUE; END IF;
  END IF;
  valid_turn:=true;
  FOR ref IN SELECT value FROM jsonb_array_elements(turn_refs) LOOP
   -- (kind, id) plus the exact ref, so two revisions of one share never share a cached verdict.
   cache_key:=public._client_knowledge_ref_key(ref)||':'||ref::text;
   IF ref_cache ? cache_key THEN current_ref:=(ref_cache->>cache_key)::boolean;
   ELSE
    current_ref:=public._client_knowledge_refs_current(t.tenant_id,t.contact_id,jsonb_build_array(ref));
    ref_cache:=ref_cache||jsonb_build_object(cache_key,current_ref);
   END IF;
   IF NOT current_ref THEN valid_turn:=false; EXIT; END IF;
  END LOOP;
  IF NOT valid_turn THEN limited:=true; CONTINUE; END IF;
  IF remaining<=0 THEN limited:=true; EXIT; END IF;
  piece:=left(turn.content,least(12000,remaining));
  IF length(piece)<length(turn.content) THEN limited:=true; END IF;
  remaining:=remaining-length(piece);
  history:=jsonb_build_array(jsonb_build_object('role',turn.role,'content',piece,'source_refs',turn_refs))||history;
  permitted_refs:=merged_refs;
 END LOOP;
 WHILE jsonb_array_length(history)>0 AND history->0->>'role'<>'user' LOOP
  history:=history-0; limited:=true;
 END LOOP;
 IF NOT accepted THEN
  SELECT coalesce(jsonb_agg(v ORDER BY v->>'share_id'),'[]'::jsonb) INTO permitted_refs FROM (
   SELECT value v FROM jsonb_array_elements(retrieval_refs)
   UNION SELECT r.value FROM jsonb_array_elements(history) h(item)
    CROSS JOIN LATERAL jsonb_array_elements(h.item->'source_refs') r(value)
  ) refs;
  snapshot:=jsonb_build_object('version',1,'retrieval_refs',retrieval_refs,'source_refs',permitted_refs);
 END IF;
 RETURN jsonb_build_object('frame',frame,'thread_id',t.id,'intent_id',p_intent,
  'snapshot',CASE WHEN legacy THEN NULL ELSE snapshot END,'sources',retrieval,'history',history,'history_limited',limited);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_assistant_context(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_assistant_context(uuid,uuid) TO authenticated;

-- ─── 9. Business-wide share writers: explicit prepare -> set, one receipt per act ───────────────────
-- Mirrors the per-customer writer (20271108230000): authority lock, ancestor-chain and membership locks,
-- document-before-grant ordering, operation replay keyed to audit_logs, proposal hash over every field
-- that changes what customers see. Withdrawal works even after the source changed (carried values).
CREATE FUNCTION public._client_knowledge_share_proposal_v2(
 _actor uuid,_tenant uuid,_audience text,_contact uuid,_doc uuid,_available boolean,_kind text,
 _valid_from timestamptz,_valid_until timestamptz,_share_revision integer,_source_fingerprint text)
RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
   'actor_id',_actor,'tenant_id',_tenant,'audience',_audience,'contact_id',_contact,'document_id',_doc,
   'available',_available,'customer_kind',_kind,
   -- Epoch seconds (exact to the microsecond): independent of the session time zone.
   'valid_from',extract(epoch FROM _valid_from),'valid_until',extract(epoch FROM _valid_until),
   'share_revision',_share_revision,'source_fingerprint',_source_fingerprint)::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_share_proposal_v2(uuid,uuid,text,uuid,uuid,boolean,text,timestamptz,timestamptz,integer,text)
 FROM PUBLIC,anon,authenticated,service_role;

-- Shareable business-wide: this business's canonical, non-empty, PINNED document; a finance-marked
-- document only while the business is entitled. Raises the precise reason; returns the document.
CREATE FUNCTION public._client_knowledge_business_shareable(_tenant uuid,_doc uuid,_lock boolean)
RETURNS public.tenant_knowledge_docs LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tenant_knowledge_docs;
BEGIN
 IF _lock THEN
  SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=_doc AND tenant_id=_tenant FOR SHARE;
 ELSE
  SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=_doc AND tenant_id=_tenant;
 END IF;
 IF NOT FOUND OR d.record_state IS DISTINCT FROM 'canonical' OR d.content IS NULL OR btrim(d.content)='' THEN
  RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501';
 END IF;
 IF d.active_generation_id IS NULL THEN
  -- Legacy (unpublished) text goes through the existing republish flow first; never converted here.
  RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_NOT_PREPARED' USING ERRCODE='42501';
 END IF;
 IF public._knowledge_doc_is_finance(d) AND NOT public._tenant_finance_entitled(_tenant) THEN
  RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FINANCE_NOT_ENTITLED' USING ERRCODE='42501';
 END IF;
 RETURN d;
END $$;
REVOKE ALL ON FUNCTION public._client_knowledge_business_shareable(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_knowledge_share_args_valid(_available boolean,_kind text,_from timestamptz,_until timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT _available IS NOT NULL AND (NOT _available OR (
   _kind IN ('information','offer','promotion','faq','campaign_explainer','policy')
   AND (_from IS NULL OR _until IS NULL OR _until>_from)
   AND (_until IS NULL OR _until>now())))
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_share_args_valid(boolean,text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prepare_client_portal_business_knowledge_share(
 p_tenant_id uuid,p_document_id uuid,p_available boolean DEFAULT true,p_customer_kind text DEFAULT 'information',
 p_valid_from timestamptz DEFAULT NULL,p_valid_until timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tenant_knowledge_docs; s public.tenant_knowledge_client_shares;
 fingerprint text; current_revision integer; kind text; vfrom timestamptz; vuntil timestamptz;
BEGIN
 IF NOT public._client_knowledge_business_publisher(p_tenant_id) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_document_id IS NULL OR NOT public._client_knowledge_share_args_valid(p_available,p_customer_kind,p_valid_from,p_valid_until) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 SELECT * INTO s FROM public.tenant_knowledge_client_shares
  WHERE tenant_id=p_tenant_id AND document_id=p_document_id AND audience='business';
 current_revision:=coalesce(s.revision,0);
 IF p_available THEN
   d:=public._client_knowledge_business_shareable(p_tenant_id,p_document_id,false);
   fingerprint:=public._client_knowledge_source(d)->>'source_fingerprint';
   kind:=p_customer_kind; vfrom:=p_valid_from; vuntil:=p_valid_until;
 ELSE
   fingerprint:=s.source_fingerprint; kind:=s.customer_kind; vfrom:=s.valid_from; vuntil:=s.valid_until;
 END IF;
 RETURN jsonb_build_object('tenant_id',p_tenant_id,'audience','business','document_id',p_document_id,
   'available',p_available,'customer_kind',kind,'valid_from',vfrom,'valid_until',vuntil,
   'expected_share_revision',current_revision,
   'proposal_hash',public._client_knowledge_share_proposal_v2(auth.uid(),p_tenant_id,'business',NULL,
     p_document_id,p_available,kind,vfrom,vuntil,current_revision,fingerprint),
   'source_fingerprint',fingerprint,'document_revision',CASE WHEN p_available THEN d.revision ELSE s.document_revision END,
   'generation_id',CASE WHEN p_available THEN d.active_generation_id ELSE s.generation_id END,
   'source',CASE WHEN p_available THEN d.source ELSE NULL END,
   'title',CASE WHEN p_available THEN left(d.title,300) ELSE NULL END,
   'preview',CASE WHEN p_available THEN left(d.content,1600) ELSE NULL END,
   'preview_truncated',CASE WHEN p_available THEN length(d.content)>1600 ELSE false END,
   'already_shared',p_available AND s.id IS NOT NULL AND s.revoked_at IS NULL AND s.source_fingerprint=fingerprint
     AND s.customer_kind=kind AND s.valid_from IS NOT DISTINCT FROM vfrom AND s.valid_until IS NOT DISTINCT FROM vuntil);
END $$;
REVOKE ALL ON FUNCTION public.prepare_client_portal_business_knowledge_share(uuid,uuid,boolean,text,timestamptz,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_client_portal_business_knowledge_share(uuid,uuid,boolean,text,timestamptz,timestamptz) TO authenticated;

CREATE FUNCTION public.set_client_portal_business_knowledge_share(
 p_tenant_id uuid,p_document_id uuid,p_available boolean,p_customer_kind text,
 p_valid_from timestamptz,p_valid_until timestamptz,
 p_expected_share_revision integer,p_proposal_hash text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tenant_knowledge_docs; s public.tenant_knowledge_client_shares; prior public.audit_logs;
 fingerprint text; expected_hash text; request_hash text; current_revision integer;
 kind text; vfrom timestamptz; vuntil timestamptz; authority_chain uuid[]; current_chain uuid[];
BEGIN
 IF p_document_id IS NULL OR p_expected_share_revision IS NULL OR p_expected_share_revision<0
   OR p_proposal_hash IS NULL OR p_proposal_hash !~ '^[0-9a-f]{64}$' OR p_operation_id IS NULL
   OR p_available IS NULL THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 IF NOT public.lock_knowledge_extraction_authority(auth.uid(),p_tenant_id) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 WITH RECURSIVE chain AS (
  SELECT id,parent_tenant_id,0 depth FROM public.tenants WHERE id=p_tenant_id
  UNION ALL SELECT t.id,t.parent_tenant_id,ancestor.depth+1 FROM public.tenants t
   JOIN chain ancestor ON t.id=ancestor.parent_tenant_id WHERE ancestor.depth<10)
 SELECT array_agg(DISTINCT id ORDER BY id) INTO authority_chain FROM chain;
 PERFORM 1 FROM public.tenants WHERE id=ANY(authority_chain) ORDER BY id FOR SHARE;
 WITH RECURSIVE chain AS (
  SELECT id,parent_tenant_id,0 depth FROM public.tenants WHERE id=p_tenant_id
  UNION ALL SELECT t.id,t.parent_tenant_id,ancestor.depth+1 FROM public.tenants t
   JOIN chain ancestor ON t.id=ancestor.parent_tenant_id WHERE ancestor.depth<10)
 SELECT array_agg(DISTINCT id ORDER BY id) INTO current_chain FROM chain;
 IF current_chain IS DISTINCT FROM authority_chain THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_AUTHORITY_CHANGED' USING ERRCODE='40001';
 END IF;
 PERFORM 1 FROM public.tenant_members WHERE user_id=auth.uid() AND tenant_id=ANY(authority_chain)
  ORDER BY tenant_id FOR SHARE;
 IF NOT public._client_knowledge_business_publisher(p_tenant_id) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('actor_id',auth.uid(),
   'tenant_id',p_tenant_id,'audience','business','document_id',p_document_id,
   'available',p_available,'customer_kind',p_customer_kind,
   'valid_from',extract(epoch FROM p_valid_from),'valid_until',extract(epoch FROM p_valid_until),
   'expected_share_revision',p_expected_share_revision,'proposal_hash',p_proposal_hash)::text,'UTF8')),'hex');

 SELECT * INTO prior FROM public.audit_logs WHERE id=p_operation_id;
 IF FOUND THEN
   IF prior.user_id IS DISTINCT FROM auth.uid() OR prior.entity IS DISTINCT FROM 'client_portal_knowledge_share'
     OR prior.data->>'request_hash' IS DISTINCT FROM request_hash THEN
     RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_OPERATION_CONFLICT' USING ERRCODE='40001';
   END IF;
   SELECT * INTO s FROM public.tenant_knowledge_client_shares
     WHERE id=prior.entity_id AND tenant_id=p_tenant_id AND document_id=p_document_id AND audience='business';
   IF s.id IS NULL OR s.last_operation_id IS DISTINCT FROM p_operation_id
     OR s.last_request_hash IS DISTINCT FROM request_hash THEN
     RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_OPERATION_CONFLICT' USING ERRCODE='40001';
   END IF;
   RETURN jsonb_build_object('tenant_id',p_tenant_id,'audience','business','document_id',p_document_id,
     'share_id',s.id,'receipt_id',p_operation_id,'replayed',true,'changed',false,
     'original_revision',s.revision,'current_revision',s.revision,'customer_kind',s.customer_kind,
     'valid_from',s.valid_from,'valid_until',s.valid_until);
 END IF;
 IF NOT public._client_knowledge_share_args_valid(p_available,p_customer_kind,p_valid_from,p_valid_until) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 IF p_available THEN
   d:=public._client_knowledge_business_shareable(p_tenant_id,p_document_id,true);
   fingerprint:=public._client_knowledge_source(d)->>'source_fingerprint';
 END IF;
 SELECT * INTO s FROM public.tenant_knowledge_client_shares
   WHERE tenant_id=p_tenant_id AND document_id=p_document_id AND audience='business' FOR UPDATE;
 current_revision:=coalesce(s.revision,0);
 IF p_available THEN kind:=p_customer_kind; vfrom:=p_valid_from; vuntil:=p_valid_until;
 ELSE fingerprint:=s.source_fingerprint; kind:=s.customer_kind; vfrom:=s.valid_from; vuntil:=s.valid_until; END IF;
 IF NOT public._client_knowledge_business_publisher(p_tenant_id) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 expected_hash:=public._client_knowledge_share_proposal_v2(auth.uid(),p_tenant_id,'business',NULL,
   p_document_id,p_available,kind,vfrom,vuntil,current_revision,fingerprint);
 IF current_revision<>p_expected_share_revision OR expected_hash IS DISTINCT FROM p_proposal_hash THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_PROPOSAL_CHANGED' USING ERRCODE='40001';
 END IF;
 IF s.id IS NULL THEN
   IF NOT p_available THEN RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_NOT_SHARED' USING ERRCODE='40001'; END IF;
   INSERT INTO public.tenant_knowledge_client_shares
     (tenant_id,contact_id,audience,document_id,revision,document_revision,generation_id,source_fingerprint,
      customer_kind,valid_from,valid_until,granted_by,last_operation_id,last_request_hash)
   VALUES(p_tenant_id,NULL,'business',p_document_id,1,d.revision,d.active_generation_id,fingerprint,
     kind,vfrom,vuntil,auth.uid(),p_operation_id,request_hash) RETURNING * INTO s;
 ELSE
   UPDATE public.tenant_knowledge_client_shares SET revision=revision+1,
     document_revision=CASE WHEN p_available THEN d.revision ELSE document_revision END,
     generation_id=CASE WHEN p_available THEN d.active_generation_id ELSE generation_id END,
     source_fingerprint=fingerprint,customer_kind=kind,valid_from=vfrom,valid_until=vuntil,
     granted_by=CASE WHEN p_available THEN auth.uid() ELSE granted_by END,
     granted_at=CASE WHEN p_available THEN now() ELSE granted_at END,
     revoked_by=CASE WHEN p_available THEN NULL ELSE auth.uid() END,
     revoked_at=CASE WHEN p_available THEN NULL ELSE now() END,
     last_operation_id=p_operation_id,last_request_hash=request_hash,updated_at=now()
   WHERE id=s.id RETURNING * INTO s;
 END IF;
 INSERT INTO public.audit_logs(id,user_id,action,entity,entity_id,data)
 VALUES(p_operation_id,auth.uid(),CASE WHEN p_available THEN 'share_customer_knowledge' ELSE 'withdraw_customer_knowledge' END,
   'client_portal_knowledge_share',s.id,jsonb_build_object('tenant_id',p_tenant_id,'audience','business',
     'document_id',p_document_id,'share_revision',s.revision,'document_revision',s.document_revision,
     'generation_id',s.generation_id,'source_fingerprint',s.source_fingerprint,'customer_kind',s.customer_kind,
     'valid_from',s.valid_from,'valid_until',s.valid_until,'available',p_available,'request_hash',request_hash));
 RETURN jsonb_build_object('tenant_id',p_tenant_id,'audience','business','document_id',p_document_id,
   'share_id',s.id,'receipt_id',p_operation_id,'replayed',false,'changed',true,
   'original_revision',s.revision,'current_revision',s.revision,'customer_kind',s.customer_kind,
   'valid_from',s.valid_from,'valid_until',s.valid_until);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_OPERATION_CONFLICT' USING ERRCODE='40001';
END $$;
REVOKE ALL ON FUNCTION public.set_client_portal_business_knowledge_share(uuid,uuid,boolean,text,timestamptz,timestamptz,integer,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_client_portal_business_knowledge_share(uuid,uuid,boolean,text,timestamptz,timestamptz,integer,text,uuid) TO authenticated;

COMMIT;
