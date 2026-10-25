-- Preserve the original creator availability before issuing/consuming HIGH.
-- The original _sales_invoice_actor holds the tenant row FOR UPDATE first.
-- Subscription trialing is separate: canonical enrollment creates active tenants.
-- No new function, role, permission, approval, Work writer or history rule.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $guard$
DECLARE p pg_catalog.pg_proc%ROWTYPE; original_owner oid;
BEGIN
 SELECT proowner INTO original_owner FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._sales_invoice_actor(uuid,uuid)');
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('private.e04_prepared_confirmation_source(uuid,uuid,jsonb)');
 IF NOT FOUND OR original_owner IS NULL OR p.proowner IS DISTINCT FROM original_owner
  OR pg_catalog.md5(p.prosrc) NOT IN ('8f14988369b520427da5f663d37ce00f','039070012a306af391746d9ce95eeb61')
  OR NOT p.prosecdef OR p.pronargs<>3 OR p.pronargdefaults<>0 OR p.provariadic<>0
  OR p.proargnames IS DISTINCT FROM ARRAY['_actor','_tenant','_args']::text[]
  OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
  OR p.prorettype<>'void'::regtype OR p.proretset OR p.proisstrict OR p.proleakproof
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.prokind<>'f'
  OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
  OR pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
  OR pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a WHERE a.privilege_type='EXECUTE' AND a.grantee<>original_owner) THEN
  RAISE EXCEPTION 'Original agreement approval source changed' USING ERRCODE='23514';
 END IF;
END $guard$;

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
  OR NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=_tenant AND t.archived_at IS NULL AND t.status='active') THEN
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

COMMIT;
