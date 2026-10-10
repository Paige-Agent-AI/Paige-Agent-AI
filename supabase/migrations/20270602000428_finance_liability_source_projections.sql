-- Replaceable, company/account-bound lender source records; never a debt ledger.
BEGIN;
CREATE TABLE public.finance_liability_source_snapshots (
 binding_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
 binding_revision bigint NOT NULL CHECK(binding_revision>0), version bigint NOT NULL CHECK(version>0),
 account_snapshot_version bigint NOT NULL CHECK(account_snapshot_version>0), observation_id uuid NOT NULL,
 source_observed_at timestamptz NOT NULL, synchronized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 coverage text NOT NULL CHECK(coverage='partial'), records jsonb NOT NULL CHECK(jsonb_typeof(records)='array' AND jsonb_array_length(records)<=500),
 normalized_digest text NOT NULL CHECK(normalized_digest ~ '^[0-9a-f]{64}$'), receipt_run_id uuid NOT NULL,
 FOREIGN KEY(tenant_id,entity_id,binding_id) REFERENCES public.finance_source_bindings(tenant_id,entity_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,entity_id,binding_id,binding_revision,observation_id)
  REFERENCES public.finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,id) ON DELETE RESTRICT
);
ALTER TABLE public.finance_liability_source_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_liability_source_snapshots FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.finance_liability_source_snapshots TO service_role;
DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF at=0 OR position('finance_account_source_snapshots' IN body)=0 OR position('finance_liability_source_snapshots' IN body)>0 THEN
  RAISE EXCEPTION 'Canonical Finance retirement policy requires reconciliation'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''finance_liability_source_snapshots'','||substr(body,at+length(anchor));
END $$;

CREATE FUNCTION public._finance_liability_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF public._finance_retirement_allowed(OLD.tenant_id) OR EXISTS(SELECT 1 FROM public.finance_source_bindings WHERE id=OLD.binding_id AND verification_state='revoked') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Financial source cache cannot be erased directly' USING ERRCODE='42501';
 END IF;
 IF TG_OP='UPDATE' AND (ROW(NEW.binding_id,NEW.tenant_id,NEW.entity_id) IS DISTINCT FROM ROW(OLD.binding_id,OLD.tenant_id,OLD.entity_id)
  OR NEW.version<>OLD.version+1 OR NEW.observation_id=OLD.observation_id) THEN
  RAISE EXCEPTION 'Financial liability snapshot requires new scoped evidence' USING ERRCODE='42501'; END IF;
 IF NEW.normalized_digest IS DISTINCT FROM encode(sha256(convert_to(NEW.records::text,'UTF8')),'hex') OR NOT EXISTS(
  SELECT 1 FROM public.finance_source_observations o WHERE o.id=NEW.observation_id AND o.tenant_id=NEW.tenant_id AND o.entity_id=NEW.entity_id
   AND o.binding_id=NEW.binding_id AND o.binding_revision=NEW.binding_revision AND o.domain='liabilities'
   AND o.source_record_key='liability-snapshot-'||NEW.version AND o.source_observed_at=NEW.source_observed_at AND o.coverage=NEW.coverage) THEN
  RAISE EXCEPTION 'Financial liability evidence does not match' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_liability_snapshot_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_liability_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON public.finance_liability_source_snapshots
 FOR EACH ROW EXECUTE FUNCTION public._finance_liability_snapshot_guard();
CREATE FUNCTION public._finance_clear_revoked_liability_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.verification_state='revoked' THEN DELETE FROM public.finance_liability_source_snapshots WHERE binding_id=NEW.id; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_clear_revoked_liability_snapshot() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_clear_revoked_liability_snapshot AFTER UPDATE ON public.finance_source_bindings
 FOR EACH ROW EXECUTE FUNCTION public._finance_clear_revoked_liability_snapshot();

