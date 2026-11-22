begin;

-- Preserve the installed lifecycle writer and tighten its Stripe ordering.

create or replace function public.solo_beta_sync_protected_workspace_lifecycle(
  _reference_id uuid, _stripe_subscription_id text, _stripe_customer_id text,
  _provider_livemode boolean, _state text, _cancel_at_period_end boolean, _event_at timestamptz,
  _period_start timestamptz, _period_end timestamptz, _paid_current_period boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _intake public.solo_beta_protected_signup_intake;
  _attempt public.solo_beta_protected_checkout_attempts;
  _enrollment public.solo_beta_enrollments;
  _subscription public.platform_subscriptions;
  _membership public.tenant_members;
  _email_confirmed_at timestamptz;
  _confirmed_owner boolean;
  _period_is_current boolean;
  _eligible boolean;
  _hold_updated_at timestamptz;
begin
  if _state is null or _state not in ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')
    or _cancel_at_period_end is null or _event_at is null or _paid_current_period is null
    or (_period_start is null) <> (_period_end is null)
    or (_period_start is not null and _period_start >= _period_end)
    or (_paid_current_period and (_state <> 'active' or _period_start is null)) then return false;
  end if;

  select i.* into _intake from public.solo_beta_protected_signup_intake i
  where i.reference_id = _reference_id and i.provider_livemode = _provider_livemode
    and i.provider_livemode = (i.return_origin <> 'http://localhost:5173')
  for update;
  if not found then return false; end if;

  select a.* into _attempt from public.solo_beta_protected_checkout_attempts a
  where a.reference_id = _intake.reference_id and a.provider_livemode = _intake.provider_livemode
    and a.offer_code = 'paige-solo-beta-monthly-v2'
    and a.stripe_customer_id = _stripe_customer_id and a.stripe_subscription_id = _stripe_subscription_id
    and a.stripe_product_id = _intake.stripe_product_id and a.stripe_price_id = _intake.stripe_price_id
  for update;
  if not found then return false; end if;

  if (_attempt.provider_state = 'canceled' and _state <> 'canceled')
    or (_attempt.provider_state = 'incomplete_expired' and _state not in ('canceled', 'incomplete_expired'))
    or (_state <> 'canceled' and _attempt.provider_state_event_at > _event_at) then return true;
  end if;

  -- With one-second Stripe event timestamps, a delayed contradictory update
  -- must not restore a seat after a newer conservative observation in that
  -- same second. An exact current paid invoice supplies evidence that a bare
  -- active status could not supply.
  if _attempt.provider_state_event_at = _event_at and _attempt.provider_state <> _state
    and (_state = 'trialing' or (_state = 'active' and not _paid_current_period)) then return true;
  end if;

  -- Stripe timestamps have one-second resolution. If snapshots for the same
  -- trial disagree at the same time, keep the hold until a newer read arrives.
  if _attempt.provider_state_event_at = _event_at and _attempt.provider_state = 'trialing'
    and _state = 'trialing' and _attempt.provider_cancel_at_period_end and not _cancel_at_period_end then
    return true;
  end if;

  if not public.solo_beta_record_protected_lifecycle(
    _reference_id, _stripe_subscription_id, _stripe_customer_id, _provider_livemode,
    _state, _cancel_at_period_end, _event_at
  ) then return false; end if;

  -- Provider state may arrive before the browser binds the owner or before
  -- the native workspace exists. The later first provision sees this state.
  select e.* into _enrollment from public.solo_beta_enrollments e
  where e.reference_id = _intake.reference_id and e.user_id = _intake.owner_user_id
    and e.offer_code = _attempt.offer_code and e.stripe_subscription_id = _attempt.stripe_subscription_id
    and e.stripe_customer_id = _attempt.stripe_customer_id and e.checkout_session_id = _attempt.stripe_checkout_id
    and e.state = 'fulfilled'
  for update;
  if not found then return true; end if;

  select u.email_confirmed_at into _email_confirmed_at from auth.users u
  where u.id = _enrollment.user_id and u.deleted_at is null and not coalesce(u.is_anonymous, false)
    and (u.banned_until is null or u.banned_until <= now()) and lower(u.email) = _intake.primary_email
    and u.raw_app_meta_data ->> 'solo_beta_protected_reference' = _intake.reference_id::text
  for share;
  _confirmed_owner := found and _email_confirmed_at is not null;

  select s.* into _subscription from public.platform_subscriptions s
  join public.solo_beta_fulfillment_receipts r
    on r.subscription_id = s.id and r.event_id = _attempt.checkout_event_id
    and r.reference_id = _enrollment.reference_id and r.offer_code = _enrollment.offer_code
    and r.user_id = _enrollment.user_id and r.tenant_id = _enrollment.tenant_id and r.outcome = 'completed'
  join public.tenants t on t.id = s.tenant_id and t.owner_user_id = _enrollment.user_id
    and t.account_type = 'standalone' and t.parent_tenant_id is null
    and t.features ->> 'solo_beta_offer_code' = _enrollment.offer_code
  where s.tenant_id = _enrollment.tenant_id and s.offer_code = _enrollment.offer_code
    and s.stripe_customer_id = _attempt.stripe_customer_id and s.stripe_subscription_id = _attempt.stripe_subscription_id
    and s.stripe_product_id = _attempt.stripe_product_id and s.stripe_price_id = _attempt.stripe_price_id
    and s.provider_verified_at is not null
    and s.provider_mode = case when _attempt.provider_livemode then 'live' else 'test' end
  for update of s;
  if not found then raise exception 'protected_solo_lifecycle_subscription_missing'; end if;

  select m.* into _membership from public.tenant_members m
  where m.tenant_id = _enrollment.tenant_id and m.user_id = _enrollment.user_id and m.is_owner
  for update;
  if not found then raise exception 'protected_solo_lifecycle_owner_missing'; end if;

  if _state = 'active' then
    _period_is_current := _paid_current_period and _confirmed_owner
      and _email_confirmed_at <= _period_start and _period_start >= _attempt.trial_ends_at
      and _period_start <= now() and _period_end > now() and _period_end >= _subscription.current_period_end;
    if _period_is_current then
      update public.platform_subscriptions s
      set status = 'active', current_period_start = _period_start, current_period_end = _period_end,
        cancel_at_period_end = _cancel_at_period_end, provider_verified_at = now(),
        provider_event_created_at = _event_at, updated_at = now()
      where s.id = _subscription.id;
      update public.user_subscriptions s
      set status = 'active', current_period_start = _period_start, current_period_end = _period_end, updated_at = now()
      where s.user_id = _enrollment.user_id and s.stripe_subscription_id = _stripe_subscription_id and s.plan_slug = 'solo';
      if not found then raise exception 'protected_solo_lifecycle_entitlement_missing'; end if;
    end if;
    -- A noisy duplicate without additional invoice proof cannot invalidate a
    -- paid period already verified. Nor can it extend a trial or paid period.
    _eligible := _confirmed_owner and (_period_is_current or (
      _subscription.status = 'active' and _subscription.current_period_end > now()
    ));
  elsif _state = 'trialing' then
    -- Trial access lasts through the original verified end even while Stripe
    -- is deliberately set to cancel at period end. Auth still requires email
    -- verification and the first-run grant expires separately at 72 hours.
    -- A billing hold here would strand owners who verify after that deadline.
    _eligible := _subscription.status = 'trialing' and _attempt.trial_ends_at > now()
      and (_confirmed_owner or _cancel_at_period_end);
    update public.platform_subscriptions s set
      cancel_at_period_end = _cancel_at_period_end, provider_verified_at = now(),
      provider_event_created_at = _event_at, updated_at = now()
    where s.id = _subscription.id and s.status = 'trialing';
  else
    _eligible := false;
    update public.platform_subscriptions s set
      status = _state, cancel_at_period_end = _cancel_at_period_end, provider_verified_at = now(),
      provider_event_created_at = greatest(s.provider_event_created_at, _event_at), updated_at = now()
    where s.id = _subscription.id;
    update public.user_subscriptions s set status = _state, updated_at = now()
    where s.user_id = _enrollment.user_id and s.stripe_subscription_id = _stripe_subscription_id and s.plan_slug = 'solo';
    if not found then raise exception 'protected_solo_lifecycle_entitlement_missing'; end if;
  end if;

  if _eligible then
    if _membership.id = _attempt.workspace_billing_hold_member_id and _membership.status = 'suspended'
      and _membership.updated_at = _attempt.workspace_billing_hold_member_updated_at then
      update public.tenant_members m set status = 'active', updated_at = now()
      where m.id = _membership.id;
    end if;
    if _attempt.workspace_billing_hold_member_id is not null then
      update public.solo_beta_protected_checkout_attempts a set
        workspace_billing_hold_member_id = null, workspace_billing_hold_member_updated_at = null
      where a.reference_id = _attempt.reference_id;
    end if;
  elsif _membership.status = 'active' then
    update public.tenant_members m set status = 'suspended', updated_at = now()
    where m.id = _membership.id returning m.updated_at into _hold_updated_at;
    update public.solo_beta_protected_checkout_attempts a set
      workspace_billing_hold_member_id = _membership.id,
      workspace_billing_hold_member_updated_at = _hold_updated_at
    where a.reference_id = _attempt.reference_id;
  end if;

  return true;
end;
$$;

revoke all on function public.solo_beta_sync_protected_workspace_lifecycle(
  uuid,text,text,boolean,text,boolean,timestamptz,timestamptz,timestamptz,boolean
) from public, anon, authenticated;
grant execute on function public.solo_beta_sync_protected_workspace_lifecycle(
  uuid,text,text,boolean,text,boolean,timestamptz,timestamptz,timestamptz,boolean
) to service_role;

commit;
