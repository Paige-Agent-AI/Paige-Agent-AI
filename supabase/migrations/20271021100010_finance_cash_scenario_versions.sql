BEGIN;
-- Versioned owner assumptions only. No bank/payment/accounting ledger or actual
-- opening cash is created; the existing calculator derives estimates on read.
CREATE TABLE public.finance_cash_scenarios (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, entity_id uuid NOT NULL, entity_version bigint NOT NULL,
 version bigint NOT NULL CHECK(version>0), config jsonb NOT NULL,
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 receipt_run_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES public.finance_company_entities(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,id)
);
CREATE TABLE public.finance_cash_scenario_versions (
 tenant_id uuid NOT NULL, scenario_id uuid NOT NULL, version bigint NOT NULL CHECK(version>0), entity_version bigint NOT NULL,
 config jsonb NOT NULL, actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 receipt_run_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(scenario_id,version), FOREIGN KEY(tenant_id,scenario_id) REFERENCES public.finance_cash_scenarios(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.finance_cash_scenarios ENABLE ROW LEVEL SECURITY;
CREATE INDEX finance_scenario_actor ON public.finance_cash_scenarios(updated_by);
CREATE INDEX finance_scenario_company ON public.finance_cash_scenarios(tenant_id,entity_id);
CREATE INDEX finance_scenario_version_actor ON public.finance_cash_scenario_versions(actor_id);
CREATE INDEX finance_scenario_version_scope ON public.finance_cash_scenario_versions(tenant_id,scenario_id);
ALTER TABLE public.finance_cash_scenario_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_cash_scenarios,public.finance_cash_scenario_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.finance_cash_scenarios,public.finance_cash_scenario_versions TO service_role;
CREATE TRIGGER finance_cash_scenario_history_guard BEFORE UPDATE OR DELETE ON public.finance_cash_scenario_versions
 FOR EACH ROW EXECUTE FUNCTION public._finance_budget_history_guard();
CREATE FUNCTION public._finance_plan_header_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_OP='DELETE' THEN
  IF public._finance_retirement_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Finance planning history is retained' USING ERRCODE='42501';
 END IF;
 IF OLD.updated_by IS NOT NULL AND NEW.updated_by IS NULL
  AND (to_jsonb(OLD)-'updated_by')=(to_jsonb(NEW)-'updated_by')
  AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.updated_by) THEN RETURN NEW; END IF;
 IF ROW(NEW.id,NEW.tenant_id,NEW.entity_id) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.entity_id)
  OR NEW.version<>OLD.version+1 OR NEW.receipt_run_id=OLD.receipt_run_id OR NEW.updated_by IS DISTINCT FROM auth.uid() OR auth.uid() IS NULL THEN
  RAISE EXCEPTION 'Finance plan identity/version is immutable' USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_NAME='finance_budgets' THEN
  IF ROW(NEW.currency,NEW.period_start,NEW.period_end) IS DISTINCT FROM ROW(OLD.currency,OLD.period_start,OLD.period_end) THEN RAISE EXCEPTION 'Budget currency/period is immutable' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='finance_cash_scenarios' THEN
  IF NEW.config->>'currency' IS DISTINCT FROM OLD.config->>'currency' THEN RAISE EXCEPTION 'Scenario currency is immutable' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Unknown Finance planning header' USING ERRCODE='42501'; END IF;
 PERFORM public._finance_assert_budget_company(NEW.tenant_id,NEW.entity_id,NEW.entity_version);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_plan_header_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_budget_header_guard BEFORE UPDATE OR DELETE ON public.finance_budgets FOR EACH ROW EXECUTE FUNCTION public._finance_plan_header_guard();
CREATE TRIGGER finance_cash_scenario_header_guard BEFORE UPDATE OR DELETE ON public.finance_cash_scenarios FOR EACH ROW EXECUTE FUNCTION public._finance_plan_header_guard();
DO $$
DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer;
BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=strpos(body,anchor);
 IF at=0 OR strpos(body,'''finance_cash_scenarios''')>0 THEN RAISE EXCEPTION 'Unsupported canonical retirement policy'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''finance_cash_scenarios'',''finance_cash_scenario_versions'','||substr(body,at+length(anchor));
END $$;

