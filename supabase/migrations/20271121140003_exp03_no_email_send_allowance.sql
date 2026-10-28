-- ============================================================================
-- Experience 03 — PAIGE imposes no sending stop on a business's own marketing email.
--
-- Owner ruling (2026-10-27, billing): each tenant's own usage is billed uncapped, with a 25% contribution
-- target; PAIGE imposes no spending or sending stops. public.email_campaign_daily_cap() returns a fixed 500,
-- and three seams enforced it as a send allowance per business per 24 hours:
--
--   1. email_campaign_request_approval — refused to file a campaign planned to more than 500 people
--      (over_daily_cap);
--   2. email_sequence_request_approval — refused to file a "matching" series that matched more than 500
--      people now (over_daily_cap), and wrote that 500 into the approval as daily_limit together with a
--      daily_cost_bound_usd computed as 500 × the unit cost;
--   3. email_campaign_dispatch_claim — skipped any business whose sent-or-in-flight count in 24 hours had
--      reached 500, and leased at most (500 − that count) per claim, answering waiting:'daily_cap'
--      otherwise. A per-business advisory lock existed only so two workers could not overshoot that room.
--
-- CHOICE (a), not (b). Each of the three bodies is redefined with the allowance removed. Making the cap
-- function return NULL instead would leave every refusal path in place, unreachable only by accident of
-- SQL's NULL comparisons, and would BREAK the claim: `_email_used_today(...) < NULL` is NULL, so the WHERE
-- would admit no campaign at all, and GREATEST(NULL − used, 0) is 0, so every claim would answer
-- waiting:'daily_cap'. (a) leaves no dead refusal path and no false "daily limit" in an approval.
--
-- WHAT EACH BODY IS. Each body is VERBATIM the current production definition — md5(prosrc) read from
-- production 2026-10-28 and equal to a fresh local replay of every repository migration to 20271120120003:
--   email_campaign_request_approval  569a91cd2ef651ddc8b529db01153496  (20271111060000)
--   email_sequence_request_approval  51baf982d2b0f45b753ebe6a89f30dc7  (20270580000000)
--   email_campaign_dispatch_claim    870338d0a58a0d8e2a39444d3f5a6c9d  (20271120120003)
-- minus exactly the allowance lines: in (1) the over_daily_cap block; in (2) the `cap` variable, the
-- over_daily_cap block, and the daily_limit / daily_cost_bound_usd approval keys derived from it (no reader:
-- searched daily_cost_bound, daily_limit, matching_now across supabase/migrations, supabase/functions, src
-- and scripts — only this function writes them); in (3) the 24-hour WHERE predicate, the room variable, the
-- advisory lock that guarded it, the waiting:'daily_cap' return, and LEAST(lim, room) → lim. The claim still
-- leases at most 100 per call (lim), and the recipient rows are still taken FOR UPDATE SKIP LOCKED, so two
-- workers cannot lease the same person.
--
-- ONE ADDITION in (3), fairness across businesses (review M1). The cap also made the queue fair by accident:
-- a business at 500 dropped out, so one business could not hold the dispatcher for long. Without it, the
-- claim's old order (oldest due first) would hand one business's very large campaign every pass until it
-- drained while other businesses waited for hours. The claim now orders due campaigns by when their business
-- was last CLAIMED — least recently first — and only then by oldest due. That is SCHEDULING ORDER ONLY: no
-- campaign is refused, held or made to wait for a limit; every due campaign is still claimable on any pass,
-- and `FOR UPDATE OF ca SKIP LOCKED` and `LIMIT lim` are unchanged.
-- "Last claimed" is the newest updated_at among ALL the business's campaigns, a first-row probe of the existing
-- index email_campaigns_tenant_updated (tenant_id, updated_at DESC). Every claim already stamps its campaign's
-- updated_at; it now uses clock_timestamp() so two claims in one transaction still order. No status filter: a
-- small campaign is claimed and settled (completed) in one pass, and a filter would drop that stamp, putting a
-- business with many small campaigns first again every pass. Settling and editing only move the key later. Keying on the claim, not on a successful send, is deliberate (round-3 review): a
-- send that is deferred (quiet hours, do-not-disturb), fails or ends outcome_unknown writes no sent_at, so a
-- send-based key would leave a business that never completes a send first in line on every pass. Series
-- emails are campaigns (email_campaigns.sequence_id) claimed by this same function, so they share the same
-- fairness; email_sequence_tick only enrols and plans and is unaffected. Known limit: a second worker running
-- while the first has not committed its claim sees the old stamp and may claim the same business; the worker
-- runs one pass a minute, so this is a tie-break, not a starvation path.
--
-- UNCHANGED, AND STILL ENFORCED: who may file (owner/admin of the business), the postal address, the sender,
-- the audience rule check, suppression / opt-out / consent / portal checks at plan AND again at send,
-- "a new version never goes again to someone an earlier version reached", the person-only approval, the
-- content-hash binding, the per-campaign cost_bound_usd (the exact recipients × unit cost, which already had
-- no daily element), and the worker's own per-call lease bound. Signature, return type, language,
-- volatility, SECURITY DEFINER, search_path, owner and grants are unchanged: CREATE OR REPLACE keeps the
-- owner and the ACL ({postgres, authenticated} for the two filers; {postgres, service_role} for the claim).
--
-- NOT CHANGED HERE, deliberately: email_campaign_daily_cap() itself and the three readers that report it
-- (email_audience_preview, read_email_marketing_dashboard, _read_email_sequence_before_series_chat — the
-- body read_email_sequence wraps; read on production 2026-10-28: these and the three seams above are the
-- only functions whose source names the cap) keep their response shape (§37). Those figures now describe
-- nothing PAIGE enforces; the Marketing › Email screens no longer read daily_cap / remaining_today (they show
-- used_last_24h as a plain count), and the function's comment below says so. _email_used_today() stays: the
-- readers still count the last 24 hours.
--
-- Producers (§37) of the three changed seams: email_campaign_request_approval — the Marketing › Email
-- editor (src/solo/marketing-email-editor.tsx) and PAIGE's chat filing (email_campaign_submit_for_approval,
-- 20270564000000); email_sequence_request_approval — the series view (src/solo/marketing-email-series.tsx)
-- and PAIGE's series filing (20270595000000); email_campaign_dispatch_claim — email-campaign-worker only
-- (service_role). Every request shape is unchanged; the only response change is that the claim no longer
-- answers waiting:'daily_cap' (the worker already treats any `waiting` as "nothing to send this pass").
-- ============================================================================

