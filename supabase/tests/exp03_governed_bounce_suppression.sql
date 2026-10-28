-- EXP03 — a governed one-to-one email that proves an address cannot receive puts that ADDRESS on THIS
-- business's do-not-send list, and a complaint puts the PERSON on it (20271120120003), through the real
-- seams. Full replayed schema, actual caller roles, synthetic data only (test-tenant-* rows,
-- *.tests.invalid addresses; §63); everything rolled back. No provider is called: each email runs through
-- the governed door's prepare → claim → finalize, and SendGrid's events through the one door,
-- ingest_sendgrid_receipt, exactly as handle-sendgrid-webhook calls it.
--
-- Production case this pins (2026-10-28): a hard bounce ("552 … mailbox not found") and, minutes later at a
-- second business, a SendGrid drop "Bounced Address" both marked the email failed and wrote NO suppression,
-- so the pre-send check (paige_suppressions, blocked_suppressed) could not warn before the next attempt.
--   0. the applier keeps its §59 shape: nobody's, SECURITY DEFINER, search_path pinned;
--   1. a HARD bounce suppresses the normalised ADDRESS (bounce_hard, webhook, no contact) under the
--      message's business — the tenant comes from the message, as set_contact_scoped_tenant keeps it when
--      there is no contact; the pre-send read (the exact tenant + channel + contact-or-address shape
--      runPreSend issues) finds it; the same contact at a corrected address is NOT held; a replay adds no row;
--   2. a drop because the address bounced before suppresses (bounce_hard) and says so in plain words;
--      a drop because the address is invalid suppresses too; a drop for another reason does not and keeps
--      the old wording;
--   3. a BLOCKED bounce and a delayed (soft) delivery suppress nobody — the campaign path's rule;
--   4. a spam complaint suppresses the CONTACT (complaint) and leaves the email's status as it was;
--   5. another business with a contact at the SAME address is not suppressed, and its pre-send read finds
--      nothing; a forged tenant claim suppresses nobody;
--   6. a +tag address is folded by the canonical normaliser, so every +tag of it is held;
--   7. a complaint on a message whose contact belongs to ANOTHER business falls back to the normalised
--      address under the message's own business — never the other business;
--   8. a refused suppression write never loses the email's own outcome, and is not silent:
--      '_suppression_failed' in the journalled effect (the WARNING shows in the run output), including
--      when the message update itself is refused (message_update_refused[_suppression_failed]) — and when
--      the SETTLE update of an unknown send is refused (review MINOR 1: the bounce is still a fact);
--   9. a recipient that normalises to '' is SKIPPED and says so ('_suppression_skipped', review MINOR 4);
--  10. campaigns honour a governed bounce on a +tagged address (review M-A): the audience reads the contact
--      'suppressed' and the send-time claim skips the planned recipient instead of leasing it.
BEGIN;
SELECT plan(59);

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

-- Contact c's address: Wren's contact 9 shares Larch contact 1's address; contact 11 has a +tag address.
CREATE FUNCTION pg_temp.addr(c int) RETURNS text LANGUAGE sql AS $$
 SELECT CASE WHEN c = 9 THEN 'c1.bnc@tests.invalid' WHEN c = 11 THEN 'pat+news@bnc.tests.invalid'
             WHEN c = 16 THEN 'sam+promo@bnc.tests.invalid' ELSE 'c'||c||'.bnc@tests.invalid' END $$;
