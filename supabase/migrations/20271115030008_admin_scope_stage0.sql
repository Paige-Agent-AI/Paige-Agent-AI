-- Admin scope, STAGE 0: being owner or admin of one business never gives admin power in another.
--
-- Owner ruling (2026-10-26, docs/brain/decision-log.md): in someone else's workspace a person has
-- exactly the seat role that workspace gave them. Platform-operator authority (super_admin /
-- platform_admin, is_platform_owner / is_platform_operator, CLAUDE.md §53) is unaffected, and owners,
-- admins and PAIGE keep full create/change/delete inside their own workspace.
--
-- WHY STAGE 0. user_roles has no tenant column, and trg_sync_tenant_member_to_user_roles writes a
-- global 'admin' row for every active owner/admin seat in ANY workspace. So has_role(uid,'admin')
-- means "admin somewhere". Stage 1 (not this migration) re-answers has_role/has_any_role for the
-- caller's current workspace. That cannot reach the objects below, which either bind no tenant at
-- all, or take the target tenant from the caller, or read 'admin' through current_user_roles().
-- They are live holes today for every owner (9 seat-backed global admins plus 1 orphan on
-- production, 2026-10-26). This migration closes them without touching has_role, has_any_role,
-- current_user_roles, is_staff, the sync triggers or any user_roles row.
--
-- Every function below is production's definition (pg_get_functiondef, 2026-10-26) re-emitted
-- verbatim except the authority lines marked "-- STAGE 0:". Every policy is production's
-- (pg_policies, 2026-10-26) with the same name, command and expression except the authority branch.
-- Where a rewritten policy calls is_workspace_admin() its role list is narrowed from {public} to
-- {authenticated}: anon can never satisfy an admin branch (auth.uid() is NULL), and this keeps the
-- new definer helper off anon. Proof: supabase/tests/admin_scope_stage0.sql (failing-first + mutants).
--
-- Rollback: each prior definition is the one quoted in the proof's BASELINE section; re-applying it
-- in a forward migration restores today's behaviour exactly. Nothing here deletes data.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 0. ONE definition of "workspace admin" (B3: created first, in this same migration).
--
-- is_workspace_admin(_tenant) = the CALLER (auth.uid()) holds an active owner/admin seat in _tenant,
-- or an agency that manages _tenant lets the caller manage it (agency_can_manage_child). It is the
-- database twin of supabase/functions/_shared/workspace-authority.ts (is_tenant_admin_as OR
-- agency_can_manage_child).
--
-- Why it is NOT is_tenant_admin(_t): is_tenant_admin also answers true for a platform operator in a
-- company workspace (is_company_workspace AND is_platform_operator). Re-using it here would hand
-- platform_admin new power on every object below that today only a global 'admin' row opened. Every
-- caller that should keep that operator branch already ORs is_platform_owner()/is_tenant_admin in
-- explicitly. It also adds the agency branch, which is_tenant_admin lacks.
--
-- How studio_role_ok(_caller) relates (left unchanged here, §18): for _caller = auth.uid(),
-- studio_role_ok = is_tenant_admin(current_user_tenant_id()) OR agency_can_manage_child(cuti, _caller)
--                = is_workspace_admin(current_user_tenant_id()) OR (company workspace AND operator).
-- A later stage can define studio_role_ok on top of this helper; it is not changed now so the Studio
-- surfaces keep their exact behaviour.
--
-- KNOWN GAP, NOT FIXED HERE (S2): agency_enter_subaccount inserts a permanent active 'admin' seat in
-- the child for whoever enters, including a scoped agency_specialist, and nothing removes it when the
-- agency link ends. This helper (like is_tenant_admin) honours that left-behind seat.
-- _finance_assert_workspace already refuses it for parented tenants. Production has 0 child tenants
-- (2026-10-26), so there is no live victim; the fix is a separate decision.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_workspace_admin(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _tenant IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND (
       EXISTS (
         SELECT 1 FROM public.tenant_members m
          WHERE m.tenant_id = _tenant
            AND m.user_id = auth.uid()
            AND m.status = 'active'
            AND m.role IN ('owner','admin')
       )
       OR public.agency_can_manage_child(_tenant, auth.uid())
     );
$function$;
REVOKE ALL ON FUNCTION public.is_workspace_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.is_workspace_admin(uuid) IS
  'Caller (auth.uid()) is an active owner/admin of _tenant, or an agency managing _tenant lets them manage it. '
  'No platform-operator branch (unlike is_tenant_admin). Owner ruling 2026-10-26, migration 20271115030008.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 1. FUNCTIONS (M2 + B2 + S3)
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- change_user_role: the caller names the tenant. "OR global admin" let an owner of A change roles and
-- upsert seats in ANY tenant. The target tenant's own admin (is_tenant_admin keeps its company-
-- workspace operator branch) or the agency managing it (is_workspace_admin) is now required.
-- And because user_roles has no tenant column, the role it writes reaches every workspace the target
-- is in: outside the platform-operator paths (the platform owner; an operator in the company
-- workspace), the target must already hold an ACTIVE seat in this workspace. Otherwise an admin of A
-- could hand a stranger, or B's own people, a platform-wide role (the stage-0 verifier's repros).
CREATE OR REPLACE FUNCTION public.change_user_role(_target_user_id uuid, _from_role app_role, _to_role app_role, _tenant_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _resolved_tenant uuid;
  _is_owner_call boolean := public.is_platform_owner();
  _is_admin_call boolean;
  _target_is_owner boolean;
  _tenant_role public.tenant_role;
  _protected public.app_role[] := ARRAY['admin','super_admin','platform_admin']::public.app_role[];
  _operator_path boolean;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'ROLE_CHANGE_UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  _resolved_tenant := COALESCE(_tenant_id, public.current_user_tenant_id());
  IF _resolved_tenant IS NULL THEN
    RAISE EXCEPTION 'ROLE_CHANGE_NO_TENANT' USING ERRCODE = '22023';
  END IF;

  -- STAGE 0: was "is_tenant_admin(_resolved_tenant) OR has_role(_caller, 'admin')".
  _is_admin_call := public.is_tenant_admin(_resolved_tenant) OR public.is_workspace_admin(_resolved_tenant);

  IF NOT (_is_owner_call OR _is_admin_call) THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF NOT _is_owner_call AND (_from_role = ANY(_protected) OR _to_role = ANY(_protected)) THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: cannot modify admin or super_admin (owner-only)'
      USING ERRCODE = '42501';
  END IF;

  IF _to_role = 'coach'::public.app_role THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: coach is a title, never a role' USING ERRCODE = '42501';
  END IF;

  IF _to_role = 'super_admin'::public.app_role THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: super_admin is bootstrap-only' USING ERRCODE = '42501';
  END IF;

  -- STAGE 0: only the workspace's own active people. The platform-operator paths are unchanged.
  _operator_path := _is_owner_call
    OR (public.is_company_workspace(_resolved_tenant) AND public.is_platform_operator());
  IF NOT _operator_path AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members m
     WHERE m.tenant_id = _resolved_tenant AND m.user_id = _target_user_id AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: this person is not an active member of this workspace'
      USING ERRCODE = '42501';
  END IF;

  -- FIX-2 (§9, Slice A Option 1): read the authoritative is_owner signal, NOT the
  -- display-only tenants.owner_user_id, and REFUSE any role change on a tenant owner
  -- (incl. a grant_co_owner co-owner). Ownership mutates ONLY via revoke_co_owner().
  _target_is_owner := public.is_tenant_owner(_target_user_id, _resolved_tenant);
  IF _target_is_owner THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: this member is a tenant owner; use revoke_co_owner() to change ownership'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _target_user_id AND role = _from_role;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, _to_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  BEGIN
    _tenant_role := public.map_app_role_to_tenant_role(_to_role);
    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, invited_at, joined_at)
    VALUES (_resolved_tenant, _target_user_id, _tenant_role, 'active', now(), now())
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET role = EXCLUDED.role, status = 'active', updated_at = now()
      WHERE public.tenant_members.role <> 'owner'::public.tenant_role;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.paige_audit_log
      (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
    VALUES (
      _caller,
      CASE WHEN _is_owner_call THEN 'super_admin' ELSE 'admin' END,
      'role:change:mirror_failed', 'user_role', _target_user_id,
      jsonb_build_object(
        'from_role', _from_role,
        'to_role', _to_role,
        'tenant_id', _resolved_tenant,
        'error_message', SQLERRM,
        'error_code', SQLSTATE
      ),
      _resolved_tenant
    );
  END;

  INSERT INTO public.paige_audit_log
    (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
  VALUES (
    _caller,
    CASE WHEN _is_owner_call THEN 'super_admin' ELSE 'admin' END,
    'role:change', 'user_role', _target_user_id,
    jsonb_build_object('from_role', _from_role, 'to_role', _to_role,
                       'tenant_id', _resolved_tenant, 'reason', _reason),
    _resolved_tenant
  );
END;
$function$;

-- get_profile_with_pii_log: returns another person's full profiles row (encrypted SSN, date of
-- birth) to any global admin. Its one caller (ProfileSettings.tsx) reads the caller's own row.
-- Now: self, or the platform owner. Whether a workspace admin may read a client's PII is OPEN (owner).
CREATE OR REPLACE FUNCTION public.get_profile_with_pii_log(_user_id uuid)
 RETURNS SETOF profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- STAGE 0: was "NOT public.has_role(auth.uid(), 'admin')".
  IF auth.uid() != _user_id AND NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO public.pii_access_log (
    accessed_user_id,
    accessor_user_id,
    table_name,
    field_names,
    access_type,
    accessed_at
  ) VALUES (
    _user_id,
    auth.uid(),
    'profiles',
    ARRAY['ssn_encrypted', 'date_of_birth', 'ssn_last_4'],
    'read',
    NOW()
  );

  RETURN QUERY SELECT * FROM public.profiles WHERE user_id = _user_id;
END;
$function$;

-- delete_credit_report_upload: any global admin could delete any person's upload. Now the upload's
-- own workspace admin (credit_report_uploads.tenant_id is NOT NULL), or the platform owner.
CREATE OR REPLACE FUNCTION public.delete_credit_report_upload(_upload_id uuid, _calling_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _upload record;
  _file_path text;
BEGIN
  -- STAGE 0: was "_caller IS NULL OR NOT (public.has_role(_caller, 'admin'::app_role))".
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT id, file_path, user_id, tenant_id INTO _upload
  FROM public.credit_report_uploads
  WHERE id = _upload_id;

  IF _upload IS NULL THEN
    -- STAGE 0: only a caller who is admin of their current workspace (or the operator) learns this.
    IF NOT (public.is_platform_owner() OR public.is_workspace_admin(public.current_user_tenant_id())) THEN
      RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;
    RETURN json_build_object('success', false, 'message', 'Upload not found');
  END IF;

  -- STAGE 0: the upload's own workspace.
  IF NOT (public.is_platform_owner() OR public.is_workspace_admin(_upload.tenant_id)) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  _file_path := _upload.file_path;

  DELETE FROM public.credit_report_personal_info
  WHERE credit_report_upload_id = _upload_id;

  DELETE FROM public.credit_report_uploads
  WHERE id = _upload_id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (
    _caller,
    'credit_report_uploads',
    'admin_delete',
    _upload_id,
    jsonb_build_object('file_path', _file_path, 'target_user_id', _upload.user_id::text)
  );

  RETURN json_build_object(
    'success', true,
    'file_path', _file_path,
    'message', 'Upload and related data deleted'
  );
END;
$function$;

-- The five secret/URL setters overwrite a row selected only by id. growth_external_sources rows
-- belong to a workspace (tenant_id NOT NULL): that workspace's admin, or the platform owner.
-- paige_mcp_connections, paige_n8n_connections and outbound_webhook_configs carry no tenant: they are
-- platform objects, operator-only. connected_bank_account_secrets (bank credentials) has no caller
-- in source: operator-only, the safer rule.
CREATE OR REPLACE FUNCTION public.platform_set_growth_external_source_token(_id uuid, _token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- STAGE 0: was "public.has_role(auth.uid(),'admin'::app_role) OR public.is_platform_owner(auth.uid())".
  IF NOT (public.is_platform_owner(auth.uid())
          OR EXISTS (SELECT 1 FROM public.growth_external_sources s
                      WHERE s.id = _id AND public.is_workspace_admin(s.tenant_id))) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.growth_external_sources SET webhook_token_ct = public.platform_encrypt(_token) WHERE id = _id;
END; $function$;

CREATE OR REPLACE FUNCTION public.platform_set_mcp_server_url(_id uuid, _url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- STAGE 0: was "public.has_role(auth.uid(),'admin'::app_role) OR public.is_platform_owner(auth.uid())".
  IF NOT (public.is_platform_owner(auth.uid())) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.paige_mcp_connections SET server_url_ct = public.platform_encrypt(_url) WHERE id = _id;
END; $function$;

CREATE OR REPLACE FUNCTION public.platform_set_n8n_base_url(_id uuid, _url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- STAGE 0: was "public.has_role(auth.uid(),'admin'::app_role) OR public.is_platform_owner(auth.uid())".
  IF NOT (public.is_platform_owner(auth.uid())) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.paige_n8n_connections SET base_url_ct = public.platform_encrypt(_url) WHERE id = _id;
END; $function$;

CREATE OR REPLACE FUNCTION public.platform_set_outbound_webhook_url(_id uuid, _url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- STAGE 0: was "public.has_role(auth.uid(),'admin'::app_role) OR public.is_platform_owner(auth.uid())".
  IF NOT (public.is_platform_owner(auth.uid())) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.outbound_webhook_configs SET url_ct = public.platform_encrypt(_url) WHERE id = _id;
END; $function$;

CREATE OR REPLACE FUNCTION public.platform_set_plaid_access_token(_row_id uuid, _token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- STAGE 0: was "public.has_role(auth.uid(),'admin'::app_role) OR public.is_platform_owner(auth.uid())".
  IF NOT (public.is_platform_owner(auth.uid())) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.connected_bank_account_secrets SET plaid_access_token_ct = public.platform_encrypt(_token) WHERE account_row_id = _row_id;
END; $function$;

-- list_library: the caller names the tenant. A global admin read any tenant's library.
CREATE OR REPLACE FUNCTION public.list_library(p_kind text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, artifact_kind text, artifact_id uuid, title text, thumbnail_url text, note text, tags jsonb, saved_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := COALESCE(p_tenant_id, public.current_user_tenant_id());
BEGIN
  IF _tenant IS NULL THEN
    RETURN;
  END IF;
  -- STAGE 0: was "AND NOT public.has_role(_caller, 'admin'::app_role)".
  IF _caller IS NOT NULL
     AND NOT public.is_tenant_member(_tenant)
     AND NOT public.is_workspace_admin(_tenant)
     AND NOT public.is_platform_owner(_caller) THEN
    RAISE EXCEPTION 'LIBRARY_FORBIDDEN: tenant not in your membership' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT li.id, li.artifact_kind, li.artifact_id, li.title,
         li.thumbnail_url, li.note, li.tags, li.saved_at
    FROM public.studio_library_items li
   WHERE li.tenant_id = _tenant
     AND (p_kind IS NULL OR li.artifact_kind = p_kind)
   ORDER BY li.saved_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
END;
$function$;

-- save_to_library (B2): the caller names the tenant, and "member there AND admin anywhere" let an
-- owner of A write into B where they are only a member. Admin must now be of the target tenant.
CREATE OR REPLACE FUNCTION public.save_to_library(p_kind text, p_artifact_id uuid, p_title text DEFAULT NULL::text, p_thumbnail_url text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := COALESCE(p_tenant_id, public.current_user_tenant_id());
  _title text := NULLIF(btrim(p_title), '');
  _id uuid;
BEGIN
  IF p_kind NOT IN ('page','funnel','form','image','video','copy','document') THEN
    RAISE EXCEPTION 'LIBRARY_BAD_KIND: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_artifact_id IS NULL THEN
    RAISE EXCEPTION 'LIBRARY_NO_ARTIFACT: an artifact id is required' USING ERRCODE = '22023';
  END IF;
  -- STAGE 0: was "NOT public.has_any_role(_caller, ARRAY['admin','super_admin'])" (admin anywhere).
  -- A missing tenant still reaches LIBRARY_NO_TENANT below, as before.
  IF _caller IS NOT NULL AND _tenant IS NOT NULL
     AND NOT (public.is_workspace_admin(_tenant) OR public.is_platform_owner(_caller)) THEN
    RAISE EXCEPTION 'LIBRARY_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'LIBRARY_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
  END IF;
  -- §9/#117: membership is required for a JWT caller; a global 'admin' role no longer
  -- exempts a cross-tenant write (platform owner still may).
  IF _caller IS NOT NULL
     AND NOT public.is_tenant_member(_tenant)
     AND NOT public.is_platform_owner(_caller) THEN
    RAISE EXCEPTION 'LIBRARY_FORBIDDEN: tenant not in your membership' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.studio_library_items (
    tenant_id, created_by, artifact_kind, artifact_id, title, thumbnail_url, note, saved_at
  ) VALUES (
    _tenant, _caller, p_kind, p_artifact_id,
    COALESCE(_title, 'Untitled'),
    NULLIF(btrim(p_thumbnail_url), ''), p_note, now()
  )
  ON CONFLICT (tenant_id, artifact_kind, artifact_id) DO UPDATE SET
    title         = COALESCE(_title, studio_library_items.title),
    thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, studio_library_items.thumbnail_url),
    note          = COALESCE(EXCLUDED.note, studio_library_items.note),
    saved_at      = now()
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'studio_library_items', 'save_to_library', _id,
          jsonb_build_object('tenant_id', _tenant, 'kind', p_kind, 'artifact_id', p_artifact_id));

  RETURN _id;
END;
$function$;

-- create_internal_booking (B2): same shape. The target tenant's admin (is_tenant_admin, unchanged)
-- or the agency managing it; the "member there AND admin anywhere" branch is gone.
CREATE OR REPLACE FUNCTION public.create_internal_booking(_title text, _start_at timestamp with time zone, _end_at timestamp with time zone, _timezone text DEFAULT 'UTC'::text, _contact_id uuid DEFAULT NULL::uuid, _host_user_id uuid DEFAULT NULL::uuid, _guest_name text DEFAULT NULL::text, _guest_email text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _location text DEFAULT NULL::text, _tenant_id uuid DEFAULT NULL::uuid, _calendar_id uuid DEFAULT NULL::uuid, _appointment_type jsonb DEFAULT NULL::jsonb, _intake_answers jsonb DEFAULT NULL::jsonb, _guest_phone text DEFAULT NULL::text, _status text DEFAULT 'scheduled'::text, _source text DEFAULT 'paige'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := COALESCE(_tenant_id, public.current_user_tenant_id());
  _host uuid := COALESCE(_host_user_id, auth.uid());
  _id uuid; _gname text; _gemail text; _found boolean;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN: auth required' USING ERRCODE='42501'; END IF;
  -- STAGE 0: the third branch was "is_tenant_member(_tenant) AND has_any_role(_caller, ARRAY['admin','super_admin'])".
  IF NOT (public.is_platform_owner()
          OR (_tenant IS NOT NULL AND public.is_tenant_admin(_tenant))
          OR (_tenant IS NOT NULL AND public.is_workspace_admin(_tenant))) THEN
    RAISE EXCEPTION 'BOOKING_FORBIDDEN: staff of this tenant required' USING ERRCODE='42501';
  END IF;
  IF _end_at <= _start_at THEN RAISE EXCEPTION 'BOOKING_BAD_TIME: end must be after start' USING ERRCODE='22023'; END IF;
  IF COALESCE(btrim(_title), '') = '' THEN RAISE EXCEPTION 'BOOKING_TITLE_REQUIRED' USING ERRCODE='22023'; END IF;
  IF _calendar_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.calendars c WHERE c.id = _calendar_id AND c.tenant_id IS NOT DISTINCT FROM _tenant
     ) THEN
    RAISE EXCEPTION 'BOOKING_BAD_CALENDAR: calendar not in this tenant' USING ERRCODE='22023';
  END IF;
  IF _host IS NOT NULL AND _host <> _caller THEN
    IF _tenant IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = _tenant AND tm.user_id = _host AND tm.status = 'active'
       ) THEN
      RAISE EXCEPTION 'BOOKING_BAD_HOST: host is not a member of this tenant' USING ERRCODE='22023';
    END IF;
  END IF;

  IF _contact_id IS NOT NULL THEN
    SELECT COALESCE(_guest_name, btrim(concat_ws(' ', cl.first_name, cl.last_name))),
           COALESCE(_guest_email, public.client_primary_address(cl.id, 'email')),
           true
      INTO _gname, _gemail, _found
      FROM public.clients cl WHERE cl.id = _contact_id AND cl.tenant_id IS NOT DISTINCT FROM _tenant;
    IF NOT COALESCE(_found, false) THEN
      RAISE EXCEPTION 'BOOKING_BAD_CONTACT: contact not in this tenant' USING ERRCODE='22023';
    END IF;
  ELSE
    _gname := _guest_name; _gemail := _guest_email;
  END IF;

  INSERT INTO public.internal_bookings (
    tenant_id, calendar_id, host_user_id, contact_id, guest_name, guest_email, guest_phone,
    title, notes, location, start_at, end_at, timezone,
    status, source, booking_kind, appointment_type, intake_answers, reminder_state
  ) VALUES (
    _tenant, _calendar_id, _host, _contact_id, _gname, _gemail, _guest_phone,
    btrim(_title), _notes, _location, _start_at, _end_at, COALESCE(NULLIF(btrim(_timezone), ''), 'UTC'),
    COALESCE(NULLIF(btrim(_status), ''), 'scheduled'), COALESCE(NULLIF(btrim(_source), ''), 'paige'),
    'single', _appointment_type, _intake_answers, '{}'::jsonb
  )
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'internal_booking', 'create_internal_booking', _id,
          jsonb_build_object('tenant_id', _tenant, 'host_user_id', _host, 'contact_id', _contact_id,
                             'calendar_id', _calendar_id, 'start_at', _start_at));
  RETURN _id;
END $function$;

-- remove_from_library / delete_marketing_content: "admin anywhere" passed the role check while the
-- caller sat as a plain member of the current workspace, and "OR global admin" in the DELETE scope
-- reached any tenant's row by id. Admin of the current workspace now; the platform owner keeps its
-- cross-tenant path.
CREATE OR REPLACE FUNCTION public.remove_from_library(p_id uuid DEFAULT NULL::uuid, p_kind text DEFAULT NULL::text, p_artifact_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _deleted int;
BEGIN
  -- STAGE 0: was "NOT public.has_any_role(_caller, ARRAY['admin','super_admin'])".
  IF _caller IS NOT NULL AND NOT (public.is_workspace_admin(_tenant) OR public.is_platform_owner(_caller)) THEN
    RAISE EXCEPTION 'LIBRARY_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;
  -- STAGE 0: the scope was "... OR public.has_role(_caller, 'admin'::app_role)".
  DELETE FROM public.studio_library_items
   WHERE (_caller IS NULL OR tenant_id = _tenant OR public.is_platform_owner(_caller))
     AND (
       (p_id IS NOT NULL AND id = p_id)
       OR (p_id IS NULL AND p_kind IS NOT NULL AND p_artifact_id IS NOT NULL
           AND artifact_kind = p_kind AND artifact_id = p_artifact_id)
     );
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_marketing_content(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _deleted int;
BEGIN
  -- STAGE 0: was "NOT public.has_any_role(_caller, ARRAY['admin','super_admin'])".
  IF _caller IS NOT NULL AND NOT (public.is_workspace_admin(_tenant) OR public.is_platform_owner(_caller)) THEN
    RAISE EXCEPTION 'CONTENT_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;
  -- STAGE 0: the scope was "... OR public.has_role(_caller, 'admin'::app_role)".
  DELETE FROM public.marketing_content
   WHERE id = p_id
     AND (_caller IS NULL OR tenant_id = _tenant OR public.is_platform_owner(_caller));
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted > 0;
END;
$function$;

-- growth_funnel_session_upsert: a JWT caller from another tenant passed on "global admin". Service
-- role only; its one caller (growth_public_visit_record) runs with no JWT, which is unchanged.
-- (Production stores this body with CRLF line ends; it is re-emitted with LF, text otherwise equal.)
CREATE OR REPLACE FUNCTION public.growth_funnel_session_upsert(p_funnel_id uuid, p_session_token text DEFAULT NULL::text, p_step integer DEFAULT 0, p_completed boolean DEFAULT NULL::boolean, p_utm_json jsonb DEFAULT NULL::jsonb, p_referrer text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS growth_funnel_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _funnel public.growth_funnels;
  _tenant uuid;
  _token  text := NULLIF(btrim(p_session_token), '');
  _step   int  := GREATEST(COALESCE(p_step, 0), 0);
  _row    public.growth_funnel_sessions;
BEGIN
  IF p_funnel_id IS NULL THEN
    RAISE EXCEPTION 'GROWTH_FUNNEL_REQUIRED: a funnel id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _funnel FROM public.growth_funnels WHERE id = p_funnel_id;
  IF _funnel.id IS NULL THEN
    RAISE EXCEPTION 'GROWTH_NOT_FOUND: funnel not found' USING ERRCODE = 'P0002';
  END IF;

  -- Tenant is pinned to the FUNNEL's tenant — never a client-supplied id (§9). A JWT caller
  -- must own the funnel (or be admin); an anon visitor may only progress a LIVE funnel; a
  -- service-role caller that names a tenant must match the funnel.
  _tenant := _funnel.tenant_id;
  IF _caller IS NOT NULL THEN
    -- IS DISTINCT FROM (not <>) so a tenantless JWT caller — current_user_tenant_id() = NULL —
    -- is BLOCKED, not silently let through (<> NULL yields NULL, and IF(NULL) never raises).
    -- STAGE 0: the bypass was "AND NOT public.has_role(_caller, 'admin')".
    IF _funnel.tenant_id IS DISTINCT FROM public.current_user_tenant_id()
       AND NOT public.is_platform_owner() THEN
      RAISE EXCEPTION 'GROWTH_FORBIDDEN: funnel belongs to another tenant' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF _funnel.status <> 'active' THEN
      RAISE EXCEPTION 'GROWTH_FUNNEL_INACTIVE: this funnel is not live' USING ERRCODE = '22023';
    END IF;
    IF p_tenant_id IS NOT NULL AND p_tenant_id <> _funnel.tenant_id THEN
      RAISE EXCEPTION 'GROWTH_TENANT_MISMATCH: tenant does not match funnel' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _token IS NULL THEN
    -- Create a fresh session with a server-generated unguessable token.
    INSERT INTO public.growth_funnel_sessions (
      session_token, tenant_id, funnel_id, current_step, completed, utm_json, referrer, user_agent
    ) VALUES (
      'fs_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      _tenant, p_funnel_id, _step, COALESCE(p_completed, false),
      COALESCE(p_utm_json, '{}'::jsonb), p_referrer, p_user_agent
    )
    RETURNING * INTO _row;
  ELSE
    -- Advance an existing session — step is monotonic (GREATEST), tenant/funnel pinned.
    UPDATE public.growth_funnel_sessions SET
      current_step = GREATEST(current_step, _step),
      completed    = COALESCE(p_completed, completed),
      utm_json     = CASE WHEN p_utm_json IS NULL OR p_utm_json = '{}'::jsonb THEN utm_json ELSE p_utm_json END,
      referrer     = COALESCE(referrer, p_referrer),
      user_agent   = COALESCE(user_agent, p_user_agent)
    WHERE session_token = _token AND funnel_id = p_funnel_id AND tenant_id = _tenant
    RETURNING * INTO _row;
    IF _row.id IS NULL THEN
      RAISE EXCEPTION 'GROWTH_NOT_FOUND: funnel session not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN _row;
END;
$function$;

-- Platform-wide operator actions. All six are EXECUTE-granted to service_role only, where auth.uid()
-- is NULL, so the only way into the "admin" branch was a JWT-bearing definer chain. Operator-only.
CREATE OR REPLACE FUNCTION public.suspend_user(_user_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- STAGE 0: was "public.is_platform_owner() OR public.has_role(auth.uid(), 'admin')".
  IF NOT (public.is_platform_owner()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _user_id IS NULL OR _user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot suspend self';
  END IF;

  UPDATE public.profiles
    SET suspended_at = now(),
        suspended_reason = _reason,
        suspended_by = auth.uid(),
        updated_at = now()
    WHERE id = _user_id;

  INSERT INTO public.paige_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'suspend_user', 'user', _user_id, jsonb_build_object('reason', _reason));
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_user(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- STAGE 0: was "public.is_platform_owner() OR public.has_role(auth.uid(), 'admin')".
  IF NOT (public.is_platform_owner()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.profiles
    SET suspended_at = NULL,
        suspended_reason = NULL,
        suspended_by = NULL,
        updated_at = now()
    WHERE id = _user_id;

  INSERT INTO public.paige_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'reactivate_user', 'user', _user_id, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_meta_capi_token(_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- STAGE 0: was "NOT public.has_role(auth.uid(), 'admin'::app_role)" (a platform secret).
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _token IS NULL OR length(btrim(_token)) = 0 THEN
    DELETE FROM public._internal_secrets WHERE key = 'meta_capi_access_token';
  ELSE
    INSERT INTO public._internal_secrets (key, value)
    VALUES ('meta_capi_access_token', _token)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;

  INSERT INTO public.paige_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'admin_set_meta_capi_token', 'paige_config', NULL,
          jsonb_build_object('cleared', _token IS NULL OR length(btrim(coalesce(_token,'')))=0));
END $function$;

CREATE OR REPLACE FUNCTION public.admin_meta_capi_token_is_set()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- STAGE 0: was "NOT public.has_role(auth.uid(), 'admin'::app_role)".
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public._internal_secrets WHERE key = 'meta_capi_access_token' AND length(coalesce(value,'')) > 0);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_set_user_business_limit(_target_user_id uuid, _max_businesses integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_row public.user_business_limits%ROWTYPE;
BEGIN
  -- STAGE 0: was "NOT public.has_role(auth.uid(), 'admin'::public.app_role)" (a platform-wide limit).
  IF NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  IF _max_businesses IS NULL OR _max_businesses < 1 THEN
    RAISE EXCEPTION 'max_businesses must be >= 1';
  END IF;

  INSERT INTO public.user_business_limits (user_id, max_businesses)
  VALUES (_target_user_id, _max_businesses)
  ON CONFLICT (user_id) DO UPDATE
    SET max_businesses = EXCLUDED.max_businesses,
        updated_at = now()
  RETURNING * INTO _new_row;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (
    auth.uid(),
    'user_business_limits',
    'admin_set_max_businesses',
    _target_user_id,
    jsonb_build_object('max_businesses', _max_businesses, 'target_user_id', _target_user_id::text)
  );

  RETURN json_build_object(
    'success', true,
    'user_id', _new_row.user_id,
    'max_businesses', _new_row.max_businesses,
    'additional_businesses_count', _new_row.additional_businesses_count
  );
END;
$function$;

-- rag_recalibrate_quality rewrites the platform knowledge base's scores. No-JWT (service/cron)
-- callers are unchanged.
CREATE OR REPLACE FUNCTION public.rag_recalibrate_quality()
 RETURNS TABLE(flagged_low integer, boosted_high integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _flagged integer := 0;
  _boosted integer := 0;
BEGIN
  -- STAGE 0: was "NOT public.has_role(auth.uid(), 'admin'::public.app_role)".
  IF auth.uid() IS NOT NULL AND NOT public.is_platform_owner() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Boost consistently helpful docs (>=10 retrievals, >=70% helpful).
  WITH boosted AS (
    UPDATE public.rag_documents
       SET quality_score = LEAST(quality_score + 0.05, 1.0),
           updated_at = now()
     WHERE usage_count >= 10
       AND (helpful_count::numeric / NULLIF(usage_count,0)) >= 0.7
     RETURNING 1
  )
  SELECT count(*) INTO _boosted FROM boosted;

  -- Flag low-helpfulness docs (>=10 retrievals, <30% helpful) for admin review.
  WITH flagged AS (
    UPDATE public.rag_documents
       SET metadata = jsonb_set(
                        COALESCE(metadata, '{}'::jsonb),
                        '{flagged_low_helpfulness}',
                        'true'::jsonb,
                        true
                      ),
           updated_at = now()
     WHERE usage_count >= 10
       AND (helpful_count::numeric / NULLIF(usage_count,0)) < 0.3
       AND COALESCE(metadata->>'flagged_low_helpfulness','false') <> 'true'
     RETURNING 1
  )
  SELECT count(*) INTO _flagged FROM flagged;

  RETURN QUERY SELECT _flagged, _boosted;
END;
$function$;

-- match_rag_documents: "staff" (sees every client's financial documents) was "global admin". It is
-- the platform owner now. (The design proposed is_platform_operator; that would newly admit
-- platform_admin, so the narrower rule is used. Service-role callers are unchanged.)
CREATE OR REPLACE FUNCTION public.match_rag_documents(
  _query_embedding extensions.vector,
  _match_threshold numeric DEFAULT 0.75,
  _match_count integer DEFAULT 3,
  _document_types text[] DEFAULT NULL::text[],
  _metadata_filter jsonb DEFAULT NULL::jsonb,
  _query_text text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, document_type text, title text, summary text, content text, metadata jsonb, similarity double precision, quality_score numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _ids uuid[];
  _is_staff boolean := false;
  _caller uuid := auth.uid();
  _financial_types text[] := ARRAY[
    'business_credit_snapshot','owner_credit_snapshot','banking_snapshot',
    'cash_flow_snapshot','client_financial_brief'
  ];
BEGIN
  IF _caller IS NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _caller IS NOT NULL THEN
    -- STAGE 0: was "public.has_role(_caller, 'admin'::public.app_role)".
    _is_staff := public.is_platform_owner();
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      d.id, d.document_type, d.title, d.summary, d.content, d.metadata,
      1 - (d.embedding <=> _query_embedding) AS similarity,
      d.quality_score
    FROM public.rag_documents d
    WHERE d.is_published = true
      AND d.embedding IS NOT NULL
      AND (_document_types IS NULL OR d.document_type = ANY (_document_types))
      AND (_metadata_filter IS NULL OR d.metadata @> _metadata_filter)
      AND 1 - (d.embedding <=> _query_embedding) >= _match_threshold
      AND (
        NOT (d.document_type = ANY (_financial_types))
        OR auth.role() = 'service_role'
        OR _is_staff
        OR (d.client_id IS NOT NULL AND d.client_id = _caller)
      )
    ORDER BY d.embedding <=> _query_embedding
    LIMIT GREATEST(_match_count, 1)
  )
  SELECT * FROM ranked;

  -- THE FIX: the subquery below is aliased `d`; this aggregated `r.id`, which is nothing.
  SELECT COALESCE(array_agg(d.id), ARRAY[]::uuid[]) INTO _ids
  FROM (
    SELECT d.id
    FROM public.rag_documents d
    WHERE d.is_published = true
      AND d.embedding IS NOT NULL
      AND (_document_types IS NULL OR d.document_type = ANY (_document_types))
      AND (_metadata_filter IS NULL OR d.metadata @> _metadata_filter)
      AND 1 - (d.embedding <=> _query_embedding) >= _match_threshold
      AND (
        NOT (d.document_type = ANY (_financial_types))
        OR auth.role() = 'service_role'
        OR _is_staff
        OR (d.client_id IS NOT NULL AND d.client_id = _caller)
      )
    ORDER BY d.embedding <=> _query_embedding
    LIMIT GREATEST(_match_count, 1)
  ) d;

  IF array_length(_ids, 1) IS NOT NULL THEN
    UPDATE public.rag_documents
       SET usage_count = usage_count + 1,
           updated_at = now()
     WHERE id = ANY (_ids);
  END IF;

  BEGIN
    INSERT INTO public.rag_retrieval_log (
      user_id, query_embedding, query_text, retrieved_document_ids
    ) VALUES (
      _caller, _query_embedding, _query_text, COALESCE(_ids, ARRAY[]::uuid[])
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;

-- _assert_billing_admin: deliberately NOT changed. On production it raises 22P02 for every
-- authenticated caller before any role is consulted, because its third check casts 'owner' to
-- app_role and app_role has no 'owner' value (verified 2026-10-26: SELECT 'owner'::app_role fails).
-- So the five admin_*_customer_subscription functions behind ContactBillingPanel cannot run for
-- anyone and there is no live cross-workspace hole. Rewriting the check would REVIVE those billing
-- writes, a product decision (OPEN, owner). The proof asserts it still refuses.

-- grant_tenant_member_role (S3): a tenant admin could mint a GLOBAL 'admin' row for ANY user. The
-- seat write is consent-gated (enforce_tenant_member_consent turns a new foreign seat into
-- 'pending'), but the user_roles insert was not, so the target held global admin immediately with no
-- active seat anywhere, and passed every unscoped reader (the requireAdmin edge helpers among them).
-- The 'admin' user_roles insert is skipped; the seat write is unchanged. When that seat later becomes
-- active, trg_sync_tenant_member_to_user_roles still writes the global row exactly as for every other
-- admin seat (stage 3 retires that). Skipping it also stops the reverse trigger
-- (sync_user_role_to_tenant_member) from upserting a second seat in the CALLER's current workspace
-- when that differs from _tenant_id.
-- The same reasoning reaches EVERY role: user_roles has no tenant, so a grant of sales_rep, finance,
-- viewer... by an admin of A became a platform-wide role for a person who may hold no seat in A at all
-- (the stage-0 verifier's repros). Outside the platform-operator paths (the platform owner; an operator
-- in the company workspace) the user_roles row is written only when the target ALREADY holds an active
-- seat in this workspace — a real teammate. Anyone else gets the pending seat alone (the consent
-- trigger), and the row follows when they accept, through the seat sync for the seat's own role.
CREATE OR REPLACE FUNCTION public.grant_tenant_member_role(_user_id uuid, _role app_role, _tenant_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    _caller uuid := auth.uid();
    _resolved_tenant uuid;
    _tenant_role public.tenant_role;
    _protected public.app_role[] := ARRAY['super_admin','platform_admin','developer']::public.app_role[];
    _global_ok boolean;
  BEGIN
    IF _caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
    -- "Coach" is a title a business gives its people, never a role anyone is granted.
    IF _role = 'coach'::public.app_role THEN
      RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: coach is a title, never a role' USING ERRCODE = '42501';
    END IF;
    _resolved_tenant := COALESCE(_tenant_id, public.current_user_tenant_id());
    IF _resolved_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant context'; END IF;
    IF NOT (public.is_platform_owner() OR public.is_tenant_admin(_resolved_tenant)) THEN
      RAISE EXCEPTION 'Tenant admin privileges required';
    END IF;
    IF NOT public.is_platform_owner() AND _role = ANY(_protected) THEN
      RAISE EXCEPTION 'Cannot grant a platform-operator role here (owner-only)'
        USING ERRCODE = '42501';
    END IF;

    _tenant_role := public.map_app_role_to_tenant_role(_role);

    -- STAGE 0: 'admin' is a seat, never a global row minted here. Any other role becomes a global
    -- row only for a person already active in this workspace, or on a platform-operator path. Read
    -- BEFORE the seat write below, which would otherwise make the target look active.
    _global_ok := public.is_platform_owner()
      OR (public.is_company_workspace(_resolved_tenant) AND public.is_platform_operator())
      OR EXISTS (SELECT 1 FROM public.tenant_members m
                  WHERE m.tenant_id = _resolved_tenant AND m.user_id = _user_id AND m.status = 'active');
    IF _role <> 'admin'::public.app_role AND _global_ok THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role)
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;

    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, invited_at, joined_at)
    VALUES (_resolved_tenant, _user_id, _tenant_role, 'active', now(), now())
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET role = CASE
            WHEN public.tenant_members.role = 'owner'::public.tenant_role THEN public.tenant_members.role
            WHEN EXCLUDED.role = 'admin'::public.tenant_role THEN 'admin'::public.tenant_role
            ELSE public.tenant_members.role
          END,
          status = 'active',
          joined_at = COALESCE(public.tenant_members.joined_at, now()),
          updated_at = now();

    INSERT INTO public.profiles (user_id) VALUES (_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.profiles SET active_tenant_id = _resolved_tenant
     WHERE user_id = _user_id AND (active_tenant_id IS NULL OR public.is_platform_owner());

    INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
    VALUES (_caller, 'tenant_member', 'grant_tenant_member_role', _user_id,
            jsonb_build_object('tenant_id', _resolved_tenant, 'role', _role, 'reason', _reason));

    INSERT INTO public.paige_audit_log
      (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
    VALUES (_caller, 'admin', 'role:grant', 'user_role', _user_id,
            jsonb_build_object('to_role', _role, 'tenant_id', _resolved_tenant, 'reason', _reason),
            _resolved_tenant);
  END;
  $function$;

-- record_rail_event (the B2 pattern, found by the stage-0 security verifier): with
-- p_actor_type='client' the business is taken from the caller's PORTAL relationship
-- (client_portal_relationship_id), not their current workspace, and the check was then
-- has_any_role(admin, super_admin). So the owner of A who is a portal client of B filed owner-only,
-- any-visibility, agent-attributed events into B's rail and its broadcast channels, past the
-- "client-visible only" rule. Stage 1 would not reach it: X's current workspace is A, where X really
-- is admin. On that portal path the admin answer is now about the business the event is filed into.
CREATE OR REPLACE FUNCTION public.record_rail_event(p_contact_id uuid, p_event_kind text, p_surface text, p_actor_type text, p_title text, p_summary text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_ref_table text DEFAULT NULL::text, p_ref_id uuid DEFAULT NULL::uuid, p_from_department text DEFAULT NULL::text, p_to_department text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_narrow_to_owner boolean DEFAULT false, p_tenant_id uuid DEFAULT NULL::uuid, p_actor_agent_slug text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_tenant      uuid;
  v_kind        public.paige_event_kinds%ROWTYPE;
  v_audience    text;
  v_visibility  text;
  v_actor       uuid;
  v_id          uuid;
  v_occurred    timestamptz;
  v_from_dept   text;
  v_agent_label text;
  v_portal      boolean := false;
BEGIN
  IF v_uid IS NOT NULL THEN
    v_tenant := NULL;
    IF p_actor_type = 'client' THEN
      SELECT c.tenant_id INTO v_tenant FROM public.clients c
       WHERE c.id = p_contact_id AND c.id = public.client_portal_relationship_id(p_tenant_id)
         AND c.linked_user_id = v_uid;
      -- STAGE 0: the business came from the caller's own portal relationship, not their workspace.
      v_portal := v_tenant IS NOT NULL;
    END IF;
    -- Incumbent staff-side booking producers also use actor_type=client.
    -- Preserve their original staff resolution and downstream role checks.
    IF v_tenant IS NULL THEN
      v_tenant := public.current_user_tenant_id();
    END IF;
    IF p_tenant_id IS NOT NULL AND v_tenant IS NOT NULL AND p_tenant_id <> v_tenant THEN
      RAISE EXCEPTION 'tenant mismatch' USING errcode = '42501';
    END IF;
  ELSE
    IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'p_tenant_id required for service caller'; END IF;
    v_tenant := p_tenant_id;
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no tenant resolved' USING errcode = '42501'; END IF;

  SELECT * INTO v_kind FROM public.paige_event_kinds
    WHERE slug = p_event_kind AND enabled AND (tenant_id IS NULL OR tenant_id = v_tenant)
    ORDER BY (tenant_id IS NOT NULL) DESC
    LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown or unavailable event kind: %', p_event_kind; END IF;

  PERFORM 1 FROM public.clients c WHERE c.id = p_contact_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact not in tenant' USING errcode = '42501'; END IF;

  IF v_uid IS NOT NULL THEN
    -- STAGE 0: was has_any_role(admin, super_admin) on both paths. Filed through a portal
    -- relationship, the business is the one the caller is a CLIENT of, so a global admin row (an
    -- owner/admin seat in ANY workspace) must not make them its admin: that business's own
    -- owner/admin, its managing agency, or the platform owner. The staff path (the caller's current
    -- workspace) keeps has_any_role until stage 1 re-answers it for that workspace.
    IF (v_portal AND (public.is_platform_owner() OR public.is_workspace_admin(v_tenant)))
       OR (NOT v_portal AND public.has_any_role(v_uid, ARRAY['admin','super_admin'])) THEN
      NULL;
    ELSIF p_actor_type = 'client'
          AND EXISTS (SELECT 1 FROM public.clients c
                       WHERE c.id = p_contact_id AND c.linked_user_id = v_uid) THEN
      IF p_narrow_to_owner OR v_kind.default_visibility <> 'client_visible' THEN
        RAISE EXCEPTION 'client may only file client-visible events' USING errcode = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'not authorized to write rail event' USING errcode = '42501';
    END IF;
  END IF;

  -- §9 AGENT SCOPE. The FK proves the slug exists on the fleet; it says nothing about whose
  -- agent it is, because slug is globally unique and tenant_id is nullable. This predicate is
  -- keyed on v_tenant — server-resolved above, never a caller parameter. ONE error covers
  -- foreign and unknown alike so the response cannot be used to enumerate another workspace's
  -- agents, matching the identical-404 rule paige-orchestrator already follows.
  --
  -- v_agent_label may legitimately be NULL when the agent exists but has no tenant-safe name
  -- (an internal crew seat). That records the slug for operator audit while showing a business
  -- owner nothing written for us (§11).
  IF p_actor_agent_slug IS NOT NULL THEN
    SELECT s.rail_display_name INTO v_agent_label
      FROM public.paige_subagents s
     WHERE s.slug = p_actor_agent_slug
       AND (s.tenant_id IS NULL OR s.tenant_id = v_tenant);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RAIL_AGENT_FORBIDDEN' USING errcode = '42501';
    END IF;
  END IF;

  v_audience   := CASE WHEN p_narrow_to_owner THEN 'owner' ELSE v_kind.default_audience END;
  v_visibility := CASE WHEN v_audience = 'owner' THEN 'owner_internal' ELSE v_kind.default_visibility END;
  v_actor      := CASE WHEN p_actor_type IN ('owner_staff','client') THEN v_uid ELSE NULL END;
  v_from_dept  := COALESCE(p_from_department, v_kind.department);

  INSERT INTO public.paige_client_events (
    tenant_id, contact_id, event_kind, surface, actor_type, actor_user_id,
    audience, visibility, from_department, to_department,
    title, summary, payload, ref_table, ref_id, occurred_at,
    actor_agent_slug, actor_agent_label
  ) VALUES (
    v_tenant, p_contact_id, p_event_kind, p_surface, p_actor_type, v_actor,
    v_audience, v_visibility,
    v_from_dept, p_to_department,
    p_title, p_summary, COALESCE(p_payload, '{}'::jsonb), p_ref_table, p_ref_id,
    COALESCE(p_occurred_at, now()),
    p_actor_agent_slug, v_agent_label
  ) RETURNING id, occurred_at INTO v_id, v_occurred;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, data)
  VALUES (v_uid, 'paige_rail_event', 'paige_client_events', v_id,
          jsonb_build_object('kind', p_event_kind, 'surface', p_surface,
                             'contact_id', p_contact_id, 'audience', v_audience,
                             'actor_agent_slug', p_actor_agent_slug));

  BEGIN
    PERFORM realtime.send(
      jsonb_build_object(
        'id', v_id, 'tenant_id', v_tenant, 'contact_id', p_contact_id,
        'event_kind', p_event_kind, 'surface', p_surface, 'actor_type', p_actor_type,
        'audience', v_audience, 'visibility', v_visibility,
        'from_department', v_from_dept, 'to_department', p_to_department,
        'title', p_title, 'summary', p_summary, 'payload', COALESCE(p_payload, '{}'::jsonb),
        'occurred_at', v_occurred
      ) || CASE WHEN p_actor_agent_slug IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('actor_agent', v_agent_label) END,
      'rail_event', 'rail:tenant:' || v_tenant::text, true
    );

    IF v_audience IN ('client','both') AND v_visibility = 'client_visible' THEN
      -- The CLIENT feed deliberately carries no agent attribution. Which of the coach's
      -- specialists did the work is the coach's business, not the client's (§9).
      PERFORM realtime.send(
        jsonb_build_object(
          'id', v_id, 'contact_id', p_contact_id, 'event_kind', p_event_kind,
          'surface', p_surface, 'actor_type', p_actor_type, 'audience', v_audience,
          'visibility', v_visibility, 'title', p_title, 'summary', p_summary,
          'occurred_at', v_occurred
        ),
        'rail_event', 'rail:client:' || p_contact_id::text, true
      );
    END IF;

    -- God firehose. EVERY event is surfaced to the platform owner's cross-tenant stream (§9 God
    -- reads everything). Compact envelope only — NO full payload; the platform stream is a
    -- cross-tenant index, and omitting the payload limits blast radius. Subscribable ONLY by God
    -- (see can_access_rail_topic).
    PERFORM realtime.send(
      jsonb_build_object(
        'id', v_id, 'tenant_id', v_tenant, 'contact_id', p_contact_id,
        'event_kind', p_event_kind, 'surface', p_surface, 'actor_type', p_actor_type,
        'audience', v_audience, 'visibility', v_visibility,
        'title', p_title, 'occurred_at', v_occurred
      ) || CASE WHEN p_actor_agent_slug IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('actor_agent', v_agent_label) END,
      'rail_event', 'rail:platform', true
    );
  EXCEPTION WHEN others THEN
    RAISE WARNING 'rail broadcast failed for event %: %', v_id, SQLERRM;
  END;

  RETURN v_id;
END $function$
;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- 2. POLICIES (M1 + S1 + S7)
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- paige_skills: the platform skills catalogue (no tenant column, 118 rows). Its only policy let any
-- global admin rewrite it. Writes are operator-only. The Solo Skills page
-- (src/solo/data/useSoloSkills.ts:150, status='active', as the signed-in owner/admin) keeps its read
-- through a SELECT policy for the admin of the CURRENT workspace.
DROP POLICY IF EXISTS "Admins manage skills" ON public.paige_skills;
CREATE POLICY "Admins manage skills" ON public.paige_skills
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_platform_owner())
  WITH CHECK (is_platform_owner());
DROP POLICY IF EXISTS "Workspace admins read active skills" ON public.paige_skills;
CREATE POLICY "Workspace admins read active skills" ON public.paige_skills
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((status = 'active'::text) AND (SELECT is_workspace_admin(current_user_tenant_id())));

DROP POLICY IF EXISTS "Admins manage skill proposals" ON public.paige_skill_proposals;
CREATE POLICY "Admins manage skill proposals" ON public.paige_skill_proposals
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_platform_owner())
  WITH CHECK (is_platform_owner());

-- paige_assignment_policy: 6 platform rows, no tenant. Write: operator-only. Read: was is_staff
-- ('admin','super_admin','sales_rep','cs_rep','finance'). The only reader in source is paige-bridge
-- (service role). 'admin' leaves the read; the other global staff roles stay until their own
-- decision (O-3); 'super_admin' is is_platform_owner().
DROP POLICY IF EXISTS "assignment_policy_admin_write" ON public.paige_assignment_policy;
CREATE POLICY "assignment_policy_admin_write" ON public.paige_assignment_policy
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_platform_owner())
  WITH CHECK (is_platform_owner());
DROP POLICY IF EXISTS "assignment_policy_staff_read" ON public.paige_assignment_policy;
CREATE POLICY "assignment_policy_staff_read" ON public.paige_assignment_policy
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_platform_owner() OR has_any_role(auth.uid(), ARRAY['sales_rep'::text, 'cs_rep'::text, 'finance'::text]));

-- tenant_entity_relationships: "OR global admin" opened every tenant's rows. Members of the row's own
-- current workspace keep write, as today (O-7).
DROP POLICY IF EXISTS "ter tenant admin manage" ON public.tenant_entity_relationships;
CREATE POLICY "ter tenant admin manage" ON public.tenant_entity_relationships
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((tenant_id = current_user_tenant_id()) OR is_platform_owner())
  WITH CHECK ((tenant_id = current_user_tenant_id()) OR is_platform_owner());

-- business_certifications: bound to the business's own workspace. FundingProfileSection.tsx inserts
-- as the record's user (own-insert policy, unchanged) and updates through this policy.
DROP POLICY IF EXISTS "Admins can manage certifications" ON public.business_certifications;
CREATE POLICY "Admins can manage certifications" ON public.business_certifications
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_platform_owner() OR (EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = business_certifications.business_id) AND is_workspace_admin(b.tenant_id)))))
  WITH CHECK (is_platform_owner() OR (EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = business_certifications.business_id) AND is_workspace_admin(b.tenant_id)))));
DROP POLICY IF EXISTS "Owners can view their certifications" ON public.business_certifications;
CREATE POLICY "Owners can view their certifications" ON public.business_certifications
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = user_id) OR is_platform_owner() OR (EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = business_certifications.business_id) AND is_workspace_admin(b.tenant_id)))));
-- The record's own person could insert a certification but never change it: updates went only through
-- "Admins can manage certifications", which an owner of ANY workspace used to pass. With that bound to
-- the business's own workspace, FundingProfileSection's status change needs its own update rule — the
-- same person the insert policy already admits, and the row stays theirs.
DROP POLICY IF EXISTS "Owners can update their certifications" ON public.business_certifications;
CREATE POLICY "Owners can update their certifications" ON public.business_certifications
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

