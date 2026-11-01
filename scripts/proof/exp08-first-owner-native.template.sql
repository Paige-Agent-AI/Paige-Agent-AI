-- Original I2 first-owner history/invitation composition, full replayed schema.
-- Synthetic records in ONE rollback only; no email, customer account or Auth SDK proof.
BEGIN;
SELECT plan(32);
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at) VALUES
 ('e8c00000-0000-4000-8000-000000000001','authenticated','authenticated','e8-history-operator@tests.invalid',now()),
 ('e8c00000-0000-4000-8000-000000000002','authenticated','authenticated','e8-history-former@tests.invalid',now()),
 ('e8c00000-0000-4000-8000-000000000003','authenticated','authenticated','e8-history-first@tests.invalid',now()),
 ('e8c00000-0000-4000-8000-000000000004','authenticated','authenticated','e8-history-other@tests.invalid',now());
INSERT INTO public.user_roles(user_id,role) VALUES('e8c00000-0000-4000-8000-000000000001','super_admin') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles(user_id) VALUES
 ('e8c00000-0000-4000-8000-000000000001'),('e8c00000-0000-4000-8000-000000000002'),
 ('e8c00000-0000-4000-8000-000000000003'),('e8c00000-0000-4000-8000-000000000004') ON CONFLICT(user_id) DO NOTHING;
INSERT INTO public.tenants(id,slug,name,account_type,created_at) VALUES
 ('e8c00000-0000-4000-8000-000000000010','test-e8-history-a','History native A','standalone','2020-01-01Z'),
 ('e8c00000-0000-4000-8000-000000000011','test-e8-history-b','History native B','standalone','2020-01-01Z'),
 ('e8c00000-0000-4000-8000-000000000012','test-e8-history-c','History native C','standalone','2020-01-01Z'),
 ('e8c00000-0000-4000-8000-000000000013','test-e8-history-d','History native D','standalone','2020-01-01Z');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('e8c00000-0000-4000-8000-000000000010','e8c00000-0000-4000-8000-000000000002','owner','active',true);
INSERT INTO public.paige_audit_log(actor_user_id,actor_role,action,target_type,target_id,tenant_id,payload,created_at) VALUES
 ('e8c00000-0000-4000-8000-000000000001','super_admin','tenant:grant_co_owner','user','e8c00000-0000-4000-8000-000000000002','e8c00000-0000-4000-8000-000000000012','{}','2022-01-01Z'),
 ('e8c00000-0000-4000-8000-000000000001','super_admin','tenant:deleted_injected_owner','user','e8c00000-0000-4000-8000-000000000002','e8c00000-0000-4000-8000-000000000013','{}','2019-01-01Z');
CREATE TEMP TABLE exp08_history_tokens(label text PRIMARY KEY,token text NOT NULL);
GRANT SELECT,INSERT ON exp08_history_tokens TO authenticated;
CREATE TEMP TABLE exp08_history_writer_metadata AS SELECT oid,to_jsonb(p)-'prosrc' AS metadata FROM pg_proc p
 WHERE oid=ANY(ARRAY[to_regprocedure('public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text)'),to_regprocedure('public.accept_tenant_invite(text)')]);
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.create_tenant_invite_token(uuid,text,public.tenant_role,integer,integer,uuid,text)'::regprocedure),
 'a42d7b2852daf7dcd3e108f0eb588679','actual original mint matches the guarded source prerequisite');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.accept_tenant_invite(text)'::regprocedure),
 '0194a076acce065d23de842cab9b6d29','actual original accept preserves the current original customer/recipient branches');
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO exp08_history_tokens SELECT 'historical',
 (public.create_tenant_invite_token('e8c00000-0000-4000-8000-000000000010','subaccount_owner','admin',7,1,NULL,'e8-history-first@tests.invalid')).token;
SELECT ok(EXISTS(SELECT 1 FROM exp08_history_tokens WHERE label='historical'),
 'before the candidate the actual original platform door can mint on an already-owned business');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
