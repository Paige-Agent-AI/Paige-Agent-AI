-- INT-104: Resume is not Retry. Keep the existing scoped control-plane RPC.
-- Additive replacement only; no rows, tables, policies, signatures or new authority.
-- Rollback: restore this function's definition from 20260907155052 and disable
-- Live rollout first: that old definition makes Resume unavailable again.
BEGIN;
CREATE OR REPLACE FUNCTION public.paige_live_session_transition_internal(_actor_user_id uuid,_tenant_id uuid,_thread_id uuid,_context_epoch text,_session_id uuid,_transition text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _session public.paige_live_sessions%ROWTYPE; _next text;
BEGIN
  IF auth.role()<>'service_role' THEN RAISE EXCEPTION 'PAIGE_LIVE_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF _transition NOT IN ('hold','resume','minimize','restore','retry','end') THEN RAISE EXCEPTION 'PAIGE_LIVE_INVALID_TRANSITION' USING ERRCODE='22023'; END IF;
  SELECT * INTO _session FROM public.paige_live_sessions WHERE id=_session_id AND actor_user_id=_actor_user_id FOR UPDATE;
  IF _session.id IS NULL THEN RAISE EXCEPTION 'PAIGE_LIVE_SESSION_NOT_FOUND' USING ERRCODE='42501'; END IF;
  IF _session.tenant_id<>_tenant_id OR _session.thread_id<>_thread_id OR _session.context_epoch<>_context_epoch THEN RAISE EXCEPTION 'PAIGE_LIVE_STALE_CONTEXT' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.paige_chat_threads WHERE id=_thread_id AND tenant_id=_tenant_id AND caller_user_id=_actor_user_id) THEN RAISE EXCEPTION 'PAIGE_LIVE_THREAD_SCOPE_MISMATCH' USING ERRCODE='42501'; END IF;
  IF _session.state='ended' THEN RETURN jsonb_build_object('ok',true,'state','ended'); END IF;
  IF _transition='resume' AND (_session.state<>'held' OR _session.availability<>'LIVE') THEN
    RAISE EXCEPTION 'PAIGE_LIVE_INVALID_TRANSITION' USING ERRCODE='22023';
  END IF;
  _next:=CASE _transition WHEN 'hold' THEN 'held' WHEN 'resume' THEN 'listening' WHEN 'minimize' THEN 'minimized' WHEN 'end' THEN 'ended' ELSE 'unavailable' END;
  UPDATE public.paige_live_sessions SET state=_next,ended_at=CASE WHEN _next='ended' THEN now() ELSE ended_at END,updated_at=now() WHERE id=_session_id;
  RETURN jsonb_build_object('ok',true,'state',_next,'availability',_session.availability);
END; $$;
REVOKE ALL ON FUNCTION public.paige_live_session_transition_internal(uuid,uuid,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.paige_live_session_transition_internal(uuid,uuid,uuid,text,uuid,text) TO service_role;
COMMIT;
