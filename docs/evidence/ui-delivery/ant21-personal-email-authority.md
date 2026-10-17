# Actor-bound personal email sender authority — ANT-21 / ANT-52 / ANT-147

2026-10-17. BUG restoration source candidate, not a production send or customer acceptance. Original18-capability/50-parity scope remains open. Base15998cca2065153d6257f2257ecb7db9535aa3a4; exact final source/review/CI/release identities belong to the PR and subsequent production receipt.

## Intended outcome and existing architecture

An eligible ordinary SOLO owner/admin can prepare and approve one business email through their own connected personal sender or an authorized shared company sender. Another person's personal sender must remain unavailable, including after a previously valid approval. This is one tenant-neutral implementation for existing and future eligible accounts; no account allowlist, role retrofit, connector activation or migration backfill.

Domain: Communications. Reuse `comms.email_send` / `comms_send_email`, the existing Harness/Capability Kit high-risk confirm gate and exact stored-argument card, canonical command door, `prepare_comms_email_send`, native claim/finalize, `messages`, and `record_capability_run`/Rail. No new Gateway, approval, provider, permission, job, mailbox or receipt system. No new durable event/scheduler is needed. Existing Gmail/SMTP/SendGrid/Resend integration requirements, provider execution floor, sender selection and platform-versus-tenant authority remain unchanged; listed is not connected.

The existing `inbox-intelligence/policy.ts` remains the shared mailbox classification/active/tenant/personal-owner policy. Server callers carry the authenticated person; internal transport uses the already validated canonical stored operation's original actor. Readiness filters unauthorized senders rather than exposing them as choices. Native prepare and the binding eligibility independently recheck; the unchanged claim already invokes that binding check. Final transport rechecks current metadata before the provider, retaining exact sender/provider and truthful pre-provider failure versus uncertain outcome.

Shared invoice readiness receives only mechanical captured-actor propagation; invoice economics, approvals, writers and providers are unchanged. A background lead-reply draft with no human authority does not infer the tenant owner or select a personal mailbox. Shared/company drafting remains available. Live is not proven by typed-Chat source tests.

Visible surfaces remain the existing typed Chat approval card and native Conversations. No rendered UI, copy, navigation, styling or interaction container changes; UI geometry/Impeccable visual proof is N/A for this backend authorization slice. Surface binding maturity and authenticated acceptance are not upgraded.

## Engineering evidence and limits

- Failed-first resolver/readiness:7FAIL/12PASS against pre-repair source. Original controls retained. Current sender/invoice and Chat/command/marketing suites, plus linked-reply/intake suites, are rerun against final source; exact totals/logs are in the private review packet.
- Incumbent disposable PostgreSQL email proof: current native40000 applied twice;20PASS/0FAIL. Current pre-repair native functions:4FAIL/16PASS, specifically the actor/owner/drift/locking refusal controls. The original11 concurrency/role cases remain; no assertion was weakened.
- Actual prepare/readbinding/claim/finalize SQL and real concurrent PostgreSQL sessions/ACLs run. Auth/workspace tables, optional reply-approval row types, display and recorder dependencies are explicitly local fixtures; the Rail recorder is a stand-in. This is not full Supabase schema replay, hosted Auth, provider acceptance, production receipt or ordinary customer proof.
- Source-executed transport tests substitute network only: own personal and shared sender controls, wrong/missing original actor, changed owner and provider after claim, no unauthorized provider calls, correct existing finalization. Mocked acceptance is not an external send.
- Six changed server files: actual TypeScript semantic comparison baseline39/current35 diagnostics, NEW0; unchanged HTTPS/Deno environment diagnostics remain. Not a full Deno typecheck. Selected production ESLint passed; canonical action-risk190 classified/0unclassified, migration lint1checked/0warnings and whitespace checks passed.
- Restrictive C0b currently reports exactly three changed source dependencies;60negative/metadata cases pass, the source acceptance case fails pending distinct review. Guard/extractor/metadata/dispatch pins were not edited or autoaccepted. Proposal: three source scalar renewals plus the unchanged canonical mailbox policy dependency for root review. Required exact-head hosted CI is still a release gate.
- Original failures are retained: local Windows CLI/telemetry and dependency-link startup attempts; PowerShell inherited-output PostgreSQL startup stall and connection-refused runs; native error decoder CRLF failures; earlier fixture metadata omissions. The test-only error decoder removes trailingCR without changing expected SQLSTATE/message assertions. None is relabeled as product PASS.

