-- INERT O5 paired-read companion; not a versioned migration or activation.
-- Same original read/list/actor/tenant/history, explicit representation only.
DO $private_source$ DECLARE r record;p pg_proc%ROWTYPE;BEGIN
 FOR r IN SELECT * FROM(VALUES
 ('public._sales_invoice_financial_read_version()','6299914dc1e7aab1013afd60bd726d70',ARRAY[]::text[],'integer'),
 ('public._sales_invoice_read(uuid,uuid,integer,integer)','9add10afcf85dfbec91f1268248dbb58',ARRAY['_tenant','_invoice','_payment_limit','_financial_version'],'jsonb')
 )x(signature,body_hash,args,result_type) LOOP
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
 IF FOUND AND (md5(p.prosrc)<>r.body_hash OR pg_get_userbyid(p.proowner)<>'postgres' OR p.prosecdef
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'] OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'
  OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.pronargdefaults<>0
  OR p.proretset OR p.prorettype IS DISTINCT FROM to_regtype(r.result_type)
  OR coalesce(p.proargnames,ARRAY[]::text[]) IS DISTINCT FROM r.args) THEN
  RAISE EXCEPTION 'Original private financial read requires reconciliation' USING ERRCODE='23514';END IF;
 END LOOP;
END $private_source$;
DO $source$ DECLARE r record;p pg_proc%ROWTYPE;BEGIN
 FOR r IN SELECT * FROM(VALUES ('public.read_sales_invoice(uuid,uuid)','ed189024d3239ef3899dcc888141cb62','fbd612d884e351f6f860802139d6ab80','{postgres=X/postgres,authenticated=X/postgres}'),('public.list_sales_invoices(uuid,integer,uuid)','84ba97fe6eeef437e18785239febecc8','f392e57d33a2dcdf5158cb42a80ded84','{postgres=X/postgres,authenticated=X/postgres}'))x(signature,prior,current,acl) LOOP
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r.signature);
 IF NOT FOUND OR md5(p.prosrc) NOT IN(r.prior,r.current) OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public'] OR p.proacl::text IS DISTINCT FROM r.acl
  OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proretset OR p.prorettype<>'jsonb'::regtype
  OR p.proargnames IS DISTINCT FROM (CASE WHEN r.signature='public.read_sales_invoice(uuid,uuid)'
    THEN ARRAY['_expected_tenant_id','_invoice_id'] ELSE ARRAY['_expected_tenant_id','_limit','_before_id'] END)
  OR p.pronargdefaults IS DISTINCT FROM (CASE WHEN r.signature='public.read_sales_invoice(uuid,uuid)' THEN 0 ELSE 2 END)
  OR (r.signature='public.list_sales_invoices(uuid,integer,uuid)' AND pg_get_expr(p.proargdefaults,0) IS DISTINCT FROM '50, NULL::uuid') THEN
  RAISE EXCEPTION 'Original invoice financial read source/authority changed' USING ERRCODE='23514';END IF;END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public._sales_invoice_financial_position_rows(uuid,uuid,integer,jsonb)') AND md5(prosrc)='bdb0960fa3d88b21cca90b79636dc7e1' AND NOT prosecdef AND proconfig=ARRAY['search_path=""'] AND proacl::text='{postgres=X/postgres}') THEN
  RAISE EXCEPTION 'Original actual position requires reconciliation' USING ERRCODE='23514';END IF;
END $source$;
CREATE OR REPLACE FUNCTION public._sales_invoice_financial_read_version() RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE headers jsonb;version text;
BEGIN
 BEGIN headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';END;
 IF jsonb_typeof(headers) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';END IF;
 IF NOT(headers ? 'x-paige-invoice-evidence-version') THEN RETURN NULL;END IF;
 version:=headers->>'x-paige-invoice-evidence-version';
 IF jsonb_typeof(headers->'x-paige-invoice-evidence-version') IS DISTINCT FROM 'string' OR version NOT IN ('2','3') THEN
  RAISE EXCEPTION 'Invalid invoice financial representation' USING ERRCODE='22023';END IF;
 RETURN version::integer;