-- business_verification_runs / business_verifications: through business_id or contact_id.
DROP POLICY IF EXISTS "Admins view all verification runs" ON public.business_verification_runs;
CREATE POLICY "Admins view all verification runs" ON public.business_verification_runs
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_platform_owner()
    OR ((business_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = business_verification_runs.business_id) AND is_workspace_admin(b.tenant_id)))))
    OR ((contact_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = business_verification_runs.contact_id) AND is_workspace_admin(c.tenant_id))))));
DROP POLICY IF EXISTS "View verifications via run access" ON public.business_verifications;
CREATE POLICY "View verifications via run access" ON public.business_verifications
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM business_verification_runs r
  WHERE ((r.id = business_verifications.run_id) AND (is_platform_owner()
    OR ((r.business_id IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM businesses b0
          WHERE ((b0.id = r.business_id) AND is_workspace_admin(b0.tenant_id)))))
    OR ((r.contact_id IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM clients c0
          WHERE ((c0.id = r.contact_id) AND is_workspace_admin(c0.tenant_id)))))
    OR ((r.contact_id IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM clients c
          WHERE ((c.id = r.contact_id) AND (c.assigned_coach_user_id = auth.uid()) AND is_tenant_member(c.tenant_id))))) OR ((r.business_id IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM businesses b
          WHERE ((b.id = r.business_id) AND (b.owner_user_id = auth.uid()))))))))));

