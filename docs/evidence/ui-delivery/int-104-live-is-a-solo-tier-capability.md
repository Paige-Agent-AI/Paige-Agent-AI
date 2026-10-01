# Live Conversation is a Solo tier capability, and the edge stopped overruling the database

Existing Project / R3 Deep, Flow-by-Flow 2.0.2. A capability ships for the whole shell — every Solo
account, resolving each authenticated person's own tenant, role, permissions, thread and memory. A
temporary rollout or privacy restriction is operational configuration: a flag, a setting, a gate. It
is never expressed in the product's identity or permission model.

## What was still wrong after the previous pass

`20270420000000` moved admission out of the identity model into `paige_live_pilot_subjects`. Its only
production writer is `authorize-live-pilot`, which admits **the authenticated operator themselves**,
and `is_platform_owner()` is satisfied by exactly one account. So the set of people who could ever be
admitted was still one login, and the table shipped empty. Measured on production 2026-09-24: 0
admitted subjects, 0 enabled workspaces, `pilot_enabled` false, against 10 Solo-class tenants. Zero
Solo users could use Live. The restriction had left the identity model and become an operator
hand-admission queue, which is the same framing one layer down.

## What changed

Eligibility becomes a question about the tenant's TIER, which every Solo account satisfies the moment
it is provisioned (`assert_canonical_solo_tenant` guarantees `account_type 'standalone'` and a null
parent). A MISSING `paige_live_tenant_availability` row now means "follow the scope" rather than
"refused" — requiring a row would have made every new signup wait for an operator, the same gate in a
third disguise. Who may speak today is ONE setting, `paige_voice_readiness.pilot_rollout_scope`,
naming no person, login or workspace, shipping `'off'`, where it refuses exactly who was refused
before. `paige-voice-profile-admin` gains one additive action to turn it, because a setting only an
engineer can change with raw SQL is not a setting the owner has.

## What the independent adversarial read found, which the build did not

