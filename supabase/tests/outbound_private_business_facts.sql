-- A1: the owner's registered address, business phone and website never reach a customer unless
-- the owner put them there. outbound_private_business_facts_found() is the check the customer-bound
-- exits will ask (A1-1b). This proves: what it finds in every stored copy, each copy on its own; the
-- ways of writing each fact it must see through (domestic and international numbers, HTML e-mail,
-- Unicode spaces and dashes, labels and extensions, suites, ranges, street-word variants, subdomains,
-- shared booking hosts); what it deliberately does not match (a town or district, a floor or suite on
-- its own, a fragment of the number, the digits of a note beside a number, the business's e-mail
-- address, a longer domain, another page on a shared platform); that the
-- owner's own words are exempt per value; that it reads only the tenant it is given and refuses an
-- unknown one; and that nobody but the server may ask it.
BEGIN;
SELECT plan(153);

-- ── Grants ──────────────────────────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege(r.rolname, f.fn, 'EXECUTE'),
  format('%s cannot execute %s', r.rolname, f.fn))
FROM (VALUES ('anon'), ('authenticated')) r(rolname)
CROSS JOIN (VALUES ('public.outbound_private_business_facts_found(uuid,text[],text[])'),
                   ('public.outbound_fact_decode(text)'),
                   ('public.outbound_fact_street_text(text)'),
                   ('public.outbound_fact_digit_runs(text)'),
                   ('public.outbound_fact_website_host(text)')) f(fn);
SELECT ok(has_function_privilege('service_role',
  'public.outbound_private_business_facts_found(uuid,text[],text[])', 'EXECUTE'),
  'the server (service_role) can ask the check');

-- ── Fixtures: A holds several kinds of stored copy; B holds its own; C holds nothing. ───────
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

