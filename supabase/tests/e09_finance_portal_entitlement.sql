-- E09 F2: the customer's portal read carries its business's finance entitlement (20271111040000).
-- Full replayed schema, real caller roles, synthetic data only (§63: Northwind Studio, Jordan Rivera);
-- all rolled back.
--
-- Proves:
--   1. get_client_portal_config().entitlements.finance is the business's _tenant_finance_entitled:
--      true for a customer of an entitled business, false for a customer of a business that is not.
--   2. A business cannot shadow it: a stored portal_config.entitlements is overwritten by the server's.
--   3. The rest of the read is unchanged (_catalog, stored overlay), and a person with no open
--      relationship still gets '{}' (no entitlements key at all).
--   4. The customer frame (client_portal_frame) carries the same answer in its config.
--   5. A business provisioned through the real front door (provision_tenant_as) is not entitled, and its
--      customer's read says entitlements.finance = false.
--   7. §70 — the Getting Started "Upload Your First Document" step can tick: the customer's own upload through
--      the real portal upload RPCs makes the checklist's exact count read go from 0 to 1, as that customer.
--   6. Drift: get_paige_persona_context is unchanged (source pinned), its funding expression is the
--      canonical one in text, and it answers the same as _tenant_finance_entitled for each business.
BEGIN;
SELECT plan(17);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('f2a00100-0000-4000-8000-0000000000a1','authenticated','authenticated','f2-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('f2a00100-0000-4000-8000-0000000000b1','authenticated','authenticated','f2-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('f2a00100-0000-4000-8000-0000000000a2','authenticated','authenticated','f2-customer-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('f2a00100-0000-4000-8000-0000000000b2','authenticated','authenticated','f2-customer-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('f2a00100-0000-4000-8000-0000000000c1','authenticated','authenticated','f2-fresh-owner@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('f2a00100-0000-4000-8000-0000000000c2','authenticated','authenticated','f2-fresh-customer@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('f2a00100-0000-4000-8000-0000000000d9','authenticated','authenticated','f2-nobody@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');

-- A: not entitled, and its stored portal_config tries to claim the entitlement. B: entitled (flag leg,
-- written as the table owner: the service path, which the F1a flag guard allows).
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,features) VALUES
 ('f2a00200-0000-4000-8000-00000000000a','test-tenant-f2-a','Northwind Studio','active','standalone',NULL,
  '{"portal_config":{"entitlements":{"finance":true},"welcome":{"headline":"Hello from Northwind"}}}'),
 ('f2a00200-0000-4000-8000-00000000000b','test-tenant-f2-b','Harbor Lane Advisors','active','standalone',NULL,'{"finance_in_scope": true}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('f2a00200-0000-4000-8000-00000000000a','f2a00100-0000-4000-8000-0000000000a1','owner','active',true,now()),
 ('f2a00200-0000-4000-8000-00000000000b','f2a00100-0000-4000-8000-0000000000b1','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='f2a00200-0000-4000-8000-00000000000a' WHERE user_id='f2a00100-0000-4000-8000-0000000000a1';
UPDATE public.profiles SET active_tenant_id='f2a00200-0000-4000-8000-00000000000b' WHERE user_id='f2a00100-0000-4000-8000-0000000000b1';
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('f2a00300-0000-4000-8000-0000000000a2','f2a00200-0000-4000-8000-00000000000a','f2a00100-0000-4000-8000-0000000000a2','f2a00100-0000-4000-8000-0000000000a1','Jordan','Rivera','active'),
 ('f2a00300-0000-4000-8000-0000000000b2','f2a00200-0000-4000-8000-00000000000b','f2a00100-0000-4000-8000-0000000000b2','f2a00100-0000-4000-8000-0000000000b1','Casey','Morgan','active');

CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.cfg(_actor text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user(_actor::uuid, 'SELECT public.get_client_portal_config()') $$;

-- ── 1. The entitlement, per business ────────────────────────────────────────────────────────────
SELECT is(pg_temp.cfg('f2a00100-0000-4000-8000-0000000000b2')->'entitlements', '{"finance": true}'::jsonb,
  'a customer of an entitled business reads entitlements.finance = true');
SELECT is(pg_temp.cfg('f2a00100-0000-4000-8000-0000000000a2')->'entitlements', '{"finance": false}'::jsonb,
  'a customer of a business that is not entitled reads entitlements.finance = false');

-- ── 2. The business cannot shadow it ────────────────────────────────────────────────────────────
SELECT is(public._tenant_finance_entitled('f2a00200-0000-4000-8000-00000000000a'), false,
  'Northwind is not entitled, although its stored portal_config claims it is');
-- (assertion 2 above already shows the stored claim lost; this pins that it is the LAST key's answer)
SELECT is((SELECT count(*)::int FROM jsonb_object_keys(pg_temp.cfg('f2a00100-0000-4000-8000-0000000000a2')) k WHERE k='entitlements'), 1,
  'exactly one entitlements key, the server''s');

-- ── 3. The rest of the read is unchanged ────────────────────────────────────────────────────────
SELECT is(pg_temp.cfg('f2a00100-0000-4000-8000-0000000000a2')->'welcome', '{"headline":"Hello from Northwind"}'::jsonb,
  'the stored overlay still reaches the customer');
SELECT is(pg_temp.cfg('f2a00100-0000-4000-8000-0000000000a2')->'_catalog',
  public.portal_menu_catalog((SELECT features FROM public.tenants WHERE id='f2a00200-0000-4000-8000-00000000000a')),
  'the server _catalog is unchanged');
SELECT is(pg_temp.cfg('f2a00100-0000-4000-8000-0000000000d9'), '{}'::jsonb,
  'a person with no open relationship still reads {} (no entitlements, no catalog)');
SELECT is(pg_temp.cfg('f2a00100-0000-4000-8000-0000000000a1'), '{}'::jsonb,
  'the business owner (not a customer) also reads {}: staff use current_tenant_finance_entitled instead');

-- ── 4. The customer frame carries the same answer ───────────────────────────────────────────────
SELECT is(pg_temp.as_user('f2a00100-0000-4000-8000-0000000000b2', 'SELECT public.client_portal_frame()')#>'{config,entitlements,finance}',
  'true'::jsonb, 'the frame of a customer of an entitled business says finance = true');
SELECT is(pg_temp.as_user('f2a00100-0000-4000-8000-0000000000a2', 'SELECT public.client_portal_frame()')#>'{config,entitlements,finance}',
  'false'::jsonb, 'the frame of a customer of a business that is not entitled says finance = false');

-- ── 5. A business provisioned through the real front door is not entitled ──────────────────────
-- provision_tenant_as is the service-role front door (platform-subscription-checkout, stripe-webhook).
DO $$ BEGIN
  SET LOCAL ROLE service_role;
  PERFORM public.provision_tenant_as('f2a00100-0000-4000-8000-0000000000c1', 'Fresh Solo Studio', 'standalone', NULL, NULL, NULL,
    (SELECT slug FROM public.legal_documents WHERE is_current ORDER BY slug LIMIT 1),
    (SELECT version FROM public.legal_documents WHERE is_current ORDER BY slug LIMIT 1));
  RESET ROLE;
END $$;
INSERT INTO public.clients(tenant_id,linked_user_id,created_by,first_name,last_name,status)
SELECT t.id,'f2a00100-0000-4000-8000-0000000000c2','f2a00100-0000-4000-8000-0000000000c1','Avery','Lane','active'
  FROM public.tenants t WHERE t.owner_user_id='f2a00100-0000-4000-8000-0000000000c1';
SELECT is(public._tenant_finance_entitled((SELECT id FROM public.tenants WHERE owner_user_id='f2a00100-0000-4000-8000-0000000000c1')), false,
  'a freshly provisioned Solo business is not finance-entitled');
SELECT is(pg_temp.cfg('f2a00100-0000-4000-8000-0000000000c2')->'entitlements', '{"finance": false}'::jsonb,
  '...and its customer''s portal read says entitlements.finance = false');

-- ── 6. Drift: the persona is not replaced, and it is the canonical expression ───────────────────
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.get_paige_persona_context()')),
  '866d4e907c3cd8f2c30a6ef012821352',
  'get_paige_persona_context is the source F1a pinned (production read 2026-10-19); re-pin only with _tenant_finance_entitled');
SELECT ok((SELECT prosrc FROM pg_proc WHERE oid=to_regprocedure('public.get_paige_persona_context()'))
  ~ 'mi\.status = ''active'' and it\.is_finance = true\s*\)\s*or \(t\.features ->> ''finance_in_scope''\)::boolean',
  'the persona''s funding_enabled is the install-OR-flag expression _tenant_finance_entitled holds');

-- ── 7. §70: the Getting Started document step can tick ──────────────────────────────────────────
-- The checklist's exact read (OnboardingChecklist upload_document), run as the customer.
CREATE FUNCTION pg_temp.checklist_count() RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user('f2a00100-0000-4000-8000-0000000000a2', $q$SELECT to_jsonb(count(*)::int) FROM public.client_files
   WHERE tenant_id='f2a00200-0000-4000-8000-00000000000a' AND contact_id='f2a00300-0000-4000-8000-0000000000a2'
     AND uploaded_by_user_id='f2a00100-0000-4000-8000-0000000000a2' AND upload_state='ready'$q$) $$;
SELECT is(pg_temp.checklist_count(), '0'::jsonb, 'before any upload the step is open');
-- The customer's own upload, through the real portal RPCs and the storage policy, as /app/documents does it.
SELECT is(pg_temp.as_user('f2a00100-0000-4000-8000-0000000000a2', $q$SELECT to_jsonb(public.client_portal_begin_file_upload(
  'f2a00400-0000-4000-8000-000000000001','f2a00300-0000-4000-8000-0000000000a2','intake.pdf','application/pdf',12,
  'f2a00200-0000-4000-8000-00000000000a')->>'upload_state')$q$), '"pending"'::jsonb, 'the customer reserves an upload in their Documents');
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"f2a00100-0000-4000-8000-0000000000a2","role":"authenticated"}',true);
  SET LOCAL ROLE authenticated;
  INSERT INTO storage.objects(bucket_id,name,owner,owner_id,metadata) VALUES ('client-files',
    'f2a00200-0000-4000-8000-00000000000a/f2a00300-0000-4000-8000-0000000000a2/client_upload/f2a00100-0000-4000-8000-0000000000a2/f2a00400-0000-4000-8000-000000000001',
    'f2a00100-0000-4000-8000-0000000000a2','f2a00100-0000-4000-8000-0000000000a2','{"size":12,"mimetype":"application/pdf"}');
  PERFORM public.client_portal_finish_file_upload('f2a00400-0000-4000-8000-000000000001','f2a00200-0000-4000-8000-00000000000a');
  RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
END $$;
SELECT is(pg_temp.checklist_count(), '1'::jsonb, 'after the customer''s upload is saved, the step''s count is 1: it ticks');

SELECT * FROM finish();
ROLLBACK;
