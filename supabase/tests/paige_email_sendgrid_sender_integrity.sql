-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Experience 03 · S3 — rollback proof for 20271031000250_paige_email_sendgrid_sender_integrity.sql
-- (round-3 security H2).
--
-- ISOLATED production-schema clone (or the local stack) only; never COMMIT. Run from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/paige_email_sendgrid_sender_integrity.sql
-- 20271031000100 (the SendGrid fact columns) and this migration are applied INSIDE the transaction
-- (\ir), so they and every fixture vanish on ROLLBACK. Every assertion prints PASS/FAIL as it runs;
-- the report at the end RAISES if any failed, so psql exits non-zero.
--
-- Proves: a signed-in request (a workspace admin, the platform owner from the app, anon) cannot create
-- a SendGrid connector, switch one to SendGrid, re-point one's sender, or switch one on — not even
-- through a SECURITY DEFINER function; it CAN switch one off, and an admin's own domain removal still
-- disables it (deactivate_email_connector_on_domain_delete); the service role and a non-JWT session
-- can do all of it; Resend/Gmail writes are untouched. Across businesses a domain has at most one
-- SendGrid-verified row and a SendGrid domain id backs at most one row. Fixtures are fresh uuids,
-- `pesi-proof-*` slugs, .invalid mail (§63).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT set_config('request.jwt.claims', '{}', true);

CREATE TEMP TABLE _p(ord int, res text, label text);

\ir ../migrations/20271031000100_paige_email_sendgrid_governed_door.sql
\ir ../migrations/20271031000250_paige_email_sendgrid_sender_integrity.sql

