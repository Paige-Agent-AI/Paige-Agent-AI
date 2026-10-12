-- INT-298 / INT-342 MBC slice 7a — a public page, funnel or form records an honest, tenant-scoped visit, and a
-- submission carries the visit it came from. Contract: docs/delivery/public-visit-evidence-contract.md.
--
-- Until now nothing recorded a visit to a business's own public pages: the app-wide page_view beacon writes
-- analytics_events, which has no tenant (and production holds 0 page_view rows), and growth_funnel_sessions has a
-- tenant-pinned writer that nothing ever called. So Marketing could not show a visit, a conversion rate or a funnel
-- step-through, and said so. This slice records the evidence; reading it into figures is the next slice.
--
-- What one row means: one browser tab looking at one published page, active funnel or active standalone form, until
-- it has been idle for 30 minutes. The visitor is never identified: no IP, no user agent, no cookie; only the
-- referring HOST and the link's utm tags are kept. Browsers that send Do Not Track or Global Privacy Control, and
-- known automated agents, are not recorded at all (growth-public-visit decides that before calling here), so a
-- visit count is "recorded visits", and a conversion rate built on it must count only submissions that carry a
-- recorded visit. The one writer is growth_public_visit_record, callable only by the service role.
BEGIN;

CREATE TABLE IF NOT EXISTS public.growth_public_visits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  target_kind       text NOT NULL CHECK (target_kind IN ('page','funnel','form')),
  page_id           uuid REFERENCES public.growth_pages(id) ON DELETE CASCADE,
  funnel_id         uuid REFERENCES public.growth_funnels(id) ON DELETE CASCADE,
  form_id           uuid REFERENCES public.growth_forms(id) ON DELETE CASCADE,
  funnel_session_id uuid REFERENCES public.growth_funnel_sessions(id) ON DELETE SET NULL,
  -- The visitor's proof that a later call continues THIS visit. Server-generated, never derived from the visitor.
  visit_token       text NOT NULL UNIQUE,
  furthest_step     integer NOT NULL DEFAULT 0 CHECK (furthest_step >= 0),
  utm_json          jsonb NOT NULL DEFAULT '{}'::jsonb,
  referrer_host     text CHECK (referrer_host IS NULL OR referrer_host ~ '^[a-z0-9.-]{1,253}$'),
  started_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_public_visits_one_target CHECK (
    (target_kind = 'page'   AND page_id IS NOT NULL AND funnel_id IS NULL AND form_id IS NULL) OR
    (target_kind = 'funnel' AND funnel_id IS NOT NULL AND page_id IS NULL AND form_id IS NULL) OR
    (target_kind = 'form'   AND form_id IS NOT NULL AND page_id IS NULL AND funnel_id IS NULL)),
  CONSTRAINT growth_public_visits_session_is_funnel CHECK (funnel_session_id IS NULL OR target_kind = 'funnel'),
  CONSTRAINT growth_public_visits_step_is_funnel CHECK (furthest_step = 0 OR target_kind = 'funnel')
);
CREATE INDEX IF NOT EXISTS growth_public_visits_tenant_started ON public.growth_public_visits (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS growth_public_visits_page ON public.growth_public_visits (page_id, started_at) WHERE page_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS growth_public_visits_funnel ON public.growth_public_visits (funnel_id, started_at) WHERE funnel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS growth_public_visits_form ON public.growth_public_visits (form_id, started_at) WHERE form_id IS NOT NULL;

-- The workspace reads its own visits; nobody writes them except through the writer below.
ALTER TABLE public.growth_public_visits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS growth_public_visits_tenant_read ON public.growth_public_visits;
CREATE POLICY growth_public_visits_tenant_read ON public.growth_public_visits FOR SELECT TO authenticated
  USING (public.is_platform_owner() OR tenant_id = public.current_user_tenant_id());
REVOKE ALL ON public.growth_public_visits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.growth_public_visits TO authenticated;
GRANT ALL ON public.growth_public_visits TO service_role;

-- A submission remembers the visit it came from. Set only by growth-public-submit, from a token the server checks.
ALTER TABLE public.growth_form_submissions
  ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.growth_public_visits(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS growth_form_submissions_visit ON public.growth_form_submissions (visit_id) WHERE visit_id IS NOT NULL;

-- ── The one writer ───────────────────────────────────────────────────────────────────────────────────
-- Starts a visit, or continues one: a token that names this same target, in this same business, seen within the
-- last 30 minutes, is continued (last_seen_at, and for a funnel the furthest step reached, never rewound). Any other
-- token starts a new visit, so a stale or foreign token can never move someone else's record. The business comes
-- from the target row, never the request; the target must be public now (a published page, an active funnel or
-- form) and the business live (trial, active or past due, the same rule as growth-public-submit). A funnel visit
-- opens and advances its growth_funnel_sessions row through that table's own writer.
CREATE OR REPLACE FUNCTION public.growth_public_visit_record(
  p_kind text, p_target_id uuid, p_visit_token text DEFAULT NULL, p_step integer DEFAULT 0,
  p_utm jsonb DEFAULT '{}'::jsonb, p_referrer_host text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _tenant uuid; _public boolean; _token text := nullif(btrim(p_visit_token), '');
  _step integer := least(greatest(coalesce(p_step, 0), 0), 1000);
  _host text := lower(nullif(btrim(p_referrer_host), ''));
  _utm jsonb := CASE WHEN jsonb_typeof(p_utm) = 'object' THEN p_utm ELSE '{}'::jsonb END;
  _visit public.growth_public_visits; _session public.growth_funnel_sessions; _last_step integer;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('page','funnel','form') OR p_target_id IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_VISIT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'page' THEN
    SELECT p.tenant_id, p.status = 'published' INTO _tenant, _public FROM public.growth_pages p WHERE p.id = p_target_id;
  ELSIF p_kind = 'funnel' THEN
    SELECT f.tenant_id, f.status = 'active' INTO _tenant, _public FROM public.growth_funnels f WHERE f.id = p_target_id;
  ELSE
    SELECT f.tenant_id, f.status = 'active' INTO _tenant, _public FROM public.growth_forms f WHERE f.id = p_target_id;
  END IF;
  IF _tenant IS NULL OR NOT coalesce(_public, false)
     OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.status::text IN ('trial','active','past_due')) THEN
    RAISE EXCEPTION 'PUBLIC_VISIT_TARGET_UNAVAILABLE' USING ERRCODE = '22023';
  END IF;
  IF _host IS NOT NULL AND (_host !~ '^[a-z0-9.-]{1,253}$') THEN _host := NULL; END IF;
  IF p_kind <> 'funnel' THEN _step := 0; END IF;

  IF _token IS NOT NULL THEN
    SELECT * INTO _visit FROM public.growth_public_visits v
     WHERE v.visit_token = _token AND v.tenant_id = _tenant AND v.target_kind = p_kind
       AND p_target_id = CASE p_kind WHEN 'page' THEN v.page_id WHEN 'funnel' THEN v.funnel_id ELSE v.form_id END
       AND v.last_seen_at > now() - interval '30 minutes'
     FOR UPDATE;
  END IF;

  IF _visit.id IS NULL THEN
    IF p_kind = 'funnel' THEN
      _session := public.growth_funnel_session_upsert(p_target_id, NULL, _step, NULL, _utm, _host, NULL, _tenant);
    END IF;
    INSERT INTO public.growth_public_visits (tenant_id, target_kind, page_id, funnel_id, form_id, funnel_session_id,
      visit_token, furthest_step, utm_json, referrer_host)
    VALUES (_tenant, p_kind,
      CASE WHEN p_kind = 'page' THEN p_target_id END, CASE WHEN p_kind = 'funnel' THEN p_target_id END,
      CASE WHEN p_kind = 'form' THEN p_target_id END, _session.id,
      'pv_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      _step, _utm, _host)
    RETURNING * INTO _visit;
    RETURN jsonb_build_object('visit_token', _visit.visit_token, 'started', true);
  END IF;

  _last_step := _visit.furthest_step;
  UPDATE public.growth_public_visits SET last_seen_at = now(), furthest_step = greatest(furthest_step, _step)
   WHERE id = _visit.id RETURNING * INTO _visit;
  IF p_kind = 'funnel' AND _visit.funnel_session_id IS NOT NULL AND _visit.furthest_step > _last_step THEN
    PERFORM public.growth_funnel_session_upsert(p_target_id,
      (SELECT s.session_token FROM public.growth_funnel_sessions s WHERE s.id = _visit.funnel_session_id),
      _visit.furthest_step, NULL, NULL, NULL, NULL, _tenant);
  END IF;
  RETURN jsonb_build_object('visit_token', _visit.visit_token, 'started', false);
END $$;
REVOKE ALL ON FUNCTION public.growth_public_visit_record(text, uuid, text, integer, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.growth_public_visit_record(text, uuid, text, integer, jsonb, text) TO service_role;

-- ── The visit a submission came from ────────────────────────────────────────────────────────────────
-- growth-public-submit asks this before it writes a submission. A token links only when it is a live visit (seen in
-- the last two hours) in the SAME business as the form, and either the visit is to this very form, or to a page or
-- funnel. Anything else links nothing, and the submission is still saved: a visit is evidence, never a gate.
CREATE OR REPLACE FUNCTION public.growth_public_visit_for_submission(p_form_id uuid, p_visit_token text)
RETURNS TABLE(visit_id uuid, funnel_session_token text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT v.id, s.session_token
    FROM public.growth_public_visits v
    JOIN public.growth_forms f ON f.id = p_form_id AND f.tenant_id = v.tenant_id
    LEFT JOIN public.growth_funnel_sessions s ON s.id = v.funnel_session_id AND s.tenant_id = v.tenant_id
   WHERE v.visit_token = nullif(btrim(p_visit_token), '')
     AND v.last_seen_at > now() - interval '2 hours'
     AND (v.target_kind IN ('page','funnel') OR v.form_id = p_form_id)
$$;
REVOKE ALL ON FUNCTION public.growth_public_visit_for_submission(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.growth_public_visit_for_submission(uuid, text) TO service_role;

COMMENT ON TABLE public.growth_public_visits IS
  'One browser tab viewing one published page, active funnel or active standalone form until 30 minutes idle. No IP, user agent or cookie; only referring host and utm tags. Do Not Track / Global Privacy Control browsers and known automated agents are never recorded, so counts are recorded visits. Written only by growth_public_visit_record (service role, via growth-public-visit). INT-298 MBC 7a.';
COMMIT;
