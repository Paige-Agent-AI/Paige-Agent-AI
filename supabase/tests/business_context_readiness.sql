-- business_context.readiness contract: the grant surface, the two caller paths, the role gate,
-- the always-four-rows honesty invariant, and that no raw value ever crosses.
-- Synthetic fixtures; always rolled back.
--
-- The role gate is the reason this file exists in CI rather than only as a local proof. The first
-- draft of get_business_context_readiness had NO role gate: a workspace's own CLIENT is an
-- authenticated user of that same tenant, so current_user_tenant_id() resolved happily and handed
-- them their coach's setup readiness — while the capability declared audience: owner_internal. A
-- local proof that only tested cross-TENANT isolation passed the whole time. These assertions test
-- the role axis explicitly so that class cannot come back silently.
BEGIN;

SELECT plan(46);

-- ── Grant surface (§59 — the grant is never the guard, but it is still the outer boundary) ──
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_business_context_readiness(uuid)', 'EXECUTE'),
  'anonymous callers cannot execute the readiness contract'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.get_business_context_readiness(uuid)', 'EXECUTE'),
  'authenticated callers can reach the readiness contract'
);
SELECT ok(
  has_function_privilege('service_role', 'public.get_business_context_readiness(uuid)', 'EXECUTE'),
  'the service-role path stays open for the Systems Check runners'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_business_context_readiness(uuid)'::regprocedure),
  'contract is SECURITY DEFINER'
);
SELECT ok(
  (SELECT proconfig @> ARRAY['search_path=pg_catalog, public']
     FROM pg_proc WHERE oid = 'public.get_business_context_readiness(uuid)'::regprocedure),
  'contract pins its search path'
);

-- ── Fixtures: two tenants; tenant A has a coach AND a client, tenant B has its own coach ──
-- (seat-then-pointer ordering below is required by a real trigger — see the note there)
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'bcr-coach-a@tests.invalid'),
  ('b1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bcr-client-a@tests.invalid'),
  ('b2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'bcr-coach-b@tests.invalid');

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features, brand)
VALUES
  ('b1000000-0000-0000-0000-000000001111', 'bcr-contract-a', 'BCR Contract A', 'active', 'standalone', 'BCA', 8300001,
   '{}'::jsonb, jsonb_build_object('support_email', 'owner@bcr-a.invalid')),
  ('b2000000-0000-0000-0000-000000002222', 'bcr-contract-b', 'BCR Contract B', 'active', 'standalone', 'BCB', 8400002,
   '{}'::jsonb, '{}'::jsonb);

-- ORDER MATTERS, and it is not arbitrary (lessons-learned 0d): `trg_guard_active_tenant` refuses
-- an `active_tenant_id` pointed at a workspace where the user holds no seat, so the SEATS are
-- seeded FIRST and the pointer set after. And `INSERT INTO auth.users` already created the
-- `profiles` shell via `handle_new_user`, so the pointer is an UPDATE, never an INSERT.
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('b1000000-0000-0000-0000-000000001111', 'b1000000-0000-0000-0000-000000000001', 'owner', 'active', true, now()),
  ('b1000000-0000-0000-0000-000000001111', 'b1000000-0000-0000-0000-000000000002', 'member', 'active', false, now()),
  ('b2000000-0000-0000-0000-000000002222', 'b2000000-0000-0000-0000-000000000001', 'owner', 'active', true, now());

-- Upsert rather than a bare UPDATE: if `handle_new_user` did create the shell this updates it, and
-- if it did not, a bare UPDATE would touch 0 rows and leave the pointer NULL — a fixture that fails
-- for a reason that has nothing to do with what is under test.
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000001111'),
  ('b1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000001111'),
  ('b2000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000002222')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- The client is deliberately given a GLOBAL staff role while being only a 'member' of this
-- workspace. That is the §59 global-role trap in fixture form: a gate written against
-- has_any_role() would ADMIT this caller, because user_roles carries no tenant_id. The
-- tenant-scoped gate must still refuse them. Without this row the refusal assertions below would
-- pass for the wrong reason (no role at all) and could never catch a regression to a global check.
INSERT INTO public.user_roles (user_id, role) VALUES
  ('b1000000-0000-0000-0000-000000000001', 'admin'),
  ('b1000000-0000-0000-0000-000000000002', 'sales_rep'),
  ('b2000000-0000-0000-0000-000000000001', 'admin')
