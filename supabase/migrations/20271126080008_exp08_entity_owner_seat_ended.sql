-- EXP08 original co-owner contract I2, R6/R11: a departing representative leaves a held seat.
-- UNRELEASED: only disposable proofs; managed publication follows EXP08 40008 and EXP05 Task 50005.
-- This changes only the existing legal-owner metadata after an already-authorized seat write.
-- No ownership decision, authority grant, new owner record, provider or notification.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $guard$
DECLARE f pg_proc; expected record;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('public._business_owner_seat_ended()','75d4a8e014e495c5e0a819881b6a79bd'),
    ('public._business_owner_representative_deleted()','f95cbff2d3f69c274b287ef0b9bc0067')) v(signature,body_hash) LOOP
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure(expected.signature);
  IF FOUND AND (md5(f.prosrc)<>expected.body_hash OR NOT f.prosecdef
      OR f.proowner<>'postgres'::regrole OR f.provolatile<>'v'
      OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
        WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE')) THEN
    RAISE EXCEPTION 'EXP08 entity seat lifecycle already exists; reconcile its source before applying';
  END IF;
  END LOOP;
  SELECT * INTO f FROM pg_proc WHERE oid=to_regprocedure('public._solo_shell_tenant(uuid)');
  IF NOT FOUND OR md5(f.prosrc)<>'9ade6efeff0689b78ff57b116a28c9d4' OR NOT f.prosecdef
    OR f.proowner<>'postgres'::regrole OR f.provolatile<>'s'
    OR f.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
    OR EXISTS (SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
      WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE') THEN
    RAISE EXCEPTION 'EXP08 entity seat lifecycle requires the original Solo scope helper';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='tenant_business_owners' AND column_name='owner_seat_vacant_since'
      AND data_type='timestamp with time zone')
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='tenant_members' AND column_name='business_owner_id' AND data_type='uuid') THEN
    RAISE EXCEPTION 'EXP08 entity seat lifecycle requires original owner-invitation storage';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a
      ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
      WHERE c.conrelid='public.tenant_business_owners'::regclass AND c.contype='f'
      AND c.confrelid='auth.users'::regclass AND c.confdeltype='n'
      AND a.attname='representative_user_id' AND cardinality(c.conkey)=1) THEN
    RAISE EXCEPTION 'EXP08 entity seat lifecycle requires the original representative deletion reference';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public._business_owner_seat_ended()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public._solo_shell_tenant(OLD.tenant_id) IS DISTINCT FROM true THEN RETURN NULL; END IF;
  IF NOT OLD.is_owner OR OLD.business_owner_id IS NULL THEN RETURN NULL; END IF;
  -- Billing suspension does not end ownership or appoint a replacement (R13).
  -- Work-profile/status updates on the same original owner link do not make it vacant.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id = OLD.tenant_id AND NEW.user_id = OLD.user_id
      AND NEW.is_owner AND NEW.business_owner_id IS NOT DISTINCT FROM OLD.business_owner_id THEN
      RETURN NULL;
    END IF;
  END IF;
  -- Recheck the exact old person/link while acquiring the row lock. A replacement already
  -- recorded by an original writer is never cleared by a late old-seat event.
  UPDATE public.tenant_business_owners AS bo
    SET representative_user_id = NULL,
        owner_seat_vacant_since = coalesce(bo.owner_seat_vacant_since, now()),
        updated_at = now()
    WHERE bo.tenant_id = OLD.tenant_id AND bo.id = OLD.business_owner_id
      AND bo.representative_user_id = OLD.user_id;
  RETURN NULL;
END $$;
ALTER FUNCTION public._business_owner_seat_ended() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._business_owner_seat_ended() FROM PUBLIC, anon, authenticated, service_role;

-- The existing Auth FK can clear the person BEFORE a later seat DELETE. This is a trigger on
-- our original owner record, not a new Auth writer/trigger. Never stamp a merely named contact
-- who had no owner seat, and never treat a living person's ordinary edit as account deletion.
CREATE OR REPLACE FUNCTION public._business_owner_representative_deleted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public._solo_shell_tenant(OLD.tenant_id) IS DISTINCT FROM true THEN RETURN NEW; END IF;
  IF OLD.representative_user_id IS NOT NULL AND NEW.representative_user_id IS NULL
    AND NEW.id = OLD.id AND NEW.tenant_id = OLD.tenant_id
    AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.representative_user_id)
    AND EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = OLD.tenant_id
      AND m.user_id = OLD.representative_user_id AND m.business_owner_id = OLD.id AND m.is_owner) THEN
    NEW.owner_seat_vacant_since := coalesce(OLD.owner_seat_vacant_since, now());
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public._business_owner_representative_deleted() OWNER TO postgres;
REVOKE ALL ON FUNCTION public._business_owner_representative_deleted() FROM PUBLIC, anon, authenticated, service_role;
DO $trigger$
DECLARE t pg_trigger; columns text[];
BEGIN
  SELECT * INTO t FROM pg_trigger WHERE tgrelid='public.tenant_members'::regclass
    AND tgname='trg_tenant_members_business_owner_seat_ended';
  IF FOUND THEN
    SELECT array_agg(a.attname::text ORDER BY a.attname) INTO columns FROM pg_attribute a
      WHERE a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr::smallint[]);
    IF t.tgfoid<>'public._business_owner_seat_ended()'::regprocedure OR t.tgtype<>25
      OR t.tgenabled<>'O' OR t.tgisinternal OR t.tgnargs<>0 OR t.tgqual IS NOT NULL OR t.tgconstraint<>0
      OR columns IS DISTINCT FROM ARRAY['business_owner_id','is_owner','status','tenant_id','user_id']::text[] THEN
      RAISE EXCEPTION 'EXP08 entity seat lifecycle trigger drift; reconcile before applying';
    END IF;
  ELSE
    CREATE TRIGGER trg_tenant_members_business_owner_seat_ended
      AFTER DELETE OR UPDATE OF is_owner, business_owner_id, status, user_id, tenant_id
      ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public._business_owner_seat_ended();
  END IF;
END $trigger$;
DO $trigger$
DECLARE t pg_trigger; columns text[];
BEGIN
  SELECT * INTO t FROM pg_trigger WHERE tgrelid='public.tenant_business_owners'::regclass
    AND tgname='trg_business_owner_representative_deleted';
  IF FOUND THEN
    SELECT array_agg(a.attname::text ORDER BY a.attname) INTO columns FROM pg_attribute a
      WHERE a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr::smallint[]);
    IF t.tgfoid<>'public._business_owner_representative_deleted()'::regprocedure OR t.tgtype<>19
      OR t.tgenabled<>'O' OR t.tgisinternal OR t.tgnargs<>0 OR t.tgqual IS NOT NULL OR t.tgconstraint<>0
      OR columns IS DISTINCT FROM ARRAY['representative_user_id']::text[] THEN
      RAISE EXCEPTION 'EXP08 entity seat lifecycle trigger drift; reconcile before applying';
    END IF;
  ELSE
    CREATE TRIGGER trg_business_owner_representative_deleted BEFORE UPDATE OF representative_user_id
      ON public.tenant_business_owners FOR EACH ROW EXECUTE FUNCTION public._business_owner_representative_deleted();
  END IF;
END $trigger$;
COMMENT ON FUNCTION public._business_owner_seat_ended() IS
  'EXP08 R6/R11: an ended representative seat leaves the existing legal owner held; no inheritance or authority change. Billing suspension retains representation.';
COMMIT;
