-- Existing client_files + intended private Storage bucket. No new file store,
-- executor, identity table or provider. Pending is a file lifecycle state;
-- finalization records the actual object through the existing audit and Rail.
BEGIN;

-- Reapply only this forward migration's own declarations safely. This does not
-- reset migration history or replace another domain's Storage policies.
DROP POLICY IF EXISTS client_upload_update_current_relationship ON public.client_files;
DROP POLICY IF EXISTS client_upload_delete_current_relationship ON public.client_files;
DROP POLICY IF EXISTS client_files_put ON storage.objects;
DROP POLICY IF EXISTS client_files_get ON storage.objects;
DROP POLICY IF EXISTS client_files_staff_remove ON storage.objects;
DROP POLICY IF EXISTS client_files_put_boundary ON storage.objects;
DROP POLICY IF EXISTS client_files_get_boundary ON storage.objects;
DROP POLICY IF EXISTS client_files_no_overwrite ON storage.objects;
DROP POLICY IF EXISTS client_files_remove_boundary ON storage.objects;

ALTER TABLE public.client_files ADD COLUMN IF NOT EXISTS upload_state text NOT NULL DEFAULT 'ready';
ALTER TABLE public.client_files DROP CONSTRAINT IF EXISTS client_files_upload_state_check;
ALTER TABLE public.client_files ADD CONSTRAINT client_files_upload_state_check CHECK (upload_state IN ('pending','ready'));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('client-files','client-files',false,20971520,
 ARRAY['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='client-files' AND NOT public
   AND file_size_limit=20971520 AND allowed_mime_types @> ARRAY['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document']
   AND cardinality(allowed_mime_types)=4) THEN
  RAISE EXCEPTION 'client file bucket contract changed; reconcile before release';
 END IF;
END $$;

-- Browser file creation uses the checked reservation/finalization writer below.
-- Staff's existing direct metadata producer and its permission arms are retained.
ALTER POLICY "Clients upload own" ON public.client_files WITH CHECK (false);

-- Historic schema replays contain these weaker path/role-only Storage arms;
-- production may not. Replace their intended bucket contract in both classes.
DROP POLICY IF EXISTS "client-files: staff read" ON storage.objects;
DROP POLICY IF EXISTS "client-files: client read own shared/uploads" ON storage.objects;
DROP POLICY IF EXISTS "client-files: staff write" ON storage.objects;
DROP POLICY IF EXISTS "client-files: client upload own" ON storage.objects;
DROP POLICY IF EXISTS "client-files: staff delete" ON storage.objects;

CREATE POLICY client_upload_update_current_relationship ON public.client_files
AS RESTRICTIVE FOR UPDATE TO authenticated
USING (visibility<>'client_upload' OR public.is_platform_owner() OR public.is_tenant_admin(tenant_id)
 OR (uploaded_by_user_id=auth.uid() AND contact_id=public.client_portal_relationship_id(tenant_id)))
WITH CHECK (visibility<>'client_upload' OR public.is_platform_owner() OR public.is_tenant_admin(tenant_id)
 OR (uploaded_by_user_id=auth.uid() AND contact_id=public.client_portal_relationship_id(tenant_id)));
CREATE POLICY client_upload_delete_current_relationship ON public.client_files
AS RESTRICTIVE FOR DELETE TO authenticated
USING (visibility<>'client_upload' OR public.is_platform_owner() OR public.is_tenant_admin(tenant_id)
 OR (uploaded_by_user_id=auth.uid() AND contact_id=public.client_portal_relationship_id(tenant_id)));

CREATE OR REPLACE FUNCTION public._client_portal_file_projection(f public.client_files)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',f.id,'tenant_id',f.tenant_id,'contact_id',f.contact_id,
 'uploaded_by_user_id',f.uploaded_by_user_id,'storage_path',f.storage_path,
 'original_filename',f.original_filename,'mime_type',f.mime_type,'size_bytes',f.size_bytes,
 'visibility',f.visibility,'upload_state',f.upload_state,'created_at',f.created_at,'updated_at',f.updated_at)
