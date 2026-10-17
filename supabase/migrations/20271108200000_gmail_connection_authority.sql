-- Gmail connection writes reuse the existing connector and Vault writer. No new
-- credential store, role, provider activation or authenticated credential setter.
-- Google consent/exchange is external and cannot be rolled back by this transaction.

CREATE OR REPLACE FUNCTION public._gmail_connection_actor(_actor uuid, _tenant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE active_tenant uuid;
BEGIN
  IF auth.uid() IS NOT NULL OR coalesce(auth.role(),'') <> 'service_role'
    OR _actor IS NULL OR _tenant IS NULL THEN
    RAISE EXCEPTION 'GMAIL_CONNECTION_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  -- Incumbent _comms_email_actor live-user/workspace/profile lock pattern. The
  -- final permission predicate is the SAME canonical tenant-admin function as
  -- Settings/A2P, including its existing company-workspace exception.
  PERFORM 1 FROM auth.users WHERE id=_actor AND deleted_at IS NULL
    AND (banned_until IS NULL OR banned_until<=now()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GMAIL_ACTOR_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenants WHERE id=_tenant AND status IN ('trial','active','past_due') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GMAIL_WORKSPACE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  -- Preserve the incumbent row-lock order. Lock every existing membership of
  -- this actor: a fallback's earliest row can change outside the target tenant.
  PERFORM 1 FROM public.profiles WHERE user_id=_actor FOR SHARE;
  PERFORM 1 FROM public.tenant_members WHERE user_id=_actor ORDER BY tenant_id FOR SHARE;
  PERFORM 1 FROM public.user_roles WHERE user_id=_actor ORDER BY role FOR SHARE;
  -- Exact current_user_tenant_id selection (20260714144656), evaluated for the
  -- already-authenticated actor. Never change auth.uid/JWT claims or invent a
  -- public actor resolver. A null/missing/invalid profile falls back to the
  -- earliest active membership; the target still requires canonical admin
  -- authority below, including only its existing company-workspace exception.
  SELECT COALESCE(
    (SELECT p.active_tenant_id FROM public.profiles p
      WHERE p.user_id=_actor AND p.active_tenant_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.tenant_members m
          WHERE m.user_id=_actor AND m.tenant_id=p.active_tenant_id AND m.status='active')
        OR public.agency_can_manage_child(p.active_tenant_id,_actor)
        OR public.agency_team_role(p.active_tenant_id,_actor) IS NOT NULL
        OR public.is_platform_admin(_actor))),
    (SELECT tenant_id FROM public.tenant_members
      WHERE user_id=_actor AND status='active' ORDER BY joined_at ASC LIMIT 1)
  ) INTO active_tenant;
  IF active_tenant IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'GMAIL_WORKSPACE_CHANGED' USING ERRCODE='42501';
  END IF;
  IF NOT coalesce(public.is_tenant_admin_as(_actor,_tenant),false) THEN
    RAISE EXCEPTION 'GMAIL_CONNECTION_FORBIDDEN' USING ERRCODE='42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._gmail_connection_actor(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.provision_gmail_connection(
  _actor_user_id uuid, _expected_tenant_id uuid, _google_account_id text,
  _gmail_address text, _display_name text, _purpose text,
  _granted_scopes text[], _refresh_token text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  address text := lower(btrim(_gmail_address));
  secret_ref text;
  existing public.channel_connectors%ROWTYPE;
  saved public.channel_connectors%ROWTYPE;
  reconnected boolean := false;
