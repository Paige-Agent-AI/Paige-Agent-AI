# PAIGE Mail — Domain Architecture, Transport Independence, Compliance Matrix, and Pilot Prerequisites

**Owner:** Mail agent lane (P-ANT-12, ANT-40..44). **Date:** 2026-10-11. **Status:** decision
study and design — no DNS change, domain purchase, provider activation, or traffic routing is
authorized by this document. Branding contract (owner clarification 2026-10-11) governs throughout:
tenants see **PAIGE Email — Provided by PAIGE Agent AI**; the transport provider is invisible to
tenants; PLATFORM_OPERATOR retains full provider administration.

## 1. Domain architecture — recommendation

Owner direction (approved): a dedicated organizational domain for PAIGE-managed email, protecting
the primary corporate domain's reputation. Three models compared:

| Model | Deliverability | Tenant reputation isolation | Cost | Abuse exposure | Customer experience |
|---|---|---|---|---|---|
| A. Shared PAIGE domain (`@paige-email.tld` style) | Good after warmup; one reputation pool | None between tenants (one pool) | Lowest | One abusive tenant can degrade everyone | Every tenant mail carries a PAIGE-owned domain — poor brand fit for business sends |
| B. PAIGE org domain + per-tenant authenticated subdomains (`tenantA.mail.paige-email.tld`) | Good; subdomain reputation is partially distinct (DKIM d= per tenant subdomain) | Good: provider reputation systems track per-DKIM-domain; blocklists mostly per-domain | Low–moderate | Bounded: a poisoned subdomain is identifiable and revocable without touching siblings | Better: mail is visibly routed via the tenant's PAIGE workspace; replies route inbound automatically |
| C. Tenant-owned (BYOD) verified domains | Best: tenant's own reputation, own alignment | Complete | Per-tenant DNS effort | Tenant-owned; PAIGE enforces policy at the send boundary | Best for business identity; requires DNS access the tenant controls |

**Recommendation: B as the included default, C as the first-class upgrade — both behind one PAIGE
Email interface.** Model B gives every eligible Solo business a working, reply-capable email address
at onboarding with zero DNS work and bounded blast radius; Model C (BYOD) is the upgrade path the
owner's clarification names: "customers connect their business domains through the PAIGE Email
interface; PAIGE handles the underlying provider setup and verification workflow." Model A alone is
rejected: it concentrates reputation risk and brands tenant mail with PAIGE's name.

**Separate organizational domain (the approved direction):** purchase a dedicated domain (or reuse
an existing non-primary property) for all Model B subdomains and platform notification traffic.
The primary corporate domain is never a sending domain for tenant mail. Domain purchase and all DNS
changes remain separately approved owner actions.

## 2. BYOD domain integration design (Model C through PAIGE Email)

Scope: Settings → Connections → PAIGE Email → "Connect your domain" (the one interface; no provider
names, no provider credentials, no Resend exposure).

1. **Request + records.** The tenant owner enters a domain they control. PAIGE generates the
   provider's required verification records (DKIM, SPF include, return-path CNAME, and a DMARC
   recommendation) and displays them with copy buttons and per-record status
   (`pending` / `verified` / `failed`), backed by `channel_connectors`-adjacent storage for domain,
   verification state, and last-checked timestamps. No second connector model: a BYOD domain is an
   attribute of the tenant's existing PAIGE Email connector (`mailbox_class='shared_support'`
   semantics unchanged).
2. **Verification workflow.** PAIGE (platform-operator-side) provisions the domain at the provider
   through the provider API and polls verification. Tenants never receive provider dashboard links
   or credentials. Failed verification tells the truth (which record, which observed value).
3. **Readiness + health.** The domain's verified/failed state feeds the existing Connections
   readiness contract (`connections/available` operating-state truth) and the Chat capability
   projection. Sending is refused (fail-closed, truthful error) until verification completes —
   the canonical provider floor already refuses unverified sends.
