-- Disposable database only. Synthetic workspaces and credentials; never run against tenant data.
BEGIN;
INSERT INTO auth.users(id,email) VALUES
 ('20000000-0000-4000-8000-000000000001','owner-sync@example.test'),
 ('20000000-0000-4000-8000-000000000002','other-sync@example.test');
INSERT INTO public.tenants(id,slug,name,status,account_type) VALUES
 ('20000000-0000-4000-8000-000000000011','test-tenant-sync-a','Test sync A','active','standalone'),
 ('20000000-0000-4000-8000-000000000012','test-tenant-sync-b','Test sync B','active','standalone');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','owner','active',true),
 ('20000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000002','owner','active',true);
-- Production creates a profile at signup. Keep that existing-row shape so switching
-- exercises the canonical UPDATE membership guard in both local and Linux proof.
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000011')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
SET LOCAL request.jwt.claims='{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
CREATE TEMP TABLE sync_proof(connection_id uuid);
GRANT ALL ON sync_proof TO authenticated,service_role;
SET LOCAL ROLE authenticated;
INSERT INTO sync_proof SELECT (public.create_mcp_inbound_connection('Test incoming contacts')->>'connection_id')::uuid;
DO $$ DECLARE c uuid; r jsonb; BEGIN
 SELECT connection_id INTO c FROM sync_proof;
 r := public.get_mcp_contact_sync(c);
 IF r->>'enabled' <> 'false' OR r->>'credential_configured' <> 'false' THEN
   RAISE EXCEPTION 'new connection silently grants incoming write access'; END IF;
 r := public.set_mcp_contact_sync(c,true,'test-incoming-secret-not-a-real-credential',0);
 IF r->>'enabled' <> 'true' OR r->>'generation' <> '1' OR position('secret' IN r::text)>0 THEN
   RAISE EXCEPTION 'grant not persisted or secret leaked'; END IF;
