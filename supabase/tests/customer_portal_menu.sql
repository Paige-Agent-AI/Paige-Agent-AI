-- E09 Slice M (per-tenant customer portal menu): full replayed schema, actual caller roles,
-- synthetic data only (§63); all rolled back.
-- Proves:
--   * get_client_portal_config gains a server-authored `_catalog` for the caller's OWN relationship
--     (authored / slug / neither), that a tenant-stored `_catalog` can never shadow it, and that no
--     persona, intake or probing field leaks; staff get '{}', two relationships refuse, anon refuses.
--   * client_portal_frame keeps its exact root keys and now carries config._catalog.
--   * set_tenant_portal_config validates every module entry's shape (22023 invalid_portal_config),
--     refuses `_catalog`, keeps Home and Messages always on and unrenamed, trims labels, still
--     accepts every payload today's producers send, and keeps its authority and merge unchanged.
--   * grants are unchanged on both functions.
BEGIN;
SELECT plan(104);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES
 ('e0915a00-0000-4000-8000-000000000001','authenticated','authenticated','menu-owner-a@tests.invalid',now()),
 ('e0915a00-0000-4000-8000-000000000002','authenticated','authenticated','menu-member-a@tests.invalid',now()),
 ('e0915a00-0000-4000-8000-000000000003','authenticated','authenticated','menu-customer-a@tests.invalid',now()),
 ('e0915a00-0000-4000-8000-000000000004','authenticated','authenticated','menu-customer-b@tests.invalid',now()),
 ('e0915a00-0000-4000-8000-000000000005','authenticated','authenticated','menu-customer-c@tests.invalid',now()),
 ('e0915a00-0000-4000-8000-000000000006','authenticated','authenticated','menu-owner-b@tests.invalid',now()),
 ('e0915a00-0000-4000-8000-000000000007','authenticated','authenticated','menu-agency-owner@tests.invalid',now()),
 ('e0915a00-0000-4000-8000-000000000008','authenticated','authenticated','menu-two-businesses@tests.invalid',now()),
 ('e0915a00-0000-4000-8000-000000000009','authenticated','authenticated','menu-customer-d@tests.invalid',now());

-- A: authored, usable Playbook (Northwind Studio) with a portal catalog, a slug, and a stored
--    overlay that tries to forge `_catalog`.
-- B: a starter-library slug only.   C: neither.   D: agency.   E: D's sub-account.
-- F: authored but NOT usable (persona has no greeting), with 45 modules and an over-long label.
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,parent_tenant_id,features) VALUES
 ('e0925a00-0000-4000-8000-00000000000a','test-tenant-e09-menu-a','Northwind Studio','active','standalone','E09MA',9451001,NULL,
  jsonb_build_object(
   'playbook','consulting',
   'playbook_config',jsonb_build_object(
     'persona',jsonb_build_object('name','Northwind guide','greeting','SECRET GREETING','tone','warm'),
     'intake',jsonb_build_array(jsonb_build_object('key','goal','label','SECRET INTAKE')),
     'probingQuestions',jsonb_build_array('SECRET PROBE'),
     'portal',jsonb_build_object('modules',jsonb_build_array(
       jsonb_build_object('key','home','label','Home'),
       jsonb_build_object('key','sessions','label','Meetings'),
       jsonb_build_object('key',42,'label','not a string key'),
       jsonb_build_object('key','resources'),
       'not an object',
       jsonb_build_object('key','progress','label','Progress','icon','SECRET ICON')))),
   'portal_config',jsonb_build_object(
     'welcome','Welcome to Northwind',
     '_catalog',jsonb_build_object('slug','forged','forged',true),
     'modules',jsonb_build_array(jsonb_build_object('key','home','visible',true,'order',0))))),
 ('e0925a00-0000-4000-8000-00000000000b','test-tenant-e09-menu-b','Test tenant menu B','active','standalone','E09MB',9451002,NULL,
  '{"playbook":"fitness"}'),
 ('e0925a00-0000-4000-8000-00000000000c','test-tenant-e09-menu-c','Test tenant menu C','active','standalone','E09MC',9451003,NULL,'{}'),
 ('e0925a00-0000-4000-8000-00000000000d','test-tenant-e09-menu-d','Test agency menu D','active','agency','E09MD',9451004,NULL,'{}'),
 ('e0925a00-0000-4000-8000-00000000000e','test-tenant-e09-menu-e','Test sub-account menu E','active','sub_account','E09ME',9451005,
  'e0925a00-0000-4000-8000-00000000000d','{}'),
 ('e0925a00-0000-4000-8000-00000000000f','test-tenant-e09-menu-f','Test tenant menu F','active','standalone','E09MF',9451006,NULL,
  jsonb_build_object('playbook_config',jsonb_build_object(
    'persona',jsonb_build_object('name','No greeting'),
    'portal',jsonb_build_object('modules',(
      SELECT jsonb_agg(jsonb_build_object('key','m'||g,'label',CASE WHEN g=1 THEN repeat('L',100) ELSE 'Item '||g END) ORDER BY g)
      FROM generate_series(1,45) g)))));

INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0925a00-0000-4000-8000-00000000000a','e0915a00-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0925a00-0000-4000-8000-00000000000a','e0915a00-0000-4000-8000-000000000002','member','active',false,now()),
 ('e0925a00-0000-4000-8000-00000000000b','e0915a00-0000-4000-8000-000000000006','owner','active',true,now()),
 ('e0925a00-0000-4000-8000-00000000000d','e0915a00-0000-4000-8000-000000000007','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e0925a00-0000-4000-8000-00000000000a'
 WHERE user_id IN('e0915a00-0000-4000-8000-000000000001','e0915a00-0000-4000-8000-000000000002');

INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0935a00-0000-4000-8000-000000000001','e0925a00-0000-4000-8000-00000000000a','e0915a00-0000-4000-8000-000000000003','e0915a00-0000-4000-8000-000000000001','Jordan','Rivera','active'),
 ('e0935a00-0000-4000-8000-000000000002','e0925a00-0000-4000-8000-00000000000b','e0915a00-0000-4000-8000-000000000004','e0915a00-0000-4000-8000-000000000006','Sam','Okafor','active'),
 ('e0935a00-0000-4000-8000-000000000003','e0925a00-0000-4000-8000-00000000000c','e0915a00-0000-4000-8000-000000000005','e0915a00-0000-4000-8000-000000000001','Casey','Lin','active'),
 ('e0935a00-0000-4000-8000-000000000006','e0925a00-0000-4000-8000-00000000000f','e0915a00-0000-4000-8000-000000000009','e0915a00-0000-4000-8000-000000000001','Drew','Patel','active');

CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
-- Owner A writes; returns the RPC result or {sqlstate,error}.
CREATE FUNCTION pg_temp.set_a(_patch jsonb, _actor uuid DEFAULT 'e0915a00-0000-4000-8000-000000000001') RETURNS jsonb
LANGUAGE sql AS $$
 SELECT pg_temp.as_user(_actor, format('SELECT public.set_tenant_portal_config(%L,%L::jsonb)',
   'e0925a00-0000-4000-8000-00000000000a', _patch::text));
$$;
CREATE FUNCTION pg_temp.refused(_patch jsonb) RETURNS text
LANGUAGE sql AS $$ SELECT (r->>'sqlstate')||'|'||(r->>'error') FROM (SELECT pg_temp.set_a(_patch) r) x; $$;

-- ── 1. Grants unchanged ─────────────────────────────────────────────────────────────────────
SELECT ok(has_function_privilege('authenticated','public.get_client_portal_config()','EXECUTE'),'config read: authenticated may execute');
SELECT ok(NOT has_function_privilege('anon','public.get_client_portal_config()','EXECUTE'),'config read: anon may not execute');
SELECT ok(NOT has_function_privilege('service_role','public.get_client_portal_config()','EXECUTE'),'config read: no service_role grant added');
SELECT ok((SELECT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=public, pg_temp']::text[] FROM pg_proc WHERE oid='public.get_client_portal_config()'::regprocedure),'config read: still STABLE SECURITY DEFINER with its search_path');
SELECT ok(has_function_privilege('authenticated','public.set_tenant_portal_config(uuid,jsonb)','EXECUTE'),'config write: authenticated may execute');
SELECT ok(NOT has_function_privilege('anon','public.set_tenant_portal_config(uuid,jsonb)','EXECUTE'),'config write: anon may not execute');
SELECT ok(NOT has_function_privilege('service_role','public.set_tenant_portal_config(uuid,jsonb)','EXECUTE'),'config write: no service_role grant added');
SELECT is((SELECT cardinality(proacl) FROM pg_proc WHERE oid='public.set_tenant_portal_config(uuid,jsonb)'::regprocedure),2,'config write: ACL is exactly owner + authenticated');

-- ── 2. The customer's catalog, for their own relationship only ──────────────────────────────
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',
 $q$SELECT public.get_client_portal_config()$q$)->'_catalog') k),ARRAY['authored_usable','modules','slug'],'authored tenant: _catalog carries exactly slug, authored_usable, modules');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',$q$SELECT public.get_client_portal_config()$q$)#>>'{_catalog,slug}','consulting','authored tenant: slug passes through');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',$q$SELECT public.get_client_portal_config()$q$)#>'{_catalog,authored_usable}','true'::jsonb,'authored tenant: persona with name and greeting is usable');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',$q$SELECT public.get_client_portal_config()$q$)#>'{_catalog,modules}',
 '[{"key":"home","label":"Home"},{"key":"sessions","label":"Meetings"},{"key":"progress","label":"Progress"}]'::jsonb,
 'authored tenant: modules keep authored order, drop malformed rows, and carry only key + label');
