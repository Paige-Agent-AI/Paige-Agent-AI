-- Contact methods: a person's actual contact surface, not one email and one phone.
--
-- A client contact and a platform user can each hold several email addresses and several phone
-- numbers, labelled and ordered, with exactly one primary of each kind. Before this migration a
-- client held `clients.email` + `clients.phone` and a user held `profiles.work_email` +
-- `profiles.phone`, so Paige could not recognise a client writing from their second address.
--
-- The rules live in the data, not in a screen:
--   * at most one primary per owner and kind      — deferrable exclusion constraint;
--   * at least one primary whenever any exist     — deferred constraint trigger;
--   * an email address identifies ONE contact in a workspace, whichever of that contact's
--     addresses it is                              — unique (tenant, match key) for client emails
--     (this replaces the job `uq_clients_tenant_email` did for the single column);
--   * a method belongs to its contact's workspace — composite FK (client_id, tenant_id);
--   * a phone matches on its last ten digits, the rule inbound matching already used.
--
-- Rollout (owner ruling 2026-09-28, recorded in the Lane A plan): consumers move across in
-- separate pull requests, so for the length of that rollout `clients.email/phone` and
-- `profiles.work_email/phone` are kept as a READ-ONLY COPY of the primary method, synced both
-- ways by the four `*_legacy` triggers below. The pull request that removes the last reader
-- drops those columns, those triggers and `uq_clients_tenant_email` together. Nothing here is a
-- switch or a pilot gate: every account gets the model at once.
--
-- Backfill: every existing client email/phone and every profile work email/phone becomes that
-- record's primary. A user with no work email gets their sign-in address as primary, labelled
-- 'Sign-in' (owner ruling 2026-09-28). Measured on production immediately before writing this:
-- 8 client emails, 8 client phones, 3 profile work emails, 3 profile phones, 18 sign-in emails;
-- every one passes the checks below and no two clients in one workspace share an email.
--
-- Writes: authenticated callers have SELECT only. Client methods are written through
-- `upsert_contact` (new `contact_methods` patch key); user methods through
-- `set_user_contact_methods`. Both are SECURITY DEFINER and re-derive the caller's scope in-body
-- (§59). Visibility of a client's methods is delegated to the caller's own row access on
-- `clients`, so no second copy of those policies exists.

-- migration-lint-ignore: pattern-2 -- every INSERT … SELECT here filters its source to rows whose
-- mapped NOT NULL columns are present (non-empty address, existing tenant/user) or maps literals.

-- ─── Normalisation ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.contact_method_match_key(_kind text, _value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE _kind
    WHEN 'email' THEN pg_catalog.lower(pg_catalog.btrim(_value))
    WHEN 'phone' THEN pg_catalog.right(pg_catalog.regexp_replace(_value, '[^0-9]', '', 'g'), 10)
  END
$$;

-- ─── Tables ─────────────────────────────────────────────────────────────────────────────────
-- The composite key a method's foreign key needs. `id` is already unique, so this cannot fail.
ALTER TABLE public.clients ADD CONSTRAINT clients_id_tenant_key UNIQUE (id, tenant_id);

CREATE TABLE public.client_contact_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('email', 'phone')),
  value text NOT NULL,
  match_key text GENERATED ALWAYS AS (public.contact_method_match_key(kind, value)) STORED,
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_contact_methods_client_fkey
    FOREIGN KEY (client_id, tenant_id) REFERENCES public.clients (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT client_contact_methods_value_trimmed CHECK (value = pg_catalog.btrim(value) AND char_length(value) BETWEEN 3 AND 254),
  CONSTRAINT client_contact_methods_email_shape CHECK (kind <> 'email' OR value ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT client_contact_methods_phone_shape CHECK (kind <> 'phone' OR (char_length(value) <= 40 AND char_length(pg_catalog.regexp_replace(value, '[^0-9]', '', 'g')) BETWEEN 7 AND 15)),
  CONSTRAINT client_contact_methods_label_shape CHECK (label IS NULL OR (label = pg_catalog.btrim(label) AND char_length(label) BETWEEN 1 AND 40)),
  CONSTRAINT client_contact_methods_no_duplicate UNIQUE (client_id, kind, match_key),
  CONSTRAINT client_contact_methods_position_key UNIQUE (client_id, kind, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT client_contact_methods_one_primary
    EXCLUDE USING btree (client_id WITH =, kind WITH =) WHERE (is_primary) DEFERRABLE INITIALLY DEFERRED
);

-- An email address belongs to one contact per workspace, whichever of their addresses it is.
CREATE UNIQUE INDEX client_contact_methods_tenant_email_key
  ON public.client_contact_methods (tenant_id, match_key) WHERE kind = 'email';
-- Inbound phone matching reads (tenant, last ten digits).
CREATE INDEX client_contact_methods_tenant_phone_idx
  ON public.client_contact_methods (tenant_id, match_key) WHERE kind = 'phone';

CREATE TABLE public.user_contact_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'phone')),
  value text NOT NULL,
  match_key text GENERATED ALWAYS AS (public.contact_method_match_key(kind, value)) STORED,
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_contact_methods_value_trimmed CHECK (value = pg_catalog.btrim(value) AND char_length(value) BETWEEN 3 AND 254),
  CONSTRAINT user_contact_methods_email_shape CHECK (kind <> 'email' OR value ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT user_contact_methods_phone_shape CHECK (kind <> 'phone' OR (char_length(value) <= 40 AND char_length(pg_catalog.regexp_replace(value, '[^0-9]', '', 'g')) BETWEEN 7 AND 15)),
  CONSTRAINT user_contact_methods_label_shape CHECK (label IS NULL OR (label = pg_catalog.btrim(label) AND char_length(label) BETWEEN 1 AND 40)),
  CONSTRAINT user_contact_methods_no_duplicate UNIQUE (user_id, kind, match_key),
  CONSTRAINT user_contact_methods_position_key UNIQUE (user_id, kind, position) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT user_contact_methods_one_primary
    EXCLUDE USING btree (user_id WITH =, kind WITH =) WHERE (is_primary) DEFERRABLE INITIALLY DEFERRED
);

