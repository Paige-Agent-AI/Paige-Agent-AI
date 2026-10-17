-- Full replayed schema, actual Auth/owner/token/log contracts. No provider; all rollback.
BEGIN;
SELECT no_plan();
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features)VALUES
 ('e0923400-0000-4000-8000-000000000001','test-tenant-e09-delivery-a','Test tenant delivery A','active','standalone','E09D',9434001,'{}'),
 ('e0923400-0000-4000-8000-000000000002','test-tenant-e09-delivery-b','Test tenant delivery B','active','enterprise','E09E',9434002,'{}');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data)VALUES
 ('e0913400-0000-4000-8000-000000000001','authenticated','authenticated','owner-delivery-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0913400-0000-4000-8000-000000000002','authenticated','authenticated','owner-delivery-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)VALUES
 ('e0923400-0000-4000-8000-000000000001','e0913400-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0923400-0000-4000-8000-000000000002','e0913400-0000-4000-8000-000000000002','owner','active',true,now());
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,status,do_not_contact)VALUES
 ('e0933400-0000-4000-8000-000000000001','e0923400-0000-4000-8000-000000000001','e0913400-0000-4000-8000-000000000001','Test','Customer A','active',false);
SELECT public._attach_client_address('e0923400-0000-4000-8000-000000000001','e0933400-0000-4000-8000-000000000001','email','customer-delivery@tests.invalid');
UPDATE public.client_contact_methods SET is_primary=true WHERE client_id='e0933400-0000-4000-8000-000000000001';
CREATE TEMP TABLE e09_delivery_fixture(invitation uuid,first_claim jsonb,current_claim jsonb,result jsonb,original_attempt_at timestamptz);
DO $$DECLARE prepared jsonb;BEGIN
 PERFORM set_config('request.jwt.claims','{"sub":"e0913400-0000-4000-8000-000000000001","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 prepared:=public.prepare_client_portal_invitation('e0923400-0000-4000-8000-000000000001','e0933400-0000-4000-8000-000000000001');
 prepared:=public.create_client_portal_invitation('e0923400-0000-4000-8000-000000000001','e0933400-0000-4000-8000-000000000001',prepared->>'proposal_hash','e0953400-0000-4000-8000-000000000099');
 RESET ROLE;
 INSERT INTO e09_delivery_fixture(invitation)VALUES((prepared->>'invitation_id')::uuid);
 PERFORM set_config('request.jwt.claims','{}',true);
END$$;
CREATE FUNCTION pg_temp.delivery(action text,actor uuid DEFAULT 'e0913400-0000-4000-8000-000000000001',
 business uuid DEFAULT 'e0923400-0000-4000-8000-000000000001',operation uuid DEFAULT 'e0953400-0000-4000-8000-000000000001',
 digest text DEFAULT repeat('a',64),claim uuid DEFAULT NULL,outcome text DEFAULT 'provider_accepted',message text DEFAULT 'controlled-provider-message')RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;invitation uuid;BEGIN
 SELECT f.invitation INTO invitation FROM e09_delivery_fixture f;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 IF action='finish' THEN SET LOCAL ROLE service_role;ELSE SET LOCAL ROLE authenticated;END IF;
 BEGIN
  CASE action
   WHEN 'claim' THEN result:=public.claim_client_portal_invitation_delivery(business,invitation,operation,digest);
   WHEN 'read' THEN result:=public.read_client_portal_invitation_delivery(business,operation);
   WHEN 'finish' THEN result:=public.finalize_client_portal_invitation_delivery(business,operation,claim,digest,outcome,message);
   ELSE RAISE EXCEPTION 'invalid test action';
  END CASE;
 EXCEPTION WHEN OTHERS THEN result:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM);END;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);PERFORM set_config('request.jwt.claim.sub','',true);
 RETURN result;