$$;
REVOKE ALL ON FUNCTION public._client_portal_file_projection(public.client_files) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.client_portal_begin_file_upload(p_file_id uuid,p_expected_client_id uuid,p_filename text,p_mime_type text,p_size_bytes bigint,p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE
 _uid uuid:=auth.uid(); _contact uuid; _client public.clients%ROWTYPE;
 _file public.client_files%ROWTYPE; _path text; _extension text;
BEGIN
 IF _uid IS NULL OR p_file_id IS NULL THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 _contact:=public.client_portal_relationship_id(p_tenant_id);
 IF p_expected_client_id IS NULL OR _contact IS DISTINCT FROM p_expected_client_id THEN
  RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO _client FROM public.clients WHERE id=_contact AND linked_user_id=_uid
  AND status='active' AND merged_into_contact_id IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=_client.tenant_id AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 _extension:=lower(substring(p_filename from '\.([^.]+)$'));
 IF p_filename IS NULL OR p_filename<>btrim(p_filename) OR length(p_filename) NOT BETWEEN 1 AND 255
  OR p_filename ~ '[[:cntrl:]/\\]' OR _extension IS NULL OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 20971520
  OR p_mime_type IS NULL OR NOT (
   (p_mime_type='application/pdf' AND _extension='pdf')
   OR (p_mime_type='image/jpeg' AND _extension IN ('jpg','jpeg'))
   OR (p_mime_type='image/png' AND _extension='png')
   OR (p_mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document' AND _extension='docx')) THEN
  RAISE EXCEPTION 'Choose a PDF, JPG, PNG or DOCX file up to 20 MB.' USING ERRCODE='22023';
 END IF;
 _path:=_client.tenant_id::text||'/'||_contact::text||'/client_upload/'||_uid::text||'/'||p_file_id::text;
 INSERT INTO public.client_files(id,tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state)
 VALUES(p_file_id,_client.tenant_id,_contact,_uid,_path,p_filename,p_mime_type,p_size_bytes,'client_upload','pending')
 ON CONFLICT(id) DO NOTHING;
 SELECT * INTO _file FROM public.client_files WHERE id=p_file_id FOR UPDATE;
 IF _file.tenant_id IS DISTINCT FROM _client.tenant_id OR _file.contact_id IS DISTINCT FROM _contact
  OR _file.uploaded_by_user_id IS DISTINCT FROM _uid OR _file.storage_path IS DISTINCT FROM _path
  OR _file.original_filename IS DISTINCT FROM p_filename OR _file.mime_type IS DISTINCT FROM p_mime_type
  OR _file.size_bytes IS DISTINCT FROM p_size_bytes OR _file.visibility<>'client_upload' THEN
  RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501';
 END IF;
 RETURN public._client_portal_file_projection(_file);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_begin_file_upload(uuid,uuid,text,text,bigint,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.client_portal_begin_file_upload(uuid,uuid,text,text,bigint,uuid) TO authenticated,service_role;

-- Only the current customer with a reserved object or the incumbent authorized
-- staff producer may PUT. Object paths are never an authority grant themselves.
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
   AND public.is_tenant_admin(_tenant) AND public.has_role(_uid,'admin'::public.app_role))));
END $$;
REVOKE ALL ON FUNCTION public.client_portal_can_upload_file_object(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.client_portal_can_upload_file_object(text) TO authenticated,service_role;

CREATE POLICY client_files_put ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='client-files' AND owner_id=auth.uid()::text AND public.client_portal_can_upload_file_object(name));
CREATE POLICY client_files_get ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='client-files' AND EXISTS(SELECT 1 FROM public.client_files f
 WHERE f.storage_path=objects.name AND f.upload_state='ready'
  AND split_part(objects.name,'/',1)=f.tenant_id::text AND objects.owner_id=f.uploaded_by_user_id::text));
-- No object overwrite policy. Existing staff removal remains authorized only by
-- its actual file record/RLS and management standing; customer removal is not added.
CREATE POLICY client_files_staff_remove ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='client-files' AND EXISTS(SELECT 1 FROM public.client_files f WHERE f.storage_path=objects.name
 AND split_part(objects.name,'/',1)=f.tenant_id::text
 AND (public.is_platform_owner() OR public.is_tenant_admin(f.tenant_id))));

