-- Marketing email E3: series — welcome, nurture and re-engagement emails that send by themselves.
--
-- Owner rulings this builds on (2026-10-04, decision log): one send substrate; one bounded approval;
-- sequences separate (E3); PAIGE proposes, never blasts; "Paige's Resend, capped" (500 a day per business);
-- campaigns opt-out; postal address: "Block until it's added". The E2 dashboard already promised "series
-- that send by themselves".
--
-- A SERIES is its own record (email_sequences, versions, steps, enrollments). It does NOT get a second way
-- to send email. Each step of the approved ("live") version is backed by a series-owned email_campaigns row
-- (sequence_id + sequence_position) whose current version holds that step's content, so every series email
-- goes through the one substrate: the email-campaign-worker, its claim and lease, the recipient-by-recipient
-- eligibility re-check, the shared 500-a-day ceiling, the footer and unsubscribe link, send-message,
-- provider receipts and metering. Those rows never appear in campaign lists, and no campaign function a
-- person can call may change them (_email_series_owned_guard).
--
-- ONE APPROVAL PER SERIES VERSION. Filing locks the version (who enters, every email, every wait, the exits
-- and the sender) under one content hash and files one approval. Only a person approves; after that the
-- series sends by itself until it is paused or stopped. Changing a running series makes a new draft; the
-- running version keeps sending until the change is approved, and people then continue on the new emails
-- from where they are.
--
-- WHO ENTERS. entry_mode 'new_contacts': contacts created after the series first started who match the rule
-- (welcome). 'matching': anyone who matches the rule, now or later (nurture, re-engagement). Filing refuses a
-- series whose rule already matches more people than the daily limit, as a campaign does, so one approval
-- never commits the business's whole sending day to a backlog. One enrollment per contact per series, ever.
--
-- TIMING. Email 1 waits its delay from when the person entered; every later email waits its delay from when
-- the previous one was SENT. An email held back (quiet hours, the daily limit, a pause) holds the rest.
--
-- LEAVING. Automatically: an email to them was skipped (opted out, suppressed, no address, removed contact),
-- failed, or went unconfirmed (never resent automatically); they reached the series goal after entering
-- (exit_on_goal); they stopped matching who enters (exit_when_unmatched); the owner removed them; the series
-- was stopped. Otherwise they complete after the last email.
--
-- email_sequence_tick() (service only) runs from the email-campaign-worker each minute: it enrolls new
-- matches, applies the exits, and plans each person's next email as a planned recipient with not_before.
--
-- AUTHORITY (§9/§53/§59). Reads: owner/admin of the row's business or the platform owner. Writes only through
-- these functions, each re-checking is_tenant_admin(current_user_tenant_id()) via _email_caller_tenant().

SET lock_timeout = '10s';

-- ── Tables ─────────────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'custom' CHECK (kind IN ('welcome','nurture','reengagement','custom')),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','active','paused','blocked','stopped')),
  blocked_reason text CHECK (blocked_reason IS NULL OR char_length(blocked_reason) <= 300),
  -- The version being edited or awaiting approval; equals live_version_id when nothing is being changed.
  current_version_id uuid,
  -- The approved version that sends.
  live_version_id uuid,
  -- When the series first started: 'new contacts' means contacts created after this.
  activated_at timestamptz,
  stopped_at timestamptz,
  -- When the tick last looked for new people to enroll and for people to leave.
  checked_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_sequences_tenant_updated ON public.email_sequences (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS email_sequences_running ON public.email_sequences (status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.email_sequence_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no >= 1),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','locked','approved','superseded')),
  entry_mode text NOT NULL DEFAULT 'matching' CHECK (entry_mode IN ('new_contacts','matching')),
  -- {"stages":[...],"sources":[...],"tags":[...],"inactive_days":90}; empty means everyone.
  audience jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(audience) = 'object' AND pg_column_size(audience) <= 8192),
  segment_id uuid REFERENCES public.email_segments(id) ON DELETE SET NULL,
  exit_on_goal text NOT NULL DEFAULT 'none'
    CHECK (exit_on_goal IN ('none','form_submission','booking','deal_created','invoice_paid')),
  exit_when_unmatched boolean NOT NULL DEFAULT false,
  sender jsonb NOT NULL DEFAULT '{"mode":"managed"}'::jsonb CHECK (jsonb_typeof(sender) = 'object'),
  sender_snapshot jsonb,
  content_hash text,
  -- People the rule matched when the version was filed ('matching' series); NULL for 'new contacts'.
  expected_entrants integer CHECK (expected_entrants IS NULL OR expected_entrants >= 0),
  approval_id uuid REFERENCES public.paige_pending_approvals(id) ON DELETE SET NULL,
  locked_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, version_no)
);
CREATE INDEX IF NOT EXISTS email_sequence_versions_sequence ON public.email_sequence_versions (sequence_id, version_no DESC);

ALTER TABLE public.email_sequences DROP CONSTRAINT IF EXISTS email_sequences_current_version_fk;
ALTER TABLE public.email_sequences ADD CONSTRAINT email_sequences_current_version_fk FOREIGN KEY (current_version_id)
  REFERENCES public.email_sequence_versions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.email_sequences DROP CONSTRAINT IF EXISTS email_sequences_live_version_fk;
ALTER TABLE public.email_sequences ADD CONSTRAINT email_sequences_live_version_fk FOREIGN KEY (live_version_id)
  REFERENCES public.email_sequence_versions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS public.email_sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.email_sequence_versions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 10),
  -- Minutes after entering (email 1) or after the previous email was sent; at most 90 days.
  delay_minutes integer NOT NULL DEFAULT 0 CHECK (delay_minutes BETWEEN 0 AND 129600),
  subject text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 300),
  preheader text NOT NULL DEFAULT '' CHECK (char_length(preheader) <= 300),
  body_html text NOT NULL DEFAULT '' CHECK (char_length(body_html) <= 200000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Deferred so reordering can renumber in one statement.
  CONSTRAINT email_sequence_steps_position_key UNIQUE (version_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS public.email_sequence_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','exited')),
  exit_reason text CHECK (exit_reason IS NULL OR exit_reason IN (
    'opted_out','suppressed','no_consent','no_address','contact_removed','unsubscribe_unavailable','sender_refused',
    'send_failed','not_confirmed','reached_goal','stopped_matching','removed','series_stopped','already_sent')),
  -- The email they are on: the one planned or sending, or the last one sent. 0 before the first.
  position integer NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 10),
  entered_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, client_id)
);
CREATE INDEX IF NOT EXISTS email_sequence_enrollments_active ON public.email_sequence_enrollments (sequence_id, status, updated_at);

-- Series-owned campaigns: one per step position of a series.
ALTER TABLE public.email_campaigns
  ADD COLUMN IF NOT EXISTS sequence_id uuid REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sequence_position integer CHECK (sequence_position IS NULL OR sequence_position BETWEEN 1 AND 10);
ALTER TABLE public.email_campaigns DROP CONSTRAINT IF EXISTS email_campaigns_sequence_pair;
ALTER TABLE public.email_campaigns ADD CONSTRAINT email_campaigns_sequence_pair
  CHECK ((sequence_id IS NULL) = (sequence_position IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS email_campaigns_sequence_step ON public.email_campaigns (sequence_id, sequence_position)
  WHERE sequence_id IS NOT NULL;

-- Which enrollment a series email belongs to.
ALTER TABLE public.email_campaign_recipients
  ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES public.email_sequence_enrollments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS email_campaign_recipients_enrollment ON public.email_campaign_recipients (enrollment_id, created_at DESC)
  WHERE enrollment_id IS NOT NULL;

ALTER TABLE public.email_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequence_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequence_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_sequences, public.email_sequence_versions, public.email_sequence_steps,
  public.email_sequence_enrollments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.email_sequences, public.email_sequence_versions, public.email_sequence_steps,
  public.email_sequence_enrollments TO authenticated;
GRANT ALL ON public.email_sequences, public.email_sequence_versions, public.email_sequence_steps,
  public.email_sequence_enrollments TO service_role;

DROP POLICY IF EXISTS email_sequences_admin_read ON public.email_sequences;
CREATE POLICY email_sequences_admin_read ON public.email_sequences FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.is_platform_owner());
DROP POLICY IF EXISTS email_sequence_versions_admin_read ON public.email_sequence_versions;
CREATE POLICY email_sequence_versions_admin_read ON public.email_sequence_versions FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.is_platform_owner());
DROP POLICY IF EXISTS email_sequence_steps_admin_read ON public.email_sequence_steps;
CREATE POLICY email_sequence_steps_admin_read ON public.email_sequence_steps FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.is_platform_owner());
DROP POLICY IF EXISTS email_sequence_enrollments_admin_read ON public.email_sequence_enrollments;
CREATE POLICY email_sequence_enrollments_admin_read ON public.email_sequence_enrollments FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.is_platform_owner());

-- Campaign lists never show a series' own campaigns; the series is where those are seen.
DROP POLICY IF EXISTS email_campaigns_admin_read ON public.email_campaigns;
CREATE POLICY email_campaigns_admin_read ON public.email_campaigns FOR SELECT TO authenticated
  USING ((public.is_tenant_admin(tenant_id) OR public.is_platform_owner()) AND sequence_id IS NULL);

