-- EXP03 F8 (journey "Progress to customer"): the read a campaign's qualified handoff rests on.
-- get_campaign_brief_leads gains, additively, what Sales itself recorded for each credited lead's
-- opportunity: the deal's recipient (a name, owner/admin-only like every other name on this read),
-- the close date when a deal is won, and the deal's invoice counts (raw: how many, how many paid).
-- Agreements are NOT linked to opportunities in the records today and bookings are not either, so
-- this read claims neither; the surface says so. No writer, no new join keys, nothing invents a
-- deal, appointment, attendance, sale or delivered handoff.
-- Generated from the incumbent in 20271025100000 (the sole definition) with the additions above.
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
           st.label stage_label, st.stage_type, d.owner_user_id, d.actual_close_date,
           inv.n invoice_count, inv.paid invoice_paid_count
    FROM public.growth_form_submissions s
    LEFT JOIN public.deals d ON d.id = s.deal_id AND d.tenant_id = _tenant
    LEFT JOIN public.pipelines p ON p.id = d.pipeline_id AND p.tenant_id = _tenant
    LEFT JOIN public.pipeline_stages st ON st.id = d.stage_id AND st.tenant_id = _tenant
    LEFT JOIN LATERAL (
      SELECT count(*) n, count(*) FILTER (WHERE i.status = 'paid') paid
      FROM public.paige_invoices i WHERE i.deal_id = d.id AND i.tenant_id = _tenant
    ) inv ON TRUE
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
      'stage_label', l.stage_label, 'stage_type', l.stage_type,
      -- F8 (journey "Progress to customer"): who in Sales holds it, and the invoice facts on the deal.
      -- A name is owner/admin-only like the others; counts are business facts, not names.
      'deal_owner', CASE WHEN _admin THEN nullif(btrim(pr.full_name), '') END,
      'won_at', CASE WHEN l.deal_status = 'won' THEN l.actual_close_date END,
      'invoice_count', l.invoice_count, 'invoice_paid_count', l.invoice_paid_count
    ) j
    FROM lead l
    LEFT JOIN public.growth_forms f ON f.id = l.form_id AND f.tenant_id = _tenant
    LEFT JOIN public.clients c ON c.id = l.contact_id AND c.tenant_id = _tenant
    LEFT JOIN public.profiles pr ON pr.user_id = l.owner_user_id
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
  'Experience 03 S1: the leads attributed to one campaign at capture, with contact, opportunity, pipeline, stage and status; the deal recipient (owners and admins only), the close date when won, and the deal invoice counts; server counts; members get no names. Caller''s own workspace only.';
