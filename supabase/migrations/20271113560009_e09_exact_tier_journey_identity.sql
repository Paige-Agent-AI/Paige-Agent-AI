-- EXP09 compatibility: original tier source selects its exact canonical client.
-- No financial writer, payment inference, new trigger, grant or identity activation.
BEGIN;
DO $lease$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_proc p
  WHERE p.oid=pg_catalog.to_regprocedure('public.auto_advance_journey_on_tier()')
    AND pg_catalog.md5(p.prosrc)='5c2991f867ebd18fdd0805259e23aced'
    AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
    AND p.pronargs=0 AND p.prosecdef AND p.provolatile='v'
    AND pg_catalog.pg_get_function_result(p.oid)='trigger'
    AND p.proconfig=ARRAY['search_path=public']
    AND (SELECT array_agg(pg_catalog.pg_get_userbyid(a.grantee)||':'||a.privilege_type||':'||a.is_grantable::text ORDER BY pg_catalog.pg_get_userbyid(a.grantee)) FROM pg_catalog.aclexplode(p.proacl) a)=ARRAY['postgres:EXECUTE:false','service_role:EXECUTE:false']
 ) THEN
  RAISE EXCEPTION 'Original tier journey source/authority changed; reconcile' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_trigger
  WHERE tgrelid='public.tier_state'::regclass AND tgname='trg_auto_advance_journey'
    AND tgfoid='public.auto_advance_journey_on_tier()'::regprocedure
    AND tgenabled='O'
    AND pg_catalog.pg_get_triggerdef(oid)='CREATE TRIGGER trg_auto_advance_journey AFTER INSERT OR UPDATE OF tier ON public.tier_state FOR EACH ROW EXECUTE FUNCTION auto_advance_journey_on_tier()'
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_constraint
  WHERE conrelid='public.tier_state'::regclass AND confrelid='public.clients'::regclass AND contype='f'
    AND confdeltype='n' AND convalidated
    AND confkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid='public.clients'::regclass AND attname='id')]::smallint[]
    AND conkey=ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid='public.tier_state'::regclass AND attname='client_id')]::smallint[]
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_index
  WHERE indexrelid=pg_catalog.to_regclass('public.clients_linked_user_id_unique') AND indisunique AND indisvalid
    AND pg_catalog.pg_get_indexdef(indexrelid)='CREATE UNIQUE INDEX clients_linked_user_id_unique ON public.clients USING btree (linked_user_id) WHERE (linked_user_id IS NOT NULL)'
 ) OR NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_index
  WHERE indexrelid=pg_catalog.to_regclass('public.clients_tenant_linked_user_key') AND indisunique AND indisvalid
    AND pg_catalog.pg_get_indexdef(indexrelid)='CREATE UNIQUE INDEX clients_tenant_linked_user_key ON public.clients USING btree (tenant_id, linked_user_id)'
 ) THEN
  RAISE EXCEPTION 'Original tier identity/trigger contract changed; reconcile' USING ERRCODE='42501';
 END IF;
END $lease$;

CREATE OR REPLACE FUNCTION public.auto_advance_journey_on_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _client_id     uuid;
  _current_id    integer;
  _current_slug  text;
  _client_tenant uuid;
  _new_tier      text;
  _paid_id       integer;
  _paid_order    integer;
  _current_order integer;
BEGIN
  _new_tier := lower(COALESCE(NEW.tier, ''));
  IF _new_tier NOT IN ('standard','premium','vip') THEN
    RETURN NEW;
  END IF;

  SELECT id, journey_stage_id, journey_stage_slug, tenant_id
    INTO _client_id, _current_id, _current_slug, _client_tenant
    FROM public.clients
   WHERE linked_user_id = NEW.user_id
     AND (NEW.client_id IS NULL OR id = NEW.client_id)
     AND (NEW.client_id IS NOT NULL OR NOT EXISTS (
       SELECT 1 FROM public.clients other_client
        WHERE other_client.linked_user_id = NEW.user_id
          AND other_client.id <> clients.id
     ))
   ORDER BY created_at ASC
   LIMIT 1;

  IF _client_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- §2 tenant-safety: the funding-tier -> 'paid_tier' auto-advance is a legacy
  -- behavior of the GLOBAL default journey only. A tenant that authored its own
  -- journey (installed a Blueprint) owns its pipeline — never yank its client
  -- into the global finance 'paid_tier' stage. Skip auto-advance for them.
  IF EXISTS (
    SELECT 1 FROM public.tenant_journey_stages
     WHERE tenant_id = _client_tenant
  ) THEN
    RETURN NEW;
  END IF;

  -- Resolve the global 'paid_tier' default. If absent (a tenant-only journey
  -- with no paid_tier), there is nothing to advance to — degrade gracefully.
  SELECT id, display_order INTO _paid_id, _paid_order
    FROM public.paige_journey_stages
   WHERE slug = 'paid_tier';
  IF _paid_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Current rank: by slug's global display_order when resolvable, else the
  -- legacy int id (un-migrated rows). id===display_order for the global seeds.
  SELECT display_order INTO _current_order
    FROM public.paige_journey_stages
   WHERE slug = _current_slug;
  IF _current_order IS NULL THEN
    _current_order := COALESCE(_current_id, 0);
  END IF;

  IF _current_slug IS DISTINCT FROM 'paid_tier'
     AND COALESCE(_current_order, 0) < _paid_order THEN
    UPDATE public.clients
       SET journey_stage_slug     = 'paid_tier',
           journey_stage_id       = _paid_id,
           journey_stage_entered_at = now()
     WHERE id = _client_id;

    INSERT INTO public.paige_journey_stage_transitions
      (contact_id, from_stage_id, to_stage_id, from_stage_slug, to_stage_slug,
       source_event, metadata)
    VALUES
      (_client_id, _current_id, _paid_id, _current_slug, 'paid_tier',
       'tier_upgrade', jsonb_build_object('tier', _new_tier));
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'auto_advance_journey_on_tier failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

COMMIT;
