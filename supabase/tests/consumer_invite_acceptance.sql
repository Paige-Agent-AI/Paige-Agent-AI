-- Runs against the complete isolated schema replayed by the EXISTING database-contract job.
-- Actual authenticated/anonymous database callers; synthetic identities; all data rolls back.
BEGIN;
SELECT no_plan();
SELECT is(public._client_portal_welcome_fields(NULL),'[]'::jsonb,'unconfigured business collects native contact information without inventing custom questions');
SELECT is(public._client_portal_welcome_fields('{}'::jsonb),NULL::jsonb,'malformed authored configuration remains unavailable');

INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features)
VALUES('e0901000-0000-0000-0000-000000000001','test-tenant-e09-a','Test tenant E09 A','active','standalone','E09A',9400901,'{}'),
('e0901000-0000-0000-0000-000000000002','test-tenant-e09-b','Test tenant E09 B','active','standalone','E09B',9400902,'{}');

CREATE FUNCTION pg_temp.e09_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('clients',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.clients x),
 'roles',(SELECT jsonb_agg(to_jsonb(x) ORDER BY user_id,role) FROM public.user_roles x),
 'profiles',(SELECT jsonb_agg(to_jsonb(x) ORDER BY user_id) FROM public.profiles x),
 'members',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tenant_members x),
 'invites',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.tenant_invite_tokens x),
 'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.audit_logs x));
$$;

CREATE FUNCTION pg_temp.e09_call(_token text,_actor uuid,_allow boolean,_label text,_expected_error text DEFAULT NULL)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE _before jsonb:=pg_temp.e09_snapshot(); _denied boolean:=false; _result uuid; _role text; _failure text;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',CASE WHEN _actor IS NULL THEN 'anon' ELSE 'authenticated' END,
  'email','claimed-recipient@tests.invalid','email_verified',true)::text,true);
 IF _actor IS NULL THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
 _role:=current_user;
 BEGIN SELECT public.accept_tenant_invite(_token) INTO _result;
 EXCEPTION WHEN OTHERS THEN _denied:=true; _failure:=SQLSTATE||':'||SQLERRM; END;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','',true);
 RETURN NEXT ok(_role=CASE WHEN _actor IS NULL THEN 'anon' ELSE 'authenticated' END,_label||': actual caller role');
 RETURN NEXT ok(_denied=NOT _allow,_label||': expected acceptance or refusal');
 IF _expected_error IS NOT NULL THEN
  RETURN NEXT is(_failure,_expected_error,_label||': intended guard caused refusal');
 END IF;
 IF _allow THEN RETURN NEXT is(_result,'e0901000-0000-0000-0000-000000000001'::uuid,_label||': invited tenant only');
 ELSE RETURN NEXT is(pg_temp.e09_snapshot(),_before,_label||': zero durable acceptance effects'); END IF;
END;
$$;

CREATE FUNCTION pg_temp.e09_case(_name text,_options jsonb DEFAULT '{}',_allow boolean DEFAULT false)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE _actor uuid:=gen_random_uuid(); _owner uuid:=gen_random_uuid(); _client uuid:=gen_random_uuid(); _inv uuid:=gen_random_uuid();
 _a uuid:='e0901000-0000-0000-0000-000000000001'; _b uuid:='e0901000-0000-0000-0000-000000000002';
 _email text:='client-'||_actor::text||'@tests.invalid'; _token text:='test-consumer-'||_inv::text;
BEGIN
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data)
 VALUES(_actor,'authenticated','authenticated',CASE WHEN _options?'wrong' THEN 'wrong-'||_actor::text||'@tests.invalid' ELSE _email END,
 CASE WHEN _options?'unconfirmed' THEN NULL ELSE now() END,'{"comms_provider_execution":"disabled"}'),
 (_owner,'authenticated','authenticated','owner-'||_owner::text||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
 INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,status)
 VALUES(_client,CASE WHEN _options?'foreign' THEN _b ELSE _a END,_owner,'Synthetic','Client',CASE WHEN _options?'archived' THEN 'archived' ELSE 'active' END);
 PERFORM public._attach_client_address(CASE WHEN _options?'foreign' THEN _b ELSE _a END,_client,'email',_email);
 IF _options?'occupied' THEN UPDATE public.clients SET linked_user_id=_owner WHERE id=_client; END IF;
 IF _options?'staff' THEN
  INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
  VALUES(_a,_actor,'member','active',false,now());
  RETURN NEXT is((SELECT count(*) FROM public.tenant_members WHERE tenant_id=_a AND user_id=_actor AND status='active'),
    1::bigint,_name||': pre-existing active staff fixture reaches intended guard');
 END IF;
 INSERT INTO public.tenant_invite_tokens(id,tenant_id,token,kind,default_role,created_by,expires_at,max_uses,uses,last_used_at,revoked_at,contact_id,email)
 VALUES(_inv,_a,_token,'consumer','member',_owner,now()+CASE WHEN _options?'expired' THEN interval '-1 day' ELSE interval '1 day' END,NULL,
 CASE WHEN _options?'used' THEN 1 ELSE 0 END,CASE WHEN _options?'last_used' THEN now() ELSE NULL END,
 CASE WHEN _options?'revoked' THEN now() ELSE NULL END,CASE WHEN _options?'unbound' THEN NULL ELSE _client END,
 CASE WHEN _options?'no_recipient' THEN NULL ELSE _email END);
 IF _allow OR _options?'used' OR _options?'last_used' OR _options?'expired' OR _options?'revoked' THEN
  SET LOCAL ROLE anon;
  RETURN NEXT is((SELECT is_valid FROM public.peek_tenant_invite(_token)),
   NOT (_options?'used' OR _options?'last_used' OR _options?'expired' OR _options?'revoked'),
   _name||': public validity follows unused consumer state even with unlimited max uses');
  RESET ROLE;
 END IF;
 RETURN QUERY SELECT * FROM pg_temp.e09_call(_token,CASE WHEN _options?'anonymous' THEN NULL ELSE _actor END,_allow,_name,_options->>'expected_error');
 IF _allow THEN
  RETURN NEXT is((SELECT linked_user_id FROM public.clients WHERE id=_client),_actor,_name||': exact CRM contact linked');
  RETURN NEXT is((SELECT count(*) FROM public.tenant_members WHERE user_id=_actor),CASE WHEN _options?'staff' THEN 1 ELSE 0 END::bigint,_name||': no additional business seat');
  IF _options?'staff' THEN
   RETURN NEXT is((SELECT role::text FROM public.tenant_members WHERE user_id=_actor AND tenant_id=_a),'member',_name||': existing role preserved');
  END IF;
  RETURN NEXT is((SELECT active_tenant_id FROM public.profiles WHERE user_id=_actor),NULL::uuid,_name||': customer acceptance does not set a staff workspace');
  RETURN NEXT is((SELECT uses FROM public.tenant_invite_tokens WHERE id=_inv),1,_name||': single token consumption');
  RETURN NEXT is((SELECT count(*) FROM public.audit_logs WHERE entity_id=_inv AND user_id=_actor AND action='consumer_invite_accepted'
   AND data->>'tenant_id'=_a::text AND data->>'client_id'=_client::text),1::bigint,_name||': attributable acceptance receipt');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  RETURN NEXT is(public.client_portal_invite_status(_token)->>'client_id',_client::text,_name||': lost response recovers the exact accepted relationship');
  IF NOT _options?'staff' THEN
   RETURN NEXT is((SELECT count(*) FROM public.clients),0::bigint,_name||': customer has no raw CRM read');
   RETURN NEXT is(public.client_portal_self_profile()->>'id',_client::text,_name||': closed customer projection still works');
  END IF;
  RESET ROLE;
  SET LOCAL ROLE anon;
  RETURN NEXT is((SELECT is_valid FROM public.peek_tenant_invite(_token)),false,
   _name||': consumed legacy unlimited link is sign-in recovery only');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims','{}',true);
  RETURN QUERY SELECT * FROM pg_temp.e09_call(_token,_actor,false,_name||' replay');
 END IF;
