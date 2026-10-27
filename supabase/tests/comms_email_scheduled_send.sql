-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- "Approve now, send later" — rollback proof for 20271119000000_comms_email_scheduled_send.sql.
--
-- ISOLATED database only (the rebuilt CI stack, or a throwaway clone); never COMMIT. The migration
-- carries its own BEGIN/COMMIT, so it is NOT \ir'd here: it is already applied by the stack's
-- `migration up`, and this proof checks the applied bodies by md5. Run from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/comms_email_scheduled_send.sql
-- Ends with a report row and RAISES if any assertion failed, so psql exits non-zero.
--
-- Proves: the new functions are service_role-only SECURITY DEFINER with a pinned search_path; the
-- 13-argument prepare is untouched; a scheduled prepare stores queued + scheduled_for + send_at in
-- exactly Date#toISOString text; bad times, a drafted reply and an agreement send are refused; a
-- replay with another (or no) time is a mismatch; the claim does not admit before the time; once due
-- the release needs only the scheduler's SEAT (a workspace switch does not stop it) while an
-- immediate send by the same person is still refused; a removed seat raises; admission moves the row
-- queued -> draft; cancel wins before the claim, is too late after it, refuses a non-seat, an
-- immediate send and another business; the generic undo never touches a governed row. Fixtures are
-- fresh uuids, test-tenant-* slugs and .tests.invalid mail (§63). No provider is called.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT set_config('request.jwt.claims', '{}', true);

CREATE TEMP TABLE _p(ord int, res text, label text);
GRANT SELECT, INSERT ON _p TO service_role, authenticated, anon;

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

-- ── 0. shape and grants ──────────────────────────────────────────────────────────────────────
SELECT pg_temp.ok(1, (SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig,',')='search_path=pg_catalog, public'
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND has_function_privilege('service_role',p.oid,'EXECUTE')) AND count(*)=4
  FROM pg_proc p WHERE p.oid IN ('public._comms_email_seat(uuid,uuid)'::regprocedure, 'public._comms_email_release_actor(jsonb,uuid)'::regprocedure,
   'public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz)'::regprocedure,
   'public.cancel_comms_email_send(uuid,uuid,uuid)'::regprocedure)),
  'the four new functions are SECURITY DEFINER, search_path pinned, service_role only');
SELECT pg_temp.ok(2, (SELECT pronargdefaults=0 FROM pg_proc WHERE oid='public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz)'::regprocedure)
  AND (SELECT md5(prosrc)='8da3b64c24552123b973db96a74ab986' FROM pg_proc WHERE oid='public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)'::regprocedure),
  'the scheduled overload has no default (an immediate call can never reach it); the 13-argument prepare is byte-identical');
SELECT pg_temp.ok(3, (SELECT count(*)=4 AND bool_and(md5(p.prosrc)=e.body) FROM (VALUES
   ('public.read_comms_email_send_result(uuid,uuid,uuid)'::regprocedure,'d12d25b1d3859f5383dfde5bf4106060'),
   ('public.read_comms_email_send_binding(uuid)'::regprocedure,'7cdafa1530f75a2d7c02b08f5c6ccc7d'),
   ('public.claim_comms_email_send(uuid,uuid,boolean)'::regprocedure,'a9dfb75621838268a961152d19de954d'),
   ('public.cancel_scheduled_message(uuid)'::regprocedure,'c1fbef56be124fd68cc916dd54593f1c')) e(f,body) JOIN pg_proc p ON p.oid=e.f),
  'the four replaced bodies are exactly this migration''s');
SELECT pg_temp.ok(4, NOT has_function_privilege('authenticated','public.read_comms_email_send_binding(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.claim_comms_email_send(uuid,uuid,boolean)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.read_comms_email_send_result(uuid,uuid,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.cancel_scheduled_message(uuid)','EXECUTE'),
  'replaced functions keep their grants (the generic undo stays signed-in callable)');

