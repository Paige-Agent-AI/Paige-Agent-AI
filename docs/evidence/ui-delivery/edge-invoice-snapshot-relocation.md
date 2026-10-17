# UI delivery evidence: invoice snapshot module relocation (edge certification unblock)

**2026-10-17 zCod release-infrastructure repair (PR #2310).** One file moves from `src/solo/sales/invoiceDraftSnapshot.ts` to `supabase/functions/_shared/sales-commercial/invoice-draft-snapshot.ts` with byte-identical exports (two import anchors become sibling-relative); seven web/test files and one edge function follow the import. The reason `sales-invoice-draft-command` imported a web-tree module, which the edge-source-readback verifier refuses outside the functions root — this blocked global edge certification (runs 39054164930, 39055510814). This record exists because the touched files sit under recognized Solo UI paths; the change itself has no visible-flow impact.

UI_DELIVERY_EVIDENCE_VERSION: 1

## Owner Intent & Experience Contract

OWNER_INTENT: none new — unblock edge certification for every lane; identical invoice-draft behavior everywhere.
MUST_NOT_HAPPEN: no behavior, visual, or state change in any invoice surface; no export rename; no test weakening.
MUST_PRESERVE: byte-identical module semantics (verified: only the two import specifier lines differ); all invoice tests unchanged in content.
ACCEPTANCE_CRITERIA: the module resolves from all eight importers; the verifier closure reports zero files outside the functions root; the invoice vitest family passes unmodified (125/125).

## Capability routing — pre-edit

1–10: N/A — a pure file relocation with no capability, flow, provider, approval, event, receipt, surface or proof delta. Domain lineage: Sales (#1741/#1745) module; overlap disclosed on PR #2310 (no active branch conflict); rollback = ordinary revert.

FLOW_BY_FLOW: PASS: no flow touched; the only behavioral contract is import resolution, proven by the passing unmodified suites.
PAIGE_UI_DESIGN: PASS: no visible-interface change (no UI file's rendered logic changes; only module specifiers). Impeccable not applicable beyond this declaration: no design surface touched.
MATERIAL_FLOW_CHANGE: NO: import-path relocation only.
FLOW_PROTOTYPE: NOT_REQUIRED: import-path relocation with MATERIAL_FLOW_CHANGE NO; no flow exists to prototype.
PURPOSE_AUDIENCE_PRIMARY_ACTION: NOT_APPLICABLE: no user-facing surface changes; the audience and action of every invoice screen are untouched.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change; the incumbent direction is preserved byte-for-byte.
MOTION_PURPOSE: NONE: no motion touched.
AUTOMATED_EVIDENCE: PASS: 125/125 invoice-family vitest (snapshot/api/editor/workspace/endpoint) on the relocated module; deno check on the rewired sales-invoice-draft-command graph; verifier closure proof (29 files, 0 outside the functions root).
STATIC_EVIDENCE: PASS: scoped ESLint clean on touched source files; module byte-identity proven (only the two import specifier lines differ).
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered delta (import relocation with identical component logic).
BEHAVIORAL_EVIDENCE: PASS: the unmodified invoice suites exercise the relocated module through its real importers; no behavior differs from main.
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated surface changed; nothing new to verify at runtime — the existing invoice flows carry their own prior evidence boundaries.
KEYBOARD_FOCUS: NOT_APPLICABLE: no rendered or interactive change; focus behavior is byte-identical (module relocation only).
ZOOM_REFLOW: NOT_APPLICABLE: no rendered change exists to reflow.
REDUCED_MOTION: NOT_APPLICABLE: no motion-relevant change.
STATE_COVERAGE: NOT_APPLICABLE: no component state changed; the unmodified 125/125 invoice-family suite is the behavioral coverage.
TRUTHFUL_STATE_LABELS: NOT_APPLICABLE: no label, claim or state surface touched.
SOLO_UI: YES: touched files sit under recognized Solo UI paths (src/solo/sales/*); this record covers them.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: no rendered delta — component logic byte-identical; only module specifiers changed (proven by 125/125 unmodified invoice-family tests).
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same — no rendered delta exists to capture.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: same.
UNVERIFIED: nothing new — this change introduces no unverified behavior; the pre-existing sales-invoice-snapshot-proof.mjs manual cluster proof remains the Sales owner's debt (disclosed on the PR).

INTERNAL_BUILD_IDENTITY: 593217d40c1b7f0eeadb463109ea872b44b47cb9; deployment=NOT_DEPLOYED; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(sales-invoice-draft-command redeploys source-identical on merge via deploy-edge-functions and the blocked global edge-live certification this PR repairs is verified advancing after merge); evidence=this record plus the closure/deno/test proofs on PR #2310.
RELEASE_CHANNEL: development: isolated repair proof and the normal reviewed merge/deploy workflow; no hosted activation beyond it.
RELEASE_CLASSIFICATION: internal-only: release-infrastructure repair, no customer announcement.
CUSTOMER_RELEASE_IDENTITY: none: internal release-infrastructure repair with no customer-facing surface.
RELEASE_NOTE_REQUIRED: NO: internal release-infrastructure repair with no customer release identity or publication decision.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: the governed status is edge source-identity certification — verified clean only through the local closure proof, deno check and 125/125 invoice-family tests; hosted exact-head CI and the post-merge edge certification remain the claim boundary. No customer-facing capability claim is made or implied.
RELEASE_RECOVERY: position=ordinary reviewed revert of the 14-file slice; reference=docs/evidence/ui-delivery/edge-invoice-snapshot-relocation.md; no database, provider or configuration effect.
