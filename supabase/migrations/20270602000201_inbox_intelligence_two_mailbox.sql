-- =============================================================================
-- #1140 — Inbox Intelligence, the two-mailbox pilot substrate.
--
-- ONE canonical engine (public.messages, channel_connectors, the comms doors)
-- with TWO server-enforced mailbox policies:
--   • personal       — a single user's private mailbox (Gmail inbox consent). The
--                      granting user is bound to the row (mailbox_owner_user_id);
--                      every tenant-scoped read path that is not the platform owner
--                      hides personal-mailbox rows from everyone but that user.
--   • shared_support — the tenant-shared customer-support mailbox. Tenant staff
--                      read it exactly as they read the unified inbox today.
--
-- Doctrine:
--  §9  Tenant isolation unchanged: messages.tenant_id stays connector/contact/caller
--      derived; the personal policy NARROWS visibility inside the tenant (it never
--      widens anything across tenants).
--  §13 Honesty: classification rows record the model route that produced them;
--      read_message_content never returns more than the envelope + plain-text body
--      it actually stores; a connector that is not active refuses (revoked consent).
--  §18 Reuse: labels, classifications, cases and sync state are new tables on the
--      EXISTING messages/channel_connectors substrate — no second inbox, no second
--      ledger, no second scheduler (mailbox_sync_state is state, not a queue).
--  §37 No existing response shape is narrowed: list_inbox_messages keeps its exact
--      projection and gains only the personal-visibility predicate.
--
--  Bounded reversibility (personal organization): the sync engine NEVER issues a
--  permanent-delete Gmail call; trash/undo is the door's approved, reversible pair.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. channel_connectors — the mailbox policy columns
-- -----------------------------------------------------------------------------
alter table public.channel_connectors
  add column if not exists mailbox_class text not null default 'shared_support'
    check (mailbox_class in ('personal','shared_support')),
  add column if not exists mailbox_owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists mailbox_scopes jsonb not null default '[]'::jsonb;

comment on column public.channel_connectors.mailbox_class is
  'Two-mailbox pilot (#1140): personal = one user''s private mailbox (read consent bound to mailbox_owner_user_id); shared_support = the tenant-shared support mailbox. Default keeps every existing connector exactly as it was.';
comment on column public.channel_connectors.mailbox_owner_user_id is
  'The user whose private mailbox this is. Required (checked) when mailbox_class=personal; the personal visibility predicate admits only this user (plus the platform owner).';
comment on column public.channel_connectors.mailbox_scopes is
  'OAuth scopes actually granted for this mailbox at consent time (array of scope strings). The read gate accepts gmail.readonly OR gmail.modify; organization requires gmail.modify. Revoking at the provider + disconnecting the connector refuses both (status/active gate).';

-- A personal mailbox without an owner cannot be protected — refuse it at write time.
create or replace function public.enforce_personal_mailbox_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mailbox_class = 'personal' and new.mailbox_owner_user_id is null then
    raise exception 'PERSONAL_MAILBOX_REQUIRES_OWNER';
  end if;
  -- Never silently orphan an existing personal mailbox (UPDATE only: OLD is
  -- unassigned on INSERT and would raise).
  if tg_op = 'UPDATE' and new.mailbox_class <> 'personal' and old.mailbox_class = 'personal'
     and new.mailbox_owner_user_id is distinct from old.mailbox_owner_user_id then
    new.mailbox_owner_user_id := old.mailbox_owner_user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_personal_mailbox_owner on public.channel_connectors;
create trigger trg_personal_mailbox_owner
  before insert or update on public.channel_connectors
  for each row execute function public.enforce_personal_mailbox_owner();

