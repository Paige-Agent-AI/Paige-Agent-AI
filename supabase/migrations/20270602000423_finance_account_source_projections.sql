-- Replaceable provider projections, not an accounting or payment ledger.
BEGIN;
ALTER TABLE public.finance_source_observations ADD CONSTRAINT finance_observation_projection_scope
 UNIQUE(tenant_id,entity_id,binding_id,binding_revision,id);
CREATE TABLE public.finance_account_source_snapshots (
 binding_id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 binding_revision bigint NOT NULL CHECK(binding_revision>0),
 version bigint NOT NULL CHECK(version>0),
 observation_id uuid NOT NULL,
 source_observed_at timestamptz NOT NULL,
 synchronized_at timestamptz NOT NULL DEFAULT now(),
 coverage text NOT NULL CHECK(coverage IN ('complete','partial')),
 pages_complete boolean NOT NULL,
 accounts jsonb NOT NULL CHECK(jsonb_typeof(accounts)='array' AND jsonb_array_length(accounts)<=500),
 normalized_digest text NOT NULL CHECK(normalized_digest ~ '^[0-9a-f]{64}$'),
 receipt_run_id uuid NOT NULL,
 FOREIGN KEY(tenant_id,entity_id,binding_id) REFERENCES public.finance_source_bindings(tenant_id,entity_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,entity_id,binding_id,binding_revision,observation_id)
  REFERENCES public.finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,id) ON DELETE RESTRICT,
 CHECK(coverage<>'complete' OR pages_complete)
);
ALTER TABLE public.finance_account_source_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_account_source_snapshots FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.finance_account_source_snapshots TO service_role;

DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF at=0 OR position('finance_company_entities' IN body)=0 OR position('finance_account_source_snapshots' IN body)>0 THEN
  RAISE EXCEPTION 'Canonical Finance retirement policy requires reviewed reconciliation'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''finance_account_source_snapshots'','||substr(body,at+length(anchor));
END $$;

CREATE FUNCTION public._finance_account_snapshot_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (ROW(NEW.binding_id,NEW.tenant_id,NEW.entity_id) IS DISTINCT FROM ROW(OLD.binding_id,OLD.tenant_id,OLD.entity_id)
  OR NEW.version<>OLD.version+1 OR NEW.observation_id=OLD.observation_id) THEN
  RAISE EXCEPTION 'Financial snapshot requires a new scoped observation' USING ERRCODE='42501'; END IF;
 IF NEW.normalized_digest IS DISTINCT FROM encode(sha256(convert_to(NEW.accounts::text,'UTF8')),'hex') OR NOT EXISTS(
  SELECT 1 FROM public.finance_source_observations o WHERE o.id=NEW.observation_id AND o.tenant_id=NEW.tenant_id
   AND o.entity_id=NEW.entity_id AND o.binding_id=NEW.binding_id AND o.binding_revision=NEW.binding_revision
   AND o.domain='bank_accounts' AND o.source_record_key='account-snapshot-'||NEW.version
   AND o.source_observed_at=NEW.source_observed_at AND o.coverage=NEW.coverage AND o.pages_complete=NEW.pages_complete) THEN
  RAISE EXCEPTION 'Financial snapshot observation does not match' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_account_snapshot_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_account_snapshot_guard BEFORE INSERT OR UPDATE ON public.finance_account_source_snapshots
 FOR EACH ROW EXECUTE FUNCTION public._finance_account_snapshot_guard();

CREATE FUNCTION public._finance_clear_revoked_account_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.verification_state='revoked' THEN DELETE FROM public.finance_account_source_snapshots WHERE binding_id=NEW.id; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_clear_revoked_account_snapshot() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER finance_clear_revoked_account_snapshot AFTER UPDATE ON public.finance_source_bindings FOR EACH ROW EXECUTE FUNCTION public._finance_clear_revoked_account_snapshot();

