-- Read ORIGINAL prepared-request history without inferring a provider outcome.
-- No token, approval/claim, message, Work mutation or consequential activation.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE OR REPLACE FUNCTION public._read_prepared_agreement_request_status(
 _actor uuid,_tenant uuid,_operation uuid,_request_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original jsonb; preparation jsonb; w public.paige_durable_work%ROWTYPE;
 a public.paige_agreements%ROWTYPE; state text:='outcome_unknown';
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
 IF a.id IS NOT NULL AND a.id::text=original->>'agreement_id'
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
  'agreement_id',original->'agreement_id','work_id',w.id,'receipt_id',NULL);
END $$;
REVOKE ALL ON FUNCTION public._read_prepared_agreement_request_status(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public._read_prepared_agreement_request_status(uuid,uuid,uuid,text) TO service_role;
COMMIT;
