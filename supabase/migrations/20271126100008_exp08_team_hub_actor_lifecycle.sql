-- EXP08 original collaboration admission. Preserve original role/tier/workspace/switch refusals.
-- Forward-only, local/never-applied repair of existing native admission; no Auth writer,
-- role, grant, session or provider change. Target/session/in-flight revocation remain separate.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $actor_lifecycle$
DECLARE
 target regprocedure:=to_regprocedure('public._team_hub_refusal(uuid)');
 p pg_proc; original_source text; original_definition text; before_metadata jsonb;
 old_span text:=$old$ IF actor IS NULL THEN RETURN 'not_member'; END IF;$old$;
 new_span text:=$new$ -- exp08_actor_lifecycle_v1: current identity is required in addition to the original seat.
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=actor) THEN RETURN 'not_member'; END IF;$new$;
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'EXP08 actor lifecycle original admission missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('auth.users')
  AND attname='id' AND atttypid='uuid'::regtype AND attnum>0 AND NOT attisdropped) THEN
  RAISE EXCEPTION 'EXP08 actor lifecycle identity prerequisite missing';
 END IF;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
 IF p.proowner<>'postgres'::regrole OR p.prosecdef OR p.provolatile<>'s'
  OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR p.prorettype<>'text'::regtype OR p.proretset OR p.pronargdefaults<>0
  OR p.proargnames IS DISTINCT FROM ARRAY['p_expected_tenant']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE') THEN
  RAISE EXCEPTION 'EXP08 actor lifecycle original metadata drift';
 END IF;
 SELECT prosrc,pg_get_functiondef(oid),to_jsonb(f)-'prosrc' INTO original_source,original_definition,before_metadata
  FROM pg_proc f WHERE oid=target;
 IF position('exp08_actor_lifecycle_v1' IN original_source)>0 THEN
  IF (length(original_source)-length(replace(original_source,new_span,'')))/length(new_span)<>1
   OR md5(replace(original_source,new_span,old_span))<>'b6ee98245fdbb9e0229547061a9391d2' THEN
   RAISE EXCEPTION 'EXP08 actor lifecycle partial or drifted source';
  END IF;
  RETURN;
 END IF;
 IF md5(original_source)<>'b6ee98245fdbb9e0229547061a9391d2'
  OR (length(original_source)-length(replace(original_source,old_span,'')))/length(old_span)<>1 THEN
  RAISE EXCEPTION 'EXP08 actor lifecycle original source drift';
 END IF;
 EXECUTE replace(original_definition,old_span,new_span);
 IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
  OR (SELECT md5(replace(prosrc,new_span,old_span)) FROM pg_proc WHERE oid=target)
    <>'b6ee98245fdbb9e0229547061a9391d2' THEN
  RAISE EXCEPTION 'EXP08 actor lifecycle source or metadata conservation failed';
 END IF;
END $actor_lifecycle$;
COMMIT;