END $$;
RESET ROLE;
-- Assert error classes without accepting a test's own failure exception.
CREATE FUNCTION pg_temp.expect_sync_error(command text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=expected THEN RETURN; END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'expected SQLSTATE % was not raised',expected;
END $$;
DO $$ DECLARE c uuid; h text; BEGIN
 SELECT connection_id INTO c FROM sync_proof;
 SELECT inbound_contact_secret_hash INTO h FROM public.mcp_connections WHERE connection_id=c;
 IF h='test-incoming-secret-not-a-real-credential' OR length(h)<>64 THEN RAISE EXCEPTION 'credential is not hash-only'; END IF;
 PERFORM pg_temp.expect_sync_error(format('SELECT public.set_mcp_contact_sync(%L,true,%L,1)',c,'short'),'22023');
 PERFORM pg_temp.expect_sync_error(format('SELECT public.set_mcp_contact_sync(%L,false,NULL,0)',c),'22023');
 IF (SELECT inbound_contact_secret_hash<>h OR inbound_contact_generation<>1 FROM public.mcp_connections WHERE connection_id=c) THEN
   RAISE EXCEPTION 'rejected save altered active configuration'; END IF;
 PERFORM set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 PERFORM pg_temp.expect_sync_error(format('SELECT public.get_mcp_contact_sync(%L)',c),'42501');
 PERFORM pg_temp.expect_sync_error(format('SELECT public.set_mcp_contact_sync(%L,false,NULL,1)',c),'42501');
 PERFORM set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
END $$;
-- A workspace switch must first have real membership; do not disable or bypass
-- the guard to manufacture the account-switch state used by the ingestion proof.
SELECT pg_temp.expect_sync_error(
 'UPDATE public.profiles SET active_tenant_id=''20000000-0000-4000-8000-000000000012'' WHERE user_id=''20000000-0000-4000-8000-000000000001''',
 '42501');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('20000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000001','member','active',false);
UPDATE public.profiles SET active_tenant_id='20000000-0000-4000-8000-000000000012'
 WHERE user_id='20000000-0000-4000-8000-000000000001';
DO $$ BEGIN
 IF public.current_user_tenant_id() IS DISTINCT FROM '20000000-0000-4000-8000-000000000012'::uuid THEN
   RAISE EXCEPTION 'account switch setup is not real resolver state'; END IF;
END $$;
CREATE TEMP TABLE sync_results(result jsonb);
GRANT ALL ON sync_results TO authenticated,service_role;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
SET LOCAL ROLE service_role;
INSERT INTO sync_results SELECT public.sync_mcp_connection_contact(
 (SELECT connection_id FROM sync_proof),'test-incoming-secret-not-a-real-credential',1,
 '20000000-0000-4000-8000-000000000101','external-contact-a','2026-09-01T12:00:00Z',
 '{"email":"contact-sync@example.test","first_name":"Test","last_name":"Contact","phone":"+1 555 010 0101","assigned_to_email":"owner-sync@example.test"}');
RESET ROLE;
INSERT INTO public.user_roles(user_id,role) VALUES('20000000-0000-4000-8000-000000000001','admin') ON CONFLICT DO NOTHING;
-- The owner's canonical assignment policy works in the owning business, not the currently open other business.
SET LOCAL request.jwt.claims='{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.paige_coach_assignments WHERE contact_id=(SELECT (result->>'client_id')::uuid FROM sync_results)) THEN
   RAISE EXCEPTION 'assignment visible through other active business'; END IF;
END $$;
RESET ROLE;
UPDATE public.profiles SET active_tenant_id='20000000-0000-4000-8000-000000000011' WHERE user_id='20000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 UPDATE public.paige_coach_assignments SET active=true WHERE contact_id=(SELECT (result->>'client_id')::uuid FROM sync_results);
 IF NOT FOUND THEN RAISE EXCEPTION 'owning tenant admin cannot manage committed assignment'; END IF;
END $$;
RESET ROLE;
SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $$ DECLARE c uuid; client uuid; r jsonb; p jsonb;
BEGIN
 SELECT connection_id INTO c FROM sync_proof;
 SELECT result INTO r FROM sync_results; client := (r->>'client_id')::uuid;
 IF r->>'action'<>'created' OR r->>'replayed'<>'false' THEN RAISE EXCEPTION 'missing committed create'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.clients WHERE id=client AND tenant_id='20000000-0000-4000-8000-000000000011') THEN
   RAISE EXCEPTION 'sync followed open workspace rather than connection'; END IF;
 IF (SELECT count(*) FROM public.client_contact_methods WHERE client_id=client)<>2
   OR (SELECT count(*) FROM public.paige_coach_assignments WHERE contact_id=client AND active
     AND tenant_id='20000000-0000-4000-8000-000000000011')<>1 THEN
   RAISE EXCEPTION 'contact/address/assignment not committed together'; END IF;
 IF (SELECT server_url_ct IS NOT NULL FROM public.mcp_connections WHERE connection_id=c) THEN
   RAISE EXCEPTION 'incoming-only connection invented an endpoint'; END IF;
 p := '{"email":"contact-sync@example.test","first_name":"Test","last_name":"Contact","phone":"+1 555 010 0101","assigned_to_email":"owner-sync@example.test"}';
 r := public.sync_mcp_connection_contact(c,'test-incoming-secret-not-a-real-credential',1,
   '20000000-0000-4000-8000-000000000101',' external-contact-a ','2026-09-01T12:00:00Z',p);
 IF r->>'replayed'<>'true' OR (SELECT count(*) FROM public.mcp_connection_contacts WHERE connection_id=c)<>1 THEN
   RAISE EXCEPTION 'retry or whitespace alias caused duplicate write'; END IF;
 PERFORM pg_temp.expect_sync_error(format('SELECT public.sync_mcp_connection_contact(%L,%L,1,%L,%L,%L,%L)',
   c,'test-incoming-secret-not-a-real-credential','20000000-0000-4000-8000-000000000101','external-contact-a',
   '2026-09-01T12:00:00Z',p||'{"first_name":"Changed replay"}'),'22023');
 -- Preserve manually added secondary addresses; promote new source address/phone rather than replace the list.
 PERFORM public._add_client_contact_methods('20000000-0000-4000-8000-000000000011',client,
   '[{"kind":"email","value":"secondary-sync@example.test"},{"kind":"phone","value":"5550100202"}]');
 r := public.sync_mcp_connection_contact(c,'test-incoming-secret-not-a-real-credential',1,
   '20000000-0000-4000-8000-000000000102','external-contact-a','2026-09-01T13:00:00Z',
   p||'{"email":"changed-sync@example.test","phone":"5550100303","first_name":"Updated"}');
 IF r->>'client_id'<>client::text OR r->>'action'<>'updated'
   OR (SELECT count(*) FROM public.client_contact_methods WHERE client_id=client)<>6
   OR (SELECT count(*) FROM public.paige_coach_assignments WHERE contact_id=client AND active)<>1 THEN
   RAISE EXCEPTION 'external identity or secondary address/assignment preservation failed'; END IF;
 -- Canonical email matching includes secondary addresses; it cannot search another business.
 r := public.sync_mcp_connection_contact(c,'test-incoming-secret-not-a-real-credential',1,
   '20000000-0000-4000-8000-000000000103','external-contact-alias','2026-09-01T14:00:00Z',
   '{"email":"secondary-sync@example.test","phone":"12","first_name":"Alias"}');
 IF r->>'client_id'<>client::text OR r->>'phone_not_saved'<>'not a usable phone number'
   OR EXISTS(SELECT 1 FROM public.client_contact_methods WHERE client_id=client AND value='12') THEN
   RAISE EXCEPTION 'same-tenant email match or explicit optional-phone warning regressed'; END IF;
 r := public.sync_mcp_connection_contact(c,'test-incoming-secret-not-a-real-credential',1,
   '20000000-0000-4000-8000-000000000107','external-contact-a','2026-09-01T15:00:00Z',
   '{"email":"changed-sync@example.test"}');
 IF (SELECT first_name IS DISTINCT FROM 'Alias' OR last_name IS DISTINCT FROM 'Contact' FROM public.clients WHERE id=client) THEN
   RAISE EXCEPTION 'partial source update erased existing names'; END IF;
 PERFORM pg_temp.expect_sync_error(format('SELECT public.sync_mcp_connection_contact(%L,%L,1,%L,%L,%L,%L)',
   c,'test-incoming-secret-not-a-real-credential','20000000-0000-4000-8000-000000000104','external-contact-a',
   '2026-09-01T11:00:00Z',p),'22023');
 PERFORM pg_temp.expect_sync_error(format('SELECT public.sync_mcp_connection_contact(%L,%L,1,%L,%L,%L,%L)',
   c,'test-wrong-secret-not-a-real-credential','20000000-0000-4000-8000-000000000104','external-contact-new',
   '2026-09-01T15:00:00Z',p),'42501');
 PERFORM pg_temp.expect_sync_error(format('SELECT public.sync_mcp_connection_contact(%L,%L,1,%L,%L,%L,%L)',
   c,'test-incoming-secret-not-a-real-credential','20000000-0000-4000-8000-000000000104','external-contact-new',
   '2026-09-01T15:00:00Z',p||'{"assigned_to_email":"other-sync@example.test"}'),'42501');
 PERFORM pg_temp.expect_sync_error(format('INSERT INTO public.mcp_connection_contacts(connection_id,tenant_id,external_id,client_id,source_updated_at,payload_hash) VALUES(%L,%L,%L,%L,now(),%L)',
   c,'20000000-0000-4000-8000-000000000012','wrong-business',client,'test-hash'),'23503');
 PERFORM pg_temp.expect_sync_error(format('UPDATE public.mcp_connections SET tenant_id=%L WHERE connection_id=%L',
   '20000000-0000-4000-8000-000000000012',c),'22023');
 IF EXISTS(SELECT 1 FROM public.mcp_connection_receipts WHERE connection_id=c
   AND (detail::text LIKE '%contact-sync@%' OR detail::text LIKE '%secret%' OR detail::text LIKE '%555010%')) THEN
   RAISE EXCEPTION 'receipt exposed contact payload or credential'; END IF;
