-- ============================================================================
-- Contact methods (20270515000000 + 20270515010000) — executed proof.
--
-- A client contact and a platform user each hold several labelled, ordered email addresses and
-- phone numbers with exactly one primary of each kind, enforced in the data. This proves:
--   * the invariants: one primary, never none while any exist, one contact per address per
--     workspace, a method stays in its contact's workspace, a method never changes owner;
--   * the writers: upsert_contact's `contact_methods` and set_user_contact_methods, as the real
--     caller roles, including every refusal;
--   * row access: a contact's methods are read with the contact; a person's by themself or by
--     an owner/admin of their workspace;
--   * recognition: every matcher finds a contact by ANY of their addresses, never across workspaces;
--   * the rollout mirror: the old columns show the primary, and a write to them moves the primary.
-- The merge's address handling is proved in governed_crm_commands.sql, through the real command.
--
-- Synthetic fixtures only. Rolls back.
-- ============================================================================
BEGIN;
SELECT plan(54);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('c3000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'cm-owner-a@tests.invalid'),
  ('c3000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'cm-admin-a@tests.invalid'),
  ('c3000000-0000-4000-8000-0000000000a3', 'authenticated', 'authenticated', 'cm-member-a@tests.invalid'),
  ('c3000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'cm-owner-b@tests.invalid');

INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, account_number, features) VALUES
  ('c3000000-0000-4000-8000-00000000000a', 'contact-methods-a', 'Contact Methods A', 'active', 'standalone', 'CMA', 9320001, '{}'::jsonb),
  ('c3000000-0000-4000-8000-00000000000b', 'contact-methods-b', 'Contact Methods B', 'active', 'standalone', 'CMB', 9320002, '{}'::jsonb);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a1', 'owner', 'active', true, now() - interval '3 days'),
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a2', 'admin', 'active', false, now() - interval '2 days'),
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a3', 'member', 'active', false, now() - interval '1 day'),
  ('c3000000-0000-4000-8000-00000000000b', 'c3000000-0000-4000-8000-0000000000b1', 'owner', 'active', true, now() - interval '3 days');

-- A person's active workspace must be one they belong to (guard_active_tenant_membership), so
-- the memberships above come first.
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('c3000000-0000-4000-8000-0000000000a1', 'c3000000-0000-4000-8000-00000000000a'),
  ('c3000000-0000-4000-8000-0000000000a2', 'c3000000-0000-4000-8000-00000000000a'),
  ('c3000000-0000-4000-8000-0000000000a3', 'c3000000-0000-4000-8000-00000000000a'),
  ('c3000000-0000-4000-8000-0000000000b1', 'c3000000-0000-4000-8000-00000000000b')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;


-- upsert_contact and conversations require the platform admin role in addition to the seat.
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c3000000-0000-4000-8000-0000000000a1', 'admin'),
  ('c3000000-0000-4000-8000-0000000000b1', 'admin')
ON CONFLICT DO NOTHING;

-- Created through the OLD columns, the way every pre-existing writer still writes during rollout.
INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, email, phone) VALUES
  ('c3000000-0000-4000-8000-000000000ca1', 'c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a1', 'Ada', 'Lovelace', 'CMA-1', 'ada@a.tests.invalid', '+1 (555) 010-0101'),
  ('c3000000-0000-4000-8000-000000000ca2', 'c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a1', 'Bob', 'Byte', 'CMA-2', 'bob@a.tests.invalid', NULL),
  ('c3000000-0000-4000-8000-000000000cb1', 'c3000000-0000-4000-8000-00000000000b', 'c3000000-0000-4000-8000-0000000000b1', 'Ada', 'Elsewhere', 'CMB-1', 'ada@b.tests.invalid', NULL);

-- ── 1. The old columns seed the model ───────────────────────────────────────────────────────
SELECT is((SELECT array_agg(value || ':' || is_primary ORDER BY kind) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1'),
          ARRAY['ada@a.tests.invalid:true', '+1 (555) 010-0101:true'],
          'a contact written through the old columns holds that email and phone as its primaries');
SELECT is((SELECT match_key FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1' AND kind = 'phone'),
          '5550100101', 'a phone matches on its last ten digits');
SELECT is((SELECT array_agg(label || ':' || value || ':' || is_primary) FROM public.user_contact_methods
            WHERE user_id = 'c3000000-0000-4000-8000-0000000000a3'),
          ARRAY['Sign-in:cm-member-a@tests.invalid:true'],
          'a new person starts with their sign-in address as their one primary email');

-- ── 2. The contact writer, as the workspace owner ───────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok($q$SELECT public.upsert_contact(jsonb_build_object('contact_methods', jsonb_build_array(
    jsonb_build_object('kind','email','value','ada@a.tests.invalid','label','Work','is_primary',true),
    jsonb_build_object('kind','email','value','ada.home@a.tests.invalid','label','Personal'),
    jsonb_build_object('kind','phone','value','+1 (555) 010-0101','label','Mobile'),
    jsonb_build_object('kind','phone','value','555-010-0199','label','Office','is_primary',true))),
  'c3000000-0000-4000-8000-000000000ca1')$q$,
  'the owner saves two emails and two phones on one contact');
RESET ROLE;
SELECT is((SELECT array_agg(value ORDER BY position) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1' AND kind = 'email'),
          ARRAY['ada@a.tests.invalid', 'ada.home@a.tests.invalid'], 'emails are held in the order given');
SELECT is((SELECT array_agg(label ORDER BY position) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1' AND kind = 'phone'),
          ARRAY['Mobile', 'Office'], 'each method keeps its label');
SELECT is((SELECT phone FROM public.clients WHERE id = 'c3000000-0000-4000-8000-000000000ca1'),
          '555-010-0199', 'the old phone column shows the new primary phone');

CREATE TEMP TABLE cm_before AS
  SELECT id FROM public.client_contact_methods
   WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1' AND value = 'ada.home@a.tests.invalid';
GRANT SELECT ON cm_before TO authenticated;
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.upsert_contact(jsonb_build_object('contact_methods', jsonb_build_array(
    jsonb_build_object('kind','email','value','ada.home@a.tests.invalid','label','Personal','is_primary',true),
    jsonb_build_object('kind','email','value','ada@a.tests.invalid','label','Work'),
    jsonb_build_object('kind','phone','value','+1 (555) 010-0101','label','Mobile'),
    jsonb_build_object('kind','phone','value','555-010-0199','label','Office','is_primary',true))),
  'c3000000-0000-4000-8000-000000000ca1')$q$,
  'the owner reorders the emails and moves the primary');
RESET ROLE;
SELECT is((SELECT position FROM public.client_contact_methods WHERE id = (SELECT id FROM cm_before)),
          0, 'a reordered address keeps its identity and takes its new place');
SELECT is((SELECT email FROM public.clients WHERE id = 'c3000000-0000-4000-8000-000000000ca1'),
          'ada.home@a.tests.invalid', 'the old email column shows the new primary email');

SET LOCAL ROLE authenticated;
SELECT throws_like($q$SELECT public.upsert_contact('{"contact_methods":[{"kind":"email","value":"x@a.tests.invalid"},{"kind":"email","value":" X@A.tests.invalid "}]}'::jsonb, 'c3000000-0000-4000-8000-000000000ca2')$q$,
  'CONTACT_METHOD_DUPLICATE%', 'the same address twice, however it is written, is refused');
SELECT throws_like($q$SELECT public.upsert_contact('{"contact_methods":[{"kind":"email","value":"x@a.tests.invalid","is_primary":true},{"kind":"email","value":"y@a.tests.invalid","is_primary":true}]}'::jsonb, 'c3000000-0000-4000-8000-000000000ca2')$q$,
  'CONTACT_METHOD_PRIMARY_CONFLICT%', 'two primaries of one kind are refused, never guessed between');
SELECT throws_like($q$SELECT public.upsert_contact('{"contact_methods":[{"kind":"email","value":"not an email"}]}'::jsonb, 'c3000000-0000-4000-8000-000000000ca2')$q$,
  'CONTACT_METHOD_INVALID_EMAIL%', 'a malformed email is refused');
SELECT throws_like($q$SELECT public.upsert_contact('{"contact_methods":[{"kind":"phone","value":"12"}]}'::jsonb, 'c3000000-0000-4000-8000-000000000ca2')$q$,
  'CONTACT_METHOD_INVALID_PHONE%', 'a phone number without enough digits is refused');
SELECT throws_like($q$SELECT public.upsert_contact('{"email":"z@a.tests.invalid","contact_methods":[]}'::jsonb, 'c3000000-0000-4000-8000-000000000ca2')$q$,
  'CONTACT_METHODS_AMBIGUOUS%', 'the list and the single-address keys cannot be mixed');
SELECT throws_like($q$SELECT public.upsert_contact('{"contact_methods":[{"kind":"email","value":"bob@a.tests.invalid"},{"kind":"email","value":"ada@a.tests.invalid"}]}'::jsonb, 'c3000000-0000-4000-8000-000000000ca2')$q$,
  'CONTACT_METHOD_TAKEN%', 'an address held by another contact in the workspace is refused, even a secondary one');
RESET ROLE;
SELECT is((SELECT array_agg(value) FROM public.client_contact_methods WHERE client_id = 'c3000000-0000-4000-8000-000000000ca2'),
          ARRAY['bob@a.tests.invalid'], 'a refused save changes nothing');
SET LOCAL ROLE authenticated;
SELECT throws_like($q$SELECT public.upsert_contact('{"contact_methods":[{"kind":"email","value":"q@b.tests.invalid"}]}'::jsonb, 'c3000000-0000-4000-8000-000000000cb1')$q$,
  'CONTACT_NOT_FOUND_OR_FORBIDDEN%', 'another workspace''s contact cannot be written');
CREATE TEMP TABLE cm_new AS
  SELECT public.upsert_contact('{"first_name":"Cy","contact_methods":[{"kind":"phone","value":"555 010 0301"},{"kind":"phone","value":"555 010 0302"}]}'::jsonb) AS id;
RESET ROLE;
SELECT is((SELECT array_agg(value || ':' || is_primary ORDER BY position) FROM public.client_contact_methods WHERE client_id = (SELECT id FROM cm_new)),
          ARRAY['555 010 0301:true', '555 010 0302:false'],
          'a new contact made from a list takes the first of a kind as primary when none is marked');
SELECT is((SELECT tenant_id FROM public.clients WHERE id = (SELECT id FROM cm_new)),
          'c3000000-0000-4000-8000-00000000000a'::uuid, 'the new contact belongs to the caller''s workspace');

-- ── 3. The invariants hold for every writer, not only the functions ─────────────────────────
SET CONSTRAINTS ALL IMMEDIATE;
SELECT throws_ok($q$INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position)
  VALUES ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ca1', 'email', 'third@a.tests.invalid', true, 2)$q$,
  '23P01', NULL, 'a second primary email is refused by the table itself');
SELECT throws_ok($q$UPDATE public.client_contact_methods SET is_primary = false
  WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1' AND kind = 'email' AND is_primary$q$,
  '23514', NULL, 'leaving addresses with no primary is refused');
SELECT throws_ok($q$INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position)
  VALUES ('c3000000-0000-4000-8000-00000000000b', 'c3000000-0000-4000-8000-000000000ca1', 'email', 'wrong@a.tests.invalid', false, 5)$q$,
  '23503', NULL, 'a method cannot be filed under another workspace than its contact''s');
SELECT throws_like($q$UPDATE public.client_contact_methods SET client_id = 'c3000000-0000-4000-8000-000000000ca2'
  WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1' AND kind = 'phone' AND NOT is_primary$q$,
  'CONTACT_METHOD_OWNER_IMMUTABLE%', 'a method never changes owner');
SELECT throws_ok($q$INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position)
  VALUES ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ca2', 'email', 'ADA@a.tests.invalid', false, 1)$q$,
  '23505', NULL, 'one workspace cannot give an address to two contacts, whatever its case');
SELECT lives_ok($q$INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position)
  VALUES ('c3000000-0000-4000-8000-00000000000b', 'c3000000-0000-4000-8000-000000000cb1', 'email', 'ada@a.tests.invalid', false, 1)$q$,
  'another workspace can hold the same address for its own contact');
