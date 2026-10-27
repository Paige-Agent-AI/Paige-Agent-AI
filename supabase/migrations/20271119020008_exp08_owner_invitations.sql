-- ============================================================================
-- EXP08 co-owners and entity owners, increment I1 — OWNER INVITATIONS.
-- Contract: docs/delivery/exp08-co-owners-entity-owners-contract.md, round 7 (design owner-approved
-- 2026-10-27), §5.1, §5.2, §5.3 and peek_tenant_invite (§5.5). Applies to EVERY Solo account (§63).
-- Owner ruling R16 (2026-10-27): platform operators keep archive, restore, delete, revoke_platform_access
-- and admin-delete-user on Solo accounts as shipped; this file touches none of them.
--
-- definer-anon-exempt: peek_tenant_invite is re-created here (its result gains one column, which
-- CREATE OR REPLACE cannot do) and keeps its grant to anon: it is the pre-auth /join reader, keyed
-- on the unguessable token, returning the tenant's public brand and that one invitation's details.
-- The one new field is the legal owner's display NAME on an owner invitation (contract §5.5, stated
-- deliberate exposure); never the ownership interest or the representative. No other function in
-- this file is granted to anon or PUBLIC.
--
-- OWNER RULINGS THIS BUILDS ON (Antonio; contract §0): R1 the account holder can choose any role on
-- an invitation including Owner, and nobody else can choose Owner; R2 the account holder is
-- tenants.owner_user_id holding an active owner seat; R3 an owner can be an entity represented by an
-- individual; R4 only the account holder adds or removes owners; R14 (2026-10-27) admins keep
-- inviting admins and members, "keep as today".
--
-- WHAT CHANGES (each re-emitted function is production's body verbatim except the lines marked
-- "EXP08 owners (20271119020008)"; supabase/tests/exp08_owner_invitations.sql puts those lines back
-- and compares byte for byte against production's md5(prosrc), read 2026-10-27):
--   Schema   tenant_business_owners: UNIQUE (tenant_id, id); owner_seat_vacant_since.
--            tenant_members.business_owner_id (composite FK, NO ACTION; only on an owner seat; one
--            seat per legal owner). tenant_invite_tokens.business_owner_id (composite FK, SET NULL of
--            that column only; only on a team owner invitation; one live invitation per legal owner).
--            tenant_invite_tokens.business_owner_removed_at (set when that legal owner is deleted, so
--            the unlinked invitation is never resent as a personal owner invitation).
--            A linked legal owner is never an individual. Deleting a legal owner revokes and marks its
--            invitations first. No new table; no backfill (R8).
--   Guards   guard_tenant_invite_token_identity (new, SECURITY INVOKER): an authenticated writer may
--            insert only its own non-owner tokens, may change ONLY revoked_at (NULL -> a value, once;
--            the first value is kept), and may not touch an owner token at all. Service role
--            (auth.uid() IS NULL) and postgres-owned code are exempt; the platform owner is NOT.
--            Under any JWT (postgres-owned code included), for every kind that seats a person in
--            tenant_members (every kind but consumer and agency_team), an INSERT is refused for an
--            address with a live owner invitation in the same business, and its address must be
--            stored trimmed and in lower case.
--            _tenant_member_owner_invitation_waiting (new, round 4; BEFORE INSERT OR UPDATE OF
--            tenant_id, user_id on tenant_members, round 5): a non-owner seat newly written for a person
--            is refused while their address has an owner invitation in that business that accept would
--            still honour, whoever writes the seat (service role and postgres-owned code included).
--            guard_tenant_member_owner_flag also refuses any client write of business_owner_id.
--            guard_tenant_owner_only_columns becomes SECURITY INVOKER; the platform owner keeps
--            billing/hierarchy but no longer moves owner_user_id directly; the #227 carve-out now also
--            requires postgres-owned code; an owner-recovery branch (flag + postgres + super admin)
--            is added for the later recovery increment. Every owner_user_id change is audited.
--   Invites  create_solo_team_invite takes Owner (account holder only, Solo account, team
--            conversations on, a person or one non-individual legal owner, inline records allowed);
--            resend/revoke/archive of an owner invitation are the account holder's, and resend refuses
--            one whose legal owner was deleted; accept_solo_team_invite seats an owner after re-checking,
--            with the tenant row and the sender's seat locked FOR SHARE, that the sender is STILL the
--            account holder and the legal owner's seat is still open, and names the representative;
--            accept_tenant_invite REFUSES an owner token (it used to turn it into Admin silently);
--            create_tenant_invite_token refuses Owner for every kind and caller, with a sentence that
--            is true for the account it is asked on (agency/enterprise vs any other).
--   Read     peek_tenant_invite adds business_owner_display (only while the invitation is valid).
--
-- §58, NAMED. Capabilities removed or changed, each against production 2026-10-27:
--   * A tenant owner could mint an owner-role token through create_tenant_invite_token (FIX-1 let any
--     active owner, and the platform owner, do it). Refused now for everyone. Production holds ZERO
--     owner-role tokens of any kind (read 2026-10-27), and no such token ever produced an owner:
--     accept_solo_team_invite refused it and accept_tenant_invite coerced it to Admin.
--   * VISIBLE ON A SHIPPED SCREEN: the mounted Agency Team screen (src/agency/team.tsx INVITE_ROLES
--     offers Owner; src/agency/data/useAgencyPeople.ts sends _default_role 'owner' to
--     create_tenant_invite_token) used to report "Invite created" for Owner. That invitation never
--     produced an owner (the join page refused it as an unsupported permission; the legacy accept
--     turned it into an Admin seat on a sub-account and refused it on an agency account). Now the
--     mint is refused, and the person reads, on an agency or enterprise account:
--       "Agency accounts add Admins and Members. An owner is added by the account holder of a
--        business account, from its Settings → Team."   (Enterprise accounts: "Enterprise accounts …")
--     in a platform company workspace: "Owner invitations aren't available for this account."
--     and on any other account (an agency manager working inside a sub-account, or a direct call):
--       "Owners are added only by this business's account holder, from Settings → Team. You can
--        invite an Admin or Member here."
--     The Owner option itself stays on that screen in this increment: removing a shipped option is an
--     owner decision (§58), owed for I3.
--   * NEW REFUSAL FOR ADMINS AND CO-OWNERS: while an address has a live (unused, unrevoked, unexpired)
--     owner invitation in a business, nobody but the account holder creates another invitation to it
--     there, on exactly these paths: Settings → Team's create_solo_team_invite (which would replace
--     it), and any INSERT into tenant_invite_tokens under a person's JWT of a kind that seats someone
--     in tenant_members (every kind but consumer and agency_team: team, subaccount_owner, and any
--     other kind accept_tenant_invite's generic branch takes), whether a direct row INSERT or
--     postgres-owned code such as create_tenant_invite_token. The address is compared trimmed and
--     case-insensitively, and such an INSERT must store it trimmed and in lower case (one browser
--     direct insert of " Pat@X " would otherwise survive the holder's withdraw query). They read:
--     "There's already an owner invitation for this address. Only the account holder can change it."
--     (the token INSERT paths add ", from Settings → Team"). The account holder's own Settings → Team
--     invitation replaces it as before. The token guard does not cover the service role
--     (send-portal-invite, agency-invite-member: auth.uid() IS NULL, exempt throughout that guard), an
--     invitation that already existed BEFORE the owner invitation (the holder's create withdraws live
--     team invitations to that address only, as production does), or one inserted with no address
--     or another address. Those can still be CREATED; since round 4 none of them can be USED by that
--     person, because the seat-side rule refuses the seat (next bullet).
--   * NEW REFUSAL AT ACCEPT (round 4, B1; narrowed round 5): while a person's address has an owner
--     invitation in a business that accept_solo_team_invite would still honour (sender still the
--     account holder, Solo account, legal owner's seat still open), no non-owner seat is written for
--     them there, on any of these paths: accept_tenant_invite
--     (its generic branch, which never compared addresses, and its sub-account-owner Admin path,
--     which compared one only when stored), accept_solo_team_invite for a non-owner invitation,
--     accept_invitation and the accept-invite edge function (public.invitations), and a grant such
--     as grant_tenant_member_role. The person reads "You have an owner invitation to <business>
--     waiting. Open that invitation to join as an owner. Nothing changed."; someone granting a seat to
--     them reads "This person has an owner invitation to <business> waiting, so they join by accepting
--     it. Only the account holder can change it, from Settings → Team. Nothing changed." (HINT
--     OWNER_INVITE_WAITING). A person who already has a seat there is not affected (their owner
--     invitation could not seat them anyway). Owner seats are not refused: the sub-account owner
--     path can still seat a new owner where the business has no active owner (the #227 residual).
--   * accept_tenant_invite turned an owner token into an Admin seat and reported success. It refuses.
--   * The sole active owner of a holderless tenant could set owner_user_id to themselves with a direct
--     client UPDATE (the #227 carve-out). Now only through postgres-owned code (accept_tenant_invite's
--     sub-account owner path, which is the carve-out's one real producer).
--   * A platform owner (super admin) JWT could UPDATE tenants.owner_user_id directly. Refused; owner
--     recovery (a later increment, R9) is the platform's only way to move it.
--   * A tenant admin could UPDATE any column of a pending invitation (default_role, agency_role,
--     contact_id, uses, expires_at, ...) or un-revoke one, and a platform owner could insert a token
--     with a forged created_by. Refused. Revoking (revoked_at NULL -> now) and DELETE of a non-owner
--     invitation stay allowed, as every browser caller uses them today.
--
-- §37, summarised (full inventory in the PR): browser token writers (WorkspaceSettingsPanel,
-- ContactPortalPanel, PortalInvitationManager) set only revoked_at; service-role writers
-- (send-portal-invite, agency-invite-member) are exempt by auth.uid() IS NULL; every postgres-owned
-- definer that writes tokens (create/resend/revoke/archive/accept_solo_team_invite,
-- accept_tenant_invite, create_tenant_invite_token, set_client_portal_access,
-- create_client_portal_invitation) has proowner = postgres on production (read 2026-10-27).
-- No browser or edge code writes tenants.owner_user_id. The only function on production that UPDATEs
-- it is accept_tenant_invite (pg_proc read 2026-10-27). Two more functions write it, by INSERT of a
-- NEW tenant only, EXECUTE service_role only, each leaving its own record: platform_grant_promotional_solo
-- (INSERT INTO tenants with owner_user_id; paige_audit_log row) and solo_beta_fulfill_checkout (through
-- provision_tenant_as; solo_beta_fulfillment_receipts row). They are exempt here (auth.uid() IS NULL,
-- and an INSERT is not an UPDATE of owner_user_id), not changed, and named for I2 (§5.4d).
-- create_tenant_invite_token producers send member/admin only, except the Agency Team Owner option
-- above. send-portal-invite gains the owner-token gate in this PR.
--
-- HONEST NOTES (§13).
--   * I1 makes owner invitations work in the DATABASE and at send-portal-invite. Settings → Team does
--     not offer Owner yet (I3; PAIGE is I4), and an owner invitation's email still reads as a team
--     invitation until I3's owner copy. One shipped screen DOES offer Owner: the Agency Team screen,
--     whose Owner choice now gets the plain refusal named in §58 above instead of "Invite created".
--   * Until I2 re-emits revoke_co_owner (which clears business_owner_id with is_owner), demoting a
--     seat that represents a LEGAL owner fails closed on the CHECK below: nothing changes. No such
--     seat exists on production, and none can be created from any shipped surface before I3.
--   * tenants.first_owner_seated_at (contract §5.1) is NOT added here: its only reader
--     (_tenant_never_owned) and its backfill are I2, and its trigger would add a tenants UPDATE to
--     every provisioning path for a marker nothing reads yet. It lands with them (DEFERRED to I2).
--   * Writers that clear is_owner are NOT all re-emitted to clear business_owner_id in the same
--     statement (contract §5.11, CHECK row): only the CHECK fails closed (case 7.13, interim). The
--     re-emission is DEFERRED to I2 with revoke_co_owner.
--   * accept_solo_team_invite does NOT stamp the legal owner record's updated_by with the invitee:
--     that column references auth.users with no ON DELETE action, so it would block deleting the
--     invitee's account (admin-delete-user, which platform operators keep, owner ruling 2026-10-27).
--     The audit row records who accepted. (An inline record created on the invitation carries the
--     account holder in created_by/updated_by, as every Setup-created record already does.)
--   * Setup's authored refusal for deleting a seated or invited legal owner is I2
--     (save_solo_setup_context). Until then a Setup delete of a record with a LIVE invitation revokes
--     that invitation (the safe direction), and a seated record cannot exist (above).
--   * RESIDUAL UNTIL I2, stated (review round 4, S2): a co-owner whose Setup access is owner_full can
--     withdraw or disable the account holder's invitation for a LEGAL owner through Setup
--     (save_solo_setup_context, unchanged here): deleting that legal owner's record, or saving the
--     owners list without it (which deletes it), revokes the invitation; retyping the record to an
--     individual makes the invitation refuse at accept ("that owner seat has changed"). Nothing is
--     granted to anyone that way, and a person-owner invitation is untouched, but it is a change to
--     an owner invitation by someone other than the account holder. I2's save_solo_setup_context
--     refusal closes it.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '2s';

-- INCUMBENT GUARD (precedent 20271108233000, 20271116100008). Every production function this file
-- replaces must still be the body it was written against, compared as a FINGERPRINT: md5 of prosrc
-- with LINE BREAKS KEPT, every other run of blanks (space, tab, CR, FF, VT) collapsed to one space, the
-- blanks on either side of each line break dropped, empty lines dropped and the ends trimmed. Comments
-- are KEPT (a marker such as E09_CONSUMER_INVITE_PEEK_V1 is part of the body), so any added, removed or
-- changed token, comment included, is refused; a re-indented body, trailing blanks, CRLF line ends or
-- blank lines are not. Line breaks are kept on purpose: collapsing them too would make "-- note" + a
-- new line + "stmt;" fingerprint the same as "-- note stmt;", a statement silently commented out (the
-- round-7 review found two such edits, one of them archive_solo_team_invite's authority check, that an
-- all-whitespace collapse let through). The fingerprints are computed from production's bodies (read
-- 2026-10-27). Every mismatch is collected and named in ONE error, so a reviewer sees all the drift at
-- once. A different body means another change landed first: refuse, compose and review, rather than
-- overwrite it.
--   peek_tenant_invite(text) has TWO accepted fingerprints, both read, both the same logic. Production's
--   (68d1971e) and the repository replay's (4c10ee1d): 20260713050000_invite_brand_cascade.sql (recorded
--   on production as git_ledger_reconciliation, so production never ran it; it ran 20260713030834, which
--   has no comment) adds three comment lines above "SELECT * INTO _rb", and 20271108120100 then patches
--   whichever body it finds with replace(). With comments removed the two are identical (fda7fafd on
--   both, read 2026-10-27). This file DROPs and re-creates peek_tenant_invite, so either is replaced whole.
--   The other nine replay to production's exact md5(prosrc) (rebuilt 2026-10-27 from every migration that
--   creates or patches them, in version order).
--   Limits, stated: a blank change INSIDE a string literal (two spaces in a message becoming one) passes;
--   blanks removed between two tokens ("a = b" to "a=b") and a line re-wrapped onto two lines are refused
--   (the safe direction).
-- exp08-owners-incumbent-guard:begin
DO $guard$
DECLARE r record; _have text; _drift text[] := '{}';
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.guard_tenant_member_owner_flag()', ARRAY['13b104130185c6963d98947bbd2a2031']),
    ('public.guard_tenant_owner_only_columns()', ARRAY['20e81a742bccbb8e60f1bdf4faeb6958']),
    ('public.create_solo_team_invite(uuid,uuid,text,text,text,text,boolean)', ARRAY['1c5f11389727ee9fba676e0ed37ed05d']),
    ('public.resend_solo_team_invite(uuid,uuid,uuid)', ARRAY['eee16ef2f4976bf5340ea6e54585d68e']),
    ('public.revoke_solo_team_invite(uuid,uuid,uuid)', ARRAY['591392dec7f1eac34bd6dfc3411fbd1c']),
    ('public.archive_solo_team_invite(uuid,uuid,uuid)', ARRAY['eb309e2e20473d29aa4adfe54c2db5f2']),
    ('public.accept_solo_team_invite(text)', ARRAY['98d289ee6c563d9c6b4b321a5fdc5693']),
    ('public.accept_tenant_invite(text)', ARRAY['83b20c6f99997b5299aa091458c4a3ff']),
    ('public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text)', ARRAY['4f70c379bb88be99cf36722dfe1c9e92']),
    ('public.peek_tenant_invite(text)', ARRAY['68d1971e48f8023f7657b13f92d0dc42', '4c10ee1d6db3235d261feaf5a8bd8858'])) v(sig, want) LOOP
    SELECT md5(btrim(regexp_replace(regexp_replace(p.prosrc, E'[ \\t\\r\\f\\v]*\\n[ \\t\\r\\f\\v\\n]*', E'\n', 'g'), E'[ \\t\\r\\f\\v]+', ' ', 'g'), E' \n')) INTO _have FROM pg_proc p WHERE p.oid = to_regprocedure(r.sig);
    IF _have IS NULL OR NOT (_have = ANY (r.want)) THEN
      _drift := _drift || format('%s (fingerprint %s, expected %s)', r.sig, COALESCE(_have, 'missing'), array_to_string(r.want, ' or '));
    END IF;
  END LOOP;
  IF cardinality(_drift) > 0 THEN
    RAISE EXCEPTION 'EXP08 owner invitations: % of 10 functions are not the body this migration replaces: %; another change landed first, so compose and review before applying',
      cardinality(_drift), array_to_string(_drift, '; ');
  END IF;