-- -----------------------------------------------------------------------------
-- 2. messages RLS — personal-mailbox rows are invisible to non-owner staff
--    (every read path: Conversations UI, PostgREST search, exports, chat reads).
--    Service-role writes (the sync engine) bypass RLS by role, not by policy.
-- -----------------------------------------------------------------------------
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.has_any_role(auth.uid(), array['admin'])
      and (
        connector_id is null
        or not exists (
          select 1 from public.channel_connectors c
          where c.id = messages.connector_id and c.mailbox_class = 'personal'
        )
        or exists (
          select 1 from public.channel_connectors c
          where c.id = messages.connector_id
            and c.mailbox_class = 'personal'
            and c.mailbox_owner_user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update using (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.has_any_role(auth.uid(), array['admin'])
      and (
        connector_id is null
        or not exists (
          select 1 from public.channel_connectors c
          where c.id = messages.connector_id and c.mailbox_class = 'personal'
        )
        or exists (
          select 1 from public.channel_connectors c
          where c.id = messages.connector_id
            and c.mailbox_class = 'personal'
            and c.mailbox_owner_user_id = auth.uid()
        )
      )
    )
  ) with check (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.has_any_role(auth.uid(), array['admin'])
      and (
        connector_id is null
        or not exists (
          select 1 from public.channel_connectors c
          where c.id = messages.connector_id and c.mailbox_class = 'personal'
        )
        or exists (
          select 1 from public.channel_connectors c
          where c.id = messages.connector_id
            and c.mailbox_class = 'personal'
            and c.mailbox_owner_user_id = auth.uid()
        )
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 3. message_labels — #1140's label system, canonical metadata on the mirror
-- -----------------------------------------------------------------------------
create table if not exists public.message_labels (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  message_id  uuid not null references public.messages(id) on delete cascade,
  label       text not null check (label ~ '^[a-z0-9][a-z0-9-]{0,31}$'),
  source      text not null default 'paige' check (source in ('auto','owner','paige')),
  applied_by  uuid references auth.users(id) on delete set null,
  -- Denormalized mailbox policy: the policy reads the row's OWN columns, never a
  -- subquery through messages (messages RLS hides the personal rows a non-owner
  -- would need to see for the old predicate to refuse them).
  mailbox_class         text not null default 'shared_support' check (mailbox_class in ('personal','shared_support')),
  mailbox_owner_user_id uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (message_id, label)
);
create index if not exists idx_message_labels_tenant on public.message_labels (tenant_id, label, created_at desc);

comment on table public.message_labels is
  'Inbox Intelligence (#1140): canonical labels on unified-inbox messages. source=auto comes from classification, owner beats auto (a person''s correction is recorded, never silently overwritten back), paige is an approved organize action.';

alter table public.message_labels enable row level security;

drop policy if exists message_labels_select on public.message_labels;
create policy message_labels_select on public.message_labels
  for select using (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.has_any_role(auth.uid(), array['admin'])
      and (
        mailbox_class <> 'personal'
        or mailbox_owner_user_id = auth.uid()
      )
    )
  );

drop policy if exists message_labels_service_all on public.message_labels;
create policy message_labels_service_all on public.message_labels
  for all to service_role using (true) with check (true);

grant select, insert, delete on public.message_labels to authenticated;
grant all on public.message_labels to service_role;

-- -----------------------------------------------------------------------------
-- 4. message_classifications — the classification receipt (intent + route)
-- -----------------------------------------------------------------------------
create table if not exists public.message_classifications (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  message_id     uuid not null references public.messages(id) on delete cascade,
  mailbox_class  text not null check (mailbox_class in ('personal','shared_support')),
  mailbox_owner_user_id uuid references auth.users(id) on delete set null,
  intent         text not null,
  confidence     numeric not null check (confidence >= 0 and confidence <= 1),
  risk_tier      text not null check (risk_tier in ('routine','elevated')),
  summary        text,
  model_route    jsonb not null default '{}'::jsonb,
  decided_at     timestamptz not null default now(),
  unique (message_id)
);

comment on table public.message_classifications is
  'Inbox Intelligence (#1140): one classification per message, closed vocabulary, with the model-route evidence that produced it. Elevated intents (billing/refund/account_access/security/legal) never qualify for bounded acknowledgement automation.';

alter table public.message_classifications enable row level security;

drop policy if exists message_classifications_select on public.message_classifications;
create policy message_classifications_select on public.message_classifications
  for select using (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.has_any_role(auth.uid(), array['admin'])
      and (
        mailbox_class <> 'personal'
        or mailbox_owner_user_id = auth.uid()
      )
    )
  );

drop policy if exists message_classifications_service_all on public.message_classifications;
create policy message_classifications_service_all on public.message_classifications
  for all to service_role using (true) with check (true);

grant select on public.message_classifications to authenticated;
grant all on public.message_classifications to service_role;

-- -----------------------------------------------------------------------------
-- 5. support_cases — the shared mailbox's case + follow-up state (one per thread)
-- -----------------------------------------------------------------------------
create table if not exists public.support_cases (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  connector_id         uuid not null references public.channel_connectors(id) on delete cascade,
  thread_key           text not null,
  contact_id           uuid references public.clients(id) on delete set null,
  status               text not null default 'open'
                         check (status in ('open','awaiting_owner','drafted','sent','awaiting_customer','resolved','closed')),
  last_intent          text,
  last_risk_tier       text check (last_risk_tier in ('routine','elevated')),
  last_inbound_at      timestamptz,
  last_outbound_at     timestamptz,
  next_followup_at     timestamptz,
  followup_count       integer not null default 0 check (followup_count >= 0 and followup_count <= 5),
  followup_cancelled_at timestamptz,
  acked_at             timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, connector_id, thread_key)
);

