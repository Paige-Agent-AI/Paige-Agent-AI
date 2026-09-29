-- ============================================================================
-- Contact methods: concurrent saves (20270518000000) — executed proof.
--
-- A save that would silently overwrite someone else's change is refused:
--   * a person's list: set_user_contact_methods compares the list the caller loaded with what is
--     stored, and refuses any difference as CONTACT_METHODS_STALE;
--   * a client's list: upsert_contact requires the version the caller loaded to replace it, and
--     every address change — including an address attached by inbound recognition — moves that
--     version, so a stale save is refused rather than dropping the new address;
--   * an admin edits the owner's list (owner ruling 2026-09-29), and the edit is attributed to the
--     admin in audit_logs.
--
-- `now()` is fixed for a transaction, so staleness is observed against fixtures inserted with a
-- past updated_at (update_clients_updated_at stamps updates, not inserts).
--
-- Synthetic fixtures only. Rolls back.
-- ============================================================================
BEGIN;
SELECT plan(15);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('e5000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'cc-owner@tests.invalid'),
  ('e5000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'cc-admin@tests.invalid'),
  ('e5000000-0000-4000-8000-0000000000a3', 'authenticated', 'authenticated', 'cc-member@tests.invalid');

INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, account_number, features) VALUES
  ('e5000000-0000-4000-8000-00000000000a', 'contact-concurrency', 'Contact Concurrency', 'active', 'standalone', 'CCA', 9330001, '{}'::jsonb);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-0000000000a1', 'owner', 'active', true, now() - interval '3 days'),
  ('e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-0000000000a2', 'admin', 'active', false, now() - interval '2 days'),
  ('e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-0000000000a3', 'member', 'active', false, now() - interval '1 day');

INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('e5000000-0000-4000-8000-0000000000a1', 'e5000000-0000-4000-8000-00000000000a'),
  ('e5000000-0000-4000-8000-0000000000a2', 'e5000000-0000-4000-8000-00000000000a'),
  ('e5000000-0000-4000-8000-0000000000a3', 'e5000000-0000-4000-8000-00000000000a')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

INSERT INTO public.user_roles (user_id, role) VALUES ('e5000000-0000-4000-8000-0000000000a1', 'admin') ON CONFLICT DO NOTHING;

-- Three contacts last changed in the past, each holding one email.
INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, updated_at) VALUES
  ('e5000000-0000-4000-8000-000000000c01', 'e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-0000000000a1', 'Fresh', 'Save', 'CCA-1', '2026-01-01T00:00:00Z'),
  ('e5000000-0000-4000-8000-000000000c02', 'e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-0000000000a1', 'Stale', 'Save', 'CCA-2', '2026-01-01T00:00:00Z'),
  ('e5000000-0000-4000-8000-000000000c03', 'e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-0000000000a1', 'No', 'Version', 'CCA-3', '2026-01-01T00:00:00Z');
INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position) VALUES
  ('e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-000000000c01', 'email', 'fresh@cc.tests.invalid', true, 0),
  ('e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-000000000c02', 'email', 'stale@cc.tests.invalid', true, 0),
  ('e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-000000000c03', 'email', 'none@cc.tests.invalid', true, 0);
-- Those inserts moved each contact's version; set it back to the past the editor "loaded".
ALTER TABLE public.clients DISABLE TRIGGER update_clients_updated_at;
UPDATE public.clients SET updated_at = '2026-01-01T00:00:00Z' WHERE tenant_id = 'e5000000-0000-4000-8000-00000000000a';
ALTER TABLE public.clients ENABLE TRIGGER update_clients_updated_at;

-- ── 1. The comparison ───────────────────────────────────────────────────────────────────────
SELECT is(public.contact_methods_fingerprint('[{"kind":"phone","value":"555 010 0100"},{"kind":"email","value":"a@x.invalid","is_primary":true},{"kind":"email","value":"b@x.invalid"}]'),
          public.contact_methods_fingerprint('[{"kind":"email","value":"a@x.invalid","is_primary":true},{"kind":"email","value":"b@x.invalid"},{"kind":"phone","value":"555 010 0100","is_primary":true}]'),
          'the same list is the same however the kinds interleave');
SELECT isnt(public.contact_methods_fingerprint('[{"kind":"email","value":"a@x.invalid","label":"Work"}]'),
            public.contact_methods_fingerprint('[{"kind":"email","value":"a@x.invalid","label":"Home"}]'),
            'a relabelled address is a different list');
SELECT isnt(public.contact_methods_fingerprint('[{"kind":"email","value":"a@x.invalid","is_primary":true},{"kind":"email","value":"b@x.invalid"},{"kind":"email","value":"c@x.invalid"}]'),
            public.contact_methods_fingerprint('[{"kind":"email","value":"a@x.invalid","is_primary":true},{"kind":"email","value":"c@x.invalid"},{"kind":"email","value":"b@x.invalid"}]'),
            'a reordered list is a different list');

