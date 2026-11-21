-- Owner-approved forward38: source custody ANT147/85e64fd6, slot7adb8fe4.
-- Compatible predecessor for immutable Social34. Same private reader/authority.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE p pg_catalog.pg_proc; original text; changed text; definition text; pos integer; metadata jsonb;
 old_part text:=$original$md5(p.prosrc)='5545c370d54a7baef54ba37f9619e729'$original$;
 new_part text:=$compatible$md5(p.prosrc) IN ('5545c370d54a7baef54ba37f9619e729','da16cf7c4a5341338b16a010fdfcc605')$compatible$;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(
  'public._team_hub_planning_read_annotations(public.team_hub_agent_turns)');
 IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'s'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR p.proargnames IS DISTINCT FROM ARRAY['t']::text[] OR p.proargmodes IS NOT NULL
  OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
  OR p.prokind<>'f' OR p.provariadic<>0 OR p.pronargdefaults<>0
  OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR (SELECT array_agg(a::text ORDER BY a::text) FROM unnest(p.proacl) a)
    IS DISTINCT FROM ARRAY['postgres=X/postgres']::text[] THEN
  RAISE EXCEPTION 'EXP07 Planning compatibility metadata drift'; END IF;
 original:=replace(p.prosrc,new_part,old_part);
 IF md5(p.prosrc) NOT IN ('f31a93f9774a628bb1c0c24128fd4674','cc46be59b917b6eceb6df323f74b451f')
  OR md5(original)<>'f31a93f9774a628bb1c0c24128fd4674'
  OR cardinality(string_to_array(original,old_part))<>2 THEN
  RAISE EXCEPTION 'EXP07 Planning compatibility source drift'; END IF;
 changed:=replace(original,old_part,new_part);metadata:=to_jsonb(p)-'prosrc';
 IF md5(changed)<>'cc46be59b917b6eceb6df323f74b451f' THEN
  RAISE EXCEPTION 'EXP07 Planning compatibility replacement drift'; END IF;
 IF p.prosrc<>changed THEN
  definition:=pg_get_functiondef(p.oid);pos:=strpos(definition,'AS $function$');
  IF pos=0 THEN RAISE EXCEPTION 'EXP07 Planning compatibility delimiter drift'; END IF;
  EXECUTE left(definition,pos-1)||'AS $function$'||changed||'$function$';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc q WHERE q.oid=p.oid AND q.prosrc=changed
  AND to_jsonb(q)-'prosrc'=metadata) THEN
  RAISE EXCEPTION 'EXP07 Planning compatibility changed metadata'; END IF;
END $patch$;
COMMIT;
