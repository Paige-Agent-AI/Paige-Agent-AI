# PAIGE Prelaunch Public-Web, Vibe Studio, Customer Portal, Domains & Publishing — Owner Integration Charter

**Owner mandate: 2026-10-18.** Applicability: ALL current/future PAIGE coordinators and approved Experience builders. This adds mandatory **conditional** integration and proof requirements for any Experience that touches public websites, Marketing, promotions, Ads, Sales, lead forms, customer-facing pages, service delivery or the tenant Client Portal. It **does not** automatically assign a new E06/E07/E10 agent or authorize real DNS/name-server changes, web-provider token connections, domain purchases, public publishing, or Agency/Sub-Account work. SOLO + Platform Operator only active account experiences; the tenant's external clients are the audience of the SOLO-owned Portal, not a fifth account tier.

## 1. Restore the original Experience owner map — never invent EXP slots

The October 13 owner **15-Experience Master Architecture Charter** (library: `PAIGE_15_Experience_Master_Architecture_Charter.docx`) ALREADY grounded the names and source boundaries which the newer 26-slot tracker inadvertently marked unknown:

| ID | Original approved/proposed definition | Canonical owner/consumer |
|---|---|---|
| EXP06 | **Build My Brand & Online Presence** — websites, landing pages, forms, funnels, custom-domain-ready public publishing | Owns site/public presence; EXP03 consumes attribution/conversion; Studio is creative editor |
| EXP07 | **Create & Publish My Content** — Vibe Studio creative assets, media/social and governed publishing | Studio owns creative production and approval/publish path, Marketing/Ads consume published assets |
| EXP08 | **Manage My Team** — staff/AI roles, assignments, accountability | Shared Team + Operations; future Experience lead, no new current assignment |
| EXP09 | **Serve My Customers** — tenant Customer Portal, service/support/self-service | Existing E09 Claude lead is ACTIVE; consumers EXP04 agreement/payments/delivery |
| EXP10 | **Connect My Business** — domain/provider connections, OAuth/Vault, verify/health/revoke | Owns canonical connection UX/conventions; website/domain foundation may serve current SOLO before full EXP10 staffing |
| EXP11 | **Manage My Money** — Finance/cash/budget/forecast | Existing domain foundations, complete Experience future activation |
| EXP12 | **Protect My Business** — permissions, security, operational risk | Existing Trust/Security source, full Experience future |
| EXP13 | **Build My Business Knowledge** — scoped knowledge/Research | Existing Knowledge/Memory source, Experience future |
| EXP14 | **Shop the PAIGE Marketplace** — add-on entitlements and services | Existing Marketplace, Experience future |
| EXP15 | **Scale & Expand My Business** — growth scenarios, capacity and milestones | Existing Game Plan/Finance/Operations, Experience future |

EXP16–25 exact owner-approved names/contracts are **NOT verified here**: retain RESERVED; no new assignments. EXP00/01–05 existing separate work continues. The October 13 charter is a **proposed expansion architecture**, not proof E06/07/10–15 are shipped, activated or staffed. The current October 18 SOLO/Operator-only staging and final owner full-Experience testing supersede older staged launch/calendar assumptions.

## 2. Customer journey across Vibe, Marketing, Ads, Sales, Portal

The owner must be able to ask: **"PAIGE, create a website for my business, put my offer and form on it, connect my domain, launch an approved campaign, follow up with leads, convert them into clients, and deliver their service in our client Portal."**

Canonical source chain:
`E01 verified business Setup/brand/goals → Vibe Studio existing creative assets/site/page/form/funnel records (E06/E07) → exact approved publication through incumbent growth-publish-command/Studio publish authority → public web hostname+HTTPS → signed-out visitor and UTM/campaign event → growth-public-submit/CRM contact/deal from original source → E03 Marketing/Ads/source attribution → governed E04 Sales agreement/invoice/payment/Operations delivery → E09 tenant client Portal invitation, client-facing records/Conversations/support → verified real customer outcome + source-linked Rail / company/tenant-appropriate analytics.`

E06 owns sites/pages/funnels PUBLIC PRESENCE; E07 owns creative content/media; E03 owns campaigns/attribution/conversion; E04 owns tenant merchant/client sales/fulfillment; E09 owns tenant-client Portal audience and interaction; E10 owns canonical provider/domain connection semantics. EXP00 owns **PAIGE Inc's L1** subscriber activation/billing, distinct from a SOLO customer's own L2 client revenue. Never clone another CRM, Marketing ledger, Vibe editor, invitation system, publisher, domain/email registries, PAIGE runtime or Rail. Public site and authenticated client Portal may share trusted branding/domain proof, **never share visitor access privileges**.

## 3. Three website pathways — staged, not three parallel website engines

