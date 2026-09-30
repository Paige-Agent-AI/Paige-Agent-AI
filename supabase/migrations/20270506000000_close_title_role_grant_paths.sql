-- The database no longer hands out the retired title role, and holding it earns nothing.
--
-- "Coach" is a title a business gives its people. It never grants permission. Slices 1 and 2 removed
-- every read of the platform-wide `coach` role; this migration closes the paths that could still
-- grant it or reward someone for holding it:
--   * accept_invitation refuses an invitation that carries the role (0 have ever been sent);
--   * change_user_role refuses a change to the role;
--   * the role and a business seat no longer map onto each other, so neither the user_roles ->
--     tenant_members sync nor the tenant_members -> user_roles sync can create one from the other
--     (0 coach seats exist). A business seat that says coach maps to an ordinary user;
--   * auto_enroll_affiliate enrolls admins only; holding the role creates no affiliate profile. The
--     one profile it created earlier is left in place;
--   * admin_bulk_assign_coach and reassign_coach_clients decide who may be assigned clients by active
--     membership of the caller's business, never by the role (assignment plus membership, the rule
--     slice 1 set for reads);
--   * assignment_role_for maps the role to no assignment seat. Its one caller, claim_client, accepts
--     sales and customer-success reps only, so the branch was unreachable.
-- The tenant grant function (grant_tenant_member_role) is left to slice 4, which refuses the role
-- there and forbids the value outright.
--
-- Function bodies are those on production, with only the role removed; names, signatures, settings
-- and grants are unchanged.
--
-- Applied as one statement, so production takes all of it or none of it, with a short lock wait so a
-- blocked attempt fails the deploy instead of holding up other queries.
SET lock_timeout = '10s';

DO $migration$
DECLARE
  _def text;
  _new text;
