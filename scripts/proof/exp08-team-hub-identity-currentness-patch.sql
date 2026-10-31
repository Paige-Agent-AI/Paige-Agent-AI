-- EXP08: current identity for the ORIGINAL actor/participant admission predicates and seat locks.
-- No Auth writer, membership/role/grant change, new authority engine or applied-history rewrite.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $identity_currentness$
DECLARE r record; p pg_proc; target regprocedure; current_source text; next_definition text;
 before_metadata jsonb; marker constant text:='exp08_current_identity_v1';
BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES ('id','uuid'),('deleted_at','timestamptz'),('banned_until','timestamptz')) c(name,kind)
  WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('auth.users')
   AND a.attname=c.name AND a.atttypid=to_regtype(c.kind) AND a.attnum>0 AND NOT a.attisdropped)) THEN
  RAISE EXCEPTION 'EXP08 identity currentness original Auth columns missing or drifted';
 END IF;
 FOR r IN SELECT * FROM (VALUES
  ('public._team_hub_is_active(uuid,uuid)','c290399dc80d95d16116a0f88b0abd8c',
   $old$WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active'$old$,
   $new$WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active'
   AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=p_user AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=now())) /* exp08_current_identity_v1 */$new$,
   's','sql',ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_participates(uuid,uuid)','4f2fb69d09f7b362027edf195a37da83',
   $old$WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active' AND m.team_hub_access$old$,
   $new$WHERE m.tenant_id=p_tenant AND m.user_id=p_user AND m.status='active' AND m.team_hub_access
   AND public._team_hub_is_active(p_tenant,p_user) /* exp08_current_identity_v1 */$new$,
   's','sql',ARRAY['p_tenant','p_user']::text[]),
  ('public._team_hub_hold_seats(uuid,uuid[])','af0dee455ee0413ee5b907505ff89acd',
   $old$FROM public.tenant_members m
  WHERE m.tenant_id=p_tenant AND m.user_id=ANY(p_users) AND m.status='active' AND m.team_hub_access ORDER BY m.user_id FOR SHARE$old$,
   $new$FROM public.tenant_members m JOIN auth.users u ON u.id=m.user_id
  WHERE m.tenant_id=p_tenant AND m.user_id=ANY(p_users) AND m.status='active' AND m.team_hub_access
   AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now())
  ORDER BY m.user_id FOR SHARE OF m,u /* exp08_current_identity_v1 */$new$,
   'v','plpgsql',ARRAY['p_tenant','p_users']::text[])
 ) AS candidates(signature,expected_hash,old_span,new_span,volatility,language_name,argnames) LOOP
  target:=to_regprocedure(r.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'EXP08 identity currentness original function missing: %',r.signature; END IF;
  SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
  IF p.proowner<>'postgres'::regrole OR p.prosecdef OR p.provolatile::text<>r.volatility
   OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname=r.language_name)
   OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
   OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR p.prorettype<>'boolean'::regtype OR p.proretset OR p.pronargdefaults<>0
   OR p.proargnames IS DISTINCT FROM r.argnames OR p.proargmodes IS NOT NULL
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
   RAISE EXCEPTION 'EXP08 identity currentness original metadata drift: %',r.signature;
  END IF;
  current_source:=p.prosrc;
  IF position(marker IN current_source)>0 THEN
   IF (length(current_source)-length(replace(current_source,r.new_span,'')))/length(r.new_span)<>1
    OR md5(replace(current_source,r.new_span,r.old_span))<>r.expected_hash THEN
    RAISE EXCEPTION 'EXP08 identity currentness partial or drifted source: %',r.signature;
   END IF;
  ELSE
   IF md5(current_source)<>r.expected_hash
    OR (length(current_source)-length(replace(current_source,r.old_span,'')))/length(r.old_span)<>1 THEN
    RAISE EXCEPTION 'EXP08 identity currentness original source drift: %',r.signature;
   END IF;
   SELECT pg_get_functiondef(target),to_jsonb(f)-'prosrc' INTO next_definition,before_metadata FROM pg_proc f WHERE oid=target;
   EXECUTE replace(next_definition,r.old_span,r.new_span);
   IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata
    OR (SELECT md5(replace(prosrc,r.new_span,r.old_span)) FROM pg_proc WHERE oid=target)<>r.expected_hash THEN
    RAISE EXCEPTION 'EXP08 identity currentness source or metadata conservation failed: %',r.signature;
   END IF;
  END IF;
 END LOOP;
END $identity_currentness$;
COMMIT;
