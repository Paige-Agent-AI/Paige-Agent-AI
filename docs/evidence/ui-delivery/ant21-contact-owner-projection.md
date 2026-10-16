# SOLO People canonical contact owner projection

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: existing native contact assignment -> tenant-scoped clients read -> existing SOLO People list/detail owner label; no writer or workflow change.
PAIGE_UI_DESIGN: PASS: project UI skill and routed modules read; existing People geometry, controls, neutral labels and coach semantics preserved. Impeccable context, craft-floor and clarification guidance applied; changed-file detector passed.
MATERIAL_FLOW_CHANGE: NO: correct the source of an existing assignment label without changing an action, step, state, exit or consequence.
FLOW_PROTOTYPE: NOT_REQUIRED: bounded canonical-field projection correction; no new interaction or design direction.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: every eligible current and future SOLO owner can inspect whether a contact has a native contact owner in the existing People surface.
VISUAL_DIRECTION: PASS: preserve the existing People presentation and the existing Assigned owner / Unassigned labels; no component, CSS, icon, motion or geometry edit.
AUTOMATED_EVIDENCE: PASS: failing-first hook run reproduced six failures; repaired hook and neighboring People/ClientStanding tests pass 96 tests across three files, including 22 hook tests.
STATIC_EVIDENCE: PASS: focused ESLint, changed-file Impeccable detector and git diff --check; product source diff is limited to the owner column and SOLO mapping mode. No migration, policy, permission, shared executor or source fingerprint change.
RENDERED_EVIDENCE: UNVERIFIED: no browser render or viewport capture performed in this isolated source task; automated React mounts do not certify rendered geometry.
BEHAVIORAL_EVIDENCE: UNVERIFIED: native assignment followed by authenticated People list/detail inspection remains owed; the automated suite uses the existing hook and a deferred SDK fixture.
AUTHENTICATED_RUNTIME: UNVERIFIED: production calls and ordinary customer QA are outside this isolated task; fixture reads do not prove native RLS or deployed UI behavior.
KEYBOARD_FOCUS: UNVERIFIED: controls and focus source are unchanged; no browser keyboard certification performed.
ZOOM_REFLOW: UNVERIFIED: no markup/style change; actual zoom/reflow remains unobserved.
REDUCED_MOTION: UNVERIFIED: no motion change; no browser reduced-motion observation performed.
STATE_COVERAGE: PASS: owner-only, coach-only, both and neither across SOLO list/deep-link reads; legacy roster matrix; exact closed columns; explicit tenant/contact filters; wrong-tenant absent read; account-switch, delayed-response and sign-out regression coverage.
TRUTHFUL_STATE_LABELS: PASS: SOLO owner assignment comes from clients.lead_owner_user_id; coach-only does not imply contact ownership; no identity name, notification, saved mutation, deployment or production success is inferred.
SOLO_UI: YES: existing shared SOLO People owner label in list and selected-contact detail; no layout or navigation change.
SOLO_1536X770_PAIGE_CLOSED: UNVERIFIED: no authenticated viewport observation in this source-only lane.
SOLO_1536X770_PAIGE_OPEN: UNVERIFIED: no authenticated viewport observation in this source-only lane.
SOLO_1366X768_PAIGE_CLOSED: UNVERIFIED: no authenticated viewport observation in this source-only lane.
SOLO_1366X768_PAIGE_OPEN: UNVERIFIED: no authenticated viewport observation in this source-only lane.
SOLO_1024X768_PAIGE_CLOSED: UNVERIFIED: no authenticated viewport observation in this source-only lane.
SOLO_1024X768_PAIGE_OPEN: UNVERIFIED: no authenticated viewport observation in this source-only lane.
SOLO_900X1000_PAIGE_CLOSED: UNVERIFIED: no authenticated viewport observation in this source-only lane.
SOLO_900X1000_PAIGE_OPEN: UNVERIFIED: no authenticated viewport observation in this source-only lane.
UNVERIFIED: distinct final-head review, hosted CI, deployment, paired ordinary SOLO native assignment/readback and browser acceptance remain owed; no LIVE capability or owner acceptance claimed.
OWNER_INTENT: an ordinary eligible SOLO owner sees the canonical contact assignment in existing People after native contact.assign_owner; the existing shared product applies to all eligible current/future accounts.
MUST_NOT_HAPPEN: showing a coach as the contact owner, showing a real contact owner as Unassigned, fetching owner names/profiles, broadening data permissions, changing cache refresh policy, or modifying other active lanes.
MUST_PRESERVE: assignedCoachUserId, original legacy/non-SOLO roster select and coach-based projection, account-keyed list/detail reads, tenant/contact predicates, existing labels/geometry, native writer/Spine/Harness/approval/receipt contracts and all unrelated work.
ACCEPTANCE_CRITERIA: native lead_owner_user_id set with coach null displays Assigned owner in authenticated SOLO People list/detail; coach-only displays Unassigned; both/neither are truthful; an account switch clears prior data and late old responses cannot replace the active account; legacy roster behavior remains intact.
MOTION_PURPOSE: NONE: projection-only repair adds no motion.
PROTECTED_SEAMS: affected canonical readback/display, tenant/account/client isolation and privacy are tested through the hook and closed query contract; authentication/account-choice implementation is unchanged while account-transition presentation is tested. Not affected: entitlement/signup/paywall/billing/provisioning; approval/autonomy/authority; Spine execution and canonical writes; Rail/receipts/audit/Memory; Chat scroll/stream/message/thread/pop-out/history; Live state; Browser/Vault/credentials; provider/integration/external effects; durable jobs/retries/idempotency; responsive shell geometry and accessibility controls. Browser geometry/accessibility remain UNVERIFIED.
INTERNAL_BUILD_IDENTITY: 8232051a66d5a26446a8ae6dd139743debd0c808 exact main base; candidate=commit accompanying this record, with immutable final SHA returned in handoff; deployment=NOT_APPLICABLE; environment=development; migrations=NOT_APPLICABLE; edge=NOT_APPLICABLE; evidence=docs/evidence/ui-delivery/ant21-contact-owner-projection.md
RELEASE_CHANNEL: development: isolated candidate; root owns composition, distinct review and release.
RELEASE_CLASSIFICATION: patch: restore truthful owner projection behind the existing People interface.
CUSTOMER_RELEASE_IDENTITY: none: isolated repair has no customer release or publication claim.
RELEASE_NOTE_REQUIRED: no: internal source candidate; any integrated release wording requires actual released proof.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: production deployment and ordinary authenticated canonical assignment -> People owner readback; no LIVE or acceptance claim from fixtures.
RELEASE_RECOVERY: position=revert the bounded hook projection and its tests together without domain data, approval, policy or provider state changes; reference=source diff against 8232051a66d5a26446a8ae6dd139743debd0c808.

