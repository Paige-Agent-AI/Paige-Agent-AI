-- GENERATED original EXP08 full-schema proof. Edit the template/canonical scripts, then run exp08-first-owner-native-proof.mjs --write.
-- Original I2 first-owner history/invitation composition, full replayed schema.
-- Synthetic records in ONE rollback only; no email, customer account or Auth SDK proof.
BEGIN;
SELECT plan(32);
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES
 ('e8c00000-0000-4000-8000-000000000001','authenticated','authenticated','e8-history-operator@tests.invalid',now()),
 ('e8c00000-0000-4000-8000-000000000002','authenticated','authenticated','e8-history-former@tests.invalid',now()),
 ('e8c00000-0000-4000-8000-000000000003','authenticated','authenticated','e8-history-first@tests.invalid',now()),
 ('e8c00000-0000-4000-8000-000000000004','authenticated','authenticated','e8-history-other@tests.invalid',now());
INSERT INTO public.user_roles(user_id,role) VALUES('e8c00000-0000-4000-8000-000000000001','super_admin') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(user_id) VALUES
 ('e8c00000-0000-4000-8000-000000000001'),('e8c00000-0000-4000-8000-000000000002'),
 ('e8c00000-0000-4000-8000-000000000003'),('e8c00000-0000-4000-8000-000000000004') ON CONFLICT(user_id) DO NOTHING;
INSERT INTO public.tenants(id,slug,name,account_type,created_at) VALUES
 ('e8c00000-0000-4000-8000-000000000010','test-e8-history-a','History native A','standalone','2020-01-01Z'),
 ('e8c00000-0000-4000-8000-000000000011','test-e8-history-b','History native B','standalone','2020-01-01Z'),
 ('e8c00000-0000-4000-8000-000000000012','test-e8-history-c','History native C','standalone','2020-01-01Z'),
 ('e8c00000-0000-4000-8000-000000000013','test-e8-history-d','History native D','standalone','2020-01-01Z');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('e8c00000-0000-4000-8000-000000000010','e8c00000-0000-4000-8000-000000000002','owner','active',true);
INSERT INTO public.paige_audit_log(actor_user_id,actor_role,action,target_type,target_id,tenant_id,payload,created_at) VALUES
 ('e8c00000-0000-4000-8000-000000000001','super_admin','tenant:grant_co_owner','user','e8c00000-0000-4000-8000-000000000002','e8c00000-0000-4000-8000-000000000012','{}','2022-01-01Z'),
 ('e8c00000-0000-4000-8000-000000000001','super_admin','tenant:deleted_injected_owner','user','e8c00000-0000-4000-8000-000000000002','e8c00000-0000-4000-8000-000000000013','{}','2019-01-01Z');
CREATE TEMP TABLE exp08_history_tokens(label text PRIMARY KEY,token text NOT NULL);
GRANT SELECT,INSERT ON exp08_history_tokens TO authenticated;
CREATE TEMP TABLE exp08_history_writer_metadata AS SELECT oid,to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p
 WHERE oid=ANY(ARRAY[to_regprocedure('public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text)'),to_regprocedure('public.accept_tenant_invite(text)')]);
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text)'::regprocedure),
 'a42d7b2852daf7dcd3e108f0eb588679','actual original mint matches the guarded source prerequisite');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.accept_tenant_invite(text)'::regprocedure),
 '0194a076acce065d23de842cab9b6d29','actual original accept preserves the current original customer/recipient branches');
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO exp08_history_tokens SELECT 'historical',
 (public.create_tenant_invite_token('e8c00000-0000-4000-8000-000000000010','subaccount_owner','admin',7,1,NULL,'e8-history-first@tests.invalid')).token;
SELECT ok(EXISTS(SELECT 1 FROM exp08_history_tokens WHERE label='historical'),
 'before the candidate the actual original platform door can mint on an already-owned business');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
-- Existing inert original candidates only; every DDL and fixture change rolls back.
-- ORIGINAL INERT COMPONENT exp08-first-owner-history-patch.sql canonical-LF SHA256 805cd576608daf5a1c9d0783ccab17ba5259e86456c1dc098f31caf15c1fead2
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