CREATE TRIGGER client_contact_methods_updated_at BEFORE UPDATE ON public.client_contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER user_contact_methods_updated_at BEFORE UPDATE ON public.user_contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- A method never changes owner. Moving an address is a delete on one owner and an insert on another.
CREATE FUNCTION public.contact_methods_owner_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF pg_catalog.to_jsonb(NEW) - ARRAY['value','match_key','label','is_primary','position','updated_at']
     IS DISTINCT FROM pg_catalog.to_jsonb(OLD) - ARRAY['value','match_key','label','is_primary','position','updated_at'] THEN
    RAISE EXCEPTION 'CONTACT_METHOD_OWNER_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER client_contact_methods_owner_immutable BEFORE UPDATE ON public.client_contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.contact_methods_owner_immutable();
CREATE TRIGGER user_contact_methods_owner_immutable BEFORE UPDATE ON public.user_contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.contact_methods_owner_immutable();

-- Exactly one primary whenever a kind has any methods. Checked at commit so a primary can move
-- inside one transaction. SECURITY DEFINER because a deferred check runs as the committing
-- session, and row security must not hide the rows being counted.
CREATE FUNCTION public.contact_methods_require_primary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _owner_col text := CASE TG_TABLE_NAME WHEN 'client_contact_methods' THEN 'client_id' ELSE 'user_id' END;
  _row jsonb;
  _total integer;
  _primaries integer;
BEGIN
  FOREACH _row IN ARRAY ARRAY[
    CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN pg_catalog.to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN pg_catalog.to_jsonb(NEW) END
  ] LOOP
    CONTINUE WHEN _row IS NULL;
    EXECUTE pg_catalog.format(
      'SELECT count(*), count(*) FILTER (WHERE is_primary) FROM public.%I WHERE %I = $1 AND kind = $2',
      TG_TABLE_NAME, _owner_col)
      INTO _total, _primaries
      USING (_row->>_owner_col)::uuid, _row->>'kind';
    IF _total > 0 AND _primaries <> 1 THEN
      RAISE EXCEPTION 'CONTACT_METHOD_PRIMARY_REQUIRED: exactly one primary % is required', _row->>'kind'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER client_contact_methods_require_primary
  AFTER INSERT OR UPDATE OR DELETE ON public.client_contact_methods
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.contact_methods_require_primary();
CREATE CONSTRAINT TRIGGER user_contact_methods_require_primary
  AFTER INSERT OR UPDATE OR DELETE ON public.user_contact_methods
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.contact_methods_require_primary();

-- ─── Row security and grants ────────────────────────────────────────────────────────────────
ALTER TABLE public.client_contact_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_contact_methods ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.client_contact_methods FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_contact_methods FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_contact_methods TO authenticated;
GRANT SELECT ON public.user_contact_methods TO authenticated;
GRANT ALL ON public.client_contact_methods TO service_role;
GRANT ALL ON public.user_contact_methods TO service_role;

-- Whoever can read the contact can read its methods: the caller's own policies on `clients`
-- decide, evaluated as the caller.
CREATE POLICY client_contact_methods_read_with_contact ON public.client_contact_methods
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.clients AS c
     WHERE c.id = client_contact_methods.client_id
       AND c.tenant_id = client_contact_methods.tenant_id
  ));