-- Storage policies are permissive OR arms. These bucket-local restrictions also
-- prevent an unrelated legacy broad arm from widening this contract.
CREATE POLICY client_files_put_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK(bucket_id<>'client-files' OR (owner_id=auth.uid()::text AND public.client_portal_can_upload_file_object(name)));
CREATE POLICY client_files_get_boundary ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING(bucket_id<>'client-files' OR EXISTS(SELECT 1 FROM public.client_files f
 WHERE f.storage_path=objects.name AND f.upload_state='ready'
 AND split_part(objects.name,'/',1)=f.tenant_id::text AND objects.owner_id=f.uploaded_by_user_id::text));
CREATE POLICY client_files_no_overwrite ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
USING(bucket_id<>'client-files') WITH CHECK(bucket_id<>'client-files');
CREATE POLICY client_files_remove_boundary ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
USING(bucket_id<>'client-files' OR EXISTS(SELECT 1 FROM public.client_files f WHERE f.storage_path=objects.name
 AND split_part(objects.name,'/',1)=f.tenant_id::text
 AND (public.is_platform_owner() OR public.is_tenant_admin(f.tenant_id))));

CREATE OR REPLACE FUNCTION public.guard_client_upload_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 IF OLD.visibility='client_upload' AND (
  NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
  OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
  OR NEW.visibility IS DISTINCT FROM OLD.visibility OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
  OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes) THEN
  RAISE EXCEPTION 'customer upload provenance is immutable' USING ERRCODE='42501';
 END IF;
 IF NEW.upload_state IS DISTINCT FROM OLD.upload_state AND current_user NOT IN ('postgres','service_role') THEN
  RAISE EXCEPTION 'customer upload status uses the native file writer' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_client_upload_identity() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS client_upload_identity_before_update ON public.client_files;
CREATE TRIGGER client_upload_identity_before_update BEFORE UPDATE ON public.client_files
FOR EACH ROW EXECUTE FUNCTION public.guard_client_upload_identity();

INSERT INTO public.paige_event_kinds(slug,tenant_id,label,description,default_audience,default_visibility,department,enabled)
VALUES('client.document_uploaded',NULL,'Document uploaded','A customer upload was verified against its own private Storage object and saved on the same client file.',
 'both','client_visible','client_experience',true) ON CONFLICT(slug) DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.paige_event_kinds WHERE slug='client.document_uploaded' AND tenant_id IS NULL
  AND default_audience='both' AND default_visibility='client_visible' AND department='client_experience' AND enabled) THEN
  RAISE EXCEPTION 'client document event contract changed; reconcile before release';
 END IF;
END $$;

-- One Rail writer: a client acts through the verified customer relationship,
-- even when the same login has a different active staff workspace. Do not switch
-- that staff pointer or fork the existing receipt/audit/realtime implementation.
DO $patch$
DECLARE
 _definition text:=pg_get_functiondef('public.record_rail_event(uuid,text,text,text,text,text,jsonb,text,uuid,text,text,timestamptz,boolean,uuid,text)'::regprocedure);
 _old text:=$old$    v_tenant := public.current_user_tenant_id();
    IF v_tenant IS NULL AND p_actor_type = 'client' THEN
      SELECT c.tenant_id INTO v_tenant
        FROM public.clients c
       WHERE c.id = p_contact_id AND c.linked_user_id = v_uid;
    END IF;$old$;
 _new text:=$new$    IF p_actor_type = 'client' THEN
      SELECT c.tenant_id INTO v_tenant FROM public.clients c
       WHERE c.id = p_contact_id AND c.id = public.client_portal_relationship_id(p_tenant_id)
         AND c.linked_user_id = v_uid;
    ELSE
      v_tenant := public.current_user_tenant_id();
    END IF;$new$;
BEGIN
 IF position(_new IN _definition)>0 AND position(_old IN _definition)=0 THEN RETURN; END IF;
 IF (length(_definition)-length(replace(_definition,_old,'')))/length(_old)<>1 OR position(_new IN _definition)>0 THEN
  RAISE EXCEPTION 'Rail client scope predecessor changed; reconcile before release';
 END IF;
 EXECUTE replace(_definition,_old,_new);
END $patch$;

