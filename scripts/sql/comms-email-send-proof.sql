-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- INT-328 — rollback proof for 20270597000000_comms_email_send.sql (comms.email_send).
--
-- HOW TO RUN: node scripts/sql/run-rollback-proof.mjs --lean scripts/sql/comms-email-send-proof.sql
--   and execute the printed batch (psql, or the Supabase MCP execute_sql tool). BEGIN..ROLLBACK:
--   the migration and every fixture exist only inside this transaction. Never COMMIT.
-- The report row reads ok=<n>, failed=0 when every assertion holds; `failures` lists any that do not.
--
-- Fixtures are never a real owner account (§63): fresh uuids, `cea-proof-*` slugs, .invalid mail.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
BEGIN;
-- Never hold a lock on a production table while waiting: fail fast instead. Temp tables carry no
-- ON COMMIT clause: they are created inside this transaction, so the ROLLBACK removes them.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

CREATE TEMP TABLE _p(ord int, res text, label text);
GRANT SELECT, INSERT ON _p TO service_role, authenticated, anon;

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────
-- u1 owner + u2 admin of t1 (active workspace t1); t2 is a foreign workspace owned by u3.
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at)
SELECT u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'cea-proof-' || right(u, 4) || '@example.invalid', '', now(), now(), now()
FROM unnest(ARRAY['ffffffff-3280-4000-8000-000000000001','ffffffff-3280-4000-8000-000000000002','ffffffff-3280-4000-8000-000000000003']) u;

INSERT INTO public.tenants (id, slug, name, account_number_prefix, account_number, account_type, owner_user_id) VALUES
 ('aaaaaaaa-3280-4000-8000-000000000001','cea-proof-one','CEA Proof One','CEA',983281,'standalone','ffffffff-3280-4000-8000-000000000001'),
 ('aaaaaaaa-3280-4000-8000-000000000002','cea-proof-two','CEA Proof Two','CEB',983282,'standalone','ffffffff-3280-4000-8000-000000000003');

INSERT INTO public.tenant_members (tenant_id, user_id, status, role, is_owner) VALUES
 ('aaaaaaaa-3280-4000-8000-000000000001','ffffffff-3280-4000-8000-000000000001','active','owner'::public.tenant_role,true),
 ('aaaaaaaa-3280-4000-8000-000000000001','ffffffff-3280-4000-8000-000000000002','active','admin'::public.tenant_role,false),
 -- u1 also belongs to t2 (as a plain member) so it can legitimately switch its active workspace there.
 ('aaaaaaaa-3280-4000-8000-000000000002','ffffffff-3280-4000-8000-000000000001','active','member'::public.tenant_role,false);

UPDATE public.profiles SET active_tenant_id='aaaaaaaa-3280-4000-8000-000000000001'
 WHERE user_id IN ('ffffffff-3280-4000-8000-000000000001','ffffffff-3280-4000-8000-000000000002');

-- Contacts: the legacy email column maps into client_contact_methods (the canonical address source).
INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, email) VALUES
 ('bbbbbbbb-3280-4000-8000-000000000001','aaaaaaaa-3280-4000-8000-000000000001','ffffffff-3280-4000-8000-000000000001','Proof','Client','Client.One@Example.invalid'),
 ('bbbbbbbb-3280-4000-8000-000000000002','aaaaaaaa-3280-4000-8000-000000000002','ffffffff-3280-4000-8000-000000000003','Foreign','Client','foreign@example.invalid');

INSERT INTO public.channel_connectors (id, tenant_id, channel_type, provider, from_address, status, active) VALUES
 ('cccccccc-3280-4000-8000-000000000001','aaaaaaaa-3280-4000-8000-000000000001','email','resend','Owner@Biz.example.invalid','active',true),
 ('cccccccc-3280-4000-8000-000000000002','aaaaaaaa-3280-4000-8000-000000000001','email','gmail','second@biz.example.invalid','active',true),
 ('cccccccc-3280-4000-8000-000000000003','aaaaaaaa-3280-4000-8000-000000000002','email','resend','foreign@biz.example.invalid','active',true);

-- ── the migration under proof ───────────────────────────────────────────────────────────────
\i supabase/migrations/20270597000000_comms_email_send.sql

-- ── helpers ─────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.ok(_ord int, _cond boolean, _label text) RETURNS void LANGUAGE sql AS $$
 INSERT INTO _p VALUES (_ord, CASE WHEN coalesce(_cond,false) THEN 'ok' ELSE 'FAIL' END, _label);