-- END ORIGINAL INERT COMPONENT exp08-first-owner-history-patch.sql
-- ORIGINAL INERT COMPONENT exp08-first-owner-invitation-patch.sql canonical-LF SHA256 5d92784bfb99eaaa38a2504bbb5c60732afc1f90f76e337dc213b2479ec7a86c
-- UNVERSIONED I2 component. Original mint/accept only; no deployment/native slot/activation.
-- Preserve the entire incumbent including E09 consumer/recipient/contact protections.
DO $patch$
DECLARE sig text; expected text; original text; replacement text; old_body text; new_body text;
  definition text; before_metadata jsonb; after_metadata jsonb; target oid;
  inverse_body text;
  declaration_before constant text:=E'\nDECLARE\n';
  declaration_after constant text:=E'\nDECLARE\n  _exp08_never_owned boolean;\n';
  mint_tail_before constant text:=$before$
  RETURN _row;
END$before$;
  mint_tail_after constant text:=$after$
  -- EXP08_FIRST_OWNER_FINAL_MINT_V1: the original INSERT can wait after admission.
  IF _kind='subaccount_owner' THEN
    IF NOT (public.is_platform_owner() OR public.agency_can_manage_child(_tenant_id,auth.uid())) THEN
      RAISE EXCEPTION 'This invitation can''t be created because your access has changed. Nothing changed.'
        USING ERRCODE='42501',HINT='OWNER_INVITE_AUTHORITY_CHANGED';
    END IF;
    IF public._solo_shell_tenant(_tenant_id) AND public.is_platform_owner()
       AND NOT public.agency_can_manage_child(_tenant_id,auth.uid())
       AND NOT public._tenant_never_owned(_tenant_id) THEN
      RAISE EXCEPTION '% has had an owner, so a new owner can only be added by its account holder or through owner recovery. Nothing changed.',
        (SELECT COALESCE(NULLIF(btrim(name),''),'This business') FROM public.tenants WHERE id=_tenant_id)
        USING ERRCODE='42501',HINT='OWNER_HISTORY_REQUIRES_RECOVERY';
    END IF;
  END IF;
  RETURN _row;
END$after$;
  tail_before constant text:=$before$
  RETURN _tok.tenant_id;
END$before$;
  tail_after constant text:=$after$
  -- EXP08_FIRST_OWNER_FINAL_EXPIRY_V1: all original writes are transactional; a late refusal
  -- rolls back seat, pointer, profile, token and audit together, including waits after admission.
  IF _tok.kind='subaccount_owner' AND _tok.expires_at<=pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'invite has expired' USING ERRCODE='42501',HINT='OWNER_INVITE_EXPIRED';
  END IF;
  IF _tok.kind='subaccount_owner' THEN
    IF _minter_ok AND NOT (public.is_platform_owner(_tok.created_by)
       OR public.agency_can_manage_child(_tok.tenant_id, _tok.created_by)) THEN
      RAISE EXCEPTION 'This invitation can''t be used because its sender''s access has changed. Ask for a new invitation.'
        USING ERRCODE='42501',HINT='OWNER_INVITE_AUTHORITY_CHANGED';
    END IF;
    -- Reuse the pre-effect history fact: our own legitimate first-owner writes now make the
    -- current predicate false. Current minter authority must not revive an agency exception.
    IF public._solo_shell_tenant(_tok.tenant_id) AND public.is_platform_owner(_tok.created_by)
       AND NOT public.agency_can_manage_child(_tok.tenant_id, _tok.created_by)
       AND NOT _exp08_never_owned THEN
      RAISE EXCEPTION 'This invitation can''t be used. Owners of % are added by its account holder. Ask them for a new invitation.',
        (SELECT COALESCE(NULLIF(btrim(name),''),'this business') FROM public.tenants WHERE id=_tok.tenant_id)
        USING ERRCODE='42501',HINT='OWNER_HISTORY_REQUIRES_RECOVERY';
    END IF;
  END IF;
  RETURN _tok.tenant_id;