END;
$$;

SELECT * FROM pg_temp.e09_case('verified recipient with existing staff standing','{"staff":true}',true);
SELECT * FROM pg_temp.e09_case('pure verified external customer joins without a business seat','{}',true);
SELECT * FROM pg_temp.e09_case('wrong recipient despite spoofed JWT email','{"wrong":true,"staff":true,"expected_error":"42501:portal invitation belongs to a different verified recipient"}');
SELECT * FROM pg_temp.e09_case('unconfirmed recipient','{"unconfirmed":true,"staff":true,"expected_error":"42501:portal invitation belongs to a different verified recipient"}');
SELECT * FROM pg_temp.e09_case('anonymous','{"anonymous":true}');
SELECT * FROM pg_temp.e09_case('missing recipient','{"no_recipient":true,"staff":true,"expected_error":"42501:portal invitation belongs to a different verified recipient"}');
SELECT * FROM pg_temp.e09_case('expired','{"expired":true,"staff":true}');
SELECT * FROM pg_temp.e09_case('revoked','{"revoked":true,"staff":true}');
SELECT * FROM pg_temp.e09_case('unlimited legacy token already used','{"used":true,"staff":true,"expected_error":"42501:portal invitation has already been accepted"}');
SELECT * FROM pg_temp.e09_case('recorded acceptance count drift','{"last_used":true,"staff":true,"expected_error":"42501:portal invitation has already been accepted"}');
SELECT * FROM pg_temp.e09_case('foreign exact contact','{"foreign":true,"staff":true,"expected_error":"42501:portal invitation client relationship is no longer available"}');
SELECT * FROM pg_temp.e09_case('occupied exact contact','{"occupied":true,"staff":true,"expected_error":"42501:portal invitation client relationship is no longer available"}');
SELECT * FROM pg_temp.e09_case('archived exact contact','{"archived":true,"staff":true,"expected_error":"42501:portal invitation client relationship is no longer available"}');
SELECT * FROM pg_temp.e09_case('unbound token','{"unbound":true,"staff":true,"expected_error":"42501:portal invitation requires an explicit client relationship"}');
-- E09 additive owner invitation-history reader: actual full schema and caller roles.
-- No sender/provider action; all neutral fixtures and proof mutations roll back.
CREATE FUNCTION pg_temp.e09_history_call(_actor uuid,_expected_actor uuid,_tenant uuid,_role text DEFAULT 'authenticated')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon;
 ELSIF _role='service_role' THEN SET LOCAL ROLE service_role;
 ELSE SET LOCAL ROLE authenticated; END IF;
 SELECT public.client_portal_owner_invitations(_expected_actor,_tenant) INTO _result;
 RESET ROLE;PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _result;
END;$$;
CREATE TEMP TABLE e09_history_fixture AS
 SELECT gen_random_uuid() AS owner_id,gen_random_uuid() AS member_id,gen_random_uuid() AS invite_id,
 gen_random_uuid() AS empty_id,gen_random_uuid() AS foreign_id;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data)
 SELECT owner_id,'authenticated','authenticated','history-owner-'||owner_id||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'::jsonb FROM e09_history_fixture
 UNION ALL SELECT member_id,'authenticated','authenticated','history-member-'||member_id||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'::jsonb FROM e09_history_fixture;
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
 SELECT 'e0901000-0000-0000-0000-000000000001'::uuid,owner_id,'owner'::public.tenant_role,'active',true,now() FROM e09_history_fixture
 UNION ALL SELECT 'e0901000-0000-0000-0000-000000000001'::uuid,member_id,'member'::public.tenant_role,'active',false,now() FROM e09_history_fixture;
INSERT INTO public.tenant_invite_tokens(id,tenant_id,token,kind,default_role,created_by,expires_at,email)
 SELECT invite_id,'e0901000-0000-0000-0000-000000000001'::uuid,'test-history-'||invite_id,'consumer','member'::public.tenant_role,owner_id,now()+interval '1 day','history-client@tests.invalid' FROM e09_history_fixture
 UNION ALL SELECT empty_id,'e0901000-0000-0000-0000-000000000001'::uuid,'test-history-'||empty_id,'consumer','member'::public.tenant_role,owner_id,now()+interval '1 day',NULL FROM e09_history_fixture
 UNION ALL SELECT foreign_id,'e0901000-0000-0000-0000-000000000002'::uuid,'test-history-'||foreign_id,'consumer','member'::public.tenant_role,owner_id,now()+interval '1 day','foreign-history@tests.invalid' FROM e09_history_fixture;
INSERT INTO public.email_send_log(tenant_id,template_name,recipient_email,status,message_id,metadata,created_at)
 SELECT 'e0901000-0000-0000-0000-000000000001'::uuid,'portal_invite',' HISTORY-CLIENT@tests.invalid ','sent','PRIVATE_PROVIDER_ID',
 jsonb_build_object('invite_id',invite_id,'kind','consumer','token','PRIVATE_TOKEN','body','PRIVATE_BODY','join_url','PRIVATE_URL'),now()-interval '2 seconds' FROM e09_history_fixture
 UNION ALL SELECT 'e0901000-0000-0000-0000-000000000001','portal_invite','history-client@tests.invalid','failed',NULL,
 jsonb_build_object('invite_id',invite_id,'reason','transport','detail','PRIVATE_ERROR'),now()-interval '1 second' FROM e09_history_fixture
 UNION ALL SELECT 'e0901000-0000-0000-0000-000000000001','portal_invite','history-client@tests.invalid','sent',NULL,
 jsonb_build_object('invite_id',invite_id),now() FROM e09_history_fixture
 UNION ALL SELECT 'e0901000-0000-0000-0000-000000000002','portal_invite','history-client@tests.invalid','delivered',NULL,
 jsonb_build_object('invite_id',invite_id),now() FROM e09_history_fixture
 UNION ALL SELECT NULL::uuid,'portal_invite','history-client@tests.invalid','delivered',NULL,
 jsonb_build_object('invite_id',invite_id),now() FROM e09_history_fixture
 UNION ALL SELECT 'e0901000-0000-0000-0000-000000000001','team_invite','history-client@tests.invalid','delivered',NULL,
 jsonb_build_object('invite_id',invite_id),now() FROM e09_history_fixture
 UNION ALL SELECT 'e0901000-0000-0000-0000-000000000001','portal_invite','wrong-history@tests.invalid','delivered',NULL,
 jsonb_build_object('invite_id',invite_id),now() FROM e09_history_fixture
 UNION ALL SELECT 'e0901000-0000-0000-0000-000000000001','portal_invite','history-client@tests.invalid','delivered',NULL,
 jsonb_build_object('invite_id',invite_id,'kind','team'),now() FROM e09_history_fixture
 UNION ALL SELECT 'e0901000-0000-0000-0000-000000000001','portal_invite','history-client@tests.invalid','delivered',NULL,
 jsonb_build_object('invite_id',invite_id,'kind',NULL),now() FROM e09_history_fixture;
