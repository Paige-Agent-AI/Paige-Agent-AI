-- EXP08 owner uncapped-consumption supersession. Retire only the old financial start allowance.
-- Original ingress-abuse, source/actor/tool authority, idempotency and in-flight guards remain.
-- No provider/routing/meter/billing/Trust configuration or unattended capability activation.
BEGIN;
SET LOCAL lock_timeout='2s';
DO $uncapped$
DECLARE
 target regprocedure:=to_regprocedure('public.team_hub_accept_agent_turn(uuid,uuid,uuid,uuid,text,text,text)');
 p pg_proc; original_source text; definition text; inverse text; before_metadata jsonb; patch jsonb;
 patches jsonb:=jsonb_build_array(
  jsonb_build_object('old','turn public.team_hub_agent_turns; used bigint;','new','turn public.team_hub_agent_turns;'),
  jsonb_build_object('old',$old$ -- One person's turns are counted one at a time, so two concurrent acceptances cannot both take the 30th.$old$,
   'new',$new$ -- Serialize the original turn identity and resume collisions; this is not a financial allowance.$new$),
  jsonb_build_object('old',$old$ -- The cap: every model turn this person started here in the last hour, re-arms included. Only rows
 -- accepted inside the window can hold an attempt inside it (team_hub_agent_turns_attempts_chk).
 SELECT coalesce(sum((SELECT count(*) FROM unnest(t.attempts) a(at) WHERE a.at>now()-interval '1 hour')),0) INTO used
  FROM public.team_hub_agent_turns t
  WHERE t.tenant_id=p_tenant AND t.asker_user_id=p_asker AND t.accepted_at>now()-interval '1 hour';
 IF used>=30 THEN RETURN jsonb_build_object('ok',false,'code','rate_limited'); END IF;$old$,
   'new',$new$ -- exp08_uncapped_consumption_v1: attributable consumption is not a fixed start allowance.
 -- Original request-abuse, authority, source, in-flight and duplicate safeguards remain.$new$));
BEGIN
 IF target IS NULL THEN RAISE EXCEPTION 'EXP08 uncapped original admission missing'; END IF;
 SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure('public._team_hub_refusal(uuid)');
 IF NOT FOUND OR md5(p.prosrc)<>'1c2ef63537cb340106b95b730e3f05f1'
  OR p.proowner<>'postgres'::regrole OR p.prosecdef OR p.provolatile<>'s'
  OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
  OR p.prorettype<>'text'::regtype OR p.proretset OR p.pronargdefaults<>0
  OR p.proargnames IS DISTINCT FROM ARRAY['p_expected_tenant']::text[]
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee<>'postgres'::regrole OR a.privilege_type<>'EXECUTE') THEN
  RAISE EXCEPTION 'EXP08 uncapped current actor admission prerequisite drift';
 END IF;
 SELECT * INTO STRICT p FROM pg_proc WHERE oid=target;
 IF p.proowner<>'postgres'::regrole OR NOT p.prosecdef OR p.provolatile<>'v'
  OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.prokind<>'f'
  OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
  OR p.prorettype<>'jsonb'::regtype OR p.proretset OR p.pronargdefaults<>0
  OR p.proargnames IS DISTINCT FROM ARRAY['p_tenant','p_asker','p_channel_id','p_source_message_id','p_agent_key','p_intent','p_token_hash']::text[]
  OR EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE a.grantee NOT IN ('postgres'::regrole,'service_role'::regrole) OR a.privilege_type<>'EXECUTE'
    OR (a.is_grantable AND a.grantee<>'postgres'::regrole))
  OR NOT has_function_privilege('service_role',target,'EXECUTE') THEN
  RAISE EXCEPTION 'EXP08 uncapped original metadata drift';
 END IF;
 SELECT prosrc,pg_get_functiondef(oid),to_jsonb(f)-'prosrc' INTO original_source,definition,before_metadata
  FROM pg_proc f WHERE oid=target;
 IF position('exp08_uncapped_consumption_v1' IN original_source)>0 THEN
  inverse:=original_source;
  FOR patch IN SELECT value FROM jsonb_array_elements(patches) LOOP
   IF (length(inverse)-length(replace(inverse,patch->>'new','')))/length(patch->>'new')<>1 THEN
    RAISE EXCEPTION 'EXP08 uncapped partial or drifted source';
   END IF;
   inverse:=replace(inverse,patch->>'new',patch->>'old');
  END LOOP;
  IF md5(inverse)<>'e2b0b503c90a603a2bca402f689a1555' THEN RAISE EXCEPTION 'EXP08 uncapped inverse source drift'; END IF;
  RETURN;
 END IF;
 IF md5(original_source)<>'e2b0b503c90a603a2bca402f689a1555' THEN RAISE EXCEPTION 'EXP08 uncapped original source drift'; END IF;
 FOR patch IN SELECT value FROM jsonb_array_elements(patches) LOOP
  IF (length(original_source)-length(replace(original_source,patch->>'old','')))/length(patch->>'old')<>1 THEN
   RAISE EXCEPTION 'EXP08 uncapped original span drift';
  END IF;
  definition:=replace(definition,patch->>'old',patch->>'new');
 END LOOP;
 EXECUTE definition;
 IF (SELECT to_jsonb(f)-'prosrc' FROM pg_proc f WHERE oid=target) IS DISTINCT FROM before_metadata THEN
  RAISE EXCEPTION 'EXP08 uncapped original metadata conservation failed';
 END IF;
 SELECT prosrc INTO inverse FROM pg_proc WHERE oid=target;
 FOR patch IN SELECT value FROM jsonb_array_elements(patches) LOOP inverse:=replace(inverse,patch->>'new',patch->>'old'); END LOOP;
 IF md5(inverse)<>'e2b0b503c90a603a2bca402f689a1555' THEN RAISE EXCEPTION 'EXP08 uncapped source conservation failed'; END IF;
END $uncapped$;
COMMIT;