BEGIN
  CREATE OR REPLACE FUNCTION public.map_app_role_to_tenant_role(_app_role app_role)
   RETURNS tenant_role
   LANGUAGE sql
   IMMUTABLE
   SET search_path TO 'public'
  AS $function$
    SELECT CASE _app_role
      WHEN 'admin'::public.app_role THEN 'admin'::public.tenant_role
      ELSE 'member'::public.tenant_role
    END
  $function$;

  CREATE OR REPLACE FUNCTION public.map_tenant_role_to_app_role(_tenant_role tenant_role)
   RETURNS app_role
   LANGUAGE sql
   IMMUTABLE
   SET search_path TO 'public'
  AS $function$
    SELECT CASE _tenant_role
      WHEN 'owner'  THEN 'admin'::app_role
      WHEN 'admin'  THEN 'admin'::app_role
      WHEN 'coach'  THEN 'user'::app_role
      WHEN 'member' THEN 'user'::app_role
    END
  $function$;

  CREATE OR REPLACE FUNCTION public.assignment_role_for(_role app_role)
   RETURNS text
   LANGUAGE sql
   IMMUTABLE
   SET search_path TO 'public'
  AS $function$
    SELECT CASE _role
      WHEN 'sales_rep'::app_role THEN 'lead_owner'
      WHEN 'cs_rep'::app_role    THEN 'cs_primary'
      ELSE NULL
    END
  $function$;

  CREATE OR REPLACE FUNCTION public.auto_enroll_affiliate()
   RETURNS trigger
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  declare
    v_tier_id uuid;
    v_code    text;
    v_role    text;
    v_aff_id  uuid;
  begin
    v_role := new.role::text;
    if v_role <> 'admin' then return new; end if;

    if exists (select 1 from public.affiliate_profiles where user_id = new.user_id) then
      return new;
    end if;

    select id into v_tier_id
      from public.affiliate_commission_tiers
     where tier_key = 'admin'
     limit 1;

    v_code := upper(
      substr(
        coalesce(
          regexp_replace(
            (select full_name from public.profiles where user_id = new.user_id),
            '[^a-zA-Z0-9]', '', 'g'
          ),
          'PAIGE'
        ), 1, 4)
    ) || upper(substr(md5(random()::text || new.user_id::text), 1, 4));

    for i in 1..5 loop
      exit when not exists (select 1 from public.referral_codes where code = v_code);
      v_code := substr(v_code, 1, 4)
              || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    end loop;

    insert into public.affiliate_profiles
      (user_id, referral_code, commission_tier_id, enrolled_from, active)
    values
      (new.user_id, v_code, v_tier_id, 'auto_' || v_role, true)
    returning id into v_aff_id;

    insert into public.referral_codes (code, affiliate_id, active)
    values (v_code, v_aff_id, true)
    on conflict (code) do nothing;

    return new;
  end $function$;

  CREATE OR REPLACE FUNCTION public.sync_user_role_to_tenant_member()
   RETURNS trigger
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    _tenant_id uuid;
    _tenant_role public.tenant_role;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    IF NEW.role = 'super_admin'::public.app_role THEN
      RETURN NEW;
    END IF;

    _tenant_id := public.current_user_tenant_id();
    IF _tenant_id IS NULL THEN
      RETURN NEW;
    END IF;

    IF NOT (public.is_platform_owner() OR public.is_tenant_admin(_tenant_id)) THEN
      RETURN NEW;
    END IF;

    _tenant_role := public.map_app_role_to_tenant_role(NEW.role);

    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, invited_at, joined_at)
    VALUES (_tenant_id, NEW.user_id, _tenant_role, 'active', now(), now())
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET role = CASE
            WHEN public.tenant_members.role = 'owner'::public.tenant_role THEN public.tenant_members.role
            WHEN EXCLUDED.role = 'admin'::public.tenant_role THEN 'admin'::public.tenant_role
            ELSE public.tenant_members.role
          END,
          status = 'active',
          joined_at = COALESCE(public.tenant_members.joined_at, now()),
          updated_at = now();

    UPDATE public.profiles
       SET active_tenant_id = _tenant_id
     WHERE user_id = NEW.user_id
       AND active_tenant_id IS NULL;

    RETURN NEW;
  END;
  $function$;

  CREATE OR REPLACE FUNCTION public.accept_invitation(_token text, _user_id uuid)
   RETURNS json
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    _invitation record;
    _token_hash text;
    _tenant_role public.tenant_role;
    _caller_email text;
  BEGIN
    -- §9/#117: an invitation may only be redeemed BY the authenticated caller,
    -- FOR themselves, and only when the caller's email matches the invite target.
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
    END IF;
    IF _user_id <> auth.uid() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    _token_hash := encode(digest(_token, 'sha256'), 'hex');

    SELECT * INTO _invitation
    FROM public.invitations
    WHERE token_hash = _token_hash
      AND accepted_at IS NULL
      AND expires_at > now();

    IF _invitation IS NULL THEN
      RETURN json_build_object('success', false, 'message', 'Invalid or expired invitation');
    END IF;

    -- §9/#117: the caller's verified email must match the invitation's target email.
    SELECT email INTO _caller_email FROM auth.users WHERE id = auth.uid();
    IF _caller_email IS NULL
       OR _invitation.email IS NULL
       OR lower(_caller_email) <> lower(_invitation.email) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- "Coach" is a title a business gives its people, never a role anyone is granted.
    IF _invitation.role = 'coach'::public.app_role THEN
      RAISE EXCEPTION 'this invitation carries a retired role' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, _invitation.role)
    ON CONFLICT (user_id, role) DO NOTHING;

    IF _invitation.tenant_id IS NOT NULL
       AND _invitation.role::text IN ('admin','sales_rep','broker','broker_team_member','cs_rep','finance','viewer','moderator','user','client')
       AND _invitation.role <> 'super_admin'::public.app_role THEN
      _tenant_role := public.map_app_role_to_tenant_role(_invitation.role);

      INSERT INTO public.tenant_members (tenant_id, user_id, role, status, invited_at, joined_at)
      VALUES (_invitation.tenant_id, _user_id, _tenant_role, 'active', _invitation.created_at, now())
      ON CONFLICT (tenant_id, user_id) DO UPDATE
        SET role = CASE
              WHEN public.tenant_members.role = 'owner'::public.tenant_role THEN public.tenant_members.role
              WHEN EXCLUDED.role = 'admin'::public.tenant_role THEN 'admin'::public.tenant_role
              ELSE public.tenant_members.role
            END,
            status = 'active',
            joined_at = COALESCE(public.tenant_members.joined_at, now()),
            updated_at = now();

      UPDATE public.profiles
         SET active_tenant_id = _invitation.tenant_id
       WHERE user_id = _user_id
         AND active_tenant_id IS NULL;
    END IF;

    UPDATE public.invitations
    SET accepted_at = now()
    WHERE id = _invitation.id;

    RETURN json_build_object(
      'success', true,
      'role', _invitation.role,
      'tenant_id', _invitation.tenant_id,
      'message', 'Invitation accepted successfully'
    );
  END;
  $function$;

  CREATE OR REPLACE FUNCTION public.admin_bulk_assign_coach(_coach uuid, _client_ids uuid[])
   RETURNS jsonb
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    caller uuid := auth.uid();
    updated int;
  BEGIN
    IF caller IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    -- §9/#117: authorize on the caller's ACTIVE tenant, not a global admin/owner role.
    IF NOT (public.is_tenant_admin(public.current_user_tenant_id()) OR public.is_platform_owner()) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- The assignee must be an active member of the caller's business. A title, and the retired role,
    -- decide nothing here.
    IF NOT EXISTS (
         SELECT 1 FROM public.tenant_members
          WHERE tenant_id = public.current_user_tenant_id()
            AND user_id = _coach
            AND status = 'active'
       ) THEN
      RAISE EXCEPTION 'target_coach_not_in_tenant' USING ERRCODE = '42501';
    END IF;

    UPDATE public.clients
       SET assigned_coach_user_id = _coach,
           updated_at = now()
     WHERE id = ANY(_client_ids)
       AND tenant_id = public.current_user_tenant_id();
    GET DIAGNOSTICS updated = ROW_COUNT;

    RETURN jsonb_build_object('ok', true, 'updated', updated);
  END;
  $function$;

  -- change_user_role and reassign_coach_clients are edited where they stand: only the lines about the
  -- retired role change, and the migration stops if a line it expects is missing.
  _def := pg_get_functiondef('public.change_user_role(uuid, app_role, app_role, uuid, text)'::regprocedure);
  _new := replace(_def,
    E'  IF _to_role = ''super_admin''::public.app_role THEN',
    E'  IF _to_role = ''coach''::public.app_role THEN\n    RAISE EXCEPTION ''ROLE_CHANGE_FORBIDDEN: coach is a title, never a role'' USING ERRCODE = ''42501'';\n  END IF;\n\n  IF _to_role = ''super_admin''::public.app_role THEN');
  IF _new = _def THEN
    RAISE EXCEPTION 'change_user_role: the super_admin guard was not found';
  END IF;
  EXECUTE _new;

  _def := pg_get_functiondef('public.reassign_coach_clients(uuid, uuid)'::regprocedure);
  _new := regexp_replace(_def,
    E'IF NOT public\\.has_role\\(_to_coach, ''coach''\\) THEN\\s+RAISE EXCEPTION ''target user is not a coach'';',
    E'IF NOT EXISTS (\n        SELECT 1 FROM public.tenant_members\n         WHERE tenant_id = public.current_user_tenant_id()\n           AND user_id = _to_coach\n           AND status = ''active''\n      ) THEN\n      RAISE EXCEPTION ''target user is not a member of this business'' USING ERRCODE = ''42501'';');
  IF _new = _def THEN
    RAISE EXCEPTION 'reassign_coach_clients: the retired role check was not found';
  END IF;
  IF _new ~ '''coach''' THEN
    RAISE EXCEPTION 'reassign_coach_clients still names the retired role';
  END IF;
  EXECUTE _new;
END
$migration$;

RESET lock_timeout;
