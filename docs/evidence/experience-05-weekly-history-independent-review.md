# Weekly historical-status performance correction — independent review

Reviewed immutable head: `deec628fe8654c7d6eae64b8d8e401058b7e1711`

Source base: `7c2f9f10bc538cc5fe7ff9329facf7b68d24346d`

**Verdict: SHIP for this bounded corrective source. No material security or correctness findings.** The independent review is complete. Green complete exact-head CI and actual guarded migration deployment/readback remain required. Owner design, UI mounting, named Chat/Live admission, activation and authenticated weekly acceptance remain separate holds.

Reviewer: `backend_review`, separately spawned and not an author of candidate SQL, scripts, evidence or documentation. This is the one owner-authorized review of distinct corrective PR2117, not another PR2112 review round or the PR2116 docs recheck. No reviewer delegation or extra review round occurred. No candidate edits, external posting, merge, production writes, real account actions or provider effects were performed. Local proof writes were confined to newly created loopback disposable PostgreSQL fixtures, with cleanup verified. A recorded agent review under the shared GitHub identity is **not an independent GitHub-account approval**.

## Scope, immutability and collisions

The actual eight-file diff adds forward migration30, extends the existing proof with a history performance module, and records bounded evidence/routing/lessons. It changes no edge/client source, CI gate, prototype, permission, trigger, cron or execution engine. HEAD and the worktree are clean at final confirmation.

Applied migrations28/29 are unchanged, including exact SHA256 values:

- `20271028000000_experience05_weekly_commitment_check.sql`: `740608f719d2ee15c29933421d0e26c61f3bfde2a59972fc6f1c901b4092e738`.
- `20271029000000_experience05_weekly_status_readback.sql`: `254816a8a9f08ca14650f52d35945cd2f3053129661bef2df305ea2dfbd97fef`.
- New `20271030000000_experience05_weekly_history_indexes.sql`: `52cd3b515ff463234d759979d6819fc6d1263ceea1f69ab06f7967f26aed5393`.

Current PR main base advanced to `81be62d954e2ac86181cc40f5405a5c0aa44f794`. I read that actual commit: #2115 changes only Master and the E2 decision-log closeout, with no runtime/migration overlap. The frozen candidate remains unchanged and mergeable. Hosted proof checkout explicitly records synthetic merge `ecf9a89f149540d1bc5d7591524eadb4a877aacf`, merging exactdeec into81be. No E2 readback, authentication or deployment claim is promoted into weekly acceptance.

## Query and access-path review

Migration30 lines10–19 add partial indexes matching the existing predicates. The event index puts tenant/process equality before descending event occurrence/id order. The receipt expression index matches the existing tenant, stored receipt string, event and act comparisons and the existing capability-success predicate. It introduces no JSON-to-UUID cast, schema/data rewrite or new read grant.

The historical lateral query at lines79–99 preserves all prior predicates: event subject/type/key/tenant/process; execution event/process/tenant/native adapter/capability/executed outcome; observation tenant/authorizer/process/event/act/correlation; and matching receipt tenant/source kind/string identity/capability/success/event/act. Latest attempt is unchanged and independent of historical verification.

The original order is event occurrence DESC, event id DESC, then qualifying act position. Event id is unique. Selecting the first qualifying act in act-position order **within each event**, then the newest qualifying event, therefore selects the same result. Filters and receipt checks precede the inner LIMIT, so an invalid newest act/event cannot become a verified result and an older valid result remains available. Inner event-specific act lookup uses the existing event index; it avoids sorting all qualifying acts across the process history before applying the outer LIMIT.

I independently compared the getter definitions: everything surrounding the historical join is byte-identical. Tenant/current-active-owner guard, canonical business-zone/schedule behavior, source actor/read time,50-row limit/coverage, current state/next slot and latest uncertainty are unchanged. Lines104–105 repeat the identical explicit ACL: authenticated callers may invoke the getter, but the in-body current-owner check remains required; PUBLIC/anon/service execution is revoked. Other20 SQL functions, RLS and process/receipt/execution authority are untouched. New getter body MD5 is `99218816ce1b8111e80360b1bd9aa189` for later deployment comparison.

## Migration and lock safety

The two indexes and getter replacement are inside one explicit transaction, with5-second lock-acquisition and60-second **per-statement** limits. Ordinary CREATE INDEX can briefly block writes on these shared tables; locks persist until COMMIT. This is not represented as a concurrent/nonblocking build or a60-second whole-transaction guarantee. The transaction makes the two access paths and function replacement atomic, and the documented failed-apply procedure requires actual migration/object inspection before retry rather than assuming no persisted state.

Independent production preflight at20:19:00UTC reports small shared target totals: native events147,456 bytes and workspace receipts458,752 bytes; repair indexes0 and migration30 absent. Given this current substrate and the bounded transaction, no material lock-safety defect was found. Deployment still must establish both valid/ready exact index definitions, repaired getter, unchanged20 SQL bodies/ACL/RLS/guards and preserved DARK counts. Future production workload duration is not proven by the disposable test.

