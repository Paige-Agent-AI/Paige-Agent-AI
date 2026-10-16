-- Compose the existing native Research checkpoint into one read-only database
-- request. The endpoint still independently verifies Auth at EVERY checkpoint.
-- No fallback workspace, claim mutation, role grant or cross-request permission.
begin;

create function public.research_assert_current_scope(
  _expected_actor_id uuid,
  _expected_tenant_id uuid default null
) returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := coalesce(auth.jwt()->>'role','');
  v_tenant uuid;
begin
  if _expected_actor_id is null or v_role not in ('authenticated','service_role')
    or (v_role='authenticated' and auth.uid() is distinct from _expected_actor_id)
  then raise exception 'RESEARCH_SCOPE_UNVERIFIED' using errcode='42501'; end if;

  if not exists(select 1 from auth.users u where u.id=_expected_actor_id
      and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
  then raise exception 'RESEARCH_SCOPE_UNVERIFIED' using errcode='42501'; end if;

  select p.active_tenant_id into v_tenant from public.profiles p
    where p.user_id=_expected_actor_id;
  if v_tenant is null or (_expected_tenant_id is not null and v_tenant<>_expected_tenant_id)
  then raise exception 'RESEARCH_SCOPE_UNVERIFIED' using errcode='42501'; end if;

  if v_role='service_role' then
    -- Preserve the existing trusted-service direct-active-seat contract.
    if not exists(select 1 from public.tenant_members m where m.user_id=_expected_actor_id
        and m.tenant_id=v_tenant and m.status='active')
    then raise exception 'RESEARCH_SCOPE_UNVERIFIED' using errcode='42501'; end if;
  else
    -- Preserve the incumbent JWT predicates, including their existing authorized
    -- company-operator exception; explicit profile equality prevents fallback.
    if public.current_user_tenant_id() is distinct from v_tenant
      or public.is_tenant_member(v_tenant) is distinct from true
    then raise exception 'RESEARCH_SCOPE_UNVERIFIED' using errcode='42501'; end if;
  end if;
  return jsonb_build_object('actor_id',_expected_actor_id,'tenant_id',v_tenant);
end;
$$;
revoke all on function public.research_assert_current_scope(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.research_assert_current_scope(uuid,uuid) to authenticated,service_role;
comment on function public.research_assert_current_scope(uuid,uuid) is
  'Read-only current native Research scope composition. Authenticated callers bind auth.uid; service callers retain delegated direct membership. Fresh Auth validation is still required by the endpoint.';
commit;
