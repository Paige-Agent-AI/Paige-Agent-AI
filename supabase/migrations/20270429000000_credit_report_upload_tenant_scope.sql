-- Report uploads, and the stored files behind them, belong to exactly one tenant.
--
-- `credit_report_uploads` records an uploaded report; its file lives in the `credit-report-uploads`
-- bucket. Until now an upload was tied to a tenant only through "the" client record of the person it
-- is about, so an upload a person made while working in one tenant was visible to the admins of any
-- other tenant that held a client record for them; and staff reached stored files by the person's id
-- in the folder name, with or without an upload record behind the file.
--
-- After this migration:
--   * every upload carries the tenant it was made in: its client record's when it names one, else the
--     signed-in maker's active tenant, else the tenant of the person's single client record; with none
--     of those it is refused;
--   * a named client record fixes the tenant; the person must belong to it; a signed-in maker must act
--     in it; it cannot be changed once written;
--   * admin and assignee access to uploads follows the upload's tenant;
--   * staff reach a stored file only through the upload record whose path it is, so a file with no
--     record is reachable by its owner (and the service role) alone. No file moves; no path changes.
--   * the owner's own access, by the first folder of the path, is unchanged;
--   * a record names exactly one file, in its subject's own folder, and never changes it; a record that
--     names a client record is about that client; staff cannot adopt a stored file no record stands
--     behind; removing a client record detaches its uploads and keeps their tenant.
--
-- Staff access to stored files follows the upload-record policies, which already admitted a tenant's
-- agency managers; the file policies now admit them too, so the record and its file agree.
--
-- The assignee policies on the bucket no longer require the global 'coach' role. Measured before this
-- change: zero assignment rows exist, so no one passed those policies with or without the condition,
-- and effective access is unchanged as of this migration. The condition is not reintroduced because
-- the platform authorises by role (owner, admin, member), never by a title.

-- Step 0: abort unless every existing upload resolves to exactly one tenant.
-- Existing uploads are placed by their client record where they have one, otherwise by the single
-- tenant their subject belongs to (as a member or as a client). The membership source is a recorded
-- deviation from the classification's documented source (the client record): on 2026-09-26 no upload
-- had a client record, and its one subject belonged to exactly one tenant.
DO $$
DECLARE _unplaceable int;
BEGIN
  SELECT count(*) INTO _unplaceable FROM public.credit_report_uploads u
   WHERE u.client_id IS NULL
     AND (SELECT count(DISTINCT t) FROM (
            SELECT tm.tenant_id AS t FROM public.tenant_members tm WHERE tm.user_id = u.user_id AND tm.status = 'active'
            UNION SELECT c.tenant_id FROM public.clients c WHERE c.linked_user_id = u.user_id) s) <> 1;
  SELECT _unplaceable + count(*) INTO _unplaceable FROM public.credit_report_uploads u
    JOIN public.clients c ON c.id = u.client_id
   WHERE c.tenant_id IS NULL OR u.user_id NOT IN (c.id, coalesce(c.linked_user_id, c.id));
  SELECT _unplaceable + count(*) INTO _unplaceable FROM public.credit_report_uploads u
   WHERE split_part(u.file_path, '/', 1) <> u.user_id::text
      OR EXISTS (SELECT 1 FROM public.credit_report_uploads o WHERE o.file_path = u.file_path AND o.id <> u.id);
  IF _unplaceable > 0 THEN
    RAISE EXCEPTION 'report upload scope: % upload(s) cannot be placed in exactly one tenant, or do not own their file; re-derive this migration', _unplaceable;
  END IF;
END $$;

-- Step 1: the tenant column, nullable while it is filled.
ALTER TABLE public.credit_report_uploads
  ADD COLUMN tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Step 2: fill it.
UPDATE public.credit_report_uploads u
   SET tenant_id = c.tenant_id
  FROM public.clients c
 WHERE c.id = u.client_id AND u.tenant_id IS NULL;
UPDATE public.credit_report_uploads u
   SET tenant_id = s.t
  FROM (SELECT DISTINCT tm.user_id AS p, tm.tenant_id AS t FROM public.tenant_members tm WHERE tm.status = 'active'
        UNION SELECT c.linked_user_id, c.tenant_id FROM public.clients c WHERE c.linked_user_id IS NOT NULL) s
 WHERE u.client_id IS NULL AND u.tenant_id IS NULL AND s.p = u.user_id;

