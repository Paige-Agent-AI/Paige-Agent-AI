-- Stand-ins for the real surface, enough to CREATE the two writers and drive their refusals.
-- Deliberately permissive: the gates return true so the REFUSAL VOCABULARY is what gets exercised
-- here. Tenant isolation and role enforcement are proven against the real schema, not against this.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.tenant_client_agreements(
  id uuid DEFAULT gen_random_uuid(), tenant_id uuid, contact_id uuid, offer_id uuid, status text,
  updated_at timestamptz, agreed_amount_minor bigint, agreed_currency text, catalog_price_id uuid,
  catalog_price_snapshot_minor bigint, catalog_price_snapshot_currency text,
  catalog_price_snapshot_interval text, catalog_price_snapshot_kind text,
  catalog_price_snapshot_at timestamptz, title text, notes text, term_kind text,
  billing_interval text, interval_count integer, installments_total integer, payment_schedule text,
  price_basis text, starts_on date, renews_on date, ends_on date, created_by uuid);
CREATE TABLE public.tenant_prices(id uuid, tenant_id uuid, product_id uuid, unit_amount integer, currency text, billing_interval text, kind text);
CREATE TABLE public.tenant_products(id uuid, tenant_id uuid);
CREATE TABLE public.clients(id uuid, tenant_id uuid);
INSERT INTO public.clients VALUES ('c1111111-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001');
INSERT INTO public.tenant_products VALUES ('00000000-0000-4000-8000-0000000000f1','aaaaaaaa-0000-4000-8000-000000000001');
CREATE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean LANGUAGE sql AS 'select true';
CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql AS $$select 'aaaaaaaa-0000-4000-8000-000000000001'::uuid$$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$select '11111111-0000-4000-8000-000000000001'::uuid$$;
