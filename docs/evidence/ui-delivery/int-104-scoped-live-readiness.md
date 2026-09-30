# Scoped Live readiness — delivery evidence

This is the per-change record for #1407. Discovery, the ten attachment answers and prior flow history remain in [the existing Live join record](int-104-live-audio-join.md). It does not create another capability or evidence system.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Flow-by-Flow 2.0.2, Existing Project / R3 Deep; existing Talk live flow, scoped admission, refusal, revocation and same-thread continuation
PAIGE_UI_DESIGN: PASS: Existing Live stage and its approved controls reused; project routing, accessibility and evidence references read; no visual redesign
VISIBLE_FLOW_IMPACT: YES: Existing unavailable state now follows exact scoped authorization rather than unrelated legacy readiness prerequisites
MATERIAL_FLOW_CHANGE: YES: Scoped default-retention pilot authorization replaces an unusable legacy prerequisite for this Live path only
FLOW_PROTOTYPE: PASS: Existing owner-approved Organic Paige Presence + Real Audio Recovery flow, recorded in paige-live-conversation-mvp.md; owner approved scoped pilot behavior and use of the existing screen, with no new layout
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: One operationally authorized account talks with Paige in its own workspace and thread; every other account is refused
VISUAL_DIRECTION: PASS: Existing Solo stage, transcript, cards, Presence and control bar preserved unchanged
AUTOMATED_EVIDENCE: PASS: Relay/session smoke 83/0; actual chat-handler suite 334/0; admission mutation 15 expected failures; focused Live/provider/admin tests 117/0 across 11 files; STT smoke 83/0; TTS and ticket smoke pass; all fake-only
STATIC_EVIDENCE: PASS: TypeScript ratchet exit 0 with 12 existing diagnostics and no additions; migration-version and authority lints exit 0; diff check passes; resolver returns exactly four functions
RENDERED_EVIDENCE: UNVERIFIED: No fresh authenticated production render for scoped authorization; existing DOM tests do not substitute
BEHAVIORAL_EVIDENCE: UNVERIFIED: Owner speech, Jessica response, interruption, ending and text preservation require the production pilot
AUTHENTICATED_RUNTIME: UNVERIFIED: Pilot is still off; exact account refusal, signing, credentials and action/Rail proof must be measured after schema and function deployment
KEYBOARD_FOCUS: PASS: Existing semantic controls and focus restoration retained; no browser code changes
ZOOM_REFLOW: UNVERIFIED: No layout changed; authenticated viewport proof remains owed
REDUCED_MOTION: PASS: No motion implementation or preference changes
STATE_COVERAGE: PASS: Tests execute admission allow/deny/error, wrong scope, revocation, signed output, ticket persistence failure and clean refusal; production provider behavior remains unverified
TRUTHFUL_STATE_LABELS: PASS: Default retention is authorization, never verification; zero retention is UNAVAILABLE; new code and fake tests do not claim LIVE
SOLO_UI: YES: Existing Solo Paige Live Conversation stage
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: Fresh authenticated render not captured
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: Fresh authenticated render not captured
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: Fresh authenticated render not captured
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: Fresh authenticated render not captured
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: Fresh authenticated render not captured
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: Fresh authenticated render not captured
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: Fresh authenticated render not captured
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: Fresh authenticated render not captured
UNVERIFIED: Local PostgreSQL execution unavailable; exact-head database CI required. Production credential identity, account metadata, signing and all conversation/action checks remain owed.

OWNER_INTENT: Finish the existing Live experience without another screen, brain, memory or authority path
MUST_NOT_HAPPEN: General availability, another account admitted, fabricated retention or cost proof, provider contact from fixtures, read-aloud regression
MUST_PRESERVE: Same authenticated user/workspace/thread, canonical runtime and governed tools, clicked approval, neutral UsageSink and active OpenAI read-aloud
ACCEPTANCE_CRITERIA: Scoped account receives a ticket only with canonical authorization; others fail closed before adapters; owner can revoke without a selected workspace; real conversation and governed action checks still required
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: Session and relay admission, signed runtime admission, service-only readiness, owner administration and canonical thread identity; STT/TTS modules untouched
INTERNAL_BUILD_IDENTITY: pr=1430; historical_base_merge=e392d7f0cf7c3aca7ce91a592cc6673e318a517c; merge_sha=PROOF_OWED; reviewed_head=PROOF_OWED; deployment=PROOF_OWED; environment=development; migrations=PROOF_OWED(20270412000000_paige_live_scoped_pilot_authorization); edge=PROOF_OWED(four-function production deployment has not occurred); evidence=scripts/paige-live-relay-bridge-smoke.mts and supabase/tests/paige_live_pilot_feature_guard.sql
RELEASE_CHANNEL: development: code and local fake-provider proof; no pilot authorization performed
RELEASE_CLASSIFICATION: internal-only: readiness contract repair, not a customer launch
CUSTOMER_RELEASE_IDENTITY: none: end-to-end production acceptance is incomplete
RELEASE_NOTE_REQUIRED: no: no customer announcement authorized
RELEASE_TRUTH_BOUNDARY: PARTIAL: existing workspace; UNAVAILABLE for unauthorized accounts; production Live remains PROOF OWED because scoped authorization and provider readbacks are not deployed
RELEASE_RECOVERY: position=authenticated platform-owner disable; reference=additive migration rollback comment; keep audit and schema history, no legacy transport/profile changes

## Authority and deployment

Technically enforced: exactly one authorized account and workspace; every other account refused. Procedurally accepted: a single-speaker setting. The system cannot tell who is speaking into an authorized microphone. Third-party voices remain gated on retention and speaker identity.

Reuse the existing platform-owner administration seam. The runtime resolves identity; request bodies cannot select an actor, tenant or inspection receipt. A fresh sanitized metadata inspection proves voice access only. An opaque private-register UUID points to dated owner authorization. Zero-retention truth remains UNAVAILABLE.

Redeploy set: paige-live-session, paige-live-relay, paige-ai-chat and paige-voice-profile-admin. No shared-module changes. The additive schema and all four functions must be verified before operational enablement. No production setup occurs in this PR.

## Review and proof boundaries

Independent security and cross-flow review found two minor defects in the new code: nullable spoken policy and workspace-dependent revoke. Both were repaired; regression tests are included. New database matrix has 39 assertions; no local database was available, so execution is not claimed until CI. Existing stage, playback, interruption and text paths remain covered by focused tests. Provider and human proof cannot be inferred from these checks.
