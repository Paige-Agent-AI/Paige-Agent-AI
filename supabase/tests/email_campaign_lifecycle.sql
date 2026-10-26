-- EXP03 email/newsletter journey — the campaign lifecycle's own negatives, through the real seams.
-- Full replayed schema, actual caller roles, synthetic data only (test-tenant-* rows, *.tests.invalid
-- addresses; §63); everything rolled back. No provider is called: the worker's send step is the
-- service-only dispatch seam, driven here exactly as email-campaign-worker drives it.
--
-- The existing E09 suite (e09_campaign_portal_audience.sql) proves portal audience and Updates consent
-- re-checked at send. This suite proves the rest of the lifecycle the owner's email directive names:
--   1. a saved draft reopens with what was saved; a later save changes only what it names;
--   2. a member (not owner/admin) and another business's owner can neither write, file, approve nor read
--      campaigns, versions or recipients; an admin seat (not only the owner) can approve;
--   3. filing freezes the version: no direct edit, no draft edit, one pending campaign_send approval;
--   4. a stale approval cannot send: a version replaced after filing cannot be approved, and an approval
--      whose bound content hash no longer matches is refused (approval_stale);
--   5. only a person approves through email_campaign_approve: a generic approve of the queue row is
--      refused, and a call with no signed-in person is refused by the function body (not_signed_in);
--   6. PAIGE's filing waits for a person (approve is not one of her registered capabilities —
--      _shared/paige-spine/domains/email_campaigns.ts): her repeat filing returns the same approval; she
--      cannot take over an owner-filed one; a stopped campaign refuses her filing;
--   7. decline (the seam, and the owner's own RLS-scoped decline from the approvals queue) returns the campaign to an editable
--      draft with the same content; nothing planned under the declined version can be sent;
--   8. suppressed or opted-out people are excluded at plan, and again at send when it happens after
--      approval; another business's contacts are never planned;
--   9. a lease that expires without a result becomes outcome_unknown and is never handed out again; a
--      second record of the same send changes nothing (duplicate dispatch);
--  10. cancel mid-send: nothing planned is sent, a leased send is refused at hand-off, a send held back
--      (deferred) under the cancelled campaign is never claimed again, nothing settles;
--  11. settle reads totals from the recipient rows; a new version never goes again to anyone a previous
--      version reached — sent or outcome unknown.
-- The claim is global (any business's due campaign), so claim assertions name this suite's campaign id.
BEGIN;
SELECT plan(86);

-- ── Seed ────────────────────────────────────────────────────────────────────────────────────────
-- Users: 1 owner of Alder, 2 member of Alder, 3 owner of Birch, 4 admin of Alder.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data)
SELECT ('e03e0100-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'authenticated','authenticated',
       'e03-lifecycle-'||n||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'
  FROM generate_series(1,4) n;
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e03e0200-0000-4000-8000-000000000001','test-tenant-e03-lifecycle-alder','Alder Studio','active','standalone',NULL,'E03LA',9431001,'{}'),
 ('e03e0200-0000-4000-8000-000000000002','test-tenant-e03-lifecycle-birch','Birch Lane Studio','active','standalone',NULL,'E03LB',9431002,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e03e0200-0000-4000-8000-000000000001','e03e0100-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e03e0200-0000-4000-8000-000000000001','e03e0100-0000-4000-8000-000000000002','member','active',false,now()),
 ('e03e0200-0000-4000-8000-000000000002','e03e0100-0000-4000-8000-000000000003','owner','active',true,now()),
 ('e03e0200-0000-4000-8000-000000000001','e03e0100-0000-4000-8000-000000000004','admin','active',false,now());
UPDATE public.profiles SET active_tenant_id='e03e0200-0000-4000-8000-000000000001'
 WHERE user_id IN ('e03e0100-0000-4000-8000-000000000001','e03e0100-0000-4000-8000-000000000002','e03e0100-0000-4000-8000-000000000004');
UPDATE public.profiles SET active_tenant_id='e03e0200-0000-4000-8000-000000000002' WHERE user_id='e03e0100-0000-4000-8000-000000000003';
INSERT INTO public.tenant_legal_profile(tenant_id,legal_business_name,registered_address) VALUES
 ('e03e0200-0000-4000-8000-000000000001','Alder Studio LLC','1 Test Way, Springfield, ZZ 00000'),
 ('e03e0200-0000-4000-8000-000000000002','Birch Lane Studio LLC','2 Test Way, Springfield, ZZ 00000');
INSERT INTO public.channel_connectors(id,tenant_id,channel_type,provider,from_name,from_address,status,active) VALUES
 ('e03e0900-0000-4000-8000-000000000001','e03e0200-0000-4000-8000-000000000001','email','smtp','Alder Studio','hello@alder.tests.invalid','active',true),
 ('e03e0900-0000-4000-8000-000000000002','e03e0200-0000-4000-8000-000000000002','email','smtp','Birch Lane','hello@birch.tests.invalid','active',true);
-- Alder's contacts A..G (letter = last two id digits); Birch's contact X (id 24).
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,email,status) VALUES
 ('e03e0300-0000-4000-8000-000000000001','e03e0200-0000-4000-8000-000000000001','e03e0100-0000-4000-8000-000000000001','Ada','Reyes','ada.e03@tests.invalid','active'),
 ('e03e0300-0000-4000-8000-000000000002','e03e0200-0000-4000-8000-000000000001','e03e0100-0000-4000-8000-000000000001','Ben','Okafor','ben.e03@tests.invalid','active'),
 ('e03e0300-0000-4000-8000-000000000003','e03e0200-0000-4000-8000-000000000001','e03e0100-0000-4000-8000-000000000001','Cleo','Marsh','cleo.e03@tests.invalid','active'),
 ('e03e0300-0000-4000-8000-000000000004','e03e0200-0000-4000-8000-000000000001','e03e0100-0000-4000-8000-000000000001','Dev','Patel','dev.e03@tests.invalid','active'),
 ('e03e0300-0000-4000-8000-000000000005','e03e0200-0000-4000-8000-000000000001','e03e0100-0000-4000-8000-000000000001','Eli','Novak','eli.e03@tests.invalid','active'),
 ('e03e0300-0000-4000-8000-000000000006','e03e0200-0000-4000-8000-000000000001','e03e0100-0000-4000-8000-000000000001','Fay','Lund','fay.e03@tests.invalid','active'),
 ('e03e0300-0000-4000-8000-000000000007','e03e0200-0000-4000-8000-000000000001','e03e0100-0000-4000-8000-000000000001','Gus','Hale','gus.e03@tests.invalid','active'),
 ('e03e0300-0000-4000-8000-000000000024','e03e0200-0000-4000-8000-000000000002','e03e0100-0000-4000-8000-000000000003','Xan','Ito','xan.e03@tests.invalid','active');
-- F is suppressed before anything is planned (a hard bounce on record).
INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
VALUES ('e03e0200-0000-4000-8000-000000000001','e03e0300-0000-4000-8000-000000000006','fay.e03@tests.invalid','email','bounce_hard','webhook');
-- G has opted out (do not contact) before anything is planned.
UPDATE public.clients SET do_not_contact = true WHERE id = 'e03e0300-0000-4000-8000-000000000007';

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
 $$ SELECT pg_temp.as_user('e03e0100-0000-4000-8000-000000000001', _sql) $$;
CREATE FUNCTION pg_temp.member(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e03e0100-0000-4000-8000-000000000002', _sql) $$;
CREATE FUNCTION pg_temp.admin(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e03e0100-0000-4000-8000-000000000004', _sql) $$;
CREATE FUNCTION pg_temp.foreign_owner(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e03e0100-0000-4000-8000-000000000003', _sql) $$;
CREATE FUNCTION pg_temp.svc(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(NULL, _sql, 'service_role') $$;
CREATE FUNCTION pg_temp.claim() RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.svc('SELECT public.email_campaign_dispatch_claim(25)') $$;
-- Recipients of a version, "letter:status[:reason]", sorted.
CREATE FUNCTION pg_temp.rcpt(_version uuid) RETURNS text LANGUAGE sql AS $$
 SELECT COALESCE(string_agg(chr(64 + right(r.client_id::text,2)::int)||':'||r.status||COALESCE(':'||r.skip_reason,''), ' ' ORDER BY r.client_id),'')
   FROM public.email_campaign_recipients r WHERE r.version_id = _version $$;
-- A version's recipients counted by status, "status:n", sorted.
CREATE FUNCTION pg_temp.tally(_version uuid) RETURNS text LANGUAGE sql AS $$
 SELECT string_agg(status||':'||n, ' ' ORDER BY status) FROM (
   SELECT r.status, count(*) n FROM public.email_campaign_recipients r WHERE r.version_id = _version GROUP BY r.status) x $$;
CREATE FUNCTION pg_temp.rid(_version uuid, _letter text) RETURNS uuid LANGUAGE sql AS $$
 SELECT r.id FROM public.email_campaign_recipients r
  WHERE r.version_id = _version AND chr(64 + right(r.client_id::text,2)::int) = _letter $$;
-- A campaign drafted through the editor's own writers. Returns {campaign_id, version_id}.
CREATE FUNCTION pg_temp.draft(_name text, _subject text, _rule jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _made jsonb; _r jsonb;
BEGIN
 _made := pg_temp.owner(format('SELECT public.email_campaign_create(%L,%L)', 'standard', _name));
 IF _made->>'version_id' IS NULL THEN RAISE EXCEPTION 'create failed: %', _made; END IF;
 _r := pg_temp.owner(format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, NULL, NULL, %L, NULL, %L, NULL, %L::jsonb))',
        _made->>'version_id', _subject, '<p>Hello from Alder Studio.</p>', _rule));
 IF _r ? 'error' THEN RAISE EXCEPTION 'draft failed: %', _r; END IF;
 RETURN _made;
END $$;
CREATE FUNCTION pg_temp.vid(_c jsonb) RETURNS uuid LANGUAGE sql AS $$ SELECT (_c->>'version_id')::uuid $$;
CREATE FUNCTION pg_temp.cid(_c jsonb) RETURNS uuid LANGUAGE sql AS $$ SELECT (_c->>'campaign_id')::uuid $$;
CREATE FUNCTION pg_temp.cur(_c jsonb) RETURNS uuid LANGUAGE sql AS
 $$ SELECT current_version_id FROM public.email_campaigns WHERE id = (_c->>'campaign_id')::uuid $$;

CREATE TEMP TABLE k(name text PRIMARY KEY, c jsonb) ON COMMIT DROP;
GRANT ALL ON k TO authenticated, service_role;

-- ── 0. The dispatcher seam is service-only; the owner seams are signed-in only ──────────────────
SELECT ok(NOT has_function_privilege(r, f, 'EXECUTE'), f||' is not executable by '||r)
  FROM unnest(ARRAY['anon','authenticated']) r,
       unnest(ARRAY['public.email_campaign_dispatch_claim(integer)','public.email_campaign_dispatch_begin(uuid)',
                    'public.email_campaign_dispatch_record(uuid,text,text,uuid,text,text,timestamp with time zone)',
                    'public.email_campaign_dispatch_settle(uuid)']) f;
SELECT ok(NOT has_function_privilege('anon','public.email_campaign_approve(uuid)','EXECUTE')
      AND NOT has_function_privilege('anon','public.email_campaign_request_approval(uuid,text)','EXECUTE'),
  'anon cannot file or approve a campaign');

-- ── 1. A saved draft reopens as saved; a later save changes only what it names ──────────────────
INSERT INTO k VALUES ('saved', pg_temp.draft('Spring note', 'Spring at Alder'));
SELECT is((SELECT subject||' | '||body_html FROM public.email_campaign_versions WHERE id = pg_temp.vid((SELECT c FROM k WHERE name='saved'))),
  'Spring at Alder | <p>Hello from Alder Studio.</p>', 'the saved draft reads back with its subject and body');
SELECT is(pg_temp.owner(format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, NULL, NULL, NULL, %L))',
            pg_temp.vid((SELECT c FROM k WHERE name='saved')), 'Fresh hours this spring'))->>'error', NULL,
  'reopened: the owner saves only the preheader');
SELECT is((SELECT subject||' | '||preheader||' | '||body_html FROM public.email_campaign_versions WHERE id = pg_temp.vid((SELECT c FROM k WHERE name='saved'))),
  'Spring at Alder | Fresh hours this spring | <p>Hello from Alder Studio.</p>', 'the second save kept what it did not name');
SELECT is(pg_temp.owner('SELECT to_jsonb(count(*)) FROM public.email_campaigns')::int, 1,
  'the owner reads their own campaign');

-- ── 2. A member and another business's owner are refused ─────────────────────────────────────
SELECT is(pg_temp.member($$SELECT public.email_campaign_create('standard','Member try')$$)->>'sqlstate', '42501',
  'a member cannot create a campaign');
SELECT is(pg_temp.member(format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, NULL, NULL, %L))',
            pg_temp.vid((SELECT c FROM k WHERE name='saved')), 'Member subject'))->>'sqlstate', '42501',
  'a member cannot change a draft');
