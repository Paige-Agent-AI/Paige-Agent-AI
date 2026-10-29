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

-- Extend ONLY this existing rollback fixture. Tied issue timestamps exercise
-- the original id tiebreaker; two currencies make totals beyond page5 real.
-- Original status assertions already ran before this isolated source control.
set local session_replication_role=replica;
insert into public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,due_date,
 billing_draft_version,billing_draft,billing_last_operation_id,billing_last_request,billing_lifecycle_version,billing_issued_snapshot_version,
 billing_issued_at,billing_issued_by,billing_document,billing_document_digest,created_at)
select ('e4000000-0000-4000-8000-'||lpad((9000000+n)::text,12,'0'))::uuid,i.tenant_id,i.contact_id,'E4-NATIVE-'||n,
 i.status,i.amount_total_cents,case when n%2=0 then 'eur' else i.currency end,i.due_date,
 i.billing_draft_version,i.billing_draft,gen_random_uuid(),i.billing_last_request,i.billing_lifecycle_version,i.billing_issued_snapshot_version,
 i.billing_issued_at,i.billing_issued_by,i.billing_document,i.billing_document_digest,i.created_at
from public.paige_invoices i cross join generate_series(1,6) n
where i.id='e4000000-0000-4000-8000-0000000e0002';
set local session_replication_role=origin;


