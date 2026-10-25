-- CLI scaffold 20261025160253; adjacent forward-only E09 slot after14210009.
-- A selected CRM focus is not a customer persona. Real owner authority, exact
-- original common approval and all native source/access checks stay mandatory.
BEGIN;
DO $e09_focused_publication$
DECLARE item record; actual text; definition text;
 anchor constant text:='OR proposal.thread_id IS DISTINCT FROM _thread_id OR proposal.scoped_client_id IS NOT NULL';
 replacement constant text:=E'OR proposal.thread_id IS DISTINCT FROM _thread_id\n  OR (proposal.scoped_client_id IS NOT NULL AND proposal.scoped_client_id IS DISTINCT FROM v_contact_id)';
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public._client_portal_access_authorize(uuid,uuid,boolean)','7c3eb55c866321fed052ae742b75e42d'),
  ('public.admin_propose_paige_actions(uuid,jsonb)','21bd99c7a036f28f82a677fa25c6db04'),
  ('public.advance_action(uuid,text,jsonb,text,uuid,uuid,jsonb,text,text,uuid)','0d412f9c0a734aeb2815dca39ab061a3')
 ) source(signature,body) LOOP
  SELECT pg_catalog.md5(prosrc) INTO actual FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(item.signature);
  IF actual IS DISTINCT FROM item.body THEN
   RAISE EXCEPTION 'Original focused-publication dependency changed (%); reconcile before release',item.signature;
  END IF;
 END LOOP;
 SELECT pg_catalog.md5(prosrc),pg_catalog.pg_get_functiondef(oid) INTO actual,definition FROM pg_catalog.pg_proc
  WHERE oid=pg_catalog.to_regprocedure('public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid)');
 IF actual='f011f8a047c8025508ea3ece73efbcee' THEN RETURN; END IF;
 IF actual IS DISTINCT FROM '81e21f92abe3d552f89d98c8d7b3b9d3'
  OR (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,anchor,'')))/pg_catalog.length(anchor)<>1 THEN
  RAISE EXCEPTION 'Original focused-publication source changed; preserve before release';
 END IF;
 -- Same function/OID/ABI/owner/ACL. Current actual owner + Work standing are
 -- checked independently; only NULL or the exact approved CRM focus is valid.
 -- Root must still claim its real thread/focus in the common gate; no clearing
 -- client context or caller/model approval field is introduced here.
 EXECUTE pg_catalog.replace(definition,anchor,replacement);
END $e09_focused_publication$;
NOTIFY pgrst,'reload schema';
COMMIT;
