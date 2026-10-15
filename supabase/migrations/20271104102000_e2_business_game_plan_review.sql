BEGIN;
-- Bounded owner-only read over existing Strategic Plays and numeric targets.
-- Counts describe canonical records, never achieved work or metric attainment.
CREATE OR REPLACE FUNCTION public.get_business_mission_review()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; t uuid; mission_counts jsonb; target_counts jsonb; items jsonb;
BEGIN
  SELECT c.actor_id,c.tenant_id INTO a,t FROM public.business_mission_owner_context() c;
  SELECT jsonb_build_object('total',count(*),
    'active',count(*) FILTER (WHERE m.lifecycle_state='active'),
    'proposed',count(*) FILTER (WHERE m.lifecycle_state='proposed'),
    'blocked',count(*) FILTER (WHERE m.lifecycle_state='blocked'),
    'paused',count(*) FILTER (WHERE m.lifecycle_state='paused'),
    'completed',count(*) FILTER (WHERE m.lifecycle_state='completed'),
    'stopped',count(*) FILTER (WHERE m.lifecycle_state='stopped'),
    'without_targets',count(*) FILTER (WHERE NOT EXISTS(
      SELECT 1 FROM public.business_mission_targets x WHERE x.tenant_id=t AND x.mission_id=m.id)))
    INTO mission_counts FROM public.business_missions m WHERE m.tenant_id=t;
  SELECT jsonb_build_object('total',count(*),
    'active',count(*) FILTER (WHERE x.state='active'),
    'paused',count(*) FILTER (WHERE x.state='paused'),
    'retired',count(*) FILTER (WHERE x.state='retired'))
    INTO target_counts FROM public.business_mission_targets x WHERE x.tenant_id=t;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'mission',jsonb_build_object('id',m.id,'title',m.title,'revision',m.revision,'state',m.lifecycle_state,'updated_at',m.updated_at),
    'target',public.get_business_mission_target(x.id)) ORDER BY x.closed_order,x.state_order,x.updated_at DESC,x.id),'[]'::jsonb)
    INTO items FROM (
      SELECT q.*,CASE WHEN p.lifecycle_state IN ('completed','stopped') THEN 1 ELSE 0 END closed_order,
        CASE q.state WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END state_order
      FROM public.business_mission_targets q JOIN public.business_missions p ON p.tenant_id=q.tenant_id AND p.id=q.mission_id
      WHERE q.tenant_id=t
      ORDER BY closed_order,state_order,q.updated_at DESC,q.id LIMIT 6
    ) x JOIN public.business_missions m ON m.tenant_id=t AND m.id=x.mission_id;
  RETURN jsonb_build_object('resolved_tenant_id',t,'as_of',statement_timestamp(),
    'mission_counts',mission_counts,'target_counts',target_counts,'targets',items,
    'sample_limit',6,'has_more',(target_counts->>'total')::bigint>jsonb_array_length(items));
END $$;
REVOKE ALL ON FUNCTION public.get_business_mission_review() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_business_mission_review() TO authenticated;
COMMENT ON FUNCTION public.get_business_mission_review() IS
  'Existing Mission owner context. Exact scoped Play/target counts and at most six canonical target definitions with owning Play identity. No actuals, attainment, execution, new storage, provider operation or approval authority.';
COMMIT;
