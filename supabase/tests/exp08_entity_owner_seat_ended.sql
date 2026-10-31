-- Original EXP08 co-owner contract I2/R6/R11 component proof, DISPOSABLE DATABASE ONLY.
-- The runner creates an empty local database; this file never targets a linked project.
-- REAL: the candidate trigger/function, I1 composite FK, owner-only CHECK and unique entity seat.
-- DOUBLES: minimal table shapes, Auth/platform/company inputs and direct seat writes.
-- The runner separately loads the REAL original revoke/owner/holder functions for its second
-- fixture; no Auth SDK, RLS, billing, production account or customer proof is claimed.
CREATE SCHEMA proof;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TYPE public.tenant_role AS ENUM ('owner','admin','member');
CREATE TABLE public.tenants (id uuid PRIMARY KEY,account_type text NOT NULL,company boolean NOT NULL DEFAULT false,owner_user_id uuid,parent_tenant_id uuid);
-- Auth/platform ports only; the runner loads the REAL original owner/holder/revoke functions.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;
CREATE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_platform_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.paige_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid,
 actor_role text,action text,target_type text,target_id uuid,payload jsonb,tenant_id uuid);
CREATE FUNCTION public.is_company_workspace(t uuid) RETURNS boolean LANGUAGE sql AS $$
 SELECT company FROM public.tenants WHERE id=t $$;
CREATE TABLE public.tenant_business_owners (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, owner_kind text NOT NULL,
 representative_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, owner_seat_vacant_since timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(), ownership_status text NOT NULL DEFAULT 'declared',
 legal_name text NOT NULL, UNIQUE(tenant_id,id)
);
CREATE TABLE public.tenant_members (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, user_id uuid NOT NULL,
 is_owner boolean NOT NULL DEFAULT false, business_owner_id uuid, status text NOT NULL DEFAULT 'active',
 job_title text,role public.tenant_role NOT NULL DEFAULT 'owner',updated_at timestamptz DEFAULT now(),team_hub_access boolean NOT NULL DEFAULT true,
 FOREIGN KEY(tenant_id,business_owner_id) REFERENCES public.tenant_business_owners(tenant_id,id),
 CHECK(business_owner_id IS NULL OR is_owner), UNIQUE(tenant_id,user_id)
);
CREATE UNIQUE INDEX tenant_members_one_seat_per_business_owner
 ON public.tenant_members(tenant_id,business_owner_id) WHERE business_owner_id IS NOT NULL;

CREATE FUNCTION proof.reset_rows() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 TRUNCATE public.tenant_members,public.tenant_business_owners,auth.users,public.tenants;
 INSERT INTO public.tenants(id,account_type) VALUES
  ('e8000000-0000-4000-8000-000000060010','standalone'),('e8000000-0000-4000-8000-000000060020','sub_account');
 INSERT INTO auth.users VALUES ('e8000000-0000-4000-8000-000000060100'),
  ('e8000000-0000-4000-8000-000000060200'),('e8000000-0000-4000-8000-000000060300');
 INSERT INTO public.tenant_business_owners(id,tenant_id,owner_kind,representative_user_id,legal_name) VALUES
 ('e8000000-0000-4000-8000-000000060001','e8000000-0000-4000-8000-000000060010','company','e8000000-0000-4000-8000-000000060100','Test entity A'),
 ('e8000000-0000-4000-8000-000000060002','e8000000-0000-4000-8000-000000060020','trust','e8000000-0000-4000-8000-000000060200','Test entity B');
 INSERT INTO public.tenant_members(id,tenant_id,user_id,is_owner,business_owner_id) VALUES
 ('e8000000-0000-4000-8000-000000061001','e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060100',true,'e8000000-0000-4000-8000-000000060001'),
 ('e8000000-0000-4000-8000-000000061002','e8000000-0000-4000-8000-000000060020','e8000000-0000-4000-8000-000000060200',true,'e8000000-0000-4000-8000-000000060002');
END $$;

