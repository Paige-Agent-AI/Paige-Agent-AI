begin;

-- Inspect the exact submitted version through existing submission AND Studio authority.
-- This projection grants no general Planning/client knowledge and stores no artifact copy.
create function public.operations_delivery_artifact_scoped(
  p_submission_id uuid,p_expected_actor_id uuid,p_expected_tenant_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();v_s public.operations_delivery_submissions%rowtype;
  v_visible jsonb;v_a public.studio_artifact_versions%rowtype;
begin
  if v_actor is null or v_actor is distinct from p_expected_actor_id then
    raise exception 'DELIVERY_ARTIFACT_UNAVAILABLE' using errcode='42501';end if;
  select * into v_s from public.operations_delivery_submissions where id=p_submission_id and tenant_id=p_expected_tenant_id;
  if v_s.id is null then raise exception 'DELIVERY_ARTIFACT_UNAVAILABLE' using errcode='42501';end if;
  v_visible:=public.operations_delivery_list_scoped(v_s.work_item_id,p_expected_actor_id,p_expected_tenant_id);
  if not exists(select 1 from jsonb_array_elements(v_visible->'submissions') row where row->>'id'=v_s.id::text) then
    raise exception 'DELIVERY_ARTIFACT_UNAVAILABLE' using errcode='42501';end if;
  select * into v_a from public.studio_artifact_versions a where a.id=v_s.artifact_version_id and a.tenant_id=p_expected_tenant_id
    and coalesce(public.is_tenant_admin(p_expected_tenant_id) or exists(select 1 from public.studio_sessions
      where id=a.session_id and tenant_id=p_expected_tenant_id and owner_user_id=v_actor),false);
  if v_a.id is null or encode(extensions.digest(v_a.snapshot::text,'sha256'),'hex') is distinct from v_s.artifact_digest
    or v_a.kind<>'content' or v_a.snapshot->>'kind' is distinct from 'text'
    or jsonb_typeof(v_a.snapshot->'title') is distinct from 'string'
    or jsonb_typeof(v_a.snapshot->'body') is distinct from 'string'
    or length(trim(v_a.snapshot->>'title'))=0 or length(v_a.snapshot->>'title')>500
    or length(trim(v_a.snapshot->>'body'))=0 or length(v_a.snapshot->>'body')>200000 then
    raise exception 'DELIVERY_ARTIFACT_UNAVAILABLE' using errcode='42501';end if;
  return jsonb_build_object('actor_id',v_actor,'tenant_id',v_s.tenant_id,'submission_id',v_s.id,
    'work_item_id',v_s.work_item_id,'plan_id',v_s.plan_id,'client_id',v_s.client_id,
    'artifact_version_id',v_a.id,'artifact_digest',v_s.artifact_digest,'revision_no',v_s.revision_no,
    'reviewer_user_id',v_s.reviewer_user_id,'submitted_by',v_s.submitted_by,'state',v_s.state,
    'title',v_a.snapshot->>'title','body',v_a.snapshot->>'body','updated_at',v_s.updated_at);
end $$;
revoke all on function public.operations_delivery_artifact_scoped(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.operations_delivery_artifact_scoped(uuid,uuid,uuid) to authenticated;

commit;
