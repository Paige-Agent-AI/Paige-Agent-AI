-- CLI scaffold 20261025160253; adjacent forward-only E09 slot after14210009.
-- A selected CRM focus is not a customer persona. Real owner authority, exact
-- original common approval and all native source/access checks stay mandatory.
BEGIN;
DO $e09_focused_publication$
DECLARE item record; actual text; definition text;
 anchor constant text:='OR proposal.thread_id IS DISTINCT FROM _thread_id OR proposal.scoped_client_id IS NOT NULL';
 replacement constant text:=E'OR proposal.thread_id IS DISTINCT FROM _thread_id\n  OR (proposal.scoped_client_id IS NOT NULL AND proposal.scoped_client_id IS DISTINCT FROM v_contact_id)';
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public._client_portal_access_authorize(uuid,uuid,boolean)','7c3eb55c866321fed052ae742b75e42d'),
  ('public.admin_propose_paige_actions(uuid,jsonb)','21bd99c7a036f28f82a677fa25c6db04'),
  ('public.read_client_portal_request_draft(uuid,uuid,uuid,uuid)','1701abdd098639638fa0495f43827e81'),
  ('public.advance_action(uuid,text,jsonb,text,uuid,uuid,jsonb,text,text,uuid)','0d412f9c0a734aeb2815dca39ab061a3')
 ) source(signature,body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(item.signature);
  IF actual IS DISTINCT FROM item.body THEN
   RAISE EXCEPTION 'Original focused-publication dependency changed (%); reconcile before release',item.signature;
  END IF;
 END LOOP;
 SELECT pg_catalog.md5(prosrc),pg_catalog.pg_get_functiondef(oid) INTO actual,definition FROM pg_catalog.pg_proc
  WHERE oid=pg_catalog.to_regprocedure('public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid)');
 IF actual='f011f8a047c8025508ea3ece73efbcee' THEN RETURN; END IF;
 IF actual IS DISTINCT FROM '81e21f92abe3d552f89d98c8d7b3b9d3'
  OR (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,anchor,'')))/pg_catalog.length(anchor)<>1 THEN
  RAISE EXCEPTION 'Original focused-publication source changed; preserve before release';
 END IF;
 -- Same function/OID/ABI/owner/ACL. Current actual owner + Work standing are
 -- checked independently; only NULL or the exact approved CRM focus is valid.
 -- Root must still claim its real thread/focus in the common gate; no clearing
 -- client context or caller/model approval field is introduced here.
 EXECUTE pg_catalog.replace(definition,anchor,replacement);
END $e09_focused_publication$;

DO $e09_share_source_replay$
DECLARE actual text;
BEGIN
 IF pg_catalog.to_regprocedure('public.read_client_portal_request_share_source(uuid,uuid,uuid,uuid)') IS NOT NULL THEN
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc
   WHERE oid='public.read_client_portal_request_share_source(uuid,uuid,uuid,uuid)'::regprocedure;
  IF actual IS DISTINCT FROM '4eb171a1dd0b2de6bab6355ddcf303e1' THEN
   RAISE EXCEPTION 'Portal sharing preview source changed; preserve before replay';
  END IF;
 END IF;
END $e09_share_source_replay$;

CREATE OR REPLACE FUNCTION public.read_client_portal_request_share_source(
 _expected_actor_id uuid,_expected_tenant_id uuid,_contact_id uuid,_work_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $e09_share_source$
DECLARE intent_id uuid; intent_text text; source jsonb; customer public.clients%ROWTYPE;
BEGIN
 IF _expected_actor_id IS NULL OR _expected_tenant_id IS NULL OR _contact_id IS NULL OR _work_id IS NULL THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 IF public._client_portal_access_authorize(_expected_actor_id,_expected_tenant_id,true) IS DISTINCT FROM 'standalone'
  OR NOT public.is_tenant_member(_expected_tenant_id)
  OR NOT public.has_any_role(auth.uid(),ARRAY['admin','super_admin']) THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 -- Resolve only the originating owner's original Work. This first MVCC lookup
 -- grants nothing; the existing reader below obtains its original ordered locks
 -- and proves the actual current source/owner again before any words return.
 SELECT a.payload#>>'{client_portal_private_request,intent_id}' INTO intent_text FROM public.paige_actions a
  WHERE a.id=_work_id AND a.tenant_id=_expected_tenant_id AND a.contact_id=_contact_id
   AND a.created_by=_expected_actor_id AND a.action_kind='client.portal_recommendation';
 IF intent_text IS NULL OR intent_text !~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
 END IF;
 intent_id:=intent_text::uuid;
 source:=public.read_client_portal_request_draft(_expected_actor_id,_expected_tenant_id,_contact_id,intent_id);
 IF source->'found' IS DISTINCT FROM 'true'::jsonb OR source#>>'{request,work_id}' IS DISTINCT FROM _work_id::text THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
 END IF;
 IF source#>>'{request,content_state}'='shared' THEN
  RETURN pg_catalog.jsonb_build_object('schema_version',1,'actor_id',auth.uid(),'tenant_id',_expected_tenant_id,
   'contact_id',_contact_id,'work_id',_work_id,'source_state','shared','args',NULL,
   'customer_action_id',source#>'{request,customer_action_id}','read_at',pg_catalog.clock_timestamp());
 END IF;
 IF source->'recipient_available' IS DISTINCT FROM 'true'::jsonb OR source#>>'{request,content_state}' IS DISTINCT FROM 'prepared' THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
 END IF;
 SELECT c.* INTO customer FROM public.clients c WHERE c.id=_contact_id AND c.tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND OR customer.status IS DISTINCT FROM 'active' OR customer.merged_into_contact_id IS NOT NULL
  OR customer.linked_user_id IS NULL OR customer.portal_access_state IS DISTINCT FROM 'open'
  OR customer.paige_shared_context_consent IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 -- This preview is source data, not an approval. Reuse the common HIGH gate for
 -- its exact frozen args; the existing executor revalidates them before effect.
 RETURN pg_catalog.jsonb_build_object('schema_version',1,'actor_id',auth.uid(),'tenant_id',_expected_tenant_id,
  'contact_id',_contact_id,'work_id',_work_id,'source_state','prepared','customer_action_id',NULL,'args',pg_catalog.jsonb_build_object(
   'expected_tenant_id',_expected_tenant_id,'contact_id',_contact_id,'work_id',_work_id,
   'version',source#>'{request,version}','title',source#>'{request,title}','body',source#>'{request,body}',
   'recipient_user_id',customer.linked_user_id,'access_version',customer.portal_access_changed_at),
  'read_at',pg_catalog.clock_timestamp());
END $e09_share_source$;
REVOKE ALL ON FUNCTION public.read_client_portal_request_share_source(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_client_portal_request_share_source(uuid,uuid,uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.read_client_portal_request_share_source(uuid,uuid,uuid,uuid) IS
 'Read-only exact originating-owner Work/customer source for the existing common HIGH gate. No approval/claim, model, provider or data write; original private reader and actual owner/current client access/consent remain authoritative. Not a customer or service-role reader.';
NOTIFY pgrst,'reload schema';
COMMIT;
