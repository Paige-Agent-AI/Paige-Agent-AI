-- Vibe Studio publish lifecycle (20270537000000). One publish rule for everything Vibe Studio
-- makes: new work starts unpublished, Publish and Unpublish are the only ways across, a page or
-- funnel publishes what it needs, and only the workspace's owner or admin does any of it.
--
-- Migration G (20270554000000): the eight publish/unpublish functions run only for the server —
-- the publish door, growth-publish-command, on its service-role client, naming the workspace it
-- resolved and the signed-in person it verified. Every publish and unpublish below runs that way
-- (pg_temp.door); who may publish is the person check inside the functions (_studio_publish_actor).
-- Synthetic fixtures; always rolled back.
BEGIN;
SELECT plan(72);

-- Owner of the studio workspace; a plain member of it who also owns another workspace and holds a
-- GLOBAL admin role (§59: neither makes them an admin here); and the owner of a second workspace.
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('5d5d0000-0000-4000-8000-000000000001','authenticated','authenticated','vs-owner@tests.invalid'),
  ('5d5d0000-0000-4000-8000-000000000002','authenticated','authenticated','vs-member@tests.invalid'),
  ('5d5d0000-0000-4000-8000-000000000003','authenticated','authenticated','vs-other-owner@tests.invalid');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('5d5d0000-0000-4000-8000-000000000001','admin'),
  ('5d5d0000-0000-4000-8000-000000000002','admin'),
  ('5d5d0000-0000-4000-8000-000000000003','admin')
ON CONFLICT DO NOTHING;
SELECT set_config('request.jwt.claims','',true);

INSERT INTO public.tenants (id, slug, name, status, account_type, features, brand) VALUES
  ('5d5d0000-0000-4000-8000-00000000a001','vs-studio','Studio Workspace','active','standalone','{}'::jsonb,'{}'::jsonb),
  ('5d5d0000-0000-4000-8000-00000000a002','vs-other','Other Workspace','active','standalone','{}'::jsonb,'{}'::jsonb),
  ('5d5d0000-0000-4000-8000-00000000a003','vs-member-own','Member''s Own','active','standalone','{}'::jsonb,'{}'::jsonb);
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('5d5d0000-0000-4000-8000-00000000a001','5d5d0000-0000-4000-8000-000000000001','owner','active',true,now()),
  ('5d5d0000-0000-4000-8000-00000000a001','5d5d0000-0000-4000-8000-000000000002','member','active',false,now()),
  ('5d5d0000-0000-4000-8000-00000000a003','5d5d0000-0000-4000-8000-000000000002','owner','active',true,now()),
  ('5d5d0000-0000-4000-8000-00000000a002','5d5d0000-0000-4000-8000-000000000003','owner','active',true,now());
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('5d5d0000-0000-4000-8000-000000000001','5d5d0000-0000-4000-8000-00000000a001'),
  ('5d5d0000-0000-4000-8000-000000000002','5d5d0000-0000-4000-8000-00000000a001'),
  ('5d5d0000-0000-4000-8000-000000000003','5d5d0000-0000-4000-8000-00000000a002')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
INSERT INTO public.marketing_content (id, tenant_id, kind, title, image_url, status) VALUES
  ('5d5d0000-0000-4000-8000-00000000c001','5d5d0000-0000-4000-8000-00000000a001','image','Workshop banner','https://img.tests.invalid/a.png','draft'),
  ('5d5d0000-0000-4000-8000-00000000c002','5d5d0000-0000-4000-8000-00000000a001','text','A caption',NULL,'draft');

