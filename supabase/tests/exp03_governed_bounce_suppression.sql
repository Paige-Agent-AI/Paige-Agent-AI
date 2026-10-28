-- EXP03 — a governed one-to-one email that proves an address cannot receive puts that address on THIS
-- business's do-not-send list (20271120120003), through the real seams. Full replayed schema, actual
-- caller roles, synthetic data only (test-tenant-* rows, *.tests.invalid addresses; §63); everything rolled
-- back. No provider is called: each email runs through the governed door's prepare → claim → finalize, and
-- SendGrid's events through the one door, ingest_sendgrid_receipt, exactly as handle-sendgrid-webhook calls it.
--
-- Production case this pins (2026-10-28): a hard bounce ("552 … mailbox not found") and, minutes later at a
-- second business, a SendGrid drop "Bounced Address" both marked the email failed and wrote NO suppression,
-- so the pre-send check (paige_suppressions, blocked_suppressed) could not warn before the next attempt.
--   0. the applier keeps its §59 shape: nobody's, SECURITY DEFINER, search_path pinned;
--   1. a HARD bounce suppresses the contact (bounce_hard, webhook) for this business, and the pre-send read
--      (the exact tenant + channel + contact-or-address shape runPreSend issues) now finds it; a replay of
--      the same fact adds no second row;
--   2. a drop because the address bounced before suppresses (bounce_hard) and says so in plain words;
--      a drop because the address is invalid suppresses too; a drop for another reason does not and keeps
--      the old wording;
--   3. a BLOCKED bounce and a delayed (soft) delivery suppress nobody — the campaign path's rule;
--   4. a spam complaint suppresses (complaint) and leaves the email's status as it was;
--   5. another business with a contact at the SAME address is not suppressed, and its pre-send read finds
--      nothing; a forged tenant claim suppresses nobody.
BEGIN;
SELECT plan(30);

-- ── Seed: two businesses, each with a Resend connection (delivered through SendGrid since 20271116200000) ──
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e03b0100-0000-4000-8000-000000000001','authenticated','authenticated','e03-bnc-1@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e03b0100-0000-4000-8000-000000000002','authenticated','authenticated','e03-bnc-2@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e03b0200-0000-4000-8000-000000000001','test-tenant-e03-bnc-larch','Larch Studio','active','standalone',NULL,'E03BL',9433101,'{}'),
 ('e03b0200-0000-4000-8000-000000000002','test-tenant-e03-bnc-wren','Wren Works','active','standalone',NULL,'E03BW',9433102,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e03b0200-0000-4000-8000-000000000001','e03b0100-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e03b0200-0000-4000-8000-000000000002','e03b0100-0000-4000-8000-000000000002','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e03b0200-0000-4000-8000-000000000001' WHERE user_id='e03b0100-0000-4000-8000-000000000001';
UPDATE public.profiles SET active_tenant_id='e03b0200-0000-4000-8000-000000000002' WHERE user_id='e03b0100-0000-4000-8000-000000000002';
INSERT INTO public.tenant_legal_profile(tenant_id,legal_business_name,registered_address) VALUES
 ('e03b0200-0000-4000-8000-000000000001','Larch Studio LLC','5 Test Way, Springfield, ZZ 00000'),
 ('e03b0200-0000-4000-8000-000000000002','Wren Works LLC','6 Test Way, Springfield, ZZ 00000');
INSERT INTO public.channel_connectors(id,tenant_id,channel_type,provider,from_name,from_address,status,active) VALUES
 ('e03b0900-0000-4000-8000-000000000001','e03b0200-0000-4000-8000-000000000001','email','resend','Larch Studio','hello@larch-bnc.tests.invalid','active',true),
 ('e03b0900-0000-4000-8000-000000000002','e03b0200-0000-4000-8000-000000000002','email','resend','Wren Works','hello@wren-bnc.tests.invalid','active',true);
-- Larch's contacts 1..8 (n.bnc@tests.invalid). Wren's contact 9 shares contact 1's address.
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,email,status)
SELECT ('e03b0300-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'e03b0200-0000-4000-8000-000000000001',
       'e03b0100-0000-4000-8000-000000000001','Contact'||n,'Test','c'||n||'.bnc@tests.invalid','active'
  FROM generate_series(1,8) n;
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,email,status) VALUES
 ('e03b0300-0000-4000-8000-000000000009','e03b0200-0000-4000-8000-000000000002','e03b0100-0000-4000-8000-000000000002',
  'Shared','Test','c1.bnc@tests.invalid','active');

