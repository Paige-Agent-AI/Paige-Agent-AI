-- Original MCP skill results: real database roles and original authority helpers.
-- Synthetic records only; every seed/change rolls back. No model, sender or worker.
BEGIN;
SELECT no_plan();
CREATE FUNCTION pg_temp.ident(_family int,_n int) RETURNS uuid LANGUAGE sql AS $$
 SELECT ('e09b'||_family::text||'000-0000-4000-8000-'||lpad(_n::text,12,'0'))::uuid $$;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data)
 SELECT pg_temp.ident(1,n),'authenticated','authenticated','run-reader-'||n||'@tests.invalid',now(),
 '{"comms_provider_execution":"disabled"}'::jsonb FROM generate_series(1,9) n;
INSERT INTO public.tenants(id,slug,name,status,account_type)
 SELECT pg_temp.ident(2,n),'test-tenant-run-reader-'||n,'Test service business '||n,'active',
 CASE WHEN n=3 THEN 'agency' ELSE 'standalone' END FROM generate_series(1,4) n;
UPDATE public.tenants SET parent_tenant_id=pg_temp.ident(2,3) WHERE id=pg_temp.ident(2,4);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 (pg_temp.ident(2,1),pg_temp.ident(1,1),'owner','active',true,now()-interval '2 days'),
 (pg_temp.ident(2,2),pg_temp.ident(1,1),'owner','active',true,now()-interval '1 day'),
 (pg_temp.ident(2,2),pg_temp.ident(1,2),'owner','active',true,now()),
 (pg_temp.ident(2,1),pg_temp.ident(1,3),'member','active',false,now()),
 (pg_temp.ident(2,1),pg_temp.ident(1,4),'member','active',false,now()),
 (pg_temp.ident(2,1),pg_temp.ident(1,6),'member','active',false,now()),
 (pg_temp.ident(2,1),pg_temp.ident(1,8),'owner','inactive',false,now()),
 (pg_temp.ident(2,3),pg_temp.ident(1,9),'owner','active',true,now());
UPDATE public.profiles SET active_tenant_id=pg_temp.ident(2,1)
 WHERE user_id IN (pg_temp.ident(1,1),pg_temp.ident(1,3),pg_temp.ident(1,4),pg_temp.ident(1,6));
UPDATE public.profiles SET active_tenant_id=pg_temp.ident(2,2) WHERE user_id=pg_temp.ident(1,2);
UPDATE public.profiles SET active_tenant_id=pg_temp.ident(2,4) WHERE user_id=pg_temp.ident(1,9);
INSERT INTO public.user_roles(user_id,role) VALUES
 (pg_temp.ident(1,6),'platform_admin'),(pg_temp.ident(1,7),'super_admin');
INSERT INTO public.clients(id,tenant_id,linked_user_id,assigned_coach_user_id,created_by,first_name,last_name,status) VALUES
 (pg_temp.ident(3,1),pg_temp.ident(2,1),pg_temp.ident(1,5),pg_temp.ident(1,3),pg_temp.ident(1,1),'Test','Client A','active'),
 (pg_temp.ident(3,2),pg_temp.ident(2,2),NULL,NULL,pg_temp.ident(1,2),'Test','Client B','active'),
 (pg_temp.ident(3,4),pg_temp.ident(2,4),NULL,NULL,pg_temp.ident(1,9),'Test','Agency client','active');
INSERT INTO public.paige_skills(id,slug,name,category,status)
 VALUES(pg_temp.ident(4,1),'test_exp09_run_read','Test original run read','client_delivery','active');
INSERT INTO public.paige_skill_runs(id,skill_id,skill_slug,contact_id,invoker_user_id,invoker_kind,inputs,outputs,steps_log,duration_ms,status)
 SELECT pg_temp.ident(5,n),pg_temp.ident(4,1),'test_exp09_run_read',
 CASE WHEN n=3 THEN NULL ELSE pg_temp.ident(3,n) END,pg_temp.ident(1,4),'mcp',
 jsonb_build_object('scope','test-original-'||n),jsonb_build_object('draft','Test private draft '||n),
 '[{"result":"draft_saved"}]'::jsonb,42,'succeeded' FROM unnest(ARRAY[1,2,3,4]) n;

CREATE FUNCTION pg_temp.read_run(_actor int,_tenant int,_run int,_role text DEFAULT 'service_role') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role',_role,'sub',pg_temp.ident(1,1))::text,true);
 EXECUTE format('SET LOCAL ROLE %I',_role);
 BEGIN
  EXECUTE format('SELECT public.read_mcp_skill_run(%L,%L,%L)',
   CASE WHEN _actor IS NULL THEN NULL ELSE pg_temp.ident(1,_actor) END,
   CASE WHEN _tenant IS NULL THEN NULL ELSE pg_temp.ident(2,_tenant) END,
   CASE WHEN _run IS NULL THEN NULL ELSE pg_temp.ident(5,_run) END) INTO result;
 EXCEPTION WHEN OTHERS THEN result:=jsonb_build_object('sqlstate',SQLSTATE); END;
 RESET ROLE;PERFORM set_config('request.jwt.claims','{}',true);RETURN result;
