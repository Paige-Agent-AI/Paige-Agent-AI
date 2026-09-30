-- Contact methods: a new contact and its first addresses are created in ONE transaction.
--
-- A contact carries no address on its `clients` row; its addresses are client_contact_methods. The
-- edge functions that create a contact from an inbound address (growth-inbound, handle-inbound-email,
-- public-booking, complete-signup) did it in two requests: insert the `clients` row, then attach the
-- addresses, and delete the row again when the attach was refused. Each request is its own
-- transaction, so:
--   * the insert committed on its own, and its AFTER INSERT triggers ran and committed with it —
--     trg_clients_emit_contact_created wrote a `contact.created` paige_native_events row and queued
--     its dispatch before the contact held any address;
--   * when the attach was refused (an address another contact in the workspace holds, 23505; one the
--     database refuses, 22023) the undo deleted the contact but not what its triggers wrote, so a
--     `contact.created` event survived for a contact that no longer exists (paige_native_events has
--     no foreign key to clients), and the dispatcher then failed it.
--
-- This function does the insert and the attach in one transaction. Either the contact exists with
-- its addresses, or nothing — no row, no event, no queued dispatch — was written. The error the
-- attach raises (23505 for a taken address, 22023 for a refused one) reaches the caller unchanged,
-- so the callers' existing handling (public-booking finds the contact that won a concurrent create)
-- keeps working.
--
-- create_contact_v2 was the first candidate and does not fit: it takes a fixed parameter list (none
-- of complete-signup's fields beyond the basics), returns an existing contact instead of failing,
-- forces status and a default last name, and requires the creator to be a workspace owner or admin
-- (a booking host, the sender-of-record for inbound email and a self-serve signup are not).
--
-- Trust boundary. Service role only. The caller has already resolved the workspace from something it
-- trusts (a form's registered source, a tenant's inbound address, a booking page, the signing-up
-- user's own workspace) and passes it as `_tenant_id`; the function never reads a workspace from the
-- contact fields. It is not granted to anon or authenticated, so no browser can name a workspace.
--
--   _tenant_id  the contact's workspace.
--   _client     the `clients` columns to set, as a JSON object. Any column not named keeps its
--               default. `id`, `tenant_id`, `email` and `phone` are refused: the id is generated, the
--               workspace is `_tenant_id`, and an address is a contact method. A key that is not a
--               `clients` column is refused rather than ignored.
--   _methods    the contact's first addresses, as the contact-methods list the add helper takes.
--               Entries with no value are skipped; the rest are refused exactly as the add helper
--               refuses them.
-- Returns the new contact's id.
--
-- ─── A person's primary address, set by the server ──────────────────────────────────────────
-- _set_user_primary_address(_user_id, _kind, _value) makes an address a person's primary of its
-- kind, keeping every address they hold: one they already hold is promoted, a new one is added as
-- primary, the previous primary stays on the list, and a blank value changes nothing. It replaces
-- the edge helper setUserPrimaryAddress's read-then-upsert (provider webhooks, Paige's write-back,
-- the credit-report import), which wrote back the old primary's label, value and position as it had
-- read them, so a relabel or reorder another session saved in between was silently undone. It runs
-- under the same per-person advisory lock as set_user_contact_methods ('user_contact_methods:' ||
-- user id), so a checked save of the whole list and this change never interleave, and it reads the
-- list only after taking that lock.
--
-- Trust boundary. Service role only, like the create above: the calling function has already decided
-- whose address it may set. It refuses a caller that carries a signed-in person's identity (they
-- save their own list through set_user_contact_methods, which checks the list they loaded), and it
-- is not granted to anon or authenticated.

