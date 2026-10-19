-- E09 Slice 7: a business can PAUSE, RESTORE or END one joined client's portal access.
--
-- "Accepted access" is exactly clients.linked_user_id = auth.uid() on an active, unmerged contact in
-- an active business (20271102100000 acceptance; 20271102120000 resolver). There is no other access
-- store. This migration qualifies that one fact with a state that lives on the same row:
--
--   open    nothing withheld (the default; every existing row)
--   paused  temporarily withheld. The link is KEPT, so restoring needs no new invitation.
--   ended   access ended. The link is CLEARED, so the person is no longer this contact's login and
--           the normal invitation path can bring them (or someone else) back. portal_access_former_user_id
--           remembers who it was, so their own state read can still say "ended".
--
-- Nothing is deleted: not the contact, its history, the person's Auth login, their global `client`
-- role, or their access at any other business. The one inherited exception is that clearing the link
-- fires the existing trg_end_assigned_relationships_on_unlink, which deletes the person-keyed
-- coach_clients grant rows; re-acceptance rebuilds them from assigned_coach_user_id.
--
-- 1. Columns + CHECKs + one partial index on public.clients.
-- 2. _clients_portal_access_guard (BEFORE INSERT OR UPDATE): only the writer may change the access
--    columns; derived transitions keep the state honest whichever producer touches the link; a pause
--    cannot be moved onto another person or laundered through a CRM merge.
-- 3. client_portal_relationship_id — byte-for-byte plus ONE predicate (portal_access_state = 'open'),
--    placed in the WHERE before the cardinality count. Every resolver caller (21 functions, 9 policies,
--    and the in-flight Slices 4/5/A/6, which resolve through it first) inherits it.
-- 4. client_portal_access_open(uuid) — internal: "this contact is the caller's OPEN relationship",
--    delegating to the resolver (one home). Used by the definer readers that bypassed the resolver.
-- 5. set_client_portal_access — the owner's one writer. read_client_portal_access — the owner's read.
--    client_portal_access_state — the customer's honest read, keyed on auth.uid() only.
-- 6. Bypass readers restated with the predicate only (§37): rail readers, brand/agreement/persona
--    readers, is_program_client_owner, load_self_context, customer_paige_activity_summary,
--    can_access_contact(3), client_portal_invite_status, ensure_client_role_self_heal,
--    operations_delivery_client_{read,reviews}_scoped, storage signed_agreements_read.
-- 7. Owner-to-customer notices: comms_portal_reply refuses a paused contact; admin_propose_paige_actions
--    and notify_client_on_readiness_approval no longer notify a person whose access is not open.
-- 8. start_client_impersonation names a paused/ended contact; _create_client_with_contact_methods
--    refuses the access columns by name.
-- 9. list_tool_autonomy gains client_portal_access_set (default confirm), wrapper pattern.
-- 10. The nine customer writers on main that re-prove the contact under a lock after the resolver
--    (plus customer_respond_to_action, patched in place) admit only portal_access_state = 'open', so a
--    pause that commits between the resolver and the lock wins.
-- 11. _clients_portal_link_not_staff_guard: a signed-in member of the team — an active member of this
--    business or of a business above it, agency staff on the agency team list who can manage it, or a
--    platform operator — cannot link a client record to their own login through the table.
--
-- 12. _client_portal_lock_relationship: the one open-access gate the customer doors added after this
--    slice was written (Documents, Profile & Consent, Agreements, Payments) now re-prove through.
--
-- Renumbered 20271110110000 -> 20271110240000 at integration (2026-10-18) so it applies after Documents
-- (200000), Profile & Consent (215000), Agreements (220000) and Payments (230000). Every function this
-- file restates was diffed against its newest definition on that base; operations_delivery_client_read_scoped
-- is Documents' 200000 body plus this slice's predicate, and no other restated body changed after
-- 1cc4e9950 (the evidence record carries the table).
BEGIN;

-- ── 1. Columns ──────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.clients
  ADD COLUMN portal_access_state text NOT NULL DEFAULT 'open',
  ADD COLUMN portal_access_changed_at timestamptz,
  ADD COLUMN portal_access_changed_by uuid,
  ADD COLUMN portal_access_reason text,
  ADD COLUMN portal_access_note text,
  ADD COLUMN portal_access_former_user_id uuid;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_portal_access_state_check
    CHECK (portal_access_state IN ('open','paused','ended')),
  ADD CONSTRAINT clients_portal_access_reason_check
    CHECK (portal_access_reason IS NULL OR portal_access_reason IN
      ('engagement_paused','engagement_ended','payment','client_request','security','other')),
  ADD CONSTRAINT clients_portal_access_note_check
    CHECK (portal_access_note IS NULL OR (length(portal_access_note) BETWEEN 1 AND 280)),
  -- paused keeps the link; ended has cleared it and remembers who it was; open remembers nobody.
  ADD CONSTRAINT clients_portal_access_consistent CHECK (
    (portal_access_state = 'open'   AND portal_access_former_user_id IS NULL)
 OR (portal_access_state = 'paused' AND linked_user_id IS NOT NULL AND portal_access_former_user_id IS NULL)
 OR (portal_access_state = 'ended'  AND linked_user_id IS NULL AND portal_access_former_user_id IS NOT NULL));
CREATE INDEX clients_portal_access_former_user_idx ON public.clients(portal_access_former_user_id)
  WHERE portal_access_state = 'ended';
COMMENT ON COLUMN public.clients.portal_access_state IS
  'E09 Slice 7: open | paused | ended. Written only by set_client_portal_access (and the guard''s derived transitions). The resolver admits only open.';
COMMENT ON COLUMN public.clients.portal_access_note IS
  'Owner-internal note (<=280). Never shown to the customer and never copied into audit rows.';