BEGIN
  PERFORM public._gmail_connection_actor(_actor_user_id,_expected_tenant_id);
  IF address IS NULL OR length(address)>320 OR position('@' IN address)<2
    OR nullif(btrim(_google_account_id),'') IS NULL OR length(_google_account_id)>512
    OR _purpose IS NULL OR _purpose NOT IN ('send','inbox')
    OR nullif(_refresh_token,'') IS NULL THEN
    RAISE EXCEPTION 'GMAIL_CONNECTION_INVALID' USING ERRCODE='22023';
  END IF;
  secret_ref := 'gmail_refresh_token:'||_expected_tenant_id::text||':'||_google_account_id;
  -- The stable provider-account key must not replace another connector's private
  -- credential if Google returns a changed address. Use the same lock ordering
  -- for provision/disconnect; neither address nor Vault identity is a new store.
  PERFORM pg_advisory_xact_lock(hashtextextended(secret_ref,141));
  -- Normalize to the existing GLOBAL email/address uniqueness key. Gmail calls
  -- serialize even when no row yet exists; another provider's unique-index race
  -- still rolls back this whole transaction, including the incumbent Vault write.
  PERFORM pg_advisory_xact_lock(hashtextextended('gmail-connection:'||address,141));
  SELECT * INTO existing FROM public.channel_connectors
    WHERE channel_type='email' AND lower(inbound_address)=address FOR UPDATE;
  IF FOUND THEN
    IF existing.tenant_id IS DISTINCT FROM _expected_tenant_id OR existing.provider IS DISTINCT FROM 'gmail' THEN
      RAISE EXCEPTION 'GMAIL_ADDRESS_CONFLICT' USING ERRCODE='23505';
    END IF;
    IF existing.mailbox_class='personal' AND existing.mailbox_owner_user_id IS DISTINCT FROM _actor_user_id THEN
      RAISE EXCEPTION 'GMAIL_PERSONAL_MAILBOX_CONFLICT' USING ERRCODE='42501';
    END IF;
    IF existing.mailbox_class IS NULL OR existing.mailbox_class NOT IN ('personal','shared_support') THEN
      RAISE EXCEPTION 'GMAIL_MAILBOX_POLICY_UNAVAILABLE' USING ERRCODE='42501';
    END IF;
    IF _purpose='inbox' AND existing.mailbox_class='shared_support' THEN
      RAISE EXCEPTION 'GMAIL_SHARED_MAILBOX_CONFLICT' USING ERRCODE='42501';
    END IF;
    reconnected := true;
  END IF;
  PERFORM 1 FROM public.channel_connectors WHERE credentials_vault_ref=secret_ref
    AND id IS DISTINCT FROM existing.id FOR UPDATE;
  IF FOUND THEN RAISE EXCEPTION 'GMAIL_ADDRESS_CONFLICT' USING ERRCODE='23505'; END IF;
  -- Connector/advisory waits can outlive the first scope snapshot. Re-read the
  -- canonical selection immediately before each native write. Existing source
  -- rows stay locked; new membership/profile rows are snapshot changes, not a
  -- global authority freeze. Edge pre/post checks withhold later scope changes.
  PERFORM public._gmail_connection_actor(_actor_user_id,_expected_tenant_id);
  PERFORM public.write_channel_secret(secret_ref,_refresh_token,
    'Gmail refresh token for tenant '||_expected_tenant_id::text||' ('||address||')');
  PERFORM public._gmail_connection_actor(_actor_user_id,_expected_tenant_id);
  IF reconnected THEN
    UPDATE public.channel_connectors SET
      external_account_id=_google_account_id,from_address=address,from_name=_display_name,
      display_name=coalesce(_display_name,address),credentials_vault_ref=secret_ref,
      status='active',active=true,updated_at=now(),
      mailbox_scopes=to_jsonb(coalesce(_granted_scopes,ARRAY[]::text[])),
      mailbox_class=CASE WHEN _purpose='inbox' THEN 'personal' ELSE existing.mailbox_class END,
      mailbox_owner_user_id=CASE WHEN _purpose='inbox' THEN _actor_user_id ELSE existing.mailbox_owner_user_id END
      WHERE id=existing.id AND tenant_id=_expected_tenant_id RETURNING * INTO saved;
  ELSE
    INSERT INTO public.channel_connectors(tenant_id,channel_type,provider,inbound_address,
      external_account_id,from_address,from_name,display_name,credentials_vault_ref,status,active,
      mailbox_class,mailbox_owner_user_id,mailbox_scopes)
    VALUES(_expected_tenant_id,'email','gmail',address,_google_account_id,address,_display_name,
      coalesce(_display_name,address),secret_ref,'active',true,
      CASE WHEN _purpose='inbox' THEN 'personal' ELSE 'shared_support' END,
      CASE WHEN _purpose='inbox' THEN _actor_user_id ELSE NULL END,
      to_jsonb(coalesce(_granted_scopes,ARRAY[]::text[]))) RETURNING * INTO saved;
  END IF;
  IF saved.id IS NULL OR saved.tenant_id IS DISTINCT FROM _expected_tenant_id
    OR saved.provider IS DISTINCT FROM 'gmail' OR saved.credentials_vault_ref IS DISTINCT FROM secret_ref
    OR saved.status IS DISTINCT FROM 'active' OR saved.active IS DISTINCT FROM true
    OR saved.from_address IS DISTINCT FROM address OR saved.external_account_id IS DISTINCT FROM _google_account_id
    OR saved.mailbox_scopes IS DISTINCT FROM to_jsonb(coalesce(_granted_scopes,ARRAY[]::text[]))
    OR (_purpose='inbox' AND (saved.mailbox_class IS DISTINCT FROM 'personal'
      OR saved.mailbox_owner_user_id IS DISTINCT FROM _actor_user_id)) THEN
    RAISE EXCEPTION 'GMAIL_CONNECTION_WRITE_UNCONFIRMED' USING ERRCODE='P0001';
  END IF;
  RETURN jsonb_build_object('ok',true,'connection_saved',true,'connector_id',saved.id,
    'tenant_id',saved.tenant_id,'gmail_address',saved.from_address,'reconnected',reconnected,
    'mailbox_class',saved.mailbox_class);
