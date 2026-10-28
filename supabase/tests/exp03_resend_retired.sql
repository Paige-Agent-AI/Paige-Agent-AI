-- EXP03 — Resend retired; 'resend'-labelled email goes out through SendGrid (20271116200000), through the
-- real seams. Full replayed schema, actual caller roles, synthetic data only (test-tenant-* rows,
-- *.tests.invalid addresses; §63); everything rolled back. No provider is called: the governed business
-- email runs through prepare → claim → finalize, campaigns through the editor's writers and the
-- dispatcher's claim/record, and SendGrid's events through the one door, ingest_sendgrid_receipt, exactly
-- as handle-sendgrid-webhook calls it.
--   0. grants and §59 shape unchanged: the reconcile predicate and the resolver are no API role's, the
--      campaign and governed-reply appliers nobody's, ingest and admit service-only;
--   1. a 'resend' governed email whose outcome is unknown (or whose dispatch went stale) is NOT
--      reconcilable: the reconcile claim is not admitted, the result reads reconcilable=false, the
--      operation keeps its state and attempt count;
--   1b. SendGrid's own event settles a 'resend'-bound governed email exactly like a 'sendgrid' one: all
--      three claims + the recipient settle an unknown send (provider_accepted, settled_by_provider_event),
--      the next event correlates by the stored id, a bounce marks it failed, a forged tenant claim is
--      refused; a Gmail or SMTP binding is never touched by a SendGrid event, even with every claim;
--   2. a NEW approval of PAIGE's managed sender freezes provider 'sendgrid' and is metered under SendGrid;
--      its SendGrid events land on the recipient row (delivered; hard bounce and complaint suppress, a
--      blocked bounce does not), and a forged claim still changes nothing;
--   3. a managed campaign approved BEFORE this migration (frozen 'resend') is settled the same way, in
--      all three places the applier checks the provider: the main correlation, the no-X-Message-Id fill
--      in, and the outcome_unknown complaint;
--   4. a Resend-connector campaign is settled by SendGrid's events (it is sent by SendGrid now);
--   5. a campaign through a business's own Gmail connection is still provider_mismatch; a SendGrid lane
--      campaign still correlates.
BEGIN;
SELECT plan(74);

-- ── Seed ────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e03d0100-0000-4000-8000-000000000001','authenticated','authenticated','e03-rsret-1@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e03d0200-0000-4000-8000-000000000001','test-tenant-e03-rsret-birch','Birch Studio','active','standalone',NULL,'E03RB',9433001,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e03d0200-0000-4000-8000-000000000001','e03d0100-0000-4000-8000-000000000001','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e03d0200-0000-4000-8000-000000000001' WHERE user_id='e03d0100-0000-4000-8000-000000000001';
INSERT INTO public.tenant_legal_profile(tenant_id,legal_business_name,registered_address) VALUES
 ('e03d0200-0000-4000-8000-000000000001','Birch Studio LLC','5 Test Way, Springfield, ZZ 00000');
-- Birch: a Resend connection (01), its own Gmail mailbox (02), a SendGrid sender on a verified domain (03),
-- its own SMTP server (04).
INSERT INTO public.channel_connectors(id,tenant_id,channel_type,provider,from_name,from_address,status,active) VALUES
 ('e03d0900-0000-4000-8000-000000000001','e03d0200-0000-4000-8000-000000000001','email','resend','Birch Studio','hello@birch-rs.tests.invalid','active',true),
 ('e03d0900-0000-4000-8000-000000000002','e03d0200-0000-4000-8000-000000000001','email','gmail','Birch Studio','birch.owner@gm.tests.invalid','active',true),
 ('e03d0900-0000-4000-8000-000000000003','e03d0200-0000-4000-8000-000000000001','email','sendgrid','Birch Studio','news@birch.tests.invalid','active',true),
 ('e03d0900-0000-4000-8000-000000000004','e03d0200-0000-4000-8000-000000000001','email','smtp','Birch Studio','birch@smtp.tests.invalid','active',true);
INSERT INTO public.tenant_email_domains(id,tenant_id,domain,from_name,sendgrid_domain_id,sendgrid_status,sendgrid_verified_at) VALUES
 ('e03d0a00-0000-4000-8000-000000000001','e03d0200-0000-4000-8000-000000000001','birch.tests.invalid','Birch Studio','sg-dom-birch','verified',now());
