-- INERT original EXP08 I2 §5.5 candidate. No managed version/publication/apply.
-- Extends two ORIGINAL readers, not their authority, writers or grants.
BEGIN;
SET LOCAL lock_timeout='2s';
-- Literal original Team native source; no provider or business-data operation.
DO $exp08_literal_guard$
DECLARE p pg_catalog.pg_proc; before_state boolean:=true; after_state boolean:=true;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 native installer requires postgres'; END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._solo_shell_tenant(uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>'9ade6efeff0689b78ff57b116a28c9d4' OR p.proowner::regrole::text IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql')
   OR p.prokind<>'f' OR p.provolatile<>'s'
   OR p.proisstrict IS DISTINCT FROM false OR p.proleakproof IS DISTINCT FROM false
   OR p.proparallel<>'u' OR p.proretset IS DISTINCT FROM false
   OR p.pronargdefaults<>0 OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_tenant uuid'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'boolean' THEN
  RAISE EXCEPTION 'EXP08 owner read original helper drift: public._solo_shell_tenant(uuid)'; END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public._tenant_account_holder_state(uuid)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc)<>'8f9d27463a4c825994f165a5777aca1f' OR p.proowner::regrole::text IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql')
   OR p.prokind<>'f' OR p.provolatile<>'s'
   OR p.proisstrict IS DISTINCT FROM false OR p.proleakproof IS DISTINCT FROM false
   OR p.proparallel<>'u' OR p.proretset IS DISTINCT FROM false
   OR p.pronargdefaults<>0 OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_tenant uuid'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'text' THEN
  RAISE EXCEPTION 'EXP08 owner read original helper drift: public._tenant_account_holder_state(uuid)'; END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.get_paige_team_context()');
 IF NOT FOUND THEN
  after_state:=false; before_state:=false;
 ELSE
  IF p.proowner::regrole::text IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR p.prokind<>'f' OR p.provolatile<>'v'
   OR p.proisstrict IS DISTINCT FROM false OR p.proleakproof IS DISTINCT FROM false
   OR p.proparallel<>'u' OR p.proretset IS DISTINCT FROM false
   OR p.pronargdefaults<>0 OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM ''
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'jsonb' THEN RAISE EXCEPTION 'EXP08 owner read original reader metadata drift: public.get_paige_team_context()'; END IF;
  IF pg_catalog.md5(p.prosrc)<>'34069ec817a98b7bf1bca933f7cf4d18' THEN after_state:=false; END IF;
  IF pg_catalog.md5(p.prosrc)<>'623d712d745867ed8f7d29374e3a6078' THEN before_state:=false; END IF;
  IF pg_catalog.md5(p.prosrc) NOT IN ('34069ec817a98b7bf1bca933f7cf4d18','623d712d745867ed8f7d29374e3a6078') THEN RAISE EXCEPTION 'EXP08 owner read original source drift: public.get_paige_team_context()'; END IF;
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.get_solo_team_workspace(text,text,integer,integer)');
 IF NOT FOUND THEN
  after_state:=false; before_state:=false;
 ELSE
  IF p.proowner::regrole::text IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR p.prokind<>'f' OR p.provolatile<>'v'
   OR p.proisstrict IS DISTINCT FROM false OR p.proleakproof IS DISTINCT FROM false
   OR p.proparallel<>'u' OR p.proretset IS DISTINCT FROM false
   OR p.pronargdefaults<>4 OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_search text DEFAULT NULL::text, _permission text DEFAULT ''all''::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'jsonb' THEN RAISE EXCEPTION 'EXP08 owner read original reader metadata drift: public.get_solo_team_workspace(text,text,integer,integer)'; END IF;
  IF pg_catalog.md5(p.prosrc)<>'7a94f014248160c3b0fc119ec71f8481' THEN after_state:=false; END IF;
  IF pg_catalog.md5(p.prosrc)<>'ded4ae3cb9d57f2c1ed0cef52493590b' THEN before_state:=false; END IF;
  IF pg_catalog.md5(p.prosrc) NOT IN ('7a94f014248160c3b0fc119ec71f8481','ded4ae3cb9d57f2c1ed0cef52493590b') THEN RAISE EXCEPTION 'EXP08 owner read original source drift: public.get_solo_team_workspace(text,text,integer,integer)'; END IF;
 END IF;
 IF NOT before_state AND NOT after_state THEN RAISE EXCEPTION 'EXP08 Team details partial installation'; END IF;
