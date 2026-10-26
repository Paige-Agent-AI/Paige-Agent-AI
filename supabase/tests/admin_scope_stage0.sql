-- Admin scope, STAGE 0 (migration 20271115030008): owning or administering one business never
-- gives admin power in another. Owner ruling 2026-10-26.
--
-- How this proof works:
--   1. A disposable database gets the production definitions (pg_get_functiondef / pg_policies,
--      2026-10-26) of every object the migration changes, plus the real bodies of the helpers they
--      call. Each production body is checked against production's md5 of its source, so a
--      transcription slip fails the run. Only these are stubbed: auth.uid()/auth.role(), the pgvector
--      type and <=> operator (not installed here), realtime.send, and four functions outside the
--      authority path (platform_encrypt, client_primary_address, can_read_owner_task_approval, and
--      client_portal_relationship_id, which answers from the clients fixture). Tables carry only the columns the bodies use. clients and
--      businesses have no RLS here, so a policy's own binding is the only guard tested.
--   2. FAILING FIRST: every check runs against production's definitions. Every "hole" check must FAIL
--      there (X, owner of A and a plain member of B, gets admin power where they hold no admin seat).
--   3. The migration is applied (\ir). Every check must PASS.
--   4. MUTANTS (§71.4): each object's production definition is put back on its own, inside a
--      subtransaction, and the checks that fail are listed. Every mutant must fail at least one check.
--
-- Fixtures are fictional. Actors: SA super_admin, PA platform_admin, OA owner of A, AA admin of A,
-- MA member of A, X owner of A AND member of B, OB owner of B, MB member of B, CL client of A,
-- CLB client of B, GO owner of agency G (child C), V an outsider, plus anon and service_role.
\set QUIET on
\set ON_ERROR_STOP on
DROP DATABASE IF EXISTS admin_scope_stage0_proof;
CREATE DATABASE admin_scope_stage0_proof;
\c admin_scope_stage0_proof
SET client_min_messages = warning;

-- ═════════════════════════════════ ROLES, AUTH, TYPES, STUBS ═════════════════════════════════
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
-- STUB: Supabase's bodies.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);

-- Production's enum values, in order.
CREATE TYPE public.app_role AS ENUM ('admin','moderator','user','affiliate','coach','broker','broker_team_member',
  'super_admin','sales_rep','cs_rep','finance','viewer','client','developer','platform_admin');
CREATE TYPE public.tenant_role AS ENUM ('owner','admin','coach','member');

-- STUB: pgvector is not installed here. The domain and operator give match_rag_documents its types.
CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE DOMAIN extensions.vector AS float8[];
CREATE FUNCTION extensions.proof_cosine(float8[], float8[]) RETURNS float8 LANGUAGE sql IMMUTABLE AS $$ SELECT 0::float8 $$;
CREATE OPERATOR extensions.<=> (LEFTARG = float8[], RIGHTARG = float8[], FUNCTION = extensions.proof_cosine);

-- ═════════════════════════════════ TABLES (columns the bodies use) ═══════════════════════════
CREATE TABLE public.tenants (id uuid PRIMARY KEY, name text NOT NULL, account_type text NOT NULL DEFAULT 'standalone',
  parent_tenant_id uuid REFERENCES public.tenants(id), features jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active', archived_at timestamptz);
CREATE TABLE public.tenant_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id), user_id uuid NOT NULL,
  role public.tenant_role NOT NULL DEFAULT 'member', status text NOT NULL DEFAULT 'active',
  is_owner boolean NOT NULL DEFAULT false, invited_at timestamptz, joined_at timestamptz DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id));
CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE,
  updated_at timestamptz, ssn_encrypted text, date_of_birth date, ssn_last_4 text,
  suspended_at timestamptz, suspended_reason text, suspended_by uuid, active_tenant_id uuid);
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
  role public.app_role NOT NULL DEFAULT 'user', created_at timestamptz DEFAULT now(), UNIQUE (user_id, role));
CREATE TABLE public.agency_team_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agency_tenant_id uuid NOT NULL,
  user_id uuid, agency_role text NOT NULL, status text NOT NULL, scoped_subaccounts uuid[] NOT NULL DEFAULT '{}');
CREATE TABLE public.audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, action text NOT NULL,
  entity text NOT NULL, entity_id uuid, data jsonb, created_at timestamptz DEFAULT now());
-- Production's columns exactly: there is NO metadata column (see the suspend_user note below).
CREATE TABLE public.paige_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, actor_role text,
  action text NOT NULL, target_type text, target_id uuid, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), tenant_id uuid, operator_rows_server_only boolean DEFAULT false);
CREATE TABLE public.pii_access_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), accessed_user_id uuid NOT NULL,
  accessor_user_id uuid NOT NULL, table_name text NOT NULL, field_names text[] NOT NULL, access_type text NOT NULL,
  accessed_at timestamptz DEFAULT now());
CREATE TABLE public.clients (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, linked_user_id uuid, first_name text NOT NULL DEFAULT 'F',
  last_name text NOT NULL DEFAULT 'L', assigned_coach_user_id uuid);
CREATE TABLE public.businesses (id uuid PRIMARY KEY, owner_user_id uuid NOT NULL, legal_name text NOT NULL DEFAULT 'Co', tenant_id uuid);
CREATE TABLE public.business_certifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_id uuid NOT NULL,
  user_id uuid NOT NULL, certification_type text NOT NULL, status text NOT NULL DEFAULT 'pending', certified_at date);
CREATE TABLE public.business_verification_runs (id uuid PRIMARY KEY, business_id uuid, contact_id uuid);
CREATE TABLE public.business_verifications (id uuid PRIMARY KEY, run_id uuid NOT NULL, business_id uuid, source text NOT NULL DEFAULT 's');
CREATE TABLE public.chat_message_embeddings (id uuid PRIMARY KEY, message_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, client_user_id uuid, role text NOT NULL DEFAULT 'user', content_excerpt text NOT NULL DEFAULT 'x');
CREATE TABLE public.client_goals (id uuid PRIMARY KEY, user_id uuid NOT NULL, goal_category text NOT NULL DEFAULT 'g',
  status text NOT NULL DEFAULT 'active');
CREATE TABLE public.lender_research_results (id uuid PRIMARY KEY, user_id uuid NOT NULL, client_user_id uuid);
CREATE TABLE public.rag_documents (id uuid PRIMARY KEY, document_type text NOT NULL DEFAULT 'note', title text NOT NULL DEFAULT 't',
  content text NOT NULL DEFAULT 'c', summary text, embedding extensions.vector, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_id uuid, is_published boolean NOT NULL DEFAULT true, quality_score numeric NOT NULL DEFAULT 0.5,
  usage_count int NOT NULL DEFAULT 0, helpful_count int NOT NULL DEFAULT 0, updated_at timestamptz);
CREATE TABLE public.rag_retrieval_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, query_embedding extensions.vector,
  query_text text, retrieved_document_ids uuid[] NOT NULL DEFAULT '{}');
CREATE TABLE public.legal_acceptances (id uuid PRIMARY KEY, user_id uuid NOT NULL);
CREATE TABLE public.paige_sla_alert_log (id uuid PRIMARY KEY, client_id uuid, category text NOT NULL DEFAULT 'c', severity text NOT NULL DEFAULT 's');
CREATE TABLE public.extraction_quality_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid, user_id uuid NOT NULL);
CREATE TABLE public.tasks (id uuid PRIMARY KEY, user_id uuid NOT NULL, title text NOT NULL DEFAULT 't', tenant_id uuid);
CREATE TABLE public.paige_pending_approvals (id uuid PRIMARY KEY, type text NOT NULL DEFAULT 'x', draft_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending', assigned_to_user_id uuid, submitted_by_user_id uuid,
  visible_to_roles text[] NOT NULL DEFAULT ARRAY['admin'::text, 'super_admin'::text], tenant_id uuid);
CREATE TABLE public.paige_coach_assignments (id uuid PRIMARY KEY, contact_id uuid, coach_id uuid, tenant_id uuid);
CREATE TABLE public.paige_approval_comments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), approval_id uuid NOT NULL, author_id uuid NOT NULL,
  body text NOT NULL DEFAULT 'b');
CREATE TABLE public.paige_skills (id uuid PRIMARY KEY, slug text NOT NULL, name text NOT NULL, status text NOT NULL DEFAULT 'active');
CREATE TABLE public.paige_skill_proposals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), proposed_slug text NOT NULL, proposed_name text NOT NULL);
CREATE TABLE public.paige_assignment_policy (tier text PRIMARY KEY, strategy text NOT NULL DEFAULT 'round_robin');
CREATE TABLE public.tenant_entity_relationships (id uuid PRIMARY KEY, contact_id uuid NOT NULL, entity_id uuid NOT NULL,
  relationship_type text NOT NULL DEFAULT 'r', tenant_id uuid);
CREATE TABLE public.credit_report_uploads (id uuid PRIMARY KEY, user_id uuid NOT NULL, file_path text NOT NULL, tenant_id uuid NOT NULL);
CREATE TABLE public.credit_report_personal_info (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), credit_report_upload_id uuid NOT NULL);
CREATE TABLE public.growth_external_sources (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, webhook_token_ct bytea);
CREATE TABLE public.paige_mcp_connections (id uuid PRIMARY KEY, server_url_ct bytea);
CREATE TABLE public.paige_n8n_connections (id uuid PRIMARY KEY, base_url_ct bytea);
CREATE TABLE public.outbound_webhook_configs (id uuid PRIMARY KEY, url_ct bytea);
CREATE TABLE public.connected_bank_accounts (id uuid PRIMARY KEY, user_id uuid NOT NULL, business_id uuid);
CREATE TABLE public.connected_bank_account_secrets (account_row_id uuid PRIMARY KEY, plaid_access_token_ct bytea);
CREATE TABLE public.studio_library_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, created_by uuid,
  artifact_kind text NOT NULL, artifact_id uuid NOT NULL, title text NOT NULL DEFAULT 'Untitled', thumbnail_url text, note text,
  tags jsonb NOT NULL DEFAULT '{}'::jsonb, saved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_library_items_unique_artifact UNIQUE (tenant_id, artifact_kind, artifact_id));
CREATE TABLE public.marketing_content (id uuid PRIMARY KEY, tenant_id uuid NOT NULL);
CREATE TABLE public.calendars (id uuid PRIMARY KEY, tenant_id uuid);
CREATE TABLE public.internal_bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, calendar_id uuid, host_user_id uuid NOT NULL,
  contact_id uuid, guest_name text, guest_email text, guest_phone text, title text NOT NULL, notes text, location text,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, timezone text NOT NULL, status text NOT NULL, source text NOT NULL,
  booking_kind text NOT NULL, appointment_type jsonb, intake_answers jsonb, reminder_state jsonb NOT NULL);
CREATE TABLE public.growth_funnels (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, status text NOT NULL DEFAULT 'active');
CREATE TABLE public.growth_funnel_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_token text NOT NULL, tenant_id uuid NOT NULL,
  funnel_id uuid NOT NULL, current_step int NOT NULL DEFAULT 0, completed boolean NOT NULL DEFAULT false,
  utm_json jsonb NOT NULL DEFAULT '{}'::jsonb, referrer text, user_agent text);
CREATE TABLE public._internal_secrets (key text PRIMARY KEY, value text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.user_business_limits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE,
  max_businesses int NOT NULL DEFAULT 1, additional_businesses_count int NOT NULL DEFAULT 0, updated_at timestamptz);

CREATE TABLE public.paige_event_kinds (slug text NOT NULL, tenant_id uuid, label text NOT NULL DEFAULT 'k',
  default_audience text NOT NULL DEFAULT 'owner', default_visibility text NOT NULL DEFAULT 'owner_internal', department text,
  enabled boolean NOT NULL DEFAULT true);
CREATE TABLE public.paige_client_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, contact_id uuid NOT NULL,
  event_kind text NOT NULL, surface text NOT NULL, actor_type text NOT NULL, actor_user_id uuid, audience text NOT NULL, visibility text NOT NULL,
  from_department text, to_department text, title text NOT NULL, summary text, payload jsonb NOT NULL DEFAULT '{}'::jsonb, ref_table text,
  ref_id uuid, occurred_at timestamptz NOT NULL DEFAULT now(), actor_agent_slug text, actor_agent_label text);
CREATE TABLE public.paige_subagents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE, tenant_id uuid, rail_display_name text);
-- STUB: Supabase Realtime's broadcast (record_rail_event calls it inside its own exception block).
CREATE SCHEMA realtime;
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void LANGUAGE sql AS $$ SELECT $$;

-- STUB: Supabase Storage, abridged; foldername is Supabase's body.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
  name text, owner uuid, metadata jsonb);
CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
END
$function$;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.buckets, storage.objects TO anon, authenticated, service_role;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- STUBS outside the authority path.
CREATE FUNCTION public.platform_encrypt(text) RETURNS bytea LANGUAGE sql IMMUTABLE AS $$ SELECT convert_to(coalesce($1,''), 'UTF8') $$;
CREATE FUNCTION public.client_primary_address(uuid, text) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
-- client_portal_relationship_id: the caller's own linked client row in the business asked about (production
-- also requires an active, unmerged client with an open portal in an active business, and refuses an
-- ambiguous pick; every fixture here is one active link per business).
CREATE FUNCTION public.client_portal_relationship_id(p_tenant_id uuid DEFAULT NULL::uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public' AS $$
  SELECT c.id FROM public.clients c WHERE c.linked_user_id = auth.uid() AND (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id)
   ORDER BY c.id LIMIT 1 $$;
CREATE FUNCTION public.can_read_owner_task_approval(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

-- ═════════════════════════════════ REAL HELPER BODIES (production, verbatim) ═════════════════
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$function$;
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text = ANY (_roles)
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role::text IN ('admin','super_admin','sales_rep','cs_rep','finance')
  );
$function$;
CREATE OR REPLACE FUNCTION public.current_user_roles()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(role::text), ARRAY[]::text[])
  FROM public.user_roles WHERE user_id = auth.uid();
$function$;
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'::public.app_role); $function$;
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin'::public.app_role); $function$;
CREATE OR REPLACE FUNCTION public.is_platform_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT public.is_super_admin() $function$;
CREATE OR REPLACE FUNCTION public.is_platform_owner(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT public.is_super_admin(_user_id) $function$;
CREATE OR REPLACE FUNCTION public.is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND (role::text = 'platform_admin' OR role::text = 'super_admin')); $function$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(_actor uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _actor AND (role::text = 'platform_admin' OR role::text = 'super_admin')
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_platform_operator()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT public.is_super_admin() OR public.is_platform_admin(auth.uid());
$function$;
CREATE OR REPLACE FUNCTION public.is_company_workspace(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenants t
     WHERE t.id = _tenant
       AND t.parent_tenant_id IS NULL
       AND t.account_type = 'standalone'
       AND COALESCE(t.features -> 'system_workspace' = 'true'::jsonb, false)
  );
$function$;
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = auth.uid()
       AND status = 'active' AND role IN ('owner','admin')
  )
  OR (public.is_company_workspace(_tenant) AND public.is_platform_operator());
$function$;
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_members
     WHERE tenant_id = _tenant AND user_id = auth.uid() AND status = 'active'
  )
  OR (public.is_company_workspace(_tenant) AND public.is_platform_operator());
$function$;
CREATE OR REPLACE FUNCTION public.agency_can_manage_child(_child uuid, _actor uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.tenants child
      JOIN public.tenants parent    ON parent.id = child.parent_tenant_id
      JOIN public.tenant_members pm ON pm.tenant_id = parent.id AND pm.user_id = _actor
      WHERE child.id = _child
        AND parent.account_type IN ('agency', 'enterprise')
        AND pm.status = 'active'
        AND pm.role = 'owner'
    )
    OR EXISTS (
      SELECT 1
      FROM public.tenants child
      JOIN public.tenants parent            ON parent.id = child.parent_tenant_id
      JOIN public.agency_team_members atm   ON atm.agency_tenant_id = parent.id
      WHERE child.id = _child
        AND parent.account_type IN ('agency', 'enterprise')
        AND atm.user_id = _actor
        AND atm.status = 'active'
        AND (
          atm.agency_role IN ('agency_owner','agency_admin','agency_manager')
          OR (atm.agency_role = 'agency_specialist' AND _child = ANY (atm.scoped_subaccounts))
        )
    );
$function$;
CREATE OR REPLACE FUNCTION public.agency_team_role(_agency uuid, _actor uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.tenant_members m
                  WHERE m.tenant_id = _agency AND m.user_id = _actor AND m.status = 'active' AND m.role = 'owner')
      THEN 'agency_owner'
    ELSE (SELECT atm.agency_role FROM public.agency_team_members atm
            WHERE atm.agency_tenant_id = _agency AND atm.user_id = _actor AND atm.status = 'active' LIMIT 1)
  END;
$function$;
CREATE OR REPLACE FUNCTION public.current_user_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT p.active_tenant_id FROM public.profiles p
       WHERE p.user_id = auth.uid()
         AND p.active_tenant_id IS NOT NULL
         AND (
           EXISTS (SELECT 1 FROM public.tenant_members m
                     WHERE m.user_id = auth.uid() AND m.tenant_id = p.active_tenant_id AND m.status = 'active')
           OR public.agency_can_manage_child(p.active_tenant_id, auth.uid())
           OR public.agency_team_role(p.active_tenant_id, auth.uid()) IS NOT NULL
           OR public.is_platform_admin(auth.uid())
         )),
    (SELECT tenant_id FROM public.tenant_members
       WHERE user_id = auth.uid() AND status = 'active'
       ORDER BY joined_at ASC LIMIT 1)
  );
$function$;
CREATE OR REPLACE FUNCTION public.map_app_role_to_tenant_role(_app_role app_role)
 RETURNS tenant_role
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
    SELECT CASE _app_role
      WHEN 'admin'::public.app_role THEN 'admin'::public.tenant_role
      ELSE 'member'::public.tenant_role
    END
  $function$;
CREATE OR REPLACE FUNCTION public.map_tenant_role_to_app_role(_tenant_role tenant_role)
 RETURNS app_role
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
    SELECT CASE _tenant_role
      WHEN 'owner'  THEN 'admin'::app_role
      WHEN 'admin'  THEN 'admin'::app_role
      WHEN 'member' THEN 'user'::app_role
    END
  $function$;
CREATE OR REPLACE FUNCTION public.is_tenant_owner(_user_id uuid, _tenant_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members tm
    WHERE tm.user_id = _user_id
      AND tm.is_owner = true
      AND tm.status = 'active'
      AND (_tenant_id IS NULL OR tm.tenant_id = _tenant_id)
  )
  -- Only for a named company workspace: "owner of any tenant" (NULL) is never widened. And only
  -- when a person asks about themselves (or a server path asks), so this function never becomes
  -- a way for anyone to learn whether some other user id holds the operator role.
  OR (_tenant_id IS NOT NULL AND _user_id IS NOT NULL
      AND (COALESCE(_user_id = auth.uid(), false) OR COALESCE(auth.role(), '') <> ALL (ARRAY['anon', 'authenticated']))
      AND public.is_company_workspace(_tenant_id) AND public.is_platform_admin(_user_id));
$function$;
CREATE OR REPLACE FUNCTION public.tenant_has_feature(_feature text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT (features ->> _feature)::boolean
       FROM public.tenants
      WHERE id = public.current_user_tenant_id()),
    false
  );
$function$;
CREATE OR REPLACE FUNCTION public.studio_role_ok(_caller uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _caller IS NOT NULL
     AND _caller = auth.uid()
     AND (public.is_tenant_admin(public.current_user_tenant_id())
          OR public.agency_can_manage_child(public.current_user_tenant_id(), _caller));
$function$;
-- Real trigger bodies: consent on seats, and both sync directions.
CREATE OR REPLACE FUNCTION public.enforce_tenant_member_consent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  -- Service-role / SECURITY DEFINER paths with no JWT (signup, edge functions, provisioning)
  -- have no auth.uid(); they are trusted to write membership directly.
  IF _caller IS NULL THEN
    RETURN NEW;
  END IF;

  -- Would this write leave the row ACTIVE for someone other than the caller?
  IF NEW.status = 'active' AND NEW.user_id <> _caller THEN
    -- Allowed ONLY when the row was ALREADY active for this SAME user (e.g. a role change on an
    -- existing, already-consented member). Consent was established when it first went active.
    IF TG_OP = 'UPDATE'
       AND OLD.status = 'active'
       AND OLD.user_id = NEW.user_id THEN
      NULL; -- pre-existing active membership for the same user — allow.
    ELSE
      -- Every newly-minted foreign-active outcome — fresh INSERT, non-active -> active flip, OR a
      -- user_id repoint onto an already-active row — is neutralized to an inert 'pending' seat.
      NEW.status := 'pending';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.sync_tenant_member_to_user_roles()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_role app_role;
  _old_role app_role;
BEGIN
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.status = 'active' THEN
    _new_role := public.map_tenant_role_to_app_role(NEW.role);
    IF _new_role IN ('super_admin'::app_role, 'platform_admin'::app_role, 'developer'::app_role) THEN
      _new_role := NULL;
    END IF;
    IF _new_role IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.user_id) THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.user_id, _new_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    _old_role := public.map_tenant_role_to_app_role(OLD.role);
    IF _old_role IS NOT NULL
       AND (OLD.role <> NEW.role OR NEW.status <> 'active')
       AND _old_role <> COALESCE(public.map_tenant_role_to_app_role(NEW.role), 'user'::app_role)
    THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = OLD.user_id AND tm.status = 'active'
          AND tm.id <> OLD.id
          AND public.map_tenant_role_to_app_role(tm.role) = _old_role
      ) THEN
        DELETE FROM public.user_roles WHERE user_id = OLD.user_id AND role = _old_role;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    _old_role := public.map_tenant_role_to_app_role(OLD.role);
    IF _old_role IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = OLD.user_id AND tm.status = 'active'
          AND public.map_tenant_role_to_app_role(tm.role) = _old_role
      ) THEN
        DELETE FROM public.user_roles WHERE user_id = OLD.user_id AND role = _old_role;
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.sync_user_role_to_tenant_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    _tenant_id uuid;
    _tenant_role public.tenant_role;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;

    IF NEW.role = 'super_admin'::public.app_role THEN
      RETURN NEW;
    END IF;

    _tenant_id := public.current_user_tenant_id();
    IF _tenant_id IS NULL THEN
      RETURN NEW;
    END IF;

    -- An operator's authority in a company workspace is the role's, not a seat (20270521000000).
    IF NOT (public.is_platform_owner()
            OR (public.is_tenant_admin(_tenant_id) AND NOT public.is_company_workspace(_tenant_id))) THEN
      RETURN NEW;
    END IF;

    _tenant_role := public.map_app_role_to_tenant_role(NEW.role);

    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, invited_at, joined_at)
    VALUES (_tenant_id, NEW.user_id, _tenant_role, 'active', now(), now())
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET role = CASE
            WHEN public.tenant_members.role = 'owner'::public.tenant_role THEN public.tenant_members.role
            WHEN EXCLUDED.role = 'admin'::public.tenant_role THEN 'admin'::public.tenant_role
            ELSE public.tenant_members.role
          END,
          status = 'active',
          joined_at = COALESCE(public.tenant_members.joined_at, now()),
          updated_at = now();

    UPDATE public.profiles
       SET active_tenant_id = _tenant_id
     WHERE user_id = NEW.user_id
       AND active_tenant_id IS NULL;

    RETURN NEW;
  END;
  $function$;
