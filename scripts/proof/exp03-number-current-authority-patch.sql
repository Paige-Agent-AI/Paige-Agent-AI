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
  authority_guard text := $gate$  -- Same original actor/business authority, resolved AFTER all mutation-row waits.
  if v_caller is not null and (
       not (public.is_platform_owner() or public.is_tenant_admin_as(v_caller, v_tenant))
       or (not (public.is_platform_owner() and _tenant_id is not null)
           and public.current_user_tenant_id() is distinct from v_tenant)
     ) then
    raise exception 'NUMBER_AUTHORITY_CHANGED' using hint = 'NUMBER_AUTHORITY_CHANGED';
  end if;

$gate$;
  rename_lock text := $rlock$  select * into v_row
  from public.tenant_phone_numbers
  where id = _id and tenant_id = v_tenant
  for update;
  if not found then
    raise exception 'NUMBER_NOT_FOUND' using hint = 'NUMBER_NOT_FOUND';
  end if;

$rlock$;
  primary_lock text := $plock$  -- Lock the former primary too BEFORE the last authority decision; its clear may wait.
  perform 1 from public.tenant_phone_numbers
  where tenant_id = v_tenant and is_primary and id <> _id
  order by id for update;

$plock$;
  rename_anchor text := $ranchor$  update public.tenant_phone_numbers
     set friendly_name = v_name, updated_at = now()$ranchor$;
  primary_anchor text := $panchor$  -- Clear first, then set.$panchor$;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('public.tenant_phone_number_rename(uuid,text,uuid)', 'a8297d7bba472a3148c57e80265ce72d', '888151f66ecb36acac49c2fa94d63dbf'),
    ('public.tenant_phone_number_set_primary(uuid,uuid)', 'f15793f40cdd05c228984d3daa8f5ecc', '9ddc5ca147674afc4df886ec30a139f7')
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
    IF item.signature = 'public.tenant_phone_number_rename(uuid,text,uuid)' THEN
      revised := replace(revised, rename_anchor, rename_lock || authority_guard || rename_anchor);
    ELSE
      revised := replace(revised, primary_anchor, primary_lock || authority_guard || primary_anchor);
    END IF;
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
