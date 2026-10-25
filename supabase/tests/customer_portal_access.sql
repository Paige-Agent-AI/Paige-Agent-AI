-- E09 Slice 7: pause / restore / end one joined client's portal access. Full replayed schema, actual
-- caller roles, synthetic businesses and people only (§63); everything rolls back.
-- Proves: the one owner writer (authority, version, replay, token revoke, audit with fixed refs), the
-- column guard and its derived transitions, the resolver predicate and every reader that bypassed it,
-- the notices that stop, end + re-invite + a different person, the merge rules, the honest customer
-- read, and that a pause at one business never touches another.
BEGIN;
SELECT plan(338);

-- Supabase's default table grants (RLS is the boundary) are reproduced, so every refusal below is the
-- policy's or the guard's, never a missing grant.
GRANT SELECT, UPDATE ON public.clients TO authenticated, service_role;
GRANT SELECT ON public.client_files, public.paige_customer_actions, public.paige_client_events,
  public.notifications, public.coach_clients, public.credit_report_uploads TO authenticated;

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0917000-0000-4000-8000-000000000001','authenticated','authenticated','access-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-000000000002','authenticated','authenticated','access-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-000000000003','authenticated','authenticated','access-customer-c@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-000000000004','authenticated','authenticated','access-customer-d@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-000000000005','authenticated','authenticated','access-member-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-000000000006','authenticated','authenticated','access-agency-owner@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-000000000007','authenticated','authenticated','access-customer-s@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-000000000008','authenticated','authenticated','access-customer-e@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-000000000009','authenticated','authenticated','access-coach-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-00000000000a','authenticated','authenticated','access-customer-f@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-00000000000b','authenticated','authenticated','access-customer-h@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-00000000000c','authenticated','authenticated','access-customer-x@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-00000000000d','authenticated','authenticated','access-customer-i@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-00000000000e','authenticated','authenticated','access-customer-j@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-00000000000f','authenticated','authenticated','access-customer-y@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-000000000010','authenticated','authenticated','access-operator@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,parent_tenant_id) VALUES
 ('e0927000-0000-4000-8000-000000000001','test-tenant-e09-access-a','Test business access A','active','standalone','E09XA',9471001,'{}',NULL),
 ('e0927000-0000-4000-8000-000000000002','test-tenant-e09-access-b','Test business access B','active','standalone','E09XB',9471002,'{}',NULL),
 ('e0927000-0000-4000-8000-000000000003','test-tenant-e09-access-g','Test agency access G','active','agency','E09XG',9471003,'{}',NULL);
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features,parent_tenant_id) VALUES
 ('e0927000-0000-4000-8000-000000000004','test-tenant-e09-access-s','Test sub-account access S','active','sub_account','E09XS',9471004,'{}','e0927000-0000-4000-8000-000000000003');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0927000-0000-4000-8000-000000000002','e0917000-0000-4000-8000-000000000002','owner','active',true,now()),
 ('e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000005','member','active',false,now()),
 ('e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000009','member','active',false,now()),
 ('e0927000-0000-4000-8000-000000000003','e0917000-0000-4000-8000-000000000006','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e0927000-0000-4000-8000-000000000001',full_name='Avery Owner' WHERE user_id='e0917000-0000-4000-8000-000000000001';
UPDATE public.profiles SET active_tenant_id='e0927000-0000-4000-8000-000000000001' WHERE user_id IN('e0917000-0000-4000-8000-000000000005','e0917000-0000-4000-8000-000000000009');
UPDATE public.profiles SET active_tenant_id='e0927000-0000-4000-8000-000000000002' WHERE user_id='e0917000-0000-4000-8000-000000000002';
-- The agency owner has switched into its sub-account (context switch, not a tenant argument).
UPDATE public.profiles SET active_tenant_id='e0927000-0000-4000-8000-000000000004' WHERE user_id='e0917000-0000-4000-8000-000000000006';
-- A global `admin` role on a plain member of A (§59 trap) and on A's owner (needed by the legacy
-- admin_propose_paige_actions gate). Neither may change what the writer allows.
INSERT INTO public.user_roles(user_id,role) VALUES ('e0917000-0000-4000-8000-000000000010','super_admin') ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles(user_id,role) VALUES ('e0917000-0000-4000-8000-000000000005','admin'),
 ('e0917000-0000-4000-8000-000000000001','admin'),('e0917000-0000-4000-8000-000000000004','client') ON CONFLICT DO NOTHING;
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status,assigned_coach_user_id) VALUES
 ('e0937000-0000-4000-8000-0000000000c1','e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000003','e0917000-0000-4000-8000-000000000001','Casey','Client','active',NULL),
 ('e0937000-0000-4000-8000-0000000000c2','e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000004','e0917000-0000-4000-8000-000000000001','Dana','Client','active','e0917000-0000-4000-8000-000000000009'),
 ('e0937000-0000-4000-8000-0000000000c3','e0927000-0000-4000-8000-000000000001',NULL,'e0917000-0000-4000-8000-000000000001','Unjoined','Contact','active',NULL),
 ('e0937000-0000-4000-8000-0000000000c4','e0927000-0000-4000-8000-000000000002',NULL,'e0917000-0000-4000-8000-000000000002','Foreign','Contact','active',NULL),
 ('e0937000-0000-4000-8000-0000000000c5','e0927000-0000-4000-8000-000000000004','e0917000-0000-4000-8000-000000000007','e0917000-0000-4000-8000-000000000006','Sub','Client','active',NULL),
 ('e0937000-0000-4000-8000-0000000000c6','e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000008','e0917000-0000-4000-8000-000000000001','Eli','Client','active',NULL),
 ('e0937000-0000-4000-8000-0000000000c7','e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-00000000000b','e0917000-0000-4000-8000-000000000001','Merge','Loser paused','active',NULL),
 ('e0937000-0000-4000-8000-0000000000c8','e0927000-0000-4000-8000-000000000001',NULL,'e0917000-0000-4000-8000-000000000001','Merge','Survivor','active',NULL),
 ('e0937000-0000-4000-8000-0000000000c9','e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-00000000000d','e0917000-0000-4000-8000-000000000001','Merge','Loser open','active',NULL),
 ('e0937000-0000-4000-8000-0000000000ca','e0927000-0000-4000-8000-000000000001',NULL,'e0917000-0000-4000-8000-000000000001','Merge','Survivor two','active',NULL),
 ('e0937000-0000-4000-8000-0000000000cb','e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-00000000000e','e0917000-0000-4000-8000-000000000001','Paused','Survivor','active',NULL),
 ('e0937000-0000-4000-8000-0000000000cc','e0927000-0000-4000-8000-000000000001',NULL,'e0917000-0000-4000-8000-000000000001','Merge','Loser three','active',NULL),
 ('e0937000-0000-4000-8000-0000000000cd','e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-00000000000c','e0917000-0000-4000-8000-000000000001','Multi','At A','active',NULL);

-- Both clients carry the invited address, so a stale open invitation would otherwise be redeemable.
DO $$ BEGIN
 PERFORM public._attach_client_address('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','email','access-customer-c@tests.invalid');
 PERFORM public._attach_client_address('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2','email','access-customer-d@tests.invalid');
END $$;
UPDATE public.client_contact_methods SET is_primary=true WHERE client_id IN('e0937000-0000-4000-8000-0000000000c1','e0937000-0000-4000-8000-0000000000c2');

CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon; ELSIF _role='service_role' THEN SET LOCAL ROLE service_role; ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
-- A service-role session with no end user (auth.uid() IS NULL): the legacy admin-delete-user path and
-- the CRM merge executor. Runs a statement list in one subtransaction; reports the first error.
CREATE FUNCTION pg_temp.as_service(_sql text) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb := '{"ok":true}';
BEGIN
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 SET LOCAL ROLE service_role;
 BEGIN EXECUTE _sql;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
-- The owner's action, reading the version first exactly as the card and Paige's executor do.
CREATE FUNCTION pg_temp.access(_actor uuid, _contact uuid, _action text, _reason text DEFAULT 'engagement_paused',
 _tenant uuid DEFAULT 'e0927000-0000-4000-8000-000000000001', _note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
 v:=pg_temp.as_user(_actor,format('SELECT public.read_client_portal_access(%L,%L)',_tenant,_contact));
 RETURN pg_temp.as_user(_actor,format('SELECT public.set_client_portal_access(%L,%L,%L,%L,%L,%L,%L)',
  _actor,_tenant,_contact,_action,_reason,_note,v->>'since'));
END $$;
CREATE FUNCTION pg_temp.state(_contact uuid) RETURNS text LANGUAGE sql AS $$
 SELECT portal_access_state||'|'||coalesce(linked_user_id::text,'-')||'|'||coalesce(portal_access_former_user_id::text,'-')
 FROM public.clients WHERE id=_contact $$;

-- ── 1. ACLs ────────────────────────────────────────────────────────────────────────────────────
SELECT ok(has_function_privilege('authenticated','public.set_client_portal_access(uuid,uuid,uuid,text,text,text,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('anon','public.set_client_portal_access(uuid,uuid,uuid,text,text,text,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.set_client_portal_access(uuid,uuid,uuid,text,text,text,timestamptz)','EXECUTE'),
  'the writer is authenticated-only: no anon, no service role');
SELECT ok(NOT has_function_privilege('anon','public.read_client_portal_access(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.client_portal_access_state()','EXECUTE'),'neither read is anonymous');
SELECT ok(NOT has_function_privilege('authenticated','public.client_portal_access_open(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.client_portal_access_open(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._clients_portal_access_guard()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._client_portal_access_projection(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._client_portal_access_authorize(uuid,uuid,boolean)','EXECUTE'),
  'the shared predicate, the guard and the internal helpers are not callable');
SELECT ok(NOT has_function_privilege('anon','public.is_program_client_owner(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.load_self_context()','EXECUTE')
  AND NOT has_function_privilege('anon','public.customer_paige_activity_summary(integer)','EXECUTE'),
  'the three former anon-callable customer readers are no longer anonymous');
SELECT ok(has_function_privilege('authenticated','public.is_program_client_owner(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.load_self_context()','EXECUTE'),'authenticated callers keep them');
-- Preserve the original authorization body after removing ONLY the declared
-- request-input additions; every other byte still has the original fingerprint.
CREATE TEMP TABLE resolver_preservation_source AS SELECT replace(replace(replace(replace(prosrc,$from0$  _business uuid;
$from0$,$to0$$to0$),$from1$  _business := public._client_portal_request_business();
  IF _business IS NOT NULL AND p_tenant_id IS NOT NULL AND _business <> p_tenant_id THEN RETURN NULL; END IF;
$from1$,$to1$$to1$),$from2$    AND (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id)
    AND (_business IS NULL OR c.tenant_id = _business);$from2$,$to2$    AND (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id);$to2$),$from3$    -- A request hint or argument narrows existing authority; neither supplies it.
$from3$,$to3$    -- Future multi-business support must select a legitimate relationship explicitly.
    -- A tenant argument narrows existing authority; it never supplies authority.
$to3$) AS body
 FROM pg_proc WHERE oid='public.client_portal_relationship_id(uuid)'::regprocedure;
SELECT is(md5(replace((SELECT body FROM resolver_preservation_source),
  $access$
    AND c.portal_access_state = 'open'$access$,'')),'f79189022b4dc36760b618a086a80e28',
  'the resolver retains the original body plus access and declared request narrowing');
SELECT isnt(md5(replace(replace((SELECT body FROM resolver_preservation_source),
  $access$
    AND c.portal_access_state = 'open'$access$,''),$predicate$c.status = 'active'$predicate$,'true')),
  'f79189022b4dc36760b618a086a80e28','negative control: unrelated authority predicate drift is still detected');
SELECT is(md5((SELECT prosrc FROM pg_proc WHERE oid='public.execute_crm_command(uuid,uuid,jsonb,text)'::regprocedure)),
  '33048f303543dc8572ddcc3d4c0a323b','the CRM merge executor the guard models is the production body, unchanged');

-- ── 2. The owner's read before anything happens (exact projection) ────────────────────────────
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.read_client_portal_access('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1')$q$)) k),
 ARRAY['can','changed_by_name','contact_id','invitation','joined','note','ok','reason','restore_blocked_by','since','state'],
 'the owner read has exactly its keys');
