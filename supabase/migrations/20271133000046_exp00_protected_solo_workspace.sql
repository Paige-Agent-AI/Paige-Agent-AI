begin;

-- Existing enrollment, billing, entitlement, and fulfillment records remain
-- the only canonical proof of a Solo workspace. The protected Stripe receipt
-- supplies the provider identity because this Checkout ran before Auth.
create function public.solo_beta_read_protected_workspace(
  _reference_id uuid, _owner_user_id uuid, _provider_livemode boolean
)
returns table (tenant_id uuid, account_number bigint, owner_user_id uuid)
language sql
security definer
stable
set search_path = ''
as $$
  select t.id, t.account_number, u.id
  from public.solo_beta_protected_signup_intake i
  join auth.users u on u.id = i.owner_user_id
  join public.solo_beta_protected_checkout_attempts a on a.reference_id = i.reference_id
  join public.solo_beta_enrollments e
    on e.reference_id = i.reference_id and e.user_id = u.id and e.offer_code = a.offer_code
    and e.stripe_customer_id = a.stripe_customer_id and e.checkout_session_id = a.stripe_checkout_id
    and e.stripe_subscription_id = a.stripe_subscription_id and e.state = 'fulfilled'
  join public.tenants t on t.id = e.tenant_id and t.owner_user_id = u.id
  join public.tenant_members m on m.tenant_id = t.id and m.user_id = u.id and m.is_owner and m.status = 'active'
  join public.platform_billing_accounts b
    on b.tenant_id = t.id and b.stripe_customer_id = a.stripe_customer_id and b.stripe_account = 'legacy'
  join public.platform_subscriptions s
    on s.tenant_id = t.id and s.stripe_subscription_id = a.stripe_subscription_id
    and s.stripe_customer_id = a.stripe_customer_id and s.offer_code = a.offer_code
    and s.stripe_product_id = a.stripe_product_id and s.stripe_price_id = a.stripe_price_id
  join public.user_subscriptions entitlement
    on entitlement.user_id = u.id and entitlement.stripe_subscription_id = s.stripe_subscription_id
    and entitlement.plan_slug = 'solo' and entitlement.status = s.status
  join public.solo_beta_fulfillment_receipts r
    on r.event_id = a.checkout_event_id and r.reference_id = e.reference_id
    and r.user_id = u.id and r.tenant_id = t.id and r.subscription_id = s.id
    and r.offer_code = a.offer_code and r.outcome = 'completed'
  where i.reference_id = _reference_id and i.owner_user_id = _owner_user_id
    and a.offer_code = 'paige-solo-beta-monthly-v2'
    and a.checkout_event_created_at is not null and a.checkout_event_digest is not null
    and a.stripe_product_id = i.stripe_product_id and a.stripe_price_id = i.stripe_price_id
    and i.provider_livemode = _provider_livemode and a.provider_livemode = i.provider_livemode
    and a.provider_livemode = (i.return_origin <> 'http://localhost:5173')
    and s.provider_mode = case when a.provider_livemode then 'live' else 'test' end
    and u.deleted_at is null and not coalesce(u.is_anonymous, false) and lower(u.email) = i.primary_email
    and (u.banned_until is null or u.banned_until <= now())
    and u.raw_app_meta_data ->> 'solo_beta_protected_reference' = i.reference_id::text
    and (u.email_confirmed_at is not null or a.verification_deadline_at > now())
    and t.account_type = 'standalone' and t.parent_tenant_id is null and t.status = 'active'
    and t.account_number > 0 and t.features ->> 'solo_beta_offer_code' = a.offer_code
    and s.provider_verified_at is not null and s.status = coalesce(a.provider_state, 'trialing')
    and s.current_period_end > now() and entitlement.current_period_end = s.current_period_end
    and ((s.status = 'trialing' and a.trial_ends_at > now() and s.trial_ends_at = a.trial_ends_at
        and entitlement.trial_ends_at = a.trial_ends_at
        and (u.email_confirmed_at is not null or a.provider_cancel_at_period_end is not false))
      or (s.status = 'active' and u.email_confirmed_at is not null));
$$;