ON CONFLICT DO NOTHING;

-- Tenant A: website + industry owner-confirmed; a phone that is PRESENT but malformed.
-- (legal_business_name is NOT NULL on this table, and tenant_id is UNIQUE rather than the PK.)
INSERT INTO public.tenant_legal_profile
  (tenant_id, legal_business_name, website_url, support_phone, business_industry, setup_provenance)
VALUES
  ('b1000000-0000-0000-0000-000000001111', 'BCR Contract A LLC', 'https://bcr-a.invalid', '12', 'consulting',
   jsonb_build_object(
     'website',  jsonb_build_object('source','owner_confirmed','confidence','confirmed','confirmedAt','2026-09-01T00:00:00Z'),
     'industry', jsonb_build_object('source','owner_confirmed','confidence','confirmed','confirmedAt','2026-09-02T00:00:00Z')))
ON CONFLICT (tenant_id) DO UPDATE SET
  website_url = EXCLUDED.website_url, support_phone = EXCLUDED.support_phone,
  business_industry = EXCLUDED.business_industry, setup_provenance = EXCLUDED.setup_provenance;

-- Tenant B has a legal profile row with NOTHING filled in — the "genuinely empty Setup" case.
INSERT INTO public.tenant_legal_profile (tenant_id, legal_business_name)
VALUES ('b2000000-0000-0000-0000-000000002222', 'BCR Contract B LLC')
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO public.tenant_setup_business_context_meta
  (tenant_id, primary_email_snapshot, primary_email_provenance)
VALUES
  ('b1000000-0000-0000-0000-000000001111', 'owner@bcr-a.invalid',
   jsonb_build_object('source','owner_confirmed','confirmedAt','2026-09-01T00:00:00Z'))
ON CONFLICT (tenant_id) DO UPDATE SET
  primary_email_snapshot = EXCLUDED.primary_email_snapshot,
  primary_email_provenance = EXCLUDED.primary_email_provenance;

-- ── The tenant's own coach reads their real status ──────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

CREATE TEMP TABLE bcr_coach AS SELECT * FROM public.get_business_context_readiness();

SELECT is((SELECT count(*)::integer FROM bcr_coach), 4, 'exactly four rows, always — no signal is never an empty result');
SELECT is((SELECT status FROM bcr_coach WHERE field_key = 'website'), 'owner_confirmed', 'a saved website reads as owner-confirmed');
SELECT is((SELECT status FROM bcr_coach WHERE field_key = 'industry'), 'owner_confirmed', 'a saved industry reads as owner-confirmed');
SELECT is((SELECT status FROM bcr_coach WHERE field_key = 'business_phone'), 'invalid_format',
          'a present-but-malformed phone is invalid_format, never "missing" and never a silent pass');
SELECT ok(
  (SELECT row_to_json(bcr_coach)::text FROM bcr_coach WHERE field_key = 'website')
    !~* '(bcr-a\.invalid|https|consulting|owner@)',
  'no raw value crosses — status and provenance only'
);

SELECT is(
  (SELECT count(distinct tenant_id)::integer FROM bcr_coach), 1,
  'every row names ONE workspace, so a Chat caller can prove the rows are about this conversation'
);
SELECT is(
  (SELECT distinct tenant_id FROM bcr_coach), 'b1000000-0000-0000-0000-000000001111'::uuid,
  'and it is the workspace the read actually resolved'
);

-- ── The IDOR probe: a caller with an identity may never steer the tenant by argument ──
SELECT is(
  (SELECT status FROM public.get_business_context_readiness('b2000000-0000-0000-0000-000000002222')
    WHERE field_key = 'website'),
  'owner_confirmed',
  'a JWT caller passing another tenant id is ignored and still reads their OWN tenant (§9/§588)'
);

-- ── THE ROLE GATE: the same tenant's CLIENT is refused, and learns nothing ──────
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

CREATE TEMP TABLE bcr_client AS SELECT * FROM public.get_business_context_readiness();

