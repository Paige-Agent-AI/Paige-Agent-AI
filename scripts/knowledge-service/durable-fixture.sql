-- Native envelope dependency fixture. No network, cron or provider calls.
CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);
CREATE TABLE public.tenants(id uuid PRIMARY KEY,status text,is_company_workspace boolean DEFAULT false);
CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,status text,role text,is_owner boolean DEFAULT false);
CREATE TABLE public.user_roles(user_id uuid,role text);
CREATE TABLE public.paige_chat_threads(id uuid PRIMARY KEY,tenant_id uuid,caller_user_id uuid,is_archived boolean DEFAULT false);
CREATE TABLE public.marketing_content(id uuid PRIMARY KEY);
CREATE TABLE public.paige_chat_turns(id uuid PRIMARY KEY);
DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['paige_workflow_runs','paige_skill_runs','business_verification_runs','security_canary_runs','paige_readiness_scan_runs','research_runs','paige_eval_run','paige_systems_check_run','paige_authority_act_runs','paige_media_jobs','paige_social_jobs','paige_act_executions'] LOOP EXECUTE format('CREATE TABLE public.%I(id uuid PRIMARY KEY)',n); END LOOP; END $$;
CREATE FUNCTION public.is_super_admin(a uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=a AND role='super_admin')$$;
CREATE FUNCTION public.is_platform_owner(a uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT public.is_super_admin(a)$$;
CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT public.is_platform_owner(auth.uid())$$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(a uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=a AND role IN ('platform_admin','super_admin'))$$;
CREATE FUNCTION public.is_company_workspace(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT coalesce((SELECT is_company_workspace FROM public.tenants WHERE id=t),false)$$;
-- Exact canonical actor-aware helper composition from 20270521000000.
CREATE FUNCTION public.is_tenant_admin_as(_actor uuid,_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id=_tenant AND user_id=_actor AND status='active' AND role IN ('owner','admin'))
 OR (_actor IS NOT NULL AND public.is_company_workspace(_tenant) AND public.is_platform_admin(_actor))$$;
CREATE FUNCTION public.has_tenant_role(a uuid,t uuid,r text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=a AND tenant_id=t AND status='active' AND role=r)$$;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb) RETURNS bigint LANGUAGE sql AS $$SELECT 1::bigint$$;
CREATE FUNCTION public.cron_token_header() RETURNS text LANGUAGE sql AS $$SELECT 'local-no-network'::text$$;
INSERT INTO auth.users(id) SELECT ('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,4)n;
INSERT INTO public.tenants VALUES('00000000-0000-0000-0000-000000000001','active',false),('00000000-0000-0000-0000-000000000002','active',false),('00000000-0000-0000-0000-000000000003','active',true),('00000000-0000-0000-0000-000000000004','active',true);
INSERT INTO public.tenant_members VALUES('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','active','coach',false),('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','active','member',false);
INSERT INTO public.user_roles VALUES('10000000-0000-0000-0000-000000000002','platform_admin'),('10000000-0000-0000-0000-000000000003','super_admin');
INSERT INTO public.profiles VALUES('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'),('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001');
INSERT INTO public.paige_chat_threads VALUES('50000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',false);
