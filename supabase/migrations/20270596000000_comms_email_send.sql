-- INT-328 comms.email_send — one governed, one-recipient business email.
--
-- Mirrors the Sales invoice governed email send (20270543000002_sales_invoice_delivery.sql):
-- the approved send is a `messages` row carrying a service-only binding in
-- meta.comms_email_binding, prepared by the canonical command door, claimed by send-message at
-- the provider-admission point and finalized with the provider outcome. No queue, provider store,
-- inbox, sender-domain setting or approval authority is created here.
--
-- State machine (binding.state):
--   prepared -> dispatching -> provider_accepted | failed | refused | unknown
--   prepared -> failed | refused                      (send-message refused before any claim; only
--                                                      a caller that holds NO claim, _claimed_attempt NULL)
--   dispatching -> provider_accepted | failed | unknown   ONLY by the caller whose claim returned
--     that attempt number (_claimed_attempt = binding.attempts). 'refused' is never recorded once a
--     claim exists: a losing / unclaimed / superseded request never finalizes a dispatching operation,
--     so an email that went out can never be recorded as "Not sent".
--   unknown | dispatching older than 120 s -> dispatching   ONLY via claim(..., _reconcile => true),
--     ONLY for provider 'resend' (whose Idempotency-Key replays the original send) and ONLY within
--     23 h of preparation. A reconcile never mints a new operation.
--
-- The recipient address is read from public.client_contact_methods (kind 'email'), the SAME
-- source send-message's `recipient_contact_mismatch` check reads through
-- CLIENT_CONTACT_METHODS_EMBED / clientAddresses(), compared trimmed + lowercased exactly as its
-- normalizeRecipient('email', …) does.
--
-- §59: every function is SECURITY DEFINER and service_role-only. prepare, read_result and (through
-- read_comms_email_send_binding) claim re-prove the actor's live owner/admin membership and active
-- workspace in their bodies. The EXECUTE grant is not the guard for those.
-- §59 SERVICE-ONLY, DOOR-SCOPED EXEMPTIONS (deliberate, not a gap): finalize_comms_email_send and
-- find_comms_email_pending_reconciliation take no actor. They are reachable only by service_role
-- (comms-email-command and send-message), are keyed by a message id + operation UUID (finalize) or by
-- the door's own server-resolved tenant (finder), and return no tenant data beyond an operation id.
-- finalize must still record an honest outcome after the actor's seat lapses mid-send, so it does not
-- re-prove the actor; it instead requires the claim's attempt number for any dispatching outcome.
--
-- HONEST RESIDUALS (§13), recorded here because they are properties of this contract, not bugs it hides:
--  * Only Resend operations are reconcilable (its Idempotency-Key replays the original send for ~24 h).
--    An 'unknown' Gmail or SMTP operation, or a Resend one older than 23 h, can never be reconciled, and
--    the identical-content guard below then refuses the same recipient + content (55000) with no
--    person-facing resolve path yet. Changing a word of the subject or body is a new digest and sends.
--  * SMTP returns no provider receipt id, so an SMTP send that the server accepted is still recorded
--    'unknown' (never 'provider_accepted'): SMTP senders can never be told "sent" by this capability.
--  * The 20 s deadline aborts the Resend request; Gmail and SMTP seams take no abort signal, so their
--    send keeps running after the deadline and MAY still go out while the operation is 'unknown'.
--  * The approved sender is bound by connector id, provider and from_address only. from_name and
--    reply_to are read from the connector at send time and can change after approval without refusal.

