-- EXP08 P2 recovery: only the asker can resume a positively unclaimed, unsettled approval.
-- Forward-only: preserve Preview-applied20008 and existing original writer/claim/settlement.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $guard$ DECLARE f pg_proc; BEGIN
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.team_hub_card_states(uuid,uuid,uuid[])'::regprocedure;
 IF md5(replace(f.prosrc,chr(13),'')) NOT IN ('a6fd4023d608d1f04f06703d92bd520a','7eff212d941b96f434381b6d48238310')
   OR NOT f.prosecdef OR f.provolatile<>'s' OR f.proowner<>'postgres'::regrole
   OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
   OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
      WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole) OR a.privilege_type<>'EXECUTE') THEN
  RAISE EXCEPTION 'EXP08 stranded-card read prerequisite drift';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.team_hub_card_states(p_expected_tenant uuid, p_channel_id uuid, p_message_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); refusal text:=public._team_hub_refusal(p_expected_tenant); ch public.team_hub_channels; cards jsonb;
BEGIN
 IF refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'code',refusal); END IF;
 SELECT * INTO ch FROM public._team_hub_visible(p_expected_tenant,actor,p_channel_id);
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF p_message_ids IS NULL OR cardinality(p_message_ids)>100 OR array_position(p_message_ids,NULL) IS NOT NULL THEN
  RETURN jsonb_build_object('ok',false,'code','invalid'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('message_id',s.message_id,
   'card',jsonb_build_object('state',s.state,'kind',s.kind,
    'actions',jsonb_build_array(jsonb_build_object('summary',s.summary)
     || CASE WHEN s.approver_user_id=actor AND (s.state='waiting' OR s.can_resume) THEN jsonb_build_object('fingerprint',s.fingerprint) ELSE '{}'::jsonb END
     || CASE WHEN s.state IN ('done','failed') AND s.outcome_note IS NOT NULL THEN jsonb_build_object('note',s.outcome_note) ELSE '{}'::jsonb END),
    'can_resume',s.can_resume AND s.approver_user_id=actor,
    'asker_user_id',s.approver_user_id,
    'decided_by_name',CASE WHEN s.decision IS NULL THEN NULL WHEN s.approver_active
     THEN coalesce(nullif(btrim(pr.full_name),''),'Teammate') ELSE 'Former teammate' END,
    'decided_at',s.decided_at,'expires_at',s.expires_at),
   'outcome_message_id',s.outcome_message_id,'record',s.outcome_record)
   ORDER BY s.message_id),'[]'::jsonb) INTO cards
 FROM (
  SELECT k.message_id, k.kind, k.approver_user_id, k.decision, k.decided_at, k.outcome_message_id, k.outcome_record,
   k.outcome_note, coalesce(k.summary,p.summary) AS summary, p.fingerprint, p.expires_at, a.active AS approver_active,
   (k.decision='approved' AND k.outcome IS NULL AND k.decided_at<=now()-interval '10 seconds'
     AND a.active AND p.id IS NOT NULL AND p.consumed_at IS NULL AND p.scoped_client_id IS NULL AND p.expires_at>now()) AS can_resume,
   CASE WHEN k.decision='declined' THEN 'declined'
    WHEN k.decision='approved' THEN CASE WHEN k.outcome IS NOT NULL THEN k.outcome
     WHEN k.decided_at>now()-interval '10 minutes' THEN 'working' ELSE 'unconfirmed' END
    WHEN NOT a.active OR p.id IS NULL THEN 'expired'
    WHEN p.consumed_at IS NOT NULL THEN 'unconfirmed'
    WHEN p.expires_at<=now() THEN 'expired'
    ELSE 'waiting' END AS state
  FROM public.team_hub_message_cards k
  JOIN public.team_hub_messages m ON m.id=k.message_id AND m.channel_id=ch.id AND m.tenant_id=p_expected_tenant AND m.deleted_at IS NULL
  LEFT JOIN public.paige_pending_confirmations p ON p.id=k.confirmation_id AND p.user_id=k.approver_user_id
   AND p.tenant_id=k.tenant_id AND p.thread_id IS NULL
  CROSS JOIN LATERAL (SELECT public._team_hub_is_active(k.tenant_id,k.approver_user_id) AS active) a
  WHERE k.message_id=ANY(p_message_ids) AND k.channel_id=ch.id AND k.tenant_id=p_expected_tenant
 ) s
 LEFT JOIN public.profiles pr ON pr.user_id=s.approver_user_id;
 RETURN jsonb_build_object('ok',true,'cards',cards);
END $$;
COMMIT;
