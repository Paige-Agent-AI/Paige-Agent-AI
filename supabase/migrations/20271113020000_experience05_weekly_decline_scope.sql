-- EXP05: keep a declined weekly draft bound to the same current owner scope.
-- Reuse claim/commit's lock order; preserve the original token, outcome and audit.
-- No backfill, new grant, recurring activation or original migration rewrite.
-- Follows the verified current production/source frontier 20271113000000.
CREATE OR REPLACE FUNCTION public.decline_weekly_commitment_draft(_confirmation_id uuid,_declined_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _p public.paige_pending_confirmations; _uid uuid:=auth.uid(); _tid uuid:=public.current_user_tenant_id();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  -- Freeze current workspace, membership and tenant before locking the proposal.
  -- A switch/revocation that wins first is revalidated; one that follows waits
  -- until this transaction finishes, just as it does for claim and commit.
  PERFORM 1 FROM public.profiles WHERE user_id=_uid FOR SHARE;
  IF NOT FOUND OR public.current_user_tenant_id() IS DISTINCT FROM _tid THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_SCOPE_CHANGED' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.tenant_members m JOIN public.tenants t ON t.id=m.tenant_id
    WHERE m.user_id=_uid AND m.tenant_id=_tid AND m.role::text='owner' AND m.status='active' AND t.archived_at IS NULL
    FOR SHARE OF m,t;
  IF NOT FOUND THEN RAISE EXCEPTION 'WEEKLY_CHECK_FORBIDDEN' USING ERRCODE='42501'; END IF;
  _p:=public._weekly_draft_proposal(_confirmation_id);
  PERFORM 1 FROM public.paige_pending_confirmations WHERE id=_p.id FOR UPDATE;
  _p:=public._weekly_draft_proposal(_confirmation_id);
  IF _p.consumed_at IS NOT NULL THEN RETURN public.read_weekly_commitment_draft(_p.id); END IF;
  IF _declined_token IS NULL OR _declined_token IS DISTINCT FROM (_p.fingerprint||':'||_p.issued_in_request::text) THEN
    RAISE EXCEPTION 'WEEKLY_DRAFT_APPROVAL_UNAVAILABLE' USING ERRCODE='42501'; END IF;
  UPDATE public.paige_pending_confirmations SET consumed_at=clock_timestamp() WHERE id=_p.id AND consumed_at IS NULL;
  INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data)
    VALUES(_p.user_id,'paige_pending_confirmation','weekly_draft.declined',_p.id,jsonb_build_object('tenant_id',_p.tenant_id));
  RETURN public.read_weekly_commitment_draft(_p.id);
END $$;
REVOKE ALL ON FUNCTION public.decline_weekly_commitment_draft(uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.decline_weekly_commitment_draft(uuid,text) TO authenticated;