4. **Authority.** Domain add/remove is tenant owner/admin only (`is_tenant_admin`), one-approval-
   gate, receipt-covered, and never a per-staff action. Removal is soft (revocation), preserving
   history and receipts.
5. **Inbound pairing.** A BYOD domain optionally enables inbound (`inbound_domain` wiring) once MX
   records verify — closing the #1089 loop for that tenant through the existing
   `handle-inbound-email` resolution chain (no new inbound path).

Design debt deliberately excluded: no per-tenant provider accounts, no tenant-visible analytics
beyond PAIGE's own receipt/health readback, no SMTP/IMAP bridging in this slice (external email
services connect as optional customer-selected providers, separate from included PAIGE Email per
the owner clarification).

## 3. Transport architecture — build versus buy

*(SUPERSEDED BY OWNER DIRECTIVE 2026-10-14: the target transport is SendGrid for all PAIGE email and Resend is being retired; the
paragraph below is kept as the 2026-10 record of the then-current state. Plan: `docs/delivery/exp03-launch-email-providers-plan.md` (addendum "SendGrid-only cutover plan").)*

Current state: Resend is the transport implementation behind the canonical boundary
(`comms-provider-boundary.ts` + `comms_provider_execution_allowed`; Svix-verified receipt and
inbound doors; suppression, bounce, and delivery-state tracking). The boundary is the asset: every
send already passes one governed door with provider-specific policy enforcement.

**Evaluation (summary):**

- **Buy (status quo, Resend):** lowest operational load; managed IP reputation, deliverability
  tooling, compliance program; cost scales with volume. Risks: single-provider dependency, AUP
  restrictions on credit-repair/debt-relief content (see §4), account-level blast radius, price
  changes.
- **Buy (second provider, e.g. a transactional alternative with permissive content policy):**
  retains managed operations while de-risking the AUP single point of failure. The canonical
  boundary already isolates provider choice: a second adapter behind the same door is additive.
  Adds vendor management and credential surface.
- **Build (self-hosted outbound/inbound):** maximal independence and content-policy control;
  requires dedicated IPs with warmup (months), reverse-DNS/SPF/DKIM/DMARC ops, bounce/FBL/abuse
  desk handling, IP blocklist remediation, and 24/7 on-call. Industry failure mode: reputation
  collapse under-scaled abuse handling. Cost is dominated by operations, not infrastructure.

**Recommendation: buy, with a provider-agnostic seam and a bounded second-provider evaluation —
do not build.** Keep Resend as transport; complete the provider abstraction at the canonical send
boundary (provider id + capability/content policy per provider); evaluate one alternative
transactional provider for the credit-content categories Resend restricts (routing those categories
to the compliant provider instead of stopping them). Revisit build only if volume economics or
content-policy walls make two managed providers untenable — that decision is the owner's, with this
study as input. **No replacement mail server is built before that decision** (owner addendum 2).

## 4. Compliance decision matrix — credit-related email

Owner addendum 3: credit education, funding, and credit-repair workflows are approved product
categories; lawful, consent-based messaging preserved; **provider-specific content restrictions
enforced at the canonical send boundary**; Resend-prohibited credit-repair/debt-relief opportunity
traffic must not transit Resend without written permission.

