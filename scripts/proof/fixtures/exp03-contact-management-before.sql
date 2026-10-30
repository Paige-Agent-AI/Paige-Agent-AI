CREATE OR REPLACE FUNCTION public.upsert_contact(p_patch jsonb, p_contact_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid, p_actor_user_id uuid DEFAULT NULL::uuid, p_channel text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _actor uuid := COALESCE(auth.uid(), p_actor_user_id);
  _tenant uuid;
  _contact_id uuid := p_contact_id;
  _email text;
  _methods jsonb;
  _unknown text[];
  _retired text[];
  _action text;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'CONTACT_EMPTY_PATCH' USING ERRCODE = '22023';
  END IF;

  -- A contact holds several addresses; the single-address keys cannot say which one they mean.
  SELECT array_agg(key ORDER BY key)
    INTO _retired
    FROM jsonb_object_keys(p_patch) AS retired(key)
   WHERE key IN ('email', 'phone');
  IF _retired IS NOT NULL THEN
    RAISE EXCEPTION 'CONTACT_ADDRESS_FIELDS_RETIRED: % — send contact_methods, the complete address list', array_to_string(_retired, ',')
      USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key)
    INTO _unknown
    FROM jsonb_object_keys(p_patch) AS allowed(key)
   WHERE key <> ALL (ARRAY[
     'first_name','last_name','contact_methods','expected_contact_methods','entity_name','entity_type','title',
     'website','linkedin_url','street_address','city','state','zip_code',
     'lifecycle_stage','source','tags','primary_offer','current_notes','status',
     'assigned_coach_user_id','do_not_contact'
   ]);
  IF _unknown IS NOT NULL THEN
    RAISE EXCEPTION 'CONTACT_FIELDS_FORBIDDEN: %', array_to_string(_unknown, ',')
      USING ERRCODE = '22023';
  END IF;

  IF _actor IS NULL OR NOT public.has_any_role(_actor, ARRAY['admin','super_admin']) THEN
    RAISE EXCEPTION 'CONTACT_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;

  IF _caller IS NULL THEN
    _tenant := p_tenant_id;
  ELSE
    _tenant := public.current_user_tenant_id();
    IF public.is_platform_owner() AND p_tenant_id IS NOT NULL THEN
      _tenant := p_tenant_id;
    ELSIF p_tenant_id IS NOT NULL AND p_tenant_id IS DISTINCT FROM _tenant THEN
      RAISE EXCEPTION 'CONTACT_TENANT_MISMATCH' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_TENANT' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'assigned_coach_user_id'
     AND NULLIF(p_patch->>'assigned_coach_user_id', '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM public.tenant_members AS tm
        WHERE tm.tenant_id = _tenant
          AND tm.user_id = (p_patch->>'assigned_coach_user_id')::uuid
          AND tm.status = 'active'
          AND public.has_any_role(tm.user_id, ARRAY['admin','super_admin'])
     ) THEN
    RAISE EXCEPTION 'CONTACT_ASSIGNEE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_patch ? 'status'
     AND COALESCE(p_patch->>'status', '') NOT IN ('pending','active','inactive','archived') THEN
    RAISE EXCEPTION 'CONTACT_BAD_STATUS' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'lifecycle_stage'
     AND COALESCE(p_patch->>'lifecycle_stage', '') NOT IN (
       'new_lead','qualified','nurturing','hot_lead','negotiating','won',
       'client_active','client_paused','client_churned','client_funded','client_alumni'
     ) THEN
    RAISE EXCEPTION 'CONTACT_BAD_LIFECYCLE' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'tags' AND jsonb_typeof(COALESCE(p_patch->'tags', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'CONTACT_BAD_TAGS' USING ERRCODE = '22023';
  END IF;
  IF p_channel IS NOT NULL AND p_channel NOT IN ('manual','api') THEN
    RAISE EXCEPTION 'CONTACT_BAD_CHANNEL' USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'expected_contact_methods' AND jsonb_typeof(p_patch->'expected_contact_methods') <> 'array' THEN
    RAISE EXCEPTION 'CONTACT_METHODS_EXPECTED_REQUIRED: send the list you loaded' USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'contact_methods' THEN
    -- Validated before any write, so a bad list never leaves a half-made contact behind.
    _methods := public.contact_methods_canonical(p_patch->'contact_methods');
    SELECT e->>'value' INTO _email
      FROM jsonb_array_elements(_methods) AS e
     WHERE e->>'kind' = 'email' AND (e->>'is_primary')::boolean
     LIMIT 1;
  END IF;

  IF _contact_id IS NULL THEN
    INSERT INTO public.clients (
      first_name, last_name, entity_name, entity_type, title,
      website, linkedin_url, street_address, city, state, zip_code,
      lifecycle_stage, source, tags, primary_offer, current_notes, status,
      assigned_coach_user_id, do_not_contact, created_by, tenant_id, created_by_channel_type
    ) VALUES (
      COALESCE(NULLIF(btrim(p_patch->>'first_name'), ''), NULLIF(split_part(COALESCE(_email, ''), '@', 1), ''), 'New'),
      COALESCE(NULLIF(btrim(p_patch->>'last_name'), ''), 'Contact'),
      NULLIF(btrim(p_patch->>'entity_name'), ''),
      NULLIF(btrim(p_patch->>'entity_type'), ''),
      NULLIF(btrim(p_patch->>'title'), ''),
      NULLIF(btrim(p_patch->>'website'), ''),
      NULLIF(btrim(p_patch->>'linkedin_url'), ''),
      NULLIF(btrim(p_patch->>'street_address'), ''),
      NULLIF(btrim(p_patch->>'city'), ''),
      NULLIF(btrim(p_patch->>'state'), ''),
      NULLIF(btrim(p_patch->>'zip_code'), ''),
      COALESCE(NULLIF(p_patch->>'lifecycle_stage', ''), 'new_lead'),
      COALESCE(NULLIF(btrim(p_patch->>'source'), ''), CASE WHEN p_channel = 'api' THEN 'paige' ELSE 'manual' END),
      CASE WHEN p_patch ? 'tags' THEN ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_patch->'tags', '[]'::jsonb))) ELSE '{}'::text[] END,
      NULLIF(btrim(p_patch->>'primary_offer'), ''),
      NULLIF(btrim(p_patch->>'current_notes'), ''),
      COALESCE(NULLIF(p_patch->>'status', ''), 'active'),
      NULLIF(p_patch->>'assigned_coach_user_id', '')::uuid,
      COALESCE((p_patch->>'do_not_contact')::boolean, false),
      _actor,
      _tenant,
      p_channel
    )
    RETURNING id INTO _contact_id;
    _action := 'create_contact';
  ELSE
    PERFORM 1 FROM public.clients AS c
     WHERE c.id = _contact_id AND c.tenant_id = _tenant
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONTACT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Replacing an existing contact's list needs the list the caller loaded; checked under the
    -- contact's row lock, before anything is written.
    IF p_patch ? 'contact_methods' AND NOT p_patch ? 'expected_contact_methods' THEN
      RAISE EXCEPTION 'CONTACT_METHODS_EXPECTED_REQUIRED: send the list you loaded' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'contact_methods'
       AND public.contact_methods_fingerprint(public._client_contact_methods_payload(_contact_id))
           IS DISTINCT FROM public.contact_methods_fingerprint(p_patch->'expected_contact_methods') THEN
      RAISE EXCEPTION 'CONTACT_METHODS_STALE: this list changed since it was loaded' USING ERRCODE = '40001';
    END IF;

    UPDATE public.clients AS c SET
      first_name = CASE WHEN p_patch ? 'first_name' THEN COALESCE(NULLIF(btrim(p_patch->>'first_name'), ''), 'New') ELSE c.first_name END,
      last_name = CASE WHEN p_patch ? 'last_name' THEN COALESCE(NULLIF(btrim(p_patch->>'last_name'), ''), 'Contact') ELSE c.last_name END,
      entity_name = CASE WHEN p_patch ? 'entity_name' THEN NULLIF(btrim(p_patch->>'entity_name'), '') ELSE c.entity_name END,
      entity_type = CASE WHEN p_patch ? 'entity_type' THEN NULLIF(btrim(p_patch->>'entity_type'), '') ELSE c.entity_type END,
      title = CASE WHEN p_patch ? 'title' THEN NULLIF(btrim(p_patch->>'title'), '') ELSE c.title END,
      website = CASE WHEN p_patch ? 'website' THEN NULLIF(btrim(p_patch->>'website'), '') ELSE c.website END,
      linkedin_url = CASE WHEN p_patch ? 'linkedin_url' THEN NULLIF(btrim(p_patch->>'linkedin_url'), '') ELSE c.linkedin_url END,
      street_address = CASE WHEN p_patch ? 'street_address' THEN NULLIF(btrim(p_patch->>'street_address'), '') ELSE c.street_address END,
      city = CASE WHEN p_patch ? 'city' THEN NULLIF(btrim(p_patch->>'city'), '') ELSE c.city END,
      state = CASE WHEN p_patch ? 'state' THEN NULLIF(btrim(p_patch->>'state'), '') ELSE c.state END,
      zip_code = CASE WHEN p_patch ? 'zip_code' THEN NULLIF(btrim(p_patch->>'zip_code'), '') ELSE c.zip_code END,
      lifecycle_stage = CASE WHEN p_patch ? 'lifecycle_stage' THEN p_patch->>'lifecycle_stage' ELSE c.lifecycle_stage END,
      source = CASE WHEN p_patch ? 'source' THEN NULLIF(btrim(p_patch->>'source'), '') ELSE c.source END,
      tags = CASE WHEN p_patch ? 'tags' THEN ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_patch->'tags', '[]'::jsonb))) ELSE c.tags END,
      primary_offer = CASE WHEN p_patch ? 'primary_offer' THEN NULLIF(btrim(p_patch->>'primary_offer'), '') ELSE c.primary_offer END,
      current_notes = CASE WHEN p_patch ? 'current_notes' THEN NULLIF(btrim(p_patch->>'current_notes'), '') ELSE c.current_notes END,
      status = CASE WHEN p_patch ? 'status' THEN p_patch->>'status' ELSE c.status END,
      assigned_coach_user_id = CASE WHEN p_patch ? 'assigned_coach_user_id' THEN NULLIF(p_patch->>'assigned_coach_user_id', '')::uuid ELSE c.assigned_coach_user_id END,
      do_not_contact = CASE WHEN p_patch ? 'do_not_contact' THEN COALESCE((p_patch->>'do_not_contact')::boolean, false) ELSE c.do_not_contact END,
      updated_at = now()
    WHERE c.id = _contact_id AND c.tenant_id = _tenant;
    _action := 'update_contact';
  END IF;

  IF p_patch ? 'contact_methods' THEN
    PERFORM public._replace_client_contact_methods(_tenant, _contact_id, p_patch->'contact_methods');
  END IF;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'client', _action, _contact_id,
          jsonb_build_object('tenant_id', _tenant, 'fields', ARRAY(SELECT jsonb_object_keys(p_patch - 'expected_contact_methods')), 'channel', p_channel));
  RETURN _contact_id;
END;
$function$
