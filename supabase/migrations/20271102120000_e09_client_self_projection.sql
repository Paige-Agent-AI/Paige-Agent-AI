-- E09 customer-safe relationship read foundation. Created by the Supabase CLI;
-- this unapplied migration is placed above the verified deployed/pending frontier.
-- Additive only: the raw self-policy and legacy MCP/context readers are NOT yet
-- removed here, and external joins must stay blocked until their coordinated repair.
-- Canonical identity: auth.uid(). Canonical relationship: clients, never tenant_members.

CREATE OR REPLACE FUNCTION public.client_portal_relationship_id(p_tenant_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _ids uuid[];
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  SELECT array_agg(c.id ORDER BY c.id) INTO _ids
  FROM public.clients c JOIN public.tenants t ON t.id = c.tenant_id
  WHERE c.linked_user_id = _uid AND c.status = 'active'
    AND c.merged_into_contact_id IS NULL AND t.status = 'active'
    AND (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id);
  IF COALESCE(cardinality(_ids), 0) > 1 THEN
    -- Future multi-business support must select a legitimate relationship explicitly.
    -- A tenant argument narrows existing authority; it never supplies authority.
    RAISE EXCEPTION 'select an authorized customer relationship' USING ERRCODE = '42501';
  END IF;
  RETURN _ids[1];
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_relationship_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_relationship_id(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.client_portal_self_profile(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _uid uuid := auth.uid();
  _client_id uuid;
  _profile jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'customer authentication required' USING ERRCODE = '42501';
  END IF;
  _client_id := public.client_portal_relationship_id(p_tenant_id);
  IF _client_id IS NULL THEN RETURN NULL; END IF;
  -- Explicit allowlist, not a whole CRM row minus today's known private fields.
  -- Never return internal notes, staff assignments, scores, tags, provider identifiers,
  -- internal lifecycle/source strings, revenue, billing tokens or other client rows.
  SELECT jsonb_build_object(
    'id', c.id, 'tenant_id', c.tenant_id, 'linked_user_id', _uid,
    'first_name', c.first_name, 'last_name', c.last_name, 'entity_name', c.entity_name,
    'street_address', c.street_address, 'city', c.city, 'state', c.state, 'zip_code', c.zip_code,
    'onboarding_stage', c.onboarding_stage,
    'is_signup_contact', COALESCE(c.source = 'signup', false),
    'paige_shared_context_consent', COALESCE(c.paige_shared_context_consent, false),
    'paige_shared_context_consent_updated_at', c.paige_shared_context_consent_updated_at,
    'updated_at', c.updated_at,
    'email', (SELECT cm.value FROM public.client_contact_methods cm
      WHERE cm.tenant_id = c.tenant_id AND cm.client_id = c.id AND cm.kind = 'email' AND cm.is_primary),
    'phone', (SELECT cm.value FROM public.client_contact_methods cm
      WHERE cm.tenant_id = c.tenant_id AND cm.client_id = c.id AND cm.kind = 'phone' AND cm.is_primary),
    'contact_methods', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'kind', cm.kind, 'value', cm.value, 'is_primary', cm.is_primary) ORDER BY cm.kind, cm.id)
      FROM public.client_contact_methods cm
      WHERE cm.tenant_id = c.tenant_id AND cm.client_id = c.id AND cm.kind IN ('email','phone')), '[]'::jsonb)
  ) INTO _profile
  FROM public.clients c
  WHERE c.id = _client_id AND c.linked_user_id = _uid;
  RETURN _profile;
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_self_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_self_profile(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.client_portal_relationship_id(uuid) IS
  'Auth-subject-bound active, unmerged client relationship. Tenant input only narrows authority. No staff or email fallback.';
COMMENT ON FUNCTION public.client_portal_self_profile(uuid) IS
  'Customer-safe explicit projection from canonical CRM and contact methods. Does not activate external entry or remediate legacy raw/MCP/context paths by itself.';
