-- Ads from chat (2026-10-12): PAIGE can feature a library picture in the Ads showroom
-- (set_ad_creative_featured, classified `ordinary` in _shared/action-risk.ts). Its catalogue row makes the
-- act visible in Autonomy settings, where the owner can leave it asking first (the default), let PAIGE do
-- it, or switch it off. The funnel read (get_pipeline_lead_funnel) writes nothing and is not catalogued.
--
-- The additive wrapper pattern of 20270602000201 (inbox intelligence): rename the incumbent once, forward
-- its rows unchanged, add the one new row. No existing setting, table, policy or grant changes; replaying
-- this file is a no-op apart from re-asserting the same function body and grants.

DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_ads_chat(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_ads_chat;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_ads_chat(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_ads_chat(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_ads_chat(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id; END IF;
 ELSE tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('set_ad_creative_featured','Feature a picture in your Ads showroom','Content')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
