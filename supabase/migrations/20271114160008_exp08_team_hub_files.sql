-- EXP08 Team Hub increment 3: files on messages and thread replies. Contract:
-- docs/delivery/exp08-team-hub-increment3-attachments-contract.md (increments 1 and 2 still hold).
-- No new bucket: the bytes live in the existing private comms-attachments bucket under
-- <tenant_id>/team-hub/<file_id>, a path the server builds and the client never chooses. Four
-- RESTRICTIVE storage.objects policies are AND-ed with the permissive comms_attach member policies
-- on that prefix only, so only a person who can see the conversation now uploads into it or reads
-- from it. Operator and agency standing, which the permissive policies admit, never reach it, and
-- no browser caller overwrites, renames into or deletes a Team Hub object: the service role does.
-- Files are not scanned for malware (owner decision): the type allow-list, the 10 MB and 5-per-
-- message limits, the server-side real-type check in the team-hub-file edge function and
-- attachment-only downloads are the conditions it ships under.
-- One record table, RLS-on with no policies and no browser grant. The browser doors re-run
-- increment 1's door in their bodies (§59); the verdict and the stale sweep are service-role only.
-- Expected refusals return {"ok":false,"code":...}; nothing raises. Every grant is explicit.
-- Forward-only and replay-safe: a second apply changes nothing.
BEGIN;
SET LOCAL lock_timeout = '2s';

CREATE TABLE IF NOT EXISTS public.team_hub_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 channel_id uuid NOT NULL REFERENCES public.team_hub_channels(id) ON DELETE CASCADE,
 uploaded_by uuid NOT NULL,
 client_request_id uuid NOT NULL,
 storage_path text NOT NULL,
 file_name text NOT NULL,
 mime_type text NOT NULL,
 size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready','rejected','discarded')),
 rejected_reason text,
 message_id uuid REFERENCES public.team_hub_messages(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz,
 posted_at timestamptz,
 CONSTRAINT team_hub_files_request_key UNIQUE (uploaded_by, client_request_id),
 CONSTRAINT team_hub_files_path_key UNIQUE (storage_path),
 -- Three lowercase segments: uuid::text is lowercase, so the path is too.
 CONSTRAINT team_hub_files_path_chk CHECK (storage_path=tenant_id::text||'/team-hub/'||id::text),
 CONSTRAINT team_hub_files_name_chk CHECK (char_length(file_name) BETWEEN 1 AND 255 AND file_name !~ '[[:cntrl:]/\\]'),
 -- The nine types of the contract's §1. Legacy .doc/.xls and PowerPoint are refused.
 CONSTRAINT team_hub_files_mime_chk CHECK (mime_type IN ('application/pdf','image/png','image/jpeg','image/webp','image/gif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/csv')),
 CONSTRAINT team_hub_files_state_chk CHECK (
  (state='rejected')=(rejected_reason IS NOT NULL)
  AND (state<>'ready' OR checked_at IS NOT NULL)
  AND (message_id IS NULL OR state='ready')
  AND ((message_id IS NULL)=(posted_at IS NULL)))
);
CREATE INDEX IF NOT EXISTS team_hub_files_message_idx
 ON public.team_hub_files (message_id, created_at, id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS team_hub_files_unposted_idx
 ON public.team_hub_files (uploaded_by, created_at) WHERE message_id IS NULL AND state IN ('pending','ready');

ALTER TABLE public.team_hub_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.team_hub_files FROM PUBLIC, anon, authenticated;

-- Storage backstop. A file belongs to its conversation's workspace, and once posted to a message
-- of that same conversation, written by its uploader.
CREATE OR REPLACE FUNCTION public._team_hub_file_scope_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.team_hub_channels c WHERE c.id=NEW.channel_id AND c.tenant_id=NEW.tenant_id) THEN
  RAISE EXCEPTION 'TEAM_HUB_FILE_SCOPE' USING ERRCODE='23514'; END IF;
 IF NEW.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages m WHERE m.id=NEW.message_id
   AND m.tenant_id=NEW.tenant_id AND m.channel_id=NEW.channel_id AND m.author_user_id=NEW.uploaded_by) THEN
  RAISE EXCEPTION 'TEAM_HUB_FILE_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_file_scope_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_file_scope BEFORE INSERT OR UPDATE OF tenant_id, channel_id, message_id, uploaded_by
 ON public.team_hub_files FOR EACH ROW EXECUTE FUNCTION public._team_hub_file_scope_guard();

