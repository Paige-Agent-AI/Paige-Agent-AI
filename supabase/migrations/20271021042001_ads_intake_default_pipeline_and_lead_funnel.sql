-- Leads land in a pipeline, and Ads/Marketing read them from the same pipelines (owner ruling 2026-10-11).
--
-- 1. growth_attach_submission_default_deal — a form with NO deal route of its own (no
--    auto_create_deal+pipeline_id, no enabled pipeline_attach automation) files its lead into the
--    tenant's DEFAULT pipeline, first open stage. An existing open deal for that contact in that
--    pipeline is reused and NOT moved. Service-role only; the same internal-only and stale-claim
--    guards as growth_attach_submission_deal (20270588326001), which this migration does not touch.
-- 2. growth_attach_inbound_default_deal — the same rule for an external source (growth-inbound)
--    that has no target form. Service-role only.
-- 3. get_pipeline_lead_funnel — one read: deals per stage, and form leads per campaign
--    (utm_campaign) and per ad (utm_content), counted by the deal's status. SECURITY DEFINER with the
--    caller gate get_pipeline_workspace uses (§59). Counts only — no names, no rows.
-- 4. set_ad_creative_featured — an owner/admin marks an image/video in their library as a featured
--    ad (meta.ads_featured), at most 6 per business.
--
-- Contacts made by hand or by PAIGE are not touched: only the form processor and the inbound bridge
-- call 1 and 2. No provider call, no spend, no publishing. "Performing" is real leads and won deals.
-- Additive: no table, column, policy or existing function changes.

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
  -- A form that routes its own deals never takes the default; its route is the one route.
  IF (coalesce(form.auto_create_deal,false) AND form.pipeline_id IS NOT NULL)
     OR EXISTS(SELECT 1 FROM public.growth_form_automations a JOIN public.growth_automation_targets t ON t.slug=a.target_slug
               WHERE a.form_id=form.id AND a.tenant_id=sub.tenant_id AND a.enabled AND t.executor='pipeline_attach') THEN
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
  'Service-only. Files an unrouted form submission''s lead into the tenant default pipeline, first open stage; reuses (never moves) an open deal for the contact. {"skipped":"no_default_pipeline"|"no_open_stage"} when there is nowhere to file it.';

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
  'Service-only. Files an external-source contact (no target form) into the tenant default pipeline, first open stage; reuses (never moves) an open deal for the contact.';

-- Counts only. The caller gate is get_pipeline_workspace's (20261205000000, innermost
-- get_pipeline_workspace_pre_identity): a signed-in caller whose active business owns the pipeline,
-- or the platform owner. A missing pipeline and a foreign one refuse the same way.
CREATE OR REPLACE FUNCTION public.get_pipeline_lead_funnel(p_pipeline_id uuid, p_since timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _caller uuid:=auth.uid(); _p public.pipelines%ROWTYPE;
BEGIN
  SELECT * INTO _p FROM public.pipelines WHERE id=p_pipeline_id;
  IF _caller IS NULL OR NOT FOUND OR _p.tenant_id IS NULL
     OR NOT (public.is_platform_owner() OR _p.tenant_id=public.current_user_tenant_id()) THEN
    RAISE EXCEPTION 'PIPELINE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  RETURN (
    WITH leads AS (
      SELECT s.id AS submission_id, d.id AS deal_id, d.stage_id, d.status,
             nullif(btrim(CASE WHEN jsonb_typeof(s.utm_json)='object' THEN s.utm_json->>'utm_campaign' END),'') AS campaign,
             nullif(btrim(CASE WHEN jsonb_typeof(s.utm_json)='object' THEN s.utm_json->>'utm_content' END),'') AS ad
        FROM public.growth_form_submissions s
        JOIN public.deals d ON d.id=s.deal_id AND d.tenant_id=_p.tenant_id AND d.pipeline_id=_p.id
       WHERE s.tenant_id=_p.tenant_id AND (p_since IS NULL OR s.created_at>=p_since)
    ), campaign_rows AS (
      SELECT campaign, count(*) AS leads,
             count(DISTINCT deal_id) FILTER (WHERE status='open') AS open,
             count(DISTINCT deal_id) FILTER (WHERE status='won') AS won,
             count(DISTINCT deal_id) FILTER (WHERE status='lost') AS lost
        FROM leads WHERE campaign IS NOT NULL GROUP BY campaign
       ORDER BY won DESC, leads DESC, campaign LIMIT 50
    ), campaign_stage AS (
      SELECT campaign, jsonb_object_agg(stage_id::text, n) AS by_stage
        FROM (SELECT campaign, stage_id, count(DISTINCT deal_id) AS n FROM leads
               WHERE campaign IS NOT NULL AND stage_id IS NOT NULL GROUP BY campaign, stage_id) x
       GROUP BY campaign
    ), ad_rows AS (
      SELECT ad, campaign, count(*) AS leads,
             count(DISTINCT deal_id) FILTER (WHERE status='open') AS open,
             count(DISTINCT deal_id) FILTER (WHERE status='won') AS won,
             count(DISTINCT deal_id) FILTER (WHERE status='lost') AS lost
        FROM leads WHERE ad IS NOT NULL GROUP BY ad, campaign
       ORDER BY won DESC, leads DESC, ad, campaign NULLS FIRST LIMIT 50
    )
    SELECT jsonb_build_object(
      'pipeline', jsonb_build_object('id',_p.id,'name',_p.name,'is_default',_p.is_default),
      'stages', coalesce((SELECT jsonb_agg(jsonb_build_object('id',st.id,'name',st.label,'order_index',st.order_index,'stage_type',st.stage_type,
                  'deals',(SELECT count(*) FROM public.deals d WHERE d.tenant_id=_p.tenant_id AND d.pipeline_id=_p.id AND d.stage_id=st.id))
                  ORDER BY st.order_index, st.id)
                FROM public.pipeline_stages st WHERE st.pipeline_id=_p.id AND st.tenant_id=_p.tenant_id AND st.archived_at IS NULL),'[]'::jsonb),
      'leads', (SELECT jsonb_build_object('total',count(*),
                  'tagged',count(*) FILTER (WHERE campaign IS NOT NULL OR ad IS NOT NULL),
                  'untagged',count(*) FILTER (WHERE campaign IS NULL AND ad IS NULL)) FROM leads),
      'campaigns', coalesce((SELECT jsonb_agg(jsonb_build_object('campaign',c.campaign,'leads',c.leads,'open',c.open,'won',c.won,'lost',c.lost,
                  'by_stage',coalesce(cs.by_stage,'{}'::jsonb)) ORDER BY c.won DESC, c.leads DESC, c.campaign)
                FROM campaign_rows c LEFT JOIN campaign_stage cs ON cs.campaign=c.campaign),'[]'::jsonb),
      'ads', coalesce((SELECT jsonb_agg(jsonb_build_object('ad',a.ad,'campaign',a.campaign,'leads',a.leads,'open',a.open,'won',a.won,'lost',a.lost)
                  ORDER BY a.won DESC, a.leads DESC, a.ad, a.campaign NULLS FIRST) FROM ad_rows a),'[]'::jsonb),
      'since', to_jsonb(p_since))
  );