END$after$;
BEGIN
  FOR sig,expected,original,replacement IN SELECT * FROM (VALUES
    ('public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text)',
     'a42d7b2852daf7dcd3e108f0eb588679',
     $before$  IF _kind = 'subaccount_owner'
     AND NOT (public.is_platform_owner()$before$,
     $after$  -- EXP08_FIRST_OWNER_MINT_V1: existing platform-only ownership recovery boundary.
  IF _kind = 'subaccount_owner' THEN
    PERFORM 1 FROM public.tenants WHERE id=_tenant_id FOR UPDATE;
    IF public._solo_shell_tenant(_tenant_id) AND public.is_platform_owner()
       AND NOT public.agency_can_manage_child(_tenant_id, auth.uid()) THEN
      IF NOT public._tenant_never_owned(_tenant_id) THEN
        RAISE EXCEPTION '% has had an owner, so a new owner can only be added by its account holder or through owner recovery. Nothing changed.',
          (SELECT COALESCE(NULLIF(btrim(name),''),'This business') FROM public.tenants WHERE id=_tenant_id)
          USING ERRCODE='42501',HINT='OWNER_HISTORY_REQUIRES_RECOVERY';
      END IF;
    END IF;
  END IF;
  IF _kind = 'subaccount_owner'
     AND NOT (public.is_platform_owner()$after$),
    ('public.accept_tenant_invite(text)', '0194a076acce065d23de842cab9b6d29',
     $before$  ELSIF _tok.kind = 'subaccount_owner' THEN$before$,
     $after$  ELSIF _tok.kind = 'subaccount_owner' THEN
    -- EXP08_FIRST_OWNER_ACCEPT_V1: same token, original tenant serialization, no silent admin downgrade.
    PERFORM 1 FROM public.tenants WHERE id=_tok.tenant_id FOR UPDATE;
    _exp08_never_owned:=public._tenant_never_owned(_tok.tenant_id);
    IF _tok.expires_at<=pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'invite has expired' USING ERRCODE='42501',HINT='OWNER_INVITE_EXPIRED';
    END IF;
    IF public._solo_shell_tenant(_tok.tenant_id) THEN
      IF public.is_platform_owner(_tok.created_by)
         AND NOT public.agency_can_manage_child(_tok.tenant_id, _tok.created_by)
         AND NOT _exp08_never_owned THEN
        RAISE EXCEPTION 'This invitation can''t be used. Owners of % are added by its account holder. Ask them for a new invitation.',
          (SELECT COALESCE(NULLIF(btrim(name),''),'this business') FROM public.tenants WHERE id=_tok.tenant_id)
          USING ERRCODE='42501',HINT='OWNER_HISTORY_REQUIRES_RECOVERY';
      END IF;
    END IF;$after$)
  ) v(signature,body_hash,old_span,new_span) LOOP
    target:=sig::regprocedure;
    SELECT prosrc,to_jsonb(p)-'prosrc' INTO old_body,before_metadata FROM pg_proc p WHERE oid=target;
    IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=target AND prosecdef
      AND proowner='postgres'::regrole AND proconfig=ARRAY['search_path=public']
      AND proacl::text=CASE WHEN sig='public.accept_tenant_invite(text)'
        THEN '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
        ELSE '{=X/postgres,postgres=X/postgres,authenticated=X/postgres}' END) THEN
      RAISE EXCEPTION 'EXP08 first owner invitation requires original writer metadata: %',sig;
    END IF;
    -- Replay is admitted only when removing this exact complete span recovers the exact incumbent.
    IF md5(old_body)<>expected THEN
      inverse_body:=old_body;
      IF sig='public.accept_tenant_invite(text)' THEN
        IF strpos(inverse_body,tail_after)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation requires exact original source: %',sig; END IF;
        inverse_body:=replace(inverse_body,tail_after,tail_before);
        IF strpos(inverse_body,declaration_after)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation requires exact original source: %',sig; END IF;
        inverse_body:=replace(inverse_body,declaration_after,declaration_before);
      ELSE
        IF strpos(inverse_body,mint_tail_after)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation requires exact original source: %',sig; END IF;
        inverse_body:=replace(inverse_body,mint_tail_after,mint_tail_before);
      END IF;
      IF strpos(old_body,replacement)=0 OR md5(replace(inverse_body,replacement,original))<>expected THEN
        RAISE EXCEPTION 'EXP08 first owner invitation requires exact original source: %',sig;
      END IF;
      CONTINUE;
    END IF;
    new_body:=replace(old_body,original,replacement);
    IF sig='public.accept_tenant_invite(text)' THEN
      IF strpos(new_body,tail_before)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation tail is not exact: %',sig; END IF;
      new_body:=replace(new_body,tail_before,tail_after);
      IF strpos(new_body,declaration_before)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation declaration is not exact: %',sig; END IF;
      new_body:=replace(new_body,declaration_before,declaration_after);
    ELSE
      IF strpos(new_body,mint_tail_before)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation tail is not exact: %',sig; END IF;
      new_body:=replace(new_body,mint_tail_before,mint_tail_after);
    END IF;
    inverse_body:=new_body;
    IF sig='public.accept_tenant_invite(text)' THEN
      inverse_body:=replace(replace(inverse_body,tail_after,tail_before),declaration_after,declaration_before);
    ELSE
      inverse_body:=replace(inverse_body,mint_tail_after,mint_tail_before);
    END IF;
    IF new_body=old_body OR replace(inverse_body,replacement,original)<>old_body THEN
      RAISE EXCEPTION 'EXP08 first owner invitation replacement is not exact: %',sig;
    END IF;
    definition:=pg_get_functiondef(target);
    EXECUTE replace(definition,old_body,new_body);
    SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_proc p WHERE oid=target;
    IF before_metadata IS DISTINCT FROM after_metadata THEN
      RAISE EXCEPTION 'EXP08 first owner invitation writer metadata changed: %',sig;
    END IF;
  END LOOP;
END
$patch$;

-- END ORIGINAL INERT COMPONENT exp08-first-owner-invitation-patch.sql
SELECT ok((SELECT first_owner_seated_at IS NOT NULL FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000010'),
 'existing owner-seat evidence backfills original ownership history');
SELECT is(public._tenant_never_owned('e8c00000-0000-4000-8000-000000000010'),false,'an existing seat never becomes first-owner admission');
SELECT is(public._tenant_never_owned('e8c00000-0000-4000-8000-000000000011'),true,'a genuinely new shell retains first-owner admission');
SELECT is((SELECT first_owner_seated_at FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000012'),
 TIMESTAMPTZ '2022-01-01Z','original qualifying audit backfills its actual historical instant');
SELECT is(public._tenant_never_owned('e8c00000-0000-4000-8000-000000000013'),true,'injected parent-owner correction is excluded from own-business history');
SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_history_writer_metadata b JOIN pg_proc p ON p.oid=b.oid WHERE (to_jsonb(p)-'prosrc') IS DISTINCT FROM b.metadata),
 'both original writer OIDs and complete non-body metadata are conserved');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=ANY(ARRAY[
 to_regprocedure('public._tenant_never_owned(uuid)'),to_regprocedure('public._tenant_first_owner_history()'),to_regprocedure('public._tenant_first_owner_history_guard()')])
 AND (has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'))),
 'new original history helpers have no direct client or service execution');
CREATE TEMP TABLE exp08_history_stamp AS SELECT first_owner_seated_at AS stamp FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000010';
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public._tenant_never_owned('e8c00000-0000-4000-8000-000000000011')$$,
 '42501','permission denied for function _tenant_never_owned','browser callers cannot invoke the private history authority');