SELECT lives_ok($q$DELETE FROM public.client_contact_methods WHERE client_id = 'c3000000-0000-4000-8000-000000000ca2' AND kind = 'email'$q$,
  'removing every address of a kind is allowed: none is not a broken primary');
SET CONSTRAINTS ALL DEFERRED;
SELECT is((SELECT email FROM public.clients WHERE id = 'c3000000-0000-4000-8000-000000000ca2'),
          NULL::text, 'and the old column follows');

-- ── 4. Row access ───────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT ok((SELECT count(*) FROM public.client_contact_methods WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1') = 4,
          'the owner reads every address of their own contact');
SELECT throws_ok($q$INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position)
  VALUES ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ca2', 'email', 'direct@a.tests.invalid', true, 0)$q$,
  '42501', NULL, 'a browser session cannot write methods except through the writers');
SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.client_contact_methods WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1'),
          0, 'another workspace''s owner reads none of them');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── 5. Recognition by any address (service context, as inbound handlers run) ────────────────
SELECT is(public.resolve_contact_id('c3000000-0000-4000-8000-00000000000a', NULL, ' ADA@a.tests.invalid'),
          'c3000000-0000-4000-8000-000000000ca1'::uuid, 'inbound email from a SECONDARY address finds the contact');
SELECT is(public.resolve_contact_id('c3000000-0000-4000-8000-00000000000a', '15550100101', NULL),
          'c3000000-0000-4000-8000-000000000ca1'::uuid, 'inbound phone finds the contact by its last ten digits, from a secondary number');
