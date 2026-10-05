# INT-327 — canonical Solo client/deal integrity

Development grounding: `5307015f617f546f7ceccb5822f959740a372fce`. Not merged, deployed or accepted.

## Scope and invariant

Every Solo tenant uses the same canonical `public.clients` and `public.deals.contact_client_id` relationship. A resolved client must propagate through creation, approval, execution, readback and retry. Unresolved named clients require clarification. Intentionally unlinked prospects remain supported; a title is never identity evidence. No tenant-specific matching or repair logic.

## Producer inventory

| Producer | Current behavior | Gap / required convergence |
| --- | --- | --- |
| Governed Chat → crm-command | Catalog exposes `client_ref`; endpoint rejects it for `deal.create`. SQL correctly maps `contact_id` to `clientId` and the deal FK when supplied. | Admit tenant-resolved reference; preserve it through exact approval/replay. Creation needs explicit linked or intentionally-unlinked context. |
| Solo Pipeline command desk | Original dialog omitted client identity. Integrated dialog now calls crm-command with explicit canonical client or unlinked reason. | Canonical Trust, stable operation replay and readback; browser/authenticated proof boundaries below. |
| Active Clients NewDealDialog | Conversations → ContactCardRail → ContactDealsSection reaches this editor. Original direct insert is replaced with crm-command. | Known contact context cannot be cleared into an orphan; same approval/replay semantics as Opportunities. |
| Form intake | Resolves contact by canonical methods and inserts the FK. Skips identity-less submissions. | Contact-pin errors are ignored; replay ignores original submission deal and searches only open deals. Preserve original identity atomically and stable operation replay. |
| MCP create_deal handler | Handler maps optional contact ID, but current governed MCP door refuses all mutations before dispatch. | Preserve refusal. Do not activate direct handler or manufacture approval. |
| Stage automation | Consumes the deal FK; does not create deals. | Preserve relationship through updates. |
| Import / migration | No additional active import deal writer found in scoped search; historical tenant backfill does not resolve clients. | No name-based bulk backfill. Historical orphan repair uses governed assignment. |

## Read and authority findings

Contact summary queries linked deals only; an empty result does not prove the workspace has no opportunity. Add bounded same-workspace reconciliation evidence and an explicit ambiguous/ask state. Never auto-link a name match, cross a tenant boundary, or create a replacement while identity is unresolved.

Deal creation approval subjects hash the full command. Server reference resolution normalizes `client_ref` and adds `contact_id`; test that this cannot make the same exact proposal unfindable, while changed commercial inputs remain distinct.

Canonical capabilities: `pipeline.deal_create`, `pipeline.crm_assign_deal_contact`; existing CRM Trust/confirmation, `execute_crm_command`, command-result caches, capability receipts and Rail remain owners. No external provider, scheduler, new relationship store or approval ledger. Form service authority cannot masquerade as human/PAIGE authority. Any intake admission adapter must derive identity from the existing claimed submission and authorized routing configuration.

Open Knowledge PR #1615 also edits the Chat handler, with distinct hunks; preserve those changes and recheck current main before release. No claim of C4 continuation or commercial package authority is made by this repair.

## Acceptance owed

Generic two-tenant fixtures must prove resolved linkage, unresolved refusal, explicit unlinked support, Chat/UI/form parity, reload, idempotency, governed reassignment, foreign-name refusal, ambiguity, propagation mutation failure and empty-contact-read reconciliation. Automated tests do not substitute for authenticated production evidence. Only after the general repair, exercise the existing production orphan through normal governed assignment as a final regression.

## Current implementation evidence

- CRM now admits `client_ref` for `deal.create`, preserves authorized Chat client scope before proposal hashing, and uses a stable approval subject across canonical reference resolution. Explicit intentionally-unlinked reasons remain distinct from unresolved client identity.
- Contact summary readback reports a possible relationship gap, read failure or bounded-scope limitation. Candidate title resemblance never authorizes assignment.
- New `20270588000000_solo_form_deal_identity.sql` adds only `growth_attach_submission_deal`. It derives tenant/client/routing from existing claimed submissions and saved routes, fences stale attempts, and atomically binds deal and dispatch. Existing large CRM/core functions are unchanged.
- Combined focused Vitest: **66 tests / 5 files PASS** after the contact-pin repair. Focused CRM lint: **PASS**. Definer ACL, migration-version, tool-catalogue, CRM field contract and governed-execution checks: **PASS**.
- Isolated PostgreSQL 16 proof: **PASS** for repeat installation, service-only ACL, two tenants, foreign client/route/stage refusal, stale claims, closed replay, rollback, legacy fallback and concurrent same/distinct submissions. Fixture uses the real canonical tenant-link trigger; it does not represent the full hosted schema or authenticated JWT/runtime acceptance.
- Relationship-choice prototype: **80 viewport/theme/state checks PASS**, linked/unlinked validation and dismissal PASS, no page errors. Five sizes include 1536×770, 1366×768, 1024×768, 900×1000 and 390×844. It is mocked internal evidence. The 2026-10-05 owner correction explicitly removes prototype inspection as a blocking gate; integrated manual UI implementation is authorized.
- Independent review identified a stale contact-pin race. The repair filters the current claimed attempt and empty contact field, and requires row readback before publishing success. Eight actual executor tests and local PostgreSQL stale-pin proof pass. Independent repair recheck: **COMPLETE PASS**, artifact `dc81bd0dab0a731dd0672ede8e628007e553c602f503b9738b7dc914b8f1f93b`. No commit, PR, merge, deployment or hosted mutation has occurred.
- Application-wide `tsc --noEmit` is **FAIL** with diagnostics in unchanged files outside this patch (WorkspaceContext, client portal branding, actions, custom fields, planning, lifecycle, playbook, Calendar and onboarding). No changed-file diagnostic was emitted; baseline comparison and CI ratchet remain owed. This is not a green build claim.

