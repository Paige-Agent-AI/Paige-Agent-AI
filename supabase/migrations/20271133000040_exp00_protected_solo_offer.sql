begin;

-- Keep the original price valid for existing cohorts. The protected checkout
-- is a separate offer and remains unavailable until its provider binding is
-- installed and verified by the release workflow.
alter table public.platform_subscription_offers
  add constraint platform_subscription_offers_amount_by_version_check
  check (unit_amount_cents = case
    when offer_code = 'paige-solo-beta-monthly-v2' then 9700
    else 7450
  end) not valid;

alter table public.platform_subscription_offers
  validate constraint platform_subscription_offers_amount_by_version_check;

alter table public.platform_subscription_offers
  drop constraint platform_subscription_offers_unit_amount_cents_check;

insert into public.platform_subscription_offers (
  offer_code, plan_id, account_type, provider_mode, stripe_account,
  unit_amount_cents, currency, billing_interval, interval_count, trial_days, status
)
select 'paige-solo-beta-monthly-v2', plan_id, account_type, provider_mode, stripe_account,
  9700, currency, billing_interval, interval_count, trial_days, 'configuration_required'
from public.platform_subscription_offers
where offer_code = 'paige-solo-beta-monthly-v1';

do $$
begin
  if not exists (
    select 1 from public.platform_subscription_offers
    where offer_code = 'paige-solo-beta-monthly-v2'
      and unit_amount_cents = 9700 and status = 'configuration_required'
  ) then
    raise exception 'solo_beta_protected_offer_seed_missing';
  end if;
end $$;

commit;
