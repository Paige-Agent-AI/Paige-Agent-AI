-- ORIGINAL full Supabase schema only, after native35 and normal grant replay.
-- Real signup/role/contact/form/submission functions and triggers remain enabled.
-- Every synthetic row rolls back. No provider, HTTP, durable commit or parallel
-- lock-race proof is claimed by this SQL. Those belong to the owning native tests.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='90s';
SET LOCAL timezone='UTC';

CREATE TEMP TABLE e06it_assertions(label text);
GRANT INSERT,SELECT ON e06it_assertions TO authenticated,anon,service_role;
CREATE FUNCTION pg_temp.e06it_assert(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'EXP06_INTAKE_FULL_SCHEMA_FAIL: %',label; END IF;
 INSERT INTO e06it_assertions VALUES(label);
END $$;
CREATE FUNCTION pg_temp.e06it_refuses(command text,expected text,label text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
 BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE; END;
 PERFORM pg_temp.e06it_assert(actual=expected,label);
END $$;
CREATE FUNCTION pg_temp.e06it_actor(actor uuid) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',actor::text,true),set_config('request.jwt.claim.role','authenticated',true),
  set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true) $$;
CREATE FUNCTION pg_temp.e06it_server() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true),
  set_config('request.jwt.claims','{"role":"service_role"}',true) $$;

-- Fail on an isolated port/stub database; never install its missing authority.
SELECT pg_temp.e06it_assert(
 to_regprocedure('public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean,text[])') IS NOT NULL
 AND to_regprocedure('public.growth_apply_submission_contact_tags(uuid,integer,uuid,uuid,uuid,text,text[])') IS NOT NULL
 AND to_regprocedure('public.growth_submission_contact_tags_state(uuid,uuid,uuid)') IS NOT NULL
 AND md5(pg_get_functiondef('public._growth_submission_contact_tags_guard()'::regprocedure))='6b3dc1efe7182da53d3c8a358057f0e0'
 AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.growth_form_submissions'::regclass
  AND attname='contact_tags_result' AND atttypid='jsonb'::regtype AND NOT attnotnull AND NOT attisdropped),
 'actual candidate35 setting/apply/state/private-field and strict thirty-two KiB guard prerequisites installed');
DO $original_sources$
DECLARE signature text; digest text;
BEGIN
 FOR signature,digest IN SELECT * FROM (VALUES
  ('public.handle_new_user()','9a1e676ad5daab60e9c9d79c6df8bbe4'),
  ('public.guard_operator_account_archive()','c960dc79a2c86f63045aa16e4bd01e2f'),
  ('public.map_tenant_role_to_app_role(tenant_role)','73646fcb609b1d0c2fb99e286d224cd4'),
  ('public.sync_tenant_member_to_user_roles()','214ecbb2710456ff88d59ee74955240d'),
  ('public.growth_form_set_intake(uuid,boolean,uuid,uuid,text)','e963cbff6abd16df5ced5b14e5ffd856'),
  ('public.upsert_contact(jsonb,uuid,uuid,uuid,text)','0d05ed2429366f1215c3d7363ee56b4b'),
  ('public.create_contact(text,text,text,text,text,text,text,text,text[],text,text,uuid,uuid,uuid,text)','14cfe712978ef91edb01f22ea8582f2d'),
  ('public.resolve_contact_id(uuid,text,text,uuid)','c08c36e0fc1a4eae16dad602ada8dc46'),
  ('public.growth_claim_submission(uuid)','ed763cd4842825b4da4400c264043eae'),
  ('public.growth_complete_submission(uuid)','76d3be4daedd234c85ff0ce3fe7cb262'),
  ('public.growth_fail_submission(uuid,text)','1e837d59e4d72d75870b3c44d9218979'),
  ('public.growth_attach_submission_deal(uuid,integer,uuid)','cced6dc8d2410b82add277fc1fdbdc3b'),
  ('public.growth_publish_state_guard()','bedfb266401e59224813f45ea5a6dfa7'),
  ('public.growth_public_form(uuid,uuid,text)','d32a85cbc8c47d2831231916c799aeed')
 ) p(signature,digest) LOOP
  PERFORM pg_temp.e06it_assert(to_regprocedure(signature) IS NOT NULL
   AND md5(pg_get_functiondef(to_regprocedure(signature)))=digest,'original full-schema function preserved: '||signature);
 END LOOP;
 PERFORM pg_temp.e06it_assert(EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass
  AND tgfoid='public.handle_new_user()'::regprocedure AND tgenabled='O' AND NOT tgisinternal)
  AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.tenant_members'::regclass
   AND tgfoid='public.sync_tenant_member_to_user_roles()'::regprocedure AND tgenabled='O' AND NOT tgisinternal),
  'original signup and membership/global-role sync triggers enabled');
END $original_sources$;
CREATE TEMP TABLE e06it_catalog AS
 SELECT p.oid,to_jsonb(p) metadata FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','auth','private');
SELECT pg_temp.e06it_assert((SELECT pronargdefaults=0 AND prosecdef AND proowner='postgres'::regrole
 FROM pg_proc WHERE oid='public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean,text[])'::regprocedure)
 AND has_function_privilege('authenticated','public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean,text[])','EXECUTE')
 AND NOT has_function_privilege('service_role','public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean,text[])','EXECUTE')
 AND NOT has_function_privilege('anon','public.growth_form_set_intake(uuid,boolean,uuid,uuid,text,boolean,text[])','EXECUTE'),
 'new nondefault setting ABI retains original authenticated-only lane');
SELECT pg_temp.e06it_assert((SELECT prosecdef AND provolatile='s' AND proowner='postgres'::regrole
 FROM pg_proc WHERE oid='public.growth_submission_contact_tags_state(uuid,uuid,uuid)'::regprocedure)
 AND has_function_privilege('service_role','public.growth_apply_submission_contact_tags(uuid,integer,uuid,uuid,uuid,text,text[])','EXECUTE')
 AND has_function_privilege('service_role','public.growth_submission_contact_tags_state(uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.growth_apply_submission_contact_tags(uuid,integer,uuid,uuid,uuid,text,text[])','EXECUTE')
 AND NOT has_function_privilege('anon','public.growth_submission_contact_tags_state(uuid,uuid,uuid)','EXECUTE'),
 'native apply/service-only stable result reader have no browser effect authority');
SELECT pg_temp.e06it_assert((SELECT count(*)=27 FROM pg_attribute WHERE attrelid='public.growth_form_submissions'::regclass
 AND attnum>0 AND NOT attisdropped AND has_column_privilege('authenticated',attrelid,attname,'SELECT'))
 AND NOT has_table_privilege('authenticated','public.growth_form_submissions','SELECT')
 AND NOT has_column_privilege('authenticated','public.growth_form_submissions','contact_tags_result','SELECT')
 AND (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid='public.growth_form_submissions'::regclass),
 'exact original twenty-seven-column authenticated projection retains RLS and excludes only new causal data');