-- A person reads their own methods; an owner or admin of the caller's current workspace reads
-- those of that workspace's members; the platform owner reads any.
CREATE FUNCTION public.can_read_user_contact_methods(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    _user_id = auth.uid()
    OR public.is_platform_owner()
    OR (
      public.is_tenant_admin(public.current_user_tenant_id())
      AND EXISTS (
        SELECT 1 FROM public.tenant_members AS tm
         WHERE tm.tenant_id = public.current_user_tenant_id()
           AND tm.user_id = _user_id
           AND tm.status IN ('active', 'suspended')
      )
    )
  )
$$;
REVOKE ALL ON FUNCTION public.can_read_user_contact_methods(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_user_contact_methods(uuid) TO authenticated, service_role;

CREATE POLICY user_contact_methods_read ON public.user_contact_methods
  FOR SELECT TO authenticated
  USING (public.can_read_user_contact_methods(user_id));

-- ─── Backfill ───────────────────────────────────────────────────────────────────────────────
INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position)
SELECT c.tenant_id, c.id, 'email', pg_catalog.btrim(c.email), true, 0
  FROM public.clients AS c
 WHERE NULLIF(pg_catalog.btrim(c.email), '') IS NOT NULL;

INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position)
SELECT c.tenant_id, c.id, 'phone', pg_catalog.btrim(c.phone), true, 0
  FROM public.clients AS c
 WHERE NULLIF(pg_catalog.btrim(c.phone), '') IS NOT NULL;

INSERT INTO public.user_contact_methods (user_id, kind, value, label, is_primary, position)
SELECT u.id, 'email',
       COALESCE(NULLIF(pg_catalog.btrim(p.work_email), ''), pg_catalog.btrim(u.email)),
       CASE WHEN NULLIF(pg_catalog.btrim(p.work_email), '') IS NOT NULL THEN 'Work' ELSE 'Sign-in' END,
       true, 0
  FROM auth.users AS u
  LEFT JOIN public.profiles AS p ON p.user_id = u.id
 WHERE COALESCE(NULLIF(pg_catalog.btrim(p.work_email), ''), NULLIF(pg_catalog.btrim(u.email), '')) IS NOT NULL;

INSERT INTO public.user_contact_methods (user_id, kind, value, is_primary, position)
SELECT p.user_id, 'phone', pg_catalog.btrim(p.phone), true, 0
  FROM public.profiles AS p
 WHERE NULLIF(pg_catalog.btrim(p.phone), '') IS NOT NULL
   AND EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = p.user_id);

