-- EXP08 I2/R5/R6/R11, original revoke writer compatibility with I1's owner-link CHECK.
-- Local, never applied. Ordered after peer70005 and own80008; no applied history rewrite.
-- Preserve the complete existing authorization, owner-floor, locks, person path and audit.
-- Full recovery, billing-contact cleanup and Setup guards remain separate I2 integration.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $revoke_link$
DECLARE
 target regprocedure:=to_regprocedure('public.revoke_co_owner(uuid,uuid)');
 original_source text; original_definition text; before_metadata jsonb; prerequisite record; p pg_proc;
 t pg_trigger; columns text[];
 old_span text:=$old$SET is_owner = false,
         role     = 'admin'::public.tenant_role,$old$;
 new_span text:=$new$SET is_owner = false,
         -- exp08_entity_revoke_link_v1: only the original SOLO link ends with its owner seat.
         business_owner_id = CASE WHEN public._solo_shell_tenant(_tenant) THEN NULL ELSE business_owner_id END,
         role     = 'admin'::public.tenant_role,$new$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'EXP08 entity revoke original writer missing'; END IF;
 -- An unlink without the original held-seat derivation would lose its provenance.
 FOR prerequisite IN SELECT * FROM (VALUES
  ('public._business_owner_seat_ended()','75d4a8e014e495c5e0a819881b6a79bd','v','search_path=""'),
  ('public._business_owner_representative_deleted()','f95cbff2d3f69c274b287ef0b9bc0067','v','search_path=""'),
  ('public._solo_shell_tenant(uuid)','9ade6efeff0689b78ff57b116a28c9d4','s','search_path=public'))
  v(signature,body_hash,volatility,path) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(prerequisite.signature);
  IF NOT FOUND OR md5(p.prosrc)<>prerequisite.body_hash OR p.proowner<>'postgres'::regrole
   OR NOT p.prosecdef OR p.provolatile::text<>prerequisite.volatility
   OR p.proconfig IS DISTINCT FROM ARRAY[prerequisite.path]::text[]
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE') THEN
   RAISE EXCEPTION 'EXP08 entity revoke prerequisite drift: %',prerequisite.signature;
  END IF;
 END LOOP;
 FOR prerequisite IN SELECT * FROM (VALUES
  ('public.tenant_members','trg_tenant_members_business_owner_seat_ended','public._business_owner_seat_ended()',25,
   ARRAY['business_owner_id','is_owner','status','tenant_id','user_id']::text[]),
  ('public.tenant_business_owners','trg_business_owner_representative_deleted','public._business_owner_representative_deleted()',19,
   ARRAY['representative_user_id']::text[])) v(relation,name,signature,kind,attributes) LOOP
  SELECT * INTO t FROM pg_trigger WHERE tgrelid=prerequisite.relation::regclass AND tgname=prerequisite.name;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXP08 entity revoke held-seat trigger missing'; END IF;
  SELECT array_agg(a.attname::text ORDER BY a.attname) INTO columns FROM pg_attribute a
   WHERE a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr::smallint[]);
  IF t.tgfoid<>prerequisite.signature::regprocedure OR t.tgtype<>prerequisite.kind OR t.tgenabled<>'O'
   OR t.tgisinternal OR t.tgnargs<>0 OR t.tgqual IS NOT NULL OR t.tgconstraint<>0
   OR columns IS DISTINCT FROM prerequisite.attributes THEN
   RAISE EXCEPTION 'EXP08 entity revoke held-seat trigger drift';
  END IF;
 END LOOP;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
  OR p.prorettype<>'void'::regtype OR p.proretset OR p.pronargdefaults<>0
  OR p.proargnames IS DISTINCT FROM ARRAY['_tenant','_user']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole,'service_role'::regrole)
     OR a.privilege_type<>'EXECUTE' OR (a.is_grantable AND a.grantee<>'postgres'::regrole))
  OR NOT has_function_privilege('authenticated',target,'EXECUTE')
  OR NOT has_function_privilege('service_role',target,'EXECUTE') THEN
  RAISE EXCEPTION 'EXP08 entity revoke original writer metadata drift';
 END IF;
 SELECT prosrc,pg_get_functiondef(oid),to_jsonb(f)-'prosrc' INTO original_source,original_definition,before_metadata
  FROM pg_proc f WHERE oid=target;
 IF position('exp08_entity_revoke_link_v1' IN original_source)>0 THEN
  IF (length(original_source)-length(replace(original_source,new_span,'')))/length(new_span)<>1
   OR md5(replace(original_source,new_span,old_span))<>'e2ba8ca80d63df58ebc93b34e5dc5f01' THEN
   RAISE EXCEPTION 'EXP08 entity revoke partial or drifted source';
  END IF;
  RETURN;
 END IF;
 IF md5(original_source)<>'e2ba8ca80d63df58ebc93b34e5dc5f01'
  OR (length(original_source)-length(replace(original_source,old_span,'')))/length(old_span)<>1 THEN
  RAISE EXCEPTION 'EXP08 entity revoke original source drift';
 END IF;
 EXECUTE replace(original_definition,old_span,new_span);
 IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
  OR (SELECT md5(replace(prosrc,new_span,old_span)) FROM pg_proc WHERE oid=target)
    <>'e2ba8ca80d63df58ebc93b34e5dc5f01' THEN
  RAISE EXCEPTION 'EXP08 entity revoke source or metadata conservation failed';
 END IF;
END $revoke_link$;
COMMIT;