$$;
-- Expects _sql to raise SQLSTATE _state with a message LIKE _msg — the message pins WHICH guard
-- refused, so an unrelated refusal sharing the code cannot pass for it.
CREATE FUNCTION pg_temp.err(_ord int, _label text, _sql text, _state text, _msg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE got text;
BEGIN
 BEGIN EXECUTE _sql; got := 'no error';
 EXCEPTION WHEN OTHERS THEN got := SQLSTATE || ' ' || SQLERRM; END;
 INSERT INTO _p VALUES (_ord, CASE WHEN got LIKE _state || ' ' || _msg THEN 'ok' ELSE 'FAIL got ' || got END, _label);
END $$;
CREATE FUNCTION pg_temp.gov(_approval text DEFAULT 'operator_card') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('actor_user_id','ffffffff-3280-4000-8000-000000000001','tenant_id','aaaaaaaa-3280-4000-8000-000000000001',
  'tool','comms_send_email','action','comms.email_send','approval_channel',_approval,'approved_fingerprint','0123456789abcdef',
  'decision_receipt_recorded',true);
$$;
CREATE FUNCTION pg_temp.dg(_r text, _c uuid, _s text, _b text) RETURNS text LANGUAGE sql AS $$
 SELECT encode(extensions.digest(convert_to(_r||E'\n'||_c::text||E'\n'||_s||E'\n'||_b,'UTF8'),'sha256'),'hex');
$$;
-- prepare as u1 in t1 with a correct digest/command unless overridden.
CREATE FUNCTION pg_temp.prep(_op int, _subject text DEFAULT 'Quick follow-up', _body text DEFAULT 'Hello there.',
  _recipient text DEFAULT 'client.one@example.invalid', _connector uuid DEFAULT 'cccccccc-3280-4000-8000-000000000001',
  _from text DEFAULT 'owner@biz.example.invalid', _contact uuid DEFAULT 'bbbbbbbb-3280-4000-8000-000000000001',
  _digest text DEFAULT NULL, _gov jsonb DEFAULT NULL, _cmd jsonb DEFAULT NULL,
  _actor uuid DEFAULT 'ffffffff-3280-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.prepare_comms_email_send(_actor,'aaaaaaaa-3280-4000-8000-000000000001',
  ('dddddddd-3280-4000-8000-'||lpad(_op::text,12,'0'))::uuid,_contact,_recipient,_connector,_from,_subject,_body,
  '<p>'||_body||'</p>',coalesce(_digest,pg_temp.dg(_recipient,_connector,_subject,_body)),
  coalesce(_cmd,jsonb_build_object('action','comms.email_send','contact_id',_contact,'connector_id',_connector,'subject',_subject,'body',_body)),
  coalesce(_gov,pg_temp.gov()));
$$;
CREATE FUNCTION pg_temp.op(_op int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('dddddddd-3280-4000-8000-'||lpad(_op::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.msg(_op int) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(_op)::text $$;
CREATE FUNCTION pg_temp.st(_op int) RETURNS text LANGUAGE sql AS $$
 SELECT meta#>>'{comms_email_binding,state}' FROM public.messages WHERE id=pg_temp.msg(_op) $$;

-- ── 1. prepare, replay, mismatch ────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;
CREATE TEMP TABLE _r1 AS SELECT pg_temp.prep(1) r;
SELECT pg_temp.ok(1, (SELECT r->>'ok'='true' AND r->>'replayed'='false' AND r->>'state'='prepared' FROM _r1), 'prepare returns prepared, not replayed');
SELECT pg_temp.ok(2, (SELECT m.status='draft' AND m.channel_type='email' AND m.direction='outbound' AND m.recipients->0->>'address'='client.one@example.invalid'
  AND m.thread_key='contact:aaaaaaaa-3280-4000-8000-000000000001:bbbbbbbb-3280-4000-8000-000000000001' AND m.body_text='Hello there.'
  AND m.meta->>'source'='comms-email-command' AND m.meta#>>'{comms_email_binding,provider}'='resend'
  AND m.meta#>>'{comms_email_binding,from_address}'='owner@biz.example.invalid' AND m.meta#>>'{comms_email_binding,attempts}'='0'
  FROM public.messages m, _r1 WHERE m.id=(_r1.r->>'message_id')::uuid), 'prepared row is an honest draft with the binding');
SELECT pg_temp.ok(3, (SELECT pg_temp.prep(1)->>'replayed'='true' AND pg_temp.prep(1)->>'message_id'=r->>'message_id' FROM _r1), 'exact replay returns the same message, no second row');
SELECT pg_temp.ok(4, (SELECT count(*)=1 FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(1)::text), 'one row per operation');
SELECT pg_temp.err(5, 'same operation, changed subject refused', $q$SELECT pg_temp.prep(1,'Changed subject')$q$, '22023', 'COMMS_EMAIL_REPLAY_MISMATCH');
SELECT pg_temp.err(6, 'same operation, different actor refused', $q$SELECT pg_temp.prep(1,_actor=>'ffffffff-3280-4000-8000-000000000002',_gov=>pg_temp.gov()||'{"actor_user_id":"ffffffff-3280-4000-8000-000000000002"}')$q$, '22023', 'COMMS_EMAIL_REPLAY_MISMATCH');

-- ── 2. scope, recipient, sender, content, governance refusals ───────────────────────────────
SELECT pg_temp.err(10, 'foreign-workspace contact refused', $q$SELECT pg_temp.prep(10,_contact=>'bbbbbbbb-3280-4000-8000-000000000002',_recipient=>'foreign@example.invalid')$q$, '42501', 'COMMS_EMAIL_CONTACT_NOT_IN_WORKSPACE');
SELECT pg_temp.err(11, 'address not held by the contact refused', $q$SELECT pg_temp.prep(11,_recipient=>'someone.else@example.invalid')$q$, '40001', 'COMMS_EMAIL_RECIPIENT_CHANGED');
SELECT pg_temp.err(12, 'un-normalized recipient refused', $q$SELECT pg_temp.prep(12,_recipient=>'Client.One@Example.invalid')$q$, '40001', 'COMMS_EMAIL_RECIPIENT_CHANGED');
SELECT pg_temp.err(13, 'changed sender address refused', $q$SELECT pg_temp.prep(13,_from=>'other@biz.example.invalid')$q$, '40001', 'COMMS_EMAIL_SENDER_CHANGED');
SELECT pg_temp.err(14, 'foreign-workspace connector refused', $q$SELECT pg_temp.prep(14,_connector=>'cccccccc-3280-4000-8000-000000000003',_from=>'foreign@biz.example.invalid')$q$, '40001', 'COMMS_EMAIL_SENDER_CHANGED');
SELECT pg_temp.err(15, 'digest mismatch refused', $q$SELECT pg_temp.prep(15,_digest=>repeat('0',64))$q$, '22023', 'COMMS_EMAIL_DIGEST_MISMATCH');
SELECT pg_temp.err(16, 'subject with a line break refused', $q$SELECT pg_temp.prep(16,E'Line\nbreak')$q$, '22023', 'COMMS_EMAIL_CONTENT_INVALID');
SELECT pg_temp.err(17, 'body over 10000 chars refused', $q$SELECT pg_temp.prep(17,_body=>repeat('x',10001))$q$, '22023', 'COMMS_EMAIL_CONTENT_INVALID');
SELECT pg_temp.err(18, 'command disagreeing with the prepared subject refused', $q$SELECT pg_temp.prep(18,_cmd=>'{"action":"comms.email_send","contact_id":"bbbbbbbb-3280-4000-8000-000000000001","connector_id":"cccccccc-3280-4000-8000-000000000001","subject":"Other","body":"Hello there."}')$q$, '22023', 'COMMS_EMAIL_CONTENT_INVALID');
SELECT pg_temp.err(19, 'standing autonomy cannot approve a send', $q$SELECT pg_temp.prep(19,_gov=>pg_temp.gov('standing_autonomy_setting'))$q$, '42501', 'COMMS_EMAIL_GOVERNANCE_REQUIRED');
SELECT pg_temp.err(20, 'governance for another tool refused', $q$SELECT pg_temp.prep(20,_gov=>pg_temp.gov()||'{"tool":"billing_send_invoice"}')$q$, '42501', 'COMMS_EMAIL_GOVERNANCE_REQUIRED');
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='aaaaaaaa-3280-4000-8000-000000000002' WHERE user_id='ffffffff-3280-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.err(21, 'workspace switched after the edge check refused', $q$SELECT pg_temp.prep(21)$q$, '42501', 'COMMS_EMAIL_WORKSPACE_CHANGED');
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='aaaaaaaa-3280-4000-8000-000000000001' WHERE user_id='ffffffff-3280-4000-8000-000000000001';
UPDATE public.tenant_members SET role='member'::public.tenant_role WHERE user_id='ffffffff-3280-4000-8000-000000000001' AND tenant_id='aaaaaaaa-3280-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.err(22, 'plain member cannot send', $q$SELECT pg_temp.prep(22)$q$, '42501', 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE');
RESET ROLE;
UPDATE public.tenant_members SET role='owner'::public.tenant_role WHERE user_id='ffffffff-3280-4000-8000-000000000001' AND tenant_id='aaaaaaaa-3280-4000-8000-000000000001';
SELECT pg_temp.ok(23, (SELECT count(*)=0 FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}' LIKE 'dddddddd-3280-4000-8000-0000000000%' AND meta#>>'{comms_email_binding,operation_id}'<>pg_temp.op(1)::text), 'no refused prepare wrote a row');

-- ── 3. claim, double claim, finalize accepted, conflicts, readback, Rail ────────────────────
SET LOCAL ROLE service_role;
CREATE TEMP TABLE _c1 AS SELECT public.claim_comms_email_send(pg_temp.msg(1),pg_temp.op(1)) r;
SELECT pg_temp.ok(30, (SELECT r->>'state'='dispatching' AND r->>'attempts'='1' FROM _c1), 'claim moves prepared to dispatching, attempt 1');
SELECT pg_temp.ok(31, (SELECT r->>'state'='dispatching' AND r->>'attempts'='1' AND r->'admitted'='false'::jsonb FROM (SELECT public.claim_comms_email_send(pg_temp.msg(1),pg_temp.op(1)) r) x), 'second claim changes nothing and is NOT admitted (it must not dispatch)');
SELECT pg_temp.err(32, 'claim with another operation id refused', $q$SELECT public.claim_comms_email_send(pg_temp.msg(1),pg_temp.op(99))$q$, '22023', 'COMMS_EMAIL_CLAIM_INVALID');
SELECT pg_temp.err(33, 'provider_accepted without a provider id refused', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(1),pg_temp.op(1),'provider_accepted',NULL,NULL)$q$, '22023', 'COMMS_EMAIL_RECEIPT_INVALID');
CREATE TEMP TABLE _f1 AS SELECT public.finalize_comms_email_send(pg_temp.msg(1),pg_temp.op(1),'provider_accepted','re_proof_1',NULL,1) r;
SELECT pg_temp.ok(34, (SELECT r->>'ok'='true' AND r->>'outcome'='provider_accepted' AND r->>'provider_receipt_available'='true' AND r->>'delivery_confirmed'='false' FROM _f1), 'finalize provider_accepted');
SELECT pg_temp.ok(35, (SELECT status='sent' AND provider_message_id='re_proof_1' AND sent_at IS NOT NULL AND meta#>>'{comms_email_binding,state}'='provider_accepted'
  FROM public.messages WHERE id=pg_temp.msg(1)), 'row reads sent with the provider receipt');
SELECT pg_temp.ok(36, public.finalize_comms_email_send(pg_temp.msg(1),pg_temp.op(1),'provider_accepted','re_proof_1',NULL)->>'outcome'='provider_accepted', 'same terminal outcome is idempotent');
SELECT pg_temp.err(37, 'conflicting terminal outcome refused', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(1),pg_temp.op(1),'failed',NULL,'provider_rejected')$q$, '40001', 'COMMS_EMAIL_RECEIPT_CONFLICT');
SELECT pg_temp.err(38, 'same outcome with a different provider id refused', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(1),pg_temp.op(1),'provider_accepted','re_other',NULL)$q$, '40001', 'COMMS_EMAIL_RECEIPT_CONFLICT');
SELECT pg_temp.ok(39, (SELECT r->>'outcome'='provider_accepted' AND r->>'provider_receipt_available'='true' AND r->>'delivery_confirmed'='false' AND r->>'attempts'='1' AND NOT (r ? 'provider_message_id')
  FROM (SELECT public.read_comms_email_send_result('ffffffff-3280-4000-8000-000000000001','aaaaaaaa-3280-4000-8000-000000000001',pg_temp.op(1)) r) x), 'result read: accepted, receipt available, never delivered, no provider id');
SELECT pg_temp.ok(40, public.read_comms_email_send_result('ffffffff-3280-4000-8000-000000000001','aaaaaaaa-3280-4000-8000-000000000001',pg_temp.op(98)) IS NULL, 'absent operation reads NULL');
SELECT pg_temp.err(41, 'another actor cannot read the operation', $q$SELECT public.read_comms_email_send_result('ffffffff-3280-4000-8000-000000000002','aaaaaaaa-3280-4000-8000-000000000001',pg_temp.op(1))$q$, '22023', 'COMMS_EMAIL_REPLAY_MISMATCH');
SELECT pg_temp.ok(42, (SELECT b->>'eligible'='true' AND b->>'recipient'='client.one@example.invalid' AND b->>'body_html'='<p>Hello there.</p>'
  AND b->>'tenant_id'='aaaaaaaa-3280-4000-8000-000000000001' AND b->>'connector_id'='cccccccc-3280-4000-8000-000000000001'
  FROM (SELECT public.read_comms_email_send_binding(pg_temp.msg(1)) b) x), 'binding read returns the stored values');
RESET ROLE;
SELECT pg_temp.ok(43, (SELECT count(*)=1 FROM public.paige_workspace_events WHERE source_id=pg_temp.op(1) AND source_kind='capability_run'
  AND capability_key='comms_send_email' AND outcome='capability_succeeded' AND tenant_id='aaaaaaaa-3280-4000-8000-000000000001'), 'one capability_succeeded Rail row');

-- ── 4. unknown blocks an identical new send; reconcile is resend-only ───────────────────────
SET LOCAL ROLE service_role;
SELECT pg_temp.prep(2,'Second note','Body two.');
SELECT public.claim_comms_email_send(pg_temp.msg(2),pg_temp.op(2));
SELECT pg_temp.ok(50, public.finalize_comms_email_send(pg_temp.msg(2),pg_temp.op(2),'unknown',NULL,NULL,1)->>'outcome'='unknown', 'finalize unknown');
SELECT pg_temp.ok(51, (SELECT status='draft' AND provider_message_id IS NULL FROM public.messages WHERE id=pg_temp.msg(2)), 'unknown never claims the email was sent');
SELECT pg_temp.err(52, 'identical new operation refused while unknown', $q$SELECT pg_temp.prep(3,'Second note','Body two.')$q$, '55000', 'COMMS_EMAIL_RECONCILIATION_REQUIRED');
SELECT pg_temp.ok(53, public.find_comms_email_pending_reconciliation('aaaaaaaa-3280-4000-8000-000000000001','Client.One@example.invalid',pg_temp.dg('client.one@example.invalid','cccccccc-3280-4000-8000-000000000001','Second note','Body two.'))=pg_temp.op(2), 'finder returns the unknown operation');
SELECT pg_temp.ok(54, public.read_comms_email_send_result('ffffffff-3280-4000-8000-000000000001','aaaaaaaa-3280-4000-8000-000000000001',pg_temp.op(2))->>'reconcilable'='true', 'unknown resend within 23h reads reconcilable');
SELECT pg_temp.ok(55, public.claim_comms_email_send(pg_temp.msg(2),pg_temp.op(2))->>'state'='unknown', 'normal claim cannot re-enter unknown');
SELECT pg_temp.ok(56, (SELECT r->>'state'='dispatching' AND r->>'attempts'='2' AND r->'admitted'='true'::jsonb FROM (SELECT public.claim_comms_email_send(pg_temp.msg(2),pg_temp.op(2),true) r) x), 'reconcile claim re-enters dispatching, attempt 2');
SELECT pg_temp.ok(57, public.finalize_comms_email_send(pg_temp.msg(2),pg_temp.op(2),'provider_accepted','re_proof_2',NULL,2)->>'outcome'='provider_accepted', 'reconciled send finalizes accepted');
RESET ROLE;
SELECT pg_temp.ok(58, (SELECT count(*)=2 FROM public.paige_workspace_events WHERE source_id=pg_temp.op(2) AND outcome IN ('capability_outcome_unknown','capability_succeeded')), 'Rail keeps both the unknown and the reconciled outcome');
SELECT pg_temp.ok(59, (SELECT count(*)=1 FROM public.messages WHERE meta#>>'{comms_email_binding,content_digest}'=pg_temp.dg('client.one@example.invalid','cccccccc-3280-4000-8000-000000000001','Second note','Body two.')), 'reconcile minted no new operation');
-- gmail cannot be reconciled (no provider idempotency key).
SET LOCAL ROLE service_role;
SELECT pg_temp.prep(4,'Gmail note','Body four.',_connector=>'cccccccc-3280-4000-8000-000000000002',_from=>'Second@Biz.example.invalid');
SELECT public.claim_comms_email_send(pg_temp.msg(4),pg_temp.op(4));
SELECT public.finalize_comms_email_send(pg_temp.msg(4),pg_temp.op(4),'unknown',NULL,NULL,1);
SELECT pg_temp.ok(60, public.claim_comms_email_send(pg_temp.msg(4),pg_temp.op(4),true)->>'state'='unknown', 'gmail unknown is not reconcilable');
-- resend older than 23 hours is not reconcilable.
SELECT pg_temp.prep(5,'Old note','Body five.');
SELECT public.claim_comms_email_send(pg_temp.msg(5),pg_temp.op(5));
SELECT public.finalize_comms_email_send(pg_temp.msg(5),pg_temp.op(5),'unknown',NULL,NULL,1);
RESET ROLE;
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,prepared_at}',to_jsonb(now()-interval '24 hours')) WHERE id=pg_temp.msg(5);
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(61, public.claim_comms_email_send(pg_temp.msg(5),pg_temp.op(5),true)->>'state'='unknown', 'resend older than 23h is not reconcilable');
-- dispatching: fresh is not reconcilable, older than 120 s is.
SELECT pg_temp.prep(6,'Stale note','Body six.');
SELECT public.claim_comms_email_send(pg_temp.msg(6),pg_temp.op(6));
SELECT pg_temp.ok(62, (SELECT r->>'state'='dispatching' AND r->>'attempts'='1' AND r->'admitted'='false'::jsonb FROM (SELECT public.claim_comms_email_send(pg_temp.msg(6),pg_temp.op(6),true) r) x), 'fresh dispatching cannot be reconciled');
RESET ROLE;
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,claimed_at}',to_jsonb(now()-interval '200 seconds')) WHERE id=pg_temp.msg(6);
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(63, (SELECT r->>'attempts'='2' AND r->'admitted'='true'::jsonb FROM (SELECT public.claim_comms_email_send(pg_temp.msg(6),pg_temp.op(6),true) r) x), 'stale dispatching re-claims through reconcile');
SELECT public.finalize_comms_email_send(pg_temp.msg(6),pg_temp.op(6),'provider_accepted','re_proof_6',NULL,2);

-- ── 5. two approvals of identical content cannot both be admitted ───────────────────────────
SELECT pg_temp.prep(7,'Twin note','Twin body.');
SELECT pg_temp.prep(8,'Twin note','Twin body.');
SELECT pg_temp.ok(70, (SELECT r->>'state'='dispatching' AND r->'admitted'='true'::jsonb FROM (SELECT public.claim_comms_email_send(pg_temp.msg(7),pg_temp.op(7)) r) x), 'first identical operation admitted');
SELECT pg_temp.ok(71, public.claim_comms_email_send(pg_temp.msg(8),pg_temp.op(8))->>'state'='prepared', 'second identical operation held while the first is in flight');
SELECT pg_temp.err(72, 'new identical prepare refused while in flight', $q$SELECT pg_temp.prep(9,'Twin note','Twin body.')$q$, '55000', 'COMMS_EMAIL_RECONCILIATION_REQUIRED');

-- ── 6. refused / failed before claim; reasons stay code-shaped ──────────────────────────────
SELECT pg_temp.prep(10,'Blocked note','Body ten.');
SELECT pg_temp.ok(80, public.finalize_comms_email_send(pg_temp.msg(10),pg_temp.op(10),'refused',NULL,'blocked_suppressed')->>'outcome'='refused', 'refused before claim');
SELECT pg_temp.ok(81, (SELECT status='blocked' AND error='blocked_suppressed' FROM public.messages WHERE id=pg_temp.msg(10)), 'refused row reads blocked with the pre-send code');
SELECT pg_temp.ok(82, public.read_comms_email_send_result('ffffffff-3280-4000-8000-000000000001','aaaaaaaa-3280-4000-8000-000000000001',pg_temp.op(10))->>'reason'='blocked_suppressed', 'result carries the refusal code');
SELECT pg_temp.prep(11,'Failing note','Body eleven.');
SELECT public.claim_comms_email_send(pg_temp.msg(11),pg_temp.op(11));
SELECT public.finalize_comms_email_send(pg_temp.msg(11),pg_temp.op(11),'failed',NULL,'Resend 422: invalid from header key=re_secret',1);
SELECT pg_temp.ok(83, (SELECT status='failed' AND meta#>>'{comms_email_binding,outcome_reason}'='unspecified' FROM public.messages WHERE id=pg_temp.msg(11)), 'provider error prose never enters the binding');
SELECT pg_temp.ok(84, public.read_comms_email_send_result('ffffffff-3280-4000-8000-000000000001','aaaaaaaa-3280-4000-8000-000000000001',pg_temp.op(11))->>'reason'='unspecified', 'failed result carries only its code-shaped reason, never the provider prose');
SELECT pg_temp.prep(12,'Never claimed','Body twelve.');
SELECT pg_temp.err(85, 'unknown cannot be recorded for an unclaimed send', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(12),pg_temp.op(12),'unknown',NULL,NULL)$q$, '42501', 'COMMS_EMAIL_NOT_CLAIMED');

-- ── 6b. finalize race: only the attempt holding the claim finalizes a dispatching operation ──
-- (verifier #1) request A claims and calls the provider; request B for the same operation hits a
-- pre-claim refusal. B must not be able to record "Not sent" over A's possibly-sent email.
SELECT pg_temp.prep(30,'Race note','Body thirty.');
SELECT pg_temp.ok(87, public.claim_comms_email_send(pg_temp.msg(30),pg_temp.op(30))->>'attempts'='1', 'race: A claims attempt 1');
SELECT pg_temp.err(88, 'race: unclaimed refused over a dispatching op raises', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(30),pg_temp.op(30),'refused',NULL,'blocked_suppressed')$q$, '42501', 'COMMS_EMAIL_NOT_CLAIMED');
SELECT pg_temp.err(89, 'race: unclaimed failed over a dispatching op raises', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(30),pg_temp.op(30),'failed',NULL,'provider_not_attempted')$q$, '42501', 'COMMS_EMAIL_NOT_CLAIMED');
SELECT pg_temp.err(100, 'race: unclaimed unknown over a dispatching op raises', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(30),pg_temp.op(30),'unknown',NULL,NULL)$q$, '42501', 'COMMS_EMAIL_NOT_CLAIMED');
SELECT pg_temp.err(101, 'race: wrong attempt number raises', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(30),pg_temp.op(30),'provider_accepted','re_proof_30',NULL,2)$q$, '42501', 'COMMS_EMAIL_NOT_CLAIMED');
SELECT pg_temp.err(102, 'race: refused is never recorded after a claim, even by the claimant', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(30),pg_temp.op(30),'refused',NULL,'blocked_suppressed',1)$q$, '42501', 'COMMS_EMAIL_NOT_CLAIMED');
SELECT pg_temp.ok(103, pg_temp.st(30)='dispatching' AND (SELECT status='draft' FROM public.messages WHERE id=pg_temp.msg(30)), 'race: losing finalizes changed nothing');
SELECT pg_temp.ok(104, public.finalize_comms_email_send(pg_temp.msg(30),pg_temp.op(30),'provider_accepted','re_proof_30',NULL,1)->>'outcome'='provider_accepted', 'race: the claimant still records provider_accepted');
SELECT pg_temp.ok(105, (SELECT status='sent' AND provider_message_id='re_proof_30' FROM public.messages WHERE id=pg_temp.msg(30)), 'race: row reads sent, never "Not sent"');
-- An unclaimed caller cannot pose as a claimant on a still-prepared operation.
SELECT pg_temp.prep(31,'Unclaimed note','Body thirty-one.');
SELECT pg_temp.err(106, 'prepared op: a claimed attempt number without a claim raises', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(31),pg_temp.op(31),'failed',NULL,'provider_not_attempted',1)$q$, '42501', 'COMMS_EMAIL_NOT_CLAIMED');
-- A superseded attempt (stale dispatching re-claimed through reconcile) can no longer finalize.
SELECT pg_temp.prep(32,'Superseded note','Body thirty-two.');
SELECT public.claim_comms_email_send(pg_temp.msg(32),pg_temp.op(32));
RESET ROLE;
UPDATE public.messages SET meta=jsonb_set(meta,'{comms_email_binding,claimed_at}',to_jsonb(now()-interval '200 seconds')) WHERE id=pg_temp.msg(32);
SET LOCAL ROLE service_role;
SELECT pg_temp.ok(107, (SELECT r->>'attempts'='2' AND r->'admitted'='true'::jsonb FROM (SELECT public.claim_comms_email_send(pg_temp.msg(32),pg_temp.op(32),true) r) x), 'superseded: reconcile takes attempt 2');
SELECT pg_temp.err(108, 'superseded: attempt 1 can no longer finalize', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(32),pg_temp.op(32),'unknown',NULL,NULL,1)$q$, '42501', 'COMMS_EMAIL_NOT_CLAIMED');
SELECT pg_temp.ok(109, public.finalize_comms_email_send(pg_temp.msg(32),pg_temp.op(32),'provider_accepted','re_proof_32',NULL,2)->>'outcome'='provider_accepted', 'superseded: attempt 2 finalizes');
RESET ROLE;
SELECT pg_temp.ok(110, (SELECT count(*)=1 FROM public.paige_workspace_events WHERE source_id=pg_temp.op(30)), 'race: exactly one Rail row (the claimant''s)');
SELECT pg_temp.ok(86, (SELECT count(*)=1 FROM public.paige_workspace_events WHERE source_id=pg_temp.op(10) AND outcome='capability_refused' AND capability_key='comms_send_email'), 'refusal recorded on the Rail');

