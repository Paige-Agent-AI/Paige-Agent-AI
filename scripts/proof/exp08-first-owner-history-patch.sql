-- UNVERSIONED I2 component candidate; NOT a deployable migration or released invitation gate.
-- Original approved co-owner contract §5.4b. Run only in the original disposable native proof.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS first_owner_seated_at timestamptz;

-- Audit is a one-time historical input, never the runtime authority source. The injected parent
-- owner correction is intentionally absent: it does not establish the child's own ownership.
WITH history AS (
  SELECT t.id, min(e.at) AS first_at
  FROM public.tenants t
  CROSS JOIN LATERAL (
    SELECT a.created_at AS at FROM public.paige_audit_log a
    WHERE a.tenant_id=t.id AND a.action IN (
      'tenant:subaccount_owner_established','tenant:grant_co_owner','tenant:revoke_co_owner',
      'tenant:backfill_owner','tenant:fix_owner_user_id','tenant:owner_holder_restored')
    UNION ALL
    SELECT t.created_at WHERE t.owner_user_id IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=t.id
      AND (m.is_owner OR m.role='owner'::public.tenant_role))
  ) e GROUP BY t.id
)
UPDATE public.tenants t SET first_owner_seated_at=h.first_at
FROM history h WHERE h.id=t.id AND t.first_owner_seated_at IS NULL AND h.first_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public._tenant_never_owned(_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=_tenant
    AND t.owner_user_id IS NULL AND t.first_owner_seated_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id=t.id
      AND (m.is_owner OR m.role='owner'::public.tenant_role)))
$$;
REVOKE ALL ON FUNCTION public._tenant_never_owned(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._tenant_first_owner_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.is_owner OR NEW.role='owner'::public.tenant_role THEN
    UPDATE public.tenants SET first_owner_seated_at=now()
      WHERE id=NEW.tenant_id AND first_owner_seated_at IS NULL;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public._tenant_first_owner_history() FROM PUBLIC,anon,authenticated,service_role;
-- INVOKER is essential here: a definer guard would turn every direct table caller into postgres.
-- Original private member trigger/migration writes run as postgres; table access alone must not
-- manufacture history. Existing non-null history is immutable even to those original writers.
CREATE OR REPLACE FUNCTION public._tenant_first_owner_history_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.first_owner_seated_at IS NOT NULL
       AND NEW.first_owner_seated_at IS DISTINCT FROM OLD.first_owner_seated_at THEN
      RAISE EXCEPTION 'The first owner history cannot be changed.' USING ERRCODE='42501';
    END IF;
    IF NEW.first_owner_seated_at IS NOT DISTINCT FROM OLD.first_owner_seated_at THEN RETURN NEW; END IF;
  END IF;
  IF NEW.first_owner_seated_at IS NOT NULL AND current_user<>'postgres' THEN
    RAISE EXCEPTION 'Owner history is recorded only by the original ownership writer.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public._tenant_first_owner_history_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_tenant_first_owner_history ON public.tenant_members;
CREATE TRIGGER trg_tenant_first_owner_history AFTER INSERT OR UPDATE OF is_owner,role,tenant_id
  ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public._tenant_first_owner_history();
DROP TRIGGER IF EXISTS trg_tenant_first_owner_history_immutable ON public.tenants;
CREATE TRIGGER trg_tenant_first_owner_history_immutable BEFORE INSERT OR UPDATE OF first_owner_seated_at
  ON public.tenants FOR EACH ROW EXECUTE FUNCTION public._tenant_first_owner_history_guard();
