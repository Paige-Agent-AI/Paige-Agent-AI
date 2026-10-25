-- EXP09 original request sharing: one metadata row in the existing catalogue.
-- The native caller-JWT publisher and common HIGH approval remain authoritative.
-- No stored mode/grant/activation or business action is created by this migration.
-- Normally scaffolded 20261025215353, renamed only while never applied; current
-- observed native frontier 20271114250008. Recheck source/order before release.
DO $guard$
BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_e09_request_share(uuid)') IS NOT NULL
  OR to_regprocedure('public.list_tool_autonomy(uuid)') IS NULL
  OR md5(pg_get_functiondef(to_regprocedure('public.list_tool_autonomy(uuid)'))) <> '7b224b776dcd79d51f1216196351a1b8'
 THEN RAISE EXCEPTION 'Original autonomy catalogue changed; compose and review before applying'; END IF;
 ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_e09_request_share;
END $guard$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_e09_request_share(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE _tenant uuid;
BEGIN
 -- All original rows, caller/tenant checks and persisted modes run first.
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_e09_request_share(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('client_portal_request_share','Share a saved customer request you approved','Clients')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $function$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
