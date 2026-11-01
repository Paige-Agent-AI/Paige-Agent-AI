DO $source$ DECLARE p pg_catalog.pg_proc%ROWTYPE;BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.read_sales_accepted_invoice_obligations(uuid,uuid,uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN ('93e839bcda9a3b8f311d88ec233c3522','643d1d0eeb54e8505ab86d67a0120f27')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.pronargdefaults<>0 OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM ARRAY['_expected_tenant_id','_invoice_id','_agreement_id']
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' THEN
  RAISE EXCEPTION 'Original accepted-payment read source/authority changed' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_financial_read_version()')
  AND pg_catalog.md5(prosrc)='6299914dc1e7aab1013afd60bd726d70' AND NOT prosecdef AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)')
  AND pg_catalog.md5(prosrc)='bdb0960fa3d88b21cca90b79636dc7e1' AND NOT prosecdef AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}')
 OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_accepted_obligations(public.paige_invoices,uuid,integer)')
  AND pg_catalog.md5(prosrc)='56ae7991f59c2d40d5a6bea5fae562ad' AND NOT prosecdef AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original current financial sources require reconciliation' USING ERRCODE='23514';END IF;
END $source$;

-- INERT O5 current accepted-target reader; not a versioned migration/activation.
-- Reuse exact signed terms and the original native actual-position engine.
CREATE OR REPLACE FUNCTION public.read_sales_accepted_invoice_obligations(
 _expected_tenant_id uuid,_invoice_id uuid,_agreement_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $read$
DECLARE original jsonb;observation jsonb;invoice public.paige_invoices%ROWTYPE;
 mode integer;financial jsonb;targets jsonb;unsafe_legacy boolean:=false;reason text;
BEGIN
 original:=public.read_sales_accepted_agreement(_expected_tenant_id,_invoice_id,_agreement_id);
 SELECT * INTO invoice FROM public.paige_invoices WHERE id=_invoice_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Commercial agreement unavailable' USING ERRCODE='42501';END IF;
 mode:=public._sales_invoice_financial_read_version();
 IF mode=3 THEN
  -- This existing overload attests immutable accepted source ONLY. Its amounts
  -- must never be shown as current debt or independently allocated here.
  observation:=public._sales_invoice_accepted_obligations(invoice,_agreement_id,3)-'financial_source_only';
  observation:=observation||pg_catalog.jsonb_build_object('schema_version',2,'financial_evidence_version',3);
 ELSE observation:=public._sales_invoice_accepted_obligations(invoice,_agreement_id);END IF;
 IF original->>'state' IS DISTINCT FROM 'recorded' THEN
  observation:=observation||pg_catalog.jsonb_build_object('state','held','reason','accepted_source_unavailable','obligations','[]'::jsonb);
 ELSIF observation->>'state'='available' THEN
  BEGIN SELECT p.financial_position INTO STRICT financial
   FROM public._sales_invoice_financial_position_rows(_expected_tenant_id,_invoice_id,3,NULL::jsonb)p;
  EXCEPTION WHEN SQLSTATE '55000' THEN financial:=NULL;END;
  IF financial->>'financial_standing'='recorded' AND pg_catalog.jsonb_typeof(financial->'obligations')='array' THEN
   -- Copy authoritative per-original-target debt, with original reference,
   -- accepted document digest, schedule, date and order. No arithmetic or FIFO.
   SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'reference',r.value->'reference','source_digest',r.value->'source_digest','due_date',r.value->'due_date',
    'scheduled_minor',r.value->'scheduled_minor','remaining_minor',r.value->'actual_outstanding_minor')
    ORDER BY r.ordinality),'[]'::jsonb) INTO targets
    FROM pg_catalog.jsonb_array_elements(financial->'obligations') WITH ORDINALITY r(value,ordinality);
   IF mode=3 THEN observation:=observation||pg_catalog.jsonb_build_object('obligations',targets);
   ELSE unsafe_legacy:=targets IS DISTINCT FROM observation->'obligations';END IF;
  ELSIF mode=3 THEN
   reason:=CASE financial->>'financial_standing' WHEN 'needs_review' THEN 'financial_review_required'
     WHEN 'allocation_required' THEN 'allocation_required' ELSE 'financial_evidence_unavailable' END;
   observation:=observation||pg_catalog.jsonb_build_object('state','held','reason',reason,'obligations','[]'::jsonb);
  ELSE unsafe_legacy:=true;END IF;
 END IF;
 -- Preserve the original post-wait current actor/workspace admission.
 IF auth.uid() IS NULL OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN
  RAISE EXCEPTION 'Commercial agreement unavailable' USING ERRCODE='42501';END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 IF unsafe_legacy THEN RAISE EXCEPTION 'Accepted payment amounts changed; reload the current financial view' USING ERRCODE='40001';END IF;
 RETURN original||pg_catalog.jsonb_build_object('payment_obligations',observation);
END $read$;