SELECT ok(strpos(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.read_client_portal_access('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1')$q$)::text,'e0917000-0000-4000-8000-000000000003')=0
 AND strpos(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.read_client_portal_access('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1')$q$)::text,'access-customer-c')=0,
 'it never carries the customer''s user id or email');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.read_client_portal_access('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1')$q$)->'can',
 '{"end": true, "pause": true, "invite": false, "restore": false}'::jsonb,'a joined client can be paused or ended, not restored or invited');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.read_client_portal_access('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c3')$q$)->'can',
 '{"end": false, "pause": false, "invite": true, "restore": false}'::jsonb,'an unjoined contact can only be invited');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.client_portal_relationship_id())$q$),
 to_jsonb('e0937000-0000-4000-8000-0000000000c1'::text),'an open relationship resolves');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_access_state()$q$),
 '{"state": "open"}'::jsonb,'the customer''s own read says open');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(x) - 'updated_at' FROM public.list_tool_autonomy() x WHERE tool_key='client_portal_access_set'$q$),
 '{"mode": "confirm", "label": "Pause, restore or end a client''s portal access", "category": "Business", "tool_key": "client_portal_access_set", "is_default": true}'::jsonb,
 'the chat control is a catalogue row the owner can see, default confirm');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(count(*)) FROM public.list_tool_autonomy() x WHERE tool_key='portal_menu_update'$q$),
 '1'::jsonb,'the incumbent catalogue rows survive the wrapper');

-- Fixtures that must disappear for the customer while paused, and survive.
INSERT INTO public.tenant_invite_tokens(id,tenant_id,token,kind,default_role,created_by,expires_at,max_uses,uses,contact_id,email) VALUES
 ('e0947000-0000-4000-8000-000000000001','e0927000-0000-4000-8000-000000000001','e09-access-open-token-c1','consumer','member','e0917000-0000-4000-8000-000000000001',now()+interval '7 days',1,0,'e0937000-0000-4000-8000-0000000000c1','access-customer-c@tests.invalid'),
 ('e0947000-0000-4000-8000-000000000002','e0927000-0000-4000-8000-000000000001','e09-access-used-token-c1','consumer','member','e0917000-0000-4000-8000-000000000001',now()+interval '7 days',1,1,'e0937000-0000-4000-8000-0000000000c1','access-customer-c@tests.invalid'),
 ('e0947000-0000-4000-8000-000000000003','e0927000-0000-4000-8000-000000000001','e09-access-used-token-c2','consumer','member','e0917000-0000-4000-8000-000000000001',now()+interval '7 days',1,1,'e0937000-0000-4000-8000-0000000000c2','access-customer-d@tests.invalid');
UPDATE public.tenant_invite_tokens SET last_used_at=now() WHERE id IN('e0947000-0000-4000-8000-000000000002','e0947000-0000-4000-8000-000000000003');
INSERT INTO public.audit_logs(user_id,entity,action,entity_id,data) VALUES
 ('e0917000-0000-4000-8000-000000000003','client_portal','consumer_invite_accepted','e0947000-0000-4000-8000-000000000002',
  '{"client_id":"e0937000-0000-4000-8000-0000000000c1","tenant_id":"e0927000-0000-4000-8000-000000000001"}'),
 ('e0917000-0000-4000-8000-000000000004','client_portal','consumer_invite_accepted','e0947000-0000-4000-8000-000000000003',
  '{"client_id":"e0937000-0000-4000-8000-0000000000c2","tenant_id":"e0927000-0000-4000-8000-000000000001"}');
INSERT INTO public.client_files(id,tenant_id,contact_id,uploaded_by_user_id,storage_path,original_filename,mime_type,size_bytes,visibility,upload_state) VALUES
 ('e0957000-0000-4000-8000-000000000001','e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','e0917000-0000-4000-8000-000000000003',
  'e0927000-0000-4000-8000-000000000001/e0937000-0000-4000-8000-0000000000c1/client_upload/e0917000-0000-4000-8000-000000000003/kept.pdf','kept.pdf','application/pdf',10,'client_upload','ready');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
 ('client-files','e0927000-0000-4000-8000-000000000001/e0937000-0000-4000-8000-0000000000c1/client_upload/e0917000-0000-4000-8000-000000000003/kept.pdf','e0917000-0000-4000-8000-000000000003'),
 ('btf-onboarding','e0937000-0000-4000-8000-0000000000c1/signed.pdf',NULL);
INSERT INTO public.paige_customer_actions(id,tenant_id,contact_id,initiated_by_admin_id,action_type,title,status) VALUES
 ('e0967000-0000-4000-8000-000000000001','e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','e0917000-0000-4000-8000-000000000001','recommendation','Kept step','customer_notified');
INSERT INTO public.paige_client_events(tenant_id,contact_id,event_kind,surface,actor_type,audience,visibility,title) VALUES
 ('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','client.message','client_portal','client','both','client_visible','Kept event');
INSERT INTO public.messages(tenant_id,thread_key,contact_id,channel_type,direction,status,recipients,body_text,meta) VALUES
 ('e0927000-0000-4000-8000-000000000001','contact:e0927000-0000-4000-8000-000000000001:e0937000-0000-4000-8000-0000000000c2','e0937000-0000-4000-8000-0000000000c2','portal','inbound','received','[]','Kept message','{"portal":{"request_id":"e0957000-0000-4000-8000-0000000000f1","author_role":"customer","kind":"message"}}');

-- The client's own consent to Paige-brokered actions (the legacy admin_propose_paige_actions gate).
-- Where the in-flight consent ledger (Slice 6) is present only the client may grant it, from the portal.
DO $$ BEGIN
 IF to_regprocedure('public.client_portal_set_shared_context_consent(boolean,uuid)') IS NOT NULL THEN
  PERFORM pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_set_shared_context_consent(true)$q$);
 ELSE
  UPDATE public.clients SET paige_shared_context_consent=true WHERE id='e0937000-0000-4000-8000-0000000000c1';
 END IF;
END $$;
SELECT ok((SELECT paige_shared_context_consent FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000c1'),'fixture: the client has consented');

-- Before the pause: the customer reaches every one of these.
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.client_files$q$),'1'::jsonb,'open: the customer sees their upload');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM storage.objects WHERE bucket_id='client-files'$q$),'1'::jsonb,'open: and can fetch its object by path');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.paige_customer_actions$q$),'1'::jsonb,'open: their action');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.paige_client_events$q$),'1'::jsonb,'open: their timeline event');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.get_client_rail('e0937000-0000-4000-8000-0000000000c1')$q$),'1'::jsonb,'open: their own rail');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.can_access_rail_topic('rail:client:e0937000-0000-4000-8000-0000000000c1'))$q$),'true'::jsonb,'open: the realtime rail:client topic admits the subject');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.is_program_client_owner('e0937000-0000-4000-8000-0000000000c1'))$q$),'true'::jsonb,'open: program ownership');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.get_workspace_brand()$q$),'1'::jsonb,'open: workspace brand');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_invite_status('e09-access-used-token-c1')->'status'$q$),'"accepted"'::jsonb,'open: the invitation reads accepted');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.can_access_contact('e0917000-0000-4000-8000-000000000003','e0937000-0000-4000-8000-0000000000c1'))$q$),'true'::jsonb,'open: the linked-customer contact branch admits them');
CREATE TEMP TABLE upload_reservation AS SELECT pg_temp.as_user('e0917000-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_begin_file_upload('e0957000-0000-4000-8000-000000000002','e0937000-0000-4000-8000-0000000000c1','second.pdf','application/pdf',10)$q$) r;
SELECT ok((SELECT r->>'storage_path' FROM upload_reservation) IS NOT NULL,'open: an upload reservation is made');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',format('SELECT to_jsonb(public.client_portal_can_upload_file_object(%L))',(SELECT r->>'storage_path' FROM upload_reservation))),'true'::jsonb,'open: storage would admit its object');

-- ── 3. Pause ───────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE paused AS SELECT pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','pause','payment',_note=>'  Waiting on the March invoice  ') r;
SELECT is((SELECT r->>'state' FROM paused),'paused','the owner pauses a joined client');
SELECT is((SELECT r->>'replayed' FROM paused),'false','first pause is not a replay');
SELECT is((SELECT portal_access_state||'|'||portal_access_reason||'|'||portal_access_changed_by||'|'||portal_access_note||'|'||(portal_access_changed_at IS NOT NULL)::text
  FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000c1'),
 'paused|payment|e0917000-0000-4000-8000-000000000001|Waiting on the March invoice|true','state, reason, who, when and the trimmed internal note are stored');
SELECT is((SELECT linked_user_id FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000c1'),'e0917000-0000-4000-8000-000000000003'::uuid,'a pause keeps the link');
SELECT ok((SELECT revoked_at IS NOT NULL FROM public.tenant_invite_tokens WHERE id='e0947000-0000-4000-8000-000000000001'),'the open invitation is revoked in the same write');
SELECT ok((SELECT revoked_at IS NULL FROM public.tenant_invite_tokens WHERE id='e0947000-0000-4000-8000-000000000002'),'the used (accepted) invitation is left as history');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE entity_id='e0937000-0000-4000-8000-0000000000c1' AND action='client_portal.access_paused'),1::bigint,'one audit row');
SELECT is((SELECT array_agg(k ORDER BY k) FROM public.audit_logs a, jsonb_object_keys(a.data) k WHERE a.entity_id='e0937000-0000-4000-8000-0000000000c1' AND a.action='client_portal.access_paused'),
 ARRAY['contact_id','new_state','prior_state','reason','signing_links_revoked','tenant_id','tokens_revoked','user_id'],'the audit row carries fixed references only');
SELECT ok((SELECT strpos(a.data::text,'March')=0 AND strpos(a.data::text,'Casey')=0 FROM public.audit_logs a WHERE a.entity_id='e0937000-0000-4000-8000-0000000000c1' AND a.action='client_portal.access_paused'),
 'never the note and never a name');
SELECT is((SELECT data->>'tokens_revoked' FROM public.audit_logs WHERE entity_id='e0937000-0000-4000-8000-0000000000c1' AND action='client_portal.access_paused'),'1','the audit counts the revoked invitation');
SELECT is((SELECT r->>'changed_by_name' FROM paused),'Avery Owner','the read names the owner who paused, not the customer');
-- Replay and version.
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','pause','payment')->>'replayed','true','pausing again is a replay');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE entity_id='e0937000-0000-4000-8000-0000000000c1' AND action LIKE 'client_portal.access_%'),1::bigint,'a replay writes no audit row');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.set_client_portal_access('e0917000-0000-4000-8000-000000000001','e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','restore',NULL,NULL,'2020-01-01T00:00:00Z')$q$)->>'error',
 'ACCESS_CHANGED','a stale version is refused');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.set_client_portal_access('e0917000-0000-4000-8000-000000000001','e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','restore',NULL,NULL,NULL)$q$)->>'error',
 'ACCESS_CHANGED','a missing version on a changed row is refused');
SELECT is(pg_temp.state('e0937000-0000-4000-8000-0000000000c1'),'paused|e0917000-0000-4000-8000-000000000003|-','a refused restore changes nothing');

