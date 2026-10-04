-- Marketing email E2: the Email dashboard's one read (owner reference 2026-10-04).
--
-- read_email_marketing_dashboard(p_days, p_tz) returns everything the Email tab shows, for the caller's
-- own business only (owner or admin; _email_caller_tenant raises otherwise). Read-only; it writes nothing.
-- Every figure comes from a canonical producer (owner ruling 11):
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
--                                    (invoice_paid). Counted once per recipient, in the period of the click.
-- Periods: the last p_days days (7, 30 or 90) and the p_days before them, for comparison. Daily buckets are
-- calendar days in p_tz (an IANA zone; anything unknown reads as UTC).

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
  ), conv AS (
    SELECT r.id, r.clicked_at FROM r
     WHERE r.clicked_at IS NOT NULL AND r.client_id IS NOT NULL AND r.conversion_goal <> 'none' AND (
       (r.conversion_goal = 'form_submission' AND EXISTS (SELECT 1 FROM public.growth_form_submissions g
          WHERE g.tenant_id = t AND g.contact_id = r.client_id AND g.created_at > r.clicked_at AND g.created_at <= r.clicked_at + interval '7 days'))
       OR (r.conversion_goal = 'booking' AND EXISTS (SELECT 1 FROM public.internal_bookings b
          WHERE b.tenant_id = t AND b.contact_id = r.client_id AND b.created_at > r.clicked_at AND b.created_at <= r.clicked_at + interval '7 days'))
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
      'conversions', (SELECT count(*) FROM conv WHERE clicked_at >= cur_from),
      'conversions_prev', (SELECT count(*) FROM conv WHERE clicked_at >= prev_from AND clicked_at < cur_from),
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
          'recipients', COALESCE(a.total, v.expected_recipients), 'first_sent_at', a.first_sent, 'last_sent_at', a.last_sent,
          'sent', COALESCE(a.sent, 0), 'tracked', COALESCE(a.tracked, 0), 'opened', COALESCE(a.opened, 0),
          'clicked', COALESCE(a.clicked, 0), 'failed', COALESCE(a.failed, 0), 'not_confirmed', COALESCE(a.unknown, 0),
          'skipped', COALESCE(a.skipped, 0), 'waiting', COALESCE(a.waiting, 0)) AS item
        FROM public.email_campaigns c
        LEFT JOIN public.email_campaign_versions v ON v.id = c.current_version_id
        LEFT JOIN public.email_segments sg ON sg.id = v.segment_id
        LEFT JOIN LATERAL (
          SELECT count(*) AS total, min(sent_at) AS first_sent, max(sent_at) AS last_sent,
                 count(*) FILTER (WHERE status = 'sent') AS sent,
                 count(*) FILTER (WHERE status = 'sent' AND route = 'managed') AS tracked,
                 count(*) FILTER (WHERE route = 'managed' AND opened_at IS NOT NULL) AS opened,
                 count(*) FILTER (WHERE route = 'managed' AND clicked_at IS NOT NULL) AS clicked,
                 count(*) FILTER (WHERE status = 'failed') AS failed,
                 count(*) FILTER (WHERE status = 'outcome_unknown') AS unknown,
                 count(*) FILTER (WHERE status = 'skipped') AS skipped,
                 count(*) FILTER (WHERE status IN ('planned','sending')) AS waiting
            FROM public.email_campaign_recipients rr
           WHERE rr.campaign_id = c.id AND rr.version_id = v.id) a ON true
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
          (SELECT jsonb_build_object('kind', 'campaign_sent', 'at', c.updated_at, 'title', c.name, 'campaign_id', c.id,
                                     'detail', c.status) AS e, c.updated_at AS at
             FROM public.email_campaigns c WHERE c.tenant_id = t AND c.status IN ('completed','partially_completed')
             ORDER BY c.updated_at DESC LIMIT 8)
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
                   FROM public.email_campaign_recipients WHERE version_id = v.id),
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
