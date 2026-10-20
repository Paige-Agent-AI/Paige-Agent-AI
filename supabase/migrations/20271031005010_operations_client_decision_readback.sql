begin;
-- Add only the linked client's own recorded decision evidence. Existing
-- release, identity, source-version and tenant predicates remain unchanged.
create or replace function public.operations_delivery_client_read_scoped(p_release_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_result jsonb;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id then
    raise exception 'DELIVERY_CLIENT_UNAVAILABLE' using errcode='42501'; end if;
  select jsonb_build_object('actor_id',v_actor,'tenant_id',r.tenant_id,'release_id',r.id,
    'submission_id',s.id,'state',r.state,'revision_no',s.revision_no,'artifact_digest',s.artifact_digest,
    'title',a.snapshot->>'title','body',a.snapshot->>'body','updated_at',r.updated_at,
    'decision_by',r.decision_by,'decision_at',r.decision_at,'client_note',r.client_note)
  into v_result from public.operations_delivery_client_releases r
  join public.operations_delivery_submissions s on s.id=r.submission_id and s.tenant_id=r.tenant_id and s.client_id=r.client_id
  join public.clients c on c.id=r.client_id and c.tenant_id=r.tenant_id and c.linked_user_id=r.client_user_id and c.merged_into_contact_id is null
  join public.tenants t on t.id=r.tenant_id and t.account_type::text='standalone' and t.parent_tenant_id is null
  join public.plans p on p.id=s.plan_id and p.tenant_id=r.tenant_id and p.status<>'archived'
  join public.plan_items w on w.id=s.work_item_id and w.tenant_id=r.tenant_id and w.plan_id=p.id and w.contact_id=c.id and w.status<>'cancelled'
  join public.studio_artifact_versions a on a.id=s.artifact_version_id and a.tenant_id=r.tenant_id
  where r.id=p_release_id and r.tenant_id=p_expected_tenant_id and r.client_user_id=v_actor and s.state='approved'
    and not exists(select 1 from public.tenant_members where tenant_id=r.tenant_id and user_id=v_actor and status='active')
    and not exists(select 1 from public.operations_delivery_submissions where work_item_id=s.work_item_id and revision_no>s.revision_no)
    and encode(extensions.digest(a.snapshot::text,'sha256'),'hex')=s.artifact_digest
    and a.kind='content' and a.snapshot->>'kind'='text';
  if v_result is null then raise exception 'DELIVERY_CLIENT_UNAVAILABLE' using errcode='42501'; end if;
  return v_result;
end $$;
revoke all on function public.operations_delivery_client_read_scoped(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.operations_delivery_client_read_scoped(uuid,uuid,uuid) to authenticated;
commit;
