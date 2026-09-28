-- A1: the owner's registered address, business phone and website never reach a customer unless
-- the owner put them there. outbound_private_business_facts_found() is the check every
-- customer-bound exit asks. This proves what it finds (every stored copy, every usual way of
-- writing each fact), what it deliberately does not (a city, a partial number, the business's
-- e-mail address, a longer domain), that the owner's own words are exempt per value, that it reads
-- only the tenant it is given, and that nobody but the server may ask it.
BEGIN;
SELECT plan(37);

-- ── Grants ──────────────────────────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege(r.rolname, f.fn, 'EXECUTE'),
  format('%s cannot execute %s', r.rolname, f.fn))
FROM (VALUES ('anon'), ('authenticated')) r(rolname)
CROSS JOIN (VALUES ('public.outbound_private_business_facts_found(uuid,text[],text[])'),
                   ('public.outbound_fact_street_text(text)'),
                   ('public.outbound_fact_digit_runs(text)'),
                   ('public.outbound_fact_website_host(text)')) f(fn);
SELECT ok(has_function_privilege('service_role',
  'public.outbound_private_business_facts_found(uuid,text[],text[])', 'EXECUTE'),
  'the server (service_role) can ask the check');

-- ── Fixtures: A holds every kind of stored copy; B holds its own; C holds nothing. ──────────
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('0c1a0000-0000-4000-8000-000000000001','authenticated','authenticated','facts-owner-a@tests.invalid'),
  ('0c1a0000-0000-4000-8000-000000000002','authenticated','authenticated','facts-owner-b@tests.invalid'),
  ('0c1a0000-0000-4000-8000-000000000003','authenticated','authenticated','facts-owner-c@tests.invalid');
INSERT INTO public.tenants (id, slug, name, owner_user_id, status, account_type, features, brand) VALUES
  ('0c1a0000-0000-4000-8000-00000000a001','facts-proof-a','Facts Proof A','0c1a0000-0000-4000-8000-000000000001',
   'active','standalone','{}'::jsonb,
   jsonb_build_object('address','7 Legacy Lane, Bristol',
                      'business_brief', jsonb_build_object('website','https://proof-business.example'))),
  ('0c1a0000-0000-4000-8000-00000000a002','facts-proof-b','Facts Proof B','0c1a0000-0000-4000-8000-000000000002',
   'active','standalone','{}'::jsonb,'{}'::jsonb),
  ('0c1a0000-0000-4000-8000-00000000a003','facts-proof-c','Facts Proof C','0c1a0000-0000-4000-8000-000000000003',
   'active','standalone','{}'::jsonb,'{}'::jsonb);
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('0c1a0000-0000-4000-8000-00000000a001','0c1a0000-0000-4000-8000-000000000001','owner','active',true,now()),
  ('0c1a0000-0000-4000-8000-00000000a002','0c1a0000-0000-4000-8000-000000000002','owner','active',true,now()),
  ('0c1a0000-0000-4000-8000-00000000a003','0c1a0000-0000-4000-8000-000000000003','owner','active',true,now());
INSERT INTO public.tenant_legal_profile (tenant_id, legal_business_name, registered_street,
    registered_street_secondary, registered_postal_code, support_phone, website_url) VALUES
  ('0c1a0000-0000-4000-8000-00000000a001','Proof Legal Ltd','221B Baker Street','Suite 4','NW1 6XE',
   '+44 20 7946 0001','https://www.proof-business.example/about'),
  ('0c1a0000-0000-4000-8000-00000000a002','Other Legal Ltd','99 Other Avenue',NULL,NULL,
   '+44 161 496 0000','https://other-tenant.example');
-- The private Setup brief carries a second, single-line address and a phone with an extension,
-- neither confirmed: a value the owner has not confirmed is still theirs.
INSERT INTO public.tenant_setup_private_context (tenant_id, private_brief, setup_provenance) VALUES
  ('0c1a0000-0000-4000-8000-00000000a001',
   jsonb_build_object('address','Flat 3, 48 Orchard Road, Leeds, LS1 4AB','phone','+1 (555) 123-4567 ext 89'),
   jsonb_build_object('address', jsonb_build_object('source','needs_confirmation','confidence','unknown'),
                      'phone',   jsonb_build_object('source','needs_confirmation','confidence','unknown')));

-- ── What it finds (the server's own call) ───────────────────────────────────────────────────
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE TEMP TABLE t AS SELECT '0c1a0000-0000-4000-8000-00000000a001'::uuid AS a,
  '0c1a0000-0000-4000-8000-00000000a002'::uuid AS b, '0c1a0000-0000-4000-8000-00000000a003'::uuid AS c;

SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t),
    ARRAY['Visit 221B Baker St., call 020 7946 0001, or see www.proof-business.example']),
  ARRAY['address','phone','website'],
  'all three facts in one draft are found, reported in a fixed order');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t),
    ARRAY['Thanks for your time today. Your next session is on Tuesday at 10.']),
  '{}'::text[], 'a draft carrying none of them passes');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t),
    ARRAY['Hi Maya,', 'Our office is at 221B Baker Street if you want to drop the forms off.']),
  ARRAY['address'], 'a fact in any one of the texts (subject or body) is found');

