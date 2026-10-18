-- One governed follow-up origin, using the existing email admission/receipt path.
-- Supported origin kinds: owner.lead_followup, client.followup, owner.followup_email.
-- PPA -> exact action -> message; direct action cancellation never acquires PPA.
-- No external execution, new schema, grant, provider, scheduler or historical rewrite.
-- advance_action retains the source-backed retired-role transform (20270504000000),
-- verified against the actual pre-lease prosrc/ABI/owner/ACL/search_path catalog.

BEGIN;

CREATE OR REPLACE FUNCTION public.prepare_comms_email_send(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_contact_id uuid,_recipient text,_connector_id uuid,_from_address text,_subject text,_body_text text,_body_html text,_content_digest text,_command jsonb,_governance jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
 _uuid constant text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 _approval text; ap public.paige_pending_approvals%ROWTYPE; _act public.paige_actions%ROWTYPE;
 _live text; _cited text; _constraint text; _action_id uuid;
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
END $$;

CREATE OR REPLACE FUNCTION public.read_comms_email_send_binding(_message_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
 ap public.paige_pending_approvals%ROWTYPE; a public.paige_actions%ROWTYPE;
 approval uuid; origin uuid; named uuid; origin_ok boolean:=true;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 b:=m.meta->'comms_email_binding'; IF b IS NULL THEN RETURN NULL; END IF;
 PERFORM public._comms_email_actor((b->>'actor_user_id')::uuid,m.tenant_id);
 -- Only a fresh prepared admission needs pending-origin eligibility. Original admitted outcomes
 -- and the incumbent bounded same-operation reconciliation do not acquire fresh approval authority.
 IF b->>'approval_id' IS NOT NULL AND b->>'state'='prepared' THEN
  BEGIN approval:=(b->>'approval_id')::uuid; origin:=(b->>'origin_action_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN approval:=NULL; origin:=NULL; END;
  SELECT * INTO ap FROM public.paige_pending_approvals WHERE id=approval FOR UPDATE;
  SELECT * INTO a FROM public.paige_actions WHERE id=origin FOR UPDATE;
  BEGIN named:=nullif(btrim(ap.metadata->>'action_id'),'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN named:=NULL; END;
  origin_ok:=coalesce(ap.id IS NOT NULL AND origin IS NOT NULL AND a.id=origin AND named=origin
   AND ap.tenant_id=m.tenant_id AND a.tenant_id=m.tenant_id AND a.approval_id=ap.id
   AND a.contact_id=m.contact_id AND (ap.contact_id IS NULL OR ap.contact_id=m.contact_id)
   AND ap.status='pending' AND a.status IN ('drafted','pending_approval')
   AND a.action_kind IN ('owner.lead_followup','client.followup','owner.followup_email')
   AND a.action_kind=b->>'origin_action_kind'
   AND EXISTS (SELECT 1 FROM public.paige_action_kinds k WHERE k.slug=a.action_kind AND k.executor='send_via_approval')
   AND (SELECT count(*) FROM public.paige_actions x WHERE x.approval_id=ap.id)=1,false);
 END IF;
 -- Re-read after any origin-lock wait; a concurrent winning claim may have advanced state.
 SELECT * INTO m FROM public.messages WHERE id=_message_id FOR UPDATE;
 IF ((m.meta->'comms_email_binding')-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason'])
  IS DISTINCT FROM (b-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason']) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_BINDING_CHANGED' USING ERRCODE='40001';
 END IF;
 b:=m.meta->'comms_email_binding';
 IF b->>'state' IS DISTINCT FROM 'prepared' THEN origin_ok:=true; END IF;
 SELECT * INTO c FROM public.channel_connectors WHERE id=m.connector_id AND tenant_id=m.tenant_id FOR SHARE;
 RETURN b||jsonb_build_object('message_id',m.id,'tenant_id',m.tenant_id,'channel_type',m.channel_type,'message_status',m.status,
  'origin_eligible',origin_ok,'eligible',origin_ok AND m.channel_type='email' AND m.direction='outbound'
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

CREATE OR REPLACE FUNCTION public.claim_comms_email_send(_message_id uuid,_operation_id uuid,_reconcile boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; b jsonb; facts jsonb; attempts int;
 discovered jsonb; approval uuid; origin uuid;
BEGIN
 -- Discover without locks, then acquire actor -> PPA -> action -> message. Never enter through
 -- read_binding here: its connector lock belongs after origin/message in admission transactions.
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 discovered:=m.meta->'comms_email_binding';
 IF discovered IS NULL OR _operation_id IS NULL OR discovered->>'operation_id' IS DISTINCT FROM _operation_id::text THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CLAIM_INVALID' USING ERRCODE='22023';
 END IF;
 PERFORM public._comms_email_actor((discovered->>'actor_user_id')::uuid,m.tenant_id);
 IF discovered->>'approval_id' IS NOT NULL AND discovered->>'state'='prepared' THEN
  BEGIN approval:=(discovered->>'approval_id')::uuid; origin:=(discovered->>'origin_action_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN approval:=NULL; origin:=NULL; END;
  PERFORM 1 FROM public.paige_pending_approvals WHERE id=approval FOR UPDATE;
  PERFORM 1 FROM public.paige_actions WHERE id=origin FOR UPDATE;
 END IF;
 SELECT * INTO m FROM public.messages WHERE id=_message_id FOR UPDATE;
 b:=m.meta->'comms_email_binding';
 IF b IS NULL OR _operation_id IS NULL OR b->>'operation_id' IS DISTINCT FROM _operation_id::text
  OR (b-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason'])
   IS DISTINCT FROM (discovered-ARRAY['state','attempts','claimed_at','finalized_at','provider_message_id','outcome_reason']) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_CLAIM_INVALID' USING ERRCODE='22023';
 END IF;
 facts:=public.read_comms_email_send_binding(_message_id);
 IF b->>'state'='prepared' AND coalesce((b->>'attempts')::int,0)<>0 THEN
  RETURN jsonb_build_object('state','prepared','attempts',(b->>'attempts')::int,'admitted',false);
 END IF;
 IF b->>'approval_id' IS NOT NULL AND b->>'state'='prepared'
  AND coalesce((b->>'attempts')::int,0)=0 AND facts->'origin_eligible' IS DISTINCT FROM 'true'::jsonb THEN
  -- Known not admitted. Only the existing service finalizer writes the refusal/Rail. A JWT
  -- cancellation itself never writes a bound message or changes auth.uid(). No identity backfill.
  PERFORM public.finalize_comms_email_send(_message_id,_operation_id,'refused',NULL,'origin_not_sendable',NULL);
  RETURN jsonb_build_object('state','refused','attempts',0,'admitted',false);
 END IF;
 -- Serialize admission of identical content across distinct operations (each locks only its own
 -- row above), then refuse while another identical send is in flight or of unknown outcome.
 PERFORM pg_advisory_xact_lock(hashtextextended(m.tenant_id::text||E'\n'||coalesce(b->>'recipient','')||E'\n'||coalesce(b->>'content_digest',''),32848));
 IF facts->'eligible' IS DISTINCT FROM 'true'::jsonb
  OR NOT (CASE WHEN coalesce(_reconcile,false) THEN public._comms_email_reconcilable(b) ELSE b->>'state'='prepared' END)
  OR EXISTS (SELECT 1 FROM public.messages o WHERE o.tenant_id=m.tenant_id AND o.id<>m.id AND o.meta ? 'comms_email_binding'
   AND o.meta#>>'{comms_email_binding,recipient}'=b->>'recipient' AND o.meta#>>'{comms_email_binding,content_digest}'=b->>'content_digest'
   AND o.meta#>>'{comms_email_binding,state}' IN ('dispatching','unknown')) THEN
  -- Not admitted. The row may ALREADY read 'dispatching' (a concurrent winner just claimed it), so
  -- the reply must say so explicitly: send-message dispatches only on admitted=true.
  RETURN jsonb_build_object('state',b->>'state','attempts',coalesce((b->>'attempts')::int,0),'admitted',false);
 END IF;
 attempts:=coalesce((b->>'attempts')::int,0)+1;
 UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding}',
   b||jsonb_build_object('state','dispatching','attempts',attempts,'claimed_at',now())),error=NULL
  WHERE id=m.id;
 RETURN jsonb_build_object('state','dispatching','attempts',attempts,'admitted',true);
END $$;

CREATE OR REPLACE FUNCTION public.paige_guard_send_approval_requires_governed_send()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _uuid      constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  _ids       uuid[] := ARRAY[]::uuid[];
  _kinds     text[];
  _raw       text;
  _gs        jsonb;
  _mid       text;
  _op        text;
  _msg       public.messages%ROWTYPE;
  _tenant    uuid;
  _old_action uuid; _new_action uuid; _origin uuid; _bound public.messages%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' THEN
    BEGIN _old_action:=nullif(btrim(OLD.metadata->>'action_id'),'')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN _old_action:=NULL; END;
    BEGIN _new_action:=nullif(btrim(NEW.metadata->>'action_id'),'')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN _new_action:=NULL; END;
    -- The updating PPA lock precedes its exact actions and messages. Never update messages here:
    -- ordinary JWT callers remain subject to the incumbent governed-message write guard.
    PERFORM 1 FROM public.paige_actions a
     WHERE a.tenant_id=OLD.tenant_id AND a.approval_id=OLD.id
     ORDER BY a.id FOR UPDATE;
    FOR _bound IN SELECT m.* FROM public.messages m
     WHERE m.tenant_id=OLD.tenant_id AND m.meta ? 'comms_email_binding'
      AND lower(m.meta#>>'{comms_email_binding,approval_id}')=OLD.id::text
     ORDER BY m.id FOR UPDATE
    LOOP
      IF _bound.meta#>>'{comms_email_binding,state}' IN ('prepared','dispatching','unknown','provider_accepted') THEN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
         OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR _new_action IS DISTINCT FROM _old_action THEN
          RAISE EXCEPTION 'COMMS_EMAIL_ORIGIN_BINDING_CHANGED' USING ERRCODE='42501';
        END IF;
        IF NEW.metadata->'governed_send' IS DISTINCT FROM OLD.metadata->'governed_send'
         AND NEW.metadata->'governed_send' IS NOT NULL AND NEW.metadata->'governed_send'<>'null'::jsonb
         AND (NEW.metadata#>>'{governed_send,operation_id}' IS DISTINCT FROM _bound.meta#>>'{comms_email_binding,operation_id}'
          OR NEW.metadata#>>'{governed_send,message_id}' IS DISTINCT FROM _bound.id::text) THEN
          RAISE EXCEPTION 'COMMS_EMAIL_ORIGIN_BINDING_CHANGED' USING ERRCODE='42501';
        END IF;
        IF NEW.metadata->'governed_send' IS DISTINCT FROM OLD.metadata->'governed_send'
         AND OLD.metadata->'governed_send' IS NOT NULL AND OLD.metadata->'governed_send'<>'null'::jsonb
         AND (NEW.metadata->'governed_send' IS NULL OR NEW.metadata->'governed_send'='null'::jsonb) THEN
          RAISE EXCEPTION 'COMMS_EMAIL_ORIGIN_BINDING_CHANGED' USING ERRCODE='42501';
        END IF;
        IF NEW.status IN ('rejected','skipped') AND NEW.status IS DISTINCT FROM OLD.status
         AND (_bound.meta#>>'{comms_email_binding,state}' IN ('dispatching','unknown','provider_accepted')
          OR coalesce((_bound.meta#>>'{comms_email_binding,attempts}')::int,0)>0) THEN
          RAISE EXCEPTION 'COMMS_EMAIL_ALREADY_ADMITTED' USING ERRCODE='55000';
        END IF;
      END IF;
    END LOOP;
  END IF;
  IF NEW.status IS NULL OR NEW.status NOT IN ('approved', 'sent') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  _raw := btrim(NEW.metadata->>'action_id');
  IF _raw IS NOT NULL THEN BEGIN _ids := _ids || _raw::uuid; EXCEPTION WHEN invalid_text_representation THEN NULL; END; END IF;
  IF TG_OP = 'UPDATE' THEN
    _raw := btrim(OLD.metadata->>'action_id');
    -- Any text Postgres casts to a uuid ({…}, no dashes, upper case) names the action, exactly as
    -- trg_ppa_sync_action reads it (round-5 verifier); only text that is not a uuid is ignored.
    IF _raw IS NOT NULL THEN BEGIN _ids := _ids || _raw::uuid; EXCEPTION WHEN invalid_text_representation THEN NULL; END; END IF;
  END IF;

  SELECT array_agg(DISTINCT a.action_kind ORDER BY a.action_kind) INTO _kinds
    FROM public.paige_actions a
    JOIN public.paige_action_kinds k ON k.slug = a.action_kind
   WHERE k.executor = 'send_via_approval'
     AND (a.id = ANY (_ids) OR a.approval_id = NEW.id);
  IF _kinds IS NULL THEN
    RETURN NEW;  -- not an outbound-message approval: every other approval is untouched (§58)
  END IF;

  -- Any send kind without a governed record path is decline/archive only — no proof is consulted.
  IF cardinality(_kinds)<>1 OR NOT (_kinds[1]=ANY(ARRAY['owner.lead_followup','client.followup','owner.followup_email'])) THEN
    RAISE EXCEPTION 'SEND_REQUIRES_GOVERNED_SEND: an outbound message is approved only once the business''s verified email has sent it; it can still be declined'
      USING ERRCODE = '42501',
            DETAIL  = 'reason_code=decline_only',
            HINT    = 'This message can be declined for now; sending it from an approval is not available yet.';
  END IF;

  -- Every action this approval names (NEW or stored OLD metadata.action_id) must be THIS approval's own
  -- action (paige_actions.approval_id = NEW.id). Otherwise one reply's send could approve this row while
  -- metadata.action_id points at ANOTHER reply's action, and the approve→action sync would mark that
  -- other reply done with no send of its own (round-4 security LOW-1). The only writer that approves a
  -- reply, _lead_reply_record_send, already requires the same link, and advance_action writes it when
  -- it files the approval; editing action_id while pending stays possible, approving with it does not.
  IF EXISTS (SELECT 1 FROM unnest(_ids) AS n(id)
              WHERE NOT EXISTS (SELECT 1 FROM public.paige_actions a WHERE a.id = n.id AND a.approval_id = NEW.id)) THEN
    RAISE EXCEPTION 'SEND_REQUIRES_GOVERNED_SEND: an outbound message is approved only once the business''s verified email has sent it; it can still be declined'
      USING ERRCODE = '42501',
            DETAIL  = 'reason_code=review_and_send',
            HINT    = 'This approval names a reply that is not its own; review and send each reply from its own approval.';
  END IF;

  _gs  := NEW.metadata->'governed_send';
  _mid := CASE WHEN jsonb_typeof(_gs) = 'object' THEN lower(btrim(_gs->>'message_id')) END;
  _op  := CASE WHEN jsonb_typeof(_gs) = 'object' THEN lower(btrim(_gs->>'operation_id')) END;

  IF _mid ~ _uuid AND _op ~ _uuid THEN
    SELECT * INTO _msg FROM public.messages WHERE id = _mid::uuid;
  END IF;

  _tenant := NEW.tenant_id;
  BEGIN _origin:=(_msg.meta#>>'{comms_email_binding,origin_action_id}')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN _origin:=NULL; END;
  -- Existing accepted legacy lead receipts retain their original strict recording contract.
  -- A newly supported kind, or a sealed lead, must prove its native exact original action.
  IF (_kinds[1]<>'owner.lead_followup' OR _msg.meta#>>'{comms_email_binding,origin_action_id}' IS NOT NULL)
   AND (_origin IS NULL OR NOT (_origin=ANY(_ids))
    OR (SELECT count(*) FROM public.paige_actions a WHERE a.approval_id=NEW.id)<>1
    OR NOT EXISTS (SELECT 1 FROM public.paige_actions a WHERE a.id=_origin AND a.approval_id=NEW.id
      AND a.tenant_id=NEW.tenant_id AND a.contact_id=_msg.contact_id AND a.action_kind=_kinds[1]
      AND a.action_kind=_msg.meta#>>'{comms_email_binding,origin_action_kind}')) THEN
    RAISE EXCEPTION 'COMMS_EMAIL_ORIGIN_BINDING_CHANGED' USING ERRCODE='42501';
  END IF;

  IF _msg.id IS NULL
     OR NOT (_msg.meta ? 'comms_email_binding')
     OR lower(btrim(_msg.meta#>>'{comms_email_binding,approval_id}')) IS DISTINCT FROM NEW.id::text
     OR _msg.meta#>>'{comms_email_binding,state}' IS DISTINCT FROM 'provider_accepted'
     OR lower(_msg.meta#>>'{comms_email_binding,operation_id}') IS DISTINCT FROM _op
     OR _tenant IS NULL OR _msg.tenant_id IS DISTINCT FROM _tenant
     OR _msg.contact_id IS NULL
     OR _msg.created_at < NEW.created_at
     OR EXISTS (
          SELECT 1
            FROM public.paige_actions a
            JOIN public.paige_action_kinds k ON k.slug = a.action_kind
           WHERE k.executor = 'send_via_approval'
             AND (a.id = ANY (_ids) OR a.approval_id = NEW.id)
             AND (a.tenant_id IS DISTINCT FROM _msg.tenant_id OR a.contact_id IS DISTINCT FROM _msg.contact_id))
     OR EXISTS (
          SELECT 1 FROM public.paige_pending_approvals o
           WHERE o.id <> NEW.id
             AND o.status IN ('approved', 'sent')
             AND lower(o.metadata#>>'{governed_send,message_id}') = _msg.id::text)
  THEN
    RAISE EXCEPTION 'SEND_REQUIRES_GOVERNED_SEND: an outbound message is approved only once the business''s verified email has sent it; it can still be declined'
      USING ERRCODE = '42501',
            DETAIL  = 'reason_code=review_and_send',
            HINT    = 'Review and send it from the reply screen; the send is recorded on the approval once the business''s verified email has sent it.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._lead_reply_record_send(_approval_id uuid, _operation_id uuid, _actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _uuid       constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  _active     uuid;
  _tenant     uuid;
  _ap         public.paige_pending_approvals%ROWTYPE;
  _act        public.paige_actions%ROWTYPE;
  _msg        public.messages%ROWTYPE;
  _state      text;
  _gs         jsonb;
  _raw        text;
  _prior_op   text;
  _prior_st   text;
  _named_action uuid;
BEGIN
  IF _actor IS NULL OR (auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM _actor) THEN
    RAISE EXCEPTION 'LEAD_REPLY_FORBIDDEN: sign in to record a reply' USING ERRCODE = '42501';
  END IF;
  IF _approval_id IS NULL OR _operation_id IS NULL THEN
    RAISE EXCEPTION 'LEAD_REPLY_INVALID: an approval and a send operation are required' USING ERRCODE = '22023';
  END IF;

  -- The actor's active business: the JWT caller's resolved one, or (service path) the actor's profile.
  _active := CASE WHEN auth.uid() IS NOT NULL THEN public.current_user_tenant_id()
                  ELSE (SELECT p.active_tenant_id FROM public.profiles p WHERE p.user_id = _actor) END;

  -- Authorization FIRST, on an unlocked read. One refusal for "no such approval" and "not yours", so
  -- another business's approval ids are neither confirmed to exist nor lockable by an outsider.
  SELECT p.tenant_id INTO _tenant FROM public.paige_pending_approvals p WHERE p.id = _approval_id;
  IF _tenant IS NULL
     OR _tenant IS DISTINCT FROM _active
     OR NOT EXISTS (
          SELECT 1 FROM auth.users u
           WHERE u.id = _actor AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until <= now()))
     OR NOT EXISTS (
          SELECT 1 FROM public.tenant_members m
           WHERE m.tenant_id = _tenant AND m.user_id = _actor
             AND m.status = 'active' AND m.role IN ('owner', 'admin')) THEN
    RAISE EXCEPTION 'LEAD_REPLY_FORBIDDEN: only an owner or admin of this business can record its replies'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.status IN ('trial', 'active', 'past_due')) THEN
    RAISE EXCEPTION 'LEAD_REPLY_WORKSPACE_UNAVAILABLE: this business is not active, so its replies cannot be recorded'
      USING ERRCODE = '42501';
  END IF;

  -- Stabilize actor facts before PPA -> action -> message, matching native admission.
  PERFORM public._comms_email_actor(_actor,_tenant);
  -- Only now, as a proven owner/admin of the approval's business, take the row lock.
  SELECT * INTO _ap FROM public.paige_pending_approvals WHERE id = _approval_id FOR UPDATE;
  IF _ap.id IS NULL OR _ap.tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'LEAD_REPLY_FORBIDDEN: only an owner or admin of this business can record its replies'
      USING ERRCODE = '42501';
  END IF;

  -- The reply action: named by the approval AND pointing back at it, in the same business.
  _raw := btrim(_ap.metadata->>'action_id');
  BEGIN _named_action:=nullif(_raw,'')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN _named_action:=NULL; END;
  IF _named_action IS NOT NULL THEN
    SELECT * INTO _act FROM public.paige_actions a
     WHERE a.id = _named_action AND a.approval_id = _ap.id AND a.tenant_id = _ap.tenant_id FOR UPDATE;
  END IF;
  IF _act.id IS NULL OR _act.action_kind NOT IN ('owner.lead_followup','client.followup','owner.followup_email') OR _act.contact_id IS NULL THEN
    RAISE EXCEPTION 'LEAD_REPLY_WRONG_KIND: only a drafted reply to a new lead is recorded here' USING ERRCODE = '22023';
  END IF;

  _prior_op := lower(btrim(_ap.metadata#>>'{governed_send,operation_id}'));

  IF _ap.status = 'approved' THEN
    IF _prior_op = _operation_id::text THEN
      RETURN jsonb_build_object('ok', true, 'state', 'provider_accepted', 'delivery_confirmed', false,
        'approval_id', _ap.id, 'message_id', _ap.metadata#>>'{governed_send,message_id}',
        'operation_id', _operation_id, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'LEAD_REPLY_ALREADY_RECORDED: this reply was already recorded as sent by another send'
      USING ERRCODE = '55000';
  END IF;
  IF _ap.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'LEAD_REPLY_NOT_PENDING: this reply is no longer waiting to be sent' USING ERRCODE = '55000';
  END IF;

  -- An earlier, different send of this reply that has not finished (or finished accepted but was not
  -- recorded yet) blocks recording another: two copies of one reply must never both count.
  IF _prior_op ~ _uuid AND _prior_op IS DISTINCT FROM _operation_id::text THEN
    SELECT m.meta#>>'{comms_email_binding,state}' INTO _prior_st
      FROM public.messages m
     WHERE m.meta ? 'comms_email_binding'
       AND m.meta#>>'{comms_email_binding,operation_id}' = _prior_op
       AND m.tenant_id = _ap.tenant_id;
    IF _prior_st IN ('prepared', 'dispatching', 'unknown', 'provider_accepted') THEN
      RAISE EXCEPTION 'LEAD_REPLY_PRIOR_SEND_UNRESOLVED: an earlier send of this reply has not been resolved yet'
        USING ERRCODE = '55000',
              DETAIL  = format('prior_operation_id=%s prior_state=%s', _prior_op, _prior_st),
              HINT    = 'Record the earlier send again to pick up its outcome; a new send can be recorded once it has failed.';
    END IF;
  END IF;

  -- The governed send for this operation, in this business, to this lead. The operation_id is unique
  -- across messages (messages_comms_email_operation, partial to meta ? 'comms_email_binding' — the
  -- predicate below lets the lookup use it), so this is at most one row.
  SELECT * INTO _msg FROM public.messages m
   WHERE m.meta ? 'comms_email_binding'
     AND m.meta#>>'{comms_email_binding,operation_id}' = _operation_id::text
     AND m.tenant_id = _ap.tenant_id
     AND m.contact_id = _act.contact_id
     AND m.channel_type = 'email' AND m.direction = 'outbound' FOR UPDATE;
  IF _msg.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'state', 'not_found', 'delivery_confirmed', false,
      'approval_id', _ap.id, 'operation_id', _operation_id);
  END IF;
  -- The send was prepared for THIS reply: an accepted email to the same lead that the door prepared for
  -- another approval, or for none (chat, support), is never this reply's proof.
  IF lower(btrim(_msg.meta#>>'{comms_email_binding,approval_id}')) IS DISTINCT FROM _ap.id::text THEN
    RAISE EXCEPTION 'LEAD_REPLY_NOT_THIS_APPROVAL: this email was not sent as this reply, so it cannot be recorded as its send'
      USING ERRCODE = '42501';
  END IF;
  IF (_act.action_kind<>'owner.lead_followup' OR _msg.meta#>>'{comms_email_binding,origin_action_id}' IS NOT NULL)
   AND (_msg.meta#>>'{comms_email_binding,origin_action_id}' IS DISTINCT FROM _act.id::text
    OR _msg.meta#>>'{comms_email_binding,origin_action_kind}' IS DISTINCT FROM _act.action_kind
    OR (SELECT count(*) FROM public.paige_actions a WHERE a.approval_id=_ap.id)<>1) THEN
    RAISE EXCEPTION 'COMMS_EMAIL_ORIGIN_BINDING_CHANGED' USING ERRCODE='42501';
  END IF;
  -- The person recording is the person who sent it: a send is never claimed by someone else.
  IF lower(_msg.meta#>>'{comms_email_binding,actor_user_id}') IS DISTINCT FROM _actor::text THEN
    RAISE EXCEPTION 'LEAD_REPLY_NOT_YOUR_SEND: this send was made by another person, so only they can record it'
      USING ERRCODE = '42501';
  END IF;

  _state := _msg.meta#>>'{comms_email_binding,state}';
  _gs := jsonb_build_object('message_id', _msg.id, 'operation_id', _operation_id, 'state', _state, 'recorded_at', now());

  IF _state = 'provider_accepted' THEN
    UPDATE public.paige_pending_approvals SET
      status              = 'approved',
      reviewed_by_user_id = _actor,
      reviewed_at         = now(),
      sent_at             = COALESCE(_msg.sent_at, now()),
      metadata            = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('governed_send', _gs)
    WHERE id = _ap.id;
    UPDATE public.clients SET last_contacted_at = now()
     WHERE id = _act.contact_id AND tenant_id = _ap.tenant_id;
    RETURN jsonb_build_object('ok', true, 'state', _state, 'delivery_confirmed', false,
      'approval_id', _ap.id, 'message_id', _msg.id, 'operation_id', _operation_id);
  END IF;

  IF _state IN ('prepared', 'dispatching', 'unknown') THEN
    UPDATE public.paige_pending_approvals SET
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('governed_send', _gs)
    WHERE id = _ap.id;
  END IF;

  -- failed | refused (and any state this function does not know) leave the approval as it was.
  RETURN jsonb_build_object('ok', false, 'state', COALESCE(_state, 'unknown'), 'delivery_confirmed', false,
    'approval_id', _ap.id, 'message_id', _msg.id, 'operation_id', _operation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_action(
  p_action_id uuid,
  p_to_status text DEFAULT NULL::text,
  p_draft_content jsonb DEFAULT NULL::jsonb,
  p_assigned_subagent_slug text DEFAULT NULL::text,
  p_assigned_to_user_id uuid DEFAULT NULL::uuid,
  p_invocation_id uuid DEFAULT NULL::uuid,
  p_result jsonb DEFAULT NULL::jsonb,
  p_error text DEFAULT NULL::text,
  p_decision_rationale text DEFAULT NULL::text,
  p_tenant_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _row    public.paige_actions%ROWTYPE;
  _kind   public.paige_action_kinds%ROWTYPE;
  _lane   text;
  _appr   uuid;
  _cust   uuid;
  _res    jsonb;
  _next   text;
  _message public.messages%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.paige_actions WHERE id=p_action_id FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'ACTION_NOT_FOUND' USING ERRCODE='P0002'; END IF;

  IF _caller IS NOT NULL THEN
    IF NOT (_row.tenant_id = public.current_user_tenant_id() OR public.is_platform_owner(_caller)) THEN
      RAISE EXCEPTION 'ACTION_FORBIDDEN: wrong tenant' USING ERRCODE='42501';
    END IF;
    IF NOT public.has_any_role(_caller, ARRAY['admin','super_admin']) THEN
      RAISE EXCEPTION 'ACTION_FORBIDDEN: admin or coach required' USING ERRCODE='42501';
    END IF;
  ELSE
    IF p_tenant_id IS NOT NULL AND p_tenant_id <> _row.tenant_id THEN
      RAISE EXCEPTION 'ACTION_FORBIDDEN: tenant mismatch' USING ERRCODE='42501';
    END IF;
  END IF;

  IF _row.status IN ('done','dismissed','failed','expired') THEN
    RETURN jsonb_build_object('ok',true,'action_id',_row.id,'status',_row.status,'noop',true);
  END IF;

  SELECT * INTO _kind FROM public.paige_action_kinds WHERE slug=_row.action_kind;
  _next := COALESCE(p_to_status, _row.status);

  -- #246 §9/§45 ADDRESS-SCOPE GUARD: a direct address (assigning this action to a sub-agent by slug)
  -- may only target a platform-default agent (tenant_id IS NULL) OR one owned by THIS action's tenant.
  -- Same predicate as the dispatch side (paige-orchestrator tool_invoke). Foreign-tenant / unknown /
  -- disabled slug => 42501, closing the cross-tenant addressing IDOR. _row.tenant_id is the action's
  -- server-resolved tenant, never a caller param.
  IF p_assigned_subagent_slug IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.paige_subagents s
       WHERE s.slug = p_assigned_subagent_slug
         AND s.enabled
         AND (s.tenant_id IS NULL OR s.tenant_id = _row.tenant_id)
     ) THEN
    RAISE EXCEPTION 'ACTION_FORBIDDEN: agent % not addressable in this tenant', p_assigned_subagent_slug
      USING ERRCODE='42501';
  END IF;

  IF p_assigned_subagent_slug IS NOT NULL OR p_assigned_to_user_id IS NOT NULL THEN
    UPDATE public.paige_actions SET
      assigned_subagent_slug = COALESCE(p_assigned_subagent_slug, assigned_subagent_slug),
      assigned_to_user_id    = COALESCE(p_assigned_to_user_id, assigned_to_user_id),
      assigned_at            = COALESCE(assigned_at, now())
    WHERE id=_row.id;
  END IF;

  IF _next = 'assigned' THEN
    UPDATE public.paige_actions SET status='assigned', assigned_at=COALESCE(assigned_at,now()) WHERE id=_row.id;

  ELSIF _next = 'drafting' THEN
    UPDATE public.paige_actions SET status='drafting' WHERE id=_row.id;

  ELSIF _next = 'drafted' THEN
    UPDATE public.paige_actions SET
      status='drafted', draft_content=COALESCE(p_draft_content, draft_content),
      invocation_id=COALESCE(p_invocation_id, invocation_id), drafted_at=now()
    WHERE id=_row.id;
    _lane := public.paige_resolve_autonomy(_row.tenant_id, _row.action_kind, _kind.default_autonomy_lane);

    IF _kind.requires_approval THEN
      -- Idempotent: only mint a new approval if one isn't already attached to this action.
      -- A re-advance (e.g. the drainer's self-heal reclaim race) must NOT drop a duplicate
      -- draft into the coach's inbox — it just re-asserts pending_approval.
      IF _row.approval_id IS NULL THEN
        INSERT INTO public.paige_pending_approvals(
          type, category, draft_content, contact_id, conversation_id, tenant_id,
          source, risk_level, submitted_by_user_id, metadata
        ) VALUES (
          _kind.approval_type, _row.action_kind,
          COALESCE(p_draft_content, _row.draft_content), _row.contact_id, _row.conversation_id, _row.tenant_id,
          'paige_action_bus', 'medium', _caller,
          jsonb_build_object('action_id', _row.id)
        ) RETURNING id INTO _appr;
        UPDATE public.paige_actions SET approval_id=_appr, status='pending_approval' WHERE id=_row.id;
      ELSE
        UPDATE public.paige_actions SET status='pending_approval' WHERE id=_row.id;
      END IF;

    ELSIF _lane = 'auto' THEN
      _next := 'executing';
    END IF;
  END IF;

  IF _next = 'executing' THEN
    IF _kind.executor = 'record_only' THEN
      UPDATE public.paige_actions SET status='done', executed_at=now(), resolved_at=now(),
        result=COALESCE(p_result, result) WHERE id=_row.id;

    ELSIF _kind.executor = 'surface_to_client' THEN
      BEGIN
        _res := public.admin_propose_paige_actions(
                  _row.contact_id,
                  jsonb_build_array(jsonb_build_object(
                    'action_type', _row.action_kind,
                    'title', _row.title,
                    'body', COALESCE(_row.draft_content->>'body', _row.summary, _row.title),
                    'payload', COALESCE(_row.draft_content, _row.payload)
                  )));
        IF COALESCE((_res->>'ok')::boolean, false) THEN
          _cust := NULLIF(_res->'ids'->>0, '')::uuid;
          UPDATE public.paige_actions SET status='done', customer_action_id=_cust, executed_at=now(),
            resolved_at=now(), result=jsonb_build_object('customer_action_id',_cust) WHERE id=_row.id;
        ELSE
          UPDATE public.paige_actions SET status='blocked',
            error='client_surface_failed: '||COALESCE(_res->>'error','unknown'), resolved_at=now() WHERE id=_row.id;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        UPDATE public.paige_actions SET status='blocked', error='client_surface_failed: '||SQLERRM,
          resolved_at=now() WHERE id=_row.id;
      END;

    ELSIF _kind.executor = 'workflow' THEN
      -- WORKFLOW EXECUTOR (fills the former ACTION_WORKFLOW_UNIMPLEMENTED slot, §4/§B7):
      -- resolve the tenant-scoped registry entry by key; if the registry entry requires
      -- approval and none is attached yet, route into the shared approval lane
      -- (paige_pending_approvals.type='workflow_run'); otherwise queue a run row, link it
      -- to the action, and mark the action 'executing'. The dispatch sweeper fires the run;
      -- trg_pwr_sync_action flips the action to done/failed/dismissed at terminal —
      -- truthful reporting, never done-at-fire-time.
      DECLARE
        _reg    public.paige_workflow_registry%ROWTYPE;
        _wf_key text := COALESCE(_row.payload->>'workflow_key', _row.draft_content->>'workflow_key');
        _run_id uuid;
      BEGIN
        IF _wf_key IS NULL OR length(trim(_wf_key)) = 0 THEN
          RAISE EXCEPTION 'ACTION_WORKFLOW_NO_KEY: payload.workflow_key required' USING ERRCODE='22023';
        END IF;

        SELECT * INTO _reg FROM public.paige_workflow_registry
         WHERE key = _wf_key AND is_active AND (tenant_id IS NULL OR tenant_id = _row.tenant_id);
        IF _reg.id IS NULL THEN
          RAISE EXCEPTION 'ACTION_WORKFLOW_UNKNOWN: % not available for tenant', _wf_key USING ERRCODE='22023';
        END IF;

        IF _reg.requires_approval AND _row.approval_id IS NULL THEN
          INSERT INTO public.paige_pending_approvals(
            type, category, draft_content, contact_id, conversation_id, tenant_id,
            source, risk_level, submitted_by_user_id, metadata
          ) VALUES (
            'workflow_run', _row.action_kind,
            COALESCE(_row.draft_content, jsonb_build_object('workflow_key', _wf_key)),
            _row.contact_id, _row.conversation_id, _row.tenant_id,
            'paige_action_bus', 'medium', _caller,
            jsonb_build_object('action_id', _row.id, 'workflow_key', _wf_key, 'registry_id', _reg.id)
          ) RETURNING id INTO _appr;
          UPDATE public.paige_actions SET approval_id=_appr, status='pending_approval' WHERE id=_row.id;
        ELSE
          INSERT INTO public.paige_workflow_runs(registry_id, tenant_id, triggered_by_user_id, payload, status)
          VALUES (_reg.id, _row.tenant_id, _caller, COALESCE(_row.payload,'{}'::jsonb), 'queued')
          RETURNING id INTO _run_id;
          UPDATE public.paige_actions
             SET workflow_run_id=_run_id, status='executing', executed_at=now()
           WHERE id=_row.id;
        END IF;
      END;

    ELSE
      RAISE EXCEPTION 'ACTION_MISTYPED: send_via_approval kinds route through the approval lane' USING ERRCODE='22023';
    END IF;

  ELSIF _next IN ('dismissed','failed','blocked') THEN
    IF _row.approval_id IS NOT NULL AND _row.action_kind IN ('owner.lead_followup','client.followup','owner.followup_email') THEN
      -- This writer already owns action. It takes only message next, never PPA: no A -> PPA cycle.
      FOR _message IN SELECT m.* FROM public.messages m
       WHERE m.tenant_id=_row.tenant_id AND m.meta ? 'comms_email_binding'
        AND lower(m.meta#>>'{comms_email_binding,approval_id}')=_row.approval_id::text
       ORDER BY m.id FOR UPDATE
      LOOP
        IF _message.meta#>>'{comms_email_binding,state}' IN ('dispatching','unknown','provider_accepted')
         OR (_message.meta#>>'{comms_email_binding,state}'='prepared'
          AND coalesce((_message.meta#>>'{comms_email_binding,attempts}')::int,0)>0) THEN
          RAISE EXCEPTION 'COMMS_EMAIL_ALREADY_ADMITTED' USING ERRCODE='55000';
        END IF;
      END LOOP;
    END IF;
    UPDATE public.paige_actions SET status=_next, error=COALESCE(p_error,error),
      decision_rationale=COALESCE(p_decision_rationale, decision_rationale), resolved_at=now()
    WHERE id=_row.id;
  END IF;

  INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
  VALUES (_caller, 'paige_action', 'advance_action', _row.id,
          jsonb_build_object('to', _next, 'kind', _row.action_kind));

  SELECT * INTO _row FROM public.paige_actions WHERE id=p_action_id;
  RETURN jsonb_build_object('ok',true,'action_id',_row.id,'status',_row.status,
                            'approval_id',_row.approval_id,'customer_action_id',_row.customer_action_id);
END $function$;

COMMIT;