-- The two storage predicates. Each is reached only from a policy on storage.objects, which
-- evaluates as the browser's own role, so these alone of the Team Hub helpers are EXECUTE to
-- authenticated. They take only an object name, re-derive the caller from auth.uid(), and answer
-- true or false; anything that is not exactly <uuid>/team-hub/<uuid> is false.
CREATE OR REPLACE FUNCTION public._team_hub_file_can_upload(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); tenant uuid;
BEGIN
 IF actor IS NULL OR p_name IS NULL OR p_name !~
   '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/team-hub/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RETURN false; END IF;
 tenant:=split_part(p_name,'/',1)::uuid;
 IF public._team_hub_refusal(tenant) IS NOT NULL THEN RETURN false; END IF;
 -- Only the uploader's own unexpired pending record, in a conversation they can still see.
 RETURN EXISTS(SELECT 1 FROM public.team_hub_files f
  WHERE f.storage_path=p_name AND f.tenant_id=tenant AND f.uploaded_by=actor AND f.state='pending'
   AND f.message_id IS NULL AND f.created_at>now()-interval '1 day'
   AND EXISTS(SELECT 1 FROM public._team_hub_visible(tenant,actor,f.channel_id)));
END $$;
REVOKE ALL ON FUNCTION public._team_hub_file_can_upload(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public._team_hub_file_can_upload(text) TO authenticated;

CREATE OR REPLACE FUNCTION public._team_hub_file_can_read(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); tenant uuid;
BEGIN
 IF actor IS NULL OR p_name IS NULL OR p_name !~
   '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/team-hub/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RETURN false; END IF;
 tenant:=split_part(p_name,'/',1)::uuid;
 IF public._team_hub_refusal(tenant) IS NOT NULL THEN RETURN false; END IF;
 -- Posted to a message that still stands, in a conversation the caller can see now: a person
 -- removed from a private channel, or whose seat ended, loses the file at once.
 RETURN EXISTS(SELECT 1 FROM public.team_hub_files f
  JOIN public.team_hub_messages m ON m.id=f.message_id AND m.deleted_at IS NULL
  WHERE f.storage_path=p_name AND f.tenant_id=tenant AND f.state='ready'
   AND EXISTS(SELECT 1 FROM public._team_hub_visible(tenant,actor,f.channel_id)));
END $$;
REVOKE ALL ON FUNCTION public._team_hub_file_can_read(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public._team_hub_file_can_read(text) TO authenticated;

-- Restrictive policies are AND-ed with every permissive one. On any object outside the Team Hub
-- prefix each is true, so Inbox attachments in the same bucket behave exactly as before. The
-- prefix is the second path segment, split_part(name,'/',2)='team-hub', exactly the rule the
-- retirement manifest and guard (20271114160108) use, so every layer agrees on what a Team Hub
-- object is: the two-segment name <tenant>/team-hub is inside it and refused, not left for any
-- member to create and block retirement with. The segment is case-sensitive everywhere. The
-- coalesce keeps a NULL name outside the prefix.
DROP POLICY IF EXISTS team_hub_files_insert_boundary ON storage.objects;
CREATE POLICY team_hub_files_insert_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (NOT coalesce(bucket_id='comms-attachments' AND split_part(name,'/',2)='team-hub', false)
  OR (owner_id=(auth.uid())::text AND public._team_hub_file_can_upload(name)));
DROP POLICY IF EXISTS team_hub_files_select_boundary ON storage.objects;
CREATE POLICY team_hub_files_select_boundary ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING (NOT coalesce(bucket_id='comms-attachments' AND split_part(name,'/',2)='team-hub', false)
  OR public._team_hub_file_can_read(name));
-- No overwrite of a Team Hub object, and no rename or move of any object into the prefix.
DROP POLICY IF EXISTS team_hub_files_update_boundary ON storage.objects;
CREATE POLICY team_hub_files_update_boundary ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (NOT coalesce(bucket_id='comms-attachments' AND split_part(name,'/',2)='team-hub', false))
 WITH CHECK (NOT coalesce(bucket_id='comms-attachments' AND split_part(name,'/',2)='team-hub', false));
-- Only the service role, which bypasses RLS, removes Team Hub objects.
DROP POLICY IF EXISTS team_hub_files_delete_boundary ON storage.objects;
CREATE POLICY team_hub_files_delete_boundary ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING (NOT coalesce(bucket_id='comms-attachments' AND split_part(name,'/',2)='team-hub', false));

-- A message may now carry files and no text. The door still refuses a message with neither; this
-- storage check keeps the length and trim rules and allows the empty body only the door writes.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_messages'::regclass AND conname='team_hub_messages_body_check') THEN
  ALTER TABLE public.team_hub_messages DROP CONSTRAINT team_hub_messages_body_check;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.team_hub_messages'::regclass AND conname='team_hub_messages_body_chk') THEN
  ALTER TABLE public.team_hub_messages ADD CONSTRAINT team_hub_messages_body_chk
   CHECK (char_length(body)<=8000 AND body=btrim(body, E' \t\r\n'));
 END IF;
END $$;

-- Increments 1 and 2's message shape, plus files: [{id, name, mime, size, path}] in the order they
-- were attached, [] when there are none. The path lets the client mint a signed URL; reading the
-- object still needs the read policy above.
CREATE OR REPLACE FUNCTION public._team_hub_message_json(p_message public.team_hub_messages)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_message.id,'author_user_id',p_message.author_user_id,'body',p_message.body,
  'created_at',p_message.created_at,'parent_message_id',p_message.parent_message_id,
  'reply_count',(SELECT count(*) FROM public.team_hub_messages r
   WHERE r.parent_message_id=p_message.id AND r.deleted_at IS NULL),
  'last_reply_at',(SELECT max(r.created_at) FROM public.team_hub_messages r
   WHERE r.parent_message_id=p_message.id AND r.deleted_at IS NULL),
  'mentions',coalesce((SELECT jsonb_agg(x.mentioned_user_id ORDER BY x.mentioned_user_id)
   FROM public.team_hub_message_mentions x WHERE x.message_id=p_message.id),'[]'::jsonb),
  'work_ref',(SELECT jsonb_build_object('source',w.work_source,'id',w.work_id)
   FROM public.team_hub_work_refs w WHERE w.message_id=p_message.id),
  'files',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.file_name,'mime',f.mime_type,
    'size',f.size_bytes,'path',f.storage_path) ORDER BY f.created_at, f.id)
   FROM public.team_hub_files f WHERE f.message_id=p_message.id AND f.state='ready'),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION public._team_hub_message_json(public.team_hub_messages) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._team_hub_file_json(p_file public.team_hub_files)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p_file.id,'path',p_file.storage_path,'name',p_file.file_name,'mime',p_file.mime_type,
  'size',p_file.size_bytes,'state',p_file.state)
