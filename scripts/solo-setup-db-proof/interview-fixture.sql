-- Disposable proof dependency schema only; no production/session/provider data.
-- Actual Setup writers/readers and Owner predicates are extracted unchanged
-- from tracked migrations by interview-checkpoint.mjs. Vault is never called.
alter table public.tenants add column archived_at timestamptz;
alter table public.tenants add column lifecycle_execution_paused boolean not null default false;
create function public.is_platform_owner() returns boolean language sql stable as $$ select false $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
create table public.clients(id uuid primary key);
create schema vault;
create table vault.secrets(id uuid primary key,name text);
create table public.paige_audit_log(
  id uuid primary key default gen_random_uuid(),actor_user_id uuid,actor_role text,
  action text,target_type text,target_id uuid,tenant_id uuid,payload jsonb,created_at timestamptz default now()
);
create table public.tenant_legal_profile(
  id uuid primary key default gen_random_uuid(),tenant_id uuid unique references public.tenants(id),
  legal_business_name text,dba_name text,entity_type text,state_of_formation text,
  registered_address text,support_phone text,website_url text,business_identity text,business_industry text,
  business_regions_of_operation text[],business_registration_identifier text,
  business_registration_number_secret_ref text,business_registration_number_last_4 text,
  registered_street text,registered_street_secondary text,registered_city text,registered_region text,
  registered_postal_code text,registered_iso_country text,authorized_representative_user_id uuid,
  authorized_representative_phone text,authorized_representative_job_position text,
  setup_provenance jsonb not null default '{}',updated_at timestamptz default now()
);
