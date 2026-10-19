-- DISPOSABLE LOCAL POSTGRES ONLY. Extension of the incumbent concurrency fixture.
-- Exact native bodies/RLS/grants are installed by the owning runner. These dependency
-- row types and local role resolvers are synthetic, not hosted Auth/provider/Rail proof.
ALTER TABLE public.channel_connectors
 ADD mailbox_class text NOT NULL DEFAULT 'shared_support',
 ADD mailbox_owner_user_id uuid REFERENCES auth.users(id);
ALTER TABLE public.clients ADD last_contacted_at timestamptz;
CREATE TABLE public.tenant_email_domains(tenant_id uuid,domain text,sendgrid_status text,sendgrid_domain_id text,sendgrid_verified_at timestamptz);
CREATE TABLE public.paige_pending_approvals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,contact_id uuid,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','sent','changes_requested','escalated','skipped')),
 metadata jsonb DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by_user_id uuid,reviewed_at timestamptz,sent_at timestamptz,decision_rationale text,
 sent_message_audit_id uuid,type text,category text,draft_content jsonb,conversation_id uuid,
 source text,risk_level text,submitted_by_user_id uuid);
CREATE TABLE public.paige_action_kinds(slug text PRIMARY KEY,executor text,requires_approval boolean,default_autonomy_lane text,approval_type text);
CREATE TABLE public.paige_actions(
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 contact_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
 approval_id uuid REFERENCES public.paige_pending_approvals(id) ON DELETE SET NULL,
 action_kind text NOT NULL REFERENCES public.paige_action_kinds(slug),
 status text NOT NULL CHECK(status IN('filed','assigned','drafting','drafted','pending_approval','approved','executing','done','dismissed','failed','blocked','expired')),
 title text,summary text,payload jsonb DEFAULT '{}',draft_content jsonb,result jsonb,error text,
 decision_rationale text,assigned_subagent_slug text,assigned_to_user_id uuid,assigned_at timestamptz,
 drafted_at timestamptz,executed_at timestamptz,resolved_at timestamptz,invocation_id uuid,
 conversation_id uuid,customer_action_id uuid,workflow_run_id uuid);
CREATE TABLE public.paige_subagents(slug text PRIMARY KEY,enabled boolean,tenant_id uuid);
CREATE TABLE public.paige_workflow_registry(id uuid,key text,is_active boolean,tenant_id uuid,requires_approval boolean);
CREATE TABLE public.paige_workflow_runs(id uuid DEFAULT gen_random_uuid(),registry_id uuid,tenant_id uuid,triggered_by_user_id uuid,payload jsonb,status text);
CREATE TABLE public.audit_logs(user_id uuid,entity text,action text,entity_id uuid,data jsonb);
CREATE TYPE public.app_role AS ENUM ('admin','super_admin','coach','user');
CREATE FUNCTION public.has_any_role(_user uuid,_roles text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('proof.app_role',true),''),'admin')=ANY(_roles)
$$;
CREATE FUNCTION public.has_role(_user uuid,_role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('proof.app_role',true),''),'admin')=_role::text
$$;
CREATE FUNCTION public.is_platform_owner(_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
GRANT SELECT,UPDATE ON public.paige_pending_approvals TO authenticated,service_role;
GRANT SELECT ON public.paige_action_kinds TO authenticated,service_role;
GRANT ALL ON public.audit_logs TO service_role;
INSERT INTO public.paige_action_kinds VALUES
 ('owner.lead_followup','send_via_approval',true,'confirm','cs_draft'),
 ('client.followup','send_via_approval',true,'confirm','cs_draft'),
 ('owner.followup_email','send_via_approval',true,'confirm','cs_draft'),
 ('client.other_send','send_via_approval',true,'confirm','cs_draft');
