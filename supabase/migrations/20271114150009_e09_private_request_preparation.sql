-- Owner-private preparation on the ORIGINAL Action Bus. This never publishes a
-- customer action, creates an approval, drafts with a model or invokes a provider.
-- The original writers/roles/Work/RLS/approval systems remain authoritative.
BEGIN;

DO $e09_private_request_sources$
DECLARE item record; actual text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.file_action(text,text,text,uuid,jsonb,text,text,text,timestamptz,uuid,uuid,text,uuid,text)',
   ARRAY['40349ee33cf5f77ef6fc228087fdc67f','8389ea7b5589ad7ce939d9f8b01b6188']),
  ('public.advance_action(uuid,text,jsonb,text,uuid,uuid,jsonb,text,text,uuid)',
   ARRAY['66dcedb5e40dd43a54373c0e0ded1884']),
  ('public._client_portal_access_authorize(uuid,uuid,boolean)',
   ARRAY['7c3eb55c866321fed052ae742b75e42d'])
 ) original(signature,known_bodies) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc
   WHERE oid=pg_catalog.to_regprocedure(item.signature);
  IF actual IS NULL OR NOT actual=ANY(item.known_bodies) THEN
   RAISE EXCEPTION 'Original Portal private-request contract changed (%); reconcile before release',item.signature;
  END IF;
 END LOOP;
 -- file_action's two exact forms differ ONLY in recorded CRLF versus canonical
 -- LF transport, after the ORIGINAL retired-role migration. No role is restored.
END $e09_private_request_sources$;

-- Replaying this migration may regrant its own unchanged functions, but must
-- never replace a forward implementation or an unrelated pre-existing ABI.
DO $e09_private_request_replay$
DECLARE item record; actual text;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.read_client_portal_request_draft(uuid,uuid,uuid,uuid)','1701abdd098639638fa0495f43827e81'),
  ('public.prepare_client_portal_request(uuid,uuid,uuid,uuid,text,text)','bbbf43de04954522d61941a3f25026d1'),
  ('public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid)','ad2d2f83823b7939a0272a4ccbca4b40')
 ) own(signature,known_body) LOOP
  IF pg_catalog.to_regprocedure(item.signature) IS NOT NULL THEN
   SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc
    WHERE oid=pg_catalog.to_regprocedure(item.signature);
   IF actual IS DISTINCT FROM item.known_body THEN
    RAISE EXCEPTION 'Portal private-request source changed (%); preserve and reconcile before replay',item.signature;
   END IF;
  END IF;
 END LOOP;
END $e09_private_request_replay$;

