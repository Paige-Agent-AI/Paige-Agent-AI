-- ============================================================================
-- Contact methods (20270515000000 + 20270515010000, writers as restated by 20270519000000) — executed proof.
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
--   * the rollout mirror: the old columns show the primary, and a write to them moves the primary;
--   * every database object that read or wrote the old columns reads and writes the methods
--     (20270519010000): the three views, the dependent functions, upsert_contact's refusal of
--     the single-address keys (with 20270519000000's lost-update check intact), and the data subject
--     request through both the signed-in path and Paige's trusted service-role path. The invitations policy is proved in
--     assigned_staff_relationship_scope.sql, where its assignment fixtures live, and the agreement
--     counterparty trigger by scripts/agreements/run-integrity-proof.sh.
-- The merge's address handling is proved in governed_crm_commands.sql, through the real command.
--
-- Fixtures write addresses as contact methods, the only place they will live once the old columns
-- are dropped. Only section 6 and the assertions tagged MIRROR touch the old columns, and they go
-- with them. (Section 8 also sets them, guarded, to prove its readers ignore them.)
--
-- Synthetic fixtures only. Rolls back.
-- ============================================================================
BEGIN;
SELECT plan(101);

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

INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number) VALUES
  ('c3000000-0000-4000-8000-000000000ca1', 'c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a1', 'Ada', 'Lovelace', 'CMA-1'),
  ('c3000000-0000-4000-8000-000000000ca2', 'c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a1', 'Bob', 'Byte', 'CMA-2'),
  ('c3000000-0000-4000-8000-000000000cb1', 'c3000000-0000-4000-8000-00000000000b', 'c3000000-0000-4000-8000-0000000000b1', 'Ada', 'Elsewhere', 'CMB-1');
INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position) VALUES
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ca1', 'email', 'ada@a.tests.invalid', true, 0),
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ca1', 'phone', '+1 (555) 010-0101', true, 0),
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ca2', 'email', 'bob@a.tests.invalid', true, 0),
  ('c3000000-0000-4000-8000-00000000000b', 'c3000000-0000-4000-8000-000000000cb1', 'email', 'ada@b.tests.invalid', true, 0);

-- ── 1. The model ────────────────────────────────────────────────────────────────────────────
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
    jsonb_build_object('kind','phone','value','555-010-0199','label','Office','is_primary',true)),
    'expected_contact_methods', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'value',value,'label',label,'is_primary',is_primary) ORDER BY kind, position), '[]'::jsonb) FROM public.client_contact_methods WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1')),
  'c3000000-0000-4000-8000-000000000ca1')$q$,
  'the owner saves two emails and two phones on one contact');
RESET ROLE;
SELECT is((SELECT array_agg(value ORDER BY position) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1' AND kind = 'email'),
          ARRAY['ada@a.tests.invalid', 'ada.home@a.tests.invalid'], 'emails are held in the order given');
SELECT is((SELECT array_agg(label ORDER BY position) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1' AND kind = 'phone'),
          ARRAY['Mobile', 'Office'], 'each method keeps its label');
-- MIRROR (deleted with the old columns).
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
    jsonb_build_object('kind','phone','value','555-010-0199','label','Office','is_primary',true)),
    'expected_contact_methods', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'value',value,'label',label,'is_primary',is_primary) ORDER BY kind, position), '[]'::jsonb) FROM public.client_contact_methods WHERE client_id = 'c3000000-0000-4000-8000-000000000ca1')),
  'c3000000-0000-4000-8000-000000000ca1')$q$,
  'the owner reorders the emails and moves the primary');
RESET ROLE;
SELECT is((SELECT position FROM public.client_contact_methods WHERE id = (SELECT id FROM cm_before)),
          0, 'a reordered address keeps its identity and takes its new place');
-- MIRROR (deleted with the old columns).
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
SELECT throws_like($q$SELECT public.upsert_contact('{"email":"z@a.tests.invalid"}'::jsonb, 'c3000000-0000-4000-8000-000000000ca2')$q$,
  'CONTACT_ADDRESS_FIELDS_RETIRED: email %', 'the single email key is refused by name: a contact''s addresses are one list');
