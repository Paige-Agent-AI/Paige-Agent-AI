-- ============================================================================
-- Experience 03 — Resend is retired; every 'resend'-labelled email now goes out through SendGrid.
--
-- What happened: production's Resend account was emptied on 2026-10-26 and the owner moved ALL email
-- to SendGrid. send-message's former "Resend arm" — PAIGE's managed sender (<slug>@mail.paigeagent.ai,
-- no connector) and every channel_connectors row with provider = 'resend' (the managed defaults of
-- 20261104000000, the custom-domain connectors of 20260729030000) — now hands the email to SendGrid
-- (send-message, converted in the same change). The stored labels stay 'resend': no data is rewritten.
--
-- Four things in the database were still true only of Resend, and this file corrects each:
--
-- 1. _comms_email_reconcilable — NOTHING is reconcilable by re-sending any more.
--    A governed business email (comms.email_send) whose provider answer was lost is 'unknown'. Until
--    now an 'unknown' (or stale 'dispatching') operation with provider 'resend' could be re-dispatched
--    within 23 h, because Resend's Idempotency-Key made the provider replay the ORIGINAL send instead
--    of sending again. SendGrid has no idempotent replay: a second POST is a second email. So a
--    'resend' operation whose outcome is unknown now stays unknown, exactly like Gmail, SMTP and
--    SendGrid ones always have; only provider evidence may settle it (part 4). Same signature, same language
--    (sql, STABLE, not SECURITY DEFINER), same search_path and grants. Every caller keeps working and
--    simply receives false: claim(..., _reconcile => true) answers {state:'unknown', admitted:false}
--    (send-message dispatches only on admitted = true), and read_comms_email_send_result reports
--    reconcilable = false, which the comms adapter already treats as "stuck, needs review".
--
-- 2. _sendgrid_apply_campaign_receipt — SendGrid's events now land on 'resend'-labelled campaigns.
--    A campaign version whose frozen sender says provider 'resend' (PAIGE's managed sender, or a
--    Resend connector) was sent by SendGrid, so its delivered / open / click / bounce / spam events
--    arrive through handle-sendgrid-webhook. The applier accepted only versions frozen 'sendgrid'
--    and journalled the rest as provider_mismatch; it now accepts 'resend' too, in all three places
--    it checks the provider (the no-X-Message-Id fill-in, the outcome_unknown suppression, the main
--    correlation). NOTHING else in it changes: the event must still name the recipient's provider id
--    (or, with none recorded, all three claims and the address must name the row), all three claims
--    must equal business + recipient id + recipient id, the address must match, first time wins, a
--    hard bounce or complaint suppresses and a 'blocked' bounce does not. Versions frozen with any
--    other provider (a business's own Gmail / SMTP / other connection) stay provider_mismatch.
--
-- 3. _email_resolve_sender — PAIGE's managed sender is frozen as provider 'sendgrid' from now on,
--    because that is who sends it. Connector senders keep their own row's provider (a Resend
--    connector still freezes 'resend'; the applier accepts both labels). Every reader of that value
--    was checked (§37 below): none breaks for either value, and campaigns approved before this file
--    (managed, frozen 'resend') keep working and keep receiving receipts. The SendGrid-connector
--    verification rule (H2: a 'sendgrid' connector's From must be on a domain THIS business verified)
--    is untouched here. It is NOT the whole of H2 any more: the 'resend'-labelled senders that now reach
--    SendGrid carry tenant-writable addresses, so send-message applies its own H2 rule to them
--    (platform-sendgrid.ts tenantFrom: a mail.paigeagent.ai From only when it is this business's own
--    managed address resolved server-side; anything else sends as notifications@).
--
-- 4. _sendgrid_apply_governed_receipt — SendGrid's events now settle 'resend'-bound governed emails.
--    send-message's governed door hands a 'resend'-bound comms.email_send to SendGrid with the same three
--    custom_args claims as a 'sendgrid' one (paige_tenant_id = the business, paige_operation_id = the
--    binding's operation, paige_message_id = the messages row). The applier accepted only bindings whose
--    provider is 'sendgrid'; it now accepts 'resend' too, in its two provider checks (the settle path for
--    a send with no stored X-Message-Id, and the main correlation). Body verbatim 20271031000200 (the
--    only definition; the live body's md5 was checked equal before this change) otherwise: an unknown or
--    stale-dispatching send is settled only when all three claims AND the recipient match, becoming
--    provider_accepted / settled_by_provider_event; a failed or refused send is never settled; a binding
--    already holding another id is never overwritten; early events stay 'pending'; bounces mark it
--    failed; the first terminal outcome wins. A NULL provider still mismatches. Gmail, SMTP and every
--    other provider stay provider_mismatch: SendGrid never sent them. The identical-content guard is not
--    touched (it lives in prepare/claim): once an event settles a send, that operation is no longer
--    'unknown', so the guard stops holding the same recipient + content exactly as for a SendGrid send.
--
-- NOT changed, deliberately: email_campaign_sendgrid_admit (its connector-only, 'sendgrid'-only
-- admission and grants), ingest_sendgrid_receipt, the identical-content guard, the SendGrid
-- connector rules and every grant. email_campaign_dispatch_record is not redefined: it already meters
-- under the version's frozen provider, so new managed approvals meter 'sendgrid' and older ones keep
-- their 'resend' label (labels are not rewritten).
--
-- HONEST RESIDUALS (§13), properties of this contract and not hidden by it:
--  * A governed business email bound to 'resend' that ends 'unknown' is settled only if SendGrid's event
--    arrives carrying all three claims and the recipient (part 4). If no event ever comes (SendGrid never
--    accepted it, or the webhook is down), it stays unknown and the identical-content guard keeps refusing
--    the same recipient + content (55000) until a person resolves it — the same residual every SendGrid
--    send has. A 'resend' binding finalized BEFORE the cut-over (sent by Resend) is never matched: its
--    stored id is Resend's, and a SendGrid event never names it.
--  * A campaign approved before this file through PAIGE's managed sender is frozen 'resend' and is
--    metered under 'resend', although SendGrid sent it (labels are not rewritten).
--
-- SAFE TO APPLY ON PRODUCTION. Four CREATE OR REPLACE FUNCTION statements with the same signatures,
-- return types, languages, volatility, SECURITY DEFINER-ness and search_paths as the definitions they
-- replace, plus the same REVOKE/GRANT those had. No table, column, index, policy or row is created,
-- altered or rewritten. Idempotent: applying it twice is a no-op.
--
-- §59: _email_resolve_sender, _sendgrid_apply_campaign_receipt and _sendgrid_apply_governed_receipt stay
-- SECURITY DEFINER with a pinned search_path. The resolver is executable by no API role (REVOKE from PUBLIC, anon, authenticated, as
-- 20270549000000 had it); it is called only from inside the campaign functions, which re-prove the
-- caller. Both appliers are granted to NOBODY, service_role included (they run only inside
-- ingest_sendgrid_receipt, which is service_role-only and refuses auth.uid()). _comms_email_reconcilable
-- is a pure predicate over the binding it is handed (no table read), service_role only, as before.
--
-- §37 PRODUCER / CONSUMER INVENTORY (grepped supabase/migrations, supabase/functions, src, scripts, .github)
--   _comms_email_reconcilable(jsonb) -> boolean (unchanged ABI; now always false):
--     · claim_comms_email_send — newest body 20271114230204 (also 20271110220000, 20270597000000):
--       `CASE WHEN _reconcile THEN _comms_email_reconcilable(b) ...` → a reconcile claim is no longer
--       admitted; it answers the binding's own state with admitted=false.
--     · read_comms_email_send_result (20270597000000): the 'reconcilable' key reads false.
--     · Edge consumers of that key: supabase/functions/_shared/comms-email/adapter.ts
--       (reconcileCommsEmailSend — converted in the same change to never re-send; before it, it re-sent
--       only when reconcilable === true, so false lands on its existing "stuck" path either way) and
--       send-message/index.ts (comms_email_reconcile → claim(..., true); it dispatches only on
--       admitted = true, so the database alone already guarantees no re-dispatch).
--     · Proofs that asserted the old Resend re-admission, all moved to this contract in the same change:
--       scripts/sql/comms-email-send-concurrency-proof.mjs (CI, ci.yml "INT-328 comms email — real
--       two-session concurrency proof"; it applies 20270597000000 verbatim over a stub, and now also this
--       file's _comms_email_reconcilable with its exact REVOKE/GRANT — the rest of this file needs
--       campaign tables the stub lacks): (g-db)/(g-api) now prove a stale-dispatch reconcile race
--       re-admits NOBODY, plus a new (g-unknown); scripts/sql/comms-email-origin-admission-cases.mjs
--       "(origin-recovery) legacy admitted same-operation Resend reconciliation stays bounded";
--       scripts/sql/comms-email-send-proof.sql (run by hand in BEGIN..ROLLBACK; it now \i's this file
--       after 20270597000000) §4 ok 54/56–59/63 and §6 ok 107–109. scripts/agreements/* install
--       20270597000000's body in their own Agreements database and assert only that an UNCERTAIN SendGrid
--       send is not reconcilable — true under both bodies; unchanged. This file's own proof is
--       supabase/tests/exp03_resend_retired.sql §1.
--   _email_resolve_sender(uuid, jsonb) -> jsonb (same keys; managed 'provider' now 'sendgrid'):
--     · plpgsql callers: 20270549000000, 20270560000000, 20270564000000, 20270580000000, 20271111060000
--       (draft save, request-approval freeze into sender_snapshot, every dispatch claim). They compare
--       ok / reason / mode / from_address / from_name only — never provider — so an approved managed
--       campaign frozen 'resend' is not "sender_changed" after this file. Content hashes are built from
--       the version's `sender` selection, not the snapshot, so nothing locked goes stale.
--     · Readers of sender_snapshot->>'provider': email_campaign_sendgrid_admit (requires mode
--       'connector' AND provider 'sendgrid' — a managed sender is refused there before and after,
--       whatever its label), _sendgrid_apply_campaign_receipt (this file: both labels),
--       email_campaign_dispatch_record (meters under it; COALESCE default 'resend').
--     · Edge: email-campaign-worker reads the claim's sender.mode / connector_id / from_address only;
--       send-message never reads sender_snapshot. Frontend (src/solo/marketing-email-*) shows a
--       provider word only for connector senders. scripts/sql/email-series-preview-seed.sql calls it
--       for a preview fixture and reads no provider.
--   _sendgrid_apply_campaign_receipt(...) -> jsonb (same ABI and return words):
--     · one caller, ingest_sendgrid_receipt (20271116020000), unchanged.
--     · Proofs: supabase/tests/email_campaign_sendgrid_lane.sql (its "a Resend-sent recipient is never
--       touched" case now uses a Gmail connector, since a Resend-labelled send IS SendGrid's now),
--       supabase/tests/paige_email_sendgrid_receipts.sql (replays 20271116020000 inside its
--       transaction, so it now replays this file after it), supabase/tests/exp03_resend_retired.sql
--       (new: this file's own proof).
--   _sendgrid_apply_governed_receipt(...) -> jsonb (same ABI and return words):
--     · one caller, ingest_sendgrid_receipt (20271116020000), unchanged.
--     · Producer of the claims it requires: send-message/index.ts sets sendgridCustomArgs
--       {paige_tenant_id: binding tenant, paige_operation_id: binding operation, paige_message_id: the
--       messages row} for EVERY governed door send after the claim, whatever the binding's provider, and
--       its SendGrid arm (every provider but gmail / smtp) posts them as custom_args. Verified in the
--       converted send-message of this change.
--     · Proofs: supabase/tests/paige_email_sendgrid_receipts.sql — its two "another provider's send"
--       fixtures (8 and 43) were Resend bindings; they are now Gmail bindings, since a Resend-bound send
--       IS SendGrid's now. supabase/tests/exp03_resend_retired.sql §1b proves the new behaviour.
--       supabase/tests/sendgrid_receipt_ingest.sql and paige_email_sendgrid_door.sql pass unchanged.
-- ============================================================================

-- 1 ─ No provider is reconcilable by re-sending (SendGrid has no idempotent replay).
CREATE OR REPLACE FUNCTION public._comms_email_reconcilable(_binding jsonb) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 -- Resend's Idempotency-Key let a lost answer be re-dispatched safely; Resend is retired and every
 -- 'resend' operation now sends through SendGrid, where a second POST is a second email. An unknown
 -- outcome stays unknown until provider evidence settles it (20271116200000).
 SELECT false
$$;
REVOKE ALL ON FUNCTION public._comms_email_reconcilable(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._comms_email_reconcilable(jsonb) TO service_role;

-- 2 ─ PAIGE's managed sender is SendGrid's now. Everything else as 20271116020000 had it.
CREATE OR REPLACE FUNCTION public._email_resolve_sender(p_tenant uuid, p_sender jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE conn public.channel_connectors%ROWTYPE; ident jsonb;
BEGIN
  IF COALESCE(p_sender->>'mode', 'managed') = 'connector' THEN
    SELECT * INTO conn FROM public.channel_connectors
     WHERE id = NULLIF(p_sender->>'connector_id', '')::uuid AND tenant_id = p_tenant AND channel_type = 'email';
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'sender_not_found'); END IF;
    IF NOT conn.active OR conn.status <> 'active' OR NULLIF(btrim(COALESCE(conn.from_address, '')), '') IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'sender_needs_attention');
    END IF;
    -- PAIGE Email (SendGrid) sends on the platform's account, which authenticates domains for every
    -- business at once: the From must be on a domain THIS business verified.
    IF conn.provider = 'sendgrid' AND NOT public._comms_email_sendgrid_sender_verified(p_tenant, conn.from_address) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'sender_needs_attention');
    END IF;
    -- A Resend or SendGrid connection sends with the platform's own key (send-message), so PAIGE pays
    -- for it: it is costed and metered like PAIGE's sender, and the provider reports opens and clicks.
    -- A Resend connection keeps its row's label; since 2026-10-26 it is delivered through SendGrid.
    RETURN jsonb_build_object('ok', true, 'mode', 'connector', 'connector_id', conn.id, 'provider', conn.provider,
      'from_address', lower(btrim(conn.from_address)), 'from_name', conn.from_name,
      'platform_funded', conn.provider IN ('resend', 'sendgrid'));
  END IF;
  ident := to_jsonb(public.tenant_sender_identity(p_tenant));
  IF ident IS NULL OR NULLIF(btrim(COALESCE(ident->>'from_address', '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sender_needs_attention');
  END IF;
  -- PAIGE's managed sender is delivered by SendGrid (Resend retired 2026-10-26, 20271116200000).
  RETURN jsonb_build_object('ok', true, 'mode', 'managed', 'provider', 'sendgrid',
    'from_address', lower(btrim(ident->>'from_address')), 'from_name', ident->>'from_name');
END $$;
REVOKE ALL ON FUNCTION public._email_resolve_sender(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 3 ─ SendGrid's events settle 'resend'-labelled campaigns too (they were sent by SendGrid). The ONLY
--     change from 20271116020000 is `->>'provider' IN ('sendgrid', 'resend')` in its three provider checks.
CREATE OR REPLACE FUNCTION public._sendgrid_apply_campaign_receipt(
  _sg_message_id text, _status text, _email text, _event_at timestamptz,
  _tenant_claim text, _operation_claim text, _message_claim text, _bounce_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _uuid  constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  cr     public.email_campaign_recipients%ROWTYPE;
  claims boolean := coalesce(_tenant_claim ~ _uuid AND _operation_claim ~ _uuid AND _message_claim ~ _uuid, false);
  at     timestamptz := coalesce(_event_at, now());
  uncorr text;
  effect text := 'none';
  hard   boolean := lower(btrim(coalesce(_bounce_type, ''))) <> 'blocked';
BEGIN
  SELECT * INTO cr FROM public.email_campaign_recipients WHERE provider_message_id = _sg_message_id FOR UPDATE;
  IF NOT FOUND THEN
    IF claims AND lower(_operation_claim) = lower(_message_claim) THEN
      SELECT * INTO cr FROM public.email_campaign_recipients
       WHERE id = lower(_operation_claim)::uuid AND tenant_id::text = lower(_tenant_claim) FOR UPDATE;
      IF FOUND AND cr.status = 'sent' AND cr.provider_message_id IS NULL
         AND _email IS NOT NULL AND lower(btrim(_email)) = lower(btrim(cr.email))
         AND EXISTS (SELECT 1 FROM public.email_campaign_versions v
                      WHERE v.id = cr.version_id AND v.sender_snapshot->>'provider' IN ('sendgrid', 'resend')) THEN
        -- SendGrid accepted it (202) but its answer carried no X-Message-Id: all three claims and the
        -- address name this row, so the event supplies the id, and is then applied like any other.
        UPDATE public.email_campaign_recipients SET provider_message_id = _sg_message_id, updated_at = now() WHERE id = cr.id;
        cr.provider_message_id := _sg_message_id;
      ELSIF FOUND AND cr.status = 'sending' AND cr.provider_message_id IS NULL
         AND _email IS NOT NULL AND lower(btrim(_email)) = lower(btrim(cr.email))
         AND cr.updated_at > now() - interval '15 minutes' THEN
        -- Still being handed over: the dispatcher records the id in a moment. Redeliver.
        RETURN jsonb_build_object('correlation', 'pending', 'reason', 'awaiting_record', 'recipient_id', cr.id, 'effect', 'none');
      END IF;
      IF FOUND AND cr.status = 'outcome_unknown' AND cr.provider_message_id IS NULL
         AND _email IS NOT NULL AND lower(btrim(_email)) = lower(btrim(cr.email))
         AND EXISTS (SELECT 1 FROM public.email_campaign_versions v
                      WHERE v.id = cr.version_id AND v.sender_snapshot->>'provider' IN ('sendgrid', 'resend')) THEN
        -- The send's answer could not be read, so the row stays outcome_unknown and no time is written
        -- (settling it would move a finished campaign's totals). But a complaint or a hard bounce about it
        -- is the person's own answer: honour it, so the next campaign never reaches them.
        IF _status = 'complained' OR (_status = 'bounced' AND hard) THEN
          INSERT INTO public.paige_suppressions (tenant_id, contact_id, address_normalized, channel, reason, source)
          VALUES (cr.tenant_id, cr.client_id, CASE WHEN cr.client_id IS NULL THEN lower(btrim(cr.email)) END, 'email',
                  CASE WHEN _status = 'bounced' THEN 'bounce_hard' ELSE 'complaint' END, 'webhook')
          ON CONFLICT DO NOTHING;
          RETURN jsonb_build_object('correlation', 'correlated', 'reason', 'recipient_outcome_unknown', 'recipient_id', cr.id,
                                    'effect', 'suppressed_only');
        END IF;
        RETURN jsonb_build_object('correlation', 'uncorrelated', 'reason', 'recipient_not_sent', 'recipient_id', NULL, 'effect', 'none');
      END IF;
      IF FOUND AND cr.status IN ('outcome_unknown', 'failed', 'sending') THEN
        RETURN jsonb_build_object('correlation', 'uncorrelated', 'reason', 'recipient_not_sent', 'recipient_id', NULL, 'effect', 'none');
      END IF;
    END IF;
    IF cr.provider_message_id IS DISTINCT FROM _sg_message_id THEN
      RETURN jsonb_build_object('correlation', 'uncorrelated', 'reason', 'no_campaign_recipient', 'recipient_id', NULL, 'effect', 'none');
    END IF;
  END IF;

  uncorr := CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.email_campaign_versions v
                      WHERE v.id = cr.version_id AND v.sender_snapshot->>'provider' IN ('sendgrid', 'resend')) THEN 'provider_mismatch'
    WHEN _tenant_claim IS NULL OR _operation_claim IS NULL OR _message_claim IS NULL THEN 'claims_missing'
    WHEN _tenant_claim !~ _uuid OR lower(_tenant_claim) IS DISTINCT FROM cr.tenant_id::text THEN 'tenant_mismatch'
    WHEN _operation_claim !~ _uuid OR lower(_operation_claim) IS DISTINCT FROM cr.id::text THEN 'operation_mismatch'
    WHEN _message_claim !~ _uuid OR lower(_message_claim) IS DISTINCT FROM cr.id::text THEN 'message_mismatch'
    WHEN _email IS NOT NULL AND lower(btrim(_email)) IS DISTINCT FROM lower(btrim(cr.email)) THEN 'recipient_mismatch'
    WHEN cr.status <> 'sent' THEN 'recipient_not_sent'
    ELSE NULL END;
  IF uncorr IS NOT NULL THEN
    RETURN jsonb_build_object('correlation', 'uncorrelated', 'reason', uncorr, 'recipient_id', NULL, 'effect', 'none');
  END IF;

  IF _status IN ('delivered', 'opened', 'clicked', 'bounced', 'complained') THEN
    UPDATE public.email_campaign_recipients SET
      delivered_at  = CASE WHEN _status = 'delivered'  THEN COALESCE(delivered_at, at)  ELSE delivered_at END,
      opened_at     = CASE WHEN _status = 'opened'     THEN COALESCE(opened_at, at)     ELSE opened_at END,
      clicked_at    = CASE WHEN _status = 'clicked'    THEN COALESCE(clicked_at, at)    ELSE clicked_at END,
      bounced_at    = CASE WHEN _status = 'bounced'    THEN COALESCE(bounced_at, at)    ELSE bounced_at END,
      complained_at = CASE WHEN _status = 'complained' THEN COALESCE(complained_at, at) ELSE complained_at END,
      updated_at = now()
    WHERE id = cr.id;
    effect := 'campaign_' || _status;
    IF _status = 'complained' OR (_status = 'bounced' AND hard) THEN
      INSERT INTO public.paige_suppressions (tenant_id, contact_id, address_normalized, channel, reason, source)
      VALUES (cr.tenant_id, cr.client_id, CASE WHEN cr.client_id IS NULL THEN lower(btrim(cr.email)) END, 'email',
              CASE WHEN _status = 'bounced' THEN 'bounce_hard' ELSE 'complaint' END, 'webhook')
      ON CONFLICT DO NOTHING;
      effect := effect || '_suppressed';
    END IF;
  END IF;
  RETURN jsonb_build_object('correlation', 'correlated', 'reason', NULL, 'recipient_id', cr.id, 'effect', effect);
END $$;
REVOKE ALL ON FUNCTION public._sendgrid_apply_campaign_receipt(text, text, text, timestamptz, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- 4 ─ SendGrid's events settle 'resend'-bound governed emails too (the door sends them through SendGrid with
--     all three custom_args claims). Verbatim the 20271031000200 body; the ONLY change is its two
--     provider checks, `b->>'provider' IS DISTINCT FROM 'sendgrid'` becoming
--     `b->>'provider' IS NULL OR b->>'provider' NOT IN ('sendgrid', 'resend')` (NULL still mismatches,
--     as before). Gmail, SMTP and every other provider stay provider_mismatch.
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