SELECT is(pg_temp.member(format('SELECT public.email_campaign_request_approval(%L::uuid)', pg_temp.vid((SELECT c FROM k WHERE name='saved'))))->>'sqlstate', '42501',
  'a member cannot file a campaign for approval');
SELECT is(pg_temp.member('SELECT to_jsonb(count(*)) FROM public.email_campaigns')::int, 0,
  'a member reads no campaigns');
SELECT is(pg_temp.foreign_owner(format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, NULL, NULL, %L))',
            pg_temp.vid((SELECT c FROM k WHERE name='saved')), 'Hijacked'))->>'error', 'not_an_editable_draft',
  'another business''s owner cannot change Alder''s draft');
SELECT is(pg_temp.foreign_owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', pg_temp.vid((SELECT c FROM k WHERE name='saved'))))->>'error', 'not_an_editable_draft',
  'another business''s owner cannot file Alder''s draft');
SELECT is(pg_temp.foreign_owner('SELECT to_jsonb(count(*)) FROM public.email_campaign_versions')::int, 0,
  'another business''s owner reads none of Alder''s versions');
SELECT is((SELECT subject FROM public.email_campaign_versions WHERE id = pg_temp.vid((SELECT c FROM k WHERE name='saved'))),
  'Spring at Alder', 'no refused write changed the draft');