CREATE FUNCTION pg_temp.e09_history_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('acceptance',pg_temp.e09_snapshot(),
 'email',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.email_send_log l))
$$;
CREATE TEMP TABLE e09_history_before AS SELECT pg_temp.e09_history_snapshot() AS state;
CREATE TEMP TABLE e09_history_result AS
 SELECT pg_temp.e09_history_call(owner_id,owner_id,'e0901000-0000-0000-0000-000000000001') AS state FROM e09_history_fixture;
CREATE TEMP TABLE e09_history_invite AS
 SELECT value AS row FROM e09_history_result CROSS JOIN LATERAL jsonb_array_elements(state->'invitations')
 WHERE value->>'id'=(SELECT invite_id::text FROM e09_history_fixture);
SELECT is((SELECT array_agg(key ORDER BY key) FROM e09_history_result CROSS JOIN LATERAL jsonb_object_keys(state) key),
 ARRAY['actor_id','invitations','tenant_id']::text[],'owner history envelope is closed');
SELECT is((SELECT state->>'actor_id' FROM e09_history_result),(SELECT owner_id::text FROM e09_history_fixture),'actual expected actor retained');
SELECT is((SELECT state->>'tenant_id' FROM e09_history_result),'e0901000-0000-0000-0000-000000000001','exact named workspace retained');
SELECT is((SELECT array_agg(key ORDER BY key) FROM e09_history_invite CROSS JOIN LATERAL jsonb_object_keys(row) key),
 ARRAY['contact_id','created_at','delivery','email','expires_at','id','last_used_at','revoked_at']::text[],'invitation projection has no token/provider/metadata fields');