END $guard$;
-- exp08-owners-incumbent-guard:end

-- ── 5.1 Schema ────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_business_owners
  ADD CONSTRAINT tenant_business_owners_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE public.tenant_business_owners
  ADD COLUMN IF NOT EXISTS owner_seat_vacant_since timestamptz NULL;
COMMENT ON COLUMN public.tenant_business_owners.owner_seat_vacant_since IS
  'EXP08 owners: set when the seat that represented this legal owner ends (a later increment); NULL '
  'while represented or never seated. Team flows never write ownership_status, which is the legal fact.';

ALTER TABLE public.tenant_members ADD COLUMN IF NOT EXISTS business_owner_id uuid NULL;
ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_business_owner_fkey
  FOREIGN KEY (tenant_id, business_owner_id) REFERENCES public.tenant_business_owners (tenant_id, id)
  ON DELETE NO ACTION;
ALTER TABLE public.tenant_members
  ADD CONSTRAINT tenant_members_business_owner_only_on_owner_seat
  CHECK (business_owner_id IS NULL OR is_owner);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_members_one_seat_per_business_owner
  ON public.tenant_members (tenant_id, business_owner_id) WHERE business_owner_id IS NOT NULL;
COMMENT ON COLUMN public.tenant_members.business_owner_id IS
  'EXP08 owners: the legal owner (tenant_business_owners) this OWNER seat acts for, or NULL for an '
  'owner in their own right. A label on the seat; authority is still is_owner. Written only by trusted '
  'server code (trg_tenant_members_owner_guard).';

