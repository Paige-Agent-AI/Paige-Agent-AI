BEGIN;
-- Generated locally by `supabase migration new e2_native_target_attribution`,
-- then moved above the latest canonical target version. No applied file changed.
-- Native owner target controls reuse record_capability_run. Its existing display
-- wrapper chain must credit the person, without altering E04 or other outcomes.
DO $$ BEGIN
  IF to_regprocedure('public._workspace_event_display_before_e02_targets(text,text,text)') IS NULL THEN
    ALTER FUNCTION public._workspace_event_display(text,text,text) RENAME TO _workspace_event_display_before_e02_targets;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display_before_e02_targets(text,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._workspace_event_display(_source_kind text,_outcome text,_capability text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
  result:=public._workspace_event_display_before_e02_targets(_source_kind,_outcome,_capability);
  IF _source_kind='capability_run' AND _capability IN ('owner_mission_target_save','owner_mission_target_transition') THEN
    result:=result||jsonb_build_object('actor_type','owner_staff',
      'title',CASE WHEN _outcome<>'capability_succeeded' THEN 'Target change needs verification'
        WHEN _capability='owner_mission_target_save' THEN 'Play target saved' ELSE 'Play target state changed' END,
      'summary',CASE WHEN _outcome='capability_succeeded'
        THEN 'The business owner changed a target on a Strategic Play. The saved revision and receipt were verified; business performance is measured separately.'
        ELSE 'This target change is not confirmed. Check its original request before starting another change.' END);
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public._workspace_event_display(text,text,text) FROM PUBLIC,anon,authenticated;
COMMENT ON FUNCTION public._workspace_event_display(text,text,text) IS
  'Existing Rail display chain. E02 native-only owner_mission_target_save/transition credit owner_staff after exact target and receipt verification. Every other family/key/outcome delegates unchanged, including E04 time-zone attribution. No receipt history is rewritten.';
COMMIT;