-- ── One stored copy per tenant: each place is read, and each way of writing it is seen. ────
-- place: legal.<column> | private.<key> | brand.<key> | brief.<key> | proposal.<key> (a staged,
-- unconfirmed proposal). expect '{}' marks a draft that must pass.
CREATE TEMP TABLE src (n int, place text, stored text, draft text, expect text[], what text);
INSERT INTO src VALUES
  -- Every place a copy lives, each on its own.
  ( 1,'legal.registered_street','14 Quarry Hill','Meet at 14 Quarry Hill.',ARRAY['address'],'the legal profile''s street'),
  ( 2,'legal.registered_street_secondary','Building 7, Riverside Court','Come to Riverside Court.',ARRAY['address'],'the legal profile''s second line'),
  ( 3,'legal.registered_postal_code','SW1A 2AA','Post it to SW1A 2AA.',ARRAY['address'],'the legal profile''s postal code'),
  ( 4,'legal.registered_address','9 Mill Road, Cambridge','We are at 9 Mill Rd.',ARRAY['address'],'the legal profile''s single-line address'),
  ( 5,'private.address','31 Harbour Street, Whitby','Find us at 31 Harbour St.',ARRAY['address'],'the private brief''s address'),
  ( 6,'private.registeredStreet','5 Kiln Lane','Come to 5 Kiln Ln.',ARRAY['address'],'the private brief''s street'),
  ( 7,'private.registeredStreetSecondary','Riverside House','Come to Riverside House.',ARRAY['address'],'the private brief''s second line'),
  ( 8,'private.registeredPostalCode','EH1 1YZ','Send it to EH1 1YZ.',ARRAY['address'],'the private brief''s postal code'),
  ( 9,'brand.address','66 Canal Walk, Leicester','Meet at 66 Canal Walk.',ARRAY['address'],'the legacy brand address'),
  (10,'brief.address','18 Chapel Row','See you at 18 Chapel Row.',ARRAY['address'],'the legacy business-brief address'),
  (11,'proposal.address','3 Orchard Close','Drop by 3 Orchard Cl.',ARRAY['address'],'a staged proposal''s address'),
  (12,'proposal.address','27 Station Approach, Hove','Meet at 27 Station Approach.',ARRAY['address'],'a part of a staged proposal''s address'),
  (13,'legal.support_phone','+44 20 7946 0101','Call 020 7946 0101.',ARRAY['phone'],'the legal profile''s phone'),
  (14,'private.phone','+44 161 496 0102','Ring 0161 496 0102.',ARRAY['phone'],'the private brief''s phone'),
  (15,'brand.phone','+1 415 555 0103','Call (415) 555-0103.',ARRAY['phone'],'the legacy brand phone'),
  (16,'brand.business_phone','+61 2 9876 5104','Call (02) 9876 5104.',ARRAY['phone'],'the legacy brand business phone'),
  (17,'brief.phone','+33 1 23 45 61 05','Appelez le 01 23 45 61 05.',ARRAY['phone'],'the legacy business-brief phone'),
  (18,'proposal.phone','+49 30 1234506','Call 030 1234506.',ARRAY['phone'],'a staged proposal''s phone'),
  (19,'brief.website','https://kiln-studio.example','Everything is on kiln-studio.example.',ARRAY['website'],'the business brief''s website'),
  (20,'legal.website_url','https://www.harbour-coaching.example/','See harbour-coaching.example',ARRAY['website'],'the legal profile''s website'),
  (21,'brand.website','chapel-row.example','Read https://chapel-row.example/about',ARRAY['website'],'the legacy brand website, stored without a scheme'),
  (22,'proposal.website','https://orchard-advice.example','Visit orchard-advice.example',ARRAY['website'],'a staged proposal''s website'),
  -- Numbers: international and domestic forms of national numbers that are not ten digits long.
  (23,'legal.support_phone','+44 800 123 456','Call free on 0800 123 456.',ARRAY['phone'],'a nine-digit UK freephone, written domestically'),
  (24,'legal.support_phone','+353 1 234 5678','Ring (01) 234 5678.',ARRAY['phone'],'an Irish number, written domestically'),
  (25,'legal.support_phone','+64 9 123 4567','Call 09-123 4567.',ARRAY['phone'],'a New Zealand number, written domestically'),
  (26,'legal.support_phone','0412 345 678','Text +61 412 345 678.',ARRAY['phone'],'an Australian mobile stored domestically, written internationally'),
  (27,'legal.support_phone','+1 415 555 0127','Call 555-0127 any time.',ARRAY['phone'],'a number written without its area code'),
  -- Numbers: separators the text may carry.
  (28,'legal.support_phone','555-123-4028',U&'Call 555\2011123\20114028.',ARRAY['phone'],'a number with non-breaking hyphens'),
  (29,'legal.support_phone','+44 20 7946 0029',U&'Call 020\00A07946\00A00029.',ARRAY['phone'],'a number with non-breaking spaces'),
  (30,'legal.support_phone','+44 20 7946 0030','Call 020&nbsp;7946&nbsp;0030.',ARRAY['phone'],'a number with HTML non-breaking spaces'),
  (31,'legal.support_phone','+44 20 7946 0031','Call 020&#160;7946&#160;0031.',ARRAY['phone'],'a number with numeric HTML spaces'),
  (32,'legal.support_phone','(555) 777-1032','Call (555)&nbsp;777&ndash;1032.',ARRAY['phone'],'a number with an HTML en dash'),
  (33,'legal.support_phone','+49 30 7654333','Call 030/7654333.',ARRAY['phone'],'a number with a slash'),
  (34,'legal.support_phone','+1 555 888 4034','Call (555) - 888 - 4034.',ARRAY['phone'],'a number with spaced dashes'),
  (35,'legal.support_phone','+1 555 999 1035','<a href="tel:+15559991035">Call us</a>',ARRAY['phone'],'a number only inside an HTML tel: link'),
  (36,'legal.support_phone','+1 555 999 1036','Call 555<span>-</span>999-1036',ARRAY['phone'],'a number split by HTML tags'),
  -- Numbers: labels and extensions in the stored value.
  (37,'legal.support_phone','Text: 555-222-3037','Text 555 222 3037.',ARRAY['phone'],'a stored number with a label'),
  (38,'legal.support_phone','Office/Fax 555-444-5038','Fax 555.444.5038.',ARRAY['phone'],'a stored number with "Office/Fax"'),
  (39,'legal.support_phone','Tel # 020 7946 0039','Call 020 7946 0039.',ARRAY['phone'],'a stored number with "Tel #"'),
  (40,'legal.support_phone','#555-666-7040','Call 555-666-7040.',ARRAY['phone'],'a stored number starting with "#"'),
  (41,'legal.support_phone','555-123-9041 x204','Call 555-123-9041.',ARRAY['phone'],'a stored number with an extension'),
  (42,'legal.support_phone','555-123-9042x7','Call 555 123 9042.',ARRAY['phone'],'a stored number with an extension and no space'),
  (43,'legal.support_phone','1-800-FLOWERS','Call 1-800-FLOWERS today.',ARRAY['phone'],'a letter number, copied as written'),
  (44,'legal.support_phone','020 7946 0044 or 07700 900044','Or call 020 7946 0044.',ARRAY['phone'],'the first of two stored numbers'),
  (80,'legal.support_phone','+32 471 12 34 56','Bel 0471/12 34 56.',ARRAY['phone'],'a Belgian mobile written with a slash'),
  (81,'legal.support_phone','+44 800 123 457','Call (0800) - 123 457.',ARRAY['phone'],'a number with a bracket and a spaced dash inside its last seven digits'),
  -- Round 2: numbers with trailing text, and two numbers without a separator.
  (82,'legal.support_phone','020 7946 0082 (9am-5pm)','Call 020 7946 0082.',ARRAY['phone'],'a stored number followed by opening hours'),
  (83,'legal.support_phone','Mobile: 07700 900183 (WhatsApp 24h)','Text 07700 900183.',ARRAY['phone'],'a stored number between a label and a note'),
  (84,'legal.support_phone','555-123-9084 ext. 204 (reception)','Call 555-123-9084.',ARRAY['phone'],'a stored number with an extension and a note'),
  (85,'legal.support_phone','Office 020 7946 0085 Mobile 07700 900085','Call 020 7946 0085.',ARRAY['phone'],'the first of two labelled numbers'),
  (86,'legal.support_phone','020 7946 0086 07700 900086','Call 020 7946 0086.',ARRAY['phone'],'the first of two numbers with no separator'),
  (87,'legal.support_phone','+44 20 7946 0087',U&'Call 020\200E7946\200E0087.',ARRAY['phone'],'a number with bidirectional marks'),
  (88,'legal.support_phone','+44 20 7946 0088',U&'Call \0660\0662\0660 \0667\0669\0664\0666 \0660\0660\0668\0668.',ARRAY['phone'],'a number in Arabic-Indic digits'),
  -- Round 2: post-office boxes, street cores, postcodes inside a line, business parks.
  (89,'legal.registered_street','P.O. Box 1234','Mail us at PO Box 1234.',ARRAY['address'],'"P.O. Box" written "PO Box"'),
  (90,'legal.registered_street','PO Box 4321','Post Office Box 4321, please.',ARRAY['address'],'"PO Box" written "Post Office Box"'),
  (91,'private.address','PO Box 5678, Springfield, IL 62701','Write to P.O. Box 5678.',ARRAY['address'],'a box in a single-line address'),
  (92,'legal.registered_street','2 Mill Lane Cottages','Come to 2 Mill Lane.',ARRAY['address'],'the core of a street whose first street word is not its last'),
  (93,'private.address','10 Test Way Leeds LS1 4AB','Post it to LS1 4AB.',ARRAY['address'],'a postcode inside a line with no separators'),
  (94,'legal.registered_street_secondary','Riverside Business Park','Come to Riverside Business Park.',ARRAY['address'],'a business park with no number'),
  -- Round 2: a tenant's own subdomain of a platform, and profile pages.
  (95,'brief.website','https://acme.paigeagent.ai','Visit https://acme.paigeagent.ai today.',ARRAY['website'],'a tenant''s own subdomain of Paige''s host'),
  (96,'brief.website','https://acme.paigeagent.ai/about','Visit acme.paigeagent.ai',ARRAY['website'],'a tenant''s own subdomain, stored with a path'),
  (97,'brief.website','https://acme.medium.com','Read acme.medium.com',ARRAY['website'],'a tenant''s own subdomain of a publishing host'),
  (98,'brief.website','https://www.linkedin.com/in/janedoe','Connect at linkedin.com/in/janedoe',ARRAY['website'],'a profile page under a generic path'),
  (99,'brief.website','https://sites.google.com/view/acme-studio','See sites.google.com/view/acme-studio/home',ARRAY['website'],'a site under a generic path on a platform subdomain'),
  (100,'brief.website','https://g.page/acme-coaching','Review us at g.page/acme-coaching',ARRAY['website'],'a page on a short-link host'),
  (101,'brief.website','www.acme-studio.example (launching soon)','See acme-studio.example',ARRAY['website'],'a website stored with a note'),
  -- Round 2: what must pass.
  (102,'legal.registered_street_secondary','Suite 400','Take the lift to Suite 400.','{}','a suite number on its own'),
  (103,'private.address','Unit 3, 48 Orchard Road, Leeds, LS1 4AB','Start Unit 3 of the programme.','{}','a unit number on its own'),
  (104,'legal.registered_street','The Office, 5 Mill Lane','I will be out of the office next week.','{}','a bare "the office"'),
  (105,'private.address','First Floor, 12 High Street, Leeds, LS1 4AB','The workshop is on the first floor.','{}','a floor on its own'),
  (106,'legal.registered_address','123 Main St, Elk Grove, CA 95624','Serving families across Elk Grove.','{}','a town whose name holds a street word'),
  (107,'private.address','1 Canada Square, Canary Wharf, London E14 5AB','Our event is in Canary Wharf.','{}','a district whose name holds a building word'),
  (108,'private.address',E'4 Bridge Road\nWelwyn Garden City\nAL8 6AA','Welcome to Welwyn Garden City.','{}','a town on its own line'),
  (109,'legal.registered_address','5 Main St, Cottage Grove, Washington County, OR 97424','Families across Cottage Grove love it.','{}','the stored city, wherever it sits'),
  (110,'brief.website','https://www.linkedin.com/in/janedoe','See linkedin.com/in/someoneelse','{}','another profile on the same platform'),
  (111,'brief.website','https://sites.google.com/view/acme-studio','Directions: https://maps.google.com/?q=cafe','{}','a map link on the same platform'),
  (112,'legal.support_phone','Call 9am-5pm','We are open 9am-5pm.','{}','opening hours stored in the phone field'),
  (113,'legal.registered_street','The Workshop, 5 Mill Lane','Come to the workshop on Tuesday.','{}','a bare "the <word>"'),
  (114,'private.address','12 Harbour Street, St Ives, Cornwall, TR26 1AB','Surf lessons in St Ives.','{}','a town led by a street word'),
  (115,'brief.website','https://app.paigeagent.ai/store/acme','Log in at https://app.paigeagent.ai/login','{}','the platform''s own subdomain, on another page'),
  (116,'legal.support_phone','020 7946 0116 (9am-5pm)','Your order 6011695 has shipped.','{}','the digits of a note beside a number, which are not part of it'),
  -- Addresses: suites, ranges, missing separators, street words and HTML.
  (45,'legal.registered_street','123 Main St., Suite 400','Come to 123 Main Street.',ARRAY['address'],'a street stored with its suite'),
  (46,'legal.registered_street','123 Main St #400','Come to 123 Main Street.',ARRAY['address'],'a street stored with "#400"'),
  (47,'legal.registered_street','3314 N Kenwood Ave Apt 2','Visit 3314 North Kenwood Avenue.',ARRAY['address'],'a street stored with an apartment'),
  (48,'private.address',E'123 Main St Suite 400\nSpringfield, IL 62701','We are at 123 Main St.',ARRAY['address'],'a single line whose first line carries the suite'),
  (49,'legal.registered_address','123 Main St Springfield IL 62701','We are at 123 Main St, Springfield.',ARRAY['address'],'a single line with no separators'),
  (50,'private.address','10 Test Way | Leeds','Come to 10 Test Way.',ARRAY['address'],'a single line separated by "|"'),
  (51,'private.address',E'Rose Cottage\nMill Lane\nLittle Snoring\nNR21 0AB','Rose Cottage, Mill Lane, Little Snoring.',ARRAY['address'],'a rural address with no street number'),
  (52,'legal.registered_street','12 King''s Road','Meet at 12 Kings Road.',ARRAY['address'],'a street written without its apostrophe'),
  (53,'private.address','Flat 2, 5 Saint Mary''s Gate','Come to 5 St Marys Gate.',ARRAY['address'],'"Saint" written "St"'),
  (54,'legal.registered_street','725 Fifth Avenue','We are at 725 5th Ave.',ARRAY['address'],'"Fifth" written "5th"'),
  (55,'legal.registered_street','221-223 Baker Street','Come to 221 Baker St.',ARRAY['address'],'one end of a number range'),
  (56,'legal.registered_street','221B Baker Street','Come to 221 B Baker Street.',ARRAY['address'],'"221B" written "221 B"'),
  (57,'legal.registered_street','Hauptstraße 5','Kommen Sie zur Hauptstrasse 5.',ARRAY['address'],'"ß" written "ss"'),
  (58,'legal.registered_street','8 Café Lane','Come to 8 Cafe Lane.',ARRAY['address'],'an accent dropped'),
  (59,'legal.registered_street','221B Baker Street','Come to 221B&nbsp;Baker&nbsp;Street.',ARRAY['address'],'an address with HTML spaces'),
  (60,'legal.registered_street','221B Baker Street','Come to 221B Baker<br>Street.',ARRAY['address'],'an address split by an HTML line break'),
  (61,'legal.registered_street','221B Baker Street','Come to <b>221B</b> Baker Street.',ARRAY['address'],'an address split by HTML tags'),
  (62,'private.address','Unit 3/48 Orchard Road','Come to 48 Orchard Rd.',ARRAY['address'],'a unit written with a slash'),
  (63,'legal.registered_street','3314 N.W. Kenwood Ave','Visit 3314 Northwest Kenwood Avenue.',ARRAY['address'],'"N.W." written "Northwest"'),
  (64,'legal.registered_street','400 Broadway Suite 12','Come to 400 Broadway.',ARRAY['address'],'a street with no street word, stored with its suite'),
  (65,'legal.registered_street','The Old Rectory','Come to The Old Rectory.',ARRAY['address'],'a structured street line with no number'),
  -- Websites.
  (66,'brief.website','https://café-studio.example','Visit café-studio.example today.',ARRAY['website'],'an international website'),
  (67,'brief.website','https://acme-studio.example','Book at https%3A%2F%2Facme-studio.example%2Fbook',ARRAY['website'],'a URL-encoded website'),
  (68,'brief.website','https://acme-studio.example','Shop at shop.acme-studio.example',ARRAY['website'],'a subdomain of the website'),
  (69,'brief.website','https://acme-studio.example','<a href="https://acme-studio.example/offer">See the offer</a>',ARRAY['website'],'the website only inside an HTML link'),
  (70,'brief.website','HTTP://Acme-Studio.Example:8080/Path','See ACME-STUDIO.EXAMPLE.',ARRAY['website'],'a website stored with a port and upper case'),
  (71,'brief.website','https://calendly.com/acme-coaching','Book at calendly.com/acme-coaching/intro',ARRAY['website'],'a page on a shared booking host'),
  (72,'brief.website','https://paigeagent.ai/store/acme','Shop at https://app.paigeagent.ai/store/acme',ARRAY['website'],'a page on Paige''s own host, on a subdomain'),
  -- What must pass: matching these would refuse ordinary messages.
  (73,'brief.website','https://paigeagent.ai/store/acme','Book your intro here: https://paigeagent.ai/book/intro','{}','another page on Paige''s own host'),
  (74,'brief.website','https://calendly.com/acme-coaching','Book with calendly.com/someone-else','{}','another tenant''s page on a shared host'),
  (75,'brief.website','https://instagram.com','Follow instagram.com/otherbrand','{}','a bare shared host, which names nobody'),
  (76,'brief.website','https://acme-studio.example','Write to hello@acme-studio.example','{}','an e-mail address at the domain'),
  (77,'brief.website','https://acme-studio.example','Write to hello@mail.acme-studio.example','{}','an e-mail address at a subdomain'),
  (78,'legal.registered_address','100 Market Street, St. Louis, MO 63101','We host events in St. Louis and New York.','{}','a city on its own'),
  (79,'legal.registered_street','100 St Marys Gate','Save 100 st of stock.','{}','a number and a street word alone, which are not a street');

