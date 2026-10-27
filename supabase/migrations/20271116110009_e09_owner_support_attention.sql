-- EXP09 consumes the original E03 read; it owns no case, message or connector writer.
-- CLI generated locally, then only this unapplied version advanced beyond reserved 16030000.
BEGIN;
CREATE FUNCTION public.read_client_portal_support_attention(
 p_expected_actor_id uuid, p_expected_tenant_id uuid, p_contact_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
 v_gate jsonb;
 v_source jsonb;
 v_cases jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.role() <> 'authenticated'
  OR p_expected_actor_id IS DISTINCT FROM auth.uid()
  OR p_expected_tenant_id IS DISTINCT FROM public.current_user_tenant_id() THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PORTAL_SUPPORT_NOT_AUTHORIZED';
 END IF;
 IF p_contact_ids IS NULL OR cardinality(p_contact_ids) NOT BETWEEN 1 AND 250
  OR array_ndims(p_contact_ids) IS DISTINCT FROM 1 OR array_position(p_contact_ids,NULL) IS NOT NULL
  OR (SELECT count(DISTINCT id) FROM unnest(p_contact_ids) id) <> cardinality(p_contact_ids) THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='PORTAL_SUPPORT_INVALID_REQUEST';
 END IF;
 -- Successful original public owner gate, never a denial/error used as an authority oracle.
 v_gate := public.read_client_portal_access(p_expected_tenant_id,p_contact_ids[array_lower(p_contact_ids,1)]);
 IF v_gate->>'ok' IS DISTINCT FROM 'true'
  OR v_gate->>'contact_id' IS DISTINCT FROM p_contact_ids[array_lower(p_contact_ids,1)]::text THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PORTAL_SUPPORT_NOT_AUTHORIZED';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=p_expected_tenant_id
  AND t.account_type='standalone' AND t.parent_tenant_id IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PORTAL_SUPPORT_UNAVAILABLE';
 END IF;
 IF (SELECT count(*) FROM public.clients c WHERE c.tenant_id=p_expected_tenant_id AND c.id=ANY(p_contact_ids))
  <> cardinality(p_contact_ids) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PORTAL_SUPPORT_NOT_AUTHORIZED';
 END IF;
 v_source := public.read_support_cases(NULL,false);
 IF jsonb_typeof(v_source) IS DISTINCT FROM 'array' OR jsonb_array_length(v_source)>50 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='PORTAL_SUPPORT_SOURCE_UNAVAILABLE';
 END IF;
 -- Both original source authorization and table RLS remain in force. Recheck each
 -- original case/CRM/connector association; never expose a personal mailbox or body.
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'contact_id',s.contact_id,'status',s.status,
  'subject',left(entry.value->>'subject',120),'last_inbound_at',s.last_inbound_at
 ) ORDER BY entry.ordinality),'[]'::jsonb) INTO v_cases
 FROM jsonb_array_elements(v_source) WITH ORDINALITY entry(value,ordinality)
 JOIN public.support_cases s ON s.id=(entry.value->>'id')::uuid AND s.tenant_id=p_expected_tenant_id
 JOIN public.clients c ON c.id=s.contact_id AND c.tenant_id=p_expected_tenant_id
 JOIN public.channel_connectors connector ON connector.id=s.connector_id
  AND connector.tenant_id=p_expected_tenant_id AND connector.mailbox_class='shared_support'
 WHERE s.contact_id=ANY(p_contact_ids) AND s.status IN ('open','awaiting_owner','drafted','sent','awaiting_customer');
 RETURN jsonb_build_object('schema_version',1,'actor_id',auth.uid(),'tenant_id',p_expected_tenant_id,
  'source_window',50,'source_count',jsonb_array_length(v_source),'cases',v_cases,'read_at',statement_timestamp());
END $function$;
REVOKE ALL ON FUNCTION public.read_client_portal_support_attention(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_client_portal_support_attention(uuid,uuid,uuid[]) TO authenticated;
COMMENT ON FUNCTION public.read_client_portal_support_attention(uuid,uuid,uuid[]) IS
 'EXP09 owner-only closed projection of original E03 support case window for known CRM clients; no provider, case, message, or execution writer.';
COMMIT;
