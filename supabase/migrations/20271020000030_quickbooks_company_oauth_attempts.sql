-- QuickBooks-owned ephemeral consent correlation. No credentials, activation or provider calls.
BEGIN;
CREATE TABLE public.quickbooks_oauth_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, entity_id uuid NOT NULL,
 entity_version bigint NOT NULL CHECK(entity_version>0), actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 environment text NOT NULL CHECK(environment IN ('sandbox','production')),
 requested_scope text NOT NULL DEFAULT 'com.intuit.quickbooks.accounting' CHECK(requested_scope='com.intuit.quickbooks.accounting'),
 state_hash text NOT NULL UNIQUE CHECK(state_hash ~ '^[0-9a-f]{64}$'),
 launch_hash text NOT NULL UNIQUE CHECK(launch_hash ~ '^[0-9a-f]{64}$'),
 launch_proof_hash text NOT NULL CHECK(launch_proof_hash ~ '^[0-9a-f]{64}$'),
 binding_hash text CHECK(binding_hash ~ '^[0-9a-f]{64}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','launched','exchanging','cancelled','expired','failed','refused')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
 consumed_at timestamptz, finished_at timestamptz,
 FOREIGN KEY(tenant_id,entity_id) REFERENCES public.finance_company_entities(tenant_id,id) ON DELETE RESTRICT,
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '11 minutes'),
 CHECK(status NOT IN ('launched','exchanging') OR binding_hash IS NOT NULL),
 CHECK(status<>'exchanging' OR consumed_at IS NOT NULL)
);
CREATE UNIQUE INDEX quickbooks_current_oauth_attempt ON public.quickbooks_oauth_attempts(actor_id,entity_id,environment) WHERE status IN ('pending','launched','exchanging');
-- FK erasure/retirement touches terminal history too; partial active indexes cannot serve it.
CREATE INDEX quickbooks_oauth_attempt_actor ON public.quickbooks_oauth_attempts(actor_id);
CREATE INDEX quickbooks_oauth_attempt_company ON public.quickbooks_oauth_attempts(tenant_id,entity_id);
ALTER TABLE public.quickbooks_oauth_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quickbooks_oauth_attempts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.quickbooks_oauth_attempts TO service_role;
COMMENT ON TABLE public.quickbooks_oauth_attempts IS 'QuickBooks consent correlation only; existing Integrations retains connection lifecycle. No tokens/native-company verification. Preparing or consuming state is not a connected provider.';

