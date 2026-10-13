#!/usr/bin/env node
// The server half of a Paige form on a business's own website (Experience 03, S2a), proven with an answer a browser
// actually sent. cloudflare-embed-drive.mjs drives a visitor on a Cloudflare Pages site and saves the request that
// reached growth-public-submit (artifacts/cloudflare-embed/sent.json). This replays it through the REAL intake rules
// (supabase/functions/_shared/growth-intake.ts: origin allow-list, bot trap, the form's own fields, campaign tags)
// and then the REAL database writer path on an ISOLATED local clone, inside one transaction that is rolled back:
// the row growth-public-submit inserts, the S1a campaign stamp, the processor's filing into the S1b campaign
// pipeline, and the campaign's lead list as its owner reads it, and as another business's owner cannot.
//
// WHAT IT DOES NOT PROVE. The edge function's HTTP wrapper and rate limits (its own tests); the processor's contact
// matching (the contact is pinned here exactly as campaign_pipeline_routing.sql pins it); production.
//
// LOCAL_DB_URL defaults to the local Supabase database. It refuses any host but localhost / 127.0.0.1.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isAllowedOrigin, looksLikeBot, sanitizeAnswers, sanitizeUtm } from "../../supabase/functions/_shared/growth-intake.ts";

const DB = process.env.LOCAL_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\//.test(DB)) throw new Error("LOCAL_DB_URL must point at an isolated local database, never production.");
const SENT = process.argv[2] ?? path.resolve(import.meta.dirname, "artifacts/cloudflare-embed/sent.json");
const { form, sent } = JSON.parse(fs.readFileSync(SENT, "utf8"));
const body = sent.body;

const results = [];
const check = (ok, name, detail = "") => { results.push({ ok, name }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  ${detail}` : ""}`); };

// 1. The intake's own rules, on the request as the browser sent it. In production the frame's origin is Paige's own
//    (https://paigeagent.ai); the drive asserted the request came from the app's origin, never the business's site.
check(isAllowedOrigin("https://paigeagent.ai") && !isAllowedOrigin("https://northwind-advisory.pages.dev"),
  "origin: answers are accepted from Paige's own origin and refused from the business's site (Cloudflare Pages)");
check(!looksLikeBot(body.hp, body.elapsed_ms), "bot trap: the visitor's real send is not taken for a bot", JSON.stringify({ hp: body.hp, elapsed_ms: body.elapsed_ms }));
const { answers, unknownKeys, invalidKeys, missingRequired } = sanitizeAnswers(form.schema_json, body.answers);
check(missingRequired.length === 0 && invalidKeys.length === 0 && unknownKeys.length === 0 && answers.email === "dana@example.com",
  "answers: only the form's own fields, all valid", JSON.stringify({ answers, unknownKeys, invalidKeys, missingRequired }));
const utm = sanitizeUtm(body.utm);
check(utm.utm_campaign === "spring-advisory", "campaign tags: the visit's utm_campaign survives the intake", JSON.stringify(utm));
check(!("tenant_id" in body), "the request names no business; the server finds it from the form");

