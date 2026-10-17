-- Extends the sole email_send_log. No new sender, queue, approval or provider activation.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public._client_portal_invitation_owner(uuid)') IS NULL THEN
    RAISE EXCEPTION 'customer invitation operation prerequisite missing';
  END IF;
  IF EXISTS(SELECT 1 FROM public.email_send_log WHERE idempotency_key LIKE 'customer-portal-delivery/v1/%') THEN
    RAISE EXCEPTION 'customer invitation delivery namespace requires source review';
  END IF;
END $$;
CREATE UNIQUE INDEX email_send_log_customer_portal_operation
  ON public.email_send_log(idempotency_key) WHERE idempotency_key LIKE 'customer-portal-delivery/v1/%';

CREATE FUNCTION public._client_portal_invitation_delivery_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF current_user<>'postgres' AND (NEW.idempotency_key LIKE 'customer-portal-delivery/v1/%'
    OR (TG_OP='UPDATE' AND OLD.idempotency_key LIKE 'customer-portal-delivery/v1/%')) THEN
    RAISE EXCEPTION 'CUSTOMER_INVITATION_NATIVE_DELIVERY_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_portal_invitation_delivery_guard BEFORE INSERT OR UPDATE ON public.email_send_log
  FOR EACH ROW EXECUTE FUNCTION public._client_portal_invitation_delivery_guard();

