-- E1 · Marketing email sending foundation (owner rulings 2026-10-04).
--
-- WHAT A BUSINESS GETS. A campaign (standard, newsletter, announcement, promotion, re-engagement, event,
-- welcome blast or custom) is written as a VERSION. Requesting approval FREEZES that version (content,
-- sender, audience rule, schedule, conversion goal) under a content hash and writes its AUDIENCE SNAPSHOT:
-- the exact contacts it is for. One approval in the existing approvals queue (paige_pending_approvals,
-- type campaign_send) authorizes that bounded fan-out. Any edit after that is a new draft version and
-- withdraws the pending approval; no approval can ever send changed content. A sent version is history.
--
-- HOW IT SENDS. One paige_durable_work row per dispatched version is the lifecycle envelope (claimed →
-- succeeded / failed / blocked / cancelled). The fan-out itself is per-recipient leases (SKIP LOCKED) worked
-- by email-campaign-worker, which sends each recipient through the canonical send-message seam (sender
-- resolution, pre-send checks, suppression, email adapter, provider id, messages + audit). A recipient's
-- row id is its idempotency key. A lease that expires without a recorded outcome becomes outcome_unknown
-- and is never sent again blindly.
--
-- RULES CARRIED IN THE DATABASE (so no caller can skip them):
--   * Sender: the version binds either the managed identity (Paige's Resend) or a connector the business
--     deliberately selected. A selected connector that is no longer active BLOCKS the campaign; a managed
--     address that changed since approval BLOCKS it. Nothing falls back silently.
--   * Postal address: a marketing send is refused until the business's legal profile has one (owner ruling).
--   * Consent: campaigns go to contacts who have not opted out; newsletters only to contacts whose latest
--     email/newsletter consent event is 'granted' (owner ruling). Eligibility is re-checked at dispatch.
--   * Daily ceiling: 500 recipients a day per business on any route (owner ruling).
--   * Only a person approves: email_campaign_approve requires auth.uid() and an owner/admin of the business.
--
-- AUTHORITY (§9/§53/§59). Reads: owner/admin of the row's business (is_tenant_admin) or the platform owner.
-- Writes only through these functions, each re-checking is_tenant_admin(current_user_tenant_id()).

-- ── Tables ─────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  rule jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rule) = 'object' AND pg_column_size(rule) <= 8192),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_segments_tenant_name ON public.email_segments (tenant_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'standard'
    CHECK (kind IN ('standard','newsletter','announcement','promotion','reengagement','event','welcome','custom')),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','scheduled','sending','completed','partially_completed','failed','blocked','cancelled')),
  blocked_reason text CHECK (blocked_reason IS NULL OR char_length(blocked_reason) <= 300),
  current_version_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_campaigns_tenant_updated ON public.email_campaigns (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS email_campaigns_dispatchable ON public.email_campaigns (status) WHERE status IN ('scheduled','sending');

CREATE TABLE IF NOT EXISTS public.email_campaign_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no >= 1),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','locked','approved','sent','superseded')),
  subject text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 300),
  preheader text NOT NULL DEFAULT '' CHECK (char_length(preheader) <= 300),
  body_html text NOT NULL DEFAULT '' CHECK (char_length(body_html) <= 200000),
  -- {"mode":"managed"} or {"mode":"connector","connector_id":"<uuid>"}
  sender jsonb NOT NULL DEFAULT '{"mode":"managed"}'::jsonb CHECK (jsonb_typeof(sender) = 'object'),
  -- The resolved From at lock time; dispatch refuses if it no longer matches.
  sender_snapshot jsonb,
  -- {"stages":[...],"sources":[...],"tags":[...],"inactive_days":90}; empty means everyone.
  audience jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audience) = 'object' AND pg_column_size(audience) <= 8192),
  segment_id uuid REFERENCES public.email_segments(id) ON DELETE SET NULL,
  scheduled_for timestamptz,
  conversion_goal text NOT NULL DEFAULT 'none'
    CHECK (conversion_goal IN ('none','form_submission','booking','deal_created','invoice_paid')),
  content_hash text,
  expected_recipients integer CHECK (expected_recipients IS NULL OR expected_recipients >= 0),
  cost_bound_usd numeric(10,4),
  approval_id uuid REFERENCES public.paige_pending_approvals(id) ON DELETE SET NULL,
  locked_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, version_no)
);
CREATE INDEX IF NOT EXISTS email_campaign_versions_campaign ON public.email_campaign_versions (campaign_id, version_no DESC);

ALTER TABLE public.email_campaigns
  ADD CONSTRAINT email_campaigns_current_version_fk FOREIGN KEY (current_version_id)
  REFERENCES public.email_campaign_versions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS public.email_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.email_campaign_versions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','sending','sent','failed','outcome_unknown','skipped','cancelled')),
  skip_reason text CHECK (skip_reason IS NULL OR skip_reason IN
    ('opted_out','suppressed','no_consent','no_address','contact_removed','unsubscribe_unavailable','sender_refused')),
  route text CHECK (route IS NULL OR route IN ('managed','connector')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  lease_until timestamptz,
  -- A recipient deferred by the pre-send checks (quiet hours, a hold) waits until this time.
  not_before timestamptz,
  provider_message_id text,
  message_id uuid,
  error text CHECK (error IS NULL OR char_length(error) <= 500),
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, email)
);
CREATE INDEX IF NOT EXISTS email_campaign_recipients_version_status ON public.email_campaign_recipients (version_id, status);
CREATE INDEX IF NOT EXISTS email_campaign_recipients_tenant_sent ON public.email_campaign_recipients (tenant_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS email_campaign_recipients_provider_id ON public.email_campaign_recipients (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_campaign_recipients_lease ON public.email_campaign_recipients (lease_until) WHERE status = 'sending';

-- Service-only: the durable-work envelope for each dispatched version (its key never reaches a browser).
CREATE TABLE IF NOT EXISTS public.email_campaign_dispatches (
  version_id uuid PRIMARY KEY REFERENCES public.email_campaign_versions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_id uuid NOT NULL,
  work_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaign_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaign_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_segments, public.email_campaigns, public.email_campaign_versions,
  public.email_campaign_recipients, public.email_campaign_dispatches FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.email_segments, public.email_campaigns, public.email_campaign_versions,
  public.email_campaign_recipients TO authenticated;
GRANT ALL ON public.email_segments, public.email_campaigns, public.email_campaign_versions,
  public.email_campaign_recipients, public.email_campaign_dispatches TO service_role;

CREATE POLICY email_segments_admin_read ON public.email_segments FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.is_platform_owner());
CREATE POLICY email_campaigns_admin_read ON public.email_campaigns FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.is_platform_owner());
CREATE POLICY email_campaign_versions_admin_read ON public.email_campaign_versions FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.is_platform_owner());
CREATE POLICY email_campaign_recipients_admin_read ON public.email_campaign_recipients FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.is_platform_owner());