## Release and acceptance

Forward migration `20271109040000_personal_email_sender_authority` was generated using official Supabase CLI2.109.1, then reserved as an unapplied forward version after planned25000/30000. It replaces only existing prepare/readbinding functions and preserves service-only ACLs; no historical source or data rewrite. Root rechecks the actual migration frontier and deploys native authority before dependent Edge code through normal reviewed procedures.

Independent source/bypass review, explicit reviewed-pin application, exact-head CI, main merge, production native/Edge source readback and authenticated ordinary SOLO positive/negative/reload/recovery remain OWED at this source checkpoint. No keys, OAuth grants/scopes, DNS/domain change, connector activation, provider API, real communication, purchase or money operation occurred. Real provider acceptance needs a separately authorized controlled recipient/content/send; missing provider readiness must be reported as configuration, not bypassed. Owner product acceptance follows technical release.

Grounding/collision: ANT-21/52/147/50/51/138, Master/Brain/portfolio/registry and current main/open PRs checked. Preserve E01#2311 guidance, Portal sender work, root Chat/Spine/C0b and Calendar30000. Master§5 pending Communications limitation and eventual§4.0 source/release closeout are handed to the root BUG integrator; no shipped claim or duplicate tracker is created here.

## Reviewed composition and literal source-contract application

The frozen original source1474d30f9f0d512e4177aa5290f76ac00bb76749 received separate NON-AUTHOR review, sealed scan69fb0b59-d4dd-4983-9f08-03a71a80bbd1, zero material findings. Review receipt SHA2562f801695e64177b89f4e124a41c54b1c95e4186740fa6a5b0efc222f10d83054 retains the independent six actual transport cases, original author evidence and provider/native limitations. Maina6ef8dd28 and Calendarf25 normal composition at30f9ac9c6a9c4ef961d76345480a355a6ab65a13 preserves all22 other original owned blobs exactly; the shared workflow retains every incoming proof command and only appends the reviewed personal-sender flag to its incumbent email concurrency invocation.

Root explicitly applied the reviewed three existing source digest pairs and unchanged canonical mailbox policy ancestor. All other105 existing dependency pins and all29 dispatch scalars remain unchanged; exact inverse restores the complete prior guard. Extractor, frozen metadata and acceptance logic do not change. Root mechanical review is AUTHOR-REVIEW / LOWER ASSURANCE; subsequent distinct application review is separate from the original source review. No source digest is automatically generated into acceptance.

The existing ancestry test retains its exact inventory assertion, now109 for one additional policy ancestor. All four Calendar refusals and actual admission-consumer checks remain. Added actual-source mutants refuse bypassing personal mailbox ownership and skipping the final transport freshness check; root target passes7/7 with no skips. This does not claim an actual provider send. Native30000 then35000 then40000 release order, final exact-head CI/review, authoritative native/Edge source readback and authenticated customer/provider/Live proof remain required; no credential, connection, permission, financial or provider activation is performed.