SELECT ok(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',$q$SELECT public.get_client_portal_config()$q$)->'_catalog' ? 'forged' IS FALSE,'a tenant-stored _catalog never shadows the server one');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',$q$SELECT public.get_client_portal_config()$q$)->>'welcome','Welcome to Northwind','stored presentation keys still pass through');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',$q$SELECT public.get_client_portal_config()$q$)->'modules',
 '[{"key":"home","order":0,"visible":true}]'::jsonb,'stored overlay still passes through unchanged');
SELECT ok(strpos(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',$q$SELECT public.get_client_portal_config()$q$)::text,'SECRET')=0,'no persona, intake, probing or extra module field leaks');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000004',$q$SELECT public.get_client_portal_config()$q$)->'_catalog',
 '{"slug":"fitness","authored_usable":false,"modules":null}'::jsonb,'slug-only tenant: slug, not authored, no modules');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000005',$q$SELECT public.get_client_portal_config()$q$),
 '{"_catalog":{"slug":null,"authored_usable":false,"modules":null},"entitlements":{"finance":false}}'::jsonb,'tenant with neither: empty catalog inputs, no stored config (E09 F2: finance entitlement false)');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000009',$q$SELECT public.get_client_portal_config()$q$)#>'{_catalog,authored_usable}','false'::jsonb,'persona without a greeting is not usable');
SELECT is(jsonb_array_length(pg_temp.as_user('e0915a00-0000-4000-8000-000000000009',$q$SELECT public.get_client_portal_config()$q$)#>'{_catalog,modules}'),40,'authored modules are capped at 40');
SELECT is(length(pg_temp.as_user('e0915a00-0000-4000-8000-000000000009',$q$SELECT public.get_client_portal_config()$q$)#>>'{_catalog,modules,0,label}'),80,'authored labels are capped at 80 characters');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000001',$q$SELECT public.get_client_portal_config()$q$),'{}'::jsonb,'staff with no relationship get {}');
-- Two relationships are not reachable under the canonical unique link index; lift it for this one
-- case only (as customer_portal_progress.sql does) and restore it straight after.
DROP INDEX public.clients_linked_user_id_unique;
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0935a00-0000-4000-8000-000000000004','e0925a00-0000-4000-8000-00000000000a','e0915a00-0000-4000-8000-000000000008','e0915a00-0000-4000-8000-000000000001','Two','Businesses','active'),
 ('e0935a00-0000-4000-8000-000000000005','e0925a00-0000-4000-8000-00000000000b','e0915a00-0000-4000-8000-000000000008','e0915a00-0000-4000-8000-000000000006','Two','Businesses','active');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000008',$q$SELECT public.get_client_portal_config()$q$)->>'sqlstate','42501','two relationships refuse rather than pick one');
DELETE FROM public.clients WHERE id IN('e0935a00-0000-4000-8000-000000000004','e0935a00-0000-4000-8000-000000000005');
CREATE UNIQUE INDEX clients_linked_user_id_unique ON public.clients(linked_user_id) WHERE linked_user_id IS NOT NULL;
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.get_client_portal_config()$q$,'anon')->>'sqlstate','42501','anonymous read refused');

-- ── 3. The frame keeps its exact root keys and carries the catalog ──────────────────────────
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_frame()$q$)) k),ARRAY['actor_id','brand','config','profile'],'frame root keys unchanged');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',$q$SELECT public.client_portal_frame()$q$)#>>'{config,_catalog,slug}','consulting','frame config carries the catalog');

