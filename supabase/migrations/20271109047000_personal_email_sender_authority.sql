-- Governed email retains the canonical mailbox owner boundary at prepare and
-- execution admission. Actor is the stored, server-authored original person,
-- not the service-role transport. Shared company senders remain unchanged.
-- No connector/credential/role/provider activation or historical record rewrite.
-- claim_comms_email_send already reuses read_comms_email_send_binding; the
-- connector share lock keeps this decision stable through that claim transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.prepare_comms_email_send(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_contact_id uuid,_recipient text,_connector_id uuid,_from_address text,_subject text,_body_text text,_body_html text,_content_digest text,_command jsonb,_governance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
 _uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 _approval text; ap public.paige_pending_approvals%ROWTYPE; _act public.paige_actions%ROWTYPE;
 _live text; _cited text; _constraint text;
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
  RETURN jsonb_build_object('ok',true,'replayed',true,'state',b->>'state','message_id',m.id);
 END IF;

 -- The command is the canonical approved shape; its fields must be the ones being prepared.
 IF _command IS NULL OR jsonb_typeof(_command)<>'object' OR _command->>'action' IS DISTINCT FROM 'comms.email_send'
  OR _command->>'contact_id' IS DISTINCT FROM _contact_id::text OR _command->>'subject' IS DISTINCT FROM _subject
  OR _command->>'body' IS DISTINCT FROM _body_text
  OR (_command->>'connector_id' IS NOT NULL AND _command->>'connector_id' IS DISTINCT FROM _connector_id::text) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023';
 END IF;

 PERFORM 1 FROM public.clients WHERE id=_contact_id AND tenant_id=_expected_tenant_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTACT_NOT_IN_WORKSPACE' USING ERRCODE='42501'; END IF;
 IF _recipient IS NULL OR _recipient IS DISTINCT FROM lower(btrim(_recipient)) OR length(_recipient)>320
  OR NOT EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.tenant_id=_expected_tenant_id AND cm.client_id=_contact_id
   AND cm.kind='email' AND lower(btrim(cm.value))=_recipient) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_RECIPIENT_CHANGED' USING ERRCODE='40001';
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

 -- (6) One live send per reply approval. The approval row is locked, so two confirms of different
 -- operations for the same reply serialize here; the second sees the first's send and is refused.
 IF _approval IS NOT NULL THEN
  SELECT * INTO ap FROM public.paige_pending_approvals WHERE id=_approval::uuid FOR UPDATE;
  IF ap.id IS NOT NULL AND btrim(ap.metadata->>'action_id') ~* _uuid THEN
   SELECT * INTO _act FROM public.paige_actions a
    WHERE a.id=lower(btrim(ap.metadata->>'action_id'))::uuid AND a.approval_id=ap.id AND a.tenant_id=ap.tenant_id;
  END IF;
  IF ap.id IS NULL OR ap.tenant_id IS DISTINCT FROM _expected_tenant_id
   OR _act.id IS NULL OR _act.action_kind IS DISTINCT FROM 'owner.lead_followup' OR _act.contact_id IS DISTINCT FROM _contact_id
   OR (ap.contact_id IS NOT NULL AND ap.contact_id IS DISTINCT FROM _contact_id) THEN
   RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_INVALID' USING ERRCODE='42501';
  END IF;
  IF ap.status IN ('approved','sent') THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_ALREADY_SENT' USING ERRCODE='55000'; END IF;
  IF ap.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'COMMS_EMAIL_APPROVAL_NOT_PENDING' USING ERRCODE='55000'; END IF;
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
  'finalized_at',NULL,'provider_message_id',NULL,'outcome_reason',NULL,'approval_id',_approval);
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
END $$;

CREATE OR REPLACE FUNCTION public.read_comms_email_send_binding(_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 b:=m.meta->'comms_email_binding'; IF b IS NULL THEN RETURN NULL; END IF;
 PERFORM public._comms_email_actor((b->>'actor_user_id')::uuid,m.tenant_id);
 SELECT * INTO c FROM public.channel_connectors WHERE id=m.connector_id AND tenant_id=m.tenant_id FOR SHARE;
 RETURN b||jsonb_build_object('message_id',m.id,'tenant_id',m.tenant_id,'channel_type',m.channel_type,'message_status',m.status,
  'eligible',m.channel_type='email' AND m.direction='outbound'
   AND m.tenant_id::text=b->>'tenant_id' AND m.contact_id::text=b->>'contact_id' AND m.connector_id::text=b->>'connector_id'
   AND m.subject IS NOT DISTINCT FROM b->>'subject' AND m.body_html IS NOT DISTINCT FROM b->>'body_html'
   AND m.recipients->0->>'address' IS NOT DISTINCT FROM b->>'recipient'
   AND coalesce(c.active=true AND c.status='active' AND c.channel_type='email' AND c.provider=b->>'provider'
    AND lower(btrim(c.from_address))=b->>'from_address',false)
   AND coalesce(c.mailbox_class='shared_support'
     OR (c.mailbox_class='personal' AND c.mailbox_owner_user_id=(b->>'actor_user_id')::uuid),false)
   AND (b->>'provider' IS DISTINCT FROM 'sendgrid' OR public._comms_email_sendgrid_sender_verified(m.tenant_id,b->>'from_address'))
   AND EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.tenant_id=m.tenant_id AND cm.client_id=m.contact_id
    AND cm.kind='email' AND lower(btrim(cm.value))=b->>'recipient'));
END $$;

REVOKE ALL ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.read_comms_email_send_binding(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_comms_email_send_binding(uuid) TO service_role;

COMMIT;
