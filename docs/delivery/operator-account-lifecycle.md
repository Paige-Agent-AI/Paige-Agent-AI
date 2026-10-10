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

### Provider retirement repair, owner direction 2026-10-10

PR #1892 was owner-merged at c9a39d274c56a54649b3d90816e3859e2170cb98. Production deployment dpl_2eMJu1sVAov8AnzmdVY3N8kvaYBc is READY; migration 20270602000203 is recorded. This is deployment evidence, separate from authenticated lifecycle acceptance. Owner screenshots demonstrate that blanket Twilio/n8n row-existence checks leave the Agency archive flow blocked. The owner explicitly requests using the existing Twilio API to complete resource retirement; existing approved Account Details design is retained.

1. Outcome: a privileged operator prepares connected resources, then actually archives or permanently deletes an eligible exact account scope.
2. Ownership: portfolio family 15 / Platform Operator; one implementation lane. Communications owns the reused Twilio adapter; no competing provider client or other coding agent.
3. Shared dependency: verified Auth caller, canonical protected roles, existing SQL lifecycle, existing private archive-operation journal, mandatory audit and readback. Provider partial failure is recorded there, never in a second lifecycle engine.
4. Spine: autonomous/Chat account deletion remains UNAVAILABLE; no deletion tool is registered and INT-346 stays DRAINING.
5. Providers: canonical `_shared/twilio.ts` / master credentials; Twilio suspension for Archive and closure for Delete, verified against the bound child and parent. API documentation confirms suspension leaves current calls and monthly number charges; closure is irreversible and provider retention is separate. n8n API credential disconnection uses the canonical encrypted connection seam. Visible workflow counts do not prove exclusive ownership; shared/external workflows are retained only under explicit scoped operator acknowledgement, never bulk-deleted.
6. Authority: existing Platform Admin/Super Admin server predicate, typed exact name/scope and explicit provider consequences. Ordinary Platform members/business owners refused. No credential or email identifier creates authority.
7. Durability: extend the existing private archive-operation journal for resource preparation/claim/readback; canonical execution pause and worker guards. No scheduler/drainer is added.
8. Evidence: exact provider GET readback, connection/credential disposition, canonical audit, then fresh Archive/Delete preflight and final lifecycle receipt/absence. Unknown responses never imply completion or repeat consequential requests automatically.
9. Surface: operator.platform, same approved Account Details modal and tokens. Resource preparation is a recoverable step within the existing review, with READY/BLOCKED/PROCESSING/FAILED/OUTCOME UNKNOWN states.
10. Required proof: deterministic SQL plus mocked HTTP through the actual provider adapter; local rendered flow; independent exact-head security/UI review and CI; authoritative production source/schema/Edge readback. Live provider termination and authenticated owner execution require actual scoped operator execution; agent login/customer deletion remain held.

Flow contract: review selected tree → show provider consequences → exact name/consent → prepare only bound resources → verify readback → refresh authoritative review → Archive/Delete → verify canonical receipt. Cancel precedes execution; after an uncertain result, Read operation reconciles without repeating the write. Archive/Restore retains business data and never reactivates paid services. Unrelated Solo, shared identities, provider parent and other tenant resources survive.

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

## Provider preparation — forward repair

Hosted contract CI correctly refused the changed shared Twilio AST against its prior incumbent-source fingerprint. Independent non-author review covers the optional timeout/no-retry controls; the corrective batch renews only that exact client digest, with an actual ordinary-call transient-retry positive control and retirement opt-out negative control. No unrelated source pin or authority is regenerated. Hosted database-contract passes. The hosted Supabase Preview check reports an existing relation at unchanged historical migration `20270329000000_paige_voice_budget_control`; read-only verification of that isolated branch nevertheless confirms both that migration and candidate `20270602000204` in its ledger, all 19 changed function bodies matching source, fixed search paths and least-privilege ACLs. The check/branch status remains failed until a legitimate successful rerun; readback does not waive CI or authorize a reset, production repair, or historical Voice change. Required final-head review/CI evidence remains separate.

Migration `20270602000302_operator_provider_retirement` extends the existing private archive journal and canonical contracts. The JWT-protected `operator-account-retirement` endpoint accepts the selected tenant, operation, action, fresh review version and explicit confirmation. Protected SQL supplies the provider binding; browser-supplied SIDs, credentials and email-based privilege are refused.

