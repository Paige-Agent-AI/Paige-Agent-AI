-- Customer audience metadata over canonical tenant Knowledge. No content copy.
-- Above the verified pending owner-task migration frontier20271108220000.
-- Native configuration20271108202000 ships first; this is not a Chat activation.
BEGIN;

DO $authority_lease$
BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.knowledge_actor_authorized(uuid,uuid)'))
     IS DISTINCT FROM 'a05876e786e8a6e7e3e15783cde684aa'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.can_manage_tenant_brand(uuid)'))
     IS DISTINCT FROM '83ab60b34ee249bdad4e73e8aafbdcd8'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.client_portal_relationship_id(uuid)'))
     IS DISTINCT FROM 'f79189022b4dc36760b618a086a80e28'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.can_access_contact(uuid,uuid,boolean)'))
     IS DISTINCT FROM '185067894d94e7dd5195708f0f5a9978'
  OR EXISTS(SELECT 1 FROM (VALUES
    ('public.knowledge_actor_authorized(uuid,uuid)',ARRAY['search_path=""']::text[]),
    ('public.can_manage_tenant_brand(uuid)',ARRAY['search_path=public']::text[]),
    ('public.client_portal_relationship_id(uuid)',ARRAY['search_path=public, pg_temp']::text[]),
    ('public.can_access_contact(uuid,uuid,boolean)',ARRAY['search_path=public']::text[])
   ) expected(signature,settings) JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature)
   WHERE pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.provolatile<>'s'
     OR p.proconfig IS DISTINCT FROM expected.settings) THEN
   RAISE EXCEPTION 'Customer Knowledge authority source changed; review before composition' USING ERRCODE='42501';
 END IF;
END $authority_lease$;

CREATE TABLE public.tenant_knowledge_client_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.tenant_knowledge_docs(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision>0),
  document_revision integer NOT NULL CHECK (document_revision>0),
  generation_id uuid,
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  last_operation_id uuid NOT NULL,
  last_request_hash text NOT NULL CHECK (last_request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,contact_id,document_id)
);
ALTER TABLE public.tenant_knowledge_client_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_knowledge_client_shares FROM PUBLIC,anon,authenticated,service_role;
-- Deliberately RPC-only; callers receive closed projections, never raw share rows.
CREATE POLICY customer_knowledge_shares_no_direct_access
 ON public.tenant_knowledge_client_shares FOR ALL TO authenticated
 USING (false) WITH CHECK (false);