ALTER TABLE public.tenant_invite_tokens ADD COLUMN IF NOT EXISTS business_owner_id uuid NULL;
ALTER TABLE public.tenant_invite_tokens
  ADD CONSTRAINT tenant_invite_tokens_business_owner_fkey
  FOREIGN KEY (tenant_id, business_owner_id) REFERENCES public.tenant_business_owners (tenant_id, id)
  ON DELETE SET NULL (business_owner_id);
ALTER TABLE public.tenant_invite_tokens
  ADD CONSTRAINT tenant_invite_tokens_business_owner_only_on_owner_invite
  CHECK (business_owner_id IS NULL OR (kind = 'team' AND default_role = 'owner'::public.tenant_role));
CREATE UNIQUE INDEX IF NOT EXISTS tenant_invite_tokens_one_live_invite_per_business_owner
  ON public.tenant_invite_tokens (business_owner_id)
  WHERE business_owner_id IS NOT NULL AND uses = 0 AND revoked_at IS NULL;
COMMENT ON COLUMN public.tenant_invite_tokens.business_owner_id IS
  'EXP08 owners: on a team OWNER invitation, the legal owner the invitee will act for. One unused, '
  'unrevoked invitation per legal owner. Nulled (and the token revoked and marked first) if the record is deleted.';
ALTER TABLE public.tenant_invite_tokens ADD COLUMN IF NOT EXISTS business_owner_removed_at timestamptz NULL;
COMMENT ON COLUMN public.tenant_invite_tokens.business_owner_removed_at IS
  'EXP08 owners: set when the legal owner this invitation was for is deleted (its business_owner_id is '
  'then nulled by the FK). resend_solo_team_invite refuses such an invitation, so it is never reissued '
  'as an owner invitation for a person in their own right. Written only by postgres-owned code.';

-- ── 5.2 Helpers (no client EXECUTE: every caller is a postgres-owned definer function) ─────────────
-- A Solo-shell account: Standalone or Sub-account, and not a platform company workspace. The owner
-- rulings are for Solo accounts (contract §2), so every owner act checks this, recovery included.
CREATE OR REPLACE FUNCTION public._solo_shell_tenant(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants t
     WHERE t.id = _tenant
       AND t.account_type IN ('standalone', 'sub_account')
  ) AND NOT public.is_company_workspace(_tenant);
$function$;
REVOKE ALL ON FUNCTION public._solo_shell_tenant(uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public._solo_shell_tenant(uuid) IS
  'EXP08 owners: true iff the tenant is a Standalone or Sub-account and not a company workspace. '
  'No client EXECUTE; read by the owner functions as their owner.';

-- The account holder's state, evaluated in this order (contract §5.4a): archived; none (no pointer, or
-- a pointer at no auth.users row: there is no FK, and a deleted user can leave an orphaned seat);
-- working (is_tenant_account_holder); paused (the holder's owner seat is suspended, which in code only
-- billing does: solo_beta_sync_subscription); none (anything else). Owner ruling R13 (2026-10-27): a
-- billing-paused holder is STILL the account holder.
CREATE OR REPLACE FUNCTION public._tenant_account_holder_state(_tenant uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN t.archived_at IS NOT NULL THEN 'archived'
           WHEN t.owner_user_id IS NULL
                OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = t.owner_user_id) THEN 'none'
           WHEN public.is_tenant_account_holder(t.owner_user_id, t.id) THEN 'working'
           WHEN EXISTS (SELECT 1 FROM public.tenant_members m
                         WHERE m.tenant_id = t.id AND m.user_id = t.owner_user_id
                           AND m.is_owner = true AND m.status = 'suspended') THEN 'paused'
           ELSE 'none'
         END
    FROM public.tenants t
   WHERE t.id = _tenant;
