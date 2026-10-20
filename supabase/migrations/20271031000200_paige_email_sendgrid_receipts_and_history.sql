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
--      * the event carries ALL THREE custom_args send-message sets on every governed SendGrid send
--        (paige_tenant_id / paige_operation_id / paige_message_id) and they equal the message's tenant /
--        the binding's operation / the message id. An absent claim is a non-match (claims_missing); a
--        forged, cross-tenant or malformed one is refused, never "best-effort";
--      * when the event carries the recipient address, it equals the binding's recipient.
--
--    SETTLE (a send whose outcome the door could not read). SendGrid has no idempotent replay and no
--    per-message status read, so a send finalized 'unknown' — or claimed 'dispatching' and never
--    finalized — has no stored X-Message-Id and would otherwise stay unresolved for ever (the
--    identical-content guard refuses it, the reply approval can never record it). When NO message carries
--    the event's id, the event may settle such a send only if all three claims name it exactly AND the
--    event's address equals the binding's recipient (required here, not optional). A SendGrid event for
--    it is the provider's own statement that it accepted the send, so the binding becomes
--    provider_accepted with that id (outcome_reason 'settled_by_provider_event', settled_from_state),
--    messages.status 'sent' — never delivered — and the event is then applied like any other.
--    A send that no event ever settles (SendGrid never received the request, or no event arrives) stays
--    'unknown' and is never re-sent; a lead reply behind it stays at COMMS_EMAIL_APPROVAL_SEND_IN_PROGRESS,
--    and the owner can only decline that reply. No screen exists yet for a person to review or resolve
--    such a send (tracked in master §5, Experience 03 S3).
--
--    EARLY EVENTS. An event whose three claims (and recipient) name a governed SendGrid send that is
--    still 'prepared' (younger than 24 h) or 'dispatching' (claimed less than 15 minutes ago — the
--    provider call times out at 20 s) is NOT journalled: ingest returns 'pending', the webhook answers
--    503 and SendGrid redelivers, by which time finalize has stored the id. Bounded: a 'prepared' send
--    older than 24 h is journalled uncorrelated (not_dispatched); a 'dispatching' send older than 15
--    minutes is treated as never finalized and settled as above.
--
--    A failure inside the message step does not lose the event: ingest contains it in its own
--    sub-transaction, keeps the email_send_log row and journals it processed with
--    correlation='apply_failed' and the SQLSTATE.
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
--    "A lead reply" = the approval the door prepared the send FOR (comms_email_binding.approval_id,
--    20271031000100), citing the message (metadata.governed_send.message_id + operation_id), still
--    pending/approved/sent, whose owner.lead_followup action points back at it — same business, same
--    contact. The link
--    and the provider acceptance land in two different statements (finalize_comms_email_send, then
--    lead_reply_record_send[_service]) in either order, so a trigger on EACH side calls one helper;
--    whichever lands second writes, the unique index makes the other a no-op.
--
--    communication_log gains nullable tenant_id / contact_id / message_id / operation_id, and user_id
--    becomes nullable under a CHECK (a row names either a portal user or a business's contact). WHY:
--    the table keyed every row on clients.linked_user_id (a portal login), and on production 0 of 16
--    contacts have one (2026-10-13) — a new lead never does — so without this a lead's history row could
--    not exist at all. History rows set user_id NULL even when the contact has a portal login (owner
--    wording, not for the client). A SELECT policy lets an owner/admin of that business read its
--    contact-keyed rows (the messages_select shape). Existing rows and existing reads are unchanged.
--
-- §59 — every function is SECURITY DEFINER with a pinned search_path. ingest_sendgrid_receipt is the ONE
-- door: EXECUTE to service_role only, and its body refuses any caller carrying a signed-in subject
-- (auth.uid() not null). It returns a status word, never tenant data. The receipt applier is granted to
-- NOBODY — service_role included — so it runs only from inside ingest, keyed by a provider-verified
-- event. The history helper and the two trigger functions are granted to nobody (triggers only).
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
-- §37 — communication_log.user_id becomes NULLABLE (production: NOT NULL until this migration). Every
--   reader, by file:
--   * src/components/admin/pipeline/DealDrawer.tsx:79, src/pages/admin/ClientJourney.tsx:183,
--     src/pages/admin/ContactDetail.tsx:139, supabase/functions/paige-ai-chat (crm_get_contact_summary),
--     supabase/functions/paige-mcp list_communication_log, supabase/functions/send-beta-launch-email
--     (dedupe) — all filter user_id = <a value> / IN (...), so a NULL row is never returned to them.
--   * src/pages/admin/CommunicationsAdmin.tsx:79/:84 read EVERY row the caller may see (no user_id
--     filter) and printed row.user_id.slice(0, 8): that page now guards a NULL user_id (it is not
--     mounted by any route today, but it must not crash if it is).
--   * RLS "Admins can view all comm log" (tenant_staff_owns_user(auth.uid(), user_id)) and "Users can
--     view own comm log" (auth.uid() = user_id) never match a NULL user_id except for a super admin.
--   * src/integrations/supabase/types.ts: user_id is string | null and the four new columns are typed.
--   Every existing writer passes user_id (unchanged). The new history rows ALWAYS write user_id NULL —
--   their wording is for the owner, and the client's own-row policy would otherwise show it to them.
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
  CHECK (correlation IS NULL OR correlation IN ('correlated', 'uncorrelated', 'apply_failed'));

COMMENT ON COLUMN public.sendgrid_receipt_processing.correlation IS
  'Experience 03: correlated = the event matched exactly one governed SendGrid email (provider id, or for a send whose outcome was unknown all three custom_args claims + the recipient; correlation_reason settled_by_provider_event then); uncorrelated = it changed no message (correlation_reason says why); apply_failed = the message step raised (correlation_reason carries the SQLSTATE) and the event is kept, not retried. NULL on rows journalled before 20271031000200.';

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
-- §59: reachable ONLY through ingest_sendgrid_receipt — no grant to any API role, service_role included,
-- so no service-role code can mark an email delivered without a signed event passing the ingest door.
-- Returns {correlation, reason, message_id, effect}; correlation is 'correlated', 'uncorrelated', or
-- 'pending' (the send the event names is still being handed over — the caller must not acknowledge it).
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
  claims_ok boolean := coalesce(_tenant_claim ~ _uuid AND _operation_claim ~ _uuid AND _message_claim ~ _uuid, false);
  settled   boolean := false;
BEGIN
  SELECT * INTO m FROM public.messages WHERE provider_message_id = _sg_message_id FOR UPDATE;

  -- SETTLE PATH. No message carries this provider id: a SendGrid send whose outcome the door could not
  -- read (finalize 'unknown', or a dispatch that never finalized) has no X-Message-Id stored. The event
  -- may settle it ONLY when all three claims send-message attached (paige_tenant_id, paige_operation_id,
  -- paige_message_id) name it exactly AND the event's address is the binding's recipient. A SendGrid
  -- event for that send is the provider's own statement that it accepted it, so the binding becomes
  -- provider_accepted with that id — and then the event is applied exactly like any other.
  IF m.id IS NULL AND claims_ok THEN
    SELECT * INTO m FROM public.messages WHERE id = lower(_message_claim)::uuid FOR UPDATE;
    b := m.meta->'comms_email_binding';
    uncorr := CASE
      WHEN m.id IS NULL THEN 'no_message'
      WHEN b IS NULL THEN 'not_governed'
      WHEN m.channel_type IS DISTINCT FROM 'email' OR m.direction IS DISTINCT FROM 'outbound' THEN 'not_outbound_email'
      WHEN b->>'provider' IS DISTINCT FROM 'sendgrid' THEN 'provider_mismatch'
      WHEN lower(_tenant_claim) IS DISTINCT FROM m.tenant_id::text THEN 'tenant_mismatch'
      WHEN lower(_operation_claim) IS DISTINCT FROM lower(b->>'operation_id') THEN 'operation_mismatch'
      WHEN _email IS NULL OR lower(btrim(_email)) IS DISTINCT FROM lower(b->>'recipient') THEN 'recipient_mismatch'
      ELSE NULL END;
    IF uncorr IS NOT NULL THEN
      RETURN jsonb_build_object('correlation', 'uncorrelated', 'reason', uncorr, 'message_id', NULL, 'effect', 'none');
    END IF;
    IF m.provider_message_id IS NOT DISTINCT FROM _sg_message_id THEN
      NULL;  -- a concurrent event for this send settled it while this one waited on the row lock: apply below
    ELSIF m.provider_message_id IS NOT NULL OR b->>'provider_message_id' IS NOT NULL THEN
      RETURN jsonb_build_object('correlation', 'uncorrelated', 'reason', 'binding_id_mismatch', 'message_id', NULL, 'effect', 'none');
    ELSIF b->>'state' = 'prepared' THEN
      -- Nothing was handed over yet. An event can only be early here; retry it for a day, then let it go.
      IF coalesce((b->>'prepared_at')::timestamptz, m.created_at) > now() - interval '24 hours' THEN
        RETURN jsonb_build_object('correlation', 'pending', 'reason', 'awaiting_dispatch', 'message_id', m.id, 'effect', 'none');
      END IF;
      RETURN jsonb_build_object('correlation', 'uncorrelated', 'reason', 'not_dispatched', 'message_id', NULL, 'effect', 'none');
    ELSIF b->>'state' = 'dispatching'
          AND coalesce((b->>'claimed_at')::timestamptz, (b->>'prepared_at')::timestamptz, m.created_at) > now() - interval '15 minutes' THEN
      -- The door is still inside its 20-second provider call or about to finalize: let finalize record
      -- the X-Message-Id itself; the redelivered event then correlates by id.
      RETURN jsonb_build_object('correlation', 'pending', 'reason', 'awaiting_finalize', 'message_id', m.id, 'effect', 'none');
    ELSIF b->>'state' IN ('dispatching', 'unknown') THEN
      nb := b || jsonb_build_object('state', 'provider_accepted', 'provider_message_id', _sg_message_id,
                                    'finalized_at', now(), 'outcome_reason', 'settled_by_provider_event',
                                    'settled_from_state', b->>'state');
      BEGIN
        UPDATE public.messages
           SET meta = jsonb_set(meta, '{comms_email_binding}', nb), status = 'sent',
               provider_message_id = _sg_message_id, sent_at = coalesce(sent_at, at), error = NULL
         WHERE id = m.id;
      EXCEPTION WHEN insufficient_privilege THEN
        -- This business's sending was switched off after the send: the guard refuses a 'sent' row. The
        -- event stays journalled; the send keeps its unresolved state, and the journal says why.
        RETURN jsonb_build_object('correlation', 'correlated', 'reason', 'settle_refused', 'message_id', m.id, 'effect', 'message_update_refused');
      END;
      SELECT * INTO m FROM public.messages WHERE id = m.id;
      settled := true;
    ELSE
      RETURN jsonb_build_object('correlation', 'uncorrelated', 'reason', 'not_provider_accepted', 'message_id', NULL, 'effect', 'none');
    END IF;
  END IF;

  b := m.meta->'comms_email_binding';
  uncorr := CASE
    WHEN m.id IS NULL THEN 'no_message'
    WHEN b IS NULL THEN 'not_governed'
    WHEN m.channel_type IS DISTINCT FROM 'email' OR m.direction IS DISTINCT FROM 'outbound' THEN 'not_outbound_email'
    WHEN b->>'state' IS DISTINCT FROM 'provider_accepted' THEN 'not_provider_accepted'
    WHEN b->>'provider_message_id' IS DISTINCT FROM _sg_message_id THEN 'binding_id_mismatch'
    WHEN b->>'provider' IS DISTINCT FROM 'sendgrid' THEN 'provider_mismatch'
    -- Every governed SendGrid send carries all three claims; an event without them is not about it.
    WHEN _tenant_claim IS NULL OR _operation_claim IS NULL OR _message_claim IS NULL THEN 'claims_missing'
    WHEN _tenant_claim !~ _uuid OR lower(_tenant_claim) IS DISTINCT FROM m.tenant_id::text THEN 'tenant_mismatch'
    WHEN _operation_claim !~ _uuid OR lower(_operation_claim) IS DISTINCT FROM lower(b->>'operation_id') THEN 'operation_mismatch'
    WHEN _message_claim !~ _uuid OR lower(_message_claim) IS DISTINCT FROM m.id::text THEN 'message_mismatch'
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

  RETURN jsonb_build_object('correlation', 'correlated', 'reason', CASE WHEN settled THEN 'settled_by_provider_event' END,
                            'message_id', m.id, 'effect', effect);
END $$;
REVOKE ALL ON FUNCTION public._sendgrid_apply_governed_receipt(text, text, text, timestamptz, text, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── A4. ingest_sendgrid_receipt: same email_send_log behaviour, five optional arguments, one apply. ──
DROP FUNCTION IF EXISTS public.ingest_sendgrid_receipt(text, text, text, text, timestamptz);

-- §59: SECURITY DEFINER so it alone can reach the applier; granted to service_role only, and the body
-- refuses any caller carrying a signed-in subject. It returns a status word, never tenant data.
CREATE OR REPLACE FUNCTION public.ingest_sendgrid_receipt(
  _receipt_id text, _message_id text, _status text,
  _email text DEFAULT NULL, _event_at timestamptz DEFAULT NULL,
  _tenant_id text DEFAULT NULL, _operation_id text DEFAULT NULL, _paige_message_id text DEFAULT NULL,
  _bounce_type text DEFAULT NULL, _reason text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE r public.sendgrid_receipt_processing%ROWTYPE; fx jsonb;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'SENDGRID_RECEIPT_FORBIDDEN: receipts are ingested by the signed webhook only' USING ERRCODE = '42501';
  END IF;
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

    -- The governed message, from the JOURNALLED claims (the first delivery of this identity wins). A
    -- failure INSIDE the applier is contained: the event stays journalled and in email_send_log, marked
    -- apply_failed with its SQLSTATE, instead of failing every redelivery until SendGrid gives up.
    BEGIN
      fx := public._sendgrid_apply_governed_receipt(r.message_id, r.status, r.email, r.event_at,
              r.tenant_claim, r.operation_claim, r.message_claim, r.bounce_type, r.provider_reason);
    EXCEPTION WHEN OTHERS THEN
      fx := jsonb_build_object('correlation', 'apply_failed', 'reason', 'apply_failed_' || lower(SQLSTATE),
                               'message_id', NULL, 'effect', 'apply_failed');
    END;
    -- Early: the named send is still being handed over. Undo this attempt entirely (journal and append)
    -- so the webhook answers 503 and SendGrid redelivers; the applier bounds how long that lasts.
    IF fx->>'correlation' = 'pending' THEN
      RAISE EXCEPTION 'SENDGRID_RECEIPT_EARLY' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.sendgrid_receipt_processing
       SET state = 'processed', attempts = attempts + 1,
           correlation = fx->>'correlation', correlation_reason = fx->>'reason',
           correlated_message_id = (fx->>'message_id')::uuid, delivery_effect = fx->>'effect'
     WHERE receipt_id = r.receipt_id;
    RETURN 'processed';
  EXCEPTION WHEN OTHERS THEN
    RETURN 'pending';
  END;
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

  -- A lead reply: an approval of this business citing this message AND this operation, which the door
  -- prepared this send FOR (binding.approval_id, 20271031000100 — so an approval whose metadata was
  -- pointed at some other accepted email to the lead never earns "Your reply was handed…"), whose
  -- owner.lead_followup action points back at it and is about the same contact.
  IF coalesce(lower(btrim(b->>'approval_id')), '') !~ _uuid THEN RETURN; END IF;
  SELECT a.id, act.id INTO ap_id, act_id
    FROM public.paige_pending_approvals a
    JOIN public.paige_actions act
      ON act.approval_id = a.id AND act.tenant_id = a.tenant_id
     AND act.id::text = lower(btrim(a.metadata->>'action_id'))
   WHERE a.id = lower(btrim(b->>'approval_id'))::uuid
     AND a.tenant_id = m.tenant_id
     AND lower(a.metadata#>>'{governed_send,message_id}') = m.id::text
     AND lower(a.metadata#>>'{governed_send,operation_id}') = op::text
     AND a.status IN ('pending', 'approved', 'sent')
     AND act.action_kind = 'owner.lead_followup'
     AND act.contact_id = m.contact_id
   ORDER BY a.created_at
   LIMIT 1;
  IF ap_id IS NULL THEN RETURN; END IF;

  PERFORM 1 FROM public.clients c WHERE c.id = m.contact_id AND c.tenant_id = m.tenant_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- user_id stays NULL even when the contact has a portal login: this row's wording is written for the
  -- OWNER ("Your reply was handed…"), and "Users can view own comm log" would show it to the client.
  -- The business reads it through communication_log_tenant_contact_read (tenant_id + contact_id).
  INSERT INTO public.communication_log
    (user_id, tenant_id, contact_id, message_id, operation_id, channel, message_type, subject, preview, status, created_at)
  VALUES
    (NULL, m.tenant_id, m.contact_id, m.id, op, 'email', 'lead_reply', m.subject,
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
