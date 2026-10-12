-- Experience 03 (Grow My Business) S1 — a lead carries the campaign it came from.
-- Journey record: docs/delivery/exp03-grow-my-business-journey.md §9 (Linear ANT-51 / ANT-147).
--
-- Before: a form submission (the lead record) kept its link's tags in utm_json and nothing else, so "which
-- campaign did this lead come from?" was only ever rebuilt at read time by a text match, and the campaign a
-- form is attached to (campaign_brief_asset_links) never reached the lead at all.
--
-- After: every NEW submission is stamped once, at insert, with the campaign it belongs to and how that was
-- decided. The decision uses the two definitions the platform already ships (it is evaluated at insert; the
-- form.submitted payload reads the links again when the contact is pinned, so a link changed in between can
-- differ, and Analytics' per-campaign figure counts by tag alone, including leads saved before this):
--   L = the workspace's non-archived campaigns this form is attached to (the form.submitted payload's
--       campaign_brief_ids, 20271022100000);
--   T = the workspace's campaigns whose reference equals the link's utm_campaign, normalized exactly as
--       marketing.leads.by_campaign_tag does (lower(_marketing_metric_text(x,120)), string tags only),
--       archived campaigns included as the metric includes them; a tag naming several campaigns names none.
--   exactly one campaign in L∩T            -> form_and_tag
--   else exactly one in L and none in T     -> form_link
--   else none in L and exactly one in T     -> campaign_tag
--   else nothing in L or T                  -> none
--   else                                    -> ambiguous   (no campaign is chosen; never guessed)
--
-- Covers both writers (growth-public-submit, growth-inbound) with no change to either. The stamp is
-- immutable: only deleting the campaign may clear campaign_brief_id (ON DELETE SET NULL). Rows saved
-- before this migration keep campaign_attribution NULL, which means "not evaluated", never "none".
-- No deal, contact, pipeline or Sales table changes. Nothing is sent, published or spent.

ALTER TABLE public.growth_form_submissions
  ADD COLUMN IF NOT EXISTS campaign_brief_id uuid REFERENCES public.campaign_briefs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_attribution text;

