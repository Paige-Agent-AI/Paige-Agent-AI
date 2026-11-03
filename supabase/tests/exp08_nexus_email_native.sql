-- SAME rebuilt database-contract schema. ORIGINAL provisioner, Hub acceptance /
-- publication, Messages Save13, mailbox read and receipt. Rolled-back synthetic
-- fixtures only; NOT Auth SDK, customer, model, provider or production proof.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SELECT set_config('request.jwt.claims','{}',true);
CREATE TEMP TABLE exp08_email_checks(label text);
CREATE FUNCTION pg_temp.email_check(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'EXP08 email full-schema: %',label; END IF;
 INSERT INTO exp08_email_checks VALUES(label);
END $$;
DO $$
<<probe>>
DECLARE owner_id uuid:='e8e00000-0000-4000-8000-000000000001';
 other_id uuid:='e8e00000-0000-4000-8000-000000000002'; tenant_id uuid; other_tenant uuid;
 contact uuid:='e8e10000-0000-4000-8000-000000000001'; connector uuid:='e8e20000-0000-4000-8000-000000000001';
 operation uuid:='e8e30000-0000-4000-8000-000000000001'; channel uuid; source uuid; turn_id uuid; reply uuid;
 token text:=repeat('native-email-proof-',3); token_hash text; result jsonb; saved jsonb; reference jsonb; content jsonb;
BEGIN
 PERFORM pg_temp.email_check(NOT has_function_privilege('authenticated','public.team_hub_stage_email_draft(uuid,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.team_hub_stage_email_draft(uuid,text,text,text)','EXECUTE')
  AND has_function_privilege('service_role','public.team_hub_stage_email_draft(uuid,text,text,text)','EXECUTE'),'preparation stage is service-only');
 PERFORM pg_temp.email_check(NOT has_function_privilege('authenticated','public.team_hub_record_email_draft(uuid,uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.team_hub_record_email_draft(uuid,uuid,uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.team_hub_record_email_draft(uuid,uuid,uuid,uuid)','EXECUTE'),'only the trusted host can reconcile an original result');
 PERFORM pg_temp.email_check(has_function_privilege('authenticated','public.team_hub_email_draft(uuid,uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.team_hub_email_draft(uuid,uuid,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.team_hub_email_draft(uuid,uuid,uuid,uuid)','EXECUTE'),'private read remains caller-only');
 PERFORM pg_temp.email_check(NOT has_any_column_privilege('authenticated','public.team_hub_agent_turns','INSERT,UPDATE'),'browser cannot manufacture a preparation or Done');
 INSERT INTO auth.users(id,aud,role,email) VALUES(owner_id,'authenticated','authenticated','email-owner@tests.invalid'),
  (other_id,'authenticated','authenticated','email-other@tests.invalid');
 SELECT id INTO tenant_id FROM public.provision_tenant_as(owner_id,'Email Continuity Proof','standalone');
 SELECT id INTO other_tenant FROM public.provision_tenant_as(other_id,'Other Email Proof','standalone');
 UPDATE public.profiles SET active_tenant_id=probe.tenant_id WHERE user_id=owner_id;
 UPDATE public.profiles SET active_tenant_id=other_tenant WHERE user_id=other_id;
 INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name) VALUES(contact,tenant_id,owner_id,'Proof','Contact');
 INSERT INTO public.client_contact_methods(tenant_id,client_id,kind,value,is_primary,position) VALUES(tenant_id,contact,'email','recipient@tests.invalid',true,0);
 INSERT INTO public.channel_connectors(id,tenant_id,channel_type,provider,from_address,status,active,mailbox_class)
 VALUES(connector,tenant_id,'email','gmail','sender@tests.invalid','active',true,'shared_support');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 result:=public.team_hub_open_agent_dm(tenant_id,'nexus');
 PERFORM pg_temp.email_check(result->>'ok'='true','a newly provisioned SOLO owner can open the original NEXUS DM');
 channel:=(result->>'channel_id')::uuid;
 result:=public.team_hub_post_message(tenant_id,channel,'Prepare an unsent project update.',gen_random_uuid());
 PERFORM pg_temp.email_check(result->>'ok'='true','original asking message persists');
 source:=(result#>>'{message,id}')::uuid;
 token_hash:=encode(sha256(convert_to(token,'UTF8')),'hex');
 PERFORM set_config('request.jwt.claims','{}',true);
 result:=public.team_hub_accept_agent_turn(tenant_id,owner_id,channel,source,'nexus','dm',token_hash);
 PERFORM pg_temp.email_check(result->>'ok'='true','original accepted turn is reused');turn_id:=(result->>'turn_id')::uuid;
 result:=public.team_hub_email_draft_scope(turn_id,token_hash);
 PERFORM pg_temp.email_check(result->>'ok'='true','native scope admits the same original accepted token');
 result:=public.team_hub_stage_email_draft(turn_id,token_hash,'Project update','Ready for review.');
 PERFORM pg_temp.email_check(result->>'ok'='true','bounded preparation stages on the original turn');
 PERFORM pg_temp.email_check(NOT EXISTS(SELECT 1 FROM public.messages WHERE messages.tenant_id=probe.tenant_id),'model preparation created no Messages artifact');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 result:=public.team_hub_post_agent_message(tenant_id,channel,'nexus','Review this prepared email.',gen_random_uuid(),NULL,source,'dm',token);
 PERFORM pg_temp.email_check(result->>'ok'='true','original publication works with the private preparation guard');reply:=(result#>>'{message,id}')::uuid;
 result:=public.team_hub_email_draft(tenant_id,reply);
 PERFORM pg_temp.email_check(result#>>'{draft,body}'='Ready for review.' AND NOT (result->'draft' ? 'result'),'own prepared text is readable without a fabricated save');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true);
 PERFORM pg_temp.email_check(public.team_hub_email_draft(other_tenant,reply)->>'ok'='false','foreign actor/workspace cannot discover the preparation');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 result:=public.team_hub_email_draft(tenant_id,reply,contact,connector);
 PERFORM pg_temp.email_check(result#>>'{draft,contact_id}'=contact::text AND result#>>'{draft,connector_id}'=connector::text,'explicit recipient and sender bind without saving');
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM pg_temp.email_check(public.team_hub_record_email_draft(tenant_id,owner_id,reply,operation)->>'status'='unknown','missing original execution remains UNKNOWN');
 saved:=public.save_comms_email_draft(owner_id,tenant_id,operation,NULL,NULL,contact,connector,'Project update','Ready for review.','<p>Ready for review.</p>','[]'::jsonb,NULL,NULL);
 PERFORM pg_temp.email_check(saved->>'outcome'='draft_saved','ORIGINAL native Save13 saves unsent');
 result:=public.team_hub_record_email_draft(tenant_id,owner_id,reply,operation);reference:=result->'result';
 PERFORM pg_temp.email_check(result->>'status'='saved' AND reference->>'message_id'=saved->>'message_id'
  AND reference->>'receipt_id'=saved->>'receipt_id','Hub result references the actual original message and receipt');
 PERFORM pg_temp.email_check(public.save_comms_email_draft(owner_id,tenant_id,operation,NULL,NULL,contact,connector,'Project update','Ready for review.','<p>Ready for review.</p>','[]'::jsonb,NULL,NULL)->>'message_id'=saved->>'message_id','same original Save operation returns the same draft');
 PERFORM pg_temp.email_check((SELECT count(*)=1 AND bool_and(status='draft' AND provider_message_id IS NULL AND scheduled_for IS NULL)
  FROM public.messages WHERE messages.tenant_id=probe.tenant_id),'one original draft, no send, schedule or provider result');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 result:=public.team_hub_email_draft(tenant_id,reply);
 PERFORM pg_temp.email_check(result#>>'{draft,result,message_id}'=saved->>'message_id','fresh native read reopens the same original reference');
 content:=public.read_message_content((saved->>'message_id')::uuid);
 PERFORM pg_temp.email_check(content->>'ok'='true' AND content#>>'{saved_email_draft,source,message_id}'=saved->>'message_id'
  AND content#>>'{saved_email_draft,body_text}'='Ready for review.','ORIGINAL mailbox reader supplies complete editable source');
 UPDATE public.channel_connectors SET active=false WHERE id=connector;
 PERFORM pg_temp.email_check(public.read_message_content((saved->>'message_id')::uuid)->>'ok'='false','revoked mailbox cannot reopen editable content');
 UPDATE public.tenant_members SET team_hub_access=false WHERE user_id=owner_id AND tenant_members.tenant_id=probe.tenant_id;
 PERFORM pg_temp.email_check(public.team_hub_email_draft(tenant_id,reply)->>'ok'='false','withdrawn Team conversations refuses the prepared context');
END $$;
SELECT jsonb_build_object('passed',count(*),'evidence','rolled-back full-schema native composition; NOT authenticated customer or provider proof') FROM exp08_email_checks;
ROLLBACK;
