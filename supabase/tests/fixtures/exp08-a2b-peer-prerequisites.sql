-- Synthetic extension of the original EXP08 A2b disposable schema only.
-- Original Sales actor body is copied exactly from the existing E04 proof and MD5-checked;
-- no provider, domain writer, authenticated customer or full-schema proof is represented.
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS banned_until timestamptz;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
CREATE TABLE IF NOT EXISTS public.paige_agreements(id uuid PRIMARY KEY,tenant_id uuid);
CREATE OR REPLACE FUNCTION public._sales_invoice_actor(_actor uuid,_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE active_tenant uuid;
BEGIN
  PERFORM 1 FROM auth.users WHERE id=_actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice actor unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenants WHERE id=_tenant AND status IN ('trial','active','past_due') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice workspace unavailable' USING ERRCODE='42501'; END IF;
  SELECT active_tenant_id INTO active_tenant FROM public.profiles WHERE user_id=_actor FOR UPDATE;
  IF NOT FOUND OR active_tenant IS DISTINCT FROM _tenant THEN RAISE EXCEPTION 'Active invoice workspace changed' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenant_members WHERE user_id=_actor AND tenant_id=_tenant AND status='active' AND role IN ('owner','admin') FOR UPDATE;
  IF NOT FOUND OR _actor IS NULL OR _tenant IS NULL THEN RAISE EXCEPTION 'Invoice workspace or authority unavailable' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public._sales_invoice_actor(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._sales_invoice_actor(uuid,uuid) TO service_role;
SELECT pg_temp.check((SELECT md5(prosrc)='27202521ef9750d3246ee5e5e11018aa' FROM pg_proc
 WHERE oid='public._sales_invoice_actor(uuid,uuid)'::regprocedure),'original Sales actor exact production body');
\ir ../../migrations/20271122080004_e04_team_hub_source_reads.sql
\ir ../../migrations/20271122080005_e04_team_hub_read_access.sql
\ir ../../migrations/20271122070008_exp10_nexus_team_hub_connection_read.sql