ALTER TABLE public.credit_report_uploads ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX credit_report_uploads_tenant_id_idx ON public.credit_report_uploads (tenant_id);
CREATE UNIQUE INDEX credit_report_uploads_file_path_key ON public.credit_report_uploads (file_path);
COMMENT ON COLUMN public.credit_report_uploads.tenant_id IS
  'The tenant this upload was made in. Filled from the client record, the signed-in maker''s active tenant, or the person''s single client record; validated on write; immutable.';

-- Step 3: fill, validate and fix the tenant on every write.
CREATE OR REPLACE FUNCTION public.enforce_credit_report_upload_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _client_tenant uuid;
  _record_tenants uuid[];
  _caller uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'UPLOAD_TENANT_IMMUTABLE: an upload''s tenant cannot be changed'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.file_path IS DISTINCT FROM OLD.file_path THEN
    RAISE EXCEPTION 'UPLOAD_FILE_IMMUTABLE: an upload''s file cannot be changed'
      USING ERRCODE = '23514';
  END IF;
  -- The stored file is reached through this record, so the record may only name a file in the folder
  -- of the person it is about.
  IF (TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id)
     AND split_part(NEW.file_path, '/', 1) IS DISTINCT FROM NEW.user_id::text THEN
    RAISE EXCEPTION 'UPLOAD_FILE_OUTSIDE_SUBJECT: an upload names only a file in its subject''s folder'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    SELECT c.tenant_id INTO _client_tenant FROM public.clients c WHERE c.id = NEW.client_id;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := COALESCE(_client_tenant,
                              CASE WHEN _caller IS NOT NULL THEN public.current_user_tenant_id() END);
  END IF;
  IF NEW.tenant_id IS NULL THEN
    -- A client uploading their own report has no active tenant of their own. Their client record
    -- places it, but only when there is exactly one: with more than one, which business they meant is
    -- unknowable here and the upload is refused rather than guessed. This is correct with or without
    -- clients_linked_user_id_unique; when that index is dropped, a person with several client records
    -- is refused here until the portal records which business they are in (named as a blocker of the
    -- index drop).
    SELECT array_agg(DISTINCT c.tenant_id) INTO _record_tenants
      FROM public.clients c WHERE c.linked_user_id = NEW.user_id;
    IF coalesce(array_length(_record_tenants, 1), 0) = 1 THEN
      NEW.tenant_id := _record_tenants[1];
    END IF;
  END IF;
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'UPLOAD_TENANT_UNRESOLVED: no client record, active tenant or single client relationship to place this upload in'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    IF _client_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'UPLOAD_TENANT_MISMATCH: an upload takes its client record''s tenant'
        USING ERRCODE = '23514';
    END IF;
    IF (TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.client_id IS DISTINCT FROM OLD.client_id)
       AND NOT EXISTS (SELECT 1 FROM public.clients c
                        WHERE c.id = NEW.client_id AND NEW.user_id IN (c.id, c.linked_user_id)) THEN
      RAISE EXCEPTION 'UPLOAD_CLIENT_MISMATCH: an upload naming a client record is about that client'
        USING ERRCODE = '23514';
    END IF;
  -- A client record removed from under an upload (client_id set to null) detaches it; the upload keeps
  -- its tenant and is not re-judged, so removing a client never fails on its uploads.
  ELSIF (TG_OP = 'INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id)
        AND NOT (public.tenant_assignee_qualifies(NEW.tenant_id, NEW.user_id)
                 OR EXISTS (SELECT 1 FROM public.clients c
                             WHERE c.tenant_id = NEW.tenant_id AND c.linked_user_id = NEW.user_id)) THEN
    RAISE EXCEPTION 'UPLOAD_SUBJECT_NOT_IN_TENANT: the person this upload is about does not belong to its tenant'
      USING ERRCODE = '23514';
  END IF;

  -- A signed-in maker filing a record about someone else may not adopt a file that already exists:
  -- staff file the record first, so a file already present is someone else's to account for.
  IF TG_OP = 'INSERT' AND _caller IS NOT NULL AND _caller IS DISTINCT FROM NEW.user_id
     AND EXISTS (SELECT 1 FROM storage.objects o
                  WHERE o.bucket_id = 'credit-report-uploads' AND o.name = NEW.file_path) THEN
    RAISE EXCEPTION 'UPLOAD_FILE_ALREADY_STORED: a record for someone else cannot adopt an existing file'
      USING ERRCODE = '23514';
  END IF;

  -- Standing is checked where an upload is placed, not on later processing (analysis, backfill,
  -- deletion), which must keep working after a person leaves the tenant.
  IF TG_OP = 'INSERT' AND _caller IS NOT NULL
     AND NOT public.tenant_assignee_qualifies(NEW.tenant_id, _caller)
     AND NOT public.is_platform_operator()
     AND NOT (_caller = NEW.user_id
              AND EXISTS (SELECT 1 FROM public.clients c
                           WHERE c.tenant_id = NEW.tenant_id AND c.linked_user_id = _caller)) THEN
    RAISE EXCEPTION 'UPLOAD_MAKER_NOT_IN_TENANT: the maker does not act in this upload''s tenant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_credit_report_upload_tenant() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_enforce_credit_report_upload_tenant
  BEFORE INSERT OR UPDATE ON public.credit_report_uploads
  FOR EACH ROW EXECUTE FUNCTION public.enforce_credit_report_upload_tenant();

-- Step 4: access to upload records follows the upload's tenant.
-- The admin policy resolved "the" tenant from the person's client record; it now resolves from the
-- upload itself. Platform super-administration is unchanged.
ALTER POLICY "Admins can manage all report uploads" ON public.credit_report_uploads
  USING (is_super_admin() OR is_tenant_admin(tenant_id) OR agency_can_manage_child(tenant_id))
  WITH CHECK ((is_super_admin() OR is_tenant_admin(tenant_id) OR agency_can_manage_child(tenant_id))
              AND uploaded_by = auth.uid());
ALTER POLICY "Coaches can view client report uploads" ON public.credit_report_uploads
  USING (EXISTS (SELECT 1 FROM public.coach_clients cc
                  WHERE cc.coach_user_id = auth.uid() AND cc.client_user_id = credit_report_uploads.user_id
                    AND cc.tenant_id = credit_report_uploads.tenant_id AND cc.status = 'active'::text));
ALTER POLICY "Coaches can create client report uploads" ON public.credit_report_uploads
  WITH CHECK (uploaded_by = auth.uid()
              AND EXISTS (SELECT 1 FROM public.coach_clients cc
                           WHERE cc.coach_user_id = auth.uid() AND cc.client_user_id = credit_report_uploads.user_id
                             AND cc.tenant_id = credit_report_uploads.tenant_id AND cc.status = 'active'::text));

-- Step 5: staff reach a stored file only through its upload record. Owner policies are unchanged.
ALTER POLICY "Admins can view tenant client credit reports" ON storage.objects
  USING (bucket_id = 'credit-report-uploads'::text AND (
    is_platform_owner() OR EXISTS (
      SELECT 1 FROM public.credit_report_uploads u
       WHERE u.file_path = objects.name
         AND (is_tenant_admin(u.tenant_id) OR agency_can_manage_child(u.tenant_id)))));
ALTER POLICY "Admins can upload tenant client credit reports" ON storage.objects
  WITH CHECK (bucket_id = 'credit-report-uploads'::text AND (
    is_platform_owner() OR EXISTS (
      SELECT 1 FROM public.credit_report_uploads u
       WHERE u.file_path = objects.name
         AND (is_tenant_admin(u.tenant_id) OR agency_can_manage_child(u.tenant_id)))));
ALTER POLICY "Coaches can view assigned client credit reports" ON storage.objects
  USING (bucket_id = 'credit-report-uploads'::text AND EXISTS (
    SELECT 1 FROM public.credit_report_uploads u
      JOIN public.coach_clients cc ON cc.client_user_id = u.user_id AND cc.tenant_id = u.tenant_id
     WHERE u.file_path = objects.name AND cc.coach_user_id = auth.uid() AND cc.status = 'active'::text));
ALTER POLICY "Coaches can upload assigned client credit reports" ON storage.objects
  WITH CHECK (bucket_id = 'credit-report-uploads'::text AND EXISTS (
    SELECT 1 FROM public.credit_report_uploads u
      JOIN public.coach_clients cc ON cc.client_user_id = u.user_id AND cc.tenant_id = u.tenant_id
     WHERE u.file_path = objects.name AND cc.coach_user_id = auth.uid() AND cc.status = 'active'::text));