CREATE FUNCTION proof.assert_true(ok boolean, reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', reason; END IF; END $$;

CREATE FUNCTION proof.run_cases() RETURNS TABLE(case_name text,passed boolean,detail text) LANGUAGE plpgsql AS $$
DECLARE n text; before_other jsonb; before_legal jsonb; after_legal jsonb;
BEGIN
 FOREACH n IN ARRAY ARRAY['delete','demote','unlink','identity_move','billing_pause','billing_resume',
   'work_profile','replacement_preserved','first_vacancy','ordinary_member','foreign_link_refused','other_tenant_unchanged',
   'admin_delete_order','auth_fk_delete_first','auth_only_delete','unseated_contact_delete','living_rep_clear',
   'unsupported_tier_departure','company_workspace_departure','unsupported_tier_auth_delete'] LOOP
  PERFORM proof.reset_rows();
  SELECT to_jsonb(b) INTO before_other FROM public.tenant_business_owners b WHERE id='e8000000-0000-4000-8000-000000060002';
  SELECT to_jsonb(b)-'representative_user_id'-'owner_seat_vacant_since'-'updated_at' INTO before_legal
    FROM public.tenant_business_owners b WHERE id='e8000000-0000-4000-8000-000000060001';
  BEGIN
   CASE n
    WHEN 'delete','other_tenant_unchanged' THEN
     DELETE FROM public.tenant_members WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'demote' THEN
     UPDATE public.tenant_members SET is_owner=false,business_owner_id=NULL WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'unlink' THEN
     UPDATE public.tenant_members SET business_owner_id=NULL WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'identity_move' THEN
     UPDATE public.tenant_members SET user_id='e8000000-0000-4000-8000-000000060300' WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'admin_delete_order' THEN
     DELETE FROM public.tenant_members WHERE id='e8000000-0000-4000-8000-000000061001';
     DELETE FROM auth.users WHERE id='e8000000-0000-4000-8000-000000060100';
    WHEN 'auth_fk_delete_first' THEN
     DELETE FROM auth.users WHERE id='e8000000-0000-4000-8000-000000060100';
     DELETE FROM public.tenant_members WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'auth_only_delete' THEN
     DELETE FROM auth.users WHERE id='e8000000-0000-4000-8000-000000060100';
    WHEN 'unseated_contact_delete' THEN
     INSERT INTO public.tenant_business_owners(id,tenant_id,owner_kind,representative_user_id,legal_name)
       VALUES ('e8000000-0000-4000-8000-000000060003','e8000000-0000-4000-8000-000000060020',
        'company','e8000000-0000-4000-8000-000000060300','Test unseated contact');
     DELETE FROM auth.users WHERE id='e8000000-0000-4000-8000-000000060300';
     PERFORM proof.assert_true((SELECT representative_user_id IS NULL AND owner_seat_vacant_since IS NULL
       FROM public.tenant_business_owners WHERE id='e8000000-0000-4000-8000-000000060003'),'unseated contact became an owner seat');
    WHEN 'living_rep_clear' THEN
     -- This remains an original Setup/writer permission concern; this component must not
     -- misclassify a living person's ordinary reference edit as an Auth deletion.
     UPDATE public.tenant_business_owners SET representative_user_id=NULL WHERE id='e8000000-0000-4000-8000-000000060001';
    WHEN 'unsupported_tier_departure' THEN
     UPDATE public.tenants SET account_type='agency' WHERE id='e8000000-0000-4000-8000-000000060010';
     DELETE FROM public.tenant_members WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'company_workspace_departure' THEN
     UPDATE public.tenants SET company=true WHERE id='e8000000-0000-4000-8000-000000060010';
     DELETE FROM public.tenant_members WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'unsupported_tier_auth_delete' THEN
     UPDATE public.tenants SET account_type='enterprise' WHERE id='e8000000-0000-4000-8000-000000060010';
     DELETE FROM auth.users WHERE id='e8000000-0000-4000-8000-000000060100';
    WHEN 'billing_pause' THEN
     UPDATE public.tenant_members SET status='suspended' WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'billing_resume' THEN
     UPDATE public.tenant_members SET status='suspended' WHERE id='e8000000-0000-4000-8000-000000061001';
     UPDATE public.tenant_members SET status='active' WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'work_profile' THEN
     UPDATE public.tenant_members SET job_title='Test role' WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'replacement_preserved' THEN
     -- Explicit race port: the original writer has already recorded a different representative.
     UPDATE public.tenant_business_owners SET representative_user_id='e8000000-0000-4000-8000-000000060300'
       WHERE id='e8000000-0000-4000-8000-000000060001';
     DELETE FROM public.tenant_members WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'first_vacancy' THEN
     UPDATE public.tenant_business_owners SET owner_seat_vacant_since='2026-01-01T00:00:00Z'
       WHERE id='e8000000-0000-4000-8000-000000060001';
     DELETE FROM public.tenant_members WHERE id='e8000000-0000-4000-8000-000000061001';
    WHEN 'ordinary_member' THEN
     INSERT INTO public.tenant_members VALUES ('e8000000-0000-4000-8000-000000061003',
       'e8000000-0000-4000-8000-000000060010','e8000000-0000-4000-8000-000000060300',false,NULL,'active',NULL);
     DELETE FROM public.tenant_members WHERE id='e8000000-0000-4000-8000-000000061003';
    WHEN 'foreign_link_refused' THEN
     BEGIN
      UPDATE public.tenant_members SET business_owner_id='e8000000-0000-4000-8000-000000060002'
        WHERE id='e8000000-0000-4000-8000-000000061001';
      RAISE EXCEPTION 'foreign entity link unexpectedly accepted';
     EXCEPTION WHEN foreign_key_violation THEN NULL; END;
   END CASE;
   IF n IN ('delete','demote','unlink','identity_move','first_vacancy','other_tenant_unchanged',
     'admin_delete_order','auth_fk_delete_first','auth_only_delete') THEN
    PERFORM proof.assert_true((SELECT representative_user_id IS NULL AND owner_seat_vacant_since IS NOT NULL
      FROM public.tenant_business_owners WHERE id='e8000000-0000-4000-8000-000000060001'),'ended representative was not held');
   ELSIF n IN ('living_rep_clear','unsupported_tier_auth_delete') THEN
    PERFORM proof.assert_true((SELECT representative_user_id IS NULL AND owner_seat_vacant_since IS NULL
      FROM public.tenant_business_owners WHERE id='e8000000-0000-4000-8000-000000060001'),'living reference edit mistaken for deletion');
   ELSIF n='replacement_preserved' THEN
    PERFORM proof.assert_true((SELECT representative_user_id='e8000000-0000-4000-8000-000000060300'
      AND owner_seat_vacant_since IS NULL FROM public.tenant_business_owners
      WHERE id='e8000000-0000-4000-8000-000000060001'),'late event cleared a replacement');
   ELSE
    PERFORM proof.assert_true((SELECT representative_user_id='e8000000-0000-4000-8000-000000060100'
      AND owner_seat_vacant_since IS NULL FROM public.tenant_business_owners
      WHERE id='e8000000-0000-4000-8000-000000060001'),'unchanged owner representation was cleared');
   END IF;
   IF n='first_vacancy' THEN
    PERFORM proof.assert_true((SELECT owner_seat_vacant_since='2026-01-01T00:00:00Z'
      FROM public.tenant_business_owners WHERE id='e8000000-0000-4000-8000-000000060001'),'first vacancy time overwritten');
   END IF;
   SELECT to_jsonb(b)-'representative_user_id'-'owner_seat_vacant_since'-'updated_at' INTO after_legal
     FROM public.tenant_business_owners b WHERE id='e8000000-0000-4000-8000-000000060001';
   PERFORM proof.assert_true(after_legal=before_legal,'legal ownership facts changed');
   PERFORM proof.assert_true((SELECT to_jsonb(b)=before_other FROM public.tenant_business_owners b
     WHERE id='e8000000-0000-4000-8000-000000060002'),'another tenant entity changed');
   case_name:=n;passed:=true;detail:=NULL;RETURN NEXT;
  EXCEPTION WHEN OTHERS THEN
   case_name:=n;passed:=false;detail:=SQLERRM;RETURN NEXT;
  END;
 END LOOP;
END $$;
