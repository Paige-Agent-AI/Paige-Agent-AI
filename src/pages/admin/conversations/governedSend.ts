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
// Only the two binding STATES are read (four scalar JSON paths), never the bound command, body or
// governance — the inbox needs to know what to say, not what was approved.
import type { MessageRow } from "./inbox-shared";

/** PostgREST select fragment appended to MESSAGE_COLS by the inbox's message pull. */
export const GOVERNED_SEND_COLS =
  "comms_email_operation:meta->comms_email_binding->>operation_id, " +
  "comms_email_state:meta->comms_email_binding->>state, " +
  "sales_invoice_operation:meta->sales_invoice_binding->>operation_id, " +
  "sales_invoice_state:meta->sales_invoice_binding->>state";

export interface GovernedSendFields {
  comms_email_operation?: string | null;
  comms_email_state?: string | null;
  sales_invoice_operation?: string | null;
  sales_invoice_state?: string | null;
}

/** What the inbox says about a governed send that has no settled message status yet. */
export type GovernedSendView =
  /** Prepared or handed to the email service; the outcome is not back yet. */
  | "sending"
  /** The send was attempted and nobody could confirm whether it went out. */
  | "unconfirmed"
  /** Settled (accepted, failed, refused): the row's own status already tells the truth. */
  | "settled";

const IN_FLIGHT = new Set(["prepared", "dispatching"]);

function stateOf(m: GovernedSendFields): { bound: boolean; state: string | null } {
  const comms = !!(m.comms_email_operation || m.comms_email_state);
  const invoice = !!(m.sales_invoice_operation || m.sales_invoice_state);
  return {
    bound: comms || invoice,
    state: (comms ? m.comms_email_state : m.sales_invoice_state) ?? null,
  };
}

/** `null` when the row is not a governed send at all. */
export function governedSendView(m: MessageRow & GovernedSendFields): GovernedSendView | null {
  const { bound, state } = stateOf(m);
  if (!bound) return null;
  if (state === "unknown") return "unconfirmed";
  if (state && IN_FLIGHT.has(state)) return "sending";
  if (state === "provider_accepted" || state === "failed" || state === "refused") return "settled";
  // A binding without a readable state is never shown as approvable; and while its row still
  // reads 'draft' the honest thing to say is that the send has not settled.
  return m.status === "draft" ? "sending" : "settled";
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
  unconfirmed: {
    pill: "Couldn't confirm",
    line: "Couldn't confirm this went out — don't resend.",
  },
} as const;
