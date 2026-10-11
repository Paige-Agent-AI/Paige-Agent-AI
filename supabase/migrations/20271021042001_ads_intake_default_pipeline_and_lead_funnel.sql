-- Leads land in a pipeline, and Ads/Marketing read them from the same pipelines (owner ruling 2026-10-11).
--
-- 1. growth_attach_submission_default_deal — a form with NO deal route of its own files its lead into the
--    tenant's DEFAULT pipeline, first open stage. "Routed" is the processor's canonical rule
--    (growth-process-submission): an enabled automation whose target executor is pipeline_attach, OR
--    auto_create_deal with a pipeline_id while the form has NO enabled automation at all. A form whose
--    enabled automations carry no pipeline_attach is unrouted even when stale auto_create_deal columns
--    remain (the processor ignores those columns once any automation is enabled). An existing open deal
--    for the contact in the default pipeline is reused and NOT moved. Service-role only; the same
--    internal-only and stale-claim guards as growth_attach_submission_deal (20270588326001), untouched.
-- 2. growth_attach_inbound_default_deal — the same rule for an external source (growth-inbound) with no
--    target form. Service-role only.
-- 3. get_pipeline_lead_funnel — one read, contract v2 (see its COMMENT): current deals per stage, and form
--    leads per campaign (utm_campaign) and per ad (utm_content), keys case-folded, each deal attributed
--    to ONE touch (last touch). Owner/admin of the pipeline's business, the agency working in it, or the
--    platform owner (§59, in-body). Counts only — no names, no rows.
-- 4. set_ad_creative_featured — the same authority as save_marketing_content (plus the platform owner)
--    marks an image/video as a featured ad (meta.ads_featured), at most 6 non-archived per business;
--    an archived item cannot be featured.
-- 5. save_marketing_content — carried VERBATIM from 20270546000000 except that meta.ads_featured and
--    meta.ads_featured_at become server-owned like meta.versions (carried on re-save, stripped on insert),
--    so set_ad_creative_featured is their one writer. Signature, attributes and grants unchanged (§37).
-- 6. _marketing_metric_bundle — carried VERBATIM from 20270602000503 except marketing.forms.unrouted_current:
--    a live form is unrouted only when it has no route of its own (the canonical rule above, joined on the
--    target executor) AND the business has no default pipeline that can take a lead (not archived, with a
--    non-archived open stage). Every other key, the authority gate and the return contract are unchanged.
--
-- Contacts made by hand or by PAIGE are not touched: only the form processor and the inbound bridge call
-- 1 and 2. No provider call, no spend, no publishing. "Performing" is real leads and won deals.
-- No table, column or policy changes.

