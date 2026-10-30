-- Full-schema synthetic-role proof only. No HTTP, model, paid search, account or
-- provider activation; every fixture, protocol flag and native turn rolls back.
BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0997410-0000-4000-8000-0000000000a1','authenticated','authenticated','link-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0997410-0000-4000-8000-0000000000a2','authenticated','authenticated','link-customer-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0997410-0000-4000-8000-0000000000a3','authenticated','authenticated','link-peer-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0997410-0000-4000-8000-0000000000b1','authenticated','authenticated','link-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0997410-0000-4000-8000-0000000000b2','authenticated','authenticated','link-customer-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,features) VALUES
 ('e0997420-0000-4000-8000-00000000000a','test-tenant-public-link-a','Test Practice A','active','standalone',NULL,'{}'),
 ('e0997420-0000-4000-8000-00000000000b','test-tenant-public-link-b','Test Practice B','active','standalone',NULL,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0997420-0000-4000-8000-00000000000a','e0997410-0000-4000-8000-0000000000a1','owner','active',true,now()),
 ('e0997420-0000-4000-8000-00000000000b','e0997410-0000-4000-8000-0000000000b1','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e0997420-0000-4000-8000-00000000000a' WHERE user_id='e0997410-0000-4000-8000-0000000000a1';
UPDATE public.profiles SET active_tenant_id='e0997420-0000-4000-8000-00000000000b' WHERE user_id='e0997410-0000-4000-8000-0000000000b1';
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0997430-0000-4000-8000-0000000000a2','e0997420-0000-4000-8000-00000000000a','e0997410-0000-4000-8000-0000000000a2','e0997410-0000-4000-8000-0000000000a1','Test','Customer','active'),
 ('e0997430-0000-4000-8000-0000000000a3','e0997420-0000-4000-8000-00000000000a','e0997410-0000-4000-8000-0000000000a3','e0997410-0000-4000-8000-0000000000a1','Test','Peer','active'),
 ('e0997430-0000-4000-8000-0000000000b2','e0997420-0000-4000-8000-00000000000b','e0997410-0000-4000-8000-0000000000b2','e0997410-0000-4000-8000-0000000000b1','Test','Other','active');
CREATE FUNCTION pg_temp.u(who text) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e0997410-0000-4000-8000-0000000000'||who)::uuid $$;
CREATE FUNCTION pg_temp.t(who char) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e0997420-0000-4000-8000-00000000000'||who)::uuid $$;
CREATE FUNCTION pg_temp.c(who text) RETURNS uuid LANGUAGE sql AS $$ SELECT ('e0997430-0000-4000-8000-0000000000'||who)::uuid $$;
CREATE FUNCTION pg_temp.as_user(who text,statement text,actor_role text DEFAULT 'authenticated') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(who),'role',actor_role)::text,true);
 IF actor_role='anon' THEN SET LOCAL ROLE anon;
 ELSIF actor_role='service_role' THEN SET LOCAL ROLE service_role;
 ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE statement INTO result;
 EXCEPTION WHEN OTHERS THEN result:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN result;