SELECT throws_like($q$SELECT public.upsert_contact('{"first_name":"Zed","phone":"555 010 0999"}'::jsonb)$q$,
  'CONTACT_ADDRESS_FIELDS_RETIRED: phone %', 'the single phone key is refused by name, on create as on update');
SELECT throws_like($q$SELECT public.upsert_contact('{"email":"z@a.tests.invalid","phone":null,"contact_methods":[]}'::jsonb, 'c3000000-0000-4000-8000-000000000ca2')$q$,
  'CONTACT_ADDRESS_FIELDS_RETIRED: email,phone %', 'mixing them with the list is refused the same way, naming both');
SELECT throws_like($q$SELECT public.upsert_contact(jsonb_build_object('contact_methods', '[{"kind":"email","value":"bob@a.tests.invalid"},{"kind":"email","value":"ada@a.tests.invalid"}]'::jsonb,
    'expected_contact_methods', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',kind,'value',value,'label',label,'is_primary',is_primary) ORDER BY kind, position), '[]'::jsonb) FROM public.client_contact_methods WHERE client_id = 'c3000000-0000-4000-8000-000000000ca2')), 'c3000000-0000-4000-8000-000000000ca2')$q$,
  'CONTACT_METHOD_TAKEN%', 'an address held by another contact in the workspace is refused, even a secondary one');
-- 20270519010000 restates upsert_contact after 20270519000000; the lost-update check survives it.
SELECT throws_like($q$SELECT public.upsert_contact('{"contact_methods":[{"kind":"email","value":"bob.new@a.tests.invalid"}],"expected_contact_methods":[{"kind":"email","value":"bob.old@a.tests.invalid","is_primary":true}]}'::jsonb, 'c3000000-0000-4000-8000-000000000ca2')$q$,
  'CONTACT_METHODS_STALE%', 'a save naming a list that is no longer the stored one is still refused, never written over it');
SELECT throws_like($q$SELECT public.upsert_contact('{"contact_methods":[{"kind":"email","value":"bob.new@a.tests.invalid"}]}'::jsonb, 'c3000000-0000-4000-8000-000000000ca2')$q$,
  'CONTACT_METHODS_EXPECTED_REQUIRED%', 'and replacing an existing contact''s list without naming the list read is still refused');
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
-- MIRROR (deleted with the old columns).
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
--
-- KNOWN, SEPARATE DEFECT (recorded for the Register, not fixed in this lane): accept_tenant_invite
-- ends by setting the invitee's profiles.active_tenant_id, and for a customer invite no membership
-- exists, so production's guard_active_tenant_membership (trg_guard_active_tenant, since
-- 20260714144656) refuses it and rolls the whole acceptance back. No customer invite has been
-- accepted on production since that guard landed. This proof is about which contact the invite
-- recognises, so the guard is suspended around this one call and restored immediately after.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_guard_active_tenant') THEN
    ALTER TABLE public.profiles DISABLE TRIGGER trg_guard_active_tenant;
  END IF;
END $$;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at) VALUES
  ('c3000000-0000-4000-8000-0000000000c1', 'authenticated', 'authenticated', 'ADA@a.tests.invalid', now());
INSERT INTO public.tenant_invite_tokens (tenant_id, token, kind, created_by, email) VALUES
  ('c3000000-0000-4000-8000-00000000000a', 'cm-consumer-invite-token', 'consumer', 'c3000000-0000-4000-8000-0000000000a1', 'ada@a.tests.invalid');
SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.accept_tenant_invite('cm-consumer-invite-token')$q$,
  'an invite sent to a contact''s secondary address is accepted once the active-workspace guard is set aside');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_guard_active_tenant') THEN
    ALTER TABLE public.profiles ENABLE TRIGGER trg_guard_active_tenant;
  END IF;
END $$;
SELECT is((SELECT linked_user_id FROM public.clients WHERE id = 'c3000000-0000-4000-8000-000000000ca1'),
          'c3000000-0000-4000-8000-0000000000c1'::uuid, 'the invite links the existing contact that holds that address');
SELECT is((SELECT count(*)::int FROM public.clients WHERE tenant_id = 'c3000000-0000-4000-8000-00000000000a' AND linked_user_id = 'c3000000-0000-4000-8000-0000000000c1'),
          1, 'and creates no second contact for them');