-- ── 4. Paused: the resolver and every resolver-routed path refuse ─────────────────────────────
SELECT ok(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.client_portal_relationship_id())$q$) IS NULL,'paused: the resolver returns nothing');
SELECT ok(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_self_profile()$q$) IS NULL,'paused: self profile');
SELECT ok(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_frame()$q$) IS NULL,'paused: the portal frame');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_update_self_profile(now(),'{"first_name":"X"}'::jsonb)$q$)->>'sqlstate','42501','paused: profile update');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_welcome_state()$q$)->>'sqlstate','42501','paused: welcome state');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_save_welcome('x','{}'::jsonb,'{}'::jsonb)$q$)->>'sqlstate','42501','paused: welcome save');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.client_advance_onboarding_stage('invited') x$q$)->>'error','no_linked_client','paused: onboarding stage advance');
SELECT ok(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_conversation()$q$) IS NULL,'paused: conversation');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_send_message('hello','e0957000-0000-4000-8000-0000000000f2')$q$)->>'error','NO_RELATIONSHIP','paused: send message');
SELECT ok(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_sessions()$q$) IS NULL,'paused: sessions');
SELECT ok(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_progress()$q$) IS NULL,'paused: progress');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.customer_respond_to_action('e0967000-0000-4000-8000-000000000001','completed','done',now())$q$)->>'error','FORBIDDEN','paused: responding to an action');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_begin_file_upload('e0957000-0000-4000-8000-000000000003','e0937000-0000-4000-8000-0000000000c1','third.pdf','application/pdf',10)$q$)->>'sqlstate','42501','paused: beginning an upload');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_file_upload_status('e0957000-0000-4000-8000-000000000002')$q$)->>'sqlstate','42501','paused: upload status');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_finish_file_upload('e0957000-0000-4000-8000-000000000002')$q$)->>'sqlstate','42501','paused: finishing an upload');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',format('SELECT to_jsonb(public.client_portal_can_upload_file_object(%L))',(SELECT r->>'storage_path' FROM upload_reservation))),'false'::jsonb,'paused: storage no longer admits the reserved object');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',format($q$INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('client-files',%L,'e0917000-0000-4000-8000-000000000003') RETURNING to_jsonb(id)$q$,(SELECT r->>'storage_path' FROM upload_reservation)))->>'sqlstate','42501','paused: a client-files storage INSERT is refused');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_knowledge_context()$q$)->>'sqlstate','42501','paused: knowledge context');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.get_client_portal_brand()$q$),'0'::jsonb,'paused: portal brand');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.get_client_portal_config()$q$),'{}'::jsonb,'paused: portal config');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.paige_chat_thread_create(NULL,'customer','t','{}'::jsonb))$q$)->>'sqlstate','42501','paused: a customer chat thread cannot be created');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.record_rail_event('e0937000-0000-4000-8000-0000000000c1','client.message','client_portal','client','t'))$q$)->>'sqlstate','42501','paused: recording a rail event');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.client_files$q$),'0'::jsonb,'paused: client_files rows (policy)');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM storage.objects WHERE bucket_id='client-files'$q$),'0'::jsonb,'paused: a cached object path is refused too (client_files_get runs under client_files RLS)');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.paige_customer_actions$q$),'0'::jsonb,'paused: paige_customer_actions rows (policy)');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.paige_client_events$q$),'0'::jsonb,'paused: paige_client_events rows (policy)');

-- ── 4b. The race window: the resolver said open, then the pause committed ─────────────────────
-- Each customer writer calls the resolver and then re-proves the contact under a row lock. A pause that
-- commits between the two keeps the link, so only the re-check's own state predicate can stop the write.
-- Reproduce that window deterministically: swap in the resolver as it read BEFORE the pause (no state
-- predicate) inside this rolled-back transaction, call each writer as the paused customer, then restore.
INSERT INTO public.internal_bookings(id,tenant_id,host_user_id,contact_id,title,start_at,end_at,status) VALUES
 ('e0987000-0000-4000-8000-000000000001','e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000001',
  'e0937000-0000-4000-8000-0000000000c1','Race window session',now()+interval '3 days',now()+interval '3 days 1 hour','scheduled');
CREATE TEMP TABLE resolver_def AS SELECT pg_get_functiondef('public.client_portal_relationship_id(uuid)'::regprocedure) d;
DO $$ BEGIN
 EXECUTE replace((SELECT d FROM resolver_def),E'\n    AND c.portal_access_state = ''open''','');
END $$;
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.client_portal_relationship_id())$q$),
 to_jsonb('e0937000-0000-4000-8000-0000000000c1'::text),'race fixture: the resolver answers as it did before the pause committed');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_send_message('raced','e0957000-0000-4000-8000-0000000000f4')$q$)->>'error',
 'NO_RELATIONSHIP','race: send message is refused by the locked re-check');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_session_change_admit('e0987000-0000-4000-8000-000000000001','cancel','e0957000-0000-4000-8000-0000000000f5')$q$)->>'error',
 'SESSION_NOT_FOUND','race: a session change is not admitted');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_update_self_profile(now(),'{"first_name":"X"}'::jsonb)$q$)->>'error',
 'customer relationship unavailable','race: a profile update is refused under the lock');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_welcome_state()$q$)->>'error',
 'customer relationship unavailable','race: welcome state is refused under the lock');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_save_welcome('x','{}'::jsonb,'{}'::jsonb)$q$)->>'error',
 'customer relationship unavailable','race: a welcome save is refused under the lock');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_begin_file_upload('e0957000-0000-4000-8000-000000000004','e0937000-0000-4000-8000-0000000000c1','raced.pdf','application/pdf',10)$q$)->>'error',
 'file upload unavailable','race: an upload cannot begin');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_finish_file_upload('e0957000-0000-4000-8000-000000000002')$q$)->>'error',
 'file upload unavailable','race: an upload cannot finish');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.client_advance_onboarding_stage('invited') x$q$)->>'error',
 'no_linked_client','race: the onboarding stage cannot advance');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',format($q$SELECT public.customer_respond_to_action('e0967000-0000-4000-8000-000000000001','completed','done',%L)$q$,
 (SELECT updated_at FROM public.paige_customer_actions WHERE id='e0967000-0000-4000-8000-000000000001')))->>'error',
 'FORBIDDEN','race: an action response is refused under the lock');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.paige_chat_thread_create(NULL,'customer','t','{}'::jsonb))$q$)->>'error',
 'customer relationship unavailable','race: a customer chat thread is refused under the lock');
DO $$ BEGIN EXECUTE (SELECT d FROM resolver_def); END $$;
SELECT ok(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.client_portal_relationship_id())$q$) IS NULL,'race fixture: the real resolver is back');
-- The session fixture filed its own rail event; remove both so the counts below are unchanged.
DELETE FROM public.paige_client_events WHERE contact_id='e0937000-0000-4000-8000-0000000000c1' AND title<>'Kept event';
DELETE FROM public.internal_bookings WHERE id='e0987000-0000-4000-8000-000000000001';

-- ── 5. Paused: every reader that bypassed the resolver refuses too; staff keep theirs ─────────
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.get_client_rail('e0937000-0000-4000-8000-0000000000c1')$q$)->>'sqlstate','42501','paused: own rail');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.get_client_rail_for_chat('e0937000-0000-4000-8000-0000000000c1')$q$)->>'sqlstate','42501','paused: own rail for chat');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.can_access_rail_topic('rail:client:e0937000-0000-4000-8000-0000000000c1'))$q$),'false'::jsonb,'paused: the realtime rail:client topic refuses the next join');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.get_client_service_agreement()$q$),'0'::jsonb,'paused: service agreement');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.get_workspace_brand()$q$),'0'::jsonb,'paused: workspace brand');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.get_paige_persona_context()$q$),'0'::jsonb,'paused: persona context');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.is_program_client_owner('e0937000-0000-4000-8000-0000000000c1'))$q$),'false'::jsonb,'paused: program ownership (7 program/agreement/intake/payment policies)');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.load_self_context()$q$)->>'error','NO_LINKED_CONTACT','paused: self context');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.customer_paige_activity_summary()$q$)->>'error','NO_LINKED_CONTACT','paused: activity summary');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.can_access_contact('e0917000-0000-4000-8000-000000000003','e0937000-0000-4000-8000-0000000000c1'))$q$),'false'::jsonb,'paused: the linked-customer contact branch');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM storage.objects WHERE bucket_id='btf-onboarding'$q$),'0'::jsonb,'paused: signed agreements in storage');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_invite_status('e09-access-used-token-c1')->'status'$q$),'"paused"'::jsonb,'paused: the invitation no longer reads accepted');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(count(*)) FROM public.get_client_rail('e0937000-0000-4000-8000-0000000000c1')$q$),'1'::jsonb,'staff: the owner still reads the client''s rail');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(public.can_access_contact('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1'))$q$),'true'::jsonb,'staff: the owner still reaches the contact');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(public.can_access_rail_topic('rail:client:e0937000-0000-4000-8000-0000000000c1'))$q$),'true'::jsonb,'staff: the owner still subscribes to the client topic');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(count(*)) FROM public.client_files WHERE contact_id='e0937000-0000-4000-8000-0000000000c1'$q$),'2'::jsonb,'staff: the owner still sees the client''s files');
SELECT ok(public.tenant_staff_owns_user('e0917000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000003'),'paused: the team still sees what the person connected under their own login');

-- The customer's honest state.
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_access_state() - 'since'$q$),
 '{"state": "paused", "business": {"name": "Test business access A", "logo_url": null, "logo_dark_url": null}}'::jsonb,'paused: the customer reads paused and the business name');
SELECT ok(NOT (pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_access_state()$q$) ?| ARRAY['reason','note','contact_id','tenant_id'])
 AND strpos(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_access_state()$q$)::text,'March')=0,'never the reason, the note or an id');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000004',$q$SELECT public.client_portal_access_state()$q$),'{"state": "open"}'::jsonb,'another customer of the same business is untouched');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-00000000000a',$q$SELECT public.client_portal_access_state()$q$),'{"state": "none"}'::jsonb,'someone with no relationship reads none');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_access_state()$q$,'anon')->>'sqlstate','42501','anonymous state read refused');

-- ── 6. Owner notices and messages stop while paused ───────────────────────────────────────────
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.comms_portal_reply('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','Checking in','e0957000-0000-4000-8000-0000000000f3')$q$)->>'error',
 'PORTAL_ACCESS_PAUSED','a portal reply to a paused client is refused');
SELECT is((SELECT count(*) FROM public.messages WHERE contact_id='e0937000-0000-4000-8000-0000000000c1' AND channel_type='portal'),0::bigint,'no portal message is written');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='e0917000-0000-4000-8000-000000000003'),0::bigint,'and no notice reaches the person');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.admin_propose_paige_actions('e0937000-0000-4000-8000-0000000000c1','[{"title":"Next step"}]'::jsonb)$q$)->>'ok','true','a proposed action still waits on the contact');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='e0917000-0000-4000-8000-000000000003'),0::bigint,'but the paused person is not notified');
INSERT INTO public.paige_readiness_proposals(id,tenant_id,contact_id,status) VALUES
 ('e0977000-0000-4000-8000-000000000001','e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','pending');
UPDATE public.paige_readiness_proposals SET status='approved' WHERE id='e0977000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='e0917000-0000-4000-8000-000000000003'),0::bigint,'an approval trigger keyed on the link does not notify a paused person');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(count(*)) FROM public.start_client_impersonation('e0937000-0000-4000-8000-0000000000c1')$q$)->>'error',
 'client portal access is paused','viewing as a paused client names the state');

-- ── 7. Column lock ─────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$UPDATE public.clients SET portal_access_state='open' WHERE id='e0937000-0000-4000-8000-0000000000c1' RETURNING to_jsonb(id)$q$)->>'error',
 'PORTAL_ACCESS_SEAM_REQUIRED','a business admin cannot un-pause through the table');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$UPDATE public.clients SET portal_access_note='edited' WHERE id='e0937000-0000-4000-8000-0000000000c1' RETURNING to_jsonb(id)$q$)->>'error',
 'PORTAL_ACCESS_SEAM_REQUIRED','nor edit the note');
SELECT is(pg_temp.as_service($q$UPDATE public.clients SET portal_access_state='open' WHERE id='e0937000-0000-4000-8000-0000000000c1'$q$)->>'error',
 'PORTAL_ACCESS_SEAM_REQUIRED','a service-role write without the seam is refused too');
SELECT throws_ok($q$INSERT INTO public.clients(tenant_id,created_by,first_name,status,portal_access_state,linked_user_id) VALUES('e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000001','Forged','active','paused','e0917000-0000-4000-8000-00000000000f')$q$,
 '42501','PORTAL_ACCESS_SEAM_REQUIRED','a row cannot be born paused');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(public._create_client_with_contact_methods('e0927000-0000-4000-8000-000000000001','{"first_name":"New","portal_access_state":"paused"}'::jsonb,'[]'::jsonb))$q$)->>'sqlstate',
 '42501','contact creation is not callable by a signed-in user');
