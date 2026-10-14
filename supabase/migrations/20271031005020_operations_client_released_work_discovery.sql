begin;

-- Read only existing client release grants. No queue, identity, task or artifact copy.
create index if not exists operations_delivery_client_releases_actor_recent
  on public.operations_delivery_client_releases(tenant_id,client_user_id,released_at desc,id);

create function public.operations_delivery_client_reviews_scoped(
  p_expected_actor_id uuid,p_expected_tenant_id uuid,p_limit integer default 40
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_candidate record;v_artifact jsonb;
  v_releases jsonb:='[]'::jsonb;v_scanned integer:=0;v_unavailable integer:=0;v_more boolean:=false;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id
    or not exists(select 1 from public.tenants where id=p_expected_tenant_id
      and account_type::text='standalone' and parent_tenant_id is null)
    or exists(select 1 from public.tenant_members where tenant_id=p_expected_tenant_id
      and user_id=v_actor and status='active')
    or not exists(select 1 from public.clients where tenant_id=p_expected_tenant_id
      and linked_user_id=v_actor and merged_into_contact_id is null) then
    raise exception 'DELIVERY_CLIENT_REVIEWS_UNAVAILABLE' using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>40 then
    raise exception 'DELIVERY_CLIENT_REVIEWS_LIMIT_INVALID' using errcode='22023';
  end if;
  for v_candidate in
    select r.id,r.submission_id,r.state,r.updated_at,s.revision_no,s.artifact_digest
    from public.operations_delivery_client_releases r
    join public.clients c on c.id=r.client_id and c.tenant_id=r.tenant_id
      and c.linked_user_id=r.client_user_id and c.merged_into_contact_id is null
    join public.operations_delivery_submissions s on s.id=r.submission_id
      and s.tenant_id=r.tenant_id and s.client_id=r.client_id
    where r.tenant_id=p_expected_tenant_id and r.client_user_id=v_actor
      and not exists(select 1 from public.operations_delivery_submissions newer
        where newer.tenant_id=s.tenant_id and newer.work_item_id=s.work_item_id and newer.revision_no>s.revision_no)
    order by r.released_at desc,r.id limit p_limit+1
  loop
    v_scanned:=v_scanned+1;
    if v_scanned>p_limit then v_more:=true;exit;end if;
    begin
      -- The exact existing artifact reader, including current linked identity,
      -- nonstaff/tenant/work/source/latest/digest gates, owns all per-row authority.
      v_artifact:=public.operations_delivery_client_read_scoped(v_candidate.id,v_actor,p_expected_tenant_id);
    exception when sqlstate '42501' or sqlstate '40001' or sqlstate '22023' then
      v_unavailable:=v_unavailable+1;continue;
    end;
    if v_artifact->>'actor_id' is distinct from v_actor::text
      or v_artifact->>'tenant_id' is distinct from p_expected_tenant_id::text
      or v_artifact->>'release_id' is distinct from v_candidate.id::text
      or v_artifact->>'submission_id' is distinct from v_candidate.submission_id::text
      or v_artifact->>'state' is distinct from v_candidate.state
      or v_artifact->>'revision_no' is distinct from v_candidate.revision_no::text
      or v_artifact->>'artifact_digest' is distinct from v_candidate.artifact_digest
      or (v_artifact->>'updated_at')::timestamptz is distinct from v_candidate.updated_at
      or not exists(select 1 from public.operations_delivery_client_releases current_r
        join public.clients current_c on current_c.id=current_r.client_id and current_c.tenant_id=current_r.tenant_id
          and current_c.linked_user_id=v_actor and current_c.merged_into_contact_id is null
        join public.operations_delivery_submissions current_s on current_s.id=current_r.submission_id
          and current_s.tenant_id=current_r.tenant_id and current_s.client_id=current_r.client_id
        where current_r.id=v_candidate.id and current_r.tenant_id=p_expected_tenant_id
          and current_r.client_user_id=v_actor and current_r.submission_id=v_candidate.submission_id
          and current_r.state=v_candidate.state and current_r.updated_at=v_candidate.updated_at
          and current_s.revision_no=v_candidate.revision_no and current_s.artifact_digest=v_candidate.artifact_digest
          and not exists(select 1 from public.operations_delivery_submissions newer
            where newer.tenant_id=current_s.tenant_id and newer.work_item_id=current_s.work_item_id
              and newer.revision_no>current_s.revision_no)) then
      v_unavailable:=v_unavailable+1;continue;
    end if;
    v_releases:=v_releases||jsonb_build_array(jsonb_build_object('release_id',v_candidate.id,
      'submission_id',v_candidate.submission_id,'state',v_candidate.state,'revision_no',v_candidate.revision_no,
      'artifact_digest',v_candidate.artifact_digest,'title',v_artifact->>'title','updated_at',v_candidate.updated_at));
  end loop;
  if not exists(select 1 from public.tenants where id=p_expected_tenant_id
      and account_type::text='standalone' and parent_tenant_id is null)
    or exists(select 1 from public.tenant_members where tenant_id=p_expected_tenant_id and user_id=v_actor and status='active')
    or not exists(select 1 from public.clients where tenant_id=p_expected_tenant_id and linked_user_id=v_actor and merged_into_contact_id is null) then
    raise exception 'DELIVERY_CLIENT_REVIEWS_UNAVAILABLE' using errcode='42501';
  end if;
  return jsonb_build_object('actor_id',v_actor,'tenant_id',p_expected_tenant_id,
    'releases',v_releases,'unavailable_count',v_unavailable,'has_more',v_more);
end $$;
revoke all on function public.operations_delivery_client_reviews_scoped(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.operations_delivery_client_reviews_scoped(uuid,uuid,integer) to authenticated;

commit;