$function$;
REVOKE ALL ON FUNCTION public._tenant_account_holder_state(uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public._tenant_account_holder_state(uuid) IS
  'EXP08 owners: archived | none | working | paused (contract §5.4a). No client EXECUTE.';

-- The ONE home for "only the account holder may do this owner act" and for which sentence the person
-- reads when they may not (contract §4.10). Returns quietly for the account holder. It never reads the
-- target of the act, so a refusal says nothing about whether the target exists (case 12).
-- Every refusal carries a stable HINT code, so the edge layer can recognise it without matching the
-- sentence (which names the business or the account holder).
CREATE OR REPLACE FUNCTION public._assert_tenant_account_holder(_actor uuid, _tenant uuid, _act text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _state text;
  _name text;
  _holder uuid;
  _holder_name text;
BEGIN
  IF public.is_tenant_account_holder(_actor, _tenant) THEN
    RETURN;
  END IF;
  SELECT t.name, t.owner_user_id INTO _name, _holder FROM public.tenants t WHERE t.id = _tenant;
  _state := public._tenant_account_holder_state(_tenant);
  IF _state = 'none' THEN
    RAISE EXCEPTION '% has no account holder right now, so no one can add owners or change another owner''s access. Contact the Paige team.',
      COALESCE(NULLIF(btrim(_name), ''), 'This business') USING ERRCODE = '42501', HINT = 'OWNER_NO_ACCOUNT_HOLDER';
  ELSIF _state = 'paused' AND _actor = _holder THEN
    RAISE EXCEPTION 'Your access to % is paused for billing, so you can''t add or change owners until it''s back. Nothing changed.',
      COALESCE(NULLIF(btrim(_name), ''), 'this business') USING ERRCODE = '42501', HINT = 'OWNER_HOLDER_PAUSED_SELF';
  ELSIF _state = 'paused' THEN
    SELECT NULLIF(btrim(p.full_name), '') INTO _holder_name FROM public.profiles p WHERE p.user_id = _holder LIMIT 1;
    RAISE EXCEPTION '%''s access is paused for billing, so no one can add owners or change another owner''s access until it''s back. Nothing changed.',
      COALESCE(_holder_name, 'The account holder') USING ERRCODE = '42501', HINT = 'OWNER_HOLDER_PAUSED';
  ELSIF _act = 'invitation' THEN
    RAISE EXCEPTION 'Only the account holder can change an owner invitation.' USING ERRCODE = '42501', HINT = 'OWNER_INVITATION_HOLDER_ONLY';
  ELSE
    RAISE EXCEPTION 'Only the account holder can add owners to this business.' USING ERRCODE = '42501', HINT = 'OWNER_HOLDER_ONLY';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public._assert_tenant_account_holder(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public._assert_tenant_account_holder(uuid, uuid, text) IS
  'EXP08 owners: returns for the account holder; otherwise raises the authored refusal for the '
  'tenant''s account-holder state (none / paused / working), HINT = a stable code. No client EXECUTE.';

-- ── 5.1 Triggers on the legal-owner links ────────────────────────────────────────────────────────
-- A seat or an invitation may only stand for a non-individual legal owner of the SAME business.
-- (The composite FK already pins the business; this adds the kind, which an FK cannot.)
CREATE OR REPLACE FUNCTION public._business_owner_link_is_legal_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.business_owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenant_business_owners bo
     WHERE bo.id = NEW.business_owner_id AND bo.tenant_id = NEW.tenant_id AND bo.owner_kind <> 'individual'
  ) THEN
    RAISE EXCEPTION 'an owner seat or invitation can only stand for a company, trust or other legal owner of this business'
      USING ERRCODE = '42501', HINT = 'OWNER_RECORD_INDIVIDUAL';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._business_owner_link_is_legal_owner() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_tenant_members_business_owner_link
  BEFORE INSERT OR UPDATE OF business_owner_id, tenant_id ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public._business_owner_link_is_legal_owner();
CREATE TRIGGER trg_tenant_invite_tokens_business_owner_link
  BEFORE INSERT OR UPDATE OF business_owner_id, tenant_id ON public.tenant_invite_tokens
  FOR EACH ROW EXECUTE FUNCTION public._business_owner_link_is_legal_owner();

-- The record side of the same rule: a legal owner that holds a SEAT cannot be turned into an
-- individual. (A record with only an invitation may change; accept re-checks it, contract §5.3.)
CREATE OR REPLACE FUNCTION public._business_owner_seated_kind_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.owner_kind = 'individual' AND OLD.owner_kind <> 'individual' AND EXISTS (
    SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = OLD.tenant_id AND m.business_owner_id = OLD.id
  ) THEN
    RAISE EXCEPTION '% holds an owner seat on the team, so it can''t be removed or changed here yet.',
      COALESCE(NULLIF(btrim(OLD.display_name), ''), OLD.legal_name) USING ERRCODE = '42501', HINT = 'OWNER_RECORD_SEATED';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._business_owner_seated_kind_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_tenant_business_owners_seated_kind
  BEFORE UPDATE OF owner_kind ON public.tenant_business_owners
  FOR EACH ROW EXECUTE FUNCTION public._business_owner_seated_kind_guard();

-- Deleting a legal owner first REVOKES and MARKS every invitation that names it (live or already
-- revoked), so a token whose link the FK then nulls is always revoked, and resend can tell it from a
-- person-owner invitation and refuses it. Definer, owned by postgres: its token UPDATE runs as
-- postgres, which the token guard exempts, whoever deletes the record.
CREATE OR REPLACE FUNCTION public._business_owner_revoke_invitations()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.tenant_invite_tokens
     SET revoked_at = COALESCE(revoked_at, now()), business_owner_removed_at = now(), updated_at = now()
   WHERE tenant_id = OLD.tenant_id AND business_owner_id = OLD.id;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public._business_owner_revoke_invitations() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_tenant_business_owners_revoke_invitations
  BEFORE DELETE ON public.tenant_business_owners
  FOR EACH ROW EXECUTE FUNCTION public._business_owner_revoke_invitations();

-- ── 5.2 The invitation token guard ───────────────────────────────────────────────────────────────
-- Closes what the FOR ALL policy "Tenant admins manage invite tokens" (is_platform_owner() OR
-- is_tenant_admin(tenant_id)) leaves open to an authenticated writer. SECURITY INVOKER, so
-- current_user is the real role: postgres inside a postgres-owned definer, authenticated for a
-- browser. Exempt exactly: auth.uid() IS NULL (service role, migrations) and postgres-owned code.
-- No platform exemption.
CREATE OR REPLACE FUNCTION public.guard_tenant_invite_token_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- The address of a live owner invitation is the account holder's. No other invitation that would
  -- seat a person in tenant_members (every kind but consumer and agency_team: accept_solo_team_invite
  -- takes 'team', accept_tenant_invite seats 'subaccount_owner' and every kind its generic branch
  -- takes) may be created to it in the same business under a person's JWT, by a direct INSERT or by
  -- postgres-owned code (create_tenant_invite_token): accepting it first would pre-empt the owner
  -- invitation. The holder's own Settings → Team invitation withdraws the owner invitation before
  -- inserting, so it never trips this. The service role (auth.uid() IS NULL) is exempt, as everywhere
  -- in this guard.
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND NEW.kind NOT IN ('consumer', 'agency_team')
     AND NULLIF(btrim(NEW.email), '') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.tenant_invite_tokens tk
                  WHERE tk.tenant_id = NEW.tenant_id AND tk.kind = 'team' AND tk.default_role = 'owner'::public.tenant_role
                    AND lower(btrim(tk.email)) = lower(btrim(NEW.email))
                    AND tk.uses = 0 AND tk.revoked_at IS NULL AND tk.expires_at > now()) THEN
    RAISE EXCEPTION 'There''s already an owner invitation for this address. Only the account holder can change it, from Settings → Team.'
      USING ERRCODE = '42501', HINT = 'OWNER_INVITE_EXISTS_FOR_ADDRESS';
  END IF;
  -- Those same invitations store their address trimmed and in lower case, as both postgres-owned
  -- writers already do. The withdraw and compare queries in create_solo_team_invite match on
  -- lower(email) without trimming, so a padded address inserted directly would survive the account
  -- holder's withdraw and still be accepted (accept trims), pre-empting the owner invitation.
  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND NEW.kind NOT IN ('consumer', 'agency_team')
     AND NEW.email IS DISTINCT FROM lower(btrim(NEW.email)) THEN
    RAISE EXCEPTION 'INVITE_GUARD: an invitation''s email address is stored trimmed and in lower case'
      USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL OR current_user = 'postgres' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.default_role = 'owner'::public.tenant_role OR NEW.business_owner_id IS NOT NULL THEN
      RAISE EXCEPTION 'INVITE_GUARD: owner invitations are created only by the account holder, from Settings → Team'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.created_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'INVITE_GUARD: an invitation is created in the name of the person creating it'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE or DELETE: an owner invitation changes only through the account holder's functions.
  IF OLD.default_role = 'owner'::public.tenant_role THEN
    RAISE EXCEPTION 'Only the account holder can change an owner invitation.'
      USING ERRCODE = '42501', HINT = 'OWNER_INVITATION_HOLDER_ONLY';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Every column but revoked_at is frozen, today's and any added later. updated_at is left out only
  -- because trg_tenant_invite_tokens_updated_at rewrites it on every update.
  IF (to_jsonb(NEW) - 'revoked_at' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'updated_at') THEN
    RAISE EXCEPTION 'INVITE_GUARD: an invitation can only be revoked here; nothing else about it can change'
      USING ERRCODE = '42501';
  END IF;
  -- revoked_at is one-way: NULL -> a value, once. A second revoke is a no-op that keeps the first time.
  IF OLD.revoked_at IS NOT NULL THEN
    IF NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION 'INVITE_GUARD: a revoked invitation cannot be restored; send a new one'
        USING ERRCODE = '42501';
    END IF;
    NEW.revoked_at := OLD.revoked_at;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_tenant_invite_token_identity() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.guard_tenant_invite_token_identity() IS
  'EXP08 owners (20271119020008): an authenticated writer of tenant_invite_tokens may insert only its '
  'own (created_by = auth.uid()) non-owner tokens, may change only revoked_at (NULL -> value, once), '
  'and may not update or delete an owner token. Service role and postgres-owned code are exempt from '
  'those rules. Under any JWT, postgres-owned code included, an invitation of a seat-creating kind '
  '(every kind but consumer and agency_team) may not be inserted for an address that has a live owner '
  'invitation in the same business, and must store its address trimmed and in lower case.';
CREATE TRIGGER trg_tenant_invite_token_identity_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_invite_tokens
  FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_invite_token_identity();

-- ── 5.3 The seat-side rule: a person with an owner invitation waiting joins through it ─────────────
-- The token guard above stops a new invitation being created to an owner invitation's address. It
-- cannot stop an invitation that names no address, a different address, or that already existed, from
-- being ACCEPTED by that person: accept_tenant_invite's generic branch never compares addresses, and
-- its sub-account-owner branch compares one only when it is stored. Taking a seat that way first left
-- the owner invitation failing "this account already belongs to the workspace" (review round 4, B1).
-- So the rule is enforced where those paths meet: the write of a seat (INSERT, or an UPDATE that moves
-- a seat to another person or business). A non-owner seat is refused for a person whose stored address
-- (trimmed, any case) has an owner invitation in that business that accept_solo_team_invite would
-- still honour (round 5): kind 'team', role Owner, not used, uses below max_uses, not revoked, not
-- expired, not archived, the business still a Solo account (_solo_shell_tenant), its sender still the
-- account holder (is_tenant_account_holder: so not while the holder's own seat is paused for billing,
-- R13, nor after the holder moved), and, when it names a legal owner, that record still in the same
-- business, not an individual, and its owner seat still open. An owner invitation accept would refuse
-- does not block the person from another seat; if it later becomes usable again (billing resumes)
-- and they have taken a seat meanwhile, it then refuses "this account already belongs to the
-- workspace", as any invitation does for someone already seated.
-- Whoever writes the seat (no exemption: browser, postgres-owned code, the service role), so it covers
-- accept_tenant_invite (generic and sub-account Admin paths), accept_solo_team_invite for a non-owner
-- invitation, accept_invitation and the accept-invite edge function's service-role seat write
-- (public.invitations), grant_tenant_member_role and agency_enter_subaccount, and an invitation of any
-- kind created before the owner invitation or by the service role.
-- NOT refused, and so NOT covered: (a) an owner seat (is_owner): the owner invitation's own
-- acceptance, and accept_tenant_invite's sub-account-owner path when the business has NO ACTIVE
-- OWNER. That path keys on "no active owner", not on "no account holder": a business whose holder of
-- record is paused for billing and has no other active owner qualifies, and the agency (or platform)
-- token then seats a new owner beside the paused holder. That is the #227 residual, stated in the
-- contract; the waiting owner invitation in that case is one accept would refuse anyway (its sender
-- is paused). (b) a write onto a seat the person already has (INSERT … ON CONFLICT re-accepting,
-- which a BEFORE INSERT trigger also sees, and an UPDATE that keeps the same person and business).
-- The account holder's own Settings → Team invitation withdraws the owner invitation first, as before.
-- The address compared is the one stored on the person's account, and only once it is CONFIRMED:
-- accept_solo_team_invite refuses an unconfirmed address, so an owner invitation waiting on an
-- unconfirmed account is not one accept would honour, and it does not hold that person off a seat.
-- The sentence: the person (their JWT, or no JWT at all) reads the first-person one. A no-JWT write
-- cannot say whose act it is; its one producer here, the accept-invite edge function, writes the
-- person's own seat, so the first-person sentence is the right one there. A service-role write made
-- for someone else would also read it (stated residual; no such producer today).
CREATE OR REPLACE FUNCTION public._tenant_member_owner_invitation_waiting()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _name text;
BEGIN
  IF NEW.is_owner IS TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = NEW.tenant_id AND m.user_id = NEW.user_id) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u
               JOIN public.tenant_invite_tokens tk ON lower(btrim(tk.email)) = lower(btrim(u.email))
              WHERE u.id = NEW.user_id AND NULLIF(btrim(u.email), '') IS NOT NULL AND u.email_confirmed_at IS NOT NULL
                AND tk.tenant_id = NEW.tenant_id AND tk.kind = 'team' AND tk.default_role = 'owner'::public.tenant_role
                AND tk.uses = 0 AND tk.revoked_at IS NULL AND tk.expires_at > now() AND tk.archived_at IS NULL
                AND (tk.max_uses IS NULL OR tk.uses < tk.max_uses)
                AND public._solo_shell_tenant(tk.tenant_id)
                AND public.is_tenant_account_holder(tk.created_by, tk.tenant_id)
                AND (tk.business_owner_id IS NULL
                     OR EXISTS (SELECT 1 FROM public.tenant_business_owners bo
                                 WHERE bo.id = tk.business_owner_id AND bo.tenant_id = tk.tenant_id
                                   AND bo.owner_kind <> 'individual'
                                   AND NOT EXISTS (SELECT 1 FROM public.tenant_members s
                                                    WHERE s.tenant_id = tk.tenant_id AND s.business_owner_id = bo.id)))) THEN
    SELECT NULLIF(btrim(t.name), '') INTO _name FROM public.tenants t WHERE t.id = NEW.tenant_id;
    IF auth.uid() IS NULL OR auth.uid() = NEW.user_id THEN
      RAISE EXCEPTION 'You have an owner invitation to % waiting. Open that invitation to join as an owner. Nothing changed.',
        COALESCE(_name, 'this business') USING ERRCODE = '42501', HINT = 'OWNER_INVITE_WAITING';
    END IF;
    RAISE EXCEPTION 'This person has an owner invitation to % waiting, so they join by accepting it. Only the account holder can change it, from Settings → Team. Nothing changed.',
      COALESCE(_name, 'this business') USING ERRCODE = '42501', HINT = 'OWNER_INVITE_WAITING';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public._tenant_member_owner_invitation_waiting() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public._tenant_member_owner_invitation_waiting() IS
  'EXP08 owners (20271119020008, rounds 4-5): a non-owner seat newly written for a person (INSERT, or an '
  'UPDATE moving a seat to them) is refused, whoever writes it, while their address has an owner '
  'invitation in that business that accept_solo_team_invite would still honour (team, Owner, unused, '
  'unrevoked, unexpired, unarchived, Solo account, sender still the account holder, its legal owner''s '
  'seat still open, the person''s address confirmed). Not covered: owner seats (incl. the sub-account owner path, contract #227 residual) '
  'and seats the person already has. HINT OWNER_INVITE_WAITING.';