CREATE TRIGGER trg_tenant_members_consent BEFORE INSERT OR UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_member_consent();
CREATE TRIGGER trg_sync_tenant_member_to_user_roles AFTER INSERT OR UPDATE OR DELETE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_tenant_member_to_user_roles();
CREATE TRIGGER trg_sync_user_role_to_tenant_member AFTER INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_role_to_tenant_member();

-- ═════════════════════════════════ BASELINE: production's definitions of the changed objects ════
CREATE SCHEMA proof;
GRANT USAGE ON SCHEMA proof TO anon, authenticated, service_role;
CREATE TABLE proof.baseline (obj text PRIMARY KEY, ddl text NOT NULL);
INSERT INTO proof.baseline VALUES
('fn:record_rail_event', $BASE$
CREATE OR REPLACE FUNCTION public.record_rail_event(p_contact_id uuid, p_event_kind text, p_surface text, p_actor_type text, p_title text, p_summary text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_ref_table text DEFAULT NULL::text, p_ref_id uuid DEFAULT NULL::uuid, p_from_department text DEFAULT NULL::text, p_to_department text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_narrow_to_owner boolean DEFAULT false, p_tenant_id uuid DEFAULT NULL::uuid, p_actor_agent_slug text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_tenant      uuid;
  v_kind        public.paige_event_kinds%ROWTYPE;
  v_audience    text;
  v_visibility  text;
  v_actor       uuid;
  v_id          uuid;
  v_occurred    timestamptz;
  v_from_dept   text;
  v_agent_label text;
BEGIN
  IF v_uid IS NOT NULL THEN
    v_tenant := NULL;
    IF p_actor_type = 'client' THEN
      SELECT c.tenant_id INTO v_tenant FROM public.clients c
       WHERE c.id = p_contact_id AND c.id = public.client_portal_relationship_id(p_tenant_id)
         AND c.linked_user_id = v_uid;
    END IF;
    -- Incumbent staff-side booking producers also use actor_type=client.
    -- Preserve their original staff resolution and downstream role checks.
    IF v_tenant IS NULL THEN
      v_tenant := public.current_user_tenant_id();
    END IF;
    IF p_tenant_id IS NOT NULL AND v_tenant IS NOT NULL AND p_tenant_id <> v_tenant THEN
      RAISE EXCEPTION 'tenant mismatch' USING errcode = '42501';
    END IF;
  ELSE
    IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'p_tenant_id required for service caller'; END IF;
    v_tenant := p_tenant_id;
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'no tenant resolved' USING errcode = '42501'; END IF;

  SELECT * INTO v_kind FROM public.paige_event_kinds
    WHERE slug = p_event_kind AND enabled AND (tenant_id IS NULL OR tenant_id = v_tenant)
    ORDER BY (tenant_id IS NOT NULL) DESC
    LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown or unavailable event kind: %', p_event_kind; END IF;

  PERFORM 1 FROM public.clients c WHERE c.id = p_contact_id AND c.tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact not in tenant' USING errcode = '42501'; END IF;

  IF v_uid IS NOT NULL THEN
    IF public.has_any_role(v_uid, ARRAY['admin','super_admin']) THEN
      NULL;
    ELSIF p_actor_type = 'client'
          AND EXISTS (SELECT 1 FROM public.clients c
                       WHERE c.id = p_contact_id AND c.linked_user_id = v_uid) THEN
      IF p_narrow_to_owner OR v_kind.default_visibility <> 'client_visible' THEN
        RAISE EXCEPTION 'client may only file client-visible events' USING errcode = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'not authorized to write rail event' USING errcode = '42501';
    END IF;
  END IF;

  -- §9 AGENT SCOPE. The FK proves the slug exists on the fleet; it says nothing about whose
  -- agent it is, because slug is globally unique and tenant_id is nullable. This predicate is
  -- keyed on v_tenant — server-resolved above, never a caller parameter. ONE error covers
  -- foreign and unknown alike so the response cannot be used to enumerate another workspace's
  -- agents, matching the identical-404 rule paige-orchestrator already follows.
  --
  -- v_agent_label may legitimately be NULL when the agent exists but has no tenant-safe name
  -- (an internal crew seat). That records the slug for operator audit while showing a business
  -- owner nothing written for us (§11).
  IF p_actor_agent_slug IS NOT NULL THEN
    SELECT s.rail_display_name INTO v_agent_label
      FROM public.paige_subagents s
     WHERE s.slug = p_actor_agent_slug
       AND (s.tenant_id IS NULL OR s.tenant_id = v_tenant);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RAIL_AGENT_FORBIDDEN' USING errcode = '42501';
    END IF;
  END IF;

  v_audience   := CASE WHEN p_narrow_to_owner THEN 'owner' ELSE v_kind.default_audience END;
  v_visibility := CASE WHEN v_audience = 'owner' THEN 'owner_internal' ELSE v_kind.default_visibility END;
  v_actor      := CASE WHEN p_actor_type IN ('owner_staff','client') THEN v_uid ELSE NULL END;
  v_from_dept  := COALESCE(p_from_department, v_kind.department);

  INSERT INTO public.paige_client_events (
    tenant_id, contact_id, event_kind, surface, actor_type, actor_user_id,
    audience, visibility, from_department, to_department,
    title, summary, payload, ref_table, ref_id, occurred_at,
    actor_agent_slug, actor_agent_label
  ) VALUES (
    v_tenant, p_contact_id, p_event_kind, p_surface, p_actor_type, v_actor,
    v_audience, v_visibility,
    v_from_dept, p_to_department,
    p_title, p_summary, COALESCE(p_payload, '{}'::jsonb), p_ref_table, p_ref_id,
    COALESCE(p_occurred_at, now()),
    p_actor_agent_slug, v_agent_label
  ) RETURNING id, occurred_at INTO v_id, v_occurred;

  INSERT INTO public.audit_logs (user_id, action, entity, entity_id, data)
  VALUES (v_uid, 'paige_rail_event', 'paige_client_events', v_id,
          jsonb_build_object('kind', p_event_kind, 'surface', p_surface,
                             'contact_id', p_contact_id, 'audience', v_audience,
                             'actor_agent_slug', p_actor_agent_slug));

  BEGIN
    PERFORM realtime.send(
      jsonb_build_object(
        'id', v_id, 'tenant_id', v_tenant, 'contact_id', p_contact_id,
        'event_kind', p_event_kind, 'surface', p_surface, 'actor_type', p_actor_type,
        'audience', v_audience, 'visibility', v_visibility,
        'from_department', v_from_dept, 'to_department', p_to_department,
        'title', p_title, 'summary', p_summary, 'payload', COALESCE(p_payload, '{}'::jsonb),
        'occurred_at', v_occurred
      ) || CASE WHEN p_actor_agent_slug IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('actor_agent', v_agent_label) END,
      'rail_event', 'rail:tenant:' || v_tenant::text, true
    );

    IF v_audience IN ('client','both') AND v_visibility = 'client_visible' THEN
      -- The CLIENT feed deliberately carries no agent attribution. Which of the coach's
      -- specialists did the work is the coach's business, not the client's (§9).
      PERFORM realtime.send(
        jsonb_build_object(
          'id', v_id, 'contact_id', p_contact_id, 'event_kind', p_event_kind,
          'surface', p_surface, 'actor_type', p_actor_type, 'audience', v_audience,
          'visibility', v_visibility, 'title', p_title, 'summary', p_summary,
          'occurred_at', v_occurred
        ),
        'rail_event', 'rail:client:' || p_contact_id::text, true
      );
    END IF;

    -- God firehose. EVERY event is surfaced to the platform owner's cross-tenant stream (§9 God
    -- reads everything). Compact envelope only — NO full payload; the platform stream is a
    -- cross-tenant index, and omitting the payload limits blast radius. Subscribable ONLY by God
    -- (see can_access_rail_topic).
    PERFORM realtime.send(
      jsonb_build_object(
        'id', v_id, 'tenant_id', v_tenant, 'contact_id', p_contact_id,
        'event_kind', p_event_kind, 'surface', p_surface, 'actor_type', p_actor_type,
        'audience', v_audience, 'visibility', v_visibility,
        'title', p_title, 'occurred_at', v_occurred
      ) || CASE WHEN p_actor_agent_slug IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('actor_agent', v_agent_label) END,
      'rail_event', 'rail:platform', true
    );
  EXCEPTION WHEN others THEN
    RAISE WARNING 'rail broadcast failed for event %: %', v_id, SQLERRM;
  END;

  RETURN v_id;
END $function$
;
$BASE$),
('pol:business_certifications_owner_update', $BASE$
DROP POLICY IF EXISTS "Owners can update their certifications" ON public.business_certifications;
$BASE$),
('fn:change_user_role', $BASE$
CREATE OR REPLACE FUNCTION public.change_user_role(_target_user_id uuid, _from_role app_role, _to_role app_role, _tenant_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _resolved_tenant uuid;
  _is_owner_call boolean := public.is_platform_owner();
  _is_admin_call boolean;
  _target_is_owner boolean;
  _tenant_role public.tenant_role;
  _protected public.app_role[] := ARRAY['admin','super_admin','platform_admin']::public.app_role[];
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'ROLE_CHANGE_UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  _resolved_tenant := COALESCE(_tenant_id, public.current_user_tenant_id());
  IF _resolved_tenant IS NULL THEN
    RAISE EXCEPTION 'ROLE_CHANGE_NO_TENANT' USING ERRCODE = '22023';
  END IF;

  _is_admin_call := public.is_tenant_admin(_resolved_tenant) OR public.has_role(_caller, 'admin'::public.app_role);

  IF NOT (_is_owner_call OR _is_admin_call) THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: admin privileges required' USING ERRCODE = '42501';
  END IF;

  IF NOT _is_owner_call AND (_from_role = ANY(_protected) OR _to_role = ANY(_protected)) THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: cannot modify admin or super_admin (owner-only)'
      USING ERRCODE = '42501';
  END IF;

  IF _to_role = 'coach'::public.app_role THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: coach is a title, never a role' USING ERRCODE = '42501';
  END IF;

  IF _to_role = 'super_admin'::public.app_role THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: super_admin is bootstrap-only' USING ERRCODE = '42501';
  END IF;

  -- FIX-2 (§9, Slice A Option 1): read the authoritative is_owner signal, NOT the
  -- display-only tenants.owner_user_id, and REFUSE any role change on a tenant owner
  -- (incl. a grant_co_owner co-owner). Ownership mutates ONLY via revoke_co_owner().
  _target_is_owner := public.is_tenant_owner(_target_user_id, _resolved_tenant);
  IF _target_is_owner THEN
    RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: this member is a tenant owner; use revoke_co_owner() to change ownership'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _target_user_id AND role = _from_role;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (_target_user_id, _to_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  BEGIN
    _tenant_role := public.map_app_role_to_tenant_role(_to_role);
    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, invited_at, joined_at)
    VALUES (_resolved_tenant, _target_user_id, _tenant_role, 'active', now(), now())
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET role = EXCLUDED.role, status = 'active', updated_at = now()
      WHERE public.tenant_members.role <> 'owner'::public.tenant_role;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.paige_audit_log
      (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
    VALUES (
      _caller,
      CASE WHEN _is_owner_call THEN 'super_admin' ELSE 'admin' END,
      'role:change:mirror_failed', 'user_role', _target_user_id,
      jsonb_build_object(
        'from_role', _from_role,
        'to_role', _to_role,
        'tenant_id', _resolved_tenant,
        'error_message', SQLERRM,
        'error_code', SQLSTATE
      ),
      _resolved_tenant
    );
  END;

  INSERT INTO public.paige_audit_log
    (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
  VALUES (
    _caller,
    CASE WHEN _is_owner_call THEN 'super_admin' ELSE 'admin' END,
    'role:change', 'user_role', _target_user_id,
    jsonb_build_object('from_role', _from_role, 'to_role', _to_role,
                       'tenant_id', _resolved_tenant, 'reason', _reason),
    _resolved_tenant
  );
END;
$function$;
$BASE$),
('fn:get_profile_with_pii_log', $BASE$
CREATE OR REPLACE FUNCTION public.get_profile_with_pii_log(_user_id uuid)
 RETURNS SETOF profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() != _user_id AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO public.pii_access_log (
    accessed_user_id,
    accessor_user_id,
    table_name,
    field_names,
    access_type,
    accessed_at
  ) VALUES (
    _user_id,
    auth.uid(),
    'profiles',
    ARRAY['ssn_encrypted', 'date_of_birth', 'ssn_last_4'],
    'read',
    NOW()
  );

  RETURN QUERY SELECT * FROM public.profiles WHERE user_id = _user_id;
END;
$function$;
$BASE$),
('fn:delete_credit_report_upload', $BASE$
CREATE OR REPLACE FUNCTION public.delete_credit_report_upload(_upload_id uuid, _calling_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _upload record;
  _file_path text;
BEGIN
  IF _caller IS NULL OR NOT (public.has_role(_caller, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT id, file_path, user_id INTO _upload
  FROM public.credit_report_uploads
  WHERE id = _upload_id;

  IF _upload IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Upload not found');
  END IF;

  _file_path := _upload.file_path;

  DELETE FROM public.credit_report_personal_info
  WHERE credit_report_upload_id = _upload_id;

  DELETE FROM public.credit_report_uploads
  WHERE id = _upload_id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (
    _caller,
    'credit_report_uploads',
    'admin_delete',
    _upload_id,
    jsonb_build_object('file_path', _file_path, 'target_user_id', _upload.user_id::text)
  );

  RETURN json_build_object(
    'success', true,
    'file_path', _file_path,
    'message', 'Upload and related data deleted'
  );
END;
$function$;
$BASE$),
('fn:platform_set_growth_external_source_token', $BASE$
CREATE OR REPLACE FUNCTION public.platform_set_growth_external_source_token(_id uuid, _token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR public.is_platform_owner(auth.uid())) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.growth_external_sources SET webhook_token_ct = public.platform_encrypt(_token) WHERE id = _id;
END; $function$;
$BASE$),
('fn:platform_set_mcp_server_url', $BASE$
CREATE OR REPLACE FUNCTION public.platform_set_mcp_server_url(_id uuid, _url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR public.is_platform_owner(auth.uid())) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.paige_mcp_connections SET server_url_ct = public.platform_encrypt(_url) WHERE id = _id;
END; $function$;
$BASE$),
('fn:platform_set_n8n_base_url', $BASE$
CREATE OR REPLACE FUNCTION public.platform_set_n8n_base_url(_id uuid, _url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR public.is_platform_owner(auth.uid())) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.paige_n8n_connections SET base_url_ct = public.platform_encrypt(_url) WHERE id = _id;
END; $function$;
$BASE$),
('fn:platform_set_outbound_webhook_url', $BASE$
CREATE OR REPLACE FUNCTION public.platform_set_outbound_webhook_url(_id uuid, _url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR public.is_platform_owner(auth.uid())) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.outbound_webhook_configs SET url_ct = public.platform_encrypt(_url) WHERE id = _id;
END; $function$;
$BASE$),
('fn:platform_set_plaid_access_token', $BASE$
CREATE OR REPLACE FUNCTION public.platform_set_plaid_access_token(_row_id uuid, _token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR public.is_platform_owner(auth.uid())) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.connected_bank_account_secrets SET plaid_access_token_ct = public.platform_encrypt(_token) WHERE account_row_id = _row_id;
END; $function$;
$BASE$),
('fn:list_library', $BASE$
CREATE OR REPLACE FUNCTION public.list_library(p_kind text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, artifact_kind text, artifact_id uuid, title text, thumbnail_url text, note text, tags jsonb, saved_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := COALESCE(p_tenant_id, public.current_user_tenant_id());
BEGIN
  IF _tenant IS NULL THEN
    RETURN;
  END IF;
  IF _caller IS NOT NULL
     AND NOT public.is_tenant_member(_tenant)
     AND NOT public.has_role(_caller, 'admin'::app_role)
     AND NOT public.is_platform_owner(_caller) THEN
    RAISE EXCEPTION 'LIBRARY_FORBIDDEN: tenant not in your membership' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT li.id, li.artifact_kind, li.artifact_id, li.title,
         li.thumbnail_url, li.note, li.tags, li.saved_at
    FROM public.studio_library_items li
   WHERE li.tenant_id = _tenant
     AND (p_kind IS NULL OR li.artifact_kind = p_kind)
   ORDER BY li.saved_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500));
END;
$function$;
$BASE$),
('fn:save_to_library', $BASE$
CREATE OR REPLACE FUNCTION public.save_to_library(p_kind text, p_artifact_id uuid, p_title text DEFAULT NULL::text, p_thumbnail_url text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := COALESCE(p_tenant_id, public.current_user_tenant_id());
  _title text := NULLIF(btrim(p_title), '');
  _id uuid;
BEGIN
  IF p_kind NOT IN ('page','funnel','form','image','video','copy','document') THEN
    RAISE EXCEPTION 'LIBRARY_BAD_KIND: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF p_artifact_id IS NULL THEN
    RAISE EXCEPTION 'LIBRARY_NO_ARTIFACT: an artifact id is required' USING ERRCODE = '22023';
  END IF;
  IF _caller IS NOT NULL AND NOT public.has_any_role(_caller, ARRAY['admin','super_admin']) THEN
    RAISE EXCEPTION 'LIBRARY_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'LIBRARY_NO_TENANT: a tenant context is required' USING ERRCODE = '22023';
  END IF;
  -- §9/#117: membership is required for a JWT caller; a global 'admin' role no longer
  -- exempts a cross-tenant write (platform owner still may).
  IF _caller IS NOT NULL
     AND NOT public.is_tenant_member(_tenant)
     AND NOT public.is_platform_owner(_caller) THEN
    RAISE EXCEPTION 'LIBRARY_FORBIDDEN: tenant not in your membership' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.studio_library_items (
    tenant_id, created_by, artifact_kind, artifact_id, title, thumbnail_url, note, saved_at
  ) VALUES (
    _tenant, _caller, p_kind, p_artifact_id,
    COALESCE(_title, 'Untitled'),
    NULLIF(btrim(p_thumbnail_url), ''), p_note, now()
  )
  ON CONFLICT (tenant_id, artifact_kind, artifact_id) DO UPDATE SET
    title         = COALESCE(_title, studio_library_items.title),
    thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, studio_library_items.thumbnail_url),
    note          = COALESCE(EXCLUDED.note, studio_library_items.note),
    saved_at      = now()
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'studio_library_items', 'save_to_library', _id,
          jsonb_build_object('tenant_id', _tenant, 'kind', p_kind, 'artifact_id', p_artifact_id));

  RETURN _id;
END;
$function$;
$BASE$),
('fn:create_internal_booking', $BASE$
CREATE OR REPLACE FUNCTION public.create_internal_booking(_title text, _start_at timestamp with time zone, _end_at timestamp with time zone, _timezone text DEFAULT 'UTC'::text, _contact_id uuid DEFAULT NULL::uuid, _host_user_id uuid DEFAULT NULL::uuid, _guest_name text DEFAULT NULL::text, _guest_email text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _location text DEFAULT NULL::text, _tenant_id uuid DEFAULT NULL::uuid, _calendar_id uuid DEFAULT NULL::uuid, _appointment_type jsonb DEFAULT NULL::jsonb, _intake_answers jsonb DEFAULT NULL::jsonb, _guest_phone text DEFAULT NULL::text, _status text DEFAULT 'scheduled'::text, _source text DEFAULT 'paige'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := COALESCE(_tenant_id, public.current_user_tenant_id());
  _host uuid := COALESCE(_host_user_id, auth.uid());
  _id uuid; _gname text; _gemail text; _found boolean;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN: auth required' USING ERRCODE='42501'; END IF;
  IF NOT (public.is_platform_owner()
          OR (_tenant IS NOT NULL AND public.is_tenant_admin(_tenant))
          OR (_tenant IS NOT NULL AND public.is_tenant_member(_tenant)
              AND public.has_any_role(_caller, ARRAY['admin','super_admin']))) THEN
    RAISE EXCEPTION 'BOOKING_FORBIDDEN: staff of this tenant required' USING ERRCODE='42501';
  END IF;
  IF _end_at <= _start_at THEN RAISE EXCEPTION 'BOOKING_BAD_TIME: end must be after start' USING ERRCODE='22023'; END IF;
  IF COALESCE(btrim(_title), '') = '' THEN RAISE EXCEPTION 'BOOKING_TITLE_REQUIRED' USING ERRCODE='22023'; END IF;
  IF _calendar_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.calendars c WHERE c.id = _calendar_id AND c.tenant_id IS NOT DISTINCT FROM _tenant
     ) THEN
    RAISE EXCEPTION 'BOOKING_BAD_CALENDAR: calendar not in this tenant' USING ERRCODE='22023';
  END IF;
  IF _host IS NOT NULL AND _host <> _caller THEN
    IF _tenant IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.tenant_members tm
          WHERE tm.tenant_id = _tenant AND tm.user_id = _host AND tm.status = 'active'
       ) THEN
      RAISE EXCEPTION 'BOOKING_BAD_HOST: host is not a member of this tenant' USING ERRCODE='22023';
    END IF;
  END IF;

  IF _contact_id IS NOT NULL THEN
    SELECT COALESCE(_guest_name, btrim(concat_ws(' ', cl.first_name, cl.last_name))),
           COALESCE(_guest_email, public.client_primary_address(cl.id, 'email')),
           true
      INTO _gname, _gemail, _found
      FROM public.clients cl WHERE cl.id = _contact_id AND cl.tenant_id IS NOT DISTINCT FROM _tenant;
    IF NOT COALESCE(_found, false) THEN
      RAISE EXCEPTION 'BOOKING_BAD_CONTACT: contact not in this tenant' USING ERRCODE='22023';
    END IF;
  ELSE
    _gname := _guest_name; _gemail := _guest_email;
  END IF;

  INSERT INTO public.internal_bookings (
    tenant_id, calendar_id, host_user_id, contact_id, guest_name, guest_email, guest_phone,
    title, notes, location, start_at, end_at, timezone,
    status, source, booking_kind, appointment_type, intake_answers, reminder_state
  ) VALUES (
    _tenant, _calendar_id, _host, _contact_id, _gname, _gemail, _guest_phone,
    btrim(_title), _notes, _location, _start_at, _end_at, COALESCE(NULLIF(btrim(_timezone), ''), 'UTC'),
    COALESCE(NULLIF(btrim(_status), ''), 'scheduled'), COALESCE(NULLIF(btrim(_source), ''), 'paige'),
    'single', _appointment_type, _intake_answers, '{}'::jsonb
  )
  RETURNING id INTO _id;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (_caller, 'internal_booking', 'create_internal_booking', _id,
          jsonb_build_object('tenant_id', _tenant, 'host_user_id', _host, 'contact_id', _contact_id,
                             'calendar_id', _calendar_id, 'start_at', _start_at));
  RETURN _id;
END $function$;
$BASE$),
('fn:remove_from_library', $BASE$
CREATE OR REPLACE FUNCTION public.remove_from_library(p_id uuid DEFAULT NULL::uuid, p_kind text DEFAULT NULL::text, p_artifact_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _deleted int;
BEGIN
  IF _caller IS NOT NULL AND NOT public.has_any_role(_caller, ARRAY['admin','super_admin']) THEN
    RAISE EXCEPTION 'LIBRARY_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.studio_library_items
   WHERE (_caller IS NULL OR tenant_id = _tenant OR public.has_role(_caller, 'admin'::app_role))
     AND (
       (p_id IS NOT NULL AND id = p_id)
       OR (p_id IS NULL AND p_kind IS NOT NULL AND p_artifact_id IS NOT NULL
           AND artifact_kind = p_kind AND artifact_id = p_artifact_id)
     );
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted > 0;
END;
$function$;
$BASE$),
('fn:delete_marketing_content', $BASE$
CREATE OR REPLACE FUNCTION public.delete_marketing_content(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid := public.current_user_tenant_id();
  _deleted int;
BEGIN
  IF _caller IS NOT NULL AND NOT public.has_any_role(_caller, ARRAY['admin','super_admin']) THEN
    RAISE EXCEPTION 'CONTENT_FORBIDDEN: admin or coach required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.marketing_content
   WHERE id = p_id
     AND (_caller IS NULL OR tenant_id = _tenant OR public.has_role(_caller, 'admin'::app_role));
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted > 0;
END;
$function$;
$BASE$),
('fn:growth_funnel_session_upsert', $BASE$
CREATE OR REPLACE FUNCTION public.growth_funnel_session_upsert(p_funnel_id uuid, p_session_token text DEFAULT NULL::text, p_step integer DEFAULT 0, p_completed boolean DEFAULT NULL::boolean, p_utm_json jsonb DEFAULT NULL::jsonb, p_referrer text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS growth_funnel_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _funnel public.growth_funnels;
  _tenant uuid;
  _token  text := NULLIF(btrim(p_session_token), '');
  _step   int  := GREATEST(COALESCE(p_step, 0), 0);
  _row    public.growth_funnel_sessions;
BEGIN
  IF p_funnel_id IS NULL THEN
    RAISE EXCEPTION 'GROWTH_FUNNEL_REQUIRED: a funnel id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _funnel FROM public.growth_funnels WHERE id = p_funnel_id;
  IF _funnel.id IS NULL THEN
    RAISE EXCEPTION 'GROWTH_NOT_FOUND: funnel not found' USING ERRCODE = 'P0002';
  END IF;

  -- Tenant is pinned to the FUNNEL's tenant — never a client-supplied id (§9). A JWT caller
  -- must own the funnel (or be admin); an anon visitor may only progress a LIVE funnel; a
  -- service-role caller that names a tenant must match the funnel.
  _tenant := _funnel.tenant_id;
  IF _caller IS NOT NULL THEN
    -- IS DISTINCT FROM (not <>) so a tenantless JWT caller — current_user_tenant_id() = NULL —
    -- is BLOCKED, not silently let through (<> NULL yields NULL, and IF(NULL) never raises).
    IF _funnel.tenant_id IS DISTINCT FROM public.current_user_tenant_id()
       AND NOT public.has_role(_caller, 'admin') THEN
      RAISE EXCEPTION 'GROWTH_FORBIDDEN: funnel belongs to another tenant' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF _funnel.status <> 'active' THEN
      RAISE EXCEPTION 'GROWTH_FUNNEL_INACTIVE: this funnel is not live' USING ERRCODE = '22023';
    END IF;
    IF p_tenant_id IS NOT NULL AND p_tenant_id <> _funnel.tenant_id THEN
      RAISE EXCEPTION 'GROWTH_TENANT_MISMATCH: tenant does not match funnel' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _token IS NULL THEN
    -- Create a fresh session with a server-generated unguessable token.
    INSERT INTO public.growth_funnel_sessions (
      session_token, tenant_id, funnel_id, current_step, completed, utm_json, referrer, user_agent
    ) VALUES (
      'fs_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      _tenant, p_funnel_id, _step, COALESCE(p_completed, false),
      COALESCE(p_utm_json, '{}'::jsonb), p_referrer, p_user_agent
    )
    RETURNING * INTO _row;
  ELSE
    -- Advance an existing session — step is monotonic (GREATEST), tenant/funnel pinned.
    UPDATE public.growth_funnel_sessions SET
      current_step = GREATEST(current_step, _step),
      completed    = COALESCE(p_completed, completed),
      utm_json     = CASE WHEN p_utm_json IS NULL OR p_utm_json = '{}'::jsonb THEN utm_json ELSE p_utm_json END,
      referrer     = COALESCE(referrer, p_referrer),
      user_agent   = COALESCE(user_agent, p_user_agent)
    WHERE session_token = _token AND funnel_id = p_funnel_id AND tenant_id = _tenant
    RETURNING * INTO _row;
    IF _row.id IS NULL THEN
      RAISE EXCEPTION 'GROWTH_NOT_FOUND: funnel session not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN _row;
END;
$function$;
$BASE$),
('fn:suspend_user', $BASE$
CREATE OR REPLACE FUNCTION public.suspend_user(_user_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_platform_owner() OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _user_id IS NULL OR _user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot suspend self';
  END IF;

  UPDATE public.profiles
    SET suspended_at = now(),
        suspended_reason = _reason,
        suspended_by = auth.uid(),
        updated_at = now()
    WHERE id = _user_id;

  INSERT INTO public.paige_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'suspend_user', 'user', _user_id, jsonb_build_object('reason', _reason));
END;
$function$;
$BASE$),
('fn:reactivate_user', $BASE$
CREATE OR REPLACE FUNCTION public.reactivate_user(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_platform_owner() OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.profiles
    SET suspended_at = NULL,
        suspended_reason = NULL,
        suspended_by = NULL,
        updated_at = now()
    WHERE id = _user_id;

  INSERT INTO public.paige_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'reactivate_user', 'user', _user_id, '{}'::jsonb);
END;
$function$;
$BASE$),
('fn:admin_set_meta_capi_token', $BASE$
CREATE OR REPLACE FUNCTION public.admin_set_meta_capi_token(_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _token IS NULL OR length(btrim(_token)) = 0 THEN
    DELETE FROM public._internal_secrets WHERE key = 'meta_capi_access_token';
  ELSE
    INSERT INTO public._internal_secrets (key, value)
    VALUES ('meta_capi_access_token', _token)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;

  INSERT INTO public.paige_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (auth.uid(), 'admin_set_meta_capi_token', 'paige_config', NULL,
          jsonb_build_object('cleared', _token IS NULL OR length(btrim(coalesce(_token,'')))=0));
END $function$;
$BASE$),
('fn:admin_meta_capi_token_is_set', $BASE$
CREATE OR REPLACE FUNCTION public.admin_meta_capi_token_is_set()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public._internal_secrets WHERE key = 'meta_capi_access_token' AND length(coalesce(value,'')) > 0);
END $function$;
$BASE$),
('fn:admin_set_user_business_limit', $BASE$
CREATE OR REPLACE FUNCTION public.admin_set_user_business_limit(_target_user_id uuid, _max_businesses integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_row public.user_business_limits%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  IF _max_businesses IS NULL OR _max_businesses < 1 THEN
    RAISE EXCEPTION 'max_businesses must be >= 1';
  END IF;

  INSERT INTO public.user_business_limits (user_id, max_businesses)
  VALUES (_target_user_id, _max_businesses)
  ON CONFLICT (user_id) DO UPDATE
    SET max_businesses = EXCLUDED.max_businesses,
        updated_at = now()
  RETURNING * INTO _new_row;

  INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
  VALUES (
    auth.uid(),
    'user_business_limits',
    'admin_set_max_businesses',
    _target_user_id,
    jsonb_build_object('max_businesses', _max_businesses, 'target_user_id', _target_user_id::text)
  );

  RETURN json_build_object(
    'success', true,
    'user_id', _new_row.user_id,
    'max_businesses', _new_row.max_businesses,
    'additional_businesses_count', _new_row.additional_businesses_count
  );
END;
$function$;
$BASE$),
('fn:rag_recalibrate_quality', $BASE$
CREATE OR REPLACE FUNCTION public.rag_recalibrate_quality()
 RETURNS TABLE(flagged_low integer, boosted_high integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _flagged integer := 0;
  _boosted integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Boost consistently helpful docs (>=10 retrievals, >=70% helpful).
  WITH boosted AS (
    UPDATE public.rag_documents
       SET quality_score = LEAST(quality_score + 0.05, 1.0),
           updated_at = now()
     WHERE usage_count >= 10
       AND (helpful_count::numeric / NULLIF(usage_count,0)) >= 0.7
     RETURNING 1
  )
  SELECT count(*) INTO _boosted FROM boosted;

  -- Flag low-helpfulness docs (>=10 retrievals, <30% helpful) for admin review.
  WITH flagged AS (
    UPDATE public.rag_documents
       SET metadata = jsonb_set(
                        COALESCE(metadata, '{}'::jsonb),
                        '{flagged_low_helpfulness}',
                        'true'::jsonb,
                        true
                      ),
           updated_at = now()
     WHERE usage_count >= 10
       AND (helpful_count::numeric / NULLIF(usage_count,0)) < 0.3
       AND COALESCE(metadata->>'flagged_low_helpfulness','false') <> 'true'
     RETURNING 1
  )
  SELECT count(*) INTO _flagged FROM flagged;

  RETURN QUERY SELECT _flagged, _boosted;
END;
$function$;
$BASE$),
('fn:match_rag_documents', $BASE$
CREATE OR REPLACE FUNCTION public.match_rag_documents(_query_embedding extensions.vector, _match_threshold numeric DEFAULT 0.75, _match_count integer DEFAULT 3, _document_types text[] DEFAULT NULL::text[], _metadata_filter jsonb DEFAULT NULL::jsonb, _query_text text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, document_type text, title text, summary text, content text, metadata jsonb, similarity double precision, quality_score numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _ids uuid[];
  _is_staff boolean := false;
  _caller uuid := auth.uid();
  _financial_types text[] := ARRAY[
    'business_credit_snapshot','owner_credit_snapshot','banking_snapshot',
    'cash_flow_snapshot','client_financial_brief'
  ];
BEGIN
  IF _caller IS NULL AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _caller IS NOT NULL THEN
    _is_staff := public.has_role(_caller, 'admin'::public.app_role);
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT
      d.id, d.document_type, d.title, d.summary, d.content, d.metadata,
      1 - (d.embedding <=> _query_embedding) AS similarity,
      d.quality_score
    FROM public.rag_documents d
    WHERE d.is_published = true
      AND d.embedding IS NOT NULL
      AND (_document_types IS NULL OR d.document_type = ANY (_document_types))
      AND (_metadata_filter IS NULL OR d.metadata @> _metadata_filter)
      AND 1 - (d.embedding <=> _query_embedding) >= _match_threshold
      AND (
        NOT (d.document_type = ANY (_financial_types))
        OR auth.role() = 'service_role'
        OR _is_staff
        OR (d.client_id IS NOT NULL AND d.client_id = _caller)
      )
    ORDER BY d.embedding <=> _query_embedding
    LIMIT GREATEST(_match_count, 1)
  )
  SELECT * FROM ranked;

  -- THE FIX: the subquery below is aliased `d`; this aggregated `r.id`, which is nothing.
  SELECT COALESCE(array_agg(d.id), ARRAY[]::uuid[]) INTO _ids
  FROM (
    SELECT d.id
    FROM public.rag_documents d
    WHERE d.is_published = true
      AND d.embedding IS NOT NULL
      AND (_document_types IS NULL OR d.document_type = ANY (_document_types))
      AND (_metadata_filter IS NULL OR d.metadata @> _metadata_filter)
      AND 1 - (d.embedding <=> _query_embedding) >= _match_threshold
      AND (
        NOT (d.document_type = ANY (_financial_types))
        OR auth.role() = 'service_role'
        OR _is_staff
        OR (d.client_id IS NOT NULL AND d.client_id = _caller)
      )
    ORDER BY d.embedding <=> _query_embedding
    LIMIT GREATEST(_match_count, 1)
  ) d;

  IF array_length(_ids, 1) IS NOT NULL THEN
    UPDATE public.rag_documents
       SET usage_count = usage_count + 1,
           updated_at = now()
     WHERE id = ANY (_ids);
  END IF;

  BEGIN
    INSERT INTO public.rag_retrieval_log (
      user_id, query_embedding, query_text, retrieved_document_ids
    ) VALUES (
      _caller, _query_embedding, _query_text, COALESCE(_ids, ARRAY[]::uuid[])
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$function$;
$BASE$),
('fn:_assert_billing_admin', $BASE$
CREATE OR REPLACE FUNCTION public._assert_billing_admin()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin'::app_role)
       OR public.has_role(auth.uid(),'owner'::app_role)
       OR public.is_platform_owner(auth.uid())) THEN
    RAISE EXCEPTION 'billing admin role required';
  END IF;
  IF NOT public.tenant_has_feature('billing_enabled') THEN
    RAISE EXCEPTION 'billing_enabled feature is not active for this tenant';
  END IF;
END;
$function$;
$BASE$),
('fn:grant_tenant_member_role', $BASE$
CREATE OR REPLACE FUNCTION public.grant_tenant_member_role(_user_id uuid, _role app_role, _tenant_id uuid DEFAULT NULL::uuid, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  DECLARE
    _caller uuid := auth.uid();
    _resolved_tenant uuid;
    _tenant_role public.tenant_role;
    _protected public.app_role[] := ARRAY['super_admin','platform_admin','developer']::public.app_role[];
  BEGIN
    IF _caller IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
    -- "Coach" is a title a business gives its people, never a role anyone is granted.
    IF _role = 'coach'::public.app_role THEN
      RAISE EXCEPTION 'ROLE_CHANGE_FORBIDDEN: coach is a title, never a role' USING ERRCODE = '42501';
    END IF;
    _resolved_tenant := COALESCE(_tenant_id, public.current_user_tenant_id());
    IF _resolved_tenant IS NULL THEN RAISE EXCEPTION 'No active tenant context'; END IF;
    IF NOT (public.is_platform_owner() OR public.is_tenant_admin(_resolved_tenant)) THEN
      RAISE EXCEPTION 'Tenant admin privileges required';
    END IF;
    IF NOT public.is_platform_owner() AND _role = ANY(_protected) THEN
      RAISE EXCEPTION 'Cannot grant a platform-operator role here (owner-only)'
        USING ERRCODE = '42501';
    END IF;

    _tenant_role := public.map_app_role_to_tenant_role(_role);

    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.tenant_members (tenant_id, user_id, role, status, invited_at, joined_at)
    VALUES (_resolved_tenant, _user_id, _tenant_role, 'active', now(), now())
    ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET role = CASE
            WHEN public.tenant_members.role = 'owner'::public.tenant_role THEN public.tenant_members.role
            WHEN EXCLUDED.role = 'admin'::public.tenant_role THEN 'admin'::public.tenant_role
            ELSE public.tenant_members.role
          END,
          status = 'active',
          joined_at = COALESCE(public.tenant_members.joined_at, now()),
          updated_at = now();

    INSERT INTO public.profiles (user_id) VALUES (_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.profiles SET active_tenant_id = _resolved_tenant
     WHERE user_id = _user_id AND (active_tenant_id IS NULL OR public.is_platform_owner());

    INSERT INTO public.audit_logs (user_id, entity, action, entity_id, data)
    VALUES (_caller, 'tenant_member', 'grant_tenant_member_role', _user_id,
            jsonb_build_object('tenant_id', _resolved_tenant, 'role', _role, 'reason', _reason));

    INSERT INTO public.paige_audit_log
      (actor_user_id, actor_role, action, target_type, target_id, payload, tenant_id)
    VALUES (_caller, 'admin', 'role:grant', 'user_role', _user_id,
            jsonb_build_object('to_role', _role, 'tenant_id', _resolved_tenant, 'reason', _reason),
            _resolved_tenant);
  END;
  $function$;
$BASE$),
-- POLICIES: production's, recreated from pg_policies (expressions as deparsed there).
('pol:paige_skills', $BASE$
DROP POLICY IF EXISTS "Workspace admins read active skills" ON public.paige_skills;
DROP POLICY IF EXISTS "Admins manage skills" ON public.paige_skills;
CREATE POLICY "Admins manage skills" ON public.paige_skills AS PERMISSIVE FOR ALL TO authenticated
  USING ((is_platform_owner() OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_platform_owner() OR has_role(auth.uid(), 'admin'::app_role)));
$BASE$),
('pol:paige_skill_proposals', $BASE$
DROP POLICY IF EXISTS "Admins manage skill proposals" ON public.paige_skill_proposals;
CREATE POLICY "Admins manage skill proposals" ON public.paige_skill_proposals AS PERMISSIVE FOR ALL TO authenticated
  USING ((is_platform_owner() OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((is_platform_owner() OR has_role(auth.uid(), 'admin'::app_role)));
$BASE$),
('pol:paige_assignment_policy', $BASE$
DROP POLICY IF EXISTS "assignment_policy_admin_write" ON public.paige_assignment_policy;
CREATE POLICY "assignment_policy_admin_write" ON public.paige_assignment_policy AS PERMISSIVE FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text]));
DROP POLICY IF EXISTS "assignment_policy_staff_read" ON public.paige_assignment_policy;
CREATE POLICY "assignment_policy_staff_read" ON public.paige_assignment_policy AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));
$BASE$),
('pol:tenant_entity_relationships', $BASE$
DROP POLICY IF EXISTS "ter tenant admin manage" ON public.tenant_entity_relationships;
CREATE POLICY "ter tenant admin manage" ON public.tenant_entity_relationships AS PERMISSIVE FOR ALL TO authenticated
  USING (((tenant_id = current_user_tenant_id()) OR has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (((tenant_id = current_user_tenant_id()) OR has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));
$BASE$),
('pol:business_certifications', $BASE$
DROP POLICY IF EXISTS "Admins can manage certifications" ON public.business_certifications;
CREATE POLICY "Admins can manage certifications" ON public.business_certifications AS PERMISSIVE FOR ALL TO public
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Owners can view their certifications" ON public.business_certifications;
CREATE POLICY "Owners can view their certifications" ON public.business_certifications AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role)));
$BASE$),
('pol:business_verification_runs', $BASE$
DROP POLICY IF EXISTS "Admins view all verification runs" ON public.business_verification_runs;
CREATE POLICY "Admins view all verification runs" ON public.business_verification_runs AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_platform_owner() OR has_role(auth.uid(), 'admin'::app_role)));
$BASE$),
('pol:business_verifications', $BASE$
DROP POLICY IF EXISTS "View verifications via run access" ON public.business_verifications;
CREATE POLICY "View verifications via run access" ON public.business_verifications AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM business_verification_runs r
  WHERE ((r.id = business_verifications.run_id) AND (is_platform_owner() OR has_role(auth.uid(), 'admin'::app_role) OR ((r.contact_id IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM clients c
          WHERE ((c.id = r.contact_id) AND (c.assigned_coach_user_id = auth.uid()) AND is_tenant_member(c.tenant_id))))) OR ((r.business_id IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM businesses b
          WHERE ((b.id = r.business_id) AND (b.owner_user_id = auth.uid()))))))))));