SELECT is((SELECT jsonb_array_length(row#>'{delivery,history}') FROM e09_history_invite),3,'tenant/template/invite/recipient/kind all bind; absent-kind receipts remain supported');
SELECT is((SELECT row#>>'{delivery,history,0,outcome}' FROM e09_history_invite),'accepted','provider id proves handoff only');
SELECT is((SELECT row#>>'{delivery,history,1,outcome}' FROM e09_history_invite),'unknown','transport failure remains uncertain');
SELECT is((SELECT row#>>'{delivery,history,2,outcome}' FROM e09_history_invite),'unknown','sent without provider id remains uncertain');
SELECT ok(NOT(SELECT state::text LIKE '%PRIVATE_%' FROM e09_history_result),'raw metadata/body/errors/token/provider identifiers remain private');
SELECT ok(NOT EXISTS(SELECT 1 FROM e09_history_result CROSS JOIN LATERAL jsonb_array_elements(state->'invitations') i
 WHERE i->>'id'=(SELECT foreign_id::text FROM e09_history_fixture)),'foreign invitation excluded');
SELECT is((SELECT value->'delivery' FROM e09_history_result CROSS JOIN LATERAL jsonb_array_elements(state->'invitations')
 WHERE value->>'id'=(SELECT empty_id::text FROM e09_history_fixture)),'{"history":[],"truncated":false}'::jsonb,'no stored recipient has no invented delivery claim');
SELECT throws_ok($$SELECT pg_temp.e09_history_call(NULL,(SELECT owner_id FROM e09_history_fixture),'e0901000-0000-0000-0000-000000000001','service_role')$$,'42501',NULL,'service role is not Auth identity');
SELECT throws_ok($$SELECT pg_temp.e09_history_call((SELECT member_id FROM e09_history_fixture),(SELECT owner_id FROM e09_history_fixture),'e0901000-0000-0000-0000-000000000001')$$,'42501',NULL,'wrong actual actor cannot claim owner');
SELECT throws_ok($$SELECT pg_temp.e09_history_call((SELECT member_id FROM e09_history_fixture),(SELECT member_id FROM e09_history_fixture),'e0901000-0000-0000-0000-000000000001')$$,'42501',NULL,'ordinary staff/client membership is not invitation authority');
SELECT throws_ok($$SELECT pg_temp.e09_history_call((SELECT owner_id FROM e09_history_fixture),(SELECT owner_id FROM e09_history_fixture),'e0901000-0000-0000-0000-000000000002')$$,'42501',NULL,'expected tenant never redirects authority');
SELECT throws_ok($$SELECT pg_temp.e09_history_call(NULL,NULL,'e0901000-0000-0000-0000-000000000001','anon')$$,'42501',NULL,'anonymous execution refused');
SELECT is(pg_temp.e09_history_snapshot(),(SELECT state FROM e09_history_before),'all reader/refusal paths have zero durable effects');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_owner_invitations(uuid,uuid)','EXECUTE'),'reader has no anonymous grant');
-- More than50 canonical events has an explicit bound; no truncation silently implies complete history.
INSERT INTO public.email_send_log(tenant_id,template_name,recipient_email,status,message_id,metadata,created_at)
 SELECT 'e0901000-0000-0000-0000-000000000001','portal_invite','history-client@tests.invalid','delivered','PRIVATE_PROVIDER_ID',
 jsonb_build_object('invite_id',f.invite_id),now()+make_interval(secs=>n)
 FROM e09_history_fixture f CROSS JOIN generate_series(1,51)n;
CREATE TEMP TABLE e09_history_truncated AS
 SELECT value AS row FROM e09_history_fixture f CROSS JOIN LATERAL jsonb_array_elements(
 pg_temp.e09_history_call(f.owner_id,f.owner_id,'e0901000-0000-0000-0000-000000000001')->'invitations')
 WHERE value->>'id'=f.invite_id::text;
SELECT is((SELECT jsonb_array_length(row#>'{delivery,history}') FROM e09_history_truncated),50,'newest50 event cap applies under real schema');
SELECT is((SELECT row#>>'{delivery,truncated}' FROM e09_history_truncated),'true','history truncation is explicit');
SELECT ok(NOT EXISTS(SELECT 1 FROM e09_history_truncated CROSS JOIN LATERAL jsonb_array_elements(row#>'{delivery,history}') WITH ORDINALITY h(value,n)
 JOIN LATERAL jsonb_array_elements(row#>'{delivery,history}') WITH ORDINALITY prev(value,n) ON prev.n=h.n-1
 WHERE (h.value->>'at')::timestamptz<(prev.value->>'at')::timestamptz),'retained history is chronological');

-- Consumer authority compatibility: actual complete-schema predicates, never Team's predicate.
-- All principals/tenants are neutral synthetic fixtures; no effectful mint/send is invoked.
CREATE FUNCTION pg_temp.e09_consumer_authority_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_agg(jsonb_build_object('identity',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid))
 ORDER BY p.oid::regprocedure::text) FROM pg_proc p
 WHERE p.oid IN('public.is_platform_owner()'::regprocedure,'public.is_tenant_admin(uuid)'::regprocedure,
 'public.agency_can_manage_child(uuid,uuid)'::regprocedure)
$$;
CREATE TEMP TABLE e09_consumer_authority_before AS SELECT pg_temp.e09_consumer_authority_snapshot() AS state;
UPDATE public.tenant_members SET role='admin' WHERE user_id=(SELECT owner_id FROM e09_history_fixture);
SELECT is(pg_temp.e09_history_call((SELECT owner_id FROM e09_history_fixture),(SELECT owner_id FROM e09_history_fixture),
 'e0901000-0000-0000-0000-000000000001')->>'tenant_id','e0901000-0000-0000-0000-000000000001','active direct admin retains consumer history');
UPDATE public.tenant_members SET role='owner',status='revoked' WHERE user_id=(SELECT owner_id FROM e09_history_fixture);
SELECT throws_ok($$SELECT pg_temp.e09_history_call((SELECT owner_id FROM e09_history_fixture),(SELECT owner_id FROM e09_history_fixture),'e0901000-0000-0000-0000-000000000001')$$,'42501',NULL,'revoked direct owner loses consumer history');
UPDATE public.tenant_members SET status='active' WHERE user_id=(SELECT owner_id FROM e09_history_fixture);
UPDATE public.tenant_members SET is_owner=true WHERE user_id=(SELECT member_id FROM e09_history_fixture);
SELECT throws_ok($$SELECT pg_temp.e09_history_call((SELECT member_id FROM e09_history_fixture),(SELECT member_id FROM e09_history_fixture),'e0901000-0000-0000-0000-000000000001')$$,'42501',NULL,'is_owner flag alone never widens native consumer role rules');
UPDATE public.tenant_members SET is_owner=false WHERE user_id=(SELECT member_id FROM e09_history_fixture);
CREATE TEMP TABLE e09_history_authority AS SELECT gen_random_uuid() AS parent_owner,gen_random_uuid() AS delegate,
 gen_random_uuid() AS platform_owner,gen_random_uuid() AS company_operator;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data)
 SELECT u,'authenticated','authenticated','history-authority-'||u||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'::jsonb
 FROM e09_history_authority f CROSS JOIN LATERAL unnest(ARRAY[f.parent_owner,f.delegate,f.platform_owner,f.company_operator])u;
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features)
 VALUES('e0901000-0000-0000-0000-000000000003','test-e09-history-agency','Synthetic E09 history agency','active','agency',NULL,'E09H',9400903,'{}'),
 ('e0901000-0000-0000-0000-000000000006','test-e09-history-company','Synthetic E09 history company','active','standalone',NULL,'E09H',9400906,'{"system_workspace":true}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features)
 VALUES('e0901000-0000-0000-0000-000000000004','test-e09-history-child','Synthetic E09 history child','active','sub_account','e0901000-0000-0000-0000-000000000003','E09H',9400904,'{}'),
 ('e0901000-0000-0000-0000-000000000005','test-e09-history-sibling','Synthetic E09 history sibling','active','sub_account','e0901000-0000-0000-0000-000000000003','E09H',9400905,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
 SELECT 'e0901000-0000-0000-0000-000000000003',parent_owner,'owner','active',true,now() FROM e09_history_authority;
INSERT INTO public.agency_team_members(agency_tenant_id,user_id,status,agency_role,scoped_subaccounts)
 SELECT 'e0901000-0000-0000-0000-000000000003',delegate,'active','agency_admin',ARRAY['e0901000-0000-0000-0000-000000000004']::uuid[] FROM e09_history_authority;
INSERT INTO public.user_roles(user_id,role)
 SELECT platform_owner,'super_admin'::public.app_role FROM e09_history_authority
 UNION ALL SELECT company_operator,'platform_admin'::public.app_role FROM e09_history_authority;
SELECT is((SELECT count(*) FROM public.tenant_members m CROSS JOIN e09_history_authority f
 WHERE m.tenant_id='e0901000-0000-0000-0000-000000000004' AND m.user_id IN(f.parent_owner,f.delegate)),0::bigint,
 'delegated positives have no target child seat');
SELECT is((SELECT count(*) FROM public.tenant_members m CROSS JOIN e09_history_authority f
 WHERE m.tenant_id='e0901000-0000-0000-0000-000000000006' AND m.user_id=f.company_operator),0::bigint,
 'company-operator positive has no company seat');
SELECT is(pg_temp.e09_history_call(parent_owner,parent_owner,'e0901000-0000-0000-0000-000000000004')->>'tenant_id',
 'e0901000-0000-0000-0000-000000000004','actual parent owner has child authority without a child seat') FROM e09_history_authority;
SELECT is(pg_temp.e09_history_call(delegate,delegate,'e0901000-0000-0000-0000-000000000004')->>'tenant_id',
 'e0901000-0000-0000-0000-000000000004','actual active agency admin has delegated consumer authority') FROM e09_history_authority;
UPDATE public.agency_team_members SET agency_role='agency_manager' WHERE user_id=(SELECT delegate FROM e09_history_authority);
SELECT is(pg_temp.e09_history_call(delegate,delegate,'e0901000-0000-0000-0000-000000000004')->>'tenant_id',
 'e0901000-0000-0000-0000-000000000004','actual active agency manager has delegated consumer authority') FROM e09_history_authority;
UPDATE public.agency_team_members SET agency_role='agency_specialist' WHERE user_id=(SELECT delegate FROM e09_history_authority);
SELECT is(pg_temp.e09_history_call(delegate,delegate,'e0901000-0000-0000-0000-000000000004')->>'tenant_id',
 'e0901000-0000-0000-0000-000000000004','actual scoped specialist has exact-child consumer authority') FROM e09_history_authority;
SELECT throws_ok($$SELECT pg_temp.e09_history_call(delegate,delegate,'e0901000-0000-0000-0000-000000000005') FROM e09_history_authority$$,'42501',NULL,'specialist cannot read off-scope sibling');
UPDATE public.agency_team_members SET agency_role='agency_viewer' WHERE user_id=(SELECT delegate FROM e09_history_authority);
SELECT throws_ok($$SELECT pg_temp.e09_history_call(delegate,delegate,'e0901000-0000-0000-0000-000000000004') FROM e09_history_authority$$,'42501',NULL,'agency viewer cannot read child history');
UPDATE public.agency_team_members SET agency_role='agency_admin',status='suspended' WHERE user_id=(SELECT delegate FROM e09_history_authority);
SELECT throws_ok($$SELECT pg_temp.e09_history_call(delegate,delegate,'e0901000-0000-0000-0000-000000000004') FROM e09_history_authority$$,'42501',NULL,'suspended agency admin cannot read child history');
UPDATE public.agency_team_members SET status='active' WHERE user_id=(SELECT delegate FROM e09_history_authority);
SELECT throws_ok($$SELECT pg_temp.e09_history_call(delegate,delegate,'e0901000-0000-0000-0000-000000000001') FROM e09_history_authority$$,'42501',NULL,'delegation does not authorize an unrelated business');
SELECT is(pg_temp.e09_history_call(platform_owner,platform_owner,'e0901000-0000-0000-0000-000000000001')->>'tenant_id',
 'e0901000-0000-0000-0000-000000000001','canonical platform owner has native consumer authority without a target seat') FROM e09_history_authority;
SELECT is(pg_temp.e09_history_call(company_operator,company_operator,'e0901000-0000-0000-0000-000000000006')->>'tenant_id',
 'e0901000-0000-0000-0000-000000000006','canonical company operator has actual is_tenant_admin authority without a company seat') FROM e09_history_authority;
SELECT throws_ok($$SELECT pg_temp.e09_history_call(company_operator,company_operator,'e0901000-0000-0000-0000-000000000001') FROM e09_history_authority$$,'42501',NULL,'company operator has no implied customer authority');
SELECT throws_ok($$SELECT pg_temp.e09_history_call(platform_owner,platform_owner,'e0901000-0000-0000-0000-000000000003') FROM e09_history_authority$$,'42501',NULL,'pure agency target still refused for platform owner');
SELECT throws_ok($$SELECT pg_temp.e09_history_call(platform_owner,platform_owner,'e0901000-0000-0000-0000-000000000099') FROM e09_history_authority$$,'42501',NULL,'even platform authority requires an existing exact named tenant');
SELECT throws_ok($$SELECT pg_temp.e09_history_call(platform_owner,platform_owner,NULL) FROM e09_history_authority$$,'42501',NULL,'no authority may infer an omitted target');
SELECT is(pg_temp.e09_consumer_authority_snapshot(),(SELECT state FROM e09_consumer_authority_before),
 'consumer authority behavior proof preserves the incumbent helper identities and definitions');

-- Extend the incumbent full-schema customer entry suite with its first assigned
-- work loop. Genuine Auth/provider/browser acceptance remains a separate claim.
SELECT is(has_function_privilege('anon','public.customer_respond_to_action(uuid,text,text,timestamptz)','EXECUTE'),false,
 'anonymous callers cannot invoke the versioned customer response writer');
INSERT INTO public.user_roles(user_id,role) SELECT owner_id,'admin'::public.app_role FROM e09_history_fixture ON CONFLICT DO NOTHING;
UPDATE public.profiles SET active_tenant_id='e0901000-0000-0000-0000-000000000001' WHERE user_id=(SELECT owner_id FROM e09_history_fixture);

CREATE FUNCTION pg_temp.e09_action_snapshot(_id uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object(
 'action',(SELECT to_jsonb(a) FROM public.paige_customer_actions a WHERE a.id=_id),
 'responses',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.paige_customer_responses r WHERE r.action_id=_id),
 'notifications',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM public.notifications n WHERE n.metadata->>'action_id'=_id::text),
 'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.paige_audit_log a WHERE a.target_id::text=_id::text),
 'linked',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.paige_actions a WHERE a.customer_action_id=_id),
 'rail',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.paige_client_events e WHERE e.ref_id::text=_id::text))
$$;
CREATE FUNCTION pg_temp.e09_action_case(_label text,_options jsonb DEFAULT '{}',_allow boolean DEFAULT false,
 _type text DEFAULT 'completed',_text text DEFAULT NULL)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE _actor uuid:=gen_random_uuid();_other uuid:=gen_random_uuid();_contact uuid:=gen_random_uuid();_survivor uuid:=gen_random_uuid();_action uuid:=gen_random_uuid();
 _tenant uuid:='e0901000-0000-0000-0000-000000000001';_foreign uuid:='e0901000-0000-0000-0000-000000000002';
 _owner uuid:=(SELECT owner_id FROM e09_history_fixture);_before jsonb;_result jsonb;_version timestamptz:='2026-01-01';_customer_read bigint;
BEGIN
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data)
 VALUES(_actor,'authenticated','authenticated','action-client-'||_actor||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 (_other,'authenticated','authenticated','action-other-'||_other||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
 INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,status,linked_user_id)
 VALUES(_contact,CASE WHEN _options?'foreign' THEN _foreign ELSE _tenant END,_owner,'Test','Action client',CASE WHEN _options?'archived' THEN 'archived' ELSE 'active' END,_actor),
 (_survivor,CASE WHEN _options?'foreign' THEN _foreign ELSE _tenant END,_owner,'Test','Survivor','active',NULL);
 IF _options?'merged' THEN
  -- Same privileged, rolled-back fixture setup as client_portal_self_projection;
  -- restore the native guard before switching to the actual customer role.
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  SET LOCAL ROLE service_role;
  PERFORM set_config('app.crm_merge_lineage_write','on',true);
  UPDATE public.clients SET merged_into_contact_id=_survivor,merged_at=now() WHERE id=_contact;
  PERFORM set_config('app.crm_merge_lineage_write','off',true);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims','{}',true);
 END IF;
 IF _options?'tenant_inactive' THEN UPDATE public.tenants SET status='suspended' WHERE id=_tenant;END IF;
 INSERT INTO public.paige_customer_actions(id,tenant_id,contact_id,initiated_by_admin_id,action_type,title,status,expires_at,updated_at)
 VALUES(_action,_tenant,_contact,_owner,'task','Prepare for your next session',CASE WHEN _options?'closed' THEN 'customer_acted' ELSE 'proposed' END,
  now()+CASE WHEN _options?'expired' THEN interval '-1 day' ELSE interval '1 day' END,_version);
 _before:=pg_temp.e09_action_snapshot(_action);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',CASE WHEN _options?'anonymous' THEN NULL WHEN _options?'wrong_actor' THEN _other ELSE _actor END,
  'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF _options?'legacy' THEN _result:=public.customer_respond_to_action(_action,_type,_text);
 ELSE _result:=public.customer_respond_to_action(_action,_type,_text,
   CASE WHEN _options?'missing_version' THEN NULL WHEN _options?'stale' THEN _version-interval '1 day' ELSE _version END);END IF;
 SELECT count(*) INTO _customer_read FROM public.paige_customer_responses WHERE action_id=_action;
 RESET ROLE;PERFORM set_config('request.jwt.claims','{}',true);
 RETURN NEXT is((_result->>'ok')::boolean,_allow,_label||': native response outcome');
 IF NOT _allow THEN
  RETURN NEXT is(pg_temp.e09_action_snapshot(_action),_before,_label||': no response, action, notification, audit, linked or Rail effects');
 ELSE
  RETURN NEXT is(_customer_read,1::bigint,_label||': actual customer role can reload the canonical saved response');
  RETURN NEXT is((SELECT responded_by_user_id FROM public.paige_customer_responses WHERE action_id=_action),_actor,_label||': actual actor attributed');
  RETURN NEXT is((SELECT status FROM public.paige_customer_actions WHERE id=_action),
    CASE WHEN _type='question' THEN 'proposed' WHEN _type='declined' THEN 'customer_declined' ELSE 'customer_acted' END,_label||': canonical status');
  RETURN NEXT is((SELECT count(*) FROM public.notifications WHERE user_id=_owner AND metadata->>'action_id'=_action::text),1::bigint,_label||': existing internal owner notification recorded');
  RETURN NEXT is((SELECT count(*) FROM public.paige_audit_log WHERE actor_user_id=_actor AND tenant_id=_tenant AND target_id::text=_action::text),1::bigint,_label||': durable exact action audit');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_other,'role','authenticated')::text,true);SET LOCAL ROLE authenticated;
  RETURN NEXT is((SELECT count(*) FROM public.paige_customer_actions WHERE id=_action),0::bigint,_label||': wrong customer cannot read the action');
  RETURN NEXT is((SELECT count(*) FROM public.paige_customer_responses WHERE action_id=_action),0::bigint,_label||': wrong customer cannot read the reply');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_owner,'role','authenticated')::text,true);SET LOCAL ROLE authenticated;
  RETURN NEXT is((SELECT count(*) FROM public.paige_customer_responses WHERE action_id=_action),1::bigint,_label||': legitimate business owner sees the same canonical reply');
  RESET ROLE;PERFORM set_config('request.jwt.claims','{}',true);
  UPDATE public.clients SET linked_user_id=_other WHERE id=_contact;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_other,'role','authenticated')::text,true);SET LOCAL ROLE authenticated;
  RETURN NEXT is((SELECT count(*) FROM public.paige_customer_responses WHERE action_id=_action AND responded_by_user_id=_actor),1::bigint,_label||': replacement login retains authorized contact history with original attribution');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);SET LOCAL ROLE authenticated;
  RETURN NEXT is((SELECT count(*) FROM public.paige_customer_responses WHERE action_id=_action),0::bigint,_label||': former login loses read access after contact relink');
  RESET ROLE;PERFORM set_config('request.jwt.claims','{}',true);
 END IF;
 IF _options?'tenant_inactive' THEN UPDATE public.tenants SET status='active' WHERE id=_tenant;END IF;
END;
$$;
SELECT * FROM pg_temp.e09_action_case('complete current assigned work','{}',true);
SELECT * FROM pg_temp.e09_action_case('acknowledge current request','{}',true,'accepted');
SELECT * FROM pg_temp.e09_action_case('decline current request','{}',true,'declined');
SELECT * FROM pg_temp.e09_action_case('ask about current request','{}',true,'question','Which preparation document should I use?');
SELECT * FROM pg_temp.e09_action_case('inactive customer','{"archived":true}');
SELECT * FROM pg_temp.e09_action_case('merged customer','{"merged":true}');
SELECT * FROM pg_temp.e09_action_case('inactive business','{"tenant_inactive":true}');
SELECT * FROM pg_temp.e09_action_case('foreign business/client tuple','{"foreign":true}');
SELECT * FROM pg_temp.e09_action_case('wrong actual customer','{"wrong_actor":true}');
SELECT * FROM pg_temp.e09_action_case('missing actual customer','{"anonymous":true}');
SELECT * FROM pg_temp.e09_action_case('stale viewed action','{"stale":true}');
SELECT * FROM pg_temp.e09_action_case('missing viewed version','{"missing_version":true}');
SELECT * FROM pg_temp.e09_action_case('cached old caller','{"legacy":true}');
SELECT * FROM pg_temp.e09_action_case('already closed action','{"closed":true}');
SELECT * FROM pg_temp.e09_action_case('expired action','{"expired":true}');
SELECT * FROM pg_temp.e09_action_case('empty question','{}',false,'question',' ');
SELECT * FROM pg_temp.e09_action_case('oversized question','{}',false,'question',repeat('x',4001));
SELECT * FROM pg_temp.e09_action_case('null response kind','{}',false,NULL);

-- E09_DOCUMENTS_BEGIN: actual native file/Storage/Rail contracts, same rolled-back suite.
SELECT is(has_function_privilege('anon','public.client_portal_begin_file_upload(uuid,uuid,text,text,bigint,uuid)','EXECUTE'),false,'anonymous upload reservation denied');
SELECT is(has_function_privilege('authenticated','public._client_portal_file_projection(public.client_files)','EXECUTE'),false,'internal file projector is not a consumer endpoint');
SELECT is(has_table_privilege('authenticated','public.paige_client_events','SELECT'),false,'raw Rail remains closed; use its incumbent scoped projection');
SELECT ok((SELECT NOT public AND file_size_limit=20971520 AND cardinality(allowed_mime_types)=4 FROM storage.buckets WHERE id='client-files'),'intended bucket is private with the approved20MB/type limit');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') OR EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='client_files'),'incumbent file subscriptions have native publication coverage where Realtime exists');

CREATE FUNCTION pg_temp.e09_document_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('files',(SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM public.client_files f),
 'objects',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM storage.objects o WHERE bucket_id='client-files'),
 'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_logs a),
 'rail',(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.paige_client_events e))
$$;
CREATE FUNCTION pg_temp.e09_document_case(_label text,_options jsonb DEFAULT '{}',_allow boolean DEFAULT false)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE _actor uuid:=gen_random_uuid();_other uuid:=gen_random_uuid();_contact uuid:=gen_random_uuid();_survivor uuid:=gen_random_uuid();_file uuid:=gen_random_uuid();
 _tenant uuid:=CASE WHEN _options?'new_business' THEN 'e0901000-0000-0000-0000-000000000002'::uuid ELSE 'e0901000-0000-0000-0000-000000000001'::uuid END;
 _foreign uuid:='e0901000-0000-0000-0000-000000000002';_owner uuid:=(SELECT owner_id FROM e09_history_fixture);
 _before jsonb;_result jsonb;_path text;_denied boolean:=false;_count bigint;_caller text;_failure text;_staff_context uuid;
 _staff_file uuid:=gen_random_uuid();_internal_file uuid:=gen_random_uuid();_shared_path text;_internal_path text;
BEGIN
 IF _options?'new_business' THEN
  INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES(_tenant,_owner,'owner','active',true,now());
 END IF;
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data)
 VALUES(_actor,'authenticated','authenticated','document-client-'||_actor||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 (_other,'authenticated','authenticated','document-other-'||_other||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
 INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,status,linked_user_id)
 VALUES(_contact,_tenant,_owner,'Test','Document client','active',_actor),(_survivor,_tenant,_owner,'Test','Survivor','active',NULL);
 IF _options?'hybrid' THEN
  INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES(_foreign,_actor,'admin','active',false,now());
  INSERT INTO public.user_roles(user_id,role) VALUES(_actor,'admin'::public.app_role) ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET active_tenant_id=_foreign WHERE user_id=_actor;
 END IF;
 PERFORM set_config('test.actor',_actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 _caller:=current_user;
 BEGIN
  _result:=public.client_portal_begin_file_upload(_file,CASE WHEN _options?'wrong_client' THEN _other ELSE _contact END,
   CASE WHEN _options?'bad_name' THEN '../secret.pdf' ELSE 'Preparation.pdf' END,
   CASE WHEN _options?'bad_type' THEN 'text/html' ELSE 'application/pdf' END,
   CASE WHEN _options?'oversized' THEN 20971521 ELSE 4 END,
   CASE WHEN _options?'wrong_business' THEN _foreign ELSE _tenant END);
 EXCEPTION WHEN OTHERS THEN _denied:=true; END;
 RESET ROLE;
 RETURN NEXT is(_caller,'authenticated',_label||': actual native customer role');
 IF _options?'wrong_client' OR _options?'bad_name' OR _options?'bad_type' OR _options?'oversized' OR _options?'wrong_business' THEN
  RETURN NEXT ok(_denied,_label||': reservation refused');
  RETURN NEXT is((SELECT count(*) FROM public.client_files WHERE id=_file),0::bigint,_label||': no reservation effect');
 ELSE
  RETURN NEXT ok(NOT _denied,_label||': authorized reservation');
  _path:=_result->>'storage_path';
  RETURN NEXT is(_path,_tenant::text||'/'||_contact::text||'/client_upload/'||_actor::text||'/'||_file::text,_label||': exact server namespace');
  -- Physical Storage transport is NOT simulated by a metadata row. The actual
  -- database policies are exercised here; live byte transfer remains proof owed.
  IF NOT (_options?'no_object') THEN
   IF _options?'bad_size' OR _options?'bad_mime' OR _options?'bad_owner' THEN
    INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('client-files',_path,
     CASE WHEN _options?'bad_owner' THEN _other::text ELSE _actor::text END,
     jsonb_build_object('size',CASE WHEN _options?'bad_size' THEN 5 ELSE 4 END,'mimetype',CASE WHEN _options?'bad_mime' THEN 'text/html' ELSE 'application/pdf' END));
   ELSE
    SET LOCAL ROLE authenticated;
    INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('client-files',_path,_actor::text,jsonb_build_object('size',4,'mimetype','application/pdf'));
    RESET ROLE;
   END IF;
  END IF;
  SET LOCAL ROLE authenticated;
  RETURN NEXT is((SELECT count(*) FROM storage.objects WHERE bucket_id='client-files' AND name=_path),0::bigint,_label||': pending object cannot be read');
  RESET ROLE;
  IF _options?'archived' THEN UPDATE public.clients SET status='archived' WHERE id=_contact; END IF;
  IF _options?'merged' THEN
   PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);SET LOCAL ROLE service_role;
   PERFORM set_config('app.crm_merge_lineage_write','on',true);
   UPDATE public.clients SET merged_into_contact_id=_survivor,merged_at=now() WHERE id=_contact;
   PERFORM set_config('app.crm_merge_lineage_write','off',true);RESET ROLE;
   RETURN NEXT is((SELECT merged_into_contact_id FROM public.clients WHERE id=_contact),_survivor,_label||': merged fixture reaches the intended guard');
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
  END IF;
  IF _options?'tenant_inactive' THEN UPDATE public.tenants SET status='suspended' WHERE id=_tenant; END IF;
  IF _options?'wrong_actor' THEN
   PERFORM set_config('test.actor',_other::text,true);
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_other,'role','authenticated')::text,true);
  END IF;
  _before:=pg_temp.e09_document_snapshot();_denied:=false;
  SET LOCAL ROLE authenticated;
  BEGIN _result:=public.client_portal_finish_file_upload(_file,_tenant); EXCEPTION WHEN OTHERS THEN _denied:=true;_failure:=SQLERRM; END;
  RESET ROLE;
  RETURN NEXT is(_denied,NOT _allow,_label||': expected finalization outcome');
  IF _options?'audit_failure' THEN RETURN NEXT is(_failure,'synthetic file audit refusal',_label||': intended audit guard caused refusal');END IF;
  IF NOT _allow THEN RETURN NEXT is(pg_temp.e09_document_snapshot(),_before,_label||': no file/audit/Rail effects');
  ELSE
   RETURN NEXT is(_result->>'upload_state','ready',_label||': final record ready');
   RETURN NEXT is((SELECT count(*) FROM public.audit_logs WHERE entity_id=_file AND action='file_uploaded' AND user_id=_actor),1::bigint,_label||': durable exact actor audit');
   RETURN NEXT is((SELECT count(*) FROM public.paige_client_events WHERE ref_id=_file AND contact_id=_contact AND tenant_id=_tenant AND actor_user_id=_actor AND event_kind='client.document_uploaded'),1::bigint,_label||': single canonical Rail event');
   SET LOCAL ROLE authenticated;
   RETURN NEXT is((SELECT count(*) FROM public.client_files WHERE id=_file),1::bigint,_label||': customer metadata reload');
   RETURN NEXT is((SELECT count(*) FROM storage.objects WHERE bucket_id='client-files' AND name=_path),1::bigint,_label||': customer object reload');
   _result:=public.client_portal_file_upload_status(_file,_tenant);
   RETURN NEXT is((_result->>'object_verified')::boolean,true,_label||': independently verified saved object');
   _result:=public.client_portal_file_upload_status(_other,_tenant);
   RETURN NEXT is(_result,jsonb_build_object('file',NULL,'object_verified',false),_label||': unrelated candidate status reveals no record');
   _denied:=false;
   BEGIN INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('client-files',_tenant::text||'/'||_contact::text||'/client_upload/'||_actor::text||'/'||_other::text,_actor::text,'{}');
   EXCEPTION WHEN OTHERS THEN _denied:=true;END;
   RETURN NEXT ok(_denied,_label||': unreserved object path refused');
   _denied:=false;
   BEGIN INSERT INTO public.client_files(tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,visibility)
    VALUES(_tenant,_contact,_actor,_path||'-forged','forged.pdf','client_upload');EXCEPTION WHEN OTHERS THEN _denied:=true;END;
   RETURN NEXT ok(_denied,_label||': direct forged customer metadata refused');
   RESET ROLE;
   _before:=pg_temp.e09_document_snapshot();
   SET LOCAL ROLE authenticated;_result:=public.client_portal_finish_file_upload(_file,_tenant);RESET ROLE;
   RETURN NEXT is(pg_temp.e09_document_snapshot(),_before,_label||': retry has no duplicate receipt or mutation');
   IF _options?'hybrid' THEN RETURN NEXT is((SELECT active_tenant_id FROM public.profiles WHERE user_id=_actor),_foreign,_label||': unrelated active staff workspace preserved');END IF;
   _staff_context:=(SELECT active_tenant_id FROM public.profiles WHERE user_id=_owner);
   UPDATE public.profiles SET active_tenant_id=_tenant WHERE user_id=_owner;
   PERFORM set_config('test.actor',_owner::text,true);
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_owner,'role','authenticated')::text,true);
   SET LOCAL ROLE authenticated;
   RETURN NEXT is((SELECT count(*) FROM public.client_files WHERE id=_file),1::bigint,_label||': owner reloads the same canonical file');
   RETURN NEXT is((SELECT count(*) FROM storage.objects WHERE bucket_id='client-files' AND name=_path),1::bigint,_label||': actual owner can retrieve its customer file');
   -- The owner's files go through the governed owner writers (20271110200000): a staff PUT now
   -- needs a pending reservation, so the earlier PUT-then-insert fixture shape is refused by design.
   _shared_path:=public.client_file_owner_begin_upload(_owner,_tenant,_contact,_staff_file,'Shared preparation.pdf','application/pdf',4)#>>'{file,storage_path}';
   _internal_path:=public.client_file_owner_begin_upload(_owner,_tenant,_contact,_internal_file,'Internal preparation.pdf','application/pdf',4)#>>'{file,storage_path}';
   INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
    VALUES('client-files',_shared_path,_owner::text,jsonb_build_object('size',4,'mimetype','application/pdf')),
    ('client-files',_internal_path,_owner::text,jsonb_build_object('size',4,'mimetype','application/pdf'));
   RETURN NEXT is(public.client_file_owner_finish_upload(_owner,_tenant,_staff_file)#>>'{file,upload_state}','ready',_label||': owner finishes the file to share');
   RETURN NEXT is(public.client_file_owner_finish_upload(_owner,_tenant,_internal_file)#>>'{file,upload_state}','ready',_label||': owner finishes the private file');
   RETURN NEXT is(public.client_file_set_client_share(_owner,_tenant,_staff_file,true,
    (SELECT updated_at FROM public.client_files WHERE id=_staff_file))->>'ok','true',_label||': owner shares one file with the customer');
   PERFORM public.record_rail_event(p_contact_id=>_contact,p_event_kind=>'client.document_uploaded',p_surface=>'client_portal',
    p_actor_type=>'client',p_title=>'Existing staff producer',p_ref_table=>'client_files',p_ref_id=>_staff_file,p_tenant_id=>_tenant);
   -- Actual writer above ran with the owner JWT/role. Raw Rail SELECT remains
   -- deliberately revoked in production; fixture-administrator readback below
   -- proves the effect without inventing an ordinary caller grant.
   RESET ROLE;
   RETURN NEXT is((SELECT count(*) FROM public.paige_client_events WHERE ref_id=_staff_file AND actor_user_id=_owner AND tenant_id=_tenant),1::bigint,
    _label||': incumbent staff producer without a customer identity retains native Rail authority');
   UPDATE public.profiles SET active_tenant_id=_staff_context WHERE user_id=_owner;
   PERFORM set_config('test.actor',_actor::text,true);
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
   SET LOCAL ROLE authenticated;
   RETURN NEXT is((SELECT count(*) FROM public.client_files WHERE id=_staff_file),1::bigint,_label||': customer reloads the incumbent owner-shared file');
   RETURN NEXT is((SELECT count(*) FROM storage.objects WHERE bucket_id='client-files' AND name=_shared_path),1::bigint,_label||': owner-shared object is authorized');
   RETURN NEXT is((SELECT count(*) FROM public.client_files WHERE id=_internal_file),0::bigint,_label||': internal metadata stays private');
   RETURN NEXT is((SELECT count(*) FROM storage.objects WHERE bucket_id='client-files' AND name=_internal_path),0::bigint,_label||': internal bytes stay private');
   RESET ROLE;
   -- A foreign caller sees neither file nor object and cannot use status as an oracle.
   PERFORM set_config('test.actor',_other::text,true);
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_other,'role','authenticated')::text,true);
   SET LOCAL ROLE authenticated;
   RETURN NEXT is((SELECT count(*) FROM public.client_files WHERE id=_file),0::bigint,_label||': wrong customer metadata denied');
   RETURN NEXT is((SELECT count(*) FROM storage.objects WHERE bucket_id='client-files' AND name=_path),0::bigint,_label||': wrong customer object denied');
   RESET ROLE;
   PERFORM set_config('test.actor',_actor::text,true);
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated')::text,true);
   SET LOCAL ROLE authenticated;
   UPDATE storage.objects SET metadata='{}' WHERE bucket_id='client-files' AND name=_path;GET DIAGNOSTICS _count=ROW_COUNT;
   RETURN NEXT is(_count,0::bigint,_label||': object overwrite refused');
   RESET ROLE;
   UPDATE public.clients SET status='archived' WHERE id=_contact;
   SET LOCAL ROLE authenticated;
   RETURN NEXT is((SELECT count(*) FROM public.client_files WHERE id=_file),0::bigint,_label||': revoked customer loses metadata access');
   RETURN NEXT is((SELECT count(*) FROM storage.objects WHERE bucket_id='client-files' AND name=_path),0::bigint,_label||': revoked customer loses object access');
   RESET ROLE;
  END IF;
  IF _options?'tenant_inactive' THEN UPDATE public.tenants SET status='active' WHERE id=_tenant; END IF;
 END IF;
 PERFORM set_config('test.actor','',true);PERFORM set_config('request.jwt.claims','{}',true);
