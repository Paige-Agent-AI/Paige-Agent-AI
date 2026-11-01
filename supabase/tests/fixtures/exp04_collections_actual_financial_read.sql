DO $source$
DECLARE p pg_catalog.pg_proc%ROWTYPE;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.list_sales_collection_register(uuid,text,integer,jsonb)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN('237a5e1937e63af991a8dcb99d594f35','9be5a7171a601dca5940d2f15bcd1104','d78b32cd02cb348e7e7811f9ca7c4cb3')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>3 OR p.prorettype<>'jsonb'::regtype
  OR pg_catalog.pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM '''invoice''::text, 50, NULL::jsonb'
  OR p.proargnames IS DISTINCT FROM ARRAY['_expected_tenant_id','_entity','_limit','_cursor']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']
  OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
  RAISE EXCEPTION 'Original Collections read source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_read(uuid,uuid,integer,integer)')
  AND pg_catalog.md5(prosrc)='9add10afcf85dfbec91f1268248dbb58' AND pg_catalog.pg_get_userbyid(proowner)='postgres' AND NOT prosecdef
  AND NOT proisstrict AND NOT proleakproof AND provolatile='v' AND proparallel='u' AND NOT proretset
  AND prorettype='jsonb'::regtype AND pronargdefaults=0 AND proargnames=ARRAY['_tenant','_invoice','_payment_limit','_financial_version']
  AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current invoice source requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;

-- INERT O5 original Collections projection; not a versioned native carrier.
-- Original actor/snapshot/cursor delegate remains authority. No financial write.
-- Explicit3 reuses the SAME current invoice summary, never receipt subtraction.
CREATE OR REPLACE FUNCTION public.list_sales_collection_register(
 _expected_tenant_id uuid,_entity text DEFAULT 'invoice',_limit integer DEFAULT 50,_cursor jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $read$
DECLARE result jsonb;rows jsonb;headers jsonb;actual boolean;current_financial boolean;unsafe_legacy boolean;unknown_historical_provider boolean;
BEGIN
 result:=public._list_sales_collection_register_before_provider(_expected_tenant_id,_entity,_limit,_cursor);
 BEGIN headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';END;
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' OR (headers ? 'x-paige-invoice-evidence-version' AND
  (jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string'
   OR headers->>'x-paige-invoice-evidence-version' NOT IN('2','3'))) THEN
  RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';END IF;
 actual:=coalesce(headers->>'x-paige-invoice-evidence-version' IN('2','3'),false);
 current_financial:=coalesce(headers->>'x-paige-invoice-evidence-version'='3',false);
 IF _entity='invoice' THEN
  WITH projected AS MATERIALIZED (
   SELECT r.value,r.ordinality,b.*,CASE WHEN r.value->>'record_kind'='managed'
    THEN public._sales_invoice_read(_expected_tenant_id,(r.value->>'id')::uuid,0,3)->'financial_summary' END AS financial
   FROM jsonb_array_elements(result->'rows') WITH ORDINALITY r(value,ordinality)
   CROSS JOIN LATERAL public._sales_invoice_financial_position_rows(_expected_tenant_id,(r.value->>'id')::uuid)b
  )
  SELECT coalesce(jsonb_agg(p.value||jsonb_build_object(
   'manual_recorded_cents',p.manual_minor,
   'provider_verified_cents',CASE WHEN actual THEN p.live_provider_minor ELSE p.provider_minor END,
   'remaining_cents',CASE WHEN current_financial AND p.financial IS NOT NULL THEN (p.financial->>'outstanding_minor')::numeric WHEN actual THEN p.receivable_remaining_minor ELSE p.remaining_minor END,
   'collection_required',CASE WHEN current_financial AND p.financial IS NOT NULL THEN
    CASE WHEN p.value->>'status'<>'issued' THEN false WHEN p.financial->>'standing'='recorded' THEN (p.financial->>'outstanding_minor')::numeric>0 ELSE NULL END
    ELSE (CASE WHEN actual THEN p.receivable_remaining_minor ELSE p.remaining_minor END)>0 AND p.value->>'status' IN('issued','recorded') END)
   ||CASE WHEN actual THEN jsonb_build_object('payment_evidence_version',2,'allocated_cents',p.receivable_allocated_minor,'test_provider_verified_cents',p.test_provider_minor) ELSE '{}'::jsonb END
   ||CASE WHEN current_financial AND p.financial IS NOT NULL THEN jsonb_build_object('financial_evidence_version',3,'financial_summary',p.financial) ELSE '{}'::jsonb END
   ORDER BY p.ordinality),'[]'::jsonb),
   coalesce(bool_or(NOT current_financial AND p.financial IS NOT NULL AND p.value->>'status'='issued'
    AND (p.financial->>'standing' IS DISTINCT FROM 'recorded'
     OR (p.financial->>'outstanding_minor')::numeric IS DISTINCT FROM (CASE WHEN actual THEN p.receivable_remaining_minor ELSE p.remaining_minor END)
     OR (p.financial->>'refund_payable_minor')::numeric IS DISTINCT FROM 0::numeric
     OR (p.financial->>'credit_minor')::numeric IS DISTINCT FROM 0::numeric)),false),
   coalesce(bool_or(current_financial AND p.value->>'record_kind'<>'managed' AND p.provider_minor>0),false)
   INTO rows,unsafe_legacy,unknown_historical_provider FROM projected p;
  IF unsafe_legacy THEN
   RAISE EXCEPTION 'Collections amounts changed; reload the current financial view' USING ERRCODE='40001';END IF;
  IF unknown_historical_provider THEN
   RAISE EXCEPTION 'Historical provider financial evidence requires reconciliation' USING ERRCODE='55000';END IF;
 ELSE
  SELECT coalesce(jsonb_agg(r.value
   ||CASE WHEN p.evidence_kind='provider_verified' THEN jsonb_build_object('provenance','provider_verified','provider',p.provider) ELSE '{}'::jsonb END
   ||CASE WHEN actual THEN jsonb_build_object('payment_evidence_version',2,'provider_environment',CASE WHEN p.evidence_kind='provider_verified' THEN p.provider_environment END) ELSE '{}'::jsonb END
   ORDER BY r.ordinality),'[]'::jsonb) INTO rows
   FROM jsonb_array_elements(result->'rows') WITH ORDINALITY r(value,ordinality)
   LEFT JOIN public.paige_invoice_payments p ON p.tenant_id=_expected_tenant_id AND p.id=(r.value->>'id')::uuid;
 END IF;
 RETURN result||jsonb_build_object('rows',rows,'balance_basis','canonical_receipt_allocations')
  ||CASE WHEN actual THEN jsonb_build_object('payment_evidence_version',2) ELSE '{}'::jsonb END
  ||CASE WHEN current_financial THEN jsonb_build_object('financial_evidence_version',3) ELSE '{}'::jsonb END;
END $read$;
