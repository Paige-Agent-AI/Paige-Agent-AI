-- CLI-created forward migration, ordered above verified production 20271108110000.
-- Customer membership is a clients relationship, never a tenant staff seat/pointer.
BEGIN;

-- No custom Welcome questions means the existing basic contact form. An
-- explicitly malformed published configuration still refuses; never discard it.
DO $welcome_default$
DECLARE _def text := pg_get_functiondef('public._client_portal_welcome_fields(jsonb)'::regprocedure);
BEGIN
  IF strpos(_def,'E09_CONTACT_ONLY_WELCOME_V1') = 0 THEN
    IF md5(_def) <> 'c463ce2c5bb863a6723c682751ca15ce' THEN
      RAISE EXCEPTION 'Welcome validator predecessor changed; reconcile before customer entry';
    END IF;
    EXECUTE replace(_def,E'BEGIN\n  IF p_config IS NULL OR',
      E'BEGIN\n  -- E09_CONTACT_ONLY_WELCOME_V1\n  IF p_config IS NULL THEN RETURN ''[]''::jsonb; END IF;\n  IF p_config IS NULL OR');
  END IF;
END;
$welcome_default$;

-- A customer uses the existing closed projection, not the internal CRM row.
-- Restrictive intersection preserves existing staff policies while preventing
-- the legacy linked-self/NULL-tenant permissive arms from granting raw access.
DROP POLICY IF EXISTS clients_customer_raw_boundary ON public.clients;
CREATE POLICY clients_customer_raw_boundary ON public.clients AS RESTRICTIVE
FOR ALL TO authenticated
USING (public.is_platform_owner() OR tenant_id = (SELECT public.current_user_tenant_id()))
WITH CHECK (public.is_platform_owner() OR tenant_id = (SELECT public.current_user_tenant_id()));

DO $entry$
DECLARE
  _def text := pg_get_functiondef('public.accept_tenant_invite(text)'::regprocedure);
  _old text := $old$          'actor_user_id', _uid, 'via', 'accept_tenant_invite'));

  ELSIF _tok.kind = 'subaccount_owner' THEN$old$;
  _new text := $new$          'actor_user_id', _uid, 'via', 'accept_tenant_invite'));
    -- E09_CUSTOMER_ENTRY_V1: commit the same native token and audit; leave
    -- profiles.active_tenant_id and all business/staff membership untouched.
    PERFORM 1 FROM public.tenants WHERE id = _tok.tenant_id AND status = 'active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'customer relationship unavailable' USING ERRCODE = '42501'; END IF;
    UPDATE public.tenant_invite_tokens SET uses = uses + 1, last_used_at = now() WHERE id = _tok.id;
    RETURN _tok.tenant_id;

  ELSIF _tok.kind = 'subaccount_owner' THEN$new$;
BEGIN
  IF strpos(_def, 'E09_CUSTOMER_ENTRY_V1') = 0 THEN
    IF strpos(_def, 'E09_CONSUMER_INVITE_INTEGRITY_V1') = 0
      OR strpos(_def, _old) = 0
      OR (length(_def) - length(replace(_def, _old, ''))) / length(_old) <> 1
      OR md5(substr(_def, strpos(_def, '  IF _tok.kind = ''consumer'' THEN'),
        strpos(_def, '  ELSIF _tok.kind = ''subaccount_owner'' THEN')
          - strpos(_def, '  IF _tok.kind = ''consumer'' THEN'))) <> '85831ac1f12599b01f13a79ea01f4173' THEN
      RAISE EXCEPTION 'customer entry predecessor changed; reconcile before activation';
    END IF;
    EXECUTE replace(_def, _old, _new);
  END IF;
END;
$entry$;

-- Read-only reconciliation for an interrupted acceptance. Token possession is
-- insufficient: only its verified recipient AND current accepted actor/tuple
-- with the native acceptance audit may recover. Never returns the secret token.
CREATE OR REPLACE FUNCTION public.client_portal_invite_status(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE _uid uuid := auth.uid(); _result jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'customer authentication required' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('tenant_id',c.tenant_id,'client_id',c.id,
    'accepted_at',t.last_used_at,'status','accepted') INTO _result
  FROM public.tenant_invite_tokens t
  JOIN public.clients c ON c.id=t.contact_id AND c.tenant_id=t.tenant_id
  JOIN public.tenants b ON b.id=c.tenant_id AND b.status='active'
  JOIN auth.users u ON u.id=_uid AND u.email_confirmed_at IS NOT NULL
  WHERE t.token=p_token AND t.kind='consumer' AND t.revoked_at IS NULL
    AND t.uses=1 AND t.last_used_at IS NOT NULL
    AND c.linked_user_id=_uid AND c.status='active' AND c.merged_into_contact_id IS NULL
    AND lower(btrim(u.email))=lower(btrim(t.email))
    AND EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.entity_id=t.id
      AND a.entity='client_portal' AND a.action='consumer_invite_accepted' AND a.user_id=_uid
      AND a.data->>'client_id'=c.id::text AND a.data->>'tenant_id'=c.tenant_id::text);
  RETURN _result;
END;
$$;
REVOKE ALL ON FUNCTION public.client_portal_invite_status(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.client_portal_invite_status(text) TO authenticated,service_role;

-- Dependent client-visible policies must use the native relationship resolver,
-- not a subquery through the newly sealed internal CRM table. Staff arms stay.
ALTER POLICY pce_client_read ON public.paige_client_events
USING (audience IN ('client','both') AND visibility='client_visible'
  AND contact_id=public.client_portal_relationship_id(tenant_id));
ALTER POLICY "Clients read own shared/uploads" ON public.client_files
USING (visibility IN ('shared','client_upload')
  AND contact_id=public.client_portal_relationship_id(tenant_id));
-- Context loads and internal pending-approval payloads are restricted system
-- evidence. Customer-visible actions have their own existing native projections.
DROP POLICY IF EXISTS csp_loads_subject_read ON public.paige_context_loads;
ALTER POLICY pca_customer_subject_read ON public.paige_customer_actions
USING (contact_id=public.client_portal_relationship_id(tenant_id));
ALTER POLICY pcr_customer_subject_read ON public.paige_customer_responses
USING (contact_id=public.client_portal_relationship_id());
DROP POLICY IF EXISTS "Clients can read approvals on their own record" ON public.paige_pending_approvals;
ALTER POLICY "ter self read" ON public.tenant_entity_relationships
USING (contact_id=public.client_portal_relationship_id(tenant_id));

COMMENT ON FUNCTION public.client_portal_invite_status(text) IS
  'Recipient-and-current-relationship-bound reconciliation of the canonical acceptance audit; never a fresh grant or raw token disclosure.';
COMMIT;
