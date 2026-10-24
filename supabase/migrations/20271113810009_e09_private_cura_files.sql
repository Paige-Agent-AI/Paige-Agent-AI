-- EXP09: private CURA attachment purpose in the original client_files/Storage service.
-- No new file store, model runtime, business sharing or provider activation.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $lease$
DECLARE expected jsonb; actual jsonb;
BEGIN
 FOR expected IN SELECT value FROM pg_catalog.jsonb_array_elements($contracts$[
{"acl":["postgres:EXECUTE:false"],"args":"p_tenant_id uuid, p_lock text","hash":"416002c40cb71ed54cc4c3387c37563f","owner":"postgres","config":["search_path=\"\""],"result":"uuid","definer":true,"language":"plpgsql","signature":"_client_portal_lock_relationship(uuid,text)","volatility":"v"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false"],"args":"p_expected_actor_id uuid, p_expected_tenant_id uuid, p_contact_id uuid, p_limit integer, p_before timestamp with time zone, p_before_id uuid","hash":"ba894e10e42b7df2dca9b3fb23dc8357","owner":"postgres","config":["search_path=\"\""],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_file_owner_list(uuid,uuid,uuid,integer,timestamp with time zone,uuid)","volatility":"s","full_args":"p_expected_actor_id uuid, p_expected_tenant_id uuid, p_contact_id uuid, p_limit integer DEFAULT 100, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false"],"args":"p_expected_actor_id uuid, p_expected_tenant_id uuid, p_file_id uuid, p_shared boolean, p_expected_updated_at timestamp with time zone","hash":"828069e76ecdaa43002982ecd668fa9e","owner":"postgres","config":["search_path=\"\""],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_file_set_client_share(uuid,uuid,uuid,boolean,timestamp with time zone)","volatility":"v"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"p_file_id uuid, p_expected_client_id uuid, p_filename text, p_mime_type text, p_size_bytes bigint, p_tenant_id uuid","hash":"1af390453141672cf84ab10627fd87b9","owner":"postgres","config":["search_path=public, storage, pg_temp"],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_portal_begin_file_upload(uuid,uuid,text,text,bigint,uuid)","volatility":"v"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"p_name text","hash":"1d14e8a769796be9b674c63699db22ff","owner":"postgres","config":["search_path=public, storage, pg_temp"],"result":"boolean","definer":true,"language":"plpgsql","signature":"client_portal_can_upload_file_object(text)","volatility":"s"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"p_tenant_id uuid, p_limit integer, p_before timestamp with time zone, p_before_id uuid","hash":"ba6f905836508b0822031031bd285e2c","owner":"postgres","config":["search_path=public, pg_temp"],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_portal_documents(uuid,integer,timestamp with time zone,uuid)","volatility":"s","full_args":"p_tenant_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"p_file_id uuid, p_tenant_id uuid","hash":"c3eaa683f9606580842ec10e2648822b","owner":"postgres","config":["search_path=public, storage, pg_temp"],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_portal_file_upload_status(uuid,uuid)","volatility":"s"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"p_file_id uuid, p_tenant_id uuid","hash":"eea1846e5280e6948b8cae077cc00987","owner":"postgres","config":["search_path=public, storage, pg_temp"],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_portal_finish_file_upload(uuid,uuid)","volatility":"v","full_args":"p_file_id uuid, p_tenant_id uuid DEFAULT NULL::uuid"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false"],"args":"","hash":"b3826e6b52ba34cd40348112b8145883","owner":"postgres","config":["search_path=public, pg_temp"],"result":"jsonb","definer":true,"language":"plpgsql","signature":"client_portal_frame()","volatility":"s"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false"],"args":"p_thread uuid","hash":"1f736ad4206faf196290c13939edca35","owner":"postgres","config":["search_path=public, pg_temp"],"result":"boolean","definer":true,"language":"plpgsql","signature":"paige_chat_customer_thread_authorized(uuid)","volatility":"s"},
{"signature":"handle_data_subject_request(uuid,uuid,text,jsonb,text,uuid)","hash":"632d5be94ec9fa601074b5bdd430b1a8","owner":"postgres","language":"plpgsql","definer":true,"volatility":"v","args":"_tenant_id uuid, _contact_id uuid, _request_type text, _corrections jsonb, _reason text, _actor_user_id uuid","result":"jsonb","config":["search_path=public"],"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"full_args":"_tenant_id uuid, _contact_id uuid, _request_type text, _corrections jsonb DEFAULT NULL::jsonb, _reason text DEFAULT NULL::text, _actor_user_id uuid DEFAULT NULL::uuid"},
{"acl":["authenticated:EXECUTE:false","postgres:EXECUTE:false","service_role:EXECUTE:false"],"args":"p_tenant_id uuid","hash":"ff84ba24689e5043d7d15ed3d9150268","owner":"postgres","config":["search_path=public, pg_temp"],"result":"uuid","definer":true,"language":"plpgsql","signature":"client_portal_relationship_id(uuid)","volatility":"s"},
{"acl":["postgres:EXECUTE:false"],"args":"","hash":"72efd408dc26f9672088f10eea9ebea1","owner":"postgres","config":["search_path=\"\""],"result":"uuid","definer":false,"language":"plpgsql","signature":"_client_portal_request_business()","volatility":"s"}
]$contracts$::jsonb) LOOP
  SELECT pg_catalog.jsonb_build_object(
   'signature',expected->>'signature','hash',pg_catalog.md5(p.prosrc),
   'owner',pg_catalog.pg_get_userbyid(p.proowner),'language',l.lanname,
   'definer',p.prosecdef,'volatility',p.provolatile,
   'args',pg_catalog.pg_get_function_identity_arguments(p.oid),
   'result',pg_catalog.pg_get_function_result(p.oid),'config',p.proconfig,
   'acl',(SELECT pg_catalog.jsonb_agg(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END) FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner)))a)) || CASE WHEN expected ? 'full_args' THEN pg_catalog.jsonb_build_object('full_args',pg_catalog.pg_get_function_arguments(p.oid)) ELSE '{}'::jsonb END
  INTO actual FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
  WHERE p.oid=pg_catalog.to_regprocedure('public.'||(expected->>'signature'));
  IF actual IS DISTINCT FROM expected THEN
   RAISE EXCEPTION 'Original private file dependency changed; reconcile: %',expected->>'signature' USING ERRCODE='42501';
  END IF;
 END LOOP;
