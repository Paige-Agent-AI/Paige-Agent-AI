BEGIN;
-- Finance-owned planning records, not an accounting or payment ledger.
CREATE TABLE public.finance_budgets (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, entity_id uuid NOT NULL, entity_version bigint NOT NULL,
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), period_start date NOT NULL, period_end date NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200), version bigint NOT NULL CHECK(version>0),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 receipt_run_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES public.finance_company_entities(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,id), CHECK(period_end>=period_start AND period_end-period_start<=366)
);
CREATE TABLE public.finance_budget_versions (
 tenant_id uuid NOT NULL, budget_id uuid NOT NULL, version bigint NOT NULL CHECK(version>0),
 entity_version bigint NOT NULL, title text NOT NULL, lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'),
 assumptions text NOT NULL CHECK(length(assumptions)<=10000),
 actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, receipt_run_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(budget_id,version),
 FOREIGN KEY(tenant_id,budget_id) REFERENCES public.finance_budgets(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.finance_budgets ENABLE ROW LEVEL SECURITY;
-- All retained revisions participate in Auth erasure and canonical retirement.
CREATE INDEX finance_budget_actor ON public.finance_budgets(updated_by);
CREATE INDEX finance_budget_company ON public.finance_budgets(tenant_id,entity_id);
CREATE INDEX finance_budget_version_actor ON public.finance_budget_versions(actor_id);
CREATE INDEX finance_budget_version_scope ON public.finance_budget_versions(tenant_id,budget_id);
ALTER TABLE public.finance_budget_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_budgets,public.finance_budget_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.finance_budgets,public.finance_budget_versions TO service_role;

DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF at=0 OR position('finance_company_entities' IN body)=0 OR position('finance_budgets' IN body)>0 THEN
  RAISE EXCEPTION 'Canonical Finance retirement policy requires reviewed reconciliation'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''finance_budgets'',''finance_budget_versions'','||substr(body,at+length(anchor));
END $$;

CREATE FUNCTION public._finance_budget_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_OP='DELETE' AND public._finance_retirement_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
 -- Only FK anonymization after the referenced Auth row has gone may change an
 -- actor field; planning amounts, labels, versions and receipts stay immutable.
 IF TG_OP='UPDATE' AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
  AND (to_jsonb(OLD)-'actor_id')=(to_jsonb(NEW)-'actor_id')
  AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.actor_id) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Budget history is immutable' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION public._finance_budget_history_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER finance_budget_history_guard BEFORE UPDATE OR DELETE ON public.finance_budget_versions
 FOR EACH ROW EXECUTE FUNCTION public._finance_budget_history_guard();

-- Reuse the existing authority gate; lock current company identity before planning writes.
CREATE FUNCTION public._finance_assert_budget_company(_tenant uuid,_entity uuid,_version bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE company public.finance_company_entities; primary_name text;
BEGIN
 PERFORM public._finance_assert_workspace(auth.uid(),_tenant);
 SELECT * INTO company FROM public.finance_company_entities WHERE tenant_id=_tenant AND id=_entity AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Finance company unavailable' USING ERRCODE='42501'; END IF;
 IF _version IS NULL OR company.version<>_version THEN RAISE EXCEPTION 'Finance company changed' USING ERRCODE='40001'; END IF;
 IF company.kind='workspace_company' THEN
  SELECT coalesce(nullif(brand->'business_brief'->>'legalName',''),nullif(brand->>'legal_entity_name','')) INTO primary_name FROM public.tenants WHERE id=_tenant;
  IF primary_name IS DISTINCT FROM company.legal_name THEN RAISE EXCEPTION 'Finance company identity changed' USING ERRCODE='40001'; END IF;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._finance_assert_budget_company(uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._finance_assert_budget_company(uuid,uuid,bigint) TO service_role;

CREATE FUNCTION public.save_finance_budget(_tenant uuid,_entity uuid,_entity_version bigint,_budget uuid,_expected_version bigint,
 _currency text,_period_start date,_period_end date,_title text,_lines jsonb,_assumptions text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.finance_budgets; previous public.finance_budget_versions; result public.finance_budgets;
 line jsonb; keys text[]; ids text[]:='{}'; run_id uuid:=gen_random_uuid(); next_version bigint;
BEGIN
 PERFORM public._finance_assert_budget_company(_tenant,_entity,_entity_version);
 IF EXISTS(SELECT 1 FROM public.tenants WHERE id=_tenant AND lifecycle_execution_paused) THEN RAISE EXCEPTION 'Workspace execution paused' USING ERRCODE='42501'; END IF;
 IF _budget IS NULL OR _expected_version IS NULL OR _expected_version<0 OR _expected_version>=9223372036854775807
  OR _currency IS NULL OR _currency !~ '^[A-Z]{3}$' OR _period_start IS NULL OR _period_end IS NULL
  OR _period_end<_period_start OR _period_end-_period_start>366 OR _title IS NULL OR length(btrim(_title)) NOT BETWEEN 1 AND 200
  OR _lines IS NULL OR jsonb_typeof(_lines)<>'array' OR jsonb_array_length(_lines)>500 OR octet_length(_lines::text)>1000000
  OR _assumptions IS NULL OR length(_assumptions)>10000 THEN RAISE EXCEPTION 'Invalid budget plan' USING ERRCODE='22023'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(_lines) LOOP
  IF jsonb_typeof(line)<>'object' THEN RAISE EXCEPTION 'Invalid budget line' USING ERRCODE='22023'; END IF;
  SELECT array_agg(key) INTO keys FROM jsonb_object_keys(line) key;
  IF keys IS NULL OR NOT keys <@ ARRAY['id','source_label','direction','planned_amount_decimal']
   OR jsonb_typeof(line->'id') IS DISTINCT FROM 'string' OR length(btrim(line->>'id')) NOT BETWEEN 1 AND 100
   OR jsonb_typeof(line->'source_label') IS DISTINCT FROM 'string' OR length(btrim(line->>'source_label')) NOT BETWEEN 1 AND 500
   OR jsonb_typeof(line->'direction') IS DISTINCT FROM 'string' OR line->>'direction' NOT IN ('income','expense')
   OR jsonb_typeof(line->'planned_amount_decimal') IS DISTINCT FROM 'string' OR line->>'planned_amount_decimal' !~ '^[0-9]{1,24}(\.[0-9]{1,6})?$'
   OR line->>'id'=ANY(ids) THEN RAISE EXCEPTION 'Invalid budget line' USING ERRCODE='22023'; END IF;
  ids:=array_append(ids,line->>'id');
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended(_budget::text,0));
 IF EXISTS(SELECT 1 FROM public.finance_budgets WHERE id=_budget AND (tenant_id<>_tenant OR entity_id<>_entity)) THEN
  RAISE EXCEPTION 'Budget unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM public.finance_budgets WHERE id=_budget AND tenant_id=_tenant AND entity_id=_entity FOR UPDATE;
 IF FOUND THEN
  SELECT * INTO previous FROM public.finance_budget_versions WHERE budget_id=_budget AND version=existing.version;
  IF existing.currency<>_currency OR existing.period_start<>_period_start OR existing.period_end<>_period_end THEN
   RAISE EXCEPTION 'Budget period or currency changed; create a distinct plan' USING ERRCODE='22023'; END IF;
  IF existing.entity_version=_entity_version AND existing.title=_title AND previous.lines=_lines AND previous.assumptions=_assumptions
   AND (existing.version=_expected_version OR existing.version=_expected_version+1 AND existing.updated_by=auth.uid()) THEN
   RETURN jsonb_build_object('id',existing.id,'version',existing.version,'receipt_run_id',existing.receipt_run_id,'replayed',true,'financial_effect',false);
  END IF;
  IF existing.version<>_expected_version THEN RAISE EXCEPTION 'Budget changed' USING ERRCODE='40001'; END IF;
  next_version:=existing.version+1;
  UPDATE public.finance_budgets SET entity_version=_entity_version,title=_title,version=next_version,updated_by=auth.uid(),receipt_run_id=run_id,updated_at=clock_timestamp()
   WHERE id=_budget RETURNING * INTO result;
 ELSE
  IF _expected_version<>0 THEN RAISE EXCEPTION 'Budget changed' USING ERRCODE='40001'; END IF;
  next_version:=1;
  INSERT INTO public.finance_budgets VALUES(_budget,_tenant,_entity,_entity_version,_currency,_period_start,_period_end,_title,next_version,auth.uid(),run_id,clock_timestamp()) RETURNING * INTO result;
 END IF;
 INSERT INTO public.finance_budget_versions VALUES(_tenant,_budget,next_version,_entity_version,_title,_lines,_assumptions,auth.uid(),run_id,clock_timestamp());
 PERFORM public.record_capability_run(_tenant,auth.uid(),'finance_budget_save','capability_succeeded',run_id,NULL,NULL,NULL,NULL,NULL);
 RETURN jsonb_build_object('id',result.id,'version',result.version,'receipt_run_id',run_id,'replayed',false,'financial_effect',false);
END $$;
REVOKE ALL ON FUNCTION public.save_finance_budget(uuid,uuid,bigint,uuid,bigint,text,date,date,text,jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_finance_budget(uuid,uuid,bigint,uuid,bigint,text,date,date,text,jsonb,text) TO authenticated;

CREATE FUNCTION public.read_finance_budget(_tenant uuid,_entity uuid,_entity_version bigint,_budget uuid,_version bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE header public.finance_budgets; revision public.finance_budget_versions;
BEGIN
 PERFORM public._finance_assert_budget_company(_tenant,_entity,_entity_version);
 SELECT * INTO header FROM public.finance_budgets WHERE tenant_id=_tenant AND entity_id=_entity AND id=_budget FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Budget unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO revision FROM public.finance_budget_versions WHERE budget_id=header.id AND version=coalesce(_version,header.version);
 IF NOT FOUND THEN RAISE EXCEPTION 'Budget version unavailable' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('id',header.id,'entity_id',header.entity_id,'currency',header.currency,'period_start',header.period_start,'period_end',header.period_end,
  'title',revision.title,'version',revision.version,'current_version',header.version,'lines',revision.lines,'assumptions',revision.assumptions,
  'company_identity_current',revision.entity_version=_entity_version,'basis','owner_entered_plan','actuals',NULL,
  'receipt_run_id',revision.receipt_run_id,'created_at',revision.created_at);
END $$;
REVOKE ALL ON FUNCTION public.read_finance_budget(uuid,uuid,bigint,uuid,bigint) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_finance_budget(uuid,uuid,bigint,uuid,bigint) TO authenticated;
COMMIT;