$BASE$),
('pol:chat_message_embeddings', $BASE$
DROP POLICY IF EXISTS "Service role can delete chat embeddings" ON public.chat_message_embeddings;
CREATE POLICY "Service role can delete chat embeddings" ON public.chat_message_embeddings AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role)));
DROP POLICY IF EXISTS "Users can insert their own chat embeddings" ON public.chat_message_embeddings;
CREATE POLICY "Users can insert their own chat embeddings" ON public.chat_message_embeddings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((auth.uid() = user_id) OR has_role(auth.uid(), 'admin'::app_role)));
DROP POLICY IF EXISTS "Users can read their own chat embeddings" ON public.chat_message_embeddings;
CREATE POLICY "Users can read their own chat embeddings" ON public.chat_message_embeddings AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = user_id) OR (auth.uid() = client_user_id) OR has_role(auth.uid(), 'admin'::app_role)));
$BASE$),
('pol:client_goals', $BASE$
DROP POLICY IF EXISTS "Admins update all goals" ON public.client_goals;
CREATE POLICY "Admins update all goals" ON public.client_goals AS PERMISSIVE FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins view all goals" ON public.client_goals;
CREATE POLICY "Admins view all goals" ON public.client_goals AS PERMISSIVE FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
$BASE$),
('pol:lender_research_results', $BASE$
DROP POLICY IF EXISTS "Admins can manage all research results" ON public.lender_research_results;
CREATE POLICY "Admins can manage all research results" ON public.lender_research_results AS PERMISSIVE FOR ALL TO public
  USING (has_role(auth.uid(), 'admin'::app_role));
$BASE$),
('pol:rag_documents', $BASE$
DROP POLICY IF EXISTS "Authenticated read published RAG docs" ON public.rag_documents;
CREATE POLICY "Authenticated read published RAG docs" ON public.rag_documents AS PERMISSIVE FOR SELECT TO authenticated
  USING (((is_published = true) AND ((client_id IS NULL) OR (client_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))));
$BASE$),
('pol:legal_acceptances', $BASE$
DROP POLICY IF EXISTS "legal_acceptances self read" ON public.legal_acceptances;
CREATE POLICY "legal_acceptances self read" ON public.legal_acceptances AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
$BASE$),
('pol:paige_sla_alert_log', $BASE$
DROP POLICY IF EXISTS "sla_log_admins_read" ON public.paige_sla_alert_log;
CREATE POLICY "sla_log_admins_read" ON public.paige_sla_alert_log AS PERMISSIVE FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text]));
$BASE$),
('pol:extraction_quality_log', $BASE$
DROP POLICY IF EXISTS "Admins can insert quality logs" ON public.extraction_quality_log;
CREATE POLICY "Admins can insert quality logs" ON public.extraction_quality_log AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
$BASE$),
('pol:storage_paige_generated', $BASE$
DROP POLICY IF EXISTS "paige_generated_staff_update" ON storage.objects;
CREATE POLICY "paige_generated_staff_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'paige-generated'::text) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])));
DROP POLICY IF EXISTS "paige_generated_staff_write" ON storage.objects;
CREATE POLICY "paige_generated_staff_write" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'paige-generated'::text) AND has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text])));
$BASE$),
('pol:tasks', $BASE$
DROP POLICY IF EXISTS "Admins manage all tasks" ON public.tasks;
CREATE POLICY "Admins manage all tasks" ON public.tasks AS PERMISSIVE FOR ALL TO authenticated
  USING ((is_platform_owner() OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)))
  WITH CHECK ((is_platform_owner() OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));