CREATE FUNCTION pg_temp.as_caller(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
END $$;
CREATE TABLE pg_temp.ids (k text PRIMARY KEY, id uuid);
GRANT ALL ON pg_temp.ids TO authenticated, anon, service_role;

-- Run one of the eight the way the publish door does (Migration G): the service role, the workspace
-- named explicitly, and the person who asked. The caller's role and JWT claims are restored after a
-- normal return; a throw rolls the enclosing pgTAP subtransaction back, which restores them too.
CREATE FUNCTION pg_temp.door(_fn text, _id uuid, _actor uuid,
                             _tenant uuid DEFAULT '5d5d0000-0000-4000-8000-00000000a001') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  _role   text := current_user;
  _claims text := current_setting('request.jwt.claims', true);
  _r      jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  EXECUTE 'SET LOCAL ROLE service_role';
  EXECUTE format('SELECT public.%I(p_tenant_id => $1, p_id => $2, p_actor_id => $3)', _fn)
    INTO _r USING _tenant, _id, _actor;
  EXECUTE format('SET LOCAL ROLE %I', _role);
  PERFORM set_config('request.jwt.claims', coalesce(_claims, ''), true);
  RETURN _r;
END $$;
CREATE TABLE pg_temp.eight (fn text PRIMARY KEY);
INSERT INTO pg_temp.eight VALUES ('growth_page_publish'), ('growth_page_unpublish'), ('growth_form_publish'),
  ('growth_form_unpublish'), ('growth_funnel_publish'), ('growth_funnel_unpublish'), ('studio_image_publish'),
  ('studio_image_unpublish');

-- ── Who may call what ──
SELECT ok(NOT has_function_privilege('anon', 'public.list_artifact_versions(uuid,text,uuid,uuid)', 'EXECUTE'),
  'a signed-out visitor cannot read version history');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_temp.eight
                       WHERE has_function_privilege('anon', format('public.%s(uuid,uuid,uuid)', fn), 'EXECUTE')),
  'a signed-out visitor cannot run any of the eight publish/unpublish functions');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_temp.eight
                       WHERE has_function_privilege('authenticated', format('public.%s(uuid,uuid,uuid)', fn), 'EXECUTE')),
  'a signed-in user cannot run any of them directly either (Migration G: only the publish door)');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_temp.eight
                       WHERE NOT has_function_privilege('service_role', format('public.%s(uuid,uuid,uuid)', fn), 'EXECUTE')),
  'the server (service role) can run all eight');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_temp.eight WHERE to_regprocedure(format('public.%s(uuid,uuid)', fn)) IS NOT NULL),
  'the two-argument signatures are gone');
SELECT ok(NOT has_function_privilege('authenticated', 'public._growth_form_go_live(uuid,uuid)', 'EXECUTE'),
  'the internal go-live step is not callable directly');
SELECT ok(NOT has_function_privilege('service_role', 'public._growth_page_go_live(uuid,uuid)', 'EXECUTE'),
  'not even from a server session');

SET LOCAL ROLE authenticated;

SELECT pg_temp.as_caller('5d5d0000-0000-4000-8000-000000000002');
SELECT ok(NOT public.studio_role_ok('5d5d0000-0000-4000-8000-000000000002'),
  'a plain member does not get the studio by owning some other workspace');
SELECT pg_temp.as_caller('5d5d0000-0000-4000-8000-000000000001');
SELECT ok(public.studio_role_ok('5d5d0000-0000-4000-8000-000000000001'), 'the workspace owner does');
SELECT ok(NOT public.studio_role_ok('5d5d0000-0000-4000-8000-000000000002'), 'and cannot vouch for anyone else');
SELECT throws_ok($$SELECT public.growth_page_publish(NULL, '5d5d0000-0000-4000-8000-00000000ffff', NULL)$$,
  '42501', NULL, 'the owner''s own direct call (a browser console) is refused: publishing is the door only');

-- ── Forms: new work starts unpublished; edits to a live form wait for Publish ──
INSERT INTO pg_temp.ids SELECT 'form', (public.growth_form_upsert(NULL, 'discovery-call', 'Discovery call',
  '{"sections":[{"title":"","fields":[{"key":"full_name","label":"Your name","type":"text","required":true}]}]}'::jsonb)).id;