CREATE TRIGGER trg_tenant_members_owner_invitation_waiting
  BEFORE INSERT OR UPDATE OF tenant_id, user_id ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public._tenant_member_owner_invitation_waiting();

-- ── 5.2 Every move of the account holder of record is audited ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public._tenant_account_holder_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.paige_audit_log (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
  VALUES (auth.uid(),
          CASE WHEN auth.uid() IS NULL THEN 'service'
               WHEN public.is_super_admin(auth.uid()) THEN 'super_admin'
               ELSE 'owner' END,
          'tenant:account_holder_changed', 'tenant', NEW.id,
          jsonb_build_object('tenant_id', NEW.id,
                             'previous_owner_user_id', OLD.owner_user_id,
                             'owner_user_id', NEW.owner_user_id,
                             'actor', COALESCE(auth.uid()::text, 'service'),
                             'recovery', COALESCE(current_setting('paige.owner_recovery', true), '') = 'on'),
          NEW.id);
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._tenant_account_holder_changed() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_tenant_account_holder_changed
  AFTER UPDATE OF owner_user_id ON public.tenants
  FOR EACH ROW WHEN (OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id)
  EXECUTE FUNCTION public._tenant_account_holder_changed();

-- ── 5.2 Re-emitted guards ────────────────────────────────────────────────────────────────────────
-- guard_tenant_member_owner_flag: production body (20260803190000, md5 011b8efe…) + one block.
CREATE OR REPLACE FUNCTION public.guard_tenant_member_owner_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- EXP08 owners (20271119020008): which legal owner a seat acts for is written ONLY by trusted server code
  -- (accept_solo_team_invite now; the co-owner functions in a later increment). Unlike the ownership
  -- checks below, the platform owner is NOT exempt: a super admin changes owners only through audited
  -- owner recovery, never by editing a seat.
  IF current_user NOT IN ('postgres','service_role','supabase_admin','supabase_auth_admin')
     AND ((TG_OP = 'INSERT' AND NEW.business_owner_id IS NOT NULL)
          OR (TG_OP = 'UPDATE' AND NEW.business_owner_id IS DISTINCT FROM OLD.business_owner_id)) THEN
    RAISE EXCEPTION
      'OWNER_GUARD: which legal owner a seat represents may only be set by an owner invitation'
      USING ERRCODE = '42501';
  END IF;

  -- Exempt trusted server identities + the platform owner. NOTE: 'authenticator'
  -- is deliberately NOT exempt — it always SET ROLEs to authenticated/anon before
  -- running client DML, and the task requires authenticator direct-DML to be forbidden.
  IF current_user IN ('postgres','service_role','supabase_admin','supabase_auth_admin')
     OR public.is_platform_owner() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.is_owner, false)
       OR NEW.role = 'owner'::public.tenant_role THEN
      RAISE EXCEPTION
        'OWNER_GUARD: tenant ownership may only be set via grant_co_owner()/provisioning'
        USING ERRCODE = '42501';
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    IF (COALESCE(NEW.is_owner, false) IS DISTINCT FROM COALESCE(OLD.is_owner, false))
       OR ((NEW.role = 'owner'::public.tenant_role)
            IS DISTINCT FROM (OLD.role = 'owner'::public.tenant_role)) THEN
      RAISE EXCEPTION
        'OWNER_GUARD: tenant ownership may only be changed via grant_co_owner()/revoke_co_owner()'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- guard_tenant_owner_only_columns: production body (20271116020008, md5 d77a4bfa…) + SECURITY INVOKER
