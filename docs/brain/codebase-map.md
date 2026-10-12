# Codebase Map — shipped surface area (routes · components · edge functions · gates · integrations)

## INT-340 / #1837 conversational Metric/Evidence binding

`_shared/analytics-metrics/read.ts` declares the single `analytics.metric_read` / `read_business_metric` capability. `paige-ai-chat` binds it after existing runtime gates using the real caller-JWT client; Live reaches the same handler. The canonical issuer/resolver and shared pure validator own values, scope and evidence. The frontend validator import reexports the same implementation. Current-turn evidence uses `paige-context/mod.ts`, without extending Pipeline Mind signals or persisting metrics as Memory. Source wiring is not authenticated acceptance. Exact integration/proof boundaries: `docs/delivery/int340-conversational-metric-read.md`.

> **Route topology correction — 2026-09-06:** the legacy privileged router and page described in
> historical sections below are retired. Current product entry lives in `src/App.tsx`; tenant shells are
> account-addressed under `/solo/{account}`, `/business/{account}`, and `/agency/{account}`; platform
> operator capability lives under `/operator` and remains server-authorized. The removed URL and all
> descendants are ordinary unknown routes with no auth hydration shell. Historical component folder
> names containing `admin` and database roles named `admin` remain implementation/permission identifiers,
> not destinations and not authority grants. Current status and proof:
> `docs/evidence/ui-delivery/retire-admin-route.md`.

The brain's answer to *"do we have surface/feature X **built**?"* — a navigable index of the real
shipped code, so a session stops answering "is this built?" from memory (the §BRAIN.2 / false-confidence
trap: "if it's not in the brain it doesn't exist"). This complements `config-registry.md` (which records
*integration wiring*) — this file records *what surfaces and functions exist*.

**§13 rules for this file:** every row points at a real path verified this pass (2026-08-09, from
`origin/main` @ `c40f76d3`). Counts are approximate where noted. A surface here proves the code exists;
it does **not** prove the feature is fully wired end-to-end (integration state lives in
`config-registry.md`, and honest "built-but-not-wired" gaps are called out inline).

> **Router topology — check ALL THREE routers.** Routes are split across three files; any "do we have
> surface X?" answer must check each: **`src/App.tsx`** (public / `/app` tenant / `/broker` / `/onboard`),
> **`src/pages/Admin.tsx`** (`/admin/*` operator console + `/admin/platform/*` super-admin), and
> **`src/components/admin/AgencyLayout.tsx`** (`/agency/*`).
>
> **TARGET taxonomy (§65, planned — NOT yet code).** The current `/admin` route is overloaded 4 ways
> (Solo + Sub-account + Agency + God all log in there — the naming-debt §65 fixes). The LOCKED target
> matrix + staged redirect-safe migration live in **`docs/doctrine/route-and-url-taxonomy.md`**:
> Operator `/operator` · Agency `/agency/{account}` · Enterprise `/enterprise/{account}` · Solo
> `/solo/{account}` · Sub-account `/business/{account}` · Client `/portal/:tenantSlug`. Until the
> code-rename slices ship, THIS map reflects the current routes; consult the taxonomy doc for where each
> is headed.

---

## 1. Routes / surfaces (by audience section)

### Public / marketing (`src/App.tsx`)
Homepage `/` (`PaigeHome`; retired `/premium` and `/legacy` paths replace-redirect here) · auth `/auth` (`/login`→/auth),
operator login `/operator` · signup `/signup`·`/get-started`·`/onboarding`·`/signup/coach-qualify`,
`/join-platform` · marketing `/about`·`/pricing`·`/blog`·`/welcome` · legal `/terms`·`/privacy`·`/legal/:slug` ·
affiliate/broker `/affiliates`·`/broker`·`/broker/accept-invite` · public tenant storefront `/store/:slug` ·
Growth-OS public renderers `/p/:tenantSlug/:pageSlug` (page), `/f/:tenantSlug/:funnelSlug` (funnel),
`/form/:id` · portal gateway `/portal/:tenantSlug` · invites `/accept-invite`·`/join/:token`·`/reset-password` ·
MCP consent `/mcp/authorize` · OAuth callbacks `/auth/google-calendar/callback`·`/auth/gmail/callback` ·
unsubscribe `/unsubscribe`·`/u/:token`.

### Tenant / consumer (`/app/*`, gated by `RequireCompleteSignup`, shell `AppShell`)
Index (agent home) + `credit`, `funding`, `funding-journey`, `disputes`, `learn`(+`/:courseId`),
`business`/`business-profile`, `financial-profile`, `support`, `settings`, `agreements`, `affiliate`,
`approvals`, `actions`, `planning`, `paige-team`.

### Client onboarding wizard (`/onboard/*`, magic-link, shell `OnboardLayout`)
`welcome` (Step 1) · `agreement` (Step 2); unknown paths self-heal → Step 1 → `/app`.

