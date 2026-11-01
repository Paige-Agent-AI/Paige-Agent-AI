-- INERT O12B(ii) candidate. No migration version, production apply or new RPC.
-- Extend the original unsent Messages writer for an original pending follow-up
-- that has no Messages draft yet. No approval decision or provider call occurs.
DO $action_entry$
DECLARE target regprocedure; original text; revised text; anchor text;
BEGIN
 target:='public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid)'::regprocedure;
 SELECT pg_get_functiondef(target) INTO original;
 IF md5(original)<>'cd746abf4bae4849a2a760716b690ded'
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND pg_get_userbyid(proowner)='postgres'
   AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[]
   AND proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'EXP03 action-save original source/metadata drift';END IF;
 revised:=replace(original,'_save_id IS NULL OR _message_id IS NULL OR _expected_updated_at IS NULL',
  '_save_id IS NULL OR (_message_id IS NULL AND _approval IS NULL) OR _expected_updated_at IS NULL');
 revised:=replace(revised,'prior_receipt.target_id IS DISTINCT FROM _message_id',
  '(_message_id IS NOT NULL AND prior_receipt.target_id IS DISTINCT FROM _message_id)');
 anchor:=' SELECT * INTO m FROM public.messages WHERE id=_message_id AND tenant_id=_tenant FOR UPDATE;';
 IF position(anchor in revised)=0 THEN RAISE EXCEPTION 'EXP03 action-save source anchor drift';END IF;
 revised:=replace(revised,anchor,$entry$
 IF _message_id IS NULL THEN
  -- Serialize the first materialization with the existing original approval.
  -- Never copy edited mailbox content into tenant-readable approval/action JSON.
  SELECT * INTO ap FROM public.paige_pending_approvals WHERE id=_approval AND tenant_id=_tenant FOR UPDATE;
  IF ap.id IS NULL OR ap.status IS DISTINCT FROM 'pending'
   OR (ap.contact_id IS NOT NULL AND ap.contact_id IS DISTINCT FROM _contact)
   OR ap.metadata->>'action_id' IS NULL
   OR NOT coalesce(ap.draft_content->>'channel'='email'
    OR (NOT (ap.draft_content ? 'channel') AND ap.draft_content->'ok'='true'::jsonb
     AND jsonb_typeof(ap.draft_content->'draft')='object'
     AND coalesce(ap.draft_content#>>'{draft,channel}','email')='email'),false) THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501';END IF;
  SELECT * INTO act FROM public.paige_actions WHERE id::text=ap.metadata->>'action_id'
   AND approval_id=ap.id AND tenant_id=_tenant FOR SHARE;
  IF act.id IS NULL OR act.contact_id IS DISTINCT FROM _contact OR act.action_kind IS NULL
   OR act.action_kind NOT IN ('owner.lead_followup','client.followup','owner.followup_email')
   OR act.status IS NULL OR act.status NOT IN ('drafted','pending_approval')
   OR (SELECT count(*) FROM public.paige_actions WHERE approval_id=ap.id)<>1
   OR NOT EXISTS(SELECT 1 FROM public.paige_action_kinds WHERE slug=act.action_kind AND executor='send_via_approval')
   OR ap.metadata ? 'governed_send' THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501';END IF;
  IF prior_receipt.id IS NOT NULL THEN
   _message_id:=prior_receipt.target_id;
   IF ap.metadata#>>'{comms_email_draft,message_id}' IS DISTINCT FROM _message_id::text THEN
    RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SAVE_REPLAY_MISMATCH' USING ERRCODE='22023';END IF;
  ELSE
   IF ap.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_SOURCE_CHANGED' USING ERRCODE='40001';END IF;
   IF ap.metadata ? 'comms_email_draft'
    OR EXISTS(SELECT 1 FROM public.messages WHERE tenant_id=_tenant AND (action_id=act.id
     OR meta#>>'{comms_email_binding,approval_id}'=ap.id::text)) THEN
    RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501';END IF;
   PERFORM public._comms_email_actor(_actor,_tenant);
   INSERT INTO public.messages(tenant_id,contact_id,connector_id,thread_key,channel_type,direction,status,
    recipients,sender,subject,body_text,body_html,attachments,action_id,updated_at,meta)
   VALUES(_tenant,_contact,_connector,'contact:'||_tenant::text||':'||_contact::text,'email','outbound','draft',
    '[]'::jsonb,'{}'::jsonb,_subject,_text,_html,'[]'::jsonb,act.id,_expected_updated_at,
    jsonb_build_object('source','original-action-email-draft')) RETURNING id INTO _message_id;
   UPDATE public.paige_pending_approvals SET metadata=coalesce(metadata,'{}'::jsonb)
    ||jsonb_build_object('comms_email_draft',jsonb_build_object('message_id',_message_id))
    WHERE id=ap.id AND tenant_id=_tenant;
  END IF;
 END IF;
 SELECT * INTO m FROM public.messages WHERE id=_message_id AND tenant_id=_tenant FOR UPDATE;$entry$);
 IF revised=original THEN RAISE EXCEPTION 'EXP03 action-save replacement missing';END IF;
 EXECUTE revised;
 -- Once an action has a durable Messages draft, its legacy review entry must
 -- not prepare old approval words or manufacture a second Messages record.
 target:='public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)'::regprocedure;
 SELECT pg_get_functiondef(target) INTO original;
 IF md5(original) NOT IN ('41cb53161afde5aa03d17013509f15f5','7e93cb7be01f5bbe37ae3e70d94aac5d')
  OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=target AND pg_get_userbyid(proowner)='postgres'
   AND prosecdef AND proconfig=ARRAY['search_path=pg_catalog, public']::text[]
   AND proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'EXP03 action-save original prepare source drift';END IF;
 anchor:='  IF _act.status IS NULL OR _act.status NOT IN (''drafted'',''pending_approval'') THEN';
 IF position(anchor in original)=0 THEN RAISE EXCEPTION 'EXP03 action-save prepare anchor drift';END IF;
 revised:=replace(original,anchor,$guard$
  IF ap.metadata ? 'comms_email_draft' AND (_draft_source IS NULL
   OR ap.metadata#>>'{comms_email_draft,message_id}' IS DISTINCT FROM _source_message.id::text) THEN
   RAISE EXCEPTION 'COMMS_EMAIL_DRAFT_OWNED_FLOW_REQUIRED' USING ERRCODE='42501';END IF;
$guard$||anchor);
 EXECUTE revised;
END
$action_entry$;