-- Build a TEMPORARY frozen oracle from the whole original query. The published
-- source keeps ONE query. Its historical whole-body hash independently pins
-- every original financial expression, validation and ordering predicate.
do $legacy_oracle$
declare query_body text; step record;
begin
 select prosrc into strict query_body from pg_proc where oid='public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)'::regprocedure;

  for step in select * from (values ('  _today date := (now() AT TIME ZONE ''UTC'')::date;','  _today date := p_as_of;'),
('  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';
  END IF;','  IF _tenant IS NULL OR _client IS NULL THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_UNAVAILABLE'' USING ERRCODE=''42501'';
  END IF;
  IF p_as_of IS NOT NULL AND NOT isfinite(p_as_of) THEN
    RAISE EXCEPTION ''CLIENT_INVOICE_INPUT_INVALID'' USING ERRCODE=''22023'';
  END IF;'),
('      i.billing_issued_at AS issued_at,','      i.billing_issued_at AS issued_at, i.billing_issued_snapshot_version AS issued_snapshot_version,'),
('      ''issued_at'', p.issued_at, ''due_date'', p.due_date,','      ''issued_at'', p.issued_at, ''due_date'', p.due_date,
      ''issued_snapshot_version'', p.issued_snapshot_version,'),
('    ''read_at'', statement_timestamp()','    ''_native_sources'', jsonb_build_object(''as_of_date'',p_as_of,''all_facts_identity'',
      encode(extensions.digest(coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM facts f),''[]''::jsonb)::text,''sha256''),''hex'')),
    ''read_at'', statement_timestamp()')) s(before,after) loop
   perform pg_temp.check_true((length(query_body)-length(replace(query_body,step.after,'')))/length(step.after)=1,
    'exact native financial source inverse anchor');
   query_body:=replace(query_body,step.after,step.before);
  end loop;

 perform pg_temp.check_true(md5(query_body)='d86613d312960b0d507898210e7e5197','whole original financial query is retained, not a copied calculation');
 execute format('create function pg_temp.e04_legacy_invoice_oracle(_tenant uuid,_client uuid,p_limit integer,p_after jsonb) returns jsonb language plpgsql volatile security invoker set search_path='''' as %L',query_body);
 revoke all on function pg_temp.e04_legacy_invoice_oracle(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
end $legacy_oracle$;
do $legacy_results$
declare take integer; expected jsonb; actual jsonb; cursor jsonb;
begin
 foreach take in array array[1,5,40] loop
  expected:=pg_temp.e04_legacy_invoice_oracle('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',take,null);
  actual:=public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',take,null);
  perform pg_temp.check_true(actual=expected,'whole original financial JSON remains exact at page size '||take);
 end loop;
 cursor:=public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',1,null)->'next_cursor';
 perform pg_temp.check_true(cursor is not null and cursor<>'null'::jsonb,'original fixture really exercises a second page');
 expected:=pg_temp.e04_legacy_invoice_oracle('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',1,cursor);
 actual:=public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',1,cursor);
 perform pg_temp.check_true(actual=expected,'whole original cursor page, totals and provider/manual/test facts remain exact');
end $legacy_results$;

create temp table e04_native_off_page_identity(before_read jsonb not null,off_page uuid not null,original_number text);
do $off_page_capture$
declare before_read jsonb; off_page uuid; original_number text;
begin
 before_read:=public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',1,null,current_date);
 select i.id,i.invoice_number into strict off_page,original_number from public.paige_invoices i
  where i.tenant_id='e4000000-0000-4000-8000-00000000aaaa' and i.contact_id='e4000000-0000-4000-8000-0000000c0001'
   and i.status in ('issued','void') and i.billing_issued_snapshot_version is not null and i.billing_document is not null
   and not exists(select 1 from jsonb_array_elements(before_read->'invoices') p where p->>'id'=i.id::text)
  order by i.billing_issued_at,i.id limit 1;
 insert into pg_temp.e04_native_off_page_identity values(before_read,off_page,original_number);
end $off_page_capture$;

-- SAME standalone SET LOCAL as the incumbent fixture. The restricted runner
-- refuses set_config(session_replication_role) inside a DO block.
-- No extra parameter permission; every source read runs with triggers restored.
set local session_replication_role=replica;
update public.paige_invoices i set invoice_number=coalesce(s.original_number,'test')||'-native-control'
 from pg_temp.e04_native_off_page_identity s where i.id=s.off_page;
set local session_replication_role=origin;

do $off_page_changed$
declare before_read jsonb; after_read jsonb;
begin
 select s.before_read into strict before_read from pg_temp.e04_native_off_page_identity s;
 after_read:=public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',1,null,current_date);
 -- Capturing and mutating are separate top-level statements, so the original
 -- statement_timestamp read_at can differ. Compare EVERY other public field.
 perform pg_temp.check_true(before_read-ARRAY['_native_sources','read_at']=after_read-ARRAY['_native_sources','read_at'],
  'off-page control leaves the entire visible page, cursor and financial totals unchanged apart from observation time');
 perform pg_temp.check_true(before_read->'_native_sources'->>'all_facts_identity'<>after_read->'_native_sources'->>'all_facts_identity',
  'source identity covers original facts beyond the returned page');
end $off_page_changed$;

set local session_replication_role=replica;
update public.paige_invoices i set invoice_number=s.original_number
 from pg_temp.e04_native_off_page_identity s where i.id=s.off_page;
set local session_replication_role=origin;

do $off_page_restored$
declare before_read jsonb;
begin
 select s.before_read into strict before_read from pg_temp.e04_native_off_page_identity s;
 perform pg_temp.check_true(public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',1,null,current_date)-'read_at'=before_read-'read_at',
  'source control restores every original financial field and source identity apart from observation time');
end $off_page_restored$;

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
select pg_temp.refused($s$select public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',5,null,'infinity')$s$,'22023','native financial query refuses a nonfinite explicit date');

do $facts$
declare before_day jsonb; after_day jsonb; unknown_day jsonb; observed jsonb; legacy jsonb;
 first_due date; last_due date; invoice_row jsonb;
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
 for invoice_row in select value from jsonb_array_elements(after_day->'invoices') loop
  perform pg_temp.check_true((invoice_row->>'past_due')::boolean=(invoice_row->>'status'='issued' and (invoice_row->>'remaining_minor')::numeric>0 and invoice_row->>'due_date' is not null),
   'later explicit date classifies only actual outstanding dated invoices');
  perform pg_temp.check_true((select (value->>'past_due')::boolean=false from jsonb_array_elements(before_day->'invoices') where value->>'id'=invoice_row->>'id'),
   'earlier explicit date does not inherit UTC overdue classification');
  if invoice_row->>'status'='issued' and (invoice_row->>'remaining_minor')::numeric>0 and invoice_row->>'due_date' is not null then
   perform pg_temp.check_true((select value->'past_due'='null'::jsonb from jsonb_array_elements(unknown_day->'invoices') where value->>'id'=invoice_row->>'id'),
    'unknown calendar withholds overdue truth instead of inventing false or zero');
  end if;
  perform pg_temp.check_true((select (invoice_row->>'issued_snapshot_version')::integer=i.billing_issued_snapshot_version from public.paige_invoices i where i.id=(invoice_row->>'id')::uuid),
   'native version is the original immutable issued snapshot version');
 end loop;
 observed:=public._client_portal_invoice_observation_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001');
 legacy:=public._client_portal_invoice_facts_for_client('e4000000-0000-4000-8000-00000000aaaa','e4000000-0000-4000-8000-0000000c0001',5,null);
 perform pg_temp.check_true(observed->'query'->>'limit'='5' and observed->'query'->'after'='null'::jsonb,
  'native observation fixes the original first five records and no cursor');
 perform pg_temp.check_true(jsonb_array_length(observed->'facts'->'invoices')=5
  and (observed->'facts'->>'has_more')::boolean and (observed->'facts'->>'invoice_count')::integer>5
  and jsonb_array_length(observed->'facts'->'balances')=2,
  'native five-row page really truncates and retains every original currency beyond it');
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