Integration correction (2026-10-10): current main and production now record unrelated Operator Intelligence migration `20270602000204`. The pending provider migration was initially moved to `20270602000205`; production then recorded the independently delivered `20270602000301`, so the unapplied provider file moved again to `20270602000302`. The SQL bytes remain unchanged (SHA256 `c011051cad6231b2512c615f3133a9c0ed9cc3d36e6f912be6d1cc47ae7ed97e`); no applied history was rewritten. Earlier `204`/`205` preview evidence is historical. Current-head CI, review and new-number preview/persistence proof must be recorded separately. This main integration does not authorize changing INT-346 admission or deploying unrelated functions. The owner-directed removal of the one uninvited Platform Admin completed through the existing trusted administrative context explicitly permitted by the deployed protected-role trigger and §53. Independent packet review and production readback confirm one designated Owner, one designated Admin, no extra platform assignments, retained Auth/business memberships and every other role, and a truthful existing audit receipt. The earlier Owner-session-only blocker was too narrow and is superseded; product authority remains role-based. Credential-free evidence: PR #1897 comment6099402612. No provider or account retirement was executed.

Select **Prepare connected resources** inside the blocked Archive/Delete review. Twilio Archive suspends the exact child; Delete closes it permanently. Both verify the configured parent, check queued/ringing/in-progress calls before and after the status change, and read back the child status. No automatic status-write retry. The existing parent credential needs legitimate Accounts-management scope; a Standard API key may correctly refuse. Suspension is not billing termination.

Preparation pauses canonical execution before provider I/O. A protected lease binds the initiating Admin, account snapshot, scope and resource fingerprint. Each invocation processes one unfinished resource; stale/rebound/concurrent/unauthorized execution refuses. Unknown outcomes remain paused and use **Read provider outcome** before explicit continuation. Read recovery makes Twilio GETs and never newly disconnects n8n. The initiating Admin can reopen the operation; another administrator's takeover is unavailable. Revoked initiating authority requires protected administrative recovery.

n8n requires explicit external-retention acknowledgement: visible workflow counts do not prove exclusive ownership. Clear the canonical encrypted PAIGE connection and its exact legacy MCP projection; external workflows remain and may continue independently. Native connectors remain protected. Vault cleanup removes only a canonical exclusive Twilio secret after verified closure, preserves surviving shared references, and refuses unrecognized bindings.

Eligible cleanup includes retired Twilio/n8n bindings, scoped phone references, the disconnected legacy MCP projection and email-send history. Financial quantities/subscriptions remain in their canonical tables with protected retired-tenant markers and restricted access. Deleted-business LLM excerpts are removed while minimal cost/status evidence remains; survivor-primary traces keep their payload when only the working context is retired. Shared Auth/global roles and unrelated businesses survive.

Current paid MRR/ARR cohorts require the existing real commercial classification, an eligible active tenant and active Stripe-backed subscription. Tests/internal/unclassified/trial/unbilled/canceled/archived/retired rows are excluded. Historical snapshots and quantities are not rewritten. This filters the existing plan-price MRR calculation; it does not prove invoice-cash reconciliation or full Finance acceptance.

Unresolved live Stripe obligations, independent connectors, file/storage bytes without canonical API cleanup, unknown obligations, cross-account links and unrecognized Vault bindings remain specific blockers. Ordinary eligible business records alone do not block deletion. External n8n retention is explicitly disclosed.

Reproduce: `node scripts/proof/operator-provider-retirement.mjs --postgres <loopback-port>`; `node --test supabase/functions/_shared/operator-retirement-handler.test.mjs`; focused UI/client/Twilio Vitest tests. Evidence: `docs/evidence/ui-delivery/operator-provider-retirement.md`. The old-source `--resource-baseline` control fails at the missing SQL seam. Live provider authentication/termination and authenticated usability remain UNVERIFIED under the owner hold; actual destructive scope still needs explicit authorization. Code/review/CI/merge/deployment/persistence are separate PR evidence states.

## Disposition rules

An explicit source-owned allowlist supports ordinary tenant data, including CRM, Chat, Memory, Knowledge, settings and their reviewed FK descendants. Catalog discovery finds additional dependencies but never grants deletion permission. Unknown, legal, financial, security, provider-resource and file dependencies block unless a supported disposition is present. Cross-account references refuse. Shared Auth users, global roles, survivor memberships and unrelated tenant records are never deleted. Database cleanup occurs child-before-parent with constraints enabled and mandatory audit in the same transaction. Archive restoration does not automatically resume provider services or scheduled work.

Permanent deletion is ordinarily irreversible. Transactional rollback and idempotent receipts are recovery for failed/unknown requests, not a promise to restore a completed deletion. Scheduled backups and necessary security/audit history retain their existing policies. Archive snapshots must be limited to lifecycle/access restoration metadata and removed from the receipt after successful permanent deletion; no shadow copy of deleted business data.