-- ── Freezing and ownership ─────────────────────────────────────────────────────────────────────────

-- A series version that has left draft is history: who enters, the exits and the sender never change.
CREATE OR REPLACE FUNCTION public._email_sequence_version_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.state <> 'draft' AND (
       NEW.entry_mode IS DISTINCT FROM OLD.entry_mode OR NEW.audience IS DISTINCT FROM OLD.audience
    OR NEW.segment_id IS DISTINCT FROM OLD.segment_id OR NEW.exit_on_goal IS DISTINCT FROM OLD.exit_on_goal
    OR NEW.exit_when_unmatched IS DISTINCT FROM OLD.exit_when_unmatched OR NEW.sender IS DISTINCT FROM OLD.sender
    OR NEW.sender_snapshot IS DISTINCT FROM OLD.sender_snapshot OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
    OR NEW.expected_entrants IS DISTINCT FROM OLD.expected_entrants OR NEW.sequence_id IS DISTINCT FROM OLD.sequence_id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    RAISE EXCEPTION 'version_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS email_sequence_version_frozen ON public.email_sequence_versions;
CREATE TRIGGER email_sequence_version_frozen BEFORE UPDATE ON public.email_sequence_versions
  FOR EACH ROW EXECUTE FUNCTION public._email_sequence_version_frozen();

-- Its emails freeze with it. A step whose version no longer exists is being deleted with it (cascade).
CREATE OR REPLACE FUNCTION public._email_sequence_step_frozen()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE st text;
BEGIN
  -- Deleted with its version (a cascade, one trigger level down): nothing to protect.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  SELECT state INTO st FROM public.email_sequence_versions
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  IF FOUND AND st <> 'draft' THEN RAISE EXCEPTION 'version_frozen' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.version_id IS DISTINCT FROM OLD.version_id THEN
    RAISE EXCEPTION 'version_frozen' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS email_sequence_step_frozen ON public.email_sequence_steps;
CREATE TRIGGER email_sequence_step_frozen BEFORE INSERT OR UPDATE OR DELETE ON public.email_sequence_steps
  FOR EACH ROW EXECUTE FUNCTION public._email_sequence_step_frozen();

-- A series' own campaigns are changed only by the series functions (which set paige.email_sequence_write)
-- or by the service-role dispatcher. Every campaign function a person can call is refused on them, so a
-- running series cannot be edited, cancelled, deleted or re-filed from the campaign side.
CREATE OR REPLACE FUNCTION public._email_series_owned_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE sid uuid;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(current_setting('paige.email_sequence_write', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_TABLE_NAME = 'email_campaigns' THEN
    sid := OLD.sequence_id;
  ELSE
    SELECT c.sequence_id INTO sid FROM public.email_campaigns c
     WHERE c.id = CASE WHEN TG_OP = 'INSERT' THEN NEW.campaign_id ELSE OLD.campaign_id END;
  END IF;
  IF sid IS NOT NULL THEN
    RAISE EXCEPTION 'campaign_belongs_to_series' USING ERRCODE = '42501',
      HINT = 'Change an email series through its series functions.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public._email_series_owned_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS email_campaigns_series_owned ON public.email_campaigns;
CREATE TRIGGER email_campaigns_series_owned BEFORE UPDATE OR DELETE ON public.email_campaigns
  FOR EACH ROW EXECUTE FUNCTION public._email_series_owned_guard();
DROP TRIGGER IF EXISTS email_campaign_versions_series_owned ON public.email_campaign_versions;
CREATE TRIGGER email_campaign_versions_series_owned BEFORE INSERT OR UPDATE OR DELETE ON public.email_campaign_versions
  FOR EACH ROW EXECUTE FUNCTION public._email_series_owned_guard();

-- ── Shared rules ───────────────────────────────────────────────────────────────────────────────────

-- The hash the approval binds: who enters, the exits, the sender, and every email with its wait.
CREATE OR REPLACE FUNCTION public._email_sequence_hash(p_version_id uuid, p_kind text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'kind', p_kind, 'entry_mode', v.entry_mode, 'audience', v.audience, 'segment_id', v.segment_id,
    'exit_on_goal', v.exit_on_goal, 'exit_when_unmatched', v.exit_when_unmatched, 'sender', v.sender,
    'steps', COALESCE((SELECT jsonb_agg(jsonb_build_object('position', s.position, 'delay_minutes', s.delay_minutes,
                         'subject', s.subject, 'preheader', s.preheader, 'body_html', s.body_html) ORDER BY s.position)
                       FROM public.email_sequence_steps s WHERE s.version_id = v.id), '[]'::jsonb))::text, 'UTF8')), 'hex')
  FROM public.email_sequence_versions v WHERE v.id = p_version_id
$$;
REVOKE ALL ON FUNCTION public._email_sequence_hash(uuid, text) FROM PUBLIC, anon, authenticated;

-- A segment's rule, or the version's own rule when no segment is used.
CREATE OR REPLACE FUNCTION public._email_sequence_rule(p_version_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT s.rule FROM public.email_segments s WHERE s.id = v.segment_id AND s.tenant_id = v.tenant_id), v.audience)
  FROM public.email_sequence_versions v WHERE v.id = p_version_id
$$;
REVOKE ALL ON FUNCTION public._email_sequence_rule(uuid) FROM PUBLIC, anon, authenticated;

