# PAIGE Mail — Multi-Tenant Deliverability & Reputation Gap Assessment (ANT-43)

**Owner:** Mail agent lane (P-ANT-12; ANT-43, coordinated with ANT-40/44 and the Marketing owner).
**Date:** 2026-10-11. **Status:** source-grounded assessment + phased architecture. **Authorizes
nothing:** no DNS change, purchase, provider call, or live send. Branding unchanged — tenants see
**PAIGE Email**; PLATFORM_OPERATOR governs all provider infrastructure. Resend policy restrictions
(including prohibited credit-repair/debt-relief traffic without written permission) and INT-346
gates are preserved.

## 1. Inventory — what exists today (grounded on main `cbd10e9c7`)

| Capability | State | Source |
|---|---|---|
| Sender identities | **EXISTS** — `tenant_sender_identity()` primary; connector `from_address` fallback (precedence identical at draft and send) | send door; ANT-38 lineage |
| Provider credential | **EXISTS (single platform account)** — operator-managed `admin_app_settings` + env; one Resend account, Svix multi-secret rotation | both Resend doors |
| Tenant→domain mapping | **PARTIAL** — `channel_connectors.inbound_address/inbound_domain` (inbound only; globally unique); NO sending-domain registry, NO per-tenant domain rows | migrations; #1089 |
| Email types | **EXISTS** — transactional doors + marketing (campaign worker/queue behind the same boundary) | functions inventory |
| DKIM/SPF/DMARC state | **ABSENT** — zero source references; no verification records surfaced, tracked, or health-checked | `git grep -ci dkim|spf|dmarc` = 0 |
| Provider adapter | **EXISTS** — canonical boundary `comms_provider_execution_allowed(uuid,uuid,text)` + provider floor; provider-id abstraction designed (study §3), single implementation | #1884 lineage |
| Dispatch policy | **EXISTS** — per-tenant `comms_provider_execution_disabled`, operator policy, action-risk/one-approval-gate | boundary migrations |
| Quotas / per-tenant rate limits | **ABSENT for email** — generic `public_rate_limits` table exists; no email-specific limits or per-tenant send budgets | migrations |
| Suppression | **PARTIAL** — `handle-email-suppression` (Mailgun-shaped receiver) + `email_send_log` complained/bounced statuses; no per-tenant suppression enforcement at the send boundary | functions |
| Bounce/complaint tracking | **EXISTS (receipt-level)** — append-only `email_send_log` with verified statuses via signed webhook + `ingest_resend_receipt`; **no thresholds, no auto-suspension** | 20260903235327 |
| Delivery receipts | **EXISTS** — Svix-verified, deduped, journaled; #1978 hardened both doors | ANT-40 |
| Sending IP / pools | **ABSENT** — zero source references | grep = 0 |
| Warmup, domain lifecycle, suspension/recovery | **ABSENT** | — |

## 2. Resend capability (documented vs assumed)

Documented (public docs/KB, 2026-10): many domains per account — multi-tenant verified
sending domains are an explicit use case (extra domains ≈ $20/mo add-on; Enterprise to 1,000
domains); a dedicated-IP add-on (one per account; **no documented IP pools or per-domain IP
routing**); account-level separation only via separate Teams/workspaces (own keys/billing/domains).
**Verified conclusion:** Resend supports tenant-isolated *authenticated domains* and PAIGE-side
policy/limit enforcement through the existing single Platform-Operator connection, but **cannot
provide per-tenant sending-IP isolation**, and the whole platform rides **one provider account's
compliance/AUP blast radius**. Multi-account (workspace-per-tenant) isolation exists as a pattern
but multiplies operator credential/billing surface ×N and is an owner architectural decision, not
an implementation detail.

## 3. Vendor comparison — multi-tenant capability (verified provider capability ≠ PAIGE implementation)

| Dimension | Resend (current) | SendGrid | Mailgun | Amazon SES | HighLevel |
|---|---|---|---|---|---|
| Tenant hierarchy | Teams/workspaces (manual, ×N accounts) | **Subusers** (native) | **Subaccounts** (native; per-sub keys/limits/feature controls) | None — DIY via identities/configuration sets | Agency→location sub-accounts (built for the agency case) |
| Per-tenant domain auth | ✔ domain-per-tenant documented | ✔ sender auth per subuser | ✔ per subaccount | ✔ identities | ✔ per location |
| Per-tenant IP isolation | ✖ single dedicated IP/account, no pools | ✔ **IP pools assignable per subuser** | ✔ dedicated IPs (allocation faster than SES) | ✔ dedicated IPs (slower allocation; managed pools on standard) | platform pools |
| Blast-radius isolation | ✖ one account | ✔ per subuser | ✔ per subaccount | ✖/partial (one account; per-identity reputation) | platform account |
| Cost at scale | simple tiered | higher | mid | **cheapest at scale**, most setup | flat SaaS |
| Fit | current transport; fine for Phase A/B | strongest native match for premium IP isolation (Phase C+) | strong alternative; existing suppression receiver is already Mailgun-shaped | cheapest at 10k tenants; ops-heavy | reference product, not a transport candidate |

