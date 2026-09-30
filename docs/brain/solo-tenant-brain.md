# Solo Tenant Brain

## Boundary

The Solo Tenant Brain is a governed composition of one top-level standalone Solo business's canonical records. It is not a new database, a transcript store, the Platform Brain, the Command Center Mind tab, or a second approval system.

Platform Brain knowledge may inform every tenant. Raw tenant/client material never flows to Platform Brain or another tenant except through separately approved, audited support access or an approved anonymized/aggregate-learning contract.

The governing chain is:

`canonical source → server-resolved tenant scope → safe Paige context → action authority → governed action → verified outcome → Rail evidence → Mind eligibility → Memory retention/revision/revocation`

Every lane remains unavailable at the first stage it cannot prove. Chat prose can propose a fact; it cannot become durable truth without the owning canonical record, confirmation and provenance.

## First vertical slice — Business Mission

Current source implementation:

- `supabase/functions/_shared/business-mission-tenant-brain.ts`
- `supabase/functions/paige-ai-chat/index.ts`
- existing Mission RPCs from `20260905221203_business_mission_foundation.sql`
- thread-selected Mission read from `20270101000000_paige_thread_business_mission_context.sql`
- existing Spine declarations in `supabase/functions/_shared/paige-spine/domains/business_mission.ts`
- existing `record_capability_run` Rail writer

Flow before and after the existing chat-canonical authority/confirmation gate releases a Mission tool:

1. Resolve `current_user_tenant_id()` through the caller-JWT client.
2. When a persisted Paige thread is active, `public.get_paige_thread_business_mission` derives the owner and active tenant in-body and selects the most recently updated Mission canonically linked by `request_thread_id`. The thread UUID is a locator, never tenant authority.
3. Put the selected Mission's source/ref, revision, lifecycle, freshness and full current editable brief into a bounded system context. Full brief fields are necessary so a one-field revision preserves untouched canonical values. Field contents are data, not instructions; `owner_authority` is explicitly documentary and never a runtime grant.
4. For revise/transition, resolve the selected Mission again through `public.get_business_mission` immediately before the write. The existing RPC, not a premature client check, distinguishes stale new work from a same-request receipt replay.
5. Execute the existing create/revise/transition RPC through the caller-JWT client. Those RPCs re-enforce top-level Solo ownership, tenant, lifecycle, expected revision and idempotency.
6. Resolve the active tenant again after the write; a switch stops readback/Rail attribution and returns outcome-unknown.
7. Re-read `public.get_business_mission` under the current caller scope.
8. Match canonical Mission id, revision, lifecycle, brief version and every normalized persisted field, including revision reason and explicit lifecycle clears. A missing/failed/mismatched readback writes no Rail and cannot claim success.
9. Only after a match, call the existing `record_capability_run` (service-role-only on its 6-argument signature; the 10-argument overload added by `20270107000000` shipped with no ACL and defaults to `EXECUTE TO PUBLIC` — `20270416000000` revokes it, MEASURED 2026-09-24: prod already service-role-only on both signatures; the hole is not live and the migration makes that lock reproducible) with the Mission request UUID as the stable run id.
10. Return a compact verified outcome context containing source, source reference, revision, lifecycle, source update time, observation time and `current_canonical_revision` freshness.

`freshness=current_canonical_revision` means that exact revision was just read from the canonical projector. It does not claim the owner's Mission content is objectively recent or correct.

## Authority state

Mission create/revise/transition remain `high`, `chat-canonical` capabilities and continue through the one approval gate. The merged policy-aware resolver (`resolve_execution_autonomy`, RE-2 PR-2) is intentionally dark with no runtime producer. This slice does not wire or reinterpret it. Consequently, Mission standing-delegated auto-execution remains unavailable; confirmation is the real reachable lane.

## Mind and Memory

- **Mind: `UNAVAILABLE`.** No Mission Mind resolver or eligibility path is added.
- **Memory: `UNAVAILABLE`.** No `paige_owner_memory` or `client_memory` write is added. Paige must not say she learned or remembered a Mission from this slice.
- Rail records that Paige completed a governed Mission-record capability after canonical verification. It does not prove business work, external action, provider response, revenue, campaign execution or client outcome.

## Truth and failure behavior

