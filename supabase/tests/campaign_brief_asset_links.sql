-- ISOLATED full production-schema-only clone only; never execute on production.
-- INT-298 / INT-342 MBC slice 3a: campaign ↔ asset links through the real writer and read.
-- Real auth users, JWT identity, membership triggers and scope helpers. No auth helper replacement.
BEGIN;
SET LOCAL timezone='UTC';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.require_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.require_denied(command text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
RAISE EXCEPTION 'FAIL: %',label; END $$;
-- Expects the named refusal (SQLSTATE 22023 with this message).
CREATE FUNCTION pg_temp.require_refused(command text,reason text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM<>reason THEN RAISE EXCEPTION 'FAIL: % (refused with %, expected %)',label,SQLERRM,reason; END IF; RETURN; END;
RAISE EXCEPTION 'FAIL: %',label; END $$;
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',uid,true),set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true) $$;
CREATE FUNCTION pg_temp.attach(brief text,kind text,asset text,key text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.configure_campaign_brief_assets(NULL,jsonb_build_object('type','attach_asset','briefId',brief,'assetKind',kind,'assetId',asset),key,'human') $$;

INSERT INTO auth.users(id,email) VALUES
 ('a2980300-0000-4000-8000-000000000001','links-admin@example.invalid'),
 ('a2980300-0000-4000-8000-000000000002','links-member@example.invalid');
DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous'; END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'a2980300-0000-4000-8000-000000000004';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'links-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
 IF public.is_platform_owner() IS DISTINCT FROM true THEN RAISE EXCEPTION 'FIXTURE: canonical owner guard unavailable'; END IF;
END $fixture_owner$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('a2980300-0000-4000-8000-000000000011','links-proof-a','Links proof A','active','standalone','LPA','{"system_workspace":true}'),
 ('a2980300-0000-4000-8000-000000000012','links-proof-b','Links proof B','active','standalone','LPB','{"system_workspace":true}');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('a2980300-0000-4000-8000-000000000011','a2980300-0000-4000-8000-000000000001','admin','active',false),
 ('a2980300-0000-4000-8000-000000000011','a2980300-0000-4000-8000-000000000002','member','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('a2980300-0000-4000-8000-000000000001','a2980300-0000-4000-8000-000000000011'),
 ('a2980300-0000-4000-8000-000000000002','a2980300-0000-4000-8000-000000000011')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;

-- Assets, written directly by the server role. Tenant B owns one page and one brief.
INSERT INTO public.growth_pages(id,tenant_id,slug,title,status) VALUES
 ('a2980300-0000-4000-8000-0000000000a1','a2980300-0000-4000-8000-000000000011','spring-landing','Spring landing','draft'),
 ('a2980300-0000-4000-8000-0000000000a2','a2980300-0000-4000-8000-000000000011','old-landing','Old landing','archived'),
 ('a2980300-0000-4000-8000-0000000000b1','a2980300-0000-4000-8000-000000000012','other-landing','Other workspace page','draft');
INSERT INTO public.growth_forms(id,tenant_id,slug,name,status) VALUES
 ('a2980300-0000-4000-8000-0000000000a3','a2980300-0000-4000-8000-000000000011','spring-form','Spring intake form','active');
INSERT INTO public.growth_funnels(id,tenant_id,slug,name,status) VALUES
 ('a2980300-0000-4000-8000-0000000000a4','a2980300-0000-4000-8000-000000000011','spring-funnel','Spring funnel','draft');
INSERT INTO public.email_campaigns(id,tenant_id,name,status) VALUES
 ('a2980300-0000-4000-8000-0000000000a5','a2980300-0000-4000-8000-000000000011','Spring announcement','draft');
INSERT INTO public.email_sequences(id,tenant_id,name,status) VALUES
 ('a2980300-0000-4000-8000-0000000000a6','a2980300-0000-4000-8000-000000000011','Spring nurture','draft');
-- A series' own step email: part of the series, never offered or linked as a campaign on its own.
INSERT INTO public.email_campaigns(id,tenant_id,name,status,sequence_id,sequence_position) VALUES
 ('a2980300-0000-4000-8000-0000000000a9','a2980300-0000-4000-8000-000000000011','Spring nurture · email 1','draft','a2980300-0000-4000-8000-0000000000a6',1);
INSERT INTO public.marketing_content(id,tenant_id,title,channel,status) VALUES
 ('a2980300-0000-4000-8000-0000000000a7','a2980300-0000-4000-8000-000000000011','Spring ad copy','ad_copy','draft');
INSERT INTO public.campaign_briefs(id,tenant_id,short_ref,name,lifecycle_status) VALUES
 ('a2980300-0000-4000-8000-0000000000c1','a2980300-0000-4000-8000-000000000011','CB-LINKS1','Spring intake','draft'),
 ('a2980300-0000-4000-8000-0000000000c2','a2980300-0000-4000-8000-000000000011','CB-LINKS2','Winter wrap-up','archived'),
 ('a2980300-0000-4000-8000-0000000000c3','a2980300-0000-4000-8000-000000000012','CB-LINKSB','Other workspace brief','draft');
-- A social post names its brief itself; the read shows it alongside the links.
INSERT INTO public.paige_social_posts(id,tenant_id,title,status,campaign_brief_id) VALUES
 ('a2980300-0000-4000-8000-0000000000a8','a2980300-0000-4000-8000-000000000011','Spring teaser post','draft','a2980300-0000-4000-8000-0000000000c1');

-- The links table is registered with account retirement, as the briefs it belongs to are.
SELECT pg_temp.require_true(public.operator_retirement_disposition('campaign_brief_asset_links')='delete','links retire with the account');
SELECT pg_temp.require_true(public.operator_retirement_disposition('campaign_briefs')='delete','existing retirement entries are kept');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2980300-0000-4000-8000-000000000001');
-- An admin attaches one of each kind.
DO $attach$ DECLARE r jsonb; k text; a text; n int:=0; BEGIN
 FOR k,a IN SELECT * FROM (VALUES ('page','a2980300-0000-4000-8000-0000000000a1'),('form','a2980300-0000-4000-8000-0000000000a3'),
   ('funnel','a2980300-0000-4000-8000-0000000000a4'),('email_campaign','a2980300-0000-4000-8000-0000000000a5'),
   ('email_series','a2980300-0000-4000-8000-0000000000a6'),('content','a2980300-0000-4000-8000-0000000000a7')) v(k,a) LOOP
   n:=n+1;
   r:=pg_temp.attach('a2980300-0000-4000-8000-0000000000c1',k,a,'links-attach-'||n);
   IF r->>'outcome'<>'attached' OR (r->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: attach % returned %',k,r; END IF;
 END LOOP;
END $attach$;
-- Attaching again under a new key says so; a replayed key returns its first answer; a reused key with another command is refused.
SELECT pg_temp.require_true(pg_temp.attach('a2980300-0000-4000-8000-0000000000c1','page','a2980300-0000-4000-8000-0000000000a1','links-again')->>'outcome'='already_attached','attaching twice is reported, not duplicated');
SELECT pg_temp.require_true(pg_temp.attach('a2980300-0000-4000-8000-0000000000c1','page','a2980300-0000-4000-8000-0000000000a1','links-attach-1')->>'outcome'='attached','a replayed key returns its recorded answer');
SELECT pg_temp.require_refused($$SELECT pg_temp.attach('a2980300-0000-4000-8000-0000000000c1','form','a2980300-0000-4000-8000-0000000000a3','links-attach-1')$$,'CAMPAIGN_BRIEF_IDEMPOTENCY_CONFLICT','a reused key with another command is refused');
-- Nothing outside the caller's workspace, archived, or malformed is ever linked.
SELECT pg_temp.require_refused($$SELECT pg_temp.attach('a2980300-0000-4000-8000-0000000000c1','page','a2980300-0000-4000-8000-0000000000b1','links-x1')$$,'CAMPAIGN_ASSET_NOT_FOUND','another workspace''s page is refused');
SELECT pg_temp.require_refused($$SELECT pg_temp.attach('a2980300-0000-4000-8000-0000000000c3','page','a2980300-0000-4000-8000-0000000000a1','links-x2')$$,'CAMPAIGN_BRIEF_NOT_FOUND','another workspace''s brief is refused');
SELECT pg_temp.require_refused($$SELECT pg_temp.attach('a2980300-0000-4000-8000-0000000000c2','page','a2980300-0000-4000-8000-0000000000a1','links-x3')$$,'CAMPAIGN_BRIEF_NOT_FOUND','an archived brief is refused');
SELECT pg_temp.require_refused($$SELECT pg_temp.attach('a2980300-0000-4000-8000-0000000000c1','page','a2980300-0000-4000-8000-0000000000a2','links-x4')$$,'CAMPAIGN_ASSET_NOT_FOUND','an archived page is refused');
SELECT pg_temp.require_refused($$SELECT pg_temp.attach('a2980300-0000-4000-8000-0000000000c1','page','a2980300-0000-4000-8000-0000000000a3','links-x5')$$,'CAMPAIGN_ASSET_NOT_FOUND','a form named as a page is refused');
SELECT pg_temp.require_refused($$SELECT pg_temp.attach('a2980300-0000-4000-8000-0000000000c1','email_campaign','a2980300-0000-4000-8000-0000000000a9','links-x8')$$,'CAMPAIGN_ASSET_NOT_FOUND','a series step email is not a campaign on its own');
SELECT pg_temp.require_refused($$SELECT pg_temp.attach('a2980300-0000-4000-8000-0000000000c1','video','a2980300-0000-4000-8000-0000000000a1','links-x6')$$,'CAMPAIGN_ASSET_KIND_INVALID','an unknown kind is refused');
SELECT pg_temp.require_refused($$SELECT pg_temp.attach('a2980300-0000-4000-8000-0000000000c1','page','not-a-uuid','links-x7')$$,'CAMPAIGN_ASSET_ARGUMENTS_INVALID','a malformed id is refused');
SELECT pg_temp.require_refused($$SELECT public.configure_campaign_brief_assets(NULL,'{"type":"attach_asset","briefId":"a2980300-0000-4000-8000-0000000000c1","assetKind":"page","assetId":"a2980300-0000-4000-8000-0000000000a1"}','  ','human')$$,'CAMPAIGN_BRIEF_IDEMPOTENCY_REQUIRED','a key is required');
-- The tenant argument never widens access, and the table takes no direct writes.
SELECT pg_temp.require_denied($$SELECT public.configure_campaign_brief_assets('a2980300-0000-4000-8000-000000000012','{"type":"attach_asset","briefId":"a2980300-0000-4000-8000-0000000000c3","assetKind":"page","assetId":"a2980300-0000-4000-8000-0000000000b1"}','links-spoof','human')$$,'another workspace named as the tenant is refused');
SELECT pg_temp.require_denied($$SELECT public.get_campaign_brief_assets('a2980300-0000-4000-8000-000000000012')$$,'another workspace''s links are not readable');
SELECT pg_temp.require_denied($$INSERT INTO public.campaign_brief_asset_links(tenant_id,brief_id,asset_kind,asset_id,created_through) VALUES ('a2980300-0000-4000-8000-000000000011','a2980300-0000-4000-8000-0000000000c1','page','a2980300-0000-4000-8000-0000000000a1','human')$$,'no direct insert');
SELECT pg_temp.require_denied($$DELETE FROM public.campaign_brief_asset_links$$,'no direct delete');

-- The admin reads every link by name, the social post beside them, and what could be attached.
DO $admin_read$ DECLARE r jsonb:=public.get_campaign_brief_assets(NULL); BEGIN
 IF (r->>'can_manage')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: admin can manage'; END IF;
 IF jsonb_array_length(r->'links')<>7 THEN RAISE EXCEPTION 'FAIL: admin sees six links and the social post, got %',r->'links'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'links') l WHERE l->>'name' IS NULL) THEN RAISE EXCEPTION 'FAIL: admin sees every name'; END IF;
 IF (SELECT l->>'name' FROM jsonb_array_elements(r->'links') l WHERE l->>'kind'='email_campaign')<>'Spring announcement' THEN RAISE EXCEPTION 'FAIL: email name for admin'; END IF;
 IF (SELECT (l->>'detachable')::boolean FROM jsonb_array_elements(r->'links') l WHERE l->>'kind'='social_post') THEN RAISE EXCEPTION 'FAIL: a social post is detached through Social, not here'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'available') x WHERE x->>'id'='a2980300-0000-4000-8000-0000000000a1')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'available') x WHERE x->>'id' IN ('a2980300-0000-4000-8000-0000000000b1','a2980300-0000-4000-8000-0000000000a2','a2980300-0000-4000-8000-0000000000a9')) THEN
   RAISE EXCEPTION 'FAIL: available lists this workspace''s live assets only, got %',r->'available'; END IF;
 IF jsonb_array_length(public.get_campaign_brief_assets(NULL,'a2980300-0000-4000-8000-0000000000c2')->'links')<>0 THEN RAISE EXCEPTION 'FAIL: an archived brief shows no links'; END IF;