CREATE FUNCTION public.replace_finance_account_source_snapshot(
 _binding_id uuid,_binding_revision bigint,_expected_version bigint,_source_observed_at timestamptz,
 _coverage text,_pages_complete boolean,_evidence_digest text,_accounts jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE binding public.finance_source_bindings; existing public.finance_account_source_snapshots;
 row jsonb; field text; native_account text; actor uuid; observation uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid(); next_version bigint; source_stamp timestamptz;
BEGIN
 IF _expected_version IS NULL OR _expected_version<0 OR _binding_revision IS NULL OR _source_observed_at IS NULL
  OR _source_observed_at>clock_timestamp()+interval '5 minutes' OR _coverage IS NULL OR _coverage NOT IN ('complete','partial')
  OR _pages_complete IS NULL OR (_coverage='complete' AND NOT _pages_complete)
  OR (_evidence_digest ~ '^[0-9a-f]{64}$') IS NOT TRUE OR _accounts IS NULL OR jsonb_typeof(_accounts)<>'array'
  OR jsonb_array_length(_accounts)>500 OR octet_length(_accounts::text)>1048576 THEN
  RAISE EXCEPTION 'Invalid financial account snapshot' USING ERRCODE='22023';
 END IF;
 SELECT * INTO binding FROM public.finance_source_bindings WHERE id=_binding_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Financial source unavailable' USING ERRCODE='42501'; END IF;
 -- Observation insertion composes existing actor/workspace/company/provider locks
 -- and revalidates verified revision. No earlier lookup grants financial access.
 next_version:=_expected_version+1;
 INSERT INTO public.finance_source_observations(id,tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,
  source_observed_at,coverage,pages_complete,evidence_digest,reporting_basis)
 VALUES(observation,binding.tenant_id,binding.entity_id,binding.id,_binding_revision,'account-snapshot-'||next_version,'bank_accounts',
  _source_observed_at,_coverage,_pages_complete,_evidence_digest,'provider_balance');
 -- Serialize snapshot replacement only after the canonical source lifecycle locks.
 PERFORM pg_advisory_xact_lock(hashtextextended('finance-account-snapshot:'||binding.id::text,0));
 SELECT * INTO existing FROM public.finance_account_source_snapshots WHERE binding_id=binding.id FOR UPDATE;
 IF FOUND THEN
  IF existing.version<>_expected_version OR existing.binding_revision<>_binding_revision THEN RAISE EXCEPTION 'Financial snapshot changed' USING ERRCODE='40001'; END IF;
  IF _source_observed_at<existing.source_observed_at THEN RAISE EXCEPTION 'Financial source snapshot is older' USING ERRCODE='40001'; END IF;
 ELSIF _expected_version<>0 THEN RAISE EXCEPTION 'Financial snapshot changed' USING ERRCODE='40001'; END IF;
 IF binding.provider='plaid' THEN
  SELECT account_id,user_id INTO native_account,actor FROM public.connected_bank_accounts WHERE id=binding.plaid_account_anchor_id;
 ELSE SELECT user_id INTO actor FROM public.quickbooks_connections WHERE id=binding.quickbooks_connection_id; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(_accounts) a GROUP BY a->>'native_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate native financial account' USING ERRCODE='22023'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(_accounts) LOOP
  IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR jsonb_typeof(row->'native_id') IS DISTINCT FROM 'string' OR length(btrim(row->>'native_id')) NOT BETWEEN 1 AND 500
   OR jsonb_typeof(row->'source_label') IS DISTINCT FROM 'string' OR length(btrim(row->>'source_label')) NOT BETWEEN 1 AND 500
   OR row->>'product' IS NULL OR row->>'product' NOT IN ('deposit','cash_on_hand','credit_card','revolving_line','loan_obligation','unclassified')
   OR (row->>'currency' IS NOT NULL AND (row->>'currency' ~ '^[A-Z]{3}$') IS NOT TRUE)
   OR (binding.provider='plaid' AND row->>'native_id' IS DISTINCT FROM native_account)
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(row) k WHERE k NOT IN ('native_id','source_label','source_path','institution_label','product','currency','current_balance','available_cash','available_credit','credit_limit','source_updated_at')) THEN
   RAISE EXCEPTION 'Invalid native financial account identity' USING ERRCODE='22023';
  END IF;
  FOREACH field IN ARRAY ARRAY['current_balance','available_cash','available_credit','credit_limit'] LOOP
   IF row->>field IS NOT NULL AND (jsonb_typeof(row->field)<>'string' OR (row->>field ~ '^-?[0-9]{1,24}(\.[0-9]{1,6})?$') IS NOT TRUE) THEN
    RAISE EXCEPTION 'Invalid financial amount' USING ERRCODE='22023';
   END IF;
  END LOOP;
  FOREACH field IN ARRAY ARRAY['source_path','institution_label','source_updated_at'] LOOP
   IF row->>field IS NOT NULL AND (jsonb_typeof(row->field)<>'string' OR length(row->>field)>500) THEN RAISE EXCEPTION 'Invalid financial source label' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF row->>'source_updated_at' IS NOT NULL THEN
   IF row->>'source_updated_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
    RAISE EXCEPTION 'Invalid financial source timestamp' USING ERRCODE='22023'; END IF;
   BEGIN source_stamp:=(row->>'source_updated_at')::timestamptz;
   EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Invalid financial source timestamp' USING ERRCODE='22023'; END;
   IF NOT isfinite(source_stamp) OR source_stamp>_source_observed_at+interval '5 minutes' THEN
    RAISE EXCEPTION 'Financial source timestamp conflicts with observation' USING ERRCODE='22023'; END IF;
  END IF;
  IF (row->>'available_cash' IS NOT NULL AND row->>'product' NOT IN ('deposit','cash_on_hand'))
   OR (row->>'available_credit' IS NOT NULL AND row->>'product' NOT IN ('credit_card','revolving_line'))
   OR (row->>'credit_limit' IS NOT NULL AND row->>'product' NOT IN ('credit_card','revolving_line'))
   OR (binding.provider='quickbooks' AND (row->>'available_cash' IS NOT NULL OR row->>'available_credit' IS NOT NULL OR row->>'credit_limit' IS NOT NULL)) THEN
   RAISE EXCEPTION 'Unsupported financial balance classification' USING ERRCODE='22023';
  END IF;
 END LOOP;
 PERFORM public.record_capability_run(binding.tenant_id,actor,'finance_account_snapshot_refresh','capability_succeeded',receipt,NULL,NULL,NULL,NULL,NULL);
 INSERT INTO public.finance_account_source_snapshots(binding_id,tenant_id,entity_id,binding_revision,version,observation_id,source_observed_at,coverage,pages_complete,accounts,normalized_digest,receipt_run_id)
 VALUES(binding.id,binding.tenant_id,binding.entity_id,_binding_revision,next_version,observation,_source_observed_at,_coverage,_pages_complete,_accounts,encode(sha256(convert_to(_accounts::text,'UTF8')),'hex'),receipt)
 ON CONFLICT(binding_id) DO UPDATE SET binding_revision=EXCLUDED.binding_revision,version=EXCLUDED.version,observation_id=EXCLUDED.observation_id,
  source_observed_at=EXCLUDED.source_observed_at,synchronized_at=clock_timestamp(),coverage=EXCLUDED.coverage,pages_complete=EXCLUDED.pages_complete,accounts=EXCLUDED.accounts,normalized_digest=EXCLUDED.normalized_digest,receipt_run_id=EXCLUDED.receipt_run_id;
 RETURN jsonb_build_object('version',next_version,'observation_id',observation,'receipt_run_id',receipt,'provider_effect',false);
