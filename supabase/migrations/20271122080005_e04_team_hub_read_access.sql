-- CLI-generated forward correction of the original private Team Hub read guard.
-- An existing Preview already applied22010004. Preserve that original migration;
-- resync skips applied versions, so the reviewed correction needs its own version.
BEGIN;
DO $e04_read_access$
DECLARE p pg_catalog.pg_proc%ROWTYPE; original_oid oid; before_metadata jsonb;
 original_body text; corrected text; anchor text;
BEGIN
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(
  'public._team_hub_assert_agent_read_scope(public.team_hub_agent_turns)');
 IF NOT FOUND OR pg_catalog.md5(p.prosrc) NOT IN (
   'a0c7ceda680e1f3bc663332464558e68','1c775f6c3c41b6cd32f01a52238933cb')
  OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres' OR NOT p.prosecdef
  OR p.prorettype<>'void'::regtype OR p.proretset OR p.pronargs<>1 OR p.pronargdefaults<>0
  OR p.proargnames IS DISTINCT FROM ARRAY['t']::text[]
  OR p.prolang IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
  OR p.provolatile<>'v' OR p.proparallel<>'u' OR p.proisstrict OR p.proleakproof OR p.prokind<>'f'
  OR p.provariadic<>0 OR p.proargmodes IS NOT NULL OR p.proallargtypes IS NOT NULL
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR p.proacl IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
    WHERE a.grantee<>p.proowner OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
  RAISE EXCEPTION 'Original Team Hub read guard requires reconciliation' USING ERRCODE='23514';
 END IF;
 original_oid:=p.oid; original_body:=p.prosrc;
 before_metadata:=pg_catalog.to_jsonb(p)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'];
 IF pg_catalog.md5(original_body)='a0c7ceda680e1f3bc663332464558e68' THEN
  anchor:=E' IF NOT FOUND OR config->''capability_scope''->>''mode'' IS DISTINCT FROM ''allowlist''\n';
  IF (pg_catalog.length(original_body)-pg_catalog.length(pg_catalog.replace(original_body,anchor,'')))/pg_catalog.length(anchor)<>1 THEN
   RAISE EXCEPTION 'Original private read scope anchor changed' USING ERRCODE='23514'; END IF;
  corrected:=pg_catalog.replace(original_body,anchor,anchor||E'   OR config->''capability_scope''->>''access'' IS DISTINCT FROM ''read''\n');
  IF pg_catalog.md5(corrected)<>'1c775f6c3c41b6cd32f01a52238933cb' THEN
   RAISE EXCEPTION 'Private read correction differs from reviewed source' USING ERRCODE='23514'; END IF;
  EXECUTE pg_catalog.replace(pg_catalog.pg_get_functiondef(original_oid),original_body,corrected);
 END IF;
 SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=original_oid;
 IF pg_catalog.md5(p.prosrc)<>'1c775f6c3c41b6cd32f01a52238933cb'
  OR pg_catalog.to_jsonb(p)-ARRAY['prosrc','xmin','xmax','cmin','cmax','ctid'] IS DISTINCT FROM before_metadata THEN
  RAISE EXCEPTION 'Original private read metadata or correction changed' USING ERRCODE='23514'; END IF;
END $e04_read_access$;
COMMIT;
