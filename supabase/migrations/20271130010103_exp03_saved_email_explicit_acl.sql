-- Restate the original Save13 ACL in source-visible form. The preceding literal
-- replacement preserves this exact ACL; it was verified in its applied Preview.
-- No new role/signature or permissive interval. Keep applied30010003 immutable.
BEGIN;
DO $before_acl$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid)'::regprocedure
  AND md5(pg_get_functiondef(oid))='195f827f04a3cffe6ba18b98b3075225'
  AND pg_get_userbyid(proowner)='postgres' AND prosecdef
  AND proconfig=ARRAY['search_path=pg_catalog, public']::text[]
  AND proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'EXP03 saved email original ACL drift';END IF;
END $before_acl$;
REVOKE ALL ON FUNCTION public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid) TO service_role;
DO $after_acl$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.save_comms_email_draft(uuid,uuid,uuid,uuid,timestamptz,uuid,uuid,text,text,text,jsonb,timestamptz,uuid)'::regprocedure
  AND md5(pg_get_functiondef(oid))='195f827f04a3cffe6ba18b98b3075225'
  AND pg_get_userbyid(proowner)='postgres' AND prosecdef
  AND proconfig=ARRAY['search_path=pg_catalog, public']::text[]
  AND proacl::text='{postgres=X/postgres,service_role=X/postgres}') THEN
  RAISE EXCEPTION 'EXP03 saved email final ACL drift';END IF;
END $after_acl$;
COMMIT;
