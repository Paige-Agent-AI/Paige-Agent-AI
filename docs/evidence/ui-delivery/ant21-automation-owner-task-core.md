# Internal CRM task automation core — native proof checkpoint

## Current bounded continuation — 2026-10-16

Continuation base: `ee23c3365987be52b36f52605137eb4af01a4e38`. All prior WIP and the original
blocked checkpoint below are retained. The domain bridge is prepared in the existing native
adapter and the forward migration `20271108210000_owner_task_native_bridge.sql`; it has not
been applied to a hosted database. This is **not a releasable or activated customer automation**.

### Independent Review repair — successor to `d4b99cb26afb620bb6acda78a0fe5f9167bd84ec`

The distinct review of d4 returned **REVISE** despite its passing 41 native controls and 43 engine/C5
tests. An additional actual PostgreSQL negative demonstrated that the companion's displayed task
could differ from the original held command while the original task still executed. That failed
proof is retained unchanged at `work/owner-task-native-proof/run-CGbVc0/independent-approval-display-result.json`
and the lead's `work/automation-native-review-d4/independent-native.log`. It is not a production
incident or authenticated-customer proof. The historical d4 commit and evidence are not rewritten.

The bounded successor captures the exact incumbent-generated approval description at the first
database hold, alongside the existing source snapshot. The contact is already locked; the incumbent
`paige_orchestration_approval_content` remains the one description builder used by both capture and
mint. The protected ledger detail holds the same description already present in the companion;
the contact source projection remains minimized. Caller-supplied approval-binding JSON is discarded,
and the captured binding cannot be changed or reconstructed later.

A narrow `owner.task` companion trigger binds summary, complete draft content (including args),
category, risk, tenant/visibility and source/occurrence/process/capability/argument metadata. It
preserves the incumbent source/coordinate/direct-approve guards and permits unchanged operational
claim, review and recovery updates. Other approval types and other orchestration capabilities keep
their existing description-editing contracts. The native bridge independently compares the companion
to the original binding before a new effect, including when a fixture-only privileged corruption
bypasses the new trigger. Missing legacy binding is refused; no backfill is performed. A real task
that already landed remains truthfully readable and can be reconciled without another effect.

Final migration bytes: SHA-256 `af70e2a6b5aaa39a6c77c3531743c33fcbfddb3c6dec229cc01e24ea594995f4`.
Successor Independent Review, integration, full-schema replay, CI and all release/activation gates
remain owed to the lead; these local proofs do not close them.

The intended human outcome is one existing, eligible SOLO business approving a held new-contact
review and receiving one real internal CRM task with canonical readback and receipt. Portfolio
ownership remains CRM plus the shared Harness/Layer-C orchestration path. The exact native kind
is `owner.task`, the existing effect/risk tool is `crm_create_task`, and the missing Gateway
binding remains **UNAVAILABLE / root integration required**. No Spine or Gateway availability
is asserted by the adapter. No provider or connection is required for this internal-only task.
The existing process grant, C5 approval, dispatch claim, canonical CRM writer and result store,
capability receipt and Rail remain the only homes. Existing owner-only Chat arming/grant gates
remain dark; there is no replacement permission system, executor, store, scheduler or nonce.

### Source correction

- A database trigger captures the semantic process, complete reviewed act set and minimized
  event/contact source at the first `approval_pending` insert, before the existing companion
  is minted. Supplied source JSON is removed. Legacy rows lacking that database-authored evidence
  cannot reconstruct it at approval or acquire a backfill.
- The held source, exact args, occurrence coordinates, adapter, act position and first native
  approver/time are immutable. Current semantic context must match before an effect. This
  detects a current difference, not every edit-away-and-back without a native revision history.
- The DB-held approval description and its semantic metadata are immutable, and the original
  companion must match them before any new task effect. Editable unrelated approval contracts
  and truthful operational settlement remain intact.
- The service-only execution bridge accepts only event ID, act ID and correlation. It derives
  tenant, original approver, command and key from the protected ledger. It takes tenant,
  original-actor profile, membership, companion, ledger, ordered act-set, process and event/contact
  locks in that order, with NOWAIT at the context boundary. Native CRM authorization and
  idempotency remain authoritative. No actor, tenant or command JSON is accepted from the caller.