-- ── 3. Filing freezes the version ─────────────────────────────────────────────────────────────
-- Suppressed F and opted-out G are left out at plan; Birch's X is never Alder's to plan.
SELECT is(pg_temp.owner('SELECT public.email_audience_preview(''{}''::jsonb, ''standard'')')->>'suppressed', '1',
  'the preview names the one suppressed person before filing');
SELECT is(pg_temp.owner('SELECT public.email_audience_preview(''{}''::jsonb, ''standard'')')->>'opted_out', '1',
  'the preview names the one opted-out person before filing');
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', pg_temp.vid((SELECT c FROM k WHERE name='saved'))))->>'recipients', '5',
  'filed: five people planned (F suppressed, G opted out)');
SELECT is(pg_temp.rcpt(pg_temp.vid((SELECT c FROM k WHERE name='saved'))),
  'A:planned B:planned C:planned D:planned E:planned', 'the plan holds Alder''s eligible contacts only — no F, no G, no Birch contact');
SELECT is(pg_temp.member('SELECT to_jsonb(count(*)) FROM public.email_campaign_recipients')::int, 0,
  'a member reads none of the planned recipients');
SELECT is(pg_temp.foreign_owner('SELECT to_jsonb(count(*)) FROM public.email_campaign_recipients')::int, 0,
  'another business''s owner reads none of Alder''s recipients');
