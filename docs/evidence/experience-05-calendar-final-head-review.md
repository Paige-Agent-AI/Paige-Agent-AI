# Experience 05 Chat/Calendar preparation — final-head independent review

**Verdict: SHIP for the bounded read-only, dark preparation at `6ef72eb60aa686b4aebe1e7bad74a172c6263b52`. No remaining material correctness or security findings.** The independent review is complete. Owner design approval, product mounting, named Chat/Live admission, trigger/cron activation and authenticated customer acceptance remain separate holds. This verdict does not exercise release authority or confer those approvals.

Reviewer: `backend_review`, a separately spawned non-author. I authored none of the candidate source, tests, proofs, prototype or repository documentation. Review completed 2026-10-13. No repository edits, push, external approval, account change, provider action or production write was performed. This report is the only new final-review deliverable and is outside the repository.

## Authorization and immutable scope

The parent supplied the direct owner's authorization for exactly one additional bounded review after the ordinary recheck was consumed. The matching limited scope is recorded in [PR2112 comment6147764221](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2112#issuecomment-6147764221), under the coordinator account. It grants review only; it is not design, admission or activation approval. No further review round is presumed.

Reviewed complete final candidate against main merge parent `7f3217af597ad779b332515391f492a25f8ba811`, plus the reconciliation from previously reviewed `d257290833d70fb5db1dda07515b20c2509f77a0`. The initial review base was `07a10820ee4cf4e1c9fa1dac78d8c56aad4dacd8`; the product/rendered payload remains `6083a728f9d89b784cc3709875b0215c236d63b2`. Final HEAD and remote PR head match the exact target. The worktree was clean at entry and final confirmation.

The final candidate has 115 changed files against its merge parent. Reconciliation from d257 changes 40 files: 37 incoming main paths match main exactly; only Master, Brain README and the E5 delivery record overlap the candidate. The README retains both E3 additions and the updated E5 row. E5 SQL, orchestration, Spine metadata, focused tests, proof scripts and prototype bytes are unchanged across reconciliation. Neighboring source was preserved.

Current local `origin/main` advanced to `0a7062ad07101c1f6efc97b8a7c9529573aeac4a`. I inspected its actual 16-file delta from 7f, including E2-3b Chat refusal/answer bookkeeping and duplicate-append corrections, Sales cutoff/narration, tests and 29 c0b fingerprints, in addition to closeouts. Candidate/main source paths are disjoint. The only common paths are Master and Brain README: E5 adds its preparation paragraph/row, while newer main adds shipped closeouts and corrects the E1 row. No weekly reader import/admission, identity contract, SQL, projection, proof or Calendar-authority collision was found. This is a compatibility review of that delta, not a new approval of the E2 feature. The CI results below used the recorded 7f merge base and are not described as a new 0a merge test.

## Correctness and authority review

`weekly-commitment-read.ts:12–51` fences actor, tenant, workspace, role, account shape, act-as and scope epoch, with canonical current-tenant and current-owner RPCs before and after the getter. A role label alone grants nothing. Canonical tenant/actor envelope checks prevent a different caller response being accepted. Timeouts, RPC failures, scope changes and malformed responses return unavailable/degraded rather than an empty or completed result. Its model entry at line54 accepts empty input only. The caller transport is supplied by the incumbent authenticated path; this preparation creates no service-role customer read.

`20271029000000_experience05_weekly_status_readback.sql:8–85` retains the existing active-owner in-body guard and authenticated-only getter ACL, with PUBLIC/anon/service execution revoked. Current tenant and author filter processes and source evidence. Latest attempt is independent from historical verification. The historical join at line63 binds tenant, actor, process, event, act and correlation and requires the matching canonical capability receipt; missing receipt cannot become completed history. A historical original schedule revision survives a later edit or uncertain attempt. List coverage is deterministic and bounded at 50, with explicit `has_more` and source read time. Missing/invalid business zones remain explicit rather than acquiring a browser, staff or UTC default.

`weekly-commitment-projection.ts:38–127` validates the private response and removes raw Planning items, observations and errors from the consumer snapshot/model JSON. Names/reasons and output are bounded; Chat includes at most ten checks and 12,000 characters with truthful incomplete coverage. An uncorrelated completed label becomes unknown. Historical verification cannot hide latest uncertainty.

Calendar consumes only canonical actual `next_run_at` instants, with no booking identity, duration, occupancy, recurrence expansion or effect writer. Held intended time stays separate. ISO weekday 1–7, approved schedule zone and configured business display zone remain distinct. PostgreSQL-approved aliases and ICU-newer schedule names are preserved without making ICU the schedule authority. Business-zone changes affect display only. Missing display configuration does not move the approved schedule.

The Kit declaration in `paige-spine/domains/automations.ts:6` is read metadata, with no new offer/dispatch path. Existing status remains PARTIAL, Chat/Mind UNAVAILABLE and self-description off. The Spine domain is already in Chat's transitive source graph; declaring metadata there is not reader admission. The prepared reader/projection is imported only by its own module and tests/proof consumers. No production Chat/Live getter binding, allowlist, lint exception, permission seed, source UI mount or protected account change is added. Shared receipt metadata names the existing recorder but this read wires no receipt writer or second registry.

The unchanged released configure/control/execute/reconcile functions retain human exact-revision authorization, future-only pause/cancel, disarmed edits and renewed authorization. Live claimed occurrences preserve their original evidence; new occurrences require current authority and the canonical tool lane. Atomic observation/terminal outcome/receipt and canonical redrain adoption remain intact. Unknown outcomes stay held and are never automatically replayed. The new read creates no scheduler, execution ledger, booking, Planning mutation or provider effect.