SELECT is((SELECT count(*)::integer FROM bcr_client), 4, 'a refused caller still receives four rows, not an empty set');
SELECT ok(
  (SELECT bool_and(status = 'unavailable') FROM bcr_client),
  'a non-staff caller in the same workspace is refused every field, EVEN holding a global staff '
  'role — the gate is tenant-scoped, not global (§59 global-role trap)'
);
SELECT ok(
  (SELECT bool_and(reason = 'not permitted for this account') FROM bcr_client),
  'the refusal names itself, so a consumer can tell "may not" from "could not"'
);
SELECT ok(
  (SELECT bool_and(source IS NULL) FROM bcr_client),
  'a refusal leaks no provenance either'
);

-- ── Tenant B: genuinely empty Setup reads as needs_confirmation, not as unavailable ──
SELECT set_config('request.jwt.claims', '{"sub":"b2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT is(
  (SELECT status FROM public.get_business_context_readiness() WHERE field_key = 'website'),
  'needs_confirmation',
  'nothing entered yet is needs_confirmation — a normal state, distinct from a failed read'
);

-- ── The service-role path (no auth.uid()) is the ONLY one that may name a tenant ──
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '', true);

SELECT is(
  (SELECT status FROM public.get_business_context_readiness('b1000000-0000-0000-0000-000000001111')
    WHERE field_key = 'website'),
  'owner_confirmed',
  'the trusted service-role path honours an explicit tenant id (the Systems Check runners)'
);
SELECT is(
  (SELECT reason FROM public.get_business_context_readiness() WHERE field_key = 'website'),
  'workspace not resolved',
  'the service-role path with NO tenant argument refuses rather than guessing a tenant'
);

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- THE CANONICAL READINESS CONTRACT (migration 20261221000000)
--
-- Tenant C reproduces, synthetically, the exact production shape that made the two readers
-- contradict each other: every business value lives ONLY in the legacy tenants.brand record, with
-- no tenant_legal_profile row at all and therefore no confirmation event. On production this is
-- Antonio Daniel LLC and First Sterling Capital.
--
-- WITHOUT the correction these assertions fail, and they fail for the right reason: the old
-- get_business_context_readiness returned `needs_confirmation` for website and business_phone
-- ("there is no value") while tenant_comms_readiness returned has_website/has_phone = true ("there
-- is a value"), about the same workspace, in the same second. The FINAL assertion below states
-- that disagreement directly as an invariant over both readers, so a regression to either reader's
-- old shape breaks CI rather than waiting to be noticed on someone's screen.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('b3000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'bcr-coach-c@tests.invalid');

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features, brand)
VALUES
  ('b3000000-0000-0000-0000-000000003333', 'bcr-contract-c', 'BCR Contract C', 'active', 'standalone', 'BCC', 8500003,
   '{}'::jsonb,
   jsonb_build_object(
     'business_name',  'BCR Contract C Co',
     'website',        'https://bcr-c.invalid',
     'business_phone', '+1 555 010 2030',
     'industry',       'consulting',
     'support_email',  'owner@bcr-c.invalid'));

-- Seat first, pointer second (same trigger ordering as tenant A above).
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('b3000000-0000-0000-0000-000000003333', 'b3000000-0000-0000-0000-000000000001', 'owner', 'active', true, now());
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('b3000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000003333')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- tenant_comms_readiness gates on the GLOBAL predicate (§59) while get_business_context_readiness
-- gates tenant-scoped. This caller satisfies both, which is what lets one test compare the two
-- readers at all — and is exactly why the fix routes both through a shared resolver instead of
-- making one reader call the other and inherit the wrong gate.
INSERT INTO public.user_roles (user_id, role)
VALUES ('b3000000-0000-0000-0000-000000000001', 'admin') ON CONFLICT DO NOTHING;

-- NO tenant_legal_profile row and NO tenant_setup_business_context_meta row for tenant C: that
-- absence IS the fixture.

-- ── The internal resolver is unreachable by every caller role ────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.business_identity_readiness(uuid)', 'EXECUTE'),
  'the tenant-taking resolver is not executable by anon'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.business_identity_readiness(uuid)', 'EXECUTE'),
  'nor by authenticated — a caller can never supply the tenant it takes'
);
SELECT ok(
  NOT has_function_privilege('service_role', 'public.business_identity_readiness(uuid)', 'EXECUTE'),
  'nor by service_role — the readers reach it as their definer owner, not as a caller'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'public.business_identity_readiness(uuid)'::regprocedure),
  'the resolver is SECURITY DEFINER, so its callers reach it without holding a grant'
);