END $$;
REVOKE ALL ON FUNCTION public.get_pipeline_lead_funnel(uuid,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_lead_funnel(uuid,timestamptz) TO authenticated;
COMMENT ON FUNCTION public.get_pipeline_lead_funnel(uuid,timestamptz) IS
  'Counts only. Deals per stage of one pipeline, and form leads whose deal is in it, per utm_campaign and per utm_content, by deal status (open/won/lost counted as distinct deals; leads as submissions). Caller gate mirrors get_pipeline_workspace.';

CREATE OR REPLACE FUNCTION public.set_ad_creative_featured(p_content_id uuid, p_featured boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _row public.marketing_content%ROWTYPE; _count integer;
BEGIN
  SELECT * INTO _row FROM public.marketing_content WHERE id=p_content_id;
  -- A missing row and another business's row refuse the same way.
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.is_tenant_admin(_row.tenant_id) THEN
    RAISE EXCEPTION 'AD_CREATIVE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF _row.kind NOT IN ('image','video') THEN RAISE EXCEPTION 'AD_CREATIVE_KIND_INVALID' USING ERRCODE='22023'; END IF;
  IF p_featured IS NULL THEN RAISE EXCEPTION 'AD_FEATURED_VALUE_REQUIRED' USING ERRCODE='22023'; END IF;
  IF p_featured THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('ads-featured:'||_row.tenant_id::text,0));
    SELECT count(*) INTO _count FROM public.marketing_content
     WHERE tenant_id=_row.tenant_id AND id<>_row.id AND kind IN ('image','video')
       AND coalesce(meta->>'ads_featured','false')='true';
    IF _count>=6 THEN RAISE EXCEPTION 'AD_FEATURED_LIMIT' USING ERRCODE='22023'; END IF;
  END IF;
  UPDATE public.marketing_content
     SET meta=coalesce(meta,'{}'::jsonb)||jsonb_build_object('ads_featured',p_featured,'ads_featured_at',now())
   WHERE id=_row.id;
  RETURN jsonb_build_object('id',_row.id,'featured',p_featured);
END $$;
REVOKE ALL ON FUNCTION public.set_ad_creative_featured(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_ad_creative_featured(uuid,boolean) TO authenticated;
COMMENT ON FUNCTION public.set_ad_creative_featured(uuid,boolean) IS
  'Owner/admin of the business marks one image/video in its library as a featured ad (meta.ads_featured). At most 6 per business (AD_FEATURED_LIMIT).';
