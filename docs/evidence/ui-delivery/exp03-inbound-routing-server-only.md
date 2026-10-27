# UI delivery evidence: EXP03 inbound routing fields are written by PAIGE's server code only

The commit range carries a `Visible-Flow-Impact: yes` trailer. The trailers come from already-merged EXP03 commits, recorded as history by an "ours" merge after the #2978 squash. This change is a database guard with no UI file changed, and it changes nothing an owner sees in normal use.

- **Nothing on screen changes.** The app only reads `channel_connectors.inbound_address` / `inbound_domain`; no screen writes them. A direct browser write of either column, made outside the app, is now refused with `PAIGE_INBOUND_ROUTING_PROTECTED`.
- **Renaming a business still moves its managed address.** The rename runs PAIGE's SECURITY DEFINER provisioning from the owner's own write, which the guard deliberately allows.

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow packet in PR #2983. Actors: a business admin signed in to the app, PAIGE's server code (edge functions and SECURITY DEFINER provisioning). Goal: only PAIGE decides which address or domain delivers mail to a business. Central act: a write to the two routing columns. Exits mapped: browser insert with either column set (refused), browser change of either column (refused), browser edit of any other column (allowed), browser insert with neither column (allowed), business rename from the app (managed address moves), service-role write (allowed).
PAIGE_UI_DESIGN: PASS: paige-ui-design router read. No visual surface, pack, token or layout is added or changed.
MATERIAL_FLOW_CHANGE: NO: no screen, state, transition or exit is added or removed. No app path writes the guarded columns from a browser session (src/ only reads them).
FLOW_PROTOTYPE: NOT_REQUIRED: no interface state, copy or transition changes. Not a convenience skip: the change is a database write guard.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: audience is every business with an email connector (9 with an inbound address on production, read-only query). Primary action: replies keep reaching only the business they were addressed to. Purpose: stop a workspace admin claiming an unheld managed address or customer domain and receiving its mail.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual surface changed
AUTOMATED_EVIDENCE: PASS: `supabase/tests/channel_connector_inbound_routing_server_only.sql`, run by paige-spine-contract on the rebuilt database. Failing-first on production inside a rolled-back transaction: without the migration the fixture and assertion 1 pass and assertion 2 fails (the owner's browser write of inbound_address succeeded).
STATIC_EVIDENCE: PASS: migration-version-collision-lint PASS; definer-fn-lint PASS; view-security-invoker-lint PASS. The guard is SECURITY INVOKER with EXECUTE revoked from PUBLIC, anon and authenticated.
RENDERED_EVIDENCE: NOT_APPLICABLE: no visual surface is rendered or changed.
BEHAVIORAL_EVIDENCE: PASS: the proof drives the real paths: the owner's browser session editing a non-routing column, setting and changing each routing column, inserting connectors with and without them, renaming the business through `tenants` (the real trigger into `provision_paige_managed_email_connector`), and a service-role write. An independent adversarial review is running on the PR.
AUTHENTICATED_RUNTIME: UNVERIFIED: the with-migration proof has not run on production; it runs in CI on the rebuilt database. After merge the deploy-migrations pipeline applies it and the trigger's presence on production is checked.
KEYBOARD_FOCUS: NOT_APPLICABLE: no interactive visual surface changed
ZOOM_REFLOW: NOT_APPLICABLE: no visual surface changed
REDUCED_MOTION: NOT_APPLICABLE: no motion added or changed
STATE_COVERAGE: PASS: each state is covered by an assertion:
- browser edit of a non-routing column (allowed)
- browser change of inbound_address (refused)
- browser set of inbound_domain (refused)
- browser insert with inbound_address (refused)
- browser insert with inbound_domain (refused)
- browser insert with neither (allowed)
- business rename from the app (managed address moves)
- service-role write (allowed)
TRUTHFUL_STATE_LABELS: PASS: a refused write raises 42501 with a reason naming the protected columns; nothing is silently dropped or rewritten.
SOLO_UI: NO: no Solo interface file changed; database guard only
UNVERIFIED: the with-migration proof on production data (CI runs it on the rebuilt database); a per-business DNS ownership proof before a custom inbound_domain is accepted is still not built

OWNER_INTENT: the owner (Antonio, 2026-10-27) approved restricting the incoming-address fields so only PAIGE's server code can set which address a business owns.
MUST_NOT_HAPPEN: a business admin claiming an address or domain another business should receive; a business rename from the app failing; an existing connector being changed or refused by the migration
MUST_PRESERVE: managed-sender re-provisioning on a business rename; Gmail connect and disconnect; domain verify and unverify connector updates; admin edits of other connector columns
ACCEPTANCE_CRITERIA: after merge, a browser write of either routing column is refused, and renaming a business still updates its managed address
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: the six SECURITY DEFINER writers (provision_paige_managed_email_connector, provision_gmail_connection, disconnect_gmail_connection, provision_email_connector_on_verify, deactivate_email_connector_on_domain_delete, deactivate_email_connector_on_domain_unverify); the service role used by edge functions

<!-- RELEASE_GOVERNANCE_POLICY — read docs/doctrine/release-governance-and-customer-update-policy.md -->
INTERNAL_BUILD_IDENTITY: eb64221fbe1f23105f25cebba09cb0b543f57aeb; deployment=none-pre-merge; environment=development; migrations=PROOF_OWED(20271118090000 applies on merge via deploy-migrations); edge=NOT_APPLICABLE; evidence=PR-2983-checks-and-the-proof-above
RELEASE_CHANNEL: development: code on the PR #2983 branch; the migration applies to production on merge via deploy-migrations (pre-launch §4 stance)
RELEASE_CLASSIFICATION: patch: closes a write path; no new capability
CUSTOMER_RELEASE_IDENTITY: none: internal security hardening, no owner-decided customer release
RELEASE_NOTE_REQUIRED: NO: nothing a customer sees changes
RELEASE_TRUTH_BOUNDARY: PARTIAL: guard LIVE after the migration applies; with-migration proof on production data PROOF OWED; custom-domain ownership proof UNAVAILABLE
RELEASE_RECOVERY: position=forward-fix only — DROP TRIGGER trg_guard_channel_connector_inbound_routing ON public.channel_connectors removes the guard without touching data; reference=PR #2983 and docs/brain/config-registry.md

## Scope and collisions

- Classification: database guard; no UI or edge source file changed.
- Affected flows: none on screen; writes to two connector columns from a browser session.
- Neighbouring regressions: managed-sender re-provision on rename (asserted), other connector columns (asserted), service-role writes (asserted).
- Active-owner/file collisions: none; built on origin/main `1ad5f13c`.
- Explicit exclusions: a per-business DNS ownership proof for custom inbound domains.

## Evidence index

- `supabase/tests/channel_connector_inbound_routing_server_only.sql`: wired into paige-spine-contract.
- Failing-first on production (rolled back): assertion 2 fails without the migration.
- `node scripts/ci/migration-version-collision-lint.mjs`: PASS.
- `npm run lint:definer-fns`, `npm run lint:views`: PASS.
- Redacted: no secrets or customer data in this record.

## Review and limitations

The with-migration proof did not run on production because the database tool's confirmation prompt timed out; CI runs it on the rebuilt database with production's grants reproduced.
