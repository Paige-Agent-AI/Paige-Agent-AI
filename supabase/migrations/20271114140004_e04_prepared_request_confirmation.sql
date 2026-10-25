-- Originating agreement.send prerequisite only. No route, token, signature,
-- document-state transition, message, provider call, or execution admission.
-- Store and claim the ORIGINAL server-issued confirmation, using canonical
-- actor/source locks and the existing immutable preparation/JSON constructor.
BEGIN;
SET LOCAL lock_timeout='3s';

CREATE OR REPLACE FUNCTION private.e04_prepared_confirmation_source(
  _actor uuid,_tenant uuid,_args jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 r jsonb; s jsonb; p jsonb; a public.paige_agreements%ROWTYPE;
 recipients jsonb; messages jsonb; at_time timestamptz;
BEGIN
 PERFORM public._sales_invoice_actor(_actor,_tenant);
 at_time:=pg_catalog.clock_timestamp();
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_actor AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=at_time) AND NOT coalesce(u.is_anonymous,false))
  OR NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=_tenant AND t.archived_at IS NULL) THEN
  RAISE EXCEPTION 'Agreement approval access unavailable' USING ERRCODE='42501';
 END IF;
 IF pg_catalog.jsonb_typeof(_args) IS DISTINCT FROM 'object'
  OR NOT (_args ?& ARRAY['request','request_sha256','operation_id','expected_tenant_id','approval_subject','approval_cycle_nonce'])
  OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(_args))<>6 THEN
  RAISE EXCEPTION 'Agreement approval input invalid' USING ERRCODE='22023';
 END IF;
 r:=_args->'request'; s:=r->'source';
 IF pg_catalog.jsonb_typeof(r) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(r))<>13
  OR NOT (r ?& ARRAY['agreementId','expectedTenantId','operationId','preparationId','preparationSha256',
    'reviewSha256','source','title','document','recipients','requestSchemaVersion','sender','messages'])
  OR pg_catalog.jsonb_typeof(s) IS DISTINCT FROM 'object'
  OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(s))<>3
  OR NOT (s ?& ARRAY['client_id','version','updated_at'])
  OR _args->>'expected_tenant_id' IS DISTINCT FROM _tenant::text
  OR r->>'expectedTenantId' IS DISTINCT FROM _tenant::text
  OR r->>'operationId' IS DISTINCT FROM _args->>'operation_id'
  OR coalesce(_args->>'operation_id','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  OR coalesce(_args->>'approval_cycle_nonce','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  OR coalesce(r->>'agreementId','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  OR coalesce(r->>'preparationId','') !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  OR coalesce(r->>'preparationSha256','') !~ '^[a-f0-9]{64}$'
  OR coalesce(r->>'reviewSha256','') !~ '^[a-f0-9]{64}$'
  OR r->'requestSchemaVersion' IS DISTINCT FROM '1'::jsonb
  OR _args->>'approval_subject' IS DISTINCT FROM 'agreement.prepared_signature_request:'||(r->>'agreementId')||':'||(_args->>'operation_id')
  OR _args->>'request_sha256' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    public._paige_commercial_canonical_json(r),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'Agreement approval input changed' USING ERRCODE='22023';
 END IF;
 -- The original reader repeats current business/user/role locks. Its parent
 -- agreement lock also holds the source steady through the proposal/claim.
 p:=public._read_agreement_document_preparation(_actor,_tenant,
   (r->>'agreementId')::uuid,(r->>'preparationId')::uuid);
 SELECT * INTO a FROM public.paige_agreements
  WHERE id=(r->>'agreementId')::uuid AND tenant_id=_tenant FOR SHARE;
 IF NOT FOUND OR p->>'state' IS DISTINCT FROM 'retained' OR p->'is_selected' IS DISTINCT FROM 'true'::jsonb
  OR p->'source_matches' IS DISTINCT FROM 'true'::jsonb
  OR p->>'preparation_sha256' IS DISTINCT FROM r->>'preparationSha256'
  OR p->>'client_id' IS DISTINCT FROM s->>'client_id'
  OR p->'source_version' IS DISTINCT FROM s->'version'
  OR (p->>'source_updated_at')::timestamptz IS DISTINCT FROM (s->>'updated_at')::timestamptz
  OR a.title IS DISTINCT FROM r->>'title'
  OR r->'document' IS DISTINCT FROM pg_catalog.jsonb_build_object('sha256',p->'document_sha256',
    'byte_length',p->'document_byte_length','page_count',pg_catalog.jsonb_array_length(p#>'{manifest,document,pages}')) THEN
  RAISE EXCEPTION 'Agreement approval source changed' USING ERRCODE='40001';
 END IF;
 -- Use the retained party order and ORIGINAL signer records. No supplied
 -- recipient or field count becomes an alternative customer identity.
 PERFORM 1 FROM public.paige_agreement_signers WHERE agreement_id=a.id AND tenant_id=_tenant FOR SHARE;
 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',party.id,'full_name',party.full_name,
   'email',party.email,'signer_role',party.signer_role,'signing_order',party.signing_order,
   'field_count',(SELECT count(*) FROM pg_catalog.jsonb_array_elements(p#>'{manifest,fields}') f
     WHERE f->>'signer_id'=party.id::text)) ORDER BY entry.ordinal)
 INTO recipients FROM pg_catalog.jsonb_array_elements(p#>'{manifest,signers}') WITH ORDINALITY entry(value,ordinal)
 JOIN public.paige_agreement_signers party ON party.id=(entry.value->>'id')::uuid
  AND party.agreement_id=a.id AND party.tenant_id=_tenant;
 IF recipients IS NULL OR pg_catalog.jsonb_array_length(recipients) NOT BETWEEN 1 AND 100
  OR recipients IS DISTINCT FROM r->'recipients'
  OR pg_catalog.jsonb_typeof(r->'messages') IS DISTINCT FROM 'array'
  OR pg_catalog.jsonb_array_length(r->'messages')<>pg_catalog.jsonb_array_length(recipients) THEN
  RAISE EXCEPTION 'Agreement approval recipients changed' USING ERRCODE='40001';
 END IF;
 messages:=r->'messages';
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(recipients) WITH ORDINALITY recipient(value,ordinal)
   WHERE messages->((recipient.ordinal-1)::integer)->>'signer_id' IS DISTINCT FROM recipient.value->>'id'
    OR messages->((recipient.ordinal-1)::integer)->>'to' IS DISTINCT FROM recipient.value->>'email')
  OR pg_catalog.jsonb_typeof(r->'sender') IS DISTINCT FROM 'object'
  OR r#>>'{sender,provider}' IS DISTINCT FROM 'sendgrid'
  OR NOT EXISTS(SELECT 1 FROM public.channel_connectors connector
    WHERE connector.id=(r#>>'{sender,connector_id}')::uuid AND connector.tenant_id=_tenant
     AND connector.channel_type='email' AND connector.provider='sendgrid'
     AND connector.active AND connector.status='active') THEN
  RAISE EXCEPTION 'Agreement approval delivery context changed' USING ERRCODE='40001';
 END IF;
 -- This is not provider readiness or Storage proof. The existing server
 -- preflight and eventual original dispatch must still prove them separately.
END $$;
REVOKE ALL ON FUNCTION private.e04_prepared_confirmation_source(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._read_prepared_agreement_confirmation(
 _actor uuid,_tenant uuid,_operation uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.paige_pending_confirmations%ROWTYPE; matches integer;
BEGIN
 PERFORM public._sales_invoice_actor(_actor,_tenant);
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_actor AND u.deleted_at IS NULL
   AND (u.banned_until IS NULL OR u.banned_until<=pg_catalog.clock_timestamp()) AND NOT coalesce(u.is_anonymous,false))
  OR NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=_tenant AND t.archived_at IS NULL) THEN
  RAISE EXCEPTION 'Agreement approval access unavailable' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO matches FROM public.paige_pending_confirmations c
  WHERE c.user_id=_actor AND c.tenant_id=_tenant AND c.tool_name='agreement_send'
   AND c.thread_id IS NULL AND c.scoped_client_id IS NULL AND c.args->>'operation_id'=_operation::text;
 IF matches=0 THEN RETURN NULL; END IF;
 IF matches<>1 THEN RAISE EXCEPTION 'Agreement approval history ambiguous' USING ERRCODE='40001'; END IF;
 SELECT * INTO p FROM public.paige_pending_confirmations c
  WHERE c.user_id=_actor AND c.tenant_id=_tenant AND c.tool_name='agreement_send'
   AND c.thread_id IS NULL AND c.scoped_client_id IS NULL AND c.args->>'operation_id'=_operation::text;
 RETURN pg_catalog.jsonb_build_object('confirmation_id',p.id,'args',p.args,'expires_at',p.expires_at,
  'state',CASE WHEN p.server_issued_at IS NULL OR p.issued_in_request IS NULL THEN 'unverified'
    WHEN p.consumed_at IS NOT NULL THEN 'consumed'
    WHEN p.expires_at<=pg_catalog.clock_timestamp() THEN 'expired' ELSE 'proposed' END);
END $$;
REVOKE ALL ON FUNCTION public._read_prepared_agreement_confirmation(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._read_prepared_agreement_confirmation(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._issue_prepared_agreement_confirmation(
 _actor uuid,_tenant uuid,_args jsonb,_fingerprint text,_request_nonce uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb; p public.paige_pending_confirmations%ROWTYPE; at_time timestamptz;
BEGIN
 PERFORM private.e04_prepared_confirmation_source(_actor,_tenant,_args);
 IF _request_nonce IS NULL OR _fingerprint IS NULL OR _fingerprint !~ '^[a-f0-9]{16}$' THEN
  RAISE EXCEPTION 'Agreement approval request invalid' USING ERRCODE='22023'; END IF;
 IF coalesce(public.resolve_tool_autonomy(_tenant,'agreement_send'),'off') NOT IN ('confirm','auto') THEN
  RAISE EXCEPTION 'Agreement approval authority held' USING ERRCODE='42501'; END IF;
 prior:=public._read_prepared_agreement_confirmation(_actor,_tenant,(_args->>'operation_id')::uuid);
 IF prior IS NOT NULL THEN
  SELECT * INTO p FROM public.paige_pending_confirmations WHERE id=(prior->>'confirmation_id')::uuid FOR UPDATE;
  IF prior->>'state' IS DISTINCT FROM 'proposed' OR p.args IS DISTINCT FROM _args
   OR p.fingerprint IS DISTINCT FROM _fingerprint OR p.consumed_at IS NOT NULL
   OR p.server_issued_at IS NULL OR p.issued_in_request IS NULL
   OR p.expires_at<=pg_catalog.clock_timestamp() THEN
   RAISE EXCEPTION 'Agreement approval needs a new explicit review' USING ERRCODE='40001'; END IF;
  RETURN pg_catalog.jsonb_build_object('expires_at',p.expires_at);
 END IF;
 at_time:=pg_catalog.clock_timestamp();
 INSERT INTO public.paige_pending_confirmations(user_id,tenant_id,thread_id,scoped_client_id,
   tool_name,fingerprint,args,summary,issued_in_request,server_issued_at,created_at,expires_at)
 VALUES(_actor,_tenant,NULL,NULL,'agreement_send',_fingerprint,_args,
   'Request signatures on the exact reviewed agreement from '||pg_catalog.jsonb_array_length(_args#>'{request,recipients}')::text
     ||' recipient(s), using the reviewed business email and messages. Sending does not authorize a payment.',
   _request_nonce,at_time,at_time,at_time+interval '10 minutes') RETURNING * INTO p;
 RETURN pg_catalog.jsonb_build_object('expires_at',p.expires_at);
END $$;
REVOKE ALL ON FUNCTION public._issue_prepared_agreement_confirmation(uuid,uuid,jsonb,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._issue_prepared_agreement_confirmation(uuid,uuid,jsonb,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._claim_prepared_agreement_confirmation(
 _actor uuid,_tenant uuid,_operation uuid,_fingerprint text,_request_nonce uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prior jsonb; p public.paige_pending_confirmations%ROWTYPE;
BEGIN
 -- Lock current actor/business first, source second, original proposal last.
 prior:=public._read_prepared_agreement_confirmation(_actor,_tenant,_operation);
 IF prior IS NULL THEN RETURN NULL; END IF;
 PERFORM private.e04_prepared_confirmation_source(_actor,_tenant,prior->'args');
 SELECT * INTO p FROM public.paige_pending_confirmations WHERE id=(prior->>'confirmation_id')::uuid FOR UPDATE;
 IF NOT FOUND OR p.user_id IS DISTINCT FROM _actor OR p.tenant_id IS DISTINCT FROM _tenant
  OR p.tool_name IS DISTINCT FROM 'agreement_send' OR p.thread_id IS NOT NULL OR p.scoped_client_id IS NOT NULL
  OR p.args IS DISTINCT FROM prior->'args' OR p.server_issued_at IS NULL OR p.issued_in_request IS NULL
  OR p.consumed_at IS NOT NULL OR p.expires_at<=pg_catalog.clock_timestamp()
  OR _request_nonce IS NULL OR p.issued_in_request=_request_nonce
  OR _fingerprint IS NULL OR p.fingerprint IS DISTINCT FROM _fingerprint THEN RETURN NULL; END IF;
 IF coalesce(public.resolve_tool_autonomy(_tenant,'agreement_send'),'off') NOT IN ('confirm','auto') THEN
  RAISE EXCEPTION 'Agreement approval authority held' USING ERRCODE='42501'; END IF;
 UPDATE public.paige_pending_confirmations SET consumed_at=pg_catalog.clock_timestamp(),claimed_in_request=_request_nonce
  WHERE id=p.id AND consumed_at IS NULL;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN pg_catalog.jsonb_build_object('confirmation_id',p.id,'request_nonce',_request_nonce,'args',p.args);
END $$;
REVOKE ALL ON FUNCTION public._claim_prepared_agreement_confirmation(uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._claim_prepared_agreement_confirmation(uuid,uuid,uuid,text,uuid) TO service_role;
COMMIT;
