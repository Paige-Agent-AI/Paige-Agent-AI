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
