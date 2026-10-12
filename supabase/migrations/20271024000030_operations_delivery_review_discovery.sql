begin;

-- Discover only existing nominations for the actual caller. This is a projection,
-- not another task queue, assignment authority or grant of general Planning access.
create function public.operations_delivery_reviews_scoped(
  p_expected_actor_id uuid, p_expected_tenant_id uuid, p_limit integer default 40
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_s public.operations_delivery_submissions%rowtype;
  v_artifact jsonb; v_work_version timestamptz;
  v_reviews jsonb:='[]'::jsonb;
  v_scanned integer:=0; v_unavailable integer:=0; v_more boolean:=false;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id
    or public.current_user_tenant_id() is distinct from p_expected_tenant_id
    or not exists(select 1 from public.tenant_members
      where tenant_id=p_expected_tenant_id and user_id=v_actor and status='active')
    or not exists(select 1 from public.tenants
      where id=p_expected_tenant_id and account_type::text='standalone' and parent_tenant_id is null) then
    raise exception 'DELIVERY_REVIEWS_UNAVAILABLE' using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'DELIVERY_REVIEW_LIMIT_INVALID' using errcode='22023';
  end if;
  for v_s in select s.* from public.operations_delivery_submissions s
    where s.tenant_id=p_expected_tenant_id and s.reviewer_user_id=v_actor and s.state='in_review'
      and not exists(select 1 from public.operations_delivery_submissions newer
        where newer.tenant_id=s.tenant_id and newer.work_item_id=s.work_item_id and newer.revision_no>s.revision_no)
    order by s.submitted_at,s.id limit p_limit+1
  loop
    v_scanned:=v_scanned+1;
    if v_scanned>p_limit then v_more:=true;exit;end if;
    begin
      v_artifact:=public.operations_delivery_artifact_scoped(v_s.id,v_actor,p_expected_tenant_id);
    exception when insufficient_privilege then
      v_unavailable:=v_unavailable+1;continue;
    end;
    -- The delegated volatile reader can observe a newer state than the cursor.
    -- Never label a changed review/reviewer/revision as this caller's pending work.
    if v_artifact->>'submission_id' is distinct from v_s.id::text
      or v_artifact->>'state' is distinct from 'in_review'
      or v_artifact->>'reviewer_user_id' is distinct from v_actor::text
      or v_artifact->>'revision_no' is distinct from v_s.revision_no::text
      or v_artifact->>'artifact_version_id' is distinct from v_s.artifact_version_id::text
      or v_artifact->>'artifact_digest' is distinct from v_s.artifact_digest
      or (v_artifact->>'updated_at')::timestamptz is distinct from v_s.updated_at
      or not exists(select 1 from public.operations_delivery_submissions current_s
        where current_s.id=v_s.id and current_s.tenant_id=p_expected_tenant_id
          and current_s.state='in_review' and current_s.reviewer_user_id=v_actor
          and current_s.updated_at=v_s.updated_at and current_s.revision_no=v_s.revision_no
          and not exists(select 1 from public.operations_delivery_submissions newer
            where newer.tenant_id=current_s.tenant_id and newer.work_item_id=current_s.work_item_id
              and newer.revision_no>current_s.revision_no)) then
      v_unavailable:=v_unavailable+1;continue;
    end if;
    select w.updated_at into v_work_version from public.plan_items w
      where w.id=v_s.work_item_id and w.tenant_id=p_expected_tenant_id;
    if v_work_version is null then v_unavailable:=v_unavailable+1;continue;end if;
    v_reviews:=v_reviews||jsonb_build_array(jsonb_build_object(
      'submission_id',v_s.id,'work_item_id',v_s.work_item_id,'plan_id',v_s.plan_id,'client_id',v_s.client_id,
      'artifact_version_id',v_s.artifact_version_id,'artifact_digest',v_s.artifact_digest,
      'revision_no',v_s.revision_no,'submitted_by',v_s.submitted_by,'reviewer_user_id',v_actor,
      'submission_updated_at',v_s.updated_at,'work_updated_at',v_work_version,'title',v_artifact->>'title'));
  end loop;
  -- A workspace or membership change cannot turn the earlier nominations into a
  -- ready result under a newly revoked scope, including the partial-count path.
  if public.current_user_tenant_id() is distinct from p_expected_tenant_id
    or not exists(select 1 from public.tenant_members
      where tenant_id=p_expected_tenant_id and user_id=v_actor and status='active') then
    raise exception 'DELIVERY_REVIEWS_UNAVAILABLE' using errcode='42501';
  end if;
  return jsonb_build_object('actor_id',v_actor,'tenant_id',p_expected_tenant_id,
    'reviews',v_reviews,'unavailable_count',v_unavailable,'has_more',v_more);
end $$;
revoke all on function public.operations_delivery_reviews_scoped(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.operations_delivery_reviews_scoped(uuid,uuid,integer) to authenticated;

commit;
