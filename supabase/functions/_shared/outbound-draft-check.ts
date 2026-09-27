/**
 * outbound-draft-check — what PAIGE writes for a customer is read for internal text before it can be
 * filed as a draft or sent (R2). The detector is R1's (`internal-vocabulary.ts`); this module names
 * which fields of which tools a customer reads, and the refusal PAIGE is handed when one of them
 * carries internal text.
 *
 * THE CUSTOMER-BOUND FIELDS, per tool: what the send path actually delivers, and nothing else.
 *   - propose_action: the message body, and the subject of an email (a text carries none). The summary is
 *     the owner's line in the approvals queue, not the customer's.
 *   - calendar_link_send: the custom message, and the subject of an email. The booking link is the server's.
 *   - action_file: the title and summary, for a kind the client's portal shows (`surface_to_client`): the
 *     portal shows the action's title, and its summary when no draft body replaces it. Another executor's
 *     title and summary are the owner's.
 *   - action_advance: what `advance_action` delivers. When the action is DRAFTED and its kind requires
 *     approval, whatever its executor, the draft (the one attached, else the stored one) goes to the approval
 *     lane, and approving it sends its subject and body (or message) as a message when it names a channel;
 *     a workflow kind in the auto lane can file its stored draft the same way. When it is EXECUTED, a portal
 *     kind shows its stored title and the stored draft's body (or its summary), and a workflow kind can file
 *     its stored draft for approval. Other statuses deliver nothing.
 * Ids, channels and recipients are never read: the server resolves them. A value the send path would turn
 * into text (an array, say, which `String()` joins) is read string by string, so a list is not a way past.
 * Where the caller could not find out the kind, every route is read. The check refuses only on a finding:
 * text it was not given (an action whose stored row could not be read) it cannot read, and it does not
 * refuse for that alone, because a missed leak is preferable to a normal action withheld (owner rule).
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

/** The action-bus executor whose action the client's portal shows (the registry's own value). */
export const PORTAL_EXECUTOR = "surface_to_client";

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
  /** Whether the registry says the kind requires approval; absent when the caller could not find out. */
  requiresApproval?: boolean;
  /** action_advance: the action as stored; absent when the caller could not read it. */
  stored?: StoredAction;
}

function isEmail(channel: unknown): boolean {
  return String(channel ?? "").toLowerCase() !== "sms";
}

/** The fields of a draft that the approval lane sends as a message (execute-approval). */
function messageOf(draft: unknown): unknown[] {
  const d = isRecord(draft) ? draft : {};
  return [d.subject, d.body ?? d.message];
}

function advanceTexts(args: Record<string, unknown>, { executor, requiresApproval, stored }: DraftContext): string[] {
  const named = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  // advance_action moves to `p_to_status`, or re-runs the stored status when none is given. When neither is
  // known, drafted is assumed: it is the one status that takes a new draft.
  const next = named(args.to_status) ?? named(stored?.status) ?? "drafted";
  const attached = args.draft_content ?? undefined;
  const texts: unknown[] = [];
  const portal = executor === undefined || executor === PORTAL_EXECUTOR;
  const workflow = executor === undefined || executor === "workflow";
  if (next === "drafted") {
    if (requiresApproval !== false) texts.push(...messageOf(attached !== undefined ? attached : stored?.draft_content));
    if (workflow && requiresApproval !== true) texts.push(...messageOf(stored?.draft_content));
  } else if (next === "executing") {
    if (portal) {
      const storedDraft = stored?.draft_content;
      const d = isRecord(storedDraft) ? storedDraft : {};
      texts.push(stored?.title, d.body ?? stored?.summary ?? stored?.title);
    }
    if (workflow) texts.push(...messageOf(stored?.draft_content));
  }
  return [...new Set(textsOf(texts))];
}

/** The text a customer may read from one call of `tool`, given what the caller found out (see above). */
export function customerBoundTexts(tool: string, args: Record<string, unknown>, context: DraftContext = {}): string[] {
  switch (tool) {
    case "propose_action": {
      const email = isEmail(args.action_type);
      return textsOf(email ? [args.subject, args.body] : [args.body]);
    }
    case "calendar_link_send": return textsOf(isEmail(args.channel) ? [args.subject, args.message] : [args.message]);
    case "action_file":
      return context.executor === undefined || context.executor === PORTAL_EXECUTOR ? textsOf([args.title, args.summary]) : [];
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
 * and says what to do: when she filed it just now, rewrite and file again; when it came from a card the
 * owner approved, tell them plainly that it did not go ahead and offer a rewrite for a fresh approval.
 */
export function draftRefusal(leaks: readonly InternalLeak[], stage: "filing" | "approved"): Record<string, unknown> {
  const found = [...new Set(leaks.map((leak) => leak.text))].slice(0, 10);
  return {
    success: false,
    error: "internal_text_in_draft",
    found,
    note: stage === "filing"
      ? "Nothing was filed. This draft is for a customer, and it contains text only the platform uses (listed in found): a tool name, a field name, a record id or error text. Rewrite it in plain words the customer would use, without those, and file it again."
      : "Nothing went ahead. The approved draft contains text only the platform uses (listed in found), so it was stopped before it reached the customer. Tell the owner plainly that it did not go ahead because it contained internal system details, and offer to rewrite it for a fresh approval.",
  };
}
