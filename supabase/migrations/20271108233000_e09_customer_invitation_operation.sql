-- Native preparation/recovery only. No sender, approval channel, staff seat or provider activation.
BEGIN;
DO $$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid =
      'public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text)'::regprocedure)
      IS DISTINCT FROM '3a91af3aeb67fb8dbbf450eb3d612ade' THEN
    RAISE EXCEPTION 'customer invitation producer authority changed';
  END IF;
END $$;

ALTER TABLE public.tenant_invite_tokens
  ADD COLUMN portal_operation_id uuid,
  ADD COLUMN portal_proposal_hash text,
  ADD COLUMN portal_receipt_id uuid;
ALTER TABLE public.tenant_invite_tokens ADD CONSTRAINT tenant_invite_portal_operation_shape CHECK (
  (portal_operation_id IS NULL AND portal_proposal_hash IS NULL AND portal_receipt_id IS NULL)
  OR (portal_operation_id IS NOT NULL AND portal_proposal_hash IS NOT NULL AND portal_proposal_hash ~ '^[0-9a-f]{64}$'
      AND portal_receipt_id IS NOT NULL AND kind = 'consumer'
      AND created_by IS NOT NULL AND email IS NOT NULL AND max_uses IS NOT DISTINCT FROM 1)
);
CREATE UNIQUE INDEX tenant_invite_portal_operation_unique
  ON public.tenant_invite_tokens(tenant_id,created_by,portal_operation_id)
  WHERE portal_operation_id IS NOT NULL;

-- Existing API table grants must not become authority to forge native operation bindings.
-- Invoker semantics are deliberate: a native SECURITY DEFINER writer runs as postgres;
-- an ordinary direct table request does not. Lifecycle-only changes retain existing policy.
CREATE FUNCTION public._client_portal_invitation_binding_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user<>'postgres' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.portal_operation_id IS NOT NULL OR NEW.portal_proposal_hash IS NOT NULL OR NEW.portal_receipt_id IS NOT NULL THEN
        RAISE EXCEPTION 'CUSTOMER_INVITATION_NATIVE_BINDING_REQUIRED' USING ERRCODE='42501';
      END IF;
    ELSIF ROW(NEW.portal_operation_id,NEW.portal_proposal_hash,NEW.portal_receipt_id)
        IS DISTINCT FROM ROW(OLD.portal_operation_id,OLD.portal_proposal_hash,OLD.portal_receipt_id)
      OR (OLD.portal_operation_id IS NOT NULL AND ROW(NEW.id,NEW.tenant_id,NEW.created_by,NEW.email,NEW.kind,NEW.default_role,NEW.max_uses,NEW.token,NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.created_by,OLD.email,OLD.kind,OLD.default_role,OLD.max_uses,OLD.token,OLD.created_at))
      OR (OLD.portal_operation_id IS NOT NULL AND NEW.contact_id IS DISTINCT FROM OLD.contact_id AND NEW.contact_id IS NOT NULL) THEN
      RAISE EXCEPTION 'CUSTOMER_INVITATION_NATIVE_BINDING_REQUIRED' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_portal_invitation_binding_guard BEFORE INSERT OR UPDATE ON public.tenant_invite_tokens
  FOR EACH ROW EXECUTE FUNCTION public._client_portal_invitation_binding_guard();

CREATE FUNCTION public._client_portal_invitation_owner(p_tenant_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR p_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.account_type<>'agency'
  ) OR NOT (
    COALESCE(public.is_platform_owner(),false)
    OR COALESCE(public.is_tenant_admin(p_tenant_id),false)
    OR COALESCE(public.agency_can_manage_child(p_tenant_id,actor),false)
  ) THEN RAISE EXCEPTION 'CUSTOMER_INVITATION_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
  RETURN actor;
END $$;

