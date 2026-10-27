-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Files through the governed email door — rollback proof for 20271120000000_comms_email_governed_attachments.sql.
--
-- ISOLATED database only (the rebuilt CI stack, or a throwaway clone); never COMMIT. The migration
-- carries its own BEGIN/COMMIT, so it is NOT \ir'd here: it is already applied by the stack's
-- `migration up`, and this proof checks the applied bodies by md5. Run from the repo root:
--   psql -X -v ON_ERROR_STOP=1 -f supabase/tests/comms_email_governed_attachments.sql
-- Ends with a report row and RAISES if any assertion failed, so psql exits non-zero.
--
-- Proves: the three new functions are service_role-only SECURITY DEFINER with a pinned search_path and
-- the 15-argument prepare has no defaults; the 13- and 14-argument prepares and the actor check are
-- byte-identical; the manifest check admits only this tenant's and operation's governed copies, numbered
-- in order, existing in storage at exactly their size, within the type and size limits; a prepare with
-- files writes binding.attachments and messages.attachments in one update (immediate: a draft; scheduled:
-- queued with its time); a replay with other (or no) files or another time is a mismatch; another
-- business's manifest, a drafted reply, a non-seat and a sender outside the SendGrid arm get no row; the
-- binding read and the claim carry the files; members may read governed copies but never insert, update
-- or delete one, while their own uploads are unchanged; the retention list names only copies no send
-- will need. Fixtures are fresh uuids, test-tenant-* slugs and .tests.invalid mail (§63). No provider
-- and no Storage API is called: objects are rows in storage.objects.
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

-- ── 0. shape, grants and the bodies that must not move ───────────────────────────────────────
SELECT pg_temp.ok(1, (SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig,',')='search_path=pg_catalog, public'
    AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
    AND has_function_privilege('service_role',p.oid,'EXECUTE')) AND count(*)=3
  FROM pg_proc p WHERE p.oid IN ('public._comms_email_attachment_manifest_ok(uuid,uuid,jsonb)'::regprocedure,
   'public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz,jsonb)'::regprocedure,
   'public.list_governed_comms_attachment_orphans(integer)'::regprocedure)),
  'the three new functions are SECURITY DEFINER, search_path pinned, service_role only');
SELECT pg_temp.ok(2, (SELECT pronargdefaults=0 FROM pg_proc WHERE oid='public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz,jsonb)'::regprocedure),
  'the prepare with files has no defaults (an email without files can never reach it)');
SELECT pg_temp.ok(3, (SELECT count(*)=3 AND bool_and(md5(p.prosrc)=e.body) FROM (VALUES
   ('public._comms_email_actor(uuid,uuid)'::regprocedure,'c9850c30ae7885c23eee1da268c8c0e0'),
   ('public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)'::regprocedure,'8da3b64c24552123b973db96a74ab986'),
   ('public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz)'::regprocedure,'432b0c8548b9e0c52a0b0a52acbee4c3')) e(f,body)
  JOIN pg_proc p ON p.oid=e.f),
  'the actor check and the 13- and 14-argument prepares are byte-identical (no existing body replaced)');
SELECT pg_temp.ok(4, (SELECT count(*)=3 AND bool_and(NOT p.polpermissive AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')])
   AND string_agg(p.polcmd::text, '' ORDER BY p.polcmd)='adw'
  FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass AND p.polname LIKE 'comms\_email\_governed\_files\_%\_boundary'),
  'three RESTRICTIVE storage policies for authenticated: insert, update, delete (select is untouched)');

-- ── fixtures ─────────────────────────────────────────────────────────────────────────────────
-- U1 owner, U3 member of business T1; T2 a second business. R a managed ('resend') sender, G a Gmail one.
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
SELECT u::uuid, 'authenticated', 'authenticated', 'files-proof-' || right(u, 1) || '@example.tests.invalid', now()
FROM unnest(ARRAY['5f11e000-0000-4000-8000-000000000001','5f11e000-0000-4000-8000-000000000003']) u;
INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, account_number, features) VALUES
 ('5f11e100-0000-4000-8000-000000000001','test-tenant-files-one','Files Proof One','active','standalone','FILA',987101,'{}'),
 ('5f11e100-0000-4000-8000-000000000002','test-tenant-files-two','Files Proof Two','active','standalone','FILB',987102,'{}');
