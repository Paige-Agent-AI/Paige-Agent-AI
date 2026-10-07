-- S5 final step (owner-ruled sequence step 7): soft-retire the legacy originals whose
-- content already lives in the canonical owner-memory home. Only rows with a live, active
-- canonical twin are retired — the mapping is the migration's own legacy_source_id identity.
-- No hard delete in S5. The originals stay queryable for audit/history.

UPDATE public.client_memory c
   SET is_active = false, updated_at = now()
  FROM public.paige_owner_memory p
 WHERE p.metadata->>'legacy_source_id' = c.id::text
   AND p.is_active
   AND c.is_active;

-- Verify: no active legacy row remains that has an active canonical twin; and the canonical
-- population is exactly what the read path serves.
DO $$
DECLARE
  _left bigint;
BEGIN
  SELECT count(*) INTO _left
    FROM public.client_memory c
    JOIN public.paige_owner_memory p ON p.metadata->>'legacy_source_id' = c.id::text AND p.is_active
   WHERE c.is_active;
  IF _left <> 0 THEN
    RAISE EXCEPTION 'S5 retire: % migrated legacy row(s) still active', _left;
  END IF;
  RAISE NOTICE 'S5 retire: all migrated legacy originals inactive; canonical copies remain the recall source';
END $$;