$BASE$),
('pol:paige_pending_approvals', $BASE$
DROP POLICY IF EXISTS "Approvals read scoped" ON public.paige_pending_approvals;
CREATE POLICY "Approvals read scoped" ON public.paige_pending_approvals AS PERMISSIVE FOR SELECT TO authenticated
  USING ((has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text]) OR (assigned_to_user_id = auth.uid()) OR (visible_to_roles && current_user_roles())));
DROP POLICY IF EXISTS "Approvals write scoped" ON public.paige_pending_approvals;
CREATE POLICY "Approvals write scoped" ON public.paige_pending_approvals AS PERMISSIVE FOR ALL TO authenticated
  USING ((has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text]) OR (assigned_to_user_id = auth.uid())))
  WITH CHECK ((has_any_role(auth.uid(), ARRAY['admin'::text, 'super_admin'::text]) OR (assigned_to_user_id = auth.uid())));
$BASE$),
('pol:paige_coach_assignments', $BASE$
DROP POLICY IF EXISTS "assignments_staff_read" ON public.paige_coach_assignments;
CREATE POLICY "assignments_staff_read" ON public.paige_coach_assignments AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));
$BASE$),
('pol:paige_approval_comments', $BASE$
DROP POLICY IF EXISTS "approval_comments_insert" ON public.paige_approval_comments;
CREATE POLICY "approval_comments_insert" ON public.paige_approval_comments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM paige_pending_approvals a
  WHERE ((a.id = paige_approval_comments.approval_id) AND ((a.assigned_to_user_id = auth.uid()) OR (a.submitted_by_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)))))));
DROP POLICY IF EXISTS "approval_comments_read" ON public.paige_approval_comments;
CREATE POLICY "approval_comments_read" ON public.paige_approval_comments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM paige_pending_approvals a
  WHERE ((a.id = paige_approval_comments.approval_id) AND ((a.assigned_to_user_id = auth.uid()) OR (a.submitted_by_user_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))))));
$BASE$);

-- Partial fixes, run only as extra mutants: each restores ONE half of a two-part fix.
CREATE TABLE proof.partial (obj text PRIMARY KEY, ddl text NOT NULL);
INSERT INTO proof.partial VALUES
('partial:approvals read keeps "&& current_user_roles()" with admin', $BASE$
DROP POLICY IF EXISTS "Approvals read scoped" ON public.paige_pending_approvals;
CREATE POLICY "Approvals read scoped" ON public.paige_pending_approvals AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_platform_owner() OR ((tenant_id IS NOT NULL) AND is_workspace_admin(tenant_id))
    OR (assigned_to_user_id = auth.uid()) OR (visible_to_roles && current_user_roles()));
$BASE$),
('partial:storage cast without the regex guard', $BASE$
DROP POLICY IF EXISTS "paige_generated_staff_update" ON storage.objects;
CREATE POLICY "paige_generated_staff_update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((bucket_id = 'paige-generated'::text) AND (is_platform_owner() OR is_workspace_admin(((storage.foldername(name))[1])::uuid)));
$BASE$),
('partial:grant_tenant_member_role still inserts the admin row', $BASE$
SELECT 1;
$BASE$),
('partial:grant_tenant_member_role writes a global role for a person not active here', $BASE$
SELECT 1;
$BASE$),
('partial:change_user_role without the active-seat rule', $BASE$
SELECT 1;
$BASE$);
-- A partial whose ddl is the placeholder is built from the MIGRATED body by one text edit. The edit must
-- match exactly once, or the run stops (a mutant that changed nothing would be a silent pass).
CREATE TABLE proof.partial_edit (obj text PRIMARY KEY, fn text NOT NULL, old text NOT NULL, new text NOT NULL);
INSERT INTO proof.partial_edit VALUES
('partial:grant_tenant_member_role still inserts the admin row', 'public.grant_tenant_member_role(uuid,app_role,uuid,text)',
 $e$IF _role <> 'admin'::public.app_role AND _global_ok THEN$e$, $e$IF _global_ok THEN$e$),
('partial:grant_tenant_member_role writes a global role for a person not active here', 'public.grant_tenant_member_role(uuid,app_role,uuid,text)',
 $e$IF _role <> 'admin'::public.app_role AND _global_ok THEN$e$, $e$IF _role <> 'admin'::public.app_role THEN$e$),
('partial:change_user_role without the active-seat rule', 'public.change_user_role(uuid,app_role,app_role,uuid,text)',
 $e$IF NOT _operator_path AND NOT EXISTS ($e$, $e$IF false AND NOT EXISTS ($e$);

-- The other production policies on the same tables, unchanged by the migration (pg_policies verbatim).
CREATE POLICY "Owners can insert their certifications" ON public.business_certifications AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Assigned staff view verifications for their clients" ON public.business_verification_runs AS PERMISSIVE FOR SELECT TO authenticated
  USING (((contact_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = business_verification_runs.contact_id) AND (c.assigned_coach_user_id = auth.uid()) AND is_tenant_member(c.tenant_id))))));
CREATE POLICY "Owners view verifications for own businesses" ON public.business_verification_runs AS PERMISSIVE FOR SELECT TO authenticated
  USING (((business_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = business_verification_runs.business_id) AND (b.owner_user_id = auth.uid()))))));
CREATE POLICY "Users can delete own goals" ON public.client_goals AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert own goals" ON public.client_goals AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update own goals" ON public.client_goals AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own goals" ON public.client_goals AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "Admins can update quality logs" ON public.extraction_quality_log AS PERMISSIVE FOR UPDATE TO public USING (is_platform_owner());
CREATE POLICY "Admins can view all quality logs" ON public.extraction_quality_log AS PERMISSIVE FOR SELECT TO public USING (is_platform_owner());
CREATE POLICY "Users can view own quality logs" ON public.extraction_quality_log AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "legal_acceptances self insert" ON public.legal_acceptances AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "Service role can manage all research" ON public.lender_research_results AS PERMISSIVE FOR ALL TO public
  USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));
CREATE POLICY "Users can view research saved to their profile" ON public.lender_research_results AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = client_user_id));
CREATE POLICY "Admins write staff assignments" ON public.paige_coach_assignments AS PERMISSIVE FOR ALL TO authenticated
  USING ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_role(auth.uid(), 'admin'::app_role))))
  WITH CHECK ((is_platform_owner() OR ((tenant_id = current_user_tenant_id()) AND has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "tenant_isolation" ON public.paige_coach_assignments AS RESTRICTIVE FOR ALL TO authenticated
  USING ((is_platform_owner() OR (tenant_id IS NULL) OR (tenant_id = current_user_tenant_id())))
  WITH CHECK ((is_platform_owner() OR (tenant_id IS NULL) OR (tenant_id = current_user_tenant_id())));
CREATE POLICY "Native owner task seat read" ON public.paige_pending_approvals AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_read_owner_task_approval(id));
CREATE POLICY "tenant_isolation" ON public.paige_pending_approvals AS RESTRICTIVE FOR ALL TO authenticated
  USING ((is_platform_owner() OR (tenant_id IS NULL) OR (tenant_id = current_user_tenant_id())))
  WITH CHECK ((is_platform_owner() OR (tenant_id IS NULL) OR (tenant_id = current_user_tenant_id())));
CREATE POLICY "Platform owner can delete RAG docs" ON public.rag_documents AS PERMISSIVE FOR DELETE TO authenticated USING (is_platform_owner());
CREATE POLICY "Platform owner can insert RAG docs" ON public.rag_documents AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (is_platform_owner());
CREATE POLICY "Platform owner can read all RAG docs" ON public.rag_documents AS PERMISSIVE FOR SELECT TO authenticated USING (is_platform_owner());
CREATE POLICY "Platform owner can update RAG docs" ON public.rag_documents AS PERMISSIVE FOR UPDATE TO authenticated
  USING (is_platform_owner()) WITH CHECK (is_platform_owner());
CREATE POLICY "Assigned staff read their clients' tasks" ON public.tasks AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.linked_user_id = tasks.user_id) AND (c.tenant_id = tasks.tenant_id) AND (c.assigned_coach_user_id = auth.uid()) AND is_tenant_member(c.tenant_id)))));
CREATE POLICY "Users can create own tasks" ON public.tasks AS PERMISSIVE FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can delete own tasks" ON public.tasks AS PERMISSIVE FOR DELETE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can update own tasks" ON public.tasks AS PERMISSIVE FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Users can view own tasks" ON public.tasks AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "tenant_isolation" ON public.tasks AS RESTRICTIVE FOR ALL TO authenticated
  USING ((is_platform_owner() OR (tenant_id IS NULL) OR (tenant_id = current_user_tenant_id())))
  WITH CHECK ((is_platform_owner() OR (tenant_id IS NULL) OR (tenant_id = current_user_tenant_id())));
CREATE POLICY "ter self read" ON public.tenant_entity_relationships AS PERMISSIVE FOR SELECT TO authenticated
  USING ((contact_id = client_portal_relationship_id(tenant_id)));
CREATE POLICY "paige_generated member delete" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (((bucket_id = 'paige-generated'::text) AND (is_platform_owner() OR is_tenant_member(((storage.foldername(name))[1])::uuid))));
CREATE POLICY "paige_generated member update" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((bucket_id = 'paige-generated'::text) AND (is_platform_owner() OR is_tenant_member(((storage.foldername(name))[1])::uuid))));
CREATE POLICY "paige_generated member upload" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((bucket_id = 'paige-generated'::text) AND (is_platform_owner() OR is_tenant_member(((storage.foldername(name))[1])::uuid))));
CREATE POLICY "paige_generated public read" ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING ((bucket_id = 'paige-generated'::text));

-- Apply the production definitions of the changed objects.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM proof.baseline ORDER BY obj LOOP EXECUTE r.ddl; END LOOP;
END $$;

ALTER TABLE public.paige_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_skill_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_assignment_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_entity_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_verification_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lender_research_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_sla_alert_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extraction_quality_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_pending_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_coach_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_approval_comments ENABLE ROW LEVEL SECURITY;

