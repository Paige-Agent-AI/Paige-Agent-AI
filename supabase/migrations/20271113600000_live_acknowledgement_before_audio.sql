-- EXP01 consent repair (owner directive 2026-10-23): the person receives the
-- provider disclosure and PERSONALLY acknowledges it before microphone or
-- provider audio — while self-service eligibility is preserved exactly as the
-- 2027-09-24 ruling opened it.
--
-- This adds ONE EXISTS predicate to the single admission home. It restores NO
-- part of the removed enablement ceremony: no operator-admitted allowlist (the
-- acknowledgement row is written by paige_live_accept_terms() from the signed-
-- in person themselves), no pilot envelope, no inspection receipts. The
-- disclosure and the acceptance control already live in the Live surface
-- (PaigeLiveConversation §70); until now admission simply never read the
-- acknowledgement, so a tier-eligible first-run start could connect the relay
-- and request the microphone without the disclosure ever rendering.
--
-- Second half: a minimal self-read RPC so the account's CURRENT truth —
-- acknowledged / not_acknowledged / revoked / expired — is derivable from
-- canonical evidence instead of a hard-coded label (review #2611 P2-3).
begin;

create or replace function public.paige_live_pilot_authorized_internal(_actor_user_id uuid, _tenant_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path to public
as $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _actor_user_id IS NULL OR _tenant_id IS NULL THEN RETURN false; END IF;

  RETURN
    -- Real membership, not act-as. See the note above; this is load-bearing.
    EXISTS (
      SELECT 1 FROM public.tenant_members m
       WHERE m.user_id = _actor_user_id AND m.tenant_id = _tenant_id AND m.status = 'active'
    )
    -- The Solo tier baseline. Every active member of a Solo account is eligible, not only its
    -- owner: Live is a modality over the book a member can already reach in chat, not new access
    -- to it, and the relay re-checks active standing on every renewal.
    AND public.live_conversation_tier_allows(_tenant_id)
    -- An explicit operator switch-off still stops one workspace. A missing row is not a refusal.
    AND NOT EXISTS (
      SELECT 1 FROM public.paige_live_tenant_availability a
       WHERE a.tenant_id = _tenant_id AND a.enabled = false
    )
    -- OWNER DIRECTIVE 2026-10-23: the person's OWN acknowledgement is current before
    -- audio. Same self-service row paige_live_accept_terms() writes (the subject's
    -- own acceptance actor; no platform owner stands behind it). Revoked, expired or
    -- partial acceptances do not pass; the relay renews through this predicate, so a
    -- revocation also ends future tickets, not just the first.
    AND EXISTS (
      SELECT 1 FROM public.paige_live_pilot_subjects s
       WHERE s.user_id = _actor_user_id AND s.tenant_id = _tenant_id
         AND s.revoked_at IS NULL AND s.expires_at > now()
         AND s.accepted_default_provider_retention
         AND s.accepted_procedural_single_speaker
    );
END
$function$;

-- Distinguishes "eligible but not yet acknowledged" (the person can act: the
-- disclosure and self-service acceptance are theirs) from "not eligible" (no
-- acceptance can change it), so the Live surface can say which one is true.
-- Same service-role-only surface and in-body caller guard as the admission
-- predicate: it takes arbitrary uuid arguments, so its ONLY access control is
-- the grant plus the guard — both, never one without the other.
create or replace function public.paige_live_acknowledgement_current_internal(_actor_user_id uuid, _tenant_id uuid)
returns boolean
language plpgsql
stable security definer
set search_path to public
as $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.paige_live_pilot_subjects s
     WHERE s.user_id = _actor_user_id AND s.tenant_id = _tenant_id
       AND s.revoked_at IS NULL AND s.expires_at > now()
       AND s.accepted_default_provider_retention
       AND s.accepted_procedural_single_speaker
  );
END
$function$;

revoke all on function public.paige_live_acknowledgement_current_internal(uuid,uuid) from public,anon,authenticated;
grant execute on function public.paige_live_acknowledgement_current_internal(uuid,uuid) to service_role;

-- The account's CURRENT Live acknowledgement state, from the canonical row.
-- Returns only the state and its dates — never the acceptance audit detail.
create or replace function public.paige_live_terms_status()
returns jsonb
language plpgsql
stable security definer
set search_path to public
as $function$
declare
  _uid uuid := auth.uid();
  _tid uuid := public.current_user_tenant_id();
  s public.paige_live_pilot_subjects%rowtype;
begin
  if _uid is null or _tid is null then
    return jsonb_build_object('state', 'unauthenticated');
  end if;
  select * into s from public.paige_live_pilot_subjects
   where user_id = _uid and tenant_id = _tid;
  if not found then
    return jsonb_build_object('state', 'not_acknowledged');
  end if;
  if s.revoked_at is not null then
    return jsonb_build_object('state', 'revoked', 'revokedAt', s.revoked_at);
  end if;
  -- A row whose acceptance flags are not both true is NOT an acknowledgement,
  -- whatever its dates — report the honest not_acknowledged, never a conflated
  -- "expired" (no current writer produces this shape; read truthfully anyway).
  if not (s.accepted_default_provider_retention and s.accepted_procedural_single_speaker) then
    return jsonb_build_object('state', 'not_acknowledged');
  end if;
  if s.expires_at <= now() then
    return jsonb_build_object('state', 'expired');
  end if;
  return jsonb_build_object('state', 'acknowledged', 'acknowledgedAt', s.admitted_at, 'expiresAt', s.expires_at);
end
$function$;

revoke all on function public.paige_live_terms_status() from public,anon,service_role;
grant execute on function public.paige_live_terms_status() to authenticated;

comment on function public.paige_live_pilot_authorized_internal(uuid,uuid) is
  'One home for MAY THIS PERSON SPEAK: active membership + Solo tier + no kill switch + the person''s own current self-service acknowledgement (owner directive 2026-10-23). Service-role only.';
comment on function public.paige_live_acknowledgement_current_internal(uuid,uuid) is
  'Service-role companion: is the person''s Live acknowledgement current? Used only to distinguish eligible-but-unacknowledged from not-eligible refusal copy.';
comment on function public.paige_live_terms_status() is
  'The caller''s own current Live acknowledgement state (acknowledged / not_acknowledged / revoked / expired) with dates only. Presentation truth for the capability row; never proof of audio.';
commit;