CREATE OR REPLACE FUNCTION public.client_portal_file_upload_status(p_file_id uuid,p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE _uid uuid:=auth.uid();_contact uuid;_file public.client_files%ROWTYPE;_object_ok boolean;
BEGIN
 _contact:=public.client_portal_relationship_id(p_tenant_id);
 IF _uid IS NULL OR _contact IS NULL THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO _file FROM public.client_files f WHERE f.id=p_file_id AND f.contact_id=_contact
  AND f.tenant_id=(SELECT c.tenant_id FROM public.clients c WHERE c.id=_contact)
  AND f.uploaded_by_user_id=_uid AND f.visibility='client_upload'
  AND f.storage_path=f.tenant_id::text||'/'||f.contact_id::text||'/client_upload/'||_uid::text||'/'||f.id::text;
 IF NOT FOUND THEN RETURN jsonb_build_object('file',NULL,'object_verified',false); END IF;
 SELECT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='client-files' AND o.name=_file.storage_path
  AND o.owner_id=_uid::text AND CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,10}$' THEN (o.metadata->>'size')::bigint END=_file.size_bytes
  AND o.metadata->>'mimetype'=_file.mime_type) INTO _object_ok;
 RETURN jsonb_build_object('file',public._client_portal_file_projection(_file),'object_verified',_object_ok);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_file_upload_status(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.client_portal_file_upload_status(uuid,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.client_portal_finish_file_upload(p_file_id uuid,p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE _uid uuid:=auth.uid();_contact uuid;_file public.client_files%ROWTYPE;_client public.clients%ROWTYPE;_receipt uuid;
BEGIN
 _contact:=public.client_portal_relationship_id(p_tenant_id);
 SELECT * INTO _client FROM public.clients c WHERE c.id=_contact AND c.linked_user_id=_uid
  AND c.status='active' AND c.merged_into_contact_id IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=_client.tenant_id AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO _file FROM public.client_files f WHERE f.id=p_file_id AND f.contact_id=_contact
  AND f.tenant_id=_client.tenant_id AND f.uploaded_by_user_id=_uid AND f.visibility='client_upload'
  AND f.storage_path=f.tenant_id::text||'/'||f.contact_id::text||'/client_upload/'||_uid::text||'/'||f.id::text FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='client-files' AND o.name=_file.storage_path
  AND o.owner_id=_uid::text AND CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,10}$' THEN (o.metadata->>'size')::bigint END=_file.size_bytes
  AND o.metadata->>'mimetype'=_file.mime_type) THEN
  RAISE EXCEPTION 'The saved upload could not be verified. Check its status before trying again.' USING ERRCODE='22023';
 END IF;
 IF _file.upload_state='ready' THEN RETURN public._client_portal_file_projection(_file); END IF;
 UPDATE public.client_files SET upload_state='ready' WHERE id=_file.id RETURNING * INTO _file;
 _receipt:=public.record_rail_event(p_contact_id=>_contact,p_event_kind=>'client.document_uploaded',
  p_surface=>'client_portal',p_actor_type=>'client',p_title=>'Document uploaded',
  p_payload=>jsonb_build_object('file_id',_file.id),p_ref_table=>'client_files',p_ref_id=>_file.id,
  p_from_department=>'client_experience',p_to_department=>'owner_ops',p_tenant_id=>_client.tenant_id);
 INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
 VALUES(_uid,'client_portal','file_uploaded',_file.id,jsonb_build_object('tenant_id',_client.tenant_id,
  'client_id',_contact,'file_id',_file.id,'rail_event_id',_receipt,'via','client_portal_finish_file_upload'));
 RETURN public._client_portal_file_projection(_file);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_finish_file_upload(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.client_portal_finish_file_upload(uuid,uuid) TO authenticated,service_role;

COMMENT ON COLUMN public.client_files.upload_state IS 'Pending files have a reserved private path; ready records use the incumbent file library. Native customer finalization verifies the stored object before audit/Rail and status commit.';
-- Both incumbent owner and customer readers already subscribe to this table.
-- Publication supplies their existing RLS-filtered invalidation path, not a new
-- channel or provider. A local fixture without Realtime has nothing to activate.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
  AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='client_files') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.client_files;
 END IF;
END $$;
COMMIT;
