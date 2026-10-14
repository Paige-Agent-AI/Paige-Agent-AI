-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Experience 03 · S3 — rollback proof for 20271101042133_tenant_email_domains_normalize_domain.sql
-- (issue #2133).
--
-- ISOLATED production-schema clone (or the local stack) only; never COMMIT. Run from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/tenant_email_domain_normalization.sql
-- 20271031000100, 20271031000250 and this migration are applied INSIDE the transaction (\ir), so they
-- and every fixture vanish on ROLLBACK. Every assertion prints PASS/FAIL as it runs; the report at the
-- end RAISES if any failed, so psql exits non-zero.
--
-- Proves: a sending domain is stored as lower(btrim(domain)) however it is written, so the readiness
-- read (readiness.ts readSendgridSenderVerified: exact equality on the lower-cased From domain) and
-- the database predicate _comms_email_sendgrid_sender_verified answer the SAME for a mixed-case /
-- space-padded domain; a case-or-space-only edit keeps a SendGrid verification, a real re-point still
-- clears it; a connector provisioned on verify and the delete/unverify switch-off still find each
-- other; and the backfill normalizes old rows without losing a verification, and refuses (deleting
-- nothing) when two rows of a business would collide or a connector hangs off the old spelling.
-- Fixtures are fresh uuids, `ted-norm-proof-*` slugs, .invalid mail (§63).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT set_config('request.jwt.claims', '{}', true);

CREATE TEMP TABLE _p(ord int, res text, label text);

\ir ../migrations/20271031000100_paige_email_sendgrid_governed_door.sql
\ir ../migrations/20271031000250_paige_email_sendgrid_sender_integrity.sql
\ir ../migrations/20271101042133_tenant_email_domains_normalize_domain.sql

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
CREATE FUNCTION pg_temp.runs(_ord int, _label text, _sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text := 'no error';
BEGIN
 BEGIN EXECUTE _sql; EXCEPTION WHEN OTHERS THEN got := SQLSTATE || ' ' || SQLERRM; END;
 PERFORM pg_temp.ok(_ord, got = 'no error', _label || CASE WHEN got = 'no error' THEN '' ELSE ' (got ' || got || ')' END);
END $$;
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', jsonb_build_object('sub',_uid,'role','authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;
CREATE FUNCTION pg_temp.as_none() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', '{}', true) $$;

-- The readiness read, line for line (supabase/functions/_shared/comms-email/readiness.ts,
-- readSendgridSenderVerified): address = from.trim().toLowerCase(); exactly one '@' and a non-empty
-- domain; ONE row by .eq('tenant_id').eq('domain', <domain>) — PostgREST exact equality on the stored
-- column; then the row's own trimmed/lower-cased domain, 'verified', a verified_at and a domain id.
-- (JS trim() strips all whitespace, btrim() only spaces; every fixture below pads with spaces only.)
CREATE FUNCTION pg_temp.readiness_verified(_tenant uuid, _from text) RETURNS boolean LANGUAGE sql AS $$
 WITH a AS (SELECT lower(btrim(_from)) AS addr)
 SELECT coalesce((SELECT array_length(string_to_array(addr, '@'), 1) = 2 AND split_part(addr, '@', 2) <> '' FROM a), false)
   AND EXISTS (SELECT 1 FROM public.tenant_email_domains d, a
                WHERE d.tenant_id = _tenant AND d.domain = split_part(a.addr, '@', 2)
                  AND lower(btrim(d.domain)) = split_part(a.addr, '@', 2)
                  AND d.sendgrid_status = 'verified' AND d.sendgrid_verified_at IS NOT NULL
                  AND coalesce(length(btrim(d.sendgrid_domain_id)), 0) > 0) $$;
CREATE FUNCTION pg_temp.agree(_tenant uuid, _from text) RETURNS boolean LANGUAGE sql AS $$
 SELECT pg_temp.readiness_verified(_tenant, _from) = public._comms_email_sendgrid_sender_verified(_tenant, _from) $$;

-- ── 0. shape ─────────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.ok(1, EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.tenant_email_domains'::regclass
  AND tgname='trg_domain_normalize' AND NOT tgisinternal AND tgenabled <> 'D'
  AND pg_get_triggerdef(oid) LIKE '%BEFORE INSERT OR UPDATE OF domain ON public.tenant_email_domains FOR EACH ROW EXECUTE FUNCTION normalize_tenant_email_domain()%'),
  'trg_domain_normalize is installed BEFORE INSERT OR UPDATE OF domain, row-level');
SELECT pg_temp.ok(2, coalesce((SELECT NOT prosecdef FROM pg_proc WHERE proname='normalize_tenant_email_domain' AND pronamespace='public'::regnamespace), false)
  AND NOT has_function_privilege('authenticated','public.normalize_tenant_email_domain()','EXECUTE')
  AND NOT has_function_privilege('anon','public.normalize_tenant_email_domain()','EXECUTE'),
  'normalizer is SECURITY INVOKER and granted to no app role (§59)');
-- Same-timing BEFORE triggers fire in name order: the normalizer must run before both guards.
SELECT pg_temp.ok(3, EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.tenant_email_domains'::regclass AND tgname='trg_domain_normalize')
  AND coalesce((SELECT bool_and('trg_domain_normalize' < tgname) FROM pg_trigger
  WHERE tgrelid='public.tenant_email_domains'::regclass AND NOT tgisinternal AND tgname <> 'trg_domain_normalize'
    AND (tgtype & 2) <> 0), false),
  'the normalizer sorts (fires) before every other BEFORE trigger on the table');

-- ── fixtures ─────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at)
SELECT u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'ted-norm-proof-' || right(u, 4) || '@example.invalid', '', now(), now(), now()
FROM unnest(ARRAY['ffffffff-2133-4000-8000-000000000001','ffffffff-2133-4000-8000-000000000002']) u;
INSERT INTO public.tenants (id, slug, name, account_number_prefix, account_number, account_type, owner_user_id) VALUES
 ('aaaaaaaa-2133-4000-8000-000000000001','ted-norm-proof-one','TED Norm Proof One','TNA',982131,'standalone','ffffffff-2133-4000-8000-000000000001'),
 ('aaaaaaaa-2133-4000-8000-000000000002','ted-norm-proof-two','TED Norm Proof Two','TNB',982132,'standalone','ffffffff-2133-4000-8000-000000000002');
