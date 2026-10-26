-- EXP08 team lifecycle: suspend and reinstate, removal by an admin, a per-person Team conversations
-- switch, joining the team channels on arrival, and a read-only departure review.
--
-- OWNER RULINGS (2026-10-26), the authority for this change:
--   1. A read-only departure review is approved: before someone leaves, list what they hold.
--   2. Contractor access IS member access. No new role.
--   3. New teammates join the team channels on arrival. How a spot-job contractor stays out of team
--      communications was delegated to the build: a per-person "Team conversations" switch
--      (tenant_members.team_hub_access), ON by default. OFF keeps member access to their own assigned
--      work and is refused by every Team Hub door.
--   4. A reversible suspend, short of removal, is approved. Owners AND admins suspend and remove.
--
-- AUTHORITY, ONE RULE FOR EVERY ACT HERE (suspend, reinstate, remove, the switch, the review): an owner
-- may act on any admin or member; an admin only on a member; nobody on an owner, and nobody on
-- themselves. Actor and workspace come from the session. `_expected_tenant_id` is refusal-only, exactly
-- as remove_solo_team_member (20261048000000) documents it, and who may ask is settled BEFORE the
-- target is looked up, so a refusal is never a membership oracle.
--
-- WHAT A SUSPENSION IS. tenant_members.status = 'suspended': a held seat, like the operator's
-- 'archived'. Every predicate that grants anything requires status = 'active' (current_user_tenant_id,
-- is_tenant_member/admin/owner, tenant_assignee_qualifies, every Team Hub door, and — after section M —
-- the five RLS policies that used to accept any seat), so a suspended person reaches nothing. It is
-- lifted ONLY by reinstate_solo_team_member, or by trusted no-JWT database code such as billing
-- (section C); every other writer of status = 'active' leaves the seat suspended. While it is suspended,
-- only the workspace owner, a platform owner or trusted no-JWT code may change its role, ownership or
-- status other than by reinstating it (section C, rule 1b). What a suspension KEEPS is what makes it reversible: the row (so the roster, which
-- already lists 'suspended', still shows them), their private channel and DM memberships (the
-- seat-ended trigger now treats 'suspended' as a hold), and their authored records. Assigned client
-- relationships are suspended and restored by the incumbent trg_refresh_assigned_relationships.
--
-- Rollback: the two columns, the mark table and its helper, the five lifecycle functions and the
-- seat-started trigger can be dropped; the re-emitted functions return to their previous definitions by
-- re-applying 20271113850008, 20271114160008, 20261048000000, 20260803180000, 20260721002907,
-- 20261047000000 (create/resend; drop the seven-argument create first), 20261200000300
-- (accept_solo_team_invite) and the production body of accept_tenant_invite; the five policies by
-- ALTER POLICY back to their expressions without the status filter.

BEGIN;
SET LOCAL lock_timeout = '2s';

-- ── A. The switch ────────────────────────────────────────────────────────────────────────────────
-- A constant default, so this is a catalog-only change on PostgreSQL 11+: no table rewrite.
ALTER TABLE public.tenant_members ADD COLUMN IF NOT EXISTS team_hub_access boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.tenant_members.team_hub_access IS
  'EXP08 Team conversations switch. true (default): this seat takes part in Team Hub. false: the seat '
  'keeps member access to its own assigned work and is refused conversations_off by every Team Hub '
  'door, cannot be added to a channel, opened in a DM or mentioned, and does not join the team '
  'channels on arrival. Memberships are kept while off, so private channels and DMs are still there when '
  'it is switched back on; switching on also joins every open team channel, including one the person had '
  'left. Written by set_solo_team_member_team_hub_access, and copied from the invitation '
  '(tenant_invite_tokens.team_hub_access) when a seat is created by accepting one.';

-- The invitation carries the same choice, so a spot-job contractor can be invited with Team
-- conversations off and never joins a team channel at all (section L).
ALTER TABLE public.tenant_invite_tokens ADD COLUMN IF NOT EXISTS team_hub_access boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.tenant_invite_tokens.team_hub_access IS
  'EXP08 Team conversations choice for a Solo Team invitation (kind = team). Copied onto the seat when '
  'the invitation is accepted, before the seat joins any team channel. true (default) for every '
  'existing and every other kind of invitation. Written by create_solo_team_invite and carried by '
  'resend_solo_team_invite.';

