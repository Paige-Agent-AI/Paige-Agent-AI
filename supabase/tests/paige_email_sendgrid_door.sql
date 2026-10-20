-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Experience 03 · S3 — rollback proof for 20271031000100_paige_email_sendgrid_governed_door.sql.
--
-- ISOLATED production-schema clone (or the local stack) only; never COMMIT. Run from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/paige_email_sendgrid_door.sql
-- The migration is applied INSIDE the transaction (\ir), so it and every fixture vanish on ROLLBACK.
-- Ends with a report row and RAISES if any assertion failed, so psql exits non-zero.
--
-- Proves: SendGrid verification facts are writable only by the verification service; a SendGrid
-- sender is admitted by prepare_comms_email_send ONLY with its own business's verified domain; a
-- lapse between prepare and send makes the binding ineligible (so claim refuses); Resend/Gmail are
-- unchanged; a SendGrid 'unknown' outcome is never reconcilable (no re-dispatch) and acceptance is
-- never delivery; the binding carries the drafted reply it answers (approval_id, NULL for every other
-- send), one live send per reply is a unique index, and a malformed/foreign approval or a replay naming
-- a different one is refused. Fixtures are fresh uuids, `pes-proof-*` slugs, .invalid mail (§63).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT set_config('request.jwt.claims', '{}', true);

CREATE TEMP TABLE _p(ord int, res text, label text);
GRANT SELECT, INSERT ON _p TO service_role, authenticated, anon;

-- Baseline BEFORE the migration: whatever rows exist, none can carry SendGrid facts yet.
CREATE TEMP TABLE _before AS SELECT count(*) AS n FROM public.tenant_email_domains;

\ir ../migrations/20271031000100_paige_email_sendgrid_governed_door.sql

-- Every assertion prints its own PASS/FAIL line as it runs (round-3 security: this proof used to print
-- none, so a reader could not see what it proved), and the report at the end still fails the run.
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
CREATE FUNCTION pg_temp.as_user(_uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', jsonb_build_object('sub',_uid,'role','authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true) $$;
CREATE FUNCTION pg_temp.as_none() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claims', '{}', true) $$;

-- ── 0. additive: the columns exist, nullable, and no existing row was given a fact ───────────
SELECT pg_temp.ok(1, (SELECT count(*)=3 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenant_email_domains'
  AND column_name IN ('sendgrid_domain_id','sendgrid_status','sendgrid_verified_at') AND is_nullable='YES' AND column_default IS NULL),
  'three nullable SendGrid fact columns with no default');
SELECT pg_temp.ok(2, (SELECT count(*)=(SELECT n FROM _before) AND count(*) FILTER (WHERE sendgrid_status IS NOT NULL OR sendgrid_domain_id IS NOT NULL OR sendgrid_verified_at IS NOT NULL)=0
  FROM public.tenant_email_domains), 'no existing domain row was touched or converted');

-- ── fixtures ─────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at)
SELECT u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'pes-proof-' || right(u, 4) || '@example.invalid', '', now(), now(), now()
FROM unnest(ARRAY['ffffffff-5e9d-4000-8000-000000000001','ffffffff-5e9d-4000-8000-000000000003']) u;
INSERT INTO public.tenants (id, slug, name, account_number_prefix, account_number, account_type, owner_user_id) VALUES
 ('aaaaaaaa-5e9d-4000-8000-000000000001','pes-proof-one','PES Proof One','PSA',985931,'standalone','ffffffff-5e9d-4000-8000-000000000001'),
 ('aaaaaaaa-5e9d-4000-8000-000000000002','pes-proof-two','PES Proof Two','PSB',985932,'standalone','ffffffff-5e9d-4000-8000-000000000003');
INSERT INTO public.tenant_members (tenant_id, user_id, status, role, is_owner) VALUES
 ('aaaaaaaa-5e9d-4000-8000-000000000001','ffffffff-5e9d-4000-8000-000000000001','active','owner'::public.tenant_role,true),
 ('aaaaaaaa-5e9d-4000-8000-000000000002','ffffffff-5e9d-4000-8000-000000000003','active','owner'::public.tenant_role,true);
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
 ('ffffffff-5e9d-4000-8000-000000000001','aaaaaaaa-5e9d-4000-8000-000000000001'),
 ('ffffffff-5e9d-4000-8000-000000000003','aaaaaaaa-5e9d-4000-8000-000000000002')
 ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, email) VALUES
 ('bbbbbbbb-5e9d-4000-8000-000000000001','aaaaaaaa-5e9d-4000-8000-000000000001','ffffffff-5e9d-4000-8000-000000000001','Proof','Lead','lead.one@example.invalid');