- A database error returned by a Mission RPC is a failed/refused mutation and emits no Rail.
- A transport loss around the mutation is outcome-unknown; the user is told to reopen the canonical Mission before retrying.
- A post-write read failure or mismatch means the mutation may have persisted, but no success or Rail claim is emitted.
- A verified Mission remains verified if the non-transactional Rail write fails; the response states `railRecorded=false` rather than reversing history or claiming complete evidence.
- Replaying the same Mission request reuses the request UUID as the Rail run id, allowing the existing unique event identity to collapse a duplicate record.
- Workspace switch, role loss and cross-tenant selection fail through the pre/post tenant checks and each Mission projector's in-body authorization.

## Current state

`PARTIAL`.

PR #1016 is deployed at merge SHA `68d7c10f4381dd66a5d930d82f9400d004d189b5`: the persisted migration verification and affected edge-function deployment succeeded, and both live markers moved to that SHA at the #1016 closeout. Current markers after the later main-history M1-a migration (#1014) are `edge-live=68d7c10f4381dd66a5d930d82f9400d004d189b5` and `db-live=94e08d8bee6bd552a0b70b93960ff678fc3b9afc`; the database marker is a descendant and includes the Mission migration. Closeout PR #1018 deployed the web/docs revision `19fc0270bc40e0f70d95baf667c4917762aa5615`. Automated/database proof covers server tenant resolution, persisted-thread Mission selection before reasoning, empty/denied/mismatched reads, one-field-safe full brief context, create/revise/transition readback, exact normalized persisted-field matching, workspace-switch refusal, receipt replay/Rail recovery, Rail ordering, Rail failure honesty and the absence of Mind/Memory writes. Authenticated Solo-owner, denied-role, cross-tenant, canonical production Mission-row and matching Rail-row/read-projection proof remain `PROOF OWED` against the Mission edge runtime.