SELECT is((SELECT status FROM public.growth_forms WHERE id = (SELECT id FROM pg_temp.ids WHERE k='form')), 'draft',
  'a new form starts unpublished');
SELECT is((SELECT draft_schema_json = schema_json FROM public.growth_forms WHERE id = (SELECT id FROM pg_temp.ids WHERE k='form')), true,
  'an unpublished form''s working copy and live copy are the same');
SELECT is((SELECT count(*)::int FROM public.growth_public_form(p_form_id => (SELECT id FROM pg_temp.ids WHERE k='form'))), 0,
  'visitors cannot load an unpublished form');
SELECT is((pg_temp.door('growth_form_publish', (SELECT id FROM pg_temp.ids WHERE k='form'), '5d5d0000-0000-4000-8000-000000000001'))->>'status', 'active',
  'the owner publishes it');
SELECT isnt((SELECT published_at FROM public.growth_forms WHERE id = (SELECT id FROM pg_temp.ids WHERE k='form')), NULL,
  'and the publish time is recorded');
SELECT lives_ok($$SELECT public.growth_form_upsert(NULL, 'discovery-call', 'Discovery call',
  '{"sections":[{"title":"","fields":[{"key":"full_name","label":"Your name","type":"text","required":true},{"key":"budget","label":"Monthly budget","type":"text"}]}]}'::jsonb)$$,
  'the owner edits the live form');
SELECT is((SELECT jsonb_array_length(schema_json->'sections'->0->'fields') FROM public.growth_forms WHERE id = (SELECT id FROM pg_temp.ids WHERE k='form')), 1,
  'visitors still see the published questions');
SELECT is((SELECT jsonb_array_length(draft_schema_json->'sections'->0->'fields') FROM public.growth_forms WHERE id = (SELECT id FROM pg_temp.ids WHERE k='form')), 2,
  'the edit waits in the working copy');
SELECT lives_ok($$SELECT pg_temp.door('growth_form_publish', (SELECT id FROM pg_temp.ids WHERE k='form'), '5d5d0000-0000-4000-8000-000000000001')$$, 'publishing the changes');
SELECT is((SELECT jsonb_array_length(schema_json->'sections'->0->'fields') FROM public.growth_forms WHERE id = (SELECT id FROM pg_temp.ids WHERE k='form')), 2,
  'puts them live');

-- ── Publish state cannot be changed around the functions ──
SELECT throws_like($$UPDATE public.growth_forms SET status = 'draft' WHERE id = (SELECT id FROM pg_temp.ids WHERE k='form')$$,
  '%GROWTH_PUBLISH_STATE_GUARDED%', 'not even the owner can flip a form''s status directly');
SELECT throws_like($$UPDATE public.growth_forms SET draft_schema_json = '{"sections":[]}'::jsonb WHERE id = (SELECT id FROM pg_temp.ids WHERE k='form')$$,
  '%GROWTH_PUBLISH_STATE_GUARDED%', 'or rewrite its working copy around the functions');
SELECT throws_like($$INSERT INTO public.growth_forms (tenant_id, slug, name, status, schema_json) VALUES ('5d5d0000-0000-4000-8000-00000000a001','sneaky','Sneaky','draft','{"sections":[]}'::jsonb)$$,
  '%GROWTH_PUBLISH_STATE_GUARDED%', 'or create a form directly');
SELECT throws_ok($$SELECT public.growth_form_upsert(NULL, 'discovery-call-renamed', 'Discovery call',
  '{"sections":[{"title":"","fields":[{"key":"full_name","label":"Your name","type":"text","required":true}]}]}'::jsonb, NULL, true, NULL, NULL, (SELECT id FROM pg_temp.ids WHERE k='form'))$$,
  '22023', NULL, 'a live form''s address cannot change underneath the pages that embed it');

