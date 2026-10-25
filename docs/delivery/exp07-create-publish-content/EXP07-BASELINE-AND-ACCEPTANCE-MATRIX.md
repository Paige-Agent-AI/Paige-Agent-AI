# EXP07 — Create & Publish My Content: Baseline and Acceptance Matrix

**Owner authorization:** ANT-162 header, 2026-10-23 22:18 UTC — one new zCod EXP07 Engineering Lead.
**Receiving ACK:** ANT-162 comment `d8595a63`; lease cross-reference ANT-161 comment `7bedd649`.
**Baseline verified at:** main `2748432e1ab0c7c29a01b5c9516a8b68803e7844` (2026-10-23 18:08 −0400), worktree `Paige-EXP07`, branch `exp07-create-publish-content`.
**Mapped outcome:** FLOW:CONTENT (Map row 140). Aliases carried by this Experience: CAP-064, CAP-065, CAP-067, CAP-071, CAP-072, PCO-MKT-008/009/010/011/012/013/019, PCO-COMMERCE-009/010. This doc is the EXP07 view of those map rows — not a second capability inventory, denominator, or restoration scorecard.

The 18-row customer acceptance matrix from the assignment brief is reproduced below with existing proof, debt class, dependency owner, and proof plan. A related test or PR cannot close a whole row; statuses stay OPEN until the row's customer-visible proof exists. Founder evaluation is ONE complete integrated Experience evaluation, separate from PR delivery.

---

## 1. Retained-implementation register (verified at `2748432e1`)

Everything below is existing working source, to be reused — not rebuilt. "Missing proof" anywhere in this doc is a verification task, never permission to rebuild.

### Vibe Studio (the creative work surface)
- `src/solo/vibe.tsx` (overlay) + `src/solo/studio/*`: StudioHome (saved sessions), StudioSession, StudioStage, Timeline, PublishPanel, FormSettings, MediaTools, MediaApprovalCard, EmbedCode, `useStudioChat`, `studio-data.ts`, `artifact-state.ts`, `studio.css`; contract tests `studio-publish-door.contract.test.ts`, `studio-edge.contract.test.ts`, `studio-v0.contract.test.ts`, `studio-scope.test.ts` + render tests.
- **Sessions:** `createSession(brief)` / `openSession` / `renameSession` (`studio-data.ts`) — a Studio session already starts from a seed brief and is saved/reopenable.
- **Artifact kinds:** `form` (growth_forms), `page` (growth_pages), `funnel` (growth_funnels), `content`→image (marketing_content). `BuildShape` adds `sheet` for text-only outcomes.
- **Version history:** `list_artifact_versions` RPC + `restoreVersion` (`studio-data.ts:357,367`) — list/compare/restore per (session, kind, artifact) already exists.
- **Publication door:** `preparePublication` / `confirmPublication` (fingerprint → approve → redeem → verified readback) riding the ONE publish door `growth-publish-command` with `STUDIO_PUBLISH_KIT_BY_ACTION`; PublishAction = `publish | unpublish`. UI and Chat share this door.

### Saved content library (`marketing_content`)
- Kinds: copy (channels: email, social post, ad copy, §58 split), image, video, document (`marketing-content.tsx` CONTENT_KINDS; server-side kind filtering so the cap never hides a kind).
- RLS since `20270542000000`: tenant admin or platform owner; members who cannot read are told so, not shown an empty library.
- **Governed writers (all existing):** `paige-media` (image/video/audio jobs), `generate-image`, `export-document`, `paige-ai-chat` (text saves), `skill-forge`, `studio-learn-from-artifact`.
- The library footer states the current truth in-product: *"Posting, scheduling and a content calendar aren't connected yet: PAIGE drafts, and you post."*

### Media generation (server capability truth)
- `paige-media` + `paige-media-sweeper` + `paige-media-webhook`; `src/solo/useMediaJobs.ts` state machine: `created/blocked/submitted/processing/succeeded/failed/outcome_unknown/expired` + approval / decline / cancel actions; denial bodies (403/429/400: video-off, daily cap, budget exceeded) surfaced.
- `MediaTools.tsx`: composer with model/shape/length, client estimate labeled ≈ (server estimate authoritative at submit), provider budget/credits from server capability truth; **unconfigured provider renders an honest unavailable state** (FAL_KEY secret + prepaid ceiling + budget required). `MediaApprovalCard` = the requester-approval boundary. "Review ready" is never "published."