-- ── B. The global role follows a suspension ──────────────────────────────────────────────────────
-- Measured on the live body before changing it: the UPDATE branch revokes the mapped role only when
-- the mapped role CHANGES, so a status-only flip with the same tenant role revoked nothing — a
-- suspended admin would have kept the tenant-agnostic global 'admin' grant (§59's trap). A suspended
-- seat now maps to no role, so the incumbent "no other active membership still grants it" check
-- revokes it, and reinstating (status back to 'active') re-grants it through the unchanged INSERT/UPDATE
-- branch above it. A role written onto a seat WHILE it is suspended (grant_tenant_member_role
-- promoting a suspended member) is revoked the same way. Deliberately scoped to a NON-OWNER suspended seat, which is exactly what
-- suspend_solo_team_member produces (it refuses owners). The only other writer of 'suspended',
-- solo_beta_sync_subscription, suspends the OWNER's seat on a billing lapse; its global role behaviour
-- is left exactly as it was (and a platform owner's 'admin' is protected by protect_owner_admin, which
-- would otherwise make that billing sync raise). The same gap for 'pending'/'archived'/'revoked', and
-- for a billing-suspended owner, is a separate decision and is reported, not changed here. Body
-- otherwise byte-identical to the live definition (20260721002907).
CREATE OR REPLACE FUNCTION public.sync_tenant_member_to_user_roles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_role app_role;
  _old_role app_role;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.status = 'active' THEN
    _new_role := public.map_tenant_role_to_app_role(NEW.role);
    -- §17 hard ceiling: the auto-sync may never grant a platform-god role, regardless of mapping.
    IF _new_role IN ('super_admin'::app_role, 'platform_admin'::app_role, 'developer'::app_role) THEN
      _new_role := NULL;
    END IF;
    IF _new_role IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id) THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.user_id, _new_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    _old_role := public.map_tenant_role_to_app_role(OLD.role);
    -- EXP08 lifecycle: a suspended non-owner seat holds no mapped role.
    IF _old_role IS NOT NULL
       AND (OLD.role <> NEW.role OR NEW.status <> 'active')
       AND _old_role <> COALESCE(CASE WHEN NEW.status = 'suspended' AND NOT NEW.is_owner THEN NULL
                                      ELSE public.map_tenant_role_to_app_role(NEW.role) END, 'user'::app_role)
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = OLD.user_id AND tm.status = 'active'
          AND tm.id <> OLD.id
          AND public.map_tenant_role_to_app_role(tm.role) = _old_role
      ) THEN
        DELETE FROM public.user_roles WHERE user_id = OLD.user_id AND role = _old_role;
      END IF;
    END IF;
    -- EXP08 lifecycle: a suspended non-owner seat grants no role, including one written onto it
    -- WHILE suspended. grant_tenant_member_role inserts the global role before it writes the seat,
    -- so promoting a suspended member would otherwise leave them holding the tenant-agnostic
    -- global 'admin' while their seat stays suspended. 'user' stays the floor, as above.
    IF NEW.status = 'suspended' AND NOT NEW.is_owner THEN
      _new_role := public.map_tenant_role_to_app_role(NEW.role);
      IF _new_role IS NOT NULL AND _new_role <> 'user'::app_role AND NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = NEW.user_id AND tm.status = 'active'
          AND tm.id <> NEW.id
          AND public.map_tenant_role_to_app_role(tm.role) = _new_role
      ) THEN
        DELETE FROM public.user_roles WHERE user_id = NEW.user_id AND role = _new_role;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    _old_role := public.map_tenant_role_to_app_role(OLD.role);
    IF _old_role IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = OLD.user_id AND tm.status = 'active'
          AND public.map_tenant_role_to_app_role(tm.role) = _old_role
      ) THEN
        DELETE FROM public.user_roles WHERE user_id = OLD.user_id AND role = _old_role;
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── C. Consent: a suspension is lifted only by reinstatement, and cannot be forged ──────────────
-- Two rules, one trigger.
--
-- (1) LIFTING A SUSPENSION (suspended -> active) needs reinstate_solo_team_member's mark, for EVERY
--     JWT caller — another workspace's owner, an admin of this one, and the suspended person
--     themselves. Without it the write keeps the seat 'suspended' (never 'pending': that would end
--     the hold, drop their private memberships through the seat-ended trigger and make the seat
--     unreinstatable). Found by review, measured on the production bodies: grant_tenant_member_role,
--     change_user_role (whose global-role authority even let an owner of ANOTHER workspace do it) and
--     revoke_tenant_member_role all write status = 'active' onto an existing row, and
--     agency_enter_subaccount and accept_tenant_invite's generic branch do it for the caller's own
--     row. Every one of them now leaves the seat suspended.
--     With NO JWT: trusted database code (a definer owned by the database owner, a migration, cron) may
--     lift it, because that is how billing works — solo_beta_sync_subscription is executable only by
--     service_role, carries no JWT, runs as its owner, and moves the owner seat active <-> suspended
--     on the Stripe lifecycle. A DIRECT table write by the service role (current_user =
--     'service_role', e.g. the accept-invite edge function's tenant_members upsert) does not lift
--     it: that path exists to seat a new person, and a suspension is not undone by an old link.
--
--     WHY A ROW AND NOT A SETTING. The mark is a row in tenant_member_reinstatement_marks naming the
--     exact membership and the current transaction id; reinstate_solo_team_member inserts it
--     immediately before its UPDATE and deletes it immediately after, so the table is empty at rest.
--     No browser role or the service role holds any privilege on the table, and no other function
--     writes it (the proof checks this structurally), so nothing a caller can send produces a mark.
--     A transaction-local set_config(...) was rejected: set_config is callable by any SQL running in
--     the session, so a mark made of a setting is only as strong as the most careless definer that
--     ever calls set_config with a caller-influenced name. A row needs INSERT on a table nobody holds.
--
-- (2) CONSENT (#614, 20260803180000), unchanged in kind and extended to the held state. A JWT caller
--     may leave a row 'active' OR 'suspended' for someone other than themselves only when that same
--     user's row was already 'active' or 'suspended'. Every way to mint a foreign 'suspended' seat that
--     was never active — a fresh INSERT, pending, revoked or archived -> suspended, or a user_id
--     repoint — is neutralised to 'pending', exactly as the same paths to 'active' already were.
-- Still SECURITY INVOKER on an empty search_path, so it sees the real caller inside every definer.
CREATE TABLE IF NOT EXISTS public.tenant_member_reinstatement_marks (
  membership_id uuid NOT NULL,
  xact_id xid8 NOT NULL DEFAULT pg_current_xact_id(),
  PRIMARY KEY (membership_id, xact_id)
);
COMMENT ON TABLE public.tenant_member_reinstatement_marks IS
  'EXP08 lifecycle. Transaction-scoped proof that reinstate_solo_team_member is lifting this exact '
  'suspension. Written and deleted only by that function inside its own transaction, so it is empty '
  'at rest. Read only by enforce_tenant_member_consent, through _tenant_member_reinstating. No browser '
  'role or service role holds any privilege on it.';
ALTER TABLE public.tenant_member_reinstatement_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_member_reinstatement_marks FROM PUBLIC, anon, authenticated, service_role;

-- VOLATILE because pg_current_xact_id() is. Definer, so the invoker consent trigger can ask without
-- holding SELECT on the table; executable by nobody but its owner.
CREATE OR REPLACE FUNCTION public._tenant_member_reinstating(p_membership uuid)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant_member_reinstatement_marks r
  WHERE r.membership_id=p_membership AND r.xact_id=pg_current_xact_id())
$$;
REVOKE ALL ON FUNCTION public._tenant_member_reinstating(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_tenant_member_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  -- (1) A suspension is lifted only by reinstatement, or by trusted database code with no JWT.
  IF TG_OP = 'UPDATE' AND OLD.status = 'suspended' AND NEW.status = 'active' THEN
    IF _caller IS NULL AND current_user NOT IN ('service_role', 'authenticated', 'anon') THEN
      NULL; -- trusted database code (billing's solo_beta_sync_subscription, migrations, cron)
    ELSIF _caller IS NULL THEN
      NEW.status := 'suspended'; -- a direct service-role table write is not a reinstatement
    ELSIF NOT public._tenant_member_reinstating(OLD.id) THEN
      NEW.status := 'suspended'; -- any JWT caller, including the person themselves
    END IF;
  END IF;

  -- (1b) WHILE A SEAT IS SUSPENDED, only the workspace owner, a platform owner, or trusted no-JWT
  -- database code may change what the seat IS: its role, its ownership, whose or which workspace's
  -- seat it is, or its status other than by the reinstatement (1) allows. Found by review round 2:
  -- B2, an admin ending a suspended admin's seat through revoke_tenant_member_role (which, once the
  -- suspension revoked the global 'admin', sees no remaining role and writes 'revoked'); and S5, an
  -- admin demoting a suspended admin through change_user_role and then reinstating them as a member.
  -- One check here covers every writer — those two, grant_tenant_member_role, agency_enter_subaccount,
  -- accept_tenant_invite, the accept-invite edge function's direct service-role upsert — without
  -- re-emitting any of them. It RAISES rather than silently keeping the old values: a caller told
  -- "ok" about a change that did not happen is what §13 forbids. (change_user_role catches any error
  -- from its seat write and records 'role:change:mirror_failed'; that is its own contract, and the
  -- seat is still unchanged.) Removal is a DELETE and stays governed by remove_solo_team_member.
  -- Columns that are not authority (the Team conversations switch, title, responsibilities,
  -- timestamps) stay writable by whoever may already write them.
  IF TG_OP = 'UPDATE' AND OLD.status = 'suspended'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.role IS DISTINCT FROM OLD.role
          OR NEW.is_owner IS DISTINCT FROM OLD.is_owner OR NEW.user_id IS DISTINCT FROM OLD.user_id
          OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id)
     -- The reinstatement itself: status only (rule (1) has already reverted every unmarked lift).
     AND NOT (NEW.status = 'active' AND NEW.role = OLD.role AND NEW.is_owner = OLD.is_owner
              AND NEW.user_id = OLD.user_id AND NEW.tenant_id = OLD.tenant_id)
     -- Trusted database code with no JWT (billing, migrations, cron), exactly as in (1).
     AND NOT (_caller IS NULL AND current_user NOT IN ('service_role', 'authenticated', 'anon'))
     -- The workspace owner, or a platform owner (the operator branch the role writers themselves use).
     AND NOT (_caller IS NOT NULL
              AND (public.is_tenant_owner(_caller, OLD.tenant_id) OR public.is_platform_owner()))
  THEN
    RAISE EXCEPTION 'only the workspace owner can change a suspended teammate''s role or seat; nothing was changed'
      USING ERRCODE = '42501';
  END IF;

  -- Service-role / SECURITY DEFINER paths with no JWT (signup, edge functions, provisioning)
  -- have no auth.uid(); they are trusted to write membership directly.
  IF _caller IS NULL THEN
    RETURN NEW;
  END IF;

  -- (2) Would this write leave the row ACTIVE, or SUSPENDED (a held active seat), for someone other
  -- than the caller?
  IF NEW.status IN ('active', 'suspended') AND NEW.user_id <> _caller THEN
    -- Allowed ONLY when the row was ALREADY active or suspended for this SAME user (a role change on
    -- an existing member, a suspension, a reinstatement). Consent was established when it first went
    -- active, and 'suspended' is reachable by a foreign caller only from 'active' — this branch.
    IF TG_OP = 'UPDATE'
       AND OLD.status IN ('active', 'suspended')
       AND OLD.user_id = NEW.user_id THEN
      NULL; -- pre-existing consented seat for the same user — allow.
    ELSE
      -- Every newly-minted foreign-active or foreign-suspended outcome — fresh INSERT, a flip from any
      -- other status, OR a user_id repoint onto an existing row — is neutralized to an inert 'pending'.
      NEW.status := 'pending';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── D. A suspension is a hold: private memberships are kept ──────────────────────────────────────
-- 'suspended' joins 'active' and 'archived' (A9). Removing a suspended seat (DELETE) still ends it.
CREATE OR REPLACE FUNCTION public._team_hub_seat_ended()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.status IN ('active','archived','suspended')
   AND (TG_OP='DELETE' OR coalesce(NEW.status,'') NOT IN ('active','archived','suspended')) THEN
  DELETE FROM public.team_hub_channel_members m USING public.team_hub_channels c
   WHERE m.channel_id=c.id AND m.tenant_id=OLD.tenant_id AND m.user_id=OLD.user_id AND c.visibility='private';
 END IF;
 -- This trigger never writes team_hub_channels. Account retirement deletes rows by the ctids it
 -- planned, and fires this trigger mid-way; an UPDATE here would move a channel's ctid and make
 -- retirement roll back. A private channel left with no members is unreachable by every door,
 -- so it is left as it is rather than archived.
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_seat_ended() FROM PUBLIC, anon, authenticated, service_role;

-- ── E. Who takes part in Team conversations ──────────────────────────────────────────────────────
-- An active seat with the switch on. The door check and every membership-eligibility check use this.
-- _team_hub_is_active stays for what is about the SEAT rather than the conversations: names on what
-- someone wrote ('Former teammate' is for an ended seat, not a switched-off one), who is listed as a
-- private channel's member, and who may be ASSIGNED work (team_hub_request_task) — a contractor with
-- Team conversations off still receives their own work.
CREATE OR REPLACE FUNCTION public._team_hub_participates(p_tenant uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant_members m
  WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active' AND m.team_hub_access)
$$;
REVOKE ALL ON FUNCTION public._team_hub_participates(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- The seat lock every membership-inserting door takes now holds the switch too, so switching someone
-- off waits for a door already adding them and, having committed first, makes that door refuse.
CREATE OR REPLACE FUNCTION public._team_hub_hold_seats(p_tenant uuid, p_users uuid[])
RETURNS boolean LANGUAGE plpgsql SET search_path='' AS $$
DECLARE held bigint;
BEGIN
 SELECT count(DISTINCT s.user_id) INTO held FROM (SELECT m.user_id FROM public.tenant_members m
  WHERE m.tenant_id=p_tenant AND m.user_id=ANY(p_users) AND m.status='active' AND m.team_hub_access ORDER BY m.user_id FOR SHARE) s;
 RETURN held=(SELECT count(DISTINCT x.id) FROM unnest(p_users) x(id));
END $$;
REVOKE ALL ON FUNCTION public._team_hub_hold_seats(uuid,uuid[]) FROM PUBLIC, anon, authenticated, service_role;

-- The central door. A switched-off seat is refused with its own code, conversations_off, because the
-- existing not_member sentence ("You're no longer on this team ... ask to be invited again") would be
-- untrue of someone who is still on the team and still has their work.
CREATE OR REPLACE FUNCTION public._team_hub_refusal(p_expected_tenant uuid)
RETURNS text LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); resolved uuid;
BEGIN
 IF actor IS NULL THEN RETURN 'not_member'; END IF;
 resolved:=public.current_user_tenant_id();
 IF resolved IS NULL OR NOT public._team_hub_is_active(resolved, actor) THEN RETURN 'not_member'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=resolved
   AND t.account_type='standalone' AND t.parent_tenant_id IS NULL) THEN RETURN 'unavailable'; END IF;
 IF p_expected_tenant IS DISTINCT FROM resolved THEN RETURN 'scope_changed'; END IF;
 -- EXP08 lifecycle: an active seat whose Team conversations switch is off keeps its work and is
 -- refused by every Team Hub door. Last, so a stale workspace is reloaded before this is said.
 IF NOT public._team_hub_participates(resolved, actor) THEN RETURN 'conversations_off'; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_refusal(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ── F. The doors whose target checks are membership eligibility ──────────────────────────────────
-- Re-emitted verbatim except the one check each, marked. Unchanged on purpose: team_hub_request_task
-- (its assignee check is work assignment), team_hub_search (author and DM labels), and the private
-- channel member list inside team_hub_list_conversations (who is in it). Every other door reaches the
-- actor through _team_hub_refusal and needs no change.
CREATE OR REPLACE FUNCTION public.team_hub_list_conversations(p_expected_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); people jsonb; conversations jsonb;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 -- Active roster only. Never an email.
 -- EXP08 lifecycle: 'team_conversations' says whether this person can be added to a channel, opened
 -- in a DM or mentioned. They stay listed either way: they are still on the team, still named on
 -- what they wrote, and still assignable work.
 SELECT coalesce(jsonb_agg(jsonb_build_object('user_id',r.user_id,'display_name',r.display_name,'title',r.job_title,
   'permission',r.permission,'team_conversations',r.team_hub_access) ORDER BY lower(r.display_name), r.user_id),'[]'::jsonb) INTO people
 FROM (SELECT tm.user_id, coalesce(nullif(btrim(p.full_name),''),'Teammate') AS display_name, tm.job_title,
   CASE WHEN tm.is_owner OR tm.role::text='owner' THEN 'owner' ELSE tm.role::text END AS permission, tm.team_hub_access
  FROM public.tenant_members tm LEFT JOIN public.profiles p ON p.user_id=tm.user_id
  WHERE tm.tenant_id=p_expected_tenant AND tm.status='active') r;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'name',c.name,'visibility',c.visibility,
   'joined',m.user_id IS NOT NULL,
   -- A4: the caller is a member of a private channel or DM, so may see who else is. Active only.
   'member_count',CASE WHEN c.visibility='private' THEN jsonb_array_length(a.member_ids) END,
   'member_ids',CASE WHEN c.visibility='private' THEN a.member_ids END,
   -- From the pair key, not the member rows: it still names the other person after their seat ends.
   'dm_user_id',CASE WHEN c.kind='dm' THEN (SELECT k.id::uuid FROM unnest(string_to_array(c.dm_key,':')) k(id)
    WHERE k.id<>actor::text) END,
   'unread',CASE WHEN m.user_id IS NULL THEN 0 ELSE (SELECT count(*) FROM public.team_hub_messages x
    WHERE x.channel_id=c.id AND x.parent_message_id IS NULL AND x.deleted_at IS NULL AND x.author_user_id<>actor
     AND (m.last_read_at IS NULL OR x.created_at>m.last_read_at)) END,
   'last_message_at',l.last_message_at)
   ORDER BY c.kind, coalesce(l.last_message_at,c.created_at) DESC, c.id),'[]'::jsonb) INTO conversations
 FROM public.team_hub_channels c
 LEFT JOIN public.team_hub_channel_members m ON m.channel_id=c.id AND m.user_id=actor
 LEFT JOIN LATERAL (SELECT max(x.created_at) AS last_message_at FROM public.team_hub_messages x
  WHERE x.channel_id=c.id AND x.deleted_at IS NULL) l ON true
 LEFT JOIN LATERAL (SELECT coalesce(jsonb_agg(x.user_id ORDER BY x.user_id),'[]'::jsonb) AS member_ids
  FROM public.team_hub_channel_members x
  WHERE c.visibility='private' AND x.channel_id=c.id AND public._team_hub_is_active(c.tenant_id,x.user_id)) a ON true
 WHERE c.tenant_id=p_expected_tenant AND c.archived_at IS NULL AND (c.visibility='team' OR m.user_id IS NOT NULL);
 RETURN jsonb_build_object('ok',true,'tenant_id',p_expected_tenant,'me',jsonb_build_object('user_id',actor),
  'people',people,'conversations',conversations);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_list_conversations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_list_conversations(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.team_hub_create_channel(p_expected_tenant uuid, p_name text, p_visibility text,
 p_member_ids uuid[], p_client_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant);
 channel_name text:=lower(btrim(p_name)); members uuid[]:='{}'; created uuid; retried uuid;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 IF channel_name IS NULL OR channel_name !~ '^[a-z0-9][a-z0-9-]{1,29}$' OR p_visibility IS NULL
  OR p_visibility NOT IN ('team','private') OR p_client_request_id IS NULL THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- EXP08 lifecycle: who may be added is a membership-eligibility check, so it is participates (an
 -- active seat with Team conversations on), not merely an active seat.
 IF p_visibility='private' THEN
  IF EXISTS(SELECT 1 FROM unnest(coalesce(p_member_ids,'{}'::uuid[])) x(id)
    WHERE x.id IS NULL OR NOT public._team_hub_participates(p_expected_tenant,x.id)) THEN
   RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  members:=ARRAY(SELECT DISTINCT x.id FROM unnest(p_member_ids) x(id) WHERE x.id<>actor);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_expected_tenant::text||':'||actor::text||':'||channel_name,0));
 SELECT c.id INTO retried FROM public.team_hub_channels c
  WHERE c.tenant_id=p_expected_tenant AND c.kind='channel' AND c.name=channel_name AND c.visibility=p_visibility
   AND c.created_by=actor AND c.archived_at IS NULL AND c.created_at>now()-interval '60 seconds'
   AND EXISTS(SELECT 1 FROM public._team_hub_visible(p_expected_tenant,actor,c.id))
  ORDER BY c.created_at DESC LIMIT 1;
 IF retried IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'channel_id',retried); END IF;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,actor||members) THEN
  RETURN jsonb_build_object('ok',false,'code',CASE WHEN public._team_hub_participates(p_expected_tenant,actor)
   THEN 'invalid' WHEN public._team_hub_is_active(p_expected_tenant,actor) THEN 'conversations_off'
   ELSE 'not_member' END); END IF;
 IF p_visibility='team' THEN
  INSERT INTO public.team_hub_channels(tenant_id,kind,name,visibility,created_by)
   VALUES (p_expected_tenant,'channel',channel_name,'team',actor)
   ON CONFLICT (tenant_id,name) WHERE archived_at IS NULL AND visibility='team' DO NOTHING RETURNING id INTO created;
  IF created IS NULL THEN RETURN jsonb_build_object('ok',false,'code','name_taken'); END IF;
 ELSE
  INSERT INTO public.team_hub_channels(tenant_id,kind,name,visibility,created_by)
   VALUES (p_expected_tenant,'channel',channel_name,'private',actor) RETURNING id INTO created;
 END IF;
 INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
  SELECT created,p_expected_tenant,x.id,actor FROM unnest(actor||members) x(id);
 RETURN jsonb_build_object('ok',true,'channel_id',created);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_create_channel(uuid,text,text,uuid[],uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_create_channel(uuid,text,text,uuid[],uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.team_hub_open_dm(p_expected_tenant uuid, p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); pair_key text; dm public.team_hub_channels;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 -- EXP08 lifecycle: who may be added is a membership-eligibility check, so it is participates (an
 -- active seat with Team conversations on), not merely an active seat.
 IF p_user_id IS NULL OR p_user_id=actor OR NOT public._team_hub_participates(p_expected_tenant,p_user_id) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor,p_user_id]) THEN
  RETURN jsonb_build_object('ok',false,'code',CASE WHEN public._team_hub_participates(p_expected_tenant,actor)
   THEN 'invalid' WHEN public._team_hub_is_active(p_expected_tenant,actor) THEN 'conversations_off'
   ELSE 'not_member' END); END IF;
 pair_key:=least(actor,p_user_id)::text||':'||greatest(actor,p_user_id)::text;
 INSERT INTO public.team_hub_channels(tenant_id,kind,visibility,dm_key,created_by)
  VALUES (p_expected_tenant,'dm','private',pair_key,actor) ON CONFLICT (tenant_id,dm_key) DO NOTHING;
 SELECT * INTO dm FROM public.team_hub_channels c WHERE c.tenant_id=p_expected_tenant AND c.dm_key=pair_key;
 -- An archived conversation is one nobody can see: not_found, like every other door.
 IF dm.archived_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
  VALUES (dm.id,p_expected_tenant,actor,actor),(dm.id,p_expected_tenant,p_user_id,actor)
  ON CONFLICT (channel_id,user_id) DO NOTHING;
 RETURN jsonb_build_object('ok',true,'channel_id',dm.id);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_open_dm(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_open_dm(uuid,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.team_hub_add_members(p_expected_tenant uuid, p_channel_id uuid, p_user_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels; added int;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 -- A private channel is visible only to its members, so visibility is the current-member check.
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF ch.kind<>'channel' OR ch.visibility<>'private' THEN RETURN jsonb_build_object('ok',false,'code','not_allowed'); END IF;
 -- EXP08 lifecycle: who may be added is a membership-eligibility check, so it is participates (an
 -- active seat with Team conversations on), not merely an active seat.
 IF p_user_ids IS NULL OR EXISTS(SELECT 1 FROM unnest(p_user_ids) x(id)
   WHERE x.id IS NULL OR NOT public._team_hub_participates(p_expected_tenant,x.id)) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF NOT public._team_hub_hold_seats(p_expected_tenant,p_user_ids) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
  SELECT DISTINCT ch.id,p_expected_tenant,x.id,actor FROM unnest(p_user_ids) x(id)
  ON CONFLICT (channel_id,user_id) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'added',added);
END $$;
REVOKE ALL ON FUNCTION public.team_hub_add_members(uuid,uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_hub_add_members(uuid,uuid,uuid[]) TO authenticated;
CREATE OR REPLACE FUNCTION public.team_hub_post_message(p_expected_tenant uuid, p_channel_id uuid, p_body text,
 p_client_request_id uuid, p_parent_message_id uuid DEFAULT NULL, p_mention_ids uuid[] DEFAULT '{}',
 p_file_ids uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels;
 body text:=public._team_hub_trim(p_body); mentions uuid[]; msg public.team_hub_messages; other uuid;
 files uuid[]:=coalesce(p_file_ids,'{}'::uuid[]); held int;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_client_request_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- A retry returns the original, with its files. The same request id in another conversation is a client error.
 SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_user_id=actor AND m.client_request_id=p_client_request_id;
 IF FOUND THEN
  IF msg.channel_id<>ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 -- 0 to 5 distinct, non-null ids.
 IF cardinality(files)>5 OR array_position(files,NULL) IS NOT NULL
   OR cardinality(files)<>(SELECT count(DISTINCT x.id) FROM unnest(files) x(id)) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF body IS NULL OR (body='' AND cardinality(files)=0) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 IF char_length(body)>8000 THEN RETURN jsonb_build_object('ok',false,'code','too_long'); END IF;
 IF p_parent_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.team_hub_messages p
   WHERE p.id=p_parent_message_id AND p.channel_id=ch.id AND p.parent_message_id IS NULL AND p.deleted_at IS NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 -- Before anything is written. Locked in id order, so a concurrent post of the same file waits
 -- here and then finds it posted.
 IF cardinality(files)>0 THEN
  SELECT count(*) INTO held FROM (SELECT f.id FROM public.team_hub_files f
   WHERE f.id=ANY(files) AND f.tenant_id=p_expected_tenant AND f.channel_id=ch.id AND f.uploaded_by=actor
    AND f.state='ready' AND f.message_id IS NULL ORDER BY f.id FOR UPDATE) s;
  IF held<>cardinality(files) THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 END IF;
 -- A DM keeps reaching the other person. If their seat ended and they were re-invited, the seat
 -- trigger removed their membership; posting restores it, as reopening the DM does. A person
 -- whose seat is not active stays out. This comes before the mention check so the restored person
 -- can be mentioned; an active DM party belongs in the DM even if this post is then refused.
 IF ch.kind='dm' THEN
  other:=CASE split_part(ch.dm_key,':',1) WHEN actor::text THEN split_part(ch.dm_key,':',2)
   ELSE split_part(ch.dm_key,':',1) END::uuid;
  -- EXP08 lifecycle: the other person is still on the team but has Team conversations off, so they
  -- cannot read this. Refused with its own code rather than stored as if delivered, before anything
  -- is written (files stay unposted). A former or suspended teammate is unchanged: the post is
  -- kept for the record, as before.
  IF other IS NOT NULL AND public._team_hub_is_active(p_expected_tenant,other)
    AND NOT public._team_hub_participates(p_expected_tenant,other) THEN
   RETURN jsonb_build_object('ok',false,'code','recipient_conversations_off'); END IF;
  IF other IS NOT NULL AND public._team_hub_hold_seats(p_expected_tenant,ARRAY[other]) THEN
   INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by)
    VALUES (ch.id,p_expected_tenant,other,actor) ON CONFLICT (channel_id,user_id) DO NOTHING;
  END IF;
 END IF;
 -- A mention must be an active member who can see this conversation: anyone active for a team
 -- channel, the channel's members for a private channel or DM.
 -- EXP08 lifecycle: and who takes part in Team conversations, so nobody is told about a
 -- conversation they are refused (participates, not merely an active seat).
 IF EXISTS(SELECT 1 FROM unnest(coalesce(p_mention_ids,'{}'::uuid[])) x(id)
   WHERE x.id IS NULL OR NOT public._team_hub_participates(p_expected_tenant,x.id)
    OR (ch.visibility='private' AND NOT EXISTS(SELECT 1 FROM public.team_hub_channel_members m
     WHERE m.channel_id=ch.id AND m.user_id=x.id))) THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 mentions:=ARRAY(SELECT DISTINCT x.id FROM unnest(coalesce(p_mention_ids,'{}'::uuid[])) x(id));
 IF ch.visibility='team' THEN
  IF NOT public._team_hub_hold_seats(p_expected_tenant,ARRAY[actor]) THEN RETURN jsonb_build_object('ok',false,'code','not_member'); END IF;
  INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by,last_read_at)
   VALUES (ch.id,p_expected_tenant,actor,actor,now()) ON CONFLICT (channel_id,user_id) DO NOTHING;
 END IF;
 INSERT INTO public.team_hub_messages(tenant_id,channel_id,author_user_id,body,parent_message_id,client_request_id)
  VALUES (p_expected_tenant,ch.id,actor,body,p_parent_message_id,p_client_request_id)
  ON CONFLICT (author_user_id,client_request_id) DO NOTHING RETURNING * INTO msg;
 IF msg.id IS NULL THEN
  -- A concurrent retry stored it first.
  -- Never a success built from a row this statement cannot see.
  SELECT * INTO msg FROM public.team_hub_messages m WHERE m.author_user_id=actor AND m.client_request_id=p_client_request_id;
  IF NOT FOUND OR msg.channel_id IS DISTINCT FROM ch.id THEN RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
  RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg),'duplicate',true);
 END IF;
 INSERT INTO public.team_hub_message_mentions(message_id,tenant_id,channel_id,mentioned_user_id)
  SELECT msg.id,p_expected_tenant,ch.id,x.id FROM unnest(mentions) x(id);
 UPDATE public.team_hub_files f SET message_id=msg.id, posted_at=now() WHERE f.id=ANY(files);
 RETURN jsonb_build_object('ok',true,'message',public._team_hub_message_json(msg));
