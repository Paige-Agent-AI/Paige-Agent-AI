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
--             (business_brief_proposal.patch, which may hold only the single-line address). The
--             stored city and region are read too, only to recognise a town line (below).
--   phone   — tenant_legal_profile.support_phone; the private Setup brief's phone; the legacy brand
--             copies (phone, business_phone, business_brief.phone); a staged proposal's phone. Not
--             the authorized representative's own phone: it is not one of the three ruled facts.
--   website — business_brief.website, tenant_legal_profile.website_url, brand.website, and a
--             staged proposal's website.
--
-- READING THE TEXT. Customer-bound text may be HTML e-mail. Entities are decoded (named and
-- numeric), URL escapes of printable ASCII are decoded, Unicode spaces, dashes, apostrophes and
-- full-width, Arabic-Indic and Devanagari digits are mapped to plain forms, and zero-width and
-- bidirectional marks are removed. Every fact is then looked for twice: in that decoded text as
-- written (so a link inside a tag is seen) and with its tags replaced by spaces (so
-- "221B<br>Baker Street" is seen). More than 256 KB of customer text is refused, not read.
--
-- HOW A FACT IS FOUND.
--   address — Stored copies are split into lines on commas, semicolons, new lines, "|", "/" and a
--             spaced dash. Both sides are lower-cased, accents dropped, apostrophes removed, every
--             other non-letter/digit made a space, and common words normalised (street→st,
--             fifth→5th, saint→st, north west→nw, P.O. Box→po box, …). A line is looked for when it
--             has six or more characters and a letter, and also one of: a digit; a street or
--             building word that follows another word ("Mill Lane", "Rose Cottage"); or being the
--             first line of the structured street. For a line that starts with a number, its core is
--             looked for too: up to its first street word after the number and one more word
--             ("2 Mill Lane" from "2 Mill Lane Cottages", "123 Main St" from "123 Main St Suite 400
--             Springfield") and up to its first suite word. A
--             number range adds each end. A postcode or "state ZIP" inside any line is looked for on
--             its own.
--             NOT MATCHED: a town, district or region on its own ("Leeds", "St. Louis", "Elk Grove",
--             "Canary Wharf"). A line with no digit is never taken from the last two lines of a
--             single-line address (where the town and region sit), nor when it is the stored city
--             or region. Nor a line made only of floor or suite words ("First Floor", "Suite 400",
--             "Unit 3") or a bare "the <word>" ("The Office"). Each names a place or a room, not this
--             business, and refusing it would refuse every mention of it.
--   phone   — By any seven consecutive digits of a stored number. A stored value is split into
--             numbers at letters (so opening hours, labels, an extension and a second number do not
--             blur it), and every written form of a number, international or domestic, with or
--             without its area code, carries seven of its digits in a row. A stored value with no
--             number of seven digits ("1-800-FLOWERS") is looked for as written, when its letter
--             number has three or more digits. In the text, digits are joined across spaces, dots,
--             brackets, plus signs, slashes and dashes (up to four in a row).
--             NOT MATCHED: a number written in words, or in letters on one side only.
--   website — By its host, without scheme, "www.", port or path, including any subdomain of it
--             ("shop.example.com"); international hosts are read as written; a stored value holding
--             prose or two addresses is read address by address.
--             NOT MATCHED: an e-mail address at the domain ("hello@example.com"), because that is a
--             different fact, already in PAIGE's shared context, and refusing it would refuse every
--             signed message; a longer domain that merely starts with the host; the same host in
--             punycode. On a shared platform (a booking, social, map or link-page host, or Paige's
--             own) the platform's host alone names nobody: a page there is matched by the host AND
--             its first path segment (two segments where the first is generic, as in
--             "linkedin.com/in/<name>"), and a bare platform host is not matched. A tenant's own
--             subdomain of such a platform ("acme.paigeagent.ai") is the tenant's host, matched as
--             one.
--
-- OWNER-PUT (interim rule (a), until the owner rules on (a)/(b)). A value that also appears in
-- owner_texts (what the owner typed on this turn) is not reported: the owner put it there. The
-- exemption is per value, never per kind: typing one stored address does not license another. For
-- a phone it is per seven-digit run, so a number the owner typed in one form and the draft carries
-- in another is still held back.
--
-- AUTHORITY (§59). SECURITY DEFINER, because the private brief and the legal profile are closed to
-- browser callers. EXECUTE is service_role only and the body refuses every other caller, the
-- owner included: the tenant is resolved by the server that calls it, never by a browser, and no
-- signed-in caller gets an oracle for any tenant's stored facts. An unknown tenant is refused,
-- never read as "nothing stored". It reads only the tenant it is given and returns only kinds. All
-- five functions search pg_catalog first and pg_temp last, so no temporary type or function can
-- shadow what they use.

create or replace function public.outbound_fact_decode(p_text text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
declare
  v text := p_text;
  v_code text;
  v_pieces text[];
  v_codes text[];
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
  -- Numeric entities in one pass (the text split around them and rejoined in order), so the
  -- cost stays linear however many different entities the text carries. An entity naming no
  -- character is kept as written.
  v_pieces := regexp_split_to_array(v, '&#(?:x[0-9a-f]{1,6}|[0-9]{1,7});', 'i');
  if array_length(v_pieces, 1) > 1 then
    v_codes := array(select m[1] from regexp_matches(v, '&#(x[0-9a-f]{1,6}|[0-9]{1,7});', 'gi') as m);
    select string_agg(
             p.piece || coalesce(
               case when e.n between 1 and 1114111 and e.n not between 55296 and 57343 then chr(e.n)
                    else '&#' || e.code || ';' end, ''),
             '' order by p.ord)
    into v
    from unnest(v_pieces) with ordinality as p(piece, ord)
    left join (
      select c.code, c.ord,
             case when lower(left(c.code, 1)) = 'x'
                  then ('x' || lpad(substr(c.code, 2), 8, '0'))::bit(32)::integer
                  else c.code::integer end as n
      from unnest(v_codes) with ordinality as c(code, ord)
    ) as e on e.ord = p.ord;
  end if;
  for v_code in
    select distinct m[1] from regexp_matches(v, '%([2-7][0-9a-f])', 'gi') as m
  loop
    v := replace(v, '%' || v_code, chr(('x' || lpad(v_code, 8, '0'))::bit(32)::integer));
  end loop;
  -- Spaces, dashes, apostrophes, digits of other scripts and full-width punctuation to plain
  -- forms; zero-width and bidirectional marks (everything after the last mapped character) removed.
  v := translate(v,
    U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\202F\205F\3000'
    || U&'\2010\2011\2012\2013\2014\2015\2212\FE58\FE63\FF0D'
    || U&'\2018\2019\02BC\FF07'
    || U&'\FF10\FF11\FF12\FF13\FF14\FF15\FF16\FF17\FF18\FF19'
    || U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669'
    || U&'\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9'
    || U&'\0966\0967\0968\0969\096A\096B\096C\096D\096E\096F'
    || U&'\00B7\2024\FF0E\FF20\FF0B\FF08\FF09\FF0F\FF1A'
    || U&'\00AD\200B\200C\200D\2060\FEFF\200E\200F\202A\202B\202C\202D\202E\2066\2067\2068\2069',
    '                ' || '----------' || '''''''''' || '0123456789' || '0123456789' || '0123456789'
    || '0123456789' || '...@+()/:');
  return v;
end;
$$;

create or replace function public.outbound_fact_street_text(p_text text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
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
  v := regexp_replace(v, '\m(p o box|post office box|pobox|pob)\M', 'po box', 'g');
  foreach v_pair slice 1 in array array[
    ['street','st'], ['avenue','ave'], ['av','ave'], ['road','rd'], ['boulevard','blvd'],
    ['drive','dr'], ['lane','ln'], ['court','ct'], ['place','pl'], ['square','sq'],
    ['terrace','ter'], ['highway','hwy'], ['parkway','pkwy'], ['crescent','cres'], ['close','cl'],
    ['circle','cir'], ['trail','trl'], ['gardens','gdns'], ['garden','gdn'], ['grove','gr'],
    ['alley','aly'], ['strasse','str'], ['saint','st'], ['mount','mt'], ['fort','ft'],
    ['center','centre'], ['suite','ste'], ['apartment','apt'], ['floor','fl'],
    ['building','bldg'], ['room','rm'], ['level','lvl'], ['number','no'],
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
set search_path = pg_catalog, pg_temp
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
set search_path = pg_catalog, pg_temp
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
set search_path = pg_catalog, pg_temp
as $$
declare
  c_max_text constant integer := 262144;
  -- Shared platforms, whose host alone names nobody.
  c_shared_hosts constant text[] := array[
    'paigeagent.ai', 'calendly.com', 'cal.com', 'tidycal.com', 'hubspot.com', 'instagram.com',
    'facebook.com', 'fb.com', 'linkedin.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com',
    'youtu.be', 'linktr.ee', 'beacons.ai', 'stan.store', 'etsy.com', 'medium.com', 'pinterest.com',
    'threads.net', 'wa.me', 't.me', 'google.com', 'g.page', 'bit.ly', 'yelp.com', 'notion.so',
    'gumroad.com'];
  -- A subdomain label that is still the platform, not a tenant ("app.paigeagent.ai").
  c_shared_labels constant text[] := array[
    'app', 'm', 'mobile', 'web', 'maps', 'sites', 'business', 'meetings', 'l', 'lm', 'go',
    'en', 'uk', 'us', 'de', 'fr', 'es', 'it', 'ca', 'au'];
  -- A first path segment that names a kind of page, not its owner ("linkedin.com/in/<name>").
  c_generic_segments constant text[] := array[
    'in', 'company', 'school', 'showcase', 'shop', 'channel', 'c', 'user', 'pages', 'people',
    'profile', 'biz', 'p', 'u', 'view', 'site', 's', 'l', 'maps', 'place', 'groups', 'events', 'e'];
  c_street_words constant text :=
    '(st|ave|rd|blvd|dr|ln|ct|pl|sq|ter|hwy|pkwy|cres|cl|cir|trl|gdns|gdn|gr|aly|str|way|row|walk|'
    || 'mews|loop|cottage|house|farm|lodge|hall|manor|barn|mill|tower|plaza|bldg|estate|wharf|quay|'
    || 'yard|park|centre|gate|parade)';
  c_secondary_words constant text := '(ste|apt|unit|fl|rm|lvl|bldg|flat)';
  -- Words that on their own name a floor or a room, not a place.
  c_room_words constant text :=
    '(the|ground|lower|upper|basement|mezzanine|top|fl|lvl|ste|apt|unit|flat|rm|bldg|no|office|'
    || 'studio|[0-9]+[a-z]?|[0-9]+(st|nd|rd|th))';
  v_brand jsonb;
  v_brief jsonb;
  v_patch jsonb;
  v_private jsonb := '{}'::jsonb;
  v_legal public.tenant_legal_profile%rowtype;
  v_all text;
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
  v_towns text[];
  v_source text;
  v_kind text;
  v_parts text[];
  v_count integer;
  v_i integer;
  v_j integer;
  v_part text;
  v_norm text;
  v_words text[];
  v_cands text[];
  v_cand text;
  v_match text[];
  v_value text;
  v_run text;
  v_digits text;
  v_seven text;
  v_any_number boolean;
  v_key text;
  v_token text;
  v_host text;
  v_base text;
  v_path text;
  v_seg1 text;
  v_seg2 text;
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
  v_all := coalesce(array_to_string(p_texts, E'\n'), '');
  if length(v_all) > c_max_text then
    raise exception 'OUTBOUND_FACTS_TEXT_TOO_LONG' using errcode = '22023';
  end if;
  v_raw := public.outbound_fact_decode(v_all);
  if btrim(v_raw) = '' then
    return v_found;
  end if;
  -- The owner's text only ever exempts, so reading less of it only holds more back.
  v_owner_raw := public.outbound_fact_decode(
    left(coalesce(array_to_string(p_owner_texts, E'\n'), ''), c_max_text));
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
  v_towns := array(
    select btrim(public.outbound_fact_street_text(public.outbound_fact_decode(x)))
    from unnest(array[v_legal.registered_city, v_legal.registered_region,
                      v_private ->> 'registeredCity', v_private ->> 'registeredRegion']) as x
    where x is not null and btrim(x) <> '');
  v_hit := false;
  <<sources>>
  for v_source, v_kind in
    select x.value, x.kind
    from (values
      (v_legal.registered_street, 'street'), (v_private ->> 'registeredStreet', 'street'),
      (v_legal.registered_street_secondary, 'line'), (v_private ->> 'registeredStreetSecondary', 'line'),
      (v_legal.registered_postal_code, 'postal'), (v_private ->> 'registeredPostalCode', 'postal'),
      (v_legal.registered_address, 'single'), (v_private ->> 'address', 'single'),
      (v_brand ->> 'address', 'single'), (v_brief ->> 'address', 'single'),
      (v_patch ->> 'address', 'single')
    ) as x(value, kind)
    where x.value is not null and btrim(x.value) <> ''
  loop
    v_parts := array(
      select btrim(p)
      from regexp_split_to_table(public.outbound_fact_decode(v_source),
                                 '[,;|/\n\r]+|[[:space:]]+-[[:space:]]+') as p
      where btrim(p) <> '');
    v_count := coalesce(array_length(v_parts, 1), 0);
    for v_i in 1 .. v_count loop
      v_part := v_parts[v_i];
      v_norm := btrim(public.outbound_fact_street_text(v_part));
      v_words := string_to_array(v_norm, ' ');
      v_cands := '{}'::text[];
      -- The line itself, unless it names only a floor, a room or a town.
      if length(v_norm) >= 6 and v_norm ~ '[[:alpha:]]'
         and v_norm !~ '^the [a-z]+$'
         and exists (select 1 from unnest(v_words) as w where w !~ ('^' || c_room_words || '$'))
         and not (v_norm = any(v_towns))
         and (v_norm ~ '[0-9]'
              or (v_kind = 'street' and v_i = 1)
              or (v_kind <> 'postal' and (v_kind <> 'single' or v_i <= v_count - 2)
                  and v_norm ~ ('[[:alnum:]] ' || c_street_words || '\M'))) then
        v_cands := v_cands || v_norm;
      end if;
      -- A postcode, or a state and ZIP, inside the line.
      v_cands := v_cands || array(
        select m[1] from regexp_matches(v_norm,
          '\m([a-z]{1,2}[0-9][a-z0-9]? [0-9][a-z]{2}|[a-z][0-9][a-z] [0-9][a-z][0-9]|[a-z]{2} [0-9]{5})\M', 'g') as m);
      if v_norm ~ '^[0-9]' then
        -- A range adds each end.
        if v_part ~ '^[[:space:]]*[0-9]+[[:alpha:]]?[[:space:]]*-[[:space:]]*[0-9]+' then
          v_match := regexp_match(v_norm, '^([0-9]+[a-z]?) ([0-9]+[a-z]?) (.+)$');
          if v_match is not null then
            v_cands := v_cands || (v_match[1] || ' ' || v_match[3]) || (v_match[2] || ' ' || v_match[3]);
          end if;
        end if;
        -- Its core: up to its first street word, three words at least (so "100 St Marys Gate"
        -- does not yield "100 st"), and up to its first suite word. The shortest core is enough:
        -- a draft that carries a longer one carries it too.
        for v_j in 3 .. coalesce(array_length(v_words, 1), 0) loop
          if v_words[v_j] ~ ('^' || c_street_words || '$') then
            v_cands := v_cands || array_to_string(v_words[1:v_j], ' ');
            exit;
          end if;
        end loop;
        for v_j in 3 .. coalesce(array_length(v_words, 1), 0) loop
          if v_words[v_j] ~ ('^' || c_secondary_words || '$') then
            v_cands := v_cands || array_to_string(v_words[1:v_j - 1], ' ');
            exit;
          end if;
        end loop;
      end if;
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
    v_any_number := false;
    -- Each number: digits joined across the usual separators, broken at any letter.
    for v_run in
      select m[1] from regexp_matches(v_value, '([0-9](?:[ ().+/-]{0,4}[0-9])*)', 'g') as m
    loop
      v_digits := regexp_replace(v_run, '[^0-9]', '', 'g');
      continue when length(v_digits) < 7;
      v_any_number := true;
      for v_j in 1 .. length(v_digits) - 6 loop
        v_seven := substr(v_digits, v_j, 7);
        if position(v_seven in v_text_digits) > 0 and position(v_seven in v_owner_digits) = 0 then
          v_hit := true;
          exit phones;
        end if;
      end loop;
    end loop;
    continue when v_any_number;
    -- No number of seven digits: a letter number, looked for as written.
    for v_key in
      select regexp_replace(m[1], '[^[:alnum:]]', '', 'g')
      from regexp_matches(v_value, '([0-9][0-9a-z.-]*[a-z][0-9a-z.-]*)', 'g') as m
    loop
      continue when length(v_key) < 6 or length(regexp_replace(v_key, '[^0-9]', '', 'g')) < 3;
      if position(v_key in v_text_alnum) > 0 and position(v_key in v_owner_alnum) = 0 then
        v_hit := true;
        exit phones;
      end if;
    end loop;
  end loop;
  if v_hit then v_found := v_found || 'phone'::text; end if;

  -- ── Website ──────────────────────────────────────────────────────────────────────────────
  v_hit := false;
  <<websites>>
  for v_source in
    select x.value
    from (values (v_brief ->> 'website'), (v_legal.website_url), (v_brand ->> 'website'),
                 (v_patch ->> 'website')) as x(value)
    where x.value is not null and btrim(x.value) <> ''
  loop
    for v_token in
      select t from regexp_split_to_table(lower(btrim(public.outbound_fact_decode(v_source))),
                                          '[[:space:],;|]+') as t
      where t <> ''
    loop
      v_host := public.outbound_fact_website_host(v_token);
      continue when v_host is null;
      select b into v_base from unnest(c_shared_hosts) as b
      where v_host = b or right(v_host, length(b) + 1) = '.' || b
      order by length(b) desc
      limit 1;
      -- A subdomain of a platform is the tenant's own host, unless it is one of the platform's.
      if v_base is not null and v_host <> v_base
         and not (v_host = split_part(v_host, '.', 1) || '.' || v_base
                  and split_part(v_host, '.', 1) = any(c_shared_labels)) then
        v_base := null;
      end if;
      if v_base is not null then
        v_path := coalesce(substring(regexp_replace(regexp_replace(v_token, '^[a-z][a-z0-9+.-]*://', ''),
                                                    '^[^/@]*@', '')
                                     from '^[^/?#]*/+([^?#]*)'), '');
        v_seg1 := split_part(v_path, '/', 1);
        v_seg2 := split_part(v_path, '/', 2);
        continue when v_seg1 = '';
        if v_seg1 = any(c_generic_segments) then
          continue when v_seg2 = '';
          v_pattern := regexp_replace(v_seg1, '([^[:alnum:]])', '\\\1', 'g') || '/+'
            || regexp_replace(v_seg2, '([^[:alnum:]])', '\\\1', 'g');
        else
          v_pattern := regexp_replace(v_seg1, '([^[:alnum:]])', '\\\1', 'g');
        end if;
        v_pattern := '(^|[^[:alnum:]@._-])([[:alnum:]-]+\.)*' || replace(v_base, '.', '\.') || '/+'
          || v_pattern || '($|[^[:alnum:]._-]|\.($|[^[:alnum:]_-]))';
      else
        v_pattern := '(^|[^[:alnum:]@._-])([[:alnum:]-]+\.)*' || replace(v_host, '.', '\.')
          || '($|[^[:alnum:]._-]|\.($|[^[:alnum:]_-]))';
      end if;
      if lower(v_scan) ~ v_pattern and lower(v_owner_scan) !~ v_pattern then
        v_hit := true;
        exit websites;
      end if;
    end loop;
  end loop;
  if v_hit then v_found := v_found || 'website'::text; end if;

  return v_found;
end;
$$;

comment on function public.outbound_private_business_facts_found(uuid, text[], text[]) is
  'A1: which of the tenant''s registered address, business phone and website appear in customer-bound texts. Returns kinds only; a value the owner typed (owner_texts) is exempt, per value. Service-only; unknown tenants and over-long text are refused; the caller refuses the draft on any finding or error.';

revoke all on function public.outbound_fact_decode(text) from public, anon, authenticated;
revoke all on function public.outbound_fact_street_text(text) from public, anon, authenticated;
revoke all on function public.outbound_fact_digit_runs(text) from public, anon, authenticated;
revoke all on function public.outbound_fact_website_host(text) from public, anon, authenticated;
revoke all on function public.outbound_private_business_facts_found(uuid, text[], text[]) from public, anon, authenticated;
grant execute on function public.outbound_private_business_facts_found(uuid, text[], text[]) to service_role;
