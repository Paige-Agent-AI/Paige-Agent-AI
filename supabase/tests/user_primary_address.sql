-- ============================================================================
-- A person's primary address, set by the server (20270519005000) — executed proof.
--
-- _set_user_primary_address(_user_id, _kind, _value) is what provider webhooks, Paige's write-back
-- and the credit-report import call to make a number or email a person's primary. It replaces a
-- read-then-upsert in the edge helper that wrote back the old primary's label, value and position as
-- it had READ them, so a relabel saved in between was silently undone. Here:
--   * a new address becomes primary and the old primary stays on the list, keeping its label and
--     position as they are at the time of the change (not as some earlier reader saw them);
--   * an address the person already holds, in any formatting, is promoted, never added twice;
--   * the address that is already primary, a blank value, or whitespace changes nothing;
--   * a person with none of that kind gets it as their first, primary address;
--   * a refused value writes nothing;
--   * it takes the same per-person lock set_user_contact_methods takes;
--   * only the service role may call it, and never with a signed-in person's identity.
--
-- Synthetic fixtures only. Rolls back.
-- ============================================================================
BEGIN;
SELECT plan(22);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('e7000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'upa-one@tests.invalid'),
  ('e7000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'upa-two@tests.invalid');

-- Person one holds two phones: a labelled primary and a second number.
DELETE FROM public.user_contact_methods WHERE user_id = 'e7000000-0000-4000-8000-0000000000a1' AND kind = 'phone';
INSERT INTO public.user_contact_methods (id, user_id, kind, value, label, is_primary, position) VALUES
  ('e7000000-0000-4000-8000-000000000f01', 'e7000000-0000-4000-8000-0000000000a1', 'phone', '(555) 010-0101', 'Mobile', true, 0),
  ('e7000000-0000-4000-8000-000000000f02', 'e7000000-0000-4000-8000-0000000000a1', 'phone', '555-010-0102', NULL, false, 1);
-- Person two has no phone.
DELETE FROM public.user_contact_methods WHERE user_id = 'e7000000-0000-4000-8000-0000000000a2' AND kind = 'phone';

-- ── 1. The grant ────────────────────────────────────────────────────────────────────────────
SELECT ok(has_function_privilege('service_role', 'public._set_user_primary_address(uuid,text,text)', 'EXECUTE'),
          'the service role may set a person''s primary address');
SELECT ok(NOT has_function_privilege('authenticated', 'public._set_user_primary_address(uuid,text,text)', 'EXECUTE'),
          'a signed-in browser may not (it saves its own list through set_user_contact_methods)');
SELECT ok(NOT has_function_privilege('anon', 'public._set_user_primary_address(uuid,text,text)', 'EXECUTE'),
          'nor may an anonymous one');

-- ── 2. A relabel saved before the change survives it ────────────────────────────────────────
-- Another session relabels and moves the current primary. The old edge helper read the list first
-- and then wrote the demoted primary back as it had read it ('Mobile', position 0).
UPDATE public.user_contact_methods SET label = 'Work', position = 5 WHERE id = 'e7000000-0000-4000-8000-000000000f01';

SET LOCAL ROLE service_role;
SELECT lives_ok($q$SELECT public._set_user_primary_address('e7000000-0000-4000-8000-0000000000a1', 'phone', '  555-010-0199 ')$q$,
                'a new number is set as primary');
RESET ROLE;

SELECT is((SELECT value FROM public.user_contact_methods
            WHERE user_id = 'e7000000-0000-4000-8000-0000000000a1' AND kind = 'phone' AND is_primary),
          '555-010-0199', 'the new number, trimmed, is the primary');
SELECT is((SELECT label || '/' || position::text || '/' || is_primary::text FROM public.user_contact_methods
            WHERE id = 'e7000000-0000-4000-8000-000000000f01'),
          'Work/5/false', 'the old primary stays on the list with the label and position saved since, not a stale copy');
SELECT is((SELECT position FROM public.user_contact_methods
            WHERE user_id = 'e7000000-0000-4000-8000-0000000000a1' AND value = '555-010-0199'),
          6, 'the new number is placed after every number already held');
SELECT is((SELECT label FROM public.user_contact_methods
            WHERE user_id = 'e7000000-0000-4000-8000-0000000000a1' AND value = '555-010-0199'),
          NULL::text, 'and carries no label');
SELECT is((SELECT count(*)::int FROM public.user_contact_methods
            WHERE user_id = 'e7000000-0000-4000-8000-0000000000a1' AND kind = 'phone'),
          3, 'nothing was removed');

-- ── 3. A number already held is promoted, never added twice ─────────────────────────────────
SET LOCAL ROLE service_role;
SELECT lives_ok($q$SELECT public._set_user_primary_address('e7000000-0000-4000-8000-0000000000a1', 'phone', '+1 555 010 0102')$q$,
                'a number the person holds, formatted differently, is set as primary');
RESET ROLE;
SELECT is((SELECT id::text FROM public.user_contact_methods
            WHERE user_id = 'e7000000-0000-4000-8000-0000000000a1' AND kind = 'phone' AND is_primary),
          'e7000000-0000-4000-8000-000000000f02', 'the number they held is now primary');
SELECT is((SELECT value || '/' || position::text FROM public.user_contact_methods WHERE id = 'e7000000-0000-4000-8000-000000000f02'),
          '555-010-0102/1', 'keeping its stored value and position');
SELECT is((SELECT count(*)::int FROM public.user_contact_methods
            WHERE user_id = 'e7000000-0000-4000-8000-0000000000a1' AND kind = 'phone'),
          3, 'and no duplicate was added');

-- ── 4. What changes nothing ─────────────────────────────────────────────────────────────────
-- xmin moves on any rewrite of a row, even one that writes the same values.
SELECT set_config('upa.before', (SELECT string_agg(id::text || ':' || value || ':' || COALESCE(label, '') || ':' || is_primary::text || ':' || position::text || ':' || xmin::text, ',' ORDER BY id)
                                    FROM public.user_contact_methods WHERE user_id = 'e7000000-0000-4000-8000-0000000000a1'), true);
SET LOCAL ROLE service_role;
SELECT public._set_user_primary_address('e7000000-0000-4000-8000-0000000000a1', 'phone', '555.010.0102');
SELECT public._set_user_primary_address('e7000000-0000-4000-8000-0000000000a1', 'phone', '   ');
SELECT public._set_user_primary_address('e7000000-0000-4000-8000-0000000000a1', 'phone', NULL);
RESET ROLE;
SELECT is((SELECT string_agg(id::text || ':' || value || ':' || COALESCE(label, '') || ':' || is_primary::text || ':' || position::text || ':' || xmin::text, ',' ORDER BY id)
             FROM public.user_contact_methods WHERE user_id = 'e7000000-0000-4000-8000-0000000000a1'),
          current_setting('upa.before'), 'the current primary, a blank value and no value leave the list untouched');

-- ── 5. A first number ───────────────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;
SELECT public._set_user_primary_address('e7000000-0000-4000-8000-0000000000a2', 'phone', '555-010-0201');
RESET ROLE;
SELECT is((SELECT value || '/' || is_primary::text || '/' || position::text FROM public.user_contact_methods
            WHERE user_id = 'e7000000-0000-4000-8000-0000000000a2' AND kind = 'phone'),
          '555-010-0201/true/0', 'a person with no phone gets their first one as primary');

-- ── 6. Refusals ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT public._set_user_primary_address('e7000000-0000-4000-8000-0000000000a2', 'phone', '12345')$q$,
                 '23514', NULL, 'a number the table refuses fails the call');
SELECT throws_ok($q$SELECT public._set_user_primary_address('e7000000-0000-4000-8000-0000000000a2', 'fax', '555-010-0299')$q$,
                 '22023', NULL, 'an address is an email or a phone');
SELECT throws_ok($q$SELECT public._set_user_primary_address(NULL, 'phone', '555-010-0299')$q$,
                 '22023', NULL, 'an address belongs to a person');
SELECT set_config('request.jwt.claims', '{"sub":"e7000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
SELECT throws_ok($q$SELECT public._set_user_primary_address('e7000000-0000-4000-8000-0000000000a2', 'phone', '555-010-0299')$q$,
                 '42501', NULL, 'a call that carries a signed-in person''s identity is refused');
SELECT set_config('request.jwt.claims', '', true);
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.user_contact_methods
            WHERE user_id = 'e7000000-0000-4000-8000-0000000000a2' AND kind = 'phone'),
          1, 'no refused call wrote an address');

-- ── 7. The same lock as a checked save of the whole list ────────────────────────────────────
SET LOCAL ROLE service_role;
SELECT public._set_user_primary_address('e7000000-0000-4000-8000-0000000000a2', 'email', 'upa-two.second@tests.invalid');
RESET ROLE;
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_locks AS l
                   WHERE l.locktype = 'advisory' AND l.pid = pg_catalog.pg_backend_pid() AND l.objsubid = 1
                     AND ((l.classid::bigint << 32) | l.objid::bigint)
                         = pg_catalog.hashtextextended('user_contact_methods:' || 'e7000000-0000-4000-8000-0000000000a2', 0)),
          'it holds the per-person lock set_user_contact_methods takes, until the transaction ends');
SELECT is((SELECT value FROM public.user_contact_methods
            WHERE user_id = 'e7000000-0000-4000-8000-0000000000a2' AND kind = 'email' AND is_primary),
          'upa-two.second@tests.invalid', 'an email is set as primary the same way');

SELECT * FROM finish();
ROLLBACK;