END $$;
REVOKE ALL ON FUNCTION public.provision_gmail_connection(uuid,uuid,text,text,text,text,text[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.provision_gmail_connection(uuid,uuid,text,text,text,text,text[],text) TO service_role;

CREATE OR REPLACE FUNCTION public.disconnect_gmail_connection(
  _actor_user_id uuid, _expected_tenant_id uuid, _connector_id uuid,
  _expected_vault_ref text, _expected_updated_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE existing public.channel_connectors%ROWTYPE; saved public.channel_connectors%ROWTYPE;
BEGIN
  PERFORM public._gmail_connection_actor(_actor_user_id,_expected_tenant_id);
  IF _expected_vault_ref IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_expected_vault_ref,141));
  END IF;
  SELECT * INTO existing FROM public.channel_connectors WHERE id=_connector_id
    AND tenant_id=_expected_tenant_id AND channel_type='email' AND provider='gmail' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GMAIL_CONNECTION_CHANGED' USING ERRCODE='40001'; END IF;
  IF existing.mailbox_class='personal' AND existing.mailbox_owner_user_id IS DISTINCT FROM _actor_user_id THEN
    RAISE EXCEPTION 'GMAIL_PERSONAL_MAILBOX_CONFLICT' USING ERRCODE='42501';
  END IF;
  IF existing.credentials_vault_ref IS DISTINCT FROM _expected_vault_ref
    OR existing.updated_at IS DISTINCT FROM _expected_updated_at THEN
    RAISE EXCEPTION 'GMAIL_CONNECTION_CHANGED' USING ERRCODE='40001';
  END IF;
  IF existing.credentials_vault_ref IS NOT NULL AND (existing.external_account_id IS NULL
    OR existing.credentials_vault_ref IS DISTINCT FROM 'gmail_refresh_token:'||_expected_tenant_id::text||':'||existing.external_account_id) THEN
    RAISE EXCEPTION 'GMAIL_CREDENTIAL_SCOPE_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  IF existing.active IS NOT TRUE AND existing.credentials_vault_ref IS NULL THEN
    PERFORM public._gmail_connection_actor(_actor_user_id,_expected_tenant_id);
    RETURN jsonb_build_object('ok',true,'disconnected',false,'connector_id',existing.id,'tenant_id',existing.tenant_id);
  END IF;
  IF existing.credentials_vault_ref IS NOT NULL THEN
    PERFORM 1 FROM public.channel_connectors WHERE credentials_vault_ref=existing.credentials_vault_ref
      AND id<>existing.id FOR UPDATE;
    IF FOUND THEN RAISE EXCEPTION 'GMAIL_CREDENTIAL_SCOPE_UNAVAILABLE' USING ERRCODE='42501'; END IF;
    PERFORM public._gmail_connection_actor(_actor_user_id,_expected_tenant_id);
    PERFORM public.write_channel_secret(existing.credentials_vault_ref,'revoked',
      'Gmail refresh token disconnected for tenant '||_expected_tenant_id::text);
  END IF;
  PERFORM public._gmail_connection_actor(_actor_user_id,_expected_tenant_id);
  UPDATE public.channel_connectors SET active=false,status='disabled',credentials_vault_ref=NULL,updated_at=now()
    WHERE id=existing.id AND tenant_id=_expected_tenant_id RETURNING * INTO saved;
  IF saved.id IS NULL OR saved.active IS DISTINCT FROM false
    OR saved.credentials_vault_ref IS NOT NULL OR saved.status IS DISTINCT FROM 'disabled' THEN
    RAISE EXCEPTION 'GMAIL_DISCONNECT_WRITE_UNCONFIRMED' USING ERRCODE='P0001';
  END IF;
  RETURN jsonb_build_object('ok',true,'disconnected',true,'connector_id',saved.id,'tenant_id',saved.tenant_id);
END $$;
REVOKE ALL ON FUNCTION public.disconnect_gmail_connection(uuid,uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_gmail_connection(uuid,uuid,uuid,text,timestamptz) TO service_role;
