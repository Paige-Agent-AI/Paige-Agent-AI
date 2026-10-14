# Marketing slices 3–6 (and 7a) — §32.c authenticated acceptance package

Date: 2026-10-12 · Linear: ANT-87 (ANT-15, P-ANT-5) · Source: MBC 3 #1963, 4a #1966, 5 #2018, 6a #2038, 6b #2045,
6c #2050, 7a #2064. Matrix: `docs/product/int342-marketing-convergence.md` §N.

**Status: PREPARED, NOT EXECUTED.**
- No signed-in run has happened and no fixture exists.
- This file says what to run, what counts as a pass, and what is already proven without a sign-in.
- **Anything unavailable is recorded as unavailable, never passed.**

## Identity — the one canonical account (ANT-21; do not create others)

- **The account:** PC-1 QA Shared Synthetic, the one owner-approved shared SOLO testing account in ANT-21.
  - Its identifiers stay in ANT-21. Below, `:qa_user` and `:qa_workspace` stand for them.
  - No other test account is created for this package.
- **The temporary member (C):** the one temporary member Auth administrators invite through the product for the Ads
  package's C1 may be reused, if it still exists and the owner agrees. Otherwise the member flows are unavailable
  until one exists. No new account is made here.
- **Credentials:** installed privately by Auth administrators as runner environment variables (`LIVE_DRIVE_EMAIL` /
  `LIVE_DRIVE_PASSWORD`), never printed, logged or screenshotted. Or a handed-over signed-in session
  (`storageState`, `scripts/live-drive/live-drive.mjs`).
- **State on 2026-10-12, read-only:**
  - The workspace is `active`, `standalone`, not paused, not archived, and has one member: its owner.
  - It has 0 campaign briefs, 0 steps, 0 forms, 0 pages, 0 submissions, 0 processes, 0 pipelines and 0 Autonomy
    overrides.
- **Boundaries:** no ad spend, no provider send or publication, no customer data, no change to INT-346 admission,
  and no process switched live.

## Evidence ledger 1 — database-level, rolled back (2026-10-12)

Production database, as `:qa_user`'s claims with `set local role authenticated` (or `anon`). Everything ran
inside `begin … rollback` and nothing persisted. **Evidence class: database-level, simulated session — not
authenticated runtime.**

