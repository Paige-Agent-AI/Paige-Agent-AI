-- ============================================================================
-- Experience 03 — a governed business email that proves an address cannot receive puts that address on
-- THIS business's do-not-send list.
--
-- What happened on production (2026-10-28, read-only queries): two governed one-to-one emails (the
-- comms-email-command door; rows in public.messages carrying meta.comms_email_binding) went from two
-- different Solo businesses to the same address. The first came back as a hard bounce ("552 … mailbox not
-- found"); the second was dropped by SendGrid with reason "Bounced Address", because SendGrid keeps ONE
-- bounce list for the whole PAIGE account. Both rows became 'failed' — and NEITHER wrote a
-- paige_suppressions row, so the pre-send check (supabase/functions/_shared/pre-send-pipeline.ts step 2,
-- which reads paige_suppressions and answers blocked_suppressed) could not warn before the next attempt.
-- The campaign applier in the same webhook (_sendgrid_apply_campaign_receipt, 20271116200000) already
-- suppresses on a hard bounce or a complaint; the governed-reply applier never did.
--
-- This file replaces _sendgrid_apply_governed_receipt. Its body is VERBATIM 20271116200000 (the latest
-- definition; its pg_get_functiondef md5 161f627fc5ce018b147fdde3d9e25a54 was read from production and
-- matches the repository's body), plus exactly these additions:
--
--  1. Suppression. When a correlated event proves the address cannot receive, or the person complained,
--     a row is written for the email's business:
--       bounce_hard: (tenant_id, NULL, _comms_normalize_address('email', recipient), 'email', 'bounce_hard', 'webhook')
--       complaint:   (tenant_id, contact or NULL, NULL or the normalised address, 'email', 'complaint', 'webhook')
--     ON CONFLICT DO NOTHING. Keys (review M2): a dead address is a fact about the ADDRESS, so bounce_hard
--     is keyed on the canonical normalised address (the writer normaliser pre-send's normalizeEmail mirrors:
--     lower-cased, +tag folded) with NO contact — a contact-keyed row would hold every address the contact
--     has, and correcting a mistyped address would not lift it. A complaint is the PERSON's answer, so it is
--     keyed on the message's own contact (only when that contact belongs to the message's business), else
--     on the normalised address. (The campaign applier still contact-keys its bounces; not changed here.)
--     "Proves it cannot receive" is:
--       · a bounce that is not 'blocked' — the campaign path's own definition of hard
--         (`lower(btrim(coalesce(_bounce_type,''))) <> 'blocked'`, which this applier already maps to
--         delivery state 'bounced'); a 'blocked' bounce is the receiving server refusing THIS email, not
--         proof the address is dead, so it suppresses nobody, as in campaigns;
--       · a drop whose provider reason is "Bounced Address" (the address bounced before) or "Invalid"
--         (SendGrid judged the address itself invalid). Other drop reasons (unsubscribed, spam content,
--         invalid header, quota …) are not about the address being dead and suppress nobody;
--     and a complaint ('complained' → spam_reported) suppresses as 'complaint'. A delayed delivery
--     (SendGrid's soft outcome) never suppresses. The suppression is written for every correlated event
--     that carries such a fact, even when the email's own state does not move (a late or repeated report):
--     the person's server or the person said it, exactly as the campaign path treats every correlated hard
--     bounce and complaint. A replay adds nothing (ON CONFLICT DO NOTHING on the existing unique index).
--     The write runs AFTER the email's own outcome is written and is contained in its own block: if it is
--     ever refused, that outcome is still recorded, a WARNING names the SQLSTATE, and the journalled effect
--     gains '_suppression_failed' (including after a refused message update, which now answers
--     'message_update_refused_suppression_failed' instead of returning before the suppression step), so the
--     failure is visible in sendgrid_receipt_processing.delivery_effect instead of silent. On success the
--     returned effect is unchanged, so every reader of delivery_effect keeps its values.
--  2. Clearer words. A drop because the address bounced before now says
--     "Not sent: this address bounced before, so the email service is holding it. Check the address."
--     (messages.error and the follow-up communication_log.error_message). Every other text is unchanged.
--
-- TENANT SCOPE (§9). A suppression is one business's fact. The row is written under the message's tenant:
-- set_contact_scoped_tenant takes the tenant from the contact when there is one (a complaint's contact is
-- used only when it belongs to the message's business), and otherwise — no contact, no signed-in session
-- inside the webhook — keeps the explicit tenant_id this function supplies, so the row can never land under
-- another business. Nothing here blocks the address for any other business. NOT built,
-- deliberately: SendGrid's bounce list is account-wide, so once ANY PAIGE business's email to an address
-- bounces, SendGrid drops every other business's email to it ("Bounced Address") — that cross-business
-- effect exists at the provider, is not created by this file, and is an owner decision (see the decision
-- log entry of this change). This file only makes the second business's drop say what happened and stop
-- the next attempt for that business.
--
-- SAFE TO APPLY ON PRODUCTION. One CREATE OR REPLACE FUNCTION with the same signature, return type,
-- language, volatility, SECURITY DEFINER-ness and search_path, plus the same REVOKE it had. No table,
-- column, index, policy, trigger or row is created, altered or rewritten, so no table lock is taken
-- (CREATE OR REPLACE FUNCTION locks only the pg_proc row; the NOWAIT pattern of #3016 is for table DDL).
-- Idempotent: applying it twice is a no-op. Existing failed rows are NOT back-filled with suppressions —
-- a data write to production is not this file's to make (§13; see the decision log).
--
-- §59: stays SECURITY DEFINER with a pinned search_path and granted to NOBODY, service_role included; it
-- runs only inside ingest_sendgrid_receipt (service_role only, refuses auth.uid() in its body). The
-- paige_suppressions write runs as the function owner with auth.uid() NULL, so the ledger write guard
-- admits source 'webhook' and reasons bounce_hard / complaint exactly as it does for the campaign applier.
--
-- §37 PRODUCER / CONSUMER INVENTORY (grepped supabase/migrations, supabase/functions, supabase/tests,
-- scripts, .github, src)
--   _sendgrid_apply_governed_receipt(...) -> jsonb (same ABI; same keys; 'effect' unchanged on success):
--     · one caller, ingest_sendgrid_receipt (20271116020000, unchanged): reads correlation / reason /
--       message_id / effect into sendgrid_receipt_processing. The only new effect value,
--       '<effect>_suppression_failed', appears only when the suppression write itself fails.
--     · its producer, handle-sendgrid-webhook/index.ts, passes `reason` for bounce and dropped events
--       (receiptDetail): a drop's SendGrid reason ("Bounced Address", "Invalid", …) arrives as _reason,
--       already passed through _paige_email_safe_reason by ingest.
--     · readers of delivery_effect: supabase/tests/paige_email_sendgrid_receipts.sql (asserts effects of
--       bounce / dropped / stale events; none changes) — it now replays this file after 20271116200000.
--   paige_suppressions (new writer of reasons bounce_hard / complaint, source webhook):
--     · readers: pre-send-pipeline.ts step 2 (tenant + channel + contact_id-or-address → blocked_suppressed;
--       the governed door's readiness maps it to BLOCKED_SUPPRESSED, whose words already read "They
--       unsubscribed or this address bounced" in src/pages/admin/conversations/governedReply.ts and
--       governedSend.ts — unchanged); campaign plan/dispatch suppression re-checks; the customer-portal
--       consent reads (bounce_hard → EMAIL_UNDELIVERABLE); set_contact_channel_suppression's lift (deletes
--       only rows keyed on that contact — an address-keyed bounce is NOT lifted by the Conversations "Do not
--       contact" switch; a wrongly held address has no product clear yet, owner decision in the decision log);
--       the Conversations inbox (src/pages/admin/ClientsConversations.tsx) and contact rail
--       (src/pages/admin/conversations/ContactCardRail.tsx), which read the contact's rows by contact_id and
--       said "opted out" for every reason — changed in the same change set to read the reason (a bounce says
--       the address bounced, a complaint says they marked it as spam) and to also read this business's
--       address-keyed rows for the contact's current main email.
--     · proofs: supabase/tests/exp03_governed_bounce_suppression.sql (new, this file's own proof);
--       supabase/tests/exp03_resend_retired.sql §1b (its governed hard bounce now suppresses contact A's
--       address — asserted there, then removed as a stated fixture step so its campaign sections keep A).
-- ============================================================================

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
  drop_why  text;     -- 20271120120003: a drop's provider reason, normalised for comparison
  supp_why  text;     -- 20271120120003: 'bounce_hard' | 'complaint' | NULL
  supp_who  uuid;     -- 20271120120003: a complaint's contact, when it belongs to the message's business
  supp_failed boolean := false;  -- 20271120120003: the suppression write was refused
  refused   boolean := false;    -- the message update was refused (42501); answered after the suppression step
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
      WHEN b->>'provider' IS NULL OR b->>'provider' NOT IN ('sendgrid', 'resend') THEN 'provider_mismatch'
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
    WHEN b->>'provider' IS NULL OR b->>'provider' NOT IN ('sendgrid', 'resend') THEN 'provider_mismatch'
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

  -- 20271120120003: does this event prove the address cannot receive, or that the person complained?
  -- 'bounced' here is exactly the campaign path's hard bounce (any bounce type but 'blocked').
  drop_why := CASE WHEN incoming = 'dropped' THEN lower(btrim(coalesce(safe, ''))) END;
  supp_why := CASE
    WHEN incoming = 'bounced' THEN 'bounce_hard'
    WHEN incoming = 'dropped' AND drop_why IN ('bounced address', 'invalid') THEN 'bounce_hard'
    WHEN incoming = 'spam_reported' THEN 'complaint'
    ELSE NULL END;

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
      new_error := CASE
        WHEN incoming = 'bounced' THEN 'Not delivered: the recipient''s email server returned this email.'
        WHEN incoming = 'blocked' THEN 'Not delivered: the recipient''s email server blocked this email.'
        -- 20271120120003: SendGrid holds an address that bounced before (for any PAIGE business): say so.
        WHEN drop_why = 'bounced address' THEN 'Not sent: this address bounced before, so the email service is holding it. Check the address.'
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
      -- 20271120120003: answered below, after the suppression step, so that answer carries its outcome too.
      refused := true;
    END;
    -- The contact history row (written when the reply was handed over) follows a negative outcome.
    IF NOT refused AND new_status = 'failed' AND m.status IS DISTINCT FROM 'failed' THEN
      UPDATE public.communication_log
         SET status = CASE WHEN incoming = 'dropped' THEN 'failed' ELSE 'bounced' END,
             error_message = new_error
       WHERE message_id = m.id;
    END IF;
  END IF;

  -- 20271120120003: this business's do-not-send list learns it, so the pre-send check holds the next
  -- attempt. Written for this message's business only (§9). A dead address is a fact about the ADDRESS,
  -- so bounce_hard is keyed on the canonical normalised address with no contact: correcting a contact's
  -- address is not held by the old one, and the contact's other addresses are not held. A complaint is
  -- the PERSON's answer, so it is keyed on the message's contact (only when that contact belongs to the
  -- message's business), else on the normalised address. Runs after the email's own outcome is written and
  -- is contained, so a refused write never loses that outcome and is never silent: a WARNING names the
  -- SQLSTATE and the journalled effect gains '_suppression_failed' (also on a refused message update).
  IF supp_why IS NOT NULL THEN
    IF supp_why = 'complaint' THEN
      SELECT c.id INTO supp_who FROM public.clients c WHERE c.id = m.contact_id AND c.tenant_id = m.tenant_id;
    END IF;
    BEGIN
      INSERT INTO public.paige_suppressions (tenant_id, contact_id, address_normalized, channel, reason, source)
      VALUES (m.tenant_id, supp_who,
              CASE WHEN supp_who IS NULL THEN public._comms_normalize_address('email', b->>'recipient') END,
              'email', supp_why, 'webhook')
      ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '_sendgrid_apply_governed_receipt: suppression (%) for message % not written: % %', supp_why, m.id, SQLSTATE, SQLERRM;
      supp_failed := true;
    END;
  END IF;

  IF refused THEN
    RETURN jsonb_build_object('correlation', 'correlated', 'reason', NULL, 'message_id', m.id,
                              'effect', 'message_update_refused' || CASE WHEN supp_failed THEN '_suppression_failed' ELSE '' END);
  END IF;
  RETURN jsonb_build_object('correlation', 'correlated', 'reason', CASE WHEN settled THEN 'settled_by_provider_event' END,
                            'message_id', m.id, 'effect', effect || CASE WHEN supp_failed THEN '_suppression_failed' ELSE '' END);
END $$;
REVOKE ALL ON FUNCTION public._sendgrid_apply_governed_receipt(text, text, text, timestamptz, text, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
