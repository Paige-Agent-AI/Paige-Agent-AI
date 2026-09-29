-- ============================================================================
-- A new contact and its first addresses: one transaction (20270519005000) — executed proof.
--
-- _create_client_with_contact_methods creates the contact and attaches its addresses in ONE
-- transaction, so:
--   * a created contact holds its addresses, and carries none on its `clients` row;
--   * a create whose address is taken (23505) or refused (22023) writes NOTHING — no contact row,
--     no `contact.created` event from trg_clients_emit_contact_created, and no earlier address of
--     the same call;
--   * only the named `clients` columns are written, every other keeps its default;
--   * the workspace comes only from `_tenant_id`, and an address, an id or an unknown column in the
--     contact's fields is refused, never ignored;
--   * a whole first list (Paige's MCP create_contact: labels, several of a kind, a marked primary)
--     is stored as sent;
--   * only the service role may call it.
--
-- Synthetic fixtures only. Rolls back.
-- ============================================================================
BEGIN;
SELECT plan(23);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('e6000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ccw-owner@tests.invalid');
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, account_number, features) VALUES
  ('e6000000-0000-4000-8000-00000000000a', 'contact-create-with-methods', 'Contact Create With Methods', 'active', 'standalone', 'CCW', 9330101, '{}'::jsonb);
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('e6000000-0000-4000-8000-00000000000a', 'e6000000-0000-4000-8000-0000000000a1', 'owner', 'active', true, now() - interval '1 day');

-- ── 1. The grant ────────────────────────────────────────────────────────────────────────────
SELECT ok(has_function_privilege('service_role', 'public._create_client_with_contact_methods(uuid,jsonb,jsonb)', 'EXECUTE'),
          'the service role may create a contact with its addresses');
SELECT ok(NOT has_function_privilege('authenticated', 'public._create_client_with_contact_methods(uuid,jsonb,jsonb)', 'EXECUTE'),
          'a signed-in browser may not (it would name its own workspace)');
SELECT ok(NOT has_function_privilege('anon', 'public._create_client_with_contact_methods(uuid,jsonb,jsonb)', 'EXECUTE'),
          'nor may an anonymous one');

-- ── 2. A contact created with its addresses ─────────────────────────────────────────────────
SET LOCAL ROLE service_role;
SELECT set_config('ccw.created', public._create_client_with_contact_methods(
  'e6000000-0000-4000-8000-00000000000a',
  '{"created_by":"e6000000-0000-4000-8000-0000000000a1","first_name":"Ada","last_name":"Lovelace","source":"inbound_email","created_by_channel_type":"email","tags":["vip"]}',
  '[{"kind":"email","value":"ada@ccw.tests.invalid"},{"kind":"phone","value":"555 010 0111"},{"kind":"phone","value":"  "}]')::text, true);
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.clients WHERE id = current_setting('ccw.created')::uuid
             AND tenant_id = 'e6000000-0000-4000-8000-00000000000a'),
          1, 'the contact is created in the workspace the caller named');
SELECT is((SELECT array_agg(kind || ':' || value ORDER BY kind) FROM public.client_contact_methods
            WHERE client_id = current_setting('ccw.created')::uuid AND is_primary),
          ARRAY['email:ada@ccw.tests.invalid', 'phone:555 010 0111'],
          'it holds its email and phone as its primaries, and the blank phone was skipped');
SELECT is((SELECT count(*)::int FROM public.client_contact_methods WHERE client_id = current_setting('ccw.created')::uuid),
          2, 'and nothing else');
SELECT is((SELECT status || '/' || lifecycle_stage || '/' || lead_score::text || '/' || array_to_string(tags, ',')
             FROM public.clients WHERE id = current_setting('ccw.created')::uuid),
          'active/new_lead/0/vip', 'columns it did not name keep their defaults; a named array column is typed');
SELECT isnt((SELECT account_number FROM public.clients WHERE id = current_setting('ccw.created')::uuid),
            NULL, 'the contact is numbered as any other contact is');
SELECT is((SELECT count(*)::int FROM public.paige_native_events
            WHERE event_key = 'contact.created' AND subject_id = current_setting('ccw.created')::uuid),
          1, 'its contact.created event is written with it');

-- ── 2b. A whole first list, as Paige's MCP create_contact sends it ──────────────────────────
SET LOCAL ROLE service_role;
SELECT set_config('ccw.listed', public._create_client_with_contact_methods(
  'e6000000-0000-4000-8000-00000000000a',
  '{"created_by":"e6000000-0000-4000-8000-0000000000a1","first_name":"Grace","last_name":"Hopper","source":"mcp","created_by_channel_type":"api"}',
  '[{"kind":"email","value":"grace@ccw.tests.invalid","label":"Work"},{"kind":"email","value":"grace.home@ccw.tests.invalid","label":"Home","is_primary":true},{"kind":"phone","value":"555 010 0122","label":null}]')::text, true);
