begin;
select plan(6);

select ok(not has_table_privilege('anon', 'public.solo_beta_protected_signup_intake', 'SELECT')
  and not has_table_privilege('authenticated', 'public.solo_beta_protected_signup_intake', 'SELECT'),
  'The captured email and consent are private to the service');
select ok(not has_function_privilege('anon',
  'public.solo_beta_reserve_protected_signup(uuid,text,text,jsonb,text,text,text,boolean,text)', 'EXECUTE'),
  'Only the service can reserve an intake');

create temporary table exp00_terms(documents jsonb);
insert into exp00_terms select jsonb_object_agg(slug,version) from public.legal_documents
where is_current and (required_at_signup or slug = 'saas-standalone');
grant select on exp00_terms to service_role;
set local role service_role;

select is(public.solo_beta_reserve_protected_signup('61876362-1253-4b9b-b620-8708805cf547', repeat('a',64),
  'scope@example.invalid', '{}'::jsonb, 'solo_beta_v2_email_verified_2026_11',
  'prod_pgtap97', 'price_pgtap97', false, 'https://app.paigeagent.ai'), 'terms_changed', 'Incomplete current terms cannot start Checkout');
select is(public.solo_beta_reserve_protected_signup('61876362-1253-4b9b-b620-8708805cf547', repeat('a',64),
  'scope@example.invalid', (select documents from exp00_terms), 'solo_beta_v2_email_verified_2026_11',
  'prod_pgtap97', 'price_pgtap97', true, 'https://app.paigeagent.ai'), 'unavailable', 'The disabled live offer cannot start Checkout');
select is(public.solo_beta_reserve_protected_signup('61876362-1253-4b9b-b620-8708805cf547', repeat('a',64),
  'scope@example.invalid', (select documents from exp00_terms), 'solo_beta_v2_email_verified_2026_11',
  'prod_pgtap97', 'price_pgtap97', false, 'https://app.paigeagent.ai'), 'created', 'Current agreements create one protected intake');
select is(public.solo_beta_reserve_protected_signup('61876362-1253-4b9b-b620-8708805cf547', repeat('b',64),
  'scope@example.invalid', (select documents from exp00_terms), 'solo_beta_v2_email_verified_2026_11',
  'prod_pgtap97', 'price_pgtap97', false, 'https://app.paigeagent.ai'), 'unavailable', 'Another resume secret cannot recover the intake');

reset role;
select * from finish();
rollback;
