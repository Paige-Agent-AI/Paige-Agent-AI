-- Restore ONLY the original Chat-save permission after the auth-lock repair.
-- The paused and original ACLs are the only accepted states; no broad grants.
DO $release$
DECLARE
  f regprocedure := 'public.save_paige_chat_knowledge_link(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer)'::regprocedure;
  current_acl aclitem[];
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.lock_knowledge_extraction_authority(uuid,uuid)'::regprocedure)
       IS DISTINCT FROM '3f61f700706ae3d80dbde0164954e46c' THEN
    RAISE EXCEPTION 'KNOWLEDGE_SAVE_AUTH_REPAIR_REQUIRED';
  END IF;
  SELECT proacl INTO current_acl FROM pg_proc WHERE oid=f::oid;
  IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc WHERE oid=f::oid)
       IS DISTINCT FROM '5d77dd7ee0004925752d37fdd102b406'
    OR current_acl IS NULL
    OR NOT (current_acl = '{postgres=X/postgres}'::aclitem[]
      OR current_acl = '{postgres=X/postgres,authenticated=X/postgres}'::aclitem[]) THEN
    RAISE EXCEPTION 'KNOWLEDGE_SAVE_CONTAINMENT_DRIFT';
  END IF;
  GRANT EXECUTE ON FUNCTION public.save_paige_chat_knowledge_link(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid,text,integer) TO authenticated;
  IF (SELECT proacl FROM pg_proc WHERE oid=f::oid)
       IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres}'::aclitem[] THEN
    RAISE EXCEPTION 'KNOWLEDGE_SAVE_RELEASE_DRIFT';
  END IF;
END $release$;
