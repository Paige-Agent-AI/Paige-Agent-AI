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

Experience 01 additionally executes migration `20271026000000_solo_business_interview_checkpoint.sql` and exercises caller Owner/private USER-turn scope, isolation/revocation, metadata preservation, replay/concurrency, canonical save/fresh read/correction and current DRAINING begin/assistant-settle compatibility. Source contract and retained evidence: `docs/delivery/experience-01-foundation.md`, `docs/evidence/experience-01-foundation/sql-proof.json`. Historical22-case result above remains historical; current proof lists each additional assertion and exact source hashes.
