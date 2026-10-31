-- Disposable local fixture only. Auth/tenant helpers are modeled by the ORIGINAL
-- Knowledge fixture; no customer identity, provider or production write occurs.
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('test.auth_role',true),''),'authenticated') $$;
CREATE TABLE public.paige_owner_memory(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,user_id uuid NOT NULL,
 memory_type text NOT NULL,content text NOT NULL,source_thread_id uuid,
 is_active boolean NOT NULL DEFAULT true,metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
-- Nullable embedding fields are outside these unembedded-writer controls. The
-- native functions below are extracted byte-for-byte from ORIGINAL migrations.
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT SELECT ON public.paige_owner_memory TO authenticated;
INSERT INTO auth.users(id) VALUES('10000000-0000-0000-0000-000000000001') ON CONFLICT DO NOTHING;
-- Match the ORIGINAL actor-aware Knowledge helper's fixture inputs as well as
-- the older caller-relative helper; neither helper implementation is replaced.
INSERT INTO public.tenants(id,status) VALUES('00000000-0000-0000-0000-000000000001','active') ON CONFLICT(id) DO UPDATE SET status='active';
UPDATE public.tenant_members SET status='active',role='member' WHERE user_id='10000000-0000-0000-0000-000000000001' AND tenant_id='00000000-0000-0000-0000-000000000001';
INSERT INTO public.tenant_members(user_id,tenant_id,status,role) SELECT '10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','active','member'
 WHERE NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id='10000000-0000-0000-0000-000000000001' AND tenant_id='00000000-0000-0000-0000-000000000001');
