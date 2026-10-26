-- EXP03 — the SendGrid lane for approved marketing campaigns (20271116020000), through the real seams.
-- Full replayed schema, actual caller roles, synthetic data only (test-tenant-* rows, *.tests.invalid
-- addresses; §63); everything rolled back. No provider is called: send-message's admission question is
-- the service-only email_campaign_sendgrid_admit, and SendGrid's events enter through the one door,
-- ingest_sendgrid_receipt, exactly as handle-sendgrid-webhook calls it.
--   0. who may call what: admit and ingest are service-only; the campaign applier is nobody's;
--   1. a SendGrid sender must be verified FOR THIS BUSINESS before a campaign can be filed with it;
--      verified, it is PAIGE-paid (route managed) and frozen with provider 'sendgrid';
--   2. admit says yes only for the leased recipient, its own address, the approved connector, still
--      verified; every other shape is refused with a reason;
--   3. a sent campaign email is metered under SendGrid, not Resend;
--   4. receipts land on the recipient row (delivered / opened / clicked / bounced / complained), first
--      time wins, a redelivery is a duplicate; hard bounce and complaint suppress, a blocked bounce does
--      not; forged, missing or mismatched claims change nothing; an early event is redelivered; a
--      Resend-sent recipient is never touched by a SendGrid event.
BEGIN;
SELECT plan(70);

