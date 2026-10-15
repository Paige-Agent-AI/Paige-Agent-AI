-- Marketing email E2: the Email dashboard's one read (owner reference 2026-10-04).
--
-- read_email_marketing_dashboard(p_days, p_tz) returns everything the Email tab shows, for the caller's
-- own business only (owner or admin; _email_caller_tenant raises otherwise). Read-only; it writes nothing.
-- Every figure comes from a canonical producer (owner ruling 11). A campaign's figures cover all of its
-- versions: "Edit and send again" adds to its history rather than replacing it.
--   sent, failed, not confirmed      email_campaign_recipients.status / sent_at (the dispatcher)
--   delivered, opened, clicked,      email_campaign_recipients.*_at, written by process_resend_receipt from
--   bounced, complained              the provider's signed webhook. Only Paige's own sender reports them;
--                                    email sent through a business's own Gmail or mail server does not, so
--                                    rates use `tracked` (managed-route sends) as their denominator.
--   new subscribers                  paige_consent_events, email / newsletter / granted
--   unsubscribes                     paige_suppressions, email / unsubscribe_link (comms-email-unsubscribe)
--   conversions                      owner ruling: the campaign's goal, reached by the contact within 7 days
--                                    after a click — growth_form_submissions (form_submission),
--                                    internal_bookings (booking), deals (deal_created), paige_invoices.paid_at
--                                    (invoice_paid); a cancelled booking does not count. A contact counts once
--                                    per period, in the period of the click, whenever the email was sent.
-- Periods: the last p_days days (7, 30 or 90) and the p_days before them, for comparison. Daily buckets are
-- calendar days in p_tz (an IANA zone; anything unknown reads as UTC).

-- The reads below gather a campaign's recipients across all of its versions; E1 indexed recipients by
-- version, tenant and lease only.
CREATE INDEX IF NOT EXISTS email_campaign_recipients_campaign_idx
  ON public.email_campaign_recipients (campaign_id, sent_at);

CREATE OR REPLACE FUNCTION public.read_email_marketing_dashboard(p_days integer DEFAULT 30, p_tz text DEFAULT 'UTC')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_caller_tenant();
  days integer := CASE WHEN p_days IN (7, 30, 90) THEN p_days ELSE 30 END;
  tz text := CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz) THEN p_tz ELSE 'UTC' END;
  now_ts timestamptz := now();
  cur_from timestamptz;
  prev_from timestamptz;
  used integer;
  out jsonb;