-- ── 6. MIRROR (deleted with the old columns): they seed and follow the methods ──────────────
INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, email, phone) VALUES
  ('c3000000-0000-4000-8000-000000000ca9', 'c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a1', 'Mo', 'Mirror', 'CMA-9', 'mo@a.tests.invalid', '+1 (555) 010-0909');
SELECT is((SELECT array_agg(value || ':' || is_primary ORDER BY kind) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000ca9'),
          ARRAY['mo@a.tests.invalid:true', '+1 (555) 010-0909:true'],
          'a contact written through the old columns holds that email and phone as its primaries');
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
  '[{"kind":"email","value":"cm-member-a@tests.invalid","label":"Sign-in"},{"kind":"email","value":"member.work@tests.invalid","label":"Work","is_primary":true},{"kind":"phone","value":"+1 555 010 0505","label":"Mobile"}]',
  '[{"kind":"email","value":"cm-member-a@tests.invalid","label":"Sign-in","is_primary":true}]')$q$,
  'a member sets their own addresses');
SELECT throws_ok($q$SELECT public.set_user_contact_methods('c3000000-0000-4000-8000-0000000000a2', '[]', '[]')$q$,
  '42501', 'USER_CONTACT_METHODS_FORBIDDEN', 'a member cannot set a teammate''s');
SELECT is((SELECT count(*)::int FROM public.user_contact_methods WHERE user_id = 'c3000000-0000-4000-8000-0000000000a2'),
          0, 'and cannot read a teammate''s');
RESET ROLE;
-- MIRROR (deleted with the old columns).
SELECT is((SELECT work_email || '|' || phone FROM public.profiles WHERE user_id = 'c3000000-0000-4000-8000-0000000000a3'),
          'member.work@tests.invalid|+1 555 010 0505', 'the old profile columns show the person''s primaries');

SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.set_user_contact_methods('c3000000-0000-4000-8000-0000000000a3',
  '[{"kind":"email","value":"member.work@tests.invalid","label":"Work"}]',
  '[{"kind":"email","value":"member.work@tests.invalid","label":"Work","is_primary":true},{"kind":"email","value":"cm-member-a@tests.invalid","label":"Sign-in"},{"kind":"phone","value":"+1 555 010 0505","label":"Mobile","is_primary":true}]')$q$,
  'an admin sets a member''s addresses in their workspace');
SELECT ok((SELECT count(*) FROM public.user_contact_methods WHERE user_id = 'c3000000-0000-4000-8000-0000000000a3') = 1,
          'and reads them');
SELECT lives_ok($q$SELECT public.set_user_contact_methods('c3000000-0000-4000-8000-0000000000a1',
  '[{"kind":"email","value":"cm-owner-a@tests.invalid","label":"Sign-in"},{"kind":"phone","value":"+1 555 010 0606","label":"Mobile"}]',
  '[{"kind":"email","value":"cm-owner-a@tests.invalid","label":"Sign-in","is_primary":true}]')$q$,
  'an admin sets the owner''s addresses too: an admin holds the owner''s powers except removing the owner');

SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT lives_ok($q$SELECT public.set_user_contact_methods('c3000000-0000-4000-8000-0000000000a2',
  '[{"kind":"email","value":"admin.work@tests.invalid"}]',
  '[{"kind":"email","value":"cm-admin-a@tests.invalid","label":"Sign-in","is_primary":true}]')$q$,
  'the owner sets an admin''s addresses');

SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT throws_ok($q$SELECT public.set_user_contact_methods('c3000000-0000-4000-8000-0000000000a3', '[]', '[]')$q$,
  '42501', 'USER_CONTACT_METHODS_FORBIDDEN', 'another workspace''s owner cannot set them');
SELECT is((SELECT count(*)::int FROM public.user_contact_methods WHERE user_id = 'c3000000-0000-4000-8000-0000000000a3'),
          0, 'or read them');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- ── 8. Everything that read or wrote the old columns reads and writes the methods ───────────
