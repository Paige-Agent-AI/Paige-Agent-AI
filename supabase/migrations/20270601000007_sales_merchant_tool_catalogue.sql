-- Extend the canonical Trust catalogue; preserve its existing scope admission.
-- No autonomy setting, merchant reservation, or provider operation is changed.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_merchant_setup(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_merchant_setup;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_merchant_setup(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_merchant_setup(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_merchant_setup(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id; END IF;
 ELSE tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('sales_start_merchant_onboarding','Start Stripe Express merchant setup','Payments'),
  ('sales_create_merchant_login_link','Open the Stripe merchant dashboard','Payments')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
