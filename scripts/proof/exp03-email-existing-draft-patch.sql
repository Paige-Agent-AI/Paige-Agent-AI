-- INERT EXP03 original saved-draft binding candidate, NOT a published migration.
-- One atomic DO repairs ONLY original13's opt-in source branch and adds SAME writer overload16.
-- Original actor/governance/14/15 and agreement branch stay exact; no accounts/provider effect.
DO $exp03_saved_draft$
DECLARE item record; target regprocedure; original text; revised text; inverse text;
 target16 regprocedure:=to_regprocedure('public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz,jsonb,jsonb)');
BEGIN
 FOR item IN SELECT * FROM (VALUES
('_comms_email_actor(uuid,uuid)','ff1a928247c3d00c8641b639dacb7fb9','ff1a928247c3d00c8641b639dacb7fb9'),
('_comms_email_governance(uuid,uuid,jsonb)','eb2f2b6e3f58a4843bc330cfad17c25e','eb2f2b6e3f58a4843bc330cfad17c25e'),
('prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)','44040e47f20c4a285177b09ea9f5a717','38a3a04e79cc471f945057a2df9be30b'),
('prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamp with time zone)','3e228c9e0298724b6f3b6de2eca892ca','3e228c9e0298724b6f3b6de2eca892ca'),
('prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamp with time zone,jsonb)','9dd86fac153138c0639d969dbecd6bad','9dd86fac153138c0639d969dbecd6bad')
 ) AS expected(signature,before_md5,after_md5)
 LOOP
  target:=to_regprocedure('public.'||item.signature);
  IF target IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target
   AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
   AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
   AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  THEN RAISE EXCEPTION 'EXP03 saved draft original metadata drift: %',item.signature;END IF;
  IF md5(pg_get_functiondef(target)) NOT IN(item.before_md5,item.after_md5) THEN
   RAISE EXCEPTION 'EXP03 saved draft original source drift: %',item.signature;END IF;
 END LOOP;
 FOR item IN SELECT * FROM (VALUES
  ('public._comms_email_attachment_manifest_ok(uuid,uuid,jsonb)','9adb7d7f478a85537d0d51e5f75b7b1e',true),
  ('public._comms_email_sendgrid_sender_verified(uuid,text)','47ffa6378cf940b88275c93913e37d7c',false)
 ) AS expected(signature,source_md5,definer)
 LOOP
  target:=to_regprocedure(item.signature);
  IF target IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target
   AND md5(pg_get_functiondef(p.oid))=item.source_md5 AND p.prosecdef=item.definer
   AND pg_get_userbyid(p.proowner)='postgres' AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
   AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
  THEN RAISE EXCEPTION 'EXP03 saved draft original file helper drift: %',item.signature;END IF;
 END LOOP;
 IF target16 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target16
  AND md5(p.prosrc)='39203dcc092668e84a78c94ba869eadd' AND md5(pg_get_functiondef(p.oid))='348fe822a186b8b41c8fa0ae08ccbb69' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
  AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
  AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
 THEN RAISE EXCEPTION 'EXP03 saved draft overload drift';END IF;
 target:='public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)'::regprocedure;
 original:=pg_get_functiondef(target);
 IF md5(original)='44040e47f20c4a285177b09ea9f5a717' THEN
 revised:=original;
 revised:=replace(revised,$e03_old_0$ agreement_source jsonb;$e03_old_0$,$e03_new_0$ agreement_source jsonb;
 _draft_source jsonb; _source_message public.messages%ROWTYPE;
 _source_connector public.channel_connectors%ROWTYPE; _source_version timestamptz;$e03_new_0$);
 revised:=replace(revised,$e03_old_1$ IF _operation_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023'; END IF;$e03_old_1$,$e03_new_1$ IF _operation_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023'; END IF;
 _draft_source:=_governance->'draft_source';
 IF _draft_source IS NOT NULL THEN
  IF jsonb_typeof(_draft_source) IS DISTINCT FROM 'object'
   OR NOT (_draft_source ?& ARRAY['message_id','updated_at'])
   OR (SELECT count(*) FROM jsonb_object_keys(_draft_source))<>2
   OR jsonb_typeof(_draft_source->'message_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(_draft_source->'updated_at') IS DISTINCT FROM 'string'
   OR coalesce(_draft_source->>'message_id','') !~ _uuid
   OR coalesce(_draft_source->>'updated_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  THEN RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
  BEGIN _source_version:=(_draft_source->>'updated_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_INVALID' USING ERRCODE='22023';
  END;
 END IF;$e03_new_1$);
 revised:=replace(revised,$e03_old_2$   OR lower(b->>'approval_id') IS DISTINCT FROM _approval THEN$e03_old_2$,$e03_new_2$   OR lower(b->>'approval_id') IS DISTINCT FROM _approval
   OR b#>'{governance,draft_source}' IS DISTINCT FROM _draft_source THEN$e03_new_2$);
 revised:=replace(revised,$e03_old_3$ -- ORIGINAL agreement lock precedes its child message, including distinct$e03_old_3$,$e03_new_3$ -- Lock the original saved row, never INSERT a substitute or relabel a commercial binding.
 IF _draft_source IS NOT NULL THEN
  IF _governance->>'purpose'='agreement_signature_request' THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO _source_message FROM public.messages
   WHERE id=(_draft_source->>'message_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
  IF _source_message.id IS NULL OR _source_message.channel_type IS DISTINCT FROM 'email'
   OR _source_message.direction IS DISTINCT FROM 'outbound' OR _source_message.status IS DISTINCT FROM 'draft'
   OR _source_message.contact_id IS DISTINCT FROM _contact_id OR _source_message.provider_message_id IS NOT NULL
   OR _source_message.meta ?| ARRAY['comms_email_binding','sales_invoice_binding','growth_sequence_binding','email_campaign_binding']
  THEN RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF _source_message.updated_at IS DISTINCT FROM _source_version THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
  -- Changing From must not turn another person's personal source into a shared draft.
  SELECT * INTO _source_connector FROM public.channel_connectors
   WHERE id=_source_message.connector_id AND tenant_id=_expected_tenant_id FOR SHARE;
  IF _source_connector.id IS NULL OR NOT coalesce(_source_connector.mailbox_class='shared_support'
    OR (_source_connector.mailbox_class='personal' AND _source_connector.mailbox_owner_user_id=_actor_user_id),false)
  THEN RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF _source_connector.mailbox_class='personal'
   AND _connector_id IS DISTINCT FROM _source_message.connector_id THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501';
  END IF;
 END IF;

 -- ORIGINAL agreement lock precedes its child message, including distinct$e03_new_3$);
 revised:=replace(revised,$e03_old_4$ PERFORM 1 FROM public.clients WHERE id=_contact_id AND tenant_id=_expected_tenant_id FOR SHARE;$e03_old_4$,$e03_new_4$ -- A saved action-owned draft must use its ORIGINAL already-validated reply approval.
 IF _draft_source IS NOT NULL AND _source_message.action_id IS DISTINCT FROM _act.id THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.clients WHERE id=_contact_id AND tenant_id=_expected_tenant_id FOR SHARE;$e03_new_4$);
 revised:=replace(revised,$e03_old_5$  INSERT INTO public.messages(tenant_id,contact_id,connector_id,thread_key,channel_type,direction,status,recipients,sender,subject,body_text,body_html,meta)$e03_old_5$,$e03_new_5$  IF _draft_source IS NOT NULL THEN
   UPDATE public.messages SET connector_id=_connector_id,
    recipients=CASE WHEN _source_message.recipients->0->>'address'=_recipient AND jsonb_array_length(_source_message.recipients)=1
      THEN _source_message.recipients ELSE jsonb_build_array(jsonb_build_object('address',_recipient)) END,
    sender=CASE WHEN _source_message.sender->>'address'=lower(btrim(c.from_address))
      THEN _source_message.sender ELSE jsonb_build_object('address',lower(btrim(c.from_address))) END,
    subject=_subject,body_text=_body_text,body_html=_body_html,attachments='[]'::jsonb,
    meta=coalesce(_source_message.meta,'{}'::jsonb)||jsonb_build_object('comms_email_binding',b)
    WHERE id=_source_message.id AND tenant_id=_expected_tenant_id RETURNING * INTO m;
   IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
  ELSE
  INSERT INTO public.messages(tenant_id,contact_id,connector_id,thread_key,channel_type,direction,status,recipients,sender,subject,body_text,body_html,meta)$e03_new_5$);
 revised:=replace(revised,$e03_old_6$  RETURNING * INTO m;
 EXCEPTION WHEN unique_violation THEN$e03_old_6$,$e03_new_6$  RETURNING * INTO m;
  END IF;
 EXCEPTION WHEN unique_violation THEN$e03_new_6$);
 IF md5(revised)<>'38a3a04e79cc471f945057a2df9be30b' THEN RAISE EXCEPTION 'EXP03 saved draft replacement mismatch';END IF;
 inverse:=revised;
 inverse:=replace(inverse,$e03_rev_new_0$  RETURNING * INTO m;
  END IF;
 EXCEPTION WHEN unique_violation THEN$e03_rev_new_0$,$e03_rev_old_0$  RETURNING * INTO m;
 EXCEPTION WHEN unique_violation THEN$e03_rev_old_0$);
 inverse:=replace(inverse,$e03_rev_new_1$  IF _draft_source IS NOT NULL THEN
   UPDATE public.messages SET connector_id=_connector_id,
    recipients=CASE WHEN _source_message.recipients->0->>'address'=_recipient AND jsonb_array_length(_source_message.recipients)=1
      THEN _source_message.recipients ELSE jsonb_build_array(jsonb_build_object('address',_recipient)) END,
    sender=CASE WHEN _source_message.sender->>'address'=lower(btrim(c.from_address))
      THEN _source_message.sender ELSE jsonb_build_object('address',lower(btrim(c.from_address))) END,
    subject=_subject,body_text=_body_text,body_html=_body_html,attachments='[]'::jsonb,
    meta=coalesce(_source_message.meta,'{}'::jsonb)||jsonb_build_object('comms_email_binding',b)
    WHERE id=_source_message.id AND tenant_id=_expected_tenant_id RETURNING * INTO m;
   IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
  ELSE
  INSERT INTO public.messages(tenant_id,contact_id,connector_id,thread_key,channel_type,direction,status,recipients,sender,subject,body_text,body_html,meta)$e03_rev_new_1$,$e03_rev_old_1$  INSERT INTO public.messages(tenant_id,contact_id,connector_id,thread_key,channel_type,direction,status,recipients,sender,subject,body_text,body_html,meta)$e03_rev_old_1$);
 inverse:=replace(inverse,$e03_rev_new_2$ -- A saved action-owned draft must use its ORIGINAL already-validated reply approval.
 IF _draft_source IS NOT NULL AND _source_message.action_id IS DISTINCT FROM _act.id THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.clients WHERE id=_contact_id AND tenant_id=_expected_tenant_id FOR SHARE;$e03_rev_new_2$,$e03_rev_old_2$ PERFORM 1 FROM public.clients WHERE id=_contact_id AND tenant_id=_expected_tenant_id FOR SHARE;$e03_rev_old_2$);
 inverse:=replace(inverse,$e03_rev_new_3$ -- Lock the original saved row, never INSERT a substitute or relabel a commercial binding.
 IF _draft_source IS NOT NULL THEN
  IF _governance->>'purpose'='agreement_signature_request' THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO _source_message FROM public.messages
   WHERE id=(_draft_source->>'message_id')::uuid AND tenant_id=_expected_tenant_id FOR UPDATE;
  IF _source_message.id IS NULL OR _source_message.channel_type IS DISTINCT FROM 'email'
   OR _source_message.direction IS DISTINCT FROM 'outbound' OR _source_message.status IS DISTINCT FROM 'draft'
   OR _source_message.contact_id IS DISTINCT FROM _contact_id OR _source_message.provider_message_id IS NOT NULL
   OR _source_message.meta ?| ARRAY['comms_email_binding','sales_invoice_binding','growth_sequence_binding','email_campaign_binding']
  THEN RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF _source_message.updated_at IS DISTINCT FROM _source_version THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
  -- Changing From must not turn another person's personal source into a shared draft.
  SELECT * INTO _source_connector FROM public.channel_connectors
   WHERE id=_source_message.connector_id AND tenant_id=_expected_tenant_id FOR SHARE;
  IF _source_connector.id IS NULL OR NOT coalesce(_source_connector.mailbox_class='shared_support'
    OR (_source_connector.mailbox_class='personal' AND _source_connector.mailbox_owner_user_id=_actor_user_id),false)
  THEN RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  IF _source_connector.mailbox_class='personal'
   AND _connector_id IS DISTINCT FROM _source_message.connector_id THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501';
  END IF;
 END IF;

 -- ORIGINAL agreement lock precedes its child message, including distinct$e03_rev_new_3$,$e03_rev_old_3$ -- ORIGINAL agreement lock precedes its child message, including distinct$e03_rev_old_3$);
 inverse:=replace(inverse,$e03_rev_new_4$   OR lower(b->>'approval_id') IS DISTINCT FROM _approval
   OR b#>'{governance,draft_source}' IS DISTINCT FROM _draft_source THEN$e03_rev_new_4$,$e03_rev_old_4$   OR lower(b->>'approval_id') IS DISTINCT FROM _approval THEN$e03_rev_old_4$);
 inverse:=replace(inverse,$e03_rev_new_5$ IF _operation_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023'; END IF;
 _draft_source:=_governance->'draft_source';
 IF _draft_source IS NOT NULL THEN
  IF jsonb_typeof(_draft_source) IS DISTINCT FROM 'object'
   OR NOT (_draft_source ?& ARRAY['message_id','updated_at'])
   OR (SELECT count(*) FROM jsonb_object_keys(_draft_source))<>2
   OR jsonb_typeof(_draft_source->'message_id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(_draft_source->'updated_at') IS DISTINCT FROM 'string'
   OR coalesce(_draft_source->>'message_id','') !~ _uuid
   OR coalesce(_draft_source->>'updated_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
  THEN RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
  BEGIN _source_version:=(_draft_source->>'updated_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_INVALID' USING ERRCODE='22023';
  END;
 END IF;$e03_rev_new_5$,$e03_rev_old_5$ IF _operation_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023'; END IF;$e03_rev_old_5$);
 inverse:=replace(inverse,$e03_rev_new_6$ agreement_source jsonb;
 _draft_source jsonb; _source_message public.messages%ROWTYPE;
 _source_connector public.channel_connectors%ROWTYPE; _source_version timestamptz;$e03_rev_new_6$,$e03_rev_old_6$ agreement_source jsonb;$e03_rev_old_6$);
 IF inverse IS DISTINCT FROM original THEN RAISE EXCEPTION 'EXP03 saved draft inverse mismatch';END IF;
 EXECUTE revised;
 IF md5(pg_get_functiondef(target))<>'38a3a04e79cc471f945057a2df9be30b' THEN RAISE EXCEPTION 'EXP03 saved draft readback mismatch';END IF;
 END IF;
 EXECUTE $e03_create16$CREATE OR REPLACE FUNCTION public.prepare_comms_email_send(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_contact_id uuid,_recipient text,_connector_id uuid,_from_address text,_subject text,_body_text text,_body_html text,_content_digest text,_command jsonb,_governance jsonb,_send_at timestamptz,_attachments jsonb,_draft_source jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog','public' AS $function$
DECLARE governed jsonb;
BEGIN
 IF _draft_source IS NULL OR jsonb_typeof(_draft_source) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
 IF _governance ? 'draft_source' AND _governance->'draft_source' IS DISTINCT FROM _draft_source THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
 governed:=_governance||jsonb_build_object('draft_source',_draft_source);
 IF _attachments IS NOT NULL THEN
  RETURN public.prepare_comms_email_send(_actor_user_id,_expected_tenant_id,_operation_id,_contact_id,_recipient,_connector_id,_from_address,_subject,_body_text,_body_html,_content_digest,_command,governed,_send_at,_attachments);
 ELSIF _send_at IS NOT NULL THEN
  RETURN public.prepare_comms_email_send(_actor_user_id,_expected_tenant_id,_operation_id,_contact_id,_recipient,_connector_id,_from_address,_subject,_body_text,_body_html,_content_digest,_command,governed,_send_at);
 ELSE
  RETURN public.prepare_comms_email_send(_actor_user_id,_expected_tenant_id,_operation_id,_contact_id,_recipient,_connector_id,_from_address,_subject,_body_text,_body_html,_content_digest,_command,governed);
 END IF;
END
$function$;$e03_create16$;
 REVOKE ALL ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz,jsonb,jsonb) FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz,jsonb,jsonb) TO service_role;
 target16:=to_regprocedure('public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz,jsonb,jsonb)');
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target16
  AND md5(p.prosrc)='39203dcc092668e84a78c94ba869eadd' AND md5(pg_get_functiondef(p.oid))='348fe822a186b8b41c8fa0ae08ccbb69' AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
  AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
  AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}')
 THEN RAISE EXCEPTION 'EXP03 saved draft overload readback mismatch';END IF;
END;
$exp03_saved_draft$;
