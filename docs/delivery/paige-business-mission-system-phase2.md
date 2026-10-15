# Paige Business Mission System — Phase 2 foundation

Status: infrastructure-only draft release candidate; not merged, migrated, deployed, or production-proven.

## Owner-intended outcome

Preserve the approved tenant-safe Mission source of truth and governed Paige mutation path without committing production to the rejected Business Game Plan composition. The separately owned Business Game Plan redesign may consume this contract, but this branch owns no page layout, route composition, CSS, UI state hierarchy, or render harness.

## Ownership and collision result

- This branch was rebuilt from current `origin/main` at `1a183149ab06fcdd013b257b62a8740989f7e302` after #973 and #980 changed the Business Game Plan UI and its harness.
- The current-main `SoloGamePlanWorkspace`, `useSoloGamePlan`, Command Center mount, CSS, tests, and render harness are preserved byte-for-byte. The rejected `SoloBusinessGamePlanWorkspace`, its hook, CSS, and component tests are absent from this branch.
- PR #952 remains superseded as an implementation direction. Its design contribution remains historical input; this branch neither revives nor deletes its UI.
- PR #776 remains untouched. Phase 2 adds no Mission Rail reader, writer, event, hook, or grant.
- The governed MCP-door work from #960 remains intact. Mission tool discovery is additive to its canonical MCP checks.
- Current-main Campaign and artifact work does not overlap the retained Mission schema or tool contracts.
- Hot master-reference and decision-log files are not edited here. Merge-ready record reconciliation remains with their active owners.

## Durable Mission/backend infrastructure

New durable contracts:

- `business_missions`: tenant-owned identity, lifecycle, next action, revision, and honest close-out.
- `business_mission_brief_versions`: immutable, append-only Mission Brief history.
- `business_mission_mutation_receipts`: tenant-and-actor-scoped idempotency receipts for atomic create, revise, and transition replay.
- Server-resolved owner RPCs: create, revise, transition, list, and get.
- Three high-risk Paige chat tools registered through the existing stored-argument approval gate.
- A presentation-neutral TypeScript projection for the future Business Game Plan adapter.

Reused contracts:

- `current_user_tenant_id()` and canonical `is_tenant_owner(actor, tenant)`.
- Existing Paige pending-confirmation approval and refusal path.
- Existing action-risk and governed MCP-door enforcement.
- Existing Trust Compass `list_tool_autonomy` catalogue, extended with visible controls for the three Mission record mutations.
- Existing `paige_audit_log` for safe owner mutation attribution.

## Business Game Plan redesign ownership

The Business Game Plan UI workstream owns:

- strategic record hierarchy across annual, semiannual, quarterly, seasonal, campaign, Mission, decision, and revision contexts;
- page composition, information hierarchy, interactions, responsive behavior, styling, and all UI state presentation;
- adaptation of current-main `useSoloGamePlan` and `SoloGamePlanWorkspace` to this durable contract;
- real browser and authenticated UI proof.

This infrastructure branch does not prescribe a readiness-checklist layout or task-list information architecture.

## Exact integration seam

```text
Owner strategy in Paige chat
  -> Paige proposes structured Mission arguments
  -> existing stored-argument approval gate approves or refuses the exact call
  -> caller-JWT Mission RPC creates or appends an immutable Mission Brief
  -> list_business_missions / get_business_mission return tenant-safe projections
  -> redesign-owned useSoloGamePlan adapter maps those projections into Business Game Plan
  -> future Paige context reads the approved Mission and Brief revision, never an unapproved draft
```

Lifecycle detail: a partly achieved Mission is `lifecycle_state = completed` with `closure_outcome = partly_achieved`; it is not a separate lifecycle state. No Mission evidence link exists yet, so Systems Check, Mind, and Rail must not be inferred from the audit log.

## Governance and truth

- Only resolved top-level standalone Solo tenant owners may use the Mission RPCs.
- Co-owners read the shared tenant portfolio; `requested_by` is attribution, not a private partition.
- Expected revision is mandatory for revise/transition and rejects stale or missing values.
- Duplicate request keys replay the committed result; a different payload under the same key fails closed.
- Chat provenance requires the caller's coach-lens, owner-side thread in the resolved tenant.
- Direct browser table writes remain revoked; RLS is enabled; SECURITY DEFINER functions re-check caller and tenant in-body.
- Chat results say a Mission record changed. They do not claim work executed, a client was contacted, an outcome occurred, or Rail evidence exists.
- The Spine catalogue uses `chatBinding: LIVE` to mean the callable chat binding is implemented and passes the registry invariant. The overall capability remains `maturity: PARTIAL`; because this branch is not deployed, the user-facing production status is `UNVERIFIED`, not LIVE.

