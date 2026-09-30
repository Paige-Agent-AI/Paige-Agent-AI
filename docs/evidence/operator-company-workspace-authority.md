# Operator authority in company workspaces — PR #1591

## Scope and owner intent

Antonio Cook transferred the existing branch to Codex on 2026-09-30, authorizing
implementation, tests and independent review. Production migration, merge and
deployment require separate written authorization for the exact package.

Preserve the existing Option B contract: `super_admin` and `platform_admin` receive
role-derived authority in top-level standalone workspaces carrying the boolean
`features.system_workspace=true`. Contact creation and form-intake configuration
retain the operator's own identity. Customer-workspace authority does not expand.
The role must not manufacture a lasting company membership or seat invitation.
Platform-owner and direct-server exceptions remain explicit in the migration.

The PR body and migration contain the September 29 ruling's substance. The handoff
authorizes finishing that existing scope; these sources do not establish universal
operator access. Functions that require direct membership, including governed CRM
command execution, remain unchanged. No interface or provider behavior is added.

## Grounding and affected flows

- Adopted branch: `claude/busy-mccarthy-rvxgq9`.
- Inherited head: `a958a41ca38e7ffe4c3c318a80c9de82080d1c52`.
- Inherited tree: `2e908a4ee8cebf0d72f913017dcde8df996ae248`.
- Original merge base: `a5dd49405eaeeae58e0113254351336be41d1552`.
- Released main synchronized: `cfcdc62001e677816dba4a4c915788ed117a65ff`.
- Operator acts in a company workspace; customer and global-admin callers stay denied.
- Platform owner designates company workspaces; operators and service requests cannot
  change either the flag or effective classification to evade protection.
- Consumer invitations stay permitted; conversion to a seat invitation is refused.
- Operator-role revocation removes role-derived authority and contact-creation access.
- Refused writes preserve classification, invitations and absence of a lasting seat.

Portfolio owner is Platform Operator, using existing Layer A database authority.
Existing Spine keys `team.authority` and `contact.event_status` do not establish a
separate company-authority capability or universal CRM execution. Existing approval,
Trust Compass, event, receipt and provider systems remain intact. Contact ID,
`created_by` and actor-attributed audit data are the readback boundary. No surface
status is promoted by this permission change.

## Independent findings and repairs

A separately spawned read-only adversarial reviewer, who did not write product or
tests, reviewed the inherited exact head and returned two MAJOR findings:

1. The flag guard ignored account type and hierarchy, allowing company classification
   to be switched off around a seat write. The guard now compares both the flag and
   effective classification and watches all three classification columns.
2. The invitation guard ignored `kind` updates, allowing consumer-to-team conversion.
   The token trigger now also watches `kind`.

The database verifier executed the original complete migration against a minimal
synthetic PostgreSQL 16 dependency graph. Five attack assertions failed: operator
account-type demotion/promotion, consumer-to-team conversion, and service-role parent
setting/clearing. The same assertions passed after the repair, plus two authority/
revocation checks and six compatibility controls. The harness used extracted existing
authorization functions, policies and owner-column guard, with simplified dependency
tables. It is bounded execution proof, not a full schema replay.

The repository pgTAP suite grows from 50 to 70 assertions, covering classification,
invitation conversion, role revocation, refused contact writes and unchanged records.
The final exact-head CI and reviewer disposition belong in the PR delivery report;
the inherited passing run cannot establish these new assertions passed.

A contract reviewer withdrew its initial missing-UI-record finding: the backend-to-
visible rule concerns changed customer flows, whereas this scope is internal operator
authority. There is no new UI design, prototype waiver or fabricated rendered proof.

## Evidence classes

- **Inherited automated PASS:** exact-head database-contract job
  [109617804504](https://github.com/Paige-Agent-AI/Paige-Agent-AI/actions/runs/36630382933/job/109617804504)
  ran the original 50 assertions successfully, with production-grant reproduction and
  grant-ordering proof. This is historical evidence for the inherited head only.
- **Local database PASS:** five failing-first attacks, then 13/13 bounded assertions
  after repair. Local transcripts and reconstruction details are in the handoff proof
  bundle; no real tenant records were used.
- **Static:** definer-function, signature ACL, view security, migration-version,
  Rail grant, managed-schema and action-authority checks run separately from database
  execution. Final results must be tied to the resulting head in the PR report.
- **Rendered/browser UNVERIFIED:** no changed frontend files and no browser drive.
- **Authenticated runtime UNVERIFIED:** no real owner create/save/revisit, permission,
  retry, abandonment, workspace-switch or role-removal drive. Local SQL roles do not
  establish authenticated application usability. Antonio tests live main after release.
- **Production acceptance UNVERIFIED:** no migration, merge or deployment authorized.

## Migration package and collisions

- File: `supabase/migrations/20270521000000_operator_authority_in_company_workspaces.sql`.
- Source: PR #1591.
- Reviewed-file candidate SHA-256:
  `b56e496a1199e27dde79f16ae85331bf6fa417cf5e76b20ada89bf4ad1a856d4`.
- Purpose: role-derived company authority, protected classification/membership/
  invitations, and actor-attributed canonical contact creation.
- Blast radius: four shared membership predicates and their company-workspace callers,
  role synchronization, contact creation, and triggers on tenants/members/invitations.
  No business rows are backfilled, moved or deleted by the migration.
- Recovery: before commit, transactional failure rolls back DDL. After persisted apply,
  use a separately reviewed and authorized forward migration restoring exact pre-apply
  function definitions/ACLs and removing the new triggers/helpers in dependency order.
  Preserve contact-methods behavior from `20270519005000`; reverting Git cannot undo
  persisted SQL. Subsequent business actions are not undone by restoring schema.
- Live ledger read on 2026-09-30: newest `20270520000000_mcp_connection_header_bundle`.
  Comparing all tracked branch migration versions against that live ledger found only
  `20270521000000` pending. Re-read immediately before any release decision.
- All 51 open PR file inventories were inspected. Post-frontier reservation order is
  **#1591 / 20270521000000 → #1595 / 20270522000000 → #1371 / 20270523000000**.
  #1371 reports an instruction to land first; its migration would strand the earlier
  files. Resolve that release coordination conflict explicitly before any release.
- #1556's `20270514000000_member_threads_private_by_default.sql` is absent from the live
  ledger and older than its frontier. It and other old branch-only migrations need
  their own reconciliation; they are not predecessors to sweep into this package.
- #1595 retains all MCP, provider, incoming-contact and contact-binding ownership.
  No code from that PR is incorporated. Its lane must freshly verify compatibility
  and ordering after any separately authorized #1591 release.
- #1536 owns frontend operator standing; #1520/#1557 own act-as/account state. This
  PR does not claim those owner flows repaired. #1556's private conversation boundary
  must remain explicit; company authority is not customer act-as permission.

## Release state

Channel: development. Classification: internal-only. Customer release identity: none.
No release note or LIVE claim. Shipped Delivery Log: N/A until a separately authorized
merge. No Register access or writes. No production permission/business-record changes.
Remaining gates: final exact-head CI and completed independent recheck, release-order
coordination, Antonio's written package authorization, persisted migration/deployment
verification, and owner acceptance on live main.
