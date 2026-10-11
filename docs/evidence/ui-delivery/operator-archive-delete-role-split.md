# Operator authority split — Archive vs permanent Delete

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: Family 15 authority packet below; the existing Fleet → Account details → review/confirm → receipt flow is unchanged and now reflects the server's per-action authority answer.
PAIGE_UI_DESIGN: PASS: Installed project skill read; incumbent Operator modal, tokens and action hierarchy retained. No new surface or redesign — the change is which existing controls render for which authority.
MATERIAL_FLOW_CHANGE: YES: A delegated operator tier with only fleet.account.archive sees Archive/Restore (and details) but never administrator editing or Permanently Delete; administrators see the incumbent full set.
FLOW_PROTOTYPE: PASS: Owner-directed authority rule (ANT-47, 2026-10-10) over the already-approved Account Details modal; no fresh visual redesign required or made.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: A Platform Operator member archives/restores an eligible account; only Super Admin/Platform Admin may preview or execute permanent deletion.
VISUAL_DIRECTION: PASS: Approved Operator semantic tokens and dialog preserved; no new pixels beyond conditional presence of existing controls.
AUTOMATED_EVIDENCE: PASS: Disposable-PostgreSQL proof with failing-first missing-migration control and a full delegated-tier matrix; actual-component dialog tests per authority; predicate contract tests. Exact counts recorded on the candidate PR.
STATIC_EVIDENCE: PASS: Scoped ESLint and type ratchet on changed src; migration gate-only body diffs verified statement-by-statement against the deployed definitions.
RENDERED_EVIDENCE: PASS: Actual-component DOM assertions — every control's presence and absence per authority tier in the real dialog under jsdom; the rendered design is the already-captured incumbent modal with controls conditionally present.
BEHAVIORAL_EVIDENCE: PASS: Archive-only tier completes Archive and Restore through the canonical lifecycle; deletion preview/execute/resources refused server-side (42501) and never dispatched by the client; tenant identities hold neither authority; revoked capability refuses immediately; idempotent migration replay.
AUTHENTICATED_RUNTIME: UNVERIFIED: Authenticated production use with a real delegated-tier principal requires the owner to designate an isolated QA principal; no production login, role mutation or account change is authorized by this coding assignment.
KEYBOARD_FOCUS: PASS: Existing dialog focus trap and control order retained; no new focusable control introduced, only conditional presence of existing ones.
ZOOM_REFLOW: NOT_APPLICABLE: No layout, geometry or new controls added — only conditional rendering of existing buttons in the unchanged responsive modal.
REDUCED_MOTION: NOT_APPLICABLE: No motion added or changed; incumbent motion-reduce classes untouched.
STATE_COVERAGE: PASS: Authority states (administrator, archive-only delegated, ordinary tenant identity, revoked) across view/archive/restore/delete controls; all lifecycle states otherwise inherited unchanged from the incumbent record.
TRUTHFUL_STATE_LABELS: PASS: Authority answers are strict server booleans; a missing or malformed answer errors rather than silently denying or granting. Hidden controls make no authority claim — enforcement is server-side.
SOLO_UI: NO: Platform Operator Fleet account controls only; the Solo shell is a managed tenant context and is unchanged.
UNVERIFIED: Authenticated production acceptance with a real delegated-tier principal, and owner-supervised live role matrix. No production account was used or mutated as proof.

