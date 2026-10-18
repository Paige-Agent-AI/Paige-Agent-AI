# PAIGE PRELAUNCH HARD GATE — EXP00 + TEN CUSTOMER EXPERIENCES EXP01–EXP10

**Owner decision 2026-10-18.** PAIGE Agent AI Inc does not invite outside SOLO subscribers for general customer use until the founder declares launch acceptance of the integrated ten core Experiences, with EXP00 as additional signup/subscription/Platform Operator prerequisite. This **supersedes the previous staged first-customer invitation assumption** but **does not block risk-proportionate engineering merges/deploys or owner's protected production QA**. No new E06/E07/E08/E10 coding agent is automatically authorized by defining a launch gate. Agency and Agency Sub-Accounts remain OWNER-HOLD.

## 1. The eleven launch checks: EXP00 foundation + EXP01–EXP10

| Gate | Approved customer Experience | Required ordinary authorized customer job (not a list of shipped files) | Status disposition |
|---|---|---|---|
| EXP00 — prerequisite | Public SOLO signup, trial, verified provisioning + Platform Operator company | One visitor legitimately registers, verifies, accepts exact terms and Stripe trial, receives one enabled SOLO workspace, enters existing E01, and appears in PAIGE Inc's L1 Customers/Subscriptions/Billing/COO with genuine support/lifecycle and accurate trial-vs-cash. No duplicate fulfillment. | LIVE fulfillment milestone proven; complete Operator/E01 join still proof owed |
| EXP01 | Meet PAIGE | Human confirms company goals/profile, usable communication/integration setup, reaches existing approved first action and saved Rail result, returns later. | Original implementation assembled; full signed-in owner acceptance owed |
| EXP02 | Run My Business | PAIGE delivers source-backed company health/COO briefing, interpretable priorities, correct next tasks and actual accountable record/receipt with missing-data honesty. | Historical partial; full acceptance owed |
| EXP03 | Grow My Business | A real campaign/creative/Ads promotion generates consented source-attributed lead, legitimate CRM deal and governed follow-up or bookings, then a verifiable Sales conversion. | Source partially built, E03 S2a embed source merged; actual full run owed |
| EXP04 | Get Paid & Deliver | Agreement/terms→invoice/deposit/payment schedule→client onboarding/delivery/collections → actual balances, approval/receipt, secure Portal handoff. | Existing partial source, portal invoice PRs not fully released |
| EXP05 | Keep My Business Running | Owner sets weekly plan, PAIGE coordinates approved task/calendar/team work, completes genuine next action, handles DST/retry and reports real receipt/return. | Backend historically released DARK; actual activation and outcome owed |
| EXP06 | Build My Brand & Online Presence | Brand→live usable public page/website/form/funnel at PAIGE provided *verified active* web address OR verified custom domain; supports existing outside site embed; prospect reaches CRM through original records. Portable export/deploy path must work if marketed at launch; otherwise clearly marked not sold and owner rules whether website builder promise is met. | Original owner-charter definition; website hosting/export/customer verified functionality gap |
| EXP07 | Create & Publish My Content | Owner prepares creative/video/images/copy in incumbent Vibe Studio, reviews and approves exact version, publishes to genuinely connected permitted channel/site, verifies publisher result and usable campaign asset without double-save/send. | Vibe Studio foundations exist; full provider source/approval and actual publisher acceptance owed |
| EXP08 | Manage My Team | A SOLO owner invites appropriate member, grants least privilege, assigns actual work, views completion and can revoke without cross-tenant leakage or privileged escalation. | Source/team foundations, full approved Experience unverified |
| EXP09 | Serve My Customers | Business invites one real permitted client, client signs in and can use all agreed pillars (communications/support, sessions, shared progress, documents, invoices/payments, profile/consents, revocation, multi-business membership, configurable menu, agreements), with service completion and complete role/RLS/privacy proof. | Many source PRs merged; Slice5/6/7/8/A completion and integrated acceptance owed |
| EXP10 | Connect My Business | Customer discovers/connects/consents to at least one real supported provider, tests bounded read/action, sees status and can revoke; PAIGE guides web/domain + PAIGE temporary web/email identities through Chat/eligible Live, verifying actual DNS/SSL/mail status rather than invented 'ready'. | Existing Integration/Vault/domain foundation; whole Experience unverified |