END $$;

-- Force a late assignment failure: contact and address inserts must be rolled back too.
CREATE FUNCTION pg_temp.refuse_sync_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'test assignment failure' USING ERRCODE='23514'; END $$;
CREATE TRIGGER test_refuse_sync_assignment BEFORE INSERT OR UPDATE ON public.paige_coach_assignments
 FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_sync_assignment();
DO $$ DECLARE c uuid; before_count integer; BEGIN
 SELECT connection_id INTO c FROM sync_proof;
 SELECT count(*) INTO before_count FROM public.clients;
 PERFORM pg_temp.expect_sync_error(format('SELECT public.sync_mcp_connection_contact(%L,%L,1,%L,%L,%L,%L)',
   c,'test-incoming-secret-not-a-real-credential','20000000-0000-4000-8000-000000000105','rollback-contact',
   '2026-09-01T15:00:00Z','{"email":"rollback-sync@example.test","assigned_to_email":"owner-sync@example.test"}'),'23514');
 IF (SELECT count(*) FROM public.clients)<>before_count OR EXISTS(SELECT 1 FROM public.client_contact_methods WHERE value='rollback-sync@example.test')
   OR EXISTS(SELECT 1 FROM public.mcp_connection_contacts WHERE connection_id=c AND external_id='rollback-contact')
   OR EXISTS(SELECT 1 FROM public.mcp_connection_receipts WHERE connection_id=c AND run_id='20000000-0000-4000-8000-000000000105') THEN
   RAISE EXCEPTION 'failed transaction left partial data or success receipt'; END IF;