-- (20270519010000.) Eve holds two emails and a phone; the nameless contact is ready to be
-- viewed as. While the old columns still exist they are set to STALE values behind the mirror's
-- back, so any reader still using them shows the stale value and fails here; once the columns are
-- dropped the block does nothing and every assertion below still holds.
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('c3000000-0000-4000-8000-0000000000a5', 'authenticated', 'authenticated', 'cm-portal-a@tests.invalid');
INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number) VALUES
  ('c3000000-0000-4000-8000-000000000ce1', 'c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a1', 'Eve', 'Stone', 'CMA-8');
INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, linked_user_id, agreement_signed_at, onboarding_stage) VALUES
  ('c3000000-0000-4000-8000-000000000ce2', 'c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a1', '', '', 'CMA-10',
   'c3000000-0000-4000-8000-0000000000a5', now(), 'completed');
INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, label, is_primary, position) VALUES
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce1', 'email', 'eve@a.tests.invalid', 'Work', true, 0),
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce1', 'email', 'eve.home@a.tests.invalid', 'Personal', false, 1),
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce1', 'phone', '555 010 0801', 'Mobile', true, 0),
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce2', 'email', 'nameless@a.tests.invalid', NULL, true, 0);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'email') THEN
    ALTER TABLE public.clients DISABLE TRIGGER clients_legacy_address_to_methods;
    EXECUTE $q$UPDATE public.clients SET email = 'stale-' || account_number || '@a.tests.invalid', phone = '555 010 0999'
                WHERE id IN ('c3000000-0000-4000-8000-000000000ce1', 'c3000000-0000-4000-8000-000000000ce2')$q$;
    ALTER TABLE public.clients ENABLE TRIGGER clients_legacy_address_to_methods;
  END IF;
END $$;
INSERT INTO public.paige_pending_approvals (id, type, status, draft_content, tenant_id, contact_id) VALUES
  ('c3000000-0000-4000-8000-0000000000f1', 'other', 'rejected', '{}'::jsonb,
   'c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce1');

SELECT is((SELECT contact_email FROM public.paige_approval_queue_v WHERE id = 'c3000000-0000-4000-8000-0000000000f1'),
          'eve@a.tests.invalid', 'the approval queue shows the contact''s primary email, read from its addresses');
SELECT is((SELECT email FROM public.paige_unassigned_queue WHERE id = 'c3000000-0000-4000-8000-000000000ce1'),
          'eve@a.tests.invalid', 'the unassigned queue shows the primary email');
SELECT is(has_table_privilege('anon', 'public.paige_approval_queue_v', 'SELECT'), false,
          'the approval queue is not readable anonymously');

SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT email FROM public.contact_readiness_rollup WHERE contact_id = 'c3000000-0000-4000-8000-000000000ce1'),
          'eve@a.tests.invalid', 'the readiness rollup shows the primary email to the workspace owner');
SELECT is((SELECT email || '|' || phone FROM public.lookup_client_by_account_number('CMA-8')),
          'eve@a.tests.invalid|555 010 0801', 'a lookup by account number returns the primary email and phone');
SELECT is((SELECT client_name FROM public.start_client_impersonation('c3000000-0000-4000-8000-000000000ce2')),
          'nameless@a.tests.invalid', 'viewing as a contact with no name labels them by their primary email');
CREATE TEMP TABLE cm_booking AS
  SELECT public.create_internal_booking('Intro call', now() + interval '1 day', now() + interval '1 day 30 minutes', 'UTC',
                                        'c3000000-0000-4000-8000-000000000ce1') AS id;
RESET ROLE;
SELECT is((SELECT guest_email FROM public.internal_bookings WHERE id = (SELECT id FROM cm_booking)),
          'eve@a.tests.invalid', 'a booking made for a contact is addressed to their primary email');

-- The rule a write to the old column followed, now applied to a list.
SELECT is(public.contact_methods_with_primary(
            '[{"kind":"email","value":"a@x.invalid","is_primary":true},{"kind":"email","value":"b@x.invalid","is_primary":false}]', 'email', ' B@x.invalid '),
          '[{"kind":"email","value":"a@x.invalid","is_primary":false},{"kind":"email","value":"B@x.invalid","is_primary":true}]'::jsonb,
          'an address the contact already holds becomes the primary, and the old primary stays');