### Social foundation — DORMANT by design (Phase-0 containment)
- **`paige_social_posts` / `paige_social_accounts`** (`20270117000000_social_operations`): schema for a draft→preview→schedule→approve→publish→receipt pipeline, designed against spine capabilities (`social.post_draft/post_schedule/post_publish/accounts_read/analytics_read`) — **none of those capabilities was ever registered** (grep of `_shared/` returns nothing) and **no function writes these tables** (referenced only by `types.ts`, the unmounted `social-studio.tsx`, and the containment test).
- **`social-phase0-containment.test.ts` pins the containment:** Campaigns mounts the truth-oriented `Social` (social-command.tsx), never SocialStudio; settings must not connect accounts and must say "Publishing and analytics stay unavailable"; Chat's legacy social tools are removed and refused (`social_capability_unavailable`, "No Social provider action was attempted."); Agency fixtures must not render reach/engagement as evidence.
- Therefore the September map's absence claims are **current**: no connected-account publication path, no queue, no scheduler execution, no delivery proof. The "scheduled" status exists only as schema/affordance inside an unmounted component.

### Social connection lifecycle — LIVE schema, governed
- `paige_social_connections` + `paige_social_connection_attempts` (`20270127000000` + `...0100`): canonical tenant-owned connection lifecycle (`setup_required→authorizing→connected→needs_reauth→disconnected→error`), confirmation-linked, token-hash only (credentials via Vault reference, never stored raw).
- `paige-social` edge function actions: `start` / `select` / `decline` / `disconnect` — connect/select/disconnect are governed; there is **no publish action**.
- §38 capture-only handle truth: `social-truth.ts` + `20261210000000` (a handle on record is not a connection; no follower/reach/schedule is derived from it). `social-command.tsx` / `useSocialCommand.ts` state the platform holds no queue/schedule for a tenant.
- Connection semantics remain EXP10-owned (Vault/OAuth/provider authority); EXP07 renders readiness states and consumes registered connections only.

