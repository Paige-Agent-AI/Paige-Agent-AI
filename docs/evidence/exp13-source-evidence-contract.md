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
