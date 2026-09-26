-- ============================================================================
-- Report uploads, and the stored files behind them, belong to exactly one tenant.
--
-- Proves, for the upload record and its file in storage: every upload carries the tenant it was
-- made in; a tenant's admins and assignees reach that tenant's uploads and files and no other's,
-- even when the person the upload is about is also known to another tenant; a stored file is
-- reachable by staff only through its upload record, so a file with no record is reachable only by
-- its owner; a staff member files the record before the file; and the tenant is filled, refused,
-- validated and fixed as intended.
--
-- Synthetic fixtures only. Asserts counts and refusals, never field values. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(24);

-- Production's API-role grants are reproduced in the rebuilt database by the database-contract job
-- (scripts/ci/reproduce-production-grants.mjs), so this proof exercises the policies as production
-- would, with no grants of its own.

DO $$
DECLARE
  _a uuid := 'a5520000-0000-0000-0000-00000000000a';
  _b uuid := 'a5520000-0000-0000-0000-00000000000b';
  _ada uuid := 'a5520000-0000-0000-0000-0000000000a1';  -- admin of A
  _adb uuid := 'a5520000-0000-0000-0000-0000000000b1';  -- admin of B
  _sa uuid := 'a5520000-0000-0000-0000-0000000005a1';   -- member of A, assigned to Y
  _x uuid := 'a5520000-0000-0000-0000-000000000e01';    -- member of A, and a client of B
  _y uuid := 'a5520000-0000-0000-0000-000000000e02';    -- a client of A, member of nothing
  _z uuid := 'a5520000-0000-0000-0000-000000000e03';    -- belongs to nothing
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (_ada, 'cr-admin-a@example.test'), (_adb, 'cr-admin-b@example.test'), (_sa, 'cr-assignee-a@example.test'),
    (_x, 'cr-person-x@example.test'), (_y, 'cr-client-y@example.test'), (_z, 'cr-person-z@example.test');
  INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
    (_a, 'cr-scope-a', 'CR Scope A', 'active', 'standalone', 'CRA', '{}'),
    (_b, 'cr-scope-b', 'CR Scope B', 'active', 'standalone', 'CRB', '{}');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
    (_a, _ada, 'admin', 'active', false), (_b, _adb, 'admin', 'active', false),
    (_a, _sa, 'member', 'active', false), (_a, _x, 'member', 'active', false);
  -- S21: an assignee reads their own assignment rows only while holding the global 'coach' role.
  -- Remove with S21.
  INSERT INTO public.user_roles (user_id, role) VALUES (_sa, 'coach') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
    (_ada, _a), (_adb, _b), (_sa, _a), (_x, _a), (_y, NULL), (_z, NULL)
  ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
  INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, linked_user_id) VALUES
    ('a5520000-0000-0000-0000-00000000c1e1', _b, _adb, 'X', 'Client', 'CRX-1', _x),
    ('a5520000-0000-0000-0000-00000000c1e2', _a, _ada, 'Y', 'Client', 'CRY-1', _y);
  INSERT INTO public.coach_clients (tenant_id, coach_user_id, client_user_id, status) VALUES (_a, _sa, _y, 'active');
END $$;

-- Uploads are made the way the platform makes them: by the person, in their context. None names a
-- tenant. U1: X's own report, made while working in A. U2: Y's own report, as a client of A.
SELECT set_config('request.jwt.claims', '{"sub":"a5520000-0000-0000-0000-000000000e01","role":"authenticated"}', true);
INSERT INTO public.credit_report_uploads (user_id, uploaded_by, file_name, file_path)
VALUES ('a5520000-0000-0000-0000-000000000e01', 'a5520000-0000-0000-0000-000000000e01', 'u1.pdf',
        'a5520000-0000-0000-0000-000000000e01/cr-u1.pdf');
SELECT set_config('request.jwt.claims', '{"sub":"a5520000-0000-0000-0000-000000000e02","role":"authenticated"}', true);
INSERT INTO public.credit_report_uploads (user_id, uploaded_by, file_name, file_path)
VALUES ('a5520000-0000-0000-0000-000000000e02', 'a5520000-0000-0000-0000-000000000e02', 'u2.pdf',
        'a5520000-0000-0000-0000-000000000e02/cr-u2.pdf');