-- chat_message_embeddings: user-keyed, no tenant. Self (unchanged) or the platform owner.
DROP POLICY IF EXISTS "Service role can delete chat embeddings" ON public.chat_message_embeddings;
CREATE POLICY "Service role can delete chat embeddings" ON public.chat_message_embeddings
  AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id) OR is_platform_owner());
DROP POLICY IF EXISTS "Users can insert their own chat embeddings" ON public.chat_message_embeddings;
CREATE POLICY "Users can insert their own chat embeddings" ON public.chat_message_embeddings
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id) OR is_platform_owner());
DROP POLICY IF EXISTS "Users can read their own chat embeddings" ON public.chat_message_embeddings;
CREATE POLICY "Users can read their own chat embeddings" ON public.chat_message_embeddings
  AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id) OR (auth.uid() = client_user_id) OR is_platform_owner());

-- client_goals: user-keyed, no tenant. The admin of a workspace where that user is a client, or the
-- platform owner. S6 (OPEN): a person who is a client of two businesses is visible to both admins.
DROP POLICY IF EXISTS "Admins update all goals" ON public.client_goals;
CREATE POLICY "Admins update all goals" ON public.client_goals
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_platform_owner() OR (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.linked_user_id = client_goals.user_id) AND is_workspace_admin(c.tenant_id)))));
DROP POLICY IF EXISTS "Admins view all goals" ON public.client_goals;
CREATE POLICY "Admins view all goals" ON public.client_goals
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_platform_owner() OR (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.linked_user_id = client_goals.user_id) AND is_workspace_admin(c.tenant_id)))));