BEGIN
  cur_from := now_ts - make_interval(days => days);
  prev_from := now_ts - make_interval(days => days * 2);
  used := public._email_used_today(t);

  WITH r AS (
    SELECT r.*, v.conversion_goal FROM public.email_campaign_recipients r
      JOIN public.email_campaign_versions v ON v.id = r.version_id
     WHERE r.tenant_id = t AND r.sent_at >= prev_from
  ), clicks AS (
    -- every click in either period, whenever its email went out
    SELECT r.*, v.conversion_goal FROM public.email_campaign_recipients r
      JOIN public.email_campaign_versions v ON v.id = r.version_id
     WHERE r.tenant_id = t AND r.clicked_at >= prev_from
  ), conv AS (
    SELECT r.client_id, r.clicked_at FROM clicks r
     WHERE r.clicked_at IS NOT NULL AND r.client_id IS NOT NULL AND r.conversion_goal <> 'none' AND (
       (r.conversion_goal = 'form_submission' AND EXISTS (SELECT 1 FROM public.growth_form_submissions g
          WHERE g.tenant_id = t AND g.contact_id = r.client_id AND g.created_at > r.clicked_at AND g.created_at <= r.clicked_at + interval '7 days'))
       OR (r.conversion_goal = 'booking' AND EXISTS (SELECT 1 FROM public.internal_bookings b
          WHERE b.tenant_id = t AND b.contact_id = r.client_id AND b.created_at > r.clicked_at AND b.created_at <= r.clicked_at + interval '7 days'
            AND lower(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled')))
       OR (r.conversion_goal = 'deal_created' AND EXISTS (SELECT 1 FROM public.deals d
          WHERE d.tenant_id = t AND d.contact_client_id = r.client_id AND d.created_at > r.clicked_at AND d.created_at <= r.clicked_at + interval '7 days'))
       OR (r.conversion_goal = 'invoice_paid' AND EXISTS (SELECT 1 FROM public.paige_invoices i
          WHERE i.tenant_id = t AND i.contact_id = r.client_id AND i.paid_at > r.clicked_at AND i.paid_at <= r.clicked_at + interval '7 days'))
     )
  ), stats AS (
    SELECT
      count(*) FILTER (WHERE sent_at >= cur_from) AS sent,
      count(*) FILTER (WHERE sent_at < cur_from) AS sent_prev,
      count(*) FILTER (WHERE sent_at >= cur_from AND route = 'managed') AS tracked,
      count(*) FILTER (WHERE sent_at < cur_from AND route = 'managed') AS tracked_prev,
      count(*) FILTER (WHERE sent_at >= cur_from AND route = 'managed' AND opened_at IS NOT NULL) AS opened,
      count(*) FILTER (WHERE sent_at < cur_from AND route = 'managed' AND opened_at IS NOT NULL) AS opened_prev,
      count(*) FILTER (WHERE sent_at >= cur_from AND route = 'managed' AND clicked_at IS NOT NULL) AS clicked,
      count(*) FILTER (WHERE sent_at < cur_from AND route = 'managed' AND clicked_at IS NOT NULL) AS clicked_prev,
      count(*) FILTER (WHERE sent_at >= cur_from AND bounced_at IS NOT NULL) AS bounced
    FROM r
  )
  SELECT jsonb_build_object(
    'period_days', days, 'time_zone', tz, 'generated_at', now_ts,
    'stats', (SELECT to_jsonb(s) FROM stats s) || jsonb_build_object(
      -- a contact who reached a goal counts once in a period, however many campaigns they clicked
      'conversions', (SELECT count(DISTINCT client_id) FROM conv WHERE clicked_at >= cur_from),
      'conversions_prev', (SELECT count(DISTINCT client_id) FROM conv WHERE clicked_at >= prev_from AND clicked_at < cur_from),
      'new_subscribers', (SELECT count(*) FROM public.paige_consent_events e WHERE e.tenant_id = t AND e.channel = 'email'
                            AND e.topic = 'newsletter' AND e.action = 'granted' AND e.created_at >= cur_from),
      'new_subscribers_prev', (SELECT count(*) FROM public.paige_consent_events e WHERE e.tenant_id = t AND e.channel = 'email'
                            AND e.topic = 'newsletter' AND e.action = 'granted' AND e.created_at >= prev_from AND e.created_at < cur_from),
      'unsubscribes', (SELECT count(*) FROM public.paige_suppressions s WHERE s.tenant_id = t AND s.channel = 'email'
                            AND s.reason = 'unsubscribe_link' AND s.created_at >= cur_from)),
    'series', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('day', d.day, 'sent', COALESCE(x.sent, 0), 'tracked', COALESCE(x.tracked, 0),
                                          'opened', COALESCE(x.opened, 0), 'clicked', COALESCE(x.clicked, 0)) ORDER BY d.day)
        FROM generate_series((cur_from AT TIME ZONE tz)::date + 1, (now_ts AT TIME ZONE tz)::date, interval '1 day') AS d(day)
        LEFT JOIN (
          SELECT (sent_at AT TIME ZONE tz)::date AS day, count(*) AS sent,
                 count(*) FILTER (WHERE route = 'managed') AS tracked,
                 count(*) FILTER (WHERE route = 'managed' AND opened_at IS NOT NULL) AS opened,
                 count(*) FILTER (WHERE route = 'managed' AND clicked_at IS NOT NULL) AS clicked
            FROM r WHERE sent_at >= cur_from GROUP BY 1) x ON x.day = d.day::date), '[]'::jsonb),
    'campaign_count', (SELECT count(*) FROM public.email_campaigns c WHERE c.tenant_id = t),
    'campaigns', COALESCE((
      SELECT jsonb_agg(q.item ORDER BY q.updated_at DESC) FROM (
        SELECT c.updated_at, jsonb_build_object(
          'id', c.id, 'name', c.name, 'kind', c.kind, 'status', c.status, 'blocked_reason', c.blocked_reason,
          'updated_at', c.updated_at, 'version_id', v.id, 'version_state', v.state, 'subject', v.subject,
          'scheduled_for', v.scheduled_for, 'segment_name', sg.name, 'conversion_goal', v.conversion_goal,
          'recipients', COALESCE(NULLIF(cv.total, 0), NULLIF(a.total, 0), v.expected_recipients), 'first_sent_at', a.first_sent, 'last_sent_at', a.last_sent,
          'sent', COALESCE(a.sent, 0), 'tracked', COALESCE(a.tracked, 0), 'opened', COALESCE(a.opened, 0),
          'clicked', COALESCE(a.clicked, 0), 'failed', COALESCE(a.failed, 0), 'not_confirmed', COALESCE(a.unknown, 0),
          'skipped', COALESCE(a.skipped, 0), 'waiting', COALESCE(cv.waiting, 0)) AS item
        FROM public.email_campaigns c
        LEFT JOIN public.email_campaign_versions v ON v.id = c.current_version_id
        LEFT JOIN public.email_segments sg ON sg.id = v.segment_id
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE status NOT IN ('cancelled')) AS total, min(sent_at) AS first_sent, max(sent_at) AS last_sent,
                 count(*) FILTER (WHERE status = 'sent') AS sent,
                 count(*) FILTER (WHERE status = 'sent' AND route = 'managed') AS tracked,
                 count(*) FILTER (WHERE route = 'managed' AND opened_at IS NOT NULL) AS opened,
                 count(*) FILTER (WHERE route = 'managed' AND clicked_at IS NOT NULL) AS clicked,
                 count(*) FILTER (WHERE status = 'failed') AS failed,
                 count(*) FILTER (WHERE status = 'outcome_unknown') AS unknown,
                 count(*) FILTER (WHERE status = 'skipped') AS skipped
            FROM public.email_campaign_recipients rr
           WHERE rr.campaign_id = c.id) a ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS total, count(*) FILTER (WHERE status IN ('planned','sending')) AS waiting
            FROM public.email_campaign_recipients rr WHERE rr.version_id = v.id) cv ON true
        WHERE c.tenant_id = t
        ORDER BY c.updated_at DESC LIMIT 8) q), '[]'::jsonb),
    'audience', (
      SELECT jsonb_build_object(
        'contacts', count(*),
        'with_email', count(*) FILTER (WHERE em.has_email),
        'new_leads', count(*) FILTER (WHERE c.lifecycle_stage IN ('new_lead','lead','prospect','nurturing')),
        'customers', count(*) FILTER (WHERE c.lifecycle_stage IN ('won','customer','active','client_active','client_paused','client_funded')),
        'inactive_90', count(*) FILTER (WHERE c.last_contacted_at IS NULL AND c.created_at < now_ts - interval '90 days'
                                         OR c.last_contacted_at < now_ts - interval '90 days'),
        'newsletter_subscribers', count(*) FILTER (WHERE em.has_email AND public._email_newsletter_subscribed(t, c.id, NULL)))
        FROM public.clients c
        LEFT JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM public.client_contact_methods cm WHERE cm.client_id = c.id
                             AND cm.tenant_id = t AND cm.kind = 'email' AND btrim(cm.value) LIKE '%_@_%._%') AS has_email) em ON true
       WHERE c.tenant_id = t AND c.merged_into_contact_id IS NULL),
    'segment_count', (SELECT count(*) FROM public.email_segments s WHERE s.tenant_id = t),
    'segments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'rule', s.rule,
               'eligible', (SELECT count(*) FROM public._email_audience(t, s.rule, false) a WHERE a.ineligible IS NULL),
               'matched', (SELECT count(*) FROM public._email_audience(t, s.rule, false))) ORDER BY s.updated_at DESC)
        FROM (SELECT * FROM public.email_segments WHERE tenant_id = t ORDER BY updated_at DESC LIMIT 6) s), '[]'::jsonb),
    'activity', COALESCE((
      SELECT jsonb_agg(x.e ORDER BY x.at DESC) FROM (
        SELECT u.e, u.at FROM (
          (SELECT jsonb_build_object('kind', 'campaign_sent', 'at', ls.last_sent, 'title', c.name, 'campaign_id', c.id,
                                     'detail', c.status) AS e, ls.last_sent AS at
             FROM public.email_campaigns c
             JOIN LATERAL (SELECT max(rr.sent_at) AS last_sent FROM public.email_campaign_recipients rr
                            WHERE rr.campaign_id = c.id AND rr.sent_at IS NOT NULL) ls ON ls.last_sent IS NOT NULL
            WHERE c.tenant_id = t
            ORDER BY ls.last_sent DESC LIMIT 8)
          UNION ALL
          (SELECT jsonb_build_object('kind', CASE WHEN s.reason = 'unsubscribe_link' THEN 'unsubscribed' ELSE 'bounced' END,
                                     'at', s.created_at, 'detail', s.reason) AS e, s.created_at AS at
             FROM public.paige_suppressions s WHERE s.tenant_id = t AND s.channel = 'email'
              AND s.reason IN ('unsubscribe_link','bounce_hard','complaint')
             ORDER BY s.created_at DESC LIMIT 8)
          UNION ALL
          (SELECT jsonb_build_object('kind', 'subscribed', 'at', ce.created_at, 'detail', ce.source) AS e, ce.created_at AS at
             FROM public.paige_consent_events ce WHERE ce.tenant_id = t AND ce.channel = 'email' AND ce.topic = 'newsletter'
              AND ce.action = 'granted'
             ORDER BY ce.created_at DESC LIMIT 8)
        ) u ORDER BY u.at DESC LIMIT 8) x), '[]'::jsonb),
    'sending', jsonb_build_object('daily_cap', public.email_campaign_daily_cap(), 'used_last_24h', used,
                                  'remaining_today', GREATEST(public.email_campaign_daily_cap() - used, 0),
                                  'postal_address_set', public._email_postal_address(t) IS NOT NULL)
  ) INTO out;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.read_email_marketing_dashboard(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_email_marketing_dashboard(integer, text) TO authenticated;

-- read_email_campaign(p_campaign_id): one campaign, as the editor shows it, for the caller's own business.
-- The footer facts (business name, postal address) are the ones the dispatcher sends with, so the preview
-- is the email as sent. Sender choices list every email connection the business has, healthy or not, and
-- PAIGE's managed address; `resolves` says which would send right now (it never substitutes one for another).
CREATE OR REPLACE FUNCTION public.read_email_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_caller_tenant();
  c public.email_campaigns%ROWTYPE;
  v public.email_campaign_versions%ROWTYPE;
  out jsonb;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = c.current_version_id;
  SELECT jsonb_build_object(
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'status', c.status,
      'blocked_reason', c.blocked_reason, 'created_at', c.created_at, 'updated_at', c.updated_at),
    'version', jsonb_build_object('id', v.id, 'version_no', v.version_no, 'state', v.state, 'subject', v.subject,
      'preheader', v.preheader, 'body_html', v.body_html, 'sender', v.sender, 'sender_snapshot', v.sender_snapshot,
      'audience', v.audience, 'segment_id', v.segment_id, 'scheduled_for', v.scheduled_for,
      'conversion_goal', v.conversion_goal, 'expected_recipients', v.expected_recipients,
      'cost_bound_usd', v.cost_bound_usd, 'approval_id', v.approval_id, 'locked_at', v.locked_at,
      'approved_at', v.approved_at, 'updated_at', v.updated_at),
    'approval', (SELECT jsonb_build_object('status', a.status, 'source', a.source, 'reviewed_at', a.reviewed_at)
                   FROM public.paige_pending_approvals a WHERE a.id = v.approval_id),
    'last_declined', (SELECT jsonb_build_object('reason', a.decision_rationale, 'at', a.reviewed_at, 'version_no', pv.version_no)
                        FROM public.email_campaign_versions pv JOIN public.paige_pending_approvals a ON a.id = pv.approval_id
                       WHERE pv.campaign_id = c.id AND pv.id <> v.id AND a.status = 'rejected'
                       ORDER BY pv.version_no DESC LIMIT 1),
    'progress', (SELECT jsonb_build_object(
                   'total', count(*), 'planned', count(*) FILTER (WHERE status = 'planned'),
                   'sending', count(*) FILTER (WHERE status = 'sending'), 'sent', count(*) FILTER (WHERE status = 'sent'),
                   'failed', count(*) FILTER (WHERE status = 'failed'), 'not_confirmed', count(*) FILTER (WHERE status = 'outcome_unknown'),
                   'skipped', count(*) FILTER (WHERE status = 'skipped'), 'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
                   'tracked', count(*) FILTER (WHERE status = 'sent' AND route = 'managed'),
                   'opened', count(*) FILTER (WHERE route = 'managed' AND opened_at IS NOT NULL),
                   'clicked', count(*) FILTER (WHERE route = 'managed' AND clicked_at IS NOT NULL))
                   FROM public.email_campaign_recipients WHERE campaign_id = c.id),
    'senders', COALESCE((SELECT jsonb_agg(jsonb_build_object('mode', 'connector', 'connector_id', cc.id, 'provider', cc.provider,
                   'from_address', cc.from_address, 'from_name', cc.from_name,
                   'healthy', cc.active AND cc.status = 'active' AND NULLIF(btrim(COALESCE(cc.from_address, '')), '') IS NOT NULL)
                   ORDER BY cc.updated_at DESC NULLS LAST)
                   FROM public.channel_connectors cc WHERE cc.tenant_id = t AND cc.channel_type = 'email'
                    AND COALESCE((cc.config->>'managed_default')::boolean, false) = false), '[]'::jsonb),
    'managed_sender', public._email_resolve_sender(t, '{"mode":"managed"}'::jsonb),
    'resolves', public._email_resolve_sender(t, v.sender),
    'postal_address', public._email_postal_address(t),
    'business_name', (SELECT COALESCE(NULLIF(btrim(p.brand_display_name), ''), NULLIF(btrim(p.dba_name), ''), p.legal_business_name)
                        FROM public.tenant_legal_profile p WHERE p.tenant_id = t ORDER BY p.updated_at DESC NULLS LAST LIMIT 1),
    'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'rule', s.rule) ORDER BY s.name)
                   FROM public.email_segments s WHERE s.tenant_id = t), '[]'::jsonb),
    'choices', public._email_rule_choices(t)
  ) INTO out;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.read_email_campaign(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_email_campaign(uuid) TO authenticated;

-- The stages, sources and tags a business's contacts actually carry, for building an audience rule.
CREATE OR REPLACE FUNCTION public._email_rule_choices(p_tenant uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'stages', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC, k) FROM (
        SELECT lifecycle_stage AS k, count(*) AS n FROM public.clients
         WHERE tenant_id = p_tenant AND merged_into_contact_id IS NULL AND lifecycle_stage IS NOT NULL GROUP BY 1) s), '[]'::jsonb),
    'sources', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC, k) FROM (
        SELECT source AS k, count(*) AS n FROM public.clients
         WHERE tenant_id = p_tenant AND merged_into_contact_id IS NULL AND NULLIF(btrim(source), '') IS NOT NULL GROUP BY 1) s), '[]'::jsonb),
    'tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC, k) FROM (
        SELECT tag AS k, count(*) AS n FROM public.clients, unnest(COALESCE(tags, '{}')) AS tag
         WHERE tenant_id = p_tenant AND merged_into_contact_id IS NULL AND NULLIF(btrim(tag), '') IS NOT NULL
         GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 60) s), '[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public._email_rule_choices(uuid) FROM PUBLIC, anon, authenticated;

