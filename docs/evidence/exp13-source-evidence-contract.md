# EXP13 original Knowledge source evidence producer

Status: **PARTIAL / UNMOUNTED SOURCE CONTRACT**, not customer availability.

This increment supplies the source-reference shape requested by original EXP02
in ANT21/c4e554b8. It adds no plan, fact, Memory, task, permission or result store.
It does not complete the agreement-to-work milestone or bulk ingestion.

## Original authority and exact meaning

`_shared/knowledge-source-evidence.ts::readKnowledgeSourceEvidence` calls only
the existing caller-JWT `read_tenant_knowledge` with expected tenant and exact
document ID. The original native function checks current active tenant and
membership, and returns only canonical records. Source contract inspected:
`20270531400000_knowledge_review_foundation.sql` lines 83–119. This is not a
service-role existence lookup or a new permission resolver. Consumers must pass
the original authenticated client; source-reference IDs never grant access.

The version-1 reference is `{contractVersion:1,tenantId,documentId,revision,
contentSha256}`. SHA-256 identifies the exact UTF-8 canonical text returned by
that read. It is **not the original PDF/DOCX/object hash**. Excerpts are bounded
UTF-16 offsets into that text, with exact selected text. They are not page or
section citations. At most 20 excerpts / 12,000 selected code units per call;
canonical text is bounded to the existing extraction limit of 480,000.

The published document projection currently does not expose original source
binding/coverage or an immutable extraction page manifest. Therefore this DTO
explicitly returns `originalFileEvidence:'unavailable'`. It must not be used to
claim original-file verification. An original native projection/manifest
extension remains owed, alongside binary extraction/publication integration.

Canonical Knowledge does not establish approved business identity, preferences,
decisions or contractual acceptance. Every result says
`factConfirmation:'not_asserted'`. E01 retains the source-bound explicit fact
review/Setup writer and confirmation receipt; Memory uses its own contract.
No fabricated confirmation attribution may be attached to this source DTO.

## Currentness, privacy and recovery

The consumer supplies an incarnation fence which remains false after departure,
cancellation or scope change, including A→B→A. The reader snapshots requested
IDs, ranges and expected reference before awaiting; checks the fence before
read, after read and after hashing; rejects wrong tenant/document, duplicate or
missing records, invalid revision/content, permission errors and lost reads.
Read failure is unavailable, not evidence of deletion. There is no retry or
effect. Error details and raw storage URLs/paths are not forwarded.

Reopen by calling the same reader with `expected` set to the original reference.
Changed revision **or text hash** returns `source_changed`. Permission is read
again, never restored from cached evidence. A source can change immediately
after the read: this helper is not an atomic grant to a future writer. Original
plan/Work admission must revalidate source version, actor/current authority and
approved intent at the effect; unknown task effects must not be replayed.

All title/excerpt text remains untrusted data. No document instructions are
executed. No model/provider/tools, storage reads, mutations or automatic Memory
promotion are called by this helper.

## Consumer ownership and remaining composition

- EXP02 owns original `business_missions` / immutable mission briefs and saved
  game-plan projection. Its current brief has no typed document reference; E02
  must compose the agreed reference with its original consumer/native schema.
- EXP01 owns source-bound selected-fact review, Setup/CAS writers and explicit
  confirmation attribution; the requested repair ABI remains pending.
- EXP05 owns original Planning admission, claims, writer, Rail receipts and
  recovery. Current scoped task writer is not client-idempotent and existing
  shared resume DoorFamily does not admit Planning; never call it directly to
  bypass the missing governed handoff.
- EXP03 owns appropriate CRM linkage; EXP04 retains commercial semantics.
- EXP13 retains full source lifecycle, bulk per-file durable recovery, binary
  extraction, research and artifact scope. Neither this reference reader nor
  the separate bounded file preparation contribution replaces those outcomes.

## Algorithm and verification limits

Deterministic logic: original authorized canonical read → validate identity and
revision → SHA-256 of text → compare expected version/hash → bounded exact text
projection or abstain. Input is the permitted original document plus selected
offsets and current request fence. Output is read-only evidence or explicit
unavailability. Original `sourceHash` is reused; no new retrieval/ranking/model,
training or automatic-learning claim. **NO VERIFIED SUPPORTING ALGORITHM
IDENTIFIED — GAP OR VERIFICATION OWED** for an applicable canonical ALG ID and
full business-outcome maturity; this is a narrow source-integrity contract.