Sources: [Resend domains/multi-tenant](https://resend.com/docs/add-a-domain), [Resend KB](https://resend.com/docs/knowledge-base), [SendGrid IP pools](https://support.sendgrid.com), [SendGrid dedicated IPs](https://www.twilio.com), [Mailgun subaccounts](https://documentation.mailgun.com), [Mailgun feature controls](https://www.mailgun.com), [SES comparison](https://labnify.com), [ESP comparison](https://www.brilworks.com).

## 4. Four isolation dimensions — current truth

1. **Tenant data access:** **STRONG** (RLS engine-only writes, is_tenant_admin reads, personal-mailbox predicates, receipt doors tenant-resolved). The strongest dimension today.
2. **Authenticated domain reputation:** **WEAK** — no BYOD; single platform sender identity; nothing tracks tenant-domain DKIM/SPF/DMARC.
3. **Sending IP/pool reputation:** **NONE** — shared provider IPs only; no PAIGE concept of pools; impossible to isolate a noisy tenant's IP reputation.
4. **Provider-account/compliance blast radius:** **MAXIMAL** — one Resend account: one AUP strike, one compliance event, or one pricing change affects every tenant. This is the existential gap the credit-content matrix (study §4) already partially mitigates at the policy layer.

## 5. Phased architecture (recommendation; each phase = smallest viable slices)

- **Phase A — Managed included (Model B):** dedicated PAIGE org domain + per-tenant authenticated
  subdomains; domain registry rows (tenant, domain, class, verification state, last-checked) on the
  existing connector model; Svix/provider verification via operator; fail-closed send until
  verified. *Isolation gained: dimension 2 per-tenant.*
- **Phase B — BYOD (Model C):** tenant-owned domains through the one PAIGE Email interface
  (ANT-40 study §2 design): records display, provider provisioning invisible, owner/admin-only.
- **Phase C — Deliverability controls:** per-tenant send budgets/rate limits on `public_rate_limits`;
  bounce/complaint thresholds with automated suspension (soft, owner-notified, one-approval-gate
  recovery) reading the existing `email_send_log`; suppression enforced at the send boundary;
  warmup schedules for new domains (paced ramp inside the existing dispatch path).
- **Phase D — Premium dedicated IP/pools + enterprise isolation:** requires per-tenant IP routing
  Resend cannot provide → either (a) SendGrid/Mailgun second provider behind the canonical boundary
  for premium tiers (subuser/subaccount per tenant, IP pool per subuser), or (b) SES at high
  volume. Decision is owner-level (transport study §3); **buy, don't build** stands.
- All phases map to existing contracts: **Comms** boundary/doors; **Spine** capability keys
  (`comms.*`, seatAuthority workspace-admin); **Harness** action bus (suspension/recovery =
  paige_actions, never a side channel); **Trust** one-approval-gate + action-risk; **Rail**
  receipts on `email_send_log`/capability runs; **Metric/Evidence Fabric** provider-event readback
  producers; **Chat/Live** capability projection only (INT-346 gated). No second control plane,
  ledger, or authorization system.

## 6. Exists / absent / needs approval

- **Exists:** receipts, signed doors, engine-only writes, tenant authority, dispatch policy,
  suppression receivers, inbound completion (inert).
- **Absent (engineering, no external gate):** domain registry + verification state; email rate
  limits; thresholds/auto-suspension; warmup; boundary suppression enforcement; BYOD UI flows.
- **Needs owner/provider approval:** dedicated org domain purchase + DNS; Resend domain add-ons +
  (if ever) multi-workspace; any second provider account (SendGrid/Mailgun/SES) — selection,
  cost, AUP review; credit-content written-permission records; pilot execution.

## 7. Cost & complexity estimates (explicit assumptions)

Assumptions: managed tier ≈ 1,000 sends/tenant/mo (100 tenants = 100k; 1k = 1M; 10k = 10M
sends/mo); premium tier 5% of tenants; provider pricing tiers as published 2026-10 (order of
magnitude, not quotes).

| Scale | Resend-only (A/B/C) | + Premium via 2nd provider (D) | Operational complexity |
|---|---|---|---|
| 100 tenants | ~$100–300/mo + domain add-ons (~$20/mo each if per-tenant Resend domains; Phase A subdomains = 1–2 domains) | ~+$100–200/mo (few subusers + 1–2 IPs) | Low — one boundary, one operator console |
| 1,000 | ~$500–1,500/mo (tier jumps; Phase A keeps domain count O(1)) | ~+$500–1,000/mo (≈50 subusers + pools) | Medium — thresholds/suspension automation essential; domain lifecycle jobs |
| 10,000 | $3k–8k/mo; Resend tier limits become a real conversation | SES likely cheapest ($1k–3k/mo at 10M) + self-managed reputation ops | High — dedicated deliverability function: warmup, blocklist remediation, per-tenant triage; this is the buy-vs-build decision point from the transport study |

## 8. Smallest viable engineering slices (ordered)

1. **S1 Domain registry + verification state** (Phase A substrate; schema + operator readback; no
   DNS) — enables everything else.
2. **S2 Per-tenant email budgets + boundary enforcement** (public_rate_limits rows + door check +
   truthful refusal).
3. **S3 Bounce/complaint thresholds → automated soft suspension + governed recovery** (reads
   email_send_log; paige_actions recovery; owner notification).
4. **S4 BYOD connect-domain flow** (S1 + the ANT-40 §2 design; Connections surface).
5. **S5 Credit-content provider-policy enforcement** (already committed as the ANT-40-successor
   slice; study §4 — it is also this lane's blast-radius mitigation).
6. **S6 Warmup pacing** (dispatch-path ramp for new/cooling domains).
7. **S7 Premium-tier second-provider adapter** (only after the owner's provider decision; Phase D).

**One-PAIGE note:** the Mail row set in the One-PAIGE Capability Integration & Proof Matrix
(`docs/product/int342-marketing-convergence.md` §M3) remains the canonical matrix; this document's
tables are lane working state, subordinate to it.
