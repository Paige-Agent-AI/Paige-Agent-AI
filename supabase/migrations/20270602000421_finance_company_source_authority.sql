-- Finance scope/evidence metadata only. No ledger, provider activation, tokens or legacy backfill.
BEGIN;
-- Provider-owned environment provenance is missing on legacy Plaid rows. Leave
-- it unknown; only a trusted provider adapter may supply it. Never default the
-- historical environment from client input or legacy sandbox code.
ALTER TABLE public.connected_bank_accounts ADD COLUMN plaid_environment text
 CHECK(plaid_environment IN ('sandbox','development','production'));
CREATE FUNCTION public._finance_plaid_environment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.plaid_environment IS NOT NULL AND (TG_OP='INSERT' OR NEW.plaid_environment IS DISTINCT FROM OLD.plaid_environment)
  AND current_user NOT IN ('postgres','service_role') THEN RAISE EXCEPTION 'Provider environment requires a private adapter' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_plaid_environment_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER finance_plaid_environment_guard BEFORE INSERT OR UPDATE ON public.connected_bank_accounts
 FOR EACH ROW EXECUTE FUNCTION public._finance_plaid_environment_guard();
CREATE TABLE public.finance_company_entities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('workspace_company','managed_entity')),
 legal_name text NOT NULL CHECK(length(btrim(legal_name)) BETWEEN 1 AND 500),
 identity_basis text NOT NULL CHECK(identity_basis IN ('setup_business_brief','owner_declaration')),
 identity_reference text NOT NULL CHECK(length(identity_reference) BETWEEN 1 AND 500),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 is_active boolean NOT NULL DEFAULT true,
 declared_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 receipt_run_id uuid NOT NULL DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),
 CHECK((kind='workspace_company' AND identity_basis='setup_business_brief' AND identity_reference=tenant_id::text)
  OR(kind='managed_entity' AND identity_basis='owner_declaration'))
);
CREATE UNIQUE INDEX finance_primary_company_scope ON public.finance_company_entities(tenant_id) WHERE kind='workspace_company';

CREATE TABLE public.finance_source_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 provider text NOT NULL CHECK(provider IN ('quickbooks','plaid')),
 quickbooks_connection_id uuid,
 -- Historical opaque identity survives credential/account erasure. The insertion
 -- and lifecycle guards below validate live anchors without blocking privacy deletion.
 plaid_account_anchor_id uuid,
 environment text NOT NULL CHECK(environment IN ('sandbox','development','production')),
 source_namespace text NOT NULL CHECK(length(source_namespace) BETWEEN 1 AND 500),
 verification_state text NOT NULL DEFAULT 'pending' CHECK(verification_state IN ('pending','verified','revoked')),
 verification_reference uuid,
 verified_at timestamptz,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,entity_id) REFERENCES public.finance_company_entities(tenant_id,id) ON DELETE RESTRICT,
 UNIQUE(tenant_id,entity_id,id),
 CHECK((provider='quickbooks' AND quickbooks_connection_id IS NOT NULL AND plaid_account_anchor_id IS NULL AND environment<>'development')
  OR(provider='plaid' AND plaid_account_anchor_id IS NOT NULL AND quickbooks_connection_id IS NULL)),
 CHECK(verification_state<>'verified' OR(verification_reference IS NOT NULL AND verified_at IS NOT NULL))
);
-- A revoked binding remains historical evidence. Reconnection requires a new pending
-- binding and fresh authorization, rather than reviving the old verification reference.
CREATE UNIQUE INDEX finance_current_source_namespace ON public.finance_source_bindings(provider,environment,source_namespace) WHERE verification_state<>'revoked';
CREATE UNIQUE INDEX finance_current_quickbooks_anchor ON public.finance_source_bindings(quickbooks_connection_id) WHERE verification_state<>'revoked';
CREATE UNIQUE INDEX finance_current_plaid_anchor ON public.finance_source_bindings(plaid_account_anchor_id) WHERE verification_state<>'revoked';
COMMENT ON TABLE public.finance_source_bindings IS 'Finance company/source evidence binding. Existing integration tables retain all connection lifecycle and credentials. Legacy rows are never automatically verified.';