Local synthetic controls cover exact offsets, version/hash change, wrong source,
tenant, missing/duplicate readback, invalid revision/content, revoked/error read,
A→B→A fence retirement, in-flight request edits, excerpt bounds, private-field
minimization and failure without retry. Deno 2.1.4 checks the actual helper.
These are source tests, not deployment, real-role/RLS, delegated-management,
authenticated save/reopen, plan/task receipt or customer acceptance proof.
No private customer agreements, credentials or provider calls are used.

Local result: 19 source-evidence controls plus 23 original extraction controls,
42 PASS. Independent review found a split-surrogate excerpt defect; the added
control failed first (18 PASS / 1 FAIL), then both split endpoints were refused
without silently changing selection; the whole Unicode character remains valid.
Focused ESLint, diff whitespace and Deno 2.1.4 check PASS. Hosted exact-head CI,
merge, deployment, authenticated roles and integrated customer proof remain owed.

## Binary source native release prerequisite — October31 UTC

Separate local release child d89ad415eed4a197efdf6b4de19add1f66b3807e is based on
fresh main e0c2d936e1cb1615099161f2b53f219a847e8639. It carries only the original
three-file native candidate from f24be1a14; the cumulative upload/UI/client branch
is retained separately. This entry accompanies that candidate, not the unmounted
source-reference helper's original merge. No new Knowledge store or executor.

Fresh original publication-check.py --publication-recovery --binary-source ran
against a verified disposable PostgreSQL16 cluster on loopback port55483: exit0,
214 PASS-labelled observations across original and binary-source controls (not
214 distinct outcomes). Original migrations and candidate replay, source/ACL drift
refusals, exact raw/text identities, UTF16 quotation bounds, permission/current
scope refusals, publication readback, canonical source reopen, correction/discard
and receipt-once replay controls are retained. Auth/vector/receipt fixture ports
are explicitly modeled; this does NOT prove Supabase/full schema/customer roles.
Log: work/exp13-native-release-d89-proof.log in the owning workspace. The test
runner dropped its disposable database and its exact cluster was stopped.

Initial restricted initdb setup stalled in its child PostgreSQL configuration
probe before assertions; handle32401 was deliberately stopped, exit1 retained.
Authorized isolated setup23264 completed exit0, then verification49891 completed
exit0. No live handle was duplicated and no peer process/database was stopped.

Fresh NON-AUTHOR SOURCE review at exact d89 reports no material findings; all
three candidate files match prior reviewed f24. Python compilation/diffcheck0.
Production READONLY frontier is20271126080007; candidate130013count0, source and
extraction evidence columns absent. Seven original native body/owner/security/
search-path projections were read without customer contents. No production apply.

Original E08 PR3130 remains OPEN421e, its published80008/90008/100008/110008
migration order protected. E03's never-published120003 slot remains withdrawn;
future peer reservations must still be re-read before release. Managed Preview,
normal ordered native release/exact-head CI and authoritative readback remain
required. No admitted binary worker/UI or reviewed fact/Memory/GamePlan/actual
Work availability is established by this prerequisite. Full EXP13 remains active.

## Local native quotation groundwork (not source admission)

The original private knowledge_utf16_length(text) already exists in Knowledge
review/extraction migrations. Current migration search found no native exact
UTF16-offset/literal-quote matcher. The LOCAL unversioned
scripts/knowledge-service/native-source-quotation.sql reuses that length helper
to find exact PostgreSQL code-point boundaries for existing JS UTF16 selections.
Split surrogate endpoints, moved repeated quotations, normalization/case changes,
invalid ranges and oversized inputs refuse. It is I/O-free and private: PUBLIC,
anon, authenticated and service_role have no execution grant. No document access,
source approval, domain confirmation or Work authority follows from a text match.