CREATE OR REPLACE FUNCTION public.growth_attach_submission_default_deal(
  p_submission_id uuid, p_claim_attempt integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  sub public.growth_form_submissions%ROWTYPE; form public.growth_forms%ROWTYPE;
  deal public.deals%ROWTYPE; pipeline uuid; stage uuid; creator uuid;
BEGIN
  IF coalesce(auth.jwt()->>'role','')<>'service_role' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'FORM_DEAL_INTERNAL_ONLY' USING ERRCODE='42501';
  END IF;
  SELECT * INTO sub FROM public.growth_form_submissions WHERE id=p_submission_id FOR UPDATE;
  IF NOT FOUND OR sub.processing_state<>'claimed' OR sub.attempts IS DISTINCT FROM p_claim_attempt THEN
    RAISE EXCEPTION 'FORM_DEAL_STALE_CLAIM' USING ERRCODE='40001';
  END IF;
  PERFORM 1 FROM public.tenants WHERE id=sub.tenant_id AND status IN ('active','trial','past_due') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORM_DEAL_TENANT_INACTIVE' USING ERRCODE='42501'; END IF;
  SELECT * INTO form FROM public.growth_forms WHERE id=sub.form_id AND tenant_id=sub.tenant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORM_DEAL_FORM_INVALID' USING ERRCODE='42501'; END IF;
  -- A form that routes its own deals never takes the default; its route is the one route. The rule is the
  -- processor's: an enabled automation whose target runs pipeline_attach, or the form's intake columns
  -- while it has no enabled automation at all (stale columns under an enabled automation route nothing).
  IF EXISTS(SELECT 1 FROM public.growth_form_automations a JOIN public.growth_automation_targets t ON t.slug=a.target_slug
             WHERE a.form_id=form.id AND a.tenant_id=sub.tenant_id AND a.enabled AND t.executor='pipeline_attach')
     OR (coalesce(form.auto_create_deal,false) AND form.pipeline_id IS NOT NULL
         AND NOT EXISTS(SELECT 1 FROM public.growth_form_automations a
                         WHERE a.form_id=form.id AND a.tenant_id=sub.tenant_id AND a.enabled)) THEN
    RAISE EXCEPTION 'FORM_DEAL_ROUTE_INVALID' USING ERRCODE='42501';
  END IF;
  -- Previously committed identity wins (a retry never makes a second deal).
  IF sub.deal_id IS NOT NULL THEN
    SELECT * INTO deal FROM public.deals WHERE id=sub.deal_id FOR SHARE;
    IF NOT FOUND OR deal.tenant_id<>sub.tenant_id OR deal.contact_client_id IS DISTINCT FROM sub.contact_id THEN
      RAISE EXCEPTION 'FORM_DEAL_BINDING_MISMATCH' USING ERRCODE='42501';
    END IF;
    RETURN jsonb_build_object('deal_id',deal.id,'stage_id',deal.stage_id,'default_pipeline',true,'replayed',true);
  END IF;
  IF sub.contact_id IS NULL THEN RAISE EXCEPTION 'FORM_DEAL_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.clients WHERE id=sub.contact_id AND tenant_id=sub.tenant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORM_DEAL_CLIENT_INVALID' USING ERRCODE='42501'; END IF;
  -- The pipeline lock serializes open-deal selection with growth_attach_submission_deal's.
  SELECT id INTO pipeline FROM public.pipelines
   WHERE tenant_id=sub.tenant_id AND is_default AND lifecycle_status<>'archived'
   ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF pipeline IS NULL THEN RETURN jsonb_build_object('skipped','no_default_pipeline'); END IF;
  SELECT id INTO stage FROM public.pipeline_stages
   WHERE pipeline_id=pipeline AND tenant_id=sub.tenant_id AND stage_type='open' AND archived_at IS NULL
   ORDER BY order_index,id LIMIT 1 FOR SHARE;
  IF stage IS NULL THEN RETURN jsonb_build_object('skipped','no_open_stage','pipeline_id',pipeline); END IF;
  SELECT * INTO deal FROM public.deals
   WHERE tenant_id=sub.tenant_id AND pipeline_id=pipeline AND contact_client_id=sub.contact_id AND status='open'
   ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    SELECT user_id INTO creator FROM public.tenant_members WHERE tenant_id=sub.tenant_id AND user_id=form.created_by AND status='active' AND role IN ('owner','admin') FOR SHARE;
    IF creator IS NULL THEN SELECT user_id INTO creator FROM public.tenant_members WHERE tenant_id=sub.tenant_id AND status='active' AND role='owner' ORDER BY joined_at,user_id LIMIT 1 FOR SHARE; END IF;
    IF creator IS NULL THEN RAISE EXCEPTION 'FORM_DEAL_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
    INSERT INTO public.deals(title,pipeline_id,stage_id,contact_client_id,status,source,tenant_id,created_by)
    VALUES(coalesce(nullif(btrim(sub.payload_json->>'name'),''),nullif(btrim(sub.payload_json->>'email'),''),coalesce(form.name,'Form')||' lead'),
           pipeline,stage,sub.contact_id,'open','paige_form',sub.tenant_id,creator) RETURNING * INTO deal;
  END IF;
  UPDATE public.growth_form_submissions SET deal_id=deal.id WHERE id=sub.id;
  RETURN jsonb_build_object('deal_id',deal.id,'stage_id',deal.stage_id,'default_pipeline',true);
END $$;
REVOKE ALL ON FUNCTION public.growth_attach_submission_default_deal(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.growth_attach_submission_default_deal(uuid,integer) TO service_role;
COMMENT ON FUNCTION public.growth_attach_submission_default_deal(uuid,integer) IS
  'Service-only. Files an unrouted form submission''s lead into the tenant default pipeline, first open stage; reuses (never moves) an open deal for the contact. Routed (refused, FORM_DEAL_ROUTE_INVALID) = an enabled automation whose target executor is pipeline_attach, or auto_create_deal with a pipeline_id while the form has no enabled automation. {"skipped":"no_default_pipeline"|"no_open_stage"} when there is nowhere to file it.';

CREATE OR REPLACE FUNCTION public.growth_attach_inbound_default_deal(
  p_tenant_id uuid, p_contact_id uuid, p_source text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  client public.clients%ROWTYPE; deal public.deals%ROWTYPE; pipeline uuid; stage uuid; creator uuid;
BEGIN
  IF coalesce(auth.jwt()->>'role','')<>'service_role' OR auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'INBOUND_DEAL_INTERNAL_ONLY' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.tenants WHERE id=p_tenant_id AND status IN ('active','trial','past_due') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INBOUND_DEAL_TENANT_INACTIVE' USING ERRCODE='42501'; END IF;
  SELECT * INTO client FROM public.clients WHERE id=p_contact_id AND tenant_id=p_tenant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INBOUND_DEAL_CLIENT_INVALID' USING ERRCODE='42501'; END IF;
  SELECT id INTO pipeline FROM public.pipelines
   WHERE tenant_id=p_tenant_id AND is_default AND lifecycle_status<>'archived'
   ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF pipeline IS NULL THEN RETURN jsonb_build_object('skipped','no_default_pipeline'); END IF;
  SELECT * INTO deal FROM public.deals
   WHERE tenant_id=p_tenant_id AND pipeline_id=pipeline AND contact_client_id=p_contact_id AND status='open'
   ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('deal_id',deal.id,'stage_id',deal.stage_id,'created',false);
  END IF;
  SELECT id INTO stage FROM public.pipeline_stages
   WHERE pipeline_id=pipeline AND tenant_id=p_tenant_id AND stage_type='open' AND archived_at IS NULL
   ORDER BY order_index,id LIMIT 1 FOR SHARE;
  IF stage IS NULL THEN RETURN jsonb_build_object('skipped','no_open_stage','pipeline_id',pipeline); END IF;
  SELECT user_id INTO creator FROM public.tenant_members WHERE tenant_id=p_tenant_id AND status='active' AND role='owner' ORDER BY joined_at,user_id LIMIT 1 FOR SHARE;
  IF creator IS NULL THEN RAISE EXCEPTION 'INBOUND_DEAL_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
  INSERT INTO public.deals(title,pipeline_id,stage_id,contact_client_id,status,source,tenant_id,created_by)
  VALUES(coalesce(nullif(btrim(concat_ws(' ',client.first_name,client.last_name)),''),nullif(btrim(client.entity_name),''),'External lead'),
         pipeline,stage,p_contact_id,'open',left(coalesce(nullif(btrim(p_source),''),'external'),80),p_tenant_id,creator)
  RETURNING * INTO deal;
  RETURN jsonb_build_object('deal_id',deal.id,'stage_id',deal.stage_id,'created',true);
END $$;
REVOKE ALL ON FUNCTION public.growth_attach_inbound_default_deal(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.growth_attach_inbound_default_deal(uuid,uuid,text) TO service_role;
COMMENT ON FUNCTION public.growth_attach_inbound_default_deal(uuid,uuid,text) IS
  'Service-only. Files an external-source contact (no target form) into the tenant default pipeline, first open stage; reuses (never moves) an open deal for the contact. Such a lead writes no form submission, so get_pipeline_lead_funnel counts its deal in stages[].deals but not in leads.total (nor in any campaign or ad).';

-- Counts only. The caller gate is the Marketing write rule (save_marketing_content, 20270546000000) plus
-- the platform owner: the business's owner/admin, the agency working in that business, or the platform
-- owner. A plain member, a missing pipeline and a foreign one all refuse the same way.
CREATE OR REPLACE FUNCTION public.get_pipeline_lead_funnel(p_pipeline_id uuid, p_since timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _caller uuid:=auth.uid(); _p public.pipelines%ROWTYPE; _found boolean;
BEGIN
  SELECT * INTO _p FROM public.pipelines WHERE id=p_pipeline_id;
  _found:=FOUND;
  IF _caller IS NULL OR NOT _found OR _p.tenant_id IS NULL
     OR NOT (public.is_tenant_admin(_p.tenant_id)
             OR (_p.tenant_id=public.current_user_tenant_id() AND public.agency_can_manage_child(_p.tenant_id))
             OR public.is_platform_owner()) THEN
    RAISE EXCEPTION 'PIPELINE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  RETURN (
    WITH leads AS (
      -- One row per form submission in the window whose deal is in THIS pipeline.
      SELECT s.id AS submission_id, s.created_at, d.id AS deal_id, d.stage_id, d.status,
             x.campaign_raw, lower(x.campaign_raw) AS campaign_key, x.ad_raw, lower(x.ad_raw) AS ad_key
        FROM public.growth_form_submissions s
        JOIN public.deals d ON d.id=s.deal_id AND d.tenant_id=_p.tenant_id AND d.pipeline_id=_p.id
        CROSS JOIN LATERAL (SELECT
          CASE WHEN jsonb_typeof(s.utm_json->'utm_campaign')='string' THEN nullif(btrim(s.utm_json->>'utm_campaign'),'') END AS campaign_raw,
          CASE WHEN jsonb_typeof(s.utm_json->'utm_content')='string' THEN nullif(btrim(s.utm_json->>'utm_content'),'') END AS ad_raw) x
       WHERE s.tenant_id=_p.tenant_id AND (p_since IS NULL OR s.created_at>=p_since)
    ), touch AS (
      -- Last touch: each deal belongs to exactly ONE tagged submission, its most recent in the window.
      SELECT DISTINCT ON (deal_id) deal_id, stage_id, status, campaign_key, ad_key
        FROM leads WHERE campaign_key IS NOT NULL OR ad_key IS NOT NULL
       ORDER BY deal_id, created_at DESC, submission_id DESC
    ), campaign_names AS (
      SELECT DISTINCT ON (campaign_key) campaign_key, campaign_raw AS display
        FROM leads WHERE campaign_key IS NOT NULL ORDER BY campaign_key, created_at DESC, submission_id DESC
    ), campaign_deals AS (
      SELECT campaign_key, count(*) FILTER (WHERE status='open') AS open,
             count(*) FILTER (WHERE status='won') AS won, count(*) FILTER (WHERE status='lost') AS lost
        FROM touch WHERE campaign_key IS NOT NULL GROUP BY campaign_key
    ), campaign_stage AS (
      SELECT campaign_key, jsonb_object_agg(stage_id::text, n) AS by_stage
        FROM (SELECT campaign_key, stage_id, count(*) AS n FROM touch
               WHERE campaign_key IS NOT NULL AND stage_id IS NOT NULL GROUP BY campaign_key, stage_id) x
       GROUP BY campaign_key
    ), campaign_rows AS (
      SELECT l.campaign_key, n.display, l.leads, coalesce(d.open,0) AS open, coalesce(d.won,0) AS won,
             coalesce(d.lost,0) AS lost, coalesce(st.by_stage,'{}'::jsonb) AS by_stage
        FROM (SELECT campaign_key, count(*) AS leads FROM leads WHERE campaign_key IS NOT NULL GROUP BY campaign_key) l
        JOIN campaign_names n USING (campaign_key)
        LEFT JOIN campaign_deals d USING (campaign_key)
        LEFT JOIN campaign_stage st USING (campaign_key)
       ORDER BY coalesce(d.won,0) DESC, l.leads DESC, l.campaign_key LIMIT 50
    ), ad_names AS (
      SELECT DISTINCT ON (ad_key) ad_key, ad_raw AS display
        FROM leads WHERE ad_key IS NOT NULL ORDER BY ad_key, created_at DESC, submission_id DESC
    ), ad_campaign AS (
      -- The campaign an ad brought the most leads under (ties: the more recent, then the key).
      SELECT DISTINCT ON (ad_key) ad_key, campaign_key
        FROM (SELECT ad_key, campaign_key, count(*) AS n, max(created_at) AS last_at FROM leads
               WHERE ad_key IS NOT NULL AND campaign_key IS NOT NULL GROUP BY ad_key, campaign_key) x
       ORDER BY ad_key, n DESC, last_at DESC, campaign_key
    ), ad_deals AS (
      SELECT ad_key, count(*) FILTER (WHERE status='open') AS open,
             count(*) FILTER (WHERE status='won') AS won, count(*) FILTER (WHERE status='lost') AS lost
        FROM touch WHERE ad_key IS NOT NULL GROUP BY ad_key
    ), ad_rows AS (
      SELECT l.ad_key, n.display, cn.display AS campaign, l.leads,
             coalesce(d.open,0) AS open, coalesce(d.won,0) AS won, coalesce(d.lost,0) AS lost,
             mc.id AS content_id, mc.kind, mc.image_url
        FROM (SELECT ad_key, count(*) AS leads FROM leads WHERE ad_key IS NOT NULL GROUP BY ad_key) l
        JOIN ad_names n USING (ad_key)
        LEFT JOIN ad_deals d USING (ad_key)
        LEFT JOIN ad_campaign ac USING (ad_key)
        LEFT JOIN campaign_names cn ON cn.campaign_key=ac.campaign_key
        -- An ad tagged with a library item's id (any letter case) is that picture or video.
        LEFT JOIN public.marketing_content mc ON mc.tenant_id=_p.tenant_id AND mc.id::text=l.ad_key
              AND mc.kind IN ('image','video') AND mc.status<>'archived'
       ORDER BY coalesce(d.won,0) DESC, l.leads DESC, l.ad_key LIMIT 50
    )
    SELECT jsonb_build_object(
      'pipeline', jsonb_build_object('id',_p.id,'name',_p.name,'is_default',_p.is_default),
      'stages_window', 'current',
      'stages', coalesce((SELECT jsonb_agg(jsonb_build_object('id',st.id,'name',st.label,'order_index',st.order_index,'stage_type',st.stage_type,
                  'deals',(SELECT count(*) FROM public.deals d WHERE d.tenant_id=_p.tenant_id AND d.pipeline_id=_p.id AND d.stage_id=st.id))
                  ORDER BY st.order_index, st.id)
                FROM public.pipeline_stages st WHERE st.pipeline_id=_p.id AND st.tenant_id=_p.tenant_id AND st.archived_at IS NULL),'[]'::jsonb),
      'leads', (SELECT jsonb_build_object('total',count(*),
                  'tagged',count(*) FILTER (WHERE campaign_key IS NOT NULL OR ad_key IS NOT NULL),
                  'untagged',count(*) FILTER (WHERE campaign_key IS NULL AND ad_key IS NULL),
                  'unfiled',(SELECT count(*) FROM public.growth_form_submissions s
                              WHERE s.tenant_id=_p.tenant_id AND s.deal_id IS NULL AND (p_since IS NULL OR s.created_at>=p_since)))
                FROM leads),
      'campaigns', coalesce((SELECT jsonb_agg(jsonb_build_object('campaign',c.display,'leads',c.leads,'open',c.open,'won',c.won,'lost',c.lost,
                  'by_stage',c.by_stage) ORDER BY c.won DESC, c.leads DESC, c.campaign_key) FROM campaign_rows c),'[]'::jsonb),
      'ads', coalesce((SELECT jsonb_agg(jsonb_build_object('ad',a.display,'campaign',a.campaign,'content_id',a.content_id,'kind',a.kind,
                  'image_url',a.image_url,'leads',a.leads,'open',a.open,'won',a.won,'lost',a.lost)
                  ORDER BY a.won DESC, a.leads DESC, a.ad_key) FROM ad_rows a),'[]'::jsonb),
      'since', to_jsonb(p_since))
  );
END $$;
REVOKE ALL ON FUNCTION public.get_pipeline_lead_funnel(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_lead_funnel(uuid,timestamptz) TO authenticated;
COMMENT ON FUNCTION public.get_pipeline_lead_funnel(uuid,timestamptz) IS
$c$Lead funnel contract v2. Counts only; no names, no rows. Caller: the business's owner/admin, the agency working in that business (agency_can_manage_child, active workspace), or the platform owner; anything else, including a missing pipeline, is PIPELINE_FORBIDDEN (42501).
Returns {"pipeline":{"id","name","is_default"}, "stages_window":"current", "stages":[{"id","name","order_index","stage_type","deals"}], "leads":{"total","tagged","untagged","unfiled"}, "campaigns":[{"campaign","leads","open","won","lost","by_stage":{stage_id:deals}}], "ads":[{"ad","campaign","content_id","kind","image_url","leads","open","won","lost"}], "since"}.
stages[].deals are CURRENT deals in each non-archived stage (stages_window "current"): never windowed by p_since. Every other figure is windowed: form submissions with created_at >= p_since (all time when null).
leads.total counts form submissions whose deal is in this pipeline; tagged/untagged split them by whether utm_campaign or utm_content is present; unfiled counts this business's submissions in the window that reached no pipeline (deal_id null, including ones still being processed). An external lead with no target form (growth_attach_inbound_default_deal) writes no submission: its deal counts in stages[].deals but not in leads.
Campaign keys are lower(btrim(utm_campaign)) and ad keys lower(btrim(utm_content)), as marketing.leads.by_campaign_tag folds case; each row shows the spelling of its most recent submission. campaigns[].leads and ads[].leads count submissions.
open/won/lost are LAST-TOUCH: each deal is attributed to exactly one touch, its most recent tagged submission in the window, and counted once under that touch's campaign and once under that touch's ad by its current status; by_stage counts the same attributed deals by current stage. So a dimension's open+won+lost never exceeds its distinct deals and sums correctly across rows.
ads has ONE row per ad key, merged across campaigns; campaign is the campaign with the most leads for that ad (null if none). content_id is the marketing_content id when the ad key equals a non-archived image/video id of this business (case-insensitive), with its kind and image_url; otherwise all three are null. Each list is ordered won desc, leads desc, key, at most 50.$c$;

CREATE OR REPLACE FUNCTION public.set_ad_creative_featured(p_content_id uuid, p_featured boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _row public.marketing_content%ROWTYPE; _found boolean; _count integer;
BEGIN
  SELECT * INTO _row FROM public.marketing_content WHERE id=p_content_id;
  _found:=FOUND;
  -- save_marketing_content's authority (the business's owner/admin, or the agency working in it), plus the
  -- platform owner. A missing row and another business's row refuse the same way.
  IF auth.uid() IS NULL OR NOT _found
     OR NOT (public.is_tenant_admin(_row.tenant_id)
             OR (_row.tenant_id=public.current_user_tenant_id() AND public.agency_can_manage_child(_row.tenant_id))
             OR public.is_platform_owner()) THEN
    RAISE EXCEPTION 'AD_CREATIVE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF _row.kind NOT IN ('image','video') THEN RAISE EXCEPTION 'AD_CREATIVE_KIND_INVALID' USING ERRCODE='22023'; END IF;
  IF p_featured IS NULL THEN RAISE EXCEPTION 'AD_FEATURED_VALUE_REQUIRED' USING ERRCODE='22023'; END IF;
  IF p_featured THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ads-featured:'||_row.tenant_id::text,0));
    SELECT * INTO _row FROM public.marketing_content WHERE id=_row.id FOR UPDATE;
    IF _row.status='archived' THEN RAISE EXCEPTION 'AD_CREATIVE_ARCHIVED' USING ERRCODE='22023'; END IF;
    SELECT count(*) INTO _count FROM public.marketing_content
     WHERE tenant_id=_row.tenant_id AND id<>_row.id AND kind IN ('image','video') AND status<>'archived'
       AND coalesce(meta->>'ads_featured','false')='true';
    IF _count>=6 THEN RAISE EXCEPTION 'AD_FEATURED_LIMIT' USING ERRCODE='22023'; END IF;
  END IF;
  UPDATE public.marketing_content
     SET meta=CASE WHEN jsonb_typeof(meta)='object' THEN meta ELSE '{}'::jsonb END
              ||jsonb_build_object('ads_featured',p_featured,'ads_featured_at',now())
   WHERE id=_row.id;
  RETURN jsonb_build_object('id',_row.id,'featured',p_featured);
END $$;
REVOKE ALL ON FUNCTION public.set_ad_creative_featured(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_ad_creative_featured(uuid,boolean) TO authenticated;
COMMENT ON FUNCTION public.set_ad_creative_featured(uuid,boolean) IS
  'The business''s owner/admin, the agency working in it, or the platform owner marks one image/video as a featured ad (meta.ads_featured, meta.ads_featured_at). At most 6 non-archived featured per business (AD_FEATURED_LIMIT); an archived item cannot be featured (AD_CREATIVE_ARCHIVED). The one writer of those keys: save_marketing_content carries them and never accepts them.';

-- ─────────────────────────────────────────────────────────────────────────────
-- save_marketing_content — carried forward VERBATIM from 20270546000000 (the newest definition in this
-- repository) except the two marked 20271021042001 lines: ads_featured / ads_featured_at are server-owned.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_marketing_content(p_kind text, p_title text, p_body text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_image_url text DEFAULT NULL::text, p_image_path text DEFAULT NULL::text, p_size text DEFAULT NULL::text, p_brief text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb, p_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
  _kind text := CASE WHEN p_kind IN ('text','image','video','document') THEN p_kind ELSE 'text' END;
  _id uuid;
  _cur record;
  _new_image text := NULLIF(btrim(p_image_url), '');
  _versions jsonb;
  _merged_meta jsonb;
BEGIN
  -- Migration D (§9/§59): who may write is decided by the workspace, never by a global role.
  IF _caller IS NOT NULL THEN
    -- Signed in: the caller's active workspace, and only that one. A named workspace that is not
    -- the active one is refused, never swapped in.
    _tenant := public.current_user_tenant_id();
    IF _tenant IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
    END IF;
    IF p_tenant_id IS NOT NULL AND p_tenant_id <> _tenant THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: that is not the workspace you are working in' USING ERRCODE = '42501';
    END IF;
    -- The workspace's own owner or admin, or the agency that manages this sub-account exactly as
    -- agency_can_manage_child scopes it (the same rule as _growth_admin_tenant).
    IF NOT (public.is_tenant_admin(_tenant) OR public.agency_can_manage_child(_tenant)) THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: the workspace owner or an admin is required' USING ERRCODE = '42501';
    END IF;
  ELSE
    -- No signed-in user: only a server session may name the workspace, and it must name one.
    IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.is_direct_server_context()) THEN
      RAISE EXCEPTION 'CONTENT_FORBIDDEN: sign in to change this workspace' USING ERRCODE = '42501';
    END IF;
    IF p_tenant_id IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
    END IF;
    _tenant := p_tenant_id;
  END IF;

  IF p_id IS NOT NULL THEN
    -- Read + LOCK the CURRENT row (tenant-scoped) so we can preserve the prior image before overwriting
    -- it. FOR UPDATE serializes concurrent refines of the SAME row, so a double-submit cannot lose a
    -- version to a read-modify-write race.
    SELECT image_url, image_path, size, meta INTO _cur
    FROM public.marketing_content
    WHERE id = p_id AND tenant_id = _tenant
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    -- p_meta (when supplied) still replaces the caller-facing meta, BUT `versions` is SERVER-OWNED: it
    -- is ALWAYS re-asserted from the row's own history below, so a caller can neither forge it (a
    -- caller-supplied meta.versions is ignored) nor wipe it (a non-image reuse with p_meta='{}' cannot
    -- drop it) — the §70 "prior image is never silently lost" invariant holds on EVERY reuse path.
    _merged_meta := COALESCE(p_meta, _cur.meta, '{}'::jsonb);
    _versions := _cur.meta -> 'versions';
    IF _versions IS NULL OR jsonb_typeof(_versions) <> 'array' THEN
      _versions := '[]'::jsonb;
    END IF;

    -- Version preservation: when the image is actually being replaced with a different one, append the
    -- OUTGOING (prior) image as the newest history entry (capped to the most-recent 20).
    IF _new_image IS NOT NULL AND _cur.image_url IS NOT NULL AND _new_image <> _cur.image_url THEN
      _versions := _versions || jsonb_build_array(jsonb_build_object(
        'image_url', _cur.image_url,
        'image_path', _cur.image_path,
        'size', _cur.size,
        'at', now()
      ));
      IF jsonb_array_length(_versions) > 20 THEN
        SELECT COALESCE(jsonb_agg(v ORDER BY ord), '[]'::jsonb)
          INTO _versions
        FROM jsonb_array_elements(_versions) WITH ORDINALITY AS t(v, ord)
        WHERE ord > jsonb_array_length(_versions) - 20;
      END IF;
    END IF;
    -- server-owned versions ALWAYS win over any caller-supplied meta.versions (forge/wipe-proof).
    -- p_meta is arbitrary jsonb (its generated client type permits strings/numbers/booleans/arrays),
    -- and jsonb_set cannot install an object key into a scalar/array root — it would return the root
    -- unchanged and SILENTLY DROP the versions snapshot, breaking the un-wipeable-history contract
    -- (Codex P2). Normalize a non-object merged meta to an object first so `versions` always persists.
    IF _merged_meta IS NULL OR jsonb_typeof(_merged_meta) <> 'object' THEN
      _merged_meta := '{}'::jsonb;
    END IF;
    _merged_meta := jsonb_set(_merged_meta, '{versions}', _versions, true);
    -- 20271021042001: meta.ads_featured / meta.ads_featured_at are SERVER-OWNED exactly like versions.
    -- set_ad_creative_featured is their one writer; a re-save carries them from the CURRENT row and a
    -- caller-supplied value is ignored, so saving can neither feature an item nor drop a feature.
    _merged_meta := _merged_meta - 'ads_featured' - 'ads_featured_at';
    IF jsonb_typeof(_cur.meta) = 'object' THEN
      IF _cur.meta ? 'ads_featured' THEN
        _merged_meta := jsonb_set(_merged_meta, '{ads_featured}', _cur.meta -> 'ads_featured', true);
      END IF;
      IF _cur.meta ? 'ads_featured_at' THEN
        _merged_meta := jsonb_set(_merged_meta, '{ads_featured_at}', _cur.meta -> 'ads_featured_at', true);
      END IF;
    END IF;

    UPDATE public.marketing_content SET
      title = COALESCE(NULLIF(btrim(p_title), ''), title),
      body = COALESCE(p_body, body),
      channel = COALESCE(p_channel, channel),
      brief = COALESCE(p_brief, brief),
      meta = _merged_meta,
      image_url = COALESCE(_new_image, image_url),
      image_path = COALESCE(NULLIF(btrim(p_image_path), ''), image_path),
      size = COALESCE(NULLIF(btrim(p_size), ''), size)
    WHERE id = p_id AND tenant_id = _tenant
    RETURNING id INTO _id;
    IF _id IS NULL THEN
      RAISE EXCEPTION 'CONTENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    RETURN _id;
  END IF;

  -- §13 (Codex P2): `versions` is SERVER-OWNED lineage; a brand-new row has none. Strip any
  -- caller-supplied `meta.versions` on INSERT so a caller cannot plant fabricated history that a later
  -- reuse would then treat as authentic server-owned lineage (the reuse branch above re-asserts history
  -- from the row's OWN meta, so a forged initial `versions` would otherwise be carried forward). Only an
  -- object meta can carry the key; a scalar/array meta can't, so it is left as-is.
  _merged_meta := COALESCE(p_meta, '{}'::jsonb);
  IF jsonb_typeof(_merged_meta) = 'object' THEN
    -- 20271021042001: a new row is never born featured (set_ad_creative_featured is the one writer).
    _merged_meta := _merged_meta - 'versions' - 'ads_featured' - 'ads_featured_at';
  END IF;

  INSERT INTO public.marketing_content (
    tenant_id, created_by, kind, channel, title, body,
    image_url, image_path, size, brief, meta
  ) VALUES (
    _tenant, _caller, _kind, NULLIF(btrim(p_channel), ''),
    COALESCE(NULLIF(btrim(p_title), ''), 'Untitled'), p_body,
    NULLIF(btrim(p_image_url), ''), NULLIF(btrim(p_image_path), ''),
    NULLIF(btrim(p_size), ''), p_brief, _merged_meta
  )
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'marketing_content', 'save_marketing_content', _id,
          jsonb_build_object('tenant_id', _tenant, 'kind', _kind, 'channel', p_channel));

  RETURN _id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_marketing_content(text, text, text, text, text, text, text, text, jsonb, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_marketing_content(text, text, text, text, text, text, text, text, jsonb, uuid, uuid) TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────────────────────
-- _marketing_metric_bundle — carried forward VERBATIM from 20270602000503 (the newest definition in this
-- repository) except the marked 20271021042001 lines in the capture-point/unrouted branch: the own-route
-- test joins the target executor, as the processor does, and a form is routed while the default pipeline
-- can take its lead (default_ready). Grants (none) and the comment are re-asserted unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._marketing_metric_bundle(
 p_tenant_id uuid,p_metric_key text,p_metric_version text,
 p_range_start timestamptz,p_range_end timestamptz,p_as_of timestamptz,p_dimensions jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
 actor uuid:=auth.uid();
 source_rows jsonb; candidate bigint; contributing bigint; excluded bigint; numerator bigint;
 exclusions jsonb; freshness timestamptz; digest text; sources jsonb; label text; definition text; formula text;
 semantics text:='event_timestamp_cohort'; caveats jsonb:='[]'; vals jsonb; kind text:='count';
 default_ready boolean:=false;
BEGIN
 -- Defense in depth: only the shared issuer's owner can call this, and it re-checks the seat itself.
 IF actor IS NULL OR p_tenant_id IS NULL OR public.current_user_tenant_id() IS DISTINCT FROM p_tenant_id
  OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=actor AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=statement_timestamp()))
  OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=actor AND p.active_tenant_id=p_tenant_id)
  OR NOT EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=p_tenant_id AND m.user_id=actor AND m.status='active' AND m.role::text IN ('owner','admin'))
  OR NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.status::text IN ('trial','active','past_due')) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='MARKETING_METRIC_UNAVAILABLE';
 END IF;
 IF p_metric_version IS DISTINCT FROM '1.0.0' OR p_metric_key IS NULL OR p_metric_key NOT IN (
  'marketing.leads.received','marketing.leads.daily','marketing.leads.by_utm_source','marketing.leads.by_campaign_tag',
  'marketing.leads.converted_to_opportunity','marketing.capture_points.published_current','marketing.forms.unrouted_current',
  'marketing.submissions.failed_current','marketing.email.sent','marketing.email.opened','marketing.email.clicked')
  OR p_range_start IS NULL OR p_range_end IS NULL OR p_as_of IS NULL
  OR NOT isfinite(p_range_start) OR NOT isfinite(p_range_end) OR NOT isfinite(p_as_of)
  OR p_range_start>=p_range_end OR p_range_end>p_as_of OR p_range_end-p_range_start>interval '10 years'
  OR p_dimensions IS NULL OR p_dimensions<>'{}'::jsonb THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MARKETING_METRIC_CONTRACT_INVALID';
 END IF;
 -- A daily series is one point per UTC day the range touches, and the shared contract caps a series at 366.
 IF p_metric_key='marketing.leads.daily'
  AND (date_trunc('day',p_range_end-interval '1 microsecond')::date-date_trunc('day',p_range_start)::date)+1>366 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='MARKETING_METRIC_RANGE_TOO_LONG_FOR_DAILY_SERIES';
 END IF;

 IF p_metric_key LIKE 'marketing.leads.%' THEN
  -- One row per form submission received in the range. A submission is a lead; nothing here judges quality.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'form_id',s.form_id,'created_at',s.created_at,'observed_at',coalesce(s.processed_at,s.created_at),
   'source',CASE WHEN jsonb_typeof(s.utm_json->'utm_source')='string' THEN public._marketing_metric_text(s.utm_json->>'utm_source',120) END,
   'campaign',CASE WHEN jsonb_typeof(s.utm_json->'utm_campaign')='string' THEN public._marketing_metric_text(s.utm_json->>'utm_campaign',120) END,
   'deal_id',s.deal_id,'deal_found',d.id IS NOT NULL,
   'reason',CASE WHEN p_metric_key='marketing.leads.converted_to_opportunity' AND s.deal_id IS NOT NULL AND d.id IS NULL THEN 'opportunity_record_missing' END)
   ORDER BY s.id),'[]'::jsonb) INTO source_rows
  FROM public.growth_form_submissions s
  LEFT JOIN public.deals d ON d.id=s.deal_id AND d.tenant_id=p_tenant_id
  WHERE s.tenant_id=p_tenant_id AND s.created_at>=p_range_start AND s.created_at<p_range_end;
  sources:='["public.growth_form_submissions"]';
  IF p_metric_key='marketing.leads.received' THEN
   label:='Leads received';
   definition:='Form submissions received in the range, from every form in this workspace, live or since unpublished.';
   formula:='COUNT(growth_form_submissions WHERE created_at IN [start,end))';
  ELSIF p_metric_key='marketing.leads.daily' THEN
   kind:='series'; label:='Leads received each day';
   definition:='Form submissions received on each UTC day the range touches; a day with none is zero. The first and last points cover only the part of their day inside the range.';
   formula:='COUNT(growth_form_submissions) GROUP BY UTC day of created_at, one point per day in [start,end)';
  ELSIF p_metric_key='marketing.leads.by_utm_source' THEN
   kind:='distribution'; label:='Leads by source tag';
   definition:='Leads received in the range grouped by the utm_source on the link they submitted from (case-insensitive). Leads whose link carried no source tag are counted as their own item, never dropped.';
   formula:='COUNT(submissions) GROUP BY lower(utm_source) as item src:<tag>; no tag -> item _untagged; beyond 98 tags the rest -> item _other';
   caveats:=jsonb_build_array('Only the link a lead submitted from is known, not earlier visits. Whether a link was paid is not recorded: a paid link counts here only if it carried a source tag.');
  ELSIF p_metric_key='marketing.leads.by_campaign_tag' THEN
   kind:='distribution'; label:='Leads by campaign tag';
   definition:='Leads received in the range grouped by the utm_campaign on their link, matched case-insensitively to a campaign brief''s reference. A tag that matches no brief is its own item; a tag that matches more than one brief is excluded and disclosed, never guessed.';
   formula:='COUNT(submissions) GROUP BY brief WHERE lower(utm_campaign)=lower(campaign_briefs.short_ref) (unique match), else GROUP BY lower(utm_campaign); no tag -> item _untagged';
   sources:='["public.growth_form_submissions","public.campaign_briefs"]';
   caveats:=jsonb_build_array('A match is a text match between the link''s campaign tag and a brief''s reference; it is evidence the link was shared for that brief, not proof of attribution.');
  ELSE
   label:='Leads that became opportunities';
   definition:='Leads received in the range whose submission is linked to an opportunity record in this workspace. What happened to the opportunity afterwards belongs to Sales.';
   formula:='COUNT(submissions WHERE deal_id resolves to a deal in this workspace); denominator = contributing leads';
   sources:='["public.growth_form_submissions","public.deals"]';
  END IF;
 ELSIF p_metric_key IN ('marketing.capture_points.published_current','marketing.forms.unrouted_current') THEN
  semantics:='current_snapshot';
  -- 20271021042001: a form with no route of its own files its leads into the business's default pipeline,
  -- first open stage (growth_attach_submission_default_deal). The same pipeline and stage that function
  -- picks: the oldest non-archived default pipeline, and a non-archived open stage in it.
  SELECT EXISTS(SELECT 1 FROM public.pipeline_stages st
   WHERE st.tenant_id=p_tenant_id AND st.stage_type='open' AND st.archived_at IS NULL
     AND st.pipeline_id=(SELECT p.id FROM public.pipelines p WHERE p.tenant_id=p_tenant_id AND p.is_default
                          AND p.lifecycle_status<>'archived' ORDER BY p.created_at,p.id LIMIT 1)) INTO default_ready;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'observed_at',f.updated_at,
   -- As growth-process-submission runs it: an enabled automation whose target runs pipeline_attach, or the
   -- form's own intake columns when the form has no enabled automation at all. A form with neither is
   -- still routed while the default pipeline can take its leads (default_ready).
   'routed',EXISTS(SELECT 1 FROM public.growth_form_automations a JOIN public.growth_automation_targets t ON t.slug=a.target_slug
       WHERE a.tenant_id=p_tenant_id AND a.form_id=f.id AND a.enabled AND t.executor='pipeline_attach')
     OR (f.auto_create_deal AND f.pipeline_id IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM public.growth_form_automations a WHERE a.tenant_id=p_tenant_id AND a.form_id=f.id AND a.enabled))
     OR default_ready,
   'reason',NULL) ORDER BY f.id),'[]'::jsonb) INTO source_rows
  FROM public.growth_forms f WHERE f.tenant_id=p_tenant_id AND f.status='active';
  sources:='["public.growth_forms","public.growth_form_automations","public.growth_automation_targets","public.pipelines","public.pipeline_stages"]';
  IF p_metric_key='marketing.capture_points.published_current' THEN
   label:='Live forms'; sources:='["public.growth_forms"]';
   definition:='Forms live now that can capture a lead. Pages and funnels capture leads through the forms they embed, so they are not counted again.';
   formula:='COUNT(growth_forms WHERE status = active)';
  ELSE
   label:='Live forms not routed to a pipeline';
   definition:='Live forms whose leads reach no pipeline, as the submission processor runs them: no enabled "Add to your pipeline" automation, no intake route (create a deal on a chosen pipeline) that applies because the form has no enabled automation, and no default pipeline with an open stage to take the lead instead. The denominator is every live form.';
   formula:='COUNT(live forms WHERE NOT (enabled automation whose target executor is pipeline_attach OR (no enabled automation AND auto_create_deal AND pipeline_id IS NOT NULL) OR (default pipeline not archived AND it has a non-archived open stage)))';
  END IF;
 ELSIF p_metric_key='marketing.submissions.failed_current' THEN
  semantics:='current_snapshot'; kind:='distribution';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'observed_at',coalesce(s.claimed_at,s.processed_at,s.created_at),
   'state',CASE WHEN s.processing_state='error' THEN 'failed' ELSE 'stalled' END,'reason',NULL) ORDER BY s.id),'[]'::jsonb) INTO source_rows
  FROM public.growth_form_submissions s
  WHERE s.tenant_id=p_tenant_id AND (s.processing_state='error'
   OR (s.processing_state IN ('pending','claimed') AND s.created_at<p_as_of-interval '15 minutes'));
  sources:='["public.growth_form_submissions"]'; label:='Leads that could not be processed';
  definition:='Submissions whose processing failed, or that are still waiting more than 15 minutes after arriving (the processor retries waiting submissions after 5 minutes, so these have missed at least one retry). Current state, at any age.';
  formula:='COUNT(processing_state = error) as failed; COUNT(processing_state IN (pending, claimed) AND created_at < as_of - 15 minutes) as stalled';
 ELSE
  -- Email: one row per recipient sent in the range. Opens and clicks are tracked only on sends that went
  -- through Paige's managed route; sends through the business's own mail are excluded from those two.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'observed_at',greatest(r.sent_at,r.opened_at,r.clicked_at),
   'opened',r.opened_at IS NOT NULL,'clicked',r.clicked_at IS NOT NULL,
   'reason',CASE WHEN p_metric_key<>'marketing.email.sent' AND r.route IS DISTINCT FROM 'managed' THEN 'not_tracked_own_mail' END) ORDER BY r.id),'[]'::jsonb) INTO source_rows
  FROM public.email_campaign_recipients r
  WHERE r.tenant_id=p_tenant_id AND r.sent_at>=p_range_start AND r.sent_at<p_range_end;
  sources:='["public.email_campaign_recipients"]';
  IF p_metric_key='marketing.email.sent' THEN
   label:='Emails sent'; definition:='Campaign and series emails sent in the range, through any route.'; formula:='COUNT(email_campaign_recipients WHERE sent_at IN [start,end))';
  ELSIF p_metric_key='marketing.email.opened' THEN
   label:='Emails opened'; definition:='Tracked emails sent in the range that have been opened since. The denominator is the tracked sends; sends through the business''s own mail cannot be tracked and are excluded.';
   formula:='COUNT(tracked sends WHERE opened_at IS NOT NULL); denominator = tracked sends in range';
   caveats:=jsonb_build_array('Opens are recorded by mail clients loading an image; some clients block it and some preload it, so opens are a floor-and-ceiling signal, not a read receipt.');
  ELSE
   label:='Emails clicked'; definition:='Tracked emails sent in the range in which a link has been clicked since. The denominator is the tracked sends; sends through the business''s own mail are excluded.';
   formula:='COUNT(tracked sends WHERE clicked_at IS NOT NULL); denominator = tracked sends in range';
  END IF;
 END IF;

 SELECT count(*),count(*) FILTER(WHERE r->>'reason' IS NULL),max((r->>'observed_at')::timestamptz)
 INTO candidate,contributing,freshness FROM jsonb_array_elements(source_rows) r;
 excluded:=candidate-contributing;
 SELECT coalesce(jsonb_agg(jsonb_build_object('reason',reason,'count',n) ORDER BY reason),'[]'::jsonb) INTO exclusions
 FROM(SELECT r->>'reason' reason,count(*) n FROM jsonb_array_elements(source_rows) r WHERE r->>'reason' IS NOT NULL GROUP BY r->>'reason') x;

 IF kind='series' THEN
  WITH per_day AS (
   SELECT date_trunc('day',(r->>'created_at')::timestamptz) AS d,count(*) n FROM jsonb_array_elements(source_rows) r WHERE r->>'reason' IS NULL GROUP BY 1
  )
  SELECT jsonb_build_object('kind','series','points',coalesce(jsonb_agg(jsonb_build_object('at',greatest(g.day,p_range_start),'value',coalesce(p.n,0)) ORDER BY g.day),'[]'::jsonb)) INTO vals
  FROM generate_series(date_trunc('day',p_range_start),date_trunc('day',p_range_end-interval '1 microsecond'),interval '1 day') g(day)
  LEFT JOIN per_day p ON p.d=g.day;
 ELSIF p_metric_key='marketing.leads.by_utm_source' THEN
  WITH grouped AS (
   SELECT coalesce('src:'||left(lower(r->>'source'),76),'_untagged') k,min(r->>'source' COLLATE "C") lbl,count(*) n
   FROM jsonb_array_elements(source_rows) r WHERE r->>'reason' IS NULL GROUP BY 1
  ), ranked AS (
   SELECT k,lbl,n,row_number() OVER (ORDER BY (k='_untagged'),n DESC,k COLLATE "C") rn FROM grouped
  ), folded AS (
   SELECT CASE WHEN k<>'_untagged' AND rn>98 THEN '_other' ELSE k END k,
    CASE WHEN k='_untagged' THEN 'No source tag' WHEN rn>98 THEN 'Other sources' ELSE left(lbl,80) END lbl,n FROM ranked
  )
  SELECT jsonb_build_object('kind','distribution','items',coalesce(jsonb_agg(jsonb_build_object('key',left(k,80),'label',lbl,'count',n) ORDER BY (k IN ('_other','_untagged')),n DESC,k COLLATE "C"),'[]'::jsonb)) INTO vals
  FROM (SELECT k,min(lbl COLLATE "C") lbl,sum(n)::bigint n FROM folded GROUP BY k) x;
 ELSIF p_metric_key='marketing.leads.by_campaign_tag' THEN
  WITH refs AS (
   SELECT lower(public._marketing_metric_text(b.short_ref,120)) ref,count(*) brief_count,min(b.id::text)::uuid brief_id
   FROM public.campaign_briefs b WHERE b.tenant_id=p_tenant_id AND public._marketing_metric_text(b.short_ref,120) IS NOT NULL GROUP BY 1
  )
  SELECT jsonb_agg(CASE WHEN f.brief_count>1 THEN r||jsonb_build_object('reason','campaign_tag_matches_several_briefs')
   ELSE r||jsonb_build_object('brief_id',CASE WHEN f.brief_count=1 THEN f.brief_id END) END ORDER BY r->>'id') INTO source_rows
  FROM jsonb_array_elements(source_rows) r LEFT JOIN refs f ON f.ref=lower(r->>'campaign');
  source_rows:=coalesce(source_rows,'[]'::jsonb);
  SELECT count(*),count(*) FILTER(WHERE r->>'reason' IS NULL) INTO candidate,contributing FROM jsonb_array_elements(source_rows) r;
  excluded:=candidate-contributing;
  SELECT coalesce(jsonb_agg(jsonb_build_object('reason',reason,'count',n) ORDER BY reason),'[]'::jsonb) INTO exclusions
  FROM(SELECT r->>'reason' reason,count(*) n FROM jsonb_array_elements(source_rows) r WHERE r->>'reason' IS NOT NULL GROUP BY r->>'reason') x;
  WITH grouped AS (
   SELECT CASE WHEN r->>'brief_id' IS NOT NULL THEN 'brief:'||(r->>'brief_id') WHEN r->>'campaign' IS NOT NULL THEN 'tag:'||left(lower(r->>'campaign'),76) ELSE '_untagged' END k,
    CASE WHEN r->>'brief_id' IS NOT NULL THEN (SELECT public._marketing_metric_text(b.name,120) FROM public.campaign_briefs b WHERE b.id=(r->>'brief_id')::uuid AND b.tenant_id=p_tenant_id)
     WHEN r->>'campaign' IS NOT NULL THEN left(r->>'campaign',120) ELSE 'No campaign tag' END lbl
   FROM jsonb_array_elements(source_rows) r WHERE r->>'reason' IS NULL
  ), counted AS (SELECT k,min(lbl COLLATE "C") lbl,count(*) n FROM grouped GROUP BY k),
  ranked AS (SELECT k,lbl,n,row_number() OVER (ORDER BY (k='_untagged'),n DESC,k COLLATE "C") rn FROM counted),
  folded AS (SELECT CASE WHEN k<>'_untagged' AND rn>98 THEN '_other' ELSE k END k,CASE WHEN k<>'_untagged' AND rn>98 THEN 'Other tags' ELSE coalesce(nullif(btrim(lbl),''),'Untitled brief') END lbl,n FROM ranked)
  SELECT jsonb_build_object('kind','distribution','items',coalesce(jsonb_agg(jsonb_build_object('key',k,'label',lbl,'count',n) ORDER BY (k IN ('_other','_untagged')),n DESC,k COLLATE "C"),'[]'::jsonb)) INTO vals
  FROM (SELECT k,min(lbl COLLATE "C") lbl,sum(n)::bigint n FROM folded GROUP BY k) x;
 ELSIF p_metric_key='marketing.submissions.failed_current' THEN
  SELECT jsonb_build_object('kind','distribution','items',jsonb_build_array(
   jsonb_build_object('key','failed','label','Processing failed','count',count(*) FILTER(WHERE r->>'state'='failed')),
   jsonb_build_object('key','stalled','label','Still waiting after 15 minutes','count',count(*) FILTER(WHERE r->>'state'='stalled')))) INTO vals
  FROM jsonb_array_elements(source_rows) r;
 ELSE
  SELECT count(*) FILTER(WHERE r->>'reason' IS NULL AND CASE p_metric_key
    WHEN 'marketing.leads.converted_to_opportunity' THEN (r->>'deal_found')::boolean
    WHEN 'marketing.forms.unrouted_current' THEN NOT (r->>'routed')::boolean
    WHEN 'marketing.email.opened' THEN (r->>'opened')::boolean
    WHEN 'marketing.email.clicked' THEN (r->>'clicked')::boolean
    ELSE true END) INTO numerator FROM jsonb_array_elements(source_rows) r;
  vals:=jsonb_build_object('kind','count','count',numerator);
 END IF;

 digest:='sr_v1_'||encode(extensions.digest(convert_to(jsonb_build_object('tenant',p_tenant_id,'metric',p_metric_key,'version',p_metric_version,
  'range_start',p_range_start,'range_end',p_range_end,'as_of',p_as_of,'dimensions',p_dimensions,'rows',source_rows)::text,'UTF8'),'sha256'),'hex');
 RETURN jsonb_build_object('metric_key',p_metric_key,'metric_version',p_metric_version,'owner_department','marketing','label',label,'definition',definition,'formula',formula,
  'range',jsonb_build_object('start',p_range_start,'end',p_range_end,'bounds','[start,end)','timezone','UTC','semantics',semantics),
  'dimensions',p_dimensions,'values',vals,'unit',CASE WHEN kind='series' THEN 'count_per_day' ELSE 'count' END,'source_refs',sources,'as_of',p_as_of,
  'freshness',jsonb_build_object('queried_at',p_as_of,'source_updated_through',freshness),
  'coverage',jsonb_build_object('state',CASE WHEN candidate>0 AND contributing=0 THEN 'unavailable' WHEN excluded>0 THEN 'partial' ELSE 'complete' END,
   'candidate_count',candidate,'contributing_count',contributing,'excluded_count',excluded),
  'exclusions',exclusions,'truth_state',CASE WHEN candidate>0 AND contributing=0 THEN 'UNAVAILABLE' WHEN excluded>0 THEN 'PARTIAL' ELSE 'LIVE' END,
  'caveats',caveats,'source_revision_ref',digest,'evidence_ref',NULL,'evidence_state','shared_issuance_required');
END $$;
REVOKE ALL ON FUNCTION public._marketing_metric_bundle(uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public._marketing_metric_bundle(uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb) IS
 'INT-298/INT-342 private Marketing metric producer. Shared INT-340 issuer owns the opaque evidence reference; no direct caller grants, KPI cache, provider action or Chat tool.';