END $$;

SELECT ok(has_function_privilege('service_role','public.read_mcp_skill_run(uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.read_mcp_skill_run(uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.read_mcp_skill_run(uuid,uuid,uuid)','EXECUTE'),'only the trusted service delegate can execute');
SELECT ok((SELECT NOT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']::text[]
 FROM pg_proc WHERE oid='public.read_mcp_skill_run(uuid,uuid,uuid)'::regprocedure),'read is STABLE INVOKER with empty search path');
SELECT is(pg_temp.read_run(1,1,1)->>'id',pg_temp.ident(5,1)::text,'owner reads current business original result');
SELECT is(pg_temp.read_run(1,1,1)->'steps','[{"result":"draft_saved"}]'::jsonb,'original steps_log retains steps DTO alias');
SELECT is(pg_temp.read_run(1,1,1)->>'latency_ms','42','original duration_ms retains latency DTO alias');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.read_run(1,1,1)) k),
 ARRAY['completed_at','contact_id','created_at','error','id','inputs','invoker_kind','invoker_user_id','latency_ms','outputs','skill_id','skill_slug','status','steps']::text[],'closed original payload, no new role/tenant or cost claims');
SELECT is(pg_temp.read_run(3,1,1)->>'id',pg_temp.ident(5,1)::text,'assigned active staff reads original contact result');
SELECT is(pg_temp.read_run(4,1,1),NULL::jsonb,'ordinary membership and own invoker do not grant private result read');
SELECT is(pg_temp.read_run(5,1,1),NULL::jsonb,'linked customer receives no staff payload');
SELECT is(pg_temp.read_run(2,2,1),NULL::jsonb,'other business owner cannot read run');
SELECT is(pg_temp.read_run(1,1,2),NULL::jsonb,'dual owner cannot read unselected business');
SELECT is(pg_temp.read_run(1,2,2),NULL::jsonb,'forged expected workspace cannot select another membership');
SELECT is(pg_temp.read_run(1,1,3),NULL::jsonb,'contactless historical result is unavailable to ordinary owner');
SELECT is(pg_temp.read_run(1,1,99),NULL::jsonb,'missing run has same result as denied');
SELECT is(pg_temp.read_run(NULL,1,1),NULL::jsonb,'NULL actor never becomes a platform key');
SELECT is(pg_temp.read_run(1,NULL,1),NULL::jsonb,'NULL expected workspace is refused');
SELECT is(pg_temp.read_run(1,1,NULL),NULL::jsonb,'NULL run is refused');
SELECT is(pg_temp.read_run(1,1,1,'authenticated')->>'sqlstate','42501','authenticated caller cannot supply a delegated actor');
SELECT is(pg_temp.read_run(1,1,1,'anon')->>'sqlstate','42501','anonymous caller cannot supply a delegated actor');
SELECT is(pg_temp.read_run(6,1,1),NULL::jsonb,'platform_admin tier is not original super-admin global data permission');
SELECT is(pg_temp.read_run(7,1,3)->>'id',pg_temp.ident(5,3)::text,'original actual platform-owner contactless exception retained');
SELECT is(pg_temp.read_run(7,1,2)->>'id',pg_temp.ident(5,2)::text,'original actual platform-owner global exception retained');

UPDATE public.profiles SET active_tenant_id=pg_temp.ident(2,2) WHERE user_id=pg_temp.ident(1,1);
SELECT is(pg_temp.read_run(1,1,1),NULL::jsonb,'committed workspace switch before snapshot retires old expected business');
SELECT is(pg_temp.read_run(1,2,2)->>'id',pg_temp.ident(5,2)::text,'fresh selected second business can read its own result');
UPDATE public.profiles SET active_tenant_id=NULL WHERE user_id=pg_temp.ident(1,1);
SELECT is(pg_temp.read_run(1,1,1)->>'id',pg_temp.ident(5,1)::text,'canonical earliest-active membership fallback preserved');
UPDATE public.profiles SET active_tenant_id=pg_temp.ident(2,1) WHERE user_id=pg_temp.ident(1,1);
UPDATE public.tenant_members SET role='member',is_owner=false WHERE user_id=pg_temp.ident(1,1) AND tenant_id=pg_temp.ident(2,1);
SELECT is(pg_temp.read_run(1,1,1),NULL::jsonb,'owner authority revocation stops original read');
UPDATE public.clients SET assigned_coach_user_id=NULL WHERE id=pg_temp.ident(3,1);
SELECT is(pg_temp.read_run(3,1,1),NULL::jsonb,'assignment revocation stops staff read');
UPDATE public.clients SET assigned_coach_user_id=pg_temp.ident(1,3) WHERE id=pg_temp.ident(3,1);
UPDATE public.tenant_members SET status='inactive' WHERE user_id=pg_temp.ident(1,3);
SELECT is(pg_temp.read_run(3,1,1),NULL::jsonb,'membership revocation stops assigned read');
SELECT is(pg_temp.read_run(8,1,1),NULL::jsonb,'inactive owner is not authorized');
SELECT is(public.get_actor_access(pg_temp.ident(1,9))->>'account_id',pg_temp.ident(2,4)::text,'canonical authority resolves actual agency child selection');
SELECT is(pg_temp.read_run(9,3,4),NULL::jsonb,'legacy parent workspace disagreement refuses rather than choosing another authority');
SELECT is(pg_temp.read_run(9,4,4)->>'id',pg_temp.ident(5,4)::text,'native canonical child authority and original agency staff predicate agree');

