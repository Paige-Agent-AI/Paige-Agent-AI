-- Runs against the complete isolated schema replayed by the EXISTING database-contract job.
-- Actual authenticated/anonymous database callers; synthetic identities; all data rolls back.
BEGIN;
SELECT no_plan();

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

CREATE FUNCTION pg_temp.e09_call(_token text,_actor uuid,_allow boolean,_label text)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE _before jsonb:=pg_temp.e09_snapshot(); _denied boolean:=false; _result uuid; _role text;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',CASE WHEN _actor IS NULL THEN 'anon' ELSE 'authenticated' END,
  'email','claimed-recipient@tests.invalid','email_verified',true)::text,true);
 IF _actor IS NULL THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
 _role:=current_user;
 BEGIN SELECT public.accept_tenant_invite(_token) INTO _result; EXCEPTION WHEN OTHERS THEN _denied:=true; END;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claim.role','',true);
 RETURN NEXT ok(_role=CASE WHEN _actor IS NULL THEN 'anon' ELSE 'authenticated' END,_label||': actual caller role');
 RETURN NEXT ok(_denied=NOT _allow,_label||': expected acceptance or refusal');
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
 INSERT INTO public.tenant_invite_tokens(id,tenant_id,token,kind,default_role,created_by,expires_at,max_uses,uses,last_used_at,revoked_at,contact_id,email)
 VALUES(_inv,_a,_token,'consumer','member',_owner,now()+CASE WHEN _options?'expired' THEN interval '-1 day' ELSE interval '1 day' END,NULL,
 CASE WHEN _options?'used' THEN 1 ELSE 0 END,CASE WHEN _options?'last_used' THEN now() ELSE NULL END,
 CASE WHEN _options?'revoked' THEN now() ELSE NULL END,CASE WHEN _options?'unbound' THEN NULL ELSE _client END,
 CASE WHEN _options?'no_recipient' THEN NULL ELSE _email END);
 RETURN QUERY SELECT * FROM pg_temp.e09_call(_token,CASE WHEN _options?'anonymous' THEN NULL ELSE _actor END,_allow,_name);
 IF _allow THEN
  RETURN NEXT is((SELECT linked_user_id FROM public.clients WHERE id=_client),_actor,_name||': exact CRM contact linked');
  RETURN NEXT is((SELECT count(*) FROM public.tenant_members WHERE user_id=_actor),0::bigint,_name||': no business seat');
  RETURN NEXT ok(NOT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=_actor AND active_tenant_id=_a),_name||': no staff workspace selection');
  RETURN NEXT is((SELECT uses FROM public.tenant_invite_tokens WHERE id=_inv),1,_name||': single token consumption');
  RETURN NEXT is((SELECT count(*) FROM public.audit_logs WHERE entity_id=_inv AND user_id=_actor AND action='consumer_invite_accepted'
   AND data->>'tenant_id'=_a::text AND data->>'client_id'=_client::text),1::bigint,_name||': attributable acceptance receipt');
  RETURN QUERY SELECT * FROM pg_temp.e09_call(_token,_actor,false,_name||' replay');
 END IF;
END;
$$;

SELECT * FROM pg_temp.e09_case('verified external client','{}',true);
SELECT * FROM pg_temp.e09_case('wrong recipient despite spoofed JWT email','{"wrong":true}');
SELECT * FROM pg_temp.e09_case('unconfirmed recipient','{"unconfirmed":true}');
SELECT * FROM pg_temp.e09_case('anonymous','{"anonymous":true}');
SELECT * FROM pg_temp.e09_case('missing recipient','{"no_recipient":true}');
SELECT * FROM pg_temp.e09_case('expired','{"expired":true}');
SELECT * FROM pg_temp.e09_case('revoked','{"revoked":true}');
SELECT * FROM pg_temp.e09_case('unlimited legacy token already used','{"used":true}');
SELECT * FROM pg_temp.e09_case('recorded acceptance count drift','{"last_used":true}');
SELECT * FROM pg_temp.e09_case('foreign exact contact','{"foreign":true}');
SELECT * FROM pg_temp.e09_case('occupied exact contact','{"occupied":true}');
SELECT * FROM pg_temp.e09_case('archived exact contact','{"archived":true}');
SELECT * FROM pg_temp.e09_case('unbound token','{"unbound":true}');
SELECT * FROM finish();
ROLLBACK;
