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
