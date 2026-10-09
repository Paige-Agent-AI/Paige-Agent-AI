// #1140 two-mailbox pilot — the Chat half: tool declarations + dispatch.
//
// Reads (message_read, support_cases) execute caller-scoped RPCs directly, exactly
// like inbox_list. inbox_label is the ordinary, reversible canonical verb (no
// approval — action-risk class ordinary, nothing leaves the workspace). gmail_organize
// is SELECTION ONLY: comms-mailbox-command alone claims the approval and executes the
// STORED call, mirroring the comms-email door pattern.
import { COMMS_MAILBOX_ORGANIZE_CAPABILITY, COMMS_MESSAGE_CONTENT_READ_KIT, COMMS_SUPPORT_CASES_READ_KIT } from "../paige-spine/domains/comms.ts";
import { COMMS_MAILBOX_ORGANIZE_TOOL, parseOrganizeCommand, unsubscribeHttpsTarget, UUID } from "./organize.ts";

const DOOR = "comms-mailbox-command";

const kitProperties = COMMS_MAILBOX_ORGANIZE_CAPABILITY.input.properties as Readonly<Record<string, unknown>>;

export const INBOX_INTELLIGENCE_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_message_content",
      description: "Read ONE message from the workspace inbox — envelope plus plain-text body, canonical labels and its classification. The server enforces the mailbox policy: a private mailbox is readable only by the person who connected it; a disconnected mailbox refuses. Use after inbox_list when the person asks what a message actually says. Never quote more than the person needs.",
      parameters: COMMS_MESSAGE_CONTENT_READ_KIT.input,
    },
  },
  {
    type: "function",
    function: {
      name: "read_support_cases",
      description: "List the support inbox's cases — one per conversation thread — with status (open, awaiting the owner, awaiting the customer, resolved), risk tier, last activity, and any pending follow-up. Use when the owner asks what needs them, what Paige is chasing, or what has gone quiet. Elevate billing, refund, account-access, security and legal cases to the person; never answer those autonomously.",
      parameters: COMMS_SUPPORT_CASES_READ_KIT.input,
    },
  },
  {
    type: "function",
    function: {
      // A string literal, not COMMS_MAILBOX_ORGANIZE_TOOL: capability-kit-lint binds a tool
      // schema to its defineCapability() declaration by the literal name it reads here.
      name: "gmail_organize",
      description: "With approval, organize ONE synced Gmail mailbox message: label, unlabel, archive, unarchive, trash, or untrash it (each has an exact undo), or propose unsubscribing from its mailing list (no undo — the target is recorded and shown; the person sends the one-click request from their own mail client; automatic sending is disabled). There is no permanent delete — not expressible. The person sees the exact message and action on a Needs your OK card before the real mailbox changes. Trash moves to Gmail's Trash (30-day recovery), never deletion.",
      parameters: {
        type: "object",
        properties: {
          kind: kitProperties.kind,
          message_id: kitProperties.message_id,
          label: { type: "string", description: "The label slug, for label/unlabel only." },
        },
        required: [...COMMS_MAILBOX_ORGANIZE_CAPABILITY.input.required],
        additionalProperties: false,
      },
    },
  },
] as const;
export const INBOX_INTELLIGENCE_TOOL_NAMES: ReadonlySet<string> = new Set(INBOX_INTELLIGENCE_TOOLS.map((t) => t.function.name));

type Turn = { thread_id: string | null; user_turn_ordinal: number; user_turn: unknown };
type Reply = { data: unknown; error: unknown };
export type InboxReadDependencies = { caller: { rpc(name: string, args: Record<string, unknown>): Promise<Reply> } };

/** Dispatch the three direct verbs (reads + the canonical label). The door verb
 *  has its own dispatch below; anything unknown refuses honestly. */
