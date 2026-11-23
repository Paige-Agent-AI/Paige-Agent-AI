-- Forward-only successor to the verified 49 frontier. The existing Studio
-- session create door enrolls new projects. Chat remains the conversation writer.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '45s';

ALTER TABLE public.studio_sessions
  ADD COLUMN plan_first boolean NOT NULL DEFAULT false;

-- Recover a project created during web/Edge/schema overlap. The one-element
-- startup argument is consumed, and existing transcripts remain untouched.
UPDATE public.studio_sessions
SET plan_first = true, transcript = '[]'::jsonb
WHERE transcript = '[{"role":"system","content":"","studio_workflow_version":"plan_first_v1"}]'::jsonb;

CREATE FUNCTION public.studio_session_plan_enrollment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.plan_first := OLD.plan_first;
  ELSE
    NEW.plan_first := COALESCE(
      NEW.transcript = '[{"role":"system","content":"","studio_workflow_version":"plan_first_v1"}]'::jsonb, false);
    IF NEW.plan_first THEN
      NEW.transcript := '[]'::jsonb;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.studio_session_plan_enrollment() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER studio_session_plan_enrollment
BEFORE INSERT OR UPDATE OF plan_first ON public.studio_sessions
FOR EACH ROW EXECUTE FUNCTION public.studio_session_plan_enrollment();

COMMENT ON COLUMN public.studio_sessions.plan_first IS
  'Creation-time Studio entry flow. Approval and conversation use the original native chat thread.';

COMMIT;