RESET ROLE;
SELECT is((SELECT string_agg(value || ':' || COALESCE(label, '-'), ',' ORDER BY position) FROM public.client_contact_methods
            WHERE client_id = current_setting('ccw.listed')::uuid AND kind = 'email'),
          'grace@ccw.tests.invalid:Work,grace.home@ccw.tests.invalid:Home', 'every email is kept, with its label, in the order sent');
SELECT is((SELECT value FROM public.client_contact_methods
            WHERE client_id = current_setting('ccw.listed')::uuid AND kind = 'email' AND is_primary),
          'grace.home@ccw.tests.invalid', 'the address marked primary is the primary, not the first one sent');
SELECT is((SELECT value FROM public.client_contact_methods
            WHERE client_id = current_setting('ccw.listed')::uuid AND kind = 'phone' AND is_primary),
          '555 010 0122', 'a kind with none marked takes its first as primary');

-- ── 3. A refused create writes nothing ──────────────────────────────────────────────────────
SELECT set_config('ccw.clients_before', (SELECT count(*) FROM public.clients WHERE tenant_id = 'e6000000-0000-4000-8000-00000000000a')::text, true);
SELECT set_config('ccw.events_before', (SELECT count(*) FROM public.paige_native_events WHERE tenant_id = 'e6000000-0000-4000-8000-00000000000a')::text, true);

SET LOCAL ROLE service_role;
SELECT throws_ok($q$SELECT public._create_client_with_contact_methods('e6000000-0000-4000-8000-00000000000a',
    '{"created_by":"e6000000-0000-4000-8000-0000000000a1","first_name":"Twin","last_name":""}',
    '[{"kind":"email","value":"  ADA@ccw.tests.invalid "}]')$q$,
  '23505', NULL, 'an email another contact in the workspace holds refuses the create with 23505');
SELECT throws_ok($q$SELECT public._create_client_with_contact_methods('e6000000-0000-4000-8000-00000000000a',
    '{"created_by":"e6000000-0000-4000-8000-0000000000a1","first_name":"Short","last_name":""}',
    '[{"kind":"email","value":"short@ccw.tests.invalid"},{"kind":"phone","value":"12"}]')$q$,
  '22023', NULL, 'a phone the database refuses refuses the create with 22023, after a valid email');
RESET ROLE;

SELECT is((SELECT count(*) FROM public.clients WHERE tenant_id = 'e6000000-0000-4000-8000-00000000000a')::text,
          current_setting('ccw.clients_before'), 'no contact row survives a refused create');
SELECT is((SELECT count(*) FROM public.paige_native_events WHERE tenant_id = 'e6000000-0000-4000-8000-00000000000a')::text,
          current_setting('ccw.events_before'), 'and no contact.created event for a contact that does not exist');
SELECT is((SELECT count(*)::int FROM public.client_contact_methods WHERE value = 'short@ccw.tests.invalid'),
          0, 'nor the valid email that came before the refused phone');

-- ── 4. What the contact's fields may not carry ──────────────────────────────────────────────
SET LOCAL ROLE service_role;
SELECT throws_like($q$SELECT public._create_client_with_contact_methods('e6000000-0000-4000-8000-00000000000a',
    '{"created_by":"e6000000-0000-4000-8000-0000000000a1","first_name":"E","last_name":"","email":"e@ccw.tests.invalid"}', '[]')$q$,
  'CONTACT_FIELDS_REFUSED: email%', 'an address column is refused: an address is a contact method');
SELECT throws_like($q$SELECT public._create_client_with_contact_methods('e6000000-0000-4000-8000-00000000000a',
    '{"created_by":"e6000000-0000-4000-8000-0000000000a1","first_name":"E","last_name":"","tenant_id":"e6000000-0000-4000-8000-00000000000b"}', '[]')$q$,
  'CONTACT_FIELDS_REFUSED: tenant_id%', 'a workspace in the fields is refused: it comes only from _tenant_id');
SELECT throws_like($q$SELECT public._create_client_with_contact_methods('e6000000-0000-4000-8000-00000000000a',
    '{"created_by":"e6000000-0000-4000-8000-0000000000a1","first_name":"E","last_name":"","first_name) VALUES (1); --":1}', '[]')$q$,
  'CONTACT_FIELDS_REFUSED%', 'a key that is not a column is refused, never interpolated or ignored');
SELECT throws_like($q$SELECT public._create_client_with_contact_methods(NULL,
    '{"created_by":"e6000000-0000-4000-8000-0000000000a1","first_name":"E","last_name":""}', '[]')$q$,
  'CONTACT_NO_TENANT%', 'a contact with no workspace is refused');
SELECT throws_ok($q$SELECT public._create_client_with_contact_methods('e6000000-0000-4000-8000-00000000000a',
    '{"created_by":"e6000000-0000-4000-8000-0000000000a1","first_name":"E","last_name":"","lifecycle_stage":"lead"}', '[]')$q$,
  '23514', NULL, 'the table''s own checks still apply');
SELECT lives_ok($q$SELECT public._create_client_with_contact_methods('e6000000-0000-4000-8000-00000000000a',
    '{"created_by":"e6000000-0000-4000-8000-0000000000a1","first_name":"No","last_name":"Address"}', NULL)$q$,
  'a contact with no address yet can still be created');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
