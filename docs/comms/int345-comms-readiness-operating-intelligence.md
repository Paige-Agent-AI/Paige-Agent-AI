# INT-345 — Communications readiness in PAIGE's COO operating intelligence (integration map)

Purpose: give calling/Comms readiness a defined place in what PAIGE knows and can do as COO — and name every missing platform connection with its correct owner. This is a routing document, not absorbed architecture work (INT-343: Solo consumes platform systems; missing contracts are routed to owners, never cloned).

## 1. The COO question chain for calling

A COO's operating intelligence for a workspace capability answers four questions. Today's state for browser calling:

| Question | Where it lives today | State |
|---|---|---|
| **What can this workspace do?** | `voice-access-token` readiness (READY / number-needs-setup / not-configured) with five exact reason codes (INT-345) | LIVE with #1819 — the single canonical verdict |
| **Why can't it call?** | `reason_code` — no number chosen / number not calls-capable / number mislinked / binding incomplete / no calling account | LIVE with #1819 |
| **What should the owner do? | buy a number in Settings → Registration ("Find a number") + "Send from this" in Settings → Communications (self-service reasons); contact support (platform-side reasons); K-3 "Set up calling" for the account-connection step (DESIGN, owner-approval pending) | PARTIAL — the account-connection step has no user action yet (K-3) |
| **What evidence confirms resolution? | Re-run the readiness verdict → READY (determinate, immediate); K-4 readback protocol for the account step | PARTIAL — end-to-end readback defined in the K-4 plan, not yet executable |

## 2. Where PAIGE (the agent) should read this

- **Today:** PAIGE's chat already reaches the same seams a human does (`comms-search-numbers`, `comms-purchase-number`, `comms_set_primary_number` as classified autonomy tools). What she lacks is the readiness VERDICT: she cannot answer "why can't this workspace call" without reading `voice-access-token`'s answer or the underlying rows.
- **Routing (not built here):** a read-only readiness surface for the agent belongs to the **Spine capability catalog lane** — register `comms.readiness` as a read action returning the SAME verdict object (code + reason_code), consumed by chat narration and later by Systems Check. One producer (the classifier), many consumers. Owner: Spine/Communications jointly.
- **What PAIGE must NOT do:** narrate readiness from provider state she fetched herself (provider reads stay behind the seam), or offer setup paths that don't exist (capability-truth doctrine, INT-117).

## 3. Missing platform connections (documented, routed — not absorbed)

| Connection | What's missing | Correct owner |
|---|---|---|
| **Systems Check row granularity** | "Business phone and SMS" conflates account-connection, number-assigned, and calls-capable; the readiness verdict's five reasons are finer than the check's states | Systems Check lane (registry `paige_systems_check_registry`; INT-345 K-3 S4 proposes the split) |
| **Spine `comms.readiness` read action** | no catalog entry; chat/agent cannot ask "why can't we call" through a governed read | Spine capability catalog lane |
| **Trust** | `comms.setup_calling` (K-3) needs classification + default-confirm autonomy + operator-card channel | Trust/Spine action-risk (design ready in K-3 doc) |
| **Rail** | setup/reconciliation completion receipts (K-3/K-4 executions) | Rail lane — existing receipt machinery, new event type |
| **Operating Fabric (orchestration/durable work)** | K-3's multi-step setup exceeds one request safely? No — the existing core is one idempotent edge run; if a future step set becomes multi-turn durable, route to Orchestration then | Not currently required (recorded so it isn't re-litigated) |
| **Metrics** | readiness distribution (how many workspaces in which state) — useful observability, not needed to fix anything | Metrics lane, future |
| **Live Conversation matrix row (STALE — PARKED)** | `docs/delivery/solo-completion-matrix.json` says `paige.live-conversation = UNAVAILABLE`, but the pilot ceremony was removed 2026-07-24 (migration `20270425000000`); the row predates the opening | Solo completion-matrix owning lane — PARKED there by INT-345, not edited here |

## 4. The invariant this leaves behind

Every workspace difference in calling readiness must reduce to one of: the owner hasn't chosen a number yet (their action, guided), a platform-side repair (our action, named), or a provider dependency (honest, surfaced). After #1819 + K-3 (when approved), "no reachable remedy" and "collapsed five states into one string" are both structurally gone; the verdict vocabulary (`reason_code`) is the single shared source for the dialer, PAIGE, Systems Check, and support.
