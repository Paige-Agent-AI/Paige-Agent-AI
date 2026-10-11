-- INT-298 / INT-342 S2 — Marketing's private metric producer on the INT-340 shared evidence seam.
--
-- Marketing owns its analytics producers (docs/delivery/int340-shared-metric-consumer-contract.md:45);
-- INT-340 owns the shared issuer, resolver, reference registry and validator. This migration adds the
-- private `_marketing_metric_bundle` and one `marketing.%` branch to the shared dispatcher, exactly as
-- Sales did (docs/delivery/sales-performance-server-contract.md). Nothing else in the dispatcher changes.
--
-- Every figure is a COUNT of canonical records the workspace already holds: form submissions, live forms
-- and their routing, campaign briefs, and email recipients. Nothing is estimated and no value is stored:
-- the shared issuer persists only an opaque, expiring reference. Visits, spend, reach, revenue and
-- "qualified" leads have no producer here and stay unavailable at the reader.
BEGIN;

-- One cleaner for every tag and name that becomes a key or label. The shared validator measures length in
-- UTF-16 units and trims JavaScript whitespace, so: characters outside the Basic Multilingual Plane become
-- U+FFFD (one unit each, so a character limit is a unit limit), every control character and every Unicode
-- space becomes one space, ends are trimmed, and a value with nothing left is no value.
CREATE OR REPLACE FUNCTION public._marketing_metric_text(p_value text,p_max integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT nullif(btrim(left(btrim(regexp_replace(regexp_replace(p_value,'[\U00010000-\U0010FFFF]',U&'\FFFD','g'),
  '[[:space:][:cntrl:]\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+',' ','g')),p_max)),'')
$$;
REVOKE ALL ON FUNCTION public._marketing_metric_text(text,integer) FROM PUBLIC,anon,authenticated,service_role;

-- The failed-and-stalled count reads only unfinished submissions; this keeps it off the whole history.
CREATE INDEX IF NOT EXISTS growth_form_submissions_tenant_unfinished
 ON public.growth_form_submissions (tenant_id) WHERE processing_state IN ('error','pending','claimed');

CREATE OR REPLACE FUNCTION public._marketing_metric_bundle(
 p_tenant_id uuid,p_metric_key text,p_metric_version text,
 p_range_start timestamptz,p_range_end timestamptz,p_as_of timestamptz,p_dimensions jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
 actor uuid:=auth.uid();
 source_rows jsonb; candidate bigint; contributing bigint; excluded bigint; numerator bigint;
 exclusions jsonb; freshness timestamptz; digest text; sources jsonb; label text; definition text; formula text;
 semantics text:='event_timestamp_cohort'; caveats jsonb:='[]'; vals jsonb; kind text:='count';
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
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'observed_at',f.updated_at,
   -- As growth-process-submission runs it: enabled automations decide; the form's own intake columns
   -- apply only when the form has no enabled automation at all.
   'routed',EXISTS(SELECT 1 FROM public.growth_form_automations a WHERE a.tenant_id=p_tenant_id AND a.form_id=f.id AND a.target_slug='pipeline_attach' AND a.enabled)
     OR (f.auto_create_deal AND f.pipeline_id IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM public.growth_form_automations a WHERE a.tenant_id=p_tenant_id AND a.form_id=f.id AND a.enabled)),
   'reason',NULL) ORDER BY f.id),'[]'::jsonb) INTO source_rows
  FROM public.growth_forms f WHERE f.tenant_id=p_tenant_id AND f.status='active';
  sources:='["public.growth_forms","public.growth_form_automations"]';
  IF p_metric_key='marketing.capture_points.published_current' THEN
   label:='Live forms'; sources:='["public.growth_forms"]';
   definition:='Forms live now that can capture a lead. Pages and funnels capture leads through the forms they embed, so they are not counted again.';
   formula:='COUNT(growth_forms WHERE status = active)';
  ELSE
   label:='Live forms not routed to a pipeline';
   definition:='Live forms whose leads reach no pipeline, as the submission processor runs them: no enabled "Add to your pipeline" automation, and no intake route (create a deal on a chosen pipeline) that applies because the form has no enabled automation. The denominator is every live form.';
   formula:='COUNT(live forms WHERE NOT (enabled pipeline_attach automation OR (no enabled automation AND auto_create_deal AND pipeline_id IS NOT NULL)))';
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
   SELECT coalesce('src:'||left(lower(r->>'source'),76),'_untagged') k,min(r->>'source') lbl,count(*) n
   FROM jsonb_array_elements(source_rows) r WHERE r->>'reason' IS NULL GROUP BY 1
  ), ranked AS (
   SELECT k,lbl,n,row_number() OVER (ORDER BY (k='_untagged'),n DESC,k COLLATE "C") rn FROM grouped
  ), folded AS (
   SELECT CASE WHEN k<>'_untagged' AND rn>98 THEN '_other' ELSE k END k,
    CASE WHEN k='_untagged' THEN 'No source tag' WHEN rn>98 THEN 'Other sources' ELSE left(lbl,80) END lbl,n FROM ranked
  )
  SELECT jsonb_build_object('kind','distribution','items',coalesce(jsonb_agg(jsonb_build_object('key',left(k,80),'label',lbl,'count',n) ORDER BY (k IN ('_other','_untagged')),n DESC,k COLLATE "C"),'[]'::jsonb)) INTO vals
  FROM (SELECT k,min(lbl) lbl,sum(n)::bigint n FROM folded GROUP BY k) x;
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
  ), counted AS (SELECT k,min(lbl) lbl,count(*) n FROM grouped GROUP BY k),
  ranked AS (SELECT k,lbl,n,row_number() OVER (ORDER BY (k='_untagged'),n DESC,k COLLATE "C") rn FROM counted),
  folded AS (SELECT CASE WHEN k<>'_untagged' AND rn>98 THEN '_other' ELSE k END k,CASE WHEN k<>'_untagged' AND rn>98 THEN 'Other tags' ELSE coalesce(nullif(btrim(lbl),''),'Untitled brief') END lbl,n FROM ranked)
  SELECT jsonb_build_object('kind','distribution','items',coalesce(jsonb_agg(jsonb_build_object('key',k,'label',lbl,'count',n) ORDER BY (k IN ('_other','_untagged')),n DESC,k COLLATE "C"),'[]'::jsonb)) INTO vals
  FROM (SELECT k,min(lbl) lbl,sum(n)::bigint n FROM folded GROUP BY k) x;
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

