# EXP13 file-text preparation — unmounted source contribution

Original assignment: ANT21, owning checkpoint `12fea7ea-7c76-4cc7-ac53-27f3dc8b051f`;
pre-edit routing `183a10bb-338e-4d7b-8d30-d0edc6580a47`. Full original scope,
aliases and explicit algorithm requirements remain in that matrix. This record
is evidence for one contribution, not a replacement roadmap or result ledger.

## Intended outcome and boundary

Prepare permitted PDF/DOCX/text sources for the original Knowledge extraction
worker and handle a finite bulk selection without losing independent file results.
The new helper takes bytes already obtained by an authorized original caller.
It provides separate source-byte and extracted-text hashes, exact text-location
segments, explicit format/coverage/limits and sanitized refusal codes.

**UNMOUNTED / NOT RELEASED.** No existing uploader, worker, RPC, table, Root,
Chat, Teach CURA, Setup writer, Memory, approval, provider or UI is changed.
Parser ports are interfaces, not deployed adapters. No upload, indexing, review
save, plan, actual task, persistence, receipt or customer availability is claimed.
Current SOLO surfaces and registered capability states remain unchanged.

## Reuse and full integration obligations

- Reuses original `knowledge-extraction.sourceHash` and existing Knowledge intent,
  source-binding, native work, review/publication/readback homes as its future consumers.
- Existing pinned PDFJS5.5.207 and installed lockfile Mammoth1.13.0 were exercised
  against this core with generated synthetic PDF/DOCX/text in isolated Node.
  No source file, credential, provider, account, database or real upload was used.
- PDF text-layer and DOCX main-text readings are always PARTIAL. No OCR,
  image/layout completeness or comprehensive document fidelity is claimed.
- DOCX preflight checks declared archive structure/expansion, duplicate/traversal/
  encrypted/macro entries and central/local metadata. It does **not** establish
  actual bounded decompression, malware scanning or process isolation. The real
  adapter must bound actual inflated output and release resources.
- Abort retires the result without waiting for a stalled parser. Actual adapters
  must independently stop and release their workers/documents; no hard CPU-kill
  guarantee is made by a Promise race.
- Original native completion currently requires UTF8 text hash=input/source hash
  and stamps utf8-v1/complete. Binary integration requires reviewed ORIGINAL native
  contract evolution. This helper does not loosen or bypass that check.
- Finite preparation uses explicit technical limits:2MiB/file,480000 UTF16 units,
  200 PDF pages per adapter call,20 selected files/20MiB per in-memory group.
  These are not product-wide bulk allowances. A mounted caller must expose them
  and may prepare later groups through the same per-file original contracts.
- Bulk deduplication is identical bytes+format within this selection only; it
  neither discovers stored private documents nor merges/deletes sources. Every
  actual future save still needs its original per-document intent/review/writer.

## Verification

Focused original-pattern Vitest suite:23PASS. It covers mismatched/unsupported
input, invalid UTF8/NUL, byte/text/page limits, no readable text, explicit partial
coverage/citation offsets, injected text preserved as DATA, source/text hashes,
unsafe DOCX package cases, cancellation, bulk duplicates/partial failure,
whole-selection mutation, observer failure, non-byte input and pre-copy group limits.

Independent source/component review found3P2 issues: later files were snapshotted
too late, abort waited for parser settlement, and progress-observer errors stopped
the batch. Actual added controls produced18PASS/3FAIL, then21PASS after repairs.
Additional batch Uint16 coercion control produced22PASS/1FAIL, then23PASS after
the common genuine-byte-view guard. Initial no-module test startup and earlier
cross-realm failures are retained locally; they are not product acceptance.

Distinct reviewer recheck: no remaining material findings; independently23PASS,
focused ESLintPASS and diff-checkPASS. Exact reviewed SHA256:

- Core `94e2a593a8fd8d44ab1c092f2eef64ac26e6f2f1da538b6a8b8512bbdf6906ed`
- Tests `d5d6665ea6819e0530603d5337ca2ad1568a3a21d53fe4bfa40b9f9ef40d12b6`

Actual-library synthetic proof yields PDF/DOCX partial, text complete, then bulk
prepared/prepared/prepared/duplicate/failed. A PDFJS standard-font resource warning
remains; complex-font fidelity is not established. Node's strip-only loader first
refused existing TypeScript parameter properties; transform-types executed the
original module successfully. No source was rewritten to satisfy the probe.

Independent original baseline before changes:15 credit proposal checks and277
Knowledge lifecycle tests/10files PASS. These do not cover the known general
document random-ID→credit-only apply mismatch, which remains separately FAIL.

Local full app type compilation and exact-head hosted checks are recorded in the
PR when actually completed. No green type/build/CI is inferred from this record.
Real Edge compatibility, adapter resource safety, native source integrity,
tenant/client/role/delegation, mounted bulk/review, later-session persistence,
plan→actual task/receipt and full owner readiness remain PROOF OWED.

## Algorithm and release truth

Bounded deterministic source reconciliation is applicable to ALG01; no canonical
algorithm maturity promotion. Actual logic/inputs/outputs and tests are in the
two source files; no retrieval score or model confidence is used. Missing overall
algorithm support remains NO VERIFIED SUPPORTING ALGORITHM IDENTIFIED — GAP OR
VERIFICATION OWED in the original outcome matrix.