-- ─── Input contract, shared by every writer ────────────────────────────────────────────────
-- Accepts [{kind, value, label?, is_primary?}] in display order and returns the canonical list
-- [{kind, value, label, is_primary, position}], or raises a named error. A kind with methods and
-- no flagged primary gets its first method as primary; two flagged primaries of one kind is an
-- error, never a guess.
CREATE FUNCTION public.contact_methods_canonical(_methods jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  _item jsonb;
  _kind text;
  _value text;
  _label text;
  _unknown text;
  _out jsonb := '[]'::jsonb;
  _seen text[] := '{}';
  _pos jsonb := '{"email":0,"phone":0}'::jsonb;
  _primaries jsonb := '{"email":0,"phone":0}'::jsonb;
  _k text;
BEGIN
  IF _methods IS NULL OR pg_catalog.jsonb_typeof(_methods) <> 'array' THEN
    RAISE EXCEPTION 'CONTACT_METHODS_NOT_A_LIST' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_array_length(_methods) > 40 THEN
    RAISE EXCEPTION 'CONTACT_METHODS_TOO_MANY' USING ERRCODE = '22023';
  END IF;

  FOR _item IN SELECT e FROM pg_catalog.jsonb_array_elements(_methods) AS e LOOP
    IF pg_catalog.jsonb_typeof(_item) <> 'object' THEN
      RAISE EXCEPTION 'CONTACT_METHOD_NOT_AN_OBJECT' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.string_agg(k, ',' ORDER BY k) INTO _unknown
      FROM pg_catalog.jsonb_object_keys(_item) AS k
     WHERE k <> ALL (ARRAY['kind','value','label','is_primary']);
    IF _unknown IS NOT NULL THEN
      RAISE EXCEPTION 'CONTACT_METHOD_FIELDS_FORBIDDEN: %', _unknown USING ERRCODE = '22023';
    END IF;

    _kind := _item->>'kind';
    IF _kind IS NULL OR _kind NOT IN ('email', 'phone') THEN
      RAISE EXCEPTION 'CONTACT_METHOD_BAD_KIND' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.jsonb_typeof(_item->'value') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'CONTACT_METHOD_VALUE_REQUIRED' USING ERRCODE = '22023';
    END IF;
    _value := pg_catalog.btrim(_item->>'value');
    IF _kind = 'email' AND (char_length(_value) NOT BETWEEN 3 AND 254
        OR _value !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN
      RAISE EXCEPTION 'CONTACT_METHOD_INVALID_EMAIL: %', _value USING ERRCODE = '22023';
    END IF;
    IF _kind = 'phone' AND (char_length(_value) > 40
        OR char_length(pg_catalog.regexp_replace(_value, '[^0-9]', '', 'g')) NOT BETWEEN 7 AND 15) THEN
      RAISE EXCEPTION 'CONTACT_METHOD_INVALID_PHONE: %', _value USING ERRCODE = '22023';
    END IF;

    IF _item ? 'label' AND _item->'label' <> 'null'::jsonb
       AND pg_catalog.jsonb_typeof(_item->'label') <> 'string' THEN
      RAISE EXCEPTION 'CONTACT_METHOD_BAD_LABEL' USING ERRCODE = '22023';
    END IF;
    _label := NULLIF(pg_catalog.btrim(_item->>'label'), '');
    IF char_length(_label) > 40 THEN
      RAISE EXCEPTION 'CONTACT_METHOD_BAD_LABEL' USING ERRCODE = '22023';
    END IF;
    IF _item ? 'is_primary' AND pg_catalog.jsonb_typeof(_item->'is_primary') <> 'boolean' THEN
      RAISE EXCEPTION 'CONTACT_METHOD_BAD_PRIMARY' USING ERRCODE = '22023';
    END IF;

    _k := _kind || ':' || public.contact_method_match_key(_kind, _value);
    IF _k = ANY(_seen) THEN
      RAISE EXCEPTION 'CONTACT_METHOD_DUPLICATE: %', _value USING ERRCODE = '22023';
    END IF;
    _seen := _seen || _k;
    IF (_pos->>_kind)::int >= 20 THEN
      RAISE EXCEPTION 'CONTACT_METHODS_TOO_MANY' USING ERRCODE = '22023';
    END IF;
    IF COALESCE((_item->>'is_primary')::boolean, false) THEN
      _primaries := pg_catalog.jsonb_set(_primaries, ARRAY[_kind], pg_catalog.to_jsonb((_primaries->>_kind)::int + 1));
    END IF;

    _out := _out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind', _kind, 'value', _value, 'label', _label,
      'is_primary', COALESCE((_item->>'is_primary')::boolean, false),
      'position', (_pos->>_kind)::int));
    _pos := pg_catalog.jsonb_set(_pos, ARRAY[_kind], pg_catalog.to_jsonb((_pos->>_kind)::int + 1));
  END LOOP;

  FOREACH _k IN ARRAY ARRAY['email', 'phone'] LOOP
    IF (_primaries->>_k)::int > 1 THEN
      RAISE EXCEPTION 'CONTACT_METHOD_PRIMARY_CONFLICT: more than one primary %', _k USING ERRCODE = '22023';
    END IF;
    IF (_primaries->>_k)::int = 0 AND (_pos->>_k)::int > 0 THEN
      SELECT pg_catalog.jsonb_agg(
               CASE WHEN e->>'kind' = _k AND (e->>'position')::int = 0
                    THEN pg_catalog.jsonb_set(e, '{is_primary}', 'true'::jsonb) ELSE e END
               ORDER BY o)
        INTO _out
        FROM pg_catalog.jsonb_array_elements(_out) WITH ORDINALITY AS t(e, o);
    END IF;
  END LOOP;
  RETURN _out;
END;
$$;
REVOKE ALL ON FUNCTION public.contact_methods_canonical(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contact_methods_canonical(jsonb) TO authenticated, service_role;

-- ─── Read shapes ────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public._client_contact_methods_json(_client_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'value', m.value, 'label', m.label,
           'is_primary', m.is_primary, 'position', m.position)
           ORDER BY m.kind, m.position), '[]'::jsonb)
    FROM public.client_contact_methods AS m
   WHERE m.client_id = _client_id
$$;
REVOKE ALL ON FUNCTION public._client_contact_methods_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._client_contact_methods_json(uuid) TO service_role;

CREATE FUNCTION public._user_contact_methods_json(_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'value', m.value, 'label', m.label,
           'is_primary', m.is_primary, 'position', m.position)
           ORDER BY m.kind, m.position), '[]'::jsonb)
    FROM public.user_contact_methods AS m
   WHERE m.user_id = _user_id
