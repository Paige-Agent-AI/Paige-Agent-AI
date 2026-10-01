# Paige Secure Browser MVP — focused flow package

Date: 2026-09-07
Status: implementation design of record for the provider-free MVP slice
Authority: owner direction in the dedicated Secure Browser workstream, 2026-09-07

## Product boundary

Paige Secure Browser is a Paige-owned capability inside the one dedicated Paige workspace. It is not a provider surface and does not create a second chat, workspace, or credential manager.

This package authorizes only the provider-free slice:

- collect and durably record a clear purpose, target, scope, and authority decision;
- show truthful setup, unavailable, denied, paused, expired, cancelled, closed, and failed states;
- preserve the exact conversation and restore focus when the browser panel closes;
- expose Paige-owned lifecycle, budget, concurrency, receipt, Rail-summary, Connected Accounts, and download-quarantine contracts;
- prepare—but never activate—the future propose → confirm → execute → verify → receipt action path.

It does not authorize a provider secret, external session, persistent context, external login, credential, cookie, connected external account, crawl, download, or website action. Browserbase remains `PROPOSED`; all seven vendor gates remain open.

## Actor and job

The primary actor is the owner or an explicitly authorized representative working in a resolved Solo tenant. Their job is to ask Paige to use a secure browser for a named business purpose and target, understand the exact allowed scope and current availability, and leave or recover without losing the conversation.

## Paige Spine

`intent → server-resolved actor / tenant / conversation → authority → governed capability → canonical session request → verified readback → detailed receipt + Rail summary → visible truthful result`

No client-supplied tenant, actor, role, authority, provider, connection, or session identifier is trusted as authority.

## Flow contract

### First use

1. The owner asks Paige to open a secure browser and names a business purpose.
2. Paige explains that passwords, MFA values, cookies, tokens, page source, and session material never enter chat or model context.
3. Paige collects target, purpose, allowed read scope, time limit, and whether any future consequential action may only be proposed.
4. Cancel returns focus to the initiating composer/control and preserves the exact thread.
5. Continue submits intent to the Paige-owned control plane. The server re-resolves actor, tenant, conversation, authority, budget, and concurrency.

### Current MVP outcome

Because no approved worker is wired, the canonical request finishes as `unavailable`. Paige states that setup is incomplete, names no provider, claims no session, and offers Retry, Close, and Open Connected Accounts. Retry creates no duplicate active context and re-runs the server gates.

### Owner control and lifecycle

- Pause is valid only for a Paige-owned active lifecycle record.
- Revoke prevents further use of the connection record and invalidates any future session authorization.
- Close ends the view and restores the exact thread; it never implies provider deletion.
- Delete is a confirmed Connected Accounts metadata action. No real external account or provider artifact exists in this slice.
- Session expiry is terminal for use. A new request must re-resolve authority and budgets.

### Vault Connected Accounts

Vault owns the Paige metadata structure for connections. Empty, loading, denied, failed, revoked, expired, and deleted states are explicit. The MVP creates no credentialed Connected Account. Reconnect remains unavailable until the vendor gates and a real worker path are separately approved.

### Downloads

Every future browser download must first create a tenant-scoped quarantine intake record. Nothing becomes readable, downloadable, indexable, memorable, or usable by Paige until the existing Vault inspection boundary promotes it. The provider-free MVP can prove the intake contract and refusal behavior only; no external download is performed.

### Future governed actions

The contract reserves `proposed`, `awaiting_confirmation`, `executing`, `verifying`, `succeeded`, `failed`, `outcome_unknown`, and `refused` action states. The MVP rejects transitions into execution because external actions are disabled. A later release must re-check authority and caps immediately before execution, perform verified readback, and write a detailed durable receipt plus a bounded Rail summary.

## Required states and exits

| State | Visible truth | Primary exits |
|---|---|---|
| First use | Paige explains purpose, scope, and sensitive-data boundary | Continue, Cancel |
| Validation | Missing/invalid purpose, target, or scope is identified without losing input | Correct, Cancel |
| Resolving | Tenant, authority, budget, and availability are being checked | Cancel |
| Unavailable | No approved worker is connected; no session exists | Retry, Connected Accounts, Close |
| Permission denied | Current actor cannot manage Secure Browser for this tenant | Close, return to thread |
| Budget/concurrency refused | Paige-owned cap prevents a session request | Retry when eligible, Close |
| Paused/revoked/expired | Exact lifecycle reason and no-active-session truth | Close, permitted recovery |
| Failure | Safe owner-language error; sensitive/internal data excluded | Retry, Close |
| Closed/cancelled | No external act claimed; exact thread retained | Resume conversation |
| Tenant switch | Previous tenant data is cleared before the next read | Resolve new tenant or unavailable |
| Vault empty | No connected accounts exist | Return to Paige |
| Quarantine pending | Item is inaccessible until inspection passes | Return to Vault |

## Accessibility and responsive contract

- Native labeled controls; status updates use polite or assertive live regions as appropriate.
- Escape closes a temporary panel only when doing so is safe; focus returns to the invoking control.
- The browser panel and Connected Accounts drawer trap focus only while modal.
- No essential action is hover-only; visible focus meets the Paige token contract.
- At 1536×770 and 1366×768 the workspace, thread rail, conversation, and secure panel share the existing app height.
- At 1024×768 and 900×1000 the secure panel becomes a full workspace layer; conversation state remains mounted underneath and is restored on close.
- Paige open/closed, both themes, 200% text, reduced motion, keyboard-only operation, and the existing Live Voice controls are regression cases.

## Prototype controls

The companion HTML exposes deterministic reviewer-only state, theme, viewport, workspace, and Paige-open controls. These controls are outside the product frame. Any populated receipt or result in the prototype is labeled illustrative and is not runtime evidence.

## Collision boundary

Draft PR #1044 currently owns the shared `PaigeAIChat.tsx`, `SoloPaigeWorkspace.tsx`, their CSS/tests, and `paige-ai-chat`. This work may add isolated components, contracts, migrations, Vault structure, and prototype evidence while #1044 is active. The final mount into the workspace must start from #1044’s merged or relinquished head; no competing edit to those shared files is allowed.