SELECT throws_like($q$SELECT public._create_client_with_contact_methods('e0927000-0000-4000-8000-000000000001','{"first_name":"New","portal_access_state":"paused"}'::jsonb,'[]'::jsonb)$q$,
 'CONTACT_FIELDS_REFUSED: portal_access_state %','and the server creator names the access columns as refused');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.clients$q$),'0'::jsonb,'a customer sees no raw contact row at all');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',
 $q$SELECT public.set_client_portal_access('e0917000-0000-4000-8000-000000000003','e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','restore',NULL,NULL,NULL)$q$)->>'sqlstate',
 '42501','a customer cannot call the writer');

-- ── 8. Authority ───────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000005','e0937000-0000-4000-8000-0000000000c2','pause')->>'error','PORTAL_ACCESS_NOT_AUTHORIZED','a plain member holding a global admin role is refused (§59)');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000009','e0937000-0000-4000-8000-0000000000c2','pause')->>'error','PORTAL_ACCESS_NOT_AUTHORIZED','the assigned coach is refused');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000002','e0937000-0000-4000-8000-0000000000c2','pause')->>'error','PORTAL_ACCESS_SCOPE_CHANGED','another business''s owner naming this business is refused');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000002','e0937000-0000-4000-8000-0000000000c2','pause',_tenant=>'e0927000-0000-4000-8000-000000000002')->>'error','CONTACT_NOT_FOUND','and from their own business this contact does not exist');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.set_client_portal_access('e0917000-0000-4000-8000-000000000002','e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2','pause','payment',NULL,NULL)$q$)->>'error',
 'PORTAL_ACCESS_SCOPE_CHANGED','the expected actor must be the caller');
SELECT is(pg_temp.as_user(NULL,
 $q$SELECT public.set_client_portal_access(NULL,'e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2','pause','payment',NULL,NULL)$q$,'anon')->>'sqlstate',
 '42501','anonymous callers are refused');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000006','e0937000-0000-4000-8000-0000000000c5','pause','payment','e0927000-0000-4000-8000-000000000004')->>'state','paused','the agency owner, switched into the sub-account, may act on its client');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000007',$q$SELECT to_jsonb(public.client_portal_relationship_id())$q$),NULL,'and that sub-account client is paused');
-- The platform operator acts only inside the workspace they have entered (D2): business A here.
UPDATE public.profiles SET active_tenant_id='e0927000-0000-4000-8000-000000000001' WHERE user_id='e0917000-0000-4000-8000-000000000010';
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000010',$q$SELECT public.read_client_portal_access('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c6')$q$)->>'state','open','the operator, inside business A, reads a client''s access');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000010',$q$SELECT public.read_client_portal_access('e0927000-0000-4000-8000-000000000002','e0937000-0000-4000-8000-0000000000c4')$q$)->>'error','PORTAL_ACCESS_SCOPE_CHANGED','but cannot reach a business they have not entered by naming it');
UPDATE public.profiles SET active_tenant_id='e0927000-0000-4000-8000-000000000003' WHERE user_id='e0917000-0000-4000-8000-000000000006';
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000006',$q$SELECT public.read_client_portal_access('e0927000-0000-4000-8000-000000000003','e0937000-0000-4000-8000-0000000000c5')$q$)->>'error','PORTAL_ACCESS_UNAVAILABLE','a top-level agency has no client book to act on');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000006',
 $q$SELECT public.set_client_portal_access('e0917000-0000-4000-8000-000000000006','e0927000-0000-4000-8000-000000000003','e0937000-0000-4000-8000-0000000000c5','restore',NULL,NULL,NULL)$q$)->>'error',
 'PORTAL_ACCESS_UNAVAILABLE','and cannot reach the sub-account''s client by naming itself');

-- ── 9. Transitions ─────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c3','pause')->>'error','NOT_JOINED','an unjoined contact cannot be paused');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c3','end','engagement_ended')->>'error','NOT_JOINED','or ended');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c3','restore',NULL)->>'error','NOT_JOINED','or restored');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2','pause',NULL)->>'error','INVALID_REQUEST','a pause needs a reason');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2','pause','because')->>'error','INVALID_REQUEST','from the fixed set');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2','suspend')->>'error','INVALID_REQUEST','an unknown action is refused');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2','pause','other',_note=>repeat('n',281))->>'error','INVALID_REQUEST','a note over 280 characters is refused');
UPDATE public.clients SET status='inactive' WHERE id='e0937000-0000-4000-8000-0000000000c1';
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','restore',NULL)::text,
 '{"ok": false, "error": "ACCESS_RESTORE_UNAVAILABLE", "reason": "contact_inactive"}','an inactive contact cannot be restored, and says why');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT public.read_client_portal_access('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1')$q$)->>'restore_blocked_by','contact_inactive','the owner read names the block');
UPDATE public.clients SET status='active' WHERE id='e0937000-0000-4000-8000-0000000000c1';

-- ── 10. Restore ────────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','restore',NULL)->>'state','open','the owner restores');
SELECT is((SELECT coalesce(portal_access_reason,'-')||'|'||coalesce(portal_access_note,'-') FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000c1'),'-|-','restore clears the reason and the note');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.client_portal_relationship_id())$q$),to_jsonb('e0937000-0000-4000-8000-0000000000c1'::text),'the same person comes back to the same relationship');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.client_files$q$),'2'::jsonb,'and sees exactly what they had');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE entity_id='e0937000-0000-4000-8000-0000000000c1' AND action='client_portal.access_restored'),1::bigint,'restore is audited');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','restore',NULL)->>'replayed','true','restoring an open relationship is a replay');

-- ── 11. Re-invite while paused, and an invitation from before the pause ───────────────────────
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1','pause','client_request')->>'state','paused','paused again');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT public.prepare_client_portal_invitation('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c1')$q$)->>'error',
 'CUSTOMER_INVITATION_TARGET_CHANGED','a paused client cannot be invited (restore, not invite)');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(public.accept_tenant_invite('e09-access-open-token-c1'))$q$)->>'error','invite has been revoked','the invitation open before the first pause was revoked by it');
SELECT is(pg_temp.state('e0937000-0000-4000-8000-0000000000c1'),'paused|e0917000-0000-4000-8000-000000000003|-','still paused');

-- ── 12. The link is locked while paused; a trusted unlink ends honestly ───────────────────────
DO $$ BEGIN PERFORM set_config('request.jwt.claims','{"sub":"e0917000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 PERFORM set_config('paige.link_ok','1',true); END $$;
SELECT throws_ok($q$UPDATE public.clients SET linked_user_id=NULL WHERE id='e0937000-0000-4000-8000-0000000000c1'$q$,'42501','PORTAL_ACCESS_PAUSED_LINK_LOCKED','a signed-in seam cannot cut a paused link');
SELECT throws_ok($q$UPDATE public.clients SET linked_user_id='e0917000-0000-4000-8000-00000000000f' WHERE id='e0937000-0000-4000-8000-0000000000c1'$q$,'42501','PORTAL_ACCESS_PAUSED_LINK_LOCKED','nor move a pause onto another person');
DO $$ BEGIN PERFORM set_config('paige.link_ok','',true); PERFORM set_config('request.jwt.claims','{}',true); END $$;
SELECT is(pg_temp.as_service($q$UPDATE public.clients SET linked_user_id=NULL WHERE id='e0937000-0000-4000-8000-0000000000c6'$q$)->>'ok','true','the legacy no-JWT unlink still runs');
SELECT is(pg_temp.state('e0937000-0000-4000-8000-0000000000c6'),'ended|-|e0917000-0000-4000-8000-000000000008','and it ends access honestly, remembering who');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000008',$q$SELECT public.client_portal_access_state()->'state'$q$),'"ended"'::jsonb,'so that person reads ended, not none');

-- ── 13. End ────────────────────────────────────────────────────────────────────────────────────
SELECT is((SELECT count(*) FROM public.coach_clients WHERE client_user_id='e0917000-0000-4000-8000-000000000004'),1::bigint,'before: the assigned coach holds a person-keyed grant row');
SELECT ok(public.tenant_staff_owns_user('e0917000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000004'),'before: the team sees what the person connected under their login');
INSERT INTO public.tenant_invite_tokens(id,tenant_id,token,kind,default_role,created_by,expires_at,max_uses,uses,contact_id,email) VALUES
 ('e0947000-0000-4000-8000-000000000004','e0927000-0000-4000-8000-000000000001','e09-access-open-token-c2','consumer','member','e0917000-0000-4000-8000-000000000001',now()+interval '7 days',1,0,'e0937000-0000-4000-8000-0000000000c2','access-customer-d@tests.invalid');
CREATE TEMP TABLE ended AS SELECT pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2','end','engagement_ended') r;
SELECT is((SELECT r->>'state' FROM ended),'ended','the owner ends access');
SELECT is(pg_temp.state('e0937000-0000-4000-8000-0000000000c2'),'ended|-|e0917000-0000-4000-8000-000000000004','the link is cleared and the former login remembered');
SELECT is((SELECT status||'|'||coalesce(lifecycle_stage::text,'-')||'|'||coalesce(onboarding_stage,'-') FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000c2'),
 (SELECT 'active|'||coalesce(lifecycle_stage::text,'-')||'|'||coalesce(onboarding_stage,'-') FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000c2'),'status, lifecycle and onboarding are untouched');
SELECT is((SELECT status FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000c2'),'active','the contact stays active');
SELECT is((SELECT count(*) FROM public.messages WHERE contact_id='e0937000-0000-4000-8000-0000000000c2'),1::bigint,'their messages are kept');
SELECT ok(EXISTS(SELECT 1 FROM auth.users WHERE id='e0917000-0000-4000-8000-000000000004'),'the Auth user is never deleted');
SELECT ok(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='e0917000-0000-4000-8000-000000000004' AND role='client'),'the global client role is kept');
SELECT is((SELECT count(*) FROM public.coach_clients WHERE client_user_id='e0917000-0000-4000-8000-000000000004'),0::bigint,'the inherited unlink trigger removes the person-keyed coach grant (named in the plan)');
SELECT ok(NOT public.tenant_staff_owns_user('e0917000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000004'),
 'after end the team no longer sees what the person connected under their own login (D1; the End card says so)');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000004',$q$SELECT public.client_portal_access_state() - 'since'$q$),
 '{"state": "ended", "business": {"name": "Test business access A", "logo_url": null, "logo_dark_url": null}}'::jsonb,'the ended person reads ended and the business');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000004',$q$SELECT public.client_portal_invite_status('e09-access-used-token-c2')->'status'$q$),'"ended"'::jsonb,'their invitation reads ended, not accepted');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000004',$q$SELECT to_jsonb(public.accept_tenant_invite('e09-access-open-token-c2'))$q$)->>'error','invite has been revoked','an invitation still open when access ended cannot bring the person back on their own');
SELECT is(pg_temp.state('e0937000-0000-4000-8000-0000000000c2'),'ended|-|e0917000-0000-4000-8000-000000000004','so access stays ended until the owner invites again');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2','end','engagement_ended')->>'replayed','true','ending again is a replay');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2','restore',NULL)->>'error','NOT_JOINED','ended cannot be restored: a new invitation brings them back');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(count(*)) FROM public.start_client_impersonation('e0937000-0000-4000-8000-0000000000c2')$q$)->>'error',
 'client portal access has ended','viewing as an ended client names the state');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$SELECT public.read_client_portal_access('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2')$q$)->'can',
 '{"end": false, "pause": false, "invite": true, "restore": false}'::jsonb,'an ended client can only be invited again');

