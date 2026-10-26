# UI delivery evidence: EXP10 PR12 — live-destination eligibility data module + Stream/R2 registry + canary source

Covers THIS branch's delta: three files, none of which renders. `src/solo/live-destination-eligibility.ts`
triggers this gate by path (src/solo), so this record documents the truth: the module is DATA-ONLY —
constant tables (per-platform live-broadcast eligibility + playback support) imported by nothing in this
changeset; EXP07/EXP06 surface them in later PRs. The registry JSON adds the Cloudflare Stream (PROOF_OWED,
bounded) and Cloudflare R2 (UNAVAILABLE, unprovisioned) rows. The canary source file commits the deployed
cf-stream-verify v1 bytes verbatim (read-back compared byte-for-byte; source sha256 f3b84ece…).

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: no rendered flow exists in this delta — the module is data-only (imported by nothing in src, scripts, supabase or tests); the flow inventory for this changeset is empty by construction.
PAIGE_UI_DESIGN: PASS: Impeccable context + craft-floor loaded this session (standing EXP10 discipline); this delta changes zero component, style-token or layout bytes — the incumbent design system is untouched, and future consumers render these states in existing idioms.
MATERIAL_FLOW_CHANGE: NO: nothing a customer sees changes — a data module, two registry rows, and a read-only canary's committed source.
FLOW_PROTOTYPE: NOT_REQUIRED: non-material; no flow exists in this delta to prototype.
PURPOSE_AUDIENCE_PRIMARY_ACTION: NOT_APPLICABLE: nothing renders for any user in this changeset; the module's audience is the consuming PRs (EXP07 brief/scheduling, EXP06 embed binding), each of which carries its own record.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual bytes change.
AUTOMATED_EVIDENCE: PASS: registry lint green on this exact tree (node scripts/ci/integration-registry-lint.mjs — 38 providers, 125 anchors all resolving) and this evidence gate itself runs on the CI head.
STATIC_EVIDENCE: PASS: ts.transpileModule clean on the edited module (0 diagnostics); registry JSON re-serialized and lint-clean.
RENDERED_EVIDENCE: NOT_APPLICABLE: nothing renders in this delta.
BEHAVIORAL_EVIDENCE: NOT_APPLICABLE: the module has no runtime behavior until a consumer imports it.
AUTHENTICATED_RUNTIME: NOT_APPLICABLE: no authenticated surface is touched.
KEYBOARD_FOCUS: NOT_APPLICABLE: no focusable change.
ZOOM_REFLOW: NOT_APPLICABLE: no layout change.
REDUCED_MOTION: NOT_APPLICABLE: no motion change.
STATE_COVERAGE: PASS: the module enumerates every platform's state explicitly (live table covers all six platforms; playback table covers the four watching surfaces); there is no default or implicit state — a missing row is a compile error for consumers, not a silent fallback.
TRUTHFUL_STATE_LABELS: PASS: the vocabulary is the registry's own; the module's in-file cardinal rule keeps a connected account from ever implying live ability; Facebook/YouTube/Twitch name their missing mechanisms (YouTube names youtube.force-ssl, the real live-capable grant); LinkedIn/TikTok/Instagram carry the partner-gating truth.
SOLO_UI: YES: src/solo/live-destination-eligibility.ts lives under the Solo surface tree; it renders nothing today — the first PR that renders these states carries the viewport gates.
SOLO_1536X770_PAIGE_CLOSED: NOT_APPLICABLE: the module renders nothing at any viewport; viewport gates attach to the first rendering PR.
SOLO_1536X770_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1366X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_1024X768_PAIGE_OPEN: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_CLOSED: NOT_APPLICABLE: same.
SOLO_900X1000_PAIGE_OPEN: NOT_APPLICABLE: same.
UNVERIFIED: verified on the exact head: registry lint, transpile-clean module, this record's gate; no rendered or behavioral proof exists or is claimed for a data-only module; the canary's live read-back evidence is recorded in the registry dependency and the ANT-164 checkpoint — none of that is re-claimed here.
OWNER_INTENT: owner directives 2026-10-24/25 — Stream/R2 assessed as separate services (R2 only for a demonstrated requirement), live-destination eligibility with honest states, the deployed canary source committed for the identity chain, YouTube/Vimeo/PAIGE-hosted playback as distinct requirements.
MUST_NOT_HAPPEN: a connected account must never imply live ability; the module must never render or be imported by a rendering PR without that PR carrying its own evidence record; R2 must stay unprovisioned; the token must never cross to a customer or into any response.
MUST_PRESERVE: the registry lint invariants (PROOF_OWED needs anchors; UNAVAILABLE is prohibited-only with no anchors); the canary's GET-only, closed-vocabulary contract — the committed bytes must stay the deployed v1 bytes.
ACCEPTANCE_CRITERIA: a future consumer can import the module and render a truthful per-platform answer (mechanism, missing requirements, honest note) with zero additional research; an auditor can sha256 the canary file and get f3b84ece… matching the registry note.
MOTION_PURPOSE: NONE: no motion change.
PROTECTED_SEAMS: NONE_AFFECTED: the gateway, Vault, Spine and Systems Check engine are untouched; this delta adds truth tables and a source-of-record only.

INTERNAL_BUILD_IDENTITY: a2ba00a504a0790e7fe500c0b0857f9ad491e4c6 (exp10-pr12-stream-eligibility changeset on origin/main dd6496a8f); deployment=vercel-preview-per-push; environment=preview; migrations=NOT_APPLICABLE; edge=APPLIED(cf-stream-verify@v1); evidence=docs/evidence/ui-delivery/exp10-stream-eligibility-data-module.md
RELEASE_CHANNEL: preview: unmerged branch; Vercel preview deploys per push only
RELEASE_CLASSIFICATION: internal-only: registry rows + a data module + the canary source of record; no customer release identity until a consuming PR renders eligibility
CUSTOMER_RELEASE_IDENTITY: none: internal-only
RELEASE_NOTE_REQUIRED: NO: internal-only until a consumer surfaces the eligibility states
RELEASE_TRUTH_BOUNDARY: PROOF OWED: live broadcasting, two-way guests and tenant isolation are owed by EXP07's implementation PRs; this delta's verified facts are backend read access (canary) plus honest eligibility data
RELEASE_RECOVERY: position=revert-restores-prior-registry-and-module-state; reference=this record plus the revert commit
