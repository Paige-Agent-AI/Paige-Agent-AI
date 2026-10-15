# INT-280 / ANT-48 — AI-3A regression-case contract

The owner authorized AI-3 after AI-2's genuine UI source release, superseding the planning hold. Sole implementation ownership remains in INT-280. The ten pre-edit routes are recorded in ANT-48 kickoff comment `ce5f25b5-9d37-49dc-ad34-9e8d4eaaddb3`. This additive contract does not publish cases, execute tasks or establish a completed corpus.

## Existing source and storage

`paige_eval_dataset` remains the collection, `paige_eval_case` the case, `paige_eval_run` the execution record, `paige_eval_result` the result and `paige_eval_evaluator_set` the immutable definition registry. `paige_llm_trace` and AI-1 canonical trajectories remain evidence references when legitimate server-proven links exist. An evaluator's execution `work_id` must never become the case's task identity.

Version1 metadata supports independently reviewed repository write-integrity defects and synthetic offline fixtures only. Each case records stable key/version, original issue, fix PR/review, exact faulty/fixed/merge commits, source path/hashes, fixture path/hash, runner identity, frozen deterministic evaluator identity/hash and bounded non-sensitive expected facts. Every identity is immutable; a changed fixture, expectation, evaluator or provenance needs a new case version. Published definitions require separate protected storage validation against reviewed bytes. Parsing alone cannot authorize publication or establish evidence quality.

The contract rejects unknown fields recursively, including customer prompts, tenant/actor identifiers and arbitrary response payloads. Fixture/source paths are bounded repository paths. Expected facts are restricted to HTTP status, audit presence, the §194 zero dispute count, write-failure reporting and complete/partial/failed classification. No content-free scan can certify a proposed fixture's privacy: independent source/fixture review is required before publication.

Hashes are SHA-256 over bounded sorted-key UTF-8 canonical JSON for metadata/fixtures; arrays retain order, absent and nonfinite values fail. Source fingerprints refer to exact UTF-8 Git blob bytes (LF). This definition must be kept consistent in protected storage and runners; a SQL jsonb text digest must not be silently substituted for this canonical metadata hash. Released AI-2 definition bytes/hashes remain unchanged.

## Evaluation and mandatory-gate semantics

The runner must invoke existing `DETERMINISTIC_SCORERS.exact_match`, producing existing `ScoreResult`. `classifyRegressionResult` delegates to existing AI-2 `evaluatorVerdict`; it is a strict metadata adapter, not another evaluator. Complete applicable matching output produces pass or fail. Missing/skipped/error/configuration, unknown applicability, absent identity, stale/hash-mismatched/truncated/conflicting evidence remain indeterminate. Proven exclusion remains not_applicable. Only pass satisfies a required regression gate. All four verdicts and evidence denominators remain inspectable.

Historical faulty-source replay, corrected-source replay and a controlled reintroduction must each record the actual invoked source hash and the result. Historical source replay is performed now against synthetic data; it is not a claim that the original task or historical production response was captured. A failing counterfactual is labeled as such. No successful model answer, HTTP200 alone, missing receipt or fabricated assistant narration establishes business completion.

## First independently grounded candidate

[Issue734](https://github.com/Paige-Agent-AI/Paige-Agent-AI/issues/734) and [released fix1917](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/1917) independently establish a dead `disputesCreated` audit reference after credit writes. Review comment6101464003 records independent engineering review and release evidence. Actual Git source confirms:

- Faulty `6c76675dc57d1595ff9160e736a0d3723ac8010e`: audit line775; SHA-256 `2d122eb9966c944aefc4ed790000e6ff43f78adc922c2ceab70c27c583a2adb3`.
- Fixed `e648864ad9ae277ab24b5f4eb49dd14027aeafea`, released merge `9512e649ba347bf6335540d38f8bb9d9b0ef0661`: audit line928; both source SHA-256 `30bef5518c9c3ae99628f3b8d544ce79cf9e8259e4e7ac928cf4ca3bb0dba45d`.

The existing `scripts/sync-credit-report-data` loader, recording database double and captured real handler are the fixture boundary to reuse. No business function or Finance ownership changes. This contract PR does not yet claim reproduced lifecycle or a published regression case. Historical customer impact is UNKNOWN; no customer credit records or real follow-ups are accessed.

## One-PAIGE integration and proof

| Canonical seam | Reuse / claim boundary |
| --- | --- |
| Spine | No new callable Intelligence capability. Conversational regression inspection UNAVAILABLE; no tool authority added. |
| Harness / Gateway | Existing scoped invocation/test boundaries; A/B/F/G dependencies remain canonical. No new live executor; E linkage PARTIAL where unproven. |
| Orchestration | No job, producer, drainer or scheduler added. Canonical durable task references only when server proven. |
| Trust / approval | Observe-only deterministic fixtures; no second approval channel or changed autonomy ceiling. |
| Rail | Source receipts remain authoritative; this metadata cannot manufacture an operational receipt. |
| Metric / Evidence | Existing Eval datasets/cases/runs/results and recorded source measurements; no telemetry warehouse. |
| Mind | Existing business context ownership; no Mind write or invented health score. |
| Memory | Corpus in Evals is regression evidence, not a parallel memory engine. |
| Knowledge | Public repository provenance only; no customer Knowledge ingestion or training rights assumed. |
| Model Fabric | Existing traces/fingerprints when linked; no route/classifier/provider policy changes or judge calls. |
| Agent Intelligence | Versioned observation contract in existing Evals; later protected publication/reader and actual offline lifecycle proof are still owed. |
| Chat / Live | Shared future capability contract; scorecard/corpus readers do not make Chat/Live operational. UNAVAILABLE where callable seam is absent. |
| Operator surface | `operator.platform` remains PARTIAL. Existing five workspaces preserved; Studio corpus flow requires concrete owner approval before material UI integration. Forensic remains source inspection. |

Internal development source only; migration/Edge deployment NOT_APPLICABLE for this contract slice. No provider spend, model training, customer mutation or production login. Authenticated AI-1/AI-2 acceptance UNVERIFIED under OWNER_LOGIN_HOLD. AI-4–AI-9 remain unauthorized. Next slice must prove the actual historical/corrected/reintroduced handler lifecycle, then publish a protected immutable case through existing Evals with authorized audited reads.
