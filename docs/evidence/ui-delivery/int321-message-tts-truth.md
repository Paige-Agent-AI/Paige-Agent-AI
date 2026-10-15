# UI delivery evidence: int321-message-tts-truth — "Play message aloud" names the limit that actually refused it

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: pre-edit packet in the INT-321 session — actor = a workspace member pressing "Play message aloud" on a Paige message; goal = hear it, or be told truthfully why not; flows traced end to end (reserve_paige_voice_cost_internal → paige-tts → MessageAudioButton/classifyTtsFailure → toast or disabled state); depth Standard; ownership = paige-tts refusal branch, the reservation function body, and the client classifier only; Live Conversation untouched (it never calls the reservation).
PAIGE_UI_DESIGN: PASS: router skill read this session; no visual change — the existing ghost Volume2 button, disabled state, and sonner toasts are reused unchanged; only the words in the failure states and which state a refusal reaches change.
MATERIAL_FLOW_CHANGE: YES: the failure exits of message playback now land on distinct, truthful states — workspace allowance (with the proven reset day), platform cap, emergency brake, not-configured (button disables), and a plain retry — where every reservation refusal and every bare 503 previously read "temporarily paused". Declared copy change on a path not named in the defect: a cost-settlement failure (`tts_cost_settlement_unavailable`, 503) previously reached "Voice playback is temporarily paused…" through the old bare-503 catch-all and now reads the retry copy "Voice playback didn't start. Please try again." Declared behaviour change: a failed voice-profile resolve or a profile-revision race no longer disables the button for the session (see "Voice-profile handling" below).
FLOW_PROTOTYPE: PASS: the owner's INT-321 ruling (2026-10-05, reproduced on prod) specifies the target state map and the workspace-allowance copy verbatim ("Voice playback has reached this workspace's monthly allowance." + "It resets November 1."); the platform-cap ("temporarily unavailable") and emergency ("paused right now") wording follows that ruling's allowance for temporary-unavailability copy and is listed below for the owner's live review per §4.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience = any workspace member in Paige chat; primary action = play a message aloud; on refusal, understand whether it is this workspace's monthly allowance (and when it resets), a platform-wide condition, or something to simply retry.
VISUAL_DIRECTION: PASS: unchanged shipped control and toast system; no tokens, layout, or motion touched.
AUTOMATED_EVIDENCE: PASS: vitest src/lib/voice + src/components/chat + paige-live-provider-boundary + the new src/__tests__/paige-tts-cost-refusal.test.ts — 16 files / 171 tests pass (base 15 files / 134 tests at 862100fa9). Mutation table, first pass: 12 mutations (tenant+platform collapsed to one generic 503; classify by SQLSTATE 54000 alone; platform mapped to tenant; reset accepted without the month-after check; client bare-503 catch-all restored; tenant code moved into the platform state; emergency folded into platform; generic code back to paused; edge refusal falls through to the next attempt; edge hard-codes the old generic 503; migration DETAIL dropped; migration emergency identity removed) — all 12 KILLED. Review-fix pass: 10 more — client puts voice_profile_unavailable back in not-configured; reserve-time PAIGE_VOICE_PROFILE_UNAVAILABLE mapped back to tts_not_configured; every resolver error treated as configuration; edge profile branch hard-codes its code; body builder leaks the identity; edge bypasses the body builder with a hand-built body; resets_at regex unanchored at the end; at the start; budget_month regex unanchored at the end; reset date formatted without timeZone "UTC" (the test pins America/Los_Angeles and asserts the zone took effect) — all 10 KILLED. pgTAP supabase/tests/paige_voice_budget_control.sql extended 48 → 53 assertions (emergency identity, switched-off identity, tenant + platform DETAIL, SECURITY DEFINER kept, search_path=public kept) — runs in CI's paige-spine-contract job; not run locally (pgTAP absent from the scratch cluster).
STATIC_EVIDENCE: PASS: npm run ci:tsc baseline 10 = current 10; lint:definer-fns and lint:managed-schema clean; git diff --check clean; deno check paige-tts shows the same 5 pre-existing errors before and after (meterChars client typing, Uint8Array BodyInit), none in changed lines; deno check _shared/voice-cost-refusal.ts clean; eslint clean on every changed src and edge file; migration body diffed against 20270424000000 section 5 — only the intended DETAIL, emergency, and _limit_detail lines differ.
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered markup, layout, or styling changed; the strings appear in the existing toast and tooltip, and their exact text is asserted by tests.
BEHAVIORAL_EVIDENCE: PASS: jsdom drive of MessageAudioButton — a 429 tts_tenant_cost_limit response with reset_at reaches toast.message as "…monthly allowance. It resets November 1." with no error toast; a bare 503 reaches the retry copy, never "paused"; platform cap, emergency, and the generic code each reach their own toast. Throwaway PostgreSQL 16 cluster (stub schema, scratch harness): old body vs new migration on identical fixtures — exact-cap success, idempotent replay, idempotency mismatch, tenant over-cap, platform over-cap, usage counters (0.60/0.30/0.90, 2 reservation rows) and non-service refusal identical; new body adds DETAIL {"resets_at": "2026-11-01T00:00:00Z", "budget_month": "2026-10-01"} to both caps and raises PAIGE_VOICE_EMERGENCY_DISABLED for the brake while a switched-off budget still raises PAIGE_VOICE_BUDGET_DISABLED; the migration's own grant assertion passed and ACL stayed {postgres=X, service_role=X}. Review-fix pass: the migration's closing block now also asserts prosecdef and proconfig ⊇ {search_path=public}; re-applied on the same cluster it passed (readback t | {search_path=public}), and two mutated copies — SET search_path dropped, SECURITY INVOKER — each failed that closing check. Policy migration 20270581010000 (below) on the same cluster: default 10 → 40 with platform cap, rate, enabled and emergency flags unchanged; an enabled override equal to the new default removed and audited; a different override ($25), a switch-off (enabled=false) and a $10 override kept; a re-run changes nothing; a starting default of $50 is not lowered; mutants that skip the delete or raise only to $30 fail the closing assertion.
AUTHENTICATED_RUNTIME: UNVERIFIED: no browser-driving capability or test credentials in this session; the deployed edge + migration have not been exercised against the exhausted workspace. Owed: with the allowance now $40 that workspace is no longer exhausted, so the live allowance-copy check needs a workspace that has actually reached its allowance (or a test tenant with a small explicit override); confirm the copy with "It resets November 1."
KEYBOARD_FOCUS: NOT_APPLICABLE: no focusable element added, removed, or reordered.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change; toast copy length is comparable to the prior string.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: success (audio, unchanged), cache hit (unchanged, precedes reservation), workspace allowance with and without a proven reset, platform cap, emergency brake, workspace voice switched off / platform budget unconfigured / resolver-proven no usable profile (not-configured, button disables), resolver call failure and profile-revision race (retry, button stays enabled), pending/ambiguous (unchanged), an unrecognised refusal and a bare 503 (retry), settlement failure (server code unchanged; visible copy changed from "temporarily paused" to the retry copy).
TRUTHFUL_STATE_LABELS: PASS: a reset date is shown only when the canonical function supplied it and it is exactly the first instant after the budget month; nothing names a provider, a SQLSTATE, or a database identity; no budget value was changed.
SOLO_UI: NO: no recognized Solo UI path changed — only src/lib/voice (non-UI path), a test, the paige-tts edge function, and a migration; the copy surfaces in the shared chat message control.
UNVERIFIED: authenticated live playback against the exhausted workspace after deploy; the pgTAP file itself (CI runs it); persisted-apply proof of 20270581000000 and 20270581010000 on prod (deploy-migrations pipeline, §32); that production has no enabled override below $40.

