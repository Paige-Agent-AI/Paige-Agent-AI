-- CLI scaffold20261015063048, moved while UNAPPLIED to reserved051051.
-- Follow-up to051050: preserve the already-preview-applied migration and the
-- entire incumbent catalogue/authority chain. This adds visibility/control,
-- not a grant, configured lane, Chat binding or business effect.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_e04_effectuation(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_e04_effectuation;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_e04_effectuation(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_e04_effectuation(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 -- Original caller/tenant/platform/service checks run first, unchanged.
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_e04_effectuation(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id;END IF;
 ELSE tenant:=_tenant_id;END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('sales_effectuate_commercial_terms','Make signed commercial terms effective','Payments')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
COMMIT;