INSERT INTO public.tenant_members (tenant_id, user_id, status, role, is_owner) VALUES
 ('aaaaaaaa-2133-4000-8000-000000000001','ffffffff-2133-4000-8000-000000000001','active','owner'::public.tenant_role,true),
 ('aaaaaaaa-2133-4000-8000-000000000002','ffffffff-2133-4000-8000-000000000002','active','owner'::public.tenant_role,true);

-- ── 1. every writer stores one spelling ──────────────────────────────────────────────────────
SELECT pg_temp.as_service();
INSERT INTO public.tenant_email_domains (id, tenant_id, domain, from_email_local, from_name, status) VALUES
 ('eeeeeeee-2133-4000-8000-000000000001','aaaaaaaa-2133-4000-8000-000000000001','  Mixed.Example.INVALID ','hello','One','pending');
SELECT pg_temp.ok(10, (SELECT domain FROM public.tenant_email_domains WHERE id='eeeeeeee-2133-4000-8000-000000000001') = 'mixed.example.invalid',
  'a mixed-case, space-padded INSERT is stored as lower(btrim(domain))');
SELECT pg_temp.runs(11, 'the verification service records the SendGrid facts',
  $q$UPDATE public.tenant_email_domains SET sendgrid_status='verified', sendgrid_domain_id='sg-2133-1', sendgrid_verified_at=now() WHERE id='eeeeeeee-2133-4000-8000-000000000001'$q$);