END $$;
CREATE FUNCTION pg_temp.ctx(who text,th uuid,intent uuid,url text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user(who,format('SELECT public.client_portal_assistant_link_context(%L,%L,%L)',th,intent,url)) $$;
CREATE FUNCTION pg_temp.begin_link(th uuid,intent uuid,url text,effectful boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user('a2',format('SELECT public.client_portal_assistant_begin_link(%L,%L,NULL,%L,false,false,%L,NULL,%L,NULL)',
  th,intent,'Read this selected public page',effectful,url)) $$;
CREATE FUNCTION pg_temp.executor(th uuid,intent uuid,operation text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user('a2',format('SELECT public.paige_chat_interactive_executor_v2(%L,%L,%L,%L,%L)',th,pg_temp.u('a2'),pg_temp.t('a'),intent,operation),'service_role') $$;
CREATE FUNCTION pg_temp.settle(th uuid,intent uuid,content text,link jsonb,state text DEFAULT 'FINAL') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE bundle jsonb;
BEGIN
 SELECT bundle_ref INTO bundle FROM public.paige_chat_turns WHERE thread_id=th AND role='user' AND interactive_intent_id=intent;
 bundle:=(bundle-'customer_public_link')||jsonb_build_object('interactive',jsonb_build_object('request_intent_id',intent),'turn_state',jsonb_build_object('v',1,'state',state));
 IF content='' AND state IN('WITHHELD','REFUSED','INTERRUPTED') THEN
  bundle:=bundle-ARRAY['customer_knowledge','customer_progress','customer_sessions','customer_files']; END IF;
 IF link IS NOT NULL THEN bundle:=bundle||jsonb_build_object('customer_public_link',link); END IF;
 RETURN pg_temp.as_user('a2',format('SELECT to_jsonb(public.paige_chat_interactive_settle(%L,%L,%L,%L,%L,NULL,NULL,%L::jsonb,NULL))',
  th,pg_temp.u('a2'),pg_temp.t('a'),intent,content,bundle::text),'service_role');
END $$;

SELECT ok(NOT has_function_privilege('authenticated',f,'EXECUTE') AND NOT has_function_privilege('anon',f,'EXECUTE')
 AND NOT has_function_privilege('service_role',f,'EXECUTE'),'public-link helper remains private: '||f)
FROM unnest(ARRAY['public._client_public_link_url_valid(text)','public._client_public_link_snapshot_valid(jsonb)',
 'public._client_public_link_snapshot_current(uuid,uuid,uuid,uuid,uuid,jsonb)',
 'public._client_public_link_snapshot_lock(uuid,uuid,uuid,uuid,uuid,jsonb)',
 'public._client_public_link_terminal_guard()','public._client_public_link_publication_current(uuid,uuid)']) f;
SELECT ok(has_function_privilege('authenticated',f,'EXECUTE') AND NOT has_function_privilege('anon',f,'EXECUTE')
 AND NOT has_function_privilege('service_role',f,'EXECUTE'),'public-link entry uses original customer JWT only: '||f)
FROM unnest(ARRAY['public.client_portal_assistant_link_context(uuid,uuid,text)',
 'public.client_portal_assistant_begin_link(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector,text,jsonb)']) f;
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_assistant_begin_sessions(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector)'::regprocedure),'cbf566b34dd050eb611b509c6718d547','original Sessions begin remains exact');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_assistant_begin_files(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector,jsonb)'::regprocedure),'34daa034fc23a2e17f7cdf9d55348b8d','original Files begin remains exact');
SELECT ok(public._client_public_link_url_valid('https://example.org/program'),'HTTPS page syntax accepted, public DNS still not asserted');
SELECT ok(NOT public._client_public_link_url_valid(url),'unsafe/unsupported link syntax refused: '||coalesce(url,'NULL'))
 FROM unnest(ARRAY[NULL,'','http://example.org/','https://user:secret@example.org/','https://example.org/?token=private',
 'https://example.org/#private',E'https://example.org/a\nb','https://example.org/'||repeat('x',500)]) url;
SELECT ok(NOT public._client_public_link_snapshot_valid(NULL) AND NOT public._client_public_link_snapshot_valid('[]')
 AND NOT public._client_public_link_snapshot_valid('{"version":1}'),'malformed snapshot is never a native grant');

SELECT set_config('request.headers','{}',true);
UPDATE public.paige_chat_interactive_rollout SET active=true WHERE singleton;
CREATE TEMP TABLE link_turn AS SELECT
 (pg_temp.as_user('a2',$q$SELECT to_jsonb(public.paige_chat_thread_create(NULL,'customer','Public reference','{}'))$q$)#>>'{}')::uuid th,
 gen_random_uuid() intent,'https://example.org/program'::text url,NULL::jsonb pre;
UPDATE link_turn SET pre=pg_temp.ctx('a2',th,intent,url);
SELECT is((SELECT pre->>'mode' FROM link_turn),'fresh','only the current customer can prepare the exact selection');
SELECT is((SELECT array_agg(k ORDER BY k) FROM link_turn,jsonb_object_keys(pre) k),ARRAY['intent_id','mode','snapshot','thread_id'],'native context is closed and minimized');
SELECT is((SELECT pre#>>'{snapshot,actor_id}' FROM link_turn),pg_temp.u('a2')::text,'native Auth actor is bound, never borrowed from the business owner');
SELECT is((SELECT pg_temp.ctx(who,th,intent,url)->>'sqlstate' FROM link_turn),'42501','wrong original actor refused: '||who)
 FROM unnest(ARRAY['a1','a3','b2']) who;
SELECT is((SELECT pg_temp.as_user('a2',format('SELECT public.client_portal_assistant_link_context(%L,%L,%L)',th,intent,url),'anon')->>'sqlstate' FROM link_turn),'42501','anonymous native link entry refused');
SELECT is((SELECT pg_temp.as_user('a2',format('SELECT public.client_portal_assistant_link_context(%L,%L,%L)',th,intent,url),'service_role')->>'sqlstate' FROM link_turn),'42501','service role cannot substitute for customer JWT');
SELECT is((SELECT pg_temp.ctx('a2',th,NULL,url)->>'sqlstate' FROM link_turn),'42501','missing native intent refused');
SELECT is((SELECT pg_temp.begin_link(th,intent,url,false)->>'sqlstate' FROM link_turn),'42501','degraded/conversational admission cannot acquire link-processing authority');
SELECT is((SELECT pg_temp.begin_link(th,intent,url)->>'status' FROM link_turn),'accepted','original native begin accepts the deliberately selected URL');
SELECT is((SELECT bundle_ref->'customer_public_link' FROM public.paige_chat_turns p,link_turn l WHERE p.thread_id=l.th AND p.interactive_intent_id=l.intent AND p.role='user'),
 (SELECT pre->'snapshot' FROM link_turn),'one original user receipt stores the exact native link manifest');
SELECT ok((SELECT bundle_ref ?& ARRAY['customer_knowledge','customer_progress','customer_sessions'] FROM public.paige_chat_turns p,link_turn l
 WHERE p.thread_id=l.th AND p.interactive_intent_id=l.intent AND p.role='user'),'original Knowledge/Progress/Sessions source bindings remain on that same turn');
SELECT is((SELECT pg_temp.begin_link(th,intent,url)->>'turn_id' FROM link_turn),
 (SELECT p.id::text FROM public.paige_chat_turns p,link_turn l WHERE p.thread_id=l.th AND p.interactive_intent_id=l.intent AND p.role='user'),'replay returns the original user receipt');
SELECT is((SELECT count(*) FROM public.paige_chat_turns p,link_turn l WHERE p.thread_id=l.th AND p.interactive_intent_id=l.intent AND p.role='user'),1::bigint,'no duplicate user turn');
SELECT is((SELECT pg_temp.begin_link(th,intent,'https://example.org/other')->>'sqlstate' FROM link_turn),'42501','accepted replay cannot substitute a different URL');
SELECT is((SELECT pg_temp.ctx('a2',th,intent)->>'mode' FROM link_turn),'bound','accepted replay reads the original selection without request fallback');
SELECT ok((SELECT (pg_temp.executor(th,intent,'acquire')->>'acquired')::boolean FROM link_turn),'original executor owns the link-bearing turn');
SELECT is((SELECT pg_temp.settle(th,intent,'Unbound page answer',NULL)->>'error' FROM link_turn),'CUSTOMER_LINK_SOURCE_WITHDRAWN','missing native link binding cannot publish');
SELECT is((SELECT pg_temp.settle(th,intent,'Forged URL answer',jsonb_set(pre->'snapshot','{url}','"https://example.org/other"'))->>'error' FROM link_turn),'CUSTOMER_LINK_SOURCE_WITHDRAWN','changed URL cannot publish');
SELECT ok((SELECT NOT(pg_temp.settle(th,intent,'The selected public reference was read at its stated time.',pre->'snapshot') ? 'sqlstate') FROM link_turn),'exact native binding settles only through original writer (no actual fetch asserted)');
SELECT pg_temp.executor(th,intent,'release') FROM link_turn;
SELECT ok((SELECT (pg_temp.as_user('a2',format('SELECT to_jsonb(public.paige_chat_interactive_publication_context_v2(%L,%L))',th,intent))#>>'{}')::boolean FROM link_turn),'original publication permits current bound result');
SELECT is((SELECT count(*) FROM public.paige_chat_turns p,link_turn l WHERE p.thread_id=l.th AND p.interactive_intent_id=l.intent AND p.role='assistant'),1::bigint,'result remains in original private history');

SELECT pg_temp.as_user('a1',format('SELECT public.set_tenant_portal_config(%L,%L::jsonb)',pg_temp.t('a'),'{"assistant":{"enabled":false}}'));
SELECT is((SELECT pg_temp.ctx('a2',th,intent)->>'sqlstate' FROM link_turn),'42501','owner disabling original CURA closes accepted link context');
SELECT ok((SELECT NOT(pg_temp.as_user('a2',format('SELECT to_jsonb(public.paige_chat_interactive_publication_context_v2(%L,%L))',th,intent))#>>'{}')::boolean FROM link_turn),'disabling CURA closes late link publication');
SELECT pg_temp.as_user('a1',format('SELECT public.set_tenant_portal_config(%L,%L::jsonb)',pg_temp.t('a'),'{"assistant":{"enabled":true}}'));
SELECT is((SELECT pg_temp.ctx('a2',th,intent)->>'mode' FROM link_turn),'bound','permitted return still reads the same accepted URL');
SELECT set_config('paige.portal_access_write','1',true);
UPDATE public.clients SET portal_access_state='paused' WHERE id=pg_temp.c('a2');
SELECT is((SELECT pg_temp.ctx('a2',th,intent)->>'sqlstate' FROM link_turn),'42501','paused customer cannot retrieve accepted link context');
UPDATE public.clients SET portal_access_state='open' WHERE id=pg_temp.c('a2');
SELECT set_config('paige.portal_access_write','',true);
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=pg_temp.u('a2');
SELECT ok((SELECT NOT public._client_public_link_snapshot_lock(pg_temp.u('a2'),pg_temp.t('a'),pg_temp.c('a2'),th,intent,pre->'snapshot') FROM link_turn),'trusted terminal refuses a subsequently banned actor');
UPDATE auth.users SET banned_until=NULL WHERE id=pg_temp.u('a2');
SELECT ok((SELECT NOT public._client_public_link_snapshot_current(pg_temp.u('a3'),pg_temp.t('a'),pg_temp.c('a2'),th,intent,pre->'snapshot') FROM link_turn),'trusted helper cannot substitute another customer');
SELECT ok((SELECT NOT public._client_public_link_snapshot_current(pg_temp.u('a2'),pg_temp.t('b'),pg_temp.c('a2'),th,intent,pre->'snapshot') FROM link_turn),'trusted helper cannot substitute another business');
SELECT ok((SELECT NOT public._client_public_link_snapshot_valid((pre->'snapshot')||'{"owner_override":true}') FROM link_turn),'source manifest cannot carry extra authority');
SELECT set_config('request.headers',jsonb_build_object('x-client-portal-business',pg_temp.t('b'))::text,true);
SELECT is((SELECT pg_temp.ctx('a2',th,intent)->>'sqlstate' FROM link_turn),'42501','business selection cannot reuse another relationship private thread');
SELECT set_config('request.headers',jsonb_build_object('x-client-portal-business',pg_temp.t('a'))::text,true);
SELECT is((SELECT pg_temp.ctx('a2',th,intent)->>'mode' FROM link_turn),'bound','return to original business preserves original accepted selection');
SELECT set_config('request.headers','{}',true);

CREATE TEMP TABLE link_interrupted AS SELECT th,gen_random_uuid() intent,url FROM link_turn;
SELECT is((SELECT pg_temp.begin_link(th,intent,url)->>'status' FROM link_interrupted),'accepted','successor uses same original native protocol');
SELECT ok((SELECT (pg_temp.executor(th,intent,'acquire')->>'acquired')::boolean FROM link_interrupted),'successor acquires original executor, not a new runtime');
SELECT pg_temp.as_user('a1',format('SELECT public.set_tenant_portal_config(%L,%L::jsonb)',pg_temp.t('a'),'{"assistant":{"enabled":false}}'));
SELECT ok((SELECT NOT(pg_temp.settle(th,intent,'',NULL,'WITHHELD') ? 'sqlstate') FROM link_interrupted),'withdrawn authority permits empty original cleanup only');
SELECT pg_temp.executor(th,intent,'release') FROM link_interrupted;
SELECT is((SELECT count(*) FROM public.paige_chat_turns p,link_interrupted l WHERE p.thread_id=l.th AND p.interactive_intent_id=l.intent
 AND p.role='assistant' AND coalesce(p.content,'')='' AND NOT p.bundle_ref ? 'customer_public_link'),1::bigint,'withheld result stores no borrowed link answer or source claim');

-- One real synthetic Auth actor, two independently recorded CRM relationships:
-- changing only the selected business must never reuse the first private turn.
SELECT pg_temp.as_user('a1',format('SELECT public.set_tenant_portal_config(%L,%L::jsonb)',pg_temp.t('a'),'{"assistant":{"enabled":true}}'));
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0997430-0000-4000-8000-0000000000b3','e0997420-0000-4000-8000-00000000000b','e0997410-0000-4000-8000-0000000000a2','e0997410-0000-4000-8000-0000000000b1','Test','Second relationship','active');
SELECT set_config('request.headers',jsonb_build_object('x-client-portal-business',pg_temp.t('a'))::text,true);
SELECT is((SELECT pg_temp.ctx('a2',th,intent)->>'mode' FROM link_turn),'bound','same multi-business customer still reads original selected-business receipt');
SELECT set_config('request.headers',jsonb_build_object('x-client-portal-business',pg_temp.t('b'))::text,true);
SELECT is((SELECT pg_temp.ctx('a2',th,intent)->>'sqlstate' FROM link_turn),'42501','second legitimate relationship never admits the first business private turn');
CREATE TEMP TABLE link_second_business AS SELECT
 (pg_temp.as_user('a2',$q$SELECT to_jsonb(public.paige_chat_thread_create(NULL,'customer','Second business reference','{}'))$q$)#>>'{}')::uuid th,
 gen_random_uuid() intent,'https://example.org/second-business'::text url;
SELECT is((SELECT pg_temp.begin_link(th,intent,url)->>'status' FROM link_second_business),'accepted','same actor can begin the independently authorized second-business turn');
SELECT is((SELECT pg_temp.ctx('a2',th,intent)#>>'{snapshot,tenant_id}' FROM link_second_business),pg_temp.t('b')::text,'second turn binds the actual second business');
SELECT is((SELECT pg_temp.ctx('a2',th,intent)#>>'{snapshot,contact_id}' FROM link_second_business),'e0997430-0000-4000-8000-0000000000b3','second turn binds the actual distinct CRM relationship');
SELECT is((SELECT pg_temp.ctx('a2',th,intent)#>>'{snapshot,url}' FROM link_second_business),'https://example.org/second-business','second business retains only its own accepted selection');
SELECT set_config('request.headers',jsonb_build_object('x-client-portal-business',pg_temp.t('a'))::text,true);
SELECT is((SELECT pg_temp.ctx('a2',th,intent)->>'sqlstate' FROM link_second_business),'42501','returning first-business context cannot read second-business turn');
SELECT is((SELECT pg_temp.ctx('a2',th,intent)#>>'{snapshot,url}' FROM link_turn),'https://example.org/program','returning customer retains the first business exact original URL');

-- Invoice integration reuses this ORIGINAL rollback-only native private-turn
-- fixture, actual Auth roles, admission/executor/settlement and publisher.
-- No new runner, live identity/provider/payment or replacement financial query.
CREATE FUNCTION pg_temp.invoice_issue(n integer,client uuid) RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.paige_invoices(id,tenant_id,contact_id,invoice_number,status,amount_total_cents,currency,due_date,memo,
  billing_draft_version,billing_draft,billing_last_operation_id,billing_last_request,billing_lifecycle_version,
  billing_issued_snapshot_version,billing_issued_at,billing_issued_by,billing_document,billing_document_digest,created_by)
 SELECT ('e0997540-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,t.id,client,'TEST-INVOICE-'||n,'issued',1000,'usd',current_date+14,'PRIVATE TEST NOTE',
  1,'{}'::jsonb,gen_random_uuid(),'{}'::jsonb,2,1,now()-interval '1 day',m.user_id,
  jsonb_build_object('schema_version',1,'invoice_number','TEST-INVOICE-'||n,'issuer_name',t.name,'client_name','Synthetic client','total_cents',1000),
  repeat('a',64),m.user_id FROM public.tenants t JOIN public.tenant_members m ON m.tenant_id=t.id AND m.is_owner
  WHERE t.id=pg_temp.t('a')
$$;
SELECT pg_temp.invoice_issue(1,pg_temp.c('a2'));
SELECT pg_temp.invoice_issue(2,pg_temp.c('a3'));
CREATE FUNCTION pg_temp.invoice_ctx(who text,th uuid,intent uuid,actor_role text DEFAULT 'authenticated') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user(who,format('SELECT public.client_portal_assistant_invoices_context(%L,%L)',th,intent),actor_role) $$;
CREATE FUNCTION pg_temp.invoice_begin(th uuid,intent uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user('a2',format('SELECT public.client_portal_assistant_begin_invoices(%L,%L,NULL,%L,false,false,true,NULL,NULL,NULL)',
  th,intent,'What are my invoices?')) $$;
CREATE FUNCTION pg_temp.invoice_settle(th uuid,intent uuid,content text,snapshot jsonb,state text DEFAULT 'FINAL') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE bundle jsonb;
BEGIN
 SELECT bundle_ref INTO bundle FROM public.paige_chat_turns WHERE thread_id=th AND role='user' AND interactive_intent_id=intent;
 bundle:=(bundle-'customer_invoices')||jsonb_build_object('interactive',jsonb_build_object('request_intent_id',intent),'turn_state',jsonb_build_object('v',1,'state',state));
 IF content='' AND state IN('WITHHELD','REFUSED','INTERRUPTED') THEN
  bundle:=bundle-ARRAY['customer_knowledge','customer_progress','customer_sessions','customer_files','customer_public_link']; END IF;
 IF snapshot IS NOT NULL THEN bundle:=bundle||jsonb_build_object('customer_invoices',snapshot); END IF;
 RETURN pg_temp.as_user('a2',format('SELECT to_jsonb(public.paige_chat_interactive_settle(%L,%L,%L,%L,%L,NULL,NULL,%L::jsonb,NULL))',
  th,pg_temp.u('a2'),pg_temp.t('a'),intent,content,bundle::text),'service_role');
END $$;
SELECT ok(NOT has_function_privilege('authenticated',f,'EXECUTE') AND NOT has_function_privilege('anon',f,'EXECUTE')
 AND NOT has_function_privilege('service_role',f,'EXECUTE'),'invoice trusted helper remains private: '||f)
FROM unnest(ARRAY['public._client_invoices_snapshot_valid(jsonb)',
 'public._client_invoices_snapshot_current(uuid,uuid,uuid,uuid,uuid,jsonb)',
 'public._client_invoices_terminal_guard()','public._client_invoices_publication_current(uuid,uuid)']) f;
SELECT ok(has_function_privilege('authenticated',f,'EXECUTE') AND NOT has_function_privilege('anon',f,'EXECUTE')
 AND NOT has_function_privilege('service_role',f,'EXECUTE'),'invoice entry requires original customer JWT: '||f)
FROM unnest(ARRAY['public.client_portal_assistant_invoices_context(uuid,uuid)',
 'public.client_portal_assistant_begin_invoices(uuid,uuid,uuid,text,boolean,boolean,boolean,extensions.vector,text,jsonb)']) f;
SELECT is(provolatile::text,'v','original POST context/publication permits financial SHARE locks: '||oid::regprocedure::text)
 FROM pg_proc WHERE oid IN('public.client_portal_assistant_context(uuid,uuid)'::regprocedure,
 'public.client_portal_assistant_context_v2(uuid,uuid,extensions.vector)'::regprocedure,
 'public.paige_chat_interactive_publication_context_v2(uuid,uuid)'::regprocedure);
CREATE TEMP TABLE invoice_turn AS SELECT th,gen_random_uuid() intent FROM link_turn;
ALTER TABLE invoice_turn ADD COLUMN pre jsonb;
UPDATE invoice_turn SET pre=pg_temp.invoice_ctx('a2',th,intent);
SELECT is((SELECT pre->>'mode' FROM invoice_turn),'fresh','invoice native projection uses current original financial source');
SELECT is((SELECT pre#>>'{billing,invoice_count}' FROM invoice_turn),'1','another customer invoice is excluded by ORIGINAL query');
SELECT is((SELECT pre#>>'{billing,invoices,0,remaining_minor}' FROM invoice_turn),'1000','native exact integer string is retained');
SELECT ok((SELECT NOT (pre->'billing') ? '_native_sources' AND NOT (pre::text LIKE '%PRIVATE TEST NOTE%') FROM invoice_turn),'model projection excludes internal source and private invoice memo');
SELECT is((SELECT pg_temp.invoice_ctx('a2',th,intent,role)->>'sqlstate' FROM invoice_turn),'42501','invoice JWT entry refuses '||role)
 FROM unnest(ARRAY['anon','service_role']) role;
SELECT is((SELECT pg_temp.invoice_ctx(who,th,intent)->>'sqlstate' FROM invoice_turn),'42501','invoice entry refuses wrong original actor '||who)
 FROM unnest(ARRAY['a1','a3','b2']) who;
SELECT is((SELECT pg_temp.invoice_begin(th,intent)->>'status' FROM invoice_turn),'accepted','invoice begin delegates original native admission');
SELECT ok((SELECT bundle_ref ?& ARRAY['customer_invoices','customer_knowledge','customer_progress','customer_sessions']
 FROM public.paige_chat_turns p,invoice_turn x WHERE p.thread_id=x.th AND p.interactive_intent_id=x.intent AND p.role='user'),
 'one original receipt retains every original source plus invoice binding');
SELECT is((SELECT pg_temp.invoice_begin(th,intent)->>'turn_id' FROM invoice_turn),
 (SELECT p.id::text FROM public.paige_chat_turns p,invoice_turn x WHERE p.thread_id=x.th AND p.interactive_intent_id=x.intent AND p.role='user'),
 'invoice replay returns the SAME accepted user receipt');
SELECT is((SELECT pg_temp.invoice_ctx('a2',th,intent)#>>'{snapshot,captured_at}' FROM invoice_turn),
 (SELECT p.bundle_ref#>>'{customer_invoices,captured_at}' FROM public.paige_chat_turns p,invoice_turn x
 WHERE p.thread_id=x.th AND p.interactive_intent_id=x.intent AND p.role='user'),'new read timestamp never replaces accepted capture time');
SELECT ok((SELECT NOT public._client_invoices_snapshot_valid((pre->'snapshot')||'{"owner_override":true}') FROM invoice_turn),'invoice binding is closed, never carries owner authority');
SELECT ok((SELECT (pg_temp.executor(th,intent,'acquire')->>'acquired')::boolean FROM invoice_turn),'invoice uses the ORIGINAL executor');
SELECT is((SELECT pg_temp.invoice_settle(th,intent,'Unbound invoice reply',NULL)->>'error' FROM invoice_turn),
 'CUSTOMER_INVOICES_SOURCE_WITHDRAWN','missing accepted invoice snapshot cannot settle');
SELECT is((SELECT pg_temp.invoice_settle(th,intent,'Changed actor',jsonb_set(pg_temp.invoice_ctx('a2',th,intent)->'snapshot','{actor_id}',to_jsonb(pg_temp.u('a3'))))->>'error' FROM invoice_turn),
 'CUSTOMER_INVOICES_SOURCE_WITHDRAWN','service terminal cannot substitute the customer');
SELECT ok((SELECT NOT(pg_temp.invoice_settle(th,intent,'NATIVE-INVOICE-ANSWER-SENTINEL',pg_temp.invoice_ctx('a2',th,intent)->'snapshot') ? 'sqlstate') FROM invoice_turn),
 'exact accepted invoice source settles in original private history');
SELECT pg_temp.executor(th,intent,'release') FROM invoice_turn;
SELECT ok((SELECT (pg_temp.as_user('a2',format('SELECT to_jsonb(public.paige_chat_interactive_publication_context_v2(%L,%L))',th,intent))#>>'{}')::boolean FROM invoice_turn),
 'original publisher allows unchanged authorized invoice answer');
SELECT pg_temp.invoice_issue(3,pg_temp.c('a2'));
SELECT is((SELECT pg_temp.invoice_ctx('a2',th,intent)->>'sqlstate' FROM invoice_turn),'42501','new original invoice invalidates accepted facts without replacing the snapshot');
SELECT ok((SELECT NOT(pg_temp.as_user('a2',format('SELECT to_jsonb(public.paige_chat_interactive_publication_context_v2(%L,%L))',th,intent))#>>'{}')::boolean FROM invoice_turn),
 'late original publication withholds an invoice answer after facts change');
SELECT ok((SELECT NOT (pg_temp.as_user('a2',format('SELECT public.client_portal_assistant_context_v2(%L,%L,NULL)',th,gen_random_uuid()))::text LIKE '%NATIVE-INVOICE-ANSWER-SENTINEL%') FROM invoice_turn),
 'new model context omits stale invoice-derived facts');
SELECT is((SELECT count(*) FROM public.paige_chat_turns p,invoice_turn x WHERE p.thread_id=x.th AND p.interactive_intent_id=x.intent
 AND p.role='assistant' AND p.content='NATIVE-INVOICE-ANSWER-SENTINEL'),1::bigint,'saved customer UI history is retained, never deleted for model filtering');
SELECT set_config('request.headers',jsonb_build_object('x-client-portal-business',pg_temp.t('b'))::text,true);
SELECT is((SELECT pg_temp.invoice_ctx('a2',th,intent)->>'sqlstate' FROM invoice_turn),'42501','same customer second legitimate business cannot reuse original invoice context');
SELECT set_config('request.headers',jsonb_build_object('x-client-portal-business',pg_temp.t('a'))::text,true);
CREATE TEMP TABLE invoice_withheld AS SELECT th,gen_random_uuid() intent FROM invoice_turn;
SELECT is((SELECT pg_temp.invoice_begin(th,intent)->>'status' FROM invoice_withheld),'accepted','next turn captures current original facts');
SELECT ok((SELECT (pg_temp.executor(th,intent,'acquire')->>'acquired')::boolean FROM invoice_withheld),'same executor handles interrupted invoice read');
SELECT pg_temp.invoice_issue(4,pg_temp.c('a2'));
SELECT ok((SELECT NOT(pg_temp.invoice_settle(th,intent,'',NULL,'WITHHELD') ? 'sqlstate') FROM invoice_withheld),'changed invoice source still permits empty original cleanup');
SELECT pg_temp.executor(th,intent,'release') FROM invoice_withheld;
SELECT * FROM finish();
ROLLBACK;