END $$;
REVOKE ALL ON FUNCTION public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.team_hub_post_message(uuid,uuid,text,uuid,uuid,uuid[],uuid[]) TO authenticated;

-- ── G. Joining the team channels on arrival ──────────────────────────────────────────────────────
-- When a seat FIRST becomes active — inserted active (accept_solo_team_invite), or moved to active from
-- anything but a hold — in a canonical SOLO workspace, with Team conversations on, it joins every open
-- team channel. The rows are the ones team_hub_join_channel writes: added by the person themselves,
-- history read (last_read_at = now()), so only what arrives after joining counts as unread.
-- Not on a reinstatement (suspended -> active) or an operator restore (archived -> active): those are
-- holds, their memberships were kept, and re-joining would undo a channel the person had left.
-- A consent-neutralised write lands 'pending', so a forged activation never joins anything.
-- AFTER, DEFINER, empty search_path, like _team_hub_seat_ended; and like it, it never writes
-- team_hub_channels, so account retirement's planned ctids cannot move.
CREATE OR REPLACE FUNCTION public._team_hub_seat_started()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status='active' AND NEW.team_hub_access
   AND (TG_OP='INSERT' OR OLD.status NOT IN ('active','suspended','archived'))
   AND EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=NEW.tenant_id
    AND t.account_type='standalone' AND t.parent_tenant_id IS NULL) THEN
  INSERT INTO public.team_hub_channel_members(channel_id,tenant_id,user_id,added_by,last_read_at)
   SELECT c.id,NEW.tenant_id,NEW.user_id,NEW.user_id,now() FROM public.team_hub_channels c
   WHERE c.tenant_id=NEW.tenant_id AND c.kind='channel' AND c.visibility='team' AND c.archived_at IS NULL
   ON CONFLICT (channel_id,user_id) DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._team_hub_seat_started() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE TRIGGER team_hub_seat_started AFTER INSERT OR UPDATE OF status
 ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public._team_hub_seat_started();

