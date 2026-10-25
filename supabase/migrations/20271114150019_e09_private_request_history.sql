-- Returning-owner history over ORIGINAL private Work. The previously applied
-- preparation migration stays byte-exact; this is an additive read-only API.
BEGIN;
DO $e09_history_source$
DECLARE item record; actual text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.read_client_portal_request_draft(uuid,uuid,uuid,uuid)','1701abdd098639638fa0495f43827e81'),
  ('public._client_portal_access_authorize(uuid,uuid,boolean)','7c3eb55c866321fed052ae742b75e42d')
 ) original(signature,known_body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc
   WHERE oid=pg_catalog.to_regprocedure(item.signature);
  IF actual IS DISTINCT FROM item.known_body THEN
   RAISE EXCEPTION 'Original private-history contract changed (%); preserve and reconcile before release',item.signature;
  END IF;
 END LOOP;
 IF pg_catalog.to_regprocedure('public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid)') IS NOT NULL THEN
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc
   WHERE oid=pg_catalog.to_regprocedure('public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid)');
  IF actual IS DISTINCT FROM 'ad2d2f83823b7939a0272a4ccbca4b40' THEN
   RAISE EXCEPTION 'Portal private-history source changed; preserve and reconcile before replay';
  END IF;
 END IF;
END $e09_history_source$;

CREATE OR REPLACE FUNCTION public.list_client_portal_request_drafts(
 _expected_actor_id uuid, _expected_tenant_id uuid, _contact_id uuid,
 _before_created_at timestamptz DEFAULT NULL, _before_work_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $e09_request_history$
DECLARE
 customer public.clients%ROWTYPE;
 original public.paige_actions%ROWTYPE;
 kind text;
 intent uuid;
 saved jsonb;
 items jsonb:='[]'::jsonb;
 cursor_value jsonb:=NULL;
 has_more boolean:=false;
 item_count integer:=0;
BEGIN
 IF _expected_actor_id IS NULL OR _expected_tenant_id IS NULL OR _contact_id IS NULL THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 kind:=public._client_portal_access_authorize(_expected_actor_id,_expected_tenant_id,true);
 IF kind IS DISTINCT FROM 'standalone' OR NOT public.is_tenant_member(_expected_tenant_id)
  OR NOT public.has_any_role(auth.uid(),ARRAY['admin','super_admin']) THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 IF (_before_created_at IS NULL) IS DISTINCT FROM (_before_work_id IS NULL)
  OR (_before_created_at IS NOT NULL AND NOT pg_catalog.isfinite(_before_created_at)) THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_INVALID_CURSOR' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM public.tenants t WHERE t.id=_expected_tenant_id AND t.status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 SELECT c.* INTO customer FROM public.clients c
  WHERE c.id=_contact_id AND c.tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;

 FOR original IN SELECT a.* FROM public.paige_actions a
  WHERE a.tenant_id=_expected_tenant_id AND a.contact_id=_contact_id AND a.created_by=_expected_actor_id
   AND a.action_kind='client.portal_recommendation'
   AND a.payload#>'{client_portal_private_request,schema_version}'='1'::jsonb
   AND (_before_created_at IS NULL OR (a.created_at,a.id)<(_before_created_at,_before_work_id))
  ORDER BY a.created_at DESC,a.id DESC LIMIT 21 FOR SHARE
 LOOP
  item_count:=item_count+1;
  IF item_count>20 THEN has_more:=true; EXIT; END IF;
  BEGIN
   intent:=(original.payload#>>'{client_portal_private_request,intent_id}')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
   RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
  END;
  IF intent IS NULL THEN RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000'; END IF;
  -- Reuse exactly the same per-intent source/ambiguity/closed-content checks.
  saved:=public.read_client_portal_request_draft(_expected_actor_id,_expected_tenant_id,_contact_id,intent);
  IF saved#>>'{request,work_id}' IS DISTINCT FROM original.id::text THEN
   RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
  END IF;
  items:=items||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('intent_id',intent,'request',saved->'request'));
  cursor_value:=pg_catalog.jsonb_build_object('created_at',original.created_at,'work_id',original.id);
 END LOOP;
 -- Also revalidate an empty page or a role change while original row locks waited.
 PERFORM public._client_portal_access_authorize(_expected_actor_id,_expected_tenant_id,true);
 IF NOT public.is_tenant_member(_expected_tenant_id)
  OR NOT public.has_any_role(auth.uid(),ARRAY['admin','super_admin']) THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 RETURN pg_catalog.jsonb_build_object('schema_version',1,'actor_id',auth.uid(),
  'tenant_id',_expected_tenant_id,'contact_id',_contact_id,'requests',items,'more',has_more,
  'next_cursor',CASE WHEN has_more THEN cursor_value ELSE NULL END,
  'recipient_available',customer.status='active' AND customer.merged_into_contact_id IS NULL,
  'missing_is_rejection',false,'read_at',pg_catalog.clock_timestamp());
END $e09_request_history$;

REVOKE ALL ON FUNCTION public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid) TO authenticated;
COMMENT ON FUNCTION public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid) IS
 'Current owner recovers only their original private Work at one CRM relationship, in bounded original-record keyset pages. No browser intent store, private chat or customer publication; empty is never rejection.';
NOTIFY pgrst,'reload schema';
COMMIT;
