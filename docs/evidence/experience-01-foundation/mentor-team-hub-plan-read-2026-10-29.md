# EXP01 — MENTOR reads the owner's plans in its own Team Hub DM (slice 1: the plan read)

Date: 2026-10-29 · Lane: EXP01 (ANT-50) · Coordinated in ANT-161 comment 9a4448c8 (ownership + integration contract posted BEFORE any shared edit, per owner directive 66c5b1eb)

## What shipped (customer outcome)

In Team Hub, the owner can now ask MENTOR in its DM "what's on my plate this week?" and MENTOR answers
from the owner's REAL plans — the same `plan_list` read the main PAIGE chat uses — instead of guessing
or refusing. Read-only: MENTOR still cannot create, change or approve anything; a planning write attempt
gets the honest A1 line. The five `plan_*` writers stay withheld exactly as EXP08's D4 and ruling
b379a467 hold them (the write/card half is EXP08's A2c design, deliberately not preempted).

## Where

- PR **#3068** (squash merge **1a7fd5b7b** on main): adapter `supabase/functions/_shared/team-hub/mentor-plan-read.ts` (+ unit suite), agent-turn spans (gate+offer, dispatch, re-gates), Kit-declared `PLAN_LIST_READ_CAPABILITY` in `paige-spine/domains/planning.ts` (INT-003 sanctioned route; exact-tuple lint admission with door-bound check), roster migration `20271122060008`, disposable-database proof `supabase/tests/e01_mentor_team_hub_plan_read.sql`, CI wiring (node --test list + pgtest step).
- Review-fix commit `8e1090454` (gate catches instead of rejecting; `status:"cancelled"` marshals like the live binding; adapter suite in CI; stronger assertions); Kit reroute commit `cf6e070637`.

## How it is safe (fail closed, everywhere)

- Offered ONLY in MENTOR's own DM, gated per turn on: the asker's CURRENT owner/admin authority (`get_team_authority_readiness`), a fresh roster read still listing EXACTLY the offered scope (`access:"read"`), and the conversation really being MENTOR's DM with the asker in it. Re-checked before each provider attempt after a read and once more before the post; any lapse ends the turn with no post (unit-proven for mid-turn roster drift).
- The read runs under the asker's own JWT against the SECURITY DEFINER `public.plan_list` (workspace+membership re-proved in the RPC), then the tenant is re-pinned (`current_user_tenant_id`) like the main chat seam. Strict argument validation, 30-row server-side cap, at most 3 reads per turn, capability receipt (`record_capability_run`, key `plan_list`) recorded BEFORE rows reach the model; every failure answers honestly (unavailable / needs_input), never a guess.
- ZION's stored `plan_list` entry stays stored-but-not-executed in agent turns (unit-proven); channels never offer it; EXP08 #3041 and EXP04 #3064 spans untouched (additive, mentor-only; merges keep both blocks).

## Evidence

- Unit: `node --test` — agent-turn 80/80 (6 new MENTOR cases), adapter 8/8; all 8 team-hub suites green (failing-first: the 5 integration cases failed before the wiring, then passed).
- Non-author review: PASS, no P1s; 3 P2s + test-strength P3s fixed in-PR (8e1090454).
- Capability Kit lint: no new bypass (288/296 baseline intact); lint self-test 40 cases; kit focused tests 48.
- Migration lint: pass. pgtest (local PostgreSQL 16 + CI step): exact-one-append, no other row/key moves, idempotent second run, exact final tools array.
- §24 CI on the exact merged head cf6e070637: full ci run 40836516877 **completed success**; check-run set 16/16 complete, all success.
- Deploy + prod readback: `deploy-migrations` run 40841193637 **success on 1a7fd5b7b** (roster migration applied); prod SQL readback shows MENTOR platform row `capability_scope.tools` now ends `…,"marketplace_browse","plan_list"` with `access:"read"`, ZION unchanged (single `plan_list`, list intact). `deploy-edge-functions` deployed `paige-ai-chat` ✓ at 08:20:09Z from my squash; platform record: paige-ai-chat **v579 updated_at 2026-10-29T08:24:44Z**, status ACTIVE.

## Known limits (honest) — reconciled per Coordinator ec462b9d

- **Assignment status (corrected):** E01-owned coding is complete as a BOUNDED claim; the FULL integrated assignment is **STILL CODING** — the remaining in-scope work is the Team Hub DM confirm-lane CARD admission of MENTOR's five planning WRITERS (the writers themselves are done and frozen in `_shared/paige-spine/domains/planning_writes.ts`, c0b-pinned, live in PAIGE chat; the unimplemented part is EXP08's A2c ordinary-write door, on hold for its lead's return Sat Oct 31 07:00 UTC). Not founder-acceptance-blocked — integration-blocked. E01 executes it when A2c lands.
- **Edge-live certification — RESOLVED after this PR flagged it:** the `download_missing_dependency` readback failures (run 40821995052, 05:14Z, pre-dating this PR) were superseded the same morning by the pipeline's own successful run 40841347232 on main a405a3a11 — deployed-source verified, deployed commit recorded, edge-live at a405, all 29 selected functions PASS including paige-ai-chat v579 (EXP09's independently verified certificate, ANT-161 245a01b9).
- No authenticated drive is claimed here: the live mentor-DM conversation is exercised by the founder evaluation window, never manufactured.

EVIDENCE CLASS: automated unit tests + pgtest + CI + deploy logs + prod SQL/platform readback. No live customer session is claimed.