-- ── Pages publish the forms on them; unpublishing a page leaves its forms live ──
INSERT INTO pg_temp.ids SELECT 'page', (public.growth_page_upsert(NULL, 'spring-workshop', 'Spring workshop',
  '[{"type":"hero","heading":"Leave with a plan"},{"type":"embedded_form","form_slug":"workshop-signup"}]'::jsonb)).id;
INSERT INTO pg_temp.ids SELECT 'signup', id FROM public.growth_forms
  WHERE tenant_id = '5d5d0000-0000-4000-8000-00000000a001' AND slug = 'workshop-signup';
SELECT is((SELECT status FROM public.growth_pages WHERE id = (SELECT id FROM pg_temp.ids WHERE k='page')), 'draft', 'a new page starts unpublished');
SELECT is((SELECT status FROM public.growth_forms WHERE id = (SELECT id FROM pg_temp.ids WHERE k='signup')), 'draft',
  'and so does the sign-up form made for it');
SELECT throws_like($$UPDATE public.growth_pages SET blocks_json = draft_blocks_json WHERE id = (SELECT id FROM pg_temp.ids WHERE k='page')$$,
  '%GROWTH_PUBLISH_STATE_GUARDED%', 'a page''s live content cannot be written directly');
INSERT INTO pg_temp.ids SELECT 'blank', (public.growth_page_upsert(NULL, 'blank-signup', 'Blank signup',
  '[{"type":"hero","heading":"Hi"},{"type":"embedded_form"}]'::jsonb)).id;
SELECT throws_like($$SELECT pg_temp.door('growth_page_publish', (SELECT id FROM pg_temp.ids WHERE k='blank'), '5d5d0000-0000-4000-8000-000000000001')$$,
  '%GROWTH_FORM_MISSING%', 'a page with a signup section and no form behind it cannot go live');
SELECT is((pg_temp.door('growth_page_publish', (SELECT id FROM pg_temp.ids WHERE k='page'), '5d5d0000-0000-4000-8000-000000000001'))->>'status', 'published', 'the owner publishes the page');
SELECT is((SELECT status FROM public.growth_forms WHERE id = (SELECT id FROM pg_temp.ids WHERE k='signup')), 'active',
  'which publishes its sign-up form');
SELECT throws_ok($$SELECT pg_temp.door('growth_form_unpublish', (SELECT id FROM pg_temp.ids WHERE k='signup'), '5d5d0000-0000-4000-8000-000000000001')$$,
  '22023', NULL, 'a form a live page collects through cannot be taken down underneath it');
SELECT is((pg_temp.door('growth_page_unpublish', (SELECT id FROM pg_temp.ids WHERE k='page'), '5d5d0000-0000-4000-8000-000000000001'))->>'status', 'draft', 'the owner unpublishes the page');
SELECT is((SELECT status FROM public.growth_forms WHERE id = (SELECT id FROM pg_temp.ids WHERE k='signup')), 'active',
  'its sign-up form stays live');
SELECT is((pg_temp.door('growth_form_unpublish', (SELECT id FROM pg_temp.ids WHERE k='signup'), '5d5d0000-0000-4000-8000-000000000001'))->>'status', 'draft',
  'and can then be unpublished on its own');

-- ── Funnels publish every step together; a live funnel's steps change only after unpublishing ──
INSERT INTO pg_temp.ids SELECT 'offer', (public.growth_page_upsert(NULL, 'free-audit', 'Free audit',
  '[{"type":"hero","heading":"Find the leaks"}]'::jsonb)).id;
INSERT INTO pg_temp.ids SELECT 'apply', (public.growth_form_upsert(NULL, 'audit-application', 'Audit application',
  '{"sections":[{"title":"","fields":[{"key":"email","label":"Email","type":"email","required":true}]}]}'::jsonb)).id;