-- ── 2. readiness and the database predicate now agree (the #2133 defect) ─────────────────────
SELECT pg_temp.ok(20, public._comms_email_sendgrid_sender_verified('aaaaaaaa-2133-4000-8000-000000000001','hello@mixed.example.invalid'),
  'the database predicate admits the sender');
SELECT pg_temp.ok(21, pg_temp.readiness_verified('aaaaaaaa-2133-4000-8000-000000000001','hello@mixed.example.invalid'),
  'readiness (exact-equality lookup) finds the same verified domain — no false SENDER_VERIFICATION_MISSING');
SELECT pg_temp.ok(22, (SELECT bool_and(pg_temp.agree('aaaaaaaa-2133-4000-8000-000000000001', f)) FROM unnest(ARRAY[
   'hello@mixed.example.invalid', 'Hello@Mixed.Example.INVALID', '  HELLO@MIXED.EXAMPLE.INVALID ',
   'hello@other.example.invalid', 'not-an-address', 'a@b@mixed.example.invalid', '']) f),
  'readiness = predicate for every From spelling (verified, mixed-case, padded, another domain, malformed)');
SELECT pg_temp.ok(23, NOT pg_temp.readiness_verified('aaaaaaaa-2133-4000-8000-000000000002','hello@mixed.example.invalid')
  AND pg_temp.agree('aaaaaaaa-2133-4000-8000-000000000002','hello@mixed.example.invalid'),
  'another business is not verified for the domain, and both readers say so');

-- ── 3. an UPDATE is normalized too; a spelling-only edit keeps the verification ──────────────
SELECT pg_temp.runs(30, 'a case/space-only domain edit is accepted',
  $q$UPDATE public.tenant_email_domains SET domain=' MIXED.example.Invalid ' WHERE id='eeeeeeee-2133-4000-8000-000000000001'$q$);
SELECT pg_temp.ok(31, (SELECT domain='mixed.example.invalid' AND sendgrid_status='verified' AND sendgrid_domain_id='sg-2133-1' AND sendgrid_verified_at IS NOT NULL
  FROM public.tenant_email_domains WHERE id='eeeeeeee-2133-4000-8000-000000000001'),
  'it is stored normalized and keeps its SendGrid verification (same domain)');
SELECT pg_temp.ok(32, pg_temp.agree('aaaaaaaa-2133-4000-8000-000000000001','hello@mixed.example.invalid')
  AND pg_temp.readiness_verified('aaaaaaaa-2133-4000-8000-000000000001','hello@mixed.example.invalid'),
  'both readers still admit the sender after the edit');
SELECT pg_temp.runs(33, 'a real re-point to another domain is accepted',
  $q$UPDATE public.tenant_email_domains SET domain='Elsewhere.Example.invalid' WHERE id='eeeeeeee-2133-4000-8000-000000000001'$q$);
SELECT pg_temp.ok(34, (SELECT domain='elsewhere.example.invalid' AND sendgrid_status IS NULL AND sendgrid_domain_id IS NULL AND sendgrid_verified_at IS NULL
  FROM public.tenant_email_domains WHERE id='eeeeeeee-2133-4000-8000-000000000001'),
  'a real re-point still clears the verification (guard unchanged in substance)');
SELECT pg_temp.ok(35, pg_temp.agree('aaaaaaaa-2133-4000-8000-000000000001','hello@elsewhere.example.invalid')
  AND NOT public._comms_email_sendgrid_sender_verified('aaaaaaaa-2133-4000-8000-000000000001','hello@elsewhere.example.invalid'),
  'neither reader admits the re-pointed, unverified domain');
-- A signed-in caller's direct write is normalized as well (the RLS path no edge function mediates).
SELECT pg_temp.as_user('ffffffff-2133-4000-8000-000000000001');
SELECT pg_temp.runs(36, 'a signed-in caller can still edit a non-SendGrid column',
  $q$UPDATE public.tenant_email_domains SET from_name='One Renamed' WHERE id='eeeeeeee-2133-4000-8000-000000000001'$q$);
SELECT pg_temp.as_service();

-- ── 4. one business cannot hold the same domain twice under two spellings ───────────────────
SELECT pg_temp.err(40, 'a second row of the same business differing only by case/spaces is refused',
  $q$INSERT INTO public.tenant_email_domains (tenant_id, domain, from_email_local, from_name, status) VALUES ('aaaaaaaa-2133-4000-8000-000000000001',' ELSEWHERE.example.invalid','b','B','pending')$q$,
  '23505', '%tenant_email_domains_tenant_id_domain_key%');
SELECT pg_temp.runs(41, 'another business may still add the same domain (pending)',
  $q$INSERT INTO public.tenant_email_domains (tenant_id, domain, from_email_local, from_name, status) VALUES ('aaaaaaaa-2133-4000-8000-000000000002',' ELSEWHERE.example.invalid','b','B','pending')$q$);

-- ── 5. provision-on-verify and the switch-off still find each other ─────────────────────────
INSERT INTO public.tenant_email_domains (id, tenant_id, domain, from_email_local, from_name, status, verified_at) VALUES
 ('eeeeeeee-2133-4000-8000-000000000005','aaaaaaaa-2133-4000-8000-000000000002',' Prov.Example.INVALID','team','Two','verified',now());
SELECT pg_temp.ok(50, EXISTS (SELECT 1 FROM public.channel_connectors WHERE tenant_id='aaaaaaaa-2133-4000-8000-000000000002'
  AND channel_type='email' AND inbound_domain='prov.example.invalid' AND from_address='team@prov.example.invalid' AND active),
  'the connector provisioned on verify carries the normalized domain and From');
DELETE FROM public.tenant_email_domains WHERE id='eeeeeeee-2133-4000-8000-000000000005';
SELECT pg_temp.ok(51, NOT EXISTS (SELECT 1 FROM public.channel_connectors WHERE tenant_id='aaaaaaaa-2133-4000-8000-000000000002'
  AND inbound_domain='prov.example.invalid' AND active),
  'removing the domain still switches that connector off (exact inbound_domain match holds)');

-- ── 6. the backfill: normalizes without losing a verification; refuses instead of merging ────
-- Plant legacy spellings the way they existed before the trigger (normalizer switched off for the
-- plant only), then replay the REAL migration.
SELECT pg_temp.as_none();
ALTER TABLE public.tenant_email_domains DISABLE TRIGGER trg_domain_normalize;
INSERT INTO public.tenant_email_domains (id, tenant_id, domain, from_email_local, from_name, status, sendgrid_status, sendgrid_domain_id, sendgrid_verified_at) VALUES
 ('eeeeeeee-2133-4000-8000-000000000061','aaaaaaaa-2133-4000-8000-000000000001',' Legacy.Example.INVALID ','hi','One','pending','verified','sg-2133-61',now());
ALTER TABLE public.tenant_email_domains ENABLE TRIGGER trg_domain_normalize;
SELECT pg_temp.ok(60, NOT pg_temp.readiness_verified('aaaaaaaa-2133-4000-8000-000000000001','hi@legacy.example.invalid')
  AND public._comms_email_sendgrid_sender_verified('aaaaaaaa-2133-4000-8000-000000000001','hi@legacy.example.invalid'),
  'control: a legacy-spelled verified row reproduces the #2133 disagreement before the backfill');
\ir ../migrations/20271101042133_tenant_email_domains_normalize_domain.sql
SELECT pg_temp.ok(61, (SELECT domain='legacy.example.invalid' AND sendgrid_status='verified' AND sendgrid_domain_id='sg-2133-61' AND sendgrid_verified_at IS NOT NULL
  FROM public.tenant_email_domains WHERE id='eeeeeeee-2133-4000-8000-000000000061'),
  'the backfill normalizes the legacy row and keeps its SendGrid verification');
SELECT pg_temp.ok(62, pg_temp.readiness_verified('aaaaaaaa-2133-4000-8000-000000000001','hi@legacy.example.invalid')
  AND pg_temp.agree('aaaaaaaa-2133-4000-8000-000000000001','hi@legacy.example.invalid'),
  'after the backfill both readers admit the sender');

-- Collision: two rows of one business that would become the same domain.
ALTER TABLE public.tenant_email_domains DISABLE TRIGGER trg_domain_normalize;
INSERT INTO public.tenant_email_domains (id, tenant_id, domain, from_email_local, from_name, status) VALUES
 ('eeeeeeee-2133-4000-8000-000000000062','aaaaaaaa-2133-4000-8000-000000000002','dup.example.invalid','a','A','pending'),
 ('eeeeeeee-2133-4000-8000-000000000063','aaaaaaaa-2133-4000-8000-000000000002','DUP.example.invalid ','b','B','pending');
ALTER TABLE public.tenant_email_domains ENABLE TRIGGER trg_domain_normalize;
-- The replay must stop at its own check (psql prints the expected TENANT_EMAIL_DOMAIN_NORMALIZE_REFUSED
-- on stderr). The state is read BEFORE the savepoint is rolled back: a SELECT inside an aborted
-- transaction fails, so replay_collision keeps 'aborted' only if the migration really refused.
\set replay_collision aborted
SAVEPOINT replay_collision;
\set ON_ERROR_STOP 0
\ir ../migrations/20271101042133_tenant_email_domains_normalize_domain.sql
SELECT 'completed' AS replay_collision \gset
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT replay_collision;
SELECT pg_temp.ok(63, :'replay_collision' = 'aborted'
  AND (SELECT count(*)=2 FROM public.tenant_email_domains WHERE id IN ('eeeeeeee-2133-4000-8000-000000000062','eeeeeeee-2133-4000-8000-000000000063')),
  'a same-business collision makes the migration refuse; both rows survive (nothing merged or deleted)');
DELETE FROM public.tenant_email_domains WHERE id IN ('eeeeeeee-2133-4000-8000-000000000062','eeeeeeee-2133-4000-8000-000000000063');

-- A connector provisioned on the old spelling: rewriting the domain alone would orphan it.
ALTER TABLE public.tenant_email_domains DISABLE TRIGGER trg_domain_normalize;
INSERT INTO public.tenant_email_domains (id, tenant_id, domain, from_email_local, from_name, status, verified_at) VALUES
 ('eeeeeeee-2133-4000-8000-000000000064','aaaaaaaa-2133-4000-8000-000000000002','Linked.Example.invalid','x','X','verified',now());
ALTER TABLE public.tenant_email_domains ENABLE TRIGGER trg_domain_normalize;
SELECT pg_temp.ok(64, EXISTS (SELECT 1 FROM public.channel_connectors WHERE inbound_domain='Linked.Example.invalid'),
  'control: a connector was provisioned on the legacy spelling');
\set replay_linked aborted
SAVEPOINT replay_linked;
\set ON_ERROR_STOP 0
\ir ../migrations/20271101042133_tenant_email_domains_normalize_domain.sql
SELECT 'completed' AS replay_linked \gset
\set ON_ERROR_STOP 1
ROLLBACK TO SAVEPOINT replay_linked;
SELECT pg_temp.ok(65, :'replay_linked' = 'aborted'
  AND (SELECT domain='Linked.Example.invalid' FROM public.tenant_email_domains WHERE id='eeeeeeee-2133-4000-8000-000000000064'),
  'a row backing a connector on its old spelling makes the migration refuse; the row is untouched');

SELECT count(*) FILTER (WHERE res='ok') AS ok,
       count(*) FILTER (WHERE res<>'ok') AS failed,
       jsonb_agg(jsonb_build_object('ord', ord, 'res', res, 'label', label) ORDER BY ord) FILTER (WHERE res<>'ok') AS failures
FROM _p;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM _p WHERE res<>'ok') THEN RAISE EXCEPTION 'tenant_email_domain_normalization: % assertion(s) failed', (SELECT count(*) FROM _p WHERE res<>'ok'); END IF;
END $$;
ROLLBACK;
