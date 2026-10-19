-- E09 C1 — Announcements to customers through the ONE governed campaign system (plan §3.7, owner Q0 + Q1
-- approved 2026-10-19). No new sender, scheduler, approval path or table: the existing campaign
-- draft → request_approval (plan) → approve → dispatch_claim (send) seams gain three things.
--
--   1. A `portal` audience rule key ({"portal":"active"}): customers of this business whose portal access
--      is OPEN right now — business active; contact active, unmerged and linked to a login; access 'open'.
--      _client_portal_customer_open is the same WHERE as client_portal_relationship_id (Slice 7), keyed to a
--      contact instead of auth.uid(); the pgTAP suite pins the two together on every access state.
--      Any non-null portal value narrows (fails toward fewer people); only "active" is accepted on write.
--   2. Rule-key validation for campaigns: _email_campaign_rule_check (the series checker plus `portal`) runs
--      on every draft write (email_campaign_update_draft, which email_campaign_draft also goes through) and
--      on the rule a version freezes at request_approval (a saved segment's rule included). The series
--      checker is unchanged, so a series never takes the portal key (its send path is not re-proved here).
--   3. Updates consent (owner Q1): a promotion or announcement (and a newsletter, already) to ANY contact
--      linked to a customer portal requires their Updates and offers consent — at plan (_email_audience) and
--      again at send (dispatch_claim) — whatever the audience rule. "Linked" includes a FORMER portal
--      customer (access ended: linked_user_id cleared, portal_access_former_user_id kept), so ending access
--      never turns promotions back on for someone who left Updates off. Never-linked contacts: unchanged.
--      At send, a portal audience is also re-proved, so a customer paused/ended after approval is skipped.
--
-- Replaced (§37 producer inventory in the PR): _email_audience(uuid,jsonb,boolean) now delegates to a new
-- kind-aware _email_audience(uuid,jsonb,boolean,text) (the portal filter applies wherever a rule is read);
-- email_audience_preview, email_campaign_request_approval, email_campaign_update_draft,
-- email_campaign_dispatch_claim, _email_rule_choices — each copied from production's pg_get_functiondef
-- (md5-identical to the local replay) with only the marked E09 C1 lines added. CREATE OR REPLACE keeps
-- every existing grant. New functions are internal: no client role may execute them.

-- ── New internal helpers ─────────────────────────────────────────────────────────────────────────

-- Is this contact a customer of this business whose portal access is open right now? Not keyed to the
-- caller: only campaign planning and sending (both DEFINER, both already tenant-scoped) call it.
CREATE FUNCTION public._client_portal_customer_open(p_tenant uuid, p_client uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
     WHERE c.id = p_client AND c.tenant_id = p_tenant
       AND c.linked_user_id IS NOT NULL AND c.status = 'active'
       AND c.merged_into_contact_id IS NULL AND t.status = 'active'
       AND c.portal_access_state = 'open')
$$;
REVOKE ALL ON FUNCTION public._client_portal_customer_open(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Does this rule ask for the portal audience? Any present, non-null value does (fails toward fewer).
CREATE FUNCTION public._email_rule_wants_portal(p_rule jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_typeof(p_rule) = 'object' AND p_rule ? 'portal' AND jsonb_typeof(p_rule->'portal') <> 'null', false)
$$;
REVOKE ALL ON FUNCTION public._email_rule_wants_portal(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Owner Q1: the campaign kinds that need a portal-linked contact's Updates and offers consent.
CREATE FUNCTION public._email_kind_needs_updates_consent(p_kind text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT COALESCE(p_kind IN ('promotion', 'announcement', 'newsletter'), false) $$;
REVOKE ALL ON FUNCTION public._email_kind_needs_updates_consent(text) FROM PUBLIC, anon, authenticated, service_role;

-- A campaign audience rule: the series keys (checked by the one series checker) plus portal:"active".
CREATE FUNCTION public._email_campaign_rule_check(p_rule jsonb)
RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
BEGIN
  IF p_rule IS NULL OR jsonb_typeof(p_rule) <> 'object' THEN RAISE EXCEPTION 'rule_invalid' USING ERRCODE = '22023'; END IF;
  IF p_rule ? 'portal' AND jsonb_typeof(p_rule->'portal') <> 'null' AND p_rule->'portal' <> '"active"'::jsonb THEN
    RAISE EXCEPTION 'rule_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM public._email_sequence_rule_check(p_rule - 'portal');
END $$;
REVOKE ALL ON FUNCTION public._email_campaign_rule_check(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ── The audience, kind-aware (new signature) ─────────────────────────────────────────────────────
CREATE FUNCTION public._email_audience(p_tenant uuid, p_rule jsonb, p_newsletter boolean, p_kind text)
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
                   AND (s.contact_id = a.id OR s.address_normalized = a.email))
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

-- The existing 3-argument signature (series, dashboard and segment reads) delegates: same rows, plus the
-- portal filter wherever a rule carries it; kind NULL, so no Q1 consent change for those callers.
CREATE OR REPLACE FUNCTION public._email_audience(p_tenant uuid, p_rule jsonb, p_newsletter boolean)
 RETURNS TABLE(client_id uuid, email text, ineligible text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT a.client_id, a.email, a.ineligible FROM public._email_audience(p_tenant, p_rule, p_newsletter, NULL::text) a
$function$;

-- ── Plan-time readers and writers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.email_audience_preview(p_rule jsonb DEFAULT '{}'::jsonb, p_kind text DEFAULT 'standard'::text, p_segment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t uuid := public._email_caller_tenant(); r jsonb := COALESCE(p_rule, '{}'::jsonb); out jsonb; used int;
BEGIN
  IF p_segment_id IS NOT NULL THEN
    SELECT rule INTO r FROM public.email_segments WHERE id = p_segment_id AND tenant_id = t;
    IF r IS NULL THEN RAISE EXCEPTION 'segment_not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  used := public._email_used_today(t);
  SELECT jsonb_build_object(
    'matched', count(*), 'eligible', count(*) FILTER (WHERE a.ineligible IS NULL),
    'no_address', count(*) FILTER (WHERE a.ineligible = 'no_address'),
    'opted_out', count(*) FILTER (WHERE a.ineligible = 'opted_out'),
    'suppressed', count(*) FILTER (WHERE a.ineligible = 'suppressed'),
    'no_consent', count(*) FILTER (WHERE a.ineligible = 'no_consent'),
    'daily_cap', public.email_campaign_daily_cap(), 'used_last_24h', used,
    'remaining_today', GREATEST(public.email_campaign_daily_cap() - used, 0),
    'postal_address_set', public._email_postal_address(t) IS NOT NULL)
  INTO out FROM public._email_audience(t, r, p_kind = 'newsletter', p_kind) a;
  RETURN out;
END $function$;

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
END $function$;

CREATE OR REPLACE FUNCTION public.email_campaign_update_draft(p_version_id uuid, p_name text DEFAULT NULL::text, p_kind text DEFAULT NULL::text, p_subject text DEFAULT NULL::text, p_preheader text DEFAULT NULL::text, p_body_html text DEFAULT NULL::text, p_sender jsonb DEFAULT NULL::jsonb, p_audience jsonb DEFAULT NULL::jsonb, p_segment_id uuid DEFAULT NULL::uuid, p_clear_segment boolean DEFAULT false, p_scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone, p_clear_schedule boolean DEFAULT false, p_conversion_goal text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE t uuid := public._email_caller_tenant(); v public.email_campaign_versions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = p_version_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND OR v.state <> 'draft' THEN RAISE EXCEPTION 'not_an_editable_draft' USING ERRCODE = 'P0002'; END IF;
  IF p_segment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.email_segments WHERE id = p_segment_id AND tenant_id = t) THEN
    RAISE EXCEPTION 'segment_not_found' USING ERRCODE = 'P0002';
  END IF;
  -- E09 C1: an audience rule names only keys the audience knows (stages, sources, tags, inactive_days, portal).
  IF p_audience IS NOT NULL THEN PERFORM public._email_campaign_rule_check(p_audience); END IF;
  IF p_sender IS NOT NULL AND NOT (
       (p_sender->>'mode' = 'managed')
    OR (p_sender->>'mode' = 'connector' AND EXISTS (SELECT 1 FROM public.channel_connectors
          WHERE id = NULLIF(p_sender->>'connector_id','')::uuid AND tenant_id = t AND channel_type = 'email'))) THEN
    RAISE EXCEPTION 'sender_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.email_campaign_versions SET
    subject = COALESCE(p_subject, subject), preheader = COALESCE(p_preheader, preheader),
    body_html = COALESCE(p_body_html, body_html), sender = COALESCE(p_sender, sender),
    audience = COALESCE(p_audience, audience),
    segment_id = CASE WHEN p_clear_segment THEN NULL ELSE COALESCE(p_segment_id, segment_id) END,
    scheduled_for = CASE WHEN p_clear_schedule THEN NULL ELSE COALESCE(p_scheduled_for, scheduled_for) END,
    conversion_goal = COALESCE(p_conversion_goal, conversion_goal), updated_at = now()
  WHERE id = v.id;
  UPDATE public.email_campaigns SET name = COALESCE(NULLIF(btrim(p_name), ''), name), kind = COALESCE(p_kind, kind),
    updated_at = now() WHERE id = v.campaign_id;
  RETURN v.id;
END $function$;

-- ── Send time ────────────────────────────────────────────────────────────────────────────────────
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
                     AND (s.contact_id = r2.client_id OR s.address_normalized = r2.email))
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

-- ── Editor counts ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._email_rule_choices(p_tenant uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
         GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 60) s), '[]'::jsonb),
    -- E09 C1: how many contacts the portal audience reaches today (open access only).
    'portal', jsonb_build_object('open', (SELECT count(*) FROM public.clients c
         WHERE c.tenant_id = p_tenant AND c.linked_user_id IS NOT NULL
           AND public._client_portal_customer_open(p_tenant, c.id))))
$function$;
