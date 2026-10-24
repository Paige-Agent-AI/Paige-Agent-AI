BEGIN;
-- Extend the existing owner-only history projection with exact durable receipt
-- references. No new receipt table or authority: the same owner context applies.
CREATE OR REPLACE FUNCTION public.list_business_mission_target_versions(p_target_id uuid,p_limit integer DEFAULT 100,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; t uuid; items jsonb; total_count bigint;
BEGIN
  SELECT c.actor_id,c.tenant_id INTO a,t FROM public.business_mission_owner_context() c;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset<0 OR p_offset>10000 THEN
    RAISE EXCEPTION 'MISSION_TARGET_ARGUMENTS_INVALID' USING errcode='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.business_mission_targets x WHERE x.tenant_id=t AND x.id=p_target_id) THEN
    RAISE EXCEPTION 'MISSION_TARGET_NOT_FOUND' USING errcode='P0002'; END IF;
  SELECT count(*) INTO total_count FROM public.business_mission_target_versions v WHERE v.tenant_id=t AND v.target_id=p_target_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('revision',v.revision,'state',v.state,'definition',v.definition,
      'revision_reason',v.revision_reason,'created_by',v.created_by,'created_at',v.created_at,
      'receipt',proof.receipt) ORDER BY v.revision DESC),'[]'::jsonb)
    INTO items FROM (SELECT * FROM public.business_mission_target_versions WHERE tenant_id=t AND target_id=p_target_id
      ORDER BY revision DESC LIMIT p_limit OFFSET p_offset) v
    CROSS JOIN LATERAL (
      SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(jsonb_build_object('id',r.id,'request_key',r.request_key,
        'mission_id',x.mission_id,'target_id',x.id,'revision',v.revision,'state',v.state,'operation',r.operation))->0) ELSE NULL END receipt
      FROM public.business_mission_targets x JOIN public.business_mission_mutation_receipts r
        ON r.tenant_id=x.tenant_id AND r.mission_id=x.mission_id AND r.actor_user_id=v.created_by
      WHERE x.tenant_id=t AND x.id=p_target_id AND r.operation IN ('target_create','target_revise','target_transition')
        AND r.result @> jsonb_build_object('ok',true,'mission_id',x.mission_id,'target_id',x.id,'revision',v.revision,
          'state',v.state,'receipt_id',r.id,'request_key',r.request_key)
    ) proof;
  RETURN jsonb_build_object('resolved_tenant_id',t,'target_id',p_target_id,'versions',items,'total_count',total_count,
    'has_more',p_offset+jsonb_array_length(items)<total_count);
END $$;
REVOKE ALL ON FUNCTION public.list_business_mission_target_versions(uuid,integer,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.list_business_mission_target_versions(uuid,integer,integer) TO authenticated;
COMMENT ON FUNCTION public.list_business_mission_target_versions(uuid,integer,integer) IS
  'Current verified Mission owner only. Exact immutable versions and matching canonical receipt references, including prior owners. No payload hash, metric bearer reference, raw receipt access or fabricated Rail/performance confirmation.';
COMMIT;
