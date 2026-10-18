-- E09 Documents: the customer sees ONLY the files the business explicitly shares, plus their own
-- uploads. public.client_files + the private client-files bucket stay the one canonical file store
-- (§18); no new table, bucket, event kind, executor or RLS policy. Additive, every new owner file
-- private by default (production held 0 client_files rows at grounding; any shared row is backfilled):
--   * client_files.shared_at / shared_by — derived by a trigger on EVERY writer; they cannot be
--     forged, and a CHECK holds them even where the trigger is skipped. shared_by follows its
--     ON DELETE SET NULL, so deleting the user who shared a still-shared file succeeds.
--   * The same trigger makes client_file_set_client_share the ONLY signed-in route by which a
--     business shows a client a file (the customer's own upload is the other way a client gains one;
--     deleting a file still withdraws it, and renaming a shared one relabels it, without an audit row
--     — recorded known limits): a direct REST write, Paige's re-file or another DEFINER body
--     that moves visibility into or out of 'shared' is refused (FILE_SHARE_WRITER_REQUIRED), and so
--     is moving a SHARED file to another client (FILE_SHARED_MOVE_REFUSED) — the share writer's
--     gate does not open a move. A signed-in caller withdraws the share through the share writer
--     (audited) and then moves a private file. Only the service role and a direct database session
--     (migrations, pg_cron) may move a shared file; it arrives private, its stamp cleared, and the
--     trigger writes no audit row for it (no such writer exists today). §58: before this release a
--     move kept the file shared and silently re-shared it with the new client.
--     The other incumbent route to a client is their own upload: the customer read policy shows any
--     'client_upload' row on the customer's contact, and storage serves its object to whoever the row
--     names as uploader. So a signed-in, non-service write may only make a row 'client_upload' (insert,
--     or relabel from another visibility) when its uploader IS that contact's linked login in that
--     business (FILE_CLIENT_UPLOAD_PROVENANCE): the customer's own reservation; never a staff relabel.
--     A file's id, object, uploader and business are fixed for signed-in writers
--     (FILE_IDENTITY_IMMUTABLE); only the tenants foreign key's own ON DELETE SET NULL still passes.
--   * client_file_owner_begin_upload / client_file_owner_finish_upload — the owner's reservation
--     and object-verified finish, mirroring the customer pair (20271108150000:66-106, 240-271). A
--     reservation needs the same roles as the staff storage PUT, so no caller is left with a
--     pending row it can never fill.
--   * client_file_set_client_share — the ONE share writer: current-workspace business admin,
--     version-guarded, state-idempotent, audited (public.audit_logs, entity 'client_files'). It
--     opens the trigger's gate with a transaction-local flag around its one UPDATE only.
--   * client_file_owner_list — the owner's read, pinned to tenant AND contact (the "Staff read
--     files" policy has a coach arm with no tenant predicate; this read does not use it), paged by
--     a (created_at, id) keyset so the owner can load every file, never just the newest 100.
--   * client_portal_documents — the customer's read: shared+ready files and their own uploads of
--     their OWN relationship through an exact allowlist, paged by the same (created_at, id)
--     keyset so two files saved in the same instant are never skipped. Signed URLs ride the incumbent
--     client_files_get storage policy, which re-checks the row under the customer's RLS.
--   * operations_delivery_client_read_scoped — restated with clients.status / tenants.status
--     'active'; decide and reviews_scoped go through it and inherit the check.
--   * Fold-ins (§9): a customer can no longer DELETE their own client_upload row over REST, and a
--     staff PUT into the bucket needs a pending reservation row (the unreachable ContactFilesPanel
--     upload stops working; called out under §58 in the PR).
BEGIN;

