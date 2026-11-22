begin;

-- Keep the historical binding with the accepted terms and provider receipt after
-- Auth deletes a user. Only the join to a current, exact Auth row grants access.
alter table public.solo_beta_protected_signup_intake
  add column owner_user_id uuid unique,
  add column owner_bound_at timestamptz,
  add constraint solo_beta_protected_signup_owner_complete
    check ((owner_user_id is null) = (owner_bound_at is null));

-- The only identities recoverable here were created with server-owned Auth
-- metadata for this exact paid-flow attempt. A matching email alone is not authority.
create function public.solo_beta_read_protected_owner(
  _reference_id uuid, _resume_secret_hash text, _return_origin text
)
returns table (primary_email text, owner_user_id uuid, email_verified boolean)
language sql
security definer
stable
set search_path = ''
as $$
  select i.primary_email, candidate.id, coalesce(candidate.email_confirmed_at is not null, false)
  from public.solo_beta_protected_signup_intake i
  join public.solo_beta_protected_checkout_attempts a on a.reference_id = i.reference_id
  left join lateral (
    select u.id, u.email_confirmed_at
    from auth.users u
    where lower(u.email) = i.primary_email and u.created_at >= i.created_at
      and u.created_at < a.verification_deadline_at
      and u.raw_app_meta_data ->> 'solo_beta_protected_reference' = i.reference_id::text
      and (i.owner_user_id is null or i.owner_user_id = u.id)
      and u.deleted_at is null
    order by u.created_at, u.id
    limit 1
  ) candidate on true
  where i.reference_id = _reference_id and i.resume_secret_hash = _resume_secret_hash and i.return_origin = _return_origin
    and i.provider_livemode = a.provider_livemode
    and i.provider_livemode = (_return_origin <> 'http://localhost:5173')
    and a.stripe_product_id = i.stripe_product_id
    and a.stripe_price_id = i.stripe_price_id and a.stripe_subscription_id is not null
    and a.trial_ends_at > now() and coalesce(a.provider_state, 'trialing') = 'trialing'
    and ((i.owner_user_id is null and a.verification_deadline_at > now())
      or (i.owner_user_id is not null and candidate.id is not null));
$$;

create function public.solo_beta_bind_protected_owner(
  _reference_id uuid, _resume_secret_hash text, _return_origin text, _owner_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _intake public.solo_beta_protected_signup_intake;
  _candidate uuid;
begin
  select * into _intake from public.solo_beta_protected_signup_intake i
  where i.reference_id = _reference_id and i.resume_secret_hash = _resume_secret_hash and i.return_origin = _return_origin
  for update;
  if not found or _owner_user_id is null then return false; end if;

  select o.owner_user_id into _candidate from public.solo_beta_read_protected_owner(
    _reference_id, _resume_secret_hash, _return_origin) o;
  if _candidate is distinct from _owner_user_id then return false; end if;
  if _intake.owner_user_id is not null then return _intake.owner_user_id = _candidate; end if;

  update public.solo_beta_protected_signup_intake i
  set owner_user_id = _candidate, owner_bound_at = pg_catalog.clock_timestamp()
  where i.reference_id = _reference_id;
  return found;
end;
$$;

revoke all on function public.solo_beta_read_protected_owner(uuid,text,text) from public, anon, authenticated;
revoke all on function public.solo_beta_bind_protected_owner(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.solo_beta_read_protected_owner(uuid,text,text) to service_role;
grant execute on function public.solo_beta_bind_protected_owner(uuid,text,text,uuid) to service_role;

commit;
