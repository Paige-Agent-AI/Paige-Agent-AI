# One approved manual reminder: native lost-acknowledgement prerequisite

2026-10-18 local implementation checkpoint. AUTHOR-REVIEW / LOWER ASSURANCE.
Independent review, Chat integration, hosted exact-head CI, persisted migration apply,
ordinary authenticated recovery and owner acceptance remain owed. This belongs to the
original ANT-21/52/147 J19/J20 restoration project; strict closure stays 1/18 and 2/50.

## Native contract

The forward migration `20271110023000_reminder_approved_intent.sql` adds two narrow RPCs
on the existing `paige_durable_work` envelope. It adds no table, queue, scheduler or
provider path. The existing nine-argument `public.plan_set_reminder` writer, durable
creator/transition, native audit and capability-run Rail remain unchanged.

`adopt_paige_reminder_approval` is service-only. It locks and selects the exact canonical
server-issued proposal using its UUID, original actor/tenant/thread/client, tool,
fingerprint and issuance nonce. The confirmation request nonce must differ from the
issuance nonce; the separate runtime request nonce must match canonical native admission.
Normal adoption also requires issuance before that admission turn. Stored args, rather
than caller-supplied approved args, produce the normalized native call. Proposal consumed
CAS, envelope creation and one-time immutable request-payload attachment share a transaction.
Stable durable intent is the proposal UUID. Consumed-at or generic envelope/terminal JSON
alone is never a reminder approval seal. No server idempotency key is returned.

`execute_paige_approved_reminder` is authenticated-original-actor only; anon/service have
no EXECUTE grant. Its fresh native checks bind original actor/current workspace/active
membership, original workspace-audience thread and unscoped focus. Unexecuted work also
requires current ACTIVE rollout, admitted/latest/executor ownership, unique canonical
user admission, exact normal runtime binding, no Stop/terminal/recovery hold, live lease
and proposal expiry, current native target rows/roles and canonical tool-autonomy policy.
Relevant rows stay locked through use. The same transaction marks dispatch, calls the
unchanged writer, verifies reminder fields, original audit UUID and native Rail, then
settles the original envelope. Functions have no commit boundary between those operations.
Any native error rolls them back together.

The only audit change is same-transaction provenance on the original newly created audit's
`data`: work UUID and normalized args. Its native UUID, existing fields and single Rail are
preserved; no second audit or Rail is inserted. Terminal replay verifies this provenance
and the original native receipt after fresh original scope checks. It returns explicitly
historical original result/readback after an edit or deletion, without recreating a record
or representing old fields as current. Missing original thread/proposal/evidence refuses.
Historical terminal reads may survive Stop/latest/hold/OFF/expiry; none dispatches work.

This v1 bridge supports unscoped workspace threads. Exact, otherwise-valid proposals in
the deliberately excluded tenantless-owner, legitimate nonmember-native, canonical
threadless, client-focused or genuine unbound-runtime classes return named `unsupported`
before CAS/work. Root's later integration must retain all incumbent authority fences and
allow fallback only for those reviewed classes. Invalid/expired/declined/error/ambiguous
outcomes never imply unsupported or AUTO permission. Full focused-client bridging is owed.

The current policy gate calls unchanged `resolve_tool_autonomy(tenant,'plan_set_reminder')`.
Its actual four inputs (`admin_app_settings`, `paige_systems_check_finding`,
`paige_systems_check_registry`, `tenant_tool_autonomy`) acquire deterministic SHARE NOWAIT
locks for this short native transaction. Both RPCs have a one-second lock timeout.
This deliberately trades brief global policy-write contention for a native validation/use
fence, including missing-row INSERTs; no policy setter/resolver or grant is broadened.
OFF refuses new adoption/effect. Canonical safety demotion to CONFIRM still permits only
the original valid human approval, not inferred AUTO execution.

An exact sealed v1 work row locked FOR UPDATE may normalize only `claimed`, never-dispatched
(`dispatch_started_attempt=0`), lease-expired work with no terminal/native correlation to
canonical `expired` through the unchanged transition. It returns `existing`/`expired`.
No unknown/running/other-kind/historical success is reconciled, no approval is unconsumed,
and no retry/reclaim occurs. A fresh customer intent and approval are required afterward.

## Actual local evidence

