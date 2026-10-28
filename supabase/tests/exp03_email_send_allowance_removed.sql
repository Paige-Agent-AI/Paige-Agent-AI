-- EXP03 — PAIGE imposes no sending stop on a business's own marketing email (owner ruling 2026-10-27:
-- uncapped billing of each tenant's own usage, 25% contribution target, no spending or sending stops).
-- Migration 20271121120003 removes the fixed 500-a-day allowance from the three places it was enforced:
-- filing a campaign (over_daily_cap), filing a "matching" series (over_daily_cap), and the dispatcher's
-- claim (a business at 500 in 24 hours waited). This suite proves a business past 500 in 24 hours is
-- refused nowhere, and that every OTHER refusal still holds through the real seams: a member cannot file,
-- a business with no postal address cannot file, a newsletter reaches only subscribers, suppressed and
-- opted-out people are left out at plan AND at send, nothing is claimed before a person approves, and
-- another business's contacts are never planned. It also proves the claim still leases at most its limit
-- (100) per call, and that without the cap the dispatcher stays FAIR across businesses (review M1): a
-- business whose last send is older is claimed first, so one business's large campaign cannot hold every
-- pass — scheduling order only, nobody is refused or made to wait.
-- Full replayed schema, actual caller roles, synthetic data only (test-tenant-* rows, *.tests.invalid
-- addresses; §63); everything rolled back. No provider is called: the send step is the service-only
-- dispatch seam, driven exactly as email-campaign-worker drives it.
BEGIN;
SELECT plan(36);