-- and three marked edits. Its trigger trg_guard_tenant_owner_cols (BEFORE UPDATE ON tenants) is
-- unchanged. It reads is_platform_owner() and is_super_admin(uuid) (both definer helpers authenticated
-- may execute) and, only when current_user = 'postgres', two tenant_members EXISTS.
CREATE OR REPLACE FUNCTION public.guard_tenant_owner_only_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $function$
BEGIN
  -- EXP08 owners (20271119020008): the platform owner keeps billing and hierarchy, but moves the account
  -- holder of record only through owner recovery (below), never by a direct UPDATE.
  IF auth.uid() IS NULL
     OR (public.is_platform_owner() AND NEW.owner_user_id IS NOT DISTINCT FROM OLD.owner_user_id) THEN
    RETURN NEW;
  END IF;

  -- #227 DEFECT-2 carve-out, narrowed by EXP08 (20271116020008): an authenticated caller may only
  -- ESTABLISH themselves (NULL -> auth.uid()) as holder, and only as the tenant's SOLE active owner.
  -- EXP08 owners (20271119020008): and only inside trusted postgres-owned code (accept_tenant_invite),
  -- never by a direct client UPDATE. This guard runs SECURITY INVOKER, so current_user is real.
  IF current_user = 'postgres'
     AND OLD.owner_user_id IS NULL
     AND NEW.owner_user_id IS NOT NULL
     AND NEW.owner_user_id = auth.uid()
     AND NEW.platform_fee_bps       IS NOT DISTINCT FROM OLD.platform_fee_bps
     AND NEW.parent_tenant_id       IS NOT DISTINCT FROM OLD.parent_tenant_id
     AND NEW.stripe_customer_id     IS NOT DISTINCT FROM OLD.stripe_customer_id
     AND NEW.stripe_subscription_id IS NOT DISTINCT FROM OLD.stripe_subscription_id
     AND EXISTS (
       SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = NEW.id
          AND tm.user_id   = NEW.owner_user_id
          AND tm.is_owner  = true
          AND tm.status    = 'active'
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.tenant_members tm
        WHERE tm.tenant_id = NEW.id
          AND tm.user_id  <> NEW.owner_user_id
          AND tm.is_owner  = true
          AND tm.status    = 'active'
     ) THEN
    RETURN NEW;
  END IF;

  -- EXP08 owners (20271119020008): owner recovery. platform_owner_recovery (a later increment) sets
  -- paige.owner_recovery transaction-locally around its one UPDATE. The flag alone is no credential
  -- (any role can set_config it): it counts only inside postgres-owned code, and only for a super admin.
  IF current_user = 'postgres'
     AND current_setting('paige.owner_recovery', true) = 'on'
     AND public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_user_id       IS DISTINCT FROM OLD.owner_user_id
     OR NEW.platform_fee_bps IS DISTINCT FROM OLD.platform_fee_bps
     OR NEW.parent_tenant_id IS DISTINCT FROM OLD.parent_tenant_id
     OR NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id
     OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id THEN
    RAISE EXCEPTION 'Only the platform owner may change tenant ownership, billing, or hierarchy';
  END IF;
  RETURN NEW;
END; $function$;
COMMENT ON FUNCTION public.guard_tenant_owner_only_columns() IS
  '#227 F.0 (§9), narrowed by EXP08 20271116020008 and 20271119020008. SECURITY INVOKER, so '
  'current_user is the real role. Service role and migrations (auth.uid() IS NULL) are exempt. The '
  'platform owner may change billing and hierarchy but NOT owner_user_id. owner_user_id changes for an '
  'authenticated caller only inside postgres-owned code, and only (a) NULL -> auth.uid() as the '
  'tenant''s SOLE active owner (accept_tenant_invite''s sub-account owner path), or (b) owner recovery: '
  'paige.owner_recovery = on, set by platform_owner_recovery, for a super admin. Every owner_user_id '
  'change is audited by trg_tenant_account_holder_changed.';