INSERT INTO public.tenant_members (tenant_id, user_id, status, role, is_owner) VALUES
 ('5f11e100-0000-4000-8000-000000000001','5f11e000-0000-4000-8000-000000000001','active','owner'::public.tenant_role,true),
 ('5f11e100-0000-4000-8000-000000000001','5f11e000-0000-4000-8000-000000000003','active','member'::public.tenant_role,false);
INSERT INTO public.profiles (user_id, active_tenant_id)
SELECT u::uuid, '5f11e100-0000-4000-8000-000000000001'
FROM unnest(ARRAY['5f11e000-0000-4000-8000-000000000001','5f11e000-0000-4000-8000-000000000003']) u
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, email) VALUES
 ('5f11e200-0000-4000-8000-000000000001','5f11e100-0000-4000-8000-000000000001','5f11e000-0000-4000-8000-000000000001','Proof','Lead','lead.files@example.tests.invalid');
INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary)
SELECT '5f11e100-0000-4000-8000-000000000001','5f11e200-0000-4000-8000-000000000001','email','lead.files@example.tests.invalid',true
WHERE NOT EXISTS (SELECT 1 FROM public.client_contact_methods WHERE client_id='5f11e200-0000-4000-8000-000000000001' AND kind='email');
INSERT INTO public.channel_connectors (id, tenant_id, channel_type, provider, from_address, status, active) VALUES
 ('5f11e300-0000-4000-8000-000000000001','5f11e100-0000-4000-8000-000000000001','email','resend','hello@files.tests.invalid','active',true),
 ('5f11e300-0000-4000-8000-000000000002','5f11e100-0000-4000-8000-000000000001','email','gmail','owner@files.tests.invalid','active',true);