SELECT is(public.resolve_contact_id('c3000000-0000-4000-8000-00000000000b', NULL, 'ada.home@a.tests.invalid'),
          NULL::uuid, 'an address never resolves into another workspace');
SELECT is((SELECT contact_id::text || ':' || was_created FROM public.create_contact_v2(
            'Someone', NULL, 'ada@a.tests.invalid', NULL, NULL, NULL, 'new_lead', 'paige', '{}', NULL, NULL, NULL,
            'c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a1', 'api')),
          'c3000000-0000-4000-8000-000000000ca1:false', 'creating a contact from a known secondary address returns that contact');
SELECT is((SELECT email_exact FROM public.find_duplicate_contacts('c3000000-0000-4000-8000-00000000000a', 'Nobody', NULL, 'ada@a.tests.invalid')
            WHERE id = 'c3000000-0000-4000-8000-000000000ca1'),
          true, 'the duplicate check flags an exact match on a secondary address');
SELECT is(public.resolve_client_id_by_email('Ada.Home@a.tests.invalid'),
          'c3000000-0000-4000-8000-000000000ca1'::uuid, 'the email resolver matches any address');
SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT contact_id FROM public.create_and_attach_conversation('X', NULL, 'ada@a.tests.invalid', NULL, 'email')),
          'c3000000-0000-4000-8000-000000000ca1'::uuid, 'composing to a secondary address opens the contact that holds it');
