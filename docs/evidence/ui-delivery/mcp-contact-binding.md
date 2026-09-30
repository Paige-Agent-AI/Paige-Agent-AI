# Incoming-contact contract: draft release hold

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: docs/delivery/mcp-contact-binding.md records affected flows, collisions, dependencies, refusal/retry/revocation and remaining owner-path work.
PAIGE_UI_DESIGN: PASS: repository Paige UI skill read; this draft edits no interface. New owner controls must use the existing Integrations drawer and one PAIGE workspace, with Impeccable applied before UI implementation.
MATERIAL_FLOW_CHANGE: YES: external contact ingress changes from a global credential and active-workspace destination to explicit connection-bound authorization and atomic persistence.
FLOW_PROTOTYPE: UNVERIFIED: owner approved incoming contact sync on 2026-09-30, but the owner-facing enable/rotate/revoke journey has not yet been prototyped or implemented. This is an explicit draft release hold, not a waived gate.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: Solo owner allows incoming contacts into the connection's own business; account switching cannot redirect them.
VISUAL_DIRECTION: NOT_APPLICABLE: no product markup, styles, navigation, or new surface is changed by this contract draft.
AUTOMATED_EVIDENCE: PASS: disposable PostgreSQL proof, Request/Response adapter tests and existing gateway/tenant hook regressions; exact commands and evidence boundary in the delivery packet.
STATIC_EVIDENCE: PASS: type ratchet 12/12; build 5185 modules; migration/signature/privacy checks. Whole bridge lint retains five baseline errors, not claimed globally clean.
RENDERED_EVIDENCE: UNVERIFIED: incoming grant controls do not yet exist in the UI; no fixture screenshot is offered as proof.
BEHAVIORAL_EVIDENCE: PASS: database transaction tests exercise fixed-business writes, retries, revocation, assignment and rollback; HTTP adapter tests use mocked RPC. This is not authenticated browser evidence.
AUTHENTICATED_RUNTIME: UNVERIFIED: no real account or sender accessed; owner configuration and sender cutover must be proved before release.
KEYBOARD_FOCUS: UNVERIFIED: owner grant controls are not implemented; no existing UI changed.
ZOOM_REFLOW: UNVERIFIED: new owner path has no rendered proof.
REDUCED_MOTION: UNVERIFIED: no new UI/motion authored; incoming owner path still owed.
STATE_COVERAGE: PASS: backend initial disabled, grant/readback, stale save, wrong business, invalid credentials, replay, conflict, stale source, revoked membership, disconnect and atomic failure tested. Browser abandonment/account-switch rendering remains unverified.
TRUTHFUL_STATE_LABELS: PASS: HTTP success requires a verified commit acknowledgement; a malformed acknowledgement returns 503. Registry labels explicitly preserve the unreleased incoming-contract boundary.
SOLO_UI: NO: backend contract only in this draft; the required Solo owner-facing configuration path is an explicit release blocker, not claimed available.
UNVERIFIED: owner UI/prototype, authenticated permissions, sender reconfiguration and legacy identity reconciliation, production contacts, Paige governed import, Linux full-schema and preview evidence until separately executed. Never merge on this evidence record alone.

OWNER_INTENT: Allow incoming contacts from any owner's configured tool into that connection's fixed business, never the open workspace and never duplicated by a retry.
MUST_NOT_HAPPEN: wrong-business write, raw credential/payload in receipts, global-key fallback, optimistic success or a second connection/authority store.
MUST_PRESERVE: canonical contact/address records, tenant isolation, unrelated Settings/bridge flows, one PAIGE and specialized n8n ownership.
ACCEPTANCE_CRITERIA: owner enables, receives, observes, rotates/revokes and safely retries incoming contacts through a proven authenticated product path; this draft does not yet satisfy the whole journey.
MOTION_PURPOSE: NONE: no animation change.
PROTECTED_SEAMS: canonical tenant/capability resolver, contact methods, assignment RLS and receipt transaction exercised; shared shell/Chat/Communications/Calendar untouched.
INTERNAL_BUILD_IDENTITY: source-head=71e48090e8cca9f288a5a0f3f60dd22cd283712f; branch=codex/mcp-contact-binding; deployment=none; environment=local; migrations=PROOF_OWED(named-authorization-for-20270522000000); edge=PROOF_OWED(owner-setup-and-sender-cutover); evidence=docs/delivery/mcp-contact-binding.md
RELEASE_CHANNEL: development: disposable local contract verification, no production release or staged tenant exposure.
RELEASE_CLASSIFICATION: internal-only: incoming database/adapter draft only, owner journey not yet usable.
CUSTOMER_RELEASE_IDENTITY: none: no coherent production customer outcome is claimed.
RELEASE_NOTE_REQUIRED: no: draft only; sender transition instructions are mandatory before eventual release.
RELEASE_TRUTH_BOUNDARY: PARTIAL: canonical connection capability; incoming production and owner path UNVERIFIED, never LIVE.
RELEASE_RECOVERY: position=retain contact evidence and forward-fix after use; reference=docs/delivery/mcp-contact-binding.md; never restore unsafe active-workspace contact routing.
