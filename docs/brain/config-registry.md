# Config Registry — infra & integration state

Durable record of the platform's integration configuration so no future session re-diagnoses
"how is X wired / what's the account / which secret drives this."

**§13 rules that govern this file (read before editing):**
1. **NAMES & non-secret identifiers only** — env-var names, phone numbers, account IDs, agent/voice
   IDs, price IDs, product IDs, webhook endpoint IDs, messaging-service names, project refs. **NEVER
   a secret value** (auth token, API key, signing secret, private key). If you discover a value,
   do NOT write it here.
2. **Verify or mark.** Every fact is either **verified this session** (with *how* stated) or tagged
   **`⚠ unverified — confirm`**. Do not assert an unchecked fact.
3. **In-flight ≠ live.** Facts that exist only on an unmerged branch are marked as such — the brain
   tracks `main`/prod, not work in progress.

**Verification legend:** ✅ verified this session (method noted) · ⚠ unverified/in-flight (confirm).

**This file is WIRING only (names/IDs).** The capability, authority lane, cost-track dependency,
operating cost + ownership (the API Expense & Operations Layer), canonical provider receipt,
Rail/Mind/Memory boundary, and honest delivery status of each provider live in the **Integration
Capability Registry** (`docs/integration-registry/` — the JSON is the source of truth; the derived
cost view is `expense-and-operations-report.md`). Read that registry's entry **before**
proposing/implementing/opening a PR for/changing any provider integration, and update it **before
merge** (the delivery rule; enforced by `npm run lint:integration-registry`). This file never restates
that governance, and that registry never restates these names/IDs (§18). **"M1" is disambiguated there
(owner ruling 2026-09-06):** internal LLM-cost metering (operating-cost visibility, §8.4) vs M1
real-money spend control (external spend backbone, §10) — a spend-capable provider always points to
the real-money track, never LLM metering.

Last full verification pass: **2026-08-09**.

---

## Supabase

| Fact | Value | Verified |
|---|---|---|
| Project ref / `project_id` | `xygzykjyynhzqytbqnzu` | ✅ `supabase/config.toml` line 1 + Supabase MCP `get_project` |
| Prod URL | `https://xygzykjyynhzqytbqnzu.supabase.co` | ✅ derived from ref; appears in live Stripe webhook `url` |
| Migrations applied on prod | **764** | ✅ MCP `SELECT count(*) FROM supabase_migrations.schema_migrations` (2026-08-09) |
| Latest applied migration | `20260813000000` | ✅ MCP `SELECT max(version)` — matches repo's latest `.sql` (zero drift); incl. #408/#409 |
| Repo migration files | 764 `.sql` | ✅ `ls supabase/migrations/*.sql \| wc -l` |
| Edge functions | **243** dirs excl. `_shared/` | ✅ `ls -d supabase/functions/*/ \| grep -v _shared` |
| Tenants | 11 (10 `standalone`, 1 `agency`) | ✅ MCP `SELECT account_type, count(*) FROM tenants GROUP BY 1` |

**Config/settings tables present on prod** (✅ MCP `information_schema.tables ~ 'config|setting|platform_'`):
`admin_app_settings`, `app_settings_owner`, `outbound_webhook_configs`, `paige_config`,
`paige_telegram_config`, `platform_api_keys`, `platform_email_settings`, `platform_invites`,
`platform_invoices`, `platform_legal_profile`, `platform_metered_events`(+`_dead_letter`),
`platform_metering_reconciliation`, `platform_mrr_snapshot`, `platform_number_pricing`,
`platform_phone_numbers`, `platform_subscription_plans`, `platform_subscriptions`,
`platform_usage_events`, `staff_calendar_settings`.

**`platform_usage_events` now also carries `event_type='llm_tokens'`** (MET1, 2026-09-01, not yet
merged). `quantity` is tokens; `metadata` carries `trace_id` (uniquely indexed, partial, so a
re-drain cannot double-count) plus provider/model/status and an explicitly-labelled
`cost_estimate_usd` that is **null on rows whose upstream call was never priced** — the key is
always present so the absence is stated rather than inferred. Written ONLY by
`meter_llm_usage(p_limit)`, service-role only (`EXECUTE` revoked from `anon`/`authenticated`, plus
an in-body `auth.uid() IS NOT NULL` raise per §59). Nothing reads these rows yet — recording usage
is not charging for it. Token pricing lives in `supabase/functions/_shared/token-pricing.ts`, the
one home (§18); `model-router` and `eval/scorers` import it rather than carrying their own copies.

