-- Extend whichever canonical catalogue has landed, including Studio's460 migration.
-- Preserve its rows, authority checks and stored modes without copying/reverting it.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_sales_collections(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_sales_collections;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_sales_collections(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _tenant uuid;
BEGIN
 -- The predecessor performs the canonical scope guard before any new rows return.
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_sales_collections(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY
 WITH catalog(tool_key,label) AS (VALUES
  ('sales_save_collection_terms','Save customer collection terms'),
  ('sales_stage_collection_import','Review imported customer collection records'),
  ('sales_commit_collection_import','Import reviewed customer collection records')
 )
 SELECT c.tool_key,c.label,'Payments'::text,coalesce(t.mode,'confirm'),t.mode IS NULL,t.updated_at
 FROM catalog c
 LEFT JOIN public.tenant_tool_autonomy t ON t.tenant_id=_tenant AND t.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