-- ── Seed ────────────────────────────────────────────────────────────────────────────────────────
-- Users: 1 owner of Cedar, 2 owner of Dune.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data)
SELECT ('e03f0100-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'authenticated','authenticated',
       'e03-sglane-'||n||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'
  FROM generate_series(1,2) n;
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e03f0200-0000-4000-8000-000000000001','test-tenant-e03-sglane-cedar','Cedar Studio','active','standalone',NULL,'E03SC',9432001,'{}'),
 ('e03f0200-0000-4000-8000-000000000002','test-tenant-e03-sglane-dune','Dune Studio','active','standalone',NULL,'E03SD',9432002,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e03f0200-0000-4000-8000-000000000001','e03f0100-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e03f0200-0000-4000-8000-000000000002','e03f0100-0000-4000-8000-000000000002','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e03f0200-0000-4000-8000-000000000001' WHERE user_id='e03f0100-0000-4000-8000-000000000001';
UPDATE public.profiles SET active_tenant_id='e03f0200-0000-4000-8000-000000000002' WHERE user_id='e03f0100-0000-4000-8000-000000000002';
INSERT INTO public.tenant_legal_profile(tenant_id,legal_business_name,registered_address) VALUES
 ('e03f0200-0000-4000-8000-000000000001','Cedar Studio LLC','3 Test Way, Springfield, ZZ 00000'),
 ('e03f0200-0000-4000-8000-000000000002','Dune Studio LLC','4 Test Way, Springfield, ZZ 00000');
-- Cedar: a SendGrid sender (01) and a Resend sender (02). Dune: its own SendGrid sender (03).
-- A non-JWT session may create sendgrid connectors (guard_channel_connector_sendgrid_writer, 000250).
INSERT INTO public.channel_connectors(id,tenant_id,channel_type,provider,from_name,from_address,status,active) VALUES
 ('e03f0900-0000-4000-8000-000000000001','e03f0200-0000-4000-8000-000000000001','email','sendgrid','Cedar Studio','news@cedar.tests.invalid','active',true),
 ('e03f0900-0000-4000-8000-000000000002','e03f0200-0000-4000-8000-000000000001','email','resend','Cedar Studio','hello@cedar-rs.tests.invalid','active',true),
 ('e03f0900-0000-4000-8000-000000000003','e03f0200-0000-4000-8000-000000000002','email','sendgrid','Dune Studio','news@dune.tests.invalid','active',true);
-- Cedar's domain row, NOT yet verified in SendGrid.
INSERT INTO public.tenant_email_domains(id,tenant_id,domain,from_name) VALUES
 ('e03f0a00-0000-4000-8000-000000000001','e03f0200-0000-4000-8000-000000000001','cedar.tests.invalid','Cedar Studio'),
 ('e03f0a00-0000-4000-8000-000000000003','e03f0200-0000-4000-8000-000000000002','dune.tests.invalid','Dune Studio');
-- Cedar's contacts A..E (letter = last two id digits).
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,email,status)
SELECT ('e03f0300-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'e03f0200-0000-4000-8000-000000000001',
       'e03f0100-0000-4000-8000-000000000001', chr(64+n)||'ra','Test', lower(chr(64+n))||'.sglane@tests.invalid','active'
  FROM generate_series(1,5) n;

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────
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
 $$ SELECT pg_temp.as_user('e03f0100-0000-4000-8000-000000000001', _sql) $$;
CREATE FUNCTION pg_temp.svc(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(NULL, _sql, 'service_role') $$;
-- A campaign drafted through the editor's own writers with the given sender. Returns {campaign_id, version_id}.
CREATE FUNCTION pg_temp.draft(_name text, _sender jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _made jsonb; _r jsonb;
BEGIN
 _made := pg_temp.owner(format('SELECT public.email_campaign_create(%L,%L)', 'standard', _name));
 IF _made->>'version_id' IS NULL THEN RAISE EXCEPTION 'create failed: %', _made; END IF;
 _r := pg_temp.owner(format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, NULL, NULL, %L, NULL, %L, %L::jsonb))',
        _made->>'version_id', _name, '<p>Hello from Cedar Studio.</p>', _sender));
 IF _r ? 'error' THEN RAISE EXCEPTION 'draft failed: %', _r; END IF;
 RETURN _made;
END $$;
CREATE FUNCTION pg_temp.rid(_version uuid, _letter text) RETURNS uuid LANGUAGE sql AS $$
 SELECT r.id FROM public.email_campaign_recipients r
  WHERE r.version_id = _version AND chr(64 + right(r.client_id::text,2)::int) = _letter $$;
-- One SendGrid event through the door, as handle-sendgrid-webhook passes it.
CREATE FUNCTION pg_temp.ev(_receipt text, _sg text, _status text, _email text, _tenant text, _op text, _msg text,
                           _bounce text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT pg_temp.svc(format(
   'SELECT to_jsonb(public.ingest_sendgrid_receipt(_receipt_id=>%L,_message_id=>%L,_status=>%L,_email=>%L,_event_at=>now(),_tenant_id=>%L,_operation_id=>%L,_paige_message_id=>%L,_bounce_type=>%L,_reason=>NULL))',
   _receipt, _sg, _status, _email, _tenant, _op, _msg, _bounce)) #>> '{}' $$;
CREATE FUNCTION pg_temp.jr(_receipt text) RETURNS text LANGUAGE sql AS $$
 SELECT coalesce(correlation,'-')||':'||coalesce(correlation_reason,'-') FROM public.sendgrid_receipt_processing WHERE receipt_id = _receipt $$;

CREATE TEMP TABLE k(name text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON k TO authenticated, service_role;
CREATE FUNCTION pg_temp.k(_n text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM k WHERE name = _n $$;

-- ── 0. Who may call what ────────────────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege(r, 'public.email_campaign_sendgrid_admit(uuid,uuid,text)', 'EXECUTE'),
          'admit is not executable by '||r) FROM unnest(ARRAY['anon','authenticated']) r;
SELECT ok(has_function_privilege('service_role', 'public.email_campaign_sendgrid_admit(uuid,uuid,text)', 'EXECUTE'),
          'admit is executable by the service role');
SELECT ok(NOT has_function_privilege(r, 'public._sendgrid_apply_campaign_receipt(text,text,text,timestamp with time zone,text,text,text,text)', 'EXECUTE'),
          'the campaign receipt applier is not executable by '||r) FROM unnest(ARRAY['anon','authenticated','service_role']) r;

-- ── 1. A SendGrid sender must be verified for this business ─────────────────────────────────────
INSERT INTO k SELECT 'sg', pg_temp.draft('Cedar news', '{"mode":"connector","connector_id":"e03f0900-0000-4000-8000-000000000001"}')::text;
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', (pg_temp.k('sg')::jsonb)->>'version_id'))->>'error',
  'sender_needs_attention', 'an unverified SendGrid sender cannot be filed for approval');
-- Dune verifies ITS domain; that never verifies Cedar's.
UPDATE public.tenant_email_domains SET sendgrid_domain_id='sg-dom-dune', sendgrid_status='verified', sendgrid_verified_at=now()
 WHERE id='e03f0a00-0000-4000-8000-000000000003';
SELECT is(public._email_resolve_sender('e03f0200-0000-4000-8000-000000000001',
  '{"mode":"connector","connector_id":"e03f0900-0000-4000-8000-000000000001"}')->>'reason', 'sender_needs_attention',
  'another business verifying its own domain does not verify this one');
UPDATE public.tenant_email_domains SET sendgrid_domain_id='sg-dom-cedar', sendgrid_status='verified', sendgrid_verified_at=now()
 WHERE id='e03f0a00-0000-4000-8000-000000000001';
SELECT is((pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', (pg_temp.k('sg')::jsonb)->>'version_id'))->>'recipients'),
  '5', 'verified for this business, the campaign files with all five contacts');
SELECT is((SELECT sender_snapshot->>'provider'||'/'||(sender_snapshot->>'platform_funded') FROM public.email_campaign_versions
            WHERE id = ((pg_temp.k('sg')::jsonb)->>'version_id')::uuid), 'sendgrid/true',
  'the frozen sender is SendGrid and PAIGE-paid');
SELECT ok((SELECT cost_bound_usd > 0 FROM public.email_campaign_versions WHERE id = ((pg_temp.k('sg')::jsonb)->>'version_id')::uuid),
  'a PAIGE-paid sender carries a cost bound');
SELECT ok(NOT (pg_temp.owner(format('SELECT public.email_campaign_approve(%L::uuid)', (pg_temp.k('sg')::jsonb)->>'version_id')) ? 'error'),
  'the owner approves it');

-- ── 2. Admit ────────────────────────────────────────────────────────────────────────────────────
SELECT ok((SELECT count(*) FROM jsonb_array_elements(pg_temp.svc('SELECT public.email_campaign_dispatch_claim(2)')->'recipients')) = 2,
  'the dispatcher leases two of the five');
INSERT INTO k SELECT 'v', (pg_temp.k('sg')::jsonb)->>'version_id';
INSERT INTO k SELECT 'leased', (SELECT r.id::text FROM public.email_campaign_recipients r
  WHERE r.version_id = pg_temp.k('v')::uuid AND r.status = 'sending' ORDER BY r.id LIMIT 1);
INSERT INTO k SELECT 'leased_email', (SELECT email FROM public.email_campaign_recipients WHERE id = pg_temp.k('leased')::uuid);
INSERT INTO k SELECT 'planned', (SELECT r.id::text FROM public.email_campaign_recipients r
  WHERE r.version_id = pg_temp.k('v')::uuid AND r.status = 'planned' ORDER BY r.id LIMIT 1);
CREATE FUNCTION pg_temp.admit(_rid text, _conn text, _to text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.svc(format('SELECT public.email_campaign_sendgrid_admit(%L::uuid, %L::uuid, %L)', _rid, _conn, _to)) $$;
SELECT is(pg_temp.admit(pg_temp.k('leased'), 'e03f0900-0000-4000-8000-000000000001', upper(pg_temp.k('leased_email')))->>'ok', 'true',
  'the leased recipient, its own address, the approved connector: admitted');
SELECT is(pg_temp.admit(pg_temp.k('leased'), 'e03f0900-0000-4000-8000-000000000001', 'someone.else@tests.invalid')->>'reason',
  'recipient_changed', 'another address is refused');
SELECT is(pg_temp.admit(pg_temp.k('leased'), 'e03f0900-0000-4000-8000-000000000003', pg_temp.k('leased_email'))->>'reason',
  'sender_not_approved', 'another business''s SendGrid connector is refused');
SELECT is(pg_temp.admit(pg_temp.k('leased'), 'e03f0900-0000-4000-8000-000000000002', pg_temp.k('leased_email'))->>'reason',
  'sender_not_approved', 'a connector other than the approved one is refused');
SELECT is(pg_temp.admit(pg_temp.k('planned'), 'e03f0900-0000-4000-8000-000000000001',
  (SELECT email FROM public.email_campaign_recipients WHERE id = pg_temp.k('planned')::uuid))->>'reason',
  'recipient_not_leased', 'a recipient the dispatcher has not leased is refused');
UPDATE public.tenant_email_domains SET sendgrid_status = 'pending' WHERE id='e03f0a00-0000-4000-8000-000000000001';
SELECT is(pg_temp.admit(pg_temp.k('leased'), 'e03f0900-0000-4000-8000-000000000001', pg_temp.k('leased_email'))->>'reason',
  'sender_unverified', 'verification lost after approval: refused at hand-off');
UPDATE public.tenant_email_domains SET sendgrid_status = 'verified' WHERE id='e03f0a00-0000-4000-8000-000000000001';
SELECT is(pg_temp.as_user('e03f0100-0000-4000-8000-000000000001',
  format('SELECT public.email_campaign_sendgrid_admit(%L::uuid, %L::uuid, %L)', pg_temp.k('leased'), 'e03f0900-0000-4000-8000-000000000001', pg_temp.k('leased_email')))->>'sqlstate',
  '42501', 'a signed-in caller cannot ask');

-- ── 3. Metered under SendGrid ───────────────────────────────────────────────────────────────────
-- Lease everyone (the 500/day cap allows it), then record the sends with SendGrid X-Message-Ids.
SELECT ok(pg_temp.svc('SELECT public.email_campaign_dispatch_claim(25)') ? 'recipients', 'the rest are leased');
SELECT is((SELECT count(*)::int FROM public.email_campaign_recipients WHERE version_id = pg_temp.k('v')::uuid AND status = 'sending'), 5,
  'all five are being handed over');
INSERT INTO k SELECT 'r'||l, pg_temp.rid(pg_temp.k('v')::uuid, l)::text FROM unnest(ARRAY['A','B','C','D','E']) l;
SELECT is(pg_temp.svc(format('SELECT to_jsonb(public.email_campaign_dispatch_record(%L::uuid, %L, %L))', pg_temp.k('r'||l), 'sent', 'sgx'||l)) #>> '{}',
  'sent', 'recipient '||l||' recorded sent') FROM unnest(ARRAY['A','B','C','D']) l;
SELECT is((SELECT provider FROM public.platform_metered_events WHERE idempotency_key = 'email_campaign_recipient:'||pg_temp.k('rA')),
  'sendgrid', 'the sent email is metered under SendGrid');

-- ── 4. Receipts ─────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.evr(_receipt text, _letter text, _status text, _bounce text DEFAULT NULL) RETURNS text LANGUAGE sql AS $$
 SELECT pg_temp.ev(_receipt, 'sgx'||_letter, _status, lower(_letter)||'.sglane@tests.invalid',
   'e03f0200-0000-4000-8000-000000000001', pg_temp.k('r'||_letter), pg_temp.k('r'||_letter), _bounce) $$;
SELECT is(pg_temp.evr('sg:lane-a-delivered', 'A', 'delivered'), 'processed', 'A''s delivered event is processed');
SELECT ok((SELECT delivered_at IS NOT NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('rA')::uuid), 'A is delivered');
SELECT is(pg_temp.jr('sg:lane-a-delivered'), 'correlated:-', 'the journal says correlated');
SELECT is((SELECT correlated_campaign_recipient_id::text FROM public.sendgrid_receipt_processing WHERE receipt_id='sg:lane-a-delivered'),
  pg_temp.k('rA'), 'the journal names the recipient row');
INSERT INTO k SELECT 'a_at', (SELECT delivered_at::text FROM public.email_campaign_recipients WHERE id = pg_temp.k('rA')::uuid);
SELECT is(pg_temp.evr('sg:lane-a-delivered', 'A', 'delivered'), 'duplicate', 'a redelivery is a duplicate');
SELECT is(pg_temp.evr('sg:lane-a-delivered-2', 'A', 'delivered'), 'processed', 'a second delivered event is processed');
SELECT is((SELECT delivered_at::text FROM public.email_campaign_recipients WHERE id = pg_temp.k('rA')::uuid), pg_temp.k('a_at'),
  'and never moves the first delivery time');
SELECT is(pg_temp.evr('sg:lane-a-open', 'A', 'opened')||pg_temp.evr('sg:lane-a-click', 'A', 'clicked'), 'processedprocessed', 'open and click are processed');
SELECT ok((SELECT opened_at IS NOT NULL AND clicked_at IS NOT NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('rA')::uuid),
  'A is opened and clicked');

-- Forged, missing and mismatched claims change nothing.
SELECT is(pg_temp.ev('sg:lane-b-forged', 'sgxB', 'delivered', 'b.sglane@tests.invalid',
  'e03f0200-0000-4000-8000-000000000002', pg_temp.k('rB'), pg_temp.k('rB'))||'/'||pg_temp.jr('sg:lane-b-forged'),
  'processed/uncorrelated:tenant_mismatch', 'another business''s claim on B is refused');
SELECT is(pg_temp.ev('sg:lane-b-noclaims', 'sgxB', 'delivered', 'b.sglane@tests.invalid', NULL, NULL, NULL)||'/'||pg_temp.jr('sg:lane-b-noclaims'),
  'processed/uncorrelated:claims_missing', 'an event without the claims is refused');
SELECT is(pg_temp.ev('sg:lane-b-other', 'sgxB', 'delivered', 'b.sglane@tests.invalid',
  'e03f0200-0000-4000-8000-000000000001', pg_temp.k('rA'), pg_temp.k('rA'))||'/'||pg_temp.jr('sg:lane-b-other'),
  'processed/uncorrelated:operation_mismatch', 'claims naming another recipient are refused');
SELECT is(pg_temp.ev('sg:lane-b-addr', 'sgxB', 'delivered', 'nobody@tests.invalid',
  'e03f0200-0000-4000-8000-000000000001', pg_temp.k('rB'), pg_temp.k('rB'))||'/'||pg_temp.jr('sg:lane-b-addr'),
  'processed/uncorrelated:recipient_mismatch', 'an event for another address is refused');
SELECT ok((SELECT delivered_at IS NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('rB')::uuid), 'none of them delivered B');

-- Bounces and complaints.
SELECT is(pg_temp.evr('sg:lane-b-blocked', 'B', 'bounced', 'blocked'), 'processed', 'B''s blocked bounce is processed');
SELECT ok((SELECT bounced_at IS NOT NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('rB')::uuid)
      AND NOT EXISTS (SELECT 1 FROM public.paige_suppressions WHERE contact_id = 'e03f0300-0000-4000-8000-000000000002'),
  'a blocked bounce counts as bounced and suppresses nobody');
SELECT is(pg_temp.evr('sg:lane-c-bounce', 'C', 'bounced', 'bounce'), 'processed', 'C''s hard bounce is processed');
SELECT ok(EXISTS (SELECT 1 FROM public.paige_suppressions WHERE contact_id = 'e03f0300-0000-4000-8000-000000000003'
                  AND tenant_id = 'e03f0200-0000-4000-8000-000000000001' AND reason = 'bounce_hard'),
  'a hard bounce suppresses that contact for this business');
SELECT is(pg_temp.evr('sg:lane-d-spam', 'D', 'complained'), 'processed', 'D''s spam report is processed');
SELECT ok((SELECT complained_at IS NOT NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('rD')::uuid)
      AND EXISTS (SELECT 1 FROM public.paige_suppressions WHERE contact_id = 'e03f0300-0000-4000-8000-000000000004' AND reason = 'complaint'),
  'a complaint is recorded and suppresses the contact');

-- E is still being handed over (no provider id yet): its early event is redelivered, not journalled.
SELECT is(pg_temp.ev('sg:lane-e-early', 'sgxE', 'delivered', 'e.sglane@tests.invalid',
  'e03f0200-0000-4000-8000-000000000001', pg_temp.k('rE'), pg_temp.k('rE')), 'pending', 'an early event answers pending');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.sendgrid_receipt_processing WHERE receipt_id = 'sg:lane-e-early'),
  'and leaves nothing journalled, so SendGrid redelivers it');

-- SendGrid accepted E but its answer carried no X-Message-Id: E is recorded sent with no provider id.
-- The redelivered event's three claims and address name E, so it supplies the id and is applied.
SELECT is(pg_temp.svc(format('SELECT to_jsonb(public.email_campaign_dispatch_record(%L::uuid, %L))', pg_temp.k('rE'), 'sent')) #>> '{}',
  'sent', 'E is recorded sent without a provider id');
SELECT is(pg_temp.ev('sg:lane-e-late', 'sgxE', 'delivered', 'e.sglane@tests.invalid',
  'e03f0200-0000-4000-8000-000000000001', pg_temp.k('rE'), pg_temp.k('rE')), 'processed', 'E''s event is processed');
SELECT is((SELECT provider_message_id||'/'||(delivered_at IS NOT NULL) FROM public.email_campaign_recipients WHERE id = pg_temp.k('rE')::uuid),
  'sgxE/true', 'the event supplies E''s provider id and records the delivery');

-- A Resend-sent recipient is never touched by a SendGrid event, even one naming its provider id and
-- carrying its own claims. A second campaign, through the Resend connector, to A (still eligible).
INSERT INTO k SELECT 'rs', pg_temp.draft('Cedar resend note', '{"mode":"connector","connector_id":"e03f0900-0000-4000-8000-000000000002"}')::text;
SELECT ok(NOT (pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', (pg_temp.k('rs')::jsonb)->>'version_id')) ? 'error')
      AND NOT (pg_temp.owner(format('SELECT public.email_campaign_approve(%L::uuid)', (pg_temp.k('rs')::jsonb)->>'version_id')) ? 'error')
      AND pg_temp.svc('SELECT public.email_campaign_dispatch_claim(25)') ? 'recipients',
  'a Resend campaign is filed, approved and leased');
INSERT INTO k SELECT 'rsA', pg_temp.rid(((pg_temp.k('rs')::jsonb)->>'version_id')::uuid, 'A')::text;
SELECT is(pg_temp.svc(format('SELECT to_jsonb(public.email_campaign_dispatch_record(%L::uuid, %L, %L))', pg_temp.k('rsA'), 'sent', 'rsx-a')) #>> '{}',
  'sent', 'its email to A is recorded sent');
SELECT is(pg_temp.ev('sg:lane-rs-a', 'rsx-a', 'bounced', 'a.sglane@tests.invalid', 'e03f0200-0000-4000-8000-000000000001',
  pg_temp.k('rsA'), pg_temp.k('rsA'), 'bounce')||'/'||pg_temp.jr('sg:lane-rs-a'),
  'processed/uncorrelated:provider_mismatch', 'a recipient sent through another provider is not SendGrid''s to update');
SELECT ok((SELECT bounced_at IS NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('rsA')::uuid)
      AND NOT EXISTS (SELECT 1 FROM public.paige_suppressions WHERE contact_id = 'e03f0300-0000-4000-8000-000000000001'),
  'and nothing about A changed');

-- ── 5. A third campaign, on SendGrid again: the admission's remaining refusals, and what an unknown send
--    or an unlabelled bounce still teaches ─────────────────────────────────────────────────────────
INSERT INTO k SELECT 'sg2', pg_temp.draft('Cedar update', '{"mode":"connector","connector_id":"e03f0900-0000-4000-8000-000000000001"}')::text;
SELECT ok(NOT (pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', (pg_temp.k('sg2')::jsonb)->>'version_id')) ? 'error')
      AND NOT (pg_temp.owner(format('SELECT public.email_campaign_approve(%L::uuid)', (pg_temp.k('sg2')::jsonb)->>'version_id')) ? 'error')
      AND pg_temp.svc('SELECT public.email_campaign_dispatch_claim(25)') ? 'recipients',
  'a second SendGrid campaign is filed, approved and leased');
INSERT INTO k SELECT 's2'||l, pg_temp.rid(((pg_temp.k('sg2')::jsonb)->>'version_id')::uuid, l)::text FROM unnest(ARRAY['A','B','E']) l;
SELECT is((SELECT string_agg(status, ',' ORDER BY client_id) FROM public.email_campaign_recipients
            WHERE version_id = ((pg_temp.k('sg2')::jsonb)->>'version_id')::uuid), 'sending,sending,sending',
  'its three eligible people (C and D are now suppressed) are being handed over');
-- The function body refuses a signed-in subject even under the service role.
SELECT is(pg_temp.as_user('e03f0100-0000-4000-8000-000000000001',
  format('SELECT public.email_campaign_sendgrid_admit(%L::uuid, %L::uuid, %L)', pg_temp.k('s2E'), 'e03f0900-0000-4000-8000-000000000001', 'e.sglane@tests.invalid'),
  'service_role')->>'sqlstate', '42501', 'the admission refuses a signed-in subject even with the service role');
UPDATE public.channel_connectors SET active = false WHERE id = 'e03f0900-0000-4000-8000-000000000001';
SELECT is(pg_temp.admit(pg_temp.k('s2E'), 'e03f0900-0000-4000-8000-000000000001', 'e.sglane@tests.invalid')->>'reason',
  'sender_changed', 'a connector switched off after approval is refused');
UPDATE public.channel_connectors SET active = true, from_address = 'promo@cedar.tests.invalid' WHERE id = 'e03f0900-0000-4000-8000-000000000001';
SELECT is(pg_temp.admit(pg_temp.k('s2E'), 'e03f0900-0000-4000-8000-000000000001', 'e.sglane@tests.invalid')->>'reason',
  'sender_changed', 'a From changed after approval is refused, even on the same verified domain');
UPDATE public.channel_connectors SET from_address = 'news@cedar.tests.invalid' WHERE id = 'e03f0900-0000-4000-8000-000000000001';
UPDATE public.email_campaign_recipients SET lease_until = now() - interval '1 second' WHERE id = pg_temp.k('s2E')::uuid; -- tampering: an expired lease
SELECT is(pg_temp.admit(pg_temp.k('s2E'), 'e03f0900-0000-4000-8000-000000000001', 'e.sglane@tests.invalid')->>'reason',
  'recipient_not_leased', 'an expired lease is refused');
-- B's send answer could not be read: outcome_unknown, no provider id. Its spam report still suppresses B.
SELECT is(pg_temp.svc(format('SELECT to_jsonb(public.email_campaign_dispatch_record(%L::uuid, %L))', pg_temp.k('s2B'), 'outcome_unknown')) #>> '{}',
  'outcome_unknown', 'B''s send is recorded outcome unknown');
SELECT is(pg_temp.ev('sg:lane2-b-spam', 'sgzB', 'complained', 'b.sglane@tests.invalid',
  'e03f0200-0000-4000-8000-000000000001', pg_temp.k('s2B'), pg_temp.k('s2B'))||'/'||pg_temp.jr('sg:lane2-b-spam'),
  'processed/correlated:recipient_outcome_unknown', 'a spam report about an unknown send is recognised');
SELECT ok(EXISTS (SELECT 1 FROM public.paige_suppressions WHERE contact_id = 'e03f0300-0000-4000-8000-000000000002' AND reason = 'complaint')
      AND (SELECT status = 'outcome_unknown' AND complained_at IS NULL FROM public.email_campaign_recipients WHERE id = pg_temp.k('s2B')::uuid),
  'it suppresses B and leaves the unknown send, and the campaign''s totals, as they were');
-- A bounce SendGrid gives no type for is treated as a hard bounce.
SELECT is(pg_temp.svc(format('SELECT to_jsonb(public.email_campaign_dispatch_record(%L::uuid, %L, %L))', pg_temp.k('s2A'), 'sent', 'sgzA')) #>> '{}',
  'sent', 'A is recorded sent');
SELECT is(pg_temp.ev('sg:lane2-a-bounce', 'sgzA', 'bounced', 'a.sglane@tests.invalid',
  'e03f0200-0000-4000-8000-000000000001', pg_temp.k('s2A'), pg_temp.k('s2A'), NULL), 'processed', 'A''s untyped bounce is processed');
SELECT ok(EXISTS (SELECT 1 FROM public.paige_suppressions WHERE contact_id = 'e03f0300-0000-4000-8000-000000000001' AND reason = 'bounce_hard'),
  'an untyped bounce suppresses, like a hard one');
-- Cancelled mid-send: the leased recipient is no longer admitted.
UPDATE public.email_campaign_recipients SET lease_until = now() + interval '5 minutes' WHERE id = pg_temp.k('s2E')::uuid;
SELECT ok(NOT (pg_temp.owner(format('SELECT public.email_campaign_cancel(%L::uuid)', (pg_temp.k('sg2')::jsonb)->>'campaign_id')) ? 'error'),
  'the owner cancels the campaign');
SELECT is(pg_temp.admit(pg_temp.k('s2E'), 'e03f0900-0000-4000-8000-000000000001', 'e.sglane@tests.invalid')->>'ok',
  'false', 'a cancelled campaign''s email is not admitted');

SELECT * FROM finish();
ROLLBACK;
