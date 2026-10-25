-- Original Systems run purpose only. No caller, role, grant, RLS, executor,
-- schedule or capability activation. Existing three purposes stay compatible.
DO $purpose$
DECLARE prior text; prior_timeout text:=pg_catalog.current_setting('lock_timeout');
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout','3s',true);
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO prior
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid='public.paige_systems_check_run'::regclass
      AND c.conname='paige_systems_check_run_scan_flavor_check';
  IF prior IS DISTINCT FROM
    'CHECK ((scan_flavor = ANY (ARRAY[''onboarding''::text, ''scheduled''::text, ''change_triggered''::text])))' THEN
    RAISE EXCEPTION 'Original Systems purpose constraint changed; reconcile source first';
  END IF;
  -- One atomic statement, including when the migration is run inside an outer
  -- transaction. A mismatch or failed validation leaves the old constraint intact.
  ALTER TABLE public.paige_systems_check_run
    DROP CONSTRAINT paige_systems_check_run_scan_flavor_check;
  ALTER TABLE public.paige_systems_check_run
    ADD CONSTRAINT paige_systems_check_run_scan_flavor_check
      CHECK (scan_flavor IN ('onboarding','scheduled','change_triggered','manual')),
    ADD CONSTRAINT paige_systems_check_run_manual_capture_check
      CHECK (scan_flavor <> 'manual' OR (
        tenant_id IS NOT NULL
        AND coalesce(triggered_by->>'scope'='tenant',false)
        AND coalesce(triggered_by->>'action_filing'='none',false)
      ));
  COMMENT ON CONSTRAINT paige_systems_check_run_manual_capture_check
    ON public.paige_systems_check_run IS
    'An internal manual purpose captures tenant evidence without automatic remediation. It is not actor authority, a Work claim, persistence or repair proof, or permission to retry.';
  PERFORM pg_catalog.set_config('lock_timeout',prior_timeout,true);
END $purpose$;