CREATE FUNCTION public.replace_finance_liability_source_snapshot(
 _binding_id uuid,_binding_revision bigint,_account_snapshot_version bigint,_expected_version bigint,
 _source_observed_at timestamptz,_evidence_digest text,_records jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE binding public.finance_source_bindings; accounts public.finance_account_source_snapshots; previous public.finance_liability_source_snapshots;
 actor uuid; locked_actor uuid; native_id text; row jsonb; account jsonb; field text; apr jsonb; date_value date;
 next_version bigint; observation uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid();
BEGIN
 IF _binding_revision IS NULL OR _account_snapshot_version IS NULL OR _account_snapshot_version<1 OR _expected_version IS NULL OR _expected_version<0
  OR _source_observed_at IS NULL OR NOT isfinite(_source_observed_at) OR _source_observed_at>clock_timestamp()+interval '5 minutes'
  OR (_evidence_digest ~ '^[0-9a-f]{64}$') IS NOT TRUE OR _records IS NULL OR jsonb_typeof(_records)<>'array'
  OR jsonb_array_length(_records)>500 OR octet_length(_records::text)>1048576 THEN
  RAISE EXCEPTION 'Invalid financial liability snapshot' USING ERRCODE='22023'; END IF;
 SELECT * INTO binding FROM public.finance_source_bindings WHERE id=_binding_id;
 IF NOT FOUND OR binding.provider<>'plaid' THEN RAISE EXCEPTION 'Supported lender source unavailable' USING ERRCODE='42501'; END IF;
 SELECT user_id INTO actor FROM public.connected_bank_accounts WHERE id=binding.plaid_account_anchor_id;
 PERFORM public._finance_assert_stored_source_actor(actor,binding.tenant_id);
 PERFORM 1 FROM public.tenant_members WHERE tenant_id=binding.tenant_id AND user_id=actor AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Financial snapshot receipt authority unavailable' USING ERRCODE='42501'; END IF;
 SELECT user_id,account_id INTO locked_actor,native_id FROM public.connected_bank_accounts WHERE id=binding.plaid_account_anchor_id FOR SHARE;
 IF NOT FOUND OR locked_actor IS DISTINCT FROM actor THEN RAISE EXCEPTION 'Financial source changed' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.finance_company_entities WHERE tenant_id=binding.tenant_id AND id=binding.entity_id FOR SHARE;
 SELECT * INTO binding FROM public.finance_source_bindings WHERE id=_binding_id FOR SHARE;
 IF NOT FOUND OR binding.revision<>_binding_revision OR binding.verification_state<>'verified' THEN RAISE EXCEPTION 'Financial source unavailable' USING ERRCODE='42501'; END IF;
 -- Account identity/terms must derive from one specified normalized account version.
 SELECT * INTO accounts FROM public.finance_account_source_snapshots WHERE binding_id=binding.id FOR SHARE;
 IF NOT FOUND OR accounts.binding_revision<>binding.revision OR accounts.version<>_account_snapshot_version
  OR accounts.source_observed_at<>_source_observed_at THEN RAISE EXCEPTION 'Financial account evidence changed' USING ERRCODE='40001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-liability-snapshot:'||binding.id::text,0));
 SELECT * INTO previous FROM public.finance_liability_source_snapshots WHERE binding_id=binding.id FOR UPDATE;
 IF FOUND THEN
  IF previous.version<>_expected_version OR previous.binding_revision<>binding.revision OR previous.source_observed_at>_source_observed_at THEN
   RAISE EXCEPTION 'Financial liability snapshot changed' USING ERRCODE='40001'; END IF;
 ELSIF _expected_version<>0 THEN RAISE EXCEPTION 'Financial liability snapshot changed' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_records) r GROUP BY r->>'nativeId' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate native liability identity' USING ERRCODE='22023'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(_records) LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR jsonb_typeof(row->'nativeId') IS DISTINCT FROM 'string' OR row->>'nativeId' IS DISTINCT FROM native_id
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(row) k WHERE k NOT IN ('nativeId','sourceLabel','sourceType','sourceSubtype','product','currency','unofficialCurrency',
    'outstandingBalance','principalBalance','originalPrincipal','creditLimit','availableCredit','minimumPayment','nextPayment','nextPaymentDueDate','maturityDate',
    'drawPeriodEndDate','paymentFrequency','interestRatePercentage','interestRateType','aprs','principalPayment','interestPayment','collateralVerified','guaranteeVerified',
    'institutionUpdatedAt','accountingClassificationVerified','companyOwnershipVerified')) THEN RAISE EXCEPTION 'Invalid native liability record' USING ERRCODE='22023'; END IF;
  SELECT value INTO account FROM jsonb_array_elements(accounts.accounts) WHERE value->>'native_id'=row->>'nativeId';
  IF NOT FOUND OR row->>'product' IS NULL OR row->>'product' NOT IN ('credit_card','revolving_line','loan_obligation')
   OR row->>'sourceSubtype' IN ('student','mortgage')
   OR row->>'product' IS DISTINCT FROM account->>'product' OR row->>'sourceLabel' IS DISTINCT FROM account->>'source_label'
   OR row->>'currency' IS DISTINCT FROM account->>'currency' THEN RAISE EXCEPTION 'Liability account classification conflicts' USING ERRCODE='22023'; END IF;
  FOREACH field IN ARRAY ARRAY['sourceLabel','sourceType','sourceSubtype','unofficialCurrency'] LOOP
   IF row->>field IS NOT NULL AND (jsonb_typeof(row->field)<>'string' OR length(row->>field)>500) THEN RAISE EXCEPTION 'Invalid financial source label' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['outstandingBalance','principalBalance','originalPrincipal','creditLimit','availableCredit','minimumPayment','nextPayment','interestRatePercentage'] LOOP
   IF row->>field IS NOT NULL AND (jsonb_typeof(row->field)<>'string' OR (row->>field ~ '^-?[0-9]{1,24}(\.[0-9]{1,6})?$') IS NOT TRUE) THEN RAISE EXCEPTION 'Invalid liability amount' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['originalPrincipal','creditLimit','minimumPayment','nextPayment','interestRatePercentage'] LOOP
   IF row->>field IS NOT NULL AND (row->>field)::numeric<0 THEN RAISE EXCEPTION 'Negative liability term' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF (row->>'outstandingBalance')::numeric IS DISTINCT FROM (account->>'current_balance')::numeric
   OR (row->>'product'='credit_card' AND ((row->>'creditLimit')::numeric IS DISTINCT FROM (account->>'credit_limit')::numeric OR (row->>'availableCredit')::numeric IS DISTINCT FROM (account->>'available_credit')::numeric))
   OR (row->>'product'='revolving_line' AND ((account->>'credit_limit' IS NOT NULL AND (row->>'creditLimit')::numeric IS DISTINCT FROM (account->>'credit_limit')::numeric)
    OR (account->>'available_credit' IS NOT NULL AND (row->>'availableCredit')::numeric IS DISTINCT FROM (account->>'available_credit')::numeric)))
   OR (row->>'product'='credit_card' AND row->>'principalBalance' IS NOT NULL)
   OR (row->>'product'<>'loan_obligation' AND (row->>'originalPrincipal' IS NOT NULL OR row->>'maturityDate' IS NOT NULL OR row->>'paymentFrequency' IS NOT NULL))
   OR (row->>'product'='loan_obligation' AND (row->>'creditLimit' IS NOT NULL OR row->>'availableCredit' IS NOT NULL OR row->>'minimumPayment' IS NOT NULL))
   OR (row->>'product'<>'revolving_line' AND row->>'drawPeriodEndDate' IS NOT NULL)
   OR (row->>'product'='credit_card' AND (row->>'nextPayment' IS NOT NULL OR row->>'interestRatePercentage' IS NOT NULL))
   OR (row->>'interestRateType' IS NOT NULL AND row->>'interestRateType' NOT IN ('fixed','variable'))
   OR (row->>'paymentFrequency' IS NOT NULL AND row->>'paymentFrequency' NOT IN ('daily','weekly','biweekly','semimonthly','monthly','semiannually','annually')) THEN
   RAISE EXCEPTION 'Unsupported or conflicting liability terms' USING ERRCODE='22023'; END IF;
  FOREACH field IN ARRAY ARRAY['nextPaymentDueDate','maturityDate','drawPeriodEndDate'] LOOP
   IF row->>field IS NOT NULL THEN
    IF jsonb_typeof(row->field)<>'string' OR row->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid liability date' USING ERRCODE='22023'; END IF;
    BEGIN date_value:=(row->>field)::date; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'Invalid liability date' USING ERRCODE='22023'; END;
    IF NOT isfinite(date_value) THEN RAISE EXCEPTION 'Invalid liability date' USING ERRCODE='22023'; END IF;
   END IF;
  END LOOP;
  IF row->'aprs' IS NOT NULL AND row->'aprs'<>'null'::jsonb THEN
   IF row->>'product'<>'credit_card' OR jsonb_typeof(row->'aprs')<>'array' OR jsonb_array_length(row->'aprs')>50 THEN RAISE EXCEPTION 'Invalid liability APR records' USING ERRCODE='22023'; END IF;
   FOR apr IN SELECT value FROM jsonb_array_elements(row->'aprs') LOOP
    IF jsonb_typeof(apr)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(apr) k WHERE k NOT IN ('percentage','sourceType','subjectBalance','interestCharge')) THEN RAISE EXCEPTION 'Invalid liability APR record' USING ERRCODE='22023'; END IF;
    FOREACH field IN ARRAY ARRAY['percentage','subjectBalance','interestCharge'] LOOP
     IF apr->>field IS NOT NULL AND (jsonb_typeof(apr->field)<>'string' OR apr->>field !~ '^[0-9]{1,24}(\.[0-9]{1,6})?$') THEN RAISE EXCEPTION 'Invalid liability APR amount' USING ERRCODE='22023'; END IF;
    END LOOP;
    IF apr->>'sourceType' IS NOT NULL AND (jsonb_typeof(apr->'sourceType')<>'string' OR length(apr->>'sourceType')>500) THEN RAISE EXCEPTION 'Invalid APR source type' USING ERRCODE='22023'; END IF;
   END LOOP;
  END IF;
  FOREACH field IN ARRAY ARRAY['principalPayment','interestPayment','collateralVerified','guaranteeVerified','institutionUpdatedAt'] LOOP
   IF row->>field IS NOT NULL THEN RAISE EXCEPTION 'Unsupported lender evidence' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['accountingClassificationVerified','companyOwnershipVerified'] LOOP
   IF row->field IS NOT NULL AND row->field NOT IN ('null'::jsonb,'false'::jsonb) THEN RAISE EXCEPTION 'Native lender row cannot establish company or accounting verification' USING ERRCODE='22023'; END IF;
  END LOOP;
 END LOOP;
 next_version:=_expected_version+1;
 INSERT INTO public.finance_source_observations(id,tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,pages_complete,evidence_digest,reporting_basis)
 VALUES(observation,binding.tenant_id,binding.entity_id,binding.id,binding.revision,'liability-snapshot-'||next_version,'liabilities',_source_observed_at,'partial',true,_evidence_digest,'provider_balance');
 PERFORM public.record_capability_run(binding.tenant_id,actor,'finance_liability_snapshot_refresh','capability_succeeded',receipt,NULL,NULL,NULL,NULL,NULL);
 INSERT INTO public.finance_liability_source_snapshots(binding_id,tenant_id,entity_id,binding_revision,version,account_snapshot_version,observation_id,source_observed_at,coverage,records,normalized_digest,receipt_run_id)
 VALUES(binding.id,binding.tenant_id,binding.entity_id,binding.revision,next_version,accounts.version,observation,_source_observed_at,'partial',_records,encode(sha256(convert_to(_records::text,'UTF8')),'hex'),receipt)
 ON CONFLICT(binding_id) DO UPDATE SET binding_revision=EXCLUDED.binding_revision,version=EXCLUDED.version,account_snapshot_version=EXCLUDED.account_snapshot_version,
  observation_id=EXCLUDED.observation_id,source_observed_at=EXCLUDED.source_observed_at,synchronized_at=clock_timestamp(),coverage=EXCLUDED.coverage,records=EXCLUDED.records,
  normalized_digest=EXCLUDED.normalized_digest,receipt_run_id=EXCLUDED.receipt_run_id;
 RETURN jsonb_build_object('version',next_version,'observation_id',observation,'receipt_run_id',receipt,'provider_effect',false);