CREATE FUNCTION public._client_portal_invitation_target(p_tenant_id uuid,p_contact_id uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; customer public.clients; method record; recipient text; method_count integer:=0; target jsonb;
BEGIN
  actor:=public._client_portal_invitation_owner(p_tenant_id);
  SELECT c.* INTO customer FROM public.clients c
    WHERE c.id=p_contact_id AND c.tenant_id=p_tenant_id FOR SHARE;
  IF NOT FOUND OR customer.status IS DISTINCT FROM 'active' OR customer.merged_into_contact_id IS NOT NULL
     OR customer.do_not_contact IS DISTINCT FROM false OR customer.linked_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'CUSTOMER_INVITATION_TARGET_CHANGED' USING ERRCODE='42501';
  END IF;
  FOR method IN SELECT m.id,m.value,m.updated_at FROM public.client_contact_methods m
    WHERE m.tenant_id=p_tenant_id AND m.client_id=p_contact_id AND m.kind='email' AND m.is_primary=true
    ORDER BY m.id FOR SHARE LOOP
    method_count:=method_count+1; recipient:=lower(btrim(method.value));
    IF method_count>1 THEN EXIT; END IF;
  END LOOP;
  IF method_count<>1 OR recipient IS NULL OR length(recipient)>320
     OR recipient!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'CUSTOMER_INVITATION_RECIPIENT_CHANGED' USING ERRCODE='22023';
  END IF;
  target:=jsonb_build_object('actor_id',actor,'tenant_id',p_tenant_id,'contact_id',p_contact_id,
    'recipient',recipient,'contact_updated_at',customer.updated_at,'method_id',method.id,
    'method_updated_at',method.updated_at,'kind','consumer','max_uses',1,'expires_in_days',30);
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',p_tenant_id,'contact_id',p_contact_id,
    'recipient',recipient,'proposal_hash',encode(extensions.digest(convert_to(target::text,'UTF8'),'sha256'),'hex'));
END $$;