CREATE OR REPLACE FUNCTION public.email_campaign_request_approval(p_version_id uuid, p_source text DEFAULT 'owner'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t uuid := public._email_caller_tenant();
  v public.email_campaign_versions%ROWTYPE; c public.email_campaigns%ROWTYPE;
  snd jsonb; n int; hash text; appr uuid; cost numeric;
BEGIN
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = p_version_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND OR v.state <> 'draft' THEN RAISE EXCEPTION 'not_an_editable_draft' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO c FROM public.email_campaigns WHERE id = v.campaign_id FOR UPDATE;
  IF c.current_version_id IS DISTINCT FROM v.id THEN RAISE EXCEPTION 'not_the_current_version' USING ERRCODE = 'P0001'; END IF;
  IF btrim(v.subject) = '' THEN RAISE EXCEPTION 'subject_required' USING ERRCODE = 'P0001'; END IF;
  IF btrim(v.body_html) = '' THEN RAISE EXCEPTION 'body_required' USING ERRCODE = 'P0001'; END IF;
  IF v.scheduled_for IS NOT NULL AND v.scheduled_for < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'schedule_in_past' USING ERRCODE = 'P0001';
  END IF;
  IF public._email_postal_address(t) IS NULL THEN RAISE EXCEPTION 'postal_address_missing' USING ERRCODE = 'P0001'; END IF;
  snd := public._email_resolve_sender(t, v.sender);
  -- E09 C1: the rule this version would freeze uses only keys the audience knows (a saved segment's too).
  PERFORM public._email_campaign_rule_check(public._email_version_rule(v));
  IF NOT (snd->>'ok')::boolean THEN RAISE EXCEPTION '%', snd->>'reason' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO public.email_campaign_recipients (campaign_id, version_id, tenant_id, client_id, email, status)
  SELECT v.campaign_id, v.id, t, a.client_id, a.email, 'planned'
    FROM public._email_audience(t, public._email_version_rule(v), c.kind = 'newsletter', c.kind) a
   WHERE a.ineligible IS NULL
     -- A new version of a campaign never goes again to someone an earlier version already reached.
     AND NOT EXISTS (SELECT 1 FROM public.email_campaign_recipients prev
                      WHERE prev.campaign_id = v.campaign_id AND prev.email = a.email
                        AND prev.status IN ('sent','sending','outcome_unknown'))
  ON CONFLICT (version_id, email) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'no_eligible_recipients' USING ERRCODE = 'P0001'; END IF;

  -- The snapshot of a segment is the segment's rule at this moment, frozen into the version.
  IF v.segment_id IS NOT NULL THEN
    UPDATE public.email_campaign_versions SET audience = public._email_version_rule(v) WHERE id = v.id;
    SELECT * INTO v FROM public.email_campaign_versions WHERE id = v.id;
  END IF;
  hash := public._email_version_hash(v, c.kind);
  cost := CASE WHEN snd->>'mode' = 'managed' OR COALESCE((snd->>'platform_funded')::boolean, false) THEN round(n * public.email_campaign_unit_cost_usd(), 4) ELSE 0 END;

  INSERT INTO public.paige_pending_approvals (type, tenant_id, status, category, source, summary, priority, risk_level,
    submitted_by_user_id, draft_content, metadata)
  VALUES ('campaign_send', t, 'pending', 'campaign', CASE WHEN p_source = 'paige' THEN 'paige' ELSE 'owner' END,
    format('Send "%s" to %s %s', left(v.subject, 120), n, CASE WHEN n = 1 THEN 'person' ELSE 'people' END), 2, 'medium',
    auth.uid(),
    jsonb_build_object('campaign_id', c.id, 'campaign_name', c.name, 'subject', v.subject, 'recipients', n,
      'from_address', snd->>'from_address', 'scheduled_for', v.scheduled_for),
    jsonb_build_object('email_campaign_version_id', v.id, 'content_hash', hash, 'expected_recipients', n,
      'cost_bound_usd', cost, 'sender', snd))
  RETURNING id INTO appr;

  UPDATE public.email_campaign_versions SET state = 'locked', content_hash = hash, sender_snapshot = snd,
    expected_recipients = n, cost_bound_usd = cost, approval_id = appr, locked_at = now(), updated_at = now()
   WHERE id = v.id;
  UPDATE public.email_campaigns SET status = 'pending_approval', blocked_reason = NULL, updated_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('approval_id', appr, 'version_id', v.id, 'recipients', n, 'cost_bound_usd', cost,
    'from_address', snd->>'from_address');
END $function$;

CREATE OR REPLACE FUNCTION public.email_sequence_request_approval(p_sequence_id uuid, p_source text DEFAULT 'owner'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  t uuid := public._email_caller_tenant();
  s public.email_sequences%ROWTYPE; v public.email_sequence_versions%ROWTYPE;
  snd jsonb; n int; steps int; bad int; hash text; appr uuid;
  outline jsonb; summary text;
BEGIN
  v := public._email_sequence_draft(t, p_sequence_id);
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id;
  SELECT count(*), min(position) FILTER (WHERE btrim(subject) = '' OR btrim(body_html) = '') INTO steps, bad
    FROM public.email_sequence_steps WHERE version_id = v.id;
  IF steps = 0 THEN RAISE EXCEPTION 'steps_required' USING ERRCODE = 'P0001'; END IF;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'step_incomplete' USING ERRCODE = 'P0001', DETAIL = format('Email %s needs a subject and words.', bad);
  END IF;
  IF public._email_postal_address(t) IS NULL THEN RAISE EXCEPTION 'postal_address_missing' USING ERRCODE = 'P0001'; END IF;
  snd := public._email_resolve_sender(t, v.sender);
  IF NOT (snd->>'ok')::boolean THEN RAISE EXCEPTION '%', snd->>'reason' USING ERRCODE = 'P0001'; END IF;

  -- The segment's rule at this moment is frozen into the version, as a campaign's is.
  IF v.segment_id IS NOT NULL THEN
    UPDATE public.email_sequence_versions SET audience = public._email_sequence_rule(v.id) WHERE id = v.id;
    SELECT * INTO v FROM public.email_sequence_versions WHERE id = v.id;
  END IF;
  -- The rule is checked and run here in both modes, so a rule the tick could not run never starts.
  PERFORM public._email_sequence_rule_check(v.audience);
  IF v.entry_mode <> 'matching' THEN PERFORM count(*) FROM public._email_audience(t, v.audience, false); END IF;
  IF v.entry_mode = 'matching' THEN
    SELECT count(*) INTO n FROM public._email_audience(t, v.audience, false) a WHERE a.ineligible IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.email_sequence_enrollments x WHERE x.sequence_id = s.id AND x.client_id = a.client_id);
  END IF;
  hash := public._email_sequence_hash(v.id, s.kind);
  SELECT jsonb_agg(jsonb_build_object('position', position, 'delay_minutes', delay_minutes, 'subject', subject) ORDER BY position)
    INTO outline FROM public.email_sequence_steps WHERE version_id = v.id;
  summary := format('Start "%s": %s %s %s', left(s.name, 120), steps, CASE WHEN steps = 1 THEN 'email' ELSE 'emails' END,
    CASE WHEN v.entry_mode = 'new_contacts' THEN 'to new contacts as they arrive'
         ELSE format('to %s %s now and anyone who matches later', n, CASE WHEN n = 1 THEN 'person' ELSE 'people' END) END);
  IF s.live_version_id IS NOT NULL THEN summary := format('Change "%s": %s', left(s.name, 120),
    CASE WHEN v.entry_mode = 'new_contacts' THEN format('%s %s to new contacts', steps, CASE WHEN steps = 1 THEN 'email' ELSE 'emails' END)
         ELSE format('%s %s to anyone who matches', steps, CASE WHEN steps = 1 THEN 'email' ELSE 'emails' END) END); END IF;

  INSERT INTO public.paige_pending_approvals (type, tenant_id, status, category, source, summary, priority, risk_level,
    submitted_by_user_id, draft_content, metadata)
  VALUES ('campaign_send', t, 'pending', 'campaign', CASE WHEN p_source = 'paige' THEN 'paige' ELSE 'owner' END,
    summary, 2, 'medium', auth.uid(),
    jsonb_build_object('sequence_id', s.id, 'sequence_name', s.name, 'emails', outline, 'entry_mode', v.entry_mode,
      'matching_now', n, 'from_address', snd->>'from_address'),
    jsonb_build_object('email_sequence_version_id', v.id, 'content_hash', hash, 'matching_now', n,
      'sender', snd))
  RETURNING id INTO appr;

  UPDATE public.email_sequence_versions SET state = 'locked', content_hash = hash, sender_snapshot = snd,
    expected_entrants = n, approval_id = appr, locked_at = now(), updated_at = now()
   WHERE id = v.id;
  UPDATE public.email_sequences SET status = CASE WHEN s.live_version_id IS NULL THEN 'pending_approval' ELSE s.status END,
    updated_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('approval_id', appr, 'sequence_id', s.id, 'version_id', v.id, 'emails', steps,
    'matching_now', n, 'from_address', snd->>'from_address');
END $function$;

CREATE OR REPLACE FUNCTION public.email_campaign_dispatch_claim(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c public.email_campaigns%ROWTYPE; v public.email_campaign_versions%ROWTYPE;
  snd jsonb; addr text; batch jsonb; active boolean; lim int := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
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
   -- Fair across businesses, scheduling order only (never a refusal or a wait): the business claimed least
   -- recently goes first, whether or not its last claim ended in a send; then the oldest due.
   ORDER BY (SELECT max(cb.updated_at) FROM public.email_campaigns cb WHERE cb.tenant_id = ca.tenant_id) ASC,
            COALESCE(ve.scheduled_for, ve.approved_at) ASC
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

  WITH picked AS (
    SELECT id FROM public.email_campaign_recipients
     WHERE version_id = v.id AND status = 'planned' AND (not_before IS NULL OR not_before <= now()) ORDER BY created_at, id
     LIMIT lim FOR UPDATE SKIP LOCKED
  ), leased AS (
    UPDATE public.email_campaign_recipients r SET status = 'sending', attempt_count = r.attempt_count + 1,
      lease_until = now() + interval '10 minutes', route = CASE WHEN snd->>'mode' = 'managed' OR COALESCE((snd->>'platform_funded')::boolean, false) THEN 'managed' ELSE 'connector' END, updated_at = now()
      FROM picked WHERE r.id = picked.id
    RETURNING r.id, r.client_id, r.email
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'client_id', client_id, 'email', email)), '[]'::jsonb) INTO batch FROM leased;

  -- clock_timestamp(), not now(): this stamp is the fairness key above, and must order within one transaction.
  UPDATE public.email_campaigns SET status = 'sending', updated_at = clock_timestamp() WHERE id = c.id;
  RETURN jsonb_build_object(
    'campaign', jsonb_build_object('id', c.id, 'tenant_id', c.tenant_id, 'kind', c.kind, 'name', c.name,
      'version_id', v.id, 'approved_by', v.approved_by),
    'content', jsonb_build_object('subject', v.subject, 'preheader', v.preheader, 'body_html', v.body_html),
    'sender', snd, 'postal_address', addr,
    'business_name', (SELECT COALESCE(NULLIF(btrim(p.brand_display_name), ''), NULLIF(btrim(p.dba_name), ''), p.legal_business_name)
                        FROM public.tenant_legal_profile p WHERE p.tenant_id = c.tenant_id ORDER BY p.updated_at DESC NULLS LAST LIMIT 1),
    'recipients', batch);
END $function$;

COMMENT ON FUNCTION public.email_campaign_daily_cap() IS
  'Display figure only. Since 20271121140003 nothing enforces it: filing and sending a business''s marketing email have no daily allowance (owner ruling 2026-10-27). Kept because three readers still return it for response-shape compatibility; no screen reads it.';