**WEB PATH A / REQUIRED PRELAUNCH REUSE: keep existing customer's website.** A customer hosting on Cloudflare Workers/Pages, Vercel, Netlify, Genspark-produced site or elsewhere should keep their site and add PAIGE's already deployed/embed-capable lead form and booking pathways. Reuse `public/embed.js`, `/form/:id`, `growth-public-submit`, campaign attribution and deal routing from released E03 S2a PR #2088 and `docs/guides/put-a-paige-form-on-a-cloudflare-or-genspark-site.md`. No Cloudflare account/token or forced domain transfer. The E03 S2a authenticated acceptance packet was PREPARED not EXECUTED at October 13; verify current state anew before claiming customer acceptance. Respect CSP/third-party script restrictions and an accessible no-script fallback.

**WEB PATH B / PRELAUNCH PRODUCT TARGET, IMPLEMENT ONLY BY EXPLICIT EXPERIENCE-SCOPED ORDER: generate/export/deploy a complete approved business website.** Vibe Studio is the sole creative editor/source. Produce portable deterministic versioned build artifacts (HTML/CSS/JS/assets, asset manifest, provenance/hash/license), responsive/accessible/SEO-ready, and include only PUBLIC site assets—no Supabase service keys, provider tokens, private chat/CRM/PII or OAuth secrets. Existing PAIGE public form/booking and later secured client Portal remain connected to PAIGE's backend. Support preview→approve→build→customer-directed export/download OR (after verified least-privilege provider consent) deploy via **Cloudflare Workers Static Assets** (recommended current new Cloudflare site path), support pre-existing Pages deployments and optionally Vercel/Netlify adapters later. Versions/rollback, route/404 behavior, cache invalidation, signed release result, provider deployment ID, link health and rollback proof required. Developer does not gain arbitrary ability to run generated backend logic as trusted PAIGE code. A brochure site is achievable with static assets; server actions/full-stack features require bounded trusted Worker/API implementation and proper RLS, secrets, quotas, observability, abuse and cost controls.

**WEB PATH C / LATER OPTIONAL PAIGE-MANAGED HOSTING:** PAIGE may serve many customers' public websites on one managed edge/publication service with per-site hostname, TLS, tenant/RLS-bound publication and operations billing. Before commencing: owner approve host economics, support burden, site limits, abuse/moderation, WAF, backup/rollback, analytics and incident runbook. Cloudflare for SaaS custom hostnames/SSL or comparable provider is one viable *candidate*, NOT assumed already connected or free. No platform domain/email DNS relocation simply to launch a test; using a third-party host keeps customers' external sites independent of PAIGE uptime for their static content.

## 4. Top-five practical DNS/registrar onboarding support — NOT market-share ranking

Offer human-readable provider-specific guidance and **one universal manual record-validation engine** for these first five examples: **Cloudflare DNS/Registrar, Namecheap, GoDaddy, Squarespace Domains, Porkbun**. Detect *authoritative DNS hosts* via real NS lookup; a domain's purchase registrar is not necessarily its DNS authority. A customer should not be required to transfer registration or hand over domain login credentials.

- **External-host deployment**: add the hostname to chosen host account/project, request exact required TXT/CNAME/A or provider-specified record, have owner update authoritative DNS, verify ownership and domain+TLS health, then publish. Do NOT copy illustrative addresses from documentation; exact record values are provider/project dependent.
- **Apex vs subdomain**: Cloudflare Pages current custom apex site requires Cloudflare nameservers/zone; external DNS may connect a Pages *subdomain* with CNAME once the host-side domain is added. Cloudflare Workers and other hosts have their own ownership records; choose per provider. For PAIGE's eventual multi-tenant-hosted domains, Cloudflare for SaaS requires separate hostname + certificate validation; `hostname.status=active` AND `ssl.status=active` plus correct DNS are needed before claiming live.
- **Website host != email identity**: preserve MX/SPF/DKIM/DMARC, DNSSEC, delegated NS, existing customer email and PAIGE's own Resend/SendGrid inbound/outbound domain commitments. Never replace nameservers or delete DNS records automatically. Treat a 'connect web domain' action as separate from 'enable email sending' and from 'connect a client Portal hostname'.
- **Account/credential access**: require least-privilege approved OAuth or scoped per-site provider token in existing Vault/Integration Registry, explicit expiring consent, rotation and revocation; avoid handing PAIGE full registrar accounts or storing raw credentials in source/issues. Manual DNS instruction works for all five with zero provider API integrations. Cloudflare write API automation is optional separately approved scope, not a default prelaunch dependency.

## 5. WEB-01 through WEB-14 — binding cross-Experience acceptance controls