SELECT is(public.contact_methods_with_primary(
            '[{"kind":"email","value":"a@x.invalid","label":"Work","is_primary":true},{"kind":"phone","value":"555 010 0100","is_primary":true}]', 'email', 'c@x.invalid'),
          '[{"kind":"email","value":"c@x.invalid","label":"Work","is_primary":true},{"kind":"phone","value":"555 010 0100","is_primary":true}]'::jsonb,
          'a new address replaces the primary of its kind and keeps its label; other kinds are untouched');
SELECT is(public.contact_methods_with_primary('[]', 'phone', '555 010 0200'),
          '[{"kind":"phone","value":"555 010 0200","is_primary":true}]'::jsonb,
          'a contact with none of that kind gains it as the primary');

SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.update_contact('c3000000-0000-4000-8000-000000000ce1', p_email := 'eve.home@a.tests.invalid', p_phone := '555 010 0802')$q$,
  'update_contact takes an email and a phone');
RESET ROLE;
SELECT is((SELECT array_agg(kind || ':' || value || ':' || is_primary ORDER BY kind, position) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000ce1'),
          ARRAY['email:eve@a.tests.invalid:false', 'email:eve.home@a.tests.invalid:true', 'phone:555 010 0802:true'],
          'and makes them the primaries, keeping every other address');

-- A data subject request, by the workspace owner.
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE cm_dsr_export AS
  SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce1', 'export', NULL, 'subject asked') AS r;
CREATE TEMP TABLE cm_dsr_correct AS
  SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce1', 'correct',
           '{"email":"eve.fixed@a.tests.invalid","zip":"30301","city":"Atlanta","favourite_colour":"red"}', NULL) AS r;
SELECT throws_like($q$SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce1', 'correct', '{"email":"dee@a.tests.invalid"}', NULL)$q$,
  'CONTACT_METHOD_TAKEN%', 'a correction to an address another contact holds is refused, not merged');
RESET ROLE;
SELECT is((SELECT jsonb_array_length(r->'data'->'contact_methods') FROM cm_dsr_export), 3,
          'an export carries every address the contact holds');
SELECT is((SELECT r->'applied' FROM cm_dsr_correct),
          '{"email":"eve.fixed@a.tests.invalid","zip_code":"30301","city":"Atlanta"}'::jsonb,
          'a correction applies the allowed fields under their real names and ignores the rest');
SELECT is((SELECT array_agg(value || ':' || is_primary ORDER BY position) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000ce1' AND kind = 'email'),
          ARRAY['eve@a.tests.invalid:false', 'eve.fixed@a.tests.invalid:true'],
          'a corrected email replaces the primary address and keeps the others');
SELECT is((SELECT zip_code || '|' || city FROM public.clients WHERE id = 'c3000000-0000-4000-8000-000000000ce1'),
          '30301|Atlanta', 'and the corrected columns are the contact''s real ones');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE cm_dsr_delete AS
  SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce1', 'delete', NULL, 'erase me') AS r;
RESET ROLE;
SELECT is((SELECT (r->>'addresses_removed')::int FROM cm_dsr_delete), 3, 'a deletion reports the addresses it removed');
SELECT is((SELECT count(*)::int FROM public.client_contact_methods WHERE client_id = 'c3000000-0000-4000-8000-000000000ce1'),
          0, 'and the contact holds no address afterwards');
SELECT is((SELECT first_name || '|' || last_name || '|' || status || '|' || coalesce(zip_code, '-') FROM public.clients WHERE id = 'c3000000-0000-4000-8000-000000000ce1'),
          'REDACTED|REDACTED|archived|-', 'the contact is redacted and archived');
SELECT is((SELECT count(*)::int FROM public.paige_audit_log
            WHERE target_id = 'c3000000-0000-4000-8000-000000000ce1' AND action LIKE 'dsr.%'
              AND tenant_id = 'c3000000-0000-4000-8000-00000000000a'),
          3, 'each request that ran is audited against the contact''s workspace');
SELECT is((SELECT array_agg(access_type ORDER BY access_type) FROM public.pii_access_log
            WHERE accessor_user_id = 'c3000000-0000-4000-8000-0000000000a1' AND table_name = 'clients'),
          ARRAY['read', 'update', 'update'], 'and logged as a read or an update of personal data');
SELECT is(has_function_privilege('anon', 'public.handle_data_subject_request(uuid, uuid, text, jsonb, text, uuid)', 'EXECUTE'),
          false, 'an anonymous caller cannot reach it');

-- Paige's MCP tool calls it with the service role (no session): the tenant it resolved and the
-- person it acts for are passed, and that person must hold the same authority in that tenant.
INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number) VALUES
  ('c3000000-0000-4000-8000-000000000ce3', 'c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a1', 'Fay', 'Field', 'CMA-11');
INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, label, is_primary, position) VALUES
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce3', 'email', 'fay@a.tests.invalid', 'Work', true, 0),
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce3', 'phone', '555 010 0901', 'Mobile', true, 0);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT throws_like($q$SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce3', 'correct', '{"city":"Macon"}', NULL)$q$,
  'actor_required%', 'the trusted caller must name the person the request is handled for');
SELECT throws_like($q$SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce3', 'delete', NULL, NULL, 'c3000000-0000-4000-8000-0000000000a3')$q$,
  'forbidden%', 'a plain member named by the trusted caller is refused, exactly as their own session would be');
SELECT throws_like($q$SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce3', 'delete', NULL, NULL, 'c3000000-0000-4000-8000-0000000000b1')$q$,
  'forbidden%', 'another workspace''s owner named by the trusted caller is refused');
CREATE TEMP TABLE cm_dsr_svc_correct AS
  SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce3', 'correct',
           '{"phone":"555 010 0902","state":"GA","email":"","city":null,"address_line2":"Apt 2"}', 'subject asked', 'c3000000-0000-4000-8000-0000000000a2') AS r;
RESET ROLE;
SELECT is((SELECT r->'applied' || jsonb_build_object('ignored', r->'ignored') FROM cm_dsr_svc_correct),
          '{"phone":"555 010 0902","state":"GA","ignored":["address_line2","city","email"]}'::jsonb,
          'the workspace admin''s correction, sent by the trusted caller, applies what it changes and names what it ignored');
SELECT is((SELECT array_agg(kind || ':' || value || ':' || is_primary ORDER BY kind, position) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000ce3'),
          ARRAY['email:fay@a.tests.invalid:true', 'phone:555 010 0902:true'],
          'the corrected phone replaces the primary phone; the blank email changes nothing');
SELECT is((SELECT state FROM public.clients WHERE id = 'c3000000-0000-4000-8000-000000000ce3'), 'GA',
          'and the corrected column is written');
SELECT is((SELECT actor_user_id::text || '|' || (payload->>'via') FROM public.paige_audit_log
            WHERE target_id = 'c3000000-0000-4000-8000-000000000ce3' AND action = 'dsr.correct'
              AND tenant_id = 'c3000000-0000-4000-8000-00000000000a'),
          'c3000000-0000-4000-8000-0000000000a2|service', 'the audit names the person it was handled for, and that it came through the trusted path');
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
CREATE TEMP TABLE cm_dsr_svc_delete AS
  SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ce3', 'delete', NULL, 'erase me', 'c3000000-0000-4000-8000-0000000000a1') AS r;
RESET ROLE;
SELECT is((SELECT (r->>'addresses_removed')::int FROM cm_dsr_svc_delete), 2, 'the trusted caller''s deletion removes every address');
SELECT is((SELECT first_name || '|' || status || '|' || (SELECT count(*) FROM public.client_contact_methods WHERE client_id = c.id)
             FROM public.clients c WHERE c.id = 'c3000000-0000-4000-8000-000000000ce3'),
          'REDACTED|archived|0', 'and redacts and archives the contact');
SELECT is((SELECT count(*)::int FROM public.pii_access_log WHERE accessor_user_id = 'c3000000-0000-4000-8000-0000000000a2'),
          1, 'the access log records the named person as the accessor');

-- A signed-in caller acts only as themselves, and only as a tenant admin.
SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_like($q$SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ca2', 'export', NULL, NULL)$q$,
  'forbidden%', 'a signed-in member who is not a workspace admin is refused');
SELECT throws_like($q$SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ca2', 'export', NULL, NULL, 'c3000000-0000-4000-8000-0000000000a1')$q$,
  'forbidden%', 'and naming the owner as the actor gains them nothing');
SELECT set_config('request.jwt.claims', '{"sub":"c3000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SELECT throws_like($q$SELECT public.handle_data_subject_request('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000ca2', 'export', NULL, NULL, 'c3000000-0000-4000-8000-0000000000a2')$q$,
  'forbidden: a signed-in caller acts only as themselves%', 'even the owner cannot name someone else as the actor');
RESET ROLE;

SELECT is(to_regprocedure('public.trg_clients_apollo_enrich()'), NULL::regprocedure,
          'the insert trigger that posted a new contact''s email to another project is gone');
SELECT set_config('request.jwt.claims', '', true);

-- ── 9. Adding addresses locks the contact first (20270519010000) ─────────────────────────────
-- The two-session race itself is proven by scripts/proof/contact-methods-add-race.mjs (a second
-- session cannot see this suite's uncommitted fixtures). Here: the lock comes before the read, a
-- contact outside the named workspace is refused before anything is read or written, the merge
-- rule is unchanged, and only the service role may call it.
SELECT ok((SELECT pg_catalog.strpos(p.prosrc, 'FOR UPDATE') > 0
              AND pg_catalog.strpos(p.prosrc, 'FOR UPDATE') < pg_catalog.strpos(p.prosrc, 'FROM public.client_contact_methods AS m WHERE m.client_id')
             FROM pg_proc p WHERE p.oid = 'public._add_client_contact_methods(uuid,uuid,jsonb)'::regprocedure),
          'an address add takes the contact''s row lock before it reads the contact''s list');
INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number) VALUES
  ('c3000000-0000-4000-8000-000000000cf1', 'c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-0000000000a1', 'Gus', 'Grow', 'CMA-19');
INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position) VALUES
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000cf1', 'email', 'gus@a.tests.invalid', true, 0),
  ('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000cf1', 'phone', '555 010 0919', true, 0);
