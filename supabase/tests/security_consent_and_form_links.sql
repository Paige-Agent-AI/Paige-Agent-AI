-- ISOLATED production-schema clone only; never execute on production. Rolled back.
-- #2087: consent cannot be forged from a browser, and send gates trust only verified evidence.
-- #2090: a form's or calendar's stored link must be a web address, on every write path.
-- Migration 20271027100000. Each attack in the issues is driven as the role that would make it.
BEGIN;
SET LOCAL timezone = 'UTC';
CREATE FUNCTION pg_temp.require_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;
-- Runs `command`; passes only if it fails with SQLSTATE `state` (and, when given, a message containing `fragment`).
CREATE FUNCTION pg_temp.require_error(command text, state text, fragment text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = state AND (fragment IS NULL OR position(fragment IN SQLERRM) > 0) THEN RETURN; END IF;
    RAISE EXCEPTION 'FAIL: % (got % %)', label, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL: % (no error)', label;
END $$;
CREATE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '{"role":"anon"}', true) $$;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub', uid, true),
        set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO anon, authenticated, service_role;

-- ───────────── #2087: grants (the facts a PostgREST caller meets) ─────────────
DO $grants$
DECLARE
  rec text := 'public.record_communications_consent(text,text,uuid,uuid,boolean,boolean,boolean,boolean,text,text,text)';
