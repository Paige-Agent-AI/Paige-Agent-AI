-- Existing owner-only read contract: an absent stored cutoff is a genuine null.
-- Make that fact explicit without changing records, authority or future execution.
-- Actual parent14130009; reserved before14140004/14150009/14160004.
BEGIN;
SET LOCAL lock_timeout='3s';

DO $projection$
DECLARE
  _oid oid := 'public.get_weekly_commitment_checks()'::regprocedure;
  _source text; _definition text; _metadata jsonb; _after jsonb;
  _old text := $old$'schedule',a.trigger_config,$old$;
  _new text := $new$'schedule',a.trigger_config || jsonb_build_object('future_control_at',a.trigger_config->'future_control_at'),$new$;
BEGIN
  SELECT p.prosrc,pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
    INTO STRICT _source,_definition,_metadata FROM pg_proc p WHERE p.oid=_oid;
  -- Replay is inert. Unknown source must be reconciled, never overwritten.
  IF md5(_source)='60d5acc132111d9db7e63d9848c06c47' THEN RETURN; END IF;
  IF md5(_source)<>'99218816ce1b8111e80360b1bd9aa189'
    OR (length(_source)-length(replace(_source,_old,'')))<>length(_old) THEN
    RAISE EXCEPTION 'WEEKLY_CONTROL_PROJECTION_SOURCE_CHANGED';
  END IF;
  EXECUTE replace(_definition,_old,_new);
  SELECT to_jsonb(p)-'prosrc' INTO STRICT _after FROM pg_proc p WHERE p.oid=_oid;
  IF _after IS DISTINCT FROM _metadata OR
    (SELECT md5(prosrc) FROM pg_proc WHERE oid=_oid)<>'60d5acc132111d9db7e63d9848c06c47' THEN
    RAISE EXCEPTION 'WEEKLY_CONTROL_PROJECTION_CONTRACT_CHANGED';
  END IF;
END $projection$;

COMMIT;
