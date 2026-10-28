-- EXP04 full-schema integration. Disposable Preview/CI only; all rows roll back.
-- Commercial input is a neutral metadata capture from the ORIGINAL native
-- signing/effectuation proof, not proof of hosted signing or document bytes.
-- Work submission, review, release and client decisions below use the actual
-- canonical writers with triggers/RLS restored and the authenticated DB role.
begin;
create temp table e04_commercial_fixture(data jsonb not null);
\ir fixtures/exp04_reviewed_commercial_native.sql
create function pg_temp.check_true(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.refused(stmt text,code text,label text) returns void language plpgsql as $$
begin begin execute stmt; exception when others then
 if sqlstate=code then raise notice 'PASS: %',label; return; end if;
 raise exception 'FAIL: % unexpected %: %',label,sqlstate,sqlerrm; end;
 raise exception 'FAIL: % accepted',label; end $$;

insert into auth.users(id,aud,role,email)
select (data->>'actor_id')::uuid,'authenticated','authenticated','e04-delivery-owner@tests.invalid' from e04_commercial_fixture
union all select 'e4960000-0000-4000-8000-000000000002','authenticated','authenticated','e04-delivery-client@tests.invalid'
union all select 'e4960000-0000-4000-8000-000000000003','authenticated','authenticated','e04-unrelated-member@tests.invalid';
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features)
select (data->>'tenant_id')::uuid,'test-e04-reviewed-delivery','Test reviewed delivery','active','standalone','ERD',9949601,'{}' from e04_commercial_fixture;
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
select (data->>'tenant_id')::uuid,(data->>'actor_id')::uuid,'owner'::public.tenant_role,'active',true,now() from e04_commercial_fixture
union all select (data->>'tenant_id')::uuid,'e4960000-0000-4000-8000-000000000003','member','active',false,now() from e04_commercial_fixture;
insert into public.profiles(user_id,active_tenant_id)
select (data->>'actor_id')::uuid,(data->>'tenant_id')::uuid from e04_commercial_fixture
union all select 'e4960000-0000-4000-8000-000000000003',(data->>'tenant_id')::uuid from e04_commercial_fixture
on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.clients(id,tenant_id,created_by,first_name,last_name,account_number,linked_user_id)
select (data->>'client_id')::uuid,(data->>'tenant_id')::uuid,(data->>'actor_id')::uuid,'Test','Reviewed client','ERD-C1','e4960000-0000-4000-8000-000000000002' from e04_commercial_fixture;
insert into public.tenant_products(id,tenant_id,name,status,product_type,created_by)
select (data#>>'{effective,offer_id}')::uuid,(data->>'tenant_id')::uuid,'Test exact engagement','active','service',(data->>'actor_id')::uuid from e04_commercial_fixture;

-- Seed captured synthetic commercial history only. No Work/review/client decision
-- is seeded or guard-bypassed. Full commercial writers retain their native proof.
set local session_replication_role=replica;
do $seed$ declare f jsonb; table_name text; rows jsonb; row_data jsonb; columns_sql text; begin
 select data into strict f from e04_commercial_fixture;
 foreach table_name in array array['tenant_client_agreements','paige_agreements','paige_agreement_signers','paige_agreement_events','paige_sales_collection_operations','paige_workspace_events','paige_invoices'] loop
  rows:=f#>array['records',table_name];
  for row_data in select value from jsonb_array_elements(rows) loop
   if table_name='tenant_client_agreements' then row_data:=row_data||jsonb_build_object('created_by',f->'actor_id'); end if;
   -- Full-schema event sequence is GENERATED ALWAYS; its real allocator owns
   -- this local row order. Accepted evidence references immutable event IDs.
   if table_name='paige_agreement_events' then row_data:=row_data-'seq'; end if;
   -- Native proof's reduced draft table has no lifecycle shape constraint.
   -- Retain its original draft/economics, using the full schema's draft state
   -- (not an issued invoice or payment). Never weaken that constraint.
   if table_name='paige_invoices' then row_data:=row_data||jsonb_build_object(
    'billing_lifecycle_version',null,'billing_last_operation_id','e4960000-0000-4000-8000-000000000008',
    'billing_last_request','{}'::jsonb); end if;
   select string_agg(format('%I',key),',' order by key) into columns_sql from jsonb_object_keys(row_data) key;
   execute format('insert into public.%I(%s) select %s from jsonb_populate_record(null::public.%I,$1)',table_name,columns_sql,columns_sql,table_name) using row_data;
  end loop;
 end loop;
end $seed$;
set local session_replication_role=origin;
create temp table e04_delivery_results(key text primary key,value jsonb not null);
grant select on e04_commercial_fixture to authenticated;
grant select,insert,update on e04_delivery_results to authenticated;
do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end $$;
grant execute on function pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text) to authenticated;
create function pg_temp.e04_delivery_read() returns jsonb language sql security invoker as $$
 select item->'reviewed_delivery' from e04_commercial_fixture f,
 jsonb_array_elements(public.read_client_engagement_status((data->>'tenant_id')::uuid,(data->>'client_id')::uuid)->'terms') item
 where item->>'id'=f.data#>>'{effective,commercial_terms_id}'; $$;