END $function$;
CREATE OR REPLACE FUNCTION public._sales_invoice_read(_tenant uuid,_invoice uuid,_payment_limit integer,_financial_version integer) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $function$
DECLARE invoice public.paige_invoices%ROWTYPE;result jsonb;balance record;financial jsonb;summary jsonb;payments jsonb;standing text;
BEGIN
 IF (_financial_version IS NULL OR _financial_version NOT IN (0,3)) OR _payment_limit IS NULL OR _payment_limit NOT BETWEEN 0 AND 50 THEN
  RAISE EXCEPTION 'Invoice financial representation unavailable' USING ERRCODE='22023';END IF;
 -- The ORIGINAL public entry has already locked/re-proved the current actor.
 -- This original invoice lock keeps version, cash, decisions and history coherent.
 SELECT * INTO invoice FROM public.paige_invoices i WHERE i.id=_invoice AND i.tenant_id=_tenant FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invoice unavailable' USING ERRCODE='42501';END IF;
 result:=public._sales_invoice_read(_tenant,_invoice,_payment_limit);
 SELECT * INTO STRICT balance FROM public._sales_invoice_financial_position_rows(_tenant,_invoice);
 IF invoice.status='issued' THEN
  BEGIN SELECT b.financial_position INTO STRICT financial FROM public._sales_invoice_financial_position_rows(_tenant,_invoice,3,NULL::jsonb)b;
  EXCEPTION WHEN SQLSTATE '55000' THEN financial:=NULL;END;
  standing:=coalesce(financial->>'financial_standing','unavailable');
  IF standing NOT IN ('recorded','needs_review','allocation_required','unavailable') THEN RAISE EXCEPTION 'Financial standing unavailable' USING ERRCODE='55000';END IF;
 ELSE standing:='not_applicable';END IF;
 summary:=jsonb_build_object('schema_version',3,'invoice_id',invoice.id,'invoice_version',coalesce(invoice.billing_lifecycle_version,invoice.billing_draft_version),
  'currency',lower(invoice.currency),'standing',standing,
  'outstanding_minor',CASE WHEN standing='recorded' THEN financial->'actual_outstanding_minor' END,
  'refund_payable_minor',CASE WHEN standing='recorded' THEN financial->'refund_payable_minor' END,
  'credit_minor',CASE WHEN standing='recorded' THEN financial->'credit_minor' END,
  'manual_recorded_minor',balance.manual_minor,'provider_confirmed_minor',balance.live_provider_minor,
  'provider_net_minor',CASE WHEN standing='recorded' THEN financial->'provider_settled_net_minor' END,
  'test_provider_minor',balance.test_provider_minor,
  'source_hash',CASE WHEN standing IN ('recorded','needs_review','allocation_required') THEN financial->'financial_source_hash' END);
 IF _financial_version=0 THEN
  IF invoice.status='issued' AND (standing IS DISTINCT FROM 'recorded'
   OR summary->'outstanding_minor' IS DISTINCT FROM result->'remaining_cents'
   OR summary->'refund_payable_minor' IS DISTINCT FROM '0'::jsonb OR summary->'credit_minor' IS DISTINCT FROM '0'::jsonb) THEN
   RAISE EXCEPTION 'Invoice financial representation changed; reload the current financial view' USING ERRCODE='40001';END IF;
  RETURN result;
 END IF;
 SELECT coalesce(jsonb_agg(row.value||jsonb_build_object('evidence_kind',p.evidence_kind,'provider',p.provider,
  'provider_verified_at',p.provider_verified_at,'provider_environment',CASE WHEN p.evidence_kind='provider_verified' THEN p.provider_environment END,
  'financial_review',CASE WHEN p.evidence_kind='provider_verified' AND p.provider_environment='live' THEN
   (SELECT jsonb_build_object('provider_operation_id',d.value->'provider_operation_id',
    'observation_id',d.value->'observation_id','observation_version',d.value->'observation_version',
    'disposition_version',d.value#>'{financial_decision,version}','captured_minor',d.value->'captured_minor',
    'retained_minor',d.value->'retained_minor','returned_minor',d.value->'returned_minor',
    'verification_pending',d.value->'verification_pending','commercial_review_required',d.value->'commercial_review_required',
    'credit_minor',d.value#>'{financial_decision,credit_minor}','decision_operation_id',d.value#>'{financial_decision,decision_operation_id}',
    'decision_current',coalesce((d.value#>>'{financial_decision,version}')::bigint>0
      AND d.value#>'{financial_decision,observation_id}'=d.value->'observation_id'
      AND d.value#>'{financial_decision,observation_version}'=d.value->'observation_version',false))
    FROM jsonb_array_elements(coalesce(financial->'provider_decisions','[]'::jsonb))d(value)
    WHERE d.value->>'provider_operation_id'=p.provider_operation_id::text) END,
  'provenance',CASE WHEN p.evidence_kind='provider_verified' THEN 'provider_verified' WHEN p.import_provenance IS NOT NULL THEN 'owner_imported_unverified' ELSE 'human_recorded' END)
  ORDER BY row.ordinality),'[]'::jsonb) INTO payments FROM jsonb_array_elements(result->'payments') WITH ORDINALITY row(value,ordinality)
 JOIN public.paige_invoice_payments p ON p.id=(row.value->>'id')::uuid AND p.tenant_id=_tenant AND p.invoice_id=_invoice;
 RETURN result||jsonb_build_object('payment_evidence_version',2,'financial_evidence_version',3,'financial_summary',summary,
  'manual_recorded_cents',balance.manual_minor,'provider_verified_cents',balance.live_provider_minor,
  'test_provider_verified_cents',balance.test_provider_minor,'allocated_cents',balance.receivable_allocated_minor,
  'remaining_cents',balance.receivable_remaining_minor,'payments',payments);
END $function$;
CREATE OR REPLACE FUNCTION public.read_sales_invoice(_expected_tenant_id uuid,_invoice_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE mode integer;
BEGIN
 IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501';END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 mode:=public._sales_invoice_financial_read_version();
 RETURN public._sales_invoice_read(_expected_tenant_id,_invoice_id,50,CASE WHEN mode=3 THEN 3 ELSE 0 END);
END $function$;
CREATE OR REPLACE FUNCTION public.list_sales_invoices(_expected_tenant_id uuid,_limit integer DEFAULT 50,_before_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE rows jsonb;ids uuid[];more boolean;mode integer;
BEGIN
 IF public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501';END IF;
 PERFORM public._sales_invoice_actor(auth.uid(),_expected_tenant_id);
 IF _limit IS NULL OR _limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid invoice page' USING ERRCODE='22023';END IF;
 mode:=public._sales_invoice_financial_read_version();
 SELECT array_agg(id ORDER BY id DESC) INTO ids FROM(SELECT id FROM public.paige_invoices WHERE tenant_id=_expected_tenant_id
  AND billing_draft_version IS NOT NULL AND (_before_id IS NULL OR id<_before_id) ORDER BY id DESC LIMIT _limit+1)q;
 more:=coalesce(array_length(ids,1),0)>_limit;
 IF mode=3 THEN
  SELECT coalesce(jsonb_agg(public._sales_invoice_read(_expected_tenant_id,id,0,3) ORDER BY id DESC),'[]'::jsonb) INTO rows FROM unnest(ids[1:_limit])id;
 ELSE
  SELECT coalesce(jsonb_agg(public._sales_invoice_read(_expected_tenant_id,id,0,0) ORDER BY id DESC),'[]'::jsonb) INTO rows FROM unnest(ids[1:_limit])id;
 END IF;
 RETURN jsonb_build_object('rows',rows,'has_more',more,'next_cursor',CASE WHEN more THEN ids[_limit] ELSE NULL END)||CASE WHEN mode=3 THEN jsonb_build_object('financial_evidence_version',3) ELSE '{}'::jsonb END;
END $function$;
REVOKE ALL ON FUNCTION public._sales_invoice_financial_read_version(),public._sales_invoice_read(uuid,uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