Original publication-check.py gains optional source-quotation proof/baseline flags
requiring the verified disposable database directory. Baseline37722 reaches a
missing-function42883: demonstrated feature absence, not a production defect.
Native63223 passes initial25 quotation observations and private ACL. Final37992
times out in ORIGINAL publication-recovery-behavior.sql:263 scale control BEFORE
the new quotation controls; that failure remains recorded. Unchanged retry4551
passes28 quotation observations plus private ACL and all original publication
controls, exits0 and DROPS its disposable database. No existing assertion or
timeout changed. Logs: work/exp13-source-quotation-baseline.log,
work/exp13-source-quotation-native.log,
work/exp13-source-quotation-native-final.log and
work/exp13-source-quotation-native-final-retry.log.

Production carrier/replay, atomic permitted source/version/textSHA locking,
selected original domain-approval receipt, saved Mission binding and original
Planning proposal/claim/resume integration remain OWNED integration work. This
private predicate is not mounted, versioned, published or applied. No canonical
ALG maturity, customer upload/plan/task readiness or authenticated acceptance is
claimed. The original source helper's factConfirmation:not_asserted remains.

Independent source review identified a P2 caller-collation gap in the new local
predicate. Actual native6242 creates real ICU und-u-ks-level1 nondeterministic
collation, verifies it ignores case/accent, then the exact-positive call FAILS in
the original UTF16 helper's regex. This is a new-candidate finding, not a deployed
customer incident. Repair changes only the new predicate: pin all three existing
length-helper inputs to pg_catalog.C and compare final UTF8 bytea values rather
than collation-sensitive text. Native74943 exits0 with original28 quote controls,
private ACL, real ICU sanity, exact-positive, case-negative and accent-negative,
plus all original publication controls; disposable DB DROPPED. Baseline and final
logs are work/exp13-source-quotation-collation-baseline.log and
work/exp13-source-quotation-collation-final.log. No original helper is modified.
Distinct final source recheck marks the P2 resolved and finds no remaining
material issue in this bounded predicate; reviewer did not run native tests.

## Local native permitted source binding

LOCAL unversioned lock_knowledge_source_evidence(actor,tenant,reference,excerpts)
is a PRIVATE SECURITY INVOKER integration candidate for the SAME original domain
writer's transaction. Actor must equal actual auth.uid(); it reuses ORIGINAL
lock_knowledge_extraction_authority and read_tenant_knowledge, locks the canonical
document FOR SHARE, checks source revision/textSHA and bounded exact quotations,
then returns only existing minimized evidence fields. No source URL/storage path,
full document, private Vault data, approval token or fact confirmation is emitted.
PUBLIC/anon/authenticated/service_role execution remains revoked. A returned JSON
object cannot be reused as authority; the owning writer must call this again in
its actual mutation transaction and enforce its OWN domain approval/readback.

Baseline70369 reaches missing-function42883 (feature absence, not production
defect). Native87465 passes the core source/version/hash/quote and current-scope
controls. Expanded29273 also passes malformed JSON/extra fields/MD5-as-SHA/quote
limits; banned/deleted actor, inactive tenant, revoked membership; Admin and
member source-READ positives; minimized readback; changed source; and unavailable
source after ORIGINAL delete_tenant_knowledge. Actor/Auth/role fixtures remain
explicit modeled ports, not authenticated customer or delegated-write proof.
Canonical-row deletion here proves retrieval invalidation only; original object
cleanup, retention and eligible deletion policy remain separate full-scope work.

Native61200 adds two REAL transaction races. A completed source-evidence call is
observed idle-in-transaction; a source editor or membership revoker is separately
observed in pg_locks NOT granted. Releasing the first transaction lets that update
complete; the next original binding read refuses the stale source/revoked scope.
Both native waits PASS and all original publication and quotation/ICU controls
remain. Runner exits0 and DROPS its disposable database. Logs are
work/exp13-source-binding-baseline.log, work/exp13-source-binding-native.log,
work/exp13-source-binding-adversarial.log and
work/exp13-source-binding-native-races.log. Cleanup targets only its own handles.
Distinct source reviews find no material issue in the helper or expanded
controls/race harness; reviewer did not independently run native tests.

Safe carrier/replay/source/ACL guards, managed native Preview, ordered release,
deployed caller/customer proof, exact selected domain-fact approval receipt and
E02 immutable Mission binding remain owed. E05 confirms original domain writers
exist but source-admitted proposal/claim/resume/settlement is STILL MISSING; no
producer-built decision, raw-RPC shortcut or blind non-idempotent create retry.
This integration candidate is not mounted/published/applied or a usable saved
game plan/task outcome. The full original assignment remains ACTIVE/NOT READY.