CREATE FUNCTION pg_temp.t1() RETURNS uuid LANGUAGE sql AS $$ SELECT '5f11e100-0000-4000-8000-000000000001'::uuid $$;
CREATE FUNCTION pg_temp.op(_n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('5f11e400-0000-4000-8000-'||lpad(_n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql AS $$ SELECT ('5f11e000-0000-4000-8000-'||lpad(_n::text,12,'0'))::uuid $$;
CREATE FUNCTION pg_temp.msg(_n int) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(_n)::text $$;
CREATE FUNCTION pg_temp.b(_n int) RETURNS jsonb LANGUAGE sql AS $$ SELECT meta->'comms_email_binding' FROM public.messages WHERE id=pg_temp.msg(_n) $$;
-- One manifest entry (file _i, 1-based) of operation _n for tenant _t, with a governed copy of _size bytes.
CREATE FUNCTION pg_temp.e(_n int, _i int, _name text, _size bigint DEFAULT 1000, _t uuid DEFAULT NULL, _mime text DEFAULT 'application/pdf') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('path', coalesce(_t, pg_temp.t1())::text||'/governed/'||pg_temp.op(_n)::text||'/'||_i||'-'||_name,
  'source_path', coalesce(_t, pg_temp.t1())::text||'/5f11e900-0000-4000-8000-'||lpad(_i::text,12,'0')||'-'||_name,
  'name', _name, 'mime', _mime, 'size', _size, 'sha256', repeat(to_hex(_i), 64 / length(to_hex(_i)))) $$;
CREATE FUNCTION pg_temp.put(_path text, _size bigint) RETURNS void LANGUAGE sql AS $$
 INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
 VALUES ('comms-attachments', _path, '5f11e000-0000-4000-8000-000000000001', jsonb_build_object('size', _size, 'mimetype', 'application/pdf')) $$;
-- The 13 arguments as the door builds them, from connector _c; subject 'File note n' keeps contents distinct.
CREATE FUNCTION pg_temp.args(_n int, _actor uuid, _c text DEFAULT '5f11e300-0000-4000-8000-000000000001', _from text DEFAULT 'hello@files.tests.invalid') RETURNS text LANGUAGE sql AS $$
 SELECT format('%L::uuid,%L::uuid,%L::uuid,%L::uuid,%L,%L::uuid,%L,%L,%L,%L,%L,%L::jsonb',
  _actor,pg_temp.t1(),pg_temp.op(_n),'5f11e200-0000-4000-8000-000000000001','lead.files@example.tests.invalid',
  _c,_from,'File note '||_n,'Hello there.','<p>Hello there.</p>',
  encode(extensions.digest(convert_to('lead.files@example.tests.invalid'||E'\n'||_c||E'\n'||'File note '||_n||E'\n'||'Hello there.','UTF8'),'sha256'),'hex'),
  jsonb_build_object('action','comms.email_send','contact_id','5f11e200-0000-4000-8000-000000000001','connector_id',_c,'subject','File note '||_n,'body','Hello there.')) $$;
CREATE FUNCTION pg_temp.gov(_actor uuid, _extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('actor_user_id',_actor,'tenant_id',pg_temp.t1(),
  'tool','comms_send_email','action','comms.email_send','approval_channel','operator_card','approved_fingerprint','0123456789abcdef',
  'decision_receipt_recorded',true) || _extra $$;
CREATE FUNCTION pg_temp.prep(_n int, _actor uuid, _send_at timestamptz, _files jsonb, _gov jsonb DEFAULT '{}'::jsonb,
  _c text DEFAULT '5f11e300-0000-4000-8000-000000000001', _from text DEFAULT 'hello@files.tests.invalid') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb; BEGIN
 EXECUTE format('SELECT public.prepare_comms_email_send(%s,%L::jsonb,%L::timestamptz,%L::jsonb)', pg_temp.args(_n,_actor,_c,_from), pg_temp.gov(_actor,_gov), _send_at, _files) INTO r;
 RETURN r; END $$;
CREATE FUNCTION pg_temp.ok_manifest(_n int, _m jsonb, _t uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql AS $$
 SELECT public._comms_email_attachment_manifest_ok(coalesce(_t, pg_temp.t1()), pg_temp.op(_n), _m) $$;
CREATE TEMP TABLE _t AS SELECT date_trunc('minute', now()) + interval '1 hour' AS later;
GRANT SELECT ON _t TO service_role;

-- Governed copies the door would have written: op 1 (two files), op 2 (one), op 3 (scheduled), op 5
-- (Gmail), op 6 (a reply), op 7/8/9 (retention), op 30 (two 8 MiB files), a foreign business's copy.
SELECT pg_temp.put(pg_temp.e(1,1,'proposal.pdf')->>'path', 1000), pg_temp.put(pg_temp.e(1,2,'photo.png',2000)->>'path', 2000),
       pg_temp.put(pg_temp.e(2,1,'a.pdf')->>'path', 1000), pg_temp.put(pg_temp.e(3,1,'a.pdf')->>'path', 1000),
       pg_temp.put(pg_temp.e(5,1,'a.pdf')->>'path', 1000), pg_temp.put(pg_temp.e(6,1,'a.pdf')->>'path', 1000),
       pg_temp.put(pg_temp.e(7,1,'a.pdf')->>'path', 1000), pg_temp.put(pg_temp.e(8,1,'a.pdf')->>'path', 1000),
       pg_temp.put(pg_temp.e(9,1,'a.pdf')->>'path', 1000),
       pg_temp.put(pg_temp.e(30,1,'big1.pdf',8388608)->>'path', 8388608), pg_temp.put(pg_temp.e(30,2,'big2.pdf',8388608)->>'path', 8388608),
       pg_temp.put(pg_temp.e(4,1,'a.pdf',1000,'5f11e100-0000-4000-8000-000000000002')->>'path', 1000);
-- A member's own composer upload (not governed), the control for the storage policies.
SELECT pg_temp.put(pg_temp.t1()::text||'/5f11e900-0000-4000-8000-0000000000aa-mine.pdf', 10);

-- ── 1. the manifest check ────────────────────────────────────────────────────────────────────
SELECT pg_temp.ok(10, pg_temp.ok_manifest(1, jsonb_build_array(pg_temp.e(1,1,'proposal.pdf'), pg_temp.e(1,2,'photo.png',2000))),
  'a manifest of this tenant and operation, numbered in order, whose copies exist at their size, is admitted');
SELECT pg_temp.ok(11, NOT pg_temp.ok_manifest(4, jsonb_build_array(pg_temp.e(4,1,'a.pdf',1000,'5f11e100-0000-4000-8000-000000000002')))
  AND NOT pg_temp.ok_manifest(4, jsonb_build_array(pg_temp.e(4,1,'a.pdf',1000,'5f11e100-0000-4000-8000-000000000002') || jsonb_build_object('source_path', pg_temp.t1()::text||'/5f11e900-0000-4000-8000-000000000001-a.pdf'))),
  'another business''s copy (even with this business''s source path) is refused');
SELECT pg_temp.ok(12, NOT pg_temp.ok_manifest(2, jsonb_build_array(pg_temp.e(1,1,'proposal.pdf')))
  AND NOT pg_temp.ok_manifest(1, jsonb_build_array(pg_temp.e(1,2,'photo.png',2000)))
  AND NOT pg_temp.ok_manifest(1, jsonb_build_array(pg_temp.e(1,1,'proposal.pdf'), pg_temp.e(1,1,'proposal.pdf'))),
  'another operation''s copy, a file renumbered out of order, and a repeated file are refused');
SELECT pg_temp.ok(13, NOT pg_temp.ok_manifest(2, jsonb_build_array(pg_temp.e(2,1,'a.pdf',999)))
  AND NOT pg_temp.ok_manifest(2, jsonb_build_array(pg_temp.e(2,1,'missing.pdf'))),
  'a copy that does not exist, or exists at another size, is refused');
SELECT pg_temp.ok(14, NOT pg_temp.ok_manifest(2, jsonb_build_array(pg_temp.e(2,1,'a.pdf') || '{"extra":1}'))
  AND NOT pg_temp.ok_manifest(2, jsonb_build_array(pg_temp.e(2,1,'a.pdf') - 'sha256'))
  AND NOT pg_temp.ok_manifest(2, jsonb_build_array(pg_temp.e(2,1,'a.pdf') || '{"sha256":"ABC"}'))
  AND NOT pg_temp.ok_manifest(2, jsonb_build_array(pg_temp.e(2,1,'a.pdf',1000,NULL,'image/svg+xml')))
  AND NOT pg_temp.ok_manifest(2, jsonb_build_array(pg_temp.e(2,1,'a.pdf') || '{"size":"1000"}'))
  AND NOT pg_temp.ok_manifest(2, jsonb_build_array(pg_temp.e(2,1,'a.pdf') || '{"name":"b.pdf"}'))
  AND NOT pg_temp.ok_manifest(2, '[]'::jsonb) AND NOT pg_temp.ok_manifest(2, '{}'::jsonb) AND NOT pg_temp.ok_manifest(2, NULL),
  'an extra or missing key, a bad hash, an unknown type, a string size, a name not the source''s, and no files are refused');
SELECT pg_temp.ok(15, NOT pg_temp.ok_manifest(30, jsonb_build_array(pg_temp.e(30,1,'big1.pdf',8388608), pg_temp.e(30,2,'big2.pdf',8388608)))
  AND pg_temp.ok_manifest(30, jsonb_build_array(pg_temp.e(30,1,'big1.pdf',8388608))),
  'two 8 MiB files exceed the 15 MiB total; one is admitted');

-- ── 2. the prepare with files ────────────────────────────────────────────────────────────────
SET LOCAL ROLE service_role;
CREATE TEMP TABLE _r1 AS SELECT pg_temp.prep(1, pg_temp.u(1), NULL, jsonb_build_array(pg_temp.e(1,1,'proposal.pdf'), pg_temp.e(1,2,'photo.png',2000))) r;
SELECT pg_temp.ok(20, (SELECT r->>'ok'='true' AND r->>'replayed'='false' AND r->>'state'='prepared' AND r->>'attachments'='2' FROM _r1)
  AND (SELECT m.status='draft' AND m.scheduled_for IS NULL AND NOT (m.meta->'comms_email_binding' ? 'send_at')
    AND m.meta#>'{comms_email_binding,attachments}'=jsonb_build_array(pg_temp.e(1,1,'proposal.pdf'), pg_temp.e(1,2,'photo.png',2000))
    AND m.attachments=jsonb_build_array(
      jsonb_build_object('url',pg_temp.e(1,1,'proposal.pdf')->>'path','name','proposal.pdf','mime','application/pdf','size',1000),
      jsonb_build_object('url',pg_temp.e(1,2,'photo.png',2000)->>'path','name','photo.png','mime','application/pdf','size',2000))
   FROM public.messages m WHERE m.id=pg_temp.msg(1)),
  'an immediate prepare with files: a draft row whose binding and messages.attachments name the governed copies');
SELECT pg_temp.ok(21, (SELECT r->>'replayed'='true' FROM (SELECT pg_temp.prep(1, pg_temp.u(1), NULL, jsonb_build_array(pg_temp.e(1,1,'proposal.pdf'), pg_temp.e(1,2,'photo.png',2000))) r) x)
  AND (SELECT count(*)=1 FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=pg_temp.op(1)::text),
  'the same prepare again is a replay: one row');
SELECT pg_temp.err(22, 'a replay with fewer files is a mismatch',
  $q$SELECT pg_temp.prep(1, pg_temp.u(1), NULL, jsonb_build_array(pg_temp.e(1,1,'proposal.pdf')))$q$, '22023', 'COMMS_EMAIL_REPLAY_MISMATCH');
SELECT pg_temp.err(23, 'a replay of a file-carrying operation for a later time is a mismatch',
  $q$SELECT pg_temp.prep(1, pg_temp.u(1), (SELECT later FROM _t), jsonb_build_array(pg_temp.e(1,1,'proposal.pdf'), pg_temp.e(1,2,'photo.png',2000)))$q$, '22023', 'COMMS_EMAIL_REPLAY_MISMATCH');
-- An operation prepared WITHOUT files, asked again WITH files.
DO $$ BEGIN EXECUTE format('SELECT public.prepare_comms_email_send(%s,%L::jsonb)', pg_temp.args(2, pg_temp.u(1)), pg_temp.gov(pg_temp.u(1))); END $$;
SELECT pg_temp.err(24, 'an operation prepared without files, asked again with files, is a mismatch',
  $q$SELECT pg_temp.prep(2, pg_temp.u(1), NULL, jsonb_build_array(pg_temp.e(2,1,'a.pdf')))$q$, '22023', 'COMMS_EMAIL_REPLAY_MISMATCH');
SELECT pg_temp.ok(25, (SELECT NOT (meta->'comms_email_binding' ? 'attachments') AND attachments='[]'::jsonb FROM public.messages WHERE id=pg_temp.msg(2)),
  'an email prepared without files is unchanged: no files on its binding or its row');

-- ── 3. what gets no row ──────────────────────────────────────────────────────────────────────
SELECT pg_temp.err(30, 'another business''s manifest is refused',
  $q$SELECT pg_temp.prep(4, pg_temp.u(1), NULL, jsonb_build_array(pg_temp.e(4,1,'a.pdf',1000,'5f11e100-0000-4000-8000-000000000002')))$q$, '22023', 'COMMS_EMAIL_ATTACHMENTS_INVALID');
SELECT pg_temp.err(31, 'a sender outside the SendGrid arm (Gmail) is refused',
  $q$SELECT pg_temp.prep(5, pg_temp.u(1), NULL, jsonb_build_array(pg_temp.e(5,1,'a.pdf')), '{}'::jsonb, '5f11e300-0000-4000-8000-000000000002', 'owner@files.tests.invalid')$q$, '22023', 'COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED');
SELECT pg_temp.err(32, 'a drafted lead reply never carries files',
  $q$SELECT pg_temp.prep(6, pg_temp.u(1), NULL, jsonb_build_array(pg_temp.e(6,1,'a.pdf')), '{"approval_id":"5f11e800-0000-4000-8000-000000000001"}')$q$, '22023', 'COMMS_EMAIL_ATTACHMENTS_NOT_SUPPORTED');
SELECT pg_temp.err(33, 'an agreement signing request never carries files',
  $q$SELECT pg_temp.prep(6, pg_temp.u(1), NULL, jsonb_build_array(pg_temp.e(6,1,'a.pdf')), '{"purpose":"agreement_signature_request"}')$q$, '22023', 'COMMS_EMAIL_ATTACHMENTS_NOT_SUPPORTED');
SELECT pg_temp.err(34, 'no files at all is refused', $q$SELECT pg_temp.prep(6, pg_temp.u(1), NULL, '[]'::jsonb)$q$, '22023', 'COMMS_EMAIL_ATTACHMENTS_INVALID');
SELECT pg_temp.err(35, 'a member who is not owner/admin cannot prepare',
  $q$SELECT pg_temp.prep(6, pg_temp.u(3), NULL, jsonb_build_array(pg_temp.e(6,1,'a.pdf')))$q$, '42501', 'COMMS_EMAIL_AUTHORITY_UNAVAILABLE');
SELECT pg_temp.ok(36, (SELECT count(*)=0 FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}' IN (pg_temp.op(4)::text, pg_temp.op(5)::text, pg_temp.op(6)::text)),
  'no refused prepare left a row (the Gmail refusal rolled back the row the inner prepare inserted)');

-- ── 4. scheduled with files, and the send path carries them ──────────────────────────────────
CREATE TEMP TABLE _r3 AS SELECT pg_temp.prep(3, pg_temp.u(1), (SELECT later FROM _t), jsonb_build_array(pg_temp.e(3,1,'a.pdf'))) r;
SELECT pg_temp.ok(40, (SELECT r->>'send_at'=to_char((SELECT later FROM _t) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM _r3)
  AND (SELECT m.status='queued' AND m.scheduled_for=(SELECT later FROM _t) AND m.meta#>'{comms_email_binding,attachments}'=jsonb_build_array(pg_temp.e(3,1,'a.pdf'))
       AND jsonb_array_length(m.attachments)=1 FROM public.messages m WHERE m.id=pg_temp.msg(3)),
  'a scheduled prepare with files is queued for its time and carries its files');
SELECT pg_temp.ok(41, (SELECT (r->>'eligible')::boolean AND r->'attachments'=jsonb_build_array(pg_temp.e(1,1,'proposal.pdf'), pg_temp.e(1,2,'photo.png',2000))
   FROM (SELECT public.read_comms_email_send_binding(pg_temp.msg(1)) r) x),
  'the binding read send-message uses returns the files and stays eligible');
SELECT pg_temp.ok(42, (SELECT r->'admitted'='true'::jsonb AND r->>'state'='dispatching' FROM (SELECT public.claim_comms_email_send(pg_temp.msg(1),pg_temp.op(1)) r) x)
  AND (SELECT meta#>'{comms_email_binding,attachments}'=jsonb_build_array(pg_temp.e(1,1,'proposal.pdf'), pg_temp.e(1,2,'photo.png',2000)) FROM public.messages WHERE id=pg_temp.msg(1)),
  'the claim admits a file-carrying binding and keeps its files');
RESET ROLE;

-- ── 5. members read governed copies, never write, overwrite or remove one ─────────────────────
CREATE TEMP TABLE _w(k text, n int);
GRANT INSERT, SELECT ON _w TO authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(1), 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok(50, (SELECT count(*)=2 FROM storage.objects WHERE bucket_id='comms-attachments' AND name LIKE pg_temp.t1()::text||'/governed/'||pg_temp.op(1)::text||'/%'),
  'an owner reads their business''s governed copies (SELECT is unchanged)');
SELECT pg_temp.err(51, 'a member cannot upload into the governed folder',
  $q$INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES ('comms-attachments', pg_temp.t1()::text||'/governed/'||pg_temp.op(1)::text||'/3-planted.pdf', pg_temp.u(1)::text, '{"size":5}')$q$,
  '42501', '%row-level security%');
SELECT pg_temp.err(52, 'a member cannot rename their own upload into the governed folder',
  $q$UPDATE storage.objects SET name = pg_temp.t1()::text||'/governed/'||pg_temp.op(2)::text||'/1-a.pdf' WHERE bucket_id='comms-attachments' AND name = pg_temp.t1()::text||'/5f11e900-0000-4000-8000-0000000000aa-mine.pdf'$q$,
  '42501', '%row-level security%');
WITH u AS (UPDATE storage.objects SET metadata = '{"size":1}' WHERE bucket_id='comms-attachments' AND name = pg_temp.e(1,1,'proposal.pdf')->>'path' RETURNING 1)
INSERT INTO _w SELECT 'update_governed', count(*) FROM u;
-- Supabase's storage may also refuse any direct DELETE (a statement trigger asking for the Storage API);
-- either way nothing governed may disappear, which is what is asserted below.
DO $$ DECLARE n int; BEGIN
 DELETE FROM storage.objects WHERE bucket_id='comms-attachments' AND name LIKE pg_temp.t1()::text||'/governed/%';
 GET DIAGNOSTICS n = ROW_COUNT; INSERT INTO _w VALUES ('delete_governed', n);
EXCEPTION WHEN OTHERS THEN INSERT INTO _w VALUES ('delete_governed_refused', 0); END $$;
WITH u AS (UPDATE storage.objects SET metadata = '{"size":10,"touched":true}' WHERE bucket_id='comms-attachments' AND name = pg_temp.t1()::text||'/5f11e900-0000-4000-8000-0000000000aa-mine.pdf' RETURNING 1)
INSERT INTO _w SELECT 'update_own', count(*) FROM u;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT pg_temp.ok(53, (SELECT n=0 FROM _w WHERE k='update_governed') AND (SELECT coalesce(sum(n),0)=0 FROM _w WHERE k LIKE 'delete_governed%')
  AND (SELECT count(*)=1 FROM storage.objects WHERE name = pg_temp.e(1,1,'proposal.pdf')->>'path' AND metadata->>'size'='1000')
  AND (SELECT count(*)=12 FROM storage.objects WHERE bucket_id='comms-attachments' AND name LIKE '%/governed/%'),
  'a member''s UPDATE and DELETE of governed copies touch nothing');
SELECT pg_temp.ok(54, (SELECT n=1 FROM _w WHERE k='update_own'),
  'a member still updates their own composer upload (the boundary covers only the governed folder)');

-- ── 6. retention: only copies no send will ever need ─────────────────────────────────────────
-- op 7: a copy no binding names, two days old (listed). op 8: a send refused eight days ago (listed).
-- op 9: a send refused yesterday (kept). op 1: a claimed send (kept). op 2: a copy no binding names but
-- only an hour old (kept: an approval may still prepare). op 3: a scheduled send (kept). The member's
-- own upload is not governed (never listed).
UPDATE storage.objects SET created_at = now() - interval '2 days' WHERE name LIKE pg_temp.t1()::text||'/governed/%';
UPDATE storage.objects SET created_at = now() - interval '1 hour' WHERE name = pg_temp.e(2,1,'a.pdf')->>'path';
UPDATE storage.objects SET created_at = now() - interval '9 days' WHERE name = pg_temp.t1()::text||'/5f11e900-0000-4000-8000-0000000000aa-mine.pdf';
SET LOCAL ROLE service_role;
SELECT pg_temp.prep(8, pg_temp.u(1), NULL, jsonb_build_array(pg_temp.e(8,1,'a.pdf')));
SELECT pg_temp.prep(9, pg_temp.u(1), NULL, jsonb_build_array(pg_temp.e(9,1,'a.pdf')));
SELECT public.finalize_comms_email_send(pg_temp.msg(8), pg_temp.op(8), 'refused', NULL, 'proof_refusal', NULL);
SELECT public.finalize_comms_email_send(pg_temp.msg(9), pg_temp.op(9), 'refused', NULL, 'proof_refusal', NULL);
RESET ROLE;
UPDATE public.messages SET meta = jsonb_set(meta, '{comms_email_binding,finalized_at}', to_jsonb(now() - interval '8 days')) WHERE id = pg_temp.msg(8);
SET LOCAL ROLE service_role;
CREATE TEMP TABLE _orphans AS SELECT * FROM public.list_governed_comms_attachment_orphans(500) AS name;
RESET ROLE;
SELECT pg_temp.ok(60, (SELECT count(*)=1 FROM _orphans WHERE name = pg_temp.e(7,1,'a.pdf')->>'path')
  AND (SELECT count(*)=1 FROM _orphans WHERE name = pg_temp.e(8,1,'a.pdf')->>'path'),
  'listed: a copy no binding names after a day, and a refused send''s copy a week after it closed');
SELECT pg_temp.ok(61, (SELECT count(*)=0 FROM _orphans WHERE name IN (pg_temp.e(9,1,'a.pdf')->>'path', pg_temp.e(1,1,'proposal.pdf')->>'path',
    pg_temp.e(1,2,'photo.png',2000)->>'path', pg_temp.e(2,1,'a.pdf')->>'path', pg_temp.e(3,1,'a.pdf')->>'path',
    pg_temp.t1()::text||'/5f11e900-0000-4000-8000-0000000000aa-mine.pdf')),
  'kept: a send refused yesterday, a claimed send, a fresh unbound copy, a scheduled send, and anything not governed');
SELECT pg_temp.ok(62, NOT has_function_privilege('authenticated','public.list_governed_comms_attachment_orphans(integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._comms_email_attachment_manifest_ok(uuid,uuid,jsonb)','EXECUTE'),
  'a signed-in person can call neither the retention list nor the manifest check');

SELECT count(*) FILTER (WHERE res='ok') AS ok,
       count(*) FILTER (WHERE res<>'ok') AS failed,
       jsonb_agg(jsonb_build_object('ord', ord, 'res', res, 'label', label) ORDER BY ord) FILTER (WHERE res<>'ok') AS failures
FROM _p;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM _p WHERE res<>'ok') THEN RAISE EXCEPTION 'comms_email_governed_attachments: % assertion(s) failed', (SELECT count(*) FROM _p WHERE res<>'ok'); END IF;
  IF (SELECT count(*) FROM _p) < 34 THEN RAISE EXCEPTION 'comms_email_governed_attachments: only % assertions ran', (SELECT count(*) FROM _p); END IF;
END $$;
ROLLBACK;
