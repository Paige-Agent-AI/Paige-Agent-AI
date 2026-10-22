-- Correct only the incumbent platform recipe's descriptive contract. No new
-- capability, tier, allowed tool, authority lane, activation or Memory writer.
-- Ordinary tenant-authored recipes and the other platform recipes are preserved.
DO $repair$
DECLARE
  incumbent public.paige_skills%ROWTYPE;
  desired_description constant text := 'Prepares a private client-service game-plan draft from the selected CRM customer, the owner brief and available authorized confirmed historical context. Records the draft on its original skill run for business review. Does not assign work, teach Memory, publish, share or send it.';
  desired_steps constant jsonb := '[
    {"id":"context","desc":"Verify the original business actor and CRM relationship; read only permitted confirmed historical context","tool":"context"},
    {"id":"synthesize","desc":"Draft goals, current reality, options and proposed next actions for owner review through existing Model Fabric","tool":"anthropic"},
    {"id":"record","desc":"Verify the private draft on the original skill run; an uncertain acknowledgement requires original-run observation, never automatic regeneration"}
  ]'::jsonb;
  original_steps constant jsonb := '[
    {"id":"context","desc":"Pull client profile + readiness lens + memory","tool":"context"},
    {"id":"research","desc":"Retrieve KB sections relevant to client stage","tool":"rag"},
    {"id":"web","desc":"Optional fresh web research on niche/lender","tool":"firecrawl"},
    {"id":"synthesize","desc":"Compose stage-aware action roadmap","tool":"anthropic"},
    {"id":"save","desc":"Save as game_plan record","tool":"client_memory"}
  ]'::jsonb;
BEGIN
  SELECT * INTO incumbent FROM public.paige_skills
    WHERE slug = 'build_game_plan' AND scoping = 'platform' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original platform game-plan recipe is unavailable'; END IF;
  IF incumbent.description = desired_description AND incumbent.steps = desired_steps AND incumbent.version = 2 THEN RETURN; END IF;
  IF incumbent.version <> 1 OR incumbent.steps IS DISTINCT FROM original_steps
    OR incumbent.description IS DISTINCT FROM 'Pulls client context, KB articles, and recent web research, then produces a personalized step-by-step roadmap. Saves to client memory and offers to email the client.'
  THEN RAISE EXCEPTION 'Game-plan recipe changed; reconcile its original source before correction'; END IF;
  UPDATE public.paige_skills SET description = desired_description, steps = desired_steps, version = 2
    WHERE id = incumbent.id;
END;
$repair$;