DO $$ BEGIN
  ALTER TABLE public.growth_form_submissions ADD CONSTRAINT growth_form_submissions_campaign_attribution_chk
    CHECK (campaign_attribution IS NULL OR campaign_attribution IN ('form_and_tag','form_link','campaign_tag','ambiguous','none'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A campaign named is always one the stamp chose; 'ambiguous' and 'none' never name one.
DO $$ BEGIN
  ALTER TABLE public.growth_form_submissions ADD CONSTRAINT growth_form_submissions_campaign_named_chk
    CHECK (campaign_brief_id IS NULL OR campaign_attribution IN ('form_and_tag','form_link','campaign_tag'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.growth_form_submissions.campaign_brief_id IS
  'The campaign this lead was attributed to at capture (Experience 03 S1). Set once by trg_growth_submission_stamp_campaign; NULL when none/ambiguous, before 20271025100000, or the campaign was deleted.';
COMMENT ON COLUMN public.growth_form_submissions.campaign_attribution IS
  'How the campaign was decided at capture: form_and_tag | form_link | campaign_tag | ambiguous | none. NULL = saved before attribution existed (not evaluated).';

CREATE INDEX IF NOT EXISTS growth_form_submissions_campaign
  ON public.growth_form_submissions (tenant_id, campaign_brief_id, created_at DESC) WHERE campaign_brief_id IS NOT NULL;
-- Led by the foreign key, so deleting a campaign (or retiring an account) finds its leads without a scan.
CREATE INDEX IF NOT EXISTS growth_form_submissions_campaign_fk
  ON public.growth_form_submissions (campaign_brief_id) WHERE campaign_brief_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.growth_submission_stamp_campaign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _tag text;
  _linked uuid[];
  _tagged uuid[] := '{}';
  _both uuid[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- The stamp records what was true at capture. Only a deleted campaign (ON DELETE SET NULL) may clear it:
    -- a NULL is accepted only once the campaign it named no longer exists, so no member's UPDATE (the table's
    -- tenant update policy does not check role) can quietly drop a lead out of its campaign.
    IF NEW.campaign_attribution IS DISTINCT FROM OLD.campaign_attribution
       OR (NEW.campaign_brief_id IS DISTINCT FROM OLD.campaign_brief_id
           AND (NEW.campaign_brief_id IS NOT NULL
                OR EXISTS (SELECT 1 FROM public.campaign_briefs b WHERE b.id = OLD.campaign_brief_id))) THEN
      RAISE EXCEPTION 'SUBMISSION_ATTRIBUTION_IMMUTABLE' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT: whatever the writer sent is replaced by the decision below.
  IF jsonb_typeof(NEW.utm_json -> 'utm_campaign') = 'string' THEN
    _tag := lower(public._marketing_metric_text(NEW.utm_json ->> 'utm_campaign', 120));
  END IF;

  SELECT coalesce(array_agg(DISTINCT l.brief_id), '{}') INTO _linked
  FROM public.campaign_brief_asset_links l
  JOIN public.campaign_briefs b ON b.id = l.brief_id AND b.tenant_id = NEW.tenant_id AND b.lifecycle_status <> 'archived'
  WHERE l.tenant_id = NEW.tenant_id AND l.asset_kind = 'form' AND l.asset_id = NEW.form_id;

  IF _tag IS NOT NULL THEN
    SELECT coalesce(array_agg(b.id), '{}') INTO _tagged
    FROM public.campaign_briefs b
    WHERE b.tenant_id = NEW.tenant_id AND lower(public._marketing_metric_text(b.short_ref, 120)) = _tag;
    -- A tag that names several campaigns names none, as the metric excludes it (campaign_tag_matches_several_briefs).
    IF cardinality(_tagged) > 1 THEN _tagged := '{}'; END IF;
  END IF;

  _both := ARRAY(SELECT unnest(_linked) INTERSECT SELECT unnest(_tagged));

  IF cardinality(_both) = 1 THEN
    NEW.campaign_brief_id := _both[1];  NEW.campaign_attribution := 'form_and_tag';
  ELSIF cardinality(_linked) = 1 AND cardinality(_tagged) = 0 THEN
    NEW.campaign_brief_id := _linked[1]; NEW.campaign_attribution := 'form_link';
  ELSIF cardinality(_linked) = 0 AND cardinality(_tagged) = 1 THEN
    NEW.campaign_brief_id := _tagged[1]; NEW.campaign_attribution := 'campaign_tag';
  ELSIF cardinality(_linked) = 0 AND cardinality(_tagged) = 0 THEN
    NEW.campaign_brief_id := NULL;       NEW.campaign_attribution := 'none';
  ELSE
    NEW.campaign_brief_id := NULL;       NEW.campaign_attribution := 'ambiguous';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.growth_submission_stamp_campaign() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_growth_submission_stamp_campaign ON public.growth_form_submissions;
CREATE TRIGGER trg_growth_submission_stamp_campaign
  BEFORE INSERT OR UPDATE OF campaign_brief_id, campaign_attribution ON public.growth_form_submissions
  FOR EACH ROW EXECUTE FUNCTION public.growth_submission_stamp_campaign();

-- ── read seam: the leads a campaign brought in ───────────────────────────────────────────────
-- Same caller rule as get_campaign_brief_assets: the caller's own workspace (or the platform owner).
-- A member reads counts, attribution, stages and statuses; names and opportunity titles are withheld on this
-- read, as for campaign assets and steps. That is presentation, not a boundary: the table's existing read
-- policy already lets a member read submissions (narrowing it is an owner call). Counts cover every attributed lead; the list is the newest 200.
CREATE OR REPLACE FUNCTION public.get_campaign_brief_leads(_tenant_id uuid, _brief_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := coalesce(_tenant_id, public.current_user_tenant_id());
  _admin boolean;
  _counts jsonb;
  _leads jsonb;
  _ambiguous bigint;
  _forms jsonb;
BEGIN
  IF _caller IS NULL OR _tenant IS NULL OR NOT (public.is_platform_owner() OR _tenant = public.current_user_tenant_id()) THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _brief_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.campaign_briefs b WHERE b.id = _brief_id AND b.tenant_id = _tenant) THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  _admin := public.is_platform_owner() OR public.is_tenant_admin(_tenant);

  WITH lead AS (
    SELECT s.id, s.created_at, s.campaign_attribution, s.processing_state, s.form_id, s.contact_id,
           d.id deal_id, d.title deal_title, d.status deal_status, p.id pipeline_id, p.name pipeline_name,
           st.label stage_label, st.stage_type
    FROM public.growth_form_submissions s
    LEFT JOIN public.deals d ON d.id = s.deal_id AND d.tenant_id = _tenant
    LEFT JOIN public.pipelines p ON p.id = d.pipeline_id AND p.tenant_id = _tenant
    LEFT JOIN public.pipeline_stages st ON st.id = d.stage_id AND st.tenant_id = _tenant
    WHERE s.tenant_id = _tenant AND s.campaign_brief_id = _brief_id
  ), counted AS (
  SELECT jsonb_build_object(
    'leads', count(*),
    'with_contact', count(*) FILTER (WHERE contact_id IS NOT NULL),
    'with_opportunity', count(*) FILTER (WHERE deal_id IS NOT NULL),
    'open', count(*) FILTER (WHERE deal_status = 'open'),
    'won', count(*) FILTER (WHERE deal_status = 'won'),
    'lost', count(*) FILTER (WHERE deal_status = 'lost'),
    'waiting', count(*) FILTER (WHERE processing_state IN ('pending','claimed')),
    'failed', count(*) FILTER (WHERE processing_state = 'error'),
    'first_at', min(created_at), 'last_at', max(created_at)
  ) c FROM lead
  ), listed AS (
  SELECT coalesce(jsonb_agg(x.j ORDER BY x.created_at DESC, x.id), '[]'::jsonb) l FROM (
    SELECT l.created_at, l.id, jsonb_build_object(
      'submission_id', l.id, 'received_at', l.created_at, 'attribution', l.campaign_attribution,
      'processing_state', l.processing_state, 'form_id', l.form_id, 'form_name', f.name,
      'contact_id', CASE WHEN _admin THEN l.contact_id END,
      'contact_name', CASE WHEN _admin THEN nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '') END,
      'has_contact', l.contact_id IS NOT NULL,
      'deal_id', CASE WHEN _admin THEN l.deal_id END,
      'deal_title', CASE WHEN _admin THEN l.deal_title END,
      'deal_status', l.deal_status, 'pipeline_name', l.pipeline_name,
      'stage_label', l.stage_label, 'stage_type', l.stage_type
    ) j
    FROM lead l
    LEFT JOIN public.growth_forms f ON f.id = l.form_id AND f.tenant_id = _tenant
    LEFT JOIN public.clients c ON c.id = l.contact_id AND c.tenant_id = _tenant
    ORDER BY l.created_at DESC, l.id LIMIT 200
  ) x
  )
  SELECT counted.c, listed.l INTO _counts, _leads FROM counted, listed;

  -- Leads from this campaign's own forms that could not be credited to one campaign, so the owner is told
  -- rather than seeing a quiet undercount.
  SELECT count(*) INTO _ambiguous
  FROM public.growth_form_submissions s
  WHERE s.tenant_id = _tenant AND s.campaign_attribution = 'ambiguous'
    AND s.form_id IN (SELECT l.asset_id FROM public.campaign_brief_asset_links l
                      WHERE l.tenant_id = _tenant AND l.brief_id = _brief_id AND l.asset_kind = 'form');

  SELECT coalesce(jsonb_agg(jsonb_build_object('form_id', f.id, 'name', f.name, 'status', f.status) ORDER BY f.name, f.id), '[]'::jsonb)
    INTO _forms
  FROM public.campaign_brief_asset_links l
  JOIN public.growth_forms f ON f.id = l.asset_id AND f.tenant_id = _tenant
  WHERE l.tenant_id = _tenant AND l.brief_id = _brief_id AND l.asset_kind = 'form';

  RETURN jsonb_build_object(
    'brief_id', _brief_id, 'can_manage', _admin, 'counts', _counts,
    'ambiguous_on_campaign_forms', _ambiguous, 'capture_forms', _forms,
    'leads', _leads, 'truncated', (_counts->>'leads')::bigint > 200
  );
END $$;
REVOKE ALL ON FUNCTION public.get_campaign_brief_leads(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_campaign_brief_leads(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.get_campaign_brief_leads(uuid, uuid) IS
  'Experience 03 S1: the leads attributed to one campaign at capture, with contact, opportunity, pipeline, stage and status; server counts; members get no names. Caller''s own workspace only.';