END $exp08_literal_guard$;
CREATE OR REPLACE FUNCTION public.get_paige_team_context()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _result jsonb;
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _viewer_role public.tenant_role;
  _viewer_is_owner boolean := false;
  _can_manage_invitations boolean := false;
  _speaker jsonb;
  _member_count integer := 0;
  _members jsonb := '[]'::jsonb;
  _invitation_count integer := 0;
  _invitations jsonb := '[]'::jsonb;
BEGIN
  IF _actor IS NULL OR _tenant IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT tm.role, (tm.is_owner OR tm.role = 'owner'::public.tenant_role)
    INTO _viewer_role, _viewer_is_owner
  FROM public.tenant_members tm
  WHERE tm.tenant_id = _tenant
    AND tm.user_id = _actor
    AND tm.status = 'active'
  LIMIT 1;

  IF _viewer_role IS NULL THEN
    RETURN NULL;
  END IF;
  _can_manage_invitations := _viewer_is_owner OR _viewer_role = 'admin'::public.tenant_role;

  SELECT jsonb_build_object(
    'user_id', tm.user_id,
    'name', p.full_name,
    'email', au.email,
    'permission', CASE WHEN tm.is_owner OR tm.role = 'owner'::public.tenant_role THEN 'owner' ELSE tm.role::text END,
    'job_title', tm.job_title,
    'responsibilities', tm.responsibilities
  ) INTO _speaker
  FROM public.tenant_members tm
  LEFT JOIN public.profiles p ON p.user_id = tm.user_id
  LEFT JOIN auth.users au ON au.id = tm.user_id
  WHERE tm.tenant_id = _tenant AND tm.user_id = _actor AND tm.status = 'active';

  SELECT count(*) INTO _member_count
  FROM public.tenant_members tm
  WHERE tm.tenant_id = _tenant AND tm.status = 'active';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', rows.user_id,
    'name', rows.full_name,
    'permission', rows.permission,
    'job_title', rows.job_title,
    'email', rows.email,
    'responsibilities', rows.responsibilities
  ) ORDER BY rows.is_owner DESC, lower(COALESCE(rows.full_name, '')), rows.user_id), '[]'::jsonb)
  INTO _members
  FROM (
    SELECT tm.user_id, p.full_name, au.email,
      CASE WHEN tm.is_owner OR tm.role = 'owner'::public.tenant_role THEN 'owner' ELSE tm.role::text END AS permission,
      (tm.is_owner OR tm.role = 'owner'::public.tenant_role) AS is_owner,
      tm.job_title, tm.responsibilities
    FROM public.tenant_members tm
    LEFT JOIN public.profiles p ON p.user_id = tm.user_id
    LEFT JOIN auth.users au ON au.id = tm.user_id
    WHERE tm.tenant_id = _tenant AND tm.status = 'active'
    ORDER BY (tm.is_owner OR tm.role = 'owner'::public.tenant_role) DESC,
             lower(COALESCE(p.full_name, au.email, '')), tm.user_id
    LIMIT 100
  ) rows;

  IF _can_manage_invitations THEN
    SELECT count(*) INTO _invitation_count
    FROM public.tenant_invite_tokens ti
    WHERE ti.tenant_id = _tenant AND ti.kind = 'team';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', rows.id,
      'email', rows.email,
      'permission', rows.permission,
      'status', rows.status,
      'job_title', rows.job_title,
      'responsibilities', rows.responsibilities,
      'created_at', rows.created_at,
      'expires_at', rows.expires_at
    ) ORDER BY rows.created_at DESC), '[]'::jsonb)
    INTO _invitations
    FROM (
      SELECT ti.id, ti.email, ti.default_role::text AS permission,
        CASE
          WHEN ti.uses > 0 THEN 'accepted'
          WHEN ti.revoked_at IS NOT NULL THEN 'revoked'
          WHEN ti.expires_at <= now() THEN 'expired'
          ELSE 'pending'
        END AS status,
        ti.job_title, ti.responsibilities, ti.created_at, ti.expires_at
      FROM public.tenant_invite_tokens ti
      WHERE ti.tenant_id = _tenant AND ti.kind = 'team'
      ORDER BY ti.created_at DESC
      LIMIT 100
    ) rows;
  END IF;

  _result := jsonb_build_object(
    'tenant_id', _tenant,
    'tenant_name', (SELECT name FROM public.tenants WHERE id = _tenant),
    'speaker', _speaker,
    'member_count', _member_count,
    'truncated', _member_count > 100,
    'members', _members,
    'invitation_count', CASE WHEN _can_manage_invitations THEN _invitation_count ELSE 0 END,
    'invitations_truncated', CASE WHEN _can_manage_invitations THEN _invitation_count > 100 ELSE false END,
    'invitations', CASE WHEN _can_manage_invitations THEN _invitations ELSE '[]'::jsonb END,
    'governance', jsonb_build_object(
      'custom_work_identity_changes_authority', false,
      'external_or_permission_changes_require_owner_confirmation', true
    )
  );
  -- exp08_original_owner_read_v1: projection only, no authority or legal-profile save.
  -- Keep the caller's existing Auth and membership rows stable through the projection.
  -- Auth first also agrees with Auth deletion/cascade order. Revocation that wins first refuses;
  -- a read that wins first finishes before that revocation can commit. No rows are changed.
  -- Original retirement exclusion precedes Auth/member row locks.
  LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
  PERFORM 1 FROM auth.users current_person WHERE current_person.id=_actor
   AND current_person.deleted_at IS NULL AND (current_person.banned_until IS NULL OR current_person.banned_until<=now())
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.tenant_members current_member
   WHERE current_member.tenant_id=_tenant AND current_member.user_id=_actor AND current_member.status='active'
    AND current_member.role=_viewer_role AND (current_member.is_owner OR current_member.role='owner'::public.tenant_role)=_viewer_is_owner
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT _result || jsonb_build_object(
   'viewer_is_account_holder',public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant),
   'account_holder_state',CASE WHEN public._solo_shell_tenant(_tenant) AND (public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status='active' AND current_admin.role='admin'::public.tenant_role))
    THEN public._tenant_account_holder_state(_tenant) ELSE NULL END,
   -- Display only: exactly the ORIGINAL revoke_co_owner active-owner floor set.
   -- Read the whole tenant membership set, never the filtered/paginated roster.
   'active_owner_count',CASE WHEN public._solo_shell_tenant(_tenant) AND (public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status='active' AND current_admin.role='admin'::public.tenant_role))
    THEN (SELECT count(*) FROM public.tenant_members active_owner
      WHERE active_owner.tenant_id=_tenant AND active_owner.is_owner=true AND active_owner.status='active')
    ELSE NULL END,
   'members',coalesce((SELECT jsonb_agg(m.value || jsonb_build_object(
    'is_account_holder',public._solo_shell_tenant(_tenant) AND EXISTS(SELECT 1 FROM public.tenants t
      WHERE t.id=_tenant AND t.owner_user_id=tm.user_id AND tm.is_owner
       AND public._tenant_account_holder_state(_tenant) IN ('working','paused')),
    'business_owner',CASE WHEN public._solo_shell_tenant(_tenant) AND (public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status='active' AND current_admin.role='admin'::public.tenant_role)) THEN
     (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
      FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=tm.business_owner_id AND tm.is_owner) ELSE NULL END,
    'billing_contact',CASE WHEN public._solo_shell_tenant(_tenant) AND
     (public.is_tenant_account_holder(_actor,_tenant) OR tm.user_id=_actor) THEN
      EXISTS(SELECT 1 FROM public.platform_billing_contacts bc WHERE bc.tenant_id=_tenant AND bc.user_id=tm.user_id AND bc.revoked_at IS NULL)
     ELSE NULL END) ORDER BY m.ord)
    FROM jsonb_array_elements(_result->'members') WITH ORDINALITY m(value,ord)
    JOIN public.tenant_members tm ON tm.tenant_id=_tenant AND tm.user_id::text=m.value->>'user_id'),'[]'::jsonb),
   'invitations',coalesce((SELECT jsonb_agg(inv.value || jsonb_build_object('business_owner',CASE
     WHEN public._solo_shell_tenant(_tenant) AND (public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status='active' AND current_admin.role='admin'::public.tenant_role)) THEN
      (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
       FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=ti.business_owner_id AND ti.default_role='owner'::public.tenant_role) ELSE NULL END) ORDER BY inv.ord)
    FROM jsonb_array_elements(_result->'invitations') WITH ORDINALITY inv(value,ord)
    JOIN public.tenant_invite_tokens ti ON ti.tenant_id=_tenant AND ti.id::text=inv.value->>'id'),'[]'::jsonb),
   'owner_seats_held',CASE WHEN public._solo_shell_tenant(_tenant) AND (public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status='active' AND current_admin.role='admin'::public.tenant_role)) THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),'vacant_since',bo.owner_seat_vacant_since)
     ORDER BY bo.id) FROM public.tenant_business_owners bo
     WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual' AND bo.owner_seat_vacant_since IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner)), '[]'::jsonb)
    ELSE '[]'::jsonb END,
   'business_owner_options',CASE WHEN public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant) THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),
     'representative',(SELECT jsonb_build_object('user_id',tm.user_id,'display_name',coalesce(nullif(btrim(profile.full_name),''),person.email))
      FROM public.tenant_members tm LEFT JOIN public.profiles profile ON profile.user_id=tm.user_id LEFT JOIN auth.users person ON person.id=tm.user_id
      WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner),
     'pending_invitation',(SELECT jsonb_build_object('id',ti.id,'email',ti.email,'expires_at',ti.expires_at)
      FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant) ORDER BY ti.created_at DESC,ti.id LIMIT 1),
     'seat_state',CASE
      WHEN EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner) THEN 'represented'
      WHEN EXISTS(SELECT 1 FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant)) THEN 'invited'
      WHEN bo.owner_seat_vacant_since IS NOT NULL THEN 'held' ELSE 'none' END)
      ORDER BY bo.id) FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual'),'[]'::jsonb)
    ELSE '[]'::jsonb END
  ) INTO _result WHERE _tenant IS NOT DISTINCT FROM public.current_user_tenant_id();
  RETURN _result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_paige_team_context() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_paige_team_context() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_solo_team_workspace(_search text DEFAULT NULL::text, _permission text DEFAULT 'all'::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _viewer_role public.tenant_role;
  _viewer_is_owner boolean := false;
  _can_manage boolean := false;
  _limit_safe integer := LEAST(GREATEST(COALESCE(_limit, 25), 1), 100);
  _offset_safe integer := GREATEST(COALESCE(_offset, 0), 0);
  _result jsonb;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'no active workspace' USING ERRCODE = '42501';
  END IF;

  SELECT tm.role, (tm.is_owner OR tm.role = 'owner'::public.tenant_role)
    INTO _viewer_role, _viewer_is_owner
  FROM public.tenant_members tm
  WHERE tm.tenant_id = _tenant
    AND tm.user_id = _actor
    AND tm.status = 'active'
  LIMIT 1;

  IF _viewer_role IS NULL THEN
    RAISE EXCEPTION 'team roster access denied' USING ERRCODE = '42501';
  END IF;
  _can_manage := _viewer_is_owner OR _viewer_role = 'admin'::public.tenant_role;

  WITH filtered AS (
    SELECT
      tm.id AS membership_id,
      tm.user_id,
      p.full_name,
      au.email,
      p.avatar_url,
      tm.status,
      tm.role::text AS permission,
      (tm.is_owner OR tm.role = 'owner'::public.tenant_role) AS is_owner,
      tm.job_title,
      tm.responsibilities,
      au.last_sign_in_at
    FROM public.tenant_members tm
    LEFT JOIN public.profiles p ON p.user_id = tm.user_id
    LEFT JOIN auth.users au ON au.id = tm.user_id
    WHERE tm.tenant_id = _tenant
      AND tm.status IN ('active', 'suspended')
      AND (
        COALESCE(NULLIF(lower(trim(_permission)), ''), 'all') = 'all'
        OR CASE
          WHEN tm.is_owner OR tm.role = 'owner'::public.tenant_role THEN 'owner'
          ELSE tm.role::text
        END = lower(trim(_permission))
      )
      AND (
        NULLIF(trim(_search), '') IS NULL
        OR COALESCE(p.full_name, '') ILIKE '%' || trim(_search) || '%'
        OR COALESCE(au.email, '') ILIKE '%' || trim(_search) || '%'
        OR COALESCE(tm.job_title, '') ILIKE '%' || trim(_search) || '%'
        OR COALESCE(tm.responsibilities, '') ILIKE '%' || trim(_search) || '%'
      )
  ), page AS (
    SELECT * FROM filtered
    ORDER BY is_owner DESC, lower(COALESCE(full_name, email, '')), user_id
    LIMIT _limit_safe OFFSET _offset_safe
  ), invitation_rows AS (
    SELECT ti.id, ti.email, ti.default_role::text AS permission, ti.created_at,
           ti.expires_at, ti.revoked_at, ti.uses,
           NULL::text AS token,
           -- DELIVERY, JOINED SERVER-SIDE AND NEVER EXPOSED AS A TABLE. `email_send_log` is
           -- platform-wide and carries every tenant's recipients; a browser must never read it.
           -- The join is inside this SECURITY DEFINER function, filtered to invitations of the
           -- caller's own workspace, so an owner learns about their own invitation and nothing else.
           d.delivery
    FROM public.tenant_invite_tokens ti
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
               'status', l.status,
               'at', l.created_at,
               'error', l.error_message,
               -- The full ordered history, so the screen can show a timeline rather than one word.
               'history', COALESCE((
                 SELECT jsonb_agg(jsonb_build_object('status', h.status, 'at', h.created_at)
                                  ORDER BY h.created_at)
                 FROM public.email_send_log h
                 WHERE h.metadata->>'invite_id' = ti.id::text
               ), '[]'::jsonb)
             ) AS delivery
      FROM public.email_send_log l
      WHERE l.metadata->>'invite_id' = ti.id::text
      -- THE FURTHEST-ALONG EVENT decides the headline, not the most recently inserted one.
      -- This used to sort `created_at DESC` first with rank as a mere tiebreak, which only held
      -- while events arrived in order. They do not: a provider retry of `delivered` after `opened`
      -- lands with the newest insert time and dragged the headline BACKWARDS to Delivered. And
      -- `created_at` is OUR insert time, not the provider's event time, so it cannot arbitrate
      -- ordering at all. Rank is the real ordering — it encodes how far through the journey each
      -- status is, with failures outranking successes because a bounce or a complaint is the most
      -- important thing to say about an email. `created_at` now only breaks ties within one rank.
      ORDER BY public.email_delivery_rank(l.status) DESC, l.created_at DESC
      LIMIT 1
    ) d ON true
    WHERE ti.tenant_id = _tenant AND ti.kind = 'team'
      -- Archived invitations are cleared from the operator's list by their own deliberate act.
      -- The row survives, because a revoked invitation is evidence that access was withdrawn.
      AND ti.archived_at IS NULL
    ORDER BY ti.created_at DESC
    LIMIT 100
  )
  SELECT jsonb_build_object(
    'tenant_id', _tenant,
    'tenant_name', t.name,
    'viewer_permission', CASE WHEN _viewer_is_owner THEN 'owner' ELSE _viewer_role::text END,
    'can_manage_profiles', _can_manage,
    'can_manage_invitations', _can_manage,
    'can_change_permissions', _viewer_is_owner,
    'total_members', (SELECT count(*) FROM filtered),
    'members', COALESCE((SELECT jsonb_agg(to_jsonb(page)) FROM page), '[]'::jsonb),
    'invitations', CASE WHEN _can_manage
      THEN COALESCE((SELECT jsonb_agg(to_jsonb(invitation_rows)) FROM invitation_rows), '[]'::jsonb)
      ELSE '[]'::jsonb END
  ) INTO _result
  FROM public.tenants t
  WHERE t.id = _tenant;

  -- exp08_original_owner_read_v1: projection only, no authority or legal-profile save.
  -- Keep the caller's existing Auth and membership rows stable through the projection.
  -- Auth first also agrees with Auth deletion/cascade order. Revocation that wins first refuses;
  -- a read that wins first finishes before that revocation can commit. No rows are changed.
  -- Original retirement exclusion precedes Auth/member row locks.
  LOCK TABLE public.tenants IN ROW EXCLUSIVE MODE;
  PERFORM 1 FROM auth.users current_person WHERE current_person.id=_actor
   AND current_person.deleted_at IS NULL AND (current_person.banned_until IS NULL OR current_person.banned_until<=now())
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.tenant_members current_member
   WHERE current_member.tenant_id=_tenant AND current_member.user_id=_actor AND current_member.status='active'
    AND current_member.role=_viewer_role AND (current_member.is_owner OR current_member.role='owner'::public.tenant_role)=_viewer_is_owner
   FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT _result || jsonb_build_object(
   'viewer_is_account_holder',public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant),
   'account_holder_state',CASE WHEN public._solo_shell_tenant(_tenant) AND (public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status='active' AND current_admin.role='admin'::public.tenant_role))
    THEN public._tenant_account_holder_state(_tenant) ELSE NULL END,
   -- Display only: exactly the ORIGINAL revoke_co_owner active-owner floor set.
   -- Read the whole tenant membership set, never the filtered/paginated roster.
   'active_owner_count',CASE WHEN public._solo_shell_tenant(_tenant) AND (public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status='active' AND current_admin.role='admin'::public.tenant_role))
    THEN (SELECT count(*) FROM public.tenant_members active_owner
      WHERE active_owner.tenant_id=_tenant AND active_owner.is_owner=true AND active_owner.status='active')
    ELSE NULL END,
   'members',coalesce((SELECT jsonb_agg(m.value || jsonb_build_object(
    'is_account_holder',public._solo_shell_tenant(_tenant) AND EXISTS(SELECT 1 FROM public.tenants t
      WHERE t.id=_tenant AND t.owner_user_id=tm.user_id AND tm.is_owner
       AND public._tenant_account_holder_state(_tenant) IN ('working','paused')),
    'business_owner',CASE WHEN public._solo_shell_tenant(_tenant) AND (public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status='active' AND current_admin.role='admin'::public.tenant_role)) THEN
     (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
      FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=tm.business_owner_id AND tm.is_owner) ELSE NULL END,
    'billing_contact',CASE WHEN public._solo_shell_tenant(_tenant) AND
     (public.is_tenant_account_holder(_actor,_tenant) OR tm.user_id=_actor) THEN
      EXISTS(SELECT 1 FROM public.platform_billing_contacts bc WHERE bc.tenant_id=_tenant AND bc.user_id=tm.user_id AND bc.revoked_at IS NULL)
     ELSE NULL END) ORDER BY m.ord)
    FROM jsonb_array_elements(_result->'members') WITH ORDINALITY m(value,ord)
    JOIN public.tenant_members tm ON tm.tenant_id=_tenant AND tm.id::text=m.value->>'membership_id'),'[]'::jsonb),
   'invitations',coalesce((SELECT jsonb_agg(inv.value || jsonb_build_object('business_owner',CASE
     WHEN public._solo_shell_tenant(_tenant) AND (public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status='active' AND current_admin.role='admin'::public.tenant_role)) THEN
      (SELECT jsonb_build_object('id',bo.id,'kind',bo.owner_kind,'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name))
       FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.id=ti.business_owner_id AND ti.default_role='owner'::public.tenant_role) ELSE NULL END) ORDER BY inv.ord)
    FROM jsonb_array_elements(_result->'invitations') WITH ORDINALITY inv(value,ord)
    JOIN public.tenant_invite_tokens ti ON ti.tenant_id=_tenant AND ti.id::text=inv.value->>'id'),'[]'::jsonb),
   'owner_seats_held',CASE WHEN public._solo_shell_tenant(_tenant) AND (public.is_tenant_owner(_actor,_tenant) OR EXISTS(SELECT 1 FROM public.tenant_members current_admin WHERE current_admin.tenant_id=_tenant AND current_admin.user_id=_actor AND current_admin.status='active' AND current_admin.role='admin'::public.tenant_role)) THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),'vacant_since',bo.owner_seat_vacant_since)
     ORDER BY bo.id) FROM public.tenant_business_owners bo
     WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual' AND bo.owner_seat_vacant_since IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner)), '[]'::jsonb)
    ELSE '[]'::jsonb END,
   'business_owner_options',CASE WHEN public._solo_shell_tenant(_tenant) AND public.is_tenant_account_holder(_actor,_tenant) THEN
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',bo.id,'kind',bo.owner_kind,
     'display_name',coalesce(nullif(btrim(bo.display_name),''),bo.legal_name),
     'representative',(SELECT jsonb_build_object('user_id',tm.user_id,'display_name',coalesce(nullif(btrim(profile.full_name),''),person.email))
      FROM public.tenant_members tm LEFT JOIN public.profiles profile ON profile.user_id=tm.user_id LEFT JOIN auth.users person ON person.id=tm.user_id
      WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner),
     'pending_invitation',(SELECT jsonb_build_object('id',ti.id,'email',ti.email,'expires_at',ti.expires_at)
      FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant) ORDER BY ti.created_at DESC,ti.id LIMIT 1),
     'seat_state',CASE
      WHEN EXISTS(SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id=_tenant AND tm.business_owner_id=bo.id AND tm.is_owner) THEN 'represented'
      WHEN EXISTS(SELECT 1 FROM public.tenant_invite_tokens ti WHERE ti.tenant_id=_tenant AND ti.business_owner_id=bo.id
       AND ti.kind='team' AND ti.default_role='owner'::public.tenant_role AND ti.uses=0 AND ti.revoked_at IS NULL AND ti.expires_at>now()
       AND public.is_tenant_account_holder(ti.created_by,_tenant)) THEN 'invited'
      WHEN bo.owner_seat_vacant_since IS NOT NULL THEN 'held' ELSE 'none' END)
      ORDER BY bo.id) FROM public.tenant_business_owners bo WHERE bo.tenant_id=_tenant AND bo.owner_kind<>'individual'),'[]'::jsonb)
    ELSE '[]'::jsonb END
  ) INTO _result WHERE _tenant IS NOT DISTINCT FROM public.current_user_tenant_id();
  RETURN _result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_solo_team_workspace(text,text,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_solo_team_workspace(text,text,integer,integer) TO authenticated;
DO $exp08_literal_guard$
DECLARE p pg_catalog.pg_proc; before_state boolean:=true; after_state boolean:=true;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'EXP08 native installer requires postgres'; END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.get_paige_team_context()');
 IF NOT FOUND THEN
  after_state:=false; before_state:=false;
 ELSE
  IF p.proowner::regrole::text IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR p.prokind<>'f' OR p.provolatile<>'v'
   OR p.proisstrict IS DISTINCT FROM false OR p.proleakproof IS DISTINCT FROM false
   OR p.proparallel<>'u' OR p.proretset IS DISTINCT FROM false
   OR p.pronargdefaults<>0 OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM ''
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'jsonb' THEN RAISE EXCEPTION 'EXP08 owner read original reader metadata drift: public.get_paige_team_context()'; END IF;
  IF pg_catalog.md5(p.prosrc)<>'34069ec817a98b7bf1bca933f7cf4d18' THEN after_state:=false; END IF;
  before_state:=false;
  IF pg_catalog.md5(p.prosrc) NOT IN ('34069ec817a98b7bf1bca933f7cf4d18') THEN RAISE EXCEPTION 'EXP08 owner read original source drift: public.get_paige_team_context()'; END IF;
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure('public.get_solo_team_workspace(text,text,integer,integer)');
 IF NOT FOUND THEN
  after_state:=false; before_state:=false;
 ELSE
  IF p.proowner::regrole::text IS DISTINCT FROM 'postgres' OR NOT p.prosecdef
   OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
   OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
   OR p.prokind<>'f' OR p.provolatile<>'v'
   OR p.proisstrict IS DISTINCT FROM false OR p.proleakproof IS DISTINCT FROM false
   OR p.proparallel<>'u' OR p.proretset IS DISTINCT FROM false
   OR p.pronargdefaults<>4 OR pg_catalog.pg_get_function_arguments(p.oid) IS DISTINCT FROM '_search text DEFAULT NULL::text, _permission text DEFAULT ''all''::text, _limit integer DEFAULT 25, _offset integer DEFAULT 0'
   OR pg_catalog.pg_get_function_result(p.oid) IS DISTINCT FROM 'jsonb' THEN RAISE EXCEPTION 'EXP08 owner read original reader metadata drift: public.get_solo_team_workspace(text,text,integer,integer)'; END IF;
  IF pg_catalog.md5(p.prosrc)<>'7a94f014248160c3b0fc119ec71f8481' THEN after_state:=false; END IF;
  before_state:=false;
  IF pg_catalog.md5(p.prosrc) NOT IN ('7a94f014248160c3b0fc119ec71f8481') THEN RAISE EXCEPTION 'EXP08 owner read original source drift: public.get_solo_team_workspace(text,text,integer,integer)'; END IF;
 END IF;
 IF NOT after_state THEN RAISE EXCEPTION 'EXP08 literal native result could not be verified'; END IF;
END $exp08_literal_guard$;

COMMIT;
