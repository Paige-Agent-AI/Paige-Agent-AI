-- E09 Journey & Progress: full replayed schema, actual caller roles, synthetic data; all rolled back.
-- Proves: only a client-linked milestone/task can ever be shared (every writer, service role too);
-- the one share writer is bound to the current-workspace business admin, refuses a top-level agency,
-- is version-guarded, state-idempotent and audited once per real change; the customer reads only
-- the shared, non-cancelled work of their OWN relationship through an exact allowlist; clearing or
-- re-pointing an item's client clears its share (a real client delete included); cancelling an
-- item clears its share, so reopening it never re-exposes it without a new explicit share; the
-- owner's client-status read carries share state additively and counts only what the client can
-- see; the new chat control is in the owner's autonomy catalogue; and paige_customer_actions no
-- longer exposes its proposer or raw payload to API roles while its customer and INVOKER readers
-- keep working.
BEGIN;
SELECT plan(112);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0981000-0000-4000-8000-000000000001','authenticated','authenticated','progress-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0981000-0000-4000-8000-000000000002','authenticated','authenticated','progress-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0981000-0000-4000-8000-000000000003','authenticated','authenticated','jordan.rivera@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0981000-0000-4000-8000-000000000004','authenticated','authenticated','sam.okafor@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0981000-0000-4000-8000-000000000005','authenticated','authenticated','progress-staff-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0981000-0000-4000-8000-000000000006','authenticated','authenticated','progress-agency@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0981000-0000-4000-8000-000000000007','authenticated','authenticated','progress-sub-account@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0981000-0000-4000-8000-000000000008','authenticated','authenticated','progress-customer-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0981000-0000-4000-8000-000000000009','authenticated','authenticated','progress-two-businesses@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0981000-0000-4000-8000-000000000010','authenticated','authenticated','progress-merged@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e0982000-0000-4000-8000-000000000001','test-tenant-e09-progress-a','Northwind Studio','active','standalone',NULL,'E09RA',9481001,'{}'),
 ('e0982000-0000-4000-8000-000000000002','test-tenant-e09-progress-b','Test tenant progress B','active','standalone',NULL,'E09RB',9481002,'{}'),
 ('e0982000-0000-4000-8000-000000000003','test-tenant-e09-progress-agency','Test agency progress','active','agency',NULL,'E09RG',9481003,'{}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e0982000-0000-4000-8000-000000000004','test-tenant-e09-progress-sub','Test sub-account progress','active','sub_account','e0982000-0000-4000-8000-000000000003','E09RS',9481004,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0982000-0000-4000-8000-000000000001','e0981000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0982000-0000-4000-8000-000000000002','e0981000-0000-4000-8000-000000000002','owner','active',true,now()),
 ('e0982000-0000-4000-8000-000000000001','e0981000-0000-4000-8000-000000000005','member','active',false,now()),
 ('e0982000-0000-4000-8000-000000000003','e0981000-0000-4000-8000-000000000006','owner','active',true,now()),
 ('e0982000-0000-4000-8000-000000000004','e0981000-0000-4000-8000-000000000007','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e0982000-0000-4000-8000-000000000001'
 WHERE user_id IN('e0981000-0000-4000-8000-000000000001','e0981000-0000-4000-8000-000000000005');
-- The staff member holds the GLOBAL 'admin' app role but is only a member of this business: the
-- §59 trap. Business authority must come from this tenant's membership, never the global role.
INSERT INTO public.user_roles(user_id,role) VALUES ('e0981000-0000-4000-8000-000000000005','admin') ON CONFLICT DO NOTHING;
UPDATE public.profiles SET active_tenant_id='e0982000-0000-4000-8000-000000000002' WHERE user_id='e0981000-0000-4000-8000-000000000002';
UPDATE public.profiles SET active_tenant_id='e0982000-0000-4000-8000-000000000003' WHERE user_id='e0981000-0000-4000-8000-000000000006';
UPDATE public.profiles SET active_tenant_id='e0982000-0000-4000-8000-000000000004' WHERE user_id='e0981000-0000-4000-8000-000000000007';
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0983000-0000-4000-8000-000000000001','e0982000-0000-4000-8000-000000000001','e0981000-0000-4000-8000-000000000003','e0981000-0000-4000-8000-000000000001','Jordan','Rivera','active'),
 ('e0983000-0000-4000-8000-000000000002','e0982000-0000-4000-8000-000000000001','e0981000-0000-4000-8000-000000000004','e0981000-0000-4000-8000-000000000001','Sam','Okafor','active'),
 ('e0983000-0000-4000-8000-000000000003','e0982000-0000-4000-8000-000000000001',NULL,'e0981000-0000-4000-8000-000000000001','Unconnected','Contact','active'),
 ('e0983000-0000-4000-8000-000000000004','e0982000-0000-4000-8000-000000000001','e0981000-0000-4000-8000-000000000010','e0981000-0000-4000-8000-000000000001','Merged','Away','active'),
 ('e0983000-0000-4000-8000-000000000005','e0982000-0000-4000-8000-000000000001',NULL,'e0981000-0000-4000-8000-000000000001','Removed','Client','active'),
 ('e0983000-0000-4000-8000-000000000006','e0982000-0000-4000-8000-000000000002','e0981000-0000-4000-8000-000000000008','e0981000-0000-4000-8000-000000000002','Foreign','Customer','active'),
 ('e0983000-0000-4000-8000-000000000007','e0982000-0000-4000-8000-000000000004',NULL,'e0981000-0000-4000-8000-000000000007','Sub','Client','active'),
 ('e0983000-0000-4000-8000-000000000008','e0982000-0000-4000-8000-000000000003',NULL,'e0981000-0000-4000-8000-000000000006','Agency','Client','active');
-- The merged contact's survivor is the unconnected contact (same tenant, per the lineage FK).
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('app.crm_merge_lineage_write','on',true);
UPDATE public.clients SET merged_into_contact_id='e0983000-0000-4000-8000-000000000003',merged_at=now() WHERE id='e0983000-0000-4000-8000-000000000004';
SELECT set_config('app.crm_merge_lineage_write','off',true);
SELECT set_config('request.jwt.claims','{}',true);

-- Every fixture is inserted with its final share state and a known version: an INSERT does not run
-- the touch trigger, so updated_at stays exactly what the writer tests pass back.
-- Owner-writer items (Sam's contact unless stated). Version 2027-01-01T00:00:00Z.
INSERT INTO public.plan_items(id,tenant_id,item_type,created_by,contact_id,title,status,due_at,remind_at,client_shared_at,client_shared_by,updated_at) VALUES
 ('e0985000-0000-4000-8000-000000000001','e0982000-0000-4000-8000-000000000001','task','e0981000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000002','Draft the brand brief','open',now()+interval '2 days',NULL,NULL,NULL,'2027-01-01T00:00:00Z'),
 ('e0985000-0000-4000-8000-000000000002','e0982000-0000-4000-8000-000000000001','reminder','e0981000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000002','Call Sam','open',NULL,now()+interval '1 day',NULL,NULL,'2027-01-01T00:00:00Z'),
 ('e0985000-0000-4000-8000-000000000003','e0982000-0000-4000-8000-000000000001','task','e0981000-0000-4000-8000-000000000001',NULL,'Internal admin','open',NULL,NULL,NULL,NULL,'2027-01-01T00:00:00Z'),
 ('e0985000-0000-4000-8000-000000000004','e0982000-0000-4000-8000-000000000001','task','e0981000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000002','Dropped idea','cancelled',NULL,NULL,NULL,NULL,'2027-01-01T00:00:00Z'),
 ('e0985000-0000-4000-8000-000000000005','e0982000-0000-4000-8000-000000000001','task','e0981000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000002','Withdrawn after sharing','cancelled',NULL,NULL,now()-interval '3 days','e0981000-0000-4000-8000-000000000001','2027-01-01T00:00:00Z'),
 ('e0985000-0000-4000-8000-000000000006','e0982000-0000-4000-8000-000000000001','task','e0981000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000004','Merged client work','open',NULL,NULL,NULL,NULL,'2027-01-01T00:00:00Z'),
 ('e0985000-0000-4000-8000-000000000007','e0982000-0000-4000-8000-000000000002','task','e0981000-0000-4000-8000-000000000002','e0983000-0000-4000-8000-000000000006','Tenant B work','open',NULL,NULL,NULL,NULL,'2027-01-01T00:00:00Z'),
 ('e0985000-0000-4000-8000-000000000008','e0982000-0000-4000-8000-000000000004','task','e0981000-0000-4000-8000-000000000007','e0983000-0000-4000-8000-000000000007','Sub-account work','open',NULL,NULL,NULL,NULL,'2027-01-01T00:00:00Z'),
 ('e0985000-0000-4000-8000-000000000009','e0982000-0000-4000-8000-000000000003','task','e0981000-0000-4000-8000-000000000006','e0983000-0000-4000-8000-000000000008','Agency work','open',NULL,NULL,NULL,NULL,'2027-01-01T00:00:00Z'),
 ('e0985000-0000-4000-8000-000000000010','e0982000-0000-4000-8000-000000000001','task','e0981000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000003','Unconnected client work','open',NULL,NULL,NULL,NULL,'2027-01-01T00:00:00Z');

-- Customer-read items for Jordan, plus the ones he must never see.
INSERT INTO public.plan_items(id,tenant_id,item_type,parent_item_id,created_by,assigned_to_user_id,contact_id,title,summary,status,priority,due_at,completed_at,remind_at,metadata,client_shared_at,client_shared_by,updated_at) VALUES
 ('e0986000-0000-4000-8000-000000000001','e0982000-0000-4000-8000-000000000001','milestone',NULL,'e0981000-0000-4000-8000-000000000001','e0981000-0000-4000-8000-000000000005','e0983000-0000-4000-8000-000000000001','Onboarding','PRIVATE SUMMARY NOTE','in_progress','urgent',now()+interval '10 days',NULL,NULL,'{"internal":"PRIVATE METADATA"}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now()),
 ('e0986000-0000-4000-8000-000000000009','e0982000-0000-4000-8000-000000000001','milestone',NULL,'e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000001','Private planning milestone',NULL,'open','normal',NULL,NULL,NULL,'{}',NULL,NULL,now());
INSERT INTO public.plan_items(id,tenant_id,item_type,parent_item_id,created_by,assigned_to_user_id,contact_id,title,summary,status,priority,due_at,completed_at,remind_at,metadata,client_shared_at,client_shared_by,updated_at) VALUES
 ('e0986000-0000-4000-8000-000000000002','e0982000-0000-4000-8000-000000000001','task','e0986000-0000-4000-8000-000000000001','e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000001','Kickoff call',NULL,'open','normal',now()+interval '1 day',NULL,NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now()),
 ('e0986000-0000-4000-8000-000000000003','e0982000-0000-4000-8000-000000000001','task','e0986000-0000-4000-8000-000000000001','e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000001','Collect brand assets',NULL,'blocked','normal',now()-interval '1 day',NULL,NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now()),
 ('e0986000-0000-4000-8000-000000000004','e0982000-0000-4000-8000-000000000001','task','e0986000-0000-4000-8000-000000000009','e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000001','Signed the agreement',NULL,'done','normal',NULL,now()-interval '2 days',NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now()),
 ('e0986000-0000-4000-8000-000000000005','e0982000-0000-4000-8000-000000000001','task',NULL,'e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000001','Welcome pack sent',NULL,'done','normal',NULL,now()-interval '1 day',NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now()),
 ('e0986000-0000-4000-8000-000000000006','e0982000-0000-4000-8000-000000000001','task',NULL,'e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000001','UNSHARED OWN TASK',NULL,'open','normal',NULL,NULL,NULL,'{}',NULL,NULL,now()),
 ('e0986000-0000-4000-8000-000000000007','e0982000-0000-4000-8000-000000000001','task',NULL,'e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000002','SAMS SHARED TASK',NULL,'open','normal',NULL,NULL,NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now()),
 ('e0986000-0000-4000-8000-000000000008','e0982000-0000-4000-8000-000000000002','task',NULL,'e0981000-0000-4000-8000-000000000002',NULL,'e0983000-0000-4000-8000-000000000001','FOREIGN TENANT TASK',NULL,'open','normal',NULL,NULL,NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000002',now()),
 ('e0986000-0000-4000-8000-000000000010','e0982000-0000-4000-8000-000000000001','task',NULL,'e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000001','CANCELLED SHARED TASK',NULL,'cancelled','normal',NULL,NULL,NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now()),
 ('e0986000-0000-4000-8000-000000000011','e0982000-0000-4000-8000-000000000001','task',NULL,'e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000001','Undated follow-up',NULL,'open','normal',NULL,NULL,NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now()),
 ('e0986000-0000-4000-8000-000000000012','e0982000-0000-4000-8000-000000000001','reminder',NULL,'e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000001','JORDANS REMINDER',NULL,'open','normal',NULL,NULL,now()+interval '1 day','{}',NULL,NULL,now()),
 ('e0986000-0000-4000-8000-000000000013','e0982000-0000-4000-8000-000000000001','task',NULL,'e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000004','MERGED CONTACT TASK',NULL,'open','normal',NULL,NULL,NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now()),
 ('e0986000-0000-4000-8000-000000000014','e0982000-0000-4000-8000-000000000001','task',NULL,'e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000005','Removed client task',NULL,'open','normal',NULL,NULL,NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now()),
 ('e0986000-0000-4000-8000-000000000015','e0982000-0000-4000-8000-000000000001','task',NULL,'e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000002','Moved between clients',NULL,'open','normal',NULL,NULL,NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now()),
 ('e0986000-0000-4000-8000-000000000016','e0982000-0000-4000-8000-000000000001','task',NULL,'e0981000-0000-4000-8000-000000000001',NULL,'e0983000-0000-4000-8000-000000000002','Client cleared',NULL,'open','normal',NULL,NULL,NULL,'{}',now()-interval '5 days','e0981000-0000-4000-8000-000000000001',now());

CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon;
 ELSIF _role='service_role' THEN SET LOCAL ROLE service_role;
 ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.owner(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e0981000-0000-4000-8000-000000000001', _sql) $$;
CREATE FUNCTION pg_temp.jordan(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e0981000-0000-4000-8000-000000000003', _sql) $$;
-- The owner's share call for an item, at a given version.
CREATE FUNCTION pg_temp.share(_actor uuid, _tenant uuid, _item text, _shared boolean, _version timestamptz) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(_actor, format('SELECT public.plan_item_set_client_share(%L,%L,%L,%L,%L)', _actor, _tenant, _item, _shared, _version)) $$;
CREATE FUNCTION pg_temp.a_share(_item text, _shared boolean, _version timestamptz DEFAULT '2027-01-01T00:00:00Z') RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.share('e0981000-0000-4000-8000-000000000001','e0982000-0000-4000-8000-000000000001',_item,_shared,_version) $$;
CREATE FUNCTION pg_temp.item(_r jsonb, _id text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT e FROM jsonb_array_elements(_r->'items') e WHERE e->>'id' = _id $$;
CREATE FUNCTION pg_temp.ids(_r jsonb) RETURNS text LANGUAGE sql AS
 $$ SELECT string_agg(right(e->>'id',2), ',' ORDER BY o) FROM jsonb_array_elements(_r->'items') WITH ORDINALITY x(e,o) $$;
CREATE FUNCTION pg_temp.keys(_o jsonb) RETURNS text LANGUAGE sql AS
 $$ SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(_o) k $$;
CREATE FUNCTION pg_temp.audits(_item text) RETURNS bigint LANGUAGE sql AS
 $$ SELECT count(*) FROM public.audit_logs WHERE entity='plan_item' AND entity_id=_item::uuid AND action LIKE 'plan_item.client_%' $$;

-- 1. Schema: the marker exists and only a client-linked milestone/task can ever carry it.
SELECT has_column('public','plan_items','client_shared_at','plan_items carries client_shared_at');
SELECT has_column('public','plan_items','client_shared_by','plan_items carries client_shared_by');
SELECT is(pg_temp.as_user(NULL,$q$UPDATE public.plan_items SET client_shared_at=now() WHERE id='e0985000-0000-4000-8000-000000000002' RETURNING to_jsonb(id)$q$,'service_role')->>'sqlstate','23514','a reminder cannot be shared, even by the service role');
SELECT is(pg_temp.as_user(NULL,$q$UPDATE public.plan_items SET client_shared_at=now() WHERE id='e0985000-0000-4000-8000-000000000003' RETURNING to_jsonb(id)$q$,'service_role')->>'sqlstate','23514','an item with no client cannot be shared, even by the service role');
SELECT is((SELECT count(*) FROM public.plan_items WHERE client_shared_at IS NOT NULL AND id IN ('e0985000-0000-4000-8000-000000000001','e0985000-0000-4000-8000-000000000010')),0::bigint,'work starts private');

-- 2. Grants.
SELECT ok(NOT has_function_privilege('anon','public.plan_item_set_client_share(uuid,uuid,uuid,boolean,timestamptz)','EXECUTE'),'anon cannot execute the share writer');
SELECT ok(NOT has_function_privilege('service_role','public.plan_item_set_client_share(uuid,uuid,uuid,boolean,timestamptz)','EXECUTE'),'the service role cannot execute the share writer');
SELECT ok(NOT has_function_privilege('public','public.plan_item_set_client_share(uuid,uuid,uuid,boolean,timestamptz)','EXECUTE'),'PUBLIC cannot execute the share writer');
SELECT ok(has_function_privilege('authenticated','public.plan_item_set_client_share(uuid,uuid,uuid,boolean,timestamptz)','EXECUTE'),'signed-in callers can execute the share writer');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_progress(uuid,integer)','EXECUTE'),'anon cannot execute the customer read');
SELECT ok(has_function_privilege('authenticated','public.client_portal_progress(uuid,integer)','EXECUTE')
  AND has_function_privilege('service_role','public.client_portal_progress(uuid,integer)','EXECUTE'),'signed-in callers and the service role can execute the customer read');
SELECT ok(NOT has_function_privilege('authenticated','public._plan_items_client_share_guard()','EXECUTE'),'the share guard trigger function is not client-callable');

-- 3. Authority: business admin of the current workspace only.
SELECT is(pg_temp.share('e0981000-0000-4000-8000-000000000005','e0982000-0000-4000-8000-000000000001','e0985000-0000-4000-8000-000000000001',true,'2027-01-01T00:00:00Z')->>'sqlstate','42501','a non-admin member is refused');
SELECT is(pg_temp.share('e0981000-0000-4000-8000-000000000003','e0982000-0000-4000-8000-000000000001','e0985000-0000-4000-8000-000000000001',true,'2027-01-01T00:00:00Z')->>'sqlstate','42501','a customer is refused');
SELECT is(pg_temp.as_user('e0981000-0000-4000-8000-000000000001',$q$SELECT public.plan_item_set_client_share('e0981000-0000-4000-8000-000000000005','e0982000-0000-4000-8000-000000000001','e0985000-0000-4000-8000-000000000001',true,'2027-01-01T00:00:00Z')$q$)->>'sqlstate','42501','a caller claiming another actor is refused');
SELECT is(pg_temp.share('e0981000-0000-4000-8000-000000000001','e0982000-0000-4000-8000-000000000002','e0985000-0000-4000-8000-000000000001',true,'2027-01-01T00:00:00Z')->>'sqlstate','42501','a workspace that is not the caller''s current one is refused');
SELECT is(pg_temp.share('e0981000-0000-4000-8000-000000000002','e0982000-0000-4000-8000-000000000002','e0985000-0000-4000-8000-000000000001',true,'2027-01-01T00:00:00Z')->>'error','ITEM_NOT_FOUND','another business''s admin gets not found for this item');
SELECT is(pg_temp.share('e0981000-0000-4000-8000-000000000002','e0982000-0000-4000-8000-000000000002','e0985000-0000-4000-8000-0000000000ff',true,'2027-01-01T00:00:00Z')->>'error','ITEM_NOT_FOUND','the same code as a random id');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.plan_item_set_client_share(NULL,NULL,'e0985000-0000-4000-8000-000000000001',true,'2027-01-01T00:00:00Z')$q$,'anon')->>'sqlstate','42501','anonymous caller refused');
SELECT is((SELECT client_shared_at FROM public.plan_items WHERE id='e0985000-0000-4000-8000-000000000001'),NULL,'no refusal shared anything');

-- 4. Tier: never a top-level agency; a sub-account is the server's Sub-account tier row.
SELECT is(pg_temp.share('e0981000-0000-4000-8000-000000000006','e0982000-0000-4000-8000-000000000003','e0985000-0000-4000-8000-000000000009',true,'2027-01-01T00:00:00Z')->>'error','CLIENT_SHARE_UNAVAILABLE','a top-level agency cannot share client work');
SELECT is(pg_temp.share('e0981000-0000-4000-8000-000000000007','e0982000-0000-4000-8000-000000000004','e0985000-0000-4000-8000-000000000008',true,'2027-01-01T00:00:00Z')->>'ok','true','a sub-account admin shares their own client''s work');

-- 5. Shape refusals.
SELECT is(pg_temp.a_share('e0985000-0000-4000-8000-000000000003',true)->>'error','ITEM_NOT_CLIENT_LINKED','work with no client cannot be shared');
SELECT is(pg_temp.a_share('e0985000-0000-4000-8000-000000000002',true)->>'error','ITEM_NOT_SHAREABLE','a reminder cannot be shared');
SELECT is(pg_temp.a_share('e0985000-0000-4000-8000-000000000004',true)->>'error','ITEM_NOT_SHAREABLE','a cancelled item cannot be newly shared');
SELECT is(pg_temp.a_share('e0985000-0000-4000-8000-000000000006',true)->>'error','CONTACT_NOT_FOUND','a merged client''s work cannot be shared');
SELECT is(pg_temp.a_share('e0985000-0000-4000-8000-000000000001',NULL)->>'error','INVALID_REQUEST','a missing share flag is refused');
SELECT is(pg_temp.audits('e0985000-0000-4000-8000-000000000004')+pg_temp.audits('e0985000-0000-4000-8000-000000000006'),0::bigint,'refusals write no audit row');

-- 6. Version guard.
CREATE TEMP TABLE before_stale AS SELECT to_jsonb(p) AS row FROM public.plan_items p WHERE id='e0985000-0000-4000-8000-000000000001';
SELECT is((SELECT pg_temp.keys(x)||'|'||(x->>'ok')||'|'||(x->>'error')||'|'||((x->>'updated_at')::timestamptz='2027-01-01T00:00:00Z')::text
  FROM pg_temp.a_share('e0985000-0000-4000-8000-000000000001',true,'2026-12-31T00:00:00Z') x),
 'error,ok,updated_at|false|ITEM_CHANGED|true','a stale version is refused with the current one');
SELECT is((SELECT to_jsonb(p) FROM public.plan_items p WHERE id='e0985000-0000-4000-8000-000000000001'),(SELECT row FROM before_stale),'the row is byte-identical after a stale call');
SELECT is(pg_temp.a_share('e0985000-0000-4000-8000-000000000001',true,NULL)->>'error','ITEM_CHANGED','a missing version is refused');

-- 7. Share, replay, unshare.
CREATE TEMP TABLE first_share AS SELECT pg_temp.a_share('e0985000-0000-4000-8000-000000000001',true) AS r;
SELECT is((SELECT r - 'shared_at' - 'updated_at' FROM first_share),
 '{"ok":true,"replayed":false,"item_id":"e0985000-0000-4000-8000-000000000001","shared":true,"portal_connected":true,"portal_access":"open"}'::jsonb,'the owner shares a task with a connected client');
SELECT ok((SELECT client_shared_at IS NOT NULL AND client_shared_by='e0981000-0000-4000-8000-000000000001' AND updated_at=(SELECT (r->>'updated_at')::timestamptz FROM first_share)
  FROM public.plan_items WHERE id='e0985000-0000-4000-8000-000000000001'),'the row records who shared it and the new version');
CREATE TEMP TABLE after_share AS SELECT to_jsonb(p) AS row FROM public.plan_items p WHERE id='e0985000-0000-4000-8000-000000000001';
SELECT is(pg_temp.a_share('e0985000-0000-4000-8000-000000000001',true)->>'replayed','true','repeating the share (with the old version) replays');
SELECT is((SELECT to_jsonb(p) FROM public.plan_items p WHERE id='e0985000-0000-4000-8000-000000000001'),(SELECT row FROM after_share),'a replay writes nothing, updated_at unchanged');
CREATE TEMP TABLE unjoined_share AS SELECT pg_temp.a_share('e0985000-0000-4000-8000-000000000010',true) AS r;
SELECT is((SELECT r->>'portal_connected' FROM unjoined_share),'false','sharing with a client who has not joined the portal says so');
SELECT is((SELECT r->>'portal_access' FROM unjoined_share),'not_joined','and names why: not joined (E09 Slice 7)');
SELECT is(pg_temp.a_share('e0985000-0000-4000-8000-000000000005',false) - 'updated_at',
 '{"ok":true,"replayed":false,"item_id":"e0985000-0000-4000-8000-000000000005","shared":false,"shared_at":null,"portal_connected":true,"portal_access":"open"}'::jsonb,'a cancelled item can be unshared');
SELECT ok((SELECT client_shared_at IS NULL AND client_shared_by IS NULL FROM public.plan_items WHERE id='e0985000-0000-4000-8000-000000000005'),'unsharing clears both marker columns');
SELECT is(pg_temp.a_share('e0985000-0000-4000-8000-000000000005',false)->>'replayed','true','repeating the unshare replays');

-- 8. One audit row per real change.
SELECT is(pg_temp.audits('e0985000-0000-4000-8000-000000000001'),1::bigint,'one audit row for the share and none for its replay');
SELECT is((SELECT action||'|'||user_id::text||'|'||data::text FROM public.audit_logs WHERE entity='plan_item' AND entity_id='e0985000-0000-4000-8000-000000000001' AND action LIKE 'plan_item.client_%'),
 'plan_item.client_share|e0981000-0000-4000-8000-000000000001|'||jsonb_build_object('item_id','e0985000-0000-4000-8000-000000000001','tenant_id','e0982000-0000-4000-8000-000000000001','contact_id','e0983000-0000-4000-8000-000000000002')::text,
 'the share audit names the actor, the business, the client and the item');
SELECT is((SELECT string_agg(action, ',') FROM public.audit_logs WHERE entity='plan_item' AND entity_id='e0985000-0000-4000-8000-000000000005' AND action LIKE 'plan_item.client_%'),'plan_item.client_unshare','one unshare audit row and none for its replay');

-- 9. Customer read: who gets nothing.
CREATE TEMP TABLE jr AS SELECT pg_temp.jordan($q$SELECT public.client_portal_progress()$q$) AS r;
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_progress()$q$,'anon')->>'sqlstate','42501','anonymous read refused');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_progress()$q$)->>'error','customer authentication required','signed-out read refused with the exact message');
SELECT ok(pg_temp.as_user('e0981000-0000-4000-8000-000000000005',$q$SELECT public.client_portal_progress()$q$) IS NULL,'staff with no relationship gets NULL');
SELECT ok(pg_temp.owner($q$SELECT public.client_portal_progress()$q$) IS NULL,'the business owner is not a customer of their own business');
SELECT ok(pg_temp.jordan($q$SELECT public.client_portal_progress(p_tenant_id=>'e0982000-0000-4000-8000-000000000002')$q$) IS NULL,'a foreign business argument returns NULL, never that business''s rows');
DROP INDEX public.clients_linked_user_id_unique;
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0983000-0000-4000-8000-000000000009','e0982000-0000-4000-8000-000000000001','e0981000-0000-4000-8000-000000000009','e0981000-0000-4000-8000-000000000001','Two','Businesses','active'),
 ('e0983000-0000-4000-8000-000000000010','e0982000-0000-4000-8000-000000000002','e0981000-0000-4000-8000-000000000009','e0981000-0000-4000-8000-000000000002','Two','Businesses','active');
SELECT is(pg_temp.as_user('e0981000-0000-4000-8000-000000000009',$q$SELECT public.client_portal_progress()$q$),
 '{"sqlstate":"42501","error":"select an authorized customer relationship"}'::jsonb,'two relationships raise 42501 with the exact message');
DELETE FROM public.clients WHERE id IN ('e0983000-0000-4000-8000-000000000009','e0983000-0000-4000-8000-000000000010');
CREATE UNIQUE INDEX clients_linked_user_id_unique ON public.clients(linked_user_id) WHERE linked_user_id IS NOT NULL;

-- 10. Customer read: exact allowlist.
SELECT is((SELECT r->>'tenant_id' FROM jr),'e0982000-0000-4000-8000-000000000001','the read resolves the customer''s own business');
SELECT is((SELECT pg_temp.keys(r) FROM jr),'has_more,items,server_now,summary,tenant_id','the envelope carries exactly the allowlisted keys');
SELECT is((SELECT pg_temp.keys(pg_temp.item(r,'e0986000-0000-4000-8000-000000000001')) FROM jr),'completed_at,due_at,id,kind,parent_id,shared_at,state,title','an item carries exactly the allowlisted keys');
SELECT is((SELECT count(*) FROM jr, jsonb_array_elements(r->'items') e WHERE pg_temp.keys(e)<>'completed_at,due_at,id,kind,parent_id,shared_at,state,title'),0::bigint,'every item carries exactly the allowlisted keys');
SELECT is((SELECT pg_temp.keys(r->'summary') FROM jr),'done,open,overdue,shared','the summary carries exactly the allowlisted keys');
SELECT ok((SELECT strpos(r::text,'PRIVATE SUMMARY NOTE')=0 AND strpos(r::text,'PRIVATE METADATA')=0 AND strpos(r::text,'urgent')=0 FROM jr),'the summary note, metadata and priority are never projected');
SELECT ok((SELECT strpos(r::text,'e0981000-0000-4000-8000-000000000001')=0 AND strpos(r::text,'e0981000-0000-4000-8000-000000000005')=0
  AND strpos(r::text,'e0983000-0000-4000-8000-000000000001')=0 FROM jr),'the sharer, the assignee and the contact id are never projected');

-- 11. Customer read: what Jordan never sees.
SELECT ok((SELECT pg_temp.item(r,'e0986000-0000-4000-8000-000000000006') IS NULL AND strpos(r::text,'UNSHARED OWN TASK')=0 FROM jr),'an unshared item on his own contact is not visible');
SELECT ok((SELECT pg_temp.item(r,'e0986000-0000-4000-8000-000000000007') IS NULL FROM jr),'another customer''s shared item is not visible');
SELECT ok((SELECT pg_temp.item(r,'e0986000-0000-4000-8000-000000000008') IS NULL FROM jr),'a shared item in another business that points at his client id is not visible');
SELECT ok((SELECT pg_temp.item(r,'e0986000-0000-4000-8000-000000000012') IS NULL FROM jr),'a reminder is not visible');
SELECT ok((SELECT pg_temp.item(r,'e0986000-0000-4000-8000-000000000010') IS NULL FROM jr),'a cancelled shared item is not visible');
SELECT is(pg_temp.ids(pg_temp.as_user('e0981000-0000-4000-8000-000000000004',$q$SELECT public.client_portal_progress()$q$)),'01,07,15,16','the other customer sees only their own shared work');

-- 12. State mapping, parents, order, limit and summary.
SELECT is((SELECT pg_temp.ids(r) FROM jr),'03,02,01,11,05,04','open work by due date (undated last), then done work newest first');
SELECT is((SELECT string_agg(e->>'state', ',' ORDER BY o) FROM jr, jsonb_array_elements(r->'items') WITH ORDINALITY x(e,o)),
 'in_progress,not_started,in_progress,not_started,done,done','blocked reads as in progress; open as not started');
SELECT is((SELECT pg_temp.item(r,'e0986000-0000-4000-8000-000000000001')->>'kind' FROM jr),'milestone','a milestone says so');
SELECT is((SELECT pg_temp.item(r,'e0986000-0000-4000-8000-000000000002')->>'parent_id' FROM jr),'e0986000-0000-4000-8000-000000000001','a task under a shared milestone names it');
SELECT is((SELECT pg_temp.item(r,'e0986000-0000-4000-8000-000000000004')->>'parent_id' FROM jr),NULL,'a task under a private milestone names no parent');
SELECT ok((SELECT strpos(r::text,'e0986000-0000-4000-8000-000000000009')=0 AND strpos(r::text,'Private planning milestone')=0 FROM jr),'the private milestone never appears');
SELECT is((SELECT r->'summary' FROM jr),'{"shared":6,"done":2,"open":4,"overdue":1}'::jsonb,'summary counts every visible item and the one past due');
SELECT is((SELECT r->>'has_more' FROM jr),'false','the whole list fits');
CREATE TEMP TABLE jr2 AS SELECT pg_temp.jordan($q$SELECT public.client_portal_progress(p_limit=>2)$q$) AS r;
SELECT is((SELECT pg_temp.ids(r)||'|'||(r->>'has_more') FROM jr2),'03,02|true','a short page keeps the order and says more exist');
SELECT is((SELECT r->'summary' FROM jr2),(SELECT r->'summary' FROM jr),'the summary never depends on the page size');
SELECT is(pg_temp.ids(pg_temp.jordan($q$SELECT public.client_portal_progress(p_limit=>0)$q$)),'03','a limit below one is clamped to one');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_progress(p_limit=>1000)$q$)->>'has_more','false','a limit above 100 is clamped, not refused');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_progress(p_limit=>6)$q$)->>'has_more','false','an exact page reports nothing more');

