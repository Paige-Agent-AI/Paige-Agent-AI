-- Native durable authority prerequisite only. No new job store, worker, public
-- submission, capability activation, or change to the Knowledge lifecycle freeze.
-- Existing actor-aware helpers own the role taxonomy, including company operators.
CREATE OR REPLACE FUNCTION public.knowledge_actor_authorized(_actor uuid,_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(_actor IS NOT NULL AND _tenant IS NOT NULL
  AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_actor AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<=now()))
  AND EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=_tenant AND t.status='active')
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=_actor AND p.active_tenant_id=_tenant)
  AND (public.is_platform_owner(_actor)
    OR EXISTS(SELECT 1 FROM public.tenant_members m WHERE m.user_id=_actor
      AND m.tenant_id=_tenant AND m.status='active')
    OR public.is_tenant_admin_as(_actor,_tenant)),false)
$$;
REVOKE ALL ON FUNCTION public.knowledge_actor_authorized(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.knowledge_actor_authorized(uuid,uuid) TO service_role;
COMMENT ON FUNCTION public.knowledge_actor_authorized(uuid,uuid) IS
 'Service-only current Knowledge authority for the named actor and explicitly selected tenant. No JWT impersonation or reusable snapshot permission.';

create or replace function public.create_paige_durable_work(
  _tenant_id uuid,
  _initiating_user_id uuid,
  _intent_id uuid,
  _thread_id uuid,
  _capability_key text,
  _work_kind text,
  _authority_context jsonb,
  _scope_epoch text,
  _lease_seconds integer default 300,
  _max_attempts integer default 5
)
returns table (
  work_id uuid,
  server_idempotency_key text,
  work_status text,
  work_version bigint,
  work_lease_until timestamptz,
  resumed_existing boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  _row public.paige_durable_work%rowtype;
  _inserted boolean := false;
begin
  if _tenant_id is null or _initiating_user_id is null or _intent_id is null then
    raise exception 'DURABLE_WORK_IDENTITY_REQUIRED' using errcode = '22023';
  end if;
  if _capability_key is null or _capability_key !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$'
     or char_length(_capability_key) not between 3 and 129 then
    raise exception 'DURABLE_WORK_CAPABILITY_INVALID' using errcode = '22023';
  end if;
  if _work_kind is null or _work_kind !~ '^[a-z][a-z0-9_]*$'
     or char_length(_work_kind) not between 2 and 64 then
    raise exception 'DURABLE_WORK_KIND_INVALID' using errcode = '22023';
  end if;
  if _scope_epoch is null or char_length(_scope_epoch) not between 1 and 512 then
    raise exception 'DURABLE_WORK_SCOPE_EPOCH_INVALID' using errcode = '22023';
  end if;
  if _authority_context is null or jsonb_typeof(_authority_context) <> 'object'
     or pg_column_size(_authority_context) > 16384
     or _authority_context->>'tenant_id' is distinct from _tenant_id::text
     or _authority_context->>'actor_user_id' is distinct from _initiating_user_id::text then
    raise exception 'DURABLE_WORK_AUTHORITY_CONTEXT_INVALID' using errcode = '22023';
  end if;
  if _lease_seconds not between 30 and 3600 or _max_attempts not between 1 and 25 then
    raise exception 'DURABLE_WORK_LIMIT_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.tenants t where t.id = _tenant_id and t.status = 'active'
  ) then
    raise exception 'DURABLE_WORK_TENANT_UNAVAILABLE' using errcode = '42501';
  end if;
  -- Reserved Knowledge kind/capability pairs cannot borrow another kind's policy.
  if (_work_kind in ('knowledge_extract','knowledge_publish')
      or _capability_key in ('knowledge.extract','knowledge.publish'))
     and not ((_work_kind='knowledge_extract' and _capability_key='knowledge.extract')
       or (_work_kind='knowledge_publish' and _capability_key='knowledge.publish')) then
    raise exception 'DURABLE_WORK_KNOWLEDGE_KIND_INVALID' using errcode='22023';
  end if;
  if _work_kind in ('knowledge_extract','knowledge_publish') then
    -- Pin the raw selected workspace during creation. Audit snapshots never authorize work.
    perform 1 from public.profiles where user_id=_initiating_user_id
      and active_tenant_id=_tenant_id for share;
    if not found or not public.knowledge_actor_authorized(_initiating_user_id,_tenant_id) then
      raise exception 'DURABLE_WORK_INITIATOR_FORBIDDEN' using errcode='42501';
    end if;
  else
  if not exists (
    select 1 from public.tenant_members m
     where m.tenant_id = _tenant_id
       and m.user_id = _initiating_user_id
       and m.status = 'active'
  ) then
    raise exception 'DURABLE_WORK_INITIATOR_FORBIDDEN' using errcode = '42501';
  end if;
  end if;
  if _thread_id is not null and not exists (
    select 1 from public.paige_chat_threads t
     where t.id = _thread_id
       and t.tenant_id = _tenant_id
       and t.caller_user_id = _initiating_user_id
       and not t.is_archived
  ) then
    raise exception 'DURABLE_WORK_THREAD_FORBIDDEN' using errcode = '42501';
  end if;

  insert into public.paige_durable_work (
    tenant_id, initiating_user_id, intent_id, thread_id, capability_key, work_kind,
    authority_context, scope_epoch, idempotency_key, lease_until, max_attempts
  ) values (
    _tenant_id, _initiating_user_id, _intent_id, _thread_id, _capability_key, _work_kind,
    _authority_context, _scope_epoch, 'paige-work:' || gen_random_uuid()::text,
    now() + pg_catalog.make_interval(secs => _lease_seconds), _max_attempts
  )
  on conflict (tenant_id, initiating_user_id, intent_id) do nothing
  returning * into _row;

  if found then
    _inserted := true;
  else
    select * into _row from public.paige_durable_work w
     where w.tenant_id = _tenant_id
       and w.initiating_user_id = _initiating_user_id
       and w.intent_id = _intent_id;
    if _row.thread_id is distinct from _thread_id
       or _row.capability_key is distinct from _capability_key
       or _row.work_kind is distinct from _work_kind
       or _row.authority_context is distinct from _authority_context
       or _row.scope_epoch is distinct from _scope_epoch then
      raise exception 'DURABLE_WORK_INTENT_REPLAY_MISMATCH' using errcode = '22023';
    end if;
  end if;

  return query select _row.id, _row.idempotency_key, _row.status, _row.version,
                      _row.lease_until, not _inserted;
end
$$;
revoke all on function public.create_paige_durable_work(uuid,uuid,uuid,uuid,text,text,jsonb,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.create_paige_durable_work(uuid,uuid,uuid,uuid,text,text,jsonb,text,integer,integer)
  to service_role;

create or replace function public.get_paige_durable_work(_work_id uuid)
returns table (
  work_id uuid,
  capability_key text,
  work_kind text,
  work_status text,
  attempt_count integer,
  max_attempts integer,
  blocked_reason text,
  error_code text,
  safe_summary text,
  created_at timestamptz,
  updated_at timestamptz,
  settled_at timestamptz
)
language sql security definer stable set search_path = '' as $$
  select w.id, w.capability_key, w.work_kind, w.status, w.attempt_count, w.max_attempts,
         w.blocked_reason, w.error_code, w.safe_summary, w.created_at, w.updated_at, w.settled_at
    from public.paige_durable_work w
   where w.id = _work_id
     and auth.uid() is not null
     and case when w.work_kind in ('knowledge_extract','knowledge_publish') then
       ((w.work_kind='knowledge_extract' and w.capability_key='knowledge.extract')
         or (w.work_kind='knowledge_publish' and w.capability_key='knowledge.publish'))
       and public.knowledge_actor_authorized(auth.uid(),w.tenant_id)
       and (w.initiating_user_id=auth.uid() or public.is_platform_owner(auth.uid())
            or public.is_tenant_admin_as(auth.uid(),w.tenant_id)
            or exists (select 1 from public.tenant_members m
              where m.tenant_id=w.tenant_id and m.user_id=auth.uid()
                and m.status='active' and m.is_owner=true))
     else (
       public.is_platform_owner()
       or exists (
         select 1 from public.tenant_members m
          where m.tenant_id = w.tenant_id
            and m.user_id = auth.uid()
            and m.status = 'active'
            and (
              w.initiating_user_id = auth.uid()
              or m.is_owner = true
              or m.role = 'owner'
              or m.role = 'admin'
            )
       )
     ) end
$$;
revoke all on function public.get_paige_durable_work(uuid) from public, anon;
grant execute on function public.get_paige_durable_work(uuid) to authenticated;