-- Connectors a workspace admin COULD write: SendGrid on the business's own domain, SendGrid on a domain
-- only the OTHER business verified, and the unchanged Resend + Gmail + an unsupported provider.
INSERT INTO public.channel_connectors (id, tenant_id, channel_type, provider, from_address, status, active) VALUES
 ('cccccccc-5e9d-4000-8000-000000000001','aaaaaaaa-5e9d-4000-8000-000000000001','email','sendgrid','Hello@Own.example.invalid','active',true),
 ('cccccccc-5e9d-4000-8000-000000000002','aaaaaaaa-5e9d-4000-8000-000000000001','email','sendgrid','ceo@victim.example.invalid','active',true),
 ('cccccccc-5e9d-4000-8000-000000000003','aaaaaaaa-5e9d-4000-8000-000000000001','email','resend','owner@resend.example.invalid','active',true),
 ('cccccccc-5e9d-4000-8000-000000000004','aaaaaaaa-5e9d-4000-8000-000000000001','email','gmail','owner@gmail.example.invalid','active',true),
 ('cccccccc-5e9d-4000-8000-000000000005','aaaaaaaa-5e9d-4000-8000-000000000001','email','mailchimp','owner@own.example.invalid','active',true);
-- Domain rows as manage-tenant-domain writes them (service role); SendGrid facts start NULL.
SELECT pg_temp.as_service();
INSERT INTO public.tenant_email_domains (id, tenant_id, domain, from_email_local, from_name, status) VALUES
 ('eeeeeeee-5e9d-4000-8000-000000000001','aaaaaaaa-5e9d-4000-8000-000000000001','own.example.invalid','hello','PES One','pending'),
 ('eeeeeeee-5e9d-4000-8000-000000000002','aaaaaaaa-5e9d-4000-8000-000000000002','victim.example.invalid','ceo','PES Two','pending');
SELECT pg_temp.as_none();

-- ── 1. provenance: only the verification service writes SendGrid facts ───────────────────────
SELECT pg_temp.as_user('ffffffff-5e9d-4000-8000-000000000001');
SELECT pg_temp.err(10, 'a signed-in admin cannot mark its domain SendGrid-verified',
  $q$UPDATE public.tenant_email_domains SET sendgrid_status='verified', sendgrid_domain_id='forged', sendgrid_verified_at=now() WHERE id='eeeeeeee-5e9d-4000-8000-000000000001'$q$,
  '42501', 'PAIGE_EMAIL_VERIFICATION_PROTECTED%');
SELECT pg_temp.err(11, 'a signed-in admin cannot insert a domain row that arrives verified',
  $q$INSERT INTO public.tenant_email_domains (tenant_id, domain, from_email_local, from_name, sendgrid_status, sendgrid_domain_id, sendgrid_verified_at) VALUES ('aaaaaaaa-5e9d-4000-8000-000000000001','forged.example.invalid','x','X','verified','forged',now())$q$,
  '42501', 'PAIGE_EMAIL_VERIFICATION_PROTECTED%');
-- The same trusted-writer rule as 20271031000250: a request without a signed-in subject is NOT the
-- verification service when it is the anon role (round-4 security LOW-4); a database session with no JWT
-- at all (a migration, an operator session) still is.
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT pg_temp.err(16, 'an anonymous request cannot write a SendGrid verification fact',
  $q$UPDATE public.tenant_email_domains SET sendgrid_status='pending' WHERE id='eeeeeeee-5e9d-4000-8000-000000000001'$q$,
  '42501', 'PAIGE_EMAIL_VERIFICATION_PROTECTED%');
