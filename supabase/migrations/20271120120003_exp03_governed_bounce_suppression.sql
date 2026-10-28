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
--     The write lives in ONE helper, _sendgrid_governed_suppress (granted to nobody), called after the email's
--     own outcome is written. It never raises: if the write is refused, that outcome is still recorded, a
--     WARNING names the SQLSTATE and the journalled effect gains '_suppression_failed'; if the recipient
--     normalises to '' there is nothing to key the row on, so it is SKIPPED, logged, and the effect gains
--     '_suppression_skipped'. A refused message update (42501) now answers 'message_update_refused' plus that
--     suffix instead of returning before the suppression step, and so does a refused SETTLE update (an
--     unknown send that all three claims and the recipient name): the bounce or complaint is a fact either
--     way. The failure is visible in sendgrid_receipt_processing.delivery_effect instead of silent. On success
--     the returned effect is unchanged, so every reader of delivery_effect keeps its values. (The event's
--     delivery claim is now read at the top of the function, unchanged, so the settle path can use it.)
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
--  3. Campaign readers (review M-A). _email_audience and email_campaign_dispatch_claim also match an address row
--     by the normalised form of the contact's email, so a +tagged contact whose address bounced is suppressed
--     at plan and skipped at send (bottom of this file; one comparison changed in each).
--
-- SAFE TO APPLY ON PRODUCTION. Five CREATE OR REPLACE FUNCTION statements: the applier, _email_audience (4-arg)
-- and email_campaign_dispatch_claim with the same signatures, return types, languages, volatility, SECURITY
-- DEFINER-ness and search_paths as the definitions they replace; and two new internal helpers
-- (_sendgrid_governed_suppress, SECURITY DEFINER, and _sendgrid_governed_suppress_suffix, IMMUTABLE sql), each
-- granted to nobody. The same REVOKEs as before. No table,
-- column, index, policy, trigger or row is created, altered or rewritten, so no table lock is taken
-- (CREATE OR REPLACE FUNCTION locks only the pg_proc row; the NOWAIT pattern of #3016 is for table DDL).
-- Idempotent: applying it twice is a no-op. Existing failed rows are NOT back-filled with suppressions —
-- a data write to production is not this file's to make (§13; see the decision log).
--
-- §59: the applier and the suppress helper are SECURITY DEFINER with a pinned search_path and granted to
-- NOBODY, service_role included; they run only inside ingest_sendgrid_receipt (service_role only, refuses
-- auth.uid() in its body). _email_audience stays nobody's; dispatch_claim stays service_role's. The
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
--   _email_audience(uuid, jsonb, boolean, text) (same ABI and columns): read by the 3-argument wrapper and the
--     campaign / series planning, preview, request-approval and dashboard functions (grep `_email_audience(`
--     in supabase/migrations); a +tagged contact whose normalised address is held now reads 'suppressed' —
--     the only change any caller can see. Proofs: email_campaign_lifecycle.sql, email_campaign_sendgrid_lane.sql,
--     e09_campaign_portal_audience.sql, exp03_resend_retired.sql, exp03_governed_bounce_suppression.sql §9.
--   email_campaign_dispatch_claim(integer) (same ABI and response shape): one caller, the email-campaign-worker
--     edge function; such a recipient is now skipped 'suppressed' at send instead of leased.
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

-- 20271120120003: the governed applier's ONE suppression step (called from its main path and from its settle
-- path's refusal). A dead address is a fact about the ADDRESS, so bounce_hard is keyed on the canonical
-- normalised address with no contact. A complaint is the PERSON's answer, so it is keyed on the message's
-- contact when that contact belongs to the message's business, else on the normalised address. Written for
-- this business only (§9). Never raises: an address that normalises to '' (no recipient) is SKIPPED and
-- logged; a refused write is logged with its SQLSTATE. Returns written | skipped | failed.
CREATE OR REPLACE FUNCTION public._sendgrid_governed_suppress(
  p_tenant uuid, p_contact uuid, p_recipient text, p_reason text, p_message uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  who  uuid;
  addr text := public._comms_normalize_address('email', p_recipient);
BEGIN
  IF p_reason = 'complaint' THEN
    SELECT c.id INTO who FROM public.clients c WHERE c.id = p_contact AND c.tenant_id = p_tenant;
  END IF;
  IF who IS NULL AND coalesce(addr, '') = '' THEN
    RAISE WARNING '_sendgrid_apply_governed_receipt: suppression (%) for message % skipped: no address to key it on', p_reason, p_message;
    RETURN 'skipped';
  END IF;
  INSERT INTO public.paige_suppressions (tenant_id, contact_id, address_normalized, channel, reason, source)
  VALUES (p_tenant, who, CASE WHEN who IS NULL THEN addr END, 'email', p_reason, 'webhook')
  ON CONFLICT DO NOTHING;
  RETURN 'written';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '_sendgrid_apply_governed_receipt: suppression (%) for message % not written: % %', p_reason, p_message, SQLSTATE, SQLERRM;
  RETURN 'failed';
END $$;
REVOKE ALL ON FUNCTION public._sendgrid_governed_suppress(uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The suffix the journalled effect carries for the suppression step's outcome ('' when written or not needed).
CREATE OR REPLACE FUNCTION public._sendgrid_governed_suppress_suffix(p_outcome text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE p_outcome WHEN 'failed' THEN '_suppression_failed' WHEN 'skipped' THEN '_suppression_skipped' ELSE '' END
$$;
REVOKE ALL ON FUNCTION public._sendgrid_governed_suppress_suffix(text) FROM PUBLIC, anon, authenticated, service_role;

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
  supp_out  text := 'none';      -- 20271120120003: the suppression step's outcome (written | skipped | failed | none)
  refused   boolean := false;    -- the message update was refused (42501); answered after the suppression step
  settle_refused boolean := false; -- the settle update was refused (42501); a hard bounce is still a fact
BEGIN
  -- What the event claims, read from the event alone (20271120120003 moved this up from below the
  -- correlation, unchanged, so the settle path's refusal can still record a hard bounce).
  incoming := CASE _status
    WHEN 'delivered'        THEN 'delivered'
    WHEN 'delivery_delayed' THEN 'deferred'
    WHEN 'bounced'          THEN CASE WHEN lower(btrim(coalesce(_bounce_type, ''))) = 'blocked' THEN 'blocked' ELSE 'bounced' END
    WHEN 'dropped'          THEN 'dropped'
    WHEN 'complained'       THEN 'spam_reported'
    ELSE NULL END;  -- sent / opened / clicked: no delivery claim

  -- 20271120120003: does this event prove the address cannot receive, or that the person complained?
  -- 'bounced' here is exactly the campaign path's hard bounce (any bounce type but 'blocked').
  drop_why := CASE WHEN incoming = 'dropped' THEN lower(btrim(coalesce(safe, ''))) END;
  supp_why := CASE
    WHEN incoming = 'bounced' THEN 'bounce_hard'
    WHEN incoming = 'dropped' AND drop_why IN ('bounced address', 'invalid') THEN 'bounce_hard'
    WHEN incoming = 'spam_reported' THEN 'complaint'
    ELSE NULL END;

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
        settle_refused := true;
      END;
      IF settle_refused THEN
        -- 20271120120003: all three claims and the recipient named this send, so a hard bounce or a complaint
        -- is still a fact about the address / the person: record it, and say so if it could not be.
        IF supp_why IS NOT NULL THEN
          supp_out := public._sendgrid_governed_suppress(m.tenant_id, m.contact_id, b->>'recipient', supp_why, m.id);
        END IF;
        RETURN jsonb_build_object('correlation', 'correlated', 'reason', 'settle_refused', 'message_id', m.id,
                                  'effect', 'message_update_refused' || public._sendgrid_governed_suppress_suffix(supp_out));
      END IF;
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
    supp_out := public._sendgrid_governed_suppress(m.tenant_id, m.contact_id, b->>'recipient', supp_why, m.id);
  END IF;

  IF refused THEN
    RETURN jsonb_build_object('correlation', 'correlated', 'reason', NULL, 'message_id', m.id,
                              'effect', 'message_update_refused' || public._sendgrid_governed_suppress_suffix(supp_out));
  END IF;
  RETURN jsonb_build_object('correlation', 'correlated', 'reason', CASE WHEN settled THEN 'settled_by_provider_event' END,
                            'message_id', m.id, 'effect', effect || public._sendgrid_governed_suppress_suffix(supp_out));
END $$;
REVOKE ALL ON FUNCTION public._sendgrid_apply_governed_receipt(text, text, text, timestamptz, text, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ── The campaign readers see an address-keyed bounce on a +tagged address too ──────────────────
-- Review M-A: a governed bounce is now kept on the normalised ADDRESS (+tag folded, no contact). The campaign
-- audience (_email_audience, 4-argument body) and the send-time re-check (email_campaign_dispatch_claim) matched
-- address rows only by `s.address_normalized = <email>`, the contact method lower-cased and trimmed but NOT
-- folded, so a contact whose email carries a +tag would be planned and dispatched to an address its business
-- holds. Both bodies below are production's pg_get_functiondef, read 2026-10-28 (md5 fce2b6518a1d7416bb6949cabba461e4
-- and dba5d86cb0d0cdc792d4f928116a8f91, equal to the repo's latest, 20271111060000), with ONE change each:
--   s.address_normalized = a.email   →  s.address_normalized IN (a.email, public._comms_normalize_address('email', a.email))
--   s.address_normalized = r2.email  →  s.address_normalized IN (r2.email, public._comms_normalize_address('email', r2.email))
-- The exact match is kept beside the folded one, so every row either reader honoured before is still honoured
-- (a writer that stored an unfolded address); the change can only add suppressions, never remove one. Same
-- signatures, language, volatility, SECURITY DEFINER and search_path; CREATE OR REPLACE keeps their grants
-- (_email_audience: nobody but the owner; dispatch_claim: service_role), re-stated for the audience as
-- 20271111060000 does.
CREATE OR REPLACE FUNCTION public._email_audience(p_tenant uuid, p_rule jsonb, p_newsletter boolean, p_kind text)
 RETURNS TABLE(client_id uuid, email text, ineligible text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH rule AS (
    SELECT
      ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_rule->'stages') = 'array' THEN p_rule->'stages' ELSE '[]' END)) AS stages,
      ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_rule->'sources') = 'array' THEN p_rule->'sources' ELSE '[]' END)) AS sources,
      ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_rule->'tags') = 'array' THEN p_rule->'tags' ELSE '[]' END)) AS tags,
      CASE WHEN jsonb_typeof(p_rule->'inactive_days') = 'number' THEN (p_rule->>'inactive_days')::int END AS inactive_days,
      -- E09 C1: any non-null portal key narrows to customers whose portal access is open (fails toward fewer).
      public._email_rule_wants_portal(p_rule) AS portal
  ), matched AS (
    SELECT c.id, (COALESCE(c.do_not_contact,false) OR COALESCE(c.dnd_active,false) OR COALESCE(c.disqualified,false)) AS opted_out,
           -- E09 C1: linked to a customer portal now, or before the business ended their access.
           (c.linked_user_id IS NOT NULL OR c.portal_access_former_user_id IS NOT NULL) AS portal_linked
    FROM public.clients c, rule
    WHERE c.tenant_id = p_tenant AND c.merged_into_contact_id IS NULL
      AND (cardinality(rule.stages) = 0 OR c.lifecycle_stage = ANY (rule.stages))
      AND (cardinality(rule.sources) = 0 OR c.source = ANY (rule.sources))
      AND (cardinality(rule.tags) = 0 OR COALESCE(c.tags, '{}') && rule.tags)
      -- Not contacted in N days: last contacted before then, or never contacted and added before then
      -- (a contact added yesterday is new, not lapsed).
      AND (rule.inactive_days IS NULL
           OR c.last_contacted_at < now() - make_interval(days => rule.inactive_days)
           OR (c.last_contacted_at IS NULL AND c.created_at < now() - make_interval(days => rule.inactive_days)))
      AND (NOT rule.portal OR public._client_portal_customer_open(p_tenant, c.id))
  ), addressed AS (
    SELECT DISTINCT ON (m.id) m.id, m.opted_out, m.portal_linked, lower(btrim(cm.value)) AS email
    FROM matched m
    LEFT JOIN public.client_contact_methods cm
      ON cm.client_id = m.id AND cm.tenant_id = p_tenant AND cm.kind = 'email' AND btrim(cm.value) LIKE '%_@_%._%'
    ORDER BY m.id, cm.is_primary DESC NULLS LAST, cm.position NULLS LAST
  )
  SELECT a.id, a.email,
    CASE
      WHEN a.email IS NULL THEN 'no_address'
      WHEN a.opted_out THEN 'opted_out'
      WHEN EXISTS (SELECT 1 FROM public.paige_suppressions s WHERE s.tenant_id = p_tenant AND s.channel = 'email'
                   AND (s.contact_id = a.id OR s.address_normalized IN (a.email, public._comms_normalize_address('email', a.email))))
        OR EXISTS (SELECT 1 FROM public.suppressed_emails g WHERE lower(btrim(g.email)) = a.email) THEN 'suppressed'
      WHEN p_newsletter AND NOT public._email_newsletter_subscribed(p_tenant, a.id, a.email) THEN 'no_consent'
      -- E09 C1 (owner Q1): a promotion or announcement to anyone linked to a customer portal (now or before
      -- their access was ended) needs their Updates and offers turned on, whatever the audience rule.
      -- Contacts never linked to a portal are unchanged.
      WHEN a.portal_linked AND public._email_kind_needs_updates_consent(p_kind)
           AND NOT public._email_newsletter_subscribed(p_tenant, a.id, a.email) THEN 'no_consent'
    END
  FROM addressed a
