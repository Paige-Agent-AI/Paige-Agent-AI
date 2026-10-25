-- ISOLATED full production-schema-only clone only; never execute on production.
-- EXP06 (ANT-162) resumption verification item 3 + item 5 legs: the door's stored publish call and
-- the anonymous public read are ONE contract — what the workspace owner approved is byte-for-byte
-- what a visitor receives, an unpublish removes it from the public read, a restored earlier version
-- republishes as the visitor's version, a draft never leaks, a placeholder page refuses to publish,
-- and a person without workspace authority cannot drive the stored call.
-- Real migrations' schema and functions; synthetic fixture data only (§63).
BEGIN;
SET LOCAL timezone='UTC';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.require_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.require_error(command text,reason text,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
  IF position(reason in SQLERRM)=0 THEN RAISE EXCEPTION 'FAIL: % (refused with %, expected %)',label,SQLERRM,reason; END IF; RETURN; END;
RAISE EXCEPTION 'FAIL: % (was allowed)',label; END $$;
-- The anonymous visitor: RLS applies the growth_pages_public_read_published policy.
CREATE FUNCTION pg_temp.anon_pages(tenant_slug text,page_slug text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('status',p.status,'blocks',p.blocks_json,'seo',p.seo_json) ORDER BY p.slug),'[]'::jsonb)
    FROM public.growth_pages p JOIN public.tenants t ON t.id=p.tenant_id
   WHERE lower(t.slug)=lower(tenant_slug) AND p.slug=page_slug $$;
CREATE FUNCTION pg_temp.as_anon() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims','{"role":"anon"}',true), set_config('request.jwt.claim.sub','',true) $$;
CREATE FUNCTION pg_temp.as_server() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true) $$;

