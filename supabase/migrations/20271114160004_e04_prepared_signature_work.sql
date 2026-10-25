-- Originating agreement domain bridge to ORIGINAL durable Work. Unmounted:
-- no token, message, signature, financial action, scheduler or provider effect.
-- Authority context and audit references never constitute execution permission.
BEGIN;
SET LOCAL lock_timeout='3s';

CREATE OR REPLACE FUNCTION public._read_prepared_agreement_work(
 _actor uuid,_tenant uuid,_operation uuid,_request_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.paige_durable_work%ROWTYPE; p public.paige_pending_confirmations%ROWTYPE; r jsonb;
BEGIN
 PERFORM public._sales_invoice_actor(_actor,_tenant);
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_actor AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=pg_catalog.clock_timestamp()) AND NOT coalesce(u.is_anonymous,false))
  OR NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=_tenant AND t.archived_at IS NULL) THEN
  RAISE EXCEPTION 'Agreement work access unavailable' USING ERRCODE='42501'; END IF;
 IF _operation IS NULL OR _request_sha256 IS NULL OR _request_sha256 !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'Agreement work input invalid' USING ERRCODE='22023'; END IF;
 SELECT * INTO w FROM public.paige_durable_work
  WHERE tenant_id=_tenant AND initiating_user_id=_actor AND intent_id=_operation;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF w.capability_key IS DISTINCT FROM 'agreement.send' OR w.work_kind IS DISTINCT FROM 'agreement_signature_request'
  OR w.thread_id IS NOT NULL OR w.authority_context->>'request_sha256' IS DISTINCT FROM _request_sha256
  OR w.authority_context->>'operation_id' IS DISTINCT FROM _operation::text THEN
  RAISE EXCEPTION 'Agreement original work differs' USING ERRCODE='22023'; END IF;
 SELECT * INTO p FROM public.paige_pending_confirmations
  WHERE id=(w.authority_context->>'confirmation_id')::uuid AND user_id=_actor AND tenant_id=_tenant;
 IF NOT FOUND OR p.tool_name IS DISTINCT FROM 'agreement_send' OR p.thread_id IS NOT NULL OR p.scoped_client_id IS NOT NULL
  OR p.server_issued_at IS NULL OR p.issued_in_request IS NULL OR p.consumed_at IS NULL
  OR p.claimed_in_request IS NULL OR p.claimed_in_request=p.issued_in_request
  OR p.args->>'request_sha256' IS DISTINCT FROM _request_sha256
  OR p.args->>'operation_id' IS DISTINCT FROM _operation::text
  OR p.args->>'expected_tenant_id' IS DISTINCT FROM _tenant::text
  OR w.authority_context->>'claimed_request_id' IS DISTINCT FROM p.claimed_in_request::text THEN
  RAISE EXCEPTION 'Agreement original work unverified' USING ERRCODE='42501'; END IF;
 r:=p.args->'request';
 IF _request_sha256 IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    public._paige_commercial_canonical_json(r),'UTF8')),'hex')
  OR w.authority_context->>'agreement_id' IS DISTINCT FROM r->>'agreementId'
  OR w.authority_context->>'client_id' IS DISTINCT FROM r#>>'{source,client_id}'
  OR w.authority_context->>'preparation_id' IS DISTINCT FROM r->>'preparationId'
  OR w.authority_context->>'preparation_sha256' IS DISTINCT FROM r->>'preparationSha256' THEN
  RAISE EXCEPTION 'Agreement original source differs' USING ERRCODE='42501'; END IF;
 -- Historical read deliberately precedes draft/provider/source eligibility.
 -- Work state is NOT an agreement/send/provider/signature/payment receipt.
 RETURN pg_catalog.jsonb_build_object('kind','prepared_signature_work','execution','unavailable',
  'work_id',w.id,'work_status',w.status,'operation_id',_operation,'request_sha256',_request_sha256,
  'agreement_id',r->'agreementId','preparation_id',r->'preparationId');