OWNER_INTENT: Antonio, INT-321 (2026-10-05): a workspace that used its own monthly voice allowance must be told exactly that — with the true reset date when provable — never "Voice playback is temporarily paused"; tenant cap, platform cap, emergency brake, not-configured, and pending stay distinct end to end.
MUST_NOT_HAPPEN: the defect fix raises no budget ($100 platform cap and $0.30/1,000-char ceiling untouched; the default tenant allowance moves $10 → $40 only by the owner's separate policy ruling and its own migration, 20270581010000); no guard disabled, bypassed, or routed around by a provider switch or fallback; no raw database text in the browser; no reset date the runtime cannot prove; no unrelated failure rendered as "platform paused".
MUST_PRESERVE: atomic reservation, lock order, exact-cap behavior, idempotency, settlement and release semantics; cache lookup before reservation and zero-cost cache hits; tts_not_configured disabled state; pending semantics; Live Conversation behavior.
ACCEPTANCE_CRITERIA: (1) tenant exhausted → tts_tenant_cost_limit; (2) not platform_paused; (3) workspace-allowance copy; (4) correct reset date when returned; (5) platform cap → its own state; (6) emergency distinct; (7) not-configured distinct; (8) successful playback still returns audio; (9) cache unchanged; (10) reservation/idempotency intact; (11) no fallback bypasses the budget; (12) collapsing tenant and platform into one generic 503 fails a test.
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: impacted and tested — reserve_paige_voice_cost_internal (pgTAP + PG16 harness parity), paige-tts refusal branch (structural tests + mutations), classifyTtsFailure and MessageAudioButton delivery (unit + jsdom). The paige-tts handling of a resolve_paige_voice_profile_internal failure is impacted and tested (unit + structural + jsdom needsConfig assertion); the resolver function itself is unchanged. Unaffected and named — settle_paige_voice_cost_internal, the tts-cache bucket path, platform_usage_events metering, paige-live-session/relay (no reservation call), Studio narration.

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: f8a227b60ae0abb2e5da1c9a169fdef46f407349; deployment=none-pre-merge (base main commit; the PR head carries this change); environment=development; migrations=PROOF_OWED(20270581000000_paige_voice_cost_refusal_identity and 20270581010000_paige_voice_tenant_default_40 apply via deploy-migrations on merge then schema_migrations readback); edge=PROOF_OWED(paige-tts redeploys via deploy-edge-functions on merge); evidence=docs/evidence/ui-delivery/int321-message-tts-truth.md and the PR checks
RELEASE_CHANNEL: development: base commit plus uncommitted worktree changes; merge and deploy follow CI per §4
RELEASE_CLASSIFICATION: patch: defect fix — truthful failure states for message playback; no new capability, no price or limit change
CUSTOMER_RELEASE_IDENTITY: none: pre-launch defect fix with no customer release record
RELEASE_NOTE_REQUIRED: NO: internal defect fix before public launch
RELEASE_TRUTH_BOUNDARY: PARTIAL: classification, copy, and migration proven by unit, structural, mutation, and local PG16 parity evidence; deployed edge, persisted migration, and authenticated playback are PROOF OWED
RELEASE_RECOVERY: position=revert the merge and let CI redeploy the prior paige-tts — the migration is a body-only CREATE OR REPLACE whose MESSAGE and ERRCODE are unchanged so the prior edge reads it safely, and the prior body can be restored from 20270424000000 section 5 by a forward migration; reference=supabase/migrations/20270581000000_paige_voice_cost_refusal_identity.sql

## Scope and collisions

- Classification: defect slice on the one message-playback path; extends the existing reservation function and classifier, no new surface (§18).
- Affected flows: "Play message aloud" failure exits only.
- Neighboring regressions: Live Conversation never calls reserve_paige_voice_cost_internal (grep of supabase/functions: paige-tts is the sole caller), and no edge function matches on PAIGE_VOICE_* refusal text.
- Active-owner/file collisions: none found on paige-tts, messageTtsFailure, or the reservation function.
- Explicit exclusions: no budget change, no provider change, no Live Conversation change, no visual redesign.

## User job and state map

| Refusal identity (server) | paige-tts code / status | Owner sees |
|---|---|---|
| PAIGE_VOICE_TENANT_COST_LIMIT (+ DETAIL reset) | tts_tenant_cost_limit / 429 (+ reset_at) | "Voice playback has reached this workspace's monthly allowance. It resets November 1." (no date when unproven) |
| PAIGE_VOICE_PLATFORM_COST_LIMIT | tts_platform_cost_limit / 503 | "Voice playback is temporarily unavailable. Please try again later." |
| PAIGE_VOICE_EMERGENCY_DISABLED | tts_emergency_disabled / 503 | "Voice playback is paused right now. Please try again later." |
| PAIGE_VOICE_TENANT_BUDGET_DISABLED | tts_workspace_voice_disabled / 503 | button disables: "Voice playback isn't available for this workspace" |
| PAIGE_VOICE_BUDGET_DISABLED | tts_not_configured / 503 | same disabled state |
| PAIGE_VOICE_PROFILE_UNAVAILABLE at reserve time | tts_voice_profile_changed / 503 | "Voice playback didn't start. Please try again." (button stays enabled) |
| anything else, or no reservation id | tts_cost_limit_unavailable / 503 | "Voice playback didn't start. Please try again." |
| settlement fails after audio was produced | tts_cost_settlement_unavailable / 503 (unchanged) | "Voice playback didn't start. Please try again." (was "temporarily paused") |

| Profile resolve (before any reservation) | paige-tts code / status | Owner sees |
|---|---|---|
| resolver raised PAIGE_VOICE_PROFILE_UNAVAILABLE (no approved, active, effective profile), or returned one this edge cannot use | tts_not_configured / 503 (was voice_profile_unavailable) | button disables — same visible state as before |
| resolver call failed (network, PostgREST, permission) or returned nothing | voice_profile_unavailable / 503 | "Voice playback didn't start. Please try again." (was: button disabled for the session) |

## Voice-profile handling (review fix F1)

The not-configured state is sticky: `messageTts` sets `needsConfig` and every play button in the session disables until reload. Before this fix, two transient conditions reached it — a resolver call that simply failed (`voice_profile_unavailable`) and a reservation that saw a different revision than the one resolved a moment earlier (`PAIGE_VOICE_PROFILE_UNAVAILABLE` at reserve, previously mapped to `tts_not_configured`). Now:
- The edge distinguishes the two resolver outcomes cheaply: the resolver raises the identity `PAIGE_VOICE_PROFILE_UNAVAILABLE` only when it has proved there is no approved, active, effective profile, so that message → `tts_not_configured`; any other error, or no error and no profile → `voice_profile_unavailable`, which the client treats as retryable.
- The reservation's `PAIGE_VOICE_PROFILE_UNAVAILABLE` → `tts_voice_profile_changed` (retryable). If the profile is genuinely gone, the next tap's resolver says so and the button then disables.
- Edge case named, not fixed: a profile revision staged with a future `effective_at` makes the resolver raise the configuration identity, so the button disables until reload even though it will become available on its own.

## Retry and the cap after a settlement failure

When settlement fails, the reservation stays counted (fail closed) and the owner now sees the retry copy. Pressing play again mints a new request id and reserves again — so a retry after a settlement failure over-counts spend against the allowance by one reservation. It can never exceed the cap: the second reservation goes through the same guarded month buckets and is refused at the cap like any other.

## Fresh environments

The budget tables' column defaults are `enabled=false, emergency_disabled=true`. An environment where only the table-creating migration has run would therefore refuse with `PAIGE_VOICE_EMERGENCY_DISABLED` and show "Voice playback is paused right now" — truthful for that row, but not a production state. Migration 20270424000000 turns the budget on (enabled, emergency off), and production reads `emergency_disabled=false`.

## Owner ruling folded in: every Solo at $40 (policy, not this defect fix)

Antonio, 2026-10-05: every Solo workspace's monthly message-playback allowance is $40 — "move every Solo to the 40 dollar limit"; "if you do it to mine, do it to every last one of them"; "I do not want anything done specific to mine." This raises the inherited default from $10 to $40. It is a policy change made alongside INT-321, not part of the defect fix: the fix changes no limit, and the copy above is the same at any allowance.
- Production already holds `default_tenant_monthly_limit_usd = 40` (written by service SQL with audit rows, per the coordinator) plus one leftover enabled override at $40 that repeats the default.
- Migration `20270581010000_paige_voice_tenant_default_40.sql` makes the repo agree: raises the default to $40 where it is below (GREATEST, idempotent, never lowers), deletes enabled overrides equal to the default (generic, no workspace named, §63), writes a `paige_audit_log` row per change attributed to the migration, and asserts the end state. The $100 platform cap, the $0.30/1,000-char ceiling, and the enabled/emergency flags are untouched.
- Not covered, named for the owner: an enabled override BELOW $40 (for example one left at the old $10 default) is kept by this migration and would hold that workspace below $40. Production reportedly has none; that was not verified from this session.

Deploy order is safe both ways: before the migration the function carries no DETAIL (no date shown) and the emergency brake still raises PAIGE_VOICE_BUDGET_DISABLED (shown as not-configured, never "paused"); production has emergency_disabled=false.

## Evidence index

- Base measurements at 862100fa9 in this worktree before any edit: vitest 15 files / 134 tests; ci:tsc 10; deno check paige-tts 5 errors.
- After (review-fix pass): vitest 16 files / 171 tests; ci:tsc 10; deno check paige-tts 5 (same pre-existing errors, none in changed lines); deno check _shared/voice-cost-refusal.ts clean; eslint clean.
- Production read-only (2026-10-05): the live function body matches 20270424000000 section 5; ACL {postgres=X, service_role=X}; latest applied migration 20270566000000.

## Review and limitations

Implementer evidence only; an independent adversarial read of the diff (§39) is owed before merge. Authenticated runtime, the CI pgTAP run, and the persisted migration are owed as listed above.