CREATE OR REPLACE FUNCTION public.read_client_portal_request_draft(
 _expected_actor_id uuid, _expected_tenant_id uuid, _contact_id uuid, _intent_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $e09_request_read$
DECLARE
 kind text;
 customer public.clients%ROWTYPE;
 draft public.paige_actions%ROWTYPE;
 candidate public.paige_actions%ROWTYPE;
 prepared boolean;
 request_value jsonb := NULL;
BEGIN
 IF _expected_actor_id IS NULL OR _expected_tenant_id IS NULL OR _contact_id IS NULL OR _intent_id IS NULL THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_SCOPE_CHANGED' USING ERRCODE='42501';
 END IF;
 -- Same profile lock as Portal access writes, including status recovery: serialize
 -- same-actor preparation and workspace switches. This read changes no data.
 kind:=public._client_portal_access_authorize(_expected_actor_id,_expected_tenant_id,true);
 IF kind IS DISTINCT FROM 'standalone' THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 -- Keep the original Work writer's CURRENT staff standing as well as Portal
 -- ownership. A definer projection must not widen the original Work authority.
 IF NOT public.is_tenant_member(_expected_tenant_id)
  OR NOT public.has_any_role(auth.uid(),ARRAY['admin','super_admin']) THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.tenants t WHERE t.id=_expected_tenant_id AND t.status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
 SELECT c.* INTO customer FROM public.clients c
  WHERE c.id=_contact_id AND c.tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;

 -- Existing contact index; intent key is actor + business + CRM contact + nonce.
 -- Caller-provided metadata alone never grants access to an original Work row.
 FOR candidate IN SELECT a.* FROM public.paige_actions a
  WHERE a.contact_id=_contact_id AND a.tenant_id=_expected_tenant_id AND a.created_by=_expected_actor_id
   AND a.action_kind='client.portal_recommendation'
   AND a.payload#>'{client_portal_private_request,schema_version}'='1'::jsonb
   AND a.payload#>>'{client_portal_private_request,intent_id}'=_intent_id::text
  ORDER BY a.id LIMIT 2 FOR SHARE
 LOOP
  IF draft.id IS NOT NULL THEN RAISE EXCEPTION 'PORTAL_REQUEST_AMBIGUOUS' USING ERRCODE='55000'; END IF;
  draft:=candidate;
 END LOOP;
 -- Locks may have waited. Recheck the ORIGINAL authority before returning words.
 PERFORM public._client_portal_access_authorize(_expected_actor_id,_expected_tenant_id,true);
 IF NOT public.is_tenant_member(_expected_tenant_id)
  OR NOT public.has_any_role(auth.uid(),ARRAY['admin','super_admin']) THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 IF draft.id IS NOT NULL THEN
  IF draft.customer_action_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.paige_customer_actions a WHERE a.id=draft.customer_action_id
    AND a.tenant_id=_expected_tenant_id AND a.contact_id=_contact_id
  ) THEN RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000'; END IF;
  prepared:=draft.status='assigned' AND draft.draft_content IS NULL AND draft.customer_action_id IS NULL;
  IF draft.created_at IS NULL OR draft.updated_at IS NULL OR draft.title IS NULL OR draft.summary IS NULL
   OR pg_catalog.char_length(draft.title)>160 OR pg_catalog.char_length(draft.summary)>4000 THEN
   RAISE EXCEPTION 'PORTAL_REQUEST_SOURCE_CHANGED' USING ERRCODE='55000';
  END IF;
  request_value:=pg_catalog.jsonb_build_object(
   'work_id',draft.id,'status',draft.status,'created_at',draft.created_at,'version',draft.updated_at,
   'content_state',CASE WHEN draft.customer_action_id IS NOT NULL THEN 'shared' WHEN prepared THEN 'prepared' ELSE 'changed' END,
   'title',CASE WHEN prepared THEN draft.title ELSE NULL END,
   'body',CASE WHEN prepared THEN draft.summary ELSE NULL END,
   'customer_action_id',draft.customer_action_id
  );
 END IF;
 RETURN pg_catalog.jsonb_build_object(
  'schema_version',1,'actor_id',auth.uid(),'tenant_id',_expected_tenant_id,'contact_id',_contact_id,
  'intent_id',_intent_id,'found',draft.id IS NOT NULL,'request',request_value,
  'recipient_available',customer.status='active' AND customer.merged_into_contact_id IS NULL,
  'missing_is_rejection',false,'read_at',pg_catalog.clock_timestamp()
 );
END $e09_request_read$;

