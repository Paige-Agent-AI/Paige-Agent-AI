-- Read-only actual production source snapshot for isolated EXP03 native proof only.
-- No row data, provider credentials or applied history; default paths/ABIs remain original.

-- _comms_email_actor(uuid,uuid); body_md5=c9850c30ae7885c23eee1da268c8c0e0; full_md5=ff1a928247c3d00c8641b639dacb7fb9
CREATE OR REPLACE FUNCTION public._comms_email_actor(_actor uuid, _tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE active_tenant uuid;
BEGIN
 IF _actor IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM auth.users WHERE id=_actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_ACTOR_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=_tenant AND status IN ('trial','active','past_due') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_WORKSPACE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
 SELECT active_tenant_id INTO active_tenant FROM public.profiles WHERE user_id=_actor FOR SHARE;
 IF NOT FOUND OR active_tenant IS DISTINCT FROM _tenant THEN RAISE EXCEPTION 'COMMS_EMAIL_WORKSPACE_CHANGED' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenant_members WHERE user_id=_actor AND tenant_id=_tenant AND status='active' AND role IN ('owner','admin') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE' USING ERRCODE='42501'; END IF;
END $function$;
REVOKE ALL ON FUNCTION public._comms_email_actor(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._comms_email_actor(uuid,uuid) TO service_role;

-- _comms_email_governance(uuid,uuid,jsonb); body_md5=3476f7a0ab6d51aefe9f30cfba86982f; full_md5=eb2f2b6e3f58a4843bc330cfad17c25e
CREATE OR REPLACE FUNCTION public._comms_email_governance(_actor uuid, _tenant uuid, _governance jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 -- Agreement HIGH authority is proved by its ORIGINAL consumed approval/Work,
 -- never relabeled as an operator-card generic email decision.
 IF _governance->>'purpose'='agreement_signature_request' THEN
  PERFORM private.e04_agreement_email_origin(_actor,_tenant,_governance,false);
  RETURN;
 END IF;
 IF _governance IS NULL OR jsonb_typeof(_governance)<>'object'
  OR _governance->>'actor_user_id' IS DISTINCT FROM _actor::text OR _governance->>'tenant_id' IS DISTINCT FROM _tenant::text
  OR _governance->>'tool' IS DISTINCT FROM 'comms_send_email' OR _governance->>'action' IS DISTINCT FROM 'comms.email_send'
  OR _governance->>'approval_channel' IS DISTINCT FROM 'operator_card'
  OR _governance->'decision_receipt_recorded' IS DISTINCT FROM 'true'::jsonb
  OR coalesce(_governance->>'approved_fingerprint','') !~ '^[0-9a-f]{16}$' THEN
  RAISE EXCEPTION 'COMMS_EMAIL_GOVERNANCE_REQUIRED' USING ERRCODE='42501';
 END IF;
END $function$;
REVOKE ALL ON FUNCTION public._comms_email_governance(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._comms_email_governance(uuid,uuid,jsonb) TO service_role;

-- prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb); body_md5=8da3b64c24552123b973db96a74ab986; full_md5=44040e47f20c4a285177b09ea9f5a717
CREATE OR REPLACE FUNCTION public.prepare_comms_email_send(_actor_user_id uuid, _expected_tenant_id uuid, _operation_id uuid, _contact_id uuid, _recipient text, _connector_id uuid, _from_address text, _subject text, _body_text text, _body_html text, _content_digest text, _command jsonb, _governance jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
 _uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 _approval text; ap public.paige_pending_approvals%ROWTYPE; _act public.paige_actions%ROWTYPE;
 _live text; _cited text; _constraint text; _action_id uuid;
 agreement_source jsonb;
BEGIN
 PERFORM public._comms_email_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._comms_email_governance(_actor_user_id,_expected_tenant_id,_governance);
 IF _operation_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023'; END IF;
 -- (6) The drafted reply this send answers, from the door's server-built governance record. NULL = none.
 _approval:=nullif(lower(btrim(_governance->>'approval_id')),'');
 IF _approval IS NOT NULL AND _approval !~ _uuid THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,32847));

 SELECT * INTO m FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=_operation_id::text;
 IF FOUND THEN
  b:=m.meta->'comms_email_binding';
  IF m.tenant_id IS DISTINCT FROM _expected_tenant_id OR b->>'actor_user_id' IS DISTINCT FROM _actor_user_id::text
   OR b->'command' IS DISTINCT FROM _command OR b->>'content_digest' IS DISTINCT FROM _content_digest
   OR lower(b->>'approval_id') IS DISTINCT FROM _approval THEN
   RAISE EXCEPTION 'COMMS_EMAIL_REPLAY_MISMATCH' USING ERRCODE='22023';
  END IF;
  IF _governance->>'purpose'='agreement_signature_request'
   AND b->'governance' IS DISTINCT FROM _governance THEN
   RAISE EXCEPTION 'COMMS_EMAIL_REPLAY_MISMATCH' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'state',b->>'state','message_id',m.id);
 END IF;

 -- ORIGINAL agreement lock precedes its child message, including distinct
 -- transport intents. A lost acknowledgement is inspected, never a new send.
 IF _governance->>'purpose'='agreement_signature_request' THEN
  agreement_source:=private.e04_agreement_email_origin(_actor_user_id,_expected_tenant_id,_governance,true);
  IF _operation_id::text IS DISTINCT FROM agreement_source->>'operation_id'
   OR _contact_id::text IS DISTINCT FROM agreement_source->>'client_id'
   OR _recipient IS DISTINCT FROM agreement_source#>>'{message,to}'
   OR _subject IS DISTINCT FROM agreement_source#>>'{message,subject}'
   OR _body_text IS DISTINCT FROM agreement_source#>>'{message,body_text}'
   OR _body_html IS DISTINCT FROM agreement_source#>>'{message,body_html}'
   OR _connector_id::text IS DISTINCT FROM agreement_source#>>'{sender,connector_id}'
   OR _from_address IS DISTINCT FROM agreement_source#>>'{sender,from_address}'
   OR _command IS DISTINCT FROM agreement_source->'command' THEN
   RAISE EXCEPTION 'COMMS_EMAIL_AGREEMENT_SOURCE_CHANGED' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM public.messages previous
    WHERE previous.tenant_id=_expected_tenant_id
     AND previous.meta#>>'{comms_email_binding,governance,purpose}'='agreement_signature_request'
     AND previous.meta#>>'{comms_email_binding,governance,agreement_work_id}'=agreement_source->>'work_id'
     AND previous.meta#>>'{comms_email_binding,governance,signer_id}'=agreement_source#>>'{signer,id}') THEN
   RAISE EXCEPTION 'COMMS_EMAIL_AGREEMENT_INTENT_ALREADY_RECORDED' USING ERRCODE='55000'; END IF;
 ELSE
 -- The command is the canonical approved shape; its fields must be the ones being prepared.
 IF _command IS NULL OR jsonb_typeof(_command)<>'object' OR _command->>'action' IS DISTINCT FROM 'comms.email_send'
  OR _command->>'contact_id' IS DISTINCT FROM _contact_id::text OR _command->>'subject' IS DISTINCT FROM _subject
  OR _command->>'body' IS DISTINCT FROM _body_text
  OR (_command->>'connector_id' IS NOT NULL AND _command->>'connector_id' IS DISTINCT FROM _connector_id::text) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023';
 END IF;

 END IF;

 -- (6) One live send per reply approval. The approval row is locked, so two confirms of different
 -- operations for the same reply serialize here; the second sees the first's send and is refused.
 IF _approval IS NOT NULL THEN
  SELECT * INTO ap FROM public.paige_pending_approvals WHERE id=_approval::uuid FOR UPDATE;
  BEGIN _action_id:=nullif(btrim(ap.metadata->>'action_id'),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN _action_id:=NULL; END;
  -- PPA -> exact canonical action. Lock every backlink deterministically before proving uniqueness.
  PERFORM 1 FROM public.paige_actions a WHERE a.approval_id=ap.id ORDER BY a.id FOR UPDATE;
  IF ap.id IS NOT NULL AND _action_id IS NOT NULL THEN
   SELECT * INTO _act FROM public.paige_actions a
    WHERE a.id=_action_id AND a.approval_id=ap.id AND a.tenant_id=ap.tenant_id;
  END IF;
  IF ap.id IS NULL OR ap.tenant_id IS DISTINCT FROM _expected_tenant_id
   OR _act.id IS NULL OR _act.action_kind NOT IN ('owner.lead_followup','client.followup','owner.followup_email') OR _act.contact_id IS DISTINCT FROM _contact_id
   OR (ap.contact_id IS NOT NULL AND ap.contact_id IS DISTINCT FROM _contact_id)
   OR (SELECT count(*) FROM public.paige_actions a WHERE a.approval_id=ap.id)<>1
   OR NOT EXISTS (SELECT 1 FROM public.paige_action_kinds k WHERE k.slug=_act.action_kind AND k.executor='send_via_approval') THEN
   RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_INVALID' USING ERRCODE='42501';
  END IF;
  IF ap.status IN ('approved','sent') THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_ALREADY_SENT' USING ERRCODE='55000'; END IF;
  IF ap.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_NOT_PENDING' USING ERRCODE='55000'; END IF;
  IF _act.status IS NULL OR _act.status NOT IN ('drafted','pending_approval') THEN
   RAISE EXCEPTION 'COMMS_EMAIL_ORIGIN_NOT_SENDABLE' USING ERRCODE='55000';
  END IF;
  -- A send prepared for this approval that has not failed or been refused …
  SELECT o.meta#>>'{comms_email_binding,state}' INTO _live FROM public.messages o
   WHERE o.meta ? 'comms_email_binding' AND lower(o.meta#>>'{comms_email_binding,approval_id}')=_approval
     AND coalesce(o.meta#>>'{comms_email_binding,state}','') NOT IN ('failed','refused')
   ORDER BY (o.meta#>>'{comms_email_binding,state}'='provider_accepted') DESC LIMIT 1;
  -- … or the send the approval itself cites (metadata.governed_send), whatever it was prepared for.
  IF _live IS NULL THEN
   _cited:=lower(btrim(ap.metadata#>>'{governed_send,operation_id}'));
   IF _cited ~ _uuid THEN
    SELECT o.meta#>>'{comms_email_binding,state}' INTO _live FROM public.messages o
     WHERE o.meta ? 'comms_email_binding' AND o.meta#>>'{comms_email_binding,operation_id}'=_cited
       AND o.tenant_id=_expected_tenant_id AND coalesce(o.meta#>>'{comms_email_binding,state}','') NOT IN ('failed','refused');
   END IF;
  END IF;
  IF _live='provider_accepted' THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_ALREADY_SENT' USING ERRCODE='55000'; END IF;
  IF _live IS NOT NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_SEND_IN_PROGRESS' USING ERRCODE='55000'; END IF;
 END IF;


 PERFORM 1 FROM public.clients WHERE id=_contact_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTACT_NOT_IN_WORKSPACE' USING ERRCODE='42501'; END IF;
 -- An approved business/witness signer belongs to the original agreement;
 -- it is not manufactured as another client contact method.
 IF agreement_source IS NULL THEN
 IF _recipient IS NULL OR _recipient IS DISTINCT FROM lower(btrim(_recipient)) OR length(_recipient)>320
  OR NOT EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.tenant_id=_expected_tenant_id AND cm.client_id=_contact_id
   AND cm.kind='email' AND lower(btrim(cm.value))=_recipient) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_RECIPIENT_CHANGED' USING ERRCODE='40001';
 END IF;

 END IF;

 SELECT * INTO c FROM public.channel_connectors WHERE id=_connector_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF c.id IS NULL OR c.active IS DISTINCT FROM true OR c.status IS DISTINCT FROM 'active' OR c.channel_type IS DISTINCT FROM 'email'
  OR c.provider IS NULL OR c.provider NOT IN ('resend','gmail','smtp','sendgrid') OR coalesce(length(btrim(c.from_address)),0)=0
  OR _from_address IS NULL OR lower(btrim(c.from_address)) IS DISTINCT FROM lower(btrim(_from_address))
  OR NOT coalesce(c.mailbox_class='shared_support'
    OR (c.mailbox_class='personal' AND c.mailbox_owner_user_id=_actor_user_id),false) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_SENDER_CHANGED' USING ERRCODE='40001';
 END IF;
 -- PAIGE Email (SendGrid): a connector row alone is never proof of sender identity (a workspace
 -- admin can write one). The From's domain must carry SendGrid verification facts that only the
 -- verification service can write (guard_tenant_email_domain_sendgrid_facts, 20271031000100).
 IF c.provider='sendgrid' AND NOT public._comms_email_sendgrid_sender_verified(_expected_tenant_id,c.from_address) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_SENDER_UNVERIFIED' USING ERRCODE='42501';
 END IF;

 IF _subject IS NULL OR length(btrim(_subject))=0 OR length(_subject)>200 OR _subject ~ E'[\r\n]'
  OR _body_text IS NULL OR length(btrim(_body_text))=0 OR length(_body_text)>10000
  OR _body_html IS NULL OR length(_body_html)=0 OR length(_body_html)>100000 THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023';
 END IF;
 IF _content_digest IS DISTINCT FROM encode(extensions.digest(convert_to(_recipient||E'\n'||_connector_id::text||E'\n'||_subject||E'\n'||_body_text,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'COMMS_EMAIL_DIGEST_MISMATCH' USING ERRCODE='22023';
 END IF;


 -- An earlier identical send whose outcome is not known must be reconciled, never re-sent.
 IF EXISTS (SELECT 1 FROM public.messages o WHERE o.tenant_id=_expected_tenant_id AND o.meta ? 'comms_email_binding'
   AND o.meta#>>'{comms_email_binding,recipient}'=_recipient AND o.meta#>>'{comms_email_binding,content_digest}'=_content_digest
   AND o.meta#>>'{comms_email_binding,state}' IN ('dispatching','unknown')) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_RECONCILIATION_REQUIRED' USING ERRCODE='55000';
 END IF;

 b:=jsonb_build_object('operation_id',_operation_id::text,'tenant_id',_expected_tenant_id,'actor_user_id',_actor_user_id,
  'contact_id',_contact_id,'recipient',_recipient,'connector_id',_connector_id,'from_address',lower(btrim(c.from_address)),
  'provider',c.provider,'subject',_subject,'body_text',_body_text,'body_html',_body_html,'content_digest',_content_digest,
  'command',_command,'governance',_governance,'state','prepared','attempts',0,'prepared_at',now(),'claimed_at',NULL,
  'finalized_at',NULL,'provider_message_id',NULL,'outcome_reason',NULL,'approval_id',_approval,'origin_action_id',_act.id,'origin_action_kind',_act.action_kind);
 BEGIN
  INSERT INTO public.messages(tenant_id,contact_id,connector_id,thread_key,channel_type,direction,status,recipients,sender,subject,body_text,body_html,meta)
  VALUES(_expected_tenant_id,_contact_id,_connector_id,'contact:'||_expected_tenant_id::text||':'||_contact_id::text,'email','outbound','draft',
   jsonb_build_array(jsonb_build_object('address',_recipient)),jsonb_build_object('address',lower(btrim(c.from_address))),
   _subject,_body_text,_body_html,jsonb_build_object('source','comms-email-command','comms_email_binding',b))
  RETURNING * INTO m;
 EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS _constraint = CONSTRAINT_NAME;
  IF _constraint='messages_comms_email_approval_live' THEN
   RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_SEND_IN_PROGRESS' USING ERRCODE='55000';
  END IF;
  RAISE;
 END;
 RETURN jsonb_build_object('ok',true,'replayed',false,'state','prepared','message_id',m.id);
END $function$;
REVOKE ALL ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb) TO service_role;

-- prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamp with time zone); body_md5=432b0c8548b9e0c52a0b0a52acbee4c3; full_md5=3e228c9e0298724b6f3b6de2eca892ca
CREATE OR REPLACE FUNCTION public.prepare_comms_email_send(_actor_user_id uuid, _expected_tenant_id uuid, _operation_id uuid, _contact_id uuid, _recipient text, _connector_id uuid, _from_address text, _subject text, _body_text text, _body_html text, _content_digest text, _command jsonb, _governance jsonb, _send_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE m public.messages%ROWTYPE; r jsonb; send_at_text text;
BEGIN
 PERFORM public._comms_email_actor(_actor_user_id,_expected_tenant_id);
 -- A whole minute, at least 30 s ahead (the door asks for 2 min when the card is raised and refuses
 -- under 60 s at confirm), at most 30 days (+10 min: a card raised at the limit may be confirmed later).
 IF _send_at IS NULL OR _send_at IS DISTINCT FROM (date_trunc('minute',_send_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
  OR _send_at<now()+interval '30 seconds' OR _send_at>now()+interval '30 days 10 minutes' THEN
  RAISE EXCEPTION 'COMMS_EMAIL_SEND_AT_INVALID' USING ERRCODE='22023';
 END IF;
 -- A drafted lead reply (one send per approval, recorded when accepted) and an agreement's signing
 -- request are answered now; neither is scheduled.
 IF _governance->>'purpose' IS NOT DISTINCT FROM 'agreement_signature_request' OR coalesce(btrim(_governance->>'approval_id'),'')<>'' THEN
  RAISE EXCEPTION 'COMMS_EMAIL_SCHEDULE_NOT_SUPPORTED' USING ERRCODE='22023';
 END IF;
 IF _operation_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023'; END IF;
 send_at_text:=to_char(_send_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
 -- The 13-argument body's own lock (re-entrant here): the replay read below and its insert serialize.
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,32847));
 SELECT * INTO m FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=_operation_id::text;
 IF FOUND AND m.meta#>>'{comms_email_binding,send_at}' IS DISTINCT FROM send_at_text THEN
  RAISE EXCEPTION 'COMMS_EMAIL_REPLAY_MISMATCH' USING ERRCODE='22023';
 END IF;
 r:=public.prepare_comms_email_send(_actor_user_id,_expected_tenant_id,_operation_id,_contact_id,_recipient,_connector_id,
   _from_address,_subject,_body_text,_body_html,_content_digest,_command,_governance);
 IF r->'replayed' IS DISTINCT FROM 'true'::jsonb THEN
  UPDATE public.messages SET status='queued',scheduled_for=_send_at,
    meta=jsonb_set(meta,'{comms_email_binding,send_at}',to_jsonb(send_at_text))
   WHERE id=(r->>'message_id')::uuid AND status='draft'
    AND meta#>>'{comms_email_binding,operation_id}'=_operation_id::text AND meta#>>'{comms_email_binding,state}'='prepared';
  IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_SCHEDULE_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN r||jsonb_build_object('send_at',send_at_text);
END $function$;
REVOKE ALL ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamp with time zone) TO service_role;

-- prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamp with time zone,jsonb); body_md5=6f052c5cdc273e65b74ea522b06c1bd7; full_md5=9dd86fac153138c0639d969dbecd6bad
CREATE OR REPLACE FUNCTION public.prepare_comms_email_send(_actor_user_id uuid, _expected_tenant_id uuid, _operation_id uuid, _contact_id uuid, _recipient text, _connector_id uuid, _from_address text, _subject text, _body_text text, _body_html text, _content_digest text, _command jsonb, _governance jsonb, _send_at timestamp with time zone, _attachments jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE m public.messages%ROWTYPE; r jsonb; b jsonb; send_at_text text;
BEGIN
 PERFORM public._comms_email_actor(_actor_user_id,_expected_tenant_id);
 IF _attachments IS NULL OR jsonb_typeof(_attachments)<>'array' OR jsonb_array_length(_attachments)=0 THEN
  RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 -- A drafted lead reply is sent exactly as drafted and recorded against its approval; an agreement's
 -- signing request is its own message. Neither carries files through this door.
 IF _governance->>'purpose' IS NOT DISTINCT FROM 'agreement_signature_request' OR coalesce(btrim(_governance->>'approval_id'),'')<>'' THEN
  RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_NOT_SUPPORTED' USING ERRCODE='22023';
 END IF;
 IF _operation_id IS NULL OR NOT public._comms_email_attachment_manifest_ok(_expected_tenant_id,_operation_id,_attachments) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 IF _send_at IS NOT NULL THEN send_at_text:=to_char(_send_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); END IF;
 -- The 13-argument body's own lock (re-entrant): this replay read, its insert and the update below serialize.
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,32847));
 SELECT * INTO m FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=_operation_id::text;
 IF FOUND AND (m.meta#>'{comms_email_binding,attachments}' IS DISTINCT FROM _attachments
   OR m.meta#>>'{comms_email_binding,send_at}' IS DISTINCT FROM send_at_text) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_REPLAY_MISMATCH' USING ERRCODE='22023';
 END IF;
 IF _send_at IS NULL THEN
  r:=public.prepare_comms_email_send(_actor_user_id,_expected_tenant_id,_operation_id,_contact_id,_recipient,_connector_id,
    _from_address,_subject,_body_text,_body_html,_content_digest,_command,_governance);
 ELSE
  r:=public.prepare_comms_email_send(_actor_user_id,_expected_tenant_id,_operation_id,_contact_id,_recipient,_connector_id,
    _from_address,_subject,_body_text,_body_html,_content_digest,_command,_governance,_send_at);
 END IF;
 IF r->'replayed' IS DISTINCT FROM 'true'::jsonb THEN
  SELECT * INTO m FROM public.messages WHERE id=(r->>'message_id')::uuid FOR UPDATE;
  b:=m.meta->'comms_email_binding';
  -- Only the SendGrid arm sends governed files. Raising here rolls back the row just inserted.
  IF b->>'provider' IS NULL OR b->>'provider' NOT IN ('sendgrid','resend') THEN
   RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED' USING ERRCODE='22023';
  END IF;
  UPDATE public.messages SET
    meta=jsonb_set(meta,'{comms_email_binding,attachments}',_attachments),
    attachments=(SELECT jsonb_agg(jsonb_build_object('url',e->>'path','name',e->>'name','mime',e->>'mime','size',(e->>'size')::bigint) ORDER BY ordinality)
                 FROM jsonb_array_elements(_attachments) WITH ORDINALITY AS a(e,ordinality))
   WHERE id=m.id AND meta#>>'{comms_email_binding,operation_id}'=_operation_id::text AND meta#>>'{comms_email_binding,state}'='prepared';
  IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN r||jsonb_build_object('attachments',jsonb_array_length(_attachments));
END $function$;
REVOKE ALL ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamp with time zone,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamp with time zone,jsonb) TO service_role;