-- The same choices for the segment builder on the dashboard, for the caller's own business.
CREATE OR REPLACE FUNCTION public.read_email_rule_choices()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public._email_rule_choices(public._email_caller_tenant());
END $$;
REVOKE ALL ON FUNCTION public.read_email_rule_choices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_email_rule_choices() TO authenticated;

-- ── E1 corrections (review of #1700 and of E2) ────────────────────────────────────────────────────
-- * Resend connections send with the platform key: costed, metered and tracked like PAIGE's sender
--   (_email_resolve_sender reports platform_funded; request_approval's cost bound and the claim's route use it).
-- * "Not contacted in N days" no longer includes contacts added within those N days (_email_audience).
-- * A segment used by a draft or a version awaiting approval cannot be deleted (email_segment_delete).
-- Each replacement keeps its existing grants (CREATE OR REPLACE preserves privileges).

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
    -- A Resend connection sends with the platform's own Resend key (send-message), so PAIGE pays for it:
    -- it is costed and metered like PAIGE's sender, and Resend reports its opens and clicks.
    RETURN jsonb_build_object('ok', true, 'mode', 'connector', 'connector_id', conn.id, 'provider', conn.provider,
      'from_address', lower(btrim(conn.from_address)), 'from_name', conn.from_name,
      'platform_funded', conn.provider = 'resend');
  END IF;
  ident := to_jsonb(public.tenant_sender_identity(p_tenant));
  IF ident IS NULL OR NULLIF(btrim(COALESCE(ident->>'from_address', '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sender_needs_attention');
  END IF;
  RETURN jsonb_build_object('ok', true, 'mode', 'managed', 'provider', 'resend',
    'from_address', lower(btrim(ident->>'from_address')), 'from_name', ident->>'from_name');
END $$;

CREATE OR REPLACE FUNCTION public._email_audience(p_tenant uuid, p_rule jsonb, p_newsletter boolean)
RETURNS TABLE (client_id uuid, email text, ineligible text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH rule AS (
    SELECT
      ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_rule->'stages') = 'array' THEN p_rule->'stages' ELSE '[]' END)) AS stages,
      ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_rule->'sources') = 'array' THEN p_rule->'sources' ELSE '[]' END)) AS sources,
      ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_rule->'tags') = 'array' THEN p_rule->'tags' ELSE '[]' END)) AS tags,
      CASE WHEN jsonb_typeof(p_rule->'inactive_days') = 'number' THEN (p_rule->>'inactive_days')::int END AS inactive_days
  ), matched AS (
    SELECT c.id, (COALESCE(c.do_not_contact,false) OR COALESCE(c.dnd_active,false) OR COALESCE(c.disqualified,false)) AS opted_out
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
  ), addressed AS (
    SELECT DISTINCT ON (m.id) m.id, m.opted_out, lower(btrim(cm.value)) AS email
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
                   AND (s.contact_id = a.id OR s.address_normalized = a.email))
        OR EXISTS (SELECT 1 FROM public.suppressed_emails g WHERE lower(btrim(g.email)) = a.email) THEN 'suppressed'
      WHEN p_newsletter AND NOT public._email_newsletter_subscribed(p_tenant, a.id, a.email) THEN 'no_consent'
    END
  FROM addressed a