-- A version that has left draft is history: its content, sender, audience and schedule never change.
CREATE OR REPLACE FUNCTION public._email_campaign_version_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.state <> 'draft' AND (
       NEW.subject IS DISTINCT FROM OLD.subject OR NEW.preheader IS DISTINCT FROM OLD.preheader
    OR NEW.body_html IS DISTINCT FROM OLD.body_html OR NEW.sender IS DISTINCT FROM OLD.sender
    OR NEW.sender_snapshot IS DISTINCT FROM OLD.sender_snapshot OR NEW.audience IS DISTINCT FROM OLD.audience
    OR NEW.segment_id IS DISTINCT FROM OLD.segment_id OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
    OR NEW.conversion_goal IS DISTINCT FROM OLD.conversion_goal OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.expected_recipients IS DISTINCT FROM OLD.expected_recipients OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    RAISE EXCEPTION 'version_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER email_campaign_version_frozen BEFORE UPDATE ON public.email_campaign_versions
  FOR EACH ROW EXECUTE FUNCTION public._email_campaign_version_frozen();

-- ── Shared rules ───────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.email_campaign_daily_cap()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$ SELECT 500 $$;
GRANT EXECUTE ON FUNCTION public.email_campaign_daily_cap() TO authenticated, service_role;

-- Estimated provider cost per email on Paige's account, for the approval's cost bound. An estimate.
CREATE OR REPLACE FUNCTION public.email_campaign_unit_cost_usd()
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$ SELECT 0.0004::numeric $$;
GRANT EXECUTE ON FUNCTION public.email_campaign_unit_cost_usd() TO authenticated, service_role;

-- The caller's business, refused unless they are an owner or admin of it. Internal.
CREATE OR REPLACE FUNCTION public._email_caller_tenant()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public.current_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR t IS NULL THEN RAISE EXCEPTION 'not_signed_in' USING ERRCODE = '42501'; END IF;
  IF NOT public.is_tenant_admin(t) THEN RAISE EXCEPTION 'not_permitted' USING ERRCODE = '42501'; END IF;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public._email_caller_tenant() FROM PUBLIC, anon, authenticated;

-- A newsletter subscriber: the contact's latest email/newsletter consent event is 'granted'.
CREATE OR REPLACE FUNCTION public._email_newsletter_subscribed(p_tenant uuid, p_client uuid, p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT e.action = 'granted' FROM public.paige_consent_events e
     WHERE e.tenant_id = p_tenant AND e.channel = 'email' AND e.topic = 'newsletter'
       AND (e.contact_id = p_client OR (p_email IS NOT NULL AND e.address_normalized = p_email))
     ORDER BY e.created_at DESC, e.id DESC LIMIT 1), false)
$$;
REVOKE ALL ON FUNCTION public._email_newsletter_subscribed(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Who a rule reaches in one business, one address per contact, with why anyone cannot be sent to.
-- Internal: callers pass a business they have already authorized.
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
      AND (rule.inactive_days IS NULL OR c.last_contacted_at IS NULL
           OR c.last_contacted_at < now() - make_interval(days => rule.inactive_days))
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
REVOKE ALL ON FUNCTION public._email_audience(uuid, jsonb, boolean) FROM PUBLIC, anon, authenticated;

-- A segment's rule, or the version's own rule when no segment is used.
CREATE OR REPLACE FUNCTION public._email_version_rule(v public.email_campaign_versions)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT s.rule FROM public.email_segments s WHERE s.id = v.segment_id AND s.tenant_id = v.tenant_id), v.audience)
$$;
REVOKE ALL ON FUNCTION public._email_version_rule(public.email_campaign_versions) FROM PUBLIC, anon, authenticated;

