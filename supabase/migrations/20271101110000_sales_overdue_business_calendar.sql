-- Sales #2086: private overdue producer v1.1.0 uses the canonical business calendar.
-- Other metric definitions and all ledger/scheduler/issuer/consumer contracts remain unchanged.
-- Release requires coordinated shared issuer/resolver and consumer version acceptance.

CREATE OR REPLACE FUNCTION public._sales_performance_metric_bundle(
 p_tenant_id uuid,p_metric_key text,p_metric_version text,
 p_range_start timestamptz,p_range_end timestamptz,p_as_of timestamptz,p_dimensions jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
 actor uuid:=auth.uid(); pipeline_filter uuid; stage_filter uuid;
 source_rows jsonb; candidate bigint; contributing bigint; excluded bigint;
 exclusions jsonb; currencies jsonb; breakdown jsonb; freshness timestamptz;
 digest text; sources jsonb; label text; definition text; formula text; unit text;
 snapshot boolean:=false; caveats jsonb:='[]'; zeros bigint:=0; tests bigint:=0; imported bigint:=0;
 values jsonb; current_status text;
 business_zone text; stored_business_zone text; business_zone_set_at timestamptz;
 business_zone_state text; business_date date; business_calendar jsonb;
BEGIN
 -- Defense in depth even though only the shared issuer's owner can call this.
 -- Finance lens never inherits platform-owner access or an arbitrary tenant ID.
 IF actor IS NULL OR p_tenant_id IS NULL OR public.current_user_tenant_id() IS DISTINCT FROM p_tenant_id
  OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=actor AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp()))
  OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=actor AND p.active_tenant_id=p_tenant_id)
  OR NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=p_tenant_id AND m.user_id=actor AND m.status='active' AND m.role IN ('owner','admin'))
  OR NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.status::text IN ('trial','active','past_due')) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SALES_METRIC_UNAVAILABLE';
 END IF;
 IF p_metric_version IS DISTINCT FROM (CASE WHEN p_metric_key='sales.receivables.overdue_current' THEN '1.1.0' ELSE '1.0.0' END) OR p_metric_key IS NULL OR p_metric_key NOT IN (
  'sales.opportunities.created','sales.opportunities.open_current','sales.opportunities.won_current_close_date','sales.opportunities.lost_current_close_date',
  'sales.pipeline.open_value','sales.invoices.issued_count','sales.invoices.issued_amount',
  'sales.receivables.outstanding_current','sales.receivables.overdue_current','sales.cash.recorded_received','sales.payments.posted_net_allocations')
  OR p_range_start IS NULL OR p_range_end IS NULL OR p_as_of IS NULL
  OR NOT isfinite(p_range_start) OR NOT isfinite(p_range_end) OR NOT isfinite(p_as_of)
  OR p_range_start>=p_range_end OR p_range_end>p_as_of OR p_range_end-p_range_start>interval '10 years'
  OR p_dimensions IS NULL OR jsonb_typeof(p_dimensions)<>'object' OR octet_length(p_dimensions::text)>500 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SALES_METRIC_CONTRACT_INVALID';
 END IF;
 IF p_metric_key IN ('sales.opportunities.won_current_close_date','sales.opportunities.lost_current_close_date')
  AND (p_range_start<>date_trunc('day',p_range_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
   OR p_range_end<>date_trunc('day',p_range_end AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SALES_METRIC_DATE_RANGE_REQUIRES_UTC_MIDNIGHT';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_dimensions) k WHERE k NOT IN ('pipeline_id','stage_id'))
  OR (p_dimensions<>'{}'::jsonb AND p_metric_key NOT LIKE 'sales.opportunities.%' AND p_metric_key<>'sales.pipeline.open_value') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SALES_METRIC_DIMENSION_INVALID';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_dimensions) e WHERE jsonb_typeof(e.value)<>'string' OR e.value#>>'{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='SALES_METRIC_DIMENSION_INVALID';
 END IF;
 pipeline_filter:=(p_dimensions->>'pipeline_id')::uuid; stage_filter:=(p_dimensions->>'stage_id')::uuid;
 IF (pipeline_filter IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.pipelines p WHERE p.id=pipeline_filter AND p.tenant_id=p_tenant_id))
  OR (stage_filter IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.pipeline_stages s WHERE s.id=stage_filter AND s.tenant_id=p_tenant_id AND (pipeline_filter IS NULL OR s.pipeline_id=pipeline_filter))) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='SALES_METRIC_UNAVAILABLE';
 END IF;

 -- Reuse the business owner's canonical calendar setting; never default to viewer/server/UTC.
 -- Same accepted shape as set_business_time_zone, then the same conversion as Collections.
 IF p_metric_key='sales.receivables.overdue_current' THEN
  SELECT z.time_zone,z.set_at INTO stored_business_zone,business_zone_set_at
  FROM public.tenant_business_time_zones z WHERE z.tenant_id=p_tenant_id;
  business_zone:=stored_business_zone;
  IF business_zone IS NULL THEN business_zone_state:='missing';
  ELSIF business_zone !~ '^(UTC|(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z][A-Za-z0-9_+-]*)?)$'
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=business_zone) THEN
   business_zone_state:='invalid'; business_zone:=NULL;
  ELSE
   BEGIN
    business_date:=(p_as_of AT TIME ZONE business_zone)::date; business_zone_state:='configured';
   EXCEPTION WHEN invalid_parameter_value THEN
    business_zone_state:='invalid'; business_zone:=NULL; business_date:=NULL;
   END;
  END IF;
  business_calendar:=jsonb_build_object('state',business_zone_state,'zone',business_zone,
   'set_at',business_zone_set_at,'as_of_date',business_date);
 END IF;

 IF p_metric_key LIKE 'sales.opportunities.%' OR p_metric_key='sales.pipeline.open_value' THEN
  snapshot:=p_metric_key IN ('sales.opportunities.open_current','sales.pipeline.open_value');
  current_status:=CASE WHEN snapshot THEN 'open' WHEN p_metric_key LIKE '%won_current%' THEN 'won' WHEN p_metric_key LIKE '%lost_current%' THEN 'lost' END;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'status',d.status,'pipeline_id',d.pipeline_id,'stage_id',d.stage_id,
   'value',d.value_cents,'currency',lower(d.currency),'created_at',d.created_at,'actual_close_date',d.actual_close_date,'observed_at',d.updated_at,
   'reason',CASE
    WHEN current_status IN ('won','lost') AND d.actual_close_date IS NULL THEN 'missing_close_date'
    WHEN p_metric_key='sales.pipeline.open_value' AND (p.id IS NULL OR s.id IS NULL) THEN 'invalid_pipeline_stage'
    WHEN p_metric_key='sales.pipeline.open_value' AND (d.value_cents IS NULL OR d.value_cents<0) THEN 'invalid_value'
    WHEN p_metric_key='sales.pipeline.open_value' AND (d.currency IS NULL OR lower(d.currency)!~'^[a-z]{3}$') THEN 'invalid_currency'
    ELSE NULL END) ORDER BY d.id),'[]'::jsonb) INTO source_rows
  FROM public.deals d LEFT JOIN public.pipelines p ON p.id=d.pipeline_id AND p.tenant_id=p_tenant_id
  LEFT JOIN public.pipeline_stages s ON s.id=d.stage_id AND s.tenant_id=p_tenant_id AND s.pipeline_id=d.pipeline_id
  WHERE d.tenant_id=p_tenant_id AND (pipeline_filter IS NULL OR d.pipeline_id=pipeline_filter) AND (stage_filter IS NULL OR d.stage_id=stage_filter)
   AND (current_status IS NULL OR d.status=current_status)
   AND (snapshot OR (current_status IS NULL AND d.created_at>=p_range_start AND d.created_at<p_range_end)
    OR (current_status IN ('won','lost') AND (d.actual_close_date IS NULL OR (d.actual_close_date>=(p_range_start AT TIME ZONE 'UTC')::date AND d.actual_close_date<(p_range_end AT TIME ZONE 'UTC')::date))));
  sources:='["public.deals"]';unit:='count';
  label:=CASE p_metric_key WHEN 'sales.opportunities.created' THEN 'Opportunities created' WHEN 'sales.opportunities.open_current' THEN 'Open opportunities now' WHEN 'sales.opportunities.won_current_close_date' THEN 'Currently won opportunities dated in range' WHEN 'sales.opportunities.lost_current_close_date' THEN 'Currently lost opportunities dated in range' ELSE 'Open pipeline value' END;
  definition:='Canonical deal records in the stated cohort; current status is not historical stage conversion.';
  formula:=CASE WHEN p_metric_key='sales.pipeline.open_value' THEN 'SUM(eligible open deal value_cents) GROUP BY currency' ELSE 'COUNT(eligible canonical deals)' END;
  IF p_metric_key='sales.pipeline.open_value' THEN
   unit:='currency_minor';sources:='["public.deals","public.pipelines","public.pipeline_stages"]';
   SELECT count(*) INTO zeros FROM jsonb_array_elements(source_rows) r WHERE r->>'reason' IS NULL AND (r->>'value')::numeric=0;
   caveats:=caveats||jsonb_build_array('Zero is the deal schema default; zero-valued opportunities may have unrecorded values.');
  END IF;
  IF current_status IN ('won','lost') THEN caveats:=caveats||jsonb_build_array('Current closed-date cohort: reopening changes membership. Missing close dates are excluded. Not immutable historical wins/losses.'); END IF;
 ELSIF p_metric_key LIKE 'sales.invoices.%' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'value',i.amount_total_cents,'currency',lower(i.currency),'status',i.status,
   'issued_at',i.billing_issued_at,'issued_version',i.billing_issued_snapshot_version,'document_digest',i.billing_document_digest,'document_present',i.billing_document IS NOT NULL,'observed_at',i.updated_at,
   'reason',CASE WHEN i.status='void' THEN 'voided_invoice' WHEN i.billing_issued_at IS NULL OR i.billing_issued_snapshot_version IS NULL OR i.billing_document IS NULL OR i.billing_document_digest IS NULL THEN 'missing_issue_evidence'
    WHEN i.status NOT IN ('issued','paid','sent') THEN 'not_issued' WHEN i.amount_total_cents IS NULL OR i.amount_total_cents<0 THEN 'invalid_amount'
    WHEN i.currency IS NULL OR lower(i.currency)!~'^[a-z]{3}$' THEN 'invalid_currency' ELSE NULL END) ORDER BY i.id),'[]'::jsonb) INTO source_rows
  FROM public.paige_invoices i WHERE i.tenant_id=p_tenant_id AND i.status<>'draft'
   AND ((i.billing_issued_at>=p_range_start AND i.billing_issued_at<p_range_end) OR (i.billing_issued_at IS NULL AND i.status IN ('sent','paid','issued')));
  sources:='["public.paige_invoices"]';unit:=CASE WHEN p_metric_key LIKE '%count' THEN 'count' ELSE 'currency_minor' END;
  label:=CASE WHEN unit='count' THEN 'Non-void invoices issued' ELSE 'Non-void invoice face amount issued' END;
  definition:='Canonical issuance in range, excluding currently void invoices, drafts and records without frozen issuance evidence.';
  formula:=CASE WHEN unit='count' THEN 'COUNT(canonically issued, currently non-void invoices in issuance range)' ELSE 'SUM(issued face amount) GROUP BY currency; exclude currently void invoices' END;
  caveats:=jsonb_build_array('Issued face amount is not collected cash. Later voiding restates this non-void issuance cohort. Legacy records without issuance evidence are excluded and disclosed.');
 ELSIF p_metric_key LIKE 'sales.receivables.%' THEN
  snapshot:=true;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'value',b.remaining_minor,'currency',lower(i.currency),'status',i.status,
   'amount',b.amount_minor,'allocated',b.allocated_minor,'manual',b.manual_minor,'verified',b.provider_minor,'test',b.test_provider_minor,
   'imported',i.billing_import_provenance IS NOT NULL,'due_date',i.due_date,'observed_at',greatest(i.updated_at,p.observed_at),
   'reason',CASE WHEN i.currency IS NULL OR lower(i.currency)!~'^[a-z]{3}$' THEN 'invalid_currency'
    WHEN b.remaining_minor<0 THEN 'negative_balance' WHEN p_metric_key LIKE '%overdue%' AND i.due_date IS NULL THEN 'missing_due_date' ELSE NULL END) ORDER BY i.id),'[]'::jsonb) INTO source_rows
  FROM public.paige_invoices i JOIN public._sales_invoice_balance_rows(p_tenant_id) b ON b.invoice_id=i.id
  LEFT JOIN LATERAL(SELECT max(created_at) observed_at FROM public.paige_invoice_payments WHERE tenant_id=p_tenant_id AND invoice_id=i.id) p ON true
  WHERE i.tenant_id=p_tenant_id AND i.status IN ('issued','recorded')
   AND (p_metric_key NOT LIKE '%overdue%' OR (b.remaining_minor<>0 AND (i.due_date IS NULL OR business_zone_state<>'configured' OR i.due_date<business_date)));
  sources:='["public.paige_invoices","public.paige_invoice_payments","public._sales_invoice_balance_rows"]';unit:='currency_minor';
  IF p_metric_key='sales.receivables.overdue_current' THEN
   sources:=sources||jsonb_build_array('public.tenant_business_time_zones');
  END IF;
  label:=CASE WHEN p_metric_key LIKE '%overdue%' THEN 'Overdue receivables now' ELSE 'Outstanding receivables now' END;
  definition:='Canonical Collections remaining balance on collectible issued/recorded obligations; current snapshot.';
  formula:=CASE WHEN p_metric_key='sales.receivables.overdue_current' THEN
   'SUM(canonical positive remaining_minor on collectible issued/recorded obligations with due_date before business-local as_of date) GROUP BY currency'
   ELSE 'SUM(canonical remaining_minor) GROUP BY currency; overdue additionally requires positive balance and due_date before UTC as_of date' END;
  SELECT count(*) INTO tests FROM jsonb_array_elements(source_rows) r WHERE coalesce((r->>'test')::numeric,0)<>0;
  caveats:=jsonb_build_array('Includes owner-imported recorded obligations separately identified in coverage. Drafts and void/uncollectible obligations are outside scope.',
   'Canonical balances include test allocations where present. Business cash excludes test allocations; these populations are not a reconciled cash-to-receivables waterfall.',
   'Current balances are not historical balances; no previous-period comparison.');
 ELSE
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'invoice_id',p.invoice_id,'value',CASE WHEN p.kind='receipt' THEN p.amount_cents ELSE -p.amount_cents END,
   'currency',lower(p.currency),'kind',p.kind,'received_at',p.received_at,'posted_at',p.created_at,'environment',p.provider_environment,'evidence_kind',p.evidence_kind,
   'source',CASE WHEN p.evidence_kind='provider_verified' THEN 'provider_verified_live' WHEN p.import_provenance IS NOT NULL THEN 'owner_imported_unverified' ELSE 'human_recorded' END,
   'observed_at',greatest(p.created_at,p.provider_verified_at),'reason',CASE
    WHEN i.id IS NULL THEN 'invalid_invoice_relationship'
    WHEN p.kind NOT IN ('receipt','reversal') OR p.amount_cents IS NULL OR p.amount_cents<=0 THEN 'invalid_payment'
    WHEN p.currency IS NULL OR lower(p.currency)!~'^[a-z]{3}$' OR lower(p.currency) IS DISTINCT FROM lower(i.currency) THEN 'invalid_currency'
    WHEN p.evidence_kind='provider_verified' AND p.provider_environment='test' THEN 'test_payment'
    WHEN p.evidence_kind='provider_verified' AND (p.provider_environment IS DISTINCT FROM 'live' OR p.provider_verified_at IS NULL OR p.provider IS NULL OR p.provider NOT IN ('stripe','paypal')) THEN 'unverified_provider_payment'
    WHEN p.evidence_kind NOT IN ('manual_recorded','provider_verified') OR p.evidence_kind IS NULL THEN 'unsupported_evidence_class'
    ELSE NULL END) ORDER BY p.id),'[]'::jsonb) INTO source_rows
  FROM public.paige_invoice_payments p LEFT JOIN public.paige_invoices i ON i.id=p.invoice_id AND i.tenant_id=p_tenant_id
  WHERE p.tenant_id=p_tenant_id AND CASE WHEN p_metric_key='sales.cash.recorded_received' THEN p.received_at>=p_range_start AND p.received_at<p_range_end ELSE p.created_at>=p_range_start AND p.created_at<p_range_end END;
  sources:='["public.paige_invoice_payments","public.paige_invoices"]';unit:='currency_minor';
  label:=CASE WHEN p_metric_key='sales.cash.recorded_received' THEN 'Recorded cash by receipt date' ELSE 'Net payment allocations posted' END;
  definition:='Signed canonical ledger receipts and reversals, separated by evidence class; provider TEST allocations excluded.';
  formula:='SUM(receipt amount_minor - reversal amount_minor) GROUP BY currency, evidence class';
  caveats:=jsonb_build_array('Human/off-platform and imported receipts are business records, not provider verification. Payment requests and unknown operations never count.',
   CASE WHEN p_metric_key='sales.cash.recorded_received' THEN 'Corrections use the original received date and can restate earlier periods.' ELSE 'Posting date measures when an allocation/correction was recorded, not bank settlement date.' END,
   'Verified provider reversal lifecycle remains incomplete; this metric represents canonical recorded allocations, not a bank reconciliation statement.',
   'Historical recorded payments remain in the ledger even when their invoice is later voided; voiding a receivable does not itself reverse a receipt.');
 END IF;

 SELECT count(*),count(*) FILTER(WHERE r->>'reason' IS NULL),max((r->>'observed_at')::timestamptz),
  count(*) FILTER(WHERE r->>'reason' IS NULL AND (r->>'imported'='true' OR r->>'source'='owner_imported_unverified'))
 INTO candidate,contributing,freshness,imported FROM jsonb_array_elements(source_rows) r;
 excluded:=candidate-contributing;
 SELECT coalesce(jsonb_agg(jsonb_build_object('reason',reason,'count',n) ORDER BY reason),'[]'::jsonb) INTO exclusions
 FROM(SELECT r->>'reason' reason,count(*) n FROM jsonb_array_elements(source_rows) r WHERE r->>'reason' IS NOT NULL GROUP BY r->>'reason') x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('currency',currency,'amount_minor',amount::text,'record_count',n) ORDER BY currency),'[]'::jsonb) INTO currencies
 FROM(SELECT r->>'currency' currency,sum((r->>'value')::numeric) amount,count(*) n FROM jsonb_array_elements(source_rows) r WHERE r->>'reason' IS NULL GROUP BY r->>'currency') x;
 SELECT coalesce(jsonb_agg(jsonb_build_object('currency',currency,'source',source,'amount_minor',amount::text,'record_count',n) ORDER BY currency,source),'[]'::jsonb) INTO breakdown
 FROM(SELECT r->>'currency' currency,r->>'source' source,sum((r->>'value')::numeric) amount,count(*) n FROM jsonb_array_elements(source_rows) r WHERE r->>'reason' IS NULL AND r ? 'source' GROUP BY r->>'currency',r->>'source') x;
 digest:='sr_v1_'||encode(extensions.digest(convert_to((jsonb_build_object('tenant',p_tenant_id,'metric',p_metric_key,'version',p_metric_version,
  'range_start',p_range_start,'range_end',p_range_end,'as_of',p_as_of,'dimensions',p_dimensions,'rows',source_rows)
  ||CASE WHEN p_metric_key='sales.receivables.overdue_current' THEN
   jsonb_build_object('business_time_zone',business_calendar,'stored_zone',stored_business_zone) ELSE '{}'::jsonb END)::text,'UTF8'),'sha256'),'hex');
 IF p_metric_key='sales.receivables.overdue_current' THEN
  freshness:=greatest(freshness,business_zone_set_at);
  caveats:=caveats||jsonb_build_array('Overdue uses the business owner configured calendar day; due today is not overdue. Missing or invalid business time zone holds this judgement. Reporting ranges remain UTC and are not the overdue calendar.');
 END IF;
 values:=CASE WHEN unit='count' THEN jsonb_build_object('kind','count','count',contributing) ELSE jsonb_build_object('kind','currency_totals','by_currency',currencies,'breakdown',breakdown) END;
 RETURN jsonb_build_object('metric_key',p_metric_key,'metric_version',p_metric_version,'owner_department','sales','label',label,'definition',definition,'formula',formula,
  'range',jsonb_build_object('start',p_range_start,'end',p_range_end,'bounds','[start,end)','timezone','UTC','semantics',CASE WHEN snapshot THEN 'current_snapshot' WHEN current_status IN ('won','lost') THEN 'current_status_date_cohort' ELSE 'event_timestamp_cohort' END),
  'dimensions',p_dimensions,'values',values,'unit',unit,'source_refs',sources,'as_of',p_as_of,
  'freshness',jsonb_build_object('queried_at',p_as_of,'source_updated_through',freshness),
  'coverage',jsonb_build_object('state',CASE WHEN candidate>0 AND contributing=0 THEN 'unavailable' WHEN excluded>0 OR zeros>0 OR tests>0 THEN 'partial' ELSE 'complete' END,'candidate_count',candidate,'contributing_count',contributing,'excluded_count',excluded,'zero_value_count',zeros,'test_affected_obligation_count',tests,'owner_imported_count',imported),
  'exclusions',exclusions,'truth_state',CASE WHEN candidate>0 AND contributing=0 THEN 'UNAVAILABLE' WHEN excluded>0 OR zeros>0 OR tests>0 THEN 'PARTIAL' ELSE 'LIVE' END,
  'caveats',caveats,'source_revision_ref',digest,'evidence_ref',NULL,'evidence_state','shared_issuance_required')
  ||CASE WHEN p_metric_key='sales.receivables.overdue_current' THEN
   jsonb_build_object('business_time_zone',business_calendar)
    ||CASE WHEN business_zone_state<>'configured' THEN jsonb_build_object(
     'values',NULL,'truth_state','UNAVAILABLE',
     'coverage',jsonb_build_object('state','unavailable','reason','business_time_zone_'||business_zone_state,
      'candidate_count',candidate,'contributing_count',0,'excluded_count',candidate,
      'zero_value_count',zeros,'test_affected_obligation_count',tests,'owner_imported_count',imported),
     'exclusions',jsonb_build_array(jsonb_build_object('reason','business_time_zone_'||business_zone_state,'count',candidate)))
    ELSE '{}'::jsonb END
   ELSE '{}'::jsonb END;
END $$;
REVOKE ALL ON FUNCTION public._sales_performance_metric_bundle(uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public._sales_performance_metric_bundle(uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb) IS
 'INT-341 private Sales metric producer. Shared INT-340 issuer owns opaque evidence reference; no direct caller grants, KPI cache, provider action or Chat tool.';
