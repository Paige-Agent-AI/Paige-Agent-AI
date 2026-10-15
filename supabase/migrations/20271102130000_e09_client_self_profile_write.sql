-- Additive customer self-write. No external-entry activation, raw policy change,
-- staff grant, email/linkage mutation, new identity store or provider effect.
CREATE OR REPLACE FUNCTION public.client_portal_update_self_profile(
  p_expected_updated_at timestamptz,
  p_profile jsonb,
  p_tenant_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _client public.clients%ROWTYPE;
  _key text;
  _value jsonb;
  _methods jsonb;
  _readback jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501';
  END IF;
  _id := public.client_portal_relationship_id(p_tenant_id);
  IF _id IS NULL THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  -- Revalidate after acquiring the row lock: a concurrent revoke/merge/archive
  -- that won the lock must take effect before this call can write anything.
  SELECT c.* INTO _client FROM public.clients c
  WHERE c.id = _id AND c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.tenants t
  WHERE t.id = _client.tenant_id AND t.status = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  IF _client.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'customer profile changed; reload before saving' USING ERRCODE = '40001';
  END IF;
  IF p_profile IS NULL OR jsonb_typeof(p_profile) <> 'object' OR p_profile = '{}'::jsonb THEN
    RAISE EXCEPTION 'provide permitted profile fields' USING ERRCODE = '22023';
  END IF;
  FOR _key, _value IN SELECT key, value FROM jsonb_each(p_profile) LOOP
    IF _key <> ALL(ARRAY['first_name','last_name','street_address','city','state','zip_code','phone'])
      OR jsonb_typeof(_value) NOT IN ('string','null') THEN
      RAISE EXCEPTION 'profile field is not permitted' USING ERRCODE = '22023';
    END IF;
    IF _key IN ('first_name','last_name','phone') AND
      (jsonb_typeof(_value) <> 'string' OR nullif(btrim(p_profile->>_key),'') IS NULL) THEN
      RAISE EXCEPTION 'provided name or phone must not be blank' USING ERRCODE = '22023';
    END IF;
    IF char_length(p_profile->>_key) > (CASE WHEN _key='street_address' THEN 500 ELSE 200 END) THEN
      RAISE EXCEPTION 'profile field is too long' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_profile ? 'phone' THEN
    _methods := public._client_contact_methods_payload(_client.id);
    PERFORM public._replace_client_contact_methods_checked(_client.tenant_id, _client.id,
      public.contact_methods_with_primary(_methods, 'phone', btrim(p_profile->>'phone')), _methods);
  END IF;
  UPDATE public.clients c SET
    first_name = CASE WHEN p_profile ? 'first_name' THEN btrim(p_profile->>'first_name') ELSE c.first_name END,
    last_name = CASE WHEN p_profile ? 'last_name' THEN btrim(p_profile->>'last_name') ELSE c.last_name END,
    street_address = CASE WHEN p_profile ? 'street_address' THEN nullif(btrim(p_profile->>'street_address'),'') ELSE c.street_address END,
    city = CASE WHEN p_profile ? 'city' THEN nullif(btrim(p_profile->>'city'),'') ELSE c.city END,
    state = CASE WHEN p_profile ? 'state' THEN nullif(btrim(p_profile->>'state'),'') ELSE c.state END,
    zip_code = CASE WHEN p_profile ? 'zip_code' THEN nullif(btrim(p_profile->>'zip_code'),'') ELSE c.zip_code END,
    updated_at = clock_timestamp()
  WHERE c.id = _client.id AND c.tenant_id = _client.tenant_id AND c.linked_user_id = _uid;
  INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
  VALUES (_uid,'client_portal','self_profile_updated',_client.id,
    jsonb_build_object('actor_user_id',_uid,'tenant_id',_client.tenant_id,'client_id',_client.id,
      'fields_submitted',(SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(p_profile) k),
      'via','client_portal_update_self_profile'));
  _readback := public.client_portal_self_profile(_client.tenant_id);
  IF _readback IS NULL OR _readback->>'id' IS DISTINCT FROM _client.id::text
    OR _readback->>'linked_user_id' IS DISTINCT FROM _uid::text THEN
    RAISE EXCEPTION 'customer profile readback unavailable' USING ERRCODE = '42501';
  END IF;
  RETURN _readback;
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_update_self_profile(timestamptz,jsonb,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_update_self_profile(timestamptz,jsonb,uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.client_portal_update_self_profile(timestamptz,jsonb,uuid) IS
  'Auth-subject-bound allowlisted CRM/primary-phone save with version check, canonical methods, attributed audit and safe readback. No external-entry activation.';