## Explicit exclusions

No Business Game Plan UI replacement, Rail integration, Work Orders, internal/external workers, Promise Ledger, Client Engagement, Client Portal, Decision Lab, adaptive learning, subaccount/Agency/Enterprise UI, rollout, merge, migration, or deployment.

## Proof status

Automated/local proof present:

- Mission source-contract tests.
- Action-risk, one-approval-gate, chat registry, governed MCP-door, tool-autonomy catalogue, definer-function, migration-version, write-target, and Rail-grant checks.
- TypeScript ratchet and production build.
- The executable SQL contract passed 30/30 assertions in a disposable loopback PostgreSQL 16 database, covering owner/co-owner/member and workspace boundaries, direct-table denial, immutable briefs, lifecycle validation, stale revision, idempotency, and exact receipt/audit counts. Because standalone PostgreSQL did not provide pgTAP, the repository SQL body ran unchanged with transaction-local compatibility assertion helpers and rolled back.
- The true concurrent harness passed: duplicate create produced one Mission plus one replay; competing same-revision updates produced one commit plus one revision conflict.
- Native Supabase CI passed a zero-to-head database reset, the 30-assertion pgTAP Mission suite, and the concurrent replay/revision harness.
- Independent pre- and post-current-main collision review.

Proof Owed before final release consideration:

- Full zero-to-head migration replay and the native pgTAP suite in an isolated Supabase stack.
- Authenticated browser flows for tenant/workspace switching and Mission reads.
- Deployed Paige approval, refusal, retry, and replay proof.
- Genuine browser review of the redesign-owned Business Game Plan UI.
- Deployment and exact-SHA production proof.

No capability in this record is claimed live.

## F7 continuation — Play-linked numeric target foundation, 2026-10-14

Owner approval ANT-138 `41a29a57-2ded-4e4c-bf15-ae34116147ef` selects numeric
targets attached to existing Strategic Plays. E02 is the sole implementation lead;
retired agents are not a dependency. This is a bounded foundation on main
`ffbdd1d3c1b7fa2aebbc79fcf2562c7822f80006`, not completion of O10 or all nineteen.

Pre-edit capability routing:
1. Owner sets/revises/pauses/retires a measured Play goal and returns to the same record.
2. F7 Business Game Plan owns targets; existing Analytics owns definitions/actuals.
3. Existing current-caller Mission domain, Analytics issuer/resolver and Rail are reused.
4. `business_mission.targets` is a read registration only, self-description off;
   Chat/Mind binding explicitly UNAVAILABLE. New mutating Chat admission is absent.
5. No external connection/provider or expense is required or activated.
6. Native owner RPC authority remains `business_mission_owner_context`; eventual
   Chat mutation requires the existing high-risk canonical approval/admission path.
7. No job, event runner, scheduler or automation is added.
8. Existing `business_mission_mutation_receipts` plus immutable revision, exact canonical
   readback, narrow receipt readback and existing `recordCapabilityRun` are the proof path.
9. Existing Game Plan surface remains PARTIAL; no UI, native Edge door or Chat handler
   mounts these new adapters in this foundation. The consumer flow remains required.
10. Source proof cannot establish release, target writes by Antonio or customer acceptance.

Proposed `20271101180000_business_mission_numeric_targets.sql` adds exactly the shared
target and immutable version relations under existing Missions. Caller input never selects
tenant/actor; raw browser access and service-role RPC fallback are revoked. Revisions use
Mission/target CAS, request-key/payload idempotency and atomic existing receipt/audit writes.
Replay rechecks current authority even after metric-reference expiry. Pause/resume/retire
append history; retired is terminal. The native adapter verifies the EXACT committed revision
and receipt before Rail, so later edits do not turn a historical replay into invented failure.

Actuals are never persisted here. `observeMissionTarget` consumes the existing issued metric
contract, checks workspace/version/dimensions/unit/range/calendar/currency/expiry, and computes
decimal variance without floating-point loss. Missing actuals stay unavailable, partial coverage
has unknown attainment/no trustworthy variance, and today's snapshot cannot prove a past target.
The saved IANA period calendar is explicit; overdue retains the issuer's business calendar.

