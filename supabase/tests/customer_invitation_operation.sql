-- Existing full-schema database-contract runner; synthetic identities, no provider, all rollback.
BEGIN;
SELECT no_plan();
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) VALUES
 ('e0923300-0000-4000-8000-000000000001','test-tenant-e09-op-a','Test tenant invitation A','active','standalone','E09O',9433001,'{}'),
 ('e0923300-0000-4000-8000-000000000002','test-tenant-e09-op-b','Test tenant invitation B','active','standalone','E09P',9433002,'{}');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0913300-0000-4000-8000-000000000001','authenticated','authenticated','owner-op-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0913300-0000-4000-8000-000000000002','authenticated','authenticated','owner-op-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0923300-0000-4000-8000-000000000001','e0913300-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0923300-0000-4000-8000-000000000002','e0913300-0000-4000-8000-000000000002','owner','active',true,now());
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,status,do_not_contact) VALUES
 ('e0933300-0000-4000-8000-000000000001','e0923300-0000-4000-8000-000000000001','e0913300-0000-4000-8000-000000000001','Test','Customer A','active',false),
 ('e0933300-0000-4000-8000-000000000002','e0923300-0000-4000-8000-000000000002','e0913300-0000-4000-8000-000000000002','Test','Customer B','active',false);
SELECT public._attach_client_address('e0923300-0000-4000-8000-000000000001','e0933300-0000-4000-8000-000000000001','email','customer-op-a@tests.invalid');
SELECT public._attach_client_address('e0923300-0000-4000-8000-000000000002','e0933300-0000-4000-8000-000000000002','email','customer-op-b@tests.invalid');
UPDATE public.client_contact_methods SET is_primary=true WHERE client_id IN('e0933300-0000-4000-8000-000000000001','e0933300-0000-4000-8000-000000000002');