SELECT set_config('request.jwt.claims', '', true);
-- The stored files, plus one with no upload record.
INSERT INTO storage.objects (bucket_id, name, owner_id, metadata) VALUES
  ('credit-report-uploads', 'a5520000-0000-0000-0000-000000000e01/cr-u1.pdf', 'a5520000-0000-0000-0000-000000000e01', '{"size":1}'),
  ('credit-report-uploads', 'a5520000-0000-0000-0000-000000000e02/cr-u2.pdf', 'a5520000-0000-0000-0000-000000000e02', '{"size":1}'),
  ('credit-report-uploads', 'a5520000-0000-0000-0000-000000000e02/cr-orphan.pdf', 'a5520000-0000-0000-0000-000000000e02', '{"size":1}');

-- Each person's view, read as that person and stored for assertion after RESET ROLE.
SELECT set_config('request.jwt.claims', '{"sub":"a5520000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('cr.admin_b_rows', (SELECT count(*) FROM public.credit_report_uploads WHERE file_path LIKE '%/cr-u1.pdf')::text, true);
  PERFORM set_config('cr.admin_b_objects', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'credit-report-uploads' AND name LIKE '%/cr-u1.pdf')::text, true);
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"a5520000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('cr.admin_a_rows', (SELECT count(*) FROM public.credit_report_uploads WHERE file_path LIKE '%/cr-u1.pdf')::text, true);
  PERFORM set_config('cr.admin_a_objects', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'credit-report-uploads' AND name LIKE '%/cr-u1.pdf')::text, true);
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"a5520000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('cr.assignee_rows', (SELECT count(*) FROM public.credit_report_uploads WHERE file_path LIKE '%/cr-u2.pdf')::text, true);
  PERFORM set_config('cr.assignee_objects', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'credit-report-uploads' AND name LIKE '%/cr-u2.pdf')::text, true);
  PERFORM set_config('cr.assignee_orphan', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'credit-report-uploads' AND name LIKE '%/cr-orphan.pdf')::text, true);