-- Invoked only by the signup service with the original Checkout grant.
-- Do not issue credentials here. Provision and prove the workspace within one
-- transaction so neither a provisional visit nor a retry can create a partial
-- entitlement or a second workspace.
create function public.solo_beta_prepare_protected_workspace(
  _reference_id uuid, _resume_secret_hash text, _return_origin text
)
returns table (tenant_id uuid, account_number bigint, owner_user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _intake public.solo_beta_protected_signup_intake;
  _attempt public.solo_beta_protected_checkout_attempts;
  _offer public.platform_subscription_offers;
  _owner auth.users;
  _tenant public.tenants;
  _subscription_id uuid;
  _agreement_version integer;
begin
  select i.* into _intake
  from public.solo_beta_protected_signup_intake i
  where i.reference_id = _reference_id
    and i.resume_secret_hash = _resume_secret_hash and i.return_origin = _return_origin
  for update;
  if not found or _intake.owner_user_id is null then return; end if;

  select a.* into _attempt
  from public.solo_beta_protected_checkout_attempts a
  where a.reference_id = _intake.reference_id and a.checkout_event_id is not null
    and a.provider_livemode = _intake.provider_livemode
    and a.provider_livemode = (_intake.return_origin <> 'http://localhost:5173')
    and a.stripe_product_id = _intake.stripe_product_id and a.stripe_price_id = _intake.stripe_price_id
    and a.stripe_subscription_id is not null
  for update;
  if not found then return; end if;

  select u.* into _owner from auth.users u
  where u.id = _intake.owner_user_id and u.deleted_at is null and not coalesce(u.is_anonymous, false)
    and lower(u.email) = _intake.primary_email and (u.banned_until is null or u.banned_until <= now())
    and u.created_at >= _intake.created_at and u.created_at < _attempt.verification_deadline_at
    and u.raw_app_meta_data ->> 'solo_beta_protected_reference' = _intake.reference_id::text
  for update;
  if not found then return; end if;

  if exists (select 1 from public.solo_beta_enrollments e where e.user_id = _owner.id) then
    return query select w.* from public.solo_beta_read_protected_workspace(
      _intake.reference_id, _owner.id, _intake.provider_livemode
    ) w;
    return;
  end if;

  if _attempt.trial_ends_at <= now() or coalesce(_attempt.provider_state, 'trialing') <> 'trialing'
    or _attempt.provider_cancel_at_period_end is false
    or (_owner.email_confirmed_at is null and _attempt.verification_deadline_at <= now())
    or exists (select 1 from public.tenants t where t.owner_user_id = _owner.id and t.parent_tenant_id is null)
    or exists (select 1 from public.platform_subscriptions s where s.stripe_subscription_id = _attempt.stripe_subscription_id)
    or exists (select 1 from public.solo_beta_fulfillment_receipts r where r.event_id = _attempt.checkout_event_id)
    or exists (select 1 from public.user_subscriptions s where s.user_id = _owner.id
      and (s.plan_slug <> 'free' or s.stripe_subscription_id is not null)) then return;
  end if;

  select o.* into _offer from public.platform_subscription_offers o
  join public.platform_subscription_plans p on p.id = o.plan_id and p.slug = 'solo'
  where o.offer_code = _attempt.offer_code and o.account_type = 'standalone'
    and o.unit_amount_cents = 9700 and o.currency = 'usd' and o.billing_interval = 'month'
    and o.interval_count = 1 and o.trial_days = 30 and o.stripe_account = 'legacy'
    and (not _attempt.provider_livemode or (
      o.provider_mode = 'live' and o.status = 'live_ready'
      and o.stripe_product_id = _attempt.stripe_product_id and o.stripe_price_id = _attempt.stripe_price_id
    ));
  if not found then return; end if;

  -- A version rotation can happen between consent and Checkout. Bind only the
  -- exact legal documents captured with this enrollment, including the
  -- standalone agreement. Never substitute the newer document version.
  select d.version into _agreement_version from public.legal_documents d
  where d.slug = 'saas-standalone' and _intake.accepted_documents -> d.slug = pg_catalog.to_jsonb(d.version);
  if not found or exists (
    select 1 from pg_catalog.jsonb_each(_intake.accepted_documents) accepted
    where not exists (
      select 1 from public.legal_documents d
      where d.slug = accepted.key and pg_catalog.to_jsonb(d.version) = accepted.value
    )
  ) then return; end if;

  insert into public.legal_acceptances (
    user_id, document_slug, document_version, document_id, accepted_at, context
  )
  select _owner.id, d.slug, d.version, d.id, _intake.accepted_at,
    pg_catalog.jsonb_build_object('via', 'protected_solo_signup', 'reference_id', _intake.reference_id)
  from public.legal_documents d
  join pg_catalog.jsonb_each(_intake.accepted_documents) accepted
    on d.slug = accepted.key and pg_catalog.to_jsonb(d.version) = accepted.value
  on conflict (user_id, document_slug, document_version) do nothing;

  select * into _tenant from public.provision_tenant_as(
    _owner.id, null, 'standalone', null, null, null, 'saas-standalone', _agreement_version
  );
  if _tenant.owner_user_id is distinct from _owner.id or _tenant.account_type is distinct from 'standalone'
    or _tenant.parent_tenant_id is not null then
    raise exception 'protected_solo_workspace_invariant_failed';
  end if;
  perform public.assert_canonical_solo_tenant(_tenant);

  update public.tenants t
  set features = coalesce(t.features, '{}'::jsonb) ||
    pg_catalog.jsonb_build_object('solo_beta_offer_code', _attempt.offer_code)
  where t.id = _tenant.id;

  insert into public.platform_billing_accounts (tenant_id, stripe_customer_id, stripe_account, source, created_by)
  values (_tenant.id, _attempt.stripe_customer_id, _offer.stripe_account, 'checkout', _owner.id);
  insert into public.platform_subscriptions (
    tenant_id, plan_id, status, billing_period, current_period_start, current_period_end,
    trial_started_at, trial_ends_at, stripe_subscription_id, stripe_customer_id,
    cancel_at_period_end, metadata, offer_code, provider_mode, stripe_product_id,
    stripe_price_id, provider_verified_at, provider_event_created_at, provider_event_precedence
  ) values (
    _tenant.id, _offer.plan_id, 'trialing', 'monthly', _attempt.trial_started_at, _attempt.trial_ends_at,
    _attempt.trial_started_at, _attempt.trial_ends_at, _attempt.stripe_subscription_id, _attempt.stripe_customer_id,
    true, '{}'::jsonb, _attempt.offer_code, case when _attempt.provider_livemode then 'live' else 'test' end,
    _attempt.stripe_product_id, _attempt.stripe_price_id, now(),
    greatest(_attempt.checkout_event_created_at, _attempt.provider_state_event_at), 10
  ) returning id into _subscription_id;

  update public.user_subscriptions s
  set plan_slug = 'solo', status = 'trialing', trial_ends_at = _attempt.trial_ends_at,
    current_period_start = _attempt.trial_started_at, current_period_end = _attempt.trial_ends_at,
    stripe_subscription_id = _attempt.stripe_subscription_id, updated_at = now()
  where s.user_id = _owner.id and s.stripe_subscription_id is null and s.plan_slug = 'free';
  if not found then raise exception 'protected_solo_user_entitlement_missing'; end if;

  insert into public.solo_beta_enrollments (
    user_id, offer_code, state, stripe_customer_id, checkout_session_id, stripe_subscription_id,
    tenant_id, reference_id
  ) values (
    _owner.id, _attempt.offer_code, 'fulfilled', _attempt.stripe_customer_id,
    _attempt.stripe_checkout_id, _attempt.stripe_subscription_id, _tenant.id, _intake.reference_id
  );
  insert into public.solo_beta_fulfillment_receipts (
    event_id, user_id, tenant_id, subscription_id, offer_code, outcome, reference_id
  ) values (
    _attempt.checkout_event_id, _owner.id, _tenant.id, _subscription_id, _attempt.offer_code, 'completed', _intake.reference_id
  );

  return query select w.* from public.solo_beta_read_protected_workspace(
    _intake.reference_id, _owner.id, _intake.provider_livemode
  ) w;
  if not found then raise exception 'protected_solo_workspace_readback_failed'; end if;
end;
$$;

revoke all on function public.solo_beta_read_protected_workspace(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.solo_beta_read_protected_workspace(uuid, uuid, boolean) to service_role;
revoke all on function public.solo_beta_prepare_protected_workspace(uuid, text, text) from public, anon, authenticated;
grant execute on function public.solo_beta_prepare_protected_workspace(uuid, text, text) to service_role;

commit;
