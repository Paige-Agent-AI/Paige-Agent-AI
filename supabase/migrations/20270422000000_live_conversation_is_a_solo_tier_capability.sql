-- INT-104: Live Conversation is a SOLO TIER capability, and the rollout names nobody.
--
-- WHY THIS EXISTS. 20270420000000 moved admission out of the product's identity model and into a
-- configuration allowlist. It did not go far enough. The only production writer of that allowlist is
-- the owner-gated `authorize-live-pilot` action, which admits THE AUTHENTICATED OPERATOR THEMSELVES,
-- and `is_platform_owner()` is satisfied by exactly one account — so the set of people who could ever
-- be admitted was one login, and the table shipped empty. Measured on production before this change:
-- 0 admitted subjects, 0 enabled workspaces, pilot_enabled false. Zero Solo users could use Live.
-- The restriction had left the identity model and become an operator hand-admission queue, which is
-- the same framing one layer down.
--
-- WHAT CHANGES. Eligibility becomes a question about the TENANT'S TIER, which every Solo account
-- satisfies by construction the moment it is provisioned (assert_canonical_solo_tenant guarantees
-- account_type 'standalone' and a null parent). Who may speak today becomes ONE SETTING —
-- paige_voice_readiness.pilot_rollout_scope — that names no person, no login and no workspace.
-- Opening the audience is an UPDATE of that value. Nothing about the product changes.
--
-- THE TRAP THIS DELIBERATELY AVOIDS. Requiring a paige_live_tenant_availability row as a
-- PRECONDITION would mean every newly signed-up Solo account waits for an operator to hand-enable
-- it — the same gate wearing a third disguise, and the reason a brand-new account would otherwise
-- get a half-working product. So a missing row now means "follow the scope", not "refused". The row
-- keeps its other two meanings, and both are preserved (§58): enabled = true still admits a
-- workspace outright, which is the existing operator path; enabled = false is a per-workspace
-- kill-switch that overrides the scope.
--
-- SHIPS BEHAVIOURALLY IDENTICAL. The scope defaults to 'off', and with 'off' this predicate refuses
-- exactly who it refused before — proven by the suite, whose existing negatives are unchanged. The
-- provider gate is untouched: ElevenLabs retention is unresolved, verified zero retention stays
-- UNAVAILABLE, and physical speaker identity is still unenforced (#1417). Building the capability
-- for every Solo account is not authorizing anyone's audio; those are two decisions and this is only
-- the first.
--
-- CONSENT IS STILL THE SUBJECT'S OWN, AND NOW THEY CAN GIVE IT THEMSELVES. paige_live_accept_terms()
-- takes NO identity argument: it reads auth.uid() and the caller's own canonical workspace, so no
-- account identifier is ever passed, typed or stored by hand, and the CHECK that makes inherited
-- consent unrepresentable still holds. An operator cannot accept for anybody.
--
-- Signatures of the two existing functions are preserved, so the three ADMISSION consumers
-- (paige-live-session, paige-live-relay, paige-ai-chat) are byte-for-byte unchanged and do not
-- redeploy; the 89 Live transport, boundary and client tests pass unmodified, which is the
-- evidence rather than the claim.
-- paige-voice-profile-admin DOES redeploy, and deliberately: a setting only the author can turn
-- with raw SQL is not a setting the owner has. It gains ONE additive action, set-live-rollout-scope,
-- behind the platform-owner gate that was already there; its 28 handler tests also pass unmodified.
-- Forward-only. Rollback: set the scope back to 'off', which also withdraws everyone it admitted.

BEGIN;

-- ---------------------------------------------------------------------------
-- The one setting. It names a TIER, never a person.
-- ---------------------------------------------------------------------------
ALTER TABLE public.paige_voice_readiness
  ADD COLUMN IF NOT EXISTS pilot_rollout_scope text NOT NULL DEFAULT 'off';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paige_live_rollout_scope_valid') THEN
    ALTER TABLE public.paige_voice_readiness
      ADD CONSTRAINT paige_live_rollout_scope_valid
        CHECK (pilot_rollout_scope IN ('off', 'solo_tier'));
  END IF;
END $$;

COMMENT ON COLUMN public.paige_voice_readiness.pilot_rollout_scope IS
  'Who may use Live today, as a TIER not a roster: off = nobody; solo_tier = every Solo-class tenant, each subject still giving their own acceptance. Opening the audience is an UPDATE of this value and nothing else. It cannot name a person, a login or a workspace by construction.';

-- ---------------------------------------------------------------------------
-- Tier eligibility, derived — never written per account, so a Solo tenant is eligible the
-- moment it is provisioned and nobody has to remember to add it anywhere.
--
-- ITS TYPESCRIPT COUNTERPART IS SOLO_FEATURES, NOT resolveTierKey. The question this answers is
-- "does this tenant's tier carry live_conversation", and the one home for that answer is
-- getTierFeatureSet (src/lib/tier/tierFeatures.ts). getTierFeatureSet is frontend-only and not
-- server-importable, so a server twin is the established pattern here (trg_agreement_tier,
-- 20270405000000) rather than a fork — but a twin that drifts is worse than no twin, so the two
-- sets are stated to be identical and a test in tierFeatures.test.ts pins them:
--
--   allowed  = Solo (top-level 'standalone'), Enterprise, and a tenant whose account_type has not
--              settled yet — which resolveTierKey fail-safes to solo, and which is the honest
--              reading of a brand-new account that was created seconds ago.
--   refused  = Agency (no direct book to speak about) and Sub-account (release DEFERRED under the
--              standing owner ruling of 2026-09-06, the same ruling that governs trust_compass).
--
-- ENTERPRISE IS INCLUDED DELIBERATELY, and the first draft of this predicate had it wrong. §60
-- builds Enterprise as a strict superset of the Solo baseline "so it can never silently fall below
-- it", and SOLO_FEATURES is spread into ENTERPRISE_FEATURES, so excluding it here would have made
-- the UI offer a control the database then refused. Production carries 0 enterprise tenants
-- (queried 2026-09-24) and Enterprise renders the agency shell, so nothing observable changed —
-- which is exactly why the disagreement would have sat there unnoticed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.live_conversation_tier_allows(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT t.parent_tenant_id IS NULL
       AND coalesce(t.account_type, 'standalone') NOT IN ('agency', 'sub_account')
      FROM public.tenants t
     WHERE t.id = _tenant_id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.live_conversation_tier_allows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_conversation_tier_allows(uuid) TO service_role;

COMMENT ON FUNCTION public.live_conversation_tier_allows(uuid) IS
  'Does this tenant''s tier carry the Solo feature baseline (Solo, Enterprise which inherits it, or a tenant whose account_type has not settled)? The server twin of SOLO_FEATURES in src/lib/tier/tierFeatures.ts. Derived from tier and never stored per account, so every newly provisioned Solo tenant is eligible with no operator action. Eligibility is not permission: the rollout scope and the subject''s own acceptance still decide who may speak.';

-- ---------------------------------------------------------------------------
-- Admission. Same signature; the tier question is now part of it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.paige_live_pilot_authorized_internal(_actor_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _actor_user_id IS NULL OR _tenant_id IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    -- The subject's own acceptance. Unchanged.
    FROM public.paige_live_pilot_subjects s
    -- The rollout envelope: the provider was inspected and default retention accepted.
    JOIN public.paige_voice_readiness r
      ON r.singleton = true AND r.pilot_enabled = true
    JOIN public.paige_voice_profiles candidate
      ON candidate.slot = 'candidate'
    JOIN public.paige_audit_log inspection
      ON inspection.id = r.pilot_inspection_id
    WHERE s.user_id = _actor_user_id
      AND s.tenant_id = _tenant_id
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND s.accepted_default_provider_retention = true
      AND s.accepted_procedural_single_speaker = true
      AND public.is_platform_owner(s.admitted_by)
      -- WHO MAY SPEAK TODAY. Either this workspace was switched on outright (the existing
      -- operator path, preserved), or the rollout scope admits its tier and nobody switched
      -- that workspace off. A MISSING row is not a refusal — it means "follow the scope",
      -- which is what lets a brand-new Solo account work without anyone enabling it.
      AND (
        EXISTS (
          SELECT 1 FROM public.paige_live_tenant_availability a
           WHERE a.tenant_id = _tenant_id AND a.enabled = true
        )
        OR (
          r.pilot_rollout_scope = 'solo_tier'
          AND public.live_conversation_tier_allows(_tenant_id)
          AND NOT EXISTS (
            SELECT 1 FROM public.paige_live_tenant_availability a
             WHERE a.tenant_id = _tenant_id AND a.enabled = false
          )
        )
      )
      AND public.is_platform_owner(r.pilot_authorized_by)
      AND r.pilot_authorized_at IS NOT NULL
      AND r.pilot_authorized_at <= now() + interval '1 minute'
      AND r.pilot_authorization_source = 'owner_authorization'
      AND nullif(btrim(r.pilot_evidence_ref), '') IS NOT NULL
      AND r.pilot_retention_state = 'default_provider_retention'
      AND r.pilot_zero_retention_state = 'UNAVAILABLE'
      AND r.pilot_single_speaker_accepted = true
      AND r.pilot_speaker_identity_enforced = false
      AND candidate.provider = 'elevenlabs'
      AND candidate.revision = 'elevenlabs-jessica-take5-r1'
      AND candidate.provider_voice_ref = 'g6xIsTj2HwM6VR4iXFCw'
      AND candidate.speech_policy->>'spoken_register' = 'take-5'
      AND candidate.approved = false AND candidate.active = false
      AND inspection.actor_user_id = r.pilot_authorized_by
      AND inspection.actor_role = 'super_admin'
      AND inspection.action = 'platform.paige_voice_profile.inspect'
      AND inspection.target_type = 'paige_voice_profiles'
      AND inspection.payload->>'phase' = 'inspection_completed'
      AND inspection.payload->>'profile_revision' = candidate.revision
      AND inspection.payload #>> '{inspection,code}' = 'metadata_only'
      AND inspection.payload #>> '{inspection,subscription,transport}' = 'ok'
      AND inspection.payload #>> '{inspection,voice,transport}' = 'ok'
      AND inspection.payload #>> '{inspection,voice,accessible}' = 'true'
      AND inspection.payload #>> '{inspection,voice,referenceMatches}' = 'true'
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Self-service acceptance. NO identity argument, by design.
--
-- The subject is auth.uid() and their workspace is the canonical resolver's answer, so nothing
-- about who is accepting can be supplied by the caller, typed by an operator, or read from a
-- stored account identifier. An operator calling this accepts for THEMSELVES and nobody else.
-- It refuses unless the rollout would admit this caller, so while the scope is 'off' it writes
-- nothing at all — acceptance cannot be stockpiled ahead of a decision that has not been made.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.paige_live_accept_terms()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _tenant uuid;
  _authorizer uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'PAIGE_LIVE_NOT_AUTHENTICATED' USING ERRCODE = '28000';
  END IF;
  -- The caller's OWN workspace, through the one canonical resolver. Never a parameter.
  _tenant := public.current_user_tenant_id();
  IF _tenant IS NULL THEN
    -- A signed-in person with no resolvable workspace is REFUSED, not thrown at. This is a
    -- user-facing RPC: an exception here would surface to a Solo user as a broken screen, when the
    -- truthful answer is simply that Live is not available to them. The one case that still raises
    -- is an unauthenticated caller, which cannot reach this function at all.
    RETURN jsonb_build_object('accepted', false, 'code', 'live_audio_not_enabled');
  END IF;

  -- ACT-AS IS NOT MEMBERSHIP, and this is the one line that says so. current_user_tenant_id()
  -- deliberately honours profiles.active_tenant_id for a platform_admin with no membership at all
  -- (20260714144656:17-31, the `OR public.is_platform_admin(auth.uid())` branch), which is correct
  -- for READING a tenant's data under §51 Tier 1 and wrong for admitting yourself to its live
  -- audio. Without this check a delegated platform_admin could point active_tenant_id at any
  -- customer's Solo account and self-admit — a door §53 freezes is_platform_owner() specifically to
  -- keep shut, reopened one layer down. Live is speaking about YOUR OWN book, so real membership is
  -- the requirement; an operator who needs it on their own workspace has one there.
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members m
     WHERE m.user_id = _uid AND m.tenant_id = _tenant AND m.status = 'active'
  ) THEN
    RETURN jsonb_build_object('accepted', false, 'code', 'live_audio_not_enabled');
  END IF;

  -- EVERY ACTIVE MEMBER OF A SOLO ACCOUNT IS ELIGIBLE, NOT ONLY ITS OWNER, and that is deliberate
  -- rather than an oversight. The owner asked for this for "all of my users"; restricting it to the
  -- one account that happens to own the tenant row would rebuild the single-account shape this work
  -- exists to remove. Live is a MODALITY over the book a member can already reach in chat, not new
  -- access to it, and the relay independently re-checks active standing on every renewal.

  SELECT r.pilot_authorized_by INTO _authorizer
    FROM public.paige_voice_readiness r
   WHERE r.singleton = true AND r.pilot_enabled = true
     AND (
       EXISTS (SELECT 1 FROM public.paige_live_tenant_availability a
                WHERE a.tenant_id = _tenant AND a.enabled = true)
       OR (
         r.pilot_rollout_scope = 'solo_tier'
         AND public.live_conversation_tier_allows(_tenant)
         AND NOT EXISTS (SELECT 1 FROM public.paige_live_tenant_availability a
                          WHERE a.tenant_id = _tenant AND a.enabled = false)
       )
     );

  IF _authorizer IS NULL OR public.is_platform_owner(_authorizer) IS DISTINCT FROM true THEN
    -- Honest refusal: Live is not open to this caller, so no acceptance is recorded.
    RETURN jsonb_build_object('accepted', false, 'code', 'live_audio_not_enabled');
  END IF;

  -- Already accepted and still live? Say so and write nothing. Without this the call is a loop that
  -- any authenticated member can run to append unbounded rows to the platform-wide audit log, and
  -- re-opening the surface would silently restart everyone's clock.
  IF EXISTS (
    SELECT 1 FROM public.paige_live_pilot_subjects s
     WHERE s.user_id = _uid AND s.tenant_id = _tenant
       AND s.revoked_at IS NULL AND s.expires_at > now()
       AND s.accepted_default_provider_retention AND s.accepted_procedural_single_speaker
  ) THEN
    RETURN jsonb_build_object('accepted', true, 'unchanged', true,
      'retention_state', 'default_provider_retention',
      'zero_retention_state', 'UNAVAILABLE');
  END IF;

  INSERT INTO public.paige_live_pilot_subjects(
      user_id, tenant_id, admitted_by, admitted_at, revoked_at, expires_at,
      accepted_default_provider_retention, accepted_procedural_single_speaker,
      acceptance_actor_user_id, updated_at)
    VALUES (_uid, _tenant, _authorizer, now(), NULL, now() + interval '14 days',
            true, true, _uid, now())
    ON CONFLICT (user_id, tenant_id) DO UPDATE
      SET admitted_by = EXCLUDED.admitted_by, admitted_at = now(), revoked_at = NULL,
          expires_at = EXCLUDED.expires_at,
          accepted_default_provider_retention = true, accepted_procedural_single_speaker = true,
          acceptance_actor_user_id = EXCLUDED.acceptance_actor_user_id, updated_at = now();

  INSERT INTO public.paige_audit_log(actor_user_id, actor_role, action, target_type, tenant_id, payload)
    VALUES (_uid, 'authenticated', 'paige_live.accept_terms', 'paige_live_pilot_subjects', _tenant,
      jsonb_build_object('retention_state', 'default_provider_retention',
                         'zero_retention_state', 'UNAVAILABLE',
                         'single_speaker_acceptance', 'procedural_only'));

  RETURN jsonb_build_object('accepted', true,
    'retention_state', 'default_provider_retention',
    'zero_retention_state', 'UNAVAILABLE');
END;
$$;

REVOKE ALL ON FUNCTION public.paige_live_accept_terms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paige_live_accept_terms() TO authenticated, service_role;

COMMENT ON FUNCTION public.paige_live_accept_terms() IS
  'A Solo user accepts Live''s terms for THEMSELVES. Takes no identity argument: the subject is auth.uid() and the workspace is current_user_tenant_id(), so no account identifier is ever supplied. Refuses while the rollout scope excludes the caller, so acceptance cannot be recorded ahead of the decision.';

-- ---------------------------------------------------------------------------
-- The operator sets the scope. This is the whole "when the gate opens, you change a setting".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_paige_live_rollout_scope_internal(_actor_user_id uuid, _scope text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _withdrawn integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR _actor_user_id IS NULL
     OR public.is_platform_owner(_actor_user_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _scope IS NULL OR _scope NOT IN ('off', 'solo_tier') THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;

  UPDATE public.paige_voice_readiness
     SET pilot_rollout_scope = _scope, updated_by = _actor_user_id, updated_at = now()
   WHERE singleton = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAIGE_LIVE_PILOT_READINESS_MISSING' USING ERRCODE = '55000'; END IF;

  -- Narrowing the audience withdraws everyone THE SCOPE was carrying, so a later re-open cannot
  -- revive an acceptance given under a scope that has since been closed.
  --
  -- The NOT EXISTS is the whole correctness of this block, and its first draft did not have it.
  -- Without it this withdraws every unrevoked subject in the table, including the ones admitted by
  -- the per-workspace `enabled = true` operator path that the scope has nothing to do with — so the
  -- rollback documented at the top of this file would have revoked the operator's own admission,
  -- the only row that exists on production today, and recovering it needs a fresh inspection
  -- receipt because the old one is more than five minutes old (20270420000000's proof window).
  -- A lever must not destroy what it did not create.
  IF _scope = 'off' THEN
    WITH withdrawn AS (
      UPDATE public.paige_live_pilot_subjects s SET revoked_at = now(), updated_at = now()
       WHERE s.revoked_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.paige_live_tenant_availability a
            WHERE a.tenant_id = s.tenant_id AND a.enabled = true
         )
       RETURNING 1
    ) SELECT count(*)::integer INTO _withdrawn FROM withdrawn;
  END IF;

  INSERT INTO public.paige_audit_log(actor_user_id, actor_role, action, target_type, payload)
    VALUES (_actor_user_id, 'super_admin', 'platform.paige_live_pilot.set_scope',
      'paige_voice_readiness',
      jsonb_build_object('scope', _scope, 'subjects_withdrawn', _withdrawn));
  RETURN jsonb_build_object('scope', _scope, 'subjects_withdrawn', _withdrawn);
END;
$$;

REVOKE ALL ON FUNCTION public.set_paige_live_rollout_scope_internal(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_paige_live_rollout_scope_internal(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- The global disable must also CLOSE the audience. Two switches that compose in one direction and
-- not the other are a trap: without this, disabling leaves pilot_rollout_scope at 'solo_tier', and
-- the next authorize-live-pilot silently re-opens Live to every Solo account with no fresh decision
-- about the audience. Whoever re-enables should have to say who it is for, again.
--
-- Only the disable branch changes; the authorize branch, its proof window and every readiness field
-- are preserved verbatim from 20270420000000, and the signature is identical, so the one caller
-- (paige-voice-profile-admin) is unaffected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_paige_live_pilot_internal(
  _actor_user_id uuid, _tenant_id uuid, _enabled boolean,
  _evidence_ref text, _inspection_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _inspection public.paige_audit_log%ROWTYPE;
  _candidate public.paige_voice_profiles%ROWTYPE;
  _revoked integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' OR _actor_user_id IS NULL
     OR public.is_platform_owner(_actor_user_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF _enabled IS NULL THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_INVALID_REQUEST' USING ERRCODE = '22023';
  END IF;

  IF NOT _enabled THEN
    -- Preserve the proof history and all legacy readiness/profile fields. The scope closes with it.
    UPDATE public.paige_voice_readiness
       SET pilot_enabled = false, pilot_rollout_scope = 'off',
           updated_by = _actor_user_id, updated_at = now()
     WHERE singleton = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAIGE_LIVE_PILOT_READINESS_MISSING' USING ERRCODE = '55000'; END IF;
    -- Disable means nobody is admitted, not merely that the envelope is off. Withdraw every
    -- subject so a later re-enable cannot revive a stale acceptance as fresh authorization.
    -- Unlike closing the SCOPE, this one is deliberately unfiltered: the global disable is the
    -- stop-everything lever, and it is the operator's own act.
    WITH withdrawn AS (
      UPDATE public.paige_live_pilot_subjects
         SET revoked_at = now(), updated_at = now()
       WHERE revoked_at IS NULL
       RETURNING 1
    ) SELECT count(*)::integer INTO _revoked FROM withdrawn;
    INSERT INTO public.paige_audit_log(actor_user_id, actor_role, action, target_type, payload)
      VALUES (_actor_user_id, 'super_admin', 'platform.paige_live_pilot.disable',
        'paige_voice_readiness',
        jsonb_build_object('enabled', false, 'subjects_withdrawn', _revoked, 'scope', 'off'));
    RETURN jsonb_build_object('enabled', false, 'scope', 'off');
  END IF;

  IF _tenant_id IS NULL OR nullif(btrim(_evidence_ref), '') IS NULL
     OR _inspection_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.tenants WHERE id = _tenant_id
     ) THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_PROOF_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _candidate FROM public.paige_voice_profiles WHERE slot = 'candidate';
  SELECT * INTO _inspection FROM public.paige_audit_log
    WHERE id = _inspection_id FOR SHARE;
  IF _candidate.slot IS NULL OR _candidate.provider <> 'elevenlabs'
     OR _candidate.revision <> 'elevenlabs-jessica-take5-r1'
     OR _candidate.provider_voice_ref <> 'g6xIsTj2HwM6VR4iXFCw'
     OR _candidate.speech_policy->>'spoken_register' IS DISTINCT FROM 'take-5'
     OR _candidate.approved OR _candidate.active
     OR _inspection.id IS NULL
     OR _inspection.actor_user_id IS DISTINCT FROM _actor_user_id
     OR _inspection.actor_role IS DISTINCT FROM 'super_admin'
     OR _inspection.action IS DISTINCT FROM 'platform.paige_voice_profile.inspect'
     OR _inspection.target_type IS DISTINCT FROM 'paige_voice_profiles'
     OR _inspection.created_at < now() - interval '5 minutes'
     OR _inspection.created_at > now() + interval '1 minute'
     OR _inspection.payload->>'phase' IS DISTINCT FROM 'inspection_completed'
     OR _inspection.payload->>'profile_revision' IS DISTINCT FROM _candidate.revision
     OR _inspection.payload #>> '{inspection,code}' IS DISTINCT FROM 'metadata_only'
     OR _inspection.payload #>> '{inspection,subscription,transport}' IS DISTINCT FROM 'ok'
     OR _inspection.payload #>> '{inspection,voice,transport}' IS DISTINCT FROM 'ok'
     OR _inspection.payload #>> '{inspection,voice,accessible}' IS DISTINCT FROM 'true'
     OR _inspection.payload #>> '{inspection,voice,referenceMatches}' IS DISTINCT FROM 'true'
  THEN
    RAISE EXCEPTION 'PAIGE_LIVE_PILOT_PROOF_REQUIRED' USING ERRCODE = '22023';
  END IF;

  UPDATE public.paige_voice_readiness
     SET pilot_enabled = true,
         pilot_actor_user_id = _actor_user_id,
         pilot_tenant_id = _tenant_id,
         pilot_authorized_at = now(),
         pilot_authorized_by = _actor_user_id,
         pilot_authorization_source = 'owner_authorization',
         pilot_evidence_ref = btrim(_evidence_ref),
         pilot_retention_state = 'default_provider_retention',
         pilot_zero_retention_state = 'UNAVAILABLE',
         pilot_single_speaker_accepted = true,
         pilot_speaker_identity_enforced = false,
         pilot_inspection_id = _inspection_id,
         updated_by = _actor_user_id, updated_at = now()
   WHERE singleton = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAIGE_LIVE_PILOT_READINESS_MISSING' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.paige_live_tenant_availability(tenant_id, enabled, updated_at)
    VALUES (_tenant_id, true, now())
    ON CONFLICT (tenant_id) DO UPDATE SET enabled = true, updated_at = now();
  -- Admit the authenticated actor as a rollout subject. The acceptance is recorded as their own,
  -- which is what the CHECK requires; an operator cannot accept on a third party's behalf.
  INSERT INTO public.paige_live_pilot_subjects(
      user_id, tenant_id, admitted_by, admitted_at, revoked_at, expires_at,
      accepted_default_provider_retention, accepted_procedural_single_speaker,
      acceptance_actor_user_id, updated_at)
    VALUES (_actor_user_id, _tenant_id, _actor_user_id, now(), NULL,
      now() + interval '14 days', true, true, _actor_user_id, now())
    ON CONFLICT (user_id, tenant_id) DO UPDATE
      SET admitted_by = EXCLUDED.admitted_by, admitted_at = now(), revoked_at = NULL,
          expires_at = EXCLUDED.expires_at,
          accepted_default_provider_retention = true, accepted_procedural_single_speaker = true,
          acceptance_actor_user_id = EXCLUDED.acceptance_actor_user_id, updated_at = now();
  INSERT INTO public.paige_audit_log(actor_user_id, actor_role, action, target_type, tenant_id, payload)
    VALUES (_actor_user_id, 'super_admin', 'platform.paige_live_pilot.authorize',
      'paige_voice_readiness', _tenant_id,
      jsonb_build_object('enabled', true, 'inspection_id', _inspection_id,
        'admitted_subject_user_id', _actor_user_id,
        'retention_state', 'default_provider_retention',
        'zero_retention_state', 'UNAVAILABLE',
        'single_speaker_acceptance', 'procedural_only'));
  RETURN jsonb_build_object('enabled', true,
    'retention_state', 'default_provider_retention',
    'zero_retention_state', 'UNAVAILABLE');
END;
$$;

COMMIT;