SELECT lives_ok($$SELECT public.revoke_platform_access('e8c00000-0000-4000-8000-000000000002')$$,
 'R16 original platform access revocation remains executable without a new owner-floor restriction');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id='e8c00000-0000-4000-8000-000000000002')
 AND (SELECT owner_user_id IS NULL FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000010'),
 'canonical revocation removes the original seat while the shell still has no holder pointer');
SELECT is((SELECT first_owner_seated_at FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000010'),
 (SELECT stamp FROM exp08_history_stamp),'original history survives the last seat departure unchanged');
SELECT is(public._tenant_never_owned('e8c00000-0000-4000-8000-000000000010'),false,'empty pointer and roster cannot erase prior ownership');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.create_tenant_invite_token('e8c00000-0000-4000-8000-000000000010','subaccount_owner','admin',7,1,NULL,'e8-history-first@tests.invalid')$$,
 '42501','History native A has had an owner, so a new owner can only be added by its account holder or through owner recovery. Nothing changed.',
 'new platform first-owner mint refuses the now-empty historically owned business');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_tenant_invite((SELECT token FROM exp08_history_tokens WHERE label='historical'))$$,
 '42501','This invitation can''t be used. Owners of History native A are added by its account holder. Ask them for a new invitation.',
 'a token minted before the repair cannot re-establish historical ownership');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id='e8c00000-0000-4000-8000-000000000010')
 AND (SELECT uses=0 FROM public.tenant_invite_tokens WHERE token=(SELECT token FROM exp08_history_tokens WHERE label='historical')),
 'refused historical acceptance creates no downgraded seat or consumed token');
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO exp08_history_tokens SELECT 'first',
 (public.create_tenant_invite_token('e8c00000-0000-4000-8000-000000000011','subaccount_owner','admin',7,1,NULL,'e8-history-first@tests.invalid')).token;