-- ── 4. Writer validation ────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.refused('{"_catalog":{"slug":"forged"}}'),'22023|invalid_portal_config','a _catalog key is reserved');
SELECT is(pg_temp.refused('{"modules":{"key":"home"}}'),'22023|invalid_portal_config','modules must be an array');
SELECT is(pg_temp.refused(jsonb_build_object('modules',(SELECT jsonb_agg(jsonb_build_object('key','k'||g)) FROM generate_series(1,41) g))),'22023|invalid_portal_config','more than 40 entries refused');
SELECT is(pg_temp.refused('{"modules":["home"]}'),'22023|invalid_portal_config','an entry must be an object');
SELECT is(pg_temp.refused('{"modules":[{"visible":true}]}'),'22023|invalid_portal_config','an entry must carry a key');
SELECT is(pg_temp.refused('{"modules":[{"key":"Bad Key"}]}'),'22023|invalid_portal_config','key pattern enforced');
SELECT is(pg_temp.refused(jsonb_build_object('modules',jsonb_build_array(jsonb_build_object('key',repeat('k',41))))),'22023|invalid_portal_config','key longer than 40 refused');
SELECT is(pg_temp.refused('{"modules":[{"key":7}]}'),'22023|invalid_portal_config','key must be a string');
SELECT is(pg_temp.refused('{"modules":[{"key":"sessions"},{"key":"sessions","visible":false}]}'),'22023|invalid_portal_config','duplicate key refused');
SELECT is(pg_temp.refused('{"modules":[{"key":"sessions","icon":"x"}]}'),'22023|invalid_portal_config','an extra field refused');
SELECT is(pg_temp.refused('{"modules":[{"key":"sessions","visible":"false"}]}'),'22023|invalid_portal_config','visible must be a boolean');
SELECT is(pg_temp.refused('{"modules":[{"key":"sessions","order":"1"}]}'),'22023|invalid_portal_config','order must be a number');
SELECT is(pg_temp.refused('{"modules":[{"key":"sessions","order":-1}]}'),'22023|invalid_portal_config','order below 0 refused');
SELECT is(pg_temp.refused('{"modules":[{"key":"sessions","order":1000.5}]}'),'22023|invalid_portal_config','order above 1000 refused');
SELECT is(pg_temp.refused('{"modules":[{"key":"sessions","label":"   "}]}'),'22023|invalid_portal_config','blank label refused');
SELECT is(pg_temp.refused(jsonb_build_object('modules',jsonb_build_array(jsonb_build_object('key','sessions','label',repeat('x',41))))),'22023|invalid_portal_config','label longer than 40 refused');
SELECT is(pg_temp.refused(jsonb_build_object('modules',jsonb_build_array(jsonb_build_object('key','sessions','label',E'Meet\nings')))),'22023|invalid_portal_config','label with a control character refused');
SELECT is(pg_temp.refused('{"modules":[{"key":"sessions","label":5}]}'),'22023|invalid_portal_config','label must be a string');
-- Invisible characters that change how a name reads (bidi overrides/isolates, zero-width, marks, BOM)
-- and a C1 control: each one refused, one assertion per code point, so a dropped range is named.
SELECT is(pg_temp.refused(jsonb_build_object('modules',jsonb_build_array(jsonb_build_object('key','sessions','label','Cal'||chr(cp)||'ls')))),
  '22023|invalid_portal_config', format('label with U+%s refused', upper(to_hex(cp))))
FROM unnest(ARRAY[x'202A'::int, x'202B'::int, x'202C'::int, x'202D'::int, x'202E'::int,
                  x'2066'::int, x'2067'::int, x'2068'::int, x'2069'::int,
                  x'200B'::int, x'200C'::int, x'200D'::int, x'200E'::int, x'200F'::int,
                  x'2060'::int, x'FEFF'::int, x'0085'::int]) AS cp;
SELECT is(pg_temp.refused('{"modules":[{"key":"home","visible":false}]}'),'22023|invalid_portal_config','Home cannot be hidden');
SELECT is(pg_temp.refused('{"modules":[{"key":"messages","visible":false}]}'),'22023|invalid_portal_config','Messages cannot be hidden');
SELECT is(pg_temp.refused('{"modules":[{"key":"home","label":"Start"}]}'),'22023|invalid_portal_config','Home cannot be renamed');
SELECT is(pg_temp.refused('{"modules":[{"key":"messages","label":"Chat"}]}'),'22023|invalid_portal_config','Messages cannot be renamed');
SELECT is((SELECT features->'portal_config'->'modules' FROM public.tenants WHERE id='e0925a00-0000-4000-8000-00000000000a'),
 '[{"key":"home","order":0,"visible":true}]'::jsonb,'every refusal left the stored overlay untouched');