// 2. The database, exactly as growth-public-submit writes (tenant from the form row, never the request).
const q = (v) => `'${String(v).replace(/'/g, "''")}'`;
const j = (v) => `${q(JSON.stringify(v))}::jsonb`;
const T = "a3e30300-0000-4000-8000-0000000000";
const sql = `
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL timezone='UTC';
CREATE FUNCTION pg_temp.as_user(uid text) RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub',uid,true),set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true) $$;
CREATE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
 SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true) $$;
SELECT pg_temp.as_service();
INSERT INTO auth.users(id,email) VALUES ('${T}01','s2a-replay-owner@example.invalid'),('${T}02','s2a-replay-other@example.invalid');
DO $owner$ DECLARE o uuid; BEGIN
 SELECT user_id INTO o FROM public.user_roles WHERE role='super_admin' LIMIT 1;
 IF o IS NULL THEN o := '${T}03'; INSERT INTO auth.users(id,email) VALUES(o,'s2a-replay-platform@example.invalid'); INSERT INTO public.user_roles(user_id,role) VALUES(o,'super_admin'); END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',o)::text,true);
END $owner$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('${T}a1','s2a-replay-a','Northwind Advisory (synthetic)','active','standalone','XRA','{"system_workspace":true}'),
 ('${T}b1','s2a-replay-b','Other business (synthetic)','active','standalone','XRB','{"system_workspace":true}');
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES ('${T}a1','${T}01','admin','active',false),('${T}b1','${T}02','admin','active',false);
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES ('${T}01','${T}a1'),('${T}02','${T}b1') ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
SELECT pg_temp.as_service();
SELECT set_config('app.pipeline_requested_by','${T}01',true);
CREATE TEMP TABLE fx(name text PRIMARY KEY, id uuid);
WITH c AS (INSERT INTO public.pipelines(tenant_id,name,is_default,created_by) VALUES ('${T}a1','Sales Pipeline',true,'${T}01') RETURNING id) INSERT INTO fx SELECT 'default',id FROM c;
WITH c AS (INSERT INTO public.pipelines(tenant_id,name,is_default,created_by) VALUES ('${T}a1','Consult pipeline',false,'${T}01') RETURNING id) INSERT INTO fx SELECT 'campaign',id FROM c;
INSERT INTO public.pipeline_stages(id,pipeline_id,tenant_id,label,stage_type,order_index) VALUES
 ('${T}d1',(SELECT id FROM fx WHERE name='default'),'${T}a1','New lead','open',0),
 ('${T}d2',(SELECT id FROM fx WHERE name='campaign'),'${T}a1','Discovery','open',0);
INSERT INTO public.growth_forms(id,tenant_id,slug,name,status,created_by,auto_create_deal,pipeline_id,schema_json,success_action_json)
 VALUES (${q(form.id)},'${T}a1',${q(form.slug)},${q(form.name)},'active','${T}01',false,NULL,${j(form.schema_json)},${j(form.success_action_json)});
INSERT INTO public.campaign_briefs(id,tenant_id,short_ref,name,lifecycle_status,pipeline_id)
 VALUES ('${T}c1','${T}a1','SPRING-ADVISORY','Spring advisory push','approved',(SELECT id FROM fx WHERE name='campaign'));
SELECT pg_temp.as_user('${T}01');
DO $attach$ BEGIN
 IF (public.configure_campaign_brief_assets(NULL,jsonb_build_object('type','attach_asset','briefId','${T}c1','assetKind','form','assetId',${q(form.id)}),'s2a-replay-1','human')->>'ok') IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'FAIL: the owner attaches the form to the campaign'; END IF;
END $attach$;

-- growth-public-submit's insert, with the values the real intake rules produced from the browser's request.
SELECT pg_temp.as_service();
INSERT INTO public.growth_form_submissions(id,form_id,tenant_id,payload_json,utm_json,consent_json,source,referrer,user_agent)
SELECT '${T}e1', f.id, f.tenant_id, ${j(answers)}, ${j(utm)}, '{}'::jsonb, 'paige_form', ${q((sent.referer ?? "").slice(0, 500))}, 'replay'
FROM public.growth_forms f WHERE f.id = ${q(form.id)} AND f.status='active';
DO $stamp$ DECLARE s public.growth_form_submissions%ROWTYPE; BEGIN
 SELECT * INTO s FROM public.growth_form_submissions WHERE id='${T}e1';
 IF s.tenant_id IS DISTINCT FROM '${T}a1' THEN RAISE EXCEPTION 'FAIL: the answer is filed for the form''s own business, got %',s.tenant_id; END IF;
 IF s.campaign_brief_id IS DISTINCT FROM '${T}c1' OR s.campaign_attribution IS DISTINCT FROM 'form_and_tag' THEN
   RAISE EXCEPTION 'FAIL: the answer is credited to its campaign by the form and the visit''s tag, got % / %',s.campaign_brief_id,s.campaign_attribution; END IF;
 RAISE NOTICE 'PASS  the answer is filed for the form''s business and credited to its campaign (form_and_tag)';
END $stamp$;

-- The processor files it: a contact pinned as campaign_pipeline_routing.sql pins it, then the real filing function.
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,account_number,lifecycle_stage,source)
 VALUES ('${T}b9','${T}a1','${T}01','Dana','Reyes','XRA-1','new_lead','paige_form');
UPDATE public.growth_form_submissions SET contact_id='${T}b9',processing_state='claimed',attempts=1 WHERE id='${T}e1';
DO $file$ DECLARE r jsonb; d public.deals%ROWTYPE; BEGIN
 r := public.growth_attach_submission_default_deal('${T}e1',1);
 SELECT * INTO d FROM public.deals WHERE id=(r->>'deal_id')::uuid;
 IF d.pipeline_id IS DISTINCT FROM (SELECT id FROM fx WHERE name='campaign') OR d.stage_id IS DISTINCT FROM '${T}d2' OR d.tenant_id IS DISTINCT FROM '${T}a1' THEN
   RAISE EXCEPTION 'FAIL: the lead is filed in the campaign''s pipeline, first open stage, got %',r; END IF;
 RAISE NOTICE 'PASS  the lead is filed in the campaign''s pipeline (Consult pipeline › Discovery)';
END $file$;

-- The owner reads the campaign's leads; another business's owner cannot.
SELECT pg_temp.as_user('${T}01');
DO $read$ DECLARE r jsonb; l jsonb; BEGIN
 r := public.get_campaign_brief_leads(NULL,'${T}c1');
 SELECT x INTO l FROM jsonb_array_elements(r->'leads') x WHERE x->>'submission_id'='${T}e1';
 IF l IS NULL OR l->>'contact_name' IS DISTINCT FROM 'Dana Reyes' OR l->>'pipeline_name' IS DISTINCT FROM 'Consult pipeline' OR l->>'stage_label' IS DISTINCT FROM 'Discovery'
    OR l->>'attribution' IS DISTINCT FROM 'form_and_tag' OR l->>'form_name' IS DISTINCT FROM ${q(form.name)} THEN
   RAISE EXCEPTION 'FAIL: the owner reads the lead back on the campaign with its contact, pipeline and stage, got %',coalesce(l,r); END IF;
 RAISE NOTICE 'PASS  the owner reads the lead back on the campaign: Dana Reyes, Consult pipeline › Discovery, form and tag';
END $read$;
SELECT pg_temp.as_user('${T}02');
-- As the browser's role, so row security decides what the other owner can see.
SET LOCAL ROLE authenticated;
DO $other$ DECLARE r jsonb; ok boolean := false; BEGIN
 BEGIN
   r := public.get_campaign_brief_leads('${T}a1','${T}c1');
   ok := r IS NULL OR coalesce(jsonb_array_length(r->'leads'),0)=0;
 EXCEPTION WHEN others THEN ok := true;
 END;
 IF NOT ok THEN RAISE EXCEPTION 'FAIL: another business''s owner reads nothing of this campaign, got %',r; END IF;
 IF EXISTS (SELECT 1 FROM public.growth_form_submissions WHERE id='${T}e1') THEN RAISE EXCEPTION 'FAIL: another business''s owner cannot see the answer'; END IF;
 RAISE NOTICE 'PASS  another business''s owner reads nothing of it';
END $other$;
RESET ROLE;
ROLLBACK;
`;
const run = spawnSync("psql", [DB, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, encoding: "utf8" });
for (const line of `${run.stdout}\n${run.stderr}`.split("\n")) {
  const m = line.match(/NOTICE:\s+(PASS .*)$/);
  if (m) { console.log(m[1]); results.push({ ok: true, name: m[1] }); }
  else if (/ERROR|FAIL/.test(line)) { console.log(`FAIL  ${line.trim()}`); results.push({ ok: false, name: line.trim() }); }
}
const failed = results.filter((r) => !r.ok).length + (run.status === 0 ? 0 : 1);
console.log(`\n${results.filter((r) => r.ok).length} passed, ${failed} failed (rolled back; nothing kept).`);
process.exit(failed ? 1 : 0);