CREATE FUNCTION pg_temp.ok(_ord int, _cond boolean, _label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO _p VALUES (_ord, CASE WHEN coalesce(_cond,false) THEN 'ok' ELSE 'FAIL' END, _label);
 IF coalesce(_cond,false) THEN RAISE NOTICE 'PASS: [%] %', _ord, _label; ELSE RAISE WARNING 'FAIL: [%] %', _ord, _label; END IF;
END $$;
CREATE FUNCTION pg_temp.err(_ord int, _label text, _sql text, _state text, _msg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
 BEGIN EXECUTE _sql; got := 'no error';
 EXCEPTION WHEN OTHERS THEN got := SQLSTATE || ' ' || SQLERRM; END;
 INSERT INTO _p VALUES (_ord, CASE WHEN got LIKE _state || ' ' || _msg THEN 'ok' ELSE 'FAIL got ' || got END, _label);
 IF got LIKE _state || ' ' || _msg THEN RAISE NOTICE 'PASS: [%] %', _ord, _label; ELSE RAISE WARNING 'FAIL: [%] % (got %)', _ord, _label, got; END IF;
END $$;
-- Succeeds = no error. Wraps the statement so a wrong refusal is a FAIL line, not an aborted run.
CREATE FUNCTION pg_temp.runs(_ord int, _label text, _sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text := 'no error';
BEGIN
 BEGIN EXECUTE _sql; EXCEPTION WHEN OTHERS THEN got := SQLSTATE || ' ' || SQLERRM; END;
 PERFORM pg_temp.ok(_ord, got = 'no error', _label || CASE WHEN got = 'no error' THEN '' ELSE ' (got ' || got || ')' END);
END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', jsonb_build_object('sub',_uid,'role','authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', '{"role":"anon"}', true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;
CREATE FUNCTION pg_temp.as_none() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', '{}', true) $$;

-- ── 0. shape: trigger installed; function invoker, not callable by app roles ────────────────
SELECT pg_temp.ok(1, EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.channel_connectors'::regclass
  AND tgname='trg_guard_channel_connector_sendgrid' AND NOT tgisinternal), 'trigger installed on channel_connectors');
SELECT pg_temp.ok(2, (SELECT NOT prosecdef FROM pg_proc WHERE oid='public.guard_channel_connector_sendgrid_writer()'::regprocedure)
  AND NOT has_function_privilege('authenticated','public.guard_channel_connector_sendgrid_writer()','EXECUTE')
  AND NOT has_function_privilege('anon','public.guard_channel_connector_sendgrid_writer()','EXECUTE'),
  'guard is SECURITY INVOKER and granted to no app role (§59)');

-- ── fixtures ─────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at)
SELECT u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'pesi-proof-' || right(u, 4) || '@example.invalid', '', now(), now(), now()
FROM unnest(ARRAY['ffffffff-5e1a-4000-8000-000000000001','ffffffff-5e1a-4000-8000-000000000002']) u;
INSERT INTO public.tenants (id, slug, name, account_number_prefix, account_number, account_type, owner_user_id) VALUES
 ('aaaaaaaa-5e1a-4000-8000-000000000001','pesi-proof-one','PESI Proof One','PIA',985941,'standalone','ffffffff-5e1a-4000-8000-000000000001'),
 ('aaaaaaaa-5e1a-4000-8000-000000000002','pesi-proof-two','PESI Proof Two','PIB',985942,'standalone','ffffffff-5e1a-4000-8000-000000000002');
INSERT INTO public.tenant_members (tenant_id, user_id, status, role, is_owner) VALUES
 ('aaaaaaaa-5e1a-4000-8000-000000000001','ffffffff-5e1a-4000-8000-000000000001','active','owner'::public.tenant_role,true),
 ('aaaaaaaa-5e1a-4000-8000-000000000002','ffffffff-5e1a-4000-8000-000000000002','active','owner'::public.tenant_role,true);
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
 ('ffffffff-5e1a-4000-8000-000000000001','aaaaaaaa-5e1a-4000-8000-000000000001'),
 ('ffffffff-5e1a-4000-8000-000000000002','aaaaaaaa-5e1a-4000-8000-000000000002')
 ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- The platform's own SendGrid connector (written by the service role, as the operator step does), and
-- a Resend connector the admin owns.
SELECT pg_temp.as_service();
INSERT INTO public.channel_connectors (id, tenant_id, channel_type, provider, from_address, inbound_domain, status, active) VALUES
 ('cccccccc-5e1a-4000-8000-000000000001','aaaaaaaa-5e1a-4000-8000-000000000001','email','sendgrid','hello@own.example.invalid','own.example.invalid','active',true),
 ('cccccccc-5e1a-4000-8000-000000000002','aaaaaaaa-5e1a-4000-8000-000000000001','email','resend','owner@resend.example.invalid',NULL,'active',true);
INSERT INTO public.tenant_email_domains (id, tenant_id, domain, from_email_local, from_name, status) VALUES
 ('eeeeeeee-5e1a-4000-8000-000000000001','aaaaaaaa-5e1a-4000-8000-000000000001','own.example.invalid','hello','PESI One','pending');

-- ── 1. a signed-in request cannot write a SendGrid sender ────────────────────────────────────
SELECT pg_temp.as_user('ffffffff-5e1a-4000-8000-000000000001');
SELECT pg_temp.err(10, 'a workspace admin cannot create a SendGrid connector (another business''s From)',
  $q$INSERT INTO public.channel_connectors (tenant_id, channel_type, provider, from_address, status, active) VALUES ('aaaaaaaa-5e1a-4000-8000-000000000001','email','sendgrid','ceo@victim.example.invalid','active',true)$q$,
  '42501', 'PAIGE_EMAIL_CONNECTOR_PROTECTED%');
SELECT pg_temp.err(11, 'a workspace admin cannot switch a Resend connector to SendGrid',
  $q$UPDATE public.channel_connectors SET provider='sendgrid' WHERE id='cccccccc-5e1a-4000-8000-000000000002'$q$,
  '42501', 'PAIGE_EMAIL_CONNECTOR_PROTECTED%');
SELECT pg_temp.err(12, 'a workspace admin cannot re-point a SendGrid connector''s From',
  $q$UPDATE public.channel_connectors SET from_address='ceo@victim.example.invalid' WHERE id='cccccccc-5e1a-4000-8000-000000000001'$q$,
  '42501', 'PAIGE_EMAIL_CONNECTOR_PROTECTED%');
SELECT pg_temp.err(13, 'a workspace admin cannot move a SendGrid connector to another business',
  $q$UPDATE public.channel_connectors SET tenant_id='aaaaaaaa-5e1a-4000-8000-000000000002' WHERE id='cccccccc-5e1a-4000-8000-000000000001'$q$,
  '42501', 'PAIGE_EMAIL_CONNECTOR_PROTECTED%');
SELECT pg_temp.err(14, 'a SendGrid connector''s config cannot be rewritten by an admin',
  $q$UPDATE public.channel_connectors SET config='{"x":1}'::jsonb WHERE id='cccccccc-5e1a-4000-8000-000000000001'$q$,
  '42501', 'PAIGE_EMAIL_CONNECTOR_PROTECTED%');
SELECT pg_temp.as_anon();
SELECT pg_temp.err(15, 'anon cannot create a SendGrid connector',
  $q$INSERT INTO public.channel_connectors (tenant_id, channel_type, provider, from_address, status, active) VALUES ('aaaaaaaa-5e1a-4000-8000-000000000001','email','sendgrid','x@own.example.invalid','active',true)$q$,
  '42501', 'PAIGE_EMAIL_CONNECTOR_PROTECTED%');

-- A SECURITY DEFINER function does not launder the request: the guard reads the JWT's role.
CREATE FUNCTION pg_temp.definer_insert() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
 INSERT INTO public.channel_connectors (tenant_id, channel_type, provider, from_address, status, active)
 VALUES ('aaaaaaaa-5e1a-4000-8000-000000000001','email','sendgrid','x@own.example.invalid','active',true) $$;
SELECT pg_temp.as_user('ffffffff-5e1a-4000-8000-000000000001');
SELECT pg_temp.err(16, 'a signed-in caller reaching the table through a SECURITY DEFINER function is still refused',
  $q$SELECT pg_temp.definer_insert()$q$, '42501', 'PAIGE_EMAIL_CONNECTOR_PROTECTED%');

-- ── 2. switching OFF stays a signed-in act; switching ON does not ────────────────────────────
SELECT pg_temp.runs(20, 'a workspace admin CAN switch its SendGrid connector off',
  $q$UPDATE public.channel_connectors SET active=false, status='disabled' WHERE id='cccccccc-5e1a-4000-8000-000000000001'$q$);
SELECT pg_temp.ok(21, (SELECT NOT active AND status='disabled' FROM public.channel_connectors WHERE id='cccccccc-5e1a-4000-8000-000000000001'),
  'the switch-off persisted');
SELECT pg_temp.err(22, 'a workspace admin cannot switch a SendGrid connector back on',
  $q$UPDATE public.channel_connectors SET active=true, status='active' WHERE id='cccccccc-5e1a-4000-8000-000000000001'$q$,
  '42501', 'PAIGE_EMAIL_CONNECTOR_PROTECTED%');
SELECT pg_temp.as_service();
SELECT pg_temp.runs(23, 'the service role switches it back on',
  $q$UPDATE public.channel_connectors SET active=true, status='active' WHERE id='cccccccc-5e1a-4000-8000-000000000001'$q$);
-- An admin removing its own domain disables every email connector on it (SECURITY DEFINER trigger,
-- fired by the admin's write) — the guard must let that switch-off through.
SELECT pg_temp.as_user('ffffffff-5e1a-4000-8000-000000000001');
SELECT pg_temp.runs(24, 'an admin can still delete its own domain (connector disabled by the domain trigger)',
  $q$DELETE FROM public.tenant_email_domains WHERE id='eeeeeeee-5e1a-4000-8000-000000000001'$q$);
SELECT pg_temp.ok(25, (SELECT NOT active AND status='disabled' FROM public.channel_connectors WHERE id='cccccccc-5e1a-4000-8000-000000000001'),
  'the SendGrid connector on the removed domain is now off');

-- ── 3. everything else is unchanged ──────────────────────────────────────────────────────────
SELECT pg_temp.runs(30, 'a workspace admin still edits its Resend connector',
  $q$UPDATE public.channel_connectors SET from_name='Owner' WHERE id='cccccccc-5e1a-4000-8000-000000000002'$q$);
SELECT pg_temp.runs(31, 'a workspace admin still creates a Gmail connector',
  $q$INSERT INTO public.channel_connectors (tenant_id, channel_type, provider, from_address, status, active) VALUES ('aaaaaaaa-5e1a-4000-8000-000000000001','email','gmail','owner@gmail.example.invalid','active',true)$q$);
SELECT pg_temp.runs(32, 'a workspace admin can move a connector AWAY from SendGrid (no longer a PAIGE Email sender)',
  $q$UPDATE public.channel_connectors SET provider='resend' WHERE id='cccccccc-5e1a-4000-8000-000000000001'$q$);
SELECT pg_temp.as_service();
SELECT pg_temp.runs(33, 'the service role creates a SendGrid connector',
  $q$INSERT INTO public.channel_connectors (tenant_id, channel_type, provider, from_address, status, active) VALUES ('aaaaaaaa-5e1a-4000-8000-000000000001','email','sendgrid','team@own.example.invalid','active',true)$q$);
SELECT pg_temp.as_none();
SELECT pg_temp.runs(34, 'a non-JWT database session (migration / operator) creates a SendGrid connector',
  $q$INSERT INTO public.channel_connectors (tenant_id, channel_type, provider, from_address, status, active) VALUES ('aaaaaaaa-5e1a-4000-8000-000000000001','email','sendgrid','ops@own.example.invalid','active',true)$q$);

-- ── 4. one verified claim per domain; one row per SendGrid domain id ────────────────────────
SELECT pg_temp.as_service();
INSERT INTO public.tenant_email_domains (id, tenant_id, domain, from_email_local, from_name, status) VALUES
 ('eeeeeeee-5e1a-4000-8000-000000000011','aaaaaaaa-5e1a-4000-8000-000000000001','shared.example.invalid','a','A','pending'),
 ('eeeeeeee-5e1a-4000-8000-000000000012','aaaaaaaa-5e1a-4000-8000-000000000002','Shared.Example.invalid ','b','B','pending'),
 ('eeeeeeee-5e1a-4000-8000-000000000013','aaaaaaaa-5e1a-4000-8000-000000000002','other.example.invalid','c','C','pending');
SELECT pg_temp.runs(40, 'the first business''s verified claim on a domain is recorded',
  $q$UPDATE public.tenant_email_domains SET sendgrid_status='verified', sendgrid_domain_id='sg-1', sendgrid_verified_at=now() WHERE id='eeeeeeee-5e1a-4000-8000-000000000011'$q$);
SELECT pg_temp.err(41, 'a second business cannot also hold a verified claim on the same domain (case/space-insensitive)',
  $q$UPDATE public.tenant_email_domains SET sendgrid_status='verified', sendgrid_domain_id='sg-2', sendgrid_verified_at=now() WHERE id='eeeeeeee-5e1a-4000-8000-000000000012'$q$,
  '23505', '%tenant_email_domains_sendgrid_verified_domain%');
SELECT pg_temp.runs(42, 'the same domain may be PENDING for a second business (only verified is exclusive)',
  $q$UPDATE public.tenant_email_domains SET sendgrid_status='pending', sendgrid_domain_id='sg-2' WHERE id='eeeeeeee-5e1a-4000-8000-000000000012'$q$);
SELECT pg_temp.err(43, 'one SendGrid domain id cannot back a second row',
  $q$UPDATE public.tenant_email_domains SET sendgrid_status='pending', sendgrid_domain_id=' sg-1' WHERE id='eeeeeeee-5e1a-4000-8000-000000000013'$q$,
  '23505', '%tenant_email_domains_sendgrid_domain_id%');
SELECT pg_temp.ok(44, public._comms_email_sendgrid_sender_verified('aaaaaaaa-5e1a-4000-8000-000000000001','x@shared.example.invalid')
  AND NOT public._comms_email_sendgrid_sender_verified('aaaaaaaa-5e1a-4000-8000-000000000002','x@shared.example.invalid'),
  'only the business holding the verified claim may send as that domain');

-- ── 5. the duplicate check refuses loudly instead of deleting (replayed on a copy) ───────────
SELECT pg_temp.as_none();
DROP INDEX public.tenant_email_domains_sendgrid_verified_domain;
SELECT pg_temp.as_service();
UPDATE public.tenant_email_domains SET sendgrid_status='verified', sendgrid_domain_id='sg-2', sendgrid_verified_at=now() WHERE id='eeeeeeee-5e1a-4000-8000-000000000012';
SELECT pg_temp.as_none();
-- Replay the REAL migration over the duplicate. It must stop at its own check (psql prints the
-- expected PAIGE_EMAIL_DOMAIN_DUPLICATES error on stderr); the savepoint discards the aborted replay.
CREATE TEMP TABLE _replay(stage text);
SAVEPOINT replay;
\set ON_ERROR_STOP 0
\ir ../migrations/20271031000250_paige_email_sendgrid_sender_integrity.sql
INSERT INTO _replay VALUES ('replay completed');
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT replay;
SELECT pg_temp.ok(49, NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='tenant_email_domains_sendgrid_verified_domain')
  AND NOT EXISTS (SELECT 1 FROM _replay), 'replaying the migration over a duplicate verified claim refuses (index not built)');
SELECT pg_temp.ok(50, (SELECT count(*)=2 FROM public.tenant_email_domains WHERE sendgrid_status='verified' AND lower(btrim(domain))='shared.example.invalid'),
  'nothing was deleted to make room (the migration refuses; it does not resolve)');

SELECT count(*) FILTER (WHERE res='ok') AS ok,
       count(*) FILTER (WHERE res<>'ok') AS failed,
       jsonb_agg(jsonb_build_object('ord', ord, 'res', res, 'label', label) ORDER BY ord) FILTER (WHERE res<>'ok') AS failures
FROM _p;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM _p WHERE res<>'ok') THEN RAISE EXCEPTION 'paige_email_sendgrid_sender_integrity: % assertion(s) failed', (SELECT count(*) FROM _p WHERE res<>'ok'); END IF;
END $$;
ROLLBACK;