export async function dispatchInboxIntelligenceChat(
  toolName: string,
  args: Record<string, unknown>,
  deps: InboxReadDependencies,
): Promise<Record<string, unknown>> {
  if (toolName === "read_message_content") {
    if (typeof args.message_id !== "string" || !UUID.test(args.message_id)) return { success: false, error: "Pass one message_id from inbox_list." };
    const { data, error } = await deps.caller.rpc("read_message_content", { p_message_id: args.message_id.toLowerCase() });
    if (error) return { success: false, error: "The message could not be read just now." };
    const result = data as Record<string, unknown> | null;
    if (!result || result.ok !== true) {
      const code = typeof result?.code === "string" ? result.code : "MESSAGE_UNAVAILABLE";
      const note = code === "PERSONAL_MAILBOX_NOT_OWNER"
        ? "This is a private mailbox only its owner connected, so it cannot be read from this seat."
        : code === "MAILBOX_INACTIVE"
          ? "That mailbox is disconnected, so its messages cannot be read right now."
          : code === "WORKSPACE_ROLE_REQUIRED"
            ? "This workspace seat cannot read that message."
            : "No readable message with that id in this workspace.";
      return { success: false, not_applied: true, error: note };
    }
    return { success: true, message: result };
  }

  if (toolName === "read_support_cases") {
    const { data, error } = await deps.caller.rpc("read_support_cases", {
      p_status: typeof args.status === "string" ? args.status : null,
      p_include_followups: args.followups_only === true,
    });
    if (error) return { success: false, error: "The support cases could not be read just now." };
    if (data && typeof data === "object" && !Array.isArray(data) && (data as Record<string, unknown>).ok === false) {
      return { success: false, not_applied: true, error: "Support cases need this workspace's owner or an admin seat — a plain member seat cannot read them." };
    }
    const cases = Array.isArray(data) ? data : [];
    return { success: true, count: cases.length, cases };
  }

  return { success: false, error: "Inbox action unavailable." };
}

type ApprovalQuery = {
  eq(key: string, value: unknown): ApprovalQuery; in(key: string, values: string[]): ApprovalQuery;
  is(key: string, value: null): ApprovalQuery;
  not(key: string, operator: string, value: null): ApprovalQuery;
  gt(key: string, value: string): ApprovalQuery; limit(value: number): PromiseLike<{ data: { fingerprint?: unknown; args?: unknown }[] | null; error: unknown }>;
};
export type OrganizeChatDependencies = {
  admin: { from(name: string): { select(value: string): ApprovalQuery } };
  caller: { functions: { invoke(name: string, options: { body: Record<string, unknown> }): Promise<Reply> } };
};
export type OrganizeChatContext = { tenantId: string | null; userId: string; toolName: string; args: Record<string, unknown>; approved: Set<string>; turn: Turn };

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
function organizeSafeResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["ok", "replayed"]) if (typeof source[key] === "boolean") out[key] = source[key];
  if (typeof source.outcome === "string" && /^[a-z_]{1,40}$/.test(source.outcome)) out.outcome = source.outcome;
  for (const key of ["reason", "code"]) if (typeof source[key] === "string" && CODE.test(source[key] as string)) out[key] = source[key];
  return out;
}