-- ── Helpers (as exp03_resend_retired.sql) ───────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.svc(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 SET LOCAL ROLE service_role;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.tn(w int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e03b0200-0000-4000-8000-00000000000'||w)::uuid $$;
CREATE FUNCTION pg_temp.cid(c int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e03b0300-0000-4000-8000-0000000000'||lpad(c::text,2,'0'))::uuid $$;
CREATE FUNCTION pg_temp.addr(c int) RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN c = 9 THEN 'c1.bnc@tests.invalid' ELSE 'c'||c||'.bnc@tests.invalid' END $$;
CREATE FUNCTION pg_temp.op(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e03b0f00-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid $$;
CREATE FUNCTION pg_temp.msg(n int) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(n)::text $$;
CREATE FUNCTION pg_temp.b(n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT meta->'comms_email_binding' FROM public.messages WHERE id=pg_temp.msg(n) $$;
CREATE FUNCTION pg_temp.ms(n int) RETURNS text LANGUAGE sql AS $$ SELECT status FROM public.messages WHERE id = pg_temp.msg(n) $$;
CREATE FUNCTION pg_temp.err(n int) RETURNS text LANGUAGE sql AS $$ SELECT error FROM public.messages WHERE id = pg_temp.msg(n) $$;
-- Governed email n from business w (1 Larch, 2 Wren) to contact c, through that business's own connection,
-- prepared, claimed and accepted by the provider with id 'sgb<n>'. Returns the finalize outcome.
CREATE FUNCTION pg_temp.send(n int, w int, c int) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _u uuid := ('e03b0100-0000-4000-8000-00000000000'||w)::uuid;
        _conn text := 'e03b0900-0000-4000-8000-00000000000'||w;
        _from text := CASE w WHEN 1 THEN 'hello@larch-bnc.tests.invalid' ELSE 'hello@wren-bnc.tests.invalid' END;
        _to text := pg_temp.addr(c); _r jsonb;
BEGIN
 _r := pg_temp.svc(format('SELECT public.prepare_comms_email_send(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L::uuid,%L,%L,%L,%L,%L,%L::jsonb,%L::jsonb)',
  _u, pg_temp.tn(w), pg_temp.op(n), pg_temp.cid(c), _to, _conn, _from, 'Note '||n, 'Body '||n||'.', '<p>Body '||n||'.</p>',
  encode(extensions.digest(convert_to(_to||E'\n'||_conn||E'\n'||'Note '||n||E'\n'||'Body '||n||'.','UTF8'),'sha256'),'hex'),
  jsonb_build_object('action','comms.email_send','contact_id',pg_temp.cid(c),'connector_id',_conn,'subject','Note '||n,'body','Body '||n||'.'),
  jsonb_build_object('actor_user_id',_u,'tenant_id',pg_temp.tn(w),'tool','comms_send_email',
   'action','comms.email_send','approval_channel','operator_card','approved_fingerprint','0123456789abcdef','decision_receipt_recorded',true)));
 IF _r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'prepare % failed: %', n, _r; END IF;
 _r := pg_temp.svc(format('SELECT public.claim_comms_email_send(%L::uuid,%L::uuid,false)', pg_temp.msg(n), pg_temp.op(n)));
 IF _r->>'admitted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'claim % failed: %', n, _r; END IF;
 RETURN pg_temp.svc(format('SELECT public.finalize_comms_email_send(%L::uuid,%L::uuid,%L,%L,NULL,1)',
   pg_temp.msg(n), pg_temp.op(n), 'provider_accepted', 'sgb'||n))->>'outcome';
END $$;
-- One SendGrid event for email n through the door: all three claims send-message attaches, the recipient's
-- address, unless the tenant claim is overridden.
CREATE FUNCTION pg_temp.ev(_receipt text, n int, _status text, _bounce text DEFAULT NULL, _reason text DEFAULT NULL,
                           _tenant text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT pg_temp.svc(format(
   'SELECT to_jsonb(public.ingest_sendgrid_receipt(_receipt_id=>%L,_message_id=>%L,_status=>%L,_email=>%L,_event_at=>now(),_tenant_id=>%L,_operation_id=>%L,_paige_message_id=>%L,_bounce_type=>%L,_reason=>%L))',
   _receipt, 'sgb'||n, _status, pg_temp.b(n)->>'recipient', coalesce(_tenant, (SELECT tenant_id::text FROM public.messages WHERE id = pg_temp.msg(n))),
   pg_temp.op(n)::text, pg_temp.msg(n)::text, _bounce, _reason)) #>> '{}' $$;
CREATE FUNCTION pg_temp.jr(_receipt text) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(correlation,'-')||':'||coalesce(correlation_reason,'-')||':'||coalesce(delivery_effect,'-')
   FROM public.sendgrid_receipt_processing WHERE receipt_id = _receipt $$;
-- This business's suppression rows for contact c, as "reason/source" (sorted), or '' for none.
CREATE FUNCTION pg_temp.supp(w int, c int) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(reason||'/'||source, ',' ORDER BY reason), '') FROM public.paige_suppressions
  WHERE tenant_id = pg_temp.tn(w) AND channel = 'email' AND (contact_id = pg_temp.cid(c) OR address_normalized = pg_temp.addr(c)) $$;
-- The read runPreSend issues (supabase/functions/_shared/pre-send-pipeline.ts step 2), as the service role:
-- tenant + channel + (contact_id = cid OR address_normalized = normalized address). Its reason, or 'clear'.
CREATE FUNCTION pg_temp.presend(w int, c int) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(pg_temp.svc(format(
   'SELECT to_jsonb(r.reason) FROM public.paige_suppressions r WHERE r.tenant_id = %L::uuid AND r.channel = %L AND (r.contact_id = %L::uuid OR r.address_normalized = %L) LIMIT 1',
   pg_temp.tn(w), 'email', pg_temp.cid(c), pg_temp.addr(c))) #>> '{}', 'clear') $$;

-- ── 0. §59 shape unchanged ──────────────────────────────────────────────────────────────────────
SELECT ok((SELECT bool_and(NOT has_function_privilege(r, 'public._sendgrid_apply_governed_receipt(text,text,text,timestamp with time zone,text,text,text,text,text)', 'EXECUTE'))
             FROM unnest(ARRAY['anon','authenticated','service_role']) r)
      AND (SELECT prosecdef AND array_to_string(proconfig, ',') LIKE 'search_path=%' FROM pg_proc
            WHERE oid = 'public._sendgrid_apply_governed_receipt(text,text,text,timestamp with time zone,text,text,text,text,text)'::regprocedure),
  'the governed-reply applier stays nobody''s, SECURITY DEFINER, search_path pinned');
SELECT is(pg_temp.send(1,1,1)||pg_temp.send(2,1,2)||pg_temp.send(3,1,3)||pg_temp.send(4,1,4)||pg_temp.send(5,1,5)
        ||pg_temp.send(6,1,6)||pg_temp.send(7,1,7)||pg_temp.send(9,2,9)||pg_temp.send(10,1,8),
  repeat('provider_accepted', 9), 'nine governed emails (eight from Larch, one from Wren) are accepted by the provider');
SELECT is(pg_temp.presend(1,1)||'/'||pg_temp.presend(2,9), 'clear/clear', 'before any event, nobody is on either do-not-send list');

-- ── 1. A hard bounce suppresses the contact for THIS business ──────────────────────────────────
SELECT is(pg_temp.ev('sg:bnc-1', 1, 'bounced', 'bounce', '552 1 Requested mail action aborted, mailbox not found')||'/'||pg_temp.jr('sg:bnc-1'),
  'processed/correlated:-:bounced', 'the hard bounce is processed and correlated');
SELECT is(pg_temp.ms(1)||'/'||(pg_temp.b(1)->>'delivery_state')||'/'||pg_temp.err(1),
  'failed/bounced/Not delivered: the recipient''s email server returned this email.', 'the email is failed with its existing words');
SELECT is(pg_temp.supp(1,1), 'bounce_hard/webhook', 'the contact is suppressed for this business (bounce_hard, from the webhook)');
SELECT is((SELECT count(*)::int FROM public.paige_suppressions WHERE tenant_id = pg_temp.tn(1) AND contact_id = pg_temp.cid(1)
             AND address_normalized IS NULL), 1, 'the row is keyed on the contact, as the campaign path keys it');
SELECT is(pg_temp.presend(1,1), 'bounce_hard', 'the pre-send read now finds it, so the next send to this address is held before it goes');
SELECT is(pg_temp.ev('sg:bnc-1-again', 1, 'bounced', 'bounce', '552 mailbox not found')||'/'||pg_temp.jr('sg:bnc-1-again')
          ||'/'||(SELECT count(*) FROM public.paige_suppressions WHERE tenant_id = pg_temp.tn(1) AND contact_id = pg_temp.cid(1)),
  'processed/correlated:-:stale_ignored/1', 'a second bounce report for it adds no second row');

-- ── 2. Drops ────────────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.ev('sg:bnc-2', 2, 'dropped', NULL, 'Bounced Address')||'/'||pg_temp.jr('sg:bnc-2'),
  'processed/correlated:-:dropped', 'a drop because the address bounced before is processed and correlated');
SELECT is(pg_temp.ms(2)||'/'||(pg_temp.b(2)->>'delivery_state')||'/'||(pg_temp.b(2)->>'delivery_reason'),
  'failed/dropped/Bounced Address', 'the email is failed as dropped, the provider''s reason kept');
SELECT is(pg_temp.err(2), 'Not sent: this address bounced before, so the email service is holding it. Check the address.',
  'it says so in plain words');
SELECT is(pg_temp.supp(1,2)||'/'||pg_temp.presend(1,2), 'bounce_hard/webhook/bounce_hard', 'and the contact is suppressed, visible to the pre-send read');
SELECT is(pg_temp.ev('sg:bnc-3', 3, 'dropped', NULL, 'Invalid')||'/'||pg_temp.supp(1,3),
  'processed/bounce_hard/webhook', 'a drop because the address is invalid suppresses too');
SELECT is(pg_temp.err(3), 'Not delivered: PAIGE Email could not send to this address.', 'and keeps the existing words');
SELECT is(pg_temp.ev('sg:bnc-4', 4, 'dropped', NULL, 'Unsubscribed Address')||'/'||pg_temp.ms(4)||'/'||pg_temp.supp(1,4),
  'processed/failed/', 'a drop for another reason fails the email and suppresses nobody');
SELECT is(pg_temp.err(4), 'Not delivered: PAIGE Email could not send to this address.', 'and keeps the existing words');

-- ── 3. Blocked and soft outcomes suppress nobody ────────────────────────────────────────────────
SELECT is(pg_temp.ev('sg:bnc-5', 5, 'bounced', 'blocked', '550 5.7.1 blocked by policy')||'/'||(pg_temp.b(5)->>'delivery_state')||'/'||pg_temp.ms(5),
  'processed/blocked/failed', 'a blocked bounce marks the email blocked');
SELECT is(pg_temp.supp(1,5)||'/'||pg_temp.presend(1,5), '/clear', 'and suppresses nobody (the campaign rule)');
SELECT is(pg_temp.ev('sg:bnc-6', 6, 'delivery_delayed', NULL, '421 try again later')||'/'||(pg_temp.b(6)->>'delivery_state')||'/'||pg_temp.supp(1,6),
  'processed/deferred/', 'a delayed (soft) delivery suppresses nobody');

-- ── 4. A spam complaint suppresses ──────────────────────────────────────────────────────────────
SELECT is(pg_temp.ev('sg:bnc-7d', 7, 'delivered')||'/'||pg_temp.ev('sg:bnc-7', 7, 'complained')||'/'||pg_temp.jr('sg:bnc-7'),
  'processed/processed/correlated:-:spam_reported', 'a delivered email''s spam complaint is processed and correlated');
SELECT is(pg_temp.ms(7)||'/'||(pg_temp.b(7)->>'delivery_state'), 'delivered/spam_reported', 'the email keeps its status (it arrived)');
SELECT is(pg_temp.supp(1,7)||'/'||pg_temp.presend(1,7), 'complaint/webhook/complaint', 'the contact is suppressed as a complaint');

-- ── 5. Per business, never across businesses ────────────────────────────────────────────────────
SELECT is(pg_temp.supp(2,9)||'/'||pg_temp.presend(2,9), '/clear',
  'Wren''s contact at the SAME address as Larch''s bounced contact is not suppressed, and Wren''s pre-send read is clear');
SELECT is((SELECT count(*)::int FROM public.paige_suppressions WHERE tenant_id = pg_temp.tn(2)), 0, 'Wren has no suppression row at all');
SELECT is(pg_temp.ev('sg:bnc-10', 10, 'bounced', 'bounce', '550 no such user', 'e03b0200-0000-4000-8000-000000000002')
          ||'/'||pg_temp.jr('sg:bnc-10')||'/'||pg_temp.ms(10)||'/'||pg_temp.supp(1,8)||'/'||pg_temp.supp(2,8),
  'processed/uncorrelated:tenant_mismatch:none/sent//', 'a bounce carrying another business''s claim changes nothing and suppresses nobody');
SELECT is(pg_temp.ev('sg:bnc-9', 9, 'bounced', 'bounce', '552 mailbox not found')||'/'||pg_temp.supp(2,9)||'/'||pg_temp.supp(1,1),
  'processed/bounce_hard/webhook/bounce_hard/webhook', 'Wren''s own hard bounce suppresses Wren''s contact, under Wren');
SELECT is((SELECT count(*)::int FROM public.paige_suppressions WHERE tenant_id = pg_temp.tn(2) AND contact_id = pg_temp.cid(9)), 1,
  'exactly one row for Wren, on Wren''s own contact');
SELECT is((SELECT count(*)::int FROM public.paige_suppressions s JOIN public.clients c ON c.id = s.contact_id
            WHERE s.tenant_id IN (pg_temp.tn(1), pg_temp.tn(2)) AND c.tenant_id IS DISTINCT FROM s.tenant_id), 0,
  'every row sits under the business that owns its contact');
SELECT is((SELECT count(*)::int FROM public.paige_suppressions WHERE tenant_id IN (pg_temp.tn(1), pg_temp.tn(2))), 5,
  'five rows in all: Larch 1, 2, 3 (bounce_hard) and 7 (complaint), Wren 9 (bounce_hard); the replay added none');

SELECT * FROM finish();
ROLLBACK;
