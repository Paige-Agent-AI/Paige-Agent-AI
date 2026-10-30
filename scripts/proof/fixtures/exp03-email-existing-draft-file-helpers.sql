-- Actual original native attachment and sender-facts helpers, for isolated proof.
-- Storage objects/domain facts below are synthetic metadata ports, not real files/provider verification.

-- _comms_email_attachment_manifest_ok(uuid,uuid,jsonb); body_md5=523b8f95ef37b9d97198d8561b8e9727; full_md5=9adb7d7f478a85537d0d51e5f75b7b1e
CREATE OR REPLACE FUNCTION public._comms_email_attachment_manifest_ok(_tenant uuid, _operation uuid, _m jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
END $function$;
REVOKE ALL ON FUNCTION public._comms_email_attachment_manifest_ok(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._comms_email_attachment_manifest_ok(uuid,uuid,jsonb) TO service_role;

-- _comms_email_sendgrid_sender_verified(uuid,text); body_md5=c7cb2db5deae84884a19c96f7bd4e109; full_md5=47ffa6378cf940b88275c93913e37d7c
CREATE OR REPLACE FUNCTION public._comms_email_sendgrid_sender_verified(_tenant uuid, _from_address text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce(
    _tenant IS NOT NULL
    AND lower(btrim(_from_address)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    AND EXISTS (
      SELECT 1 FROM public.tenant_email_domains d
       WHERE d.tenant_id = _tenant
         AND lower(btrim(d.domain)) = split_part(lower(btrim(_from_address)), '@', 2)
         AND d.sendgrid_status = 'verified'
         AND d.sendgrid_verified_at IS NOT NULL
         AND coalesce(length(btrim(d.sendgrid_domain_id)), 0) > 0),
    false)
$function$;
REVOKE ALL ON FUNCTION public._comms_email_sendgrid_sender_verified(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._comms_email_sendgrid_sender_verified(uuid,text) TO service_role;
