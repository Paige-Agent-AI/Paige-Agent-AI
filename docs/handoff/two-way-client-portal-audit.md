# Two-way smart client portal — repository reconciliation

## 2026-10-16 assigned-work restoration candidate — not production acceptance

The existing `/app/actions` reader is restored through `client_portal_self_profile` and exact tenant/contact action filters, preserving the raw-CRM privacy boundary. Existing `customer_respond_to_action` is extended with a required viewed `updated_at`, locked active/unmerged customer/business and open/unexpired work checks before the incumbent response/status/notification/audit/linked-action/Rail body. The old three-argument ABI refuses with `VERSION_REQUIRED`; the new page confirms only an independently reloaded exact own response and holds uncertain writes for read-only reconciliation. No provider or consumer Chat/Live activation, parallel action system or shared Conversation history is added. [Evidence](../evidence/ui-delivery/e09-customer-action-scope.md) separates35 focused,53 native and16 offline browser checks from still-required full-schema CI and genuine customer acceptance. This is a development candidate, bounded to100 recent native action records; the approved customer frame, complete program history, multi-business membership and all seven pillars remain `PARTIAL`/proof owed. Shared Chat/Spine, communications, booking and commercial sources are preserved.

## 2026-09-08 current-main correction and collision assessment

**Decision:** the Tenant Client Portal is a competitive, launch-blocking MVP capability inside the
one Paige Runtime Harness. It is not a separate portal agent or Brain and is distinct from a later
Paige Enterprise Success Portal for Paige's direct enterprise customers.

**Current status: `PARTIAL`.** At `main` `ddbc5cd6`, the external-client product has a branded
`/portal/:tenantSlug` gateway, `/join/:token` registration, single-tenant client linkage,
authenticated `/app` shell, action-item responses, approval-status visibility, a platform
legal-acceptance audit list, a dedicated Paige chat surface, and client-visible activity. The
complete vertical is not proven. Consumer-invite recipient binding in the final acceptance RPC,
multi-workspace client membership/switching, revocation after accepted access, tenant/client
conversation convergence and governed portal-tool execution, dedicated shared documents, client
Planning/tasks, decision controls on approval records, tenant-facing support/escalation and booking,
tenant service-agreement receipt/PDF, and authenticated isolation/direct-URL/stale-session/recovery
evidence remain unavailable, broken, or proof owed. Tenant-side
Clients screens are configuration, preview, and invite management—not external-client proof.

**Affected flow:** canonical client relationship → explicit grant/invite → client authentication →
approved client projection → bounded reads/messages/requests/tasks/documents/approvals → Spine
authority → canonical action/readback → receipt/Rail → tenant review/revoke. Every step independently
resolves client identity, sponsoring tenant, relationship, workspace/record scope, client role and
consent, allowed shared information, tenant policy, provider/file/document state, and evidence rules.

**Collision boundary:** active PR #1044 owns the binding-ledger JSON; #1040, #917, #907, #905, #899
and others touch the Master; #754 touches Master/Brain/wiring/tier records. This docs correction
does not absorb their product code, shared chat, Clients, Sales, orchestration, provider, or release
acceptance ownership. Rebase must preserve both sides. No runtime, provider, tenant data, invitation,
deployment, or production behavior changes here.

**Evidence date:** 2026-08-21  
**Scope:** repository implementation and supplied read-only production audit. Production counts are dated evidence, not prototype fixtures, and were not independently queried in this environment.

## Executive decision

The portal is the external half of **Clients**, not another CRM, inbox, or chatbot. Repository code establishes a branded gateway, customer shell, PAIGE chat, action items, portal configuration, invitations, programs, documents, approvals, bookings, and multichannel seams. It does not establish a complete production workflow.

The target is one shared relationship record with two authorized presentations:

```text
Business: Clients / client account ↔ Client: branded portal
relationship, thread, engagement, request, approval, booking, file and activity IDs remain shared
```

## Evidence and honest state

Repository surfaces include `PortalGateway`, `AppShell`, `AppNav`, `PaigeChat`, `ActionItems`, `PortalStudio`, portal-brand/config/contact/action hooks, customer portal and invite Edge Functions, and the public PAIGE chat function.

| Evidence | Supplied rows | Classification |
|---|---:|---|
| `clients` | 4 | Connected CRM records; portal access proof separate |
| `threads` / `messages` | 4 / 8 | General messaging in use; portal convergence unresolved |
| `paige_chat_threads` / `paige_chat_turns` | 34 / 544 | Chat substrate in use; portal tenant workflow proof owed |
| `notifications` / `internal_bookings` | 3 / 3 | Adjacent substrate with activity |
| `client_files`, `client_notes` | 0 / 0 | Schema/seams; production use unproven |
| programs, enrollments, messages, document requests, approvals and phase states | 0 each | Schema/policies; production workflow unproven |
| customer actions/responses and PAIGE bookings | 0 each | Server-mediated substrate; E2E proof owed |

## Portal taxonomy

The default portal remains intentionally smaller than the business system: **Home, Conversation, Plan, Documents, Meetings, Account**. Payments, funding, courses, proposals, and other vertical modules appear only when enabled for that tenant.

PAIGE is the disclosed, tenant-authored relationship concierge. When closed, one restrained branded launcher is appropriate on portal pages. When open, no second launcher appears. Clients never see internal command controls, agent deliberation, private notes, Trust configuration, or platform/agency scope controls.

## Shared-work contract

- A portal message resolves to the canonical Conversations thread or a formal adapter; it is never copied into a permanent second inbox.
- Structured upload, approve, schedule, review, sign, pay, and complete actions appear in conversation and open their full workspace without losing thread state.
- Every composer and message names its audience: `Shared with client`, `Internal team`, or restricted PAIGE evidence. Color is never the only distinction.
- Internal state records autonomous, drafted, human-approved, human-authored, blocked, failed, or escalated. Clients receive only the appropriate simplified disclosure.
- A client account supports dedicated organization memberships and roles. It must not grow repeated `linked_user_id` columns.

## Integrity gates

1. Audit broad `clients` permissive-policy composition, including the `tenant_id is null` path, using authenticated client/staff/agency/operator tests.
2. Review program policies that target `public`, their helper grants/search paths, and unauthenticated behavior; prefer explicit authenticated targeting plus account authorization.
3. Select the canonical conversation model before mounting portal messaging in Clients.
4. Verify server-mediated customer action creation/response before claiming actions are live.
5. Define portal account membership, represented organization, roles, engagement/document restrictions, and immutable actor logging before enterprise expansion.
6. Prove tenant/account switch invalidation for query caches, drafts, threads, signed file URLs, notifications, and portal branding.

## Theme contract

The tenant prototype and portal preview now provide complete light and dark token sets, default to the user’s system preference, expose a labeled keyboard-focusable toggle, and remember the choice locally for the prototype session/browser. Production should store the same preference per user only after an authenticated preference seam is selected. Tenant branding may adjust approved brand accents, but cannot reduce text, focus, audience, Trust, or AI-disclosure contrast.

## Integration order

1. Identity, membership, invitations, RLS and visibility classes.
2. Canonical conversation, channel continuity, PAIGE routing/disclosure and human takeover.
3. Actions, requests, uploads, approvals, bookings, progress and CRM portal preview.
4. Portal-specific knowledge, autonomy, escalation, summaries and reminders.
5. Organization roles, agency portfolio isolation, then later SSO/SCIM/domain controls.

The portal is not complete until clients can securely enter, converse, escalate, upload, approve, track, book and resume while the business sees the same record, controls autonomy, distinguishes audiences, and proves isolation and audit history.
