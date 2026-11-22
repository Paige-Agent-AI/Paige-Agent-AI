begin;

alter table public.solo_beta_protected_checkout_attempts
  add column provider_state text check (provider_state in (
    'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'
  )),
  add column provider_state_event_at timestamptz,
  add column provider_cancel_at_period_end boolean;

create function public.solo_beta_record_protected_lifecycle(
  _reference_id uuid, _stripe_subscription_id text, _stripe_customer_id text,
  _provider_livemode boolean, _state text, _cancel_at_period_end boolean, _event_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _attempt public.solo_beta_protected_checkout_attempts;
begin
  if _state is null or _state not in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')
    or _event_at is null or _cancel_at_period_end is null then return false; end if;

  select * into _attempt from public.solo_beta_protected_checkout_attempts
  where reference_id = _reference_id and stripe_subscription_id = _stripe_subscription_id
    and stripe_customer_id = _stripe_customer_id and provider_livemode = _provider_livemode for update;
  if not found then return false; end if;

  -- Canceled Stripe subscriptions are terminal. A delayed event cannot restore
  -- one. An older nonterminal event also cannot replace more recent evidence.
  if _attempt.provider_state = 'canceled' or
    (_state <> 'canceled' and _attempt.provider_state_event_at > _event_at) then return true; end if;

  update public.solo_beta_protected_checkout_attempts
  set provider_state = _state, provider_cancel_at_period_end = _cancel_at_period_end,
    provider_state_event_at = greatest(_attempt.provider_state_event_at, _event_at)
  where reference_id = _reference_id;
  return true;
end;
$$;

revoke all on function public.solo_beta_record_protected_lifecycle(uuid,text,text,boolean,text,boolean,timestamptz)
  from public, anon, authenticated;
grant execute on function public.solo_beta_record_protected_lifecycle(uuid,text,text,boolean,text,boolean,timestamptz)
  to service_role;

commit;