**Launch decision interpretation**: “First ten Experiences” means **EXP01 through EXP10**, with EXP00 also mandatory. No outside-customer general launch invitation while any promised core job is knowingly nonfunctional, material authorization/tenant isolation issue remains, required check fails, or the founder has not accepted the integrated launch candidate. Normal internal/protected owner QA continues. An optional paid third-party connector is not launch-mandatory if not marketed or included in the offered plan, but **the relevant Experience must still deliver its original meaningful job with a supported real pathway**, not a static placeholder.

## 2. A business must be able to get launch-ready immediately after subscribing

A legitimate new equivalent-eligible SOLO owner receives, automatically and idempotently:
- one verified, authorized business tenant/member/trial with correct owner role and safe reentry;
- **reserved** unique temporary PAIGE web identity, e.g. `<verified-tenant-slug>.paigeagent.ai`, via canonical `resolve_tenant_domain_identity`. PAIGE then distinguishes reserved web identity from an actually published HTTPS page and verified `web_live` routing;
- managed PAIGE-branded **email sender identity** via original `resolve_tenant_sender` and `channel_connectors`, with verified status `reserved`/ `outbound_ready`/ `inbound_ready`. A sender address or support notification does **not** create a working two-way mailbox until real inbound+outbound processing is tested;
- existing E01 business interview and guided setup with durable Setup and relevant launch checklist.

**Minimum promised prelaunch experience:** owner can ask PAIGE in typed Chat or available safe Live, “Help launch my company. Set up my temporary website, tell me whether my email can send and receive, build my brand/form, connect a custom domain if I have one, invite customers and start selling.” PAIGE discovers current tenant/plan/domain provider/DNS authority/host, asks missing information, inspects existing assets, explains exact supported capability/readiness, creates owner-approved actions with bounded provider permissions, verifies DNS/provider/site/email results and original receipts, saves progress, and resumes it later. Supported Live speech is optional per actual readiness and spend controls; where marketed, it must deliver the same grounded outcome and must never bypass approval. No pretending PAIGE has logged into Namecheap/Wix/Cloudflare or set MX without a verified token and approval.

## 3. Six DNS-provider playbooks plus universal resolver

**Onboarding guide profiles:** Cloudflare, Namecheap, GoDaddy, Squarespace Domains, Porkbun, **Wix**. They are DNS-management guidance coverage, not six automatic OAuth connectors. Work with any domain provider using public/authorized DNS lookup and standard owner-record entry.

Before instructing a customer: identify registrar and **authoritative DNS** separately; identify destination host/project (Cloudflare Workers Static Assets, existing Cloudflare Pages or customer host, PAIGE published site), subdomain or apex, verify hostname ownership, request exact host-provided TXT/A/AAAA/CNAME where appropriate, detect existing record conflicts, preserve current MX/SPF/DKIM/DMARC/CAA/NS/DNSSEC and unrelated web services, verify resulting DNS, **real TLS** and actual HTTP site/readiness. Use retries/backoff and propagation-aware status; do not claim “connected” merely because a record was requested or created.

**Wix-specific**: Wix officially permits a domain bought at Wix to point at externally hosted sites through Wix-managed A/CNAME records, but if external DNS/nameservers actually manage the domain, changes belong at that authority. Wix's `www` hostname can be reserved/conflict with Wix site settings. The agent must warn about replacing an existing Wix-hosted site or email and explain required changes/rollback; no credentials or nameserver switch needed for manual guidance. Sources: https://support.wix.com/en/article/managing-dns-records-in-your-wix-account and https://support.wix.com/en/article/connecting-a-wix-domain-to-an-external-site .

## 4. Governance: no unexpected external effects and no 100% static-hosting requirement invented

Public website and client Portal roles differ. Vibe Studio remains ONE creative/source/publisher; E03 remains Marketing/Ads/lead owner; E04 owns tenant L2 commerce/delivery; E09 Portal remains ONLY existing current implementation owner; E10 existing Integration/Vault; EXP00 PAIGE Inc L1 SaaS commercial truth. Do not duplicate any engine, CRM, memory, DNS tenant identity, email sender or ledger. Current Agency/Sub-Account work remains HELD.

No new domain registration/purchase, nameserver mutation, external Cloudflare API token, site publishing, live email send, paid ads, new SMTP mailbox, provider billing or irreversible state change without customer-specific consent and required exact approval. Existing customer websites remain external whenever desired. Static public website export to Cloudflare Workers can be an approved first-class customer path; fully PAIGE-managed multi-tenant hosting is optional later **unless separately promised in product pricing/offers**. Define product/plan features truthfully before opening invitations.