Local proof: 82 focused tests including the existing Mission adapter and Spine registry; 39 rollback-only SQL
assertions against the real incumbent issuer/resolver and target migration; actual concurrent
duplicate creation produces one target/receipt and a replay, competing revisions one commit and
one CAS refusal. Identity/relation scaffolding is synthetic, not full Supabase/Auth acceptance.
Both SQL suites are wired into the EXISTING Spine workflow. Earlier hosted SQL and concurrent
assertions passed; fixture retirement then correctly refused its retained temporary issuer
reference. The proof now deletes only its own random fixture reference before the canonical
retirement checks; production deletion guards are unchanged. Three failing-first SDK-returned
transport regressions also pass after preserving uncertain intent unless a PostgreSQL
transaction-aborting SQLSTATE proves refusal. Final composed-head hosted results remain owed.

Owner explicitly authorizes sole-lead author self-review, lower assurance, instead of another
agent/nonauthor review; final human review is of the integrated deployed experience.
Remaining sequence: final composed-head author self-review/exact-head CI and authorized release of this
contract; prototype and complete native target editor/recovery/history; same canonical target
and issuer in Executive and governed Chat/Live; authenticated SOLO positive/negative/reload
evidence; owner acceptance. Storage approval grants no privileged production activation,
provider effects, protected fixture creation or INT-346 exception. Shipped-log status N/A:
this foundation has not merged. Master/Brain and the existing E02 matrix remain canonical.

### Native consumer continuation — pre-edit contract

The next bounded slice EXTENDS the existing `business-mission-action` owner door and
Game Plan Strategic Play detail. It REUSES the canonical target/RPC/issuer/receipt/Rail
foundation and existing scoped browser recovery pattern; it does not replace a shared
capability. Intended outcome: the Solo owner sets or revises a measured Play target,
sees compatible actuals and exact variance, inspects its immutable history and receipt,
and safely returns after interruption. Complete conversational integration remains required.

The existing Harness caller/authority and Rail layers are used as currently implemented,
with their incomplete acceptance unchanged. `business_mission.targets` remains a read
registration; no mutating Chat admission or INT-346 activation occurs in this native slice.
No external provider, expense, job or event is needed. Native mutation is an explicit
owner control through the incumbent owner RPC authority, with no second approval channel.
Unknown response retains its exact original intent/CAS/request key before any writer;
scope/role loss hides private state and forbids replay into another workspace. Recovery
storage is tab-local UI intent only, never business truth, authority or a receipt store.

The `command-center.business-game-plan` Binding Ledger row remains PARTIAL. Existing
Mission, approvals, current-account navigation, one shell, Chat/Live history, Mind/Memory,
provider and security boundaries must be preserved. Source tests and the deterministic
`e2-target-flow-prototype.html` do not prove customer writes, native pixels or acceptance.
The owner authorizes implementation/release without intermediate design approvals and
reserves human review for the complete deployed experience. Use the prototype's compact
target rows, existing detail context, inline field validation and recoverable editor; no
new top-level route or dashboard. Native browser/capture holds remain explicit.

Local implementation now mounts measured target rows/editor in the existing Play detail.
SDK reads canonical target/history and issued/resolved actuals, revalidates actor/workspace/
Play before and after calls, and retires A-B-A lifetimes. Exact decimal/currency inputs and
saved IANA calendar periods reuse existing utilities. Unknown requests are retained before
dispatch as scoped tab-local UI intent and reconciled under the same args/key/CAS. Saved
revision, activity gap and uncertain outcome stay separate. No new approval/metric/receipt store.

The existing owner Edge door uses the shared target adapter. Native-only owner capability
keys are attributed through the incumbent Rail display chain; unrelated families delegate
unchanged. A forward extension of the existing owner history RPC projects matching canonical
receipt references for each immutable revision on later reads. Private hashes/bearer references
remain excluded; current owner, foreign/member/revoked denial and service restrictions survive.
The unchanged issuer metric-key list moves to a dependency-free shared module, re-exported by
its existing server reader, so browser imports cannot include the Node-only capability kit.

Native source proof: SDK/recovery/form/hook/actual HTTP49 tests, historical SDK6,
actual-panel4 and actual-drawer3; local target SQL50 and display8 assertions PASS.
An initial drawer worker initialization timeout executed no drawer tests; a bounded
single-worker rerun passed3. First type/build checks found a callback return-type mismatch
and server-module import; both are repaired, with final verification still pending.
These synthetic source checks are not authenticated customer acceptance or fullO10 delivery.
Evidence: docs/evidence/ui-delivery/e2-f7-native-targets.md. Executive/Chat/Live consumption,
rendered/native coverage, production release, protected acceptance and owner review remain owed.