-- ── 14. Re-invite after end: the same person, then a different person ─────────────────────────
CREATE TEMP TABLE reinvite AS SELECT pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.prepare_client_portal_invitation('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2')$q$) p;
SELECT is((SELECT p->>'recipient' FROM reinvite),'access-customer-d@tests.invalid','an ended contact is invitable through the unchanged invitation path');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',format($q$SELECT public.create_client_portal_invitation('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2',%L,'e0947000-0000-4000-8000-0000000000a1')$q$,(SELECT p->>'proposal_hash' FROM reinvite)))->>'state','prepared','the invitation is created');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000004',format('SELECT to_jsonb(public.accept_tenant_invite(%L))',(SELECT token FROM public.tenant_invite_tokens WHERE portal_operation_id='e0947000-0000-4000-8000-0000000000a1')))->>'sqlstate',NULL,'the same person accepts');
SELECT is(pg_temp.state('e0937000-0000-4000-8000-0000000000c2'),'open|e0917000-0000-4000-8000-000000000004|-','acceptance reopens access and forgets the former login');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000004',$q$SELECT to_jsonb(public.client_portal_relationship_id())$q$),to_jsonb('e0937000-0000-4000-8000-0000000000c2'::text),'the resolver returns the contact again');
SELECT is((SELECT count(*) FROM public.coach_clients WHERE client_user_id='e0917000-0000-4000-8000-000000000004'),1::bigint,'the coach grant is rebuilt from the contact''s assigned coach');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2','end','engagement_ended')->>'state','ended','ended once more');
UPDATE public.client_contact_methods SET value='access-customer-f@tests.invalid' WHERE client_id='e0937000-0000-4000-8000-0000000000c2';
CREATE TEMP TABLE reinvite2 AS SELECT pg_temp.as_user('e0917000-0000-4000-8000-000000000001',
 $q$SELECT public.prepare_client_portal_invitation('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2')$q$) p;
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',format($q$SELECT public.create_client_portal_invitation('e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c2',%L,'e0947000-0000-4000-8000-0000000000a2')$q$,(SELECT p->>'proposal_hash' FROM reinvite2)))->>'state','prepared','an invitation to a different address');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-00000000000a',format('SELECT to_jsonb(public.accept_tenant_invite(%L))',(SELECT token FROM public.tenant_invite_tokens WHERE portal_operation_id='e0947000-0000-4000-8000-0000000000a2')))->>'sqlstate',NULL,'a different person accepts');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000004',$q$SELECT public.client_portal_access_state()$q$),'{"state": "none"}'::jsonb,'the first person is no longer this contact: their ended notice is gone');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-00000000000a',$q$SELECT public.client_portal_access_state()$q$),'{"state": "open"}'::jsonb,'the new person is open');

-- ── 15. Merge (the executor's three statements, as it runs them: service role, no end user) ────
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000c7','pause','security')->>'state','paused','a merge loser is paused');
SELECT is(pg_temp.as_service($q$
 SELECT set_config('app.crm_merge_lineage_write','on',true);
 UPDATE public.clients SET linked_user_id=NULL WHERE id='e0937000-0000-4000-8000-0000000000c7';
 UPDATE public.clients SET linked_user_id='e0917000-0000-4000-8000-00000000000b' WHERE id='e0937000-0000-4000-8000-0000000000c8';
 UPDATE public.clients SET status='archived',merged_into_contact_id='e0937000-0000-4000-8000-0000000000c8',merged_at=clock_timestamp() WHERE id='e0937000-0000-4000-8000-0000000000c7';$q$)->>'error',
 'CRM_MERGE_PORTAL_ACCESS_PAUSED','a merge cannot launder a pause onto the survivor');
SELECT is(pg_temp.state('e0937000-0000-4000-8000-0000000000c7')||'/'||pg_temp.state('e0937000-0000-4000-8000-0000000000c8'),
 'paused|e0917000-0000-4000-8000-00000000000b|-/open|-|-','the whole merge rolls back: the loser stays paused and linked');
SELECT is(pg_temp.as_service($q$
 SELECT set_config('app.crm_merge_lineage_write','on',true);
 UPDATE public.clients SET linked_user_id=NULL WHERE id='e0937000-0000-4000-8000-0000000000c9';
 UPDATE public.clients SET linked_user_id='e0917000-0000-4000-8000-00000000000d' WHERE id='e0937000-0000-4000-8000-0000000000ca';
 UPDATE public.clients SET status='archived',merged_into_contact_id='e0937000-0000-4000-8000-0000000000ca',merged_at=clock_timestamp() WHERE id='e0937000-0000-4000-8000-0000000000c9';$q$)->>'ok',
 'true','an open linked loser merges into an unlinked survivor');
SELECT is(pg_temp.state('e0937000-0000-4000-8000-0000000000ca'),'open|e0917000-0000-4000-8000-00000000000d|-','the survivor carries the person, open');
SELECT is(pg_temp.state('e0937000-0000-4000-8000-0000000000c9'),'open|-|-','the archived loser is not stamped ended: the person kept their access');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-00000000000d',$q$SELECT to_jsonb(public.client_portal_relationship_id())$q$),to_jsonb('e0937000-0000-4000-8000-0000000000ca'::text),'and resolves to the survivor');
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000cb','pause','security')->>'state','paused','a merge survivor is paused');
SELECT is(pg_temp.as_service($q$UPDATE public.clients SET linked_user_id='e0917000-0000-4000-8000-00000000000f' WHERE id='e0937000-0000-4000-8000-0000000000cb'$q$)->>'error',
 'PORTAL_ACCESS_PAUSED_LINK_LOCKED','a paused survivor''s identity cannot be swapped to someone else (X to Y)');
SELECT is(pg_temp.as_service($q$
 SELECT set_config('app.crm_merge_lineage_write','on',true);
 UPDATE public.clients SET status='archived',merged_into_contact_id='e0937000-0000-4000-8000-0000000000cb',merged_at=clock_timestamp() WHERE id='e0937000-0000-4000-8000-0000000000cc';$q$)->>'error',
 'CRM_MERGE_PORTAL_ACCESS_PAUSED','a merge INTO a paused survivor is refused too');
SELECT is((SELECT status FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000cc'),'active','and the would-be loser is untouched');

-- ── 15b. A signed-in team member cannot link a client record to their own login (probe P6) ───
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$UPDATE public.clients SET linked_user_id=auth.uid() WHERE id='e0937000-0000-4000-8000-0000000000c3' RETURNING to_jsonb(id)$q$)->>'error',
 'PORTAL_LINK_TARGET_IS_STAFF','a business owner cannot self-link an unjoined client record (the take-over lever)');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',$q$UPDATE public.clients SET linked_user_id=auth.uid() WHERE id='e0937000-0000-4000-8000-0000000000ca' RETURNING to_jsonb(id)$q$)->>'error',
 'PORTAL_LINK_TARGET_IS_STAFF','nor move a joined client''s record onto their own login and lock the client out');
SELECT is(pg_temp.state('e0937000-0000-4000-8000-0000000000ca'),'open|e0917000-0000-4000-8000-00000000000d|-','the joined client keeps their access');
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,status) VALUES
 ('e0937000-0000-4000-8000-0000000000cf','e0927000-0000-4000-8000-000000000004','e0917000-0000-4000-8000-000000000006','Sub','Unjoined','active');
UPDATE public.profiles SET active_tenant_id='e0927000-0000-4000-8000-000000000004' WHERE user_id='e0917000-0000-4000-8000-000000000006';
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000006',$q$UPDATE public.clients SET linked_user_id=auth.uid() WHERE id='e0937000-0000-4000-8000-0000000000cf' RETURNING to_jsonb(id)$q$)->>'error',
 'PORTAL_LINK_TARGET_IS_STAFF','an agency owner switched into its sub-account cannot self-link that sub-account''s client');
SELECT ok(NOT has_function_privilege('anon','public._clients_link_caller_is_team(uuid)','EXECUTE'),'the team check is not anonymous, and it only answers about the caller');
-- Agency staff on the agency team list (agency_team_members, no business membership) switched into the
-- sub-account are that sub-account's team too (verifier round 2, new finding 1).
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0917000-0000-4000-8000-000000000011','authenticated','authenticated','access-agency-admin@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.agency_team_members(agency_tenant_id,user_id,email,agency_role,status,joined_at) VALUES
 ('e0927000-0000-4000-8000-000000000003','e0917000-0000-4000-8000-000000000011','access-agency-admin@tests.invalid','agency_admin','active',now());
INSERT INTO public.user_roles(user_id,role) VALUES ('e0917000-0000-4000-8000-000000000011','admin') ON CONFLICT DO NOTHING;
UPDATE public.profiles SET active_tenant_id='e0927000-0000-4000-8000-000000000004' WHERE user_id='e0917000-0000-4000-8000-000000000011';
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000011',$q$SELECT to_jsonb(public.current_user_tenant_id())$q$),to_jsonb('e0927000-0000-4000-8000-000000000004'::text),
 'an agency-team-list admin with no business membership is switched into the sub-account');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000011',$q$UPDATE public.clients SET linked_user_id=auth.uid() WHERE id='e0937000-0000-4000-8000-0000000000cf' RETURNING to_jsonb(id)$q$)->>'error',
 'PORTAL_LINK_TARGET_IS_STAFF','agency-team-list staff switched into a sub-account cannot self-link that sub-account''s client');
SELECT is((SELECT linked_user_id FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000cf'),NULL::uuid,'and the record stays unjoined');
-- The platform operator stands above every business (§53): not a customer of one through the table.
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000010',$q$UPDATE public.clients SET linked_user_id=auth.uid() WHERE id='e0937000-0000-4000-8000-0000000000c3' RETURNING to_jsonb(id)$q$)->>'error',
 'PORTAL_LINK_TARGET_IS_STAFF','the platform operator cannot self-link a business''s client record');
SELECT is((SELECT linked_user_id FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000c3'),NULL::uuid,'and that record stays unjoined');
SELECT is(pg_temp.as_service($q$UPDATE public.clients SET linked_user_id='e0917000-0000-4000-8000-00000000000f' WHERE id='e0937000-0000-4000-8000-0000000000c3'$q$)->>'ok',
 'true','a person outside the team still links through a trusted path');

-- 16. Native multi-business: pausing A never touches B; actual indexes stay installed.
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0937000-0000-4000-8000-0000000000ce','e0927000-0000-4000-8000-000000000002','e0917000-0000-4000-8000-00000000000c','e0917000-0000-4000-8000-000000000002','Multi','At B','active');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-00000000000c',$q$SELECT to_jsonb(public.client_portal_relationship_id())$q$)->>'sqlstate','42501','two open relationships are ambiguous');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-00000000000c',$q$SELECT public.client_portal_access_state()$q$),'{"state": "multiple"}'::jsonb,'and the customer read says so');
CREATE TEMP TABLE b_before AS SELECT updated_at, portal_access_state FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000ce';
CREATE TEMP TABLE person_before AS SELECT (SELECT count(*) FROM public.user_roles WHERE user_id='e0917000-0000-4000-8000-00000000000c') roles,
 (SELECT count(*) FROM public.tenant_members WHERE user_id='e0917000-0000-4000-8000-00000000000c') memberships;
SELECT is(pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000cd','pause','other')->>'state','paused','business A pauses its relationship');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-00000000000c',$q$SELECT to_jsonb(public.client_portal_relationship_id())$q$),to_jsonb('e0937000-0000-4000-8000-0000000000ce'::text),
 'the paused relationship leaves the count before the ambiguity check: B resolves');
SELECT ok((SELECT b.updated_at=c.updated_at AND c.portal_access_state='open' FROM b_before b, public.clients c WHERE c.id='e0937000-0000-4000-8000-0000000000ce'),'business B''s row is untouched');
SELECT ok((SELECT p.roles=(SELECT count(*) FROM public.user_roles WHERE user_id='e0917000-0000-4000-8000-00000000000c')
  AND p.memberships=(SELECT count(*) FROM public.tenant_members WHERE user_id='e0917000-0000-4000-8000-00000000000c') FROM person_before p),
 'no role or membership of the person changes');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-00000000000c',$q$SELECT public.client_portal_access_state()$q$),'{"state": "open"}'::jsonb,'the person reads open (their B portal)');