INSERT INTO pg_temp.ids SELECT 'funnel', (public.growth_funnel_upsert(NULL, 'free-audit-funnel', 'Free audit funnel', NULL,
  jsonb_build_array(
    jsonb_build_object('step_type','page','order_index',0,'page_id',(SELECT id FROM pg_temp.ids WHERE k='offer')),
    jsonb_build_object('step_type','form','order_index',1,'form_id',(SELECT id FROM pg_temp.ids WHERE k='apply'))))).id;
SELECT is((SELECT status FROM public.growth_funnels WHERE id = (SELECT id FROM pg_temp.ids WHERE k='funnel')), 'draft', 'a new funnel starts unpublished');
SELECT is((pg_temp.door('growth_funnel_publish', (SELECT id FROM pg_temp.ids WHERE k='funnel'), '5d5d0000-0000-4000-8000-000000000001'))->>'status', 'active', 'the owner publishes the funnel');
SELECT is((SELECT status FROM public.growth_pages WHERE id = (SELECT id FROM pg_temp.ids WHERE k='offer')), 'published', 'its page goes live with it');
SELECT is((SELECT status FROM public.growth_forms WHERE id = (SELECT id FROM pg_temp.ids WHERE k='apply')), 'active', 'and its form');
SELECT throws_ok($$SELECT public.growth_funnel_upsert(NULL, 'free-audit-funnel', 'Free audit funnel', NULL,
  jsonb_build_array(jsonb_build_object('step_type','page','order_index',0,'page_id',(SELECT id FROM pg_temp.ids WHERE k='offer'))))$$,
  '22023', NULL, 'a live funnel''s steps cannot be removed without unpublishing it');
SELECT lives_ok($$SELECT public.growth_funnel_upsert(NULL, 'free-audit-funnel', 'Free audit funnel', 'More applications',
  jsonb_build_array(
    jsonb_build_object('step_type','page','order_index',0,'page_id',(SELECT id FROM pg_temp.ids WHERE k='offer')),
    jsonb_build_object('step_type','form','order_index',1,'form_id',(SELECT id FROM pg_temp.ids WHERE k='apply'))))$$,
  'resending the same steps (a content-only rebuild) is fine');
SELECT throws_like($$DELETE FROM public.growth_funnel_steps WHERE funnel_id = (SELECT id FROM pg_temp.ids WHERE k='funnel')$$,
  '%GROWTH_PUBLISH_STATE_GUARDED%', 'a live funnel''s steps cannot be deleted directly');
SELECT throws_like($$DELETE FROM public.growth_pages WHERE id = (SELECT id FROM pg_temp.ids WHERE k='offer')$$,
  '%GROWTH_PUBLISH_STATE_GUARDED%', 'nor can a live page be deleted out from under it');
SELECT throws_ok($$SELECT public.growth_funnel_upsert(NULL, 'free-audit-funnel', 'Free audit funnel', NULL, NULL,
  (SELECT id FROM pg_temp.ids WHERE k='page'))$$,
  '22023', NULL, 'a live funnel''s entry page cannot be swapped without unpublishing it');
SELECT throws_ok($$SELECT pg_temp.door('growth_page_unpublish', (SELECT id FROM pg_temp.ids WHERE k='offer'), '5d5d0000-0000-4000-8000-000000000001')$$,
  '22023', NULL, 'a page a live funnel uses cannot be taken down underneath it');
SELECT is((pg_temp.door('growth_funnel_unpublish', (SELECT id FROM pg_temp.ids WHERE k='funnel'), '5d5d0000-0000-4000-8000-000000000001'))->>'status', 'draft', 'the owner unpublishes the funnel');
SELECT is((SELECT status FROM public.growth_pages WHERE id = (SELECT id FROM pg_temp.ids WHERE k='offer')), 'published', 'its page stays live');

-- ── Images ──
SELECT is((pg_temp.door('studio_image_publish', '5d5d0000-0000-4000-8000-00000000c001', '5d5d0000-0000-4000-8000-000000000001'))->>'status', 'published', 'the owner publishes an image to the Catalog');
SELECT throws_ok($$UPDATE public.marketing_content SET status = 'draft' WHERE id = '5d5d0000-0000-4000-8000-00000000c001'$$,
  '42501', NULL, 'signed-in users cannot change an image''s published state directly (the table is not theirs to write)');
