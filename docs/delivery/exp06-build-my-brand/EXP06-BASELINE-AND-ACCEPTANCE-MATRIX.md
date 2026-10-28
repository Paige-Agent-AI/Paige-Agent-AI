# EXP06 — Build My Brand & Online Presence: Baseline & Customer Acceptance Matrix

**Status:** owning delivery evidence for the EXP06 workstream, recorded at assignment
(2026-10-23). **Corrected 2026-10-28 per owner `88b2f756`/`350e030f`: implementation is
OPEN — row 11 (hosting executor/HTTPS verification/usage-meter writer) is actively being
built within existing authority with provider activation HELD, and rows 19/20 (both-chat
and customer proof) remain open; "engineering complete" is retracted.** This document
holds the complete customer acceptance matrix and the WEB-control applicability register
for EXP06. It is the EXP06 view of the single Capability Outcome Map (direct mapped
outcome **FLOW:BRAND**, row 139, retained title *"Build the brand and publish the
business website, pages and public presence."*) — not a second capability inventory.
Owner authorization: ANT-162 header (2026-10-23), full assignment brief owner-pasted to
the lead session; RECEIVING ACK posted on ANT-162 (comment `5da8bf50`).

**Grounding:** actual `main` `89e48402c` (2026-10-23), one merge (two commits) past the
coordinator audit pin `a9bd855c1`. Worktree branch `exp06-build-my-brand`. All "present"
claims below were verified by reading current main source; all "absent" claims carry
the check that demonstrated absence.

**Boundary qualifications (from the ACK, binding):** the controlling Google
Docs/register/outcome-map sheets are owner-session-authenticated and were read through
the owner-pasted brief, ANT-161/162 and repo mirrors; lock/register/map updates route
through ANT-162 for the Coordinator. WEB-05 provider authority (Cloudflare
account/token/spend) is owner-held. EXP03 producer contract (ANT-87) is unactivated;
EXP06 consumes current embed/CRM attribution source. Managed many-customer hosting is
a separate owner decision. E16 checkout (PCO-COMMERCE-004) is not EXP06 payment
authority. No fabricated traffic/conversion/attribution/ROI, ever.

---

## 1. Source baseline at assignment

### 1.1 Retained implementation (verified present at `89e48402c`; PRESERVE)

| Asset | Home | Binding note |
|---|---|---|
| Vibe Studio overlay | `src/solo/vibe.tsx` → `src/solo/studio/*` (StudioHome, StudioSession, StudioStage, Timeline, PublishPanel, FormSettings, useStudioChat, studio-data, artifact-state, MediaTools, EmbedCode) | Owner-locked layout C; one Publish; no artifact-type preclassification, no second builder |
| The ONE publish door | `supabase/functions/growth-publish-command` + `_shared/growth-publish-command/door.ts`, declarations `STUDIO_PUBLISH_KIT_BY_ACTION` (`_shared/paige-spine/domains/studio_publish.ts`) | V2b owner ruling 2026-10-04; UI and Chat share it; fingerprint→owner approval→redeem→verified public readback |
| Spine growth domains | `_shared/paige-spine/domains/{growth_page,growth_form,growth_funnel,studio_image}.ts` | Real keys today: `growth_page.save/publish/unpublish`, `growth_form.save/publish`, `growth_funnel.build/publish/unpublish`, `studio_image.publish/unpublish` |
| Public surfaces | `/p/:tenantSlug/:pageSlug` (GrowthPageRenderer), `/form/:id` (GrowthFormRenderer), funnel renderer, `RenderFrame` (`src/pages/public/`) | Public renderers with retained tests |
| External-site embed | `public/embed.js` (E03 S2a, merged #2088) | Origin-validated postMessage, sandbox fallback, no Cloudflare account/token/domain migration |
| Public intake | `growth-public-submit`, `growth-public-visit` (verify_jwt=false) | submit: origin + bot-trap + rate gating, and the submission row stores `referrer`/`user_agent`. visit: DNT/GPC honored (not recorded), automated-agent gating, rate gating, no IP/UA/cookie stored. visit→submission linkage via `growth_public_visit_for_submission` |
| Tenant-domain spine | `docs/architecture/tenant-domain-and-communications-spine.md`; reserved `<slug>.paigeagent.ai`; `resolve_tenant_domain_identity` | slug is an address, never authority; reserved ≠ web_live ≠ outbound_ready ≠ inbound_ready |
| Brand floor | `peek_tenant_portal_brand` RPC → `loadBrand` in `studio-data.ts` | name/logo/`GrowthPageTheme` floor survive reload |
| Specialist roster | `VP_ROSTER` (`src/components/ui/page/PaigeAttribution.tsx`), typed edges `src/lib/paige/vpDepartments.ts`, doctrine `paige-c-suite-roster.md#specialist-identity-and-department-attribution` | Owner standard Oct 23 2026; EXP06 is a named NEXUS adoption owner; contextual verbs only, no second runtime |
| Binding ledger | `docs/binding-ledger/surface-binding-ledger.json` row `campaigns.vibe-studio` | consequential; chain PARTIAL; authority runtime-enforced (V1) |
| Test wall | `studio-publish-capability`, `studio-publish-door.contract`, `growth-publish-door{,-unpublish,-review}`, `growth-publish-chat`, `growth-public-visit`, `public-form-intake-contract`, renderer/EmbedCode tests; migration `20270554000000_studio_publish_door_only` | denial/authority/load-bearing cases stay |

### 1.2 Confirmed absent → NET-NEW (absence demonstrated 2026-10-23)

| Gap | Check performed | WEB |
|---|---|---|
| Portable public HTML/CSS/JS/assets export | repo-wide grep `exportHtml\|export_html\|htmlExport\|site-export\|exportBundle` + studio-file scan: zero matches | WEB-04 |
| External hosting deployment | `docs/integration-registry/integration-capability-registry.json`: no Cloudflare/DNS/host/Namecheap/GoDaddy/Squarespace/Porkbun/Wix entry; no deploy code | WEB-05 |
| DNS guidance product surface (six providers incl. WIX) | no product surface; guidance exists only in spine doc + Linear | WEB-06 |
| HTTPS/TLS verification tooling | `web_live` vocabulary exists; no verification/checker implementation | WEB-07 |
| NEXUS attribution in Vibe Studio | `grep NEXUS src/solo/` matches only `social-studio.tsx` and the sub-agents roster adapter `data/useSoloSubagents.ts`; studio components clean | §5 owner outcome |
| Full published-page SEO metadata | `GrowthPageRenderer` sets a per-page `document.title` only; description/OG/canonical/sitemap/robots metadata absent (`PageHead` serves platform marketing pages only) | WEB-12 (BUILD/EXTEND, not from-zero) |

### 1.3 Collision register (open PRs at assignment; holds respected)

- **#2172** (E03 journey) touches `src/solo/studio/FormSettings.tsx` and
  `growth-process-submission/*` — re-ground via ANT-161 before any edit there.
- #2356 (owner governance BRD), #2156/#1321/#1315 (protected shared work): untouched.
- E01 #2657 had no file overlap with the studio path and merged before this document
  was committed (`2748432e1`); listed here only so the register's at-ACK snapshot is
  reconciled. E02/E04/E09 codex PRs: different subdirectories; no file overlap with
  the studio website/publish path.

---

## 2. Complete customer acceptance matrix (21 rows: original 18 + row 19 both-chats 2026-10-27, row 20 agentic A–H mandate b261cc11, row 21 sandbox mandate ae670ada; kept through completion)

Debt classes: **VERIFY** (prove on current source), **REPAIR**, **INTEGRATE**,
**BUILD** (net-new), **EXECUTE** (planned action, not code). Every row closes only
with exact source/release identity + relevant legitimate runtime evidence;
`PROOF OWED`/`UNVERIFIED`/`BLOCKED` stay labeled, never silently passed.

| # | Required customer outcome | Existing proof | Debt | Dependency owner | Plan / proof |
|---|---|---|---|---|---|
| 1 | Entry from canonical SOLO/Vibe or contextual PAIGE handoff; correct tenant/actor/role; same implementation for all eligible accounts | Studio entry + server-resolved workspace (retained) | VERIFY | — | PR3 authenticated entry/reopen QA on existing eligible account; no account branch |
| 2 | Brand intake reviews confirmed business/brand/offer sources; saves only explicit truth; logo/color/type/voice/rights/context survive reload/reopen without altering commercial terms | brand floor (`peek_tenant_portal_brand`); EXP01 confirmed facts exist | BUILD (voice/rights/offer-conflict intake) + VERIFY (persistence) | EXP01 (facts), EXP07 (approved brand assets consumed, not produced) | PR3; persistence + conflict surfacing tests; commercial terms untouched (E04 writer) |
| 3 | NEXUS attribution/contextual entry visible + accurate across desktop/narrow/keyboard; original conversation/drafts preserved; unavailable states honest | VP_ROSTER + doctrine exist; absent in Studio (1.2) | BUILD | EXP06 (adoption); EXP07 future reuse | PR2; truthful labels ("Plan with NEXUS"/"Review with NEXUS"), actual context, editable handoff; no generation claims; tests assert roster fidelity + no authority implication |
| 4 | Create/revise saved site/page/funnel/form artifacts with original IDs/versions; stage previews show real saved work, responsive layout, working nav/links/forms | studio_sessions/artifact_versions + renderers (retained) | VERIFY | — | PR3/PR4; authenticated authoring + preview QA |
| 5 | Owner inspects exact version/changes/public audience/address/cost before approval; stale approval, changed artifact/role/tenant, denied/revoked/withdrawn approval cannot publish; no bypass via RPC/Chat/alternate producer | publish door fingerprint→approve→redeem + denial test wall (retained) | VERIFY (+REPAIR if drift found) | — | PR4; retained negative suite re-run on exact head; direct-RPC bypass attempt stays refused |
| 6 | Approved publishing proves actual URL + exact content/status + canonical actor/tenant/receipt/Rail; draft/reserved/DNS-only/provider-accepted never render as "live" without public HTTPS readback | door readback contract (V2b/V2b1 evidence docs) | VERIFY + INTEGRATE (Rail view completeness) | — | PR4; live publish on existing eligible account w/ HTTPS readback; states stay distinct |
| 7 | Revisions, unpublish, restore/republication, interrupted/lost-ACK/timeout keep canonical identity; unknown stays unknown; inspect before repeat | unpublish/restore door paths + door-review tests (retained) | VERIFY | — | PR4; interrupt/timeout/unknown-outcome paths exercised; no blind replay |
| 8 | Existing-site mode: embed original form on permitted external host without migration/token; attribution whitelist, validation, CSP/sandbox fallback, mobile sizing, unpublish behavior; one real submission→canonical source, correct tenant, no accidental sends | `public/embed.js` + S2a acceptance package (A–E; E UNVERIFIED pending owner own-site test) | VERIFY/refresh | EXP03 producer (ANT-87) for future attribution depth | PR5; re-proof A–D on current main; E stays UNVERIFIED until owner's own-site leg |
| 9 | Domain/hosting: registrar vs authoritative DNS vs host distinguished; six guidance profiles; truthful TXT/CNAME/SSL pending/conflict/revocation; email/NS/DNSSEC/existing content preserved; reserved address serves no content; real change needs exact authority | vocabulary + spine doc only | BUILD (guidance surface + state model) | EXP10 (connection semantics, ANT-164); owner (any real DNS/provider effect) | PR7; deterministic state checks + guidance content; no provider mutation from EXP06 |
| 10 | Portable public export: real versioned HTML/CSS/JS/assets; reproduce rendering/links/accessibility/SEO; exclude secrets/private records/unsafe execution; verify asset provenance; source lineage preserved; provider deployment distinct from download | none (1.2) | BUILD | — | PR6; export from canonical published artifact; negative tests: no private data, no secrets, no unsafe execution |
| 11 | Approved host path: scoped external hosting where authorized; real deployment/version/address/status/rollback + transparent cost owner; absent access/budget = exact blocker, no mock URL | PR7 guidance + truthful states shipped; **executor/HTTPS-verify/metering writer NOT built** (per corrected packet; confirmed by owner `350e030f`) | **BUILD — implementation OPEN** (owner `88b2f756`, 2026-10-28: build within existing authority, provider activation HELD) | EXP06 (implementation); owner (activation: account identity + token via EXP10 custody — ONE concrete decision at that point); EXP10 (provider registry entry when activated); migration queues behind EXP08 #3016 (`7ec6d149`) | Door-shaped executor (deploy/verify/recover/status) consuming an approved export after the workspace owner's own approval card; real HTTPS verification vs the export manifest before any live claim; usage-meter writer to canonical `platform_usage_events` (no second ledger); ships DORMANT-FAIL-CLOSED (no token exists → every path returns the honest "not switched on" state); live deployment proof stays BLOCKED-by-design until the owner's activation decision |
| 12 | SEO/public quality: titles/descriptions/headings, accessible names/contrast/focus/alt/labels/errors, responsive, robots/canonical/sitemap as applicable, safe asset/render/embed policy, abuse/spam/bot/duplicate controls, bounded costs; no ranking promise | partial (intake rate/agent gating retained) | BUILD/EXTEND | — | PR8; per-artifact SEO fields + a11y pass; no ranking claims |
| 13 | Security: role matrix (owner/admin/member/foreign/revoked), session/object/version/private-storage grants, expired links, forged host/tenant/artifact IDs, workspace switch A→B→A + late responses, prompt/content injection, secret/PII-free public output; platform role ≠ tenant-private visibility | retained denial wall (publish door, studio scope, public intake contract) | EXTEND/VERIFY | — | PR8; new negatives for export/host/SEO surfaces; retained negatives re-run |
| 14 | Joined business outcome: permitted public visitor→consented form→canonical CRM/source attribution→E04 approved commercial handoff→E09 secure entry, original records; missing downstream proof stays visible | visit→submission→source linkage (retained) | INTEGRATE | EXP03 (producer), EXP04 (#2170/#2184 open), EXP09 (ANT-163) | PR5/PR8 interface integration only; never other domains' writers |
| 15 | Chat/eligible Live and native UI consume same capability/authority/readback; draft/proposed/approval/completed distinct; held modality = BLOCKED/UNAVAILABLE + prerequisite, not fake PASS | door shared by UI+Chat (retained) | VERIFY | — | PR4; chat-publish parity re-proof on current main |
| 16 | Later-session return, interruption, cancellation, role change, support recovery preserve draft/version/approval/receipt + explain next permitted step; Operator sees only authorized facts | draft continuity + receipts (retained) | VERIFY/EXTEND | Operator custodians (health view scope) | PR8; recovery QA incl. role-change mid-approval |
| 17 | UI proof: 1536×770, 1366×768, 1024×768, 900×1000, PAIGE open/closed + real phone widths; zoom/reflow/reduced-motion/keyboard/focus/scroll ownership; synthetic frames labeled; device/AT claims need real evidence | prior Studio evidence records (synthetic) | EXECUTE per standard | — | per-PR ui-delivery records; authenticated device claims only with real evidence |
| 18 | Release + completion: review per merge policy, exact-head CI (no waived failed Preview), migrations/current-main compat, safe merge/deploy + web/Edge/SQL readback, authorized ordinary QA; author-review labeled truthfully; founder acceptance = ONE complete integrated evaluation; broader launch held | standing policy | EXECUTE | owner (final acceptance; launch gate) | every PR; completion only at full-Experience evaluation |
| 19 | BOTH-CHATS reachability (owner directive 2026-10-27, ae482d19/650ca4eb/67f4c21c): NEXUS's applicable EXP06 capabilities reachable in PAIGE chat AND EXP08 Team Hub chat through the SAME door/approval/receipt paths, with authorization, useful result/receipt, reopen/resume and tenant/role/channel/revoke/unknown/no-duplicate recovery assessed per chat | PAIGE chat: BUILT (UI+Chat parity row 15; high-risk tools always cards, fingerprint authority, Rail receipts, full recovery wall — PR1–8 proven). Team Hub: NEXUS seated (A1a roster) but voice read-only (A1b) and tool admission/presentation UNBUILT | VERIFY (PAIGE chat) + COORDINATE (Team Hub) | EXP08 (A2 admission: capability_scope += growth publish kit, cards, result retrieval/reopen); EXP06 (canonical door/writer, handoff posted ANT-161 833d33b1) | Handoff posted with exact tool IDs + risk (8 high: growth_page/funnel/form publish+unpublish, studio_image publish/unpublish; 3 ordinary draft saves); channel=discuss only, act in asker's DM (business effect ≠ Operations-task proposal); door fingerprint stays the one approval authority; identity/backend neutrality NOT claimed as hub proof — admission/execution/retrieval proof owed to EXP08 A2. Goal-driven amendment c797df3b (21:52) received: NEXUS keeps the SAME identity; Suggest=publish-kit proposal, Prepare=draft/save (ordinary), Execute=publish (high-risk card, fingerprint = the approval) — standing-authority display/combined-plan checks are EXP08 A2/Trust owners' wiring, not this lane's; no EXP06 engineering opens before A2 admission exists |
| 20 | AGENTIC BEHAVIOR (owner mandate b261cc11, 2026-10-27): PAIGE/NEXUS carries an authorized customer goal to a useful verified outcome, subcases A–H, tested beyond happy path | Per-subcase below; evidence = PR1–8 source/release records | ASSESS (statuses recorded; authenticated proof owed) | EXP08 (goal-directed Team Hub wiring, A2/A1c); EXP05 (Work/Harness runtime states) | **A** understand/clarify only missing material facts: BUILT at source (brief intake asks name/audience/outcome only; chat brief-flow SSE steps show what's asked) — authenticated proof PROOF OWED. **B** scoped plan/choose original tools: BUILT at flow level (brief→draft→approve chain; native Studio capabilities, no second runtime) — PROOF OWED authenticated. **C** execute via original doors, single writers: BUILT (ONE publish door UI+Chat; cross-domain via leases/handoffs only). **D** inspect actual result/receipt, not dispatch: BUILT (verified public HTTPS readback before any "live" claim; Rail receipts). **E** durable work save/reopen/resume: BUILT (studio_sessions/artifact_versions; brand floor survives reload — tested). **F** failure/refusal/stale/revoked/unknown recovery, no duplicate effects: BUILT at door level (single-redeem fingerprint, nothing-ran codes, role-change-mid-approval test PR8). **G** independent follow-through without routine prompting: PARTIAL — inside an active Studio session the chat drives brief→draft→approval→verified-live multi-step without owner prompts, but no standing-goal/background autonomy exists (correctly none; that wiring is EXP08 amendment §4/EXP05 runtime — named dependency, not this lane's to build). **H** concrete reviewable question only beyond authority: BUILT (Needs-your-OK card names the exact pending decision; blocker copy names the next permitted step). Team-Hub goal-directed NEXUS: MISSING (EXP08 A2). Algorithm grounding: §4 stands — NO VERIFIED SUPPORTING ALGORITHM IDENTIFIED — GAP OR VERIFICATION OWED. |
| 21 | SANDBOX APPLICABILITY (owner mandate ae670ada, 2026-10-27): choose native capability vs isolated execution; untrusted-input boundaries; no unintended real effects | PR8 security negatives + retained denial wall | ASSESS (NOT APPLICABLE WITH REASON for isolated execution; boundaries verified) | — (future code-execution shapes: EXP19/ZION-under-PAIGE, held) | EXP06 surfaces execute NO untrusted code/files: page blocks render data-driven through React (no eval), forms are governed inputs (origin/bot-trap/rate gating retained), the export emits generated static bytes (negative tests: no private data, no secrets, no unsafe execution), guidance is read-only copy. Isolated execution: **NOT APPLICABLE WITH REASON** — no untrusted code/file/data execution exists in EXP06 outcomes today. Untrusted-content boundary (visitor input, hostile SEO fields): treated as inert data — PROVEN at source (hostile-SEO inert test; injection surfaces inert) — authenticated re-run PROOF OWED. A future custom-code/script block in pages would be **HELD** pending the isolated-execution owner (EXP19 general runner — UNVERIFIED/held per owner ae670ada); not buildable from this lane. Cross-tenant/task denial: retained RLS/scope negatives re-run green each PR. |

## 3. WEB controls applicability (WEB-01..14 all applicable or justified N/A)

| Control | State at baseline | EXP06 obligation |
|---|---|---|
| WEB-01 Studio/publisher reuse | retained, verified | reuse only; no second builder (matrix rows 1–4) |
| WEB-02 exact approved publish/unpublish + revision/rollback/readback | retained door | VERIFY + complete restore/recovery proof (rows 5–7) |
| WEB-03 existing-site embed + canonical form→CRM | retained (#2088) | refresh proof (row 8) |
| WEB-04 portable export | absent | BUILD (row 10) |
| WEB-05 customer-authorized external hosting | absent + no registry entry | readiness only; deploy owner-gated (row 11); missing registry entry recorded |
| WEB-06 authoritative DNS + six profiles | vocabulary only | BUILD guidance + truthful states (row 9) |
| WEB-07 HTTPS/TLS live readiness + failure/renewal evidence | absent | BUILD checker surface (row 9/11) |
| WEB-08 host→tenant→content correctness, no takeover/spoof/Portal leakage | host-routing spine retained (E09 slice H dormant) | EXTEND negatives (row 13) |
| WEB-09 email/Vault/DNS separation; preserve MX/SPF/DKIM/DMARC/NS/DNSSEC | spine rules retained | guidance must encode; no provider mutation (row 9) |
| WEB-10 source/campaign→asset→form→CRM/handoff | linkage retained | INTEGRATE (row 14) |
| WEB-11 Portal dependency EXP09/04, never private static export | E09 portal retained | export excludes private content (rows 10, 13); public links only to legitimate private entry |
| WEB-12 mobile/keyboard/a11y/SEO/CSP/abuse/cost/content quality | intake gating retained | BUILD/EXTEND (row 12) |
| WEB-13 honest draft/live/paused/unpublished lifecycle + scoped host costs | door states retained | lifecycle truthfulness incl. costs (rows 6, 11); managed hosting = separate owner decision |
| WEB-14 authorized Operator health/support/cost/incident trace without tenant-private escalation | operator surfaces exist elsewhere | VERIFY bounded facts only (row 16) |

SAAS-01–24: applied per-foundation-row with proof as touched; no blanket PASS.

## 4. Algorithm support (no verified supporting algorithm identified at assignment)

GAP OR VERIFICATION OWED — per assignment §8. Applicable candidates and their
current honest state: ALG-01 event-state reconciliation (bounded foundation; publish
door nothing-ran codes retained; global P1 debt not EXP06's to claim), ALG-02
first-value (canonical Unverified; a publish click is not business value), ALG-05/09
lead/conversion + attribution (Unverified; owned with EXP03/04 — no invented scores),
ALG-10 timing/channel (only on authorized channel/consent dependency), ALG-11 model
quality/cost (shared fabric; no per-call claims), ALG-12 exception detection (Partial;
real host/SSL/readback failure signals only, no monitoring claim without proof),
ALG-13 next-action (Unverified usefulness; suggestion executes nothing). Any EXP06
row records signals/logic/output/path/evidence or a justified N/A — never a fabricated
implementation.

## 5. Delivery sequence (small PRs; reorder by dependency without dropping scope)

PR1 this baseline+matrix → PR2 NEXUS contextual adoption → PR3 brand/artifact/revision
continuity → PR4 publish/unpublish/restore public-proof completeness → PR5
embed/CRM attribution re-proof → PR6 portable export (WEB-04) → PR7 hosting/domain
guidance + readiness (owner-gated deploy) → PR8 SEO/quality/security/device/joined
recovery. Each PR: exact-head CI, review per merge policy (non-author when practical,
else AUTHOR-REVIEW / LOWER ASSURANCE label), ui-delivery evidence when UI paths are
touched, shipped-log row after merge, Second Brain + Master §4.0/§5 updates, ANT-162
checkpoint. No routine per-PR founder testing; founder acceptance is ONE complete
integrated evaluation at the end.

**Reporting format (per roster doctrine):** Functional, Visual, Experiential,
Orchestration Contract, Algorithm Support, Founder Acceptance — reported separately;
identity/branding alone promotes no capability or acceptance.