-- Birch's contacts A..H (letter = last two id digits).
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,email,status)
SELECT ('e03d0300-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'e03d0200-0000-4000-8000-000000000001',
       'e03d0100-0000-4000-8000-000000000001', chr(64+n)||'ra','Test', lower(chr(64+n))||'.rsret@tests.invalid','active'
  FROM generate_series(1,8) n;

-- ── Helpers (as email_campaign_sendgrid_lane.sql) ───────────────────────────────────────────────
CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',
   CASE WHEN _actor IS NULL THEN jsonb_build_object('role',_role) ELSE jsonb_build_object('sub',_actor,'role',_role) END::text,true);
 IF _role='service_role' THEN SET LOCAL ROLE service_role; ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.owner(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e03d0100-0000-4000-8000-000000000001', _sql) $$;
CREATE FUNCTION pg_temp.svc(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(NULL, _sql, 'service_role') $$;
-- Drafted through the editor's own writers, filed, approved and fully leased. Returns {campaign_id, version_id}.
CREATE FUNCTION pg_temp.draft(_name text, _sender jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _made jsonb; _r jsonb;
BEGIN
 _made := pg_temp.owner(format('SELECT public.email_campaign_create(%L,%L)', 'standard', _name));
 IF _made->>'version_id' IS NULL THEN RAISE EXCEPTION 'create failed: %', _made; END IF;
 _r := pg_temp.owner(format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, NULL, NULL, %L, NULL, %L, %L::jsonb))',
        _made->>'version_id', _name, '<p>Hello from Birch Studio.</p>', _sender));
 IF _r ? 'error' THEN RAISE EXCEPTION 'draft failed: %', _r; END IF;
 _r := pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', _made->>'version_id'));
 IF _r ? 'error' THEN RAISE EXCEPTION 'request approval failed: %', _r; END IF;
 RETURN _made;
