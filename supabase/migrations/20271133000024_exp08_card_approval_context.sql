-- EXP08: original card approval context through the existing caller reader.
-- Guard the observed production reader. No permissions are broadened.
-- Fresh Supabase branches can retain service-role administrative defaults;
-- narrow only that known non-DML remainder to the actual production ACL.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $guard$
DECLARE f pg_proc;
BEGIN
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='public.team_hub_card_states(uuid,uuid,uuid[])'::regprocedure;
 IF md5(replace(f.prosrc,chr(13),'')) NOT IN ('7eff212d941b96f434381b6d48238310','942febe890d60e20b3470f2175a2dafd')
  OR NOT f.prosecdef OR f.provolatile<>'s' OR f.proowner<>'postgres'::regrole
  OR f.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR NOT has_function_privilege('authenticated',f.oid,'EXECUTE')
  OR has_function_privilege('anon',f.oid,'EXECUTE')
  OR has_function_privilege('service_role',f.oid,'EXECUTE')
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
    WHERE a.grantee NOT IN ('postgres'::regrole,'authenticated'::regrole)
     OR a.grantor<>'postgres'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable) THEN
  RAISE EXCEPTION 'EXP08 card context prerequisite drift';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_class c WHERE c.oid IN
   ('public.team_hub_messages'::regclass,'public.team_hub_agent_turns'::regclass,'public.team_hub_message_cards'::regclass)
   AND (NOT c.relrowsecurity OR c.relowner<>'postgres'::regrole OR EXISTS(
    SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
    WHERE a.grantor<>'postgres'::regrole OR (a.grantee<>'postgres'::regrole AND
     (a.grantee<>'service_role'::regrole OR a.is_grantable
      OR a.privilege_type NOT IN ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')))))) THEN
  RAISE EXCEPTION 'EXP08 protected card table grants drift';
 END IF;
 -- Production already has no service table privileges: this is a no-op there.
 -- Refuse any DML/reader or unrelated-role drift above before narrowing defaults.
 REVOKE ALL ON TABLE public.team_hub_messages,public.team_hub_agent_turns,public.team_hub_message_cards FROM service_role;
 IF EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
  WHERE c.oid IN ('public.team_hub_messages'::regclass,'public.team_hub_agent_turns'::regclass,'public.team_hub_message_cards'::regclass)
   AND (a.grantee<>'postgres'::regrole OR a.grantor<>'postgres'::regrole)) THEN
  RAISE EXCEPTION 'EXP08 protected card table grants postcondition';
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
   || CASE WHEN s.approver_user_id=actor AND s.approval_context IS NOT NULL
      THEN jsonb_build_object('approval_context',s.approval_context) ELSE '{}'::jsonb END
   ORDER BY s.message_id),'[]'::jsonb) INTO cards
 FROM (
  SELECT k.message_id, k.kind, k.approver_user_id, k.decision, k.decided_at, k.outcome_message_id, k.outcome_record,
   k.outcome_note, coalesce(k.summary,p.summary) AS summary, p.fingerprint, p.expires_at, a.active AS approver_active,
   provenance.approval_context,
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
  LEFT JOIN LATERAL (
   SELECT jsonb_build_object('tenant_id',k.tenant_id,'channel_id',ch.id,'approver_user_id',actor,
     'agent_key',t.agent_key,'source_message_id',t.source_message_id,'root_message_id',root.id) AS approval_context
   FROM public.team_hub_agent_turns t
   JOIN public.team_hub_messages src ON src.id=t.source_message_id AND src.tenant_id=k.tenant_id
    AND src.author_user_id=actor AND src.author_kind='user' AND src.deleted_at IS NULL
   JOIN public.team_hub_messages root ON root.id=coalesce(m.parent_message_id,m.id)
    AND root.tenant_id=k.tenant_id AND root.channel_id=ch.id AND root.parent_message_id IS NULL AND root.deleted_at IS NULL
   WHERE k.approver_user_id=actor AND ch.kind='agent_dm' AND ch.created_by=actor
    AND m.author_user_id=actor AND m.author_kind='agent' AND m.agent_key=ch.agent_key
    AND t.posted_message_id=m.id AND t.tenant_id=k.tenant_id AND t.asker_user_id=actor
    AND t.channel_id=ch.id AND t.agent_key=m.agent_key AND t.intent='dm' AND t.consumed_at IS NOT NULL
    AND t.agent_key IN ('paige','vera','nexus','cura','mentor','merit','zion')
    AND EXISTS(SELECT 1 FROM public._team_hub_visible(k.tenant_id,actor,src.channel_id))
    AND NOT EXISTS(SELECT 1 FROM public.team_hub_agent_turns other WHERE other.posted_message_id=m.id AND other.id<>t.id)
  ) provenance ON true
  WHERE k.message_id=ANY(p_message_ids) AND k.channel_id=ch.id AND k.tenant_id=p_expected_tenant
 ) s
 LEFT JOIN public.profiles pr ON pr.user_id=s.approver_user_id;
 RETURN jsonb_build_object('ok',true,'cards',cards);
END $$;
COMMIT;