END$$;
SELECT is(pg_temp.delivery('read')->>'found','false','absence is inconclusive native readback');
UPDATE e09_delivery_fixture SET first_claim=pg_temp.delivery('claim');
SELECT is((SELECT first_claim->>'disposition'FROM e09_delivery_fixture),'dispatch','first native claim grants one attempt');
SELECT is((SELECT first_claim->>'outcome'FROM e09_delivery_fixture),'pending','claim is not provider acceptance');
SELECT is((SELECT count(*)FROM public.email_send_log WHERE id=(SELECT(first_claim->>'receipt_id')::uuid FROM e09_delivery_fixture)),1::bigint,'one canonical log row');
SELECT is(pg_temp.delivery('claim')->>'disposition','busy','concurrent live lease grants no second dispatch');
SELECT is(pg_temp.delivery('claim',operation=>'e0953400-0000-4000-8000-000000000002')->>'sqlstate','40001','new operation cannot bypass pending send');
DO $$DECLARE target jsonb;other jsonb;original uuid;BEGIN
 SELECT invitation INTO original FROM e09_delivery_fixture;
 PERFORM set_config('request.jwt.claims','{"sub":"e0913400-0000-4000-8000-000000000001","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 target:=public.prepare_client_portal_invitation('e0923400-0000-4000-8000-000000000001','e0933400-0000-4000-8000-000000000001');
 other:=public.create_client_portal_invitation('e0923400-0000-4000-8000-000000000001','e0933400-0000-4000-8000-000000000001',target->>'proposal_hash','e0953400-0000-4000-8000-000000000098');
 RESET ROLE;PERFORM set_config('request.jwt.claims','{}',true);
 UPDATE e09_delivery_fixture SET invitation=(other->>'invitation_id')::uuid;
 PERFORM set_config('e09.delivery.original',original::text,true);
END$$;
SELECT is(pg_temp.delivery('claim',operation=>'e0953400-0000-4000-8000-000000000002')->>'sqlstate','40001','a new invitation cannot bypass this same customer pending send');
UPDATE e09_delivery_fixture SET invitation=current_setting('e09.delivery.original')::uuid;
SELECT is(pg_temp.delivery('claim',digest=>repeat('b',64))->>'sqlstate','40001','payload change cannot reuse operation');
SELECT is(pg_temp.delivery('claim',actor=>'e0913400-0000-4000-8000-000000000002')->>'sqlstate','42501','foreign owner refuses');
SELECT is(pg_temp.delivery('read',actor=>NULL)->>'sqlstate','42501','missing actual Auth refuses');
SELECT is(pg_temp.delivery('claim',business=>'e0923400-0000-4000-8000-000000000002')->>'sqlstate','42501','wrong business refuses');
SELECT ok(NOT(pg_temp.delivery('read')?|ARRAY['token','join_url','claim_id','provider_key','payload_digest']),'public readback has no execution/bearer secrets');
UPDATE public.email_send_log SET created_at=now()-interval '1 hour' WHERE id=(SELECT(first_claim->>'receipt_id')::uuid FROM e09_delivery_fixture);
UPDATE e09_delivery_fixture SET original_attempt_at=(SELECT created_at FROM public.email_send_log WHERE id=(first_claim->>'receipt_id')::uuid);
INSERT INTO public.email_send_log(tenant_id,template_name,recipient_email,status,message_id,metadata,created_at)
 SELECT tenant_id,template_name,recipient_email,'delivered','controlled-provider-message',metadata-'claim_id'-'claim_expires_at',created_at+interval '1 second'
 FROM public.email_send_log WHERE id=(SELECT(first_claim->>'receipt_id')::uuid FROM e09_delivery_fixture);
UPDATE e09_delivery_fixture SET result=pg_temp.delivery('finish',claim=>(first_claim->>'claim_id')::uuid,outcome=>'outcome_unknown',message=>NULL);
SELECT is((SELECT result->>'outcome'FROM e09_delivery_fixture),'outcome_unknown','transport uncertainty is durable unknown');
SELECT ok((SELECT l.created_at=f.original_attempt_at AND l.metadata ? 'recorded_at' AND (public._client_portal_invitation_delivery_result(l,'e0913400-0000-4000-8000-000000000001')->>'observed_at')::timestamptz=(l.metadata->>'recorded_at')::timestamptz FROM public.email_send_log l CROSS JOIN e09_delivery_fixture f WHERE l.id=(f.first_claim->>'receipt_id')::uuid),'finalization preserves attempt timestamp and projects separate observation time');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)VALUES
 ('e0923400-0000-4000-8000-000000000001','e0913400-0000-4000-8000-000000000002','admin','active',false,now());
