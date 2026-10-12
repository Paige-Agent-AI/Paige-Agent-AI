# PAIGE Computer — External Website Skills & Use-Case Catalog

Date: 2026-10-11 · Status: CATALOG + PRIORITIZATION ONLY. Nothing below is implemented or authorized for live execution. Every skill ships only through the staged PC gates (engineering → security review → design → effectful acceptance), and none may execute a real filing, payment, login, or unrestricted browse until its own owner approval lands.

Canonical fields per skill: **owner** (owning surface), **destinations** (permitted site classes), **data classification** (what Paige may read/prepare), **risk**, **approval required**, **site constraints**, **resource cost**, **authoritative verification**, **failure handling**, **customer value**.

## Priority tiers

### Tier 1 — read/prepare only (PC-1 envelope: read-only, redacted, receipted)
| Skill | Owner / destinations | Class / risk / approval | Verification & failure | Value |
|---|---|---|---|---|
| `browse_public_url` (SHIPPED PC-1) | paige-skill-runner / arbitrary public URLs behind owner flag | public data / read_only / none | Rail row + capability receipt; honest blocked/failed states | "Paige, read this page" |
| `filing_portal_recon` | research lane / official secretary-of-state portals (read) | public+entity facts / read_only / none | same as browse; entity facts reconciled against tenant records | pre-filing fact check |
| `document_retrieval` | research lane / public registries, county recorder search pages | public / read_only / none | download → Vault quarantine (currently REFUSED by design until PC-2 intake) | get the official copy |

### Tier 2 — form preparation + preview (PC-2/3 envelope: supervised sessions, no submission)
| Skill | Owner / destinations | Class / risk / approval | Verification & failure | Value |
|---|---|---|---|---|
| `annual_report_prepare` (FLAGSHIP — see `docs/prototypes/pc-annual-report-filing-flow.md`) | PAIGE Computer / one named state portal per run | entity data + owner answers / mutating-draft / chat-canonical approval before ANY submit | exact filing preview diff vs reconciled facts; outcome_unknown surfaces honestly | the flagship workflow |
| `business_registration_prepare` | PAIGE Computer / state registration wizards | entity data / mutating-draft / approval | same pattern | new entity filings |
| `license_renewal_prepare` | PAIGE Computer / licensing portals | license data / mutating-draft / approval | same pattern | renewals |
| `vendor_portal_prepare`, `marketing_admin_prepare`, `workforce_admin_prepare`, `real_estate_prepare` | respective lanes / named vendor+admin portals | scoped per site / mutating-draft / approval | same pattern | admin burden off the owner |

### Tier 3 — effectful execution (PC-4 envelope: exact destination/action approval + protected handoff + authoritative receipt)
`filing_submit` (official submission), `fee_payment_handoff` (protected checkout on the TENANT'S own rails, §38 — Paige never merchant of record), `filing_receipt_persist` (authoritative confirmation + receipt). Each requires: independent security review, live verified readback before "completed" is claimable, and per-run owner approval of the EXACT destination and action.

## Cross-cutting rules (every tier)
- Destinations are named per run (origin-pinned scope, `allowed_scope`); wildcard browsing stays owner-flagged.
- Data classification follows the Vault assessment: credentials/payments NEVER enter prompts, transcripts, screenshots, artifacts, or logs (PC-1 scrubber + rail redaction are the enforcement precedent).
- Failure handling is truthful-first: `outcome_unknown` is a terminal honest state, never retried into a claim.
- Resource cost is metered per tenant via the control plane (seconds + microusd columns already in prod schema).
