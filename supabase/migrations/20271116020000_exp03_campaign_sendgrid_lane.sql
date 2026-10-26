-- ============================================================================
-- Experience 03 — the SendGrid lane for approved marketing campaigns (owner ruling 2026-10-26:
-- "SendGrid-only still stands"; delivery/bounce reporting is analytics for every business owner,
-- the Platform Operator account included).
--
-- INERT ON MERGE. Production on 2026-10-26 has 0 `sendgrid` connectors and 0 SendGrid-verified
-- domains, so nothing in this file can send or change anything until a business has a verified
-- SendGrid sender (master §5 operator steps). Paige's managed sender and every Resend connector are
-- unchanged.
--
-- Four parts:
--
-- 1. A campaign may name a SendGrid sender only when its domain is SendGrid-verified FOR THAT
--    BUSINESS (_comms_email_sendgrid_sender_verified, 20271031000100). _email_resolve_sender is the
--    one place every campaign path resolves a sender (draft save, approval freeze, every claim), so an
--    unverified one reads `sender_needs_attention` everywhere: it cannot be approved, and a claim
--    blocks the campaign if verification is lost after approval. SendGrid runs on the platform's Mail
--    Send key, so PAIGE pays for it exactly as for Resend: platform_funded (route 'managed', metered).
--
-- 2. email_campaign_sendgrid_admit — the database's answer to "may send-message hand THIS email to
--    SendGrid?". send-message refuses every SendGrid send that is not the governed reply door's
--    (security H2: SendGrid authenticates a domain for the whole shared account, so the provider would
--    accept any From the account verified). A campaign email is admitted only for the exact recipient
--    row the dispatcher has leased right now, of the campaign's current approved version, whose frozen
--    sender is this connector, still active, still SendGrid, still verified for this business, with
--    the same From, to the same address. Service role only; refuses a signed-in caller.
--
-- 3. Receipts. A campaign email carries custom_args paige_tenant_id = the business, and
--    paige_operation_id = paige_message_id = the recipient row id. ingest_sendgrid_receipt first asks
--    the governed-reply applier (unchanged). When that finds no governed message (no_message /
--    not_governed), the new campaign applier correlates the event to email_campaign_recipients: the
--    row whose provider_message_id is the event's X-Message-Id, of a version whose frozen sender is
--    SendGrid, whose business and row id equal the claims (all three required), and whose address
--    equals the event's. It then writes what Resend receipts write today (process_resend_receipt):
--      delivered -> delivered_at · open -> opened_at · click -> clicked_at
--      bounce    -> bounced_at; a hard bounce (type 'bounce') also suppresses the address
--                   (bounce_hard). A 'blocked' bounce is the receiving server refusing this send,
--                   not proof the address is dead, so it is counted as bounced and NOT suppressed.
--      spamreport-> complained_at + a complaint suppression
--      dropped / deferred -> journalled only (no column exists; SendGrid drops to its own lists).
--    First timestamp wins (COALESCE), so redeliveries and late events never move a time.
--    An event for a recipient still being handed over (status 'sending', no provider id yet, claims
--    and address match, leased within 15 minutes) answers 'pending' so SendGrid redelivers once the
--    dispatcher has recorded the id. A recipient left outcome_unknown is NOT settled by an event here
--    (journalled `recipient_not_sent`); settling it would change a finished campaign's totals and is
--    tracked as its own decision (journey §14.6). Its complaint or hard bounce (claims and address
--    matching, SendGrid version) still suppresses the address: the person's answer is honoured.
--
-- 4. email_campaign_dispatch_record meters a sent email under the provider that sent it (the
--    version's frozen sender), instead of always 'resend'. Nothing else in it changes.
--
-- §59: every function is SECURITY DEFINER with a pinned search_path. The admit RPC and ingest are
-- service_role only and refuse auth.uid(); the campaign applier is granted to NOBODY (it runs only
-- from inside ingest, keyed by a provider-verified event), like the governed applier.
--
-- §37 PRODUCER / CONSUMER INVENTORY
--   _email_resolve_sender (output gains no key; a sendgrid connector's platform_funded becomes true
--     and an unverified one reads sender_needs_attention): callers are the plpgsql campaign functions
--     in 20270549000000, 20270560000000, 20270564000000, 20270580000000, 20271111060000 — all read
--     ok / reason / mode / connector_id / provider / from_address / from_name / platform_funded only.
--     No edge function or frontend calls it (grepped supabase/functions, src).
--   email_campaign_sendgrid_admit: new; one caller, supabase/functions/send-message/index.ts.
--   ingest_sendgrid_receipt: same 10-argument signature and return words. Callers:
--     handle-sendgrid-webhook (named args, unchanged), supabase/tests/sendgrid_receipt_ingest.sql,
--     supabase/tests/paige_email_sendgrid_receipts.sql. That proof replays 20271031000200 inside its
--     transaction (recreating the older ingest), so it now replays THIS migration after it too: every
--     governed-reply assertion runs against the new ingest.
--   email_campaign_dispatch_record: same signature/returns; caller email-campaign-worker (unchanged).
--   sendgrid_receipt_processing gains one nullable column (correlated_campaign_recipient_id); readers
--     select named columns only (grepped).
-- ============================================================================

-- 1 ─ A SendGrid campaign sender must be verified for this business.
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
    RETURN jsonb_build_object('ok', true, 'mode', 'connector', 'connector_id', conn.id, 'provider', conn.provider,
      'from_address', lower(btrim(conn.from_address)), 'from_name', conn.from_name,
      'platform_funded', conn.provider IN ('resend', 'sendgrid'));
  END IF;
  ident := to_jsonb(public.tenant_sender_identity(p_tenant));
  IF ident IS NULL OR NULLIF(btrim(COALESCE(ident->>'from_address', '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sender_needs_attention');
  END IF;
  RETURN jsonb_build_object('ok', true, 'mode', 'managed', 'provider', 'resend',
    'from_address', lower(btrim(ident->>'from_address')), 'from_name', ident->>'from_name');
END $$;

-- 2 ─ May send-message hand this campaign email to SendGrid?
CREATE OR REPLACE FUNCTION public.email_campaign_sendgrid_admit(p_recipient_id uuid, p_connector_id uuid, p_to text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r public.email_campaign_recipients%ROWTYPE; c public.email_campaigns%ROWTYPE;
        v public.email_campaign_versions%ROWTYPE; conn public.channel_connectors%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'EMAIL_CAMPAIGN_SENDGRID_ADMIT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.email_campaign_recipients WHERE id = p_recipient_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'recipient_not_found'); END IF;
  IF r.status <> 'sending' OR r.lease_until IS NULL OR r.lease_until <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'recipient_not_leased');
  END IF;
  IF p_to IS NULL OR lower(btrim(p_to)) IS DISTINCT FROM lower(btrim(r.email)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'recipient_changed');
  END IF;
  SELECT * INTO c FROM public.email_campaigns WHERE id = r.campaign_id;
  IF NOT FOUND OR c.tenant_id IS DISTINCT FROM r.tenant_id OR c.current_version_id IS DISTINCT FROM r.version_id
     OR c.status NOT IN ('scheduled', 'sending') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_not_sending');
  END IF;
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = r.version_id AND tenant_id = r.tenant_id;
  IF NOT FOUND OR v.state <> 'approved' OR v.approved_at IS NULL
     OR v.sender_snapshot->>'mode' IS DISTINCT FROM 'connector'
     OR v.sender_snapshot->>'provider' IS DISTINCT FROM 'sendgrid'
     OR p_connector_id IS NULL OR v.sender_snapshot->>'connector_id' IS DISTINCT FROM p_connector_id::text THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sender_not_approved');
  END IF;
  SELECT * INTO conn FROM public.channel_connectors WHERE id = p_connector_id;
  IF NOT FOUND OR conn.tenant_id IS DISTINCT FROM r.tenant_id OR conn.channel_type <> 'email'
     OR conn.provider IS DISTINCT FROM 'sendgrid' OR NOT conn.active OR conn.status <> 'active'
     OR lower(btrim(COALESCE(conn.from_address, ''))) IS DISTINCT FROM v.sender_snapshot->>'from_address' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sender_changed');
  END IF;
  IF NOT public._comms_email_sendgrid_sender_verified(r.tenant_id, conn.from_address) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sender_unverified');
  END IF;
  RETURN jsonb_build_object('ok', true, 'tenant_id', r.tenant_id, 'recipient_id', r.id,
    'from_address', lower(btrim(conn.from_address)));
END $$;
REVOKE ALL ON FUNCTION public.email_campaign_sendgrid_admit(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_campaign_sendgrid_admit(uuid, uuid, text) TO service_role;

-- 3 ─ Campaign receipts.
ALTER TABLE public.sendgrid_receipt_processing
  ADD COLUMN IF NOT EXISTS correlated_campaign_recipient_id uuid;
COMMENT ON COLUMN public.sendgrid_receipt_processing.correlated_campaign_recipient_id IS
  'Experience 03: the email_campaign_recipients row a correlated campaign event updated (20271116020000). NULL for governed replies and uncorrelated events.';

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
                      WHERE v.id = cr.version_id AND v.sender_snapshot->>'provider' = 'sendgrid') THEN
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
                      WHERE v.id = cr.version_id AND v.sender_snapshot->>'provider' = 'sendgrid') THEN
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
                      WHERE v.id = cr.version_id AND v.sender_snapshot->>'provider' = 'sendgrid') THEN 'provider_mismatch'
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

-- The one door, unchanged except that an event the governed-reply applier finds no message for is
-- offered to the campaign applier. Same signature, same return words.
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
DECLARE r public.sendgrid_receipt_processing%ROWTYPE; fx jsonb; cx jsonb;
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
    -- Not a governed reply: it may be a campaign email (20271116020000). Contained the same way.
    IF fx->>'correlation' = 'uncorrelated' AND fx->>'reason' IN ('no_message', 'not_governed') THEN
      BEGIN
        cx := public._sendgrid_apply_campaign_receipt(r.message_id, r.status, r.email, r.event_at,
                r.tenant_claim, r.operation_claim, r.message_claim, r.bounce_type);
      EXCEPTION WHEN OTHERS THEN
        cx := jsonb_build_object('correlation', 'apply_failed', 'reason', 'campaign_apply_failed_' || lower(SQLSTATE),
                                 'recipient_id', NULL, 'effect', 'apply_failed');
      END;
      -- Keep the governed applier's answer unless the campaign applier recognised the event.
      IF cx->>'reason' IS DISTINCT FROM 'no_campaign_recipient' THEN
        fx := jsonb_build_object('correlation', cx->>'correlation', 'reason', cx->>'reason',
                                 'message_id', NULL, 'effect', cx->>'effect', 'recipient_id', cx->>'recipient_id');
      END IF;
    END IF;
    -- Early: the named send is still being handed over. Undo this attempt entirely (journal and append)
    -- so the webhook answers 503 and SendGrid redelivers; the appliers bound how long that lasts.
    IF fx->>'correlation' = 'pending' THEN
      RAISE EXCEPTION 'SENDGRID_RECEIPT_EARLY' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.sendgrid_receipt_processing
       SET state = 'processed', attempts = attempts + 1,
           correlation = fx->>'correlation', correlation_reason = fx->>'reason',
           correlated_message_id = (fx->>'message_id')::uuid, delivery_effect = fx->>'effect',
           correlated_campaign_recipient_id = (fx->>'recipient_id')::uuid
     WHERE receipt_id = r.receipt_id;
    RETURN 'processed';
  EXCEPTION WHEN OTHERS THEN
    RETURN 'pending';
  END;
END $function$;
REVOKE ALL ON FUNCTION public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text) TO service_role;