SELECT pg_temp.as_none();
UPDATE public.tenant_email_domains SET sendgrid_status='pending' WHERE id='eeeeeeee-5e9d-4000-8000-000000000001';
SELECT pg_temp.ok(17, (SELECT sendgrid_status='pending' FROM public.tenant_email_domains WHERE id='eeeeeeee-5e9d-4000-8000-000000000001'),
  'a database session with no JWT (a migration or operator session) may still record a SendGrid fact');
SELECT pg_temp.as_service();
SELECT pg_temp.err(12, '"verified" without the provider domain id is not a fact',
  $q$UPDATE public.tenant_email_domains SET sendgrid_status='verified', sendgrid_verified_at=now() WHERE id='eeeeeeee-5e9d-4000-8000-000000000001'$q$,
  '23514', '%tenant_email_domains_sendgrid_verified_complete%');
SELECT pg_temp.err(13, 'an unknown SendGrid status is refused',
  $q$UPDATE public.tenant_email_domains SET sendgrid_status='valid' WHERE id='eeeeeeee-5e9d-4000-8000-000000000001'$q$,
  '23514', '%tenant_email_domains_sendgrid_status_check%');
-- Each domain carries its own provider domain id: one SendGrid domain belongs to one domain row
-- (tenant_email_domains_sendgrid_domain_id, 20271031000250).
UPDATE public.tenant_email_domains SET sendgrid_status='verified', sendgrid_domain_id='sg-dom-'||right(id::text,1), sendgrid_verified_at=now()
 WHERE id IN ('eeeeeeee-5e9d-4000-8000-000000000001','eeeeeeee-5e9d-4000-8000-000000000002');
SELECT pg_temp.ok(14, (SELECT count(*)=2 FROM public.tenant_email_domains WHERE sendgrid_status='verified' AND id::text LIKE 'eeeeeeee-5e9d-%'),
  'the verification service records SendGrid verification');
SELECT pg_temp.ok(15, (SELECT status='pending' FROM public.tenant_email_domains WHERE id='eeeeeeee-5e9d-4000-8000-000000000001'),
  'the Resend status is independent and untouched');
SELECT pg_temp.as_none();

-- ── 2. the single SQL answer ─────────────────────────────────────────────────────────────────
SELECT pg_temp.ok(20, public._comms_email_sendgrid_sender_verified('aaaaaaaa-5e9d-4000-8000-000000000001',' Hello@OWN.example.invalid '), 'own verified domain → verified (case/space-insensitive)');
SELECT pg_temp.ok(21, NOT public._comms_email_sendgrid_sender_verified('aaaaaaaa-5e9d-4000-8000-000000000001','ceo@victim.example.invalid'), 'another business''s verified domain → NOT verified');
SELECT pg_temp.ok(22, NOT public._comms_email_sendgrid_sender_verified('aaaaaaaa-5e9d-4000-8000-000000000001','a@sub.own.example.invalid'), 'a subdomain is a different domain');
SELECT pg_temp.ok(23, NOT public._comms_email_sendgrid_sender_verified('aaaaaaaa-5e9d-4000-8000-000000000001','x@y@own.example.invalid')
  AND NOT public._comms_email_sendgrid_sender_verified('aaaaaaaa-5e9d-4000-8000-000000000001',NULL)
  AND NOT public._comms_email_sendgrid_sender_verified(NULL,'hello@own.example.invalid'), 'malformed or missing input → NOT verified');

-- ── 3. prepare admission ─────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.gov() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('actor_user_id','ffffffff-5e9d-4000-8000-000000000001','tenant_id','aaaaaaaa-5e9d-4000-8000-000000000001',
  'tool','comms_send_email','action','comms.email_send','approval_channel','operator_card','approved_fingerprint','0123456789abcdef',
  'decision_receipt_recorded',true) $$;
