-- §34 L1 — Observability: capture Anthropic prompt-cache usage on paige_llm_trace.
--
-- WHY (measured, 2026-09-24):
--   1,228 traced calls, $29.22 estimated, and `chat` + `chat-tool-loop` are 843 of them and $25.43
--   of the spend — at an average 52,278 input tokens against 460 out. Input dominates output ~100:1,
--   which makes prompt caching the single largest lever on Paige's biggest cost line. We could not
--   tell whether it is working. Nothing in the tree reads cache_read_input_tokens or
--   cache_creation_input_tokens (repo-wide grep: zero hits), so the answer was unobservable rather
--   than merely unknown.
--
-- THE CORRECTION THAT MAKES THIS MORE THAN A COST QUESTION:
--   Anthropic's `input_tokens` is the UNCACHED REMAINDER ONLY. The real prompt size is
--   input_tokens + cache_creation_input_tokens + cache_read_input_tokens. So today's trace does not
--   just omit what caching COST — it omits those tokens from the row entirely, and a heavily-cached
--   turn traces as a few thousand input tokens when the prompt was tens of thousands. Every
--   token-volume figure read off this table is therefore an UNDERCOUNT whenever a cache hit occurred.
--
--   ONE OF THOSE READERS ENFORCES SOMETHING. `accruedSpendToday` (_shared/router-budget/mod.ts:172)
--   sums `cost_estimate_usd` off this table to decide whether the daily ceiling is reached, and that
--   estimate is derived from tokens_in/tokens_out alone. `cache_control` has been live on the
--   streaming chat path since 8af6bd91a (2026-09-11, #1120), so on every cache hit since then the
--   cached prefix has been priced at zero and the gate has admitted MORE real spend than its ceiling
--   states. Pre-existing and NOT changed here — this migration is what makes it measurable. Pricing
--   cached tokens (read ~0.1x base input, write ~1.25x at the 5-minute TTL) moves a shipped §33 cost
--   cap and is therefore an owner decision, tracked separately rather than folded in here.
--
-- WHAT CHANGES (additive, backward-compatible):
--   Two nullable integer columns. Writers set them only where the provider actually reports them;
--   every other producer leaves them unset, so they default to NULL. No existing column, index,
--   grant, policy, or row is touched. Verified before writing: paige_llm_trace has no view,
--   materialized view, trigger, %ROWTYPE or RETURNS SETOF over it, no reader anywhere uses SELECT *,
--   and both RLS policies (20260719150000:86-98) plus both grants are column-agnostic — so the new
--   columns inherit the existing posture with no re-grant and no policy change.
--
-- *** DELIBERATELY NOT FOLDED INTO tokens_in — THIS IS A MONEY BOUNDARY, NOT A STYLE CHOICE. ***
--   meter_llm_usage writes `quantity = tokens_in + tokens_out` as unit 'token' into
--   platform_usage_events (20261033000000:112,126). Widening tokens_in to include cache tokens would
--   silently change every tenant's metered quantity — a pricing change wearing an observability
--   fix's clothes (§38/§17). Cache counts stay in their own columns, observable and unbilled, until
--   an owner decision says otherwise. src/pages/admin/PlatformIntelligence.tsx:176 renders the same
--   sum and is likewise unaffected.
--
-- NULL IS NOT ZERO (§13):
--   NULL means the provider did not report the field — a non-Anthropic provider, an error row, a
--   budget-block row, or a path that never asked. 0 means Anthropic reported zero: a real cache miss.
--   Readers must not coalesce the two; "no cache data" and "no cache hit" are different facts and
--   conflating them is how an unwired seam gets read as a working one.
--
-- SCOPE HONESTY (§13) — what this migration does NOT establish:
--   `cache_control` is set in exactly ONE place — inside `buildClaudeRequest` in _shared/claude.ts —
--   and that builder has exactly one caller: the `stream === true` branch of `gatewayCompat`.
--   (Symbolic references on purpose: line numbers here drifted the moment the writer commit added
--   lines above them, so they are named by symbol and verifiable by grep instead.)
--   Every non-streaming Anthropic call — routedChatCompletion, claudeText, the five
--   growth/content retry sites, ~30 gatewayCompat non-stream callers — runs UNCACHED today. So a
--   zero or NULL on those paths after this ships is a TRUE reading, not a wiring bug. Making the
--   non-streaming path cache is a separate, deliberate change.
--
-- SECURITY / PII:
--   §9  Two integer counts. No tenant, member or client PII; identical sensitivity to the existing
--       tokens_in / tokens_out, and covered by the same tenant-scoped read policy.
--   §34 Pure Supabase Postgres; no vendor substrate.
--
-- ORDERING (§32) — this migration MUST be persisted on prod BEFORE the writer that sets these
--   columns deploys. traceLLMCall inserts its record whole and swallows the error (llm-trace.ts:224-228),
--   so an unknown column returns PGRST204 and silently destroys EVERY trace row on EVERY path, not
--   just the cache fields. deploy-migrations.yml and deploy-edge-functions.yml are independent
--   path-triggered jobs with no ordering guarantee, so a single commit touching both races.
--
-- Idempotent; ADDITIVE only.

ALTER TABLE public.paige_llm_trace
  ADD COLUMN IF NOT EXISTS cache_read_input_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_creation_input_tokens integer;

COMMENT ON COLUMN public.paige_llm_trace.cache_read_input_tokens IS
  'Additive: prompt tokens served FROM the provider cache on this call (Anthropic usage.cache_read_input_tokens). NOT included in tokens_in — Anthropic''s input_tokens is the uncached remainder only, and meter_llm_usage bills quantity = tokens_in + tokens_out, so folding these in would change every tenant''s metered quantity. NULL = the provider did not report it (non-Anthropic, error, or a path that never asked); 0 = reported zero, a real cache miss. The two are different facts.';

COMMENT ON COLUMN public.paige_llm_trace.cache_creation_input_tokens IS
  'Additive: prompt tokens WRITTEN to the provider cache on this call (Anthropic usage.cache_creation_input_tokens). Billed by Anthropic at a premium over base input (1.25x at the 5-minute TTL), against cache reads at roughly 0.1x — which is why the two are counted separately rather than summed. NOT included in tokens_in, for the same metered-quantity reason as cache_read_input_tokens. NULL = not reported; 0 = reported zero.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- CORRECTION (2026-09-24, from the §39 peer-gate on the pushed diff). Appended, not overwritten, so
-- the record of what was believed at authoring time survives alongside what is now true.
--
-- 1. THE ORDERING BLOCK ABOVE DESCRIBES A HAZARD THAT NO LONGER EXISTS AS WRITTEN. It says
--    traceLLMCall "inserts its record whole and swallows the error", so an unknown column would
--    silently destroy every trace row on every path. That was exactly true of the code this header
--    was written against, and it is what motivated shipping the schema as its own commit. The very
--    next commit on this branch changed it: _shared/llm-trace.ts now destructures the insert result,
--    logs a rejection (supabase-js RESOLVES a PostgREST error rather than throwing, so nothing was
--    logged before), and on PGRST204 — or a "column ... does not exist" message — sheds the two
--    optional cache columns and retries once. A writer that reaches production ahead of this
--    migration therefore DEGRADES to the previous trace shape instead of losing every row.
--
-- 2. CONSEQUENTLY "schema ships alone and first" IS NOT WHAT THIS BRANCH DELIVERS, and claiming it
--    would be false. Both commits sit on one branch; merging it fires deploy-migrations.yml and
--    deploy-edge-functions.yml in parallel, with no ordering guarantee between them. The accepted
--    mitigation is the shed-and-retry in (1), not sequencing. Migration-first remains the SAFER
--    order and is still worth taking where a merger controls it — but nothing structural enforces
--    it, and this header should not imply otherwise.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
