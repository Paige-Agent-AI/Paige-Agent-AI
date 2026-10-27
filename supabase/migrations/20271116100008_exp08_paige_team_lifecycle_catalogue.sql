-- EXP08 team lifecycle: show PAIGE's five team changes in the ONE autonomy catalogue, so the owner can
-- see each one and turn it off. Owner rulings: docs/brain/decision-log.md, "EXP08 team lifecycle"
-- (2026-10-26) and "EXP08 PAIGE team-lifecycle tools". All five are `high` in action-risk.ts, so the
-- lane is clamped to confirm whatever is stored: `auto` never runs one unattended, and `off` turns it off.
-- The two reads (team_list_members, team_member_holdings) are not governed and get no row.
-- Metadata only: no stored grant, no execution, no Chat/Live admission. Delegates the incumbent
-- before appending five rows, retaining every prior catalogue row, its scope checks and stored modes.
--
-- GUARDED like 20271115020009: it wraps exactly the catalogue production runs, never whatever happens to
-- be there. 2e8dba15… is md5(pg_get_functiondef(list_tool_autonomy)) read from production 2026-10-26 (the
-- e09 request-share wrapper, applied as 20271115020009); a different incumbent (another catalogue
-- migration landing first) refuses rather than being quietly wrapped. On a replay the predecessor
-- already exists, and the current catalogue must still be THIS file's wrapper (md5 a58337ca…, computed
-- from the definition below): a later wrapper built on top of this one refuses rather than being
-- overwritten. Proof: supabase/tests/exp08_paige_team_lifecycle_catalogue.sql.
DO $guard$
DECLARE _current text := CASE WHEN to_regprocedure('public.list_tool_autonomy(uuid)') IS NULL THEN NULL
  ELSE md5(pg_get_functiondef(to_regprocedure('public.list_tool_autonomy(uuid)'))) END;
BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_exp08_team_lifecycle(uuid)') IS NOT NULL THEN
  IF _current IS DISTINCT FROM 'a58337ca9887626d3d5cbeb223f7c28b' THEN
   RAISE EXCEPTION 'Autonomy catalogue changed after the EXP08 team lifecycle rows; compose and review before re-applying';
  END IF;
 ELSIF _current IS DISTINCT FROM '2e8dba155891e8203d9251d141687855' THEN
  RAISE EXCEPTION 'Original autonomy catalogue changed; compose and review before applying';
 ELSE
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_exp08_team_lifecycle;
 END IF;
END $guard$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_exp08_team_lifecycle(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_exp08_team_lifecycle(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_exp08_team_lifecycle(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('team_suspend_member','Suspend a teammate','Team'),
  ('team_reinstate_member','Reinstate a suspended teammate','Team'),
  ('team_remove_member','Remove a teammate from the workspace','Team'),
  ('team_set_conversations','Turn a teammate''s Team conversations on or off','Team'),
  ('team_handover_work','Hand a teammate''s work to someone else','Team')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