SELECT is((SELECT a.status||'/'||a.type||'/'||(a.metadata->>'content_hash' = v.content_hash)::text
             FROM public.email_campaign_versions v JOIN public.paige_pending_approvals a ON a.id = v.approval_id
            WHERE v.id = pg_temp.vid((SELECT c FROM k WHERE name='saved'))),
  'pending/campaign_send/true', 'one pending campaign_send approval bound to the frozen content hash');
SELECT is(pg_temp.owner(format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, NULL, NULL, %L))',
            pg_temp.vid((SELECT c FROM k WHERE name='saved')), 'Late change'))->>'error', 'not_an_editable_draft',
  'a filed version is no longer an editable draft');
SELECT throws_ok(format($$UPDATE public.email_campaign_versions SET subject = 'Swapped' WHERE id = %L$$, pg_temp.vid((SELECT c FROM k WHERE name='saved'))),
  '55000', 'version_frozen', 'no writer can change a frozen version''s content');

-- ── 4. A stale approval cannot send ───────────────────────────────────────────────────────────
-- (a) Defense in depth: an approval whose bound hash no longer matches the version is refused.
UPDATE public.paige_pending_approvals SET metadata = jsonb_set(metadata, '{content_hash}', '"0000"')
 WHERE id = (SELECT approval_id FROM public.email_campaign_versions WHERE id = pg_temp.vid((SELECT c FROM k WHERE name='saved')));
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_approve(%L::uuid)', pg_temp.vid((SELECT c FROM k WHERE name='saved'))))->>'error', 'approval_stale',
  'an approval bound to other content is refused');
SELECT is((SELECT v.state||'/'||c.status FROM public.email_campaign_versions v JOIN public.email_campaigns c ON c.id = v.campaign_id
            WHERE v.id = pg_temp.vid((SELECT c FROM k WHERE name='saved'))), 'locked/pending_approval',
  'the refused approval moved nothing');
UPDATE public.paige_pending_approvals a SET metadata = jsonb_set(a.metadata, '{content_hash}', to_jsonb(v.content_hash))
  FROM public.email_campaign_versions v WHERE v.id = pg_temp.vid((SELECT c FROM k WHERE name='saved')) AND a.id = v.approval_id;
-- (b) The real path: the owner changes the campaign after filing; the filed version can no longer be approved.
INSERT INTO k VALUES ('saved_v1', jsonb_build_object('version_id', pg_temp.vid((SELECT c FROM k WHERE name='saved'))));
SELECT is(pg_temp.owner(format('SELECT to_jsonb(public.email_campaign_new_version(%L::uuid))', pg_temp.cid((SELECT c FROM k WHERE name='saved'))))->>'sqlstate',
  NULL, 'the owner changes the filed campaign');
