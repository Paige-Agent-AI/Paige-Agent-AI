begin;

-- One server-owned provider attempt per protected enrollment. The checkout
-- identity is durable before Stripe can trigger trial creation.
create table public.solo_beta_protected_checkout_attempts (
  reference_id uuid primary key default gen_random_uuid(),
  offer_code text not null default 'paige-solo-beta-monthly-v2'
    references public.platform_subscription_offers(offer_code)
    check (offer_code = 'paige-solo-beta-monthly-v2'),
  provider_livemode boolean not null,
  stripe_customer_id text not null unique,
  stripe_checkout_id text not null unique,
  stripe_price_id text not null,
  stripe_product_id text not null,
  create_started_at timestamptz,
  stripe_subscription_id text unique,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  verification_deadline_at timestamptz,
  last_error_code text,
  observed_subscription_id text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (stripe_subscription_id is null and trial_started_at is null
      and trial_ends_at is null and verification_deadline_at is null)
    or (stripe_subscription_id is not null and create_started_at is not null
      and trial_started_at is not null and trial_ends_at is not null
      and verification_deadline_at is not null
      and trial_ends_at = trial_started_at + interval '720 hours'
      and verification_deadline_at = trial_started_at + interval '72 hours')
  )
);

alter table public.solo_beta_protected_checkout_attempts enable row level security;
alter table public.solo_beta_protected_checkout_attempts force row level security;
revoke all on public.solo_beta_protected_checkout_attempts from public, anon, authenticated, service_role;
grant select on public.solo_beta_protected_checkout_attempts to service_role;
grant insert (reference_id, provider_livemode, stripe_customer_id, stripe_checkout_id, stripe_price_id, stripe_product_id)
  on public.solo_beta_protected_checkout_attempts to service_role;

create function public.solo_beta_claim_protected_trial(_reference_id uuid, _stripe_checkout_id text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.solo_beta_protected_checkout_attempts
    set create_started_at = pg_catalog.clock_timestamp()
    where reference_id = _reference_id and stripe_checkout_id = _stripe_checkout_id
      and create_started_at is null
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke all on function public.solo_beta_claim_protected_trial(uuid, text) from public, anon, authenticated;
grant execute on function public.solo_beta_claim_protected_trial(uuid, text) to service_role;

-- The caller must first read the prior session from Stripe and observe that the
-- bound session expired. Replacement cannot win after a trial-create claim.
create function public.solo_beta_replace_expired_protected_checkout(
  _reference_id uuid, _expired_stripe_checkout_id text, _replacement_stripe_checkout_id text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with replaced as (
    update public.solo_beta_protected_checkout_attempts
    set stripe_checkout_id = _replacement_stripe_checkout_id
    where reference_id = _reference_id and stripe_checkout_id = _expired_stripe_checkout_id
      and create_started_at is null and _replacement_stripe_checkout_id <> _expired_stripe_checkout_id
      and nullif(_replacement_stripe_checkout_id, '') is not null
    returning 1
  )
  select exists (select 1 from replaced);
$$;

revoke all on function public.solo_beta_replace_expired_protected_checkout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.solo_beta_replace_expired_protected_checkout(uuid, text, text) to service_role;

create function public.solo_beta_record_protected_trial(
  _reference_id uuid, _stripe_checkout_id text, _stripe_subscription_id text,
  _trial_started_at timestamptz, _trial_ends_at timestamptz, _verification_deadline_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.solo_beta_protected_checkout_attempts
  set stripe_subscription_id = _stripe_subscription_id, trial_started_at = _trial_started_at,
    trial_ends_at = _trial_ends_at, verification_deadline_at = _verification_deadline_at,
    last_error_code = null, observed_subscription_id = null, last_error_at = null
  where reference_id = _reference_id and stripe_checkout_id = _stripe_checkout_id
    and create_started_at is not null and stripe_subscription_id is null
    and nullif(_stripe_subscription_id, '') is not null;
  if found then return true; end if;

  return exists (
    select 1 from public.solo_beta_protected_checkout_attempts
    where reference_id = _reference_id and stripe_checkout_id = _stripe_checkout_id
      and stripe_subscription_id = _stripe_subscription_id and trial_started_at = _trial_started_at
      and trial_ends_at = _trial_ends_at and verification_deadline_at = _verification_deadline_at
  );
end;
$$;

revoke all on function public.solo_beta_record_protected_trial(uuid, text, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.solo_beta_record_protected_trial(uuid, text, text, timestamptz, timestamptz, timestamptz)
  to service_role;

create function public.solo_beta_record_protected_trial_failure(
  _reference_id uuid, _stripe_checkout_id text, _code text, _observed_subscription_id text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.solo_beta_protected_checkout_attempts
  set last_error_code = _code,
    observed_subscription_id = coalesce(_observed_subscription_id, observed_subscription_id),
    last_error_at = pg_catalog.clock_timestamp()
  where reference_id = _reference_id and stripe_checkout_id = _stripe_checkout_id
    and create_started_at is not null and stripe_subscription_id is null
    and _code in ('trial_reconciliation_conflict', 'subscription_binding_mismatch',
      'subscription_offer_mismatch', 'renewal_guard_unverified', 'zero_trial_invoice_unverified');
$$;

revoke all on function public.solo_beta_record_protected_trial_failure(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.solo_beta_record_protected_trial_failure(uuid, text, text, text) to service_role;

commit;