CREATE FUNCTION public._create_client_with_contact_methods(_tenant_id uuid, _client jsonb, _methods jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _refused text;
  _columns text;
  _values text;
  _list jsonb;
  _id uuid;
BEGIN
  IF _tenant_id IS NULL THEN
    RAISE EXCEPTION 'CONTACT_NO_TENANT: a contact belongs to a workspace' USING ERRCODE = '22023';
  END IF;
  IF _client IS NULL OR pg_catalog.jsonb_typeof(_client) <> 'object' THEN
    RAISE EXCEPTION 'CONTACT_FIELDS_INVALID: the contact''s fields are a JSON object' USING ERRCODE = '22023';
  END IF;
  IF _methods IS NOT NULL AND pg_catalog.jsonb_typeof(_methods) <> 'array' THEN
    RAISE EXCEPTION 'CONTACT_METHODS_INVALID: the contact''s addresses are a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.string_agg(k, ', ' ORDER BY k) INTO _refused
    FROM pg_catalog.jsonb_object_keys(_client) AS k
   WHERE k IN ('id', 'tenant_id', 'email', 'phone')
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute AS a
                      WHERE a.attrelid = 'public.clients'::regclass
                        AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped);
  IF _refused IS NOT NULL THEN
    RAISE EXCEPTION 'CONTACT_FIELDS_REFUSED: % cannot be set when creating a contact', _refused
      USING ERRCODE = '22023',
            HINT = 'The workspace is _tenant_id, the id is generated, and addresses are _methods.';
  END IF;

  -- Only the named columns are written, so every other column keeps its default. The values are
  -- typed by jsonb_populate_record against the table's own row type.
  SELECT COALESCE(pg_catalog.string_agg(pg_catalog.format(', %I', k), '' ORDER BY k), ''),
         COALESCE(pg_catalog.string_agg(pg_catalog.format(', r.%I', k), '' ORDER BY k), '')
    INTO _columns, _values
    FROM pg_catalog.jsonb_object_keys(_client) AS k;
  EXECUTE pg_catalog.format(
      'INSERT INTO public.clients (tenant_id%s) SELECT $1%s FROM pg_catalog.jsonb_populate_record(NULL::public.clients, $2) AS r RETURNING id',
      _columns, _values)
    INTO _id
    USING _tenant_id, _client;

  SELECT COALESCE(pg_catalog.jsonb_agg(e ORDER BY o), '[]'::jsonb) INTO _list
    FROM pg_catalog.jsonb_array_elements(COALESCE(_methods, '[]'::jsonb)) WITH ORDINALITY AS t(e, o)
   WHERE NULLIF(pg_catalog.btrim(e->>'value'), '') IS NOT NULL;
  IF pg_catalog.jsonb_array_length(_list) > 0 THEN
    PERFORM public._add_client_contact_methods(_tenant_id, _id, _list);
  END IF;

  RETURN _id;
END;
$function$;

REVOKE ALL ON FUNCTION public._create_client_with_contact_methods(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._create_client_with_contact_methods(uuid, jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION public._create_client_with_contact_methods(uuid, jsonb, jsonb) IS
  'Service role only. Creates a contact and attaches its first addresses in one transaction: the contact exists with its addresses, or nothing (no row, no contact.created event) was written.';

-- ─── A person's primary address ──────────────────────────────────────────────────────────────
CREATE FUNCTION public._set_user_primary_address(_user_id uuid, _kind text, _value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  _v text := pg_catalog.regexp_replace(COALESCE(_value, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  _same_id uuid;
  _same_is_primary boolean;
  _primary_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'USER_CONTACT_METHODS_FORBIDDEN: a signed-in person saves their list with set_user_contact_methods'
      USING ERRCODE = '42501';
  END IF;
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'USER_CONTACT_METHODS_NO_USER' USING ERRCODE = '22023';
  END IF;
  IF _kind IS NULL OR _kind NOT IN ('email', 'phone') THEN
    RAISE EXCEPTION 'CONTACT_METHOD_KIND_INVALID: an address is an email or a phone' USING ERRCODE = '22023';
  END IF;
  -- A blank value changes nothing: this never removes an address.
  IF _v = '' THEN
    RETURN;
  END IF;

  -- One writer per person at a time (the key set_user_contact_methods takes), and the rows of this
  -- kind locked as well, so the list read below is the list written against.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('user_contact_methods:' || _user_id::text, 0));
  PERFORM 1 FROM public.user_contact_methods AS m
   WHERE m.user_id = _user_id AND m.kind = _kind
     FOR UPDATE;

  SELECT m.id, m.is_primary INTO _same_id, _same_is_primary
    FROM public.user_contact_methods AS m
   WHERE m.user_id = _user_id AND m.kind = _kind
     AND m.match_key = public.contact_method_match_key(_kind, _v);
  SELECT m.id INTO _primary_id
    FROM public.user_contact_methods AS m
   WHERE m.user_id = _user_id AND m.kind = _kind AND m.is_primary;

  IF _same_id IS NOT NULL AND _same_is_primary THEN
    RETURN;
  END IF;

  -- The old primary keeps its value, label and position as they are NOW; only its flag changes.
  -- The one-primary rules are checked at commit, so the moment between these statements is unseen.
  IF _primary_id IS NOT NULL THEN
    UPDATE public.user_contact_methods AS m SET is_primary = false WHERE m.id = _primary_id;
  END IF;
  IF _same_id IS NOT NULL THEN
    UPDATE public.user_contact_methods AS m SET is_primary = true WHERE m.id = _same_id;
  ELSE
    INSERT INTO public.user_contact_methods (user_id, kind, value, label, is_primary, position)
    VALUES (_user_id, _kind, _v, NULL, true,
            COALESCE((SELECT max(m.position) + 1 FROM public.user_contact_methods AS m
                       WHERE m.user_id = _user_id AND m.kind = _kind), 0));
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public._set_user_primary_address(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._set_user_primary_address(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public._set_user_primary_address(uuid, text, text) IS
  'Service role only. Makes an address a person''s primary of its kind under the per-person contact-methods lock, keeping every address they hold; a blank value changes nothing.';
