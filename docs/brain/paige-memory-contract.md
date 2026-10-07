# Paige Memory — the governed continuity contract

**Read before any work that stores, retrieves, corrects, or deletes something Paige is meant to
REMEMBER across turns or sessions.** Memory is one of four distinct concepts and they must not be
merged into one unbounded store:

| Concept | What it holds | Where it lives |
|---|---|---|
| **Rail** | ACTIVITY — what happened, attributable, audience-scoped | `paige_client_events` / `paige_workspace_events` (browser-denied; read via resolvers) |
| **Spine** | safe CURRENT evidence — status/provenance a model may see now | per-capability adapters → the 19-key SpineSignal (`resolveEvidence.ts`) |
| **Mind** | curated usable KNOWLEDGE | the Spine evidence projection (PARTIAL: one live capability) + `SoloMindWorkspace` |
| **Memory** | CONTINUITY — durable facts, decisions, commitments, corrections, preferences, agent lessons | **this doc** |

## The store (extend, never fork — §18)

Memory has homes already; Release C (2026-09-05, migration `20261223000000`) added the governed
CALLABLE SEAM over them, not a new table:

- **Workspace memory** → `public.paige_owner_memory`, `(tenant_id, user_id)`-scoped; operator (God)
  rows are tenant-less (`tenant_id IS NULL`, read via the `is_platform_owner()` RLS branch). The §8
  Owner-Ops sibling of `client_memory`. **S5 (2026-10-07, #1788/#1801): this is the CANONICAL home
  for the owner's own no-client continuity** — preferences, session summaries, business milestones,
  extracted facts, and the owner's own credit-report context summary all write here through the
  governed seam (always `proposed`, with `metadata.audience` marking `owner_personal` vs
  `business_organizational`), and owner recall reads `get_paige_memory`. The no-client chat writers
  no longer touch `client_memory`; the no-client semantic-search arm is retired (owner-memory
  semantic recall belongs to the C6 projection). The 11 real legacy preference rows were migrated
  with original timestamps/provenance (`metadata.legacy_source_id`, unique-indexed) and their
  originals soft-retired. Deletion paths (`admin-delete-user`, `process-data-deletion`) wipe BOTH
  homes. A workspace-shared business audience does NOT exist yet — `audience` metadata describes
  intent, it grants nothing (INT-337, separately owned).
- **Client memory** → `public.client_memory` (Client-Experience team; tenant derived via
  `clients.tenant_id`, RESTRICTIVE). Holds CLIENT-relationship memory only: anything whose semantic
  subject is a client/contact (coach notes, client milestones, client-scoped report uploads,
  lender/funding/dispute facts). **S5 moved the owner's OWN no-client writes OUT of this table**;
  client-scoped writers are unchanged.
- **Conversation memory** → `paige_owner_memory` via `memory_type ∈ {decision, commitment,
  correction}`. **Never raw transcript** — the per-thread rolling summary stays in
  `paige_chat_threads.summary`.
- **Agent memory** → `paige_owner_memory` via `memory_type ∈ {agent_outcome, agent_lesson}`. Scoped
  task outcomes + lessons ONLY — never hidden reasoning or an unrestricted scratchpad.

`paige_owner_memory.memory_type` is OPEN VOCAB (no DB CHECK) by design (§10 config-as-data); the
governed seam enumerates the allowed types so the store cannot become a raw event dump. S5 extended
that enumeration with the owner-continuity kinds the platform's writers emit:
`milestone_completed`, `open_loop`, `report_upload` (plus the pre-existing
`preference`/`session_summary` etc.).

## The governed seam (the §10 callable contract — migration `20261223000000`)

All three are `SECURITY DEFINER`, `search_path=public`, **anon-revoked**, `authenticated` +
`service_role` only, and resolve caller scope IN-BODY (§59/§45): a JWT caller is confined to
`auth.uid()` + `current_user_tenant_id()` and its `p_user_id`/`p_tenant_id` arguments are IGNORED; a
`service_role` caller (Paige's headless agent, which resolved scope server-side) passes them.

| Function | Purpose | Governance fields it realizes |
|---|---|---|
| `record_paige_memory(p_memory_type, p_content, p_source_thread_id?, p_metadata?, p_supersede_prior?, p_confirmation_state?, [p_user_id, p_tenant_id]*)` | governed WRITE | source (`source_thread_id` + `created_by`, which is **NULL for the service/system seam**, never the subject), scope (server-resolved `tenant_id`+`user_id`), timestamp (`created_at`), visibility (RLS + `memory_type` audience), **correction** (`p_supersede_prior` marks prior active rows of the same (scope,type) inactive), **confirmation** (`p_confirmation_state ∈ {proposed,confirmed,corrected,retired}`, default `proposed`, merged into `metadata` so an inference is never stored as truth) |
| `get_paige_memory(p_memory_types?, p_limit?, [p_user_id, p_tenant_id]*)` | governed READ — server-resolved scope + audience filter, own rows only | scope, visibility. **Returns `metadata`** so `confirmation_state`/provenance are readable. Semantic recall stays `match_paige_owner_memory`. |
| `forget_paige_memory(p_id, [p_user_id, p_tenant_id]*)` | governed DELETION — soft-delete (`is_active=false`) of the caller's OWN row, scoped to its resolved `(user, tenant)` | **deletion/retention** — a `service_role` caller passes both and CANNOT wildcard across the tenants a user belongs to |

`*` = honored only for `service_role`. Uses `IS NOT DISTINCT FROM` on `tenant_id` so a tenant-less
operator's NULL-tenant rows match (avoiding the `=`-on-NULL trap `match_paige_owner_memory` documents).

### Runtime Harness eligibility boundary (owner-confirmed 2026-09-08)

A durable row with `confirmation_state='proposed'` is a **candidate**, not eligible Memory knowledge.
It may be displayed with provenance for review or correction, but the Runtime Harness must not
assemble it into task context as a confirmed fact. Only an authorized, scoped projection that
enforces the owner-confirmed eligibility rule may promote durable knowledge into runtime context.
That confirmed-only projection and its runtime integration are currently `UNAVAILABLE`; the
existing write/read seam and its returned confirmation metadata do not prove filtering. Proof
becomes owed only after an implementation exists. This clarifies eligibility without changing the
established store or seam and does not authorize chat auto-write, raw transcript ingestion, or a
second Memory system. Canonical Harness decision:
`docs/PAIGE-MASTER-PROJECT-REFERENCE.md` Section 3.

## Every memory item carries the six governance fields (+ confirmation)

source · scope · timestamp/freshness · visibility · correction path · deletion/retention — realized
as the table above maps them — PLUS a confidence/**confirmation** field (`metadata.confirmation_state`,
the Relationship Context contract Layer 2 field that keeps an inference from masquerading as truth).
A memory write that skips the seam and hand-builds a row (raw INSERT via the RLS policy) is legal but
bypasses the vocab + correction + confirmation discipline; prefer the seam.

## Proof + honest state (§13/§32)

- **Migration `20261223000000` — pre-merge `BEGIN..ROLLBACK` behavioral proof on prod
  (`xygzykjyynhzqytbqnzu`, re-run 2026-09-05 after the Codex peer-review fixes):** DDL executes;
  `record_paige_memory` is `SECURITY DEFINER` with `search_path=public`; **anon cannot EXECUTE** any
  of the three, `authenticated`/`service_role` can. Behaviorally proven end-to-end (all green,
  then rolled back): a service write stamps `confirmation_state='proposed'` by default and
  `created_by=NULL`; an explicit `confirmed` is honored and an invalid state is rejected;
  `get_paige_memory` returns `metadata` carrying `confirmation_state`; `forget_paige_memory` from a
  service caller with a MISMATCHED tenant does NOT delete (P1) while the matching tenant does; a JWT
  caller's spoofed `p_user_id`/`p_tenant_id` are ignored and `created_by` is stamped to the actor
  (§59); a JWT caller with no resolvable workspace is refused **42501**. Non-persistence confirmed
  (`memory_fns_on_prod=[]`, `proof_test_rows_persisted=0`). The **persisted-apply is CI's**
  (`deploy-migrations.yml` on merge → `migration list` verify → `db-live`); do not hand-apply (§24/§32.a).
- **DEFERRED, labeled not delivered:** the chat-runtime AUTO-WRITE of conversation/agent memory (slice
  4b) is NOT wired — this ships the seam it will call; a capable caller (Paige's MCP agent) can drive it
  now. Semantic recall of the new types via `match_paige_owner_memory` is available but unwired into chat.
- **FIX SHIPPED 2026-09-13 — prod runtime UNVERIFIED (PROOF OWED §32.c/§70) (migration `20270304000000`, §53/§59, R3a):** `match_paige_memory` (CLIENT-memory +
  chat-embedding recall) — the §59 caller-scope defect is closed in the deployed + persisted + boundary-proven function body. It carried a forged-ID self-reference
  bypass (`_target_client_id := auth.uid()` self-authorized reading a different `_target_user_id`) AND
  the global-role trap. Now cross-USER access is limited to self / `is_platform_operator`, and staff
  reach a specific client via `can_access_contact` (cross-CONTACT, per-contact tenant-correct); the
  per-user coach/tenant-admin grant was dropped (§39 Finding 1 — `chat_message_embeddings` has no tenant
  column so a per-user staff grant can't be tenant-scoped). Each
  data-branch gated on its own flag, search params bounded, and `service_role` trusted to pass
  server-resolved ids (as this seam does) so the legitimate `paige-ai-chat` path — previously DEAD under
  the `auth.uid()`-only guard — works. Boundary proof `supabase/tests/match_paige_memory_authz.sql`;
  evidence `docs/evidence/match-paige-memory-authz.md`. Row-count re-confirm AND the authenticated
  production drive (legit recall works; no cross-tenant leak in the running product) remain PROOF OWED
  (§32.c/§70) — deployed + persisted + boundary-proven is not the same as production-verified.
- **INT-326 — a person's own memory is recalled only in the workspace it was written in (2026-10-05,
  #1760; NOT merged or deployed when this was written).** Migration `20270588326000` replaces
  `match_paige_memory` with a 7-argument signature (`_target_tenant_id`; the unscoped 6-argument one is
  dropped). User branch: `client_user_id = target AND client_id IS NULL AND tenant_id = scope`; service
  role needs a non-null tenant for it, a JWT caller's scope is `current_user_tenant_id()` and naming a
  different tenant is refused unless the caller is a platform operator. The `chat_message_embeddings`
  branch is removed (0 rows ever, no writer, no tenant source). `paige-ai-chat` reads own memory with
  `tenant_id = callerActiveTenantId()` + `client_id IS NULL` (the same value its writers stamp), does
  no memory work with no workspace, scopes the 7-day preference de-dupe the same way, and drops a memory
  block read in a different workspace than the turn's persona resolved (still latching the turn's
  scope re-check, on client turns as well). `useClientChatContext` filters its own-memory line to
  `current_user_tenant_id()` + `client_id IS NULL` and re-reads when the tab's active workspace changes
  (PaigeChat stays mounted across a switch), clearing the old block before the re-read starts so a
  message sent mid-read carries no context. Residual: a switch made in ANOTHER tab reaches an open chat
  only when that tab's tenant context re-reads (sign-in, token refresh or a new session — possibly up
  to about an hour later); until then its held block can still
  carry the earlier workspace's line as `clientContext`. Deploy order: migration and edge function may
  land in either order — both fail safe and recall-only (edge first: the 7-argument call errors, is
  logged, returns no semantic hits; migration first: the old call resolves to the new function with no
  workspace and returns no own rows). Proof: `supabase/tests/match_paige_memory_authz.sql` W-A…W-E,
  `test:client-memory-authz` §37 (37.1–37.17), the hook test
  `src/hooks/useClientChatContext.memory-scope.test.tsx` (6 tests). Production drive PROOF OWED.
- **Follow-ups (filed, not folded in):** GDPR bulk hard-delete of owner/prompt memory via
  `process-data-deletion` (self-serve `forget` ships now). `match_paige_owner_memory`'s NULL-tenant `=`
  filter is a documented latent trap for a future operator semantic-recall path (a DIFFERENT function /
  owner-memory audience — separate handoff, not folded into the R3a client-memory slice).

- **S5 AUDIENCE CUTOVER — SHIPPED + PRODUCTION VERIFIED (2026-10-07; #1788 merge `2c225d06`,
  #1801 merge `f6f9e384`; migrations `20270599000000` backfill + `20270599000001` retire, both
  applied):** the owner's own no-client memory lives in `paige_owner_memory` via the governed seam
  (all writes `proposed`, audience-tagged; `declared∧validated` scope authority per INT-326).
  Backfill proof: rerun-inserts-0 (unique partial index on `metadata->>'legacy_source_id'`; pgTAP
  `supabase/tests/s5_owner_memory_backfill.sql`), 11 rows / 3 humans / 2 tenants migrated with
  exact content/scope/timestamps, pre-existing rows unchanged by checksum. Production readback:
  11 migrated active (all proposed, 0 duplicates), 18 canonical active total, 0 active legacy
  rows with a live twin, all 12 historical explicit-signal source rows inactive (the 12th was
  already inactive with no twin and was correctly not migrated), no hard delete. Authenticated
  production drive 6/6 (canonical-only write, governed-read recall, workspace isolation with
  honest workspace-relative absence, client-in-focus unchanged, client-memory surface free of
  owner preferences, correction reflects immediately). Two independent review rounds on #1788
  (2 P1 + 6 P2, all fixed — the seam-whitelist gap they caught is now in-suite enforced via the
  harness fake) and one clean review on #1801. Owner two-workspace feel-check: ACCEPTANCE OWED
  (no engineering owed). Open boundaries, separately owned: INT-337 (workspace-shared business
  audience — the seam is strictly per-person today) and INT-070 (privacy deletion processor
  lifecycle; S5 closed only the store-coverage half).

**Cross-references:** §7 (memory is the moat) · §8 (Owner-Ops vs Client audiences) · §9/§51 (tenant
isolation) · §10 (callable seam) · §18 (one home) · §59 (in-body caller scope) · §26 (voyage-3 @1024,
the one embedding space) · `docs/doctrine/L8-memory-fabric-workstream.md` · `decision-log.md`
(Release C entry).