-- ── No scope resolved: five rows of `unknown`, never zero and never a fact ───────────────────
SELECT is(
  (SELECT count(*)::integer FROM public.business_identity_readiness(NULL)), 5,
  'with no workspace the resolver still answers for every fact — zero rows would read as nothing to do'
);
SELECT ok(
  (SELECT bool_and(state = 'unknown' AND reason IS NOT NULL AND next_action IS NOT NULL)
     FROM public.business_identity_readiness(NULL)),
  'and every one is `unknown` with a reason and a next step, never `needs_confirmation`'
);

-- ── Tenant C, read by its own owner ──────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"b3000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

CREATE TEMP TABLE bcr_legacy AS SELECT * FROM public.get_business_context_readiness();

SELECT is(
  (SELECT status FROM bcr_legacy WHERE field_key = 'website'), 'legacy_sourced',
  'a value that exists ONLY in the legacy brand record is legacy_sourced, NOT needs_confirmation'
);
SELECT is(
  (SELECT source FROM bcr_legacy WHERE field_key = 'website'), 'legacy_brand',
  'and it names the record that actually proves it'
);
SELECT ok(
  (SELECT as_of IS NULL FROM bcr_legacy WHERE field_key = 'website'),
  'with no confirmation time, because no confirmation ever happened — an invented timestamp would be the same lie as an invented status'
);
SELECT is(
  (SELECT status FROM bcr_legacy WHERE field_key = 'business_phone'), 'legacy_sourced',
  'the same for a phone held only in the legacy record'
);
-- DELIBERATELY asserts the UNCHANGED behaviour, and the comment says why so nobody "fixes" it.
-- An unrecorded provenance still reports connection_sourced. That is not fully honest, and it is
-- left alone on purpose: Setup reads this same field independently (get_solo_business_context and
-- useSoloBusinessContext) and makes the SAME inference, so flipping it here alone would make PAIGE
-- and the Setup badge disagree about one field in the same second — the defect this file exists to
-- catch, newly created by the fix. The correction moves all three together, in its own slice.
SELECT is(
  (SELECT status FROM bcr_legacy WHERE field_key = 'primary_business_email'), 'connection_sourced',
  'primary_business_email is untouched by this migration — its correction is unbundled, see the migration header'
);
SELECT ok(
  (SELECT row_to_json(bcr_legacy)::text FROM bcr_legacy WHERE field_key = 'website')
    !~* '(bcr-c\.invalid|555 010|owner@)',
  'and still no raw value crosses'
);

-- ── Every state answers "what must the owner do next?" ───────────────────────────────────────
SELECT ok(
  (SELECT next_action IS NOT NULL FROM bcr_legacy WHERE field_key = 'website'),
  'legacy_sourced carries a next step — a value nobody confirmed is actionable'
);

-- ── Both readers, same workspace, same second ────────────────────────────────────────────────
CREATE TEMP TABLE bcr_comms AS SELECT public.tenant_comms_readiness() AS j;

SELECT is(
  (SELECT (j -> 'business' ->> 'has_website') FROM bcr_comms), 'true',
  'fact A is unchanged: the comms reader still says a website is on file'
);
SELECT is(
  (SELECT (j -> 'business_provenance' -> 'website' ->> 'state') FROM bcr_comms),
  (SELECT status FROM bcr_legacy WHERE field_key = 'website'),
  'fact B is now present AND identical to the other reader''s answer for the same field'
);
SELECT is(
  (SELECT (j -> 'business_provenance' -> 'business_phone' ->> 'state') FROM bcr_comms),
  (SELECT status FROM bcr_legacy WHERE field_key = 'business_phone'),
  'and for the phone too — one resolver, so they cannot diverge'
);
SELECT is(
  (SELECT (j -> 'business_provenance' -> 'website' ->> 'source') FROM bcr_comms), 'legacy_brand',
  'the comms reader now names the source it used to omit entirely'
);
SELECT ok(
  (SELECT (j -> 'business_provenance' -> 'website' ->> 'next_action') IS NOT NULL FROM bcr_comms),
  'and carries the same next step, so the two surfaces cannot tell the owner different things'
);
SELECT is(
  (SELECT (j ->> 'tenant_id') FROM bcr_comms), 'b3000000-0000-0000-0000-000000003333',
  'and the payload names the workspace it resolved, so a container can bind it before painting'
);

