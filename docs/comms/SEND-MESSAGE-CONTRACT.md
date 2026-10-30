# send-message — LOCKED contract (Comms C-2 + C-1.5 coordination seam)

**Owner:** Antonio · **Status:** LOCKED for the C-2 (SMS/compliance) and C-1.5 (inbox
depth) surface crews. Both crews extend `supabase/functions/send-message/index.ts`; this
doc is the single seam they build against so the two parallel slices never fork it (§18).

> §37 anti-break is the spine of this contract: the existing response keys
> (`audit_id`, `vendor_message_id`, `pipe_used`, `status`, `error`, `message_id`) and the
> existing `status ∈ {sent,failed}` semantics **do not change**. Every new behavior is
> **additive** — a new request field or a new response field. A legacy caller that reads
> `status`/`error` today keeps working byte-for-byte.

---

## 1. Where the two crews touch the file (no overlap by construction)

There is exactly **one** new pre-send seam and it is shared:

```
Deno.serve:
  … JWT gate (L104-122) …………………………………… UNCHANGED
  … parse body (L124-134) ……………………………………  + C-1.5 adds: attachments[], scheduled_for
  … resolve tenant/connector/sender (L144-209) … UNCHANGED (already §9-safe)
  … §9 caller-tenant gate (L190-209) …………………… UNCHANGED
  … §5 double-submit guard (L211-221) ………………… UNCHANGED
  ┌───────────────────────────────────────────────┐
  │  >>> PRE-SEND PIPELINE SEAM <<<   (NEW)         │  ← the ONE shared seam
  │  runs the 6-step order in §3 below.            │     C-2 owns steps 1-5 (checks)
  │  A gated step short-circuits with a 200 +      │     C-1.5 owns step "scheduled_for"
  │  { status, outcome, reason, … } and RETURNS.   │       queueing (a 6th gate flavor)
  └───────────────────────────────────────────────┘
  try { … provider send … } (L223-310) ……………………  C-2 swaps the SMS branch for the
                                                       per-tenant Twilio OutboundAdapter
  … audit + messages row write (L312-409) …………………  + C-1.5: attachments persisted on the row
  … paige_conversations mirror / rail (L411-506) … UNCHANGED
  … response (L508-524) ………………………………………  + additive: outcome, reason, scheduled_for
```

- **C-2** implements the pre-send **checks** (steps 1–5) + the **SMS OutboundAdapter**
  (replacing the inline Twilio branch L279-305) + the DLR/status webhook.
- **C-1.5** implements the **scheduled_for queue** decision (the queue-for-later flavor of
  a gate) + **attachments** on the request/row. It does NOT touch steps 1–5.
- Both land through **one** edited `send-message` — coordinate on this doc, do not fork.

---

## 2. Request additions (all optional; legacy callers omit them)

| Field | Owner | Type | Meaning |
|---|---|---|---|
| `attachments` | C-1.5 | `[{ url, mime, name, size? }]` | Persisted onto the `messages.attachments` jsonb; passed to the adapter where the channel supports it. |
| `scheduled_for` | C-1.5 | ISO-8601 UTC | Queue-for-later / undo-send. Non-null future → the message is written `status='queued'` with `scheduled_for` set and the provider is **NOT** called this request. The cron drainer releases it (§4). |
| `override_client_dnd` | C-2 | `boolean` | Explicit staff override of a **client-level** send DND (step 1 only). Never overrides suppression/consent (steps 2–3). Audited. |

`tenant_id` remains **server-derived** everywhere (§9) — never read from the body.

---

## 3. The LOCKED pre-send order (owner-specified, do not reorder)

Runs at the seam, in this order. Each step returns a **specific reason code** (§13 — no
generic "blocked"). Interaction rules are owner-locked:

| # | Check | Channel | On hit | `outcome` | Override? | Interaction |
|---|---|---|---|---|---|---|
| 1 | **Client DND** (`clients.dnd_active` + window) | all | **block** | `blocked_client_dnd` | yes — `override_client_dnd` | **Strongest.** Client DND wins over everything. |
| 2 | **Suppression** (`paige_suppressions` by contact_id **or** address_normalized) | all | **block** | `blocked_suppressed` | **no** | Hard stop; unsubscced/bounced/complained. |
| 3 | **Consent** (`paige_consent_events` latest state) | all | **block** | `blocked_no_consent` | **no** | No opt-in / opted-out. |
| 4 | **Tenant auto-send DND** (`tenant_comms_preferences`) | per `autosend_dnd_channels` | **queue** | `queued_tenant_dnd` | n/a | vs step 5: **more-restrictive-wins** (queue until the later of the two windows clears). |
| 5 | **TCPA quiet-hours** (recipient tz via `clients.timezone`) | **SMS only** | **queue** | `queued_quiet_hours` | n/a | Uses recipient local time; queue until the window opens. |
| — | **Scheduled send** (`scheduled_for` present & future) | all | **queue** | `queued_scheduled` | n/a | C-1.5. A scheduled send that lands mid-quiet-hours **re-queues** at drain time (steps 4–5 re-run on release). |
| 6 | **SEND** | | provider call | `sent` (or `failed`) | | Only reached when 1–5 pass and no `scheduled_for`. |