-- Existing inert original candidates only; every DDL and fixture change rolls back.
\ir ../../scripts/proof/exp08-first-owner-history-patch.sql
\ir ../../scripts/proof/exp08-first-owner-invitation-patch.sql
SELECT ok((SELECT first_owner_seated_at IS NOT NULL FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000010'),
 'existing owner-seat evidence backfills original ownership history');
SELECT is(public._tenant_never_owned('e8c00000-0000-4000-8000-000000000010'),false,'an existing seat never becomes first-owner admission');
SELECT is(public._tenant_never_owned('e8c00000-0000-4000-8000-000000000011'),true,'a genuinely new shell retains first-owner admission');
SELECT is((SELECT first_owner_seated_at FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000012'),
 TIMESTAMPTZ '2022-01-01Z','original qualifying audit backfills its actual historical instant');
SELECT is(public._tenant_never_owned('e8c00000-0000-4000-8000-000000000013'),true,'injected parent-owner correction is excluded from own-business history');
SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_history_writer_metadata b JOIN pg_proc p ON p.oid=b.oid WHERE (to_jsonb(p)-'prosrc') IS DISTINCT FROM b.metadata),
 'both original writer OIDs and complete non-body metadata are conserved');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=ANY(ARRAY[
 to_regprocedure('public._tenant_never_owned(uuid)'),to_regprocedure('public._tenant_first_owner_history()'),to_regprocedure('public._tenant_first_owner_history_guard()')])
 AND (has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'))),
 'new original history helpers have no direct client or service execution');
CREATE TEMP TABLE exp08_history_stamp AS SELECT first_owner_seated_at AS stamp FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000010';
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public._tenant_never_owned('e8c00000-0000-4000-8000-000000000011')$$,
 '42501','permission denied for function _tenant_never_owned','browser callers cannot invoke the private history authority');
SELECT lives_ok($$SELECT public.revoke_platform_access('e8c00000-0000-4000-8000-000000000002'::uuid,NULL::text)$$,
 'R16 original platform access revocation remains executable without a new owner-floor restriction');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id='e8c00000-0000-4000-8000-000000000002')
 AND (SELECT owner_user_id IS NULL FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000010'),
 'canonical revocation removes the original seat while the shell still has no holder pointer');
SELECT is((SELECT first_owner_seated_at FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000010'),
 (SELECT stamp FROM exp08_history_stamp),'original history survives the last seat departure unchanged');
SELECT is(public._tenant_never_owned('e8c00000-0000-4000-8000-000000000010'),false,'empty pointer and roster cannot erase prior ownership');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.create_tenant_invite_token('e8c00000-0000-4000-8000-000000000010','subaccount_owner','admin',7,1,NULL,'e8-history-first@tests.invalid')$$,
 '42501','History native A has had an owner, so a new owner can only be added by its account holder or through owner recovery. Nothing changed.',
 'new platform first-owner mint refuses the now-empty historically owned business');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_tenant_invite((SELECT token FROM exp08_history_tokens WHERE label='historical'))$$,
 '42501','This invitation can''t be used. Owners of History native A are added by its account holder. Ask them for a new invitation.',
 'a token minted before the repair cannot re-establish historical ownership');
RESET ROLE;
SELECT ok(NOT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id='e8c00000-0000-4000-8000-000000000010')
 AND (SELECT uses=0 FROM public.tenant_invite_tokens WHERE token=(SELECT token FROM exp08_history_tokens WHERE label='historical')),
 'refused historical acceptance creates no downgraded seat or consumed token');
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO exp08_history_tokens SELECT 'first',
 (public.create_tenant_invite_token('e8c00000-0000-4000-8000-000000000011','subaccount_owner','admin',7,1,NULL,'e8-history-first@tests.invalid')).token;
SELECT ok(EXISTS(SELECT 1 FROM exp08_history_tokens WHERE label='first'),'genuinely new shell invitation uses the original native mint');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000004',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000004","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_tenant_invite((SELECT token FROM exp08_history_tokens WHERE label='first'))$$,
 'P0001','This invite was sent to a different email address. Accept it while signed in as e8-history-first@tests.invalid',
 'original intended-recipient refusal is preserved');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is(public.accept_tenant_invite((SELECT token FROM exp08_history_tokens WHERE label='first')),
 'e8c00000-0000-4000-8000-000000000011'::uuid,'the original native accept establishes the genuinely first owner');
