# Evidence — match_paige_memory resource-scoped authorization (§53/§59, R3a)

**Slice:** the systemic authority-correctness hardening (owner-directed 2026-09-13), delivered as ONE
narrow, evidence-led slice. Fixes the confirmed-open §59 defect in `public.match_paige_memory`
(R1 audit §4c, `docs/audits/R1-role-call-site-inventory.md`; re-affirmed open in
`docs/brain/paige-memory-contract.md` 2026-09-05).

## The defect (confirmed at source)

`public.match_paige_memory` is `SECURITY DEFINER` (RLS bypassed), granted to `authenticated`, with two
authorization failures in its in-body guard:

1. **Forged-ID structural bypass.** The guard passed when `auth.uid() = _target_client_id`. Because
   `_target_client_id` is a **caller-supplied** parameter, an authenticated caller could pass
   `_target_client_id := auth.uid()` (self) with `_target_user_id := <victim>`; the
   `auth.uid() IS DISTINCT FROM _target_client_id` conjunct went FALSE, the whole `AND` went FALSE, the
   `RAISE` never fired, and the DATA predicate then returned the victim's `client_memory.content` and
   `chat_message_embeddings.content_excerpt`. `_match_threshold` is caller-supplied → `-1` dumped.
2. **Global-role trap (§53/§59).** `has_role(auth.uid(),'admin')` is tenant-agnostic (`user_roles` has
   no `tenant_id`; every tenant owner holds the global `admin` app_role), so any tenant owner could read
   any user's memory across all tenants.

**Severity: LATENT** at the 2026-08-18 audit (both `client_memory` and `chat_message_embeddings` were
0 rows). Re-confirming current row counts is **PROOF OWED** to a DB-capable session (this session's
direct SQL inspection via MCP was permission-denied). The fix hardens the door regardless of row count.

## The fix (migration `20270304000000_match_paige_memory_resource_scoped_authz.sql`)

- Authority is derived from **server facts, per target** — never from a caller-supplied id matching
  itself. Removing the `IS DISTINCT FROM _target_client_id` self-reference closes defect 1.
- The global `has_role('admin')` disjunct is replaced by resource-scoped checks. **Cross-USER** access
  (rows keyed on `_target_user_id`) is limited to **self** and **platform operator**
  (`is_platform_operator`, §53 — the helper the `client_memory` RESTRICTIVE fence uses). **Cross-CONTACT**
  access (rows keyed on `_target_client_id`, a `clients.id`) goes through the canonical
  **`can_access_contact`**, which resolves THAT contact's own tenant. Closes defect 2.
- **A per-user coach/tenant-admin cross-user grant was deliberately NOT used** (peer-review §39 Finding 1):
  a `client_memory` row's tenant is optional (`client_id` nullable) and `chat_message_embeddings` has **no
  tenant column**, so a per-user staff grant cannot be tenant-scoped and would over-return a MULTI-TENANT
  subject's other-tenant rows. Staff read a specific client's memory via the CLIENT branch
  (`can_access_contact`, per-contact tenant-correct). No current authenticated producer needs the
  cross-user staff path (sole caller is `service_role`), so this is "preserve only where source evidence
  proves required", not a capability regression.
- **Each DATA-predicate branch is gated on its own per-target authorization flag**, so a caller
  authorized for target A can never pull target B's rows in the same call.
- **Search parameters are bounded:** threshold clamped to `[0,1]` (a negative threshold no longer
  dumps), counts clamped to `[0,50]`.