-- 4 ─ Meter a sent email under the provider that sent it.
CREATE OR REPLACE FUNCTION public.email_campaign_dispatch_record(
  p_recipient_id uuid, p_outcome text, p_provider_message_id text DEFAULT NULL, p_message_id uuid DEFAULT NULL,
  p_skip_reason text DEFAULT NULL, p_error text DEFAULT NULL, p_not_before timestamptz DEFAULT NULL)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.email_campaign_recipients%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('sent','failed','outcome_unknown','skipped','deferred') THEN RAISE EXCEPTION 'outcome_invalid' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.email_campaign_recipients WHERE id = p_recipient_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF r.status <> 'sending' THEN RETURN 'already_' || r.status; END IF;
  -- Held by the pre-send checks before anything was handed to a provider: back in the queue until
  -- the hold ends (bounded to a day), and this lease does not count as an attempt.
  IF p_outcome = 'deferred' THEN
    UPDATE public.email_campaign_recipients SET status = 'planned', lease_until = NULL,
      attempt_count = GREATEST(attempt_count - 1, 0), error = left(p_error, 500),
      not_before = LEAST(GREATEST(COALESCE(p_not_before, now() + interval '15 minutes'), now() + interval '1 minute'), now() + interval '24 hours'),
      updated_at = now()
     WHERE id = r.id;
    RETURN 'deferred';
  END IF;
  UPDATE public.email_campaign_recipients SET status = p_outcome, lease_until = NULL,
    provider_message_id = COALESCE(p_provider_message_id, provider_message_id), message_id = COALESCE(p_message_id, message_id),
    skip_reason = CASE WHEN p_outcome = 'skipped' THEN COALESCE(p_skip_reason, 'sender_refused') ELSE skip_reason END,
    error = left(p_error, 500), sent_at = CASE WHEN p_outcome = 'sent' THEN now() ELSE sent_at END, updated_at = now()
   WHERE id = r.id;
  IF p_outcome = 'sent' AND r.route = 'managed' THEN
    INSERT INTO public.platform_metered_events (tenant_id, layer, subject_type, subject_id, service_category, event_type,
      provider, quantity, wholesale_cost_usd, occurred_at, idempotency_key, metadata, end_customer_contact_id)
    VALUES (r.tenant_id, 'L3_tenant_passthrough', 'tenant', r.tenant_id, 'email', 'marketing_email_sent',
      COALESCE((SELECT v.sender_snapshot->>'provider' FROM public.email_campaign_versions v WHERE v.id = r.version_id), 'resend'), 1,
      public.email_campaign_unit_cost_usd(), now(), 'email_campaign_recipient:' || r.id::text,
      jsonb_build_object('campaign_id', r.campaign_id, 'version_id', r.version_id, 'cost_is_estimate', true), r.client_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN p_outcome;
END $$;