-- The shared dispatcher (INT-340) gains the eleven marketing keys and one branch. Every other line is
-- as 20270601000006 wrote it.
CREATE OR REPLACE FUNCTION public._analytics_metric_produce(p_tenant uuid,p_metric text,p_version text,p_start timestamptz,p_end timestamptz,p_asof timestamptz,p_dimensions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET timezone='UTC' AS $$
DECLARE result jsonb;
BEGIN
 IF public._analytics_metric_authorized(p_tenant) IS DISTINCT FROM true THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ANALYTICS_EVIDENCE_UNAVAILABLE';
 END IF;
 IF p_metric IS NULL OR p_metric NOT IN (
  'sales.opportunities.created','sales.opportunities.open_current','sales.opportunities.won_current_close_date','sales.opportunities.lost_current_close_date',
  'sales.pipeline.open_value','sales.invoices.issued_count','sales.invoices.issued_amount','sales.receivables.outstanding_current','sales.receivables.overdue_current',
  'sales.cash.recorded_received','sales.payments.posted_net_allocations',
  'business.active_clients_current','business.onboarding_current','business.lifecycle_current','business.retention','business.profitability','business.nps',
  'operations.systems_check_latest','operations.unresolved_findings_current','operations.workflows_active_current','operations.recorded_workflow_runs',
  'operations.recorded_workflow_activity','operations.current_system_exceptions',
  'team.active_members_current','team.role_distribution_current','team.performance_scorecards',
  'ai.recorded_model_requests','ai.recorded_model_requests_daily','ai.recorded_tokens','ai.estimated_model_cost','ai.recorded_latency','ai.recorded_browser_calls','ai.voice_consumption',
  'marketing.leads.received','marketing.leads.daily','marketing.leads.by_utm_source','marketing.leads.by_campaign_tag',
  'marketing.leads.converted_to_opportunity','marketing.capture_points.published_current','marketing.forms.unrouted_current',
  'marketing.submissions.failed_current','marketing.email.sent','marketing.email.opened','marketing.email.clicked') THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ANALYTICS_METRIC_ARGUMENTS_INVALID';
 END IF;
 -- Private producers independently validate their complete metric allowlists.
 IF p_metric LIKE 'sales.%' THEN
  result:=public._sales_performance_metric_bundle(p_tenant,p_metric,p_version,p_start,p_end,p_asof,p_dimensions);
 ELSIF p_metric LIKE 'business.%' OR p_metric LIKE 'operations.%' OR p_metric LIKE 'team.%' OR p_metric LIKE 'ai.%' THEN
  result:=public._settings_analytics_metric_bundle(p_tenant,p_metric,p_version,p_start,p_end,p_asof,p_dimensions);
 ELSIF p_metric LIKE 'marketing.%' THEN
  result:=public._marketing_metric_bundle(p_tenant,p_metric,p_version,p_start,p_end,p_asof,p_dimensions);
 ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='ANALYTICS_METRIC_ARGUMENTS_INVALID';
 END IF;
 IF result->>'truth_state'='UNAVAILABLE' THEN
  result:=jsonb_set(result,'{values}','null'::jsonb);
  result:=jsonb_set(result,'{coverage,contributing_count}','0'::jsonb);
  result:=jsonb_set(result,'{coverage,excluded_count}',result#>'{coverage,candidate_count}');
  result:=jsonb_set(result,'{exclusions}',jsonb_build_array(jsonb_build_object('reason','Required source or eligible measurement unavailable','count',result#>'{coverage,candidate_count}')));
 END IF;
 RETURN result - 'sharedissuance_required' - 'evidence_state';
END $$;
REVOKE ALL ON FUNCTION public._analytics_metric_produce(uuid,text,text,timestamptz,timestamptz,timestamptz,jsonb) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