SELECT throws_like($$SELECT public.save_marketing_content(p_kind => 'image', p_title => 'Swapped banner',
  p_image_url => 'https://img.tests.invalid/b.png', p_id => '5d5d0000-0000-4000-8000-00000000c001')$$,
  '%GROWTH_PUBLISH_STATE_GUARDED%', 'not even the owner-run save can swap the file of a published image');
SELECT is((pg_temp.door('studio_image_unpublish', '5d5d0000-0000-4000-8000-00000000c001', '5d5d0000-0000-4000-8000-000000000001'))->>'status', 'draft', 'and unpublishes it');
SELECT lives_ok($$SELECT public.save_marketing_content(p_kind => 'image', p_title => 'Swapped banner',
  p_image_url => 'https://img.tests.invalid/b.png', p_id => '5d5d0000-0000-4000-8000-00000000c001')$$,
  'once unpublished, the image takes a new version again');
SELECT throws_like($$SELECT public.growth_page_upsert(NULL, 'renamed-offer', 'Offer', '[]'::jsonb, NULL, NULL,
  (SELECT id FROM pg_temp.ids WHERE k='offer'))$$,
  '%GROWTH_PAGE_LIVE_SLUG%', 'a live page''s address cannot change without unpublishing it');
SELECT throws_ok($$SELECT pg_temp.door('studio_image_publish', '5d5d0000-0000-4000-8000-00000000c002', '5d5d0000-0000-4000-8000-000000000001')$$,
  '22023', NULL, 'only an image can be published as one');

-- ── The timeline: snapshots and going back ──
INSERT INTO pg_temp.ids SELECT 'session', (public.create_studio_session('Discovery calls')).id;
INSERT INTO pg_temp.ids SELECT 'v1', (public.save_artifact_version((SELECT id FROM pg_temp.ids WHERE k='session'), 'form', (SELECT id FROM pg_temp.ids WHERE k='form'))).id;
SELECT lives_ok($$SELECT public.growth_form_upsert(NULL, 'discovery-call', 'Discovery call',
  '{"sections":[{"title":"","fields":[{"key":"full_name","label":"Name","type":"text","required":true}]}]}'::jsonb)$$, 'the owner edits the form');
SELECT is((public.save_artifact_version((SELECT id FROM pg_temp.ids WHERE k='session'), 'form', (SELECT id FROM pg_temp.ids WHERE k='form'))).version_no, 2,
  'the edit becomes version 2 on the timeline');
SELECT lives_ok($$SELECT public.restore_artifact_version((SELECT id FROM pg_temp.ids WHERE k='v1'))$$, 'the owner goes back to version 1');
SELECT is((SELECT jsonb_array_length(draft_schema_json->'sections'->0->'fields') FROM public.growth_forms WHERE id = (SELECT id FROM pg_temp.ids WHERE k='form')), 2,
  'the working copy is version 1 again');
SELECT is((SELECT jsonb_array_length((public.save_artifact_version((SELECT id FROM pg_temp.ids WHERE k='session'), 'funnel', (SELECT id FROM pg_temp.ids WHERE k='funnel'))).snapshot->'steps')), 2,
  'a funnel snapshot carries its steps');
SELECT is((SELECT count(*)::int FROM public.list_artifact_versions((SELECT id FROM pg_temp.ids WHERE k='session'), 'form', (SELECT id FROM pg_temp.ids WHERE k='form'))), 2,
  'the owner reads the form''s history');

-- ── Authority: the workspace's owner or admin, never a global role ──
SELECT pg_temp.as_caller('5d5d0000-0000-4000-8000-000000000002');
SELECT throws_ok($$SELECT public.growth_form_upsert(NULL, 'member-form', 'Member form', '{"sections":[]}'::jsonb)$$,
  '42501', NULL, 'a plain member cannot create a form, global admin role or not');