-- lender_research_results: user_id is whoever ran it (lender-research), client_user_id the client;
-- OutreachCenter.tsx reads by either. Bound to a workspace where that person is a client, plus the
-- admin's own runs while they are admin of their current workspace. Same S6 caveat.
DROP POLICY IF EXISTS "Admins can manage all research results" ON public.lender_research_results;
CREATE POLICY "Admins can manage all research results" ON public.lender_research_results
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_platform_owner()
    OR ((user_id = auth.uid()) AND (SELECT is_workspace_admin(current_user_tenant_id())))
    OR (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.linked_user_id = lender_research_results.client_user_id OR c.linked_user_id = lender_research_results.user_id)
         AND is_workspace_admin(c.tenant_id)))));

-- rag_documents: a published per-client document (client_id -> profiles.user_id) was readable by any
-- admin. Now the admin of a workspace where that user is a client. Same S6 caveat.
DROP POLICY IF EXISTS "Authenticated read published RAG docs" ON public.rag_documents;
CREATE POLICY "Authenticated read published RAG docs" ON public.rag_documents
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_published = true) AND ((client_id IS NULL) OR (client_id = auth.uid()) OR is_platform_owner()
    OR (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.linked_user_id = rag_documents.client_id) AND is_workspace_admin(c.tenant_id))))));

