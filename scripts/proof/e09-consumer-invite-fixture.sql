-- Narrow synthetic PostgreSQL fixture. This is not a full Supabase replay or customer QA.
-- Auth identities and scope helpers below are local stand-ins; acceptance and the staff
-- active-workspace guard are loaded from the actual committed migration definitions.
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TYPE public.tenant_role AS ENUM ('owner','admin','member');
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;
CREATE TABLE public.tenants(id uuid PRIMARY KEY,owner_user_id uuid,account_type text DEFAULT 'standalone',updated_at timestamptz);
CREATE TABLE public.clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,linked_user_id uuid UNIQUE,first_name text,last_name text,created_by uuid,onboarding_stage text,status text DEFAULT 'active',created_by_channel_type text,created_at timestamptz DEFAULT now(),updated_at timestamptz,merged_into_contact_id uuid);
CREATE TABLE public.client_contact_methods(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid,tenant_id uuid,kind text,value text,match_key text);
CREATE TABLE public.user_roles(user_id uuid,role text,PRIMARY KEY(user_id,role));
CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role public.tenant_role,status text,is_owner boolean,joined_at timestamptz,updated_at timestamptz,PRIMARY KEY(tenant_id,user_id));
CREATE TABLE public.tenant_invite_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,token text UNIQUE,kind text,default_role public.tenant_role DEFAULT 'member',created_by uuid,created_at timestamptz DEFAULT now(),expires_at timestamptz,max_uses integer,uses integer DEFAULT 0,last_used_at timestamptz,revoked_at timestamptz,contact_id uuid,email text,agency_role text);
CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,action text NOT NULL,entity text NOT NULL,entity_id uuid,data jsonb,created_at timestamptz DEFAULT now());
CREATE FUNCTION public.agency_can_manage_child(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.agency_team_role(uuid,uuid) RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
CREATE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.contact_method_match_key(text,text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT lower(btrim($2)) $$;
CREATE FUNCTION public._attach_client_address(uuid,uuid,text,text) RETURNS void LANGUAGE sql AS $$ INSERT INTO public.client_contact_methods(tenant_id,client_id,kind,value,match_key) VALUES($1,$2,$3,$4,lower(btrim($4))) $$;
CREATE FUNCTION public.proof_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('clients',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM clients x),
 'roles',(SELECT jsonb_agg(to_jsonb(x) ORDER BY user_id,role) FROM user_roles x),
 'profiles',(SELECT jsonb_agg(to_jsonb(x) ORDER BY user_id) FROM profiles x),
 'members',(SELECT jsonb_agg(to_jsonb(x) ORDER BY tenant_id,user_id) FROM tenant_members x),
 'invites',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM tenant_invite_tokens x),
 'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM audit_logs x));
$$;
