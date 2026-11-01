-- UNVERSIONED I2 component candidate; NOT a deployable migration or released invitation gate.
-- Original approved co-owner contract §5.4b. Run only in the original disposable native proof.
-- IF NOT EXISTS alone admits a previously installed, incompatible column. Freeze its catalogue
-- shape through admission and the backfill; a default/generated value must never invent history.
LOCK TABLE public.tenants IN ACCESS EXCLUSIVE MODE;
-- Fresh installation or exact replay only. Never silently overwrite an unrelated existing
-- private helper or hide an unexpected client grant. Fingerprints normalize CRLF to LF only.
DO $history_helpers$
DECLARE expected record; existing pg_catalog.pg_proc;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('public._tenant_never_owned(uuid)','8520cdcdb9e04d7277b07e65204b8edd','sql','s',true,'boolean','_tenant uuid'),
    ('public._tenant_first_owner_history()','df738008d6fb12216f0eed70fbe3fe2e','plpgsql','v',true,'trigger',''),
    ('public._tenant_first_owner_history_guard()','42a4b780d7d787926bf8f8c04b196b43','plpgsql','v',false,'trigger',''))
    AS helpers(signature,body_hash,language_name,volatility,definer,return_name,arguments) LOOP
    SELECT * INTO existing FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(expected.signature);
    IF NOT FOUND THEN CONTINUE; END IF;
    IF md5(replace(existing.prosrc,E'\r\n',E'\n'))<>expected.body_hash
      OR existing.proowner<>'postgres'::regrole OR existing.prosecdef<>expected.definer
      OR existing.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname=expected.language_name)
      OR existing.provolatile::text<>expected.volatility OR existing.prokind<>'f'
      OR existing.proisstrict OR existing.proleakproof OR existing.proparallel<>'u' OR existing.proretset
      OR existing.prorettype<>pg_catalog.to_regtype(expected.return_name)
      OR pg_catalog.pg_get_function_arguments(existing.oid) IS DISTINCT FROM expected.arguments
      OR existing.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(existing.proacl,pg_catalog.acldefault('f',existing.proowner))) a
        WHERE a.grantee<>'postgres'::regrole OR a.grantor<>'postgres'::regrole
          OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
      RAISE EXCEPTION 'EXP08 first owner history helper drift: %',expected.signature;
    END IF;
  END LOOP;
END
$history_helpers$;
-- Admit exact incumbent triggers BEFORE backfill can fire any installed code.
DO $history_triggers$
DECLARE expected record; tr pg_catalog.pg_trigger; attributes text; attribute_count integer;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.tenant_members'::regclass,'trg_tenant_first_owner_history',
   'public._tenant_first_owner_history()',21,ARRAY['is_owner','role','tenant_id']::text[]),
  ('public.tenants'::regclass,'trg_tenant_first_owner_history_immutable',
   'public._tenant_first_owner_history_guard()',23,ARRAY['first_owner_seated_at']::text[])
 ) v(target,trigger_name,signature,trigger_type,columns) LOOP
  SELECT * INTO tr FROM pg_catalog.pg_trigger WHERE tgrelid=expected.target AND tgname=expected.trigger_name;
  IF NOT FOUND THEN CONTINUE; END IF;
  SELECT string_agg(a.attnum::text,' ' ORDER BY c.position),count(*) INTO attributes,attribute_count
   FROM unnest(expected.columns) WITH ORDINALITY c(name,position)
   JOIN pg_catalog.pg_attribute a ON a.attrelid=expected.target AND a.attname=c.name AND a.attnum>0 AND NOT a.attisdropped;
  IF tr.tgfoid IS DISTINCT FROM pg_catalog.to_regprocedure(expected.signature)
   OR tr.tgtype IS DISTINCT FROM expected.trigger_type::smallint OR tr.tgenabled IS DISTINCT FROM 'O'::"char"
   OR tr.tgisinternal OR tr.tgparentid<>0 OR tr.tgnargs<>0 OR tr.tgqual IS NOT NULL
   OR tr.tgargs IS DISTINCT FROM ''::bytea OR tr.tgconstraint<>0 OR tr.tgconstrrelid<>0 OR tr.tgconstrindid<>0
   OR tr.tgdeferrable OR tr.tginitdeferred OR tr.tgoldtable IS NOT NULL OR tr.tgnewtable IS NOT NULL
   OR attribute_count<>cardinality(expected.columns) OR tr.tgattr::text IS DISTINCT FROM attributes THEN
   RAISE EXCEPTION 'EXP08 first owner history trigger drift: %',expected.trigger_name;
  END IF;
 END LOOP;