-- legal_acceptances: another person's legal acceptances; self or the platform owner.
DROP POLICY IF EXISTS "legal_acceptances self read" ON public.legal_acceptances;
CREATE POLICY "legal_acceptances self read" ON public.legal_acceptances
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR has_role(auth.uid(), 'super_admin'::app_role));

-- paige_sla_alert_log: written and read by sla-watcher (service role); no browser reader.
DROP POLICY IF EXISTS "sla_log_admins_read" ON public.paige_sla_alert_log;
CREATE POLICY "sla_log_admins_read" ON public.paige_sla_alert_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_platform_owner());

-- extraction_quality_log: written by service-role backfills; reads already operator/self.
DROP POLICY IF EXISTS "Admins can insert quality logs" ON public.extraction_quality_log;
CREATE POLICY "Admins can insert quality logs" ON public.extraction_quality_log
  AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (is_platform_owner());

-- storage paige-generated: the staff policies covered the whole bucket with no path check. The first
-- folder of every path is a tenant id (8/8 objects, 2026-10-26); bind to that workspace's admin.
-- S7: the uuid cast sits behind a regex inside CASE, so a non-uuid folder yields false, not an error.
DROP POLICY IF EXISTS "paige_generated_staff_write" ON storage.objects;
CREATE POLICY "paige_generated_staff_write" ON storage.objects
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'paige-generated'::text) AND (is_platform_owner() OR
    CASE WHEN ((storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
         THEN is_workspace_admin(((storage.foldername(name))[1])::uuid)
         ELSE false END));
DROP POLICY IF EXISTS "paige_generated_staff_update" ON storage.objects;
CREATE POLICY "paige_generated_staff_update" ON storage.objects
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'paige-generated'::text) AND (is_platform_owner() OR
    CASE WHEN ((storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
         THEN is_workspace_admin(((storage.foldername(name))[1])::uuid)
         ELSE false END));

-- tasks: the restrictive tenant_isolation policy pins rows to the current workspace, but the
-- permissive admin policy answered "admin anywhere", and rows with no tenant stayed open (2 today).
DROP POLICY IF EXISTS "Admins manage all tasks" ON public.tasks;
CREATE POLICY "Admins manage all tasks" ON public.tasks
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_platform_owner() OR ((tenant_id IS NOT NULL) AND is_workspace_admin(tenant_id)))
  WITH CHECK (is_platform_owner() OR ((tenant_id IS NOT NULL) AND is_workspace_admin(tenant_id)));

