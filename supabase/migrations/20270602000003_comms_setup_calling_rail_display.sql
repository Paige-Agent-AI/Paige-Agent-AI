-- INT-345 K-3 — Rail display for the governed calling-setup act.
--
-- Extension pattern (mirrors 20270595000000): rename the previous display definer
-- private, delegate to it, and layer exactly the comms_setup_calling sentences on
-- top. The refused outcome keeps the "nothing changed" truthfulness of the comms
-- display family: a refused setup attempted nothing external.

DO $$ BEGIN
 IF to_regprocedure('public._workspace_event_display_before_calling_setup(text,text,text)') IS NULL THEN
  ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_calling_setup;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display_before_calling_setup(text,text,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public._workspace_event_display_before_calling_setup(_source_kind,_outcome,_capability);
 IF _source_kind='capability_run' AND _capability='comms_setup_calling' AND _outcome IN ('capability_succeeded','capability_refused') THEN
  result:=result||jsonb_build_object('title',CASE WHEN _outcome='capability_succeeded' THEN 'Connected this workspace''s calling account' ELSE 'Calling setup was not completed' END,
   'summary',CASE WHEN _outcome='capability_succeeded' THEN 'The calling account is connected. Calling turns on once a number is bought and chosen with "Send from this".' ELSE 'Nothing was changed. The exact step is on the record if it failed; a refusal means a rule said no.' END);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;
