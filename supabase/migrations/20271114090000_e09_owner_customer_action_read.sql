-- Original customer actions/responses, projected for the current SOLO owner.
-- This overload is a READ, not an action proposal, approval, dispatch or new history.
-- Preserve the incumbent one-argument staff reader and both original writers.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public._client_portal_access_authorize(uuid,uuid,boolean)') IS NULL
     OR to_regprocedure('public.list_pending_customer_actions(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Original Portal access and customer-action contracts required';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.list_pending_customer_actions(
  _expected_actor_id uuid, _expected_tenant_id uuid, _contact_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  account_kind text;
  customer public.clients%ROWTYPE;
  items jsonb;
  more boolean;
BEGIN
  IF _expected_actor_id IS NULL OR _contact_id IS NULL THEN
    RAISE EXCEPTION 'PORTAL_ACTIONS_NOT_AUTHORIZED' USING ERRCODE='42501';
  END IF;
  -- This is the SAME current-workspace/owner authority as invitation/access controls.
  -- Caller-supplied ids and the frontend's role label never authorize the read.
  account_kind := public._client_portal_access_authorize(_expected_actor_id, _expected_tenant_id, false);
  IF account_kind IS DISTINCT FROM 'standalone' OR NOT EXISTS (
    SELECT 1 FROM public.tenants t WHERE t.id=_expected_tenant_id AND t.status='active'
  ) THEN
    RAISE EXCEPTION 'PORTAL_ACTIONS_NOT_AUTHORIZED' USING ERRCODE='42501';
  END IF;
  SELECT c.* INTO customer FROM public.clients c
  WHERE c.id=_contact_id AND c.tenant_id=_expected_tenant_id AND c.status='active'
    AND c.merged_into_contact_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PORTAL_ACTIONS_NOT_AUTHORIZED' USING ERRCODE='42501';
  END IF;

  -- Bounded by the existing contact/created index; include only explicitly shared
  -- service records. Never expose payloads, private Cura turns or login identities.
  WITH first_items AS (
    SELECT a.* FROM public.paige_customer_actions a
    WHERE a.tenant_id=_expected_tenant_id AND a.contact_id=_contact_id
    ORDER BY a.created_at DESC, a.id DESC LIMIT 101
  ), visible_items AS (
    SELECT * FROM first_items ORDER BY created_at DESC, id DESC LIMIT 100
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'action_type', a.action_type, 'title', a.title, 'body', a.body,
    'status', a.status, 'created_at', a.created_at, 'updated_at', a.updated_at,
    'expires_at', a.expires_at,
    'is_expired', a.status IN ('proposed','customer_notified') AND a.expires_at<=now(),
    'responses', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'response_type', r.response_type, 'response_text', r.response_text,
      'created_at', r.created_at
    ) ORDER BY r.created_at DESC, r.id DESC), '[]'::jsonb) FROM (
      SELECT r.* FROM public.paige_customer_responses r
      WHERE r.action_id=a.id AND r.contact_id=_contact_id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 100
    ) r),
    'more_responses', (SELECT count(*)>100 FROM (
      SELECT 1 FROM public.paige_customer_responses r
      WHERE r.action_id=a.id AND r.contact_id=_contact_id LIMIT 101
    ) r)
  ) ORDER BY a.created_at DESC, a.id DESC), '[]'::jsonb),
  (SELECT count(*)>100 FROM first_items)
  INTO items, more FROM visible_items a;

  RETURN jsonb_build_object(
    'schema_version', 1, 'actor_id', auth.uid(), 'tenant_id', _expected_tenant_id,
    'contact_id', _contact_id, 'access_state', customer.portal_access_state,
    'joined', customer.linked_user_id IS NOT NULL,
    'shared_context_consent', customer.paige_shared_context_consent IS TRUE,
    'actions', items, 'more_actions', more
  );
END $$;

REVOKE ALL ON FUNCTION public.list_pending_customer_actions(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.list_pending_customer_actions(uuid,uuid,uuid) TO authenticated;
COMMENT ON FUNCTION public.list_pending_customer_actions(uuid,uuid,uuid) IS
  'E09 owner-only current SOLO workspace projection of original customer actions and responses. Read-only; no private Cura history, customer login identity, payload, approval or dispatch.';
NOTIFY pgrst, 'reload schema';
COMMIT;
