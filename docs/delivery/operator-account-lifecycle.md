# Operator archive and permanent deletion

Owner direction, 2026-10-10: extend PR #1890's existing Fleet popout. Archive is reversible; Delete physically removes eligible tenant-owned records. Cancellation alone does not retire a tenant. No production account deletion, provider termination, authenticated agent testing, role mutation or INT-346 activation is authorized. Earlier design direction explicitly approves adding Archive/Restore/Delete with Impeccable and no additional design approval.

## Owner intent and flow contract

Goal: remove selected obsolete workspaces and eligible data from the canonical platform.
Human and feel: privileged Platform Admin/Super Admin; explicit control over scope and consequences.
Entry and exit: Fleet → Account details → review/confirmation → verified receipt → refreshed Fleet.
System: existing Operator tokens, Radix dialog, dense readable preflight, one scroll owner.
Signature: exact account tree plus Delete / Preserve / Blocked dispositions.
Feedback: live operation/readback status; no completion claim on timeout or malformed response.
Rejecting: blind cascades and irreversible actions disguised as status changes.
Variants: ordinary Platform members/tenant owners refused server-side; archived accounts have Restore/Delete.

| From | Trigger/guard | To | Recovery/exit |
| --- | --- | --- | --- |
| Details | Edit or Cancel | Existing review/save/readback | Back/discard/read current account |
| Details | Archive | Fresh exact tree and dependency review | Refresh or cancel |
| Archive review | Exact name and fresh version | Processing → verified Archived receipt | Unknown → read operation; never automatic retry |
| Archived details | Restore | Processing → verified Restored receipt | Access restored; provider controls stay paused |
| Archived details | Permanently Delete | Fresh authoritative disposition preflight | Blockers have specific next steps; cancel/refresh |
| Ready preflight | Exact name plus irreversible confirmation | Processing → verified Deleted receipt and absence readback | Failed rolls back DB; unknown reads same receipt |
| Any pending write | Close/Escape/repeated click | Stay pending | No duplicate dispatch |
| Any state | Actor/account changes | Drop stale response | New context re-reads its own contract |

## Capability routing before further implementation

1. Outcome: explicit reversible archive and irreversible eligible tenant-data retirement.
2. Family 15, Platform Operator; this sole lane owns account controls. Other development agents remain on hold.
3. Reuse canonical tenant lifecycle, protected global roles, SQL transactions and audit; no new tenant/identity/scheduling engine.
4. Account deletion Spine capability is UNAVAILABLE. This administrative UI does not register a Chat/autonomous deletion tool.
5. No external provider authority. Existing provider lifecycle/Storage API must resolve external dependencies; SQL must never delete Storage metadata as file cleanup.
6. Privileged destructive action; server-derived is_platform_admin() (Platform Admin or Super Admin), exact scope/name/version confirmation. No ordinary Platform membership or tenant owner authority.
7. Existing scheduled/claimed work must quiesce; archived writes/provider floor fail closed. No new scheduler or drainer.
8. Existing mandatory audit plus minimal protected operation receipt, independent readback and exact scope absence. No customer payload or secret in the receipt.
9. Existing operator.platform surface; source/fixture proof does not promote authenticated binding status.
10. Local SQL and rendered tests, exact-head independent review/CI, deployed source/schema readback; authenticated production usability remains PROOF OWED under owner hold.

## Disposition rules

An explicit source-owned allowlist supports ordinary tenant data, including CRM, Chat, Memory, Knowledge, settings and their reviewed FK descendants. Catalog discovery finds additional dependencies but never grants deletion permission. Unknown, legal, financial, security, provider-resource and file dependencies block unless a supported disposition is present. Cross-account references refuse. Shared Auth users, global roles, survivor memberships and unrelated tenant records are never deleted. Database cleanup occurs child-before-parent with constraints enabled and mandatory audit in the same transaction. Archive restoration does not automatically resume provider services or scheduled work.

Permanent deletion is ordinarily irreversible. Transactional rollback and idempotent receipts are recovery for failed/unknown requests, not a promise to restore a completed deletion. Scheduled backups and necessary security/audit history retain their existing policies. Archive snapshots must be limited to lifecycle/access restoration metadata and removed from the receipt after successful permanent deletion; no shadow copy of deleted business data.

## Verification and release boundary

Implementation and controlled proof PASS; independent exact-head review and hosted CI remain required. Merge/deployment NOT_STARTED for this extension. PR #1890 is deployed details/edit/preview only; PR #1891 closed its Section 4.0 shipped row at f6e85d3a7852280853d2ac6ba9e3e7a8db45ee0b. This extension must not be reported LIVE or QA READY from local fixtures. No actual accounts changed.

