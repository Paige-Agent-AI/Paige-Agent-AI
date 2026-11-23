begin;

-- The protected setup event arrives before the application has an Auth owner
-- or a Stripe subscription. Attach its provenance to the existing attempt
-- after the signed webhook verifies the exact provider trial.
alter table public.solo_beta_protected_checkout_attempts
  add column checkout_event_id text unique,
  add column checkout_event_created_at timestamptz,
  add column checkout_event_digest text,
  add constraint solo_beta_protected_checkout_event_complete check (
    (checkout_event_id is null and checkout_event_created_at is null and checkout_event_digest is null)
    or (
      checkout_event_id is not null and checkout_event_id ~ '^evt_[A-Za-z0-9]+$'
      and checkout_event_created_at is not null and checkout_event_digest is not null
      and checkout_event_digest ~ '^[0-9a-f]{64}$' and stripe_subscription_id is not null
    )
  );

create function public.solo_beta_bind_protected_checkout_event(
  _checkout_id text, _subscription_id text, _livemode boolean,
  _event_id text, _event_created_at timestamptz, _event_digest text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _attempt public.solo_beta_protected_checkout_attempts;
begin
  if _event_id is null or _event_id !~ '^evt_[A-Za-z0-9]+$'
    or _event_created_at is null or _event_digest is null or _event_digest !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  select a.* into _attempt
  from public.solo_beta_protected_checkout_attempts a
  join public.solo_beta_protected_signup_intake i on i.reference_id = a.reference_id
    and i.provider_livemode = a.provider_livemode and i.stripe_price_id = a.stripe_price_id
    and i.stripe_product_id = a.stripe_product_id
  where a.stripe_checkout_id = _checkout_id and a.stripe_subscription_id = _subscription_id
    and a.provider_livemode = _livemode
    and a.provider_livemode = (i.return_origin <> 'http://localhost:5173')
  for update of a;
  if not found then return false; end if;

  if _attempt.checkout_event_id is not null then
    -- The first receipt is permanent. A different valid delivery for this
    -- Checkout must not replace it or reuse the event of another attempt.
    if _attempt.checkout_event_id = _event_id then
      return _attempt.checkout_event_digest = _event_digest
        and _attempt.checkout_event_created_at = _event_created_at;
    end if;
    return not exists (
      select 1 from public.solo_beta_protected_checkout_attempts a where a.checkout_event_id = _event_id
    );
  end if;

  update public.solo_beta_protected_checkout_attempts
  set checkout_event_id = _event_id, checkout_event_created_at = _event_created_at,
    checkout_event_digest = _event_digest
  where reference_id = _attempt.reference_id;
  return found;
exception when unique_violation then
  return false;
end;
$$;

revoke all on function public.solo_beta_bind_protected_checkout_event(text,text,boolean,text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.solo_beta_bind_protected_checkout_event(text,text,boolean,text,timestamptz,text)
  to service_role;

commit;