END $$;
DROP TRIGGER test_refuse_sync_assignment ON public.paige_coach_assignments;

-- Same email and external ID in a different connection/business must not resolve the first client.
DO $$ DECLARE c uuid; r jsonb; first_client uuid; BEGIN
 SELECT (result->>'client_id')::uuid INTO first_client FROM sync_results;
 PERFORM set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
 c := (public.create_mcp_inbound_connection('Test incoming other')->>'connection_id')::uuid;
 PERFORM public.set_mcp_contact_sync(c,true,'test-other-incoming-secret-not-a-real-credential',0);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 r := public.sync_mcp_connection_contact(c,'test-other-incoming-secret-not-a-real-credential',1,
   '20000000-0000-4000-8000-000000000101','external-contact-a','2026-09-01T12:00:00Z','{"email":"contact-sync@example.test"}');
 IF r->>'client_id'=first_client::text OR NOT EXISTS(SELECT 1 FROM public.clients
   WHERE id=(r->>'client_id')::uuid AND tenant_id='20000000-0000-4000-8000-000000000012') THEN
   RAISE EXCEPTION 'external identity or email escaped fixed business'; END IF;
END $$;

-- Browser cannot invoke the service writer. Grantor membership is revalidated on every event.
DO $$ DECLARE c uuid; command text; BEGIN
 SELECT connection_id INTO c FROM sync_proof;
 command := format('SELECT public.sync_mcp_connection_contact(%L,%L,1,%L,%L,%L,%L)',c,
   'test-incoming-secret-not-a-real-credential','20000000-0000-4000-8000-000000000106','denied-contact',
   '2026-09-01T15:00:00Z','{"email":"denied-sync@example.test"}');
 IF has_function_privilege('authenticated','public.sync_mcp_connection_contact(uuid,text,bigint,uuid,text,timestamptz,jsonb)','EXECUTE')
   OR has_function_privilege('anon','public.sync_mcp_connection_contact(uuid,text,bigint,uuid,text,timestamptz,jsonb)','EXECUTE') THEN
   RAISE EXCEPTION 'untrusted role can invoke service writer'; END IF;
 UPDATE public.tenant_members SET status='inactive' WHERE user_id='20000000-0000-4000-8000-000000000001';
 PERFORM pg_temp.expect_sync_error(command,'42501');
 UPDATE public.tenant_members SET status='active' WHERE user_id='20000000-0000-4000-8000-000000000001';
 UPDATE public.tenant_members SET role='member',is_owner=false WHERE user_id='20000000-0000-4000-8000-000000000001';
 PERFORM pg_temp.expect_sync_error(command,'42501');
 UPDATE public.tenant_members SET role='owner',is_owner=true WHERE user_id='20000000-0000-4000-8000-000000000001';
 UPDATE public.mcp_connections SET enabled=false WHERE connection_id=c;
 PERFORM pg_temp.expect_sync_error(command,'42501');
 UPDATE public.mcp_connections SET enabled=true WHERE connection_id=c;
 PERFORM pg_temp.expect_sync_error(command,'42501');
 IF (SELECT inbound_contact_secret_hash IS NOT NULL OR inbound_contacts_enabled FROM public.mcp_connections WHERE connection_id=c) THEN
   RAISE EXCEPTION 'disconnect/reconnect revived incoming credential'; END IF;
END $$;
ROLLBACK;
