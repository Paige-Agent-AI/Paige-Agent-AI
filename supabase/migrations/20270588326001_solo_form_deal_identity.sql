-- Form-only admission. Existing submission/dispatch records are the operation identity.
-- No changes to the governed CRM/pipeline functions or public-user authority.
CREATE OR REPLACE FUNCTION public.growth_attach_submission_deal(
  p_submission_id uuid, p_claim_attempt integer, p_automation_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  sub public.growth_form_submissions%ROWTYPE; form public.growth_forms%ROWTYPE;
  route public.growth_form_automations%ROWTYPE; dispatch public.growth_submission_dispatches%ROWTYPE;
  deal public.deals%ROWTYPE; pipeline uuid; stage uuid; creator uuid; result jsonb;
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
  IF p_automation_id IS NOT NULL THEN
    SELECT a.* INTO route FROM public.growth_form_automations a JOIN public.growth_automation_targets t ON t.slug=a.target_slug
    WHERE a.id=p_automation_id AND a.form_id=form.id AND a.tenant_id=sub.tenant_id AND a.enabled AND t.enabled AND t.executor='pipeline_attach' FOR SHARE OF a,t;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORM_DEAL_ROUTE_INVALID' USING ERRCODE='42501'; END IF;
    pipeline:=coalesce(nullif(route.config_json->>'pipeline_id','')::uuid,form.pipeline_id);
    stage:=coalesce(nullif(route.config_json->>'stage_id','')::uuid,form.stage_id);
    SELECT * INTO dispatch FROM public.growth_submission_dispatches WHERE submission_id=sub.id AND automation_id=route.id FOR UPDATE;
  ELSE
    IF NOT form.auto_create_deal OR EXISTS(SELECT 1 FROM public.growth_form_automations WHERE form_id=form.id AND enabled) THEN
      RAISE EXCEPTION 'FORM_DEAL_ROUTE_INVALID' USING ERRCODE='42501';
    END IF;
    pipeline:=form.pipeline_id; stage:=form.stage_id;
  END IF;
  IF pipeline IS NULL OR sub.contact_id IS NULL THEN RAISE EXCEPTION 'FORM_DEAL_IDENTITY_REQUIRED' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.clients WHERE id=sub.contact_id AND tenant_id=sub.tenant_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FORM_DEAL_CLIENT_INVALID' USING ERRCODE='42501'; END IF;
  -- Previously committed identity wins even after close; route changes cannot silently redirect it.
  IF sub.deal_id IS NOT NULL OR dispatch.status='done' THEN
    SELECT * INTO deal FROM public.deals WHERE id=coalesce(sub.deal_id,nullif(dispatch.result->>'deal_id','')::uuid) FOR SHARE;
    IF NOT FOUND OR deal.tenant_id<>sub.tenant_id OR deal.pipeline_id<>pipeline OR deal.contact_client_id IS DISTINCT FROM sub.contact_id
      OR (sub.deal_id IS NOT NULL AND dispatch.status='done' AND nullif(dispatch.result->>'deal_id','')::uuid IS DISTINCT FROM sub.deal_id) THEN
      RAISE EXCEPTION 'FORM_DEAL_BINDING_MISMATCH' USING ERRCODE='42501';
    END IF;
    result:=jsonb_build_object('deal_id',deal.id,'stage_id',deal.stage_id,'replayed',true);
  ELSE
    -- Same pipeline lock serializes this producer's open-contact selection across submissions.
    PERFORM 1 FROM public.pipelines WHERE id=pipeline AND tenant_id=sub.tenant_id AND lifecycle_status<>'archived' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORM_DEAL_PIPELINE_INVALID' USING ERRCODE='42501'; END IF;
    IF stage IS NULL THEN SELECT id INTO stage FROM public.pipeline_stages WHERE pipeline_id=pipeline AND tenant_id=sub.tenant_id AND stage_type='open' AND archived_at IS NULL ORDER BY order_index,id LIMIT 1 FOR SHARE; END IF;
    PERFORM 1 FROM public.pipeline_stages WHERE id=stage AND pipeline_id=pipeline AND tenant_id=sub.tenant_id AND stage_type='open' AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORM_DEAL_STAGE_INVALID' USING ERRCODE='42501'; END IF;
    SELECT user_id INTO creator FROM public.tenant_members WHERE tenant_id=sub.tenant_id AND user_id=form.created_by AND status='active' AND role IN ('owner','admin') FOR SHARE;
    IF creator IS NULL THEN SELECT user_id INTO creator FROM public.tenant_members WHERE tenant_id=sub.tenant_id AND status='active' AND role='owner' ORDER BY joined_at,user_id LIMIT 1 FOR SHARE; END IF;
    IF creator IS NULL THEN RAISE EXCEPTION 'FORM_DEAL_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
    SELECT * INTO deal FROM public.deals WHERE tenant_id=sub.tenant_id AND pipeline_id=pipeline AND contact_client_id=sub.contact_id AND status='open' ORDER BY created_at,id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      IF deal.stage_id IS DISTINCT FROM stage THEN UPDATE public.deals SET stage_id=stage WHERE id=deal.id RETURNING * INTO deal; END IF;
    ELSE
      INSERT INTO public.deals(title,pipeline_id,stage_id,contact_client_id,status,source,tenant_id,created_by)
      VALUES(coalesce(nullif(btrim(sub.payload_json->>'name'),''),nullif(btrim(sub.payload_json->>'email'),''),coalesce(form.name,'Form')||' lead'),pipeline,stage,sub.contact_id,'open','paige_form',sub.tenant_id,creator) RETURNING * INTO deal;
    END IF;
    result:=jsonb_build_object('deal_id',deal.id,'stage_id',deal.stage_id);
  END IF;
  UPDATE public.growth_form_submissions SET deal_id=deal.id WHERE id=sub.id;
  IF p_automation_id IS NOT NULL THEN
    INSERT INTO public.growth_submission_dispatches(submission_id,automation_id,tenant_id,target_slug,status,result,error)
    VALUES(sub.id,route.id,sub.tenant_id,route.target_slug,'done',result,NULL)
    ON CONFLICT(submission_id,automation_id) DO UPDATE SET status='done',result=EXCLUDED.result,error=NULL;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.growth_attach_submission_deal(uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.growth_attach_submission_deal(uuid,integer,uuid) TO service_role;