DO $fixtures$
DECLARE
  r record;
  v_id uuid;
  v_key text;
  v_brand jsonb;
BEGIN
  FOR r IN SELECT * FROM src ORDER BY n LOOP
    v_id := ('0c1a0000-0000-4000-8000-0000000b' || lpad(r.n::text, 4, '0'))::uuid;
    v_key := split_part(r.place, '.', 2);
    v_brand := CASE split_part(r.place, '.', 1)
      WHEN 'brand' THEN jsonb_build_object(v_key, r.stored)
      WHEN 'brief' THEN jsonb_build_object('business_brief', jsonb_build_object(v_key, r.stored))
      WHEN 'proposal' THEN jsonb_build_object('business_brief_proposal',
        jsonb_build_object('id', gen_random_uuid(), 'patch', jsonb_build_object(v_key, r.stored)))
      ELSE '{}'::jsonb END;
    INSERT INTO public.tenants (id, slug, name, owner_user_id, status, account_type, features, brand)
    VALUES (v_id, 'facts-source-' || r.n, 'Facts Source ' || r.n, '0c1a0000-0000-4000-8000-000000000001',
            'active', 'standalone', '{}'::jsonb, v_brand);
    IF split_part(r.place, '.', 1) = 'legal' THEN
      EXECUTE format('INSERT INTO public.tenant_legal_profile (tenant_id, legal_business_name, %I) VALUES ($1, $2, $3)', v_key)
        USING v_id, 'Source Proof Ltd', r.stored;
    ELSIF split_part(r.place, '.', 1) = 'private' THEN
      INSERT INTO public.tenant_setup_private_context (tenant_id, private_brief)
      VALUES (v_id, jsonb_build_object(v_key, r.stored));
    END IF;
  END LOOP;
