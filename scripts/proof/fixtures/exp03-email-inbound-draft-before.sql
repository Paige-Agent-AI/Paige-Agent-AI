-- Sanitized exact production function definitions read 2026-10-31. Source only; no account data.
CREATE OR REPLACE FUNCTION public._lead_reply_record_send(_approval_id uuid, _operation_id uuid, _actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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

  -- Lock every own backlink before message, including the strict legacy accepted-lead class.
  PERFORM 1 FROM public.paige_actions a WHERE a.approval_id=_ap.id AND a.tenant_id=_ap.tenant_id ORDER BY a.id FOR UPDATE;
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
$function$;
REVOKE ALL ON FUNCTION public._lead_reply_record_send(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.paige_guard_send_approval_requires_governed_send()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$;
REVOKE ALL ON FUNCTION public.paige_guard_send_approval_requires_governed_send() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_comms_email_send_binding(_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE m public.messages%ROWTYPE; c public.channel_connectors%ROWTYPE; b jsonb;
 ap public.paige_pending_approvals%ROWTYPE; a public.paige_actions%ROWTYPE;
 approval uuid; origin uuid; named uuid; origin_ok boolean:=true;
 agreement_source jsonb;
BEGIN
 SELECT * INTO m FROM public.messages WHERE id=_message_id;
 b:=m.meta->'comms_email_binding'; IF b IS NULL THEN RETURN NULL; END IF;
 PERFORM public._comms_email_release_actor(b,m.tenant_id);
 -- Source is resolved BEFORE the message lock; claim takes the same parent
 -- first. Terminal history is never fresh permission or a re-send.
 IF b#>>'{governance,purpose}'='agreement_signature_request' THEN
  agreement_source:=private.e04_agreement_email_binding(b,b->>'state' IN ('prepared','dispatching'));
 END IF;
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
 -- Recheck the ORIGINAL lease/approval after any connector wait. The parent
 -- agreement lock was acquired above; this adds no inverse message->parent lock.
 IF agreement_source IS NOT NULL THEN
  agreement_source:=private.e04_agreement_email_binding(b,b->>'state' IN ('prepared','dispatching'));
 END IF;
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
   AND (agreement_source IS NOT NULL OR EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.tenant_id=m.tenant_id AND cm.client_id=m.contact_id
    AND cm.kind='email' AND lower(btrim(cm.value))=b->>'recipient')))
  || CASE WHEN agreement_source IS NOT NULL THEN jsonb_build_object('agreement_source',agreement_source) ELSE '{}'::jsonb END;
END $function$;
REVOKE ALL ON FUNCTION public.read_comms_email_send_binding(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_comms_email_send_binding(uuid) TO service_role;