-- 17. The original action-item owner projection: no staff-role retrofit or new history.
-- These rows are synthetic, inside this suite's existing BEGIN/ROLLBACK.
DELETE FROM public.user_roles WHERE user_id='e0917000-0000-4000-8000-000000000001' AND role='admin';
INSERT INTO public.paige_customer_actions(id,tenant_id,contact_id,initiated_by_admin_id,action_type,title,body,payload_json,status) VALUES
 ('e0959000-0000-4000-8000-000000000001','e0927000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000cd','e0917000-0000-4000-8000-000000000001','task','Review welcome guide','Read the shared guide.','{"internal":"PRIVATE ACTION PAYLOAD"}','customer_notified'),
 ('e0959000-0000-4000-8000-000000000002','e0927000-0000-4000-8000-000000000002','e0937000-0000-4000-8000-0000000000ce','e0917000-0000-4000-8000-000000000002','task','FOREIGN SERVICE REQUEST',NULL,'{}','proposed');
INSERT INTO public.paige_customer_responses(action_id,contact_id,responded_by_user_id,response_type,response_text) VALUES
 ('e0959000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000cd','e0917000-0000-4000-8000-00000000000c','question','Which section first?'),
 ('e0959000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000ce','e0917000-0000-4000-8000-00000000000c','question','FOREIGN RESPONSE CONTACT');
