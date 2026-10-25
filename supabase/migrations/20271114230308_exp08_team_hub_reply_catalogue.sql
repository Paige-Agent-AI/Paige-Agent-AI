-- EXP08 Team Hub increment 4: show PAIGE's Team Hub reply in the ONE autonomy catalogue, so the
-- owner can see it and turn it off. Contract: docs/delivery/exp08-team-hub-increment4-paige-contract.md
-- section 3. Owner decision: docs/brain/decision-log.md, "EXP08 Team Hub increment 4" (2026-10-24):
-- posting only with the person's approval. `high` in action-risk.ts, so the lane is clamped to
-- confirm whatever is stored: `auto` never posts unattended, and `off` turns it off.
-- Metadata only: no stored grant, no execution, no Chat/Live admission. Delegates the incumbent
-- before appending one row, retaining every prior catalogue row, its scope checks and stored modes.
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_exp08_team_hub(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_exp08_team_hub;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_exp08_team_hub(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_exp08_team_hub(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_exp08_team_hub(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('team_hub_post_reply','Post a Team Hub reply you approved','Team')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