| Probe | Result |
|---|---|
| Who the canonical user resolves to | `current_user_tenant_id()` = `:qa_workspace`; `is_tenant_admin` = true |
| `read_campaign_steps`, own workspace | `can_manage: true`, 0 campaigns |
| `read_campaign_steps` naming another workspace | `22023 active_account_changed` (refused, never read) |
| `read_campaign_steps` as `anon` | `42501 permission denied for function read_campaign_steps` |
| Campaigns rows in Autonomy settings | ten rows, every one `confirm` by default, including `campaign_step_plan`, `campaign_step_record_result`, `campaign_step_judge` and `process_scope_set` |
| `growth_public_visits` as `anon` (after 7a's release) | `42501 permission denied for table growth_public_visits`; calling `growth_public_visit_record` and `growth_funnel_session_upsert` as `anon` also `42501` |

## What is unavailable today, and must be reported as unavailable

| Act | Why | Owner of the unblock |
|---|---|---|
| Plan, record or judge **through PAIGE in typed chat** | While INT-346 is DRAINING (production `paige_chat_interactive_protocol` = version 2, `active: false` on 2026-10-12), every typed Solo turn runs with no tools. PAIGE answers but cannot act | Conversational Loop (INT-346); owner-reserved |
| Confirm a PAIGE write **by voice in Live** | The Live relay never executes a spoken approval; a write is confirmed on its card, never by a spoken yes | By design (modality neutrality) |
| **Bring a planned step to approval, then completion** | A planned step reaches approval only when the bus prepares it (`advance_action` to `drafted`). The worker never drafts this record-only kind, and `action_advance` is a team tool. So a Solo owner can plan a step but has no product path to approve it, or to record or judge its result (those need a proven finish) | Marketing (matrix §N3, item 5) |
| Link an existing action, or change a step's dependency | No screen or chat tool sends these (§N3, items 1–2) | Marketing |
| A member seeing a step's title | Withheld by the read policy; not widened (§N3, item 3) | Owner decision |
| Switch a process on | No screen does it and chat refuses it (§N3, item 4). The run must never do it | Marketing, after an owner-approved design |

So **B4–B6 (approval, result, judgement) can be driven only on a step that already reached a proven finish**,
and nothing in the product makes one today. Report them **UNAVAILABLE** unless item 5 has shipped by the time of the
run. Never create one through service-role access to manufacture the case.

## Runner runbook — fixtures (canonical owner, signed in, Solo)

1. **Brief:** Marketing › Campaigns → **Create campaign brief** → Campaign name `QA Spring` and an objective → save.
   The builder has no reference field: the server makes the reference itself (`CB-` and six characters).
   Readback: one `campaign_briefs` row named `QA Spring`. Record its `short_ref`; run D uses it as `:qa_ref`, because
   a link's `utm_campaign` is attributed to a campaign by that reference.
2. **Form:** Marketing → Vibe Studio → "A short lead form named QA synthetic lead form asking for name and email" →
   **Build it** → **Publish** → **Publish now**.
   - If the Ads package already created this form in the same account, reuse it.
   - Readback: one `active` form.
3. **Uses:** in the `QA Spring` dossier, **What this campaign uses** → add the form. Readback: one
   `campaign_brief_asset_links` row.
4. **Process (draft only):** a form-started process exists only if one is created through the product. If none can
   be, the process steps below are **UNAVAILABLE**. Never switch one on.

## Acceptance run

Record for each step: the date and time, the actor, what was done or the PAIGE reply, a screenshot, and the readback
query result. Evidence ledger 2 holds one row per executed step.

### A. Owner, Campaigns dossier

| # | Do | Pass when |
|---|---|---|
| A1 | Open `QA Spring` → **Steps and results** | "No steps planned yet."; **Plan a step** visible |
| A2 | Plan a step: kind Email, tactic `Win-back`, step `Thank everyone who booked`, aim `Ten replies`, due a week out | The step appears under its tactic, **Planned**, aim and due day as entered (in the browser's own time zone); one `paige_actions` row of kind `marketing.campaign_action`, lane `confirm`; one `campaign_brief_actions` row; one `audit_logs` row recording the step as planned (a step planned from the dossier is recorded there; the "PAIGE planned a campaign step" receipt is for steps PAIGE plans, B3) |
| A3 | Reload | Same step, same state |
| A4 | Remove the step after its confirmation | The link is gone and the action itself is unchanged. Record the warning's exact words: for a planned step it says the action "will still come to you for approval", which is **not true today** (matrix §N3, item 5). Record it as a finding; it does not pass |

### B. Owner, PAIGE

| # | Do | Pass when |
|---|---|---|
| B1 | Typed chat: "What steps does QA Spring have?" | Today **UNAVAILABLE** (no tools on a typed turn). Record the reply: PAIGE must not claim to have read them |
| B2 | Live: the same question | PAIGE reads the steps (or says it cannot); nothing invented. Record whether Live admitted the tool |
| B3 | Live: "Plan a step for QA Spring: email, win-back, thank everyone who booked" | An approval card; nothing filed until it is approved on the card; **a spoken yes does nothing**; after the card is approved, one step filed and read back; one receipt "PAIGE planned a campaign step". Record the card's and PAIGE's exact words: they say the step "comes to you for approval once it is prepared", which is **not true today** (matrix §N3, item 5). Record that as a finding, never as part of the pass |
| B4–B6 | Approve a prepared step, record its result ("twelve replies"), judge it ("met") | **UNAVAILABLE** (see above) unless §N3 item 5 has shipped |

### C. Member and foreign workspace

| # | Do | Pass when |
|---|---|---|
| C1 | As the temporary member, open `QA Spring` | States and aims visible, **no titles**, no Plan, Remove, record or judge controls |
| C2 | As the member, ask PAIGE (Live) to plan a step | Refused (owner or admin only), nothing filed |
| C3 | Foreign workspace | Database-level only (ledger 1); never driven against another business's records |

### D. Form → visit → submission → process

**Run D needs a real browser.** `growth-public-visit` refuses an automation user agent (headless, Playwright,
Puppeteer, Selenium and the like) as `automated_agent`, and the browser records nothing while a Paige session exists.
So `scripts/live-drive/live-drive.mjs` (Playwright) cannot record a visit, and neither can a context left signed in
from runs A–C. Use a person in an ordinary headed browser, signed out. **Never spoof a user agent to get a pass.** If
no such browser is available, D1–D3 are **UNAVAILABLE**. The refusals themselves were already proven on production
(matrix §N4).

| # | Do | Pass when |
|---|---|---|
| D1 | Signed out, in a **headed, ordinary browser** (no Do Not Track or Global Privacy Control), **in a fresh browser context that has never signed in to Paige**, open `/form/<form id>?utm_source=qa&utm_campaign=:qa_ref` | One `growth_public_visits` row for `:qa_workspace`, `target_kind = 'form'`, `utm_json->>'utm_source' = 'qa'`; the table has no IP or user-agent column |
| D2 | Reload within 30 minutes | Still one visit (continued, `last_seen_at` moved) |
| D3 | Submit `QA Lead One` / `qa-lead-1@tests.invalid` | One submission with `visit_id` = that visit; one `form.submitted` event; the Overview and Analytics lead counts include it |
| D4 | The same with Global Privacy Control on | No visit row; the submission is still saved, with `visit_id` null |
| D5 | A draft process scoped to this form (if one exists) | It matches the event once and stays a draft; **UNAVAILABLE** if no process can be made through the product. Never switch one on |
| D6 | Paused account refusal | Database-level only; pausing the canonical workspace is an owner action and is not done for this run |

## Evidence ledger 2 — signed-in runner results

(empty; one row per executed step: date/time, actor, action or PAIGE reply, screenshot, readback)

## Clean-up

The brief, its step history, the form, the visit and the submission and its contact stay in the canonical workspace,
labelled synthetic, as the Ads package's fixtures do, unless the owner rules otherwise. Their ids are registered in
ANT-21. The temporary member's access is revoked after the run and the revocation is verified.
