-- Existing onboarding writer; preserve ABI, stages and canonical audit stream.
-- Created by the CLI, safely renumbered above the observed unapplied frontier.
-- External entry/AI execution remain held; Welcome save atomicity is separate.
CREATE OR REPLACE FUNCTION public.client_advance_onboarding_stage(
  p_to_stage text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(client_id uuid, onboarding_stage text, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_client_id uuid;
  v_client public.clients%ROWTYPE;
  v_order text[] := ARRAY['pre_invite','invited','signing_agreement','accepting_payment','completing_intake','uploading_docs','completed'];
  v_from_idx int;
  v_to_idx int;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_to_stage IS NULL OR NOT (p_to_stage = ANY (v_order)) THEN
    RAISE EXCEPTION 'invalid_stage: %', p_to_stage;
  END IF;

  v_client_id := public.client_portal_relationship_id();
  IF v_client_id IS NULL THEN RAISE EXCEPTION 'no_linked_client'; END IF;
  -- Recheck the locked row after any concurrent archive/revoke/merge has won.
  SELECT c.* INTO v_client FROM public.clients c
  WHERE c.id = v_client_id AND c.linked_user_id = v_user_id
    AND c.status = 'active' AND c.merged_into_contact_id IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_linked_client'; END IF;
  PERFORM 1 FROM public.tenants t
  WHERE t.id = v_client.tenant_id AND t.status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_linked_client'; END IF;

  v_from_idx := COALESCE(array_position(v_order, COALESCE(v_client.onboarding_stage, 'invited')), 1);
  v_to_idx := array_position(v_order, p_to_stage);
  IF v_to_idx > v_from_idx THEN
    UPDATE public.clients c SET onboarding_stage = p_to_stage, updated_at = now()
    WHERE c.id = v_client.id AND c.tenant_id = v_client.tenant_id
      AND c.linked_user_id = v_user_id AND c.status = 'active'
      AND c.merged_into_contact_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'no_linked_client'; END IF;
    INSERT INTO public.paige_audit_log(actor_user_id,action,target_type,target_id,payload)
    VALUES (v_user_id,'onboarding_stage_advanced','client',v_client.id,
      jsonb_build_object('from_stage',v_client.onboarding_stage,'to_stage',p_to_stage,
                        'payload',COALESCE(p_payload,'{}'::jsonb)));
  END IF;
  RETURN QUERY SELECT c.id,c.onboarding_stage,c.updated_at
  FROM public.clients c WHERE c.id = v_client.id AND c.linked_user_id = v_user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.client_advance_onboarding_stage(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_advance_onboarding_stage(text,jsonb) TO authenticated;
COMMENT ON FUNCTION public.client_advance_onboarding_stage(text,jsonb) IS
  'Existing monotonic onboarding stage writer, bound to the canonical active customer relationship; no external-entry or AI-execution activation.';
