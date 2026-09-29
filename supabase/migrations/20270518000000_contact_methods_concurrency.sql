-- Contact methods: a save that would silently overwrite someone else's change is refused.
--
-- Two editors can hold the same contact list open. Before this, the later save replaced the whole
-- list, and whatever the earlier save added, relabelled or promoted was gone without a word.
--
-- Clients. A client's version is `clients.updated_at` (Paige's governed CRM commands already
-- require it). Until now, three writers changed a client's addresses without moving it — inbound
-- recognition attaching an address, the add helper and the replace helper — so a stale command
-- could still overwrite a newly recognised address. A row trigger on client_contact_methods now
-- moves the client's updated_at on every address change, and upsert_contact requires the caller's
-- `expected_updated_at` whenever it replaces the list of an existing contact.
--
-- People. A person's list has no row of its own to carry a version, so set_user_contact_methods
-- takes the list the caller loaded (`p_expected`) and compares it with what is stored, under a
-- per-person lock. Any difference — an address added, removed, relabelled, reordered or promoted —
-- refuses the save as CONTACT_METHODS_STALE; the caller reloads and decides.
--
-- Owner ruling (2026-09-29): an admin holds the owner's powers except removing the owner. The
-- USER_CONTACT_METHODS_OWNER_ONLY refusal is removed; every edit of another person's list is still
-- written to audit_logs by this function, with the admin as the actor.
--
-- upsert_contact is restated whole from its live production definition (read 2026-09-29); the
-- only changes are the `expected_updated_at` key and the check that uses it.

-- ─── The comparison ──────────────────────────────────────────────────────────────────────────
-- Two lists are the same when, after the list rules are applied, they hold the same addresses with
-- the same labels, the same primary and the same order. Kinds may interleave differently.
CREATE FUNCTION public.contact_methods_fingerprint(_methods jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('kind', e->>'kind', 'value', e->>'value', 'label', e->'label',
                                         'is_primary', (e->>'is_primary')::boolean)
           ORDER BY e->>'kind', (e->>'is_primary')::boolean DESC, (e->>'position')::int), '[]'::jsonb)
    FROM pg_catalog.jsonb_array_elements(public.contact_methods_canonical(_methods)) AS e