-- ── 2. A person's list ──────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"e5000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.set_user_contact_methods('e5000000-0000-4000-8000-0000000000a3',
  '[{"kind":"email","value":"cc-member@tests.invalid","label":"Sign-in","is_primary":true},{"kind":"email","value":"member.second@tests.invalid","label":"Work"}]',
  '[{"kind":"email","value":"cc-member@tests.invalid","label":"Sign-in","is_primary":true}]')$q$,
  'a member adds a second email to the list they loaded');
SELECT throws_ok($q$SELECT public.set_user_contact_methods('e5000000-0000-4000-8000-0000000000a3',
  '[{"kind":"email","value":"cc-member@tests.invalid","label":"Sign-in","is_primary":true}]', NULL)$q$,
  '22023', 'CONTACT_METHODS_EXPECTED_REQUIRED', 'a save that names no loaded list is refused');

SELECT set_config('request.jwt.claims', '{"sub":"e5000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SELECT throws_like($q$SELECT public.set_user_contact_methods('e5000000-0000-4000-8000-0000000000a3',
  '[{"kind":"email","value":"cc-member@tests.invalid","label":"Sign-in","is_primary":true},{"kind":"phone","value":"555 010 0200"}]',
  '[{"kind":"email","value":"cc-member@tests.invalid","label":"Sign-in","is_primary":true}]')$q$,
  'CONTACT_METHODS_STALE%', 'an admin saving over a list the member changed since it was loaded is refused');
RESET ROLE;
SELECT is((SELECT array_agg(value ORDER BY position) FROM public.user_contact_methods WHERE user_id = 'e5000000-0000-4000-8000-0000000000a3' AND kind = 'email'),
          ARRAY['cc-member@tests.invalid', 'member.second@tests.invalid'], 'and the member''s second email survives');
SELECT is((SELECT count(*)::int FROM public.user_contact_methods WHERE user_id = 'e5000000-0000-4000-8000-0000000000a3' AND kind = 'phone'),
          0, 'and the stale save wrote nothing');

-- ── 3. An admin edits the owner's list, attributed ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.set_user_contact_methods('e5000000-0000-4000-8000-0000000000a1',
  '[{"kind":"email","value":"cc-owner@tests.invalid","label":"Sign-in","is_primary":true},{"kind":"phone","value":"555 010 0300","label":"Mobile"}]',
  '[{"kind":"email","value":"cc-owner@tests.invalid","label":"Sign-in","is_primary":true}]')$q$,
  'an admin edits the owner''s addresses');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.audit_logs
            WHERE action = 'contact_methods_updated' AND entity = 'user'
              AND user_id = 'e5000000-0000-4000-8000-0000000000a2'
              AND entity_id = 'e5000000-0000-4000-8000-0000000000a1'
              AND (data->>'self')::boolean = false
              AND data->>'tenant_id' = 'e5000000-0000-4000-8000-00000000000a'),
          1, 'and the audit trail records the admin as who changed whose, in which workspace');

-- ── 4. A client's list ──────────────────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"e5000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT lives_ok($q$SELECT public.upsert_contact(jsonb_build_object(
    'contact_methods', '[{"kind":"email","value":"fresh@cc.tests.invalid","is_primary":true},{"kind":"email","value":"fresh.second@cc.tests.invalid"}]'::jsonb,
    'expected_updated_at', '2026-01-01T00:00:00Z'), 'e5000000-0000-4000-8000-000000000c01')$q$,
  'replacing a list with the version that was loaded succeeds');
SELECT throws_like($q$SELECT public.upsert_contact('{"contact_methods":[{"kind":"email","value":"none@cc.tests.invalid","is_primary":true},{"kind":"email","value":"x@cc.tests.invalid"}]}'::jsonb, 'e5000000-0000-4000-8000-000000000c03')$q$,
  'CONTACT_EXPECTED_VERSION_REQUIRED%', 'replacing an existing contact''s list without a version is refused');
RESET ROLE;

-- Inbound recognition attaches an address while an editor holds the old version.
SELECT public._attach_client_address('e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-000000000c02', 'email', 'stale.inbound@cc.tests.invalid');
SELECT isnt((SELECT updated_at FROM public.clients WHERE id = 'e5000000-0000-4000-8000-000000000c02'),
            '2026-01-01T00:00:00Z'::timestamptz, 'an attached address moves the contact''s version');
SET LOCAL ROLE authenticated;
SELECT throws_like($q$SELECT public.upsert_contact(jsonb_build_object(
    'contact_methods', '[{"kind":"email","value":"stale@cc.tests.invalid","is_primary":true}]'::jsonb,
    'expected_updated_at', '2026-01-01T00:00:00Z'), 'e5000000-0000-4000-8000-000000000c02')$q$,
  'CONTACT_METHODS_STALE%', 'a save from the old version is refused');
RESET ROLE;
SELECT is((SELECT array_agg(value ORDER BY position) FROM public.client_contact_methods WHERE client_id = 'e5000000-0000-4000-8000-000000000c02'),
          ARRAY['stale@cc.tests.invalid', 'stale.inbound@cc.tests.invalid'], 'and the recognised address survives');
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();
ROLLBACK;
