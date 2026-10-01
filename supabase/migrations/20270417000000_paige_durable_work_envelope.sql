-- Paige Runtime Harness — canonical durable-work envelope.
-- ONE HOME: capability-specific run/job rows keep their own lifecycles and reference this row.
-- The server mints the dispatch idempotency key; a caller-stable intent_id folds lost-response
-- retries onto the same row. Raw authority context is server-only and never part of owner readback.

create table public.paige_durable_work (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  initiating_user_id uuid not null references auth.users(id) on delete restrict,
  intent_id uuid not null,
  thread_id uuid references public.paige_chat_threads(id) on delete set null,
  capability_key text not null,
  work_kind text not null,
  authority_context jsonb not null,
  scope_epoch text not null,
  idempotency_key text not null,
  status text not null default 'claimed',
  attempt_count integer not null default 1,
  max_attempts integer not null default 5,
  claimed_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  lease_until timestamptz,
  blocked_reason text,
  error_code text,
  safe_summary text,
  terminal_outcome jsonb,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,

  constraint paige_durable_work_intent_uk unique (tenant_id, initiating_user_id, intent_id),
  constraint paige_durable_work_idempotency_uk unique (idempotency_key),
  constraint paige_durable_work_capability_key_ck check (
    char_length(capability_key) between 3 and 129
    and capability_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$'
  ),
  constraint paige_durable_work_kind_ck check (
    char_length(work_kind) between 2 and 64 and work_kind ~ '^[a-z][a-z0-9_]*$'
  ),
  constraint paige_durable_work_scope_epoch_ck check (char_length(scope_epoch) between 1 and 512),
  constraint paige_durable_work_authority_context_ck check (
    jsonb_typeof(authority_context) = 'object' and pg_column_size(authority_context) <= 16384
  ),
  constraint paige_durable_work_status_ck check (
    status in ('claimed','succeeded','failed','blocked','cancelled','expired','outcome_unknown')
  ),
  constraint paige_durable_work_attempts_ck check (
    attempt_count between 1 and max_attempts and max_attempts between 1 and 25
  ),
  constraint paige_durable_work_blocked_reason_ck check (
    (status = 'blocked' and blocked_reason is not null and char_length(blocked_reason) between 1 and 500)
    or (status <> 'blocked' and blocked_reason is null)
  ),
  constraint paige_durable_work_error_code_ck check (
    error_code is null or (char_length(error_code) between 1 and 100 and error_code ~ '^[a-z0-9_]+$')
  ),
  constraint paige_durable_work_safe_summary_ck check (
    safe_summary is null or char_length(safe_summary) between 1 and 2000
  ),
  constraint paige_durable_work_terminal_outcome_ck check (
    (status in ('succeeded','failed','cancelled')
      and terminal_outcome is not null
      and jsonb_typeof(terminal_outcome) = 'object'
      and pg_column_size(terminal_outcome) <= 16384
      and settled_at is not null)
    or
    (status not in ('succeeded','failed','cancelled')
      and terminal_outcome is null
      and settled_at is null)
  ),
  constraint paige_durable_work_claim_lease_ck check (
    status <> 'claimed' or (claimed_at is not null and heartbeat_at is not null and lease_until is not null)
  )
);

comment on table public.paige_durable_work is
  'Canonical tenant-scoped envelope for work that outlives an interactive request and returns an artifact or durable result.';
comment on column public.paige_durable_work.authority_context is
  'Immutable server-resolved audit snapshot, never reusable permission. Internal only; never returned by the owner-safe read function.';
comment on column public.paige_durable_work.safe_summary is
  'Bounded owner-safe summary. Never raw document text, raw web content, credentials, or model reasoning.';
comment on column public.paige_durable_work.terminal_outcome is
  'Bounded structured terminal evidence. succeeded requires verified_readback=true.';

create index paige_durable_work_tenant_recent_idx on public.paige_durable_work (tenant_id, created_at desc);
create index paige_durable_work_thread_recent_idx on public.paige_durable_work (thread_id, created_at desc)
  where thread_id is not null;
create index paige_durable_work_active_idx on public.paige_durable_work (status, lease_until)
  where status in ('claimed','blocked','expired','outcome_unknown');

alter table public.paige_durable_work enable row level security;
alter table public.paige_durable_work force row level security;
revoke all on table public.paige_durable_work from public, anon, authenticated, service_role;

create or replace function public._paige_durable_work_protect_identity()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.initiating_user_id is distinct from old.initiating_user_id
     or new.intent_id is distinct from old.intent_id
     or new.thread_id is distinct from old.thread_id
     or new.capability_key is distinct from old.capability_key
     or new.work_kind is distinct from old.work_kind
     or new.authority_context is distinct from old.authority_context
     or new.scope_epoch is distinct from old.scope_epoch
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception 'DURABLE_WORK_IDENTITY_IMMUTABLE' using errcode = '22023';
  end if;
  return new;