SELECT throws_ok($$SELECT pg_temp.door('growth_page_publish', (SELECT id FROM pg_temp.ids WHERE k='page'), '5d5d0000-0000-4000-8000-000000000002')$$,
  '42501', NULL, 'or publish a page (the door names them; the person check refuses them)');
SELECT throws_ok($$SELECT pg_temp.door('growth_form_unpublish', (SELECT id FROM pg_temp.ids WHERE k='form'), '5d5d0000-0000-4000-8000-000000000002')$$,
  '42501', NULL, 'or unpublish a form');
SELECT is((SELECT count(*)::int FROM public.list_artifact_versions((SELECT id FROM pg_temp.ids WHERE k='session'), 'form', (SELECT id FROM pg_temp.ids WHERE k='form'))), 0,
  'or read the owner''s studio history');

SELECT pg_temp.as_caller('5d5d0000-0000-4000-8000-000000000003');
SELECT throws_ok($$SELECT pg_temp.door('growth_form_unpublish', (SELECT id FROM pg_temp.ids WHERE k='form'), '5d5d0000-0000-4000-8000-000000000003', '5d5d0000-0000-4000-8000-00000000a002')$$,
  'P0002', NULL, 'another workspace''s owner cannot reach this form from their own workspace');
SELECT throws_ok($$SELECT pg_temp.door('growth_form_unpublish', (SELECT id FROM pg_temp.ids WHERE k='form'), '5d5d0000-0000-4000-8000-000000000003', '5d5d0000-0000-4000-8000-00000000a001')$$,
  '42501', NULL, 'not even by naming this workspace: they are not its owner or admin');

-- ── A signed-out visitor; and the server path ──
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.list_artifact_versions((SELECT id FROM pg_temp.ids WHERE k='session'), 'form', (SELECT id FROM pg_temp.ids WHERE k='form'), '5d5d0000-0000-4000-8000-00000000a001')$$,
  '42501', NULL, 'a signed-out visitor naming the workspace still cannot read its history');

RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.list_artifact_versions((SELECT id FROM pg_temp.ids WHERE k='session'), 'form', (SELECT id FROM pg_temp.ids WHERE k='form'), '5d5d0000-0000-4000-8000-00000000a001')), 2,
  'a server session reads it for the workspace it names');
SELECT throws_ok($$SELECT public.growth_form_unpublish(p_tenant_id => '5d5d0000-0000-4000-8000-00000000a001', p_id => (SELECT id FROM pg_temp.ids WHERE k='form'))$$,
  '22023', NULL, 'a server call that does not name the person is refused');
SELECT throws_ok($$SELECT public.growth_form_unpublish(p_tenant_id => NULL, p_id => (SELECT id FROM pg_temp.ids WHERE k='form'), p_actor_id => '5d5d0000-0000-4000-8000-000000000001')$$,
  '22023', NULL, 'a server call that does not name the workspace is refused');
SELECT is((public.growth_form_unpublish(p_tenant_id => '5d5d0000-0000-4000-8000-00000000a001', p_id => (SELECT id FROM pg_temp.ids WHERE k='form'), p_actor_id => '5d5d0000-0000-4000-8000-000000000001'))->>'status', 'draft',
  'and the server path still unpublishes for the workspace and person it names');
-- The audit trail is not readable by the API roles; read it as the test owner.
RESET ROLE;
SELECT ok((SELECT count(*) > 0 AND bool_and(user_id = '5d5d0000-0000-4000-8000-000000000001'::uuid) FROM public.audit_logs
            WHERE action IN ('growth_form_publish', 'growth_form_unpublish') AND entity_id = (SELECT id FROM pg_temp.ids WHERE k='form')),
  'every publish and unpublish of the form records the person who asked, never NULL');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
