CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  -- service_role mirrors prod: bypasses RLS, NOT a superuser, NOT a member of the table owner.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $r$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name,'/') $$;

CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.clients (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants(id), linked_user_id uuid, email text);
CREATE TABLE public.tenant_products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants(id));
CREATE TABLE public.tenant_prices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, product_id uuid);
CREATE TABLE public.tenant_client_agreements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants(id), contact_id uuid REFERENCES public.clients(id));
CREATE TABLE public.tenant_agreement_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES public.tenants(id));

-- Session-scoped stand-ins for the real auth helpers.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.tenant', true),'')::uuid $$;
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.owner', true)::boolean, false) $$;
CREATE FUNCTION public.is_tenant_admin(_t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.admin', true)::boolean, false) $$;
CREATE FUNCTION public.is_tenant_member(_t uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.member', true)::boolean, true) $$;
CREATE FUNCTION public.tenant_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

INSERT INTO public.tenants (id,name) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','Tenant A'),
  ('bbbbbbbb-0000-4000-8000-000000000002','Tenant B');
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS brand jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.tenant_client_agreements ADD COLUMN IF NOT EXISTS agreed_amount_minor bigint;
ALTER TABLE public.tenant_client_agreements ADD COLUMN IF NOT EXISTS agreed_currency text;
ALTER TABLE public.tenant_client_agreements ADD COLUMN IF NOT EXISTS term_kind text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS last_name text;
-- §51/§61 tier columns. The tier trigger in 20270405000000 refuses a TOP-LEVEL agency, so both
-- proof tenants are ordinary solo workspaces and a third exists purely to prove the refusal.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'standalone';
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS parent_tenant_id uuid REFERENCES public.tenants(id);
INSERT INTO public.tenants (id,name,account_type) VALUES
  ('dddddddd-0000-4000-8000-000000000004','Agency D','agency');
INSERT INTO public.clients (id,tenant_id) VALUES
  ('c1111111-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001'),
  ('c2222222-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000002'),
  ('c4444444-0000-4000-8000-000000000004','dddddddd-0000-4000-8000-000000000004');
-- A contact's addresses (20270515000000), reduced to the columns the counterparty trigger reads.
CREATE TABLE public.client_contact_methods (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE, kind text NOT NULL, value text NOT NULL,
  label text, is_primary boolean NOT NULL DEFAULT false, position integer NOT NULL);
INSERT INTO public.client_contact_methods (tenant_id,client_id,kind,value,is_primary,position) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','c1111111-0000-4000-8000-000000000001','email','a-client@example.com',true,0),
  ('bbbbbbbb-0000-4000-8000-000000000002','c2222222-0000-4000-8000-000000000002','email','b-client@example.com',true,0),
  ('dddddddd-0000-4000-8000-000000000004','c4444444-0000-4000-8000-000000000004','email','d-client@example.com',true,0);
-- The one reader of a contact's primary address (20270516000000), verbatim: the counterparty
-- trigger reads the signer's email through it.
CREATE FUNCTION public.client_primary_address(_client_id uuid, _kind text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.value FROM public.client_contact_methods AS m
   WHERE m.client_id = _client_id AND m.kind = _kind AND m.is_primary
   ORDER BY m.position LIMIT 1
$$;
