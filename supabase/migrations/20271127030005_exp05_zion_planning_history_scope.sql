-- EXP05: original specialist read/card scope is required for historical Planning answers.
-- Forward-only after27020005; previous applied carriers remain immutable.
-- No public ABI, grant, writer, scheduler or provider change.
-- Forward-only restoration of the original read/card historical scope predicate.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE p pg_catalog.pg_proc; original text; changed text; definition text; pos integer; metadata jsonb;
 old_part text:=$original$ IF NOT FOUND OR config#>>'{capability_scope,mode}' IS DISTINCT FROM 'allowlist'
  OR jsonb_typeof(config#>'{capability_scope,tools}') IS DISTINCT FROM 'array'$original$;
 new_part text:=$bounded$ IF NOT FOUND OR config#>>'{capability_scope,mode}' IS DISTINCT FROM 'allowlist'
  OR coalesce(config#>>'{capability_scope,access}','') NOT IN ('read','card')
  OR jsonb_typeof(config#>'{capability_scope,tools}') IS DISTINCT FROM 'array'$bounded$;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(
  'public._team_hub_planning_read_annotations(public.team_hub_agent_turns)');
 IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'s'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR p.proargnames IS DISTINCT FROM ARRAY['t']::text[]
  OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
  OR p.prokind<>'f' OR p.provariadic<>0 OR p.pronargdefaults<>0
  OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.proacl IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable
   OR a.grantee<>p.proowner) THEN
  RAISE EXCEPTION 'Original Planning history-scope metadata drift'; END IF;
 original:=replace(p.prosrc,new_part,old_part);
 IF md5(original)<>'f6ffa06936970dd1ad1a8d3b1cb98be1'
  OR cardinality(string_to_array(original,old_part))<>2 THEN
  RAISE EXCEPTION 'Original Planning history-scope source drift'; END IF;
 changed:=replace(original,old_part,new_part);metadata:=to_jsonb(p)-'prosrc';
 IF p.prosrc<>changed THEN
  definition:=pg_get_functiondef(p.oid);pos:=strpos(definition,'AS $function$');
  IF pos=0 THEN RAISE EXCEPTION 'Original Planning history-scope delimiter drift'; END IF;
  EXECUTE left(definition,pos-1)||'AS $function$'||changed||'$function$';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc q WHERE q.oid=p.oid AND q.prosrc=changed
  AND to_jsonb(q)-'prosrc'=metadata) THEN
  RAISE EXCEPTION 'Original Planning history-scope metadata changed'; END IF;
END $patch$;
COMMIT;