CREATE TABLE public.finance_source_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 entity_id uuid NOT NULL,
 binding_id uuid NOT NULL,
 binding_revision bigint NOT NULL CHECK(binding_revision>0),
 source_record_key text NOT NULL CHECK(length(source_record_key) BETWEEN 1 AND 500),
 domain text NOT NULL CHECK(domain IN ('bank_accounts','bank_transactions','liabilities','bills','expenses','income_statement','balance_sheet')),
 currency text CHECK(currency ~ '^[A-Z]{3}$'),
 reporting_basis text CHECK(reporting_basis IN ('cash','accrual','provider_balance','not_supplied')),
 period_start date,
 period_end date,
 source_observed_at timestamptz NOT NULL,
 synchronized_at timestamptz NOT NULL DEFAULT now(),
 coverage text NOT NULL CHECK(coverage IN ('complete','partial','unavailable','error')),
 pages_complete boolean NOT NULL DEFAULT false,
 source_version text CHECK(length(source_version)<=500),
 evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[0-9a-f]{64}$'),
 FOREIGN KEY(tenant_id,entity_id,binding_id) REFERENCES public.finance_source_bindings(tenant_id,entity_id,id) ON DELETE RESTRICT,
 UNIQUE(binding_id,domain,source_record_key,evidence_digest),
 CHECK(period_start IS NULL OR period_end IS NULL OR period_start<=period_end),
 CHECK(coverage<>'complete' OR pages_complete),
 CHECK(source_observed_at<=synchronized_at+interval '5 minutes')
);
CREATE INDEX finance_observations_scope ON public.finance_source_observations(tenant_id,entity_id,binding_id,domain,source_observed_at DESC,id);

ALTER TABLE public.finance_company_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_source_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_source_observations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_company_entities,public.finance_source_bindings,public.finance_source_observations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.finance_company_entities,public.finance_source_bindings,public.finance_source_observations TO service_role;

-- Extend the one canonical disposition function without replacing its existing
-- table policy. Refuse unknown source shapes rather than omit another domain.
DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure);
 IF position(anchor IN body)=0 OR position('finance_company_entities' IN body)>0
  OR length(body)-length(replace(body,anchor,''))<>length(anchor) THEN
  RAISE EXCEPTION 'Canonical retirement disposition requires reviewed reconciliation'; END IF;
 EXECUTE replace(body,anchor,'SELECT CASE WHEN _table=ANY(ARRAY[''finance_company_entities'',''finance_source_bindings'',''finance_source_observations'']) THEN ''delete'' WHEN _table=ANY(ARRAY[');
END $$;