END
$fixtures$;
-- The stored city for row 109.
UPDATE public.tenant_legal_profile SET registered_city = 'Cottage Grove'
WHERE tenant_id = '0c1a0000-0000-4000-8000-0000000b0109';

SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);

SELECT is(public.outbound_private_business_facts_found(
    ('0c1a0000-0000-4000-8000-0000000b' || lpad(n::text, 4, '0'))::uuid, ARRAY[draft]),
  expect, format('%s: %s', CASE WHEN expect = '{}'::text[] THEN 'passes' ELSE 'found' END, what))
FROM src ORDER BY n;

-- ── What it finds when a tenant holds several copies ────────────────────────────────────────
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
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Meet me at 48 orchard rd.']),
  ARRAY['address'], 'a part of a single-line address is found, street words shortened on both sides');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t),
    ARRAY['We work with clients across Leeds, Bristol and London.']),
  '{}'::text[], 'a city on its own names a place, not this business, and passes');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Or ring 555-123-4567.']),
  ARRAY['phone'], 'a stored phone with an extension is found without it');
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t), ARRAY['Your booking code is 0001, room 7946.']),
  '{}'::text[], 'fragments of the number are not the number');
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
SELECT is(public.outbound_private_business_facts_found('0c1a0000-0000-4000-8000-0000000b0043',
    ARRAY['Call 1-800-FLOWERS today.'], ARRAY['Tell them to call 1-800-FLOWERS.']),
  '{}'::text[], 'a letter number the owner typed passes');