end
$$;
revoke all on function public._paige_durable_work_protect_identity() from public, anon, authenticated;
create trigger trg_paige_durable_work_identity before update on public.paige_durable_work
  for each row execute function public._paige_durable_work_protect_identity();

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
  if not exists (
    select 1 from public.tenant_members m
     where m.tenant_id = _tenant_id
       and m.user_id = _initiating_user_id
       and m.status = 'active'
  ) then
    raise exception 'DURABLE_WORK_INITIATOR_FORBIDDEN' using errcode = '42501';
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

create or replace function public.heartbeat_paige_durable_work(
  _work_id uuid,
  _server_idempotency_key text,
  _lease_seconds integer default 300
)
returns table (work_status text, work_version bigint, work_lease_until timestamptz)
language plpgsql security definer set search_path = '' as $$
declare _row public.paige_durable_work%rowtype;
begin
  if _lease_seconds not between 30 and 3600 then
    raise exception 'DURABLE_WORK_LIMIT_INVALID' using errcode = '22023';
  end if;
  select * into _row from public.paige_durable_work where id = _work_id for update;
  if not found or _row.idempotency_key is distinct from _server_idempotency_key then
    raise exception 'DURABLE_WORK_NOT_FOUND' using errcode = '42501';
  end if;
  if _row.status <> 'claimed' then
    raise exception 'DURABLE_WORK_NOT_CLAIMED' using errcode = '55000';
  end if;
  if _row.lease_until <= now() then
    update public.paige_durable_work
       set status = 'expired', lease_until = null, heartbeat_at = now(),
           error_code = 'lease_expired', updated_at = now(), version = version + 1
     where id = _work_id returning * into _row;
  else
    update public.paige_durable_work
       set heartbeat_at = now(), lease_until = now() + pg_catalog.make_interval(secs => _lease_seconds),
           updated_at = now(), version = version + 1
     where id = _work_id returning * into _row;
  end if;
  return query select _row.status, _row.version, _row.lease_until;
end
$$;
revoke all on function public.heartbeat_paige_durable_work(uuid,text,integer)
  from public, anon, authenticated;
grant execute on function public.heartbeat_paige_durable_work(uuid,text,integer) to service_role;

