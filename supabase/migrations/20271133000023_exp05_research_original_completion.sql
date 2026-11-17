-- Add the original Research result/receipt pair to the existing authorized reader.
-- No dispatch, publication, approval, provider call or table grant is added.
begin;
set local lock_timeout = '3s';

do $research_completion$
declare
  reader regprocedure := 'public.read_paige_durable_continuation(uuid,uuid,uuid)'::regprocedure;
  source text;
  definition text;
  original_acl aclitem[];
  declarations text := ' completion jsonb := ''{}''::jsonb;';
  tail text := ' return completion || jsonb_build_object(';
  research_read text := $body$
 -- Only a current authorized original Research job can supply this completion.
 if w.work_kind='research' and w.capability_key='deep_research' and w.status='succeeded'
  and w.intent_id=_intent and w.attempt_count>0 and w.settled_at between w.created_at and now()
  and w.terminal_outcome->>'verified_readback'='true'
  and w.terminal_outcome->>'run_id'=w.id::text
  and w.terminal_outcome->>'receipt_outcome'='capability_succeeded' then
  begin
   perform public.research_assert_current_scope(actor,tenant);
  exception when insufficient_privilege then return null;
  end;
  -- Reproduce research_readback_persisted_run's canonical digest shape without
  -- impersonating its service-role caller or widening that helper's grants.
  select jsonb_build_object(
   'id',r.id,'tenant_id',r.tenant_id,'user_id',r.user_id,'question',r.question,
   'domain',r.domain,'caller',r.caller,'findings',r.findings,'coverage',r.coverage,
   'stop_reason',r.stop_reason,'configured',r.configured,'entity_profile',r.entity_profile,
   'sources',coalesce((select jsonb_agg(jsonb_build_object(
    'run_id',s.run_id,'tenant_id',s.tenant_id,'user_id',s.user_id,
    'source_index',s.source_index,'url',s.url,'title',s.title,'snippet',s.snippet,
    'reliability_score',s.reliability_score,'tier',s.tier,'reliability',s.reliability,
    'published_at',s.published_at,'fetched_at',s.fetched_at,'excluded',s.excluded
   ) order by s.source_index) from public.research_sources s
    where s.run_id=r.id and s.tenant_id=tenant and s.user_id=actor),'[]'::jsonb)
  ) into research_report from public.research_runs r
   where r.id=w.id and r.work_id=w.id and r.tenant_id=tenant and r.user_id=actor
    -- Work retains the raw input; the original Research report uses JS.trim.
    and r.question=btrim(objective,
     U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
    and r.configured and r.coverage->'configured'='true'::jsonb
    and r.stop_reason in ('answered','max_hops','budget','wall_clock','no_results')
    and r.coverage->>'stop_reason'=r.stop_reason;
  if research_report is not null
   and encode(sha256(convert_to(research_report::text,'UTF8')),'hex')=w.terminal_outcome->>'report_sha256'
   and (select count(*) from public.research_runs where work_id=w.id)=1
   and not exists(select 1 from public.research_sources s where s.run_id=w.id
    and (s.tenant_id is distinct from tenant or s.user_id is distinct from actor)) then
   select count(*),min(e.id::text)::uuid into receipt_count,receipt
   from public.paige_workspace_events e where e.tenant_id=tenant and e.actor_id=actor
    and e.source_kind='capability_run' and e.source_id=w.id and e.source_revision=0
    and e.capability_key='deep_research' and e.outcome='capability_succeeded'
    and e.id::text=w.terminal_outcome->>'receipt_id'
    and e.job_attempt_id=w.id::text||':'||w.attempt_count::text
    and e.detail=jsonb_build_object('operation','deep_research','report_saved',true,
     'findings_count',jsonb_array_length(research_report->'findings'),
     'sources_count',jsonb_array_length(research_report->'sources'),
     'stop_reason',research_report->>'stop_reason','configured',research_report->'configured');
   if receipt_count=1 and (select count(*) from public.paige_workspace_events e
    where e.tenant_id=tenant and e.source_kind='capability_run' and e.source_id=w.id and e.source_revision=0)=1 then
    completion := jsonb_build_object('completion',jsonb_build_object('resultRef',w.id,'receiptRef',receipt));
   end if;
  end if;
 end if;
 return completion || jsonb_build_object($body$;
begin
  select p.prosrc,pg_get_functiondef(p.oid),p.proacl into source,definition,original_acl
  from pg_proc p where p.oid=reader and p.prosecdef and p.provolatile='s'
   and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']
   and p.proargnames=array['_thread','_intent','_work']::text[] and p.prorettype='jsonb'::regtype
   and p.proacl=array['postgres=X/postgres','authenticated=X/postgres']::aclitem[];
  if md5(source) is distinct from 'f97d7636da19292b737ea38767f8ff44'
   or (length(source)-length(replace(source,declarations,'')))<>length(declarations)
   or (length(source)-length(replace(source,tail,'')))<>length(tail) then
    raise exception 'C4E_CONTINUATION_READER_CHANGED';
  end if;
  definition := replace(definition,declarations,declarations||E'\n research_report jsonb;');
  definition := replace(definition,tail,research_read);
  execute definition;
  -- The C4e writer hashes timestamp JSON under UTC. Retrieval must use the same
  -- canonical representation regardless of the calling session's timezone.
  execute 'alter function public.read_paige_durable_continuation(uuid,uuid,uuid) set TimeZone=''UTC''';
  if not exists(select 1 from pg_proc p where p.oid=reader and p.proacl is not distinct from original_acl
   and p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=""','TimeZone=UTC']
   and pg_get_userbyid(p.proowner)='postgres'
   and p.prosrc=replace(replace(source,declarations,declarations||E'\n research_report jsonb;'),tail,research_read)) then
    raise exception 'C4E_CONTINUATION_READER_READBACK_CHANGED';
  end if;
end $research_completion$;
commit;