CREATE TEMP TABLE cm_add_other_before AS
  SELECT kind, value, is_primary FROM public.client_contact_methods WHERE client_id = 'c3000000-0000-4000-8000-000000000cb1';
SET LOCAL ROLE service_role;
SELECT throws_like($q$SELECT public._add_client_contact_methods('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000cb1', '[{"kind":"email","value":"intruder@a.tests.invalid"}]')$q$,
  'CONTACT_NOT_FOUND_OR_FORBIDDEN%', 'an add naming a contact outside the given workspace is refused');
CREATE TEMP TABLE cm_add_result AS
  SELECT public._add_client_contact_methods('c3000000-0000-4000-8000-00000000000a', 'c3000000-0000-4000-8000-000000000cf1',
           '[{"kind":"email","value":"gus.work@a.tests.invalid","label":"Work"}]') AS r;
RESET ROLE;
SELECT is((SELECT array_agg(kind || ':' || value || ':' || is_primary ORDER BY kind, value) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000cb1'),
          (SELECT array_agg(kind || ':' || value || ':' || is_primary ORDER BY kind, value) FROM cm_add_other_before),
          'and the other workspace''s contact is untouched');
SELECT is((SELECT array_agg(kind || ':' || value || ':' || is_primary ORDER BY kind, value) FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000cf1'),
          ARRAY['email:gus.work@a.tests.invalid:false', 'email:gus@a.tests.invalid:true', 'phone:555 010 0919:true'],
          'an add keeps every address the contact held, and its primaries');
SELECT is((SELECT label FROM public.client_contact_methods
            WHERE client_id = 'c3000000-0000-4000-8000-000000000cf1' AND value = 'gus.work@a.tests.invalid'),
          'Work', 'and appends the new address as a secondary, with its label');
SELECT is(ARRAY[has_function_privilege('service_role', 'public._add_client_contact_methods(uuid,uuid,jsonb)', 'EXECUTE'),
                has_function_privilege('authenticated', 'public._add_client_contact_methods(uuid,uuid,jsonb)', 'EXECUTE'),
                has_function_privilege('anon', 'public._add_client_contact_methods(uuid,uuid,jsonb)', 'EXECUTE')],
          ARRAY[true, false, false], 'only the service role may add addresses directly');

SELECT * FROM finish();
ROLLBACK;
