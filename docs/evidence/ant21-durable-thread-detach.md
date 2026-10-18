# Durable work: honor the existing thread-delete FK

2026-10-18 local implementation checkpoint. AUTHOR-REVIEW / LOWER ASSURANCE;
independent review, exact-head hosted CI, persisted migration apply and customer proof are owed.
This is a prerequisite inside the original ANT-21/52/147 restoration scope, not a reminder
recovery implementation or a capability acceptance. Strict totals remain 1/18 and 2/50.

The actual PostgreSQL predecessor rejected deletion of a referenced Chat thread: the existing
`ON DELETE SET NULL` FK issued its child UPDATE, and `_paige_durable_work_protect_identity()`
raised `22023 DURABLE_WORK_IDENTITY_IMMUTABLE`. The native server log contains the parent DELETE,
the FK's `UPDATE ONLY public.paige_durable_work SET thread_id = NULL`, and that trigger error.

The forward migration `20271110022000_durable_work_thread_detach.sql` replaces only that existing
trigger function. A changed thread reference is permitted only from non-NULL to NULL when the
original parent is actually absent. Live-parent detach, reparenting and NULL-to-parent remain
refused. Every other original identity check and the one-time bounded request-payload rule remain.
No historical migration, table, FK action, caller RPC, writer or grant is changed.

**Material execution-context change:** the internal function changes from SECURITY INVOKER to
SECURITY DEFINER for its fully qualified parent-presence read. This avoids treating an RLS-hidden
live parent as deleted. The function refuses noncanonical relation/operation/timing/level bindings
before accessing row fields, retains its empty search path, and fails closed if RLS would apply to
the definer's parent read. CREATE OR REPLACE preserves the existing owner, ABI, ACL and trigger.
The local catalog snapshots prove those equalities, with only `prosecdef` changed. No caller
authorization derives from parent absence. No EXECUTE or table grants are added.

