-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- Email series (E3) — fixture for the rollback proofs below. DISPOSABLE PREVIEW DATABASE ONLY.
--
-- Creates one throwaway user and business (owner membership, active business, postal address) on a
-- Supabase preview branch that has migrations through 20270580000000. Never run it on production:
-- it writes rows that are not rolled back. The proofs read the two fixed ids it creates.
-- Proofs: scripts/sql/email-series-proof.sql (every series path) and
--         scripts/sql/email-series-isolation-proof.sql (the review fixes).
-- ─────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES ('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','series-proof@example.invalid','',now(),now(),now(),'{}','{}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenants (id, slug, name, account_number_prefix, account_number, status)
VALUES ('22222222-2222-4222-8222-222222222222','series-proof','Series Proof Co','SP',990001,'active') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.tenant_members (tenant_id, user_id, role, status) VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','owner','active') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
INSERT INTO public.tenant_legal_profile (tenant_id, legal_business_name, registered_address) VALUES ('22222222-2222-4222-8222-222222222222','Series Proof Co','1 Main St, Austin, TX 78701') ON CONFLICT DO NOTHING;
SELECT (SELECT count(*) FROM public.tenant_members WHERE tenant_id='22222222-2222-4222-8222-222222222222') members,
       (SELECT active_tenant_id FROM public.profiles WHERE user_id='11111111-1111-4111-8111-111111111111') active,
       public._email_postal_address('22222222-2222-4222-8222-222222222222') postal,
       public._email_resolve_sender('22222222-2222-4222-8222-222222222222','{"mode":"managed"}') sender;
