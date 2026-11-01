-- EXP03 original contact and number management recovery.
-- Forward-only; preserve exact original function identities, metadata and ACL.
-- One transaction prevents a later source/metadata refusal leaving a partial repair.
-- No account, business-row, grant, provider, consent or jurisdiction mutation.
BEGIN;
DO $exp03_recipient_timezone$
DECLARE
  target regprocedure := 'public.upsert_contact(jsonb,uuid,uuid,uuid,text)'::regprocedure;
  original text;
  revised text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'EXP03 contact timezone metadata drift'; END IF;
  original := pg_get_functiondef(target);
  IF md5(original)='0d05ed2429366f1215c3d7363ee56b4b' THEN RETURN; END IF;
  IF md5(original)<>'0b3e44a65443104b2068168faf452b0f' THEN RAISE EXCEPTION 'EXP03 contact timezone source drift'; END IF;
  revised := original;
  revised := replace(revised, $old11$  IF _actor IS NULL OR NOT public.has_any_role(_actor, ARRAY['admin','super_admin']) THEN
    RAISE EXCEPTION 'CONTACT_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;

$old11$, $new11$$new11$);
  revised := replace(revised, $old12$  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_TENANT' USING ERRCODE = '22023';
  END IF;
$old12$, $new12$  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_TENANT' USING ERRCODE = '22023';
  END IF;

  IF _actor IS NULL OR NOT (
    public.is_platform_owner(_actor) OR public.is_tenant_admin_as(_actor, _tenant)
  ) THEN
    RAISE EXCEPTION 'CONTACT_FORBIDDEN: current business owner or admin required' USING ERRCODE = '42501';
  END IF;
$new12$);
  revised := replace(revised, $old0$  _action text;$old0$, $new0$  _action text;
  _timezone_change boolean := p_patch ?| ARRAY['timezone','timezone_verified'];
  _timezone text;
  _timezone_verified boolean := false;
  _existing_timezone text;
  _existing_timezone_verified boolean;
  _expected_updated_at timestamptz;
  _existing_updated_at timestamptz;$new0$);
  revised := replace(revised, $old1$     'assigned_coach_user_id','do_not_contact'$old1$, $new1$     'assigned_coach_user_id','do_not_contact',
     'timezone','timezone_verified','expected_timezone','expected_timezone_verified','expected_updated_at'$new1$);
  revised := replace(revised, $old2$  IF p_patch ? 'assigned_coach_user_id'
$old2$, $new2$  -- Explicit manual confirmation, never a model/service inference. Existing native row and audit only.
  IF NOT _timezone_change AND p_patch ?| ARRAY['expected_timezone','expected_timezone_verified'] THEN
    RAISE EXCEPTION 'CONTACT_TIMEZONE_EXPECTED_WITHOUT_CHANGE' USING ERRCODE = '22023';
  END IF;
  IF _timezone_change THEN
    IF p_patch ? 'timezone' THEN
      IF jsonb_typeof(p_patch->'timezone') NOT IN ('string','null') THEN
        RAISE EXCEPTION 'CONTACT_BAD_TIMEZONE' USING ERRCODE = '22023';
      END IF;
      _timezone := NULLIF(btrim(p_patch->>'timezone'), '');
      IF _timezone IS NOT NULL AND (
        _timezone !~ '^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|US|Canada|Mexico|Brazil|Chile)/'
        OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names AS z WHERE z.name = _timezone)
      ) THEN RAISE EXCEPTION 'CONTACT_BAD_TIMEZONE' USING ERRCODE = '22023'; END IF;
    END IF;
    IF p_patch ? 'timezone_verified' THEN
      IF jsonb_typeof(p_patch->'timezone_verified') <> 'boolean' THEN
        RAISE EXCEPTION 'CONTACT_BAD_TIMEZONE_CONFIRMATION' USING ERRCODE = '22023';
      END IF;
      _timezone_verified := (p_patch->>'timezone_verified')::boolean;
    END IF;
    IF _timezone_verified AND (
      _caller IS NULL OR p_channel IS DISTINCT FROM 'manual'
      OR NOT p_patch ? 'timezone' OR _timezone IS NULL
    ) THEN RAISE EXCEPTION 'CONTACT_TIMEZONE_MANUAL_CONFIRMATION_REQUIRED' USING ERRCODE = '42501'; END IF;
    IF _contact_id IS NOT NULL THEN
      IF NOT (p_patch ? 'expected_timezone' AND p_patch ? 'expected_timezone_verified' AND p_patch ? 'expected_updated_at') THEN
        RAISE EXCEPTION 'CONTACT_TIMEZONE_EXPECTED_REQUIRED' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(p_patch->'expected_timezone') NOT IN ('string','null')
        OR jsonb_typeof(p_patch->'expected_timezone_verified') <> 'boolean' THEN
        RAISE EXCEPTION 'CONTACT_BAD_TIMEZONE_EXPECTED' USING ERRCODE = '22023';
      END IF;
    ELSIF p_patch ?| ARRAY['expected_timezone','expected_timezone_verified'] THEN
      RAISE EXCEPTION 'CONTACT_TIMEZONE_EXPECTED_ON_CREATE' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Same native updated_at token used by the original governed Contact writer.
  IF p_patch ? 'expected_updated_at' THEN
    IF _contact_id IS NULL THEN
      RAISE EXCEPTION 'CONTACT_EXPECTED_VERSION_ON_CREATE' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_patch->'expected_updated_at') <> 'string'
      OR (p_patch->>'expected_updated_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}(:[0-9]{2})?)$' THEN
      RAISE EXCEPTION 'CONTACT_BAD_EXPECTED_VERSION' USING ERRCODE = '22023';
    END IF;
    BEGIN
      _expected_updated_at := (p_patch->>'expected_updated_at')::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'CONTACT_BAD_EXPECTED_VERSION' USING ERRCODE = '22023';
    END;
  END IF;

  IF p_patch ? 'assigned_coach_user_id'
$new2$);
  revised := replace(revised, $old3$      assigned_coach_user_id, do_not_contact, created_by, tenant_id, created_by_channel_type$old3$, $new3$      assigned_coach_user_id, do_not_contact, created_by, tenant_id, created_by_channel_type, timezone, timezone_verified$new3$);
  revised := replace(revised, $old4$      _tenant,
      p_channel
$old4$, $new4$      _tenant,
      p_channel,
      _timezone,
      _timezone_verified
$new4$);
  revised := replace(revised, $old5$    PERFORM 1 FROM public.clients AS c
     WHERE c.id = _contact_id AND c.tenant_id = _tenant
     FOR UPDATE;$old5$, $new5$    SELECT c.timezone, c.timezone_verified, c.updated_at INTO _existing_timezone, _existing_timezone_verified, _existing_updated_at
      FROM public.clients AS c
     WHERE c.id = _contact_id AND c.tenant_id = _tenant
     FOR UPDATE;$new5$);
  revised := replace(revised, $old6$      RAISE EXCEPTION 'CONTACT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
    END IF;$old6$, $new6$      RAISE EXCEPTION 'CONTACT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF p_patch ? 'expected_updated_at' AND _existing_updated_at IS DISTINCT FROM _expected_updated_at THEN
      IF _timezone_change THEN
        RAISE EXCEPTION 'CONTACT_TIMEZONE_STALE' USING ERRCODE = '40001';
      ELSE
        RAISE EXCEPTION 'CONTACT_VERSION_STALE' USING ERRCODE = '40001';
      END IF;
    END IF;
    IF _timezone_change AND (
      _existing_timezone IS DISTINCT FROM p_patch->>'expected_timezone'
      OR _existing_timezone_verified IS DISTINCT FROM (p_patch->>'expected_timezone_verified')::boolean
    ) THEN RAISE EXCEPTION 'CONTACT_TIMEZONE_STALE' USING ERRCODE = '40001'; END IF;$new6$);
  revised := replace(revised, $old7$      updated_at = now()$old7$, $new7$      timezone = CASE WHEN p_patch ? 'timezone' THEN _timezone ELSE c.timezone END,
      timezone_verified = CASE WHEN _timezone_change THEN _timezone_verified ELSE c.timezone_verified END,
      updated_at = clock_timestamp()$new7$);
  revised := replace(revised, $old8$jsonb_build_object('tenant_id', _tenant, 'fields', ARRAY(SELECT jsonb_object_keys(p_patch - 'expected_contact_methods')), 'channel', p_channel)$old8$, $new8$jsonb_build_object('tenant_id', _tenant, 'fields', ARRAY(SELECT jsonb_object_keys(p_patch - ARRAY['expected_contact_methods','expected_timezone','expected_timezone_verified','expected_updated_at'])), 'channel', p_channel)
          || CASE WHEN _timezone_change THEN jsonb_build_object('recipient_timezone', (
            SELECT jsonb_build_object('timezone', c.timezone, 'verified', c.timezone_verified,
              'actor_user_id', _actor, 'recorded_at', clock_timestamp(),
              'source', CASE WHEN c.timezone_verified THEN 'authenticated_manual_confirmation' ELSE 'unconfirmed_update' END)
              FROM public.clients c WHERE c.id=_contact_id AND c.tenant_id=_tenant
          )) ELSE '{}'::jsonb END$new8$);
  revised := replace(revised, $old9$    INSERT INTO public.clients ($old9$, $new9$    -- Resolve the SAME current actor/business predicates after waits, immediately before mutation.
    IF _actor IS NULL
      OR NOT (public.is_platform_owner(_actor) OR public.is_tenant_admin_as(_actor, _tenant))
      OR (_caller IS NOT NULL
        AND NOT (public.is_platform_owner(_caller) AND p_tenant_id IS NOT NULL)
        AND public.current_user_tenant_id() IS DISTINCT FROM _tenant)
    THEN RAISE EXCEPTION 'CONTACT_AUTHORITY_CHANGED' USING ERRCODE = '42501'; END IF;
    INSERT INTO public.clients ($new9$);
  revised := replace(revised, $old10$    UPDATE public.clients AS c SET$old10$, $new10$    -- Resolve the SAME current actor/business predicates after waits, immediately before mutation.
    IF _actor IS NULL
      OR NOT (public.is_platform_owner(_actor) OR public.is_tenant_admin_as(_actor, _tenant))
      OR (_caller IS NOT NULL
        AND NOT (public.is_platform_owner(_caller) AND p_tenant_id IS NOT NULL)
        AND public.current_user_tenant_id() IS DISTINCT FROM _tenant)
    THEN RAISE EXCEPTION 'CONTACT_AUTHORITY_CHANGED' USING ERRCODE = '42501'; END IF;
    UPDATE public.clients AS c SET$new10$);
  IF md5(revised)<>'0d05ed2429366f1215c3d7363ee56b4b' THEN RAISE EXCEPTION 'EXP03 contact timezone revised source mismatch'; END IF;
  EXECUTE revised;
  IF md5(pg_get_functiondef(target))<>'0d05ed2429366f1215c3d7363ee56b4b' THEN RAISE EXCEPTION 'EXP03 contact timezone readback mismatch'; END IF;
END;
$exp03_recipient_timezone$;

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
COMMIT;