## Standard UI and release evidence — unpublished forward-version successor

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: existing Chat prepare, exact approval, canonical native claim, transport, result and Rail flow traced in the original source packet and separate1474 review; this successor retains that same flow
PAIGE_UI_DESIGN: PASS: incumbent typed Chat approval and Conversations surface contract reviewed; no frontend markup, styling, navigation or container changes in this backend authority slice
MATERIAL_FLOW_CHANGE: NO: restore correct personal-sender authorization within the existing business-email flow; no new human decision, control, destination or approval channel
FLOW_PROTOTYPE: NOT_REQUIRED: backend authority and compatibility repair reuses the original prepare, approve, execute and recovery states without changing the interface
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: every eligible existing and future SOLO owner/admin may select their own personal sender or an authorized shared sender for an exactly approved business email
VISUAL_DIRECTION: NOT_APPLICABLE: no pixels, layout, tokens, typography or frontend interaction source changed
AUTOMATED_EVIDENCE: PASS: original1474 author proof includes20 native assertions and separate peer transport6 cases; rootc486 ancestry target7 passes with all four Calendar and both email mutants retained; these are protected local checks, not provider execution
STATIC_EVIDENCE: PASS: independently recomputed three source digests and unchanged policy ancestor;105 other dependencies and29 dispatch contracts preserved, inverse guard bytes exact; original semantic comparison introduces zero diagnostics beyond the disclosed environment baseline
RENDERED_EVIDENCE: NOT_APPLICABLE: this parcel changes backend authorization and evidence only, with no frontend render or geometry change
BEHAVIORAL_EVIDENCE: PASS: existing isolated handler and PostgreSQL fixtures exercise owner/actor drift, exact native authority, transport refusal and recovery; synthetic ports and recorder limits remain stated above
AUTHENTICATED_RUNTIME: UNVERIFIED: no controlled ordinary-customer email send has been authorized or performed; deployed native and Edge source identity, connected sender readiness and exact recipient/content/provider result must be verified before any live-send claim
KEYBOARD_FOCUS: NOT_APPLICABLE: existing approval card controls and focus behavior are untouched; no keyboard path was added or redesigned
ZOOM_REFLOW: NOT_APPLICABLE: no frontend style, dimensions, overflow or layout source changed
REDUCED_MOTION: NOT_APPLICABLE: no animation, timing or motion preference behavior changed
STATE_COVERAGE: PASS: source and protected controls cover own personal/shared sender, wrong or absent original actor, changed owner/provider, pre-provider refusal and uncertain original-operation recovery without fallback
TRUTHFUL_STATE_LABELS: PASS: readiness remains a configuration/authorization result, never a provider execution claim; local source, reviewed release, native deployment, authenticated outcome and Live acceptance remain separate
SOLO_UI: NO: backend authorization slice affects incumbent SOLO Chat and Conversations contracts but changes no SOLO frontend source or visual surface
UNVERIFIED: current47000 disposable proof awaits its actual reported result; production native47000 and affected Edge are not deployed by this parcel, and controlled customer/provider send, durable production receipt/reload, paired-account proof and Live acceptance have not run

INTERNAL_BUILD_IDENTITY: reviewed-source=1474d30f9f0d512e4177aa5290f76ac00bb76749; reviewed-root-composition=c48620b86cf930b4e4226ff143c489c52fd58ccb; metadata/rename successor exact identity supplied in the immutable Git handoff; deployment=NOT_DEPLOYED; environment=development; migrations=PROOF_OWED(20271109047000); edge=PROOF_OWED(comms-email-command,sales-invoice-command,sales-invoice-delivery,send-message); evidence=docs/evidence/ui-delivery/ant21-personal-email-authority.md
RELEASE_CHANNEL: development: isolated source and disposable protected tests; no production or staged activation in this parcel
RELEASE_CLASSIFICATION: internal-only: restoration source/evidence candidate with reviewed authority contracts, not a customer release or completed business-email outcome
CUSTOMER_RELEASE_IDENTITY: none: customer outcome is not yet deployed or authenticated; no customer version or announcement assigned
RELEASE_NOTE_REQUIRED: no: internal restoration candidate only; root may later compose an evidence-backed customer outcome under the canonical publication policy
RELEASE_TRUTH_BOUNDARY: PROOF OWED: scope=governed personal/shared-sender business email; blocker=native47000 and dependent Edge not deployed or authenticated, real provider send not authorized; excluded-from-LIVE=actual email delivery, production receipt/reload and Chat/Live customer acceptance; evidence=docs/evidence/ui-delivery/ant21-personal-email-authority.md
RELEASE_RECOVERY: position=reviewed forward authority functions must precede dependent Edge, with no historical rewrite or data backfill, and failed or uncertain sends retain canonical claim/reconcile controls without blind replay; reference=original1474 source receipt and rootc486 composition receipt linked in this record

Original40000 labels and earlier ordering above are historical source evidence. Root's current authorized sequencing renames only the still-unapplied email migration to47000 and updates the incumbent proof input, keeping the SQL body identical. Current order is Calendar30000, Knowledge45000, Task46000, email47000, then dependent email Edge. No applied migration is renamed. E09 Portal2320/native10010000 retains separate ownership and shared-CI chronological coordination.

