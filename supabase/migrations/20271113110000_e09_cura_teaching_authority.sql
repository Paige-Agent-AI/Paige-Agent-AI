-- CURA preparation reuses the ORIGINAL private extraction writer in one
-- caller-JWT publisher transaction. No new record types, worker or permission engine.
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
  SELECT md5(prosrc) body_md5,pg_get_userbyid(proowner) owner,provolatile volatility INTO a
   FROM pg_proc WHERE oid=to_regprocedure(e.signature);
  IF a.body_md5 IS DISTINCT FROM e.body_md5 OR a.owner IS DISTINCT FROM 'postgres'
    OR (e.signature IN ('public._client_knowledge_business_publisher(uuid)','public._tenant_brand_manager_member(uuid)') AND a.volatility IS DISTINCT FROM 's') THEN
   RAISE EXCEPTION 'CURA preparation dependency changed (%); review composition',e.signature USING ERRCODE='42501';
  END IF;
 END LOOP;
END $lease$;

CREATE FUNCTION public.submit_cura_knowledge_preparation(
 p_tenant_id uuid,p_intent_id uuid,p_title text,p_input text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); authority_chain uuid[]; current_chain uuid[];
 locked_memberships uuid[]; current_memberships uuid[]; publisher boolean;
BEGIN
 IF actor IS NULL THEN
  RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 -- Same ordered ancestry/member lock sequence as original K1 business sharing.
 IF NOT public.lock_knowledge_extraction_authority(auth.uid(),p_tenant_id) THEN
   RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
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
   RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 -- Capture exactly the rows that were locked, including nonpublisher seats.
 SELECT array_agg(tenant_id ORDER BY tenant_id) INTO locked_memberships FROM (
  SELECT tenant_id FROM public.tenant_members
   WHERE user_id=actor AND tenant_id=ANY(authority_chain)
   ORDER BY tenant_id FOR SHARE) locked;
 -- The original STABLE predicate and current membership set use ONE statement
 -- snapshot. A newly inserted, unlocked grant cannot supply publishing authority.
 SELECT public._client_knowledge_business_publisher(p_tenant_id),
  (SELECT array_agg(tenant_id ORDER BY tenant_id) FROM public.tenant_members
   WHERE user_id=actor AND tenant_id=ANY(authority_chain))
 INTO publisher,current_memberships;
 IF publisher IS DISTINCT FROM true OR current_memberships IS DISTINCT FROM locked_memberships THEN
   RAISE EXCEPTION 'KNOWLEDGE_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 -- The original writer remains sole owner of validation, frozen payload,
 -- idempotent acceptance, private source/work creation and its existing wake.
 RETURN public.submit_knowledge_extraction(actor,p_tenant_id,p_intent_id,
  NULL::uuid,NULL::integer,p_title,p_input,NULL::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.submit_cura_knowledge_preparation(uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.submit_cura_knowledge_preparation(uuid,uuid,text,text) TO authenticated;
COMMENT ON FUNCTION public.submit_cura_knowledge_preparation(uuid,uuid,text,text) IS
 'Actual caller business publisher prepares one private paste source through original extraction under original K1 authority locks. No publication, indexing, customer sharing, actor delegation or Chat approval/admission override.';
COMMIT;
