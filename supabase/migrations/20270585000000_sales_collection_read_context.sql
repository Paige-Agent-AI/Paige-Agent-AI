-- Reuse the canonical reader, scope gate and receipt. No commercial mutation.
CREATE OR REPLACE FUNCTION public.read_sales_collections(
  _expected_tenant_id uuid,_entity text,_limit integer DEFAULT 25,
  _cursor jsonb DEFAULT NULL,_before_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;rows jsonb;run uuid:=gen_random_uuid();
BEGIN
  IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
    RAISE EXCEPTION 'Collection workspace changed' USING ERRCODE='42501';
  END IF;
  PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
  IF _entity IS NULL OR _entity NOT IN ('agreement','invoice','receipt') OR _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'Invalid collection read' USING ERRCODE='22023';
  END IF;
  IF _entity='agreement' THEN
    IF _cursor IS NOT NULL THEN RAISE EXCEPTION 'Agreement read requires before-id only' USING ERRCODE='22023';END IF;
    result:=public.list_sales_collection_agreements(_expected_tenant_id,_limit,_before_id);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'rows') AS r(row)
      WHERE row->>'offer_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.tenant_products p
        WHERE p.id=(row->>'offer_id')::uuid AND p.tenant_id=_expected_tenant_id)) THEN
      RAISE EXCEPTION 'Collection context unavailable' USING ERRCODE='42501';
    END IF;
    SELECT coalesce(jsonb_agg(row || jsonb_build_object(
      'title',left(row->>'title',200),'title_truncated',coalesce(char_length(row->>'title')>200,false),
      'client_name',left(row->>'client_name',200),'client_name_truncated',coalesce(char_length(row->>'client_name')>200,false)
    ) ORDER BY ordinal),'[]'::jsonb) INTO rows FROM jsonb_array_elements(result->'rows') WITH ORDINALITY AS r(row,ordinal);
    result:=jsonb_set(result,'{rows}',rows);
  ELSE
    IF _before_id IS NOT NULL THEN RAISE EXCEPTION 'Register read requires snapshot cursor only' USING ERRCODE='22023';END IF;
    IF _cursor IS NOT NULL AND (jsonb_typeof(_cursor)<>'object' OR _cursor->>'entity' IS DISTINCT FROM _entity) THEN
      RAISE EXCEPTION 'Collection cursor entity mismatch' USING ERRCODE='22023';
    END IF;
    result:=public.list_sales_collection_register(_expected_tenant_id,_entity,_limit,_cursor);
  END IF;
  IF octet_length(result::text)>524288 THEN
    RAISE EXCEPTION 'Collection read is too large; request fewer records' USING ERRCODE='22023';
  END IF;
  -- No customer labels, financial terms, search input or documents in receipt payload.
  PERFORM public.record_capability_run(_expected_tenant_id,auth.uid(),'read_sales_collections','capability_succeeded',run,NULL);
  RETURN result || jsonb_build_object('tenant_id',_expected_tenant_id,'receipt_id',run);
END $$;
REVOKE ALL ON FUNCTION public.read_sales_collections(uuid,text,integer,jsonb,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_sales_collections(uuid,text,integer,jsonb,uuid) TO authenticated;