CREATE FUNCTION public._finance_retirement_allowed(_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(public.operator_can_retire_accounts(),false) AND EXISTS(
  SELECT 1 FROM public.tenants t JOIN public.operator_account_archives r ON r.id=t.archive_operation_id
  WHERE t.id=_tenant AND t.archived_at IS NOT NULL AND t.lifecycle_execution_paused
   AND r.state='deleting' AND _tenant=ANY(r.scope_ids))
$$;
REVOKE ALL ON FUNCTION public._finance_retirement_allowed(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._finance_binding_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE source_actor uuid; locked_actor uuid; native_namespace text; native_environment text; native_scope text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.provider='plaid' THEN SELECT user_id INTO source_actor FROM public.connected_bank_accounts WHERE id=NEW.plaid_account_anchor_id;
  ELSE SELECT user_id INTO source_actor FROM public.quickbooks_connections WHERE id=NEW.quickbooks_connection_id; END IF;
  PERFORM public._finance_assert_stored_source_actor(source_actor,NEW.tenant_id);
  PERFORM 1 FROM public.tenants WHERE id=NEW.tenant_id AND status IN ('trial','active','past_due') AND archived_at IS NULL AND NOT lifecycle_execution_paused FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Financial workspace unavailable' USING ERRCODE='42501'; END IF;
  IF NEW.provider='plaid' THEN
   SELECT user_id,account_id,plaid_environment INTO locked_actor,native_namespace,native_environment FROM public.connected_bank_accounts WHERE id=NEW.plaid_account_anchor_id AND is_active FOR SHARE;
  ELSE
   SELECT user_id,qb_realm_id,environment,scope INTO locked_actor,native_namespace,native_environment,native_scope FROM public.quickbooks_connections WHERE id=NEW.quickbooks_connection_id AND is_active FOR SHARE;
  END IF;
  IF NOT FOUND OR locked_actor IS DISTINCT FROM source_actor THEN RAISE EXCEPTION 'Financial account unavailable' USING ERRCODE='42501'; END IF;
  IF native_namespace IS NULL OR native_environment IS NULL OR NEW.source_namespace IS DISTINCT FROM native_namespace
   OR NEW.environment IS DISTINCT FROM native_environment THEN RAISE EXCEPTION 'Financial provider identity mismatch or unknown' USING ERRCODE='42501'; END IF;
  IF NEW.provider='quickbooks' AND (native_scope ~ '(^|[[:space:]])com\.intuit\.quickbooks\.accounting($|[[:space:]])') IS NOT TRUE THEN RAISE EXCEPTION 'Accounting consent unavailable' USING ERRCODE='42501'; END IF;
  -- Match observation lock order: provider before company before binding.
  PERFORM 1 FROM public.finance_company_entities e JOIN public.tenants t ON t.id=e.tenant_id
   WHERE e.id=NEW.entity_id AND e.tenant_id=NEW.tenant_id AND e.is_active
    AND (e.kind<>'workspace_company' OR e.legal_name=coalesce(nullif(t.brand->'business_brief'->>'legalName',''),nullif(t.brand->>'legal_entity_name',''))) FOR SHARE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'Financial company unavailable' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  IF public._finance_retirement_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Financial source history is retained' USING ERRCODE='42501';
 END IF;
 IF ROW(NEW.id,NEW.tenant_id,NEW.entity_id,NEW.provider,NEW.quickbooks_connection_id,NEW.plaid_account_anchor_id,NEW.environment,NEW.source_namespace)
  IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.entity_id,OLD.provider,OLD.quickbooks_connection_id,OLD.plaid_account_anchor_id,OLD.environment,OLD.source_namespace) THEN
  RAISE EXCEPTION 'Financial source identity is immutable' USING ERRCODE='42501';
 END IF;
 IF NEW.revision<>OLD.revision+1 OR OLD.verification_state='revoked' THEN RAISE EXCEPTION 'Financial source changed' USING ERRCODE='40001'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_binding_identity_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER finance_binding_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.finance_source_bindings FOR EACH ROW EXECUTE FUNCTION public._finance_binding_identity_guard();

-- Connection lifecycle remains Integration-owned. Deactivation invalidates Finance
-- evidence atomically, while retaining the provider anchor and authorization history.
CREATE FUNCTION public._finance_quickbooks_deactivation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.is_active IS NOT TRUE OR
  ROW(NEW.qb_realm_id,NEW.environment,NEW.user_id,NEW.business_id,NEW.scope)
   IS DISTINCT FROM ROW(OLD.qb_realm_id,OLD.environment,OLD.user_id,OLD.business_id,OLD.scope) THEN
  UPDATE public.finance_source_bindings SET verification_state='revoked',revision=revision+1
   WHERE quickbooks_connection_id=OLD.id AND verification_state<>'revoked';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_quickbooks_deactivation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER finance_quickbooks_deactivation BEFORE UPDATE OR DELETE ON public.quickbooks_connections FOR EACH ROW EXECUTE FUNCTION public._finance_quickbooks_deactivation();

CREATE FUNCTION public._finance_plaid_retirement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.is_active IS NOT TRUE OR
  ROW(NEW.plaid_item_id,NEW.account_id,NEW.plaid_environment,NEW.user_id,NEW.business_id)
   IS DISTINCT FROM ROW(OLD.plaid_item_id,OLD.account_id,OLD.plaid_environment,OLD.user_id,OLD.business_id) THEN
  UPDATE public.finance_source_bindings SET verification_state='revoked',revision=revision+1
   WHERE plaid_account_anchor_id=OLD.id AND verification_state<>'revoked';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_plaid_retirement() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER finance_plaid_retirement BEFORE UPDATE OR DELETE ON public.connected_bank_accounts FOR EACH ROW EXECUTE FUNCTION public._finance_plaid_retirement();

CREATE FUNCTION public._finance_company_source_invalidation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF public._finance_retirement_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Financial company history is retained' USING ERRCODE='42501';
 END IF;
 IF NEW.version IS DISTINCT FROM OLD.version OR NEW.is_active IS NOT TRUE
  OR ROW(NEW.tenant_id,NEW.kind,NEW.legal_name,NEW.identity_basis,NEW.identity_reference)
   IS DISTINCT FROM ROW(OLD.tenant_id,OLD.kind,OLD.legal_name,OLD.identity_basis,OLD.identity_reference) THEN
  UPDATE public.finance_source_bindings SET verification_state='revoked',revision=revision+1
   WHERE entity_id=OLD.id AND verification_state<>'revoked';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_company_source_invalidation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER finance_company_source_invalidation BEFORE UPDATE OR DELETE ON public.finance_company_entities FOR EACH ROW EXECUTE FUNCTION public._finance_company_source_invalidation();

-- Setup owns the primary legal identity. A change revokes old Finance verification
-- atomically, including changes later reversed; it never reactivates an old binding.
CREATE FUNCTION public._finance_setup_source_invalidation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF coalesce(nullif(NEW.brand->'business_brief'->>'legalName',''),nullif(NEW.brand->>'legal_entity_name',''))
  IS DISTINCT FROM coalesce(nullif(OLD.brand->'business_brief'->>'legalName',''),nullif(OLD.brand->>'legal_entity_name','')) THEN
  UPDATE public.finance_source_bindings s SET verification_state='revoked',revision=revision+1
   FROM public.finance_company_entities e WHERE e.id=s.entity_id AND e.tenant_id=OLD.id
    AND e.kind='workspace_company' AND s.verification_state<>'revoked';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_setup_source_invalidation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER finance_setup_source_invalidation AFTER UPDATE OF brand ON public.tenants FOR EACH ROW EXECUTE FUNCTION public._finance_setup_source_invalidation();

CREATE FUNCTION public._finance_observation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE binding public.finance_source_bindings; active boolean; source_actor uuid; locked_actor uuid; native_namespace text; native_environment text; native_scope text;
BEGIN
 IF TG_OP='DELETE' AND public._finance_retirement_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Financial source observations are immutable' USING ERRCODE='42501'; END IF;
 SELECT * INTO binding FROM public.finance_source_bindings WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND id=NEW.binding_id;
 IF NOT FOUND OR binding.verification_state<>'verified' OR binding.revision<>NEW.binding_revision THEN RAISE EXCEPTION 'Verified financial source unavailable or changed' USING ERRCODE='42501'; END IF;
 IF binding.provider='quickbooks' THEN SELECT user_id INTO source_actor FROM public.quickbooks_connections WHERE id=binding.quickbooks_connection_id;
 ELSE SELECT user_id INTO source_actor FROM public.connected_bank_accounts WHERE id=binding.plaid_account_anchor_id; END IF;
 PERFORM public._finance_assert_stored_source_actor(source_actor,NEW.tenant_id);
 PERFORM 1 FROM public.tenants WHERE id=NEW.tenant_id AND status IN ('trial','active','past_due') AND archived_at IS NULL AND NOT lifecycle_execution_paused FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Financial workspace unavailable or paused' USING ERRCODE='42501'; END IF;
 IF binding.provider='quickbooks' THEN
  SELECT is_active,user_id,qb_realm_id,environment,scope INTO active,locked_actor,native_namespace,native_environment,native_scope FROM public.quickbooks_connections WHERE id=binding.quickbooks_connection_id FOR SHARE;
 ELSE
  SELECT is_active,user_id,account_id,plaid_environment INTO active,locked_actor,native_namespace,native_environment FROM public.connected_bank_accounts WHERE id=binding.plaid_account_anchor_id FOR SHARE;
 END IF;
 IF NOT coalesce(active,false) OR locked_actor IS DISTINCT FROM source_actor THEN RAISE EXCEPTION 'Financial connection revoked' USING ERRCODE='42501'; END IF;
 IF native_namespace IS NULL OR native_environment IS NULL OR binding.source_namespace IS DISTINCT FROM native_namespace
  OR binding.environment IS DISTINCT FROM native_environment THEN RAISE EXCEPTION 'Financial provider identity changed or unknown' USING ERRCODE='42501'; END IF;
 IF binding.provider='quickbooks' AND (native_scope ~ '(^|[[:space:]])com\.intuit\.quickbooks\.accounting($|[[:space:]])') IS NOT TRUE THEN RAISE EXCEPTION 'Accounting consent unavailable' USING ERRCODE='42501'; END IF;
 -- Lock mutable inputs in workspace → connection → company → binding order.
 -- Re-read the binding after lifecycle locks; the earlier read grants no proof.
 PERFORM 1 FROM public.finance_company_entities e JOIN public.tenants t ON t.id=e.tenant_id
  WHERE e.tenant_id=NEW.tenant_id AND e.id=NEW.entity_id AND e.is_active
   AND (e.kind<>'workspace_company' OR e.legal_name=coalesce(nullif(t.brand->'business_brief'->>'legalName',''),nullif(t.brand->>'legal_entity_name',''))) FOR SHARE OF e;
 IF NOT FOUND THEN RAISE EXCEPTION 'Financial company unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO binding FROM public.finance_source_bindings WHERE tenant_id=NEW.tenant_id AND entity_id=NEW.entity_id AND id=NEW.binding_id FOR SHARE;
 IF NOT FOUND OR binding.verification_state<>'verified' OR binding.revision<>NEW.binding_revision THEN RAISE EXCEPTION 'Verified financial source unavailable or changed' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._finance_observation_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER finance_observation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.finance_source_observations FOR EACH ROW EXECUTE FUNCTION public._finance_observation_guard();

-- Compose the existing workspace authority; freeze its mutable inputs for this transaction.
CREATE FUNCTION public._finance_assert_workspace(_actor uuid,_expected_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE parent_id uuid; delegated boolean;
BEGIN
 IF _actor IS NULL OR _expected_tenant IS NULL THEN RAISE EXCEPTION 'Finance workspace unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM auth.users WHERE id=_actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Finance actor unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.profiles WHERE user_id=_actor AND active_tenant_id=_expected_tenant FOR SHARE;
 IF NOT FOUND OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant THEN RAISE EXCEPTION 'Finance workspace changed' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=_expected_tenant AND status IN ('trial','active','past_due') AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Finance workspace unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenant_members WHERE user_id=_actor FOR SHARE;
 PERFORM 1 FROM public.user_roles WHERE user_id=_actor FOR SHARE;
 PERFORM 1 FROM public.agency_team_members WHERE user_id=_actor FOR SHARE;
 PERFORM 1 FROM public.tenants WHERE id=(SELECT parent_tenant_id FROM public.tenants WHERE id=_expected_tenant) FOR SHARE;
 SELECT parent_tenant_id INTO parent_id FROM public.tenants WHERE id=_expected_tenant;
 delegated:=coalesce(public.agency_can_manage_child(_expected_tenant,_actor),false) AND EXISTS(
   SELECT 1 FROM public.tenants parent JOIN public.tenants child ON child.parent_tenant_id=parent.id
   WHERE child.id=_expected_tenant AND parent.status IN ('trial','active','past_due') AND parent.archived_at IS NULL);
 -- Canonical agency switching leaves indistinguishable child admin seats behind.
 -- Until Identity provides grant provenance, a parented admin seat alone cannot
 -- bypass current agency authority. Genuine direct child owners remain independent.
 IF parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_expected_tenant AND user_id=_actor AND role='admin' AND status='active') AND NOT delegated THEN
  RAISE EXCEPTION 'Current delegated Finance authority required' USING ERRCODE='42501';
 END IF;
 IF NOT (coalesce(public.is_tenant_admin_as(_actor,_expected_tenant),false) OR delegated) THEN
  RAISE EXCEPTION 'Finance owner or administrator required' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._finance_assert_workspace(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._finance_assert_workspace(uuid,uuid) TO service_role;

-- Private actor recovery from the existing provider row. This is workspace-owner
-- validation only, not proof that the native provider company belongs to this entity.
CREATE FUNCTION public._finance_assert_stored_source_actor(_actor uuid,_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_claims text:=current_setting('request.jwt.claims',true); old_sub text:=current_setting('request.jwt.claim.sub',true);
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
 PERFORM set_config('request.jwt.claim.sub',coalesce(_actor::text,''),true);
 PERFORM public._finance_assert_workspace(_actor,_tenant);
 PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);
 PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claims',coalesce(old_claims,''),true);
 PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 RAISE;
END $$;
REVOKE ALL ON FUNCTION public._finance_assert_stored_source_actor(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._finance_assert_stored_source_actor(uuid,uuid) TO service_role;

CREATE FUNCTION public.read_finance_source_catalog(_expected_tenant_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE entities jsonb; sources jsonb;
BEGIN
 PERFORM public._finance_assert_workspace(auth.uid(),_expected_tenant_id);
 -- Bound metadata aggregation without silently omitting companies or accounts.
 IF (SELECT count(*) FROM (SELECT 1 FROM public.finance_company_entities WHERE tenant_id=_expected_tenant_id LIMIT 201) bounded)>200
  OR (SELECT count(*) FROM (SELECT 1 FROM public.finance_source_bindings WHERE tenant_id=_expected_tenant_id LIMIT 1001) bounded)>1000 THEN
  RAISE EXCEPTION 'Financial source catalog exceeds supported scope' USING ERRCODE='54000';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'legal_name',legal_name,'kind',kind,'identity_basis',identity_basis,'version',version,'is_active',is_active) ORDER BY created_at,id),'[]'::jsonb)
 INTO entities FROM public.finance_company_entities WHERE tenant_id=_expected_tenant_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'entity_id',s.entity_id,'provider',s.provider,'environment',s.environment,'verification_state',s.verification_state,'revision',s.revision,'verified_at',s.verified_at,
  'connection_active',CASE WHEN s.provider='quickbooks' THEN coalesce(q.is_active,false) ELSE coalesce(p.is_active,false) END) ORDER BY s.created_at,s.id),'[]'::jsonb)
 INTO sources FROM public.finance_source_bindings s
 LEFT JOIN public.quickbooks_connections q ON q.id=s.quickbooks_connection_id
 LEFT JOIN public.connected_bank_accounts p ON p.id=s.plaid_account_anchor_id
 WHERE s.tenant_id=_expected_tenant_id;
 RETURN jsonb_build_object('tenant_id',_expected_tenant_id,'read_at',clock_timestamp(),'entities',entities,'sources',sources);