**Platform alerting substrate** (A1, migration `20260922000000`, 2026-08-20 — ✅ §32.b rollback-proved on
prod pre-merge; ✅ §32.a persisted-apply CONFIRMED post-merge: `schema_migrations` carries
`20260922000000`, all three tables exist on prod, all three report `relrowsecurity` AND
`relforcerowsecurity`):
`paige_alert_signal` (signal catalogue, config-as-data), `paige_alert_rule`, `paige_alert_firing`.
All three RLS **ENABLED + FORCED**, every policy gated on `is_platform_operator()` (§53 — the delegated
operator tier, NOT the frozen `is_platform_owner()`). `service_role` holds ALL on each — granted up front
because the systems-check family shipping WITHOUT them produced a runtime `permission denied` that the
rollback proofs structurally could not catch (they run as owner, not service_role; hotfix #94).
Five seeded signals; **`migrations.drift` ships `is_readable = false` on purpose** — an edge function
cannot read git, so a rule bound to it must report "never evaluated", never a pass.

**Platform alerting evaluator** (A2, migration `20260923000000` + edge function `alerting-evaluate`,
2026-08-20 — ✅ §32.b rollback-proved on prod pre-merge). Adds `paige_alert_rule.condition_met_since`
(episode bookkeeping — what makes `for_minutes` meaningful and firing edge-triggered, at most once per
episode) and a `pg_cron` job **`alerting-evaluate`** on `*/5 * * * *` that pokes the function via
`net.http_post` with `public.cron_token_header()` — the SAME poke shape as the systems-check operator
schedule (§18, one convention). The function is `verify_jwt = false` in `config.toml` so the cron poster
can reach it, and fails closed in-function to an internal caller (service-role bearer OR `x-cron-token`)
or an operator JWT (`is_platform_operator()`, §53).

**A2 carries a §13 catalogue correction, recorded rather than quietly patched.** A1 seeded
`llm.failover_rate` as readable; it is NOT — `paige_llm_trace` has no failover marker (its columns are
`status`, `error_class`, `provider`, `model`, `tier`), verified against the live schema. A2 flips that
signal to `is_readable = false` with the reason in its `notes`, and registers **`llm.error_rate`** —
which the schema genuinely supports — as its own key. Pointing the existing key at an error rate would
have shipped a number whose name says one thing and whose value means another.

**A2 writes firings and does NOT deliver them.** Every firing lands `delivery_status = 'pending'`;
delivery is A3 and routes through `_shared/channel-adapters.ts` (§18 — the existing single home for
multi-channel delivery). A fire is not a delivery.

**Core Supabase edge secret NAMES** (✅ grep `Deno.env.get`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`. Deploy auth uses the `SUPABASE_ACCESS_TOKEN` **repo secret** (per
`supabase/functions/CLAUDE.md`; ⚠ presence not re-verified this session — CLAUDE.md asserts it is set).

**Solo Team management — DEPLOYED (corrected 2026-09-02; was recorded 2026-08-31 as in-flight).**
Shipped via PR #728 (`76bb3bbca`). The JWT-verified `solo-team-invitations` edge function, the
`get_solo_team_workspace` / work-profile / permission / invite / acceptance RPC family, and
`get_paige_team_context` are on `main`. The browser receives no raw invite token; the invitation
function invokes the existing `send-portal-invite` server-side. **Migration apply is CONFIRMED on
prod** — `20261039000000` and `20261040000000` in `schema_migrations`; `job_title` /
`responsibilities` present on `tenant_members`; five `team_*` rows from `list_tool_autonomy()`.
**Still UNVERIFIED:** email delivery and authenticated tenant behaviour — no leg driven on the live
authenticated platform.

**Invitation workspace authority — PR #827, migration `20261047000000` (NOT YET MERGED; update this
line to SHIPPED, or delete it, when it lands).** The three invitation RPCs used to read
`profiles.active_tenant_id` **raw** while the roster read used `current_user_tenant_id()`, so a sole
owner with a null pointer was told they were not an owner of their own workspace. Authority is now
proved by `solo_team_invite_authority(_actor, _expected_tenant_id)` against a workspace the caller
NAMES — the Team screen sends the `tenant_id` it rendered the roster from, PAIGE sends the tenant the
conversation is reconciled to, and the parameter is refusal-only. The signatures changed:
`create_solo_team_invite(uuid, uuid, text, text, text, text)`,
`resend_/revoke_solo_team_invite(uuid, uuid, uuid)`; the old arities are DROPPED. `solo-team-invitations`
now sends `expectedTenantId` and shows only the sentences the seam authored. PAIGE's `inviteSeamBlocked`
workaround is deleted, not moved. Behavioural proof: 42 pgTAP assertions in `database-contract`
against a `supabase db reset` schema. **Still UNVERIFIED:** authenticated runtime — no signed-in
owner has driven it.

---

## Stripe (§38 — Paige holds its OWN rails only)

| Fact | Value | Verified |
|---|---|---|
| Account ID | `acct_1TvndiLUcYKxolNa` | ✅ Stripe MCP `get_stripe_account_info` |
| Display name | "Paige Agent AI" | ✅ same |
| Mode | livemode (all prices/webhooks `livemode:true`) | ✅ Stripe MCP |

**Active platform-subscription prices** (✅ Stripe MCP `GetPrices active:true` — all livemode):

| Plan | Interval | Price ID | Amount | Product | lookup_key |
|---|---|---|---|---|---|
| Solo Beta | monthly | `price_1UF50HLUcYKxolNapbjC1zlJ` | $74.50 | `prod_VFaAS9EPa2ehkj` | `paige_solo_beta_monthly_v1` |
| Solo | monthly | `price_1TzkVaLUcYKxolNaTMOGad1D` | $149.00 | `prod_UzjzWtdtKzWlIp` | `solo_monthly` |
| Solo | annual | `price_1TzkVdLUcYKxolNaKu56Gkjh` | $1,490.00 | `prod_UzjzWtdtKzWlIp` | `solo_annual` |
| Agency | monthly | `price_1TzkVgLUcYKxolNahULDkCfw` | $397.00 | `prod_UzjziZpD2L269e` | `agency_monthly` |
| Agency | annual | `price_1TzkVzLUcYKxolNagIGowZMC` | $3,970.00 | `prod_UzjziZpD2L269e` | `agency_annual` |

**⚠ Finding — Enterprise plan has no active Stripe price.** DB `platform_subscription_plans` lists
`solo`, `agency`, **`enterprise`** all `is_active=true` (✅ MCP), but live Stripe returned **only
Solo + Agency** active prices (`has_more:false`). Enterprise is registered in the plan table with no
active Stripe price yet — confirm whether that's intentional (sales-led/manual invoicing) before
wiring an Enterprise checkout.


**Solo Beta live binding (2026-09-13):** the row above is the sole public acquisition offer. Server Checkout enforces a non-reusable 30-day trial; trial length is not a Price attribute. Production database/Stripe/Edge/Vercel readback is verified at merge `4ccb8a9a`. First authorized customer fulfillment is PROOF OWED. Stripe has no active Billing Portal configuration; the portal seam remains fail-closed until the conservative configuration is created.

**Promotional Solo production grant (2026-09-13):** `platform_grant_promotional_solo` is deployed through forward migration `20270201000000` and executable only by `service_role` with a separately proven platform-owner actor. The Antonio Cook personal Solo grant is verified as one active standalone owner workspace, explicit promotional classification, metering enabled, no expiry, one audit/usage receipt, and no Stripe/provider binding; retry is idempotent. Authenticated browser sign-in and account switching remain `PROOF OWED`.

**Webhook endpoints** (✅ Stripe MCP `GetWebhookEndpoints`, both → `.../functions/v1/stripe-webhook`):

| Endpoint ID | Status | Notes |
|---|---|---|
| `we_1U2NB0LUcYKxolNaxGCRBI0y` | **enabled** | "production webhook (secret handed to Supabase `STRIPE_WEBHOOK_SECRET`)"; core checkout/subscription/invoice + `charge.refunded` events |
| `we_1U2MDCLUcYKxolNaPHAi9mYk` | **disabled** | broader event set (customer/billing/account/plan/invoice.*) |

**Billing P0 verification, 2026-09-03:** production secret-name metadata confirms `STRIPE_SECRET_KEY` present and `STRIPE_SECRET_KEY_V2` absent; both webhook secret names present. Values were never accessed. Presence does not prove valid provider credentials or test/live account alignment. Authenticated Mogul Maker Academy setup failed at the provider-attempt stage. [Current repair and proof status](../delivery/billing-payment-setup-p0.md); do not presume a missing legacy key is the cause.

**Stripe edge secret NAMES** (✅ grep): `STRIPE_SECRET_KEY`, `STRIPE_SECRET_KEY_V2`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_V2`, and price-ID env names
`STRIPE_PRICE_STANDARD`/`_V2`, `STRIPE_PRICE_PREMIUM`/`_V2`, `STRIPE_PRICE_VIP`/`_V2`,
`STRIPE_ADDITIONAL_BUSINESS_PRICE_ID`, `STRIPE_BROKER_BETA_STARTER_PRICE_ID`,
`STRIPE_BROKER_WORKSPACE_PRICE_ID`, `STRIPE_BROKER_CLIENT_COUPON_CODE`.

**Platform Billing Foundation A (PR #816 — MERGED as `f455d8a5`; migration `20261045000000` IS
APPLIED on prod.** Corrected 2026-09-03 from "NOT MERGED, NOT DEPLOYED, NOT APPLIED", which was
already false when this block arrived: `20261045000000` is in `schema_migrations` on ref
`xygzykjyynhzqytbqnzu`, verified by query while renumbering around it, and `platform-billing-portal`
is deployed ACTIVE. **The one thing still unverified is `PLATFORM_BILLING_PORTAL_ENABLED`'s value on
prod** — no tool here exposes edge-secret presence, so treat "Unset on prod" below as unconfirmed
rather than current. Everything else in this block has been checked. Not this PR's slice; corrected because
§BRAIN.2 has sessions answer "is this live?" from this file, and it was answering wrongly.)

| Name | Kind | State |
|---|---|---|
| `PLATFORM_BILLING_PORTAL_ENABLED` | edge secret NAME (flag) | read by `platform-billing-portal`; anything but the exact string `true` refuses every call `not_enabled`. **Believed unset and deliberately not flipped at the 2026-09-03 Gate B merge — but its VALUE is unverifiable from here** (no tool exposes edge-secret presence), so treat "unset" as the intent on record, not a confirmed reading. Flip only after an authenticated owner drive of the deployed function. |
| `platform-billing-portal` | edge function (`verify_jwt = true`) | opens Stripe's hosted portal for the caller's OWN top-level Solo workspace as its Owner, via `platform_billing_accounts`; Stripe key chosen BY NAME from the mapping's `stripe_account` (`STRIPE_SECRET_KEY` / `STRIPE_SECRET_KEY_V2`), never a fallback. **Deployed on prod** — ACTIVE, version 2, created 2026-09-03T01:19:43Z, 31 seconds after `f455d8a5` merged, i.e. by `deploy-edge-functions.yml` on that merge (verified by listing prod's edge functions 2026-09-03). |
| `platform_billing_accounts` · `platform_billing_contacts` · `platform_billing_notification_log` | tables (migration `20261045000000`) | LAYER-1 (§197) source records; RLS FORCE, operator read / platform-owner write; tenants read through `get_workspace_billing_authority()` / `get_workspace_billing_contacts()` only. **Applied on prod** (`20261045000000` in `schema_migrations`, verified 2026-09-03). |

No sender / mail-provider contract exists for billing notices; the ledger has no writer.

**⚠ Finding — legacy price env names vs the live Solo/Agency catalog.** The
`STRIPE_PRICE_{STANDARD,PREMIUM,VIP}(_V2)` env names are a *legacy* (consumer funding-coaching)
tier scheme; the current **platform-subscription** catalog is Solo/Agency (above). Do not assume
the `STANDARD/PREMIUM/VIP` env names map to the current plan tiers — confirm the resolver before
relying on either. (Secret **values** intentionally not recorded.)

---

## Signup / onboarding / provisioning (✅ code + migration-verified 2026-08-09)

- **Signup verification = EMAIL only.** `src/pages/PublicSignup.tsx` uses email verification
  (`CommunicationsConsent … showSms={false}`, "click it to verify your account"). **SMS/phone
  verification is NOT wired into the signup flow** — the `input-otp` primitive exists and OTP is used
  for Auth/MFA, but signup doesn't use it. **SMS phone-verify itself DOES exist** for notification
  opt-in: `send-sms-verification` + `verify-sms-code` edge fns + `sms_verifications` table, wired in
  `NotificationsSettings.tsx`. *(So "do we have SMS verify?" = yes for notifications, no for signup —
  see `decision-log.md` → "Known-unbuilt / spec-only status.")*
- **`signup_intake` table** — migration `20260810000000_signup_flow_reorder_intake.sql` (PR #404,
  onboarding-before-checkout reorder). Consumers: `stripe-webhook`, `WorkspaceProvisioner.tsx`.
- **Acceptance/completion gate** — migration `20260714013653_signup_completion_gate.sql`; client guard
  `src/components/auth/RequireCompleteSignup.tsx` (wraps `/app/*`). Deferred provisioning + restored
  signup trigger landed in #402; concurrency-safe entitlements + `user_subscriptions` unique in #403
  (repairs the latent stripe-webhook subscription-record bug).

## Tenant classification & revenue integrity (§29/#412 merged · §31/#415 in-flight)

**Three ORTHOGONAL axes on a tenant — never conflate them** (✅ code + migration + MCP-verified 2026-08-09):

| Axis | Where | Values | Who sets it |
|---|---|---|---|
| **Topology** | `tenants.account_type` | `standalone` · `sub_account` · `agency` · `enterprise` | provisioning; §51-locked |
| **Lifecycle** | `tenants.status` (enum) | `trial` · `active` · `past_due` · `canceled` · `suspended` | billing/lifecycle |
| **Revenue-class** | `tenant_revenue_classification.revenue_class` (dedicated operator-only table, #412) | `promotional` · `paid` · `internal_test` | operator; default `promotional` |

- **Why revenue-class is a SEPARATE table, not a `tenants` column** (§9/§18/§51): a column on `tenants` would (a) be read by every tenant member via `Members read own tenant` RLS (operator-internal leak) and (b) collide with the §51-locked `account_type`. So it lives in `tenant_revenue_classification`, RLS `is_platform_owner()`-only + FORCE. Read seams: `get_tenant_revenue_breakdown()` (operator RPC), `operator_dashboard_metrics` (reconciled to `revenue_class='paid'` only, #412).
- **§51 ABSOLUTE INVARIANT (DB-locked, migration `20260807230000`):** a child (`parent_tenant_id` not null) can NEVER be `agency`/`enterprise` — enforced 3 layers deep (`tenants` CHECK `tenants_subaccount_not_agency` · `agency_team_members` trigger · `agency_current_id()` both branches). Do not weaken without an owner ruling.
- **Current prod distribution** (✅ direct production readback, 2026-09-13, post-promotional Solo grant): **16 tenants** — `promotional 12`, `internal_test 4`, **`paid 0`**. The 5 active `platform_subscriptions` rows have NULL `stripe_subscription_id`; real subscription revenue remains $0 until verified live fulfillment occurs. This supersedes the 2026-08-09 9-tenant snapshot.
- **"Real revenue" / paid definition (one canonical form across surfaces):** `revenue_class='paid'` AND a live Stripe subscription (`status='active'` + non-null `stripe_subscription_id`). Used by `get_tenant_revenue_breakdown().paying_count` (#412) and the #31 gate below.

**⚠ Revenue integrity chain — IN-FLIGHT (PR #415, task #31, owner §32.c-gated — NOT yet on main):**
- Migration `20260815120000_revenue_integrity_chain.sql` adds a fail-closed trigger `enforce_revenue_integrity_chain()` on `tenant_revenue_classification`: a row may only be MINTED `revenue_class='paid'` when the tenant owner has a **subscriber** agreement in `legal_acceptances` (slug in `subscriber_agreement_slugs()` = `saas-standalone`/`saas-agency`/`saas-enterprise`) AND a live active Stripe sub. Enforced at the transition; already-paid rows aren't re-gated (no auto-demote — reconcile follow-up, task #85).
- Audit seam: `operator_revenue_integrity_audit(_tenant_id)` — `is_platform_owner`-gated RPC (RAISES 42501); Fleet Console "Revenue Integrity" section + CSV export consume it (§10/§18 one home).
- Verified §32.b against the verbatim file (COMPILE PASS + reject/accept/edit), §37 producer-inventory clean, §39 + §5 both passed. Marked in-flight per §BRAIN — move to a "merged" fact when PR #415 lands on main.

## Twilio (SMS / voice — last-mile telecom commodity, §34)

**Platform-wide Twilio secret NAMES** (✅ grep `Deno.env.get`): `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_FROM`,
`TWILIO_PHONE_NUMBER`, `TWILIO_STATUS_CALLBACK_URL`, `TWILIO_MESSAGING_SERVICE_SID` (referenced),
`VOICE_TWIML_URL`, `VOICE_STT_STREAM_URL`, `VOICE_STREAM_SECRET`.

**Sending pattern** (✅ `_shared/bookingNotify.ts`): `TWILIO_FROM` falls back to `TWILIO_PHONE_NUMBER`;
messages sent E.164-normalized.

**⚠ Auth model — prod uses the API-Key TRIO, NOT the account Auth Token** (✅ `_shared/twilio.ts`
`masterCreds()` + comment `:242-244`): master requests authenticate Basic-auth with **username =
`TWILIO_API_KEY_SID` (SK…), password = `TWILIO_API_KEY_SECRET`**, URL path addressing
`TWILIO_ACCOUNT_SID`. **`TWILIO_AUTH_TOKEN` is a LEGACY fallback the code says prod does NOT carry** —
do not assume it is set just because SMS/voice work (they run on the API-Key trio). It matters for one
thing: **inbound webhook `X-Twilio-Signature` validation** needs the account Auth Token, so the operator
inbound fn may still owe `TWILIO_OPERATOR_AUTH_TOKEN` (or `TWILIO_AUTH_TOKEN`) — see operator note below.

**Live tenant phone numbers on prod** (✅ MCP `SELECT phone_number, source, status FROM
tenant_phone_numbers`): `+14705177009` (source `marketplace`, active) and `+14705706068` (source
`marketplace`, active). **Both marketplace-provisioned.**

### Twilio ISV / Reseller Architecture (✅ `_shared/twilio.ts`, `provision-tenant-twilio`, code-verified 2026-08-09)

**Paige is a Twilio ISV/RESELLER, NOT a BYO-Twilio host.** There is ONE platform **master** Twilio
account; each tenant gets its **own Twilio SUBaccount minted under that master**. Tenants never bring
their own Twilio and never see the word "Twilio" — they search an area code and click Buy. *(A prior
session wrongly proposed a "tenant BYO-Twilio" pattern — that is contradicted by every file below; do
not re-propose it.)* Module header `_shared/twilio.ts:24-35` states the model explicitly.

| Plane | Home (code + table) |
|---|---|
| **Subaccount provisioning** | `supabase/functions/provision-tenant-twilio/` (super-admin-only, `is_platform_owner()`) — mints a subaccount, mints a subaccount-scoped API Key, vaults the secret, mints the TwiML voice app; `adopt` mode reconciles orphans. Wrappers in `_shared/twilio.ts`: `createSubaccount()`, `createSubaccountApiKey()`, `ensureTwimlApp()`. Table **`tenant_twilio_subaccounts`** (1-per-tenant: `twilio_subaccount_sid`, `api_key_sid` SK…, `auth_token_vault_ref`, `twiml_app_sid`, `status`). |
| **Number search + purchase** | `comms-search-numbers` + `comms-purchase-number` (JWT-gated; tenant server-derived) → buys into the tenant's OWN subaccount → records **`tenant_phone_numbers`** (`source='marketplace'`). UI `src/components/admin/comms/NumbersTab.tsx`. Resale price in **`platform_number_pricing`** (§38: Twilio wholesale + flat $0.05 Paige-held fee). ⚠ **charge leg NOT wired** — `comms-purchase-number` returns `charge_wired:false` (honest, §13). |
| **A2P 10DLC registration** | UI EXISTS: `src/components/admin/comms/A2PTab.tsx` — coach fills a brand form, **Paige drafts the campaign copy** (`comms-a2p-draft`), coach approves, `comms-a2p-submit` persists. Table **`tenant_a2p_registrations`**. ⚠ **carrier/TrustHub submit NOT wired** — `createBrand()`/`createCampaign()` in `_shared/twilio.ts` are honest `needs_config` stubs (never a fabricated SID); `comms-a2p-submit` returns `a2p_submit_wired:false`, status stays `pending`. **This is the Wave 4c.2 prereq gap — the gap is the live carrier submit, NOT the UI.** |
| **Credential resolution** | `masterCreds()` / `masterBasicAuthHeader()` (master, API-Key trio) and `resolveTwilioCreds(admin, tenantId)` (per-tenant subaccount — reads `tenant_twilio_subaccounts`, decrypts the subaccount API-Key secret via the `read_channel_secret` SECURITY-DEFINER Vault RPC; service-role only). All in `_shared/twilio.ts`. |

**Operator (God/Super-Admin) SMS surface — REUSES the existing master Twilio account (PR #408 MERGED
2026-08-09, `2ee92903`):**
- The operator SMS surface does **NOT** require new `TWILIO_OPERATOR_*` account secrets. It **reuses the
  platform's EXISTING master Twilio account** (resolved via `masterCreds()`, §18 one home; shared seam
  `_shared/operator-twilio.ts`). Surface `/admin/platform/fleet-communications`
  (`PlatformFleetCommunications.tsx`); store `operator_conversations`/`operator_messages` (owner-only
  RLS, no `tenant_id`). **§32.a confirmed on prod:** migration `20260812000000` persisted, both tables
  exist. *(Supersedes the earlier framing of new `TWILIO_OPERATOR_*` secrets — that was wrong; see
  `lessons-learned.md` → "Assumed unprovisioned.")*
- **Two possibly-owed secrets (both fail-closed/degrade safely until pasted):**
  1. **A2P Messaging Service SID** — `TWILIO_OPERATOR_MESSAGING_SERVICE_SID` (or `TWILIO_MESSAGING_SERVICE_SID`),
     `MG…` for "Low Volume Mixed A2P Messaging Service". Operator send goes via the MG SID, never a raw
     `From:` — without it the send degrades to `needs_config` (`operator_messaging_service_not_configured`).
  2. **Inbound signing token** — `TWILIO_OPERATOR_AUTH_TOKEN` (or `TWILIO_AUTH_TOKEN`), the account Auth
     Token Twilio signs inbound webhooks with. Per `masterCreds()`, prod authenticates OUTBOUND with the
     API-Key trio and does NOT rely on a raw Auth Token, so its presence can't be assumed — the inbound
     fn **FAILS CLOSED** (401, nothing written) if no token resolves. ⚠ Confirm which of the two applies
     during activation.
- Operator A2P config — account **"Paige Agent AI LLC"** (⚠ vendor/Twilio account name — pending rename to Paige Agent AI Inc., owner-owed), operator number **+1 (470) 200-3444**. Voice
  webhook currently on the Twilio demo URL (re-point scheduled slice 4c.2).
- **⚠ Live-data note:** +1 470 200 3444 is referenced in `main` source comments as the Super Admin's
  imported number, but that `tenant_phone_numbers source='imported'` row is **not present in prod today**
  (only the two `marketplace` numbers above exist). Confirm provisioning state during operator SMS activation.

---

## Voice / TTS / STT — Paige Voice Profile

**2026-09-08 full-audio continuation (development):** owner authority now permits existing-account
inspection and server-only use of the existing credential, not purchase/upgrade or legal acceptance.
The existing `paige-voice-profile-admin` gains `inspect-configured-account`: platform-owner JWT
required, candidate profile resolved server-side, fixed provider GETs, bounded/sanitized metadata
and existing audit-log attribution. This is not an audio enablement or canonical verification record;
STT/TTS scopes, retention, real playback and cost proof remain independently required. No key value
is returned, persisted or logged. Canonical scope/evidence: existing Live Conversation packet.

**2026-09-08 readiness audit / Presence recovery:** production safe metadata still has transport
disabled, no independent provider-verification rows, false scope/voice/privacy/ZRM/quota flags and
null cost values. This proves missing recorded authorization, not account incapability. Organic
Live Presence and actual shared-output analysis are a development candidate; no provider account,
secret, voice approval, retention term, STT/token path or readiness flag was changed. The streaming
realtime session remains unavailable, distinct from per-message playback. Exact iteration evidence:
`../evidence/ui-delivery/paige-live-conversation-mvp.md`.

**Current contract (2026-09-07):** every Paige speech path resolves one approved, active
server-side `paige_default_voice` profile. The browser and request body cannot select a provider or
voice reference. Profile rows carry an immutable revision, approval/effective metadata, optional
speech policy, and operator audit trail; a new session resolves the current revision while an active
session retains its snapshot. Customer UI shows only Paige.

The requested ElevenLabs reference is stored only in the service-owned profile table as a pending,
inactive candidate. The separately approved OpenAI fallback is the initial active profile. Neither
provider reference is a client setting, prompt value, or request override. Missing/deleted/
unauthorized profiles fail closed unless a separately approved fallback resolves.

**Provider-backed realtime audio: `PROOF OWED`.** The production readiness record is deliberately
transport-disabled until an authorized operator independently verifies the existing account's
minimum key scopes, exact voice authorization, realtime STT eligibility/concurrency, quota, Paige
calendar-month UTC hard cost ceiling, approved maximum price per 1,000 characters, and retention
posture. The service-only reservation seam locks readiness before every uncached provider TTS call,
counts reserved plus committed usage, allows the exact cap, rejects over-cap work before provider
contact, and releases only a typed pre-dispatch missing-key refusal. Ambiguous provider outcomes and
settlement faults remain counted; actor deletion cannot erase spend history. Profile activation is
one transactional proof/readiness/profile RPC, so a failed replacement cannot leave transport
enabled. Canonical
provider proof is re-read at profile resolution and reservation time, so later revocation fails
closed. Zero Retention Mode is never assumed: a provider warning
that it was requested but not applied is a failed privacy gate. No hosted provider agent is owned or
created by this architecture.

**Secret names only:** `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL`, and `ELEVENLABS_BASE_URL` may remain
server-side provider wiring. `ELEVENLABS_VOICE_ID` is superseded for Paige speech and is not read by
the new shared TTS path. Secret values were not inspected or tested in this delivery.

**2026-09-23 candidate correction (INT-104 S3):** the inactive ElevenLabs candidate is
forward-corrected to Jessica voice `g6xIsTj2HwM6VR4iXFCw` with the take-5 register; the
applied historical seed is not rewritten. The single ElevenLabs transport and TTS router
default to `eleven_v3_conversational`; server-only `ELEVENLABS_MODEL=eleven_v3` is the
reversible owner-by-ear alternative. Any other configured model or voice fails closed.
Both buffered and streaming requests include `enable_logging=false`; the account's
eligibility for Zero Retention Mode remains unverified, so this is not provider proof or
activation. The active OpenAI read-aloud profile is unchanged.

**2026-09-24 admission correction (INT-104, migration `20270420000000`):** Live admission was an
identity predicate — a singleton readiness row pinning the speaker to one stored user id who also
had to hold `super_admin` — so no other Solo account could reach Live at all. It is now a
platform-owned, service-role-only allowlist (`public.paige_live_pilot_subjects`, RLS on, no
anon/authenticated policy, missing row refuses) with per-subject acceptance and an `expires_at`
lifetime.

**2026-09-24 audience correction (migration `20270422000000`), same day, one layer down:** that
allowlist's only production writer admitted the authenticated operator themselves, so the set of
people who could ever be admitted was still one login. Eligibility now derives from the tenant's TIER
and *who may speak today* is a single stored setting. NAME only, values stated because they are a
closed enum and not a secret: `public.paige_voice_readiness.pilot_rollout_scope`, `'off' | 'solo_tier'`,
**ships `'off'`**. It cannot name a person, a login or a workspace by construction. The operator turns
it through `paige-voice-profile-admin`'s `set-live-rollout-scope` action (platform-owner gated;
widening requires the default-provider-retention acceptance restated in the same request), and the
global disable now closes the audience with it. **NAMES only, no values, and nothing was activated:** the allowlist ships empty, the
ElevenLabs provider gate is unchanged and still shut, `ELEVENLABS_API_KEY` was neither read nor
tested by this change, verified zero retention remains `UNAVAILABLE`, and physical speaker identity
is still unenforced (#1417). Both database function signatures were preserved, so **no edge function
was redeployed** — `paige-live-session`, `paige-live-relay`, `paige-ai-chat` and
`paige-voice-profile-admin` are byte-for-byte unchanged.

| System | Voice resolution | Current state |
|---|---|---|
| Paige message playback | `paige-tts` → service-only profile resolver → provider-neutral router | Deployed; authenticated runtime proof owed |
| Paige Live Conversation | immutable profile revision in `paige_live_sessions`; provider transport disabled | UI/control plane deployed on `f8eb2362`; eligibility derives from the tenant's TIER (`live_conversation_tier_allows`), and *who may speak today* is one setting — `paige_voice_readiness.pilot_rollout_scope`, `'off' | 'solo_tier'`, **shipping `'off'`** — so no account is admitted; realtime audio `PROOF OWED`; authenticated owner E2E `UNVERIFIED`; no surface calls `paige_live_accept_terms()` yet |
| Studio voiceover | request-selected provider voice removed; model-router fails closed | `UNAVAILABLE` until this lane uses the same Paige Voice Profile/readiness resolver |
| Hosted ElevenLabs agent | none | `UNAVAILABLE` and intentionally outside Paige ownership |

**Voice feature-flag / cost secret NAMES** (✅ grep): `VOICE_COPILOT_ENABLED`,
`VOICE_COPILOT_COST_CAP_USD`.

---

## Repo-local agent config (`.claude/`)

`.gitignore` ignores `.claude/*` and then NEGATES the parts that are shared, so session-local
state stays out while shared assets are versioned. Two negations exist:

| Path | Why it is versioned |
|---|---|
| `!.claude/commands/` | Shared project commands (e.g. `/edge-drift`) — "so every session (and every teammate) gets them" |
| `!.claude/skills/` | Holds `README.md` plus **our own** `second-brain/` skill — read the brain before work, update it before done (§0/§BRAIN.3/§66), versioned so it loads on every fresh container (§64). The third-party §69 skill (`flow-by-flow` + its sibling `flow-prototype`) is **NOT vendored** — its bundle ships no `LICENSE`, and the MIT notice can neither be fetched nor reconstructed without inventing a copyright holder, so redistribution is blocked pending an owner decision. **Corrected 2026-09-01:** an earlier revision claimed the account-synced install delivers `SKILL.md` only and left §69 half-installed. It does not — the synced `SKILL.md` inlines every `references/*.md` and the template (77 KB) and is self-contained, so a fresh container gets the complete skill. What the snapshot lacks is our 2026-09-01 close-out addition, which is why that now ships as the repo-local skill instead |

Contains **no secrets** — these are markdown process documents, and **no third-party content**:
`.claude/skills/` holds `README.md` and our own `second-brain/SKILL.md`. (An earlier revision of #708 vendored the two
MIT bundles with an assembled `LICENSE`; both, and a `PROVENANCE.md`, were removed before merge
because the notice could not be obtained without inventing a copyright holder. Those paths do not
exist — do not follow references to them.)

## GitHub Actions / CI (✅ `.github/workflows/`)

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | pull_request + push | Typecheck/build/lint/test gate |
| `deploy-migrations.yml` | push (to `main`) | `supabase db push` → `migration list` verify → moves `db-live` tag (§32 persisted-apply) |
| `deploy-edge-functions.yml` | push (to `main`) | Deploys only changed functions (follows `_shared` imports via `.github/scripts/edge-affected.py`); moves `edge-live` tag (§24) |
| `migration-lint.yml` | pull_request | Migration shape lint (§208/§213) |
| `premerge-migration-proof.yml` | pull_request — **DISABLED** (manually, no run since 2026-08-24) | Pre-merge migration proof (§32.a). Does not run: a proof "owed" to it is not owed to anything. Fail-closed rework is #574; re-enable or delete is an owner decision |
| `security-audit.yml` ("Security Audit") | pull_request + push | Security audit gate |

**Security scanning (2026-09-27).** `codeql.yml` ("CodeQL Advanced") and `codacy.yml` ("Codacy Security
Scan") were **removed** on owner authorization: CodeQL Advanced failed on every run because GitHub's
CodeQL *default setup* (a repository setting, not a file — dynamic workflow `github-code-scanning/codeql`)
is enabled and refuses advanced-configuration results; Codacy failed on every run. The default setup
still scans `actions`, `javascript-typescript` and `python` on every PR and push and is green. The
`github-advanced-security` PR check ("Code scanning AI findings", dynamic agent) is also a repository
setting; it fails on an unsupported model and can only be switched off in repository settings. A
replacement scanning decision is being made separately; do not add a scanner here without it.

**RLS anon/cross-tenant-reach drift guards (npm scripts wired into `ci.yml`):**

| Script | Guards | Added |
|---|---|---|
| `lint:views` | Fails any migration that lets a VIEW drift to `security_invoker=off` (the #116 11-view anon/cross-tenant leak class). | PR #447 / §9 P0 #116 |
| `lint:definer-fns` (`scripts/ci/definer-fn-lint.mjs`) | Fails any migration granting a new public `SECURITY DEFINER` function to `anon`/`PUBLIC` without an inline `-- definer-anon-exempt: <reason>` escape (the #117 owner-bypass fn class). Sibling of `lint:views`. | PR #448 / §9 P0 #117 |
| `lint:title-authority` (`scripts/ci/title-authority-guard.mjs`, baseline `scripts/ci/title-authority-baseline.json`) | Fails CI when a permission decision reads a title (`job_title` / `responsibilities`): a policy (direct, dynamic or through a function or view), an authorization helper, an unreviewed or changed title reader, an unclassified column added to `tenant_members` or `tenant_invite_tokens` (or a title column renamed or dropped), or a TypeScript gate. `lint:title-authority:test` proves each rule bites. | F1 (2026-09-26), owner ruling: roles authorize, titles describe |

Repo: **`Paige-Agent-AI/Paige-Agent-AI`** (✅ this is the accessible repo for GitHub MCP; a
`mrmogulmaker/paige-agent-ai` path is **not** configured for the session). Default branch `main`.
`GITHUB_TOKEN`, `GITHUB_REPO` also appear as edge secret names (Paige→GitHub seam).

---

## MCP servers (this session)

- **Supabase MCP** — project `xygzykjyynhzqytbqnzu`; used for all prod queries above. ✅ connected.
- **Stripe MCP** — read; account `acct_1TvndiLUcYKxolNa`. ✅ connected.
- **GitHub MCP** — repo `mrmogulmaker-bot/paige-agent-ai`. ✅ connected.
- **ElevenLabs MCP** — ⚠ **disconnected** this session (voice facts sourced from repo instead).
- No `.mcp.json` committed in-repo (✅ checked) — MCP wiring is session/host-level, not repo config.
- Other connectors surfaced but **not authorized** this session (OAuth required, non-interactive):
  Cloudflare, Courtroom5, Jotform, Lovable AI, Paige_Agent_AI, PayPal — ⚠ unavailable until authorized.

---

## Other third-party integrations (secret NAMES only — ✅ grep `Deno.env.get`)

Grouped by domain; these are the env-var **names**, evidence the integration exists in the edge layer.
Values intentionally omitted.

- **LLM / model router (§14/§34):** `ANTHROPIC_API_KEY`, `OPENAI_BASE_URL`, `GROQ_BASE_URL`,
  `FEATHERLESS_API_KEY`, `FEATHERLESS_BASE_URL`, `FEATHERLESS_DEFAULT_MODEL` (primary open-flexible
  slug override; back-compat alias `FEATHERLESS_CHEAP_MODEL`), `FEATHERLESS_MODEL_<KIND>` (per-job-kind
  overrides), `GEMINI_BASE_URL`/`GEMINI_IMAGE_MODEL`, `VOYAGE_API_KEY` (voyage-3 embeddings, §26).
  LangGraph bridge: `LANGGRAPH_API_KEY`/`_BASE_URL`, `LANGGRAPH_BRIDGE_API_KEY`/`_URL`, plus
  `PAIGE_OS_*` bridge keys/URLs.
  - Featherless plan: **"Feather Per-Request" DEVELOPER** ($50/mo credit, per-request billing, NO
    model-size cap) subscribed 2026-08-10 → open-flexible default is `meta-llama/Llama-3.3-70B-Instruct`
    (allow-listed). Cheap-tier §34 economics restored; Claude remains the frontier/rescue tier.
- **Image / 3D generation (Studio):** `REPLICATE_BASE_URL`, `IDEOGRAM_BASE_URL`, `MESHY_BASE_URL`,
  `STUDIO_REPLICATE_IMAGE_MODEL`, `STUDIO_REPLICATE_3D_MODEL`.
- **Vibe media generation (fal.ai primary — owner build authorization 2026-09-12; MERGED #1153 /
  main `d5387376` and all three functions deployed, capability still config-gated OFF):** `FAL_KEY` (alias `FAL_API_KEY`) ⚠ unset/unverified — owner created the fal
  account via GitHub sign-in; the key is NOT yet stored as an Edge Function secret, and provider
  calls stay fail-closed until the owner also sets `media_provider_ceiling_usd` (admin_app_settings
  or env `MEDIA_PROVIDER_CEILING_USD`) AND a media budget ceiling (`media_budget_daily_usd`
  platform key, per-tenant `media_budget_daily_usd__t_<tenantId>`, or env
  `MEDIA_BUDGET_DAILY_USD`). Optional env knobs: `FAL_QUEUE_BASE_URL`, `FAL_MEDIA_LIFECYCLE` (CDN
  retention preference, default "medium"), `FAL_IMAGE_MODEL_STANDARD`/`FAL_IMAGE_MODEL_PREMIUM`/
  `FAL_EDIT_MODEL`/`FAL_VIDEO_MODEL`/`FAL_VIDEO_MODEL_PREMIUM` (catalog overrides),
  `FAL_WEBHOOK_USER_ID` (callback account pin), `MEDIA_VIDEO_ENABLED` (default false),
  `MEDIA_DAILY_VIDEO_LIMIT` (default 1), `MEDIA_DRAFT_ALLOWANCE_USD` (default 0.10). Webhook
  `paige-media-webhook` deploys with verify_jwt=false (config.toml entry added post-merge + manual
  `--no-verify-jwt` redeploy — a config-only push does not trigger deploy-edge-functions.yml); it
  verifies fal's ED25519 JWKS signatures itself (prod-probed 2026-09-12: unsigned POST → the
  function's own {"error":"unverified"}). Full contract: docs/evidence/ui-delivery/vibe-media-fal.md + migration 20270121000000.
- **`LOVABLE_API_KEY` / `LOVABLE_SEND_URL` (§34 — scoped for removal, task #112):** post-PR #442 these
  are used by ONLY the live **email trinity** (`auth-email-hook` + `process-email-queue` +
  `handle-email-suppression` — `@lovable.dev` HMAC-signing + email DELIVERY) + `preview-transactional-email`
  (caller-auth) + `ship-26-legacy-cleanup` (Drive-push). The Paige chat + the 16 credit/subagent fns NO
  LONGER reference Lovable (purged in #442 — they always ran on direct-Anthropic via `gatewayCompat`). Do
  NOT assume the chat touches Lovable (§10 corrections log 2026-08-10). Removing these is a launch-critical
  email-provider migration (owner-set replacement secret + §32 live-email verify) — see task #112.
- **Visual critique (§33):** `VISUAL_RENDERER_URL`, `VISUAL_RENDERER_SECRET`,
  `STUDIO_VISUAL_CRITIQUE_ENABLED`, `STUDIO_CRITIQUE_MAX_ITERATIONS`, `STUDIO_CRITIQUE_COST_CAP_USD`.
- **Paige browser — self-hosted headless browser (Task #126, §32.c self-verify + §17 public-web browse):**
  edge secret NAMES `PAIGE_BROWSER_URL` + `PAIGE_BROWSER_SECRET` (skill-runner → the Fly host's
  `/self-verify` and `/browse-public-url`; unset → honest `needs_config`, §13). Fly-side (on the
  `paige-browser` app, NOT edge): `PAIGE_BROWSER_SHARED_SECRET` (must equal the edge `PAIGE_BROWSER_SECRET`),
  `PAIGE_BROWSER_WILDCARD_ENABLED` (`true` = wildcard public browsing ON, owner-flipped 2026-08-13),
  `PAIGE_BROWSER_MAX_CONTENT_BYTES` (default 500000). Audit rail: `paige_browser_usage` (written by the
  CALLER edge fn via service_role; the Fly host is DB-free, §9/§34).
- **Email:** `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, plus from-address names
  `PLATFORM_DEFAULT_EMAIL_FROM`, `BILLING_EMAIL_FROM`, `WELCOME_EMAIL_FROM`, `CALENDAR_EMAIL_FROM`,
  `PLATFORM_SUPPORT_EMAIL`.
- **Calendars / meetings:** Google (`GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`, `CALENDAR_ENCRYPTION_KEY`,
  `CALENDAR_OAUTH_REDIRECT_ORIGIN`, `GOOGLE_DRIVE_API_KEY`), Cal.com (`CAL_API_KEY`, `CAL_BASE_URL`,
  `CAL_WEBHOOK_SECRET`), Zoom (`ZOOM_CLIENT_ID`/`_SECRET`, `ZOOM_OAUTH_REDIRECT_URL`).
- **Accounting / banking:** QuickBooks (`QUICKBOOKS_CLIENT_ID`/`_SECRET`,
  `QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN`), Plaid (`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`).
- **Credit / financial data (funding lane — per-tenant opt-in, §2):** `SMARTCREDIT_API_KEY`/
  `_WEBHOOK_SECRET`, `ISOFTPULL_API_KEY`/`_WEBHOOK_SECRET`/`ISOFTPULL_ENABLED`, `ARRAY_API_KEY`/
  `ARRAY_APP_KEY`, `NAV_API_KEY`/`NAV_PARTNER_ID`, business bureaus (`EQUIFAX_BUSINESS_API_KEY`,
  `EXPERIAN_BUSINESS_API_KEY`, `TU_BUSINESS_API_KEY`/`_MEMBER_CODE`, `DNB_API_KEY`/`_SECRET`,
  `LEXISNEXIS_USER`/`_PASSWORD`/`_BUSINESS_ENDPOINT`, `OPENCORPORATES_API_KEY`), `LENDFLOW_ENABLED`,
  `FRED_API_KEY`, `SSN_ENCRYPTION_KEY`.
- **Enrichment / research:** Apollo (`APOLLO_API_KEY`), Firecrawl (`FIRECRAWL_API_KEY`),
  Browserbase (`BROWSERBASE_API_KEY`/`_PROJECT_ID`).
  - **`BROWSERBASE_API_KEY` — present as an Edge Function secret (owner-provisioned 2026-09-07), INFRASTRUCTURE
    READINESS ONLY, NOT WIRED.** No code path reads it; Browserbase is `PROPOSED` (CONDITIONAL GO desk
    review) as the replaceable bootstrap browser-**worker** for the Paige-owned **Secure Browser**, behind a
    provider-neutral internal contract. Credentialed wiring is gated on the seven owner-side vendor gates in
    `docs/audits/paige-secure-browser-provider-review-browserbase-2026-09-07.md`. The secret's VALUE must
    never be revealed, requested, logged, rotated, or tested (§34 — names only in the brain).
- **Docs / signing:** DocuSign (`DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`,
  `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_BASE_URI`, `DOCUSIGN_RSA_PRIVATE_KEY`, `DOCUSIGN_WEBHOOK_HMAC_KEY`).
- **Social / ads:** Meta (`META_APP_SECRET`, `META_PAGE_ACCESS_TOKEN`, `META_DEFAULT_PAGE_ID`,
  `META_IG_BUSINESS_ID`, `META_WEBHOOK_VERIFY_TOKEN`).
- **Notifications:** Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_DEFAULT_ADMIN_CHAT_ID`), Web Push
  (`VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/`_SUBJECT`).
- **Observability:** Sentry (`SENTRY_DSN`), PostHog (`POSTHOG_API_KEY`/`POSTHOG_HOST`).
- **Zapier bridge:** `call-zapier-action` edge fn (Paige→Zapier). Platform/bridge keys:
  `PAIGE_MCP_PLATFORM_KEY`, `PAIGE_BRIDGE_API_KEY`, `PAIGE_OS_CLAUDE_PLATFORM_KEY`.
- **Zapier MCP server address (verified live 2026-09-05):** the address a tenant pastes is
  **`https://mcp.zapier.com/api/v1/connect`** — OAuth, HTTP transport, and the copy-to-clipboard
  form carries a query string. The older `/api/mcp/s/<secret>/mcp` shape is token-auth and still
  valid for servers created before the move, so BOTH prefixes are accepted
  (`tenant-mcp-connect` `isZapierMcpAddress`, mirrored in `settings-integrations`
  `zapierMcpAddressProblem`). Accepting only the legacy prefix rejected the address Zapier issues
  today and the connection could not be started at all. Verified against the live endpoints:
  `/.well-known/oauth-protected-resource/api/v1/connect` → resource + `authorization_servers:
  ["https://mcp.zapier.com"]`; `/.well-known/oauth-authorization-server` → authorize
  `/oauth/authorize`, token `/api/v1/oauth/token`, register `/api/v1/oauth/register`, S256,
  `authorization_code` + `refresh_token`. The HOST is the security boundary; path and query are
  shape checks only. A fragment is still refused.
- **n8n OAuth access-token lifetime (measured on prod 2026-09-05):** **59m59s**. Refresh is LAZY —
  there is no cron; it happens inside `tenant-n8n-oauth` verify and `_shared/n8n-management` when
  the lease reports the token expired. So a refresh defect does not surface until roughly an hour
  of idle time, which is why it read as "disconnected after an update".
- **Misc app config:** `APP_PUBLIC_URL`, `PUBLIC_SITE_URL`, `PAIGE_APP_ORIGIN`,
  `EVAL_COST_CAP_USD`/`EVAL_MAX_CASES` (§34 L2 evals), `SLA_WATCHER_CRON_SECRET`,
  `COMMS_LEGACY_DUAL_WRITE`.

### Operator act-as RPCs (Slice 2, 2026-08-20)

- `public.operator_enter_tenant(uuid)` / `public.operator_exit_tenant()` — SECURITY DEFINER,
  `SET search_path = public`, `EXECUTE` granted to `authenticated` only (REVOKEd from `PUBLIC`/`anon`).
  The grant is NOT the guard (§59): each body re-enforces `is_platform_operator()` and RAISEs 42501
  before any read or write.
- They are the ONLY audited path that changes an operator's `profiles.active_tenant_id`. The header
  `TenantSwitcher` and the Fleet Console `Enter` controls both reach them through
  `useTenantContext.switchTenant`, which routes platform staff to the RPCs and everyone else to the
  direct profile write.
- Every enter/exit writes `paige_audit_log` with `action = 'operator.tenant.enter' | 'operator.tenant.exit'`
  and `actor_role = 'platform_operator'`, in the same transaction as the scope change.
- No secret or env var is involved.

*(This is the inventory of integration **existence**, not an endorsement that each is configured/live.
A name here proves the edge code references it; it does not prove the secret is set on prod.)*

---

*Regenerate the verified rows whenever infra changes; any config-touching PR updates this file in the
same commit (§BRAIN.3). Never paste a secret value — if you need to prove a secret is set, cite the
deploy/CI check, not the value.*

### A2P legal identity ownership — draft 2026-09-01

- Tenant legal sender data is owner-confirmed in Setup and canonical in `tenant_legal_profile`.
- Full EIN/tax registration numbers are write-only from the browser and stored in Supabase Vault;
  browser reads receive only the last four digits.
- Tenant Customer Profile, Trust Product, Brand, Campaign, and Messaging Service SIDs are
  server-owned fields on the tenant's A2P registration record.
- The platform operator's Twilio Primary Customer Profile belongs to the master account and must not
  be copied into tenant subaccounts. No SID or secret value belongs in this registry.

### Solo n8n OAuth production release — 2026-09-03

Paige is the AI COO: the n8n connection supports the documented automation-authoring direction in `docs/paige-n8n-orchestrator-brain-doctrine.md`, not a permanent read-only product ceiling. The owner approved `workflow:read` and `workflow:write` for every Solo workspace. Connection-time metadata discovery does not itself create or run workflows. API health remains a separate connection.

Released PR #909 (49b9f338) adds `tenant-n8n-oauth`, owner/session/workspace-bound one-time PKCE attempts, encrypted token storage and editable/reconnectable Solo OAuth controls. Hosted gateway callback URL retention is an explicitly accepted MVP risk; additional ingress hardening is deferred. Application logging remains sanitized. No provider setting or webhook change is required by this slice. Candidate proof and release status: `../delivery/solo-n8n-oauth-mvp.md`. Production backend, migration and both frontend domains are verified deployed. Final owner consent and authenticated provider discovery are not yet verified.

### n8n callback transport correction — 2026-09-03

First owner consent exposed a hosted runtime URL rewrite missed by public-URL unit fixtures. The exact function path /tenant-n8n-oauth differs from the registered public callback path; the gateway also rewrites origin. Do not compare the runtime origin to the registered redirect URI. Keep registration/exchange fixed to the public redirect and preserve state/session/tenant/browser validation. Source and harmless Boolean probe evidence: docs/delivery/solo-n8n-oauth-mvp.md. Owner consent success still requires a fresh post-repair pass.

### Solo orchestration MVP — A2P workspace repair, 2026-09-04 (candidate)

Owner direction authorizes implementation through green-gated release for reusable Solo orchestration, imports, external intake and SMS readiness. PAIGE remains the AI COO: read, reason, write, delegate, execute and follow through; preparation-only behavior is an unfinished capability, not a product ceiling.

The first repair closes a confirmed A2P workspace-switch defect. The editor is keyed by workspace, delayed responses are fenced, handlers pass a captured-workspace precondition, prompt context is explicitly tenant-scoped, and the save/insert trigger rejects a changed tenant rather than redirecting the write. Ordinary Solo owners/admins gain the same captured-tenant preparation authority using is_tenant_admin_as and a current-workspace SELECT policy. Carrier submission is still absent; this repair does not make SMS registration ready.

Automated evidence: UI and actual-handler tests with injected database/model ports; isolated PostgreSQL role, replay and lock-wait race tests. Independent adversarial source review passed after two additional races were corrected. Authenticated production owner-flow proof remains owed. No real customer record, workflow, campaign, carrier submission or sender identity was changed to produce proof.
