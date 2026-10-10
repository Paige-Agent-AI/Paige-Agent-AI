-- INT-280 AI-1B: bounded observational history IN the existing canonical work envelope.
-- No task store, executor, authority, scheduler, raw payload or new receipt stream.
-- Legacy rows remain null until observed; no invented historical transitions.
ALTER TABLE public.paige_durable_work ADD COLUMN IF NOT EXISTS trajectory_history jsonb;
COMMENT ON COLUMN public.paige_durable_work.trajectory_history IS
  'INT-280 v1 server-maintained bounded state/attempt observations; references the existing work identity. Legacy or truncated histories are explicitly incomplete. No raw content or authority.';

CREATE OR REPLACE FUNCTION public._capture_paige_trajectory_history()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE h jsonb; events jsonb; entry jsonb; meaningful boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.trajectory_history IS NOT NULL THEN
      RAISE EXCEPTION 'trajectory_history_server_only' USING ERRCODE = '22023';
    END IF;
    h := jsonb_build_object('version', 1, 'complete', true, 'truncated', false, 'events', '[]'::jsonb);
    meaningful := true;
  ELSE
    IF NEW.trajectory_history IS DISTINCT FROM OLD.trajectory_history THEN
      RAISE EXCEPTION 'trajectory_history_immutable' USING ERRCODE = '22023';
    END IF;
    h := COALESCE(OLD.trajectory_history, jsonb_build_object('version', 1, 'complete', false, 'truncated', false, 'events', '[]'::jsonb));
    meaningful := OLD.trajectory_history IS NULL OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
      OR NEW.dispatch_started_attempt IS DISTINCT FROM OLD.dispatch_started_attempt
      OR NEW.blocked_reason IS DISTINCT FROM OLD.blocked_reason;
  END IF;
  IF NOT meaningful THEN RETURN NEW; END IF;
  entry := jsonb_build_object('at', clock_timestamp(), 'version', NEW.version,
    'state', NEW.status, 'attempt', NEW.attempt_count,
    'dispatch_attempt', NEW.dispatch_started_attempt,
    'readback_claimed', NEW.terminal_outcome->'verified_readback' = 'true'::jsonb,
    'blocked_code', CASE WHEN NEW.blocked_reason IN ('approval_expired','approval_denied','authority_changed','version_conflict') THEN NEW.blocked_reason ELSE NULL END);
  events := h->'events' || jsonb_build_array(entry);
  IF jsonb_array_length(events) > 128 THEN
    events := events - 0;
    h := h || jsonb_build_object('complete', false, 'truncated', true);
  END IF;
  NEW.trajectory_history := h || jsonb_build_object('events', events);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._capture_paige_trajectory_history() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_paige_trajectory_history ON public.paige_durable_work;
CREATE TRIGGER trg_paige_trajectory_history BEFORE INSERT OR UPDATE ON public.paige_durable_work
  FOR EACH ROW EXECUTE FUNCTION public._capture_paige_trajectory_history();