END $$;
REVOKE ALL ON FUNCTION public.read_finance_source_catalog(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_finance_source_catalog(uuid) TO authenticated;

CREATE FUNCTION public.save_finance_company_entity(_expected_tenant_id uuid,_entity_id uuid,_expected_version bigint,_kind text,_legal_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.finance_company_entities; primary_name text; result public.finance_company_entities;
BEGIN
 PERFORM public._finance_assert_workspace(auth.uid(),_expected_tenant_id);
 IF _entity_id IS NULL OR _expected_version IS NULL OR _expected_version<0 OR _kind IS NULL OR _kind NOT IN ('workspace_company','managed_entity') OR _legal_name IS NULL OR length(btrim(_legal_name)) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'Invalid financial entity' USING ERRCODE='22023';
 END IF;
 IF _kind='workspace_company' THEN
  SELECT coalesce(nullif(brand->'business_brief'->>'legalName',''),nullif(brand->>'legal_entity_name','')) INTO primary_name FROM public.tenants WHERE id=_expected_tenant_id;
  IF primary_name IS NULL OR primary_name IS DISTINCT FROM _legal_name THEN RAISE EXCEPTION 'Company identity must match Setup business context' USING ERRCODE='22023'; END IF;
 END IF;
 -- Serialize creations as well as updates, so two retries cannot create two receipts.
 -- The transaction-scoped key uses native UUID identity, never names or masked digits.
 PERFORM pg_advisory_xact_lock(hashtextextended(_entity_id::text,0));
 IF EXISTS(SELECT 1 FROM public.finance_company_entities WHERE id=_entity_id AND tenant_id<>_expected_tenant_id) THEN
  RAISE EXCEPTION 'Financial entity unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO existing FROM public.finance_company_entities WHERE tenant_id=_expected_tenant_id AND id=_entity_id FOR UPDATE;
 IF FOUND THEN
  IF existing.version=_expected_version+1 AND existing.kind=_kind AND existing.legal_name=_legal_name AND existing.updated_by=auth.uid() THEN
   RETURN jsonb_build_object('id',existing.id,'tenant_id',existing.tenant_id,'version',existing.version,'legal_name',existing.legal_name,'identity_basis',existing.identity_basis,'receipt_run_id',existing.receipt_run_id,'replayed',true);
  END IF;
  IF existing.version<>_expected_version OR existing.kind<>_kind THEN RAISE EXCEPTION 'Financial entity changed' USING ERRCODE='40001'; END IF;
  IF existing.legal_name=_legal_name THEN
   RETURN jsonb_build_object('id',existing.id,'tenant_id',existing.tenant_id,'version',existing.version,'legal_name',existing.legal_name,'identity_basis',existing.identity_basis,'receipt_run_id',existing.receipt_run_id,'replayed',true);
  END IF;
  UPDATE public.finance_company_entities SET legal_name=_legal_name,version=version+1,updated_by=auth.uid(),receipt_run_id=gen_random_uuid(),updated_at=clock_timestamp() WHERE tenant_id=_expected_tenant_id AND id=_entity_id RETURNING * INTO result;
 ELSE
  IF _expected_version<>0 THEN RAISE EXCEPTION 'Financial entity changed' USING ERRCODE='40001'; END IF;
  INSERT INTO public.finance_company_entities(id,tenant_id,kind,legal_name,identity_basis,identity_reference,declared_by,updated_by)
   VALUES(_entity_id,_expected_tenant_id,_kind,_legal_name,CASE WHEN _kind='workspace_company' THEN 'setup_business_brief' ELSE 'owner_declaration' END,
    CASE WHEN _kind='workspace_company' THEN _expected_tenant_id::text ELSE _entity_id::text END,auth.uid(),auth.uid()) RETURNING * INTO result;
 END IF;
 -- One atomic canonical receipt; failure rolls back the entity write.
 -- All ten arguments select the existing correlation overload unambiguously.
 PERFORM public.record_capability_run(_expected_tenant_id,auth.uid(),'finance_entity_save','capability_succeeded',result.receipt_run_id,NULL,NULL,NULL,NULL,NULL);
 RETURN jsonb_build_object('id',result.id,'tenant_id',result.tenant_id,'version',result.version,'legal_name',result.legal_name,'identity_basis',result.identity_basis,'receipt_run_id',result.receipt_run_id,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.save_finance_company_entity(uuid,uuid,bigint,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.save_finance_company_entity(uuid,uuid,bigint,text,text) TO authenticated;
COMMIT;
