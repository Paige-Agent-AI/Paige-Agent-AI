# EXP10 — Run-outcome confirmation: a SUCCEEDED lookup was narrated as "couldn't confirm" (2026-11-06)

## OWNER REPORT (verbatim)

> "Lets see if we can make these updates. Because when I clicked on the approval card it would not allow her to do it."

PAIGE's transcript end state: "I couldn't confirm whether the HighLevel lookup went through—please check
HighLevel before requesting it again so it doesn't run twice." — after the owner clicked **Approved** on
her `contacts_get-contacts` approval card.

## FORENSIC TIMELINE (prod, connection `16fe8057-fcf9-4fc6-80a3-637d9c68251e`)

| Time (UTC) | Evidence | Fact |
| --- | --- | --- |
| 00:33:50 | `paige_chat_turns` seq 2398 | PAIGE: "all 36 HighLevel actions approved, with none waiting" — the ledger read correctly |
| 00:34:51 | seq 2399 | Owner: "Yeah let's do it" |
| 00:35:01 | edge log POST mcp-gateway 624ms (200) | The unapproved dispatch → `mode:"prepare"` — staged, no provider contact |
| 00:35:05 | seq 2400 | Approval card rendered ("Review the proposed changes before approving.") |
| 00:35:11 | seq 2401 | **Owner clicked Approved — run it.** |
| 00:35:21.390 | edge log POST mcp-gateway 802ms (200) | The approved dispatch → `mode:"execute"` |
| 00:35:21.359 | `paige_workspace_events` via `record_capability_run` | **`capability_succeeded` on `mcp_connection_run` — THE RUN SUCCEEDED** |
| 00:35:25 | seq 2402 | PAIGE: "couldn't confirm whether the HighLevel lookup went through" |

The gateway, the approvals ledger, the execute flag, the card flow, and the Rail receipt ALL worked.
The tool ran and GHL answered a recognized non-error result. What failed was the LAST inch: what the
chat told the model about it.

## ROOT CAUSE

`paige-ai-chat`'s `ghl_run_action` branch forwarded the gateway's closed execute body **verbatim** to
the model:

```
{ "outcome": "read_observed", "code": null, "run_id": "…", "recorded": true }
```

- **No `success` field** — the convention every other tool result in this chat follows.
- **No data** — nothing that was read. A contacts lookup that returns zero contacts' information
  cannot be confirmed by anyone, model or human.
- **No glossary** — `read_observed`/`recorded` is an enum the model was never taught.

A model handed an unexplained vocabulary with no evidence honestly narrates its own blindness as
"couldn't confirm" — and hedges about double-running because it cannot tell whether the effect landed.
§13's projection discipline (built to stop provider prose from reaching models) had also stopped the
data the tool existed to fetch.

## THE FIX (two layers, one seam each)

### Layer 1 — the gateway returns what a clean success actually produced

- `result.ts` → `projectToolResultData(raw)`: from a **validated clean result only** (re-asserts the
  recognized/non-error shape itself; fails closed otherwise), projects text blocks' `text` plus
  `structuredContent` as JSON; strips control characters (except `\n`/`\t`); caps at 4 000 chars
  with an explicit `[truncated]` marker; returns `null` for empty. Non-text blocks never cross.
- `runner.ts`: `emit(...)` carries the projection for `read_observed`/`executed` **only**; every
  refusal, error, unknown, or prepared path carries `null`. The receipt detail is unchanged — the
  Rail stays an outcome audit trail, not a provider-content store.
- `execute.ts`: the HTTP body gains `data` (null on every non-success; in particular
  `outcome_unknown` NEVER echoes an unvalidated payload, which could dress an uncertain landing as
  a confirmed one).

### Layer 2 — the chat translates the vocabulary (the Zapier lane's `projectOutcomeForModel` discipline)

- New `_shared/mcp-gateway/run-projection.ts`: `projectRunOutcomeForModel` /
  `projectRunRefusalForModel` — allowlist-only fields, `success` boolean, the bounded `data`
  re-capped at 3 000, and an own-words `note` per outcome, e.g.:
  - `read_observed`: "The tool ran successfully and returned data… The read is confirmed; do not
    re-run it to 'make sure'."
  - `outcome_unknown`: "…may or may not have landed. Do NOT run this tool again… tell the operator
    to check the connected app first so it does not happen twice."
- `paige-ai-chat` `ghl_run_action` now routes both the success and refusal bodies through the
  projection instead of forwarding raw.
- The approval-card copy no longer describes every GHL call as a write ("a read looks up real
  records and changes nothing; a write changes real records or messages a real person").

## SECURITY POSTURE (unchanged in kind, re-bounded in degree)

The `data` projection is provider-written content entering model context — a prompt-injection
surface that already exists for every other governed lane. It is bounded (two independent caps),
control-stripped, and labeled in the glossary as content to report, never instructions to follow.
Secrets remain inside the loader; unvalidated payloads never echo; refusals stay closed-vocabulary.

## AUTOMATED_EVIDENCE

- `supabase/functions/_shared/mcp-gateway/result.test.ts` (NEW, 9 tests): input gate (isError /
  malformed isError / unrecognized → null), content rules (text + structuredContent, non-text and
  non-string text ignored), bounds (control-strip, cap + `[truncated]`, empty → null).
- `supabase/functions/_shared/mcp-gateway/run-projection.test.ts` (NEW, 9 tests): success mapping
  per outcome, the no-duplicate-retry instruction on `outcome_unknown`, allowlist (unknown fields
  never cross), the adapter's own re-cap, refusal glossary.
- `scripts/mcp-gateway-smoke.mjs`: +4 assertions (400 total, all green) — runner-level and
  runExecute-level reads carry `data === "ok"` from the fake provider; an executed mutation carries
  its clean confirmation; `outcome_unknown` carries `data === null`.
- `deno test supabase/functions/_shared/mcp-gateway/` → 24 passed (18 new + 6 consent tests).
- `deno check` gateway tree clean.

## STATE_COVERAGE

Covered: read success (data crosses), mutation success (confirmation data crosses), every refusal
and error path (no data), outcome_unknown (no echo + explicit no-retry glossary), truncation at both
caps, control-character stripping, unrecognized outcome (honest "not recognized" note instead of
passthrough).

Not covered here (deliberately): provider content SEMANTICS (the projection carries bytes, not
meaning — the model reads it, the gateway does not); the `prepared` body reaching a model (the
approval gate intercepts before dispatch; the projection still glosses it defensively).

## BEHAVIORAL_EVIDENCE (owed after deploy)

Owner re-test: ask PAIGE to run the same read-only contact lookup via the approval card. Expected
narration after this fix: PAIGE reports the lookup SUCCEEDED and shows the contact data the
provider returned — no "check before asking again."

## INTERNAL_BUILD_IDENTITY

Head of this changeset: `exp10-run-outcome-confirmation` off `origin/main` @ `1290a94602503646254b3edae9f085e0f847d6a6`
(exp10-consent-all-tools merge). Exact SHA recorded at PR merge.