END $$;
CREATE FUNCTION pg_temp.approve_and_lease(_made jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 _r := pg_temp.owner(format('SELECT public.email_campaign_approve(%L::uuid)', _made->>'version_id'));
 IF _r ? 'error' THEN RAISE EXCEPTION 'approve failed: %', _r; END IF;
 _r := pg_temp.svc('SELECT public.email_campaign_dispatch_claim(25)');
 IF NOT _r ? 'recipients' THEN RAISE EXCEPTION 'claim failed: %', _r; END IF;
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.rid(_version uuid, _letter text) RETURNS uuid LANGUAGE sql AS $$
 SELECT r.id FROM public.email_campaign_recipients r
  WHERE r.version_id = _version AND chr(64 + right(r.client_id::text,2)::int) = _letter $$;
CREATE FUNCTION pg_temp.rec(_rid uuid, _outcome text, _sg text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT pg_temp.svc(format('SELECT to_jsonb(public.email_campaign_dispatch_record(%L::uuid, %L, %L))', _rid, _outcome, _sg)) #>> '{}' $$;
-- One SendGrid event through the door, as handle-sendgrid-webhook passes it.
CREATE FUNCTION pg_temp.ev(_receipt text, _sg text, _status text, _email text, _tenant text, _op text, _msg text,
                           _bounce text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT pg_temp.svc(format(
   'SELECT to_jsonb(public.ingest_sendgrid_receipt(_receipt_id=>%L,_message_id=>%L,_status=>%L,_email=>%L,_event_at=>now(),_tenant_id=>%L,_operation_id=>%L,_paige_message_id=>%L,_bounce_type=>%L,_reason=>NULL))',
   _receipt, _sg, _status, _email, _tenant, _op, _msg, _bounce)) #>> '{}' $$;
-- A correctly claimed event for recipient row _rid (letter's own address, this business, the row id twice).
CREATE FUNCTION pg_temp.evr(_receipt text, _sg text, _rid uuid, _letter text, _status text, _bounce text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT pg_temp.ev(_receipt, _sg, _status, lower(_letter)||'.rsret@tests.invalid',
   'e03d0200-0000-4000-8000-000000000001', _rid::text, _rid::text, _bounce) $$;
CREATE FUNCTION pg_temp.jr(_receipt text) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(correlation,'-')||':'||coalesce(correlation_reason,'-') FROM public.sendgrid_receipt_processing WHERE receipt_id = _receipt $$;
CREATE FUNCTION pg_temp.supp(_letter text, _reason text) RETURNS boolean LANGUAGE sql AS $$
 SELECT EXISTS (SELECT 1 FROM public.paige_suppressions WHERE tenant_id = 'e03d0200-0000-4000-8000-000000000001'
   AND contact_id = ('e03d0300-0000-4000-8000-0000000000'||lpad((ascii(_letter)-64)::text,2,'0'))::uuid AND reason = _reason) $$;

CREATE TEMP TABLE k(name text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON k TO authenticated, service_role;
CREATE FUNCTION pg_temp.k(_n text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM k WHERE name = _n $$;

-- ── 0. Grants and §59 shape, unchanged ──────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege(r, 'public._comms_email_reconcilable(jsonb)', 'EXECUTE'),
          'the reconcile predicate is not executable by '||r) FROM unnest(ARRAY['anon','authenticated']) r;
SELECT ok(has_function_privilege('service_role', 'public._comms_email_reconcilable(jsonb)', 'EXECUTE')
      AND (SELECT NOT prosecdef AND provolatile = 's' AND array_to_string(proconfig, ',') LIKE 'search_path=%'
             FROM pg_proc WHERE oid = 'public._comms_email_reconcilable(jsonb)'::regprocedure),
  'the reconcile predicate stays service-role, STABLE, not SECURITY DEFINER, search_path pinned');
SELECT ok(NOT has_function_privilege(r, 'public._email_resolve_sender(uuid,jsonb)', 'EXECUTE'),
          'the sender resolver is not executable by '||r) FROM unnest(ARRAY['anon','authenticated']) r;
SELECT ok(NOT has_function_privilege(r, 'public._sendgrid_apply_campaign_receipt(text,text,text,timestamp with time zone,text,text,text,text)', 'EXECUTE'),
          'the campaign receipt applier is not executable by '||r) FROM unnest(ARRAY['anon','authenticated','service_role']) r;
SELECT ok((SELECT bool_and(prosecdef AND array_to_string(proconfig, ',') LIKE 'search_path=%') FROM pg_proc WHERE oid IN (
    'public._email_resolve_sender(uuid,jsonb)'::regprocedure,
    'public._sendgrid_apply_campaign_receipt(text,text,text,timestamp with time zone,text,text,text,text)'::regprocedure)),
  'the resolver and the applier stay SECURITY DEFINER with a pinned search_path');
SELECT ok((SELECT bool_and(NOT has_function_privilege(r, 'public._sendgrid_apply_governed_receipt(text,text,text,timestamp with time zone,text,text,text,text,text)', 'EXECUTE'))
             FROM unnest(ARRAY['anon','authenticated','service_role']) r)
      AND (SELECT prosecdef AND array_to_string(proconfig, ',') LIKE 'search_path=%' FROM pg_proc
            WHERE oid = 'public._sendgrid_apply_governed_receipt(text,text,text,timestamp with time zone,text,text,text,text,text)'::regprocedure),
  'the governed-reply applier stays nobody''s, SECURITY DEFINER, search_path pinned');
SELECT ok(has_function_privilege('service_role', 'public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.ingest_sendgrid_receipt(text,text,text,text,timestamptz,text,text,text,text,text)', 'EXECUTE')
      AND has_function_privilege('service_role', 'public.email_campaign_sendgrid_admit(uuid,uuid,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.email_campaign_sendgrid_admit(uuid,uuid,text)', 'EXECUTE'),
  'ingest and the SendGrid admission stay service-role only');

-- ── 1. A 'resend' governed email of unknown outcome is not reconcilable ─────────────────────────
SELECT ok(NOT public._comms_email_reconcilable(jsonb_build_object('provider','resend','state','unknown','prepared_at',now())),
  'a fresh Resend unknown binding is not reconcilable');
SELECT ok(NOT public._comms_email_reconcilable(jsonb_build_object('provider','resend','state','dispatching',
    'prepared_at',now(),'claimed_at',now() - interval '10 minutes')),
  'a stale Resend dispatching binding is not reconcilable');
CREATE FUNCTION pg_temp.op(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e03d0f00-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid $$;
CREATE FUNCTION pg_temp.msg(n int) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(n)::text $$;
CREATE FUNCTION pg_temp.b(n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT meta->'comms_email_binding' FROM public.messages WHERE id=pg_temp.msg(n) $$;
-- Prepared through the governed door (Birch's Resend connection unless named), to contact A.
CREATE FUNCTION pg_temp.prep(n int, _conn text DEFAULT 'e03d0900-0000-4000-8000-000000000001',
                             _from text DEFAULT 'hello@birch-rs.tests.invalid') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.svc(format('SELECT public.prepare_comms_email_send(%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L::uuid,%L,%L,%L,%L,%L,%L::jsonb,%L::jsonb)',
  'e03d0100-0000-4000-8000-000000000001','e03d0200-0000-4000-8000-000000000001',pg_temp.op(n),'e03d0300-0000-4000-8000-000000000001',
  'a.rsret@tests.invalid',_conn,_from,'Note '||n,'Body '||n||'.','<p>Body '||n||'.</p>',
  encode(extensions.digest(convert_to('a.rsret@tests.invalid'||E'\n'||_conn||E'\n'||'Note '||n||E'\n'||'Body '||n||'.','UTF8'),'sha256'),'hex'),
  jsonb_build_object('action','comms.email_send','contact_id','e03d0300-0000-4000-8000-000000000001','connector_id',_conn,'subject','Note '||n,'body','Body '||n||'.'),
  jsonb_build_object('actor_user_id','e03d0100-0000-4000-8000-000000000001','tenant_id','e03d0200-0000-4000-8000-000000000001','tool','comms_send_email',
   'action','comms.email_send','approval_channel','operator_card','approved_fingerprint','0123456789abcdef','decision_receipt_recorded',true))) $$;
CREATE FUNCTION pg_temp.claim(n int, _reconcile boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.svc(format('SELECT public.claim_comms_email_send(%L::uuid,%L::uuid,%L)', pg_temp.msg(n), pg_temp.op(n), _reconcile)) $$;
SELECT ok(pg_temp.prep(1)->>'ok' = 'true' AND pg_temp.claim(1)->>'admitted' = 'true'
      AND pg_temp.svc(format('SELECT public.finalize_comms_email_send(%L::uuid,%L::uuid,%L,NULL,%L,1)', pg_temp.msg(1), pg_temp.op(1), 'unknown', 'provider_timeout'))->>'outcome' = 'unknown',
  'a governed email through the Resend connection is prepared, claimed and finalized unknown');
SELECT is(pg_temp.b(1)->>'provider'||'/'||(pg_temp.b(1)->>'state'), 'resend/unknown', 'its binding is a Resend operation of unknown outcome');
SELECT is(pg_temp.svc(format('SELECT public.read_comms_email_send_result(%L::uuid,%L::uuid,%L::uuid)',
  'e03d0100-0000-4000-8000-000000000001','e03d0200-0000-4000-8000-000000000001',pg_temp.op(1)))->>'reconcilable', 'false',
  'its result reads reconcilable = false');
SELECT is(pg_temp.claim(1, true)->>'admitted'||'/'||(pg_temp.claim(1, true)->>'state'), 'false/unknown',
  'a reconcile claim is not admitted, so send-message never re-dispatches it');
SELECT is(pg_temp.b(1)->>'state'||'/'||(pg_temp.b(1)->>'attempts'), 'unknown/1', 'the operation stays unknown on its first attempt');
-- A dispatch whose answer never came back (stale 'dispatching', > 120 s) is not re-claimed either.
SELECT ok(pg_temp.prep(2)->>'ok' = 'true' AND pg_temp.claim(2)->>'admitted' = 'true', 'a second governed email is claimed');
UPDATE public.messages SET meta = jsonb_set(meta, '{comms_email_binding,claimed_at}', to_jsonb(now() - interval '200 seconds')) WHERE id = pg_temp.msg(2);
SELECT is(pg_temp.claim(2, true)->>'admitted'||'/'||(pg_temp.b(2)->>'state')||'/'||(pg_temp.b(2)->>'attempts'), 'false/dispatching/1',
  'a stale Resend dispatch is not re-claimed through reconcile');

-- ── 1b. SendGrid's event settles a 'resend'-bound governed email (it was sent by SendGrid) ─────────
CREATE FUNCTION pg_temp.fin(n int, _outcome text, _pid text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT pg_temp.svc(format('SELECT public.finalize_comms_email_send(%L::uuid,%L::uuid,%L,%L,%L,1)', pg_temp.msg(n), pg_temp.op(n), _outcome, _pid,
   CASE WHEN _outcome = 'unknown' THEN 'provider_timeout' END))->>'outcome' $$;
-- A door event: all three claims send-message attaches (business, operation, message row), unless overridden.
CREATE FUNCTION pg_temp.evd(_receipt text, _sg text, n int, _status text, _tenant text DEFAULT 'e03d0200-0000-4000-8000-000000000001',
                            _bounce text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT pg_temp.ev(_receipt, _sg, _status, 'A.rsret@tests.invalid', _tenant, pg_temp.op(n)::text, pg_temp.msg(n)::text, _bounce) $$;
CREATE FUNCTION pg_temp.ms(n int) RETURNS text LANGUAGE sql AS $$ SELECT status FROM public.messages WHERE id = pg_temp.msg(n) $$;
SELECT ok(pg_temp.prep(3)->>'ok' = 'true' AND pg_temp.claim(3)->>'admitted' = 'true' AND pg_temp.fin(3, 'unknown') = 'unknown'
      AND pg_temp.b(3)->>'provider' = 'resend',
  'a Resend-bound governed email is finalized unknown');
SELECT is(pg_temp.evd('sg:rsret-d3', 'sgd3', 3, 'delivered')||'/'||pg_temp.jr('sg:rsret-d3'),
  'processed/correlated:settled_by_provider_event', 'SendGrid''s delivered event with all three claims settles it');
SELECT is(pg_temp.b(3)->>'state'||'/'||(pg_temp.b(3)->>'provider_message_id')||'/'||(pg_temp.b(3)->>'outcome_reason')||'/'||(pg_temp.b(3)->>'settled_from_state')
          ||'/'||pg_temp.ms(3),
  'provider_accepted/sgd3/settled_by_provider_event/unknown/delivered', 'the binding is provider_accepted with SendGrid''s id, and the email reads delivered');
SELECT is(pg_temp.evd('sg:rsret-d3-open', 'sgd3', 3, 'opened')||'/'||pg_temp.jr('sg:rsret-d3-open'),
  'processed/correlated:-', 'the next event correlates by the stored id');
SELECT ok(pg_temp.prep(4)->>'ok' = 'true' AND pg_temp.claim(4)->>'admitted' = 'true' AND pg_temp.fin(4, 'unknown') = 'unknown',
  'a second Resend-bound email is finalized unknown');
SELECT is(pg_temp.evd('sg:rsret-d4', 'sgd4', 4, 'bounced', _bounce=>'bounce')||'/'||pg_temp.jr('sg:rsret-d4')
          ||'/'||(pg_temp.b(4)->>'state')||'/'||(pg_temp.b(4)->>'delivery_state')||'/'||pg_temp.ms(4),
  'processed/correlated:settled_by_provider_event/provider_accepted/bounced/failed', 'a bounce settles it and marks it failed (never delivered)');
-- Since 20271120120003 a governed hard bounce also suppresses the ADDRESS for this business (no contact; proved in
-- full by exp03_governed_bounce_suppression.sql). Asserted here, then removed as a stated fixture step (the row is
-- not customer-held, so the delete guard admits it): sections 2–5 below send campaigns to contact A's address.
SELECT ok(EXISTS (SELECT 1 FROM public.paige_suppressions WHERE tenant_id = 'e03d0200-0000-4000-8000-000000000001'
            AND contact_id IS NULL AND address_normalized = 'a.rsret@tests.invalid' AND reason = 'bounce_hard' AND source = 'webhook'),
  'the governed hard bounce suppressed contact A''s address (20271120120003)');
DELETE FROM public.paige_suppressions WHERE tenant_id = 'e03d0200-0000-4000-8000-000000000001'
   AND contact_id IS NULL AND address_normalized = 'a.rsret@tests.invalid' AND reason = 'bounce_hard' AND source = 'webhook';
SELECT ok(pg_temp.prep(5)->>'ok' = 'true' AND pg_temp.claim(5)->>'admitted' = 'true' AND pg_temp.fin(5, 'unknown') = 'unknown',
  'a third Resend-bound email is finalized unknown');
SELECT is(pg_temp.evd('sg:rsret-d5', 'sgd5', 5, 'delivered', 'e03f0200-0000-4000-8000-000000000002')||'/'||pg_temp.jr('sg:rsret-d5')
          ||'/'||(pg_temp.b(5)->>'state')||'/'||coalesce(pg_temp.b(5)->>'provider_message_id','none'),
  'processed/uncorrelated:tenant_mismatch/unknown/none', 'another business''s claim is refused and settles nothing');
SELECT ok(pg_temp.prep(6)->>'ok' = 'true' AND pg_temp.claim(6)->>'admitted' = 'true' AND pg_temp.fin(6, 'provider_accepted', 'sgd6') = 'provider_accepted',
  'a fourth Resend-bound email is accepted with SendGrid''s id');
SELECT is(pg_temp.evd('sg:rsret-d6', 'sgd6', 6, 'delivered')||'/'||pg_temp.jr('sg:rsret-d6')||'/'||pg_temp.ms(6),
  'processed/correlated:-/delivered', 'its delivered event correlates by that id and records the delivery');
-- A Gmail and an SMTP binding: SendGrid never sent them, so its events never touch them.
SELECT ok(pg_temp.prep(7, 'e03d0900-0000-4000-8000-000000000002', 'birch.owner@gm.tests.invalid')->>'ok' = 'true'
      AND pg_temp.claim(7)->>'admitted' = 'true' AND pg_temp.fin(7, 'unknown') = 'unknown' AND pg_temp.b(7)->>'provider' = 'gmail'
      AND pg_temp.prep(8, 'e03d0900-0000-4000-8000-000000000004', 'birch@smtp.tests.invalid')->>'ok' = 'true'
      AND pg_temp.claim(8)->>'admitted' = 'true' AND pg_temp.fin(8, 'unknown') = 'unknown' AND pg_temp.b(8)->>'provider' = 'smtp',
  'a Gmail-bound and an SMTP-bound email are finalized unknown');
INSERT INTO k SELECT 'gs', md5(string_agg(id::text||status||meta::text||coalesce(provider_message_id,''),'|' ORDER BY id))
  FROM public.messages WHERE id IN (pg_temp.msg(7), pg_temp.msg(8));
SELECT is(pg_temp.evd('sg:rsret-d7', 'sgd7', 7, 'delivered')||'/'||pg_temp.jr('sg:rsret-d7')||' '
          ||pg_temp.evd('sg:rsret-d8', 'sgd8', 8, 'bounced', _bounce=>'bounce')||'/'||pg_temp.jr('sg:rsret-d8'),
  'processed/uncorrelated:provider_mismatch processed/uncorrelated:provider_mismatch',
  'SendGrid events with every claim are refused for the Gmail and SMTP sends');
SELECT is((SELECT md5(string_agg(id::text||status||meta::text||coalesce(provider_message_id,''),'|' ORDER BY id))
             FROM public.messages WHERE id IN (pg_temp.msg(7), pg_temp.msg(8))), pg_temp.k('gs'),
  'and both are byte-for-byte as they were');

-- ── 2. A new managed approval is SendGrid's ─────────────────────────────────────────────────────
INSERT INTO k SELECT 'm', pg_temp.draft('Birch managed', '{"mode":"managed"}')::text;
INSERT INTO k SELECT 'mv', (pg_temp.k('m')::jsonb)->>'version_id';
SELECT is((SELECT sender_snapshot->>'mode'||'/'||(sender_snapshot->>'provider') FROM public.email_campaign_versions WHERE id = pg_temp.k('mv')::uuid),
  'managed/sendgrid', 'PAIGE''s managed sender is frozen as provider sendgrid');
SELECT ok(pg_temp.approve_and_lease(pg_temp.k('m')::jsonb) ? 'recipients', 'it is approved and leased');
SELECT is((SELECT count(*)::int FROM public.email_campaign_recipients WHERE version_id = pg_temp.k('mv')::uuid AND status = 'sending' AND route = 'managed'), 8,
  'all eight contacts are being handed over on the managed route');
INSERT INTO k SELECT 'm'||l, pg_temp.rid(pg_temp.k('mv')::uuid, l)::text FROM unnest(ARRAY['A','B','C','D','E']) l;
SELECT is(pg_temp.rec(pg_temp.k('m'||l)::uuid, 'sent', 'sgm'||l), 'sent', 'managed recipient '||l||' recorded sent') FROM unnest(ARRAY['A','B','C','D','E']) l;
SELECT is((SELECT provider FROM public.platform_metered_events WHERE idempotency_key = 'email_campaign_recipient:'||pg_temp.k('mA')),
  'sendgrid', 'a new managed send is metered under SendGrid');
SELECT is(pg_temp.evr('sg:rsret-m-a', 'sgmA', pg_temp.k('mA')::uuid, 'A', 'delivered')||'/'||pg_temp.jr('sg:rsret-m-a'),
  'processed/correlated:-', 'a delivered event for the managed send correlates');
SELECT ok((SELECT delivered_at IS NOT NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('mA')::uuid), 'and records the delivery');
SELECT is(pg_temp.evr('sg:rsret-m-b', 'sgmB', pg_temp.k('mB')::uuid, 'B', 'bounced', 'bounce'), 'processed', 'B''s hard bounce is processed');
SELECT ok((SELECT bounced_at IS NOT NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('mB')::uuid) AND pg_temp.supp('B', 'bounce_hard'),
  'a hard bounce on a managed send is recorded and suppresses the contact');
SELECT is(pg_temp.evr('sg:rsret-m-c', 'sgmC', pg_temp.k('mC')::uuid, 'C', 'bounced', 'blocked'), 'processed', 'C''s blocked bounce is processed');
SELECT ok((SELECT bounced_at IS NOT NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('mC')::uuid)
      AND NOT EXISTS (SELECT 1 FROM public.paige_suppressions WHERE contact_id = 'e03d0300-0000-4000-8000-000000000003'),
  'a blocked bounce counts as bounced and suppresses nobody');
SELECT is(pg_temp.evr('sg:rsret-m-d', 'sgmD', pg_temp.k('mD')::uuid, 'D', 'complained'), 'processed', 'D''s spam report is processed');
SELECT ok((SELECT complained_at IS NOT NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('mD')::uuid) AND pg_temp.supp('D', 'complaint'),
  'a complaint on a managed send is recorded and suppresses the contact');
SELECT is(pg_temp.ev('sg:rsret-m-e-forged', 'sgmE', 'delivered', 'e.rsret@tests.invalid', 'e03f0200-0000-4000-8000-000000000002',
  pg_temp.k('mE'), pg_temp.k('mE'))||'/'||pg_temp.jr('sg:rsret-m-e-forged'),
  'processed/uncorrelated:tenant_mismatch', 'another business''s claim on a managed send changes nothing');
SELECT ok((SELECT delivered_at IS NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('mE')::uuid), 'E is not delivered by it');

-- ── 3. A managed campaign approved BEFORE this migration (frozen 'resend') ──────────────────────
-- Fixture, stated (§13): the version is filed through the real writers (which now freeze 'sendgrid'), then
-- its frozen provider is set to 'resend' exactly as every pre-migration managed approval carries it. The
-- frozen-version guard is a trigger, so the write is made with triggers off for that one statement.
INSERT INTO k SELECT 'r', pg_temp.draft('Birch managed, approved before', '{"mode":"managed"}')::text;
INSERT INTO k SELECT 'rv', (pg_temp.k('r')::jsonb)->>'version_id';
SET LOCAL session_replication_role = replica;
UPDATE public.email_campaign_versions SET sender_snapshot = jsonb_set(sender_snapshot, '{provider}', '"resend"') WHERE id = pg_temp.k('rv')::uuid;
SET LOCAL session_replication_role = origin;
SELECT ok(pg_temp.approve_and_lease(pg_temp.k('r')::jsonb) ? 'recipients'
      AND (SELECT sender_snapshot->>'mode'||'/'||(sender_snapshot->>'provider') FROM public.email_campaign_versions WHERE id = pg_temp.k('rv')::uuid) = 'managed/resend',
  'a managed campaign frozen ''resend'' still approves and leases (the dispatcher never compares the provider)');
INSERT INTO k SELECT 'r'||l, pg_temp.rid(pg_temp.k('rv')::uuid, l)::text FROM unnest(ARRAY['A','E','F','G','H']) l;
SELECT is(pg_temp.rec(pg_temp.k('rA')::uuid, 'sent', 'sgrA')||pg_temp.rec(pg_temp.k('rF')::uuid, 'sent', 'sgrF')
        ||pg_temp.rec(pg_temp.k('rE')::uuid, 'sent')||pg_temp.rec(pg_temp.k('rH')::uuid, 'outcome_unknown'),
  'sentsentsentoutcome_unknown', 'A and F sent with ids, E sent with none, H unknown');
SELECT is((SELECT provider FROM public.platform_metered_events WHERE idempotency_key = 'email_campaign_recipient:'||pg_temp.k('rA')),
  'resend', 'an older approval keeps metering under its frozen label (labels are not rewritten)');
SELECT is(pg_temp.evr('sg:rsret-r-a', 'sgrA', pg_temp.k('rA')::uuid, 'A', 'delivered')||'/'||pg_temp.jr('sg:rsret-r-a'),
  'processed/correlated:-', 'a delivered event for a ''resend''-frozen managed send correlates');
SELECT ok((SELECT delivered_at IS NOT NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('rA')::uuid), 'and records the delivery');
SELECT is(pg_temp.evr('sg:rsret-r-f', 'sgrF', pg_temp.k('rF')::uuid, 'F', 'bounced', 'bounce'), 'processed', 'F''s hard bounce is processed');
SELECT ok(pg_temp.supp('F', 'bounce_hard'), 'and suppresses F');
SELECT is(pg_temp.evr('sg:rsret-r-e', 'sgrE', pg_temp.k('rE')::uuid, 'E', 'delivered')||'/'||pg_temp.jr('sg:rsret-r-e'),
  'processed/correlated:-', 'E''s event (no X-Message-Id recorded) correlates by its three claims and address');
SELECT is((SELECT provider_message_id||'/'||(delivered_at IS NOT NULL) FROM public.email_campaign_recipients WHERE id = pg_temp.k('rE')::uuid),
  'sgrE/true', 'and supplies E''s provider id and records the delivery');
SELECT is(pg_temp.evr('sg:rsret-r-h', 'sgrH', pg_temp.k('rH')::uuid, 'H', 'complained')||'/'||pg_temp.jr('sg:rsret-r-h'),
  'processed/correlated:recipient_outcome_unknown', 'a spam report about H''s unknown send is recognised');
SELECT ok(pg_temp.supp('H', 'complaint')
      AND (SELECT status = 'outcome_unknown' AND complained_at IS NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('rH')::uuid),
  'it suppresses H and leaves the unknown send as it was');

-- ── 4. A Resend-connector campaign is settled by SendGrid ───────────────────────────────────────
INSERT INTO k SELECT 'c', pg_temp.draft('Birch via Resend connection', '{"mode":"connector","connector_id":"e03d0900-0000-4000-8000-000000000001"}')::text;
INSERT INTO k SELECT 'cv', (pg_temp.k('c')::jsonb)->>'version_id';
SELECT ok(pg_temp.approve_and_lease(pg_temp.k('c')::jsonb) ? 'recipients'
      AND (SELECT sender_snapshot->>'mode'||'/'||(sender_snapshot->>'provider') FROM public.email_campaign_versions WHERE id = pg_temp.k('cv')::uuid) = 'connector/resend',
  'a Resend-connector campaign keeps its connection''s label and is approved and leased');
INSERT INTO k SELECT 'c'||l, pg_temp.rid(pg_temp.k('cv')::uuid, l)::text FROM unnest(ARRAY['A','C']) l;
SELECT is(pg_temp.rec(pg_temp.k('cA')::uuid, 'sent', 'sgcA')||pg_temp.rec(pg_temp.k('cC')::uuid, 'sent', 'sgcC'), 'sentsent', 'A and C recorded sent');
SELECT is(pg_temp.evr('sg:rsret-c-a', 'sgcA', pg_temp.k('cA')::uuid, 'A', 'delivered')||'/'||pg_temp.jr('sg:rsret-c-a'),
  'processed/correlated:-', 'a delivered event for a Resend-connector send correlates');
SELECT is(pg_temp.evr('sg:rsret-c-c', 'sgcC', pg_temp.k('cC')::uuid, 'C', 'complained'), 'processed', 'C''s spam report is processed');
SELECT ok((SELECT complained_at IS NOT NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('cC')::uuid) AND pg_temp.supp('C', 'complaint'),
  'and suppresses C');

-- ── 5. Other providers unchanged ────────────────────────────────────────────────────────────────
INSERT INTO k SELECT 'g', pg_temp.draft('Birch via Gmail', '{"mode":"connector","connector_id":"e03d0900-0000-4000-8000-000000000002"}')::text;
SELECT ok(pg_temp.approve_and_lease(pg_temp.k('g')::jsonb) ? 'recipients', 'a Gmail-connector campaign is approved and leased');
INSERT INTO k SELECT 'gA', pg_temp.rid(((pg_temp.k('g')::jsonb)->>'version_id')::uuid, 'A')::text;
SELECT is(pg_temp.rec(pg_temp.k('gA')::uuid, 'sent', 'gmx-a')||'/'||pg_temp.evr('sg:rsret-g-a', 'gmx-a', pg_temp.k('gA')::uuid, 'A', 'bounced', 'bounce')
          ||'/'||pg_temp.jr('sg:rsret-g-a'),
  'sent/processed/uncorrelated:provider_mismatch', 'a send through the business''s own Gmail is still not SendGrid''s to update');
SELECT ok((SELECT bounced_at IS NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('gA')::uuid) AND NOT pg_temp.supp('A', 'bounce_hard'),
  'and nothing about A changed');
INSERT INTO k SELECT 's', pg_temp.draft('Birch via SendGrid', '{"mode":"connector","connector_id":"e03d0900-0000-4000-8000-000000000003"}')::text;
SELECT ok(pg_temp.approve_and_lease(pg_temp.k('s')::jsonb) ? 'recipients', 'a SendGrid-lane campaign is approved and leased');
INSERT INTO k SELECT 'sA', pg_temp.rid(((pg_temp.k('s')::jsonb)->>'version_id')::uuid, 'A')::text;
SELECT is(pg_temp.rec(pg_temp.k('sA')::uuid, 'sent', 'sgsA')||'/'||pg_temp.evr('sg:rsret-s-a', 'sgsA', pg_temp.k('sA')::uuid, 'A', 'delivered')
          ||'/'||pg_temp.jr('sg:rsret-s-a'),
  'sent/processed/correlated:-', 'the SendGrid lane still correlates');

SELECT * FROM finish();
ROLLBACK;