/** gmail_organize — selection only; the door claims the approval and executes. */
export type OrganizeChatResult = { tokens?: string[]; spent?: string; content: Record<string, unknown> };
export async function dispatchOrganizeChat(ctx: OrganizeChatContext, deps: OrganizeChatDependencies): Promise<OrganizeChatResult> {
  if (ctx.toolName !== COMMS_MAILBOX_ORGANIZE_TOOL) return { content: { success: false, error: "Mailbox action unavailable." } };
  if (!ctx.tenantId || !UUID.test(ctx.tenantId)) return { content: { success: false, error: "Workspace unavailable." } };

  // Unsubscribe one-click target, when the model passes one, must be the
  // server-recorded https target — never a request-authored URL.
  let command: Record<string, unknown>;
  try {
    command = parseOrganizeCommand(ctx.args) as unknown as Record<string, unknown>;
  } catch {
    return { content: { success: false, error: "Invalid mailbox request. kind is one of label, unlabel, archive, unarchive, trash, untrash, unsubscribe_propose, unsubscribe_send; message_id is a message id from inbox_list; label is a slug." } };
  }
  // unsubscribe_send rides the same approval as every other kind; the door reads the
  // one-click target from the message's own recorded List-Unsubscribe header (never the
  // request) and shows its host on the card. Proposing first (unsubscribe_propose) is how
  // the person sees the target before approving the send.

  let body: Record<string, unknown>;
  let spent: string | undefined;
  const tokens: string[] = [];
  if (ctx.approved.size) {
    try {
      const reply = await deps.admin.from("paige_pending_confirmations").select("fingerprint,args")
        .eq("tenant_id", ctx.tenantId).eq("user_id", ctx.userId).eq("tool_name", COMMS_MAILBOX_ORGANIZE_TOOL)
        .in("fingerprint", [...ctx.approved].map((token) => token.split(":")[0]))
        .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
        .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
        .gt("expires_at", new Date().toISOString()).limit(10);
      if (reply.error) return { content: { success: false, error: "The approval could not be checked. Nothing was changed." } };
      const rows = reply.data ?? [];
      // Match on the STORED command exactly — the approved card is for that message and kind.
      // jsonb does not preserve key order: compare the PARSED commands, never raw
      // stringify of the stored args (the door re-parses for exactly this reason).
      const match = rows.find((row: { fingerprint?: unknown; args?: unknown }) => {
        const stored = row.args && typeof row.args === "object" ? (row.args as Record<string, unknown>).command : null;
        if (!stored) return false;
        try { return JSON.stringify(parseOrganizeCommand(stored)) === JSON.stringify(command); }
        catch { return false; }
      });
      const token = match ? [...ctx.approved].find((t) => t.split(":")[0] === match.fingerprint) : undefined;
      if (!match || !token) {
        return { tokens, content: { success: false, error: "That approval no longer matches this mailbox action. Propose it again so the person approves the exact message and action." } };
      }
      body = { expected_tenant_id: ctx.tenantId, command, approved_fingerprint: match.fingerprint };
      spent = token;
    } catch {
      return { content: { success: false, error: "The approval could not be checked. Nothing was changed." } };
    }
  } else {
    body = { expected_tenant_id: ctx.tenantId, command };
  }

  try {
    const reply = await deps.caller.functions.invoke(DOOR, { body });
    let data = reply.data;
    if (reply.error) {
      const error = reply.error as { context?: { json?: () => Promise<unknown> } };
      if (!error.context?.json) throw new Error("unanswered");
      data = await error.context.json();
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("unanswered");
    const result = data as Record<string, unknown>;
    if (result.outcome === "approval_required" && typeof result.fingerprint === "string" && /^[0-9a-f]{16}$/.test(result.fingerprint)) {
      return { tokens, spent, content: {
        success: false, needs_confirm: true, requires_operator_approval: true, confirm_fingerprint: result.fingerprint,
        confirm_summary: typeof result.summary === "string" ? result.summary : "Approve this mailbox change",
        ...(result.preview && typeof result.preview === "object" ? { confirm_preview: result.preview } : {}),
        note: "Show the Needs your OK card. The mailbox was not changed yet. Do not call this tool again until the person approves.",
      } };
    }
    const safe = organizeSafeResult(result);
    if (result.ok === true && result.outcome === "applied") {
      return { tokens, spent, content: { ...safe, success: true, undo: typeof result.undo_kind === "string" ? result.undo_kind : null,
        note: "The mailbox was changed exactly as approved. Every kind is reversible — ask and the exact undo runs through the same approval." } };
    }
    if (typeof result.outcome !== "string") return { tokens, spent, content: { ...safe, success: false, outcome: "outcome_unknown",
      note: "The mailbox request has no verified response. Do not assume it applied; proposing it again re-checks the same message rather than acting twice." } };
    return { tokens, spent, content: { ...safe, success: false, not_applied: result.outcome === "refused",
      note: typeof result.note === "string" ? result.note : "The mailbox was not changed. Tell the person plainly; never quote an internal code." } };
  } catch {
    return { tokens, spent, content: { success: false, outcome: "outcome_unknown", note: "The mailbox request has no verified response. Do not assume it applied." } };
  }
}

export { unsubscribeHttpsTarget };
