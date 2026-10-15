# E09 checked customer profile writer — work packet

Status: development work in progress; NOT RELEASED. Owner approved the complete Portal design and instructed deployment on October14,2026. This is a bounded prerequisite, not the complete Portal.

UI_DELIVERY_EVIDENCE_VERSION: 1
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: authenticated customer writes only permitted personal fields and canonical primary phone with version-bound audit and safe readback
VISUAL_DIRECTION: PASS: approved existing Portal direction; no markup, geometry or navigation change in this additive backend prerequisite
AUTOMATED_EVIDENCE: PASS: project-owned native PostgreSQL candidate28PASS0FAIL; missing-contract baseline1PASS25FAIL; actual helper bodies, role/isolation/validation/stale/rollback/concurrency and migration twice checked; managed full-schema CI separately owed
STATIC_EVIDENCE: PASS: Node syntax, whitespace, definer signature/ACL checks; migration lint1file0errors1advisory for checked INSERT metadata, no nullable required target values
RENDERED_EVIDENCE: UNVERIFIED: no UI source changed or customer view rendered for this backend contract
BEHAVIORAL_EVIDENCE: UNVERIFIED: browser caller adoption is the following bounded slice; isolated SQL behavior is not browser evidence
AUTHENTICATED_RUNTIME: UNVERIFIED: legitimate external-client identity and production profile/reload acceptance not exercised
KEYBOARD_FOCUS: UNVERIFIED: no keyboard or markup change in this backend slice
ZOOM_REFLOW: UNVERIFIED: no layout change or native viewport proof in this slice
REDUCED_MOTION: UNVERIFIED: no motion change or preference proof in this slice
STATE_COVERAGE: PASS: local actual-role SQL covers valid save, absent/foreign/revoked/archived/merged/inactive relationship, anonymous/subjectless service, malformed/private fields, stale write, late rollback, phone preservation/promotion and one-winner concurrency
TRUTHFUL_STATE_LABELS: PASS: full Portal remains PARTIAL; writer unmounted and NOT_DEPLOYED; no external activation or customer LIVE claim
UNVERIFIED: exact-head independent review and hosted full-schema CI, production migration/body/ACL readback, frontend adoption, external identity and seven-pillar end-to-end acceptance remain owed
FLOW_BY_FLOW: PASS: complete routed workflow applied; profile save/readback and authority mapped before implementation
PAIGE_UI_DESIGN: PASS: existing personal-information user outcome and protected behavior reviewed; no visible source changed
MATERIAL_FLOW_CHANGE: NO: additive backend contract for existing approved personal-information save; no new UI step, choice, route or confirmation
FLOW_PROTOTYPE: NOT_REQUIRED: this prerequisite changes no visible interaction; complete Portal owner/customer preview separately approved October14
SOLO_UI: NO: no owner or customer UI rendering source edited
OWNER_INTENT: complete secure branded AI Portal; this slice closes only canonical own-profile/phone persistence, without narrowing the remaining required outcome
MUST_NOT_HAPPEN: private CRM or foreign changes, identity/link/email/staff changes, silent phone loss, stale overwrite, partial profile/phone/audit commit, fake saved or production claims
MUST_PRESERVE: canonical CRM/contact methods and their permissions, existing staff behavior, active/merge relationship guards, applied migration history and all seven pillars
ACCEPTANCE_CRITERIA: actual authenticated synthetic customer with no staff/raw table rights saves only own allowlisted fields; canonical phone and audit persist; invalid/stale/foreign/late-failure calls roll back; safe projection reloads exact own fields
MOTION_PURPOSE: NONE: no motion or UI source changed
PROTECTED_SEAMS: auth subject, client/tenant isolation, canonical primary methods, stale version, private field preservation, exact audit and rollback tested. Unchanged: signup/provisioning/entitlements/paywall; Trust/approval/Spine execution admission; Chat/Live; Memory/Vault/browser; provider and payment effects; scheduling; E03/E04/E05 domain implementations and shell geometry.
INTERNAL_BUILD_IDENTITY: development-source candidate; base=c576b8e6debbcf348402d17f20288ab33df695c1; deployment=NOT_DEPLOYED; migration=20271102120000_e09_client_self_profile_write(PROOF_OWED); edge=NOT_APPLICABLE; proof=scripts/proof/e09-client-self-write.mjs
RELEASE_CHANNEL: development: isolated actual-role native PostgreSQL proof, not managed/authenticated production proof
RELEASE_CLASSIFICATION: internal-only: additive checked self-profile writer prerequisite
CUSTOMER_RELEASE_IDENTITY: none: complete Portal outcome not accepted
RELEASE_NOTE_REQUIRED: no: no complete customer release or publication in this slice
RELEASE_TRUTH_BOUNDARY: PROOF OWED: native SQL proof does not establish frontend adoption, managed schema deployment, legitimate client authentication or complete Portal acceptance
RELEASE_RECOVERY: reviewed forward fix; retain safe-reader/relationship checks and canonical phone integrity; never reopen raw self CRM writes