-- ── 2. The guard ────────────────────────────────────────────────────────────────────────────────
-- An ACCIDENT guard, not a security boundary for trusted roles: a postgres or service-role session can
-- set paige.portal_access_write itself. It closes the staff path (clients_admins_full is a permissive
-- ALL policy and authenticated holds column UPDATE), so a business admin cannot un-pause through the
-- table and skip the confirm, the version check and the audit. A customer has no row visibility at all
-- (clients_customer_raw_boundary).
CREATE OR REPLACE FUNCTION public._clients_portal_access_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seam boolean := coalesce(pg_catalog.current_setting('paige.portal_access_write', true), '') = '1';
  v_marker text;
  v_survivor public.clients%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_seam AND (NEW.portal_access_state IS DISTINCT FROM 'open'
        OR NEW.portal_access_changed_at IS NOT NULL OR NEW.portal_access_changed_by IS NOT NULL
        OR NEW.portal_access_reason IS NOT NULL OR NEW.portal_access_note IS NOT NULL
        OR NEW.portal_access_former_user_id IS NOT NULL) THEN
      RAISE EXCEPTION 'PORTAL_ACCESS_SEAM_REQUIRED' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- (i) Column write lock. Checked on what the statement asked for, before any derived change below.
  IF NOT v_seam AND ROW(NEW.portal_access_state, NEW.portal_access_changed_at, NEW.portal_access_changed_by,
        NEW.portal_access_reason, NEW.portal_access_note, NEW.portal_access_former_user_id)
      IS DISTINCT FROM ROW(OLD.portal_access_state, OLD.portal_access_changed_at, OLD.portal_access_changed_by,
        OLD.portal_access_reason, OLD.portal_access_note, OLD.portal_access_former_user_id) THEN
    RAISE EXCEPTION 'PORTAL_ACCESS_SEAM_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF NEW.linked_user_id IS DISTINCT FROM OLD.linked_user_id THEN
    IF OLD.linked_user_id IS NULL THEN
      -- (ii) Link set (acceptance, relink, merge transfer, the dead BTF branch). An ended notice belongs
      -- to whoever was cut; once the contact has a login again it is open, and nobody is "former".
      IF NEW.portal_access_state = 'ended' THEN
        NEW.portal_access_state := 'open';
        NEW.portal_access_former_user_id := NULL;
        NEW.portal_access_reason := NULL;
        NEW.portal_access_note := NULL;
        NEW.portal_access_changed_by := NULL;
        NEW.portal_access_changed_at := pg_catalog.clock_timestamp();
      END IF;
    ELSIF NEW.linked_user_id IS NOT NULL THEN
      -- (vi) Relink X→Y. A pause belongs to the person who was paused: it must never silently
      -- move onto someone else (a merge resolution swapping the survivor's identity included).
      IF OLD.portal_access_state <> 'open' AND NOT v_seam THEN
        RAISE EXCEPTION 'PORTAL_ACCESS_PAUSED_LINK_LOCKED' USING ERRCODE = '42501';
      END IF;
    ELSIF NOT v_seam THEN
      -- Unlink by a producer other than the writer.
      IF OLD.portal_access_state = 'paused' AND auth.uid() IS NOT NULL THEN
        -- (iii) A signed-in caller (any allowlisted seam that sets paige.link_ok) may not cut a pause.
        RAISE EXCEPTION 'PORTAL_ACCESS_PAUSED_LINK_LOCKED' USING ERRCODE = '42501';
      END IF;
      -- (iii)/(iv) A trusted no-JWT unlink (the legacy admin-delete-user, the CRM merge's identity
      -- release) ends access honestly: the person's own read then says "ended", whoever cut the link.
      -- A transaction-local marker remembers this row was cut here, and whether it was paused, so the
      -- merge step below can refuse a paused loser and un-end a loser whose person moved to the survivor.
      NEW.portal_access_former_user_id := OLD.linked_user_id;
      IF OLD.portal_access_state = 'open' THEN
        NEW.portal_access_state := 'ended';
        NEW.portal_access_changed_at := pg_catalog.clock_timestamp();
        NEW.portal_access_changed_by := NULL;
        NEW.portal_access_reason := NULL;
        NEW.portal_access_note := NULL;
      ELSE
        NEW.portal_access_state := 'ended';
        NEW.portal_access_changed_at := pg_catalog.clock_timestamp();
      END IF;
      PERFORM pg_catalog.set_config('paige.portal_access_unlinked_' || pg_catalog.replace(OLD.id::text, '-', ''),
        CASE WHEN OLD.portal_access_state = 'paused' THEN 'paused' ELSE 'open' END, true);
    END IF;
  END IF;

  -- (v) Merge. A pause on either side refuses the merge: the owner restores or ends access first.
  IF NEW.merged_into_contact_id IS NOT NULL AND OLD.merged_into_contact_id IS NULL THEN
    v_marker := coalesce(pg_catalog.current_setting(
      'paige.portal_access_unlinked_' || pg_catalog.replace(OLD.id::text, '-', ''), true), '');
    SELECT * INTO v_survivor FROM public.clients s WHERE s.id = NEW.merged_into_contact_id;
    IF OLD.portal_access_state = 'paused' OR v_marker = 'paused' OR v_survivor.portal_access_state = 'paused' THEN
      RAISE EXCEPTION 'CRM_MERGE_PORTAL_ACCESS_PAUSED' USING ERRCODE = '42501';
    END IF;
    -- The loser's identity was released by this merge and now lives on the survivor: the person kept
    -- their access, so the loser is not "ended" (an ended row would be noise on the owner's dashboard).
    IF v_marker = 'open' AND NEW.portal_access_state = 'ended'
       AND NEW.portal_access_former_user_id IS NOT DISTINCT FROM v_survivor.linked_user_id THEN
      NEW.portal_access_state := 'open';
      NEW.portal_access_former_user_id := NULL;
      NEW.portal_access_changed_at := OLD.portal_access_changed_at;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._clients_portal_access_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER trg_clients_portal_access_guard
  BEFORE INSERT OR UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._clients_portal_access_guard();

-- ── 3. The resolver: one added predicate ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_portal_relationship_id(p_tenant_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _ids uuid[];
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  SELECT array_agg(c.id ORDER BY c.id) INTO _ids
  FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active'
    AND c.portal_access_state = 'open'
    AND (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id);
  IF COALESCE(cardinality(_ids), 0) > 1 THEN
    -- Future multi-business support must select a legitimate relationship explicitly.
    -- A tenant argument narrows existing authority; it never supplies authority.
    RAISE EXCEPTION 'select an authorized customer relationship' USING ERRCODE = '42501';
  END IF;
  RETURN _ids[1];
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_relationship_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_relationship_id(uuid) TO authenticated, service_role;

-- ── 4. The one predicate for definer readers that key on the link directly ──────────────────────
-- True iff p_client_id is the caller's OPEN relationship at that contact's business: the same answer
-- the resolver gives, because it IS the resolver (§18 — one WHERE clause, written once). A business
-- scope always holds at most one row per person (clients_tenant_linked_user_key), so it never raises.
CREATE OR REPLACE FUNCTION public.client_portal_access_open(p_client_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_tenant uuid;
BEGIN
  IF p_client_id IS NULL OR auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT c.tenant_id INTO v_tenant FROM public.clients c WHERE c.id = p_client_id;
  IF v_tenant IS NULL THEN RETURN false; END IF;
  RETURN public.client_portal_relationship_id(v_tenant) IS NOT DISTINCT FROM p_client_id;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.client_portal_access_open(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ── 5a. The owner's read ────────────────────────────────────────────────────────────────────────
-- Internal projection of one contact's access for the owner. The caller has been authorized.
CREATE OR REPLACE FUNCTION public._client_portal_access_projection(p_tenant_id uuid, p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.clients%ROWTYPE;
  v_tenant_status text;
  v_joined boolean;
  v_blocked text;
  v_invite text := 'none';
  v_tok record;
  v_by text;
BEGIN
  SELECT * INTO v_row FROM public.clients c WHERE c.id = p_contact_id AND c.tenant_id = p_tenant_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT t.status::text INTO v_tenant_status FROM public.tenants t WHERE t.id = p_tenant_id;
  v_joined := v_row.linked_user_id IS NOT NULL;
  IF v_row.portal_access_state = 'paused' THEN
    v_blocked := CASE
      WHEN v_row.merged_into_contact_id IS NOT NULL THEN 'contact_merged'
      WHEN v_row.status IS DISTINCT FROM 'active' THEN 'contact_inactive'
      WHEN v_tenant_status IS DISTINCT FROM 'active' THEN 'business_inactive' END;
  END IF;
  SELECT tk.revoked_at, tk.last_used_at, tk.expires_at INTO v_tok
  FROM public.tenant_invite_tokens tk
  WHERE tk.contact_id = p_contact_id AND tk.tenant_id = p_tenant_id AND tk.kind = 'consumer'
  ORDER BY tk.created_at DESC, tk.id DESC LIMIT 1;
  IF FOUND THEN
    v_invite := CASE
      WHEN v_tok.last_used_at IS NOT NULL THEN 'accepted'
      WHEN v_tok.revoked_at IS NOT NULL THEN 'canceled'
      WHEN v_tok.expires_at IS NOT NULL AND v_tok.expires_at <= now() THEN 'expired'
      ELSE 'pending' END;
  END IF;
  IF v_row.portal_access_changed_by IS NOT NULL THEN
    SELECT nullif(btrim(p.full_name), '') INTO v_by FROM public.profiles p WHERE p.user_id = v_row.portal_access_changed_by;
  END IF;
  -- Never the customer's user id, email or the former login: the owner sees the contact, not the account.
  RETURN jsonb_build_object(
    'ok', true,
    'contact_id', v_row.id,
    'state', v_row.portal_access_state,
    'joined', v_joined,
    'since', v_row.portal_access_changed_at,
    'changed_by_name', v_by,
    'reason', v_row.portal_access_reason,
    'note', v_row.portal_access_note,
    'invitation', jsonb_build_object('status', v_invite),
    'can', jsonb_build_object(
      'pause', v_joined AND v_row.portal_access_state = 'open',
      'restore', v_row.portal_access_state = 'paused' AND v_blocked IS NULL,
      'end', v_joined,
      'invite', NOT v_joined AND v_row.status = 'active' AND v_row.merged_into_contact_id IS NULL
        AND v_row.do_not_contact IS NOT DISTINCT FROM false),
    'restore_blocked_by', v_blocked);
END $$;
REVOKE ALL ON FUNCTION public._client_portal_access_projection(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Authority, shared by the read and the writer: the authority that GRANTS access (the invitation
-- owner predicate, 20271108233000) is the authority that withholds it. The tenant is always the
-- caller's current workspace, never a parameter that widens anything (§59). Returns the account type.
CREATE OR REPLACE FUNCTION public._client_portal_access_authorize(p_expected_actor_id uuid, p_expected_tenant_id uuid, p_lock boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_actor uuid := auth.uid(); v_tenant uuid; v_type text;
BEGIN
  IF v_actor IS NULL OR p_expected_tenant_id IS NULL
     OR (p_expected_actor_id IS NOT NULL AND v_actor IS DISTINCT FROM p_expected_actor_id)
     OR (p_lock AND p_expected_actor_id IS NULL) THEN
    RAISE EXCEPTION 'PORTAL_ACCESS_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  IF p_lock THEN
    -- A workspace switch updates this same profile row; holding its lock serializes against it.
    PERFORM 1 FROM public.profiles WHERE user_id = v_actor FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_ACCESS_SCOPE_CHANGED' USING ERRCODE = '42501'; END IF;
  END IF;
  v_tenant := public.current_user_tenant_id();
  IF v_tenant IS DISTINCT FROM p_expected_tenant_id THEN
    RAISE EXCEPTION 'PORTAL_ACCESS_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  SELECT t.account_type::text INTO v_type FROM public.tenants t WHERE t.id = v_tenant;
  IF v_type = 'agency' THEN
    -- An agency manages sub-accounts, not a direct client book (§61): there is nothing to act on.
    IF coalesce(public.is_platform_owner(), false) OR coalesce(public.is_tenant_admin(v_tenant), false) THEN
      RETURN 'agency';
    END IF;
    RAISE EXCEPTION 'PORTAL_ACCESS_NOT_AUTHORIZED' USING ERRCODE = '42501';
  END IF;
  BEGIN
    PERFORM public._client_portal_invitation_owner(v_tenant);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'PORTAL_ACCESS_NOT_AUTHORIZED' USING ERRCODE = '42501';
  END;
  RETURN coalesce(v_type, '');
END $$;
REVOKE ALL ON FUNCTION public._client_portal_access_authorize(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_client_portal_access(_expected_tenant_id uuid, _contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_type text; v_out jsonb;
BEGIN
  v_type := public._client_portal_access_authorize(NULL, _expected_tenant_id, false);
  IF v_type = 'agency' THEN RETURN jsonb_build_object('ok', false, 'error', 'PORTAL_ACCESS_UNAVAILABLE'); END IF;
  IF _contact_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST'); END IF;
  v_out := public._client_portal_access_projection(_expected_tenant_id, _contact_id);
  IF v_out IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND'); END IF;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.read_client_portal_access(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_client_portal_access(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.read_client_portal_access(uuid, uuid) IS
  'E09 Slice 7: the owner''s read of one contact''s portal access in the CURRENT workspace (business owner/admin, the invitation authority). Returns state, joined, since (the version token), changed_by_name, reason, note (owner-internal), invitation status, can.*, restore_blocked_by. Never the customer''s user id or email.';

-- ── 5b. The owner's writer ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_client_portal_access(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_contact_id uuid, p_action text,
  p_reason text DEFAULT NULL, p_note text DEFAULT NULL, p_expected_changed_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_type text;
  v_tenant uuid := p_expected_tenant_id;
  v_row public.clients%ROWTYPE;
  v_target text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_tenant_status text;
  v_tokens integer := 0;
  v_links integer := 0;
  v_blocked text;
  v_out jsonb;
BEGIN
  -- 1-2. Caller, current workspace and authority (raises PORTAL_ACCESS_SCOPE_CHANGED / _NOT_AUTHORIZED).
  v_type := public._client_portal_access_authorize(p_expected_actor_id, p_expected_tenant_id, true);
  IF v_type = 'agency' THEN RETURN jsonb_build_object('ok', false, 'error', 'PORTAL_ACCESS_UNAVAILABLE'); END IF;
  -- 4. Inputs.
  v_target := CASE p_action WHEN 'pause' THEN 'paused' WHEN 'restore' THEN 'open' WHEN 'end' THEN 'ended' END;
  IF p_contact_id IS NULL OR v_target IS NULL
     OR (p_action IN ('pause','end') AND (v_reason IS NULL OR v_reason NOT IN
          ('engagement_paused','engagement_ended','payment','client_request','security','other')))
     OR (v_note IS NOT NULL AND length(v_note) > 280) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST');
  END IF;
  BEGIN
    -- 3. Load, in the order invitation acceptance takes its locks (token, then contact), so a
    -- concurrent acceptance and this write serialize instead of deadlocking.
    PERFORM 1 FROM public.tenant_invite_tokens tk
    WHERE tk.contact_id = p_contact_id AND tk.tenant_id = v_tenant AND tk.kind = 'consumer'
      AND tk.revoked_at IS NULL AND tk.last_used_at IS NULL
    ORDER BY tk.id FOR UPDATE;
    SELECT * INTO v_row FROM public.clients c WHERE c.id = p_contact_id AND c.tenant_id = v_tenant FOR UPDATE;
    -- Another workspace's contact is indistinguishable from a missing one.
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND'); END IF;
    -- 5. Transitions. A repeat of a change that already landed answers from the row and writes nothing.
    IF (p_action = 'pause' AND v_row.portal_access_state = 'paused')
       OR (p_action = 'end' AND v_row.portal_access_state = 'ended')
       OR (p_action = 'restore' AND v_row.portal_access_state = 'open' AND v_row.linked_user_id IS NOT NULL) THEN
      RETURN public._client_portal_access_projection(v_tenant, p_contact_id) || jsonb_build_object('replayed', true);
    END IF;
    IF v_row.linked_user_id IS NULL THEN
      -- Not joined: nothing to pause, end or restore. Restoring an ENDED contact is a new invitation.
      RETURN jsonb_build_object('ok', false, 'error', 'NOT_JOINED', 'state', v_row.portal_access_state);
    END IF;
    IF p_action = 'restore' THEN
      SELECT t.status::text INTO v_tenant_status FROM public.tenants t WHERE t.id = v_tenant;
      v_blocked := CASE
        WHEN v_row.merged_into_contact_id IS NOT NULL THEN 'contact_merged'
        WHEN v_row.status IS DISTINCT FROM 'active' THEN 'contact_inactive'
        WHEN v_tenant_status IS DISTINCT FROM 'active' THEN 'business_inactive' END;
      IF v_blocked IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_RESTORE_UNAVAILABLE', 'reason', v_blocked);
      END IF;
    END IF;
    -- 6. Version: the owner acts on exactly the state they last saw. Its own column, never updated_at,
    -- which every CRM edit moves.
    IF p_expected_changed_at IS DISTINCT FROM v_row.portal_access_changed_at THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_CHANGED',
        'state', v_row.portal_access_state, 'since', v_row.portal_access_changed_at);
    END IF;
    -- 7. Write, through the seam, then close it so later triggers in this transaction do not inherit it.
    PERFORM pg_catalog.set_config('paige.portal_access_write', '1', true);
    IF p_action = 'end' THEN PERFORM pg_catalog.set_config('paige.link_ok', '1', true); END IF;
    UPDATE public.clients SET
      portal_access_state = v_target,
      portal_access_changed_at = pg_catalog.clock_timestamp(),
      portal_access_changed_by = v_actor,
      portal_access_reason = CASE WHEN p_action = 'restore' THEN NULL ELSE v_reason END,
      portal_access_note = CASE WHEN p_action = 'restore' THEN NULL ELSE v_note END,
      portal_access_former_user_id = CASE WHEN p_action = 'end' THEN v_row.linked_user_id END,
      linked_user_id = CASE WHEN p_action = 'end' THEN NULL ELSE v_row.linked_user_id END
    WHERE id = v_row.id AND tenant_id = v_tenant;
    PERFORM pg_catalog.set_config('paige.portal_access_write', '', true);
    PERFORM pg_catalog.set_config('paige.link_ok', '', true);
    -- An invitation still open for this contact must not route around the pause or the end.
    IF p_action IN ('pause','end') THEN
      UPDATE public.tenant_invite_tokens tk SET revoked_at = now()
      WHERE tk.contact_id = v_row.id AND tk.tenant_id = v_tenant AND tk.kind = 'consumer'
        AND tk.revoked_at IS NULL AND tk.last_used_at IS NULL;
      GET DIAGNOSTICS v_tokens = ROW_COUNT;
      -- A signing link the PORTAL issued for this relationship (client_portal_open_agreement_signing) stops
      -- working too: it was handed out because access was open, so it must not outlive the pause or the
      -- end (integrator default S7-D1, round 2; the owner may overrule). The portal's link REPLACED the
      -- signer's token, so the current token is the portal's exactly when its latest portal issue is no
      -- older than the business's latest send for that signer. A link the business emailed (and the portal
      -- never replaced) is the business's own act and is left as it is, like invoices and booking links (D5).
      -- Only token_hash is cleared: token_expires_at stays, so a restored client's next portal link can only
      -- keep or shorten that deadline (the opener's least()), and token_revoked_at stays untouched, so the
      -- business can still send a fresh link.
      UPDATE public.paige_agreement_signers s SET token_hash = NULL, updated_at = now()
      FROM public.paige_agreements a
      WHERE a.id = s.agreement_id AND a.tenant_id = v_tenant AND a.contact_id = v_row.id
        AND s.tenant_id = v_tenant AND s.signer_role = 'counterparty'
        AND s.token_hash IS NOT NULL AND s.status IN ('pending','viewed')
        AND EXISTS (SELECT 1 FROM public.paige_audit_log l
                     WHERE l.target_type = 'paige_agreement' AND l.target_id = a.id
                       AND l.action = 'agreement.portal_link_issued' AND l.payload->>'signer_id' = s.id::text
                       AND l.created_at >= coalesce((SELECT max(e.created_at) FROM public.paige_agreement_events e
                                                      WHERE e.agreement_id = a.id AND e.signer_id = s.id
                                                        AND e.event_type IN ('sent','resent')), '-infinity'::timestamptz));
      GET DIAGNOSTICS v_links = ROW_COUNT;
    END IF;
    -- 8. Audit: fixed references only. Never the note, never a name.
    INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
    VALUES (v_actor, 'client_portal',
      CASE p_action WHEN 'pause' THEN 'client_portal.access_paused'
                    WHEN 'restore' THEN 'client_portal.access_restored'
                    ELSE 'client_portal.access_ended' END,
      v_row.id,
      jsonb_build_object('tenant_id', v_tenant, 'contact_id', v_row.id, 'user_id', v_row.linked_user_id,
        'prior_state', v_row.portal_access_state, 'new_state', v_target,
        'reason', CASE WHEN p_action = 'restore' THEN NULL ELSE v_reason END, 'tokens_revoked', v_tokens,
        'signing_links_revoked', v_links));
    -- 9. Result: the owner's read, from the row as it now stands. No notification is sent.
    v_out := public._client_portal_access_projection(v_tenant, v_row.id);
    RETURN v_out || jsonb_build_object('replayed', false);
  EXCEPTION WHEN deadlock_detected OR lock_not_available THEN
    -- Fail-safe either way; say so in the owner's terms instead of a raw lock error.
    RETURN jsonb_build_object('ok', false, 'error', 'ACCESS_CHANGED');
  END;
END $$;
REVOKE ALL ON FUNCTION public.set_client_portal_access(uuid, uuid, uuid, text, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_client_portal_access(uuid, uuid, uuid, text, text, text, timestamptz) TO authenticated;
COMMENT ON FUNCTION public.set_client_portal_access(uuid, uuid, uuid, text, text, text, timestamptz) IS
  'E09 Slice 7: the only writer of clients.portal_access_*. p_action pause | restore | end. Business owner/admin of the CURRENT workspace (the invitation authority); never a top-level agency (PORTAL_ACCESS_UNAVAILABLE). Keyed id + current tenant. Version-guarded on portal_access_changed_at (ACCESS_CHANGED); state-idempotent (replayed:true writes nothing). pause/end revoke every open consumer invitation for the contact and every agreement-signing link the portal issued for it (an emailed link stays); end clears the link and remembers the former login. Audited as client_portal.access_paused | _restored | _ended with fixed references. No notification is sent; no session, role, membership or Auth user is touched.';

-- ── 5c. The customer's honest read ──────────────────────────────────────────────────────────────
-- Works WITHOUT an open relationship, keyed on auth.uid() only and taking no argument, so it can never
-- be pointed at anyone else. Business presentation fields only; never the reason, note, contact or tenant id.
CREATE OR REPLACE FUNCTION public.client_portal_access_state()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
  v_hit record;
  v_brand record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  BEGIN
    v_id := public.client_portal_relationship_id(NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN jsonb_build_object('state', 'multiple');
  END;
  IF v_id IS NOT NULL THEN RETURN jsonb_build_object('state', 'open'); END IF;
  SELECT c.tenant_id, c.portal_access_state AS state, c.portal_access_changed_at AS since INTO v_hit
  FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE (c.linked_user_id = v_uid AND c.portal_access_state = 'paused' AND c.status = 'active'
          AND c.merged_into_contact_id IS NULL AND t.status = 'active')
     OR (c.portal_access_former_user_id = v_uid AND c.portal_access_state = 'ended' AND c.linked_user_id IS NULL)
  ORDER BY c.portal_access_changed_at DESC NULLS LAST, c.id
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'none'); END IF;
  SELECT rb.tenant_name, COALESCE(rb.logo_url, p.brand_logo_url) AS logo_url, rb.logo_dark_url INTO v_brand
  FROM public.resolve_tenant_brand(v_hit.tenant_id) rb
  LEFT JOIN public.tenant_legal_profile p ON p.tenant_id = v_hit.tenant_id;
  RETURN jsonb_build_object('state', v_hit.state, 'since', v_hit.since,
    'business', jsonb_build_object('name', v_brand.tenant_name, 'logo_url', v_brand.logo_url,
      'logo_dark_url', v_brand.logo_dark_url));
END $$;
REVOKE ALL ON FUNCTION public.client_portal_access_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_access_state() TO authenticated, service_role;
COMMENT ON FUNCTION public.client_portal_access_state() IS
  'E09 Slice 7: the signed-in person''s own portal access state: open | paused | ended | multiple | none, plus the business name and logo for paused/ended. Keyed on auth.uid() only.';

-- ── 6. Bypass readers: the predicate only (§37) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_client_rail(p_contact_id uuid, p_limit integer DEFAULT 50, p_lens text DEFAULT 'coach'::text)
 RETURNS TABLE(id uuid, event_kind text, surface text, actor_type text, actor_user_id uuid, audience text, visibility text, from_department text, to_department text, title text, summary text, payload jsonb, ref_table text, ref_id uuid, occurred_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid        uuid := auth.uid();
  v_tenant     uuid;
  v_is_staff   boolean;
  v_is_subject boolean;
  v_lens       text;
  v_limit      integer := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'RAIL_FORBIDDEN';
  end if;

  select c.tenant_id into v_tenant from public.clients c where c.id = p_contact_id;

  -- Same error as a permission refusal, on purpose: a caller must not learn whether a client id
  -- exists by comparing responses.
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'RAIL_FORBIDDEN';
  end if;

  -- THE CORRECTION. The active-workspace boundary is kept, and the role is now read from the
  -- caller's membership OF THAT SAME WORKSPACE, so a role earned elsewhere can no longer satisfy it.
  v_is_staff := public.is_platform_owner()
             or (
                  v_tenant = public.current_user_tenant_id()
                  and exists (
                    select 1
                      from public.tenant_members m
                     where m.user_id   = v_uid
                       and m.tenant_id = v_tenant
                       and m.status    = 'active'
                       and m.role in ('owner', 'admin')
                  )
                );

  -- A client reading their own rail is a proven audience while their portal access is open (E09 Slice 7).
  v_is_subject := public.client_portal_access_open(p_contact_id);

  if not v_is_staff and not v_is_subject then
    raise exception using errcode = '42501', message = 'RAIL_FORBIDDEN';
  end if;

  v_lens := case when v_is_staff and p_lens in ('coach','owner','staff') then 'staff' else 'client' end;

  return query
  select e.id, e.event_kind, e.surface, e.actor_type,
         case when v_lens = 'staff' then e.actor_user_id   else null end,
         e.audience,
         case when v_lens = 'staff' then e.visibility       else 'client_visible' end,
         case when v_lens = 'staff' then e.from_department  else null end,
         case when v_lens = 'staff' then e.to_department    else null end,
         e.title, e.summary,
         case when v_lens = 'staff' then e.payload          else '{}'::jsonb end,
         case when v_lens = 'staff' then e.ref_table        else null end,
         case when v_lens = 'staff' then e.ref_id           else null end,
         e.occurred_at
  from public.paige_client_events e
  where e.contact_id = p_contact_id
    and (v_lens = 'staff'
         or (e.audience in ('client','both') and e.visibility = 'client_visible'))
  order by e.occurred_at desc
  limit v_limit;
end
$function$;

CREATE OR REPLACE FUNCTION public.get_client_rail_for_chat(p_contact_id uuid, p_limit integer DEFAULT 25)
 RETURNS TABLE(event_kind text, title text, occurred_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid        uuid := auth.uid();
  v_tenant     uuid;
  v_is_staff   boolean;
  v_is_subject boolean;
  v_limit      integer := least(greatest(coalesce(p_limit, 25), 1), 200);
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'RAIL_FORBIDDEN';
  end if;

  select c.tenant_id into v_tenant from public.clients c where c.id = p_contact_id;

  if v_tenant is null then
    raise exception using errcode = '42501', message = 'RAIL_FORBIDDEN';
  end if;

  v_is_staff := public.is_platform_owner()
             or (
                  v_tenant = public.current_user_tenant_id()
                  and exists (
                    select 1
                      from public.tenant_members m
                     where m.user_id   = v_uid
                       and m.tenant_id = v_tenant
                       and m.status    = 'active'
                       and m.role in ('owner', 'admin')
                  )
                );

  v_is_subject := public.client_portal_access_open(p_contact_id);

  if not v_is_staff and not v_is_subject then
    raise exception using errcode = '42501', message = 'RAIL_FORBIDDEN';
  end if;

  -- Same audience policy as the reader above, so Chat can never see rows a staff caller could not:
  -- staff any audience (proven), a client-subject only their own client-visible events.
  return query
  select e.event_kind, e.title, e.occurred_at
  from public.paige_client_events e
  where e.contact_id = p_contact_id
    and (v_is_staff
         or (e.audience in ('client','both') and e.visibility = 'client_visible'))
  order by e.occurred_at desc
  limit v_limit;
end
$function$;

CREATE OR REPLACE FUNCTION public.can_access_rail_topic(_topic text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant     uuid := public.current_user_tenant_id();
  v_uid        uuid := auth.uid();
  v_contact_id uuid;
  v_ct_tenant  uuid;
BEGIN
  IF v_uid IS NULL OR _topic IS NULL THEN
    RETURN false;
  END IF;

  -- Owner topic: this caller's own tenant, and a staff/owner role.
  IF v_tenant IS NOT NULL AND _topic = 'rail:tenant:' || v_tenant::text THEN
    RETURN public.is_platform_owner()
        OR public.has_any_role(v_uid, ARRAY['admin','super_admin']);
  END IF;

  -- Client topic: parse the contact uuid after the prefix; a non-uuid is not
  -- an error, just a non-match. A guessed cross-tenant contact must fail.
  IF _topic LIKE 'rail:client:%' THEN
    BEGIN
      v_contact_id := substring(_topic FROM 13)::uuid;  -- 'rail:client:' is 12 chars
    EXCEPTION WHEN others THEN
      RETURN false;
    END;

    SELECT c.tenant_id INTO v_ct_tenant FROM public.clients c WHERE c.id = v_contact_id;
    IF v_ct_tenant IS NULL THEN
      RETURN false;
    END IF;

    -- The subject client themselves while their portal access is open (the shared resolver
    -- predicate: active, unmerged, active business, state open), OR the platform owner, OR
    -- same-tenant staff.
    RETURN public.client_portal_access_open(v_contact_id)
        OR public.is_platform_owner()
        OR (v_ct_tenant = v_tenant
            AND public.has_any_role(v_uid, ARRAY['admin','super_admin']));
  END IF;

  -- STEP 6 — God firehose: the cross-tenant platform stream is subscribable ONLY
  -- by the platform owner (§9). READ-only surface — no one broadcasts via it.
  IF _topic = 'rail:platform' THEN
    RETURN public.is_platform_owner();
  END IF;

  RETURN false;
END $function$;

CREATE OR REPLACE FUNCTION public.get_client_service_agreement()
 RETURNS TABLE(tenant_name text, agreement_title text, agreement_body text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT t.name, p.service_agreement_title, p.service_agreement_body
  FROM public.clients c
  JOIN public.tenants t ON t.id = c.tenant_id
  LEFT JOIN public.tenant_legal_profile p ON p.tenant_id = t.id
  WHERE c.linked_user_id = auth.uid()
    AND public.client_portal_access_open(c.id)
  ORDER BY c.created_at ASC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_workspace_brand()
 RETURNS TABLE(tenant_id uuid, tenant_name text, white_label_ai_connect boolean, brand_display_name text, brand_logo_url text, legal_business_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    COALESCE(p.white_label_ai_connect, true) AS white_label_ai_connect,
    p.brand_display_name,
    p.brand_logo_url,
    p.legal_business_name
  FROM public.clients c
  JOIN public.tenants t ON t.id = c.tenant_id
  LEFT JOIN public.tenant_legal_profile p ON p.tenant_id = t.id
  WHERE c.linked_user_id = auth.uid()
    AND public.client_portal_access_open(c.id)
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_paige_persona_context()
 RETURNS TABLE(tenant_id uuid, tenant_name text, playbook_config jsonb, playbook_slug text, funding_enabled boolean, brand jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _tid uuid;
begin
  select c.tenant_id into _tid
  from public.clients c
  where c.linked_user_id = auth.uid()
    and public.client_portal_access_open(c.id)
  order by c.created_at asc
  limit 1;

  if _tid is null then _tid := public.current_user_tenant_id(); end if;
  if _tid is null then return; end if;

  return query
  select
    t.id,
    t.name,
    t.features -> 'playbook_config',
    nullif(t.features ->> 'playbook', ''),
    coalesce(
      exists (
        select 1 from public.marketplace_installs mi
        join public.marketplace_items it on it.id = mi.item_id
        where mi.tenant_id = t.id and mi.status = 'active' and it.is_finance = true
      ) or (t.features ->> 'finance_in_scope')::boolean,
      false
    ),
    (select to_jsonb(rb) from public.resolve_tenant_brand(_tid) rb)
      || jsonb_build_object('business_brief', t.brand -> 'business_brief')
  from public.tenants t
  where t.id = _tid;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_program_client_owner(_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS (SELECT 1 FROM public.clients WHERE id = _client_id AND linked_user_id = auth.uid()) AND public.client_portal_access_open(_client_id); $function$;
-- Every consuming policy (program_*, agreements, intake, payment authorizations) is TO authenticated.
REVOKE ALL ON FUNCTION public.is_program_client_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_program_client_owner(uuid) TO authenticated, service_role;

-- INVOKER. A pure customer's own read of clients is refused by clients_customer_raw_boundary, so for them
-- these answer NO_LINKED_CONTACT whatever the state. The predicate is NOT redundant, though (round 2,
-- verifier finding 2): a member of the business who is also linked as its client (the open §58 self-link
-- path) reads that row through the staff policy, and only this predicate keeps a paused or ended link from
-- loading their client context (pinned in customer_portal_access_doors.sql). anon never had a reason to call them.
CREATE OR REPLACE FUNCTION public.load_self_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_id uuid;
BEGIN
  SELECT id INTO v_contact_id FROM public.clients WHERE linked_user_id = auth.uid() AND portal_access_state = 'open' LIMIT 1;
  IF v_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LINKED_CONTACT');
  END IF;
  RETURN public.load_contact_context(v_contact_id, ARRAY['contact','self']::text[]);
END;
$function$;
REVOKE ALL ON FUNCTION public.load_self_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.load_self_context() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.customer_paige_activity_summary(p_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_id uuid;
  v_count int;
  v_last timestamptz;
BEGIN
  SELECT id INTO v_contact_id FROM public.clients WHERE linked_user_id = auth.uid() AND portal_access_state = 'open' LIMIT 1;
  IF v_contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LINKED_CONTACT');
  END IF;
  SELECT count(*), max(created_at) INTO v_count, v_last
  FROM public.paige_context_loads
  WHERE contact_id = v_contact_id
    AND consent_state = 'granted'
    AND created_at > now() - make_interval(days => p_days);
  RETURN jsonb_build_object('ok', true, 'window_days', p_days, 'count', v_count, 'last_at', v_last);
END;
$function$;
REVOKE ALL ON FUNCTION public.customer_paige_activity_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_paige_activity_summary(integer) TO authenticated, service_role;

-- The linked-customer branch takes an explicit user (service-role callers pass one), so it checks the
-- row's state directly rather than the auth.uid()-keyed helper.
CREATE OR REPLACE FUNCTION public.can_access_contact(_user_id uuid, _contact_id uuid, _allow_linked_customer boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin(_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.clients c
      WHERE c.id = _contact_id
        AND (
          public.agency_can_manage_child(c.tenant_id, _user_id)
          OR EXISTS (
            SELECT 1 FROM public.tenant_members tm
            WHERE tm.tenant_id = c.tenant_id
              AND tm.user_id = _user_id
              AND tm.status = 'active'
              AND tm.role IN ('owner','admin')
          )
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = _contact_id
        AND (
          c.lead_owner_user_id = _user_id
          OR c.cs_primary_user_id = _user_id
          OR c.assigned_coach_user_id = _user_id
          OR (_allow_linked_customer IS TRUE AND c.linked_user_id = _user_id AND c.portal_access_state = 'open')
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.paige_coach_assignments a
      WHERE a.contact_id = _contact_id
        AND a.active = true
        AND a.rep_user_id = _user_id
    );
$function$;

-- Reports `accepted` only while access is open; a paused or ended relationship says so.
CREATE OR REPLACE FUNCTION public.client_portal_invite_status(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE _uid uuid := auth.uid(); _result jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('tenant_id',c.tenant_id,'client_id',c.id,
    'accepted_at',t.last_used_at,
    'status',CASE c.portal_access_state WHEN 'open' THEN 'accepted' ELSE c.portal_access_state END) INTO _result
  FROM public.tenant_invite_tokens t
  JOIN public.clients c ON c.id=t.contact_id AND c.tenant_id=t.tenant_id
  JOIN public.tenants b ON b.id=c.tenant_id AND b.status='active'
  JOIN auth.users u ON u.id=_uid AND u.email_confirmed_at IS NOT NULL
  WHERE t.token=p_token AND t.kind='consumer' AND t.revoked_at IS NULL
    AND t.uses=1 AND t.last_used_at IS NOT NULL
    AND ((c.linked_user_id=_uid AND c.portal_access_state IN ('open','paused'))
      OR (c.linked_user_id IS NULL AND c.portal_access_state='ended' AND c.portal_access_former_user_id=_uid))
    AND c.status='active' AND c.merged_into_contact_id IS NULL
    AND lower(btrim(u.email))=lower(btrim(t.email))
    AND EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.entity_id=t.id
      AND a.entity='client_portal' AND a.action='consumer_invite_accepted' AND a.user_id=_uid
      AND a.data->>'client_id'=c.id::text AND a.data->>'tenant_id'=c.tenant_id::text);
  RETURN _result;
END;
$function$;

-- Re-grants nothing for a relationship that is not open; it never removes a role.
CREATE OR REPLACE FUNCTION public.ensure_client_role_self_heal()
 RETURNS TABLE(healed boolean, onboarding_stage text, client_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_client_id uuid;
  v_stage text;
  v_had_role boolean;
  v_healed boolean := false;
BEGIN
  IF v_user IS NULL THEN
    RETURN;
  END IF;

  SELECT id, clients.onboarding_stage INTO v_client_id, v_stage
  FROM public.clients
  WHERE linked_user_id = v_user
    AND portal_access_state = 'open'
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = v_user AND role = 'client'
  ) INTO v_had_role;

  IF NOT v_had_role THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user, 'client')
    ON CONFLICT (user_id, role) DO NOTHING;
    v_healed := true;
  END IF;

  IF v_stage IS NULL THEN
    UPDATE public.clients
       SET onboarding_stage = 'invited'
     WHERE id = v_client_id;
    v_stage := 'invited';
    v_healed := true;
  END IF;

  IF v_healed THEN
    BEGIN
      INSERT INTO public.paige_audit_log (actor_user_id, action, target_type, target_id, payload)
      VALUES (v_user, 'client_role_self_heal', 'client', v_client_id,
              jsonb_build_object('granted_role', NOT v_had_role, 'seeded_stage', v_stage));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN QUERY SELECT v_healed, v_stage, v_client_id;
END;
$function$;

-- Documents' body (20271110200000: clients.status / tenants.status 'active'), plus the access state.
-- decide_scoped and reviews_scoped read through it.
create or replace function public.operations_delivery_client_read_scoped(p_release_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_result jsonb;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id then
    raise exception 'DELIVERY_CLIENT_UNAVAILABLE' using errcode='42501'; end if;
  select jsonb_build_object('actor_id',v_actor,'tenant_id',r.tenant_id,'release_id',r.id,
    'submission_id',s.id,'state',r.state,'revision_no',s.revision_no,'artifact_digest',s.artifact_digest,
    'title',a.snapshot->>'title','body',a.snapshot->>'body','updated_at',r.updated_at,
    'decision_by',r.decision_by,'decision_at',r.decision_at,'client_note',r.client_note)
  into v_result from public.operations_delivery_client_releases r
  join public.operations_delivery_submissions s on s.id=r.submission_id and s.tenant_id=r.tenant_id and s.client_id=r.client_id
  join public.clients c on c.id=r.client_id and c.tenant_id=r.tenant_id and c.linked_user_id=r.client_user_id and c.merged_into_contact_id is null and c.status='active' and c.portal_access_state='open'
  join public.tenants t on t.id=r.tenant_id and t.account_type::text='standalone' and t.parent_tenant_id is null and t.status='active'
  join public.plans p on p.id=s.plan_id and p.tenant_id=r.tenant_id and p.status<>'archived'
  join public.plan_items w on w.id=s.work_item_id and w.tenant_id=r.tenant_id and w.plan_id=p.id and w.contact_id=c.id and w.status<>'cancelled'
  join public.studio_artifact_versions a on a.id=s.artifact_version_id and a.tenant_id=r.tenant_id
  where r.id=p_release_id and r.tenant_id=p_expected_tenant_id and r.client_user_id=v_actor and s.state='approved'
    and not exists(select 1 from public.tenant_members where tenant_id=r.tenant_id and user_id=v_actor and status='active')
    and not exists(select 1 from public.operations_delivery_submissions where work_item_id=s.work_item_id and revision_no>s.revision_no)
    and encode(extensions.digest(a.snapshot::text,'sha256'),'hex')=s.artifact_digest
    and a.kind='content' and a.snapshot->>'kind'='text';
  if v_result is null then raise exception 'DELIVERY_CLIENT_UNAVAILABLE' using errcode='42501'; end if;
  return v_result;
end $$;
revoke all on function public.operations_delivery_client_read_scoped(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.operations_delivery_client_read_scoped(uuid,uuid,uuid) to authenticated;

-- The two gate checks gain the access state; each row still goes through read_scoped, which carries it too.
-- The candidate join deliberately does NOT (round 2, verifier finding 2): the opening gate has just proven this
-- person's one row at this business open (one row per person per business), the per-row read_scoped refuses a
-- row whose client is not open, and the closing gate refuses the whole answer if a pause landed during the loop.
-- A predicate there could change no outcome, so no test could ever see it removed.
CREATE OR REPLACE FUNCTION public.operations_delivery_client_reviews_scoped(p_expected_actor_id uuid, p_expected_tenant_id uuid, p_limit integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid:=auth.uid();v_candidate record;v_artifact jsonb;
  v_releases jsonb:='[]'::jsonb;v_scanned integer:=0;v_unavailable integer:=0;v_more boolean:=false;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id
    or not exists(select 1 from public.tenants where id=p_expected_tenant_id
      and account_type::text='standalone' and parent_tenant_id is null)
    or exists(select 1 from public.tenant_members where tenant_id=p_expected_tenant_id
      and user_id=v_actor and status='active')
    or not exists(select 1 from public.clients where tenant_id=p_expected_tenant_id
      and linked_user_id=v_actor and merged_into_contact_id is null and portal_access_state='open') then
    raise exception 'DELIVERY_CLIENT_REVIEWS_UNAVAILABLE' using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>40 then
    raise exception 'DELIVERY_CLIENT_REVIEWS_LIMIT_INVALID' using errcode='22023';
  end if;
  for v_candidate in
    select r.id,r.submission_id,r.state,r.updated_at,s.revision_no,s.artifact_digest
    from public.operations_delivery_client_releases r
    join public.clients c on c.id=r.client_id and c.tenant_id=r.tenant_id
      and c.linked_user_id=r.client_user_id and c.merged_into_contact_id is null
    join public.operations_delivery_submissions s on s.id=r.submission_id
      and s.tenant_id=r.tenant_id and s.client_id=r.client_id
    where r.tenant_id=p_expected_tenant_id and r.client_user_id=v_actor
      and not exists(select 1 from public.operations_delivery_submissions newer
        where newer.tenant_id=s.tenant_id and newer.work_item_id=s.work_item_id and newer.revision_no>s.revision_no)
    order by r.released_at desc,r.id limit p_limit+1
  loop
    v_scanned:=v_scanned+1;
    if v_scanned>p_limit then v_more:=true;exit;end if;
    begin
      -- The exact existing artifact reader, including current linked identity,
      -- nonstaff/tenant/work/source/latest/digest gates, owns all per-row authority.
      v_artifact:=public.operations_delivery_client_read_scoped(v_candidate.id,v_actor,p_expected_tenant_id);
    exception when sqlstate '42501' or sqlstate '40001' or sqlstate '22023' then
      v_unavailable:=v_unavailable+1;continue;
    end;
    if v_artifact->>'actor_id' is distinct from v_actor::text
      or v_artifact->>'tenant_id' is distinct from p_expected_tenant_id::text
      or v_artifact->>'release_id' is distinct from v_candidate.id::text
      or v_artifact->>'submission_id' is distinct from v_candidate.submission_id::text
      or v_artifact->>'state' is distinct from v_candidate.state
      or v_artifact->>'revision_no' is distinct from v_candidate.revision_no::text
      or v_artifact->>'artifact_digest' is distinct from v_candidate.artifact_digest
      or (v_artifact->>'updated_at')::timestamptz is distinct from v_candidate.updated_at
      or not exists(select 1 from public.operations_delivery_client_releases current_r
        join public.clients current_c on current_c.id=current_r.client_id and current_c.tenant_id=current_r.tenant_id
          and current_c.linked_user_id=v_actor and current_c.merged_into_contact_id is null
        join public.operations_delivery_submissions current_s on current_s.id=current_r.submission_id
          and current_s.tenant_id=current_r.tenant_id and current_s.client_id=current_r.client_id
        where current_r.id=v_candidate.id and current_r.tenant_id=p_expected_tenant_id
          and current_r.client_user_id=v_actor and current_r.submission_id=v_candidate.submission_id
          and current_r.state=v_candidate.state and current_r.updated_at=v_candidate.updated_at
          and current_s.revision_no=v_candidate.revision_no and current_s.artifact_digest=v_candidate.artifact_digest
          and not exists(select 1 from public.operations_delivery_submissions newer
            where newer.tenant_id=current_s.tenant_id and newer.work_item_id=current_s.work_item_id
              and newer.revision_no>current_s.revision_no)) then
      v_unavailable:=v_unavailable+1;continue;
    end if;
    v_releases:=v_releases||jsonb_build_array(jsonb_build_object('release_id',v_candidate.id,
      'submission_id',v_candidate.submission_id,'state',v_candidate.state,'revision_no',v_candidate.revision_no,
      'artifact_digest',v_candidate.artifact_digest,'title',v_artifact->>'title','updated_at',v_candidate.updated_at));
  end loop;
  if not exists(select 1 from public.tenants where id=p_expected_tenant_id
      and account_type::text='standalone' and parent_tenant_id is null)
    or exists(select 1 from public.tenant_members where tenant_id=p_expected_tenant_id and user_id=v_actor and status='active')
    or not exists(select 1 from public.clients where tenant_id=p_expected_tenant_id and linked_user_id=v_actor and merged_into_contact_id is null and portal_access_state='open') then
    raise exception 'DELIVERY_CLIENT_REVIEWS_UNAVAILABLE' using errcode='42501';
  end if;
  return jsonb_build_object('actor_id',v_actor,'tenant_id',p_expected_tenant_id,
    'releases',v_releases,'unavailable_count',v_unavailable,'has_more',v_more);
end $function$;

-- Storage: the linked-customer arm goes through the resolver (authenticated may call it; the internal
-- helper is not exposed). Under storage RLS this subquery already cannot see a customer's clients row,
-- so this arm is closed today; restated as defence in depth. Staff arms unchanged.
DROP POLICY IF EXISTS signed_agreements_read ON storage.objects;
CREATE POLICY signed_agreements_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'btf-onboarding'
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = NULLIF((storage.foldername(name))[1], '')::uuid
        AND (
             (c.linked_user_id = auth.uid() AND public.client_portal_relationship_id(c.tenant_id) = c.id)
          OR c.tenant_id = public.current_user_tenant_id()
          OR public.is_platform_owner()
        )
    )
  );

-- ── 7. Notices to the person stop while access is not open ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.comms_portal_reply(p_tenant_id uuid, p_contact_id uuid, p_body text, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _client public.clients%ROWTYPE;
  _tenant_name text;
  _body text := public._portal_message_body(p_body);
  _existing public.messages%ROWTYPE;
  _row public.messages%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  -- The same authority that reads this inbox (messages_select): current workspace, business admin.
  IF p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_user_tenant_id()
    OR NOT public.is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not authorized for this business inbox' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_REQUIRED'); END IF;
  IF _body IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_BODY'); END IF;
  -- The customer side only works for an active business, so a reply to an inactive one would be unseen.
  PERFORM 1 FROM public.tenants t WHERE t.id = p_tenant_id AND t.status = 'active' FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'WORKSPACE_INACTIVE'); END IF;
  SELECT c.* INTO _client FROM public.clients c
  WHERE c.id = p_contact_id AND c.tenant_id = p_tenant_id AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL
  FOR SHARE OF c;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND'); END IF;
  IF _client.linked_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'PORTAL_NOT_CONNECTED'); END IF;
  -- E09 Slice 7: a paused client cannot read the portal, so nothing is posted and no notice is sent.
  IF _client.portal_access_state IS DISTINCT FROM 'open' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PORTAL_ACCESS_PAUSED');
  END IF;

  SELECT * INTO _existing FROM public.messages
  WHERE channel_type = 'portal' AND meta #>> '{portal,request_id}' = p_request_id::text;
  IF FOUND THEN
    IF _existing.tenant_id = p_tenant_id AND _existing.contact_id = _client.id AND _existing.direction = 'outbound'
      AND _existing.meta #>> '{portal,author_user_id}' = _uid::text AND _existing.body_text = _body THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'message_id', _existing.id, 'created_at', _existing.created_at);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
  END IF;

  SELECT t.name INTO _tenant_name FROM public.tenants t WHERE t.id = p_tenant_id;
  BEGIN
    INSERT INTO public.messages (tenant_id, thread_key, contact_id, channel_type, direction, status,
      sender, recipients, body_text, meta, sent_at)
    VALUES (p_tenant_id, 'contact:' || p_tenant_id::text || ':' || _client.id::text, _client.id,
      'portal', 'outbound', 'delivered',
      jsonb_build_object('kind', 'business', 'user_id', _uid), '[]'::jsonb, _body,
      jsonb_build_object('portal', jsonb_build_object('request_id', p_request_id, 'author_user_id', _uid,
        'author_role', 'business', 'kind', 'message')),
      now())
    RETURNING * INTO _row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO _existing FROM public.messages
    WHERE channel_type = 'portal' AND meta #>> '{portal,request_id}' = p_request_id::text;
    IF FOUND AND _existing.contact_id = _client.id AND _existing.direction = 'outbound'
      AND _existing.meta #>> '{portal,author_user_id}' = _uid::text AND _existing.body_text = _body THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'message_id', _existing.id, 'created_at', _existing.created_at);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
  END;
  -- In-app notice for the customer. Content stays in the portal; no provider is contacted.
  INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
  VALUES (_client.linked_user_id, 'system',
    coalesce('New message from ' || nullif(btrim(_tenant_name), ''), 'New message from your team'),
    'Open your messages to read and reply.', '/app/messages',
    jsonb_build_object('kind', 'portal_message', 'message_id', _row.id, 'tenant_id', p_tenant_id));
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'message_id', _row.id, 'created_at', _row.created_at);
END;
$function$;

-- admin_propose_paige_actions and the readiness-approval trigger notify the linked person only while open.
-- 8. start_client_impersonation names the state; _create_client_with_contact_methods refuses the columns.
CREATE OR REPLACE FUNCTION public.admin_propose_paige_actions(p_contact_id uuid, p_actions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_contact_tenant uuid;
  v_client_user uuid;
  v_consent boolean;
  v_action jsonb;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  END IF;
  IF p_contact_id IS NULL OR p_actions IS NULL OR jsonb_typeof(p_actions) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  END IF;

  v_tenant := public.current_user_tenant_id();
  IF v_tenant IS NULL AND NOT public.is_platform_owner() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_TENANT');
  END IF;

  SELECT c.tenant_id,
         -- E09 Slice 7: a person whose portal access is not open is not notified (the action still waits for them).
         CASE WHEN c.portal_access_state = 'open' THEN c.linked_user_id END,
         c.paige_shared_context_consent
    INTO v_contact_tenant, v_client_user, v_consent
  FROM public.clients c WHERE c.id = p_contact_id;

  IF v_contact_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND');
  END IF;
  IF NOT public.is_platform_owner() AND v_contact_tenant <> v_tenant THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CROSS_TENANT_FORBIDDEN');
  END IF;

  IF NOT (
    public.has_role(v_uid,'admin'::public.app_role)
    OR public.has_role(v_uid,'super_admin'::public.app_role)
    OR public.is_platform_owner()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF NOT v_consent THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONSENT_NOT_GRANTED',
      'message', 'Customer has not consented to Paige-brokered actions.');
  END IF;

  FOR v_action IN SELECT * FROM jsonb_array_elements(p_actions)
  LOOP
    INSERT INTO public.paige_customer_actions(
      tenant_id, contact_id, initiated_by_admin_id,
      action_type, title, body, payload_json, status
    ) VALUES (
      v_contact_tenant, p_contact_id, v_uid,
      COALESCE(v_action->>'action_type','recommendation'),
      COALESCE(v_action->>'title','Recommendation'),
      NULLIF(v_action->>'body',''),
      COALESCE(v_action->'payload','{}'::jsonb),
      'customer_notified'
    ) RETURNING id INTO v_new_id;
    v_ids := array_append(v_ids, v_new_id);

    IF v_client_user IS NOT NULL THEN
      INSERT INTO public.notifications(user_id, type, title, message, action_url, metadata)
      VALUES (
        v_client_user, 'system'::public.notification_type,
        'New action item from your team',
        COALESCE(v_action->>'title','Your team shared a new step with you'),
        '/app/actions',
        jsonb_build_object('source','paige_customer_action','action_id', v_new_id)
      );
    END IF;
  END LOOP;

  INSERT INTO public.paige_audit_log(actor_user_id, tenant_id, action, target_type, target_id, payload)
  VALUES (
    v_uid, v_contact_tenant, 'admin_propose_paige_actions', 'paige_customer_action', p_contact_id,
    jsonb_build_object('count', array_length(v_ids,1), 'ids', v_ids)
  );

  RETURN jsonb_build_object('ok', true, 'count', array_length(v_ids,1), 'ids', v_ids);
END; $function$;

CREATE OR REPLACE FUNCTION public.notify_client_on_readiness_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_linked_user uuid;
  v_first_name text;
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    SELECT CASE WHEN c.portal_access_state = 'open' THEN c.linked_user_id END, c.first_name
      INTO v_linked_user, v_first_name
      FROM public.clients c
     WHERE c.id = NEW.contact_id;

    IF v_linked_user IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, message, action_url, metadata)
      VALUES (
        v_linked_user,
        'system',
        'Your coach has a new readiness update',
        COALESCE(v_first_name, 'Your coach') || ' has a new funding readiness update ready for you to review.',
        '/app',
        jsonb_build_object(
          'source', 'readiness_proposal_approved',
          'proposal_id', NEW.id,
          'tenant_id', NEW.tenant_id
        )
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_client_impersonation(p_contact_id uuid)
 RETURNS TABLE(contact_id uuid, linked_user_id uuid, client_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_row    record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT public.can_access_contact(v_caller, p_contact_id) THEN
    RAISE EXCEPTION 'not authorized for this contact';
  END IF;

  SELECT c.id, c.linked_user_id, c.agreement_signed_at, c.onboarding_stage, c.portal_access_state,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''),
                  public.client_primary_address(c.id, 'email'),
                  'Client') AS name
    INTO v_row
  FROM public.clients c
  WHERE c.id = p_contact_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact not found';
  END IF;

  -- E09 Slice 7: name the access state instead of "has not accepted" for a client who had.
  IF v_row.portal_access_state = 'ended' THEN
    RAISE EXCEPTION 'client portal access has ended';
  END IF;
  IF v_row.portal_access_state = 'paused' THEN
    RAISE EXCEPTION 'client portal access is paused';
  END IF;

  IF v_row.linked_user_id IS NULL THEN
    RAISE EXCEPTION 'client has not accepted their invite yet';
  END IF;

  IF v_row.agreement_signed_at IS NULL THEN
    RAISE EXCEPTION 'client has not signed the agreement yet';
  END IF;

  IF v_row.onboarding_stage <> 'completed' THEN
    RAISE EXCEPTION 'client has not completed onboarding (stage: %)', v_row.onboarding_stage;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, data)
  VALUES (v_caller, 'impersonation.start', 'client', v_row.id,
          jsonb_build_object('linked_user_id', v_row.linked_user_id, 'client_name', v_row.name));

  contact_id := v_row.id;
  linked_user_id := v_row.linked_user_id;
  client_name := v_row.name;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public._create_client_with_contact_methods(_tenant_id uuid, _client jsonb, _methods jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _refused text;
  _columns text;
  _values text;
  _list jsonb;
  _id uuid;
BEGIN
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_TENANT: a contact belongs to a workspace' USING ERRCODE = '22023';
  END IF;
  IF _client IS NULL OR pg_catalog.jsonb_typeof(_client) <> 'object' THEN
    RAISE EXCEPTION 'CONTACT_FIELDS_INVALID: the contact''s fields are a JSON object' USING ERRCODE = '22023';
  END IF;
  IF _methods IS NOT NULL AND pg_catalog.jsonb_typeof(_methods) <> 'array' THEN
    RAISE EXCEPTION 'CONTACT_METHODS_INVALID: the contact''s addresses are a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.string_agg(k, ', ' ORDER BY k) INTO _refused
    FROM pg_catalog.jsonb_object_keys(_client) AS k
   WHERE k IN ('id', 'tenant_id', 'email', 'phone')
      -- E09 Slice 7: portal access is set only by set_client_portal_access, never at creation.
      OR k LIKE 'portal\_access\_%'
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a
                      WHERE a.attrelid = 'public.clients'::regclass
                        AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped);
  IF _refused IS NOT NULL THEN
    RAISE EXCEPTION 'CONTACT_FIELDS_REFUSED: % cannot be set when creating a contact', _refused
      USING ERRCODE = '22023',
            HINT = 'The workspace is _tenant_id, the id is generated, and addresses are _methods.';
  END IF;

  -- Only the named columns are written, so every other column keeps its default. The values are
  -- typed by jsonb_populate_record against the table's own row type.
  SELECT COALESCE(pg_catalog.string_agg(pg_catalog.format(', %I', k), '' ORDER BY k), ''),
         COALESCE(pg_catalog.string_agg(pg_catalog.format(', r.%I', k), '' ORDER BY k), '')
    INTO _columns, _values
    FROM pg_catalog.jsonb_object_keys(_client) AS k;
  EXECUTE pg_catalog.format(
      'INSERT INTO public.clients (tenant_id%s) SELECT $1%s FROM pg_catalog.jsonb_populate_record(NULL::public.clients, $2) AS r RETURNING id',
      _columns, _values)
    INTO _id
    USING _tenant_id, _client;

  SELECT COALESCE(pg_catalog.jsonb_agg(e ORDER BY o), '[]'::jsonb) INTO _list
    FROM pg_catalog.jsonb_array_elements(COALESCE(_methods, '[]'::jsonb)) WITH ORDINALITY AS t(e, o)
   WHERE NULLIF(pg_catalog.btrim(e->>'value'), '') IS NOT NULL;
  IF pg_catalog.jsonb_array_length(_list) > 0 THEN
    PERFORM public._add_client_contact_methods(_tenant_id, _id, _list);
  END IF;

  RETURN _id;
END;
$function$;

-- ── 9. list_tool_autonomy: the owner can see and turn off the new chat control ────────────────
-- Metadata only, in the 20271110060000 pattern: delegate to the complete incumbent first so its
-- authorization and rows survive. No autonomy setting, provider permission or activation changes.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_portal_access(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_portal_access;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_portal_access(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_portal_access(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_portal_access(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('client_portal_access_set','Pause, restore or end a client''s portal access','Business')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
   FROM catalog c LEFT JOIN public.tenant_tool_autonomy a
    ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

-- ── 10. The customer writers' lock re-checks admit only an OPEN relationship ────────────────────
-- Each function below calls the resolver and then re-proves the contact under a row lock (or, for the
-- session admit, in a fresh statement). The resolver is checked BEFORE the lock, so a pause that commits
-- between the two left the re-check passing (the link is kept on pause) and one customer write landed
-- after the owner saw "Paused". The writer takes FOR UPDATE on the contact, so each FOR SHARE/FOR UPDATE
-- below waits for it and re-evaluates its WHERE on the committed row: with the state predicate the pause
-- now wins. Each body is the CURRENT main definition (source migration named per function, md5-matched
-- against production 2026-10-18), copied verbatim with ONE added predicate and nothing else. CREATE OR
-- REPLACE keeps each function's owner, grants and comment.
-- In-flight Slices 4/5/A/6 carry the same re-check pattern; they gain this predicate at Slice 7's final
-- rebase, not here (they are not on main).
-- client_portal_send_message: from 20271110010000_e09_customer_portal_messages.sql; + portal_access_state = 'open' in the re-check.
CREATE OR REPLACE FUNCTION public.client_portal_send_message(
  p_body text, p_request_id uuid, p_kind text DEFAULT 'message', p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client public.clients%ROWTYPE;
  _client_id uuid;
  _body text := public._portal_message_body(p_body);
  _existing public.messages%ROWTYPE;
  _row public.messages%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_REQUIRED'); END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('message','help') THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_KIND'); END IF;
  IF _body IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_BODY'); END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_RELATIONSHIP'); END IF;
  -- Serialize against access changes and re-prove the relationship under the lock.
  SELECT c.* INTO _client FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active'
    AND c.portal_access_state = 'open'
  FOR SHARE OF c, t;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_RELATIONSHIP'); END IF;

  SELECT * INTO _existing FROM public.messages
  WHERE channel_type = 'portal' AND meta #>> '{portal,request_id}' = p_request_id::text;
  IF FOUND THEN
    IF _existing.tenant_id = _client.tenant_id AND _existing.contact_id = _client.id
      AND _existing.direction = 'inbound' AND _existing.meta #>> '{portal,author_user_id}' = _uid::text
      AND _existing.body_text = _body AND _existing.meta #>> '{portal,kind}' = p_kind THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'message_id', _existing.id, 'created_at', _existing.created_at);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
  END IF;
  -- A customer cannot flood the business inbox: 20 new messages per relationship per minute.
  IF (SELECT count(*) FROM public.messages m
      WHERE m.channel_type = 'portal' AND m.tenant_id = _client.tenant_id AND m.contact_id = _client.id
        AND m.direction = 'inbound' AND m.created_at > now() - interval '1 minute') >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
  END IF;

  BEGIN
    INSERT INTO public.messages (tenant_id, thread_key, contact_id, channel_type, direction, status,
      sender, recipients, subject, body_text, meta, sent_at)
    VALUES (_client.tenant_id, 'contact:' || _client.tenant_id::text || ':' || _client.id::text, _client.id,
      'portal', 'inbound', 'received',
      jsonb_build_object('kind', 'customer', 'name', nullif(btrim(concat_ws(' ', _client.first_name, _client.last_name)), '')),
      '[]'::jsonb, CASE WHEN p_kind = 'help' THEN 'Help request' END, _body,
      jsonb_build_object('portal', jsonb_build_object('request_id', p_request_id, 'author_user_id', _uid,
        'author_role', 'customer', 'kind', p_kind)),
      now())
    RETURNING * INTO _row;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent retry of the same request won the insert; answer from its row.
    SELECT * INTO _existing FROM public.messages
    WHERE channel_type = 'portal' AND meta #>> '{portal,request_id}' = p_request_id::text;
    IF FOUND AND _existing.contact_id = _client.id AND _existing.meta #>> '{portal,author_user_id}' = _uid::text
      AND _existing.body_text = _body AND _existing.meta #>> '{portal,kind}' = p_kind THEN
      RETURN jsonb_build_object('ok', true, 'replayed', true, 'message_id', _existing.id, 'created_at', _existing.created_at);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
  END;
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'message_id', _row.id, 'created_at', _row.created_at);
END;
$$;

-- client_portal_session_change_admit: from 20271110020000_e09_customer_portal_sessions.sql; + portal_access_state = 'open' in the re-check.
CREATE OR REPLACE FUNCTION public.client_portal_session_change_admit(
  p_booking_id uuid, p_action text, p_request_id uuid,
  p_new_start timestamptz DEFAULT NULL, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _prior public.audit_logs%ROWTYPE;
  _prior_to timestamptz;
  _b public.internal_bookings%ROWTYPE;
  _notice integer;
  _enabled boolean;
  _deadline timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_REQUIRED'); END IF;
  IF p_action IS NULL OR p_action NOT IN ('cancel','reschedule') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_ACTION');
  END IF;
  IF p_action = 'reschedule' AND p_new_start IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NEW_TIME_REQUIRED');
  END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND'); END IF;
  SELECT c.tenant_id INTO _tenant FROM public.clients c WHERE c.id = _client_id AND c.linked_user_id = _uid
    AND c.portal_access_state = 'open';
  IF _tenant IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND'); END IF;

  -- Replay of a committed change: booking-manage's audit row for this request id.
  SELECT a.* INTO _prior FROM public.audit_logs a
  WHERE a.entity = 'internal_booking' AND a.data ? 'portal_request_id'
    AND a.data->>'portal_request_id' = p_request_id::text
  ORDER BY a.created_at, a.id LIMIT 1;
  IF FOUND THEN
    BEGIN
      _prior_to := (_prior.data->>'to_start')::timestamptz;
    EXCEPTION WHEN others THEN _prior_to := NULL;
    END;
    IF _prior.entity_id = p_booking_id
      AND _prior.data->>'client_id' = _client_id::text
      AND _prior.data->>'tenant_id' = _tenant::text
      AND _prior.action = 'client_portal_' || p_action
      AND (p_action = 'cancel' OR _prior_to = p_new_start) THEN
      SELECT b.* INTO _b FROM public.internal_bookings b
      WHERE b.id = p_booking_id AND b.tenant_id = _tenant AND b.contact_id = _client_id;
      RETURN jsonb_build_object('ok', true, 'replay', true, 'status', _b.status, 'start_at', _b.start_at);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'REQUEST_ID_CONFLICT');
  END IF;

  -- Only the caller's own booking in their own business. Anything else — another customer's,
  -- another business's, a host block, a random id — is the same "not found", never "forbidden".
  SELECT b.* INTO _b FROM public.internal_bookings b
  WHERE b.id = p_booking_id AND b.tenant_id = _tenant AND b.contact_id = _client_id
    AND b.status <> 'blocked'
  FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_FOUND'); END IF;

  -- A retry whose change already landed (e.g. the write committed but its audit row did not).
  IF p_action = 'cancel' AND _b.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'status', _b.status, 'start_at', _b.start_at);
  END IF;
  IF p_action = 'reschedule' AND _b.status = 'scheduled' AND _b.start_at = p_new_start THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'status', _b.status, 'start_at', _b.start_at);
  END IF;

  IF _b.status <> 'scheduled' THEN RETURN jsonb_build_object('ok', false, 'error', 'SESSION_NOT_CHANGEABLE'); END IF;

  SELECT cal.min_notice_min, cal.enabled INTO _notice, _enabled
  FROM public.calendars cal WHERE cal.id = _b.calendar_id AND cal.tenant_id = _tenant;
  IF _b.calendar_id IS NULL OR _notice IS NULL OR _b.booking_kind = 'class_session'
    OR (p_action = 'reschedule' AND NOT _enabled) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_CHANGE_UNAVAILABLE');
  END IF;

  _deadline := _b.start_at - make_interval(mins => greatest(_notice, 0));
  IF now() > _deadline THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_CHANGE_WINDOW_CLOSED', 'deadline', _deadline);
  END IF;

  RETURN jsonb_build_object('ok', true, 'booking_id', _b.id, 'tenant_id', _tenant,
    'client_id', _client_id, 'deadline', _deadline);
END;
$$;

-- client_portal_update_self_profile: from 20271102130000_e09_client_self_profile_write.sql; + portal_access_state = 'open' in the re-check.
CREATE OR REPLACE FUNCTION public.client_portal_update_self_profile(
  p_expected_updated_at timestamptz,
  p_profile jsonb,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _client public.clients%ROWTYPE;
  _key text;
  _value jsonb;
  _methods jsonb;
  _readback jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501';
  END IF;
  _id := public.client_portal_relationship_id(p_tenant_id);
  IF _id IS NULL THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  -- Revalidate after acquiring the row lock: a concurrent revoke/merge/archive
  -- that won the lock must take effect before this call can write anything.
  SELECT c.* INTO _client FROM public.clients c
  WHERE c.id = _id AND c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL
    AND c.portal_access_state = 'open'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenants t
  WHERE t.id = _client.tenant_id AND t.status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  IF _client.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'customer profile changed; reload before saving' USING ERRCODE = '40001';
  END IF;
  IF p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' OR p_profile = '{}'::jsonb THEN
    RAISE EXCEPTION 'provide permitted profile fields' USING ERRCODE = '22023';
  END IF;
  FOR _key, _value IN SELECT key, value FROM jsonb_each(p_profile) LOOP
    IF _key <> ALL(ARRAY['first_name','last_name','street_address','city','state','zip_code','phone'])
      OR jsonb_typeof(_value) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'profile field is not permitted' USING ERRCODE = '22023';
    END IF;
    IF _key IN ('first_name','last_name','phone') AND
      (jsonb_typeof(_value) <> 'string' OR nullif(btrim(p_profile->>_key),'') IS NULL) THEN
      RAISE EXCEPTION 'provided name or phone must not be blank' USING ERRCODE = '22023';
    END IF;
    IF char_length(p_profile->>_key) > (CASE WHEN _key='street_address' THEN 500 ELSE 200 END) THEN
      RAISE EXCEPTION 'profile field is too long' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_profile ? 'phone' THEN
    _methods := public._client_contact_methods_payload(_client.id);
    PERFORM public._replace_client_contact_methods_checked(_client.tenant_id, _client.id,
      public.contact_methods_with_primary(_methods, 'phone', btrim(p_profile->>'phone')), _methods);
  END IF;
  UPDATE public.clients c SET
    first_name = CASE WHEN p_profile ? 'first_name' THEN btrim(p_profile->>'first_name') ELSE c.first_name END,
    last_name = CASE WHEN p_profile ? 'last_name' THEN btrim(p_profile->>'last_name') ELSE c.last_name END,
    street_address = CASE WHEN p_profile ? 'street_address' THEN nullif(btrim(p_profile->>'street_address'),'') ELSE c.street_address END,
    city = CASE WHEN p_profile ? 'city' THEN nullif(btrim(p_profile->>'city'),'') ELSE c.city END,
    state = CASE WHEN p_profile ? 'state' THEN nullif(btrim(p_profile->>'state'),'') ELSE c.state END,
    zip_code = CASE WHEN p_profile ? 'zip_code' THEN nullif(btrim(p_profile->>'zip_code'),'') ELSE c.zip_code END,
    updated_at = clock_timestamp()
  WHERE c.id = _client.id AND c.tenant_id = _client.tenant_id AND c.linked_user_id = _uid;
  INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
  VALUES (_uid,'client_portal','self_profile_updated',_client.id,
    jsonb_build_object('actor_user_id',_uid,'tenant_id',_client.tenant_id,'client_id',_client.id,
      'fields_submitted',(SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_profile) k),
      'via','client_portal_update_self_profile'));
  _readback := public.client_portal_self_profile(_client.tenant_id);
  IF _readback IS NULL OR _readback->>'id' IS DISTINCT FROM _client.id::text
    OR _readback->>'linked_user_id' IS DISTINCT FROM _uid::text THEN
    RAISE EXCEPTION 'customer profile readback unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN _readback;
END;
$$;

-- client_portal_welcome_state: from 20271107110000_e09_client_welcome_atomic.sql; + portal_access_state = 'open' in the re-check.
CREATE OR REPLACE FUNCTION public.client_portal_welcome_state()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid(); _id uuid; _client public.clients%ROWTYPE;
  _config jsonb; _fields jsonb; _profile jsonb; _answers jsonb := '{}'::jsonb;
  _intake public.paige_client_intake_submissions%ROWTYPE;
  _intake_exists boolean; _token text; _field jsonb; _answer jsonb; _number numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE='42501'; END IF;
  _id := public.client_portal_relationship_id();
  IF _id IS NULL THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  -- Same client -> tenant -> intake lock order as the save. A read is coherent
  -- with participating writers and returns no arbitrary tenant features/payload.
  SELECT c.* INTO _client FROM public.clients c WHERE c.id=_id AND c.linked_user_id=_uid
    AND c.status='active' AND c.merged_into_contact_id IS NULL AND c.portal_access_state='open' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  SELECT t.features->'playbook_config' INTO _config FROM public.tenants t
    WHERE t.id=_client.tenant_id AND t.status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  SELECT i.* INTO _intake FROM public.paige_client_intake_submissions i
    WHERE i.client_id=_id AND i.section='playbook_intake' FOR SHARE;
  _intake_exists := FOUND;
  _profile := public.client_portal_self_profile(_client.tenant_id);
  IF _profile IS NULL OR _profile->>'id' IS DISTINCT FROM _id::text
    OR _profile->>'tenant_id' IS DISTINCT FROM _client.tenant_id::text
    OR _profile->>'linked_user_id' IS DISTINCT FROM _uid::text THEN
    RAISE EXCEPTION 'customer profile readback unavailable' USING ERRCODE='42501';
  END IF;
  _fields := public._client_portal_welcome_fields(_config);
  IF _fields IS NULL THEN
    RETURN jsonb_build_object('status','configuration_required','profile',_profile,'fields','[]'::jsonb,
      'answers','{}'::jsonb,'intake_updated_at',NULL,'intake_submitted_at',NULL,'expected_token',NULL);
  END IF;
  IF _intake_exists THEN
    IF jsonb_typeof(_intake.payload) IS DISTINCT FROM 'object' OR octet_length(_intake.payload::text)>1048576 THEN
      RAISE EXCEPTION 'saved intake requires assistance' USING ERRCODE='22023';
    END IF;
    FOR _field IN SELECT value FROM jsonb_array_elements(_fields) LOOP
      IF _intake.payload ? (_field->>'key') THEN
        _answer := _intake.payload->(_field->>'key');
        -- The incumbent form stored number input values as text. Normalize only
        -- valid bounded historical numbers for this read projection; the CAS
        -- below still hashes the original complete payload. Reads write nothing,
        -- and the writer continues to require JSON numbers (or optional null).
        IF _field->>'type'='number' AND jsonb_typeof(_answer)='string' THEN
          IF nullif(btrim(_answer#>>'{}'),'') IS NULL THEN
            _answer := 'null'::jsonb;
          ELSIF char_length(_answer#>>'{}')<=64 AND (_answer#>>'{}') ~
            '^-?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]{1,3})?$' THEN
            _number := (_answer#>>'{}')::numeric;
            IF abs(_number)<=1000000000000 THEN _answer := to_jsonb(_number); END IF;
          END IF;
        END IF;
        _answers := _answers || jsonb_build_object(_field->>'key',_answer);
      END IF;
    END LOOP;
  END IF;
  -- Snapshot CAS only: not identity, a monotonic revision or an execution receipt.
  _token := md5(jsonb_build_object('profile',_profile,'fields',_fields,'intake_exists',_intake_exists,
    'intake_id',_intake.id,'payload',_intake.payload,'updated_at',_intake.updated_at,
    'submitted_at',_intake.submitted_at)::text);
  RETURN jsonb_build_object('status','ready','profile',_profile,'fields',_fields,'answers',_answers,
    'intake_updated_at',_intake.updated_at,'intake_submitted_at',_intake.submitted_at,'expected_token',_token);
END;
$$;

-- client_portal_save_welcome: from 20271107110000_e09_client_welcome_atomic.sql; + portal_access_state = 'open' in the re-check.
CREATE OR REPLACE FUNCTION public.client_portal_save_welcome(p_expected_token text,p_profile jsonb,p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid(); _id uuid; _client public.clients%ROWTYPE;
  _intake public.paige_client_intake_submissions%ROWTYPE; _intake_exists boolean;
  _loaded jsonb; _saved jsonb; _profile jsonb; _answers jsonb; _stage record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE='42501'; END IF;
  _id := public.client_portal_relationship_id();
  IF _id IS NULL THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  SELECT c.* INTO _client FROM public.clients c WHERE c.id=_id AND c.linked_user_id=_uid
    AND c.status='active' AND c.merged_into_contact_id IS NULL AND c.portal_access_state='open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id=_client.tenant_id AND t.status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  SELECT i.* INTO _intake FROM public.paige_client_intake_submissions i
    WHERE i.client_id=_id AND i.section='playbook_intake' FOR UPDATE;
  _intake_exists := FOUND;
  _loaded := public.client_portal_welcome_state();
  IF _loaded->>'status' IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'published intake configuration required' USING ERRCODE='55000';
  END IF;
  IF p_expected_token IS NULL OR p_expected_token !~ '^[a-fA-F0-9]{32}$' THEN
    RAISE EXCEPTION 'provide the loaded Welcome state' USING ERRCODE='22023';
  END IF;
  IF p_expected_token IS DISTINCT FROM _loaded->>'expected_token' THEN
    RAISE EXCEPTION 'Welcome information changed; reload before saving' USING ERRCODE='40001';
  END IF;
  _answers := public._client_portal_welcome_answers(_loaded->'fields',p_answers);
  -- Reuse canonical profile/contact validation, CAS, locks and attributed audit.
  _profile := public.client_portal_update_self_profile(_client.updated_at,p_profile,_client.tenant_id);
  IF _profile->>'id' IS DISTINCT FROM _id::text OR _profile->>'tenant_id' IS DISTINCT FROM _client.tenant_id::text
    OR _profile->>'linked_user_id' IS DISTINCT FROM _uid::text THEN
    RAISE EXCEPTION 'customer profile readback unavailable' USING ERRCODE='42501';
  END IF;
  -- Welcome's required contact fields apply to the composed canonical profile;
  -- a partial patch may reuse existing values, but cannot advance missing data.
  IF nullif(btrim(_profile->>'first_name'),'') IS NULL
    OR nullif(btrim(_profile->>'last_name'),'') IS NULL
    OR nullif(btrim(_profile->>'phone'),'') IS NULL
    OR char_length(_profile->>'phone')>40
    OR char_length(regexp_replace(_profile->>'phone','[^0-9]','','g')) NOT BETWEEN 7 AND 15 THEN
    RAISE EXCEPTION 'Welcome name and primary phone are required' USING ERRCODE='22023';
  END IF;
  IF _intake_exists THEN
    UPDATE public.paige_client_intake_submissions SET payload=
      (_intake.payload - ARRAY(SELECT f->>'key' FROM jsonb_array_elements(_loaded->'fields') f))||_answers,
      submitted_at=clock_timestamp() WHERE id=_intake.id AND client_id=_id AND section='playbook_intake';
    IF NOT FOUND THEN RAISE EXCEPTION 'Welcome information changed; reload before saving' USING ERRCODE='40001'; END IF;
  ELSE
    BEGIN
      INSERT INTO public.paige_client_intake_submissions(client_id,section,payload,submitted_at)
        VALUES(_id,'playbook_intake',_answers,clock_timestamp());
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Welcome information changed; reload before saving' USING ERRCODE='40001';
    END;
  END IF;
  SELECT * INTO _stage FROM public.client_advance_onboarding_stage('signing_agreement','{}'::jsonb);
  IF _stage.client_id IS DISTINCT FROM _id THEN
    RAISE EXCEPTION 'customer stage readback unavailable' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
  VALUES(_uid,'client_portal','welcome_saved',_id,
    jsonb_build_object('actor_user_id',_uid,'tenant_id',_client.tenant_id,'client_id',_id,
      'answer_fields',(SELECT COALESCE(jsonb_agg(k ORDER BY k),'[]'::jsonb) FROM jsonb_object_keys(_answers) k),
      'via','client_portal_save_welcome'));
  _saved := public.client_portal_welcome_state();
  IF _saved->>'status' IS DISTINCT FROM 'ready' OR _saved#>>'{profile,id}' IS DISTINCT FROM _id::text
    OR _saved#>>'{profile,tenant_id}' IS DISTINCT FROM _client.tenant_id::text
    OR _saved#>>'{profile,linked_user_id}' IS DISTINCT FROM _uid::text
    OR _saved#>>'{profile,onboarding_stage}' IS DISTINCT FROM _stage.onboarding_stage
    OR _saved->'answers' IS DISTINCT FROM _answers OR _saved->>'intake_submitted_at' IS NULL THEN
    RAISE EXCEPTION 'Welcome saved-state readback unavailable' USING ERRCODE='42501';
  END IF;
  RETURN _saved;
END;
$$;

-- client_portal_begin_file_upload: from 20271108150000_e09_customer_documents.sql; + portal_access_state = 'open' in the re-check.
CREATE OR REPLACE FUNCTION public.client_portal_begin_file_upload(p_file_id uuid,p_expected_client_id uuid,p_filename text,p_mime_type text,p_size_bytes bigint,p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE
 _uid uuid:=auth.uid(); _contact uuid; _client public.clients%ROWTYPE;
 _file public.client_files%ROWTYPE; _path text; _extension text;
BEGIN
 IF _uid IS NULL OR p_file_id IS NULL THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 _contact:=public.client_portal_relationship_id(p_tenant_id);
 IF p_expected_client_id IS NULL OR _contact IS DISTINCT FROM p_expected_client_id THEN
  RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501';
 END IF;
 SELECT * INTO _client FROM public.clients WHERE id=_contact AND linked_user_id=_uid
  AND status='active' AND merged_into_contact_id IS NULL AND portal_access_state='open' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=_client.tenant_id AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 _extension:=lower(substring(p_filename from '\.([^.]+)$'));
 IF p_filename IS NULL OR p_filename<>btrim(p_filename) OR length(p_filename) NOT BETWEEN 1 AND 255
  OR p_filename ~ '[[:cntrl:]/\\]' OR _extension IS NULL OR p_size_bytes IS NULL OR p_size_bytes NOT BETWEEN 1 AND 20971520
  OR p_mime_type IS NULL OR NOT (
   (p_mime_type='application/pdf' AND _extension='pdf')
   OR (p_mime_type='image/jpeg' AND _extension IN ('jpg','jpeg'))
   OR (p_mime_type='image/png' AND _extension='png')
   OR (p_mime_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document' AND _extension='docx')) THEN
  RAISE EXCEPTION 'Choose a PDF, JPG, PNG or DOCX file up to 20 MB.' USING ERRCODE='22023';
 END IF;
 _path:=_client.tenant_id::text||'/'||_contact::text||'/client_upload/'||_uid::text||'/'||p_file_id::text;
 INSERT INTO public.client_files(id,tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state)
 VALUES(p_file_id,_client.tenant_id,_contact,_uid,_path,p_filename,p_mime_type,p_size_bytes,'client_upload','pending')
 ON CONFLICT(id) DO NOTHING;
 SELECT * INTO _file FROM public.client_files WHERE id=p_file_id FOR UPDATE;
 IF _file.tenant_id IS DISTINCT FROM _client.tenant_id OR _file.contact_id IS DISTINCT FROM _contact
  OR _file.uploaded_by_user_id IS DISTINCT FROM _uid OR _file.storage_path IS DISTINCT FROM _path
  OR _file.original_filename IS DISTINCT FROM p_filename OR _file.mime_type IS DISTINCT FROM p_mime_type
  OR _file.size_bytes IS DISTINCT FROM p_size_bytes OR _file.visibility<>'client_upload' THEN
  RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501';
 END IF;
 RETURN public._client_portal_file_projection(_file);
END $$;

-- client_portal_finish_file_upload: from 20271108150000_e09_customer_documents.sql; + portal_access_state = 'open' in the re-check.
CREATE OR REPLACE FUNCTION public.client_portal_finish_file_upload(p_file_id uuid,p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE _uid uuid:=auth.uid();_contact uuid;_file public.client_files%ROWTYPE;_client public.clients%ROWTYPE;_receipt uuid;
BEGIN
 _contact:=public.client_portal_relationship_id(p_tenant_id);
 SELECT * INTO _client FROM public.clients c WHERE c.id=_contact AND c.linked_user_id=_uid
  AND c.status='active' AND c.merged_into_contact_id IS NULL AND c.portal_access_state='open' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.tenants WHERE id=_client.tenant_id AND status='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO _file FROM public.client_files f WHERE f.id=p_file_id AND f.contact_id=_contact
  AND f.tenant_id=_client.tenant_id AND f.uploaded_by_user_id=_uid AND f.visibility='client_upload'
  AND f.storage_path=f.tenant_id::text||'/'||f.contact_id::text||'/client_upload/'||_uid::text||'/'||f.id::text FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'file upload unavailable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='client-files' AND o.name=_file.storage_path
  AND o.owner_id=_uid::text AND CASE WHEN o.metadata->>'size' ~ '^[0-9]{1,10}$' THEN (o.metadata->>'size')::bigint END=_file.size_bytes
  AND o.metadata->>'mimetype'=_file.mime_type) THEN
  RAISE EXCEPTION 'The saved upload could not be verified. Check its status before trying again.' USING ERRCODE='22023';
 END IF;
 IF _file.upload_state='ready' THEN RETURN public._client_portal_file_projection(_file); END IF;
 UPDATE public.client_files SET upload_state='ready' WHERE id=_file.id RETURNING * INTO _file;
 _receipt:=public.record_rail_event(p_contact_id=>_contact,p_event_kind=>'client.document_uploaded',
  p_surface=>'client_portal',p_actor_type=>'client',p_title=>'Document uploaded',
  p_payload=>jsonb_build_object('file_id',_file.id),p_ref_table=>'client_files',p_ref_id=>_file.id,
  p_from_department=>'client_experience',p_to_department=>'owner_ops',p_tenant_id=>_client.tenant_id);
 INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
 VALUES(_uid,'client_portal','file_uploaded',_file.id,jsonb_build_object('tenant_id',_client.tenant_id,
  'client_id',_contact,'file_id',_file.id,'rail_event_id',_receipt,'via','client_portal_finish_file_upload'));
 RETURN public._client_portal_file_projection(_file);
END $$;

-- client_advance_onboarding_stage: from 20271106120000_e09_client_stage_scope.sql; + portal_access_state = 'open' in the re-check.
CREATE OR REPLACE FUNCTION public.client_advance_onboarding_stage(
  p_to_stage text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(client_id uuid, onboarding_stage text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_client_id uuid;
  v_client public.clients%ROWTYPE;
  v_order text[] := ARRAY['pre_invite','invited','signing_agreement','accepting_payment','completing_intake','uploading_docs','completed'];
  v_from_idx int;
  v_to_idx int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_to_stage IS NULL OR NOT (p_to_stage = ANY (v_order)) THEN
    RAISE EXCEPTION 'invalid_stage: %', p_to_stage;
  END IF;

  v_client_id := public.client_portal_relationship_id();
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'no_linked_client'; END IF;
  -- Recheck the locked row after any concurrent archive/revoke/merge has won.
  SELECT c.* INTO v_client FROM public.clients c
  WHERE c.id = v_client_id AND c.linked_user_id = v_user_id
    AND c.status = 'active' AND c.merged_into_contact_id IS NULL
    AND c.portal_access_state = 'open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_linked_client'; END IF;
  PERFORM 1 FROM public.tenants t
  WHERE t.id = v_client.tenant_id AND t.status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_linked_client'; END IF;

  v_from_idx := COALESCE(array_position(v_order, COALESCE(v_client.onboarding_stage, 'invited')), 1);
  v_to_idx := array_position(v_order, p_to_stage);
  IF v_to_idx > v_from_idx THEN
    UPDATE public.clients c SET onboarding_stage = p_to_stage, updated_at = now()
    WHERE c.id = v_client.id AND c.tenant_id = v_client.tenant_id
      AND c.linked_user_id = v_user_id AND c.status = 'active'
      AND c.merged_into_contact_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'no_linked_client'; END IF;
    INSERT INTO public.paige_audit_log(actor_user_id,action,target_type,target_id,payload)
    VALUES (v_user_id,'onboarding_stage_advanced','client',v_client.id,
      jsonb_build_object('from_stage',v_client.onboarding_stage,'to_stage',p_to_stage,
                        'payload',COALESCE(p_payload,'{}'::jsonb)));
  END IF;
  RETURN QUERY SELECT c.id,c.onboarding_stage,c.updated_at
  FROM public.clients c WHERE c.id = v_client.id AND c.linked_user_id = v_user_id;
END;
$$;

-- paige_chat_thread_create: from 20271108201000_e09_customer_private_chat.sql; + portal_access_state = 'open' in the re-check.
CREATE OR REPLACE FUNCTION public.paige_chat_thread_create(p_contact_id uuid, p_lens text, p_title text, p_consent_snapshot jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_tenant_id uuid;
  v_thread_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_lens IS NULL OR p_lens NOT IN ('coach','client','platform','customer') THEN RAISE EXCEPTION 'invalid lens'; END IF;
  IF p_lens='platform' AND (p_contact_id IS NOT NULL OR public.is_platform_owner() IS NOT TRUE) THEN
    RAISE EXCEPTION 'platform lens requires authorized self scope' USING ERRCODE='42501';
  END IF;

  IF p_lens = 'customer' THEN
    IF p_contact_id IS NOT NULL THEN RAISE EXCEPTION 'customer subject is server resolved' USING ERRCODE='42501'; END IF;
    p_contact_id := public.client_portal_relationship_id();
    IF p_contact_id IS NULL THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
    SELECT tenant_id INTO v_tenant_id FROM public.clients WHERE id=p_contact_id AND linked_user_id=v_uid AND portal_access_state='open' FOR SHARE;
    IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text,9821));
    SELECT id INTO v_thread_id FROM public.paige_chat_threads
      WHERE caller_user_id=v_uid AND tenant_id=v_tenant_id AND contact_id=p_contact_id
        AND audience='customer_private' AND NOT is_archived AND auto_delete_at>now()
      ORDER BY created_at DESC LIMIT 1;
    IF v_thread_id IS NOT NULL THEN RETURN v_thread_id; END IF;
    UPDATE public.paige_chat_threads SET is_archived=true
      WHERE caller_user_id=v_uid AND tenant_id=v_tenant_id AND contact_id=p_contact_id
        AND audience='customer_private' AND NOT is_archived AND auto_delete_at<=now();
  ELSIF p_contact_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant_id
      FROM public.clients WHERE id = p_contact_id
        AND (public.is_platform_owner() IS TRUE OR public.can_access_contact(v_uid,p_contact_id,false));
    IF v_tenant_id IS NULL THEN
      RAISE EXCEPTION 'workspace contact unavailable' USING ERRCODE='42501';
    END IF;
  ELSIF p_lens = 'platform' THEN
    IF NOT public.is_platform_owner() THEN
      RAISE EXCEPTION 'platform lens requires platform owner';
    END IF;
    v_tenant_id := NULL;
  ELSE
    v_tenant_id := public.current_user_tenant_id();
    IF v_tenant_id IS NULL THEN
      RAISE EXCEPTION 'self-mode requires caller tenant';
    END IF;
    IF NOT (public.is_platform_owner() IS TRUE OR public.is_tenant_member(v_tenant_id) IS TRUE
      OR public.is_tenant_owner(v_uid,v_tenant_id) IS TRUE OR public.agency_can_manage_child(v_tenant_id,v_uid) IS TRUE) THEN
      RAISE EXCEPTION 'workspace membership unavailable' USING ERRCODE='42501';
    END IF;
  END IF;

  INSERT INTO public.paige_chat_threads
    (caller_user_id, contact_id, tenant_id, lens, audience, title,
     consent_snapshot, auto_delete_at, last_message_at)
  VALUES
    (v_uid, p_contact_id, v_tenant_id, CASE WHEN p_lens='customer' THEN 'client' ELSE p_lens END,
     CASE WHEN p_lens='customer' THEN 'customer_private' ELSE 'workspace' END, p_title,
     p_consent_snapshot, now() + interval '90 days', now())
  RETURNING id INTO v_thread_id;

  RETURN v_thread_id;
END;
$function$;

-- customer_respond_to_action(uuid,text,text,timestamptz) was composed in place by 20271108122000
-- (a DO block over pg_get_functiondef, whose two reconciled predecessors differ only in comments), so its
-- full text lives in the database, not a migration. Patch it the same way: require the E09 scope marker
-- and exactly one copy of the re-check, add the predicate, and re-execute. Idempotent.
DO $e09_access_respond$
DECLARE
  _def text := pg_catalog.pg_get_functiondef('public.customer_respond_to_action(uuid,text,text,timestamp with time zone)'::regprocedure);
  _old text := E'    AND c.merged_into_contact_id IS NULL AND t.status=''active''\n    AND c.id=public.client_portal_relationship_id(v_action.tenant_id)\n  FOR SHARE OF c,t;';
  _new text := E'    AND c.merged_into_contact_id IS NULL AND t.status=''active''\n    AND c.id=public.client_portal_relationship_id(v_action.tenant_id)\n    AND c.portal_access_state=''open''\n  FOR SHARE OF c,t;';
BEGIN
  IF pg_catalog.strpos(_def, 'E09_CUSTOMER_ACTION_SCOPE_V1') = 0 THEN
    RAISE EXCEPTION 'customer action response writer changed; reconcile before release';
  END IF;
  IF pg_catalog.strpos(_def, _new) > 0 THEN RETURN; END IF;
  IF (pg_catalog.length(_def) - pg_catalog.length(pg_catalog.replace(_def, _old, ''))) <> pg_catalog.length(_old) THEN
    RAISE EXCEPTION 'customer action response re-check changed; reconcile before release';
  END IF;
  EXECUTE pg_catalog.replace(_def, _old, _new);
END
$e09_access_respond$;

-- ── 11. A signed-in team member cannot link a client record to their own login ─────────────────
-- enforce_clients_linking_integrity lets a signed-in caller link a contact to their OWN login straight
-- through the table (clients_admins_full). A business admin could therefore self-link a client record
-- (taking over its portal and uploading as "the client"), or move a joined client's record onto their own
-- login and lock the real person out (verifier probe P6). Refuse that direct write when the login being
-- linked is on the business's team, which is everyone current_user_tenant_id() can switch into it as staff:
--   * an ACTIVE membership of the contact's business or of a business above it (an agency owner switched
--     into its sub-account is that sub-account's team);
--   * agency staff on the agency team list (agency_team_members) whom agency_can_manage_child admits to
--     this sub-account, with no business membership at all;
--   * a platform operator (is_platform_operator: super_admin or platform_admin, §53). The operator stands
--     above every business and reaches its data by acting as it, never as one of its customers; production
--     had 0 operator logins linked to a client record on 2026-10-18, and an operator who needs to see a
--     portal as a customer still can through a recipient-bound invitation (a definer seam, below).
-- Scope, on purpose: only a statement the signed-in caller runs as themselves (current_user authenticated
-- or anon, i.e. the Data API). Definer seams keep their own rules: invitation acceptance (the owner issued a
-- recipient-bound invitation to that exact contact; main's consumer_invite_acceptance pins that a verified
-- recipient with existing staff standing may accept), the CRM merge and this slice's writer. Trusted
-- service-role code is not a caller this guard can tell apart from its own seams. Existing rows are untouched
-- (production had 0 contacts linked to a member of their own business on 2026-10-18); only a new link is checked.
-- Whether the CALLER (auth.uid(), never a parameter) is on the team of p_tenant_id, as defined above.
-- Callable by signed-in users because the invoker guard below calls it as them; it only ever answers about
-- the caller themselves (like is_tenant_member), so it reveals nothing about anyone else.
CREATE OR REPLACE FUNCTION public._clients_link_caller_is_team(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND (
           EXISTS (SELECT 1 FROM public.tenant_members m
                   WHERE m.user_id = auth.uid() AND m.status = 'active'
                     AND (m.tenant_id = p_tenant_id OR public.is_tenant_ancestor(m.tenant_id, p_tenant_id)))
           OR public.agency_can_manage_child(p_tenant_id, auth.uid())
           OR public.is_platform_operator());
$$;
REVOKE ALL ON FUNCTION public._clients_link_caller_is_team(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._clients_link_caller_is_team(uuid) TO authenticated;

-- SECURITY INVOKER on purpose: current_user must be the statement's caller, not this function's owner.
CREATE OR REPLACE FUNCTION public._clients_portal_link_not_staff_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.linked_user_id IS NULL OR current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.linked_user_id IS NOT DISTINCT FROM OLD.linked_user_id
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  -- A link to anyone else is enforce_clients_linking_integrity's to refuse; this guard is the self-link.
  IF NEW.linked_user_id IS DISTINCT FROM auth.uid() THEN RETURN NEW; END IF;
  IF public._clients_link_caller_is_team(NEW.tenant_id) THEN
    RAISE EXCEPTION 'PORTAL_LINK_TARGET_IS_STAFF' USING ERRCODE = '42501',
      DETAIL = 'A member of this business''s team cannot link a client record to their own login.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._clients_portal_link_not_staff_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_clients_portal_link_not_staff ON public.clients;
CREATE TRIGGER trg_clients_portal_link_not_staff
  BEFORE INSERT OR UPDATE OF linked_user_id, tenant_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public._clients_portal_link_not_staff_guard();


-- ── 12. The open-access gate on the customer doors added after this slice was written ───────────
-- Documents (20271110200000), Profile & Consent (20271110215000), Agreements (20271110220000) and
-- Payments (20271110230000) each resolve the customer through client_portal_relationship_id and then
-- re-prove the row under a lock — but their re-proof predates the access state. The resolver (section 3)
-- already refuses a paused or ended person on a plain call; the locked re-proof is what decides when a
-- pause commits BETWEEN the resolver's read and the lock (the race section 10 closes for the doors on
-- 1cc4e995). Rather than hand-copy the predicate into nine more bodies, each door's resolver call
-- becomes ONE shared helper whose re-proof carries the open-access predicate:
--
--   _client_portal_lock_relationship(p_tenant_id, p_lock)  'share' | 'update' | 'none'
--     = the resolver (its multi-relationship 42501 propagates unchanged), then the same row re-proven
--       open, active, unmerged, in an active business, linked to auth.uid(), locked FOR SHARE (or the
--       client FOR UPDATE when the door then updates it) — or NULL. 'none' is for the two STABLE doors
--       (Documents' list and the storage upload check), which read one snapshot and cannot lock, and for
--       the first call in the two Profile & Consent writers: they take their advisory key first (the staff
--       pause/lift RPC takes the same key and then a key-share on the contact), so they re-prove under
--       the row lock only after the key, as they always did — locking the row first could deadlock.
--
-- Each door's body below is its newest definition byte-for-byte (the file named on its line) with the
-- one resolver call replaced; every refusal code and response shape is unchanged, because each door
-- already answers a NULL relationship with its own refusal. Deliberately NOT adopted here: Payments'
-- stricter guards (same-business staff, platform owner, deleted or banned login) stay in
-- _client_portal_billing_client, layered on the helper — extending them to the other doors would change
-- who may read Documents, Agreements or settings, which is an owner decision, not part of this gate.
-- The released-work doors (operations_delivery_client_*) key on the release, not the resolver; they keep
-- section 6's inline predicate. The Messages, Sessions, profile, welcome and upload writers keep section
-- 10's. Reads only — no table, column, policy or grant changes in this section.
CREATE OR REPLACE FUNCTION public._client_portal_lock_relationship(p_tenant_id uuid, p_lock text DEFAULT 'share')
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_client uuid;
  v_proven uuid;
BEGIN
  IF p_lock IS NULL OR p_lock NOT IN ('share', 'update', 'none') THEN
    RAISE EXCEPTION 'PORTAL_LOCK_MODE_INVALID' USING ERRCODE = '22023';
  END IF;
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  v_client := public.client_portal_relationship_id(p_tenant_id);
  IF v_client IS NULL THEN RETURN NULL; END IF;
  -- One predicate, written once; only the lock clause varies.
  EXECUTE pg_catalog.format(
    'SELECT c.id FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id'
    ' WHERE c.id = $1 AND c.linked_user_id = $2 AND c.status = ''active'''
    ' AND c.merged_into_contact_id IS NULL AND t.status = ''active'''
    ' AND c.portal_access_state = ''open'' %s',
    CASE p_lock WHEN 'share' THEN 'FOR SHARE OF c, t' WHEN 'update' THEN 'FOR UPDATE OF c FOR SHARE OF t' ELSE '' END)
  INTO v_proven USING v_client, v_uid;
  RETURN v_proven;
END $$;
REVOKE ALL ON FUNCTION public._client_portal_lock_relationship(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public._client_portal_lock_relationship(uuid, text) IS
  'E09 Slice 7: the customer''s OPEN relationship, re-proven after the resolver under the caller''s chosen lock, or NULL. The one open-access gate the Documents, Profile & Consent, Agreements and Payments customer doors call.';

-- client_portal_documents: from 20271110200000_e09_customer_portal_documents.sql (Documents 20271110200000); the resolver call becomes the gate ('none'). Nothing else changes.
CREATE OR REPLACE FUNCTION public.client_portal_documents(
  p_tenant_id uuid DEFAULT NULL, p_limit integer DEFAULT 50, p_before timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  _summary jsonb;
  _files jsonb;
  _has_more boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  -- A page cursor is the (created_at, id) of the last file shown; both halves or neither.
  IF (p_before IS NULL) <> (p_before_id IS NULL) THEN
    RAISE EXCEPTION 'a page cursor needs both p_before and p_before_id' USING ERRCODE = '22023';
  END IF;
  -- 42501 "select an authorized customer relationship" (more than one business) propagates as is.
  _client_id := public._client_portal_lock_relationship(p_tenant_id, 'none');
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  -- Re-prove the relationship; the business is the client's own, never the argument's.
  SELECT c.tenant_id INTO _tenant FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active';
  IF _tenant IS NULL THEN RETURN NULL; END IF;

  -- Explicit allowlist. Description, uploader, sharer, visibility and upload_state are never
  -- projected; `source` and `state` say what the customer needs to know.
  WITH visible AS (
    SELECT f.* FROM public.client_files f
    WHERE f.tenant_id = _tenant AND f.contact_id = _client_id
      AND ((f.visibility = 'shared' AND f.upload_state = 'ready')
        OR (f.visibility = 'client_upload' AND f.uploaded_by_user_id = _uid))
  ), page AS (
    SELECT v.*, row_number() OVER (ORDER BY v.created_at DESC, v.id DESC) AS rn
    -- Keyset (created_at, id): a file that shares the cursor's instant is never skipped.
    FROM visible v WHERE p_before IS NULL OR (v.created_at, v.id) < (p_before, p_before_id)
  )
  SELECT
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'filename', p.original_filename,
        'mime_type', p.mime_type,
        'size_bytes', p.size_bytes,
        'source', CASE WHEN p.visibility = 'client_upload' THEN 'you' ELSE 'business' END,
        'state', p.upload_state,
        'shared_at', p.shared_at,
        'created_at', p.created_at,
        'storage_path', p.storage_path) ORDER BY p.rn), '[]'::jsonb)
     FROM page p WHERE p.rn <= _limit),
    (SELECT count(*) > _limit FROM page),
    (SELECT jsonb_build_object(
        'shared', count(*) FILTER (WHERE v.visibility = 'shared'),
        'from_you', count(*) FILTER (WHERE v.visibility = 'client_upload')) FROM visible v)
  INTO _files, _has_more, _summary;
  RETURN jsonb_build_object('tenant_id', _tenant, 'client_id', _client_id, 'summary', _summary,
    'files', _files, 'has_more', _has_more);
END;
$$;

-- client_portal_can_upload_file_object: from 20271110200000_e09_customer_portal_documents.sql (Documents 20271110200000); the resolver call becomes the gate ('none'). Nothing else changes.
CREATE OR REPLACE FUNCTION public.client_portal_can_upload_file_object(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,storage,pg_temp AS $$
DECLARE _uid uuid:=auth.uid();_parts text[]:=string_to_array(p_name,'/');_tenant uuid;_contact uuid;
BEGIN
 IF _uid IS NULL OR cardinality(_parts) NOT IN (4,5)
  OR _parts[1]!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR _parts[2]!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  OR _parts[3] NOT IN ('internal','shared','client_upload') OR p_name ~ '(^|/)\.\.?(/|$)' THEN RETURN false; END IF;
 _tenant:=_parts[1]::uuid;_contact:=_parts[2]::uuid;
 IF cardinality(_parts)=5 AND _parts[3]='client_upload' AND _parts[4]=_uid::text
  AND _contact=public._client_portal_lock_relationship(_tenant,'none') THEN
  RETURN EXISTS(SELECT 1 FROM public.client_files f WHERE f.storage_path=p_name AND f.tenant_id=_tenant
   AND f.contact_id=_contact AND f.uploaded_by_user_id=_uid AND f.visibility='client_upload'
   AND f.upload_state='pending' AND f.created_at>now()-interval '1 day');
 END IF;
 RETURN cardinality(_parts)=4 AND _parts[4]<>'' AND EXISTS(SELECT 1 FROM public.clients c
  JOIN public.tenants t ON t.id=c.tenant_id WHERE c.id=_contact AND c.tenant_id=_tenant AND t.status='active'
  AND (public.is_platform_owner() OR (_tenant=public.current_user_tenant_id()
   AND public.is_tenant_admin(_tenant) AND public.has_role(_uid,'admin'::public.app_role))))
  AND EXISTS(SELECT 1 FROM public.client_files f WHERE f.storage_path=p_name AND f.tenant_id=_tenant
   AND f.contact_id=_contact AND f.uploaded_by_user_id=_uid AND f.visibility<>'client_upload'
   AND f.upload_state='pending' AND f.created_at>now()-interval '1 day');
END $$;

-- client_portal_communication_preferences: from 20271110215000_e09_customer_portal_profile_consent.sql (Profile & Consent 20271110215000); the resolver call becomes the gate ('share'). Nothing else changes.
CREATE OR REPLACE FUNCTION public.client_portal_communication_preferences(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _c public.clients%ROWTYPE;
  _t public.tenants%ROWTYPE;
  _s jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501';
  END IF;
  _client_id := public._client_portal_lock_relationship(p_tenant_id, 'share');
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  SELECT c.* INTO _c FROM public.clients c
   WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active' AND c.merged_into_contact_id IS NULL
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT t.* INTO _t FROM public.tenants t WHERE t.id = _c.tenant_id AND t.status = 'active' FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _s := public._client_communication_state(_c.tenant_id, _c.id);
  RETURN jsonb_build_object(
    'schema_version', 1,
    'tenant_id', _c.tenant_id,
    'business_name', _t.name,
    'email', _s->'email',
    'sms', _s->'sms',
    'updates', _s->'updates',
    'data_sharing', _s->'data_sharing',
    'quiet_hours', _s->'quiet_hours',
    'read_at', clock_timestamp());
END $$;

-- client_portal_set_communication_preference: from 20271110215000_e09_customer_portal_profile_consent.sql (Profile & Consent 20271110215000); the resolver call becomes the gate ('none'), and the row is re-proven open under its share lock right after the advisory key. Nothing else changes.
CREATE OR REPLACE FUNCTION public.client_portal_set_communication_preference(
  p_channel text, p_topic text, p_enabled boolean, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _c public.clients%ROWTYPE;
  _ch text := lower(btrim(coalesce(p_channel, '')));
  _topic text := nullif(lower(btrim(coalesce(p_topic, ''))), '');
  _before jsonb;
  _addr text; _uniq boolean; _row_addr text;
  _disclosure text;
  _err text;
  _changed boolean := false;
  _took_back boolean := false;
  _at timestamptz;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501';
  END IF;
  IF _ch NOT IN ('email','sms') OR p_enabled IS NULL
     OR (_topic IS NOT NULL AND (_topic <> 'newsletter' OR _ch <> 'email')) THEN
    RAISE EXCEPTION 'BAD_PREFERENCE: channel email or sms; topic newsletter is email only' USING ERRCODE = '22023';
  END IF;
  _client_id := public._client_portal_lock_relationship(p_tenant_id, 'none');
  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  -- One key serializes the customer, the staff pause/lift RPC and every retry for this contact.
  PERFORM pg_advisory_xact_lock(hashtextextended('portal_pref:' || _client_id::text, 0));
  -- Re-proven open under the lock, after the key the staff pause/lift RPC also takes (that order is kept).
  IF public._client_portal_lock_relationship(p_tenant_id, 'share') IS DISTINCT FROM _client_id THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT c.* INTO _c FROM public.clients c
   WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active' AND c.merged_into_contact_id IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id = _c.tenant_id AND t.status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;

  _before := public._client_communication_state(_c.tenant_id, _c.id);
  SELECT a.address, a.address_unique INTO _addr, _uniq FROM public._comms_contact_address(_c.tenant_id, _c.id, _ch) a;
  -- An address another client also holds is never written (M1); the row stays contact-keyed.
  _row_addr := CASE WHEN _uniq THEN _addr END;

  PERFORM set_config('paige.customer_consent_write', 'on', true);
  PERFORM set_config('paige.customer_consent_contact', _c.id::text, true);

  IF _ch = 'email' AND _topic IS NULL AND NOT p_enabled THEN
    _disclosure := 'email-pref:v2';
    IF (_before #>> '{email,can_turn_off}')::boolean THEN
      INSERT INTO public.paige_suppressions(contact_id, address_normalized, channel, reason, source, created_at)
      VALUES (_c.id, _row_addr, 'email', 'customer_request', 'customer_portal', clock_timestamp()) ON CONFLICT DO NOTHING;
      INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
      VALUES (_c.id, _row_addr, 'email', NULL, 'revoked', 'customer_portal', public._client_portal_evidence_ref(_uid, _disclosure), NULL, clock_timestamp());
      -- D4: turning email off also leaves Updates and offers. Turning it back on never re-subscribes.
      IF _before #>> '{updates,state}' IN ('subscribed','paused') THEN
        INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
        VALUES (_c.id, _row_addr, 'email', 'newsletter', 'revoked', 'customer_portal', public._client_portal_evidence_ref(_uid, 'updates-optin:v2'), NULL, clock_timestamp());
      END IF;
      _changed := true;
    END IF;
  ELSIF _ch = 'email' AND _topic IS NULL AND p_enabled THEN
    _disclosure := 'email-pref:v2';
    IF EXISTS (SELECT 1 FROM public.paige_suppressions s
                WHERE s.tenant_id = _c.tenant_id AND s.channel = 'email'
                  AND public._comms_row_is_contacts(_c.tenant_id, _c.id, _addr, _uniq, s.contact_id, s.address_normalized)) THEN
      -- A row the customer did not set themselves keeps email off; name who holds it.
      SELECT CASE
          WHEN count(*) = 0 THEN NULL
          WHEN bool_or(s.reason = 'manual') THEN 'EMAIL_PAUSED_BY_BUSINESS'
          WHEN bool_or(s.reason = 'bounce_hard') THEN 'EMAIL_UNDELIVERABLE'
          ELSE 'EMAIL_PAUSED_BY_BUSINESS'
        END INTO _err
        FROM public.paige_suppressions s
       WHERE s.tenant_id = _c.tenant_id AND s.channel = 'email'
         AND NOT public._suppression_customer_liftable(s.source, s.reason)
         AND public._comms_row_is_contacts(_c.tenant_id, _c.id, _addr, _uniq, s.contact_id, s.address_normalized);
      IF _err IS NULL THEN
        SELECT coalesce(bool_or(s.reason IN ('complaint','unsubscribe_link')), false) INTO _took_back
          FROM public.paige_suppressions s
         WHERE s.tenant_id = _c.tenant_id AND s.channel = 'email'
           AND public._comms_row_is_contacts(_c.tenant_id, _c.id, _addr, _uniq, s.contact_id, s.address_normalized);
        DELETE FROM public.paige_suppressions s
         WHERE s.tenant_id = _c.tenant_id AND s.channel = 'email'
           AND public._suppression_customer_liftable(s.source, s.reason)
           AND public._comms_row_is_contacts(_c.tenant_id, _c.id, _addr, _uniq, s.contact_id, s.address_normalized);
        IF _took_back THEN
          -- The customer took back their own spam report or unsubscribe click (integrator default (owner may overrule), round 2).
          -- Two events, in this order: the 'granted' is the evidence of that affirmative act; the
          -- newsletter 'revoked' after it keeps them out of Updates and offers, and keeps marketing
          -- automations (tenantConsent reads the latest email event of any topic) closed until they
          -- subscribe again themselves. Email back on is never a marketing opt-in (D4).
          _at := clock_timestamp();
          INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
          VALUES (_c.id, _row_addr, 'email', NULL, 'granted', 'customer_portal', public._client_portal_evidence_ref(_uid, _disclosure), NULL, _at);
          INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
          VALUES (_c.id, _row_addr, 'email', 'newsletter', 'revoked', 'customer_portal', public._client_portal_evidence_ref(_uid, 'updates-optin:v2'), NULL, _at + interval '1 microsecond');
        END IF;
        -- Otherwise (their own portal choice) no event: resuming email to someone the business already
        -- serves is not marketing consent, and a 'granted' would open tenantConsent.
        _changed := true;
      END IF;
    END IF;
  ELSIF _ch = 'email' AND p_enabled THEN
    _disclosure := 'updates-optin:v2';
    IF _before #>> '{updates,state}' <> 'subscribed' THEN
      IF _before #>> '{email,state}' = 'no_address' THEN _err := 'NO_EMAIL_ADDRESS';
      ELSIF _before #>> '{email,state}' <> 'on' THEN _err := 'EMAIL_OFF';
      ELSE
        INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
        VALUES (_c.id, _row_addr, 'email', 'newsletter', 'granted', 'customer_portal', public._client_portal_evidence_ref(_uid, _disclosure), NULL, clock_timestamp());
        _changed := true;
      END IF;
    END IF;
  ELSIF _ch = 'email' THEN
    _disclosure := 'updates-optin:v2';
    IF _before #>> '{updates,state}' IN ('subscribed','paused') THEN
      INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
      VALUES (_c.id, _row_addr, 'email', 'newsletter', 'revoked', 'customer_portal', public._client_portal_evidence_ref(_uid, _disclosure), NULL, clock_timestamp());
      _changed := true;
    END IF;
  ELSIF NOT p_enabled THEN
    _disclosure := 'sms-pref:v2';
    IF (_before #>> '{sms,can_turn_off}')::boolean THEN
      INSERT INTO public.paige_suppressions(contact_id, address_normalized, channel, reason, source, created_at)
      VALUES (_c.id, _row_addr, 'sms', 'customer_request', 'customer_portal', clock_timestamp()) ON CONFLICT DO NOTHING;
      INSERT INTO public.paige_consent_events(contact_id, address_normalized, channel, topic, action, source, evidence_ref, ip, created_at)
      VALUES (_c.id, _row_addr, 'sms', NULL, 'revoked', 'customer_portal', public._client_portal_evidence_ref(_uid, _disclosure), NULL, clock_timestamp());
      _changed := true;
    END IF;
  ELSE
    -- D1 (owner): texts are never turned ON from the portal. TCPA consent must come from the
    -- subscriber of the number, and the portal phone is self-edited and unverified. The honest route
    -- is replying START to a text from the business (handle-inbound-sms records it with carrier
    -- evidence). A state that is already on replays.
    _disclosure := 'sms-pref:v2';
    IF _before #>> '{sms,state}' <> 'on' THEN _err := 'SMS_OPT_IN_UNAVAILABLE'; END IF;
  END IF;

  PERFORM set_config('paige.customer_consent_write', '', true);
  PERFORM set_config('paige.customer_consent_contact', '', true);

  IF _changed THEN
    INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
    VALUES (_uid, 'client_portal', 'communication_preference_set', _c.id,
      jsonb_build_object('actor_user_id', _uid, 'tenant_id', _c.tenant_id, 'client_id', _c.id,
        'channel', _ch, 'topic', _topic, 'enabled', p_enabled, 'disclosure', _disclosure,
        'via', 'client_portal_set_communication_preference'));
  END IF;
  _after := public.client_portal_communication_preferences(_c.tenant_id);
  IF _after IS NULL OR _after->>'tenant_id' IS DISTINCT FROM _c.tenant_id::text THEN
    RAISE EXCEPTION 'customer preferences readback unavailable' USING ERRCODE = '42501';
  END IF;
  IF _err IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', _err, 'preferences', _after);
  END IF;
  RETURN jsonb_build_object('ok', true, 'replayed', NOT _changed, 'preferences', _after);
END $$;

-- client_portal_set_shared_context_consent: from 20271110215000_e09_customer_portal_profile_consent.sql (Profile & Consent 20271110215000); the resolver call becomes the gate ('none'), and the row is re-proven open under its update lock right after the advisory key. Nothing else changes.
CREATE OR REPLACE FUNCTION public.client_portal_set_shared_context_consent(p_allow boolean, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _c public.clients%ROWTYPE;
  _changed boolean := false;
  _after jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_allow IS NULL THEN
    RAISE EXCEPTION 'BAD_PREFERENCE: allow must be true or false' USING ERRCODE = '22023';
  END IF;
  _client_id := public._client_portal_lock_relationship(p_tenant_id, 'none');
  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal_pref:' || _client_id::text, 0));
  -- Re-proven open under the lock, after the key the staff pause/lift RPC also takes (that order is kept).
  IF public._client_portal_lock_relationship(p_tenant_id, 'update') IS DISTINCT FROM _client_id THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT c.* INTO _c FROM public.clients c
   WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active' AND c.merged_into_contact_id IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id = _c.tenant_id AND t.status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  IF coalesce(_c.paige_shared_context_consent, false) IS DISTINCT FROM p_allow THEN
    PERFORM set_config('paige.customer_consent_write', 'on', true);
    PERFORM set_config('paige.customer_consent_contact', _c.id::text, true);
    -- Also bumps clients.updated_at (update_clients_updated_at), so an open profile form gets the
    -- existing 40001 "changed; reload" answer on its next save.
    UPDATE public.clients SET paige_shared_context_consent = p_allow,
           paige_shared_context_consent_updated_at = clock_timestamp()
     WHERE id = _c.id AND tenant_id = _c.tenant_id AND linked_user_id = _uid;
    PERFORM set_config('paige.customer_consent_write', '', true);
    PERFORM set_config('paige.customer_consent_contact', '', true);
    INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
    VALUES (_uid, 'client_portal', 'shared_context_consent_set', _c.id,
      jsonb_build_object('actor_user_id', _uid, 'tenant_id', _c.tenant_id, 'client_id', _c.id,
        'allowed', p_allow, 'disclosure', 'data-sharing:v1',
        'disclosure_md5', left(md5(public.client_portal_consent_disclosure('data-sharing:v1')), 12),
        'via', 'client_portal_set_shared_context_consent'));
    _changed := true;
  END IF;
  _after := public.client_portal_communication_preferences(_c.tenant_id);
  IF _after IS NULL OR (_after #>> '{data_sharing,allowed}')::boolean IS DISTINCT FROM p_allow THEN
    RAISE EXCEPTION 'customer preferences readback unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('ok', true, 'replayed', NOT _changed, 'preferences', _after);
END $$;

-- client_portal_agreements: from 20271110220000_e09_customer_portal_agreements.sql (Agreements 20271110220000); the resolver call becomes the gate ('share'). Nothing else changes.
CREATE OR REPLACE FUNCTION public.client_portal_agreements(p_tenant_id uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _business text;
  _limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  _rows jsonb;
  _total integer;
  _summary jsonb;
  _keys text[];
  _login_key text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  _client_id := public._client_portal_lock_relationship(p_tenant_id, 'share');
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  -- LOCK SCOPE (the same in both reads): the customer's own client row only, like Progress — never
  -- the business's tenants row on every page load. The one writer also share-locks the tenant.
  SELECT c.tenant_id, t.name INTO _tenant, _business
    FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
   WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
     AND c.merged_into_contact_id IS NULL AND t.status = 'active'
   FOR SHARE OF c;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _keys := public._client_portal_my_email_keys(_uid, _client_id);
  _login_key := public._client_portal_login_email_key(_uid);

  -- "Sign by" is the date that actually binds: for a row waiting on THIS customer, the earlier of the
  -- agreement's deadline and the emailed link's own expiry (the state's 'deadline'). Every other row
  -- carries the agreement's own expires_at.
  WITH mine AS (
    SELECT a.id, a.title, a.commercial_terms_id, a.status, a.sent_at, a.completed_at,
           a.sealed_storage_key, st.st,
           CASE WHEN st.st->>'state' = 'awaiting_you'
                THEN coalesce((st.st->>'deadline')::timestamptz, a.expires_at)
                ELSE a.expires_at END AS expires_at
      FROM public.paige_agreements a
      CROSS JOIN LATERAL (SELECT public._client_portal_agreement_state(a.id, _keys, _login_key) AS st) st
     WHERE a.tenant_id = _tenant AND a.contact_id = _client_id AND a.status <> 'draft'
       AND public._client_portal_agreement_is_mine(a.id, _keys)
  ), shaped AS (
    SELECT m.*,
           (m.st->>'state' = 'awaiting_you') AS waiting,
           jsonb_build_object(
             'id', m.id,
             'title', left(m.title, 200),
             'engagement_title', (SELECT left(tca.title, 200) FROM public.tenant_client_agreements tca
                                   WHERE tca.id = m.commercial_terms_id AND tca.tenant_id = _tenant
                                     AND tca.contact_id = _client_id),
             'state', m.st->>'state',
             'sent_at', m.sent_at,
             'completed_at', m.completed_at,
             'expires_at', m.expires_at,
             'can_sign', (m.st->>'can_sign')::boolean,
             'can_download', (m.status = 'completed' AND m.sealed_storage_key IS NOT NULL),
             'sign_note', m.st->>'sign_note',
             'counterparty', m.st->>'counterparty',
             'link_emailed', (m.st->>'link_emailed')::boolean) AS item
      FROM mine m
  ), ordered AS (
    SELECT s.item, row_number() OVER (ORDER BY
             s.waiting DESC,
             CASE WHEN s.waiting THEN s.expires_at END ASC NULLS LAST,
             coalesce(s.completed_at, s.sent_at) DESC NULLS LAST,
             s.id) AS rn,
           count(*) OVER () AS total
      FROM shaped s
  )
  SELECT coalesce(jsonb_agg(o.item ORDER BY o.rn) FILTER (WHERE o.rn <= _limit), '[]'::jsonb),
         coalesce(max(o.total), 0)
    INTO _rows, _total
    FROM ordered o;

  SELECT jsonb_build_object(
           'awaiting_you', count(*) FILTER (WHERE public._client_portal_agreement_state(a.id, _keys, _login_key)->>'state' = 'awaiting_you'),
           'signed', count(*) FILTER (WHERE a.status = 'completed'))
    INTO _summary
    FROM public.paige_agreements a
   WHERE a.tenant_id = _tenant AND a.contact_id = _client_id AND a.status <> 'draft'
     AND public._client_portal_agreement_is_mine(a.id, _keys);

  RETURN jsonb_build_object('tenant_id', _tenant, 'business_name', _business, 'server_now', now(),
    'summary', _summary, 'agreements', _rows, 'has_more', _total > _limit);
END;
$$;

-- client_portal_open_agreement_signing: from 20271110220000_e09_customer_portal_agreements.sql (Agreements 20271110220000); the resolver call becomes the gate ('share'). Nothing else changes.
CREATE OR REPLACE FUNCTION public.client_portal_open_agreement_signing(p_agreement_id uuid, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _a public.paige_agreements%ROWTYPE;
  _st jsonb;
  _signer uuid;
  _locked integer;
  _token text;
  _expires timestamptz;
  _emailed_expiry timestamptz;
  _revoked_at timestamptz;
  _keys text[];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  _client_id := public._client_portal_lock_relationship(p_tenant_id, 'share');
  IF _client_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_AGREEMENT_UNAVAILABLE'); END IF;
  -- The writer, like the Messages writer, share-locks the client AND the business, so neither the
  -- relationship nor the business can be switched off between this check and the token write.
  SELECT c.tenant_id INTO _tenant
    FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
   WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
     AND c.merged_into_contact_id IS NULL AND t.status = 'active'
   FOR SHARE OF c, t;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_AGREEMENT_UNAVAILABLE'); END IF;

  -- Scope first, unlocked: this customer's own, sent agreement in this business, on which they are a
  -- counterparty signer (VISIBILITY), or the one refusal — an agreement the list does not show is
  -- not opened either.
  _keys := public._client_portal_my_email_keys(_uid, _client_id);
  PERFORM 1 FROM public.paige_agreements a
   WHERE a.id = p_agreement_id AND a.tenant_id = _tenant AND a.contact_id = _client_id AND a.status <> 'draft'
     AND public._client_portal_agreement_is_mine(a.id, _keys);
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_AGREEMENT_UNAVAILABLE'); END IF;

  -- Every counterparty row of this agreement, locked, so the "exactly one" read below cannot race.
  SELECT count(*) INTO _locked FROM (
    SELECT s.id FROM public.paige_agreement_signers s
     WHERE s.agreement_id = p_agreement_id AND s.signer_role = 'counterparty'
     ORDER BY s.id FOR UPDATE) l;

  SELECT * INTO _a FROM public.paige_agreements a
   WHERE a.id = p_agreement_id AND a.tenant_id = _tenant AND a.contact_id = _client_id
   FOR KEY SHARE;
  IF NOT FOUND OR _a.status = 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_AGREEMENT_UNAVAILABLE');
  END IF;

  _st := public._client_portal_agreement_state(_a.id, _keys, public._client_portal_login_email_key(_uid));
  -- Waiting on a signature the portal cannot prove is this customer's: the same "not here" answer the
  -- list gives, with the same note.
  IF _st->>'state' = 'awaiting_signature' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', coalesce(_st->>'sign_note', 'use_email_link'));
  END IF;
  IF _st->>'state' <> 'awaiting_you' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE', 'state', _st->>'state');
  END IF;
  IF (_st->>'can_sign')::boolean IS NOT TRUE OR _locked <> 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', coalesce(_st->>'sign_note', 'use_email_link'));
  END IF;
  _signer := (_st->>'signer_id')::uuid;

  -- target_type leads so the count rides idx_audit_target (target_type, target_id, created_at DESC).
  IF (SELECT count(*) FROM public.paige_audit_log l
       WHERE l.target_type = 'paige_agreement' AND l.target_id = _a.id
         AND l.action = 'agreement.portal_link_issued'
         AND l.actor_user_id = _uid AND l.created_at > now() - interval '1 hour') >= 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TRY_AGAIN_LATER');
  END IF;

  -- The deadline. When a link was emailed: the EARLIER of the agreement's and the emailed link's
  -- (read from the signer row this transaction holds locked), never later than either, never
  -- invented — so no link outlives the one the business sent. When none was ever emailed (the
  -- integrator default the owner may overrule, see the state helper): the EARLIER of the agreement's
  -- deadline and now() + 24 hours, so the portal never yields a long-lived link nobody emailed. A
  -- revoked link is refused here too, on the locked row: the portal never mints over a revocation.
  -- The state above already refused these cases; they are re-checked on the locked row even if the
  -- two ever drift.
  SELECT s.token_expires_at, s.token_revoked_at INTO _emailed_expiry, _revoked_at
    FROM public.paige_agreement_signers s WHERE s.id = _signer;
  IF (_st->>'link_emailed')::boolean IS NOT FALSE THEN
    _expires := least(_a.expires_at, _emailed_expiry);
  ELSE
    _expires := least(_a.expires_at, now() + interval '24 hours');
  END IF;
  IF _revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', 'link_revoked');
  END IF;
  IF _expires IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', 'use_email_link');
  END IF;
  IF _expires <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', 'link_expired');
  END IF;

  -- 256 bits from pgcrypto's CSPRNG; only the digest is stored. pgcrypto is schema-qualified: it
  -- lives in `extensions`, which this function's pinned search_path deliberately does not include.
  _token := encode(extensions.gen_random_bytes(32), 'hex');

  UPDATE public.paige_agreement_signers
     SET token_hash = encode(extensions.digest(_token, 'sha256'), 'hex'),
         token_expires_at = _expires,
         updated_at = now()
   WHERE id = _signer AND agreement_id = _a.id AND status IN ('pending','viewed')
     AND token_revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_SIGNABLE_HERE', 'note', 'use_email_link'); END IF;

  INSERT INTO public.paige_audit_log (actor_user_id, actor_role, action, target_type, target_id, tenant_id, payload)
  VALUES (_uid, 'client', 'agreement.portal_link_issued', 'paige_agreement', _a.id, _tenant,
          jsonb_build_object('signer_id', _signer));

  RETURN jsonb_build_object('ok', true, 'token', _token, 'expires_at', _expires);
END;
$$;

-- client_portal_agreement_document_scope: from 20271110220000_e09_customer_portal_agreements.sql (Agreements 20271110220000); the resolver call becomes the gate ('share'). Nothing else changes.
CREATE OR REPLACE FUNCTION public.client_portal_agreement_document_scope(p_agreement_id uuid, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _tenant uuid;
  _out jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  _client_id := public._client_portal_lock_relationship(p_tenant_id, 'share');
  IF _client_id IS NOT NULL THEN
    SELECT c.tenant_id INTO _tenant
      FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
     WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
       AND c.merged_into_contact_id IS NULL AND t.status = 'active'
     FOR SHARE OF c;
  END IF;
  IF _tenant IS NOT NULL THEN
    SELECT jsonb_build_object('agreement_id', a.id, 'tenant_id', a.tenant_id, 'title', left(a.title, 200))
      INTO _out
      FROM public.paige_agreements a
     WHERE a.id = p_agreement_id AND a.tenant_id = _tenant AND a.contact_id = _client_id
       AND a.status = 'completed' AND a.sealed_storage_key IS NOT NULL
       -- VISIBILITY: only a copy on which this customer is a counterparty signer (the sealed
       -- certificate names its signers; one that names only other people is not theirs).
       AND public._client_portal_agreement_is_mine(a.id, public._client_portal_my_email_keys(_uid, _client_id));
  END IF;
  IF _out IS NULL THEN
    RAISE EXCEPTION 'CLIENT_AGREEMENT_UNAVAILABLE' USING ERRCODE = '42501';
  END IF;
  RETURN _out;
END;
$$;

-- _client_portal_billing_client: from 20271110230000_e09_customer_portal_payments.sql (Payments 20271110230000 (serves client_portal_invoices, _invoice_ledger and _invoice_payment_request)); the resolver call becomes the gate ('share'). Nothing else changes.
CREATE OR REPLACE FUNCTION public._client_portal_billing_client(p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _proven uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  -- A deleted or banned account is not a signed-in customer, whatever its token says (#2170).
  PERFORM 1 FROM auth.users u
  WHERE u.id = _uid AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until < now())
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501'; END IF;
  -- The platform owner is never anyone's customer here (#2170).
  IF public.is_platform_owner() IS TRUE THEN RETURN NULL; END IF;
  _client_id := public._client_portal_lock_relationship(p_tenant_id, 'share');
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  -- Serialize against access changes and re-prove under the lock.
  SELECT c.id INTO _proven
  FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.id = _client_id AND c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active'
  FOR SHARE OF c, t;
  -- Someone who is both a linked client and active staff of the same business reads that business
  -- as staff, never through the customer door (#2170). Staff of a different business are unaffected.
  IF _proven IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenant_members m JOIN public.clients c ON c.tenant_id = m.tenant_id
    WHERE c.id = _proven AND m.user_id = _uid AND m.status = 'active') THEN
    RETURN NULL;
  END IF;
  RETURN _proven;
END;
$$;

-- ── 13. Owner reads that said "can see it" from the link alone (§37 consumer inventory, round 2) ──
-- Pausing keeps the link, so "linked" no longer means "can see". Four owner-facing answers read the link
-- alone and so told the owner a paused client could open what they had just shared (or that an ended
-- client had never joined). Each is its newest body (the file named on its line) with the access state
-- added; nothing else changes.
--   * client_file_set_client_share, plan_item_set_client_share: portal_connected is now "linked AND access
--     open", and the reply gains portal_access (open | paused | ended | not_joined, or NULL with no live
--     client) so a caller can say why not. Every consumer reads the reply's keys by name, never exactly.
--   * client_file_owner_list: portal_connected likewise. Its envelope keys are UNCHANGED, because the Files
--     card validates them exactly (useClientFilesOwner LIST_KEYS); the card names paused / ended from the
--     record's own access state.
--   * read_client_communication_state: gains portal_access beside portal_joined. Its reader
--     (readClientCommunicationState) accepts the key from this migration on, and still accepts its absence.
-- The one wording of that state, shared by all four (internal; no API role may call it).
CREATE OR REPLACE FUNCTION public._client_portal_access_word(p_found boolean, p_linked uuid, p_state text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_found IS NOT TRUE THEN NULL
    WHEN p_state = 'paused' THEN 'paused'
    WHEN p_state = 'ended' THEN 'ended'
    WHEN p_linked IS NULL THEN 'not_joined'
    ELSE 'open' END;
$$;
REVOKE ALL ON FUNCTION public._client_portal_access_word(boolean, uuid, text) FROM PUBLIC, anon, authenticated, service_role;

-- client_file_set_client_share: from 20271110200000_e09_customer_portal_documents.sql (Documents); + the access state in portal_connected, + portal_access.
CREATE OR REPLACE FUNCTION public.client_file_set_client_share(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_file_id uuid, p_shared boolean,
  p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_account_type text;
  v_parent uuid;
  v_row public.client_files%ROWTYPE;
  v_linked uuid;
  v_state text;
  v_client_found boolean;
BEGIN
  -- 1. Caller.
  IF v_actor IS NULL OR p_expected_actor_id IS NULL OR v_actor IS DISTINCT FROM p_expected_actor_id
     OR p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.profiles WHERE user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501'; END IF;
  -- 2. Workspace and role (§59).
  v_tenant := public.current_user_tenant_id();
  IF v_tenant IS DISTINCT FROM p_expected_tenant_id OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  IF p_file_id IS NULL OR p_shared IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST');
  END IF;
  -- 3. Tier (§61 exception, as Slice 3).
  SELECT t.account_type::text, t.parent_tenant_id INTO v_account_type, v_parent
  FROM public.tenants t WHERE t.id = v_tenant;
  IF v_account_type = 'agency' AND v_parent IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_FILES_UNAVAILABLE');
  END IF;
  -- 4. Load. Another workspace's file is indistinguishable from a missing one.
  SELECT * INTO v_row FROM public.client_files WHERE id = p_file_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'FILE_NOT_FOUND'); END IF;
  -- 5. Shape. What the client sent stays theirs; an unfinished upload has nothing to show.
  IF v_row.visibility = 'client_upload' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FILE_IS_CLIENT_UPLOAD');
  END IF;
  IF v_row.upload_state <> 'ready' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FILE_NOT_READY');
  END IF;
  SELECT c.linked_user_id, c.portal_access_state INTO v_linked, v_state FROM public.clients c
  WHERE c.id = v_row.contact_id AND c.tenant_id = v_tenant AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL
  FOR SHARE OF c;
  v_client_found := FOUND;
  -- Sharing needs a live client. Withdrawing a share never does: unsharing is always allowed.
  IF NOT v_client_found AND p_shared THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND');
  END IF;
  -- 6. State replay: a retry of a change that already landed answers from the row, writes nothing.
  IF (v_row.visibility = 'shared') = p_shared THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'file_id', v_row.id, 'shared', p_shared,
      'shared_at', v_row.shared_at, 'updated_at', v_row.updated_at, 'portal_connected', v_client_found AND v_linked IS NOT NULL AND v_state = 'open',
      'portal_access', public._client_portal_access_word(v_client_found, v_linked, v_state));
  END IF;
  -- 7. Version: the owner shares exactly the file they last saw.
  IF p_expected_updated_at IS NULL OR v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FILE_CHANGED', 'updated_at', v_row.updated_at);
  END IF;
  -- 8. Write. The share-stamp trigger records shared_at / shared_by; the flag opens its gate for
  -- this one UPDATE and is closed again before anything else runs in the transaction.
  PERFORM set_config('paige.client_file_share', 'on', true);
  UPDATE public.client_files SET visibility = CASE WHEN p_shared THEN 'shared' ELSE 'internal' END::public.client_file_visibility
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  PERFORM set_config('paige.client_file_share', 'off', true);
  -- 9. Audit. Fixed references only, never a filename.
  INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
  VALUES (v_actor, 'client_files', CASE WHEN p_shared THEN 'client_share' ELSE 'client_unshare' END, v_row.id,
    jsonb_build_object('tenant_id', v_tenant, 'contact_id', v_row.contact_id, 'file_id', v_row.id));
  -- 10. Result. portal_connected says whether the client can see it yet: linked AND access open (Slice 7);
  -- portal_access names why not. No notification is sent (D4).
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'file_id', v_row.id, 'shared', p_shared,
    'shared_at', v_row.shared_at, 'updated_at', v_row.updated_at, 'portal_connected', v_client_found AND v_linked IS NOT NULL AND v_state = 'open',
      'portal_access', public._client_portal_access_word(v_client_found, v_linked, v_state));
END;
$$;

-- client_file_owner_list: from 20271110200000_e09_customer_portal_documents.sql (Documents); + the access state in portal_connected.
CREATE OR REPLACE FUNCTION public.client_file_owner_list(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_contact_id uuid, p_limit integer DEFAULT 100,
  p_before timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_account_type text;
  v_parent uuid;
  v_linked boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_files jsonb;
  v_more boolean;
BEGIN
  IF v_actor IS NULL OR p_expected_actor_id IS NULL OR v_actor IS DISTINCT FROM p_expected_actor_id
     OR p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.current_user_tenant_id();
  IF v_tenant IS DISTINCT FROM p_expected_tenant_id OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'FILE_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  -- A page cursor is the (created_at, id) of the last file shown; both halves or neither.
  IF p_contact_id IS NULL OR (p_before IS NULL) <> (p_before_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST');
  END IF;
  SELECT t.account_type::text, t.parent_tenant_id INTO v_account_type, v_parent
  FROM public.tenants t WHERE t.id = v_tenant;
  IF v_account_type = 'agency' AND v_parent IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_FILES_UNAVAILABLE');
  END IF;
  -- Slice 7: "connected" is "can open the portal now" — linked AND access open. A paused client keeps the
  -- link but sees nothing, so it is not connected. The list's keys are unchanged (the Files card reads them exactly).
  SELECT (c.linked_user_id IS NOT NULL AND c.status = 'active' AND c.merged_into_contact_id IS NULL
          AND c.portal_access_state = 'open') INTO v_linked
  FROM public.clients c WHERE c.id = p_contact_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND'); END IF;
  -- Finished files of this client in this business, plus the caller's own unfinished uploads so
  -- they can finish or abandon them. A client's unfinished upload is theirs until it is verified.
  -- Newest first by (created_at, id); the next page starts strictly after the cursor row, so a file
  -- that shares the cursor's created_at is neither repeated nor skipped.
  WITH ranked AS (
    SELECT f AS rec, row_number() OVER (ORDER BY f.created_at DESC, f.id DESC) AS rn
    FROM public.client_files f
    WHERE f.tenant_id = v_tenant AND f.contact_id = p_contact_id
      AND (f.upload_state = 'ready' OR (f.visibility <> 'client_upload' AND f.uploaded_by_user_id = v_actor))
      AND (p_before IS NULL OR (f.created_at, f.id) < (p_before, p_before_id))
  )
  SELECT coalesce(jsonb_agg(public._client_file_owner_row(r.rec) ORDER BY r.rn) FILTER (WHERE r.rn <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  INTO v_files, v_more FROM ranked r WHERE r.rn <= v_limit + 1;
  RETURN jsonb_build_object('ok', true, 'contact_id', p_contact_id, 'portal_connected', v_linked,
    'files', v_files, 'has_more', v_more);
END;
$$;

-- plan_item_set_client_share: from 20271110030000_e09_customer_portal_progress.sql (Progress); + the access state in portal_connected, + portal_access.
CREATE OR REPLACE FUNCTION public.plan_item_set_client_share(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_item_id uuid, p_shared boolean,
  p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_account_type text;
  v_parent uuid;
  v_row public.plan_items%ROWTYPE;
  v_linked uuid;
  v_state text;
  v_client_found boolean;
  v_shared_at timestamptz;
  v_updated_at timestamptz;
BEGIN
  -- 1. Caller: the session subject, and the caller's own expectation of who they are.
  IF v_actor IS NULL OR p_expected_actor_id IS NULL OR v_actor IS DISTINCT FROM p_expected_actor_id
     OR p_expected_tenant_id IS NULL THEN
    RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  -- A workspace switch updates this same profile row; holding its lock serializes against it.
  PERFORM 1 FROM public.profiles WHERE user_id = v_actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE = '42501'; END IF;
  -- 2. Workspace and role: the current workspace, business owner/admin of it. Never a global role (§59).
  v_tenant := public.current_user_tenant_id();
  IF v_tenant IS DISTINCT FROM p_expected_tenant_id OR NOT public.is_tenant_admin(v_tenant) THEN
    RAISE EXCEPTION 'PLAN_SCOPE_CHANGED' USING ERRCODE = '42501';
  END IF;
  IF p_item_id IS NULL OR p_shared IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_REQUEST');
  END IF;
  -- 3. Tier: a top-level agency manages sub-accounts, not a direct client book (§61 exception).
  SELECT t.account_type::text, t.parent_tenant_id INTO v_account_type, v_parent
  FROM public.tenants t WHERE t.id = v_tenant;
  IF v_account_type = 'agency' AND v_parent IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLIENT_SHARE_UNAVAILABLE');
  END IF;
  -- 4. Load. Another workspace's item is indistinguishable from a missing one.
  SELECT * INTO v_row FROM public.plan_items
  WHERE id = p_item_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ITEM_NOT_FOUND'); END IF;
  -- 5. Shape. Only a client-linked milestone or task is ever shareable.
  IF v_row.contact_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ITEM_NOT_CLIENT_LINKED');
  END IF;
  IF v_row.item_type NOT IN ('milestone','task') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ITEM_NOT_SHAREABLE');
  END IF;
  SELECT c.linked_user_id, c.portal_access_state INTO v_linked, v_state FROM public.clients c
  WHERE c.id = v_row.contact_id AND c.tenant_id = v_tenant AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL
  FOR SHARE OF c;
  v_client_found := FOUND;
  -- Sharing needs a live client. Withdrawing a share never does: unsharing is always allowed.
  IF NOT v_client_found AND p_shared THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONTACT_NOT_FOUND');
  END IF;
  -- 6. State replay: a retry of a change that already landed answers from the row, writes nothing.
  IF (v_row.client_shared_at IS NOT NULL) = p_shared THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'item_id', v_row.id, 'shared', p_shared,
      'shared_at', v_row.client_shared_at, 'updated_at', v_row.updated_at);
  END IF;
  -- 7. Version: the owner shares exactly the title and status they last saw.
  IF p_expected_updated_at IS NULL OR v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ITEM_CHANGED', 'updated_at', v_row.updated_at);
  END IF;
  -- 8. Status: a cancelled item is never newly shown to a client.
  IF p_shared AND v_row.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ITEM_NOT_SHAREABLE');
  END IF;
  -- 9. Write.
  UPDATE public.plan_items SET
    client_shared_at = CASE WHEN p_shared THEN now() END,
    client_shared_by = CASE WHEN p_shared THEN v_actor END
  WHERE id = v_row.id
  RETURNING client_shared_at, updated_at INTO v_shared_at, v_updated_at;
  -- 10. Audit, in the planning audit sink. Fixed references only, never item prose.
  INSERT INTO public.audit_logs(user_id, entity, action, entity_id, data)
  VALUES (v_actor, 'plan_item', CASE WHEN p_shared THEN 'plan_item.client_share' ELSE 'plan_item.client_unshare' END,
    v_row.id, jsonb_build_object('tenant_id', v_tenant, 'contact_id', v_row.contact_id, 'item_id', v_row.id));
  -- 11. Result. portal_connected says whether the client can see it yet: linked AND access open (Slice 7);
  -- portal_access names why not.
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'item_id', v_row.id, 'shared', p_shared,
    'shared_at', v_shared_at, 'updated_at', v_updated_at,
    'portal_connected', v_client_found AND v_linked IS NOT NULL AND v_state = 'open',
    'portal_access', public._client_portal_access_word(v_client_found, v_linked, v_state));
END;
$$;

-- read_client_communication_state: from 20271110215000_e09_customer_portal_profile_consent.sql (Profile & Consent); + portal_access.
CREATE OR REPLACE FUNCTION public.read_client_communication_state(_expected_tenant_id uuid, _contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  _c public.clients%ROWTYPE;
  _s jsonb;
BEGIN
  IF auth.uid() IS NULL OR _expected_tenant_id IS NULL
     OR public.current_user_tenant_id() IS DISTINCT FROM _expected_tenant_id
     OR NOT public.is_tenant_admin(_expected_tenant_id) THEN
    RAISE EXCEPTION 'Client unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _c FROM public.clients WHERE id = _contact_id AND tenant_id = _expected_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client unavailable' USING ERRCODE = '42501';
  END IF;
  _s := public._client_communication_state(_c.tenant_id, _c.id);
  RETURN jsonb_build_object(
    'schema_version', 1,
    'tenant_id', _c.tenant_id,
    'contact_id', _c.id,
    'email', _s->'email',
    'sms', _s->'sms',
    'updates', _s->'updates',
    'data_sharing', _s->'data_sharing',
    'quiet_hours', _s->'quiet_hours',
    'portal_joined', _c.linked_user_id IS NOT NULL,
    -- Slice 7: joined is the link; a paused client keeps it and an ended one has lost it. This says which.
    'portal_access', public._client_portal_access_word(true, _c.linked_user_id, _c.portal_access_state),
    'do_not_contact', coalesce(_c.do_not_contact, false),
    'dnd_active', coalesce(_c.dnd_active, false) AND (_c.dnd_until IS NULL OR _c.dnd_until > now()),
    'read_at', clock_timestamp());
END $$;


COMMIT;
