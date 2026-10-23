-- EXP01 PR4 cases: latest_solo_business_interview_thread() resume lookup.
-- Runs inside the e01-interview-resume-check.mjs fixture (rollback-only).
-- Emits INTERVIEW_RESUME_PROOF lines; the script counts them.

-- Fixture identity: one standalone active tenant, its owner, profile + meta.
do $fixture$
begin
  insert into public.tenants(id, account_type, parent_tenant_id, status, features)
    values ('11111111-1111-4111-8111-111111111111','standalone',null,'active','{}'::jsonb);
  insert into public.tenants(id, account_type, parent_tenant_id, status, features)
    values ('99999999-9999-4999-8999-999999999999','standalone',null,'active','{}'::jsonb);
  insert into public.profiles(user_id) values ('22222222-2222-4222-8222-222222222222');
  insert into public.profiles(user_id) values ('33333333-3333-4333-8333-333333333333');
  insert into public.tenant_members(tenant_id,user_id,role,status,is_owner)
    values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','owner','active',true);
  insert into public.tenant_members(tenant_id,user_id,role,status,is_owner)
    values ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','owner','active',true);
  -- The foreign tenant's own membership for its thread's caller (case 4 seeds
  -- a genuine checkpoint there too, under that workspace's own context).
  insert into public.tenant_members(tenant_id,user_id,role,status,is_owner)
    values ('99999999-9999-4999-8999-999999999999','22222222-2222-4222-8222-222222222222','owner','active',true);
  insert into public.tenant_setup_business_context_meta(tenant_id,revision)
    values ('99999999-9999-4999-8999-999999999999',0);
  insert into public.tenant_setup_business_context_meta(tenant_id,revision)
    values ('11111111-1111-4111-8111-111111111111',0);
end $fixture$;

-- Caller context: the workspace owner.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select set_config('test.tenant','11111111-1111-4111-8111-111111111111',false);

-- Helper: an interview thread with ONE genuine user turn, then a checkpoint
-- saved through the REAL save RPC at the given phase/age. Creates under the
-- thread's own caller/tenant context and restores the original context.
create or replace procedure pg_temp.interview_thread(p_id uuid, p_tenant uuid, p_caller uuid,
  p_phase text, p_next text, p_age_minutes bigint)
language plpgsql as $$
declare v_turn uuid; v_sub text; v_tenant text;
begin
  v_sub := current_setting('request.jwt.claim.sub',true);
  v_tenant := current_setting('test.tenant',true);
  perform set_config('request.jwt.claim.sub',p_caller::text,false);
  perform set_config('test.tenant',p_tenant::text,false);
  insert into public.paige_chat_threads(id,tenant_id,caller_user_id,lens)
    values (p_id,p_tenant,p_caller,'coach');
  insert into public.paige_chat_turns(id,seq,thread_id,role,content,created_at)
    values (gen_random_uuid(),1,p_id,'user','a genuine interview answer',now()-(p_age_minutes||' minutes')::interval)
    returning id into v_turn;
  perform public.save_solo_business_interview_checkpoint(p_id,p_tenant,
    jsonb_build_object('phase',p_phase,'nextField',p_next),null);
  perform set_config('request.jwt.claim.sub',v_sub,false);
  perform set_config('test.tenant',v_tenant,false);
end $$;

-- CASE 1 — newest unfinished wins: two of the caller's threads (older paused,
-- newer active). The lookup returns the NEWEST unfinished one only.
call pg_temp.interview_thread('aaaaaaaa-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','paused','industry',30);
call pg_temp.interview_thread('aaaaaaaa-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','active','offers',10);
do $case1$
declare v jsonb := public.latest_solo_business_interview_thread();
begin
  if v->>'threadId' is distinct from 'aaaaaaaa-0000-4000-8000-000000000002'
    or v->>'phase' is distinct from 'active'
    or (select count(*) from jsonb_object_keys(v)) <> 3 then
    raise notice 'INTERVIEW_RESUME_PROOF FAIL case1 newest-unfinished-wins got %', v;
  else
    raise notice 'INTERVIEW_RESUME_PROOF case1-pass newest-unfinished-wins exposure-3-keys';
  end if;
end $case1$;

-- CASE 2 — a newer COMPLETED interview retires the lookup (the older paused
-- thread behind it is a stale chapter, never a resume target).
call pg_temp.interview_thread('aaaaaaaa-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','completed',null,5);
do $case2$
declare v jsonb := public.latest_solo_business_interview_thread();
begin
  if v is not null then raise notice 'INTERVIEW_RESUME_PROOF FAIL case2 completed-retires got %', v;
  else raise notice 'INTERVIEW_RESUME_PROOF case2-pass completed-retires'; end if;