-- Address: every stored copy, however it is written.
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Meet me at 48 orchard rd.']),
  ARRAY['address'], 'a part of a single-line address is found, street words shortened on both sides');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Drop it at 7 Legacy Ln, Bristol']),
  ARRAY['address'], 'the legacy address left in the brand is found');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Post it to NW1 6XE.']),
  ARRAY['address'], 'a postal code with letters and digits is found');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t),
    ARRAY['We work with clients across Leeds, Bristol and London.']),
  '{}'::text[], 'a city on its own names a place, not this business, and passes');

-- Phone: every usual way of writing it.
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Call (020) 7946-0001 any time.']),
  ARRAY['phone'], 'the phone written domestically, with brackets and a dash, is found');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Call +44.20.7946.0001']),
  ARRAY['phone'], 'the phone written internationally with dots is found');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Or ring 555-123-4567.']),
  ARRAY['phone'], 'a stored phone with an extension is found without it');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Your booking code is 0001, room 7946.']),
  '{}'::text[], 'fragments of the number are not the number');

-- Website: the whole host, and nothing that merely contains it.
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Book at https://proof-business.example/book']),
  ARRAY['website'], 'the website with a scheme and a path is found');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Everything is on proof-business.example.']),
  ARRAY['website'], 'the website at the end of a sentence is found');
-- The business's e-mail address is a different fact, already in PAIGE's shared context; refusing
-- it would refuse every signed message.
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Write to hello@proof-business.example']),
  '{}'::text[], 'an e-mail address at the same domain is not the website');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['See proof-business.example.org for the event.']),
  '{}'::text[], 'a longer domain that starts with the host is not the website');

-- ── Owner-put: exempt per value, never per kind ─────────────────────────────────────────────
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t),
    ARRAY['Call 020 7946 0001 or visit 221B Baker St.'],
    ARRAY['Send Maya our number, 020 7946 0001, and ask when suits her.']),
  ARRAY['address'], 'the number the owner typed passes; the address they did not type is still found');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t),
    ARRAY['Come to 221B Baker St.'], ARRAY['Tell her to come to 221B Baker Street.']),
  '{}'::text[], 'the address the owner typed passes, however it is written in the draft');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t),
    ARRAY['Come to 221B Baker Street.'], ARRAY['Tell her to come to 48 Orchard Road.']),
  ARRAY['address'], 'typing one stored address does not license a different one');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t),
    ARRAY['Everything is at https://www.proof-business.example'], ARRAY['include proof-business.example']),
  '{}'::text[], 'the website the owner typed passes, however it is written in the draft');

-- ── Only the tenant it is given ─────────────────────────────────────────────────────────────
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t),
    ARRAY['99 Other Avenue, +44 161 496 0000, other-tenant.example']),
  '{}'::text[], 'another tenant''s facts are not this tenant''s');
SELECT is(public.outbound_private_business_facts_found((SELECT b FROM t),
    ARRAY['99 Other Avenue, +44 161 496 0000, other-tenant.example']),
  ARRAY['address','phone','website'], 'and are found when that tenant is the one checked');
SELECT is(public.outbound_private_business_facts_found((SELECT c FROM t),
    ARRAY['Visit 221B Baker St. or 48 Orchard Road, 7 Legacy Lane for post, call 020 7946 0001 or 555-123-4567, or see www.proof-business.example']),
  '{}'::text[], 'a tenant with nothing stored has nothing to find, whatever another tenant stores');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), NULL),
  '{}'::text[], 'no text finds nothing');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), '{}'::text[]),
  '{}'::text[], 'an empty list finds nothing');
SELECT throws_ok($$SELECT public.outbound_private_business_facts_found(NULL, ARRAY['x'])$$,
  '22023', 'OUTBOUND_FACTS_TENANT_REQUIRED', 'a missing tenant is refused, never read as "nothing stored"');

-- ── Nobody but the server may ask ───────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"0c1a0000-0000-4000-8000-000000000001"}', true);
SELECT throws_ok(format($$SELECT public.outbound_private_business_facts_found(%L, ARRAY['221B Baker Street'])$$,
    '0c1a0000-0000-4000-8000-00000000a001'),
  '42501', 'OUTBOUND_FACTS_SERVICE_ONLY', 'a signed-in caller is refused, the tenant''s own owner included');
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT throws_ok(format($$SELECT public.outbound_private_business_facts_found(%L, ARRAY['221B Baker Street'])$$,
    '0c1a0000-0000-4000-8000-00000000a001'),
  '42501', 'OUTBOUND_FACTS_SERVICE_ONLY', 'an anonymous caller is refused');
SELECT set_config('request.jwt.claims','',true);
SELECT throws_ok(format($$SELECT public.outbound_private_business_facts_found(%L, ARRAY['221B Baker Street'])$$,
    '0c1a0000-0000-4000-8000-00000000a001'),
  '42501', 'OUTBOUND_FACTS_SERVICE_ONLY', 'a caller carrying no role at all is refused');

SELECT * FROM finish();
ROLLBACK;
