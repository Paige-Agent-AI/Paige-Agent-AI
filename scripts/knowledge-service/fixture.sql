-- Isolated PostgreSQL fixture only. Canonical predicate behavior is modelled here;
-- this is not a Supabase schema replay or deployed identity proof.
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
CREATE TABLE public.test_members(user_id uuid,tenant_id uuid,active boolean DEFAULT true);
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.owner',true)='true' $$;
CREATE FUNCTION public.is_tenant_member(t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
SELECT EXISTS(SELECT 1 FROM public.test_members WHERE user_id=auth.uid() AND tenant_id=t AND active)
OR (current_setting('test.operator',true)='true' AND t='00000000-0000-0000-0000-000000000003') $$;
CREATE TABLE public.tenant_knowledge_docs(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,title text NOT NULL,content text NOT NULL,
 summary text,category text,tags text[],source text DEFAULT 'paste',source_url text,
 created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),chunk_count int DEFAULT 0,
 share_to_network boolean DEFAULT false,network_review_status text DEFAULT 'none');
CREATE TABLE public.test_receipts(run_id uuid PRIMARY KEY,actor_id uuid,tenant_id uuid,detail jsonb);
CREATE FUNCTION public.record_capability_run(t uuid,a uuid,k text,o text,r uuid,s text,j text,l uuid,x text,d jsonb)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
IF current_setting('test.receipt_fail',true)='true' OR NOT EXISTS(SELECT 1 FROM public.test_members WHERE user_id=a AND tenant_id=t AND active) THEN RAISE EXCEPTION 'receipt rejected'; END IF;
INSERT INTO public.test_receipts VALUES(r,a,t,d) ON CONFLICT DO NOTHING;
END $$;
INSERT INTO public.profiles VALUES('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001');
INSERT INTO public.test_members VALUES('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',true),('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',true);
INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content) VALUES
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','A','private A'),
('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','B','private B'),
('20000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003','Company','private Company');
CREATE FUNCTION public.test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; RAISE NOTICE 'PASS: %',label; END $$;
CREATE FUNCTION public.test_denied(statement text,expected text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$ BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE '%'||expected||'%' THEN RAISE NOTICE 'PASS: %',expected; RETURN; ELSE RAISE; END IF; END;
 RAISE EXCEPTION 'FAIL: expected %',expected;
END $$;
