# Canonical Knowledge read and metadata update (staged service)

UI_DELIVERY_EVIDENCE_VERSION: 1
FLOW_BY_FLOW: PASS: active workspace -> canonical read -> expected revision -> allowlisted metadata write -> readback -> existing Rail receipt; local executable SQL and adapter tests below.
PAIGE_UI_DESIGN: PASS: applicability reviewed against repository skill; this slice adds no screen, control, styling or interaction and adopts no visible consumer.
MATERIAL_FLOW_CHANGE: NO: staged backend/client seam only; no current UI consumer or Chat tool is changed.
FLOW_PROTOTYPE: NOT_REQUIRED: staged service; broader Knowledge experience already owner-approved under INT-266.
PURPOSE_AUDIENCE_PRIMARY_ACTION: PASS: tenant members must read the selected workspace and update canonical metadata without overwriting a later revision.
VISUAL_DIRECTION: NOT_APPLICABLE: no visual change.
AUTOMATED_EVIDENCE: PASS: seven Vitest adapter tests; actual PostgreSQL16 fixture migration applied twice, eighteen behavior/role checks and concurrent two-connection CAS plus final revision readback.
STATIC_EVIDENCE: PASS: focused ESLint; no reserved Chat handler, consumer screen, registry or package changes. ci:tsc exit0, baseline12/current12/no new diagnostics.
RENDERED_EVIDENCE: NOT_APPLICABLE: no UI adoption in this staged slice.
BEHAVIORAL_EVIDENCE: PASS: SQL executes as authenticated/anon roles in isolated local PostgreSQL; test identity/predicates/receipt are explicit fixture functions, not live Supabase identity.
AUTHENTICATED_RUNTIME: UNVERIFIED: no deployed Supabase/authenticated browser test; local role tests do not prove production RLS or the full migration chain.
KEYBOARD_FOCUS: NOT_APPLICABLE: no controls.
ZOOM_REFLOW: NOT_APPLICABLE: no layout.
REDUCED_MOTION: NOT_APPLICABLE: no motion.
STATE_COVERAGE: PASS: invalid/missing workspace, wrong document tenant, inactive member, anonymous access, forbidden patch, invalid tag, stale revision, retry, concurrent writers, receipt refusal after committed write.
TRUTHFUL_STATE_LABELS: PASS: completed_unrecorded is distinct from failed; adapter never retries writes automatically; no LIVE capability or UI claim.
SOLO_UI: NO: no screen adopts this seam yet.
UNVERIFIED: production schema/RLS/receipt behavior, full migration replay, Supabase API serialization, actual company-operator receipt reconciliation, all authenticated UI flows and final Chat binding.
RELEASE_CHANNEL: development: isolated localhost PostgreSQL and staged TypeScript client.
RELEASE_CLASSIFICATION: internal-only: no customer release.
CUSTOMER_RELEASE_IDENTITY: none: staged capability, no deployed human flow.
RELEASE_NOTE_REQUIRED: NO: service foundation only.
RELEASE_TRUTH_BOUNDARY: PROOF OWED: deployed schema, authenticated tenant flows and UI adoption. Proposed knowledge.read/update remain UNAVAILABLE as governed Paige capabilities.
RELEASE_RECOVERY: position=revoke new RPC grants if activation needs containment and retain revision values to avoid stale-client ambiguity; reference=6230e6087e7fb693af4f0b53935f59ed90f65229

## Ten routing answers