-- Ordinary non-Latin names, accents and emoji stay allowed (each replaces the overlay; the next section sets its own).
SELECT is(pg_temp.set_a(jsonb_build_object('modules',jsonb_build_array(jsonb_build_object('key','sessions','label',l))))#>>'{modules,0,label}',
  l, 'an ordinary name is accepted: '||l)
FROM unnest(ARRAY['Séances','جلسات','セッション','Calls 📞']) AS l;

-- Accepted: the shapes today's producers send, and the new label.
SELECT is(pg_temp.set_a('{"modules":[{"key":"home","visible":true,"order":0},{"key":"resources","visible":true,"order":1}]}')->'modules',
 '[{"key":"home","visible":true,"order":0},{"key":"resources","visible":true,"order":1}]'::jsonb,'the stored production overlay shape (key/visible/order, Home visible) is accepted');
SELECT is(pg_temp.set_a('{"modules":[{"key":"messages","visible":true,"order":1},{"key":"funding-journey","visible":false,"order":2}]}')->'modules',
 '[{"key":"messages","visible":true,"order":1},{"key":"funding-journey","visible":false,"order":2}]'::jsonb,'Messages visible:true with an order, and hyphenated keys, are accepted');
SELECT is(pg_temp.set_a('{"modules":[{"key":"sessions","label":"  Meetings  ","visible":true,"order":2.5}]}')#>>'{modules,0,label}','Meetings','a label is accepted and stored trimmed');
SELECT is((SELECT features#>>'{portal_config,modules,0,label}' FROM public.tenants WHERE id='e0925a00-0000-4000-8000-00000000000a'),'Meetings','the trimmed label is what persists');
SELECT is(pg_temp.set_a('{"modules":[]}')->'modules','[]'::jsonb,'an empty overlay is accepted (resets to defaults)');
SELECT is(pg_temp.set_a('{"assistant":{"display_name":"Client guide"}}')#>>'{assistant,display_name}','Client guide','the assistant editor payload is accepted');
SELECT is(pg_temp.set_a('{"assistant":{"enabled":false}}')#>>'{assistant,display_name}','Client guide','assistant patches still deep-merge');
SELECT is(pg_temp.set_a('{"modules":[{"key":"sessions","visible":false}]}')->'modules','[{"key":"sessions","visible":false}]'::jsonb,'a modules patch still replaces the whole array (shallow merge unchanged)');
SELECT is(pg_temp.set_a('{"welcome":"Hello from Northwind"}')->'modules','[{"key":"sessions","visible":false}]'::jsonb,'a welcome patch leaves modules intact');
SELECT is(pg_temp.set_a('{"welcome":"Hello from Northwind"}')#>>'{assistant,display_name}','Client guide','a welcome patch leaves the assistant intact');
SELECT is((SELECT features->'portal_config' ? '_catalog' FROM public.tenants WHERE id='e0925a00-0000-4000-8000-00000000000a'),true,'a pre-existing stored _catalog is not rewritten by an unrelated patch (inert, shadowed on read)');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000001',
 $q$SELECT public.set_tenant_portal_config('e0925a00-0000-4000-8000-00000000000a',NULL)$q$)->>'sqlstate','22023','a null patch is still refused');

-- ── 5. Authority unchanged ──────────────────────────────────────────────────────────────────
SELECT is(pg_temp.set_a('{"welcome":"member"}','e0915a00-0000-4000-8000-000000000002')->>'sqlstate','42501','a non-admin member is refused');
SELECT is(pg_temp.set_a('{"welcome":"foreign"}','e0915a00-0000-4000-8000-000000000006')->>'sqlstate','42501','another business owner is refused');
SELECT is(pg_temp.set_a('{"welcome":"customer"}','e0915a00-0000-4000-8000-000000000003')->>'sqlstate','42501','a customer is refused');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.set_tenant_portal_config('e0925a00-0000-4000-8000-00000000000a','{}')$q$,'anon')->>'sqlstate','42501','anonymous write refused');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000007',
 $q$SELECT public.set_tenant_portal_config('e0925a00-0000-4000-8000-00000000000e','{"modules":[{"key":"sessions","label":"Calls"}]}')$q$)#>>'{modules,0,label}','Calls','an agency owner manages its sub-account''s menu (ancestor chain)');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000006',
 $q$SELECT public.set_tenant_portal_config('e0925a00-0000-4000-8000-00000000000e','{"welcome":"x"}')$q$)->>'sqlstate','42501','an unrelated owner cannot manage that sub-account');
