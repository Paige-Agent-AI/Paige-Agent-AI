-- Disposable isolated fixture only; all synthetic records roll back.
begin;
create function pg_temp.check_true(v boolean,label text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.refused(stmt text,code text,label text) returns void language plpgsql as $$
begin begin execute stmt; exception when others then
 if sqlstate=code then raise notice 'PASS: %',label;return;end if;
 raise exception 'FAIL: % unexpected %',label,sqlstate;end;
 raise exception 'FAIL: % accepted',label;end $$;
insert into auth.users(id,aud,role,email) select ('ef240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','recovery-'||n||'@tests.invalid' from generate_series(1,5)n;
insert into public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) values
 ('ef240000-0000-4000-8000-000000001111','test-ops-review-recovery','Test Review Recovery','active','standalone','ORR',9952411,'{}');
insert into public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
 select 'ef240000-0000-4000-8000-000000001111',('ef240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,(case when n=2 or n=4 then 'admin' else 'member' end)::public.tenant_role,'active',false,now() from generate_series(1,5)n;
insert into public.profiles(user_id,active_tenant_id) select ('ef240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ef240000-0000-4000-8000-000000001111'::uuid from generate_series(1,5)n
 on conflict(user_id) do update set active_tenant_id=excluded.active_tenant_id;
insert into public.user_roles(user_id,role) values('ef240000-0000-4000-8000-000000000004','admin');
insert into public.clients(id,tenant_id,created_by,first_name,last_name,account_number) values
 ('ef240000-0000-4000-8000-00000000c001','ef240000-0000-4000-8000-000000001111','ef240000-0000-4000-8000-000000000001','Test','Client','ORR-1');
insert into public.plans(id,tenant_id,title,horizon,starts_on,ends_on,scope,created_by,owner_user_id) values
 ('ef240000-0000-4000-8000-00000000a001','ef240000-0000-4000-8000-000000001111','Review obligation','custom',current_date,current_date+30,'team','ef240000-0000-4000-8000-000000000003','ef240000-0000-4000-8000-000000000003');
insert into public.plan_items(id,tenant_id,plan_id,item_type,title,created_by,assigned_to_user_id,contact_id) values
 ('ef240000-0000-4000-8000-00000000b001','ef240000-0000-4000-8000-000000001111','ef240000-0000-4000-8000-00000000a001','task','Client delivery work','ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000000005','ef240000-0000-4000-8000-00000000c001');
insert into public.studio_sessions(id,tenant_id,owner_user_id,title) values
 ('ef240000-0000-4000-8000-00000000d001','ef240000-0000-4000-8000-000000001111','ef240000-0000-4000-8000-000000000001','Delivery source');
insert into public.studio_artifact_versions(id,tenant_id,session_id,kind,lineage_id,version_no,snapshot,created_by) values
 ('ef240000-0000-4000-8000-00000000e001','ef240000-0000-4000-8000-000000001111','ef240000-0000-4000-8000-00000000d001','content','ef240000-0000-4000-8000-00000000f001',1,'{"title":"Reviewed work","body":"Immutable source"}','ef240000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000001',true);
select public.operations_delivery_submit_scoped('ef240000-0000-4000-8000-00000000b001','ef240000-0000-4000-8000-00000000e001','ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000001111',(select updated_at from public.plan_items where id='ef240000-0000-4000-8000-00000000b001'),0);
create temporary table reviewer_context as select id,updated_at,artifact_digest,artifact_version_id,submitted_by,revision_no from public.operations_delivery_submissions where tenant_id='ef240000-0000-4000-8000-000000001111';
do $$begin execute format('grant usage on schema %I to authenticated',(select nspname from pg_namespace where oid=pg_my_temp_schema()));end$$;
grant select,update on reviewer_context to authenticated;
grant execute on function pg_temp.check_true(boolean,text),pg_temp.refused(text,text,text) to authenticated;
-- Actual authenticated role, not just owner-issued JWT claims.
set local role authenticated;
select pg_temp.check_true(has_function_privilege('authenticated','public.operations_delivery_reassign_reviewer_scoped(uuid,uuid,uuid,timestamptz,uuid,text)','EXECUTE'),'scoped recovery callable');
select pg_temp.check_true(not has_function_privilege('anon','public.operations_delivery_reassign_reviewer_scoped(uuid,uuid,uuid,timestamptz,uuid,text)','EXECUTE'),'anonymous recovery denied');
select pg_temp.refused($s$update public.operations_delivery_submissions set reviewer_user_id='ef240000-0000-4000-8000-000000000004'$s$,'42501','direct reviewer update denied');
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000003','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000004','Reviewer unavailable')$s$,'42501','wrong expected actor denied');
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000003',true);
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000003','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000004','Reviewer unavailable')$s$,'42501','unrelated plan owner creator denied');
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000001',true);
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000001111','2000-01-01','ef240000-0000-4000-8000-000000000004','Reviewer unavailable')$s$,'40001','stale recovery denied');
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000004',' ')$s$,'22023','undocumented reassignment denied');
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000001','Reviewer unavailable')$s$,'42501','replacement cannot be submitter');
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000005','Reviewer unavailable')$s$,'42501','active person without source permission denied');
select pg_temp.check_true((public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000004','Reviewer unavailable')->>'reviewer_user_id')='ef240000-0000-4000-8000-000000000004','item creator replaces reviewer');
select pg_temp.check_true((public.operations_delivery_list_scoped('ef240000-0000-4000-8000-00000000b001','ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000001111')->'submissions'->0->>'artifact_digest')=(select artifact_digest from reviewer_context),'reassignment preserves original source digest');
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000001','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000002','Stale browser')$s$,'40001','repeated old intent cannot replay');
reset role;
update reviewer_context set updated_at=s.updated_at from public.operations_delivery_submissions s where s.id=reviewer_context.id;
-- Give unrelated plan owner legitimate Studio access; item authority still denies.
update public.studio_sessions set owner_user_id='ef240000-0000-4000-8000-000000000003' where id='ef240000-0000-4000-8000-00000000d001';
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000003','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000002','Reviewer unavailable')$s$,'42501','source permission does not grant unrelated plan owner item authority');
reset role;
update public.studio_sessions set owner_user_id='ef240000-0000-4000-8000-000000000005' where id='ef240000-0000-4000-8000-00000000d001';
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000005',true);
set local role authenticated;
select pg_temp.check_true((public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000005','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000002','Cover the absent reviewer')->>'state')='in_review','item assignee replaces reviewer');
reset role;
update reviewer_context set updated_at=s.updated_at from public.operations_delivery_submissions s where s.id=reviewer_context.id;
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.check_true((public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000004','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000005','Named cover reviewer')->>'state')='in_review','backed tenant admin replaces reviewer');
reset role;
select pg_temp.check_true((select count(*)=3 from public.audit_logs where entity='operations_delivery' and action='delivery_reviewer_reassigned' and entity_id=(select id from reviewer_context)),'each actual reassignment leaves existing audit evidence');
select pg_temp.check_true((select s.artifact_version_id=c.artifact_version_id and s.artifact_digest=c.artifact_digest and s.submitted_by=c.submitted_by and s.revision_no=c.revision_no and s.reviewed_by is null and s.reviewed_at is null from public.operations_delivery_submissions s,reviewer_context c where s.id=c.id),'immutable artifact and undecided state preserved');
select pg_temp.refused($s$update public.operations_delivery_submissions set artifact_digest=repeat('b',64) where id=(select id from reviewer_context)$s$,'42501','even privileged source digest change refused');

update reviewer_context set updated_at=s.updated_at from public.operations_delivery_submissions s where s.id=reviewer_context.id;
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.check_true(jsonb_array_length(public.operations_delivery_list_scoped('ef240000-0000-4000-8000-00000000b001','ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111')->'submissions')=0,'former artifact-only reviewer loses submission read grant');
select pg_temp.refused($s$select public.operations_delivery_review_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'approved',null)$s$,'42501','former reviewer cannot decide');
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000002','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000004','Override')$s$,'42501','tenant admin without canonical item authority denied');
reset role;
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000004',true);
update public.tenant_members set status='removed' where tenant_id='ef240000-0000-4000-8000-000000001111' and user_id='ef240000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000004','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000002','Unavailable cover')$s$,'42501','revoked replacement denied');
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000004','ef240000-0000-4000-8000-000000009999',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000002','Wrong tenant')$s$,'42501','foreign expected tenant denied');
reset role;
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000005',true);
set local role authenticated;
select pg_temp.check_true((public.operations_delivery_review_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000005','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'approved','Reviewed exact source')->>'state')='approved','replacement independently reviews original source');
reset role;
update reviewer_context set updated_at=s.updated_at from public.operations_delivery_submissions s where s.id=reviewer_context.id;
select set_config('request.jwt.claim.sub','ef240000-0000-4000-8000-000000000004',true);
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000004','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000002','Overwrite completed review')$s$,'22023','reviewed submission cannot be reassigned');
reset role;
select pg_temp.refused($s$update public.operations_delivery_submissions set reviewer_user_id='ef240000-0000-4000-8000-000000000002' where id=(select id from reviewer_context)$s$,'42501','completed reviewer history immutable even to table owner');

update public.tenant_members set status='removed' where tenant_id='ef240000-0000-4000-8000-000000001111' and user_id='ef240000-0000-4000-8000-000000000004';
set local role authenticated;
select pg_temp.refused($s$select public.operations_delivery_reassign_reviewer_scoped((select id from reviewer_context),'ef240000-0000-4000-8000-000000000004','ef240000-0000-4000-8000-000000001111',(select updated_at from reviewer_context),'ef240000-0000-4000-8000-000000000002','Reviewer unavailable')$s$,'42501','revoked actor recovery denied');
reset role;
rollback;
