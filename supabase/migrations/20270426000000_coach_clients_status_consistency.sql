-- S11: bring six coach_clients-dependent policies into line with the other 24,
-- which only honour an assignment whose status is 'active'.
--
-- Scope is exactly these six policies. Each is ALTERed in place, so role and command
-- are untouched; the only change to each predicate is the added status = 'active'
-- condition on its coach_clients lookup. Every other branch of each predicate is
-- carried over verbatim from the current production definition.
--
-- Prerequisite for S2: once every reader honours status, S2's lifecycle trigger can
-- deactivate an assignment instead of deleting it.

-- Step 0: abort if the starting state is not the one this migration was written against.
DO $$
DECLARE
  _expected constant text[][] := ARRAY[
    ARRAY['client_goals',                 'Admins update all goals, coaches update assigned',       'w'],
    ARRAY['client_goals',                 'Admins view all goals, coaches view assigned',           'r'],
    ARRAY['credit_predictions',           'Admins view all predictions, coaches view assigned',     'r'],
    ARRAY['funding_application_outcomes', 'Admins insert any outcomes, coaches insert for assigned','a'],
    ARRAY['funding_application_outcomes', 'Admins view all outcomes, coaches view assigned',        'r'],
    ARRAY['outreach_drafts',              'Coaches manage assigned client outreach drafts',         '*']
  ];
  _i int;
  _cmd "char";
  _expr text;
BEGIN
  FOR _i IN 1 .. array_length(_expected, 1) LOOP
    SELECT p.polcmd,
           coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
      INTO _cmd, _expr
      FROM pg_policy p
     WHERE p.polrelid = ('public.' || _expected[_i][1])::regclass
       AND p.polname  = _expected[_i][2];
    IF NOT FOUND THEN
      RAISE EXCEPTION 'S11 precondition: policy "%" on % not found', _expected[_i][2], _expected[_i][1];
    END IF;
    IF _cmd::text <> _expected[_i][3] THEN
      RAISE EXCEPTION 'S11 precondition: policy "%" on % has command %, expected %',
        _expected[_i][2], _expected[_i][1], _cmd, _expected[_i][3];
    END IF;
    IF _expr NOT ILIKE '%coach_clients%' THEN
      RAISE EXCEPTION 'S11 precondition: policy "%" on % no longer references coach_clients',
        _expected[_i][2], _expected[_i][1];
    END IF;
    IF _expr ILIKE '%status%' THEN
      RAISE EXCEPTION 'S11 precondition: policy "%" on % already filters on status; re-derive this migration',
        _expected[_i][2], _expected[_i][1];
    END IF;
  END LOOP;
END $$;

ALTER POLICY "Admins update all goals, coaches update assigned" ON public.client_goals
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'coach'::app_role) AND EXISTS (
      SELECT 1 FROM public.coach_clients cc
       WHERE cc.coach_user_id = auth.uid()
         AND cc.client_user_id = client_goals.user_id
         AND cc.status = 'active'::text))
  );

ALTER POLICY "Admins view all goals, coaches view assigned" ON public.client_goals
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'coach'::app_role) AND EXISTS (
      SELECT 1 FROM public.coach_clients cc
       WHERE cc.coach_user_id = auth.uid()
         AND cc.client_user_id = client_goals.user_id
         AND cc.status = 'active'::text))
  );

ALTER POLICY "Admins view all predictions, coaches view assigned" ON public.credit_predictions
  USING (
    tenant_staff_owns_user(auth.uid(), user_id)
    OR (has_role(auth.uid(), 'coach'::app_role) AND EXISTS (
      SELECT 1 FROM public.coach_clients cc
       WHERE cc.coach_user_id = auth.uid()
         AND cc.client_user_id = credit_predictions.user_id
         AND cc.status = 'active'::text))
  );

ALTER POLICY "Admins insert any outcomes, coaches insert for assigned" ON public.funding_application_outcomes
  WITH CHECK (
    tenant_staff_owns_user(auth.uid(), user_id)
    OR (has_role(auth.uid(), 'coach'::app_role) AND EXISTS (
      SELECT 1 FROM public.coach_clients cc
       WHERE cc.coach_user_id = auth.uid()
         AND cc.client_user_id = funding_application_outcomes.user_id
         AND cc.status = 'active'::text))
  );

ALTER POLICY "Admins view all outcomes, coaches view assigned" ON public.funding_application_outcomes
  USING (
    tenant_staff_owns_user(auth.uid(), user_id)
    OR (has_role(auth.uid(), 'coach'::app_role) AND EXISTS (
      SELECT 1 FROM public.coach_clients cc
       WHERE cc.coach_user_id = auth.uid()
         AND cc.client_user_id = funding_application_outcomes.user_id
         AND cc.status = 'active'::text))
  );

ALTER POLICY "Coaches manage assigned client outreach drafts" ON public.outreach_drafts
  USING (
    has_role(auth.uid(), 'coach'::app_role) AND EXISTS (
      SELECT 1 FROM public.coach_clients cc
       WHERE cc.coach_user_id = auth.uid()
         AND cc.client_user_id = outreach_drafts.client_user_id
         AND cc.status = 'active'::text)
  )
  WITH CHECK (
    has_role(auth.uid(), 'coach'::app_role) AND EXISTS (
      SELECT 1 FROM public.coach_clients cc
       WHERE cc.coach_user_id = auth.uid()
         AND cc.client_user_id = outreach_drafts.client_user_id
         AND cc.status = 'active'::text)
  );