SELECT ok(EXISTS(SELECT 1 FROM exp08_history_tokens WHERE label='first'),'genuinely new shell invitation uses the original native mint');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_tenant_invite((SELECT token FROM exp08_history_tokens WHERE label='first'))$$,
 'P0001','This invite was sent to a different email address. Accept it while signed in as e8-history-first@tests.invalid',
 'original intended-recipient refusal is preserved');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.accept_tenant_invite((SELECT token FROM exp08_history_tokens WHERE label='first')),
 'e8c00000-0000-4000-8000-000000000011'::uuid,'the original native accept establishes the genuinely first owner');
RESET ROLE;
SELECT ok(EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id='e8c00000-0000-4000-8000-000000000011'
 AND user_id='e8c00000-0000-4000-8000-000000000003' AND is_owner AND role='owner' AND status='active')
 AND (SELECT owner_user_id='e8c00000-0000-4000-8000-000000000003'::uuid FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000011'),
 'native seat and holder pointer reflect the same intended user');
SELECT ok(EXISTS(SELECT 1 FROM public.profiles WHERE user_id='e8c00000-0000-4000-8000-000000000003' AND active_tenant_id='e8c00000-0000-4000-8000-000000000011'),
 'original acceptance lands the intended user in the invited workspace');
SELECT is((SELECT uses FROM public.tenant_invite_tokens WHERE token=(SELECT token FROM exp08_history_tokens WHERE label='first')),1,
 'original acceptance consumes its one-use token once');
SELECT ok((SELECT first_owner_seated_at IS NOT NULL FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000011'),
 'original membership writer records the first-owner instant through the native trigger');
SELECT is(public._tenant_never_owned('e8c00000-0000-4000-8000-000000000011'),false,'successful first ownership permanently closes first-owner admission');
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.create_tenant_invite_token('e8c00000-0000-4000-8000-000000000011','subaccount_owner','admin',7,1,NULL,'e8-history-other@tests.invalid')$$,
 '42501','History native B has had an owner, so a new owner can only be added by its account holder or through owner recovery. Nothing changed.',
 'a subsequent platform first-owner invitation cannot add another owner');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_tenant_invite((SELECT token FROM exp08_history_tokens WHERE label='first'))$$,
 'P0001','invite has reached its usage limit','original used-token refusal prevents another acceptance');
SELECT throws_ok($$UPDATE public.tenants SET first_owner_seated_at=NULL WHERE id='e8c00000-0000-4000-8000-000000000011'$$,
 '42501','The first owner history cannot be changed.','the first owner cannot erase the native historical boundary');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