$$;
REVOKE ALL ON FUNCTION public.contact_methods_fingerprint(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_methods_fingerprint(jsonb) TO authenticated, service_role;

-- A person's stored list, in the shape a caller sends.
CREATE FUNCTION public._user_contact_methods_payload(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(
           pg_catalog.jsonb_build_object('kind', m.kind, 'value', m.value, 'label', m.label, 'is_primary', m.is_primary)
           ORDER BY m.kind, m.position), '[]'::jsonb)
    FROM public.user_contact_methods AS m
   WHERE m.user_id = _user_id
$$;
REVOKE ALL ON FUNCTION public._user_contact_methods_payload(uuid) FROM PUBLIC, anon, authenticated;

-- ─── Clients: every address change moves the contact's version ───────────────────────────────
CREATE FUNCTION public.client_contact_methods_touch_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- update_clients_updated_at stamps now(); the condition skips a second touch in the same
  -- transaction. No clients trigger fires on updated_at alone, so this cannot loop.
  UPDATE public.clients AS c
     SET updated_at = pg_catalog.now()
   WHERE c.id = COALESCE(NEW.client_id, OLD.client_id)
     AND c.tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
     AND c.updated_at IS DISTINCT FROM pg_catalog.now();
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.client_contact_methods_touch_client() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER client_contact_methods_touch_client
  AFTER INSERT OR UPDATE OR DELETE ON public.client_contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.client_contact_methods_touch_client();

-- ─── People: compare before replacing ────────────────────────────────────────────────────────
DROP FUNCTION public.set_user_contact_methods(uuid, jsonb);

CREATE FUNCTION public.set_user_contact_methods(p_user_id uuid, p_methods jsonb, p_expected jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid;
  _result jsonb;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'USER_CONTACT_METHODS_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_CONTACT_METHODS_NO_USER' USING ERRCODE = '22023';
  END IF;
  IF p_expected IS NULL THEN
    RAISE EXCEPTION 'CONTACT_METHODS_EXPECTED_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Yourself; otherwise an owner or admin of your current workspace editing one of its members,
  -- the owner included (an admin holds the owner's powers except removing the owner).
  IF p_user_id <> _actor THEN
    _tenant := public.current_user_tenant_id();
    IF _tenant IS NULL OR NOT public.is_tenant_admin(_tenant) THEN
      RAISE EXCEPTION 'USER_CONTACT_METHODS_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.tenant_members AS tm
     WHERE tm.tenant_id = _tenant AND tm.user_id = p_user_id AND tm.status IN ('active', 'suspended');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'USER_CONTACT_METHODS_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- One writer per person at a time, so the comparison and the write see the same list.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('user_contact_methods:' || p_user_id::text, 0));
  IF public.contact_methods_fingerprint(public._user_contact_methods_payload(p_user_id))
     IS DISTINCT FROM public.contact_methods_fingerprint(p_expected) THEN
    RAISE EXCEPTION 'CONTACT_METHODS_STALE: this list changed since it was loaded' USING ERRCODE = '40001';
  END IF;

  _result := public._replace_user_contact_methods(p_user_id, p_methods);

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_actor, 'user', 'contact_methods_updated', p_user_id,
          jsonb_build_object('tenant_id', _tenant, 'self', p_user_id = _actor,
                             'emails', (SELECT count(*) FROM jsonb_array_elements(_result) e WHERE e->>'kind' = 'email'),
                             'phones', (SELECT count(*) FROM jsonb_array_elements(_result) e WHERE e->>'kind' = 'phone')));
  RETURN _result;
END;
$$;
REVOKE ALL ON FUNCTION public.set_user_contact_methods(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_contact_methods(uuid, jsonb, jsonb) TO authenticated;

-- ─── Clients: upsert_contact requires the version when it replaces the list ──────────────────
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
  _action text;
  _expected timestamptz;
  _current timestamptz;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'CONTACT_EMPTY_PATCH' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key)
    INTO _unknown
    FROM jsonb_object_keys(p_patch) AS allowed(key)
   WHERE key <> ALL (ARRAY[
     'first_name','last_name','email','phone','contact_methods','expected_updated_at','entity_name','entity_type','title',
     'website','linkedin_url','street_address','city','state','zip_code',
     'lifecycle_stage','source','tags','primary_offer','current_notes','status',
     'assigned_coach_user_id','do_not_contact'
   ]);
  IF _unknown IS NOT NULL THEN
    RAISE EXCEPTION 'CONTACT_FIELDS_FORBIDDEN: %', array_to_string(_unknown, ',')
      USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'contact_methods' AND (p_patch ? 'email' OR p_patch ? 'phone') THEN
    RAISE EXCEPTION 'CONTACT_METHODS_AMBIGUOUS: send contact_methods or email/phone, not both'
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
  IF p_patch ? 'expected_updated_at' THEN
    BEGIN
      _expected := (p_patch->>'expected_updated_at')::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'CONTACT_EXPECTED_VERSION_INVALID' USING ERRCODE = '22023';
    END;
    IF _expected IS NULL THEN
      RAISE EXCEPTION 'CONTACT_EXPECTED_VERSION_INVALID' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'contact_methods' THEN
    -- Validated before any write, so a bad list never leaves a half-made contact behind.
    _methods := public.contact_methods_canonical(p_patch->'contact_methods');
    SELECT e->>'value' INTO _email
      FROM jsonb_array_elements(_methods) AS e
     WHERE e->>'kind' = 'email' AND (e->>'is_primary')::boolean
     LIMIT 1;
  ELSE
    _email := NULLIF(btrim(p_patch->>'email'), '');
  END IF;

  IF _contact_id IS NULL THEN
    INSERT INTO public.clients (
      first_name, last_name, email, phone, entity_name, entity_type, title,
      website, linkedin_url, street_address, city, state, zip_code,
      lifecycle_stage, source, tags, primary_offer, current_notes, status,
      assigned_coach_user_id, do_not_contact, created_by, tenant_id, created_by_channel_type
    ) VALUES (
      COALESCE(NULLIF(btrim(p_patch->>'first_name'), ''), NULLIF(split_part(COALESCE(_email, ''), '@', 1), ''), 'New'),
      COALESCE(NULLIF(btrim(p_patch->>'last_name'), ''), 'Contact'),
      CASE WHEN p_patch ? 'contact_methods' THEN NULL ELSE _email END,
      CASE WHEN p_patch ? 'contact_methods' THEN NULL ELSE NULLIF(btrim(p_patch->>'phone'), '') END,
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
    SELECT c.updated_at INTO _current FROM public.clients AS c
     WHERE c.id = _contact_id AND c.tenant_id = _tenant
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONTACT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    -- Replacing an existing contact's list needs the version the caller loaded; a list someone
    -- changed since is refused rather than overwritten.
    IF p_patch ? 'contact_methods' AND _expected IS NULL THEN
      RAISE EXCEPTION 'CONTACT_EXPECTED_VERSION_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF _expected IS NOT NULL AND _current IS DISTINCT FROM _expected THEN
      RAISE EXCEPTION 'CONTACT_METHODS_STALE: this contact changed since it was loaded' USING ERRCODE = '40001';
    END IF;

    UPDATE public.clients AS c SET
      first_name = CASE WHEN p_patch ? 'first_name' THEN COALESCE(NULLIF(btrim(p_patch->>'first_name'), ''), 'New') ELSE c.first_name END,
      last_name = CASE WHEN p_patch ? 'last_name' THEN COALESCE(NULLIF(btrim(p_patch->>'last_name'), ''), 'Contact') ELSE c.last_name END,
      email = CASE WHEN p_patch ? 'email' THEN _email ELSE c.email END,
      phone = CASE WHEN p_patch ? 'phone' THEN NULLIF(btrim(p_patch->>'phone'), '') ELSE c.phone END,
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
          jsonb_build_object('tenant_id', _tenant, 'fields', ARRAY(SELECT jsonb_object_keys(p_patch - 'expected_updated_at')), 'channel', p_channel));
  RETURN _contact_id;
END;
$function$;
