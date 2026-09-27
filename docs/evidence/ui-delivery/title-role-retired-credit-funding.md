# UI delivery evidence: title-role-retired-credit-funding

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: flow-by-flow v2.0.1 read in full earlier in this lane (orchestration, delivery, audit, build, review, verification); mode Refactor within a Deep, R3 permissions change; affected flows are a staff member editing a client's credit accounts, a staff member updating a business's certifications, and a staff member returning from the broker workspace, where the gates opened for the retired coach role (coach removal, app part 6)
PAIGE_UI_DESIGN: PASS: .agents/skills/paige-ui-design SKILL.md and its routed files read earlier in this lane; this change narrows which role sees existing controls, with no token, layout or motion change
MATERIAL_FLOW_CHANGE: NO: admins keep every control they had; a person holding only the retired role no longer sees the certification status select, the account delete button or the broker "Back to Admin" link, which the server already refused them after 20270505000000
FLOW_PROTOTYPE: NOT_REQUIRED: no new interaction or layout; one sentence of helper copy changes ("updated by your team" instead of "updated by your coach")
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: certification status and account deletion stay with admins; a title never opens them
VISUAL_DIRECTION: PASS: no style change
AUTOMATED_EVIDENCE: PASS: src/lib/auth/titleRoleRetiredFromCreditFunding.test.ts asserts none of the credit and funding gates reads the retired role and that an assignment alone no longer syncs credit data; both tests fail on main (all twelve files flagged) and pass after; whole vitest suite 0 failures
STATIC_EVIDENCE: PASS: tsc baseline did not grow; eslint clean on every changed src file (pre-existing untyped values in AccountManager, AdminAccountManagement, ClientFileView and FundingProfileSection are typed against the generated database types); Impeccable detect clean on the changed UI files
RENDERED_EVIDENCE: NOT_APPLICABLE: no rendered layout or style changes
BEHAVIORAL_EVIDENCE: UNVERIFIED: no browser drive in this session
AUTHENTICATED_RUNTIME: UNVERIFIED: no authenticated browser session in this environment
KEYBOARD_FOCUS: NOT_APPLICABLE: no control, focus or keyboard behavior changes
ZOOM_REFLOW: NOT_APPLICABLE: no layout change
REDUCED_MOTION: NOT_APPLICABLE: no motion change
STATE_COVERAGE: PASS: admin (controls shown, unchanged), non-admin staff and client (controls hidden, read-only status badge and helper sentence shown, as before for clients)
TRUTHFUL_STATE_LABELS: PASS: the helper sentence no longer names a role that cannot update certifications
SOLO_UI: NO: these are the credit account manager, the admin client file, the business funding profile and the broker workspace; no Solo surface changes
UNVERIFIED: authenticated browser behavior of the changed gates against a live workspace, because this environment has no authenticated session

OWNER_INTENT: coach is not to exist as power anywhere in the platform; a title describes, it never authorizes
MUST_NOT_HAPPEN: a control shown, or a credit or funding function run, because a person holds the retired role; an assignment alone writing credit data into a client's records
MUST_PRESERVE: every admin and owner path; the stored modification-source labels the database constraint accepts
ACCEPTANCE_CRITERIA: no credit or funding gate reads the retired role; sync-credit-report-data accepts the owner, an admin or the service role only
MOTION_PURPOSE: NONE: no motion change
PROTECTED_SEAMS: the finance tables' database policies are unchanged by this PR (retired in 20270505000000); service-role callers of sync-credit-report-data are unchanged

INTERNAL_BUILD_IDENTITY: a32917d7843df7a3a03a41e5eee9b0f8a1011b36; deployment=none; environment=development; migrations=NOT_APPLICABLE; edge=PROOF_OWED(seven edge functions deploy on merge through deploy-edge-functions.yml, the run is checked after merge); evidence=PR verify run on the implementation head (this SHA), red run on 6cb9ca8df38afe9d1ed4b3ca47914553dcbb0590
RELEASE_CHANNEL: development: pre-merge branch build; production follows merge
RELEASE_CLASSIFICATION: internal-only: permission hardening with no customer-visible change beyond one helper sentence
CUSTOMER_RELEASE_IDENTITY: none: internal-only hardening, no customer release
RELEASE_NOTE_REQUIRED: NO: internal-only
RELEASE_TRUTH_BOUNDARY: PROOF OWED: unit-level behavior proven in CI; edge deploy confirmed after merge; no authenticated runtime claim is made
RELEASE_RECOVERY: position=forward-fix or revert of the app commit, since no data or schema changes; reference=this PR

## Scope and collisions

- Classification: coach removal, app code part 6 (credit and funding), paired with slice 2's finance migration.
- Affected flows: credit account manager, admin client file account management, business funding profile certifications, broker workspace return link; credit report analysis, financial document analysis, lender summary, credit predictions, lender research, outcome ingestion and credit data sync on the server.
- Neighboring regressions: service-role callers (paige-apply-extraction, analyze-credit-report) of sync-credit-report-data are unchanged.
- Active-owner/file collisions: none known.
- Explicit exclusions: invite and role-grant flows (grant paths, slice 3).

## User job and state map

An admin edits a client's accounts and certifications as before. A person holding only the retired role sees the client-facing, read-only view.

## Evidence index

- `src/lib/auth/titleRoleRetiredFromCreditFunding.test.ts`.
- Red run: the PR's first commit, `verify` (Test step, the new tests only).

## Review and limitations

Authenticated browser behavior is `UNVERIFIED` in this environment.
