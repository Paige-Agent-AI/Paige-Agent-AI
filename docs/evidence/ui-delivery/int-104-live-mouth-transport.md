# Live mouth transport — delivery evidence

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Flow-by-Flow 2.0.2; Existing Project / R3 Deep; existing Talk live entry, response, interrupt and end flow
PAIGE_UI_DESIGN: PASS: Project skill and routed references read; existing Organic Paige Presence stage reused, no new screen or styling
VISIBLE_FLOW_IMPACT: YES: Live speech uses the documented v3 dialogue transport with explicit completion and cancellation
MATERIAL_FLOW_CHANGE: YES: Correct the provider transport behind the already-approved live response and interruption behavior
FLOW_PROTOTYPE: PASS: Existing owner-approved Organic Paige Presence + Real Audio Recovery flow in paige-live-conversation-mvp.md; owner authorized completing this same experience
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: The operationally authorized pilot account speaks and hears Jessica in its existing Paige thread
VISUAL_DIRECTION: PASS: Existing Solo stage, transcript, cards, controls and Presence unchanged
AUTOMATED_EVIDENCE: PASS: Actual mouth adapter 28/28; old adapter 19 failures of 22. Removing retention guard causes two failures; accepting turn-final as completion causes one. Relay sender regression fails before queue bound and passes after; existing STT83, TTS20, relay34 and ticket smoke pass with no provider calls. Final interruption regression counts recorded in the PR.
STATIC_EVIDENCE: PASS: Targeted ESLint exit 0; type ratchet exit 0 (12 baseline, 12 current); registry lint and self-test exit 0; importer resolver returns paige-live-relay and paige-tts. Exact-head CI still required.
RENDERED_EVIDENCE: UNVERIFIED: Browser automation cannot start; no fresh authenticated render captured
BEHAVIORAL_EVIDENCE: UNVERIFIED: Real speech, Jessica response, interruption, clean end and text continuation require production pilot testing
AUTHENTICATED_RUNTIME: UNVERIFIED: Pilot remains off; real signing, identity, provider and governed-action checks remain owed
KEYBOARD_FOCUS: PASS: No DOM, control or focus implementation changes; existing semantic controls and focus code preserved
ZOOM_REFLOW: UNVERIFIED: No layout changes; fresh authenticated geometry remains owed
REDUCED_MOTION: PASS: No motion code or preference changes
STATE_COVERAGE: PASS: Actual adapter tests cover invalid policy, open, incremental PCM, explicit terminal, errors, cancellation, timeout, queue bound and late frames. Browser interruption tests 17/17 and relay cancellation checks 101/101 use fakes, including missing acknowledgement timeout and cancelled completion suppression; authenticated behavior remains unverified.
TRUTHFUL_STATE_LABELS: PASS: Default retention is scoped authorization, not verification; zero retention remains UNAVAILABLE
SOLO_UI: YES: Existing Solo Live Conversation stage
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: Fresh authenticated render unavailable
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: Fresh authenticated render unavailable
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: Fresh authenticated render unavailable
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: Fresh authenticated render unavailable
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: Fresh authenticated render unavailable
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: Fresh authenticated render unavailable
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: Fresh authenticated render unavailable
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: Fresh authenticated render unavailable
UNVERIFIED: Provider account access, runtime credential identity, real audio quality and latency, authenticated browser behavior and nine production checks remain unmeasured

