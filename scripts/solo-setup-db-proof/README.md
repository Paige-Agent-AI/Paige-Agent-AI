# Solo Setup SQL runtime proof

Run `node scripts/solo-setup-db-proof.mjs` from the repository. Requires Node and local PostgreSQL 16 binaries; on Windows the default binary directory is `C:/Program Files/PostgreSQL/16/bin`. Set `SOLO_PROOF_PG_BIN` only to another local PostgreSQL binary directory when necessary.

The harness creates a new disposable PostgreSQL cluster under `outputs/solo-setup-db-proof/run-*`, chooses a free loopback port, uses synthetic tenants/users only, and stops that exact cluster in its cleanup path. It does not connect to an existing service, project database, provider, or production environment. PostgreSQL controller windows are hidden. Local trust authentication is limited by the server's loopback-only listener; do not run this harness on a shared/untrusted host.

Each run writes `proof.json`, `commands.json`, and `postgres.log`. The proof records migration SHA-256 hashes, named results, and whether the test cluster stopped. Output includes disposable database files: do not commit the entire outputs directory. Retain the small proof file with the release evidence when needed.

## Evidence boundary

All three new migrations are actually executed, as are the existing sender/access functions extracted from tracked migrations. The dependency schema is a deliberately minimal synthetic fixture matching relevant columns and uniqueness constraints; this is not a replay of the entire production migration history.

Initial supplemental cases stub `get_solo_setup_context` and `save_solo_setup_context`; the save stub records invocation to prove rollback. The later Experience 01 cases replace that stub with verbatim tracked canonical writers/getters and current begin/settle/turn guards, and assert committed operational `tenants.brand.business_brief` values, fresh readback, correction and same-thread progress. Synthetic dependency infrastructure is still not full-schema replay. Protected tax/Vault, legal-owner/representative and production behavior remain unproven. Agency authorization helpers remain inert fixture stubs.

## Coverage

- Migration compilation/application; non-Solo sender behavior equivalence; missing tenant and role refusal.
- Managed sender registry/connector atomicity, idempotence, expected tenant, NULL-tenant connector collisions, reserved names, competing claims, rename concurrency, disabled identity refusal, custom sender priority, and later authoritative registry changes.
- Genuine new supplemental knowledge/profile/voice create, edit, stable-ID upsert, committed fresh-connection read, no-op timestamp/provenance preservation, stale revision, cross-tenant IDs, meaningful-content validation, Admin-null preservation/refusal, deletion, and unchanged Team roster.

Latest development run on 2026-09-03: **22/22 PASS**, test cluster stopped, no test-owned PostgreSQL process remained. Evidence: `outputs/solo-setup-db-proof/run-QiXg5f/proof.json`.

This is automated local SQL runtime evidence, **not authenticated browser acceptance, provider delivery, production schema proof, or a LIVE claim**. Re-run whenever the tested SQL changes and attach the exact final-head result.

Experience01 additionally executes migration `20271030100000_solo_business_interview_checkpoint.sql` and exercises caller Owner/private USER-turn scope, isolation/revocation, metadata preservation, replay/concurrency, canonical save/fresh read/correction and DRAINING begin/assistant-settle compatibility. Retained45-case local proof executed the byte-identical migration under its former20271026000000 name; `docs/evidence/experience-01-foundation/migration-renumbering.json` preserves that identity/hash and records the newer pending version. The separate sql-proof-301000.json/migration-state-301000.json record actual45/45 isolated local execution under301000 with cluster stopped; production application and authenticated customer readback remain unverified. Source/evidence: `docs/delivery/experience-01-foundation.md`, `docs/evidence/experience-01-foundation/sql-proof.json`. Historical22-case result remains historical.

2026-10-13 local continuation: pending source is forward-numbered to20271101100000 after fresh production-frontier31004000 read. SQL SHA079ad6339ac35e1c3287249ae169ccad71c77fed610e254584e2bd83fe6ff274 is unchanged; historical260000/301000 actual proof records remain historical. This rename is not application or Preview repair. Existing original preview260000 and pending source must be reconciled through the approved supported administrator operation after updated exact-source preconditions are reviewed.