END $$;

SELECT * FROM pg_temp.e09_document_case('ordinary customer file', '{}',true);
SELECT * FROM pg_temp.e09_document_case('separate staff workspace', '{"hybrid":true}',true);
SELECT * FROM pg_temp.e09_document_case('other eligible business', '{"new_business":true}',true);
SELECT * FROM pg_temp.e09_document_case('wrong expected client','{"wrong_client":true}');
SELECT * FROM pg_temp.e09_document_case('wrong business','{"wrong_business":true}');
SELECT * FROM pg_temp.e09_document_case('unsafe file name','{"bad_name":true}');
SELECT * FROM pg_temp.e09_document_case('unapproved type','{"bad_type":true}');
SELECT * FROM pg_temp.e09_document_case('over20MB','{"oversized":true}');
SELECT * FROM pg_temp.e09_document_case('missing object','{"no_object":true}');
SELECT * FROM pg_temp.e09_document_case('wrong object size','{"bad_size":true}');
SELECT * FROM pg_temp.e09_document_case('wrong object MIME','{"bad_mime":true}');
SELECT * FROM pg_temp.e09_document_case('wrong object owner','{"bad_owner":true}');
SELECT * FROM pg_temp.e09_document_case('wrong finalizing customer','{"wrong_actor":true}');
SELECT * FROM pg_temp.e09_document_case('revoked before finalize','{"archived":true}');
SELECT * FROM pg_temp.e09_document_case('merged before finalize','{"merged":true}');
SELECT * FROM pg_temp.e09_document_case('suspended before finalize','{"tenant_inactive":true}');
CREATE FUNCTION pg_temp.e09_reject_document_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NEW.action='file_uploaded' THEN RAISE EXCEPTION 'synthetic file audit refusal';END IF;RETURN NEW;END$$;
CREATE TRIGGER e09_document_audit_refusal BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.e09_reject_document_audit();
SELECT * FROM pg_temp.e09_document_case('failed audit rolls back file and canonical Rail','{"audit_failure":true}');
DROP TRIGGER e09_document_audit_refusal ON public.audit_logs;
-- E09_DOCUMENTS_END

SELECT * FROM finish();
ROLLBACK;
