-- EXP07 guest admission — the tenant's OUTSIDE guests (no PAIGE login) join a live room
-- through ONE capability link per session: a 256-bit random guest token minted at open,
-- carried in the host's share link, validated atomically against the live row, and DEAD
-- the moment the session ends (the row is the capability's whole authority — ended is
-- terminal, so the link cannot outlive the room it admits to). The token is stored raw on
-- purpose: it is capability-link material (the same trust class as the provider's own
-- participant passes), service-role-only under RLS-with-zero-policies, and the link must
-- survive a host's page refresh — a hash could validate but never re-serve. Guests share
-- the same 8-seat interactive cap and metering as members; admission alone is all this
-- grants (no tenant data beyond the room's own title crosses to a guest).
BEGIN;

ALTER TABLE public.tenant_broadcast_sessions ADD COLUMN guest_token text;

COMMENT ON COLUMN public.tenant_broadcast_sessions.guest_token IS
  'The guest capability link token for this session — minted at open, validated by the guest-join RPC, dead when the row leaves live. Raw on purpose: the host link must be re-servable after refresh; service-role only.';

-- open gains the guest token (DEFAULT NULL keeps older callers shape-compatible).
CREATE OR REPLACE FUNCTION public.tenant_broadcast_session_open(
  p_tenant_id uuid, p_title text, p_meeting_id text, p_host_participant_id text, p_created_by uuid,
  p_guest_token text DEFAULT NULL
) RETURNS public.tenant_broadcast_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r public.tenant_broadcast_sessions;
BEGIN
  INSERT INTO public.tenant_broadcast_sessions (tenant_id, title, meeting_id, host_participant_id, created_by, guest_token)
  VALUES (p_tenant_id, p_title, p_meeting_id, p_host_participant_id, p_created_by, p_guest_token)
  RETURNING * INTO r;
  RETURN r;
EXCEPTION WHEN unique_violation THEN
  RETURN NULL;  -- a live session already exists — the door refuses honestly, never overwrites
END $fn$;
REVOKE ALL ON FUNCTION public.tenant_broadcast_session_open(uuid, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_broadcast_session_open(uuid, text, text, text, uuid, text) TO service_role;

-- An outside guest's seat: the token IS the authority. Atomic — match the session by id +
-- exact token + live, take the seat under the same cap members share. A wrong token, an
-- ended session, or a missing row all return NULL (the door says the same honest sentence
-- for each: this link isn't live); AT CAP raises BROADCAST_ROOM_FULL exactly like members.
CREATE OR REPLACE FUNCTION public.tenant_broadcast_session_guest_join(
  p_session_id uuid, p_guest_token text
) RETURNS public.tenant_broadcast_sessions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r public.tenant_broadcast_sessions;
BEGIN
  SELECT * INTO r FROM public.tenant_broadcast_sessions
  WHERE id = p_session_id AND guest_token = p_guest_token AND status = 'live'
  FOR UPDATE;
  IF r.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF r.participant_count >= 8 THEN
    RAISE EXCEPTION 'BROADCAST_ROOM_FULL: the room is at its interactive cap' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.tenant_broadcast_sessions
  SET participant_count = participant_count + 1
  WHERE id = r.id
  RETURNING * INTO r;
  RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.tenant_broadcast_session_guest_join(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_broadcast_session_guest_join(uuid, text) TO service_role;

COMMIT;
