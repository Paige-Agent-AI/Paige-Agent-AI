# Live Conversation is one shared capability; the rollout restriction is configuration

Existing Project / R3 Deep, Flow-by-Flow 2.0.2. PaigeAgent AI is a multi-tenant CRM, so a capability
ships for the whole shell — every Solo account, resolving each authenticated person's own tenant,
role, permissions, thread and memory. A temporary pilot or privacy restriction is operational
configuration: a flag, an allowlist, a gate. It is never expressed in the product's identity or
permission model.

## What was wrong
`20270412000000_paige_live_scoped_pilot_authorization.sql:77-80` bound Live admission to a SINGLETON
`paige_voice_readiness` row and required `r.pilot_actor_user_id = _actor_user_id` **and**
`r.pilot_authorized_by = _actor_user_id` **and** `public.is_platform_owner(r.pilot_authorized_by)`.
The writer set both columns from the same actor (`:173-176`). So the speaker had to be one stored
user id who also held `super_admin`, and any other Solo account was structurally incapable of Live
however correct its standing — while the three callers resolved standing correctly all along
(`paige-live-session` through `current_user_tenant_id()` and a caller-owned `paige_chat_threads`
read; `paige-live-relay` through `hasLiveWorkspaceStanding`; `paige-ai-chat` through the signed
runtime scope). The restriction was real. Where it was written was the defect.

The 39-assertion suite passed throughout, because it asserted the restriction. Nothing drove a
different active member of the same enabled workspace, so "only one person can use this" and "the
rule works" were the same observation.

## What changed
`20270420000000_paige_live_rollout_is_configuration.sql` adds
`public.paige_live_pilot_subjects` — a platform-owned, service-role-only rollout allowlist with the
same posture as the existing `paige_live_tenant_availability` (RLS on, no anon/authenticated policy,
missing row refuses, ships empty, no tenant or account seeded). Admission becomes a configuration
question: is this subject admitted, unexpired and unrevoked; is Live switched on for this workspace;
is the rollout envelope open; is the provider proof intact. Product eligibility is NOT re-resolved
here — a second identity resolver would narrow the agency-managed and operator standing that
`current_user_tenant_id()` grants.

Each row carries its OWN acceptance and a `CHECK (acceptance_actor_user_id = user_id)`, so one
subject's consent can never stand as another's authorization, and no account identifier is read from
or typed into any request: the subject is the authenticated actor of the call that admits them.
`expires_at` gives the admission a lifetime (§68), so a stale row lapses instead of lingering.
Disabling withdraws every admitted subject, so re-enabling cannot revive a stale acceptance as fresh
authorization.

Both function signatures are preserved by `CREATE OR REPLACE` at the identical argument list and
parameter names, so all four deployed consumers are byte-for-byte unchanged and nothing redeploys.
An additive sixth parameter was rejected deliberately: it would leave two candidates for the
existing five-key PostgREST body and break `paige-voice-profile-admin` on ambiguous resolution.

## What did NOT change, stated plainly
Broadening the product does not broaden who may speak. The provider gate stays shut. Default
provider retention remains an acceptance, not verified zero retention, which stays `UNAVAILABLE`.
Physical speaker identity is still not enforced and remains open as #1417. No account was admitted,
no rollout was enabled, and no provider call was made by this change. Assuming the restriction has
lifted because the build is multi-tenant is the same error in the other direction.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Flow-by-Flow 2.0.2, Existing Project / R3 Deep; identity-versus-configuration separation with independent producer, security and compliance review
PAIGE_UI_DESIGN: PASS: Existing approved Live stage, controls and unavailable state reused; no frontend, layout or copy change
MATERIAL_FLOW_CHANGE: YES: Live admission stops being an identity predicate and becomes a rollout-configuration predicate
FLOW_PROTOTYPE: PASS: Existing owner-approved Organic Paige Presence and Real Audio Recovery flow in paige-live-conversation-mvp.md; no new screen, control or interaction design
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Any Solo account admitted by rollout configuration uses Talk live in their own workspace and their own thread
VISUAL_DIRECTION: PASS: No DOM, theme, layout, geometry, focus, motion or control change; this change touches zero TypeScript
AUTOMATED_EVIDENCE: PASS: 36/36 existing Edge handler and provider-boundary tests pass UNCHANGED, which is itself the §37 evidence that no consumer contract moved; the relay ticket smoke that pins the RPC call shape across all three consumers passes; the pgTAP matrix at 72 assertions RAN and PASSED in the exact-head database-contract CI job on head bcaf36a (Files=1, Tests=72, Result: PASS) against a schema replayed from zero; an independent adversarial read then found the forged-receipt negative could not fail, so that assertion was rebuilt and the matrix is now 77 — the 77-assertion run is owed to the next CI execution and is NOT claimed as run
STATIC_EVIDENCE: PASS: definer-fn lint passes; migration-version collision lint does not flag 20270420000000; service-role-only grants and REVOKE from PUBLIC/anon/authenticated preserved on both functions and the new table
RENDERED_EVIDENCE: UNVERIFIED: No fresh authenticated browser render; an unchanged shell does not substitute for proof
BEHAVIORAL_EVIDENCE: PASS: 28/28 assertions against the actual migration file on a local PostgreSQL 16 development harness with a faithful role and grant posture, covering the negative proof, expiry, per-subject withdrawal and disable-withdraws-everyone, plus a mutation check proving the rebuilt forged-receipt assertion discriminates (a predicate keyed to the subject IS admitted by the forgery; this one refuses). That harness is uncommitted scaffolding, so it is reproducible only from this record's description, and the CI pgTAP run above is the durable proof. Real Solo speech remains UNVERIFIED and requires operational authorization after deployment
AUTHENTICATED_RUNTIME: UNVERIFIED: No pilot authorization, no provider call and no live conversation performed by this change. Post-merge production reads confirm the schema and the empty rollout state only; they are not runtime proof of a conversation
KEYBOARD_FOCUS: PASS: Existing controls and focus behavior unchanged by a database-only change
ZOOM_REFLOW: UNVERIFIED: No geometry change; no fresh viewport capture
REDUCED_MOTION: PASS: No motion code change
STATE_COVERAGE: PASS: Admitted, not admitted, lapsed, withdrawn, disabled, wrong workspace, non-owner authorship, forged receipt and inherited consent are each asserted; the negative subject is a genuine active member of a genuinely enabled workspace with the positive passing one line above
TRUTHFUL_STATE_LABELS: PASS: No LIVE claim; default retention is an acceptance, zero retention remains UNAVAILABLE, speaker identity is not enforced, and no audience change is claimed
SOLO_UI: YES: Existing Solo Paige Live Conversation stage
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: No fresh render
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: No fresh render
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: No fresh render
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: No fresh render
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: No fresh render
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: No fresh render
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: No fresh render
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: No fresh render
UNVERIFIED: authenticated provider and conversation proof and any real pilot authorization remain required. RESOLVED since first writing: the 77-assertion suite ran and passed in CI (Files=1, Tests=77, Result: PASS) and the migration is confirmed persisted on production with its objects present. Formerly owed and now closed: authenticated provider and conversation proof, and any real pilot authorization all remain required. The 72-assertion count passed CI; the five assertions added after that run have not.