Automatic approval review rejected an earlier proposal to restate two large canonical SECURITY DEFINER functions because of production-wide regression/authorization risk. That migration was not written or applied. The reduced form-only migration above leaves those bodies intact.

Remaining: complete integrated manual UI verification, complete producer/reassignment regression, actual authenticated Chat/UI parity, reload/retry proof and the final production orphan repair through governed assignment. Existing generic form completion/failure RPCs do not fence attempt identities; the new deal admission does. This residual boundary must be assessed before claiming end-to-end form-worker acceptance.

Current status: **IMPLEMENTED IN PART / NOT RELEASED**. Authenticated runtime and production regression: **UNVERIFIED**. INT-327 remains open.

## Integrated manual convergence — 2026-10-05

The active Clients Conversations contact card reaches ContactDealsSection → NewDealDialog, so this legacy insert is part of the repair, not an unreachable admin assumption. It now calls the same crm-command Trust/confirmation/readback path as the Solo Opportunities drawer. Client reads and contact deal reads are tenant-scoped; known contact context cannot be silently changed into an unlinked prospect. Reassignment uses deal.assign_contact with current version and explicit canonical client.

The older pipeline_configure tool's schema excludes deal creation but its RPC accepts it. A pre-approval runtime allowlist now prevents that alternate Chat producer. Structural pipeline actions and stage movement remain supported. Source-present admin PipelineAdmin/DealDrawer paths lack established Solo reachability; MCP mutations remain refused; no active deal import writer was found. External connector/automation reach not established by source remains UNVERIFIED.

Focused integrated suite: 89 tests in nine files PASS, including 14 Opportunities component tests and five Clients/dialog component tests. Original contact panel replay fails all three tenant/error/switch regression checks. This replay proves regressions against baseline, not chronological test-first development. New source-executed structural guard tests and rendered verification are in progress.

Invoices, Terms and Collections share canonical client identities; current invoice and agreement contracts do not establish a universal deal_id bridge. This repair does not invent that commercial join or claim it proven. Full authenticated cross-surface acceptance and exact-head independent review remain owed.

### Static and rendered boundary update

Production Vite build PASS (47.25 seconds). Canonical tsc ratchet PASS: baseline 10, current 10; ordinary tsc is not error-free. Focused UI/test lint PASS, migration version/definer ACL/governed-execution/tool manifest/CRM field parity PASS. Installed Impeccable detector reported no findings for shared deal components, PipelineCommandDesk and NewDealDialog; ContactDealsSection scan returns an unexplained ENOENT despite the file existing, so that detector claim remains UNVERIFIED. Actual-component Chromium captures are being finalized after fixing keyboard focus on review transition.

Authenticated browser initialization failed twice with “trusted Node process exited unexpectedly; kernel reset”. This prevents authenticated tenant switching, PAIGE natural-language driving and production orphan correction in this environment. No credentials were scraped or alternative browser-session access attempted. Authenticated acceptance remains UNVERIFIED, not a prototype approval dependency.

Final focused suite after current-main rebase: **102 tests / ten files PASS**. Actual component Chromium: **ten viewport/theme cases PASS**, including linked/unlinked creation, reassignment and exact-operation recovery with keyboard focus retained. Reproduction and checked-in artifacts are in docs/evidence/ui-delivery/solo-client-deal-integrity.md. Full-shell/authenticated proof remains excluded. Deno check of both changed CRM/form endpoints PASS.

## Integrated independent review disposition

Nonwriter review completed on 35c7ed4b4e7dba605f3e0f66b3b80683eb069887: FAIL, one P2. Active Clients NewDealDialog accepted free-text unlinked reasons that canonical CRM refuses. The editor now uses the same three allowed reason values; missing selection refuses, all three are component-tested. Revised test failed first (INPUT instead of SELECT), then all four editor cases passed. No additional material findings were reported. Trailing fixture-driver blank line also removed. One exact-head repair recheck remains required and will be recorded in PR #1761 before merge.
