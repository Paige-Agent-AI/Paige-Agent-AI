-- Public form intake (20270518000000_public_form_intake.sql), proven on the replayed schema.
--
-- House pgTAP style: synthetic fixtures only, always rolled back. Two businesses, each with an
-- owner; business A has an active form, a draft form and a pipeline, business B has a pipeline.
-- What must be true, for every business:
--   * a visitor reads an ACTIVE form only through growth_public_form(), which never returns the
--     business, pipeline, alert address or author — and the table itself refuses them;
--   * nobody writes a submission from the browser: anon and signed-in inserts are both refused;
--   * a form's intake settings change only for an owner/admin of the form's OWN business, only to
--     that business's pipeline and stage, and only to a well-formed alert address — and the alert
--     address cannot be written around that seam;
--   * a saved route takes effect: on a form that runs from automation rows, the rows follow it.
BEGIN;

SELECT plan(20);

DO $$
DECLARE
  _a uuid := 'f1a70000-0000-0000-0000-00000000000a';
  _b uuid := 'f1a70000-0000-0000-0000-00000000000b';
  _oa uuid := 'f1a70000-0000-0000-0000-0000000000a1';
  _ob uuid := 'f1a70000-0000-0000-0000-0000000000b1';
  _pa uuid; _pb uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_oa, 'intake-owner-a@example.test'), (_ob, 'intake-owner-b@example.test');
  INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
    (_a, 'intake-probe-a', 'Intake Probe A', 'active', 'standalone', 'IPA', '{}'),
    (_b, 'intake-probe-b', 'Intake Probe B', 'active', 'standalone', 'IPB', '{}');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
    (_a, _oa, 'owner', 'active', true),
    (_b, _ob, 'owner', 'active', true);
  INSERT INTO public.profiles (user_id, active_tenant_id) VALUES (_oa, _a), (_ob, _b)
  ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

  PERFORM set_config('app.pipeline_created_through', 'paige', true);
  PERFORM set_config('app.pipeline_requested_by', _oa::text, true);
  INSERT INTO public.pipelines (tenant_id, name, is_default) VALUES (_a, 'Intake A', true) RETURNING id INTO _pa;
  PERFORM set_config('app.pipeline_requested_by', _ob::text, true);
  INSERT INTO public.pipelines (tenant_id, name, is_default) VALUES (_b, 'Intake B', true) RETURNING id INTO _pb;
  PERFORM set_config('intake.pa', _pa::text, true);
  PERFORM set_config('intake.pb', _pb::text, true);
  INSERT INTO public.pipeline_stages (id, pipeline_id, tenant_id, label, order_index, probability, stage_type) VALUES
    ('f1a70000-0000-0000-0000-00000000a5a1', _pa, _a, 'Intake', 1, 10, 'open'),
    ('f1a70000-0000-0000-0000-00000000b5b1', _pb, _b, 'Intake', 1, 10, 'open');

  INSERT INTO public.growth_forms (id, tenant_id, slug, name, status, schema_json, success_action_json, created_by) VALUES
    ('f1a70000-0000-0000-0000-0000000f0a01', _a, 'contact', 'Contact A', 'active',
     '{"sections":[{"fields":[{"key":"email","type":"email","label":"Email","required":true}]}]}',
     '{"type":"thank_you","message":"Thanks"}', _oa),
    ('f1a70000-0000-0000-0000-0000000f0a02', _a, 'draft-form', 'Draft A', 'draft',
     '{"sections":[]}', '{}', _oa),
    ('f1a70000-0000-0000-0000-0000000f0a03', _a, 'routed', 'Routed A', 'active',
     '{"sections":[]}', '{}', _oa);
  -- A form that runs from automation rows (the 2026-07-14 backfill shape): contact creation off,
  -- deals on into pipeline A with no stage.
  INSERT INTO public.growth_form_automations (tenant_id, form_id, target_slug, order_index, enabled, config_json) VALUES
    (_a, 'f1a70000-0000-0000-0000-0000000f0a03', 'contact_upsert', 10, false, '{}'),
    (_a, 'f1a70000-0000-0000-0000-0000000f0a03', 'pipeline_attach', 20, true, jsonb_build_object('pipeline_id', _pa));
END $$;

-- ── A visitor reads an active form only through the narrow function ────────────────────────────
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ SELECT id FROM public.growth_forms LIMIT 1 $$,
  '42501', NULL,
  'a visitor cannot read the growth_forms table at all');
SELECT is(
  (SELECT name FROM public.growth_public_form(p_form_id => 'f1a70000-0000-0000-0000-0000000f0a01')),
  'Contact A',
  'a visitor reads an active form by id');
SELECT is(
  (SELECT name FROM public.growth_public_form(p_tenant_id => 'f1a70000-0000-0000-0000-00000000000a', p_slug => 'contact')),
  'Contact A',
  'a visitor reads an active form by business and slug');
SELECT is(
  (SELECT count(*)::int FROM public.growth_public_form(p_form_id => 'f1a70000-0000-0000-0000-0000000f0a02')),
  0,
  'a draft form is not readable');
RESET ROLE;

SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
     FROM pg_proc p
     CROSS JOIN LATERAL unnest(p.proargnames, p.proargmodes) AS a(attname, mode)
    WHERE p.oid = 'public.growth_public_form(uuid,uuid,text)'::regprocedure AND a.mode = 't'),
  ARRAY['id','name','schema_json','slug','success_action_json'],
  'the public read returns only id, slug, name, fields and thank-you — no business, pipeline, alert address or author');