## Verification and release boundary

Implementation and controlled proof PASS; independent exact-head review and hosted CI remain required. Merge/deployment NOT_STARTED for this extension. PR #1890 is deployed details/edit/preview only; PR #1891 closed its Section 4.0 shipped row at f6e85d3a7852280853d2ac6ba9e3e7a8db45ee0b. This extension must not be reported LIVE or QA READY from local fixtures. No actual accounts changed.

Hosted CI on bfdff5e8a154a94e021f46db62523f6c0285118a exposed two integration failures: the definer-signature checker recognizes separate ACL statements rather than grouped function grants, and the existing Chat race proof's raw tenant cleanup is refused by the new canonical deletion guard. The corrective batch separates identical ACL grants/revokes and makes the existing disposable concurrency proofs retire their synthetic tenants through Archive/preflight/Delete. A temporary protected fixture administrator exists only inside that cleanup transaction and is removed afterward; failed preflight rolls it back. The caller's original disposable-database context is restored before revoking temporary authority. The exact existing protected-role trigger exposed that requirement in a failing-first 42501 control; neither the trigger nor lifecycle authorization was weakened. The old-contract fallback applies only when the deletion function is absent in a disposable proof database. No production guard exemption or new QA environment is introduced. PostgreSQL and PGlite prove both cleanup success and blocked-cleanup rollback with surviving identities and tenants unchanged. New exact-head hosted CI and independent review remain required for this corrective batch.

Read-only role audit found the intended owner Super Admin and intended administrator Platform Admin, plus one other Platform Admin assignment. Identifying evidence stays private. Existing role-management owner must reconcile any unapproved assignment through the protected procedure; do not hardcode login emails or mutate production roles under this engineering hold.

The owner-designated existing Super Admin is the Platform Owner. A unique index on the canonical user_roles table prevents a second Super Admin; additional owner-invited administrators use platform_admin. Neither email strings nor editable Auth metadata confer deletion authority. Deployment/activation must not assert exclusive administrator access until the additional existing Platform Admin assignment has been reconciled against the owner's invitation policy.

The subsequent c7d2e5e14ddb06bce1bf7c9b7ea851a91ab3bab4 database run passed the Chat cleanup and voice-budget race assertions, then correctly blocked cleanup on a synthetic paige_voice_tenant_monthly_usage row. Only that existing disposable no-provider proof now removes its own known synthetic usage before canonical retirement. The production financial disposition remains blocked. A regression loads the actual usage table definition, verifies refusal and rollback while usage exists, then verifies fixture retirement after its own cleanup while another tenant's usage and identities survive. No real financial history or provider resource is removed.

## Generated-audio cache — bounded canonical disposition

The next forward migration extends the same private resource journal, not a new retirement engine. **Prepare resources** covers eligible private `tts-cache` objects in the existing canonical `<tenant UUID>/<SHA256>.mp3` contract. Public review exposes only counts; the protected service claim supplies exact object identities and metadata fingerprints. Admin/Owner confirms the selected name and irreversible resource consequences. Storage `remove` owns byte deletion; Storage inventory and independent SQL absence readback precede resource readiness, followed by a fresh Delete preflight. Never delete production Storage metadata directly.

Routing: family 15, existing protected authority/lease/audit, `operator.platform` (authenticated binding PROOF OWED). Autonomous/Chat deletion remains UNAVAILABLE. Supabase Storage is existing infrastructure rather than a newly connected provider; its standalone catalogue entry is absent, recorded as a documentation requirement. Existing ElevenLabs catalogue entry describes the generated cache substrate; this cleanup grants no voice-provider authority, new credential, spend or autonomous access.

One bounded manifest (100 objects per tenant), one explicit API call, 20-second service requests, no automatic destructive retry. Unknown/partial outcomes remain paused and reconcile the same plan read-only; explicit continuation can remove only remaining original reviewed objects. Archived/paused/missing tenants reject new/changed cache uploads. Active tenant and `_platform` audio remain writable. Unknown buckets/paths, versioned/delete-marker objects, public cache, independent documents or legal/billing obligations remain precise blockers. Archive preserves cache; Restore never recreates deleted bytes or reactivates external services.

Controlled PostgreSQL replay twice proves non-table-owner trigger privilege, partial recovery, Solo and Agency deletion, shared identities and survivor/platform audio. Actual handler/API adapter and local Chrome flow prove scope, confirmation, fresh review, cancellation and unknown read without duplicate dispatch. Production Storage byte deletion and authenticated Owner use remain PROOF OWED. Evidence: docs/evidence/ui-delivery/operator-cached-audio-retirement.md.

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
