-- Shared Knowledge readers must not form an auth-row lock cohort ahead of a
-- waiting native sign-in/recovery update. Serialize that actor's Knowledge
-- transactions while preserving the existing ban/delete barrier and lock order.
-- No Auth records, predicates, function privileges or domain receipts change.
DO $repair$
DECLARE
  f regprocedure := 'public.lock_knowledge_extraction_authority(uuid,uuid)'::regprocedure;
  before_acl aclitem[];
  definition text;
  body_hash text;
BEGIN
  SELECT proacl, pg_get_functiondef(oid), md5(prosrc)
    INTO before_acl, definition, body_hash FROM pg_proc WHERE oid=f::oid;
  IF body_hash NOT IN ('788d27bc980fee58e6272c3e53ca6096','3f61f700706ae3d80dbde0164954e46c')
    OR NOT (SELECT prosecdef AND provolatile='v' AND proconfig=ARRAY['search_path=""']
            FROM pg_proc WHERE oid=f::oid) THEN
    RAISE EXCEPTION 'KNOWLEDGE_AUTH_LOCK_SOURCE_DRIFT';
  END IF;
  IF body_hash='788d27bc980fee58e6272c3e53ca6096' THEN
    definition := replace(definition,
      'FROM auth.users WHERE id=_actor FOR SHARE;',
      'FROM auth.users WHERE id=_actor FOR NO KEY UPDATE;');
    EXECUTE definition;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=f::oid)<>'3f61f700706ae3d80dbde0164954e46c'
    OR (SELECT proacl FROM pg_proc WHERE oid=f::oid) IS DISTINCT FROM before_acl THEN
    RAISE EXCEPTION 'KNOWLEDGE_AUTH_LOCK_REPAIR_DRIFT';
  END IF;
END $repair$;