-- ── Nobody writes a submission from the browser ────────────────────────────────────────────────
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$ INSERT INTO public.growth_form_submissions (form_id, tenant_id, payload_json)
     VALUES ('f1a70000-0000-0000-0000-0000000f0a01', 'f1a70000-0000-0000-0000-00000000000a', '{"email":"v@example.test"}') $$,
  '42501', NULL,
  'a visitor cannot insert a submission directly');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"f1a70000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ INSERT INTO public.growth_form_submissions (form_id, tenant_id, payload_json)
     VALUES ('f1a70000-0000-0000-0000-0000000f0a01', 'f1a70000-0000-0000-0000-00000000000a', '{"email":"v@example.test"}') $$,
  '42501', NULL,
  'even the business''s own owner cannot insert a submission from the browser');
RESET ROLE;

-- ── Intake settings: only the form's own business, its own pipeline, a real address ───────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.growth_form_set_intake(uuid,boolean,uuid,uuid,text)', 'EXECUTE'),
  'a visitor cannot call growth_form_set_intake');

SELECT set_config('request.jwt.claims', '{"sub":"f1a70000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ SELECT public.growth_form_set_intake('f1a70000-0000-0000-0000-0000000f0a01', false, NULL, NULL, 'b@example.test') $$,
  '42501', NULL,
  'another business''s owner cannot change this business''s form');
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"f1a70000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format($$ SELECT public.growth_form_set_intake('f1a70000-0000-0000-0000-0000000f0a01', true, %L::uuid, NULL, NULL) $$,
         current_setting('intake.pb')),
  '22023', NULL,
  'a lead cannot be routed into another business''s pipeline');
SELECT throws_ok(
  format($$ SELECT public.growth_form_set_intake('f1a70000-0000-0000-0000-0000000f0a01', true, %L::uuid, 'f1a70000-0000-0000-0000-00000000b5b1', NULL) $$,
         current_setting('intake.pa')),
  '22023', NULL,
  'a stage from another pipeline is refused');
SELECT throws_ok(
  $$ SELECT public.growth_form_set_intake('f1a70000-0000-0000-0000-0000000f0a01', false, NULL, NULL, 'not-an-address') $$,
  '22023', NULL,
  'a malformed alert address is refused');
SELECT lives_ok(
  format($$ SELECT public.growth_form_set_intake('f1a70000-0000-0000-0000-0000000f0a01', true, %L::uuid, 'f1a70000-0000-0000-0000-00000000a5a1', 'Leads@Example.test') $$,
         current_setting('intake.pa')),
  'the business''s owner routes leads into their own pipeline and sets an alert address');

SELECT lives_ok(
  $$ UPDATE public.growth_forms SET name = 'Contact A (renamed)' WHERE id = 'f1a70000-0000-0000-0000-0000000f0a01' $$,
  'control: the owner can edit the form row directly');
SELECT throws_ok(
  $$ UPDATE public.growth_forms SET notify_email = 'someone-else@example.test' WHERE id = 'f1a70000-0000-0000-0000-0000000f0a01' $$,
  '42501', NULL,
  'but the alert address cannot be changed around growth_form_set_intake');

SELECT lives_ok(
  $$ SELECT public.growth_form_set_intake('f1a70000-0000-0000-0000-0000000f0a03', false, NULL, NULL, NULL) $$,
  'the owner turns deals off on a form that runs from automation rows');
RESET ROLE;

SELECT is(
  (SELECT enabled FROM public.growth_form_automations
    WHERE form_id = 'f1a70000-0000-0000-0000-0000000f0a03' AND target_slug = 'pipeline_attach'),
  false,
  'turning deals off disables the form''s pipeline row, so no deal is created');

SELECT set_config('request.jwt.claims', '{"sub":"f1a70000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok(
  format($$ SELECT public.growth_form_set_intake('f1a70000-0000-0000-0000-0000000f0a03', true, %L::uuid, 'f1a70000-0000-0000-0000-00000000a5a1', NULL) $$,
         current_setting('intake.pa')),
  'the owner turns deals back on, into a chosen stage');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT results_eq(
  $$ SELECT auto_create_contact, auto_create_deal, pipeline_id::text, stage_id::text, notify_email
       FROM public.growth_forms WHERE id = 'f1a70000-0000-0000-0000-0000000f0a01' $$,
  format($$ VALUES (true, true, %L::text, 'f1a70000-0000-0000-0000-00000000a5a1'::text, 'Leads@Example.test'::text) $$,
         current_setting('intake.pa')),
  'the settings are stored on the form, and the direct write changed nothing');

SELECT results_eq(
  $$ SELECT target_slug, enabled, config_json->>'pipeline_id', config_json->>'stage_id'
       FROM public.growth_form_automations
      WHERE form_id = 'f1a70000-0000-0000-0000-0000000f0a03' ORDER BY order_index $$,
  format($$ VALUES ('contact_upsert'::text, true, NULL::text, NULL::text),
                   ('pipeline_attach'::text, true, %L::text, 'f1a70000-0000-0000-0000-00000000a5a1'::text) $$,
         current_setting('intake.pa')),
  'the rows follow the saved route: a contact first, then the deal into the chosen stage');

SELECT * FROM finish();
ROLLBACK;