## 5. Required launch engineering proof and algorithms

Every EXP01–10 gets:
1. exact original owner-approved actor/job and canonical producer→consumer seams;
2. consistent **SAAS-01–24**, **ALG-01–13** and where applicable **WEB-01–14**, with names, owner, source and evidence;
3. normal user/tenant authority, negative RLS/security, uncertain state, duplicate/retry, logout/reload/mobile/accessibility/proxy/provider outage cases;
4. true source→independent review→exact-head required CI→safe merge/deploy/readback→authenticated complete job→owner accepted, without confusing shipped slices for working Experiences;
5. secure support/reconciliation/renewal and authentic finances, provider/hosting/AI budgets, usage quotas, observability and consumer/legal/privacy/tax applicability.

**Additional domain/setup algorithm application (reuse the existing 13, do NOT start an ML engine):**
- `DNS-A`: Deterministic WHOIS/RDAP-as-available + authoritative NS/host-readiness resolution and ownership/TLS state machine, source `ALG-01, ALG-12`; propagation-aware retry without dangerous blind writes.
- `DNS-B`: Record-conflict protection (A/CNAME exclusive at same owner name, host `www`, MX/SPF/DKIM/DMARC safety, TXT challenges); explain safe plan, require exact approval.
- `LAUNCH-A`: Business Launch Readiness computed from **actual** deployed website/SSL, sender inbound/outbound, setup profile, connected funnel/booking, approved Services/Portal; each item READY / INCOMPLETE / UNAVAILABLE / NEEDS ATTENTION. No opaque fake percentage or propensity score; reuse `ALG-02, ALG-13`.
- `PORTAL-A`: Client invitation, billing/service/privacy/risk and turnaround priority from real source/consent; no arbitrary tracking or manipulative engagement; reuse `ALG-04, ALG-12`.

**Owner-launch checkpoint**: after each Experience has safe production code and protected end-to-end proof, founder performs ONE coherent integrated launch-candidate evaluation, then approves/revises. There is no need for founder PR-by-PR clicks or simulated customer test accounts en masse. Reserved agency shells remain owner-held. The product must pass all E01–E10 contractual outcomes **and** EXP00 on the actual supported plan before general customer invitations begin.

## 6. Immediately required existing-agent adaptation — E09

The existing Claude Code E09 lead continues without replacement. Original posted owner tasks: invitation release #2293/#2309/#2298; Communications+Support S1; Sessions S2; Progress S3; Documents S4; Billing S5; Consent S6; revoke S7; multi-business S8; per-tenant menu M; Agreements A. Verified merged source PRs #2293/#2309/#2298/#2315, #2320 S1, #2335 S2, #2343 S3, #2349 M, #2358 S4. E04 client invoice/read PRs #2170/#2184 still open; do not claim Portal S5 paid. S6/7/8/A require full current-main/production status audit before exact claim.

E09 MUST now consume, not rebuild, Vibe Studio/EXP06 public brand/shareable link and E03 consented leads→E04 Sales/client relationship, tenant E10 domain/temporary PAIGE website and email readiness. E09 preserves single tenant-client relationship, approved portal branding/menu per tenant, optional vanity Portal hostname only after verified owned mapping/TLS, no shared public website content leak. A new customer from an approved form→Sales/onboarding→E09 invite must see ONLY explicitly shared sessions/progress/docs/agreement/invoice and their own consent/settings. Multi-business client can select correct businesses without cross-client data leaks. No new marketing campaign or provider DNS/hosting work in E09 lane. Full agent handoff is maintained separately in E09 owner build plan and current issue.

## 7. Controlling program links

Owner E01–10 release definition and work evidence: [EXP00–25 strategy](https://docs.google.com/document/d/1FxuTVXU1NcrNkVR9G4CvfAm1Ja4iSo_Cs_SVdA3LuR8/edit), [WEB controls](https://docs.google.com/spreadsheets/d/1qMN3h4fU4zVftWY-KPheBL95SxrbyI7ykn7kIcWb_J4/edit#gid=1939996794), [original domain/emails](../../docs/architecture/tenant-domain-and-communications-spine.md), and [prelaunch public web charter](PRELAUNCH-VIBE-WEBSITE-PORTAL-DOMAINS-INTEGRATION-2026-10-18.md).