-- 13. Clearing, re-pointing or deleting the client clears the share; merged clients see nothing.
UPDATE public.plan_items SET contact_id=NULL WHERE id='e0986000-0000-4000-8000-000000000016';
SELECT ok((SELECT client_shared_at IS NULL AND client_shared_by IS NULL FROM public.plan_items WHERE id='e0986000-0000-4000-8000-000000000016'),'clearing the client clears the share');
UPDATE public.plan_items SET contact_id='e0983000-0000-4000-8000-000000000001' WHERE id='e0986000-0000-4000-8000-000000000015';
SELECT ok((SELECT client_shared_at IS NULL FROM public.plan_items WHERE id='e0986000-0000-4000-8000-000000000015'),'moving work to another client never carries the share across');
SELECT ok((SELECT pg_temp.item(pg_temp.jordan($q$SELECT public.client_portal_progress()$q$),'e0986000-0000-4000-8000-000000000015') IS NULL),'work moved onto a client is not visible to them until shared');
DELETE FROM public.clients WHERE id='e0983000-0000-4000-8000-000000000005';
SELECT ok((SELECT contact_id IS NULL AND client_shared_at IS NULL AND client_shared_by IS NULL FROM public.plan_items WHERE id='e0986000-0000-4000-8000-000000000014'),'deleting a client succeeds and clears the share on their work');
SELECT ok(pg_temp.as_user('e0981000-0000-4000-8000-000000000010',$q$SELECT public.client_portal_progress()$q$) IS NULL,'a merged-away client''s login reads nothing');
SELECT ok((SELECT strpos(r::text,'MERGED CONTACT TASK')=0 FROM jr),'a merged contact''s shared work never reaches another customer');

