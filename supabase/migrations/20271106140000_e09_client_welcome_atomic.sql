-- Atomic Welcome over existing CRM/contact methods, intake and stage writers.
-- CLI-created above the unapplied frontier. No entry, AI or provider activation.
-- Private pure validators do not publish a second Playbook/preset registry.
CREATE OR REPLACE FUNCTION public._client_portal_welcome_fields(p_config jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  _field jsonb; _option jsonb; _key text; _type text;
  _keys text[] := ARRAY[]::text[]; _options text[];
  _fields jsonb := '[]'::jsonb; _public_field jsonb;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object'
    OR octet_length(p_config::text) > 262144
    OR jsonb_typeof(p_config->'slug') IS DISTINCT FROM 'string'
    OR nullif(btrim(p_config->>'slug'),'') IS NULL
    OR jsonb_typeof(p_config->'name') IS DISTINCT FROM 'string'
    OR nullif(btrim(p_config->>'name'),'') IS NULL
    OR jsonb_typeof(p_config->'persona') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_config->'journey') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_config->'portal') IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_config#>'{portal,modules}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_config->'intake') IS DISTINCT FROM 'array' THEN RETURN NULL;
  END IF;
  IF jsonb_array_length(p_config->'intake') > 50 THEN RETURN NULL; END IF;
  FOR _field IN SELECT value FROM jsonb_array_elements(p_config->'intake') LOOP
    IF jsonb_typeof(_field) <> 'object'
      OR jsonb_typeof(_field->'key') IS DISTINCT FROM 'string'
      OR (_field->>'key') !~ '^[a-z0-9][a-z0-9_]{0,63}$'
      OR jsonb_typeof(_field->'label') IS DISTINCT FROM 'string'
      OR nullif(btrim(_field->>'label'),'') IS NULL
      OR char_length(_field->>'label') > 200
      OR jsonb_typeof(_field->'type') IS DISTINCT FROM 'string'
      OR (_field->>'type') <> ALL(ARRAY['text','longtext','select','number','date','phone','address'])
      OR (_field ? 'required' AND jsonb_typeof(_field->'required') <> 'boolean') THEN RETURN NULL;
    END IF;
    _key := _field->>'key'; _type := _field->>'type';
    IF _key = ANY(_keys) THEN RETURN NULL; END IF;
    _keys := array_append(_keys,_key);
    _public_field := jsonb_build_object('key',_key,'label',btrim(_field->>'label'),
      'type',_type,'required',COALESCE((_field->>'required')::boolean,false));
    IF _type = 'select' THEN
      IF jsonb_typeof(_field->'options') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
      IF jsonb_array_length(_field->'options') NOT BETWEEN 1 AND 100 THEN RETURN NULL; END IF;
      _options := ARRAY[]::text[];
      FOR _option IN SELECT value FROM jsonb_array_elements(_field->'options') LOOP
        IF jsonb_typeof(_option) <> 'string' OR nullif(btrim(_option#>>'{}'),'') IS NULL
          OR char_length(_option#>>'{}') > 200 OR (_option#>>'{}') = ANY(_options) THEN RETURN NULL;
        END IF;
        _options := array_append(_options,_option#>>'{}');
      END LOOP;
      _public_field := _public_field || jsonb_build_object('options',to_jsonb(_options));
    ELSIF _field ? 'options' THEN RETURN NULL;
    END IF;
    -- Native identity/contact fields belong to the existing profile writer.
    IF _key <> ALL(ARRAY['full_name','first_name','last_name','name','email','phone']) THEN
      _fields := _fields || jsonb_build_array(_public_field);
    END IF;
  END LOOP;
  RETURN _fields;
END;
$$;
REVOKE ALL ON FUNCTION public._client_portal_welcome_fields(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._client_portal_welcome_answers(p_fields jsonb,p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  _field jsonb; _value jsonb; _key text; _type text; _text text; _date date;
BEGIN
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'object'
    OR octet_length(p_answers::text) > 65536 THEN
    RAISE EXCEPTION 'provide bounded intake answers' USING ERRCODE='22023';
  END IF;
  FOR _key IN SELECT jsonb_object_keys(p_answers) LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields) f WHERE f->>'key'=_key) THEN
      RAISE EXCEPTION 'intake answer is not permitted' USING ERRCODE='22023';
    END IF;
  END LOOP;
  FOR _field IN SELECT value FROM jsonb_array_elements(p_fields) LOOP
    _key := _field->>'key'; _type := _field->>'type'; _value := p_answers->_key;
    IF _value IS NULL OR _value='null'::jsonb THEN
      IF (_field->>'required')::boolean THEN
        RAISE EXCEPTION 'required intake answer is missing' USING ERRCODE='22023';
      END IF;
      CONTINUE;
    END IF;
    IF _type = 'number' THEN
      IF jsonb_typeof(_value) <> 'number' THEN
        RAISE EXCEPTION 'intake number is invalid' USING ERRCODE='22023';
      END IF;
      IF abs((_value#>>'{}')::numeric) > 1000000000000 THEN
        RAISE EXCEPTION 'intake number is too large' USING ERRCODE='22023';
      END IF;
      CONTINUE;
    END IF;
    IF jsonb_typeof(_value) <> 'string' THEN
      RAISE EXCEPTION 'intake answer has the wrong type' USING ERRCODE='22023';
    END IF;
    _text := _value#>>'{}';
    IF char_length(_text) > (CASE _type WHEN 'longtext' THEN 10000 WHEN 'address' THEN 1000 ELSE 2000 END)
      OR ((_field->>'required')::boolean AND nullif(btrim(_text),'') IS NULL) THEN
      RAISE EXCEPTION 'intake answer is blank or too long' USING ERRCODE='22023';
    END IF;
    IF nullif(btrim(_text),'') IS NULL THEN CONTINUE; END IF;
    IF _type='select' AND NOT (_field->'options' ? _text) THEN
      RAISE EXCEPTION 'intake choice is not published' USING ERRCODE='22023';
    ELSIF _type='phone' AND (char_length(_text)>40
      OR char_length(regexp_replace(_text,'[^0-9]','','g')) NOT BETWEEN 7 AND 15) THEN
      RAISE EXCEPTION 'intake phone is invalid' USING ERRCODE='22023';
    ELSIF _type='date' THEN
      IF _text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'intake date is invalid' USING ERRCODE='22023';
      END IF;
      BEGIN
        _date := _text::date;
      EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
        RAISE EXCEPTION 'intake date is invalid' USING ERRCODE='22023';
      END;
    END IF;
  END LOOP;
  RETURN p_answers;
END;
$$;
REVOKE ALL ON FUNCTION public._client_portal_welcome_answers(jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.client_portal_welcome_state()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid(); _id uuid; _client public.clients%ROWTYPE;
  _config jsonb; _fields jsonb; _profile jsonb; _answers jsonb := '{}'::jsonb;
  _intake public.paige_client_intake_submissions%ROWTYPE;
  _intake_exists boolean; _token text; _field jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE='42501'; END IF;
  _id := public.client_portal_relationship_id();
  IF _id IS NULL THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  -- Same client -> tenant -> intake lock order as the save. A read is coherent
  -- with participating writers and returns no arbitrary tenant features/payload.
  SELECT c.* INTO _client FROM public.clients c WHERE c.id=_id AND c.linked_user_id=_uid
    AND c.status='active' AND c.merged_into_contact_id IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  SELECT t.features->'playbook_config' INTO _config FROM public.tenants t
    WHERE t.id=_client.tenant_id AND t.status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  SELECT i.* INTO _intake FROM public.paige_client_intake_submissions i
    WHERE i.client_id=_id AND i.section='playbook_intake' FOR SHARE;
  _intake_exists := FOUND;
  _profile := public.client_portal_self_profile(_client.tenant_id);
  IF _profile IS NULL OR _profile->>'id' IS DISTINCT FROM _id::text
    OR _profile->>'tenant_id' IS DISTINCT FROM _client.tenant_id::text
    OR _profile->>'linked_user_id' IS DISTINCT FROM _uid::text THEN
    RAISE EXCEPTION 'customer profile readback unavailable' USING ERRCODE='42501';
  END IF;
  _fields := public._client_portal_welcome_fields(_config);
  IF _fields IS NULL THEN
    RETURN jsonb_build_object('status','configuration_required','profile',_profile,'fields','[]'::jsonb,
      'answers','{}'::jsonb,'intake_updated_at',NULL,'intake_submitted_at',NULL,'expected_token',NULL);
  END IF;
  IF _intake_exists THEN
    IF jsonb_typeof(_intake.payload) IS DISTINCT FROM 'object' OR octet_length(_intake.payload::text)>1048576 THEN
      RAISE EXCEPTION 'saved intake requires assistance' USING ERRCODE='22023';
    END IF;
    FOR _field IN SELECT value FROM jsonb_array_elements(_fields) LOOP
      IF _intake.payload ? (_field->>'key') THEN
        _answers := _answers || jsonb_build_object(_field->>'key',_intake.payload->(_field->>'key'));
      END IF;
    END LOOP;
  END IF;
  -- Snapshot CAS only: not identity, a monotonic revision or an execution receipt.
  _token := md5(jsonb_build_object('profile',_profile,'fields',_fields,'intake_exists',_intake_exists,
    'intake_id',_intake.id,'payload',_intake.payload,'updated_at',_intake.updated_at,
    'submitted_at',_intake.submitted_at)::text);
  RETURN jsonb_build_object('status','ready','profile',_profile,'fields',_fields,'answers',_answers,
    'intake_updated_at',_intake.updated_at,'intake_submitted_at',_intake.submitted_at,'expected_token',_token);
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_welcome_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_welcome_state() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.client_portal_save_welcome(p_expected_token text,p_profile jsonb,p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid(); _id uuid; _client public.clients%ROWTYPE;
  _intake public.paige_client_intake_submissions%ROWTYPE; _intake_exists boolean;
  _loaded jsonb; _saved jsonb; _profile jsonb; _answers jsonb; _stage record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE='42501'; END IF;
  _id := public.client_portal_relationship_id();
  IF _id IS NULL THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  SELECT c.* INTO _client FROM public.clients c WHERE c.id=_id AND c.linked_user_id=_uid
    AND c.status='active' AND c.merged_into_contact_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id=_client.tenant_id AND t.status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE='42501'; END IF;
  SELECT i.* INTO _intake FROM public.paige_client_intake_submissions i
    WHERE i.client_id=_id AND i.section='playbook_intake' FOR UPDATE;
  _intake_exists := FOUND;
  _loaded := public.client_portal_welcome_state();
  IF _loaded->>'status' IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'published intake configuration required' USING ERRCODE='55000';
  END IF;
  IF p_expected_token IS NULL OR p_expected_token !~ '^[a-fA-F0-9]{32}$' THEN
    RAISE EXCEPTION 'provide the loaded Welcome state' USING ERRCODE='22023';
  END IF;
  IF p_expected_token IS DISTINCT FROM _loaded->>'expected_token' THEN
    RAISE EXCEPTION 'Welcome information changed; reload before saving' USING ERRCODE='40001';
  END IF;
  _answers := public._client_portal_welcome_answers(_loaded->'fields',p_answers);
  -- Reuse canonical profile/contact validation, CAS, locks and attributed audit.
  _profile := public.client_portal_update_self_profile(_client.updated_at,p_profile,_client.tenant_id);
  IF _profile->>'id' IS DISTINCT FROM _id::text OR _profile->>'tenant_id' IS DISTINCT FROM _client.tenant_id::text
    OR _profile->>'linked_user_id' IS DISTINCT FROM _uid::text THEN
    RAISE EXCEPTION 'customer profile readback unavailable' USING ERRCODE='42501';
  END IF;
  -- Welcome's required contact fields apply to the composed canonical profile;
  -- a partial patch may reuse existing values, but cannot advance missing data.
  IF nullif(btrim(_profile->>'first_name'),'') IS NULL
    OR nullif(btrim(_profile->>'last_name'),'') IS NULL
    OR nullif(btrim(_profile->>'phone'),'') IS NULL
    OR char_length(_profile->>'phone')>40
    OR char_length(regexp_replace(_profile->>'phone','[^0-9]','','g')) NOT BETWEEN 7 AND 15 THEN
    RAISE EXCEPTION 'Welcome name and primary phone are required' USING ERRCODE='22023';
  END IF;
  IF _intake_exists THEN
    UPDATE public.paige_client_intake_submissions SET payload=
      (_intake.payload - ARRAY(SELECT f->>'key' FROM jsonb_array_elements(_loaded->'fields') f))||_answers,
      submitted_at=clock_timestamp() WHERE id=_intake.id AND client_id=_id AND section='playbook_intake';
    IF NOT FOUND THEN RAISE EXCEPTION 'Welcome information changed; reload before saving' USING ERRCODE='40001'; END IF;
  ELSE
    BEGIN
      INSERT INTO public.paige_client_intake_submissions(client_id,section,payload,submitted_at)
        VALUES(_id,'playbook_intake',_answers,clock_timestamp());
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Welcome information changed; reload before saving' USING ERRCODE='40001';
    END;
  END IF;
  SELECT * INTO _stage FROM public.client_advance_onboarding_stage('signing_agreement','{}'::jsonb);
  IF _stage.client_id IS DISTINCT FROM _id THEN
    RAISE EXCEPTION 'customer stage readback unavailable' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
  VALUES(_uid,'client_portal','welcome_saved',_id,
    jsonb_build_object('actor_user_id',_uid,'tenant_id',_client.tenant_id,'client_id',_id,
      'answer_fields',(SELECT COALESCE(jsonb_agg(k ORDER BY k),'[]'::jsonb) FROM jsonb_object_keys(_answers) k),
      'via','client_portal_save_welcome'));
  _saved := public.client_portal_welcome_state();
  IF _saved->>'status' IS DISTINCT FROM 'ready' OR _saved#>>'{profile,id}' IS DISTINCT FROM _id::text
    OR _saved#>>'{profile,tenant_id}' IS DISTINCT FROM _client.tenant_id::text
    OR _saved#>>'{profile,linked_user_id}' IS DISTINCT FROM _uid::text
    OR _saved#>>'{profile,onboarding_stage}' IS DISTINCT FROM _stage.onboarding_stage
    OR _saved->'answers' IS DISTINCT FROM _answers OR _saved->>'intake_submitted_at' IS NULL THEN
    RAISE EXCEPTION 'Welcome saved-state readback unavailable' USING ERRCODE='42501';
  END IF;
  RETURN _saved;
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_save_welcome(text,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_save_welcome(text,jsonb,jsonb) TO authenticated, service_role;

-- Prevent old/raw callers bypassing the protected section's combined CAS. SELECT
-- and other sections retain their incumbent contracts; trusted service is intact.
ALTER POLICY client_upsert_own_intake ON public.paige_client_intake_submissions
  WITH CHECK (section <> 'playbook_intake' AND public.is_program_client_owner(client_id));
ALTER POLICY client_update_own_intake ON public.paige_client_intake_submissions
  USING (section <> 'playbook_intake' AND public.is_program_client_owner(client_id))
  WITH CHECK (section <> 'playbook_intake' AND public.is_program_client_owner(client_id));
COMMENT ON FUNCTION public.client_portal_welcome_state() IS
  'Narrow canonical sponsoring-customer Welcome state with validated authored intake and snapshot CAS. No external-entry activation.';
COMMENT ON FUNCTION public.client_portal_save_welcome(text,jsonb,jsonb) IS
  'Atomic native profile/contact, protected intake and forward-stage composition; final canonical readback, no actor/target arguments or provider effects.';