-- ── THE REGRESSION ASSERTION ─────────────────────────────────────────────────────────────────
-- Stated over BOTH readers at once, in two directions, because ONE direction of it could pass for
-- the wrong reason.
--
-- The AGREEMENT count comes first and is the one that fails before the fix: it requires exactly two
-- fields where BOTH readers say a value is on file. Before migration 20261221000000 the row reader
-- said `needs_confirmation` for both, so this returns 0 and the test goes red. It is also the guard
-- on the assertion below it — a count of 2 cannot be produced by an empty fixture, so neither
-- assertion can pass by examining nothing.
SELECT is(
  (SELECT count(*)::integer
     FROM bcr_legacy r, bcr_comms c
    WHERE (r.field_key = 'website'
             AND r.status <> 'needs_confirmation'
             AND (c.j -> 'business' ->> 'has_website') = 'true')
       OR (r.field_key = 'business_phone'
             AND r.status <> 'needs_confirmation'
             AND (c.j -> 'business' ->> 'has_phone') = 'true')),
  2,
  'both readers agree a value IS on file for website and phone — the answer that used to be split'
);

-- And the invariant itself: no field may read as "no value anywhere" in one reader while the other
-- says a value is on file. That contradiction is what opened this work.
SELECT is(
  (SELECT count(*)::integer
     FROM bcr_legacy r, bcr_comms c
    WHERE (r.field_key = 'website'
             AND r.status = 'needs_confirmation'
             AND (c.j -> 'business' ->> 'has_website') = 'true')
       OR (r.field_key = 'business_phone'
             AND r.status = 'needs_confirmation'
             AND (c.j -> 'business' ->> 'has_phone') = 'true')),
  0,
  'NO field may read as "no value anywhere" in one reader while the other says a value is on file'
);

-- ── The agreement holds on the negative side too: genuinely empty Setup ──────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"b2000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

CREATE TEMP TABLE bcr_empty_comms AS SELECT public.tenant_comms_readiness() AS j;

SELECT is(
  (SELECT (j -> 'business' ->> 'has_website') FROM bcr_empty_comms), 'false',
  'a workspace with nothing anywhere still reads as no website on file'
);
SELECT is(
  (SELECT (j -> 'business_provenance' -> 'website' ->> 'state') FROM bcr_empty_comms), 'needs_confirmation',
  'and its state agrees with the other reader — absence is needs_confirmation, never confirmed and never unavailable'
);
SELECT ok(
  (SELECT (j -> 'business_provenance' -> 'website' ->> 'source') IS NULL FROM bcr_empty_comms),
  'with no source, because nothing proves it'
);

-- The next-step half of the contract, asserted HERE rather than on tenant C.
--
-- This assertion first ran inside the tenant-C block, where it was VACUOUS and CI caught it: every
-- one of tenant C's facts lives in the legacy record, so `WHERE status = 'needs_confirmation'`
-- matched no rows, `bool_and()` over the empty set returned NULL, and pgTAP failed it. That is the
-- same defect class this whole migration exists to fix — an empty result read as though it were an
-- answer — so it is fixed the same way rather than loosened: asserted against the workspace that
-- genuinely HAS the state, and as an exact COUNT, which an empty set can never satisfy.
SELECT is(
  (SELECT count(*)::integer FROM public.get_business_context_readiness()
    WHERE status = 'needs_confirmation' AND next_action IS NOT NULL),
  4,
  'a workspace with nothing on file gets four needs_confirmation rows and a next step on every one'
);

-- ── A refusal still answers every question it is allowed to answer ───────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT ok(
  (SELECT bool_and(next_action IS NOT NULL AND status = 'unavailable')
     FROM public.get_business_context_readiness()),
  'a refused caller gets a next step that tells the consumer NOT to treat the field as missing'
);

SELECT * FROM finish();
ROLLBACK;
