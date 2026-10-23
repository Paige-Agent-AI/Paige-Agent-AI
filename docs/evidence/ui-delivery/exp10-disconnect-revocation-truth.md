# UI delivery evidence: EXP10 PR5 — disconnect names the provider-side revocation step

Covers THIS branch's delta on the G1b surface (src/solo/settings-integrations-gateway.tsx):
DisconnectConfirm gains providerRevokeStep() + an ig-note line naming the PROVIDER-side half
of "disconnect and revoke" — disconnecting clears Paige's stored credential + approvals HERE,
but the credential stays valid at the provider until the tenant acts there (Slack: Tools &
settings → Manage apps or rotate the token; GoHighLevel: delete the Private Integration in
the sub-account's or agency's Settings, wherever it was created; n8n: revoke the key/client;
Zapier: regenerate the MCP connection; generic: rotate at the provider). Copy-only; no
layout/motion change; renders for both turn-off and delete paths.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: the existing disconnect flow mapped by the G1b record; this delta adds a truthful note line to its confirmation step, nothing else.
PAIGE_UI_DESIGN: PASS: Impeccable craft-floor applied to copy; the approved pack-v5 visual direction is untouched (pre-existing ig-note idiom).
MATERIAL_FLOW_CHANGE: NO: copy addition inside the evidenced disconnect confirmation.
FLOW_PROTOTYPE: NOT_REQUIRED: non-material flow change; flow prototyped at pack v5.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: a Solo owner disconnecting a tool learns the credential itself lives on at the provider and exactly where to kill it; the primary action (turn off / delete) is unchanged.
VISUAL_DIRECTION: PASS: incumbent ig-note line reused; no new tokens or layout.
AUTOMATED_EVIDENCE: UNVERIFIED: the revocation-note test runs in CI's fresh install; local vitest is env-broken on this shared tree (vitest@4.1.11/vite@5.4.21 contamination).
STATIC_EVIDENCE: PASS: ts.transpileModule clean on both edited files; provider steps verified against Slack/GoHighLevel/n8n/Zapier documentation by independent review (2 copy P2s fixed on-thread).
RENDERED_EVIDENCE: UNVERIFIED: no local browser render this slice; the note rides the existing DisconnectConfirm structure evidenced at g1b.
BEHAVIORAL_EVIDENCE: UNVERIFIED: pinned by the automated test (slack step + generic fallback + not-Slack-on-generic); interactive drive is owner acceptance (matrix A10).
AUTHENTICATED_RUNTIME: UNVERIFIED: no provider disconnect has been exercised authenticated; owed and named.
KEYBOARD_FOCUS: PASS: unchanged from g1b (the note is not focusable; the radio group semantics are untouched).
ZOOM_REFLOW: NOT_APPLICABLE: no layout change; the note wraps in the existing drawer body.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: the note renders in both disconnect shapes (turn-off, delete) and in the error path; nothing about the two choices changed.
TRUTHFUL_STATE_LABELS: PASS: the copy states the boundary precisely — the disconnect removes Paige's copy and approvals; the token stays valid at the provider until the named step; never claims revocation happened.
SOLO_UI: YES: src/solo/settings-integrations-gateway.tsx renders inside the Solo Settings → Integrations leaf.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: structure unchanged from the g1b captures.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: same.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: same.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: same.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: same.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: same.
UNVERIFIED: CI suite pass on the exact head and an authenticated disconnect drive — owed and named; none claimed.
OWNER_INTENT: owner directive 2026-10-22 (EXP10 §2): "Disconnect an application and revoke its permissions" — both halves named honestly.
MUST_NOT_HAPPEN: never imply the disconnect revokes the provider credential; never invent a vendor menu path (two review P2s fixed exactly there); never alter the turn-off/delete semantics.
MUST_PRESERVE: the G1b record's MUST_PRESERVE set; the refusal-not-following test's behavior; the radio-group keyboard semantics.
ACCEPTANCE_CRITERIA: on the real platform a tenant disconnects a Slack tool and the confirmation names Slack's own remove-app step; a generic tool names the rotate-at-provider fallback.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: presentation copy only; the disconnect RPC lane is untouched.

INTERNAL_BUILD_IDENTITY: bc5ef40893662c09a4b5f48a8d388f53c261d9f5 (exp10-pr5-revocation-truth; stacks PR4 4e34c25d9 on merged main a683dd719); deployment=vercel-preview-per-push; environment=preview; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/exp10-disconnect-revocation-truth.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: confirmation copy truth inside an existing surface; no customer release identity until an authenticated disconnect is proven
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only until a real disconnect is proven
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the revocation note ships on merge plus deploy; an authenticated provider disconnect remains PROOF OWED
RELEASE_RECOVERY: position=frontend-revert-restores-prior-copy; reference=this record plus the revert commit