The owner-mandated Integration Capability Registry is now live on main (#1019). Its controlling `excluded_delivery_infrastructure` contract explicitly places Supabase, Vercel and GitHub delivery under `config-registry.md`, not under a tenant-capability provider entry. This slice adds no customer provider integration, connection scope or external provider action, so no provider entry is changed and no duplicate infrastructure entry is created. Any later provider-facing Tenant Brain lane must read and update its actual provider entry in the same delivery.

This one vertical slice does not make the Solo Tenant Brain complete. Campaign Briefs, tenant Knowledge, role/team context, client/engagement context, Public Presence, governed Memory promotion/revocation, Mind eligibility and Vault fact promotion remain later bounded lanes.


## Owner-complete Business Game Plan vertical — released MVP, 2026-09-06

The earlier Business Mission closeout remains historical truth: its deployed canonical Mission mutation, verified readback and post-verification Rail contracts are `LIVE`. Owner direction now makes the existing Command Center Business Game Plan the required product experience. The released owner vertical:

- preserves the existing owner Plan Brief for annual direction, current-quarter focus, desired outcome, success criteria, constraints, Paige operating guidance and prohibited assumptions;
- replaces the unrelated right-column dependency/activity material with `Plan in Motion`, backed only by canonical Business Missions and labelled as Strategic Plays;
- supports draft, Paige-proposed awaiting approval, active, blocked, paused, complete and archived states without inventing progress or business outcomes;
- gives the verified Solo owner one drawer to create, review, revise, approve, decline, pause, resume, truthfully complete and archive a play; archive is a lifecycle transition that preserves prior completion evidence, never a delete;
- sends only a tenant-stamped Mission UUID to the existing dedicated Paige workspace, where the active tenant and selected Mission are resolved again server-side; an invalid or foreign selection is refused;
- shares the existing Mission mutation/readback/Rail helper between the owner UI action door and Paige, so success is not shown until canonical persistence is re-read and matched, and Rail is emitted only after that match.

This candidate adds no Mission store, chat, approval system, Mind projection or Memory write. The backend foundation remains `LIVE`; the owner-complete Business Game Plan surface and overall Solo Tenant Brain remain `PARTIAL` until release plus authenticated proof. Signed-in create/edit/approval/refusal/pause/resume/complete/archive, workspace-switch, denied-role, canonical-row and matching-Rail-row browser evidence are `PROOF OWED`. Mission Mind and durable Memory remain `UNAVAILABLE`.

## Owner-complete candidate evidence — 2026-09-06

The current-main-composed candidate passes 73 focused contract tests, the complete 265-file / 3,832-test repository run, the TypeScript ratchet, production build, security/registry ledgers, and 198 real-component responsive/theme/state checks. Those renders use fictional provider stubs and prove structure and geometry only. Authenticated owner lifecycle, refusal, workspace-switch, canonical Mission and matching Rail evidence remain PROOF OWED; the owner-complete Business Game Plan and Solo Tenant Brain remain PARTIAL; Mission Mind and durable Memory remain UNAVAILABLE.

PR #1038 rebased cleanly onto main `49d25f4c`, passed every required pre-merge check at head `efad4044`, and squash-merged as `cc1e86f512dbaf795f26444b57fa8c8bcce56d63`. Production migration run 34078642940 applied and persisted `20260907001343`; Edge run 34078642934 deployed `business-mission-action` and `paige-ai-chat`; `db-live` and `edge-live` both point to `cc1e86f5`. Both production version endpoints returned `cc1e86f512dbaf795f26444b57fa8c8bcce56d63-mtqnw05p`. This proves release infrastructure, not authenticated owner behavior. Business Game Plan and the Solo Tenant Brain remain `PARTIAL`; Mission Mind and durable Memory remain `UNAVAILABLE`; authenticated owner, denied-role, workspace-switch, canonical Mission and matching Rail browser proof remain `PROOF OWED`.

## Verified Campaign Brief with Paige — active MVP, 2026-09-07

This is the next bounded owner-visible Tenant Brain lane. It reuses the dedicated Paige workspace, the existing Campaigns Campaign Brief card, the existing ordinary-action authority and confirmation gate, `configure_campaign_brief`, `get_campaign_briefs`, the command-result receipt table and the workspace Rail. It creates no new screen, record store, chat, approval system, Campaigns lifecycle action, Mind projection or Memory writer.

A create or revision is successful only when Paige has re-resolved the active tenant after the write, freshly reopened the canonical brief, and matched the exact brief id, returned version, lifecycle and all intended fields. The Rail write happens after that comparison. Missing, foreign, stale, denied, ambiguous, unknown-write, failed-read, mismatched-read and workspace-change paths fail closed and never emit a successful Rail outcome. If canonical verification succeeds but Rail recording fails, the record is truthfully reported as changed while the end-to-end operation remains incomplete.

Rail wording is limited to a Campaign Brief planning record verified as created or revised. It is never evidence that a campaign launched, published, spent money, performed or completed. Raw chat remains a proposal/input rather than durable truth; the canonical record and receipt carry provenance.

Current candidate boundary:

- Campaign Brief verified create/revise plus post-readback Rail backend lane: `LIVE` in production; the owner-visible vertical remains `PARTIAL` pending authenticated proof.
- Authenticated owner production proof: `PROOF OWED`.
- Solo Tenant Brain overall: `PARTIAL`.
- Campaign Brief Mind and durable Memory: `UNAVAILABLE`.
- Secure Browser/Browserbase: unchanged; Browserbase remains `PROPOSED`, prohibited and unwired, and credentialed browser use remains `UNAVAILABLE`.

Candidate proof is 38/38 focused tests, 161/161 adjacent-workstream regressions, a clean independent review, unchanged TypeScript ratchet, successful production build, security/governance/registry checks, a clean sensitive-data diff scan, and direct isolated PostgreSQL migration/readback proof. The full repository run passed 3,898/3,900 under parallel load; the two five-second repository-scan timeouts passed 21/21 immediately in isolation. PR #917's current head already conflicts with untouched current main in the same shared files, so this slice does not take or silently reconcile its orchestration ownership.

Production closeout: PR #1047 supporting review-history head `8c9bf37f` passed required checks and clean re-review, then squash-merged as the referenced production build `ae0a16a0d5147a4652a06925356c427c4d543d56`. Migration run 34150733491 persisted `20270105000000_campaign_brief_verified_rail_copy.sql`; Edge run 34150733561 deployed `paige-ai-chat`; merge-time CI 34150733476, Spine 34150733506, Security 34150733474 and UI evidence 34150733493 passed; `db-live` and `edge-live` equal the merge; both production hosts return build `ae0a16a0d5147a4652a06925356c427c4d543d56-mtrk6vbx`. Authenticated owner proof remains `PROOF OWED`, so the owner-visible lane and Solo Tenant Brain remain `PARTIAL`; Mind and durable Memory remain `UNAVAILABLE`. Recovery is forward-fix/redeploy; applied migrations and tenant records are never rewritten or deleted.
