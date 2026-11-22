begin;

-- Checkout-first enrollment cannot depend on a confirmed Auth user. Retain
-- the initial email and terms in a service-only record until identity is proved.
create table public.solo_beta_protected_signup_intake (
  reference_id uuid primary key,
  resume_secret_hash text not null unique check (resume_secret_hash ~ '^[0-9a-f]{64}$'),
  primary_email text not null check (
    primary_email = lower(btrim(primary_email)) and length(primary_email) between 3 and 254
    and primary_email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
  ),
  accepted_documents jsonb not null check (jsonb_typeof(accepted_documents) = 'object'),
  accepted_at timestamptz not null,
  renewal_consent_version text not null check (renewal_consent_version = 'solo_beta_v2_email_verified_2026_11'),
  stripe_product_id text not null,
  stripe_price_id text not null,
  provider_livemode boolean not null,
  return_origin text not null check (return_origin in ('https://paigeagent.ai', 'https://www.paigeagent.ai', 'https://app.paigeagent.ai', 'http://localhost:5173')),
  created_at timestamptz not null default now(),
  check (stripe_product_id ~ '^prod_[A-Za-z0-9]+$' and stripe_price_id ~ '^price_[A-Za-z0-9]+$')
);

alter table public.solo_beta_protected_signup_intake enable row level security;
alter table public.solo_beta_protected_signup_intake force row level security;
revoke all on public.solo_beta_protected_signup_intake from public, anon, authenticated, service_role;
grant select on public.solo_beta_protected_signup_intake to service_role;

create function public.solo_beta_reserve_protected_signup(
  _reference_id uuid, _resume_secret_hash text, _primary_email text, _accepted_documents jsonb,
  _renewal_consent_version text, _stripe_product_id text, _stripe_price_id text, _provider_livemode boolean,
  _return_origin text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _prior public.solo_beta_protected_signup_intake;
  _current_documents jsonb;
  _doc_count integer;
  _distinct_doc_count integer;
begin
  select jsonb_object_agg(d.slug, d.version), count(*)::integer, count(distinct d.slug)::integer
  into _current_documents, _doc_count, _distinct_doc_count
  from public.legal_documents d where d.is_current and (d.required_at_signup or d.slug = 'saas-standalone');
  if _current_documents is null or not (_current_documents ? 'saas-standalone')
    or _doc_count <> _distinct_doc_count or _current_documents is distinct from _accepted_documents
    or _renewal_consent_version is distinct from 'solo_beta_v2_email_verified_2026_11' then
    return 'terms_changed';
  end if;

  if _provider_livemode and not exists (
    select 1 from public.platform_subscription_offers o
    where o.offer_code = 'paige-solo-beta-monthly-v2' and o.status = 'live_ready'
      and o.provider_mode = 'live' and o.stripe_product_id = _stripe_product_id and o.stripe_price_id = _stripe_price_id
  ) then return 'unavailable'; end if;

  insert into public.solo_beta_protected_signup_intake (
    reference_id, resume_secret_hash, primary_email, accepted_documents, accepted_at,
    renewal_consent_version, stripe_product_id, stripe_price_id, provider_livemode, return_origin
  ) values (
    _reference_id, _resume_secret_hash, _primary_email, _accepted_documents, pg_catalog.clock_timestamp(),
    _renewal_consent_version, _stripe_product_id, _stripe_price_id, _provider_livemode, _return_origin
  ) on conflict do nothing;
  if found then return 'created'; end if;

  select * into _prior from public.solo_beta_protected_signup_intake where reference_id = _reference_id;
  if found and _prior.resume_secret_hash = _resume_secret_hash and _prior.primary_email = _primary_email
    and _prior.provider_livemode = _provider_livemode and _prior.return_origin = _return_origin then
    if _prior.accepted_documents is distinct from _accepted_documents or
      _prior.stripe_price_id is distinct from _stripe_price_id or _prior.stripe_product_id is distinct from _stripe_product_id then
      return 'terms_changed';
    end if;
    return 'existing';
  end if;
  return 'unavailable';
end;
$$;

revoke all on function public.solo_beta_reserve_protected_signup(uuid, text, text, jsonb, text, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.solo_beta_reserve_protected_signup(uuid, text, text, jsonb, text, text, text, boolean, text)
  to service_role;

commit;
