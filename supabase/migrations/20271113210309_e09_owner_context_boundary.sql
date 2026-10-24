-- EXP09: keep the original owner-context reader in its authorized staff workspace.
-- Customers use the existing client frame and approved Knowledge. No new identity,
-- permission, runtime, provider, grant, index or financial expression.
BEGIN;
DO $lease$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.current_user_tenant_id()', 'f16384fd81d48901441185bec66f939f', 'd1707186c8e5f1577bde2338d7541aec'),
  ('public.get_paige_persona_context()', '866d4e907c3cd8f2c30a6ef012821352', '5fc13192159b7c60c3a808895ae2c2c8')
 ) AS expected(identity, body_hash, acl_hash) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(r.identity)
    AND (md5(p.prosrc)=r.body_hash OR (r.identity='public.get_paige_persona_context()' AND md5(p.prosrc)='39cb7d0fc5b50f669c3cc049e98971f9'))
    AND md5(coalesce(p.proacl::text,''))=r.acl_hash
    AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.provolatile='s'
    AND p.proconfig=ARRAY['search_path=public']::text[]) THEN
   RAISE EXCEPTION 'EXP09_OWNER_CONTEXT_SOURCE_CHANGED: %',r.identity;
  END IF;
 END LOOP;
END $lease$;
DO $patch$
DECLARE v_definition text; v_body_hash text;
 v_old constant text := $lookup$  select c.tenant_id into _tid
  from public.clients c
  where c.linked_user_id = auth.uid()
    and public.client_portal_access_open(c.id)
  order by c.created_at asc
  limit 1;

  if _tid is null then _tid := public.current_user_tenant_id(); end if;
$lookup$;
 v_new constant text := $lookup$  -- Owner context follows original staff authority. CURA uses the client frame/Knowledge.
  _tid := public.current_user_tenant_id();

$lookup$;
BEGIN
 SELECT pg_get_functiondef(p.oid),md5(p.prosrc) INTO v_definition,v_body_hash
 FROM pg_proc p WHERE p.oid='public.get_paige_persona_context()'::regprocedure;
 IF v_body_hash='39cb7d0fc5b50f669c3cc049e98971f9' THEN RETURN; END IF;
 IF v_body_hash<>'866d4e907c3cd8f2c30a6ef012821352' OR strpos(v_definition,v_old)=0
   OR (length(v_definition)-length(replace(v_definition,v_old,'')))<>length(v_old) THEN
  RAISE EXCEPTION 'EXP09_OWNER_CONTEXT_LOOKUP_CHANGED';
 END IF;
 EXECUTE replace(v_definition,v_old,v_new);
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_paige_persona_context()'::regprocedure)<>'39cb7d0fc5b50f669c3cc049e98971f9' THEN
  RAISE EXCEPTION 'EXP09_OWNER_CONTEXT_READBACK_MISMATCH';
 END IF;
END $patch$;
COMMIT;