-- Has this contact reached the goal since they entered?
CREATE OR REPLACE FUNCTION public._email_goal_reached(p_tenant uuid, p_client uuid, p_goal text, p_since timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_client IS NOT NULL AND CASE p_goal
    WHEN 'form_submission' THEN EXISTS (SELECT 1 FROM public.growth_form_submissions g
      WHERE g.tenant_id = p_tenant AND g.contact_id = p_client AND g.created_at > p_since)
    WHEN 'booking' THEN EXISTS (SELECT 1 FROM public.internal_bookings b
      WHERE b.tenant_id = p_tenant AND b.contact_id = p_client AND b.created_at > p_since
        AND lower(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled'))
    WHEN 'deal_created' THEN EXISTS (SELECT 1 FROM public.deals d
      WHERE d.tenant_id = p_tenant AND d.contact_client_id = p_client AND d.created_at > p_since)
    WHEN 'invoice_paid' THEN EXISTS (SELECT 1 FROM public.paige_invoices i
      WHERE i.tenant_id = p_tenant AND i.contact_id = p_client AND i.paid_at > p_since)
    ELSE false END
$$;
REVOKE ALL ON FUNCTION public._email_goal_reached(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;

-- The current draft version of a series, locked, or an error a person can act on.
CREATE OR REPLACE FUNCTION public._email_sequence_draft(p_tenant uuid, p_sequence_id uuid)
RETURNS public.email_sequence_versions LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.email_sequences%ROWTYPE; v public.email_sequence_versions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = p_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.status = 'stopped' THEN RAISE EXCEPTION 'series_stopped' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v FROM public.email_sequence_versions WHERE id = s.current_version_id FOR UPDATE;
  IF NOT FOUND OR v.state <> 'draft' THEN RAISE EXCEPTION 'not_an_editable_draft' USING ERRCODE = 'P0001'; END IF;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public._email_sequence_draft(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- A new draft copied from a version, with its emails. Internal.
CREATE OR REPLACE FUNCTION public._email_sequence_copy(p_from uuid, p_actor uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE f public.email_sequence_versions%ROWTYPE; nv uuid;
BEGIN
  SELECT * INTO f FROM public.email_sequence_versions WHERE id = p_from;
  INSERT INTO public.email_sequence_versions (sequence_id, tenant_id, version_no, entry_mode, audience, segment_id,
    exit_on_goal, exit_when_unmatched, sender, created_by)
  VALUES (f.sequence_id, f.tenant_id, (SELECT max(version_no) + 1 FROM public.email_sequence_versions WHERE sequence_id = f.sequence_id),
    f.entry_mode, f.audience, f.segment_id, f.exit_on_goal, f.exit_when_unmatched, f.sender, p_actor)
  RETURNING id INTO nv;
  INSERT INTO public.email_sequence_steps (version_id, tenant_id, position, delay_minutes, subject, preheader, body_html)
  SELECT nv, s.tenant_id, s.position, s.delay_minutes, s.subject, s.preheader, s.body_html
    FROM public.email_sequence_steps s WHERE s.version_id = f.id;
  RETURN nv;
END $$;
REVOKE ALL ON FUNCTION public._email_sequence_copy(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── Callable seam: building a series (UI and, later, PAIGE) ─────────────────────────────────────────

-- A new series with the starter for its kind: who enters, and the waits between its emails. The emails
-- themselves start empty; a series cannot be filed until each one has a subject and words.
CREATE OR REPLACE FUNCTION public.email_sequence_create(p_kind text DEFAULT 'custom', p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_caller_tenant(); k text := COALESCE(p_kind, 'custom');
  s uuid; v uuid; conn uuid; delays int[];
BEGIN
  IF k NOT IN ('welcome','nurture','reengagement','custom') THEN RAISE EXCEPTION 'kind_invalid' USING ERRCODE = '22023'; END IF;
  -- Connected provider first (owner ruling 1), exactly as a new campaign.
  SELECT id INTO conn FROM public.channel_connectors
   WHERE tenant_id = t AND channel_type = 'email' AND active AND status = 'active'
     AND NULLIF(btrim(COALESCE(from_address, '')), '') IS NOT NULL
     AND COALESCE((config->>'managed_default')::boolean, false) = false
   ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1;
  INSERT INTO public.email_sequences (tenant_id, kind, name, created_by)
  VALUES (t, k, COALESCE(NULLIF(btrim(p_name), ''), CASE k WHEN 'welcome' THEN 'Welcome series'
    WHEN 'nurture' THEN 'Nurture series' WHEN 'reengagement' THEN 'Win-back series' ELSE 'New series' END), auth.uid())
  RETURNING id INTO s;
  INSERT INTO public.email_sequence_versions (sequence_id, tenant_id, version_no, entry_mode, audience, exit_when_unmatched,
    sender, created_by)
  VALUES (s, t, 1,
    CASE WHEN k = 'welcome' THEN 'new_contacts' ELSE 'matching' END,
    CASE k WHEN 'nurture' THEN '{"stages":["new_lead","lead"]}'::jsonb WHEN 'reengagement' THEN '{"inactive_days":90}'::jsonb
      ELSE '{}'::jsonb END,
    k = 'reengagement',
    CASE WHEN conn IS NULL THEN '{"mode":"managed"}'::jsonb ELSE jsonb_build_object('mode', 'connector', 'connector_id', conn) END,
    auth.uid())
  RETURNING id INTO v;
  delays := CASE k WHEN 'welcome' THEN ARRAY[0, 2880, 7200] WHEN 'nurture' THEN ARRAY[0, 4320, 10080, 10080]
    WHEN 'reengagement' THEN ARRAY[0, 5760, 10080] ELSE ARRAY[0] END;
  INSERT INTO public.email_sequence_steps (version_id, tenant_id, position, delay_minutes)
  SELECT v, t, i, delays[i] FROM generate_subscripts(delays, 1) AS i;
  UPDATE public.email_sequences SET current_version_id = v WHERE id = s;
  RETURN jsonb_build_object('sequence_id', s, 'version_id', v);
END $$;

-- Edit the draft's settings. NULL leaves a field as it is.
CREATE OR REPLACE FUNCTION public.email_sequence_update_draft(
  p_sequence_id uuid, p_name text DEFAULT NULL, p_entry_mode text DEFAULT NULL, p_audience jsonb DEFAULT NULL,
  p_segment_id uuid DEFAULT NULL, p_clear_segment boolean DEFAULT false, p_exit_on_goal text DEFAULT NULL,
  p_exit_when_unmatched boolean DEFAULT NULL, p_sender jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); v public.email_sequence_versions%ROWTYPE;
BEGIN
  v := public._email_sequence_draft(t, p_sequence_id);
  IF p_entry_mode IS NOT NULL AND p_entry_mode NOT IN ('new_contacts','matching') THEN
    RAISE EXCEPTION 'entry_mode_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_segment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.email_segments WHERE id = p_segment_id AND tenant_id = t) THEN
    RAISE EXCEPTION 'segment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_sender IS NOT NULL AND NOT (
       (p_sender->>'mode' = 'managed')
    OR (p_sender->>'mode' = 'connector' AND EXISTS (SELECT 1 FROM public.channel_connectors
          WHERE id = NULLIF(p_sender->>'connector_id','')::uuid AND tenant_id = t AND channel_type = 'email'))) THEN
    RAISE EXCEPTION 'sender_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.email_sequence_versions SET
    entry_mode = COALESCE(p_entry_mode, entry_mode), audience = COALESCE(p_audience, audience),
    segment_id = CASE WHEN p_clear_segment THEN NULL ELSE COALESCE(p_segment_id, segment_id) END,
    exit_on_goal = COALESCE(p_exit_on_goal, exit_on_goal),
    exit_when_unmatched = COALESCE(p_exit_when_unmatched, exit_when_unmatched),
    sender = COALESCE(p_sender, sender), updated_at = now()
   WHERE id = v.id;
  UPDATE public.email_sequences SET name = COALESCE(NULLIF(btrim(p_name), ''), name), updated_at = now() WHERE id = p_sequence_id;
  RETURN v.id;
END $$;

-- Write one email of the draft. p_position NULL (or one past the last) adds an email at the end.
CREATE OR REPLACE FUNCTION public.email_sequence_step_save(
  p_sequence_id uuid, p_position integer DEFAULT NULL, p_delay_minutes integer DEFAULT NULL,
  p_subject text DEFAULT NULL, p_preheader text DEFAULT NULL, p_body_html text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); v public.email_sequence_versions%ROWTYPE; n int; pos int;
BEGIN
  v := public._email_sequence_draft(t, p_sequence_id);
  SELECT count(*) INTO n FROM public.email_sequence_steps WHERE version_id = v.id;
  IF p_position IS NULL OR p_position = n + 1 THEN
    IF n >= 10 THEN RAISE EXCEPTION 'too_many_steps' USING ERRCODE = 'P0001'; END IF;
    pos := n + 1;
    INSERT INTO public.email_sequence_steps (version_id, tenant_id, position, delay_minutes, subject, preheader, body_html)
    VALUES (v.id, t, pos, COALESCE(p_delay_minutes, CASE WHEN pos = 1 THEN 0 ELSE 4320 END),
      COALESCE(p_subject, ''), COALESCE(p_preheader, ''), COALESCE(p_body_html, ''));
  ELSIF p_position BETWEEN 1 AND n THEN
    pos := p_position;
    UPDATE public.email_sequence_steps SET delay_minutes = COALESCE(p_delay_minutes, delay_minutes),
      subject = COALESCE(p_subject, subject), preheader = COALESCE(p_preheader, preheader),
      body_html = COALESCE(p_body_html, body_html), updated_at = now()
     WHERE version_id = v.id AND position = pos;
  ELSE
    RAISE EXCEPTION 'step_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.email_sequence_versions SET updated_at = now() WHERE id = v.id;
  UPDATE public.email_sequences SET updated_at = now() WHERE id = p_sequence_id;
  RETURN jsonb_build_object('version_id', v.id, 'position', pos, 'steps', GREATEST(n, pos));
END $$;

CREATE OR REPLACE FUNCTION public.email_sequence_step_delete(p_sequence_id uuid, p_position integer)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); v public.email_sequence_versions%ROWTYPE; n int;
BEGIN
  v := public._email_sequence_draft(t, p_sequence_id);
  DELETE FROM public.email_sequence_steps WHERE version_id = v.id AND position = p_position;
  IF NOT FOUND THEN RAISE EXCEPTION 'step_not_found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.email_sequence_steps SET position = position - 1, updated_at = now()
   WHERE version_id = v.id AND position > p_position;
  SELECT count(*) INTO n FROM public.email_sequence_steps WHERE version_id = v.id;
  UPDATE public.email_sequences SET updated_at = now() WHERE id = p_sequence_id;
  RETURN n;
END $$;

-- Move one email to another place in the order.
CREATE OR REPLACE FUNCTION public.email_sequence_step_move(p_sequence_id uuid, p_from integer, p_to integer)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); v public.email_sequence_versions%ROWTYPE; n int;
BEGIN
  v := public._email_sequence_draft(t, p_sequence_id);
  SELECT count(*) INTO n FROM public.email_sequence_steps WHERE version_id = v.id;
  IF p_from NOT BETWEEN 1 AND n OR p_to NOT BETWEEN 1 AND n THEN RAISE EXCEPTION 'step_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_from <> p_to THEN
    UPDATE public.email_sequence_steps SET updated_at = now(), position = CASE
        WHEN position = p_from THEN p_to
        WHEN p_from < p_to AND position BETWEEN p_from + 1 AND p_to THEN position - 1
        WHEN p_from > p_to AND position BETWEEN p_to AND p_from - 1 THEN position + 1
        ELSE position END
     WHERE version_id = v.id;
    UPDATE public.email_sequences SET updated_at = now() WHERE id = p_sequence_id;
  END IF;
  RETURN p_to;
END $$;

-- Start changing a series: a new draft copied from its current version. A running series keeps sending its
-- approved version until the change is approved. A version awaiting approval is withdrawn (its approval is
-- skipped) and becomes the new draft. Returns the draft's id; an existing draft is returned as it is.
CREATE OR REPLACE FUNCTION public.email_sequence_edit(p_sequence_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); s public.email_sequences%ROWTYPE; cur public.email_sequence_versions%ROWTYPE; nv uuid;
BEGIN
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.status = 'stopped' THEN RAISE EXCEPTION 'series_stopped' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO cur FROM public.email_sequence_versions WHERE id = s.current_version_id FOR UPDATE;
  IF cur.state = 'draft' THEN RETURN cur.id; END IF;
  IF cur.state = 'locked' THEN
    -- Withdrawn first, so the approval trigger does not also make a copy.
    UPDATE public.email_sequence_versions SET state = 'superseded', updated_at = now() WHERE id = cur.id;
    UPDATE public.paige_pending_approvals SET status = 'skipped',
      decision_rationale = 'A newer draft replaced the series awaiting approval.', updated_at = now()
     WHERE id = cur.approval_id AND status = 'pending';
  END IF;
  nv := public._email_sequence_copy(cur.id, auth.uid());
  UPDATE public.email_sequences SET current_version_id = nv,
    status = CASE WHEN s.live_version_id IS NULL THEN 'draft' ELSE s.status END, updated_at = now()
   WHERE id = s.id;
  RETURN nv;
END $$;

-- Drop the change being made to a running series; it keeps its approved version.
CREATE OR REPLACE FUNCTION public.email_sequence_discard_draft(p_sequence_id uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); s public.email_sequences%ROWTYPE; cur public.email_sequence_versions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.live_version_id IS NULL OR s.current_version_id = s.live_version_id THEN
    RAISE EXCEPTION 'nothing_to_discard' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO cur FROM public.email_sequence_versions WHERE id = s.current_version_id FOR UPDATE;
  IF cur.state = 'locked' THEN
    UPDATE public.email_sequence_versions SET state = 'superseded', updated_at = now() WHERE id = cur.id;
    UPDATE public.paige_pending_approvals SET status = 'skipped', decision_rationale = 'The change was discarded.', updated_at = now()
     WHERE id = cur.approval_id AND status = 'pending';
  ELSIF cur.state = 'draft' THEN
    UPDATE public.email_sequences SET current_version_id = s.live_version_id WHERE id = s.id;
    DELETE FROM public.email_sequence_versions WHERE id = cur.id;
  END IF;
  UPDATE public.email_sequences SET current_version_id = s.live_version_id, updated_at = now() WHERE id = s.id;
  RETURN s.live_version_id;
END $$;

-- Delete a series that never started. One that has run is stopped instead, so its history stays.
CREATE OR REPLACE FUNCTION public.email_sequence_delete(p_sequence_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); s public.email_sequences%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.live_version_id IS NOT NULL OR s.activated_at IS NOT NULL THEN RAISE EXCEPTION 'series_has_history' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.email_sequence_versions SET state = 'superseded', updated_at = now() WHERE sequence_id = s.id AND state = 'locked';
  UPDATE public.paige_pending_approvals SET status = 'skipped', decision_rationale = 'The series was deleted.', updated_at = now()
   WHERE id IN (SELECT approval_id FROM public.email_sequence_versions WHERE sequence_id = s.id) AND status = 'pending';
  DELETE FROM public.email_sequences WHERE id = s.id;
  RETURN true;
END $$;

-- ── Callable seam: the one approval ────────────────────────────────────────────────────────────────

-- Freeze the draft for approval: every email needs a subject and words, the business needs a postal address
-- and a sender that resolves, and a 'matching' series may not already match more people than the daily
-- limit. Files ONE approval binding the content hash, the sender and the count. p_source 'paige' files it
-- for the owner to decide; 'owner' is the owner's own review step.
CREATE OR REPLACE FUNCTION public.email_sequence_request_approval(p_sequence_id uuid, p_source text DEFAULT 'owner')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_caller_tenant();
  s public.email_sequences%ROWTYPE; v public.email_sequence_versions%ROWTYPE;
  snd jsonb; n int; steps int; bad int; hash text; appr uuid; cap int := public.email_campaign_daily_cap();
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
  IF v.entry_mode = 'matching' THEN
    SELECT count(*) INTO n FROM public._email_audience(t, v.audience, false) a WHERE a.ineligible IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.email_sequence_enrollments x WHERE x.sequence_id = s.id AND x.client_id = a.client_id);
    IF n > cap THEN
      RAISE EXCEPTION 'over_daily_cap' USING ERRCODE = 'P0001',
        DETAIL = format('%s people match now; the daily limit is %s', n, cap);
    END IF;
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
      'matching_now', n, 'from_address', snd->>'from_address', 'daily_limit', cap),
    jsonb_build_object('email_sequence_version_id', v.id, 'content_hash', hash, 'matching_now', n, 'daily_limit', cap,
      'daily_cost_bound_usd', CASE WHEN snd->>'mode' = 'managed' OR COALESCE((snd->>'platform_funded')::boolean, false)
        THEN round(cap * public.email_campaign_unit_cost_usd(), 4) ELSE 0 END,
      'sender', snd))
  RETURNING id INTO appr;

  UPDATE public.email_sequence_versions SET state = 'locked', content_hash = hash, sender_snapshot = snd,
    expected_entrants = n, approval_id = appr, locked_at = now(), updated_at = now()
   WHERE id = v.id;
  UPDATE public.email_sequences SET status = CASE WHEN s.live_version_id IS NULL THEN 'pending_approval' ELSE s.status END,
    updated_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('approval_id', appr, 'sequence_id', s.id, 'version_id', v.id, 'emails', steps,
    'matching_now', n, 'from_address', snd->>'from_address');
END $$;

-- The one approval. A person (owner or admin) approves the frozen version; the hash is re-derived, and the
-- sender must still resolve to the one it was filed with. Each email gets (or keeps) its series-owned
-- campaign, whose new approved version carries that email; emails still waiting under an older version are
-- withdrawn so the tick re-plans them on the new content, keeping each person where they are.
CREATE OR REPLACE FUNCTION public.email_sequence_approve(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_caller_tenant();
  v public.email_sequence_versions%ROWTYPE; s public.email_sequences%ROWTYPE; a public.paige_pending_approvals%ROWTYPE;
  st public.email_sequence_steps%ROWTYPE; camp public.email_campaigns%ROWTYPE;
  snd jsonb; n int; ov uuid; nv uuid; ckind text; cstatus text; creason text; st_now text;
BEGIN
  SELECT * INTO v FROM public.email_sequence_versions WHERE id = p_version_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v.state <> 'locked' THEN RAISE EXCEPTION 'not_awaiting_approval' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO s FROM public.email_sequences WHERE id = v.sequence_id FOR UPDATE;
  IF s.current_version_id IS DISTINCT FROM v.id OR s.status = 'stopped' THEN
    RAISE EXCEPTION 'not_awaiting_approval' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO a FROM public.paige_pending_approvals WHERE id = v.approval_id FOR UPDATE;
  IF NOT FOUND OR a.status <> 'pending' OR a.type <> 'campaign_send' OR a.tenant_id IS DISTINCT FROM t
     OR a.metadata->>'email_sequence_version_id' IS DISTINCT FROM v.id::text THEN
    RAISE EXCEPTION 'approval_not_pending' USING ERRCODE = 'P0001';
  END IF;
  IF a.metadata->>'content_hash' IS DISTINCT FROM public._email_sequence_hash(v.id, s.kind)
     OR a.metadata->>'content_hash' IS DISTINCT FROM v.content_hash THEN
    RAISE EXCEPTION 'approval_stale' USING ERRCODE = 'P0001';
  END IF;
  IF public._email_postal_address(t) IS NULL THEN RAISE EXCEPTION 'postal_address_missing' USING ERRCODE = 'P0001'; END IF;
  snd := public._email_resolve_sender(t, v.sender);
  IF NOT (snd->>'ok')::boolean THEN RAISE EXCEPTION '%', snd->>'reason' USING ERRCODE = 'P0001'; END IF;
  IF snd->>'from_address' IS DISTINCT FROM v.sender_snapshot->>'from_address' OR snd->>'mode' IS DISTINCT FROM v.sender_snapshot->>'mode'
     OR snd->>'from_name' IS DISTINCT FROM v.sender_snapshot->>'from_name' THEN
    RAISE EXCEPTION 'sender_changed' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('paige.email_sequence_approve', v.id::text, true);
  PERFORM set_config('paige.email_sequence_write', 'on', true);
  UPDATE public.paige_pending_approvals SET status = 'approved', reviewed_by_user_id = auth.uid(), reviewed_at = now(), updated_at = now()
   WHERE id = a.id;
  UPDATE public.email_sequence_versions SET state = 'superseded', updated_at = now()
   WHERE id = s.live_version_id AND id <> v.id;
  UPDATE public.email_sequence_versions SET state = 'approved', approved_at = now(), approved_by = auth.uid(), updated_at = now()
   WHERE id = v.id;

  -- A series that is paused or needs attention stays so; its new emails wait with it.
  st_now := CASE WHEN s.status IN ('paused','blocked') THEN s.status ELSE 'active' END;
  cstatus := CASE WHEN st_now = 'active' THEN 'sending' ELSE 'blocked' END;
  creason := CASE st_now WHEN 'paused' THEN 'series_paused' WHEN 'blocked' THEN s.blocked_reason END;
  ckind := CASE s.kind WHEN 'welcome' THEN 'welcome' WHEN 'reengagement' THEN 'reengagement' ELSE 'custom' END;

  SELECT count(*) INTO n FROM public.email_sequence_steps WHERE version_id = v.id;
  FOR st IN SELECT * FROM public.email_sequence_steps WHERE version_id = v.id ORDER BY position LOOP
    SELECT * INTO camp FROM public.email_campaigns WHERE sequence_id = s.id AND sequence_position = st.position FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.email_campaigns (tenant_id, kind, name, status, sequence_id, sequence_position, created_by)
      VALUES (t, ckind, left(s.name, 180) || ' · email ' || st.position, cstatus, s.id, st.position, auth.uid())
      RETURNING * INTO camp;
    END IF;
    ov := camp.current_version_id;
    INSERT INTO public.email_campaign_versions (campaign_id, tenant_id, version_no, state, subject, preheader, body_html,
      sender, sender_snapshot, audience, conversion_goal, content_hash, approval_id, locked_at, approved_at, approved_by, created_by)
    VALUES (camp.id, t, COALESCE((SELECT max(version_no) FROM public.email_campaign_versions WHERE campaign_id = camp.id), 0) + 1,
      'approved', st.subject, st.preheader, st.body_html, v.sender, snd, v.audience, v.exit_on_goal, v.content_hash, a.id,
      now(), now(), auth.uid(), auth.uid())
    RETURNING id INTO nv;
    UPDATE public.email_campaigns SET current_version_id = nv, name = left(s.name, 180) || ' · email ' || st.position,
      status = cstatus, blocked_reason = creason, updated_at = now() WHERE id = camp.id;
    IF ov IS NOT NULL THEN
      UPDATE public.email_campaign_recipients SET status = 'cancelled', updated_at = now() WHERE version_id = ov AND status = 'planned';
      UPDATE public.email_campaign_versions SET updated_at = now(), state = CASE
          WHEN EXISTS (SELECT 1 FROM public.email_campaign_recipients r WHERE r.version_id = ov AND r.status = 'sent') THEN 'sent'
          ELSE 'superseded' END
       WHERE id = ov AND state = 'approved';
    END IF;
  END LOOP;
  -- Emails a shorter version no longer has: nothing more goes out under them.
  FOR camp IN SELECT * FROM public.email_campaigns WHERE sequence_id = s.id AND sequence_position > n FOR UPDATE LOOP
    UPDATE public.email_campaign_recipients SET status = 'cancelled', updated_at = now()
     WHERE version_id = camp.current_version_id AND status = 'planned';
    UPDATE public.email_campaign_versions SET updated_at = now(), state = CASE
        WHEN EXISTS (SELECT 1 FROM public.email_campaign_recipients r WHERE r.version_id = camp.current_version_id AND r.status = 'sent')
        THEN 'sent' ELSE 'superseded' END
     WHERE id = camp.current_version_id AND state = 'approved';
    UPDATE public.email_campaigns SET updated_at = now(), blocked_reason = NULL, status = CASE
        WHEN EXISTS (SELECT 1 FROM public.email_campaign_recipients r WHERE r.campaign_id = camp.id AND r.status = 'sent')
        THEN 'completed' ELSE 'cancelled' END
     WHERE id = camp.id AND status NOT IN ('completed','cancelled');
  END LOOP;

  UPDATE public.email_sequences SET live_version_id = v.id, status = st_now, activated_at = COALESCE(activated_at, now()),
    checked_at = NULL, updated_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('sequence_id', s.id, 'version_id', v.id, 'status', st_now, 'emails', n);
END $$;

-- A series approval becomes 'approved' only through email_sequence_approve; any other writer is refused.
CREATE OR REPLACE FUNCTION public._email_sequence_approval_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.type = 'campaign_send' AND NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.metadata ? 'email_sequence_version_id'
     AND COALESCE(current_setting('paige.email_sequence_approve', true), '') IS DISTINCT FROM NEW.metadata->>'email_sequence_version_id' THEN
    RAISE EXCEPTION 'series_approval_requires_review' USING ERRCODE = '42501',
      HINT = 'Approve an email series through email_sequence_approve.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._email_sequence_approval_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_email_sequence_approval_guard ON public.paige_pending_approvals;
CREATE TRIGGER trg_email_sequence_approval_guard BEFORE UPDATE OF status ON public.paige_pending_approvals
  FOR EACH ROW EXECUTE FUNCTION public._email_sequence_approval_guard();

-- A series approval declined anywhere returns the series to an editable draft (a copy of what was filed).
-- A running series keeps its approved version.
CREATE OR REPLACE FUNCTION public._email_sequence_approval_withdrawn()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.email_sequence_versions%ROWTYPE; s public.email_sequences%ROWTYPE; nv uuid;
BEGIN
  IF NEW.type <> 'campaign_send' OR OLD.status <> 'pending' OR NEW.status NOT IN ('rejected','skipped','changes_requested')
     OR NOT (NEW.metadata ? 'email_sequence_version_id') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v FROM public.email_sequence_versions
   WHERE id = NULLIF(NEW.metadata->>'email_sequence_version_id', '')::uuid AND approval_id = NEW.id AND state = 'locked' FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.email_sequences WHERE id = v.sequence_id FOR UPDATE;
  IF s.current_version_id IS DISTINCT FROM v.id THEN RETURN NEW; END IF;
  UPDATE public.email_sequence_versions SET state = 'superseded', updated_at = now() WHERE id = v.id;
  nv := public._email_sequence_copy(v.id, NEW.reviewed_by_user_id);
  UPDATE public.email_sequences SET current_version_id = nv,
    status = CASE WHEN s.live_version_id IS NULL THEN 'draft' ELSE s.status END, updated_at = now()
   WHERE id = s.id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._email_sequence_approval_withdrawn() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_email_sequence_approval_withdrawn ON public.paige_pending_approvals;
CREATE TRIGGER trg_email_sequence_approval_withdrawn AFTER UPDATE OF status ON public.paige_pending_approvals
  FOR EACH ROW EXECUTE FUNCTION public._email_sequence_approval_withdrawn();

-- Decline the version awaiting approval: it comes back as an editable draft and nothing changes in what sends.
CREATE OR REPLACE FUNCTION public.email_sequence_decline(p_version_id uuid, p_reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); v public.email_sequence_versions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.email_sequence_versions WHERE id = p_version_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND OR v.state <> 'locked' THEN RAISE EXCEPTION 'not_awaiting_approval' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.paige_pending_approvals SET status = 'rejected', reviewed_by_user_id = auth.uid(), reviewed_at = now(),
    decision_rationale = left(p_reason, 500), updated_at = now() WHERE id = v.approval_id AND status = 'pending';
  RETURN true;
END $$;

-- ── Callable seam: running a series ────────────────────────────────────────────────────────────────

-- Pause: nothing sends; scheduled emails wait where they are.
CREATE OR REPLACE FUNCTION public.email_sequence_pause(p_sequence_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); s public.email_sequences%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.status NOT IN ('active','blocked') THEN RAISE EXCEPTION 'not_running' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('paige.email_sequence_write', 'on', true);
  UPDATE public.email_campaigns SET status = 'blocked', blocked_reason = 'series_paused', updated_at = now()
   WHERE sequence_id = s.id AND status IN ('scheduled','sending','blocked');
  UPDATE public.email_sequences SET status = 'paused', blocked_reason = NULL, updated_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('sequence_id', s.id, 'status', 'paused');
END $$;

-- Resume a paused series, or one that needed attention once the cause is fixed. The approved sender must
-- still be the one that resolves; a different sender needs a change to the series.
CREATE OR REPLACE FUNCTION public.email_sequence_resume(p_sequence_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); s public.email_sequences%ROWTYPE; v public.email_sequence_versions%ROWTYPE; snd jsonb; n int;
BEGIN
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.status NOT IN ('paused','blocked') THEN RAISE EXCEPTION 'not_paused' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v FROM public.email_sequence_versions WHERE id = s.live_version_id;
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
  SELECT count(*) INTO n FROM public.email_sequence_steps WHERE version_id = v.id;
  PERFORM set_config('paige.email_sequence_write', 'on', true);
  UPDATE public.email_campaigns SET status = 'sending', blocked_reason = NULL, updated_at = now()
   WHERE sequence_id = s.id AND status = 'blocked' AND sequence_position <= n;
  UPDATE public.email_sequences SET status = 'active', blocked_reason = NULL, updated_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('sequence_id', s.id, 'status', 'active');
END $$;

-- Stop for good: everyone in it leaves, emails not yet handed to the provider are cancelled, and what was
-- sent stays recorded. A stopped series cannot be restarted; make a new one.
CREATE OR REPLACE FUNCTION public.email_sequence_stop(p_sequence_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); s public.email_sequences%ROWTYPE; camp public.email_campaigns%ROWTYPE; n int; c int := 0;
BEGIN
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  IF s.live_version_id IS NULL THEN RAISE EXCEPTION 'not_running' USING ERRCODE = 'P0001'; END IF;
  IF s.status = 'stopped' THEN RAISE EXCEPTION 'series_stopped' USING ERRCODE = 'P0001'; END IF;
  PERFORM set_config('paige.email_sequence_write', 'on', true);
  -- A change awaiting approval is withdrawn without becoming a new draft.
  UPDATE public.email_sequence_versions SET state = 'superseded', updated_at = now() WHERE sequence_id = s.id AND state = 'locked';
  UPDATE public.paige_pending_approvals SET status = 'skipped', decision_rationale = 'The series was stopped.', updated_at = now()
   WHERE id IN (SELECT approval_id FROM public.email_sequence_versions WHERE sequence_id = s.id) AND status = 'pending';
  UPDATE public.email_sequence_enrollments SET status = 'exited', exit_reason = 'series_stopped', finished_at = now(), updated_at = now()
   WHERE sequence_id = s.id AND status = 'active';
  GET DIAGNOSTICS n = ROW_COUNT;
  FOR camp IN SELECT * FROM public.email_campaigns WHERE sequence_id = s.id FOR UPDATE LOOP
    UPDATE public.email_campaign_recipients SET status = 'cancelled', updated_at = now() WHERE campaign_id = camp.id AND status = 'planned';
    GET DIAGNOSTICS c = ROW_COUNT;
    UPDATE public.email_campaign_versions SET updated_at = now(), state = CASE
        WHEN EXISTS (SELECT 1 FROM public.email_campaign_recipients r WHERE r.version_id = camp.current_version_id AND r.status = 'sent')
        THEN 'sent' ELSE 'superseded' END
     WHERE id = camp.current_version_id AND state = 'approved';
    UPDATE public.email_campaigns SET updated_at = now(), blocked_reason = NULL, status = CASE
        WHEN EXISTS (SELECT 1 FROM public.email_campaign_recipients r WHERE r.campaign_id = camp.id AND r.status = 'sent')
        THEN 'completed' ELSE 'cancelled' END
     WHERE id = camp.id AND status NOT IN ('completed','cancelled');
  END LOOP;
  UPDATE public.email_sequences SET status = 'stopped', stopped_at = now(), blocked_reason = NULL,
    current_version_id = live_version_id, updated_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('sequence_id', s.id, 'status', 'stopped', 'people_left', n);
END $$;

-- Take one person out of a series; anything scheduled for them is cancelled.
CREATE OR REPLACE FUNCTION public.email_sequence_remove_contact(p_sequence_id uuid, p_client_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant(); e public.email_sequence_enrollments%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.email_sequence_enrollments
   WHERE sequence_id = p_sequence_id AND client_id = p_client_id AND tenant_id = t FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_in_series' USING ERRCODE = 'P0002'; END IF;
  IF e.status <> 'active' THEN RETURN false; END IF;
  UPDATE public.email_campaign_recipients SET status = 'cancelled', updated_at = now() WHERE enrollment_id = e.id AND status = 'planned';
  UPDATE public.email_sequence_enrollments SET status = 'exited', exit_reason = 'removed', finished_at = now(), updated_at = now()
   WHERE id = e.id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.email_sequence_create(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_create(text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_update_draft(uuid,text,text,jsonb,uuid,boolean,text,boolean,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_update_draft(uuid,text,text,jsonb,uuid,boolean,text,boolean,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_step_save(uuid,integer,integer,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_step_save(uuid,integer,integer,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_step_delete(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_step_delete(uuid,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_step_move(uuid,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_step_move(uuid,integer,integer) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_edit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_edit(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_discard_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_discard_draft(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_delete(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_request_approval(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_request_approval(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_approve(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_approve(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_decline(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_decline(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_pause(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_pause(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_resume(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_resume(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_stop(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_stop(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.email_sequence_remove_contact(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_sequence_remove_contact(uuid,uuid) TO authenticated;

-- ── Reads ──────────────────────────────────────────────────────────────────────────────────────────

-- The business's series for the dashboard's Automations panel, newest first.
CREATE OR REPLACE FUNCTION public.read_email_sequences()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t uuid := public._email_caller_tenant();
BEGIN
  RETURN jsonb_build_object('sequences', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'kind', s.kind, 'status', s.status, 'blocked_reason', s.blocked_reason,
      'emails', (SELECT count(*) FROM public.email_sequence_steps st WHERE st.version_id = COALESCE(s.live_version_id, s.current_version_id)),
      'entry_mode', (SELECT v.entry_mode FROM public.email_sequence_versions v WHERE v.id = COALESCE(s.live_version_id, s.current_version_id)),
      'change_state', CASE WHEN s.live_version_id IS NOT NULL AND s.current_version_id IS DISTINCT FROM s.live_version_id
                           THEN (SELECT v.state FROM public.email_sequence_versions v WHERE v.id = s.current_version_id) END,
      'in_now', (SELECT count(*) FROM public.email_sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'active'),
      'entered', (SELECT count(*) FROM public.email_sequence_enrollments e WHERE e.sequence_id = s.id),
      'sent_30d', (SELECT count(*) FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id = r.campaign_id
                    WHERE c.sequence_id = s.id AND r.sent_at > now() - interval '30 days'),
      'next_send_at', (SELECT min(COALESCE(r.not_before, now())) FROM public.email_campaign_recipients r
                         JOIN public.email_campaigns c ON c.id = r.campaign_id
                        WHERE c.sequence_id = s.id AND r.status = 'planned'),
      'activated_at', s.activated_at, 'updated_at', s.updated_at) ORDER BY s.updated_at DESC)
    FROM public.email_sequences s WHERE s.tenant_id = t), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.read_email_sequences() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_email_sequences() TO authenticated;

-- One series as the series view shows it: the version being edited (or awaiting approval) with its emails,
-- the running version when a change is being made, who would enter today, how each email is doing, and
-- where people are. The footer facts are the ones the dispatcher sends with.
CREATE OR REPLACE FUNCTION public.read_email_sequence(p_sequence_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_caller_tenant();
  s public.email_sequences%ROWTYPE; v public.email_sequence_versions%ROWTYPE; rule jsonb; used int;
BEGIN
  SELECT * INTO s FROM public.email_sequences WHERE id = p_sequence_id AND tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'series_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v FROM public.email_sequence_versions WHERE id = s.current_version_id;
  rule := COALESCE((SELECT sg.rule FROM public.email_segments sg WHERE sg.id = v.segment_id AND sg.tenant_id = t), v.audience);
  used := public._email_used_today(t);
  RETURN jsonb_build_object(
    'sequence', jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'status', s.status,
      'blocked_reason', s.blocked_reason, 'activated_at', s.activated_at, 'stopped_at', s.stopped_at,
      'created_at', s.created_at, 'updated_at', s.updated_at, 'live_version_id', s.live_version_id),
    'version', (SELECT jsonb_build_object('id', x.id, 'version_no', x.version_no, 'state', x.state,
        'entry_mode', x.entry_mode, 'audience', x.audience, 'segment_id', x.segment_id,
        'segment_name', (SELECT sg.name FROM public.email_segments sg WHERE sg.id = x.segment_id AND sg.tenant_id = t),
        'exit_on_goal', x.exit_on_goal, 'exit_when_unmatched', x.exit_when_unmatched, 'sender', x.sender,
        'sender_snapshot', x.sender_snapshot, 'expected_entrants', x.expected_entrants, 'approval_id', x.approval_id,
        'locked_at', x.locked_at, 'approved_at', x.approved_at, 'updated_at', x.updated_at,
        'steps', COALESCE((SELECT jsonb_agg(jsonb_build_object('position', st.position, 'delay_minutes', st.delay_minutes,
            'subject', st.subject, 'preheader', st.preheader, 'body_html', st.body_html) ORDER BY st.position)
          FROM public.email_sequence_steps st WHERE st.version_id = x.id), '[]'::jsonb))
      FROM public.email_sequence_versions x WHERE x.id = s.current_version_id),
    'live', CASE WHEN s.live_version_id IS NOT NULL AND s.live_version_id IS DISTINCT FROM s.current_version_id THEN
      (SELECT jsonb_build_object('id', x.id, 'version_no', x.version_no, 'entry_mode', x.entry_mode, 'audience', x.audience,
          'exit_on_goal', x.exit_on_goal, 'exit_when_unmatched', x.exit_when_unmatched, 'approved_at', x.approved_at,
          'steps', COALESCE((SELECT jsonb_agg(jsonb_build_object('position', st.position, 'delay_minutes', st.delay_minutes,
              'subject', st.subject) ORDER BY st.position)
            FROM public.email_sequence_steps st WHERE st.version_id = x.id), '[]'::jsonb))
        FROM public.email_sequence_versions x WHERE x.id = s.live_version_id) END,
    'approval', (SELECT jsonb_build_object('status', a.status, 'source', a.source, 'reviewed_at', a.reviewed_at)
                   FROM public.paige_pending_approvals a WHERE a.id = v.approval_id),
    'last_declined', (SELECT jsonb_build_object('reason', a.decision_rationale, 'at', a.reviewed_at, 'version_no', pv.version_no)
                        FROM public.email_sequence_versions pv JOIN public.paige_pending_approvals a ON a.id = pv.approval_id
                       WHERE pv.sequence_id = s.id AND pv.id <> v.id AND a.status = 'rejected'
                       ORDER BY pv.version_no DESC LIMIT 1),
    -- Who the rule reaches today (people already in or through the series excluded from 'new').
    'entry_preview', (SELECT jsonb_build_object(
        'matched', count(*), 'eligible', count(*) FILTER (WHERE a.ineligible IS NULL),
        'eligible_new', count(*) FILTER (WHERE a.ineligible IS NULL AND NOT EXISTS (SELECT 1 FROM public.email_sequence_enrollments e
                          WHERE e.sequence_id = s.id AND e.client_id = a.client_id)),
        'no_address', count(*) FILTER (WHERE a.ineligible = 'no_address'),
        'opted_out', count(*) FILTER (WHERE a.ineligible = 'opted_out'),
        'suppressed', count(*) FILTER (WHERE a.ineligible = 'suppressed'))
      FROM public._email_audience(t, rule, false) a),
    -- How each email of the running version is doing (every send of that position, across versions).
    'emails', COALESCE((SELECT jsonb_agg(jsonb_build_object('position', c.sequence_position,
        'sent', count(r.*) FILTER (WHERE r.status = 'sent'),
        'tracked', count(r.*) FILTER (WHERE r.status = 'sent' AND r.route = 'managed'),
        'opened', count(r.*) FILTER (WHERE r.route = 'managed' AND r.opened_at IS NOT NULL),
        'clicked', count(r.*) FILTER (WHERE r.route = 'managed' AND r.clicked_at IS NOT NULL),
        'waiting', count(r.*) FILTER (WHERE r.status IN ('planned','sending')),
        'next_at', min(COALESCE(r.not_before, now())) FILTER (WHERE r.status = 'planned'),
        'not_delivered', count(r.*) FILTER (WHERE r.status IN ('failed','outcome_unknown')),
        'skipped', count(r.*) FILTER (WHERE r.status = 'skipped')) ORDER BY c.sequence_position)
      FROM public.email_campaigns c LEFT JOIN public.email_campaign_recipients r ON r.campaign_id = c.id
     WHERE c.sequence_id = s.id GROUP BY c.sequence_position), '[]'::jsonb),
    'people', jsonb_build_object(
      'in_now', (SELECT count(*) FROM public.email_sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'active'),
      'completed', (SELECT count(*) FROM public.email_sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'completed'),
      'left', (SELECT count(*) FROM public.email_sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'exited'),
      'by_email', COALESCE((SELECT jsonb_object_agg(position, n) FROM (SELECT e.position, count(*) AS n
          FROM public.email_sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'active' GROUP BY 1) q), '{}'::jsonb),
      'left_because', COALESCE((SELECT jsonb_object_agg(exit_reason, n) FROM (SELECT e.exit_reason, count(*) AS n
          FROM public.email_sequence_enrollments e WHERE e.sequence_id = s.id AND e.status = 'exited' GROUP BY 1) q), '{}'::jsonb),
      'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object('client_id', e.client_id,
          'name', NULLIF(btrim(concat_ws(' ', cl.first_name, cl.last_name)), ''), 'email', e.email, 'status', e.status,
          'exit_reason', e.exit_reason, 'position', e.position, 'entered_at', e.entered_at, 'last_sent_at', e.last_sent_at,
          'finished_at', e.finished_at) ORDER BY e.updated_at DESC)
        FROM (SELECT * FROM public.email_sequence_enrollments WHERE sequence_id = s.id ORDER BY updated_at DESC LIMIT 25) e
        LEFT JOIN public.clients cl ON cl.id = e.client_id), '[]'::jsonb)),
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
    'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', sg.id, 'name', sg.name, 'rule', sg.rule) ORDER BY sg.name)
                   FROM public.email_segments sg WHERE sg.tenant_id = t), '[]'::jsonb),
    'choices', public._email_rule_choices(t),
    'sending', jsonb_build_object('daily_cap', public.email_campaign_daily_cap(), 'used_last_24h', used,
                                  'remaining_today', GREATEST(public.email_campaign_daily_cap() - used, 0)));
END $$;
REVOKE ALL ON FUNCTION public.read_email_sequence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.read_email_sequence(uuid) TO authenticated;

-- ── The tick (service only: email-campaign-worker, each minute) ─────────────────────────────────────

-- For each running series: every five minutes, enroll people who now match and apply the goal and
-- "stopped matching" exits; every tick, move each person on — plan their next email (a planned recipient
-- on that email's series-owned campaign, held by not_before until its wait is over), complete them after
-- the last one, or end their series when an email to them was skipped, failed or went unconfirmed.
-- A series whose own campaign the dispatcher blocked (sender, postal address, business) needs attention
-- as a whole: every email of it waits until the owner resumes it.
CREATE OR REPLACE FUNCTION public.email_sequence_tick(p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  lim int := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 1000);
  s public.email_sequences%ROWTYPE; v public.email_sequence_versions%ROWTYPE;
  e public.email_sequence_enrollments%ROWTYPE; st public.email_sequence_steps%ROWTYPE; camp public.email_campaigns%ROWTYPE;
  l_status text; l_skip text; l_sent timestamptz; l_pos int; nsteps int; nxt int; base timestamptz; due timestamptz; rid uuid; br text; k int;
  enrolled int := 0; planned int := 0; done int := 0; left_n int := 0; blocked int := 0; looked int := 0;
BEGIN
  FOR s IN SELECT * FROM public.email_sequences WHERE status = 'active' ORDER BY updated_at FOR UPDATE SKIP LOCKED LOOP
    looked := looked + 1;
    SELECT * INTO v FROM public.email_sequence_versions WHERE id = s.live_version_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT c.blocked_reason INTO br FROM public.email_campaigns c
     WHERE c.sequence_id = s.id AND c.status = 'blocked' AND c.blocked_reason IS DISTINCT FROM 'series_paused' LIMIT 1;
    IF FOUND THEN
      UPDATE public.email_campaigns SET status = 'blocked', blocked_reason = br, updated_at = now()
       WHERE sequence_id = s.id AND status IN ('scheduled','sending');
      UPDATE public.email_sequences SET status = 'blocked', blocked_reason = br, updated_at = now() WHERE id = s.id;
      blocked := blocked + 1;
      CONTINUE;
    END IF;

    SELECT count(*) INTO nsteps FROM public.email_sequence_steps WHERE version_id = v.id;

    IF s.checked_at IS NULL OR s.checked_at < now() - interval '5 minutes' THEN
      CREATE TEMP TABLE IF NOT EXISTS _email_seq_audience (client_id uuid, email text, ineligible text) ON COMMIT DROP;
      TRUNCATE _email_seq_audience;
      INSERT INTO _email_seq_audience SELECT * FROM public._email_audience(s.tenant_id, v.audience, false);

      INSERT INTO public.email_sequence_enrollments (sequence_id, tenant_id, client_id, email, entered_at)
      SELECT s.id, s.tenant_id, a.client_id, a.email, now()
        FROM _email_seq_audience a JOIN public.clients cl ON cl.id = a.client_id
       WHERE a.ineligible IS NULL
         AND (v.entry_mode = 'matching' OR cl.created_at >= s.activated_at)
         AND NOT EXISTS (SELECT 1 FROM public.email_sequence_enrollments x WHERE x.sequence_id = s.id AND x.client_id = a.client_id)
       ORDER BY cl.created_at, cl.id
       LIMIT lim
      ON CONFLICT (sequence_id, client_id) DO NOTHING;
      GET DIAGNOSTICS k = ROW_COUNT; enrolled := enrolled + k;

      IF v.exit_when_unmatched THEN
        WITH gone AS (
          UPDATE public.email_sequence_enrollments en SET status = 'exited', exit_reason = 'stopped_matching',
            finished_at = now(), updated_at = now()
           WHERE en.sequence_id = s.id AND en.status = 'active'
             AND NOT EXISTS (SELECT 1 FROM _email_seq_audience a WHERE a.client_id = en.client_id)
          RETURNING en.id)
        UPDATE public.email_campaign_recipients r SET status = 'cancelled', updated_at = now()
          FROM gone WHERE r.enrollment_id = gone.id AND r.status = 'planned';
        GET DIAGNOSTICS k = ROW_COUNT;
      END IF;
      IF v.exit_on_goal <> 'none' THEN
        WITH gone AS (
          UPDATE public.email_sequence_enrollments en SET status = 'exited', exit_reason = 'reached_goal',
            finished_at = now(), updated_at = now()
           WHERE en.sequence_id = s.id AND en.status = 'active'
             AND public._email_goal_reached(s.tenant_id, en.client_id, v.exit_on_goal, en.entered_at)
          RETURNING en.id)
        UPDATE public.email_campaign_recipients r SET status = 'cancelled', updated_at = now()
          FROM gone WHERE r.enrollment_id = gone.id AND r.status = 'planned';
      END IF;
      UPDATE public.email_sequences SET checked_at = now() WHERE id = s.id;
    END IF;

    FOR e IN SELECT en.* FROM public.email_sequence_enrollments en
              WHERE en.sequence_id = s.id AND en.status = 'active'
                AND NOT EXISTS (SELECT 1 FROM public.email_campaign_recipients r
                                 WHERE r.enrollment_id = en.id AND r.status IN ('planned','sending'))
              ORDER BY en.updated_at, en.id LIMIT lim FOR UPDATE OF en SKIP LOCKED LOOP
      l_status := NULL; l_skip := NULL; l_sent := NULL; l_pos := NULL;
      SELECT r.status, r.skip_reason, r.sent_at, c.sequence_position INTO l_status, l_skip, l_sent, l_pos
        FROM public.email_campaign_recipients r JOIN public.email_campaigns c ON c.id = r.campaign_id
       WHERE r.enrollment_id = e.id ORDER BY r.created_at DESC, r.id DESC LIMIT 1;
      IF l_status IN ('skipped','failed','outcome_unknown') THEN
        UPDATE public.email_sequence_enrollments SET status = 'exited', finished_at = now(), updated_at = now(),
          exit_reason = CASE l_status WHEN 'skipped' THEN COALESCE(l_skip, 'sender_refused')
                                         WHEN 'failed' THEN 'send_failed' ELSE 'not_confirmed' END
         WHERE id = e.id;
        left_n := left_n + 1;
        CONTINUE;
      END IF;
      IF l_status IS NULL THEN
        nxt := 1; base := e.entered_at;
      ELSIF l_status = 'sent' THEN
        nxt := l_pos + 1; base := l_sent;
        UPDATE public.email_sequence_enrollments SET last_sent_at = l_sent WHERE id = e.id AND last_sent_at IS DISTINCT FROM l_sent;
      ELSE
        -- Withdrawn before it went (the series changed): the same email again, on the new content.
        nxt := l_pos; base := COALESCE(e.last_sent_at, e.entered_at);
      END IF;
      IF nxt > nsteps THEN
        UPDATE public.email_sequence_enrollments SET status = 'completed', finished_at = now(), updated_at = now() WHERE id = e.id;
        done := done + 1;
        CONTINUE;
      END IF;
      SELECT * INTO st FROM public.email_sequence_steps WHERE version_id = v.id AND position = nxt;
      SELECT * INTO camp FROM public.email_campaigns WHERE sequence_id = s.id AND sequence_position = nxt;
      IF NOT FOUND OR camp.status NOT IN ('scheduled','sending') THEN CONTINUE; END IF;
      due := base + make_interval(mins => st.delay_minutes);
      rid := NULL;
      INSERT INTO public.email_campaign_recipients (campaign_id, version_id, tenant_id, client_id, email, status, not_before, enrollment_id)
      VALUES (camp.id, camp.current_version_id, s.tenant_id, e.client_id, e.email, 'planned', CASE WHEN due > now() THEN due END, e.id)
      ON CONFLICT (version_id, email) DO NOTHING
      RETURNING id INTO rid;
      IF rid IS NULL THEN
        -- This address already has this email (another contact shares it): never send it twice.
        UPDATE public.email_sequence_enrollments SET status = 'exited', exit_reason = 'already_sent', finished_at = now(), updated_at = now()
         WHERE id = e.id;
        left_n := left_n + 1;
        CONTINUE;
      END IF;
      UPDATE public.email_sequence_enrollments SET position = nxt, updated_at = now() WHERE id = e.id;
      planned := planned + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('series', looked, 'enrolled', enrolled, 'planned', planned, 'completed', done,
    'left', left_n, 'blocked', blocked);
END $$;
REVOKE ALL ON FUNCTION public.email_sequence_tick(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_sequence_tick(integer) TO service_role;

-- ── Existing functions, changed for series ─────────────────────────────────────────────────────────
-- A running series' own campaign is never settled while the series runs.
CREATE OR REPLACE FUNCTION public.email_campaign_dispatch_settle(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c public.email_campaigns%ROWTYPE; s jsonb; st text;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- A series' own campaign stays open while its series runs: new people keep arriving. Stopping the
  -- series settles it (email_sequence_stop).
  IF c.sequence_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.email_sequences q WHERE q.id = c.sequence_id
       AND q.status IN ('draft','pending_approval','active','paused','blocked')) THEN
    RETURN jsonb_build_object('status', c.status, 'settled', false, 'series', true);
  END IF;
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
-- Long-running series envelopes are heartbeat only when their lease runs low.
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
      -- A running series' envelopes stay open for as long as the series runs; one with most of its lease
      -- left needs nothing this tick, so they cannot crowd newer campaigns off the list.
      AND NOT (c.sequence_id IS NOT NULL AND w.status = 'claimed' AND w.lease_until > now() + interval '20 minutes'
               AND c.status IN ('scheduled','sending') AND c.current_version_id = d.version_id)
    ORDER BY d.created_at LIMIT LEAST(GREATEST(p_limit, 1), 100)) x
$$;
-- A series draft (or one awaiting approval) that uses a segment keeps it from being deleted.
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
  IF EXISTS (SELECT 1 FROM public.email_sequence_versions v WHERE v.segment_id = p_id AND v.tenant_id = t
              AND v.state IN ('draft','locked')) THEN
    RAISE EXCEPTION 'segment_in_use' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.email_segments WHERE id = p_id AND tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'segment_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN true;
END $$;
-- Campaign lists leave out series' own campaigns (their sends still count in the totals).
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
    'campaign_count', (SELECT count(*) FROM public.email_campaigns c WHERE c.tenant_id = t AND c.sequence_id IS NULL),
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
        WHERE c.tenant_id = t AND c.sequence_id IS NULL
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
            WHERE c.tenant_id = t AND c.sequence_id IS NULL
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
CREATE OR REPLACE FUNCTION public.read_email_campaign(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_caller_tenant();
  c public.email_campaigns%ROWTYPE;
  v public.email_campaign_versions%ROWTYPE;
  out jsonb;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t AND sequence_id IS NULL;
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
CREATE OR REPLACE FUNCTION public.read_email_campaigns(p_expected_tenant_id uuid, p_campaign_id uuid DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_paige_tenant(p_expected_tenant_id);
  c public.email_campaigns%ROWTYPE; v public.email_campaign_versions%ROWTYPE;
BEGIN
  IF p_campaign_id IS NULL THEN
    RETURN jsonb_build_object('campaigns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'kind', x.kind, 'status', x.status,
               'version_no', xv.version_no, 'version_state', xv.state, 'subject', xv.subject,
               'scheduled_for', xv.scheduled_for, 'updated_at', x.updated_at) ORDER BY x.updated_at DESC)
        FROM (SELECT * FROM public.email_campaigns WHERE tenant_id = t AND sequence_id IS NULL ORDER BY updated_at DESC
               LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50)) x
        LEFT JOIN public.email_campaign_versions xv ON xv.id = x.current_version_id), '[]'::jsonb));
  END IF;
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t AND sequence_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = c.current_version_id;
  RETURN jsonb_build_object(
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'status', c.status,
      'blocked_reason', c.blocked_reason, 'updated_at', c.updated_at),
    'version', jsonb_build_object('id', v.id, 'version_no', v.version_no, 'state', v.state, 'subject', v.subject,
      'preheader', v.preheader, 'body_html', v.body_html, 'audience', v.audience, 'segment_id', v.segment_id,
      'segment_name', (SELECT s.name FROM public.email_segments s WHERE s.id = v.segment_id AND s.tenant_id = t),
      'scheduled_for', v.scheduled_for, 'conversion_goal', v.conversion_goal,
      'expected_recipients', v.expected_recipients, 'cost_bound_usd', v.cost_bound_usd),
    'from', public._email_resolve_sender(t, v.sender)->>'from_address',
    'approval_status', (SELECT a.status FROM public.paige_pending_approvals a WHERE a.id = v.approval_id),
    'last_declined_reason', (SELECT a.decision_rationale FROM public.email_campaign_versions pv
                               JOIN public.paige_pending_approvals a ON a.id = pv.approval_id
                              WHERE pv.campaign_id = c.id AND pv.id <> v.id AND a.status = 'rejected'
                              ORDER BY pv.version_no DESC LIMIT 1),
    'segments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                            FROM public.email_segments s WHERE s.tenant_id = t), '[]'::jsonb),
    'choices', public._email_rule_choices(t));
END $$;
CREATE OR REPLACE FUNCTION public.read_email_campaign_audience(p_expected_tenant_id uuid, p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t uuid := public._email_paige_tenant(p_expected_tenant_id);
  c public.email_campaigns%ROWTYPE; v public.email_campaign_versions%ROWTYPE; seg text;
BEGIN
  SELECT * INTO c FROM public.email_campaigns WHERE id = p_campaign_id AND tenant_id = t AND sequence_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v FROM public.email_campaign_versions WHERE id = c.current_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT name INTO seg FROM public.email_segments WHERE id = v.segment_id AND tenant_id = t;
  RETURN public.email_audience_preview(v.audience, c.kind, v.segment_id) || jsonb_build_object(
    'campaign_id', c.id, 'version_id', v.id, 'version_no', v.version_no, 'state', v.state, 'kind', c.kind,
    'rule', v.audience, 'segment_name', seg,
    'newsletter_subscribers_only', c.kind = 'newsletter',
    'frozen_recipients', CASE WHEN v.state IN ('locked', 'approved') THEN v.expected_recipients END);
END $$;

RESET lock_timeout;