### Broker / sub-account workspace (`/broker/app/*`, shell `BrokerWorkspace`)
Index (`BrokerOverview`), `clients`, `sessions`(+`/:relationshipId` `BrokerPaigeSession`), `team`,
`commissions`, `mcc`, `settings`. Public broker apply at `/broker`.

### §65 Platform-operator console (`/operator/*`, `OperatorEntry`→`RequireOperator`→`OperatorApp`)
The tenant-LESS God-tier tree (mounted #543, 2026-08-18). `src/operator/OperatorEntry.tsx` dispatches
three legs: `index` + `login` → `OperatorLogin` (the door — bare `/operator` must keep working, nothing
in the product links to it), and `:section/*` → `OperatorApp` behind **ONE** `RequireOperator`, never a
per-route guard. The guard reads `isPlatformStaff || isPlatformOwner` from `useTenantContext` (the staff
flag comes from `is_platform_admin()` = §53's `is_platform_operator()`), gates `loading` FIRST and
unconditionally, and reads its own session so signed-OUT → the door with `?next=` (validated by
`src/lib/auth/operatorTarget.ts`) rather than a "Restricted area" card. `OperatorApp` is URL-driven off
**`OPERATOR_BRANCHES`** in `tierBranches.ts` — 13 branches / 5 settings groups / **78** addressable tabs,
`accountSegment=false` (no account in the path), settings nesting a THIRD level
(`/operator/settings/team/roles`). Chrome is a LEFT RAIL + header w/ canonical-path readout + sub-tab strip, painted from
**Claude Design's own palette** via the SCOPED `.operator-console` token block in index.css
(owner ruling 2026-08-18: "if Claude Design made it, that's how it's supposed to be moving
forward" — CD wins over pre-CD house conventions on a CD-designed surface). Scoped on the
`.studio-surface` pattern so no other surface is repainted; zero hex at any call site.
`--cd-gold` carries CD's gold on the active sub-tab underline + settings-active rail rows. §53: `revenue` + `comms`
are owner-only at the ROUTE, not just hidden from nav; 7 MIXED branches await inner gates.
**§13 — mounted ≠ built:** every one of the 78 surfaces is an honest "not built yet" placeholder.
**§58:** ADDITIVE — `AdminLayout` / `/admin/platform/*` is untouched and still the live God console;
`OperatorLogin`'s `GOD_CONSOLE` and `resolveLandingRoute` still point there (mount → verify → flip).
`operatorTarget.ts` validates the guard's `?next=` deep link **segment-wise** — a prefix regex
let `..` through and react-router normalized it out of the subtree (§39 peer-gate, #543).
Tests: `src/operator/OperatorEntry.test.tsx`, `src/lib/auth/operatorTarget.test.ts`.
§32.c drive: `scripts/live-drive/operator-console-drive.mjs` (unauthenticated half, 6/6).

### Agency operator (`/agency/*`, `AgencyLayout`, server-proven agency-manager gate)
Index (`AgencyBoard`), `team` (`AgencyTeamPanel`), `paige-team`, `marketplace` (`AgencyMarketplace`).
Small client surface by design — most agency management is server-side.

### §65 URL-driven Agency shell (`/agency/{account_number}/{branch}/{subtab}`, `AgencyEntry`→`AgencyApp`)
The NEW deep-linkable Agency tree (owner 2026-08-17). `src/agency/AgencyEntry.tsx` dispatches `/agency/*`:
a NUMERIC first segment → the URL-driven `AgencyApp` (15 branches, each a real route); anything else →
the legacy `AgencyLayout` board above (§58, no collision). **The route registry is config-as-data at
`src/lib/routing/tierBranches.ts`** (`TIER_TREES`: operator/agency/enterprise/solo/sub_account; §11c
sub_account inherits the SOLO tree; §3/§61 enterprise = agency superset) — the ONE HOME (§18) for
tier→branch→subtab mapping (slug ≠ internal key by design). `AgencyApp` derives `branch` from splat `[0]`;
each screen's sub-tab is derived from splat `[1]` via **`src/lib/routing/useSubtabRoute.ts`** (drop-in
replacement for a screen's local sub-tab `useState` — reads the URL, navigates on set; DUAL-MODE §58: no
`:account` param → plain local state, so the sub-account inline `/admin` takeover path is byte-unchanged).
12 agency screens are sub-tabbed (CommandCenter·paige·automations·clients·calendar·growth·analytics·
billing·marketplace·vault·team·setup); Client Support + Integrations have none. Per-account address =
`tenants.account_number` (net-new bigint, migration `20260916000000`; §9 address-NOT-grant — RLS still
gates data). Tests: `src/lib/routing/tierBranches.test.ts`.

**REAL DATA (Option B / B1a, 2026-08-17):** the shell chrome reads real per-tenant data via the
`src/agency/data/` adapters — `useAgencyMetrics` (identity: agency name/plan/sub-count) + `useAgencyRoster`
(the sub-account roster) over the RLS-safe RPCs `agency_portfolio_metrics` / `agency_list_my_subaccounts` /
`agency_my_membership` (session-scoped by `auth.uid()`, §9/§51). Operator name+email come from
`supabase.auth.getUser()`. A §39 URL ownership guard redirects a non-own `account_number` to the caller's
own and canonicalizes bare `/agency/{n}`. §13-honest Preview where no backend (per-sub drafts, hours-saved,
brand color). Switcher click → Clients hub (listing); real per-sub view-as ENTRY is B2. Sibling adapters
ready but not yet all wired: `useAgencyCommandCenter` (in use), `useAgencyBilling/Compass/Contacts/Marketplace/People`.

**B1b (2026-08-17):** the Clients-hub Directory (`src/agency/clients.tsx`) — the primary "Your sub-accounts"
grid — is also real now, via the same `useAgencyRoster`. New `src/agency/data/rosterFormat.ts` (§18 one
home) holds the shared presentational helpers any roster-row screen imports: `healthDot`/`healthLabel`
(3-state bucket healthy/watch/at_risk → dot+label, unknown→"Not yet scored"), `swatchFor` (deterministic
decorative per-sub color, no brand-color backend), `tenureLabel`/`isNewThisMonth` (REAL, from the child's
`created_at`), `mrrLabel` (cents→"$X.XK", "—" if unknown). `AgencyApp.tsx` imports the same
`healthDot`/`swatchFor` rather than a second copy. The "Needs your attention" rail is derived from real
watch/at-risk rows — no fabricated narrative/dollar-figures (that was the fixture's failure mode this
slice fixed). **Known gap (task #175):** `agency_portfolio_metrics()`'s leaderboard caps at `LIMIT 20`
(ORDER BY mrr_cents DESC) — a sub-account outside the top 20 by MRR gets `health:null` and silently drops
out of the attention rail even if genuinely at-risk. Non-blocking for books under 20 subs; needs a §37
producer inventory before the limit can be safely raised. Pipelines/Conversations/own-book still fixtures
(own tracked slice); the pack's existing `pipesFlag` honesty-tooltip (`fixtures.ts`) now explicitly
discloses the Pipelines sub-account NAMES are stand-ins too, not just the figures.

**URL-DRIVEN IS AGENCY-ONLY so far (task #173, R3 owed).** SOLO (`src/solo/SoloApp.tsx`) and SUB-ACCOUNT
(`AgencyApp mode="subaccount"`) still render as a STATE-DRIVEN inline `/admin` takeover (`Admin.tsx` solo
gate + Gate B) — pure `useState` route, NO `/solo/{n}` or `/business/{n}` menu/sub-tab URLs. The taxonomy
(`route-and-url-taxonomy.md`) roots them at `/solo` + `/business`; converting them (same `useSubtabRoute`
pattern) is R3, sequenced after Option B and before the Super Admin console.

### Admin / operator console (`/admin/*`, `Admin.tsx`)
Grouped tab layouts: **Clients Hub** (`clients-hub`+`/pipeline`,`/conversations`{manual-actions,snippets,
trigger-links,analytics,settings},`/delivery`,`/portal`; `clients`, `contacts/:id`, `clients/:id/journey`) ·
**Setup** (`setup`+`/general`,`/brand`,`/automations`,`/integrations`,`/legal`,`/billing`,`/playbook`) ·
**Team/Planning** (`team`,`planning`) · **Funding** (`funding`,`funding-pipeline`,`funding-lens`,
`business-credit`,`owner-credit`,`banking` — all under `FundingRoute` gate) · **Knowledge**
(`knowledge`,`knowledge-base`,`tenant-knowledge`,`network-kb`) · **Studio** (`studio`+`/new`,`/library`,
`/:sessionId`) · **Growth/Campaigns** (`campaigns`,`social`,`leads/enrichment`) · **Workflows**
(`workflows/runs`(+`/:id`),`workflows/:key`) · **Ops** (`analytics`,`maintenance`,`security`,`approvals`,
`notifications`,`data-registry`,`observability/usage`,`observability/errors`,`bookings`,`signatures`) ·
**Marketplace** (`marketplace`) · **Paige config** (`playbook`,`sub-agents`,`actions`,`skills`,`paige-team`) ·
**Integrations** (`/n8n`,`/zapier`,`/telegram`,`/email`,`/docusign`,`/cal`,`/meta`,`/meta-pixel`,`/apollo`,
`/plaid`,`/smartcredit`,`/subscriptions`,`/ai-activity`,`/nav`).

**Solo shell overlay** (`src/solo/**` → `SoloApp`, faithful port of the Claude Design Solo pack; merged
#503 2026-08-16): a flag-gated (`VITE_SOLO_SHELL_ENABLED`, default OFF) early-return takeover in
`Admin.tsx` — for STRICT solo-standalone tenants ONLY (`tierKey==='solo' && soloStandalone`, wrapped in
`AdminLoaderBoundary` + lazy code-split) it renders the ported Rail/TopBar shell + **13** fixture-data
screens (Command Center · Paige · Trust Compass · Automations · Clients · **Calendar** (incl. webinars) ·
Growth · Analytics · Marketplace · Business Vault · Integrations · Team · Setup) instead of `AdminLayout`.
Sub-account/Agency/God each get their OWN Claude Design pack later (owner-ruled 2026-08-15 — the prior
"sub-accounts inherit Solo" reading is RETRACTED; §60 governs feature availability, NOT visual design).
Flag OFF ⇒ prod render byte-unchanged (§58); fixture-data now, real wiring + activation are owner-gated
later phases. Lint exemptions scoped to `src/solo/**` only (eslint override + gold-discipline skip, §63).

### Super-admin / platform (`/admin/platform/*`)
`tenants`, `team`, `fleet-communications`, `sending`, `sends`, `intelligence`, `settings`, `affiliates`,
`invites`, `marketplace`, `money`, `doctrine`, `prompt-forge`, `model-router`, `compliance`,
`content-defaults`, `analytics`, `deploy-health`.
**Operator Communications** = `/admin/platform/fleet-communications` (`PlatformFleetCommunications.tsx`) —
the operator's OWN SMS line (PR #408, §9 seam). Store: `operator_conversations`/`operator_messages`
(owner-only RLS, no `tenant_id`). NEVER merge with the tenant inbox `/admin/clients-hub/conversations`.

---

## 2. Domain components (`src/components/**` top-level → what lives here)

| Folder | ~files | What lives here |
|---|---|---|
| `dashboard/` | 126 | Tenant `/app` dashboard sections (LearningVault, ProfileSettings, business-profile, AffiliateTracking, RepositioningNotice…) — largest folder |
| `admin/` | 116 | Operator/God console + `/admin/platform/*`, `AgencyLayout`, Studio layout, `FundingRoute`, tab layouts, `comms/` (Numbers/A2P/Conversations) |
| `ui/` | 78 | Design-system primitives (shadcn) + `ui/page/` premium layer (`PageShell`/`PageHeader`/`DataTableShell`/… + analytics primitives `Sparkline`/`DrillContainer`/`MetricEntityCard`/`ExploreChart`, PR #411) |
| `paige/` | 29 | Paige agent chrome — chat / session / persona / team-directory UI (right-rail + ⌘K launcher, PR #405) |
| `landing/` | 18 | Marketing homepage sections |
| `premium-motion/` | 14 | Animation/motion primitives |
| `credit/` | 14 | Credit-intelligence UI (incl. `SoftPullAuthorizationCard` iSoftPull gate) |
| `chat/` | 12 | Chat / conversational widgets (`MessageAudioButton` TTS play) |
| `funding/` · `affiliates/` | 10 each | Funding matches/portfolio · affiliate tracking/apply |
| `team/` | 8 | Team hub / `TeamViewToggle` (`TEAM_VIEW_ENABLED` gate) |
| `funding-journey/` | 7 | Funding journey stepper |
| `auth/` | 6 | Route guards (`RequireCompleteSignup`, `ClientOnlyRouteGuard`) |
| `clients/`·`support/`·`legal/` | 6/6/5 | Client admin UI · support requests · legal renderers |
| `planning/`·`app/` | 4 each | Planning board · `/app` shell helpers |
| `funding-lens/`·`onboarding/`·`growth/` | 3 each | Funding-lens analytics · onboarding steps · Growth-OS block editors |
| `analytics/`·`seo/`·`setup/`·`client/` | 2 each | Analytics widgets · MetaPixel/SEO · setup panels · client-portal bits |
| `voice/`·`marketplace/`·`broker/`·`business/`·`brand/`·`security/`·`approvals/`·`notifications/` … | 1 each | Thin single-component feature areas |

Loose top-level: `PaigeCore`/`PaigeScene`/`PaigeHero3D`/`PaigePremiumFigure` (3D hero),
`PlatformUpdateBanner`, `InstallPWA`, `ThemeToggle`, `PageTransition`.

Update delivery: `usePlatformUpdate` polls the build-stamped `/version.json`; `customer-update-manifest.mjs` projects one exact-build, published release record into customer-safe fields; `useBeforeUnloadGuard` lets dirty owner workflows block explicit reload.

---

## 3. Edge functions (~241 dirs under `supabase/functions/`, excl. `_shared/`)

Grouped by theme with the load-bearing names (not all 241 enumerated — group + key fns):

| Group | ~n | Load-bearing functions |
|---|---|---|
| **paige-\*** (agent core) | 22 | `paige-orchestrator`, `paige-ai-chat`, `paige-public-chat`, `paige-context-router`, `paige-bridge`, `paige-action-worker`, `paige-mcp` |
| **subagent-\*** (specialists) | 13 | `subagent-forge`, `subagent-fundability`, `subagent-funding-path`, `subagent-compliance`, `subagent-sales-pipeline`, `subagent-email-composer` |
| **comms / SMS / email / send** | ~30 | `send-message`, `send-notification`, `handle-inbound-sms`, `handle-inbound-email`, `process-email-queue`, `send-transactional-email`, `comms-search-numbers`, `comms-purchase-number`, `comms-a2p-draft`, `comms-a2p-submit`, `paige-operator-sms-send`, `paige-operator-sms-inbound` |
| **Twilio** | 4 | `twilio-inbound-webhook`, `twilio-status-callback`, `provision-tenant-twilio`, `send-sms` (+ shared `_shared/twilio.ts`, `_shared/operator-twilio.ts`) |
| **Stripe / checkout / billing** | ~8 | `stripe-webhook`, `handle-stripe-webhook`, `create-checkout`, `create-trial-checkout`, `tenant-stripe-connect`, `platform-subscription-checkout` |
| **Credit** | 12 | `analyze-credit-report`, `calculate-credit-factors`, `generate-credit-predictions`, `extract-business-credit-report`, `detect-credit-alerts` |
| **Funding** | 4 | `match-funding-products`, `generate-funding-projection`, `send-funding-report`, `subagent-funding-path` |
| **Plaid** | 9 | `plaid-create-link-token`, `plaid-exchange-token`, `plaid-sync-transactions`, `plaid-webhook`, `paige-plaid-*` |
| **QuickBooks** | 7 | `quickbooks-oauth-initiate/callback`, `quickbooks-sync-financials`, `quickbooks-webhook`, `quickbooks-refresh-token` |
| **Credit-pull vendors** | 4 | `isoftpull-initiate`, `isoftpull-webhook`, `smartcredit-pull-snapshot`, `handle-smartcredit-alert-webhook` |
| **Calendar / booking** | ~8 | `google-calendar-oauth-start/callback/disconnect`, `cal-list-bookings`, `cal-cancel-booking`, `handle-cal-webhook`, `public-booking`, `process-booking-notifications` |
| **Zoom** | 3 | `zoom-oauth-start/callback/disconnect` |
| **Voice / STT / TTS** | ~7 | `paige-live-session` (Paige-owned fail-closed Live Conversation control plane), `paige-tts`, `paige-stt`, `paige-dictate`, `voice-command-processor`, `voice-twiml`, `voice-access-token` |
| **Studio / skills** | 5 | `studio-learn-from-artifact`, `studio-visual-critique`, `skill-forge`, `skill-runner`, `growth-studio-route` |
| **Growth OS** | 7 | `growth-page-draft`, `growth-funnel-draft`, `growth-form-draft`, `growth-inbound`, `growth-process-submission`, `growth-block-edit` |
| **Knowledge base / embeddings** | ~8 | `kb-search`, `kb-ingest-doc/file/url`, `kb-promote-to-network`, `embed-text`, `embed-client-financials`, `backfill-memory-embeddings` |
| **Meta / social** | 6 | `handle-meta-webhook`, `meta-capi-admin`, `meta-track-conversion`, `meta-schedule-post`, `meta-get-insights` |
| **Google / Gmail** | 6 | `gmail-oauth-start/callback/disconnect`, `google-calendar-*` |
| **Apollo (enrichment)** | 3 | `apollo-search-people`, `apollo-enrich-person`, `apollo-enrich-company` |
| **Tenant provisioning** | ~8 | `tenant-signup`, `tenant-checkout-session`, `manage-tenant-domain`, `tenant-stripe-connect`, `tenant-journey`, `provision-tenant-twilio` |
| **Broker** | 5 | `broker-paige-chat`, `broker-admin-action`, `broker-auto-approve`, `broker-workspace-checkout`, `send-broker-team-invite` |
| **Marketplace** | 2 | `marketplace-install`, `marketplace-checkout-session` |
| **Affiliate** | ~3 | `invite-affiliate`, `affiliate-monthly-statement-cron`, `track-referral-click` |
| **Webhooks (generic in/out)** | ~14 | `handle-inbound-webhook`, `fire-outbound-webhooks`, `webhook-inbound`, per-vendor `handle-*-webhook` |
| **DocuSign / signatures** | 2 | `docusign-send-envelope`, `handle-docusign-webhook` |
| **Agreements (PAIGE-native e-signature, INT-163)** | 3 | `agreement-send` (authenticated), `sign-agreement` (**public, `verify_jwt=false`** — the token-gated signing act; serves no markup, the signer's page is the React route `/sign/:token`), `agreement-document` (**public, `verify_jwt=false`** — the sealed record, by retrieval token for the signer or by session for the workspace). Shared: `_shared/agreements/{document,token,seal,signing-guard,disclosure,notify}.ts`. Tables `paige_agreements` / `_signers` / `_events`; bucket `paige-agreements`. The page's own contract is RPCs: `create_agreement_signing` · `add_agreement_signer` · `issue_agreement_signing_link` · `peek_agreement_signing` · `decline_agreement_signing` · `void_agreement_signing`. **No Paige chat tools yet** — NOT blocked any more: INT-003 was resolved on 2026-09-23 (PR #1367), so a new mutating tool lands by classifying it in `_shared/action-risk.ts` AND declaring it through `defineCapability()` in the same change. The agreement tools are unsequenced, not withheld; every act is already reachable through its RPC. **Distinct from the DocuSign pair above, which is untouched**, and from `finalize-agreement` (the onboarding wizard's click-through). |
| **Automation connectors** | ~3 | `paige-n8n`, `call-zapier-action`, `send-telegram` |
| **Privacy / GDPR / consent** | 4 | `export-clients-csv` (data export), `request-data-deletion` + `process-data-deletion` (GLBA/CCPA right-to-erasure), `log-consent` (consent audit trail) — admin route `/admin/.../data-registry` |
| **Content drafting (standalone copy, §19)** | 1 | `content-draft` — the ONE home for standalone marketing copy (posts, ads, email campaigns, captions, blog outlines, SMS broadcasts); Paige drafts in chat, never a Studio artifact type |
| **Web search / deep research** | ~4 | `paige-web-search`, `paige-deep-research`, `web-search`, `paige-problem-reverse-engineer` |
| **Browser automation (Twin-A)** | 1 | `browser-use` (Browserbase headless Chrome; secrets `BROWSERBASE_*`) |
| **Web push** | ~1 | `send-push-notification` (VAPID; `VAPID_*` secrets + client push-subscription path) |
| **Operator/God user-management** | ~5 | `admin-list-users`, `admin-delete-user`, `admin-force-signout`, `admin-account-actions`, `admin-drop-bucket` |
| **Invoicing / payment confirmation** | ~2 | `generate-invoice`, `send-payment-confirmation-email` (+ `platform_invoices` table, §38) |
| **LMS backend** | ~3 | `issue-certificate`, `track-lesson-progress`, `enroll-user-in-course` (front end = `/learn` + `LearningVault`) |
| **Scheduler / cron / reminders** | ~6 | `schedule-automated-tasks`, `coaching-reminder-cron`, `plan-reminder-cron`, `weekly-summary-cron`, `task-reminder-notifications`, `dispatch-stage-automation` |
| **SMS phone-verify (notifications)** | 2 | `send-sms-verification`, `verify-sms-code` (+ `sms_verifications` table) — wired in `NotificationsSettings.tsx`; NOT wired into signup (see decision-log Known-unbuilt) |

*(The count churns as functions ship; index the **theme groups + load-bearing names** here, not a bare
number. `/edge-drift` shows what's ahead of prod.)*

---

## 4. Feature flags / gates (name → where read)

**Compile-time boolean kill-switches (client):**
- `VITE_SOLO_SHELL_ENABLED` (env, default **off**) — `src/pages/Admin.tsx`; when `"true"` AND the tenant is a STRICT solo-standalone (`useTierFeatures().tierKey==='solo' && soloStandalone`, i.e. literal `account_type==='standalone'` + no `parent_tenant_id`), an early return replaces the whole tenant admin shell with the faithful-ported Claude Design Solo pack `SoloApp` (`src/solo/**`, lazy-loaded → separate chunk, wrapped in `AdminLoaderBoundary`). Fixture-data greenfield; OFF everywhere until owner-activated. Never fires for sub-account/agency/enterprise/god (canonical `resolveTierKey` + the strict `isSoloStandalone` in `src/lib/tier/tierFeatures.ts` reject null/unknown account_type).
- `TEAM_VIEW_ENABLED = false` — `src/lib/roleViews/commandCenterRegistry.ts`; Team view stays OFF until flipped (read in `PracticeOverview`, `TeamHub`, `ContactsAdmin`, `team/TeamViewToggle`).
- `HOST_SPLIT_ENABLED = false` — `src/lib/hostRouting.ts`; gates app/marketing host split.
- `ISOFTPULL_ENABLED_CLIENT = false` — `src/components/credit/SoftPullAuthorizationCard.tsx`; hides soft-pull UI until server keys set.
- `STUDIO_THINKING_ENABLED` — reasoning stream gate in `paige-ai-chat` (read by `admin/studio/chat/ReasoningPanel`).

**Runtime per-tenant gates (server / DB):**
- **`funding_enabled`** — the central §2 finance gate. Derived in `_shared/client-context.ts` from the
  `is_finance` marketplace-catalog install OR `features.finance_in_scope` / `features.playbook === "funding"`;
  consumed by `get_paige_persona_context()` + `paige-orchestrator`. **The single most load-bearing gate** —
  it governs whether the entire funding vertical is visible per tenant (§2 opt-in, never a platform default).
- **`_shared/finance-gate.ts`** — `looksLikeFinanceAgent()` / `FINANCE_DOMAINS` / `FINANCE_KEYWORDS`; the
  canonical finance classifier enforced at agent-creation (`subagent-forge`) + invocation (`paige-orchestrator`).
- **`features.*` playbook flags** — tenant `features` JSON read in `client-context.ts`; presets in `src/lib/playbook/presets.ts`.
- **Model-router gates** — `_shared/model-router-gates.ts` + `_shared/model-allowlist.ts` gate which LLM a tier may use; peers `visual-critique-gate.ts`, `finance-gate.ts`.
- **`FundingRoute`** — `src/components/admin/FundingRoute.tsx`; client guard wrapping all `/admin/funding*` surfaces.

*(There is **no** generic `feature_flags`/`platform_features` registry table — gating is compile-time consts +
the derived `funding_enabled` signal + marketplace-install checks.)*

---

## 5. Third-party integration entry points

| Vendor | Entry point | Wired? |
|---|---|---|
| **Twilio** | `_shared/twilio.ts` (+ `_shared/operator-twilio.ts`, `_shared/twilio-media.ts`); `twilio-inbound-webhook`, `twilio-status-callback`, `provision-tenant-twilio` | ✅ (ISV/reseller — see config-registry "Twilio ISV Architecture") |
| **Paige voice profile / optional ElevenLabs transport** | `PaigeLiveConversation.tsx` + `paige-live-session` + service-only `paige_voice_profile` resolver → `_shared/tts-router.ts` / `paige-tts`; provider credentials remain server-side | UI/control plane implemented; realtime provider audio `PROOF OWED`; no hosted agent or provider action path |
| **Stripe** | no shared module (SDK inline); `stripe-webhook`/`handle-stripe-webhook`, `create-checkout`, `tenant-stripe-connect` | ✅ |
| **Meta (FB/IG)** | `handle-meta-webhook`, `meta-capi-admin`, `meta-track-conversion`; client `seo/MetaPixel` | ✅ |
| **Google** | Calendar `google-calendar-oauth-*`; Gmail `_shared/gmail.ts` + `gmail-oauth-*` | ✅ |
| **Microsoft / Outlook** | — | ❌ NOT WIRED |
| **Zoom** | `_shared/zoomMeetings.ts` + `zoom-oauth-start/callback/disconnect` | ✅ |
| **Vercel** | client `@vercel/speed-insights` only; deploy is CI | ✅ (build/CI, not runtime) |
| **GitHub** | CI only (`.github/workflows/`), no runtime module | ✅ (CI only) |
| **n8n** | `paige-n8n` + `_shared/workflowDispatch.ts` | ✅ |
| **Zapier** | `call-zapier-action` | ✅ |
| **Plaid** | `plaid-create-link-token`, `plaid-exchange-token`, `plaid-webhook`, `paige-plaid-*` | ✅ (funding lane) |
| **QuickBooks** | `_shared/quickbooks-utils.ts`; `quickbooks-oauth-*`, `quickbooks-sync-financials`, `quickbooks-webhook` | ✅ (funding lane) |
| **DocuSign** | `_shared/docusignJwt.ts`; `docusign-send-envelope`, `handle-docusign-webhook` | ✅ |
| **Apollo / iSoftPull / SmartCredit / SMTP** | `apollo-*`; `isoftpull-*`; `smartcredit-*`; `_shared/smtp.ts` | ✅ (funding/enrichment lane) |
| **Browserbase** | `browser-use` (headless Chrome, Twin-A browser agent; `BROWSERBASE_*` secrets) | ✅ |
| **Firecrawl** | web crawl for research (`FIRECRAWL_API_KEY`) | ✅ |
| **LLM / media providers** | `_shared/`: `claude.ts`, `openai.ts`, `groq.ts`, `gemini-image.ts`, `replicate.ts`, `voyage.ts`, `ideogram.ts`, `meshy.ts` (via model-router §14) | ✅ |

---

*Regenerate the verified rows when surface area changes; any PR that adds a route/surface/edge-fn family or
an integration entry point updates this file in the same commit (§BRAIN.3). Verified 2026-08-09 @ `c40f76d3`.*

## Solo Command Center governed-record surface

- `src/solo/CommandCenter.tsx` owns the Solo-only visible secondary order **Systems Check · Mind**.
  Systems Check is canonical/default; `directory` and `history` are compatibility aliases that are
  replaced with `/solo/{account}/command-center/mind`. Do not copy this Solo ruling into Agency,
  Sub-account, Enterprise, or operator registries.
- `src/solo/SoloMindWorkspace.tsx` + `solo-mind-workspace.css` own Mind's read-only, interactive 3D
  record topology and contextual inspector. They compose existing read sources only: `useSoloKnowledge`
  (Knowledge resources), `useN8nSpineReadiness` (Connected sources, status only), and read-only decision
  references from `useCommandCenter` (Operating decisions). Business context + Client relationships render
  an honest ABSENCE (no frontend hook yet); Offers & services is honest UNAVAILABLE. **Systems Check
  findings are DELIBERATELY not surfaced here (§58** — they live in the Systems Check subtab), so this
  no longer reads `useSystemsCheck`. They do not own actions, chat, historical inference, relationships,
  or helper provenance.
- `src/solo/mind-orb/` owns the 3D engine, promoted VERBATIM from the owner-approved (§28 frozen) Gate-1
  prototype: `engine.ts` (`createMindOrb` Three.js factory), `MindOrbCanvas.tsx` (React mount — WebGL
  probe, code-split dynamic `import("./engine")` so `three` is a lazy chunk, `SceneBoundary` + loud
  degrade to the parent list, effect-based reconciliation), and `mindDomains.ts` (PURE reconciliation
  from the read contracts → orb nodes + honest source-signal states). Unit-tested: `mindDomains.test.ts`
  (28) + `SoloMindWorkspace.test.tsx`; §32 headless env smoke `scripts/mind-orb-smoke.mjs`. Ported live
  2026-09-06, PR #969.
- `src/solo/SoloPaigeWorkspace.tsx` links to canonical Mind but remains the single PAIGE Chat/Knowledge
  owner. Mind may open that workspace only through the existing shell callback, with no context attach,
  prefill, send, preparation, or work-start claim.
- Identity rule: mount Mind only after server-resolved `activeTenantId`, key the child by that epoch,
  and never use the URL account number as read authority.


### Client identity contract (2026-09-01)

`public.clients` owns one immutable internal UUID, one immutable tenant binding, and one immutable public-safe `client_ref` stored in `account_number`. `create_contact()` is the authenticated creation seam; trusted edge producers must supply their already server-resolved tenant. Paige Chat and MCP expose `client_ref` plus bounded CRM metadata and resolve the internal UUID only after tenant validation.

## Business Vault Phase 2 security foundation (2026-09-06)

**Release state: PARTIAL / deployed at merge `809faec3`; authenticated runtime PROOF OWED.**

- **Solo surface and route:** `src/solo/SoloApp.tsx`, `src/solo/settings.tsx`, `src/solo/vault.tsx`,
  and `src/solo/vault.css` own Settings → Business Vault. Navigation is shown only after
  `business_vault_access_status` confirms the current actor for the server-resolved active
  workspace. Denial or authorization transport failure clears content and navigation together;
  a later successful server check performs a fresh load.
- **Durable domain home:** migrations `20261225013700` through `20261225014000` own tenant-bound
  records, versions, contracts, obligations, fact review/revocation, owner-only visibility,
  replacement/archive lifecycle, quarantine inspection evidence, and bounded cleanup. Browser
  roles have no direct table access; callable RPCs re-resolve actor, tenant, role, and lifecycle.
- **Edge boundary:** `business-vault-upload` can reserve and place bytes only in the private
  `business-vault-quarantine` bucket when the server capability says a real inspection adapter is
  available. `business-vault-download` returns only a current, ready, passed-inspection version.
  `business-vault-reconcile` retries safe quarantine cleanup without logging document text.
- **UNAVAILABLE:** no approved OCR/DLP provider or service-owned promotion worker exists. PDF/image
  upload, inspection, byte promotion, and normal download therefore remain disabled. Promotion
  functions are revoked from browser and service roles. Quarantine rows and synthetic SQL outcomes
  are not live document inspection.
- **DEFERRED:** client publishing, external provider ingestion, legal interpretation, payment or
  filing execution, Rail outcomes, Systems Check verdict changes, and broad document-to-Mind
  automation. A passed inspection would still require separate owner review and minimal-fact
  approval before any Paige context.
- **Proof:** 5 focused files / 29 tests; 71 count-enforced actor/database assertions; two-session
  duplicate/cleanup serialization; affected lint, Deno ratchet, TypeScript ratchet, build, audit,
  contract, database-contract, UI-evidence, and full CI verification PASS. Three independent
  security/routing/test reviews PASS. PR #986 squash-merged as `809faec3`; post-merge CI passed;
  `db-live` and `edge-live` both point to that exact SHA; Vercel Production status succeeded
  (deployment `6MT79LnaSVWixnZXWQwStnVsNW2F`), and `paigeagent.ai` plus
  `app.paigeagent.ai` returned HTTP 200 with the live Solo chunk
  `SoloApp-GsPt1vrB.js` containing the four fail-closed Vault fingerprints. Authenticated
  owner/admin/member/cross-tenant drives, real inspection/quarantine bytes, and a Vercel runtime-log
  scan remain PROOF OWED.
- **Collision handoff:** PR #724 is adjacent to the tenant/Settings seam. PR #917 overlaps the
  Settings dispatch/header and `supabase/config.toml` tail. Preserve both Integrations and Vault
  `openPaige` wiring, `solo-settings--vault`, Vault outer-header suppression, current Connections
  copy, `solo-contact-import`, and all three Vault `verify_jwt = true` blocks. Do not overwrite
  Paige chat/Mind, Rail, Systems Check, Relationships, Pipeline, or governed-execution owners.
- **Next owner:** the Vault inspection-adapter/worker workstream. It must read this section,
  `docs/evidence/ui-delivery/business-vault-phase2-foundation.md`, migrations `13700..14000`,
  and the 71-assertion SQL plan first. It must obtain explicit provider approval/credentials before
  enabling bytes, then prove OCR, secret/financial-sensitive detection, encrypted/malformed and
  timeout refusal, cleanup compensation, exact-byte promotion, and authenticated storage behavior.
