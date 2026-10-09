-- INT-345 K-3 — extend the canonical Trust catalogue with the governed calling-setup
-- action. Extension pattern (mirrors 20270601000007): rename the previous declaration
-- private, re-expose it, union exactly one new row. No existing autonomy setting,
-- scope admission, or provider operation changes. Default mode is 'confirm' (no
-- tenant_tool_autonomy row) — the owner-approved default-confirm approval posture.

DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_calling_setup(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_calling_setup;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_calling_setup(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_calling_setup(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_calling_setup(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id; END IF;
 ELSE tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('comms_setup_calling','Set up calling for this workspace','Comms')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
