-- A1 (owner ruling 2026-09-27): the owner's registered address, business phone and website may
-- reach PAIGE for the owner's own use, but none of the three may appear in anything addressed to a
-- customer unless the owner put it there. This migration adds the check that later callers use to
-- hold such a draft back. It ships BEFORE the facts enter PAIGE's owner context (A1-2), so there is
-- never a moment when she holds them and nothing stands between them and a customer.
--
-- outbound_private_business_facts_found(tenant, texts, owner_texts) answers one question: which of
-- the three facts, as this tenant has them stored, appear in these customer-bound texts? It
-- returns the kinds found ('address', 'phone', 'website'), never a value, so a refusal can say
-- what matched without repeating it. NOTHING CALLS IT YET: A1-1b wires it into the customer-bound
-- exits, each refusing the draft on any finding and on any error.
--
-- The principle it is built to: a withheld normal action is preferable to a missed leak. So it
-- reads wide and matches wide, and it is narrowed only where matching would make ordinary use
-- unworkable. Each such narrowing is named below.
--
-- WHAT IS READ. Every stored copy of each fact, confirmed or not: a value the owner has not
-- confirmed, or that PAIGE has only proposed, is still theirs.
--   address — tenant_legal_profile (registered_street, registered_street_secondary,
--             registered_postal_code, registered_address); the private Setup brief (address,
--             registeredStreet, registeredStreetSecondary, registeredPostalCode); the legacy copies
--             in tenants.brand (address, business_brief.address); and a staged proposal's address
--             (business_brief_proposal.patch, which may hold only the single-line address).
--   phone   — tenant_legal_profile.support_phone; the private Setup brief's phone; the legacy brand
--             copies (phone, business_phone, business_brief.phone); a staged proposal's phone. Not
--             the authorized representative's own phone: it is not one of the three ruled facts.
--   website — business_brief.website, tenant_legal_profile.website_url, brand.website, and a
--             staged proposal's website.
--
-- READING THE TEXT. Customer-bound text may be HTML e-mail. Entities are decoded (named and
-- numeric), common URL escapes are decoded, Unicode spaces, dashes, apostrophes and full-width
-- digits are mapped to their plain forms, and invisible characters are removed. Every fact is
-- then looked for twice: in that decoded text as written (so a link inside a tag is seen) and in
-- the same text with its tags replaced by spaces (so "221B<br>Baker Street" is seen).
--
-- HOW A FACT IS FOUND.
--   address — Stored copies are split into parts on commas, semicolons, new lines, "|", "/" and a
--             spaced dash. Both sides are lower-cased, accents are dropped, apostrophes are removed,
--             everything else that is not a letter or digit becomes a space, and common street words
--             are shortened (street→st, fifth→5th, saint→st, north west→nw, …). A part is looked
--             for when it has six or more characters and a letter, and also one of: a digit; a
--             street or building word that follows another word ("Mill Lane", "Rose Cottage", but
--             not "St. Louis"); or being the first part of a structured street line. For a part that
--             starts with a number, its core is looked for too: up to its street word
--             ("123 Main St" from "123 Main St Suite 400 Springfield"), and up to a secondary word
--             (suite, apt, unit, floor, …). A number range adds each end ("221-223 Baker St" adds
--             "221 Baker St" and "223 Baker St").
--             NOT MATCHED: a part with no digit and no street word, such as a city, a region or a
--             district on its own ("Leeds", "New York", "St. Louis"). It names a place, not this
--             business, and refusing it would refuse every mention of the place.
--   phone   — By its last seven digits. Every written form of a number, international or domestic,
--             with or without its area code, ends in the same seven digits. A trailing extension is
--             dropped first when at least seven digits remain without it. A stored value holding two
--             numbers is also read piece by piece. A stored value with fewer than seven digits
--             ("1-800-FLOWERS") is looked for as written, letters and digits only. In the text,
--             digits are joined across spaces, dots, brackets, plus signs, slashes and dashes (up to
--             four such characters in a row).
--             NOT MATCHED: a number written in words, or in letters only on one side.
--   website — By its host, without scheme, "www.", port or path, including any subdomain of it
--             ("shop.example.com"); international hosts are read as written.
--             NOT MATCHED: an e-mail address at the domain ("hello@example.com"), because that is a
--             different fact, already in PAIGE's shared context, and refusing it would refuse every
--             signed message; a longer domain that merely starts with the host; the same host in
--             punycode. A website on a shared platform (a booking, social or link-page host, or
--             Paige's own) is matched by that host AND its first path segment, because the host alone
--             would refuse every link to the platform; a bare shared host names nobody and is not
--             matched.
--
-- OWNER-PUT (interim rule (a), until the owner rules on (a)/(b)). A value that also appears in
-- owner_texts (what the owner typed on this turn) is not reported: the owner put it there. The
-- exemption is per VALUE, not per kind, so an owner who types one address does not license a
-- different stored one.
--
-- AUTHORITY (§59). SECURITY DEFINER, because the private brief and the legal profile are closed to
-- browser callers. EXECUTE is service_role only and the body refuses every other caller, the
-- owner included: the tenant is resolved by the server that calls it, never by a browser, and no
-- signed-in caller gets an oracle for any tenant's stored facts. An unknown tenant is refused,
-- never read as "nothing stored". It reads only the tenant it is given and returns only kinds.

create or replace function public.outbound_fact_decode(p_text text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  v text := p_text;
  v_code text;
  v_n integer;
begin
  v := regexp_replace(v, '&amp;', '&', 'gi');
  v := regexp_replace(v, '&(nbsp|ensp|emsp|thinsp);', ' ', 'gi');
  v := regexp_replace(v, '&(ndash|mdash|minus|hyphen|dash);', '-', 'gi');
  v := regexp_replace(v, '&(apos|rsquo|lsquo);', '''', 'gi');
  v := regexp_replace(v, '&(middot|period);', '.', 'gi');
  v := regexp_replace(v, '&commat;', '@', 'gi');
  v := regexp_replace(v, '&colon;', ':', 'gi');
  v := regexp_replace(v, '&sol;', '/', 'gi');
  v := regexp_replace(v, '&num;', '#', 'gi');
  v := regexp_replace(v, '&plus;', '+', 'gi');
  v := regexp_replace(v, '&lpar;', '(', 'gi');
  v := regexp_replace(v, '&rpar;', ')', 'gi');
  for v_code in
    select distinct m[1] from regexp_matches(v, '&#(x[0-9a-f]{1,6}|[0-9]{1,7});', 'gi') as m
  loop
    v_n := case when lower(left(v_code, 1)) = 'x'
                then ('x' || lpad(substr(v_code, 2), 8, '0'))::bit(32)::integer
                else v_code::integer end;
    if v_n between 1 and 1114111 and v_n not between 55296 and 57343 then
      v := replace(v, '&#' || v_code || ';', chr(v_n));
    end if;
  end loop;
  for v_code in
    select distinct m[1] from regexp_matches(v, '%([2-7][0-9a-f])', 'gi') as m
  loop
    v := replace(v, '%' || v_code, chr(('x' || lpad(v_code, 8, '0'))::bit(32)::integer));
  end loop;
  -- Spaces, dashes, apostrophes, full-width digits and punctuation to plain forms; invisible
  -- characters (the last six) removed.
  v := translate(v,
    U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000'
    || U&'\2010\2011\2012\2013\2014\2015\2212\FE58\FE63\FF0D'
    || U&'\2018\2019\02BC\FF07'
    || U&'\FF10\FF11\FF12\FF13\FF14\FF15\FF16\FF17\FF18\FF19'
    || U&'\00B7\2024\FF0E\FF20\FF0B\FF08\FF09\FF0F\FF1A'
    || U&'\00AD\200B\200C\200D\2060\FEFF',
    '                ' || '----------' || '''''''''' || '0123456789' || '...@+()/:');
  return v;
end;
$$;

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
  v := lower(p_text);
  v := replace(replace(replace(replace(v, 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'), 'þ', 'th');
  v := translate(v,
    'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľŀłñńņňòóôõöøōŏőŕŗřśŝşšţťŧùúûüũūŭůűųŵýÿŷźżž',
    'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijklllllnnnnooooooooorrrsssstttuuuuuuuuuuwyyyzzz');
  v := replace(v, '''', '');
  v := ' ' || btrim(regexp_replace(v, '[^[:alnum:]]+', ' ', 'g')) || ' ';
  foreach v_pair slice 1 in array array[
    ['street','st'], ['avenue','ave'], ['av','ave'], ['road','rd'], ['boulevard','blvd'],
    ['drive','dr'], ['lane','ln'], ['court','ct'], ['place','pl'], ['square','sq'],
    ['terrace','ter'], ['highway','hwy'], ['parkway','pkwy'], ['crescent','cres'], ['close','cl'],
    ['circle','cir'], ['trail','trl'], ['gardens','gdns'], ['garden','gdn'], ['grove','gr'],
    ['alley','aly'], ['strasse','str'], ['saint','st'], ['mount','mt'], ['fort','ft'],
    ['suite','ste'], ['apartment','apt'], ['floor','fl'], ['building','bldg'], ['room','rm'],
    ['level','lvl'], ['number','no'],
    ['northwest','nw'], ['northeast','ne'], ['southwest','sw'], ['southeast','se'],
    ['north','n'], ['south','s'], ['east','e'], ['west','w'],
    ['first','1st'], ['second','2nd'], ['third','3rd'], ['fourth','4th'], ['fifth','5th'],
    ['sixth','6th'], ['seventh','7th'], ['eighth','8th'], ['ninth','9th'], ['tenth','10th']
  ] loop
    v := regexp_replace(v, '\m' || v_pair[1] || '\M', v_pair[2], 'g');
  end loop;
  v := regexp_replace(v, '\m([ns]) ([ew])\M', '\1\2', 'g');
  v := regexp_replace(v, '\m([0-9]+) ([a-z])\M', '\1\2', 'g');
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
    regexp_replace(regexp_replace(p_text, '[[:space:]]+', ' ', 'g'),
                   '([0-9])[ ().+/-]{1,4}(?=[0-9])', '\1', 'g'),
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
  if v !~ '^[[:alnum:]-]+(\.[[:alnum:]-]+)+$' or length(v) < 4 then
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
set search_path = ''
as $$
declare
  -- Shared platforms whose URLs name a tenant by their first path segment.
  c_shared_hosts constant text[] := array[
    'paigeagent.ai', 'calendly.com', 'cal.com', 'instagram.com', 'facebook.com', 'fb.com',
    'linkedin.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com', 'youtu.be',
    'linktr.ee', 'beacons.ai', 'stan.store', 'etsy.com', 'medium.com', 'pinterest.com',
    'threads.net', 'wa.me', 't.me'];
  c_street_words constant text :=
    '(st|ave|rd|blvd|dr|ln|ct|pl|sq|ter|hwy|pkwy|cres|cl|cir|trl|gdns|gdn|gr|aly|str|way|row|walk|'
    || 'mews|loop|cottage|house|farm|lodge|hall|manor|barn|mill|tower|plaza|bldg|estate|wharf|quay|yard)';
  c_secondary_words constant text := '(ste|apt|unit|fl|rm|lvl|bldg|flat)';
  v_brand jsonb;
  v_brief jsonb;
  v_patch jsonb;
  v_private jsonb := '{}'::jsonb;
  v_legal public.tenant_legal_profile%rowtype;
  v_raw text;
  v_owner_raw text;
  v_scan text;
  v_owner_scan text;
  v_text_street text;
  v_owner_street text;
  v_text_digits text;
  v_owner_digits text;
  v_text_alnum text;
  v_owner_alnum text;
  v_found text[] := '{}'::text[];
  v_source text;
  v_is_street boolean;
  v_first boolean;
  v_part text;
  v_norm text;
  v_cands text[];
  v_cand text;
  v_match text[];
  v_value text;
  v_piece text;
  v_digits text;
  v_ext text;
  v_key text;
  v_host text;
  v_base text;
  v_seg text;
  v_pattern text;
  v_hit boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'OUTBOUND_FACTS_SERVICE_ONLY' using errcode = '42501';
  end if;
  if p_tenant is null then
    raise exception 'OUTBOUND_FACTS_TENANT_REQUIRED' using errcode = '22023';
  end if;
  select coalesce(t.brand, '{}'::jsonb) into v_brand from public.tenants t where t.id = p_tenant;
  if not found then
    raise exception 'OUTBOUND_FACTS_TENANT_UNKNOWN' using errcode = '22023';
  end if;
  v_raw := public.outbound_fact_decode(coalesce(array_to_string(p_texts, E'\n'), ''));
  if btrim(v_raw) = '' then
    return v_found;
  end if;
  v_owner_raw := public.outbound_fact_decode(coalesce(array_to_string(p_owner_texts, E'\n'), ''));
  -- As written (a link inside a tag is seen), and with tags as spaces ("Baker<br>Street").
  v_scan := v_raw || E'\n' || regexp_replace(v_raw, '<[^>]*>', ' ', 'g');
  v_owner_scan := v_owner_raw || E'\n' || regexp_replace(v_owner_raw, '<[^>]*>', ' ', 'g');

  v_brief := coalesce(v_brand -> 'business_brief', '{}'::jsonb);
  v_patch := coalesce(v_brand -> 'business_brief_proposal' -> 'patch', '{}'::jsonb);
  select coalesce(pc.private_brief, '{}'::jsonb) into v_private
  from public.tenant_setup_private_context pc where pc.tenant_id = p_tenant;
  v_private := coalesce(v_private, '{}'::jsonb);
  select * into v_legal from public.tenant_legal_profile lp where lp.tenant_id = p_tenant;

  -- ── Address ──────────────────────────────────────────────────────────────────────────────
  v_text_street := public.outbound_fact_street_text(v_scan);
  v_owner_street := public.outbound_fact_street_text(v_owner_scan);
  v_hit := false;
  <<sources>>
  for v_source, v_is_street in
    select x.value, x.is_street
    from (values
      (v_legal.registered_street, true), (v_private ->> 'registeredStreet', true),
      (v_legal.registered_street_secondary, false), (v_private ->> 'registeredStreetSecondary', false),
      (v_legal.registered_postal_code, false), (v_private ->> 'registeredPostalCode', false),
      (v_legal.registered_address, false), (v_private ->> 'address', false),
      (v_brand ->> 'address', false), (v_brief ->> 'address', false), (v_patch ->> 'address', false)
    ) as x(value, is_street)
    where x.value is not null and btrim(x.value) <> ''
  loop
    v_first := true;
    for v_part in
      select btrim(p)
      from regexp_split_to_table(public.outbound_fact_decode(v_source),
                                 '[,;|/\n\r]+|[[:space:]]+-[[:space:]]+') as p
    loop
      continue when v_part = '';
      v_norm := btrim(public.outbound_fact_street_text(v_part));
      v_cands := '{}'::text[];
      if length(v_norm) >= 6 and v_norm ~ '[[:alpha:]]'
         and (v_norm ~ '[0-9]' or (v_is_street and v_first)
              or v_norm ~ ('[[:alnum:]] ' || c_street_words || '\M')) then
        v_cands := v_cands || v_norm;
      end if;
      if v_norm ~ '^[0-9]' then
        -- A range adds each end.
        if v_part ~ '^[[:space:]]*[0-9]+[[:alpha:]]?[[:space:]]*-[[:space:]]*[0-9]+' then
          v_match := regexp_match(v_norm, '^([0-9]+[a-z]?) ([0-9]+[a-z]?) (.+)$');
          if v_match is not null then
            v_cands := v_cands || (v_match[1] || ' ' || v_match[3]) || (v_match[2] || ' ' || v_match[3]);
          end if;
        end if;
        -- Its core: up to its street word, and up to a secondary word.
        -- At least three words, so "100 St Marys Gate" does not yield "100 st".
        v_cand := substring(v_norm from '^(.*? ' || c_street_words || ')\M');
        if v_cand is not null and v_cand <> v_norm and v_cand ~ '^[^ ]+ [^ ]+ [^ ]+' then
          v_cands := v_cands || v_cand;
        end if;
        v_cand := substring(v_norm from '^(.*?) ' || c_secondary_words || '\M');
        if v_cand is not null and v_cand ~ '[0-9]' and v_cand ~ '[[:alpha:]]' then
          v_cands := v_cands || v_cand;
        end if;
      end if;
      v_first := false;
      foreach v_cand in array v_cands loop
        continue when length(v_cand) < 6 or v_cand !~ '[[:alpha:]]';
        if position(' ' || v_cand || ' ' in v_text_street) > 0
           and position(' ' || v_cand || ' ' in v_owner_street) = 0 then
          v_hit := true;
          exit sources;
        end if;
      end loop;
    end loop;
  end loop;
  if v_hit then v_found := v_found || 'address'::text; end if;

  -- ── Phone ────────────────────────────────────────────────────────────────────────────────
  v_text_digits := public.outbound_fact_digit_runs(v_scan);
  v_owner_digits := public.outbound_fact_digit_runs(v_owner_scan);
  v_text_alnum := regexp_replace(lower(v_scan), '[^[:alnum:]]', '', 'g');
  v_owner_alnum := regexp_replace(lower(v_owner_scan), '[^[:alnum:]]', '', 'g');
  v_hit := false;
  <<phones>>
  for v_source in
    select x.value
    from (values (v_legal.support_phone), (v_private ->> 'phone'), (v_brand ->> 'phone'),
                 (v_brand ->> 'business_phone'), (v_brief ->> 'phone'), (v_patch ->> 'phone')) as x(value)
    where x.value is not null and btrim(x.value) <> ''
  loop
    v_value := lower(public.outbound_fact_decode(v_source));
    for v_piece in
      select v_value
      union all
      select p from regexp_split_to_table(v_value, '[,;|/\n\r]+|\mor\M|\mand\M') as p
    loop
      v_digits := regexp_replace(v_piece, '[^0-9]', '', 'g');
      v_ext := substring(v_piece from '(?:^|[^[:alpha:]])(?:ext\.?|extension|x|#)[[:space:]]*([0-9]{1,6})[[:space:]]*$');
      if v_ext is not null and length(v_digits) - length(v_ext) >= 7 then
        v_digits := left(v_digits, length(v_digits) - length(v_ext));
      end if;
      if length(v_digits) >= 7 then
        v_key := right(v_digits, 7);
        if position(v_key in v_text_digits) > 0 and position(v_key in v_owner_digits) = 0 then
          v_hit := true;
          exit phones;
        end if;
      else
        v_key := regexp_replace(coalesce(substring(v_piece from '[0-9].*$'), ''), '[^[:alnum:]]', '', 'g');
        continue when length(v_key) < 6;
        if position(v_key in v_text_alnum) > 0 and position(v_key in v_owner_alnum) = 0 then
          v_hit := true;
          exit phones;
        end if;
      end if;
    end loop;
  end loop;
  if v_hit then v_found := v_found || 'phone'::text; end if;

  -- ── Website ──────────────────────────────────────────────────────────────────────────────
  v_hit := false;
  for v_source in
    select x.value
    from (values (v_brief ->> 'website'), (v_legal.website_url), (v_brand ->> 'website'),
                 (v_patch ->> 'website')) as x(value)
    where x.value is not null and btrim(x.value) <> ''
  loop
    v_value := lower(btrim(public.outbound_fact_decode(v_source)));
    v_host := public.outbound_fact_website_host(v_value);
    continue when v_host is null;
    select b into v_base from unnest(c_shared_hosts) as b
    where v_host = b or right(v_host, length(b) + 1) = '.' || b
    limit 1;
    if v_base is not null then
      v_seg := substring(regexp_replace(regexp_replace(v_value, '^[a-z][a-z0-9+.-]*://', ''), '^[^/@]*@', '')
                         from '^[^/?#]*/+([^/?#]+)');
      continue when v_seg is null;
      v_pattern := '(^|[^[:alnum:]@._-])([[:alnum:]-]+\.)*' || replace(v_base, '.', '\.') || '/+'
        || regexp_replace(v_seg, '([^[:alnum:]])', '\\\1', 'g')
        || '($|[^[:alnum:]._-]|\.($|[^[:alnum:]_-]))';
    else
      v_pattern := '(^|[^[:alnum:]@._-])([[:alnum:]-]+\.)*' || replace(v_host, '.', '\.')
        || '($|[^[:alnum:]._-]|\.($|[^[:alnum:]_-]))';
    end if;
    if lower(v_scan) ~ v_pattern and lower(v_owner_scan) !~ v_pattern then
      v_hit := true;
      exit;
    end if;
  end loop;
  if v_hit then v_found := v_found || 'website'::text; end if;

  return v_found;
end;
$$;

comment on function public.outbound_private_business_facts_found(uuid, text[], text[]) is
  'A1: which of the tenant''s registered address, business phone and website appear in customer-bound texts. Returns kinds only; a value the owner typed (owner_texts) is exempt, per value. Service-only; unknown tenants are refused; the caller refuses the draft on any finding or error.';

revoke all on function public.outbound_fact_decode(text) from public, anon, authenticated;
revoke all on function public.outbound_fact_street_text(text) from public, anon, authenticated;
revoke all on function public.outbound_fact_digit_runs(text) from public, anon, authenticated;
revoke all on function public.outbound_fact_website_host(text) from public, anon, authenticated;
revoke all on function public.outbound_private_business_facts_found(uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.outbound_private_business_facts_found(uuid, text[], text[]) to service_role;