## Findings and dispositions

- Previous P2 catalogue assumption is resolved. The proof checks a known catalogue boolean for CET/GMT/EST, then asserts acceptance/preservation when present or expected `22023` refusal when absent. Neither branch is skipped; the validator/catalogue/authority is unchanged. Hosted final proof now completes all later assertions.
- Earlier schedule-zone narrowing, proof call/schema omissions and unavailable-result type errors remain fixed in the actual reviewed bytes.
- The nonmaterial EOF blank line in `calendar-rendered-review/incumbent-fit.md:40` retains its recorded reasoned decline. Full candidate diffcheck reports that whitespace nit; no clean full-range claim is made. It changes no Markdown content, rendered meaning or authority and is not an unresolved finding.
- Existing business-zone retirement disposition remains fail-closed and parked in [issue2111](https://github.com/Paige-Agent-AI/Paige-Agent-AI/issues/2111). The explicit disposable deletion-plan double includes that selected table but does not prove production retirement. I found no new outside-scope defect during this review.

## Independent verification and exact-head CI

At this exact target I independently reran the two focused suites: **41/41 PASS**, two files, exit0. The first sandbox attempt executed zero tests because Vitest's temporary cache rename received EPERM; the approved host rerun passed. Direct strict TypeScript checks of both unmounted modules passed, exit0. No shared type seam was changed.

Independently recomputed pins:

| Artifact | SHA256 |
| --- | --- |
| Forward getter | `254816a8a9f08ca14650f52d35945cd2f3053129661bef2df305ea2dfbd97fef` |
| Shared projection | `06D13D2C1B819D913FFB181DA487E1FEAED88C10F03EB6D0B57C553101440CBF` |
| Prototype | `16CE82114E898DA28324E4C866DB3E078692BCFA99FC32950FF74F7E5590B090` |
| Corrected proof script | `1b3e138ea502f60625f9660de59f67b2a93c41e420e96e2aa37ef0fe5ad11d42` |
| Committed local 61-case evidence | `365ef0d2b7ed149ff599a8ad1ed4ff30fb8ea4a3ae7ce9474ec9b5ace2406317` |

I revalidated all 86 PNG hashes and dimensions and the manifest's 186 passing assertions (157 main, 14 negative, 15 reviewer branch). The prior independent compiled-embed and gallery-link checks apply to the same unchanged artifact bytes. The finish chain truthfully separates its historical full visual review from the current scoped off-hours-date correction and renewed automated captures. I did not personally rerun the browser drive or full PostgreSQL replay during this review.

Fresh GitHub evidence returned eight completed successful workflow groups associated with exact head6ef; the hosted logs explicitly check out synthetic merge `f97bf3297c1e80c5af36e2fe85c81a4b50150148`, merging this candidate into7f. No earlier-head pass was substituted.

| Workflow group | Successful run |
| --- | --- |
| ci | `38349038073` |
| ui-delivery-evidence | `38349038079` |
| migration-lint | `38349038011` |
| Security Audit | `38349038137` |
| Sales invoice channel SQL proof | `38349038066` |
| Sales Collections SQL proof | `38349038067` |
| PAIGE Spine contract | `38349038027` |
| Finance source proof | `38349037941` |

Independently inspected [ci run38349038073](https://github.com/Paige-Agent-AI/Paige-Agent-AI/actions/runs/38349038073) job115136988018: all **61 PostgreSQL cases PASS**, actual engine/Gateway/native adapter one execution plus redrain adoption, actual prepared owner reader/Calendar projection, ten owner RPC calls, zero inspection rows and outbound requests, and 189 incumbent catalogue rows/defaults preserved. The initial printed fixture JSON precedes cleanup; the later log explicitly confirms the original role posture was restored and verified. Job115136988235 reports **818 files/12,363 tests PASS**, separate invoice15/319 and Collections9/75 PASS, plus successful build, type ratchet, Kit/anti-bypass, declaration, ACL/signature and other existing gates. The committed renewed local proof separately records role restoration true, including the simulated non-bypass negative.

These proofs run selected canonical PostgreSQL/engine source with disclosed Auth/context/trust/cron/network/display and operator preflight/deletion-plan/provider/inventory doubles. They do not establish HTTP drainer behavior, real Supabase Auth, production retirement or authenticated customer acceptance.

PR2112 is OPEN DRAFT, exact target, mergeable at readback. No inline review threads or new material discussion reports were present. The recorded PR review summaries accurately distinguish initial fc FIX FIRST, d257 recheck approval and this separately authorized final review.

## Production and acceptance limits

Independent read-only production metadata at **2026-10-13 14:29:53.677611 UTC** confirms: released migration20271028000000 present; candidate20271029000000 absent; trigger OFF; six weekly process/event/act/receipt/provider-reference/tool-override counts0; cron27 and weeklycron0; getter execute authenticated=true, anon=false, service=false; existing business-zone retirement disposition blocked. This queried aggregate metadata and ACLs only. No account contents, credential, genuine customer session, fixture write, retirement or provider action was accessed or performed.

Docs preserve the current preparation/released-dark distinction, chronological proof/review identities, owner-designed simulation bounds, existing Calendar booking/Mind FU-3/#786 state and named admission/security prerequisites. Current rendered evidence does not establish owner approval, real assistive-technology or 200-percent browser zoom, mounted SOLO geometry, activated execution or both-surface authenticated acceptance. Account designation is not permission or authenticated PASS. Those acceptance legs remain held or UNVERIFIED, as the packet states.

This exact-head review is complete with SHIP and no material findings. The release coordinator still owns normal guarded release operations and current server-enforced merge/deployment gates; no administrative override, further head change or additional review round is authorized by this report.