$function$;
REVOKE ALL ON FUNCTION public._email_audience(uuid, jsonb, boolean, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.email_campaign_dispatch_claim(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c public.email_campaigns%ROWTYPE; v public.email_campaign_versions%ROWTYPE;
  snd jsonb; addr text; room int; batch jsonb; active boolean; lim int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
BEGIN
  UPDATE public.email_campaign_recipients SET status = 'outcome_unknown', lease_until = NULL, updated_at = now(),
    error = COALESCE(error, 'The send was handed off but no result came back. It will not be sent again automatically.')
   WHERE status = 'sending' AND lease_until < now();

  SELECT ca.* INTO c FROM public.email_campaigns ca
    JOIN public.email_campaign_versions ve ON ve.id = ca.current_version_id
   WHERE ca.status IN ('scheduled','sending') AND ve.state = 'approved'
     AND COALESCE(ve.scheduled_for, now()) <= now()
     AND EXISTS (SELECT 1 FROM public.email_campaign_recipients r WHERE r.version_id = ve.id AND r.status = 'planned'
                   AND (r.not_before IS NULL OR r.not_before <= now()))
     -- A business at its daily ceiling waits without holding up every other business.
     AND public._email_used_today(ca.tenant_id) < public.email_campaign_daily_cap()
   ORDER BY COALESCE(ve.scheduled_for, ve.approved_at) ASC
   LIMIT 1 FOR UPDATE OF ca SKIP LOCKED;
  IF NOT FOUND THEN RETURN jsonb_build_object('campaign', NULL); END IF;
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = c.current_version_id;

  active := EXISTS (SELECT 1 FROM public.tenants tn WHERE tn.id = c.tenant_id AND tn.status = 'active');
  addr := public._email_postal_address(c.tenant_id);
  snd := public._email_resolve_sender(c.tenant_id, v.sender);
  IF NOT active OR addr IS NULL OR NOT (snd->>'ok')::boolean
     OR snd->>'from_address' IS DISTINCT FROM v.sender_snapshot->>'from_address'
     OR snd->>'from_name' IS DISTINCT FROM v.sender_snapshot->>'from_name'
     OR snd->>'mode' IS DISTINCT FROM v.sender_snapshot->>'mode' THEN
    UPDATE public.email_campaigns SET status = 'blocked', updated_at = now(),
      blocked_reason = CASE
        WHEN NOT active THEN 'business_inactive'
        WHEN addr IS NULL THEN 'postal_address_missing'
        WHEN NOT (snd->>'ok')::boolean THEN snd->>'reason'
        ELSE 'sender_changed' END
     WHERE id = c.id;
    RETURN jsonb_build_object('campaign', jsonb_build_object('id', c.id, 'tenant_id', c.tenant_id, 'version_id', v.id,
      'approved_by', v.approved_by), 'blocked', (SELECT blocked_reason FROM public.email_campaigns WHERE id = c.id), 'recipients', '[]'::jsonb);
  END IF;

  -- Final eligibility, recipient by recipient (owner ruling 4: snapshot ≠ guaranteed send).
  UPDATE public.email_campaign_recipients r SET status = 'skipped', skip_reason = x.why, updated_at = now()
    FROM (
      SELECT r2.id, CASE
        WHEN cl.id IS NULL OR cl.merged_into_contact_id IS NOT NULL THEN 'contact_removed'
        WHEN COALESCE(cl.do_not_contact,false) OR COALESCE(cl.dnd_active,false) OR COALESCE(cl.disqualified,false) THEN 'opted_out'
        WHEN EXISTS (SELECT 1 FROM public.paige_suppressions s WHERE s.tenant_id = r2.tenant_id AND s.channel = 'email'
                     AND (s.contact_id = r2.client_id OR s.address_normalized IN (r2.email, public._comms_normalize_address('email', r2.email))))
          OR EXISTS (SELECT 1 FROM public.suppressed_emails g WHERE lower(btrim(g.email)) = r2.email) THEN 'suppressed'
        -- E09 C1: a portal audience is re-proved at send — a customer paused, ended, unlinked or merged since
        -- approval is left out. The frozen rule and the live segment rule both count (fails toward fewer).
        WHEN (public._email_rule_wants_portal(v.audience) OR public._email_rule_wants_portal(public._email_version_rule(v)))
             AND NOT public._client_portal_customer_open(r2.tenant_id, r2.client_id) THEN 'contact_removed'
        WHEN c.kind = 'newsletter' AND NOT public._email_newsletter_subscribed(r2.tenant_id, r2.client_id, r2.email) THEN 'no_consent'
        -- E09 C1 (owner Q1): Updates and offers withdrawn after approval is honoured at send — for a current
        -- portal customer and for one whose access was ended since.
        WHEN (cl.linked_user_id IS NOT NULL OR cl.portal_access_former_user_id IS NOT NULL)
             AND public._email_kind_needs_updates_consent(c.kind)
             AND NOT public._email_newsletter_subscribed(r2.tenant_id, r2.client_id, r2.email) THEN 'no_consent'
      END AS why
      FROM public.email_campaign_recipients r2 LEFT JOIN public.clients cl ON cl.id = r2.client_id
      WHERE r2.version_id = v.id AND r2.status = 'planned'
    ) x
   WHERE r.id = x.id AND x.why IS NOT NULL;

  -- One business at a time from here to the lease, so two workers claiming different campaigns of the
  -- same business cannot both see the same room and overshoot the daily ceiling.
  PERFORM pg_advisory_xact_lock(hashtextextended('email_campaign_room:' || c.tenant_id::text, 0));
  room := GREATEST(public.email_campaign_daily_cap() - public._email_used_today(c.tenant_id), 0);
  IF room = 0 THEN
    UPDATE public.email_campaigns SET status = 'sending', updated_at = now() WHERE id = c.id;
    RETURN jsonb_build_object('campaign', jsonb_build_object('id', c.id, 'tenant_id', c.tenant_id, 'version_id', v.id,
      'approved_by', v.approved_by), 'waiting', 'daily_cap', 'recipients', '[]'::jsonb);
  END IF;

  WITH picked AS (
    SELECT id FROM public.email_campaign_recipients
     WHERE version_id = v.id AND status = 'planned' AND (not_before IS NULL OR not_before <= now()) ORDER BY created_at, id
     LIMIT LEAST(lim, room) FOR UPDATE SKIP LOCKED
  ), leased AS (
    UPDATE public.email_campaign_recipients r SET status = 'sending', attempt_count = r.attempt_count + 1,
      lease_until = now() + interval '10 minutes', route = CASE WHEN snd->>'mode' = 'managed' OR COALESCE((snd->>'platform_funded')::boolean, false) THEN 'managed' ELSE 'connector' END, updated_at = now()
      FROM picked WHERE r.id = picked.id
    RETURNING r.id, r.client_id, r.email
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'client_id', client_id, 'email', email)), '[]'::jsonb) INTO batch FROM leased;

  UPDATE public.email_campaigns SET status = 'sending', updated_at = now() WHERE id = c.id;
  RETURN jsonb_build_object(
    'campaign', jsonb_build_object('id', c.id, 'tenant_id', c.tenant_id, 'kind', c.kind, 'name', c.name,
      'version_id', v.id, 'approved_by', v.approved_by),
    'content', jsonb_build_object('subject', v.subject, 'preheader', v.preheader, 'body_html', v.body_html),
    'sender', snd, 'postal_address', addr,
    'business_name', (SELECT COALESCE(NULLIF(btrim(p.brand_display_name), ''), NULLIF(btrim(p.dba_name), ''), p.legal_business_name)
                        FROM public.tenant_legal_profile p WHERE p.tenant_id = c.tenant_id ORDER BY p.updated_at DESC NULLS LAST LIMIT 1),
    'recipients', batch);
END $function$;