-- ── 1a. The share stamp ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.client_files
  ADD COLUMN shared_at timestamptz,
  ADD COLUMN shared_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill before the trigger exists: a row already shared (by Paige's chat, before this release)
-- was shared no later than its last write. Who shared it is not recorded, so shared_by stays NULL;
-- every reader requires shared_at on a shared row and never reads shared_by. updated_at moves to
-- now() under trg_client_files_updated, which is harmless: no client holds a version of it yet.
UPDATE public.client_files SET shared_at = updated_at WHERE visibility = 'shared' AND shared_at IS NULL;
ALTER TABLE public.client_files ADD CONSTRAINT client_files_share_stamp_consistent CHECK (
  CASE WHEN visibility = 'shared' THEN shared_at IS NOT NULL ELSE shared_at IS NULL AND shared_by IS NULL END);

-- Derived, never written: a shared row carries when (and by whom) it was shared to THIS client;
-- anything else carries nothing. A direct write to either column is overwritten, so the stamp stays
-- truthful on every write path.
--
-- The gate. Moving a file into or out of 'shared' is the client-visible act, so only
-- client_file_set_client_share (business admin, live client, finished upload, version, audit) may
-- do it for a signed-in caller: it sets paige.client_file_share='on' (transaction-local) around its
-- one UPDATE. Exempt: the service role (Edge functions acting as the platform), and a direct
-- database session with no API request (migrations, pg_cron, a psql fixture). Everything else —
-- a REST UPDATE/INSERT under any RLS arm, Paige's re-file through the caller's client, a future
-- DEFINER body called by a signed-in user — is refused, so no share skips the audit.
--
-- Moving a SHARED file to another client takes access away from the client who had it, so a
-- signed-in caller may not do it at all — not even inside the share writer's gate, which opens
-- visibility only. They withdraw the share through client_file_set_client_share (one audit row)
-- and move the now-private file. The service role or a direct database session may move a shared
-- file; it arrives private (the new client was never shown it). Requesting the move AND 'shared' in
-- one write is refused like any other direct share.
--
-- A file's identity is fixed once the row exists: no signed-in caller may change its id,
-- storage_path, uploaded_by_user_id or tenant_id (FILE_IDENTITY_IMMUTABLE). Storage authorizes a
-- customer's download by matching the object name to a storage_path they may see, so rewriting the
-- path of a SHARED row would show that client whatever object it now names, another client's private
-- file included, with no share writer and no audit row. A new id would cut the file loose from its
-- client_share audit rows. A new business would show a shared row to whichever client of that
-- business its contact is (a platform owner's write; the update policy already stops everyone else).
-- No product writer changes any of these (the finish functions change upload_state only, Paige's
-- re-file contact_id and description). tenant_id may still become NULL through the tenants foreign
-- key's ON DELETE SET NULL (a nested write, pg_trigger_depth() > 1): refusing that would block
-- deleting a business. A direct write may not NULL it: the customer read policy resolves a NULL
-- business to whichever business the contact's login belongs to, so it is a move like any other.
--
-- A client sees a 'client_upload' row on their contact, and storage serves its object to the login
-- the row names as uploader, so relabelling a file as the client's own upload (or inserting one) is
-- a share by another name: it skips the share writer, its audit and its checks, records a false
-- "the client sent this", and cannot be undone (customer upload provenance is immutable). A
-- signed-in, non-service write may only make a row 'client_upload' when its uploader is the contact's
-- linked login in the row's business (FILE_CLIENT_UPLOAD_PROVENANCE). The customer's reservation
-- (client_portal_begin_file_upload) is exactly that; no staff writer creates one (ContactFilesPanel
-- never uploads into that tab, Paige's crm_file_document refuses it).
--
-- shared_by follows auth.users ON DELETE SET NULL: that referential action is an UPDATE of this
-- table nested inside the delete (pg_trigger_depth() > 1) that sets shared_by NULL, and the stamp
-- keeps it NULL instead of restoring the deleted user (which would fail the foreign key and roll the
-- user's deletion back). A top-level write can never clear it: there the stored sharer wins.
CREATE OR REPLACE FUNCTION public._client_files_share_stamp()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_role text := nullif(auth.role(), '');
  v_platform boolean;
  v_writer boolean;
BEGIN
  v_platform := v_role = 'service_role' OR current_user = 'service_role'
    OR (v_role IS NULL AND current_user NOT IN ('authenticated', 'anon'));
  v_writer := v_platform OR current_setting('paige.client_file_share', true) IS NOT DISTINCT FROM 'on';
  IF TG_OP = 'UPDATE' AND NOT v_platform AND (NEW.id IS DISTINCT FROM OLD.id
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
     OR (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id AND NOT (NEW.tenant_id IS NULL AND pg_trigger_depth() > 1))) THEN
    RAISE EXCEPTION 'FILE_IDENTITY_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  IF NOT v_platform AND NEW.visibility = 'client_upload'
     AND (TG_OP = 'INSERT' OR OLD.visibility IS DISTINCT FROM 'client_upload')
     AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = NEW.contact_id AND c.tenant_id = NEW.tenant_id
       AND c.linked_user_id = NEW.uploaded_by_user_id) THEN
    RAISE EXCEPTION 'FILE_CLIENT_UPLOAD_PROVENANCE' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.contact_id IS DISTINCT FROM OLD.contact_id AND OLD.visibility = 'shared'
     AND NOT v_platform THEN
    RAISE EXCEPTION 'FILE_SHARED_MOVE_REFUSED' USING ERRCODE = '42501',
      HINT = 'Withdraw the share through public.client_file_set_client_share, then move the private file.';
  END IF;
  IF NOT v_writer AND (
       (TG_OP = 'INSERT' AND NEW.visibility = 'shared')
    OR (TG_OP = 'UPDATE' AND (OLD.visibility = 'shared') IS DISTINCT FROM (NEW.visibility = 'shared'))) THEN
    RAISE EXCEPTION 'FILE_SHARE_WRITER_REQUIRED' USING ERRCODE = '42501',
      HINT = 'Share or unshare a client file through public.client_file_set_client_share.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.contact_id IS DISTINCT FROM OLD.contact_id AND NEW.visibility = 'shared' THEN
    NEW.visibility := 'internal';
  END IF;
  IF NEW.visibility = 'shared' THEN
    IF TG_OP = 'UPDATE' AND OLD.visibility = 'shared' AND NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id THEN
      NEW.shared_at := coalesce(OLD.shared_at, now());
      NEW.shared_by := CASE WHEN NEW.shared_by IS NULL AND pg_trigger_depth() > 1 THEN NULL ELSE OLD.shared_by END;
    ELSE
      NEW.shared_at := now();
      NEW.shared_by := coalesce(auth.uid(), CASE WHEN TG_OP = 'INSERT' THEN NEW.shared_by END);
    END IF;
  ELSE
    NEW.shared_at := NULL;
    NEW.shared_by := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._client_files_share_stamp() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_client_files_share_stamp
  BEFORE INSERT OR UPDATE ON public.client_files
  FOR EACH ROW EXECUTE FUNCTION public._client_files_share_stamp();
CREATE INDEX idx_client_files_contact_shared ON public.client_files(tenant_id, contact_id, visibility, created_at DESC);

-- ── Owner row projection (owner list, reservation, finish) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public._client_file_owner_row(f public.client_files)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id', f.id, 'filename', f.original_filename, 'mime_type', f.mime_type,
    'size_bytes', f.size_bytes, 'visibility', f.visibility, 'upload_state', f.upload_state,
    'source', CASE WHEN f.visibility = 'client_upload' THEN 'client' ELSE 'business' END,
    'shared_at', f.shared_at, 'created_at', f.created_at, 'updated_at', f.updated_at,
    'storage_path', f.storage_path)
$$;
REVOKE ALL ON FUNCTION public._client_file_owner_row(public.client_files) FROM PUBLIC, anon, authenticated, service_role;

-- ── 1b. The owner's reservation and finish ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_file_owner_begin_upload(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_contact_id uuid, p_file_id uuid,
  p_filename text, p_mime_type text, p_size_bytes bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_account_type text;
  v_parent uuid;
  v_tenant_status text;
  v_extension text;
  v_path text;
  v_file public.client_files%ROWTYPE;
BEGIN
  -- 1. Caller: the session subject, and the caller's own expectation of who they are.
  IF v_actor IS NULL OR p_expected_actor_id IS NULL OR v_actor IS DISTINCT FROM p_expected_actor_id
     OR p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  -- A workspace switch updates this same profile row; holding its lock serializes against it.
  PERFORM 1 FROM public.profiles WHERE user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501'; END IF;
  -- 2. Workspace and role: the current workspace, business owner/admin of it. Never a global role
  -- alone (§59). The staff storage PUT (client_portal_can_upload_file_object, below) ALSO needs the
  -- platform owner or the global admin role, so the reservation asks for the same: a business admin
  -- without it, or a platform admin in the company workspace, could reserve but never store, and
  -- would be left with a pending row. The global role is an extra requirement here, never authority.
  v_tenant := public.current_user_tenant_id();
  IF v_tenant IS DISTINCT FROM p_expected_tenant_id OR NOT public.is_tenant_admin(v_tenant)
     OR NOT (public.is_platform_owner() OR public.has_role(v_actor, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  IF p_contact_id IS NULL OR p_file_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST');
  END IF;
  -- 3. Tier: a top-level agency manages sub-accounts, not a direct client book (§61 exception).
  SELECT t.account_type::text, t.parent_tenant_id, t.status::text INTO v_account_type, v_parent, v_tenant_status
  FROM public.tenants t WHERE t.id = v_tenant FOR SHARE;
  IF (v_account_type = 'agency' AND v_parent IS NULL) OR v_tenant_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_FILES_UNAVAILABLE');
  END IF;
  -- 4. Client: a live client of this business. Another business's client reads as missing.
  PERFORM 1 FROM public.clients c WHERE c.id = p_contact_id AND c.tenant_id = v_tenant
    AND c.status = 'active' AND c.merged_into_contact_id IS NULL FOR SHARE OF c;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND'); END IF;
  -- 5. The same name, type, extension and size rules as the customer's reservation.
  v_extension := lower(substring(p_filename from '\.([^.]+)$'));
  IF p_filename IS NULL OR p_filename <> btrim(p_filename) OR length(p_filename) NOT BETWEEN 1 AND 255
    OR p_filename ~ '[[:cntrl:]/\\]' OR v_extension IS NULL OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 20971520
    OR p_mime_type IS NULL OR NOT (
      (p_mime_type = 'application/pdf' AND v_extension = 'pdf')
      OR (p_mime_type = 'image/jpeg' AND v_extension IN ('jpg','jpeg'))
      OR (p_mime_type = 'image/png' AND v_extension = 'png')
      OR (p_mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' AND v_extension = 'docx')) THEN
    RAISE EXCEPTION 'Choose a PDF, JPG, PNG or DOCX file up to 20 MB.' USING ERRCODE = '22023';
  END IF;
  -- 6. Reserve. The server fixes the path; a file always starts private (owner decision D1).
  v_path := v_tenant::text || '/' || p_contact_id::text || '/internal/' || p_file_id::text;
  INSERT INTO public.client_files(id, tenant_id, contact_id, uploaded_by_user_id, storage_path,
    original_filename, mime_type, size_bytes, visibility, upload_state)
  VALUES (p_file_id, v_tenant, p_contact_id, v_actor, v_path, p_filename, p_mime_type, p_size_bytes, 'internal', 'pending')
  ON CONFLICT (id) DO NOTHING;
  SELECT * INTO v_file FROM public.client_files WHERE id = p_file_id FOR UPDATE;
  -- A retry of the same reservation answers from the row; anything else with this id is refused.
  IF v_file.tenant_id IS DISTINCT FROM v_tenant OR v_file.contact_id IS DISTINCT FROM p_contact_id
    OR v_file.uploaded_by_user_id IS DISTINCT FROM v_actor OR v_file.storage_path IS DISTINCT FROM v_path
    OR v_file.original_filename IS DISTINCT FROM p_filename OR v_file.mime_type IS DISTINCT FROM p_mime_type
    OR v_file.size_bytes IS DISTINCT FROM p_size_bytes OR v_file.visibility = 'client_upload' THEN
    RAISE EXCEPTION 'FILE_RESERVATION_CONFLICT' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('ok', true, 'file', public._client_file_owner_row(v_file));
END;
$$;
REVOKE ALL ON FUNCTION public.client_file_owner_begin_upload(uuid, uuid, uuid, uuid, text, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_file_owner_begin_upload(uuid, uuid, uuid, uuid, text, text, bigint) TO authenticated;
COMMENT ON FUNCTION public.client_file_owner_begin_upload(uuid, uuid, uuid, uuid, text, text, bigint) IS
  'E09 Documents: reserve a private owner upload on one client of the current workspace. Business owner/admin only; never a top-level agency. The server fixes {tenant}/{contact}/internal/{file_id}; the row starts internal + pending. Idempotent for an identical retry; a conflicting retry is refused.';

CREATE OR REPLACE FUNCTION public.client_file_owner_finish_upload(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_file_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_account_type text;
  v_parent uuid;
  v_contact uuid;
  v_file public.client_files%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR p_expected_actor_id IS NULL OR v_actor IS DISTINCT FROM p_expected_actor_id
     OR p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.profiles WHERE user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501'; END IF;
  v_tenant := public.current_user_tenant_id();
  IF v_tenant IS DISTINCT FROM p_expected_tenant_id OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  IF p_file_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST'); END IF;
  SELECT t.account_type::text, t.parent_tenant_id INTO v_account_type, v_parent
  FROM public.tenants t WHERE t.id = v_tenant;
  IF v_account_type = 'agency' AND v_parent IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_FILES_UNAVAILABLE');
  END IF;
  -- Only the caller's own reservation in this workspace, at exactly the path the server fixed.
  SELECT f.contact_id INTO v_contact FROM public.client_files f
  WHERE f.id = p_file_id AND f.tenant_id = v_tenant AND f.uploaded_by_user_id = v_actor
    AND f.visibility <> 'client_upload';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'FILE_NOT_FOUND'); END IF;
  -- Same lock order as the reservation: client, then file.
  PERFORM 1 FROM public.clients c WHERE c.id = v_contact AND c.tenant_id = v_tenant
    AND c.status = 'active' AND c.merged_into_contact_id IS NULL FOR SHARE OF c;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND'); END IF;
  SELECT * INTO v_file FROM public.client_files f
  WHERE f.id = p_file_id AND f.tenant_id = v_tenant AND f.contact_id = v_contact AND f.uploaded_by_user_id = v_actor
    AND f.visibility <> 'client_upload'
    AND f.storage_path = v_tenant::text || '/' || v_contact::text || '/internal/' || f.id::text
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'FILE_NOT_FOUND'); END IF;
  -- The object the caller actually stored: same path, same owner, the declared size and type.
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'client-files' AND o.name = v_file.storage_path
    AND o.owner_id = v_actor::text
    AND CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,10}$' THEN (o.metadata->>'size')::bigint END = v_file.size_bytes
    AND o.metadata->>'mimetype' = v_file.mime_type) THEN
    RAISE EXCEPTION 'The saved upload could not be verified. Check its status before trying again.' USING ERRCODE = '22023';
  END IF;
  IF v_file.upload_state = 'ready' THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'file', public._client_file_owner_row(v_file));
  END IF;
  UPDATE public.client_files SET upload_state = 'ready' WHERE id = v_file.id RETURNING * INTO v_file;
  -- Audit only: the file is private, so nothing reaches the client's Rail.
  INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
  VALUES (v_actor, 'client_files', 'owner_file_uploaded', v_file.id,
    jsonb_build_object('tenant_id', v_tenant, 'contact_id', v_contact, 'file_id', v_file.id));
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'file', public._client_file_owner_row(v_file));
END;
$$;
REVOKE ALL ON FUNCTION public.client_file_owner_finish_upload(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_file_owner_finish_upload(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.client_file_owner_finish_upload(uuid, uuid, uuid) IS
  'E09 Documents: finish the caller''s own owner upload after verifying the stored object (path, owner, size, type). Business owner/admin of the current workspace only. Flips pending to ready and writes one audit row (client_files / owner_file_uploaded); a repeat replays. The file stays private.';

-- ── 1c. The owner's share writer ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_file_set_client_share(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_file_id uuid, p_shared boolean,
  p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_account_type text;
  v_parent uuid;
  v_row public.client_files%ROWTYPE;
  v_linked uuid;
  v_client_found boolean;
BEGIN
  -- 1. Caller.
  IF v_actor IS NULL OR p_expected_actor_id IS NULL OR v_actor IS DISTINCT FROM p_expected_actor_id
     OR p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.profiles WHERE user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501'; END IF;
  -- 2. Workspace and role (§59).
  v_tenant := public.current_user_tenant_id();
  IF v_tenant IS DISTINCT FROM p_expected_tenant_id OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  IF p_file_id IS NULL OR p_shared IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST');
  END IF;
  -- 3. Tier (§61 exception, as Slice 3).
  SELECT t.account_type::text, t.parent_tenant_id INTO v_account_type, v_parent
  FROM public.tenants t WHERE t.id = v_tenant;
  IF v_account_type = 'agency' AND v_parent IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_FILES_UNAVAILABLE');
  END IF;
  -- 4. Load. Another workspace's file is indistinguishable from a missing one.
  SELECT * INTO v_row FROM public.client_files WHERE id = p_file_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'FILE_NOT_FOUND'); END IF;
  -- 5. Shape. What the client sent stays theirs; an unfinished upload has nothing to show.
  IF v_row.visibility = 'client_upload' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FILE_IS_CLIENT_UPLOAD');
  END IF;
  IF v_row.upload_state <> 'ready' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FILE_NOT_READY');
  END IF;
  SELECT c.linked_user_id INTO v_linked FROM public.clients c
  WHERE c.id = v_row.contact_id AND c.tenant_id = v_tenant AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL
  FOR SHARE OF c;
  v_client_found := FOUND;
  -- Sharing needs a live client. Withdrawing a share never does: unsharing is always allowed.
  IF NOT v_client_found AND p_shared THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND');
  END IF;
  -- 6. State replay: a retry of a change that already landed answers from the row, writes nothing.
  IF (v_row.visibility = 'shared') = p_shared THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'file_id', v_row.id, 'shared', p_shared,
      'shared_at', v_row.shared_at, 'updated_at', v_row.updated_at, 'portal_connected', v_linked IS NOT NULL);
  END IF;
  -- 7. Version: the owner shares exactly the file they last saw.
  IF p_expected_updated_at IS NULL OR v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FILE_CHANGED', 'updated_at', v_row.updated_at);
  END IF;
  -- 8. Write. The share-stamp trigger records shared_at / shared_by; the flag opens its gate for
  -- this one UPDATE and is closed again before anything else runs in the transaction.
  PERFORM set_config('paige.client_file_share', 'on', true);
  UPDATE public.client_files SET visibility = CASE WHEN p_shared THEN 'shared' ELSE 'internal' END::public.client_file_visibility
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  PERFORM set_config('paige.client_file_share', 'off', true);
  -- 9. Audit. Fixed references only, never a filename.
  INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
  VALUES (v_actor, 'client_files', CASE WHEN p_shared THEN 'client_share' ELSE 'client_unshare' END, v_row.id,
    jsonb_build_object('tenant_id', v_tenant, 'contact_id', v_row.contact_id, 'file_id', v_row.id));
  -- 10. Result. portal_connected says whether the client can see it yet. No notification is sent (D4).
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'file_id', v_row.id, 'shared', p_shared,
    'shared_at', v_row.shared_at, 'updated_at', v_row.updated_at, 'portal_connected', v_linked IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.client_file_set_client_share(uuid, uuid, uuid, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_file_set_client_share(uuid, uuid, uuid, boolean, timestamptz) TO authenticated;
COMMENT ON FUNCTION public.client_file_set_client_share(uuid, uuid, uuid, boolean, timestamptz) IS
  'E09 Documents: the share writer for client_files. Business owner/admin of the current workspace; never a top-level agency. Refuses a client''s own upload and an unfinished upload. Version-guarded on updated_at; state-idempotent (a repeat returns replayed:true and writes nothing). Audited to audit_logs as client_files / client_share | client_unshare. No notification is sent.';

-- ── 1d. The owner's read ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_file_owner_list(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_contact_id uuid, p_limit integer DEFAULT 100,
  p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_account_type text;
  v_parent uuid;
  v_linked boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_files jsonb;
  v_more boolean;
BEGIN
  IF v_actor IS NULL OR p_expected_actor_id IS NULL OR v_actor IS DISTINCT FROM p_expected_actor_id
     OR p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_user_tenant_id();
  IF v_tenant IS DISTINCT FROM p_expected_tenant_id OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  -- A page cursor is the (created_at, id) of the last file shown; both halves or neither.
  IF p_contact_id IS NULL OR (p_before IS NULL) <> (p_before_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST');
  END IF;
  SELECT t.account_type::text, t.parent_tenant_id INTO v_account_type, v_parent
  FROM public.tenants t WHERE t.id = v_tenant;
  IF v_account_type = 'agency' AND v_parent IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_FILES_UNAVAILABLE');
  END IF;
  SELECT (c.linked_user_id IS NOT NULL AND c.status = 'active' AND c.merged_into_contact_id IS NULL) INTO v_linked
  FROM public.clients c WHERE c.id = p_contact_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND'); END IF;
  -- Finished files of this client in this business, plus the caller's own unfinished uploads so
  -- they can finish or abandon them. A client's unfinished upload is theirs until it is verified.
  -- Newest first by (created_at, id); the next page starts strictly after the cursor row, so a file
  -- that shares the cursor's created_at is neither repeated nor skipped.
  WITH ranked AS (
    SELECT f AS rec, row_number() OVER (ORDER BY f.created_at DESC, f.id DESC) AS rn
    FROM public.client_files f
    WHERE f.tenant_id = v_tenant AND f.contact_id = p_contact_id
      AND (f.upload_state = 'ready' OR (f.visibility <> 'client_upload' AND f.uploaded_by_user_id = v_actor))
      AND (p_before IS NULL OR (f.created_at, f.id) < (p_before, p_before_id))
  )
  SELECT coalesce(jsonb_agg(public._client_file_owner_row(r.rec) ORDER BY r.rn) FILTER (WHERE r.rn <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  INTO v_files, v_more FROM ranked r WHERE r.rn <= v_limit + 1;
  RETURN jsonb_build_object('ok', true, 'contact_id', p_contact_id, 'portal_connected', v_linked,
    'files', v_files, 'has_more', v_more);
END;
$$;
REVOKE ALL ON FUNCTION public.client_file_owner_list(uuid, uuid, uuid, integer, timestamptz, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.client_file_owner_list(uuid, uuid, uuid, integer, timestamptz, uuid) TO authenticated;
COMMENT ON FUNCTION public.client_file_owner_list(uuid, uuid, uuid, integer, timestamptz, uuid) IS
  'E09 Documents: the business''s file library for one client, pinned to the current workspace AND the client. Business owner/admin only; never a top-level agency. Finished files plus the caller''s own unfinished uploads, newest first by (created_at, id), up to 100 a page; the next page passes the last row''s created_at and id as p_before / p_before_id. Descriptions and uploader ids are not projected.';

-- ── 1e. The customer's read ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_portal_documents(
  p_tenant_id uuid DEFAULT NULL, p_limit integer DEFAULT 50, p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  _summary jsonb;
  _files jsonb;
  _has_more boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  -- A page cursor is the (created_at, id) of the last file shown; both halves or neither.
  IF (p_before IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'a page cursor needs both p_before and p_before_id' USING ERRCODE = '22023';
  END IF;
  -- 42501 "select an authorized customer relationship" (more than one business) propagates as is.
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  -- Re-prove the relationship; the business is the client's own, never the argument's.
  SELECT c.tenant_id INTO _tenant FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active';
  IF _tenant IS NULL THEN RETURN NULL; END IF;

  -- Explicit allowlist. Description, uploader, sharer, visibility and upload_state are never
  -- projected; `source` and `state` say what the customer needs to know.
  WITH visible AS (
    SELECT f.* FROM public.client_files f
    WHERE f.tenant_id = _tenant AND f.contact_id = _client_id
      AND ((f.visibility = 'shared' AND f.upload_state = 'ready')
        OR (f.visibility = 'client_upload' AND f.uploaded_by_user_id = _uid))
  ), page AS (
    SELECT v.*, row_number() OVER (ORDER BY v.created_at DESC, v.id DESC) AS rn
    -- Keyset (created_at, id): a file that shares the cursor's instant is never skipped.
    FROM visible v WHERE p_before IS NULL OR (v.created_at, v.id) < (p_before, p_before_id)
  )
  SELECT
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'filename', p.original_filename,
        'mime_type', p.mime_type,
        'size_bytes', p.size_bytes,
        'source', CASE WHEN p.visibility = 'client_upload' THEN 'you' ELSE 'business' END,
        'state', p.upload_state,
        'shared_at', p.shared_at,
        'created_at', p.created_at,
        'storage_path', p.storage_path) ORDER BY p.rn), '[]'::jsonb)
     FROM page p WHERE p.rn <= _limit),
    (SELECT count(*) > _limit FROM page),
    (SELECT jsonb_build_object(
        'shared', count(*) FILTER (WHERE v.visibility = 'shared'),
        'from_you', count(*) FILTER (WHERE v.visibility = 'client_upload')) FROM visible v)
  INTO _files, _has_more, _summary;
  RETURN jsonb_build_object('tenant_id', _tenant, 'client_id', _client_id, 'summary', _summary,
    'files', _files, 'has_more', _has_more);
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_documents(uuid, integer, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_documents(uuid, integer, timestamptz, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.client_portal_documents(uuid, integer, timestamptz, uuid) IS
  'E09 Documents: customer-safe projection of the caller''s OWN relationship''s files: what the business shared (finished uploads only) plus the caller''s own uploads, pending included, newest first by (created_at, id); the next page passes the last row''s created_at and id as p_before / p_before_id. Name, type, size, source, state, dates and the storage path the browser signs a 60-second URL for; storage re-authorizes that path under the customer''s RLS.';

-- ── 1f. Released work: the client and the business must both be active ────────────────────────
-- Restated from 20271031005010:4-30 (the live body, checked byte-identical), adding only
-- c.status='active' and t.status='active'. decide_scoped and reviews_scoped call this function.
create or replace function public.operations_delivery_client_read_scoped(p_release_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_result jsonb;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id then
    raise exception 'DELIVERY_CLIENT_UNAVAILABLE' using errcode='42501'; end if;
  select jsonb_build_object('actor_id',v_actor,'tenant_id',r.tenant_id,'release_id',r.id,
    'submission_id',s.id,'state',r.state,'revision_no',s.revision_no,'artifact_digest',s.artifact_digest,
    'title',a.snapshot->>'title','body',a.snapshot->>'body','updated_at',r.updated_at,
    'decision_by',r.decision_by,'decision_at',r.decision_at,'client_note',r.client_note)
  into v_result from public.operations_delivery_client_releases r
  join public.operations_delivery_submissions s on s.id=r.submission_id and s.tenant_id=r.tenant_id and s.client_id=r.client_id
  join public.clients c on c.id=r.client_id and c.tenant_id=r.tenant_id and c.linked_user_id=r.client_user_id and c.merged_into_contact_id is null and c.status='active'
  join public.tenants t on t.id=r.tenant_id and t.account_type::text='standalone' and t.parent_tenant_id is null and t.status='active'
  join public.plans p on p.id=s.plan_id and p.tenant_id=r.tenant_id and p.status<>'archived'
  join public.plan_items w on w.id=s.work_item_id and w.tenant_id=r.tenant_id and w.plan_id=p.id and w.contact_id=c.id and w.status<>'cancelled'
  join public.studio_artifact_versions a on a.id=s.artifact_version_id and a.tenant_id=r.tenant_id
  where r.id=p_release_id and r.tenant_id=p_expected_tenant_id and r.client_user_id=v_actor and s.state='approved'
    and not exists(select 1 from public.tenant_members where tenant_id=r.tenant_id and user_id=v_actor and status='active')
    and not exists(select 1 from public.operations_delivery_submissions where work_item_id=s.work_item_id and revision_no>s.revision_no)
    and encode(extensions.digest(a.snapshot::text,'sha256'),'hex')=s.artifact_digest
    and a.kind='content' and a.snapshot->>'kind'='text';
  if v_result is null then raise exception 'DELIVERY_CLIENT_UNAVAILABLE' using errcode='42501'; end if;
  return v_result;
end $$;
revoke all on function public.operations_delivery_client_read_scoped(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.operations_delivery_client_read_scoped(uuid,uuid,uuid) to authenticated;

-- ── 1g.1 Fold-in: a customer no longer deletes their own upload metadata over REST ─────────────
-- Before: the permissive "Uploader or admin delete files" policy admitted the uploader, and this
-- restrictive policy kept an uploader arm, so a customer could DELETE their client_upload row and
-- orphan its object with no audit (customer Storage DELETE is not permitted). §37 consumers: no
-- customer UI deletes (ClientDocuments.tsx, useClientDocuments.ts); handle_data_subject_request
-- is SECURITY DEFINER and only exports client_files. The UPDATE policy is unchanged.
ALTER POLICY client_upload_delete_current_relationship ON public.client_files
  USING (visibility <> 'client_upload' OR public.is_platform_owner() OR public.is_tenant_admin(tenant_id));

-- ── 1g.2 Fold-in: a staff PUT needs a reservation ──────────────────────────────────────────────
-- Restated from 20271108150000:110-129, adding only the reservation EXISTS to the 4-part staff
-- branch. §37 producers: client_file_owner_begin_upload (this migration) reserves first; the
-- unreachable ContactFilesPanel.tsx upload (PUT, then a direct insert) no longer works and is
-- called out under §58; consumer_invite_acceptance.sql's staff fixture moves to the reservation.
CREATE OR REPLACE FUNCTION public.client_portal_can_upload_file_object(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE _uid uuid:=auth.uid();_parts text[]:=string_to_array(p_name,'/');_tenant uuid;_contact uuid;
BEGIN
 IF _uid IS NULL OR cardinality(_parts) NOT IN (4,5)
  OR _parts[1]!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR _parts[2]!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR _parts[3] NOT IN ('internal','shared','client_upload') OR p_name ~ '(^|/)\.\.?(/|$)' THEN RETURN false; END IF;
 _tenant:=_parts[1]::uuid;_contact:=_parts[2]::uuid;
 IF cardinality(_parts)=5 AND _parts[3]='client_upload' AND _parts[4]=_uid::text
  AND _contact=public.client_portal_relationship_id(_tenant) THEN
  RETURN EXISTS(SELECT 1 FROM public.client_files f WHERE f.storage_path=p_name AND f.tenant_id=_tenant
   AND f.contact_id=_contact AND f.uploaded_by_user_id=_uid AND f.visibility='client_upload'
   AND f.upload_state='pending' AND f.created_at>now()-interval '1 day');
 END IF;
 RETURN cardinality(_parts)=4 AND _parts[4]<>'' AND EXISTS(SELECT 1 FROM public.clients c
  JOIN public.tenants t ON t.id=c.tenant_id WHERE c.id=_contact AND c.tenant_id=_tenant AND t.status='active'
  AND (public.is_platform_owner() OR (_tenant=public.current_user_tenant_id()
   AND public.is_tenant_admin(_tenant) AND public.has_role(_uid,'admin'::public.app_role))))
  AND EXISTS(SELECT 1 FROM public.client_files f WHERE f.storage_path=p_name AND f.tenant_id=_tenant
   AND f.contact_id=_contact AND f.uploaded_by_user_id=_uid AND f.visibility<>'client_upload'
   AND f.upload_state='pending' AND f.created_at>now()-interval '1 day');
END $$;
REVOKE ALL ON FUNCTION public.client_portal_can_upload_file_object(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.client_portal_can_upload_file_object(text) TO authenticated,service_role;

COMMENT ON COLUMN public.client_files.shared_at IS 'When this file was shared with its client. Derived by trg_client_files_share_stamp on every write; set exactly when visibility = shared (client_files_share_stamp_consistent).';
COMMENT ON COLUMN public.client_files.shared_by IS 'Who shared this file with its client (auth.uid() at the share). Derived by trg_client_files_share_stamp; NULL unless visibility = shared, and NULL for a row shared before this column existed.';
COMMENT ON FUNCTION public._client_files_share_stamp() IS 'E09 Documents: derives shared_at/shared_by (shared_by follows its ON DELETE SET NULL); refuses (42501 FILE_SHARE_WRITER_REQUIRED) any signed-in, non-service write that moves a file into or out of shared unless client_file_set_client_share opened the gate, (42501 FILE_SHARED_MOVE_REFUSED) any signed-in, non-service move of a shared file to another client (a service-role move arrives internal), (42501 FILE_IDENTITY_IMMUTABLE) any signed-in, non-service change of id, storage_path, uploaded_by_user_id or tenant_id (only the tenants foreign key''s ON DELETE SET NULL passes), and (42501 FILE_CLIENT_UPLOAD_PROVENANCE) any signed-in, non-service write that makes a row client_upload unless its uploader is the contact''s linked login in that business.';

COMMIT;