-- The From a version would send with right now, or why it cannot send. Never substitutes one sender for another.
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
    RETURN jsonb_build_object('ok', true, 'mode', 'connector', 'connector_id', conn.id, 'provider', conn.provider,
      'from_address', lower(btrim(conn.from_address)), 'from_name', conn.from_name);
  END IF;
  ident := to_jsonb(public.tenant_sender_identity(p_tenant));
  IF ident IS NULL OR NULLIF(btrim(COALESCE(ident->>'from_address', '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sender_needs_attention');
  END IF;
  RETURN jsonb_build_object('ok', true, 'mode', 'managed', 'provider', 'resend',
    'from_address', lower(btrim(ident->>'from_address')), 'from_name', ident->>'from_name');
END $$;
REVOKE ALL ON FUNCTION public._email_resolve_sender(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- The business's postal address for the marketing footer (CAN-SPAM), or NULL when it has none.
CREATE OR REPLACE FUNCTION public._email_postal_address(p_tenant uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT NULLIF(btrim(COALESCE(
    NULLIF(btrim(COALESCE(p.registered_address, '')), ''),
    concat_ws(', ', NULLIF(btrim(p.registered_street), ''), NULLIF(btrim(p.registered_street_secondary), ''),
      NULLIF(btrim(p.registered_city), ''), NULLIF(btrim(concat_ws(' ', p.registered_region, p.registered_postal_code)), ''),
      NULLIF(btrim(p.registered_iso_country), '')))), '')
  FROM public.tenant_legal_profile p WHERE p.tenant_id = p_tenant
  ORDER BY p.updated_at DESC NULLS LAST LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._email_postal_address(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._email_version_hash(v public.email_campaign_versions, k text)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  -- scheduled_for is hashed as UTC so the hash never depends on the session's TimeZone.
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'kind', k, 'subject', v.subject, 'preheader', v.preheader, 'body_html', v.body_html, 'sender', v.sender,
    'audience', v.audience, 'segment_id', v.segment_id, 'scheduled_for', (v.scheduled_for AT TIME ZONE 'UTC'),
    'conversion_goal', v.conversion_goal)::text, 'UTF8')), 'hex')
$$;
REVOKE ALL ON FUNCTION public._email_version_hash(public.email_campaign_versions, text) FROM PUBLIC, anon, authenticated;

-- How much of the business's 24-hour ceiling is in use (in flight or sent).
CREATE OR REPLACE FUNCTION public._email_used_today(p_tenant uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM public.email_campaign_recipients r
   WHERE r.tenant_id = p_tenant AND (r.status = 'sending'
     OR (r.sent_at IS NOT NULL AND r.sent_at > now() - interval '24 hours')
     -- an unanswered hand-off may have been delivered, so it counts
     OR (r.status = 'outcome_unknown' AND r.updated_at > now() - interval '24 hours'))
$$;
REVOKE ALL ON FUNCTION public._email_used_today(uuid) FROM PUBLIC, anon, authenticated;

-- ── Callable seam (UI and Paige) ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.email_campaign_create(p_kind text DEFAULT 'standard', p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); c uuid; v uuid; conn uuid;
BEGIN
  -- Connected provider first (owner ruling 1): a business's own healthy email connection is the default
  -- sender; Paige's managed address only when it has none. The draft shows it and the owner may change it.
  SELECT id INTO conn FROM public.channel_connectors
   WHERE tenant_id = t AND channel_type = 'email' AND active AND status = 'active'
     AND NULLIF(btrim(COALESCE(from_address, '')), '') IS NOT NULL
     AND COALESCE((config->>'managed_default')::boolean, false) = false
   ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1;
  INSERT INTO public.email_campaigns (tenant_id, kind, name, created_by)
  VALUES (t, COALESCE(p_kind, 'standard'), COALESCE(NULLIF(btrim(p_name), ''), 'Untitled email'), auth.uid())
  RETURNING id INTO c;
  INSERT INTO public.email_campaign_versions (campaign_id, tenant_id, version_no, sender, created_by)
  VALUES (c, t, 1, CASE WHEN conn IS NULL THEN '{"mode":"managed"}'::jsonb
                        ELSE jsonb_build_object('mode', 'connector', 'connector_id', conn) END, auth.uid())
  RETURNING id INTO v;
  UPDATE public.email_campaigns SET current_version_id = v WHERE id = c;
  RETURN jsonb_build_object('campaign_id', c, 'version_id', v);
END $$;

-- Edit a draft version. NULL leaves a field as it is.
CREATE OR REPLACE FUNCTION public.email_campaign_update_draft(
  p_version_id uuid, p_name text DEFAULT NULL, p_kind text DEFAULT NULL, p_subject text DEFAULT NULL,
  p_preheader text DEFAULT NULL, p_body_html text DEFAULT NULL, p_sender jsonb DEFAULT NULL,
  p_audience jsonb DEFAULT NULL, p_segment_id uuid DEFAULT NULL, p_clear_segment boolean DEFAULT false,
  p_scheduled_for timestamptz DEFAULT NULL, p_clear_schedule boolean DEFAULT false, p_conversion_goal text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); v public.email_campaign_versions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = p_version_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND OR v.state <> 'draft' THEN RAISE EXCEPTION 'not_an_editable_draft' USING ERRCODE = 'P0002'; END IF;
  IF p_segment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.email_segments WHERE id = p_segment_id AND tenant_id = t) THEN
    RAISE EXCEPTION 'segment_not_found' USING ERRCODE = 'P0002';
  END IF;
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
END $$;

-- Start a new draft from the campaign's latest version: to change a version awaiting approval (which
-- withdraws that approval and its snapshot) or to send a sent campaign again as a new version.
CREATE OR REPLACE FUNCTION public.email_campaign_new_version(p_campaign_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); c public.email_campaigns%ROWTYPE; cur public.email_campaign_versions%ROWTYPE; nv uuid;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  IF c.status IN ('scheduled','sending') THEN RAISE EXCEPTION 'cancel_first' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO cur FROM public.email_campaign_versions WHERE id = c.current_version_id FOR UPDATE;
  IF cur.state = 'draft' THEN RETURN cur.id; END IF;
  IF cur.state IN ('locked', 'approved') THEN
    -- A version awaiting approval, or approved but stopped (blocked / cancelled), is replaced: nothing
    -- still planned under it will ever be sent.
    UPDATE public.email_campaign_versions SET state = 'superseded', updated_at = now() WHERE id = cur.id AND cur.state = 'locked';
    UPDATE public.email_campaign_recipients SET status = 'cancelled', updated_at = now() WHERE version_id = cur.id AND status = 'planned';
    UPDATE public.paige_pending_approvals SET status = 'skipped', decision_rationale = 'A newer draft replaced the version awaiting approval.',
      updated_at = now() WHERE id = cur.approval_id AND status = 'pending';
  END IF;
  INSERT INTO public.email_campaign_versions (campaign_id, tenant_id, version_no, subject, preheader, body_html, sender,
    audience, segment_id, conversion_goal, created_by)
  SELECT c.id, t, (SELECT max(version_no) + 1 FROM public.email_campaign_versions WHERE campaign_id = c.id),
    cur.subject, cur.preheader, cur.body_html, cur.sender, cur.audience, cur.segment_id, cur.conversion_goal, auth.uid()
  RETURNING id INTO nv;
  UPDATE public.email_campaigns SET current_version_id = nv, status = 'draft', blocked_reason = NULL, updated_at = now() WHERE id = c.id;
  RETURN nv;
END $$;