BEGIN
  PERFORM pg_temp.require_true(NOT has_function_privilege('anon', rec, 'EXECUTE'), 'anon cannot run the consent recorder');
  PERFORM pg_temp.require_true(NOT has_function_privilege('authenticated', rec, 'EXECUTE'), 'a signed-in user cannot run the consent recorder');
  PERFORM pg_temp.require_true(has_function_privilege('service_role', rec, 'EXECUTE'), 'the server still can');
  PERFORM pg_temp.require_true(NOT has_function_privilege('anon', 'public.has_sms_consent(text,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.has_sms_consent(text,boolean)', 'EXECUTE'),
    'nobody in a browser can probe a number''s SMS consent');
  PERFORM pg_temp.require_true(NOT has_function_privilege('anon', 'public.has_email_marketing_consent(text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.has_email_marketing_consent(text)', 'EXECUTE'),
    'nobody in a browser can probe an address''s marketing consent');
  PERFORM pg_temp.require_true(has_function_privilege('service_role', 'public.has_sms_consent(text,boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.has_email_marketing_consent(text)', 'EXECUTE'), 'the server keeps both gates');
  PERFORM pg_temp.require_true(NOT has_table_privilege('anon', 'public.communications_consents', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
    'anon holds no privilege on the consent table');
  PERFORM pg_temp.require_true(NOT has_table_privilege('authenticated', 'public.communications_consents', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.communications_consents', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'public.communications_consents', 'TRUNCATE'),
    'a signed-in user cannot insert or delete consent');
  PERFORM pg_temp.require_true(has_table_privilege('authenticated', 'public.communications_consents', 'SELECT'), 'a signed-in user can still read (RLS decides which rows)');
  PERFORM pg_temp.require_true(has_column_privilege('authenticated', 'public.communications_consents', 'withdrawn_at', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.communications_consents', 'revoked_at', 'UPDATE')
    AND has_column_privilege('authenticated', 'public.communications_consents', 'withdrawn_reason', 'UPDATE'),
    'a signed-in user can still withdraw');
  PERFORM pg_temp.require_true(NOT has_column_privilege('authenticated', 'public.communications_consents', 'phone', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.communications_consents', 'sms_marketing', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.communications_consents', 'tenant_id', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.communications_consents', 'consent_granted_at', 'UPDATE'),
    'but cannot change who or what a consent covers');
  PERFORM pg_temp.require_true(NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.communications_consents'::regclass AND polcmd = 'a'),
    'no browser insert policy remains');
END $grants$;

-- Fixtures: two platform users; tenant A with an admin (for #2090).
INSERT INTO auth.users(id, email) VALUES
 ('5ec20870-0000-4000-8000-000000000001', 'sec-2087-a@example.invalid'),
 ('5ec20870-0000-4000-8000-000000000002', 'sec-2087-b@example.invalid'),
 ('5ec20870-0000-4000-8000-000000000003', 'sec-2090-admin@example.invalid'),
 ('5ec20870-0000-4000-8000-000000000004', 'sec-2090-other@example.invalid');
INSERT INTO public.tenants(id, slug, name, status, account_type, account_number_prefix, features) VALUES
 ('5ec20870-0000-4000-8000-0000000000a1', 'sec-2090-a', 'Security proof A', 'active', 'standalone', 'S9A', '{"system_workspace":true}'),
 ('5ec20870-0000-4000-8000-0000000000b1', 'sec-2090-b', 'Security proof B', 'active', 'standalone', 'S9B', '{"system_workspace":true}');
INSERT INTO public.tenant_members(tenant_id, user_id, role, status, is_owner, joined_at) VALUES
 ('5ec20870-0000-4000-8000-0000000000a1', '5ec20870-0000-4000-8000-000000000003', 'owner', 'active', true, now()),
 ('5ec20870-0000-4000-8000-0000000000b1', '5ec20870-0000-4000-8000-000000000004', 'owner', 'active', true, now());
INSERT INTO public.profiles(user_id, active_tenant_id) VALUES
 ('5ec20870-0000-4000-8000-000000000003', '5ec20870-0000-4000-8000-0000000000a1'),
 ('5ec20870-0000-4000-8000-000000000004', '5ec20870-0000-4000-8000-0000000000b1')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
-- User 5 owns business A (so holds the GLOBAL admin role) and is only a member of business B, working in B.
INSERT INTO auth.users(id, email) VALUES ('5ec20870-0000-4000-8000-000000000005', 'sec-2087-member@example.invalid');
INSERT INTO public.tenant_members(tenant_id, user_id, role, status, is_owner, joined_at) VALUES
 ('5ec20870-0000-4000-8000-0000000000a1', '5ec20870-0000-4000-8000-000000000005', 'admin', 'active', false, now()),
 ('5ec20870-0000-4000-8000-0000000000b1', '5ec20870-0000-4000-8000-000000000005', 'member', 'active', false, now());
INSERT INTO public.user_roles(user_id, role) VALUES ('5ec20870-0000-4000-8000-000000000005', 'admin') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(user_id, active_tenant_id) VALUES ('5ec20870-0000-4000-8000-000000000005', '5ec20870-0000-4000-8000-0000000000b1')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- ───────────── #2087: the forgeries in the issue, as the roles that would make them ─────────────
-- 1. The issue's exact call, from the public anon key.
SET LOCAL ROLE anon;
SELECT pg_temp.as_anon();
SELECT pg_temp.require_error($$SELECT public.record_communications_consent('victim@example.invalid', '+15551234567', NULL, NULL, true, true, true)$$,
  '42501', NULL, 'anon cannot forge consent through the recorder');
SELECT pg_temp.require_error($$SELECT public.has_sms_consent('+15551234567', true)$$, '42501', NULL, 'anon cannot probe SMS consent');
RESET ROLE;

-- 2. A signed-in user: the recorder, and a complete platform-evidence row for someone else's number.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('5ec20870-0000-4000-8000-000000000001');
SELECT pg_temp.require_error($$SELECT public.record_communications_consent('victim@example.invalid', '+15551234567', NULL, NULL, true, true, true)$$,
  '42501', NULL, 'a signed-in user cannot forge consent through the recorder');
SELECT pg_temp.require_error($$INSERT INTO public.communications_consents(user_id, email, phone, sms_transactional, source, source_url, disclosure_version, consent_granted_at)
  VALUES ('5ec20870-0000-4000-8000-000000000001', 'sec-2087-a@example.invalid', '+15551234567', true, 'forged', 'https://example.invalid/x', 'forged-v1', now())$$,
  '42501', NULL, 'a signed-in user cannot write platform SMS evidence for any number');
SELECT pg_temp.require_error($$INSERT INTO public.communications_consents(email, phone, tenant_id, sms_marketing, email_marketing, source)
  VALUES ('victim@example.invalid', '+15551234567', '5ec20870-0000-4000-8000-0000000000b1', true, true, 'forged')$$,
  '42501', NULL, 'a signed-in user cannot attach marketing consent to another tenant');
RESET ROLE;

-- 3. The body refuses a browser role even if a later migration grants EXECUTE again (§59).
GRANT EXECUTE ON FUNCTION public.record_communications_consent(text,text,uuid,uuid,boolean,boolean,boolean,boolean,text,text,text) TO anon;
SET LOCAL ROLE anon;
SELECT pg_temp.as_anon();
SELECT pg_temp.require_error($$SELECT public.record_communications_consent('victim@example.invalid', '+15551234567', NULL, NULL, true, true, true)$$,
  '42501', 'CONSENT_WRITE_FORBIDDEN', 'the recorder''s body refuses anon on its own');
RESET ROLE;
REVOKE EXECUTE ON FUNCTION public.record_communications_consent(text,text,uuid,uuid,boolean,boolean,boolean,boolean,text,text,text) FROM anon;

-- ───────────── #2087: what the gates trust ─────────────
SET LOCAL ROLE service_role;
SELECT pg_temp.as_service();
-- A preference written by the server's recorder (every flag on, phone and email named) authorizes nothing.
SELECT pg_temp.require_true(public.record_communications_consent('pref@example.invalid', '+15550000001', NULL, NULL, true, true, true, true, 'proof') IS NOT NULL,
  'the server can still record a preference');
SELECT pg_temp.require_true(NOT public.has_sms_consent('+15550000001', false) AND NOT public.has_sms_consent('+15550000001', true),
  'an unverified preference does not authorize SMS');
SELECT pg_temp.require_true(NOT public.has_email_marketing_consent('pref@example.invalid'),
  'an unverified preference does not authorize marketing email');
-- A tenant-scoped legacy row is never platform evidence.
INSERT INTO public.communications_consents(tenant_id, email, phone, sms_transactional, sms_marketing, email_marketing, source)
VALUES ('5ec20870-0000-4000-8000-0000000000a1', 'tenant@example.invalid', '+15550000002', true, true, true, 'proof');
SELECT pg_temp.require_true(NOT public.has_sms_consent('+15550000002', false) AND NOT public.has_email_marketing_consent('tenant@example.invalid'),
  'a tenant row does not authorize a platform send');
-- Signup evidence, written the way tenant-signup writes it, authorizes only once its own account has
-- verified that number — and only until revoked.
INSERT INTO public.communications_consents(user_id, email, phone, sms_transactional, sms_marketing, source, source_url, disclosure_version, consent_granted_at)
VALUES ('5ec20870-0000-4000-8000-000000000002', 'sec-2087-b@example.invalid', '+15550000003', true, false, 'signup',
        'https://paigeagent.ai/auth?mode=signup', 'paige-platform-account-service-v1-2026-08-31', now());
SELECT pg_temp.require_true(NOT public.has_sms_consent('+15550000003', false), 'signup evidence for a number nobody verified authorizes nothing');
RESET ROLE;
INSERT INTO public.communication_preferences(user_id, sms_phone_number, sms_phone_verified)
VALUES ('5ec20870-0000-4000-8000-000000000002', '+1 555 000 0003', false)
 ON CONFLICT (user_id) DO UPDATE SET sms_phone_number = EXCLUDED.sms_phone_number, sms_phone_verified = EXCLUDED.sms_phone_verified;
SET LOCAL ROLE service_role;
SELECT pg_temp.require_true(NOT public.has_sms_consent('+15550000003', false), 'the number on the account, unverified, is not enough');
RESET ROLE;
UPDATE public.communication_preferences SET sms_phone_verified = true, sms_phone_number = '+15550009999'
 WHERE user_id = '5ec20870-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT pg_temp.require_true(NOT public.has_sms_consent('+15550000003', false), 'nor is the account having verified a different number');
-- Another account verifying this number does not vouch for this evidence either.
RESET ROLE;
INSERT INTO public.communication_preferences(user_id, sms_phone_number, sms_phone_verified)
VALUES ('5ec20870-0000-4000-8000-000000000001', '+15550000003', true)
 ON CONFLICT (user_id) DO UPDATE SET sms_phone_number = EXCLUDED.sms_phone_number, sms_phone_verified = EXCLUDED.sms_phone_verified;
SET LOCAL ROLE service_role;
SELECT pg_temp.require_true(NOT public.has_sms_consent('+15550000003', false), 'nor someone else''s account verifying it');
RESET ROLE;
UPDATE public.communication_preferences SET sms_phone_number = '+1 (555) 000-0003'
 WHERE user_id = '5ec20870-0000-4000-8000-000000000002';
SET LOCAL ROLE service_role;
SELECT pg_temp.require_true(public.has_sms_consent('+1 (555) 000-0003', false), 'evidence plus its own account''s verified number authorizes transactional SMS');
SELECT pg_temp.require_true(NOT public.has_sms_consent('+15550000003', true), 'but not marketing SMS');
RESET ROLE;

-- The account's owner cannot vouch for a number from the browser: verification is the server's to set.
-- Production lets a signed-in user update their own preferences row (RLS: own row, every column); mirror it.
GRANT SELECT, INSERT, UPDATE ON public.communication_preferences TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('5ec20870-0000-4000-8000-000000000001');
UPDATE public.communication_preferences SET sms_phone_number = '+15550000004', sms_phone_verified = true
 WHERE user_id = '5ec20870-0000-4000-8000-000000000001';
RESET ROLE;
SELECT pg_temp.require_true((SELECT NOT sms_phone_verified FROM public.communication_preferences WHERE user_id = '5ec20870-0000-4000-8000-000000000001'),
  'changing the number from the browser clears verification');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('5ec20870-0000-4000-8000-000000000001');
UPDATE public.communication_preferences SET sms_phone_verified = true WHERE user_id = '5ec20870-0000-4000-8000-000000000001';
RESET ROLE;
SELECT pg_temp.require_true((SELECT NOT sms_phone_verified FROM public.communication_preferences WHERE user_id = '5ec20870-0000-4000-8000-000000000001'),
  'and the browser cannot mark a number verified');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('5ec20870-0000-4000-8000-000000000002');
UPDATE public.communication_preferences SET sms_enabled = true WHERE user_id = '5ec20870-0000-4000-8000-000000000002';
RESET ROLE;
SELECT pg_temp.require_true((SELECT sms_phone_verified FROM public.communication_preferences WHERE user_id = '5ec20870-0000-4000-8000-000000000002'),
  'an unrelated browser edit keeps a server-verified number verified');

-- The gates answer the server only, even if a later migration grants them to a browser role (§59).
GRANT EXECUTE ON FUNCTION public.has_sms_consent(text, boolean), public.has_email_marketing_consent(text) TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('5ec20870-0000-4000-8000-000000000002');
SELECT pg_temp.require_true(NOT public.has_sms_consent('+15550000003', false), 'a browser caller learns nothing from the SMS gate');
RESET ROLE;
REVOKE EXECUTE ON FUNCTION public.has_sms_consent(text, boolean), public.has_email_marketing_consent(text) FROM authenticated;

-- 4. Revocation: the owner of a consent can withdraw it, cannot repoint it, and cannot touch anyone else's.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('5ec20870-0000-4000-8000-000000000001');
UPDATE public.communications_consents SET withdrawn_at = now(), withdrawn_reason = 'not mine' WHERE phone = '+15550000003';
SELECT pg_temp.as_user('5ec20870-0000-4000-8000-000000000002');
SELECT pg_temp.require_error($$UPDATE public.communications_consents SET phone = '+15559999999' WHERE phone = '+15550000003'$$,
  '42501', NULL, 'the owner cannot repoint a consent at another number');
UPDATE public.communications_consents SET revoked_at = now(), withdrawn_reason = 'user withdrew' WHERE phone = '+15550000003';
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_temp.as_service();
SELECT pg_temp.require_true((SELECT revoked_at IS NOT NULL FROM public.communications_consents WHERE phone = '+15550000003')
  AND (SELECT withdrawn_reason FROM public.communications_consents WHERE phone = '+15550000003') = 'user withdrew',
  'another user''s update touched nothing; the owner''s revocation landed');
SELECT pg_temp.require_true(NOT public.has_sms_consent('+15550000003', false), 'a revoked consent authorizes nothing');
RESET ROLE;

-- ───────────── #2090: the validator ─────────────
DO $urls$
DECLARE
  good text[] := ARRAY['https://example.com', 'http://example.com/thanks?x=1#done', 'https://example.com:8443/a/b',
                       'HTTPS://Example.COM/Path', 'https://sub.example.co.uk/x/', 'https://[::1]:8443/x', 'https://user@example.com/', ''];
  bad text[] := ARRAY['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
                      'vbscript:msgbox(1)', '//evil.example', 'https:/evil.example', 'https://', 'https:///path', 'ftp://example.com',
                      ' https://example.com', 'https://example.com ', 'https://exa mple.com', 'https://example.com/a b',
                      E'https://example.com/\nx', E'https://example.com\\@evil.example', 'http:\\evil.example', 'mailto:a@b.c',
                      'example.com/thanks', 'https://example.com/' || repeat('a', 2030),
                      'https://@', 'https://:', 'https://a@', 'https://@/x', 'https://:443/x'];
  u text;
BEGIN
  PERFORM pg_temp.require_true(public.is_safe_web_url(NULL), 'no link is fine');
  FOREACH u IN ARRAY good LOOP PERFORM pg_temp.require_true(public.is_safe_web_url(u), format('accepts %L', u)); END LOOP;
  FOREACH u IN ARRAY bad LOOP PERFORM pg_temp.require_true(NOT public.is_safe_web_url(u), format('rejects %L', left(u, 60))); END LOOP;
END $urls$;

-- ───────────── #2090: the write seams ─────────────
-- The owner's own form, through the real Studio writer (growth_form_upsert), as the signed-in owner.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('5ec20870-0000-4000-8000-000000000003');
CREATE TEMP TABLE form_ids(k text PRIMARY KEY, id uuid);
GRANT ALL ON form_ids TO authenticated, service_role;
INSERT INTO form_ids SELECT 'a', (public.growth_form_upsert(NULL, 'sec-2090-form', 'Security proof form',
  '{"sections":[{"title":"","fields":[{"key":"email","label":"Email","type":"email","required":true}]}]}'::jsonb,
  '{"type":"thank_you","message":"Thanks","redirect_url":"https://example.com/thanks"}'::jsonb)).id;
SELECT pg_temp.require_true((SELECT draft_success_action_json->>'redirect_url' FROM public.growth_forms WHERE id = (SELECT id FROM form_ids WHERE k = 'a')) = 'https://example.com/thanks',
  'an https redirect saves');
SELECT pg_temp.require_error($$SELECT public.growth_form_upsert(NULL, 'sec-2090-form', 'Security proof form',
  '{"sections":[{"title":"","fields":[{"key":"email","label":"Email","type":"email","required":true}]}]}'::jsonb,
  '{"type":"thank_you","message":"Thanks","redirect_url":"javascript:alert(document.cookie)"}'::jsonb)$$,
  '23514', 'FORM_LINK_INVALID', 'a javascript: redirect is refused by the Studio writer');
SELECT pg_temp.require_error($$SELECT public.growth_form_upsert(NULL, 'sec-2090-form', 'Security proof form',
  '{"sections":[{"title":"","fields":[{"key":"email","label":"Email","type":"email","required":true}]}]}'::jsonb,
  '{"type":"thank_you","message":"Thanks","download_url":"data:text/html,<script>alert(1)</script>"}'::jsonb)$$,
  '23514', 'FORM_LINK_INVALID', 'a data: download link is refused');
SELECT pg_temp.require_error($$SELECT public.growth_form_upsert(NULL, 'sec-2090-form', 'Security proof form',
  '{"sections":[{"title":"","fields":[{"key":"email","label":"Email","type":"email","required":true}]}]}'::jsonb,
  '{"type":"thank_you","message":"Thanks","redirect_url":{"href":"javascript:alert(1)"}}'::jsonb)$$,
  '23514', 'FORM_LINK_INVALID', 'a redirect that is not a string is refused');
SELECT pg_temp.require_true((SELECT draft_success_action_json->>'redirect_url' FROM public.growth_forms WHERE id = (SELECT id FROM form_ids WHERE k = 'a')) = 'https://example.com/thanks',
  'a refused save leaves the stored link as it was');
-- Cross-tenant: another business's owner reaches nothing.
SELECT pg_temp.as_user('5ec20870-0000-4000-8000-000000000004');
UPDATE public.growth_forms SET draft_success_action_json = '{"type":"thank_you","redirect_url":"https://evil.example"}'::jsonb
 WHERE id = (SELECT id FROM form_ids WHERE k = 'a');
RESET ROLE;
SELECT pg_temp.require_true((SELECT draft_success_action_json->>'redirect_url' FROM public.growth_forms WHERE id = (SELECT id FROM form_ids WHERE k = 'a')) = 'https://example.com/thanks',
  'another tenant''s owner cannot change this form''s link');

-- The server itself (service role, as chat drafting and the publish door run) is held to the same rule,
-- on the live copy too.
SET LOCAL ROLE service_role;
SELECT pg_temp.as_service();
SELECT pg_temp.require_error(format($$UPDATE public.growth_forms SET success_action_json = '{"type":"thank_you","redirect_url":"javascript:alert(1)"}'::jsonb WHERE id = %L$$,
  (SELECT id FROM form_ids WHERE k = 'a')), '23514', 'FORM_LINK_INVALID', 'the service role cannot store a javascript: redirect either');
SELECT pg_temp.require_error(format($$UPDATE public.growth_forms SET draft_success_action_json = '{"type":"thank_you","redirect_url":"javascript:alert(1)"}'::jsonb WHERE id = %L$$,
  (SELECT id FROM form_ids WHERE k = 'a')), '23514', 'FORM_LINK_INVALID', 'nor in the working copy waiting to be published');
SELECT pg_temp.require_error(format($$UPDATE public.growth_forms SET draft_success_action_json = '{"type":"thank_you","download_url":"javascript:alert(1)"}'::jsonb WHERE id = %L$$,
  (SELECT id FROM form_ids WHERE k = 'a')), '23514', 'FORM_LINK_INVALID', 'nor a working-copy download link');
SELECT pg_temp.require_error(format($$UPDATE public.growth_forms SET success_action_json = '{"type":"thank_you","download_url":"javascript:alert(1)"}'::jsonb WHERE id = %L$$,
  (SELECT id FROM form_ids WHERE k = 'a')), '23514', 'FORM_LINK_INVALID', 'nor a live download link');
SELECT pg_temp.require_error($$INSERT INTO public.calendars(tenant_id, slug, type, enabled, availability_json, location_type, redirect_url)
  VALUES ('5ec20870-0000-4000-8000-0000000000a1', 'sec-2090-cal', 'personal', false, '[]'::jsonb, 'phone', 'javascript:alert(1)')$$,
  '23514', 'PRESET_REDIRECT_INVALID', 'a calendar cannot be created with a javascript: redirect');
INSERT INTO public.calendars(tenant_id, slug, type, enabled, availability_json, location_type, redirect_url)
VALUES ('5ec20870-0000-4000-8000-0000000000a1', 'sec-2090-cal', 'personal', false, '[]'::jsonb, 'phone', 'https://example.com/booked');
SELECT pg_temp.require_error($$UPDATE public.calendars SET redirect_url = 'example.com/booked' WHERE slug = 'sec-2090-cal'$$,
  '23514', 'PRESET_REDIRECT_INVALID', 'a calendar redirect without https:// is refused with words the owner can act on');
UPDATE public.calendars SET redirect_url = NULL WHERE slug = 'sec-2090-cal';
RESET ROLE;

-- ───────────── #2087: the tenant ledger (paige_consent_events / paige_suppressions) ─────────────
-- (User 5, set up with the fixtures: owns-admin of A, so holds the GLOBAL admin role; only a member of B.)
INSERT INTO public.paige_suppressions(tenant_id, address_normalized, channel, reason, source)
VALUES ('5ec20870-0000-4000-8000-0000000000b1', 'optedout@example.invalid', 'email', 'unsubscribe_link', 'webhook');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('5ec20870-0000-4000-8000-000000000005');
SELECT pg_temp.require_error($$INSERT INTO public.paige_consent_events(tenant_id, address_normalized, channel, action, source)
  VALUES ('5ec20870-0000-4000-8000-0000000000b1', 'victim@example.invalid', 'email', 'granted', 'admin_ui')$$,
  '42501', NULL, 'a plain member of B (an admin elsewhere) cannot grant consent in B''s ledger');
DELETE FROM public.paige_suppressions WHERE tenant_id = '5ec20870-0000-4000-8000-0000000000b1';
SELECT pg_temp.require_true((SELECT count(*) FROM public.paige_suppressions) = 0, 'nor read B''s suppressions');
SELECT pg_temp.as_user('5ec20870-0000-4000-8000-000000000004');
SELECT pg_temp.require_true((SELECT count(*) FROM public.paige_suppressions WHERE tenant_id = '5ec20870-0000-4000-8000-0000000000b1') = 1,
  'the member''s delete removed nothing (B''s owner still sees the opt-out)');
INSERT INTO public.paige_consent_events(tenant_id, address_normalized, channel, action, source)
VALUES ('5ec20870-0000-4000-8000-0000000000b1', 'client@example.invalid', 'email', 'granted', 'admin_ui');
SELECT pg_temp.require_true((SELECT count(*) FROM public.paige_consent_events WHERE tenant_id = '5ec20870-0000-4000-8000-0000000000b1') = 1,
  'B''s own owner still records consent for B');
RESET ROLE;

-- A row that never had a link is untouched by an unrelated edit (the trigger fires only on the link columns).
SELECT pg_temp.require_true(NOT EXISTS (SELECT 1 FROM public.growth_forms WHERE NOT public.is_safe_web_url(success_action_json->>'redirect_url')
  OR NOT public.is_safe_web_url(draft_success_action_json->>'redirect_url') OR NOT public.is_safe_web_url(success_action_json->>'download_url')
  OR NOT public.is_safe_web_url(draft_success_action_json->>'download_url')), 'no stored form link is unsafe');
SELECT pg_temp.require_true(NOT EXISTS (SELECT 1 FROM public.calendars WHERE NOT public.is_safe_web_url(redirect_url)), 'no stored calendar redirect is unsafe');

SELECT 'PASS: security_consent_and_form_links' AS result;
ROLLBACK;