CREATE UNIQUE INDEX IF NOT EXISTS messages_comms_email_operation
 ON public.messages ((meta#>>'{comms_email_binding,operation_id}'))
 WHERE meta ? 'comms_email_binding';

-- The reconciliation guard and finder look up pending bindings by tenant + recipient + digest.
CREATE INDEX IF NOT EXISTS messages_comms_email_content
 ON public.messages (tenant_id, (meta#>>'{comms_email_binding,recipient}'), (meta#>>'{comms_email_binding,content_digest}'))
 WHERE meta ? 'comms_email_binding';

CREATE OR REPLACE FUNCTION public._comms_email_message_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NOT NULL AND (NEW.meta ? 'comms_email_binding' OR (TG_OP='UPDATE' AND OLD.meta ? 'comms_email_binding')) THEN
  RAISE EXCEPTION 'Governed business email uses the governed sender' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._comms_email_message_guard() FROM PUBLIC,anon,authenticated;
-- PG14+: replace in place (idempotent re-apply) instead of DROP + CREATE.
CREATE OR REPLACE TRIGGER comms_email_message_guard BEFORE INSERT OR UPDATE ON public.messages
 FOR EACH ROW EXECUTE FUNCTION public._comms_email_message_guard();

-- Same semantics as public._sales_invoice_actor, with comms wording. FOR SHARE holds the facts
-- (live user, live workspace, active workspace, owner/admin membership) until commit.
CREATE OR REPLACE FUNCTION public._comms_email_actor(_actor uuid,_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
END $$;

-- Mirrors public._sales_invoice_governance: the door stamps the canonical decision; a high-risk
-- send is only ever approved on the operator card, never by standing autonomy.
CREATE OR REPLACE FUNCTION public._comms_email_governance(_actor uuid,_tenant uuid,_governance jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF _governance IS NULL OR jsonb_typeof(_governance)<>'object'
  OR _governance->>'actor_user_id' IS DISTINCT FROM _actor::text OR _governance->>'tenant_id' IS DISTINCT FROM _tenant::text
  OR _governance->>'tool' IS DISTINCT FROM 'comms_send_email' OR _governance->>'action' IS DISTINCT FROM 'comms.email_send'
  OR _governance->>'approval_channel' IS DISTINCT FROM 'operator_card'
  OR _governance->'decision_receipt_recorded' IS DISTINCT FROM 'true'::jsonb
  OR coalesce(_governance->>'approved_fingerprint','') !~ '^[0-9a-f]{16}$' THEN
  RAISE EXCEPTION 'COMMS_EMAIL_GOVERNANCE_REQUIRED' USING ERRCODE='42501';
 END IF;
END $$;

-- One home for the reconcile rule, used by claim and the result read.
CREATE OR REPLACE FUNCTION public._comms_email_reconcilable(_binding jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT coalesce(_binding->>'provider'='resend'
  AND (_binding->>'prepared_at')::timestamptz > now()-interval '23 hours'
  AND (_binding->>'state'='unknown'
   OR (_binding->>'state'='dispatching' AND (_binding->>'claimed_at')::timestamptz < now()-interval '120 seconds')),false)
$$;

CREATE OR REPLACE FUNCTION public.prepare_comms_email_send(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_contact_id uuid,_recipient text,_connector_id uuid,_from_address text,_subject text,_body_text text,_body_html text,_content_digest text,_command jsonb,_governance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
BEGIN
 PERFORM public._comms_email_actor(_actor_user_id,_expected_tenant_id);
 PERFORM public._comms_email_governance(_actor_user_id,_expected_tenant_id,_governance);
 IF _operation_id IS NULL THEN RAISE EXCEPTION 'COMMS_EMAIL_CONTENT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,32847));

 SELECT * INTO m FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=_operation_id::text;
 IF FOUND THEN
  b:=m.meta->'comms_email_binding';
  IF m.tenant_id IS DISTINCT FROM _expected_tenant_id OR b->>'actor_user_id' IS DISTINCT FROM _actor_user_id::text
   OR b->'command' IS DISTINCT FROM _command OR b->>'content_digest' IS DISTINCT FROM _content_digest THEN
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
  OR c.provider IS NULL OR c.provider NOT IN ('resend','gmail','smtp') OR coalesce(length(btrim(c.from_address)),0)=0
  OR _from_address IS NULL OR lower(btrim(c.from_address)) IS DISTINCT FROM lower(btrim(_from_address)) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_SENDER_CHANGED' USING ERRCODE='40001';
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
  'finalized_at',NULL,'provider_message_id',NULL,'outcome_reason',NULL);
 INSERT INTO public.messages(tenant_id,contact_id,connector_id,thread_key,channel_type,direction,status,recipients,sender,subject,body_text,body_html,meta)
 VALUES(_expected_tenant_id,_contact_id,_connector_id,'contact:'||_expected_tenant_id::text||':'||_contact_id::text,'email','outbound','draft',
  jsonb_build_array(jsonb_build_object('address',_recipient)),jsonb_build_object('address',lower(btrim(c.from_address))),
  _subject,_body_text,_body_html,jsonb_build_object('source','comms-email-command','comms_email_binding',b))
 RETURNING * INTO m;
 RETURN jsonb_build_object('ok',true,'replayed',false,'state','prepared','message_id',m.id);
END $$;

-- send-message's read: the binding plus the row facts it must match exactly.
CREATE OR REPLACE FUNCTION public.read_comms_email_send_binding(_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 b:=m.meta->'comms_email_binding'; IF b IS NULL THEN RETURN NULL; END IF;
 PERFORM public._comms_email_actor((b->>'actor_user_id')::uuid,m.tenant_id);
 SELECT * INTO c FROM public.channel_connectors WHERE id=m.connector_id AND tenant_id=m.tenant_id;
 RETURN b||jsonb_build_object('message_id',m.id,'tenant_id',m.tenant_id,'channel_type',m.channel_type,'message_status',m.status,
  'eligible',m.channel_type='email' AND m.direction='outbound'
   AND m.tenant_id::text=b->>'tenant_id' AND m.contact_id::text=b->>'contact_id' AND m.connector_id::text=b->>'connector_id'
   AND m.subject IS NOT DISTINCT FROM b->>'subject' AND m.body_html IS NOT DISTINCT FROM b->>'body_html'
   AND m.recipients->0->>'address' IS NOT DISTINCT FROM b->>'recipient'
   AND coalesce(c.active=true AND c.status='active' AND c.channel_type='email' AND c.provider=b->>'provider'
    AND lower(btrim(c.from_address))=b->>'from_address',false)
   AND EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.tenant_id=m.tenant_id AND cm.client_id=m.contact_id
    AND cm.kind='email' AND lower(btrim(cm.value))=b->>'recipient'));
END $$;

-- §59: no actor parameter; the actor is re-proved through read_comms_email_send_binding below.
CREATE OR REPLACE FUNCTION public.claim_comms_email_send(_message_id uuid,_operation_id uuid,_reconcile boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb; facts jsonb; attempts int;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id FOR UPDATE;
 b:=m.meta->'comms_email_binding';
 IF b IS NULL OR _operation_id IS NULL OR b->>'operation_id' IS DISTINCT FROM _operation_id::text THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CLAIM_INVALID' USING ERRCODE='22023';
 END IF;
 facts:=public.read_comms_email_send_binding(_message_id);
 -- Serialize admission of identical content across distinct operations (each locks only its own
 -- row above), then refuse while another identical send is in flight or of unknown outcome.
 PERFORM pg_advisory_xact_lock(hashtextextended(m.tenant_id::text||E'\n'||coalesce(b->>'recipient','')||E'\n'||coalesce(b->>'content_digest',''),32848));
 IF facts->'eligible' IS DISTINCT FROM 'true'::jsonb
  OR NOT (CASE WHEN coalesce(_reconcile,false) THEN public._comms_email_reconcilable(b) ELSE b->>'state'='prepared' END)
  OR EXISTS (SELECT 1 FROM public.messages o WHERE o.tenant_id=m.tenant_id AND o.id<>m.id AND o.meta ? 'comms_email_binding'
   AND o.meta#>>'{comms_email_binding,recipient}'=b->>'recipient' AND o.meta#>>'{comms_email_binding,content_digest}'=b->>'content_digest'
   AND o.meta#>>'{comms_email_binding,state}' IN ('dispatching','unknown')) THEN
  RETURN jsonb_build_object('state',b->>'state','attempts',coalesce((b->>'attempts')::int,0));
 END IF;
 attempts:=coalesce((b->>'attempts')::int,0)+1;
 UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding}',
   b||jsonb_build_object('state','dispatching','attempts',attempts,'claimed_at',now())),error=NULL
  WHERE id=m.id;
 RETURN jsonb_build_object('state','dispatching','attempts',attempts);
END $$;

-- §59 service-only, door-scoped exemption (see header): no actor parameter by design.
CREATE OR REPLACE FUNCTION public.finalize_comms_email_send(_message_id uuid,_operation_id uuid,_outcome text,_provider_message_id text,_reason text,_claimed_attempt int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb; state text; reason text;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id FOR UPDATE;
 b:=m.meta->'comms_email_binding'; state:=b->>'state';
 IF b IS NULL OR _operation_id IS NULL OR b->>'operation_id' IS DISTINCT FROM _operation_id::text
  OR _outcome IS NULL OR _outcome NOT IN ('provider_accepted','failed','refused','unknown')
  OR (_outcome='provider_accepted' AND coalesce(length(btrim(_provider_message_id)),0)=0) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_RECEIPT_INVALID' USING ERRCODE='22023';
 END IF;
 IF state IN ('provider_accepted','failed','refused','unknown') THEN
  IF state IS DISTINCT FROM _outcome OR (_outcome='provider_accepted' AND b->>'provider_message_id' IS DISTINCT FROM _provider_message_id) THEN
   RAISE EXCEPTION 'COMMS_EMAIL_RECEIPT_CONFLICT' USING ERRCODE='40001';
  END IF;
 ELSE
  -- 'prepared': only an unclaimed pre-send refusal/failure. 'dispatching': only the attempt holding
  -- the claim, and never 'refused' (a refusal after a claim would turn a possibly-sent email into
  -- "Not sent"). Anything else is a losing or superseded caller and changes nothing.
  IF NOT ((state='prepared' AND _claimed_attempt IS NULL AND _outcome IN ('failed','refused'))
   OR (state='dispatching' AND _outcome<>'refused' AND _claimed_attempt IS NOT NULL
       AND _claimed_attempt=coalesce((b->>'attempts')::int,0))) THEN
   RAISE EXCEPTION 'COMMS_EMAIL_NOT_CLAIMED' USING ERRCODE='42501';
  END IF;
  IF _outcome='provider_accepted' AND m.provider_message_id IS NOT NULL AND m.provider_message_id IS DISTINCT FROM _provider_message_id THEN
   RAISE EXCEPTION 'COMMS_EMAIL_PROVIDER_READBACK_CONFLICT' USING ERRCODE='55000';
  END IF;
  -- Only a code-shaped reason is kept; provider error prose never enters the binding.
  reason:=CASE WHEN _reason ~ '^[a-z][a-z0-9_]{0,63}$' THEN _reason WHEN _outcome IN ('failed','refused') THEN 'unspecified' ELSE NULL END;
  UPDATE public.messages SET
   meta=jsonb_set(meta,'{comms_email_binding}',b||jsonb_build_object('state',_outcome,'finalized_at',now(),
     'provider_message_id',CASE WHEN _outcome='provider_accepted' THEN _provider_message_id ELSE b->>'provider_message_id' END,'outcome_reason',reason)),
   status=CASE _outcome WHEN 'provider_accepted' THEN 'sent' WHEN 'failed' THEN 'failed' WHEN 'refused' THEN 'blocked' ELSE status END,
   provider_message_id=CASE WHEN _outcome='provider_accepted' THEN _provider_message_id ELSE provider_message_id END,
   sent_at=CASE WHEN _outcome='provider_accepted' THEN coalesce(sent_at,now()) ELSE sent_at END,
   error=CASE _outcome WHEN 'provider_accepted' THEN NULL WHEN 'refused' THEN reason WHEN 'failed' THEN coalesce(error,'Email was not sent') ELSE error END
  WHERE id=m.id;
  PERFORM public.record_capability_run(m.tenant_id,(b->>'actor_user_id')::uuid,'comms_send_email',
   CASE _outcome WHEN 'provider_accepted' THEN 'capability_succeeded' WHEN 'refused' THEN 'capability_refused'
    WHEN 'unknown' THEN 'capability_outcome_unknown' ELSE 'capability_failed' END,_operation_id,NULL);
 END IF;
 RETURN jsonb_build_object('ok',_outcome='provider_accepted','outcome',_outcome,'operation_id',_operation_id,'message_id',m.id,
  'provider_receipt_available',_outcome='provider_accepted','delivery_confirmed',false);
END $$;

CREATE OR REPLACE FUNCTION public.read_comms_email_send_result(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb;
BEGIN
 PERFORM public._comms_email_actor(_actor_user_id,_expected_tenant_id);
 SELECT * INTO m FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=_operation_id::text;
 IF NOT FOUND THEN RETURN NULL; END IF;
 b:=m.meta->'comms_email_binding';
 IF m.tenant_id IS DISTINCT FROM _expected_tenant_id OR b->>'actor_user_id' IS DISTINCT FROM _actor_user_id::text THEN
  RAISE EXCEPTION 'COMMS_EMAIL_REPLAY_MISMATCH' USING ERRCODE='22023';
 END IF;
 RETURN jsonb_build_object('ok',b->>'state'='provider_accepted','outcome',b->>'state','operation_id',_operation_id,'message_id',m.id,
  'provider_receipt_available',m.provider_message_id IS NOT NULL AND b->>'state'='provider_accepted','delivery_confirmed',false,
  'prepared_at',b->'prepared_at','attempts',coalesce((b->>'attempts')::int,0),'provider',b->>'provider',
  'reconcilable',public._comms_email_reconcilable(b))
  ||CASE WHEN b->>'state'='refused' AND b->>'outcome_reason' IS NOT NULL THEN jsonb_build_object('reason',b->>'outcome_reason') ELSE '{}'::jsonb END;
END $$;

-- §59 service-only, door-scoped exemption (see header): the tenant is the door's server-resolved one.
CREATE OR REPLACE FUNCTION public.find_comms_email_pending_reconciliation(_expected_tenant_id uuid,_recipient text,_content_digest text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT (o.meta#>>'{comms_email_binding,operation_id}')::uuid FROM public.messages o
 WHERE o.tenant_id=_expected_tenant_id AND o.meta ? 'comms_email_binding'
  AND o.meta#>>'{comms_email_binding,recipient}'=lower(btrim(_recipient)) AND o.meta#>>'{comms_email_binding,content_digest}'=_content_digest
  AND o.meta#>>'{comms_email_binding,state}' IN ('dispatching','unknown')
 ORDER BY o.created_at DESC LIMIT 1
$$;

REVOKE ALL ON FUNCTION public._comms_email_actor(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._comms_email_actor(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public._comms_email_governance(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._comms_email_governance(uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public._comms_email_reconcilable(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._comms_email_reconcilable(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.read_comms_email_send_binding(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_comms_email_send_binding(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_comms_email_send(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_comms_email_send(uuid,uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.finalize_comms_email_send(uuid,uuid,text,text,text,int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_comms_email_send(uuid,uuid,text,text,text,int) TO service_role;
REVOKE ALL ON FUNCTION public.read_comms_email_send_result(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_comms_email_send_result(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.find_comms_email_pending_reconciliation(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.find_comms_email_pending_reconciliation(uuid,text,text) TO service_role;