## Independent execution and proof audit

I independently ran the actual existing `weekly-commitment-check.mjs --simulate-ci-role` proof at exactdeec: **62/62 PASS**, exit0, including the history extension's **41 assertions**. The initial sandbox attempt was denied local TCP before any proof case; the approved host rerun passed. Final saved evidence is `work/test-temp/paige-weekly-proof-nmY9FH/result.json` and records role restoration=true, simulated non-bypass failure reproduced=true,189 incumbent catalogue rows/defaults preserved, and the exact migration hashes above. Actual engine/Gateway/native adapter execution and prepared owner reader passed: one execution, duplicate-drain adoption, ten owner RPC calls, zero inspection rows and zero outbound requests.

I independently reran the two focused process/reader suites: **41/41 PASS**, two files, exit0. Both proof modules pass JS syntax checks; changed-range diffcheck passes. No source tests or compiler baselines were altered.

The actual owner RPC was measured three times before and three times after at each scale, using its real source getter. These fresh reviewer measurements are separate from the committed author measurements:

| Synthetic history rows per event/act/receipt table | Original median | Repaired median | Historical lookup | Assertions |
| --- | --- | --- | --- | --- |
| 10,000 | 530.042ms | 307.463ms | 0.135ms | 21 |
| 100,000 | at least5,000ms;3/3 timed out | 502.341ms | 0.210ms | 20 |

The larger baseline values are censored lower bounds, not invented elapsed measurements. Natural plans use the new event-recency and receipt expression indexes; latest-attempt lookup also uses the recency index. No planner override forces those choices. The stored author proof independently records474.862→361.282ms at10k and three5s baseline timeouts→526.369ms at100k, with0.184ms historical lookup. JSON readback equality between original29 and repaired30, excluding only read_at, passes at the smaller scale; the large baseline is deliberately capped rather than run unbounded for equality.

Each scale has50 owner and50 foreign processes with100/1,000 synthetic historical attempts each, plus100 newer unknown event/act attempts. History is cloned from a genuine canonical observation; it is not100,000 real scheduled acts. Two templates use actual canonical draft/authorize/pause RPCs within the disclosed Auth fixture. Bulk setup suppresses only the weekly process row guard, then restores and asserts that guard and process contract **before all measurements and negatives**. Act/authority guards remain enabled. All seed rows, temporary original-getter replacement and baseline index drops roll back; row counts and restored index count are checked. Role restoration is recorded after cleanup. These disclosures match the executable source and do not weaken production enforcement.

Negatives cover all observation/receipt correlations and missing receipts, owner/foreign scope, member/admin/anonymous/service denial, and newest-unknown versus older-verified history. The unchanged main proof also verifies inactive/revoked owners, future-only pause/cancel/edit, original occurrence identity, receipt rollback, canonical tool revocation, reconciliation and unknown/no automatic replay. Auth/context/trust/cron/network/display and operator preflight/deletion-plan/provider/inventory doubles remain explicit. This is not real Supabase Auth, HTTP drainer, production retirement or customer acceptance proof.

## Hosted evidence, documents and retained gates

I independently read job115515580965 in run38460929980: exact synthetic merge checkout, **62 cases PASS**,21+20 history assertions, original role restoration marker, and Linux repaired owner-RPC medians17.722/19.530ms. Its natural-plan assertions ran on the same forward SQL. At final evidence readback, seven workflow groups including Spine passed; overall primary CI remained in progress. Complete CI is **PENDING**, not PASS. PR2117 remains OPEN DRAFT; no review threads were present.

The delivery and UI evidence accurately state candidate/production boundaries, measured scales, fixture exceptions, pending migration/readback and unchanged activation/admission/design gates. The Master/Brain release update has a four-part collision-safe handoff to the existing Journey Lead/#2116: exact sections, proposed DARK wording, owner and reason. The new lesson correctly records the missing accumulated-history proof without claiming a new customer capability. PR2116's ordinary documentation correction/recheck remains a separate task.

Independent read-only production at20:19:00UTC confirms latest migration29, no30/no repair indexes, original getter MD5 `1524b4343c135bde86982852e7aac787`, authenticated getter execute=true/anon=false/service=false, triggerOFF and all six weekly/effect/override counts0, weeklycron0. Only metadata and aggregates were queried. Nothing was activated or accepted as a genuine owner flow.

The correction repairs indexed access and removes the whole-history act sort; it is not an absolute SLA for every possible sparse/invalid history or production workload. No material residual finding was identified. The accepted post-merge P2 is addressed by this candidate source/proof; thread closure and released-fix claims must await the coordinator's exact gated release and actual production readback. No additional review round or authority expansion follows this report.