grant execute on function pg_temp.e04_delivery_read() to authenticated;
select pg_temp.check_true((select public._sales_client_effective_terms((data->>'tenant_id')::uuid,(data->>'client_id')::uuid,(data#>>'{effective,commercial_terms_id}')::uuid)->>'state'='verified' from e04_commercial_fixture),'original full-schema accepted/effectuated metadata validates without replacing its validator');
select pg_temp.check_true(not has_function_privilege('authenticated','public._sales_client_reviewed_delivery(uuid,uuid,uuid)','EXECUTE'),'private projection acquires no browser grant');
select pg_temp.check_true(not has_function_privilege('service_role','public.read_client_engagement_status(uuid,uuid)','EXECUTE'),'original public status acquires no service grant');

select set_config('request.jwt.claim.sub',(select data->>'actor_id' from e04_commercial_fixture),true);
set local role authenticated;
select pg_temp.check_true(pg_temp.e04_delivery_read()->>'state'='not_linked','public status distinguishes verified terms without linked Work');
insert into e04_delivery_results select 'terms',public.set_client_agreement_status((data->>'tenant_id')::uuid,(data#>>'{effective,commercial_terms_id}')::uuid,'active',null) from e04_commercial_fixture;
insert into e04_delivery_results
select 'handoff',public.operations_engagement_handoff(
 (data->>'actor_id')::uuid,(data->>'tenant_id')::uuid,(data#>>'{effective,signing_id}')::uuid,(data->>'client_id')::uuid,
 (data#>>'{effective,commercial_terms_id}')::uuid,(data#>>'{effective,offer_id}')::uuid,(data#>>'{effective,signing_version}')::integer,
 data#>>'{effective,document_sha256}',data#>>'{effective,sealed_sha256}',
 (select (value->>'updated_at')::timestamptz from e04_delivery_results where key='terms'),
 'e4960000-0000-4000-8000-000000000004','Test exact delivery',(data->>'actor_id')::uuid,current_date,current_date+10,
 jsonb_build_array(jsonb_build_object('title','Review the exact deliverable','assigned_to_user_id',data->>'actor_id','priority','high')),
 'Explicit owner-reviewed synthetic delivery scope') from e04_commercial_fixture;
select pg_temp.check_true(pg_temp.e04_delivery_read()#>>'{items,0,phase}'='not_submitted','real canonical handoff is visible in original public status');
reset role;
-- Fixture owner captures the canonical writer's returned Work identity/stamp.
-- Do not grant clients/Work tables to authenticated to make a test pass. This
-- proof exercises domain writes and the owner standing RPC, not direct-table UI.
insert into e04_delivery_results select 'work',to_jsonb(w) from public.plan_items w
where id=(select (value#>>'{milestone_ids,0}')::uuid from e04_delivery_results where key='handoff');
insert into public.studio_sessions(id,tenant_id,owner_user_id,title)
select 'e4960000-0000-4000-8000-000000000005',(data->>'tenant_id')::uuid,(data->>'actor_id')::uuid,'Test exact delivery artifact' from e04_commercial_fixture;
insert into public.studio_artifact_versions(id,tenant_id,session_id,kind,lineage_id,version_no,snapshot,created_by)
select 'e4960000-0000-4000-8000-000000000006',(data->>'tenant_id')::uuid,'e4960000-0000-4000-8000-000000000005','content','e4960000-0000-4000-8000-000000000007',1,
 '{"kind":"text","title":"Test delivery","body":"Exact client deliverable","brief":"PRIVATE_INTERNAL"}'::jsonb,(data->>'actor_id')::uuid from e04_commercial_fixture;
set local role authenticated;
do $journey$ declare f jsonb; h jsonb; w public.plan_items%rowtype; ack jsonb; s jsonb; released jsonb; customer jsonb; outcome jsonb; begin
 select data into strict f from e04_commercial_fixture; select value into strict h from e04_delivery_results where key='handoff';
 select parsed.* into strict w from e04_delivery_results r,
 jsonb_populate_record(null::public.plan_items,r.value) parsed where r.key='work';
 ack:=public.operations_delivery_submit_scoped(w.id,'e4960000-0000-4000-8000-000000000006',(f->>'actor_id')::uuid,(f->>'actor_id')::uuid,(f->>'tenant_id')::uuid,w.updated_at,0);
 perform pg_temp.check_true(ack->>'review_mode'='owner_self_review','original owner submission preserves honest self-review identity');
 perform pg_temp.check_true(pg_temp.e04_delivery_read()#>>'{items,0,phase}'='internal_review','submission alone is waiting for internal review');
 s:=public.operations_delivery_list_scoped(w.id,(f->>'actor_id')::uuid,(f->>'tenant_id')::uuid)->'submissions'->0;
 perform pg_temp.refused(format('select public.operations_delivery_release_scoped(%L,%L,%L,%L)',s->>'id',f->>'actor_id',f->>'tenant_id',s->>'updated_at'),'42501','unreviewed exact version cannot be released');
 ack:=public.operations_delivery_review_scoped((s->>'id')::uuid,(f->>'actor_id')::uuid,(f->>'tenant_id')::uuid,(s->>'updated_at')::timestamptz,'approved','Owner reviewed the exact version');
 perform pg_temp.check_true(pg_temp.e04_delivery_read()#>>'{items,0,phase}'='not_released','internal approval is distinct from client release');
 s:=public.operations_delivery_list_scoped(w.id,(f->>'actor_id')::uuid,(f->>'tenant_id')::uuid)->'submissions'->0;
 released:=public.operations_delivery_release_scoped((s->>'id')::uuid,(f->>'actor_id')::uuid,(f->>'tenant_id')::uuid,(s->>'updated_at')::timestamptz);
 perform pg_temp.check_true(pg_temp.e04_delivery_read()#>>'{items,0,phase}'='awaiting_client','real canonical release awaits separate client approval');
 perform pg_temp.refused(format('select public.operations_delivery_client_decide_scoped(%L,%L,%L,now(),%L,null)',released->>'release_id',f->>'actor_id',f->>'tenant_id','accepted'),'42501','owner cannot supply the external client decision');
 perform set_config('request.jwt.claim.sub','e4960000-0000-4000-8000-000000000002',true);
 customer:=public.operations_delivery_client_read_scoped((released->>'release_id')::uuid,'e4960000-0000-4000-8000-000000000002',(f->>'tenant_id')::uuid);
 perform pg_temp.check_true(customer->>'body'='Exact client deliverable' and not(customer ? 'brief'),'client receives only the originally released exact version');
 perform pg_temp.refused(format('select public.read_client_engagement_status(%L,%L)',f->>'tenant_id',f->>'client_id'),'42501','client cannot use the owner standing reader');
 ack:=public.operations_delivery_client_decide_scoped((released->>'release_id')::uuid,'e4960000-0000-4000-8000-000000000002',(f->>'tenant_id')::uuid,(customer->>'updated_at')::timestamptz,'client_revision_requested','Please clarify the promised scope');
 perform pg_temp.check_true(ack->>'state'='client_revision_requested','separate client revision decision is recorded by original writer');
 perform set_config('request.jwt.claim.sub',f->>'actor_id',true);
 outcome:=pg_temp.e04_delivery_read();
 perform pg_temp.check_true(outcome#>>'{items,0,phase}'='revision_requested','original public standing reads the actual client revision request');
 perform pg_temp.check_true(outcome->>'state'='verified','verified projection does not mean completed services');
 insert into e04_delivery_results values('first_decision',outcome);
 perform pg_temp.check_true(pg_temp.e04_delivery_read()=(select value from e04_delivery_results where key='first_decision'),'later original public read retains the same delivery history');
 perform set_config('request.jwt.claim.sub','e4960000-0000-4000-8000-000000000003',true);
 perform pg_temp.refused(format('select public.read_client_engagement_status(%L,%L)',f->>'tenant_id',f->>'client_id'),'42501','ordinary unrelated member cannot use owner standing');
 perform set_config('request.jwt.claim.sub',f->>'actor_id',true);
end $journey$;
reset role;
-- Synthetic tamper negative: original receipt chronology is still required.
-- This owner-only mutation is rolled back before any subsequent real writer.
savepoint invalid_review_receipt;
update public.audit_logs set created_at=clock_timestamp()+interval '1 day'
where entity='operations_delivery' and action='delivery_reviewed';
select set_config('request.jwt.claim.sub',(select data->>'actor_id' from e04_commercial_fixture),true);
set local role authenticated;
select pg_temp.check_true(pg_temp.e04_delivery_read()->>'state'='unavailable','a review receipt after the release still withholds client acceptance');
reset role;
rollback to savepoint invalid_review_receipt;
select set_config('request.jwt.claim.sub',(select data->>'actor_id' from e04_commercial_fixture),true);
set local role authenticated;
select pg_temp.check_true(pg_temp.e04_delivery_read()=(select value from e04_delivery_results where key='first_decision'),'negative rollback restores exact original supported decision history');
reset role;
insert into public.studio_artifact_versions(id,tenant_id,session_id,kind,lineage_id,version_no,snapshot,created_by)
select 'e4960000-0000-4000-8000-000000000009',(data->>'tenant_id')::uuid,'e4960000-0000-4000-8000-000000000005','content','e4960000-0000-4000-8000-000000000007',2,
 '{"kind":"text","title":"Test delivery revision","body":"New exact client deliverable"}'::jsonb,(data->>'actor_id')::uuid from e04_commercial_fixture;
set local role authenticated;
do $revision$ declare f jsonb; w public.plan_items%rowtype; ack jsonb; s jsonb; released jsonb; customer jsonb; begin
 select data into strict f from e04_commercial_fixture;
 select parsed.* into strict w from e04_delivery_results r,jsonb_populate_record(null::public.plan_items,r.value) parsed where r.key='work';
 ack:=public.operations_delivery_submit_scoped(w.id,'e4960000-0000-4000-8000-000000000009',(f->>'actor_id')::uuid,(f->>'actor_id')::uuid,(f->>'tenant_id')::uuid,w.updated_at,1);
 perform pg_temp.check_true(ack->>'revision_no'='2','new canonical submission retains exact revision sequence');
 perform pg_temp.check_true(pg_temp.e04_delivery_read()#>>'{items,0,phase}'='internal_review','old released decision cannot cover a new unreviewed revision');
 s:=public.operations_delivery_list_scoped(w.id,(f->>'actor_id')::uuid,(f->>'tenant_id')::uuid)->'submissions'->0;
 perform public.operations_delivery_review_scoped((s->>'id')::uuid,(f->>'actor_id')::uuid,(f->>'tenant_id')::uuid,(s->>'updated_at')::timestamptz,'approved','Owner reviewed the revised exact version');
 s:=public.operations_delivery_list_scoped(w.id,(f->>'actor_id')::uuid,(f->>'tenant_id')::uuid)->'submissions'->0;
 released:=public.operations_delivery_release_scoped((s->>'id')::uuid,(f->>'actor_id')::uuid,(f->>'tenant_id')::uuid,(s->>'updated_at')::timestamptz);
 perform set_config('request.jwt.claim.sub','e4960000-0000-4000-8000-000000000002',true);
 customer:=public.operations_delivery_client_read_scoped((released->>'release_id')::uuid,'e4960000-0000-4000-8000-000000000002',(f->>'tenant_id')::uuid);
 perform pg_temp.check_true(customer->>'body'='New exact client deliverable','new release exposes only its exact version');
 perform public.operations_delivery_client_decide_scoped((released->>'release_id')::uuid,'e4960000-0000-4000-8000-000000000002',(f->>'tenant_id')::uuid,(customer->>'updated_at')::timestamptz,'accepted','Exact revised version approved');
 perform set_config('request.jwt.claim.sub',f->>'actor_id',true);
 perform pg_temp.check_true(pg_temp.e04_delivery_read()#>>'{items,0,phase}'='accepted','original standing reflects the latest separate client acceptance');
 perform pg_temp.check_true((public.operations_delivery_client_status_scoped(w.id,(f->>'actor_id')::uuid,(f->>'tenant_id')::uuid)->'client_releases') @> '[{"state":"accepted"},{"state":"client_revision_requested"}]'::jsonb,'original canonical decision history retains both exact releases');
 perform pg_temp.refused(format('select public.operations_delivery_submit_scoped(%L,%L,%L,%L,%L,%L,2)',w.id,'e4960000-0000-4000-8000-000000000009',f->>'actor_id',f->>'actor_id',f->>'tenant_id',w.updated_at),'22023','accepted version cannot be silently reopened without a requested revision');
 perform pg_temp.check_true(pg_temp.e04_delivery_read()#>>'{items,0,phase}'='accepted','refused revision preserves the actual supported client acceptance');
end $revision$;
reset role;
select 'EXP04_FULL_SCHEMA_REVIEWED_DELIVERY_PASS' as result;
rollback;