END $admin_read$;

-- A member reads what members may read, by name; email and library links by kind only; nothing to attach; no writes.
SELECT pg_temp.as_user('a2980300-0000-4000-8000-000000000002');
DO $member_read$ DECLARE r jsonb:=public.get_campaign_brief_assets(NULL); BEGIN
 IF (r->>'can_manage')::boolean OR jsonb_array_length(r->'available')<>0 THEN RAISE EXCEPTION 'FAIL: a member manages nothing'; END IF;
 IF jsonb_array_length(r->'links')<>7 THEN RAISE EXCEPTION 'FAIL: a member sees that each link exists'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'links') l WHERE l->>'kind' IN ('email_campaign','email_series','content') AND (l->>'name' IS NOT NULL OR l->>'status' IS NOT NULL OR l->>'channel' IS NOT NULL))
   THEN RAISE EXCEPTION 'FAIL: a member never reads email or library names, got %',r->'links'; END IF;
 IF (SELECT l->>'name' FROM jsonb_array_elements(r->'links') l WHERE l->>'kind'='page')<>'Spring landing' THEN RAISE EXCEPTION 'FAIL: a member reads page names'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'links') l WHERE (l->>'detachable')::boolean) THEN RAISE EXCEPTION 'FAIL: nothing is detachable for a member'; END IF;