UPDATE e09_delivery_fixture SET current_claim=pg_temp.delivery('claim',actor=>'e0913400-0000-4000-8000-000000000002');
SELECT is((SELECT current_claim->>'disposition'FROM e09_delivery_fixture),'reconcile','another current owner can recover');
SELECT is((SELECT current_claim->>'requested_by'FROM e09_delivery_fixture),'e0913400-0000-4000-8000-000000000001','original actor retained');
SELECT is((SELECT current_claim->>'reconciled_by'FROM e09_delivery_fixture),'e0913400-0000-4000-8000-000000000002','recovery actor attributed');
SELECT is((SELECT current_claim->>'provider_key'FROM e09_delivery_fixture),(SELECT first_claim->>'provider_key'FROM e09_delivery_fixture),'same provider key');
SELECT is(pg_temp.delivery('finish',claim=>(SELECT(first_claim->>'claim_id')::uuid FROM e09_delivery_fixture))->>'sqlstate','40001','stale claim cannot finalize');
SELECT is(pg_temp.delivery('finish',claim=>(SELECT(current_claim->>'claim_id')::uuid FROM e09_delivery_fixture),outcome=>'refused',message=>NULL)->>'outcome','outcome_unknown','recovery refusal cannot erase original uncertainty');
UPDATE e09_delivery_fixture SET current_claim=pg_temp.delivery('claim');
SELECT is(pg_temp.delivery('finish',claim=>(SELECT(current_claim->>'claim_id')::uuid FROM e09_delivery_fixture),outcome=>'failed',message=>NULL)->>'outcome','outcome_unknown','recovery rejection cannot erase original uncertainty');
UPDATE e09_delivery_fixture SET current_claim=pg_temp.delivery('claim');
UPDATE public.tenant_members SET status='revoked'WHERE tenant_id='e0923400-0000-4000-8000-000000000001'AND user_id='e0913400-0000-4000-8000-000000000001';
SELECT is(pg_temp.delivery('read')->>'sqlstate','42501','revoked owner loses readback');
SELECT is(pg_temp.delivery('finish',claim=>(SELECT(current_claim->>'claim_id')::uuid FROM e09_delivery_fixture))->>'outcome','provider_accepted','service records actual claimed outcome after owner revocation');
UPDATE public.tenant_members SET status='active'WHERE tenant_id='e0923400-0000-4000-8000-000000000001'AND user_id='e0913400-0000-4000-8000-000000000001';
SELECT is(pg_temp.delivery('claim')->>'disposition','recorded','returning request reads accepted result without dispatch');
SELECT ok((SELECT l.created_at=f.original_attempt_at AND l.created_at < (SELECT created_at FROM public.email_send_log WHERE message_id='controlled-provider-message' AND status='delivered') FROM public.email_send_log l CROSS JOIN e09_delivery_fixture f WHERE l.id=(f.first_claim->>'receipt_id')::uuid),'repeated reconciliation preserves send-before-webhook ordering');
SELECT is(pg_temp.delivery('finish',claim=>(SELECT(current_claim->>'claim_id')::uuid FROM e09_delivery_fixture),outcome=>'outcome_unknown',message=>NULL)->>'outcome','provider_accepted','late uncertainty cannot downgrade accepted outcome');
UPDATE e09_delivery_fixture SET current_claim=pg_temp.delivery('claim',operation=>'e0953400-0000-4000-8000-000000000002');
SELECT is((SELECT current_claim->>'disposition'FROM e09_delivery_fixture),'dispatch','explicit fresh operation is possible after known result');
SELECT is(pg_temp.delivery('finish',operation=>'e0953400-0000-4000-8000-000000000002',claim=>(SELECT(current_claim->>'claim_id')::uuid FROM e09_delivery_fixture),outcome=>'refused',message=>NULL)->>'outcome','refused','known first-attempt refusal remains truthful');
SELECT is(pg_temp.delivery('finish',operation=>'e0953400-0000-4000-8000-000000000002',claim=>(SELECT(current_claim->>'claim_id')::uuid FROM e09_delivery_fixture),outcome=>'outcome_unknown',message=>NULL)->>'outcome','refused','known refusal is terminal');
UPDATE e09_delivery_fixture SET current_claim=pg_temp.delivery('claim',operation=>'e0953400-0000-4000-8000-000000000003');
UPDATE public.email_send_log SET metadata=metadata||jsonb_build_object('started_at',now()-interval '24 hours','claim_expires_at',now()-interval '1 minute','outcome','outcome_unknown')WHERE id=(SELECT(current_claim->>'receipt_id')::uuid FROM e09_delivery_fixture);
SELECT is(pg_temp.delivery('claim',operation=>'e0953400-0000-4000-8000-000000000003')->>'disposition','held','expired provider window stays held');
SELECT is(pg_temp.delivery('claim',operation=>'e0953400-0000-4000-8000-000000000004')->>'sqlstate','40001','new key cannot bypass expired unknown request');
SELECT ok(NOT has_function_privilege(r,s,'EXECUTE'),r||' cannot execute '||s)
 FROM unnest(ARRAY['anon','service_role'])r CROSS JOIN unnest(ARRAY['public.read_client_portal_invitation_delivery(uuid,uuid)','public.claim_client_portal_invitation_delivery(uuid,uuid,uuid,text)'])s;
SELECT ok(NOT has_function_privilege(r,'public.finalize_client_portal_invitation_delivery(uuid,uuid,uuid,text,text,text)','EXECUTE'),r||' cannot forge provider outcome')FROM unnest(ARRAY['anon','authenticated'])r;
SELECT ok(NOT has_function_privilege(r,s,'EXECUTE'),r||' cannot execute private helper '||s)
 FROM unnest(ARRAY['anon','authenticated','service_role'])r CROSS JOIN unnest(ARRAY['public._client_portal_invitation_delivery_guard()','public._client_portal_invitation_delivery_result(public.email_send_log,uuid)'])s;
SELECT * FROM finish();
ROLLBACK;
