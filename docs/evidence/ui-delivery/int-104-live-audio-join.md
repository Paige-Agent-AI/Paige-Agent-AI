# INT-104 Live audio join: existing stage, canonical Paige thread

## Scoped readiness repair — discovery and attachment contract

Existing Project / R3 Deep, Flow-by-Flow 2.0.2. Intended outcome: the authorized pilot participant uses the existing Solo Live stage to speak, hear Paige, interrupt, perform governed work, end cleanly, and retain the same chat thread. This repair is not general availability.

1. Domain owner: Live Conversation owns modality wiring. Budget and unrelated domain work remain outside this repair.
2. Existing surfaces reused: `PaigeLiveConversation.tsx`, `PaigeAIChat.streamTurn`, `paigeLiveConversation/client.ts`, `relayTransport`, `VoiceAudio`, Presence, transcript/cards and the existing control bar. No replacement screen, context provider or browser store.
3. Harness/Gateway: canonical `paige-ai-chat` continues through its existing Spine resolution, tool definitions and execution. Signed speech is a modality of that runtime, never a second agent entry.
4. Spine and registry: the existing runtime resolves each business tool's capability at execution; no standalone Live action key is invented. Audio alone is not a business-action capability. Deepgram and ElevenLabs entries remain governed by the Integration Capability Registry; listing a provider proves neither connection nor readiness.
5. Authority: session `auth.getUser()` plus `current_user_tenant_id()`, caller-owned `paige_chat_threads`, existing workspace-standing checks, and one service-only scoped readiness predicate. Owner/admin/member labels grant no rollout override. Pilot scope is operational data, never seeded identity.
6. Approval/autonomy: existing action-risk and one-approval-gate rules remain unchanged. Spoken assent carries no approval fingerprints. No accessible clicked approval means pending. UsageSink is neutral metering, with no pricing, reservation, quota or ceiling logic.
7. Persistence: reuse `paige_voice_readiness`, `paige_live_tenant_availability`, `paige_voice_profiles`, `paige_live_sessions` and `paige_audit_log`. Add typed scoped-authorization fields and narrow service-only functions; do not weaken the legacy read-aloud activation contract or fabricate cost proof.
8. Rails/Mind/Memory/Knowledge: same runtime, `paige_chat_turns`, existing tool receipts and scoped context assembly. No second transcript, memory, knowledge store, job or event stream. Real CRM persistence and Rail appearance must be measured, not inferred.
9. Binding/surface: existing `paige.workspace` remains PARTIAL until authenticated proof. Refusal uses the existing unavailable state and leaves text chat usable. No layout, motion, focus, thread ownership or mute/Presence replacement.
10. Proof: negative account/tenant admission, revocation, absent/invalid proof, honest default-retention authorization, active OpenAI preservation and signed-runtime refusal are required. Local fakes are automated evidence only. Production signing, actual speech/Jessica, interruption, ending, preserved text chat, CRM/Rail, confirmation and entitlement refusal remain UNVERIFIED until driven.

Reuse the existing platform-owner `paige-voice-profile-admin` seam and its audited metadata inspection. New consent records say `owner_authorization` and `default_provider_retention`, with dated authority and private evidence reference; zero-retention truth remains `UNAVAILABLE`. Technically enforced: exactly one authorized account and workspace, every other account refused. Procedurally accepted: a single-speaker setting. **Not enforced by the system: the system cannot tell who is speaking into an authorized microphone.** Third-party voices stay closed until retention and speaker identity are resolved.

Deployment impact: `paige-live-session`, `paige-live-relay`, `paige-ai-chat`, and the existing `paige-voice-profile-admin` control seam; additive database migration. No shared module edit, no STT/TTS importer expansion, and no active read-aloud profile change. The extra owner-control function is necessary to record the authorized scope through the existing administration path, not a parallel control plane. This repair is not deployment-inert.