SELECT is((SELECT features->'portal_config'->>'welcome' FROM public.tenants WHERE id='e0925a00-0000-4000-8000-00000000000a'),'Hello from Northwind','refused writers changed nothing');

-- ── 6. The customer sees the owner's saved names after a write (round trip) ─────────────────
SELECT is(pg_temp.set_a('{"modules":[{"key":"sessions","label":"Meetings","order":1},{"key":"progress","visible":false}]}')->'modules',
 '[{"key":"sessions","label":"Meetings","order":1},{"key":"progress","visible":false}]'::jsonb,'owner saves a renamed and a hidden entry');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',$q$SELECT public.get_client_portal_config()$q$)->'modules',
 '[{"key":"sessions","label":"Meetings","order":1},{"key":"progress","visible":false}]'::jsonb,'the customer reads exactly what the owner saved');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000004',$q$SELECT public.get_client_portal_config()$q$)->'modules',NULL,'another business''s customer does not see it');

-- ── 7. The owner's read (Paige's read_tenant_portal_menu and her readback after a write) ────────────
SELECT ok((SELECT NOT prosecdef FROM pg_proc WHERE oid='public.read_tenant_portal_menu(uuid)'::regprocedure),'owner read runs with invoker rights (tenants RLS applies)');
SELECT ok(NOT has_function_privilege('anon','public.read_tenant_portal_menu(uuid)','EXECUTE'),'owner read: anon may not execute');
SELECT ok((SELECT NOT prosecdef AND provolatile='i' FROM pg_proc WHERE oid='public.portal_menu_catalog(jsonb)'::regprocedure),'catalog projection is a pure invoker function');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000001',
 $q$SELECT public.read_tenant_portal_menu('e0925a00-0000-4000-8000-00000000000a')$q$)->'modules',
 '[{"key":"sessions","label":"Meetings","order":1},{"key":"progress","visible":false}]'::jsonb,'owner reads exactly the stored overlay');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000001',
 $q$SELECT public.read_tenant_portal_menu('e0925a00-0000-4000-8000-00000000000a')$q$)->'catalog',
 pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',$q$SELECT public.get_client_portal_config()$q$)->'_catalog',
 'owner and customer read the identical catalog (one projection)');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.as_user('e0915a00-0000-4000-8000-000000000001',
 $q$SELECT public.read_tenant_portal_menu('e0925a00-0000-4000-8000-00000000000a')$q$)) k),ARRAY['catalog','modules','tenant_id'],'owner read returns nothing else from features');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000001',
 $q$SELECT public.read_tenant_portal_menu('e0925a00-0000-4000-8000-00000000000b')$q$)->>'sqlstate','42501','owner cannot read another business by naming it');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000002',
 $q$SELECT public.read_tenant_portal_menu('e0925a00-0000-4000-8000-00000000000a')$q$)->>'sqlstate','42501','a non-admin member is refused');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000003',
 $q$SELECT public.read_tenant_portal_menu('e0925a00-0000-4000-8000-00000000000a')$q$)->>'sqlstate','42501','a customer is refused');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.read_tenant_portal_menu('e0925a00-0000-4000-8000-00000000000a')$q$,'anon')->>'sqlstate','42501','anonymous read refused');

-- ── 8. The owner can see and switch off the new chat control ────────────────────────────────
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000001',
 $q$SELECT to_jsonb(x) - 'updated_at' FROM public.list_tool_autonomy() x WHERE tool_key='portal_menu_update'$q$),
 '{"tool_key":"portal_menu_update","label":"Change what clients see in their portal menu","category":"Business","mode":"confirm","is_default":true}'::jsonb,
 'portal_menu_update is a catalogue row, default confirm');
SELECT is(pg_temp.as_user('e0915a00-0000-4000-8000-000000000001',
 $q$SELECT to_jsonb(count(*)) FROM public.list_tool_autonomy() x WHERE tool_key='plan_item_set_client_share'$q$),'1'::jsonb,'the incumbent catalogue rows survive the wrapper');

SELECT * FROM finish();
ROLLBACK;