OWNER_INTENT: Platform Operator Super Admin and Admin may permanently delete; other appropriately authorized Platform Operator members may Archive and Restore but never permanently delete; ordinary tenant users, CRM staff and business owners hold no operator lifecycle authority.
MUST_NOT_HAPPEN: UI-only authority, email/identity-based grants, deletion authority below Platform Admin, capability grants to tenant-tier roles, weakening the journal delete guard, or a second lifecycle engine.
MUST_PRESERVE: R0 capability registry semantics (holds_unlisted, in_force), protected-role grants, exact scope/name/version confirmations, journal/audit/readback, archived-children semantics, and every deployed function body byte-identical except its authority gate.
ACCEPTANCE_CRITERIA: Delegated archive-only tier archives and restores through the canonical lifecycle and is refused (42501) on deletion preview, execution, delete-mode resources and the journal delete branch; both admin tiers keep full authority; tenant identities refused entirely; revocation takes effect immediately; migration replays idempotently.
MOTION_PURPOSE: NONE: No motion added or changed.
PROTECTED_SEAMS: Server authority predicates and every lifecycle RPC gate; R0 registry grants; the tenants archive guard; operator-account-retirement Edge authority check; Fleet dialog control visibility. Chat/Live, Spine registry, Harness, Rail, signup/provisioning, billing and Solo shell unchanged.
INTERNAL_BUILD_IDENTITY: 1df70b9795a1f7cabc976dff81861eed5d151b4e (observed base; exact reviewed candidate SHA in PR); deployment=PROOF_OWED(candidate production readback); environment=development; migrations=PROOF_OWED(20271020000100_operator_archive_delete_authority deploys with this PR); edge=PROOF_OWED(operator-account-retirement authority readback after deploy); evidence=docs/evidence/ui-delivery/operator-archive-delete-role-split.md
RELEASE_CHANNEL: development: bounded Operator authority repair; exact production identity follows verified delivery.
RELEASE_CLASSIFICATION: internal-only: privileged Operator authority split, no customer release version.
CUSTOMER_RELEASE_IDENTITY: none: no public version or announcement authorized.
RELEASE_NOTE_REQUIRED: NO: Internal Operator repair; owner report/PR and Master closeout record delivery.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: Authenticated production role-matrix acceptance with an owner-designated delegated principal. Isolated SQL/component passes never substitute for that outcome.
RELEASE_RECOVERY: position=Forward repair only, a completed permanent deletion is irreversible and an unknown outcome reads the same journal before any continuation; reference=docs/delivery/operator-account-lifecycle.md

## Scope and routing

ANT-47 PR (B) — the owner-required server-side role split over the existing canonical lifecycle. No new surface, engine, tier or enum value: authority derives from the R0 `platform_operator_roles`/`platform_operator_capabilities` registry through `operator_may`, with permanent deletion additionally floored on `is_platform_admin()` (super_admin + platform_admin, per the owner's rule text). Two capabilities are registered and granted in force to exactly those two tiers. `operator_can_retire_accounts()` is retained unchanged for account-detail editing (administrator-only) and the existing proof harness; every other lifecycle gate is re-emitted with only its authority line changed, verified statement-by-statement against the deployed 20270602000504/00203 definitions. Review round 1 (independent non-author, exact head): verdict SHIP; its P2 — the R0 `tenant.status.set` registry row for platform_admin was stale against the moved gate — is fixed in the same migration (row flipped in force with the ANT-47 ruling; no enforcement consumes that capability). Its P3s are dispositioned on the PR: archive-mode legacy resource preparation is deliberately administrator-executable only (stricter than the archive class, unreachable from the UI, fail-closed), and the pre-existing pgTAP error-message strings in supabase/tests/operator_account_controls.sql are untouched known drift for the next owner of that file.

The Fleet host reads both predicates per authenticated session and passes them to the dialog, which renders only the actions the server would admit; hiding is presentation, enforcement is the SQL gate.

## Evidence and reproduction

- `node scripts/proof/operator-account-archive.mjs --postgres <dedicated-loopback-port>` — replayed twice (idempotency). With the migration file absent the run FAILS (ENOENT) at the role-split block: failing-first control.
- Matrix inside that proof: super_admin and platform_admin hold both predicates; a `moderator` fixture tier granted only `fleet.account.archive` archives and restores a fresh standalone through the canonical lifecycle while `operator_preview_account_deletion`, `operator_delete_archived_account` and delete-mode `operator_preview_retirement_resources` all refuse 42501; an ordinary tenant identity holds neither predicate and is refused at preview; deleting the delegated role row flips the predicate false immediately; owner revocation also removes deletion authority.
- `node scripts/proof/operator-provider-retirement.mjs --postgres <port> --cached-audio --generated-media --platform-independent` — unchanged sibling suite still green.
- Focused component/data suites (dialog per-authority cases, lifecycle authority parsing, receipt/preview contracts) via the runbook's vitest command.

## Review and delivery

Independent non-author review must COMPLETE on the exact head before merge (risk axes: gate-only fidelity of re-emitted bodies, capability grant scope, tenant isolation, guard-trigger branch split, Edge authority swap, UI truthfulness). Required exact-head CI green including the migration-version collision guard (renumbered above the applied frontier 20271020000000 and open-PR claims), database contract and UI evidence gates. Merge, deploy, live function/ACL/capability readback and owner acceptance are recorded separately.