## Current guarded installation candidate — same source-to-Mission prerequisite

Normally composed original7bae with actual main8ead at localef2888251. Resolve
only original publication runner/evidence conflicts by preserving ALL incoming
binary/recovery controls and prior evidence, then adding the existing source
proof blocks. Complete incoming runner insertion inverse and evidence prefix
are exact. A broad staged whitespace check flagged six incoming peer EOF blanks;
those peer files were preserved, not rewritten. Own six-path diffcheck passes.

Fresh production CODE catalogue proves both new private helper names absent.
Original read4 body9ee43, UTF16-length ac0ec, actor a058 and authority788d match
their original metadata/ACLs. Authority788d uses original user/tenant/member/
role/profile locks with membership before profile; earlier62bf hash shorthand is
not evidence of a production source change. No customer document row was read.

Build-source-evidence-carrier.py composes the SAME two candidate bodies into
native-source-evidence-install.sql: one transaction, exact dependency/body/
owner/language/security/defaults/path/parallel/ACL guards before installation,
existing-body drift refusal and post-install verification. Both helpers remain
PRIVATE SECURITY INVOKER with no PUBLIC/anon/authenticated/service-role execute
grant. Installation is repeatable without changing incoming Knowledge functions,
stores, authority, schemas, approval or receipts. The SQL remains unversioned,
unpublished and unapplied; no future migration slot or idle hold is reserved.

Fresh original publication-check.py against the verified OWN disposable PG16
cluster at55479 ran recovery + binary source + quotation/ICU + permitted binding
and both REAL source/member lock races, plus16 installation-fault refusals.
Changed body/volatility/definer/strictness/parallel/path/owner/defaults, public/
service/unexpected-role grants and original dependency permission drift all
refuse; all six exact definitions/ACLs/owners read back unchanged after EACH
rolled-back fault. Whole guarded installation also replays twice. Native83689
exit0; disposable database DROPPED and exact own server STOPPED. Raw logSHA256
35d5d3456f03ef7b61db8cef60414fa99ca9e4550ed02e099999ff09c1d98278,
candidateSHA2569c9162f8f81f7f24a754835771201a0bf3f7a6eaf2f909d31ed8c56b70de1677.
First default client was socket-permission denied; its separately launched
short-lived server then exited before the first elevated read. Both failures
are retained. Start/verify/test/stop in ONE authorized command used the same
existing isolated cluster, with no PID-file deletion or peer process action.

Identity/member/vector/receipt fixture ports remain MODELED. This is native
synthetic evidence, not full Supabase replay, production migration, authenticated
customer role/access or an E02/E01/E05 writer result. Distinct exact-source review,
normal managed carrier/order/CI/release and authoritative production readback
remain owed. E02 must call this private source validator in ITS original writer
transaction and separately enforce the E01 selected-fact/domain-confirmation
receipt and current action/CAS. Source evidence alone is never fact/Memory or
task authority. SAME full original/BULK primary and all other scope remain open.

Normally composed actual released main3eeb/Memory18 at1db1acaf3, resolving only
the original publication-runner header/proof additions. Removing the original
source flags/checks/blocks restores the ENTIRE incoming Memory/binary/publication
runner exactly; no incoming assertion or test registration is changed. Both
private candidate bodies/generated installer remain byte-identical to dcb.
Fresh JOINT native34921 exits0 with original Memory84 drift refusals +binary
controls, duplicate-save/unknown-inspection REAL intent-lock waits/same committed
record, original source/member REAL waits, quotation/ICU/binding controls and
private-source16 drift refusals/complete rollback snapshots. Native DB DROPPED,
own server STOPPED. Joint rawSHA256
561122fac5d949252a1989e0e0b87d2bd011effbb222cbc9b8c51b0164ab0e37.
This is compatibility/synthetic proof, not domain-fact approval or a customer
Mission/Task effect. Original reviewed Memory3169 now has actual normal native
and web release receipt6553509101; PRIVATE source validators here still have
NO production carrier/application. E02 returned contract-level receiving ACK,
requesting frozen full source identity for actual inspection; no source/native
acceptance is inferred from that receiving message.
