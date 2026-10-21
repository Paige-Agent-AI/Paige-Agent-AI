-- Observe the ORIGINAL private extraction intent after an uncertain acknowledgement.
-- No replay, creation, worker wake, publication, share or Chat-hold settlement.
BEGIN;
DO $lease$
DECLARE e record; a record;
BEGIN
 FOR e IN SELECT * FROM (VALUES
  ('public._client_knowledge_business_publisher(uuid)','75e906ec37604c0ab71d92f8070a1cdd'),
  ('public._tenant_brand_manager_member(uuid)','00278372f844f7bee53a2d5a69ca3df9'),
  ('public.knowledge_actor_authorized(uuid,uuid)','a05876e786e8a6e7e3e15783cde684aa'),
  ('public.lock_knowledge_extraction_authority(uuid,uuid)','788d27bc980fee58e6272c3e53ca6096'),
  ('public.submit_knowledge_extraction(uuid,uuid,uuid,uuid,integer,text,text,jsonb)','4d1aacd69a03322642b149cbce6c5c56')
 ) v(signature,body_md5) LOOP
  SELECT md5(prosrc) body_md5,pg_get_userbyid(proowner) owner INTO a
   FROM pg_proc WHERE oid=to_regprocedure(e.signature);
  IF a.body_md5 IS DISTINCT FROM e.body_md5 OR a.owner IS DISTINCT FROM 'postgres' THEN
   RAISE EXCEPTION 'CURA preparation dependency changed (%); review composition',e.signature USING ERRCODE='42501';
  END IF;
 END LOOP;
END $lease$;

CREATE FUNCTION public.read_cura_knowledge_preparation(
 p_tenant_id uuid,p_intent_id uuid,p_title text,p_input text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); w public.paige_durable_work;
 frozen_hash text; doc_id uuid; doc_revision integer;
 unavailable jsonb:=jsonb_build_object('contract_version',1,'tenant_id',p_tenant_id,
  'availability','unavailable','preparation_recorded',NULL,'retry_authorized',false);
BEGIN
 -- The original authority lock makes a concurrent role/workspace revocation wait
 -- until this read finishes. VOLATILE is intentional: the helper takes row locks.
 IF actor IS NULL OR NOT public.lock_knowledge_extraction_authority(actor,p_tenant_id)
   OR NOT public._client_knowledge_business_publisher(p_tenant_id) THEN
  RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_intent_id IS NULL OR p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 300
   OR p_input IS NULL OR public.knowledge_utf16_length(p_input) NOT BETWEEN 1 AND 480000
   OR octet_length(p_input)>2097152 THEN
  RAISE EXCEPTION 'CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 -- Exact original paste/new-source submit fingerprint, including its NULL target,
 -- revision and upload source. The input is used transiently, never saved here.
 frozen_hash:=encode(sha256(convert_to(jsonb_build_object(
  'target',NULL::uuid,'revision',NULL::integer,'title',btrim(p_title),
  'hash',encode(sha256(convert_to(p_input,'UTF8')),'hex'),'source',NULL::jsonb)::text,'UTF8')),'hex');
 SELECT * INTO w FROM public.paige_durable_work
  WHERE tenant_id=p_tenant_id AND initiating_user_id=actor AND intent_id=p_intent_id;
 IF NOT FOUND OR w.work_kind<>'knowledge_extract' OR w.capability_key<>'knowledge.extract'
   OR w.request_payload->>'version' IS DISTINCT FROM '1'
   OR w.request_payload->>'request_hash' IS DISTINCT FROM frozen_hash THEN
  RETURN unavailable;
 END IF;
 -- Current source metadata is distinct from the immutable original acceptance.
 -- A retired or unavailable source never causes another request or false absence.
 SELECT d.id,d.revision INTO doc_id,doc_revision FROM public.tenant_knowledge_docs d
  WHERE d.tenant_id=p_tenant_id AND d.id::text=w.request_payload->>'document_id';
 RETURN jsonb_build_object('contract_version',1,'tenant_id',p_tenant_id,
  'availability','available','preparation_recorded',true,'work_id',w.id,
  'work_status',w.status,'source_document_id',doc_id,'current_document_revision',doc_revision,
  'work_updated_at',w.updated_at,'retry_authorized',false);
END $$;
REVOKE ALL ON FUNCTION public.read_cura_knowledge_preparation(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_cura_knowledge_preparation(uuid,uuid,text,text) TO authenticated;
COMMENT ON FUNCTION public.read_cura_knowledge_preparation(uuid,uuid,text,text) IS
 'Current business publisher observes only their exact native paste-extraction intent/frozen request. No work replay, provider dispatch, publication or interactive-hold settlement; unavailable is not proof of non-application.';
COMMIT;