-- ── 5.3 The invite family ────────────────────────────────────────────────────────────────────────
-- create_solo_team_invite gains _business_owner_id and _new_business_owner. The 7-argument form is
-- DROPPED, not overloaded: PostgREST resolves by argument names, and a call naming seven would match
-- both. Callers that name seven (solo-team-invitations create, and resend below) resolve to this one
-- through the two new defaults.
DROP FUNCTION IF EXISTS public.create_solo_team_invite(uuid, uuid, text, text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.create_solo_team_invite(_actor uuid, _expected_tenant_id uuid, _email text, _permission text DEFAULT 'member'::text, _job_title text DEFAULT NULL::text, _responsibilities text DEFAULT NULL::text, _team_hub_access boolean DEFAULT true, _business_owner_id uuid DEFAULT NULL::uuid, _new_business_owner jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _tenant uuid;
  _token text;
  _row public.tenant_invite_tokens;
  _record public.tenant_business_owners;
BEGIN
  _tenant := public.solo_team_invite_authority(_actor, _expected_tenant_id);

  IF lower(trim(_permission)) NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'team invitations may grant only Owner, Admin or Member';
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
  -- EXP08 owners (20271119020008): only the ACCOUNT HOLDER invites an Owner (owner rulings R1, R4), on a
  -- Solo account, with team conversations on, as a person or for ONE non-individual legal owner of
  -- this business that has no seat and no other live invitation. Everyone else keeps inviting Admins
  -- and Members exactly as before (R14, "keep as today").
  IF _business_owner_id IS NOT NULL AND _new_business_owner IS NOT NULL THEN
    RAISE EXCEPTION 'Choose the legal owner they represent, or add one, not both.' USING HINT = 'OWNER_RECORD_AMBIGUOUS';
  END IF;
  IF lower(trim(_permission)) <> 'owner' AND (_business_owner_id IS NOT NULL OR _new_business_owner IS NOT NULL) THEN
    RAISE EXCEPTION 'Only an owner invitation can be for a legal owner.' USING HINT = 'OWNER_RECORD_NOT_OWNER';
  END IF;
  IF lower(trim(_permission)) = 'owner' THEN
    IF NOT public._solo_shell_tenant(_tenant) THEN
      RAISE EXCEPTION 'Owner invitations aren''t available for this account.' USING ERRCODE = '42501', HINT = 'OWNER_INVITE_UNAVAILABLE';
    END IF;
    -- Before anything about the legal owner is read, so a refusal says nothing about the record.
    PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'add');
    IF _team_hub_access IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Owners always take part in team conversations.' USING HINT = 'OWNER_TEAM_CONVERSATIONS';
    END IF;
    IF _new_business_owner IS NOT NULL THEN
      IF jsonb_typeof(_new_business_owner) IS DISTINCT FROM 'object'
         OR COALESCE(_new_business_owner->>'ownerKind', '') NOT IN ('company', 'trust', 'other_legal_person') THEN
        RAISE EXCEPTION 'Choose whether the legal owner is a company, a trust, or a partnership or other legal person.' USING HINT = 'OWNER_RECORD_KIND';
      END IF;
      IF char_length(btrim(COALESCE(_new_business_owner->>'legalName', ''))) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'Enter the legal name.' USING HINT = 'OWNER_RECORD_NAME';
      END IF;
      INSERT INTO public.tenant_business_owners (tenant_id, owner_kind, legal_name, created_by, updated_by, setup_provenance)
      VALUES (_tenant, _new_business_owner->>'ownerKind', btrim(_new_business_owner->>'legalName'), _actor, _actor,
              jsonb_build_object('source', 'team_invite'))
      RETURNING * INTO _record;
    ELSIF _business_owner_id IS NOT NULL THEN
      SELECT * INTO _record FROM public.tenant_business_owners
       WHERE id = _business_owner_id AND tenant_id = _tenant FOR UPDATE;
      IF _record.id IS NULL THEN
        RAISE EXCEPTION 'Choose the legal owner they represent.' USING HINT = 'OWNER_RECORD_NOT_FOUND';
      END IF;
      IF _record.owner_kind = 'individual' THEN
        RAISE EXCEPTION 'A person is invited as an owner in their own right, not as a legal owner.' USING HINT = 'OWNER_RECORD_INDIVIDUAL';
      END IF;
      IF EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND business_owner_id = _record.id) THEN
        RAISE EXCEPTION '% already has a representative on the team.', COALESCE(_record.display_name, _record.legal_name)
          USING HINT = 'OWNER_RECORD_SEATED';
      END IF;
      -- An expired, unused invitation for this record still holds the one-live-invitation index,
      -- whatever its email, and would turn the next invitation into a raw unique-index error.
      UPDATE public.tenant_invite_tokens
         SET revoked_at = now(), updated_at = now()
       WHERE business_owner_id = _record.id AND uses = 0 AND revoked_at IS NULL AND expires_at <= now();
      IF EXISTS (SELECT 1 FROM public.tenant_invite_tokens
                  WHERE business_owner_id = _record.id AND uses = 0 AND revoked_at IS NULL
                    AND lower(email) <> lower(trim(_email))) THEN
        RAISE EXCEPTION 'There''s already an owner invitation pending for %.', COALESCE(_record.display_name, _record.legal_name)
          USING HINT = 'OWNER_RECORD_INVITED';
      END IF;
    END IF;
  ELSIF NOT public.is_tenant_account_holder(_actor, _tenant) AND EXISTS (
    SELECT 1 FROM public.tenant_invite_tokens
     WHERE tenant_id = _tenant AND kind = 'team' AND default_role = 'owner'::public.tenant_role
       AND lower(email) = lower(trim(_email)) AND uses = 0 AND revoked_at IS NULL AND expires_at > now()
  ) THEN
    -- The replace below would withdraw it, and only the account holder changes an owner invitation.
    RAISE EXCEPTION 'There''s already an owner invitation for this address. Only the account holder can change it.'
      USING ERRCODE = '42501', HINT = 'OWNER_INVITE_EXISTS_FOR_ADDRESS';
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
     team_hub_access, business_owner_id)
  VALUES
    (_tenant, _token, 'team', lower(trim(_permission))::public.tenant_role, _actor,
     now() + interval '7 days', 1, lower(trim(_email)), NULLIF(trim(_job_title), ''), NULLIF(trim(_responsibilities), ''),
     _team_hub_access, _record.id)
  RETURNING * INTO _row;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_invite', 'team_invite_created', _row.id,
          jsonb_build_object('tenant_id', _tenant, 'permission', lower(trim(_permission)),
                             'team_hub_access', _team_hub_access, 'business_owner_id', _row.business_owner_id));
  -- `tenant_id` is returned so the caller can prove the invitation landed where it asked. A screen
  -- that sent workspace A and is handed back workspace B has been redirected, and should say so
  -- rather than report a success it cannot vouch for.
  RETURN jsonb_build_object('id', _row.id, 'token', _token, 'email', _row.email,
                            'expires_at', _row.expires_at, 'tenant_id', _tenant,
                            'team_hub_access', _row.team_hub_access, 'business_owner_id', _row.business_owner_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.create_solo_team_invite(uuid, uuid, text, text, text, text, boolean, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_solo_team_invite(uuid, uuid, text, text, text, text, boolean, uuid, jsonb) TO service_role;

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
  -- EXP08 owners (20271119020008): an owner invitation is the account holder's to resend.
  -- One whose legal owner was deleted is never reissued: the FK has nulled its link, and resending it
  -- would make it an owner invitation for the person in their own right.
  IF _old.default_role = 'owner'::public.tenant_role THEN
    PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'invitation');
    IF _old.business_owner_removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'This owner invitation was for a legal owner that has since been removed, so it can''t be sent again. Send a new owner invitation instead.'
        USING HINT = 'OWNER_INVITE_RECORD_REMOVED';
    END IF;
  END IF;
  UPDATE public.tenant_invite_tokens SET revoked_at = COALESCE(revoked_at, now()), updated_at = now() WHERE id = _old.id;
  -- The re-entry carries the SAME proved workspace, so a resend can never resolve differently from
  -- the create it delegates to. EXP08 lifecycle: and the same Team conversations choice, which the
  -- new parameter's default would otherwise silently turn back on.
  RETURN public.create_solo_team_invite(_actor, _tenant, _old.email, _old.default_role::text, _old.job_title, _old.responsibilities,
                                        _old.team_hub_access, _old.business_owner_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.resend_solo_team_invite(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resend_solo_team_invite(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_solo_team_invite(
  _actor uuid,
  _expected_tenant_id uuid,
  _invite_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _tenant uuid;
BEGIN
  _tenant := public.solo_team_invite_authority(_actor, _expected_tenant_id);

  -- EXP08 owners (20271119020008): an owner invitation is the account holder's to withdraw.
  IF EXISTS (SELECT 1 FROM public.tenant_invite_tokens
              WHERE id = _invite_id AND tenant_id = _tenant AND kind = 'team'
                AND default_role = 'owner'::public.tenant_role) THEN
    PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'invitation');
  END IF;

  UPDATE public.tenant_invite_tokens
  SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
  WHERE id = _invite_id AND tenant_id = _tenant AND kind = 'team' AND uses = 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'pending team invitation not found'; END IF;
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_invite', 'team_invite_revoked', _invite_id, jsonb_build_object('tenant_id', _tenant));
END;
$function$;
REVOKE ALL ON FUNCTION public.revoke_solo_team_invite(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_solo_team_invite(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.archive_solo_team_invite(
  _actor uuid,
  _expected_tenant_id uuid,
  _invite_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _tenant uuid;
  _invite public.tenant_invite_tokens;
BEGIN
  -- The SAME authority resolver the other three invitation writes use (#827). Not a re-derivation:
  -- a second implementation of "may this actor act in this workspace" is a second thing to get
  -- wrong, and the last one that existed here sent a token toward a workspace nobody named.
  _tenant := public.solo_team_invite_authority(_actor, _expected_tenant_id);

  SELECT * INTO _invite FROM public.tenant_invite_tokens
  WHERE id = _invite_id AND tenant_id = _tenant AND kind = 'team'
  FOR UPDATE;

  IF _invite.id IS NULL THEN
    RAISE EXCEPTION 'that invitation is not on this workspace' USING ERRCODE = 'P0001';
  END IF;

  -- EXP08 owners (20271119020008): an owner invitation is the account holder's to clear.
  IF _invite.default_role = 'owner'::public.tenant_role THEN
    PERFORM public._assert_tenant_account_holder(_actor, _tenant, 'invitation');
  END IF;

  -- A LIVE invitation is a working access grant sitting in somebody's inbox. Hiding it from the
  -- list would leave a token nobody is watching, which is the opposite of what this feature is for.
  IF _invite.uses = 0 AND _invite.revoked_at IS NULL AND _invite.expires_at > now() THEN
    RAISE EXCEPTION 'that invitation is still live; revoke it before clearing it' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.tenant_invite_tokens
  SET archived_at = COALESCE(archived_at, now()), updated_at = now()
  WHERE id = _invite_id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_invite', 'team_invite_archived', _invite_id,
          jsonb_build_object('tenant_id', _tenant));
END;
$function$;
REVOKE ALL ON FUNCTION public.archive_solo_team_invite(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_solo_team_invite(uuid, uuid, uuid) TO service_role;

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
  _record public.tenant_business_owners;
  _tenant_name text;
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
  IF _invite.default_role NOT IN ('owner'::public.tenant_role, 'admin'::public.tenant_role, 'member'::public.tenant_role) THEN
    RAISE EXCEPTION 'team invitation has an unsupported permission';
  END IF;
  -- EXP08 owners (20271119020008): an owner invitation is re-checked at the moment it is used, under the
  -- token lock: the sender must STILL be the account holder, the account a Solo one, and a legal
  -- owner's seat still open (owner rulings R1, R4, R6; contract §5.3). The tenant row (the holder of
  -- record) and the sender's seat (which a billing suspension rewrites) are locked FOR SHARE first,
  -- so neither can change between this check and the seat it allows.
  IF _invite.default_role = 'owner'::public.tenant_role THEN
    SELECT name INTO _tenant_name FROM public.tenants WHERE id = _invite.tenant_id FOR SHARE;
    PERFORM 1 FROM public.tenant_members WHERE tenant_id = _invite.tenant_id AND user_id = _invite.created_by FOR SHARE;
    IF NOT public._solo_shell_tenant(_invite.tenant_id) THEN
      RAISE EXCEPTION 'Owner invitations aren''t available for this account.' USING ERRCODE = '42501', HINT = 'OWNER_INVITE_UNAVAILABLE';
    END IF;
    IF NOT public.is_tenant_account_holder(_invite.created_by, _invite.tenant_id) THEN
      RAISE EXCEPTION 'This owner invitation can''t be used any more: the person who sent it can no longer add owners to %. Ask the account holder for a new one.',
        COALESCE(_tenant_name, 'this business') USING ERRCODE = '42501', HINT = 'OWNER_INVITE_SENDER_NOT_HOLDER';
    END IF;
    IF _invite.business_owner_id IS NOT NULL THEN
      SELECT * INTO _record FROM public.tenant_business_owners
       WHERE id = _invite.business_owner_id AND tenant_id = _invite.tenant_id FOR UPDATE;
      IF _record.id IS NULL OR _record.owner_kind = 'individual'
         OR EXISTS (SELECT 1 FROM public.tenant_members
                     WHERE tenant_id = _invite.tenant_id AND business_owner_id = _record.id) THEN
        RAISE EXCEPTION 'This owner invitation was for %, and that owner seat has changed since it was sent. Ask the account holder for a new invitation.',
          COALESCE(_record.display_name, _record.legal_name, 'a legal owner') USING ERRCODE = '42501', HINT = 'OWNER_INVITE_SEAT_CHANGED';
      END IF;
    END IF;
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
    (tenant_id, user_id, role, status, is_owner, invited_at, joined_at, job_title, responsibilities, team_hub_access,
     business_owner_id)
  VALUES
    (_invite.tenant_id, _actor, _invite.default_role, 'active', _invite.default_role = 'owner'::public.tenant_role, _invite.created_at, now(),
     _invite.job_title, _invite.responsibilities, _invite.team_hub_access OR _invite.default_role = 'owner'::public.tenant_role,
     _invite.business_owner_id);

  UPDATE public.tenant_invite_tokens
  SET uses = uses + 1, last_used_at = now(), updated_at = now()
  WHERE id = _invite.id AND uses = 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'team invitation was already accepted'; END IF;

  UPDATE public.profiles SET active_tenant_id = _invite.tenant_id WHERE user_id = _actor;
  -- EXP08 owners (20271119020008): the seat is the only source of "Represented by …". The record's earlier
  -- representative, if any, is overwritten and kept in the audit row.
  IF _record.id IS NOT NULL THEN
    UPDATE public.tenant_business_owners
       SET representative_user_id = _actor, owner_seat_vacant_since = NULL, updated_at = now()
     WHERE id = _record.id;
    INSERT INTO public.paige_audit_log (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
    VALUES (_actor, 'owner', 'tenant:business_owner_representative_named', 'tenant_business_owner', _record.id,
            jsonb_build_object('tenant_id', _invite.tenant_id, 'business_owner_id', _record.id,
                               'representative_user_id', _actor,
                               'previous_representative_user_id', _record.representative_user_id,
                               'via', 'accept_solo_team_invite', 'invite_id', _invite.id),
            _invite.tenant_id);
  END IF;
  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'tenant_invite', 'team_invite_accepted', _invite.id,
          jsonb_build_object('tenant_id', _invite.tenant_id, 'permission', _invite.default_role::text,
                             'team_hub_access', _invite.team_hub_access, 'business_owner_id', _invite.business_owner_id));
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
    -- EXP08 owners (20271119020008): an owner invitation is accepted only by accept_solo_team_invite,
    -- which re-checks the account holder at that moment. Here it used to be silently turned into an
    -- Admin seat and reported as accepted (§13). It is refused instead, before anything is written.
    IF _tok.default_role = 'owner'::public.tenant_role THEN
      RAISE EXCEPTION 'this invitation can''t be accepted here' USING ERRCODE = '42501', HINT = 'OWNER_INVITE_NOT_HERE';
    END IF;
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

-- create_tenant_invite_token: production body (20260824000000, md5 3a91af3a…) with the FIX-1 block
-- narrowed. CREATE OR REPLACE keeps its ACL as production has it; nothing is re-granted here.
CREATE OR REPLACE FUNCTION public.create_tenant_invite_token(_tenant_id uuid, _kind text DEFAULT 'consumer'::text, _default_role tenant_role DEFAULT 'member'::tenant_role, _expires_in_days integer DEFAULT 30, _max_uses integer DEFAULT NULL::integer, _contact_id uuid DEFAULT NULL::uuid, _email text DEFAULT NULL::text)
 RETURNS tenant_invite_tokens
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.tenant_invite_tokens;
  _new_token text;
  _contact_ok boolean;
BEGIN
  IF NOT (public.is_platform_owner()
          OR public.is_tenant_admin(_tenant_id)
          OR public.agency_can_manage_child(_tenant_id, auth.uid())) THEN
    RAISE EXCEPTION 'not authorized to create invite tokens for this tenant';
  END IF;
  IF _kind NOT IN ('consumer', 'team', 'subaccount_owner', 'agency_team') THEN
    RAISE EXCEPTION 'invalid invite kind: %', _kind;
  END IF;

  -- §60 (owner-ruled 2026-08-11, Enterprise HYBRID): customer portal / consumer invites are
  -- Solo + Sub-account + ENTERPRISE. Only a pure AGENCY is rejected — it manages sub-accounts,
  -- not a direct consumer client book. Enterprise is the hybrid tier (Solo ∪ Agency), so it
  -- runs its own client book AND can mint portal invites. Server-enforced; the UI helper
  -- hasFeature('customer_portal_invite') mirrors this (enterprise now included). Applies to
  -- ALL callers incl. platform owner. Other kinds are unaffected.
  IF _kind = 'consumer'
     AND (SELECT account_type FROM public.tenants WHERE id = _tenant_id) = 'agency' THEN
    RAISE EXCEPTION 'consumer/portal invites are not available for an agency account (an agency manages sub-accounts, not a direct client book)'
      USING ERRCODE = '42501';
  END IF;

  -- #227 HOLE#1 Layer-1 (§9): a subaccount_owner invite ESTABLISHES ownership on accept,
  -- so only the agency principal that manages this child (or the platform) may mint it.
  -- is_tenant_admin(child) is deliberately NOT sufficient — that is the admin self-mint vector.
  IF _kind = 'subaccount_owner'
     AND NOT (public.is_platform_owner()
              OR public.agency_can_manage_child(_tenant_id, auth.uid())) THEN
    RAISE EXCEPTION 'only the parent agency (or platform) may mint a sub-account owner invite'
      USING ERRCODE = '42501';
  END IF;

  -- FIX-1 (§9), narrowed by EXP08 owners (20271119020008): no token minted here carries Owner, for any
  -- kind or any caller, the platform owner included. An Owner is invited only by the account holder,
  -- through create_solo_team_invite (owner rulings R1, R4).
  -- The sentence is the one the Agency Team screen shows (it still offers Owner), so it says what that
  -- person CAN do, true for whichever account they are working in.
  IF _default_role = 'owner'::public.tenant_role THEN
    IF public.is_company_workspace(_tenant_id) THEN
      RAISE EXCEPTION 'Owner invitations aren''t available for this account.' USING ERRCODE = '42501', HINT = 'OWNER_INVITE_UNAVAILABLE';
    ELSIF (SELECT account_type FROM public.tenants WHERE id = _tenant_id) IN ('agency', 'enterprise') THEN
      RAISE EXCEPTION '% accounts add Admins and Members. An owner is added by the account holder of a business account, from its Settings → Team.',
        CASE WHEN (SELECT account_type FROM public.tenants WHERE id = _tenant_id) = 'enterprise' THEN 'Enterprise' ELSE 'Agency' END
        USING ERRCODE = '42501', HINT = 'OWNER_INVITE_SETTINGS_ONLY';
    END IF;
    RAISE EXCEPTION 'Owners are added only by this business''s account holder, from Settings → Team. You can invite an Admin or Member here.'
      USING ERRCODE = '42501', HINT = 'OWNER_INVITE_SETTINGS_ONLY';
  END IF;

  IF _contact_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.clients WHERE id = _contact_id AND tenant_id = _tenant_id
    ) INTO _contact_ok;
    IF NOT _contact_ok THEN
      RAISE EXCEPTION 'contact does not belong to this tenant';
    END IF;
  END IF;

  _new_token := encode(extensions.gen_random_bytes(24), 'base64');
  _new_token := replace(replace(replace(_new_token, '+', '-'), '/', '_'), '=', '');

  INSERT INTO public.tenant_invite_tokens
    (tenant_id, token, kind, default_role, created_by, expires_at, max_uses, contact_id, email)
  VALUES
    (_tenant_id, _new_token, _kind, _default_role, auth.uid(),
     now() + make_interval(days => GREATEST(_expires_in_days, 1)), _max_uses,
     _contact_id, NULLIF(lower(trim(_email)), ''))
  RETURNING * INTO _row;

  RETURN _row;
END $function$;

-- ── 5.5 peek_tenant_invite ───────────────────────────────────────────────────────────────────────
-- Production body (20260713050000 + the in-place E09_CONSUMER_INVITE_PEEK_V1 patch of 20271108120100,
-- md5 276541d0…) with one marked block. Its result gains business_owner_display, which CREATE OR
-- REPLACE cannot add, so it is dropped and re-created with production's ACL (anon and authenticated).
DROP FUNCTION IF EXISTS public.peek_tenant_invite(text);
CREATE FUNCTION public.peek_tenant_invite(_token text)
 RETURNS TABLE(tenant_id uuid, tenant_name text, tenant_slug text, brand jsonb, kind text, default_role tenant_role, expires_at timestamp with time zone, is_valid boolean, invited_email text, business_owner_display text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tok public.tenant_invite_tokens;
  _ten public.tenants;
  _rb  record;
BEGIN
  SELECT * INTO _tok FROM public.tenant_invite_tokens WHERE token = _token;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO _ten FROM public.tenants WHERE id = _tok.tenant_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO _rb FROM public.resolve_tenant_brand(_ten.id);

  tenant_id     := _ten.id;
  tenant_name   := _ten.name;
  tenant_slug   := _ten.slug;
  brand         := jsonb_build_object(
                     'logo_url',      _rb.logo_url,
                     'logo_dark_url', _rb.logo_dark_url,
                     'primary_color', _rb.primary_color,
                     'accent_color',  _rb.accent_color
                   );
  kind          := _tok.kind;
  default_role  := _tok.default_role;
  expires_at    := _tok.expires_at;
  invited_email := _tok.email;
  -- E09_CONSUMER_INVITE_PEEK_V1
  is_valid      := (_tok.revoked_at IS NULL)
                   AND (_tok.expires_at > now())
                   AND (_tok.max_uses IS NULL OR _tok.uses < _tok.max_uses)
                   AND (_tok.kind <> 'consumer' OR (_tok.uses = 0 AND _tok.last_used_at IS NULL));
  -- EXP08 owners (20271119020008): an owner invitation for a legal owner names it, so the invitee knows
  -- whom they would act for, and only while it can still be used. A deliberate exposure to whoever
  -- holds a live link: the name only, never the ownership interest or the representative.
  business_owner_display := NULL;
  IF is_valid AND _tok.default_role = 'owner'::public.tenant_role AND _tok.business_owner_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(btrim(bo.display_name), ''), bo.legal_name) INTO business_owner_display
      FROM public.tenant_business_owners bo
     WHERE bo.id = _tok.business_owner_id AND bo.tenant_id = _tok.tenant_id;
  END IF;
  RETURN NEXT;
END $function$;
REVOKE ALL ON FUNCTION public.peek_tenant_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_tenant_invite(text) TO anon, authenticated;

COMMIT;
