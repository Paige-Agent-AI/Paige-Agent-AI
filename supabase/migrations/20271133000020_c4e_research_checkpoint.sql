-- Research stages one private checkpoint on the existing Work envelope. The
-- report, sources, Rail receipt and Work settlement publish in one transaction.
begin;

alter table public.paige_durable_work add column research_checkpoint jsonb;
comment on column public.paige_durable_work.research_checkpoint is
  'Private validated Research result pending publication. Never exposed by the Work reader.';

create function public.advance_paige_research_work(
  _work_id uuid, _tenant_id uuid, _actor_id uuid, _thread_id uuid, _intent_id uuid,
  _request_payload jsonb, _phase text, _version bigint default null, _checkpoint jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  w public.paige_durable_work%rowtype;
  thread public.paige_chat_threads%rowtype;
  evidence jsonb;
  report jsonb;
  stored jsonb;
  receipt uuid;
  receipt_outcome text;
  receipt_detail jsonb;
  attempt_ref text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'RESEARCH_WORK_UNAVAILABLE' using errcode='42501';
  end if;
  perform public.research_assert_current_scope(_actor_id,_tenant_id);
  -- Preserve the native Auth-first order and prevent a cohort of shared Auth
  -- locks from delaying sign-in while other Research requests wait for Work.
  perform 1 from auth.users u where u.id=_actor_id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now()) for no key update nowait;
  if not found then raise exception 'RESEARCH_WORK_UNAVAILABLE' using errcode='42501'; end if;
  perform 1 from public.profiles p
    where p.user_id=_actor_id and p.active_tenant_id=_tenant_id for share nowait;
  if not found then raise exception 'RESEARCH_WORK_UNAVAILABLE' using errcode='42501'; end if;
  perform 1 from public.tenants t where t.id=_tenant_id and t.status='active' for share nowait;
  if not found then raise exception 'RESEARCH_WORK_UNAVAILABLE' using errcode='42501'; end if;
  perform 1 from public.tenant_members m where m.tenant_id=_tenant_id and m.user_id=_actor_id
    and m.status='active' for share nowait;
  if not found then raise exception 'RESEARCH_WORK_UNAVAILABLE' using errcode='42501'; end if;
  select * into thread from public.paige_chat_threads t where t.id=_thread_id
    and t.tenant_id=_tenant_id and t.caller_user_id=_actor_id and not t.is_archived
    and t.audience='workspace' for share nowait;
  if not found then raise exception 'RESEARCH_WORK_UNAVAILABLE' using errcode='42501'; end if;
  select * into w from public.paige_durable_work where id=_work_id for update nowait;
  if not found or w.work_kind<>'research' or w.capability_key<>'deep_research'
    or w.tenant_id is distinct from _tenant_id or w.initiating_user_id is distinct from _actor_id
    or w.thread_id is distinct from _thread_id or w.intent_id is distinct from _intent_id
    or w.request_payload is null
    or (_request_payload is null and _phase is distinct from 'resume' and _phase is distinct from 'publish')
    or (_request_payload is not null and w.request_payload is distinct from _request_payload) then
    raise exception 'RESEARCH_WORK_UNAVAILABLE' using errcode='42501';
  end if;
  if _phase is null or _phase not in ('begin','resume','checkpoint','publish') then
    raise exception 'RESEARCH_WORK_PHASE_INVALID' using errcode='22023';
  end if;
  if w.status in ('blocked','claimed') and thread.interactive_latest_intent is distinct from w.intent_id then
    raise exception 'RESEARCH_WORK_SUPERSEDED' using errcode='42501';
  end if;
  attempt_ref := w.id::text||':'||w.attempt_count::text;

  if _phase in ('begin','resume') then
    if _phase='begin' and w.status='blocked' and w.blocked_reason='research_execution_not_enabled'
      and w.dispatch_started_attempt=0 and w.research_checkpoint is null then
      -- An older prepared row is not authority to start billable work. Require
      -- the live, original bound Chat executor for this first dispatch only.
      if thread.interactive_latest_intent is distinct from _intent_id
        or thread.interactive_admitted_intent is distinct from _intent_id
        or thread.interactive_executor_intent is distinct from _intent_id
        or thread.interactive_admission is not null
        or thread.interactive_recovery_hold is not null
        or thread.interactive_runtime_binding->>'mode' is distinct from 'normal'
        or thread.interactive_runtime_binding->>'intent_id' is distinct from _intent_id::text
        or thread.interactive_runtime_binding->>'function_slug' is distinct from 'paige-ai-chat' then
        raise exception 'RESEARCH_DISPATCH_NOT_ADMITTED' using errcode='42501';
      end if;
      perform 1 from public.paige_chat_interactive_rollout where singleton and active for share nowait;
      if not found then raise exception 'RESEARCH_DISPATCH_NOT_ADMITTED' using errcode='42501'; end if;
      evidence := public.paige_chat_interactive_evidence(_thread_id,_actor_id,_tenant_id,_intent_id);
      if evidence->>'terminal' is distinct from 'false' or evidence->>'stopped' is distinct from 'false' then
        raise exception 'RESEARCH_DISPATCH_NOT_ADMITTED' using errcode='42501';
      end if;
      -- Preparation reserved attempt 1 without dispatching it. Claim that same
      -- attempt once, under the row lock, before the first provider call.
      update public.paige_durable_work set status='claimed', blocked_reason=null,
        dispatch_started_attempt=attempt_count, claimed_at=now(), heartbeat_at=now(),
        lease_until=clock_timestamp()+interval '7 minutes', updated_at=now(), version=version+1,
        safe_summary='PAIGE is researching the original request.'
        where id=w.id returning * into w;
      return jsonb_build_object('state','execute','version',w.version);
    elsif w.status='claimed' and w.research_checkpoint is not null then
      return jsonb_build_object('state','ready');
    elsif w.status='claimed' and w.lease_until>clock_timestamp() then
      return jsonb_build_object('state','in_progress');
    elsif w.status='claimed' then
      perform public.transition_paige_durable_work(w.id,w.idempotency_key,'outcome_unknown',
        null,'Research stopped before a recoverable checkpoint was saved.');
      return jsonb_build_object('state','outcome_unknown');
    elsif w.status not in ('succeeded','failed') then
      return jsonb_build_object('state',w.status);
    end if;
    -- A completed begin uses the same original readback as a repeated publish.
  end if;

  if _phase='checkpoint' then
    if w.status<>'claimed' or w.dispatch_started_attempt<>w.attempt_count
      or w.version is distinct from _version or w.lease_until<=clock_timestamp()
      or w.research_checkpoint is not null then
      raise exception 'RESEARCH_CHECKPOINT_FENCE_LOST' using errcode='55000';
    end if;
    report := _checkpoint->'report';
    if jsonb_typeof(report) is distinct from 'object'
      or octet_length(_checkpoint::text)>2097152
      or report->>'run_id' is distinct from w.id::text
      -- Match the worker's ECMAScript String.trim without rewriting its frozen input.
      or report->>'question' is distinct from btrim(w.request_payload->>'question',
        U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
      or jsonb_typeof(report->'findings') is distinct from 'array'
      or jsonb_typeof(report->'sources') is distinct from 'array'
      or jsonb_typeof(report->'coverage'->'configured') is distinct from 'boolean'
      or coalesce(report->'coverage'->>'stop_reason','') not in
        ('answered','max_hops','budget','wall_clock','no_results','error','unconfigured') then
      raise exception 'RESEARCH_CHECKPOINT_INVALID' using errcode='22023';
    end if;
    update public.paige_durable_work set research_checkpoint=_checkpoint,
      updated_at=now(), version=version+1 where id=w.id;
    return jsonb_build_object('state','ready');
  end if;

  if w.status='claimed' and _phase='publish' and w.research_checkpoint is not null then
    report := w.research_checkpoint->'report';
    insert into public.research_runs
      (id, work_id, tenant_id, user_id, question, domain, caller, findings, coverage,
       stop_reason, configured, entity_profile, dossier)
    values (w.id,w.id,w.tenant_id,w.initiating_user_id,report->>'question',
      coalesce(w.request_payload->>'domain','general'),'chat',report->'findings',report->'coverage',
      report->'coverage'->>'stop_reason',(report->'coverage'->>'configured')::boolean,
      nullif(report->'entity_profile','null'::jsonb),nullif(w.research_checkpoint->'dossier','null'::jsonb));
    insert into public.research_sources
      (run_id, tenant_id, user_id, source_index, url, title, snippet, reliability_score,
       tier, reliability, published_at, fetched_at, excluded)
    select w.id,w.tenant_id,w.initiating_user_id,s.index,s.url,s.title,s.snippet,s.reliability_score,
      s.tier,s.reliability,s.published_at,s.fetched_at,s.excluded
    from jsonb_to_recordset(report->'sources') as s(
      index integer,url text,title text,snippet text,reliability_score numeric,tier text,
      reliability text,published_at timestamptz,fetched_at timestamptz,excluded boolean);

    if exists(select 1 from public.research_sources s where s.run_id=w.id
        group by s.source_index having s.source_index<1 or count(*)>1)
      or exists(select 1 from jsonb_array_elements(report->'findings') f
        where jsonb_typeof(f->'text') is distinct from 'string' or nullif(btrim(f->>'text'),'') is null
          or jsonb_typeof(f->'citations') is distinct from 'array'
          or f->'citations'='[]'::jsonb
          or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(f->'citations')='array'
            then f->'citations' else '[]'::jsonb end) c
            where not exists(select 1 from public.research_sources s where s.run_id=w.id
              and not s.excluded and s.url~'^https?://' and to_jsonb(s.source_index)=c))) then
      raise exception 'RESEARCH_CHECKPOINT_CITATIONS_INVALID' using errcode='22023';
    end if;
    receipt_outcome := case when report->'coverage'->>'stop_reason' in ('error','unconfigured')
      then 'capability_failed' else 'capability_succeeded' end;
    stored := public.research_readback_persisted_run(w.id,w.tenant_id,w.initiating_user_id);
    if stored is null or stored->'findings' is distinct from report->'findings'
      or stored->'coverage' is distinct from report->'coverage'
      or jsonb_array_length(stored->'sources')<>jsonb_array_length(report->'sources') then
      raise exception 'RESEARCH_COMPLETION_UNVERIFIED' using errcode='55000';
    end if;
    receipt_detail := jsonb_build_object('operation','deep_research','report_saved',true,
      'findings_count',jsonb_array_length(stored->'findings'),'sources_count',jsonb_array_length(stored->'sources'),
      'stop_reason',stored->>'stop_reason','configured',stored->'configured');
    if exists(select 1 from public.paige_workspace_events e where e.tenant_id=w.tenant_id
      and e.source_kind='capability_run' and e.source_id=w.id and e.source_revision=0) then
      raise exception 'RESEARCH_RECEIPT_CONFLICT' using errcode='55000';
    end if;
    perform public.record_capability_run(w.tenant_id,w.initiating_user_id,'deep_research',receipt_outcome,w.id,
      _job_attempt_id=>attempt_ref,_detail=>receipt_detail);
    select e.id into strict receipt from public.paige_workspace_events e where e.tenant_id=w.tenant_id
      and e.actor_id=w.initiating_user_id and e.source_kind='capability_run' and e.source_id=w.id
      and e.source_revision=0 and e.capability_key='deep_research' and e.outcome=receipt_outcome
      and e.job_attempt_id=attempt_ref and e.detail=receipt_detail;
    update public.paige_durable_work set research_checkpoint=null where id=w.id;
    perform public.transition_paige_durable_work(w.id,w.idempotency_key,
      case when receipt_outcome='capability_succeeded' then 'succeeded' else 'failed' end,
      jsonb_build_object('verified_readback',true,'run_id',w.id,'receipt_id',receipt,'receipt_outcome',receipt_outcome,
        'report_sha256',encode(sha256(convert_to(stored::text,'UTF8')),'hex')),
      'The original Research result and receipt were recorded.');
    select * into w from public.paige_durable_work where id=_work_id;
  end if;

  if w.status not in ('succeeded','failed') or w.terminal_outcome->>'run_id' is distinct from w.id::text
    or w.terminal_outcome->>'verified_readback' is distinct from 'true' then
    return jsonb_build_object('state',case when w.status='claimed' then 'in_progress' else w.status end);
  end if;
  if stored is null then stored := public.research_readback_persisted_run(w.id,w.tenant_id,w.initiating_user_id); end if;
  receipt_detail := jsonb_build_object('operation','deep_research','report_saved',true,
    'findings_count',jsonb_array_length(stored->'findings'),'sources_count',jsonb_array_length(stored->'sources'),
    'stop_reason',stored->>'stop_reason','configured',stored->'configured');
  select e.id,e.outcome into receipt,receipt_outcome from public.paige_workspace_events e where e.tenant_id=w.tenant_id
    and e.actor_id=w.initiating_user_id and e.source_kind='capability_run' and e.source_id=w.id
    and e.source_revision=0 and e.capability_key='deep_research'
    and e.id::text=w.terminal_outcome->>'receipt_id' and e.outcome=w.terminal_outcome->>'receipt_outcome'
    and e.job_attempt_id=attempt_ref and e.detail=receipt_detail;
  if stored is null or receipt is null or not exists(select 1 from public.research_runs r
    where r.id=w.id and r.work_id=w.id)
    or encode(sha256(convert_to(stored::text,'UTF8')),'hex') is distinct from w.terminal_outcome->>'report_sha256'
    or (select count(*) from public.research_runs r where r.work_id=w.id)<>1 then
    raise exception 'RESEARCH_COMPLETION_UNVERIFIED' using errcode='55000';
  end if;
  return jsonb_build_object('state','complete','result',jsonb_build_object(
    'run_id',w.id,'question',stored->'question','findings',stored->'findings','coverage',stored->'coverage',
    'entity_profile',stored->'entity_profile','sources',coalesce((
      select jsonb_agg((s-'run_id'-'tenant_id'-'user_id'-'source_index')||
        jsonb_build_object('index',s->'source_index') order by (s->>'source_index')::integer)
      from jsonb_array_elements(stored->'sources') s),'[]'::jsonb),
    'persistence_verified',true,'receipt_recorded',true,'receipt_outcome',receipt_outcome,'receipt_id',receipt));
end;
$$;
revoke all on function public.advance_paige_research_work(uuid,uuid,uuid,uuid,uuid,jsonb,text,bigint,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.advance_paige_research_work(uuid,uuid,uuid,uuid,uuid,jsonb,text,bigint,jsonb)
  to service_role;

commit;
