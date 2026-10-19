-- Use the incumbent current-actor/current-workspace authority seam for the
-- existing policy. The actor-explicit helper remains service-role-only; its
-- authenticated SECURITY DEFINER wrapper is the existing RLS-compatible door.
BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER POLICY "Tenant admins manage own domains"
  ON public.tenant_email_domains
  USING (tenant_id = public.current_user_tenant_id()
         AND public.is_current_user_tenant_admin())
  WITH CHECK (tenant_id = public.current_user_tenant_id()
              AND public.is_current_user_tenant_admin());

COMMIT;