The rule uses the existing immediate FK's schema semantics; it does not trust trigger depth,
timestamps, diagnostic flags or a user-supplied deletion assertion. Parent DELETE and FK detachment
share one PostgreSQL transaction; rollback restores both. See the PostgreSQL
[trigger contract](https://www.postgresql.org/docs/16/trigger-definition.html) and
[foreign-key contract](https://www.postgresql.org/docs/16/ddl-constraints.html).

## Local native evidence

`scripts/proof/paige-durable-thread-detach.mjs` reuses `OperatorPostgresFixture` against an explicitly
selected disposable loopback port (never 5432). It applies the actual envelope and Document migrations
and extracts the current E09 `create_paige_durable_work` definition unchanged. Minimal synthetic
Auth/domain infrastructure is disclosed; current audience/membership gates and native FK/trigger
behavior execute in PostgreSQL. The fixture models the existing Chat-turn parent CASCADE edge.

- Red-first: `--baseline` fails on the real parent DELETE with 22023 after the incumbent envelope
  rollback proof passed. Private `work/durable-thread-detach/red-native.log`, `red-result.json` and
  the retained red cluster server log preserve the failure. Test exit 1; cluster stop exit 0.
- Final green: **73 native assertions**, plus the unchanged incumbent envelope rollback proof,
  passed. Existing work is byte-for-byte unchanged by migration and repeat application. Test and
  cluster stop exits are both 0; `green-native.log` and `green-result.json` retain actual output.
- Controls cover actual FK DELETE and rollback, multi-parent deletion, every immutable identity
  field, payload immutability/first attachment, unrelated updates, RLS-hidden parent, RLS-active
  definer owner, nested-trigger attempts, bad trigger bindings, real denied role calls, no raw
  grants, both neutral cohort creates, foreign actor/tenant/thread and customer-private refusal,
  existing terminal-result preservation, and unchanged actor/tenant RESTRICT behavior.
- Document artifact and Research work correlations survive as modeled. Existing Chat-turn
  CASCADE still deletes the removed thread's turn. This does **not** assert deleted transcript
  retention, full Document completion replay, Research execution, or any provider operation.
- `node --check`, both incumbent definer/ACL lints, changed-migration Python lint and version
  collision guard pass. Final frozen-tree guard results are retained in the private static receipt.
- Local Supabase security advisors exit 0: two WARNs concern only fixture stubs
  `is_platform_owner` and `knowledge_actor_authorized`; none concerns the changed trigger.
  `supabase db lint` is **UNVERIFIED / unavailable**: stock local PostgreSQL 16 lacks
  `plpgsql_check.control`; its actual CREATE EXTENSION failure and exit 1 are retained.

Runner: start a fresh owned PostgreSQL cluster, set `OPERATOR_PROOF_PSQL` and
`DURABLE_THREAD_PROOF_PORT`, then run `node scripts/proof/paige-durable-thread-detach.mjs`.
The private `work/durable-thread-detach/run-local.ps1` captures exact start/test/advisor/stop legs.
Initial Windows launcher failures were pre-assertion tooling failures, preserved separately;
the Supabase scaffold was created successfully before a telemetry shutdown timeout. Neither is
reported as the native red regression or a passing assertion.

No production operation or new retention/deletion policy occurred. Initiating-user and tenant
FK RESTRICT remain unchanged; the separately identified user-delete cleanup dependency remains
unresolved. No reminder adopter, authenticated grant, approval, Chat/Spine/source binding, role,
provider activation, scheduler or business-data change is included. Base main715200d remains
preserved; subsequently observed main797d8d0 adds only the reviewed Task consumer paths and leaves
all native inputs/frontier21000 unchanged. Root owns composition, release and acceptance.

## 2026-10-18 successor: hosted binding and canonical audience

Non-author review of frozen `f026d9cddf491a7225587cbb3d4260274f6345ad` identified two bounded
proof gaps: the new native runner had no hosted invocation, and its private-audience fixture used
the noncanonical `customer_portal` value. The prior receipt/history remains unchanged; it does not
claim that f026's 73 assertions ran in hosted CI or exercised a valid E09 private-audience value.

The existing `ci / comms-provider-boundary` disposable pinned PostgreSQL service now runs the
runner once as an unconditional step, with explicit `DURABLE_THREAD_PROOF_PORT: '5432'`. Existing
events, service, setup and adjacent proof steps remain unchanged. The runner permits that port
only when `CI === 'true'`; other local proofs still require an explicitly selected disposable
loopback port. The earlier "never 5432" statement describes the f026 local-only checkpoint.
No remote database URL, secret, new workflow/job or alternate fixture adapter is introduced.

The private fixture now uses canonical `customer_private`/client-lens input and the actual E09
audience CHECK (`workspace`, `customer_private`). Its refusal assertion is retained. The native
successor migration remains byte-identical to f026 (SHA256
`8f9496b2f3aa2cad5b52686db9dc18335b0ac2770e682d38a9011df888730de0`).

Fresh corrected local PostgreSQL proof with `CI=true`: 73 assertions plus the incumbent envelope
proof and catalog/existing-row/reapply comparisons PASS; native and cluster-stop exits 0.
Private `work/durable-thread-detach/successor-ci/` retains the exact run and workflow validation.
The YAML parser verifies the one unconditional invocation; removing only its four added lines
restores the predecessor workflow. Five actual runner controls (missing port, non-CI 5432,
false/uppercase CI 5432, URL supplied as a port) refuse before fixture construction. Syntax,
diff hygiene and final migration-version checks pass. Unchanged broader campaigns are retained,
not represented as newly rerun. Original local advisor warnings and unavailable `plpgsql_check`
remain recorded above. Independent successor review and hosted exact-head execution are owed.

## 2026-10-18 corrective checkpoint: retain required thread lifetimes

Hosted P1 `PRRT_kwDOSAAXqM6tntUw` is valid. This supersedes the earlier unqualified detachment
claims; f026/47482/d07 receipts remain historical local proof, not release approval. The proposed
DELETE could detach claimed Document work after its start gate but before completion. Actual
`complete_paige_document_work` then inserted a NULL `thread_id` into the NOT NULL completion-turn
column, rolling back the artifact/terminal transaction. No paid provider was used to reproduce it.

Fail-first actual PostgreSQL controls are retained under
`work/durable-thread-detach/inflight-terminal/`:

- Against d07's trigger, native start -> DELETE -> actual native completion reproduced `23502`;
  diagnostic `P1_INFLIGHT_DELETE_ALLOWED` verifies artifact/terminal rollback. Cluster stop 0.
- A terminal-only intermediate gate fixed that interval but reproduced the second compatibility
  defect: successful Document DELETE cascaded its turn, and actual completion replay raised
  `DURABLE_DOCUMENT_SUCCESS_READBACK_MISSING` (`55000`). Cluster stop 0.

The final migration retains the incumbent deletion hold for **every unfinished state** (claimed
before/after dispatch, blocked, expired and outcome_unknown), and also for succeeded
`document_authoring`: its unchanged native replay contract still requires the original completion
turn. Other well-formed succeeded/failed/cancelled work may detach only with unchanged terminal
status/evidence/settlement; success requires the native verified-readback value. All identity,
payload, parent-visibility, binding and ACL protections remain. This narrows the proposed exception
to the incumbent deletion refusal; it introduces no new retention ban or caller authority.

Final corrected local proof: **107 SQL assertions PASS**, plus the existing envelope rollback suite,
catalog/ACL/reapply/existing-row checks, and a separate **two actual PostgreSQL connection** control.
Native and cluster-stop exits 0. The two-connection control observes actual completion still
uncommitted, attempts parent deletion, then proves the rejected deletion and native replay retain
one exact artifact, completion turn, terminal result, transactional receipt-port row and audit.

The expanded fixture executes the actual unchanged Document start, completion, replay and failed
settlement SQL. It applies the existing role-retirement helper to the installed fixture functions.
Minimal Auth/domain infrastructure and local transactional role/receipt ports are explicit doubles
reused from the owning Document proof: this is not model execution, paid output, full production
Rail validation, JWT integration or authenticated customer acceptance. Failed Document settlement
replay remains valid after permitted deletion; cancelled Document completion stays refused and its
terminal replay unchanged. Eligible ordinary transcript rows retain the existing DELETE CASCADE;
successful Document completion turns are preserved through the existing parent hold.

Document and Research envelope negatives cover each unfinished state plus unverified success.
The current native Research producer does not populate its optional work_id; prepared Research
envelopes remain blocked with execution unavailable. Those controls do not claim a newly activated
Research continuation. Two harness errors are preserved separately: an intentionally forbidden
service-role raw read was corrected to use the creator-returned key, and the unchanged-row sentinel
was narrowed to exclude a new concurrency fixture. No production grant was relaxed.

All six focused static checks pass. Historical migrations, Document writer/worker/ABI, generic
transition, fixture adapter, caller grants and the unconditional hosted CI invocation remain
byte-identical to d07. Earlier lint limitations remain explicit; fresh exact-head hosted CI,
non-author review and release are owed. No source binding, provider, actor/tenant deletion policy,
reminder adoption or production operation changed. Strict totals remain 1/18 and 2/50.

## 2026-10-18 CI repair: wait for complete child output

Hosted CI39101947941/job117599899520 remains FAILED. Its earlier durable-thread-detach
107-assertion step passed; the later incumbent owner-task human-control proof failed while
parsing empty stdout from its sole successful concurrent process. This is an output-capture
failure, not new evidence of a native database defect. Node's [child-process contract](https://nodejs.org/api/child_process.html#event-close)
allows stdio to remain open after `exit`; `close` follows closure of those streams.

The repair changes only that eight-way capture callback to settle on `close`, and clears its
existing timeout when spawn reports an error. Eight actual concurrent psql processes, exactly
one successful changed result, every loser stale-or-NOWAIT refusal, exactly one audit and
unchanged idempotent replay assertions remain intact. No native assertion is removed or skipped.

Failing-first private proof extracts the exact callback and uses a real Node child with actual
stdout/stderr pipes, deliberately paused until actual process exit. The old callback returns
empty stdout and raises the same JSON SyntaxError; the repair observes exit, both pipe data
events, then close and parses the complete result. A separate actual ENOENT spawn control
preserves the error and proves the real timeout is cleared. Private
`work/durable-thread-detach/ci-output-close/` retains both results and the extracted source.

On the normal composition with current main `b54d7c8dcada98f71ad7a34190a4f29a32ecc412`, the
actual `--owner-task-human-control` proof passes **119 native controls**, including **51 human-control
cases** and the eight-process race. Its actual engine/C5 suite passes **45/45 tests, zero skips**
(the incumbent minimum remains 43). Native and owned-cluster-stop exits are 0. Syntax, scoped
ESLint and diff hygiene pass. The four frozen native/workflow/test/runner blobs remain byte-identical
to cabebaa97436cea5c8f48fa2bf161d242b7e4e0a; this append preserves all earlier evidence bytes.

The first private helper had a path-only ENOENT setup error. An inherited-grandchild pipe fixture
did not deliver output on Windows and is INVALID, not accepted regression proof. The initial
sandbox native attempt hit loopback denial 10013 before assertions and stopped its owned cluster;
the approved disposable rerun above supplies the native proof. The sandbox DNS fetch failure
is retained; exact current main was already available locally for normal composition.

This is selected native SQL plus disclosed local fixture ports on Windows, not full Supabase
schema/JWT integration, provider execution, authenticated customer proof or capability acceptance.
The existing hosted107 proof and source review5561645457 remain prior evidence. Root non-author
review of this exact repair, fresh exact-head hosted CI and eventual production release/readback
remain owed. No push, PR merge, production operation, grant, native writer, provider, workflow or
pin change is performed by this repair. Strict restoration totals remain 1/18 and 2/50.

### Current-main composition and unapplied migration ordering — 2026-10-18

E09 #2343 merged as `dbb8a8842666763d202ab94aa38734343db6d55e` while #2344 was
being verified. Its legitimate Portal, shared Chat, Spine and policy changes are preserved by
normal composition. Production migration history now records `20271110030000`; neither
`20271110022000` nor `20271110023000` was applied. The prepared old deployment was not dispatched.

Advance only this unapplied migration filename to `20271110031000_durable_work_thread_detach.sql`.
Its SQL bytes remain exactly SHA256
`ca4245ae2e40849ffecff7a259f866f4a3590a79d55dcc3e3f8e74b6a3a6d73c`;
the owning proof changes only its one migration-path reference. No applied migration or history
is edited. The separate reminder candidate remains unreleased and outside this PR.

Earlier #2341 failed CI and #2344's original `21dab019` checks remain historical evidence,
not release authority for this composed candidate. Renew only specifically reviewed source
fingerprint cells, run the owning controls against the composition, and require fresh exact-head
CI before native-first production application, guarded merge, deployment and customer QA.
