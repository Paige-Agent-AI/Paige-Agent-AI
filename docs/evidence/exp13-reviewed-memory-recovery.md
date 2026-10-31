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

## Local original-producer implementation and review repairs

The unversioned reviewed-memory-candidate.sql now extends the SAME native
record_paige_memory with a required nine-argument reviewed interface. It validates
explicit confirmed input, current actor/workspace and permitted canonical source
version/hash/literal quote, locks existing scope/source/identity records, binds a
save intent to exact request metadata, and calls the ORIGINAL eight-argument
producer for insertion/confirmation/attribution. Exact original Memory row
readback precedes return. One selected correction uses original-row updated_at
CAS and leaves unrelated same-type rows active. Legacy unsafe broad supersession
now refuses with PAIGE_MEMORY_SELECTED_REVIEW_REQUIRED; old eight-argument
non-superseding calls/defaults/owner/ACL/search-path remain unchanged. Original
get/forget are untouched and still require their reviewed-scope/recovery extension.

First candidate83695 incorrectly required record_state from the original closed
Knowledge JSON projection and refused a valid source. Actual source inspection
confirmed the original reader omits that field and filters canonical rows itself.
Repair retains original permission reads plus a canonical native source-row lock
and absence refusal, without inventing a projection field. Core23933 and exact
original-ACL/source-guard rerun33611 PASS. These are not customer acceptance.

Independent review found uppercase intent spelling could miss a canonical lookup,
and a legacy row with forged intent/fingerprint metadata could masquerade as the
requested replay. Native intent/actor/workspace spelling is normalized; replay
now verifies exact content/type/thread/created_by/whole protected metadata and
confirmed personal audience/source binding. Initial adversarial96181/99530 failed
fixture setup because actor claims were in another psql connection: INVALID
causal proof, retained. Correct same-transaction claims then controlled mutation
30155 (removing ONLY these two repairs) produces BOTH actual assertion failures.
Actual repaired10098 passes both plus the core controls.

A further review P2 found caller confirmed_at metadata could poison identical
replay. Actual52590 fails the new reserved-key refusal control. New admission
rejects server-owned provenance/confirmation/audience keys before any effect;
96758 completes exit0: ten core Memory observations plus uppercase/preseed and
three reserved-key observations (15 named observations, not business outcomes),
with original publication/source checks retained. Native log is
work/exp13-reviewed-memory-core-final.log. Original runner DROPPED its disposable
DB. Independent bounded final recheck reports all three P2 findings resolved,
no remaining material finding in that repair; reviewer did not run native tests.

STILL OWED: read/forget expected-scope and exact-item recovery, current-source
invalidation, full actor/membership/revocation negatives, concurrency/unknown-save
reconciliation, safe lifecycle and strict repeat/source guards for a published
carrier, exact CI/managed Preview/ordered release/deploy/readback, actual UI and
later-session/customer proof. This is NOT ready to mount or advertise. No Memory
migration number/publication/application or source/algorithm maturity promotion.

## Native lifecycle, access and real intent-lock concurrency

New LOCAL original get_paige_memory5arg and forget_paige_memory4arg extensions
preserve original4/3arg bodies. Exact actor/expected workspace/current identity
and existing membership helpers gate ID/intent lookup and selected forget.
Intent inspection takes the SAME save advisory lock before declaring absence;
absence is an observed committed state, not permission to allocate a fresh intent
for a potentially delayed request. Original Memory rows remain the only home.
Current-source checks mark changed/unavailable and exclude them from context
eligibility; unavailable quotes are not re-exposed. Retired records expose status
and identity, withholding content and user metadata. Selected forget calls the
ORIGINAL3arg writer, then verifies actual retirement; no physical cleanup claim.

Feature-absence8110 reached missingget5/42883, not a production defect. Initial
lifecycle96485 passed10 additional native observations. Independent review caught
an inactive row being falsely labeled replay of forget. A deliberately superseded
fact then FIRST-everforget reaches actual assertionFAIL41925. Earlier mistyped
expected-data-path refusal and11412 original scale-control statement-timeout
occurred BEFORE that regression and are retained, not causal failure/PASS. The
unchanged retry preserves every original assertion/deadline and reaches the real
failure. Repair returns effectalready_retired/replayedfalse for observed prior
retirement, and effectretired_now only after actual original forget/readback.
34110 passes lifecycle, retired-content suppression and11 access observations:
foreign user/other workspace/current workspace departure/spoofed expected actor/
deleted or banned actor/revoked membership all refuse; restoration returns valid
own-scope Memory and unrelated rows remain unchanged. Auth/membership are still
explicitly modeled fixture ports, not live customer-role proof.

Final52708 original publication runner completes exit0 with a REAL native race:
first save transaction remains open; second nine-argument save AND third exact
intent inspection are each observed in pg_locks waiting on the same granted save
intent. First commits; both saves return SAME UUID, native readback counts ONE
Memory row, inspector sees that committed ID. No timing-only or model outcome is
used. Only its own subprocess handles are cleaned up. Original runner DROPS the
disposable database afterward. Logwork/exp13-reviewed-memory-lifecycle-race.log.
Independent final source/race/cleanup recheck resolves the attributionP2 and finds
no further material finding in this bounded increment; reviewer did not run tests.

Oldget4 runtime/context source invalidation, further races (revocation/competing
correction/forget), source eligible deletion/retention behavior, strict repeat and
new-overload source/metadata guards, versioned carrier/exactCI/managedPreview/
orderedrelease/readback, actual UI/late-session/ABA/customer proof remain OWNED
and OWED. This is LOCALPARTIAL, not ready for customer mounting. No Memory native
migration number/publication/application, other Experience activation, provider
or protected customer material is involved. Binary-source3154 exact400a now all13
hosted checksSUCCESS and READYfornormalfinalreview; lowerE08 order still holds
merge/application, and full original EXP13/BULK/agreement-to-actualWork is NOTREADY.