- A rolled-back pre-effect lock refusal remains `accepted_for_execution` with
  `proven_no_effect=true`. Unknown responses remain ambiguous; they never authorize blind replay.
- JWT-less cron uses an owner-only internal core of the installed canonical CRM result reader.
  The public reader's ABI, OID, owner, ACL, safe search path and service-JWT guard are preserved.
  No JWT or `auth.uid()` is fabricated. Reapplying the extraction fails closed rather than
  replacing the internal core with a recursive delegating wrapper.
- The incumbent reconciler gains an exact task arm: found receipt-backed result, proven absence,
  or unknown. Task recovery never uses journey-transition evidence, infers absence from an error,
  changes the original actor or declares a task failed merely because it aged.

### Fresh executed proof

`node scripts/proof/layer-c-native-vertical.mjs --owner-task-native` passes **66 native
PostgreSQL controls**. It starts and stops only its owned disposable loopback cluster. The
selected installed native table/function bodies, contact-created trigger, recorder, companion
mint/guard, redemption, dispatch claim, canonical CRM task writer/result/receipt and reconciler
actually execute. Two-session contention covers tenant, original profile/membership, companion,
ledger, act, process pause and contact; all lock refusals create no task and remain retryable.
Eight separate native claim sessions produce one dispatch owner and no claim-time task effect.
The proof also covers legacy refusal, immutable evidence, semantic/sibling changes, original
authority revocation/switch, JWT/ACL negatives, native receipt rollback, delayed result recovery,
and no false journey or age-based settlement.
The added native controls cover unchanged exact minted approval equality, forged INSERT refusal,
18 display/content/argument/identity mutations, JWT/source/coordinate/direct-approve negatives,
operational and unrelated-approval editing compatibility, independent pre-effect refusal after
fixture-only privileged display corruption, missing-original-binding refusal without reconstruction,
private-helper ACLs and landed-result recovery after later privileged display corruption. Privileged
fixture corruption is explicitly not evidence that an ordinary customer can bypass the trigger.

The same native proof runs `automation-chat-draft-recovery.test.ts` with its disposable SQL port
enabled: **43/43 tests pass, no skip**. The saved draft reaches the actual engine and C5 through
real native recorder/companion/redemption/claim/task/receipt SQL; duplicate approval reads back
the same task. Gateway availability is an explicit protected fixture in that isolated test,
not production evidence. Unrelated Auth/display/realtime/weekly ports are also fixtures. This
is selected-function native PostgreSQL proof, **not full-schema Supabase replay, HTTP/Auth/RLS,
customer QA or provider evidence**.

Final native output: `work/native-approval-binding-final.log`; native result and engine transcript:
`work/owner-task-native-proof/run-0csPHb/result.json` and `engine-c5-native.log`. Both disposable
native runs stopped only their owned servers. The earlier d4 proof and the first repair's 64-control
run remain historical evidence, not the final source proof.
Deno native-adapter compilation, scoped ESLint, proof syntax and whitespace pass
(`work/approval-binding-deno-final.log`, `work/approval-binding-lint-final.log`). The unchanged
historical nine-suite attempt is **NOT PASS**: 144 assertions passed,
the existing whole-edge-tree static scan timed out at 30 seconds, and two fork workers failed
to start. The three affected suites were rerun sequentially without changing assertions or
repository CI: **71 PASS / 1 FAIL across72 tests**, no runner errors. The sole assertion failure
is the unchanged native/Gateway registry-equality guard: `owner.task` has no Gateway binding.
The static dispatch-seam scan and both formerly unstarted suites execute in that rerun.
See `work/core-three-rerun.log`; neither campaign is described as fully green.

### Root-owned completion boundaries

The lead must integrate the existing Gateway/Spine capability binding, shared approval endpoint
and ordinary-owner authority, usable process inspection/arming against `paige_automations`,
current Chat bindings, source fingerprints and required CI command. The existing registry-equality
test remains intact to identify the missing binding. Independent Review, full-schema migration
ordering/replay, exact-head green CI, production deployment/readback, authorized customer action,
recovery/reload/isolation, equivalent SOLO cohorts, future-account behavior and owner acceptance
remain **UNVERIFIED**. Nothing in this checkpoint changes production, grants autonomy, sends a
communication or enables a provider.

