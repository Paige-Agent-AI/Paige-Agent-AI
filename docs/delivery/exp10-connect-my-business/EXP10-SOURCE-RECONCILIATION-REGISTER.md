# EXP10 — Connect My Business: Source-Reconciliation Register

**Owner directive:** October 22, 2026 — zCod activated as SOLO EXP10 Engineering Lead.
**Register grounded against:** `origin/main 7a8b066942098a7917b2655fe75d8ebad677fb09` + production
(Supabase `xygzykjyynhzqytbqnzu`, read 2026-10-22) + deployed edge functions (Management API) +
`docs/integration-registry/integration-capability-registry.json` (33 providers at read).
**Linear:** ANT-164. **Doctrine:** reuse-first — no second registry, OAuth framework, Vault, MCP
gateway, automation runner, event ledger, approval queue or sender (owner §4).

---

## 1. Current source and production inventory by provider

The canonical architecture ALL EXISTS. EXP10's job is completion, correctness, coverage and the
premium customer Experience over it — not re-creation.

| Layer | Canonical home (verified on main) | Deployed state |
|---|---|---|
| Provider-agnostic gateway | `mcp-gateway` fn → `_shared/mcp-gateway/{verify,create,oauth,approve,tools,execute,runner,intake,consent,rail-receipt}.ts` over `mcp_connections` (migration 20270319000000) | ACTIVE v109 (2026-10-21); actions verify/create/oauth_begin/approve/tools/execute; `MCP_GATEWAY_EXECUTE_ENABLED` default OFF (owner-held go) |
| Provider descriptor catalogue | `mcp_providers` table | 4 rows: `generic-remote`, `n8n`, `zapier`, `gohighlevel` |
| Legacy singleton stores (sole live write path, dual-read into v2) | `tenant_mcp_connections` (n8n+zapier, OAuth/bearer, per-provider), `tenant_n8n_connections` (API key), `tenant_zapier_api_connections` (direct Zapier API OAuth) | deployed; writer RPCs live |
| Secrets | `platform_encrypt/decrypt` pgcrypto helpers; service-role-only decrypt RPCs (`get_tenant_mcp_secret`, `get_mcp_connection_secret`); ciphertext-only columns | live |
| OAuth | gateway `oauth_begin` + JWT-less `mcp-oauth-callback`; provider fns `tenant-n8n-oauth`, `n8n-oauth-keepalive`, `gmail-oauth-*`, `google-calendar-oauth-*`, `quickbooks-oauth-*`, `zoom-oauth-*`, `tenant-zapier-api-connect` | deployed |
| Orchestration Layer C | `_shared/paige-orchestration/{adapters,n8n-adapter,native-adapter,approve-executor,dispatch-claim,engine,decide,outcomes}.ts`; `paige-orchestrator` (v117), `execute-approval` (v170), `paige-action-worker` (v91) | deployed |
| Spine integrations domain | `_shared/paige-spine/domains/{integrations_surface,n8n,n8n_management,n8nReadiness,ghl_management,automations}.ts`; `public.list_integration_surface` UNIONS channel_connectors + tenant_mcp_connections + mcp_connections | deployed |
| Chat | `integrations_list`/`integrations_health` tools, GHL `ghl_list_actions`/`ghl_run_action` (chatBinding LIVE), n8n readiness evidence per-turn, "check your own hands" steering (paige-ai-chat:6925) | live |
| Customer surface | `src/solo/settings-integrations.tsx` + `settings-integrations-gateway.tsx` (1647 ln) + `connections-calendars.tsx` + `settings-automations.tsx` + social/stripe drawers + admin `IntegrationsHub` | shipped |
| Governance | Integration Capability Registry (33 entries, CI `lint:integration-registry`) | enforced |

### Production rows (2026-10-22)

- **12 tenants. ONE** holds the live MCP connections: n8n MCP OAuth (`tenant_mcp_connections`,
  touched 2026-10-22) + Zapier MCP (2026-10-18). One `generic-remote` v2 connection (2026-10-05).
- **36 probed tools** cached in `mcp_connection_tools`.
- **`mcp_connection_approvals` = 0, `mcp_connection_receipts` = 0** — governed gateway execution has
  NEVER run (execute flag OFF; owner go pending).
- `tenant_n8n_connections` (API-key path) = **0**; `tenant_zapier_api_connections` = **0**;
  `quickbooks_connections` = **0**; `paige_social_connections` = **0**.
- Email: **7 active Resend connectors** across 7 tenants. Calendars: 13 calendars / 9 hosts.
- **GHL is NOT connected anywhere today** (the Oct-3 bearer-PIT connection with 36 tools is gone
  from live stores; only the `gohighlevel` descriptor + chat tools remain).

## 2. Existing working connections and their actual evidence

| Provider | Customer flow | Auth | Evidence |
|---|---|---|---|
| n8n (MCP) | gateway panel connect | OAuth (DCR) | live row on 1 tenant, OAuth kind, status connected; keepalive fn deployed |
| Zapier (MCP) | gateway panel connect | OAuth grant / url-auth | live row on 1 tenant, status connected |
| Custom remote MCP | gateway panel `generic-remote` | bearer/header/none | 1 v2 connection connected + 36 tools probed |
| GoHighLevel / LeadConnector | gateway panel connect (bearer PIT + locationId header) | bearer | chat tools exist (ghl_list/run); **no live connection** |
| Email (managed) | comms surfaces | platform | 7 active channel_connectors |
| Calendars | connections-calendars panel | OAuth | deployed fns; 13 calendars |
| Stripe merchant | settings-integrations-stripe drawer | Stripe Connect | deployed |
| Gmail | gmail-oauth-* + mailbox sync | OAuth | deployed; registry PROOF_OWED |

