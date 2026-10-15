# INT-322 — R6-A First Return (the cognitive-class contract; no rival router)

## A. Records correction — CONFIRMED
`r5-after-dev.json` shows exactly **4** all-units-truncated zero-candidate cases (**C1, C4, A1, A2**) plus **3** typed-insufficiency cases (**S3, S4, A4**) = the 7 stated. The R5 return's "5" was an arithmetic slip in prose, not in data. Corrected in `R5-RETURN.md` in this PR (in place, marked as a records correction; the historical result itself is unchanged).

## B. The phase → cognitive-class map (R6-A's contract)

| Research phase (R5 pipeline) | Current call | Cognitive class | R6-A target |
|---|---|---|---|
| ENTITY/DETERMINISTIC PLANNING (`planEntityHop`, facet planners) | pure code, no LLM | **deterministic** | unchanged — code, never an LLM |
| QUERY PLANNING / GAP-CHECK (`planHop`) | `routedChatCompletion("extract")` | **cheap** | the cheap pool through the shared router — never a frontier model to generate search queries |
| UNIT PLANNER (`planSynthesisUnits`) | `routedChatCompletion("extract")` | **cheap** | same |
| SYNTHESIS — routine (`synthesizeUnit`, all unit kinds) | `routedChatCompletion("doc_draft")` | **operational** | GPT-6.1 Sol via the shared fabric when the seam lands; Sonnet 5.5 eligible peer/fallback; **Astra is NOT the default researcher** |
| SYNTHESIS — frontier escalation (bounded, evidence-gated) | — (new, R6-B) | **frontier** | GPT-6.1-class Astra ONLY for: multi-domain integration over large evidence sets, difficult reconciliation, materially-unresolved ambiguity after an operational attempt, or bounded recovery from a typed truncation WITH sufficient evidence. Never because the product is called Deep Research. |
| STRATEGIZE (`strategizeBeforeReasoning`) | `routedChatCompletion("plan")` (reasoning tier) | **operational** | Sol default; 5.5 peer; **Astra is not the strategist** |
| DOSSIER SYNTHESIS (`synthesize`, entity mode) | `routedChatCompletion("doc_draft")` @3200 | **operational** (with per-field citation gates) | same class; the deterministic gate stays the authority |
| SEARCH (`paige-web-search`/Firecrawl) / READ (`fetch-url-content`) | provider tools | **not LLM reasoning** | unchanged canonical retrieval; no hidden OpenAI native web search |
| Judge v2 (benchmark) | `routedChatCompletion("plan")` in eval | **frozen** | NOT routed — longitudinal instrument; identity fixed incl. honest nulls; a v3 would be deliberate |

## C. The current calls, classified
- **Deterministic (no LLM)**: entity/facet planners, ranking, validateAndBind, dedupe, typed-outcome normalization, aggregation.
- **Cheap today**: both `extract` call sites (hop planner + unit planner) — already on the CHEAP_KINDS path (Featherless open model, Claude classification fallback).
- **Operational today**: `doc_draft` unit synthesis + dossier synthesis (Claude reasoning tier), `plan` (strategist) — the shared router's SENSITIVE/REASONING lanes.
- **Frontier today**: none distinct — everything reasoning-class rides the same route. R6-B introduces the escalation lane.

## D. Exact shared-router dependencies R6 needs from the Intelligence Router lane
1. **An OpenAI-Responses seam** (`_shared/model-router.ts` or its successor) that can serve `operational` (Sol) and `frontier` (Astra) classes with a declared job-kind vocabulary the research engine can name — **without research holding provider strings**.
2. **A class-bearing route request**: the research engine wants to say `route({ cognitive_class: "operational", job: "research_unit_synthesis", … })`, not "GPT-6.1 Sol". Today's `pickRoute(jobKind)` has no class dimension beyond cheap/reasoning/sensitive.
3. **A policy-governed fallback declaration** (§7): one alternate provider on transport failure, reason-recorded, router-owned.
4. **Structured route telemetry on the response** (§9): served provider/model + reason code, so research can persist it without becoming the router.
5. **Judge carve-out**: the eval path must be able to PIN its route (frozen instrument) rather than inherit dynamic class routing.

## E. Collision map
- **PR #1783 (INT-329 R1, open)**: `supabase/functions/_shared/claude-models.ts` + docs — the Anthropic→Sonnet-5.5 seam. **R6-A touches none of these files.** The Sonnet-5 retirement and 5.5-first-class work belongs to that lane; R6-A consumes whatever the router serves.
- **`_shared/model-router.ts`** (untouched by #1783 today): R6-A does NOT edit it. The `pickRoute`/`routedChatCompletion` extension for cognitive classes is the Intelligence Router lane's to land; R6-A only declares the requirement (D).
- **`_shared/eval/scorers.ts`** (Judge v2): untouched by R6-A.

## F. R6-A — what can safely land NOW without a rival router
1. **The class contract as data**: a research-side declaration mapping each phase to its cognitive class (`RESEARCH_COGNITIVE_CLASSES` in the engine), consumed at each call site as *documentation-bearing metadata* attached to the existing routed calls — not a second route table. It names classes; the existing router still picks the model.
2. **Routing/evidence metadata on the dossier** (§9's research half): every unit diagnostic gains phase + cognitive class + the served provider/model **as reported by the existing router response** (the L1 trace already records provider/model — R6-A surfaces it into the dossier's unit rows so "why did this unit get model X" is answerable from the run record).
3. **The truncation-escalation GATE as a declared, not-yet-armed policy**: the typed-outcome contract already distinguishes truncation; R6-A encodes the five evidence-gated conditions (from the ruling) as the named predicate the future frontier lane will consult — inert until R6-B arms it.
4. **Tests**: class-map pins (every phase classified; deterministic phases pinned LLM-free); dossier telemetry pins; the escalation-predicate pins (evidence-gated, bounded, observable); Judge-frozen pin (the eval path never reads the class map).
5. **The A records correction** (this PR).

## G. Owner decisions genuinely required
1. **Timing of R6-B**: it is blocked on the Intelligence Router lane's OpenAI-Responses seam (D.1–2). Should R6-A merge now and R6-B wait, or should the lane land first and R6 collapse into one phase? (Recommendation: R6-A now — it is contract + observability only.)
2. **Operational default during the gap**: until Sol is routable, unit synthesis stays on the current reasoning route (today Claude; #1783 moves it to Sonnet 5.5). Confirm the quality floors are measured against R5-on-Sonnet-5 when the model lane lands (the ruling's model-runtime separation already requires this).
3. **Judge v2 pin mechanics**: confirm the eval seam may keep an explicit fixed route (D.5) so the benchmark instrument never inherits dynamic class routing.