Current repair proof (2026-09-24): failing-first admission check 56 pass / 9 fail; repaired production-body and actual-session-handler smoke 83 pass / 0 fail, zero network/provider calls. Removing the admission guard in memory makes the unauthorized-ticket oracle fail. Actual admin handler tests caught free-text evidence acceptance (200 instead of 400) and workspace-dependent revocation (409 instead of 200); both corrected. Evidence input is an opaque private-register UUID, never a transcript or provider setting. Independent security and cross-flow review found no blocking bypass; nullable speech-policy and revocation findings were repaired. New PostgreSQL assertions are UNVERIFIED locally because the isolated Supabase database is unavailable; database CI must pass before release. Deploy the additive schema and all four functions before any operational pilot authorization; missing RPC always refuses admission. Safe rollback is authenticated platform-owner disable, retaining the authorization history and leaving read-aloud untouched.

Additional current automated proof: 117 focused Live/transport/provider-admin tests passed across 11 files. The existing actual chat-handler suite passes 334 checks; 32 new checks execute signed Live admission, canonical scope, challenge consumption, stored history and signed output. Its in-memory guard-removal mutation produces 15 failures; restored run passes. These use fake network boundaries and are not production provider proof. The STT smoke still passes 83 checks and the TTS smoke passes unchanged.

## Grounded repair attachment map (2026-09-23)

The retired `startVoiceSession.ts` at #297's parent used a hosted ElevenLabs agent, not the approved cascaded runtime. It is historical input only; no retired endpoint or screen is restored. Reuse the existing `PaigeLiveConversation` stage, `relayTransport`, `VoiceAudio`, `PaigeAIChat.streamTurn`, JWT-authenticated `paige-ai-chat`, caller-owned `paige_chat_threads` / `paige_chat_turns`, and `paige_live_sessions`. The existing runtime continues to own Spine tool execution, Rail receipts, Mind, Memory, tenant Knowledge and Harness access. Voice does not add an invocation or approval path.

The P1 repair adds one purpose-bound runtime-output proof helper, not another runtime: a short-lived relay challenge binds the server-resolved actor/tenant/thread/session/turn and exact final transcript; the existing service-only `provider_session_ref` slot holds its digest after the handshake ticket is consumed. Canonical chat atomically consumes that digest before effects, reads the existing caller-owned thread history, and signs only released SSE answer content. The browser transports opaque signed proofs; raw runtime text cannot reach the mouth. The proof helper has exactly two deployed importers: `paige-ai-chat` and `paige-live-relay`. Both functions plus Vercel are the authorized redeploy set for this repair. Existing STT/TTS shared modules remain untouched. No schema, alternative memory or billing control is added.