## 3. Missing, dormant or defective connection functionality

1. **Slack** — catalogue row in the gateway panel is guidance-only (`m: "setup"`); no provider
   descriptor, no connect flow. Slack operates a hosted remote MCP (`mcp.slack.com/mcp`) the
   existing gateway can drive. **Highest-value absent provider** (owner §2 names it; EXP08 Team Hub
   depends on it).
2. **Microsoft Teams** — "bridge via Zapier" note only; AAD app registration required for native.
3. **Make.com** — absent entirely. REST API + OAuth, NOT an MCP server → needs a Layer C
   ActionAdapter (bigger lift than an MCP provider).
4. **iCloud Mail** — absent; owner launch requirement (ANT-51, "where feasible"); IMAP/SMTP adapter
   belongs to the Mail lane (zCod owns both — coordinated, not duplicated).
5. **Gateway governed execution** — fully built (runner, consent verifier, pins, Rail receipts),
   never exercised; flag owner-held OFF.
6. **Connection health/monitoring (ALG-12)** — status/last-check exist per row; no staleness
   detection, no aggregate exception view, chat cannot yet answer "why isn't my CRM syncing" from
   provider error codes.
7. **Revocation completeness** — legacy `clear_tenant_mcp_connection` exists; per-connection
   disconnect/revocation across every connectable provider needs a uniform pass (PR5).
8. Registry gaps: no entries for Slack, Make.com, iCloud Mail; `microsoft-365` entry predates EXP10.

## 4. Canonical ownership and Orchestration Layer C integration

- EXP10 is the **connection-source owner**: registry, descriptors, connect/verify/approve/revoke,
  credential custody, health. EXP05/ZION (and EXP01/02/03/04/08/09/11) **consume** capabilities.
- A connection NEVER implies action authority: actor + tenant + scope + risk classification +
  approvals + idempotency + original provider readback are enforced by the gateway runner and
  Layer C (`#1173/#1188/#1203/#1208/#1212/#1225/#1235/#2019/#2031/#2044/#2063` chain verified
  present in `_shared/paige-orchestration/`). EXP10 registers provider capability facts; Layer C
  sequences governed calls; Rails carry durable receipts.
- Chat binding stays read/propose-first: reads ungated, writes via the one approval path.

## 5. Provider priorities (launch value × feasibility)

1. **Slack** (PR2) — named by owner; hosted remote MCP fits the existing gateway; EXP08 dependency.
2. **GHL/LeadConnector** (PR3) — owner's §2 example ("Check our LeadConnector opportunities");
   descriptor + chat tools already exist; needs scope correctness + a live connection path.
3. **Health/monitoring** (PR4) — multiplies the value of EVERY existing connection.
4. **Chat management + revocation** (PR5) — completes the §2 question set.
5. **Execution readiness + catalogue truth** (PR6) — packages the owner's execute decision.
6. **Make.com** — Layer C ActionAdapter (candidate follow-on; honest PROPOSED until built).
7. **Teams** — AAD app registration is an owner/provider action; honest Coming Soon meanwhile.
8. **iCloud Mail** — Mail-lane coordination per ANT-51.

## 6. Dependency-ordered small PRs

PR1 (this PR) inventory register + registry truth → PR2 Slack via gateway → PR3 GHL scope/naming →
PR4 health + ALG-12 → PR5 chat management + revocation → PR6 execution readiness + capabilities
sync + acceptance matrix. Refined per-PR as source dictates; mega-PRs prohibited.

## 7. Security and authorization risks (standing controls)

Tenant isolation via server-derived tenant (§9) at every seam; encrypted credentials with
service-role-only decrypt; SSRF guard on all outbound (https-only, no redirects, public hosts,
bounded); credential-reflection guard on intake; webhook signature/replay protection in
`_shared/webhookSig.ts`; prompt-injection fencing of provider content; owner-held execute flag;
secrets never in logs/chat/errors. New risks found are fixed at their canonical seam, not patched
locally.

## 8. Algorithm and Capabilities status (honest)

- **ALG-01 (reconciliation):** PARTIAL — connection state + tools cache + (unused) receipts
  machinery exist; provider event reconciliation unproven with zero receipts.
- **ALG-12 (exception detection):** NOT BUILT — status/error codes recorded per row, no detection
  loop, no staleness surfacing. PR4 delivers the deterministic baseline.
- **ALG-13 (next-best-action):** NOT BUILT — PR4/5 deliver rule-based recommendations from real
  connection state (connect a useful tool / fix a failure / take an authorized next step).
- **Capabilities catalogue:** must be synchronized per-PR (owner 2026-10-20 directive); PR6 lands
  the full truthful state set (Live/Limited/Unverified/Coming Soon/Not Connected/Unavailable).

## 9. Cross-Experience integration plan

EXP01 (connection readiness hooks), EXP02/VERA (authorized connected metrics), EXP03/NEXUS (lead
sources), EXP04/MERIT (CRM + commercial), EXP05+08/ZION (automation execution + Team Hub Slack),
EXP09/CURA (client comms), EXP11/VERA (finance reads). Interfaces = the existing gateway actions +
Spine capability declarations + registry entries; no departmental forks.

## 10. Path to full owner acceptance

Complete PR1–6 → authenticated acceptance matrix across provider classes (positive + negative:
foreign-tenant, non-admin, expired-token, revoke-then-use) → rendered premium-Experience evidence
per the Oct-21 standard → ONE founder evaluation of the whole Connect My Business Experience.
