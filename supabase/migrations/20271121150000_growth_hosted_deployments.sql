-- growth_hosted_deployments — ONE hosted copy per published page (EXP06 WEB-05, owner
-- direction 2026-10-28 88b2f756: build the hosting implementation within existing
-- authority, provider activation HELD).
--
-- Written ONLY by the growth-hosting-command door on its service-role client. RLS is
-- ENABLED with ZERO policies: nobody but the service role (and platform operators above
-- RLS) can read or write these rows — a hosted copy is platform infrastructure state, not
-- tenant-visible data; the customer-facing truth lives on the page's own record and the
-- door's responses. The unique (tenant_id, page_id) index enforces the one-deployment-per-
-- page contract the capability declares. `status` never says "live" on the door's word
-- alone: `live` is written only after the REAL HTTPS verification matched the exported
-- bytes; anything uncertain is verify_failed / removed_unconfirmed and stays a human's
-- next decision.

CREATE TABLE IF NOT EXISTS public.growth_hosted_deployments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  page_id         uuid NOT NULL REFERENCES public.growth_pages(id) ON DELETE CASCADE,
  deployment_name text NOT NULL,
  url             text,
  export_sha256   text NOT NULL,
  status          text NOT NULL CHECK (status IN ('deploying','live','verify_failed','removed','removed_unconfirmed','failed')),
  verified_at     timestamptz,
  last_error      text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS growth_hosted_deployments_tenant_page_key
  ON public.growth_hosted_deployments (tenant_id, page_id);

CREATE INDEX IF NOT EXISTS growth_hosted_deployments_tenant_idx
  ON public.growth_hosted_deployments (tenant_id);

ALTER TABLE public.growth_hosted_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_hosted_deployments FORCE ROW LEVEL SECURITY;
-- Deliberately NO policies: with FORCE RLS and no policies, every non-service role is
-- denied by default; only the door's service-role client writes.

-- ── Autonomy catalogue ────────────────────────────────────────────────────────────────────────
-- The two hosting acts are governed tools: the operator must be able to SEE them and turn them
-- off. This appends them to the ONE catalogue the same way every lane does (guarded wrapper over
-- the incumbent), retaining every prior row, scope check and stored mode. Both keys are `high` in
-- action-risk.ts, so the lane clamps to confirm: `auto` never runs one unattended, `off` disables.
--
-- GUARDED exactly like the EXP08 catalogue chain (20271116100008): md5 'a58337ca9887626d3d5cbeb223f7c28b'
-- is the EXP08 team-lifecycle wrapper read from production 2026-10-28 (the applied chain tip); a
-- different incumbent (another catalogue migration landing first) REFUSES rather than being quietly
-- wrapped. On a replay the predecessor already exists and the guard passes through.
DO $guard$
DECLARE _current text := CASE WHEN to_regprocedure('public.list_tool_autonomy(uuid)') IS NULL THEN NULL
  ELSE md5(pg_get_functiondef(to_regprocedure('public.list_tool_autonomy(uuid)'))) END;
BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_growth_hosting(uuid)') IS NOT NULL THEN
  NULL; -- replay: this file's wrapper is already the composed incumbent's predecessor
 ELSIF _current IS DISTINCT FROM 'a58337ca9887626d3d5cbeb223f7c28b' THEN
  RAISE EXCEPTION 'Autonomy catalogue changed after the EXP08 team-lifecycle rows; compose and review before applying (current md5: %)', _current;
 ELSE
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_growth_hosting;
 END IF;
END $guard$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_growth_hosting(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_growth_hosting(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE _tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_growth_hosting(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('growth_hosting_deploy','Put a hosted copy of a published page online','Studio'),
  ('growth_hosting_recover','Take a hosted copy down','Studio')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
   FROM catalog c LEFT JOIN public.tenant_tool_autonomy a
    ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
