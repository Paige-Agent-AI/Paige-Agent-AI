-- EXP03 P1 follow-up: inert forward-migration candidate, NOT a published migration.
-- Native version/order and full schema/review/release checks remain required.
-- Repair only the two original writers; preserve OID, owner, ACL, search_path,
-- tenant/service ABI, primary advisory lock, active-number and label rules.
DO $exp03_number_authority$
DECLARE
  item record;
  target regprocedure;
  original text;
  revised text;
  original_owner oid;
  original_acl aclitem[];
  original_config text[];
  old_predicate constant text := 'or public.has_any_role(v_caller, array[''admin''])';
  new_predicate constant text := 'or public.is_tenant_admin_as(v_caller, v_tenant)';
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('public.tenant_phone_number_rename(uuid,text,uuid)', 'a8297d7bba472a3148c57e80265ce72d', 'c5b27fe79032867397e791f1a622c65a'),
    ('public.tenant_phone_number_set_primary(uuid,uuid)', 'f15793f40cdd05c228984d3daa8f5ecc', '51e8194575d9b692642b62874e127f04')
  ) AS source(signature, before_md5, after_md5)
  LOOP
    target := to_regprocedure(item.signature);
    IF target IS NULL THEN RAISE EXCEPTION 'EXP03 number writer missing: %', item.signature; END IF;
    SELECT pg_get_functiondef(oid), proowner, proacl, proconfig
      INTO original, original_owner, original_acl, original_config
      FROM pg_proc WHERE oid = target;
    IF original_owner <> 'postgres'::regrole
      OR original_acl::text IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'
      OR original_config IS DISTINCT FROM ARRAY['search_path=public']
      OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = target) THEN
      RAISE EXCEPTION 'EXP03 number writer metadata drift: %', item.signature;
    END IF;
    -- Exact reviewed after-source is the only permitted replay state.
    IF md5(original) = item.after_md5 THEN CONTINUE; END IF;
    -- Accept only the read-back source, never silently compose an unknown writer.
    IF md5(original) <> item.before_md5 THEN
      RAISE EXCEPTION 'EXP03 number writer source drift: %', item.signature;
    END IF;
    IF (length(original) - length(replace(original, old_predicate, ''))) / length(old_predicate) <> 1 THEN
      RAISE EXCEPTION 'EXP03 number writer authority span changed: %', item.signature;
    END IF;
    revised := replace(original, old_predicate, new_predicate);
    IF md5(revised) <> item.after_md5 THEN
      RAISE EXCEPTION 'EXP03 number writer replacement mismatch: %', item.signature;
    END IF;
    EXECUTE revised;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = target
       AND proowner = original_owner AND proacl IS NOT DISTINCT FROM original_acl
       AND proconfig IS NOT DISTINCT FROM original_config AND prosecdef
       AND pg_get_functiondef(oid) = revised) THEN
      RAISE EXCEPTION 'EXP03 number writer metadata/source mismatch: %', item.signature;
    END IF;
  END LOOP;
END;
$exp03_number_authority$;