Channel development; classification internal-only/unmounted contribution;
customer release identity NONE; customer release note NOT_APPLICABLE.
Migrations/Edge deployment NOT_APPLICABLE to this contribution. No provider,
authority, recurring runner or other Experience is activated. Original Master
Shipped Log N/A until actual main merge. Normal exact-head review/CI and owner
release boundaries remain; removal of this unused helper is a source-only rollback.
# October30 continuation: actual deployed-runtime parser adapters

The original contribution now composes main571f8aa84 normally, preserving E08
3109 and E05 3102, and adds `knowledge-binary-adapters.ts` to the same increment.
It is still UNMOUNTED: no existing source submission, worker, native completion,
publication, UI or catalogue availability is changed by this adapter alone.

- Existing installed PDFJS5.5.207 failed on native Deno2.1.4 because DOMMatrix/
  native canvas was unavailable. Node roundtrip was not Edge compatibility.
  Demonstrated absence of a compatible existing adapter justifies pinned
  `npm:unpdf@2.1.0`, a pure-JS serverless PDFJS6.4.299 build, not a new service or
  runtime. Upstream: https://github.com/unjs/unpdf. Official package SHA512:
  `G/Hsrm++g0EoubUhV8TDFItq6oQ+FUu9EMvIRtHUwseKXB0iJoCvaLvBGOpYUBqyvggv/XfxhYYtohL2QpE3xQ==`.
- PDF parser uses the pinned resolved module directly, with no auto-discovered
  font/CMap/storage paths, system fonts, WASM, XFA, image decoding or native
  canvas. A standard-font-data warning remains: simple text roundtrip passes,
  complex-font/CJK fidelity is not established. Coverage remains partial/no OCR.
  PDFJS6 removed the prior isEvalSupported option; no fake option/type bypass is
  used. No PDF JavaScript/action APIs are invoked.
- Actual short-text control found an unhandled close/enqueue race from cancelling
  a live serverless PDFJS text stream. Repair drains the current page without
  retaining more than the text allowance plus one truncation-signal character,
  then stops before further pages. It does not claim to limit all PDF internal
  memory/CPU or preempt synchronous work. Original Edge isolation still applies.
- Mammoth1.13.0 public Node and browser wrappers both failed under Deno2.1.4:
  `ExternalPromise.resolve is not a function`; their compatibility wrapper uses
  disabled __proto__ mutation. No unsafe-prototype flag or dependency patch is
  used. The adapter reuses the exact pinned original internal raw-text pipeline
  from lib/index.js: zipfile.openArrayBuffer → docx-reader.read → Result.map of
  raw-text.convertElementToRawText, with native Promises. Internal API dependence
  is deliberate, version-pinned and tested; upgrades require full reevaluation.
- Metadata preflight now returns its already-checked compressed entry ranges.
  Actual expansion is measured with native cancellable DEFLATE before Mammoth;
  aggregate16MiB and exact declared entry length must match. A forged matching
  local/central length cannot bypass the measured cap. Initial JSZip Node stream
  pause left delayed resume/timer work under actual active cancellation; retained
  failing controls led to native-stream repair. No filesystem/macro/code execution.
- Native Deno2.1.4 actual tests: 9 PASS with leak tracing and NO runtime permission
  flags. PDF/DOCX text/page/hash/partial evidence; encrypted PDF refusal; pre-abort;
  actual returned text limit; active DOCX expansion cancellation; active PDF
  cancellation while a real text reader exists; mixed PDF/DOCX/
  text bulk plus duplicate/unsupported isolation; forged ZIP expansion rejection.
  Independent review found the live-PDF destroy deadlock: valid synthetic PDF
  stayed pending beyond28seconds/25second watchdog. The added control failed
  first at3seconds; the repair drains/discards the current local phase/page and
  destroys afterward, then rejects cancellation (independent final control5ms).
  The25second deadline is cooperative, not synchronous-work preemption. General
  hard internal resource limits, scanned/complex documents,
  malware scanning and deployed/customer behavior remain unverified.
- The parser dependency graph is integrity-locked in
  `knowledge-binary-adapters.deno.lock`; CI uses `--frozen`. Independent review
  encountered real no-lock transitive resolution drift/DNS failure before a
  runtime case could run; that is not a parser result. The frozen graph pins
  Mammoth's JSZip3.10.1 and every transitive integrity. Wiring these adapters into
  original Edge handlers must also carry this graph through supported deployment
  packaging; a CI lock alone does not prove deployed dependency identity.
- Existing CI verify gains only this same native Deno test command after its
  existing pinned2.1.4 setup. No prior check, assertion, permission or source
  emitter is changed. Fresh exact-head review/hosted CI is required; old green
  source heads are historical.

Next original native integration must keep source-byte and extracted-text hashes
distinct. The existing six-argument complete_knowledge_extraction remains an
unchanged caller ABI for UTF8; a compatible overload must reuse the SAME native
authority/lease/attempt/revision/receipt/transaction implementation, separately
validate raw source hash against original work/source binding and text hash
against extracted content, and persist coverage/citation manifest in the SAME
Knowledge row through original review/publication. It must never substitute the
text hash for source-byte identity, loosen RLS, fabricate a credit-report row,
or call original Planning directly around absent admission. Precise native schema,
consumer ABI and forward-version sequence remain integration work, not an applied
migration or current upload support. E01 selected-fact confirmation and E02/E05
original saved-plan/actual-Work handoffs remain independently owed.