$$;
REVOKE ALL ON FUNCTION public._team_hub_file_json(public.team_hub_files) FROM PUBLIC, anon, authenticated, service_role;

-- Starts one upload: a pending record whose path the browser then uploads to. The retry check
-- comes before validation, as in team_hub_post_message: a retry returns the same record, and the
-- same request id in another conversation is a client error. The extension must name the declared
-- type (case-insensitive). A per-uploader lock makes the unposted limit hold for concurrent tabs.
CREATE OR REPLACE FUNCTION public.team_hub_begin_file(p_expected_tenant uuid, p_channel_id uuid, p_name text,
 p_mime text, p_size bigint, p_client_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
 f public.team_hub_files; ext text:=lower(substring(p_name FROM '\.([^.]+)$')); file_id uuid:=gen_random_uuid();
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_client_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT * INTO f FROM public.team_hub_files x WHERE x.uploaded_by=actor AND x.client_request_id=p_client_request_id;
 IF FOUND THEN
  IF f.channel_id<>ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'file',public._team_hub_file_json(f),'duplicate',true);
 END IF;
 IF p_name IS NULL OR char_length(p_name) NOT BETWEEN 1 AND 255 OR p_name ~ '[[:cntrl:]/\\]' OR ext IS NULL
   OR p_mime IS NULL OR NOT (
    (p_mime='application/pdf' AND ext='pdf')
    OR (p_mime='image/png' AND ext='png')
    OR (p_mime='image/jpeg' AND ext IN ('jpg','jpeg'))
    OR (p_mime='image/webp' AND ext='webp')
    OR (p_mime='image/gif' AND ext='gif')
    OR (p_mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document' AND ext='docx')
    OR (p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' AND ext='xlsx')
    OR (p_mime='text/plain' AND ext='txt')
    OR (p_mime='text/csv' AND ext='csv')) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF p_size IS NULL OR p_size<1 THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF p_size>10485760 THEN RETURN jsonb_build_object('ok',false,'code','too_large'); END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('team_hub_files:'||actor::text,0));
 IF (SELECT count(*) FROM public.team_hub_files x WHERE x.uploaded_by=actor AND x.message_id IS NULL
   AND x.state IN ('pending','ready') AND x.created_at>now()-interval '1 day')>=20 THEN
  RETURN jsonb_build_object('ok',false,'code','limit_reached'); END IF;
 INSERT INTO public.team_hub_files(id,tenant_id,channel_id,uploaded_by,client_request_id,storage_path,file_name,mime_type,size_bytes)
  VALUES (file_id,p_expected_tenant,ch.id,actor,p_client_request_id,p_expected_tenant::text||'/team-hub/'||file_id::text,
   p_name,p_mime,p_size)
  ON CONFLICT (uploaded_by,client_request_id) DO NOTHING RETURNING * INTO f;
 IF f.id IS NULL THEN
  -- A concurrent retry stored it first.
  SELECT * INTO f FROM public.team_hub_files x WHERE x.uploaded_by=actor AND x.client_request_id=p_client_request_id;
  IF NOT FOUND OR f.channel_id IS DISTINCT FROM ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'file',public._team_hub_file_json(f),'duplicate',true);
 END IF;
 RETURN jsonb_build_object('ok',true,'file',public._team_hub_file_json(f));