CREATE OR REPLACE FUNCTION public.prepare_client_portal_request(
 _expected_actor_id uuid, _expected_tenant_id uuid, _contact_id uuid, _intent_id uuid,
 _title text, _body text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $e09_request_prepare$
DECLARE
 title_value text:=pg_catalog.btrim(_title,E' \t\r\n');
 body_value text:=pg_catalog.btrim(_body,E' \t\r\n');
 current_request jsonb;
 original public.paige_actions%ROWTYPE;
 filed jsonb;
 assigned jsonb;
 work_id uuid;
BEGIN
 -- This read acquires the shared ORIGINAL profile/business/contact locks and
 -- requires actual owner authority. No route, nonce, role label or email grants it.
 current_request:=public.read_client_portal_request_draft(_expected_actor_id,_expected_tenant_id,_contact_id,_intent_id);
 IF title_value IS NULL OR title_value='' OR pg_catalog.char_length(title_value)>160
  OR body_value IS NULL OR body_value='' OR pg_catalog.char_length(body_value)>4000 THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_INVALID_CONTENT' USING ERRCODE='22023';
 END IF;
 IF (current_request->>'found')::boolean THEN
  SELECT a.* INTO original FROM public.paige_actions a
   WHERE a.id=(current_request#>>'{request,work_id}')::uuid FOR SHARE;
  IF original.title IS DISTINCT FROM title_value OR original.summary IS DISTINCT FROM body_value THEN
   RAISE EXCEPTION 'PORTAL_REQUEST_INTENT_CONFLICT' USING ERRCODE='55000';
  END IF;
  -- Known history wins over changed preparation eligibility. No new filing,
  -- audit, assignment, approval or customer action on an identical retry.
  RETURN current_request||pg_catalog.jsonb_build_object('replayed',true);
 END IF;
 IF NOT (current_request->>'recipient_available')::boolean THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.paige_action_kinds k
  WHERE k.slug='client.portal_recommendation' AND k.enabled AND k.executor='surface_to_client'
   AND k.draft_subagent_slug IS NULL AND (k.tenant_id IS NULL OR k.tenant_id=_expected_tenant_id)
  FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_REQUEST_PREPARATION_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 PERFORM public._client_portal_access_authorize(_expected_actor_id,_expected_tenant_id,true);
 filed:=public.file_action(
  p_action_kind=>'client.portal_recommendation',p_title=>title_value,p_summary=>body_value,
  p_contact_id=>_contact_id,p_payload=>pg_catalog.jsonb_build_object('client_portal_private_request',
   pg_catalog.jsonb_build_object('schema_version',1,'intent_id',_intent_id)),
  p_created_by_agent=>'portal_request',p_tenant_id=>_expected_tenant_id,p_autonomy_lane=>'confirm'
 );
 IF NOT coalesce((filed->>'ok')::boolean,false) OR filed->>'action_id' IS NULL THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_PREPARATION_UNCONFIRMED' USING ERRCODE='55000';
 END IF;
 work_id:=(filed->>'action_id')::uuid;
 -- Assignment to the originating actor is a PRIVATE original Work transition.
 -- Never call drafted/executing: the former can legitimately route an approval
 -- or auto-run under existing policy. No second dispatcher or direct Work write.
 assigned:=public.advance_action(p_action_id=>work_id,p_to_status=>'assigned',
  p_assigned_to_user_id=>_expected_actor_id,p_tenant_id=>_expected_tenant_id);
 IF NOT coalesce((assigned->>'ok')::boolean,false) OR assigned->>'status' IS DISTINCT FROM 'assigned'
  OR NOT (assigned?'customer_action_id') OR assigned->>'customer_action_id' IS NOT NULL
  OR NOT (assigned?'approval_id') OR assigned->>'approval_id' IS NOT NULL THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_PREPARATION_UNCONFIRMED' USING ERRCODE='55000';
 END IF;
 current_request:=public.read_client_portal_request_draft(_expected_actor_id,_expected_tenant_id,_contact_id,_intent_id);
 IF current_request#>>'{request,work_id}' IS DISTINCT FROM work_id::text
  OR current_request#>>'{request,content_state}' IS DISTINCT FROM 'prepared' THEN
  RAISE EXCEPTION 'PORTAL_REQUEST_PREPARATION_UNCONFIRMED' USING ERRCODE='55000';
 END IF;
 RETURN current_request||pg_catalog.jsonb_build_object('replayed',false);
END $e09_request_prepare$;

-- Recover the owner's ORIGINAL private Work after reload, when no browser nonce
-- remains. Cursor values only filter the same authorized Work; they grant nothing.
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

REVOKE ALL ON FUNCTION public.read_client_portal_request_draft(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.prepare_client_portal_request(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_client_portal_request_draft(uuid,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_client_portal_request(uuid,uuid,uuid,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid) TO authenticated;
COMMENT ON FUNCTION public.prepare_client_portal_request(uuid,uuid,uuid,uuid,text,text) IS
 'Owner-private original Work preparation only. Actual current SOLO owner/CRM scope, same-intent recovery; no customer publication, approval, model or provider action. Not yet mounted in Portal/Chat/Live.';
COMMENT ON FUNCTION public.read_client_portal_request_draft(uuid,uuid,uuid,uuid) IS
 'Current owner reads one actor/business/contact/intent-bound original private Work record. Missing is not rejection; changed content is withheld. No payload or private customer chat projection.';
COMMENT ON FUNCTION public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid) IS
 'Current owner recovers only their original private Work at one CRM relationship, in bounded original-record keyset pages. No browser intent store, private chat or customer publication; empty is never rejection.';
NOTIFY pgrst,'reload schema';
COMMIT;