RESET ROLE;
SELECT ok(EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id='e8c00000-0000-4000-8000-000000000011'
 AND user_id='e8c00000-0000-4000-8000-000000000003' AND is_owner AND role='owner' AND status='active')
 AND (SELECT owner_user_id='e8c00000-0000-4000-8000-000000000003'::uuid FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000011'),
 'native seat and holder pointer reflect the same intended user');
SELECT ok(EXISTS(SELECT 1 FROM public.profiles WHERE user_id='e8c00000-0000-4000-8000-000000000003' AND active_tenant_id='e8c00000-0000-4000-8000-000000000011'),
 'original acceptance lands the intended user in the invited workspace');
SELECT is((SELECT uses FROM public.tenant_invite_tokens WHERE token=(SELECT token FROM exp08_history_tokens WHERE label='first')),1,
 'original acceptance consumes its one-use token once');
SELECT ok((SELECT first_owner_seated_at IS NOT NULL FROM public.tenants WHERE id='e8c00000-0000-4000-8000-000000000011'),
 'original membership writer records the first-owner instant through the native trigger');
SELECT is(public._tenant_never_owned('e8c00000-0000-4000-8000-000000000011'),false,'successful first ownership permanently closes first-owner admission');
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.create_tenant_invite_token('e8c00000-0000-4000-8000-000000000011','subaccount_owner','admin',7,1,NULL,'e8-history-other@tests.invalid')$$,
 '42501','History native B has had an owner, so a new owner can only be added by its account holder or through owner recovery. Nothing changed.',
 'a subsequent platform first-owner invitation cannot add another owner');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','e8c00000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"e8c00000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.accept_tenant_invite((SELECT token FROM exp08_history_tokens WHERE label='first'))$$,
 'P0001','invite has reached its usage limit','original used-token refusal prevents another acceptance');
SELECT throws_ok($$UPDATE public.tenants SET first_owner_seated_at=NULL WHERE id='e8c00000-0000-4000-8000-000000000011'$$,
 '42501','The first owner history cannot be changed.','the first owner cannot erase the native historical boundary');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
CREATE TEMP TABLE exp08_history_before_replay AS SELECT jsonb_build_object(
 'tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenants t WHERE id IN('e8c00000-0000-4000-8000-000000000010','e8c00000-0000-4000-8000-000000000011','e8c00000-0000-4000-8000-000000000012','e8c00000-0000-4000-8000-000000000013')),
 'tokens',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenant_invite_tokens t WHERE token IN(SELECT token FROM exp08_history_tokens))) AS snapshot;
CREATE TEMP TABLE exp08_history_trigger_before_replay AS SELECT jsonb_agg(to_jsonb(t) ORDER BY tgname) AS snapshot FROM pg_trigger t WHERE tgname IN ('trg_tenant_first_owner_history','trg_tenant_first_owner_history_immutable');
\ir ../../scripts/proof/exp08-first-owner-history-patch.sql
\ir ../../scripts/proof/exp08-first-owner-invitation-patch.sql
SELECT is(jsonb_build_object(
 'tenants',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenants t WHERE id IN('e8c00000-0000-4000-8000-000000000010','e8c00000-0000-4000-8000-000000000011','e8c00000-0000-4000-8000-000000000012','e8c00000-0000-4000-8000-000000000013')),
 'tokens',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenant_invite_tokens t WHERE token IN(SELECT token FROM exp08_history_tokens))),
 (SELECT snapshot FROM exp08_history_before_replay),'exact candidate replay changes no original tenant/token data');
SELECT ok(NOT EXISTS(SELECT 1 FROM exp08_history_writer_metadata b JOIN pg_proc p ON p.oid=b.oid WHERE (to_jsonb(p)-'prosrc') IS DISTINCT FROM b.metadata),
 'replay retains the complete original writer metadata');
SELECT is((SELECT jsonb_agg(to_jsonb(t) ORDER BY tgname) FROM pg_trigger t WHERE tgname IN ('trg_tenant_first_owner_history','trg_tenant_first_owner_history_immutable')),
 (SELECT snapshot FROM exp08_history_trigger_before_replay),'exact replay preserves complete native trigger objects and metadata');
SELECT * FROM finish();
ROLLBACK;