END $$;
-- A staff member files the record, then the file.
DO $$ BEGIN
  INSERT INTO public.credit_report_uploads (user_id, uploaded_by, file_name, file_path)
  VALUES ('a5520000-0000-0000-0000-000000000e02', 'a5520000-0000-0000-0000-0000000005a1', 'u3.pdf',
          'a5520000-0000-0000-0000-000000000e02/cr-u3.pdf');
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
  VALUES ('credit-report-uploads', 'a5520000-0000-0000-0000-000000000e02/cr-u3.pdf', 'a5520000-0000-0000-0000-0000000005a1', '{"size":1}');
  PERFORM set_config('cr.assignee_record_then_file', 'ok', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('cr.assignee_record_then_file', SQLSTATE, true);
END $$;
-- A file with no record behind it.
DO $$ BEGIN
  INSERT INTO storage.objects (bucket_id, name, owner_id, metadata)
  VALUES ('credit-report-uploads', 'a5520000-0000-0000-0000-000000000e02/cr-norecord.pdf', 'a5520000-0000-0000-0000-0000000005a1', '{"size":1}');
  PERFORM set_config('cr.assignee_file_without_record', 'ok', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('cr.assignee_file_without_record', SQLSTATE, true);
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"a5520000-0000-0000-0000-000000000e02","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('cr.owner_orphan', (SELECT count(*) FROM storage.objects WHERE bucket_id = 'credit-report-uploads' AND name LIKE '%/cr-orphan.pdf')::text, true);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- 1–2. The upload record follows the tenant it was made in, not the person's client record elsewhere.
SELECT is(current_setting('cr.admin_b_rows')::int, 0,
  'an admin of another tenant does not see an upload made in this tenant');
SELECT is(current_setting('cr.admin_a_rows')::int, 1,
  'an admin sees an upload made in their tenant');
-- 3. The assignee still sees the assigned client's upload.
SELECT is(current_setting('cr.assignee_rows')::int, 1,
  'an assignee sees the assigned client''s upload in their tenant');
-- 4–5. The stored file follows its upload record.
SELECT is(current_setting('cr.admin_b_objects')::int, 0,
  'an admin of another tenant cannot reach the file behind this tenant''s upload');
SELECT is(current_setting('cr.admin_a_objects')::int, 1,
  'an admin reaches the file behind an upload in their tenant');
-- 6. The assignee reaches the assigned client's file.
SELECT is(current_setting('cr.assignee_objects')::int, 1,
  'an assignee reaches the file behind the assigned client''s upload');
-- 7–8. A file with no upload record is its owner's alone.
SELECT is(current_setting('cr.assignee_orphan')::int, 0,
  'staff cannot reach a file that no upload record stands behind');
SELECT is(current_setting('cr.owner_orphan')::int, 1,
  'the owner still reaches their own file');
-- 9–10. Staff file the record first; a file with no record is refused.
SELECT is(current_setting('cr.assignee_record_then_file'), 'ok',
  'a staff member can file the record and then the file');
SELECT isnt(current_setting('cr.assignee_file_without_record'), 'ok',
  'a staff member cannot store a file with no upload record behind it');

-- 11–12. The tenant is part of the upload.
SELECT has_column('public', 'credit_report_uploads', 'tenant_id', 'an upload records its tenant');
SELECT col_not_null('public', 'credit_report_uploads', 'tenant_id', 'and cannot exist without one');

-- 13. Each upload took the tenant it was made in: the maker's active tenant, or the one client record.
SELECT is((SELECT count(*)::int FROM public.credit_report_uploads
            WHERE file_path LIKE '%/cr-u%' AND tenant_id = 'a5520000-0000-0000-0000-00000000000a'), 3,
  'uploads take their tenant from the maker''s active tenant or their single client record');

-- 14. With no client record, no signed-in maker and nobody the upload can belong to, it is refused.
SELECT throws_like($q$
  INSERT INTO public.credit_report_uploads (user_id, uploaded_by, file_name, file_path)
  VALUES ('a5520000-0000-0000-0000-000000000e03', 'a5520000-0000-0000-0000-000000000e03', 'n.pdf', 'a5520000-0000-0000-0000-000000000e03/cr-n.pdf')$q$,
  'UPLOAD_TENANT_UNRESOLVED:%', 'an upload with no resolvable tenant is refused');

-- 15. A tenant that is not the client record's is refused.
SELECT throws_like($q$
  INSERT INTO public.credit_report_uploads (tenant_id, user_id, uploaded_by, client_id, file_name, file_path)
  VALUES ('a5520000-0000-0000-0000-00000000000b', 'a5520000-0000-0000-0000-000000000e02',
          'a5520000-0000-0000-0000-000000000e02', 'a5520000-0000-0000-0000-00000000c1e2', 'm.pdf', 'a5520000-0000-0000-0000-000000000e02/cr-m.pdf')$q$,
  'UPLOAD_TENANT_MISMATCH:%', 'an upload cannot name a tenant other than its client record''s');

-- 16. An upload about someone who does not belong to the named tenant is refused.
SELECT throws_like($q$
  INSERT INTO public.credit_report_uploads (tenant_id, user_id, uploaded_by, file_name, file_path)
  VALUES ('a5520000-0000-0000-0000-00000000000b', 'a5520000-0000-0000-0000-0000000005a1',
          'a5520000-0000-0000-0000-0000000005a1', 'f.pdf', 'a5520000-0000-0000-0000-0000000005a1/cr-f.pdf')$q$,
  'UPLOAD_SUBJECT_NOT_IN_TENANT:%', 'an upload cannot be placed in a tenant its subject does not belong to');

-- 17. The tenant cannot be changed after the fact.
SELECT throws_like($q$
  UPDATE public.credit_report_uploads SET tenant_id = 'a5520000-0000-0000-0000-00000000000b'
   WHERE file_path LIKE '%/cr-u1.pdf'$q$,
  'UPLOAD_TENANT_IMMUTABLE:%', 'an upload''s tenant cannot be changed');

-- 18. A signed-in maker cannot place an upload in a tenant they do not act in. The subject belongs
--     to B (as a client); only the maker does not.
SELECT set_config('request.jwt.claims', '{"sub":"a5520000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);
SELECT throws_like($q$
  INSERT INTO public.credit_report_uploads (tenant_id, user_id, uploaded_by, file_name, file_path)
  VALUES ('a5520000-0000-0000-0000-00000000000b', 'a5520000-0000-0000-0000-000000000e01',
          'a5520000-0000-0000-0000-0000000005a1', 's.pdf', 'a5520000-0000-0000-0000-000000000e01/cr-s.pdf')$q$,
  'UPLOAD_MAKER_NOT_IN_TENANT:%', 'a signed-in maker cannot stamp an upload with a tenant they do not act in');
SELECT set_config('request.jwt.claims', '', true);

-- 19. A record can only name a file in its subject's own folder.
SELECT throws_like($q$
  INSERT INTO public.credit_report_uploads (user_id, uploaded_by, file_name, file_path)
  VALUES ('a5520000-0000-0000-0000-000000000e02', 'a5520000-0000-0000-0000-000000000e02', 'p.pdf',
          'a5520000-0000-0000-0000-000000000e01/cr-foreign.pdf')$q$,
  'UPLOAD_FILE_OUTSIDE_SUBJECT:%', 'a record cannot name a file outside its subject''s folder');

-- 20. A record's file cannot be repointed after the fact.
SELECT throws_like($q$
  UPDATE public.credit_report_uploads SET file_path = 'a5520000-0000-0000-0000-000000000e01/cr-other.pdf'
   WHERE file_path LIKE '%/cr-u1.pdf'$q$,
  'UPLOAD_FILE_IMMUTABLE:%', 'a record''s file cannot be changed');

-- 21. One file, one record.
SELECT throws_ok($q$
  INSERT INTO public.credit_report_uploads (user_id, uploaded_by, file_name, file_path)
  VALUES ('a5520000-0000-0000-0000-000000000e02', 'a5520000-0000-0000-0000-000000000e02', 'd.pdf',
          'a5520000-0000-0000-0000-000000000e02/cr-u2.pdf')$q$,
  '23505', NULL, 'a second record cannot claim a file that already has one');

-- 22. Staff cannot adopt a stored file that no record stands behind.
SELECT set_config('request.jwt.claims', '{"sub":"a5520000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);
SELECT throws_like($q$
  INSERT INTO public.credit_report_uploads (user_id, uploaded_by, file_name, file_path)
  VALUES ('a5520000-0000-0000-0000-000000000e02', 'a5520000-0000-0000-0000-0000000005a1', 'o.pdf',
          'a5520000-0000-0000-0000-000000000e02/cr-orphan.pdf')$q$,
  'UPLOAD_FILE_ALREADY_STORED:%', 'staff cannot adopt an existing file that no record stands behind');
SELECT set_config('request.jwt.claims', '', true);

-- 23. A record naming a client record is about that client and no one else.
SELECT throws_like($q$
  INSERT INTO public.credit_report_uploads (user_id, uploaded_by, client_id, file_name, file_path)
  VALUES ('a5520000-0000-0000-0000-000000000e03', 'a5520000-0000-0000-0000-0000000000a1',
          'a5520000-0000-0000-0000-00000000c1e2', 'c.pdf', 'a5520000-0000-0000-0000-000000000e03/cr-c.pdf')$q$,
  'UPLOAD_CLIENT_MISMATCH:%', 'a record naming a client record must be about that client');

-- 24. Removing a client record detaches its uploads and keeps their tenant.
INSERT INTO public.credit_report_uploads (user_id, uploaded_by, client_id, file_name, file_path)
VALUES ('a5520000-0000-0000-0000-000000000e02', 'a5520000-0000-0000-0000-0000000000a1',
        'a5520000-0000-0000-0000-00000000c1e2', 'u4.pdf', 'a5520000-0000-0000-0000-000000000e02/cr-u4.pdf');
DELETE FROM public.clients WHERE id = 'a5520000-0000-0000-0000-00000000c1e2';
SELECT is((SELECT count(*)::int FROM public.credit_report_uploads
            WHERE file_path LIKE '%/cr-u4.pdf' AND client_id IS NULL
              AND tenant_id = 'a5520000-0000-0000-0000-00000000000a'), 1,
  'removing a client record detaches its uploads and keeps their tenant');

SELECT * FROM finish();
ROLLBACK;
