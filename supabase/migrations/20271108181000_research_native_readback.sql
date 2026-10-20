-- Native Research deliberately has INSERT-only base access (20270565000000).
-- Its verified persistence path needs this exact server read, not table SELECT.
-- Apply after the existing current-scope checkpoint, before deploying its caller.
begin;

create or replace function public.research_readback_persisted_run(
  _run_id uuid,
  _tenant_id uuid,
  _actor_id uuid
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role'
    or _run_id is null or _tenant_id is null or _actor_id is null
  then raise exception 'RESEARCH_READBACK_UNVERIFIED' using errcode='42501'; end if;

  -- Reuse the current actor/workspace/direct-active-seat contract, including
  -- deletion/bans. A passed earlier Edge checkpoint cannot widen this read.
  perform public.research_assert_current_scope(_actor_id,_tenant_id);

  -- Unknown/foreign run identities reveal no report. Never return a child's
  -- foreign facts, nor silently hide a lineage-corrupt child as a complete run.
  if not exists(select 1 from public.research_runs r where r.id=_run_id
      and r.tenant_id=_tenant_id and r.user_id=_actor_id) then return null; end if;
  if exists(select 1 from public.research_sources s where s.run_id=_run_id
      and (s.tenant_id is distinct from _tenant_id or s.user_id is distinct from _actor_id))
  then raise exception 'RESEARCH_READBACK_UNVERIFIED' using errcode='42501'; end if;

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
      where s.run_id=r.id and s.tenant_id=_tenant_id and s.user_id=_actor_id),'[]'::jsonb)
  ) into v_result from public.research_runs r
    where r.id=_run_id and r.tenant_id=_tenant_id and r.user_id=_actor_id;
  return v_result;
end;
$$;
revoke all on function public.research_readback_persisted_run(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.research_readback_persisted_run(uuid,uuid,uuid) to service_role;
comment on function public.research_readback_persisted_run(uuid,uuid,uuid) is
  'Service-only exact Research persistence readback. Requires current actor/workspace/active seat and consistent parent/source lineage. Does not grant base-table SELECT, mark completion, write records or retry research.';

commit;