DO $fixture$ DECLARE owner_id uuid; BEGIN
 SELECT user_id INTO owner_id FROM public.user_roles WHERE role='super_admin' LIMIT 1;
 IF owner_id IS NULL THEN
   owner_id := 'b1900700-0000-4000-8000-000000000701';
   INSERT INTO auth.users(id,email) VALUES(owner_id,'pubbrand-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(owner_id,'super_admin');
 END IF;
END $fixture$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('b1900700-0000-4000-8000-000000000711','pubbrand-a','Publish Brand A','active','standalone','PBA','{"system_workspace":true}'),
 ('b1900700-0000-4000-8000-000000000712','pubbrand-b','Publish Brand B','active','standalone','PBB','{"system_workspace":true}');
INSERT INTO auth.users(id,email) VALUES
 ('b1900700-0000-4000-8000-000000000721','pubbrand-a-owner@example.invalid'),
 ('b1900700-0000-4000-8000-000000000722','pubbrand-b-owner@example.invalid');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('b1900700-0000-4000-8000-000000000711','b1900700-0000-4000-8000-000000000721','owner','active',true),
 ('b1900700-0000-4000-8000-000000000712','b1900700-0000-4000-8000-000000000722','owner','active',true);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('b1900700-0000-4000-8000-000000000721','b1900700-0000-4000-8000-000000000711'),
 ('b1900700-0000-4000-8000-000000000722','b1900700-0000-4000-8000-000000000712')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;

SELECT pg_temp.as_server();
-- The workspace's saved work: a draft page with one hero + one signup section bound to a saved
-- draft form (the exact shape growth_page.save writes), and a second page that stays a draft.
INSERT INTO public.growth_forms(id,tenant_id,slug,title,status) VALUES
 ('b1900700-0000-4000-8000-0000000007f1','b1900700-0000-4000-8000-000000000711','workshop-signup','Workshop signup','draft');
INSERT INTO public.growth_pages(id,tenant_id,slug,title,status,draft_blocks_json,draft_seo_json) VALUES
 ('b1900700-0000-4000-8000-0000000007p1','b1900700-0000-4000-8000-000000000711','workshop','Referral workshop','draft',
  '[{"type":"hero","title":"Turn clients into a referral engine"},{"type":"embedded_form","form_slug":"workshop-signup"}]'::jsonb,
  '{"description":"One plan you can run on Monday."}'::jsonb),
 ('b1900700-0000-4000-8000-0000000007p2','b1900700-0000-4000-8000-000000000711','never-published','Still private','draft',
  '[{"type":"hero","title":"Not for visitors yet"}]'::jsonb,NULL);

-- 1. AUTHORITY: the stored call refuses a person who is not this workspace's owner/admin.
SELECT pg_temp.require_error(
  $$SELECT public.growth_page_publish('b1900700-0000-4000-8000-000000000711','b1900700-0000-4000-8000-0000000007p1','b1900700-0000-4000-8000-000000000722')$$,
  'GROWTH_FORBIDDEN','a foreign workspace owner cannot drive another workspace''s publish');

-- 2. FAILED PUBLICATION STAYS PRIVATE: a page with an unresolved placeholder refuses and nothing
--    becomes public (the door's truthfulness, at the stored call it runs).
UPDATE public.growth_pages SET draft_blocks_json='[{"type":"hero","title":"Come on [ADD_DATE]"}]'::jsonb
 WHERE id='b1900700-0000-4000-8000-0000000007p2';
SELECT pg_temp.require_error(
  $$SELECT public.growth_page_publish('b1900700-0000-4000-8000-000000000711','b1900700-0000-4000-8000-0000000007p2','b1900700-0000-4000-8000-000000000721')$$,
  'GROWTH_UNRESOLVED_PLACEHOLDER','a placeholder page refuses to publish');
SELECT pg_temp.as_anon();
PERFORM pg_temp.require_true((SELECT pg_temp.anon_pages('pubbrand-a','never-published'))->0 IS NULL,'a refused publish never leaked to the public read');
SELECT pg_temp.as_server();

-- 3. APPROVED VERSION = VISITOR VERSION: the stored publish returns the public address, and the
--    anonymous read serves exactly the approved draft — blocks and seo byte-equal, status
--    published — with the page's signup form going live with it (owner ruling 2026-09-30).
DO $publish$ DECLARE reply jsonb; served jsonb; BEGIN
 SELECT public.growth_page_publish('b1900700-0000-4000-8000-000000000711','b1900700-0000-4000-8000-0000000007p1','b1900700-0000-4000-8000-000000000721') INTO reply;
 PERFORM pg_temp.require_true((reply->>'url')='/p/pubbrand-a/workshop','the door''s stored call returns the public address');
 PERFORM pg_temp.require_true((reply->>'status')='published','the stored call answers published');
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 SELECT pg_temp.anon_pages('pubbrand-a','workshop') INTO served;
 PERFORM pg_temp.require_true(jsonb_array_length(served)=1,'the anonymous visitor finds the published page');
 PERFORM pg_temp.require_true((served->0->>'status')='published','the visitor sees status published');
 PERFORM pg_temp.require_true((served->0->'blocks')::text=
   '[{"type":"hero","title":"Turn clients into a referral engine"},{"type":"embedded_form","form_slug":"workshop-signup"}]'::jsonb::text,
   'the visitor''s blocks are byte-equal to the approved draft');
 PERFORM pg_temp.require_true((served->0->'seo'->>'description')='One plan you can run on Monday.','the visitor''s page carries the approved SEO description');
END $publish$;
SELECT pg_temp.as_anon();
PERFORM pg_temp.require_true((SELECT count(*) FROM public.growth_forms f JOIN public.tenants t ON t.id=f.tenant_id
  WHERE lower(t.slug)='pubbrand-a' AND f.slug='workshop-signup' AND f.status='published')=1,
  'the page''s embedded form went live with the page');
PERFORM pg_temp.require_true((SELECT pg_temp.anon_pages('pubbrand-a','never-published'))->0 IS NULL,'a draft page never appears to a visitor');
SELECT pg_temp.as_server();

-- 4. UNPUBLISH REMOVES IT FROM THE PUBLIC READ, KEEPING THE WORK.
DO $unpublish$ DECLARE reply jsonb; BEGIN
 SELECT public.growth_page_unpublish('b1900700-0000-4000-8000-000000000711','b1900700-0000-4000-8000-0000000007p1','b1900700-0000-4000-8000-000000000721') INTO reply;
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
 PERFORM pg_temp.require_true((SELECT pg_temp.anon_pages('pubbrand-a','workshop'))->0 IS NULL,'after unpublish the visitor finds nothing');
END $unpublish$;
SELECT pg_temp.as_server();
PERFORM pg_temp.require_true((SELECT status FROM public.growth_pages WHERE id='b1900700-0000-4000-8000-0000000007p1')='draft','unpublish kept the work as a draft');

-- 5. RESTORE AN EARLIER VERSION, REPUBLISH: the visitor then receives the restored content.
--    v2 is saved and published first; then the owner restores v1 from the version timeline
--    (restore_artifact_version writes the draft columns from the version snapshot) and republishes.
UPDATE public.growth_pages SET draft_blocks_json='[{"type":"hero","title":"v2 - bring a friend"}]'::jsonb
 WHERE id='b1900700-0000-4000-8000-0000000007p1';
INSERT INTO public.studio_sessions(id,tenant_id,owner_user_id,title,seed_brief,status) VALUES
 ('b1900700-0000-4000-8000-0000000007s1','b1900700-0000-4000-8000-000000000711','b1900700-0000-4000-8000-000000000721','Referral workshop','A workshop page','building');
INSERT INTO public.studio_artifact_versions(id,tenant_id,session_id,kind,lineage_id,version_no,is_current,snapshot,title) VALUES
 ('b1900700-0000-4000-8000-0000000007v1','b1900700-0000-4000-8000-000000000711','b1900700-0000-4000-8000-0000000007s1','page','b1900700-0000-4000-8000-0000000007p1',1,false,
  jsonb_build_object('draft_blocks_json','[{"type":"hero","title":"Turn clients into a referral engine"},{"type":"embedded_form","form_slug":"workshop-signup"}]'],'Referral workshop'),
 ('b1900700-0000-4000-8000-0000000007v2','b1900700-0000-4000-8000-000000000711','b1900700-0000-4000-8000-0000000007s1','page','b1900700-0000-4000-8000-0000000007p1',2,true,
  jsonb_build_object('draft_blocks_json','[{"type":"hero","title":"v2 - bring a friend"}]'),'Referral workshop');
SELECT public.growth_page_publish('b1900700-0000-4000-8000-000000000711','b1900700-0000-4000-8000-0000000007p1','b1900700-0000-4000-8000-000000000721');
SELECT pg_temp.as_anon();
PERFORM pg_temp.require_true((SELECT pg_temp.anon_pages('pubbrand-a','workshop')->0->'blocks'->0->>'title')='v2 - bring a friend','the visitor first receives v2');
SELECT pg_temp.as_server();
SELECT public.restore_artifact_version('b1900700-0000-4000-8000-0000000007v1','b1900700-0000-4000-8000-000000000711');
SELECT public.growth_page_publish('b1900700-0000-4000-8000-000000000711','b1900700-0000-4000-8000-0000000007p1','b1900700-0000-4000-8000-000000000721');
SELECT pg_temp.as_anon();
PERFORM pg_temp.require_true((SELECT pg_temp.anon_pages('pubbrand-a','workshop')->0->'blocks')::text=
  '[{"type":"hero","title":"Turn clients into a referral engine"},{"type":"embedded_form","form_slug":"workshop-signup"}]'::jsonb::text,
  'after restore-and-republish the visitor receives the restored v1 content, byte-equal');
PERFORM pg_temp.require_true((SELECT pg_temp.anon_pages('pubbrand-b','workshop'))->0 IS NULL,'one workspace''s page never answers another workspace''s slug');
SELECT pg_temp.as_server();

ROLLBACK;