comment on table public.support_cases is
  'Inbox Intelligence (#1140): the shared-support mailbox''s case state — one row per thread. Follow-ups are bounded (count cap 5), cancelled the moment the customer replies, and never re-armed without new inbound. Cases exist ONLY for shared_support connectors (the engine refuses to open one on a personal mailbox).';

create index if not exists idx_support_cases_followups
  on public.support_cases (tenant_id, next_followup_at)
  where next_followup_at is not null;
create index if not exists idx_support_cases_status on public.support_cases (tenant_id, status, last_inbound_at desc);

alter table public.support_cases enable row level security;

drop policy if exists support_cases_select on public.support_cases;
create policy support_cases_select on public.support_cases
  for select using (
    public.is_platform_owner()
    or (tenant_id = public.current_user_tenant_id()
        and public.has_any_role(auth.uid(), array['admin']))
  );

drop policy if exists support_cases_service_all on public.support_cases;
create policy support_cases_service_all on public.support_cases
  for all to service_role using (true) with check (true);

grant select, update on public.support_cases to authenticated;
grant all on public.support_cases to service_role;

-- -----------------------------------------------------------------------------
-- 6. mailbox_sync_state — the personal Gmail sync cursor (state, not a queue)
-- -----------------------------------------------------------------------------
create table if not exists public.mailbox_sync_state (
  connector_id                uuid primary key references public.channel_connectors(id) on delete cascade,
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  mailbox_class               text not null check (mailbox_class in ('personal','shared_support')),
  last_history_id             bigint,
  last_message_internal_date  timestamptz,
  initial_sync_completed_at   timestamptz,
  last_sync_at                timestamptz,
  last_sync_status            text not null default 'ok' check (last_sync_status in ('ok','partial','failed')),
  last_error                  text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.mailbox_sync_state is
  'Inbox Intelligence (#1140): the Gmail sync cursor per connector — bounded initial window, incremental history id, and the honest last-sync status. It records state only; the sync engine holds no queue of its own (no second scheduler).';

alter table public.mailbox_sync_state enable row level security;

drop policy if exists mailbox_sync_state_select on public.mailbox_sync_state;
create policy mailbox_sync_state_select on public.mailbox_sync_state
  for select using (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.has_any_role(auth.uid(), array['admin'])
      and (
        mailbox_class <> 'personal'
        or exists (
          select 1 from public.channel_connectors c
          where c.id = mailbox_sync_state.connector_id
            and c.mailbox_class = 'personal'
            and c.mailbox_owner_user_id = auth.uid()
        )
      )
    )
  );

drop policy if exists mailbox_sync_state_service_all on public.mailbox_sync_state;
create policy mailbox_sync_state_service_all on public.mailbox_sync_state
  for all to service_role using (true) with check (true);

grant select on public.mailbox_sync_state to authenticated;
grant all on public.mailbox_sync_state to service_role;

-- -----------------------------------------------------------------------------
-- 7. list_inbox_messages — same projection, plus the personal-visibility
--    predicate (the function is SECURITY DEFINER: RLS does not apply inside it).
--    Re-emitted in full from 20270112000000 with ONLY that predicate added.
-- -----------------------------------------------------------------------------
create or replace function public.list_inbox_messages(
  p_limit integer default 20,
  p_direction text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(t), '[]'::jsonb) from (
    select jsonb_build_object(
             'id', m.id,
             'direction', m.direction,
             'channel', m.channel_type,
             'subject', left(coalesce(m.subject, '(no subject)'), 120),
             'status', m.status,
             'contact_id', m.contact_id,
             'thread_key', m.thread_key,
             'created_at', m.created_at
           ) as t
    from public.messages m
    where m.tenant_id = public.current_user_tenant_id()
      and (p_direction is null or m.direction = p_direction)
      and (
        m.connector_id is null
        or not exists (
          select 1 from public.channel_connectors c
          where c.id = m.connector_id and c.mailbox_class = 'personal'
        )
        or (
          public.is_platform_owner()
          or exists (
            select 1 from public.channel_connectors c
            where c.id = m.connector_id
              and c.mailbox_class = 'personal'
              and c.mailbox_owner_user_id = auth.uid()
          )
        )
      )
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) s;
$$;

