# EXP01 original Chat model/cache outcome — November 13

Owner authorization: original ANT-147/85dc8dd1. This is evidence for the existing
EXP01 assignment, not a new outcome ledger. Full original cases/amendments and
owner acceptance remain separate. Prior document/Research jobs are not repeated.

## Research and decision BEFORE implementation

Official [model guidance](https://developers.openai.com/api/docs/guides/latest-model)
distinguishes focused high-volume Luna work, balanced Sol work and hardest Astra
work. Capability descriptions do not establish PAIGE quality. Preserve the
existing Luna/none classifier, Sol/medium operational and Astra/high difficult
routes, plus original Anthropic fallback. No global model upgrade or downgrade
is supported by the observational sample below. Terra is not activated or added.

[OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching)
supports an explicit early developer-content breakpoint alongside implicit
history breakpoints. Exact prefixes must match; tool changes invalidate them.
Use an opaque actor/context partition to separate cache accounting/probing.
Keep the default 30-minute minimum lifetime; it is not a deletion deadline.
Writes and reads are disjoint input categories, with separate write lifetimes.

[Current OpenAI STANDARD pricing](https://developers.openai.com/api/docs/pricing),
USD per million tokens for short context (<=272K input): Sol 2 input/10 output/0.10 cached read; Luna
0.10/0.50/0.01; Astra 10/50/1. Writes cost 1.25 times ordinary input for 30m
or 2.5 times for 12h. Estimates below are this explicit list basis, not a provider
invoice, negotiated/regional/service-tier charge or customer rate change.

[Data controls](https://developers.openai.com/api/docs/guides/your-data) distinguish
response storage, abuse logs and cached KV state. `store:false` is preserved;
no organization retention setting, provider consent or account activation changes.
No zero-retention claim is made from the request alone.

[Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
uses provider workspace/organization isolation, which is not PAIGE tenant
authorization. Original automatic fallback caching remains unchanged.
[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
lists Sonnet 5.5 at 2/10 input/output per million, so the old generic Sonnet
3/15 estimator is not current provider-cost evidence. It is deliberately not
silently changed in this outcome: original customer metering/prices are distinct.

## Actual baseline — read-only, aggregate, no customer text

Production `paige_llm_trace`, agent `paige-ai-chat`, trailing seven days read
November 13 before implementation. Different jobs/populations, NOT controlled A/B
quality evidence or a causal speed comparison:

| Served job/model | Successful calls | Input excluding reads | Cache reads | Mean latency ms |
| --- | ---: | ---: | ---: | ---: |
| Chat entry / Sol | 24 | 2,135,592 | 84,381 | 5,727 |
| Tool loop / Sol | 27 | 117,915 | 2,737,790 | 5,474 |
| Classifier / Luna | 23 | 11,272 | 0 | 1,682 |
| Tool loop / Astra | 4 | 28,635 | 311,776 | 21,716 |

Five additional Luna classifier rows were errors; they remain failures, not
successful low-cost answers. Sol entry read share is 3.8%, loop 95.9% of total
reported input. OpenAI writes were NULL because the adapter omitted them;
baseline cache-inclusive actual cost cannot be reconstructed from those rows.

## Candidate contract and causal proof

Only `traceFor(jobKind)` supplies verified actor and call-time resolved contexts.
The original Fabric hashes the transient partition BEFORE its existing current
authority check. No scope/key is persisted in traces. Model IDs, class selection,
tools, approvals, no-replay/fallback and effect writers remain original.

Scoped OpenAI requests retain exact instruction text/order in the initial
developer message, with an early breakpoint after the first system/persona block.
Implicit history reuse remains enabled. Later changing context is still sent
fresh. Other callers retain the existing translation. Client JSON cannot supply
cache scope, key, breakpoint or retention options through this seam.

Existing `tokens_in`, cost estimate and native meter are preserved. The original
trace gains observed write count and scalar total/write-lifetime metadata plus a
separate explicitly labelled STANDARD provider estimate. Unknown/inconsistent
usage remains unknown. Inputs above272K stay UNKNOWN rather than using the cheaper
short-context schedule; independent review identified this missing boundary in
the first candidate. OpenAI input-minus-reads includes writes, unlike
Anthropic input; do not blindly sum cache fields across providers.

Local candidate checks: adapter126 PASS, Fabric212 PASS, original pricing plus
new mixed-lifetime/invalid-usage/context-boundary arithmetic37 PASS; original
trace20 and round-gate30 PASS. Adapter/Fabric actual Deno check PASS after a
sandbox dependency-DNS failure was retried with permitted network access.
These are transport and
causal regression proofs, not authenticated result, measured quality uplift,
cost savings, independent review, exact-head CI or deployment acceptance.

Independent NON-AUTHOR review cleared immutable8fe5acb4/tree2680caa9 after the
long-context finding was repaired. It reproduced29 baseline dispatch fingerprints
and131 dependency pins, verified the seven-line Root inverse byte-exact, and
identified only29 enclosing-identity fingerprints plus four reviewed provider
dependency digests for mechanical renewal. Renewed exact-head review remains owed.
Hash-await tests exercise revocation, cancellation and crypto failure: no provider
attempt after current authority is lost, and failed partition preparation disables
caching rather than joining a global cache group.

ALG-11 applies to actual per-job routing/quality/cost evidence, not vendor ranking;
keep the existing original routes and quality floor. ALG-12 applies to currentness,
failure/cancellation and no-replay regression. No automatic learning, new domain
algorithm, execution authority or measured algorithm maturity is conferred.

Release/native source verification and ordinary authenticated same-conversation
quality/cache/latency/reopen observations remain PROOF OWED. No new paid Research
job, fault injection, account/role/login/provider change or timer is authorized.

## First exact-head CI failure and causal repair

Published0661/tree966408d9 passed database/authority/Preview and other checks but
FAILED Verify/Test in run43464513583 attempt1. Original attribution artifact
14060571067 records actual merge-test6fd8e3fa:26948 PASS,4 FAIL,7 pending of26959.
All four failures reproduce in `research-fabric-attempt-scope.test.ts`: its
import-stripping real-module loader omitted the newly imported canonical pricing
dependency. Bind the REAL `token-pricing.ts` module into that existing fixture;
no runtime, transport, model, native writer or assertion change. Focused24/24
now PASS, versus20/24 before. Do not relabel the failed hosted run green. Latest
incoming main71928f35 adds only six original E05 Master release lines; preserve
them. Repaired exact-head independent review and full required CI remain owed.

## Actual release and live failure — preserved

Corrected source6ef7978a passed all11 required check-runs and both web contexts;
NON-AUTHOR6860078913 cleared it. Normal merge35144df6d0be2167b8e361a90c4201116687b110
has exactly the reviewed treed706e794. Web production dpl_3fvHMKVAmSAyJHkozVu1APYzGJR1
is READY; both public roots/version endpoints returned200 and that exact build.
Edge43477522711 attempt1 uploaded but source verification failed on three old
llm-trace closures. Original artifact14062713618 retains39/42 PASS. The normal
same-job retry passed42/42; independently opened artifact14064646190 records
Chat668/JWTtrue/archive27cd31d7f16bbc312a82b349d797567f61b5cdf0c8df2f9cf5d75abc2d5da6a9.
No compiler, security setting, migration, account or provider configuration changed.

ONE postrelease ordinary read-only Chat request at18:07UTC failed: Luna classifier
and Sol each returnedHTTP400/invalid_request. The original turn settled INTERRUPTED,
not a fabricated answer or Work; no resend occurred. Metadata-only traces intentionally
omit provider error text. Logs establish invalid_request, not its exact parameter.
This is LIVE FAIL and the outcome remains incomplete, despite reviewed/green/released source.

The first key producer emitted78 characters (version prefix plus full SHA256).
The provider-compatible bound is64; the Responses reference omits this explicit
length bound, so exact observed error attribution remains unproven until live recovery.
The correction retains the version in the hashed preimage and the complete64-hex
digest on the wire. Invalid/overlong internal keys disable reads/writes without
breakpoints, never join a shared global group. The new length assertion genuinely
failed against released source126PASS/1FAIL; corrected adapter132PASS and Fabric212PASS.
Original privacy/current-authority/no-replay/implicit30m/customer-meter contracts stay.
Independent review, fresh exact-head CI, ordered release and successful live proof
are still required for this corrective source; no cache benefit or quality uplift claimed.

## Key correction released; useful cache proof still missing

PR3342 reviewed4164da23 passed all11 exact checks and both web contexts, own
NON-AUTHOR6861317364 plus incoming owner-rules union review. Normal merge
6f6887668e72afb9c21a3a9df92a7ff0703a63a2/tree07b0349b preserves mainba635 rules.
Webdpl_G3FsYmduCbMfStMVJRVh8P6ux7A6 READY; both public roots/version200 exact
6f688766-mwfcaadt. Original approved3342 Preview recovery retained1602 history
rows/frontier28/original duplicate-reported versionONCE/0authusers. No history rewrite.
Edge43487573022 first mismatched Chat source is retained in14068436498; normal
retry4/4PASS certificate14068067282 (ZIP84ac707cf180c0e170f62c753cec12301ecdbf1f6a2573767555823f385df9e6),
Chat671/JWTtrue/archive d17e65f6666a974ccc0b6b452caa87152e9f8e1675ba463f6faf97c896bfa2d3.

Real inspected interrupted question: original Ask again filled draft only, then
ONE explicit Send. Three bounded read-only followups tested changed hypothetical
retention context and exact repeated question. All4 Sol answers correct/FINAL,
zero tools/Work; earlier interruption preserved. First classifier network error
retained; following3 succeeded. No business goal/Memory approval or job execution.
Observed Sol total inputs85082/17953/31757/18267 and cache writes85079/17950/31754/18264;
ALL cache reads0. Provider estimatesUSD0.2133635/0.045431/0.080081/0.046226 are STANDARD
list estimates, not invoice/customer meter. Request shapes differ; latency4862/2655/2205/1863ms
is observational, not causal speedup. Cache benefit remains UNPROVEN.

Inspection: first original neutral persona1822 characters, canonical voice4182,
core2790. Character length is not tokenizer proof. Existing breakpoint covers only
persona before longer stable voice/core. Current original Chat first3 slots are
persona plus optional specialist address/voice plus voice/core. Move the ONE early
boundary to end of these three available blocks, preserving all instruction text,
order, current context, key scope, implicit30m and authority. No Root assembly change.
Real canonical-prefix tests fail136PASS/2FAIL before this correction and138PASS after.
Own NON-AUTHOR69e37045 independently138PASS and verifies source/digest before renewal.
Fresh exact-head CI/release/readback and actual cache-read evidence remain owed.
