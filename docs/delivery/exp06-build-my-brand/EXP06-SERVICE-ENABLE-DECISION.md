# EXP06 service-enable decision — Cloudflare static hosting for exported pages (WEB-05)

Status: **PREPARED for the owner's enable decision** (supersession 2026-10-27, ANT-162
`650ca4eb`: no monetary ceiling — this is the concrete service-enable decision that replaces
the earlier "authority + spend ceiling" ask). Nothing here is activated; enabling requires the
owner's explicit go on THIS decision.

## The service

Hosting a page's **portable export** (PR6 #2954: the static HTML/CSS/JS download of the
PUBLISHED version — zero scripts, manifest lineage) on **Cloudflare Workers Static Assets**
(the platform's existing provider family; Pages is the allowed alternative), giving a
customer's page an address the customer controls hosting for.

## The exact decision, reviewable line by line

| Facet | The concrete answer |
| --- | --- |
| **Actor who enables** | The workspace owner (the business owner whose page it is), through a PAIGE-prepared approval card — never PAIGE silently, never a lane agent. |
| **Action enabled** | Create/update/delete ONE static-site deployment per approved export, under a PAIGE-held Cloudflare account/project scope. |
| **Scope** | Exactly the bytes of an approved portable export + its manifest. No tenant data beyond the published page's own public content. No DNS changes in this decision (a custom address is a separate, later decision). |
| **Permissions needed** | A Cloudflare API token scoped to Workers Static Assets (or Pages) deployments for the PAIGE project only — no account-wide, no DNS, no zone, no billing read. Stored as a platform secret; never exposed to tenants or agents. |
| **Cost basis (no ceiling — facts)** | Static asset hosting sits in Cloudflare's **free tier** for this shape today; requests beyond free allowances are billed by Cloudflare at its published rates with NO cap configured per the owner's supersession. Usage is attributable per tenant (each deployment is per-tenant), visible in the platform's metering. |
| **Effect when enabled** | The page's export becomes reachable at a `*.workers.dev` (or PAIGE-project) HTTPS address; the platform's live page at its reserved address is untouched (the export is a copy, never a move). |
| **Rollback** | One step: delete the deployment (or repoint). The platform's published version keeps running the whole time. Recovery is the host-path step 4 already shipped in the Studio's guidance. |
| **What this decision is NOT** | Not a domain purchase, not a DNS change, not managed many-customer hosting (separate owner decision), not media Stream/R2 (separate service-enable decision on its own evidence), not a monetary ceiling (none exists per the supersession). |

## What is already built and waiting (no new engineering required to activate)

- The export itself (PR6 #2954, merged/deployed/readback-verified): versioned static file +
  manifest, no scripts, lineage, provenance.
- The owner-gated four-step host path in the Studio's publish panel (PR7 #2988): export →
  owner-approved hosting → verify the real HTTPS address → recover.
- The truthful state model: a hosted copy is never called live until the address actually
  serves HTTPS; recovery states what removing it does.

## When the owner says "enable"

The implementing lane (EXP06) prepares the token-scope setup, the deployment flow behind the
same approval-card path, and the verification readback (real HTTPS before any "live" claim) —
under the standing gates (exact CI, review, deploy, readback), with each customer deployment
gated by that customer's own approval card.
