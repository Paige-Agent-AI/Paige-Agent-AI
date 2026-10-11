-- Replaceable QuickBooks source observations, never an AP/payment ledger.
BEGIN;
CREATE TABLE public.finance_accounting_obligation_snapshots (
 binding_id uuid NOT NULL, domain text NOT NULL CHECK(domain IN ('bills','expenses')),
 tenant_id uuid NOT NULL, entity_id uuid NOT NULL, binding_revision bigint NOT NULL CHECK(binding_revision>0),
 version bigint NOT NULL CHECK(version>0), account_snapshot_version bigint NOT NULL CHECK(account_snapshot_version>0),
 observation_id uuid NOT NULL, source_observed_at timestamptz NOT NULL, synchronized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 coverage text NOT NULL CHECK(coverage IN ('complete','partial')), pages_complete boolean NOT NULL,
 records jsonb NOT NULL CHECK(jsonb_typeof(records)='array' AND jsonb_array_length(records)<=500),
 normalized_digest text NOT NULL CHECK(normalized_digest ~ '^[0-9a-f]{64}$'), receipt_run_id uuid NOT NULL,
 PRIMARY KEY(binding_id,domain), CHECK(coverage<>'complete' OR pages_complete),
 FOREIGN KEY(tenant_id,entity_id,binding_id) REFERENCES public.finance_source_bindings(tenant_id,entity_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,entity_id,binding_id,binding_revision,observation_id)
  REFERENCES public.finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,id) ON DELETE RESTRICT
);
ALTER TABLE public.finance_accounting_obligation_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_accounting_obligation_snapshots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.finance_accounting_obligation_snapshots TO service_role;
DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF at=0 OR position('finance_account_source_snapshots' IN body)=0 OR position('finance_accounting_obligation_snapshots' IN body)>0 THEN
  RAISE EXCEPTION 'Canonical Finance retirement policy requires reviewed reconciliation'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''finance_accounting_obligation_snapshots'','||substr(body,at+length(anchor));
END $$;
CREATE FUNCTION public._finance_accounting_obligation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (ROW(NEW.binding_id,NEW.domain,NEW.tenant_id,NEW.entity_id) IS DISTINCT FROM ROW(OLD.binding_id,OLD.domain,OLD.tenant_id,OLD.entity_id)
  OR NEW.version<>OLD.version+1 OR NEW.observation_id=OLD.observation_id) THEN
  RAISE EXCEPTION 'Accounting source replacement requires a new observation' USING ERRCODE='42501'; END IF;
 IF NEW.normalized_digest IS DISTINCT FROM encode(sha256(convert_to(NEW.records::text,'UTF8')),'hex') OR NOT EXISTS(
  SELECT 1 FROM public.finance_source_observations o WHERE o.id=NEW.observation_id AND o.tenant_id=NEW.tenant_id AND o.entity_id=NEW.entity_id
   AND o.binding_id=NEW.binding_id AND o.binding_revision=NEW.binding_revision AND o.domain=NEW.domain
   AND o.source_record_key=NEW.domain||'-snapshot-'||NEW.version AND o.source_observed_at=NEW.source_observed_at
   AND o.coverage=NEW.coverage AND o.pages_complete=NEW.pages_complete AND o.reporting_basis='not_supplied') THEN
  RAISE EXCEPTION 'Accounting observation mismatch' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_accounting_obligation_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_accounting_obligation_guard BEFORE INSERT OR UPDATE ON public.finance_accounting_obligation_snapshots
 FOR EACH ROW EXECUTE FUNCTION public._finance_accounting_obligation_guard();
CREATE FUNCTION public._finance_clear_revoked_accounting_obligations() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.verification_state='revoked' THEN DELETE FROM public.finance_accounting_obligation_snapshots WHERE binding_id=NEW.id; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_clear_revoked_accounting_obligations() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_clear_revoked_accounting_obligations AFTER UPDATE ON public.finance_source_bindings
 FOR EACH ROW EXECUTE FUNCTION public._finance_clear_revoked_accounting_obligations();