END $$;
REVOKE ALL ON FUNCTION public._read_prepared_agreement_work(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._read_prepared_agreement_work(uuid,uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public._register_prepared_agreement_work(
 _actor uuid,_tenant uuid,_confirmation uuid,_request_nonce uuid,_fingerprint text,_audit uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb; p public.paige_pending_confirmations%ROWTYPE; a public.paige_audit_log%ROWTYPE;
 r jsonb; context jsonb; approved_args jsonb; operation uuid; digest text;
BEGIN
 -- Original actor/profile/business lock first. The public read uses that
 -- same domain authority before any historical original Work projection.
 PERFORM public._sales_invoice_actor(_actor,_tenant);
 IF _confirmation IS NULL OR _request_nonce IS NULL OR _audit IS NULL
  OR _fingerprint IS NULL OR _fingerprint !~ '^[a-f0-9]{16}$' THEN
  RAISE EXCEPTION 'Agreement work approval unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.paige_pending_confirmations
  WHERE id=_confirmation AND user_id=_actor AND tenant_id=_tenant;
 IF NOT FOUND OR p.tool_name IS DISTINCT FROM 'agreement_send' OR p.thread_id IS NOT NULL OR p.scoped_client_id IS NOT NULL
  OR p.server_issued_at IS NULL OR p.issued_in_request IS NULL OR p.consumed_at IS NULL
  OR p.claimed_in_request IS DISTINCT FROM _request_nonce OR p.issued_in_request=_request_nonce
  OR p.fingerprint IS DISTINCT FROM _fingerprint THEN
  RAISE EXCEPTION 'Agreement work approval unavailable' USING ERRCODE='42501'; END IF;
 approved_args:=p.args; r:=p.args->'request'; operation:=(p.args->>'operation_id')::uuid; digest:=p.args->>'request_sha256';
 context:=pg_catalog.jsonb_build_object('tenant_id',_tenant,'actor_user_id',_actor,'operation_id',operation,
  'agreement_id',r->'agreementId','client_id',r#>'{source,client_id}',
  'preparation_id',r->'preparationId','preparation_sha256',r->'preparationSha256',
  'request_sha256',digest,'confirmation_id',_confirmation,'claimed_request_id',_request_nonce,'decision_audit_id',_audit);
 prior:=public._read_prepared_agreement_work(_actor,_tenant,operation,digest);
 IF prior IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.paige_durable_work w WHERE w.id=(prior->>'work_id')::uuid
    AND w.tenant_id=_tenant AND w.initiating_user_id=_actor AND w.authority_context=context) THEN
   RAISE EXCEPTION 'Agreement original work differs' USING ERRCODE='42501'; END IF;
  RETURN prior;
 END IF;
 -- Same original source lock order as native confirmation. Re-read proposal
 -- after the source lock; concurrent expiry/revocation cannot use old facts.
 PERFORM private.e04_prepared_confirmation_source(_actor,_tenant,p.args);
 SELECT * INTO p FROM public.paige_pending_confirmations WHERE id=_confirmation FOR UPDATE;
 IF NOT FOUND OR p.user_id IS DISTINCT FROM _actor OR p.tenant_id IS DISTINCT FROM _tenant
  OR p.tool_name IS DISTINCT FROM 'agreement_send' OR p.thread_id IS NOT NULL OR p.scoped_client_id IS NOT NULL
  OR p.args IS DISTINCT FROM approved_args
  OR p.server_issued_at IS NULL OR p.issued_in_request IS NULL OR p.consumed_at IS NULL
  OR p.claimed_in_request IS DISTINCT FROM _request_nonce OR p.issued_in_request=_request_nonce
  OR p.fingerprint IS DISTINCT FROM _fingerprint OR p.expires_at<=pg_catalog.clock_timestamp() THEN
  RAISE EXCEPTION 'Agreement work approval unavailable' USING ERRCODE='42501'; END IF;
 IF coalesce(public.resolve_tool_autonomy(_tenant,'agreement_send'),'off') NOT IN ('confirm','auto') THEN
  RAISE EXCEPTION 'Agreement work authority held' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.paige_audit_log WHERE id=_audit FOR SHARE;
 IF NOT FOUND OR a.tenant_id IS DISTINCT FROM _tenant OR a.actor_user_id IS DISTINCT FROM _actor
  OR a.action IS DISTINCT FROM 'sales.agreement_signature_request_governed_decision'
  OR a.target_type IS DISTINCT FROM 'agreement' OR a.target_id::text IS DISTINCT FROM r->>'agreementId'
  OR a.payload->>'capability' IS DISTINCT FROM 'agreement_send' OR a.payload->>'decision' IS DISTINCT FROM 'execute'
  OR a.payload->>'risk' IS DISTINCT FROM 'high' OR a.payload->>'lane_effective' IS DISTINCT FROM 'confirm'
  OR a.payload->>'operation_id' IS DISTINCT FROM operation::text OR a.payload->>'request_sha256' IS DISTINCT FROM digest THEN
  RAISE EXCEPTION 'Agreement work decision evidence unavailable' USING ERRCODE='42501'; END IF;
 -- Original Work owns identity, idempotency, status, limits and retries. Its
 -- current cohort restrictions intentionally remain unchanged. Snapshot and
 -- audit checks above are not authority to dispatch a future external act.
 PERFORM * FROM public.create_paige_durable_work(_tenant,_actor,operation,NULL,'agreement.send',
  'agreement_signature_request',context,'agreement-preparation:'||(r->>'preparationSha256')||':'||digest,300,1);
 prior:=public._read_prepared_agreement_work(_actor,_tenant,operation,digest);
 IF prior IS NULL THEN RAISE EXCEPTION 'Agreement work readback required' USING ERRCODE='40001'; END IF;
 RETURN prior;
END $$;
REVOKE ALL ON FUNCTION public._register_prepared_agreement_work(uuid,uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._register_prepared_agreement_work(uuid,uuid,uuid,uuid,text,uuid) TO service_role;
COMMIT;
