-- Runs INSIDE the original rollback-only EXP04 status fixture, after every
-- incumbent assertion. No production customer, provider or new QA identity.
-- This is a private source contract, not accepted-requester authorization or
-- safe final publication; the original Portal consumer must still prove those.
do $exists$
begin
 perform pg_temp.check_true(to_regprocedure('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)') is not null,
  'native invoice query accepts an explicit internal business date');
 perform pg_temp.check_true(to_regprocedure('public._business_time_zone_for_tenant(uuid,timestamp with time zone)') is not null,
  'native calendar factors the original configured business-zone reader');
 perform pg_temp.check_true(to_regprocedure('public._client_portal_invoice_observation_for_client(uuid,uuid)') is not null,
  'native invoice observation exists without an API grant');
end $exists$;

do $private_contract$
declare identity text; p pg_proc%rowtype;
begin
 for identity in select unnest(array[
  'public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)',
  'public._business_time_zone_for_tenant(uuid,timestamp with time zone)',
  'public._client_portal_invoice_observation_for_client(uuid,uuid)']) loop
  select * into strict p from pg_proc where oid=to_regprocedure(identity);
  perform pg_temp.check_true(not p.prosecdef and p.provolatile='v' and p.pronargdefaults=0
   and p.prorettype='jsonb'::regtype and not p.proretset
   and p.proconfig=array['search_path=""']::text[] and pg_get_userbyid(p.proowner)='postgres',
   'private native source has explicit inputs, owner and invoker metadata: '||identity);
  perform pg_temp.check_true(p.proacl is not null and not exists(select 1 from aclexplode(p.proacl) a
   where a.grantee<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable),
   'no API or service-role execution authority: '||identity);
 end loop;
end $private_contract$;

-- A deterministic near-midnight boundary, including the DST date transition.
-- Reuse the SAME original setting, never a user profile or an invented default.
create temp table e04_native_saved_zone as select * from public.tenant_business_time_zones
 where tenant_id='e4000000-0000-4000-8000-00000000aaaa';
update public.tenant_business_time_zones set time_zone='America/New_York'
 where tenant_id='e4000000-0000-4000-8000-00000000aaaa';
select pg_temp.check_true(public._business_time_zone_for_tenant('e4000000-0000-4000-8000-00000000aaaa','2026-03-08T04:30:00Z')->>'local_date'='2026-03-07',
 'native local date remains previous day when UTC has crossed midnight');
select pg_temp.check_true(public._business_time_zone_for_tenant('e4000000-0000-4000-8000-00000000aaaa','2026-03-08T07:30:00Z')->>'local_date'='2026-03-08',
 'native local date follows the actual business zone through DST');
select pg_temp.refused($s$select public._business_time_zone_for_tenant(null,now())$s$,'22023','native calendar refuses a missing business locator');
select pg_temp.refused($s$select public._business_time_zone_for_tenant('e4000000-0000-4000-8000-00000000aaaa',null)$s$,'22023','native calendar refuses a missing observation time');
select pg_temp.refused($s$select public._business_time_zone_for_tenant('e4000000-0000-4000-8000-00000000aaaa','infinity')$s$,'22023','native calendar refuses a nonfinite observation time');

do $facts$
declare before_day jsonb; after_day jsonb; unknown_day jsonb; observed jsonb; legacy jsonb;
 first_due date; last_due date; row jsonb;