-- paige_pending_approvals (S1): the same, plus "visible_to_roles && current_user_roles()", where the
-- column defaults to {admin,super_admin} and current_user_roles() carries the global 'admin'. 'admin'
-- visibility now comes only from the row's own workspace; every other role in the array is matched
-- as before. current_user_roles() itself is not changed (stage 1).
DROP POLICY IF EXISTS "Approvals read scoped" ON public.paige_pending_approvals;
CREATE POLICY "Approvals read scoped" ON public.paige_pending_approvals
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_platform_owner() OR ((tenant_id IS NOT NULL) AND is_workspace_admin(tenant_id))
    OR (assigned_to_user_id = auth.uid())
    OR (visible_to_roles && array_remove(current_user_roles(), 'admin'::text)));
DROP POLICY IF EXISTS "Approvals write scoped" ON public.paige_pending_approvals;
CREATE POLICY "Approvals write scoped" ON public.paige_pending_approvals
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_platform_owner() OR ((tenant_id IS NOT NULL) AND is_workspace_admin(tenant_id))
    OR (assigned_to_user_id = auth.uid()))
  WITH CHECK (is_platform_owner() OR ((tenant_id IS NOT NULL) AND is_workspace_admin(tenant_id))
    OR (assigned_to_user_id = auth.uid()));

