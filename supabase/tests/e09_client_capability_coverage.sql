BEGIN;
SELECT plan(8);
CREATE TEMP TABLE e09_catalogue_seeds(slug text, original_description text);
INSERT INTO e09_catalogue_seeds VALUES
  ('build_game_plan', 'Prepares a private client-service game-plan draft from the selected CRM customer, the owner brief and available authorized confirmed historical context. Records the draft on its original skill run for business review. Does not assign work, teach Memory, publish, share or send it.'),
  ('client_deliverable_draft', 'Drafts the specific deliverable a tenant''s offer produces for a client — an assessment, a plan, a report — grounded in the tenant''s offer and this client''s own context, and renders it as a document for review. It produces an approval-ready draft; the human reviews and approves before it reaches the client.'),
  ('client_onboarding_sequence', 'Drafts the orchestrated multi-touch kickoff journey for a new client — the welcome touch, the intake questions to send, expectation-setting, and the first milestone — as one approval-ready sequence a human signs off on before anything goes out. This is the multi-step JOURNEY across time, distinct from the static draft_onboarding_packet (a one-time bundle of onboarding documents); this skill orchestrates the touches, it does not assemble the packet.'),
  ('engagement_wrapup_sequence', 'Drafts the end-of-engagement graduation flow for a client as one approval-ready sequence — a results recap, final handoffs, a renewal or next-step offer, and a testimonial ask. It orchestrates the pieces and sequences them; it references draft_offboarding_document for the formal offboarding document and draft_testimonial_interview_outline for the testimonial questions rather than re-drafting either.'),
  ('milestone_tracking', 'Reads where each active client sits in their delivery journey and returns a plain-language status summary — on-track, at-risk, or stalled — with the signal behind each call. Read-only: it inspects client data and journey state and reports; it saves nothing and sends nothing.'),
  ('progress_checkin_draft', 'Drafts a periodic progress check-in message for a client on the engagement''s cadence — what''s been done, what''s next, and one clear ask — in the tenant''s voice. It produces an approval-ready message; after the human approves, the actual send happens through the compose-email seam.'),
  ('reactivation_sequence', 'Drafts a win-back sequence for a lapsed client — a personalized re-engagement message that references their prior work plus a low-friction re-entry offer — as an approval-ready draft. It references crm_search_contacts to identify lapsed clients and the compose-email seam for the downstream send after the human approves.');
SELECT is((SELECT count(*)::integer FROM public.paige_skills s JOIN e09_catalogue_seeds v USING(slug)),7,'the seven original recipe identities remain');
SELECT is((SELECT count(*)::integer FROM public.paige_skills s JOIN e09_catalogue_seeds v USING(slug) WHERE metadata->'catalogue_coverage' = '{"version":1,"state":"limited"}'::jsonb),7,'only the bounded existing Chat read/private draft subset is declared');
SELECT ok((SELECT bool_and(slug='build_game_plan' OR description LIKE 'Ask PAIGE %') FROM public.paige_skills s JOIN e09_catalogue_seeds v USING(slug)),'the next action uses the existing owner conversation');
SELECT ok((SELECT bool_and(metadata->'catalogue_coverage'->>'state' <> 'live') FROM public.paige_skills s JOIN e09_catalogue_seeds v USING(slug)),'coverage never grants Live execution');
SELECT ok((SELECT bool_and(risk_level IN ('draft','read_only') AND autonomy_lane IN ('confirm','auto')) FROM public.paige_skills s JOIN e09_catalogue_seeds v USING(slug)),'original recipe risk/lane vocabulary is retained');
CREATE TEMP TABLE e09_catalogue_before AS SELECT id,to_jsonb(s) AS original FROM public.paige_skills s;
\ir ../migrations/20271113150000_e09_client_capability_coverage.sql
SELECT is((SELECT count(*)::integer FROM public.paige_skills s JOIN e09_catalogue_before b USING(id) WHERE to_jsonb(s) IS DISTINCT FROM b.original),0,'replay leaves every original row, permission, counter and timestamp unchanged');
-- Seven independent exclusions are exercised together. These are rolled-back
-- native fixtures, never production customer records or new registry entries.
UPDATE public.paige_skills s SET description=v.original_description,metadata='{}'::jsonb
 FROM e09_catalogue_seeds v WHERE s.slug=v.slug;
UPDATE public.paige_skills SET metadata='{"catalogue_coverage":{"version":1,"state":"coming_soon"}}' WHERE slug='build_game_plan';
UPDATE public.paige_skills SET description='Custom client drafting wording' WHERE slug='client_deliverable_draft';
UPDATE public.paige_skills SET scoping='tenant' WHERE slug='milestone_tracking';
UPDATE public.paige_skills SET name='Custom progress wording' WHERE slug='progress_checkin_draft';
UPDATE public.paige_skills SET category='analytics_interpretation' WHERE slug='engagement_wrapup_sequence';
UPDATE public.paige_skills SET created_by='admin' WHERE slug='reactivation_sequence';
UPDATE public.paige_skills SET metadata='[]'::jsonb WHERE slug='client_onboarding_sequence';
CREATE TEMP TABLE e09_catalogue_custom_before AS SELECT id,to_jsonb(s) AS original FROM public.paige_skills s;
\ir ../migrations/20271113150000_e09_client_capability_coverage.sql
SELECT is((SELECT count(*)::integer FROM public.paige_skills s JOIN e09_catalogue_custom_before b USING(id) WHERE to_jsonb(s) IS DISTINCT FROM b.original),0,'custom coverage, copy, scope, name, category, author and malformed metadata are preserved');
SELECT is((SELECT count(*)::integer FROM public.paige_skills),(SELECT count(*)::integer FROM e09_catalogue_before),'no parallel recipe is created');
SELECT * FROM finish();
ROLLBACK;
