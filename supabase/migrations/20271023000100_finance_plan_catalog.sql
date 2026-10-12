BEGIN;
-- Discover existing Finance-owned plans without granting direct table access or
-- representing assumptions as accounting actuals, bank cash or provider proof.
CREATE FUNCTION public.read_finance_plan_catalog(_tenant uuid,_entity uuid,_entity_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE budgets jsonb; scenarios jsonb;
BEGIN
 PERFORM public._finance_assert_budget_company(_tenant,_entity,_entity_version);
 PERFORM 1 FROM public.tenants WHERE id=_tenant AND NOT lifecycle_execution_paused FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Finance workspace unavailable' USING ERRCODE='42501'; END IF;
 -- One statement snapshot and limit+1 refuse excess coverage without an
 -- unbounded count/aggregate or a silently truncated set of plan identities.
 WITH b AS (
  SELECT id,entity_version,currency,period_start,period_end,
   CASE WHEN length(title)<=200 THEN title ELSE NULL END AS title,version,updated_at,receipt_run_id
  FROM public.finance_budgets WHERE tenant_id=_tenant AND entity_id=_entity
  ORDER BY updated_at DESC,id LIMIT 201
 ), s AS (
  SELECT id,entity_version,CASE WHEN length(config->>'title')<=200 THEN config->>'title' ELSE NULL END AS title,config->>'currency' AS currency,
   config->>'start_date' AS start_date,config->'horizon_days' AS horizon_days,version,updated_at,receipt_run_id
  FROM public.finance_cash_scenarios WHERE tenant_id=_tenant AND entity_id=_entity
  ORDER BY updated_at DESC,id LIMIT 201
 )
 SELECT
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'entity_version',entity_version,'company_identity_current',entity_version=_entity_version,
   'currency',currency,'period_start',period_start,'period_end',period_end,'title',title,'version',version,
   'updated_at',updated_at,'receipt_run_id',receipt_run_id,'basis','owner_entered_plan') ORDER BY updated_at DESC,id) FROM b),'[]'::jsonb),
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'entity_version',entity_version,'company_identity_current',entity_version=_entity_version,
   'title',title,'currency',currency,'start_date',start_date,'horizon_days',horizon_days,'version',version,
   'updated_at',updated_at,'receipt_run_id',receipt_run_id,'basis','owner_entered_assumptions','guaranteed_result',false) ORDER BY updated_at DESC,id) FROM s),'[]'::jsonb)
 INTO budgets,scenarios;
 IF jsonb_array_length(budgets)>200 OR jsonb_array_length(scenarios)>200 THEN
  RAISE EXCEPTION 'Finance plan catalogue exceeds supported scope' USING ERRCODE='54000';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(budgets||scenarios) p
  WHERE p->>'title' IS NULL OR length(p->>'title')>200) THEN
  RAISE EXCEPTION 'Finance plan metadata exceeds supported scope' USING ERRCODE='54000';
 END IF;
 RETURN jsonb_build_object('tenant_id',_tenant,'entity_id',_entity,'entity_version',_entity_version,
  'read_at',clock_timestamp(),'budgets',budgets,'cash_scenarios',scenarios,
  'monetary_values_included',false,'bank_balances_established',false,'financial_effects_executed',false);
END $$;
REVOKE ALL ON FUNCTION public.read_finance_plan_catalog(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_finance_plan_catalog(uuid,uuid,bigint) TO authenticated;
COMMENT ON FUNCTION public.read_finance_plan_catalog(uuid,uuid,bigint) IS 'Authorized current-company plan identity catalogue only; no financial actuals, bank balances, provider proof or effects.';
COMMIT;
