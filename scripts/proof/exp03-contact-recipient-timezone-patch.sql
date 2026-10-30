-- INERT original-writer recipient-timezone recovery candidate; not a migration.
DO $exp03_recipient_timezone$
DECLARE
  target regprocedure := 'public.upsert_contact(jsonb,uuid,uuid,uuid,text)'::regprocedure;
  original text;
  revised text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target AND pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[] AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') THEN RAISE EXCEPTION 'EXP03 contact timezone metadata drift'; END IF;
  original := pg_get_functiondef(target);
  IF md5(original)='119df7983978f861e538be500064a946' THEN RETURN; END IF;
  IF md5(original)<>'bb9b4de901b59d776ec3c82fa649770f' THEN RAISE EXCEPTION 'EXP03 contact timezone source drift'; END IF;
  revised := original;
  revised := replace(revised, $old0$  _action text;$old0$, $new0$  _action text;
  _timezone_change boolean := p_patch ?| ARRAY['timezone','timezone_verified'];
  _timezone text;
  _timezone_verified boolean := false;
  _existing_timezone text;
  _existing_timezone_verified boolean;$new0$);
  revised := replace(revised, $old1$     'assigned_coach_user_id','do_not_contact'$old1$, $new1$     'assigned_coach_user_id','do_not_contact',
     'timezone','timezone_verified','expected_timezone','expected_timezone_verified'$new1$);
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
      IF NOT (p_patch ? 'expected_timezone' AND p_patch ? 'expected_timezone_verified') THEN
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
     FOR UPDATE;$old5$, $new5$    SELECT c.timezone, c.timezone_verified INTO _existing_timezone, _existing_timezone_verified
      FROM public.clients AS c
     WHERE c.id = _contact_id AND c.tenant_id = _tenant
     FOR UPDATE;$new5$);
  revised := replace(revised, $old6$      RAISE EXCEPTION 'CONTACT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
    END IF;$old6$, $new6$      RAISE EXCEPTION 'CONTACT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF _timezone_change AND (
      _existing_timezone IS DISTINCT FROM p_patch->>'expected_timezone'
      OR _existing_timezone_verified IS DISTINCT FROM (p_patch->>'expected_timezone_verified')::boolean
    ) THEN RAISE EXCEPTION 'CONTACT_TIMEZONE_STALE' USING ERRCODE = '40001'; END IF;$new6$);
  revised := replace(revised, $old7$      updated_at = now()$old7$, $new7$      timezone = CASE WHEN p_patch ? 'timezone' THEN _timezone ELSE c.timezone END,
      timezone_verified = CASE WHEN _timezone_change THEN _timezone_verified ELSE c.timezone_verified END,
      updated_at = now()$new7$);
  revised := replace(revised, $old8$jsonb_build_object('tenant_id', _tenant, 'fields', ARRAY(SELECT jsonb_object_keys(p_patch - 'expected_contact_methods')), 'channel', p_channel)$old8$, $new8$jsonb_build_object('tenant_id', _tenant, 'fields', ARRAY(SELECT jsonb_object_keys(p_patch - ARRAY['expected_contact_methods','expected_timezone','expected_timezone_verified'])), 'channel', p_channel)
          || CASE WHEN _timezone_change THEN jsonb_build_object('recipient_timezone', (
            SELECT jsonb_build_object('timezone', c.timezone, 'verified', c.timezone_verified,
              'actor_user_id', _actor, 'recorded_at', transaction_timestamp(),
              'source', CASE WHEN c.timezone_verified THEN 'authenticated_manual_confirmation' ELSE 'unconfirmed_update' END)
              FROM public.clients c WHERE c.id=_contact_id AND c.tenant_id=_tenant
          )) ELSE '{}'::jsonb END$new8$);
  IF md5(revised)<>'119df7983978f861e538be500064a946' THEN RAISE EXCEPTION 'EXP03 contact timezone revised source mismatch'; END IF;
  EXECUTE revised;
  IF md5(pg_get_functiondef(target))<>'119df7983978f861e538be500064a946' THEN RAISE EXCEPTION 'EXP03 contact timezone readback mismatch'; END IF;
END;
$exp03_recipient_timezone$;