Impeccable source: https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/SKILL.md . Existing-world direction, state honesty and protected contract checks applied. No visual detector target or rendered finish verdict is claimed for this SQL-only slice.

## Pre-edit capability routing

1. Outcome: an authenticated customer saves their own permitted personal details and primary phone to the canonical CRM/contact methods, with stale-version refusal, safe readback and attributed audit.
2. Owner: E09 Clients/Portal. Existing Identity and CRM helper contracts remain unchanged. E03, E04 and E05 sources excluded.
3. Shared layers: existing Auth subject, accepted canonical client linkage, database authority and readback. Broader Harness/Portal integration remains PARTIAL; no replacement execution layer.
4. Spine: a governed client-self-profile mutation key is UNAVAILABLE in the current registry. This additive checked RPC is the existing manual-profile flow's missing backend seam. It does not admit an AI mutation or claim Chat/Live completion.
5. Provider: NOT_APPLICABLE; no external effect or connection change.
6. Authority: auth.uid-bound client relationship, active/unmerged contact and active tenant, optional tenant narrowing only. Partial allowlisted fields and expected updated_at; no client ID, actor, email, lifecycle, staff, consent, invitation or arbitrary field input. No new approval mechanism.
7. Jobs/events: no job, scheduler or new event system.
8. Receipt: existing canonical clients/contact methods, existing audit_logs with actor/tenant/client and field names only, safe profile readback. Complete Rail/AI convergence remains owed.
9. Surface: existing client Account/Welcome personal-information flow. Binding Ledger clients.portal remains PARTIAL; this change alone adds no visible availability claim.
10. Proof: real caller roles in native PostgreSQL with actual committed helper bodies, full-schema pgTAP in the existing database-contract job, wrong-subject/tenant/role, inactive/merged/revoked, invalid input, stale version, rollback and private-field preservation. Production/authenticated browser proof stays UNVERIFIED until executed.

## Locked technical contract

`client_portal_update_self_profile(p_expected_updated_at timestamptz, p_profile jsonb, p_tenant_id uuid default null) -> jsonb`

The server resolves the client from auth.uid(), locks it and its active tenant, compares the loaded timestamp before any mutation, accepts only first_name/last_name/street_address/city/state/zip_code/phone, uses the existing checked contact-method helpers for a provided primary phone, and returns the existing explicit safe projection. Omitted fields stay unchanged; null postal fields clear; provided names/phone must be nonblank strings. It never changes email or linkage. Any failure rolls the entire call back, including phone, profile and audit. Existing Welcome intake and stage writers remain separate work; this RPC does not claim their atomicity or make external joins available.

## Owner intent and preservation

Must happen: real canonical save and reload with truthful refusal/retry, no silent lost phone. Must not happen: raw CRM field mutation, staff standing, email matching, cross-tenant write, private values in audit or direct shared helper grants to customers. Preserve all existing domain contracts, applied migration history, staff CRM behavior, signed agreements, billing, scheduling, and the approved Portal design. No UI geometry change in this backend slice.