Notes the crews must honor:
- **Block vs queue.** Steps 1–3 are hard **blocks** (message is written `status='blocked'`,
  never sent). Steps 4–5 + scheduled are **queues** (`status='queued'`, released later).
  `messages.status` already carries `'blocked'` and `'queued'` (C-2 migration extended the
  CHECK; C-1 already had `'queued'`).
- **More-restrictive-wins (4 vs 5).** When both tenant-DND and quiet-hours apply, the
  release time is the **later** of the two window-clears. Compute both; queue to `max`.
- **Re-queue on release.** The drainer (§4) re-enters `send-message` which **re-runs the
  full 1–5 pipeline** — so a message released from tenant-DND that now hits quiet-hours
  re-queues. This is why the drain path is a re-entry, not a raw provider call.
- **Every gated outcome writes its `messages` row** in the terminal state
  (`blocked`/`queued`) with the reason in `meta.pre_send = { step, reason, ... }` (§13
  auditability) — the inbox/queue surfaces (§36) render why.

---

## 4. Drain / release (scheduled + queued)

Queued rows (`status='queued'`, `scheduled_for <=` now **or** a DND/quiet-hours window that
has since opened) are released by **re-entry into `send-message` under the service role**
with `scheduled_for` omitted and `message_id` set to the queued row — so the row is
**patched** (not re-inserted) and the **full 1–5 pipeline re-runs**. Idempotency is the
existing double-submit guard (L215-221: a row already `sent`/`queued` for a *different*
reason short-circuits) plus `provider_message_id` uniqueness.

- The cron drainer uses the existing pg_cron + `net.http_post` + `x-cron-token` idiom
  (see migration `20260712150000` / `public.cron_token_header()`), pointed at the queued
  read path `idx_messages_scheduled_due` (C-1.5) and the DND/quiet-hours release query.
- **Undo-send** is `scheduled_for = now()+Ns`; cancelling clears `scheduled_for` (and sets
  the row back to `draft` or deletes it) before the drainer fires — never a provider call.

---

## 5. Response additions (additive — §37)

```jsonc
{
  // ── UNCHANGED (legacy contract) ──
  "audit_id":           "...",
  "vendor_message_id":  "... | null",
  "pipe_used":          "resend | twilio",
  "status":             "sent | failed",   // STILL only these two — do NOT add values here
  "error":              "... | null",
  "message_id":         "... | null",       // the public.messages row id
  // ── ADDITIVE (new) ──
  "outcome":            "sent | failed | blocked_client_dnd | blocked_suppressed |
                         blocked_no_consent | queued_tenant_dnd | queued_quiet_hours |
                         queued_scheduled",
  "reason":             "... | null",       // human-readable specifics for a block/queue
  "scheduled_for":      "ISO-8601 | null"   // echoed when the row was queued
}
```

**§37 rule for consumers:** the **6-way result lives in `outcome`**, never in `status`.
`status` stays `sent|failed` so every existing reader (the C-1 `ClientsConversations`
one-click Approve flow, `paige-action-worker`, any dashboard) is unaffected. A gated
send returns **HTTP 200** (like every other outcome — the fn always 200s so the client
reads the structured payload, L519-521) with `status:"failed"`-or-`"sent"` semantics
**unchanged for the send path** and the true disposition in `outcome`. New surfaces read
`outcome`; old surfaces read `status`. Both correct.

> **Producer/consumer inventory (§37) is mandatory in each crew's PR.** Before merge, each
> crew enumerates every producer of `send-message` (frontend `ClientsConversations` +
> composer, `paige-action-worker` drain, `comms-draft-reply` materialized drafts, any MCP/
> n8n caller, the new cron drainer) and proves the new request/response shape still works
> for each. `outcome` being additive is the reason this stays safe — prove it, don't assume.

## 6. EXP03 SMS uncertainty candidate — October30,2026

Source candidate only; normal exact-head review/CI/release/readback still required. Earlier response examples remain historical: the existing additive `outcome_unknown` plus `unconfirmed:true` contract must also carry uncertain SMS results. `status` remains `failed`, never a successful-send claim. A transport/response-read exception, HTTP408/409/5xx or successful response without a valid provider Message SID cannot establish unsent. Original SMS adapter sets its existing result metadata; send-message projects that through the existing uncertain-row marker/response/replay guard. No new outcome enum, message table, approval or receipt ledger.

Twilio's [Message resource schema](https://www.twilio.com/docs/messaging/api/message-resource) identifies receipts as `SM` or `MM` followed by32 hexadecimal characters. Its [20429 guidance](https://www.twilio.com/docs/api/errors/20429) documents429 requests as not processed; a configured provider's definite4xx refusal remains failed, while408/409 are conservatively uncertain. A later retry must still obtain current legal/consent/action authority through the original caller. Provider acceptance does not establish handset delivery.

Original consumers: Conversations and New conversation already parse `unconfirmed`/`outcome_unknown` and use the existing warning/record line; the original same-message replay guard refuses an uncertain row before another provider call. Actual-source adapter/handler tests cover that reuse, known accepted receipt, definitive refusal, missing configuration, original provider floor and original words/thread. Rendered/authenticated UI, both-chat/domain consumers, durable SMS operation claiming and all50-state final-dispatch integration remain verification/integration work. Do not automatically resubmit an unknown operation, label a mock as a provider receipt or treat this bounded correction as complete SMS governance.
