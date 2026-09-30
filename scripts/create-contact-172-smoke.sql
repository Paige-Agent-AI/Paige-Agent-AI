-- =============================================================================
-- #172 smoke — create_contact lifecycle_stage default fix ('lead' -> 'new_lead')
-- =============================================================================
-- Run against the schema in a rollback transaction. NOTHING persists.
--   PROOF 1: inserting lifecycle_stage='lead' -> SQLSTATE 23514 (the bug).
--   PROOF 2: inserting lifecycle_stage='new_lead' -> succeeds (the fix target).
--   PROOF 3: the corrected create_contact() body, called with lifecycle omitted,
--            no longer 23514s (its fallback now yields 'new_lead').
--
-- Usage (psql):  psql "$DATABASE_URL" -f scripts/create-contact-172-smoke.sql
-- The final RAISE aborts the transaction, so the temp function/row never commit.
-- =============================================================================

-- ---- PROOF 1 + 2: the constraint, isolated (no FK/trigger noise) -------------
DO $smoke$
DECLARE
  _lead_state    text := 'NO_ERROR (UNEXPECTED)';
  _newlead_state text := 'OK';
BEGIN
  -- Replica of the two live CHECK constraints on public.clients.lifecycle_stage
  -- (clients_lifecycle_stage_chk is the strict one added by 1c_viii_a that rejects 'lead').
  CREATE TEMP TABLE _s172 (
    ls text NOT NULL,
    CONSTRAINT chk_strict CHECK (ls = ANY (ARRAY[
      'new_lead','qualified','nurturing','hot_lead','negotiating','won',
      'client_active','client_paused','client_churned','client_funded','client_alumni'])),
    CONSTRAINT chk_broad CHECK (ls IS NULL OR ls = ANY (ARRAY[
      'lead','new_lead','qualified','nurturing','hot_lead','negotiating','won',
      'client_active','client_paused','client_churned','client_funded','client_alumni',
      'customer','prospect','active','inactive','churned']))
  ) ON COMMIT DROP;

  BEGIN
    INSERT INTO _s172(ls) VALUES ('lead');           -- the bug
    _lead_state := 'UNEXPECTED_SUCCESS';
  EXCEPTION WHEN check_violation THEN
    _lead_state := SQLSTATE;                          -- expect 23514
  END;

  BEGIN
    INSERT INTO _s172(ls) VALUES ('new_lead');        -- the fix target
  EXCEPTION WHEN check_violation THEN
    _newlead_state := SQLSTATE;
  END;

  RAISE NOTICE '[#172] constraint proof: lead_insert=%  new_lead_insert=%', _lead_state, _newlead_state;
END
$smoke$;

-- ---- PROOF 3: the corrected function end-to-end, rolled back -----------------
BEGIN;

-- Apply the fix (migration 20260730170000): only the two 'lead' literals become 'new_lead'. Same
-- 15-arg signature -> replaces in place. Since 20270519010000 a contact's addresses live only in
-- client_contact_methods, so this restatement dedupes on, and attaches, contact methods instead of
-- the retired clients.email / clients.phone columns; the lifecycle fallback it proves is unchanged.
CREATE OR REPLACE FUNCTION public.create_contact(
  p_first_name text,
  p_last_name  text DEFAULT NULL,
  p_email      text DEFAULT NULL,
  p_phone      text DEFAULT NULL,
  p_entity_name text DEFAULT NULL,
  p_title      text DEFAULT NULL,
  p_lifecycle_stage text DEFAULT 'new_lead',
  p_source     text DEFAULT 'paige',
  p_tags       text[] DEFAULT '{}',
  p_primary_offer text DEFAULT NULL,
  p_notes      text DEFAULT NULL,
  p_assigned_coach_user_id uuid DEFAULT NULL,
  p_tenant_id  uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_channel    text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _caller  uuid := auth.uid();
  _creator uuid := COALESCE(auth.uid(), p_created_by);
  _tenant  uuid := COALESCE(p_tenant_id, public.current_user_tenant_id());
  _id uuid;
  _existing uuid;
  _email text := NULLIF(btrim(p_email), '');
BEGIN
  IF _creator IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_OPERATOR: an operator context is required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_any_role(_creator, ARRAY['admin','super_admin','coach']) THEN
    RAISE EXCEPTION 'CONTACT_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
  END IF;
  IF _email IS NOT NULL THEN
    SELECT c.id INTO _existing
      FROM public.client_contact_methods AS m
      JOIN public.clients AS c ON c.id = m.client_id
     WHERE c.created_by = _creator AND m.kind = 'email'
       AND m.match_key = public.contact_method_match_key('email', _email)
     LIMIT 1;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  END IF;
  INSERT INTO public.clients (
    first_name, last_name, entity_name, title,
    lifecycle_stage, source, tags, primary_offer, current_notes,
    assigned_coach_user_id, status, created_by, tenant_id, created_by_channel_type
  ) VALUES (
    COALESCE(NULLIF(btrim(p_first_name), ''), NULLIF(split_part(COALESCE(_email,''), '@', 1), ''), 'New'),
    COALESCE(NULLIF(btrim(p_last_name), ''), 'Contact'),
    NULLIF(btrim(p_entity_name), ''), NULLIF(btrim(p_title), ''),
    COALESCE(NULLIF(p_lifecycle_stage, ''), 'new_lead'), COALESCE(NULLIF(p_source, ''), 'paige'),
    COALESCE(p_tags, '{}'), NULLIF(btrim(p_primary_offer), ''), NULLIF(btrim(p_notes), ''),
    p_assigned_coach_user_id, 'active', _creator, _tenant, NULLIF(btrim(p_channel), '')
  )
  RETURNING id INTO _id;
  PERFORM public._attach_client_address(_tenant, _id, 'email', _email);
  PERFORM public._attach_client_address(_tenant, _id, 'phone', p_phone);
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_creator, 'client', 'create_contact', _id,
          jsonb_build_object('tenant_id', _tenant, 'email', _email, 'source', p_source, 'channel', p_channel));
  RETURN _id;
END;
$fn$;

-- Call it with lifecycle omitted (fallback path) as the service-role/edge shape
-- (auth.uid() null, verified operator via p_created_by). Pre-fix this raised 23514.
DO $call$
DECLARE _id uuid; _t uuid; _u uuid;
BEGIN
  SELECT id INTO _t FROM public.tenants LIMIT 1;
  SELECT user_id INTO _u FROM public.user_roles
    WHERE role IN ('admin','super_admin','coach') LIMIT 1;
  _id := public.create_contact(
    p_first_name := 'Smoke172',
    p_email := 'smoke172+' || gen_random_uuid()::text || '@example.test',
    p_tenant_id := _t,
    p_created_by := _u
  );
  RAISE EXCEPTION 'SMOKE172_OK create_contact returned contact_id=% (no 23514; lifecycle defaulted to new_lead)', _id;
END
$call$;

ROLLBACK;