CREATE FUNCTION pg_temp.owner_actions(_actor uuid DEFAULT 'e0917000-0000-4000-8000-000000000001',
 _tenant uuid DEFAULT 'e0927000-0000-4000-8000-000000000001',_contact uuid DEFAULT 'e0937000-0000-4000-8000-0000000000cd',
 _expected uuid DEFAULT 'e0917000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user(_actor,format('SELECT public.list_pending_customer_actions(%L,%L,%L)',_expected,_tenant,_contact)) $$;
CREATE TEMP TABLE owner_actions_before AS SELECT
 (SELECT count(*) FROM public.paige_customer_actions) actions,
 (SELECT count(*) FROM public.paige_customer_responses) responses,
 (SELECT count(*) FROM public.notifications) notifications,
 (SELECT count(*) FROM public.paige_audit_log) audits;
CREATE TEMP TABLE owner_actions_read AS SELECT pg_temp.owner_actions() result;
SELECT ok(has_function_privilege('authenticated','public.list_pending_customer_actions(uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.list_pending_customer_actions(uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.list_pending_customer_actions(uuid,uuid,uuid)','EXECUTE'),'owner action projection is authenticated-only, not a service or anonymous reader');
SELECT ok(to_regprocedure('public.list_pending_customer_actions(uuid)') IS NOT NULL
 AND to_regprocedure('public.admin_propose_paige_actions(uuid,jsonb)') IS NOT NULL
 AND to_regprocedure('public.customer_respond_to_action(uuid,text,text,timestamptz)') IS NOT NULL,'original reader and writer signatures remain available');
SELECT is((SELECT result->>'schema_version' FROM owner_actions_read),'1','ordinary SOLO owner without global admin reads the bounded native contract');
SELECT is((SELECT result->>'tenant_id' FROM owner_actions_read),'e0927000-0000-4000-8000-000000000001','read belongs to the current authorized business');
SELECT is((SELECT result->>'contact_id' FROM owner_actions_read),'e0937000-0000-4000-8000-0000000000cd','read belongs to the exact original CRM customer');
SELECT is((SELECT result->'actions'->0->>'title' FROM owner_actions_read),'Review welcome guide','same original action is visible');
SELECT is((SELECT result->'actions'->0->'responses'->0->>'response_text' FROM owner_actions_read),'Which section first?','same original customer response is visible');
SELECT is((SELECT jsonb_array_length(result->'actions'->0->'responses') FROM owner_actions_read),1,'a response with a different contact is excluded even when its action id matches');
SELECT ok((SELECT result::text NOT LIKE '%PRIVATE ACTION PAYLOAD%' AND result::text NOT LIKE '%FOREIGN SERVICE REQUEST%'
 AND result::text NOT LIKE '%FOREIGN RESPONSE CONTACT%' AND result::text NOT LIKE '%linked_user_id%'
 AND result::text NOT LIKE '%responded_by_user_id%' AND result::text NOT LIKE '%initiated_by_admin_id%' FROM owner_actions_read),'projection omits private payloads, account identities and foreign records');
SELECT is((SELECT result->>'access_state' FROM owner_actions_read),'paused','paused client retains shared history, without implying active access');
SELECT is((SELECT (result->>'shared_context_consent')::boolean FROM owner_actions_read),
 (SELECT paige_shared_context_consent IS TRUE FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000cd'),'consent is the client-controlled saved value, not an owner grant');
SELECT is(pg_temp.owner_actions(_tenant=>'e0927000-0000-4000-8000-000000000002',_contact=>'e0937000-0000-4000-8000-0000000000ce')->>'sqlstate','42501','current A workspace cannot request business B');
SELECT is(pg_temp.owner_actions(_contact=>'e0937000-0000-4000-8000-0000000000ce')->>'sqlstate','42501','foreign customer cannot enter a current-business read');
SELECT is(pg_temp.owner_actions(_expected=>'e0917000-0000-4000-8000-000000000002')->>'sqlstate','42501','claimed expected actor never grants another identity');
SELECT is(pg_temp.owner_actions(_actor=>'e0917000-0000-4000-8000-000000000005',_expected=>'e0917000-0000-4000-8000-000000000005')->>'sqlstate','42501','global admin on a plain tenant member is not owner authority');
SELECT is(pg_temp.owner_actions(_actor=>'e0917000-0000-4000-8000-00000000000c',_expected=>'e0917000-0000-4000-8000-00000000000c')->>'sqlstate','42501','a customer never acquires owner inspection rights');
SELECT is(pg_temp.owner_actions('e0917000-0000-4000-8000-000000000002','e0927000-0000-4000-8000-000000000002','e0937000-0000-4000-8000-0000000000ce','e0917000-0000-4000-8000-000000000002')->'actions'->0->>'id',
 'e0959000-0000-4000-8000-000000000002','second legitimate SOLO cohort uses the same implementation');
SELECT ok((SELECT b.actions=(SELECT count(*) FROM public.paige_customer_actions)
 AND b.responses=(SELECT count(*) FROM public.paige_customer_responses)
 AND b.notifications=(SELECT count(*) FROM public.notifications)
 AND b.audits=(SELECT count(*) FROM public.paige_audit_log) FROM owner_actions_before b),'inspection/refusals create no action, response, notification or receipt');
SELECT ok(NOT has_function_privilege('authenticated','public._client_portal_access_authorize(uuid,uuid,boolean)','EXECUTE'),
 'adding the read never exposes or replaces internal owner authority');

-- 18. Owner-private preparation uses original Action Bus Work, not customer
-- publication. Reuse this suite's actual roles, triggers and RLS; no new runner.
CREATE FUNCTION pg_temp.private_request(_read boolean DEFAULT false,
 _actor uuid DEFAULT 'e0917000-0000-4000-8000-000000000001',
 _tenant uuid DEFAULT 'e0927000-0000-4000-8000-000000000001',
 _contact uuid DEFAULT 'e0937000-0000-4000-8000-0000000000cd',
 _expected uuid DEFAULT 'e0917000-0000-4000-8000-000000000001',
 _intent uuid DEFAULT 'e0959000-0000-4000-8000-000000000010',
 _title text DEFAULT 'Review the welcome guide',_body text DEFAULT 'Read the shared guide.',
 _role text DEFAULT 'authenticated') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user(_actor,CASE WHEN _read THEN
  format('SELECT public.read_client_portal_request_draft(%L,%L,%L,%L)',_expected,_tenant,_contact,_intent)
 ELSE format('SELECT public.prepare_client_portal_request(%L,%L,%L,%L,%L,%L)',_expected,_tenant,_contact,_intent,_title,_body) END,_role)
$$;
CREATE TEMP TABLE private_request_before AS SELECT
 (SELECT count(*) FROM public.paige_actions) work,
 (SELECT count(*) FROM public.paige_customer_actions) actions,
 (SELECT count(*) FROM public.paige_customer_responses) responses,
 (SELECT count(*) FROM public.notifications) notices,
 (SELECT count(*) FROM public.paige_pending_approvals) approvals,
 (SELECT paige_shared_context_consent FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000cd') consent;
SELECT ok(has_function_privilege('authenticated','public.prepare_client_portal_request(uuid,uuid,uuid,uuid,text,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.prepare_client_portal_request(uuid,uuid,uuid,uuid,text,text)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.prepare_client_portal_request(uuid,uuid,uuid,uuid,text,text)','EXECUTE'),'private preparation is authenticated-only');
SELECT ok(has_function_privilege('authenticated','public.read_client_portal_request_draft(uuid,uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.read_client_portal_request_draft(uuid,uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.read_client_portal_request_draft(uuid,uuid,uuid,uuid)','EXECUTE'),'private recovery is authenticated-only');
SELECT is(pg_temp.private_request()->>'sqlstate','42501','Portal ownership does not manufacture original Work staff standing');
SELECT is((SELECT count(*) FROM public.paige_actions),(SELECT work FROM private_request_before),'refused role intersection files no Work');
-- This pre-existing synthetic owner held this role at suite setup. Restoring it
-- in this rolled-back fixture is not a product grant or provisioning proof.
INSERT INTO public.user_roles(user_id,role)VALUES('e0917000-0000-4000-8000-000000000001','admin') ON CONFLICT DO NOTHING;
SELECT is(pg_temp.private_request(_read=>true)->>'found','false','status reports no matching committed original Work');
SELECT is(pg_temp.private_request(_read=>true)->>'missing_is_rejection','false','missing status never authorizes an automatic new intent');
CREATE TEMP TABLE private_request_result AS SELECT pg_temp.private_request() result;
SELECT is((SELECT result->>'found' FROM private_request_result),'true','actual owner and original Work writer prepare one request');
SELECT is((SELECT result#>>'{request,status}' FROM private_request_result),'assigned','private save advances only to original assigned state');
SELECT is((SELECT result#>>'{request,content_state}' FROM private_request_result),'prepared','saved words have an explicit prepared state');
SELECT is((SELECT result#>>'{request,body}' FROM private_request_result),'Read the shared guide.','result returns exact saved private words');
SELECT is((SELECT result#>>'{request,customer_action_id}' FROM private_request_result),NULL::text,'no customer publication identity is invented');
SELECT ok((SELECT (result#>>'{request,version}')::timestamptz IS NOT NULL FROM private_request_result),'original Work updated_at is the version');
SELECT is((SELECT status FROM public.paige_actions WHERE id=(SELECT (result#>>'{request,work_id}')::uuid FROM private_request_result)),'assigned','original Work row, not a separate draft store, persists');
SELECT is((SELECT assigned_to_user_id::text FROM public.paige_actions WHERE id=(SELECT (result#>>'{request,work_id}')::uuid FROM private_request_result)),
 'e0917000-0000-4000-8000-000000000001','original assignment belongs to the actual originating owner');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE entity_id=(SELECT (result#>>'{request,work_id}')::uuid FROM private_request_result)
 AND user_id='e0917000-0000-4000-8000-000000000001' AND action IN('file_action','advance_action')),2::bigint,'only the original two attributable writer audits are created');
SELECT is(pg_temp.private_request()->>'replayed','true','same intent returns committed history');
SELECT is(pg_temp.private_request()#>>'{request,work_id}',(SELECT result#>>'{request,work_id}' FROM private_request_result),'replay retains original Work identity');
SELECT is(pg_temp.private_request(_body=>'Different words')->>'sqlstate','55000','same intent cannot silently replace its content');
SELECT is(pg_temp.private_request(_title=>'')->>'sqlstate','22023','empty private title refuses');
SELECT is(pg_temp.private_request(_contact=>'e0937000-0000-4000-8000-0000000000ce')->>'sqlstate','42501','foreign CRM relationship refuses');
SELECT is(pg_temp.private_request(_tenant=>'e0927000-0000-4000-8000-000000000002')->>'sqlstate','42501','wrong current business refuses');
SELECT is(pg_temp.private_request(_expected=>'e0917000-0000-4000-8000-000000000002')->>'sqlstate','42501','expected actor is a comparison, not authorization');
SELECT is(pg_temp.private_request(_actor=>'e0917000-0000-4000-8000-000000000005',_expected=>'e0917000-0000-4000-8000-000000000005')->>'sqlstate','42501','global staff role on a plain member is not Portal ownership');
SELECT is(pg_temp.private_request(_actor=>'e0917000-0000-4000-8000-00000000000c',_expected=>'e0917000-0000-4000-8000-00000000000c')->>'sqlstate','42501','a customer cannot prepare owner Work');
SELECT is(pg_temp.private_request(_role=>'anon')->>'sqlstate','42501','anonymous role cannot invoke private preparation');
SELECT is(pg_temp.private_request(_role=>'service_role')->>'sqlstate','42501','service role cannot substitute for owner preparation');
SELECT is(pg_temp.private_request(_read=>true,_role=>'service_role')->>'sqlstate','42501','service role cannot recover private owner content');
SELECT ok((SELECT result::text NOT LIKE '%payload%' AND result::text NOT LIKE '%assigned_subagent_slug%'
 AND result::text NOT LIKE '%linked_user_id%' FROM private_request_result),'closed response omits arbitrary payload, routing and client login');
SELECT ok((SELECT b.actions=(SELECT count(*) FROM public.paige_customer_actions)
 AND b.responses=(SELECT count(*) FROM public.paige_customer_responses)
 AND b.notices=(SELECT count(*) FROM public.notifications)
 AND b.approvals=(SELECT count(*) FROM public.paige_pending_approvals) FROM private_request_before b),'private preparation and retries have no customer or approval effect');
SELECT is((SELECT count(*) FROM public.paige_actions),(SELECT work+1 FROM private_request_before),'all retries and refusals leave exactly one new original Work record');
SELECT ok((SELECT b.consent IS NOT DISTINCT FROM c.paige_shared_context_consent AND c.portal_access_state='paused'
 FROM private_request_before b,public.clients c WHERE c.id='e0937000-0000-4000-8000-0000000000cd'),'private preparation changes neither paused access nor customer consent');
DELETE FROM public.user_roles WHERE user_id='e0917000-0000-4000-8000-000000000001' AND role='admin';
SELECT is(pg_temp.private_request(_read=>true)->>'sqlstate','42501','losing original Work standing invalidates returning private reads');
INSERT INTO public.user_roles(user_id,role)VALUES('e0917000-0000-4000-8000-000000000001','admin') ON CONFLICT DO NOTHING;
UPDATE public.tenant_members SET status='inactive' WHERE user_id='e0917000-0000-4000-8000-000000000001' AND tenant_id='e0927000-0000-4000-8000-000000000001';
SELECT is(pg_temp.private_request(_read=>true)->>'sqlstate','42501','revocation invalidates private status even when a Work identity exists');
UPDATE public.tenant_members SET status='active' WHERE user_id='e0917000-0000-4000-8000-000000000001' AND tenant_id='e0927000-0000-4000-8000-000000000001';
SELECT is(pg_temp.private_request(_read=>true)#>>'{request,work_id}',(SELECT result#>>'{request,work_id}' FROM private_request_result),'returning authorized owner recovers the same original Work after interruption');

-- 19. A returning owner discovers the SAME private Work without a browser nonce.
CREATE FUNCTION pg_temp.private_history(_actor uuid DEFAULT 'e0917000-0000-4000-8000-000000000001',
 _tenant uuid DEFAULT 'e0927000-0000-4000-8000-000000000001',
 _contact uuid DEFAULT 'e0937000-0000-4000-8000-0000000000cd',
 _expected uuid DEFAULT 'e0917000-0000-4000-8000-000000000001',
 _before_time timestamptz DEFAULT NULL,_before_id uuid DEFAULT NULL,_role text DEFAULT 'authenticated')
RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user(_actor,format('SELECT public.list_client_portal_request_drafts(%L,%L,%L,%L,%L)',
  _expected,_tenant,_contact,_before_time,_before_id),_role)
$$;
CREATE TEMP TABLE private_history_before AS SELECT
 (SELECT count(*) FROM public.paige_actions) work,(SELECT count(*) FROM public.audit_logs) audits,
 (SELECT count(*) FROM public.paige_customer_actions) actions,(SELECT count(*) FROM public.notifications) notices;
CREATE TEMP TABLE private_history_read AS SELECT pg_temp.private_history() result;
SELECT ok(has_function_privilege('authenticated','public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.list_client_portal_request_drafts(uuid,uuid,uuid,timestamptz,uuid)','EXECUTE'),'private history is authenticated-only');
SELECT is((SELECT jsonb_array_length(result->'requests') FROM private_history_read),1,'returning owner discovers the original private request');
SELECT is((SELECT result#>>'{requests,0,request,work_id}' FROM private_history_read),(SELECT result#>>'{request,work_id}' FROM private_request_result),'history has the same original Work identity');
SELECT is((SELECT result#>>'{requests,0,intent_id}' FROM private_history_read),'e0959000-0000-4000-8000-000000000010','original intent is recovered from original Work, not a browser registry');
SELECT is((SELECT result#>>'{requests,0,request,version}' FROM private_history_read),(SELECT result#>>'{request,version}' FROM private_request_result),'original private version remains exact');
SELECT is((SELECT result->>'missing_is_rejection' FROM private_history_read),'false','history never turns an empty page into a rejected request');
SELECT is((SELECT result->>'more' FROM private_history_read),'false','single saved request does not invent more history');
SELECT is((SELECT result->'next_cursor' FROM private_history_read),'null'::jsonb,'last page has no replacement cursor');
SELECT ok((SELECT result::text NOT LIKE '%payload%' AND result::text NOT LIKE '%assigned_subagent_slug%'
 AND result::text NOT LIKE '%linked_user_id%' FROM private_history_read),'history exposes no arbitrary Work payload, routing or login identity');
SELECT is(pg_temp.private_history(_expected=>'e0917000-0000-4000-8000-000000000002')->>'sqlstate','42501','history expected actor is a comparison, not authority');
SELECT is(pg_temp.private_history(_tenant=>'e0927000-0000-4000-8000-000000000002')->>'sqlstate','42501','history refuses another current business');
SELECT is(pg_temp.private_history(_contact=>'e0937000-0000-4000-8000-0000000000ce')->>'sqlstate','42501','history refuses another business CRM record');
SELECT is(pg_temp.private_history(_actor=>'e0917000-0000-4000-8000-00000000000c',_expected=>'e0917000-0000-4000-8000-00000000000c')->>'sqlstate','42501','customer cannot list private owner requests');
SELECT is(pg_temp.private_history(_role=>'anon')->>'sqlstate','42501','anonymous history is unavailable');
SELECT is(pg_temp.private_history(_role=>'service_role')->>'sqlstate','42501','service cannot substitute for owner history');
SELECT is(pg_temp.private_history(_before_time=>now())->>'sqlstate','22023','half a keyset cursor refuses');
SELECT is(pg_temp.private_history(_before_time=>'infinity',_before_id=>'e0959000-0000-4000-8000-000000000010')->>'sqlstate','22023','unbounded cursor timestamp refuses');
SELECT ok((SELECT b.work=(SELECT count(*) FROM public.paige_actions) AND b.audits=(SELECT count(*) FROM public.audit_logs)
 AND b.actions=(SELECT count(*) FROM public.paige_customer_actions) AND b.notices=(SELECT count(*) FROM public.notifications)
 FROM private_history_before b),'history and every refusal write no Work, audit, customer action or notice');

-- 20. Approved private Work publication. Actual full-schema roles, common
-- proposal table/RLS, original publisher, access/consent guards and response
-- writer. These trusted proposal fixtures do NOT prove human Chat approval.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0917000-0000-4000-8000-000000000031','authenticated','authenticated','test-e09-share-customer@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0917000-0000-4000-8000-000000000032','authenticated','authenticated','test-e09-share-other@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0937000-0000-4000-8000-0000000000ef','e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000031','e0917000-0000-4000-8000-000000000001','Test','Sharing customer','active'),
 ('e0937000-0000-4000-8000-0000000000ee','e0927000-0000-4000-8000-000000000001','e0917000-0000-4000-8000-000000000032','e0917000-0000-4000-8000-000000000001','Test','Other sharing customer','active');
DO $$ BEGIN PERFORM pg_temp.as_user('e0917000-0000-4000-8000-000000000031',
 $q$SELECT public.client_portal_set_shared_context_consent(true,'e0927000-0000-4000-8000-000000000001')$q$); END $$;
SELECT ok((SELECT paige_shared_context_consent FROM public.clients WHERE id='e0937000-0000-4000-8000-0000000000ef'),'publication fixture uses the real customer-controlled consent writer');
CREATE TEMP TABLE publication_request AS SELECT pg_temp.private_request(
 _contact=>'e0937000-0000-4000-8000-0000000000ef',_intent=>'e0959000-0000-4000-8000-000000000021') result;
SELECT is((SELECT result#>>'{request,content_state}' FROM publication_request),'prepared','current private preparation still works after the ordinary publication fence');
-- Trusted source is an owner read, never approval or a publication writer.
CREATE FUNCTION pg_temp.publication_source(
 _actor uuid DEFAULT 'e0917000-0000-4000-8000-000000000001',_role text DEFAULT 'authenticated',
 _tenant uuid DEFAULT 'e0927000-0000-4000-8000-000000000001',_contact uuid DEFAULT 'e0937000-0000-4000-8000-0000000000ef',_work uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.as_user(_actor,format(
 'SELECT public.read_client_portal_request_share_source(%L,%L,%L,%L)',_actor,_tenant,_contact,
 COALESCE(_work,(SELECT (result#>>'{request,work_id}')::uuid FROM publication_request))),_role) $$;
CREATE FUNCTION pg_temp.publication_source_mutation(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 BEGIN
  EXECUTE _sql;result:=pg_temp.publication_source();
  RAISE EXCEPTION USING ERRCODE='ZX009',MESSAGE='rollback only this synthetic source mutation';
 EXCEPTION WHEN SQLSTATE 'ZX009' THEN NULL; END;
 RETURN result;
END $$;
CREATE TEMP TABLE source_before AS SELECT
 (SELECT count(*) FROM public.paige_customer_actions) actions,(SELECT count(*) FROM public.notifications) notices,
 (SELECT count(*) FROM public.paige_pending_confirmations) proposals;
CREATE TEMP TABLE publication_source AS SELECT pg_temp.publication_source() result;
SELECT ok(has_function_privilege('authenticated','public.read_client_portal_request_share_source(uuid,uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.read_client_portal_request_share_source(uuid,uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.read_client_portal_request_share_source(uuid,uuid,uuid,uuid)','EXECUTE'),'trusted sharing source is Auth-only and requires real owner authority');
SELECT is((SELECT result->'args' FROM publication_source),(SELECT jsonb_build_object('expected_tenant_id',c.tenant_id,'contact_id',c.id,
 'work_id',r.result#>>'{request,work_id}','version',r.result#>>'{request,version}','title',r.result#>>'{request,title}',
 'body',r.result#>>'{request,body}','recipient_user_id',c.linked_user_id,'access_version',c.portal_access_changed_at)
 FROM publication_request r,public.clients c WHERE c.id='e0937000-0000-4000-8000-0000000000ef'),'source arguments come from original Work and current client, retaining exact version and words');
SELECT is((SELECT count(*) FROM publication_source s,jsonb_object_keys(s.result)),9::bigint,'source exposes only its closed native envelope');
SELECT is(pg_temp.publication_source(_tenant=>'e0927000-0000-4000-8000-000000000002')->>'sqlstate','42501','source cannot cross the selected business');
SELECT is(pg_temp.publication_source(_contact=>'e0937000-0000-4000-8000-0000000000ee')->>'sqlstate','55000','source cannot substitute another customer');
SELECT is(pg_temp.publication_source(_work=>'e0959000-0000-4000-8000-000000000099')->>'sqlstate','55000','source cannot substitute another Work');
SELECT is(pg_temp.publication_source(_actor=>'e0917000-0000-4000-8000-000000000031')->>'sqlstate','42501','customer cannot prepare owner publication');
SELECT is(pg_temp.publication_source(_role=>'service_role')->>'sqlstate','42501','service cannot impersonate the source owner');
SELECT is(pg_temp.publication_source(_role=>'anon')->>'sqlstate','42501','anonymous source read refuses');
SELECT ok(pg_temp.publication_source_mutation($q$SELECT pg_temp.access('e0917000-0000-4000-8000-000000000001','e0937000-0000-4000-8000-0000000000ef','pause')$q$)->>'sqlstate' IN ('42501','55000'),'source refuses paused access through the original access writer');
SELECT ok(pg_temp.publication_source_mutation($q$SELECT pg_temp.as_user('e0917000-0000-4000-8000-000000000031','SELECT public.client_portal_set_shared_context_consent(false,''e0927000-0000-4000-8000-000000000001'')')$q$)->>'sqlstate' IN ('42501','55000'),'source refuses consent withdrawn through the original customer writer');
SELECT ok((SELECT b.actions=(SELECT count(*) FROM public.paige_customer_actions) AND b.notices=(SELECT count(*) FROM public.notifications)
 AND b.proposals=(SELECT count(*) FROM public.paige_pending_confirmations) FROM source_before b),'source preparation and refusals create no customer effect or approval');
INSERT INTO public.paige_pending_confirmations(id,user_id,tenant_id,tool_name,fingerprint,args,summary,
 server_issued_at,issued_in_request,consumed_at,claimed_in_request,expires_at)
 SELECT 'e0959000-0000-4000-8000-000000000022','e0917000-0000-4000-8000-000000000001',
 'e0927000-0000-4000-8000-000000000001','client_portal_request_share','0123456789abcdef',
 jsonb_build_object('expected_tenant_id',c.tenant_id,'contact_id',c.id,'work_id',r.result#>>'{request,work_id}',
  'version',r.result#>>'{request,version}','title',r.result#>>'{request,title}','body',r.result#>>'{request,body}',
  'recipient_user_id',c.linked_user_id,'access_version',c.portal_access_changed_at),
 'Share the exact saved request with this customer',clock_timestamp(),
 'e0959000-0000-4000-8000-000000000023',clock_timestamp(),'e0959000-0000-4000-8000-000000000024',clock_timestamp()+interval '5 minutes'
 FROM publication_request r,public.clients c WHERE c.id='e0937000-0000-4000-8000-0000000000ef';
CREATE FUNCTION pg_temp.share_request(
 _actor uuid DEFAULT 'e0917000-0000-4000-8000-000000000001',_role text DEFAULT 'authenticated',
 _tenant uuid DEFAULT 'e0927000-0000-4000-8000-000000000001',
 _confirmation uuid DEFAULT 'e0959000-0000-4000-8000-000000000022',
 _fingerprint text DEFAULT '0123456789abcdef',_claim uuid DEFAULT 'e0959000-0000-4000-8000-000000000024')
 RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.as_user(_actor,format(
 'SELECT public.share_client_portal_request(%L,%L,%L,%L,%L,NULL)',_actor,_tenant,_confirmation,_fingerprint,_claim),_role) $$;
CREATE FUNCTION pg_temp.share_mutation(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 BEGIN
  EXECUTE _sql;result:=pg_temp.share_request();
  RAISE EXCEPTION USING ERRCODE='ZX009',MESSAGE='rollback only this synthetic mutation';
 EXCEPTION WHEN SQLSTATE 'ZX009' THEN NULL; END;
 RETURN result;
END $$;
CREATE TEMP TABLE publication_before AS SELECT
 (SELECT count(*) FROM public.paige_customer_actions) actions,(SELECT count(*) FROM public.notifications) notices,
 (SELECT count(*) FROM public.paige_audit_log) domain_audits,(SELECT count(*) FROM public.audit_logs) work_audits;
SELECT ok(has_function_privilege('authenticated','public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.share_client_portal_request(uuid,uuid,uuid,text,uuid,uuid)','EXECUTE'),'approved publisher requires the original owner JWT, never a service or anonymous surrogate');
SELECT ok(NOT has_table_privilege('authenticated','public.paige_pending_confirmations','INSERT')
 AND NOT has_table_privilege('authenticated','public.paige_pending_confirmations','UPDATE'),'browser cannot manufacture the common trusted approval evidence');
SELECT is(pg_temp.share_request(_actor=>'e0917000-0000-4000-8000-000000000031')->>'sqlstate','42501','customer has no owner publication authority');
SELECT is(pg_temp.share_request(_actor=>'e0917000-0000-4000-8000-000000000005')->>'sqlstate','42501','a plain member with global admin label cannot publish owner Work');
SELECT is(pg_temp.share_request(_tenant=>'e0927000-0000-4000-8000-000000000002')->>'sqlstate','42501','another selected business cannot redeem this customer request');
SELECT is(pg_temp.share_request(_confirmation=>NULL)->>'sqlstate','42501','there is no publication without the original proposal');
SELECT is(pg_temp.share_request(_fingerprint=>'fedcba9876543210')->>'sqlstate','42501','a different stored-call fingerprint refuses');
SELECT is(pg_temp.share_request(_claim=>'e0959000-0000-4000-8000-000000000023')->>'sqlstate','42501','the issuing request cannot redeem its own proposal');
SELECT is(pg_temp.share_request(_role=>'service_role')->>'sqlstate','42501','service cannot assume owner identity to publish');
SELECT is(pg_temp.share_request(_role=>'anon')->>'sqlstate','42501','anonymous publication is unavailable');
SELECT is(pg_temp.share_mutation($q$UPDATE public.paige_pending_confirmations SET consumed_at=NULL WHERE id='e0959000-0000-4000-8000-000000000022'$q$)->>'sqlstate','42501','unclaimed proposal refuses');
SELECT is(pg_temp.share_mutation($q$UPDATE public.paige_pending_confirmations SET server_issued_at=NULL WHERE id='e0959000-0000-4000-8000-000000000022'$q$)->>'sqlstate','42501','legacy or browser-authored proposal refuses');
SELECT is(pg_temp.share_mutation($q$UPDATE public.paige_pending_confirmations SET expires_at=consumed_at+interval '1 microsecond' WHERE id='e0959000-0000-4000-8000-000000000022'$q$)->>'sqlstate','42501','fresh publication cannot execute an expired proposal');
SELECT is(pg_temp.share_mutation($q$UPDATE public.paige_pending_confirmations SET args=jsonb_set(args,'{body}','"Other words"') WHERE id='e0959000-0000-4000-8000-000000000022'$q$)->>'sqlstate','55000','approval cannot replace the original exact customer words');
SELECT is(pg_temp.share_mutation($q$UPDATE public.paige_pending_confirmations SET args=jsonb_set(args,'{version}','"2000-01-01T00:00:00Z"') WHERE id='e0959000-0000-4000-8000-000000000022'$q$)->>'sqlstate','55000','approval cannot use an obsolete original Work version');
SELECT is(pg_temp.share_mutation($q$UPDATE public.paige_pending_confirmations SET args=jsonb_set(args,'{recipient_user_id}','"e0917000-0000-4000-8000-000000000032"') WHERE id='e0959000-0000-4000-8000-000000000022'$q$)->>'sqlstate','42501','approval cannot silently target a replacement login');
SELECT is(pg_temp.share_mutation($q$UPDATE public.paige_pending_confirmations SET args=args||'{"payload":{"private":true}}' WHERE id='e0959000-0000-4000-8000-000000000022'$q$)->>'sqlstate','42501','arbitrary internal payload is not an approved publishing argument');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',format(
 'SELECT public.advance_action(p_action_id=>%L,p_to_status=>%L)',(SELECT result#>>'{request,work_id}' FROM publication_request),'drafted'))->>'sqlstate',
 '42501','ordinary drafted entry refuses the private-publication kind before effects');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000001',format(
 'SELECT public.advance_action(p_action_id=>%L,p_to_status=>%L)',(SELECT result#>>'{request,work_id}' FROM publication_request),'executing'))->>'sqlstate',
 '42501','ordinary executing entry refuses the private-publication kind before effects');
SELECT ok((SELECT b.actions=(SELECT count(*) FROM public.paige_customer_actions) AND b.notices=(SELECT count(*) FROM public.notifications)
 AND b.domain_audits=(SELECT count(*) FROM public.paige_audit_log) AND b.work_audits=(SELECT count(*) FROM public.audit_logs)
 FROM publication_before b),'all publication refusals leave original customer records, notices and audits unchanged');
SELECT is(pg_temp.share_mutation($q$UPDATE public.paige_pending_confirmations SET scoped_client_id='e0937000-0000-4000-8000-0000000000ee' WHERE id='e0959000-0000-4000-8000-000000000022'$q$)->>'sqlstate',
 '42501','owner approval with another selected CRM focus refuses');
UPDATE public.paige_pending_confirmations SET scoped_client_id='e0937000-0000-4000-8000-0000000000ef'
 WHERE id='e0959000-0000-4000-8000-000000000022';
CREATE TEMP TABLE publication_result AS SELECT pg_temp.share_request() result;
SELECT is((SELECT result->>'status' FROM publication_result),'shared','exact approved native publication reaches the real customer record');
SELECT is((SELECT result->>'work_id' FROM publication_result),(SELECT result#>>'{request,work_id}' FROM publication_request),'publication keeps the original private Work identity');
SELECT is((SELECT payload_json FROM public.paige_customer_actions WHERE id=(SELECT (result->>'customer_action_id')::uuid FROM publication_result)),
 '{}'::jsonb,'customer action receives no private intent, approval or internal Work metadata');
SELECT is((SELECT action_type FROM public.paige_customer_actions WHERE id=(SELECT (result->>'customer_action_id')::uuid FROM publication_result)),
 'recommendation','original publisher gets its real action type, never the dotted Work kind');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='e0917000-0000-4000-8000-000000000031'
 AND metadata->>'action_id'=(SELECT result->>'customer_action_id' FROM publication_result)),1::bigint,'original publisher notifies the exact joined customer once');
SELECT is(pg_temp.share_request()->>'replayed','true','returning same claim reconciles the original result');
SELECT is(pg_temp.share_request()->>'customer_action_id',(SELECT result->>'customer_action_id' FROM publication_result),'retry never creates a replacement customer action');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000032',format(
 'SELECT jsonb_build_object(''count'',count(*)) FROM public.paige_customer_actions WHERE id=%L',
 (SELECT result->>'customer_action_id' FROM publication_result)))->>'count','0','another real customer role cannot read this action through RLS');
SELECT is(pg_temp.as_user('e0917000-0000-4000-8000-000000000031',format(
 'SELECT public.customer_respond_to_action(%L,''completed'',NULL,%L)',a.id,a.updated_at))->>'ok','true',
 'the actual client completes the same published action through the original versioned writer')
 FROM public.paige_customer_actions a WHERE a.id=(SELECT (result->>'customer_action_id')::uuid FROM publication_result);
SELECT is((SELECT result->>'client_response' FROM public.paige_actions WHERE id=(SELECT (result->>'work_id')::uuid FROM publication_result)),
 'completed','customer completion returns to the same original Work record');
SELECT is(pg_temp.owner_actions(_contact=>'e0937000-0000-4000-8000-0000000000ef')#>>'{actions,0,responses,0,response_type}',
 'completed','owner returning projection sees the same canonical customer response');
SELECT is(pg_temp.share_request()->>'replayed','true','publication retry after customer response is still historical, never another send');
SELECT is((SELECT count(*) FROM public.paige_customer_responses WHERE action_id=(SELECT (result->>'customer_action_id')::uuid FROM publication_result)),
 1::bigint,'one customer response survives publication reconciliation');
CREATE TEMP TABLE historical_publication_source AS SELECT pg_temp.publication_source() result;
SELECT is((SELECT result->>'source_state' FROM historical_publication_source),'shared','returning owner source recognizes actual already-shared Work');
SELECT is((SELECT result->>'customer_action_id' FROM historical_publication_source),(SELECT result->>'customer_action_id' FROM publication_result),'returning source preserves the original customer action identity');
SELECT is((SELECT result->'args' FROM historical_publication_source),'null'::jsonb,'historical source cannot create a replacement approval from old words');
SELECT is((SELECT count(*) FROM public.paige_customer_actions WHERE id=(SELECT (result->>'customer_action_id')::uuid FROM publication_result)),1::bigint,'historical source does not create another customer action');

SELECT * FROM finish();
ROLLBACK;