CREATE OR REPLACE FUNCTION public.email_campaign_delete(p_campaign_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t) THEN
    RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.email_campaign_versions WHERE campaign_id = p_campaign_id AND state IN ('approved','sent')) THEN
    RAISE EXCEPTION 'campaign_has_history' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.paige_pending_approvals SET status = 'skipped', updated_at = now()
   WHERE id IN (SELECT approval_id FROM public.email_campaign_versions WHERE campaign_id = p_campaign_id) AND status = 'pending';
  DELETE FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.email_segment_save(p_id uuid DEFAULT NULL, p_name text DEFAULT NULL, p_rule jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); out_id uuid;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO public.email_segments (tenant_id, name, rule, created_by)
    VALUES (t, COALESCE(NULLIF(btrim(p_name), ''), 'Untitled segment'), COALESCE(p_rule, '{}'::jsonb), auth.uid()) RETURNING id INTO out_id;
  ELSE
    UPDATE public.email_segments SET name = COALESCE(NULLIF(btrim(p_name), ''), name), rule = COALESCE(p_rule, rule), updated_at = now()
     WHERE id = p_id AND tenant_id = t RETURNING id INTO out_id;
    IF out_id IS NULL THEN RAISE EXCEPTION 'segment_not_found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN out_id;
END $$;

CREATE OR REPLACE FUNCTION public.email_segment_delete(p_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant();
BEGIN
  DELETE FROM public.email_segments WHERE id = p_id AND tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'segment_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN true;
END $$;

-- Record a newsletter subscription or unsubscription for one contact (owner or admin acting in the UI).
CREATE OR REPLACE FUNCTION public.email_newsletter_consent_set(p_client_id uuid, p_subscribed boolean)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id AND tenant_id = t) THEN
    RAISE EXCEPTION 'contact_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.paige_consent_events (tenant_id, contact_id, channel, topic, action, source, evidence_ref)
  VALUES (t, p_client_id, 'email', 'newsletter', CASE WHEN p_subscribed THEN 'granted' ELSE 'revoked' END, 'admin_ui', auth.uid()::text);
  RETURN true;
END $$;