-- Larch's contacts 1..8 and 11..15; Wren's contact 9.
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,email,status)
SELECT ('e03b0300-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'e03b0200-0000-4000-8000-000000000001',
       'e03b0100-0000-4000-8000-000000000001','Contact'||n,'Test',pg_temp.addr(n),'active'
  FROM unnest(ARRAY[1,2,3,4,5,6,7,8,11,12,13,14,15,16,17,18,19]) n;
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
-- Larch's owner, signed in (the campaign editor's writers run as the caller).
CREATE FUNCTION pg_temp.owner(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims', jsonb_build_object('sub','e03b0100-0000-4000-8000-000000000001','role','authenticated')::text, true);
 SET LOCAL ROLE authenticated;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.tn(w int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e03b0200-0000-4000-8000-00000000000'||w)::uuid $$;
CREATE FUNCTION pg_temp.cid(c int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e03b0300-0000-4000-8000-0000000000'||lpad(c::text,2,'0'))::uuid $$;
CREATE FUNCTION pg_temp.norm(_a text) RETURNS text LANGUAGE sql AS $$ SELECT public._comms_normalize_address('email', _a) $$;
CREATE FUNCTION pg_temp.op(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e03b0f00-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid $$;
CREATE FUNCTION pg_temp.msg(n int) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(n)::text $$;
CREATE FUNCTION pg_temp.b(n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT meta->'comms_email_binding' FROM public.messages WHERE id=pg_temp.msg(n) $$;
CREATE FUNCTION pg_temp.ms(n int) RETURNS text LANGUAGE sql AS $$ SELECT status FROM public.messages WHERE id = pg_temp.msg(n) $$;
CREATE FUNCTION pg_temp.err(n int) RETURNS text LANGUAGE sql AS $$ SELECT error FROM public.messages WHERE id = pg_temp.msg(n) $$;
-- Governed email n from business w (1 Larch, 2 Wren) to contact c, through that business's own connection,
-- prepared, claimed and accepted by the provider with id 'sgb<n>'. Returns the finalize outcome.
CREATE FUNCTION pg_temp.send(n int, w int, c int, _outcome text DEFAULT 'provider_accepted') RETURNS text LANGUAGE plpgsql AS $$
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
 RETURN pg_temp.svc(format('SELECT public.finalize_comms_email_send(%L::uuid,%L::uuid,%L,%L,%L,1)',
   pg_temp.msg(n), pg_temp.op(n), _outcome, CASE WHEN _outcome = 'provider_accepted' THEN 'sgb'||n END,
   CASE WHEN _outcome = 'unknown' THEN 'provider_timeout' END))->>'outcome';
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
-- Business w's suppression rows about contact c (by contact, or by c's normalised address), "reason/source" sorted.
CREATE FUNCTION pg_temp.supp(w int, c int) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(reason||'/'||source, ',' ORDER BY reason), '') FROM public.paige_suppressions
  WHERE tenant_id = pg_temp.tn(w) AND channel = 'email' AND (contact_id = pg_temp.cid(c) OR address_normalized = pg_temp.norm(pg_temp.addr(c))) $$;
-- How business w's row(s) about contact c are keyed: 'address' (contact NULL), 'contact', or ''.
CREATE FUNCTION pg_temp.keyed(w int, c int) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(string_agg(CASE WHEN contact_id IS NULL THEN 'address:'||address_normalized ELSE 'contact' END, ',' ORDER BY reason), '')
   FROM public.paige_suppressions
  WHERE tenant_id = pg_temp.tn(w) AND channel = 'email' AND (contact_id = pg_temp.cid(c) OR address_normalized = pg_temp.norm(pg_temp.addr(c))) $$;
-- The read runPreSend issues (supabase/functions/_shared/pre-send-pipeline.ts step 2), as the service role:
-- tenant + channel + (contact_id = cid OR address_normalized = normalizeEmail(to)). Its reason, or 'clear'.
-- normalizeEmail mirrors _comms_normalize_address (lower-cased, +tag folded), so the latter stands in for it.
CREATE FUNCTION pg_temp.presend(w int, c int, _to text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(pg_temp.svc(format(
   'SELECT to_jsonb(r.reason) FROM public.paige_suppressions r WHERE r.tenant_id = %L::uuid AND r.channel = %L AND (r.contact_id = %L::uuid OR r.address_normalized = %L) LIMIT 1',
   pg_temp.tn(w), 'email', pg_temp.cid(c), pg_temp.norm(coalesce(_to, pg_temp.addr(c))))) #>> '{}', 'clear') $$;

-- ── 0. §59 shape unchanged ──────────────────────────────────────────────────────────────────────
SELECT ok((SELECT bool_and(NOT has_function_privilege(r, 'public._sendgrid_apply_governed_receipt(text,text,text,timestamp with time zone,text,text,text,text,text)', 'EXECUTE'))
             FROM unnest(ARRAY['anon','authenticated','service_role']) r)
      AND (SELECT prosecdef AND array_to_string(proconfig, ',') LIKE 'search_path=%' FROM pg_proc
            WHERE oid = 'public._sendgrid_apply_governed_receipt(text,text,text,timestamp with time zone,text,text,text,text,text)'::regprocedure),
  'the governed-reply applier stays nobody''s, SECURITY DEFINER, search_path pinned');
SELECT is(pg_temp.send(1,1,1)||pg_temp.send(2,1,2)||pg_temp.send(3,1,3)||pg_temp.send(4,1,4)||pg_temp.send(5,1,5)
        ||pg_temp.send(6,1,6)||pg_temp.send(7,1,7)||pg_temp.send(9,2,9)||pg_temp.send(10,1,8)
        ||pg_temp.send(11,1,11)||pg_temp.send(12,1,12)||pg_temp.send(13,1,13)||pg_temp.send(14,1,14)||pg_temp.send(15,1,15),
  repeat('provider_accepted', 14), 'fourteen governed emails (thirteen from Larch, one from Wren) are accepted by the provider');
SELECT is(pg_temp.presend(1,1)||'/'||pg_temp.presend(2,9), 'clear/clear', 'before any event, nobody is on either do-not-send list');
-- (Checked in a function so a body without the helpers reads false instead of erroring the proof.)
CREATE FUNCTION pg_temp.helper_shape() RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF to_regprocedure('public._sendgrid_governed_suppress(uuid,uuid,text,text,uuid)') IS NULL
     OR to_regprocedure('public._sendgrid_governed_suppress_suffix(text)') IS NULL THEN RETURN false; END IF;
  RETURN (SELECT bool_and(NOT has_function_privilege(r, 'public._sendgrid_governed_suppress(uuid,uuid,text,text,uuid)', 'EXECUTE')
                      AND NOT has_function_privilege(r, 'public._sendgrid_governed_suppress_suffix(text)', 'EXECUTE')
                      AND NOT has_function_privilege(r, 'public._email_audience(uuid,jsonb,boolean,text)', 'EXECUTE'))
            FROM unnest(ARRAY['anon','authenticated','service_role']) r)
     AND has_function_privilege('service_role', 'public.email_campaign_dispatch_claim(integer)', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.email_campaign_dispatch_claim(integer)', 'EXECUTE')
     AND (SELECT prosecdef AND array_to_string(proconfig, ',') LIKE 'search_path=%' FROM pg_proc
           WHERE oid = to_regprocedure('public._sendgrid_governed_suppress(uuid,uuid,text,text,uuid)'));
END $$;
SELECT ok(pg_temp.helper_shape(),
  'the suppress helpers and the audience are nobody''s, the claim stays service_role''s, the helper is DEFINER with a pinned search_path');
SELECT is(pg_temp.send(17,1,17,'unknown')||pg_temp.send(18,1,18,'unknown')||pg_temp.send(19,1,19)||pg_temp.send(16,1,16),
  'unknownunknownprovider_acceptedprovider_accepted', 'two more emails end unknown (no provider id), two more are accepted');

-- ── 1. A hard bounce suppresses the ADDRESS for THIS business ──────────────────────────────────
SELECT is(pg_temp.ev('sg:bnc-1', 1, 'bounced', 'bounce', '552 1 Requested mail action aborted, mailbox not found')||'/'||pg_temp.jr('sg:bnc-1'),
  'processed/correlated:-:bounced', 'the hard bounce is processed and correlated');
SELECT is(pg_temp.ms(1)||'/'||(pg_temp.b(1)->>'delivery_state')||'/'||pg_temp.err(1),
  'failed/bounced/Not delivered: the recipient''s email server returned this email.', 'the email is failed with its existing words');
SELECT is(pg_temp.supp(1,1), 'bounce_hard/webhook', 'the address is suppressed for this business (bounce_hard, from the webhook)');
SELECT is(pg_temp.keyed(1,1), 'address:c1.bnc@tests.invalid', 'keyed on the normalised address with no contact (a dead address, not the person)');
SELECT is((SELECT string_agg(tenant_id::text, ',') FROM public.paige_suppressions WHERE address_normalized = 'c1.bnc@tests.invalid'),
  'e03b0200-0000-4000-8000-000000000001', 'with no contact, the row carries the message''s own business (set_contact_scoped_tenant keeps it)');
SELECT is(pg_temp.presend(1,1), 'bounce_hard', 'the pre-send read (contact OR address) now finds it, so the next send to this address is held');
SELECT is(pg_temp.presend(1,1,'c1.fixed.bnc@tests.invalid'), 'clear', 'the same contact at a corrected address is not held');
SELECT is(pg_temp.ev('sg:bnc-1-again', 1, 'bounced', 'bounce', '552 mailbox not found')||'/'||pg_temp.jr('sg:bnc-1-again')
          ||'/'||(SELECT count(*) FROM public.paige_suppressions WHERE tenant_id = pg_temp.tn(1) AND address_normalized = 'c1.bnc@tests.invalid'),
  'processed/correlated:-:stale_ignored/1', 'a second bounce report for it adds no second row');

-- ── 2. Drops ────────────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.ev('sg:bnc-2', 2, 'dropped', NULL, 'Bounced Address')||'/'||pg_temp.jr('sg:bnc-2'),
  'processed/correlated:-:dropped', 'a drop because the address bounced before is processed and correlated');
SELECT is(pg_temp.ms(2)||'/'||(pg_temp.b(2)->>'delivery_state')||'/'||(pg_temp.b(2)->>'delivery_reason'),
  'failed/dropped/Bounced Address', 'the email is failed as dropped, the provider''s reason kept');
SELECT is(pg_temp.err(2), 'Not sent: this address bounced before, so the email service is holding it. Check the address.',
  'it says so in plain words');
SELECT is(pg_temp.supp(1,2)||'/'||pg_temp.keyed(1,2)||'/'||pg_temp.presend(1,2), 'bounce_hard/webhook/address:c2.bnc@tests.invalid/bounce_hard',
  'and the address is suppressed, visible to the pre-send read');
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

-- ── 4. A spam complaint suppresses the PERSON ───────────────────────────────────────────────────
SELECT is(pg_temp.ev('sg:bnc-7d', 7, 'delivered')||'/'||pg_temp.ev('sg:bnc-7', 7, 'complained')||'/'||pg_temp.jr('sg:bnc-7'),
  'processed/processed/correlated:-:spam_reported', 'a delivered email''s spam complaint is processed and correlated');
SELECT is(pg_temp.ms(7)||'/'||(pg_temp.b(7)->>'delivery_state'), 'delivered/spam_reported', 'the email keeps its status (it arrived)');
SELECT is(pg_temp.supp(1,7)||'/'||pg_temp.keyed(1,7)||'/'||pg_temp.presend(1,7), 'complaint/webhook/contact/complaint',
  'the contact is suppressed as a complaint, keyed on the contact');
SELECT is(pg_temp.presend(1,7,'c7.other.bnc@tests.invalid'), 'complaint', 'and stays held at any address they have (it is the person''s answer)');

-- ── 5. Per business, never across businesses ────────────────────────────────────────────────────
SELECT is(pg_temp.supp(2,9)||'/'||pg_temp.presend(2,9), '/clear',
  'Wren''s contact at the SAME address as Larch''s bounced contact is not suppressed, and Wren''s pre-send read is clear');
SELECT is((SELECT count(*)::int FROM public.paige_suppressions WHERE tenant_id = pg_temp.tn(2)), 0, 'Wren has no suppression row at all');
SELECT is(pg_temp.ev('sg:bnc-10', 10, 'bounced', 'bounce', '550 no such user', 'e03b0200-0000-4000-8000-000000000002')
          ||'/'||pg_temp.jr('sg:bnc-10')||'/'||pg_temp.ms(10)||'/'||pg_temp.supp(1,8)||'/'||pg_temp.supp(2,8),
  'processed/uncorrelated:tenant_mismatch:none/sent//', 'a bounce carrying another business''s claim changes nothing and suppresses nobody');
SELECT is(pg_temp.ev('sg:bnc-9', 9, 'bounced', 'bounce', '552 mailbox not found')||'/'||pg_temp.supp(2,9)||'/'||pg_temp.supp(1,1),
  'processed/bounce_hard/webhook/bounce_hard/webhook', 'Wren''s own hard bounce suppresses that address under Wren too');
SELECT is((SELECT count(*)::int FROM public.paige_suppressions WHERE address_normalized = 'c1.bnc@tests.invalid'), 2,
  'two rows for that address — one per business, each written by that business''s own bounce');

-- ── 6. A +tag address is folded ─────────────────────────────────────────────────────────────────
SELECT is(pg_temp.ev('sg:bnc-11', 11, 'bounced', 'bounce', '550 no such user')||'/'||pg_temp.keyed(1,11),
  'processed/address:pat@bnc.tests.invalid', 'a bounce at pat+news@ is stored as the folded address pat@');
SELECT is(pg_temp.presend(1,11)||'/'||pg_temp.presend(1,8,'PAT+other@bnc.tests.invalid')||'/'||pg_temp.presend(1,8,'pat.other@bnc.tests.invalid'),
  'bounce_hard/bounce_hard/clear', 'every +tag of it is held (any contact), a different address is not');

-- ── 7. A complaint whose message names another business's contact falls back to the address ─────
-- Fixture, stated (§13): the door never lets a message name another business's contact (prepare requires the
-- contact in the business), so message 12's contact is pointed at Wren's contact 9 with triggers off for that
-- one statement — the defensive branch the applier must still get right.
SET LOCAL session_replication_role = replica;
UPDATE public.messages SET contact_id = pg_temp.cid(9) WHERE id = pg_temp.msg(12);
SET LOCAL session_replication_role = origin;
SELECT is(pg_temp.ev('sg:bnc-12', 12, 'complained')||'/'||pg_temp.keyed(1,12)||'/'||(SELECT count(*) FROM public.paige_suppressions WHERE tenant_id = pg_temp.tn(2)),
  'processed/address:c12.bnc@tests.invalid/1', 'the complaint is kept under Larch on the normalised address; Wren gains nothing (its 1 row is its own bounce)');
SELECT is((SELECT count(*)::int FROM public.paige_suppressions WHERE tenant_id = pg_temp.tn(1) AND contact_id = pg_temp.cid(9)), 0,
  'and no Larch row names Wren''s contact');

-- ── 8. A refused suppression write never loses the outcome, and is never silent ─────────────────
-- Fixture, stated (§13): two test-only triggers, rolled back with everything else. One refuses any suppression
-- for c13 / c15 / c18; the other refuses (42501, as the provider-execution guard does) the message updates for
-- 14 / 15 and the SETTLE updates for the unknown sends 17 / 18.
CREATE FUNCTION public.zz_e03bnc_refuse_suppression() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.address_normalized IN ('c13.bnc@tests.invalid', 'c15.bnc@tests.invalid', 'c18.bnc@tests.invalid') THEN
    RAISE EXCEPTION 'test: suppression write refused' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_e03bnc_refuse_suppression BEFORE INSERT ON public.paige_suppressions
  FOR EACH ROW EXECUTE FUNCTION public.zz_e03bnc_refuse_suppression();
CREATE TEMP TABLE refused_msgs ON COMMIT DROP AS
  SELECT pg_temp.msg(14) AS id UNION ALL SELECT pg_temp.msg(15) UNION ALL SELECT pg_temp.msg(17) UNION ALL SELECT pg_temp.msg(18);
CREATE FUNCTION public.zz_e03bnc_refuse_message_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('e03bnc.refuse', true), '') LIKE '%'||OLD.id::text||'%' THEN
    RAISE EXCEPTION 'test: message update refused' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_e03bnc_refuse_message_update BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.zz_e03bnc_refuse_message_update();
DO $$ BEGIN PERFORM set_config('e03bnc.refuse', (SELECT string_agg(id::text, ',') FROM refused_msgs), true); END $$;
SELECT is(pg_temp.ev('sg:bnc-13', 13, 'bounced', 'bounce', '550 no such user')||'/'||pg_temp.jr('sg:bnc-13'),
  'processed/correlated:-:bounced_suppression_failed', 'a refused suppression write is journalled as bounced_suppression_failed');
SELECT is(pg_temp.ms(13)||'/'||(pg_temp.b(13)->>'delivery_state')||'/'||pg_temp.supp(1,13),
  'failed/bounced/', 'and the email''s own outcome is still recorded (failed, bounced); no row was written');
SELECT is(pg_temp.ev('sg:bnc-14', 14, 'bounced', 'bounce', '550 no such user')||'/'||pg_temp.jr('sg:bnc-14'),
  'processed/correlated:-:message_update_refused', 'a refused message update still answers message_update_refused');
SELECT is(pg_temp.ms(14)||'/'||pg_temp.supp(1,14), 'sent/bounce_hard/webhook',
  'the email keeps its last state, and the address is still suppressed (the bounce is still true)');
SELECT is(pg_temp.ev('sg:bnc-15', 15, 'bounced', 'bounce', '550 no such user')||'/'||pg_temp.jr('sg:bnc-15'),
  'processed/correlated:-:message_update_refused_suppression_failed', 'both refused: the answer reports both, nothing under-reported');
SELECT is(pg_temp.ms(15)||'/'||pg_temp.supp(1,15), 'sent/', 'the email keeps its last state and no row was written');
-- The settle path (review MINOR 1): an unknown send, named by all three claims and the recipient, whose settle
-- update is refused. The bounce is still a fact about the address.
SELECT is(pg_temp.ev('sg:bnc-17', 17, 'bounced', 'bounce', '550 no such user')||'/'||pg_temp.jr('sg:bnc-17'),
  'processed/correlated:settle_refused:message_update_refused', 'a refused settle still answers settle_refused / message_update_refused');
SELECT is((pg_temp.b(17)->>'state')||'/'||pg_temp.supp(1,17), 'unknown/bounce_hard/webhook',
  'the send stays unknown, and its address is suppressed anyway');
SELECT is(pg_temp.ev('sg:bnc-18', 18, 'bounced', 'bounce', '550 no such user')||'/'||pg_temp.jr('sg:bnc-18')||'/'||pg_temp.supp(1,18),
  'processed/correlated:settle_refused:message_update_refused_suppression_failed/', 'settle and suppression both refused: both reported');
DROP TRIGGER zz_e03bnc_refuse_message_update ON public.messages;
DROP TRIGGER zz_e03bnc_refuse_suppression ON public.paige_suppressions;

-- ── 9. Nothing to key it on: skipped, and said (review MINOR 4) ─────────────────────────────────
-- Fixture, stated (§13): the door never binds an empty recipient; message 19's is blanked with triggers off for one
-- statement, and its event carries no address (as SendGrid may send), so the applier's guard is what is proved.
SET LOCAL session_replication_role = replica;
UPDATE public.messages SET meta = jsonb_set(meta, '{comms_email_binding,recipient}', '""') WHERE id = pg_temp.msg(19);
SET LOCAL session_replication_role = origin;
SELECT is(pg_temp.svc(format(
   'SELECT to_jsonb(public.ingest_sendgrid_receipt(_receipt_id=>%L,_message_id=>%L,_status=>%L,_email=>NULL,_event_at=>now(),_tenant_id=>%L,_operation_id=>%L,_paige_message_id=>%L,_bounce_type=>%L,_reason=>%L))',
   'sg:bnc-19', 'sgb19', 'bounced', pg_temp.tn(1), pg_temp.op(19), pg_temp.msg(19), 'bounce', '550 no such user')) #>> '{}'
   ||'/'||pg_temp.jr('sg:bnc-19'),
  'processed/correlated:-:bounced_suppression_skipped', 'a recipient that normalises to empty is skipped and journalled as such');
SELECT is((SELECT count(*)::int FROM public.paige_suppressions WHERE address_normalized = '' OR (address_normalized IS NULL AND contact_id IS NULL)), 0,
  'no row keyed on an empty address was written');
SELECT is(pg_temp.ms(19), 'failed', 'and the email''s own outcome is still recorded');

-- ── 10. Campaigns honour a governed bounce on a +tagged address (review M-A) ────────────────────
-- Larch approves a campaign to every contact (PAIGE's managed sender) BEFORE contact 16's governed email bounces;
-- then the bounce arrives, then the send-time claim runs. Contact 16's address is sam+promo@ (held as sam@).
CREATE TEMP TABLE camp ON COMMIT DROP AS SELECT pg_temp.owner(format('SELECT public.email_campaign_create(%L,%L)', 'standard', 'Larch news')) AS made;
SELECT ok((SELECT made ? 'version_id' FROM camp)
      AND NOT (pg_temp.owner(format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, NULL, NULL, %L, NULL, %L, %L::jsonb))',
                 (SELECT made->>'version_id' FROM camp), 'Larch news', '<p>News from Larch Studio.</p>', '{"mode":"managed"}')) ? 'error')
      AND NOT (pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', (SELECT made->>'version_id' FROM camp))) ? 'error')
      AND NOT (pg_temp.owner(format('SELECT public.email_campaign_approve(%L::uuid)', (SELECT made->>'version_id' FROM camp))) ? 'error'),
  'a campaign to every Larch contact is drafted, filed and approved');
SELECT is((SELECT status FROM public.email_campaign_recipients WHERE version_id = (SELECT (made->>'version_id')::uuid FROM camp) AND client_id = pg_temp.cid(16)),
  'planned', 'contact 16 (sam+promo@) is planned — nothing held their address at approval');
SELECT is(pg_temp.ev('sg:bnc-16', 16, 'bounced', 'bounce', '550 no such user')||'/'||pg_temp.keyed(1,16),
  'processed/address:sam@bnc.tests.invalid', 'contact 16''s governed email bounces; the address is held folded, as sam@');
SELECT is((SELECT a.email||'/'||coalesce(a.ineligible,'eligible') FROM public._email_audience(pg_temp.tn(1), '{}'::jsonb, false, 'standard') a WHERE a.client_id = pg_temp.cid(16)),
  'sam+promo@bnc.tests.invalid/suppressed', 'the campaign audience reads the +tagged contact as suppressed');
CREATE TEMP TABLE claimed ON COMMIT DROP AS SELECT pg_temp.svc('SELECT public.email_campaign_dispatch_claim(100)') AS r;
SELECT is((SELECT status||'/'||coalesce(skip_reason,'-') FROM public.email_campaign_recipients
            WHERE version_id = (SELECT (made->>'version_id')::uuid FROM camp) AND client_id = pg_temp.cid(16)),
  'skipped/suppressed', 'the send-time claim skips the planned recipient as suppressed');
SELECT ok((SELECT r ? 'recipients' FROM claimed)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT r->'recipients' FROM claimed)) x WHERE x->>'client_id' = pg_temp.cid(16)::text)
      AND EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT r->'recipients' FROM claimed)) x WHERE x->>'client_id' = pg_temp.cid(8)::text),
  'and does not lease it (contact 8, not held, is leased)');