-- A number is exempt run by run: a form of it the owner did not type is held back.
SELECT is(public.outbound_private_business_facts_found((SELECT a FROM t),
    ARRAY['Call +44 20 7946 0001.'], ARRAY['Give them 020 7946 0001.']),
  ARRAY['phone'], 'a number the owner typed domestically is held back when the draft writes it internationally');
SELECT is(public.outbound_private_business_facts_found('0c1a0000-0000-4000-8000-0000000b0086',
    ARRAY['Call 020 7946 0086.'], ARRAY['Give them 07700 900086.']),
  ARRAY['phone'], 'typing the second of two stored numbers does not license the first');

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
SELECT throws_ok($$SELECT public.outbound_private_business_facts_found('0c1a0000-0000-4000-8000-00000000ffff', ARRAY['221B Baker Street'])$$,
  '22023', 'OUTBOUND_FACTS_TENANT_UNKNOWN', 'an unknown tenant is refused, never read as "nothing stored"');
SELECT throws_ok($$SELECT public.outbound_private_business_facts_found('0c1a0000-0000-4000-8000-00000000a001', ARRAY[repeat('a', 262145)])$$,
  '22023', 'OUTBOUND_FACTS_TEXT_TOO_LONG', 'more customer text than the check reads is refused, never passed');

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