CREATE TEMP TABLE e06it_fixture(actor_a uuid,actor_b uuid,actor_c uuid,tenant_a uuid,tenant_b uuid,tag text,
 form_a uuid,form_legacy uuid,form_b uuid,form_disabled uuid,form_wide uuid,pipeline_a uuid,pipeline_b uuid,stage_a uuid,stage_b uuid,
 automation_a uuid,contact_existing uuid,contact_new uuid,contact_nochange uuid,contact_overflow uuid,contact_rollback uuid,contact_b uuid,contact_wide uuid,
 sub_applied uuid,sub_new uuid,sub_nochange uuid,sub_stale uuid,sub_badclaim uuid,sub_overflow uuid,sub_rollback uuid,
 sub_legacy uuid,sub_forgery uuid,sub_b uuid,sub_wide uuid);
INSERT INTO e06it_fixture(actor_a,actor_b,actor_c,tenant_a,tenant_b,tag,form_a,form_legacy,form_b,form_disabled,form_wide,stage_a,stage_b)
 VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'e06it-'||replace(gen_random_uuid()::text,'-',''),
 gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
-- Identifiers only; do not expose causal JSON through fixture grants.
GRANT SELECT ON e06it_fixture TO authenticated,anon,service_role;
CREATE TEMP TABLE e06it_results(label text PRIMARY KEY,result jsonb);
GRANT INSERT,SELECT,UPDATE ON e06it_results TO service_role;

SELECT pg_temp.e06it_server();
DO $fixture$
DECLARE f e06it_fixture; c uuid; new_email text;
BEGIN
 SELECT * INTO f FROM e06it_fixture;
 INSERT INTO auth.users(id,email) VALUES(f.actor_a,f.tag||'-a@example.invalid'),(f.actor_b,f.tag||'-b@example.invalid'),(f.actor_c,f.tag||'-c@example.invalid');
 INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features)
  VALUES(f.tenant_a,f.tag||'-a','EXP06 rollback intake A','active','standalone','ITA','{}'),
        (f.tenant_b,f.tag||'-b','EXP06 rollback intake B','active','standalone','ITB','{}');
 INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner)
  VALUES(f.tenant_a,f.actor_a,'owner','active',true),(f.tenant_b,f.actor_b,'owner','active',true),(f.tenant_a,f.actor_c,'owner','active',true);
 UPDATE public.profiles SET active_tenant_id=f.tenant_a WHERE user_id=f.actor_a;
 UPDATE public.profiles SET active_tenant_id=f.tenant_b WHERE user_id=f.actor_b;
 UPDATE public.profiles SET active_tenant_id=f.tenant_a WHERE user_id=f.actor_c;
 PERFORM pg_temp.e06it_assert(public.has_any_role(f.actor_a,ARRAY['admin','coach'])
  AND public.has_any_role(f.actor_b,ARRAY['admin','coach'])
  AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id IN(f.actor_a,f.actor_b,f.actor_c)
   AND role::text IN('super_admin','platform_admin','developer')),
  'ordinary owner fixtures receive real original business roles; no platform role seed or auth port');
 PERFORM set_config('app.pipeline_created_through','paige',true);
 PERFORM set_config('app.pipeline_requested_by',f.actor_a::text,true);
 INSERT INTO public.pipelines(tenant_id,name,is_default) VALUES(f.tenant_a,'Intake A',true) RETURNING id INTO f.pipeline_a;
 PERFORM set_config('app.pipeline_requested_by',f.actor_b::text,true);
 INSERT INTO public.pipelines(tenant_id,name,is_default) VALUES(f.tenant_b,'Intake B',true) RETURNING id INTO f.pipeline_b;
 INSERT INTO public.pipeline_stages(id,pipeline_id,tenant_id,label,order_index,probability,stage_type)
  VALUES(f.stage_a,f.pipeline_a,f.tenant_a,'New request',1,10,'open'),(f.stage_b,f.pipeline_b,f.tenant_b,'New request',1,10,'open');
 INSERT INTO public.growth_forms(id,tenant_id,slug,name,status,schema_json,created_by,lead_reply_enabled,auto_create_contact)
  VALUES(f.form_a,f.tenant_a,f.tag||'-form','Intake tags A','active','{"sections":[]}',f.actor_a,true,true),
        (f.form_legacy,f.tenant_a,f.tag||'-legacy','Legacy intake A','active','{"sections":[]}',f.actor_a,false,true),
        (f.form_b,f.tenant_b,f.tag||'-form','Intake tags B','active','{"sections":[]}',f.actor_b,false,true),
        (f.form_disabled,f.tenant_a,f.tag||'-disabled','Contact creation stays off','draft','{"sections":[]}',f.actor_a,false,false),
        (f.form_wide,f.tenant_a,f.tag||'-wide','Full admitted Unicode setting','active','{"sections":[]}',f.actor_a,false,true);
 INSERT INTO public.growth_form_automations(tenant_id,form_id,target_slug,order_index,enabled,config_json,created_by)
  VALUES(f.tenant_a,f.form_a,'contact_upsert',10,true,'{"kept":"original"}',f.actor_a) RETURNING id INTO f.automation_a;
 f.contact_existing:=public.upsert_contact('{"first_name":"Existing","last_name":"Fixture","tags":["Legacy","Legacy","Campaign"]}',NULL,f.tenant_a,f.actor_a,'api');
 f.contact_nochange:=public.upsert_contact('{"first_name":"No change","last_name":"Fixture","tags":["Legacy","Legacy","Campaign","North"]}',NULL,f.tenant_a,f.actor_a,'api');
 f.contact_overflow:=public.upsert_contact(jsonb_build_object('first_name','Overflow','last_name','Fixture','tags',
  (SELECT jsonb_agg('Existing '||n ORDER BY n) FROM generate_series(1,50) n)),NULL,f.tenant_a,f.actor_a,'api');
 f.contact_rollback:=public.upsert_contact('{"first_name":"Rollback","last_name":"Fixture","tags":["Keep"]}',NULL,f.tenant_a,f.actor_a,'api');
 f.contact_b:=public.upsert_contact('{"first_name":"Foreign","last_name":"Fixture","tags":[]}',NULL,f.tenant_b,f.actor_b,'api');
 f.contact_wide:=public.upsert_contact('{"first_name":"Wide Unicode","last_name":"Fixture","tags":[]}',NULL,f.tenant_a,f.actor_a,'api');
 -- The processor's ORIGINAL new-contact seam and resolver, with its actual fifteen named arguments.
 new_email:=f.tag||'-lead@example.invalid';
 PERFORM pg_temp.e06it_assert(public.resolve_contact_id(f.tenant_a,NULL,new_email,NULL) IS NULL,'new contact begins unresolved');
 f.contact_new:=public.create_contact(p_first_name=>'New',p_last_name=>'Fixture',p_email=>new_email,p_phone=>NULL,
  p_entity_name=>NULL,p_title=>NULL,p_lifecycle_stage=>'new_lead',p_source=>'paige_form',p_tags=>'{}'::text[],
  p_primary_offer=>NULL,p_notes=>NULL,p_assigned_coach_user_id=>NULL,p_tenant_id=>f.tenant_a,p_created_by=>f.actor_a,p_channel=>'form');
 PERFORM pg_temp.e06it_assert(public.resolve_contact_id(f.tenant_a,NULL,new_email,NULL)=f.contact_new
  AND public.resolve_contact_id(f.tenant_b,NULL,new_email,NULL) IS NULL,
  'real original create resolves only within its claimed business');
 UPDATE e06it_fixture SET pipeline_a=f.pipeline_a,pipeline_b=f.pipeline_b,automation_a=f.automation_a,
  contact_existing=f.contact_existing,contact_new=f.contact_new,contact_nochange=f.contact_nochange,
  contact_overflow=f.contact_overflow,contact_rollback=f.contact_rollback,contact_b=f.contact_b,contact_wide=f.contact_wide;