create or replace function public.transition_paige_durable_work(
  _work_id uuid,
  _server_idempotency_key text,
  _new_status text,
  _terminal_outcome jsonb default null,
  _safe_summary text default null,
  _blocked_reason text default null,
  _error_code text default null,
  _lease_seconds integer default 300,
  _reconciled boolean default false
)
returns table (
  work_status text,
  work_version bigint,
  work_attempt_count integer,
  work_lease_until timestamptz,
  work_settled_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  _row public.paige_durable_work%rowtype;
  _allowed boolean := false;
begin
  if _new_status not in ('claimed','succeeded','failed','blocked','cancelled','expired','outcome_unknown') then
    raise exception 'DURABLE_WORK_STATUS_INVALID' using errcode = '22023';
  end if;
  if _lease_seconds not between 30 and 3600 then
    raise exception 'DURABLE_WORK_LIMIT_INVALID' using errcode = '22023';
  end if;
  if _safe_summary is not null and char_length(_safe_summary) not between 1 and 2000 then
    raise exception 'DURABLE_WORK_SUMMARY_INVALID' using errcode = '22023';
  end if;
  if _error_code is not null and (
    char_length(_error_code) not between 1 and 100 or _error_code !~ '^[a-z0-9_]+$'
  ) then
    raise exception 'DURABLE_WORK_ERROR_CODE_INVALID' using errcode = '22023';
  end if;

  select * into _row from public.paige_durable_work where id = _work_id for update;
  if not found or _row.idempotency_key is distinct from _server_idempotency_key then
    raise exception 'DURABLE_WORK_NOT_FOUND' using errcode = '42501';
  end if;

  if _row.status in ('succeeded','failed','cancelled') then
    if _row.status = _new_status
       and _row.terminal_outcome is not distinct from _terminal_outcome
       and _row.safe_summary is not distinct from _safe_summary
       and _row.error_code is not distinct from _error_code then
      return query select _row.status, _row.version, _row.attempt_count,
                          _row.lease_until, _row.settled_at;
      return;
    end if;
    raise exception 'DURABLE_WORK_TERMINAL_IMMUTABLE' using errcode = '55000';
  end if;

  if _row.status in ('expired','outcome_unknown') and not _reconciled then
    raise exception 'DURABLE_WORK_RECONCILIATION_REQUIRED' using errcode = '55000';
  end if;

  _allowed :=
    (_row.status = 'claimed' and _new_status in ('blocked','succeeded','failed','cancelled','expired','outcome_unknown'))
    or (_row.status = 'blocked' and _new_status in ('claimed','failed','cancelled'))
    or (_row.status in ('expired','outcome_unknown') and _new_status in ('claimed','succeeded','failed','cancelled'));
  if not _allowed then
    raise exception 'DURABLE_WORK_TRANSITION_INVALID' using errcode = '55000';
  end if;
  if _new_status = 'expired' and _row.lease_until > now() then
    raise exception 'DURABLE_WORK_LEASE_STILL_ACTIVE' using errcode = '55000';
  end if;
  if _new_status = 'claimed' and _row.attempt_count >= _row.max_attempts then
    raise exception 'DURABLE_WORK_ATTEMPT_CEILING' using errcode = '55000';
  end if;
  if _new_status = 'blocked' and (
    _blocked_reason is null or char_length(_blocked_reason) not between 1 and 500
  ) then
    raise exception 'DURABLE_WORK_BLOCKED_REASON_REQUIRED' using errcode = '22023';
  end if;
  if _new_status in ('succeeded','failed','cancelled') and (
    _terminal_outcome is null or jsonb_typeof(_terminal_outcome) <> 'object'
    or pg_column_size(_terminal_outcome) > 16384
  ) then
    raise exception 'DURABLE_WORK_TERMINAL_OUTCOME_REQUIRED' using errcode = '22023';
  end if;
  if _new_status = 'succeeded'
     and _terminal_outcome->>'verified_readback' is distinct from 'true' then
    raise exception 'DURABLE_WORK_SUCCESS_REQUIRES_READBACK' using errcode = '22023';
  end if;

  update public.paige_durable_work
     set status = _new_status,
         attempt_count = case when _new_status = 'claimed' then attempt_count + 1 else attempt_count end,
         claimed_at = case when _new_status = 'claimed' then now() else claimed_at end,
         heartbeat_at = case when _new_status = 'claimed' then now() else heartbeat_at end,
         lease_until = case when _new_status = 'claimed'
           then now() + pg_catalog.make_interval(secs => _lease_seconds) else null end,
         blocked_reason = case when _new_status = 'blocked' then _blocked_reason else null end,
         error_code = _error_code,
         safe_summary = _safe_summary,
         terminal_outcome = case
           when _new_status in ('succeeded','failed','cancelled') then _terminal_outcome else null end,
         settled_at = case
           when _new_status in ('succeeded','failed','cancelled') then now() else null end,
         updated_at = now(),
         version = version + 1
   where id = _work_id
   returning * into _row;

  return query select _row.status, _row.version, _row.attempt_count,
                      _row.lease_until, _row.settled_at;
end
$$;
revoke all on function public.transition_paige_durable_work(uuid,text,text,jsonb,text,text,text,integer,boolean)
  from public, anon, authenticated;
grant execute on function public.transition_paige_durable_work(uuid,text,text,jsonb,text,text,text,integer,boolean)
  to service_role;

-- Owner-safe status projection. It exposes no authority snapshot, idempotency key, raw result,
-- document body, web content, provider payload, credentials, or model reasoning.
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
     and (
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
     )
$$;
revoke all on function public.get_paige_durable_work(uuid) from public, anon;
grant execute on function public.get_paige_durable_work(uuid) to authenticated;

-- Existing capability-specific records keep their native lifecycle and gain only correlation.
-- Historical rows stay valid; new durable adopters set work_id.
alter table public.paige_workflow_runs add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;
alter table public.paige_skill_runs add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;
alter table public.business_verification_runs add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;
alter table public.security_canary_runs add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;
alter table public.paige_readiness_scan_runs add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;
alter table public.research_runs add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;
alter table public.paige_eval_run add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;
alter table public.paige_systems_check_run add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;
alter table public.paige_authority_act_runs add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;
alter table public.paige_media_jobs add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;
alter table public.paige_social_jobs add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;
alter table public.paige_act_executions add column if not exists work_id uuid references public.paige_durable_work(id) on delete restrict;

create index if not exists paige_workflow_runs_work_idx on public.paige_workflow_runs(work_id) where work_id is not null;
create index if not exists paige_skill_runs_work_idx on public.paige_skill_runs(work_id) where work_id is not null;
create index if not exists business_verification_runs_work_idx on public.business_verification_runs(work_id) where work_id is not null;
create index if not exists security_canary_runs_work_idx on public.security_canary_runs(work_id) where work_id is not null;
create index if not exists paige_readiness_scan_runs_work_idx on public.paige_readiness_scan_runs(work_id) where work_id is not null;
create index if not exists research_runs_work_idx on public.research_runs(work_id) where work_id is not null;
create index if not exists paige_eval_run_work_idx on public.paige_eval_run(work_id) where work_id is not null;
create index if not exists paige_systems_check_run_work_idx on public.paige_systems_check_run(work_id) where work_id is not null;
create index if not exists paige_authority_act_runs_work_idx on public.paige_authority_act_runs(work_id) where work_id is not null;
create index if not exists paige_media_jobs_work_idx on public.paige_media_jobs(work_id) where work_id is not null;
create index if not exists paige_social_jobs_work_idx on public.paige_social_jobs(work_id) where work_id is not null;
create index if not exists paige_act_executions_work_idx on public.paige_act_executions(work_id) where work_id is not null;