CREATE FUNCTION public._quickbooks_attempt_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF public._finance_retirement_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'QuickBooks authorization history is retained' USING ERRCODE='42501';
 END IF;
 IF OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
  AND (to_jsonb(NEW)-'actor_id')=(to_jsonb(OLD)-'actor_id')
  AND NOT EXISTS(SELECT 1 FROM auth.users WHERE id=OLD.actor_id) THEN RETURN NEW; END IF;
 IF ROW(NEW.id,NEW.tenant_id,NEW.entity_id,NEW.entity_version,NEW.actor_id,NEW.environment,NEW.requested_scope,NEW.state_hash,NEW.launch_hash,NEW.launch_proof_hash,NEW.created_at,NEW.expires_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.entity_id,OLD.entity_version,OLD.actor_id,OLD.environment,OLD.requested_scope,OLD.state_hash,OLD.launch_hash,OLD.launch_proof_hash,OLD.created_at,OLD.expires_at) THEN
  RAISE EXCEPTION 'QuickBooks authorization identity is immutable' USING ERRCODE='42501';
 END IF;
 IF NOT ((OLD.status='pending' AND NEW.status IN ('launched','cancelled','expired'))
  OR (OLD.status='launched' AND NEW.status IN ('exchanging','cancelled','expired'))
  OR (OLD.status='exchanging' AND NEW.status IN ('failed','refused','cancelled','expired'))) THEN
  RAISE EXCEPTION 'QuickBooks authorization changed' USING ERRCODE='40001';
 END IF;
 IF (NOT (OLD.status='pending' AND NEW.status='launched') AND NEW.binding_hash IS DISTINCT FROM OLD.binding_hash)
  OR (NEW.status<>'exchanging' AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
  RAISE EXCEPTION 'QuickBooks authorization proof is immutable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._quickbooks_attempt_guard() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER quickbooks_attempt_identity BEFORE UPDATE OR DELETE ON public.quickbooks_oauth_attempts FOR EACH ROW EXECUTE FUNCTION public._quickbooks_attempt_guard();

-- Extend the existing retirement disposition; never introduce another deletion manager.
DO $$
DECLARE definition text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; position integer;
BEGIN
 definition:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure);
 position:=strpos(definition,anchor);
 IF position=0 OR strpos(definition,'''finance_company_entities''')=0
  OR strpos(definition,'''quickbooks_oauth_attempts''')>0 THEN
  RAISE EXCEPTION 'Unsupported canonical retirement policy';
 END IF;
 EXECUTE left(definition,position+length(anchor)-1)||'''quickbooks_oauth_attempts'','||substr(definition,position+length(anchor));
END $$;

CREATE FUNCTION public.begin_quickbooks_company_authorization(_expected_tenant_id uuid,_entity_id uuid,_expected_entity_version bigint,_environment text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE entity public.finance_company_entities; state text; ticket text; proof text; attempt public.quickbooks_oauth_attempts;
BEGIN
 PERFORM public._finance_assert_workspace(auth.uid(),_expected_tenant_id);
 PERFORM 1 FROM public.tenants WHERE id=_expected_tenant_id AND NOT lifecycle_execution_paused FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Financial workspace paused' USING ERRCODE='42501'; END IF;
 IF _environment IS NULL OR _environment NOT IN ('sandbox','production') THEN RAISE EXCEPTION 'Invalid QuickBooks environment' USING ERRCODE='22023'; END IF;
 SELECT * INTO entity FROM public.finance_company_entities WHERE tenant_id=_expected_tenant_id AND id=_entity_id AND is_active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Financial company unavailable' USING ERRCODE='42501'; END IF;
 IF entity.version IS DISTINCT FROM _expected_entity_version THEN RAISE EXCEPTION 'Financial company changed' USING ERRCODE='40001'; END IF;
 IF entity.kind='workspace_company' AND NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=entity.tenant_id AND entity.legal_name=coalesce(nullif(t.brand->'business_brief'->>'legalName',''),nullif(t.brand->>'legal_entity_name',''))) THEN RAISE EXCEPTION 'Financial company changed' USING ERRCODE='40001'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||entity.id::text||':'||_environment,0));
 UPDATE public.quickbooks_oauth_attempts SET status='cancelled',finished_at=clock_timestamp()
  WHERE actor_id=auth.uid() AND entity_id=entity.id AND environment=_environment AND status IN ('pending','launched','exchanging');
 state:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 ticket:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 proof:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 INSERT INTO public.quickbooks_oauth_attempts(tenant_id,entity_id,entity_version,actor_id,environment,state_hash,launch_hash,launch_proof_hash)
  VALUES(_expected_tenant_id,entity.id,entity.version,auth.uid(),_environment,
   encode(sha256(convert_to(state,'UTF8')),'hex'),encode(sha256(convert_to(ticket,'UTF8')),'hex'),encode(sha256(convert_to(proof,'UTF8')),'hex')) RETURNING * INTO attempt;
 PERFORM public.record_capability_run(_expected_tenant_id,auth.uid(),'quickbooks_authorization_prepare','capability_succeeded',attempt.id,NULL,NULL,NULL,NULL,NULL);
 RETURN jsonb_build_object('attempt_id',attempt.id,'state',state,'launch_ticket',ticket,'launch_proof',proof,'expires_at',attempt.expires_at,'environment',attempt.environment,'requested_scope',attempt.requested_scope,'provider_connected',false);
END $$;
REVOKE ALL ON FUNCTION public.begin_quickbooks_company_authorization(uuid,uuid,bigint,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.begin_quickbooks_company_authorization(uuid,uuid,bigint,text) TO authenticated;

CREATE FUNCTION public.quickbooks_oauth_attempt_service(_operation text,_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE attempt public.quickbooks_oauth_attempts; entity public.finance_company_entities; outcome text; expected_status text;
BEGIN
 IF _input IS NULL OR jsonb_typeof(_input)<>'object' OR _operation IS NULL OR _operation NOT IN ('launch','consume','validate_exchange','finish') THEN
  RAISE EXCEPTION 'QuickBooks authorization refused' USING ERRCODE='42501';
 END IF;
 IF _operation='launch' THEN
  SELECT * INTO attempt FROM public.quickbooks_oauth_attempts
   WHERE launch_hash=_input->>'launch_hash' AND launch_proof_hash=_input->>'launch_proof_hash' AND state_hash=_input->>'state_hash' AND status='pending';
 ELSIF _operation='consume' THEN
  SELECT * INTO attempt FROM public.quickbooks_oauth_attempts
   WHERE state_hash=_input->>'state_hash' AND binding_hash=_input->>'binding_hash' AND status='launched';
 ELSE
  SELECT * INTO attempt FROM public.quickbooks_oauth_attempts WHERE id=(_input->>'attempt_id')::uuid AND status='exchanging';
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'QuickBooks authorization refused' USING ERRCODE='42501'; END IF;
 IF attempt.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'QuickBooks authorization expired' USING ERRCODE='42501'; END IF;
 PERFORM public._finance_assert_stored_source_actor(attempt.actor_id,attempt.tenant_id);
 PERFORM 1 FROM public.tenants WHERE id=attempt.tenant_id AND NOT lifecycle_execution_paused FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Financial workspace paused' USING ERRCODE='42501'; END IF;
 SELECT * INTO entity FROM public.finance_company_entities WHERE tenant_id=attempt.tenant_id AND id=attempt.entity_id AND is_active FOR SHARE;
 IF NOT FOUND OR entity.version<>attempt.entity_version THEN RAISE EXCEPTION 'Financial company changed' USING ERRCODE='40001'; END IF;
 IF entity.kind='workspace_company' AND NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=entity.tenant_id AND entity.legal_name=coalesce(nullif(t.brand->'business_brief'->>'legalName',''),nullif(t.brand->>'legal_entity_name',''))) THEN RAISE EXCEPTION 'Financial company changed' USING ERRCODE='40001'; END IF;
 -- Lock actor/workspace/company before consent, matching preparation. The first
 -- lookup grants no authority; re-read the status under lock before consuming it.
 expected_status:=attempt.status;
 SELECT * INTO attempt FROM public.quickbooks_oauth_attempts WHERE id=attempt.id AND status=expected_status FOR UPDATE;
 IF NOT FOUND OR attempt.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'QuickBooks authorization refused' USING ERRCODE='42501'; END IF;
 IF _operation='launch' THEN
  IF (_input->>'binding_hash' ~ '^[0-9a-f]{64}$') IS NOT TRUE THEN RAISE EXCEPTION 'QuickBooks authorization refused' USING ERRCODE='42501'; END IF;
  UPDATE public.quickbooks_oauth_attempts SET status='launched',binding_hash=_input->>'binding_hash' WHERE id=attempt.id;
 ELSIF _operation='consume' THEN
  UPDATE public.quickbooks_oauth_attempts SET status='exchanging',consumed_at=clock_timestamp() WHERE id=attempt.id;
 ELSIF _operation='finish' THEN
  outcome:=_input->>'outcome';
  IF outcome IS NULL OR outcome NOT IN ('failed','refused','cancelled') THEN RAISE EXCEPTION 'No verified QuickBooks connection outcome' USING ERRCODE='42501'; END IF;
  UPDATE public.quickbooks_oauth_attempts SET status=outcome,finished_at=clock_timestamp() WHERE id=attempt.id;
 END IF;
 RETURN jsonb_build_object('attempt_id',attempt.id,'actor_id',attempt.actor_id,'tenant_id',attempt.tenant_id,'entity_id',attempt.entity_id,'entity_version',attempt.entity_version,
  'environment',attempt.environment,'requested_scope',attempt.requested_scope,'provider_connected',false);
END $$;
REVOKE ALL ON FUNCTION public.quickbooks_oauth_attempt_service(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quickbooks_oauth_attempt_service(text,jsonb) TO service_role;
COMMIT;