SELECT ok(pg_temp.cur((SELECT c FROM k WHERE name='saved')) IS DISTINCT FROM pg_temp.vid((SELECT c FROM k WHERE name='saved_v1')),
  'changing a filed campaign starts a new draft');
SELECT is((SELECT v.state||'/'||a.status FROM public.email_campaign_versions v JOIN public.paige_pending_approvals a ON a.id = v.approval_id
            WHERE v.id = pg_temp.vid((SELECT c FROM k WHERE name='saved_v1'))), 'superseded/skipped',
  'the filed version is superseded and its approval withdrawn');
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_approve(%L::uuid)', pg_temp.vid((SELECT c FROM k WHERE name='saved_v1'))))->>'error', 'not_awaiting_approval',
  'the stale version cannot be approved');
SELECT is(pg_temp.rcpt(pg_temp.vid((SELECT c FROM k WHERE name='saved_v1'))),
  'A:cancelled B:cancelled C:cancelled D:cancelled E:cancelled', 'nothing planned under the stale version can be sent');
SELECT is((SELECT subject||' | '||preheader FROM public.email_campaign_versions WHERE id = pg_temp.cur((SELECT c FROM k WHERE name='saved'))),
  'Spring at Alder | Fresh hours this spring', 'the new draft carries the same content to change');

-- ── 5. Only a person approves, and only through email_campaign_approve ──────────────────────────
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', pg_temp.cur((SELECT c FROM k WHERE name='saved'))))->>'recipients', '5',
  'the new draft is filed');
UPDATE k SET c = jsonb_build_object('campaign_id', pg_temp.cid(c), 'version_id', pg_temp.cur(c)) WHERE name = 'saved';
SELECT is(pg_temp.svc(format($$UPDATE public.paige_pending_approvals SET status = 'approved' WHERE id = %L RETURNING to_jsonb(status)$$,
            (SELECT approval_id FROM public.email_campaign_versions WHERE id = pg_temp.vid((SELECT c FROM k WHERE name='saved')))))->>'error',
  'campaign_approval_requires_review', 'a generic approve of the queue row is refused');
SELECT is(pg_temp.as_user(NULL, format('SELECT public.email_campaign_approve(%L::uuid)', pg_temp.vid((SELECT c FROM k WHERE name='saved'))))->>'error', 'not_signed_in',
  'approval with no signed-in person is refused');
SELECT is(pg_temp.member(format('SELECT public.email_campaign_approve(%L::uuid)', pg_temp.vid((SELECT c FROM k WHERE name='saved'))))->>'sqlstate', '42501',
  'a member cannot approve');
SELECT is(pg_temp.foreign_owner(format('SELECT public.email_campaign_approve(%L::uuid)', pg_temp.vid((SELECT c FROM k WHERE name='saved'))))->>'error', 'version_not_found',
  'another business''s owner cannot approve');
SELECT is((SELECT v.state||'/'||a.status FROM public.email_campaign_versions v JOIN public.paige_pending_approvals a ON a.id = v.approval_id
            WHERE v.id = pg_temp.vid((SELECT c FROM k WHERE name='saved'))), 'locked/pending', 'every refused approval left it pending');

-- ── 6. PAIGE files and never approves ─────────────────────────────────────────────────────────
INSERT INTO k VALUES ('paige', pg_temp.draft('Paige note', 'A note from Alder'));
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_submit_for_approval(%L::uuid, %L::uuid)',
            'e03e0200-0000-4000-8000-000000000001', pg_temp.cid((SELECT c FROM k WHERE name='paige'))))->>'replayed', 'false',
  'PAIGE files the draft for approval');
SELECT is((SELECT a.source||'/'||a.status FROM public.email_campaign_versions v JOIN public.paige_pending_approvals a ON a.id = v.approval_id
            WHERE v.id = pg_temp.vid((SELECT c FROM k WHERE name='paige'))), 'paige/pending', 'her filing waits for a person');
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_submit_for_approval(%L::uuid, %L::uuid)',
            'e03e0200-0000-4000-8000-000000000001', pg_temp.cid((SELECT c FROM k WHERE name='paige'))))->>'approval_id',
  (SELECT approval_id::text FROM public.email_campaign_versions WHERE id = pg_temp.vid((SELECT c FROM k WHERE name='paige'))),
  'her repeat filing returns the same approval (no second one)');