The runner `scripts/proof/paige-reminder-approved-intent.mjs` accepts an explicit disposable
loopback port; 5432 requires `CI === 'true'`. It never accepts a remote URL or credential.
The private launcher used PostgreSQL 16 on loopback65471, Node24.18, neutral UUID fixtures,
and actual authenticated/service database roles. Auth identity is a local GUC-backed port,
not a signed JWT or production authorization proof. Minimal Auth/domain/provider tables,
role helpers and a no-op realtime transport are disclosed fixture infrastructure.

- Baseline without the new migration: the actual unchanged writer retried after an ignored
  acknowledgement creates two reminders; the one-reminder assertion fails with P0001.
  `work/reminder-approved-intent/red-native.log`/`red-result.json` retain exit1/stop0.
- Final fresh native run: **156 SQL assertions PASS**, plus the unchanged rolled-back
  durable-envelope proof and catalog equality. Test exit0, cluster stop0 and absent PID file
  are recorded in `green-156-expiry-retirement.log`/`green-156-expiry-retirement-result.json`.
- Nine actual two-connection controls cover serialized adoption, serialized execution,
  absent OFF INSERT, existing OFF UPDATE, effect-before-OFF, Trust-ceiling INSERT,
  safety-finding change, expiry-before-execution and execution-before-expiry. The proof
  observes real native lock waits or NOWAIT refusals. Duplicate calls leave one work,
  reminder, audit, native Rail and terminal. The expiry races yield terminal success OR
  expired/no effect, never expired plus effect.
- Eight injected transaction-stage refusals cover consumed CAS, creator, payload seal,
  writer, audit INSERT, Rail INSERT, provenance audit UPDATE and terminal transition.
  Each leaves no escaped reminder/audit/Rail/dispatch/terminal; the exact original can
  subsequently execute once. Wrong actor/workspace/thread/client/nonces/fingerprint,
  native target/role changes, private audience, Stop/latest/hold/binding failures,
  declined/expired/unissued proposals, forged generic work/terminal and unknown/blocked
  work remain refused. Historical replay preserves original IDs and fields after change,
  deletion or a session timezone change.
- Deliberately omitting only the policy consult calls causes the retained negative-control
  failure `current OFF cannot consume an approval`. This is a candidate perturbation,
  not a claim about published predecessor source. The later scalar-parser tooling failure
  is retained separately; exact SET/RESET output tags were removed before the successful
  canonical-CONFIRM assertion. No security assertion was removed.
- Actual current Operator archive/preflight/child-first deletion functions and deletion
  plan are reused. Claimed no-effect work holds archive; bounded expiry makes current
  preflight available. Mandatory archive-audit failure rolls back. Canonical purge then
  removes reminder/proposal/work/thread children, retains shared Auth and another workspace's
  membership. Empty provider relations/no-op resource readiness do not prove provider
  retirement. Actor-only Auth erasure still hits the existing FK restriction; that shared
  retention/cleanup dependency remains unresolved and is not changed here.
- Native catalog snapshots compare incumbent durable/Document/runtime/reminder/Trust
  bodies, OIDs, ABIs, owners, ACLs and function settings before/after two applications.
  They are equal. Existing envelope assertions pass; this is not full Document/Research
  execution or a full-schema replay. The separate #2341 thread-detach correction remains
  release-owned and is not copied or modified by this migration.
- Node syntax, both incumbent definer/ACL lints, changed-migration lint (zero warnings),
  whitespace and final migration-version checks are retained in the private static receipt.
  Hosted proof invocation is not included in this lease; root owns CI integration.

Local security advisors executed against the disposable proof database and returned exit1:
the synthetic `tenants` table lacks RLS after actual archive-policy installation. Other
WARNs concern incumbent/synthetic helper search paths and fixture pgcrypto placement.
No result names a new reminder function. This is an overall advisor FAIL, not a clean
security release. Database lint is UNVERIFIED/exit1: stock PG16 lacks `plpgsql_check.control`;
its native CREATE EXTENSION error and raw CLI output are retained. Actual SQL compilation
and invocation controls do not substitute for that unavailable lint.

Private `work/reminder-approved-intent/` contains the exact API contract, ten routing
answers, raw red/green/intermediate failures, process receipts and final hash manifest.
No source pins, Chat/Spine files, existing migrations/writers, role grants/settings,
production data, provider credentials, spend, activation, frontend or release changes
are included. Root owns distinct review, integration, hosted CI and any later release.