CREATE TEMP TABLE cm_convo AS
  SELECT contact_id FROM public.create_and_attach_conversation('Dee', 'New', 'dee@a.tests.invalid', '555 010 0404', 'email');
RESET ROLE;
SELECT is((SELECT array_agg(kind || ':' || value ORDER BY kind) FROM public.client_contact_methods WHERE client_id = (SELECT contact_id FROM cm_convo)),
          ARRAY['email:dee@a.tests.invalid', 'phone:555 010 0404'], 'a contact created by composing holds both addresses as methods');

-- A customer invited at a contact's SECONDARY address, who signs in with it, is linked to that
-- contact rather than given a duplicate.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at) VALUES
  ('c3000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'ADA@a.tests.invalid', now());
INSERT INTO public.tenant_invite_tokens (tenant_id, token, kind, created_by, email) VALUES
  ('c3000000-0000-4000-8000-00000000000a', 'cm-consumer-invite-token', 'consumer', 'c3000000-0000-4000-8000-0000000000a1', 'ada@a.tests.invalid');
SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.accept_tenant_invite('cm-consumer-invite-token')$q$,
  'a customer accepts an invite sent to a contact''s secondary address');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT is((SELECT linked_user_id FROM public.clients WHERE id = 'c3000000-0000-4000-8000-000000000ca1'),
          'c3000000-0000-4000-8000-0000000000c1'::uuid, 'the invite links the existing contact that holds that address');