CREATE FUNCTION public._client_knowledge_owner_authorized(_tenant uuid,_contact uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(auth.uid() IS NOT NULL
   AND public.knowledge_actor_authorized(auth.uid(),_tenant)
   AND public.can_manage_tenant_brand(_tenant)
   AND public.can_access_contact(auth.uid(),_contact,false)
   AND EXISTS(SELECT 1 FROM public.clients c WHERE c.id=_contact AND c.tenant_id=_tenant),false)
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_owner_authorized(uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;

-- Exact canonical client-facing source only: no source URL, private metadata,
-- pending review, extraction input, internal author identity or network flags.
CREATE FUNCTION public._client_knowledge_source(_doc public.tenant_knowledge_docs)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object(
   'document_id',_doc.id,'document_revision',_doc.revision,
   'generation_id',_doc.active_generation_id,
   'source_fingerprint',encode(sha256(convert_to(jsonb_build_object(
     'document_id',_doc.id,'document_revision',_doc.revision,
     'generation_id',_doc.active_generation_id,'manifest',_doc.publication_manifest,
     'title',_doc.title,'content',_doc.content)::text,'UTF8')),'hex'),
   'title',_doc.title,'content',_doc.content)
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_source(public.tenant_knowledge_docs)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_knowledge_share_proposal(
 _actor uuid,_tenant uuid,_contact uuid,_doc uuid,_available boolean,
 _share_revision integer,_source_fingerprint text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object(
   'actor_id',_actor,'tenant_id',_tenant,'contact_id',_contact,'document_id',_doc,
   'available',_available,'share_revision',_share_revision,
   'source_fingerprint',_source_fingerprint)::text,'UTF8')),'hex')
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_share_proposal(uuid,uuid,uuid,uuid,boolean,integer,text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prepare_client_portal_knowledge_share(
 p_tenant_id uuid,p_contact_id uuid,p_document_id uuid,p_available boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tenant_knowledge_docs; c public.clients;
 s public.tenant_knowledge_client_shares; source jsonb; fingerprint text; current_revision integer;
BEGIN
 IF NOT public._client_knowledge_owner_authorized(p_tenant_id,p_contact_id) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_available IS NULL THEN RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM public.clients WHERE id=p_contact_id AND tenant_id=p_tenant_id;
 SELECT * INTO s FROM public.tenant_knowledge_client_shares
   WHERE tenant_id=p_tenant_id AND contact_id=p_contact_id AND document_id=p_document_id;
 current_revision:=coalesce(s.revision,0);
 IF p_available THEN
   IF c.status IS DISTINCT FROM 'active' OR c.merged_into_contact_id IS NOT NULL THEN
     RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_RECIPIENT_UNAVAILABLE' USING ERRCODE='42501';
   END IF;
   SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=p_document_id AND tenant_id=p_tenant_id;
   IF NOT FOUND OR d.record_state IS DISTINCT FROM 'canonical' OR d.content IS NULL OR btrim(d.content)='' THEN
     RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501';
   END IF;
   source:=public._client_knowledge_source(d); fingerprint:=source->>'source_fingerprint';
 ELSE
   -- Withdrawal must remain possible after the source changes or is no longer canonical.
   fingerprint:=s.source_fingerprint;
 END IF;
 RETURN jsonb_build_object('tenant_id',p_tenant_id,'contact_id',p_contact_id,
   'document_id',p_document_id,'available',p_available,'expected_share_revision',current_revision,
   'proposal_hash',public._client_knowledge_share_proposal(auth.uid(),p_tenant_id,p_contact_id,
     p_document_id,p_available,current_revision,fingerprint),
   'source_fingerprint',fingerprint,'document_revision',CASE WHEN p_available THEN d.revision ELSE s.document_revision END,
   'generation_id',CASE WHEN p_available THEN d.active_generation_id ELSE s.generation_id END,
   'title',CASE WHEN p_available THEN d.title ELSE NULL END,
   'preview',CASE WHEN p_available THEN left(d.content,1600) ELSE NULL END,
   'preview_truncated',CASE WHEN p_available THEN length(d.content)>1600 ELSE false END,
   'already_shared',p_available AND s.id IS NOT NULL AND s.revoked_at IS NULL
     AND s.source_fingerprint=fingerprint);
END $$;
REVOKE ALL ON FUNCTION public.prepare_client_portal_knowledge_share(uuid,uuid,uuid,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_client_portal_knowledge_share(uuid,uuid,uuid,boolean) TO authenticated;

CREATE INDEX tenant_knowledge_client_shares_lookup
 ON public.tenant_knowledge_client_shares(tenant_id,contact_id,updated_at DESC,id);

CREATE FUNCTION public._client_knowledge_share_current(s public.tenant_knowledge_client_shares)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(s.revoked_at IS NULL AND EXISTS(
   SELECT 1 FROM public.tenant_knowledge_docs d
   JOIN public.clients c ON c.id=s.contact_id AND c.tenant_id=s.tenant_id
   JOIN public.tenants t ON t.id=s.tenant_id
   WHERE d.id=s.document_id AND d.tenant_id=s.tenant_id
     AND d.record_state='canonical' AND c.status='active'
     AND c.merged_into_contact_id IS NULL AND t.status='active'
     AND d.revision=s.document_revision
     AND d.active_generation_id IS NOT DISTINCT FROM s.generation_id
     AND public._client_knowledge_source(d)->>'source_fingerprint'=s.source_fingerprint),false)
$$;
REVOKE ALL ON FUNCTION public._client_knowledge_share_current(public.tenant_knowledge_client_shares)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.set_client_portal_knowledge_share(
 p_tenant_id uuid,p_contact_id uuid,p_document_id uuid,p_available boolean,
 p_expected_share_revision integer,p_proposal_hash text,p_operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.tenant_knowledge_docs; c public.clients;
 s public.tenant_knowledge_client_shares; prior public.audit_logs;
 source jsonb; fingerprint text; expected_hash text; request_hash text; current_revision integer;
BEGIN
 IF p_available IS NULL OR p_expected_share_revision IS NULL OR p_expected_share_revision<0
   OR p_proposal_hash IS NULL OR p_proposal_hash !~ '^[0-9a-f]{64}$' OR p_operation_id IS NULL THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM public.profiles WHERE user_id=auth.uid() AND active_tenant_id=p_tenant_id FOR SHARE;
 IF NOT FOUND OR NOT public._client_knowledge_owner_authorized(p_tenant_id,p_contact_id) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM public.clients WHERE id=p_contact_id AND tenant_id=p_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_object('actor_id',auth.uid(),
   'tenant_id',p_tenant_id,'contact_id',p_contact_id,'document_id',p_document_id,
   'available',p_available,'expected_share_revision',p_expected_share_revision,
   'proposal_hash',p_proposal_hash)::text,'UTF8')),'hex');

 SELECT * INTO prior FROM public.audit_logs WHERE id=p_operation_id;
 IF FOUND THEN
   IF prior.user_id IS DISTINCT FROM auth.uid() OR prior.entity IS DISTINCT FROM 'client_portal_knowledge_share'
     OR prior.data->>'request_hash' IS DISTINCT FROM request_hash THEN
     RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_OPERATION_CONFLICT' USING ERRCODE='40001';
   END IF;
   SELECT * INTO s FROM public.tenant_knowledge_client_shares
     WHERE id=prior.entity_id AND tenant_id=p_tenant_id AND contact_id=p_contact_id AND document_id=p_document_id;
   -- Generic UI audit rows alone cannot establish an executed authorization.
   -- Replay additionally binds the RPC-only canonical grant's native operation.
   IF s.id IS NULL OR s.last_operation_id IS DISTINCT FROM p_operation_id
     OR s.last_request_hash IS DISTINCT FROM request_hash THEN
     RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_OPERATION_CONFLICT' USING ERRCODE='40001';
   END IF;
   RETURN jsonb_build_object('tenant_id',p_tenant_id,'contact_id',p_contact_id,
     'document_id',p_document_id,'share_id',prior.entity_id,'receipt_id',p_operation_id,
     'replayed',true,'changed',false,'original_revision',s.revision,
     'current_revision',coalesce(s.revision,0),'currently_available',
       s.id IS NOT NULL AND public._client_knowledge_share_current(s));
 END IF;

 IF p_available THEN
   IF c.status IS DISTINCT FROM 'active' OR c.merged_into_contact_id IS NOT NULL THEN
     RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_RECIPIENT_UNAVAILABLE' USING ERRCODE='42501';
   END IF;
   SELECT * INTO d FROM public.tenant_knowledge_docs WHERE id=p_document_id AND tenant_id=p_tenant_id FOR SHARE;
   IF NOT FOUND OR d.record_state IS DISTINCT FROM 'canonical' OR d.content IS NULL OR btrim(d.content)='' THEN
     RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_SOURCE_UNAVAILABLE' USING ERRCODE='42501';
   END IF;
   source:=public._client_knowledge_source(d); fingerprint:=source->>'source_fingerprint';
 END IF;
 SELECT * INTO s FROM public.tenant_knowledge_client_shares
   WHERE tenant_id=p_tenant_id AND contact_id=p_contact_id AND document_id=p_document_id FOR UPDATE;
 current_revision:=coalesce(s.revision,0);
 IF NOT p_available THEN fingerprint:=s.source_fingerprint; END IF;
 -- Authority and proposal are checked again after any canonical-row wait.
 IF NOT public._client_knowledge_owner_authorized(p_tenant_id,p_contact_id) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 expected_hash:=public._client_knowledge_share_proposal(auth.uid(),p_tenant_id,p_contact_id,
   p_document_id,p_available,current_revision,fingerprint);
 IF current_revision<>p_expected_share_revision OR expected_hash IS DISTINCT FROM p_proposal_hash THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_PROPOSAL_CHANGED' USING ERRCODE='40001';
 END IF;
 IF s.id IS NULL THEN
   IF NOT p_available THEN RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_NOT_SHARED' USING ERRCODE='40001'; END IF;
   INSERT INTO public.tenant_knowledge_client_shares
     (tenant_id,contact_id,document_id,revision,document_revision,generation_id,
      source_fingerprint,granted_by,last_operation_id,last_request_hash)
   VALUES(p_tenant_id,p_contact_id,p_document_id,1,d.revision,d.active_generation_id,
     fingerprint,auth.uid(),p_operation_id,request_hash) RETURNING * INTO s;
 ELSE
   UPDATE public.tenant_knowledge_client_shares SET revision=revision+1,
     document_revision=CASE WHEN p_available THEN d.revision ELSE document_revision END,
     generation_id=CASE WHEN p_available THEN d.active_generation_id ELSE generation_id END,
     source_fingerprint=fingerprint,
     granted_by=CASE WHEN p_available THEN auth.uid() ELSE granted_by END,
     granted_at=CASE WHEN p_available THEN now() ELSE granted_at END,
     revoked_by=CASE WHEN p_available THEN NULL ELSE auth.uid() END,
     revoked_at=CASE WHEN p_available THEN NULL ELSE now() END,
     last_operation_id=p_operation_id,last_request_hash=request_hash,updated_at=now()
   WHERE id=s.id RETURNING * INTO s;
 END IF;
 -- Reuse the canonical UI audit record as the immutable operation receipt.
 -- Its primary key makes a conflicting/replayed operation atomic with the grant.
 INSERT INTO public.audit_logs(id,user_id,action,entity,entity_id,data)
 VALUES(p_operation_id,auth.uid(),CASE WHEN p_available THEN 'share_customer_knowledge' ELSE 'withdraw_customer_knowledge' END,
   'client_portal_knowledge_share',s.id,jsonb_build_object('tenant_id',p_tenant_id,
     'contact_id',p_contact_id,'document_id',p_document_id,'share_revision',s.revision,
     'document_revision',s.document_revision,'generation_id',s.generation_id,
     'source_fingerprint',s.source_fingerprint,'available',p_available,'request_hash',request_hash));
 RETURN jsonb_build_object('tenant_id',p_tenant_id,'contact_id',p_contact_id,
   'document_id',p_document_id,'share_id',s.id,'receipt_id',p_operation_id,
   'replayed',false,'changed',true,'original_revision',s.revision,'current_revision',s.revision,
   'currently_available',public._client_knowledge_share_current(s));
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_OPERATION_CONFLICT' USING ERRCODE='40001';
END $$;
REVOKE ALL ON FUNCTION public.set_client_portal_knowledge_share(uuid,uuid,uuid,boolean,integer,text,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.set_client_portal_knowledge_share(uuid,uuid,uuid,boolean,integer,text,uuid) TO authenticated;

CREATE FUNCTION public.list_client_portal_knowledge_shares(
 p_tenant_id uuid,p_contact_id uuid,p_limit integer DEFAULT 20,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT public._client_knowledge_owner_authorized(p_tenant_id,p_contact_id) THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset<0 THEN
   RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(q.item ORDER BY q.updated_at DESC,q.id),'[]'::jsonb) INTO result FROM (
  SELECT s.id,s.updated_at,jsonb_build_object('share_id',s.id,'share_revision',s.revision,
    'document_id',s.document_id,'document_revision',s.document_revision,'generation_id',s.generation_id,
    'source_fingerprint',s.source_fingerprint,'title',left(d.title,300),
    'granted_at',s.granted_at,'revoked_at',s.revoked_at,'receipt_id',s.last_operation_id,
    'currently_available',public._client_knowledge_share_current(s)) item
  FROM public.tenant_knowledge_client_shares s
  JOIN public.tenant_knowledge_docs d ON d.id=s.document_id AND d.tenant_id=s.tenant_id
  WHERE s.tenant_id=p_tenant_id AND s.contact_id=p_contact_id
  ORDER BY s.updated_at DESC,s.id LIMIT p_limit OFFSET p_offset
 ) q;
 RETURN jsonb_build_object('tenant_id',p_tenant_id,'contact_id',p_contact_id,'shares',result,
   'next_offset',p_offset+jsonb_array_length(result),'page_may_continue',jsonb_array_length(result)=p_limit);
END $$;
REVOKE ALL ON FUNCTION public.list_client_portal_knowledge_shares(uuid,uuid,integer,integer)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_client_portal_knowledge_shares(uuid,uuid,integer,integer) TO authenticated;

CREATE FUNCTION public.client_portal_knowledge_context(
 p_tenant_id uuid DEFAULT NULL,p_source_refs jsonb DEFAULT NULL,
 p_limit integer DEFAULT 5,p_offset integer DEFAULT 0,p_include_content boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE customer uuid; business uuid; sources jsonb; expected_count integer; matched integer; content_limit integer;
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
   WHERE s.tenant_id=business AND s.contact_id=customer AND s.revision=(r->>'share_revision')::integer
     AND s.source_fingerprint=r->>'source_fingerprint' AND public._client_knowledge_share_current(s);
   IF matched<>expected_count THEN RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_SOURCE_WITHDRAWN' USING ERRCODE='42501'; END IF;
 END IF;
 content_limit:=least(12000,24000/p_limit);
 SELECT coalesce(jsonb_agg(q.source ORDER BY q.updated_at DESC,q.id),'[]'::jsonb) INTO sources FROM (
   SELECT s.id,s.updated_at,jsonb_build_object('share_id',s.id,'share_revision',s.revision,
     'document_id',d.id,'document_revision',d.revision,'generation_id',d.active_generation_id,
     'source_fingerprint',s.source_fingerprint,'title',left(d.title,300),
     'content',CASE WHEN p_include_content THEN left(d.content,content_limit) ELSE NULL END,
     'content_truncated',p_include_content AND length(d.content)>content_limit) AS source
   FROM public.tenant_knowledge_client_shares s
   JOIN public.tenant_knowledge_docs d ON d.id=s.document_id AND d.tenant_id=s.tenant_id
   WHERE s.tenant_id=business AND s.contact_id=customer AND public._client_knowledge_share_current(s)
     AND (p_source_refs IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_source_refs) r WHERE (r->>'share_id')::uuid=s.id))
   ORDER BY s.updated_at DESC,s.id LIMIT p_limit OFFSET p_offset
 ) q;
 RETURN jsonb_build_object('actor_id',auth.uid(),'contact_id',customer,'tenant_id',business,
   'sources',sources,'next_offset',p_offset+jsonb_array_length(sources),
   'page_may_continue',p_source_refs IS NULL AND jsonb_array_length(sources)=p_limit);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_knowledge_context(uuid,jsonb,integer,integer,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_knowledge_context(uuid,jsonb,integer,integer,boolean) TO authenticated;

COMMIT;
