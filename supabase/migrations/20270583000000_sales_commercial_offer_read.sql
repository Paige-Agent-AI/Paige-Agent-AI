-- S2: bounded canonical offer facts for commercial assembly. No provider IDs or writes.
CREATE OR REPLACE FUNCTION public.read_sales_commercial_offers(
  _expected_tenant_id uuid,_search text DEFAULT NULL,_offer_id uuid DEFAULT NULL,
  _limit integer DEFAULT 10,_before_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ids uuid[]; rows jsonb; more boolean; query text:=btrim(_search); run uuid:=gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
    RAISE EXCEPTION 'Sales workspace unavailable' USING ERRCODE='42501'; END IF;
  PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
  IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 20 OR
    ((_offer_id IS NULL) = (query IS NULL OR query='')) OR
    (query IS NOT NULL AND char_length(query)>100) OR (_offer_id IS NOT NULL AND _before_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Bounded exact offer or literal search required' USING ERRCODE='22023'; END IF;
  SELECT array_agg(id ORDER BY id DESC) INTO ids FROM (
    SELECT p.id FROM public.tenant_products p WHERE p.tenant_id=_expected_tenant_id
      AND (_offer_id IS NULL OR p.id=_offer_id)
      AND (_offer_id IS NOT NULL OR position(lower(query) in lower(p.name))>0)
      AND (_before_id IS NULL OR p.id<_before_id) ORDER BY p.id DESC LIMIT _limit+1
  ) candidates;
  more:=coalesce(array_length(ids,1),0)>_limit;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'name',left(p.name,200),'description',left(p.description,5000),
    'name_truncated',char_length(p.name)>200,'description_truncated',coalesce(char_length(p.description)>5000,false),
    'status',p.status,'updated_at',p.updated_at,
    'prices',prices.rows,'prices_has_more',prices.has_more
  ) ORDER BY p.id DESC),'[]'::jsonb) INTO rows FROM public.tenant_products p
  CROSS JOIN LATERAL (
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'unit_minor',v.unit_amount,
      'currency',v.currency,'kind',v.kind,'billing_interval',v.billing_interval,
      'interval_count',v.interval_count,'installments_total',v.installments_total,
      'active',v.active) ORDER BY v.sort_order,v.id) FILTER(WHERE v.rank<=20),'[]'::jsonb) AS rows,
      count(*)>20 AS has_more
    FROM (SELECT tp.*,row_number() OVER(ORDER BY tp.sort_order,tp.id) AS rank
      FROM public.tenant_prices tp WHERE tp.tenant_id=_expected_tenant_id AND tp.product_id=p.id
      ORDER BY tp.sort_order,tp.id LIMIT 21) v
  ) prices WHERE p.tenant_id=_expected_tenant_id AND p.id=ANY(ids[1:_limit]);
  -- One canonical receipt, atomically with this read. No search text or offer descriptions enter Rail.
  PERFORM public.record_capability_run(_expected_tenant_id,auth.uid(),'read_sales_commercial_offers','capability_succeeded',run,NULL);
  RETURN jsonb_build_object('receipt_id',run,'tenant_id',_expected_tenant_id,'offers',rows,'has_more',more,
    'next_cursor',CASE WHEN more THEN ids[_limit] ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.read_sales_commercial_offers(uuid,text,uuid,integer,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_sales_commercial_offers(uuid,text,uuid,integer,uuid) TO authenticated;