begin
 select min(due_date),max(due_date) into first_due,last_due from public.paige_invoices
  where tenant_id='e4000000-0000-4000-8000-00000000aaaa' and contact_id='e4000000-0000-4000-8000-0000000c0001';
 perform pg_temp.check_true(first_due is not null and last_due is not null,'original fixture contains actual dated invoice facts');
 before_day:=public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',40,null,first_due-1);
 after_day:=public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',40,null,last_due+1);
 unknown_day:=public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',40,null,null);
 perform pg_temp.check_true(before_day->'balances'=after_day->'balances' and before_day->'balances'=unknown_day->'balances'
  and before_day->'invoice_count'=after_day->'invoice_count' and before_day->'open_count'=after_day->'open_count',
  'calendar input never changes original principal, allocation, all-currency totals or counts');
 for row in select value from jsonb_array_elements(after_day->'invoices') loop
  perform pg_temp.check_true((row->>'past_due')::boolean=(row->>'status'='issued' and (row->>'remaining_minor')::numeric>0 and row->>'due_date' is not null),
   'later explicit date classifies only actual outstanding dated invoices');
  perform pg_temp.check_true((select (value->>'past_due')::boolean=false from jsonb_array_elements(before_day->'invoices') where value->>'id'=row->>'id'),
   'earlier explicit date does not inherit UTC overdue classification');
  if row->>'status'='issued' and (row->>'remaining_minor')::numeric>0 and row->>'due_date' is not null then
   perform pg_temp.check_true((select value->'past_due'='null'::jsonb from jsonb_array_elements(unknown_day->'invoices') where value->>'id'=row->>'id'),
    'unknown calendar withholds overdue truth instead of inventing false or zero');
  end if;
  perform pg_temp.check_true((select (row->>'issued_snapshot_version')::integer=i.billing_issued_snapshot_version from public.paige_invoices i where i.id=(row->>'id')::uuid),
   'native version is the original immutable issued snapshot version');
 end loop;
 observed:=public._client_portal_invoice_observation_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001');
 legacy:=public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',5,null);
 perform pg_temp.check_true(observed->'query'->>'limit'='5' and observed->'query'->'after'='null'::jsonb,
  'native observation fixes the original first five records and no cursor');
 perform pg_temp.check_true(observed->>'tenant_id'='e4000000-0000-4000-8000-00000000aaaa'
  and observed->>'client_id'='e4000000-0000-4000-8000-0000000c0001', 'native observation preserves original business and client identity');
 perform pg_temp.check_true(observed->'facts'->'balances'=legacy->'balances'
  and observed->'facts'->'invoice_count'=legacy->'invoice_count' and observed->'facts'->'has_more'=legacy->'has_more'
  and observed->'facts'->'next_cursor'=legacy->'next_cursor', 'native page retains original all-page totals, count and truncation');
 perform pg_temp.check_true(observed->>'observation_identity' ~ '^[a-f0-9]{64}$'
  and observed->'facts'->'_native_sources'->>'all_facts_identity' ~ '^[a-f0-9]{64}$',
  'private observation carries bounded SHA256 source identities, not a new receipt');
end $facts$;

select pg_temp.refused($s$select public._client_portal_invoice_observation_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c00b1')$s$,'42501',
 'native source refuses a client that belongs to another business');
select pg_temp.refused($s$select public._client_portal_invoice_observation_for_client(null,null)$s$,'42501','native source refuses missing resolved locators');

delete from public.tenant_business_time_zones where tenant_id='e4000000-0000-4000-8000-00000000aaaa';
select pg_temp.check_true((select v->>'state'='missing' and v->'zone'='null'::jsonb and v->'local_date'='null'::jsonb
 from (select public._business_time_zone_for_tenant('e4000000-0000-4000-8000-00000000aaaa','2026-03-08T04:30:00Z') v) x),
 'missing configured zone has no native UTC fallback');
insert into public.tenant_business_time_zones select * from e04_native_saved_zone;
update public.tenant_business_time_zones set time_zone='America/Nowhere' where tenant_id='e4000000-0000-4000-8000-00000000aaaa';
select pg_temp.check_true((select v->>'state'='invalid' and v->'zone'='null'::jsonb and v->'local_date'='null'::jsonb
 from (select public._business_time_zone_for_tenant('e4000000-0000-4000-8000-00000000aaaa','2026-03-08T04:30:00Z') v) x),
 'invalid stored zone remains explicit and does not invent a native date');
delete from public.tenant_business_time_zones where tenant_id='e4000000-0000-4000-8000-00000000aaaa';
insert into public.tenant_business_time_zones select * from e04_native_saved_zone;

-- Denial occurs before any locator is interpreted. Service custody is not actor authority.
do $$begin execute format('grant usage on schema %I to anon,authenticated,service_role',
 (select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant execute on function pg_temp.refused(text,text,text) to anon,authenticated,service_role;
set local role anon;
select pg_temp.refused('select public._client_portal_invoice_observation_for_client(null,null)','42501','anonymous observation access refused');
select pg_temp.refused('select public._client_portal_invoice_facts_for_client(null,null,5,null,null)','42501','anonymous five-argument core access refused');
select pg_temp.refused('select public._business_time_zone_for_tenant(null,null)','42501','anonymous actor-free calendar access refused');
reset role;
set local role authenticated;
select pg_temp.refused('select public._client_portal_invoice_observation_for_client(null,null)','42501','signed-in role cannot borrow private native authority');
select pg_temp.refused('select public._client_portal_invoice_facts_for_client(null,null,5,null,null)','42501','signed-in five-argument core access refused');
select pg_temp.refused('select public._business_time_zone_for_tenant(null,null)','42501','signed-in actor-free calendar access refused');
reset role;
set local role service_role;
select pg_temp.refused('select public._client_portal_invoice_observation_for_client(null,null)','42501','service-role observation authority is not introduced');
select pg_temp.refused('select public._client_portal_invoice_facts_for_client(null,null,5,null,null)','42501','service-role five-argument core access refused');
select pg_temp.refused('select public._business_time_zone_for_tenant(null,null)','42501','service-role actor-free calendar access refused');
reset role;