## Retained historical blocked checkpoint

Base: reviewed Task `07d25ecbe122af7c233ff66d04842027b79284c4`.
This is a bounded, **non-releasable implementation checkpoint** in the existing restoration.
No PR, push, migration, activation, provider call, production business write or authenticated QA.
The complete customer automation outcome remains **UNVERIFIED**. The canonical program remains
the existing restoration matrices (h3 and h16); this record is evidence, not another register.

## Intended flow and preserved ownership

The same ordinary Chat-saved `contact.created` / `owner.task` draft enters the actual Layer-C
engine, remains held for review, then enters the existing C5 approval executor. Only the canonical
`task.create` command is supported, with a literal title and optional description. Unsupported
keys, templates, alternate subjects/actors, expiry-shaped configuration and historical bare
`tool_key: crm_create_task` acts are not reinterpreted. This creates an internal task assigned
by the unchanged native requester default, with no unsupported contact relationship or send.

The native adapter reads tenant, occurrence, exact args, key and the first native `approved_by`
from the protected act ledger. It binds the real `contact.created` event/subject to the contact
in that tenant. C5 stops overwriting the original task actor during later ledger advances and
uses that actor for recovery/Gateway attribution. A later reviewer cannot replace revoked
original authority. The existing CRM writer/readback revalidate that actor's current workspace,
seat, command hash and idempotency key. Empty, uncertain or unreceipted responses cannot claim
completion; a failed read is not absence and never authorizes redispatch. Landed results are
adopted through the existing canonical result reader. No new ledger, scheduler, approval home,
tool runner, provider registry or permission engine is introduced.

Chat, Gateway availability, owner-only arming/grant setters, UI and execute-approval remain
root-owned and unchanged. No capability is declared available by this adapter. The existing
registry equality assertion is retained and intentionally identifies the missing Gateway binding.
No account names, account allowlists, customer data, tokens or private production evidence appear.

## Actual proof and bounds

- Failing first on original source: 34 PASS / 3 FAIL in the existing draft fixture. Success and
  lost-ack/original-authority cases stopped at unsupported `owner.task`; all original23 draft
  controls passed.
- First bounded adapter/C5 pass: 73/73 across draft and incumbent approval suites.
- Current nine incumbent suites: **202 PASS / 2 FAIL / 1 SKIPPED (205)**. The failures are explicit
  blockers below; no assertion was removed or weakened. All other positive, tenant/subject,
  original actor, current role/process/contact, immutable args, replay, lost ack and uncertain
  result controls passed. The optional native SQL port is **SKIPPED / NOT_RUN**, not native proof.
- Deno2.9.6 `check --no-config --no-lock --no-remote` on both changed runtime modules: PASS.
- Targeted ESLint and whitespace: PASS (zero diagnostics).
- Required full-schema/native PostgreSQL and customer acceptance remain owed. Synthetic database
  ports are not proof of native locks, ACL, triggers or real effects. No backend release claim.

Reproduction uses bundled Node and existing Vitest, a task-local TEMP/TMP directory, and
`--testTimeout=30000`. Full command and original output are preserved privately under the
worktree's `work/core-vitest.log`. The nine suites are `automation-chat-draft-recovery` and
`paige-orchestration-{approve-executor,contract,decide,dispatch-claim,engine,n8n,subject-tenant,native}`.

## Blockers proven before release

1. **Final native command boundary race — FAIL.** The protected actual engine/C5 fixture pauses
   the process at `execute_crm_command`, after the adapter's last awaited context read. The
   unchanged CRM writer has no process/event/act coordinates and still creates the task.
   `refuses a process revoked at the native command boundary` expects no execution/effect and
   fails (`executed:true`). TS prechecks are not an atomic process/contact permission boundary.
2. **Native/Gateway registry equality — FAIL.** Native `owner.task` has no Gateway binding yet.
   Root owns that distinct capability review/integration. No availability literal or test bypass
   is added to production.
