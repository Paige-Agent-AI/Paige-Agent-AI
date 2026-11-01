-- New forward after immutable original Preview27000005 and27010005.
-- Limit navigation references, preserving complete source validation/context.
-- Forward-only presentation correction; every original source stays bound.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $patch$
DECLARE p pg_catalog.pg_proc; original text; changed text; definition text; pos integer; metadata jsonb;
 old_part text:=$original$  SELECT coalesce(jsonb_agg(DISTINCT value ORDER BY value),'[]') INTO links FROM jsonb_array_elements(links);
  IF jsonb_array_length(links)>6 THEN RAISE EXCEPTION 'Private source link budget exceeded' USING ERRCODE='42501'; END IF;$original$;
 new_part text:=$bounded$  SELECT coalesce(jsonb_agg(value ORDER BY value),'[]') INTO links FROM (
   SELECT DISTINCT value FROM jsonb_array_elements(links) ORDER BY value LIMIT 6) bounded;$bounded$;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=to_regprocedure(
  'public.team_hub_stage_agent_read_context(uuid,text,jsonb,jsonb)');
 IF NOT FOUND OR p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR p.proargnames IS DISTINCT FROM ARRAY['p_turn_id','p_token_hash','p_read_tools','p_record_links']
  OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u'
  OR p.prokind<>'f' OR p.provariadic<>0 OR p.pronargdefaults<>0
  OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql') OR p.proacl IS NULL
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.privilege_type<>'EXECUTE' OR a.is_grantable
   OR a.grantee NOT IN (p.proowner,'service_role'::regrole))
  OR NOT has_function_privilege('service_role',p.oid,'EXECUTE') THEN
  RAISE EXCEPTION 'Original Planning link-stage metadata drift'; END IF;
 -- Whole-source inverse, not a loose substring patch or a new source whitelist.
 original:=replace(p.prosrc,new_part,old_part);
 IF md5(original)<>'5ca11bdb927e4d4a571f1936f608d2b5'
  OR cardinality(string_to_array(original,old_part))<>2 THEN
  RAISE EXCEPTION 'Original Planning link-stage source drift'; END IF;
 changed:=replace(original,old_part,new_part);metadata:=to_jsonb(p)-'prosrc';
 IF p.prosrc<>changed THEN
  definition:=pg_get_functiondef(p.oid);pos:=strpos(definition,'AS $function$');
  IF pos=0 THEN RAISE EXCEPTION 'Original Planning link-stage delimiter drift'; END IF;
  EXECUTE left(definition,pos-1)||'AS $function$'||changed||'$function$';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc q WHERE q.oid=p.oid AND q.prosrc=changed
  AND to_jsonb(q)-'prosrc'=metadata) THEN
  RAISE EXCEPTION 'Original Planning link-stage metadata changed'; END IF;
END $patch$;
COMMIT;