CREATE TEMP TABLE exp08_history_before_replay AS SELECT jsonb_build_object(
 'tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenants t WHERE id IN('e8c00000-0000-4000-8000-000000000010','e8c00000-0000-4000-8000-000000000011','e8c00000-0000-4000-8000-000000000012','e8c00000-0000-4000-8000-000000000013')),
 'tokens',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenant_invite_tokens t WHERE token IN(SELECT token FROM exp08_history_tokens))) AS snapshot;
CREATE TEMP TABLE exp08_history_trigger_before_replay AS SELECT jsonb_agg(to_jsonb(t) ORDER BY tgname) AS snapshot FROM pg_trigger t WHERE tgname IN ('trg_tenant_first_owner_history','trg_tenant_first_owner_history_immutable');
-- ORIGINAL INERT COMPONENT exp08-first-owner-history-patch.sql canonical-LF SHA256 805cd576608daf5a1c9d0783ccab17ba5259e86456c1dc098f31caf15c1fead2
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

-- END ORIGINAL INERT COMPONENT exp08-first-owner-history-patch.sql
-- ORIGINAL INERT COMPONENT exp08-first-owner-invitation-patch.sql canonical-LF SHA256 5d92784bfb99eaaa38a2504bbb5c60732afc1f90f76e337dc213b2479ec7a86c
-- UNVERSIONED I2 component. Original mint/accept only; no deployment/native slot/activation.
-- Preserve the entire incumbent including E09 consumer/recipient/contact protections.
DO $patch$
DECLARE sig text; expected text; original text; replacement text; old_body text; new_body text;
  definition text; before_metadata jsonb; after_metadata jsonb; target oid;
  inverse_body text;
  declaration_before constant text:=E'\nDECLARE\n';
  declaration_after constant text:=E'\nDECLARE\n  _exp08_never_owned boolean;\n';
  mint_tail_before constant text:=$before$
  RETURN _row;
END$before$;
  mint_tail_after constant text:=$after$
  -- EXP08_FIRST_OWNER_FINAL_MINT_V1: the original INSERT can wait after admission.
  IF _kind='subaccount_owner' THEN
    IF NOT (public.is_platform_owner() OR public.agency_can_manage_child(_tenant_id,auth.uid())) THEN
      RAISE EXCEPTION 'This invitation can''t be created because your access has changed. Nothing changed.'
        USING ERRCODE='42501',HINT='OWNER_INVITE_AUTHORITY_CHANGED';
    END IF;
    IF public._solo_shell_tenant(_tenant_id) AND public.is_platform_owner()
       AND NOT public.agency_can_manage_child(_tenant_id,auth.uid())
       AND NOT public._tenant_never_owned(_tenant_id) THEN
      RAISE EXCEPTION '% has had an owner, so a new owner can only be added by its account holder or through owner recovery. Nothing changed.',
        (SELECT COALESCE(NULLIF(btrim(name),''),'This business') FROM public.tenants WHERE id=_tenant_id)
        USING ERRCODE='42501',HINT='OWNER_HISTORY_REQUIRES_RECOVERY';
    END IF;
  END IF;
  RETURN _row;
END$after$;
  tail_before constant text:=$before$
  RETURN _tok.tenant_id;
END$before$;
  tail_after constant text:=$after$
  -- EXP08_FIRST_OWNER_FINAL_EXPIRY_V1: all original writes are transactional; a late refusal
  -- rolls back seat, pointer, profile, token and audit together, including waits after admission.
  IF _tok.kind='subaccount_owner' AND _tok.expires_at<=pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'invite has expired' USING ERRCODE='42501',HINT='OWNER_INVITE_EXPIRED';
  END IF;
  IF _tok.kind='subaccount_owner' THEN
    IF _minter_ok AND NOT (public.is_platform_owner(_tok.created_by)
       OR public.agency_can_manage_child(_tok.tenant_id, _tok.created_by)) THEN
      RAISE EXCEPTION 'This invitation can''t be used because its sender''s access has changed. Ask for a new invitation.'
        USING ERRCODE='42501',HINT='OWNER_INVITE_AUTHORITY_CHANGED';
    END IF;
    -- Reuse the pre-effect history fact: our own legitimate first-owner writes now make the
    -- current predicate false. Current minter authority must not revive an agency exception.
    IF public._solo_shell_tenant(_tok.tenant_id) AND public.is_platform_owner(_tok.created_by)
       AND NOT public.agency_can_manage_child(_tok.tenant_id, _tok.created_by)
       AND NOT _exp08_never_owned THEN
      RAISE EXCEPTION 'This invitation can''t be used. Owners of % are added by its account holder. Ask them for a new invitation.',
        (SELECT COALESCE(NULLIF(btrim(name),''),'this business') FROM public.tenants WHERE id=_tok.tenant_id)
        USING ERRCODE='42501',HINT='OWNER_HISTORY_REQUIRES_RECOVERY';
    END IF;
  END IF;
  RETURN _tok.tenant_id;
