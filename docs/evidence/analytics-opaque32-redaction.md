# Analytics opaque32 credential redaction repair

Owner-authorized privacy-first policy — 2026-10-03. Scope: existing observational Analytics sanitization only; no new provider, authority, action, route, schema or UI. Sales #1661 was reviewed separately; this prerequisite does not change its source.

The random credential gate in run37144655550/job111265994096 produced the synthetic sample `LDLTW1JT364LO3PITQCI9XD8217OQLAJ`. Its uppercase-only alphabet passed an intentional mixed-case exception, so this was a deterministic policy gap rather than a timing flake. Four failing-first tests reproduced uppercase, lowercase and raw-plus/form-decoded variants through attribution helpers and the actual emitted trackEvent body.

The exact32 base64 mint-shape predicate now ignores case. UUIDs, shorter campaign labels and ordinary separated labels outside this ambiguous width retain existing protection. Known credential routes/query-key protections and randomized zero-escape assertions are unchanged. Accepted attribution impact: ambiguous opaque32 campaign/referral codes can be hidden even when business labels, including all-uppercase/all-lowercase codes; this is deliberate credential privacy precedence, not lossless attribution.

Measurement: deterministic synthetic corpus of1000 shorter/separated `campaign_launch_N` labels and1000 exact32 uppercase `CAMPAIGN`+24-digit codes reports ordinary redactions0/1000 and ambiguous redactions1000/1000. This is an explicit collision budget, not a population false-positive estimate. The old mixed-case1.3% claim is removed rather than treated as current evidence. No existing Monte Carlo threshold or random mint assertion is relaxed.

Verification commands: focused Vitest useAnalytics.credentials/escape-rate/redaction/wiring suites; focused ESLint; git diff --check. All 80 focused tests, focused ESLint and diff check PASS; independent nonauthor exact-head review PASS at `12c3726124c068d57ec01c409bdf3003d6519e82`, including actual emitted-body tests and original random assertions. Network transport is mocked in tests; no hosted telemetry, real credential or tenant record is sent. Authenticated production ingestion/readback remains UNVERIFIED and is excluded from LIVE. No claim of universal credential detection; future nonhex widths still require policy/contract review.

Release: production internal-only privacy patch; PR #1663 merged as `9564b0d40ee3f1c36d48b845a5331d3b3e388647`, Vercel `dpl_9kkWZZSsFMEanFb45K7t6EyfpLcv` READY exact squash (coordinator observation). Migration/Edge NOT_APPLICABLE; no customer version/publication. Required exact-head checks PASS: eight success conclusions and appropriate Supabase Preview SKIPPED. Recovery: forward fix preferred; reverting reinstates the single-case gap and requires an explicit privacy decision. Master §4.0 records this release in the same documentation closeout.

Observed expected public/app/inbound/main Vercel aliases; public `/version.json` reported `9564b0d40ee3f1c36d48b845a5331d3b3e388647-musrk5uv` before the subsequent Sales build. Its app version was not separately checked. Customer release identity remains absent; no publication.

Postmerge CI chronology: Analytics run `37146720967` CANCELLED as superseded by Sales main run `37146777401` (in progress at closeout preparation). Exact-head PR checks passed; no standalone Analytics postmerge success is inferred.