-- Original company membership comes from operator standing, never an invented
-- tenant seat. These unlinked contacts do not trigger customer/staff onboarding.
INSERT INTO public.tenants(id,slug,name,status,account_type,features)
 SELECT pg_temp.ident(2,n),'test-tenant-run-reader-'||n,'Test company workspace '||n,
 'active','standalone','{"system_workspace":true}'::jsonb FROM generate_series(5,6) n;
INSERT INTO public.clients(id,tenant_id,assigned_coach_user_id,first_name,last_name,status) VALUES
 (pg_temp.ident(3,5),pg_temp.ident(2,5),pg_temp.ident(1,6),'Test','Company A','active'),
 (pg_temp.ident(3,6),pg_temp.ident(2,6),pg_temp.ident(1,6),'Test','Company B','active');
INSERT INTO public.paige_skill_runs(id,skill_id,skill_slug,contact_id,invoker_kind,inputs,outputs,status)
 SELECT pg_temp.ident(5,n),pg_temp.ident(4,1),'test_exp09_run_read',pg_temp.ident(3,n),'mcp',
 '{}'::jsonb,'{"draft":"Test company draft"}'::jsonb,'succeeded' FROM generate_series(5,6) n;
CREATE FUNCTION pg_temp.rls_run_count(_actor int,_run int) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE result bigint;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ident(1,_actor))::text,true);
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO result FROM public.paige_skill_runs WHERE id=pg_temp.ident(5,_run);
 RESET ROLE;PERFORM set_config('request.jwt.claims','{}',true);RETURN result;
END $$;
SELECT is(pg_temp.read_run(6,5,5),NULL::jsonb,'company role alone cannot select a company over the actual active workspace');
UPDATE public.profiles SET active_tenant_id=pg_temp.ident(2,5) WHERE user_id=pg_temp.ident(1,6);
SELECT is(pg_temp.rls_run_count(6,5),1::bigint,'original authenticated run RLS admits seatless assigned company operator');
SELECT is(pg_temp.read_run(6,5,5)->>'id',pg_temp.ident(5,5)::text,'native read preserves original assigned company-operator permission');
SELECT is((SELECT count(*) FROM public.tenant_members WHERE tenant_id=pg_temp.ident(2,5) AND user_id=pg_temp.ident(1,6)),0::bigint,'company authority creates no tenant seat');
SELECT is(pg_temp.read_run(6,6,6),NULL::jsonb,'another company is not the selected workspace');
SELECT is(pg_temp.read_run(6,1,1),NULL::jsonb,'company operator receives no ordinary customer-business global read');
SELECT is(pg_temp.read_run(6,5,3),NULL::jsonb,'company operator receives no contactless result');
SELECT is(pg_temp.read_run(4,5,5),NULL::jsonb,'nonoperator invoker or member elsewhere is not a company operator');
UPDATE public.profiles SET active_tenant_id=NULL WHERE user_id=pg_temp.ident(1,6);
SELECT is(pg_temp.read_run(6,5,5),NULL::jsonb,'NULL selected company cannot inherit a company from run or first membership');
UPDATE public.profiles SET active_tenant_id=pg_temp.ident(2,5) WHERE user_id=pg_temp.ident(1,6);
UPDATE public.clients SET assigned_coach_user_id=NULL WHERE id=pg_temp.ident(3,5);
SELECT is(pg_temp.read_run(6,5,5),NULL::jsonb,'assignment loss retires company operator result read');
UPDATE public.clients SET assigned_coach_user_id=pg_temp.ident(1,6) WHERE id=pg_temp.ident(3,5);
DELETE FROM public.user_roles WHERE user_id=pg_temp.ident(1,6) AND role='platform_admin';
SELECT is(pg_temp.read_run(6,5,5),NULL::jsonb,'operator-role loss retires seatless company read');
INSERT INTO public.user_roles(user_id,role) VALUES(pg_temp.ident(1,6),'platform_admin');
UPDATE public.tenants SET features='{}'::jsonb WHERE id=pg_temp.ident(2,5);
SELECT is(pg_temp.read_run(6,5,5),NULL::jsonb,'retired company classification cannot leave operator result access');
SELECT is((SELECT count(*) FROM public.paige_skill_runs WHERE skill_id=pg_temp.ident(4,1)),6::bigint,'reads created or retried no skill run');
SELECT * FROM finish();
ROLLBACK;
