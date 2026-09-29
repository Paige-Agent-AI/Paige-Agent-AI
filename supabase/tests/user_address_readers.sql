-- ============================================================================
-- Where a platform user's address is read from — executed proof for the three edge functions that
-- read it: ingest-rag-outcome, security-canary-probe, send-funding-report.
--
-- They selected `profiles.email`, a column that does not exist, so each read failed with 42703.
-- They now read `user_contact_methods` through `_shared/user-contact-methods.ts`. This proves, on
-- the schema the migrations build, that:
--   * the old read fails and the new reads run, as the service role the functions use;
--   * a person who signs up has exactly one primary email, their sign-in address, from the moment
--     the account exists — the guarantee the recipient lookups rely on;
--   * the canary's operator-role read runs, and the role list it used before could not.
--
-- Synthetic fixtures only. Rolls back.
-- ============================================================================
BEGIN;
SELECT plan(9);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('d4000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'addr-reader-a@tests.invalid'),
  ('d4000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'addr-reader-b@tests.invalid');

-- A phone for the first user, the way set_user_contact_methods leaves one: primary, position 0.
INSERT INTO public.user_contact_methods (user_id, kind, value, is_primary, position) VALUES
  ('d4000000-0000-4000-8000-0000000000a1', 'phone', '+1 (555) 010-0199', true, 0);

INSERT INTO public.user_roles (user_id, role) VALUES
  ('d4000000-0000-4000-8000-0000000000a2', 'platform_admin')
ON CONFLICT DO NOTHING;

SET LOCAL ROLE service_role;

-- ── 1. The old read cannot run ──────────────────────────────────────────────────────────────
SELECT hasnt_column('public', 'profiles', 'email', 'profiles has no email column');
SELECT throws_ok(
  $$ SELECT user_id, email, full_name FROM public.profiles LIMIT 1 $$,
  '42703', NULL,
  'the read the three functions used fails with undefined_column');

-- ── 2. Signing up gives a person exactly one primary email: their sign-in address ────────────
SELECT is(
  (SELECT count(*)::int FROM public.user_contact_methods
    WHERE user_id = 'd4000000-0000-4000-8000-0000000000a1' AND kind = 'email' AND is_primary),
  1, 'a new account has exactly one primary email');

-- ── 3. primaryEmailsForUsers: the query shape it sends ──────────────────────────────────────
SELECT results_eq(
  $$ SELECT user_id::text, value FROM public.user_contact_methods
      WHERE kind = 'email' AND is_primary
        AND user_id IN ('d4000000-0000-4000-8000-0000000000a1', 'd4000000-0000-4000-8000-0000000000a2')
      ORDER BY user_id $$,
  $$ VALUES ('d4000000-0000-4000-8000-0000000000a1', 'addr-reader-a@tests.invalid'),
            ('d4000000-0000-4000-8000-0000000000a2', 'addr-reader-b@tests.invalid') $$,
  'each user resolves to their own sign-in address as primary');

-- ── 4. contactMethodsForUser: every address the anonymizer must scrub ───────────────────────
SELECT results_eq(
  $$ SELECT kind, value FROM public.user_contact_methods
      WHERE user_id = 'd4000000-0000-4000-8000-0000000000a1' ORDER BY kind $$,
  $$ VALUES ('email', 'addr-reader-a@tests.invalid'), ('phone', '+1 (555) 010-0199') $$,
  'a person''s emails and phones are both returned');
SELECT lives_ok(
  $$ SELECT full_name FROM public.profiles WHERE user_id = 'd4000000-0000-4000-8000-0000000000a1' $$,
  'the name read ingest-rag-outcome keeps on profiles runs');

-- ── 5. The canary's recipient read ──────────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT user_id FROM public.user_roles WHERE role IN ('owner', 'super_admin', 'admin') $$,
  '22P02', NULL,
  'the role list the canary used before is not a valid query: owner is not a role');
SELECT lives_ok(
  $$ SELECT user_id FROM public.user_roles WHERE role IN ('super_admin', 'platform_admin') $$,
  'the operator role read runs');
SELECT ok(
  EXISTS (SELECT 1 FROM public.user_roles r
            JOIN public.user_contact_methods m ON m.user_id = r.user_id AND m.kind = 'email' AND m.is_primary
           WHERE r.role IN ('super_admin', 'platform_admin')
             AND r.user_id = 'd4000000-0000-4000-8000-0000000000a2'),
  'a platform operator resolves to a primary address');

SELECT * FROM finish();
ROLLBACK;