- **The service role** (Paige's server) is trusted to pass server-resolved ids — as the governed memory
  seam (`record_/get_/forget_paige_memory`) trusts it — because the sole runtime caller
  (`paige-ai-chat`) resolves caller→client authorization server-side (JWT tenant-equality; operator
  bypass) BEFORE the call. This restores the legitimate, server-resolved retrieval path: with the old
  guard the function raised `Unauthorized` for its only caller (service role → `auth.uid()` NULL →
  every `AND` true → RAISE), so semantic memory recall could never run.
- Failure is truthful and minimal: `RAISE EXCEPTION 'Unauthorized'` carries no content or metadata.

**Grant end-state:** `REVOKE … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated, service_role;`
(§59-lint-clean; the sole producer, `paige-ai-chat`, calls on `service_role`).

## §37 producer inventory (all 8 classes)

- **Edge functions:** `supabase/functions/paige-ai-chat/index.ts:1469` — the **sole** runtime caller,
  on the service-role client, passing server-authorized ids (`scopedClientId`/`user.id`), never the raw
  body value. Its server-side scope resolution (`index.ts:807-869`) is unchanged.
- **DB functions/triggers, pg_cron/pg_net, GitHub Actions, external webhooks, n8n/Zapier/MCP:** none.
- **Frontend:** none (only generated `types.ts` metadata).
- **Tests/scripts:** `scripts/client-memory-authz/check.mjs` stubs the RPC (asserts the caller passes
  authorized ids); `scripts/ci/vector-search-path-lint.mjs` names it for the search_path pin. No prod
  caller's contract changes; `service_role` is preserved in the grant, so the sole caller still works.

## NOT changed (scope discipline, §13)

- The data-matching columns/joins (product retrieval semantics), the return shape, and the caller
  `paige-ai-chat`.
- **Pre-existing, recorded not fixed:** `chat_message_embeddings.client_user_id = _target_client_id`
  compares an auth-uid column to a `clients.id` and never matches — an under-match, not an authority
  defect; altering it would change retrieval behavior (out of this security slice's scope).

## Proof

| Check | Result |
|---|---|
| `npm run lint:definer-fns` (§59 CI guard) | **PASS** (local) — no public DEFINER fn granted anon/PUBLIC |
| `python3 .github/scripts/lint_migrations.py <migration>` | **PASS** (local) — 0 warnings |
| `npm run ci:tsc` (tsc-ratchet; non-required `verify` job) | Reports **only** the pre-existing **#1186** error (`src/lib/auth/signupMobile.ts` TS2307 `libphonenumber-js/min`) — this diff touches zero TypeScript, so the error is not diff-owned (same base condition prior slices documented) |
| `npm run test:client-memory-authz` (affected-flow) | **268 pass / 1 fail** — the 1 fail is **19.8** (`every executable mutation names the entity it touches`), a **pre-existing base failure reproduced identically on clean `main`** (268/1), outside the memory/search seam; not diff-owned (§13) |
| Boundary proof `supabase/tests/match_paige_memory_authz.sql` via `.github/workflows/match-paige-memory-authz.yml` | **RUNS IN CI** on the PR (pgvector image). Local execution blocked this session (no container-registry access; no cached postgres). 16 boundary cases: legitimate service retrieval · self · self-cross denial · **forged-ID refusal** · **global-admin-ambiguity refusal** · authorized staff via `can_access_contact` (assigned coach; same-tenant admin) · cross-tenant denial · **per-branch gating (no B leak via `_target_user_id`)** · super_admin + **platform_admin** operator cross-tenant · **threshold-clamp discriminator (opposite-embedding row excluded)** · **Finding-1 multi-tenant-subject user-branch denial** · **count-clamp demonstrator (60→50)** · no-identity refusal · retry + replay idempotence (`\ir` ×2) · no data-bearing refusal · anon-revoked grant |
| `premerge-migration-proof.yml` (advisory) | RUNS IN CI — applies the migration on the prod-schema baseline |
| Authenticated production drive (§32.c) | **PROOF OWED** — no isolated test tenant headless; exact minimal owner test below |

## PROOF OWED (stated exactly, no fabrication)

1. **CI pgTAP boundary run** — the dedicated workflow executes the boundary proof on the PR; local run
   was blocked by no registry access. Confirmed green in CI before merge.
2. **Row-count re-confirmation** — a DB-capable session confirms current `client_memory` /
   `chat_message_embeddings` row counts (LATENT ↔ live severity label).
3. **Authenticated production drive (§32.c)** — minimal owner test after deploy: in an authenticated
   session, trigger a chat turn scoped to a client the account may access and confirm semantic memory
   recall works (no `match_paige_memory` error in `paige_llm_trace`); and confirm a chat turn cannot
   surface another tenant's memory. Owed to a browser-capable session with a scoped test tenant.

## Peer review (§39 adversarial + §5 compliance, on the pushed diff)

Two independent reviews read the pushed diff. **§5 (compliance):** scope-faithful, honest,
closeout-complete — SHIP contingent on the boundary suite green in CI. **§39 (adversarial):** confirmed
both named defects closed, per-branch gating airtight, migration correctness, and §37 accuracy — but
found **Finding 1**, a residual cross-tenant read: the original `_may_user` branch granted a per-USER
coach/tenant-admin authority, which is not per-ROW-tenant, so a tenant-admin/coach could read a
multi-tenant subject's other-tenant rows (`chat_message_embeddings` has no tenant column, so this cannot
be per-row-scoped at all). **Fixed** by limiting cross-USER access to self + operator and routing staff
cross-CONTACT access through `can_access_contact` (per-contact tenant-correct) — see the fix section.
Findings 2 (clamp assertions were non-discriminating) addressed by the C11 opposite-embedding + C16
60→50 demonstrators; N2 (platform_admin coverage) added as C15; N4 (stale R1 §7 planning marker)
corrected. Re-proof is the same CI boundary run (now 16 cases incl. the Finding-1 regression).

## Follow-ups (tracked, not folded in — §13)

- **N5:** `docs/sprints/bootstrap-byo-schema.sql` (a point-in-time schema export) still carries the
  pre-fix `match_paige_memory` body + old grants. Not applied migration, not falsified doctrine, out of
  this slice's scope — regenerate at the next bootstrap-schema refresh so a fresh BYO deploy doesn't
  start from the vulnerable body.
- Row-count re-confirmation and the §32.c authenticated production drive (above) remain PROOF OWED.

## Post-merge (stamped in the closeout)

Exact merge SHA, `deploy-migrations.yml` run + `db-live` tag against the merge SHA (zero drift),
`migration list` confirmation that `20270304000000` is recorded on prod, and the Shipped Delivery Log
row — recorded after merge per §32.a (never hand-applied).

## INT-326 addendum — workspace scope (2026-10-05, #1760, not merged when written)

The function above keyed a person's own memory on `client_user_id` alone, so a row written in
workspace A was recalled in workspace B. Migration `20270588326000_match_paige_memory_workspace_scope.sql`
replaces it with a 7-argument signature (`_target_tenant_id`) and drops the 6-argument one. The same
fixture now applies the chain (predecessor, then the replacement twice) and proves, in a block that
runs first so each proof is the one that fails when its defect returns:

| Proof | Assertion | Mutation that makes it fail |
|---|---|---|
| W-A | service role in A recalls `X-in-A` only | tenant predicate removed; chat branch reinstated |
| W-B | in B recalls `X-in-B` only; Y (wrote only in A) gets 0 in B | tenant predicate removed |
| W-C | no workspace → 0 rows, no error (service and operator at rest) | "null scope means every workspace" |
| W-D | X separated by its own active workspace; naming another → `Unauthorized` | JWT may name any workspace |
| W-E | a row written ABOUT a client by the caller never in their own recall; chat embeddings never returned | `client_id IS NULL` removed; chat branch reinstated |
| C13 | the 6-argument signature no longer exists; grants on the 7-argument one | DROP removed (the 6-arg call becomes ambiguous) |

Existing C1–C16 counts were re-derived for the new rules (the user branch needs a workspace; the chat
branch is gone) and still pass. Run locally against an isolated `pgvector`-enabled Postgres 16; CI runs
the same file in `.github/workflows/match-paige-memory-authz.yml` (path filter extended to the new
migration). Production row re-confirm and an authenticated drive remain PROOF OWED.