END $member_read$;
SELECT pg_temp.require_denied($$SELECT pg_temp.attach('a2980300-0000-4000-8000-0000000000c1','page','a2980300-0000-4000-8000-0000000000a1','links-member')$$,'a member cannot attach');

-- Detaching removes the link, not the piece; detaching again says so.
SELECT pg_temp.as_user('a2980300-0000-4000-8000-000000000001');
SELECT pg_temp.require_true(public.configure_campaign_brief_assets(NULL,'{"type":"detach_asset","briefId":"a2980300-0000-4000-8000-0000000000c1","assetKind":"form","assetId":"a2980300-0000-4000-8000-0000000000a3"}','links-detach-1','human')->>'outcome'='detached','detach removes the link');
SELECT pg_temp.require_true(public.configure_campaign_brief_assets(NULL,'{"type":"detach_asset","briefId":"a2980300-0000-4000-8000-0000000000c1","assetKind":"form","assetId":"a2980300-0000-4000-8000-0000000000a3"}','links-detach-2','human')->>'outcome'='not_attached','detaching twice is reported');
RESET ROLE;
SELECT pg_temp.require_true(EXISTS(SELECT 1 FROM public.growth_forms WHERE id='a2980300-0000-4000-8000-0000000000a3'),'the form itself is untouched');
SELECT pg_temp.require_true((SELECT count(*) FROM public.audit_logs WHERE action='campaign_brief.assets' AND entity_id='a2980300-0000-4000-8000-0000000000c1')=9,'each new command is audited once (six attaches, one repeat, two detaches; the replay is not)');
SELECT pg_temp.require_true((SELECT count(*) FROM public.campaign_brief_command_results WHERE tenant_id='a2980300-0000-4000-8000-000000000011' AND idempotency_key LIKE 'links-%')=9,'each new command is recorded in the brief ledger');

-- Integrity holds for the server role too, and links never change in place.
SELECT pg_temp.require_refused($$INSERT INTO public.campaign_brief_asset_links(tenant_id,brief_id,asset_kind,asset_id,created_through) VALUES ('a2980300-0000-4000-8000-000000000011','a2980300-0000-4000-8000-0000000000c1','page','a2980300-0000-4000-8000-0000000000b1','human')$$,'CAMPAIGN_ASSET_NOT_FOUND','the guard refuses a foreign asset for any writer');
SELECT pg_temp.require_denied($$UPDATE public.campaign_brief_asset_links SET asset_kind='form'$$,'links are immutable');

-- An asset deleted later drops out of the read; its brief's other links stay.
DELETE FROM public.growth_funnels WHERE id='a2980300-0000-4000-8000-0000000000a4';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user('a2980300-0000-4000-8000-000000000001');
SELECT pg_temp.require_true(jsonb_array_length(public.get_campaign_brief_assets(NULL,'a2980300-0000-4000-8000-0000000000c1')->'links')=5,'a deleted funnel drops out (page, campaign, series, content, social post remain)');
RESET ROLE;
ROLLBACK;