-- ── fixtures ─────────────────────────────────────────────────────────────────────────────────
-- U1 owner, U2 admin, U3 member of business T1; T2 a second business U1 and U2 also belong to.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
SELECT u::uuid, 'authenticated', 'authenticated', 'sched-proof-' || right(u, 1) || '@example.tests.invalid', now()
FROM unnest(ARRAY['5c4ed000-0000-4000-8000-000000000001','5c4ed000-0000-4000-8000-000000000002','5c4ed000-0000-4000-8000-000000000003']) u;
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, account_number, features) VALUES
 ('5c4ed100-0000-4000-8000-000000000001','test-tenant-sched-one','Sched Proof One','active','standalone','SCHA',986101,'{}'),
 ('5c4ed100-0000-4000-8000-000000000002','test-tenant-sched-two','Sched Proof Two','active','standalone','SCHB',986102,'{}');
INSERT INTO public.tenant_members (tenant_id, user_id, status, role, is_owner) VALUES
 ('5c4ed100-0000-4000-8000-000000000001','5c4ed000-0000-4000-8000-000000000001','active','owner'::public.tenant_role,true),
 ('5c4ed100-0000-4000-8000-000000000001','5c4ed000-0000-4000-8000-000000000002','active','admin'::public.tenant_role,false),
 ('5c4ed100-0000-4000-8000-000000000001','5c4ed000-0000-4000-8000-000000000003','active','member'::public.tenant_role,false),
 ('5c4ed100-0000-4000-8000-000000000002','5c4ed000-0000-4000-8000-000000000001','active','admin'::public.tenant_role,false),
 ('5c4ed100-0000-4000-8000-000000000002','5c4ed000-0000-4000-8000-000000000002','active','owner'::public.tenant_role,true);
INSERT INTO public.profiles (user_id, active_tenant_id)
SELECT u::uuid, '5c4ed100-0000-4000-8000-000000000001'
FROM unnest(ARRAY['5c4ed000-0000-4000-8000-000000000001','5c4ed000-0000-4000-8000-000000000002','5c4ed000-0000-4000-8000-000000000003']) u
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, email) VALUES
 ('5c4ed200-0000-4000-8000-000000000001','5c4ed100-0000-4000-8000-000000000001','5c4ed000-0000-4000-8000-000000000001','Proof','Lead','lead.sched@example.tests.invalid');
-- The People address the governed door reads (a writer may already have synced it from clients.email).
INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary)
SELECT '5c4ed100-0000-4000-8000-000000000001','5c4ed200-0000-4000-8000-000000000001','email','lead.sched@example.tests.invalid',true
WHERE NOT EXISTS (SELECT 1 FROM public.client_contact_methods WHERE client_id='5c4ed200-0000-4000-8000-000000000001' AND kind='email');
INSERT INTO public.channel_connectors (id, tenant_id, channel_type, provider, from_address, status, active) VALUES
 ('5c4ed300-0000-4000-8000-000000000001','5c4ed100-0000-4000-8000-000000000001','email','resend','hello@sched.tests.invalid','active',true);

