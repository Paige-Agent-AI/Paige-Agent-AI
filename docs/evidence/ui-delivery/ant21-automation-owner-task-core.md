# Internal CRM task automation core — blocked source checkpoint

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