Protected repair seam: forged/replayed/wrong-scope/expired/reordered output, substituted transcript, spoken approval fields, post-cancel output and withheld protected runtime content must not synthesize speech. Text chat and the current stage layout remain unchanged. Named signing key is server-only `PAIGE_LIVE_STREAM_SIGNING_KEY`; no key value is committed, sent to the client, or logged.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Flow-by-Flow 2.0.2, Existing Project / R3 Deep; Talk live on the existing Solo Paige stage, speak, hear the same-thread answer, interrupt, mute, and end
PAIGE_UI_DESIGN: PASS: The approved Live stage, transcript, cards, Presence, control bar, copy and focus behavior are reused rather than recreated
VISIBLE_FLOW_IMPACT: YES: A ready relay now captures speech and plays Paige's answer; the existing stage shows listening, speaking and honest unavailable states
MATERIAL_FLOW_CHANGE: YES: Live audio is newly joined to the existing signed-in chat request and first-party relay
FLOW_PROTOTYPE: PASS: Owner-approved 2026-09-08 Organic Paige Presence + Real Audio Recovery pack in docs/evidence/ui-delivery/paige-live-conversation-mvp.md; this join uses its existing stage, controls, interruption and recovery paths
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: The explicitly authorized pilot account talks in its own tenant-scoped thread; every other account is refused. The shared Solo shell and eventual per-user entitlement model are preserved, not general availability.
VISUAL_DIRECTION: PASS: Existing Solo Live layout, typography, tokens, transcript and card region remain intact; no parallel screen or second assistant is added
AUTOMATED_EVIDENCE: PASS: 2026-09-23 relay-bridge harness 47/47 with real WebCrypto and fake adapters, zero network/provider calls; focused Live/transport/output tests 43/43. Failing-first master-switch and Minimize-close regressions: 42 pass / 5 fail, restored fixes 47 pass / 0 fail; the harness executes the production admission body and close callback with a database double, not a production database. Earlier unsigned-runtime check: 15 pass / 1 fail; Hold-to-Interrupt: 1 pass / 1 fail (expected false, received true); Hold-before-first-PCM: expected suspended, received running. Removing the authority rejection yields 40 pass / 1 fail; restored guard passes. PostgreSQL pilot and one-use claim tests passed in CI run 35920820810; local harness does not claim database execution.
STATIC_EVIDENCE: PASS: The relay joins the existing provider-neutral reducer, Flux adapter and ElevenLabs streaming transport through the bridge; the browser invokes the existing paige-ai-chat runtime with no approval fingerprints for a spoken turn
RENDERED_EVIDENCE: UNVERIFIED: Focused DOM tests exercise the existing stage, but no authenticated production live-audio render has been captured yet
BEHAVIORAL_EVIDENCE: UNVERIFIED: An owner speaking, hearing Jessica, interrupting, ending and retaining the same chat thread in production is still required
AUTHENTICATED_RUNTIME: UNVERIFIED: The scoped pilot defaults off. Production credential identity, ElevenLabs metadata readback, authorization persistence, signing round trip and the owner conversation/action checks remain required.
KEYBOARD_FOCUS: PASS: The existing semantic Talk live, Mute, Hold, Interrupt, Minimize and End buttons and focus restoration remain the control path
ZOOM_REFLOW: UNVERIFIED: No layout changed, but authenticated responsive proof with real audio remains owed
REDUCED_MOTION: PASS: No motion preference or animation behavior changed
STATE_COVERAGE: PASS: Tests distinguish ready, speaking, unavailable, microphone denial, queued playback, interruption, runtime cancellation and end; provider errors need authenticated owner verification
TRUTHFUL_STATE_LABELS: PASS: LIVE is shown only after authenticated ticket admission and observed ears open; provider or runtime failure shows unavailable and text chat remains available
SOLO_UI: YES: The existing Solo Paige chat and its Live Conversation stage are the affected surface
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: No fresh authenticated production render; no layout change
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: Real-audio production render remains owed
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: No fresh authenticated production render; no layout change
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: Real-audio production render remains owed
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: No fresh authenticated production render; no layout change
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: Real-audio production render remains owed
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: No fresh authenticated production render; no layout change
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: Real-audio production render remains owed
UNVERIFIED: Runtime Deepgram credential identity, ElevenLabs account tier and voice access, production latency, real speech, Jessica sound, barge-in, CRM/Rail and owner acceptance are not claimed by local fakes. Deepgram opt-out is request-level, not an account-setting claim.

OWNER_INTENT: A person uses the existing Talk live entry and Live stage for a real, fast conversation in their own Paige thread, with Jessica's sound and immediate interruption.
MUST_NOT_HAPPEN: A second brain or thread appears, a spoken yes approves an action, another user's context leaks, an unavailable provider is labeled live, or the browser receives a provider secret.
MUST_PRESERVE: The platform-owned default-off rollout gate, per-user/tenant/thread scope, canonical paige-ai-chat runtime, text chat, existing Live screen and controls, and the active OpenAI read-aloud profile.
ACCEPTANCE_CRITERIA: Owner taps Talk live, speaks, sees the real transcript, hears Paige answer in Jessica's voice, interrupts immediately, ends cleanly, and sees the intact same-thread chat in production.
PROTECTED_SEAMS: AFFECTED — first-party relay, Flux ears, streaming mouth and existing Solo Live/chat bridge. PRESERVED — PAIGE governance, tenant/user identity, Rail, Mind, Memory, Knowledge, permission selector and active read-aloud playback.

