-- ============================================================================
-- Experience 03 · S3 "PAIGE works your leads" — truthful PAIGE Email receipts and one connected history.
--
-- Two things, both additive:
--
-- A. RECEIPTS. A verified SendGrid Event Webhook event now also updates the GOVERNED email it is about
--    (a messages row carrying meta.comms_email_binding, INT-328) — but only when it correlates, and
--    only forward. ingest_sendgrid_receipt keeps its email_send_log behaviour exactly (journal dedup on
--    the provider's event identity, one appended row per event, the send path's own 'sent' row absorbed)
--    and gains five OPTIONAL arguments (the send's custom_args paige_tenant_id / paige_operation_id /
--    paige_message_id — the keys send-message sets on a governed SendGrid send — the bounce type and
--    the provider reason). The 5-argument signature is DROPPED and replaced by the 10-argument one whose
--    new arguments default to NULL, so every positional 5-argument call keeps working (§37 below).
--
--    Correlation — ALL must hold, or the event changes no message and the journal records
--    correlation='uncorrelated' with a code-shaped reason:
--      * exactly one messages row whose provider_message_id = the sg_message_id prefix (the X-Message-Id
--        the send path stored at provider_accepted; uq_messages_provider_message_id makes it unique);
--      * it is a governed email (meta.comms_email_binding), outbound, channel email, binding state
--        'provider_accepted', binding.provider_message_id equal to the same id, binding.provider
--        'sendgrid' (a SendGrid event is only ever about an email SendGrid accepted);
--      * when the event carries custom_args paige_tenant_id / paige_operation_id / paige_message_id, they
--        equal the message's tenant / the binding's operation / the message id (a forged or cross-tenant
--        claim is refused, never "best-effort"; a malformed one is refused too);
--      * when the event carries the recipient address, it equals the binding's recipient.
--
--    Mapping (the provider-reported outcome, never a guess):
--      delivered            -> messages.status 'delivered'; binding delivery_state 'delivered',
--                              delivery_confirmed true, delivered_at.
--      bounce               -> status 'failed'; delivery_state 'bounced'  (+ reason).
--      bounce type=blocked  -> status 'failed'; delivery_state 'blocked'  (+ reason).
--      dropped              -> status 'failed'; delivery_state 'dropped'  (+ reason).
--      spamreport           -> delivery_state 'spam_reported'; STATUS UNCHANGED — see CHOICES.
--      deferred             -> delivery_state 'deferred'; status unchanged; no delivery claim.
--      open / click / sent  -> correlated and journalled; no change and no delivery claim.
--
--    CHOICES (stated, because each is a judgement):
--      * Never backwards. delivered / bounced / blocked / dropped are terminal. A deferred after any of
--        them is ignored (journalled). The FIRST terminal outcome wins.
--      * Bounce/blocked/dropped AFTER delivered: the receiving server's acceptance is a fact that already
--        happened, so status stays 'delivered' and delivery_confirmed stays true; the later report is
--        kept on the binding as delivery_late_event {state, reason, event_at} so a screen can say
--        "delivered, later returned". Overwriting delivered with failed would erase a true fact;
--        dropping the late report would hide one.
--      * Spam report: a spam complaint comes from the recipient's mailbox provider, so the email
--        ARRIVED. Marking the message 'failed' would tell the owner it never reached the person and
--        invite a resend to someone who just reported it. Status is left as it was; delivery_state
--        says 'spam_reported'. (The brief said "failed or closest allowed value"; this is the deviation.)
--      * delivered AFTER a terminal negative: contradictory; nothing moves, kept as delivery_late_event.
--      * Provider reason: control characters stripped, every e-mail-shaped token replaced by
--        '[address]', 200 characters max. No new personal data is stored.
--      * Customer-facing wording on the row (messages.error, history text) says "PAIGE Email" or
--        "the email provider", never a vendor name, and never "delivered" unless delivered was reported.
--
-- B. ONE CONNECTED HISTORY. When a governed lead reply reaches provider_accepted, one contact activity
--    row (communication_log) and — if the lead has an open deal — one deal_activities row are written,
--    each carrying message_id and operation_id, idempotently (unique on message_id), tenant-scoped,
--    text "handed to the email provider", never "delivered", never a sale, and no pipeline stage moves.
--    "A lead reply" = an approval citing the message (metadata.governed_send.message_id) whose
--    owner.lead_followup action points back at that approval, same business, same contact. The link
--    and the provider acceptance land in two different statements (finalize_comms_email_send, then
--    lead_reply_record_send[_service]) in either order, so a trigger on EACH side calls one helper;
--    whichever lands second writes, the unique index makes the other a no-op.
--
--    communication_log gains nullable tenant_id / contact_id / message_id / operation_id, and user_id
--    becomes nullable under a CHECK (a row names either a portal user or a business's contact). WHY:
--    the table keyed every row on clients.linked_user_id (a portal login), and on production 0 of 16
--    contacts have one (2026-10-13) — a new lead never does — so without this a lead's history row could
--    not exist at all. A SELECT policy lets an owner/admin of that business read its contact-keyed rows
--    (the messages_select shape). Existing rows and existing reads are unchanged.
--
-- §59 — every function is SECURITY DEFINER with a pinned search_path. The receipt applier is a
-- SERVICE-ONLY, DOOR-SCOPED exemption: no actor, reachable only through ingest_sendgrid_receipt
-- (service_role), keyed by a provider-verified event, and it returns no tenant data. The history helper
-- and the two trigger functions are granted to nobody (triggers only).
--
-- §37 PRODUCER INVENTORY — ingest_sendgrid_receipt (every caller):
--   * supabase/functions/handle-sendgrid-webhook/index.ts — named args; updated in this change to pass
--     the five new ones. If this migration lands BEFORE that function deploys, the old 5-named-arg call
--     resolves to the new function (defaults). If the function deploys first, PostgREST finds no
--     10-arg function, the RPC errors, the webhook answers 503 and SendGrid redelivers (24 h window) —
--     nothing is acknowledged unpersisted.
--   * supabase/tests/sendgrid_receipt_ingest.sql — positional 5-arg calls → unchanged results.
--   * src/solo/sendgrid-webhook-handler.test.ts — an in-memory RPC double; no database.
--   No trigger, cron, workflow, MCP tool or script calls it (grepped supabase/, src/, scripts/, .github/).
-- §37 — communication_log: every existing writer passes user_id (unchanged); every existing reader
--   selects by user_id = clients.linked_user_id, so it neither sees nor breaks on contact-keyed rows.
--
-- REVERSIBILITY: drop the two history triggers + helper, the applier, the policy, the CHECK, the four
-- communication_log columns (after re-setting user_id NOT NULL once no contact-keyed rows exist), the
-- journal columns and the deal_activities index; re-create the 5-arg ingest from 20271020000340.
-- Idempotent: replaying this file is a no-op. Paired proof: supabase/tests/paige_email_sendgrid_receipts.sql
-- ============================================================================

-- ── A1. The journal records what the event claimed and what it was correlated to. ─────────────────
ALTER TABLE public.sendgrid_receipt_processing
  ADD COLUMN IF NOT EXISTS tenant_claim          text,
  ADD COLUMN IF NOT EXISTS operation_claim       text,
  ADD COLUMN IF NOT EXISTS message_claim         text,
  ADD COLUMN IF NOT EXISTS bounce_type           text,
  ADD COLUMN IF NOT EXISTS provider_reason       text,
  ADD COLUMN IF NOT EXISTS correlation           text,
  ADD COLUMN IF NOT EXISTS correlation_reason    text,
  ADD COLUMN IF NOT EXISTS correlated_message_id uuid,
  ADD COLUMN IF NOT EXISTS delivery_effect       text;

ALTER TABLE public.sendgrid_receipt_processing DROP CONSTRAINT IF EXISTS sendgrid_receipt_processing_correlation_check;
ALTER TABLE public.sendgrid_receipt_processing ADD CONSTRAINT sendgrid_receipt_processing_correlation_check
  CHECK (correlation IS NULL OR correlation IN ('correlated', 'uncorrelated'));

COMMENT ON COLUMN public.sendgrid_receipt_processing.correlation IS
  'Experience 03: correlated = the event matched exactly one governed, provider-accepted SendGrid email (id, provider, tenant/operation claims, recipient); uncorrelated = it changed no message (correlation_reason says why). NULL on rows journalled before 20271031000200.';

-- ── A2. Provider reason, made safe to keep. ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._paige_email_safe_reason(_reason text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT nullif(left(btrim(regexp_replace(
           regexp_replace(left(coalesce(_reason, ''), 2000), '[^[:space:]<>(),;:"]+@[^[:space:]<>(),;:"]+', '[address]', 'g'),
           '[[:cntrl:]]+', ' ', 'g')), 200), '')
$$;
REVOKE ALL ON FUNCTION public._paige_email_safe_reason(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._paige_email_safe_reason(text) TO service_role;

-- ── A3. Apply one verified event to the governed message it is about. ──────────────────────────────
-- §59 service-only, door-scoped exemption (see header). Returns {correlation, reason, message_id, effect}.
CREATE OR REPLACE FUNCTION public._sendgrid_apply_governed_receipt(
  _sg_message_id text, _status text, _email text, _event_at timestamptz,
  _tenant_claim text, _operation_claim text, _message_claim text, _bounce_type text, _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _uuid     constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  m         public.messages%ROWTYPE;
  b         jsonb;
  incoming  text;
  cur       text;
  safe      text := public._paige_email_safe_reason(_reason);
  at        timestamptz := coalesce(_event_at, now());
  effect    text;
  nb        jsonb;
  new_status text;
  new_error  text;
  uncorr    text;
BEGIN
  SELECT * INTO m FROM public.messages WHERE provider_message_id = _sg_message_id FOR UPDATE;
  b := m.meta->'comms_email_binding';
  uncorr := CASE
    WHEN m.id IS NULL THEN 'no_message'
    WHEN b IS NULL THEN 'not_governed'
    WHEN m.channel_type IS DISTINCT FROM 'email' OR m.direction IS DISTINCT FROM 'outbound' THEN 'not_outbound_email'
    WHEN b->>'state' IS DISTINCT FROM 'provider_accepted' THEN 'not_provider_accepted'
    WHEN b->>'provider_message_id' IS DISTINCT FROM _sg_message_id THEN 'binding_id_mismatch'
    WHEN b->>'provider' IS DISTINCT FROM 'sendgrid' THEN 'provider_mismatch'
    WHEN _tenant_claim IS NOT NULL AND (_tenant_claim !~ _uuid OR lower(_tenant_claim) IS DISTINCT FROM m.tenant_id::text) THEN 'tenant_mismatch'
    WHEN _operation_claim IS NOT NULL AND (_operation_claim !~ _uuid OR lower(_operation_claim) IS DISTINCT FROM lower(b->>'operation_id')) THEN 'operation_mismatch'
    WHEN _message_claim IS NOT NULL AND (_message_claim !~ _uuid OR lower(_message_claim) IS DISTINCT FROM m.id::text) THEN 'message_mismatch'
    WHEN _email IS NOT NULL AND lower(btrim(_email)) IS DISTINCT FROM lower(b->>'recipient') THEN 'recipient_mismatch'
    ELSE NULL END;
  IF uncorr IS NOT NULL THEN
    RETURN jsonb_build_object('correlation', 'uncorrelated', 'reason', uncorr, 'message_id', NULL, 'effect', 'none');
  END IF;

  incoming := CASE _status
    WHEN 'delivered'        THEN 'delivered'
    WHEN 'delivery_delayed' THEN 'deferred'
    WHEN 'bounced'          THEN CASE WHEN lower(btrim(coalesce(_bounce_type, ''))) = 'blocked' THEN 'blocked' ELSE 'bounced' END
    WHEN 'dropped'          THEN 'dropped'
    WHEN 'complained'       THEN 'spam_reported'
    ELSE NULL END;  -- sent / opened / clicked: no delivery claim
  cur := b->>'delivery_state';
  nb := b; new_status := m.status; new_error := m.error;

  IF incoming IS NULL THEN
    effect := 'none';
  ELSIF incoming = 'deferred' THEN
    IF cur IS NULL OR cur = 'deferred' THEN
      nb := b || jsonb_build_object('delivery_state', 'deferred', 'delivery_reason', safe, 'delivery_event_at', at);
      effect := 'deferred';
    ELSE effect := 'stale_ignored'; END IF;
  ELSIF incoming = 'delivered' THEN
    IF cur IS NULL OR cur = 'deferred' THEN
      nb := b || jsonb_build_object('delivery_state', 'delivered', 'delivery_confirmed', true, 'delivered_at', at,
                                    'delivery_reason', NULL, 'delivery_event_at', at);
      new_status := 'delivered'; effect := 'delivered';
    ELSIF cur = 'spam_reported' AND coalesce((b->>'delivery_confirmed')::boolean, false) = false THEN
      -- The complaint already proved arrival; the delivered report confirms it. The state stays.
      nb := b || jsonb_build_object('delivery_confirmed', true, 'delivered_at', at);
      new_status := 'delivered'; effect := 'delivered_confirmed';
    ELSIF cur IN ('bounced', 'blocked', 'dropped') THEN
      nb := b || jsonb_build_object('delivery_late_event', jsonb_build_object('state', 'delivered', 'reason', NULL, 'event_at', at));
      effect := 'late_event_recorded';
    ELSE effect := 'stale_ignored'; END IF;
  ELSIF incoming IN ('bounced', 'blocked', 'dropped') THEN
    IF cur IS NULL OR cur = 'deferred' THEN
      nb := b || jsonb_build_object('delivery_state', incoming, 'delivery_reason', safe, 'delivery_event_at', at,
                                    'delivery_confirmed', false);
      new_status := 'failed';
      new_error := CASE incoming
        WHEN 'bounced' THEN 'Not delivered: the recipient''s email server returned this email.'
        WHEN 'blocked' THEN 'Not delivered: the recipient''s email server blocked this email.'
        ELSE 'Not delivered: PAIGE Email could not send to this address.' END;
      effect := incoming;
    ELSIF cur IN ('delivered', 'spam_reported') THEN
      nb := b || jsonb_build_object('delivery_late_event', jsonb_build_object('state', incoming, 'reason', safe, 'event_at', at));
      effect := 'late_event_recorded';
    ELSE effect := 'stale_ignored'; END IF;  -- the first terminal outcome wins
  ELSIF incoming = 'spam_reported' THEN
    IF cur IS NULL OR cur IN ('deferred', 'delivered') THEN
      nb := b || jsonb_build_object('delivery_state', 'spam_reported', 'delivery_event_at', at);
      effect := 'spam_reported';
    ELSIF cur IN ('bounced', 'blocked', 'dropped') THEN
      nb := b || jsonb_build_object('delivery_late_event', jsonb_build_object('state', 'spam_reported', 'reason', NULL, 'event_at', at));
      effect := 'late_event_recorded';
    ELSE effect := 'stale_ignored'; END IF;
  END IF;

  IF nb IS DISTINCT FROM b OR new_status IS DISTINCT FROM m.status THEN
    nb := nb || jsonb_build_object('delivery_updated_at', now());
    BEGIN
      UPDATE public.messages
         SET meta = jsonb_set(meta, '{comms_email_binding}', nb), status = new_status, error = new_error
       WHERE id = m.id;
    EXCEPTION WHEN insufficient_privilege THEN
      -- A row still reading 'sent' passes the provider-execution guard on every update; if this
      -- business's sending was switched off after the send, the guard refuses (42501). The event stays
      -- journalled and in email_send_log; the message keeps its last state, and the journal says so.
      RETURN jsonb_build_object('correlation', 'correlated', 'reason', NULL, 'message_id', m.id, 'effect', 'message_update_refused');
    END;
    -- The contact history row (written when the reply was handed over) follows a negative outcome.
    IF new_status = 'failed' AND m.status IS DISTINCT FROM 'failed' THEN
      UPDATE public.communication_log
         SET status = CASE WHEN incoming = 'dropped' THEN 'failed' ELSE 'bounced' END,
             error_message = new_error
       WHERE message_id = m.id;
    END IF;
  END IF;

  RETURN jsonb_build_object('correlation', 'correlated', 'reason', NULL, 'message_id', m.id, 'effect', effect);
END $$;
REVOKE ALL ON FUNCTION public._sendgrid_apply_governed_receipt(text, text, text, timestamptz, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sendgrid_apply_governed_receipt(text, text, text, timestamptz, text, text, text, text, text) TO service_role;

-- ── A4. ingest_sendgrid_receipt: same email_send_log behaviour, four optional arguments, one apply. ──
DROP FUNCTION IF EXISTS public.ingest_sendgrid_receipt(text, text, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.ingest_sendgrid_receipt(
  _receipt_id text, _message_id text, _status text,
  _email text DEFAULT NULL, _event_at timestamptz DEFAULT NULL,
  _tenant_id text DEFAULT NULL, _operation_id text DEFAULT NULL, _paige_message_id text DEFAULT NULL,
  _bounce_type text DEFAULT NULL, _reason text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.sendgrid_receipt_processing%ROWTYPE; fx jsonb;
BEGIN
  IF _receipt_id IS NULL OR _receipt_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
     OR _message_id IS NULL OR _message_id !~ '^[A-Za-z0-9_.:-]{1,200}$'
     OR _status IS NULL OR _status NOT IN
       ('sent','delivered','delivery_delayed','opened','clicked','bounced','complained','dropped')
     OR (_email IS NOT NULL AND (_email !~ '^[^@\s]{1,64}@[^@\s]{1,255}$' OR length(_email) > 320))
     OR (_event_at IS NOT NULL AND NOT isfinite(_event_at)) THEN RETURN 'invalid'; END IF;

  INSERT INTO public.sendgrid_receipt_processing(receipt_id,message_id,status,email,event_at,
      tenant_claim,operation_claim,message_claim,bounce_type,provider_reason)
  VALUES (_receipt_id,_message_id,_status,lower(btrim(_email)),_event_at,
      left(_tenant_id,64),left(_operation_id,64),left(_paige_message_id,64),left(lower(btrim(_bounce_type)),32),public._paige_email_safe_reason(_reason))
  ON CONFLICT (receipt_id) DO NOTHING;
  SELECT * INTO r FROM public.sendgrid_receipt_processing WHERE receipt_id = _receipt_id FOR UPDATE;
  IF r.message_id IS DISTINCT FROM _message_id OR r.status IS DISTINCT FROM _status
     OR r.email IS DISTINCT FROM lower(btrim(_email)) THEN RETURN 'duplicate'; END IF;
  IF r.state = 'processed' THEN RETURN 'duplicate'; END IF;

  -- The append (unchanged): one row per verified event; the send path's own 'sent' row absorbed.
  BEGIN
    INSERT INTO public.email_send_log
      (message_id, template_name, recipient_email, status, sender_account, metadata, created_at)
    VALUES
      (r.message_id, 'sendgrid_event', COALESCE(r.email, 'unknown'), r.status, 'sendgrid',
       jsonb_build_object('provider','sendgrid','receipt_id',r.receipt_id,'event_at',r.event_at),
       COALESCE(r.event_at, r.received_at));
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- the send path already recorded this fact; nothing to append
  END;

  -- The governed message, from the JOURNALLED claims (the first delivery of this identity wins).
  fx := public._sendgrid_apply_governed_receipt(r.message_id, r.status, r.email, r.event_at,
          r.tenant_claim, r.operation_claim, r.message_claim, r.bounce_type, r.provider_reason);

  UPDATE public.sendgrid_receipt_processing
     SET state = 'processed', attempts = attempts + 1,
         correlation = fx->>'correlation', correlation_reason = fx->>'reason',
         correlated_message_id = (fx->>'message_id')::uuid, delivery_effect = fx->>'effect'
   WHERE receipt_id = r.receipt_id;
  RETURN 'processed';
EXCEPTION WHEN OTHERS THEN
  RETURN 'pending';
END $function$;

REVOKE ALL ON FUNCTION public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text) TO service_role;

-- ── B1. communication_log can name a business's contact, not only a portal user. ────────────────────
ALTER TABLE public.communication_log
  ADD COLUMN IF NOT EXISTS tenant_id    uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS contact_id   uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS message_id   uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS operation_id uuid;
ALTER TABLE public.communication_log ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.communication_log DROP CONSTRAINT IF EXISTS communication_log_subject_check;
ALTER TABLE public.communication_log ADD CONSTRAINT communication_log_subject_check
  CHECK (user_id IS NOT NULL OR (tenant_id IS NOT NULL AND contact_id IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_communication_log_message
  ON public.communication_log (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_communication_log_contact
  ON public.communication_log (tenant_id, contact_id, created_at DESC) WHERE contact_id IS NOT NULL;

DROP POLICY IF EXISTS communication_log_tenant_contact_read ON public.communication_log;
CREATE POLICY communication_log_tenant_contact_read ON public.communication_log
  FOR SELECT TO authenticated
  USING (contact_id IS NOT NULL AND tenant_id IS NOT NULL
         AND (public.is_platform_owner()
              OR (tenant_id = public.current_user_tenant_id() AND public.is_tenant_admin(tenant_id))));

COMMENT ON COLUMN public.communication_log.contact_id IS
  'Experience 03: the business contact this row is about, for a contact with no portal login (user_id NULL). Written with tenant_id; read by an owner/admin of that business.';

-- One deal-history row per governed message.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deal_activities_lead_reply_message
  ON public.deal_activities ((payload->>'message_id')) WHERE type = 'lead_reply_email';

-- ── B2. The history writer. ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._paige_email_record_lead_reply_history(_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  m     public.messages%ROWTYPE;
  b     jsonb;
  ap_id uuid;
  act_id uuid;
  deal  uuid;
  linked uuid;
  op    uuid;
BEGIN
  IF _message_id IS NULL THEN RETURN; END IF;
  SELECT * INTO m FROM public.messages WHERE id = _message_id;
  b := m.meta->'comms_email_binding';
  IF m.id IS NULL OR b IS NULL OR b->>'state' IS DISTINCT FROM 'provider_accepted'
     OR m.channel_type IS DISTINCT FROM 'email' OR m.direction IS DISTINCT FROM 'outbound'
     OR m.tenant_id IS NULL OR m.contact_id IS NULL OR coalesce(b->>'operation_id', '') !~ _uuid THEN
    RETURN;
  END IF;
  op := (b->>'operation_id')::uuid;

  -- A lead reply: an approval of this business citing this message AND this operation, whose
  -- owner.lead_followup action points back at it and is about the same contact.
  SELECT a.id, act.id INTO ap_id, act_id
    FROM public.paige_pending_approvals a
    JOIN public.paige_actions act
      ON act.approval_id = a.id AND act.tenant_id = a.tenant_id
     AND act.id::text = lower(btrim(a.metadata->>'action_id'))
   WHERE a.tenant_id = m.tenant_id
     AND lower(a.metadata#>>'{governed_send,message_id}') = m.id::text
     AND lower(a.metadata#>>'{governed_send,operation_id}') = op::text
     AND a.status IN ('pending', 'approved', 'sent')
     AND act.action_kind = 'owner.lead_followup'
     AND act.contact_id = m.contact_id
   ORDER BY a.created_at
   LIMIT 1;
  IF ap_id IS NULL THEN RETURN; END IF;

  SELECT c.linked_user_id INTO linked FROM public.clients c WHERE c.id = m.contact_id AND c.tenant_id = m.tenant_id;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.communication_log
    (user_id, tenant_id, contact_id, message_id, operation_id, channel, message_type, subject, preview, status, created_at)
  VALUES
    (linked, m.tenant_id, m.contact_id, m.id, op, 'email', 'lead_reply', m.subject,
     'Your reply was handed to the email provider. Delivery is not confirmed yet.', 'sent', coalesce(m.sent_at, now()))
  ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING;

  SELECT d.id INTO deal FROM public.deals d
   WHERE d.tenant_id = m.tenant_id AND d.contact_client_id = m.contact_id AND d.status = 'open'
   ORDER BY d.updated_at DESC, d.id
   LIMIT 1;
  IF deal IS NOT NULL THEN
    INSERT INTO public.deal_activities (deal_id, type, summary, actor_user_id, payload, created_at)
    VALUES (deal, 'lead_reply_email', 'Reply email handed to the email provider (delivery not confirmed yet)',
            CASE WHEN coalesce(b->>'actor_user_id', '') ~ _uuid THEN (b->>'actor_user_id')::uuid END,
            jsonb_build_object('message_id', m.id, 'operation_id', op, 'contact_id', m.contact_id,
                               'approval_id', ap_id, 'action_id', act_id, 'delivery_confirmed', false),
            coalesce(m.sent_at, now()))
    ON CONFLICT ((payload->>'message_id')) WHERE type = 'lead_reply_email' DO NOTHING;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._paige_email_record_lead_reply_history(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Side 1: the message reaches provider_accepted (finalize_comms_email_send).
CREATE OR REPLACE FUNCTION public._paige_email_history_on_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.meta#>>'{comms_email_binding,state}' = 'provider_accepted'
     AND OLD.meta#>>'{comms_email_binding,state}' IS DISTINCT FROM 'provider_accepted' THEN
    PERFORM public._paige_email_record_lead_reply_history(NEW.id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._paige_email_history_on_message() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_paige_email_history_on_message ON public.messages;
CREATE TRIGGER trg_paige_email_history_on_message
  AFTER UPDATE OF meta ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public._paige_email_history_on_message();

-- Side 2: the reply's approval comes to cite the message (lead_reply_record_send[_service]).
CREATE OR REPLACE FUNCTION public._paige_email_history_on_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE _id text := lower(btrim(NEW.metadata#>>'{governed_send,message_id}'));
BEGIN
  IF _id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND (TG_OP = 'INSERT' OR NEW.metadata->'governed_send' IS DISTINCT FROM OLD.metadata->'governed_send'
          OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public._paige_email_record_lead_reply_history(_id::uuid);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._paige_email_history_on_approval() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_paige_email_history_on_approval ON public.paige_pending_approvals;
CREATE TRIGGER trg_paige_email_history_on_approval
  AFTER INSERT OR UPDATE OF metadata, status ON public.paige_pending_approvals
  FOR EACH ROW EXECUTE FUNCTION public._paige_email_history_on_approval();
