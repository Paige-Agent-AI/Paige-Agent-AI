-- R3 — the inspectable research dossier (owner ruling 2026-10-03): ONE bounded diagnostic
-- jsonb column on the CANONICAL research_runs record. No second store, no new engine, no
-- page-body duplication (research_sources remains the sole owner of fetched content) —
-- only the bounded data needed to answer, for any run:
--   "PAIGE found these sources. What candidate claims did synthesis produce, and exactly
--    why did each claim survive or die?"
--
-- Shape (v1), with explicit caps enforced by the writer:
--   {
--     v: 1,
--     hops: [ <=4 (the engine's own hop bound); per hop:
--       hop, planner ("llm"|"entity"), planned_queries (<=6), searches_run (<=6),
--       search_hits_added, reads_selected (indexes, <=10), reads_content_ok (<=10),
--       reads_empty (<=10), budget {searches, reads, cost_usd_est, elapsed_ms} ],
--     synthesis: { returned: boolean, candidates: n },
--     candidates: [ <=64; per candidate:
--       cid (stable run-local id "c1"..), summary (<=240 chars),
--       citations_emitted (raw refs), resolved (canonical source indexes),
--       unresolved: [{ref, reason: "index_out_of_range"|"source_excluded"}],
--       name (<=120), checks: { name_grounded, website: "pass"|"nulled"|"n/a",
--         phone: "pass"|"nulled"|"n/a", values_grounded, values_dropped },
--       outcome: "accepted"|"dropped",
--       drop_reason: one of the canonical taxonomy derived from validateAndBind's
--         actual branches: citation_missing | citation_empty | citation_unresolvable |
--         name_token_mismatch | contact_unverified_strict ],
--     caps_applied: { candidates_truncated: boolean }
--   }
--
-- Unconfigured / no-citable / synthesis-failure paths persist the dossier with what was
-- known (hops always; synthesis/candidates as far as the run reached). NULL dossier =
-- a run by a pre-R3 engine version (the column is additive; no backfill).
ALTER TABLE public.research_runs ADD COLUMN IF NOT EXISTS dossier jsonb;

COMMENT ON COLUMN public.research_runs.dossier IS
  'R3 inspectable dossier: bounded per-hop query/read lineage + per-candidate validateAndBind verdicts with canonical drop-reason codes. Additive diagnostics only — findings/sources remain the canonical outputs. NULL on pre-R3 runs.';