END $fixture$;

DO $settings$
DECLARE f e06it_fixture; saved public.growth_forms; audits bigint; fifty text[];
BEGIN
 SELECT * INTO f FROM e06it_fixture;
 SELECT count(*) INTO audits FROM public.audit_logs WHERE entity='growth_forms' AND entity_id=f.form_a AND action='growth_form_set_intake';
 PERFORM pg_temp.e06it_actor(f.actor_a); SET LOCAL ROLE authenticated;
 saved:=public.growth_form_set_intake(f.form_a,true,f.pipeline_a,f.stage_a,' Alerts@Example.invalid ',NULL,ARRAY[' Campaign ','Campaign','North']);
 RESET ROLE;
 PERFORM pg_temp.e06it_assert(saved.future_tags=ARRAY['Campaign','North'] AND saved.lead_reply_enabled
  AND saved.pipeline_id=f.pipeline_a AND saved.stage_id=f.stage_a AND saved.notify_email='Alerts@Example.invalid'
  AND (SELECT config_json->'future_tags'='["Campaign","North"]' AND config_json->>'kept'='original'
   FROM public.growth_form_automations WHERE id=f.automation_a)
  AND (SELECT count(*)=audits+1 FROM public.audit_logs WHERE entity='growth_forms' AND entity_id=f.form_a AND action='growth_form_set_intake'),
  'seven args normalize first occurrence tags, merge config and preserve route/reply/one original audit');
 SET LOCAL ROLE authenticated;
 saved:=public.growth_form_set_intake(f.form_a,true,f.pipeline_a,f.stage_a,'Alerts@Example.invalid');
 saved:=public.growth_form_set_intake(f.form_a,true,f.pipeline_a,f.stage_a,'Alerts@Example.invalid',NULL);
 RESET ROLE;
 PERFORM pg_temp.e06it_assert(saved.future_tags=ARRAY['Campaign','North'] AND saved.lead_reply_enabled
  AND (SELECT count(*)=audits+3 FROM public.audit_logs WHERE entity='growth_forms' AND entity_id=f.form_a AND action='growth_form_set_intake'),
  'original five/six omission preserves tags and reply with one audit per save');
 SET LOCAL ROLE authenticated;
 saved:=public.growth_form_set_intake(f.form_a,true,f.pipeline_a,f.stage_a,'Alerts@Example.invalid',NULL,NULL);
 RESET ROLE;
 PERFORM pg_temp.e06it_assert(saved.future_tags=ARRAY['Campaign','North'] AND saved.lead_reply_enabled,
  'explicit nullable seventh argument preserves the current future-tag setting');
 SET LOCAL ROLE authenticated;
 saved:=public.growth_form_set_intake(f.form_a,true,f.pipeline_a,f.stage_a,'Alerts@Example.invalid',false);
 saved:=public.growth_form_set_intake(f.form_a,true,f.pipeline_a,f.stage_a,'Alerts@Example.invalid',NULL,'{}');
 RESET ROLE;
 PERFORM pg_temp.e06it_assert(saved.future_tags='{}'::text[] AND NOT saved.lead_reply_enabled,
  'six args still changes reply; seven empty clears only future tags, nullable reply preserves it');
 SET LOCAL ROLE authenticated;
 saved:=public.growth_form_set_intake(f.form_a,true,f.pipeline_a,f.stage_a,'Alerts@Example.invalid',true,ARRAY['Campaign','North']);
 saved:=public.growth_form_set_intake(f.form_disabled,false,NULL,NULL,NULL,NULL,ARRAY['Future']);
 RESET ROLE;
 PERFORM pg_temp.e06it_assert(NOT saved.auto_create_contact AND NOT saved.auto_create_deal,
  'configuring future tags does not enable an original disabled contact/deal path');
 SET LOCAL ROLE authenticated;
 SELECT array_agg('Tag '||n ORDER BY n) INTO fifty FROM generate_series(1,50)n;
 saved:=public.growth_form_set_intake(f.form_disabled,false,NULL,NULL,NULL,NULL,fifty||ARRAY[' Tag 1 ']);
 RESET ROLE;
 PERFORM pg_temp.e06it_assert(saved.future_tags=fifty,'exactly fifty unique tags remain valid after first-occurrence de-duplication');
 SET LOCAL ROLE authenticated;
 saved:=public.growth_form_set_intake(f.form_disabled,false,NULL,NULL,NULL,NULL,ARRAY[repeat('😀',80),'A, B','vip','VIP']);
 RESET ROLE;
 PERFORM pg_temp.e06it_assert(saved.future_tags=ARRAY[repeat('😀',80),'A, B','vip','VIP'],
  'eighty Unicode characters, punctuation and case-sensitive names survive unchanged');
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.e06it_refuses(format('select public.growth_form_set_intake(%L,false,NULL,NULL,NULL,NULL,ARRAY[%L])',f.form_a,chr(128)),'22023','setting rejects C1 control');
 PERFORM pg_temp.e06it_refuses(format('select public.growth_form_set_intake(%L,false,NULL,NULL,NULL,NULL,ARRAY[%L])',f.form_a,E'bad\ttag'),'22023','setting rejects C0 control');
 PERFORM pg_temp.e06it_refuses(format('select public.growth_form_set_intake(%L,false,NULL,NULL,NULL,NULL,ARRAY[%L])',f.form_a,repeat('X',81)),'22023','setting rejects eighty-one characters');
 PERFORM pg_temp.e06it_refuses(format('select public.growth_form_set_intake(%L,false,NULL,NULL,NULL,NULL,ARRAY['' ''])',f.form_a),'22023','setting rejects blank tag');
 PERFORM pg_temp.e06it_refuses(format('select public.growth_form_set_intake(%L,false,NULL,NULL,NULL,NULL,ARRAY[[''A''],[''B'']])',f.form_a),'22023','setting rejects a multi-dimensional tag list');
 PERFORM pg_temp.e06it_refuses(format('select public.growth_form_set_intake(%L,false,NULL,NULL,NULL,NULL,(select array_agg(''Tag ''||n) from generate_series(1,51)n))',f.form_a),'22023','setting rejects fifty-one unique tags');
 PERFORM pg_temp.e06it_refuses(format('select public.growth_form_set_intake(%L,true,%L,%L,NULL,NULL,ARRAY[''Tag''])',f.form_a,f.pipeline_b,f.stage_b),'22023','new setter retains foreign pipeline refusal');
 PERFORM pg_temp.e06it_refuses(format('select public.growth_form_set_intake(%L,true,%L,%L,NULL,NULL,ARRAY[''Tag''])',f.form_a,f.pipeline_a,f.stage_b),'22023','new setter retains stage/pipeline binding');
 PERFORM pg_temp.e06it_refuses(format('select public.growth_form_set_intake(%L,false,NULL,NULL,''not-an-address'',NULL,ARRAY[''Tag''])',f.form_a),'22023','new setter retains email validation');
 PERFORM pg_temp.e06it_refuses(format('update public.growth_forms set future_tags=ARRAY[''Forged''] where id=%L',f.form_a),'42501','original all-column form guard rejects authenticated direct tag setting');
 RESET ROLE;
 PERFORM pg_temp.e06it_actor(f.actor_b); SET LOCAL ROLE authenticated;
 PERFORM pg_temp.e06it_refuses(format('select public.growth_form_set_intake(%L,false,NULL,NULL,NULL,NULL,ARRAY[''Foreign''])',f.form_a),'42501','foreign ordinary admin has no setting authority');
 RESET ROLE;
 PERFORM pg_temp.e06it_actor(f.actor_a); SET LOCAL ROLE authenticated;
 saved:=public.growth_form_set_intake(f.form_legacy,false,NULL,NULL,NULL,NULL,ARRAY['Legacy plus']);
 SELECT array_agg(repeat('😀',78)||lpad(n::text,2,'0') ORDER BY n) INTO fifty FROM generate_series(1,50)n;
 saved:=public.growth_form_set_intake(f.form_wide,false,NULL,NULL,NULL,NULL,fifty);
 RESET ROLE;
 PERFORM pg_temp.e06it_assert(saved.future_tags=fifty AND cardinality(saved.future_tags)=50,
  'largest admitted Unicode configuration is accepted through the original setting seam');