$$;

CREATE OR REPLACE FUNCTION public.email_campaign_request_approval(p_version_id uuid, p_source text DEFAULT 'owner')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  IF NOT (snd->>'ok')::boolean THEN RAISE EXCEPTION '%', snd->>'reason' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO public.email_campaign_recipients (campaign_id, version_id, tenant_id, client_id, email, status)
  SELECT v.campaign_id, v.id, t, a.client_id, a.email, 'planned'
    FROM public._email_audience(t, public._email_version_rule(v), c.kind = 'newsletter') a
   WHERE a.ineligible IS NULL
     -- A new version of a campaign never goes again to someone an earlier version already reached.
     AND NOT EXISTS (SELECT 1 FROM public.email_campaign_recipients prev
                      WHERE prev.campaign_id = v.campaign_id AND prev.email = a.email
                        AND prev.status IN ('sent','sending','outcome_unknown'))
  ON CONFLICT (version_id, email) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'no_eligible_recipients' USING ERRCODE = 'P0001'; END IF;
  IF n > public.email_campaign_daily_cap() THEN
    RAISE EXCEPTION 'over_daily_cap' USING ERRCODE = 'P0001',
      DETAIL = format('%s recipients; the daily limit is %s', n, public.email_campaign_daily_cap());
  END IF;

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
END $$;

CREATE OR REPLACE FUNCTION public.email_campaign_dispatch_claim(p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
                     AND (s.contact_id = r2.client_id OR s.address_normalized = r2.email))
          OR EXISTS (SELECT 1 FROM public.suppressed_emails g WHERE lower(btrim(g.email)) = r2.email) THEN 'suppressed'
        WHEN c.kind = 'newsletter' AND NOT public._email_newsletter_subscribed(r2.tenant_id, r2.client_id, r2.email) THEN 'no_consent'
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
END $$;

CREATE OR REPLACE FUNCTION public.email_segment_delete(p_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant();
BEGIN
  -- A draft or a version awaiting approval that uses this segment would silently widen to every
  -- contact if it disappeared, so it cannot be deleted while one does.
  IF EXISTS (SELECT 1 FROM public.email_campaign_versions v WHERE v.segment_id = p_id AND v.tenant_id = t
              AND v.state IN ('draft','locked')) THEN
    RAISE EXCEPTION 'segment_in_use' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.email_segments WHERE id = p_id AND tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'segment_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN true;
END $$;