CREATE FUNCTION public.replace_finance_accounting_obligations(
 _binding_id uuid,_binding_revision bigint,_account_snapshot_version bigint,_domain text,_expected_version bigint,
 _source_observed_at timestamptz,_coverage text,_pages_complete boolean,_evidence_digest text,_records jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE binding public.finance_source_bindings; accounts public.finance_account_source_snapshots;
 previous public.finance_accounting_obligation_snapshots; actor uuid; locked_actor uuid;
 row jsonb; field text; ref jsonb; ids text[]:='{}'; allowed text[]; amount text; stamp text;
 observation uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid(); next_version bigint;
BEGIN
 IF _domain IS NULL OR _domain NOT IN ('bills','expenses') OR _binding_revision IS NULL OR _binding_revision<1
  OR _account_snapshot_version IS NULL OR _account_snapshot_version<1 OR _expected_version IS NULL OR _expected_version<0
  OR _source_observed_at IS NULL OR NOT isfinite(_source_observed_at) OR _source_observed_at>clock_timestamp()+interval '5 minutes'
  OR _coverage IS NULL OR _coverage NOT IN ('complete','partial') OR _pages_complete IS NULL OR (_coverage='complete' AND NOT _pages_complete)
  OR _evidence_digest IS NULL OR _evidence_digest!~'^[0-9a-f]{64}$' OR _records IS NULL OR jsonb_typeof(_records)<>'array'
  OR jsonb_array_length(_records)>500 OR octet_length(_records::text)>1000000 THEN
  RAISE EXCEPTION 'Invalid bounded accounting source' USING ERRCODE='22023'; END IF;
 SELECT * INTO binding FROM public.finance_source_bindings WHERE id=_binding_id;
 IF NOT FOUND OR binding.provider<>'quickbooks' THEN RAISE EXCEPTION 'Accounting source unavailable' USING ERRCODE='42501'; END IF;
 SELECT user_id INTO actor FROM public.quickbooks_connections WHERE id=binding.quickbooks_connection_id;
 PERFORM public._finance_assert_stored_source_actor(actor,binding.tenant_id);
 PERFORM 1 FROM public.tenant_members WHERE tenant_id=binding.tenant_id AND user_id=actor AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Accounting source receipt authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT user_id INTO locked_actor FROM public.quickbooks_connections WHERE id=binding.quickbooks_connection_id FOR SHARE;
 IF NOT FOUND OR locked_actor IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Accounting source changed' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.finance_company_entities WHERE tenant_id=binding.tenant_id AND id=binding.entity_id FOR SHARE;
 SELECT * INTO binding FROM public.finance_source_bindings WHERE id=_binding_id FOR SHARE;
 IF NOT FOUND OR binding.revision<>_binding_revision OR binding.verification_state<>'verified' THEN
  RAISE EXCEPTION 'Accounting source unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO accounts FROM public.finance_account_source_snapshots WHERE binding_id=binding.id FOR SHARE;
 IF NOT FOUND OR accounts.binding_revision<>binding.revision OR accounts.version<>_account_snapshot_version
  OR _source_observed_at<accounts.source_observed_at THEN RAISE EXCEPTION 'Accounting account evidence changed' USING ERRCODE='40001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-accounting:'||binding.id::text||':'||_domain,0));
 SELECT * INTO previous FROM public.finance_accounting_obligation_snapshots WHERE binding_id=binding.id AND domain=_domain FOR UPDATE;
 IF FOUND THEN
  IF previous.version<>_expected_version OR previous.binding_revision<>binding.revision OR previous.source_observed_at>_source_observed_at THEN
   RAISE EXCEPTION 'Accounting source version changed' USING ERRCODE='40001'; END IF;
 ELSIF _expected_version<>0 THEN RAISE EXCEPTION 'Accounting source version changed' USING ERRCODE='40001'; END IF;
 allowed:=CASE WHEN _domain='bills' THEN ARRAY['nativeId','documentNumber','vendor','currency','transactionDate','dueDate','recordedTotal','recordedOutstanding','accountingStatus','issues','bankSettlementVerified','paymentExecutionSupported']
  ELSE ARRAY['nativeId','documentNumber','entity','paymentAccount','currency','transactionDate','recordedTotal','paymentType','isCredit','recognizedExpense','bankSettlementVerified'] END;
 FOR row IN SELECT value FROM jsonb_array_elements(_records) LOOP
  IF jsonb_typeof(row)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(row) key WHERE NOT key=ANY(allowed))
   OR jsonb_typeof(row->'nativeId') IS DISTINCT FROM 'string' OR length(row->>'nativeId') NOT BETWEEN 1 AND 500
   OR row->>'nativeId'=ANY(ids) THEN RAISE EXCEPTION 'Invalid native accounting record' USING ERRCODE='22023'; END IF;
  ids:=array_append(ids,row->>'nativeId');
  FOREACH field IN ARRAY allowed LOOP
   IF row->field IS NULL THEN RAISE EXCEPTION 'Accounting source field must be explicit' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['recordedTotal','recordedOutstanding'] LOOP
   IF row->>field IS NOT NULL AND (jsonb_typeof(row->field)<>'string' OR row->>field!~'^\d{1,24}(\.\d{1,6})?$') THEN
    RAISE EXCEPTION 'Invalid accounting decimal' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF row->>'currency' IS NOT NULL AND (jsonb_typeof(row->'currency')<>'string' OR row->>'currency'!~'^[A-Z]{3}$') THEN
   RAISE EXCEPTION 'Invalid accounting currency' USING ERRCODE='22023'; END IF;
  IF row->>'documentNumber' IS NOT NULL AND (jsonb_typeof(row->'documentNumber')<>'string' OR length(row->>'documentNumber') NOT BETWEEN 1 AND 500) THEN
   RAISE EXCEPTION 'Invalid accounting description' USING ERRCODE='22023'; END IF;
  FOREACH field IN ARRAY ARRAY['transactionDate','dueDate'] LOOP
   stamp:=row->>field;
   IF stamp IS NOT NULL THEN
    IF jsonb_typeof(row->field)<>'string' OR stamp!~'^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid accounting date' USING ERRCODE='22023'; END IF;
    BEGIN IF (stamp::date)::text<>stamp THEN RAISE EXCEPTION 'Invalid accounting date' USING ERRCODE='22023'; END IF;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'Invalid accounting date' USING ERRCODE='22023'; END;
   END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['vendor','entity','paymentAccount'] LOOP
   ref:=row->field;
   IF ref IS NOT NULL AND ref<>'null'::jsonb THEN
    IF jsonb_typeof(ref)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(ref) key WHERE key NOT IN ('nativeId','sourceLabel'))
     OR jsonb_typeof(ref->'nativeId') IS DISTINCT FROM 'string' OR length(ref->>'nativeId') NOT BETWEEN 1 AND 500 OR ref->'sourceLabel' IS NULL
     OR (ref->>'sourceLabel' IS NOT NULL AND (jsonb_typeof(ref->'sourceLabel')<>'string' OR length(ref->>'sourceLabel') NOT BETWEEN 1 AND 500)) THEN
     RAISE EXCEPTION 'Invalid original accounting reference' USING ERRCODE='22023'; END IF;
   END IF;
  END LOOP;
  IF row->'bankSettlementVerified' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Accounting record cannot confirm bank settlement' USING ERRCODE='22023'; END IF;
  IF _domain='bills' THEN
   amount:=row->>'recordedOutstanding';
   IF amount IS NOT NULL AND row->>'recordedTotal' IS NOT NULL AND amount::numeric>(row->>'recordedTotal')::numeric THEN
    RAISE EXCEPTION 'Conflicting bill balance' USING ERRCODE='22023'; END IF;
   IF row->'paymentExecutionSupported' IS DISTINCT FROM 'false'::jsonb
    OR row->>'accountingStatus' IS DISTINCT FROM (CASE WHEN amount IS NULL THEN 'unknown' WHEN amount::numeric=0 THEN 'recorded_zero_balance' ELSE 'recorded_outstanding' END)
    OR jsonb_typeof(row->'issues') IS DISTINCT FROM 'array' OR jsonb_array_length(row->'issues')>6
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(row->'issues') issue WHERE jsonb_typeof(issue)<>'string'
      OR issue#>>'{}' NOT IN ('total_unknown','balance_unknown','balance_exceeds_total','vendor_unknown','due_date_unknown','transaction_date_unknown')) THEN
    RAISE EXCEPTION 'Invalid bill status or coverage' USING ERRCODE='22023'; END IF;
  ELSE
   IF row->'recognizedExpense' IS DISTINCT FROM 'null'::jsonb OR row->'isCredit' NOT IN ('true'::jsonb,'false'::jsonb,'null'::jsonb)
    OR (row->>'paymentType' IS NOT NULL AND (jsonb_typeof(row->'paymentType')<>'string' OR row->>'paymentType' NOT IN ('Cash','Check','CreditCard'))) THEN
    RAISE EXCEPTION 'Purchase cannot establish recognized expense' USING ERRCODE='22023'; END IF;
  END IF;
 END LOOP;
 next_version:=_expected_version+1;
 INSERT INTO public.finance_source_observations(id,tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,pages_complete,evidence_digest,reporting_basis)
 VALUES(observation,binding.tenant_id,binding.entity_id,binding.id,binding.revision,_domain||'-snapshot-'||next_version,_domain,_source_observed_at,_coverage,_pages_complete,_evidence_digest,'not_supplied');
 PERFORM public.record_capability_run(binding.tenant_id,actor,'finance_accounting_source_refresh','capability_succeeded',receipt,NULL,NULL,NULL,NULL,NULL);
 INSERT INTO public.finance_accounting_obligation_snapshots(binding_id,domain,tenant_id,entity_id,binding_revision,version,account_snapshot_version,observation_id,source_observed_at,coverage,pages_complete,records,normalized_digest,receipt_run_id)
 VALUES(binding.id,_domain,binding.tenant_id,binding.entity_id,binding.revision,next_version,accounts.version,observation,_source_observed_at,_coverage,_pages_complete,_records,encode(sha256(convert_to(_records::text,'UTF8')),'hex'),receipt)
 ON CONFLICT(binding_id,domain) DO UPDATE SET binding_revision=EXCLUDED.binding_revision,version=EXCLUDED.version,account_snapshot_version=EXCLUDED.account_snapshot_version,
  observation_id=EXCLUDED.observation_id,source_observed_at=EXCLUDED.source_observed_at,synchronized_at=clock_timestamp(),coverage=EXCLUDED.coverage,pages_complete=EXCLUDED.pages_complete,
  records=EXCLUDED.records,normalized_digest=EXCLUDED.normalized_digest,receipt_run_id=EXCLUDED.receipt_run_id;
 RETURN jsonb_build_object('version',next_version,'observation_id',observation,'receipt_run_id',receipt,'provider_effect',false);