-- ── H. Suspend and reinstate ─────────────────────────────────────────────────────────────────────
-- Refusals raise, in the removal function's style, because Settings → Team reads error.message
-- (team-workspace-contract.ts). Every refusal raises before anything is written.
CREATE OR REPLACE FUNCTION public.suspend_solo_team_member(
  _member_user_id uuid,
  _expected_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _target public.tenant_members;
  _caller_owner boolean;
  _landed text;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  -- Refusal-only, as in remove_solo_team_member: never a scope, only ever a reason to stop.
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could run; nothing was changed'
      USING ERRCODE = '42501';
  END IF;
  -- Who may ask, before the target is looked up (no membership oracle).
  _caller_owner := public.is_tenant_owner(_actor, _tenant);
  IF NOT _caller_owner AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant AND tm.user_id = _actor AND tm.status = 'active'
      AND tm.role = 'admin'::public.tenant_role
  ) THEN
    RAISE EXCEPTION 'only an owner or an admin may suspend someone in this workspace' USING ERRCODE = '42501';
  END IF;
  IF _member_user_id IS NULL THEN
    RAISE EXCEPTION 'name the person to suspend';
  END IF;
  IF _member_user_id = _actor THEN
    RAISE EXCEPTION 'you cannot suspend yourself in this workspace' USING ERRCODE = '42501';
  END IF;

  -- Locked and not filtered by status, for the removal function's reasons: grant_co_owner() must not
  -- turn this person into an owner between the read and the write.
  SELECT * INTO _target FROM public.tenant_members tm
  WHERE tm.tenant_id = _tenant AND tm.user_id = _member_user_id
  FOR UPDATE;
  IF _target.id IS NULL THEN
    RAISE EXCEPTION 'that person is not on this workspace''s team';
  END IF;
  IF _target.is_owner OR _target.role = 'owner'::public.tenant_role THEN
    RAISE EXCEPTION 'an owner cannot be suspended in this workspace' USING ERRCODE = '42501';
  END IF;
  IF _target.role NOT IN ('admin'::public.tenant_role, 'member'::public.tenant_role) THEN
    RAISE EXCEPTION 'only an Admin or a Member can be suspended in this workspace';
  END IF;
  IF _target.role = 'admin'::public.tenant_role AND NOT _caller_owner THEN
    RAISE EXCEPTION 'only the workspace owner may suspend an admin in this workspace' USING ERRCODE = '42501';
  END IF;
  IF _target.status <> 'active' THEN
    RAISE EXCEPTION 'only an active teammate can be suspended; nothing was changed';
  END IF;

  UPDATE public.tenant_members SET status = 'suspended' WHERE id = _target.id;
  -- Read back what the triggers let land, rather than assuming it.
  SELECT tm.status INTO _landed FROM public.tenant_members tm WHERE tm.id = _target.id;
  IF _landed IS DISTINCT FROM 'suspended' THEN
    RAISE EXCEPTION 'the suspension did not take effect; nothing was changed';
  END IF;

  -- The suspended person's pointer at this workspace is stale for the removal function's reason.
  UPDATE public.profiles SET active_tenant_id = NULL
  WHERE user_id = _member_user_id AND active_tenant_id = _tenant;

  -- The global app_role is left to trg_sync_tenant_member_to_user_roles (section B above).
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_member', 'member_suspended', _target.id,
          jsonb_build_object('tenant_id', _tenant, 'target_user_id', _member_user_id,
                             'role', _target.role::text));

  RETURN jsonb_build_object('tenant_id', _tenant, 'membership_id', _target.id,
                            'user_id', _member_user_id, 'status', 'suspended');
END;
$function$;
REVOKE ALL ON FUNCTION public.suspend_solo_team_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suspend_solo_team_member(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.suspend_solo_team_member(uuid, uuid) IS
  'Reversible hold on one Admin or Member of the caller''s active workspace: status active -> suspended. '
  'Owner: any admin or member; admin: members only; never an owner, never oneself. Session-derived '
  'actor and workspace; the tenant argument is refusal-only. Keeps the row, private Team Hub '
  'memberships and authored records; the global role is revoked by the sync trigger. Audit '
  'member_suspended.';

CREATE OR REPLACE FUNCTION public.reinstate_solo_team_member(
  _member_user_id uuid,
  _expected_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _target public.tenant_members;
  _caller_owner boolean;
  _landed text;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could run; nothing was changed'
      USING ERRCODE = '42501';
  END IF;
  _caller_owner := public.is_tenant_owner(_actor, _tenant);
  IF NOT _caller_owner AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant AND tm.user_id = _actor AND tm.status = 'active'
      AND tm.role = 'admin'::public.tenant_role
  ) THEN
    RAISE EXCEPTION 'only an owner or an admin may reinstate someone in this workspace' USING ERRCODE = '42501';
  END IF;
  IF _member_user_id IS NULL THEN
    RAISE EXCEPTION 'name the person to reinstate';
  END IF;
  IF _member_user_id = _actor THEN
    RAISE EXCEPTION 'you cannot reinstate yourself in this workspace' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _target FROM public.tenant_members tm
  WHERE tm.tenant_id = _tenant AND tm.user_id = _member_user_id
  FOR UPDATE;
  IF _target.id IS NULL THEN
    RAISE EXCEPTION 'that person is not on this workspace''s team';
  END IF;
  IF _target.is_owner OR _target.role = 'owner'::public.tenant_role THEN
    RAISE EXCEPTION 'an owner cannot be reinstated here' USING ERRCODE = '42501';
  END IF;
  IF _target.role NOT IN ('admin'::public.tenant_role, 'member'::public.tenant_role) THEN
    RAISE EXCEPTION 'only an Admin or a Member can be reinstated in this workspace';
  END IF;
  IF _target.role = 'admin'::public.tenant_role AND NOT _caller_owner THEN
    RAISE EXCEPTION 'only the workspace owner may reinstate an admin in this workspace' USING ERRCODE = '42501';
  END IF;
  IF _target.status <> 'suspended' THEN
    RAISE EXCEPTION 'only a suspended teammate can be reinstated; nothing was changed';
  END IF;

  -- The consent trigger lifts a suspension only for the exact membership marked in THIS
  -- transaction (section C). The mark is made immediately before the write and removed immediately
  -- after it, so it exists for exactly one statement and the table is empty at rest.
  INSERT INTO public.tenant_member_reinstatement_marks (membership_id) VALUES (_target.id);
  UPDATE public.tenant_members SET status = 'active' WHERE id = _target.id;
  DELETE FROM public.tenant_member_reinstatement_marks
  WHERE membership_id = _target.id AND xact_id = pg_current_xact_id();
  -- Read back what the triggers let land. Had the consent trigger kept the hold, the seat would
  -- still read 'suspended'; that is a failure, never a reinstatement.
  SELECT tm.status INTO _landed FROM public.tenant_members tm WHERE tm.id = _target.id;
  IF _landed IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'the reinstatement did not take effect; nothing was changed';
  END IF;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_member', 'member_reinstated', _target.id,
          jsonb_build_object('tenant_id', _tenant, 'target_user_id', _member_user_id,
                             'role', _target.role::text));

  RETURN jsonb_build_object('tenant_id', _tenant, 'membership_id', _target.id,
                            'user_id', _member_user_id, 'status', 'active');