END
$history_triggers$;

DO $history_column$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='public.tenants'::regclass AND a.attname='first_owner_seated_at'
      AND NOT a.attisdropped
      AND (a.atttypid<>'pg_catalog.timestamptz'::regtype OR a.atttypmod<>-1
        OR a.attnotnull OR a.atthasdef OR a.attidentity<>'' OR a.attgenerated<>'')) THEN
    RAISE EXCEPTION 'EXP08 first owner history column drift';
  END IF;
END
$history_column$;
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
-- Exact replay retains the original trigger objects and their complete metadata.
DO $history_trigger_install$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.tenant_members'::regclass
  AND tgname='trg_tenant_first_owner_history') THEN
  CREATE TRIGGER trg_tenant_first_owner_history AFTER INSERT OR UPDATE OF is_owner,role,tenant_id
   ON public.tenant_members FOR EACH ROW EXECUTE FUNCTION public._tenant_first_owner_history();
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='public.tenants'::regclass
  AND tgname='trg_tenant_first_owner_history_immutable') THEN
  CREATE TRIGGER trg_tenant_first_owner_history_immutable BEFORE INSERT OR UPDATE OF first_owner_seated_at
   ON public.tenants FOR EACH ROW EXECUTE FUNCTION public._tenant_first_owner_history_guard();
 END IF;
END
$history_trigger_install$;
-- Admit exact incumbent triggers BEFORE backfill can fire any installed code.
DO $history_triggers$
DECLARE expected record; tr pg_catalog.pg_trigger; attributes text; attribute_count integer;
BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('public.tenant_members'::regclass,'trg_tenant_first_owner_history',
   'public._tenant_first_owner_history()',21,ARRAY['is_owner','role','tenant_id']::text[]),
  ('public.tenants'::regclass,'trg_tenant_first_owner_history_immutable',
   'public._tenant_first_owner_history_guard()',23,ARRAY['first_owner_seated_at']::text[])
 ) v(target,trigger_name,signature,trigger_type,columns) LOOP
  SELECT * INTO tr FROM pg_catalog.pg_trigger WHERE tgrelid=expected.target AND tgname=expected.trigger_name;
  IF NOT FOUND THEN CONTINUE; END IF;
  SELECT string_agg(a.attnum::text,' ' ORDER BY c.position),count(*) INTO attributes,attribute_count
   FROM unnest(expected.columns) WITH ORDINALITY c(name,position)
   JOIN pg_catalog.pg_attribute a ON a.attrelid=expected.target AND a.attname=c.name AND a.attnum>0 AND NOT a.attisdropped;
  IF tr.tgfoid IS DISTINCT FROM pg_catalog.to_regprocedure(expected.signature)
   OR tr.tgtype IS DISTINCT FROM expected.trigger_type::smallint OR tr.tgenabled IS DISTINCT FROM 'O'::"char"
   OR tr.tgisinternal OR tr.tgparentid<>0 OR tr.tgnargs<>0 OR tr.tgqual IS NOT NULL
   OR tr.tgargs IS DISTINCT FROM ''::bytea OR tr.tgconstraint<>0 OR tr.tgconstrrelid<>0 OR tr.tgconstrindid<>0
   OR tr.tgdeferrable OR tr.tginitdeferred OR tr.tgoldtable IS NOT NULL OR tr.tgnewtable IS NOT NULL
   OR attribute_count<>cardinality(expected.columns) OR tr.tgattr::text IS DISTINCT FROM attributes THEN
   RAISE EXCEPTION 'EXP08 first owner history trigger drift: %',expected.trigger_name;
  END IF;
 END LOOP;
END
$history_triggers$;