OWNER_INTENT: Finish the existing conversation in Jessica's voice, with immediate interruption, the same runtime and intact text chat
MUST_NOT_HAPPEN: Wrong voice, unsigned speech, secret exposure, automatic provider fallback, general availability, fabricated privacy or production proof
MUST_PRESERVE: Active OpenAI read-aloud, existing HTTP read-aloud helper, canonical scoped admission, clicked approvals, same user/workspace/thread and UsageSink
ACCEPTANCE_CRITERIA: Only authorized runtime text reaches the approved voice; audio streams incrementally; cancellation stops and discards late audio; explicit final marker settles successfully; broken transport reports the existing honest failure state
MOTION_PURPOSE: NONE: no motion changes
PROTECTED_SEAMS: Affected: Live response/completion/cancellation, provider status, privacy and server secrets. Regression checks: existing read-aloud and relay authority/signing. Unchanged: tenant identity and account selection, billing/signup/provisioning, approval/autonomy and Spine tool execution, canonical writes/readbacks, Rail/Memory, thread hydration/popout/scroll, Secure Browser/Vault, durable jobs, shell geometry and accessibility implementation.
INTERNAL_BUILD_IDENTITY: historical_base_merge=5543a21e23172b85f76e519e5483f8f010898552; merge_sha=PROOF_OWED; reviewed_head=PROOF_OWED; deployment=PROOF_OWED; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(two-function transport deployment pending); evidence=src/__tests__/elevenlabs-live-stream.test.ts
RELEASE_CHANNEL: development: local fake transport only; pilot not enabled
RELEASE_CLASSIFICATION: internal-only: repair behind existing scoped pilot admission, not a customer launch
CUSTOMER_RELEASE_IDENTITY: none: production acceptance incomplete
RELEASE_NOTE_REQUIRED: no: no customer announcement authorized
RELEASE_TRUTH_BOUNDARY: PROOF OWED: production Live; UNAVAILABLE: unauthorized accounts and verified zero retention
RELEASE_RECOVERY: position=authenticated platform-owner disable-live-pilot; reference=int-104-scoped-live-readiness.md; retain authorization history and active read-aloud

## Discovery and attachment map

Extend `_shared/elevenlabs.ts`, the existing transport home. Preserve its Response/body adapter contract with `PaigeLiveRelayBridge`, the browser PCM player and signed runtime frames. Do not add another relay, STT client, tool list, state store, memory or approval channel. The existing `paige-ai-chat` runtime supplies Spine tools, Rail receipts, Mind, tenant knowledge and memory under the authenticated actor, workspace and owned thread. Human microphone consent remains explicit; agents reach the same governed runtime, not another microphone authority.

The server-resolved scoped pilot predicate precedes the mouth call and proves the stored default-retention authorization. The adapter requires that explicit policy value; absence refuses before a socket opens. Technically one authorized account; single-speaker use is procedural, not speaker recognition. No third-party voices until the owner-held retention and speaker-identity gates close.

Importer inventory: `_shared/elevenlabs.ts` is imported by `paige-live-relay` and `paige-tts` (including its existing TTS router import). `_shared/paige-live-relay-bridge.ts` has only `paige-live-relay` as deployed importer. Expected Edge redeploy set is exactly those two, plus the Vercel build for the existing browser transport. No STT router, TTS router, schema or profile edits. Deployment is not inert.

Independent review reproduced old PCM restarting after local interruption while a prior frame was in transit. This blocks the approved live experience, so this slice also adds an ordered interrupt acknowledgement to the existing bridge and browser transport, not a second audio path. Playback remains suppressed until the newest acknowledgement; earlier acknowledgements cannot resume it. Outbound socket buffering is bounded as transport memory safety, not a usage cap.

Binding Ledger home: `paige.workspace`, still PARTIAL; no capability promotion. Spine capability resolution and the Harness remain the existing `paige-ai-chat` tool path for the same actor at runtime. This transport adds no standalone tool, mutation verb, job or business write. The existing same-thread runtime owns authority, approval, canonical outcome and Rail readback. Mouth completion proves audio delivery to the browser transport only, never a business action or a human hearing it.

## Documented protocol and proof boundary

[ElevenLabs dialogue WebSocket](https://elevenlabs.io/docs/api-reference/text-to-dialogue/ttd-websocket), read 2026-09-24: v3 conversational transport, first-frame voices/authentication, incremental audio and close_socket finalization; default logging is not zero retention. This is a documented vendor contract, not a measured provider response. Jessica and model are server-resolved. Runtime authors spoken-style text and remains the sole brain.

One socket per queued speech batch preserves the current adapter interface. Reconnect overhead, prosody continuity and browser time-to-first-audio are UNVERIFIED; no sub-second production claim. Local tests exercise the real adapter with a fake socket and never contact a provider. The deterministic relay harness still measures 959 ms virtual mic-to-first-speech, not real latency.

Rollout: keep pilot OFF; verify the relay deployment with additive interruption acknowledgements before using the new browser build. Older clients remain supported by the server. A new client against an older relay must fail honestly rather than resume stale sound. No operational enablement is performed by this change.

Impeccable 4.3.1: existing-design launcher disposition SCOPED_EXISTING_ALLOWED; no new visual design. Applied state clarity, interruption/recovery and non-fabrication checks. Authenticated rendered finish-review remains UNVERIFIED because browser automation cannot start in the current Windows sandbox.