## Source, collision and contract grounding

- Fresh GitHub read inspected changed-file lists for all 45 open PRs before editing; none
  touched this hook or its existing test. The isolated worktree starts at main base above.
- Existing native `contact.assign_owner` / `crm_assign_contact_owner` writes contact ownership
  to `clients.lead_owner_user_id`; coaching remains `assigned_coach_user_id`. Their native writer,
  `contact.crm_assign_contact_owner` Spine path, Harness, approval, readback and receipt contracts
  are untouched. No provider, job, registry, grant, policy, role or store is added.
- Only the SOLO closed select gains `lead_owner_user_id`. The existing `owner` string reports
  assignment without a name lookup or exposing another owner identity field. The original roster
  select and mapping remain unchanged. Both reads retain the existing caller client and explicit
  authoritative tenant filters; direct detail also retains the contact-ID filter.
- Existing/future eligible accounts use the same shared code. No account identifier, creation date,
  tenant name or fixture selects implementation or grants authority.

## Reproducible automated proof

- Before product edits, the expanded hook suite failed six of 22 tests: native owner-only and
  coach-only projections were wrong in list/detail, the closed select omitted the owner field,
  and the SOLO account-switch projection retained the coach-derived label. Six failures and
  16 passes were observed; expected red-run React warnings do not count as production evidence.
- After repair: `node node_modules/vitest/vitest.mjs run src/components/tenant-relationships/useTenantRelationshipsData.test.tsx src/components/tenant-relationships/TenantRelationshipsClientsWorkspace.test.tsx src/components/tenant-relationships/ClientStanding.test.tsx --maxWorkers=1 --no-file-parallelism` passed 96 tests / three files.
- Focused ESLint and Impeccable detector on the changed hook/test, and `git diff --check`, passed.
- Local evidence validation first rejected an extra semicolon in RELEASE_RECOVERY; its required
  position/reference grammar was corrected. The evidence validator and pinned skill bundle then passed.
- No source fixture certifies native RLS, production assignment persistence, notification delivery,
  Rail behavior, UI freshness or authenticated customer acceptance.

## Separate existing freshness seam

The hook already keys list reads by `tenant-relationships/people/<activeTenantId>/<mode>` and
detail reads by `tenant-relationships/person/<activeTenantId>/<contactId>`, with `staleTime=30_000`.
It exposes `retryPeople` and `retryDeepLink`. The existing People editor's `handleSaved` awaits
both refetches. A Chat-origin assignment may need a separately bounded investigation of these
existing query invalidation/refetch seams. This candidate changes neither cache keys, stale time,
refresh triggers nor Chat behavior and does not claim immediate cross-surface freshness.

Impeccable context reported pre-existing DESIGN.md / design.json sidecar drift. No design-context
file is changed; a separately requested document refresh can reconcile that drift.