SELECT is((SELECT count(*)::int FROM public.paige_pending_approvals a
            WHERE a.metadata->>'email_campaign_version_id' = pg_temp.vid((SELECT c FROM k WHERE name='paige'))::text), 1,
  'exactly one approval exists for her filing');
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_submit_for_approval(%L::uuid, %L::uuid)',
            'e03e0200-0000-4000-8000-000000000001', pg_temp.cid((SELECT c FROM k WHERE name='saved'))))->>'error', 'campaign_awaiting_approval',
  'PAIGE cannot take over an approval the owner filed');
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_submit_for_approval(%L::uuid, %L::uuid)',
            'e03e0200-0000-4000-8000-000000000002', pg_temp.cid((SELECT c FROM k WHERE name='paige'))))->>'sqlstate', '42501',
  'PAIGE refuses a filing named for a business the chat is not in');

-- ── 7. Decline returns the campaign to an editable draft ──────────────────────────────────────
INSERT INTO k VALUES ('paige_v1', jsonb_build_object('version_id', pg_temp.vid((SELECT c FROM k WHERE name='paige'))));
SELECT is(pg_temp.owner(format('SELECT to_jsonb(public.email_campaign_decline(%L::uuid, %L))', pg_temp.vid((SELECT c FROM k WHERE name='paige')), 'Not this week')) #>> '{}', 'true',
  'the owner declines PAIGE''s filing');
SELECT is((SELECT v.state||'/'||a.status FROM public.email_campaign_versions v JOIN public.paige_pending_approvals a ON a.id = v.approval_id
            WHERE v.id = pg_temp.vid((SELECT c FROM k WHERE name='paige_v1'))), 'superseded/rejected', 'the declined version is superseded, its approval rejected');
SELECT is((SELECT v.state||'/'||c.status||'/'||v.subject FROM public.email_campaigns c JOIN public.email_campaign_versions v ON v.id = c.current_version_id
            WHERE c.id = pg_temp.cid((SELECT c FROM k WHERE name='paige'))), 'draft/draft/A note from Alder',
  'the campaign is an editable draft again with the same content');
SELECT is(pg_temp.rcpt(pg_temp.vid((SELECT c FROM k WHERE name='paige_v1'))),
  'A:cancelled B:cancelled C:cancelled D:cancelled E:cancelled', 'nothing planned under the declined version can be sent');
-- A decline from the approvals queue (Command Center) withdraws it the same way.
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_submit_for_approval(%L::uuid, %L::uuid)',
            'e03e0200-0000-4000-8000-000000000001', pg_temp.cid((SELECT c FROM k WHERE name='paige'))))->>'replayed', 'false',
  'PAIGE files the new draft');
INSERT INTO k VALUES ('paige_v2', jsonb_build_object('version_id', pg_temp.cur((SELECT c FROM k WHERE name='paige'))));
-- The Command Center's own write: the signed-in owner's RLS-scoped update of the queue row.
SELECT is(pg_temp.owner(format($q$WITH u AS (UPDATE public.paige_pending_approvals SET status = 'rejected',
            decision_rationale = 'Dismissed from Command Center', reviewed_at = now() WHERE id = %L AND status = 'pending' RETURNING 1)
            SELECT to_jsonb(count(*)) FROM u$q$,
            (SELECT approval_id FROM public.email_campaign_versions WHERE id = pg_temp.vid((SELECT c FROM k WHERE name='paige_v2')))))::int, 1,
  'the owner declines it from the approvals queue');
SELECT is((SELECT v.state FROM public.email_campaign_versions v WHERE v.id = pg_temp.vid((SELECT c FROM k WHERE name='paige_v2')))||'/'||
          (SELECT c.status FROM public.email_campaigns c WHERE c.id = pg_temp.cid((SELECT c FROM k WHERE name='paige'))),
  'superseded/draft', 'a decline from the approvals queue returns the campaign to a draft');

-- ── 8–9. Approve, then send: suppression after approval, expired lease, duplicate record ───────
SELECT is(pg_temp.admin(format('SELECT public.email_campaign_approve(%L::uuid)', pg_temp.vid((SELECT c FROM k WHERE name='saved'))))->>'recipients', '5',
  'an admin approves the five-person send');
-- After approval: B is suppressed (complaint), C marks do-not-contact.
INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
VALUES ('e03e0200-0000-4000-8000-000000000001','e03e0300-0000-4000-8000-000000000002','ben.e03@tests.invalid','email','complaint','webhook');
UPDATE public.clients SET do_not_contact = true WHERE id = 'e03e0300-0000-4000-8000-000000000003';
INSERT INTO k VALUES ('claim1', pg_temp.claim());
SELECT is((SELECT c->'campaign'->>'id' FROM k WHERE name='claim1'), pg_temp.cid((SELECT c FROM k WHERE name='saved'))::text,
  'the send claims this campaign');
