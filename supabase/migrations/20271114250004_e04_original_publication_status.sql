-- Read original provider-accepted publication; no send or state transition.
-- Work success, signing and payment remain different original evidence.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $guard$
DECLARE expected record; actual pg_catalog.pg_proc%ROWTYPE; original_owner oid;
BEGIN
 SELECT proowner INTO original_owner FROM pg_catalog.pg_proc
  WHERE oid=pg_catalog.to_regprocedure('public._read_prepared_agreement_request_status(uuid,uuid,uuid,text)');
 IF NOT FOUND THEN RAISE EXCEPTION 'Original publication status source changed' USING ERRCODE='23514'; END IF;
 FOR expected IN SELECT * FROM (VALUES
  ('public._read_prepared_agreement_request_status(uuid,uuid,uuid,text)','7cdf08ab70430d5b95706695608e6fea','716caa2b2535ad966271ca87f88a64f8',true,ARRAY['_actor','_tenant','_operation','_request_sha256']::text[]),
  ('public._read_prepared_agreement_work(uuid,uuid,uuid,text)','c76fcd36123c7189e9c73b75142c91a2','c76fcd36123c7189e9c73b75142c91a2',true,ARRAY['_actor','_tenant','_operation','_request_sha256']::text[]),
  ('private.e04_prepared_publication_record(uuid,uuid,uuid)','7bb1989b7dbd714a66dcad9e265d68d4','7bb1989b7dbd714a66dcad9e265d68d4',false,ARRAY['_tenant','_agreement','_preparation']::text[])
 ) AS checks(identity,old_body,own_body,service,argument_names) LOOP
  SELECT * INTO actual FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(expected.identity);
  IF NOT FOUND OR pg_catalog.md5(actual.prosrc) NOT IN (expected.old_body,expected.own_body)
   OR actual.proowner IS DISTINCT FROM original_owner OR NOT actual.prosecdef
   OR actual.pronargdefaults<>0 OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR actual.proargnames IS DISTINCT FROM expected.argument_names OR actual.prorettype<>'jsonb'::regtype
   OR actual.proleakproof OR actual.proisstrict
   OR pg_catalog.has_function_privilege('anon',actual.oid,'EXECUTE')
   OR pg_catalog.has_function_privilege('authenticated',actual.oid,'EXECUTE')
   OR pg_catalog.has_function_privilege('service_role',actual.oid,'EXECUTE') IS DISTINCT FROM expected.service
   OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(actual.proacl,pg_catalog.acldefault('f',actual.proowner))) acl
    WHERE acl.privilege_type='EXECUTE' AND acl.grantee NOT IN (original_owner,CASE WHEN expected.service THEN 'service_role'::regrole::oid ELSE original_owner END)) THEN
   RAISE EXCEPTION 'Original publication status source changed' USING ERRCODE='23514';
  END IF;
 END LOOP;
END $guard$;

CREATE OR REPLACE FUNCTION public._read_prepared_agreement_request_status(
 _actor uuid,_tenant uuid,_operation uuid,_request_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original jsonb; preparation jsonb; w public.paige_durable_work%ROWTYPE;
 a public.paige_agreements%ROWTYPE; state text:='outcome_unknown';
 publication jsonb; approval public.paige_pending_confirmations%ROWTYPE; total integer; accepted integer; receipt uuid;
BEGIN
 -- Current domain actor, actual user/business and consumed original approval
 -- are proved by the incumbent read before any historical source projection.
 original:=public._read_prepared_agreement_work(_actor,_tenant,_operation,_request_sha256);
 IF original IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public.paige_agreements
  WHERE id=(original->>'agreement_id')::uuid AND tenant_id=_tenant FOR SHARE;
 SELECT * INTO w FROM public.paige_durable_work
  WHERE id=(original->>'work_id')::uuid AND tenant_id=_tenant
   AND initiating_user_id=_actor AND intent_id=_operation FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Original agreement request could not be verified' USING ERRCODE='40001'; END IF;
 -- Revalidate the original immutable binding after waiting for its row.
 original:=public._read_prepared_agreement_work(_actor,_tenant,_operation,_request_sha256);
 -- The original private source proves exact message/provider/Rail/event
 -- references. An expired execution lease does not erase historical acceptance.
 IF a.id IS NOT NULL AND a.id::text=original->>'agreement_id' THEN
  publication:=private.e04_prepared_publication_record(_tenant,a.id,(original->>'preparation_id')::uuid);
  IF publication IS NOT NULL THEN
   SELECT * INTO approval FROM public.paige_pending_confirmations
    WHERE id=(w.authority_context->>'confirmation_id')::uuid AND user_id=_actor AND tenant_id=_tenant FOR SHARE;
   IF NOT FOUND OR pg_catalog.jsonb_typeof(approval.args#>'{request,recipients}') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Original publication receipt differs' USING ERRCODE='23514'; END IF;
   total:=pg_catalog.jsonb_array_length(approval.args#>'{request,recipients}');
   accepted:=(publication->>'accepted_count')::integer;
   IF total NOT BETWEEN 1 AND 100 OR accepted IS NULL OR accepted<1 OR accepted>total
    OR publication->>'work_id' IS DISTINCT FROM w.id::text
    OR publication->>'operation_id' IS DISTINCT FROM _operation::text
    OR publication->>'request_sha256' IS DISTINCT FROM _request_sha256 THEN
    RAISE EXCEPTION 'Original publication receipt differs' USING ERRCODE='23514'; END IF;
   receipt:=(publication->>'event_id')::uuid;
   IF receipt IS NULL THEN RAISE EXCEPTION 'Original publication receipt unavailable' USING ERRCODE='23514'; END IF;
   state:=CASE WHEN accepted=total THEN 'provider_accepted' ELSE 'provider_partial' END;
  END IF;
 END IF;
 IF publication IS NULL AND a.id IS NOT NULL AND a.id::text=original->>'agreement_id'
  AND w.status='claimed' AND w.lease_until>pg_catalog.clock_timestamp()
  AND a.status='draft' AND a.content_storage_key IS NULL AND a.content_sha256 IS NULL
  AND a.sealed_storage_key IS NULL AND a.sealed_sha256 IS NULL THEN
  preparation:=public._read_agreement_document_preparation(_actor,_tenant,a.id,(original->>'preparation_id')::uuid);
  IF preparation->>'id'=original->>'preparation_id'
   AND preparation->'source_matches'='true'::jsonb AND preparation->'is_selected'='true'::jsonb THEN
   state:='prepared';
  END IF;
 END IF;
 -- Work.succeeded/failed/expired and callbacks are NEVER provider, signature,
 -- payment, not-sent or delivery receipts. Unissued history may be prepared;
 -- everything else remains uncertain until original message readback exists.
 RETURN pg_catalog.jsonb_build_object('kind','prepared_signature_request_result','state',state,
  'tenant_id',_tenant,'actor_id',_actor,'operation_id',_operation,'request_sha256',_request_sha256,
  'agreement_id',original->'agreement_id','work_id',w.id,'receipt_id',receipt);
END $$;
REVOKE ALL ON FUNCTION public._read_prepared_agreement_request_status(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._read_prepared_agreement_request_status(uuid,uuid,uuid,text) TO service_role;
COMMIT;
