BEGIN;
SELECT plan(8);
SELECT is((SELECT count(*)::integer FROM public.paige_skills WHERE slug='build_game_plan' AND scoping='platform'),1,'one original platform recipe');
SELECT is((SELECT version FROM public.paige_skills WHERE slug='build_game_plan'),2,'descriptive revision is recorded');
SELECT is((SELECT risk_level FROM public.paige_skills WHERE slug='build_game_plan'),'draft','draft risk is preserved');
SELECT is((SELECT autonomy_lane FROM public.paige_skills WHERE slug='build_game_plan'),'confirm','original confirmation lane is preserved');
SELECT ok((SELECT description LIKE '%original skill run%' AND description LIKE '%Does not assign work%' FROM public.paige_skills WHERE slug='build_game_plan'),'original receipt and effect boundary are explicit');
SELECT ok((SELECT NOT (steps::text ~ 'lender|readiness lens|Save as game_plan record') FROM public.paige_skills WHERE slug='build_game_plan'),'unimplemented source claims are not advertised');
CREATE TEMP TABLE e09_recipe_before AS SELECT id,to_jsonb(s) AS original FROM public.paige_skills s;
\ir ../migrations/20271113140000_e09_client_game_plan_truth.sql
SELECT is((SELECT count(*)::integer FROM public.paige_skills s JOIN e09_recipe_before b USING(id) WHERE to_jsonb(s) IS DISTINCT FROM b.original),0,'replay changes no original recipe, counter, permission or timestamp');
SELECT is((SELECT count(*)::integer FROM public.paige_skills), (SELECT count(*)::integer FROM e09_recipe_before),'replay creates no parallel recipe');
SELECT * FROM finish();
ROLLBACK;