END $settings$;

-- The original claim RPC alone authorizes each first effect. This fixture helper
-- does not replace it, invent an attempt, or manufacture a result/dispatch row.
CREATE FUNCTION pg_temp.e06it_submission(p_form_id uuid,p_tenant_id uuid,p_contact_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE sub_id uuid; claim jsonb;
BEGIN
 INSERT INTO public.growth_form_submissions(form_id,tenant_id,contact_id,payload_json)
  VALUES(p_form_id,p_tenant_id,p_contact_id,'{"email":"synthetic@example.invalid"}') RETURNING id INTO sub_id;
 claim:=public.growth_claim_submission(sub_id);
 PERFORM pg_temp.e06it_assert(claim->'claimed'='true' AND claim->>'tenant_id'=p_tenant_id::text
  AND claim->>'form_id'=p_form_id::text AND claim->>'attempts'='1','original claim derives first submission source and attempt');
 RETURN sub_id;
END $$;
SELECT pg_temp.e06it_server();
GRANT UPDATE(sub_applied,sub_new,sub_nochange,sub_stale,sub_badclaim,sub_overflow,sub_rollback,sub_legacy,sub_forgery,sub_b,sub_wide)
 ON e06it_fixture TO service_role;
SET LOCAL ROLE service_role;
DO $submissions$
DECLARE f e06it_fixture;
BEGIN
 SELECT * INTO f FROM e06it_fixture;
 f.sub_applied:=pg_temp.e06it_submission(f.form_a,f.tenant_a,f.contact_existing);
 f.sub_new:=pg_temp.e06it_submission(f.form_a,f.tenant_a,NULL);
 f.sub_nochange:=pg_temp.e06it_submission(f.form_a,f.tenant_a,f.contact_nochange);
 f.sub_stale:=pg_temp.e06it_submission(f.form_a,f.tenant_a,f.contact_existing);
 f.sub_badclaim:=pg_temp.e06it_submission(f.form_a,f.tenant_a,f.contact_existing);
 f.sub_overflow:=pg_temp.e06it_submission(f.form_a,f.tenant_a,f.contact_overflow);
 f.sub_rollback:=pg_temp.e06it_submission(f.form_a,f.tenant_a,f.contact_rollback);
 f.sub_legacy:=pg_temp.e06it_submission(f.form_legacy,f.tenant_a,f.contact_existing);
 f.sub_forgery:=pg_temp.e06it_submission(f.form_a,f.tenant_a,f.contact_existing);
 f.sub_b:=pg_temp.e06it_submission(f.form_b,f.tenant_b,f.contact_b);
 f.sub_wide:=pg_temp.e06it_submission(f.form_wide,f.tenant_a,f.contact_wide);
 UPDATE e06it_fixture SET sub_applied=f.sub_applied,sub_new=f.sub_new,sub_nochange=f.sub_nochange,sub_stale=f.sub_stale,
  sub_badclaim=f.sub_badclaim,sub_overflow=f.sub_overflow,sub_rollback=f.sub_rollback,sub_legacy=f.sub_legacy,sub_forgery=f.sub_forgery,sub_b=f.sub_b,sub_wide=f.sub_wide;
END $submissions$;
RESET ROLE;

SELECT pg_temp.e06it_server();
SET LOCAL ROLE service_role;
DO $apply_and_binding$
DECLARE f e06it_fixture; token text; reply jsonb; saved_result jsonb; original_row jsonb; count_before bigint; pinned uuid; widest text[];
BEGIN
 SELECT * INTO f FROM e06it_fixture;
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=f.contact_existing;
 SELECT to_jsonb(s)-'contact_tags_result' INTO original_row FROM public.growth_form_submissions s WHERE id=f.sub_applied;
 SELECT count(*) INTO count_before FROM public.audit_logs WHERE entity='client' AND action='update_contact' AND entity_id=f.contact_existing;
 reply:=public.growth_apply_submission_contact_tags(f.sub_applied,1,f.automation_a,f.contact_existing,f.actor_b,token,ARRAY['Campaign','North']);
 PERFORM pg_temp.e06it_assert(reply->>'code'='not_allowed','service actor hint cannot substitute a foreign operator');
 reply:=public.growth_apply_submission_contact_tags(f.sub_applied,1,f.automation_a,f.contact_existing,f.actor_a,token,ARRAY['Different']);
 PERFORM pg_temp.e06it_assert(reply->>'code'='config_changed','hinted tags must equal current authoritative form/route config');
 reply:=public.growth_apply_submission_contact_tags(f.sub_applied,1,f.automation_a,f.contact_b,f.actor_a,token,ARRAY['Campaign','North']);
 PERFORM pg_temp.e06it_assert(reply->>'code'='source_changed','foreign/unpinned contact cannot redirect the original submission');
 reply:=public.growth_apply_submission_contact_tags(f.sub_applied,1,gen_random_uuid(),f.contact_existing,f.actor_a,token,ARRAY['Campaign','North']);
 PERFORM pg_temp.e06it_assert(reply->>'code'='source_changed','unknown automation cannot replace the original route');
 PERFORM pg_temp.e06it_assert((SELECT contact_tags_result IS NULL FROM public.growth_form_submissions WHERE id=f.sub_applied)
  AND (SELECT count(*)=count_before FROM public.audit_logs WHERE entity='client' AND action='update_contact' AND entity_id=f.contact_existing),
  'all pre-effect binding refusals leave causal field and original tag audit unchanged');
 reply:=public.growth_apply_submission_contact_tags(f.sub_applied,1,f.automation_a,f.contact_existing,f.actor_a,token,ARRAY['Campaign','North']);
 saved_result:=reply->'result';
 INSERT INTO e06it_results VALUES('applied',saved_result);
 PERFORM pg_temp.e06it_assert(reply->'ok'='true' AND reply->>'state'='recorded' AND reply->'replayed'='false'
  AND saved_result->>'outcome'='applied' AND saved_result->>'source_updated_at'=token
  AND saved_result->>'submission_id'=f.sub_applied::text AND saved_result->>'tenant_id'=f.tenant_a::text
  AND saved_result->>'form_id'=f.form_a::text AND saved_result->>'contact_id'=f.contact_existing::text
  AND saved_result->>'automation_id'=f.automation_a::text AND saved_result->>'operator_user_id'=f.actor_a::text
  AND saved_result->'future_tags'='["Campaign","North"]' AND saved_result->>'config_digest'=encode(sha256(convert_to('["Campaign", "North"]','UTF8')),'hex'),
  'first native operation records exact original source/config/operator and verbatim native timestamp');
 PERFORM pg_temp.e06it_assert((SELECT tags=ARRAY['Legacy','Legacy','Campaign','North'] FROM public.clients WHERE id=f.contact_existing)
  AND (SELECT to_jsonb(s)-'contact_tags_result'=original_row AND contact_tags_result=saved_result FROM public.growth_form_submissions s WHERE id=f.sub_applied),
  'full existing array order and multiplicity survive; only missing requested tag appends and unrelated lifecycle fields stay exact');
 PERFORM pg_temp.e06it_assert((SELECT count(*)=count_before+1 FROM public.audit_logs WHERE entity='client' AND action='update_contact' AND entity_id=f.contact_existing)
  AND (SELECT count(*)=1 FROM public.audit_logs WHERE id=(saved_result->>'audit_id')::uuid
   AND user_id=f.actor_a AND entity='client' AND action='update_contact' AND entity_id=f.contact_existing
   AND data=jsonb_build_object('tenant_id',f.tenant_a,'fields',jsonb_build_array('tags'),'channel','api')),
  'causal UUID identifies exactly one real unchanged native tags-only audit, not a latest unrelated audit');
 -- Original processor conditional pin: an unpinned source refuses first; only
 -- the real same claim/state/attempt/NULL update grants its actual contact link.
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=f.contact_new;
 reply:=public.growth_apply_submission_contact_tags(f.sub_new,1,f.automation_a,f.contact_new,f.actor_a,token,ARRAY['Campaign','North']);
 PERFORM pg_temp.e06it_assert(reply->>'code'='source_changed','new original contact is not trusted before the durable pin');
 UPDATE public.growth_form_submissions SET contact_id=f.contact_new WHERE id=f.sub_new AND tenant_id=f.tenant_a
  AND processing_state='claimed' AND attempts=1 AND contact_id IS NULL RETURNING id INTO pinned;
 PERFORM pg_temp.e06it_assert(pinned=f.sub_new,'original conditional contact pin uses exact claim, tenant and NULL predicate');
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=f.contact_new;
 -- Discard the successful statement answer, then recover ONLY its causal state.
 PERFORM public.growth_apply_submission_contact_tags(f.sub_new,1,f.automation_a,f.contact_new,f.actor_a,token,ARRAY['Campaign','North']);
 reply:=public.growth_submission_contact_tags_state(f.sub_new,f.contact_new,f.automation_a);
 PERFORM pg_temp.e06it_assert(reply#>>'{result,outcome}'='applied'
  AND reply->'replayed'='true'
  AND (SELECT tags=ARRAY['Campaign','North'] FROM public.clients WHERE id=f.contact_new),
  'discarded new-contact statement ACK recovers only its actual pinned source result and configured tags');
 -- Current presence is NOT called a mutation: native no-change has a real
 -- original causal record, an explicitly NULL audit, and unchanged version.
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=f.contact_nochange;
 SELECT count(*) INTO count_before FROM public.audit_logs WHERE entity='client' AND action='update_contact' AND entity_id=f.contact_nochange;
 reply:=public.growth_apply_submission_contact_tags(f.sub_nochange,1,f.automation_a,f.contact_nochange,f.actor_a,token,ARRAY['Campaign','North']);
 INSERT INTO e06it_results VALUES('no_change',reply->'result');
 PERFORM pg_temp.e06it_assert(reply#>>'{result,outcome}'='no_change' AND reply#>'{result,audit_id}'='null'::jsonb
  AND reply#>>'{result,source_updated_at}'=token AND reply#>>'{result,saved_updated_at}'=token
  AND (SELECT tags=ARRAY['Legacy','Legacy','Campaign','North'] FROM public.clients WHERE id=f.contact_nochange)
  AND (SELECT count(*)=count_before FROM public.audit_logs WHERE entity='client' AND action='update_contact' AND entity_id=f.contact_nochange),
  'already-contained requested tags preserve duplicate legacy values and invent no mutation or audit');
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=f.contact_existing;
 reply:=public.growth_apply_submission_contact_tags(f.sub_legacy,1,NULL,f.contact_existing,f.actor_a,token,ARRAY['Legacy plus']);
 PERFORM pg_temp.e06it_assert(reply#>>'{result,outcome}'='applied' AND reply#>'{result,automation_id}'='null'::jsonb
  AND NOT EXISTS(SELECT 1 FROM public.growth_submission_dispatches WHERE submission_id=f.sub_legacy),
  'legacy NULL automation owns the same original submission result without any invented dispatch row');
 SELECT future_tags INTO widest FROM public.growth_forms WHERE id=f.form_wide;
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=f.contact_wide;
 reply:=public.growth_apply_submission_contact_tags(f.sub_wide,1,NULL,f.contact_wide,f.actor_a,token,widest);
 PERFORM pg_temp.e06it_assert(reply#>>'{result,outcome}'='applied'
  AND (SELECT tags=widest FROM public.clients WHERE id=f.contact_wide)
  AND (SELECT count(*)=13 FROM jsonb_object_keys(reply->'result'))
  AND octet_length((reply->'result')::text)>16384 AND octet_length((reply->'result')::text)<=32768,
  'bounded causal capture admits the entire valid fifty-by-eighty Unicode contract, including JSON above sixteen KiB');
END $apply_and_binding$;
RESET ROLE;

-- A successful native statement's answer is deliberately discarded. Status
-- recovers its actual transaction-visible result. This is NOT HTTP commit proof.
SELECT pg_temp.e06it_server();
SET LOCAL ROLE service_role;
DO $status_is_pure$
DECLARE f e06it_fixture; reply jsonb; prior jsonb; sub_storage text; client_storage text; audits bigint;
BEGIN
 SELECT * INTO f FROM e06it_fixture;
 SELECT result INTO prior FROM e06it_results WHERE label='applied';
 SELECT ctid::text INTO sub_storage FROM public.growth_form_submissions WHERE id=f.sub_applied;
 SELECT ctid::text INTO client_storage FROM public.clients WHERE id=f.contact_existing;
 SELECT count(*) INTO audits FROM public.audit_logs WHERE entity_id=f.contact_existing;
 reply:=public.growth_submission_contact_tags_state(f.sub_applied,f.contact_existing,f.automation_a);
 PERFORM pg_temp.e06it_assert(reply->'result'=prior AND reply->'replayed'='true'
  AND (SELECT ctid::text=sub_storage FROM public.growth_form_submissions WHERE id=f.sub_applied)
  AND (SELECT ctid::text=client_storage FROM public.clients WHERE id=f.contact_existing)
  AND (SELECT count(*)=audits FROM public.audit_logs WHERE entity_id=f.contact_existing),
  'same-source status returns the actual prior causal result with no row version, contact or audit write');
 reply:=public.growth_submission_contact_tags_state(f.sub_stale,f.contact_existing,f.automation_a);
 PERFORM pg_temp.e06it_assert(reply->>'code'='unknown'
  AND (SELECT contact_tags_result IS NULL FROM public.growth_form_submissions WHERE id=f.sub_stale),
  'absent result stays UNKNOWN; read does not fill it or grant a fresh write');
 reply:=public.growth_submission_contact_tags_state(f.sub_applied,f.contact_b,f.automation_a);
 PERFORM pg_temp.e06it_assert(reply->>'code'='source_changed','status refuses a foreign contact binding');
 reply:=public.growth_submission_contact_tags_state(f.sub_applied,f.contact_existing,NULL);
 PERFORM pg_temp.e06it_assert(reply->>'code'='source_changed','status refuses another automation identity, including mismatched NULL');
END $status_is_pure$;

DO $first_effect_negatives$
DECLARE f e06it_fixture; token text; micro_token text; actual_version timestamptz; other_version timestamptz; reply jsonb; original_contact jsonb; original_config jsonb; audits bigint;
BEGIN
 SELECT * INTO f FROM e06it_fixture;
 SELECT updated_at,to_jsonb(c) INTO actual_version,original_contact FROM public.clients c WHERE id=f.contact_existing;
 -- Deterministic exact-microsecond CAS: same millisecond, different timestamp.
 other_version:=actual_version+CASE WHEN mod(extract(microseconds FROM actual_version)::bigint,1000)=999
  THEN -interval '1 microsecond' ELSE interval '1 microsecond' END;
 token:=to_jsonb(actual_version)#>>'{}'; micro_token:=to_jsonb(other_version)#>>'{}';
 PERFORM pg_temp.e06it_assert(date_trunc('milliseconds',actual_version)=date_trunc('milliseconds',other_version)
  AND actual_version IS DISTINCT FROM other_version,'microsecond negative differs below millisecond precision without modifying native version');
 PERFORM pg_temp.e06it_refuses(format('select public.growth_apply_submission_contact_tags(%L,1,%L,%L,%L,%L,ARRAY[''Campaign'',''North''])',
  f.sub_stale,f.automation_a,f.contact_existing,f.actor_a,micro_token),'40001','original native CAS refuses a one-microsecond version mismatch');
 reply:=public.growth_apply_submission_contact_tags(f.sub_badclaim,2,f.automation_a,f.contact_existing,f.actor_a,token,ARRAY['Campaign','North']);
 PERFORM pg_temp.e06it_assert(reply->>'code'='source_changed','wrong current claim attempt never authorizes first tag effect');
 UPDATE public.growth_form_submissions SET claimed_at=clock_timestamp()-interval '6 minutes' WHERE id=f.sub_badclaim;
 reply:=public.growth_apply_submission_contact_tags(f.sub_badclaim,1,f.automation_a,f.contact_existing,f.actor_a,token,ARRAY['Campaign','North']);
 PERFORM pg_temp.e06it_assert(reply->>'code'='source_changed','expired original claim never authorizes first tag effect');
 SELECT config_json INTO original_config FROM public.growth_form_automations WHERE id=f.automation_a;
 UPDATE public.growth_form_automations SET config_json=jsonb_set(config_json,'{future_tags}','["Drift"]') WHERE id=f.automation_a;
 reply:=public.growth_apply_submission_contact_tags(f.sub_forgery,1,f.automation_a,f.contact_existing,f.actor_a,token,ARRAY['Campaign','North']);
 PERFORM pg_temp.e06it_assert(reply->>'code'='config_changed'
  AND (SELECT contact_tags_result IS NULL FROM public.growth_form_submissions WHERE id=f.sub_forgery),
  'native form/route mirror drift cannot become authority even with matching caller expected tags');
 UPDATE public.growth_form_automations SET config_json=original_config WHERE id=f.automation_a;
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=f.contact_overflow;
 SELECT count(*) INTO audits FROM public.audit_logs WHERE entity_id=f.contact_overflow;
 reply:=public.growth_apply_submission_contact_tags(f.sub_overflow,1,f.automation_a,f.contact_overflow,f.actor_a,token,ARRAY['Campaign','North']);
 PERFORM pg_temp.e06it_assert(reply->>'code'='invalid'
  AND (SELECT cardinality(tags)=50 FROM public.clients WHERE id=f.contact_overflow)
  AND (SELECT contact_tags_result IS NULL FROM public.growth_form_submissions WHERE id=f.sub_overflow)
  AND (SELECT count(*)=audits FROM public.audit_logs WHERE entity_id=f.contact_overflow),
  'preserved existing array plus requested tags above fifty refuses before any writer, audit or checkpoint');
 PERFORM pg_temp.e06it_assert((SELECT to_jsonb(c)=original_contact FROM public.clients c WHERE id=f.contact_existing)
  AND (SELECT contact_tags_result IS NULL FROM public.growth_form_submissions WHERE id=f.sub_stale),
  'stale/claim refusals do not mutate the source contact or manufacture a causal result');
END $first_effect_negatives$;
RESET ROLE;

-- Caller SAVEPOINT rollback is actual PostgreSQL rollback, with original
-- functions/triggers. It is not a transport, crash or durable commit simulation.
SELECT pg_temp.e06it_server();
SET LOCAL ROLE service_role;
INSERT INTO e06it_results(label,result)
 SELECT 'rollback_before',jsonb_build_object('contact',to_jsonb(c),'submission',to_jsonb(s),'audits',
  (SELECT count(*) FROM public.audit_logs WHERE entity_id=f.contact_rollback))
 FROM e06it_fixture f JOIN public.clients c ON c.id=f.contact_rollback
 JOIN public.growth_form_submissions s ON s.id=f.sub_rollback;
SAVEPOINT e06it_native_statement;
DO $statement_before_rollback$
DECLARE f e06it_fixture; token text; result jsonb;
BEGIN
 SELECT * INTO f FROM e06it_fixture;
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=f.contact_rollback;
 result:=public.growth_apply_submission_contact_tags(f.sub_rollback,1,f.automation_a,f.contact_rollback,f.actor_a,token,ARRAY['Campaign','North']);
 PERFORM pg_temp.e06it_assert(result#>>'{result,outcome}'='applied'
  AND (SELECT tags=ARRAY['Keep','Campaign','North'] FROM public.clients WHERE id=f.contact_rollback)
  AND public.growth_submission_contact_tags_state(f.sub_rollback,f.contact_rollback,f.automation_a)->'result'=result->'result',
  'native writer, exact audit capture and causal checkpoint all succeed under a real caller savepoint');
END $statement_before_rollback$;
ROLLBACK TO SAVEPOINT e06it_native_statement;
RELEASE SAVEPOINT e06it_native_statement;
DO $rollback_and_original_retry$
DECLARE f e06it_fixture; before_data jsonb; reply jsonb; claim jsonb; token text;
BEGIN
 SELECT * INTO f FROM e06it_fixture; SELECT result INTO before_data FROM e06it_results WHERE label='rollback_before';
 PERFORM pg_temp.e06it_assert((SELECT to_jsonb(c)=before_data->'contact' FROM public.clients c WHERE id=f.contact_rollback)
  AND (SELECT to_jsonb(s)=before_data->'submission' FROM public.growth_form_submissions s WHERE id=f.sub_rollback)
  AND (SELECT count(*)=(before_data->>'audits')::bigint FROM public.audit_logs WHERE entity_id=f.contact_rollback)
  AND public.growth_submission_contact_tags_state(f.sub_rollback,f.contact_rollback,f.automation_a)->>'code'='unknown',
  'actual rollback removes contact change, native audit and causal result together; status stays UNKNOWN');
 -- A read never grants a write. Only the original admitted lifecycle creates
 -- the next current attempt, using the SAME original submission and contact.
 PERFORM public.growth_fail_submission(f.sub_rollback,'synthetic rolled-back statement');
 claim:=public.growth_claim_submission(f.sub_rollback);
 PERFORM pg_temp.e06it_assert(claim->'claimed'='true' AND claim->>'attempts'='2','original failed/claim lifecycle alone admits the same-source retry attempt');
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=f.contact_rollback;
 reply:=public.growth_apply_submission_contact_tags(f.sub_rollback,2,f.automation_a,f.contact_rollback,f.actor_a,token,ARRAY['Campaign','North']);
 PERFORM pg_temp.e06it_assert(reply#>>'{result,outcome}'='applied'
  AND (SELECT count(*)=(before_data->>'audits')::bigint+1 FROM public.audit_logs WHERE entity_id=f.contact_rollback),
  'same original retry captures one real tag mutation after rollback without a replacement contact/request');
END $rollback_and_original_retry$;
RESET ROLE;

-- Current native account revocation is separate from immutable historical data.
SAVEPOINT e06it_account_revocation;
UPDATE auth.users SET banned_until=clock_timestamp()+interval '1 day'
 WHERE id IN(SELECT actor_a FROM e06it_fixture UNION ALL SELECT actor_c FROM e06it_fixture);
SELECT pg_temp.e06it_server();
SET LOCAL ROLE service_role;
SELECT pg_temp.e06it_assert((SELECT public.growth_submission_contact_tags_state(sub_applied,contact_existing,automation_a)->>'code'='not_allowed'
 FROM e06it_fixture),'current native account revocation refuses historical result through service transport');
RESET ROLE;
ROLLBACK TO SAVEPOINT e06it_account_revocation;
RELEASE SAVEPOINT e06it_account_revocation;

-- History survives real new attempts, later authored tags, empty settings and a
-- disabled route. None of those may replace the original operation/audit UUID.
SELECT pg_temp.e06it_server();
SET LOCAL ROLE service_role;
DO $historic_result$
DECLARE f e06it_fixture; original_result jsonb; reply jsonb; claim jsonb; token text; audits bigint; saved public.growth_forms;
BEGIN
 SELECT * INTO f FROM e06it_fixture; SELECT result INTO original_result FROM e06it_results WHERE label='applied';
 PERFORM public.growth_fail_submission(f.sub_applied,'synthetic same-source historical recovery');
 claim:=public.growth_claim_submission(f.sub_applied);
 PERFORM pg_temp.e06it_assert(claim->'claimed'='true' AND claim->>'attempts'='2','real original lifecycle increments attempt without replacing original result');
 SELECT to_jsonb(updated_at)#>>'{}' INTO token FROM public.clients WHERE id=f.contact_existing;
 PERFORM public.upsert_contact(jsonb_build_object('tags',jsonb_build_array('Later authored tag'),'expected_updated_at',token),f.contact_existing,f.tenant_a,f.actor_a,'api');
 RESET ROLE;
 PERFORM pg_temp.e06it_actor(f.actor_a); SET LOCAL ROLE authenticated;
 saved:=public.growth_form_set_intake(f.form_a,false,NULL,NULL,NULL,NULL,'{}');
 RESET ROLE;
 PERFORM pg_temp.e06it_server(); SET LOCAL ROLE service_role;
 UPDATE public.growth_form_automations SET enabled=false WHERE id=f.automation_a;
 SELECT count(*) INTO audits FROM public.audit_logs WHERE entity_id=f.contact_existing;
 reply:=public.growth_submission_contact_tags_state(f.sub_applied,f.contact_existing,f.automation_a);
 PERFORM pg_temp.e06it_assert(reply->'result'=original_result AND reply->'replayed'='true',
  'pure status keeps historical configured tags, source version and exact audit after current config/contact changes');
 reply:=public.growth_apply_submission_contact_tags(f.sub_applied,999,f.automation_a,f.contact_existing,NULL,NULL,NULL);
 PERFORM pg_temp.e06it_assert(reply->'result'=original_result AND reply->'replayed'='true'
  AND (SELECT tags=ARRAY['Later authored tag'] FROM public.clients WHERE id=f.contact_existing)
  AND (SELECT count(*)=audits FROM public.audit_logs WHERE entity_id=f.contact_existing),
  'same-binding apply replay returns original history without reapplying tags, requiring another claim, or minting audit');
 PERFORM public.growth_complete_submission(f.sub_applied);
 reply:=public.growth_submission_contact_tags_state(f.sub_applied,f.contact_existing,f.automation_a);
 PERFORM pg_temp.e06it_assert(reply->'result'=original_result
  AND (SELECT processing_state='done' AND processed AND contact_tags_result=original_result FROM public.growth_form_submissions WHERE id=f.sub_applied),
  'unchanged original completion preserves the exact original causal result');
 -- The generic outer dispatch summary may later carry an error. It does not
 -- own or overwrite this original submission's causal field.
 INSERT INTO public.growth_submission_dispatches(submission_id,automation_id,tenant_id,target_slug,status,result,error)
  VALUES(f.sub_applied,f.automation_a,f.tenant_a,'contact_upsert','error','{}','synthetic outer summary')
  ON CONFLICT(submission_id,automation_id) DO UPDATE SET status='error',result='{}',error=EXCLUDED.error;
 PERFORM pg_temp.e06it_assert(public.growth_submission_contact_tags_state(f.sub_applied,f.contact_existing,f.automation_a)->'result'=original_result,
  'outer dispatch UPSERT cannot erase or reassign original submission causal result');
END $historic_result$;
RESET ROLE;

-- A changed source is refused without altering immutable historical JSON.
SAVEPOINT e06it_source_retarget;
UPDATE public.growth_form_submissions SET form_id=(SELECT form_legacy FROM e06it_fixture)
 WHERE id=(SELECT sub_applied FROM e06it_fixture);
SELECT pg_temp.e06it_server();
SET LOCAL ROLE service_role;
SELECT pg_temp.e06it_assert((SELECT public.growth_submission_contact_tags_state(sub_applied,contact_existing,automation_a)->>'code'='source_changed'
 FROM e06it_fixture),'retargeted original form cannot bless or redirect the prior receipt');
RESET ROLE;
ROLLBACK TO SAVEPOINT e06it_source_retarget;
RELEASE SAVEPOINT e06it_source_retarget;

SELECT pg_temp.e06it_server();
SET LOCAL ROLE service_role;
DO $causal_field_guard$
DECLARE f e06it_fixture; r jsonb;
BEGIN
 SELECT * INTO f FROM e06it_fixture; SELECT result INTO r FROM e06it_results WHERE label='applied';
 PERFORM pg_temp.e06it_refuses(format('update public.growth_form_submissions set contact_tags_result=NULL where id=%L',f.sub_applied),'40001','raw service cannot clear an original result');
 PERFORM pg_temp.e06it_refuses(format('update public.growth_form_submissions set contact_tags_result=%L::jsonb where id=%L',jsonb_set(r,'{audit_id}',to_jsonb(gen_random_uuid()))::text,f.sub_applied),'40001','raw service cannot replace the original audit receipt');
 PERFORM pg_temp.e06it_refuses(format('update public.growth_form_submissions set contact_tags_result=%L::jsonb where id=%L',r::text,f.sub_forgery),'42501','raw service cannot forge first causal capture with copied native evidence');
 PERFORM pg_temp.e06it_refuses(format('insert into public.growth_form_submissions(form_id,tenant_id,contact_id,contact_tags_result) values(%L,%L,%L,%L::jsonb)',f.form_a,f.tenant_a,f.contact_existing,r::text),'42501','service INSERT cannot bypass native-only causal capture');
 PERFORM pg_temp.e06it_assert((SELECT contact_tags_result=r FROM public.growth_form_submissions WHERE id=f.sub_applied)
  AND (SELECT contact_tags_result IS NULL FROM public.growth_form_submissions WHERE id=f.sub_forgery),
  'forgery/reset refusals leave both actual original bindings unchanged');
END $causal_field_guard$;
RESET ROLE;
DO $bounded_native_result$
DECLARE f e06it_fixture; r jsonb;
BEGIN
 SELECT * INTO f FROM e06it_fixture; SELECT result INTO r FROM e06it_results WHERE label='applied';
 r:=jsonb_set(r,'{submission_id}',to_jsonb(f.sub_forgery));
 PERFORM pg_temp.e06it_refuses(format('update public.growth_form_submissions set contact_tags_result=''[]''::jsonb where id=%L',f.sub_forgery),'22023','native result validator rejects a nonobject record');
 PERFORM pg_temp.e06it_refuses(format('update public.growth_form_submissions set contact_tags_result=%L::jsonb where id=%L',jsonb_set(r,'{future_tags}',jsonb_build_array(repeat('x',40000)))::text,f.sub_forgery),'22023','native result validator rejects excessive JSON bytes');
 PERFORM pg_temp.e06it_refuses(format('update public.growth_form_submissions set contact_tags_result=%L::jsonb where id=%L',(r||'{"extra":true}')::text,f.sub_forgery),'22023','native result validator rejects additional authority fields');
 PERFORM pg_temp.e06it_assert((SELECT contact_tags_result IS NULL FROM public.growth_form_submissions WHERE id=f.sub_forgery),
  'all invalid native result writes leave no purported first capture');
END $bounded_native_result$;

SELECT pg_temp.e06it_actor(actor_a) FROM e06it_fixture;
SET LOCAL ROLE authenticated;
DO $authenticated_projection$
DECLARE f e06it_fixture; column_name text; visible integer;
BEGIN
 SELECT * INTO f FROM e06it_fixture;
 FOREACH column_name IN ARRAY ARRAY['id','form_id','tenant_id','contact_id','deal_id','source','external_source_id','payload_json','utm_json','referrer','ip','user_agent',
  'consent_json','funnel_session_id','processed','processed_at','created_at','processing_state','attempts','claimed_at','last_error','alert_sent_at','alert_skipped_reason',
  'visit_id','campaign_brief_id','campaign_attribution','lead_reply_skipped_reason'] LOOP
  EXECUTE format('select %I from public.growth_form_submissions where id=$1',column_name) USING f.sub_applied;
 END LOOP;
 SELECT count(*) INTO visible FROM public.growth_form_submissions WHERE id IN(f.sub_applied,f.sub_b);
 PERFORM pg_temp.e06it_assert(visible=1,'all original twenty-seven columns remain selectable with original tenant RLS');
 UPDATE public.growth_form_submissions SET last_error=last_error WHERE id=f.sub_applied;
 PERFORM pg_temp.e06it_assert(FOUND,'original authenticated ordinary-field UPDATE remains available under the same RLS');
 PERFORM pg_temp.e06it_refuses('select contact_tags_result from public.growth_form_submissions','42501','authenticated direct causal column is private');
 PERFORM pg_temp.e06it_refuses('select * from public.growth_form_submissions','42501','authenticated star cannot leak causal field');
 PERFORM pg_temp.e06it_refuses('select row_to_json(s) from public.growth_form_submissions s','42501','authenticated whole-row JSON cannot leak causal field');
 PERFORM pg_temp.e06it_refuses(format('update public.growth_form_submissions set contact_tags_result=''{}'' where id=%L',f.sub_forgery),'42501','authenticated cannot forge first causal result');
 PERFORM pg_temp.e06it_refuses(format('select public.growth_apply_submission_contact_tags(%L,1,NULL,%L,%L,NULL,NULL)',f.sub_applied,f.contact_existing,f.actor_a),'42501','authenticated cannot call service apply');
 PERFORM pg_temp.e06it_refuses(format('select public.growth_submission_contact_tags_state(%L,%L,NULL)',f.sub_applied,f.contact_existing),'42501','authenticated cannot call service causal reader');
END $authenticated_projection$;
RESET ROLE;
SELECT pg_temp.e06it_actor(actor_b) FROM e06it_fixture;
SET LOCAL ROLE authenticated;
SELECT pg_temp.e06it_assert((SELECT count(*)=0 FROM public.growth_form_submissions WHERE id=(SELECT sub_applied FROM e06it_fixture))
 AND (SELECT count(*)=1 FROM public.growth_form_submissions WHERE id=(SELECT sub_b FROM e06it_fixture)),
 'foreign authenticated owner retains only its own original populated submission rows');
RESET ROLE;
SELECT pg_temp.e06it_server();
SET LOCAL ROLE anon;
SELECT pg_temp.e06it_refuses('select id from public.growth_form_submissions','42501','anon original submission columns stay private');
SELECT pg_temp.e06it_refuses('select contact_tags_result from public.growth_form_submissions','42501','anon causal field stays private');
SELECT pg_temp.e06it_refuses('select * from public.growth_form_submissions','42501','anon star stays private');
SELECT pg_temp.e06it_refuses('select public.growth_submission_contact_tags_state(gen_random_uuid(),gen_random_uuid(),NULL)','42501','anon cannot acquire service causal read');
RESET ROLE;

SELECT pg_temp.e06it_assert((SELECT array_agg(p.name ORDER BY p.name)=ARRAY['id','name','schema_json','slug','success_action_json']
 FROM pg_proc f CROSS JOIN LATERAL unnest(f.proargnames,f.proargmodes) p(name,mode)
 WHERE f.oid='public.growth_public_form(uuid,uuid,text)'::regprocedure AND p.mode='t'),
 'unchanged public visitor form projection contains no future tags, actor, tenant or causal result');
SELECT pg_temp.e06it_assert(NOT EXISTS(
 SELECT 1 FROM e06it_catalog b FULL JOIN pg_proc p ON p.oid=b.oid
 WHERE (b.oid IS NOT NULL OR p.pronamespace IN('public'::regnamespace,'auth'::regnamespace,'private'::regnamespace))
  AND b.metadata IS DISTINCT FROM to_jsonb(p)),
 'full-schema proof changes no original public/auth/private function body, ownership, ACL or metadata');
SELECT jsonb_build_object('proof','EXP06 intake full-schema rollback SQL','passed_assertions',count(*),
 'fixture_lifetime','ROLLBACK','auth_functions','ORIGINAL','ports_replaced',false,
 'parallel_and_http_commit_proof','SEPARATE_NATIVE_WORKER') FROM e06it_assertions;
ROLLBACK;
