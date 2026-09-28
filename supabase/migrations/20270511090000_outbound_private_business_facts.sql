-- A1 (owner ruling 2026-09-27): the owner's registered address, business phone and website may
-- reach PAIGE for the owner's own use, but none of the three may appear in anything addressed to a
-- customer unless the owner put it there. This migration is the check that makes the second half
-- true. It ships BEFORE the facts enter PAIGE's owner context (A1-2), so there is never a moment
-- when she holds them and nothing stands between them and a customer.
--
-- outbound_private_business_facts_found(tenant, texts, owner_texts) answers one question: which of
-- the three facts, as this tenant has them stored, appear in these customer-bound texts? It
-- returns the kinds found ('address', 'phone', 'website'), never a value, so a refusal can say
-- what matched without repeating it. Its callers (the chat's customer-bound exits and the send in
-- execute-approval, wired in A1-1b) refuse the draft on any finding and on any error.
--
-- WHAT IS READ. Every stored copy of each fact, confirmed or not: a value the owner has not
-- confirmed is still theirs, and the principle is that a withheld normal action is preferable to a
-- missed leak.
--   address — tenant_legal_profile (registered_street, registered_street_secondary,
--             registered_postal_code, registered_address), the private Setup brief (address,
--             registeredStreet), and the legacy copies left in tenants.brand (top-level address,
--             business_brief.address).
--   phone   — tenant_legal_profile.support_phone, the private Setup brief's phone, and the legacy
--             brand copies (phone, business_phone, business_brief.phone). Not the authorized
--             representative's own phone: that is not one of the three ruled facts.
--   website — business_brief.website, tenant_legal_profile.website_url, brand.website.
--
-- HOW A FACT IS FOUND, and what is deliberately not matched.
--   address — by its street lines. Text is lower-cased, reduced to letters, digits and single
--             spaces, and common street words are shortened (street→st, road→rd, …) on both sides,
--             so "12 High Street" is found as "12 high st.". A structured street line is used when
--             it has at least six characters and a letter; every other part (a secondary line, a
--             postal code, each comma-separated part of a single-line address) is used when it has
--             at least six characters, a letter AND a digit. A city or a region on its own is not a
--             match: it names a place, not this business.
--   phone   — by its last ten digits (all of them when shorter; an extension is dropped; fewer than
--             seven digits is not a phone). Digits in the text are joined across spaces, dots,
--             brackets, plus signs and dashes first, so every usual way of writing the number is
--             found, domestic prefix or not.
--   website — by its host, without scheme, "www.", port or path. Found as a whole host: not when it
--             is part of an e-mail address (the business's e-mail is a different fact, already in
--             PAIGE's shared context), not as the start of a longer domain, and not as a subdomain.
--
-- OWNER-PUT. A value that also appears in owner_texts (what the owner typed on this turn) is not
-- reported: the owner put it there. The exemption is per VALUE, not per kind, so an owner who types
-- one address does not license a different stored one.
--
-- AUTHORITY (§59). SECURITY DEFINER, because the private brief and the legal profile are closed to
-- browser callers. EXECUTE is service_role only and the body refuses every other caller, the
-- owner included: the tenant is resolved by the server that calls it, never by a browser, and no
-- signed-in caller gets an oracle for another tenant's stored facts. It reads nothing but the one
-- tenant it is given and returns only kinds.

create or replace function public.outbound_fact_street_text(p_text text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  v text;
  v_pair text[];
begin
  v := ' ' || btrim(regexp_replace(lower(p_text), '[^[:alnum:]]+', ' ', 'g')) || ' ';
  foreach v_pair slice 1 in array array[
    ['street','st'], ['avenue','ave'], ['road','rd'], ['boulevard','blvd'], ['drive','dr'],
    ['lane','ln'], ['court','ct'], ['place','pl'], ['square','sq'], ['terrace','ter'],
    ['highway','hwy'], ['parkway','pkwy'], ['crescent','cres'], ['close','cl'],
    ['suite','ste'], ['apartment','apt'], ['floor','fl'], ['building','bldg'],
    ['north','n'], ['south','s'], ['east','e'], ['west','w']
  ] loop
    v := regexp_replace(v, '\m' || v_pair[1] || '\M', v_pair[2], 'g');
  end loop;
  return v;
end;
$$;

create or replace function public.outbound_fact_digit_runs(p_text text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select ' ' || regexp_replace(
    regexp_replace(p_text, '([0-9])[[:space:]().+–-]{1,3}(?=[0-9])', '\1', 'g'),
    '[^0-9]+', ' ', 'g') || ' '
$$;

create or replace function public.outbound_fact_website_host(p_value text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  v text := lower(btrim(p_value));
begin
  v := regexp_replace(v, '^[a-z][a-z0-9+.-]*://', '');
  v := regexp_replace(v, '^[^/@]*@', '');
  v := regexp_replace(v, '[/?#:].*$', '');
  v := regexp_replace(v, '^www\.', '');
  v := rtrim(v, '.');
  if v !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' or length(v) < 4 then
    return null;
  end if;
  return v;
end;
$$;

create or replace function public.outbound_private_business_facts_found(
  p_tenant uuid,
  p_texts text[],
  p_owner_texts text[] default '{}'::text[]
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_brand jsonb := '{}'::jsonb;
  v_private jsonb := '{}'::jsonb;
  v_legal public.tenant_legal_profile%rowtype;
  v_text text := coalesce(array_to_string(p_texts, E'\n'), '');
  v_owner text := coalesce(array_to_string(p_owner_texts, E'\n'), '');
  v_text_street text;
  v_owner_street text;
  v_text_digits text;
  v_owner_digits text;
  v_text_lower text;
  v_owner_lower text;
  v_found text[] := '{}'::text[];
  v_value text;
  v_part text;
  v_norm text;
  v_digits text;
  v_host text;
  v_pattern text;
  v_hit boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'OUTBOUND_FACTS_SERVICE_ONLY' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'OUTBOUND_FACTS_TENANT_REQUIRED' using errcode = '22023';
  end if;
  if btrim(v_text) = '' then
    return v_found;
  end if;

  select coalesce(t.brand, '{}'::jsonb) into v_brand from public.tenants t where t.id = p_tenant;
  select coalesce(pc.private_brief, '{}'::jsonb) into v_private
  from public.tenant_setup_private_context pc where pc.tenant_id = p_tenant;
  v_brand := coalesce(v_brand, '{}'::jsonb);
  v_private := coalesce(v_private, '{}'::jsonb);
  select * into v_legal from public.tenant_legal_profile lp where lp.tenant_id = p_tenant;

  -- Address: every street-like line of every stored copy.
  v_text_street := public.outbound_fact_street_text(v_text);
  v_owner_street := public.outbound_fact_street_text(v_owner);
  v_hit := false;
  for v_value in
    select s.part
    from (
      select btrim(v_legal.registered_street) as part, true as street_line
      union all select btrim(v_private ->> 'registeredStreet'), true
      union all select btrim(v_legal.registered_street_secondary), false
      union all select btrim(v_legal.registered_postal_code), false
      union all
      select btrim(p), false
      from unnest(array[
        v_legal.registered_address,
        v_private ->> 'address',
        v_brand ->> 'address',
        v_brand -> 'business_brief' ->> 'address'
      ]) as single_line(line)
      cross join lateral regexp_split_to_table(coalesce(single_line.line, ''), '[,;\n]+') as p
    ) s
    where s.part is not null
      and s.part <> ''
      and length(btrim(public.outbound_fact_street_text(s.part))) >= 6
      and s.part ~ '[[:alpha:]]'
      and (s.street_line or s.part ~ '[0-9]')
  loop
    v_norm := public.outbound_fact_street_text(v_value);
    if position(v_norm in v_text_street) > 0 and position(v_norm in v_owner_street) = 0 then
      v_hit := true;
      exit;
    end if;
  end loop;
  if v_hit then v_found := v_found || 'address'::text; end if;

  -- Phone: the last ten digits of every stored copy, against digit runs joined across separators.
  v_text_digits := public.outbound_fact_digit_runs(v_text);
  v_owner_digits := public.outbound_fact_digit_runs(v_owner);
  v_hit := false;
  for v_value in
    select p from unnest(array[
      v_legal.support_phone,
      v_private ->> 'phone',
      v_brand ->> 'phone',
      v_brand ->> 'business_phone',
      v_brand -> 'business_brief' ->> 'phone'
    ]) as p
    where p is not null and btrim(p) <> ''
  loop
    v_digits := regexp_replace(
      regexp_replace(lower(v_value), '[[:space:]]*(extension|ext\.?|x|#).*$', ''),
      '[^0-9]', '', 'g');
    continue when length(v_digits) < 7;
    v_digits := right(v_digits, 10);
    if position(v_digits in v_text_digits) > 0 and position(v_digits in v_owner_digits) = 0 then
      v_hit := true;
      exit;
    end if;
  end loop;
  if v_hit then v_found := v_found || 'phone'::text; end if;

  -- Website: the host of every stored copy, as a whole host.
  v_text_lower := lower(v_text);
  v_owner_lower := lower(v_owner);
  v_hit := false;
  for v_value in
    select p from unnest(array[
      v_brand -> 'business_brief' ->> 'website',
      v_legal.website_url,
      v_brand ->> 'website'
    ]) as p
    where p is not null and btrim(p) <> ''
  loop
    v_host := public.outbound_fact_website_host(v_value);
    continue when v_host is null;
    v_pattern := '(^|[^a-z0-9@._-])(www\.)?' || replace(v_host, '.', '\.')
      || '($|[^a-z0-9._-]|\.($|[^a-z0-9_-]))';
    if v_text_lower ~ v_pattern and v_owner_lower !~ v_pattern then
      v_hit := true;
      exit;
    end if;
  end loop;
  if v_hit then v_found := v_found || 'website'::text; end if;

  return v_found;
end;
$$;

comment on function public.outbound_private_business_facts_found(uuid, text[], text[]) is
  'A1: which of the tenant''s registered address, business phone and website appear in customer-bound texts. Returns kinds only; a value the owner typed (owner_texts) is exempt, per value. Service-only; the caller refuses the draft on any finding or error.';

revoke all on function public.outbound_fact_street_text(text) from public, anon, authenticated;
revoke all on function public.outbound_fact_digit_runs(text) from public, anon, authenticated;
revoke all on function public.outbound_fact_website_host(text) from public, anon, authenticated;
revoke all on function public.outbound_private_business_facts_found(uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.outbound_private_business_facts_found(uuid, text[], text[]) to service_role;
