begin;
select plan(5);

select is(
  (select unit_amount_cents from public.platform_subscription_offers
   where offer_code = 'paige-solo-beta-monthly-v1'),
  7450,
  'Original Solo Beta offer keeps its existing price'
);

select results_eq(
  $$select unit_amount_cents, trial_days, status, stripe_product_id, stripe_price_id
    from public.platform_subscription_offers
    where offer_code = 'paige-solo-beta-monthly-v2'$$,
  $$values (9700, 30, 'configuration_required'::text, null::text, null::text)$$,
  'Protected Solo Beta is $97 for 30 days and disabled before a provider binding'
);

select throws_ok(
  $$update public.platform_subscription_offers set unit_amount_cents = 9700
    where offer_code = 'paige-solo-beta-monthly-v1'$$,
  '23514', null,
  'A new price cannot silently replace the original offer amount'
);

select throws_ok(
  $$update public.platform_subscription_offers set unit_amount_cents = 7450
    where offer_code = 'paige-solo-beta-monthly-v2'$$,
  '23514', null,
  'The protected offer cannot inherit the historical price'
);

select throws_ok(
  $$update public.platform_subscription_offers set status = 'live_ready'
    where offer_code = 'paige-solo-beta-monthly-v2'$$,
  '23514', null,
  'The protected offer fails closed without Stripe product and price IDs'
);

select * from finish();
rollback;