END;
$function$;
REVOKE ALL ON FUNCTION public.reinstate_solo_team_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reinstate_solo_team_member(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.reinstate_solo_team_member(uuid, uuid) IS
  'Ends a suspension: status suspended -> active for one Admin or Member of the caller''s active '
  'workspace, under the same authority as suspend_solo_team_member. Kept memberships come back as '
  'they were; the global role is re-granted by the sync trigger. Audit member_reinstated.';

-- ── I. Removal: an admin may remove a member ─────────────────────────────────────────────────────
-- Re-emitted from 20261048000000 verbatim except the marked authority lines. Works on a suspended
-- seat: the lookup was never status-filtered, and the seat-ended trigger ends a suspended seat's
-- private memberships on DELETE.
CREATE OR REPLACE FUNCTION public.remove_solo_team_member(
  _member_user_id uuid,
  _expected_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _target public.tenant_members;
  _removed integer;
  _caller_owner boolean;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;

  -- The workspace this function acts on is `_tenant`, resolved from the session, and nothing else.
  -- `_expected_tenant_id` is refusal-only: it is never read as a scope, never substituted for
  -- `_tenant`, and can only cause this call to FAIL. It exists because `current_user_tenant_id()`
  -- reads `profiles.active_tenant_id`, and switching workspaces writes that column BEFORE the
  -- browser's own state changes — so a confirmation armed against one roster could otherwise be
  -- executed against another workspace the same person also belongs to. The caller states which
  -- workspace it believed it was looking at; a disagreement is an abort, never a redirection.
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could run; nothing was removed'
      USING ERRCODE = '42501';
  END IF;

  -- Authority is settled BEFORE the target is looked up, and that order is load-bearing: "that
  -- person is not on this workspace's team" is information, and answering it for a caller who was
  -- never entitled to ask turns a refusal into a membership oracle.
  -- EXP08 lifecycle (owner ruling 2026-10-26): an owner OR an admin may remove. Which TARGETS an
  -- admin may reach is settled after the lookup, below; who may ask at all is settled here.
  _caller_owner := public.is_tenant_owner(_actor, _tenant);
  IF NOT _caller_owner AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant AND tm.user_id = _actor AND tm.status = 'active'
      AND tm.role = 'admin'::public.tenant_role
  ) THEN
    RAISE EXCEPTION 'only an owner or an admin may remove someone from this workspace'
      USING ERRCODE = '42501';
  END IF;

  IF _member_user_id IS NULL THEN
    RAISE EXCEPTION 'name the person to remove';
  END IF;

  IF _member_user_id = _actor THEN
    RAISE EXCEPTION 'you cannot remove yourself from this workspace' USING ERRCODE = '42501';
  END IF;

  -- Locked, and deliberately NOT filtered by status. UNIQUE (tenant_id, user_id) means at most one
  -- row can match, so a status filter could only hide a row — and a hidden row is both unremovable
  -- here and still counted as "already belongs to the workspace" by the invite functions. The lock
  -- matters because grant_co_owner() could otherwise flip this person to an owner between the read
  -- and the write, and no BEFORE DELETE trigger exists to catch the result.
  SELECT * INTO _target
  FROM public.tenant_members tm
  WHERE tm.tenant_id = _tenant
    AND tm.user_id = _member_user_id
  FOR UPDATE;

  IF _target.id IS NULL THEN
    RAISE EXCEPTION 'that person is not on this workspace''s team';
  END IF;

  -- Every owner is refused, which is what makes "the sole owner is never removable" true without
  -- depending on a count that could be got wrong. Removing a co-owner, and transferring ownership,
  -- are a separate assignment.
  IF _target.is_owner OR _target.role = 'owner'::public.tenant_role THEN
    RAISE EXCEPTION 'an owner cannot be removed from this workspace here' USING ERRCODE = '42501';
  END IF;

  -- Second, independent guard on the same invariant, and the scope line of this slice: the roster
  -- shows legacy specialised permissions truthfully and this surface does not relabel or reassign
  -- them, so it refuses to remove one rather than guessing what that would mean.
  IF _target.role NOT IN ('admin'::public.tenant_role, 'member'::public.tenant_role) THEN
    RAISE EXCEPTION 'only an Admin or a Member can be removed from this workspace';
  END IF;

  -- EXP08 lifecycle: an admin removes members only. Removing an admin stays the owner's.
  IF _target.role = 'admin'::public.tenant_role AND NOT _caller_owner THEN
    RAISE EXCEPTION 'only the workspace owner may remove an admin from this workspace'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.tenant_members WHERE id = _target.id;
  GET DIAGNOSTICS _removed = ROW_COUNT;
  IF _removed <> 1 THEN
    RAISE EXCEPTION 'the membership could not be removed; nothing was changed';
  END IF;

  -- The removed person's pointer at this workspace is now stale, and nothing else resets it:
  -- guard_active_tenant_membership fires only when active_tenant_id CHANGES, so it never
  -- revalidates a value left behind. It grants no access on its own (current_user_tenant_id()
  -- requires an active membership), but three invitation RPCs read the column RAW, which is how
  -- somebody removed from this workspace would be told they are not the owner of their own.
  -- NULL is the honest value; inventing a replacement workspace would put them in someone's book.
  -- Setting it to NULL is explicitly permitted by that guard, and operator_exit_tenant() does the
  -- same thing for the same reason.
  UPDATE public.profiles
  SET active_tenant_id = NULL
  WHERE user_id = _member_user_id
    AND active_tenant_id = _tenant;

  -- The global app_role is NOT written here. trg_sync_tenant_member_to_user_roles fires AFTER the
  -- DELETE above and revokes the mapped role iff no other active membership still grants it. A
  -- second writer would revoke a role the person still legitimately holds somewhere else.
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_member', 'member_removed', _target.id,
          jsonb_build_object('tenant_id', _tenant,
                             'target_user_id', _member_user_id,
                             'role', _target.role::text));

  RETURN jsonb_build_object(
    'tenant_id', _tenant,
    'membership_id', _target.id,
    'removed_user_id', _member_user_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.remove_solo_team_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_solo_team_member(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.remove_solo_team_member(uuid, uuid) IS
  'Removal of one Admin or Member from the caller''s own active workspace. Owner: any admin or member; '
  'admin: members only (EXP08 lifecycle, owner ruling 2026-10-26). Actor and workspace are derived '
  'from the session; the tenant argument is a refusal-only confirmation token and never selects '
  'scope. Owners are refused, so the sole owner is unreachable. Deletes the membership row only: '
  'identity, profile, authored records and audit history are untouched, and the global app_role is '
  'left to trg_sync_tenant_member_to_user_roles. Browser roles hold no write verb on tenant_members '
  '(20261048000000), so this is the supported removal route.';

-- ── J. The Team conversations switch ─────────────────────────────────────────────────────────────
-- OFF removes no membership: every door refuses the person anyway, so their private channels and DMs
-- are simply still there when it comes back on. ON from OFF then joins EVERY open team channel, the
-- rows arriving would have written (added by the person who switched it, history read). It does not
-- restore exactly what they had: a team channel they had left before being switched off is joined
-- again, as it would be for a new arrival. Recording and replaying each person's leave history was
-- judged not worth a second store; the honest description is "back on = arrive again, plus everything
-- private you already had". A pending seat may be switched too, so it never joins on arrival.
CREATE OR REPLACE FUNCTION public.set_solo_team_member_team_hub_access(
  _member_user_id uuid,
  _expected_tenant_id uuid,
  _on boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _target public.tenant_members;
  _caller_owner boolean;
  _joined integer := 0;
  _changed boolean := false;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could run; nothing was changed'
      USING ERRCODE = '42501';
  END IF;
  _caller_owner := public.is_tenant_owner(_actor, _tenant);
  IF NOT _caller_owner AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant AND tm.user_id = _actor AND tm.status = 'active'
      AND tm.role = 'admin'::public.tenant_role
  ) THEN
    RAISE EXCEPTION 'only an owner or an admin may change someone''s team conversations in this workspace'
      USING ERRCODE = '42501';
  END IF;
  IF _member_user_id IS NULL OR _on IS NULL THEN
    RAISE EXCEPTION 'name the person and say whether team conversations are on or off';
  END IF;
  IF _member_user_id = _actor THEN
    RAISE EXCEPTION 'you cannot change your own team conversations here' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _target FROM public.tenant_members tm
  WHERE tm.tenant_id = _tenant AND tm.user_id = _member_user_id
  FOR UPDATE;
  IF _target.id IS NULL THEN
    RAISE EXCEPTION 'that person is not on this workspace''s team';
  END IF;
  IF _target.is_owner OR _target.role = 'owner'::public.tenant_role THEN
    RAISE EXCEPTION 'an owner''s team conversations cannot be changed here' USING ERRCODE = '42501';
  END IF;
  IF _target.role NOT IN ('admin'::public.tenant_role, 'member'::public.tenant_role) THEN
    RAISE EXCEPTION 'only an Admin or a Member can have team conversations changed in this workspace';
  END IF;
  IF _target.role = 'admin'::public.tenant_role AND NOT _caller_owner THEN
    RAISE EXCEPTION 'only the workspace owner may change an admin''s team conversations' USING ERRCODE = '42501';
  END IF;
  IF _target.status NOT IN ('active', 'suspended', 'pending') THEN
    RAISE EXCEPTION 'only a current teammate''s team conversations can be changed; nothing was changed';
  END IF;

  IF _target.team_hub_access IS DISTINCT FROM _on THEN
    UPDATE public.tenant_members SET team_hub_access = _on WHERE id = _target.id;
    _changed := true;
    -- Back on: join the open team channels, as arriving would have. A held (suspended) seat joins
    -- too; the doors refuse it until it is reinstated, and the seat-ended trigger keeps the rows.
    IF _on AND _target.status IN ('active', 'suspended') AND EXISTS (
      SELECT 1 FROM public.tenants t WHERE t.id = _tenant
        AND t.account_type = 'standalone' AND t.parent_tenant_id IS NULL
    ) THEN
      INSERT INTO public.team_hub_channel_members (channel_id, tenant_id, user_id, added_by, last_read_at)
      SELECT c.id, _tenant, _member_user_id, _actor, now() FROM public.team_hub_channels c
      WHERE c.tenant_id = _tenant AND c.kind = 'channel' AND c.visibility = 'team' AND c.archived_at IS NULL
      ON CONFLICT (channel_id, user_id) DO NOTHING;
      GET DIAGNOSTICS _joined = ROW_COUNT;
    END IF;
    INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
    VALUES (_actor, 'tenant_member', 'team_hub_access_changed', _target.id,
            jsonb_build_object('tenant_id', _tenant, 'target_user_id', _member_user_id,
                               'team_hub_access', _on, 'joined_channels', _joined));
  END IF;

  RETURN jsonb_build_object('tenant_id', _tenant, 'membership_id', _target.id, 'user_id', _member_user_id,
                            'team_hub_access', _on, 'changed', _changed, 'joined_channels', _joined);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_solo_team_member_team_hub_access(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_solo_team_member_team_hub_access(uuid, uuid, boolean) TO authenticated;
COMMENT ON FUNCTION public.set_solo_team_member_team_hub_access(uuid, uuid, boolean) IS
  'Turns one Admin or Member''s Team conversations on or off in the caller''s active workspace, under '
  'the suspend/remove authority. Off keeps every membership; on from off joins every open team channel '
  '(including one the person had left) and keeps the private ones they already had. '
  'Audit team_hub_access_changed when the value changes.';

-- ── K. The departure review (read-only) ──────────────────────────────────────────────────────────
-- What a person holds in this workspace, OPEN items only, so an owner or admin can hand it on before
-- they suspend or remove them. Same authority as the acts above. Each list is capped at 50, most
-- urgent first; counts carry the true totals. Open means, per each table's own vocabulary (CHECKs and
-- the task_status enum read on production 2026-10-26):
--   work (plan_items)          status open | in_progress | blocked          (not done, cancelled)
--   crm_tasks (tasks)          status pending | in_progress                 (not completed, cancelled)
--   clients                    assigned_coach_user_id / lead_owner_user_id, not archived, not merged
--   deals                      status open                                  (not won, lost)
--   approvals                  assigned, status pending | changes_requested | escalated
--   mailboxes                  mailbox_owner_user_id, status active and active
-- Client labels use the pipeline's display convention (name, else business name), never an email.
--
-- ITEM ROWS ARE WHAT A HAND-OVER NEEDS (review round 2, approved read-only design). Every row carries
-- the version its existing owner writer requires, so the review can hand an item to someone else
-- THROUGH THAT WRITER without a second read (docs/delivery: the hand-over contract):
--   work       updated_at   -> plan_update_item_versioned(p_expected_updated_at, p_assigned_to_user_id)
--   crm_tasks  updated_at   -> crm-command task.assign (expected_updated_at)
--   clients    updated_at   -> crm-command contact.assign_coach / contact.assign_owner (expected_updated_at)
--   deals      version      -> crm-command deal.assign_owner (expected_version)
-- Approvals and mailboxes have NO hand-over writer today (see the contract); they are listed so the
-- owner can see them, with nothing that implies they move. What each row shows is what the workspace
-- already shows its owners and admins: an approval's summary (the queue's own text, trimmed to 140
-- characters), its category and when it arrived; a mailbox's provider, its display name and its
-- address, which Settings -> Connections already shows them. A deal carries its value and currency,
-- and a piece of work, a CRM task (through its deal) or a deal carries its client's label. No email
-- of a client appears anywhere.
CREATE OR REPLACE FUNCTION public.team_member_holdings(
  _member_user_id uuid,
  _expected_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _target public.tenant_members;
  _caller_owner boolean;
  _work jsonb; _tasks jsonb; _clients jsonb; _deals jsonb; _approvals jsonb; _mailboxes jsonb;
  _n_work bigint; _n_tasks bigint; _n_clients bigint; _n_deals bigint; _n_approvals bigint; _n_mailboxes bigint;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required in an active workspace' USING ERRCODE = '42501';
  END IF;
  IF _expected_tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'your active workspace changed before this could run; nothing was read'
      USING ERRCODE = '42501';
  END IF;
  _caller_owner := public.is_tenant_owner(_actor, _tenant);
  IF NOT _caller_owner AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _tenant AND tm.user_id = _actor AND tm.status = 'active'
      AND tm.role = 'admin'::public.tenant_role
  ) THEN
    RAISE EXCEPTION 'only an owner or an admin may review what someone holds in this workspace'
      USING ERRCODE = '42501';
  END IF;
  IF _member_user_id IS NULL THEN
    RAISE EXCEPTION 'name the person to review';
  END IF;
  IF _member_user_id = _actor THEN
    RAISE EXCEPTION 'you cannot review your own departure here' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _target FROM public.tenant_members tm
  WHERE tm.tenant_id = _tenant AND tm.user_id = _member_user_id;
  IF _target.id IS NULL THEN
    RAISE EXCEPTION 'that person is not on this workspace''s team';
  END IF;
  IF _target.is_owner OR _target.role = 'owner'::public.tenant_role THEN
    RAISE EXCEPTION 'an owner''s holdings are not reviewed here' USING ERRCODE = '42501';
  END IF;
  -- An owner reviews any other seat; an admin reviews members only.
  IF NOT _caller_owner AND _target.role <> 'member'::public.tenant_role THEN
    RAISE EXCEPTION 'only the workspace owner may review what an admin holds' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO _n_work FROM public.plan_items x
  WHERE x.tenant_id = _tenant AND x.assigned_to_user_id = _member_user_id
    AND x.status IN ('open', 'in_progress', 'blocked');
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'status', w.status, 'due_at', w.due_at,
             'updated_at', w.updated_at, 'client_id', w.client_id, 'client_label', w.client_label)
           ORDER BY w.due_at ASC NULLS LAST, w.created_at DESC, w.id), '[]'::jsonb) INTO _work
  FROM (SELECT x.id, x.title, x.status, x.due_at, x.created_at, x.updated_at, c.id AS client_id,
               CASE WHEN c.id IS NULL THEN NULL ELSE coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),
                 nullif(c.entity_name,''),'Client not recorded') END AS client_label
        FROM public.plan_items x
        LEFT JOIN public.clients c ON c.id = x.contact_id AND c.tenant_id = _tenant
        WHERE x.tenant_id = _tenant AND x.assigned_to_user_id = _member_user_id
          AND x.status IN ('open', 'in_progress', 'blocked')
        ORDER BY x.due_at ASC NULLS LAST, x.created_at DESC, x.id LIMIT 50) w;

  SELECT count(*) INTO _n_tasks FROM public.tasks x
  WHERE x.tenant_id = _tenant AND x.user_id = _member_user_id
    AND x.status::text IN ('pending', 'in_progress');
  -- A CRM task names no client of its own (the CRM task model has no contact link); its client is
  -- the one on the deal it belongs to, when it belongs to one.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'status', w.status, 'due_date', w.due_date,
             'updated_at', w.updated_at, 'deal_id', w.deal_id, 'client_id', w.client_id, 'client_label', w.client_label)
           ORDER BY w.due_date ASC NULLS LAST, w.created_at DESC NULLS LAST, w.id), '[]'::jsonb) INTO _tasks
  FROM (SELECT x.id, x.title, x.status::text AS status, x.due_date, x.created_at, x.updated_at, d.id AS deal_id,
               c.id AS client_id,
               CASE WHEN c.id IS NULL THEN NULL ELSE coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),
                 nullif(c.entity_name,''),'Client not recorded') END AS client_label
        FROM public.tasks x
        LEFT JOIN public.deals d ON d.id = x.deal_id AND d.tenant_id = _tenant
        LEFT JOIN public.clients c ON c.id = d.contact_client_id AND c.tenant_id = _tenant
        WHERE x.tenant_id = _tenant AND x.user_id = _member_user_id
          AND x.status::text IN ('pending', 'in_progress')
        ORDER BY x.due_date ASC NULLS LAST, x.created_at DESC NULLS LAST, x.id LIMIT 50) w;

  SELECT count(*) INTO _n_clients FROM (
    SELECT c.id FROM public.clients c
    WHERE c.tenant_id = _tenant AND c.assigned_coach_user_id = _member_user_id
      AND c.status <> 'archived' AND c.merged_into_contact_id IS NULL
    UNION ALL
    SELECT c.id FROM public.clients c
    WHERE c.tenant_id = _tenant AND c.lead_owner_user_id = _member_user_id
      AND c.status <> 'archived' AND c.merged_into_contact_id IS NULL) n;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'label', w.label, 'relation', w.relation, 'updated_at', w.updated_at)
           ORDER BY w.updated_at DESC NULLS LAST, w.id, w.relation), '[]'::jsonb) INTO _clients
  FROM (SELECT r.* FROM (
          SELECT c.id, c.updated_at, 'assigned'::text AS relation,
                 coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),nullif(c.entity_name,''),'Client not recorded') AS label
          FROM public.clients c
          WHERE c.tenant_id = _tenant AND c.assigned_coach_user_id = _member_user_id
            AND c.status <> 'archived' AND c.merged_into_contact_id IS NULL
          UNION ALL
          SELECT c.id, c.updated_at, 'lead_owner'::text,
                 coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),nullif(c.entity_name,''),'Client not recorded')
          FROM public.clients c
          WHERE c.tenant_id = _tenant AND c.lead_owner_user_id = _member_user_id
            AND c.status <> 'archived' AND c.merged_into_contact_id IS NULL) r
        ORDER BY r.updated_at DESC NULLS LAST, r.id, r.relation LIMIT 50) w;

  SELECT count(*) INTO _n_deals FROM public.deals d
  WHERE d.tenant_id = _tenant AND d.owner_user_id = _member_user_id AND d.status = 'open';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'status', w.status,
             'value_cents', w.value_cents, 'currency', w.currency, 'expected_close_date', w.expected_close_date,
             'version', w.version, 'client_id', w.client_id, 'client_label', w.client_label)
           ORDER BY w.expected_close_date ASC NULLS LAST, w.created_at DESC, w.id), '[]'::jsonb) INTO _deals
  FROM (SELECT d.id, d.title, d.status, d.value_cents, d.currency, d.expected_close_date, d.created_at, d.version,
               c.id AS client_id,
               CASE WHEN c.id IS NULL THEN NULL ELSE coalesce(nullif(btrim(concat_ws(' ',c.first_name,c.last_name)),''),
                 nullif(c.entity_name,''),'Client not recorded') END AS client_label
        FROM public.deals d
        LEFT JOIN public.clients c ON c.id = d.contact_client_id AND c.tenant_id = _tenant
        WHERE d.tenant_id = _tenant AND d.owner_user_id = _member_user_id AND d.status = 'open'
        ORDER BY d.expected_close_date ASC NULLS LAST, d.created_at DESC, d.id LIMIT 50) w;

  SELECT count(*) INTO _n_approvals FROM public.paige_pending_approvals a
  WHERE a.tenant_id = _tenant AND a.assigned_to_user_id = _member_user_id
    AND a.status IN ('pending', 'changes_requested', 'escalated');
  -- Most urgent first, as the approval queue orders them: priority, then the SLA, then oldest.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'kind', w.kind, 'summary', w.summary,
             'status', w.status, 'created_at', w.created_at)
           ORDER BY w.priority ASC NULLS LAST, w.sla_due_at ASC NULLS LAST, w.created_at ASC, w.id), '[]'::jsonb) INTO _approvals
  FROM (SELECT a.id, coalesce(nullif(btrim(a.category),''), a.type) AS kind,
               nullif(left(btrim(a.summary), 140), '') AS summary, a.status, a.created_at, a.priority, a.sla_due_at
        FROM public.paige_pending_approvals a
        WHERE a.tenant_id = _tenant AND a.assigned_to_user_id = _member_user_id
          AND a.status IN ('pending', 'changes_requested', 'escalated')
        ORDER BY a.priority ASC NULLS LAST, a.sla_due_at ASC NULLS LAST, a.created_at ASC, a.id LIMIT 50) w;

  SELECT count(*) INTO _n_mailboxes FROM public.channel_connectors m
  WHERE m.tenant_id = _tenant AND m.mailbox_owner_user_id = _member_user_id
    AND m.status = 'active' AND m.active;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'channel', w.channel_type, 'provider', w.provider,
             'mailbox_class', w.mailbox_class, 'label', w.label, 'address', w.address)
           ORDER BY w.created_at ASC, w.id), '[]'::jsonb) INTO _mailboxes
  FROM (SELECT m.id, m.channel_type, m.provider, m.mailbox_class, m.created_at,
               coalesce(nullif(btrim(m.display_name),''), nullif(btrim(m.provider),''), 'Connected mailbox') AS label,
               nullif(lower(btrim(m.from_address)),'') AS address
        FROM public.channel_connectors m
        WHERE m.tenant_id = _tenant AND m.mailbox_owner_user_id = _member_user_id
          AND m.status = 'active' AND m.active
        ORDER BY m.created_at ASC, m.id LIMIT 50) w;

  RETURN jsonb_build_object(
    'ok', true,
    'member', jsonb_build_object(
      'user_id', _member_user_id,
      'display_name', coalesce((SELECT nullif(btrim(p.full_name),'') FROM public.profiles p
                                WHERE p.user_id = _member_user_id), 'Teammate'),
      'role', _target.role::text,
      'status', _target.status,
      'team_hub_access', _target.team_hub_access),
    'holdings', jsonb_build_object(
      'work', _work, 'crm_tasks', _tasks, 'clients', _clients, 'deals', _deals,
      'approvals', _approvals, 'mailboxes', _mailboxes),
    'counts', jsonb_build_object(
      'work', _n_work, 'crm_tasks', _n_tasks, 'clients', _n_clients, 'deals', _n_deals,
      'approvals', _n_approvals, 'mailboxes', _n_mailboxes));
