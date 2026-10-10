-- =============================================================================
-- ANT-38 / #1140 — mailbox authority becomes TENANT-scoped (least privilege).
--
-- Defect 1 (owner-named): every mailbox read gate used has_any_role(uid,
-- array['admin']) — the GLOBAL user_roles table. An ordinary Solo owner
-- (tenant_members.role='owner', global role 'user') was refused their own
-- business inbox by messages RLS, read_message_content, read_support_cases and
-- the labels/classifications/support-cases/sync-state policies, while the
-- governed send door correctly admits tenant owner|admin. Correction: the same
-- tenant-scoped shape the invoice policies and the door use —
-- public.is_tenant_admin(tenant_id) (SECURITY DEFINER over active
-- tenant_members owner|admin) — with platform owner preserved and every
-- personal-mailbox predicate byte-identical.
--
-- Defect 2 (found by this slice's failing-first test): the deployed
-- read_message_content body collides a plpgsql variable with its query alias
-- (`select msg.* into msg from public.messages msg` → ERROR "column reference
-- msg.* is ambiguous") — the RPC errors instead of answering. Never exercised
-- because no mailbox is connected. Fixed with clean variable names.
--
-- No global-role promotions, no account-specific exceptions, no weakened RLS:
-- every negative that held before still holds (plain member, foreign tenant,
-- wrong workspace, personal-mailbox owner-only, agency parent without child
-- membership, revoked connector).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. messages RLS — tenant-scoped authority, personal predicate unchanged
-- -----------------------------------------------------------------------------
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.is_tenant_admin(tenant_id)
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
      and public.is_tenant_admin(tenant_id)
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
      and public.is_tenant_admin(tenant_id)
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

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.is_tenant_admin(tenant_id)
    )
  );

-- -----------------------------------------------------------------------------
-- 2. The #1880 satellite tables — same substitution, predicates unchanged
-- -----------------------------------------------------------------------------
drop policy if exists message_labels_select on public.message_labels;
create policy message_labels_select on public.message_labels
  for select using (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.is_tenant_admin(tenant_id)
      and (
        mailbox_class <> 'personal'
        or mailbox_owner_user_id = auth.uid()
      )
    )
  );

drop policy if exists message_classifications_select on public.message_classifications;
create policy message_classifications_select on public.message_classifications
  for select using (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.is_tenant_admin(tenant_id)
      and (
        mailbox_class <> 'personal'
        or mailbox_owner_user_id = auth.uid()
      )
    )
  );

drop policy if exists support_cases_select on public.support_cases;
create policy support_cases_select on public.support_cases
  for select using (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.is_tenant_admin(tenant_id)
    )
  );

drop policy if exists mailbox_sync_state_select on public.mailbox_sync_state;
create policy mailbox_sync_state_select on public.mailbox_sync_state
  for select using (
    public.is_platform_owner()
    or (
      tenant_id = public.current_user_tenant_id()
      and public.is_tenant_admin(tenant_id)
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

-- -----------------------------------------------------------------------------
-- 3. read_message_content — clean variables (fixes the runtime ambiguity
--    error) + the tenant-scoped authority gate
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
  v_msg record;
  v_class text;
  v_owner uuid;
  v_status text;
  v_active boolean;
  v_tenant uuid := public.current_user_tenant_id();
begin
  select m.* into v_msg from public.messages m where m.id = p_message_id;
  if not found then return null; end if;
  if v_msg.tenant_id is distinct from v_tenant then return null; end if;

  if v_msg.connector_id is null then
    -- A row with no connector was never a synced mailbox message; tenant
    -- authority (checked below) is the gate.
    v_class := 'shared_support'; v_owner := null; v_status := 'active'; v_active := true;
  else
    select cc.mailbox_class, cc.mailbox_owner_user_id, cc.status, cc.active
      into v_class, v_owner, v_status, v_active
      from public.channel_connectors cc where cc.id = v_msg.connector_id;
    if not found then return null; end if;
  end if;

  -- Revoked or disconnected consent refuses the read, fail-closed.
  if v_status <> 'active' or v_active is not true then
    return jsonb_build_object('ok', false, 'code', 'MAILBOX_INACTIVE');
  end if;

  if v_class = 'personal' then
    if v_owner is null or v_owner <> auth.uid() then
      if not public.is_platform_owner() then
        return jsonb_build_object('ok', false, 'code', 'PERSONAL_MAILBOX_NOT_OWNER');
      end if;
    end if;
  else
    -- ANT-38: TENANT-scoped authority (owner|admin of THIS tenant), not the
    -- global admin role. Platform owner preserved.
    if not public.is_tenant_admin(v_tenant) and not public.is_platform_owner() then
      return jsonb_build_object('ok', false, 'code', 'WORKSPACE_ROLE_REQUIRED');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_msg.id,
    'direction', v_msg.direction,
    'channel', v_msg.channel_type,
    'mailbox_class', v_class,
    'subject', v_msg.subject,
    'status', v_msg.status,
    'contact_id', v_msg.contact_id,
    'thread_key', v_msg.thread_key,
    'sender', v_msg.sender,
    'body_text', left(v_msg.body_text, 8000),
    'body_truncated', coalesce(length(v_msg.body_text), 0) > 8000,
    'labels', coalesce((
      select jsonb_agg(jsonb_build_object('label', l.label, 'source', l.source) order by l.label)
      from public.message_labels l where l.message_id = v_msg.id
    ), '[]'::jsonb),
    'classification', (
      select jsonb_build_object('intent', k.intent, 'confidence', k.confidence,
                                'risk_tier', k.risk_tier, 'summary', k.summary, 'decided_at', k.decided_at)
      from public.message_classifications k where k.message_id = v_msg.id
    ),
    'unsubscribe', v_msg.meta ? 'list_unsubscribe',
    'sent_at', v_msg.sent_at,
    'created_at', v_msg.created_at
  );
end;
$$;

revoke all on function public.read_message_content(uuid) from public, anon;
grant execute on function public.read_message_content(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. read_support_cases — the same tenant-scoped gate
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
  -- ANT-38: TENANT-scoped authority (owner|admin of THIS tenant), matching the
  -- table's own RLS and the governed send door — an ordinary Solo owner with a
  -- global 'user' role is ADMITTED; a plain member is explicitly refused.
  if not public.is_tenant_admin(public.current_user_tenant_id())
     and not public.is_platform_owner() then
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