END $$;
REVOKE ALL ON FUNCTION public.replace_finance_liability_source_snapshot(uuid,bigint,bigint,bigint,timestamptz,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_finance_liability_source_snapshot(uuid,bigint,bigint,bigint,timestamptz,text,jsonb) TO service_role;

CREATE FUNCTION public.read_finance_liability_source(_expected_tenant uuid,_entity_id uuid,_binding_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account jsonb; snapshot public.finance_liability_source_snapshots;
BEGIN
 account:=public.read_finance_account_source(_expected_tenant,_entity_id,_binding_id);
 IF account->>'coverage'='unavailable' THEN RETURN jsonb_build_object('coverage','unavailable','records',NULL,'reason','account_source_unavailable'); END IF;
 SELECT * INTO snapshot FROM public.finance_liability_source_snapshots WHERE binding_id=_binding_id AND tenant_id=_expected_tenant AND entity_id=_entity_id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('coverage','unavailable','records',NULL,'reason','liability_source_not_supplied'); END IF;
 IF snapshot.binding_revision<>(account->>'binding_revision')::bigint OR snapshot.account_snapshot_version<>(account->>'version')::bigint THEN
  RETURN jsonb_build_object('coverage','unavailable','records',NULL,'reason','account_evidence_changed'); END IF;
 RETURN jsonb_build_object('binding_id',snapshot.binding_id,'binding_revision',snapshot.binding_revision,'version',snapshot.version,'account_snapshot_version',snapshot.account_snapshot_version,
  'provider',account->>'provider','coverage','partial','records',snapshot.records,'source_observed_at',snapshot.source_observed_at,'synchronized_at',snapshot.synchronized_at,
  'normalized_digest',snapshot.normalized_digest,'observation_id',snapshot.observation_id,'receipt_run_id',snapshot.receipt_run_id,'temporal_basis','source_snapshot',
  'institution_freshness_verified',false,'scheduled_debt_service',NULL,'company_wide_debt',NULL);
END $$;
REVOKE ALL ON FUNCTION public.read_finance_liability_source(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_finance_liability_source(uuid,uuid,uuid) TO authenticated;
COMMIT;
