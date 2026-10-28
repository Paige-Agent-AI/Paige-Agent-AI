# EXP06 service-enable decision — Cloudflare static hosting for exported pages (WEB-05)

Status: **PREPARED for the owner's enable decision — corrected per owner review
(ANT-162 `80189cce`, 2026-10-27)**. Nothing here is activated; enabling requires the
owner's explicit go on THIS decision. Corrected in this revision: the build-state
contradiction ("no new engineering" vs a final section that described unbuilt work) is
removed — built vs missing is now stated plainly, with accountable owners; the Cloudflare
facts are verified against current official docs (checked 2026-10-26, cited inline); the
metering claim is corrected to PROOF OWED; and platform-owner enablement is explicitly
separated from each customer's page-publication approval.

## The service

Hosting a page's **portable export** (PR6 #2954: the static HTML/CSS/JS download of the
PUBLISHED version — zero scripts, manifest lineage) on **Cloudflare Workers Static
Assets**, giving a customer's page an address the customer controls hosting for.

## Two DIFFERENT approvals this decision keeps separate

1. **PLATFORM OWNER service enablement (the decision this packet requests).** Once: the
   owner names the existing PAIGE Cloudflare account, creates the scoped API token
   (below), and says "enable hosting." This turns the service on for the platform. It
   does NOT publish anyone's page.
2. **EACH CUSTOMER's page-publication approval (already built, unchanged).** Per
   workspace, per export: the workspace owner approves their own page's deployment
   through the existing PAIGE approval card (the same fingerprint-governed lane as every
   publish). Neither approval implies the other; a customer approval before platform
   enablement correctly shows "hosting isn't switched on yet," and platform enablement
   alone publishes nothing.

## The exact decision, reviewable line by line

| Facet | The concrete answer |
| --- | --- |
| **Actor who enables the SERVICE** | The platform owner (once): account identity + scoped token + explicit go. |
| **Actor who publishes a PAGE** | Each workspace owner, through the existing PAIGE approval card — never PAIGE silently, never a lane agent. |
| **Action enabled** | Create/update/delete ONE static-site deployment per approved export, under the PAIGE Cloudflare account. |
| **Scope** | Exactly the bytes of an approved portable export + its manifest. No tenant data beyond the published page's own public content. No DNS changes in this decision (a custom address is a separate, later decision). No Stream/R2/media (separate service-enable decision on its own evidence). |
| **Cloudflare account identity** | **OWNER-HELD FACT, not visible to this lane.** The existing PAIGE Cloudflare account ID/name must be named by the owner (or EXP10, which owns connection/credential custody) at enable time. This packet does not assume or invent it. |
| **API token (exact, corrected per `350e030f`)** | One token, permission group **"Workers Scripts:Edit"** (Account category). **Honest exposure: this grants write access to EVERY Workers script in the PAIGE account** — Cloudflare defines no per-script scope and no static-assets-specific permission group, so the token itself must NOT be described as limited to one job or one deployment. The per-deployment limit is enforced by PAIGE's own executor (it only ever issues the one approved deployment call per customer approval), by secret custody through EXP10, and by audit — not by the token. NO Zone permissions (no DNS), no Billing, no R2/Stream/KV. Account ID/plan and actual credential resource exposure are UNVERIFIED owner-held facts. |
| **Cost basis (verified facts, no ceiling)** | Per current official docs (checked 2026-10-26): **"Requests to static assets are free and unlimited"** and **"There is no additional cost for storing Assets"** (workers/static-assets billing page); limits that DO apply: 25 MiB per file, 20,000 files per Worker version on the Free plan (100,000 Paid) (workers platform limits). This export shape is zero-script, so no Worker invocations bill (invocation pricing applies only when a Worker runs; our deployment serves assets without one). **No cap is configured or implied** — if a billable component ever applies (e.g. a future shape that invokes a Worker), it is billed by Cloudflare at published rates and attributed to the tenant. Actual account plan/discounts/minimums are owner-held facts read at enable time — PROOF OWED, not assumed. |
| **Metering (corrected)** | **PROOF OWED — per-tenant usage measurement for hosted pages is NOT built.** A deployment per tenant is attribution, not metering. When the service is enabled, hosting usage (deployments; billable requests if any ever apply) will be written to the canonical platform usage meter (`platform_usage_events`, the existing LAYER-1 pattern other PAIGE services already write) — that writer is part of the missing engineering below, not an existing fact. No second ledger. |
| **Effect when enabled** | The page's export becomes reachable at a `*.workers.dev` (or PAIGE-project) HTTPS address; the platform's live page at its reserved address is untouched (the export is a copy, never a move). |
| **Rollback** | One step: delete the deployment (or repoint). The platform's published version keeps running the whole time. Recovery is the host-path step 4 already shipped in the Studio's guidance. |

## What is BUILT today (verified, production-readback-proven)

- The export itself (PR6 #2954, merged/deployed/readback-verified): versioned static
  file + manifest, no scripts, lineage, provenance.
- The owner-gated four-step host path in the Studio's publish panel (PR7 #2988): export →
  owner-approved hosting → verify the real HTTPS address → recover. Guidance states
  verified cost facts (free/unlimited static requests; metered, not capped).
- The truthful state model: a hosted copy is never called live until the address actually
  serves HTTPS; recovery states what removing it does.
- The customer-side approval lane: the existing publish-card/fingerprint machinery that
  will gate each customer deployment.

## What is NOT built (named, with accountable owners — the earlier "no new engineering
required to activate" line was wrong and is withdrawn)

| Missing piece | Accountable owner |
| --- | --- |
| Platform-side deployment executor (server function calling the Cloudflare API with the scoped token; one deployment per approved export; delete on unpublish/recover) | **EXP06 (this lane) — BUILDING NOW per owner `88b2f756`** (within existing authority; ships dormant-fail-closed while activation is held) |
| Real HTTPS readback verification before any "live" claim on a hosted copy | **EXP06** — same increment (code real now; live proof PROOF OWED until activation) |
| Per-tenant usage writer → `platform_usage_events` (metering, above) | **EXP06** — same increment, reusing the canonical meter (no second ledger) |
| Account identity + token creation + secret custody | **Owner** (identity, token) via **EXP10** (custody path) — ONE concrete reviewable decision at activation time, per `88b2f756` |
| Provider registry entry when activated | **EXP10** (noted in matrix row 11) |

## When the owner says "enable" (unchanged in substance — the engineering arrives first now)

Per owner `88b2f756` (2026-10-28): the implementation above is being completed through
normal review/checks/safe release **now**, with provider activation HELD — no token
exists, so every hosting path honestly returns "hosting isn't switched on yet." At
activation the owner supplies the account identity and token (EXP10 custody) as ONE
concrete decision; EXP06 then turns the dormant service on under the standing gates, with
each customer deployment gated by that customer's own approval card. Until then WEB-05's
live-deployment proof stays BLOCKED by design and nothing here provisions anything.
