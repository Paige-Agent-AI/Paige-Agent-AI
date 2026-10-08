# INT-345 K-3 — "Set up calling": governed, user-initiated calling setup (DESIGN FOR OWNER APPROVAL)

Status: DESIGN ONLY — provider execution disabled until separately authorized. No code in PR #1819 provisions anything.
Owner instruction (2026-10-07): deliberate, authorized, idempotent setup using PAIGE's existing Twilio provisioning core; no auto-provision at signup/shell-mount/login; no second provider gateway; numbers stay paid opt-in and user-selected.

## 1. The user flow (the material interaction)

**Entry:** Solo → Settings → Registration → "Find a number" panel (where today's honest dead end lives: "This business can't buy a number yet. … Once provisioning is complete…"), with the result surface also visible on the Communications tab ("Number on this business" + "Send from this"). K-3 replaces the dead end with a state machine: K-3 replaces the dead end with a state machine:

```
[Calling setup card]
 READY            → "Calling is set up on this workspace." + owned numbers list (today's UI)
 SETUP_AVAILABLE  → button: "Set up calling"  (copy: "Connects this workspace's calling account. Takes a few seconds, once.")
 SETUP_RUNNING    → progress: "Connecting calling… (step m of n)" with per-step honest status
 SETUP_FAILED     → the exact failed step + "Try again" (idempotent — safe to re-run)
 SETUP_BLOCKED    → provider/credential outage: honest copy + "we'll finish setup when the platform connection is restored — nothing to redo"
```

**What one click does (all server-side, all idempotent):**
1. Creates (or adopts) the workspace's Twilio subaccount — the EXISTING `provision-tenant-twilio` core (create subaccount → subaccount API key → Vault secret → `tenant_twilio_subaccounts` row → TwiML app). No new engine (§18: one Twilio seam, `_shared/twilio.ts`).
2. Returns the user to the number step they already have: search → priced results → confirm → buy (existing `comms-search-numbers`/`comms-purchase-number`), then "Send from this" to pick the primary calling number (existing control — the ONLY writer of `is_primary`).
3. Readiness is then exactly today's canonical contract: subaccount + one voice-capable primary bound to it → the dialer is READY.

**What it deliberately does NOT do:** buy a number, pick a primary, provision anything at signup/login/mount, or create a second gateway. The user selects the number; the user pays attention to the price confirm; the user makes it primary.

## 2. Governance (why this is not auto-provisioning)

- **User action is the trigger.** The provisioning call fires only from the owner/admin's explicit click — satisfying the doctrine (connections-rail-contract §5: no silent provider action) while removing the operator-curl dead end for every current and future Solo workspace.
- **Spine action, two clients.** The click routes through a governed Spine action (`comms.setup_calling`, classified, default autonomy `confirm` for PAIGE, operator-switchable to `off`) — the UI button and PAIGE ("set up calling on this workspace") hit the SAME governed action (one path, two clients doctrine). PAIGE's autonomy on a provider action stays behind Trust Compass, default confirm.
- **Idempotent by construction.** Every step is check-then-adopt-or-create: an existing subaccount row → skip; an existing console-created subaccount (adopt map) → adopt; a vaulted secret → verify, never re-mint; a TwiML app → ensure. Re-running after a partial failure resumes at the failed step, never duplicates billable state. (Subaccount creation is free; nothing in K-3 purchases.)
- **Trust/Rail:** the action is consequential → operator-card approval channel for PAIGE-initiated runs; Rail receipt on completion (existing receipt machinery); audit row naming the acting principal.

## 3. Failure handling (each step resumable, each state honest)

| Step | Failure | Surface | Recovery |
|---|---|---|---|
| subaccount create | Twilio 5xx/creds missing | SETUP_BLOCKED, "platform connection" copy | re-run when healthy; nothing to undo |
| API key + Vault | partial write | SETUP_FAILED at step 2 | re-run adopts the created subaccount, re-mints key |
| subaccount row insert | unique violation (race) | treated as already-provisioned | idempotent skip (existing 23505 handling) |
| TwiML app ensure | non-fatal today | card shows "calling account connected; voice app pending" + re-run | lazy re-ensure at token mint (existing behavior) |
| later steps | none in K-3 | — | number purchase keeps its own existing guards |

Every failure names the step and the next action; no state collapses to "contact support".

## 4. Product-intent decisions for the owner

1. **Who sees "Set up calling":** every Solo owner/admin (recommended), or also via PAIGE chat with default-confirm approval?
2. **Pricing copy:** subaccount setup is free; number purchase shows the monthly price at the confirm (existing). Card should say "Setting up calling is free; you only pay for a number if you choose to buy one." — confirm this framing.
3. **Rollout:** all Solo workspaces at once (structural — recommended) vs flag-gated first.
4. **K-4 sequencing:** reconcile the 10 existing workspaces BEFORE the button ships (they'd see READY-ish states immediately) or after (they use the button themselves)?

## 5. Implementation slices (post-approval)

- **S1 (backend, no provider calls):** the `comms.setup_calling` governed Spine action wrapping the existing provisioning core; dry-run mode returning the per-step plan; pgTAP on authority (owner/admin of THIS tenant only; platform owner acting-in-tenant allowed, authority≠readiness), idempotency (run-twice → second is all-skip), and refusal-before-any-provider-call when authority fails.
- **S2 (UI):** the card states + button + progress + failure copy (Impeccable pass; the needs_config dialer copy links here once live).
- **S3 (agent):** PAIGE tool surface for the same action, default `confirm` (Trust Compass knob fronts the real classified action).
- **S4 ( Systems Check):** the "Business phone and SMS" row learns `calling_account: connected` as a distinct step from `number: assigned` (today it conflates them).
- **Provider execution stays OFF until the owner authorizes the live leg** (K-4 authorization covers the same core).
