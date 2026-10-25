-- CLI scaffold 20261025174444; forward-only repair of the new read projection.
-- Original14230109 and original publication/approval writers remain byte-exact.
BEGIN;
DO $e09_original_share_receipt$
DECLARE definition text; actual text; item record;
 decl_before constant text:=$decl_before$DECLARE intent_id uuid; intent_text text; source jsonb; customer public.clients%ROWTYPE;$decl_before$;
 decl_after constant text:=$decl_after$DECLARE intent_id uuid; intent_text text; source jsonb; customer public.clients%ROWTYPE;
 saved public.paige_actions%ROWTYPE; published public.paige_customer_actions%ROWTYPE; receipt jsonb; approved jsonb;$decl_after$;
 anchor constant text:=$share_anchor$ IF source#>>'{request,content_state}'='shared' THEN
$share_anchor$;
 replacement constant text:=$receipt_guard$ IF source#>>'{request,content_state}'='shared' THEN
  -- Same original record and publisher receipt, never a label inferred from a link.
  -- Work is already held by the original reader. PCA is read WITHOUT another lock:
  -- the customer response writer keeps its original PCA -> contact -> Work order.
  SELECT w.* INTO saved FROM public.paige_actions w WHERE w.id=_work_id
   AND w.tenant_id=_expected_tenant_id AND w.contact_id=_contact_id AND w.created_by=_expected_actor_id;
  receipt:=saved.payload->'client_portal_publication';approved:=receipt->'approved_args';
  SELECT p.* INTO published FROM public.paige_customer_actions p WHERE p.id=saved.customer_action_id
   AND p.tenant_id=_expected_tenant_id AND p.contact_id=_contact_id;
  IF NOT FOUND OR saved.status IS DISTINCT FROM 'done' OR saved.assigned_to_user_id IS DISTINCT FROM _expected_actor_id
   OR receipt->'schema_version' IS DISTINCT FROM '1'::jsonb
   OR pg_catalog.jsonb_typeof(approved) IS DISTINCT FROM 'object'
   OR coalesce(receipt->>'confirmation_id','')='' OR coalesce(receipt->>'claimed_in_request','')='' THEN
   RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
  END IF;
  -- This is readback of original persisted evidence, not an approval/claim or a
  -- new execution. Keep historical access after client pause/consent withdrawal.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(approved))<>8
   OR NOT (approved ?& ARRAY['expected_tenant_id','contact_id','work_id','version','title','body','recipient_user_id','access_version'])
   OR approved->>'expected_tenant_id' IS DISTINCT FROM _expected_tenant_id::text
   OR approved->>'contact_id' IS DISTINCT FROM _contact_id::text OR approved->>'work_id' IS DISTINCT FROM _work_id::text
   OR approved->>'title' IS DISTINCT FROM saved.title OR approved->>'body' IS DISTINCT FROM saved.summary
   OR saved.result->'ok' IS DISTINCT FROM 'true'::jsonb OR saved.result->'count' IS DISTINCT FROM '1'::jsonb
   OR saved.result->'ids' IS DISTINCT FROM pg_catalog.jsonb_build_array(saved.customer_action_id)
   OR published.action_type IS DISTINCT FROM 'recommendation' OR published.title IS DISTINCT FROM approved->>'title'
   OR published.body IS DISTINCT FROM approved->>'body' OR published.payload_json IS DISTINCT FROM '{}'::jsonb THEN
   RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
  END IF;
$receipt_guard$;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.read_client_portal_request_draft(uuid,uuid,uuid,uuid)','1701abdd098639638fa0495f43827e81'),
  ('public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid)','f011f8a047c8025508ea3ece73efbcee')
 ) source(signature,body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(item.signature);
  IF actual IS DISTINCT FROM item.body THEN RAISE EXCEPTION 'Original Portal receipt dependency changed (%); reconcile before release',item.signature; END IF;
 END LOOP;
 SELECT pg_catalog.md5(prosrc),pg_catalog.pg_get_functiondef(oid) INTO actual,definition FROM pg_catalog.pg_proc
  WHERE oid=pg_catalog.to_regprocedure('public.read_client_portal_request_share_source(uuid,uuid,uuid,uuid)');
 IF actual='ce47399b991cea106916d331a88657fe' THEN RETURN; END IF;
 IF actual IS DISTINCT FROM '4eb171a1dd0b2de6bab6355ddcf303e1'
  OR (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,decl_before,'')))/pg_catalog.length(decl_before)<>1
  OR (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,anchor,'')))/pg_catalog.length(anchor)<>1 THEN
  RAISE EXCEPTION 'Portal sharing preview source changed; preserve before receipt readback';
 END IF;
 EXECUTE pg_catalog.replace(pg_catalog.replace(definition,decl_before,decl_after),anchor,replacement);
 SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc
  WHERE oid='public.read_client_portal_request_share_source(uuid,uuid,uuid,uuid)'::regprocedure;
 IF actual IS DISTINCT FROM 'ce47399b991cea106916d331a88657fe' THEN RAISE EXCEPTION 'Portal receipt readback does not match reviewed source'; END IF;
END $e09_original_share_receipt$;
NOTIFY pgrst,'reload schema';
COMMIT;
