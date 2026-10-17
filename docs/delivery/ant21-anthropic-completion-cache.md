# ANT-21 — bounded Anthropic completion cache correction

## Scope and intended outcome

The owner wants OpenAI first and Anthropic fallback, with efficient use of provider credits. This
slice makes the existing non-stream Anthropic transport request the same automatic caching already
used by its streaming transport. It does not establish a measured cache hit or savings claim.

Channel/environment: development, isolated worktree. Base: `143c07bb907d833836ccf459602f232c5039e896`, the reviewed model integration. Root owns
integration, distinct review, source fingerprints, exact-head CI and release. This candidate changes
only `callClaude`'s request body, the incumbent real-helper request-body suite and its snapshots.

Portfolio/pre-edit routing: existing Chat/Command Center and shared model infrastructure; existing
Fabric/Claude provider, budget and trace seams. There is no new Spine capability, mutation verb,
approval, authority lane, durable job, scheduler, UI surface or record. LLM delivery infrastructure
is explicitly excluded from the Integration Capability Registry's tenant-capability entries. The
existing `paige_llm_trace` usage fields remain the outcome evidence. Listed/configured providers
are not authenticated provider readiness. Eligible existing and future SOLO accounts share this
helper; provisioning, cohorts, roles, entitlements and tenant isolation rules are unchanged.

## Source contract

`supabase/functions/_shared/claude.ts` adds exactly `cache_control: { type: "ephemeral" }` to the
non-stream `callClaude` request. The current [Anthropic prompt-caching contract](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
supports this top-level automatic-cache field and defaults to five minutes when TTL is omitted.
No one-hour TTL, new model, provider routing, API version, key, header, prompt reordering, tools,
PDF conversion, request timeout, budget, fallback, permission or activation change is included.

Anthropic may charge cache writes and only matching eligible prefixes can produce cache reads.
This change requests caching; it does not guarantee a hit or a net cost reduction. The existing
cost estimator's treatment of cache pricing remains outside this slice. Stable-prefix restructuring,
legacy background routing and production cache-usage diagnosis are separate work.

## Fresh offline proof

All HTTP calls are intercepted by recording transports; the real helper/router/trace code executes
through the incumbent Node loader. Supabase is a recording module port, not native database proof.

| Proof | Result |
| --- | --- |
| Unchanged baseline `npm run test:reasoning-tier` equivalent command | 67 PASS |
| Failing-first new request/cache controls before product edit | 75 PASS, 9 FAIL |
| Product fix before updating snapshots | 76 PASS, 8 expected snapshot FAIL |
| Final real-helper reasoning-tier suite | 84 PASS, 0 FAIL |
| Existing Model Fabric suite | 171 PASS, 0 FAIL |
| Existing OpenAI Responses suite | 84 PASS, 0 FAIL |
| Existing trace-wiring suite | 20 PASS, 0 FAIL |
| Frozen-snapshot comparison to base | Only eight non-stream cases gain the exact cache field; both streaming cases and all other fields unchanged |
| Node fixture syntax and Git whitespace | PASS |
| Default ESLint | FAIL: 17 pre-existing `no-explicit-any` diagnostics; base/current comparison proves zero introduced |
| Scoped ESLint with only that incumbent rule disabled | PASS |
| Existing SOLO parity static guard | PASS, SP1–SP5; bounded static proof only |
| Existing SOLO parity self-test | PASS, all 16 mutation controls and both legitimate-fixture controls |

Commands: `node --import ./scripts/client-memory-authz/register.mjs` followed by each of
`scripts/model-migration/reasoning-tier-check.mjs`, `scripts/model-fabric/fabric-check.mjs`,
`scripts/model-fabric/openai-responses-check.mjs`, `scripts/token-pricing/trace-wiring.mjs`.
Syntax: `node --check scripts/model-migration/reasoning-tier-check.mjs`. Lint:
`node node_modules/eslint/bin/eslint.js supabase/functions/_shared/claude.ts scripts/model-migration/reasoning-tier-check.mjs`;
the scoped pass appends `--rule '@typescript-eslint/no-explicit-any:off'`. Parity:
`node scripts/ci/solo-parity-guard.mjs` and its `--self-test` controls. Local transcripts and snapshot/lint comparison are under
the owned worktree's untracked `work/cache-proof/` directory.

New controls observe direct/compat/gateway/router requests, unchanged tools and PDF bodies,
provider cache read/write counts separate from uncached input, genuine zero versus unknown usage,
rejection of caller-supplied one-hour TTL and no request when the provider key is absent. Existing
Fabric controls retain the original routing, terminal budget/authority refusal and narrow fallback.

## Release and proof boundary

Source candidate only. Distinct review, hosted exact-head CI/native Deno compilation, source-pin
renewal, merge, deployment/readback, actual provider acceptance and ordinary authenticated Chat/Live
QA remain UNVERIFIED or pending root integration. No provider call, spend experiment, configuration,
customer record, credential, production effect or activation occurred. No customer release identity
or all-18/all-50 restoration completion is claimed; Shipped Delivery Log is N/A before merge.
Migrations are NOT_APPLICABLE; an Edge release/source readback has not been performed in this slice.
Recovery is an ordinary reviewed forward correction; no history reset or effect replay is involved.