END$after$;
BEGIN
  FOR sig,expected,original,replacement IN SELECT * FROM (VALUES
    ('public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text)',
     'a42d7b2852daf7dcd3e108f0eb588679',
     $before$  IF _kind = 'subaccount_owner'
     AND NOT (public.is_platform_owner()$before$,
     $after$  -- EXP08_FIRST_OWNER_MINT_V1: existing platform-only ownership recovery boundary.
  IF _kind = 'subaccount_owner' THEN
    PERFORM 1 FROM public.tenants WHERE id=_tenant_id FOR UPDATE;
    IF public._solo_shell_tenant(_tenant_id) AND public.is_platform_owner()
       AND NOT public.agency_can_manage_child(_tenant_id, auth.uid()) THEN
      IF NOT public._tenant_never_owned(_tenant_id) THEN
        RAISE EXCEPTION '% has had an owner, so a new owner can only be added by its account holder or through owner recovery. Nothing changed.',
          (SELECT COALESCE(NULLIF(btrim(name),''),'This business') FROM public.tenants WHERE id=_tenant_id)
          USING ERRCODE='42501',HINT='OWNER_HISTORY_REQUIRES_RECOVERY';
      END IF;
    END IF;
  END IF;
  IF _kind = 'subaccount_owner'
     AND NOT (public.is_platform_owner()$after$),
    ('public.accept_tenant_invite(text)', '0194a076acce065d23de842cab9b6d29',
     $before$  ELSIF _tok.kind = 'subaccount_owner' THEN$before$,
     $after$  ELSIF _tok.kind = 'subaccount_owner' THEN
    -- EXP08_FIRST_OWNER_ACCEPT_V1: same token, original tenant serialization, no silent admin downgrade.
    PERFORM 1 FROM public.tenants WHERE id=_tok.tenant_id FOR UPDATE;
    _exp08_never_owned:=public._tenant_never_owned(_tok.tenant_id);
    IF _tok.expires_at<=pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'invite has expired' USING ERRCODE='42501',HINT='OWNER_INVITE_EXPIRED';
    END IF;
    IF public._solo_shell_tenant(_tok.tenant_id) THEN
      IF public.is_platform_owner(_tok.created_by)
         AND NOT public.agency_can_manage_child(_tok.tenant_id, _tok.created_by)
         AND NOT _exp08_never_owned THEN
        RAISE EXCEPTION 'This invitation can''t be used. Owners of % are added by its account holder. Ask them for a new invitation.',
          (SELECT COALESCE(NULLIF(btrim(name),''),'this business') FROM public.tenants WHERE id=_tok.tenant_id)
          USING ERRCODE='42501',HINT='OWNER_HISTORY_REQUIRES_RECOVERY';
      END IF;
    END IF;$after$)
  ) v(signature,body_hash,old_span,new_span) LOOP
    target:=sig::regprocedure;
    SELECT prosrc,to_jsonb(p)-'prosrc' INTO old_body,before_metadata FROM pg_proc p WHERE oid=target;
    IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=target AND prosecdef
      AND proowner='postgres'::regrole AND proconfig=ARRAY['search_path=public']
      AND proacl::text=CASE WHEN sig='public.accept_tenant_invite(text)'
        THEN '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
        ELSE '{=X/postgres,postgres=X/postgres,authenticated=X/postgres}' END) THEN
      RAISE EXCEPTION 'EXP08 first owner invitation requires original writer metadata: %',sig;
    END IF;
    -- Replay is admitted only when removing this exact complete span recovers the exact incumbent.
    IF md5(old_body)<>expected THEN
      inverse_body:=old_body;
      IF sig='public.accept_tenant_invite(text)' THEN
        IF strpos(inverse_body,tail_after)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation requires exact original source: %',sig; END IF;
        inverse_body:=replace(inverse_body,tail_after,tail_before);
        IF strpos(inverse_body,declaration_after)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation requires exact original source: %',sig; END IF;
        inverse_body:=replace(inverse_body,declaration_after,declaration_before);
      ELSE
        IF strpos(inverse_body,mint_tail_after)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation requires exact original source: %',sig; END IF;
        inverse_body:=replace(inverse_body,mint_tail_after,mint_tail_before);
      END IF;
      IF strpos(old_body,replacement)=0 OR md5(replace(inverse_body,replacement,original))<>expected THEN
        RAISE EXCEPTION 'EXP08 first owner invitation requires exact original source: %',sig;
      END IF;
      CONTINUE;
    END IF;
    new_body:=replace(old_body,original,replacement);
    IF sig='public.accept_tenant_invite(text)' THEN
      IF strpos(new_body,tail_before)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation tail is not exact: %',sig; END IF;
      new_body:=replace(new_body,tail_before,tail_after);
      IF strpos(new_body,declaration_before)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation declaration is not exact: %',sig; END IF;
      new_body:=replace(new_body,declaration_before,declaration_after);
    ELSE
      IF strpos(new_body,mint_tail_before)=0 THEN RAISE EXCEPTION 'EXP08 first owner invitation tail is not exact: %',sig; END IF;
      new_body:=replace(new_body,mint_tail_before,mint_tail_after);
    END IF;
    inverse_body:=new_body;
    IF sig='public.accept_tenant_invite(text)' THEN
      inverse_body:=replace(replace(inverse_body,tail_after,tail_before),declaration_after,declaration_before);
    ELSE
      inverse_body:=replace(inverse_body,mint_tail_after,mint_tail_before);
    END IF;
    IF new_body=old_body OR replace(inverse_body,replacement,original)<>old_body THEN
      RAISE EXCEPTION 'EXP08 first owner invitation replacement is not exact: %',sig;
    END IF;
    definition:=pg_get_functiondef(target);
    EXECUTE replace(definition,old_body,new_body);
    SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_proc p WHERE oid=target;
    IF before_metadata IS DISTINCT FROM after_metadata THEN
      RAISE EXCEPTION 'EXP08 first owner invitation writer metadata changed: %',sig;
    END IF;
  END LOOP;
END
$patch$;

-- END ORIGINAL INERT COMPONENT exp08-first-owner-invitation-patch.sql
SELECT is(jsonb_build_object(
 'tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenants t WHERE id IN('e8c00000-0000-4000-8000-000000000010','e8c00000-0000-4000-8000-000000000011','e8c00000-0000-4000-8000-000000000012','e8c00000-0000-4000-8000-000000000013')),
 'tokens',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenant_invite_tokens t WHERE token IN(SELECT token FROM exp08_history_tokens))),
 (SELECT snapshot FROM exp08_history_before_replay),'exact candidate replay changes no original tenant/token data');
SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_history_writer_metadata b JOIN pg_proc p ON p.oid=b.oid WHERE (to_jsonb(p)-'prosrc') IS DISTINCT FROM b.metadata),
 'replay retains the complete original writer metadata');
SELECT is((SELECT jsonb_agg(to_jsonb(t) ORDER BY tgname) FROM pg_trigger t WHERE tgname IN ('trg_tenant_first_owner_history','trg_tenant_first_owner_history_immutable')),
 (SELECT snapshot FROM exp08_history_trigger_before_replay),'exact replay preserves complete native trigger objects and metadata');
SELECT * FROM finish();
ROLLBACK;