END $$;
REVOKE ALL ON FUNCTION public.replace_finance_accounting_obligations(uuid,bigint,bigint,text,bigint,timestamptz,text,boolean,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_finance_accounting_obligations(uuid,bigint,bigint,text,bigint,timestamptz,text,boolean,text,jsonb) TO service_role;

CREATE FUNCTION public.read_finance_accounting_obligations(_expected_tenant uuid,_entity_id uuid,_binding_id uuid,_domain text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account jsonb; snapshot public.finance_accounting_obligation_snapshots;
BEGIN
 IF _domain IS NULL OR _domain NOT IN ('bills','expenses') THEN RAISE EXCEPTION 'Invalid accounting source domain' USING ERRCODE='22023'; END IF;
 account:=public.read_finance_account_source(_expected_tenant,_entity_id,_binding_id);
 IF account->>'provider'<>'quickbooks' OR account->>'coverage'='unavailable' THEN
  RETURN jsonb_build_object('coverage','unavailable','records',NULL,'reason','accounting_source_unavailable'); END IF;
 SELECT * INTO snapshot FROM public.finance_accounting_obligation_snapshots WHERE binding_id=_binding_id AND domain=_domain AND tenant_id=_expected_tenant AND entity_id=_entity_id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('coverage','unavailable','records',NULL,'reason','accounting_records_not_supplied'); END IF;
 IF snapshot.binding_revision<>(account->>'binding_revision')::bigint OR snapshot.account_snapshot_version<>(account->>'version')::bigint THEN
  RETURN jsonb_build_object('coverage','unavailable','records',NULL,'reason','account_evidence_changed'); END IF;
 RETURN jsonb_build_object('domain',snapshot.domain,'binding_id',snapshot.binding_id,'binding_revision',snapshot.binding_revision,'version',snapshot.version,
  'account_snapshot_version',snapshot.account_snapshot_version,'coverage',snapshot.coverage,'pages_complete',snapshot.pages_complete,'records',snapshot.records,
  'source_observed_at',snapshot.source_observed_at,'synchronized_at',snapshot.synchronized_at,'normalized_digest',snapshot.normalized_digest,
  'observation_id',snapshot.observation_id,'receipt_run_id',snapshot.receipt_run_id,'temporal_basis','source_snapshot','institution_freshness_verified',false,
  'recognized_expenses',NULL,'bank_settlement_verified',false,'payment_execution_supported',false);
END $$;
REVOKE ALL ON FUNCTION public.read_finance_accounting_obligations(uuid,uuid,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_finance_accounting_obligations(uuid,uuid,uuid,text) TO authenticated;
COMMIT;
