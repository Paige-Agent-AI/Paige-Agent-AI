-- Files through PAIGE's governed email door (comms.email_send, INT-328): the exact bytes the person
-- approved are the bytes sent, for an immediate and a scheduled send alike.
--
-- The door reads each composer upload (`<tenant>/<uuid>-<name>` in the private comms-attachments bucket),
-- checks and hashes it into the approved call (the manifest), and — once the person says yes — copies the
-- bytes it just hashed to `<tenant>/governed/<operation>/<n>-<name>`. This file binds that manifest to the
-- prepared row and keeps the governed folder out of every member's hands; send-message re-reads the copies
-- and refuses (nothing sent) when any one is missing or changed.
--
-- What this file changes, and only this:
--  1. NEW _comms_email_attachment_manifest_ok(tenant, operation, manifest) — true only for a manifest of
--     1..10 files, each exactly {path, source_path, name, mime, size, sha256}: the governed path of THIS
--     tenant and operation numbered in order, the composer source path of the same tenant, a known type,
--     1 B..10 MiB each and 10 MiB together, no repeat, and a governed object that EXISTS in storage with
--     exactly that size. The edge function checked the bytes themselves; this is the database's own check
--     that the binding can only ever name copies the door wrote for this operation.
--  2. NEW prepare_comms_email_send(<the 13 args>, _send_at timestamptz, _attachments jsonb) — a 15-argument
--     overload with NO defaults, so PostgREST picks it only when `_attachments` is named (the adapter names
--     it only for an email with files). Actor check; refuses no files, a drafted lead reply (approval_id)
--     and an agreement send; validates the manifest (1); takes the same per-operation advisory lock as the
--     13-argument body (hashtextextended(op, 32847), re-entrant); a replay whose stored files or send time
--     differ (including none) is a mismatch; then calls the UNCHANGED 13-argument (send_at NULL) or
--     14-argument (scheduled) function; then refuses a sender whose email does not leave through the
--     SendGrid arm (the raise rolls the inserted row back with it), else writes binding.attachments and
--     messages.attachments ([{url, name, mime, size}], the inbox's own shape) in ONE update.
--  3. NEW list_governed_comms_attachment_orphans(limit) — the governed copies no send will ever need: a
--     copy no binding names, after a day (an approval that never prepared), and the copies of a send that
--     was refused or failed, a week after it closed. A sent email's files are kept as its record.
--     comms-scheduled-drain removes them with storage.remove(), once an hour, bounded.
--  4. Three RESTRICTIVE storage policies for `authenticated`: no INSERT, UPDATE or DELETE of an object
--     whose second path segment is `governed` in comms-attachments (the team_hub_files_*_boundary pattern,
--     20271114160008). SELECT stays as it is: members read their own business's approved files. Only the
--     service role, which bypasses RLS, writes or removes them.
--
-- NO existing function body is replaced. The md5 guard pins the three bodies this file calls.
-- §59: every new function is SECURITY DEFINER with a pinned search_path, service_role only, and the
-- prepare re-proves its actor in its own body.
--
-- HONEST RESIDUALS (§13):
--  * Only a sender whose email leaves through the SendGrid arm carries files: provider 'sendgrid' (PAIGE
--    Email) and 'resend' (the legacy label of PAIGE's managed sender and of a custom-domain connector,
--    sent through that arm since Experience 03). Gmail and SMTP keep their single-PDF behaviour.
--  * The storage checks read storage.objects as this function's owner; a copy removed after prepare is
--    caught at send time by send-message's re-hash (refused, nothing sent), not here.
BEGIN;
SET LOCAL lock_timeout='3s';
DO $guard$
DECLARE expected record; actual text;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public._comms_email_actor(uuid,uuid)','c9850c30ae7885c23eee1da268c8c0e0'),
  ('public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb)','8da3b64c24552123b973db96a74ab986'),
  ('public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz)','432b0c8548b9e0c52a0b0a52acbee4c3')
 ) AS dependencies(identity,body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(expected.identity);
  IF NOT FOUND OR actual IS DISTINCT FROM expected.body THEN
   RAISE EXCEPTION 'Governed email attachment dependency % changed; reconcile before applying',expected.identity USING ERRCODE='23514'; END IF;
 END LOOP;
END $guard$;

-- 1. The manifest check. Pure over its inputs plus one read of storage.objects per file.
CREATE OR REPLACE FUNCTION public._comms_email_attachment_manifest_ok(_tenant uuid,_operation uuid,_m jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e jsonb; i int:=0; total bigint:=0; name text; src text; size bigint; paths text[]:='{}';
 types constant text[]:=ARRAY['application/pdf','image/png','image/jpeg','image/gif','image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword','application/vnd.ms-excel','text/plain','text/csv'];
BEGIN
 IF _tenant IS NULL OR _operation IS NULL OR _m IS NULL OR jsonb_typeof(_m)<>'array'
  OR jsonb_array_length(_m)<1 OR jsonb_array_length(_m)>10 THEN RETURN false; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(_m) WITH ORDINALITY ORDER BY ordinality LOOP
  i:=i+1;
  IF jsonb_typeof(e)<>'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k)
    IS DISTINCT FROM ARRAY['mime','name','path','sha256','size','source_path'] THEN RETURN false; END IF;
  IF jsonb_typeof(e->'path')<>'string' OR jsonb_typeof(e->'source_path')<>'string' OR jsonb_typeof(e->'name')<>'string'
   OR jsonb_typeof(e->'mime')<>'string' OR jsonb_typeof(e->'sha256')<>'string' OR jsonb_typeof(e->'size')<>'number' THEN RETURN false; END IF;
  name:=e->>'name'; src:=e->>'source_path';
  IF name !~ '^[A-Za-z0-9._-]{1,120}$' OR position('..' in src)>0
   OR src !~ ('^'||_tenant::text||'/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$') OR substr(src,length(_tenant::text)+39) IS DISTINCT FROM name
   OR e->>'path' IS DISTINCT FROM (_tenant::text||'/governed/'||_operation::text||'/'||i::text||'-'||name)
   OR NOT (e->>'mime' = ANY(types)) OR e->>'sha256' !~ '^[0-9a-f]{64}$' OR e->>'size' !~ '^[0-9]{1,9}$' THEN RETURN false; END IF;
  size:=(e->>'size')::bigint;
  IF size<1 OR size>10485760 OR (e->>'path')=ANY(paths) THEN RETURN false; END IF;
  total:=total+size; paths:=paths||(e->>'path');
  -- The governed copy exists, exactly this size (storage records it in the object's metadata).
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='comms-attachments' AND o.name=e->>'path'
    AND o.metadata->>'size' ~ '^[0-9]{1,12}$' AND (o.metadata->>'size')::bigint=size) THEN RETURN false; END IF;
 END LOOP;
 RETURN total<=10485760;
END $$;

-- 2. The prepare with files. No defaults: an email without files can never reach it.
CREATE OR REPLACE FUNCTION public.prepare_comms_email_send(_actor_user_id uuid,_expected_tenant_id uuid,_operation_id uuid,_contact_id uuid,_recipient text,_connector_id uuid,_from_address text,_subject text,_body_text text,_body_html text,_content_digest text,_command jsonb,_governance jsonb,_send_at timestamptz,_attachments jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m public.messages%ROWTYPE; r jsonb; b jsonb; send_at_text text;
BEGIN
 PERFORM public._comms_email_actor(_actor_user_id,_expected_tenant_id);
 IF _attachments IS NULL OR jsonb_typeof(_attachments)<>'array' OR jsonb_array_length(_attachments)=0 THEN
  RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 -- A drafted lead reply is sent exactly as drafted and recorded against its approval; an agreement's
 -- signing request is its own message. Neither carries files through this door.
 IF _governance->>'purpose' IS NOT DISTINCT FROM 'agreement_signature_request' OR coalesce(btrim(_governance->>'approval_id'),'')<>'' THEN
  RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_NOT_SUPPORTED' USING ERRCODE='22023';
 END IF;
 IF _operation_id IS NULL OR NOT public._comms_email_attachment_manifest_ok(_expected_tenant_id,_operation_id,_attachments) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_INVALID' USING ERRCODE='22023';
 END IF;
 IF _send_at IS NOT NULL THEN send_at_text:=to_char(_send_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); END IF;
 -- The 13-argument body's own lock (re-entrant): this replay read, its insert and the update below serialize.
 PERFORM pg_advisory_xact_lock(hashtextextended(_operation_id::text,32847));
 SELECT * INTO m FROM public.messages WHERE meta#>>'{comms_email_binding,operation_id}'=_operation_id::text;
 IF FOUND AND (m.meta#>'{comms_email_binding,attachments}' IS DISTINCT FROM _attachments
   OR m.meta#>>'{comms_email_binding,send_at}' IS DISTINCT FROM send_at_text) THEN
  RAISE EXCEPTION 'COMMS_EMAIL_REPLAY_MISMATCH' USING ERRCODE='22023';
 END IF;
 IF _send_at IS NULL THEN
  r:=public.prepare_comms_email_send(_actor_user_id,_expected_tenant_id,_operation_id,_contact_id,_recipient,_connector_id,
    _from_address,_subject,_body_text,_body_html,_content_digest,_command,_governance);
 ELSE
  r:=public.prepare_comms_email_send(_actor_user_id,_expected_tenant_id,_operation_id,_contact_id,_recipient,_connector_id,
    _from_address,_subject,_body_text,_body_html,_content_digest,_command,_governance,_send_at);
 END IF;
 IF r->'replayed' IS DISTINCT FROM 'true'::jsonb THEN
  SELECT * INTO m FROM public.messages WHERE id=(r->>'message_id')::uuid FOR UPDATE;
  b:=m.meta->'comms_email_binding';
  -- Only the SendGrid arm sends governed files. Raising here rolls back the row just inserted.
  IF b->>'provider' IS NULL OR b->>'provider' NOT IN ('sendgrid','resend') THEN
   RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_PROVIDER_UNSUPPORTED' USING ERRCODE='22023';
  END IF;
  UPDATE public.messages SET
    meta=jsonb_set(meta,'{comms_email_binding,attachments}',_attachments),
    attachments=(SELECT jsonb_agg(jsonb_build_object('url',e->>'path','name',e->>'name','mime',e->>'mime','size',(e->>'size')::bigint) ORDER BY ordinality)
                 FROM jsonb_array_elements(_attachments) WITH ORDINALITY AS a(e,ordinality))
   WHERE id=m.id AND meta#>>'{comms_email_binding,operation_id}'=_operation_id::text AND meta#>>'{comms_email_binding,state}'='prepared';
  IF NOT FOUND THEN RAISE EXCEPTION 'COMMS_EMAIL_ATTACHMENTS_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN r||jsonb_build_object('attachments',jsonb_array_length(_attachments));
END $$;

-- 3. Governed copies no send will ever need. The drainer removes them (storage.remove); a sent email's
--    files are its record and are never listed.
CREATE OR REPLACE FUNCTION public.list_governed_comms_attachment_orphans(_limit integer) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT o.name FROM storage.objects o
  WHERE o.bucket_id='comms-attachments' AND split_part(o.name,'/',2)='governed'
    AND split_part(o.name,'/',3) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (
     -- No binding names this copy (the approval never prepared, or prepared other files): after a day.
     (o.created_at<now()-interval '24 hours' AND NOT EXISTS (
       SELECT 1 FROM public.messages m WHERE m.meta ? 'comms_email_binding'
        AND m.meta#>>'{comms_email_binding,operation_id}'=split_part(o.name,'/',3)
        AND m.tenant_id::text=split_part(o.name,'/',1)
        AND coalesce(m.meta#>'{comms_email_binding,attachments}','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('path',o.name))))
     -- The send that names it was refused or failed, and closed more than a week ago: nothing went out.
     OR EXISTS (
       SELECT 1 FROM public.messages m WHERE m.meta ? 'comms_email_binding'
        AND m.meta#>>'{comms_email_binding,operation_id}'=split_part(o.name,'/',3)
        AND m.tenant_id::text=split_part(o.name,'/',1)
        AND m.meta#>>'{comms_email_binding,state}' IN ('refused','failed')
        AND m.meta#>>'{comms_email_binding,finalized_at}' ~ '^\d{4}-\d{2}-\d{2}'
        AND (m.meta#>>'{comms_email_binding,finalized_at}')::timestamptz<now()-interval '7 days'))
  ORDER BY o.created_at
  LIMIT greatest(1,least(coalesce(_limit,100),500));
$$;

-- 4. Members may read their business's approved files, never write, overwrite or remove one.
DROP POLICY IF EXISTS comms_email_governed_files_insert_boundary ON storage.objects;
CREATE POLICY comms_email_governed_files_insert_boundary ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (NOT coalesce(bucket_id='comms-attachments' AND split_part(name,'/',2)='governed', false));
-- No overwrite of a governed object, and no rename or move of any object into the folder.
DROP POLICY IF EXISTS comms_email_governed_files_update_boundary ON storage.objects;
CREATE POLICY comms_email_governed_files_update_boundary ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (NOT coalesce(bucket_id='comms-attachments' AND split_part(name,'/',2)='governed', false))
 WITH CHECK (NOT coalesce(bucket_id='comms-attachments' AND split_part(name,'/',2)='governed', false));
DROP POLICY IF EXISTS comms_email_governed_files_delete_boundary ON storage.objects;
CREATE POLICY comms_email_governed_files_delete_boundary ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING (NOT coalesce(bucket_id='comms-attachments' AND split_part(name,'/',2)='governed', false));

REVOKE ALL ON FUNCTION public._comms_email_attachment_manifest_ok(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._comms_email_attachment_manifest_ok(uuid,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_comms_email_send(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,jsonb,jsonb,timestamptz,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.list_governed_comms_attachment_orphans(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_governed_comms_attachment_orphans(integer) TO service_role;
COMMIT;