-- 14. The owner's client-status read carries share state additively.
INSERT INTO public.plan_items(tenant_id,item_type,created_by,contact_id,title,status,due_at)
SELECT 'e0982000-0000-4000-8000-000000000001','task','e0981000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000003','Bulk task '||g,'open',now()+make_interval(days=>g)
FROM generate_series(1,55) g;
CREATE TEMP TABLE st AS SELECT pg_temp.owner($q$SELECT public.read_client_engagement_status('e0982000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000001')$q$) AS r;
-- Fixture 10 is shared AND cancelled: written by INSERT, which the guard trigger does not run, so
-- it stands for any row that reached that state past the trigger. The count must still skip it.
SELECT is((SELECT (r#>>'{work,shared}')::int FROM st),6,'work.shared counts only what the client can see (a cancelled share is not counted)');
SELECT is((SELECT (r#>>'{work,shared}')::int FROM st),(SELECT (r#>>'{summary,shared}')::int FROM jr),'work.shared agrees with the customer''s own summary');
SELECT is((SELECT count(*) FROM st, jsonb_array_elements(r#>'{work,items}') e WHERE NOT (e ? 'shared' AND e ? 'updated_at')),0::bigint,'every work item carries shared and updated_at');
SELECT is((SELECT pg_temp.keys(e) FROM st, jsonb_array_elements(r#>'{work,items}') e WHERE e->>'id'='e0986000-0000-4000-8000-000000000001'),
 'assigned,completed_at,due_at,id,item_type,plan_id,shared,status,title,updated_at','the item keys are the prior set plus shared and updated_at');
SELECT is((SELECT string_agg(right(e->>'id',2)||':'||(e->>'shared'), ',' ORDER BY e->>'id') FROM st, jsonb_array_elements(r#>'{work,items}') e WHERE e->>'id' IN ('e0986000-0000-4000-8000-000000000001','e0986000-0000-4000-8000-000000000006')),
 '01:true,06:false','shared reflects the marker per item');
SELECT is((SELECT (e->>'updated_at')::timestamptz FROM st, jsonb_array_elements(r#>'{work,items}') e WHERE e->>'id'='e0986000-0000-4000-8000-000000000002'),
 (SELECT updated_at FROM public.plan_items WHERE id='e0986000-0000-4000-8000-000000000002'),'updated_at is the row''s version');
CREATE TEMP TABLE st2 AS SELECT pg_temp.owner($q$SELECT public.read_client_engagement_status('e0982000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000003')$q$) AS r;
SELECT is((SELECT jsonb_array_length(r#>'{work,items}')||'|'||(r#>>'{work,items_has_more}')||'|'||(r#>>'{work,total}') FROM st2),'50|true|56','up to 50 items are listed, with the rest declared');

-- 14b. Cancelling clears the share; reopening never re-exposes it without a new explicit share.
CREATE FUNCTION pg_temp.set_status(_item text, _status text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.owner(format('SELECT public.plan_update_item_versioned(%L,%L,%L,%L,%L)', _item,
    'e0981000-0000-4000-8000-000000000001','e0982000-0000-4000-8000-000000000001',
    (SELECT updated_at FROM public.plan_items WHERE id=_item::uuid), _status)) $$;
CREATE FUNCTION pg_temp.jordan_sees(_item text) RETURNS boolean LANGUAGE sql AS
 $$ SELECT pg_temp.item(pg_temp.jordan($q$SELECT public.client_portal_progress()$q$), _item) IS NOT NULL $$;
CREATE FUNCTION pg_temp.owner_shared(_item text) RETURNS text LANGUAGE sql AS
 $$ SELECT e->>'shared' FROM jsonb_array_elements(pg_temp.owner($q$SELECT public.read_client_engagement_status('e0982000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000001')$q$)#>'{work,items}') e WHERE e->>'id'=_item $$;
SELECT ok(pg_temp.jordan_sees('e0986000-0000-4000-8000-000000000002'),'before: Jordan sees the shared Kickoff call');
SELECT is(pg_temp.set_status('e0986000-0000-4000-8000-000000000002','cancelled')->>'ok','true','the owner cancels the shared item through the versioned writer');
SELECT ok((SELECT client_shared_at IS NULL AND client_shared_by IS NULL FROM public.plan_items WHERE id='e0986000-0000-4000-8000-000000000002'),'cancelling clears both share columns');
SELECT ok(NOT pg_temp.jordan_sees('e0986000-0000-4000-8000-000000000002'),'the cancelled item leaves Jordan''s portal');
SELECT is(pg_temp.set_status('e0986000-0000-4000-8000-000000000002','open')->>'ok','true','the owner reopens it');
SELECT ok((SELECT status='open' AND client_shared_at IS NULL AND client_shared_by IS NULL FROM public.plan_items WHERE id='e0986000-0000-4000-8000-000000000002'),'reopened, it is still unshared');
SELECT ok(NOT pg_temp.jordan_sees('e0986000-0000-4000-8000-000000000002'),'reopening does not put it back in Jordan''s portal');
SELECT is(pg_temp.owner_shared('e0986000-0000-4000-8000-000000000002'),'false','the owner''s record shows it as private');
SELECT is(pg_temp.set_status('e0986000-0000-4000-8000-000000000003','in_progress')->>'ok','true','a status change short of cancelling goes through');
SELECT ok((SELECT client_shared_at IS NOT NULL FROM public.plan_items WHERE id='e0986000-0000-4000-8000-000000000003') AND pg_temp.jordan_sees('e0986000-0000-4000-8000-000000000003'),'only cancelling clears a share: an in-progress item stays shared');
SELECT is((pg_temp.owner($q$SELECT public.read_client_engagement_status('e0982000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000001')$q$)#>>'{work,shared}')::int,5,'work.shared drops the cancelled-then-reopened item');
SELECT is(pg_temp.a_share('e0986000-0000-4000-8000-000000000002',true,(SELECT updated_at FROM public.plan_items WHERE id='e0986000-0000-4000-8000-000000000002'))->>'ok','true','a new explicit share is accepted');
SELECT ok(pg_temp.jordan_sees('e0986000-0000-4000-8000-000000000002'),'only the new explicit share brings it back to Jordan');
SELECT is(pg_temp.as_user(NULL,$q$UPDATE public.plan_items SET status='cancelled' WHERE id='e0986000-0000-4000-8000-000000000011' RETURNING to_jsonb(client_shared_at IS NULL AND client_shared_by IS NULL)$q$,'service_role'),
 'true'::jsonb,'a direct service-role cancel clears the share too');

-- 14c. The owner can see and turn off the new chat control.
SELECT is(pg_temp.owner($q$SELECT to_jsonb(t) - 'updated_at' FROM public.list_tool_autonomy() t WHERE t.tool_key='plan_item_set_client_share'$q$),
 '{"tool_key":"plan_item_set_client_share","label":"Show or hide work in a client''s portal","category":"Planning","mode":"confirm","is_default":true}'::jsonb,
 'the share control is catalogued, defaulting to confirm');
SELECT is(pg_temp.owner($q$SELECT to_jsonb(count(*)) FROM public.list_tool_autonomy() t WHERE t.tool_key IN ('client_portal_invitation_send','plan_update_item')$q$),'2'::jsonb,
 'the incumbent catalogue rows survive the wrap');
SELECT ok(NOT has_function_privilege('authenticated','public._list_tool_autonomy_before_client_share(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public._list_tool_autonomy_before_client_share(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.list_tool_autonomy(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.list_tool_autonomy(uuid)','EXECUTE'),'only the public catalogue entry point is callable');

-- 15. paige_customer_actions: the proposer and raw payload stop reaching API roles.
SELECT ok(NOT has_column_privilege('authenticated','public.paige_customer_actions','initiated_by_admin_id','SELECT')
  AND NOT has_column_privilege('authenticated','public.paige_customer_actions','payload_json','SELECT'),'signed-in callers cannot read the proposer or the raw payload');
SELECT ok(NOT has_column_privilege('anon','public.paige_customer_actions','initiated_by_admin_id','SELECT')
  AND NOT has_column_privilege('anon','public.paige_customer_actions','payload_json','SELECT')
  AND NOT has_table_privilege('anon','public.paige_customer_actions','SELECT'),'anon cannot read the table at all');
SELECT is((SELECT count(*) FROM unnest(ARRAY['id','tenant_id','contact_id','action_type','title','body','status','expires_at','created_at','updated_at']) c
  WHERE has_column_privilege('authenticated','public.paige_customer_actions',c,'SELECT')),10::bigint,'signed-in callers keep the ten columns their readers use');
INSERT INTO public.paige_customer_actions(id,tenant_id,contact_id,initiated_by_admin_id,action_type,title,body,payload_json,status,expires_at)
VALUES('e0987000-0000-4000-8000-000000000001','e0982000-0000-4000-8000-000000000001','e0983000-0000-4000-8000-000000000001','e0981000-0000-4000-8000-000000000001',
 'task','Upload your logo','Use the highest resolution you have.','{"secret":"PRIVATE PAYLOAD"}','proposed',now()+interval '7 days');
SELECT is(pg_temp.jordan($q$SELECT to_jsonb(count(*)) FROM (SELECT a.id,a.tenant_id,a.contact_id,a.updated_at,a.action_type,a.title,a.body,a.status,a.expires_at,a.created_at,
  (SELECT count(*) FROM public.paige_customer_responses r WHERE r.action_id=a.id) FROM public.paige_customer_actions a
  WHERE a.tenant_id='e0982000-0000-4000-8000-000000000001' AND a.contact_id='e0983000-0000-4000-8000-000000000001') q$q$),'1'::jsonb,'the customer action-items read still returns the row');
SELECT is(pg_temp.jordan($q$SELECT to_jsonb(initiated_by_admin_id) FROM public.paige_customer_actions$q$)->>'sqlstate','42501','the customer cannot select the proposer');
SELECT is(pg_temp.jordan($q$SELECT public.list_pending_customer_actions('e0983000-0000-4000-8000-000000000001')$q$)#>>'{actions,0,title}','Upload your logo','the INVOKER pending-actions reader still works');

-- 16. E09 Slice 7: a paused client keeps the login link, so the share answer must not call them connected.
DO $$ BEGIN PERFORM set_config('paige.portal_access_write','1',true);
  UPDATE public.clients SET portal_access_state='paused',portal_access_reason='other',portal_access_changed_at=clock_timestamp()
   WHERE id='e0983000-0000-4000-8000-000000000002';
  PERFORM set_config('paige.portal_access_write','',true); END $$;
SELECT is((SELECT (r->>'portal_connected')||' '||(r->>'portal_access') FROM (SELECT pg_temp.a_share('e0985000-0000-4000-8000-000000000001',false,
  (SELECT updated_at FROM public.plan_items WHERE id='e0985000-0000-4000-8000-000000000001')) r) x),'false paused',
  'a share answer for a paused client says paused, not connected');

SELECT * FROM finish();
ROLLBACK;