This metadata pass is AUTHOR-REVIEW / LOWER ASSURANCE by the original email source author. Original source review remains the distinct sealed1474 review2f801695e64177b89f4e124a41c54b1c95e4186740fa6a5b0efc222f10d83054; root composition/pin/test review remains separate receipt114d55a656e98f75d6c6624e9bb3e22321f685a07faa35bdd9daacfbb950364c. Neither metadata nor a source-preserving rename substitutes for required final-head CI, authoritative production readback or authenticated provider/customer acceptance.

## Controlled Communications CI fixture dependency correction (2026-10-17)

Hosted run39072437138/job117512637479 at head ec781595191f7f1f8b3ff5a7693d8528a0b7350e failed the existing Controlled actual Communications handlers and strict server floor step:135 total,134 PASS,1 FAIL. The original managed-Resend positive reached the actual send-message mailboxAllowed call and threw ReferenceError: decideContentRead is not defined. The runtime imports the correct canonical inbox policy; its controlled VM fixture stripped import syntax but never loaded that imported implementation. This is a fixture dependency defect, not evidence that production policy or provider authorization should be removed.

The bounded successor changes only the existing comms-email-provider-boundary.test.mjs fixture and appends this evidence. Its VM now executes the actual pure inbox-intelligence/policy.ts source alongside the existing actual provider floor. No always-allow policy port replaces it. Independent connector snapshots represent separate metadata reads so the final boundary can observe an owner change without mutating the original selected sender. Existing135 tests and assertions remain; no handler, canonical policy, strict floor, native47000, C0b pin, role, provider, workflow or runtime behavior changes.

Failing-first local reproduction uses the exact seven-file node --test command from the unchanged CI step:135 total/134 PASS/1 FAIL, matching the hosted ReferenceError. Three added personal-sender controls also fail before the dependency is loaded. Final same full command: **138 PASS/0 FAIL/0 skipped**, comprising all135 incumbent cases plus personal-owner success, nonowner refusal despite an allowed provider floor, and owner drift on the second connector read immediately before dispatch. The drift remains a truthful failed result/audit with no provider or credential-access callback; the initial nonowner refuses before any write. These are controlled callbacks, not real external sends or Vault reads.

An intentionally permissive test-only policy mutation fails the new nonowner case (actual200 versus required403). The fixture is restored byte-exactly in finally before further checks; no permissive mutation is committed. A console encoding error occurred after that actual mutant run and restoration; the retained raw log and assertions were subsequently read/verified explicitly as UTF-8. This is not a product failure or a waived check.

Private sibling work/email2325-boundary-fixture-proof retains the decoded hosted log, local red/new-control red/green and mutation proof. SHA256:

- controlled-before.log:2b5e19c8cd1589cbcd15d37f90699f59462e8634e720d642feb63cd2cea36dd3
- personal-policy-before.log:33562f3fa7908a4c1b9df1b06e77220e79825311fd76d736c3e083b02207e078
- controlled-after.log:f44357f393b82cadef9617da616e2bb22535db88fd9e3ecc939098bf5bd8d4f2
- policy-always-allow-mutant.log:3a4441d7e618ee9edc036465eb7a7610bb3beb92f564d1af0eabbd649cffa877

Node syntax check and the unchanged Communications floor wiring guard pass; wiring is structural proof only. The repository ESLint rules are scoped to TypeScript, so no MJS lint coverage is inferred from a no-warning CLI result. No new TypeScript source or native SQL changed; the previously reported unchanged47000 native20 PASS is retained rather than rerun as a ritual. Current main88e544d5ad4a760b21b2845e3b570d23ae424a4e, E09 Portal2320/af4ac78 and root Task/Chat/Spine/pin leases remain separate; this correction edits none of their paths.

The original1474 source review and114d application review remain their stated evidence only. Distinct review of this fixture successor and fresh exact-head CI are required before root publication/release. No push, PR mutation, production connection, provider call, OAuth/credential action, email send, native application, Linear update or customer acceptance occurred here. Native47000 before dependent Edge, production source/receipt/readback, ordinary authorized positive/negative/recovery and separate Live/owner acceptance remain owed.