1. Outcome: manage the one Knowledge library with correct tenant scope and metadata concurrency.
2. Owner: Knowledge per INT-266, consuming existing Settings/Chat-Command Center portfolio seams; consumer agent owns current UI/ingestion files.
3. Harness: existing authority and receipt path (A/B/F); no new engine or job. Harness map labels are not upgraded.
4. Spine: proposed knowledge.read and knowledge.update UNAVAILABLE. Active registry mutation validation requires real LIVE Chat binding; no registration or validator weakening here. business_context.readiness remains status-only.
5. Provider: native PostgreSQL operation; existing registry excludes Supabase/Voyage infrastructure. No fabricated Knowledge provider or provider activation.
6. Authority: existing is_platform_owner/is_tenant_member predicates, including established company-workspace operator rights. Future knowledge_update is ordinary/update through canonical Chat approval; this authenticated human RPC accepts no approval flags or actor identity. No service-role caller grant.
7. Jobs/events: no long-running work in this metadata-only slice. No scheduler or parallel event store.
8. Readback: UPDATE RETURNING after a locked revision check, canonical scoped read RPC; fixed reference-only receipt payload via existing ten-argument record_capability_run. Receipt error returns completed_unrecorded without retrying the write.
9. Surfaces: no adoption yet; paige.workspace PARTIAL, settings.setup PROOF_OWED, command-center.mind UNAVAILABLE remain unchanged in their owning ledger. No visual availability upgrade.
10. Proof: local SQL execution and TS contract tests below. Supabase deployment, real identity/roles and UI adoption stay UNVERIFIED. Final release authority remains with the owner.

## Scope and semantics

Existing canonical table gains revision; a trigger increments it for every update, including legacy writers. No duplicate Knowledge, Memory, approval, receipt or job store. Read is paginated (1-100 per page), list omits content, document detail returns canonical content. Expected tenant is a stale-workspace precondition; actor and selected tenant derive from auth.uid/profile under a row lock. No primary-membership fallback. The metadata patch permits title/summary/category/tags only. Content, creator, tenant, network approval and promotion fields cannot be patched.

The service uses SECURITY DEFINER for a bounded authenticated operation that must lock the caller profile and call the privileged receipt function. Explicit auth, active scope and existing authority predicates precede every data operation, search_path is empty, identifiers schema-qualified and PUBLIC/anon/service_role execute revoked. This is additive: legacy direct RLS access is unchanged and remains separately owed consumer adoption.

A retry with the old revision refuses, rather than claiming idempotent replay. After lost acknowledgement the caller must read back current state. Stable receipt ID derives from document+tenant+committed revision, but does not serve as an execution gate. Existing recorder requires literal active membership and may refuse company operators who have legitimate authority through the newer predicate. The write truthfully returns completed_unrecorded; shared receipt-authority reconciliation needs its own bounded change and this patch does not widen it. Safe receipt detail is built solely from fixed operation, document UUID and revision, with no raw metadata/content.

## Reproducible proof

- `python scripts/knowledge-service/check.py --psql <PostgreSQL16 psql path> --port 55439 --user knowledge_test`: creates/drops a unique database on an explicitly isolated localhost cluster. Fixture schema models authority/receipt dependencies. Migration executes twice; behavior suite and concurrent writer check pass. This is not a full Supabase schema replay. pgvector is not installed locally and is unused by metadata.
- Failing-first SQL run before migration: missing read_tenant_knowledge function, exit1. After migration: exit0.
- `npx --no-install vitest run src/__tests__/knowledge-service.test.ts --maxWorkers=1 --reporter=dot`: seven passed.
- `npx --no-install eslint src/lib/knowledge-service.ts src/__tests__/knowledge-service.test.ts`: exit0.
- SQL returned a revision conflict for a duplicate lost-ack retry and competing writer; one mutation/receipt survived. Company operator write committed with explicit unrecorded outcome.
- Shipped Delivery Log: N/A, no main merge. Independent exact-head review is requested separately; not yet claimed complete.

INTERNAL_BUILD_IDENTITY: 6230e6087e7fb693af4f0b53935f59ed90f65229; deployment=none; environment=development; migrations=PROOF_OWED(20270530100000_knowledge_canonical_metadata, isolated fixture only); edge=NOT_APPLICABLE; evidence=scripts/knowledge-service/check.py and src/__tests__/knowledge-service.test.ts

The migration was created with the Supabase CLI, then moved forward to 20270525000000 because current main already reaches 20270523000000 and the coordinated Chat lane reserves 20270524000000. No out-of-order deployment is required. The fixture runner references the final filename.
