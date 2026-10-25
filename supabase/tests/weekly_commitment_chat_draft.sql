-- Existing isolated weekly PostgreSQL proof only. Real native functions and API roles;
-- synthetic auth/context ports are inherited from that fixture, never production JWT proof.
-- The active protocol below is rollback-only test configuration, NOT cessation evidence.
BEGIN;
CREATE TEMP TABLE weekly_chat_assertions(label text);
CREATE TEMP SEQUENCE weekly_chat_assertion_count;
CREATE FUNCTION pg_temp.weekly_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'WEEKLY_CHAT_PROOF_FAIL: %',label; END IF;
  PERFORM nextval('pg_temp.weekly_chat_assertion_count');
  INSERT INTO weekly_chat_assertions VALUES(label);
END $$;
CREATE FUNCTION pg_temp.weekly_refuses(statement text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE refused boolean:=false;
BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN insufficient_privilege THEN refused:=true;
  END;
  PERFORM pg_temp.weekly_assert(refused,label);
END $$;
CREATE TEMP TABLE weekly_chat_cases(n integer PRIMARY KEY,pid uuid,thread uuid,request uuid,
  intent uuid,nonce uuid,issued uuid,token text,args jsonb);
GRANT SELECT ON weekly_chat_cases TO authenticated;
INSERT INTO auth.users VALUES('a6500000-0000-4000-8000-000000000001'),('a6500000-0000-4000-8000-000000000002');
INSERT INTO public.tenants(id,status) VALUES('a6500000-0000-4000-8000-000000000010','active'),
  ('a6500000-0000-4000-8000-000000000011','active');
INSERT INTO public.profiles(id,user_id,active_tenant_id) VALUES
  ('a6500000-0000-4000-8000-000000000001','a6500000-0000-4000-8000-000000000001','a6500000-0000-4000-8000-000000000010'),
  ('a6500000-0000-4000-8000-000000000002','a6500000-0000-4000-8000-000000000002','a6500000-0000-4000-8000-000000000011');
INSERT INTO public.tenant_members VALUES
  ('a6500000-0000-4000-8000-000000000010','a6500000-0000-4000-8000-000000000001','owner','active'),
  ('a6500000-0000-4000-8000-000000000011','a6500000-0000-4000-8000-000000000002','owner','active');
SET LOCAL test.actor='a6500000-0000-4000-8000-000000000001';
SET LOCAL test.tenant='a6500000-0000-4000-8000-000000000010';
CREATE FUNCTION pg_temp.weekly_case(n integer,admit boolean DEFAULT true,bound boolean DEFAULT true,answer boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c weekly_chat_cases; result jsonb;
BEGIN
  c.n:=n;c.pid:=gen_random_uuid();c.thread:=gen_random_uuid();c.request:=gen_random_uuid();
  c.intent:=gen_random_uuid();c.nonce:=gen_random_uuid();c.issued:=gen_random_uuid();
  c.token:=lpad(to_hex(n),16,'0')||':'||c.issued::text;
  c.args:=jsonb_build_object('_request_id',c.request,'_name','Neutral weekly draft '||n,
    '_weekday',1,'_local_time','09:00','_timezone','UTC');
  INSERT INTO public.paige_chat_threads(id,caller_user_id,tenant_id) VALUES(c.thread,auth.uid(),public.current_user_tenant_id());
  INSERT INTO public.paige_pending_confirmations(id,user_id,tenant_id,thread_id,tool_name,fingerprint,args,
    summary,issued_in_request,server_issued_at) VALUES(c.pid,auth.uid(),public.current_user_tenant_id(),c.thread,
    'weekly_commitment_draft',split_part(c.token,':',1),c.args,'Save this inert weekly draft',c.issued,clock_timestamp()-interval '1 minute');
  INSERT INTO weekly_chat_cases VALUES(c.*);
  IF admit THEN
    result:=public.paige_chat_interactive_begin_v2(c.thread,c.intent,NULL,'Approve this exact weekly draft',answer,false,true);
    PERFORM pg_temp.weekly_assert(result->>'status'='accepted','original admission accepts case '||n);
    IF bound THEN
      result:=public.paige_chat_interactive_acquire_bound(c.thread,auth.uid(),public.current_user_tenant_id(),
        c.intent,c.nonce,gen_random_uuid(),'abcdefghijklmnopqrst_a6500000-0000-4000-8000-000000000099_445');
    ELSE
      result:=public.paige_chat_interactive_executor_v2(c.thread,auth.uid(),public.current_user_tenant_id(),c.intent,'acquire');
    END IF;
    PERFORM pg_temp.weekly_assert(result->>'acquired'='true','original executor acquires case '||n);
  END IF;
END $$;
CREATE FUNCTION pg_temp.weekly_call(n integer,op text,ov jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c weekly_chat_cases; th uuid; intent uuid; nonce uuid;
BEGIN
  SELECT * INTO STRICT c FROM weekly_chat_cases WHERE weekly_chat_cases.n=weekly_call.n;
  th:=CASE WHEN ov?'thread' THEN (ov->>'thread')::uuid ELSE c.thread END;
  intent:=CASE WHEN ov?'intent' THEN (ov->>'intent')::uuid ELSE c.intent END;
  nonce:=CASE WHEN ov?'nonce' THEN (ov->>'nonce')::uuid ELSE c.nonce END;
  IF op='read' THEN RETURN public.read_weekly_commitment_chat_draft(c.pid,th); END IF;
  IF op='claim' THEN RETURN public.claim_weekly_commitment_chat_draft(c.pid,coalesce(ov->>'token',c.token),
    CASE WHEN ov?'request' THEN (ov->>'request')::uuid ELSE c.nonce END,th,intent,nonce); END IF;
  IF op='commit' THEN RETURN public.commit_weekly_commitment_chat_draft(c.pid,c.nonce,coalesce(ov->'args',c.args),th,intent,nonce); END IF;
  IF op='decline' THEN RETURN public.decline_weekly_commitment_chat_draft(c.pid,coalesce(ov->>'token',c.token),th,intent,nonce); END IF;
  RAISE EXCEPTION 'Unknown fixture operation';
END $$;
-- A fresh inactive protocol is the first negative, before any synthetic activation.
SELECT pg_temp.weekly_assert((SELECT NOT active FROM public.paige_chat_interactive_rollout WHERE singleton),'fresh protocol is inactive');
SELECT pg_temp.weekly_case(1,false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.weekly_refuses('SELECT pg_temp.weekly_call(1,''claim'')','inactive runtime refuses claim');
SELECT pg_temp.weekly_assert(pg_temp.weekly_call(1,'read')->>'phase'='awaiting_approval','inactive runtime permits scoped readback');
RESET ROLE;
SELECT pg_temp.weekly_assert((SELECT consumed_at IS NULL FROM public.paige_pending_confirmations WHERE id=(SELECT pid FROM weekly_chat_cases WHERE n=1)),
  'inactive refusal preserves original approval');
SELECT pg_temp.weekly_assert(NOT EXISTS(SELECT 1 FROM public.paige_automations WHERE created_by=auth.uid()),'inactive refusal writes no definition');
SELECT pg_temp.weekly_assert(NOT EXISTS(SELECT 1 FROM public.paige_workspace_events WHERE actor_id=auth.uid()),'inactive refusal writes no Rail');
-- Only this rolled-back fixture changes the original control record. No release attestation is invented.
UPDATE public.paige_chat_interactive_rollout SET active=true WHERE singleton;
SELECT pg_temp.weekly_case(2);
SET LOCAL ROLE authenticated;
DO $$DECLARE c weekly_chat_cases; saved jsonb; replay jsonb; claim jsonb;
BEGIN
  SELECT * INTO c FROM weekly_chat_cases WHERE n=2;
  PERFORM pg_temp.weekly_refuses('SELECT pg_temp.weekly_call(2,''read'',''{"thread":null}'')','missing expected thread refuses read');
  PERFORM pg_temp.weekly_refuses(format('SELECT pg_temp.weekly_call(2,''read'',%L)',jsonb_build_object('thread',gen_random_uuid())),'foreign thread refuses read');
  PERFORM pg_temp.weekly_refuses(format('SELECT pg_temp.weekly_call(2,''claim'',%L)',jsonb_build_object('intent',gen_random_uuid())),'wrong bound intent refuses claim');
  PERFORM pg_temp.weekly_refuses(format('SELECT pg_temp.weekly_call(2,''claim'',%L)',jsonb_build_object('nonce',gen_random_uuid())),'wrong bound request refuses claim');
  PERFORM pg_temp.weekly_refuses(format('SELECT public.read_weekly_commitment_draft(%L)',c.pid),'old UI endpoint cannot read a Chat proposal');
  PERFORM pg_temp.weekly_refuses('SELECT pg_temp.weekly_call(2,''commit'')','unclaimed Chat proposal cannot save');
  PERFORM pg_temp.weekly_refuses('SELECT pg_temp.weekly_call(2,''claim'',''{"token":"wrong"}'')','wrong exact token refuses');
  PERFORM pg_temp.weekly_refuses(format('SELECT pg_temp.weekly_call(2,''claim'',%L)',jsonb_build_object('request',c.issued)),'issuing request cannot claim');
  claim:=pg_temp.weekly_call(2,'claim');
  PERFORM pg_temp.weekly_assert(claim->>'claimed'='true' AND claim->'args'=c.args AND claim->>'thread_id'=c.thread::text,'claim returns exact stored arguments and thread');
  PERFORM pg_temp.weekly_refuses('SELECT pg_temp.weekly_call(2,''commit'',''{"args":{}}'')','changed stored arguments refuse');
  saved:=pg_temp.weekly_call(2,'commit');replay:=pg_temp.weekly_call(2,'commit');
  PERFORM pg_temp.weekly_assert(saved->>'phase'='saved' AND saved->>'receipt_id' IS NOT NULL,'actual inert definition and original Rail saved');
  PERFORM pg_temp.weekly_assert(saved->>'automation_id'=replay->>'automation_id' AND saved->>'receipt_id'=replay->>'receipt_id','lost commit acknowledgment adopts original result');
  PERFORM pg_temp.weekly_assert((pg_temp.weekly_call(2,'claim')->>'claimed')='false','repeat approval cannot claim again');
  PERFORM pg_temp.weekly_assert(pg_temp.weekly_call(2,'read')->>'receipt_id'=saved->>'receipt_id','later native read returns original receipt');
END $$;
RESET ROLE;
SELECT pg_temp.weekly_assert((SELECT count(*)=1 FROM public.paige_automations WHERE created_by=auth.uid()),'one original definition');
SELECT pg_temp.weekly_assert((SELECT count(*)=1 FROM public.paige_workspace_events WHERE actor_id=auth.uid() AND capability_key='weekly_commitment_draft'),'one original Rail');
SELECT pg_temp.weekly_assert(NOT EXISTS(SELECT 1 FROM public.paige_automations WHERE created_by=auth.uid() AND (state<>'draft' OR trigger_config?'next_run_at')),'saved draft never authorizes recurring work');
-- Fresh proposals exercise every refusal before any write, with each mutation rolled back.
SELECT pg_temp.weekly_case(3);
DO $$DECLARE field text; op text; c weekly_chat_cases;
BEGIN
  SELECT * INTO c FROM weekly_chat_cases WHERE n=3;
  FOREACH field IN ARRAY ARRAY['actor','tenant','profile','membership','role','tenant_status','archive','private_thread',
    'client_thread','proposal_thread','threadless_proposal','expired','latest','executor','admitted','hold','mode','runtime_nonce','turn_binding','unbound','rollout'] LOOP
    BEGIN
      CASE field
      WHEN 'actor' THEN PERFORM set_config('test.actor','a6500000-0000-4000-8000-000000000002',true);
      WHEN 'tenant' THEN PERFORM set_config('test.tenant','a6500000-0000-4000-8000-000000000011',true);
      WHEN 'profile' THEN UPDATE public.profiles SET active_tenant_id='a6500000-0000-4000-8000-000000000011' WHERE user_id=auth.uid();
      WHEN 'membership' THEN UPDATE public.tenant_members SET status='inactive' WHERE user_id=auth.uid();
      WHEN 'role' THEN UPDATE public.tenant_members SET role='admin' WHERE user_id=auth.uid();
      WHEN 'tenant_status' THEN UPDATE public.tenants SET status='inactive' WHERE id=public.current_user_tenant_id();
      WHEN 'archive' THEN UPDATE public.paige_chat_threads SET is_archived=true WHERE id=c.thread;
      WHEN 'private_thread' THEN UPDATE public.paige_chat_threads SET audience='customer_private' WHERE id=c.thread;
      WHEN 'client_thread' THEN UPDATE public.paige_chat_threads SET contact_id=gen_random_uuid() WHERE id=c.thread;
      WHEN 'proposal_thread' THEN UPDATE public.paige_pending_confirmations SET thread_id=(SELECT thread FROM weekly_chat_cases WHERE n=2) WHERE id=c.pid;
      WHEN 'threadless_proposal' THEN UPDATE public.paige_pending_confirmations SET thread_id=NULL WHERE id=c.pid;
      WHEN 'expired' THEN UPDATE public.paige_pending_confirmations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=c.pid;
      WHEN 'latest' THEN UPDATE public.paige_chat_threads SET interactive_latest_intent=gen_random_uuid() WHERE id=c.thread;
      WHEN 'executor' THEN UPDATE public.paige_chat_threads SET interactive_executor_intent=NULL WHERE id=c.thread;
      WHEN 'admitted' THEN UPDATE public.paige_chat_threads SET interactive_admitted_intent=NULL WHERE id=c.thread;
      WHEN 'hold' THEN UPDATE public.paige_chat_threads SET interactive_executor_intent=NULL,interactive_recovery_hold=gen_random_uuid() WHERE id=c.thread;
      WHEN 'mode' THEN UPDATE public.paige_chat_threads SET interactive_runtime_binding=interactive_runtime_binding||'{"mode":"read_only_recovery"}' WHERE id=c.thread;
      WHEN 'runtime_nonce' THEN UPDATE public.paige_chat_threads SET interactive_runtime_binding=interactive_runtime_binding||jsonb_build_object('request_nonce',gen_random_uuid()) WHERE id=c.thread;
      WHEN 'turn_binding' THEN UPDATE public.paige_chat_turns SET interactive_runtime_binding=NULL WHERE thread_id=c.thread;
      WHEN 'unbound' THEN UPDATE public.paige_chat_threads SET interactive_runtime_binding=NULL WHERE id=c.thread;
        UPDATE public.paige_chat_turns SET interactive_runtime_binding=NULL WHERE thread_id=c.thread;
      WHEN 'rollout' THEN UPDATE public.paige_chat_interactive_rollout SET active=false WHERE singleton;
      END CASE;
      SET LOCAL ROLE authenticated;
      FOREACH op IN ARRAY ARRAY['claim','commit','decline'] LOOP
        -- Declining an expired proposal remains a legitimate native cancellation;
        -- expiry must prevent authorization, not alter that incumbent behavior.
        CONTINUE WHEN field='expired' AND op='decline';
        PERFORM pg_temp.weekly_refuses(format('SELECT pg_temp.weekly_call(3,%L)',op),'native mutation refuses '||field||'/'||op);
      END LOOP;
      IF field IN ('actor','tenant','profile','membership','role','tenant_status','archive','private_thread',
        'client_thread','proposal_thread','threadless_proposal') THEN
        PERFORM pg_temp.weekly_refuses('SELECT pg_temp.weekly_call(3,''read'')','scoped recovery read refuses '||field);
      END IF;
      RESET ROLE;
      PERFORM pg_temp.weekly_assert((SELECT consumed_at IS NULL FROM public.paige_pending_confirmations WHERE id=c.pid),'negative preserves approval '||field);
      RAISE EXCEPTION 'rollback only this fixture perturbation' USING ERRCODE='Z0001';
    EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
    END;
  END LOOP;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.weekly_assert(pg_temp.weekly_call(3,'claim')->>'claimed'='true','original claim can precede an interrupted save');
SELECT pg_temp.weekly_assert(pg_temp.weekly_call(3,'claim')->'state'->>'phase'='unknown','lost claim acknowledgment remains unknown without reclaim');
SELECT pg_temp.weekly_assert(pg_temp.weekly_call(3,'read')->>'phase'='unknown','recovery read does not invent a missing committed result');
RESET ROLE;
SELECT pg_temp.weekly_assert((SELECT count(*)=1 FROM public.paige_automations WHERE created_by=auth.uid()),'unknown claim recovery creates no work');
SELECT pg_temp.weekly_case(4);
SET LOCAL ROLE authenticated;
SELECT pg_temp.weekly_assert(pg_temp.weekly_call(4,'decline')->>'phase'='declined','explicit decline preserves truthful original status');
SELECT pg_temp.weekly_assert(pg_temp.weekly_call(4,'claim')->>'claimed'='false','declined proposal cannot claim');
RESET ROLE;
-- The canonical writer preserves a saved definition's history. Neither an API
-- request nor privileged fixture deletion may remove it and invite recreation.
DO $$DECLARE original_id uuid; refused boolean:=false;
BEGIN
  original_id:=(pg_temp.weekly_call(2,'read')->>'automation_id')::uuid;
  BEGIN DELETE FROM public.paige_automations WHERE id=original_id;
  EXCEPTION WHEN insufficient_privilege THEN refused:=true;
  END;
  PERFORM pg_temp.weekly_assert(refused,'original native history guard refuses deletion');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.weekly_refuses(format('DELETE FROM public.paige_automations WHERE id=%L',original_id),'API role cannot delete original definition');
  PERFORM pg_temp.weekly_assert(pg_temp.weekly_call(2,'commit')->>'automation_id'=original_id::text,'repeat execution preserves protected original identity');
  RESET ROLE;
  PERFORM pg_temp.weekly_assert((SELECT count(*)=1 FROM public.paige_automations WHERE created_by=auth.uid()),'original definition remains singular');
END $$;
-- A typed bound answer first has no stamped user turn. The CURRENT canonical
-- append/trigger must bind the real claim before any Chat mutation is eligible.
SELECT pg_temp.weekly_case(5,true,true,true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.weekly_refuses('SELECT pg_temp.weekly_call(5,''claim'')','bound answer without original stamped claim cannot execute');
DO $$DECLARE c weekly_chat_cases; result jsonb;
BEGIN
  SELECT * INTO c FROM weekly_chat_cases WHERE n=5;
  PERFORM public.paige_chat_turn_append(c.thread,'user','Approve the original draft',NULL,NULL,NULL,NULL,NULL,
    jsonb_build_object('paige_resume',jsonb_build_object('key','answer:'||gen_random_uuid()::text)),NULL);
  result:=pg_temp.weekly_call(5,'claim');
  PERFORM pg_temp.weekly_assert(result->>'claimed'='true','current bound-answer claim authorizes exact original proposal');
  result:=pg_temp.weekly_call(5,'commit');
  PERFORM pg_temp.weekly_assert(result->>'phase'='saved' AND result->>'receipt_id' IS NOT NULL,'bound answer saves actual original record and Rail');
END $$;
RESET ROLE;
UPDATE public.paige_chat_interactive_rollout SET active=false WHERE singleton;
SET LOCAL ROLE authenticated;
SELECT pg_temp.weekly_assert(pg_temp.weekly_call(2,'read')->>'phase'='saved','stopped runtime still reads original saved result');
SELECT pg_temp.weekly_refuses('SELECT pg_temp.weekly_call(2,''commit'')','stopped runtime never replays mutation');
RESET ROLE;
DO $$DECLARE role_name text; signature text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH signature IN ARRAY ARRAY['private.weekly_draft_read(uuid,uuid)','private.weekly_draft_claim(uuid,text,uuid,uuid)',
      'private.weekly_draft_commit(uuid,uuid,jsonb,uuid)','private.weekly_draft_decline(uuid,text,uuid)',
      'private.weekly_chat_draft_mutation_scope(uuid,uuid,uuid)','public._weekly_draft_proposal(uuid,uuid)'] LOOP
      PERFORM pg_temp.weekly_assert(NOT has_function_privilege(role_name,signature,'EXECUTE'),'sealed helper '||role_name||'/'||signature);
    END LOOP;
    FOREACH signature IN ARRAY ARRAY['public.read_weekly_commitment_chat_draft(uuid,uuid)',
      'public.claim_weekly_commitment_chat_draft(uuid,text,uuid,uuid,uuid,uuid)',
      'public.commit_weekly_commitment_chat_draft(uuid,uuid,jsonb,uuid,uuid,uuid)',
      'public.decline_weekly_commitment_chat_draft(uuid,text,uuid,uuid,uuid)'] LOOP
      PERFORM pg_temp.weekly_assert(has_function_privilege(role_name,signature,'EXECUTE')=(role_name='authenticated'),
        'original-JWT-only facade '||role_name||'/'||signature);
    END LOOP;
  END LOOP;
END $$;
SELECT 'WEEKLY_CHAT_DRAFT_PASS='||last_value FROM weekly_chat_assertion_count;
ROLLBACK;