-- -----------------------------------------------------------------------------
-- 8. read_message_content — THE separately-authorized content-reading contract
--    (#1140 pilot: comms.messages_read stays envelope-only; bodies flow only here).
--    Personal: the mailbox owner only. Shared: tenant staff. Inactive connector:
--    refused (consent revoked). Plain-text body only, bounded.
-- -----------------------------------------------------------------------------
create or replace function public.read_message_content(
  p_message_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  msg record;
  conn_class text;
  conn_owner uuid;
  conn_status text;
  conn_active boolean;
  v_tenant uuid := public.current_user_tenant_id();
begin
  select msg.* into msg from public.messages msg where msg.id = p_message_id;
  if not found then return null; end if;
  if msg.tenant_id is distinct from v_tenant then return null; end if;

  if msg.connector_id is null then
    -- A row with no connector was never a synced mailbox message; staff may read it.
    conn_class := 'shared_support'; conn_owner := null; conn_status := 'active'; conn_active := true;
  else
    select cc.mailbox_class, cc.mailbox_owner_user_id, cc.status, cc.active
      into conn_class, conn_owner, conn_status, conn_active
      from public.channel_connectors cc where cc.id = msg.connector_id;
    if not found then return null; end if;
  end if;

  -- Revoked or disconnected consent refuses the read, fail-closed.
  if conn_status <> 'active' or conn_active is not true then
    return jsonb_build_object('ok', false, 'code', 'MAILBOX_INACTIVE');
  end if;

  if conn_class = 'personal' then
    if conn_owner is null or conn_owner <> auth.uid() then
      if not public.is_platform_owner() then
        return jsonb_build_object('ok', false, 'code', 'PERSONAL_MAILBOX_NOT_OWNER');
      end if;
    end if;
  else
    if not public.has_any_role(auth.uid(), array['admin']) and not public.is_platform_owner() then
      return jsonb_build_object('ok', false, 'code', 'WORKSPACE_ROLE_REQUIRED');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', msg.id,
    'direction', msg.direction,
    'channel', msg.channel_type,
    'mailbox_class', conn_class,
    'subject', msg.subject,
    'status', msg.status,
    'contact_id', msg.contact_id,
    'thread_key', msg.thread_key,
    'sender', msg.sender,
    'body_text', left(msg.body_text, 8000),
    'body_truncated', coalesce(length(msg.body_text), 0) > 8000,
    'labels', coalesce((
      select jsonb_agg(jsonb_build_object('label', l.label, 'source', l.source) order by l.label)
      from public.message_labels l where l.message_id = msg.id
    ), '[]'::jsonb),
    'classification', (
      select jsonb_build_object('intent', k.intent, 'confidence', k.confidence,
                                'risk_tier', k.risk_tier, 'summary', k.summary, 'decided_at', k.decided_at)
      from public.message_classifications k where k.message_id = msg.id
    ),
    'unsubscribe', msg.meta ? 'list_unsubscribe',
    'sent_at', msg.sent_at,
    'created_at', msg.created_at
  );
end;
$$;

revoke all on function public.read_message_content(uuid) from public, anon;
grant execute on function public.read_message_content(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Canonical label verbs (tenant staff; the personal predicate applies)
-- -----------------------------------------------------------------------------
create or replace function public.apply_message_label(
  p_message_id uuid,
  p_label text,
  p_source text default 'paige'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_user_tenant_id();
  v_message record;
  v_connector record;
begin
  if p_source not in ('owner','paige') then
    return jsonb_build_object('ok', false, 'code', 'LABEL_SOURCE_INVALID');
  end if;
  if p_label !~ '^[a-z0-9][a-z0-9-]{0,31}$' then
    return jsonb_build_object('ok', false, 'code', 'LABEL_INVALID');
  end if;

  select m.tenant_id, m.connector_id into v_message from public.messages m where m.id = p_message_id;
  if not found or v_message.tenant_id is distinct from v_tenant then
    return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_IN_WORKSPACE');
  end if;

  if v_message.connector_id is not null then
    select cc.mailbox_class, cc.mailbox_owner_user_id into v_connector
      from public.channel_connectors cc where cc.id = v_message.connector_id;
    if v_connector.mailbox_class = 'personal'
       and v_connector.mailbox_owner_user_id is distinct from auth.uid()
       and not public.is_platform_owner() then
      return jsonb_build_object('ok', false, 'code', 'PERSONAL_MAILBOX_NOT_OWNER');
    end if;
  end if;

  -- An owner correction beats an auto label: replace the auto row with the owner's.
  delete from public.message_labels
   where message_id = p_message_id and label = p_label and source = 'auto';

  insert into public.message_labels (tenant_id, message_id, label, source, applied_by, mailbox_class, mailbox_owner_user_id)
  values (v_tenant, p_message_id, p_label, p_source, auth.uid(),
          coalesce(v_connector.mailbox_class, 'shared_support'), v_connector.mailbox_owner_user_id)
  on conflict (message_id, label) do update
    set source = excluded.source, applied_by = excluded.applied_by
  where public.message_labels.source = 'auto' and excluded.source in ('owner','paige');

  return jsonb_build_object('ok', true, 'message_id', p_message_id, 'label', p_label);
end;
$$;

create or replace function public.remove_message_label(
  p_message_id uuid,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_user_tenant_id();
  v_message record;
  v_connector record;
begin
  select m.tenant_id, m.connector_id into v_message from public.messages m where m.id = p_message_id;
  if not found or v_message.tenant_id is distinct from v_tenant then
    return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_IN_WORKSPACE');
  end if;

  if v_message.connector_id is not null then
    select cc.mailbox_class, cc.mailbox_owner_user_id into v_connector
      from public.channel_connectors cc where cc.id = v_message.connector_id;
    if v_connector.mailbox_class = 'personal'
       and v_connector.mailbox_owner_user_id is distinct from auth.uid()
       and not public.is_platform_owner() then
      return jsonb_build_object('ok', false, 'code', 'PERSONAL_MAILBOX_NOT_OWNER');
    end if;
  end if;

  delete from public.message_labels where message_id = p_message_id and label = p_label;
  return jsonb_build_object('ok', true, 'message_id', p_message_id, 'label', p_label, 'removed', true);
end;
$$;

revoke all on function public.apply_message_label(uuid, text, text) from public, anon;
grant execute on function public.apply_message_label(uuid, text, text) to authenticated;
revoke all on function public.remove_message_label(uuid, text) from public, anon;
grant execute on function public.remove_message_label(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Support case reads + follow-up verbs (tenant staff)
-- -----------------------------------------------------------------------------
create or replace function public.read_support_cases(
  p_status text default null,
  p_include_followups boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Authorization contract (owner adjudication 6088433197 item 2): support cases
  -- carry per-thread subjects and intents — the SAME admin-only gate the table's
  -- own RLS enforces. A plain tenant member is refused explicitly, not merely
  -- chat-seat-restricted; direct authenticated RPC access cannot widen it.
  if not public.is_platform_owner()
     and not public.has_any_role(auth.uid(), array['admin']) then
    return jsonb_build_object('ok', false, 'code', 'WORKSPACE_ROLE_REQUIRED');
  end if;
  return coalesce(jsonb_agg(t), '[]'::jsonb) from (
    select jsonb_build_object(
             'id', s.id,
             'thread_key', s.thread_key,
             'contact_id', s.contact_id,
             'status', s.status,
             'last_intent', s.last_intent,
             'last_risk_tier', s.last_risk_tier,
             'last_inbound_at', s.last_inbound_at,
             'last_outbound_at', s.last_outbound_at,
             'next_followup_at', s.next_followup_at,
             'followup_count', s.followup_count,
             'followup_cancelled_at', s.followup_cancelled_at,
             'subject', (
               select left(coalesce(m.subject, '(no subject)'), 120)
               from public.messages m
               where m.tenant_id = s.tenant_id and m.thread_key = s.thread_key
               order by m.sent_at desc nulls last, m.created_at desc
               limit 1
             )
           ) as t
    from public.support_cases s
    where s.tenant_id = public.current_user_tenant_id()
      and (p_status is null or s.status = p_status)
      and (
        p_include_followups is distinct from true
        or (s.next_followup_at is not null and s.status in ('open','awaiting_owner'))
      )
    order by s.next_followup_at nulls last, s.last_inbound_at desc nulls last
    limit 50
  ) s;
end;
$$;

revoke all on function public.read_support_cases(text, boolean) from public, anon;
grant execute on function public.read_support_cases(text, boolean) to authenticated;

create or replace function public.cancel_support_followup(
  p_case_id uuid,
  p_reason text default 'owner_cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_user_tenant_id();
begin
  update public.support_cases
     set next_followup_at = null,
         followup_cancelled_at = now(),
         updated_at = now()
   where id = p_case_id and tenant_id = v_tenant
   returning id into p_case_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CASE_NOT_IN_WORKSPACE');
  end if;
  return jsonb_build_object('ok', true, 'case_id', p_case_id, 'reason', p_reason);
end;
$$;

revoke all on function public.cancel_support_followup(uuid, text) from public, anon;
grant execute on function public.cancel_support_followup(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. Sync-state read (inspection: "what did Paige do with my inbox")
-- -----------------------------------------------------------------------------
create or replace function public.read_mailbox_sync_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(t), '[]'::jsonb) from (
    select jsonb_build_object(
             'connector_id', s.connector_id,
             'mailbox_class', s.mailbox_class,
             'provider', c.provider,
             'address', c.inbound_address,
             'owner_only', (s.mailbox_class = 'personal'),
             'last_history_id', s.last_history_id,
             'last_sync_at', s.last_sync_at,
             'last_sync_status', s.last_sync_status,
             'initial_sync_completed_at', s.initial_sync_completed_at,
             'last_error', s.last_error
           ) as t
    from public.mailbox_sync_state s
    join public.channel_connectors c on c.id = s.connector_id
    where s.tenant_id = public.current_user_tenant_id()
      and (
        s.mailbox_class <> 'personal'
        or public.is_platform_owner()
        or c.mailbox_owner_user_id = auth.uid()
      )
    order by s.last_sync_at desc nulls last
  ) s;
$$;

revoke all on function public.read_mailbox_sync_state() from public, anon;
grant execute on function public.read_mailbox_sync_state() to authenticated;

-- -----------------------------------------------------------------------------
-- 12. Service-role engine verbs (the ONE inbound intelligence engine both
--     mailbox paths call: Resend inbound and the Gmail sync)
-- -----------------------------------------------------------------------------
create or replace function public.record_inbound_message_intelligence(
  _message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  msg record;
  conn record;
  v_case public.support_cases%rowtype;
begin
  select msg.* into msg from public.messages msg where msg.id = _message_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND'); end if;

  select cc.id, cc.tenant_id, cc.mailbox_class into conn
    from public.channel_connectors cc where cc.id = msg.connector_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'CONNECTOR_NOT_FOUND'); end if;

  -- Personal mailboxes NEVER open support cases: the private/shared boundary is
  -- enforced by the engine itself, not by caller discipline.
  if conn.mailbox_class = 'personal' then
    return jsonb_build_object('ok', true, 'mailbox_class', 'personal', 'case_opened', false);
  end if;

  -- ONE race-free upsert (webhook retries and near-simultaneous customer mails
  -- both land here; SELECT-then-INSERT would lose one side's state).
  -- The customer replied: any pending follow-up is cancelled NOW; a LATER inbound
  -- re-arms the thread because refresh_support_followups compares cancelled_at
  -- against last_inbound_at (new inbound outranks an old cancellation).
  insert into public.support_cases (tenant_id, connector_id, thread_key, contact_id, status, last_inbound_at)
  values (conn.tenant_id, conn.id, msg.thread_key, msg.contact_id, 'awaiting_owner', msg.sent_at)
  on conflict (tenant_id, connector_id, thread_key) do update
    set status = case when public.support_cases.status in ('resolved','closed') then 'open' else 'awaiting_owner' end,
        last_inbound_at = excluded.last_inbound_at,
        contact_id = coalesce(public.support_cases.contact_id, excluded.contact_id),
        next_followup_at = null,
        followup_cancelled_at = case when public.support_cases.next_followup_at is not null then now()
                                     else public.support_cases.followup_cancelled_at end,
        updated_at = now()
  returning * into v_case;

  return jsonb_build_object('ok', true, 'mailbox_class', 'shared_support',
                            'case_id', v_case.id, 'case_opened', true);
end;
$$;

create or replace function public.apply_message_classification(
  _message_id uuid,
  _intent text,
  _confidence numeric,
  _summary text,
  _model_route jsonb,
  _labels jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  msg record;
  conn record;
  v_risk text;
begin
  select msg.* into msg from public.messages msg where msg.id = _message_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND'); end if;

  select cc.tenant_id, cc.mailbox_class into conn
    from public.channel_connectors cc where cc.id = msg.connector_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'CONNECTOR_NOT_FOUND'); end if;

  v_risk := case when _intent in ('billing','refund','account_access','security','legal') then 'elevated' else 'routine' end;

  insert into public.message_classifications (tenant_id, message_id, mailbox_class, mailbox_owner_user_id, intent, confidence, risk_tier, summary, model_route)
  values (conn.tenant_id, _message_id, conn.mailbox_class, conn.mailbox_owner_user_id, _intent,
          least(greatest(coalesce(_confidence, 0), 0), 1), v_risk,
          left(_summary, 280), coalesce(_model_route, '{}'::jsonb))
  on conflict (message_id) do update
    set intent = excluded.intent, confidence = excluded.confidence, risk_tier = excluded.risk_tier,
        summary = excluded.summary, model_route = excluded.model_route, decided_at = now();

  if conn.mailbox_class = 'shared_support' then
    update public.support_cases s
       set last_intent = _intent, last_risk_tier = v_risk, updated_at = now()
     where s.tenant_id = conn.tenant_id and s.connector_id = msg.connector_id and s.thread_key = msg.thread_key;
  end if;

  if _labels is not null then
    insert into public.message_labels (tenant_id, message_id, label, source, mailbox_class, mailbox_owner_user_id)
    select conn.tenant_id, _message_id, l::text, 'auto', conn.mailbox_class, conn.mailbox_owner_user_id
      from jsonb_array_elements_text(_labels) l
    on conflict (message_id, label) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'intent', _intent, 'risk_tier', v_risk);
end;
$$;

create or replace function public.refresh_support_followups(
  _stale_after_hours integer default 24
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Unresolved cases with no owner reply past the threshold get ONE tracked
  -- follow-up. Bounded: max 5 per case lifetime; cancelled the moment the
  -- customer replies (record_inbound_message_intelligence). Never auto-sends:
  -- surfacing + proposing is this engine's job, sending stays the approved door's.
  with due as (
    update public.support_cases s
       set next_followup_at = least(s.last_inbound_at + make_interval(hours => _stale_after_hours), now() + interval '1 minute'),
           followup_count = s.followup_count + 1,
           updated_at = now()
     where s.status in ('open','awaiting_owner')
       and s.next_followup_at is null
       and (s.followup_cancelled_at is null or s.followup_cancelled_at < s.last_inbound_at)
       and s.followup_count < 5
       and s.last_inbound_at < now() - make_interval(hours => _stale_after_hours)
    returning 1
  )
  select count(*) into v_count from due;
  return v_count;
end;
$$;

create or replace function public.mark_support_case_outbound(
  _message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  msg record;
  v_case_id uuid;
begin
  select msg.* into msg from public.messages msg where msg.id = _message_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND'); end if;

  -- Recency guard: only the LATEST word settles the case. A replayed settle of an
  -- older send must never outrank a newer customer reply (the inbound path cancels
  -- the follow-up and reopens the case; flipping it back here would misreport who
  -- owes the reply and suppress the one bounded follow-up).
  update public.support_cases s
     set status = 'awaiting_customer',
         last_outbound_at = msg.sent_at,
         next_followup_at = null,
         updated_at = now()
   where s.tenant_id = msg.tenant_id and s.connector_id = msg.connector_id and s.thread_key = msg.thread_key
     and msg.connector_id is not null
     and (s.last_inbound_at is null or s.last_inbound_at <= msg.sent_at)
   returning s.id into v_case_id;
  if not found then return jsonb_build_object('ok', true, 'case_updated', false); end if;
  return jsonb_build_object('ok', true, 'case_updated', true);
end;
$$;

revoke all on function public.record_inbound_message_intelligence(uuid) from public, anon, authenticated;
grant execute on function public.record_inbound_message_intelligence(uuid) to service_role;
revoke all on function public.apply_message_classification(uuid, text, numeric, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_message_classification(uuid, text, numeric, text, jsonb, jsonb) to service_role;
revoke all on function public.refresh_support_followups(integer) from public, anon, authenticated;
grant execute on function public.refresh_support_followups(integer) to service_role;
revoke all on function public.mark_support_case_outbound(uuid) from public, anon, authenticated;
grant execute on function public.mark_support_case_outbound(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 13. record_mailbox_organize — the canonical mirror + undo window for one
--     approved organize command (service-only; the door calls it AFTER the
--     provider write answers). Undo state is what makes trash reversible here.
-- -----------------------------------------------------------------------------
create or replace function public.record_mailbox_organize(
  _message_id uuid,
  _kind text,
  _label text default null,
  _actor_user_id uuid default null,
  _provider_result jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  msg record;
begin
  select msg.* into msg from public.messages msg where msg.id = _message_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND'); end if;

  if _kind in ('label','unlabel') then
    if _kind = 'label' then
      insert into public.message_labels (tenant_id, message_id, label, source, applied_by, mailbox_class, mailbox_owner_user_id)
      values (msg.tenant_id, _message_id, _label, 'paige', _actor_user_id,
              coalesce((select cc.mailbox_class from public.channel_connectors cc where cc.id = msg.connector_id), 'shared_support'),
              (select cc.mailbox_owner_user_id from public.channel_connectors cc where cc.id = msg.connector_id))
      on conflict (message_id, label) do update
        set source = excluded.source, applied_by = excluded.applied_by
        where public.message_labels.source = 'auto';
    else
      delete from public.message_labels
       where message_id = _message_id and label = _label and source <> 'owner';
    end if;
  end if;

  update public.messages
     set meta = coalesce(meta, '{}'::jsonb)
       || jsonb_build_object(
            case _kind
              when 'archive' then 'gmail_archived_at'
              when 'unarchive' then 'gmail_unarchived_at'
              when 'trash' then 'gmail_trashed_at'
              when 'untrash' then 'gmail_untrashed_at'
              when 'unsubscribe_propose' then 'unsubscribe_proposed_at'
              when 'unsubscribe_send' then 'unsubscribe_sent_at'
              else 'gmail_organized_at'
            end, now(),
            'last_organize_kind', _kind,
            'last_organize_by', _actor_user_id,
            'last_organize_provider_result', _provider_result
          ),
         updated_at = now()
   where id = _message_id;

  return jsonb_build_object('ok', true, 'message_id', _message_id, 'kind', _kind,
                            'undo_kind', case _kind
                              when 'archive' then 'unarchive' when 'unarchive' then 'archive'
                              when 'trash' then 'untrash' when 'untrash' then 'trash'
                              when 'label' then 'unlabel' when 'unlabel' then 'label'
                              else null end);
end;
$$;

revoke all on function public.record_mailbox_organize(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_mailbox_organize(uuid, text, text, uuid, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- 14. record_mailbox_sync_outcome — the sync cursor writer (service-only, the
--     engine's single write path; an idempotent upsert, never a queue).
-- -----------------------------------------------------------------------------
create or replace function public.record_mailbox_sync_outcome(
  _connector_id uuid,
  _status text,
  _error text default null,
  _history_id bigint default null,
  _initial_completed boolean default null,
  _last_message_date timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_connector record;
begin
  select cc.tenant_id, cc.mailbox_class into v_connector
    from public.channel_connectors cc where cc.id = _connector_id;
  if not found then return false; end if;

  insert into public.mailbox_sync_state
    (connector_id, tenant_id, mailbox_class, last_history_id, last_message_internal_date,
     initial_sync_completed_at, last_sync_at, last_sync_status, last_error)
  values (_connector_id, v_connector.tenant_id, v_connector.mailbox_class, _history_id, _last_message_date,
          case when _initial_completed then now() else null end, now(), _status, _error)
  on conflict (connector_id) do update
    set last_history_id = coalesce(excluded.last_history_id, public.mailbox_sync_state.last_history_id),
        last_message_internal_date = coalesce(excluded.last_message_internal_date, public.mailbox_sync_state.last_message_internal_date),
        initial_sync_completed_at = coalesce(public.mailbox_sync_state.initial_sync_completed_at, excluded.initial_sync_completed_at),
        last_sync_at = now(),
        last_sync_status = excluded.last_sync_status,
        last_error = excluded.last_error,
        updated_at = now();
  return true;
end;
$$;

revoke all on function public.record_mailbox_sync_outcome(uuid, text, text, bigint, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.record_mailbox_sync_outcome(uuid, text, text, bigint, boolean, timestamptz) to service_role;

-- -----------------------------------------------------------------------------
-- 15. mark_message_removed_by_provider — SOFT removal that MERGES into meta
--     (a whole-column update would destroy the recorded List-Unsubscribe target
--     and Gmail metadata the thread's truthful history depends on).
-- -----------------------------------------------------------------------------
create or replace function public.mark_message_removed_by_provider(
  _tenant_id uuid,
  _connector_id uuid,
  _provider_message_id text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.messages
       set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('gmail_removed_at', now()),
           updated_at = now()
     where tenant_id = _tenant_id
       and connector_id = _connector_id
       and provider_message_id = _provider_message_id
    returning 1
  )
  select exists(select 1 from updated);
$$;

revoke all on function public.mark_message_removed_by_provider(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_message_removed_by_provider(uuid, uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 16. The sync engine's cron schedule (the comms-scheduled-drain pattern:
--     vaulted cron token header, unschedule-if-exists, five-minute cadence).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'gmail-mailbox-sync') then
    perform cron.unschedule('gmail-mailbox-sync');
  end if;
end $$;

select cron.schedule(
  'gmail-mailbox-sync',
  '*/5 * * * *',
  $$
    select net.http_post(
      url     := 'https://xygzykjyynhzqytbqnzu.supabase.co/functions/v1/gmail-mailbox-sync',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'x-cron-token', public.cron_token_header()
                 ),
      body    := '{}'::jsonb
    );
  $$
);

-- -----------------------------------------------------------------------------
-- 17. Trust catalogue admission (#1140): the one new governed tool the operator
--     can see and turn off (the sales_merchant catalogue pattern — rename the
--     incumbent, forward its rows, add the new row; no existing setting changes).
-- -----------------------------------------------------------------------------
DO $$ BEGIN
 IF to_regprocedure('public._list_tool_autonomy_before_inbox_intelligence(uuid)') IS NULL THEN
  ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_inbox_intelligence;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_inbox_intelligence(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_inbox_intelligence(uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_inbox_intelligence(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id; END IF;
 ELSE tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('gmail_organize','Organize a connected Gmail mailbox','Communications')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;
