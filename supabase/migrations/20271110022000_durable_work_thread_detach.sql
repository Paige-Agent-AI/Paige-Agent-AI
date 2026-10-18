-- Honor the existing thread FK's ON DELETE SET NULL without making thread identity mutable.
-- The parent-presence read runs as the existing function owner so an RLS-hidden live thread
-- cannot look deleted. This internal trigger gains SECURITY DEFINER, not a callable grant.
-- CREATE OR REPLACE preserves its owner, ABI, ACL and existing canonical trigger binding.
create or replace function public._paige_durable_work_protect_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_relid is distinct from 'public.paige_durable_work'::regclass
     or tg_op <> 'UPDATE' or tg_when <> 'BEFORE' or tg_level <> 'ROW' then
    raise exception 'DURABLE_WORK_TRIGGER_BINDING_INVALID' using errcode = '22023';
  end if;

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.initiating_user_id is distinct from old.initiating_user_id
     or new.intent_id is distinct from old.intent_id
     or new.capability_key is distinct from old.capability_key
     or new.work_kind is distinct from old.work_kind
     or new.authority_context is distinct from old.authority_context
     or new.scope_epoch is distinct from old.scope_epoch
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at
     or (old.request_payload is not null and new.request_payload is distinct from old.request_payload) then
    raise exception 'DURABLE_WORK_IDENTITY_IMMUTABLE' using errcode = '22023';
  end if;

  if new.thread_id is distinct from old.thread_id then
    if old.thread_id is null or new.thread_id is not null then
      raise exception 'DURABLE_WORK_IDENTITY_IMMUTABLE' using errcode = '22023';
    end if;
    -- Fail closed even if a future function-owner change makes RLS apply to this read.
    if pg_catalog.row_security_active('public.paige_chat_threads'::regclass) then
      raise exception 'DURABLE_WORK_PARENT_VISIBILITY_REQUIRED' using errcode = '42501';
    end if;
    if exists (select 1 from public.paige_chat_threads t where t.id = old.thread_id) then
      raise exception 'DURABLE_WORK_IDENTITY_IMMUTABLE' using errcode = '22023';
    end if;
    -- Retain the incumbent deletion hold while work can still dispatch, settle or reconcile.
    if old.status not in ('succeeded','failed','cancelled')
       or old.settled_at is null or old.terminal_outcome is null
       or (old.status = 'succeeded' and old.terminal_outcome->>'verified_readback' is distinct from 'true')
       -- Successful Document replay still requires its existing completion turn.
       or (old.work_kind = 'document_authoring' and old.status = 'succeeded')
       or new.status is distinct from old.status
       or new.settled_at is distinct from old.settled_at
       or new.terminal_outcome is distinct from old.terminal_outcome then
      raise exception 'DURABLE_WORK_IDENTITY_IMMUTABLE' using errcode = '22023';
    end if;
    -- Under the existing immediate FK, a referenced parent becomes absent during its DELETE.
    -- Only compatible settled work may detach; this is never caller or execution authority.
  end if;
  return new;
end
$$;