SELECT is(jsonb_array_length((SELECT c FROM k WHERE name='claim1')->'recipients'), 3, 'the send leases only the three still eligible');
SELECT is(pg_temp.rcpt(pg_temp.vid((SELECT c FROM k WHERE name='saved'))),
  'A:sending B:skipped:suppressed C:skipped:opted_out D:sending E:sending',
  'suppressed and opted-out people are skipped at send, after approval');
-- The worker hands A to the provider and records it; a repeat record of the same send changes nothing.
SELECT is(pg_temp.svc(format('SELECT to_jsonb(public.email_campaign_dispatch_begin(%L::uuid))', pg_temp.rid(pg_temp.vid((SELECT c FROM k WHERE name='saved')),'A'))) #>> '{}', 'true',
  'A is handed to the provider');
SELECT is(pg_temp.svc(format($$SELECT to_jsonb(public.email_campaign_dispatch_record(%L::uuid, 'sent', 'prov-a-1'))$$, pg_temp.rid(pg_temp.vid((SELECT c FROM k WHERE name='saved')),'A'))) #>> '{}', 'sent',
  'A is recorded as sent');
SELECT is(pg_temp.svc(format($$SELECT to_jsonb(public.email_campaign_dispatch_record(%L::uuid, 'sent', 'prov-a-2'))$$, pg_temp.rid(pg_temp.vid((SELECT c FROM k WHERE name='saved')),'A'))) #>> '{}', 'already_sent',
  'a duplicate record of the same send is refused');
SELECT is((SELECT provider_message_id FROM public.email_campaign_recipients WHERE id = pg_temp.rid(pg_temp.vid((SELECT c FROM k WHERE name='saved')),'A')),
  'prov-a-1', 'the first provider id stands');
SELECT is(pg_temp.svc(format('SELECT to_jsonb(public.email_campaign_dispatch_begin(%L::uuid))', pg_temp.rid(pg_temp.vid((SELECT c FROM k WHERE name='saved')),'A'))) #>> '{}', 'false',
  'a sent recipient is never handed out again');
-- D is handed off and no result ever comes back: its lease runs out.
SELECT is(pg_temp.svc(format('SELECT to_jsonb(public.email_campaign_dispatch_begin(%L::uuid))', pg_temp.rid(pg_temp.vid((SELECT c FROM k WHERE name='saved')),'D'))) #>> '{}', 'true',
  'D is handed to the provider');
UPDATE public.email_campaign_recipients SET lease_until = now() - interval '1 minute'
 WHERE id = pg_temp.rid(pg_temp.vid((SELECT c FROM k WHERE name='saved')),'D');
-- E is recorded failed, so the next claim has nothing planned left to lease.
SELECT is(pg_temp.svc(format($$SELECT to_jsonb(public.email_campaign_dispatch_record(%L::uuid, 'failed', NULL, NULL, NULL, 'mailbox full'))$$, pg_temp.rid(pg_temp.vid((SELECT c FROM k WHERE name='saved')),'E'))) #>> '{}', 'failed',
  'E is recorded as failed');
SELECT ok(pg_temp.claim()->'campaign'->>'id' IS DISTINCT FROM pg_temp.cid((SELECT c FROM k WHERE name='saved'))::text,
  'nothing of this campaign is left to lease');
SELECT is((SELECT status FROM public.email_campaign_recipients WHERE id = pg_temp.rid(pg_temp.vid((SELECT c FROM k WHERE name='saved')),'D')),
  'outcome_unknown', 'an expired lease becomes outcome unknown');
SELECT is(pg_temp.svc(format('SELECT to_jsonb(public.email_campaign_dispatch_begin(%L::uuid))', pg_temp.rid(pg_temp.vid((SELECT c FROM k WHERE name='saved')),'D'))) #>> '{}', 'false',
  'an unknown outcome is never handed out again');
SELECT is(pg_temp.svc(format($$SELECT to_jsonb(public.email_campaign_dispatch_record(%L::uuid, 'sent', 'late'))$$, pg_temp.rid(pg_temp.vid((SELECT c FROM k WHERE name='saved')),'D'))) #>> '{}', 'already_outcome_unknown',
  'a late result cannot overwrite the unknown outcome');

-- ── 11. Settle reads the rows; a new version never re-sends to anyone already reached ──────────
SELECT is(pg_temp.svc(format('SELECT public.email_campaign_dispatch_settle(%L::uuid)', pg_temp.cid((SELECT c FROM k WHERE name='saved'))))->>'status', 'partially_completed',
  'settled as partly completed (one sent, one failed, one unknown)');
