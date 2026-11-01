-- INERT original Comms draft-save extension. No migration number or production apply.
-- Existing messages remains the only durable draft; this does not prepare or send email.
DO $install_save$
DECLARE target regprocedure; definition text; body text:=$save_body$
DECLARE m public.messages%ROWTYPE; source_mailbox public.channel_connectors%ROWTYPE;
 chosen public.channel_connectors%ROWTYPE; ap public.paige_pending_approvals%ROWTYPE;
 act public.paige_actions%ROWTYPE; file jsonb; request_digest text; receipt_id uuid; prior_receipt public.paige_audit_log%ROWTYPE;
BEGIN
 PERFORM public._comms_email_actor(_actor,_tenant);
 IF _save_id IS NULL OR _message_id IS NULL OR _expected_updated_at IS NULL OR _contact IS NULL OR _connector IS NULL
  OR _subject IS NULL OR length(_subject) NOT BETWEEN 1 AND 200 OR length(btrim(_subject))=0
  OR position(chr(10) in _subject)>0 OR position(chr(13) in _subject)>0
  OR _text IS NULL OR length(_text) NOT BETWEEN 1 AND 10000 OR length(btrim(_text))=0
  OR _html IS NULL OR length(_html) NOT BETWEEN 1 AND 100000
  OR _attachments IS NULL OR jsonb_typeof(_attachments) IS DISTINCT FROM 'array'
  OR jsonb_array_length(_attachments)>10 THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SAVE_INVALID' USING ERRCODE='22023'; END IF;
 request_digest:=encode(sha256(convert_to(jsonb_build_object('source',_expected_updated_at,'contact',_contact,'connector',_connector,
  'subject',_subject,'text',_text,'html',_html,'files',_attachments,'time',_send_at,'approval',_approval)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(_save_id::text,32847));
 SELECT * INTO prior_receipt FROM public.paige_audit_log WHERE tenant_id=_tenant AND actor_user_id=_actor
  AND action='comms.email_draft_saved' AND payload->>'operation_id'=_save_id::text ORDER BY created_at,id LIMIT 1;
 IF prior_receipt.id IS NOT NULL AND (prior_receipt.target_id IS DISTINCT FROM _message_id
  OR prior_receipt.payload->>'request_digest' IS DISTINCT FROM request_digest) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SAVE_REPLAY_MISMATCH' USING ERRCODE='22023';END IF;
 SELECT * INTO m FROM public.messages WHERE id=_message_id AND tenant_id=_tenant FOR UPDATE;
 IF m.id IS NULL OR m.contact_id IS DISTINCT FROM _contact OR m.channel_type IS DISTINCT FROM 'email'
  OR m.direction IS DISTINCT FROM 'outbound' OR m.status IS DISTINCT FROM 'draft' OR m.provider_message_id IS NOT NULL
  OR m.meta ?| ARRAY['comms_email_binding','sales_invoice_binding','growth_sequence_binding','email_campaign_binding'] THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.clients WHERE id=_contact AND tenant_id=_tenant FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO source_mailbox FROM public.channel_connectors WHERE id=m.connector_id AND tenant_id=_tenant FOR SHARE;
 IF source_mailbox.id IS NULL OR source_mailbox.active IS DISTINCT FROM true OR source_mailbox.status IS DISTINCT FROM 'active'
  OR source_mailbox.channel_type IS DISTINCT FROM 'email' OR NOT coalesce(source_mailbox.mailbox_class='shared_support'
   OR (source_mailbox.mailbox_class='personal' AND source_mailbox.mailbox_owner_user_id=_actor),false) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF source_mailbox.mailbox_class='personal' AND _connector IS DISTINCT FROM m.connector_id THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO chosen FROM public.channel_connectors WHERE id=_connector AND tenant_id=_tenant FOR SHARE;
 IF chosen.id IS NULL OR chosen.active IS DISTINCT FROM true OR chosen.status IS DISTINCT FROM 'active'
  OR chosen.channel_type IS DISTINCT FROM 'email' OR NOT coalesce(chosen.mailbox_class='shared_support'
   OR (chosen.mailbox_class='personal' AND chosen.mailbox_owner_user_id=_actor),false) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 IF m.action_id IS NOT NULL OR _approval IS NOT NULL THEN
  SELECT * INTO ap FROM public.paige_pending_approvals WHERE id=_approval AND tenant_id=_tenant FOR UPDATE;
  SELECT * INTO act FROM public.paige_actions WHERE id=m.action_id AND tenant_id=_tenant FOR SHARE;
  IF ap.id IS NULL OR ap.status IS DISTINCT FROM 'pending' OR act.id IS NULL OR act.approval_id IS DISTINCT FROM ap.id
   OR ap.metadata->>'action_id' IS DISTINCT FROM act.id::text OR act.contact_id IS DISTINCT FROM _contact
   OR (ap.contact_id IS NOT NULL AND ap.contact_id IS DISTINCT FROM _contact)
   OR (act.action_kind NOT IN ('owner.lead_followup','client.followup','owner.followup_email')
    AND NOT coalesce(act.action_kind='comms-draft-reply' AND m.meta->>'source'='comms-draft-reply'
      AND coalesce(act.payload->>'channel_type','email')='email',false))
   OR act.action_kind IS NULL OR act.status IS NULL OR act.status NOT IN ('drafted','pending_approval') THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501'; END IF;
 END IF;
 FOR file IN SELECT value FROM jsonb_array_elements(_attachments) LOOP
  IF jsonb_typeof(file) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(file))<>4
   OR NOT (file ?& ARRAY['url','name','mime','size']) OR jsonb_typeof(file->'url') IS DISTINCT FROM 'string'
   OR file->>'url' !~ ('^'||_tenant::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[^/]+$')
   OR jsonb_typeof(file->'name') IS DISTINCT FROM 'string' OR length(file->>'name') NOT BETWEEN 1 AND 255
   OR jsonb_typeof(file->'mime') IS DISTINCT FROM 'string' OR length(file->>'mime') NOT BETWEEN 1 AND 255
   OR jsonb_typeof(file->'size') IS DISTINCT FROM 'number' OR file->>'size' !~ '^[0-9]+$'
   OR (file->>'size')::bigint NOT BETWEEN 1 AND 10485760
   OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='comms-attachments' AND o.name=file->>'url') THEN
   RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_INVALID' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF (SELECT coalesce(sum((value->>'size')::bigint),0) FROM jsonb_array_elements(_attachments))>10485760 THEN
  RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_INVALID' USING ERRCODE='22023'; END IF;
 IF m.updated_at IS DISTINCT FROM _expected_updated_at OR prior_receipt.id IS NOT NULL THEN
  IF prior_receipt.id IS NOT NULL AND m.meta#>>'{comms_draft_save,id}'=_save_id::text AND m.meta#>>'{comms_draft_save,actor}'=_actor::text
   AND m.meta#>>'{comms_draft_save,digest}'=request_digest AND m.connector_id=_connector
   AND m.subject=_subject AND m.body_text=_text AND m.body_html=_html AND m.attachments=_attachments
   AND m.scheduled_for IS NOT DISTINCT FROM _send_at THEN
   SELECT id INTO receipt_id FROM public.paige_audit_log WHERE id=(m.meta#>>'{comms_draft_save,receipt_id}')::uuid
    AND tenant_id=_tenant AND actor_user_id=_actor AND target_id=m.id AND action='comms.email_draft_saved'
    AND payload->>'operation_id'=_save_id::text;
   IF receipt_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SAVE_RECEIPT_UNAVAILABLE' USING ERRCODE='55000';END IF;
   RETURN jsonb_build_object('ok',true,'outcome','draft_saved','message_id',m.id,'updated_at',m.updated_at,'receipt_id',receipt_id,'replayed',true);
  END IF;
  RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_CHANGED' USING ERRCODE='40001';
 END IF;
 receipt_id:=gen_random_uuid();
 UPDATE public.messages SET connector_id=_connector,subject=_subject,body_text=_text,body_html=_html,
  attachments=_attachments,scheduled_for=_send_at,updated_at=clock_timestamp(),
  sender=CASE WHEN m.connector_id=_connector THEN m.sender ELSE jsonb_build_object('address',lower(btrim(chosen.from_address))) END,
  meta=coalesce(m.meta,'{}'::jsonb)||jsonb_build_object('comms_draft_save',jsonb_build_object('id',_save_id,'actor',_actor,'digest',request_digest,'receipt_id',receipt_id))
 WHERE id=m.id AND tenant_id=_tenant RETURNING * INTO m;
 INSERT INTO public.paige_audit_log(id,actor_user_id,actor_role,tenant_id,action,target_type,target_id,payload)
 VALUES(receipt_id,_actor,'comms:'||(SELECT role FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_actor AND status='active' AND role IN ('owner','admin') ORDER BY role LIMIT 1),
  _tenant,'comms.email_draft_saved','message',m.id,jsonb_build_object('operation_id',_save_id,'request_digest',request_digest,'source_version',_expected_updated_at,'saved_version',m.updated_at));
 RETURN jsonb_build_object('ok',true,'outcome','draft_saved','message_id',m.id,'updated_at',m.updated_at,'receipt_id',receipt_id,'replayed',false);
END
$save_body$;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public._comms_email_actor(uuid,uuid)'::regprocedure
  AND md5(pg_get_functiondef(oid))='ff1a928247c3d00c8641b639dacb7fb9') THEN
  RAISE EXCEPTION 'EXP03 original draft-save actor prerequisite drift';END IF;
 target:=to_regprocedure('public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid)');
 IF target IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND prosrc=body AND pg_get_userbyid(proowner)='postgres'
   AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[]
   AND proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN
   RAISE EXCEPTION 'EXP03 original draft-save source/metadata drift';END IF;
  RETURN;
 END IF;
 definition:='CREATE FUNCTION public.save_comms_email_draft(_actor uuid,_tenant uuid,_save_id uuid,_message_id uuid,_expected_updated_at timestamptz,_contact uuid,_connector uuid,_subject text,_text text,_html text,_attachments jsonb,_send_at timestamptz,_approval uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog,public AS '||quote_literal(body);
 EXECUTE definition;
 REVOKE ALL ON FUNCTION public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid) TO service_role;
 target:=to_regprocedure('public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid)');
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND prosrc=body AND pg_get_userbyid(proowner)='postgres'
  AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[]
  AND proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'EXP03 original draft-save readback mismatch';END IF;
END
$install_save$;