CREATE FUNCTION pg_temp.op(_op int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('dddddddd-5e9d-4000-8000-'||lpad(_op::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.prep(_op int, _connector uuid, _from text, _subject text DEFAULT 'Thanks for reaching out', _gov jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_comms_email_send('ffffffff-5e9d-4000-8000-000000000001','aaaaaaaa-5e9d-4000-8000-000000000001',pg_temp.op(_op),
  'bbbbbbbb-5e9d-4000-8000-000000000001','lead.one@example.invalid',_connector,_from,_subject,'Hello there.','<p>Hello there.</p>',
  encode(extensions.digest(convert_to('lead.one@example.invalid'||E'\n'||_connector::text||E'\n'||_subject||E'\n'||'Hello there.','UTF8'),'sha256'),'hex'),
  jsonb_build_object('action','comms.email_send','contact_id','bbbbbbbb-5e9d-4000-8000-000000000001','connector_id',_connector,'subject',_subject,'body','Hello there.'),
  pg_temp.gov() || _gov) $$;
CREATE FUNCTION pg_temp.msg(_op int) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(_op)::text $$;

SET LOCAL ROLE service_role;
SELECT pg_temp.err(30, 'SendGrid From on a domain only ANOTHER business verified is refused',
  $q$SELECT pg_temp.prep(30,'cccccccc-5e9d-4000-8000-000000000002','ceo@victim.example.invalid')$q$, '42501', 'COMMS_EMAIL_SENDER_UNVERIFIED');
CREATE TEMP TABLE _r31 AS SELECT pg_temp.prep(31,'cccccccc-5e9d-4000-8000-000000000001','hello@own.example.invalid') r;
SELECT pg_temp.ok(31, (SELECT r->>'ok'='true' AND r->>'state'='prepared' FROM _r31), 'SendGrid From on the business''s own verified domain is prepared');
SELECT pg_temp.ok(32, (SELECT m.meta#>>'{comms_email_binding,provider}'='sendgrid' AND m.meta#>>'{comms_email_binding,from_address}'='hello@own.example.invalid' AND m.status='draft'
  FROM public.messages m WHERE m.id=pg_temp.msg(31)), 'the binding names provider sendgrid and the verified From');
CREATE TEMP TABLE _r33 AS SELECT pg_temp.prep(33,'cccccccc-5e9d-4000-8000-000000000003','owner@resend.example.invalid') r;
CREATE TEMP TABLE _r34 AS SELECT pg_temp.prep(34,'cccccccc-5e9d-4000-8000-000000000004','owner@gmail.example.invalid') r;
SELECT pg_temp.ok(33, (SELECT (SELECT r->>'state' FROM _r33)='prepared' AND (SELECT r->>'state' FROM _r34)='prepared'),
  'Resend and Gmail senders are admitted exactly as before (no SendGrid facts needed)');
SELECT pg_temp.err(35, 'an unsupported provider is still refused',
  $q$SELECT pg_temp.prep(35,'cccccccc-5e9d-4000-8000-000000000005','owner@own.example.invalid')$q$, '40001', 'COMMS_EMAIL_SENDER_CHANGED');
RESET ROLE;

-- An admin renames its verified row to the other business's domain: the facts do NOT travel with it.
SELECT pg_temp.as_user('ffffffff-5e9d-4000-8000-000000000001');
INSERT INTO public.tenant_email_domains (id, tenant_id, domain, from_email_local, from_name)
 VALUES ('eeeeeeee-5e9d-4000-8000-000000000003','aaaaaaaa-5e9d-4000-8000-000000000001','spare.example.invalid','x','X');
SELECT pg_temp.as_service();
UPDATE public.tenant_email_domains SET sendgrid_status='verified', sendgrid_domain_id='sg-dom-spare', sendgrid_verified_at=now() WHERE id='eeeeeeee-5e9d-4000-8000-000000000003';
SELECT pg_temp.as_user('ffffffff-5e9d-4000-8000-000000000001');
UPDATE public.tenant_email_domains SET domain='victim.example.invalid' WHERE id='eeeeeeee-5e9d-4000-8000-000000000003';
SELECT pg_temp.ok(36, (SELECT sendgrid_status IS NULL AND sendgrid_domain_id IS NULL AND sendgrid_verified_at IS NULL FROM public.tenant_email_domains WHERE id='eeeeeeee-5e9d-4000-8000-000000000003'),
  'renaming a verified row clears its SendGrid facts');
SELECT pg_temp.as_none();
SET LOCAL ROLE service_role;
SELECT pg_temp.err(37, 'the renamed row does not admit the other business''s From',
  $q$SELECT pg_temp.prep(37,'cccccccc-5e9d-4000-8000-000000000002','ceo@victim.example.invalid')$q$, '42501', 'COMMS_EMAIL_SENDER_UNVERIFIED');
SELECT pg_temp.ok(38, (SELECT count(*)=0 FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}' IN (pg_temp.op(30)::text, pg_temp.op(35)::text, pg_temp.op(37)::text)),
  'no refused prepare wrote a row');

-- ── 4. send-time re-check: a lapse after approval makes the binding ineligible ───────────────
SELECT pg_temp.ok(40, (SELECT (public.read_comms_email_send_binding(pg_temp.msg(31))->>'eligible')::boolean), 'verified SendGrid binding is eligible');
RESET ROLE;
SELECT pg_temp.as_service();
UPDATE public.tenant_email_domains SET sendgrid_status='failed' WHERE id='eeeeeeee-5e9d-4000-8000-000000000001';
SELECT pg_temp.as_none();
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(41, (SELECT NOT (public.read_comms_email_send_binding(pg_temp.msg(31))->>'eligible')::boolean), 'verification lapsed → binding NOT eligible');
SELECT pg_temp.ok(42, (SELECT r->'admitted'='false'::jsonb AND r->>'state'='prepared' FROM (SELECT public.claim_comms_email_send(pg_temp.msg(31),pg_temp.op(31)) r) x),
  'claim refuses to admit an ineligible SendGrid send (nothing is dispatched)');
SELECT pg_temp.ok(43, (SELECT (public.read_comms_email_send_binding(pg_temp.msg(33))->>'eligible')::boolean), 'a Resend binding is unaffected by SendGrid facts');
RESET ROLE;
SELECT pg_temp.as_service();
UPDATE public.tenant_email_domains SET sendgrid_status='verified' WHERE id='eeeeeeee-5e9d-4000-8000-000000000001';
SELECT pg_temp.as_none();

-- ── 5. honest outcomes: acceptance is not delivery; unknown is never re-dispatched ───────────
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(50, (SELECT r->'admitted'='true'::jsonb AND r->>'attempts'='1' FROM (SELECT public.claim_comms_email_send(pg_temp.msg(31),pg_temp.op(31)) r) x), 'claim admits the re-verified send');
SELECT pg_temp.ok(51, (SELECT r->>'outcome'='unknown' FROM (SELECT public.finalize_comms_email_send(pg_temp.msg(31),pg_temp.op(31),'unknown',NULL,'provider_result_unconfirmed',1) r) x),
  'a timed-out SendGrid send is recorded unknown');
SELECT pg_temp.ok(52, (SELECT r->>'reconcilable'='false' AND r->>'provider'='sendgrid' AND r->>'outcome'='unknown' AND r->>'delivery_confirmed'='false'
  FROM (SELECT public.read_comms_email_send_result('ffffffff-5e9d-4000-8000-000000000001','aaaaaaaa-5e9d-4000-8000-000000000001',pg_temp.op(31)) r) x),
  'a SendGrid unknown is NOT reconcilable (no idempotent replay exists)');
SELECT pg_temp.ok(53, (SELECT r->'admitted'='false'::jsonb AND r->>'state'='unknown' FROM (SELECT public.claim_comms_email_send(pg_temp.msg(31),pg_temp.op(31),true) r) x),
  'a reconcile claim on a SendGrid unknown is refused — never re-dispatched');
SELECT pg_temp.err(54, 'the identical email cannot be prepared again while its outcome is unknown',
  $q$SELECT pg_temp.prep(54,'cccccccc-5e9d-4000-8000-000000000001','hello@own.example.invalid')$q$, '55000', 'COMMS_EMAIL_RECONCILIATION_REQUIRED');
CREATE TEMP TABLE _r55 AS SELECT pg_temp.prep(55,'cccccccc-5e9d-4000-8000-000000000001','hello@own.example.invalid','A different reply') r;
SELECT public.claim_comms_email_send(pg_temp.msg(55),pg_temp.op(55));
SELECT pg_temp.ok(55, (SELECT r->>'ok'='true' AND r->>'outcome'='provider_accepted' AND r->>'delivery_confirmed'='false'
  FROM (SELECT public.finalize_comms_email_send(pg_temp.msg(55),pg_temp.op(55),'provider_accepted','sg-x-message-id-55',NULL,1) r) x),
  'HTTP 202 + X-Message-Id is provider_accepted with delivery_confirmed=false');
SELECT pg_temp.ok(56, (SELECT status='sent' AND provider_message_id='sg-x-message-id-55' FROM public.messages WHERE id=pg_temp.msg(55)),
  'the receipt id is stored for webhook correlation');
RESET ROLE;

-- ── 5b. one live send per drafted reply (the binding carries the approval) ────────────────────
-- The reply-specific cases (in-progress, already-sent, replay mismatch, contact, kind, cited send) are
-- driven with real reply approvals in exp03_lead_reply_draft.sql §4a; here, the door's own shape.
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(57, (SELECT i.indisunique AND pg_get_indexdef(i.indexrelid) LIKE '%lower((meta #>> ''{comms_email_binding,approval_id}''::text[]))%'
   AND pg_get_expr(i.indpred,i.indrelid) LIKE '%failed%' AND pg_get_expr(i.indpred,i.indrelid) LIKE '%refused%'
   FROM pg_index i WHERE i.indexrelid='public.messages_comms_email_approval_live'::regclass),
  'one live send per approval: UNIQUE on lower(binding.approval_id), partial to sends that have not failed/been refused');
SELECT pg_temp.ok(58, (SELECT bool_and(m.meta->'comms_email_binding' ? 'approval_id' AND m.meta->'comms_email_binding'->'approval_id'='null'::jsonb)
  FROM public.messages m WHERE m.id IN (pg_temp.msg(31),pg_temp.msg(33),pg_temp.msg(55))),
  'a send that names no reply carries approval_id null (every non-reply caller is unchanged)');
SELECT pg_temp.err(59, 'a malformed approval id in the governance record is refused',
  $q$SELECT pg_temp.prep(59,'cccccccc-5e9d-4000-8000-000000000003','owner@resend.example.invalid','R59','{"approval_id":"nope"}')$q$, '22023', 'COMMS_EMAIL_CONTENT_INVALID');
SELECT pg_temp.err(60, 'an approval that is not this business''s drafted reply is refused before anything is written',
  $q$SELECT pg_temp.prep(60,'cccccccc-5e9d-4000-8000-000000000003','owner@resend.example.invalid','R60','{"approval_id":"aaaaaaaa-5e9d-4000-8000-0000000000ff"}')$q$, '42501', 'COMMS_EMAIL_APPROVAL_INVALID');
SELECT pg_temp.err(62, 'replaying a send made for no reply while naming one is a replay mismatch',
  $q$SELECT pg_temp.prep(33,'cccccccc-5e9d-4000-8000-000000000003','owner@resend.example.invalid','Thanks for reaching out','{"approval_id":"aaaaaaaa-5e9d-4000-8000-0000000000ff"}')$q$, '22023', 'COMMS_EMAIL_REPLAY_MISMATCH');
SELECT pg_temp.ok(63, (SELECT count(*)=0 FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}' IN (pg_temp.op(59)::text, pg_temp.op(60)::text)),
  'no refused prepare wrote a row');
RESET ROLE;

-- ── 6. grants ────────────────────────────────────────────────────────────────────────────────
SELECT pg_temp.ok(70, NOT has_function_privilege('authenticated','public._comms_email_sendgrid_sender_verified(uuid,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public._comms_email_sendgrid_sender_verified(uuid,text)','EXECUTE')
  AND has_function_privilege('service_role','public._comms_email_sendgrid_sender_verified(uuid,text)','EXECUTE'), 'helper is service_role-only');
SELECT pg_temp.ok(71, NOT has_function_privilege('authenticated','public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.read_comms_email_send_binding(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.read_comms_email_send_binding(uuid)','EXECUTE'), 'replaced functions keep service_role-only grants');

SELECT count(*) FILTER (WHERE res='ok') AS ok,
       count(*) FILTER (WHERE res<>'ok') AS failed,
       jsonb_agg(jsonb_build_object('ord', ord, 'res', res, 'label', label) ORDER BY ord) FILTER (WHERE res<>'ok') AS failures
FROM _p;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM _p WHERE res<>'ok') THEN RAISE EXCEPTION 'paige_email_sendgrid_door: % assertion(s) failed', (SELECT count(*) FROM _p WHERE res<>'ok'); END IF;
END $$;
ROLLBACK;