-- Who a rule would reach today, why anyone is excluded, and what is left of today's ceiling.
CREATE OR REPLACE FUNCTION public.email_audience_preview(p_rule jsonb DEFAULT '{}'::jsonb, p_kind text DEFAULT 'standard', p_segment_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  INTO out FROM public._email_audience(t, r, p_kind = 'newsletter') a;
  RETURN out;
END $$;

-- Freeze a draft for approval: validate, resolve the sender, write the audience snapshot, and file ONE
-- campaign_send approval that binds the version's content hash, recipient count, sender and cost bound.
-- p_source 'paige' files it for the owner to decide; 'owner' is the owner's own review step.
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
  cost := CASE WHEN snd->>'mode' = 'managed' THEN round(n * public.email_campaign_unit_cost_usd(), 4) ELSE 0 END;

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

-- The one approval. A person (owner or admin of the business) approves the frozen version; the hash is
-- re-derived so a version that changed underneath cannot pass.
CREATE OR REPLACE FUNCTION public.email_campaign_approve(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_caller_tenant();
  v public.email_campaign_versions%ROWTYPE; c public.email_campaigns%ROWTYPE; a public.paige_pending_approvals%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = p_version_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v.state <> 'locked' THEN RAISE EXCEPTION 'not_awaiting_approval' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO c FROM public.email_campaigns WHERE id = v.campaign_id FOR UPDATE;
  IF c.status <> 'pending_approval' THEN RAISE EXCEPTION 'not_awaiting_approval' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO a FROM public.paige_pending_approvals WHERE id = v.approval_id FOR UPDATE;
  IF NOT FOUND OR a.status <> 'pending' OR a.type <> 'campaign_send' OR a.tenant_id IS DISTINCT FROM t
     OR a.metadata->>'email_campaign_version_id' IS DISTINCT FROM v.id::text THEN
    RAISE EXCEPTION 'approval_not_pending' USING ERRCODE = 'P0001';
  END IF;
  IF a.metadata->>'content_hash' IS DISTINCT FROM public._email_version_hash(v, c.kind)
     OR a.metadata->>'content_hash' IS DISTINCT FROM v.content_hash THEN
    RAISE EXCEPTION 'approval_stale' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('paige.email_campaign_approve', v.id::text, true);
  UPDATE public.paige_pending_approvals SET status = 'approved', reviewed_by_user_id = auth.uid(), reviewed_at = now(), updated_at = now()
   WHERE id = a.id;
  UPDATE public.email_campaign_versions SET state = 'approved', approved_at = now(), approved_by = auth.uid(), updated_at = now()
   WHERE id = v.id;
  UPDATE public.email_campaigns SET status = 'scheduled', updated_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('campaign_id', c.id, 'version_id', v.id, 'recipients', v.expected_recipients,
    'send_at', COALESCE(v.scheduled_for, now()));
END $$;

-- A campaign_send approval becomes 'approved' only through email_campaign_approve, which re-derives the
-- content hash and requires a person. Any other writer (a generic approve button, an agent tool) is refused
-- loudly here instead of leaving an approval consumed while its version never moved.
CREATE OR REPLACE FUNCTION public._email_campaign_approval_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.type = 'campaign_send' AND NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.metadata ? 'email_campaign_version_id'
     AND COALESCE(current_setting('paige.email_campaign_approve', true), '') IS DISTINCT FROM NEW.metadata->>'email_campaign_version_id' THEN
    RAISE EXCEPTION 'campaign_approval_requires_review' USING ERRCODE = '42501',
      HINT = 'Approve an email campaign through email_campaign_approve.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._email_campaign_approval_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_email_campaign_approval_guard ON public.paige_pending_approvals;
CREATE TRIGGER trg_email_campaign_approval_guard BEFORE UPDATE OF status ON public.paige_pending_approvals
  FOR EACH ROW EXECUTE FUNCTION public._email_campaign_approval_guard();

-- A campaign_send approval declined anywhere (Command Center, the approvals queue, an agent tool) returns
-- its campaign to an editable draft, exactly as email_campaign_decline does, instead of leaving it
-- awaiting an approval that no longer exists.
CREATE OR REPLACE FUNCTION public._email_campaign_approval_withdrawn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.email_campaign_versions%ROWTYPE; nv uuid;
BEGIN
  IF NEW.type <> 'campaign_send' OR OLD.status <> 'pending' OR NEW.status NOT IN ('rejected','skipped','changes_requested') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v FROM public.email_campaign_versions
   WHERE id = NULLIF(NEW.metadata->>'email_campaign_version_id', '')::uuid AND approval_id = NEW.id AND state = 'locked'
   FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.email_campaigns WHERE id = v.campaign_id
                                AND current_version_id = v.id AND status = 'pending_approval') THEN
    RETURN NEW;
  END IF;
  UPDATE public.email_campaign_versions SET state = 'superseded', updated_at = now() WHERE id = v.id;
  UPDATE public.email_campaign_recipients SET status = 'cancelled', updated_at = now() WHERE version_id = v.id AND status = 'planned';
  INSERT INTO public.email_campaign_versions (campaign_id, tenant_id, version_no, subject, preheader, body_html, sender,
    audience, segment_id, conversion_goal, created_by)
  SELECT v.campaign_id, v.tenant_id, (SELECT max(version_no) + 1 FROM public.email_campaign_versions WHERE campaign_id = v.campaign_id),
    v.subject, v.preheader, v.body_html, v.sender, v.audience, v.segment_id, v.conversion_goal, NEW.reviewed_by_user_id
  RETURNING id INTO nv;
  UPDATE public.email_campaigns SET current_version_id = nv, status = 'draft', blocked_reason = NULL, updated_at = now()
   WHERE id = v.campaign_id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._email_campaign_approval_withdrawn() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_email_campaign_approval_withdrawn ON public.paige_pending_approvals;
CREATE TRIGGER trg_email_campaign_approval_withdrawn AFTER UPDATE OF status ON public.paige_pending_approvals
  FOR EACH ROW EXECUTE FUNCTION public._email_campaign_approval_withdrawn();

-- Decline a version awaiting approval: it goes back to being editable as a new draft.
CREATE OR REPLACE FUNCTION public.email_campaign_decline(p_version_id uuid, p_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); v public.email_campaign_versions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = p_version_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND OR v.state <> 'locked' THEN RAISE EXCEPTION 'not_awaiting_approval' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.paige_pending_approvals SET status = 'rejected', reviewed_by_user_id = auth.uid(), reviewed_at = now(),
    decision_rationale = left(p_reason, 500), updated_at = now() WHERE id = v.approval_id AND status = 'pending';
  PERFORM public.email_campaign_new_version(v.campaign_id);
  RETURN true;
END $$;

-- Stop a campaign that is awaiting approval, scheduled or sending. Recipients not yet handed to the
-- provider are cancelled; anything already sent stays recorded as sent.
CREATE OR REPLACE FUNCTION public.email_campaign_cancel(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); c public.email_campaigns%ROWTYPE; n int;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  IF c.status NOT IN ('pending_approval','scheduled','sending','blocked') THEN RAISE EXCEPTION 'nothing_to_cancel' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.email_campaigns SET status = 'cancelled', updated_at = now() WHERE id = c.id;
  UPDATE public.email_campaign_recipients SET status = 'cancelled', updated_at = now()
   WHERE version_id = c.current_version_id AND status = 'planned';
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.paige_pending_approvals SET status = 'skipped', decision_rationale = 'Cancelled by the owner.', updated_at = now()
   WHERE id = (SELECT approval_id FROM public.email_campaign_versions WHERE id = c.current_version_id) AND status = 'pending';
  RETURN jsonb_build_object('cancelled_recipients', n);
END $$;

REVOKE ALL ON FUNCTION public.email_campaign_create(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_create(text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.email_campaign_update_draft(uuid,text,text,text,text,text,jsonb,jsonb,uuid,boolean,timestamptz,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_update_draft(uuid,text,text,text,text,text,jsonb,jsonb,uuid,boolean,timestamptz,boolean,text) TO authenticated;
REVOKE ALL ON FUNCTION public.email_campaign_new_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_new_version(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_campaign_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_delete(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_segment_save(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_segment_save(uuid,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.email_segment_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_segment_delete(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_newsletter_consent_set(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_newsletter_consent_set(uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.email_audience_preview(jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_audience_preview(jsonb,text,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_campaign_request_approval(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_request_approval(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.email_campaign_approve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_approve(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_campaign_decline(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_decline(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.email_campaign_cancel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_cancel(uuid) TO authenticated;

-- ── Dispatcher seam (service only: email-campaign-worker) ───────────────────────────────────────────

-- Claim the next batch for one due campaign. Settles leases that expired without an outcome as
-- outcome_unknown (never re-sent), blocks a campaign whose sender or postal address is no longer valid,
-- re-checks every recipient's eligibility, respects the daily ceiling, and leases what it returns.
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
      lease_until = now() + interval '10 minutes', route = snd->>'mode', updated_at = now()
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

-- Record one recipient's outcome from the canonical send. Idempotent: only a leased ('sending') row moves.
-- A send through Paige's account is metered once per recipient.
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
    VALUES (r.tenant_id, 'L3_tenant_passthrough', 'tenant', r.tenant_id, 'email', 'marketing_email_sent', 'resend', 1,
      public.email_campaign_unit_cost_usd(), now(), 'email_campaign_recipient:' || r.id::text,
      jsonb_build_object('campaign_id', r.campaign_id, 'version_id', r.version_id, 'cost_is_estimate', true), r.client_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN p_outcome;
END $$;

-- Called immediately before one recipient is handed to send-message. A campaign cancelled, blocked or
-- replaced since the batch was leased must not keep sending: a cancelled or replaced campaign cancels the
-- lease, a blocked one returns it to the queue for after resume. True means send now.
CREATE OR REPLACE FUNCTION public.email_campaign_dispatch_begin(p_recipient_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.email_campaign_recipients%ROWTYPE; c public.email_campaigns%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.email_campaign_recipients WHERE id = p_recipient_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'sending' OR r.lease_until IS NULL OR r.lease_until <= now() THEN RETURN false; END IF;
  SELECT * INTO c FROM public.email_campaigns WHERE id = r.campaign_id;
  IF c.status IN ('scheduled','sending') AND c.current_version_id = r.version_id THEN RETURN true; END IF;
  IF c.status = 'blocked' AND c.current_version_id = r.version_id THEN
    UPDATE public.email_campaign_recipients SET status = 'planned', lease_until = NULL,
      attempt_count = GREATEST(attempt_count - 1, 0), updated_at = now() WHERE id = r.id;
  ELSE
    UPDATE public.email_campaign_recipients SET status = 'cancelled', lease_until = NULL, updated_at = now() WHERE id = r.id;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.email_campaign_dispatch_begin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_campaign_dispatch_begin(uuid) TO service_role;

-- Settle a campaign once nothing is left to send. Totals come from the recipient rows (readback).
CREATE OR REPLACE FUNCTION public.email_campaign_dispatch_settle(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.email_campaigns%ROWTYPE; s jsonb; st text;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('planned', count(*) FILTER (WHERE status = 'planned'), 'sending', count(*) FILTER (WHERE status = 'sending'),
    'sent', count(*) FILTER (WHERE status = 'sent'), 'failed', count(*) FILTER (WHERE status = 'failed'),
    'outcome_unknown', count(*) FILTER (WHERE status = 'outcome_unknown'), 'skipped', count(*) FILTER (WHERE status = 'skipped'),
    'cancelled', count(*) FILTER (WHERE status = 'cancelled'), 'total', count(*))
    INTO s FROM public.email_campaign_recipients WHERE version_id = c.current_version_id;
  IF c.status IN ('blocked','cancelled') OR (s->>'planned')::int > 0 OR (s->>'sending')::int > 0 THEN
    RETURN s || jsonb_build_object('status', c.status, 'settled', false);
  END IF;
  st := CASE WHEN (s->>'sent')::int = 0 THEN 'failed'
             WHEN (s->>'failed')::int + (s->>'outcome_unknown')::int > 0 THEN 'partially_completed'
             ELSE 'completed' END;
  UPDATE public.email_campaigns SET status = st, updated_at = now() WHERE id = c.id;
  UPDATE public.email_campaign_versions SET state = 'sent', updated_at = now() WHERE id = c.current_version_id AND state = 'approved';
  UPDATE public.paige_pending_approvals SET status = 'sent', sent_at = now(), updated_at = now()
   WHERE id = (SELECT approval_id FROM public.email_campaign_versions WHERE id = c.current_version_id) AND status = 'approved';
  RETURN s || jsonb_build_object('status', st, 'settled', true);
END $$;

CREATE OR REPLACE FUNCTION public.email_campaign_dispatch_envelope(p_version_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(d) FROM public.email_campaign_dispatches d WHERE d.version_id = p_version_id
$$;

-- Open the durable-work envelope for a version's dispatch (idempotent: the version is the intent).
CREATE OR REPLACE FUNCTION public.email_campaign_dispatch_open(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.email_campaign_versions%ROWTYPE; d public.email_campaign_dispatches%ROWTYPE; w record;
BEGIN
  SELECT * INTO d FROM public.email_campaign_dispatches WHERE version_id = p_version_id;
  IF FOUND THEN RETURN to_jsonb(d); END IF;
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = p_version_id AND state IN ('approved','sent');
  IF NOT FOUND OR v.approved_by IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO w FROM public.create_paige_durable_work(v.tenant_id, v.approved_by, v.id, NULL,
    'marketing.email_campaign', 'email_campaign_dispatch',
    jsonb_build_object('tenant_id', v.tenant_id::text, 'actor_user_id', v.approved_by::text, 'approval_id', v.approval_id,
      'content_hash', v.content_hash, 'expected_recipients', v.expected_recipients),
    'email_campaign_version:' || v.id::text, 3600, 25);
  INSERT INTO public.email_campaign_dispatches (version_id, tenant_id, work_id, work_key)
  VALUES (v.id, v.tenant_id, w.work_id, w.server_idempotency_key)
  ON CONFLICT (version_id) DO NOTHING;
  SELECT * INTO d FROM public.email_campaign_dispatches WHERE version_id = p_version_id;
  RETURN to_jsonb(d);
END $$;

-- Resume a blocked campaign once what blocked it is fixed (the connector reconnected, the postal address
-- added). The approved sender must still be the one that resolves; a different sender needs a new version.
CREATE OR REPLACE FUNCTION public.email_campaign_resume(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); c public.email_campaigns%ROWTYPE; v public.email_campaign_versions%ROWTYPE; snd jsonb;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  IF c.status <> 'blocked' THEN RAISE EXCEPTION 'not_blocked' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = c.current_version_id;
  IF NOT EXISTS (SELECT 1 FROM public.tenants tn WHERE tn.id = t AND tn.status = 'active') THEN
    RAISE EXCEPTION 'business_inactive' USING ERRCODE = 'P0001';
  END IF;
  IF public._email_postal_address(t) IS NULL THEN RAISE EXCEPTION 'postal_address_missing' USING ERRCODE = 'P0001'; END IF;
  snd := public._email_resolve_sender(t, v.sender);
  IF NOT (snd->>'ok')::boolean THEN RAISE EXCEPTION '%', snd->>'reason' USING ERRCODE = 'P0001'; END IF;
  IF snd->>'from_address' IS DISTINCT FROM v.sender_snapshot->>'from_address' OR snd->>'mode' IS DISTINCT FROM v.sender_snapshot->>'mode'
     OR snd->>'from_name' IS DISTINCT FROM v.sender_snapshot->>'from_name' THEN
    RAISE EXCEPTION 'sender_changed' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.email_campaigns SET status = 'scheduled', blocked_reason = NULL, updated_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('campaign_id', c.id, 'status', 'scheduled');
END $$;
REVOKE ALL ON FUNCTION public.email_campaign_resume(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_campaign_resume(uuid) TO authenticated;

-- Dispatch envelopes whose durable work still needs a lifecycle transition, with the truth to record.
CREATE OR REPLACE FUNCTION public.email_campaign_dispatch_open_envelopes(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(jsonb_agg(x.j), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('version_id', d.version_id, 'tenant_id', d.tenant_id, 'campaign_id', c.id,
      'campaign_status', c.status, 'blocked_reason', c.blocked_reason, 'work_id', d.work_id, 'work_key', d.work_key,
      'work_status', w.status, 'lease_until', w.lease_until, 'is_current', c.current_version_id = d.version_id,
      'version_state', v.state, 'approved_by', v.approved_by,
      'totals', (SELECT jsonb_build_object('total', count(*), 'planned', count(*) FILTER (WHERE r.status = 'planned'),
          'sending', count(*) FILTER (WHERE r.status = 'sending'), 'sent', count(*) FILTER (WHERE r.status = 'sent'),
          'failed', count(*) FILTER (WHERE r.status = 'failed'),
          'outcome_unknown', count(*) FILTER (WHERE r.status = 'outcome_unknown'),
          'skipped', count(*) FILTER (WHERE r.status = 'skipped'), 'cancelled', count(*) FILTER (WHERE r.status = 'cancelled'))
        FROM public.email_campaign_recipients r WHERE r.version_id = d.version_id)) AS j
    FROM public.email_campaign_dispatches d
    JOIN public.paige_durable_work w ON w.id = d.work_id
    JOIN public.email_campaign_versions v ON v.id = d.version_id
    JOIN public.email_campaigns c ON c.id = v.campaign_id
    WHERE w.status NOT IN ('succeeded','failed','cancelled')
      -- An envelope already blocked while its campaign stays blocked needs nothing this tick; leaving
      -- it out keeps long-blocked campaigns from crowding newer envelopes off the list.
      AND NOT (w.status = 'blocked' AND c.status = 'blocked' AND c.current_version_id = d.version_id)
    ORDER BY d.created_at LIMIT LEAST(GREATEST(p_limit, 1), 100)) x
$$;

REVOKE ALL ON FUNCTION public.email_campaign_dispatch_open_envelopes(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_campaign_dispatch_open_envelopes(integer) TO service_role;
REVOKE ALL ON FUNCTION public.email_campaign_dispatch_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_campaign_dispatch_claim(integer) TO service_role;
REVOKE ALL ON FUNCTION public.email_campaign_dispatch_record(uuid,text,text,uuid,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_campaign_dispatch_record(uuid,text,text,uuid,text,text,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.email_campaign_dispatch_settle(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_campaign_dispatch_settle(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.email_campaign_dispatch_envelope(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_campaign_dispatch_envelope(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.email_campaign_dispatch_open(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_campaign_dispatch_open(uuid) TO service_role;

-- ── Receipts ───────────────────────────────────────────────────────────────────────────────────────
-- Unchanged except for the first lookup: a provider message id that belongs to a campaign recipient is
-- recorded on that recipient (first event of each kind wins), and a bounce or complaint suppresses the
-- address for that business. Opened and clicked stay separate provider events; neither is a conversion.

GRANT SELECT, UPDATE ON public.email_campaign_recipients TO service_role;
GRANT INSERT ON public.paige_suppressions TO service_role;

CREATE OR REPLACE FUNCTION public.process_resend_receipt(_receipt_id text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r public.resend_receipt_processing%ROWTYPE;
  origin public.email_send_log%ROWTYPE;
  cr public.email_campaign_recipients%ROWTYPE;
  at_ts timestamptz;
  outcome uuid;
  source_ok boolean := false;
BEGIN
  -- The primary key and this row lock serialize ingestion and scheduled reconciliation.
  SELECT * INTO r FROM public.resend_receipt_processing WHERE receipt_id = _receipt_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF r.state = 'processed' THEN RETURN 'duplicate'; END IF;
  IF r.state = 'unresolved' THEN RETURN 'unresolved'; END IF;
  IF r.attempts >= 64 OR r.expires_at <= now() THEN
    UPDATE public.resend_receipt_processing SET state = 'unresolved', reason = 'expired' WHERE receipt_id = r.receipt_id;
    RETURN 'unresolved';
  END IF;
  IF r.next_attempt_at > now() THEN RETURN 'pending'; END IF;
  UPDATE public.resend_receipt_processing
    SET attempts = attempts + 1,
        next_attempt_at = now() + make_interval(secs => LEAST(3600, 60 * power(2, LEAST(attempts, 6))::integer))
    WHERE receipt_id = r.receipt_id;
  BEGIN
    -- Marketing campaign recipients: the dispatcher records the provider id send-message returned.
    SELECT * INTO cr FROM public.email_campaign_recipients WHERE provider_message_id = r.message_id FOR UPDATE;
    IF FOUND THEN
      at_ts := COALESCE(r.event_at, r.received_at);
      UPDATE public.email_campaign_recipients SET
        delivered_at  = CASE WHEN r.status = 'delivered' THEN COALESCE(delivered_at, at_ts) ELSE delivered_at END,
        opened_at     = CASE WHEN r.status = 'opened' THEN COALESCE(opened_at, at_ts) ELSE opened_at END,
        clicked_at    = CASE WHEN r.status = 'clicked' THEN COALESCE(clicked_at, at_ts) ELSE clicked_at END,
        bounced_at    = CASE WHEN r.status = 'bounced' THEN COALESCE(bounced_at, at_ts) ELSE bounced_at END,
        complained_at = CASE WHEN r.status = 'complained' THEN COALESCE(complained_at, at_ts) ELSE complained_at END,
        updated_at = now()
      WHERE id = cr.id;
      IF r.status IN ('bounced','complained') THEN
        INSERT INTO public.paige_suppressions (tenant_id, contact_id, address_normalized, channel, reason, source)
        VALUES (cr.tenant_id, cr.client_id, CASE WHEN cr.client_id IS NULL THEN lower(btrim(cr.email)) END, 'email',
                CASE WHEN r.status = 'bounced' THEN 'bounce_hard' ELSE 'complaint' END, 'webhook')
        ON CONFLICT DO NOTHING;
      END IF;
      UPDATE public.resend_receipt_processing
        SET state = 'processed', reason = NULL, source_id = cr.id, outcome_id = cr.id
        WHERE receipt_id = r.receipt_id;
      RETURN 'processed';
    END IF;

    -- Preserve the existing provider-message-id contract, without guessing alternate IDs.
    -- The existing unique sent/message index makes this origin unambiguous.
    SELECT * INTO origin FROM public.email_send_log
      WHERE message_id = r.message_id AND status = 'sent'
        AND metadata->>'via' IN ('send-portal-invite','send-platform-invite','mcp.send_btf_template_email')
      FOR SHARE;
    IF NOT FOUND THEN
      UPDATE public.resend_receipt_processing SET reason = 'origin_pending' WHERE receipt_id = r.receipt_id;
      RETURN 'pending';
    END IF;
    IF origin.metadata->>'via' = 'send-portal-invite' THEN
      PERFORM 1 FROM public.tenant_invite_tokens ti
        WHERE ti.id::text = origin.metadata->>'invite_id'
          AND ti.tenant_id = origin.tenant_id
          AND ti.kind = origin.metadata->>'kind'
          AND origin.template_name = CASE WHEN ti.kind = 'team' THEN 'team_invite' ELSE 'portal_invite' END
          AND (lower(trim(ti.email)) = lower(trim(origin.recipient_email))
            OR (ti.kind <> 'team' AND NULLIF(trim(ti.email),'') IS NULL))
        FOR SHARE;
      source_ok := FOUND;
    ELSE
      -- Known platform sends may legitimately have no tenant. Never assign them one.
      source_ok := origin.metadata->>'invite_id' IS NULL
        AND (origin.metadata->>'via' = 'mcp.send_btf_template_email'
          OR origin.template_name = 'platform_invite');
    END IF;
    IF NOT source_ok THEN
      UPDATE public.resend_receipt_processing SET state = 'unresolved', reason = 'source_mismatch' WHERE receipt_id = r.receipt_id;
      RETURN 'unresolved';
    END IF;
    -- A retry from before this journal existed must not append an old receipt again.
    -- Never alter or collapse the historical rows, including pre-existing duplicates.
    IF EXISTS (SELECT 1 FROM public.email_send_log l
      WHERE l.metadata->>'via' = 'handle-resend-webhook' AND l.metadata->>'svix_id' = r.receipt_id
      AND (l.message_id IS DISTINCT FROM r.message_id OR l.status IS DISTINCT FROM r.status
        OR l.tenant_id IS DISTINCT FROM origin.tenant_id
        OR l.metadata->>'invite_id' IS DISTINCT FROM origin.metadata->>'invite_id'
        OR l.recipient_email IS DISTINCT FROM origin.recipient_email
        OR l.template_name IS DISTINCT FROM origin.template_name)) THEN
      UPDATE public.resend_receipt_processing SET state='unresolved', reason='source_mismatch' WHERE receipt_id=r.receipt_id;
      RETURN 'unresolved';
    END IF;
    SELECT l.id INTO outcome FROM public.email_send_log l
      WHERE l.metadata->>'via' = 'handle-resend-webhook' AND l.metadata->>'svix_id' = r.receipt_id
      ORDER BY l.created_at, l.id LIMIT 1;
    IF outcome IS NOT NULL THEN
      NULL; -- Existing source outcome; identity is already recorded.
    ELSIF r.status = 'sent' THEN
      outcome := origin.id; -- Provider handoff already recorded by sender; do not append.
    ELSE
      INSERT INTO public.email_send_log (template_name, recipient_email, message_id, status, tenant_id, sender_account, created_at, metadata)
      VALUES (origin.template_name, origin.recipient_email, r.message_id, r.status, origin.tenant_id, 'platform', COALESCE(r.event_at, r.received_at),
        jsonb_build_object('via','handle-resend-webhook','event','email.' || r.status,
          'svix_id',r.receipt_id,'invite_id',origin.metadata->>'invite_id','provider_created_at',r.event_at))
      RETURNING id INTO outcome;
    END IF;
    UPDATE public.resend_receipt_processing
      SET state = 'processed', reason = NULL, source_id = origin.id, outcome_id = outcome
      WHERE receipt_id = r.receipt_id;
    RETURN 'processed';
  EXCEPTION WHEN OTHERS THEN
    -- This subtransaction rolls back the outcome append. Keep the receipt for a bounded retry.
    -- Never persist or RAISE SQLERRM, SQLSTATE detail, or source data.
    UPDATE public.resend_receipt_processing SET reason = 'storage_retry' WHERE receipt_id = r.receipt_id;
    RETURN 'pending';
  END;
END;
$function$;

-- ── Worker schedule ────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-campaign-worker') THEN
    PERFORM cron.unschedule('email-campaign-worker');
  END IF;
END $$;
SELECT cron.schedule(
  'email-campaign-worker',
  '* * * * *',
  $$
    select net.http_post(
      url     := 'https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/email-campaign-worker',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-token', public.cron_token_header()),
      body    := '{}'::jsonb
    );
  $$
);

COMMENT ON TABLE public.email_campaigns IS 'Marketing email campaigns (incl. newsletters). Content lives in versions; written only through email_campaign_* functions.';
COMMENT ON TABLE public.email_campaign_versions IS 'Campaign versions. Requesting approval freezes a version under a content hash; a sent version is history.';
COMMENT ON TABLE public.email_campaign_recipients IS 'The audience snapshot of a version and each recipient''s send and provider-receipt evidence. Row id = send idempotency key.';
COMMENT ON TABLE public.email_segments IS 'Reusable, dynamic audience rules. A campaign snapshots a segment when its version is frozen.';
COMMENT ON TABLE public.email_campaign_dispatches IS 'Service-only link from a dispatched version to its paige_durable_work envelope.';