CREATE FUNCTION public._client_portal_invitation_delivery_result(p_row public.email_send_log,p_actor uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('actor_id',p_actor,'tenant_id',(p_row).tenant_id,'found',true,
  'operation_id',(p_row).metadata->>'operation_id','invitation_id',(p_row).metadata->>'invite_id','receipt_id',(p_row).id,
  'requested_by',(p_row).metadata->>'actor_user_id','reconciled_by',(p_row).metadata->>'reconciler_user_id',
  'outcome',CASE WHEN (p_row).message_id ~ '^[A-Za-z0-9_-]{1,200}$' AND (p_row).status='sent' THEN 'provider_accepted'
    WHEN (p_row).metadata->>'outcome' IN ('failed','refused') THEN (p_row).metadata->>'outcome'
    WHEN (p_row).metadata->>'outcome'='outcome_unknown' THEN 'outcome_unknown' ELSE 'pending' END,
  'provider_message_id',CASE WHEN (p_row).message_id ~ '^[A-Za-z0-9_-]{1,200}$' AND (p_row).status='sent' THEN (p_row).message_id ELSE NULL END,
  'observed_at',(p_row).created_at)
$$;

CREATE FUNCTION public.read_client_portal_invitation_delivery(p_tenant_id uuid,p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; source public.email_send_log;
BEGIN
 actor:=public._client_portal_invitation_owner(p_tenant_id);
 IF p_operation_id IS NULL THEN RAISE EXCEPTION 'CUSTOMER_INVITATION_DELIVERY_ARGUMENTS' USING ERRCODE='22023'; END IF;
 SELECT l.* INTO source FROM public.email_send_log l
  WHERE l.tenant_id=p_tenant_id AND l.idempotency_key='customer-portal-delivery/v1/'||p_tenant_id::text||'/'||p_operation_id::text;
 IF NOT FOUND THEN RETURN jsonb_build_object('actor_id',actor,'tenant_id',p_tenant_id,'operation_id',p_operation_id,'found',false);END IF;
 RETURN public._client_portal_invitation_delivery_result(source,actor);
END $$;

CREATE FUNCTION public.claim_client_portal_invitation_delivery(
 p_tenant_id uuid,p_invitation_id uuid,p_operation_id uuid,p_payload_digest text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; invitation public.tenant_invite_tokens; source public.email_send_log; target jsonb;
 key text; claim uuid:=gen_random_uuid(); active boolean; started timestamptz; disposition text;
BEGIN
 actor:=public._client_portal_invitation_owner(p_tenant_id);
 IF p_invitation_id IS NULL OR p_operation_id IS NULL OR (p_payload_digest ~ '^[0-9a-f]{64}$') IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'CUSTOMER_INVITATION_DELIVERY_ARGUMENTS' USING ERRCODE='22023';END IF;
 key:='customer-portal-delivery/v1/'||p_tenant_id::text||'/'||p_operation_id::text;
 -- One invitation cannot bypass an unknown send with a new operation or another owner.
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-invitation-delivery:'||p_tenant_id::text||':'||p_invitation_id::text,0));
 SELECT i.* INTO invitation FROM public.tenant_invite_tokens i WHERE i.id=p_invitation_id AND i.tenant_id=p_tenant_id FOR SHARE;
 IF NOT FOUND OR invitation.kind IS DISTINCT FROM 'consumer' OR invitation.contact_id IS NULL THEN
  RAISE EXCEPTION 'CUSTOMER_INVITATION_DELIVERY_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT l.* INTO source FROM public.email_send_log l WHERE l.idempotency_key=key FOR UPDATE;
 IF FOUND THEN
  IF source.tenant_id IS DISTINCT FROM p_tenant_id OR source.template_name IS DISTINCT FROM 'portal_invite'
    OR source.metadata->>'invite_id' IS DISTINCT FROM p_invitation_id::text
    OR source.metadata->>'payload_digest' IS DISTINCT FROM p_payload_digest THEN
   RAISE EXCEPTION 'CUSTOMER_INVITATION_DELIVERY_CONFLICT' USING ERRCODE='40001';END IF;
  IF source.status='sent' AND source.message_id ~ '^[A-Za-z0-9_-]{1,200}$'
    OR source.metadata->>'outcome' IN ('failed','refused') THEN
   RETURN public._client_portal_invitation_delivery_result(source,actor)||jsonb_build_object('disposition','recorded');END IF;
 END IF;
 active:=invitation.revoked_at IS NULL AND invitation.expires_at>statement_timestamp()
   AND invitation.uses=0 AND invitation.last_used_at IS NULL AND (invitation.max_uses IS NULL OR invitation.max_uses>0);
 IF active THEN
  target:=public._client_portal_invitation_target(p_tenant_id,invitation.contact_id);
  active:=target->>'recipient'=lower(btrim(invitation.email));
 END IF;
 IF active IS DISTINCT FROM true THEN
  IF source.id IS NOT NULL THEN RETURN public._client_portal_invitation_delivery_result(source,actor)||jsonb_build_object('disposition','held');END IF;
  RAISE EXCEPTION 'CUSTOMER_INVITATION_DELIVERY_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF source.id IS NOT NULL THEN
  started:=(source.metadata->>'started_at')::timestamptz;
  IF started IS NULL OR started<=statement_timestamp()-interval '23 hours' THEN
   RETURN public._client_portal_invitation_delivery_result(source,actor)||jsonb_build_object('disposition','held');END IF;
  IF (source.metadata->>'claim_expires_at')::timestamptz>statement_timestamp() THEN
   RETURN public._client_portal_invitation_delivery_result(source,actor)||jsonb_build_object('disposition','busy');END IF;
  disposition:='reconcile';
  UPDATE public.email_send_log SET metadata=metadata||jsonb_build_object('claim_id',claim,'claim_expires_at',statement_timestamp()+interval '25 seconds',
    'reconciler_user_id',actor) WHERE id=source.id RETURNING * INTO source;
 ELSE
  IF EXISTS(SELECT 1 FROM public.email_send_log l WHERE l.tenant_id=p_tenant_id
    AND l.idempotency_key LIKE 'customer-portal-delivery/v1/%' AND l.metadata->>'invite_id'=p_invitation_id::text
    AND NOT (l.status='sent' AND l.message_id ~ '^[A-Za-z0-9_-]{1,200}$')
    AND COALESCE(l.metadata->>'outcome','pending') NOT IN ('failed','refused')) THEN
   RAISE EXCEPTION 'CUSTOMER_INVITATION_PREVIOUS_SEND_UNCONFIRMED' USING ERRCODE='40001';END IF;
  disposition:='dispatch';
  INSERT INTO public.email_send_log(id,tenant_id,template_name,recipient_email,status,sender_account,idempotency_key,metadata)
   VALUES(gen_random_uuid(),p_tenant_id,'portal_invite',lower(btrim(invitation.email)),'pending','platform',key,
    jsonb_build_object('via','send-portal-invite','kind','consumer','invite_id',p_invitation_id,'contact_id',invitation.contact_id,
      'operation_id',p_operation_id,'actor_user_id',actor,'reconciler_user_id',actor,'payload_digest',p_payload_digest,
      'started_at',statement_timestamp(),'claim_id',claim,'claim_expires_at',statement_timestamp()+interval '25 seconds')) RETURNING * INTO source;
 END IF;
 -- Claim identity/key are internal execution preconditions; adapters never put them in model/tool results.
 RETURN public._client_portal_invitation_delivery_result(source,actor)||jsonb_build_object('disposition',disposition,'claim_id',claim,'provider_key',key);
END $$;

CREATE FUNCTION public.finalize_client_portal_invitation_delivery(
 p_tenant_id uuid,p_operation_id uuid,p_claim_id uuid,p_payload_digest text,p_outcome text,p_message_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE source public.email_send_log; send_status text; outcome text;
BEGIN
 -- Service-only recording of the already claimed observation. Never dispatches or changes authority.
 IF p_tenant_id IS NULL OR p_operation_id IS NULL OR p_claim_id IS NULL OR p_payload_digest IS NULL
   OR p_outcome NOT IN ('provider_accepted','failed','outcome_unknown','refused') OR p_outcome IS NULL THEN
  RAISE EXCEPTION 'CUSTOMER_INVITATION_DELIVERY_ARGUMENTS' USING ERRCODE='22023';END IF;
 SELECT l.* INTO source FROM public.email_send_log l
  WHERE l.tenant_id=p_tenant_id AND l.idempotency_key='customer-portal-delivery/v1/'||p_tenant_id::text||'/'||p_operation_id::text FOR UPDATE;
 IF NOT FOUND OR source.metadata->>'payload_digest' IS DISTINCT FROM p_payload_digest THEN
  RAISE EXCEPTION 'CUSTOMER_INVITATION_DELIVERY_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF (source.status='sent' AND source.message_id ~ '^[A-Za-z0-9_-]{1,200}$') OR source.metadata->>'outcome' IN ('failed','refused') THEN
  RETURN public._client_portal_invitation_delivery_result(source,(source.metadata->>'reconciler_user_id')::uuid);END IF;
 IF source.metadata->>'claim_id' IS DISTINCT FROM p_claim_id::text THEN
  RAISE EXCEPTION 'CUSTOMER_INVITATION_DELIVERY_CLAIM_CHANGED' USING ERRCODE='40001';END IF;
 outcome:=p_outcome;
 IF outcome='provider_accepted' AND (p_message_id ~ '^[A-Za-z0-9_-]{1,200}$') IS DISTINCT FROM true THEN outcome:='outcome_unknown';END IF;
 send_status:=CASE WHEN outcome='provider_accepted' THEN 'sent' ELSE 'failed' END;
 UPDATE public.email_send_log SET status=send_status,
  message_id=CASE WHEN outcome='provider_accepted' THEN p_message_id ELSE NULL END,created_at=clock_timestamp(),
  metadata=metadata||jsonb_build_object('outcome',outcome,'reason',CASE WHEN outcome='outcome_unknown' THEN 'transport' WHEN outcome='refused' THEN 'not_dispatched' ELSE 'provider_response' END,
    'claim_expires_at',statement_timestamp(),'recorded_at',clock_timestamp()) WHERE id=source.id RETURNING * INTO source;
 RETURN public._client_portal_invitation_delivery_result(source,(source.metadata->>'reconciler_user_id')::uuid);
END $$;

REVOKE ALL ON FUNCTION public._client_portal_invitation_delivery_guard(),
 public._client_portal_invitation_delivery_result(public.email_send_log,uuid),
 public.read_client_portal_invitation_delivery(uuid,uuid),
 public.claim_client_portal_invitation_delivery(uuid,uuid,uuid,text),
 public.finalize_client_portal_invitation_delivery(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_client_portal_invitation_delivery(uuid,uuid),
 public.claim_client_portal_invitation_delivery(uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_client_portal_invitation_delivery(uuid,uuid,uuid,text,text,text) TO service_role;
COMMIT;
