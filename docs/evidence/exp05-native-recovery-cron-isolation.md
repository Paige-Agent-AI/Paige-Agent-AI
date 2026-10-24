# EXP05 — deterministic native recovery proof

Status: SOURCE IMPLEMENTED; native CI and production remain separate.
This changes only the existing disposable Layer C proof, not product SQL,
orchestration, activation or production cron configuration.

Original2722/d260 native job120753331780 passed18/19 cases. Case H failed at
2026-10-24T02:40:00.105Z because the explicit reconciliation returned zero.
The copied native schema has the original active five-minute reconciler.
Its pass can consume the committed stale approval between the HTTP held-result
assertion and explicit recovery. The earlier runner did not isolate that cron.
The failed runner did not capture cron run details, so that exact competing
invocation is inferred from source/timing, not fabricated as an observed log.

The original loopback disposable proof now snapshots only the one named
canonical reconciliation job, validates its exact command/boolean state, pauses
it using the native cron API, and waits up to five seconds for any recorded
in-flight pass. It never kills a session. Only then are crash fixtures created.
Cleanup restores and reads back the exact original activation state after
retiring synthetic records, including on assertion failure or timeout.

Existing19 cases, recovery counts, effects, receipts, Rail, exact permissions,
no-repeat and unknown-result assertions are unchanged. No test threshold,
global timeout, production function or migration changes. Explicit loopback and
native cron logging checks fail closed; missing/duplicate/malformed jobs, a
still-running pass or failed restoration fail the proof.

Local syntax/diff checks pass. Full native19-case and restoration proof requires
the existing hosted disposable Supabase job and is not claimed from syntax.
Separate AUTHOR-REVIEW / LOWER ASSURANCE and exact-head required CI remain
release gates. Parent restoration releases and customer acceptance stay separate.

Primary API reference: [pg_cron](https://github.com/citusdata/pg_cron).
Pre-edit reservation: ANT161/cac773dc.

## Observed source release — October24

Reviewed3f716e0872191126c3912807daa18f2e579e4f0f / LOWER5636492569 passed
ten exact checks and two statuses, schema-free Preview correctly skipped.
Original native120759193629 and full verify120759193621 SUCCESS. Actual merge
9d4a85179da7a186d840bc66ed24fc8828f7740e/treeb739f2bad9cb46e2d0cc305e112f7d27931c608b
matches reviewed3f plus actual2bbe parent. Only the original CI proof and this
packet changed; no product function, migration, production cron or action.

Actual web metadata READY dpl_BTrMZWFkvAo9LKo8ZuJKKTxXwUs8 at9d4a. Strict
public9d4a identity check refused because newer containinge35bb7f9 was served;
the read-only public GET at04:02:52Z returned200/e35bb7f9-mvlvfvzj/null. No public
9d4a asset PASS is invented. Main9d4a inherited an E03/E10 duplicate700000;
main native/Preview failed and verify cancelled, so it was not globally green.
Originating correction2732/e35 preserved E10 SQL bytes and genuinely records
800000 in production, consumed with main79171c82; applied E03 remains intact.
[Original release receipt](https://github.com/Paige-Agent-AI/Paige-Agent-AI/pull/2727#issuecomment-6379615240).
Actual customer original-effect recovery, ZION/weekly/automation outcomes and
full EXP05/founder acceptance remain unverified; this is test-source delivery.