-- ── Seed ────────────────────────────────────────────────────────────────────────────────────────
-- Users: 1 owner of Ash, 2 member of Ash, 3 owner of Elm (no postal address), 4 owner of Birch.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data)
SELECT ('e03c0100-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'authenticated','authenticated',
       'e03-allowance-'||n||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'
  FROM generate_series(1,4) n;
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e03c0200-0000-4000-8000-000000000001','test-tenant-e03-allowance-ash','Ash Studio','active','standalone',NULL,'E03AA',9432001,'{}'),
 ('e03c0200-0000-4000-8000-000000000002','test-tenant-e03-allowance-elm','Elm Studio','active','standalone',NULL,'E03AE',9432002,'{}'),
 ('e03c0200-0000-4000-8000-000000000003','test-tenant-e03-allowance-birch','Birch Studio','active','standalone',NULL,'E03AB',9432003,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e03c0200-0000-4000-8000-000000000001','e03c0100-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e03c0200-0000-4000-8000-000000000001','e03c0100-0000-4000-8000-000000000002','member','active',false,now()),
 ('e03c0200-0000-4000-8000-000000000002','e03c0100-0000-4000-8000-000000000003','owner','active',true,now()),
 ('e03c0200-0000-4000-8000-000000000003','e03c0100-0000-4000-8000-000000000004','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e03c0200-0000-4000-8000-000000000001'
 WHERE user_id IN ('e03c0100-0000-4000-8000-000000000001','e03c0100-0000-4000-8000-000000000002');
UPDATE public.profiles SET active_tenant_id='e03c0200-0000-4000-8000-000000000002' WHERE user_id='e03c0100-0000-4000-8000-000000000003';
UPDATE public.profiles SET active_tenant_id='e03c0200-0000-4000-8000-000000000003' WHERE user_id='e03c0100-0000-4000-8000-000000000004';
-- Ash and Birch have a postal address; Elm deliberately has none.
INSERT INTO public.tenant_legal_profile(tenant_id,legal_business_name,registered_address) VALUES
 ('e03c0200-0000-4000-8000-000000000001','Ash Studio LLC','1 Test Way, Springfield, ZZ 00000'),
 ('e03c0200-0000-4000-8000-000000000003','Birch Studio LLC','3 Test Way, Springfield, ZZ 00000');
INSERT INTO public.channel_connectors(id,tenant_id,channel_type,provider,from_name,from_address,status,active) VALUES
 ('e03c0900-0000-4000-8000-000000000001','e03c0200-0000-4000-8000-000000000001','email','smtp','Ash Studio','hello@ash.tests.invalid','active',true),
 ('e03c0900-0000-4000-8000-000000000002','e03c0200-0000-4000-8000-000000000002','email','smtp','Elm Studio','hello@elm.tests.invalid','active',true),
 ('e03c0900-0000-4000-8000-000000000003','e03c0200-0000-4000-8000-000000000003','email','smtp','Birch Studio','hello@birch.tests.invalid','active',true);
-- Ash: 507 contacts tagged "bulk" — 505 can receive, #506 is suppressed (a hard bounce), #507 opted out.
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,email,status,tags)
SELECT ('e03c0300-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e03c0200-0000-4000-8000-000000000001',
       'e03c0100-0000-4000-8000-000000000001','Bulk',n::text,'bulk'||n||'.e03a@tests.invalid','active',ARRAY['bulk']
  FROM generate_series(1,507) n;
INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
VALUES ('e03c0200-0000-4000-8000-000000000001','e03c0300-0000-4000-8000-000000000506','bulk506.e03a@tests.invalid','email','bounce_hard','webhook');
UPDATE public.clients SET do_not_contact = true WHERE id = 'e03c0300-0000-4000-8000-000000000507';
-- Elm: one contact carrying the same tag (never Ash's to plan).
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,email,status,tags) VALUES
 ('e03c0300-0000-4000-8000-000000009001','e03c0200-0000-4000-8000-000000000002','e03c0100-0000-4000-8000-000000000003','Elm','One','elm1.e03a@tests.invalid','active',ARRAY['bulk']);
-- Birch: 150 contacts, none of them sent to before.
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,email,status)
SELECT ('e03c0300-0000-4000-8000-0000000'||lpad((20000+n)::text,5,'0'))::uuid,'e03c0200-0000-4000-8000-000000000003',
       'e03c0100-0000-4000-8000-000000000004','Birch',n::text,'birch'||n||'.e03a@tests.invalid','active'
  FROM generate_series(1,150) n;

-- ── Helpers (the lifecycle suite's, unchanged) ──────────────────────────────────────────────────
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
 $$ SELECT pg_temp.as_user('e03c0100-0000-4000-8000-000000000001', _sql) $$;
CREATE FUNCTION pg_temp.member(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e03c0100-0000-4000-8000-000000000002', _sql) $$;
CREATE FUNCTION pg_temp.elm_owner(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e03c0100-0000-4000-8000-000000000003', _sql) $$;
CREATE FUNCTION pg_temp.birch_owner(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e03c0100-0000-4000-8000-000000000004', _sql) $$;
CREATE FUNCTION pg_temp.svc(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(NULL, _sql, 'service_role') $$;
CREATE FUNCTION pg_temp.claim() RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.svc('SELECT public.email_campaign_dispatch_claim(100)') $$;
-- A campaign drafted through the editor's own writers, as one owner. Returns {campaign_id, version_id}.
CREATE FUNCTION pg_temp.draft(_as uuid, _kind text, _name text, _rule jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _made jsonb; _r jsonb;
BEGIN
 _made := pg_temp.as_user(_as, format('SELECT public.email_campaign_create(%L,%L)', _kind, _name));
 IF _made->>'version_id' IS NULL THEN RAISE EXCEPTION 'create failed: %', _made; END IF;
 _r := pg_temp.as_user(_as, format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, NULL, NULL, %L, NULL, %L, NULL, %L::jsonb))',
        _made->>'version_id', _name, '<p>Hello from the studio.</p>', _rule));
 IF _r ? 'error' THEN RAISE EXCEPTION 'draft failed: %', _r; END IF;
 RETURN _made;
END $$;
CREATE TEMP TABLE k(name text PRIMARY KEY, c jsonb) ON COMMIT DROP;
GRANT ALL ON k TO authenticated, service_role;
CREATE FUNCTION pg_temp.v(_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT (c->>'version_id')::uuid FROM k WHERE name = _name $$;
CREATE FUNCTION pg_temp.c(_name text) RETURNS uuid LANGUAGE sql AS $$ SELECT (c->>'campaign_id')::uuid FROM k WHERE name = _name $$;

-- ── 0. The three enforcing seams carry no allowance; their signature, SECURITY, search_path, owner and
--       grants are what they were (the migration changed only the body) ───────────────────────────
SELECT is((SELECT string_agg(p.oid::regprocedure::text||' definer='||p.prosecdef||' '||array_to_string(p.proconfig,',')
                             ||' owner='||pg_get_userbyid(p.proowner)||' acl='||p.proacl::text, E'\n' ORDER BY p.proname)
             FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('email_campaign_request_approval','email_sequence_request_approval','email_campaign_dispatch_claim')),
  E'email_campaign_dispatch_claim(integer) definer=true search_path=public, pg_temp owner=postgres acl={postgres=X/postgres,service_role=X/postgres}\n'
  ||E'email_campaign_request_approval(uuid,text) definer=true search_path=public, pg_temp owner=postgres acl={postgres=X/postgres,authenticated=X/postgres}\n'
  ||'email_sequence_request_approval(uuid,text) definer=true search_path=public, pg_temp owner=postgres acl={postgres=X/postgres,authenticated=X/postgres}',
  'the three seams keep their signature, SECURITY DEFINER, search_path, owner and grants');
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('email_campaign_request_approval','email_sequence_request_approval','email_campaign_dispatch_claim')
             AND (p.prosrc ~ 'email_campaign_daily_cap' OR p.prosrc ~ 'over_daily_cap' OR p.prosrc ~ '_email_used_today')),
  0, 'no enforcing seam reads the daily allowance or the 24-hour count any more');

-- ── 1. Filing a campaign to more than 500 people is not refused ────────────────────────────────
INSERT INTO k VALUES ('big', pg_temp.draft('e03c0100-0000-4000-8000-000000000001', 'standard', 'Spring to everyone', '{"tags":["bulk"]}'));
SELECT is(pg_temp.member(format('SELECT public.email_campaign_request_approval(%L::uuid)', pg_temp.v('big')))->>'sqlstate', '42501',
  'a member still cannot file a campaign for approval');
SELECT is((SELECT COALESCE(r->>'recipients', r->>'error') FROM (SELECT pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', pg_temp.v('big'))) r) x), '505',
  'the owner files a 505-person campaign: no over_daily_cap');
SELECT is((SELECT count(*)::int FROM public.email_campaign_recipients WHERE version_id = pg_temp.v('big') AND status = 'planned'), 505,
  'all 505 who can receive are planned');
SELECT is((SELECT count(*)::int FROM public.email_campaign_recipients WHERE version_id = pg_temp.v('big')
            AND client_id IN ('e03c0300-0000-4000-8000-000000000506','e03c0300-0000-4000-8000-000000000507','e03c0300-0000-4000-8000-000000009001')), 0,
  'the suppressed person, the opted-out person and another business''s contact are still left out at plan');
SELECT is((SELECT a.status||'/'||a.type||'/'||(a.metadata->>'expected_recipients') FROM public.email_campaign_versions v
             JOIN public.paige_pending_approvals a ON a.id = v.approval_id WHERE v.id = pg_temp.v('big')),
  'pending/campaign_send/505', 'one pending campaign_send approval for 505 people');
SELECT is((SELECT (a.metadata->>'cost_bound_usd')::numeric FROM public.email_campaign_versions v
             JOIN public.paige_pending_approvals a ON a.id = v.approval_id WHERE v.id = pg_temp.v('big')), 0::numeric,
  'the cost bound is unchanged: the business''s own connected sender carries no PAIGE cost');

-- ── 2. Every other filing refusal holds ────────────────────────────────────────────────────────
INSERT INTO k VALUES ('elm', pg_temp.draft('e03c0100-0000-4000-8000-000000000003', 'standard', 'Elm note', '{}'));
SELECT is(pg_temp.elm_owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', pg_temp.v('elm')))->>'error', 'postal_address_missing',
  'a business with no postal address still cannot file');
INSERT INTO k VALUES ('letter', pg_temp.draft('e03c0100-0000-4000-8000-000000000001', 'newsletter', 'Ash letter', '{"tags":["bulk"]}'));
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', pg_temp.v('letter')))->>'error', 'no_eligible_recipients',
  'a newsletter still reaches only subscribers: 507 tagged, none subscribed, nothing to file');
SELECT is((SELECT count(*)::int FROM public.email_campaign_recipients WHERE version_id IN (pg_temp.v('elm'), pg_temp.v('letter'))), 0,
  'the refused filings planned nobody');

-- ── 3. Nothing is claimed before a person approves ─────────────────────────────────────────────
INSERT INTO k VALUES ('claim0', pg_temp.claim());
SELECT ok((SELECT (c ? 'campaign') AND NOT (c ? 'error') FROM k WHERE name = 'claim0'),
  'the claim answers (an error here fails this proof, it does not pass it)');
SELECT ok((SELECT c->'campaign'->>'id' FROM k WHERE name = 'claim0') IS DISTINCT FROM pg_temp.c('big')::text,
  'the filed-but-unapproved campaign is not claimed');
SELECT is((SELECT count(*)::int FROM public.email_campaign_recipients WHERE version_id = pg_temp.v('big') AND status <> 'planned'), 0,
  'and nothing of it was leased');
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_approve(%L::uuid)', pg_temp.v('big')))->>'error', NULL,
  'the owner approves the 505-person campaign');

-- ── 4. One claim leases at most its limit; a business already past 500 in 24 hours keeps sending ─
-- #505 is suppressed after approval (a bounce from another send): left out at send.
INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
VALUES ('e03c0200-0000-4000-8000-000000000001','e03c0300-0000-4000-8000-000000000505','bulk505.e03a@tests.invalid','email','bounce_hard','webhook');
INSERT INTO k VALUES ('claim1', pg_temp.claim());
SELECT is((SELECT c->'campaign'->>'id' FROM k WHERE name = 'claim1'), pg_temp.c('big')::text, 'the approved campaign is claimed');
SELECT is((SELECT jsonb_array_length(c->'recipients') FROM k WHERE name = 'claim1'), 100,
  'one claim leases exactly its limit (100) while 504 are planned');
SELECT is((SELECT status||':'||COALESCE(skip_reason,'') FROM public.email_campaign_recipients
            WHERE version_id = pg_temp.v('big') AND client_id = 'e03c0300-0000-4000-8000-000000000505'), 'skipped:suppressed',
  'the person suppressed after approval is still left out at send');
-- The worker's recorded outcome: those 100, and 400 more, sent within the last hour.
UPDATE public.email_campaign_recipients SET status = 'sent', sent_at = now() - interval '1 hour', lease_until = NULL, updated_at = now()
 WHERE version_id = pg_temp.v('big') AND status = 'sending';
UPDATE public.email_campaign_recipients SET status = 'sent', sent_at = now() - interval '1 hour', updated_at = now()
 WHERE id IN (SELECT id FROM public.email_campaign_recipients WHERE version_id = pg_temp.v('big') AND status = 'planned'
              ORDER BY client_id LIMIT 400);
SELECT is((SELECT count(*)::int FROM public.email_campaign_recipients WHERE tenant_id = 'e03c0200-0000-4000-8000-000000000001'
            AND sent_at > now() - interval '24 hours'), 500, 'the business has sent 500 in the last 24 hours');
INSERT INTO k VALUES ('claim', pg_temp.claim());
SELECT is((SELECT c->'campaign'->>'id' FROM k WHERE name = 'claim'), pg_temp.c('big')::text,
  'the dispatcher still claims the business''s campaign at 500 sent in 24 hours');
SELECT is((SELECT c->>'waiting' FROM k WHERE name = 'claim'), NULL, 'it is not held back to wait for a daily allowance');
SELECT is((SELECT jsonb_array_length(c->'recipients') FROM k WHERE name = 'claim'), 4,
  'four are handed to the sender: the 501st to 504th email in 24 hours');
SELECT is((SELECT count(*)::int FROM public.email_campaign_recipients WHERE version_id = pg_temp.v('big') AND status = 'sending'), 4,
  'the four are leased, so 504 are sent or in flight within 24 hours');

-- ── 5. Filing a "matching" series that matches more than 500 people now is not refused ─────────
INSERT INTO k VALUES ('series', pg_temp.owner($$SELECT public.email_sequence_create('custom', 'Bulk welcome')$$));
SELECT is(pg_temp.owner(format($$SELECT to_jsonb(count(public.email_sequence_step_save(%L::uuid, s.position, NULL, 'Email '||s.position, '', '<p>Hello from Ash Studio.</p>')))
                                   FROM public.email_sequence_steps s WHERE s.version_id = %L::uuid$$,
            (SELECT c->>'sequence_id' FROM k WHERE name='series'), (SELECT c->>'version_id' FROM k WHERE name='series')))->>'error', NULL,
  'every email of the series is written');
SELECT is(pg_temp.owner(format($$SELECT to_jsonb(public.email_sequence_update_draft(%L::uuid, NULL, 'matching', '{"tags":["bulk"]}'::jsonb))$$,
            (SELECT c->>'sequence_id' FROM k WHERE name='series')))->>'error', NULL,
  'the series enters everyone tagged bulk (matching)');
SELECT is(pg_temp.member(format('SELECT public.email_sequence_request_approval(%L::uuid)', (SELECT c->>'sequence_id' FROM k WHERE name='series')))->>'sqlstate', '42501',
  'a member still cannot file a series');
INSERT INTO k VALUES ('series_filed', pg_temp.owner(format('SELECT public.email_sequence_request_approval(%L::uuid)', (SELECT c->>'sequence_id' FROM k WHERE name='series'))));
SELECT is((SELECT COALESCE(c->>'matching_now', c->>'error') FROM k WHERE name = 'series_filed'), '504',
  'the owner files a series matching 504 people now: no over_daily_cap (505 bulk can receive, #505 suppressed since)');
SELECT is((SELECT a.status||'/'||(a.metadata ? 'daily_limit')::text||'/'||(a.metadata ? 'daily_cost_bound_usd')::text||'/'||(a.draft_content ? 'daily_limit')::text
             FROM public.paige_pending_approvals a WHERE a.id = (SELECT (c->>'approval_id')::uuid FROM k WHERE name = 'series_filed')),
  'pending/false/false/false', 'the series approval carries no daily limit and no daily cost bound derived from one');
SELECT is((SELECT a.metadata->>'matching_now' FROM public.paige_pending_approvals a WHERE a.id = (SELECT (c->>'approval_id')::uuid FROM k WHERE name = 'series_filed')),
  '504', 'the approval still names how many people match now');

-- ── 6. Fair across businesses (review M1): order only, never a refusal or a wait ───────────────
-- Ash (claimed in section 4) has a 504-person campaign due 4 minutes ago; Birch (never claimed) has a
-- 150-person campaign due 2 minutes ago. Oldest-due-first alone would give Ash every pass until it drained.
-- Birch's first batch is DEFERRED, not sent (quiet hours): no sent_at is written. A key on the last send would
-- then put Birch first again on every pass; the key on the last claim lets Ash have the next one.
INSERT INTO k VALUES ('ash2', pg_temp.draft('e03c0100-0000-4000-8000-000000000001', 'standard', 'Autumn to everyone', '{"tags":["bulk"]}'));
INSERT INTO k VALUES ('birch', pg_temp.draft('e03c0100-0000-4000-8000-000000000004', 'standard', 'Birch note', '{}'));
SELECT is(pg_temp.owner(format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, p_scheduled_for => %L::timestamptz))', pg_temp.v('ash2'), now() - interval '4 minutes'))->>'error', NULL,
  'Ash''s campaign is due four minutes ago');
SELECT is(pg_temp.birch_owner(format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, p_scheduled_for => %L::timestamptz))', pg_temp.v('birch'), now() - interval '2 minutes'))->>'error', NULL,
  'Birch''s campaign is due later, two minutes ago');
SELECT is((SELECT string_agg(COALESCE(r->>'recipients', r->>'error'), ',' ORDER BY o) FROM (
            SELECT 1 o, pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', pg_temp.v('ash2'))) r
            UNION ALL SELECT 2, pg_temp.birch_owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', pg_temp.v('birch')))) x),
  '504,150', 'both are filed: Ash to 504 people, Birch to 150');
SELECT is((SELECT string_agg(COALESCE(r->>'error', 'ok'), ',' ORDER BY o) FROM (
            SELECT 1 o, pg_temp.owner(format('SELECT public.email_campaign_approve(%L::uuid)', pg_temp.v('ash2'))) r
            UNION ALL SELECT 2, pg_temp.birch_owner(format('SELECT public.email_campaign_approve(%L::uuid)', pg_temp.v('birch')))) x),
  'ok,ok', 'both are approved');
-- Three worker passes; after each, the worker records the outcome: Birch's 100 deferred 15 minutes, as
-- email_campaign_dispatch_record does (back to planned, a not_before, no sent_at); then Ash's 100 sent.
INSERT INTO k VALUES ('fair1', pg_temp.claim());
UPDATE public.email_campaign_recipients SET status = 'planned', lease_until = NULL, not_before = now() + interval '15 minutes', updated_at = now()
 WHERE status = 'sending' AND campaign_id = (SELECT (c->'campaign'->>'id')::uuid FROM k WHERE name = 'fair1');
INSERT INTO k VALUES ('fair2', pg_temp.claim());
UPDATE public.email_campaign_recipients SET status = 'sent', sent_at = now() - interval '10 minutes', lease_until = NULL, updated_at = now()
 WHERE status = 'sending' AND campaign_id = (SELECT (c->'campaign'->>'id')::uuid FROM k WHERE name = 'fair2');
INSERT INTO k VALUES ('fair3', pg_temp.claim());
SELECT is((SELECT string_agg(CASE WHEN (c->'campaign'->>'id') = pg_temp.c('ash2')::text THEN 'ash'
                                  WHEN (c->'campaign'->>'id') = pg_temp.c('birch')::text THEN 'birch'
                                  ELSE COALESCE(c->>'error', 'other') END, ',' ORDER BY name)
             FROM k WHERE name IN ('fair1','fair2','fair3')),
  'birch,ash,birch', 'the passes alternate: Birch (never claimed) first though due later, then Ash although Birch''s batch was only deferred, then Birch again');
SELECT is((SELECT string_agg(COALESCE(jsonb_array_length(c->'recipients')::text, 'none'), ',' ORDER BY name) FROM k WHERE name IN ('fair1','fair2','fair3')),
  '100,100,50', 'each pass leases up to its limit: nobody is refused, held or skipped for a limit');
SELECT is((SELECT count(*)::int FROM k WHERE name IN ('fair1','fair2','fair3') AND (c ? 'waiting' OR c ? 'blocked' OR c ? 'error')), 0,
  'no pass answers waiting, blocked or an error');

SELECT * FROM finish();
ROLLBACK;
