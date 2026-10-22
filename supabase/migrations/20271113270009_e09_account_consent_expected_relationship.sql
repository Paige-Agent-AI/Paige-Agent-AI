-- EXP09: bind the customer's original Account/Consent intent to the selected relationship.
-- Additive adapters only. Original resolver, writers, ledgers, receipts, RLS and old ABIs remain.
BEGIN;

CREATE FUNCTION public._client_portal_lock_expected_relationship(p_tenant_id uuid, p_expected_client_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $scope$
DECLARE _uid uuid := auth.uid(); _resolved uuid;
BEGIN
  IF _uid IS NULL OR p_tenant_id IS NULL OR p_expected_client_id IS NULL THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  -- The original resolver remains the authority for role, business and open Portal access.
  _resolved := public.client_portal_relationship_id(p_tenant_id);
  IF _resolved IS DISTINCT FROM p_expected_client_id THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
  -- Preserve the ORIGINAL preference-writer lock order. Taking the row before this same
  -- advisory lock would deadlock with an in-flight legacy consent writer.
  PERFORM pg_advisory_xact_lock(hashtextextended('portal_pref:' || _resolved::text, 0));
  -- The intent's actual relationship cannot be relinked/replaced between this check and the
  -- original writer. Re-evaluate the subject after acquiring the row, as the old writer does.
  PERFORM 1 FROM public.clients c WHERE c.id = _resolved AND c.tenant_id = p_tenant_id
    AND c.linked_user_id = _uid AND c.status = 'active' AND c.merged_into_contact_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501';
  END IF;
END $scope$;
REVOKE ALL ON FUNCTION public._client_portal_lock_expected_relationship(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public._client_portal_lock_expected_relationship(uuid, uuid) IS
  'Internal EXP09 exact-intent clamp; original client_portal_relationship_id and original native writers remain authority. No browser execution grant.';

CREATE FUNCTION public.client_portal_update_self_profile_scoped(
  p_expected_updated_at timestamptz, p_profile jsonb, p_tenant_id uuid, p_expected_client_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $scope$
BEGIN
  PERFORM public._client_portal_lock_expected_relationship(p_tenant_id, p_expected_client_id);
  RETURN public.client_portal_update_self_profile(p_expected_updated_at, p_profile, p_tenant_id);
END $scope$;
REVOKE ALL ON FUNCTION public.client_portal_update_self_profile_scoped(timestamptz, jsonb, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_update_self_profile_scoped(timestamptz, jsonb, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.client_portal_update_self_profile_scoped(timestamptz, jsonb, uuid, uuid) IS
  'Exact selected-customer adapter to original profile CAS, validation, audit and readback. No new profile store or permission.';

CREATE FUNCTION public.client_portal_communication_preferences_scoped(p_tenant_id uuid, p_expected_client_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $scope$
BEGIN
  PERFORM public._client_portal_lock_expected_relationship(p_tenant_id, p_expected_client_id);
  RETURN public.client_portal_communication_preferences(p_tenant_id);
END $scope$;
REVOKE ALL ON FUNCTION public.client_portal_communication_preferences_scoped(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_communication_preferences_scoped(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.client_portal_communication_preferences_scoped(uuid, uuid) IS
  'Exact selected-customer adapter to the original closed preference projection; no address, client ID or evidence added to its response.';

CREATE FUNCTION public.client_portal_set_communication_preference_scoped(
  p_channel text, p_topic text, p_enabled boolean, p_tenant_id uuid, p_expected_client_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $scope$
BEGIN
  PERFORM public._client_portal_lock_expected_relationship(p_tenant_id, p_expected_client_id);
  RETURN public.client_portal_set_communication_preference(p_channel, p_topic, p_enabled, p_tenant_id);
END $scope$;
REVOKE ALL ON FUNCTION public.client_portal_set_communication_preference_scoped(text, text, boolean, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_set_communication_preference_scoped(text, text, boolean, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.client_portal_set_communication_preference_scoped(text, text, boolean, uuid, uuid) IS
  'Exact selected-customer adapter; original customer-held suppressions, STOP/START, business holds, consent ledger and readback remain.';

CREATE FUNCTION public.client_portal_set_shared_context_consent_scoped(
  p_allow boolean, p_tenant_id uuid, p_expected_client_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $scope$
BEGIN
  PERFORM public._client_portal_lock_expected_relationship(p_tenant_id, p_expected_client_id);
  RETURN public.client_portal_set_shared_context_consent(p_allow, p_tenant_id);
END $scope$;
REVOKE ALL ON FUNCTION public.client_portal_set_shared_context_consent_scoped(boolean, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_set_shared_context_consent_scoped(boolean, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.client_portal_set_shared_context_consent_scoped(boolean, uuid, uuid) IS
  'Exact selected-customer adapter to the original consent flag/guard/audit/readback; no owner delegation or new customer AI permission.';

NOTIFY pgrst, 'reload schema';
COMMIT;