CREATE FUNCTION public.prepare_client_portal_invitation(p_tenant_id uuid,p_contact_id uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public._client_portal_invitation_target(p_tenant_id,p_contact_id)
$$;

CREATE FUNCTION public.read_client_portal_invitation_operation(p_tenant_id uuid,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; invitation public.tenant_invite_tokens;
BEGIN
  actor:=public._client_portal_invitation_owner(p_tenant_id);
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_INVITATION_ARGUMENTS_INVALID' USING ERRCODE='22023'; END IF;
  SELECT i.* INTO invitation FROM public.tenant_invite_tokens i
    WHERE i.tenant_id=p_tenant_id AND i.created_by=actor AND i.portal_operation_id=p_operation_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('actor_id',actor,'tenant_id',p_tenant_id,'operation_id',p_operation_id,'found',false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.id=invitation.portal_receipt_id
    AND a.user_id=actor AND a.action='client_portal.invitation_prepared' AND a.entity='tenant_invite_tokens'
    AND a.entity_id=invitation.id AND a.data->>'tenant_id'=p_tenant_id::text
    AND a.data->>'operation_id'=p_operation_id::text AND a.data->>'proposal_hash'=invitation.portal_proposal_hash
    AND (invitation.contact_id IS NULL OR a.data->>'contact_id'=invitation.contact_id::text)) THEN
    RAISE EXCEPTION 'CUSTOMER_INVITATION_RECEIPT_UNAVAILABLE' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object('actor_id',actor,'tenant_id',p_tenant_id,'operation_id',p_operation_id,'found',true,
    'invitation_id',invitation.id,'contact_id',invitation.contact_id,'recipient',invitation.email,
    'proposal_hash',invitation.portal_proposal_hash,'receipt_id',invitation.portal_receipt_id,
    'created_at',invitation.created_at,'expires_at',invitation.expires_at,
    'state',CASE WHEN invitation.contact_id IS NULL THEN 'unavailable'
      WHEN invitation.last_used_at IS NOT NULL OR invitation.uses>0 THEN 'accepted'
      WHEN invitation.revoked_at IS NOT NULL THEN 'revoked'
      WHEN invitation.expires_at<=statement_timestamp() THEN 'expired' ELSE 'prepared' END);
END $$;

CREATE FUNCTION public.create_client_portal_invitation(
  p_tenant_id uuid,p_contact_id uuid,p_proposal_hash text,p_operation_id uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid; target jsonb; invitation public.tenant_invite_tokens; receipt uuid;
BEGIN
  actor:=public._client_portal_invitation_owner(p_tenant_id);
  IF p_contact_id IS NULL OR p_operation_id IS NULL OR p_proposal_hash IS NULL
     OR p_proposal_hash!~'^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'CUSTOMER_INVITATION_ARGUMENTS_INVALID' USING ERRCODE='22023';
  END IF;
  -- One native operation; no browser/model-provided authority and no new operation store.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':'||actor::text||':'||p_operation_id::text,0));
  SELECT i.* INTO invitation FROM public.tenant_invite_tokens i
    WHERE i.tenant_id=p_tenant_id AND i.created_by=actor AND i.portal_operation_id=p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF invitation.contact_id IS DISTINCT FROM p_contact_id OR invitation.portal_proposal_hash IS DISTINCT FROM p_proposal_hash THEN
      RAISE EXCEPTION 'CUSTOMER_INVITATION_OPERATION_CONFLICT' USING ERRCODE='40001';
    END IF;
    -- A completed operation is history, not authority for a new send. No raw token leaves this RPC.
    RETURN public.read_client_portal_invitation_operation(p_tenant_id,p_operation_id)||jsonb_build_object('replayed',true);
  END IF;
  -- Serialize with normal customer-row writers; the sender must still recheck recipient/lifecycle at egress.
  PERFORM 1 FROM public.clients c WHERE c.id=p_contact_id AND c.tenant_id=p_tenant_id FOR UPDATE;
  target:=public._client_portal_invitation_target(p_tenant_id,p_contact_id);
  IF target->>'proposal_hash' IS DISTINCT FROM p_proposal_hash THEN
    RAISE EXCEPTION 'CUSTOMER_INVITATION_PROPOSAL_CHANGED' USING ERRCODE='40001';
  END IF;
  invitation:=public.create_tenant_invite_token(p_tenant_id,'consumer','member'::public.tenant_role,30,1,p_contact_id,target->>'recipient');
  IF invitation.tenant_id IS DISTINCT FROM p_tenant_id OR invitation.contact_id IS DISTINCT FROM p_contact_id
     OR invitation.created_by IS DISTINCT FROM actor OR invitation.email IS DISTINCT FROM target->>'recipient'
     OR invitation.kind IS DISTINCT FROM 'consumer' OR invitation.max_uses IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'CUSTOMER_INVITATION_PRODUCER_MISMATCH' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data)
    VALUES(actor,'client_portal.invitation_prepared','tenant_invite_tokens',invitation.id,
      jsonb_build_object('tenant_id',p_tenant_id,'contact_id',p_contact_id,'operation_id',p_operation_id,
        'proposal_hash',p_proposal_hash,'state','prepared')) RETURNING id INTO receipt;
  UPDATE public.tenant_invite_tokens SET portal_operation_id=p_operation_id,
    portal_proposal_hash=p_proposal_hash,portal_receipt_id=receipt WHERE id=invitation.id;
  RETURN public.read_client_portal_invitation_operation(p_tenant_id,p_operation_id)||jsonb_build_object('replayed',false);
END $$;

REVOKE ALL ON FUNCTION public._client_portal_invitation_owner(uuid),
  public._client_portal_invitation_target(uuid,uuid),
  public._client_portal_invitation_binding_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.prepare_client_portal_invitation(uuid,uuid),
  public.read_client_portal_invitation_operation(uuid,uuid),
  public.create_client_portal_invitation(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_client_portal_invitation(uuid,uuid),
  public.read_client_portal_invitation_operation(uuid,uuid),
  public.create_client_portal_invitation(uuid,uuid,text,uuid) TO authenticated;
COMMENT ON FUNCTION public.create_client_portal_invitation(uuid,uuid,text,uuid) IS
  'Owner-authorized, recipient/version-bound native preparation/recovery over the incumbent invitation producer. Does not send, approve Chat/Live, grant a staff seat or prove delivery.';
COMMIT;
