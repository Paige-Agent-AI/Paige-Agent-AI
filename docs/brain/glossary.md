# Glossary — §-anchors, tiers, VP roster, waves, jargon

Fast lookup for the vocabulary a new session trips over. Where two sources disagree, the conflict is
called out (don't silently pick one).

---

## CLAUDE.md §-anchor map (§1–§39 + §51)

Root doctrine in `CLAUDE.md`. **Note the numbers are NOT in file order** (sections were pasted as
ruled). One-line each:

| § | Title | § | Title |
|---|---|---|---|
| 1 | Always hire a team; never a single point of failure (the hard gate) | 21 | ONE session per project; no artifact-type tabs |
| 2 | Content rule — client service businesses, never consumer finance default | 22 | Vibe Studio benchmarked vs best-in-class (motion/3D) |
| 3 | Voice (mogul-founder; never "AI-powered"/"seamless") | 23 | Color is emotional; light ≠ dark |
| 4 | Shipping (merge-on-verified; ship live; RED-LINE index) | 24 | Operational efficiency — automate the repeat |
| 5 | Compliance/standards officer (+ post-deploy scan) | 25 | Design taste — see it before you ship it |
| 6 | Brand consistency is one continuous system (gold+indigo) | 26 | Paige learns — compound AI (prompt-forge + memory) |
| 7 | North star — Paige is the intelligent two-way client portal | 27 | "Facelift" is a defined checklist operation |
| 8 | Paige runs a team — two departments + action bus | 28 | Approved is FROZEN |
| 9 | Separate platform (Super Admin) from tenant — "who is this for?" | 29 | Take the bold swing — real graphics tech |
| 10 | Everything stays Paige-governable (callable seam) | 30 | Changing direction = strip-then-rebuild |
| 11 | World-class is the floor (primitive layer; banner exception) | 31 | Never shortchange the request; use the REAL assets |
| 12 | Organize what you create — "where does this belong?" | 32 | A green build is NOT a working render |
| 13 | Build like the best engineers; honest reporting | 33 | The design agent has EYES (screenshot critique) |
| 14 | Paige herself never works solo | 34 | Paige owns her intelligence; only LLM API is external |
| 15 | Paige is the innovative assistant — probe & propose | 35 | Paige is the operating system (OS north star) |
| 16 | Paige runs a $100M org — 10-department model | 36 | Intuitiveness is the moat |
| 17 | The $1B Growth Map (revenue + governance) | 37 | Producer inventory — audit ALL callers |
| 18 | Check for redundancy before you build (one home) | 38 | Money boundary — Paige holds its own rails only |
| 19 | The Studio is the whole campaign, one session | 39 | The peer-gate — independent adversarial diff read |
| 20 | Dispatching a team is a CHAT act, never a surface | 51 | Per-tier availability + gating railing (six tiers) |

**Security-doctrine §-anchors (long-form in `docs/security/`):** §190–192 (Phase-B codification),
§194 (monitoring not repair), §197 (billing-layer taxonomy L1–L4), §198 (legacy deprecation +
cutover addendum), §200 (platform independence), §201 (public language), §202 (multi-entity
contacts), §203 (lane-separation runtime), §205 (metering safety net), §208 (shape-delta),
§210 (L2/L3 scope boundaries), §211 (zero brand refs in code), §213 (migration shape discipline;
§213.c retro DO-block).

**Forward-referenced / not-yet-numbered in CLAUDE.md** (owner-ruled, paste pending — do not assume a
final number): §40 (revenue-stage roadmap), §41 (entity-type legal adherence), §45 (operator-identity
seam / n8n PII guard), §46 (doctrine-persistence discipline — the "write it in CLAUDE.md" rule that
§BRAIN builds on), §49 (unified comms substrate — `docs/doctrine/paige-unified-comms-substrate…`),
§55 (agency-curation visibility), §200-class bug tracking, §254 (worktree isolation). These appear in
commit messages/docs but may not exist as numbered CLAUDE.md sections yet — verify before citing as
canonical.

**§BRAIN** — the Second Brain read/update discipline (this directory). Proposed section added to
`CLAUDE.md` this task, **pending owner ruling on exact wording** (Cowork #26).

**§71 — GROUND BEFORE YOU BUILD** (owner-ruled 2026-09-25; amended the same day from its own
author's two failures of it). Four questions answered with an ARTIFACT, not a belief, before the
first edit: (1) is it still broken — check the fix commit, its ancestry on `main`, and its deploy
run — **AND is the surface REACHABLE**, proven by the import graph and the built bundle, because a
file's folder and name are not evidence that it ships; (2) what does PRODUCTION say — a real
read-only query, not a source reading; (3) is the baseline MEASURED — the same command on the base
commit and on the change, **whole suite both sides**, via a `git worktree`, never `git stash`: a
stash on an already-clean tree stashes nothing and compares a tree with itself; (4) does my test
BITE — reinstate the defect and watch it fail. Plus, for anything
visible: render it and look at it, and name the evidence class you did NOT reach. Sits in front of
§69 rather than replacing any of it; §71.4 does not replace §39's peer-gate. The section records
honestly that prose alone has failed here before and that the durable version is a CI gate.

---

## Tier vocabulary (the §51 Canonical Six) — and the public↔internal naming debt (#67)

The §51 tier matrix (`docs/doctrine/tier-matrix.md`) — the source of truth for every §37/§51 check:

| # | Tier | Scope |
|---|---|---|
| 1 | **God / Super Admin** | Platform operator (us). Owns/sees everything. |
| 2 | **Agency** | Parent tenant owning sub-accounts. Own book + its children. |
| 3 | **Standalone Tenant** | Coach/consultant with no agency parent. Own book only. |
| 4 | **Sub-account** | Child tenant under an Agency. Own book only; isolated from parent aggregate. |
| 5 | **Client** | End-consumer under a Tenant. Own portal only. |
| 6 | **Anonymous** | Unauthenticated public. Public surfaces only. |

**`account_type` enum (internal, in `tenants`):** live prod values today are `standalone` (×10) and
`agency` (×1) — ✅ verified MCP this pass. Note there is **no `sub_account` value in prod today**:
the legacy sub-accounts still carry `account_type='standalone'` **with a non-null `parent_tenant_id`**
(the §51 invariant keys on "child ⇒ NOT agency/enterprise", not on one exact label; normalizing legacy
`standalone` children to `sub_account` is the separate taxonomy-lock task #43).

**Public plan nouns ↔ internal tier (the #67 naming debt):** the **public/marketplace** subscription
tiers are **Solo / Agency** (live Stripe catalog, ✅ verified) — historically also written
**Solo / Academy / Enterprise** (the middle noun churned: #381 set it to *Academy* killing
*Practice/Studio* per §3.b; #395 reversed PLAN academy→*Agency*). DB `platform_subscription_plans`
holds `solo`/`agency`/`enterprise`. **Do not assume public noun == internal `account_type` == Stripe
lookup_key** — they are three registers that have drifted (§18 debt #67). Treat **live Stripe + DB +
`tier-matrix.md`** as truth over any older doc's tier names.

---

## VP roster (Paige's named C-suite) — ⚠ shipped remits conflict with the roster doctrine

**PAIGE** is the orchestrator/CEO; six VPs are her team (§8/§14/§16). Two sources define them and they
**disagree on remits** — an owner-owed reconciliation:

| VP | Roster doctrine (`docs/doctrine/paige-c-suite-roster.md`) | Shipped code (`src/components/ui/page/PaigeAttribution.tsx` `VP_ROSTER`) |
|---|---|---|
| **VERA** | VP Trust & Verification (KYC, consent, §39 integrity, A2P/Stripe/DocuSign) | "Quality & standards" |
| **NEXUS** | VP Growth (Marketing + Sales) | "Marketing & growth" |
| **CURA** | VP Client Success (fulfillment, portal, at-risk) | "Client success" |
| **MENTOR** | VP Operations (Technology/Automation + Ops/PMO) | **"Curriculum & delivery"** ⚠ |
| **MERIT** | VP Finance & People (Money Spine, hiring, contracts) | **"Sales & revenue"** ⚠ |
| **ZION** | VP Strategy & Vision (revenue-stage, scenario modeling) | **"Operations & automation"** ⚠ |

**⚠ Conflict:** MENTOR, MERIT, ZION (and VERA) carry materially different remits in shipped UI vs the
roster doctrine — MENTOR/MERIT/ZION are effectively rotated. `PaigeAttribution.tsx` is the single UI
source of truth today (callers never hardcode a remit); the roster doc is the org-design intent.
**Owner-owed:** reconcile the two before the roster is used as a marketing/org-chart pitch (§16). Both
are cited so a future session doesn't silently "fix" one to match the other without a ruling. (✅ both
read from source this pass.)

---

## Owner Trilogy — the three pillars

`docs/strategy/owner-trilogy-2026-07-26.md` + `docs/product/customer-portal-owner-trilogy-taxonomy-matrix.md`:
Paige as an **AI COO** for the three operator archetypes — **coach · consultant · agency**. Associated
"Twin" capabilities referenced in the roster: **Twin-A** (browser-agent, MENTOR), **Twin-B**
(team-member twin, MERIT), **Twin-C** (business scenario "what-if" twin, ZION). Business Vault L1 =
obligation/renewal tracking (MERIT). See `docs/strategy/twin-capabilities-landscape-2026-07-26.md`.

---

## Wave / slice vocabulary

- **Waves (W1–W9)** — the top-level build phases in `docs/doctrine/canonical-build-order.md`. Current
  active work is **Wave 4-4a** (Agent UI Placement → L8 Memory Fabric → chat compaction/durable
  tasking; PRs #405–#407). **Wave 5** sequencing is Phase-1-finish-then-Phase-2-redo
  (`wave5-phase1-phase2-sequencing.md`).
- **Slices (S1–S3 / "Slice 0/1/1c")** — shippable sub-units of a wave (§4 slice-to-ship). "Slice 1c"
  is the IA-restructure slice (`docs/assessments/IA-SLICE-1C-BLUEPRINT.md`,
  `docs/audits/platform-ia-slice-1c-handoff.md`). "#277 Slice 0–4" = the marketplace tier/curation
  substrate series (PRs #382, #391, #392, #400, #380, #381).
- **Lanes** — parallel workstreams; **Lane B** = the Money Spine (§38 billing); **Lane C** =
  HTML→PDF rendering (`docs/doc-render-decision.md`). "Crew 0" = the substrate-proof crew that opens a
  wave (e.g. Wave 3 Crew 0, PR #376).

## Intelligence-layer vocabulary (§34)

Paige's 7 internal "departments" (own-your-moat, `docs/PAIGE-INTELLIGENCE-GROUNDING-REPORT.md`):
**L1** Observability (`paige_llm_trace`) · **L2** Quality/Evals · **L3** Prompt Engineering
(`paige_prompt_template`) · **L4** Reasoning (`docs/L4-REASONING-GROUNDING.md`) · **L5** Talent
(`paige_subagents`) · **L6** Learning (voyage-3 memory, §26) · **L7** Transparency / God-view
dashboard (`docs/L7-SLICE-1-GROUNDING.md`). **L8** = the owner Memory Fabric (`paige_owner_memory`,
PR #406). Build order was L1 → L4 → L2 → L5.

## Other recurring jargon

- **Action bus (§8)** — the VP-to-VP / Owner-Ops↔Client-Experience hand-off mechanism;
  `paige_action_kinds` registry, `autonomy_lane` enum.
- **`autonomy_lane`** — 🟢 `auto` (AI-performed) · 🟡 `confirm` (AI-drafted, human-approved) ·
  🔴 `off` (human-only, AI-briefed). The §16 governance tiers.
- **Playbook / Blueprint** — the per-tenant vertical configuration (persona, journey, templates);
  "Blueprints" = the one-click vertical install layer (`docs/doctrine/paige-practice-blueprints…`).
- **Vibe Studio** — the tenant creative surface (Campaigns tab): pages, funnels, forms, images, in one
  session (§19/§21/§22). `ProjectNavigator` = the project rail.
- **Command Mark** — the CURRENT and authoritative Paige brand mark (a slash + an orb),
  owner-approved 2026-08-22 and, per the owner ruling 2026-09-06, the Paige identity across the ACTIVE
  product AND the public/marketing experience (this supersedes the earlier "tenant + operator surfaces
  only" rollout scope). Source of truth for the mark, wordmark, palette and motion sequence:
  `../brand/paige-brand-identity.md`. **Two component homes:** the operator
  `src/operator/shell/CommandMark.tsx` (plate variant, coloured by `--pg`/`--cm` tokens, only resolves
  inside a `data-pg` shell — renders on the operator shell `SlotRail.tsx` and on the Solo/agency/admin
  command centers via `TenantCommandCenterShell.tsx`); and the surface-agnostic
  `src/components/brand/PaigeCommandMark.tsx` (the keystone — self-contained theme-aware colours that
  resolve WITH or WITHOUT a shell; renders anywhere — marketing/auth/chrome; API
  `className`/`animated`/`label`/`plated`; consumed by the ~25 migrated surfaces + `PaigeSymbol`'s
  command branch).
  **The slash-and-orb geometry is embedded independently in EIGHT files** (verified 2026-09-06,
  post-retirement — `grep "21,13.6 30.5,13.6" src`): the four OPERATOR copies — `operator/shell/CommandMark.tsx`
  (the 38px rail plaque), `operator/shell/CommandBar.tsx`, `operator/shell/spine/SpineHeader.tsx`,
  `operator/surfaces/relationships/SegmentsSurface.tsx` (none of the latter three is sourced from
  `CommandMark.tsx`, and `SpineHeader`'s copy is DELIBERATE per its own header comment: rail variant vs.
  the bare spine glyph — do NOT "consolidate" without reading that comment; `OperatorSpine.tsx` imports
  only the `CommandMarkState` type, not the geometry) — plus the shared keystone
  `components/brand/PaigeCommandMark.tsx` and the small inline copies in `solo/_shared.tsx`,
  `agency/_shared.tsx`, and `solo/social-command.tsx`. **A geometry change touches all eight, not one.**
  **Social** carries an owner-authorised contrasting local variation (indigo plate + gold slash/orb,
  bulging glyph) — a local treatment, NOT a new logo.
- **PaigeMark — RETIRED (owner ruling 2026-09-06).** The orbital orb + ring + companion spark + halo
  mark — and the older blue "PAi" monogram rasters it replaced — is retired and PROHIBITED from active
  product/public surfaces; `src/components/brand/PaigeMark.tsx` is DELETED. It was formerly imported
  DIRECTLY by ~two dozen production surfaces (marketing landing `src/pages/PaigeHome.tsx`, auth &
  onboarding, the admin + agency layouts, Studio, `src/solo/social-command.tsx`) — ALL migrated to the
  Command Mark (`PaigeCommandMark`, and `PaigeSymbol`'s command branch now renders it). The 2026-09-06
  Social ruling "stay to that one and that one only" was CORRECTED the same day: the one mark is the
  Command Mark, not the orbital PaigeMark. Guard: `lint:legacy-mark`
  (`scripts/ci/legacy-mark-lint.mjs` — scans `src/**` + `public/**` + EVERY root HTML entry point the
  build ships (index/privacy/sms-terms/auth, derived not hardcoded), per-line AND (for multi-attribute
  tag rules) across lines against the full text, for the component/import/tag, the distinctive orbital
  hexes, the orbital animation classes, and a re-drawn tilted-ring `<ellipse>` even when its `transform`
  is line-split — with `legacy-mark-exempt:` honoured at the tag level (a marker on any line the tag
  occupies holds)) + eslint `no-restricted-imports` on the legacy import paths. See decision-log
  2026-09-06 (BRAND) + `../evidence/ui-delivery/legacy-mark-retirement-command-mark.md`.
  **KEPT (not a mark):** `src/assets/paige-ai-avatar.png` (the Paige persona character). **Known
  archival exception:** descriptive code COMMENTS in the Studio cutscene primitives + a stale comment in
  the locked operator `CommandMark.tsx` still say "PaigeMark" — harmless prose drift, not a live render;
  the guard does not (and must not) trip on the bare word in a comment.
  ("Illuminated Precision" is a superseded label; do not reintroduce it.) `PaigeScene` = the landing
  3D hero (three.js), a separate thing.
- **MMA / PME** — Mogul Maker Academy / Project Mogul Enterprise: the owner's **tenant** vertical
  (funding-coaching) — a *tenant's* config, **never** a platform default (§2/§9).
- **`db-live` / `edge-live` tags** — git tags the CI pipelines move to the last commit whose
  migrations / edge functions are persisted on prod (§24/§32). Drift = `git diff <tag>..HEAD`.
- **`/edge-drift`** — command reporting edge functions ahead of prod.
- **Systems Check** — the operator health/readiness surface (VERA ops-side + MENTOR).
- **Route + URL Taxonomy (§65)** — the mental-model naming layer: one route per account type, named
  for WHO is there. Locked matrix (`docs/doctrine/route-and-url-taxonomy.md` §2a): Operator `/operator`
  · Agency `/agency/{account}` · Enterprise `/enterprise/{account}` · Solo `/solo/{account}` ·
  Sub-account `/business/{account}` · Client `/portal/:tenantSlug`. The name READS; session-derived
  scope + `getTierFeatureSet()` ENFORCE (the address is never the grant, §9/§60).
- **`/admin` overload** — the naming-debt bug §65 fixes: one route (`/admin`) meant four surfaces
  (Solo, Sub-account, Agency, God), so the router/human couldn't tell whose surface it was → agency
  owner "lands on the same page." One route per mental model is the fix.
- **`account_number` (address-not-grant)** — net-new per-account stable, PERMANENT numeric URL segment
  (`/business/3855`), assigned at creation; distinct from the initials-only `account_number_prefix`
  (MMA/ADL/…). Lets a human find THEIR account; authority stays session-derived (§9/§51).
- **offset/scrambled `account_number`** — the §65 R0 permanent per-account URL address (`/agency/3855/…`).
  Owner-locked 2026-08-17: a random unused 7-digit number in [1000000,9999999] assigned at creation by
  `assign_tenant_account_number` (migration `20260916000000`). Random (not sequential) so a raw grep of
  URLs in the wild reveals neither the tenant count nor signup order. Permanent — survives tier promotion,
  vanity edits, redirects. Address not a grant (§9): RLS still gates every read.
- **actor-namespacing (act-as URLs)** — owner-locked 2026-08-17: an impersonated view encodes the ACTOR in
  the URL, not the target's bare root — `/operator/act-as/{n}/{branch}` and `/agency/{n}/sub/{subN}/{branch}`.
  So §51 impersonation audit + Paige's §32.c "am I acting or being" self-awareness read straight off the
  address; a bare `/business/{n}/…` for an impersonated view would erase the actor from the trail.
- **`TIER_BRANCHES` registry** (`src/lib/routing/tierBranches.ts`) — the §65 config-as-data route-tree
  spine: per-tier ordered branch set (slug·key·label·group) + root prefix. One home (§18) the router, the
  nav rail, and Paige all read. Encodes §11c (sub_account inherits the SOLO tree) + §3/§61 (enterprise =
  agency baseline superset). Adding a branch is a data row, not per-tier code.
- **`url_segment` (vanity URL)** — the account-holder-editable name/company URL segment (owner ruling
  2026-08-17): born numeric (`account_number`), self-serve editable from Setup to a vanity name; the
  route resolver accepts EITHER. Uniqueness + reserved-word denylist + format validation + old→new 301
  grace (§58) + the permanent number always still resolves. §10-callable (Paige can rename it too).

---

*Add a term the moment it costs a session a lookup. When two sources conflict, record both and flag it
owner-owed — don't paper over the disagreement.*

## Spine · Rail (recorded 2026-09-01, owner-ruled)

- **Rail** — the durable record of what happened: signals, approvals, actions, results,
  follow-ups. Paige's receipt and history. **One part of the Spine, not a synonym for it.**
- **Spine** — the whole shared pathway connecting a domain to Paige: safe evidence → approval →
  domain-owned action → Rail outcome.
- **The approval step of the Spine** is owned by the Chat build and specified in
  `docs/doctrine/one-approval-gate.md`. A feature agent adds gated actions freely; changing how
  approval is PROVEN goes to the Chat build first.
- The full Spine contract is being grounded by a separate audit; when it lands it is the
  authority on everything except the approval step, which stays where it is.

## "Trust Compass" names TWO things (recorded 2026-09-01 — verified against prod)

- **`trust_effective_rung()`** — the PLATFORM trust rung (§68), read by `resolve_automation_autonomy`.
  Real and clamping. ~~*Its migration is not applied to production yet.*~~ **CORRECTED 2026-09-02
  (§58): it EXISTS on production, with `resolve_tool_autonomy(uuid,text)` — read-only catalog query,
  2026-09-02. Runtime enforcement is a separate question and stays `UNVERIFIED`; see
  `../doctrine/autonomy-architecture.md` "Existence is not reachability".**
- **The Solo Compass dial** — `TRUST` in `src/solo/compass.tsx`, an in-memory object seeded from a
  fixture. Enforces nothing; dragging it is lost on reload; no server code reads it.

Say which one you mean. Approval authority today is the action-risk policy plus the confirm gate.