-- ── 6c. a failed outcome carries its reason; the door closes an unadmitted prepared send ─────
-- (x2 #2) Chat narrates a failure from its reason ("safe to ask again" vs "check the setup").
SET LOCAL ROLE service_role;
SELECT pg_temp.prep(33,'Unverified note','Body thirty-three.');
SELECT public.finalize_comms_email_send(pg_temp.msg(33),pg_temp.op(33),'failed',NULL,'pre_send_unverified');
SELECT pg_temp.ok(111, public.read_comms_email_send_result('ffffffff-3280-4000-8000-000000000001','aaaaaaaa-3280-4000-8000-000000000001',pg_temp.op(33))->>'reason'='pre_send_unverified', 'failed result carries its reason code');
-- (x2 #1) send-message answered but its claim did not admit the row: the door closes it unclaimed.
SELECT pg_temp.prep(34,'Unadmitted note','Body thirty-four.');
SELECT pg_temp.ok(112, public.finalize_comms_email_send(pg_temp.msg(34),pg_temp.op(34),'refused',NULL,'send_not_admitted',NULL)->>'outcome'='refused', 'an unadmitted prepared send closes as refused');
SELECT pg_temp.ok(113, (SELECT status='blocked' AND meta#>>'{comms_email_binding,state}'='refused' FROM public.messages WHERE id=pg_temp.msg(34))
  AND public.read_comms_email_send_result('ffffffff-3280-4000-8000-000000000001','aaaaaaaa-3280-4000-8000-000000000001',pg_temp.op(34))->>'reason'='send_not_admitted', 'it reads blocked / Not sent with its reason, never prepared');

-- ── 6d. a seat that lapses mid-send: finalize cannot record, and the outcome stays unknown ────
-- (x1 header) finalize records the Rail through record_capability_run, which refuses an actor with
-- no active membership; the whole finalize rolls back. The row stays 'dispatching' and, because the
-- binding read re-proves the actor, it cannot be reconciled either. Honestly unknown, never "sent".
SELECT pg_temp.prep(35,'Lapsed note','Body thirty-five.',_actor=>'ffffffff-3280-4000-8000-000000000002',_gov=>pg_temp.gov()||'{"actor_user_id":"ffffffff-3280-4000-8000-000000000002"}');
SELECT pg_temp.ok(114, public.claim_comms_email_send(pg_temp.msg(35),pg_temp.op(35))->'admitted'='true'::jsonb, 'lapsed seat: the send was claimed while the seat was live');
RESET ROLE;
UPDATE public.tenant_members SET status='suspended' WHERE user_id='ffffffff-3280-4000-8000-000000000002' AND tenant_id='aaaaaaaa-3280-4000-8000-000000000001';
SET LOCAL ROLE service_role;
SELECT pg_temp.err(115, 'lapsed seat: finalize cannot record the outcome', $q$SELECT public.finalize_comms_email_send(pg_temp.msg(35),pg_temp.op(35),'provider_accepted','re_proof_35',NULL,1)$q$, '42501', 'CAPABILITY_RUN_FORBIDDEN');
SELECT pg_temp.ok(116, pg_temp.st(35)='dispatching' AND (SELECT status='draft' AND provider_message_id IS NULL FROM public.messages WHERE id=pg_temp.msg(35)), 'lapsed seat: the row stays dispatching (unknown), never sent');
SELECT pg_temp.err(117, 'lapsed seat: the binding read refuses, so it is not reconcilable', $q$SELECT public.read_comms_email_send_binding(pg_temp.msg(35))$q$, '42501', 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE');
RESET ROLE;
UPDATE public.tenant_members SET status='active' WHERE user_id='ffffffff-3280-4000-8000-000000000002' AND tenant_id='aaaaaaaa-3280-4000-8000-000000000001';

-- ── 7. browser roles cannot execute; guard trigger rejects end-user writes ─────────────────
SELECT pg_temp.ok(90, NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  AND p.proname IN ('_comms_email_actor','_comms_email_governance','_comms_email_reconcilable','prepare_comms_email_send','read_comms_email_send_binding',
   'claim_comms_email_send','finalize_comms_email_send','read_comms_email_send_result','find_comms_email_pending_reconciliation')
  AND (has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE') OR NOT has_function_privilege('service_role',p.oid,'EXECUTE'))), 'only service_role may execute any comms email function');
SELECT pg_temp.ok(91, (SELECT count(*) FILTER (WHERE p.prosecdef)=8 AND bool_and(p.prosecdef OR p.proname='_comms_email_reconcilable') AND count(*)=9
  FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('_comms_email_actor','_comms_email_governance','_comms_email_reconcilable',
   'prepare_comms_email_send','read_comms_email_send_binding','claim_comms_email_send','finalize_comms_email_send','read_comms_email_send_result',
   'find_comms_email_pending_reconciliation')), 'eight DEFINER functions plus one invoker helper');
SELECT set_config('request.jwt.claims', json_build_object('sub','ffffffff-3280-4000-8000-000000000001','role','authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.err(92, 'authenticated cannot prepare', $q$SELECT public.prepare_comms_email_send('ffffffff-3280-4000-8000-000000000001','aaaaaaaa-3280-4000-8000-000000000001','dddddddd-3280-4000-8000-000000000092','bbbbbbbb-3280-4000-8000-000000000001','client.one@example.invalid','cccccccc-3280-4000-8000-000000000001','owner@biz.example.invalid','s','b','<p>b</p>','x','{}','{}')$q$, '42501', 'permission denied for function prepare_comms_email_send');
SELECT pg_temp.err(93, 'authenticated cannot claim', $q$SELECT public.claim_comms_email_send('dddddddd-3280-4000-8000-000000000012','dddddddd-3280-4000-8000-000000000012')$q$, '42501', 'permission denied for function claim_comms_email_send');
SELECT pg_temp.err(94, 'authenticated cannot finalize', $q$SELECT public.finalize_comms_email_send('dddddddd-3280-4000-8000-000000000012','dddddddd-3280-4000-8000-000000000012','provider_accepted','x',NULL)$q$, '42501', 'permission denied for function finalize_comms_email_send');
SELECT pg_temp.err(95, 'authenticated cannot read results', $q$SELECT public.read_comms_email_send_result('ffffffff-3280-4000-8000-000000000001','aaaaaaaa-3280-4000-8000-000000000001','dddddddd-3280-4000-8000-000000000001')$q$, '42501', 'permission denied for function read_comms_email_send_result');
RESET ROLE;
-- The table owner bypasses RLS here, so only the trigger can be what refuses these writes.
SELECT pg_temp.err(96, 'end-user update of a governed row refused', $q$UPDATE public.messages SET subject='Tampered' WHERE id=pg_temp.msg(12)$q$, '42501', 'Governed business email uses the governed sender');
SELECT pg_temp.err(97, 'end-user insert of a binding refused', $q$INSERT INTO public.messages(tenant_id,thread_key,channel_type,direction,status,meta) VALUES('aaaaaaaa-3280-4000-8000-000000000001','proof','email','outbound','draft','{"comms_email_binding":{"operation_id":"dddddddd-3280-4000-8000-000000000097"}}')$q$, '42501', 'Governed business email uses the governed sender');
SELECT set_config('request.jwt.claims', '{}', true);
SELECT pg_temp.ok(98, (SELECT subject='Never claimed' FROM public.messages WHERE id=pg_temp.msg(12)), 'refused end-user write left the row untouched');

SELECT count(*) FILTER (WHERE res='ok') AS ok,
       count(*) FILTER (WHERE res<>'ok') AS failed,
       jsonb_agg(jsonb_build_object('ord', ord, 'res', res, 'label', label) ORDER BY ord) FILTER (WHERE res<>'ok') AS failures
FROM _p;
ROLLBACK;
