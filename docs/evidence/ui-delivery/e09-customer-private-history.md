# Customer private Chat record boundary

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Existing E09 customer assistant audience contract and the approved invitation-to-customer Chat outcome; native identity, history, interruption and revocation are one flow.
PAIGE_UI_DESIGN: PASS: Existing approved PAIGE shell/Chat is preserved; this prerequisite changes no component, layout, navigation or interaction container.
MATERIAL_FLOW_CHANGE: NO: Adds an unmounted customer audience to the incumbent thread API; existing callers continue to create workspace threads.
FLOW_PROTOTYPE: NOT_REQUIRED: No UI mounting or visual flow change in this bounded prerequisite; the approved customer Chat consumer follows separately.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: An authenticated linked customer can own a private, durable AI conversation in the canonical Chat tables without a staff workspace.
VISUAL_DIRECTION: PASS: Preserve the existing approved customer shell and Chat, with Impeccable applied to the later consumer.
AUTOMATED_EVIDENCE: PASS: Final isolated native PostgreSQL proof76/0, seven actual deletion-handler role/target/order/failure tests and three portable proof-path tests. Covers CRM row lock, staff/private coexistence, privileged-session privacy denial, expiry, native FK cleanup and the Auth RESTRICT boundary. Existing fully replayed pgTAP assertions are extended; final repaired-head CI remains required.
STATIC_EVIDENCE: PASS: Source review preserves existing workspace/platform creation, v2 rollout/admission, executor, terminal writer and one approval contract. No provider or action activation.
RENDERED_EVIDENCE: UNVERIFIED: No UI is mounted or changed by this prerequisite.
BEHAVIORAL_EVIDENCE: PASS: Native synthetic-role proof covers creation, return, issued turn persistence, private history, forged AI refusal, immutable audience, cross-customer denial, dual-role scope, revocation and retained receipts.
AUTHENTICATED_RUNTIME: UNVERIFIED: Hosted ordinary customer history and model exchange require the following consumer release.
KEYBOARD_FOCUS: UNVERIFIED: No control changes; following consumer proof owes actual interaction.
ZOOM_REFLOW: UNVERIFIED: No geometry changes.
REDUCED_MOTION: UNVERIFIED: No motion changes.
STATE_COVERAGE: PASS: Native tests cover authorized, missing/foreign relationship, immutable audience, receipt authority, returning and revoked access. Actual browser recovery remains owed.
TRUTHFUL_STATE_LABELS: PASS: Native foundation only; customer Chat remains PARTIAL until the runtime/browser consumer is released and driven.
SOLO_UI: NO: Customer record/API prerequisite; no Solo component or account-specific code.
UNVERIFIED: Full hosted customer Chat, provider exchange, private-history return, published Knowledge, Live and seven-pillar customer acceptance.
OWNER_INTENT: Get customer Chat working on behalf of its business, using authorized Knowledge and private history, then continue the complete seven-pillar Portal.
MUST_NOT_HAPPEN: No staff grant or active-tenant rewrite, business-admin private transcript access, second inbox/history/Memory/engine, forged AI receipts, rollout activation or privacy claim from a UI badge.
MUST_PRESERVE: Existing owner/platform/agency/workspace thread semantics, INT-346 admission/executor/settlement and source history, normal Auth and canonical CRM.
ACCEPTANCE_CRITERIA: Ordinary customer signs in, receives the right business assistant, returns to the same authorized private history, and loses access on revocation. This PR supplies only the native record boundary; complete acceptance remains owed.
MOTION_PURPOSE: NONE: No motion change.
PROTECTED_SEAMS: Affected and tested: tenant/client isolation, canonical Chat writes/readback, private history/receipt authority, retention/revocation and existing account-deletion cleanup. Existing admin/self/platform-owner authorization guards remain unchanged. Preserved native definitions: v2 rollout and executor/settlement. No signup/paywall/provisioning, effectful Spine action, Live state, Secure Browser/Vault, provider connection, external send/payment, scheduling, shell geometry or accessibility control change.
INTERNAL_BUILD_IDENTITY: bef755493aaca66a7ad3e6839987fe682f685702 is the earlier observed preview source checkpoint; deployment=dpl_GRwmZ1LovB7UuyVb2KLiMDmsC1xb; environment=preview; migrations=PROOF_OWED(20271108191000_e09_customer_private_chat repaired-head native deployment and readback); edge=PROOF_OWED(admin-delete-user repaired-head deployment and source readback with existing verify_jwt=true); evidence=scripts/proof/e09-client-self-projection.mjs --customer-chat and supabase/tests/client_portal_self_projection.sql
RELEASE_CHANNEL: preview: exact source checkpoint has a READY web preview; native Preview/CI and production release remain separately required for every equivalently eligible current/future canonical customer relationship.
RELEASE_CLASSIFICATION: internal-only: no usable customer Chat claim from this prerequisite.
CUSTOMER_RELEASE_IDENTITY: none: Complete customer Chat is not released by this change.
RELEASE_NOTE_REQUIRED: no: No announcement or customer version.
RELEASE_TRUTH_BOUNDARY: PARTIAL: native customer-private Chat foundation; consumer, hosted conversation and acceptance remain PROOF OWED.
RELEASE_RECOVERY: position=reviewed additive forward correction preserving canonical messages and protected execution; reference=AGENTS.md and docs/doctrine/release-governance-and-customer-update-policy.md

## Source and proof

The only new record field is an audience on existing paige_chat_threads. All old rows remain workspace. Customer creation reuses paige_chat_thread_create with a narrowing customer lens; the server derives its actor/contact/business from client_portal_relationship_id. The caller cannot choose a contact for this audience.

The native caller-bound helper enforces active, unmerged, unambiguous CRM membership and exact thread ownership, business, contact, audience and retention. Restrictive RLS prevents legacy staff/platform permissive policies from opening private customer text. Customer-visible turns require canonical server-issued actor/business/intent metadata; raw assistant appends are refused. Audience and identity are immutable. Existing v2 begin/publication gain this native customer branch; rollout state, effect admission, executor isolation, service-only terminal writer and retirement pins are not changed.

Run: node scripts/proof/e09-client-self-projection.mjs --customer-chat against its automatically created disposable local PostgreSQL fixture. Requires available PostgreSQL binaries (E09_PG_BIN may name their directory) and an ordinary OS user able to initialize the disposable cluster. Default output stays under the checkout's .cache directory; an explicit E09_PROJECTION_PROOF_DIR retains the existing task-workspace boundary using the shared portable path helper. These identities/table shapes are synthetic; this is not hosted JWT proof. Service-role RLS posture matches read-only production metadata; ordinary authenticated privacy tests retain non-bypass roles. Earlier failed syntax/CRLF/terminal, test-loader and service-role fixture runs are retained; guards were preserved. The fully replayed schema/ACL job executes supabase/tests/client_portal_self_projection.sql.

Automated review4300991544 identified the actual FK cleanup collision. Only the nested existing ON DELETE SET NULL action for an already-deleted contact may detach identity, preserving all other identity fields; that native path archives the retained private thread. Direct contact/audience edits remain refused. The canonical admin-delete-user writer also removes only target-authored customer_private conversations before Auth deletion, because the existing caller FK is RESTRICT. Existing admin, self and platform-owner guards, keep-contact behavior and other audiences are unchanged. No real account was deleted. Review4300991550 identified the portable path defect; the existing path helper and project-local default correct it without another proof engine.

No peer changes are copied over: this additive migration follows main's190000 frontier and extends the incumbent tests. No new capability registry, domain writer, provider, worker or message store is introduced. Exact merge/deployment/native readback will be recorded after green release.
