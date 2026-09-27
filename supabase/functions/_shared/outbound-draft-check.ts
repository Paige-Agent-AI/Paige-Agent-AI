/**
 * outbound-draft-check — what PAIGE writes for a customer is read for internal text before it can be
 * filed as a draft or sent (R2). The detector is R1's (`internal-vocabulary.ts`); this module names
 * which fields of which tools a customer reads, and the refusal PAIGE is handed when one of them
 * carries internal text.
 *
 * THE CUSTOMER-BOUND FIELDS, per tool, and nothing else:
 *   - propose_action: the email's subject and the message body. The summary is the owner's line in the
 *     approvals queue, not the customer's.
 *   - calendar_link_send: the subject and the custom message. The booking link itself is the server's.
 *   - action_advance: every string in the draft it attaches. A draft is outbound by nature: the bus files
 *     it for approval and sends it, or shows it in the client's portal.
 *   - action_file: the title and summary, and only for a kind whose executor reaches a customer
 *     (`send_via_approval`, `surface_to_client`). A portal recommendation with no draft shows its title
 *     and summary to the client; an owner-only kind's title is the owner's.
 * A field that is not a string is not read, and neither is anything else a tool carries (ids, channels,
 * recipients), which the server resolves itself.
 *
 * THE VOCABULARY is the caller's, from the same turn: the tool definitions, the text the caller vouches
 * for, and the tool results so far, exactly as R3 reads a client's answer. So a clean result means none
 * of the known vocabulary, never "nothing internal".
 *
 * PURE: no I/O. The caller looks up the action kind's executor and passes the answer.
 */

import { deriveInternalVocabulary, findInternalLeaks, type InternalLeak } from "./internal-vocabulary.ts";

/** The tools whose arguments carry text a customer reads. */
export const OUTBOUND_DRAFT_TOOLS: ReadonlySet<string> = new Set(["propose_action", "calendar_link_send", "action_advance", "action_file"]);

/** The action-bus executors whose output reaches a customer (the registry's own values). */
export const CUSTOMER_REACHING_EXECUTORS: ReadonlySet<string> = new Set(["send_via_approval", "surface_to_client"]);

const MAX_DEPTH = 4;

function stringsOf(values: readonly unknown[]): string[] {
  return values.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/** Every string inside a draft object, to a bounded depth (a draft is small; a deeper value is not a message). */
function stringsIn(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (depth >= MAX_DEPTH || !value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap((v) => stringsIn(v, depth + 1));
}

/**
 * The text a customer may read from one call of `tool`. `kindReachesCustomer` answers, for action_file,
 * whether the kind's executor reaches a customer; the caller passes true when it could not find out, so
 * an unknown kind is read rather than waved through.
 */
export function customerBoundTexts(tool: string, args: Record<string, unknown>, options: { kindReachesCustomer?: boolean } = {}): string[] {
  switch (tool) {
    case "propose_action": return stringsOf([args.subject, args.body]);
    case "calendar_link_send": return stringsOf([args.subject, args.message]);
    case "action_advance": return stringsIn(args.draft_content);
    case "action_file": return options.kindReachesCustomer === false ? [] : stringsOf([args.title, args.summary]);
    default: return [];
  }
}

export interface DraftTurn {
  /** The tool definitions sent to the model this turn. */
  tools: readonly unknown[];
  /** Text the caller vouches for where it built it (see internal-vocabulary.ts, AUTHORSHIP). */
  vouchedTexts: readonly string[];
  /** Every tool result the model has been sent so far this turn. */
  toolResults: readonly string[];
}

/** The internal text in a customer-bound draft, against this turn's vocabulary. */
export function internalTextInDraft(texts: readonly string[], turn: DraftTurn): InternalLeak[] {
  if (texts.length === 0) return [];
  const vocabulary = deriveInternalVocabulary({ tools: turn.tools, vouchedTexts: turn.vouchedTexts, toolResults: turn.toolResults });
  return texts.flatMap((text) => findInternalLeaks(text, vocabulary));
}

/**
 * The tool result PAIGE reads when a draft is refused. It lists what matched, so she can take it out,
 * and says what to do: at filing, rewrite and file again; at sending (a card stored before this check
 * existed), tell the owner plainly that nothing was sent and offer a rewrite for a fresh approval.
 */
export function draftRefusal(leaks: readonly InternalLeak[], stage: "filing" | "sending"): Record<string, unknown> {
  const found = [...new Set(leaks.map((leak) => leak.text))].slice(0, 10);
  return {
    success: false,
    error: "internal_text_in_draft",
    found,
    note: stage === "filing"
      ? "Nothing was filed. This draft is for a customer, and it contains text only the platform uses (listed in found): a tool name, a field name, a record id or error text. Rewrite it in plain words the customer would use, without those, and file it again."
      : "Nothing was sent. The approved message contains text only the platform uses (listed in found), so it was not sent. Tell the owner plainly that the message was not sent because it contained internal system details, and offer to rewrite it for a fresh approval.",
  };
}
