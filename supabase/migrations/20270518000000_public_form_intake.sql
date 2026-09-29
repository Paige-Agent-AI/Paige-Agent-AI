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
--      Routing is written where the submission processor reads it (columns, or the form's ledgered
--      automation rows when it has them), so a saved setting always takes effect.
--   5. ADDS a guard so notify_email cannot be written directly from the browser — only through (4).
--
-- REVERSIBILITY: every step is reversible — drop the guard trigger and the three functions, drop the
-- two columns, re-create the two deleted policies and re-grant the revoked privileges (their
-- definitions are in 20260630004505 / 20260702022450). The migration writes, moves and deletes no data.
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
  CHECK (notify_email IS NULL OR (length(notify_email) <= 254 AND notify_email ~* '^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$'));

COMMENT ON COLUMN public.growth_forms.notify_email IS
  'Address the owning workspace chose to be emailed on each submission. Set only through growth_form_set_intake() (an owner/admin, audited); never read by the public.';

-- Leads' details are emailed to this address, so it changes only through the audited owner/admin
-- seam. growth_forms_tenant_manage lets any member of the business update the row, which would let a
-- member point every future lead at themselves and keep receiving them after they leave; a direct
-- browser write (role authenticated/anon) of this one column is refused. The seam runs as its
-- definer, and service/migration contexts are trusted, so neither is affected.
CREATE OR REPLACE FUNCTION public.growth_forms_guard_notify_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND (
       (TG_OP = 'INSERT' AND NEW.notify_email IS NOT NULL)
    OR (TG_OP = 'UPDATE' AND NEW.notify_email IS DISTINCT FROM OLD.notify_email)) THEN
    RAISE EXCEPTION 'GROWTH_FORBIDDEN: an owner or admin sets the alert address through growth_form_set_intake'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.growth_forms_guard_notify_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_growth_forms_guard_notify_email ON public.growth_forms;
CREATE TRIGGER trg_growth_forms_guard_notify_email
  BEFORE INSERT OR UPDATE OF notify_email ON public.growth_forms
  FOR EACH ROW EXECUTE FUNCTION public.growth_forms_guard_notify_email();

ALTER TABLE public.growth_form_submissions
  ADD COLUMN IF NOT EXISTS alert_sent_at timestamptz;

COMMENT ON COLUMN public.growth_form_submissions.alert_sent_at IS
  'When the form''s submission alert email was accepted by the provider; set once so a retried submission never emails twice.';

-- ── 4. The one write seam for a form's intake settings ─────────────────────────────────────────
-- Sets the whole intake in one call: p_notify_email NULL (or blank) clears the alert address.
-- Routing is written where growth-process-submission reads it, so each form has exactly one route:
-- a form with no automation rows runs from its columns; a form with rows runs from its ledgered
-- contact_upsert (order 10) and pipeline_attach (order 20) rows, which are synced here too. A deal
-- always has a contact ahead of it, so turning deals on turns contact creation on.
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

  IF _email IS NOT NULL AND (length(_email) > 254 OR _email !~* '^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$') THEN
    RAISE EXCEPTION 'GROWTH_INVALID_INTAKE: that alert address is not a valid email' USING ERRCODE = '22023';
  END IF;

  UPDATE public.growth_forms SET
    auto_create_contact = auto_create_contact OR COALESCE(p_auto_create_deal, false),
    auto_create_deal = COALESCE(p_auto_create_deal, false),
    pipeline_id      = CASE WHEN COALESCE(p_auto_create_deal, false) THEN p_pipeline_id ELSE pipeline_id END,
    stage_id         = CASE WHEN COALESCE(p_auto_create_deal, false) THEN p_stage_id ELSE stage_id END,
    notify_email     = _email
  WHERE id = _form.id
  RETURNING * INTO _row;

  IF EXISTS (SELECT 1 FROM public.growth_form_automations a WHERE a.form_id = _form.id) THEN
    IF _row.auto_create_deal THEN
      INSERT INTO public.growth_form_automations (tenant_id, form_id, target_slug, order_index, enabled, config_json, created_by)
      VALUES (_form.tenant_id, _form.id, 'contact_upsert', 10, true, '{}'::jsonb, _caller)
      ON CONFLICT (form_id, target_slug) DO UPDATE SET enabled = true, updated_at = now();

      INSERT INTO public.growth_form_automations (tenant_id, form_id, target_slug, order_index, enabled, config_json, created_by)
      VALUES (_form.tenant_id, _form.id, 'pipeline_attach', 20, true,
              jsonb_strip_nulls(jsonb_build_object('pipeline_id', _row.pipeline_id, 'stage_id', _row.stage_id)), _caller)
      ON CONFLICT (form_id, target_slug) DO UPDATE SET
        enabled     = true,
        config_json = (public.growth_form_automations.config_json - 'pipeline_id' - 'stage_id') || EXCLUDED.config_json,
        updated_at  = now();
    ELSE
      UPDATE public.growth_form_automations SET enabled = false, updated_at = now()
      WHERE form_id = _form.id AND target_slug = 'pipeline_attach';
    END IF;
  END IF;

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

-- Callable by a signed-in owner/admin only: authority is re-derived from auth.uid() in the body, so
-- a service-role call (no user) would be refused anyway and is not granted.
REVOKE ALL ON FUNCTION public.growth_form_set_intake(uuid, boolean, uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.growth_form_set_intake(uuid, boolean, uuid, uuid, text) TO authenticated;
