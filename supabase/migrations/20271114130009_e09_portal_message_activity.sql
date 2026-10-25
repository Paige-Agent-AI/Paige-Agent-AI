-- File shared Portal message activity through the existing Rail writer, once in
-- the original message transaction. Private Cura history and providers untouched.
BEGIN;
DO $portal_message_activity$
DECLARE
 _entry record; _oid oid; _def text; _hash text; _addition text;
 _return text:=E'  RETURN jsonb_build_object(''ok'', true, ''replayed'', false, ''message_id'', _row.id, ''created_at'', _row.created_at);\n';
BEGIN
 FOR _entry IN SELECT * FROM (VALUES
  ('public.client_portal_send_message(text,uuid,text,uuid)','0a0c835abd6fca8973068ea5c2640f83','d30a77a8908d3ddab03fd17b882b6d0b','comms.inbound','client','Message sent'),
  ('public.comms_portal_reply(uuid,uuid,text,uuid)','e59afbaaa5d3f9003c2e26f1403b3729','12123877ad1df9570869815aca0666bc','comms.outbound','owner_staff','Message from your team')
 ) source(signature,before_hash,after_hash,event_kind,actor_type,title) LOOP
  _oid:=_entry.signature::regprocedure;
  SELECT pg_catalog.pg_get_functiondef(oid),pg_catalog.md5(prosrc) INTO _def,_hash FROM pg_catalog.pg_proc WHERE oid=_oid;
  IF _hash=_entry.after_hash THEN CONTINUE; END IF;
  IF _hash IS DISTINCT FROM _entry.before_hash
   OR (length(_def)-length(replace(_def,_return,'')))<>length(_return) THEN
   RAISE EXCEPTION 'Portal message activity source changed (%); reconcile before release',_entry.signature;
  END IF;
  _addition:=pg_catalog.format(E'  PERFORM public.record_rail_event(\n    p_contact_id=>_client.id,p_event_kind=>%L,\n    p_surface=>''client_portal'',p_actor_type=>%L,\n    p_title=>%L,p_ref_table=>''messages'',p_ref_id=>_row.id,\n    p_tenant_id=>_client.tenant_id);\n',_entry.event_kind,_entry.actor_type,_entry.title);
  EXECUTE pg_catalog.replace(_def,_return,_addition||_return);
 END LOOP;
END
$portal_message_activity$;
COMMIT;