All three admission edge functions read the availability row themselves and refused on a missing one
BEFORE consulting the predicate (`paige-live-session:89`, `paige-ai-chat:882`, `paige-live-relay:198`).
The change would have been inert in every product path — a brand-new Solo account refused one layer
above the fix. Those reads are removed; the predicate is the one home and honours both meanings of
that row. Also found and fixed: a delegated `platform_admin` could act-as into any customer's Solo
tenant and self-admit; closing the scope revoked every subject including ones the scope never carried,
which would have destroyed the operator's own admission on production; the global disable left the
audience open; acceptance could be looped to append unbounded audit rows; and one of the author's own
new assertions passed for the wrong reason.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Flow-by-Flow 2.0.2, Existing Project / R3 Deep; affected flow is "a Solo account reaches Live"; independent §39 peer-gate and §5 compliance review both run against the real pushed diff, with the peer-gate's F1 finding reproduced by the author before being acted on
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design/SKILL.md read; no new surface, control, copy or geometry — the only UI change is a tier-derived render gate on an existing control
MATERIAL_FLOW_CHANGE: NO: no goal, step, state, transition, confirmation, exit, recovery path or side effect changes for any person. The control's visibility now derives from getTierFeatureSet instead of being implied by which shell mounts it, and in production today that hides nothing: SoloEntry admits only the Solo tier and blocks render until the tenant resolves, so the gate is always true where the component mounts
FLOW_PROTOTYPE: NOT_REQUIRED: no screen, control or interaction is designed or altered; the change is a database predicate, three edge deletions and one render gate whose answer is invariant in production
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: any Solo account uses Talk live with Paige in their own workspace and their own thread; this change makes that structurally possible for all of them rather than one login
VISUAL_DIRECTION: PASS: zero DOM, theme, layout, geometry, focus or motion change; Impeccable 4.1.0 detector clean on every changed UI file
AUTOMATED_EVIDENCE: PASS: pgTAP grew 77 → 130 and the REAL suite executed end to end on a local PostgreSQL 16 — 130/130, plan matched, zero failures — rather than reasoned about; a separate 19-assertion behavioural run drives each peer-gate finding; 89 Live transport/boundary/client tests and 28 paige-voice-profile-admin handler tests pass UNMODIFIED, which is the §37 evidence that no consumer contract moved; 214 unit tests green across the affected surfaces; two mutation checks confirm the tier predicate is what discriminates and that the TS↔SQL parity pin goes red when the Enterprise divergence is reintroduced. The 130-assertion CI run is owed to this PR's database-contract job and is NOT claimed as already run
STATIC_EVIDENCE: PASS: tsc clean; lint:migration-versions, lint:definer-fns, lint:tier-features, lint:binding-ledger, lint:integration-registry, lint:release-governance, lint:pack-lineage, lint:operator-reach all pass; §50 trademark grep clean on the diff; service-role-only grants and REVOKE from PUBLIC/anon/authenticated preserved on every new function
RENDERED_EVIDENCE: UNVERIFIED: no fresh authenticated browser render; an unchanged shell does not substitute for proof
BEHAVIORAL_EVIDENCE: PASS: the real pgTAP suite and a 19-assertion peer-gate proof both executed against the actual migration on a local PostgreSQL 16 with a faithful role, grant and constraint posture. Real Solo speech remains UNVERIFIED and requires the rollout scope to be opened, which is an owner decision about provider retention and not an engineering step
AUTHENTICATED_RUNTIME: UNVERIFIED: this session has no browser-driving capability, so the deployed-surface check is owed to a capable session (§32). No provider call and no live conversation was performed
KEYBOARD_FOCUS: PASS: no control, tab order or focus behaviour changes; the gated control keeps its existing trigger and dialog semantics
ZOOM_REFLOW: UNVERIFIED: no geometry change; no fresh viewport capture
REDUCED_MOTION: PASS: no motion code touched
STATE_COVERAGE: PASS: refused at scope off, admitted at scope on with zero operator action, agency refused, sub-account refused, non-existent tenant refused, per-workspace kill switch overriding an open scope, enabled-outright admitting a workspace the tier refuses, act-as refused with the door shown open first, non-owner member admitted, idempotent re-acceptance, scope close withdrawing only what it carried, and global disable closing the audience are each asserted
TRUTHFUL_STATE_LABELS: PASS: no LIVE claim; default retention is an acceptance, verified zero retention remains UNAVAILABLE, speaker identity is not enforced (#1417), and no audience change is claimed
SOLO_UI: YES: the Solo Paige workspace's Live Conversation trigger
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no fresh render
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no fresh render
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no fresh render
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no fresh render
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no fresh render
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no fresh render
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no fresh render
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no fresh render
UNVERIFIED: the authenticated browser-driven check on the deployed surface; any real provider conversation; and the 130-assertion CI run, which is owed to this PR's database-contract job rather than claimed. NAMED GAP, not a limitation of the proof: nothing calls paige_live_accept_terms() yet, so opening the scope today still leaves a Solo user with no control to accept with — recorded in master §5 and tracked as the next slice

OWNER_INTENT: Live Conversation available to the Solo tier for all of its users, working for brand-new accounts the moment they sign up, with the current restriction enforced as configuration and the refusal proven
MUST_NOT_HAPPEN: An owner-only or named-account build; any request for an email or account identifier; a per-account row a new signup must wait for; self-enabled customer audio; a claim the provider gate opened; a claim of verified zero retention; a delegated platform_admin reaching a customer's live audio; the enabled-outright operator path being removed or silently broken
MUST_PRESERVE: Canonical standing resolution in its existing home; the caller-owned thread checks; the three admission consumers' contracts; active OpenAI read-aloud; platform-owned availability; super_admin-only rollout authority; and both meanings of the availability row. §58: no shipped capability is removed. The tier-matrix eligibility row narrows from ✓ to refused for Agency and Sub-account, which is called out explicitly in docs/doctrine/tier-matrix.md — nobody loses a working capability, because the admission row was — for every tier and production carries 0 admitted subjects
ACCEPTANCE_CRITERIA: A freshly provisioned Solo tenant with no availability row and no operator action is refused while the scope is off, and admitted the instant it is on; an agency and a sub-account are refused under the same open scope; a delegated platform_admin pointing their active workspace at a customer Solo tenant is refused; closing the scope leaves an enabled-outright admission untouched; the global disable closes the audience; and no admission consumer changes its request or response shape
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: Affected and tested: Live admission, rollout authority, tier feature derivation, canonical readiness and audit, account/workspace isolation, privacy acceptance, the three admission edge contracts. Unchanged: login and account choice, signup/paywall/billing/provisioning, action approval and autonomy, Spine tool execution, tool writes/readback/Rail/Memory, chat transcript and thread behaviour, Secure Browser and Vault, provider transport, durable jobs, shell geometry and accessibility
INTERNAL_BUILD_IDENTITY: pr=1439; base=2653cf82b8db2f53dd0feabca40c42841daefd3e; reviewed_head=the pushed head of pr-1439, recorded exactly in the post-merge closeout because a SHA written into the commit it names is invalidated by that commit; deployment=vercel-preview(pr-1439); environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=supabase/tests/paige_live_pilot_feature_guard.sql
RELEASE_CHANNEL: preview: the PR preview build only. Nothing is applied to production at the time of writing — migration 20270422000000 is unapplied and the three edge functions are undeployed, both of which land through CI on merge. A live read of xygzykjyynhzqytbqnzu on 2026-09-24 shows 0 subject rows, pilot_enabled false, 0 enabled workspaces and no pilot_rollout_scope column, so no audience exists to change
RELEASE_CLASSIFICATION: internal-only: an admission-contract repair, not a customer launch
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible outcome is ready to explain as one release, and there is still no control for a Solo user to accept with
RELEASE_NOTE_REQUIRED: no: no customer announcement
RELEASE_TRUTH_BOUNDARY: PARTIAL: eligibility is now a tier question and proven so in the database; provider-backed realtime audio, authenticated end-to-end conversation, any audience change, and a usable acceptance control all remain PROOF OWED
RELEASE_RECOVERY: position=set the rollout scope back to off, which withdraws only what the scope carried and leaves the enabled-outright operator admission intact, with the platform-owner disable-live-pilot remaining the stop-everything lever that now closes the audience with it; reference=the rollback comment at the head of supabase/migrations/20270422000000_live_conversation_is_a_solo_tier_capability.sql, preserving audit history, schema and active read-aloud

## Scope and collisions

- Classification: Existing Project / R3 Deep. Security, permissions and persistence all in scope.
- Affected flows: a Solo account reaching Live; an operator opening or closing the audience; a subject accepting terms for themselves.
- Neighboring regressions: the two Live smoke suites pinned the removed edge gate by source text and were repointed at the real one, including an assertion that no second availability gate may reappear beside the predicate.
- Active-owner/file collisions: none. Base `2653cf82b8db2f53dd0feabca40c42841daefd3e` at time of branch; the migration was renumbered 20270421000000 → 20270422000000 after #1394 took the earlier version, caught by the collision lint rather than by CI.
- Explicit exclusions: no acceptance surface is built here; no scope is opened; no provider contact.

## User job and state map

A Solo operator wants to speak with Paige about their own book. The entry point is the existing
Talk live with Paige control in the Solo Paige workspace. Its visibility derives from
`getTierFeatureSet`; its permission is decided server-side, independently, by
`paige_live_pilot_authorized_internal`. Every refusal renders the existing honest unavailable state
with the same explanation text, so no new state was introduced and none was removed.

## Evidence index

- `supabase/tests/paige_live_pilot_feature_guard.sql` — 130 assertions; run locally on PostgreSQL 16.13 against the real migration, 130/130, plan matched.
- Local behavioural run, 19 assertions, one per peer-gate finding, plus a mutation check on the tier predicate.
- `npx vitest run` across the affected surfaces — 19 files, 214 tests, all passing.
- `npm run smoke:live-relay` (34 assertions), `smoke:live-ticket`, `smoke:live-relay-bridge` (102 assertions) — all passing after being repointed.
- Production reads on `xygzykjyynhzqytbqnzu`, 2026-09-24: 0 admitted subjects, 0 enabled workspaces, `pilot_enabled` false, 10 Solo-class tenants, 0 enterprise tenants, latest applied migration 20270420000000.

## Review and limitations

The §39 peer-gate found the change was inert in every product path, which the build had not; that is
recorded here because it is the substance of the PR rather than a footnote. The §5 compliance pass
found the documentation was the failure while the engineering was sound, and its required ledger,
master-reference and brain updates ship in the same commit. Remaining limitations are the
`UNVERIFIED` items above, chief among them that no surface calls `paige_live_accept_terms()` yet.
