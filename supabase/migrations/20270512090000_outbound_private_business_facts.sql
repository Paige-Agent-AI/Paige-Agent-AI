-- A1 (owner rulings 2026-09-27 and 2026-09-28): the owner's registered address, business phone and
-- website may reach PAIGE for the owner's own use. In anything addressed to a customer, a phone or
-- website the owner confirmed in Setup may appear, because the owner supplied it there,
-- deliberately; anything else of the three is held back. This migration adds the check that later
-- callers use to hold such a draft back. It ships BEFORE the facts enter PAIGE's owner context
-- (A1-2), so there is never a moment when she holds them and nothing stands between them and a
-- customer.
--
-- outbound_private_business_facts_found(tenant, texts) answers one question: which of the three
-- facts, as this tenant has them stored and not licensed by Setup, appear in these customer-bound
-- texts? It returns the kinds found ('address', 'phone', 'website'), never a value, so a refusal
-- can say what matched without repeating it. NOTHING CALLS IT YET: A1-1b wires it into the
-- customer-bound exits, each refusing the draft on any finding and on any error. The approval card
-- keeps its own job: the owner sees every customer-bound draft before it sends.
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
-- WHAT SETUP LICENSES (owner ruling 2026-09-28). The exemption is keyed to Setup, never to the
-- draft or to what anyone typed in the conversation. Whether a phone or website is confirmed is
-- the spine's one answer, business_identity_readiness(): state 'owner_confirmed' from source
-- 'setup'. The value it licenses is the Setup record that answer names (the legal profile's
-- support_phone and website_url), and a draft carrying that value passes. Any other stored copy
-- (a legacy brand value, a proposal, a phone kept only in the private brief) is held back until
-- Setup confirms it. The confirmed phone is taken out of the draft before the stored numbers are
-- looked for, only where a whole written number is one of its forms, so a different number ending
-- in the same digits is still held back. A stored website found in the draft passes only when what
-- it matched is exactly the confirmed host, or on a shared platform the confirmed page, so a parent
-- domain, a sibling subdomain, a stored subdomain of the confirmed host, a host named inside the
-- confirmed link's query string, and a stored page under the confirmed host are still held back.
-- THE REGISTERED ADDRESS IS NEVER LICENSED. Confirming it in Setup states a legal fact about the
-- business, not consent to show it to customers, and for a solo operator it is often their home.
-- Only a "publicly shareable" state would license it, and Setup records no such state. Adding one
-- is a Setup change that goes back to the owner first; until then no address is licensed.
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
--             building word that follows another word ("Mill Lane", "Rose Cottage", "Mill
--             House"); or being the first line of the structured street ("The Grange"). For a line
--             that starts with a number, its core is looked for too: up to its first street word
--             after the number and one more word ("2 Mill Lane" from "2 Mill Lane Cottages",
--             "123 Main St" from "123 Main St Suite 400 Springfield") and up to its first suite
--             word. A number range adds each end. A postcode or "state ZIP" inside any line is
--             looked for on its own.
--             A house number of up to three digits on a line of its own ("12, Mill Lane") is joined
--             to the line after it, unless that line has its own number ("3/22 Acacia Avenue"), and
--             the line after it is looked for on its own as well.
--             NOT MATCHED: a town, district, county or country ("Leeds", "St. Louis", "Elk Grove",
--             "Covent Garden", "Hertfordshire"). In a single-line address a line with no digit is
--             a town when it follows the street line (the first line that starts with a number and
--             names a road, so neither "1st Floor" nor "2 Rose Cottage" is it). With no street line,
--             but a numbered house or building ("2 Rose Cottage"), the lines after it are towns
--             except the one right after it when that names a road ("Mill Lane", "Holly Grove");
--             with neither, a line is a town when it is one of the last two of three or more lines
--             that name a place (a postcode counts). The first line never is, and the stored city or
--             region always is. A numbered building is also looked for without its number. Nor a
--             line made only of
--             floor, suite or room words ("First Floor", "Suite 400", "Unit 3", "The Office"). Each
--             names a place or a room, not this business, and refusing it would refuse every
--             mention of it.
--             ALSO HELD BACK, named costs of reading wide: a district named like a road right after
--             a numbered building ("12 Mill House, Earls Court"); a phrase that is a numbered
--             building's name ("the coach house").
--             NOT LOOKED FOR: a line before the street line with no street or building word ("The
--             Old Rectory"), since it is as often the business's own name.
--   phone   — By any seven consecutive digits of a stored number. A stored value is split into
--             numbers at letters (so opening hours, labels, an extension and a second number do not
--             blur it), and every written form of a number, international or domestic, with or
--             without its area code, carries seven of its digits in a row. A value holding no number
--             of seven digits is looked for by its six-digit number ("13 20 00") at either end of a
--             run of digits in the text. A letter number
--             ("1-800-FLOWERS", "0800 FLOWERS") is looked for as written when it has three or more
--             digits. In the text, digits are joined across spaces, dots, brackets, plus signs,
--             slashes and dashes (up to four in a row).
--             NOT MATCHED: a number written in words, or in letters on one side only.
--             ALSO HELD BACK, a named cost of reading wide: a different number that shares seven
--             digits in a row with a stored one, typically the same area and exchange; and the
--             confirmed number when the text joins it to digits right after it ("… 0555 (9am"), or
--             a domestic trunk prefix other than 0.
--             NOT MATCHED either: a six-digit number in the middle of a run of digits.
--   website — By its host, without scheme, "www.", port or path, including any subdomain of it
--             ("shop.example.com"); international hosts are read as written; a stored value holding
--             prose or two addresses is read address by address.
--             NOT MATCHED: an e-mail address at the domain ("hello@example.com"), because that is a
--             different fact, already in PAIGE's shared context, and refusing it would refuse every
--             signed message; a longer domain that merely starts with the host; the same host in
--             punycode. On a shared platform (a booking, social, map or link-page host, or Paige's
--             own) the platform's host alone names nobody: a page there is matched by the host AND
--             its first path segment (two where the first is generic, as in
--             "linkedin.com/in/<name>" or "paigeagent.ai/book/<calendar>"), and a bare platform host
--             is not matched. A tenant's own subdomain of such a platform ("acme.paigeagent.ai") is
--             the tenant's host, matched as one, unless its label is one the platform uses itself
--             ("app", "business", "go", a country code).
--
-- AUTHORITY (§59). SECURITY DEFINER, because the private brief and the legal profile are closed to
-- browser callers, and because the spine's resolver is callable only from inside such a function.
-- EXECUTE is service_role only and the body refuses every other caller, the owner included: the
-- tenant is resolved by the server that calls it, never by a browser, and no signed-in caller gets
-- an oracle for any tenant's stored facts. An unknown tenant is refused, never read as "nothing
-- stored". It reads only the tenant it is given and returns only kinds. All five functions search
-- pg_catalog first and pg_temp last. The spine's resolver sets its own search path, which does not
-- name pg_temp, so a temporary type made in the calling session can break that call: the check
-- then raises, and the caller refuses the draft.

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
  p_texts text[]
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
    'app', 'm', 'mobile', 'web', 'maps', 'sites', 'business', 'meetings', 'music', 'vm', 'l', 'lm',
    'go', 'en', 'uk', 'us', 'de', 'fr', 'es', 'it', 'ca', 'au', 'nl', 'in', 'br', 'pt', 'ie', 'nz',
    'za', 'mx', 'jp', 'se', 'no', 'dk', 'pl'];
  -- A first path segment that names a kind of page, not its owner ("linkedin.com/in/<name>",
  -- and Paige's own "/book/<calendar>", "/store/<tenant>", "/portal/<tenant>", "/f/<form>").
  c_generic_segments constant text[] := array[
    'in', 'company', 'school', 'showcase', 'shop', 'channel', 'c', 'user', 'pages', 'people',
    'profile', 'biz', 'p', 'u', 'view', 'site', 's', 'l', 'maps', 'place', 'groups', 'events', 'e',
    'book', 'store', 'portal', 'f', 'form', 'forms', 'join', 'sign', 'legal'];
  c_street_words constant text :=
    '(st|ave|rd|blvd|dr|ln|ct|pl|sq|ter|hwy|pkwy|cres|cl|cir|trl|gdns|gdn|gr|aly|str|way|row|walk|'
    || 'mews|loop|cottage|house|farm|lodge|hall|manor|barn|mill|tower|plaza|bldg|estate|wharf|quay|'
    || 'yard|park|centre|gate|parade)';
  c_secondary_words constant text := '(ste|apt|unit|fl|rm|lvl|bldg|flat)';
  -- The two-digit E.164 country codes; 1 and 7 are the one-digit ones, every other code has three.
  c_two_digit_country_codes constant text[] := array['20','27','30','31','32','33','34','36','39','40',
    '41','43','44','45','46','47','48','49','51','52','53','54','55','56','57','58','60','61','62',
    '63','64','65','66','81','82','84','86','90','91','92','93','94','95','98'];
  -- Country codes whose numbers are dialled at home with a trunk 0. A country not listed gets no
  -- trunk-0 form, so its number written with one is held back rather than a different number
  -- taken for it.
  c_trunk_zero_country_codes constant text[] := array['20','27','31','32','33','40','41','43','44',
    '46','49','51','53','54','58','60','61','62','63','64','66','81','82','84','86','90','91','92',
    '93','94','95','98','212','213','233','234','254','255','256','260','263','353','355','358',
    '359','380','381','382','385','386','387','389','880','886','961','962','963','964','966','971',
    '972','977','249','251','264','373','374','421','855','976','994','995'];
  -- The street words that name a road, not a building or a district: only a numbered line with
  -- one of these is the street line ("2 Rose Cottage" and "1 Canary Wharf" are not).
  c_road_words constant text :=
    '(st|ave|rd|blvd|dr|ln|ct|pl|sq|ter|hwy|pkwy|cres|cl|cir|trl|gdns|gdn|gr|aly|str|way|row|walk|'
    || 'mews|loop|parade)';
  -- Words that name a building, not a road or a district.
  c_building_words constant text :=
    '(cottage|house|farm|lodge|hall|manor|barn|mill|tower|plaza|bldg|estate)';
  -- Words that on their own name a floor or a room, not a place ("First Floor", "Suite 400",
  -- "The Office"). A named house ("The Grange") is not one of them.
  c_room_words constant text :=
    '(the|ground|lower|upper|basement|mezzanine|top|back|front|rear|fl|lvl|ste|apt|unit|flat|rm|'
    || 'bldg|no|office|studio|workshop|shop|salon|clinic|lobby|reception|loft|annex|annexe|'
    || '[0-9]+[a-z]?|[0-9]+(st|nd|rd|th))';
  v_brand jsonb;
  v_brief jsonb;
  v_patch jsonb;
  v_private jsonb := '{}'::jsonb;
  v_legal public.tenant_legal_profile%rowtype;
  v_all text;
  v_raw text;
  v_scan text;
  v_text_street text;
  v_text_digits text;
  v_text_alnum text;
  v_licensed_phone text := '';
  v_licensed_phone_alnum text;
  v_licensed_numbers text[] := '{}'::text[];
  v_text_digits_masked text;
  v_licensed_site text := '';
  v_site_text text;
  v_site_keys text[] := '{}'::text[];
  v_mode text;
  v_numbered_at integer;
  v_joined text[];
  v_rest text[];
  v_cc text;
  v_building_at integer;
  v_place_count integer;
  v_place_i integer;
  v_is_place boolean;
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
  -- As written (a link inside a tag is seen), and with tags as spaces ("Baker<br>Street").
  v_scan := v_raw || E'\n' || regexp_replace(v_raw, '<[^>]*>', ' ', 'g');

  v_brief := coalesce(v_brand -> 'business_brief', '{}'::jsonb);
  v_patch := coalesce(v_brand -> 'business_brief_proposal' -> 'patch', '{}'::jsonb);
  select coalesce(pc.private_brief, '{}'::jsonb) into v_private
  from public.tenant_setup_private_context pc where pc.tenant_id = p_tenant;
  v_private := coalesce(v_private, '{}'::jsonb);
  select * into v_legal from public.tenant_legal_profile lp where lp.tenant_id = p_tenant;

  -- What the owner supplied (owner ruling, 2026-09-28): a phone or website the owner confirmed in
  -- Setup is theirs to share, so a draft carrying it passes. Whether it is confirmed is the spine's
  -- one answer, business_identity_readiness(); the value licensed is the Setup record it names.
  -- The registered address is never licensed: confirming it states a legal fact, not consent to
  -- share it, and Setup records no "publicly shareable" state for it.
  select coalesce(max(case when r.fact_key = 'business_phone' and r.state = 'owner_confirmed'
                           and r.source = 'setup' then v_legal.support_phone end), ''),
         coalesce(max(case when r.fact_key = 'website' and r.state = 'owner_confirmed'
                           and r.source = 'setup' then v_legal.website_url end), '')
  into v_licensed_phone, v_licensed_site
  from public.business_identity_readiness(p_tenant) as r;
  v_licensed_phone := public.outbound_fact_decode(v_licensed_phone);
  v_licensed_phone_alnum := regexp_replace(lower(v_licensed_phone), '[^[:alnum:]]', '', 'g');
  -- Decoded once, below, like every stored copy, so its keys are what a copy of it would give.
  v_licensed_site := lower(v_licensed_site);

  -- ── Address ──────────────────────────────────────────────────────────────────────────────
  v_text_street := public.outbound_fact_street_text(v_scan);
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
    -- A house number of up to three digits on a line of its own ("12, Mill Lane") belongs to the
    -- line after it, unless that line has its own number ("3/22 Acacia Avenue" is a unit and a
    -- street). The line after it is still looked for on its own too.
    v_joined := '{}'::text[];
    v_rest := '{}'::text[];
    v_i := 1;
    while v_i <= coalesce(array_length(v_parts, 1), 0) loop
      if v_i < array_length(v_parts, 1)
         and btrim(public.outbound_fact_street_text(v_parts[v_i]))
             ~ '^[0-9]{1,3}[a-z]?( [0-9]{1,3}[a-z]?)?$'
         and btrim(public.outbound_fact_street_text(v_parts[v_i + 1])) !~ '^[0-9]' then
        v_joined := v_joined || (v_parts[v_i] || ' ' || v_parts[v_i + 1]);
        v_rest := v_rest || v_parts[v_i + 1];
        v_i := v_i + 2;
      else
        v_joined := v_joined || v_parts[v_i];
        v_rest := v_rest || null::text;
        v_i := v_i + 1;
      end if;
    end loop;
    v_parts := v_joined;
    v_count := coalesce(array_length(v_parts, 1), 0);
    -- Where the numbered street line is: the first line that starts with a number and names a road
    -- ("10 Station Road"; not "1st Floor", nor a numbered house, "2 Rose Cottage"). Every line
    -- after it names a town, district, county, postcode or country, never the business.
    v_numbered_at := coalesce((
      select min(o) from unnest(v_parts) with ordinality as x(part, o)
      where btrim(public.outbound_fact_street_text(x.part)) ~ '^[0-9]'
        and btrim(public.outbound_fact_street_text(x.part)) ~ ('[[:alnum:]] ' || c_road_words || '\M')), 0);
    -- With no street line, a numbered house or building ("2 Rose Cottage"); the road line right
    -- after it is still the address.
    v_building_at := coalesce((
      select min(o) from unnest(v_parts) with ordinality as x(part, o)
      where btrim(public.outbound_fact_street_text(x.part)) ~ '^[0-9]'
        and exists (select 1
                    from unnest(string_to_array(btrim(public.outbound_fact_street_text(x.part)), ' ')) as w
                    where w !~ ('^' || c_room_words || '$'))), 0);
    -- With no street line, only the lines that name a place (a postcode among them) count towards
    -- the last two.
    v_place_count := (
      select count(*) from unnest(v_parts) as x(part)
      where btrim(public.outbound_fact_street_text(x.part)) ~ '^[0-9]{4,}( [0-9]+)?$'
         or exists (select 1
                    from unnest(string_to_array(btrim(public.outbound_fact_street_text(x.part)), ' ')) as w
                    where w !~ ('^' || c_room_words || '$')));
    v_place_i := 0;
    for v_i in 1 .. v_count loop
      v_part := v_parts[v_i];
      v_norm := btrim(public.outbound_fact_street_text(v_part));
      v_words := string_to_array(v_norm, ' ');
      v_cands := '{}'::text[];
      v_is_place := v_norm ~ '^[0-9]{4,}( [0-9]+)?$'
        or exists (select 1 from unnest(v_words) as w where w !~ ('^' || c_room_words || '$'));
      if v_is_place then v_place_i := v_place_i + 1; end if;
      -- The line itself, unless it names only a floor, a room or a town. In a single-line value
      -- a line with no number is a town when it follows the numbered street line; with no street
      -- line but a numbered house or building, when it follows that, unless it is the road right
      -- after it; with neither, when it is one of the last two of three place lines or more. (So
      -- the first line never is.)
      if length(v_norm) >= 6 and v_norm ~ '[[:alpha:]]'
         and v_is_place
         and not (v_norm = any(v_towns))
         and (v_norm ~ '[0-9]'
              or (v_kind = 'street' and v_i = 1)
              or (v_kind <> 'postal'
                  and (v_kind <> 'single'
                       or (v_numbered_at > 0 and v_i < v_numbered_at)
                       or (v_numbered_at = 0 and v_building_at > 0
                           and (v_i < v_building_at
                                or (v_i = v_building_at + 1
                                    and v_norm ~ ('[[:alnum:]] ' || c_road_words || '\M'))))
                       or (v_numbered_at = 0 and v_building_at = 0
                           and (v_place_count < 3 or v_place_i <= v_place_count - 2)))
                  and v_norm ~ ('[[:alnum:]] ' || c_street_words || '\M'))) then
        v_cands := v_cands || v_norm;
      end if;
      -- A line joined to the house number before it is also looked for on its own when it names a
      -- road ("Mill Lane"), and a numbered building without its number ("2 Rose Cottage" as "Rose
      -- Cottage", whether the number was on its own line or not).
      if v_rest[v_i] is not null then
        v_cand := btrim(public.outbound_fact_street_text(v_rest[v_i]));
        if v_cand ~ ('[[:alnum:]] ' || c_road_words || '\M')
           and not (v_cand = any(v_towns)) then
          v_cands := v_cands || v_cand;
        end if;
      end if;
      if v_norm ~ ('^[0-9]+[a-z]? .*[[:alnum:]] ' || c_building_words || '\M') then
        v_cands := v_cands || regexp_replace(v_norm, '^[0-9]+[a-z]? ', '');
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
        if position(' ' || v_cand || ' ' in v_text_street) > 0 then
          v_hit := true;
          exit sources;
        end if;
      end loop;
    end loop;
  end loop;
  if v_hit then v_found := v_found || 'address'::text; end if;

  -- ── Phone ────────────────────────────────────────────────────────────────────────────────
  v_text_digits := public.outbound_fact_digit_runs(v_scan);
  v_text_alnum := regexp_replace(lower(v_scan), '[^[:alnum:]]', '', 'g');
  -- The confirmed number is the owner's to share however the draft writes it, so it is taken out
  -- of the draft before any other stored number is looked for. Only a whole written number is
  -- taken out, and only when it is one of the confirmed number's forms. Stored with "+" or "00"
  -- ("+44 20 7946 0555"), the code's length is read from its first digits (E.164 codes are
  -- prefix-free), and the forms are the national number, with a trunk 0 where the country uses
  -- one, each with and without the code, "+" or "00" ("020…", "20…", "+44 20…", "+44 (0)20…").
  -- Stored without either ("020 7946 0131", "1 415 555 0132"), the forms are the number as
  -- stored, less a trunk 0, and, when that is eight digits or more, behind any country code. A
  -- different number that merely ends in the same digits is never a whole form, so it is still
  -- found. (Named limits: a number confirmed with the code of a country not on the trunk-0 list
  -- is held back when written with a 0; a number carrying all of a number confirmed without "+"
  -- behind another country code is taken for it; a number confirmed with its country code but no
  -- "+" is held back in its domestic form.)
  for v_run in
    select m[1]
    from regexp_matches(v_licensed_phone, '([+]?[0-9](?:[ ().+/-]{0,4}[0-9])*)', 'g') as m
  loop
    v_digits := regexp_replace(v_run, '[^0-9]', '', 'g');
    continue when length(v_digits) < 7;
    if v_run ~ '^[+]' or v_digits ~ '^00' then
      v_digits := regexp_replace(v_digits, '^00', '');
      v_j := case when v_digits ~ '^[17]' then 1
                  when left(v_digits, 2) = any(c_two_digit_country_codes) then 2
                  else 3 end;
      v_cc := left(v_digits, v_j);
      -- A leading 0 after the code is a trunk 0 only where the country uses one (Italy keeps its
      -- 0 from abroad too, so there it is part of the national number).
      v_key := case when v_cc = any(c_trunk_zero_country_codes)
                    then regexp_replace(substr(v_digits, v_j + 1), '^0', '')
                    else substr(v_digits, v_j + 1) end;
      continue when length(v_key) < 7;
      v_licensed_numbers := v_licensed_numbers || v_key || (v_cc || v_key) || ('00' || v_cc || v_key);
      -- A trunk 0 only where the country is known to use one; elsewhere a "0" in front would
      -- be a different number ("+34 612 345 678" is not "0612 345 678").
      if v_cc = any(c_trunk_zero_country_codes) then
        v_licensed_numbers := v_licensed_numbers || ('0' || v_key) || (v_cc || '0' || v_key)
          || ('00' || v_cc || '0' || v_key);
      end if;
    else
      v_key := regexp_replace(v_digits, '^0', '');
      v_licensed_numbers := v_licensed_numbers || v_digits || v_key;
      if length(v_key) >= 8 then
        v_licensed_numbers := v_licensed_numbers || ('(00)?[1-9][0-9]{0,2}0?' || v_key);
      end if;
    end if;
  end loop;
  -- The digit text is " run run … run ": a form is taken out only between two spaces. The
  -- trailing space is a lookahead, so a form written twice in a row is taken out both times.
  v_text_digits_masked := v_text_digits;
  foreach v_key in array v_licensed_numbers loop
    v_text_digits_masked := regexp_replace(v_text_digits_masked, ' ' || v_key || '(?= )', ' ', 'g');
  end loop;
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
        if position(v_seven in v_text_digits_masked) > 0 then
          v_hit := true;
          exit phones;
        end if;
      end loop;
    end loop;
    -- A short number ("13 20 00") when the value holds no longer one: at either end of a run of
    -- digits, since the text joins digits across a separator ("13 20 00 - 9am" is one run).
    if not v_any_number then
      for v_run in
        select m[1] from regexp_matches(v_value, '([0-9](?:[ ().+/-]{0,4}[0-9])*)', 'g') as m
      loop
        v_digits := regexp_replace(v_run, '[^0-9]', '', 'g');
        continue when length(v_digits) <> 6;
        if v_text_digits_masked ~ (' ' || v_digits || '|' || v_digits || ' ') then
          v_hit := true;
          exit phones;
        end if;
      end loop;
    end if;
    -- A letter number ("1-800-FLOWERS", "0800 FLOWERS"), looked for as written.
    for v_key in
      select regexp_replace(m[1], '[^[:alnum:]]', '', 'g')
      from regexp_matches(v_value, '([0-9][0-9 .-]*[a-z]{2,}[0-9]*)', 'g') as m
    loop
      continue when length(v_key) < 6 or length(regexp_replace(v_key, '[^0-9]', '', 'g')) < 3;
      if position(v_key in v_text_alnum) > 0 and position(v_key in v_licensed_phone_alnum) = 0 then
        v_hit := true;
        exit phones;
      end if;
    end loop;
  end loop;
  if v_hit then v_found := v_found || 'phone'::text; end if;

  -- ── Website ──────────────────────────────────────────────────────────────────────────────
  -- The confirmed website names its keys first: its own host, or on a shared platform its own
  -- page. Every other stored copy is then looked for in the draft, and a match counts unless what
  -- it matched is exactly one of those keys. So a parent domain, a sibling subdomain, a stored
  -- subdomain of the confirmed host, a host inside the confirmed link's query string, and a
  -- stored page under the confirmed host are all still found. The confirmed record, and any other
  -- stored copy of the same host or page, is skipped by its key: anything on its own host is the
  -- owner's.
  v_hit := false;
  v_site_text := lower(v_scan);
  <<websites>>
  for v_source, v_mode in
    select x.value, x.mode
    from (values (v_licensed_site, 'key', 0), (v_brief ->> 'website', 'find', 1),
                 (v_legal.website_url, 'find', 2),
                 (v_brand ->> 'website', 'find', 3), (v_patch ->> 'website', 'find', 4))
         as x(value, mode, ord)
    where x.value is not null and btrim(x.value) <> ''
    order by x.ord
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
        v_seg1 := rtrim(split_part(v_path, '/', 1), '.');
        v_seg2 := rtrim(split_part(v_path, '/', 2), '.');
        continue when v_seg1 = '';
        if v_seg1 = any(c_generic_segments) then
          continue when v_seg2 = '';
          v_key := v_base || '/' || v_seg1 || '/' || v_seg2;
          v_pattern := regexp_replace(v_seg1, '([^[:alnum:]])', '\\\1', 'g') || '/+'
            || regexp_replace(v_seg2, '([^[:alnum:]])', '\\\1', 'g');
        else
          v_key := v_base || '/' || v_seg1;
          v_pattern := regexp_replace(v_seg1, '([^[:alnum:]])', '\\\1', 'g');
        end if;
        v_pattern := '(^|[^[:alnum:]@._-])(([[:alnum:]-]+\.)*' || replace(v_base, '.', '\.') || '/+'
          || v_pattern || ')(?=$|[^[:alnum:]._-]|\.($|[^[:alnum:]_-]))';
      else
        v_key := v_host;
        v_pattern := '(^|[^[:alnum:]@._-])(([[:alnum:]-]+\.)*' || replace(v_host, '.', '\.')
          || ')(?=$|[^[:alnum:]._-]|\.($|[^[:alnum:]_-]))';
      end if;
      if v_mode = 'key' then
        v_site_keys := v_site_keys || v_key;
        continue;
      end if;
      -- A stored copy of the confirmed host or page is the confirmed value.
      continue when v_key = any(v_site_keys);
      -- What each occurrence matched, without "www." and with its slashes single, must be exactly
      -- a confirmed key to pass.
      for v_cand in
        select regexp_replace(regexp_replace(m[2], '^www\.', ''), '/+', '/', 'g')
        from regexp_matches(v_site_text, v_pattern, 'g') as m
      loop
        if not (v_cand = any(v_site_keys)) then
          v_hit := true;
          exit websites;
        end if;
      end loop;
    end loop;
  end loop;
  if v_hit then v_found := v_found || 'website'::text; end if;

  return v_found;
end;
$$;

comment on function public.outbound_private_business_facts_found(uuid, text[]) is
  'A1: which of the tenant''s registered address, business phone and website appear in customer-bound texts, other than a phone or website the owner confirmed in Setup (business_identity_readiness). Returns kinds only. Service-only; unknown tenants and over-long text are refused; the caller refuses the draft on any finding or error.';

revoke all on function public.outbound_fact_decode(text) from public, anon, authenticated;
revoke all on function public.outbound_fact_street_text(text) from public, anon, authenticated;
revoke all on function public.outbound_fact_digit_runs(text) from public, anon, authenticated;
revoke all on function public.outbound_fact_website_host(text) from public, anon, authenticated;
revoke all on function public.outbound_private_business_facts_found(uuid, text[]) from public, anon, authenticated;
grant execute on function public.outbound_private_business_facts_found(uuid, text[]) to service_role;