end $case2$;

-- CASE 3 — remove the completed thread; a forged checkpoint on the newest
-- thread is SKIPPED (the sibling's validation refuses it) and the next valid
-- unfinished thread is returned. Fail-closed, never trust the forged metadata.
delete from public.paige_chat_turns where thread_id='aaaaaaaa-0000-4000-8000-000000000003';
delete from public.paige_chat_threads where id='aaaaaaaa-0000-4000-8000-000000000003';
insert into public.paige_chat_threads(id,tenant_id,caller_user_id,lens)
  values ('aaaaaaaa-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','coach');
insert into public.paige_chat_turns(id,seq,thread_id,role,content,created_at,bundle_ref)
  values (gen_random_uuid(),1,'aaaaaaaa-0000-4000-8000-000000000004','user','forged',now()-interval '2 minutes',
    jsonb_build_object('solo_business_interview',jsonb_build_object('version',1,'phase','active','nextField','industry','sourceTurnId','00000000-0000-0000-0000-000000000000','sourceTurnSeq',999,'updatedAt','2026-10-22T00:00:00Z','contextRevisionAtCheckpoint',null)));
do $case3$
declare v jsonb := public.latest_solo_business_interview_thread();
begin
  if v->>'threadId' is distinct from 'aaaaaaaa-0000-4000-8000-000000000002' then
    raise notice 'INTERVIEW_RESUME_PROOF FAIL case3 forged-skipped got %', v;
  else raise notice 'INTERVIEW_RESUME_PROOF case3-pass forged-newest-skipped falls-to-valid'; end if;
end $case3$;

-- CASE 4 — exposure + isolation: a foreign-tenant thread and a different
-- caller's same-tenant thread (both valid checkpoints, newest of all) are
-- never returned to this caller.
call pg_temp.interview_thread('bbbbbbbb-0000-4000-8000-000000000005','99999999-9999-4999-8999-999999999999','22222222-2222-4222-8222-222222222222','active','goals90Day',1);
call pg_temp.interview_thread('bbbbbbbb-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','active','constraints',1);
do $case4$
declare v jsonb := public.latest_solo_business_interview_thread();
begin
  if v->>'threadId' is distinct from 'aaaaaaaa-0000-4000-8000-000000000002' then
    raise notice 'INTERVIEW_RESUME_PROOF FAIL case4 tenant-caller-isolation got %', v;
  else raise notice 'INTERVIEW_RESUME_PROOF case4-pass foreign-tenant-and-other-caller-excluded'; end if;
end $case4$;

-- CASE 5 — the other caller sees their OWN newest thread through the same lookup.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
do $case5$
declare v jsonb := public.latest_solo_business_interview_thread();
begin
  if v->>'threadId' is distinct from 'bbbbbbbb-0000-4000-8000-000000000006' then
    raise notice 'INTERVIEW_RESUME_PROOF FAIL case5 own-thread-returned got %', v;
  else raise notice 'INTERVIEW_RESUME_PROOF case5-pass caller-sees-own-newest'; end if;
end $case5$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);

-- CASE 6 — unauthenticated refusal: no caller context at all.
select set_config('request.jwt.claim.sub','',false);
select set_config('test.tenant','',false);
do $case6$
begin
  perform public.latest_solo_business_interview_thread();
  raise notice 'INTERVIEW_RESUME_PROOF FAIL case6 expected-refusal';
exception when others then
  if sqlerrm like '%authenticated%' or sqlstate='42501' then
    raise notice 'INTERVIEW_RESUME_PROOF case6-pass unauthenticated-refused %', sqlstate;
  else
    raise notice 'INTERVIEW_RESUME_PROOF FAIL case6 wrong-error % %', sqlstate, sqlerrm;
  end if;
end $case6$;

-- CASE 7 — execute grants: authenticated only.
do $case7$
begin
  if has_function_privilege('authenticated','public.latest_solo_business_interview_thread()','EXECUTE')
    and not has_function_privilege('anon','public.latest_solo_business_interview_thread()','EXECUTE')
    and not has_function_privilege('service_role','public.latest_solo_business_interview_thread()','EXECUTE') then
    raise notice 'INTERVIEW_RESUME_PROOF case7-pass execute-authenticated-only';
  else
    raise notice 'INTERVIEW_RESUME_PROOF FAIL case7 grants';
  end if;
end $case7$;