OWNER_INTENT: One shared Live Conversation capability for all Solo accounts on each person's own tenant, role, permissions, thread and memory, with the current restriction enforced as configuration and the refusal proven
MUST_NOT_HAPPEN: An owner-only or named-account build, role elevation, a special login, a request for any account identifier or email, self-enabled customer audio, a claim that the provider gate opened, or a claim of verified zero retention
MUST_PRESERVE: Canonical standing resolution in its existing home, the caller-owned thread checks, the four deployed consumers byte-for-byte, active OpenAI read-aloud, platform-owned availability, and the super_admin-only rollout authority. §58 EXCEPTION, NAMED: one shipped behaviour IS removed — because the old predicate matched the singleton's pilot_tenant_id, authorizing a second workspace implicitly revoked the first. That was an artifact of there being one row, not a designed control, and it is the wrong default once several subjects can be admitted. It is removed deliberately; withdrawal is now explicit, and the only withdrawal seam an edge caller has is the global disable-live-pilot. Per-workspace and per-subject withdrawal are configuration writes and no edge action for them is built here. Flagged for owner sign-off rather than left to be discovered
ACCEPTANCE_CRITERIA: An ordinary Solo member holding no platform role passes the product gate once admitted; an active member of the same enabled workspace who is not admitted is refused; one subject's consent cannot authorize another; withdrawal, lapse and disable each deny immediately; no consumer redeploys
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: Affected and tested: Live admission, rollout authority, canonical readiness and audit, account/workspace isolation, privacy acceptance. Unchanged: login and account choice, signup/paywall/billing/provisioning, action approval and autonomy, Spine tool execution, tool writes/readback/Rail/Memory, chat transcript and thread behavior, Secure Browser and Vault, provider transport, durable jobs, shell geometry and accessibility.
INTERNAL_BUILD_IDENTITY: pr=1437; base=154bef2bdac3a41dadb272a9c748cab115125781; merge_sha=7bda45ed1c79c16c17d9e4fa4a9637eee66a191b; reviewed_head=9b5966152243650c1769dbf42cfd635b4a417d38; deployment=APPLIED(supabase_migrations.schema_migrations row 20270420000000 observed on xygzykjyynhzqytbqnzu 2026-09-24); environment=production; migrations=APPLIED(20270420000000_paige_live_rollout_is_configuration); edge=NOT_APPLICABLE; evidence=supabase/tests/paige_live_pilot_feature_guard.sql
RELEASE_CHANNEL: production: the migration is applied on production; no rollout was enabled and no account admitted, confirmed by a live read showing 0 subject rows, pilot_enabled false and 0 enabled workspaces
RELEASE_CLASSIFICATION: internal-only: readiness-contract repair, not a customer launch
CUSTOMER_RELEASE_IDENTITY: none: no customer-visible outcome is ready to explain as one release, and production conversation remains unverified
RELEASE_NOTE_REQUIRED: no: no customer announcement
RELEASE_TRUTH_BOUNDARY: PARTIAL: the product is now shell-wide by construction and proven so in the database; provider-backed realtime audio, authenticated end-to-end conversation and any audience change remain PROOF OWED
RELEASE_RECOVERY: position=authenticated platform-owner disable-live-pilot, which flips the envelope off and withdraws every admitted subject; reference=forward migration rollback comment; preserve audit history, schema and active read-aloud

## Operational boundary
Today the only production writer of an admission is the existing owner-gated `authorize-live-pilot`
action, which admits the authenticated platform operator from their own session — a configuration
fact about who may speak now, no longer a product requirement that the speaker hold `super_admin`.
Admitting anyone else is an INSERT into the configuration table carrying that person's own
acceptance; no such flow is built here, and building one is not authorized by this change.

Technically enforced: only admitted, unexpired, unrevoked subjects in a switched-on workspace are
admitted, and every other account is refused — proven, not asserted. Procedurally accepted: a
single-speaker setting. The system cannot tell who is speaking into an authorized microphone.