$$;
REVOKE ALL ON FUNCTION public._user_contact_methods_json(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._user_contact_methods_json(uuid) TO service_role;

-- ─── Replace a whole set ────────────────────────────────────────────────────────────────────
-- The list is the complete set for the owner: an address missing from it is removed. Existing
-- rows are kept (by address) so their ids and created_at survive a reorder or a relabel.
-- Internal: reached only from SECURITY DEFINER writers that have already resolved and
-- authorised the owner, so it holds no grants.
CREATE FUNCTION public._replace_client_contact_methods(_tenant_id uuid, _client_id uuid, _methods jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _canon jsonb := public.contact_methods_canonical(_methods);
  _taken text;
BEGIN
  PERFORM 1 FROM public.clients AS c WHERE c.id = _client_id AND c.tenant_id = _tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.client_contact_methods AS m
   WHERE m.client_id = _client_id
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(_canon) AS e
        WHERE e->>'kind' = m.kind
          AND public.contact_method_match_key(e->>'kind', e->>'value') = m.match_key);

  UPDATE public.client_contact_methods AS m
     SET value = e.value, label = e.label, is_primary = e.is_primary, position = e.position
    FROM pg_catalog.jsonb_to_recordset(_canon) AS e(kind text, value text, label text, is_primary boolean, position integer)
   WHERE m.client_id = _client_id
     AND m.kind = e.kind
     AND m.match_key = public.contact_method_match_key(e.kind, e.value)
     AND (m.value, m.label, m.is_primary, m.position) IS DISTINCT FROM (e.value, e.label, e.is_primary, e.position);

  BEGIN
    INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, label, is_primary, position)
    SELECT _tenant_id, _client_id, e.kind, e.value, e.label, e.is_primary, e.position
      FROM pg_catalog.jsonb_to_recordset(_canon) AS e(kind text, value text, label text, is_primary boolean, position integer)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.client_contact_methods AS m
        WHERE m.client_id = _client_id AND m.kind = e.kind
          AND m.match_key = public.contact_method_match_key(e.kind, e.value));
  EXCEPTION WHEN unique_violation THEN
    SELECT e->>'value' INTO _taken
      FROM pg_catalog.jsonb_array_elements(_canon) AS e
     WHERE e->>'kind' = 'email'
       AND EXISTS (
         SELECT 1 FROM public.client_contact_methods AS m
          WHERE m.tenant_id = _tenant_id AND m.kind = 'email' AND m.client_id <> _client_id
            AND m.match_key = public.contact_method_match_key('email', e->>'value'))
     LIMIT 1;
    RAISE EXCEPTION 'CONTACT_METHOD_TAKEN: % already belongs to another contact in this workspace',
      COALESCE(_taken, 'that address') USING ERRCODE = '23505';
  END;

  RETURN public._client_contact_methods_json(_client_id);