END;
$function$;
REVOKE ALL ON FUNCTION public.team_member_holdings(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_member_holdings(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.team_member_holdings(uuid, uuid) IS
  'Read-only departure review: the open work, CRM tasks, client relationships, deals, assigned '
  'approvals and connected mailboxes one teammate holds in the caller''s active workspace, each row with '
  'the version its existing owner writer needs for a hand-over. Owner: any non-owner seat; admin: '
  'members only; never oneself. Lists capped at 50; counts are true totals.';

-- ── L. The invitation carries Team conversations ─────────────────────────────────────────────────
-- Settings → Team's invite path (solo-team-invitations -> create_solo_team_invite) gains one optional
-- argument, _team_hub_access boolean DEFAULT true, so every existing caller (the edge function's six
-- named arguments, resend's positional call, the proofs) is unaffected. The old six-argument signature
-- is DROPPED rather than overloaded: PostgREST resolves by argument names, and a call naming six would
-- match both. Re-emitted from production (2026-10-26) verbatim except the lines marked EXP08.
-- Both acceptance paths copy the choice onto the seat in the statement that creates it, BEFORE the
-- AFTER arrival trigger runs: accept_solo_team_invite (the supported path), and accept_tenant_invite's
-- generic branch, which still accepts a kind = 'team' token directly — without this a switched-off
-- invitee could take the legacy door and arrive with Team conversations on.
DROP FUNCTION IF EXISTS public.create_solo_team_invite(uuid, uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION public.create_solo_team_invite(_actor uuid, _expected_tenant_id uuid, _email text, _permission text DEFAULT 'member'::text, _job_title text DEFAULT NULL::text, _responsibilities text DEFAULT NULL::text, _team_hub_access boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _tenant uuid;
  _token text;
  _row public.tenant_invite_tokens;
BEGIN
  _tenant := public.solo_team_invite_authority(_actor, _expected_tenant_id);

  IF lower(trim(_permission)) NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'team invitations may grant only Admin or Member';
  END IF;
  IF NULLIF(lower(trim(_email)), '') IS NULL OR trim(_email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'a valid email address is required';
  END IF;
  IF char_length(COALESCE(trim(_job_title), '')) > 120 OR char_length(COALESCE(trim(_responsibilities), '')) > 2000 THEN
    RAISE EXCEPTION 'work profile is too long';
  END IF;
  -- EXP08 lifecycle: the invitation's Team conversations choice. Omitted means on, as before.
  IF _team_hub_access IS NULL THEN
    RAISE EXCEPTION 'say whether team conversations are on or off for this invitation';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    JOIN auth.users au ON au.id = tm.user_id
    WHERE tm.tenant_id = _tenant AND lower(au.email) = lower(trim(_email))
  ) THEN
    RAISE EXCEPTION 'this person already belongs to the workspace';
  END IF;

  -- One live invitation per tenant/email. Replacing a pending invite makes its
  -- previous token unusable before the new token is returned.
  UPDATE public.tenant_invite_tokens
  SET revoked_at = now(), updated_at = now()
  WHERE tenant_id = _tenant AND kind = 'team'
    AND lower(email) = lower(trim(_email))
    AND uses = 0 AND revoked_at IS NULL AND expires_at > now();

  _token := replace(replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', '');
  INSERT INTO public.tenant_invite_tokens
    (tenant_id, token, kind, default_role, created_by, expires_at, max_uses, email, job_title, responsibilities,
     team_hub_access)
  VALUES
    (_tenant, _token, 'team', lower(trim(_permission))::public.tenant_role, _actor,
     now() + interval '7 days', 1, lower(trim(_email)), NULLIF(trim(_job_title), ''), NULLIF(trim(_responsibilities), ''),
     _team_hub_access)
  RETURNING * INTO _row;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_invite', 'team_invite_created', _row.id,
          jsonb_build_object('tenant_id', _tenant, 'permission', lower(trim(_permission)),
                             'team_hub_access', _team_hub_access));
  -- `tenant_id` is returned so the caller can prove the invitation landed where it asked. A screen
  -- that sent workspace A and is handed back workspace B has been redirected, and should say so
  -- rather than report a success it cannot vouch for.
  RETURN jsonb_build_object('id', _row.id, 'token', _token, 'email', _row.email,
                            'expires_at', _row.expires_at, 'tenant_id', _tenant,
                            'team_hub_access', _row.team_hub_access);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_solo_team_invite(uuid, uuid, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_solo_team_invite(uuid, uuid, text, text, text, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.resend_solo_team_invite(_actor uuid, _expected_tenant_id uuid, _invite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _tenant uuid;
  _old public.tenant_invite_tokens;
BEGIN
  _tenant := public.solo_team_invite_authority(_actor, _expected_tenant_id);

  -- `tenant_id = _tenant` is what makes an invitation in another workspace invisible here rather
  -- than merely forbidden: a resend cannot reach across a workspace boundary even by id.
  SELECT * INTO _old FROM public.tenant_invite_tokens
  WHERE id = _invite_id AND tenant_id = _tenant AND kind = 'team' FOR UPDATE;
  IF _old.id IS NULL THEN RAISE EXCEPTION 'team invitation not found'; END IF;
  IF _old.uses > 0 THEN RAISE EXCEPTION 'an accepted invitation cannot be resent'; END IF;
  UPDATE public.tenant_invite_tokens SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() WHERE id = _old.id;
  -- The re-entry carries the SAME proved workspace, so a resend can never resolve differently from
  -- the create it delegates to. EXP08 lifecycle: and the same Team conversations choice, which the
  -- new parameter's default would otherwise silently turn back on.
  RETURN public.create_solo_team_invite(_actor, _tenant, _old.email, _old.default_role::text, _old.job_title, _old.responsibilities,
                                        _old.team_hub_access);
END;
$function$;
REVOKE ALL ON FUNCTION public.resend_solo_team_invite(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resend_solo_team_invite(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.accept_solo_team_invite(_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _actor_email text;
  _actor_email_confirmed_at timestamptz;
  _invite public.tenant_invite_tokens;
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  SELECT email, email_confirmed_at INTO _actor_email, _actor_email_confirmed_at FROM auth.users WHERE id = _actor;
  SELECT * INTO _invite FROM public.tenant_invite_tokens
  WHERE token = _token AND kind = 'team' FOR UPDATE;
  IF _invite.id IS NULL THEN RAISE EXCEPTION 'team invitation not found'; END IF;
  IF _invite.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'team invitation has been revoked'; END IF;
  IF _invite.expires_at <= now() THEN RAISE EXCEPTION 'team invitation has expired'; END IF;
  IF _invite.uses > 0 OR (_invite.max_uses IS NOT NULL AND _invite.uses >= _invite.max_uses) THEN
    RAISE EXCEPTION 'team invitation has already been accepted';
  END IF;
  -- Identity comes from the authenticated subject's stored account, never browser email or metadata.
  IF _actor_email_confirmed_at IS NULL
     OR NULLIF(btrim(_actor_email), '') IS NULL
     OR NULLIF(btrim(_invite.email), '') IS NULL
     OR lower(btrim(_invite.email)) <> lower(btrim(_actor_email)) THEN
    RAISE EXCEPTION 'team invitation belongs to a different email address' USING ERRCODE = '42501';
  END IF;
  IF _invite.default_role NOT IN ('admin'::public.tenant_role, 'member'::public.tenant_role) THEN
    RAISE EXCEPTION 'team invitation has an unsupported permission';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = _invite.tenant_id AND tm.user_id = _actor
  ) THEN
    RAISE EXCEPTION 'this account already belongs to the workspace';
  END IF;

  -- EXP08 lifecycle: the invitation's Team conversations choice lands in the same statement that
  -- creates the seat, so the AFTER arrival trigger (team_hub_seat_started) already sees it and a
  -- switched-off contractor never joins a team channel.
  INSERT INTO public.tenant_members
    (tenant_id, user_id, role, status, is_owner, invited_at, joined_at, job_title, responsibilities, team_hub_access)
  VALUES
    (_invite.tenant_id, _actor, _invite.default_role, 'active', false, _invite.created_at, now(),
     _invite.job_title, _invite.responsibilities, _invite.team_hub_access);

  UPDATE public.tenant_invite_tokens
  SET uses = uses + 1, last_used_at = now(), updated_at = now()
  WHERE id = _invite.id AND uses = 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'team invitation was already accepted'; END IF;

  UPDATE public.profiles SET active_tenant_id = _invite.tenant_id WHERE user_id = _actor;
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_invite', 'team_invite_accepted', _invite.id,
          jsonb_build_object('tenant_id', _invite.tenant_id, 'permission', _invite.default_role::text,
                             'team_hub_access', _invite.team_hub_access));
  RETURN _invite.tenant_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_solo_team_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_solo_team_invite(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_tenant_invite(_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _tok public.tenant_invite_tokens;
  _email text;
  _email_confirmed_at timestamptz;
  _full text;
  _first text;
  _last text;
  _client_id uuid;
  _existing_tenant uuid;
  _tenant_owner uuid;
  _has_active_owner boolean;   -- #227 Layer-2 shell-gate
  _minter_ok boolean;          -- #227 Layer-2 shell-gate
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'must be signed in to accept an invite';
  END IF;

  SELECT * INTO _tok FROM public.tenant_invite_tokens WHERE token = _token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite token not found'; END IF;
  IF _tok.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'invite has been revoked'; END IF;
  IF _tok.expires_at <= now() THEN RAISE EXCEPTION 'invite has expired'; END IF;
  IF _tok.max_uses IS NOT NULL AND _tok.uses >= _tok.max_uses THEN
    RAISE EXCEPTION 'invite has reached its usage limit';
  END IF;

  -- Solo Team tokens are also reachable through this legacy RPC. Enforce the same recipient
  -- boundary before any membership, role, profile or token write. Other invite kinds retain
  -- their existing eligibility and acceptance behavior.
  IF _tok.kind = 'team' THEN
    SELECT email, email_confirmed_at INTO _email, _email_confirmed_at
    FROM auth.users WHERE id = _uid;
    IF _email_confirmed_at IS NULL
       OR NULLIF(btrim(_email), '') IS NULL
       OR NULLIF(btrim(_tok.email), '') IS NULL
       OR lower(btrim(_tok.email)) <> lower(btrim(_email)) THEN
      RAISE EXCEPTION 'team invitation belongs to a different email address' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _tok.kind = 'consumer' THEN
    -- E09_CONSUMER_INVITE_INTEGRITY_V1
    SELECT email, email_confirmed_at INTO _email, _email_confirmed_at
      FROM auth.users WHERE id = _uid;
    IF NULLIF(btrim(_tok.email), '') IS NULL
       OR _email_confirmed_at IS NULL
       OR NULLIF(btrim(_email), '') IS NULL
       OR lower(btrim(_tok.email)) <> lower(btrim(_email)) THEN
      RAISE EXCEPTION 'portal invitation belongs to a different verified recipient' USING ERRCODE = '42501';
    END IF;
    -- Historic consumer invites may have max_uses=NULL. They still grant once.
    IF COALESCE(_tok.uses, 0) <> 0 OR _tok.last_used_at IS NOT NULL THEN
      RAISE EXCEPTION 'portal invitation has already been accepted' USING ERRCODE = '42501';
    END IF;
    IF _tok.contact_id IS NULL THEN
      RAISE EXCEPTION 'portal invitation requires an explicit client relationship' USING ERRCODE = '42501';
    END IF;

    -- Lock the exact canonical contact; never fall back to another contact or
    -- create a duplicate CRM record when the invite binding is stale.
    SELECT c.id INTO _client_id FROM public.clients c
      WHERE c.id = _tok.contact_id AND c.tenant_id = _tok.tenant_id
        AND c.status = 'active' AND c.merged_into_contact_id IS NULL
        AND (c.linked_user_id IS NULL OR c.linked_user_id = _uid)
        AND EXISTS (SELECT 1 FROM public.client_contact_methods cm
          WHERE cm.client_id = c.id AND cm.tenant_id = c.tenant_id AND cm.kind = 'email'
            AND cm.match_key = public.contact_method_match_key('email', _tok.email))
      FOR UPDATE OF c;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'portal invitation client relationship is no longer available' USING ERRCODE = '42501';
    END IF;
    -- Keep one canonical relationship per login in each business.
    -- Other businesses retain their own original relationship authorization.
    IF EXISTS (SELECT 1 FROM public.clients c
      WHERE c.linked_user_id = _uid AND c.tenant_id = _tok.tenant_id
        AND c.id <> _client_id) THEN
      RAISE EXCEPTION 'portal identity requires relationship access reconciliation' USING ERRCODE = '42501';
    END IF;

    PERFORM 1 FROM public.tenants WHERE id = _tok.tenant_id AND status = 'active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501'; END IF;
    IF _tok.expires_at <= pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'invite has expired'; END IF;
    UPDATE public.clients SET linked_user_id = _uid,
      onboarding_stage = COALESCE(onboarding_stage, 'invited'), updated_at = now()
      WHERE id = _client_id AND tenant_id = _tok.tenant_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'client')
      ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
      VALUES (_uid, 'client_portal', 'consumer_invite_accepted', _tok.id,
        jsonb_build_object('tenant_id', _tok.tenant_id, 'client_id', _client_id,
          'actor_user_id', _uid, 'via', 'accept_tenant_invite'));
    -- E09_CUSTOMER_ENTRY_V1: commit the same native token and audit; leave
    -- profiles.active_tenant_id and all business/staff membership untouched.
    UPDATE public.tenant_invite_tokens SET uses = uses + 1, last_used_at = now() WHERE id = _tok.id;
    RETURN _tok.tenant_id;

  ELSIF _tok.kind = 'subaccount_owner' THEN
    SELECT email INTO _email FROM auth.users WHERE id = _uid;
    IF _tok.email IS NOT NULL AND lower(_tok.email) <> lower(COALESCE(_email, '')) THEN
      RAISE EXCEPTION 'This invite was sent to a different email address. Accept it while signed in as %', _tok.email;
    END IF;

    -- #227 HOLE#1 Layer-2 SHELL-GATE: establish ownership ONLY on a shell child that has
    -- no active owner yet, AND only when the minter is (still) agency-over-child / platform.
    SELECT EXISTS (
      SELECT 1 FROM public.tenant_members
       WHERE tenant_id = _tok.tenant_id AND is_owner = true AND status = 'active'
    ) INTO _has_active_owner;

    SELECT ( public.is_platform_owner(_tok.created_by)
             OR public.agency_can_manage_child(_tok.tenant_id, _tok.created_by) )
      INTO _minter_ok;

    IF NOT _has_active_owner AND _minter_ok THEN
      -- LEGITIMATE first owner of the shell child, born correct — is_owner=true +
      -- role='owner' in lockstep (guard-exempt: current_user='postgres' inside definer).
      INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at)
      VALUES (_tok.tenant_id, _uid, 'owner'::public.tenant_role, 'active', true, now())
      ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET is_owner  = true,
            role      = 'owner'::public.tenant_role,
            status    = 'active',
            joined_at = COALESCE(public.tenant_members.joined_at, now()),
            updated_at = now();

      -- Display-only owner_user_id parity: set ONLY when still unset (never overwrite a
      -- real owner_user_id; Parts B/D reconcile the historically-leaked pointer).
      UPDATE public.tenants
         SET owner_user_id = _uid, updated_at = now()
       WHERE id = _tok.tenant_id AND owner_user_id IS NULL;

      INSERT INTO public.paige_audit_log
        (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
      VALUES (_uid, 'owner', 'tenant:subaccount_owner_established', 'tenant_member', _uid,
              jsonb_build_object('tenant_id', _tok.tenant_id, 'lane', 'auto', 'via', 'accept_tenant_invite'),
              _tok.tenant_id);
    ELSE
      -- Already-owned / peer child, or minter no longer authorized → plain admin seat.
      -- is_owner pinned FALSE on fresh insert; ON CONFLICT preserves an existing owner
      -- (lockstep) and NEVER raises is_owner — no second silent co-owner.
      INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at)
      VALUES (_tok.tenant_id, _uid, 'admin'::public.tenant_role, 'active', false, now())
      ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET role = (CASE WHEN public.tenant_members.role = 'owner'::public.tenant_role
                         THEN 'owner'::public.tenant_role
                         ELSE 'admin'::public.tenant_role END),
            status = 'active',
            joined_at = COALESCE(public.tenant_members.joined_at, now()),
            updated_at = now();
    END IF;

  ELSIF _tok.kind = 'agency_team' THEN
    SELECT email INTO _email FROM auth.users WHERE id = _uid;
    IF _tok.email IS NOT NULL AND lower(_tok.email) <> lower(COALESCE(_email, '')) THEN
      RAISE EXCEPTION 'This invite was sent to a different email address. Accept it while signed in as %', _tok.email;
    END IF;
    IF _tok.agency_role IS NULL OR _tok.agency_role NOT IN
       ('agency_admin','agency_manager','agency_biller','agency_specialist','agency_viewer') THEN
      RAISE EXCEPTION 'This agency invite is missing a valid role. Ask the agency to resend it.';
    END IF;

    DELETE FROM public.agency_team_members
     WHERE agency_tenant_id = _tok.tenant_id
       AND user_id IS NULL
       AND email IS NOT NULL
       AND lower(email) = lower(COALESCE(_email, ''));

    UPDATE public.agency_team_members
       SET agency_role = _tok.agency_role,
           status = 'active',
           email = COALESCE(email, _email),
           joined_at = COALESCE(joined_at, now()),
           updated_at = now()
     WHERE agency_tenant_id = _tok.tenant_id AND user_id = _uid;
    IF NOT FOUND THEN
      INSERT INTO public.agency_team_members
        (agency_tenant_id, user_id, email, agency_role, status, invited_by, invited_at, joined_at)
      VALUES
        (_tok.tenant_id, _uid, _email, _tok.agency_role, 'active', _tok.created_by, _tok.created_at, now());
    END IF;

  ELSE
    -- SECURITY (Tier Rail Phase A): a generic staff/'team' invite may only grant
    -- tenant_members on a NON-agency tenant.
    IF (SELECT account_type FROM public.tenants WHERE id = _tok.tenant_id)
         IN ('agency','enterprise') THEN
      RAISE EXCEPTION 'Staff invites cannot grant access on an agency or enterprise account. Use an agency team invite instead.';
    END IF;

    -- FIX-1 (§9): an invite NEVER mints or elevates ownership. Owner elevation is
    -- EXCLUSIVELY grant_co_owner(). Fresh seat: is_owner pinned false; any owner
    -- default_role coerced to 'admin' (keeps role/is_owner lockstep). ON CONFLICT:
    -- is_owner and role left UNTOUCHED — see §13 NOTE below.
    -- EXP08 lifecycle: a Solo Team invitation carries its Team conversations choice onto the seat in
    -- the same statement that creates it, so the arrival trigger never joins a switched-off person to
    -- anything. Every other kind arrives with it on, as before. On a conflict an invitation can
    -- switch it off, never on. (A suspended seat stays suspended: enforce_tenant_member_consent.)
    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at, team_hub_access)
    VALUES (
      _tok.tenant_id, _uid,
      (CASE WHEN _tok.default_role = 'owner'::public.tenant_role
            THEN 'admin'::public.tenant_role ELSE _tok.default_role END),
      'active', false, now(), (_tok.kind <> 'team' OR _tok.team_hub_access))
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET status = 'active',
          joined_at = COALESCE(public.tenant_members.joined_at, now()),
          updated_at = now(),
          team_hub_access = public.tenant_members.team_hub_access AND EXCLUDED.team_hub_access;
    -- §13 NOTE (deliberate deviation from the literal "force is_owner=false on the ON
    -- CONFLICT"): the conflict path intentionally does NOT write is_owner or role. It
    -- cannot ESCALATE (a returning member keeps their existing bit; only grant_co_owner
    -- raises it) and it must NOT force-clear it, which would DEMOTE / last-owner-strip a
    -- legitimate owner who re-accepts a staff invite. Escalation is fully closed at the
    -- fresh-INSERT (pins false) + the create-side owner-token rejection.
  END IF;

  UPDATE public.tenant_invite_tokens SET uses = uses + 1, last_used_at = now() WHERE id = _tok.id;
  UPDATE public.profiles SET active_tenant_id = _tok.tenant_id WHERE user_id = _uid;

  RETURN _tok.tenant_id;
END $function$;
REVOKE ALL ON FUNCTION public.accept_tenant_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_tenant_invite(text) TO authenticated, service_role;

-- ── M. Every grant that reads a membership requires an ACTIVE one ────────────────────────────────
-- Found by review and confirmed on production pg_policies (2026-10-26): of every policy that joins
-- tenant_members, exactly these five carried no status filter, so a suspended (or pending, or revoked)
-- seat kept reading and editing the workspace's invoices, and a suspended admin kept writing its
-- agreement versions. Each is altered in place (same name, command, roles and permissiveness), its
-- expression verbatim plus `tm.status = 'active'`. The restrictive sales_* guards on paige_invoices are
-- untouched and still apply on top. No policy helper function was found reading tenant_members without
-- an 'active' literal, so these five are the whole list.
ALTER POLICY tenant_members_select_invoices ON public.paige_invoices
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
                       WHERE tm.user_id = auth.uid() AND tm.status = 'active'));
ALTER POLICY tenant_members_insert_invoices ON public.paige_invoices
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
                            WHERE tm.user_id = auth.uid() AND tm.status = 'active'));
ALTER POLICY tenant_members_update_invoices ON public.paige_invoices
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_members tm
                       WHERE tm.user_id = auth.uid() AND tm.status = 'active'));
ALTER POLICY "Tenant members read own agreement versions" ON public.tenant_agreement_versions
  USING ((EXISTS (SELECT 1 FROM public.tenant_members tm
                  WHERE tm.tenant_id = tenant_agreement_versions.tenant_id AND tm.user_id = auth.uid()
                    AND tm.status = 'active'))
         OR public.is_platform_owner());
ALTER POLICY "Tenant owners/admins write own agreement versions" ON public.tenant_agreement_versions
  USING ((EXISTS (SELECT 1 FROM public.tenant_members tm
                  WHERE tm.tenant_id = tenant_agreement_versions.tenant_id AND tm.user_id = auth.uid()
                    AND tm.status = 'active'
                    AND tm.role = ANY (ARRAY['owner'::public.tenant_role, 'admin'::public.tenant_role])))
         OR public.is_platform_owner())
  WITH CHECK ((EXISTS (SELECT 1 FROM public.tenant_members tm
                       WHERE tm.tenant_id = tenant_agreement_versions.tenant_id AND tm.user_id = auth.uid()
                         AND tm.status = 'active'
                         AND tm.role = ANY (ARRAY['owner'::public.tenant_role, 'admin'::public.tenant_role])))
              OR public.is_platform_owner());

COMMIT;