END $$;
REVOKE ALL ON FUNCTION public.replace_finance_account_source_snapshot(uuid,bigint,bigint,timestamptz,text,boolean,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_finance_account_source_snapshot(uuid,bigint,bigint,timestamptz,text,boolean,text,jsonb) TO service_role;

CREATE FUNCTION public.read_finance_account_source(_expected_tenant uuid,_entity_id uuid,_binding_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE binding public.finance_source_bindings; snapshot public.finance_account_source_snapshots; actor uuid; active boolean;
BEGIN
 PERFORM public._finance_assert_workspace(auth.uid(),_expected_tenant);
 SELECT * INTO binding FROM public.finance_source_bindings WHERE id=_binding_id AND tenant_id=_expected_tenant AND entity_id=_entity_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Financial source unavailable' USING ERRCODE='42501'; END IF;
 IF binding.verification_state<>'verified' THEN RETURN jsonb_build_object('coverage','unavailable','accounts',NULL,'reason','source_not_verified'); END IF;
 IF binding.provider='plaid' THEN SELECT user_id,is_active INTO actor,active FROM public.connected_bank_accounts WHERE id=binding.plaid_account_anchor_id;
 ELSE SELECT user_id,is_active INTO actor,active FROM public.quickbooks_connections WHERE id=binding.quickbooks_connection_id; END IF;
 IF NOT coalesce(active,false) THEN RETURN jsonb_build_object('coverage','unavailable','accounts',NULL,'reason','connection_unavailable'); END IF;
 BEGIN
  PERFORM public._finance_assert_stored_source_actor(actor,_expected_tenant);
 EXCEPTION WHEN SQLSTATE '42501' THEN
  RETURN jsonb_build_object('coverage','unavailable','accounts',NULL,'reason','source_authority_unavailable');
 END;
 -- Preserve the source-lock order, then re-read state after its lifecycle locks.
 IF binding.provider='plaid' THEN PERFORM 1 FROM public.connected_bank_accounts WHERE id=binding.plaid_account_anchor_id AND is_active AND user_id=actor FOR SHARE;
 ELSE PERFORM 1 FROM public.quickbooks_connections WHERE id=binding.quickbooks_connection_id AND is_active AND user_id=actor FOR SHARE; END IF;
 IF NOT FOUND THEN RETURN jsonb_build_object('coverage','unavailable','accounts',NULL,'reason','connection_changed'); END IF;
 PERFORM 1 FROM public.finance_company_entities e JOIN public.tenants t ON t.id=e.tenant_id
  WHERE e.id=_entity_id AND e.tenant_id=_expected_tenant AND e.is_active
   AND (e.kind<>'workspace_company' OR e.legal_name=coalesce(nullif(t.brand->'business_brief'->>'legalName',''),nullif(t.brand->>'legal_entity_name',''))) FOR SHARE OF e;
 IF NOT FOUND THEN RETURN jsonb_build_object('coverage','unavailable','accounts',NULL,'reason','company_changed'); END IF;
 SELECT * INTO binding FROM public.finance_source_bindings WHERE id=_binding_id AND tenant_id=_expected_tenant AND entity_id=_entity_id FOR SHARE;
 IF binding.verification_state<>'verified' THEN RETURN jsonb_build_object('coverage','unavailable','accounts',NULL,'reason','source_revoked'); END IF;
 SELECT * INTO snapshot FROM public.finance_account_source_snapshots WHERE binding_id=binding.id AND binding_revision=binding.revision FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('coverage','unavailable','accounts',NULL,'reason','snapshot_not_supplied'); END IF;
 RETURN jsonb_build_object('binding_id',binding.id,'binding_revision',binding.revision,'version',snapshot.version,'provider',binding.provider,'environment',binding.environment,
  'coverage',snapshot.coverage,'pages_complete',snapshot.pages_complete,'source_observed_at',snapshot.source_observed_at,'synchronized_at',snapshot.synchronized_at,
  'accounts',snapshot.accounts,'normalized_digest',snapshot.normalized_digest,'observation_id',snapshot.observation_id,'receipt_run_id',snapshot.receipt_run_id,'calculated_totals',NULL,
  'temporal_basis','source_snapshot','institution_freshness_verified',false);
END $$;
REVOKE ALL ON FUNCTION public.read_finance_account_source(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_finance_account_source(uuid,uuid,uuid) TO authenticated;
COMMIT;
