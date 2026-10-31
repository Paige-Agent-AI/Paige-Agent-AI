# EXP13 reviewed Memory recovery — original producer repair

Status: LOCAL failing requirement controls, NOT IMPLEMENTED/RELEASED. Same sole
EXP13 lead owns the Memory producer repair under the October30 owner clarification;
E01 Setup/domain facts, E02 saved Mission, E05 Work and private client/shared
business audiences retain their original ownership. No new Memory store or ledger.

Current production READONLY original bodies were inspected before changes:
record_paige_memory8arg2ca751faa9d87bc6c4a586fd607847d0,
get_paige_memory4arg6f0ecfc77ce855160db184e6770000f4,
forget_paige_memory3argf145788514336a0ae4e48aa950c82b55. The local test installs
ORIGINAL source extracted from20270599000000/20261223000000 migrations and asserts
all three exact body hashes before exercising them. No original writer is edited
by these tests. Scope/Auth/unembedded-table fixture ports are modeled; this is not
ordinary-account or production behavior acceptance.

The existing ORIGINAL Knowledge publication runner gains an optional diagnostic
--memory-review-baseline mode, requiring the verified disposable data directory.
Default publication behavior remains. Original source is passed as explicitUTF8
stdin to psql, preserving its text. The first run10518 failed before assertions
with Windows ANSI/UTF8 argument encoding0x97: INVALID causal proof, retained in
work/exp13-reviewed-memory-baseline-red.log. Corrected run82507 verifies original
source and reaches actual two failed requirement assertions. Final76323 adds
owner-requested selected-correction control: THREE causal assertion failures,
exit1, original earlier publication controls retained. Each case is a separate
BEGIN transaction; the failed connection rolls back all synthetic Memory writes.
Original runner DROPPED its disposable database afterward.

Observed baseline requirements not supported by the legacy API:

- A review captured in workspaceA followed by active workspaceB persists the old
  eight-argument call inB; p_tenant_id is intentionally ignored for JWT callers.
- Repeating the same synthetic save intent in metadata returns TWO original IDs.
- Broad legacy supersession retires an unrelated active same-type preference.

These are missing NEW reviewed-save guarantees, not claims that the old API
promised expected-workspace/idempotency or that a customer incident occurred.
Metadata is DATA, never actor/tenant/source/approval authority. No customer
agreements, credentials, provider calls, role grants or production writes occur.
Final log: work/exp13-reviewed-memory-baseline-three-red.log.

Next implementation must preserve original8/4/3 interfaces, scope/owner/ACL/path,
per-user audience, defaultsproposed and explicit confirmation discipline. Add
reviewed expectedworkspace/actor/current-source/version admission, durable intent
reconciliation without replay, authoritative readback and selected-target CAS
correction without unrelated retirement. Existing source readers/permissions and
same Memory rows are reused; no second writer/runtime/approval queue/ledger.
Read/forget/reopen/current authority/source invalidation and concurrency still owe
native proof. Business identity belongs to original Setup, whole agreements to
Knowledge, personal approved continuity to original Memory. Audience metadata does
not authorize shared-business access (INT337). No automatic learning or implicit
agreement/work authorization.

Independent initial source/oracle/isolation review found no material finding;
reviewer did not run native tests. Final UTF8/third-control re-review remains owed.
This local branch is not a migration/version reservation or a publish/apply gate.
Original binary source release3154/400a runs separately. Full EXP13/BULK and the
agreement-to-saved-plan-and-ACTUAL-task workflow remain STILL CODING/NOT READY.
