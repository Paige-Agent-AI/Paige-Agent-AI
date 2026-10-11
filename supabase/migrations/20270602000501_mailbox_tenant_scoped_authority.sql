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
-- wrong workspace, personal-mailbox owner-only, agency parent holding only a child member standing, revoked connector).
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

-- -----------------------------------------------------------------------------
-- 5. The four sibling engine functions carry the SAME variable/alias collision
--    read_message_content had (select msg.* into msg from ... msg — ERROR
--    "column reference msg.* is ambiguous" on first real use). Re-emitted with
--    clean variables; logic otherwise identical to 20270602000201.
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
  v_msg record;
  v_conn record;
  v_case public.support_cases%rowtype;
begin
  select m.* into v_msg from public.messages m where m.id = _message_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND'); end if;

  select cc.id, cc.tenant_id, cc.mailbox_class into v_conn
    from public.channel_connectors cc where cc.id = v_msg.connector_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'CONNECTOR_NOT_FOUND'); end if;

  if v_conn.mailbox_class = 'personal' then
    return jsonb_build_object('ok', true, 'mailbox_class', 'personal', 'case_opened', false);
  end if;

  insert into public.support_cases (tenant_id, connector_id, thread_key, contact_id, status, last_inbound_at)
  values (v_conn.tenant_id, v_conn.id, v_msg.thread_key, v_msg.contact_id, 'awaiting_owner', v_msg.sent_at)
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

revoke all on function public.record_inbound_message_intelligence(uuid) from public, anon, authenticated;
grant execute on function public.record_inbound_message_intelligence(uuid) to service_role;

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
  v_msg record;
  v_conn record;
  v_risk text;
begin
  select m.* into v_msg from public.messages m where m.id = _message_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND'); end if;

  select cc.tenant_id, cc.mailbox_class, cc.mailbox_owner_user_id into v_conn
    from public.channel_connectors cc where cc.id = v_msg.connector_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'CONNECTOR_NOT_FOUND'); end if;

  v_risk := case when _intent in ('billing','refund','account_access','security','legal') then 'elevated' else 'routine' end;

  insert into public.message_classifications (tenant_id, message_id, mailbox_class, mailbox_owner_user_id, intent, confidence, risk_tier, summary, model_route)
  values (v_conn.tenant_id, _message_id, v_conn.mailbox_class, v_conn.mailbox_owner_user_id, _intent,
          least(greatest(coalesce(_confidence, 0), 0), 1), v_risk,
          left(_summary, 280), coalesce(_model_route, '{}'::jsonb))
  on conflict (message_id) do update
    set intent = excluded.intent, confidence = excluded.confidence, risk_tier = excluded.risk_tier,
        summary = excluded.summary, model_route = excluded.model_route, decided_at = now();

  if v_conn.mailbox_class = 'shared_support' then
    update public.support_cases sc
       set last_intent = _intent, last_risk_tier = v_risk, updated_at = now()
     where sc.tenant_id = v_conn.tenant_id and sc.connector_id = v_msg.connector_id and sc.thread_key = v_msg.thread_key;
  end if;

  if _labels is not null then
    insert into public.message_labels (tenant_id, message_id, label, source, mailbox_class, mailbox_owner_user_id)
    select v_conn.tenant_id, _message_id, l::text, 'auto', v_conn.mailbox_class, v_conn.mailbox_owner_user_id
      from jsonb_array_elements_text(_labels) l
    on conflict (message_id, label) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'intent', _intent, 'risk_tier', v_risk);
end;
$$;

revoke all on function public.apply_message_classification(uuid, text, numeric, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_message_classification(uuid, text, numeric, text, jsonb, jsonb) to service_role;

create or replace function public.mark_support_case_outbound(
  _message_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg record;
  v_case_id uuid;
begin
  select m.* into v_msg from public.messages m where m.id = _message_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND'); end if;

  update public.support_cases s
     set status = 'awaiting_customer',
         last_outbound_at = v_msg.sent_at,
         next_followup_at = null,
         updated_at = now()
   where s.tenant_id = v_msg.tenant_id and s.connector_id = v_msg.connector_id and s.thread_key = v_msg.thread_key
     and v_msg.connector_id is not null
     and (s.last_inbound_at is null or s.last_inbound_at <= v_msg.sent_at)
   returning s.id into v_case_id;
  if not found then return jsonb_build_object('ok', true, 'case_updated', false); end if;
  return jsonb_build_object('ok', true, 'case_updated', true);
end;
$$;

revoke all on function public.mark_support_case_outbound(uuid) from public, anon, authenticated;
grant execute on function public.mark_support_case_outbound(uuid) to service_role;

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
  v_msg record;
begin
  select m.* into v_msg from public.messages m where m.id = _message_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND'); end if;

  if _kind in ('label','unlabel') then
    if _kind = 'label' then
      insert into public.message_labels (tenant_id, message_id, label, source, applied_by, mailbox_class, mailbox_owner_user_id)
      values (v_msg.tenant_id, _message_id, _label, 'paige', _actor_user_id,
              coalesce((select cc.mailbox_class from public.channel_connectors cc where cc.id = v_msg.connector_id), 'shared_support'),
              (select cc.mailbox_owner_user_id from public.channel_connectors cc where cc.id = v_msg.connector_id))
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