INTERNAL_BUILD_IDENTITY: merge_sha=PROOF_OWED; reviewed_head=PROOF_OWED; deployment=PROOF_OWED; environment=development; migrations=PROOF_OWED; edge=PROOF_OWED; evidence=scripts/paige-live-relay-bridge-smoke.mts and supabase/tests/paige_live_pilot_feature_guard.sql; historical_join_pr=1387; historical_join_merge=6bd8849d4b9bad7c8d331458cab03c00c61b87aa
RELEASE_CHANNEL: development: scoped readiness repair awaiting exact-head review and deployment; operational deployment identifiers remain in the private Delivery Evidence Register
RELEASE_CLASSIFICATION: internal-only: no customer-facing release is claimed while the platform pilot is default off
CUSTOMER_RELEASE_IDENTITY: none: Live Conversation is not yet delivered end to end
RELEASE_NOTE_REQUIRED: NO: this staged slice is not general availability
RELEASE_TRUTH_BOUNDARY: PARTIAL: local fakes and browser tests prove wiring; real provider behavior and authenticated production acceptance are UNVERIFIED
RELEASE_RECOVERY: position=disable the platform-owned Live pilot and roll back the exact Vercel, paige-ai-chat and paige-live-relay versions if the joined path regresses; reference=INT-104 Live Conversation

## Flow and proof boundary

- Before: the existing Live stage was truthful but its relay had no real ears or mouth; the user could not talk with Paige.
- After this code joins: the browser's own microphone sends PCM over first-party WSS; the relay's Flux adapter supplies transcript; the existing paige-ai-chat request authors the response; Jessica's server-side transport streams PCM back to the existing stage. This is not a delivery claim while the pilot is off.
- Spoken replies carry no approval fingerprints. The existing governed confirmation card remains the only approval path.
- The platform pilot is operational data outside tenant-admin write authority. Its exact-account authorization accepts default provider retention, not verified zero retention. Real audio still requires credential/provider readback and the owner production check; local tests never call a vendor.
- Ongoing authority reuses the initial caller/thread/workspace/pilot resolver. It is rechecked after ears open and before ready, refreshed every 500 ms, and PCM waits while a check runs; check failure or a 1-second timeout closes the session honestly. This is bounded revocation detection, not an instantaneous database-to-socket notification. Transport buffering is bounded; no usage allowance, pricing or spend gate is added.
- Hold applies even before the first audio chunk arrives; Interrupt restores the selected microphone mute state. Database history trims an incomplete leading assistant exchange and reuses canonical message validation.
- The scoped pilot predicate is mandatory at all three entry points and during ongoing admission, separately from tenant rollout. Legacy global transport cannot bypass it; that legacy switch and its stricter read-aloud activation contract remain unchanged. No pricing or allowance logic participates.
- Physical socket closure cleans up audio only. Durable Minimize, Restore and End remain owned by the existing authenticated control plane; a delayed close cannot overwrite a minimized or renewed session. The existing visible disconnect state remains honest when a transport closes unexpectedly.

## 2026-09-23 review repair: preserved failing-first output

```text
FAIL master transport false refuses admission
FAIL master transport undefined refuses admission
FAIL disabled master switch opens neither provider adapter
FAIL minimize after socket close remains resumable
FAIL minimize before socket close remains resumable
42 passed, 5 failed; network/provider calls=0
```

After the fixes: `47 passed, 0 failed; network/provider calls=0` (exit 0).
Relay Deno check: exit 0. Three focused Vitest files: 43 passed, exit 0.
The first full CI comparison also identified this PR's one stale exact-source
dictation assertion: the send guard still refuses dictation/no-draft, but now
notifies the voice sink before returning. The assertion now requires that entire
guard, including the failure callback; it was not deleted or relaxed. The focused
send-guard test passes (exit 0); full CI must return to the measured main baseline.