Hosted CI on bfdff5e8a154a94e021f46db62523f6c0285118a exposed two integration failures: the definer-signature checker recognizes separate ACL statements rather than grouped function grants, and the existing Chat race proof's raw tenant cleanup is refused by the new canonical deletion guard. The corrective batch separates identical ACL grants/revokes and makes the existing disposable concurrency proofs retire their synthetic tenants through Archive/preflight/Delete. A temporary protected fixture administrator exists only inside that cleanup transaction and is removed afterward; failed preflight rolls it back. The caller's original disposable-database context is restored before revoking temporary authority. The exact existing protected-role trigger exposed that requirement in a failing-first 42501 control; neither the trigger nor lifecycle authorization was weakened. The old-contract fallback applies only when the deletion function is absent in a disposable proof database. No production guard exemption or new QA environment is introduced. PostgreSQL and PGlite prove both cleanup success and blocked-cleanup rollback with surviving identities and tenants unchanged. New exact-head hosted CI and independent review remain required for this corrective batch.

Read-only role audit found the intended owner Super Admin and intended administrator Platform Admin, plus one other Platform Admin assignment. Identifying evidence stays private. Existing role-management owner must reconcile any unapproved assignment through the protected procedure; do not hardcode login emails or mutate production roles under this engineering hold.

The owner-designated existing Super Admin is the Platform Owner. A unique index on the canonical user_roles table prevents a second Super Admin; additional owner-invited administrators use platform_admin. Neither email strings nor editable Auth metadata confer deletion authority. Deployment/activation must not assert exclusive administrator access until the additional existing Platform Admin assignment has been reconciled against the owner's invitation policy.

## Controlled acceptance matrix

| Outcome | Evidence | Boundary |
| --- | --- | --- |
| Archive/Restore preserves Agency tree and authorized business records | Actual SQL and Chrome source interaction PASS | Restore access; execution remains paused, never restarts billing |
| Permanent Delete physically removes Agency/child CRM, activities, Chat and Memory | Actual PostgreSQL/PGlite migration proof PASS | No Auth identity or surviving Solo records removed |
| Disposable standalone deletion | Actual SQL PASS | Another Solo remains intact |
| Platform Admin and sole Owner authorization | Actual SQL roles, ACL refusal and second-Owner constraint PASS | Real additional Admin assignment still requires protected reconciliation |
| Forged target/name/operation, stale data, repeated requests | Actual SQL/client tests PASS | Unknown transport outcome reads same operation; never auto-dispatches |
| Mandatory audit failure | Actual transaction rollback PASS | Receipt remains archived and business records remain intact |
| Archive concurrent with work insertion | Two actual PostgreSQL sessions PASS | Work insertion refuses after archive commits; no provider call performed |
| Financial/unknown obligations, storage, unmapped file references, cross-account links, FK cycles | Actual SQL preflight/refusal PASS | External bytes/providers/independent obligations require documented cleanup; no blanket override |
| Current versus Archived Fleet and ordinary-member UI refusal | Actual source interaction/static tests PASS | Not MRR/ARR; preserve existing authoritative billing definitions |
| Rendered local interface | Ten light/dark viewport captures and geometry PASS | Synthetic RPC/actor; not live Auth evidence |
| Production authenticated use, provider termination, real account removal | PROOF OWED / NOT EXECUTED | Owner hold; exact destructive scope authorization still required |

## Reproduction and operation procedure

Run `node scripts/proof/operator-account-archive.mjs --postgres` in the existing CI's disposable PostgreSQL service. A dedicated local loopback port is also supported with the approved PostgreSQL client path set in OPERATOR_PROOF_PSQL; production URLs/credentials are not accepted. The old-source control runs with a pinned local PGlite entry and --baseline, and fails 42883 at the missing archive contract. The forward migration is CLI-created and assigned 20270602000203 after the deployed migration frontier; no production reset or include-all push.

Operator sequence: verify protected global-role assignments; select the exact account; cancel/retire external services through their canonical lifecycle; clear any in-flight work; review and confirm the complete Archive scope; read back Archived; review Delete's fresh counts/dispositions and restrictions; type the exact selected name and accept irreversible deletion; read the durable operation receipt and canonical account absence. A failed/stale preflight never becomes executable through confirmation. Unknown outcomes require readback, not another write. Canceled status alone never authorizes deletion.

Storage cleanup uses the existing Storage API and absence readback, never direct metadata deletion. Vault/external connectors require documented revocation/disconnect. Unresolved financial/security/legal obligations and network-shared Knowledge remain blocked until their canonical owners provide supported disposition. The implementation does not claim to terminate Stripe/Twilio, destroy backups, erase required audit, resume paused provider work, or prove #1822 old-worker cessation. The post-restore execution pause is deliberate and has no automatic resume action in this release.