SELECT is((SELECT count(*)::int FROM public.clients WHERE tenant_id = 'c3000000-0000-4000-8000-00000000000a' AND linked_user_id = 'c3000000-0000-4000-8000-0000000000c1'),
          1, 'and creates no second contact for them');

-- ── 6. The rollout mirror: a write to the old column moves the primary ──────────────────────
UPDATE public.clients SET email = 'ada@a.tests.invalid' WHERE id = 'c3000000-0000-4000-8000-000000000ca1';
SELECT is((SELECT array_agg(value || ':' || is_primary ORDER BY position) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1' AND kind = 'email'),
          ARRAY['ada.home@a.tests.invalid:false', 'ada@a.tests.invalid:true'],
          'setting the old column to an address the contact already holds makes it primary, losing nothing');
UPDATE public.clients SET email = NULL WHERE id = 'c3000000-0000-4000-8000-000000000ca1';
SELECT is((SELECT email FROM public.clients WHERE id = 'c3000000-0000-4000-8000-000000000ca1'),
          'ada.home@a.tests.invalid', 'clearing the old column removes that address and promotes the next');

-- ── 7. A person's own contact record ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.set_user_contact_methods('c3000000-0000-4000-8000-0000000000a3',
  '[{"kind":"email","value":"cm-member-a@tests.invalid","label":"Sign-in"},{"kind":"email","value":"member.work@tests.invalid","label":"Work","is_primary":true},{"kind":"phone","value":"+1 555 010 0505","label":"Mobile"}]')$q$,
  'a member sets their own addresses');
SELECT throws_ok($q$SELECT public.set_user_contact_methods('c3000000-0000-4000-8000-0000000000a2', '[]')$q$,
  '42501', 'USER_CONTACT_METHODS_FORBIDDEN', 'a member cannot set a teammate''s');
SELECT is((SELECT count(*)::int FROM public.user_contact_methods WHERE user_id = 'c3000000-0000-4000-8000-0000000000a2'),
          0, 'and cannot read a teammate''s');
RESET ROLE;
SELECT is((SELECT work_email || '|' || phone FROM public.profiles WHERE user_id = 'c3000000-0000-4000-8000-0000000000a3'),
          'member.work@tests.invalid|+1 555 010 0505', 'the old profile columns show the person''s primaries');

SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.set_user_contact_methods('c3000000-0000-4000-8000-0000000000a3',
  '[{"kind":"email","value":"member.work@tests.invalid","label":"Work"}]')$q$,
  'an admin sets a member''s addresses in their workspace');
SELECT ok((SELECT count(*) FROM public.user_contact_methods WHERE user_id = 'c3000000-0000-4000-8000-0000000000a3') = 1,
          'and reads them');
SELECT throws_ok($q$SELECT public.set_user_contact_methods('c3000000-0000-4000-8000-0000000000a1', '[]')$q$,
  '42501', 'USER_CONTACT_METHODS_OWNER_ONLY', 'an admin cannot rewrite the owner''s');

SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT lives_ok($q$SELECT public.set_user_contact_methods('c3000000-0000-4000-8000-0000000000a2',
  '[{"kind":"email","value":"admin.work@tests.invalid"}]')$q$,
  'the owner sets an admin''s addresses');

SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT throws_ok($q$SELECT public.set_user_contact_methods('c3000000-0000-4000-8000-0000000000a3', '[]')$q$,
  '42501', 'USER_CONTACT_METHODS_FORBIDDEN', 'another workspace''s owner cannot set them');
SELECT is((SELECT count(*)::int FROM public.user_contact_methods WHERE user_id = 'c3000000-0000-4000-8000-0000000000a3'),
          0, 'or read them');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();
ROLLBACK;