-- paige_coach_assignments: is_staff() without its 'admin' member; 'admin' comes from the row's own
-- workspace. The other global staff roles are unchanged (O-3).
DROP POLICY IF EXISTS "assignments_staff_read" ON public.paige_coach_assignments;
CREATE POLICY "assignments_staff_read" ON public.paige_coach_assignments
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_platform_owner() OR ((tenant_id IS NOT NULL) AND is_workspace_admin(tenant_id))
    OR has_any_role(auth.uid(), ARRAY['sales_rep'::text, 'cs_rep'::text, 'finance'::text]));

-- paige_approval_comments: through the approval's own workspace.
DROP POLICY IF EXISTS "approval_comments_insert" ON public.paige_approval_comments;
CREATE POLICY "approval_comments_insert" ON public.paige_approval_comments
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM paige_pending_approvals a
  WHERE ((a.id = paige_approval_comments.approval_id) AND ((a.assigned_to_user_id = auth.uid()) OR (a.submitted_by_user_id = auth.uid())
    OR is_platform_owner() OR ((a.tenant_id IS NOT NULL) AND is_workspace_admin(a.tenant_id)))))));
DROP POLICY IF EXISTS "approval_comments_read" ON public.paige_approval_comments;
CREATE POLICY "approval_comments_read" ON public.paige_approval_comments
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS ( SELECT 1
   FROM paige_pending_approvals a
  WHERE ((a.id = paige_approval_comments.approval_id) AND ((a.assigned_to_user_id = auth.uid()) OR (a.submitted_by_user_id = auth.uid())
    OR is_platform_owner() OR ((a.tenant_id IS NOT NULL) AND is_workspace_admin(a.tenant_id))))));

COMMIT;