-- ── Totals ──────────────────────────────────────────────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM public.paige_suppressions s JOIN public.clients c ON c.id = s.contact_id
            WHERE s.tenant_id IN (pg_temp.tn(1), pg_temp.tn(2)) AND c.tenant_id IS DISTINCT FROM s.tenant_id), 0,
  'every contact-keyed row sits under the business that owns its contact');
SELECT is((SELECT string_agg(reason||'@'||coalesce(address_normalized,'contact'), ',' ORDER BY reason, address_normalized COLLATE "C")
             FROM public.paige_suppressions WHERE tenant_id = pg_temp.tn(1)),
  'bounce_hard@c1.bnc@tests.invalid,bounce_hard@c14.bnc@tests.invalid,bounce_hard@c17.bnc@tests.invalid,bounce_hard@c2.bnc@tests.invalid,bounce_hard@c3.bnc@tests.invalid,bounce_hard@pat@bnc.tests.invalid,bounce_hard@sam@bnc.tests.invalid,complaint@c12.bnc@tests.invalid,complaint@contact',
  'Larch holds exactly: bounces at c1, c2, c3, c14, c17, pat@ and sam@ (addresses), complaints from contact 7 and at c12');
SELECT is((SELECT string_agg(reason||'@'||coalesce(address_normalized,'contact'), ',') FROM public.paige_suppressions WHERE tenant_id = pg_temp.tn(2)),
  'bounce_hard@c1.bnc@tests.invalid', 'Wren holds exactly its own bounce');
SELECT is((SELECT count(*)::int FROM public.paige_suppressions WHERE tenant_id IN (pg_temp.tn(1), pg_temp.tn(2)) AND source <> 'webhook'), 0,
  'every row came from the webhook');

SELECT * FROM finish();
ROLLBACK;
