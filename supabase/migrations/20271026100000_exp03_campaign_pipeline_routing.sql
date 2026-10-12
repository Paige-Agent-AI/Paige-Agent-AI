-- Experience 03 (Grow My Business) S1b — a form with no route of its own files its leads into its campaign's
-- pipeline. Journey record docs/delivery/exp03-grow-my-business-journey.md §9 (S1b).
--
-- Where a form's lead goes, in order:
--   1. the form's own route (an enabled automation whose target runs pipeline_attach, or its intake columns
--      while it has no enabled automation) — unchanged, growth_attach_submission_deal;
--   2. NEW: its campaign's pipeline, first open stage — when the form is attached to exactly ONE non-archived
--      campaign (the same non-archived links the form.submitted payload and the S1a stamp read), that campaign
--      names a pipeline of the same business, the pipeline is not archived, and it has a non-archived open stage;
--   3. the business's default pipeline, first open stage — unchanged;
--   4. nowhere (the processor finishes the lead as not filed, with the reason) — unchanged.
-- The rule keys on the form's campaign link, never on a lead's own tag, so it is the same for every lead from a
-- form and the screens can state it per form. A form attached to two campaigns has no campaign route (never
-- guessed) and falls through to the default pipeline.
--
-- 1. _growth_form_campaign_route — the rule above, step 2, as ONE definition. No grants: it is read only by
--    the three functions below, each of which checks its own caller.
-- 2. growth_attach_submission_default_deal — carried VERBATIM from 20271021042001 except the marked pipeline
--    choice (campaign pipeline before default), an added result key (campaign_brief_id), and default_pipeline
--    reporting the pipeline actually used (false when the campaign's pipeline took the lead; on a replay,
--    whether the bound deal's pipeline is the default). Same guards, same reuse of an
--    open deal for the contact (in the pipeline chosen), same grants. growth-process-submission is unchanged:
--    it already hands every unrouted form's lead to this function.
-- 3. _marketing_metric_bundle — carried VERBATIM from 20271021042001 except marketing.forms.unrouted_current:
--    a live form with a campaign route is routed. Every other key, the authority gate and the contract are
--    unchanged.
-- 4. get_form_campaign_routes — the read the screens use to say where each form's leads go (Overview,
--    Analytics, the form panel). Same authority as get_campaign_brief_assets.
--
-- No table, column or policy changes; no Sales table changes; deals are created exactly as before
-- (source 'paige_form', the form's creator or the business owner), only in the campaign's pipeline when it
-- applies. Production at write time (2026-10-12): 1 campaign brief, none with a pipeline, no form linked to a
-- campaign, so no live form's destination changes until an owner links one.

CREATE OR REPLACE FUNCTION public._growth_form_campaign_route(p_tenant_id uuid, p_form_id uuid)
RETURNS TABLE(brief_id uuid, pipeline_id uuid, stage_id uuid)
LANGUAGE sql STABLE SET search_path='' AS $$
  WITH linked AS (
    SELECT b.id, b.pipeline_id
    FROM public.campaign_brief_asset_links l
    JOIN public.campaign_briefs b ON b.id=l.brief_id AND b.tenant_id=p_tenant_id AND b.lifecycle_status<>'archived'
    WHERE l.tenant_id=p_tenant_id AND l.asset_kind='form' AND l.asset_id=p_form_id
  )
  SELECT linked.id, p.id, st.id
  FROM linked
  JOIN public.pipelines p ON p.id=linked.pipeline_id AND p.tenant_id=p_tenant_id AND p.lifecycle_status<>'archived'
  CROSS JOIN LATERAL (
    SELECT s.id FROM public.pipeline_stages s
    WHERE s.pipeline_id=p.id AND s.tenant_id=p_tenant_id AND s.stage_type='open' AND s.archived_at IS NULL
    ORDER BY s.order_index, s.id LIMIT 1
  ) st
  WHERE (SELECT count(*) FROM linked)=1
$$;
REVOKE ALL ON FUNCTION public._growth_form_campaign_route(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public._growth_form_campaign_route(uuid,uuid) IS
  'Experience 03 S1b. The campaign pipeline a form with no route of its own files its leads into: the form is attached to exactly one non-archived campaign of the business, that campaign names a non-archived pipeline of the same business, and the pipeline has a non-archived open stage (the first by order). No row otherwise. Read only by growth_attach_submission_default_deal, _marketing_metric_bundle and get_form_campaign_routes.';

CREATE OR REPLACE FUNCTION public.growth_attach_submission_default_deal(
  p_submission_id uuid, p_claim_attempt integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  sub public.growth_form_submissions%ROWTYPE; form public.growth_forms%ROWTYPE;
  deal public.deals%ROWTYPE; pipeline uuid; stage uuid; creator uuid;
  campaign uuid; -- 20271026100000: the campaign whose pipeline took the lead, when one did
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
    -- 20271026100000: a replay says which pipeline the bound deal is in, rather than assuming the default.
    RETURN jsonb_build_object('deal_id',deal.id,'stage_id',deal.stage_id,
      'default_pipeline',coalesce((SELECT p.is_default FROM public.pipelines p WHERE p.id=deal.pipeline_id),false),'replayed',true);
  END IF;
  IF sub.contact_id IS NULL THEN RAISE EXCEPTION 'FORM_DEAL_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.clients WHERE id=sub.contact_id AND tenant_id=sub.tenant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORM_DEAL_CLIENT_INVALID' USING ERRCODE='42501'; END IF;
  -- 20271026100000 (Experience 03 S1b): the form's campaign pipeline first, when the form is attached to one
  -- campaign whose pipeline can take the lead. The pipeline lock and the stage re-read below are the default
  -- path's, so a pipeline archived or a stage closed in between falls through to the default pipeline.
  SELECT r.brief_id, r.pipeline_id INTO campaign, pipeline FROM public._growth_form_campaign_route(sub.tenant_id, form.id) r;
  IF pipeline IS NOT NULL THEN
    SELECT id INTO pipeline FROM public.pipelines
     WHERE id=pipeline AND tenant_id=sub.tenant_id AND lifecycle_status<>'archived' FOR UPDATE;
    IF pipeline IS NOT NULL THEN
      SELECT id INTO stage FROM public.pipeline_stages
       WHERE pipeline_id=pipeline AND tenant_id=sub.tenant_id AND stage_type='open' AND archived_at IS NULL
       ORDER BY order_index,id LIMIT 1 FOR SHARE;
    END IF;
    IF stage IS NULL THEN pipeline:=NULL; campaign:=NULL; END IF;
  END IF;
  IF pipeline IS NULL THEN
  -- The pipeline lock serializes open-deal selection with growth_attach_submission_deal's.
  SELECT id INTO pipeline FROM public.pipelines
   WHERE tenant_id=sub.tenant_id AND is_default AND lifecycle_status<>'archived'
   ORDER BY created_at,id LIMIT 1 FOR UPDATE;
  IF pipeline IS NULL THEN RETURN jsonb_build_object('skipped','no_default_pipeline'); END IF;
  SELECT id INTO stage FROM public.pipeline_stages
   WHERE pipeline_id=pipeline AND tenant_id=sub.tenant_id AND stage_type='open' AND archived_at IS NULL
   ORDER BY order_index,id LIMIT 1 FOR SHARE;
  IF stage IS NULL THEN RETURN jsonb_build_object('skipped','no_open_stage','pipeline_id',pipeline); END IF;
  END IF;
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
  RETURN jsonb_build_object('deal_id',deal.id,'stage_id',deal.stage_id,'default_pipeline',campaign IS NULL,'campaign_brief_id',campaign);
END $$;
REVOKE ALL ON FUNCTION public.growth_attach_submission_default_deal(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.growth_attach_submission_default_deal(uuid,integer) TO service_role;
COMMENT ON FUNCTION public.growth_attach_submission_default_deal(uuid,integer) IS
  'Service-only. Files an unrouted form submission''s lead into its campaign''s pipeline when the form is attached to exactly one non-archived campaign whose pipeline can take it (_growth_form_campaign_route, Experience 03 S1b), otherwise into the tenant default pipeline; first open stage either way. Reuses (never moves) an open deal for the contact in the pipeline chosen. Routed (refused, FORM_DEAL_ROUTE_INVALID) = an enabled automation whose target executor is pipeline_attach, or auto_create_deal with a pipeline_id while the form has no enabled automation. {"skipped":"no_default_pipeline"|"no_open_stage"} when there is nowhere to file it.';


-- ─────────────────────────────────────────────────────────────────────────────
-- _marketing_metric_bundle — carried forward VERBATIM from 20271021042001 (the newest definition; its
-- production function body hash matched the repository's on 2026-10-12) except the marked 20271026100000
-- lines in the unrouted branch: a form with a campaign route is routed, and the definition and formula say
-- so. Grants (none) and the comment are re-asserted unchanged.
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
     -- 20271026100000 (Experience 03 S1b): a form with no route of its own that is attached to one campaign
     -- whose pipeline can take a lead files there (_growth_form_campaign_route), so it is routed too.
     OR EXISTS(SELECT 1 FROM public._growth_form_campaign_route(p_tenant_id,f.id))
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
   definition:='Live forms whose leads reach no pipeline, as the submission processor runs them: no enabled "Add to your pipeline" automation, no intake route (create a deal on a chosen pipeline) that applies because the form has no enabled automation, no single campaign whose pipeline has an open stage to take the lead, and no default pipeline with an open stage to take it instead. The denominator is every live form.';
   formula:='COUNT(live forms WHERE NOT (enabled automation whose target executor is pipeline_attach OR (no enabled automation AND auto_create_deal AND pipeline_id IS NOT NULL) OR (attached to exactly one non-archived campaign whose pipeline is not archived AND has a non-archived open stage) OR (default pipeline not archived AND it has a non-archived open stage)))';
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

CREATE OR REPLACE FUNCTION public.get_form_campaign_routes(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := coalesce(_tenant_id, public.current_user_tenant_id());
BEGIN
  IF _caller IS NULL OR _tenant IS NULL OR NOT (public.is_platform_owner() OR _tenant = public.current_user_tenant_id()) THEN
    RAISE EXCEPTION 'CAMPAIGN_BRIEF_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  -- Every form of this business that has a campaign route, whatever its own route: the screens apply the
  -- order (own route first), exactly as growth-process-submission does.
  RETURN jsonb_build_object('routes', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'form_id', f.id, 'brief_id', r.brief_id, 'brief_name', b.name,
      'pipeline_id', r.pipeline_id, 'pipeline_name', p.name, 'stage_id', r.stage_id, 'stage_label', s.label
    ) ORDER BY f.id)
    FROM public.growth_forms f
    CROSS JOIN LATERAL public._growth_form_campaign_route(_tenant, f.id) r
    JOIN public.campaign_briefs b ON b.id=r.brief_id AND b.tenant_id=_tenant
    JOIN public.pipelines p ON p.id=r.pipeline_id AND p.tenant_id=_tenant
    JOIN public.pipeline_stages s ON s.id=r.stage_id AND s.tenant_id=_tenant
    WHERE f.tenant_id=_tenant
  ), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.get_form_campaign_routes(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_form_campaign_routes(uuid) TO authenticated;
COMMENT ON FUNCTION public.get_form_campaign_routes(uuid) IS
  'Experience 03 S1b. For each form of the business that has a campaign route (_growth_form_campaign_route): the campaign, and the pipeline and first open stage its unrouted leads are filed into. A form''s own route still comes first. Same authority as get_campaign_brief_assets: the caller''s own business, or the platform owner.';