| Content category | Lawful/consent basis | Resend policy | Routing decision |
|---|---|---|---|
| Credit education (general financial literacy, no services offered) | CAN-SPAM/consent floor; existing marketing consent machinery | Permitted | Resend |
| Funding / business-financing offers (Funding Coach Blueprint, marketplace referrals) | Consent + truthful sender/subject; GLBA-sensitive data stays out of email bodies | Permitted (standard marketing rules) | Resend |
| Credit-repair SERVICES communication (client's own engaged service, transactional status) | Transactional/service messages to an existing customer | Review against Resend AUP; presumed restricted absent written permission | Compliant provider (§3) until written permission exists |
| Credit-repair/debt-relief OPPORTUNITY traffic (acquisition, upsell, "we can fix your credit" marketing) | Requires consent + provider permission | **Prohibited without written permission** | Refused at the boundary unless (a) written permission on file (platform-operator-managed flag) AND (b) routed to the permitted provider |

**Enforcement design (next engineering slice):** a content-class classifier + provider-policy table
at the canonical send boundary. Every send is classified (education / funding / credit-repair
service / credit-repair opportunity / neutral) by subject+body heuristics with a conservative
default (unknown → treat as the most restricted matching class); the provider-policy table decides
refuse-vs-route per provider; refusals are truthful (`PROVIDER_CONTENT_POLICY`) and receipt-covered;
overrides exist only as platform-operator-managed written-permission records, never per-tenant
flags. No content is rewritten to dodge policy — the AUP is complied with, not circumvented.

## 5. Eight-case acceptance pilot — exact remaining prerequisites

The bounded pilot (controlled PAIGE test identities/domains/recipients; no customer campaigns; no
broad activation) is approved in principle. Engineering side is ready end-to-end at the source
level: two-mailbox substrate (#1880), tenant-scoped authority (#1944), inbound completion (PR #1978, branch
ant40-inbound-completion — open at this writing: canonical Svix verification,
retry-true dedup, durable engine sweep) and the engine-only-writes decision it
carries. The
following remain, each a separately authorized external action:

1. **Dedicated organizational domain** — owner selects/approves the domain (purchase + registration
   are owner actions); PAIGE never purchases.
2. **DNS** — owner-approved DNS changes on that domain (provider verification + inbound MX).
3. **Resend domain provisioning** *(SUPERSEDED BY OWNER DIRECTIVE 2026-10-14: domain authentication moves to SendGrid, done through the
   operator-only admin credential — cutover P3; this step is kept as written)* — platform-operator action in the Resend console: add the domain,
   retrieve verification records, enable inbound, obtain the Svix signing secret (multi-secret
   rotation supported by both doors).
4. **Secret installation** — `RESEND_WEBHOOK_SECRET` (env or operator-managed settings row) for the
   two webhook doors.
5. **Connector wiring** — a `channel_connectors` row for the pilot tenant with
   `inbound_address`/`inbound_domain` set (#1089's inert-by-design switch); this is product usage
   on a controlled test tenant, not code.
6. **Controlled test identities** — QA #1832's approved synthetic account provisioning (credential
   injection by its owner; no secret search); INT-346 restrictions verified before ANY effectful
   execution.
7. **Written authorization for the effectful round** — the pilot's live sends/inbound receipts
   against controlled recipients, plus any privileged identity changes, remain separately
   authorized per the addendum.
8. **Compliance gate** — §4's boundary classifier shipped and green in CI before any credit-related
   pilot case runs.

Until 1–8 complete with verified provider round-trips and source-backed receipts, **no full
operational acceptance is declared**.

## 6. Mail four-surface integration & proof status (lane-maintained)

The One-PAIGE Capability Integration & Proof Matrix remains the one in
`docs/product/int342-marketing-convergence.md` §M3 (INT-342-owned); Mail's row set is admitted
there with INT-342's owner at that doc's next update. Until then this lane table is the working
status, subordinate to M3's status vocabulary:

| Surface | Capability seam | State after PR #1978 (open at this writing) | Proof owed for LIVE |
|---|---|---|---|
| Settings → Connections | `comms.mailbox_*` read/organize + BYOD domain design (this doc) | PARTIAL (readiness signals + Gmail personal OAuth inert; BYOD unbuilt) | Authenticated tenant drive; verified BYOD domain on a test tenant |
| Clients → Conversations | unified `messages` + inbound engine | PARTIAL (inbound complete + inert; two-way reply via action bus filed) | Authorized inbound round-trip; draft/reply/undo receipts |
| Marketing → Email | campaign send through the canonical send boundary | UNAVAILABLE to PAIGE Email ownership (Marketing's sender remains) | Frozen-audience once-only transport proof through the PAIGE Email door |
| PAIGE Chat / Live | Spine comms capabilities (`workspace-admin` seat authority) | PARTIAL (registry LIVE, INT-346 DRAINING) | INT-346 clearance + authenticated chat drive |
