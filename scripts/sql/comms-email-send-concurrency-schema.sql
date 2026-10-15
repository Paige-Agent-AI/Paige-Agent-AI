-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- DISPOSABLE LOCAL POSTGRES ONLY. Minimal stub of exactly what
-- supabase/migrations/20270597000000_comms_email_send.sql references, so the migration can be
-- applied VERBATIM on top of it by scripts/sql/comms-email-send-concurrency-proof.mjs.
--
-- Every object below mirrors the shape the migration reads (column names, CHECK values, function
-- signatures). It is NOT the production schema: RLS policies, other triggers, generated columns
-- and foreign keys that the migration never touches are left out. What this proves is real
-- PostgreSQL locking / role / grant behaviour of the migration's SQL; hosted Supabase is UNVERIFIED.
--
-- References in the migration, and where each is stubbed:
--   auth.users (id, deleted_at, banned_until) · auth.uid()          → auth schema below
--   public.tenants (id, status)                                      → tenants
--   public.profiles (user_id, active_tenant_id)                      → profiles
--   public.tenant_members (tenant_id, user_id, status, role)         → tenant_members + tenant_role enum
--   public.clients (id, tenant_id)                                   → clients
--   public.client_contact_methods (tenant_id, client_id, kind, value)→ client_contact_methods
--   public.channel_connectors (id, tenant_id, channel_type, provider, from_address, status, active)
--   public.messages (every column prepare/claim/finalize read or write, incl. the real status CHECK)
--   public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb)  (prod signature)
--   extensions.digest(bytea,text)                                    → pgcrypto in schema extensions
--   roles anon / authenticated / service_role
-- Not referenced by the migration, stubbed only for parity with the Supabase surface:
--   public.current_user_tenant_id()
-- ─────────────────────────────────────────────────────────────────────────────────────────────
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- ── auth ────────────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA auth;
CREATE TABLE auth.users(
  id uuid PRIMARY KEY,
  email text,
  deleted_at timestamptz,
  banned_until timestamptz
);
-- Same resolution order as Supabase's auth.uid(): request.jwt.claim.sub, then request.jwt.claims->>'sub'.
-- A service_role session sets neither, so auth.uid() is NULL there — exactly what the migration's
-- guard trigger keys on.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- ── public dependencies ─────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE TYPE public.tenant_role AS ENUM ('owner','admin','coach','member');

CREATE TABLE public.tenants(
  id uuid PRIMARY KEY,
  slug text,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE public.profiles(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id),
  active_tenant_id uuid REFERENCES public.tenants(id)
);

CREATE TABLE public.tenant_members(
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role public.tenant_role NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'active',
  is_owner boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE public.clients(
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  first_name text,
  UNIQUE (id, tenant_id)
);

CREATE TABLE public.client_contact_methods(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('email','phone')),
  value text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  FOREIGN KEY (client_id, tenant_id) REFERENCES public.clients(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE public.channel_connectors(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  channel_type text NOT NULL CHECK (channel_type IN ('email','sms','whatsapp','instagram','facebook','voice')),
  provider text,
  from_name text,
  from_address text,
  reply_to text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Columns as 20260726190000_comms_c1_messages_channel_connectors.sql, status CHECK as amended by
-- 20260726210000_comms_c2_twilio_a2p_suppression_foundation.sql (adds 'blocked', which finalize
-- writes for a pre-send refusal). action_id keeps its column; its FK target is not stubbed.
CREATE TABLE public.messages(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  thread_key text NOT NULL,
  contact_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  connector_id uuid REFERENCES public.channel_connectors(id) ON DELETE SET NULL,
  channel_type text NOT NULL CHECK (channel_type IN ('email','sms','whatsapp','instagram','facebook','voice')),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  status text NOT NULL DEFAULT 'received',
  sender jsonb,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  subject text,
  body_text text,
  body_html text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider_message_id text,
  in_reply_to_provider_id text,
  action_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_status_check
    CHECK (status IN ('draft','queued','sent','delivered','failed','received','read','blocked'))
);

-- The Rail. record_capability_run keeps the production ten-argument signature (the six-argument
-- overload was dropped by 20270411090000), so the migration's six-positional call resolves the same
-- way it does in prod. The stub only records the row.
CREATE TABLE public.paige_workspace_events(
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  capability_key text NOT NULL,
  outcome text NOT NULL,
  source_kind text NOT NULL DEFAULT 'capability_run',
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION public.record_capability_run(
  _tenant_id uuid, _actor_id uuid, _capability_key text, _outcome text, _run_id uuid,
  _agent_slug text DEFAULT NULL, _job_attempt_id text DEFAULT NULL, _llm_trace_id uuid DEFAULT NULL,
  _release_id text DEFAULT NULL, _detail jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  IF _tenant_id IS NULL OR _actor_id IS NULL OR _run_id IS NULL OR _capability_key IS NULL OR _outcome IS NULL THEN
    RAISE EXCEPTION 'CAPABILITY_RUN_INCOMPLETE' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.paige_workspace_events(tenant_id, actor_id, capability_key, outcome, source_id)
  VALUES (_tenant_id, _actor_id, _capability_key, _outcome, _run_id);
END $$;
REVOKE ALL ON FUNCTION public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_capability_run(uuid,uuid,text,text,uuid,text,text,uuid,text,jsonb) TO service_role;

CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT active_tenant_id FROM public.profiles WHERE user_id = auth.uid()
$$;

-- Browser roles keep ordinary table access so the proof shows the FUNCTION grants, not a missing
-- table grant, are what refuses them.
GRANT SELECT, INSERT, UPDATE ON public.messages TO authenticated;
GRANT SELECT ON public.paige_workspace_events TO service_role;
