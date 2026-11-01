-- has_role(uuid,app_role): c9435c061911f8bc732dadf64697e488
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$function$;

-- has_any_role(uuid,text[]): 5f3084bb454ccf757b6f084d48ea38e9
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text = ANY (_roles)
  );
$function$;

-- is_super_admin(): 3502964d047b0ec63878a6a941256ccc
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'::public.app_role); $function$;

-- is_super_admin(uuid): 9f311ec5f24bc134ac4c4f082857ecef
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin'::public.app_role); $function$;

-- is_platform_owner(): 2a5fce92762aadcc5b6c5b4d20c325c1
CREATE OR REPLACE FUNCTION public.is_platform_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT public.is_super_admin() $function$;

-- is_platform_owner(uuid): 9126baed8457265ba2a0bb121e8b68c9
CREATE OR REPLACE FUNCTION public.is_platform_owner(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT public.is_super_admin(_user_id) $function$;

-- is_platform_admin(): 7e093adf4ece40f490dde979f0663add
CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND (role::text = 'platform_admin' OR role::text = 'super_admin')); $function$;

-- is_platform_admin(uuid): 9bf74de3df213053cc9427b053d7a4fa
CREATE OR REPLACE FUNCTION public.is_platform_admin(_actor uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _actor AND (role::text = 'platform_admin' OR role::text = 'super_admin')
  );
$function$;

-- is_company_workspace(uuid): 0b57a7066269455fe2c7b690072a1fcf
CREATE OR REPLACE FUNCTION public.is_company_workspace(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants t
     WHERE t.id = _tenant
       AND t.parent_tenant_id IS NULL
       AND t.account_type = 'standalone'
       AND COALESCE(t.features -> 'system_workspace' = 'true'::jsonb, false)
  );
$function$;

-- is_tenant_admin_as(uuid,uuid): ac25601b084c50c4351c5282e4c6d302
CREATE OR REPLACE FUNCTION public.is_tenant_admin_as(_actor uuid, _tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = _actor
       AND status = 'active' AND role IN ('owner','admin')
  )
  OR (_actor IS NOT NULL AND public.is_company_workspace(_tenant) AND public.is_platform_admin(_actor));
$function$;

-- current_user_tenant_id(): df75fac277b175efed732f0bc52b4a44
CREATE OR REPLACE FUNCTION public.current_user_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT p.active_tenant_id FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.active_tenant_id IS NOT NULL
         AND (
           EXISTS (SELECT 1 FROM public.tenant_members m
                     WHERE m.user_id = auth.uid() AND m.tenant_id = p.active_tenant_id AND m.status = 'active')
           OR public.agency_can_manage_child(p.active_tenant_id, auth.uid())
           OR public.agency_team_role(p.active_tenant_id, auth.uid()) IS NOT NULL
           OR public.is_platform_admin(auth.uid())
         )),
    (SELECT tenant_id FROM public.tenant_members
       WHERE user_id = auth.uid() AND status = 'active'
       ORDER BY joined_at ASC LIMIT 1)
  );
$function$;