-- ═════════════════════════════════ PRODUCTION FIDELITY: md5 of every body and policy ═════════
-- Production values read 2026-10-26 (md5 of prosrc with CR removed; md5 of
-- qual|with_check|permissive|roles|cmd from pg_policies).
CREATE TEMP TABLE prod_fn_md5 (sig text, h text);
INSERT INTO prod_fn_md5 VALUES
('_assert_billing_admin()','80ae0400780e4df0d9802c00a2550740'),('admin_meta_capi_token_is_set()','5b79e20412c7a351bf16b6a2b0389f34'),
('admin_set_meta_capi_token(text)','3b1c05daa425e0c6951959251ab9eebb'),('admin_set_user_business_limit(uuid,integer)','a69be2132bf81dd815d99a45cdde228e'),
('agency_can_manage_child(uuid,uuid)','b1f1bb620eae26744519c1ff7700e28d'),('agency_team_role(uuid,uuid)','eff5463cd88542982a41ee4e22747f06'),
('change_user_role(uuid,app_role,app_role,uuid,text)','0ff56ed2913edc7a4fd6adc59d88b52f'),
('create_internal_booking(text,timestamp with time zone,timestamp with time zone,text,uuid,uuid,text,text,text,text,uuid,uuid,jsonb,jsonb,text,text,text)','68d541ea6ab9a483858e280a0ebdd448'),
('current_user_roles()','1e54bb151e6a2d55d3bde060d96b057d'),('current_user_tenant_id()','f16384fd81d48901441185bec66f939f'),
('delete_credit_report_upload(uuid,uuid)','e56efd974d351970fbcf75298a54237f'),('delete_marketing_content(uuid)','e035886f852b6f5fed5f621212fc0055'),
('enforce_tenant_member_consent()','a5266755b803ef1fbaa2b8a6384004bf'),('get_profile_with_pii_log(uuid)','63d15972f38770881da516cc311d04c6'),
('grant_tenant_member_role(uuid,app_role,uuid,text)','e9871873b2324b963b25753e6685d371'),
('growth_funnel_session_upsert(uuid,text,integer,boolean,jsonb,text,text,uuid)','c8a15a026d881828d8e066c2ce5e90c1'),
('has_any_role(uuid,text[])','368894d933d5053b5dab6472d85a7428'),('has_role(uuid,app_role)','dcfc17cfff0b246634d5df8bf8ceb915'),
('is_company_workspace(uuid)','7944c5bde7171fbe4e6b2f03f090fe28'),('is_platform_admin()','400db6905ca858eb02ed226dd375150e'),
('is_platform_admin(uuid)','c2d88dd5c598217d606646895674f007'),('is_platform_operator()','f4e30734885255ef65dd52f13986e949'),
('is_platform_owner()','08ff6983c07e71b7c4bec3b8b4fcae28'),('is_platform_owner(uuid)','dc789c98cf26f96d52c5138754c0f131'),
('is_staff(uuid)','4f3b1462da255d7a1dc1dd548690c0cd'),('is_super_admin()','363ccf1a73c5d68252e165ad909032f1'),
('is_super_admin(uuid)','d014606ddbd8a120e5f3afeda5f937fa'),('is_tenant_admin(uuid)','7d393ee77b2ebbc42791f0dce8dbcca5'),
('is_tenant_member(uuid)','f4df3c17e4d78b305986dd342e42b415'),('is_tenant_owner(uuid,uuid)','f392787e7469ed325960850ad091473d'),
('list_library(text,integer,uuid)','0e75e78f6245163299958e12004ef9d2'),('map_app_role_to_tenant_role(app_role)','ba55cb38fb4c7e4545ffd9cc5122faf8'),
('map_tenant_role_to_app_role(tenant_role)','60dfcc70ea811ca2ac255d9e19c20714'),
('match_rag_documents(extensions.vector,numeric,integer,text[],jsonb,text)','a04986c517e2e08042695ca3c853e2e8'),
('platform_set_growth_external_source_token(uuid,text)','b6dd170a186778ccfbe807f27dec01a6'),('platform_set_mcp_server_url(uuid,text)','ed551d0ce9069e8b942069019b3e5046'),
('platform_set_n8n_base_url(uuid,text)','e3efbe80a4fd7fee4f876fe8b9c52f62'),('platform_set_outbound_webhook_url(uuid,text)','2506453f653be74628e49d741a47149f'),
('platform_set_plaid_access_token(uuid,text)','d8de4e1d5da3bc6c6c8f510ec57e83d5'),('rag_recalibrate_quality()','1ba70e1ccac2d3471419d4785d5d2c8a'),
('reactivate_user(uuid)','375e0476a4502cb0694b607f367db40d'),
('record_rail_event(uuid,text,text,text,text,text,jsonb,text,uuid,text,text,timestamp with time zone,boolean,uuid,text)','06927b300c0a9645bae072a0a6aee2af'),('remove_from_library(uuid,text,uuid)','31e9ae1a81e51de119b06b1c3e026b25'),
('save_to_library(text,uuid,text,text,text,uuid)','062f55b2e86e35aab3902dadf7d43067'),('studio_role_ok(uuid)','bb27e05caa36c23b1996f75f50242528'),
('suspend_user(uuid,text)','4573b85215082f57c0a3909c918a3a3d'),('sync_tenant_member_to_user_roles()','816ccabaf4ea00e55549a3e446c12763'),
('sync_user_role_to_tenant_member()','264bff7c3e071d75e9c6f1310fec8406'),('tenant_has_feature(text)','afa66584f8611dc35ef22a2eb154d0ec');
CREATE TEMP TABLE prod_pol_md5 (k text, h text);
INSERT INTO prod_pol_md5 VALUES
('public.business_certifications / Admins can manage certifications','6ce58dedd849fed365f223ad338327a9'),
('public.business_certifications / Owners can insert their certifications','2c1e224c635d4747f26d048215b6fa24'),
('public.business_certifications / Owners can view their certifications','2bfa8d247a3ba3563bd758fecca6f119'),
('public.business_verification_runs / Admins view all verification runs','661fb9ff6998ae5324f19b9b55f2a760'),
('public.business_verification_runs / Assigned staff view verifications for their clients','e88d7bc5b108eea5e28e7d71743259b7'),
('public.business_verification_runs / Owners view verifications for own businesses','4ce6e505762d14f5c0e8170407b080f7'),
('public.business_verifications / View verifications via run access','de82b57d1a721aa5896d294cd62e3c1d'),
('public.chat_message_embeddings / Service role can delete chat embeddings','cdd37bcb28fdec87ef5d109e632decf7'),
('public.chat_message_embeddings / Users can insert their own chat embeddings','e1f74afa3a45ae43fd09f749376cb5e6'),
('public.chat_message_embeddings / Users can read their own chat embeddings','5ca37a7e9ceeac8cf844460b9aa16a70'),
('public.client_goals / Admins update all goals','ad2313ebbb994067d7bd413476a1e534'),
('public.client_goals / Admins view all goals','7b49789058e356613964361118389d89'),
('public.client_goals / Users can delete own goals','a40c245c3f54fc5081f2bededc5cfd45'),
('public.client_goals / Users can insert own goals','2c1e224c635d4747f26d048215b6fa24'),
('public.client_goals / Users can update own goals','65bea4748f1329d64b658a31be607c88'),
('public.client_goals / Users can view own goals','9aa0d456063c40dd47fb5f31c4ac9bf6'),
('public.extraction_quality_log / Admins can insert quality logs','8d3b3a9701bf20f5796c45726749fa1a'),
('public.extraction_quality_log / Admins can update quality logs','732d784cb9e0b5ef0792f2f07eed251b'),
('public.extraction_quality_log / Admins can view all quality logs','9270be54ac3c245b3a85d850ec3d1c93'),
('public.extraction_quality_log / Users can view own quality logs','9aa0d456063c40dd47fb5f31c4ac9bf6'),
('public.legal_acceptances / legal_acceptances self insert','7771dba0100924711486067fa93376bb'),
('public.legal_acceptances / legal_acceptances self read','dd1cee3bd1d97a648102c51eed2f48df'),
('public.lender_research_results / Admins can manage all research results','980cbc141a988084ec5e4c88fa7a20d4'),
('public.lender_research_results / Service role can manage all research','9d77b5d5041a78de26d28ada766d8842'),
('public.lender_research_results / Users can view research saved to their profile','74f0a18a9add23c27b30db8dbcf766bc'),
('public.paige_approval_comments / approval_comments_insert','18138ef242d87c1a849c655b2c08bd71'),
('public.paige_approval_comments / approval_comments_read','12fd2323e7953bce62744f323fe3c8c7'),
('public.paige_assignment_policy / assignment_policy_admin_write','97949f87b302e22a077d292e7e1664a3'),
('public.paige_assignment_policy / assignment_policy_staff_read','3ef71037132f00b586492e57c15fb107'),
('public.paige_coach_assignments / Admins write staff assignments','43533365d75a631030b0cf6fda18f5a7'),
('public.paige_coach_assignments / assignments_staff_read','3ef71037132f00b586492e57c15fb107'),
('public.paige_coach_assignments / tenant_isolation','23b046c1d17ce09ecaade6ef97bab2d8'),
('public.paige_pending_approvals / Approvals read scoped','1a6a73531e148a7606113154aa87be8d'),
('public.paige_pending_approvals / Approvals write scoped','ec0e78809192326daa57e83c64139961'),
('public.paige_pending_approvals / Native owner task seat read','e6503f38bf81d8060a2420a5c7429679'),
('public.paige_pending_approvals / tenant_isolation','23b046c1d17ce09ecaade6ef97bab2d8'),
('public.paige_skill_proposals / Admins manage skill proposals','eff14a2c21bc30ed1f2765215eaf42d9'),
('public.paige_skills / Admins manage skills','eff14a2c21bc30ed1f2765215eaf42d9'),
('public.paige_sla_alert_log / sla_log_admins_read','e4c5b850a7fe5a36464b45e1e265b2a1'),
('public.rag_documents / Authenticated read published RAG docs','44c1d4e455d1c555a9a282e38594682a'),
('public.rag_documents / Platform owner can delete RAG docs','abfd23fb59356caa313a1cd062290a20'),
('public.rag_documents / Platform owner can insert RAG docs','ab695f0538ceba3660ce42cffe2672c2'),
('public.rag_documents / Platform owner can read all RAG docs','00d5241f1e4224800550fafe0752c639'),
('public.rag_documents / Platform owner can update RAG docs','1b8d2bbf633f182541154706ae2bf14b'),
('public.tasks / Admins manage all tasks','4eafc45189bed57a58cc476f3e801749'),
('public.tasks / Assigned staff read their clients'' tasks','3900aed5c7ad509a4a7f05399ffc91f1'),
('public.tasks / Users can create own tasks','2c1e224c635d4747f26d048215b6fa24'),
('public.tasks / Users can delete own tasks','a40c245c3f54fc5081f2bededc5cfd45'),
('public.tasks / Users can update own tasks','65bea4748f1329d64b658a31be607c88'),
('public.tasks / Users can view own tasks','9aa0d456063c40dd47fb5f31c4ac9bf6'),
('public.tasks / tenant_isolation','23b046c1d17ce09ecaade6ef97bab2d8'),
('public.tenant_entity_relationships / ter self read','ee93e6567ff5b4a1cbe5ecb5259f55dd'),
('public.tenant_entity_relationships / ter tenant admin manage','1ab392ada107628abf1a5699f248a318'),
('storage.objects / paige_generated member delete','ad7a9e123b1bdb2be6a23c81f1427280'),
('storage.objects / paige_generated member update','8c5b803193746295eaabe4f667b77c06'),
('storage.objects / paige_generated member upload','c207c8764d70c18a0b274341f43da5e1'),
('storage.objects / paige_generated public read','4f609f54a6bfbc8a5f317667773a6016'),
('storage.objects / paige_generated_staff_update','7c361a9eb12c311e271ef48beb47e244'),
('storage.objects / paige_generated_staff_write','4b35c03306907d698a757657c0d8e59d');
DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(e.sig, ', ') INTO _bad FROM prod_fn_md5 e
   LEFT JOIN (SELECT regexp_replace(p.oid::regprocedure::text, '^public\.', '') sig, md5(replace(p.prosrc, E'\r', '')) h
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') l USING (sig)
   WHERE l.h IS DISTINCT FROM e.h;
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: not production''s body: %', _bad; END IF;
  SELECT string_agg(e.k, ', ') INTO _bad FROM prod_pol_md5 e
   LEFT JOIN (SELECT schemaname||'.'||tablename||' / '||policyname k,
                     md5(coalesce(qual,'')||'|'||coalesce(with_check,'')||'|'||permissive||'|'||roles::text||'|'||cmd) h FROM pg_policies) l USING (k)
   WHERE l.h IS DISTINCT FROM e.h;
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: not production''s policy: %', _bad; END IF;
END $$;
\echo 'PASS: every changed function, every helper and every policy here is byte-for-byte production''s (md5, 49 functions, 59 policies)'

-- ═════════════════════════════════ PRIVILEGES (production's ACLs) ═══════════════════════════
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA proof TO anon, authenticated, service_role;
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['change_user_role(uuid,app_role,app_role,uuid,text)','create_internal_booking(text,timestamptz,timestamptz,text,uuid,uuid,text,text,text,text,uuid,uuid,jsonb,jsonb,text,text,text)',
    'delete_credit_report_upload(uuid,uuid)','delete_marketing_content(uuid)','get_profile_with_pii_log(uuid)','grant_tenant_member_role(uuid,app_role,uuid,text)',
    'list_library(text,integer,uuid)','platform_set_growth_external_source_token(uuid,text)','platform_set_mcp_server_url(uuid,text)',
    'platform_set_outbound_webhook_url(uuid,text)','platform_set_plaid_access_token(uuid,text)','remove_from_library(uuid,text,uuid)',
    'save_to_library(text,uuid,text,text,text,uuid)','current_user_tenant_id()','studio_role_ok(uuid)',
    'record_rail_event(uuid,text,text,text,text,text,jsonb,text,uuid,text,text,timestamptz,boolean,uuid,text)','client_portal_relationship_id(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['_assert_billing_admin()','admin_meta_capi_token_is_set()','admin_set_meta_capi_token(text)','admin_set_user_business_limit(uuid,integer)',
    'growth_funnel_session_upsert(uuid,text,integer,boolean,jsonb,text,text,uuid)','match_rag_documents(extensions.vector,numeric,integer,text[],jsonb,text)',
    'platform_set_n8n_base_url(uuid,text)','rag_recalibrate_quality()','reactivate_user(uuid)','suspend_user(uuid,text)','agency_can_manage_child(uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
CREATE TEMP TABLE acl_before AS
  SELECT p.oid::regprocedure::text sig, p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f';

-- ═════════════════════════════════ FIXTURES (fictional) ═════════════════════════════════════
CREATE TABLE proof.ids (k text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO proof.ids VALUES
 ('A','11111111-1111-4111-8111-00000000000a'),('B','11111111-1111-4111-8111-00000000000b'),('W','11111111-1111-4111-8111-00000000000c'),
 ('G','11111111-1111-4111-8111-00000000000d'),('C','11111111-1111-4111-8111-00000000000e'),
 ('SA','22222222-2222-4222-8222-000000000001'),('PA','22222222-2222-4222-8222-000000000002'),('OA','22222222-2222-4222-8222-000000000003'),
 ('AA','22222222-2222-4222-8222-000000000004'),('MA','22222222-2222-4222-8222-000000000005'),('X','22222222-2222-4222-8222-000000000006'),
 ('OB','22222222-2222-4222-8222-000000000007'),('MB','22222222-2222-4222-8222-000000000008'),('CL','22222222-2222-4222-8222-000000000009'),
 ('CLB','22222222-2222-4222-8222-00000000000a'),('GO','22222222-2222-4222-8222-00000000000b'),('V','22222222-2222-4222-8222-00000000000c'),
 ('MA2','22222222-2222-4222-8222-00000000000d'),
 ('client_A','33333333-3333-4333-8333-00000000000a'),('client_B','33333333-3333-4333-8333-00000000000b'),
 ('biz_A','44444444-4444-4444-8444-00000000000a'),('biz_B','44444444-4444-4444-8444-00000000000b'),
 ('cert_A','55555555-5555-4555-8555-00000000000a'),('cert_B','55555555-5555-4555-8555-00000000000b'),
 ('run_A','66666666-6666-4666-8666-00000000000a'),('run_B','66666666-6666-4666-8666-00000000000b'),
 ('ver_A','77777777-7777-4777-8777-00000000000a'),('ver_B','77777777-7777-4777-8777-00000000000b'),
 ('emb_OB','88888888-8888-4888-8888-000000000001'),('emb_X','88888888-8888-4888-8888-000000000002'),
 ('goal_A','99999999-9999-4999-8999-00000000000a'),('goal_B','99999999-9999-4999-8999-00000000000b'),
 ('lrr_A','aaaaaaaa-aaaa-4aaa-8aaa-00000000000a'),('lrr_B','aaaaaaaa-aaaa-4aaa-8aaa-00000000000b'),
 ('rag_A','bbbbbbbb-bbbb-4bbb-8bbb-00000000000a'),('rag_B','bbbbbbbb-bbbb-4bbb-8bbb-00000000000b'),('rag_0','bbbbbbbb-bbbb-4bbb-8bbb-000000000000'),
 ('rag_finB','bbbbbbbb-bbbb-4bbb-8bbb-0000000000fb'),
 ('la_OB','cccccccc-cccc-4ccc-8ccc-000000000001'),('la_X','cccccccc-cccc-4ccc-8ccc-000000000002'),('sla_B','cccccccc-cccc-4ccc-8ccc-0000000000b1'),
 ('task_A','dddddddd-dddd-4ddd-8ddd-00000000000a'),('task_B','dddddddd-dddd-4ddd-8ddd-00000000000b'),('task_0','dddddddd-dddd-4ddd-8ddd-000000000000'),
 ('appr_A','eeeeeeee-eeee-4eee-8eee-00000000000a'),('appr_B','eeeeeeee-eeee-4eee-8eee-00000000000b'),('appr_0','eeeeeeee-eeee-4eee-8eee-000000000000'),
 ('asg_A','ffffffff-ffff-4fff-8fff-00000000000a'),('asg_B','ffffffff-ffff-4fff-8fff-00000000000b'),('asg_0','ffffffff-ffff-4fff-8fff-000000000000'),
 ('cmt_A','12121212-1212-4212-8212-00000000000a'),('cmt_B','12121212-1212-4212-8212-00000000000b'),
 ('skill_on','13131313-1313-4313-8313-000000000001'),('skill_draft','13131313-1313-4313-8313-000000000002'),
 ('ter_A','14141414-1414-4414-8414-00000000000a'),('ter_B','14141414-1414-4414-8414-00000000000b'),
 ('cru_A','15151515-1515-4515-8515-00000000000a'),('cru_B','15151515-1515-4515-8515-00000000000b'),
 ('src_A','16161616-1616-4616-8616-00000000000a'),('src_B','16161616-1616-4616-8616-00000000000b'),
 ('mcp','17171717-1717-4717-8717-000000000001'),('n8n','17171717-1717-4717-8717-000000000002'),('hook','17171717-1717-4717-8717-000000000003'),
 ('bank_B','17171717-1717-4717-8717-0000000000b4'),
 ('lib_A','18181818-1818-4818-8818-00000000000a'),('lib_B','18181818-1818-4818-8818-00000000000b'),
 ('mc_A','19191919-1919-4919-8919-00000000000a'),('mc_B','19191919-1919-4919-8919-00000000000b'),
 ('fun_A','20202020-2020-4020-8020-00000000000a'),('fun_B','20202020-2020-4020-8020-00000000000b'),
 ('art','21212121-2121-4121-8121-000000000001'),
 ('client_XB','33333333-3333-4333-8333-0000000000cb'),('client_OAA','33333333-3333-4333-8333-0000000000aa');
CREATE FUNCTION proof.i(text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = proof AS $$ SELECT id FROM proof.ids WHERE k = $1 $$;
GRANT EXECUTE ON FUNCTION proof.i(text) TO anon, authenticated, service_role;

INSERT INTO public.tenants (id, name, account_type, parent_tenant_id, features) VALUES
 (proof.i('A'),'Fixture A','standalone',NULL,'{}'),(proof.i('B'),'Fixture B','standalone',NULL,'{}'),
 (proof.i('W'),'Fixture company workspace','standalone',NULL,'{"system_workspace":true}'),
 (proof.i('G'),'Fixture agency','agency',NULL,'{}');
INSERT INTO public.tenants (id, name, account_type, parent_tenant_id) VALUES (proof.i('C'),'Fixture child','sub_account',proof.i('G'));
INSERT INTO auth.users SELECT id FROM proof.ids WHERE k IN ('SA','PA','OA','AA','MA','X','OB','MB','CL','CLB','GO','V','MA2');
INSERT INTO public.profiles (user_id) SELECT id FROM proof.ids WHERE k IN ('SA','PA','OA','AA','MA','X','OB','MB','CL','CLB','GO','V','MA2');
-- Operator tiers, as on production (the super_admin also holds the global admin row).
INSERT INTO public.user_roles (user_id, role) VALUES (proof.i('SA'),'super_admin'),(proof.i('SA'),'admin'),(proof.i('PA'),'platform_admin');
-- Seats, written as a trusted server context (no JWT), so the sync trigger mints global 'admin'
-- for every owner/admin seat exactly as production does: X ends up holding it from A.
INSERT INTO public.tenant_members (tenant_id, user_id, role, is_owner, joined_at) VALUES
 (proof.i('A'), proof.i('OA'), 'owner', true, now() - interval '9 days'),
 (proof.i('A'), proof.i('AA'), 'admin', false, now() - interval '8 days'),
 (proof.i('A'), proof.i('MA'), 'member', false, now() - interval '8 days'),
 (proof.i('A'), proof.i('MA2'), 'member', false, now() - interval '8 days'),
 (proof.i('A'), proof.i('X'), 'owner', true, now() - interval '7 days'),
 (proof.i('B'), proof.i('X'), 'member', false, now() - interval '6 days'),
 (proof.i('B'), proof.i('OB'), 'owner', true, now() - interval '9 days'),
 (proof.i('B'), proof.i('MB'), 'member', false, now() - interval '8 days'),
 (proof.i('G'), proof.i('GO'), 'owner', true, now() - interval '9 days');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = proof.i('X') AND role = 'admin') THEN
    RAISE EXCEPTION 'FAIL: fixture X did not receive the global admin row its A seat mints on production'; END IF;
END $$;
INSERT INTO public.clients (id, tenant_id, linked_user_id) VALUES (proof.i('client_A'), proof.i('A'), proof.i('CL')), (proof.i('client_B'), proof.i('B'), proof.i('CLB'));
-- X (owner of A) is also a portal client of B; OA is also a portal client of their own business A.
INSERT INTO public.clients (id, tenant_id, linked_user_id) VALUES (proof.i('client_XB'), proof.i('B'), proof.i('X')), (proof.i('client_OAA'), proof.i('A'), proof.i('OA'));
INSERT INTO public.paige_event_kinds (slug, default_audience, default_visibility) VALUES ('k.client','both','client_visible'), ('k.owner','owner','owner_internal');
INSERT INTO public.businesses (id, owner_user_id, tenant_id) VALUES (proof.i('biz_A'), proof.i('CL'), proof.i('A')), (proof.i('biz_B'), proof.i('CLB'), proof.i('B'));
INSERT INTO public.business_certifications (id, business_id, user_id, certification_type) VALUES
 (proof.i('cert_A'), proof.i('biz_A'), proof.i('CL'), 'wosb'), (proof.i('cert_B'), proof.i('biz_B'), proof.i('CLB'), 'wosb');
INSERT INTO public.business_verification_runs (id, business_id, contact_id) VALUES
 (proof.i('run_A'), proof.i('biz_A'), NULL), (proof.i('run_B'), NULL, proof.i('client_B'));
INSERT INTO public.business_verifications (id, run_id) VALUES (proof.i('ver_A'), proof.i('run_A')), (proof.i('ver_B'), proof.i('run_B'));
INSERT INTO public.chat_message_embeddings (id, user_id) VALUES (proof.i('emb_OB'), proof.i('OB')), (proof.i('emb_X'), proof.i('X'));
INSERT INTO public.client_goals (id, user_id) VALUES (proof.i('goal_A'), proof.i('CL')), (proof.i('goal_B'), proof.i('CLB'));
INSERT INTO public.lender_research_results (id, user_id, client_user_id) VALUES
 (proof.i('lrr_A'), proof.i('OA'), proof.i('CL')), (proof.i('lrr_B'), proof.i('OB'), proof.i('CLB'));
INSERT INTO public.rag_documents (id, client_id, document_type, embedding) VALUES
 (proof.i('rag_A'), proof.i('CL'), 'note', NULL), (proof.i('rag_B'), proof.i('CLB'), 'note', NULL), (proof.i('rag_0'), NULL, 'note', NULL),
 (proof.i('rag_finB'), proof.i('CLB'), 'client_financial_brief', '{1}');
INSERT INTO public.legal_acceptances (id, user_id) VALUES (proof.i('la_OB'), proof.i('OB')), (proof.i('la_X'), proof.i('X'));
INSERT INTO public.paige_sla_alert_log (id, client_id) VALUES (proof.i('sla_B'), proof.i('client_B'));
INSERT INTO public.tasks (id, user_id, tenant_id) VALUES
 (proof.i('task_A'), proof.i('MA'), proof.i('A')), (proof.i('task_B'), proof.i('OB'), proof.i('B')), (proof.i('task_0'), proof.i('MA'), NULL);
INSERT INTO public.paige_pending_approvals (id, tenant_id) VALUES (proof.i('appr_A'), proof.i('A')), (proof.i('appr_B'), proof.i('B')), (proof.i('appr_0'), NULL);
INSERT INTO public.paige_coach_assignments (id, tenant_id) VALUES (proof.i('asg_A'), proof.i('A')), (proof.i('asg_B'), proof.i('B')), (proof.i('asg_0'), NULL);
INSERT INTO public.paige_approval_comments (id, approval_id, author_id) VALUES (proof.i('cmt_A'), proof.i('appr_A'), proof.i('OA')), (proof.i('cmt_B'), proof.i('appr_B'), proof.i('OB'));
INSERT INTO public.paige_skills (id, slug, name, status) VALUES (proof.i('skill_on'),'on','On','active'), (proof.i('skill_draft'),'draft','Draft','draft');
INSERT INTO public.paige_assignment_policy (tier) VALUES ('standard');
INSERT INTO public.tenant_entity_relationships (id, contact_id, entity_id, tenant_id) VALUES
 (proof.i('ter_A'), proof.i('client_A'), gen_random_uuid(), proof.i('A')), (proof.i('ter_B'), proof.i('client_B'), gen_random_uuid(), proof.i('B'));
INSERT INTO public.credit_report_uploads (id, user_id, file_path, tenant_id) VALUES
 (proof.i('cru_A'), proof.i('CL'), 'a.pdf', proof.i('A')), (proof.i('cru_B'), proof.i('CLB'), 'b.pdf', proof.i('B'));
INSERT INTO public.growth_external_sources (id, tenant_id) VALUES (proof.i('src_A'), proof.i('A')), (proof.i('src_B'), proof.i('B'));
INSERT INTO public.paige_mcp_connections (id) VALUES (proof.i('mcp'));
INSERT INTO public.paige_n8n_connections (id) VALUES (proof.i('n8n'));
INSERT INTO public.outbound_webhook_configs (id) VALUES (proof.i('hook'));
INSERT INTO public.connected_bank_accounts (id, user_id, business_id) VALUES (proof.i('bank_B'), proof.i('CLB'), proof.i('biz_B'));
INSERT INTO public.connected_bank_account_secrets (account_row_id) VALUES (proof.i('bank_B'));
INSERT INTO public.studio_library_items (id, tenant_id, artifact_kind, artifact_id) VALUES
 (proof.i('lib_A'), proof.i('A'), 'page', gen_random_uuid()), (proof.i('lib_B'), proof.i('B'), 'page', gen_random_uuid());
INSERT INTO public.marketing_content (id, tenant_id) VALUES (proof.i('mc_A'), proof.i('A')), (proof.i('mc_B'), proof.i('B'));
INSERT INTO public.growth_funnels (id, tenant_id) VALUES (proof.i('fun_A'), proof.i('A')), (proof.i('fun_B'), proof.i('B'));
INSERT INTO storage.buckets (id, name, public) VALUES ('paige-generated','paige-generated', true);
INSERT INTO storage.objects (bucket_id, name) VALUES
 ('paige-generated', proof.i('A')::text || '/a.png'), ('paige-generated', proof.i('B')::text || '/b.png');

-- ═════════════════════════════════ HARNESS ═════════════════════════════════════════════════
-- try_as runs one statement as one actor, with that actor's workspace switched in, and rolls it
-- back. It answers 'ok:<value>' or 'err:<SQLSTATE>:<message>'. Role 'definer' means "called from
-- inside another SECURITY DEFINER function by a signed-in person": the claims are set but no role
-- is assumed, which is the only way to reach the functions EXECUTE-granted to service_role alone.
CREATE FUNCTION proof.try_as(_actor text, _active text, _role text, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; _uid uuid := proof.i(_actor);
BEGIN
  BEGIN
    IF _uid IS NOT NULL THEN UPDATE public.profiles SET active_tenant_id = proof.i(_active) WHERE user_id = _uid; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid,
      'role', CASE WHEN _role = 'definer' THEN 'authenticated' ELSE _role END)::text, true);
    IF _role <> 'definer' THEN EXECUTE format('SET LOCAL ROLE %I', _role); END IF;
    EXECUTE _sql INTO r;
    RAISE EXCEPTION USING ERRCODE = 'PX001', MESSAGE = 'ok:' || coalesce(r, 'null');
  EXCEPTION
    WHEN SQLSTATE 'PX001' THEN RETURN SQLERRM;
    WHEN OTHERS THEN RETURN 'err:' || SQLSTATE || ':' || SQLERRM;
  END;
END $$;

-- kind: hole  = X (or another owner) gets admin power outside their own workspace: must FAIL on
--               production's definitions and PASS after the migration;
--       keep  = a legitimate path (own-workspace owner/admin, operator, self, service): passes both;
--       deny  = a refusal that already held (member, anon): passes both;
--       widen = a deliberate behaviour change, reported (fails before, passes after).
CREATE TABLE proof.checks (id text PRIMARY KEY, obj text NOT NULL, kind text NOT NULL CHECK (kind IN ('hole','keep','deny','widen')),
  actor text, active text, role text NOT NULL DEFAULT 'authenticated', sql text NOT NULL, expect text NOT NULL);

-- Shorthands used in the SQL below: proof.i('<key>') resolves a fixture id.
INSERT INTO proof.checks (id, obj, kind, actor, active, role, sql, expect) VALUES
-- change_user_role
('change_user_role X in A on B','fn:change_user_role','hole','X','A','authenticated',$q$SELECT public.change_user_role(proof.i('MB'),'user','sales_rep',proof.i('B'))::text$q$,'err:42501:ROLE_CHANGE_FORBIDDEN: admin%'),
('change_user_role X in B on B','fn:change_user_role','hole','X','B','authenticated',$q$SELECT public.change_user_role(proof.i('MB'),'user','sales_rep')::text$q$,'err:42501:ROLE_CHANGE_FORBIDDEN: admin%'),
('change_user_role OA in A on A','fn:change_user_role','keep','OA','A','authenticated',$q$SELECT public.change_user_role(proof.i('MA2'),'user','sales_rep')::text$q$,'ok:'),
('change_user_role AA in A on A','fn:change_user_role','keep','AA','A','authenticated',$q$SELECT public.change_user_role(proof.i('MA2'),'user','sales_rep')::text$q$,'ok:'),
('change_user_role MA in A refused','fn:change_user_role','deny','MA','A','authenticated',$q$SELECT public.change_user_role(proof.i('MA2'),'user','sales_rep')::text$q$,'err:42501%'),
('change_user_role SA on B','fn:change_user_role','keep','SA',NULL,'authenticated',$q$SELECT public.change_user_role(proof.i('MB'),'user','sales_rep',proof.i('B'))::text$q$,'ok:'),
('change_user_role anon refused','fn:change_user_role','deny',NULL,NULL,'anon',$q$SELECT public.change_user_role(proof.i('MB'),'user','sales_rep',proof.i('B'))::text$q$,'err:42501%'),
-- get_profile_with_pii_log
('pii X reads OB','fn:get_profile_with_pii_log','hole','X','A','authenticated',$q$SELECT count(*)::text FROM public.get_profile_with_pii_log(proof.i('OB'))$q$,'err:P0001:Unauthorized'),
('pii OA reads CLB','fn:get_profile_with_pii_log','hole','OA','A','authenticated',$q$SELECT count(*)::text FROM public.get_profile_with_pii_log(proof.i('CLB'))$q$,'err:P0001:Unauthorized'),
('pii X reads self','fn:get_profile_with_pii_log','keep','X','B','authenticated',$q$SELECT count(*)::text FROM public.get_profile_with_pii_log(proof.i('X'))$q$,'ok:1'),
('pii SA reads OB','fn:get_profile_with_pii_log','keep','SA',NULL,'authenticated',$q$SELECT count(*)::text FROM public.get_profile_with_pii_log(proof.i('OB'))$q$,'ok:1'),
('pii MA reads OB refused','fn:get_profile_with_pii_log','deny','MA','A','authenticated',$q$SELECT count(*)::text FROM public.get_profile_with_pii_log(proof.i('OB'))$q$,'err:P0001:Unauthorized'),
-- delete_credit_report_upload
('credit X in A deletes B upload','fn:delete_credit_report_upload','hole','X','A','authenticated',$q$SELECT public.delete_credit_report_upload(proof.i('cru_B'), proof.i('X'))->>'success'$q$,'err:42501:Unauthorized'),
('credit X in B deletes B upload','fn:delete_credit_report_upload','hole','X','B','authenticated',$q$SELECT public.delete_credit_report_upload(proof.i('cru_B'), proof.i('X'))->>'success'$q$,'err:42501:Unauthorized'),
('credit OA deletes A upload','fn:delete_credit_report_upload','keep','OA','A','authenticated',$q$SELECT public.delete_credit_report_upload(proof.i('cru_A'), proof.i('OA'))->>'success'$q$,'ok:true'),
('credit AA missing upload','fn:delete_credit_report_upload','keep','AA','A','authenticated',$q$SELECT public.delete_credit_report_upload(gen_random_uuid(), proof.i('AA'))->>'success'$q$,'ok:false'),
('credit SA deletes B upload','fn:delete_credit_report_upload','keep','SA',NULL,'authenticated',$q$SELECT public.delete_credit_report_upload(proof.i('cru_B'), proof.i('SA'))->>'success'$q$,'ok:true'),
('credit MA refused','fn:delete_credit_report_upload','deny','MA','A','authenticated',$q$SELECT public.delete_credit_report_upload(proof.i('cru_A'), proof.i('MA'))->>'success'$q$,'err:42501:Unauthorized'),
-- platform_set_* setters
('growth token X sets B','fn:platform_set_growth_external_source_token','hole','X','A','authenticated',$q$SELECT public.platform_set_growth_external_source_token(proof.i('src_B'),'t')::text$q$,'err:P0001:not authorized'),
('growth token OA sets A','fn:platform_set_growth_external_source_token','keep','OA','A','authenticated',$q$SELECT public.platform_set_growth_external_source_token(proof.i('src_A'),'t')::text$q$,'ok:'),
('growth token MA refused','fn:platform_set_growth_external_source_token','deny','MA','A','authenticated',$q$SELECT public.platform_set_growth_external_source_token(proof.i('src_A'),'t')::text$q$,'err:P0001:not authorized'),
('growth token SA sets B','fn:platform_set_growth_external_source_token','keep','SA',NULL,'authenticated',$q$SELECT public.platform_set_growth_external_source_token(proof.i('src_B'),'t')::text$q$,'ok:'),
('mcp url X refused','fn:platform_set_mcp_server_url','hole','X','A','authenticated',$q$SELECT public.platform_set_mcp_server_url(proof.i('mcp'),'u')::text$q$,'err:P0001:not authorized'),
('mcp url SA','fn:platform_set_mcp_server_url','keep','SA',NULL,'authenticated',$q$SELECT public.platform_set_mcp_server_url(proof.i('mcp'),'u')::text$q$,'ok:'),
('webhook url X refused','fn:platform_set_outbound_webhook_url','hole','X','A','authenticated',$q$SELECT public.platform_set_outbound_webhook_url(proof.i('hook'),'u')::text$q$,'err:P0001:not authorized'),
('webhook url SA','fn:platform_set_outbound_webhook_url','keep','SA',NULL,'authenticated',$q$SELECT public.platform_set_outbound_webhook_url(proof.i('hook'),'u')::text$q$,'ok:'),
('plaid X sets B account','fn:platform_set_plaid_access_token','hole','X','A','authenticated',$q$SELECT public.platform_set_plaid_access_token(proof.i('bank_B'),'t')::text$q$,'err:P0001:not authorized'),
('plaid SA','fn:platform_set_plaid_access_token','keep','SA',NULL,'authenticated',$q$SELECT public.platform_set_plaid_access_token(proof.i('bank_B'),'t')::text$q$,'ok:'),
('n8n X via definer chain','fn:platform_set_n8n_base_url','hole','X','A','definer',$q$SELECT public.platform_set_n8n_base_url(proof.i('n8n'),'u')::text$q$,'err:P0001:not authorized'),
('n8n SA via definer chain','fn:platform_set_n8n_base_url','keep','SA',NULL,'definer',$q$SELECT public.platform_set_n8n_base_url(proof.i('n8n'),'u')::text$q$,'ok:'),
('n8n authenticated has no EXECUTE','fn:platform_set_n8n_base_url','deny','SA',NULL,'authenticated',$q$SELECT public.platform_set_n8n_base_url(proof.i('n8n'),'u')::text$q$,'err:42501%'),
-- library
('list_library OA reads B','fn:list_library','hole','OA','A','authenticated',$q$SELECT count(*)::text FROM public.list_library(NULL, 200, proof.i('B'))$q$,'err:42501:LIBRARY_FORBIDDEN%'),
('list_library X (member) reads B','fn:list_library','keep','X','A','authenticated',$q$SELECT count(*)::text FROM public.list_library(NULL, 200, proof.i('B'))$q$,'ok:1'),
('list_library MA reads A','fn:list_library','keep','MA','A','authenticated',$q$SELECT count(*)::text FROM public.list_library()$q$,'ok:1'),
('list_library MA reads B refused','fn:list_library','deny','MA','A','authenticated',$q$SELECT count(*)::text FROM public.list_library(NULL, 200, proof.i('B'))$q$,'err:42501%'),
('list_library SA reads B','fn:list_library','keep','SA',NULL,'authenticated',$q$SELECT count(*)::text FROM public.list_library(NULL, 200, proof.i('B'))$q$,'ok:1'),
('save_to_library X in A into B','fn:save_to_library','hole','X','A','authenticated',$q$SELECT (public.save_to_library('page', proof.i('art'), 'T', NULL, NULL, proof.i('B')) IS NOT NULL)::text$q$,'err:42501:LIBRARY_FORBIDDEN: admin%'),
('save_to_library X in B','fn:save_to_library','hole','X','B','authenticated',$q$SELECT (public.save_to_library('page', proof.i('art'), 'T') IS NOT NULL)::text$q$,'err:42501:LIBRARY_FORBIDDEN: admin%'),
('save_to_library OA in A','fn:save_to_library','keep','OA','A','authenticated',$q$SELECT (public.save_to_library('page', proof.i('art'), 'T') IS NOT NULL)::text$q$,'ok:true'),
('save_to_library MA refused','fn:save_to_library','deny','MA','A','authenticated',$q$SELECT (public.save_to_library('page', proof.i('art'), 'T') IS NOT NULL)::text$q$,'err:42501%'),
('save_to_library no tenant still NO_TENANT','fn:save_to_library','keep','V',NULL,'authenticated',$q$SELECT (public.save_to_library('page', proof.i('art'), 'T') IS NOT NULL)::text$q$,'err:%'),
('remove_from_library X in A removes B item','fn:remove_from_library','hole','X','A','authenticated',$q$SELECT public.remove_from_library(proof.i('lib_B'))::text$q$,'ok:false'),
('remove_from_library X in B','fn:remove_from_library','hole','X','B','authenticated',$q$SELECT public.remove_from_library(proof.i('lib_B'))::text$q$,'err:42501:LIBRARY_FORBIDDEN%'),
('remove_from_library OA in A','fn:remove_from_library','keep','OA','A','authenticated',$q$SELECT public.remove_from_library(proof.i('lib_A'))::text$q$,'ok:true'),
('remove_from_library MA refused','fn:remove_from_library','deny','MA','A','authenticated',$q$SELECT public.remove_from_library(proof.i('lib_A'))::text$q$,'err:42501%'),
('remove_from_library SA removes B','fn:remove_from_library','keep','SA',NULL,'authenticated',$q$SELECT public.remove_from_library(proof.i('lib_B'))::text$q$,'ok:true'),
('delete_marketing_content X in A deletes B','fn:delete_marketing_content','hole','X','A','authenticated',$q$SELECT public.delete_marketing_content(proof.i('mc_B'))::text$q$,'ok:false'),
('delete_marketing_content X in B','fn:delete_marketing_content','hole','X','B','authenticated',$q$SELECT public.delete_marketing_content(proof.i('mc_B'))::text$q$,'err:42501:CONTENT_FORBIDDEN%'),
('delete_marketing_content OA in A','fn:delete_marketing_content','keep','OA','A','authenticated',$q$SELECT public.delete_marketing_content(proof.i('mc_A'))::text$q$,'ok:true'),
('delete_marketing_content MA refused','fn:delete_marketing_content','deny','MA','A','authenticated',$q$SELECT public.delete_marketing_content(proof.i('mc_A'))::text$q$,'err:42501%'),
('delete_marketing_content SA deletes B','fn:delete_marketing_content','keep','SA',NULL,'authenticated',$q$SELECT public.delete_marketing_content(proof.i('mc_B'))::text$q$,'ok:true'),
-- create_internal_booking
('booking X in A into B','fn:create_internal_booking','hole','X','A','authenticated',$q$SELECT (public.create_internal_booking('Call', now(), now() + interval '1 hour', _tenant_id => proof.i('B')) IS NOT NULL)::text$q$,'err:42501:BOOKING_FORBIDDEN%'),
('booking X in B','fn:create_internal_booking','hole','X','B','authenticated',$q$SELECT (public.create_internal_booking('Call', now(), now() + interval '1 hour') IS NOT NULL)::text$q$,'err:42501:BOOKING_FORBIDDEN%'),
('booking OA in A','fn:create_internal_booking','keep','OA','A','authenticated',$q$SELECT (public.create_internal_booking('Call', now(), now() + interval '1 hour') IS NOT NULL)::text$q$,'ok:true'),
('booking AA in A','fn:create_internal_booking','keep','AA','A','authenticated',$q$SELECT (public.create_internal_booking('Call', now(), now() + interval '1 hour') IS NOT NULL)::text$q$,'ok:true'),
('booking MA refused','fn:create_internal_booking','deny','MA','A','authenticated',$q$SELECT (public.create_internal_booking('Call', now(), now() + interval '1 hour') IS NOT NULL)::text$q$,'err:42501%'),
('booking PA in company workspace','fn:create_internal_booking','keep','PA','W','authenticated',$q$SELECT (public.create_internal_booking('Call', now(), now() + interval '1 hour') IS NOT NULL)::text$q$,'ok:true'),
('booking agency owner in child C','fn:create_internal_booking','widen','GO','C','authenticated',$q$SELECT (public.create_internal_booking('Call', now(), now() + interval '1 hour') IS NOT NULL)::text$q$,'ok:true'),
-- growth_funnel_session_upsert (service role only: reached from a definer chain)
('funnel X in A on B funnel','fn:growth_funnel_session_upsert','hole','X','A','definer',$q$SELECT ((public.growth_funnel_session_upsert(proof.i('fun_B'))).tenant_id)::text$q$,'err:42501:GROWTH_FORBIDDEN%'),
('funnel OA in A on A funnel','fn:growth_funnel_session_upsert','keep','OA','A','definer',$q$SELECT ((public.growth_funnel_session_upsert(proof.i('fun_A'))).tenant_id = proof.i('A'))::text$q$,'ok:true'),
('funnel no-JWT visitor','fn:growth_funnel_session_upsert','keep',NULL,NULL,'service_role',$q$SELECT ((public.growth_funnel_session_upsert(proof.i('fun_B'))).tenant_id = proof.i('B'))::text$q$,'ok:true'),
-- operator actions (service role only)
('suspend_user X','fn:suspend_user','hole','X','A','definer',$q$SELECT public.suspend_user((SELECT id FROM public.profiles WHERE user_id = proof.i('OB')), 'r')::text$q$,'err:P0001:forbidden'),
('suspend_user SA passes authority','fn:suspend_user','keep','SA',NULL,'definer',$q$SELECT public.suspend_user((SELECT id FROM public.profiles WHERE user_id = proof.i('OB')), 'r')::text$q$,'err:42703:%metadata%'),
('reactivate_user X','fn:reactivate_user','hole','X','A','definer',$q$SELECT public.reactivate_user((SELECT id FROM public.profiles WHERE user_id = proof.i('OB')))::text$q$,'err:P0001:forbidden'),
('reactivate_user SA passes authority','fn:reactivate_user','keep','SA',NULL,'definer',$q$SELECT public.reactivate_user((SELECT id FROM public.profiles WHERE user_id = proof.i('OB')))::text$q$,'err:42703:%metadata%'),
('meta capi set X','fn:admin_set_meta_capi_token','hole','X','A','definer',$q$SELECT public.admin_set_meta_capi_token('tok')::text$q$,'err:P0001:forbidden'),
('meta capi set SA passes authority','fn:admin_set_meta_capi_token','keep','SA',NULL,'definer',$q$SELECT public.admin_set_meta_capi_token('tok')::text$q$,'err:42703:%metadata%'),
('meta capi is_set X','fn:admin_meta_capi_token_is_set','hole','X','A','definer',$q$SELECT public.admin_meta_capi_token_is_set()::text$q$,'err:P0001:forbidden'),
('meta capi is_set SA','fn:admin_meta_capi_token_is_set','keep','SA',NULL,'definer',$q$SELECT public.admin_meta_capi_token_is_set()::text$q$,'ok:false'),
('business limit X','fn:admin_set_user_business_limit','hole','X','A','definer',$q$SELECT public.admin_set_user_business_limit(proof.i('OB'), 5)->>'success'$q$,'err:P0001:Unauthorized%'),
('business limit SA','fn:admin_set_user_business_limit','keep','SA',NULL,'definer',$q$SELECT public.admin_set_user_business_limit(proof.i('OB'), 5)->>'success'$q$,'ok:true'),
('rag recalibrate X','fn:rag_recalibrate_quality','hole','X','A','definer',$q$SELECT count(*)::text FROM public.rag_recalibrate_quality()$q$,'err:P0001:Unauthorized'),
('rag recalibrate SA','fn:rag_recalibrate_quality','keep','SA',NULL,'definer',$q$SELECT count(*)::text FROM public.rag_recalibrate_quality()$q$,'ok:1'),
('rag recalibrate no-JWT','fn:rag_recalibrate_quality','keep',NULL,NULL,'service_role',$q$SELECT count(*)::text FROM public.rag_recalibrate_quality()$q$,'ok:1'),
('match_rag X sees B client finance','fn:match_rag_documents','hole','X','A','definer',$q$SELECT count(*)::text FROM public.match_rag_documents('{1}'::extensions.vector, 0.5, 5, ARRAY['client_financial_brief'])$q$,'ok:0'),
('match_rag SA sees finance','fn:match_rag_documents','keep','SA',NULL,'definer',$q$SELECT count(*)::text FROM public.match_rag_documents('{1}'::extensions.vector, 0.5, 5, ARRAY['client_financial_brief'])$q$,'err:42702:column reference "id" is ambiguous'),
('match_rag client sees own','fn:match_rag_documents','keep','CLB',NULL,'definer',$q$SELECT count(*)::text FROM public.match_rag_documents('{1}'::extensions.vector, 0.5, 5, ARRAY['client_financial_brief'])$q$,'err:42702:column reference "id" is ambiguous'),
('match_rag service','fn:match_rag_documents','keep',NULL,NULL,'service_role',$q$SELECT count(*)::text FROM public.match_rag_documents('{1}'::extensions.vector, 0.5, 5, ARRAY['client_financial_brief'])$q$,'err:42702:column reference "id" is ambiguous'),
-- _assert_billing_admin: unchanged, fail-closed for everyone on production (22P02).
('billing assert X unchanged','fn:_assert_billing_admin','deny','X','A','definer',$q$SELECT public._assert_billing_admin()::text$q$,'err:22P02%owner%'),
('billing assert OA unchanged','fn:_assert_billing_admin','deny','OA','A','definer',$q$SELECT public._assert_billing_admin()::text$q$,'err:22P02%owner%'),
-- grant_tenant_member_role
('grant admin to outsider mints no global row','fn:grant_tenant_member_role','hole','AA','A','authenticated',$q$SELECT proof.seq($a$SELECT public.grant_tenant_member_role(proof.i('V'),'admin',proof.i('A'))$a$, $b$SELECT (SELECT count(*) FROM public.user_roles WHERE user_id = proof.i('V') AND role = 'admin')::text || ':' || (SELECT string_agg(tenant_id::text || '=' || role::text || '/' || status, ',') FROM public.tenant_members WHERE user_id = proof.i('V'))$b$)$q$,'ok:0:11111111-1111-4111-8111-00000000000a=admin/pending'),
('grant admin to member: seat active, global row by seat sync','fn:grant_tenant_member_role','keep','AA','A','authenticated',$q$SELECT proof.seq($a$SELECT public.grant_tenant_member_role(proof.i('MA2'),'admin',proof.i('A'))$a$, $b$SELECT (SELECT count(*) FROM public.user_roles WHERE user_id = proof.i('MA2') AND role = 'admin')::text || ':' || (SELECT role::text || '/' || status FROM public.tenant_members WHERE user_id = proof.i('MA2') AND tenant_id = proof.i('A'))$b$)$q$,'ok:1:admin/active'),
('grant sales_rep still writes its global row','fn:grant_tenant_member_role','keep','AA','A','authenticated',$q$SELECT proof.seq($a$SELECT public.grant_tenant_member_role(proof.i('MA2'),'sales_rep',proof.i('A'))$a$, $b$SELECT (SELECT count(*) FROM public.user_roles WHERE user_id = proof.i('MA2') AND role = 'sales_rep')::text$b$)$q$,'ok:1'),
('grant X in B refused','fn:grant_tenant_member_role','deny','X','B','authenticated',$q$SELECT public.grant_tenant_member_role(proof.i('MB'),'admin')::text$q$,'err:P0001:Tenant admin%'),
('grant MA refused','fn:grant_tenant_member_role','deny','MA','A','authenticated',$q$SELECT public.grant_tenant_member_role(proof.i('MA2'),'admin')::text$q$,'err:P0001:Tenant admin%'),
('grant sales_rep to outsider: pending seat, no global row','fn:grant_tenant_member_role','hole','AA','A','authenticated',$q$SELECT proof.seq($a$SELECT public.grant_tenant_member_role(proof.i('V'),'sales_rep',proof.i('A'))$a$, $b$SELECT (SELECT count(*) FROM public.user_roles WHERE user_id = proof.i('V') AND role = 'sales_rep')::text || ':' || coalesce((SELECT string_agg(tenant_id::text || '=' || role::text || '/' || status, ',' ORDER BY tenant_id) FROM public.tenant_members WHERE user_id = proof.i('V')), '-')$b$)$q$,'ok:0:%=%/pending'),
('grant viewer to member of B only: no global row','fn:grant_tenant_member_role','hole','AA','A','authenticated',$q$SELECT proof.seq($a$SELECT public.grant_tenant_member_role(proof.i('MB'),'viewer',proof.i('A'))$a$, $b$SELECT (SELECT count(*) FROM public.user_roles WHERE user_id = proof.i('MB') AND role = 'viewer')::text || ':' || coalesce((SELECT string_agg(tenant_id::text || '=' || role::text || '/' || status, ',' ORDER BY tenant_id) FROM public.tenant_members WHERE user_id = proof.i('MB')), '-')$b$)$q$,'ok:0:%'),
('grant finance to owner of B: no global row','fn:grant_tenant_member_role','hole','OA','A','authenticated',$q$SELECT proof.seq($a$SELECT public.grant_tenant_member_role(proof.i('OB'),'finance',proof.i('A'))$a$, $b$SELECT (SELECT count(*) FROM public.user_roles WHERE user_id = proof.i('OB') AND role = 'finance')::text || ':' || coalesce((SELECT string_agg(tenant_id::text || '=' || role::text || '/' || status, ',' ORDER BY tenant_id) FROM public.tenant_members WHERE user_id = proof.i('OB')), '-')$b$)$q$,'ok:0:%'),
('grant SA to outsider writes the global row','fn:grant_tenant_member_role','keep','SA',NULL,'authenticated',$q$SELECT proof.seq($a$SELECT public.grant_tenant_member_role(proof.i('V'),'sales_rep',proof.i('B'))$a$, $b$SELECT (SELECT count(*) FROM public.user_roles WHERE user_id = proof.i('V') AND role = 'sales_rep')::text || ':' || coalesce((SELECT string_agg(tenant_id::text || '=' || role::text || '/' || status, ',' ORDER BY tenant_id) FROM public.tenant_members WHERE user_id = proof.i('V')), '-')$b$)$q$,'ok:1:%'),
('grant admin by SA to outsider: pending seat, no global row','fn:grant_tenant_member_role','hole','SA',NULL,'authenticated',$q$SELECT proof.seq($a$SELECT public.grant_tenant_member_role(proof.i('V'),'admin',proof.i('B'))$a$, $b$SELECT (SELECT count(*) FROM public.user_roles WHERE user_id = proof.i('V') AND role = 'admin')::text || ':' || coalesce((SELECT string_agg(tenant_id::text || '=' || role::text || '/' || status, ',' ORDER BY tenant_id) FROM public.tenant_members WHERE user_id = proof.i('V')), '-')$b$)$q$,'ok:0:%=admin/pending'),
('grant PA in company workspace writes the global row','fn:grant_tenant_member_role','keep','PA','W','authenticated',$q$SELECT proof.seq($a$SELECT public.grant_tenant_member_role(proof.i('V'),'viewer',proof.i('W'))$a$, $b$SELECT (SELECT count(*) FROM public.user_roles WHERE user_id = proof.i('V') AND role = 'viewer')::text || ':' || coalesce((SELECT string_agg(tenant_id::text || '=' || role::text || '/' || status, ',' ORDER BY tenant_id) FROM public.tenant_members WHERE user_id = proof.i('V')), '-')$b$)$q$,'ok:1:%'),
('change_user_role AA gives outsider V a role','fn:change_user_role','hole','AA','A','authenticated',$q$SELECT public.change_user_role(proof.i('V'),'viewer','sales_rep',proof.i('A'))::text$q$,'err:42501:ROLE_CHANGE_FORBIDDEN: this person is not an active member of this workspace'),
('change_user_role AA strips a role from member of B only','fn:change_user_role','hole','AA','A','authenticated',$q$SELECT public.change_user_role(proof.i('MB'),'user','viewer',proof.i('A'))::text$q$,'err:42501:ROLE_CHANGE_FORBIDDEN: this person is not an active member of this workspace'),
('change_user_role AA gives owner of B a role','fn:change_user_role','hole','AA','A','authenticated',$q$SELECT public.change_user_role(proof.i('OB'),'viewer','finance',proof.i('A'))::text$q$,'err:42501:ROLE_CHANGE_FORBIDDEN: this person is not an active member of this workspace'),
('change_user_role agency owner gives outsider a role via child','fn:change_user_role','hole','GO','C','authenticated',$q$SELECT public.change_user_role(proof.i('V'),'user','cs_rep',proof.i('C'))::text$q$,'err:42501:ROLE_CHANGE_FORBIDDEN: this person is not an active member of this workspace'),
('change_user_role SA on outsider','fn:change_user_role','keep','SA',NULL,'authenticated',$q$SELECT public.change_user_role(proof.i('V'),'user','viewer',proof.i('B'))::text$q$,'ok:'),
('change_user_role PA in company workspace on outsider','fn:change_user_role','keep','PA','W','authenticated',$q$SELECT public.change_user_role(proof.i('V'),'user','viewer',proof.i('W'))::text$q$,'ok:'),
('rail X files owner-only into B as its portal client','fn:record_rail_event','hole','X','A','authenticated',$q$SELECT (public.record_rail_event(proof.i('client_XB'),'k.owner','client_portal','client','t',p_tenant_id => proof.i('B')) IS NOT NULL)::text$q$,'err:42501:client may only file client-visible events'),
('rail X narrows a client-visible event to owner in B','fn:record_rail_event','hole','X','A','authenticated',$q$SELECT (public.record_rail_event(proof.i('client_XB'),'k.client','client_portal','client','t',p_narrow_to_owner => true,p_tenant_id => proof.i('B')) IS NOT NULL)::text$q$,'err:42501:client may only file client-visible events'),
('rail X files a client-visible event in B as its client','fn:record_rail_event','keep','X','A','authenticated',$q$SELECT (public.record_rail_event(proof.i('client_XB'),'k.client','client_portal','client','t',p_tenant_id => proof.i('B')) IS NOT NULL)::text$q$,'ok:true'),
('rail OA files owner-only into own A as its client','fn:record_rail_event','keep','OA','A','authenticated',$q$SELECT (public.record_rail_event(proof.i('client_OAA'),'k.owner','client_portal','client','t',p_tenant_id => proof.i('A')) IS NOT NULL)::text$q$,'ok:true'),
('rail OB files owner-only for a B contact (staff path)','fn:record_rail_event','keep','OB','B','authenticated',$q$SELECT (public.record_rail_event(proof.i('client_B'),'k.owner','your_paige','owner_staff','t') IS NOT NULL)::text$q$,'ok:true'),
('rail CLB files owner-only refused','fn:record_rail_event','deny','CLB',NULL,'authenticated',$q$SELECT (public.record_rail_event(proof.i('client_B'),'k.owner','client_portal','client','t',p_tenant_id => proof.i('B')) IS NOT NULL)::text$q$,'err:42501:client may only file client-visible events'),
('rail CLB files client-visible','fn:record_rail_event','keep','CLB',NULL,'authenticated',$q$SELECT (public.record_rail_event(proof.i('client_B'),'k.client','client_portal','client','t',p_tenant_id => proof.i('B')) IS NOT NULL)::text$q$,'ok:true'),
('rail service files into B','fn:record_rail_event','keep',NULL,NULL,'service_role',$q$SELECT (public.record_rail_event(proof.i('client_B'),'k.owner','your_paige','automation','t',p_tenant_id => proof.i('B')) IS NOT NULL)::text$q$,'ok:true'),
('rail SA files owner-only into B as staff','fn:record_rail_event','keep','SA','B','authenticated',$q$SELECT (public.record_rail_event(proof.i('client_B'),'k.owner','your_paige','owner_staff','t') IS NOT NULL)::text$q$,'ok:true'),
-- ── POLICIES ──
('skills X in B reads catalogue','pol:paige_skills','hole','X','B','authenticated',$q$SELECT count(*)::text FROM public.paige_skills$q$,'ok:0'),
('skills OA rewrites catalogue','pol:paige_skills','hole','OA','A','authenticated',$q$WITH u AS (UPDATE public.paige_skills SET name = 'changed' RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:0'),
('skills OA reads active (Solo Skills page)','pol:paige_skills','keep','OA','A','authenticated',$q$SELECT count(*)::text FROM public.paige_skills WHERE status = 'active'$q$,'ok:1'),
('skills AA reads active','pol:paige_skills','keep','AA','A','authenticated',$q$SELECT count(*)::text FROM public.paige_skills WHERE status = 'active'$q$,'ok:1'),
('skills MA reads nothing','pol:paige_skills','deny','MA','A','authenticated',$q$SELECT count(*)::text FROM public.paige_skills$q$,'ok:0'),
('skills SA updates','pol:paige_skills','keep','SA',NULL,'authenticated',$q$WITH u AS (UPDATE public.paige_skills SET name = 'changed' RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:2'),
('skills anon reads nothing','pol:paige_skills','deny',NULL,NULL,'anon',$q$SELECT count(*)::text FROM public.paige_skills$q$,'ok:0'),
('skill proposals OA inserts','pol:paige_skill_proposals','hole','OA','A','authenticated',$q$WITH i AS (INSERT INTO public.paige_skill_proposals (proposed_slug, proposed_name) VALUES ('s','n') RETURNING 1) SELECT count(*)::text FROM i$q$,'err:42501%'),
('skill proposals SA inserts','pol:paige_skill_proposals','keep','SA',NULL,'authenticated',$q$WITH i AS (INSERT INTO public.paige_skill_proposals (proposed_slug, proposed_name) VALUES ('s','n') RETURNING 1) SELECT count(*)::text FROM i$q$,'ok:1'),
('assignment policy OA writes','pol:paige_assignment_policy','hole','OA','A','authenticated',$q$WITH u AS (UPDATE public.paige_assignment_policy SET strategy = 'x' RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:0'),
('assignment policy X in B reads','pol:paige_assignment_policy','hole','X','B','authenticated',$q$SELECT count(*)::text FROM public.paige_assignment_policy$q$,'ok:0'),
('assignment policy SA writes','pol:paige_assignment_policy','keep','SA',NULL,'authenticated',$q$WITH u AS (UPDATE public.paige_assignment_policy SET strategy = 'x' RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:1'),
('ter X in A reads B','pol:tenant_entity_relationships','hole','X','A','authenticated',$q$SELECT count(*)::text FROM public.tenant_entity_relationships WHERE tenant_id = proof.i('B')$q$,'ok:0'),
('ter X in A writes B','pol:tenant_entity_relationships','hole','X','A','authenticated',$q$WITH u AS (UPDATE public.tenant_entity_relationships SET relationship_type = 'x' WHERE tenant_id = proof.i('B') RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:0'),
('ter MA in A reads A (members keep, O-7)','pol:tenant_entity_relationships','keep','MA','A','authenticated',$q$SELECT count(*)::text FROM public.tenant_entity_relationships$q$,'ok:1'),
('ter SA reads all','pol:tenant_entity_relationships','keep','SA',NULL,'authenticated',$q$SELECT count(*)::text FROM public.tenant_entity_relationships$q$,'ok:2'),
('cert X in A updates B','pol:business_certifications','hole','X','A','authenticated',$q$WITH u AS (UPDATE public.business_certifications SET status = 'certified' WHERE id = proof.i('cert_B') RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:0'),
('cert X in B updates B','pol:business_certifications','hole','X','B','authenticated',$q$WITH u AS (UPDATE public.business_certifications SET status = 'certified' WHERE id = proof.i('cert_B') RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:0'),
('cert X reads B','pol:business_certifications','hole','X','B','authenticated',$q$SELECT count(*)::text FROM public.business_certifications WHERE id = proof.i('cert_B')$q$,'ok:0'),
('cert OA updates A (FundingProfileSection)','pol:business_certifications','keep','OA','A','authenticated',$q$WITH u AS (UPDATE public.business_certifications SET status = 'certified' WHERE id = proof.i('cert_A') RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:1'),
('cert record owner inserts own','pol:business_certifications','keep','CL',NULL,'authenticated',$q$WITH i AS (INSERT INTO public.business_certifications (business_id, user_id, certification_type) VALUES (proof.i('biz_A'), proof.i('CL'), 'eight_a') RETURNING 1) SELECT count(*)::text FROM i$q$,'ok:1'),
('cert MA updates nothing','pol:business_certifications','deny','MA','A','authenticated',$q$WITH u AS (UPDATE public.business_certifications SET status = 'certified' RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:0'),
('cert record owner updates own (FundingProfileSection)','pol:business_certifications_owner_update','widen','CL',NULL,'authenticated',$q$WITH u AS (UPDATE public.business_certifications SET status = 'certified' WHERE id = proof.i('cert_A') RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:1'),
('cert record owner cannot touch another''s','pol:business_certifications_owner_update','deny','CL',NULL,'authenticated',$q$WITH u AS (UPDATE public.business_certifications SET status = 'certified' WHERE id = proof.i('cert_B') RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:0'),
('cert anon reads nothing, no error','pol:business_certifications','deny',NULL,NULL,'anon',$q$SELECT count(*)::text FROM public.business_certifications$q$,'ok:0'),
('verification runs X reads B','pol:business_verification_runs','hole','X','A','authenticated',$q$SELECT count(*)::text FROM public.business_verification_runs WHERE id = proof.i('run_B')$q$,'ok:0'),
('verification runs OA reads A','pol:business_verification_runs','keep','OA','A','authenticated',$q$SELECT count(*)::text FROM public.business_verification_runs WHERE id = proof.i('run_A')$q$,'ok:1'),
('verification runs OB reads B by contact','pol:business_verification_runs','keep','OB','B','authenticated',$q$SELECT count(*)::text FROM public.business_verification_runs WHERE id = proof.i('run_B')$q$,'ok:1'),
('verification runs MA reads nothing','pol:business_verification_runs','deny','MA','A','authenticated',$q$SELECT count(*)::text FROM public.business_verification_runs$q$,'ok:0'),
('verifications X reads B','pol:business_verifications','hole','X','A','authenticated',$q$SELECT count(*)::text FROM public.business_verifications WHERE id = proof.i('ver_B')$q$,'ok:0'),
('verifications OA reads A','pol:business_verifications','keep','OA','A','authenticated',$q$SELECT count(*)::text FROM public.business_verifications WHERE id = proof.i('ver_A')$q$,'ok:1'),
('verifications OB reads B','pol:business_verifications','keep','OB','B','authenticated',$q$SELECT count(*)::text FROM public.business_verifications WHERE id = proof.i('ver_B')$q$,'ok:1'),
('embeddings X reads OB','pol:chat_message_embeddings','hole','X','A','authenticated',$q$SELECT count(*)::text FROM public.chat_message_embeddings WHERE id = proof.i('emb_OB')$q$,'ok:0'),
('embeddings X deletes OB','pol:chat_message_embeddings','hole','X','A','authenticated',$q$WITH d AS (DELETE FROM public.chat_message_embeddings WHERE id = proof.i('emb_OB') RETURNING 1) SELECT count(*)::text FROM d$q$,'ok:0'),
('embeddings X reads own','pol:chat_message_embeddings','keep','X','B','authenticated',$q$SELECT count(*)::text FROM public.chat_message_embeddings WHERE user_id = proof.i('X')$q$,'ok:1'),
('embeddings SA reads all','pol:chat_message_embeddings','keep','SA',NULL,'authenticated',$q$SELECT count(*)::text FROM public.chat_message_embeddings$q$,'ok:2'),
('goals X reads B client','pol:client_goals','hole','X','A','authenticated',$q$SELECT count(*)::text FROM public.client_goals WHERE id = proof.i('goal_B')$q$,'ok:0'),
('goals X updates B client','pol:client_goals','hole','X','B','authenticated',$q$WITH u AS (UPDATE public.client_goals SET status = 'x' WHERE id = proof.i('goal_B') RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:0'),
('goals OA reads A client (useClientChatContext)','pol:client_goals','keep','OA','A','authenticated',$q$SELECT count(*)::text FROM public.client_goals WHERE id = proof.i('goal_A')$q$,'ok:1'),
('goals client reads own','pol:client_goals','keep','CL',NULL,'authenticated',$q$SELECT count(*)::text FROM public.client_goals$q$,'ok:1'),
('goals MA reads nothing','pol:client_goals','deny','MA','A','authenticated',$q$SELECT count(*)::text FROM public.client_goals$q$,'ok:0'),
('research X reads B client','pol:lender_research_results','hole','X','A','authenticated',$q$SELECT count(*)::text FROM public.lender_research_results WHERE id = proof.i('lrr_B')$q$,'ok:0'),
('research OA reads A client','pol:lender_research_results','keep','OA','A','authenticated',$q$SELECT count(*)::text FROM public.lender_research_results WHERE id = proof.i('lrr_A')$q$,'ok:1'),
('research AA reads A client','pol:lender_research_results','keep','AA','A','authenticated',$q$SELECT count(*)::text FROM public.lender_research_results WHERE id = proof.i('lrr_A')$q$,'ok:1'),
('research client reads own','pol:lender_research_results','keep','CLB',NULL,'authenticated',$q$SELECT count(*)::text FROM public.lender_research_results$q$,'ok:1'),
('research MA reads nothing','pol:lender_research_results','deny','MA','A','authenticated',$q$SELECT count(*)::text FROM public.lender_research_results$q$,'ok:0'),
('research anon reads nothing, no error','pol:lender_research_results','deny',NULL,NULL,'anon',$q$SELECT count(*)::text FROM public.lender_research_results$q$,'ok:0'),
('rag X reads B client doc','pol:rag_documents','hole','X','A','authenticated',$q$SELECT count(*)::text FROM public.rag_documents WHERE id = proof.i('rag_B')$q$,'ok:0'),
('rag OA reads A client doc','pol:rag_documents','keep','OA','A','authenticated',$q$SELECT count(*)::text FROM public.rag_documents WHERE id = proof.i('rag_A')$q$,'ok:1'),
('rag client reads own','pol:rag_documents','keep','CL',NULL,'authenticated',$q$SELECT count(*)::text FROM public.rag_documents WHERE id = proof.i('rag_A')$q$,'ok:1'),
('rag MA reads shared doc','pol:rag_documents','keep','MA','A','authenticated',$q$SELECT count(*)::text FROM public.rag_documents$q$,'ok:1'),
('legal X reads OB','pol:legal_acceptances','hole','X','A','authenticated',$q$SELECT count(*)::text FROM public.legal_acceptances WHERE id = proof.i('la_OB')$q$,'ok:0'),
('legal X reads own','pol:legal_acceptances','keep','X','A','authenticated',$q$SELECT count(*)::text FROM public.legal_acceptances WHERE user_id = proof.i('X')$q$,'ok:1'),
('legal SA reads all','pol:legal_acceptances','keep','SA',NULL,'authenticated',$q$SELECT count(*)::text FROM public.legal_acceptances$q$,'ok:2'),
('sla log X reads B','pol:paige_sla_alert_log','hole','X','B','authenticated',$q$SELECT count(*)::text FROM public.paige_sla_alert_log$q$,'ok:0'),
('sla log SA reads','pol:paige_sla_alert_log','keep','SA',NULL,'authenticated',$q$SELECT count(*)::text FROM public.paige_sla_alert_log$q$,'ok:1'),
('quality log X inserts','pol:extraction_quality_log','hole','X','A','authenticated',$q$WITH i AS (INSERT INTO public.extraction_quality_log (user_id) VALUES (proof.i('X')) RETURNING 1) SELECT count(*)::text FROM i$q$,'err:42501%'),
('quality log SA inserts','pol:extraction_quality_log','keep','SA',NULL,'authenticated',$q$WITH i AS (INSERT INTO public.extraction_quality_log (user_id) VALUES (proof.i('SA')) RETURNING 1) SELECT count(*)::text FROM i$q$,'ok:1'),
('generated OA uploads into B','pol:storage_paige_generated','hole','OA','A','authenticated',$q$WITH i AS (INSERT INTO storage.objects (bucket_id, name) VALUES ('paige-generated', proof.i('B')::text || '/new.png') RETURNING 1) SELECT count(*)::text FROM i$q$,'err:42501%'),
('generated OA updates B','pol:storage_paige_generated','hole','OA','A','authenticated',$q$WITH u AS (UPDATE storage.objects SET metadata = '{}' WHERE name = proof.i('B')::text || '/b.png' RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:0'),
('generated OA uploads into A','pol:storage_paige_generated','keep','OA','A','authenticated',$q$WITH i AS (INSERT INTO storage.objects (bucket_id, name) VALUES ('paige-generated', proof.i('A')::text || '/new.png') RETURNING 1) SELECT count(*)::text FROM i$q$,'ok:1'),
('generated SA uploads into B','pol:storage_paige_generated','keep','SA',NULL,'authenticated',$q$WITH i AS (INSERT INTO storage.objects (bucket_id, name) VALUES ('paige-generated', proof.i('B')::text || '/new.png') RETURNING 1) SELECT count(*)::text FROM i$q$,'ok:1'),
-- S7: the stored staff_update expression itself, on a path whose first folder is not a uuid.
('generated staff expression, non-uuid folder','pol:storage_paige_generated','hole','OA','A','authenticated',$q$SELECT count(*)::text FROM (VALUES ('paige-generated'::text, 'not-a-tenant/c.png'::text)) o(bucket_id, name) WHERE (EXPR_STAFF_UPDATE)$q$,'ok:0'),
('tasks X in B reads owner tasks','pol:tasks','hole','X','B','authenticated',$q$SELECT count(*)::text FROM public.tasks WHERE id = proof.i('task_B')$q$,'ok:0'),
('tasks X in B updates owner tasks','pol:tasks','hole','X','B','authenticated',$q$WITH u AS (UPDATE public.tasks SET title = 'x' WHERE id = proof.i('task_B') RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:0'),
('tasks OA reads null-tenant task of another','pol:tasks','hole','OA','A','authenticated',$q$SELECT count(*)::text FROM public.tasks WHERE id = proof.i('task_0')$q$,'ok:0'),
('tasks OA reads A task','pol:tasks','keep','OA','A','authenticated',$q$SELECT count(*)::text FROM public.tasks WHERE id = proof.i('task_A')$q$,'ok:1'),
('tasks AA updates A task','pol:tasks','keep','AA','A','authenticated',$q$WITH u AS (UPDATE public.tasks SET title = 'x' WHERE id = proof.i('task_A') RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:1'),
('tasks MA reads own two','pol:tasks','keep','MA','A','authenticated',$q$SELECT count(*)::text FROM public.tasks$q$,'ok:2'),
('tasks SA reads all','pol:tasks','keep','SA',NULL,'authenticated',$q$SELECT count(*)::text FROM public.tasks$q$,'ok:3'),
('approvals X in B reads','pol:paige_pending_approvals','hole','X','B','authenticated',$q$SELECT count(*)::text FROM public.paige_pending_approvals WHERE id = proof.i('appr_B')$q$,'ok:0'),
('approvals X in B updates','pol:paige_pending_approvals','hole','X','B','authenticated',$q$WITH u AS (UPDATE public.paige_pending_approvals SET status = 'rejected' WHERE id = proof.i('appr_B') RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:0'),
('approvals OA reads null-tenant','pol:paige_pending_approvals','hole','OA','A','authenticated',$q$SELECT count(*)::text FROM public.paige_pending_approvals WHERE id = proof.i('appr_0')$q$,'ok:0'),
('approvals OA inserts null-tenant','pol:paige_pending_approvals','hole','OA','A','authenticated',$q$WITH i AS (INSERT INTO public.paige_pending_approvals (id, tenant_id) VALUES (gen_random_uuid(), NULL) RETURNING 1) SELECT count(*)::text FROM i$q$,'err:42501%'),
('approvals OA reads A','pol:paige_pending_approvals','keep','OA','A','authenticated',$q$SELECT count(*)::text FROM public.paige_pending_approvals WHERE id = proof.i('appr_A')$q$,'ok:1'),
('approvals OA declines A (Command Center)','pol:paige_pending_approvals','keep','OA','A','authenticated',$q$WITH u AS (UPDATE public.paige_pending_approvals SET status = 'rejected' WHERE id = proof.i('appr_A') RETURNING 1) SELECT count(*)::text FROM u$q$,'ok:1'),
('approvals AA inserts A','pol:paige_pending_approvals','keep','AA','A','authenticated',$q$WITH i AS (INSERT INTO public.paige_pending_approvals (id, tenant_id) VALUES (gen_random_uuid(), proof.i('A')) RETURNING 1) SELECT count(*)::text FROM i$q$,'ok:1'),
('approvals MA reads nothing','pol:paige_pending_approvals','deny','MA','A','authenticated',$q$SELECT count(*)::text FROM public.paige_pending_approvals$q$,'ok:0'),
('approvals SA reads all','pol:paige_pending_approvals','keep','SA',NULL,'authenticated',$q$SELECT count(*)::text FROM public.paige_pending_approvals$q$,'ok:3'),
('assignments OA reads null-tenant','pol:paige_coach_assignments','hole','OA','A','authenticated',$q$SELECT count(*)::text FROM public.paige_coach_assignments WHERE id = proof.i('asg_0')$q$,'ok:0'),
('assignments OA reads A','pol:paige_coach_assignments','keep','OA','A','authenticated',$q$SELECT count(*)::text FROM public.paige_coach_assignments WHERE id = proof.i('asg_A')$q$,'ok:1'),
('assignments MA reads nothing','pol:paige_coach_assignments','deny','MA','A','authenticated',$q$SELECT count(*)::text FROM public.paige_coach_assignments$q$,'ok:0'),
('comments X in B reads','pol:paige_approval_comments','hole','X','B','authenticated',$q$SELECT count(*)::text FROM public.paige_approval_comments WHERE id = proof.i('cmt_B')$q$,'ok:0'),
('comments X in B writes','pol:paige_approval_comments','hole','X','B','authenticated',$q$WITH i AS (INSERT INTO public.paige_approval_comments (approval_id, author_id) VALUES (proof.i('appr_B'), proof.i('X')) RETURNING 1) SELECT count(*)::text FROM i$q$,'err:42501%'),
('comments OA reads A','pol:paige_approval_comments','keep','OA','A','authenticated',$q$SELECT count(*)::text FROM public.paige_approval_comments$q$,'ok:1'),
('comments AA writes A','pol:paige_approval_comments','keep','AA','A','authenticated',$q$WITH i AS (INSERT INTO public.paige_approval_comments (approval_id, author_id) VALUES (proof.i('appr_A'), proof.i('AA')) RETURNING 1) SELECT count(*)::text FROM i$q$,'ok:1');

-- PRODUCTION DEFECT, NOT CHANGED HERE: match_rag_documents is re-emitted verbatim, and on a match it
-- raises 42702 ("id" is ambiguous: the UPDATE's bare `id` against the RETURNS TABLE column; production
-- runs plpgsql.variable_conflict = error). Production has 0 published embedded documents, so it has
-- never fired. The error is raised only AFTER at least one row matched, so in the match_rag checks
-- 42702 means "a row was admitted" and ok:0 means "nothing was admitted".
-- (proof.seq runs a call, then a read in a later statement, so the read sees the call's writes.)
CREATE FUNCTION proof.seq(_do text, _read text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text; BEGIN EXECUTE _do; EXECUTE _read INTO r; RETURN r; END $$;
GRANT EXECUTE ON FUNCTION proof.seq(text, text) TO anon, authenticated, service_role;

-- The S7 check reads the stored staff_update policy expression at run time.
CREATE FUNCTION proof.sql_of(_c proof.checks) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT replace(_c.sql, 'EXPR_STAFF_UPDATE',
    coalesce((SELECT qual FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'paige_generated_staff_update'), 'false')) $$;

-- KNOWN, NOT CLOSED BY STAGE 0 (reported, not asserted): "Admins write staff assignments" on
-- paige_coach_assignments is ALL and reads has_role(admin) AND tenant_id = current_user_tenant_id(),
-- so X switched into B still reads B's assignments through it. It is a tenant-bound has_role policy,
-- the class stage 1 re-answers. Recorded so the gap is visible, not hidden.
CREATE TABLE proof.known_open (id text PRIMARY KEY, actor text, active text, sql text, note text);
INSERT INTO proof.known_open VALUES
('assignments X in B reads B', 'X', 'B', $q$SELECT count(*)::text FROM public.paige_coach_assignments WHERE id = proof.i('asg_B')$q$,
 'open until stage 1: "Admins write staff assignments" (tenant-bound has_role)');

CREATE FUNCTION proof.eval_all() RETURNS TABLE (id text, obj text, kind text, got text, ok boolean) LANGUAGE plpgsql AS $$
DECLARE c proof.checks; g text;
BEGIN
  FOR c IN SELECT * FROM proof.checks ORDER BY proof.checks.id LOOP
    g := proof.try_as(c.actor, c.active, c.role, proof.sql_of(c));
    id := c.id; obj := c.obj; kind := c.kind; got := g; ok := (g LIKE c.expect);
    RETURN NEXT;
  END LOOP;
END $$;

CREATE TABLE proof.results (phase text, id text, obj text, kind text, got text, ok boolean);

-- ═════════════════════════════════ PHASE 1: production's definitions (failing first) ════════
INSERT INTO proof.results SELECT 'production', * FROM proof.eval_all();
\set QUIET off
\echo ''
\echo '── PHASE 1, production definitions: every hole check must FAIL here ──'
SELECT kind, count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail
  FROM proof.results WHERE phase = 'production' GROUP BY kind ORDER BY kind;
\set QUIET on
DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(id || ' => ' || got, E'\n') INTO _bad FROM proof.results
   WHERE phase = 'production' AND ((kind = 'hole' AND ok) OR (kind IN ('keep','deny') AND NOT ok) OR (kind = 'widen' AND ok));
  IF _bad IS NOT NULL THEN RAISE EXCEPTION E'FAIL: on production''s definitions these did not behave as production does:\n%', _bad; END IF;
END $$;
\echo 'PASS: failing first. Every hole check fails on production''s definitions (X, owner of A and member of B, has admin power it has no seat for); every keep/deny check already holds there'

-- ═════════════════════════════════ PHASE 2: the migration ═══════════════════════════════════
\ir ../migrations/20271115030008_admin_scope_stage0.sql
-- Applied twice: the second apply must succeed and change nothing a check can see.
\ir ../migrations/20271115030008_admin_scope_stage0.sql
INSERT INTO proof.results SELECT 'migrated', * FROM proof.eval_all();
\set QUIET off
\echo ''
\echo '── PHASE 2, after 20271115030008: every check must PASS ──'
SELECT kind, count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail
  FROM proof.results WHERE phase = 'migrated' GROUP BY kind ORDER BY kind;
\set QUIET on
DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(id || ' => ' || got, E'\n') INTO _bad FROM proof.results WHERE phase = 'migrated' AND NOT ok;
  IF _bad IS NOT NULL THEN RAISE EXCEPTION E'FAIL: after the migration:\n%', _bad; END IF;
END $$;
\set QUIET off
\pset pager off
\echo ''
\echo '── Every hole and widen check: production result -> migrated result ──'
SELECT p.kind, p.id, p.got AS production, m.got AS migrated FROM proof.results p JOIN proof.results m ON m.id = p.id AND m.phase = 'migrated'
 WHERE p.phase = 'production' AND p.kind IN ('hole','widen') ORDER BY p.obj, p.id;
\set QUIET on
\echo 'PASS: after the migration every hole is closed, owners and admins keep their own workspace, operators keep platform paths, members/anon/service unchanged'

-- Same callers, same grants: no changed function gained or lost a grantee; the helper is not anon's.
DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(b.sig || ': ' || coalesce(b.acl,'<default>') || ' -> ' || coalesce(a.acl,'<default>'), E'\n') INTO _bad
    FROM acl_before b JOIN (SELECT p.oid::regprocedure::text sig, p.proacl::text acl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                             WHERE n.nspname = 'public') a USING (sig)
   WHERE a.acl IS DISTINCT FROM b.acl;
  IF _bad IS NOT NULL THEN RAISE EXCEPTION E'FAIL: grants changed:\n%', _bad; END IF;
  IF has_function_privilege('anon', 'public.is_workspace_admin(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.is_workspace_admin(uuid)', 'EXECUTE')
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.is_workspace_admin(uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'FAIL: is_workspace_admin grants or security are wrong'; END IF;
  -- The helper never answers for the service role or anon (no auth.uid()), nor for a NULL tenant.
  IF proof.try_as(NULL, NULL, 'service_role', $q$SELECT public.is_workspace_admin(proof.i('A'))::text$q$) <> 'ok:false'
     OR proof.try_as('OA', 'A', 'authenticated', $q$SELECT public.is_workspace_admin(NULL)::text$q$) <> 'ok:false'
     OR proof.try_as('PA', 'W', 'authenticated', $q$SELECT public.is_workspace_admin(proof.i('W'))::text$q$) <> 'ok:false'
     OR proof.try_as('GO', 'C', 'authenticated', $q$SELECT public.is_workspace_admin(proof.i('C'))::text$q$) <> 'ok:true'
     OR proof.try_as('X', 'B', 'authenticated', $q$SELECT public.is_workspace_admin(proof.i('A'))::text$q$) <> 'ok:true'
     OR proof.try_as('X', 'B', 'authenticated', $q$SELECT public.is_workspace_admin(proof.i('B'))::text$q$) <> 'ok:false' THEN
    RAISE EXCEPTION 'FAIL: is_workspace_admin answers wrongly'; END IF;
END $$;
-- The record owner's new update rule keeps the row theirs: moving it to someone else is refused.
DO $$ BEGIN
  IF proof.try_as('CL', NULL, 'authenticated', $q$WITH u AS (UPDATE public.business_certifications SET user_id = proof.i('CLB') WHERE id = proof.i('cert_A') RETURNING 1) SELECT count(*)::text FROM u$q$) NOT LIKE 'err:42501%' THEN
    RAISE EXCEPTION 'FAIL: a certification''s own person could give the row to someone else'; END IF;
END $$;
\echo 'PASS: every changed function keeps exactly its production grants; is_workspace_admin is SECURITY DEFINER, authenticated + service_role only, false without a caller or tenant, false for platform_admin, true for an agency owner in its child'

-- Stage 0 does not touch the stage 1+ objects.
DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(e.sig, ', ') INTO _bad FROM prod_fn_md5 e
   JOIN (SELECT regexp_replace(p.oid::regprocedure::text, '^public\.', '') sig, md5(replace(p.prosrc, E'\r', '')) h
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public') l USING (sig)
   WHERE e.sig IN ('has_role(uuid,app_role)','has_any_role(uuid,text[])','current_user_roles()','is_staff(uuid)','studio_role_ok(uuid)',
                   'is_tenant_admin(uuid)','sync_tenant_member_to_user_roles()','sync_user_role_to_tenant_member()',
                   'enforce_tenant_member_consent()','_assert_billing_admin()','current_user_tenant_id()')
     AND l.h <> e.h;
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: stage 0 changed a stage 1+ object: %', _bad; END IF;
END $$;
\echo 'PASS: has_role, has_any_role, current_user_roles, is_staff, studio_role_ok, is_tenant_admin, the sync and consent triggers and _assert_billing_admin are byte-for-byte production'

\set QUIET off
\echo ''
\echo '── Known open after stage 0 (reported, not asserted) ──'
SELECT k.id, proof.try_as(k.actor, k.active, 'authenticated', k.sql) AS got, k.note FROM proof.known_open k;
\set QUIET on

-- ═════════════════════════════════ PHASE 3: mutants (§71.4) ═════════════════════════════════
-- Two policies sit behind another table's RLS: business_verifications reads business_verification_runs,
-- and paige_approval_comments reads paige_pending_approvals, inside its own policy, so the parent's
-- fixed policy alone already hides the row and a mutant of the child is invisible (defence in depth).
-- To prove each child policy stands on its own, its checks also run with the parent's RLS switched
-- off: first as a control after the migration (must pass), then under the mutant (must fail).
CREATE TABLE proof.isolate (obj text PRIMARY KEY, parent text NOT NULL);
INSERT INTO proof.isolate VALUES ('pol:business_verifications', 'public.business_verification_runs'),
                                 ('pol:paige_approval_comments', 'public.paige_pending_approvals');
DO $$ DECLARE i record; _bad text; BEGIN
  FOR i IN SELECT * FROM proof.isolate LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', i.parent);
      SELECT string_agg(e.id || ' => ' || e.got, '; ') INTO _bad FROM proof.eval_all() e WHERE e.obj = i.obj AND NOT e.ok;
      RAISE EXCEPTION USING ERRCODE = 'PX002', MESSAGE = 'undo';
    EXCEPTION WHEN SQLSTATE 'PX002' THEN NULL;
    END;
    IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: % does not hold on its own (parent RLS off): %', i.obj, _bad; END IF;
  END LOOP;
END $$;
\echo 'PASS: business_verifications and paige_approval_comments hold on their own, with their parent table''s RLS switched off'

CREATE TABLE proof.mutants (obj text, failing text[]);
DO $$ DECLARE m record; _fail text[]; _e proof.partial_edit; _def text; BEGIN
  FOR m IN SELECT obj, ddl FROM proof.baseline UNION ALL SELECT obj, ddl FROM proof.partial ORDER BY 1 LOOP
    IF m.obj = 'fn:_assert_billing_admin' THEN CONTINUE; END IF; -- unchanged by the migration
    SELECT * INTO _e FROM proof.partial_edit WHERE obj = m.obj;
    BEGIN
      IF _e.obj IS NOT NULL THEN
        _def := pg_get_functiondef(_e.fn::regprocedure);
        IF (length(_def) - length(replace(_def, _e.old, ''))) / length(_e.old) <> 1 THEN
          RAISE EXCEPTION 'FAIL: partial % edit does not match the migrated body exactly once', m.obj;
        END IF;
        EXECUTE replace(_def, _e.old, _e.new);
      ELSE
        EXECUTE m.ddl;
      END IF;
      IF EXISTS (SELECT 1 FROM proof.isolate WHERE obj = m.obj) THEN
        EXECUTE format('ALTER TABLE %s DISABLE ROW LEVEL SECURITY', (SELECT parent FROM proof.isolate WHERE obj = m.obj));
      END IF;
      SELECT array_agg(e.id ORDER BY e.id) INTO _fail FROM proof.eval_all() e WHERE NOT e.ok;
      RAISE EXCEPTION USING ERRCODE = 'PX002', MESSAGE = 'undo';
    EXCEPTION WHEN SQLSTATE 'PX002' THEN NULL;
    END;
    INSERT INTO proof.mutants VALUES (m.obj, coalesce(_fail, '{}'));
  END LOOP;
END $$;
\set QUIET off
\echo ''
\echo '── PHASE 3, mutants: each object''s production definition restored alone; the checks that then fail ──'
SELECT obj AS mutant, cardinality(failing) AS failing_checks, array_to_string(failing, ' | ') AS which FROM proof.mutants ORDER BY obj;
\set QUIET on
DO $$ DECLARE _bad text; BEGIN
  SELECT string_agg(obj, ', ') INTO _bad FROM proof.mutants WHERE cardinality(failing) = 0;
  IF _bad IS NOT NULL THEN RAISE EXCEPTION 'FAIL: these mutants survive (no check notices them): %', _bad; END IF;
  -- Each mutant of a changed object must at least fail that object's own hole checks.
  SELECT string_agg(m.obj || ' misses ' || c.id, E'\n') INTO _bad FROM proof.mutants m JOIN proof.checks c ON c.obj = m.obj AND c.kind = 'hole'
   WHERE NOT (c.id = ANY (m.failing));
  IF _bad IS NOT NULL THEN RAISE EXCEPTION E'FAIL: a mutant does not fail its own hole checks:\n%', _bad; END IF;
END $$;
\echo 'PASS: every mutant is killed; restoring any one object''s production definition reopens at least every hole its own checks name (an isolated child mutant also fails its parent''s checks, because the parent''s RLS is off there)'

SELECT format('PASS counts: %s checks; production %s pass / %s fail (hole fails expected: %s); migrated %s pass / 0 fail; %s mutants killed',
  (SELECT count(*) FROM proof.checks),
  (SELECT count(*) FILTER (WHERE ok) FROM proof.results WHERE phase = 'production'),
  (SELECT count(*) FILTER (WHERE NOT ok) FROM proof.results WHERE phase = 'production'),
  (SELECT count(*) FROM proof.checks WHERE kind IN ('hole','widen')),
  (SELECT count(*) FILTER (WHERE ok) FROM proof.results WHERE phase = 'migrated'),
  (SELECT count(*) FROM proof.mutants)) AS summary \gset
\echo :summary

\c postgres
DROP DATABASE admin_scope_stage0_proof;
\echo 'PASS: admin scope stage 0 proof complete; disposable database dropped'