CREATE FUNCTION public._finance_validate_cash_scenario(_config jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE start_date date; end_date date; event_date date; event jsonb; ids text[]:='{}'; occurrences text[]:='{}';
BEGIN
 IF jsonb_typeof(_config) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid cash scenario' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(_config->'events') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid cash events' USING ERRCODE='22023'; END IF;
 IF jsonb_typeof(_config) IS DISTINCT FROM 'object' OR octet_length(_config::text)>1000000
  OR (SELECT count(*) FROM jsonb_object_keys(_config))<>8
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(_config) k WHERE k NOT IN ('title','currency','start_date','horizon_days','opening_cash','cash_floor','events','assumptions'))
  OR jsonb_typeof(_config->'title') IS DISTINCT FROM 'string' OR length(btrim(_config->>'title')) NOT BETWEEN 1 AND 200
  OR jsonb_typeof(_config->'currency') IS DISTINCT FROM 'string' OR (_config->>'currency' ~ '^[A-Z]{3}$') IS NOT TRUE
  OR jsonb_typeof(_config->'start_date') IS DISTINCT FROM 'string' OR (_config->>'start_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') IS NOT TRUE
  OR jsonb_typeof(_config->'horizon_days') IS DISTINCT FROM 'number' OR _config->>'horizon_days' NOT IN ('30','60','90')
  OR (_config->'opening_cash'<>'null'::jsonb AND (jsonb_typeof(_config->'opening_cash') IS DISTINCT FROM 'string' OR (_config->>'opening_cash' ~ '^-?[0-9]{1,24}(\.[0-9]{1,6})?$') IS NOT TRUE))
  OR (_config->'cash_floor'<>'null'::jsonb AND (jsonb_typeof(_config->'cash_floor') IS DISTINCT FROM 'string' OR (_config->>'cash_floor' ~ '^[0-9]{1,24}(\.[0-9]{1,6})?$') IS NOT TRUE))
  OR jsonb_typeof(_config->'events') IS DISTINCT FROM 'array' OR jsonb_array_length(_config->'events')>5000
  OR jsonb_typeof(_config->'assumptions') IS DISTINCT FROM 'string' OR length(_config->>'assumptions')>10000 THEN RAISE EXCEPTION 'Invalid cash scenario' USING ERRCODE='22023'; END IF;
 BEGIN
  start_date:=(_config->>'start_date')::date; end_date:=start_date+(_config->>'horizon_days')::integer-1;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'Invalid cash scenario date' USING ERRCODE='22023'; END;
 IF NOT isfinite(start_date) OR start_date::text IS DISTINCT FROM _config->>'start_date' OR end_date::text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid cash scenario date' USING ERRCODE='22023'; END IF;
 FOR event IN SELECT value FROM jsonb_array_elements(_config->'events') LOOP
  IF jsonb_typeof(event) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid cash event' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(event) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(event))<>6
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(event) k WHERE k NOT IN ('id','source_label','date','direction','amount','occurrence_ref'))
   OR jsonb_typeof(event->'id') IS DISTINCT FROM 'string' OR length(btrim(event->>'id')) NOT BETWEEN 1 AND 100
   OR jsonb_typeof(event->'source_label') IS DISTINCT FROM 'string' OR length(btrim(event->>'source_label')) NOT BETWEEN 1 AND 500
   OR jsonb_typeof(event->'date') IS DISTINCT FROM 'string' OR (event->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') IS NOT TRUE
   OR jsonb_typeof(event->'direction') IS DISTINCT FROM 'string' OR event->>'direction' NOT IN ('inflow','outflow')
   OR jsonb_typeof(event->'amount') IS DISTINCT FROM 'string' OR (event->>'amount' ~ '^[0-9]{1,24}(\.[0-9]{1,6})?$') IS NOT TRUE
   OR (event->'occurrence_ref'<>'null'::jsonb AND (jsonb_typeof(event->'occurrence_ref') IS DISTINCT FROM 'string' OR length(btrim(event->>'occurrence_ref')) NOT BETWEEN 1 AND 500))
   OR event->>'id'=ANY(ids) OR event->>'occurrence_ref'=ANY(occurrences) THEN RAISE EXCEPTION 'Invalid or duplicate cash event' USING ERRCODE='22023'; END IF;
  BEGIN event_date:=(event->>'date')::date; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'Invalid cash event date' USING ERRCODE='22023'; END;
  IF event_date::text IS DISTINCT FROM event->>'date' OR event_date<start_date OR event_date>end_date THEN RAISE EXCEPTION 'Cash event outside scenario' USING ERRCODE='22023'; END IF;
  ids:=array_append(ids,event->>'id'); IF event->>'occurrence_ref' IS NOT NULL THEN occurrences:=array_append(occurrences,event->>'occurrence_ref'); END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._finance_validate_cash_scenario(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.save_finance_cash_scenario(_tenant uuid,_entity uuid,_entity_version bigint,_scenario uuid,_expected_version bigint,_config jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.finance_cash_scenarios; next_version bigint; receipt uuid:=gen_random_uuid();
BEGIN
 PERFORM public._finance_assert_budget_company(_tenant,_entity,_entity_version);
 IF EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant AND lifecycle_execution_paused) THEN RAISE EXCEPTION 'Workspace execution paused' USING ERRCODE='42501'; END IF;
 IF _scenario IS NULL OR _expected_version IS NULL OR _expected_version<0 OR _expected_version>=9223372036854775807 THEN RAISE EXCEPTION 'Invalid scenario version' USING ERRCODE='22023'; END IF;
 PERFORM public._finance_validate_cash_scenario(_config);
 PERFORM pg_advisory_xact_lock(hashtextextended(_scenario::text,0));
 IF EXISTS(SELECT 1 FROM public.finance_cash_scenarios WHERE id=_scenario AND (tenant_id<>_tenant OR entity_id<>_entity)) THEN RAISE EXCEPTION 'Cash scenario unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM public.finance_cash_scenarios WHERE id=_scenario AND tenant_id=_tenant AND entity_id=_entity FOR UPDATE;
 IF FOUND THEN
  IF existing.config->>'currency' IS DISTINCT FROM _config->>'currency' THEN RAISE EXCEPTION 'Create a distinct currency scenario' USING ERRCODE='22023'; END IF;
  IF existing.entity_version=_entity_version AND existing.config=_config
   AND (existing.version=_expected_version OR existing.version=_expected_version+1 AND existing.updated_by=auth.uid()) THEN
   RETURN jsonb_build_object('id',existing.id,'version',existing.version,'receipt_run_id',existing.receipt_run_id,'replayed',true,'financial_effect',false);
  END IF;
  IF existing.version<>_expected_version THEN RAISE EXCEPTION 'Cash scenario changed' USING ERRCODE='40001'; END IF;
  next_version:=existing.version+1;
  UPDATE public.finance_cash_scenarios SET entity_version=_entity_version,version=next_version,config=_config,updated_by=auth.uid(),receipt_run_id=receipt,updated_at=clock_timestamp() WHERE id=_scenario;
 ELSE
  IF _expected_version<>0 THEN RAISE EXCEPTION 'Cash scenario changed' USING ERRCODE='40001'; END IF;
  next_version:=1;
  INSERT INTO public.finance_cash_scenarios VALUES(_scenario,_tenant,_entity,_entity_version,next_version,_config,auth.uid(),receipt,clock_timestamp());
 END IF;
 INSERT INTO public.finance_cash_scenario_versions VALUES(_tenant,_scenario,next_version,_entity_version,_config,auth.uid(),receipt,clock_timestamp());
 PERFORM public.record_capability_run(_tenant,auth.uid(),'finance_cash_scenario_save','capability_succeeded',receipt,NULL,NULL,NULL,NULL,NULL);
 RETURN jsonb_build_object('id',_scenario,'version',next_version,'receipt_run_id',receipt,'replayed',false,'financial_effect',false);
END $$;
REVOKE ALL ON FUNCTION public.save_finance_cash_scenario(uuid,uuid,bigint,uuid,bigint,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_finance_cash_scenario(uuid,uuid,bigint,uuid,bigint,jsonb) TO authenticated;

CREATE FUNCTION public.read_finance_cash_scenario(_tenant uuid,_entity uuid,_entity_version bigint,_scenario uuid,_version bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE header public.finance_cash_scenarios; revision public.finance_cash_scenario_versions;
BEGIN
 PERFORM public._finance_assert_budget_company(_tenant,_entity,_entity_version);
 SELECT * INTO header FROM public.finance_cash_scenarios WHERE id=_scenario AND tenant_id=_tenant AND entity_id=_entity FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Cash scenario unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO revision FROM public.finance_cash_scenario_versions WHERE scenario_id=header.id AND version=coalesce(_version,header.version);
 IF NOT FOUND THEN RAISE EXCEPTION 'Cash scenario version unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',header.id,'entity_id',header.entity_id,'version',revision.version,'current_version',header.version,'config',revision.config,
  'company_identity_current',revision.entity_version=_entity_version,'basis','owner_entered_assumptions','amount_unit','decimal_major',
  'verified_opening_cash',NULL,'contractual_obligations',NULL,'guaranteed_result',false,'receipt_run_id',revision.receipt_run_id,'created_at',revision.created_at);
END $$;
REVOKE ALL ON FUNCTION public.read_finance_cash_scenario(uuid,uuid,bigint,uuid,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_finance_cash_scenario(uuid,uuid,bigint,uuid,bigint) TO authenticated;
COMMIT;
