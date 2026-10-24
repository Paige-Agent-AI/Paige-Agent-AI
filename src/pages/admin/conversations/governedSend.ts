// A message Paige is sending under an approval the owner already gave — a governed email
// (`meta.comms_email_binding`, INT-328) or an invoice delivery (`meta.sales_invoice_binding`).
//
// Both write the outbound row BEFORE the provider is called, with `status = 'draft'`, so the
// operation has one durable home; an outcome the server could not confirm also leaves it there.
// That row is NOT a draft awaiting approval: the approval was consumed when it was prepared, the
// email may already be out, and the server refuses a second send of it. So the inbox must never
// draw it as "Paige drafted — awaiting your approval", never offer Approve & send or Edit on it,
// and never count it as a draft (§13 — the screen says what is true; §70 — no dead-end control).
//
// Only the binding STATES and the two times that bound "Sending…" are read (six scalar JSON
// paths), never the bound command, body or governance — the inbox needs to know what to say, not
// what was approved.
import type { MessageRow } from "./inbox-shared";

/** PostgREST select fragment appended to MESSAGE_COLS by the inbox's message pull. */
export const GOVERNED_SEND_COLS =
  "comms_email_operation:meta->comms_email_binding->>operation_id, " +
  "comms_email_state:meta->comms_email_binding->>state, " +
  "comms_email_prepared_at:meta->comms_email_binding->>prepared_at, " +
  "comms_email_claimed_at:meta->comms_email_binding->>claimed_at, " +
  "sales_invoice_operation:meta->sales_invoice_binding->>operation_id, " +
  "sales_invoice_state:meta->sales_invoice_binding->>state";

export interface GovernedSendFields {
  comms_email_operation?: string | null;
  comms_email_state?: string | null;
  comms_email_prepared_at?: string | null;
  comms_email_claimed_at?: string | null;
  sales_invoice_operation?: string | null;
  sales_invoice_state?: string | null;
}

/** What the inbox says about a governed send that has no settled message status yet. */
export type GovernedSendView =
  /** Handed to the email service (or about to be) within the last couple of minutes. */
  | "sending"
  /** It may have gone out and nobody could confirm it — never resend. */
  | "unconfirmed"
  /** Nothing was handed to the email service: refused, or prepared and never claimed. */
  | "not_sent"
  /** Settled (accepted, failed): the row's own status already tells the truth. */
  | "settled";

/**
 * How long "Sending…" stays true. send-message races the provider call against a 20s deadline and
 * the door gives up on send-message at 25s, so two minutes past prepare or claim nothing is still
 * waiting on an answer: a send that never finalized is unconfirmed (it was claimed) or not sent
 * (it never was). §13: the label has to stay true.
 */
export const SENDING_WINDOW_MS = 2 * 60_000;

function stateOf(m: GovernedSendFields): { bound: boolean; comms: boolean; state: string | null } {
  const comms = !!(m.comms_email_operation || m.comms_email_state);
  const invoice = !!(m.sales_invoice_operation || m.sales_invoice_state);
  return {
    bound: comms || invoice,
    comms,
    state: (comms ? m.comms_email_state : m.sales_invoice_state) ?? null,
  };
}

/** Milliseconds since the first readable timestamp, or `null` when none can be read. */
function ageMs(nowMs: number, ...times: Array<string | null | undefined>): number | null {
  for (const t of times) {
    if (!t) continue;
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) return nowMs - ms;
  }
  return null;
}

/**
 * `null` when the row is not a governed send at all. `nowMs` is injectable so the time bound is
 * testable; the inbox passes the clock at render.
 *
 * The comms binding carries `prepared_at` and `claimed_at`. The invoice binding carries neither,
 * so its age is the row's own `created_at` — the row is written by prepare, and send-message claims
 * it within the same command run.
 */
export function governedSendView(m: MessageRow & GovernedSendFields, nowMs: number = Date.now()): GovernedSendView | null {
  const { bound, comms, state } = stateOf(m);
  if (!bound) return null;
  const fresh = (age: number | null) => age !== null && age <= SENDING_WINDOW_MS;
  const preparedAge = ageMs(nowMs, comms ? m.comms_email_prepared_at : null, m.created_at);
  switch (state) {
    case "unknown":
      return "unconfirmed";
    case "refused":
    case "blocked":
      return "not_sent";
    case "provider_accepted":
    case "failed":
      return "settled";
    case "prepared":
      // Never claimed, so never handed to the email service. "Sending…" only while the claim
      // could still be on its way; after that the truthful word is "Not sent".
      return fresh(preparedAge) ? "sending" : "not_sent";
    case "dispatching": {
      // Claimed: the email service may have it. Past the window nobody is waiting on an answer
      // any more, so it may have gone out — don't resend.
      const claimedAge = ageMs(nowMs, comms ? m.comms_email_claimed_at : null, comms ? m.comms_email_prepared_at : null, m.created_at);
      return fresh(claimedAge) ? "sending" : "unconfirmed";
    }
    default:
      // A binding without a readable state is never shown as approvable. While its row still
      // reads 'draft' it has not settled; past the window we cannot say it is moving.
      if (m.status !== "draft") return "settled";
      return fresh(preparedAge) ? "sending" : "unconfirmed";
  }
}

/**
 * The ONE test for "a draft Paige wrote that is waiting for the owner's approval": an outbound row
 * in `draft` that is not a governed send already under way.
 */
export function isApprovableDraft(m: MessageRow & GovernedSendFields): boolean {
  return m.status === "draft" && m.direction === "outbound" && governedSendView(m) === null;
}

/** Copy, kept with the rule so the label and the state cannot drift apart. */
export const GOVERNED_SEND_COPY = {
  sending: { pill: "Sending…", line: null },
  not_sent: { pill: "Not sent", line: null },
  unconfirmed: {
    pill: "Couldn't confirm",
    line: "Couldn't confirm this went out — don't resend.",
  },
} as const;