END $lease$;

ALTER TABLE public.client_files ADD COLUMN customer_chat_thread_id uuid;
-- Historical origin, validated when bound. Deliberately no thread FK: the existing
-- Chat retention/deletion lifecycle must not delete files or be blocked by them.
COMMENT ON COLUMN public.client_files.customer_chat_thread_id IS
 'Private customer CURA attachment origin. NULL preserves the original business document contract. Immutable once bound; not business-approved Knowledge or a business-shared file.';
ALTER TABLE public.client_files ADD CONSTRAINT client_files_private_chat_purpose
 CHECK (customer_chat_thread_id IS NULL OR visibility IS NOT DISTINCT FROM 'client_upload');

-- Same native account-class fields as the canonical SOLO provisioning contract.
-- This narrow feature-scope predicate neither provisions nor repairs a business.
CREATE FUNCTION public._client_portal_chat_files_solo_scope(p_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
 SELECT EXISTS(SELECT 1 FROM public.clients c JOIN public.tenants t ON t.id=c.tenant_id
  WHERE c.id=p_client_id AND t.account_type='standalone' AND t.parent_tenant_id IS NULL);
$function$;
REVOKE ALL ON FUNCTION public._client_portal_chat_files_solo_scope(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_portal_chat_files_authorize(p_thread_id uuid, p_tenant_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_contact uuid; v_frame jsonb; v_assistant jsonb;
BEGIN
 v_contact := public._client_portal_lock_relationship(p_tenant_id, 'share');
 IF v_contact IS NULL OR p_thread_id IS NULL OR NOT public._client_portal_chat_files_solo_scope(v_contact)
    OR NOT public.paige_chat_customer_thread_authorized(p_thread_id) THEN
  RAISE EXCEPTION 'Private chat files unavailable in this customer relationship.' USING ERRCODE = '42501';
 END IF;
 v_frame := public.client_portal_frame();
 IF v_frame IS NULL OR pg_catalog.jsonb_typeof(v_frame->'config') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Private chat files unavailable in this customer relationship.' USING ERRCODE = '42501';
 END IF;
 IF (v_frame->'config') ? 'assistant' THEN
  v_assistant := v_frame->'config'->'assistant';
  IF pg_catalog.jsonb_typeof(v_assistant) IS DISTINCT FROM 'object'
     OR (v_assistant ? 'enabled' AND
      (pg_catalog.jsonb_typeof(v_assistant->'enabled') IS DISTINCT FROM 'boolean'
       OR v_assistant->'enabled' = 'false'::jsonb)) THEN
   RAISE EXCEPTION 'Private chat files unavailable in this customer relationship.' USING ERRCODE = '42501';
  END IF;
 END IF;
 RETURN v_contact;
END $function$;
REVOKE ALL ON FUNCTION public._client_portal_chat_files_authorize(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._client_files_private_chat_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
 IF TG_OP = 'UPDATE' AND OLD.customer_chat_thread_id IS NOT NULL THEN
  IF NEW.customer_chat_thread_id IS DISTINCT FROM OLD.customer_chat_thread_id THEN
   RAISE EXCEPTION 'PRIVATE_CHAT_FILE_ORIGIN_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
 ELSIF NEW.customer_chat_thread_id IS NOT NULL THEN
  -- Only an original own, pending reservation created in this transaction can
  -- acquire a private purpose. A saved business document cannot be reclassified.
  IF NEW.uploaded_by_user_id IS DISTINCT FROM auth.uid()
     OR NEW.upload_state IS DISTINCT FROM 'pending' OR NEW.visibility IS DISTINCT FROM 'client_upload'
     OR NEW.created_at IS DISTINCT FROM transaction_timestamp()
     OR NEW.contact_id IS DISTINCT FROM public._client_portal_chat_files_authorize(NEW.customer_chat_thread_id,NEW.tenant_id) THEN
   RAISE EXCEPTION 'PRIVATE_CHAT_FILE_ORIGIN_INVALID' USING ERRCODE = '42501';
  END IF;
 END IF;
 RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public._client_files_private_chat_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_client_files_private_chat_guard BEFORE INSERT OR UPDATE ON public.client_files
 FOR EACH ROW EXECUTE FUNCTION public._client_files_private_chat_guard();

-- Restrictive AND with the original grants: even a tenant admin/assigned coach
-- cannot use the ordinary table or signed Storage URL door to read a private file.
CREATE POLICY client_files_private_chat_boundary ON public.client_files AS RESTRICTIVE
 FOR ALL TO authenticated
 USING (customer_chat_thread_id IS NULL OR
   (uploaded_by_user_id = auth.uid() AND contact_id = public.client_portal_relationship_id(tenant_id)))
 WITH CHECK (customer_chat_thread_id IS NULL OR
   (uploaded_by_user_id = auth.uid() AND contact_id = public.client_portal_relationship_id(tenant_id)));

CREATE FUNCTION public.client_portal_begin_chat_file_upload(
 p_file_id uuid, p_expected_client_id uuid, p_thread_id uuid,
 p_filename text, p_mime_type text, p_size_bytes bigint, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_contact uuid; v_file public.client_files%ROWTYPE;
BEGIN
 v_contact := public._client_portal_chat_files_authorize(p_thread_id,p_tenant_id);
 IF v_contact IS DISTINCT FROM p_expected_client_id OR p_file_id IS NULL THEN
  RAISE EXCEPTION 'Private chat files unavailable in this customer relationship.' USING ERRCODE = '42501';
 END IF;
 SELECT * INTO v_file FROM public.client_files WHERE id=p_file_id FOR UPDATE;
 IF FOUND AND (v_file.customer_chat_thread_id IS DISTINCT FROM p_thread_id
    OR v_file.uploaded_by_user_id IS DISTINCT FROM auth.uid()
    OR v_file.contact_id IS DISTINCT FROM v_contact) THEN
  RAISE EXCEPTION 'Private chat file reservation changed. Check its status before trying again.' USING ERRCODE='42501';
 END IF;
 -- One original writer owns filename/type/size, fixed path, tenant/user binding,
 -- conflict admission and idempotency. The wrapper adds only the private purpose.
 PERFORM public.client_portal_begin_file_upload(p_file_id,p_expected_client_id,p_filename,p_mime_type,p_size_bytes,p_tenant_id);
 UPDATE public.client_files SET customer_chat_thread_id=p_thread_id
 WHERE id=p_file_id RETURNING * INTO v_file;
 RETURN public._client_portal_file_projection(v_file)
  || pg_catalog.jsonb_build_object('customer_chat_thread_id',v_file.customer_chat_thread_id);
END $function$;
REVOKE ALL ON FUNCTION public.client_portal_begin_chat_file_upload(uuid,uuid,uuid,text,text,bigint,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_begin_chat_file_upload(uuid,uuid,uuid,text,text,bigint,uuid) TO authenticated;

CREATE FUNCTION public.client_portal_chat_file_status(p_file_id uuid,p_thread_id uuid,p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_contact uuid; v_thread uuid; v_status jsonb;
BEGIN
 v_contact := public._client_portal_chat_files_authorize(p_thread_id,p_tenant_id);
 SELECT customer_chat_thread_id INTO v_thread FROM public.client_files
 WHERE id=p_file_id AND contact_id=v_contact AND uploaded_by_user_id=auth.uid()
  AND customer_chat_thread_id IS NOT NULL;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('file',NULL,'object_verified',false); END IF;
 v_status := public.client_portal_file_upload_status(p_file_id,p_tenant_id);
 RETURN pg_catalog.jsonb_set(v_status,'{file}',(v_status->'file')
  || pg_catalog.jsonb_build_object('customer_chat_thread_id',v_thread));
END $function$;
REVOKE ALL ON FUNCTION public.client_portal_chat_file_status(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_chat_file_status(uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.client_portal_chat_files(p_thread_id uuid,p_tenant_id uuid DEFAULT NULL,
 p_limit integer DEFAULT 50,p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_contact uuid; v_tenant uuid; v_files jsonb; v_more boolean;
 v_limit integer := least(greatest(coalesce(p_limit,50),1),50);
BEGIN
 v_contact := public._client_portal_chat_files_authorize(p_thread_id,p_tenant_id);
 IF (p_before IS NULL) <> (p_before_id IS NULL) THEN
  RAISE EXCEPTION 'A page cursor needs both its time and file identity.' USING ERRCODE='22023';
 END IF;
 SELECT tenant_id INTO v_tenant FROM public.clients WHERE id=v_contact;
 -- A current own private thread authorizes retrieval. Origin may belong to an
 -- older own thread: Chat retention does not silently delete the customer's file.
 WITH page AS (
  SELECT f AS file,row_number() OVER(ORDER BY f.created_at DESC,f.id DESC) AS rn
  FROM public.client_files f WHERE f.tenant_id=v_tenant AND f.contact_id=v_contact
   AND f.uploaded_by_user_id=auth.uid() AND f.customer_chat_thread_id IS NOT NULL
   AND (p_before IS NULL OR (f.created_at,f.id)<(p_before,p_before_id))
  ORDER BY f.created_at DESC,f.id DESC LIMIT v_limit+1
 )
 SELECT coalesce(pg_catalog.jsonb_agg(public._client_portal_file_projection(p.file)
    || pg_catalog.jsonb_build_object('customer_chat_thread_id',(p.file).customer_chat_thread_id)
    ORDER BY p.rn) FILTER (WHERE p.rn<=v_limit),'[]'::jsonb),count(*)>v_limit
 INTO v_files,v_more FROM page p;
 RETURN pg_catalog.jsonb_build_object('tenant_id',v_tenant,'client_id',v_contact,'files',v_files,'has_more',v_more);
END $function$;
REVOKE ALL ON FUNCTION public.client_portal_chat_files(uuid,uuid,integer,timestamptz,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.client_portal_chat_files(uuid,uuid,integer,timestamptz,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.client_file_owner_list(p_expected_actor_id uuid, p_expected_tenant_id uuid, p_contact_id uuid, p_limit integer DEFAULT 100, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Slice 7: "connected" is "can open the portal now" — linked AND access open. A paused client keeps the
  -- link but sees nothing, so it is not connected. The list's keys are unchanged (the Files card reads them exactly).
  SELECT (c.linked_user_id IS NOT NULL AND c.status = 'active' AND c.merged_into_contact_id IS NULL
          AND c.portal_access_state = 'open') INTO v_linked
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
      AND f.customer_chat_thread_id IS NULL
      AND (f.upload_state = 'ready' OR (f.visibility <> 'client_upload' AND f.uploaded_by_user_id = v_actor))
      AND (p_before IS NULL OR (f.created_at, f.id) < (p_before, p_before_id))
  )
  SELECT coalesce(jsonb_agg(public._client_file_owner_row(r.rec) ORDER BY r.rn) FILTER (WHERE r.rn <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  INTO v_files, v_more FROM ranked r WHERE r.rn <= v_limit + 1;
  RETURN jsonb_build_object('ok', true, 'contact_id', p_contact_id, 'portal_connected', v_linked,
    'files', v_files, 'has_more', v_more);
END;
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_documents(p_tenant_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  _client_id := public._client_portal_lock_relationship(p_tenant_id, 'none');
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
      AND f.customer_chat_thread_id IS NULL
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
$function$;

CREATE OR REPLACE FUNCTION public.client_portal_finish_file_upload(p_file_id uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
DECLARE _uid uuid:=auth.uid();_contact uuid;_file public.client_files%ROWTYPE;_client public.clients%ROWTYPE;_receipt uuid;
BEGIN
 _contact:=public.client_portal_relationship_id(p_tenant_id);
 SELECT * INTO _client FROM public.clients c WHERE c.id=_contact AND c.linked_user_id=_uid
  AND c.status='active' AND c.merged_into_contact_id IS NULL AND c.portal_access_state='open' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=_client.tenant_id AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO _file FROM public.client_files f WHERE f.id=p_file_id AND f.contact_id=_contact
  AND f.tenant_id=_client.tenant_id AND f.uploaded_by_user_id=_uid AND f.visibility='client_upload'
  AND f.storage_path=f.tenant_id::text||'/'||f.contact_id::text||'/client_upload/'||_uid::text||'/'||f.id::text FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 IF _file.customer_chat_thread_id IS NOT NULL AND NOT public._client_portal_chat_files_solo_scope(_contact) THEN
  RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='client-files' AND o.name=_file.storage_path
  AND o.owner_id=_uid::text AND CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,10}$' THEN (o.metadata->>'size')::bigint END=_file.size_bytes
  AND o.metadata->>'mimetype'=_file.mime_type) THEN
  RAISE EXCEPTION 'The saved upload could not be verified. Check its status before trying again.' USING ERRCODE='22023';
 END IF;
 IF _file.upload_state='ready' THEN RETURN public._client_portal_file_projection(_file); END IF;
 UPDATE public.client_files SET upload_state='ready' WHERE id=_file.id RETURNING * INTO _file;
 IF _file.customer_chat_thread_id IS NULL THEN
 _receipt:=public.record_rail_event(p_contact_id=>_contact,p_event_kind=>'client.document_uploaded',
  p_surface=>'client_portal',p_actor_type=>'client',p_title=>'Document uploaded',
  p_payload=>jsonb_build_object('file_id',_file.id),p_ref_table=>'client_files',p_ref_id=>_file.id,
  p_from_department=>'client_experience',p_to_department=>'owner_ops',p_tenant_id=>_client.tenant_id);
 INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
 VALUES(_uid,'client_portal','file_uploaded',_file.id,jsonb_build_object('tenant_id',_client.tenant_id,
  'client_id',_contact,'file_id',_file.id,'rail_event_id',_receipt,'via','client_portal_finish_file_upload'));
 ELSE
  -- Private CURA files are not a business-shared document or an owner activity event.
  -- audit_logs permits this caller and platform security review, not the tenant team.
  INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
  VALUES(_uid,'client_portal','private_chat_file_uploaded',_file.id,
   jsonb_build_object('tenant_id',_client.tenant_id,'client_id',_contact,'file_id',_file.id,
    'customer_chat_thread_id',_file.customer_chat_thread_id,'via','client_portal_finish_file_upload'));
 END IF;
 RETURN public._client_portal_file_projection(_file);
END $function$;

CREATE OR REPLACE FUNCTION public.handle_data_subject_request(_tenant_id uuid, _contact_id uuid, _request_type text, _corrections jsonb DEFAULT NULL::jsonb, _reason text DEFAULT NULL::text, _actor_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _service boolean := auth.uid() IS NULL AND auth.role() = 'service_role';
  _actor uuid;
  _is_platform_owner boolean := false;
  _is_tenant_admin boolean := false;
  _contact record;
  _export jsonb;
  _allowed_correction_fields text[] := ARRAY[
    'first_name','last_name','email','phone','entity_name',
    'street_address','city','state','zip_code'
  ];
  _aliases jsonb := '{"zip":"zip_code","address_line1":"street_address"}'::jsonb;
  _patch jsonb := '{}'::jsonb;
  _ignored text[] := '{}'::text[];
  _k text;
  _field text;
  _v jsonb;
  _expected jsonb;
  _methods jsonb;
  _removed integer;
BEGIN
  IF _caller IS NOT NULL THEN
    IF _actor_user_id IS NOT NULL AND _actor_user_id <> _caller THEN
      RAISE EXCEPTION 'forbidden: a signed-in caller acts only as themselves';
    END IF;
    _actor := _caller;
    _is_platform_owner := public.is_platform_owner();
    _is_tenant_admin := public.is_tenant_admin(_tenant_id);
  ELSIF _service THEN
    IF _actor_user_id IS NULL THEN
      RAISE EXCEPTION 'actor_required: name the person this data subject request is handled for';
    END IF;
    _actor := _actor_user_id;
    _is_platform_owner := public.is_platform_owner(_actor);
    _is_tenant_admin := EXISTS (
      SELECT 1 FROM public.tenant_members tm
       WHERE tm.tenant_id = _tenant_id AND tm.user_id = _actor
         AND tm.status = 'active' AND tm.role IN ('owner','admin'));
  END IF;

  IF NOT (_is_platform_owner OR _is_tenant_admin) THEN
    RAISE EXCEPTION 'forbidden: only tenant admins may handle data subject requests';
  END IF;

  IF _request_type NOT IN ('export','delete','correct','portability') THEN
    RAISE EXCEPTION 'invalid_request_type: %', _request_type;
  END IF;

  SELECT * INTO _contact FROM public.clients
   WHERE id = _contact_id AND tenant_id = _tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact_not_found_in_tenant';
  END IF;

  IF _request_type = 'correct' THEN
    IF _corrections IS NULL OR jsonb_typeof(_corrections) <> 'object' THEN
      RAISE EXCEPTION 'corrections_required_for_correct';
    END IF;
    FOR _k, _v IN SELECT key, value FROM jsonb_each(_corrections) ORDER BY key LOOP
      _field := COALESCE(_aliases->>_k, _k);
      IF NOT (_field = ANY(_allowed_correction_fields))
         OR jsonb_typeof(_v) = 'null'
         OR (_field IN ('email','phone') AND NULLIF(btrim(_v #>> '{}'), '') IS NULL) THEN
        _ignored := _ignored || _k;
      -- A field's own name wins over its old alias when both are sent.
      ELSIF _k = _field OR NOT (_patch ? _field) THEN
        _patch := _patch || jsonb_build_object(_field, _v);
      ELSE
        _ignored := _ignored || _k;
      END IF;
    END LOOP;
    IF _patch = '{}'::jsonb THEN
      RAISE EXCEPTION 'no_allowed_correction_fields_present';
    END IF;
  END IF;

  -- Log to pii_access_log (7-year retention marker in payload)
  INSERT INTO public.pii_access_log (accessed_user_id, accessor_user_id, table_name, field_names, access_type)
  VALUES (
    COALESCE(_contact.linked_user_id, _actor),
    _actor,
    'clients',
    CASE _request_type
      WHEN 'correct' THEN ARRAY(SELECT jsonb_object_keys(_patch) ORDER BY 1)
      WHEN 'delete' THEN ARRAY['first_name','last_name','contact_methods','street_address','city','state','zip_code']
      ELSE ARRAY['clients','contact_methods','notes','deals','files','memory']
    END,
    CASE WHEN _request_type IN ('export','portability') THEN 'read' ELSE 'update' END
  );

  INSERT INTO public.paige_audit_log (actor_user_id, actor_role, action, target_type, target_id, tenant_id, payload)
  VALUES (
    _actor,
    CASE WHEN _is_platform_owner THEN 'platform_owner' ELSE 'tenant_admin' END,
    'dsr.' || _request_type,
    'clients',
    _contact_id,
    _tenant_id,
    jsonb_build_object(
      'tenant_id', _tenant_id,
      'reason', _reason,
      'via', CASE WHEN _service THEN 'service' ELSE 'session' END,
      'retention_years', 7,
      'retention_expires_at', (now() + interval '7 years')
    )
  );

  IF _request_type IN ('export','portability') THEN
    SELECT jsonb_build_object(
      'contact', to_jsonb(_contact) - 'ssn_encrypted',
      'contact_methods', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', m.kind, 'value', m.value, 'label', m.label, 'is_primary', m.is_primary, 'position', m.position) ORDER BY m.kind, m.position)
                                     FROM public.client_contact_methods m WHERE m.client_id = _contact_id), '[]'::jsonb),
      'notes', COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM public.client_notes n WHERE n.contact_id = _contact_id), '[]'::jsonb),
      'deals', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM public.deals d WHERE d.contact_client_id = _contact_id), '[]'::jsonb),
      'files', COALESCE((SELECT jsonb_agg(to_jsonb(f) - 'customer_chat_thread_id') FROM public.client_files f WHERE f.contact_id = _contact_id AND f.customer_chat_thread_id IS NULL), '[]'::jsonb),
      'memory', COALESCE((SELECT jsonb_agg(to_jsonb(m)) FROM public.client_memory m WHERE m.client_id = _contact_id), '[]'::jsonb)
    ) INTO _export;
    RETURN jsonb_build_object(
      'ok', true,
      'request_type', _request_type,
      'format', CASE WHEN _request_type = 'portability' THEN 'json_portable' ELSE 'json' END,
      'data', _export
    );
  END IF;

  IF _request_type = 'correct' THEN
    IF _patch ? 'email' OR _patch ? 'phone' THEN
      _expected := public._client_contact_methods_payload(_contact_id);
      _methods := public.contact_methods_with_primary(_expected, 'email', _patch->>'email');
      _methods := public.contact_methods_with_primary(_methods, 'phone', _patch->>'phone');
      PERFORM public._replace_client_contact_methods_checked(_tenant_id, _contact_id, _methods, _expected);
    END IF;
    UPDATE public.clients c
       SET first_name     = COALESCE(_patch->>'first_name', c.first_name),
           last_name      = COALESCE(_patch->>'last_name', c.last_name),
           entity_name    = COALESCE(_patch->>'entity_name', c.entity_name),
           street_address = COALESCE(_patch->>'street_address', c.street_address),
           city           = COALESCE(_patch->>'city', c.city),
           state          = COALESCE(_patch->>'state', c.state),
           zip_code       = COALESCE(_patch->>'zip_code', c.zip_code),
           updated_at     = now()
     WHERE c.id = _contact_id AND c.tenant_id = _tenant_id;
    RETURN jsonb_build_object('ok', true, 'request_type','correct','applied', _patch, 'ignored', to_jsonb(_ignored));
  END IF;

  IF _request_type = 'delete' THEN
    -- Serialize with the canonical address writers before taking the DELETE snapshot.
    -- Otherwise a replacement can commit while DELETE waits on an old address tuple:
    -- the old tuple is skipped and its newly inserted replacement is never seen.
    PERFORM 1 FROM public.clients
     WHERE id = _contact_id AND tenant_id = _tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'contact_not_found_in_tenant';
    END IF;
    -- Soft delete: null PII and mark deletion; keeps audit trail intact.
    DELETE FROM public.client_contact_methods m
     WHERE m.client_id = _contact_id AND m.tenant_id = _tenant_id;
    GET DIAGNOSTICS _removed = ROW_COUNT;
    UPDATE public.clients
       SET first_name = 'REDACTED', last_name = 'REDACTED',
           street_address = NULL, city = NULL, state = NULL, zip_code = NULL,
           status = 'archived',
           updated_at = now()
     WHERE id = _contact_id AND tenant_id = _tenant_id;
    RETURN jsonb_build_object('ok', true, 'request_type','delete','redacted', true, 'addresses_removed', _removed);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error','unhandled');
END;
$function$;

COMMIT;