END;
$$;
REVOKE ALL ON FUNCTION public._replace_client_contact_methods(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._replace_user_contact_methods(_user_id uuid, _methods jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _canon jsonb := public.contact_methods_canonical(_methods);
BEGIN
  DELETE FROM public.user_contact_methods AS m
   WHERE m.user_id = _user_id
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.jsonb_array_elements(_canon) AS e
        WHERE e->>'kind' = m.kind
          AND public.contact_method_match_key(e->>'kind', e->>'value') = m.match_key);

  UPDATE public.user_contact_methods AS m
     SET value = e.value, label = e.label, is_primary = e.is_primary, position = e.position
    FROM pg_catalog.jsonb_to_recordset(_canon) AS e(kind text, value text, label text, is_primary boolean, position integer)
   WHERE m.user_id = _user_id
     AND m.kind = e.kind
     AND m.match_key = public.contact_method_match_key(e.kind, e.value)
     AND (m.value, m.label, m.is_primary, m.position) IS DISTINCT FROM (e.value, e.label, e.is_primary, e.position);

  INSERT INTO public.user_contact_methods (user_id, kind, value, label, is_primary, position)
  SELECT _user_id, e.kind, e.value, e.label, e.is_primary, e.position
    FROM pg_catalog.jsonb_to_recordset(_canon) AS e(kind text, value text, label text, is_primary boolean, position integer)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.user_contact_methods AS m
      WHERE m.user_id = _user_id AND m.kind = e.kind
        AND m.match_key = public.contact_method_match_key(e.kind, e.value));

  RETURN public._user_contact_methods_json(_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public._replace_user_contact_methods(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Adds one address to a client; it becomes primary only if the client has none of that kind.
-- Used by the create paths that start a contact from a single address (an inbound sender, a
-- booking guest, an intake payload).
CREATE FUNCTION public._attach_client_address(_tenant_id uuid, _client_id uuid, _kind text, _value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _v text := NULLIF(pg_catalog.btrim(_value), '');
BEGIN
  IF _v IS NULL THEN RETURN; END IF;
  INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position)
  SELECT _tenant_id, _client_id, _kind, _v,
         NOT EXISTS (SELECT 1 FROM public.client_contact_methods AS m WHERE m.client_id = _client_id AND m.kind = _kind),
         COALESCE((SELECT max(m.position) + 1 FROM public.client_contact_methods AS m WHERE m.client_id = _client_id AND m.kind = _kind), 0)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.client_contact_methods AS m
      WHERE m.client_id = _client_id AND m.kind = _kind
        AND m.match_key = public.contact_method_match_key(_kind, _v));
END;
$$;
REVOKE ALL ON FUNCTION public._attach_client_address(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- The contact an address identifies in one workspace, whichever of their addresses it is.
CREATE FUNCTION public.client_id_for_address(_tenant_id uuid, _kind text, _value text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.client_id
    FROM public.client_contact_methods AS m
    JOIN public.clients AS c ON c.id = m.client_id
   WHERE m.tenant_id = _tenant_id
     AND m.kind = _kind
     AND NULLIF(pg_catalog.btrim(_value), '') IS NOT NULL
     AND m.match_key = public.contact_method_match_key(_kind, _value)
     AND (_kind <> 'phone' OR char_length(m.match_key) >= 7)
   ORDER BY m.is_primary DESC, c.created_at, c.id
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.client_id_for_address(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_id_for_address(uuid, text, text) TO service_role;

-- ─── The rollout mirror (deleted with the old columns) ──────────────────────────────────────
-- Old column written → the primary method follows it. Clearing the column removes the primary
-- and promotes the next address. Setting it to an address the owner already holds makes that
-- address primary. Otherwise the primary's address is replaced.
CREATE FUNCTION public._legacy_address_to_methods(_table text, _owner uuid, _tenant_id uuid, _kind text, _raw text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _owner_col text := CASE _table WHEN 'client_contact_methods' THEN 'client_id' ELSE 'user_id' END;
  _v text := NULLIF(pg_catalog.btrim(_raw), '');
  _primary_id uuid;
  _primary_value text;
  _same_id uuid;
BEGIN
  EXECUTE pg_catalog.format(
    'SELECT id, value FROM public.%I WHERE %I = $1 AND kind = $2 AND is_primary ORDER BY position LIMIT 1',
    _table, _owner_col) INTO _primary_id, _primary_value USING _owner, _kind;

  IF _v IS NULL THEN
    IF _primary_id IS NOT NULL THEN
      EXECUTE pg_catalog.format('DELETE FROM public.%I WHERE id = $1', _table) USING _primary_id;
      EXECUTE pg_catalog.format(
        'UPDATE public.%1$I SET is_primary = true WHERE id = (SELECT id FROM public.%1$I WHERE %2$I = $1 AND kind = $2 ORDER BY position LIMIT 1)',
        _table, _owner_col) USING _owner, _kind;
    END IF;
    RETURN;
  END IF;

  IF _primary_value IS NOT DISTINCT FROM _v THEN RETURN; END IF;

  EXECUTE pg_catalog.format(
    'SELECT id FROM public.%I WHERE %I = $1 AND kind = $2 AND match_key = public.contact_method_match_key($2, $3)',
    _table, _owner_col) INTO _same_id USING _owner, _kind, _v;

  IF _same_id IS NOT NULL THEN
    IF _primary_id IS NOT NULL AND _primary_id <> _same_id THEN
      EXECUTE pg_catalog.format('UPDATE public.%I SET is_primary = false WHERE id = $1', _table) USING _primary_id;
    END IF;
    EXECUTE pg_catalog.format('UPDATE public.%I SET is_primary = true, value = $2 WHERE id = $1', _table) USING _same_id, _v;
  ELSIF _primary_id IS NOT NULL THEN
    EXECUTE pg_catalog.format('UPDATE public.%I SET value = $2 WHERE id = $1', _table) USING _primary_id, _v;
  ELSIF _table = 'client_contact_methods' THEN
    INSERT INTO public.client_contact_methods (tenant_id, client_id, kind, value, is_primary, position)
    VALUES (_tenant_id, _owner, _kind, _v, true,
            COALESCE((SELECT max(m.position) + 1 FROM public.client_contact_methods AS m WHERE m.client_id = _owner AND m.kind = _kind), 0));
  ELSE
    INSERT INTO public.user_contact_methods (user_id, kind, value, is_primary, position)
    VALUES (_owner, _kind, _v, true,
            COALESCE((SELECT max(m.position) + 1 FROM public.user_contact_methods AS m WHERE m.user_id = _owner AND m.kind = _kind), 0));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._legacy_address_to_methods(text, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Shows a person's primary methods in the old profile columns; a no-op when they already do.
CREATE FUNCTION public._user_methods_to_profile(_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _email text;
  _phone text;
BEGIN
  SELECT m.value INTO _email FROM public.user_contact_methods AS m
   WHERE m.user_id = _user AND m.kind = 'email' AND m.is_primary ORDER BY m.position LIMIT 1;
  SELECT m.value INTO _phone FROM public.user_contact_methods AS m
   WHERE m.user_id = _user AND m.kind = 'phone' AND m.is_primary ORDER BY m.position LIMIT 1;
  UPDATE public.profiles AS p SET work_email = _email, phone = _phone
   WHERE p.user_id = _user
     AND (p.work_email IS DISTINCT FROM _email OR p.phone IS DISTINCT FROM _phone);
END;
$$;
REVOKE ALL ON FUNCTION public._user_methods_to_profile(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.clients_legacy_address_to_methods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- An insert carrying no address expresses no intent to clear one.
  IF (TG_OP = 'INSERT' AND NEW.email IS NOT NULL) OR (TG_OP = 'UPDATE' AND NEW.email IS DISTINCT FROM OLD.email) THEN
    PERFORM public._legacy_address_to_methods('client_contact_methods', NEW.id, NEW.tenant_id, 'email', NEW.email);
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.phone IS NOT NULL) OR (TG_OP = 'UPDATE' AND NEW.phone IS DISTINCT FROM OLD.phone) THEN
    PERFORM public._legacy_address_to_methods('client_contact_methods', NEW.id, NEW.tenant_id, 'phone', NEW.phone);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER clients_legacy_address_to_methods
  AFTER INSERT OR UPDATE OF email, phone ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_legacy_address_to_methods();

CREATE FUNCTION public.profiles_legacy_address_to_methods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.user_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = NEW.user_id) THEN
    RETURN NULL;
  END IF;
  -- An insert carrying no address expresses no intent to clear one: a profile row created after
  -- the person's sign-in address was seeded must not delete it.
  IF (TG_OP = 'INSERT' AND NEW.work_email IS NOT NULL) OR (TG_OP = 'UPDATE' AND NEW.work_email IS DISTINCT FROM OLD.work_email) THEN
    PERFORM public._legacy_address_to_methods('user_contact_methods', NEW.user_id, NULL, 'email', NEW.work_email);
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.phone IS NOT NULL) OR (TG_OP = 'UPDATE' AND NEW.phone IS DISTINCT FROM OLD.phone) THEN
    PERFORM public._legacy_address_to_methods('user_contact_methods', NEW.user_id, NULL, 'phone', NEW.phone);
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- The new row then shows whatever primary the person already has.
    PERFORM public._user_methods_to_profile(NEW.user_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER profiles_legacy_address_to_methods
  AFTER INSERT OR UPDATE OF work_email, phone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_legacy_address_to_methods();

-- Methods changed → the old columns show the primary. A no-op when they already do, which is
-- also what stops the two directions feeding each other.
CREATE FUNCTION public.client_contact_methods_to_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _client uuid := COALESCE(NEW.client_id, OLD.client_id);
  _email text;
  _phone text;
BEGIN
  SELECT m.value INTO _email FROM public.client_contact_methods AS m
   WHERE m.client_id = _client AND m.kind = 'email' AND m.is_primary ORDER BY m.position LIMIT 1;
  SELECT m.value INTO _phone FROM public.client_contact_methods AS m
   WHERE m.client_id = _client AND m.kind = 'phone' AND m.is_primary ORDER BY m.position LIMIT 1;
  UPDATE public.clients AS c SET email = _email, phone = _phone
   WHERE c.id = _client
     AND (c.email IS DISTINCT FROM _email OR c.phone IS DISTINCT FROM _phone);
  RETURN NULL;
END;
$$;
CREATE TRIGGER client_contact_methods_to_legacy
  AFTER INSERT OR UPDATE OR DELETE ON public.client_contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.client_contact_methods_to_legacy();

CREATE FUNCTION public.user_contact_methods_to_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public._user_methods_to_profile(COALESCE(NEW.user_id, OLD.user_id));
  RETURN NULL;
END;
$$;
CREATE TRIGGER user_contact_methods_to_legacy
  AFTER INSERT OR UPDATE OR DELETE ON public.user_contact_methods
  FOR EACH ROW EXECUTE FUNCTION public.user_contact_methods_to_legacy();

-- A person who signs up later starts the way the backfill left everyone else: their sign-in
-- address is their primary email, labelled 'Sign-in', until they add others.
CREATE FUNCTION public.seed_user_contact_methods_from_sign_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NULLIF(pg_catalog.btrim(NEW.email), '') IS NOT NULL
     AND pg_catalog.btrim(NEW.email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     AND NOT EXISTS (SELECT 1 FROM public.user_contact_methods AS m WHERE m.user_id = NEW.id AND m.kind = 'email') THEN
    INSERT INTO public.user_contact_methods (user_id, kind, value, label, is_primary, position)
    VALUES (NEW.id, 'email', pg_catalog.btrim(NEW.email), 'Sign-in', true, 0);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_user_contact_methods_from_sign_in() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER seed_user_contact_methods_from_sign_in
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.seed_user_contact_methods_from_sign_in();

-- The backfill ran before the mirror existed. Bring the copies in line once, so a user whose
-- sign-in address became their primary shows it in the old column too.
UPDATE public.profiles AS p
   SET work_email = m.value
  FROM public.user_contact_methods AS m
 WHERE m.user_id = p.user_id AND m.kind = 'email' AND m.is_primary
   AND p.work_email IS DISTINCT FROM m.value;

-- ─── Writers ────────────────────────────────────────────────────────────────────────────────
-- upsert_contact: the one contact write seam for the People screen and Paige. Unchanged from the
-- live definition except for the `contact_methods` key: the complete ordered list of the
-- contact's addresses, which may not be combined with the single-address `email`/`phone` keys.
CREATE OR REPLACE FUNCTION public.upsert_contact(
  p_patch jsonb,
  p_contact_id uuid DEFAULT NULL::uuid,
  p_tenant_id uuid DEFAULT NULL::uuid,
  p_actor_user_id uuid DEFAULT NULL::uuid,
  p_channel text DEFAULT NULL::text
)
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
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'CONTACT_EMPTY_PATCH' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(key ORDER BY key)
    INTO _unknown
    FROM jsonb_object_keys(p_patch) AS allowed(key)
   WHERE key <> ALL (ARRAY[
     'first_name','last_name','email','phone','contact_methods','entity_name','entity_type','title',
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
    PERFORM 1 FROM public.clients AS c
     WHERE c.id = _contact_id AND c.tenant_id = _tenant
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONTACT_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
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
          jsonb_build_object('tenant_id', _tenant, 'fields', ARRAY(SELECT jsonb_object_keys(p_patch)), 'channel', p_channel));
  RETURN _contact_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_contact(jsonb, uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_contact(jsonb, uuid, uuid, uuid, text) TO authenticated, service_role;

-- set_user_contact_methods: a person's own addresses, or a teammate's in the caller's current
-- workspace when the caller is its owner or an admin. An admin cannot rewrite the owner's.
-- (Owner ruling 2026-09-28: self, owner and admin edit; the owner boundary is the lane's
-- recorded assumption.) The record is the person's, across every workspace they belong to.
CREATE FUNCTION public.set_user_contact_methods(p_user_id uuid, p_methods jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _actor uuid := auth.uid();
  _tenant uuid;
  _target_is_owner boolean;
  _result jsonb;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'USER_CONTACT_METHODS_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_CONTACT_METHODS_NO_USER' USING ERRCODE = '22023';
  END IF;

  IF p_user_id <> _actor THEN
    _tenant := public.current_user_tenant_id();
    IF _tenant IS NULL OR NOT public.is_tenant_admin(_tenant) THEN
      RAISE EXCEPTION 'USER_CONTACT_METHODS_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    SELECT (tm.role = 'owner' OR COALESCE(tm.is_owner, false)) INTO _target_is_owner
      FROM public.tenant_members AS tm
     WHERE tm.tenant_id = _tenant AND tm.user_id = p_user_id AND tm.status IN ('active', 'suspended');
    IF NOT FOUND THEN
      RAISE EXCEPTION 'USER_CONTACT_METHODS_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF _target_is_owner AND NOT EXISTS (
         SELECT 1 FROM public.tenant_members AS tm
          WHERE tm.tenant_id = _tenant AND tm.user_id = _actor AND tm.status = 'active'
            AND (tm.role = 'owner' OR COALESCE(tm.is_owner, false))) THEN
      RAISE EXCEPTION 'USER_CONTACT_METHODS_OWNER_ONLY' USING ERRCODE = '42501';
    END IF;
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
REVOKE ALL ON FUNCTION public.set_user_contact_methods(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_contact_methods(uuid, jsonb) TO authenticated;
