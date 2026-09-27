/**
 * outbound-draft-check — what PAIGE writes for a customer is read for internal text before it can be
 * filed as a draft or sent (R2). The detector is R1's (`internal-vocabulary.ts`); this module names
 * which fields of which tools a customer reads, and the refusal PAIGE is handed when one of them
 * carries internal text.
 *
 * THE CUSTOMER-BOUND FIELDS, per tool: what the send path actually delivers, and nothing else.
 *   - propose_action: the email's subject and the message body. The summary is the owner's line in the
 *     approvals queue, not the customer's.
 *   - calendar_link_send: the subject and the custom message. The booking link itself is the server's.
 *   - action_file: the title and summary, for a kind whose executor reaches a customer
 *     (`send_via_approval`, `surface_to_client`). An owner-only kind's title is the owner's.
 *   - action_advance: what `advance_action` delivers for the action's kind. For `send_via_approval`, when the
 *     action is drafted: the draft's subject and its body (or message), which the approval lane sends. For
 *     `surface_to_client`, when it is drafted or executed: the action's title and the draft's body (or its
 *     summary), which the client's portal shows. The draft is the one attached now, or the stored one when
 *     none is attached. Other statuses deliver nothing.
 * Ids, channels and recipients are never read: the server resolves them. A value the send path would turn
 * into text (an array, say, which `String()` joins) is read string by string, so a list is not a way past.
 * A kind, or an action, the caller could not look up is read by every route, never waved through.
 *
 * THE VOCABULARY is the caller's, from the same turn: the tool definitions, the text the caller vouches
 * for, and every tool result PAIGE has been sent, exactly as R3 reads a client's answer. So a clean result means none
 * of the known vocabulary, never "nothing internal".
 *
 * PURE: no I/O. The caller looks up the kind's executor, and for action_advance the stored action, and
 * passes what it found.
 */

import { deriveInternalVocabulary, findInternalLeaks, type InternalLeak } from "./internal-vocabulary.ts";

/** The tools whose arguments carry text a customer reads. */
export const OUTBOUND_DRAFT_TOOLS: ReadonlySet<string> = new Set(["propose_action", "calendar_link_send", "action_advance", "action_file"]);

/** The action-bus executors whose output reaches a customer (the registry's own values). */
export const CUSTOMER_REACHING_EXECUTORS: ReadonlySet<string> = new Set(["send_via_approval", "surface_to_client"]);

const MAX_DEPTH = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Every string inside a value, to a bounded depth (a draft is small; a deeper value is not a message). */
function stringsIn(value: unknown, depth = 0): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (depth >= MAX_DEPTH || !value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap((v) => stringsIn(v, depth + 1));
}

/** The text in each field: a string as it is, a list or object string by string, anything else nothing. */
function textsOf(values: readonly unknown[]): string[] {
  return values.flatMap((value) => stringsIn(value));
}

/** The action as it is stored, for action_advance: what a status change delivers when no draft is attached. */
export interface StoredAction {
  status?: unknown;
  title?: unknown;
  summary?: unknown;
  draft_content?: unknown;
}

export interface DraftContext {
  /** The executor the registry names for the kind; absent when the caller could not find out. */
  executor?: string;
  /** action_advance: the action as stored; absent when the caller could not read it. */
  stored?: StoredAction;
}

function reachesCustomer(executor: string | undefined): boolean {
  return executor === undefined || CUSTOMER_REACHING_EXECUTORS.has(executor);
}

function advanceTexts(args: Record<string, unknown>, { executor, stored }: DraftContext): string[] {
  const named = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  // advance_action moves to `p_to_status`, or re-runs the stored status when none is given. When neither is
  // known, drafted is assumed: it is the one status that takes a new draft.
  const next = named(args.to_status) ?? named(stored?.status) ?? "drafted";
  if (next !== "drafted" && next !== "executing") return [];
  const attached = args.draft_content ?? undefined;
  const draft = next === "drafted" && attached !== undefined ? attached : stored?.draft_content;
  const d = isRecord(draft) ? draft : {};
  const message = [d.subject, d.body ?? d.message];
  const surfaced = [stored?.title, d.body ?? stored?.summary ?? stored?.title];
  if (executor === "send_via_approval") return next === "drafted" ? textsOf(message) : [];
  if (executor === "surface_to_client") return textsOf(surfaced);
  if (executor !== undefined) return [];
  return [...new Set(textsOf([...message, ...surfaced]))];
}

/** The text a customer may read from one call of `tool`, given what the caller found out (see above). */
export function customerBoundTexts(tool: string, args: Record<string, unknown>, context: DraftContext = {}): string[] {
  switch (tool) {
    case "propose_action": return textsOf([args.subject, args.body]);
    case "calendar_link_send": return textsOf([args.subject, args.message]);
    case "action_file": return reachesCustomer(context.executor) ? textsOf([args.title, args.summary]) : [];
    case "action_advance": return advanceTexts(args, context);
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
