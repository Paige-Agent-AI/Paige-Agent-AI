# UI delivery evidence: EXP03 a managed address a business gives up is never issued to another business

The commit range carries a `Visible-Flow-Impact: yes` trailer from already-merged EXP03 commits, recorded as history by an "ours" merge after the #2983 squash. This change is a database rule plus records; no UI file changed. It changes what an owner sees in two narrow cases.

- **Solo Setup's address check:** a name whose address another business gave up now reads as unavailable, through the existing "This managed email is unavailable. Check another name." state.
- **A business named like a retired address:** when it is created or renamed, it receives a numbered variant (`name-2@mail.paigeagent.ai`) instead of the old address. Creating or renaming still succeeds.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow packet in this PR. Actors: business A's owner renaming or registering a name, business B that gave the address up, PAIGE's provisioning, a new business signing up. Goal: replies to B's past mail never reach another business. Central act: provisioning a managed address. Exits mapped: B renames (address retired to B), A renames to B's old slug (numbered variant), any writer sets B's retired address on another business's connector (refused 23505), Solo Setup checks B's old name (unavailable) or a free name (available), B takes its own address back (allowed), a new business with a retired slug (created, numbered variant), a deleted connector (address retired).
PAIGE_UI_DESIGN: PASS: paige-ui-design router read. No visual surface, pack, token or layout is added or changed; the unavailable state already exists in Solo Setup.
MATERIAL_FLOW_CHANGE: NO: no screen, state, transition or exit is added or removed. An existing "unavailable" result is returned for one more reason.
FLOW_PROTOTYPE: NOT_REQUIRED: no interface state, copy or transition changes.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is every business with a PAIGE-managed address. Primary action: replies reach only the business that sent the original email. Purpose: close the address-reuse path found by the #2983 review.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual surface changed
AUTOMATED_EVIDENCE: PASS: `supabase/tests/managed_address_never_reissued.sql`, run by paige-spine-contract on the rebuilt database. Failing-first on production inside a rolled-back transaction: without the migration, after B renamed, A renaming to B's old slug was given B's old address (`FAIL: 3 ... A has: mani-b@mail.paigeagent.ai`).
STATIC_EVIDENCE: PASS: the two replaced function bodies were extracted verbatim from the migrations that last defined them, and their md5 matched production before editing; migration-version-collision-lint, definer-fn-lint and view-security-invoker-lint pass.
RENDERED_EVIDENCE: NOT_APPLICABLE: no visual surface is rendered or changed.
BEHAVIORAL_EVIDENCE: PASS: the proof drives the real paths: provisioning through the tenants trigger on insert and on a browser rename, Solo Setup's availability RPC as a signed-in owner, a direct connector write as the service role, a connector delete, and a browser read of the retired list.
AUTHENTICATED_RUNTIME: UNVERIFIED: the with-migration proof runs in CI on the rebuilt database; after merge the deploy-migrations pipeline applies it and the backfilled row count is read back on production.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive visual surface changed
ZOOM_REFLOW: NOT_APPLICABLE: no visual surface changed
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: each state is covered by an assertion:
- B renames: the address follows the rename and the old one is retired to B
- A renames to B's old slug: the rename succeeds and A gets the numbered variant
- direct claim of B's retired address: refused
- Solo Setup: B's old name unavailable, a free name available
- B takes its own address back: allowed
- new business with a retired slug: created with a numbered variant
- connector deleted: its address retired
- browser read of the retired list: refused
TRUTHFUL_STATE_LABELS: PASS: a refused claim raises 23505 `PAIGE_MANAGED_ADDRESS_RETIRED` naming the address; Solo Setup says unavailable rather than offering an address it would then refuse.
SOLO_UI: NO: no Solo interface file changed; the Setup screen's existing unavailable state is reused
UNVERIFIED: the with-migration proof on production data (CI runs it); the business web hostname <slug>.paigeagent.ai is still reused when a slug is freed (separate surface, not changed here)

OWNER_INTENT: the owner (Antonio, 2026-10-27) asked that the review's remaining address-claim path be closed after approving the inbound routing guard.
MUST_NOT_HAPPEN: a business receiving replies to another business's past mail; signup or a business rename failing because a name was used before; an existing business losing its current address
MUST_PRESERVE: managed-sender provisioning on create and rename; Solo Setup registration of a free name; a business reclaiming its own old address
ACCEPTANCE_CRITERIA: after merge, a released managed address is never provisioned to another business, and creating or renaming a business still succeeds
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: provision_paige_managed_email_connector (body identical to 20270602000104 apart from the retired-address step); check_solo_setup_managed_email (identical to 20261104000000 apart from one clause); the #2983 inbound routing guard

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: 16cd2f2119a71d5e3944f54b5879f7929ad44b47; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20271118100000 applies on merge via deploy-migrations); edge=NOT_APPLICABLE; evidence=this-PR-checks-and-the-proof-above
RELEASE_CHANNEL: development: code on the PR branch; the migration applies to production on merge via deploy-migrations (pre-launch §4 stance)
RELEASE_CLASSIFICATION: patch: closes an address-reuse path; no new capability
CUSTOMER_RELEASE_IDENTITY: none: internal security hardening, no owner-decided customer release
RELEASE_NOTE_REQUIRED: NO: nothing a customer sees changes for an existing business
RELEASE_TRUTH_BOUNDARY: PARTIAL: rule LIVE after the migration applies; with-migration proof on production data PROOF OWED
RELEASE_RECOVERY: position=forward-fix only — drop trg_refuse_retired_managed_address and trg_retire_channel_connector_managed_address and restore the two function bodies from the migrations named in the header; reference=this PR and docs/brain/config-registry.md

## Scope and collisions

- Classification: database rule and records; no UI or edge source file changed.
- Neighbouring regressions: provisioning on create and rename (asserted), Solo Setup availability for a free name (asserted), the #2983 guard (provisioning still runs as postgres).
- Active-owner/file collisions: none; built on origin/main `74839345`.
- Explicit exclusions: the reused business web hostname; a release path for a retired address (service-role delete only).

## Evidence index

- `supabase/tests/managed_address_never_reissued.sql`: wired into paige-spine-contract.
- Failing-first on production (rolled back): assertion 3 fails without the migration.
- Redacted: no secrets or customer data in this record; the one backfilled address is not named.

## Review and limitations

The with-migration proof has not run on production; CI runs it on the rebuilt database with production's grants reproduced.