CREATE FUNCTION pg_temp.invite_op(action text,actor uuid DEFAULT 'e0913300-0000-4000-8000-000000000001',
 business uuid DEFAULT 'e0923300-0000-4000-8000-000000000001',customer uuid DEFAULT 'e0933300-0000-4000-8000-000000000001',
 proposal text DEFAULT NULL,operation uuid DEFAULT 'e0943300-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN
  CASE action
   WHEN 'prepare' THEN result:=public.prepare_client_portal_invitation(business,customer);
   WHEN 'create' THEN result:=public.create_client_portal_invitation(business,customer,proposal,operation);
   WHEN 'read' THEN result:=public.read_client_portal_invitation_operation(business,operation);
   ELSE RAISE EXCEPTION 'invalid test action';
  END CASE;
 EXCEPTION WHEN OTHERS THEN result:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 RETURN result;
END $$;
CREATE TEMP TABLE e09_op_fixture AS SELECT pg_temp.invite_op('prepare') AS proposal;
ALTER TABLE e09_op_fixture ADD saved jsonb,ADD before_count bigint;
SELECT is((SELECT proposal->>'recipient' FROM e09_op_fixture),'customer-op-a@tests.invalid','actual owner prepares exact saved recipient');
SELECT is((SELECT count(*)::integer FROM jsonb_object_keys((SELECT proposal FROM e09_op_fixture))),5,'closed preparation projection');
UPDATE e09_op_fixture SET saved=pg_temp.invite_op('create',proposal=>proposal->>'proposal_hash');
SELECT is((SELECT saved->>'state' FROM e09_op_fixture),'prepared','native operation prepares, never reports a send');
SELECT is((SELECT saved->>'replayed' FROM e09_op_fixture),'false','first operation is not replay');
SELECT is((SELECT count(*) FROM public.tenant_invite_tokens WHERE portal_operation_id='e0943300-0000-4000-8000-000000000001'),1::bigint,'one canonical token');
SELECT is((SELECT kind||':'||default_role||':'||max_uses||':'||uses FROM public.tenant_invite_tokens WHERE portal_operation_id='e0943300-0000-4000-8000-000000000001'),'consumer:member:1:0','same existing producer with single-use consumer semantics');
SELECT ok(NOT ((SELECT saved FROM e09_op_fixture)?'token'),'operation response never exposes raw token');
SELECT is((SELECT count(*) FROM public.audit_logs a,e09_op_fixture f WHERE a.id=(f.saved->>'receipt_id')::uuid AND a.user_id='e0913300-0000-4000-8000-000000000001' AND a.entity_id=(f.saved->>'invitation_id')::uuid AND a.action='client_portal.invitation_prepared'),1::bigint,'attributable canonical audit receipt');
SELECT is(pg_temp.invite_op('create',proposal=>(SELECT proposal->>'proposal_hash' FROM e09_op_fixture))->>'replayed','true','lost acknowledgement recovers original operation');
SELECT is((pg_temp.invite_op('read')->>'receipt_id'),(SELECT saved->>'receipt_id' FROM e09_op_fixture),'readback keeps original receipt');
SELECT is(pg_temp.invite_op('create',proposal=>repeat('0',64))->>'sqlstate','40001','same operation cannot change reviewed target snapshot');
SELECT is(pg_temp.invite_op('prepare',actor=>'e0913300-0000-4000-8000-000000000002')->>'sqlstate','42501','other owner is not authority in this business');
SELECT is(pg_temp.invite_op('prepare',customer=>'e0933300-0000-4000-8000-000000000002')->>'sqlstate','42501','foreign customer refuses');
SELECT is(pg_temp.invite_op('prepare',actor=>NULL)->>'sqlstate','42501','null actual Auth refuses');
UPDATE public.tenants SET account_type='enterprise' WHERE id='e0923300-0000-4000-8000-000000000002';
SELECT is(pg_temp.invite_op('prepare',actor=>'e0913300-0000-4000-8000-000000000002',business=>'e0923300-0000-4000-8000-000000000002',customer=>'e0933300-0000-4000-8000-000000000002')->>'recipient','customer-op-b@tests.invalid','second eligible enterprise cohort uses same recipient contract');
SELECT is(pg_temp.invite_op('create',actor=>'e0913300-0000-4000-8000-000000000002',business=>'e0923300-0000-4000-8000-000000000002',customer=>'e0933300-0000-4000-8000-000000000002',proposal=>(pg_temp.invite_op('prepare',actor=>'e0913300-0000-4000-8000-000000000002',business=>'e0923300-0000-4000-8000-000000000002',customer=>'e0933300-0000-4000-8000-000000000002')->>'proposal_hash'))->>'state','prepared','second eligible business creates through same producer');
UPDATE public.client_contact_methods SET value='changed-op@tests.invalid' WHERE client_id='e0933300-0000-4000-8000-000000000001';
SELECT is(pg_temp.invite_op('create',proposal=>(SELECT proposal->>'proposal_hash' FROM e09_op_fixture),operation=>'e0943300-0000-4000-8000-000000000002')->>'sqlstate','40001','current address change retires prior proposal');
UPDATE public.client_contact_methods SET value='customer-op-a@tests.invalid' WHERE client_id='e0933300-0000-4000-8000-000000000001';
UPDATE public.clients SET do_not_contact=true WHERE id='e0933300-0000-4000-8000-000000000001';
SELECT is(pg_temp.invite_op('prepare')->>'sqlstate','42501','current contact preference refuses');
UPDATE public.clients SET do_not_contact=false WHERE id='e0933300-0000-4000-8000-000000000001';
UPDATE e09_op_fixture SET proposal=pg_temp.invite_op('prepare'),before_count=(SELECT count(*) FROM public.tenant_invite_tokens);
CREATE FUNCTION pg_temp.refuse_op_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.action='client_portal.invitation_prepared' THEN RAISE EXCEPTION 'test operation audit refused';END IF;RETURN NEW;END$$;
CREATE TRIGGER refuse_op_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_op_audit();
SELECT is(pg_temp.invite_op('create',proposal=>(SELECT proposal->>'proposal_hash' FROM e09_op_fixture),operation=>'e0943300-0000-4000-8000-000000000002')->>'sqlstate','P0001','audit refusal rejects operation');
SELECT is((SELECT count(*) FROM public.tenant_invite_tokens),(SELECT before_count FROM e09_op_fixture),'audit refusal rolls back minted token');
DROP TRIGGER refuse_op_audit ON public.audit_logs;
UPDATE public.tenant_invite_tokens SET revoked_at=now() WHERE portal_operation_id='e0943300-0000-4000-8000-000000000001';
SELECT is(pg_temp.invite_op('create',proposal=>(SELECT saved->>'proposal_hash' FROM e09_op_fixture))->>'state','revoked','replay preserves revoked history without minting another');
UPDATE public.tenant_members SET status='revoked' WHERE user_id='e0913300-0000-4000-8000-000000000001' AND tenant_id='e0923300-0000-4000-8000-000000000001';
SELECT is(pg_temp.invite_op('read')->>'sqlstate','42501','revoked owner loses readback');
SELECT is(pg_temp.invite_op('create',proposal=>(SELECT saved->>'proposal_hash' FROM e09_op_fixture))->>'sqlstate','42501','revoked owner loses replay');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text)'::regprocedure),'3a91af3aeb67fb8dbbf450eb3d612ade','incumbent producer unchanged');
SELECT ok(NOT has_function_privilege(r,s,'EXECUTE'),r||' cannot execute '||s)
 FROM unnest(ARRAY['anon','service_role'])r CROSS JOIN unnest(ARRAY[
 'public.prepare_client_portal_invitation(uuid,uuid)','public.create_client_portal_invitation(uuid,uuid,text,uuid)',
 'public.read_client_portal_invitation_operation(uuid,uuid)'])s;
SELECT ok(NOT has_function_privilege(r,s,'EXECUTE'),r||' has no private helper grant '||s)
 FROM unnest(ARRAY['anon','authenticated','service_role'])r CROSS JOIN unnest(ARRAY[
 'public._client_portal_invitation_owner(uuid)','public._client_portal_invitation_target(uuid,uuid)',
 'public._client_portal_invitation_binding_guard()'])s;
SELECT * FROM finish();
ROLLBACK;