3. **Existing durable recovery needs an exact task arm.** The latest incumbent
   `paige_reconcile_orchestration_acts` in `20271028000000_experience05_weekly_commitment_check.sql`
   treats native client-subject acts with a correlation as journey-readable, then queries
   `paige_journey_stage_transitions`. That is not task readback: a landed task could become
   incorrectly failed after24h; unrelated journey evidence must never confirm a task. This
   checkpoint must not be activated with that mismatch.
4. Layer-C pending approvals have **no native time-expiry/TTL contract**. The source schema,
   current generated type and approval endpoint do not provide one. Unsupported expiry-shaped
   config is refused, but that is not a time-expiry test or a new expiration rule. No TTL is invented.

## Proposed smallest native bridge — review required before SQL

No runtime SQL has been authored or applied. Proposed forward migration numbering belongs to
root above the current frontier; no filename is reserved here.

`public.execute_owner_task_act(_event_id uuid, _act_id uuid, _correlation text) returns jsonb`
is a narrow service-only bridge beneath existing C5, not a new executor engine. No actor, tenant,
command, assignee, title or approval JSON is accepted as authority. It must:

1. Require service JWT and `auth.uid() IS NULL`, fixed safe search_path, revoke PUBLIC/anon/
   authenticated and grant only service_role. Derive preliminary actor/tenant/key solely from the
   existing protected ledger, then revalidate those exact values after locking it.
2. Preserve the CRM writer's lock order: tenant → original profile → original membership, then
   the source companion → ledger → act → parent process → event/contact. Acquire source/context
   row locks with NOWAIT, returning a retryable no-effect refusal on lock contention. This avoids
   waiting cycles with the incumbent approval-decline/reconciler path (approval → ledger), the
   act-change trigger (act → parent), and CRM writes (tenant/profile/seat before domain records).
   The final existing CRM/tool advisory lock order is retained inside `execute_crm_command`.
3. Under those held locks prove the unique orchestration companion's immutable occurrence/
   ledger/tenant association, current pending review state, protected native approval stamp and
   dispatch claim; exact `owner.task`, confirm lane, same key/correlation; genuine contact.created
   event and current same-tenant contact; unchanged live confirm process/act and supported exact
   immutable args. Compare versions using native timestamptz, never rounded browser timestamps.
   The held ledger creation time bounds later source revisions; do not invent a browser version.
4. Call existing `resolve_automation_autonomy` and existing canonical
   `execute_crm_command(original_tenant, original_approved_by, exact_task_create, original_key)`.
   Retain the latter's atomic active-workspace/role/tool-lane checks, task/result/receipt writes
   and rollback. Row locks serialize a concurrent source revocation before or after that write.
   Do not restate Gateway entitlement policy or change owner-only activation. Gateway and
   governedExecution remain mandatory before dispatch, not replaced by this domain bridge.
5. Return only receipt-backed canonical task readback. C5's existing terminal advance/receipt/
   Rail path remains; a lost acknowledgement is recovered from the same native CRM result/key.
   The bridge neither clears claims nor settles unknown work, changes approved_by nor grants auto.

The corresponding narrow read bridge derives the same original identity/command/key and calls
existing `read_crm_command_result`, with no execution or automatic replay. A definite NULL can
prove absence; errors, malformed results or revoked original reader authority remain unknown.
Reading an already-landed result must not depend on later process/contact versions.

The existing durable reconciler must gain an exact `owner.task` readback branch using that same
bridge; retain its existing claim-age/rotation/settlement machinery. Never route tasks through
journey readback, infer absence from an error, substitute a later approver, replay an ambiguous
effect or create a second sweep. Approved source changes and this composition require distinct
review and native PostgreSQL proof before any Gateway/UI arming work is considered releasable.

Required next tests include the current failing actual-handler boundary, two native sessions
racing source pause/edit/contact revision and claim/replay, original actor revoked/switched,
same exact task/key across a different retrying reviewer, committed-lost-ack readback, native
receipt rollback, service-only ACL, and reconciler adoption/no false journey evidence. Full
schema/ordinary customer activation and owner acceptance remain separate **UNVERIFIED** legs.
