-- pgcrypto lives in `extensions`; a function that pins a search_path without it cannot call pgcrypto
-- unqualified. Rollback-only proof against a database with every migration applied (CI:
-- paige-spine-contract › database-contract). Synthetic rows only; everything rolls back.
--
-- Two halves:
--   1. BEHAVIOUR — the signer side of agreements actually runs: an owner issues a link, the
--      anonymous signer opens it, declines it, and the dead link no longer opens. Plus the
--      invitation redeemer, restated by the same migration. No stand-in `public.digest` anywhere:
--      before 20271110040000 every call below fails with `function digest(...) does not exist`.
--   2. CATALOG — no public function with a pinned search_path lacking pgcrypto's schema calls a
--      pgcrypto function unqualified, so the class cannot come back in a new function.
begin;
create function pg_temp.check_true(v boolean, label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create function pg_temp.refused(stmt text, code text, label text) returns void language plpgsql as $$
begin begin execute stmt; exception when others then if sqlstate = code then raise notice 'PASS: %', label; return; end if;
raise exception 'FAIL: % unexpected %: %', label, sqlstate, sqlerrm; end; raise exception 'FAIL: % accepted', label; end $$;
do $$ begin
  execute format('grant usage on schema %I to anon, authenticated', (select nspname from pg_namespace where oid = pg_my_temp_schema()));
end $$;
grant execute on function pg_temp.check_true(boolean,text), pg_temp.refused(text,text,text) to anon, authenticated;
create temp table r(k text primary key, v jsonb);
grant select, insert on r to anon, authenticated;

-- ── Fixture: one business, its owner, one client with no email (so the counterparty trigger seeds
--    nobody), one draft text agreement, and one signer added explicitly.
insert into auth.users(id, aud, role, email) values
 ('9c700000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'pgc-owner@tests.invalid'),
 ('9c700000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'pgc-invitee@tests.invalid'),
 ('9c700000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'pgc-stranger@tests.invalid');
insert into public.tenants(id, slug, name, status, account_type, account_number_prefix, account_number, features) values
 ('9c700000-0000-4000-8000-00000000aaaa', 'test-pgcrypto-signing', 'Test pgcrypto signing', 'active', 'standalone', 'PGC', 9970001, '{}');
insert into public.tenant_members(tenant_id, user_id, role, status, is_owner, joined_at) values
 ('9c700000-0000-4000-8000-00000000aaaa', '9c700000-0000-4000-8000-000000000001', 'owner', 'active', true, now());
insert into public.profiles(user_id, active_tenant_id) values
 ('9c700000-0000-4000-8000-000000000001', '9c700000-0000-4000-8000-00000000aaaa')
on conflict (user_id) do update set active_tenant_id = excluded.active_tenant_id;
insert into public.clients(id, tenant_id, created_by, first_name, last_name, account_number) values
 ('9c700000-0000-4000-8000-0000000c0001', '9c700000-0000-4000-8000-00000000aaaa', '9c700000-0000-4000-8000-000000000001', 'Test', 'Signer', 'PGC-C1');
insert into public.paige_agreements(id, tenant_id, contact_id, title, body_source, body_markdown, created_by) values
 ('9c700000-0000-4000-8000-0000000a0001', '9c700000-0000-4000-8000-00000000aaaa', '9c700000-0000-4000-8000-0000000c0001',
  'Test engagement letter', 'paige_draft', 'Synthetic body for the pgcrypto proof.', '9c700000-0000-4000-8000-000000000001');
insert into public.paige_agreement_signers(id, agreement_id, tenant_id, full_name, email, signer_role, signing_order) values
 ('9c700000-0000-4000-8000-0000000b0001', '9c700000-0000-4000-8000-0000000a0001', '9c700000-0000-4000-8000-00000000aaaa',
  'Test Signer', 'pgc-signer@tests.invalid', 'counterparty', 1);

select pg_temp.check_true(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                       where n.nspname = 'public' and p.proname in ('digest', 'gen_random_bytes')),
  'no public stand-in for pgcrypto exists, so the calls below exercise the real resolution');

-- ── 1a. The owner issues a link.
select set_config('request.jwt.claim.sub', '9c700000-0000-4000-8000-000000000001', true);
set local role authenticated;
insert into r select 'issued', public.issue_agreement_signing_link(
  '9c700000-0000-4000-8000-00000000aaaa', '9c700000-0000-4000-8000-0000000a0001', 7);
reset role;
select pg_temp.check_true((select v ->> 'token' ~ '^[0-9a-f]{64}$' from r where k = 'issued'),
  'issue_agreement_signing_link returns a 64-hex token');
select pg_temp.check_true((select s.token_hash = encode(extensions.digest(r.v ->> 'token', 'sha256'), 'hex')
                             from public.paige_agreement_signers s, r
                            where s.id = '9c700000-0000-4000-8000-0000000b0001' and r.k = 'issued'),
  'only the SHA-256 of the token is stored on the signer');
select pg_temp.check_true((select status = 'sent' and content_sha256 = encode(extensions.digest('Synthetic body for the pgcrypto proof.', 'sha256'), 'hex')
                             from public.paige_agreements where id = '9c700000-0000-4000-8000-0000000a0001'),
  'the agreement moved to sent with the digest of its body frozen');

-- ── 1b. The signer, anonymous, opens it.
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
insert into r select 'peek', to_jsonb(p) from public.peek_agreement_signing((select v ->> 'token' from r where k = 'issued')) p;
reset role;
select pg_temp.check_true((select (v ->> 'is_valid')::boolean and v ->> 'document_title' = 'Test engagement letter'
                                  and v ->> 'signer_display_name' = 'Test Signer' from r where k = 'peek'),
  'peek_agreement_signing opens the issued link as anon');
select pg_temp.check_true((select status = 'viewed' from public.paige_agreement_signers where id = '9c700000-0000-4000-8000-0000000b0001'),
  'the open is recorded once on the signer');

-- ── 1c. The signer declines it.
set local role anon;
insert into r select 'decline', public.decline_agreement_signing((select v ->> 'token' from r where k = 'issued'), 'Not this quarter');
insert into r select 'peek_after', to_jsonb(p) from public.peek_agreement_signing((select v ->> 'token' from r where k = 'issued')) p;
reset role;
select pg_temp.check_true((select (v ->> 'ok')::boolean from r where k = 'decline'),
  'decline_agreement_signing accepts the live link');
select pg_temp.check_true((select a.status = 'declined' and s.status = 'declined' and s.token_revoked_at is not null
                             from public.paige_agreements a join public.paige_agreement_signers s on s.agreement_id = a.id
                            where a.id = '9c700000-0000-4000-8000-0000000a0001'),
  'the decline ends the agreement and revokes the link');
select pg_temp.check_true((select not (v ->> 'is_valid')::boolean from r where k = 'peek_after'),
  'the declined link no longer opens');
set local role anon;
insert into r select 'decline_replay', public.decline_agreement_signing((select v ->> 'token' from r where k = 'issued'), null);
insert into r select 'peek_unknown', to_jsonb(p) from public.peek_agreement_signing(repeat('ab', 32)) p;
reset role;
select pg_temp.check_true((select not (v ->> 'ok')::boolean from r where k = 'decline_replay'),
  'a replayed decline changes nothing');
select pg_temp.check_true((select not (v ->> 'is_valid')::boolean from r where k = 'peek_unknown'),
  'an unknown well-formed token is refused, not an error');

-- ── 1d. The invitation redeemer runs, and keeps both of its guards.
insert into public.invitations(email, role, invited_by, token, expires_at, tenant_id) values
 ('pgc-invitee@tests.invalid', 'user', '9c700000-0000-4000-8000-000000000001', 'pgc-invite-token', now() + interval '1 day',
  '9c700000-0000-4000-8000-00000000aaaa');
select set_config('request.jwt.claim.sub', '9c700000-0000-4000-8000-000000000003', true);
set local role authenticated;
select pg_temp.refused($s$select public.accept_invitation('pgc-invite-token', '9c700000-0000-4000-8000-000000000003')$s$,
  '42501', 'accept_invitation refuses a caller whose email is not the invitation''s');
select pg_temp.refused($s$select public.accept_invitation('pgc-invite-token', '9c700000-0000-4000-8000-000000000002')$s$,
  '42501', 'accept_invitation refuses redeeming for someone else');
reset role;
select set_config('request.jwt.claim.sub', '9c700000-0000-4000-8000-000000000002', true);
set local role authenticated;
insert into r select 'accept', public.accept_invitation('pgc-invite-token', '9c700000-0000-4000-8000-000000000002')::jsonb;
reset role;
select pg_temp.check_true((select (v ->> 'success')::boolean from r where k = 'accept'),
  'accept_invitation redeems the invitation for its addressee');
select pg_temp.check_true(exists (select 1 from public.tenant_members
                                   where tenant_id = '9c700000-0000-4000-8000-00000000aaaa'
                                     and user_id = '9c700000-0000-4000-8000-000000000002' and status = 'active'),
  'the addressee is now an active member of that business');

-- ── 2. The class: no public function with a pinned search_path that omits pgcrypto's schema calls
--    a pgcrypto function without a schema. Names come from the extension itself, minus any that
--    pg_catalog also provides (gen_random_uuid), which resolve without it. Comments are stripped
--    so a sentence about digest() is not mistaken for a call.
-- A function written the old way, so the same query is shown to catch one (positive control).
-- plpgsql, because a SQL-language body is resolved at CREATE and would refuse to exist.
create function public.pgc_probe_unqualified(t text) returns text language plpgsql set search_path = public, pg_temp
  as $f$ begin return encode(digest(t, 'sha256'), 'hex'); end $f$;
create temp table pgc_offenders as
with crypto as (
  select e.extnamespace::regnamespace::text as nsp,
         array_agg(distinct p.proname) filter (
           where not exists (select 1 from pg_proc c where c.pronamespace = 'pg_catalog'::regnamespace and c.proname = p.proname)
         ) as names
    from pg_extension e
    join pg_depend d on d.refclassid = 'pg_extension'::regclass and d.refobjid = e.oid and d.deptype = 'e'
                    and d.classid = 'pg_proc'::regclass
    join pg_proc p on p.oid = d.objid
   where e.extname = 'pgcrypto'
   group by e.extnamespace
),
pinned as (
  select p.oid::regprocedure::text as fn,
         regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g') as code,
         (select string_to_array(regexp_replace(substr(c, 13), '[[:space:]"'']', '', 'g'), ',')
            from unnest(p.proconfig) c where c like 'search_path=%') as path
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prolang not in (select oid from pg_language where lanname in ('c', 'internal'))
)
select pinned.fn
  from pinned, crypto
 where pinned.path is not null
   and not (crypto.nsp = any (pinned.path))
   and pinned.code ~* ('(^|[^[:alnum:]_.])(' || array_to_string(crypto.names, '|') || ')[[:space:]]*\(');
select pg_temp.check_true((select count(*) = 1 from pgc_offenders where fn = 'pgc_probe_unqualified(text)'),
  'the catalog query catches a function written the old way (positive control)');
select pg_temp.check_true((select count(*) = 0 from pgc_offenders where fn <> 'pgc_probe_unqualified(text)'),
  'no pinned-search_path public function calls pgcrypto unqualified; offenders: '
  || coalesce((select string_agg(fn, ', ' order by fn) from pgc_offenders where fn <> 'pgc_probe_unqualified(text)'), 'none'));

rollback;