END $$;
REVOKE ALL ON FUNCTION public.team_hub_begin_file(uuid,uuid,text,text,bigint,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_begin_file(uuid,uuid,text,text,bigint,uuid) TO authenticated;

-- What the team-hub-file edge function may check, read under the caller's own JWT before any
-- bytes are fetched: only the uploader's own pending or ready file, in a conversation they see.
CREATE OR REPLACE FUNCTION public.team_hub_file_for_check(p_expected_tenant uuid, p_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); f public.team_hub_files;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO f FROM public.team_hub_files x WHERE x.id=p_file_id AND x.tenant_id=p_expected_tenant AND x.uploaded_by=actor;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public._team_hub_visible(p_expected_tenant,actor,f.channel_id)) THEN
  RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF f.state NOT IN ('pending','ready') THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 RETURN jsonb_build_object('ok',true,'file',public._team_hub_file_json(f) - 'name');
END $$;
REVOKE ALL ON FUNCTION public.team_hub_file_for_check(uuid,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_file_for_check(uuid,uuid) TO authenticated;

-- Removes a chip before sending. The edge function deletes the object with the service role
-- afterwards. Visibility is not required: a person who lost the conversation may still clear
-- their own unposted upload. A refused file is already terminal and its bytes already gone.
CREATE OR REPLACE FUNCTION public.team_hub_discard_file(p_expected_tenant uuid, p_file_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); f public.team_hub_files;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO f FROM public.team_hub_files x WHERE x.id=p_file_id AND x.tenant_id=p_expected_tenant AND x.uploaded_by=actor FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF f.message_id IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 IF f.state IN ('pending','ready') THEN
  UPDATE public.team_hub_files x SET state='discarded' WHERE x.id=f.id;
 END IF;
 RETURN jsonb_build_object('ok',true,'path',f.storage_path);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_discard_file(uuid,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_discard_file(uuid,uuid) TO authenticated;

-- Increment 1's post door, plus p_file_ids. With files the body may be blank. Every file must be
-- ready, the caller's own, in this conversation and not yet posted, otherwise invalid and nothing
-- is stored; the rows are locked, then stamped in the same transaction as the message. The six-
-- argument signature is dropped rather than overloaded, so team_hub_request_task's positional call
-- resolves here. Nothing has shipped.
DROP FUNCTION IF EXISTS public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[]);
CREATE OR REPLACE FUNCTION public.team_hub_post_message(p_expected_tenant uuid, p_channel_id uuid, p_body text,
 p_client_request_id uuid, p_parent_message_id uuid DEFAULT NULL, p_mention_ids uuid[] DEFAULT '{}',
 p_file_ids uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
 body text:=public._team_hub_trim(p_body); mentions uuid[]; msg public.team_hub_messages; other uuid;
 files uuid[]:=coalesce(p_file_ids,'{}'::uuid[]); held int;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_client_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- A retry returns the original, with its files. The same request id in another conversation is a client error.
 SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_user_id=actor AND m.client_request_id=p_client_request_id;
 IF FOUND THEN
  IF msg.channel_id<>ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 -- 0 to 5 distinct, non-null ids.
 IF cardinality(files)>5 OR array_position(files,NULL) IS NOT NULL
   OR cardinality(files)<>(SELECT count(DISTINCT x.id) FROM unnest(files) x(id)) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF body IS NULL OR (body='' AND cardinality(files)=0) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF char_length(body)>8000 THEN RETURN jsonb_build_object('ok',false,'code','too_long'); END IF;
 IF p_parent_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages p
   WHERE p.id=p_parent_message_id AND p.channel_id=ch.id AND p.parent_message_id IS NULL AND p.deleted_at IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- Before anything is written. Locked in id order, so a concurrent post of the same file waits
 -- here and then finds it posted.
 IF cardinality(files)>0 THEN
  SELECT count(*) INTO held FROM (SELECT f.id FROM public.team_hub_files f
   WHERE f.id=ANY(files) AND f.tenant_id=p_expected_tenant AND f.channel_id=ch.id AND f.uploaded_by=actor
    AND f.state='ready' AND f.message_id IS NULL ORDER BY f.id FOR UPDATE) s;
  IF held<>cardinality(files) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 END IF;
 -- A DM keeps reaching the other person. If their seat ended and they were re-invited, the seat
 -- trigger removed their membership; posting restores it, as reopening the DM does. A person
 -- whose seat is not active stays out. This comes before the mention check so the restored person
 -- can be mentioned; an active DM party belongs in the DM even if this post is then refused.
 IF ch.kind='dm' THEN
  other:=CASE split_part(ch.dm_key,':',1) WHEN actor::text THEN split_part(ch.dm_key,':',2)
   ELSE split_part(ch.dm_key,':',1) END::uuid;
  IF other IS NOT NULL AND public._team_hub_hold_seats(p_expected_tenant,ARRAY[other]) THEN
   INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
    VALUES (ch.id,p_expected_tenant,other,actor) ON CONFLICT (channel_id,user_id) DO NOTHING;
  END IF;
 END IF;
 -- A mention must be an active member who can see this conversation: anyone active for a team
 -- channel, the channel's members for a private channel or DM.
 IF EXISTS(SELECT 1 FROM unnest(coalesce(p_mention_ids,'{}'::uuid[])) x(id)
   WHERE x.id IS NULL OR NOT public._team_hub_is_active(p_expected_tenant,x.id)
    OR (ch.visibility='private' AND NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members m
     WHERE m.channel_id=ch.id AND m.user_id=x.id))) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 mentions:=ARRAY(SELECT DISTINCT x.id FROM unnest(coalesce(p_mention_ids,'{}'::uuid[])) x(id));
 IF ch.visibility='team' THEN
  IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor]) THEN RETURN jsonb_build_object('ok',false,'code','not_member'); END IF;
  INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by,last_read_at)
   VALUES (ch.id,p_expected_tenant,actor,actor,now()) ON CONFLICT (channel_id,user_id) DO NOTHING;
 END IF;
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id)
  VALUES (p_expected_tenant,ch.id,actor,body,p_parent_message_id,p_client_request_id)
  ON CONFLICT (author_user_id,client_request_id) DO NOTHING RETURNING * INTO msg;
 IF msg.id IS NULL THEN
  -- A concurrent retry stored it first.
  -- Never a success built from a row this statement cannot see.
  SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_user_id=actor AND m.client_request_id=p_client_request_id;
  IF NOT FOUND OR msg.channel_id IS DISTINCT FROM ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 INSERT INTO public.team_hub_message_mentions(message_id,tenant_id,channel_id,mentioned_user_id)
  SELECT msg.id,p_expected_tenant,ch.id,x.id FROM unnest(mentions) x(id);
 UPDATE public.team_hub_files f SET message_id=msg.id, posted_at=now() WHERE f.id=ANY(files);
 RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg));