CREATE FUNCTION pg_temp.op(_n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('5c4ed400-0000-4000-8000-'||lpad(_n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('5c4ed000-0000-4000-8000-'||lpad(_n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.msg(_n int) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(_n)::text $$;
CREATE FUNCTION pg_temp.b(_n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT meta->'comms_email_binding' FROM public.messages WHERE id=pg_temp.msg(_n) $$;
CREATE FUNCTION pg_temp.gov(_actor uuid, _extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('actor_user_id',_actor,'tenant_id','5c4ed100-0000-4000-8000-000000000001',
  'tool','comms_send_email','action','comms.email_send','approval_channel','operator_card','approved_fingerprint','0123456789abcdef',
  'decision_receipt_recorded',true) || _extra $$;
-- The 13 arguments as the door builds them; subject 'Note n' so every operation's content is distinct.
CREATE FUNCTION pg_temp.args(_n int, _actor uuid) RETURNS text LANGUAGE sql AS $$
 SELECT format('%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L::uuid,%L,%L,%L,%L,%L,%L::jsonb',
  _actor,'5c4ed100-0000-4000-8000-000000000001',pg_temp.op(_n),'5c4ed200-0000-4000-8000-000000000001','lead.sched@example.tests.invalid',
  '5c4ed300-0000-4000-8000-000000000001','hello@sched.tests.invalid','Note '||_n,'Hello there.','<p>Hello there.</p>',
  encode(extensions.digest(convert_to('lead.sched@example.tests.invalid'||E'\n'||'5c4ed300-0000-4000-8000-000000000001'||E'\n'||'Note '||_n||E'\n'||'Hello there.','UTF8'),'sha256'),'hex'),
  jsonb_build_object('action','comms.email_send','contact_id','5c4ed200-0000-4000-8000-000000000001','connector_id','5c4ed300-0000-4000-8000-000000000001','subject','Note '||_n,'body','Hello there.')) $$;
CREATE FUNCTION pg_temp.prep(_n int, _actor uuid, _send_at timestamptz, _gov jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN
 EXECUTE format('SELECT public.prepare_comms_email_send(%s,%L::jsonb,%L::timestamptz)', pg_temp.args(_n,_actor), pg_temp.gov(_actor,_gov), _send_at) INTO r;
 RETURN r; END $$;
CREATE FUNCTION pg_temp.prep_now(_n int, _actor uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN
 EXECUTE format('SELECT public.prepare_comms_email_send(%s,%L::jsonb)', pg_temp.args(_n,_actor), pg_temp.gov(_actor)) INTO r;
 RETURN r; END $$;
-- "Time passes": move a prepared scheduled row's time (binding + column) into the past, as the
-- database owner. A transaction's now() cannot advance, so this is the only way to make it due here.
CREATE FUNCTION pg_temp.make_due(_n int) RETURNS void LANGUAGE sql AS $$
 UPDATE public.messages SET scheduled_for=date_trunc('minute',now())-interval '2 minutes',
  meta=jsonb_set(meta,'{comms_email_binding,send_at}',to_jsonb(to_char((date_trunc('minute',now())-interval '2 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
 WHERE id=pg_temp.msg(_n) $$;
CREATE TEMP TABLE _t AS SELECT date_trunc('minute', now()) + interval '1 hour' AS later;
GRANT SELECT ON _t TO service_role;

-- ── 1. the time and the kinds of email that are never scheduled ──────────────────────────────
SET LOCAL ROLE service_role;
SELECT pg_temp.err(10, 'no time at all is refused', $q$SELECT pg_temp.prep(10, pg_temp.u(1), NULL)$q$, '22023', 'COMMS_EMAIL_SEND_AT_INVALID');
SELECT pg_temp.err(11, 'a time that is not a whole minute is refused', $q$SELECT pg_temp.prep(11, pg_temp.u(1), (SELECT later FROM _t) + interval '20 seconds')$q$, '22023', 'COMMS_EMAIL_SEND_AT_INVALID');
SELECT pg_temp.err(12, 'a time under 30 seconds away (or past) is refused', $q$SELECT pg_temp.prep(12, pg_temp.u(1), date_trunc('minute', now()))$q$, '22023', 'COMMS_EMAIL_SEND_AT_INVALID');
SELECT pg_temp.err(13, 'a time beyond 30 days (+10 min) is refused', $q$SELECT pg_temp.prep(13, pg_temp.u(1), date_trunc('minute', now()) + interval '31 days')$q$, '22023', 'COMMS_EMAIL_SEND_AT_INVALID');
SELECT pg_temp.err(14, 'a drafted lead reply (approval_id) is never scheduled', $q$SELECT pg_temp.prep(14, pg_temp.u(1), (SELECT later FROM _t), '{"approval_id":"5c4ed900-0000-4000-8000-000000000001"}')$q$, '22023', 'COMMS_EMAIL_SCHEDULE_NOT_SUPPORTED');
SELECT pg_temp.err(15, 'an agreement signing request is never scheduled', $q$SELECT pg_temp.prep(15, pg_temp.u(1), (SELECT later FROM _t), '{"purpose":"agreement_signature_request"}')$q$, '22023', 'COMMS_EMAIL_SCHEDULE_NOT_SUPPORTED');
SELECT pg_temp.err(16, 'a non-seat cannot schedule', $q$SELECT pg_temp.prep(16, pg_temp.u(3), (SELECT later FROM _t))$q$, '42501', 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE');
SELECT pg_temp.ok(17, (SELECT count(*)=0 FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}' IN (SELECT pg_temp.op(n)::text FROM generate_series(10,16) n)),
  'no refused prepare wrote a row');

-- ── 2. a scheduled prepare: queued, scheduled_for, send_at in Date#toISOString text ───────────
CREATE TEMP TABLE _r1 AS SELECT pg_temp.prep(1, pg_temp.u(1), (SELECT later FROM _t)) r;
SELECT pg_temp.ok(20, (SELECT r->>'ok'='true' AND r->>'replayed'='false' AND r->>'state'='prepared' AND r->>'message_id'=pg_temp.msg(1)::text
   AND r->>'send_at'=to_char((SELECT later FROM _t) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM _r1),
  'the scheduled prepare answers prepared and echoes the stored send time');
SELECT pg_temp.ok(21, (SELECT m.status='queued' AND m.scheduled_for=(SELECT later FROM _t)
   AND m.meta#>>'{comms_email_binding,send_at}' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$'
   AND (m.meta#>>'{comms_email_binding,send_at}')::timestamptz=(SELECT later FROM _t)
   AND m.meta#>>'{comms_email_binding,state}'='prepared' AND m.meta#>>'{comms_email_binding,attempts}'='0'
   FROM public.messages m WHERE m.id=pg_temp.msg(1)),
  'the row is queued for exactly that minute, its binding carries send_at as YYYY-MM-DDTHH:MM:00.000Z');
SELECT pg_temp.ok(22, (SELECT r->>'replayed'='true' AND r->>'message_id'=pg_temp.msg(1)::text FROM (SELECT pg_temp.prep(1, pg_temp.u(1), (SELECT later FROM _t)) r) x)
  AND (SELECT count(*)=1 FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(1)::text),
  'the same scheduled prepare again is a replay: one row');
SELECT pg_temp.err(23, 'the same operation for another time is a replay mismatch',
  $q$SELECT pg_temp.prep(1, pg_temp.u(1), (SELECT later FROM _t) + interval '1 hour')$q$, '22023', 'COMMS_EMAIL_REPLAY_MISMATCH');
CREATE TEMP TABLE _r2 AS SELECT pg_temp.prep_now(2, pg_temp.u(1)) r;
SELECT pg_temp.ok(24, (SELECT m.status='draft' AND m.scheduled_for IS NULL AND NOT (m.meta->'comms_email_binding' ? 'send_at') FROM public.messages m WHERE m.id=pg_temp.msg(2)),
  'an immediate prepare is unchanged: a draft row with no send time');
SELECT pg_temp.err(25, 'an immediate operation asked for later is a replay mismatch',
  $q$SELECT pg_temp.prep(2, pg_temp.u(1), (SELECT later FROM _t))$q$, '22023', 'COMMS_EMAIL_REPLAY_MISMATCH');
SELECT pg_temp.ok(26, (SELECT r->>'send_at'=pg_temp.b(1)->>'send_at' AND r->>'outcome'='prepared'
   FROM (SELECT public.read_comms_email_send_result(pg_temp.u(1),'5c4ed100-0000-4000-8000-000000000001',pg_temp.op(1)) r) x)
  AND (SELECT NOT (r ? 'send_at') FROM (SELECT public.read_comms_email_send_result(pg_temp.u(1),'5c4ed100-0000-4000-8000-000000000001',pg_temp.op(2)) r) x),
  'the result read names a scheduled operation''s time, and only a scheduled one''s');

-- ── 3. not before its time ───────────────────────────────────────────────────────────────────
SELECT pg_temp.ok(30, (SELECT r->'admitted'='false'::jsonb AND r->>'not_before'=pg_temp.b(1)->>'send_at' AND r->>'state'='prepared'
   FROM (SELECT public.claim_comms_email_send(pg_temp.msg(1),pg_temp.op(1)) r) x)
  AND (SELECT status='queued' AND meta#>>'{comms_email_binding,state}'='prepared' FROM public.messages WHERE id=pg_temp.msg(1)),
  'a claim before the time answers not_before and changes nothing');

-- ── 4. once due: the seat alone releases it, a workspace switch does not stop it ─────────────
RESET ROLE;
SELECT pg_temp.make_due(1);
UPDATE public.profiles SET active_tenant_id='5c4ed100-0000-4000-8000-000000000002' WHERE user_id=pg_temp.u(1);
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(40, (SELECT (public.read_comms_email_send_binding(pg_temp.msg(1))->>'eligible')::boolean),
  'due and the scheduler has another business open: the binding still reads, eligible (seat only)');
SELECT pg_temp.err(41, 'the same person''s IMMEDIATE send is still refused after the switch',
  $q$SELECT public.claim_comms_email_send(pg_temp.msg(2),pg_temp.op(2))$q$, '42501', 'COMMS_EMAIL_WORKSPACE_CHANGED');
SELECT pg_temp.ok(42, (SELECT r->'admitted'='true'::jsonb AND r->>'state'='dispatching' AND r->>'attempts'='1'
   FROM (SELECT public.claim_comms_email_send(pg_temp.msg(1),pg_temp.op(1)) r) x),
  'the due scheduled send is admitted');
SELECT pg_temp.ok(43, (SELECT status='draft' AND meta#>>'{comms_email_binding,state}'='dispatching' FROM public.messages WHERE id=pg_temp.msg(1)),
  'admission moves the row out of queued (queued -> draft), so the drainer never leases it again');
SELECT pg_temp.ok(44, (SELECT r->'admitted'='false'::jsonb FROM (SELECT public.claim_comms_email_send(pg_temp.msg(1),pg_temp.op(1)) r) x),
  'a second claim is not admitted');
SELECT public.finalize_comms_email_send(pg_temp.msg(1),pg_temp.op(1),'unknown',NULL,'provider_result_unconfirmed',1);
SELECT pg_temp.ok(45, (SELECT status='draft' AND scheduled_for IS NOT NULL FROM public.messages WHERE id=pg_temp.msg(1)),
  'an outcome left unknown stays out of queued (never re-leased, never cancellable as a queued draft)');
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='5c4ed100-0000-4000-8000-000000000001' WHERE user_id=pg_temp.u(1);

-- ── 5. a removed seat raises ─────────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;
CREATE TEMP TABLE _r3 AS SELECT pg_temp.prep(3, pg_temp.u(2), (SELECT later FROM _t)) r;
RESET ROLE;
SELECT pg_temp.make_due(3);
UPDATE public.tenant_members SET role='member'::public.tenant_role WHERE user_id=pg_temp.u(2) AND tenant_id='5c4ed100-0000-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.err(50, 'a scheduler demoted to a non-seat: the binding read raises', $q$SELECT public.read_comms_email_send_binding(pg_temp.msg(3))$q$, '42501', 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE');
SELECT pg_temp.err(51, '... and the claim raises (nothing is admitted)', $q$SELECT public.claim_comms_email_send(pg_temp.msg(3),pg_temp.op(3))$q$, '42501', 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE');
SELECT pg_temp.ok(52, (SELECT status='queued' AND meta#>>'{comms_email_binding,state}'='prepared' FROM public.messages WHERE id=pg_temp.msg(3)),
  'the row is untouched');
RESET ROLE;
UPDATE public.tenant_members SET role='admin'::public.tenant_role WHERE user_id=pg_temp.u(2) AND tenant_id='5c4ed100-0000-4000-8000-000000000001';

-- ── 6. cancel ────────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;
CREATE TEMP TABLE _r4 AS SELECT pg_temp.prep(4, pg_temp.u(1), (SELECT later FROM _t)) r;
SELECT pg_temp.err(60, 'a non-seat (member) cannot cancel',
  $q$SELECT public.cancel_comms_email_send(pg_temp.u(3),'5c4ed100-0000-4000-8000-000000000001',pg_temp.op(4))$q$, '42501', 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE');
SELECT pg_temp.err(61, 'a business that is not the one open cannot cancel',
  $q$SELECT public.cancel_comms_email_send(pg_temp.u(2),'5c4ed100-0000-4000-8000-000000000002',pg_temp.op(4))$q$, '42501', 'COMMS_EMAIL_WORKSPACE_CHANGED');
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='5c4ed100-0000-4000-8000-000000000002' WHERE user_id=pg_temp.u(2);
SET LOCAL ROLE service_role;
SELECT pg_temp.err(611, 'another business''s owner, with that business open, cannot see this business''s operation',
  $q$SELECT public.cancel_comms_email_send(pg_temp.u(2),'5c4ed100-0000-4000-8000-000000000002',pg_temp.op(4))$q$, 'P0002', 'COMMS_EMAIL_OPERATION_NOT_FOUND');
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='5c4ed100-0000-4000-8000-000000000001' WHERE user_id=pg_temp.u(2);
SET LOCAL ROLE service_role;
SELECT pg_temp.err(62, 'an unknown operation is not found',
  $q$SELECT public.cancel_comms_email_send(pg_temp.u(2),'5c4ed100-0000-4000-8000-000000000001',pg_temp.op(99))$q$, 'P0002', 'COMMS_EMAIL_OPERATION_NOT_FOUND');
SELECT pg_temp.err(63, 'an immediate send is not a scheduled one',
  $q$SELECT public.cancel_comms_email_send(pg_temp.u(2),'5c4ed100-0000-4000-8000-000000000001',pg_temp.op(2))$q$, '55000', 'COMMS_EMAIL_NOT_SCHEDULED');
SELECT pg_temp.ok(64, (SELECT r->>'cancelled'='true' AND r->>'outcome'='refused' AND r->>'reason'='cancelled_by_owner' AND r->>'message_id'=pg_temp.msg(4)::text
   FROM (SELECT public.cancel_comms_email_send(pg_temp.u(2),'5c4ed100-0000-4000-8000-000000000001',pg_temp.op(4)) r) x),
  'a teammate admin cancels a scheduled email that has not gone out');
SELECT pg_temp.ok(65, (SELECT m.status='blocked' AND m.scheduled_for IS NULL AND m.meta#>>'{comms_email_binding,state}'='refused'
   AND m.meta#>>'{comms_email_binding,outcome_reason}'='cancelled_by_owner' FROM public.messages m WHERE m.id=pg_temp.msg(4)),
  'the row is closed: refused/cancelled_by_owner, status blocked, no time');
RESET ROLE;
SELECT pg_temp.ok(66, (SELECT count(*)=1 FROM public.paige_audit_log WHERE action='comms.email_scheduled_cancelled' AND target_id=pg_temp.msg(4)
   AND actor_user_id=pg_temp.u(2) AND tenant_id='5c4ed100-0000-4000-8000-000000000001' AND payload->>'operation_id'=pg_temp.op(4)::text
   AND payload->>'scheduled_by'=pg_temp.u(1)::text),
  'the cancel is audited in the same transaction');
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(67, (SELECT r->>'cancelled'='false' AND r->>'outcome'='refused' FROM (SELECT public.cancel_comms_email_send(pg_temp.u(1),'5c4ed100-0000-4000-8000-000000000001',pg_temp.op(4)) r) x),
  'cancelling again changes nothing');
SELECT pg_temp.ok(68, (SELECT r->>'cancelled'='false' AND r->>'outcome'='unknown' FROM (SELECT public.cancel_comms_email_send(pg_temp.u(1),'5c4ed100-0000-4000-8000-000000000001',pg_temp.op(1)) r) x),
  'too late once the release has taken it: the answer is the send''s own state');
RESET ROLE;
SELECT pg_temp.make_due(4);
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(69, (SELECT r->'admitted'='false'::jsonb AND r->>'state'='refused' FROM (SELECT public.claim_comms_email_send(pg_temp.msg(4),pg_temp.op(4)) r) x),
  'a cancelled send is never admitted, even once its time comes');
RESET ROLE;

-- ── 7. the generic undo never touches a governed row ─────────────────────────────────────────
SET LOCAL ROLE service_role;
CREATE TEMP TABLE _r5 AS SELECT pg_temp.prep(5, pg_temp.u(1), (SELECT later FROM _t)) r;
RESET ROLE;
CREATE TEMP TABLE _m5 AS SELECT pg_temp.msg(5) AS id;
GRANT SELECT ON _m5 TO authenticated;
INSERT INTO public.messages (id, tenant_id, thread_key, contact_id, connector_id, channel_type, direction, status, recipients, subject, body_html, scheduled_for)
VALUES ('5c4ed500-0000-4000-8000-000000000001','5c4ed100-0000-4000-8000-000000000001','contact:5c4ed100-0000-4000-8000-000000000001:5c4ed200-0000-4000-8000-000000000001',
 '5c4ed200-0000-4000-8000-000000000001','5c4ed300-0000-4000-8000-000000000001','email','outbound','queued',
 '[{"address":"lead.sched@example.tests.invalid"}]'::jsonb,'Ordinary','<p>Ordinary</p>',(SELECT later FROM _t));
INSERT INTO public.user_roles (user_id, role)
SELECT pg_temp.u(1), 'admin'::public.app_role WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=pg_temp.u(1) AND role='admin'::public.app_role);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub',pg_temp.u(1),'role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(70, public.cancel_scheduled_message((SELECT id FROM _m5)) IS FALSE, 'the generic undo returns false for a governed scheduled row');
SELECT pg_temp.ok(71, public.cancel_scheduled_message('5c4ed500-0000-4000-8000-000000000001') IS TRUE, 'control: it still cancels an ordinary queued draft');
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT pg_temp.ok(72, (SELECT status='queued' AND meta#>>'{comms_email_binding,state}'='prepared' AND NOT (meta ? 'undo_cancelled_at') FROM public.messages WHERE id=pg_temp.msg(5)),
  'the governed row is untouched (still queued, still prepared)');

SELECT count(*) FILTER (WHERE res='ok') AS ok,
       count(*) FILTER (WHERE res<>'ok') AS failed,
       jsonb_agg(jsonb_build_object('ord', ord, 'res', res, 'label', label) ORDER BY ord) FILTER (WHERE res<>'ok') AS failures
FROM _p;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM _p WHERE res<>'ok') THEN RAISE EXCEPTION 'comms_email_scheduled_send: % assertion(s) failed', (SELECT count(*) FROM _p WHERE res<>'ok'); END IF;
  IF (SELECT count(*) FROM _p) < 40 THEN RAISE EXCEPTION 'comms_email_scheduled_send: only % assertions ran', (SELECT count(*) FROM _p); END IF;
END $$;
ROLLBACK;
