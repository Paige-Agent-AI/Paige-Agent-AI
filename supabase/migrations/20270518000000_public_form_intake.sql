-- Public form intake — every account's public forms become openable, submittable and safe.
--
-- WHY (measured on production 2026-09-29, read-only):
--   * growth_forms' only public read policy is `status = 'published'`, but the status CHECK allows
--     only draft | active | archived. No visitor has ever been able to open a form; the platform
--     holds zero submissions in its history. Four active forms across two businesses are dead links.
--   * growth_form_submissions granted INSERT to anon and authenticated on EVERY column (contact_id,
--     deal_id, processing_state, …). A rolled-back probe showed the anon insert is refused today only
--     because its policy's EXISTS cannot see any form — fixing the read alone would make it live. So
--     the read fix and the insert closure ship together, in this one migration.
--
-- WHAT THIS DOES:
--   1. DELETES the dead `growth_forms_public_read_published` policy and every anon privilege on
--      growth_forms. Visitors read a form only through growth_public_form(), which returns the name,
--      fields and thank-you text of an ACTIVE form — never tenant_id, pipeline, alert address or author.
--   2. DELETES `growth_form_submissions_public_insert` and the anon/authenticated INSERT privilege.
--      Submissions arrive only through the growth-public-submit edge function (service role), which
--      checks origin, a bot trap, per-IP and per-form rate limits, and accepts only the form's own fields.
--   3. ADDS growth_forms.notify_email — the address a workspace sets to be emailed on each submission —
--      and growth_form_submissions.alert_sent_at, so a retried submission never emails twice.
--   4. ADDS growth_form_set_intake(): the one write seam (§10) for a form's intake settings — create a
--      lead in <pipeline → stage>, and email <address>. Scoped to the form's own business: the caller
--      must be an active owner/admin member of that tenant (§9/§59). No account is named anywhere.
--
-- REVERSIBILITY: every step is reversible — drop the two functions, drop the two columns, re-create
-- the two deleted policies and re-grant the revoked privileges (their definitions are in
-- 20260630004505 / 20260702022450). No data is written, moved or deleted.
--
-- definer-anon-exempt: growth_public_form returns only the name, fields and thank-you text of ACTIVE forms (the content a visitor is shown); no tenant, pipeline, alert address or author column is ever returned.

-- ── 1. Public read: one narrow function, no table access ────────────────────────────────────────
DROP POLICY IF EXISTS growth_forms_public_read_published ON public.growth_forms;
REVOKE ALL ON public.growth_forms FROM anon;

CREATE OR REPLACE FUNCTION public.growth_public_form(
  p_form_id   uuid DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL,
  p_slug      text DEFAULT NULL
)
RETURNS TABLE (id uuid, slug text, name text, schema_json jsonb, success_action_json jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.id, f.slug, f.name, f.schema_json, f.success_action_json
    FROM public.growth_forms f
   WHERE f.status = 'active'
     AND (
          (p_form_id IS NOT NULL AND f.id = p_form_id)
       OR (p_form_id IS NULL AND p_tenant_id IS NOT NULL AND p_slug IS NOT NULL
           AND f.tenant_id = p_tenant_id AND f.slug = p_slug)
     )
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.growth_public_form(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.growth_public_form(uuid, uuid, text) TO anon, authenticated, service_role;

-- ── 2. Submissions: no direct writes from the browser ──────────────────────────────────────────
DROP POLICY IF EXISTS growth_form_submissions_public_insert ON public.growth_form_submissions;
REVOKE ALL ON public.growth_form_submissions FROM anon;
REVOKE INSERT ON public.growth_form_submissions FROM authenticated;

-- ── 3. Intake settings columns ─────────────────────────────────────────────────────────────────
ALTER TABLE public.growth_forms
  ADD COLUMN IF NOT EXISTS notify_email text;

ALTER TABLE public.growth_forms
  DROP CONSTRAINT IF EXISTS growth_forms_notify_email_chk;
ALTER TABLE public.growth_forms
  ADD CONSTRAINT growth_forms_notify_email_chk
  CHECK (notify_email IS NULL OR (length(notify_email) <= 254 AND notify_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

COMMENT ON COLUMN public.growth_forms.notify_email IS
  'Address the owning workspace chose to be emailed on each submission. Set through growth_form_set_intake(); never read by the public.';

ALTER TABLE public.growth_form_submissions
  ADD COLUMN IF NOT EXISTS alert_sent_at timestamptz;

COMMENT ON COLUMN public.growth_form_submissions.alert_sent_at IS
  'When the form''s submission alert email was accepted by the provider; set once so a retried submission never emails twice.';

-- ── 4. The one write seam for a form's intake settings ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.growth_form_set_intake(
  p_form_id          uuid,
  p_auto_create_deal boolean,
  p_pipeline_id      uuid DEFAULT NULL,
  p_stage_id         uuid DEFAULT NULL,
  p_notify_email     text DEFAULT NULL
)
RETURNS public.growth_forms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _form   public.growth_forms;
  _email  text := NULLIF(btrim(COALESCE(p_notify_email, '')), '');
  _row    public.growth_forms;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'GROWTH_FORBIDDEN: sign in to change a form' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _form FROM public.growth_forms WHERE id = p_form_id;
  IF _form.id IS NULL THEN
    RAISE EXCEPTION 'GROWTH_NOT_FOUND: form not found' USING ERRCODE = 'P0002';
  END IF;

  -- §9/§59: authority comes from membership in the FORM'S OWN business, never a global role.
  IF NOT public.is_tenant_admin(_form.tenant_id) THEN
    RAISE EXCEPTION 'GROWTH_FORBIDDEN: only an owner or admin of this business can change its forms'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(p_auto_create_deal, false) THEN
    IF p_pipeline_id IS NULL THEN
      RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: choose the pipeline new leads go into' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = p_pipeline_id AND p.tenant_id = _form.tenant_id) THEN
      RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: that pipeline is not in this business' USING ERRCODE = '22023';
    END IF;
    IF p_stage_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.pipeline_stages s WHERE s.id = p_stage_id AND s.pipeline_id = p_pipeline_id
    ) THEN
      RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: that stage is not in the chosen pipeline' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _email IS NOT NULL AND (length(_email) > 254 OR _email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN
    RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: that alert address is not a valid email' USING ERRCODE = '22023';
  END IF;

  UPDATE public.growth_forms SET
    auto_create_deal = COALESCE(p_auto_create_deal, false),
    pipeline_id      = CASE WHEN COALESCE(p_auto_create_deal, false) THEN p_pipeline_id ELSE pipeline_id END,
    stage_id         = CASE WHEN COALESCE(p_auto_create_deal, false) THEN p_stage_id ELSE stage_id END,
    notify_email     = _email
  WHERE id = _form.id
  RETURNING * INTO _row;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'growth_forms', 'growth_form_set_intake', _row.id,
          jsonb_build_object('tenant_id', _row.tenant_id,
                             'auto_create_deal', _row.auto_create_deal,
                             'pipeline_id', _row.pipeline_id,
                             'stage_id', _row.stage_id,
                             'notify_email_set', _row.notify_email IS NOT NULL));

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.growth_form_set_intake(uuid, boolean, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.growth_form_set_intake(uuid, boolean, uuid, uuid, text) TO authenticated, service_role;