END $$;
REVOKE ALL ON FUNCTION public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[]) TO authenticated;

-- Service role only: the team-hub-file edge function's verdict after it has sniffed the bytes. A
-- file becomes ready only when the sniffed type is the declared one AND the stored object is the
-- uploader's, of the declared size and type, by Storage's own record of it. Otherwise it is
-- rejected with a short reason code (never a file name). Only a pending file is decided.
CREATE OR REPLACE FUNCTION public.team_hub_file_verdict(p_file_id uuid, p_uploader uuid, p_detected_mime text,
 p_accept boolean, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f public.team_hub_files; reason text;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 SELECT * INTO f FROM public.team_hub_files x WHERE x.id=p_file_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_uploader IS NULL OR f.uploaded_by<>p_uploader THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF f.state<>'pending' THEN RETURN jsonb_build_object('ok',false,'code','invalid','state',f.state); END IF;
 IF p_accept IS TRUE AND p_detected_mime IS NOT DISTINCT FROM f.mime_type
   AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='comms-attachments' AND o.name=f.storage_path
    AND o.owner_id=p_uploader::text
    AND CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,10}$' THEN (o.metadata->>'size')::bigint END=f.size_bytes
    AND o.metadata->>'mimetype'=f.mime_type) THEN
  UPDATE public.team_hub_files x SET state='ready', checked_at=now() WHERE x.id=f.id;
  RETURN jsonb_build_object('ok',true,'state','ready');
 END IF;
 reason:=CASE WHEN p_accept IS NOT TRUE AND coalesce(p_reason,'') ~ '^[a-z][a-z0-9_]{0,63}$' THEN p_reason
  WHEN p_accept IS NOT TRUE THEN 'rejected'
  WHEN p_detected_mime IS DISTINCT FROM f.mime_type THEN 'type_mismatch'
  ELSE 'object_mismatch' END;
 UPDATE public.team_hub_files x SET state='rejected', rejected_reason=reason, checked_at=now() WHERE x.id=f.id;
 RETURN jsonb_build_object('ok',true,'state','rejected','reason',reason);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_file_verdict(uuid,uuid,text,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_file_verdict(uuid,uuid,text,boolean,text) TO service_role;

-- Service role only: that uploader's own unposted files older than a day, pending or ready, are
-- discarded, and their paths returned so the edge function removes the objects. A ready file
-- nobody posted is readable by no one, so after a day its bytes are claimed too rather than kept
-- until account retirement. Nobody else's files, and nothing posted: the post door locks the
-- file FOR UPDATE and requires it ready and unposted, so a sweep and a post of the same file
-- serialize and exactly one of them wins.
CREATE OR REPLACE FUNCTION public.team_hub_claim_stale_files(p_uploader uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE paths jsonb;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 -- Also re-offers this uploader's discarded or refused files whose object is still stored: a removal
 -- that failed or timed out is retried on the next sweep instead of waiting for account retirement.
 WITH claimed AS (
  UPDATE public.team_hub_files x SET state='discarded'
   WHERE x.uploaded_by=p_uploader AND x.state IN ('pending','ready') AND x.message_id IS NULL AND x.created_at<=now()-interval '1 day'
   RETURNING x.storage_path),
 leftover AS (
  SELECT x.storage_path FROM public.team_hub_files x
   WHERE x.uploaded_by=p_uploader AND x.state IN ('discarded','rejected')
    AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='comms-attachments' AND o.name=x.storage_path)
   ORDER BY x.created_at LIMIT 100),
 every AS (SELECT c.storage_path FROM claimed c UNION SELECT l.storage_path FROM leftover l)
 SELECT coalesce(jsonb_agg(e.storage_path ORDER BY e.storage_path),'[]'::jsonb) INTO paths FROM every e;
 RETURN jsonb_build_object('ok',true,'paths',paths);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_claim_stale_files(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_hub_claim_stale_files(uuid) TO service_role;

-- A10: file records go with the account at retirement (the bytes are purged by the team_hub_files
-- storage retirement provider). The same guarded patch, reconciled against increment 2's entry.
DO $$ DECLARE body text; anchor text:='SELECT CASE WHEN _table=ANY(ARRAY['; at integer; BEGIN
 body:=pg_get_functiondef('public.operator_retirement_disposition(text)'::regprocedure); at:=position(anchor IN body);
 IF position('''team_hub_files''' IN body)>0 THEN RETURN; END IF;
 IF at=0 OR position('''team_hub_work_refs''' IN body)=0 THEN
  RAISE EXCEPTION 'Canonical retirement policy requires reconciliation before registering Team Hub files'; END IF;
 EXECUTE left(body,at+length(anchor)-1)||'''team_hub_files'','||substr(body,at+length(anchor));
END $$;
COMMIT;