SELECT is((SELECT v.state||'/'||a.status FROM public.email_campaign_versions v JOIN public.paige_pending_approvals a ON a.id = v.approval_id
            WHERE v.id = pg_temp.vid((SELECT c FROM k WHERE name='saved'))), 'sent/sent', 'the version and its approval read sent');
-- B's complaint is lifted and C opts back in; the owner sends the campaign again as a new version.
DELETE FROM public.paige_suppressions WHERE contact_id = 'e03e0300-0000-4000-8000-000000000002';
UPDATE public.clients SET do_not_contact = false WHERE id = 'e03e0300-0000-4000-8000-000000000003';
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)',
            pg_temp.owner(format('SELECT to_jsonb(public.email_campaign_new_version(%L::uuid))', pg_temp.cid((SELECT c FROM k WHERE name='saved')))) #>> '{}'))->>'recipients', '3',
  'the resend plans three people');
SELECT is(pg_temp.rcpt(pg_temp.cur((SELECT c FROM k WHERE name='saved'))),
  'B:planned C:planned E:planned', 'A (sent) and D (outcome unknown) are never planned again; E (failed) may be retried');

-- ── 10. Cancel mid-send: nothing planned goes, a leased hand-off is refused, nothing settles ───
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_approve(%L::uuid)', pg_temp.cur((SELECT c FROM k WHERE name='saved'))))->>'recipients', '3',
  'the resend is approved');
UPDATE k SET c = jsonb_build_object('campaign_id', pg_temp.cid(c), 'version_id', pg_temp.cur(c)) WHERE name = 'saved';
INSERT INTO k VALUES ('claim2', pg_temp.svc('SELECT public.email_campaign_dispatch_claim(2)'));
SELECT is((SELECT c->'campaign'->>'id' FROM k WHERE name='claim2'), pg_temp.cid((SELECT c FROM k WHERE name='saved'))::text,
  'the resend is claimed');
SELECT is(pg_temp.tally(pg_temp.vid((SELECT c FROM k WHERE name='saved'))), 'planned:1 sending:2', 'two recipients are leased, one still planned');
-- Which two were leased depends on row order; take them as leased.
INSERT INTO k SELECT 'lease'||row_number() OVER (ORDER BY r.id), jsonb_build_object('id', r.id)
  FROM public.email_campaign_recipients r WHERE r.version_id = pg_temp.vid((SELECT c FROM k WHERE name='saved')) AND r.status = 'sending';
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_cancel(%L::uuid)', pg_temp.cid((SELECT c FROM k WHERE name='saved'))))->>'cancelled_recipients', '1',
  'the owner cancels mid-send; the one still planned is cancelled');
SELECT is(pg_temp.svc(format('SELECT to_jsonb(public.email_campaign_dispatch_begin(%L::uuid))', (SELECT c->>'id' FROM k WHERE name='lease1'))) #>> '{}', 'false',
  'the leased recipient is refused at hand-off');
-- The other leased recipient was held back by the pre-send checks before anything left; the worker
-- records it deferred (back to planned).
SELECT is(pg_temp.svc(format($$SELECT to_jsonb(public.email_campaign_dispatch_record(%L::uuid, 'deferred'))$$, (SELECT c->>'id' FROM k WHERE name='lease2'))) #>> '{}', 'deferred',
  'a held-back recipient is recorded deferred');
UPDATE public.email_campaign_recipients SET not_before = NULL
 WHERE id = (SELECT (c->>'id')::uuid FROM k WHERE name='lease2'); -- tampering: the hold has ended
SELECT ok(pg_temp.claim()->'campaign'->>'id' IS DISTINCT FROM pg_temp.cid((SELECT c FROM k WHERE name='saved'))::text,
  'a cancelled campaign is never claimed again, even with someone planned');
SELECT is(pg_temp.tally(pg_temp.vid((SELECT c FROM k WHERE name='saved'))), 'cancelled:2 planned:1',
  'nobody under the cancelled send was sent to; the held-back one is still only planned');
SELECT is(pg_temp.svc(format('SELECT public.email_campaign_dispatch_settle(%L::uuid)', pg_temp.cid((SELECT c FROM k WHERE name='saved'))))->>'settled', 'false',
  'a cancelled campaign does not settle as sent');
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_submit_for_approval(%L::uuid, %L::uuid)',
            'e03e0200-0000-4000-8000-000000000001', pg_temp.cid((SELECT c FROM k WHERE name='saved'))))->>'error', 'campaign_stopped',
  'PAIGE cannot refile a stopped campaign');

SELECT * FROM finish();
ROLLBACK;