| ID | Requirement | Accepted proof |
|---|---|---|
| WEB-01 | Existing Vibe Studio/tenant brand, asset and original publish contracts reused | current source owner/writer/reader mapping, no duplicate builder |
| WEB-02 | Public design→review→approve→publish/withdraw truthful state machine | exact approved version, native receipt, accessible preview, rollback and stale approval denial |
| WEB-03 | Existing outside website with PAIGE form/booking embed | two-origin browser, script/CSP fallback, real submitted record and campaign/CRM isolation |
| WEB-04 | Build artifact export/versioning for external hosting | deterministic build hash, HTML/CSS/assets, no secrets/unsafe scripts/private data, license/SEO/mobile checks |
| WEB-05 | Optional customer-consented Cloudflare Worker/Pages deployment | scoped project/Vault authority, actual provider deployment ID and reachability/rollback receipt |
| WEB-06 | Five-provider neutral custom domain verification | correct DNS authority, ownership challenge, domain state and redirects; no forced registrar transfer |
| WEB-07 | HTTPS/custom hostname readiness and periodic monitoring | DNS+TLS active, redirect/CAA/renewal/misconfiguration/revocation checks; no false 'live' |
| WEB-08 | Strict public multi-tenant host routing and isolation | Host header spoofing and domain takeover negatives, verified host→tenant→published artifact, no Operator/tenant private endpoints on public host |
| WEB-09 | Preserve email DNS, system domains and Vault secrets | MX/SPF/DKIM/DMARC pre/post comparisons, scoped read/write permission, no nameserver surprise |
| WEB-10 | End-to-end Marketing/Ads/CRM conversion attribution | site/published campaign/source → form → contact/deal → consented follow-up → real Sales outcome |
| WEB-11 | Tenant Customer Portal as separately authorized audience | owner/tenant/client identity proof, invite/login/access/revoke, only client-approved docs/messages/obligations, never static-export private portal |
| WEB-12 | Accessibility, SEO, performance, cost and safety | mobile, keyboard, contrast, structured metadata/robots/sitemap, image/load budget, CSP/WAF, spam/abuse |
| WEB-13 | Lifecycle and commercial clarity | drafts/active sites/unpublished/suspended/expired DNS and redirects, optional hosting costs, subscription/plan truth and no stealth hosting bills |
| WEB-14 | Operator governance/PAIGE COO evidence | PAIGE Inc may see authorized hosting/provider spend, domain activation failures and support/safety without private tenant/customer data access |

Every current/future Experience agent and coordinator must state **which WEB-IDs apply** alongside existing SAAS-01–24 and ALG-01–13 whenever the job uses web presence, Vibe assets, domains, public campaign acquisition, CRM/Sales funnel or Customer Portal. These are **cross-cutting integration/proof standards**, not 14 new coding agents or individually auto-authorized public DNS/provider actions. Proof ladder: design → source/review/required exact-head CI → safe merged/deployed/source readback → real authenticated owner + public visitor and domain/SSL provider evidence → completed customer/Portal/marketing job → owner ONE complete Experience evaluation. Do not block non-web EXP00/BUG engineering on unbuilt optional managed hosting.

## 6. Priority and assignment decisions

**Immediate active reuse/check**: E03 S2a Cloudflare/Genspark external embed proof, existing E09 Portal client-audience privacy and E03/04 campaign→Sales→Portal seams must be accounted for in prelaunch QA when they apply. Vibe Studio publishing/Rail governance (V0–V6 historically approved) continues **only inside an owner-authorized lane**; no parallel editor, Knowledge/memory/learning brain or duplicated approval rail. Source audit/plan updates are authorized, not spending on Cloudflare accounts or deploying outside the legitimate approved customer/provider workflow.

**Before launching a new E06/E07/E10 Experience owner:** owner explicitly approves the specific job, user-facing design, expected reuse, connected provider credential/hosting expenses and data/legal requirements; then assign one accountable existing/new lead at a time. E09 is already an active existing authorized Customer Portal lead, do not duplicate its delivery. Agency/Subaccounts remain held.

**Commercial value metric:** customer can publish a public site or keep existing hosting, capture a real opted-in lead, track actual marketing/source, close a legitimate client agreement, and let that client use the branded secure Portal for service—verified through original domain records, hosted response, CRM/Sales/Comms/Portal records and durable receipts. Not just created screenshots or a 'published' label.

## 7. Authoritative sources / externally validated technical references

- Existing repo: `docs/delivery/exp03-grow-my-business-journey.md` §11 S2a; `docs/delivery/exp03-s2a-form-embed-acceptance-package.md`; `docs/guides/put-a-paige-form-on-a-cloudflare-or-genspark-site.md`; `docs/architecture/tenant-domain-and-communications-spine.md`; `docs/evidence/ui-delivery/vibe-studio-v2a-receipts.md`.
- Original October 13 Experience charter in owner Library: `PAIGE_15_Experience_Master_Architecture_Charter.docx`; ownership E06 site, E07 Vibe content, E09 Portal, E10 connectors. Earlier EXP00–25 tracker UNVERIFIED labeling E06/07/08 and E10–15 is corrected by the charter, not new owner-acceptance.
- Cloudflare Workers static assets: https://developers.cloudflare.com/workers/static-assets/ ; Workers recommended new static site deployment: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/ ; existing Pages custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/ .
- Cloudflare for SaaS custom hostnames and TLS readiness: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/ and https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/ .
- Pricing for hosting/custom domains depends on actual plan, usage, registered domains and owner-approved budget; no source claim that whole-company managed hosting costs $0.