### Calendars
- `calendar-*` surfaces (calendar.tsx, calendar-book/team/settings/webinar/cfg) are the **appointment/booking calendar** (EXP05's Work/Planning world), not a content calendar. A demo suggestion card in `_shared.tsx` mentions "October content calendar (12 pieces)" as copy only — no surface exists behind it.

## 2. NET-NEW absence proofs (checks that demonstrated absence at `2748432e1`)

| Absent capability | Proof of absence |
|---|---|
| Social publishing execution (queue/scheduler/delivery) | Containment test pins refusal; no writer of `paige_social_posts`; no spine social capabilities; product footer declares it |
| Content calendar surface | grep `content_calendar` → only the honest footer + demo card copy; no table/UI/route |
| Clipping/repurposing of long-form media | no clip/segment surface in `src/solo/studio/*`, media jobs, or migrations |
| Voice/likeness consent records for audio/video | no consent columns/tables beside media jobs |
| Media licensing/rights/catalogue rows (CAP/PCO-COMMERCE-009/010) | no `license|rights` columns in `types.ts` for marketing/media/social tables |
| Audio job kind | `paige-media` capabilities cover image/video (verify audio in PR3); kinds in library are copy/image/video/document |
| Structured creative brief (audience/outcome/channel/deliverables/references/rights/budget) as saved/reopenable artifact | Studio seed brief is free text; no structured brief artifact/table found |

## 3. Open-PR collision register (refreshed 2026-10-23)

- **#2172 (E03), head `099419039`** — leases `src/solo/studio/FormSettings.tsx`, `growth-process-submission/*`, `src/solo/form-intake*`, `growth2.tsx`, migration `20271103140117`. EXP07 does not touch these; canonical form lead replies continue in EXP03's PR.
- **#2698 (EXP06 PR1)** — docs-only `docs/delivery/exp06-build-my-brand/`; no overlap.
- **#2191 (E04)** — leases `docs/brain/README.md`; the Studio-index docs correction (assignment §103) will be coordinated with its author + section owner before edit.
- **#2356** governance BRD owner-held. #2437/#2693 dependabot, no overlap.
- Shared-edit rule: before any edit to Vibe shell, NEXUS adoption, FormSettings/PublishPanel, publisher, media provider, shared schema/registry, or Brain/Master sections — inspect ANT-161 leases, name ONE implementing owner, post a bounded lease. EXP06 owns the in-progress NEXUS contextual adoption; EXP07 consumes one shared implementation.

## 4. Complete customer acceptance matrix (all statuses OPEN)

Debt classes: **VERIFY** (prove existing), **INTEGRATE** (wire existing pieces), **REPAIR** (fix defect in existing), **BUILD** (demonstrated absence → new, smallest coherent), **EXECUTE** (owner/customer action or live proof).

| # | Outcome (brief §) | Existing proof | Debt class / plan | Dependency |
|---|---|---|---|---|
| 1 | Brief and brand: capture audience/outcome/channel/deliverables/references/rights/budget; meaningful missing questions; save/reopen brief; reuse brand context, correct tenant scope; no EXP01/EXP06 overwrite | Studio seed brief (free text) + sessions saved/reopenable; brand floor (`loadBrand`); **PR5: composer "Add details" fields (audience/outcome/channel/deliverables/budget/references) compose into the one seed_brief; brief card pinned in the project so the brief survives reopen — first chat body verified to carry the composed brief (drive, fail-first); evidence docs/evidence/ui-delivery/exp07-brief.md (8 Solo viewport frames + composer/reopen/dark captures; 27/27)** | rights/budget captured as owner text only (no license/spend machinery — rows 12/13); authenticated owner drive owed post-merge | EXP06 brand intake boundary |
| 2 | Text: usable original blog/social/SEO/press/caption/strategy content, editable/revisable versions, honest source/factual uncertainty; not just an answer | `marketing_content` copy kind + chat writer + library render with channels | VERIFY copy save→edit→version path in Studio (artifact kinds exclude copy today); INTEGRATE copy as Studio artifact or equivalent governed path | — |
| 3 | Images: previewable/downloadable output, dimensions/format/source/rights, exact version linkage; eligible provider/model/budget/approval; unconfigured = unavailable | paige-media image jobs, MediaTools estimate/approval, FAL gate honest-unavailable, marketing_content image rows; **PR3: completion records mime_type + parsed pixel dimensions (PNG/JPEG/WebP byte headers, 4/4 Deno tests) beside the existing model/license metadata; version linkage verified (reuse_content_id + save_artifact_version); PR4: facts line surfaces it (format · dimensions · made by · license between shape and status; nothing invented when empty, malformed ignored) — evidence docs/evidence/ui-delivery/exp07-content-facts.md (8 Solo viewport harness frames + no-meta + dark; 26/26 drive, fail-first driven; authenticated owner drive owed post-merge)** | video fragments handled-but-undriven (no video metadata exists yet — recorded, not claimed) | — |
| 4 | Audio/video/clipping: playable artifacts, explicit supported formats/duration, source rights, voice/likeness consent; clipping retains source identity; unsupported states truthful | video job kind exists; `MediaTools` length/estimate for video; **audio/music is owner-locked OFF with truthful denial at every layer (server 403 `unavailable: "music"`, UI "deferred" pill + explanation) — verified, not a build item** | clipping/repurpose + voice/likeness consent records remain BUILD-if-needed (absence proven) | — |
| 5 | Critique/revision: useful quality critique vs brief, controlled edits, compare/reopen/restore, no unrelated mutation; exact-version approval invalidation | `list_artifact_versions` + `restoreVersion` exist for form/page/funnel/image; **PR2: copy refine-in-place via server-side on-canvas clamp + per-save version snapshots (save→revise→restore chain complete at source level)** | customer proof pending (row 16); REPAIR invalidation of stale approval on version change | — |
| 6 | Templates/reuse: canonical Studio reuse, tenant-safe template access/provenance, no cross-tenant copying | Studio saved sessions/artifacts; **PR6: is_template column + 'templates' list arm existed unconsumed (verified); shipped the missing set path — governed RPC `set_studio_session_template` (migration 20271113800010, isolated-DB authority proof incl. role gate / owner-or-admin predicate / tenant wall, each mutation-proven) + "Save as template" in the project + "Start from a template" picker on home (brief-seeded only — nothing copied); evidence docs/evidence/ui-delivery/exp07-template.md (8 Solo frames + home/started/empty captures, 30/30 drive, fail-first 6/14)** | authenticated owner/teammate round-trip owed post-merge | — |
| 7 | Library/export: find asset later, save/reopen after sign-out, export real file w/ MIME/filename, authorized storage, expired-link recovery | `marketing_content` library + `export-document`; **PR2: Studio sessions save/reopen copy artifacts with version lineage (versions>1 render in Timeline)** | VERIFY export MIME/filename + expired-link recovery path | — |
| 8 | Content calendar: dated channel-specific plan, timezone/DST/conflict/approval state; edit/cancel no duplicate scheduled posts | **PR7: Marketing → Calendar tab SHIPPED at source — content_plan_entries (RPC-only, RLS zero-policy) + upsert/list in the CONTENT authority family; agenda grouped by local day, tz-aware instants, linked saved pieces, planned/ready/cancelled statuses with strike-through; the boundary line is ON the surface (nothing schedules; exact send times only if/when scheduling is connected); edit/cancel re-upsert the SAME row — nothing to duplicate; SQL proof (write gate/tenant wall/piece-link, 3 mutation proofs) + drive 53/53 fail-first 52/53; evidence docs/evidence/ui-delivery/exp07-calendar.md** | conflict detection deferred to scheduling authorization (EXP05) — the plan overlaps nothing today; authenticated owner drive owed post-merge | EXP05 |
| 9 | Channel readiness: account-on-record vs connected/eligible vs revoked/limited; correct identity, least privilege; no silent substitute | `paige-social` lifecycle + `paige_social_connections` states + §38 truth | VERIFY readiness rendering vs lifecycle states; connection semantics consumed | EXP10 |
| 10 | Approve/publish: review exact asset/version/caption/destination/time/cost; original actor approval; ONE governed door; authority rechecked; provider receipt + readback; draft/scheduled/published/observed separate | Publish door exists for site artifacts; social publishing contained (dormant design names `social.post_publish`, unregistered) | BUILD governed social-publication door (registration + approval + receipt), activation owner-gated | EXP10; owner |
| 11 | Failure/recovery: cancel/timeout/lost-ACK/rate-limit/revoked-permission/duplicate-click/stale-revision/late-callback reload; reconcile before retry; no double charge/post | useMediaJobs unknown/expired/cancel states; **PR3 verified structurally: completion is idempotent by job id (duplicate provider callbacks no-op), the job rail re-lists after reload (10s poll + realtime backstop while in flight), sweeper owns expiry, outcome_unknown reconcile-before-retry with credits released/replayed** | live incident + customer-proof legs stay with row 16 | — |
| 12 | Campaign/website integration: EXP03 attaches original creative; EXP06 uses same artifact/version; permitted UTM/source reach canonical attribution | EXP03 S1 attribution/route proof merged; embed #2088 | INTEGRATE identity handoff (asset/version/rights/approval) with owning leads; no conversion claim from render | EXP03, EXP06 |
| 13 | Rights/catalogue: licensing rows require attributable license/usage boundary + permitted catalogue artifact; no checkout/payment/legal certification | Absent (proven, §2) | BUILD licensing/catalogue rows (content ownership claims need proof); commerce stays EXP04/held-EXP16 | EXP04 |
| 14 | Privacy/negative authority: revoked-role cohort checks; no foreign artifact/URL/secret leakage; no client publication authority from public link; no Operator blanket private access; credentials never in client/log/screenshots | Tenant RLS walls exist throughout | VERIFY per-artifact + cohort checks; negative tests | — |
| 15 | Experience quality: all states (populated/empty/loading/error/refused/unavailable/progress), desktop/mobile, keyboard/focus, light/dark, readable previews; preserve approved Vibe layout; material redesign via owner design process | Studio states largely present (MediaTools unavailable state exemplary) | VERIFY full-state coverage per surface; Impeccable gate before UI edits | owner design process |
| 16 | Customer proof: actual ordinary authorized customer create→revise→save→approve→publish/readback→reopen/recovery on owner-designated existing account; synthetic proof separately labeled; no new QA tenant | None yet | EXECUTE after engineering rows; no-send/spend safeguards | owner account |
| 17 | Release: small PRs, changed-path/regression/negative tests, independent review where available, exact-head CI/security gates, no waived checks; preserve failures | Standing policy | EXECUTE per PR | — |
| 18 | Final evaluation: ONE full integrated founder evaluation, complete matrix + demonstrated limits | None yet | EXECUTE at completion | owner |

## 5. WEB-01..14 applicability + algorithm register

- **WEB01–14:** accepted as applicable controls for EXP07 wherever a creative artifact reaches a public destination. EXP06 owns website delivery; EXP07 consumes approved destinations and returns artifact/version identity. WEB controls that concern hosting/DNS/TLS are consumed from EXP06's surface, not duplicated.
- **SAAS-01–24:** applied-with-proof rule; no availability promotion from staffing/source/CI alone.
- **Algorithm support (actual maturity, per canonical register):**
  - ALG-08 Scheduling/workload — **Dark foundation**; only through EXP05 constraints; not proof of scheduled social posting.
  - ALG-09 Marketing attribution/allocation — **Unverified**; EXP07 consumes observed publication/source/conversion lineage; never invents media ROI.
  - ALG-10 Communication timing/channel — **Partial connection sources**; publication channel case proven separately.
  - ALG-11 Model quality/cost — AI-2 foundation / AI-3 partial. ALG-12 anomaly detection — Partial. ALG-01 reconciliation — P1 production issue/acceptance owed. ALG-13 recommendations — Unverified.
  - Creative generation is not automatically a supporting optimization algorithm. Where no verified support exists for an outcome: **NO VERIFIED SUPPORTING ALGORITHM IDENTIFIED — GAP OR VERIFICATION OWED.** Per-outcome signal/logic/output/seam/test/customer-evidence/maturity will be recorded as rows are worked.

## 6. Delivery sequence (small coherent PRs; re-planned on evidence, not line counts)

1. **PR1 (this doc)** — baseline + matrix + leases + register. Docs-only.
2. **PR2 — matrix rows 5/7 spine:** one complete saved→reopened→revised text/copy artifact with exact version linkage in existing Studio (VERIFY then INTEGRATE/REPAIR; smallest BUILD only where absence proven).
3. **PR3 — media rows 3/4/11:** budget/job/rights-metadata/recovery verification and repair (audio support check, dimensions/format metadata, late-callback reload).
4. **PR4 — row 3 surfacing (inserted, evidence-gated UI):** generated-asset facts line in the Content library preview (PR3 recorded the metadata; the owner's 2026-10-19 rule forbids leaving it invisible). Evidence record + 8-viewport harness drive; merged as the first UI PR of the lane.
5. **PR5 — row 1 (this PR):** structured brief capture in the existing composer + the pinned brief card (save/reopen). One stored value, no migration.
6. **PR6 — row 6 (SHIPPED, pending merge):** templates/reuse — VERIFIED at PR5 time: `list_studio_sessions(p_filter:'templates')` + `is_template` column exist with NO UI consumer and NO post-creation set path (`set_studio_session_starred` exists, also unconsumed) ⇒ smallest BUILD: one new owner-gated RPC (`set_studio_session_template`, mirroring starred's shape) + save-as-template + template picker; tenant-wall tests.
7. **PR7 — row 8 (SHIPPED, pending merge):** content calendar planning UX (no scheduler; EXP05 for consequential execution).
8. **PR8 — rows 9/10:** channel-readiness rendering + governed social-publication door (registration/approval/receipt); **activation owner-gated** (no provider purchase/OAuth/publication).
9. **PR9 — row 12/13:** EXP03/06 identity handoff + licensing/catalogue rows.
10. **PR10 — rows 14/15 + joined recovery:** privacy negative tests, full-state quality/device/security sweep, matrix closure evidence; then rows 16/18 customer proof + founder evaluation (separately evidenced).

Standing gates restated: no second Studio/publish door/registry/scheduler/approval inbox/asset store; no provider purchase/activation, new OAuth, public publication, external send, ad spend, or held-Experience activation from engineering assignment; exact-head CI/security gates unchanged; failures preserved; owner held-Experience and spend decisions remain owner-held.

---

*EXP07 label: all comments on this lane are labeled EXP07 explicitly. Canonical register/locks/Map deltas are posted as precise row/cell deltas + evidence in ANT-162 for Coordinator write/readback (Sheets owner-session-only from this environment). docs/brain/README.md Studio-index correction (assignment §103) owed after coordination with the section owner and #2191's author.*
