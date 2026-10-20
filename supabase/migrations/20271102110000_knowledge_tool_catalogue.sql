-- Metadata-only Knowledge controls. Preserve the complete incumbent catalogue,
-- authorization predicates and per-tenant settings through its existing native seam.
-- This never grants a lane or admits a Chat action through INT346.
DO $$ BEGIN
  IF to_regprocedure('public._list_tool_autonomy_before_knowledge_chat(uuid)') IS NULL THEN
    ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_knowledge_chat;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_knowledge_chat(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_knowledge_chat(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _tenant uuid;
BEGIN
  -- Run the original authorization checks first, including tenant mismatch refusal.
  RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_knowledge_chat(_tenant_id);
  IF auth.uid() IS NOT NULL THEN
    _tenant:=public.current_user_tenant_id();
    IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
  ELSE _tenant:=_tenant_id; END IF;
  RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
    ('knowledge_update','Update Knowledge metadata','Knowledge'),
    ('knowledge_delete','Delete a Knowledge document permanently','Knowledge')
  ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
    FROM catalog c LEFT JOIN public.tenant_tool_autonomy a
      ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
