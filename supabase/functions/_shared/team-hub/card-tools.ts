// EXP08 Team Hub agents, A2b: what an agent may PREPARE in its DM, and the reads that resolve its ids.
// Plan: the A2b integrated build plan (decisions D2, D4, D5, D6, D11, D13, D15; section 3 "Prepare").
// Contract: docs/delivery/exp08-team-hub-agents-contract.md, section 5 A2 (slices 2 and 3).
//
// A Team Hub card is the governed door's OWN proposal row (paige_pending_confirmations, thread_id NULL),
// minted by that door with nothing approved, plus one link row the post door writes
// (team_hub_message_cards). This module never mints, claims or runs anything itself: it asks the door,
// under the asker's own JWT (`invokeAs`), exactly as PAIGE chat's door branches do, reads back the row
// the door just minted with the door's own live-row predicate, and hands its id to the post.
//
// THE CARD SET IS HAND-LISTED (D2), never computed: ZION's task hand-over and task cancel, NEXUS's page
// publish, and PAIGE the union. Every one is a `high` act (classifyAction), so the door always proposes
// and never runs it unattended. An ordinary write stays withheld in every Team Hub turn until A2c (D4).
//
// ARGUMENTS COME ONLY FROM THIS TURN'S READS (D6). Every id a card names (the task, its version, the new
// assignee, the page) must appear, verbatim, in a read this same turn returned. A teammate's message can
// carry any id it likes; it can never become a card's argument, because nothing in a message is ever a
// read result. Anything else is `needs_lookup` (or `needs_input`), and nothing is prepared.
//
// Pure apart from its injected clients, so Node, Deno and the tests all load it.

import { CRM_COMMAND_TOOLS, CRM_TOOL_TO_ACTION, canonicalizeCrmCommand, crmCommandFallbackIdempotencyKeys } from "../crm-command/catalog.ts";
import { growthPagePublishToolDef } from "../growth-publish-command/chat-tools.ts";
import { dispatchGrowthPublishChat, type GrowthPublishApprovalQuery } from "../growth-publish-chat.ts";
import { CRM_TASK_READ_TOOLS } from "../paige-spine/domains/crm_task.ts";
import { listCrmTasks } from "../crm-reads/list-tasks.ts";
import { listCrmTeam } from "../crm-reads/list-team.ts";
import { listGrowthPages } from "../growth/list-pages.ts";
import { readOperationsTask, type OperationsTaskReadCaller } from "../operations-task-read.ts";
import { resolveWorkspaceAuthority, NO_WORKSPACE_AUTHORITY, type WorkspaceAuthority } from "../workspace-authority.ts";
import { classifyAction, mutatingTools } from "../action-risk.ts";
import { recordCapabilityRun, stableRunId } from "../capability-record.ts";

// ---------------------------------------------------------------- the A2b sets (D2), hand-listed

/** The acts a Team Hub card may carry in A2b. Each is `high`; nothing else is ever carded here. */
export const A2B_CARD_TOOLS: ReadonlySet<string> = new Set(["crm_assign_task", "crm_cancel_task", "growth_page_publish"]);
/** The reads that resolve a card's ids, each already in the agent's stored DM scope (20271117010108). */
export const A2B_READ_TOOLS: ReadonlySet<string> = new Set(["crm_list_tasks", "crm_get_task", "crm_list_team", "growth_list"]);

/** The card kind each tool is stored under (team_hub_message_cards_kind_chk). */
export const CARD_KIND: Readonly<Record<string, "task_handover" | "task_cancel" | "page_publish">> = Object.freeze({
  crm_assign_task: "task_handover", crm_cancel_task: "task_cancel", growth_page_publish: "page_publish",
});
/** The label each kind shows on its card (owner frames, plan section 9). */
export const KIND_LABEL: Readonly<Record<string, string>> = Object.freeze({
  task_handover: "Task hand-over", task_cancel: "Task cancel", page_publish: "Page publish",
});

/** The fixed line the server appends when a shared conversation asks for an act (flow 6). Never the model's. */
export const REDIRECT_LINE = "I can do that with you in our DM.";

/**
 * PAIGE has no paige_subagents row. Her DM scope is her ordinary scope intersected with what Team Hub
 * can run (D13): A1's reads, the A2b reads and the A2b card tools. The post door inlines the same list
 * (20271121140008), so the two cannot disagree about which proposal she may link.
 */
export const PAIGE_A2B_DM_SCOPE = Object.freeze(["ask_choices", "capability_status", "read_business_time_zone", "team_hub_read_conversation",
  "crm_list_tasks", "crm_get_task", "crm_list_team", "growth_list", "crm_assign_task", "crm_cancel_task", "growth_page_publish"]);

// ---------------------------------------------------------------- which tools an agent DM turn is offered (D4, D5)

type Authority = Pick<WorkspaceAuthority, "seat" | "workspaceAdmin">;

/**
 * The A2b tools an agent DM turn may be offered, from its stored DM scope, on top of what A1 offers:
 *  - a read in A2B_READ_TOOLS, only for this workspace's owner or admin (`workspaceAdmin`, the chat's
 *    own gate for these reads);
 *  - a card tool in A2B_CARD_TOOLS, only for an active owner/admin SEAT (`seat`, the governed doors'
 *    own rule), only while it is a write and classified `high`.
 * Never in a shared conversation, never without an authority answer, and never any other write: an
 * ordinary write (crm_update_task, plan_*) stays withheld until A2c.
 */
export function offeredA2bTools(stored: readonly string[] | null, where: "shared" | "agent_dm", authority: Authority | null): string[] {
  if (!stored || where !== "agent_dm" || !authority) return [];
  const writes = mutatingTools();
  return [...new Set(stored)].filter((t) => {
    if (A2B_READ_TOOLS.has(t)) return authority.workspaceAdmin === true && !writes.has(t);
    if (A2B_CARD_TOOLS.has(t)) return authority.seat === true && writes.has(t) && classifyAction(t) === "high";
    return false;
  });
}

/** Does this stored DM scope name anything A2b could offer? Only then is the authority asked. */
export function namesA2bTool(stored: readonly string[] | null): boolean {
  return !!stored && stored.some((t) => A2B_READ_TOOLS.has(t) || A2B_CARD_TOOLS.has(t));
}

/** The caller's authority in this workspace, asked once per turn. Fails closed: any error is none. */
export async function a2bAuthority(caller: unknown, service: unknown, userId: string, tenantId: string): Promise<Authority> {
  try { return await resolveWorkspaceAuthority(caller, service, userId, tenantId); }
  catch { return NO_WORKSPACE_AUTHORITY; }
}

// ---------------------------------------------------------------- tool definitions, each from its one home

/**
 * crm_list_tasks, crm_list_team and growth_list have no shared definition yet: each is defined once, in
 * paige-ai-chat (GROWTH_LIST_TOOL_DEF, CRM_LIST_TEAM_TOOL_DEF, CRM_LIST_TASKS_TOOL_DEF), which hands them
 * to the agent turn. Team Hub keeps no copy (capability-kit lint: no second tool definition). D15: the
 * task list keeps its one schema, so `assignee_email` stays offered and is answered `needs_input` here.
 */
export const CHAT_READ_TOOL_NAMES: ReadonlySet<string> = new Set(["growth_list", "crm_list_team", "crm_list_tasks"]);

/** Each A2b tool's definition, a fresh copy per call (the caller may decorate what it is handed). */
export function a2bToolDef(name: string, chatReadDefs?: Readonly<Record<string, unknown>>): { type: "function"; function: { name: string; description: string; parameters: unknown } } | null {
  const pick = (): unknown => {
    if (name === "growth_page_publish") return growthPagePublishToolDef();
    if (name === "crm_get_task") return CRM_TASK_READ_TOOLS.find((t) => t.function.name === name) ?? null;
    if (name === "crm_assign_task" || name === "crm_cancel_task") return CRM_COMMAND_TOOLS.find((t) => t.function.name === name) ?? null;
    if (!CHAT_READ_TOOL_NAMES.has(name)) return null;
    const def = chatReadDefs?.[name];
    // Only the definition of the tool asked for: a mislabelled entry is never offered under another name.
    const named = def && typeof def === "object" ? (def as { function?: { name?: unknown } }).function?.name : null;
    return named === name ? def : null;
  };
  const def = pick();
  return def ? JSON.parse(JSON.stringify(def)) : null;
}

// ---------------------------------------------------------------- provenance (D6)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const str = (v: unknown): string | null => typeof v === "string" && v.length ? v : null;

export type CardCallArgs = Record<string, unknown>;
export type ProvenanceVerdict = { ok: true; callArgs: CardCallArgs } | { ok: false; result: Record<string, unknown> };

const NEEDS_LOOKUP = (what: string): ProvenanceVerdict => ({ ok: false, result: { status: "needs_lookup",
  message: `Nothing was prepared. Look ${what} up with a read in this reply first, then use the ids exactly as that read returned them. Never use an id from a message.` } });
const NEEDS_INPUT = (message: string): ProvenanceVerdict => ({ ok: false, result: { status: "needs_input", message } });

/**
 * What this turn's reads returned, kept only as the ids a card may name. A card's arguments are checked
 * against it: an id that no read in this turn returned is never accepted, wherever else it appeared.
 */
export class CardProvenance {
  readonly tasks = new Map<string, { updated_at: string | null; created_at: string | null; title: string | null }>();
  /** Each person a read returned, by user id, with the name that read gave them (never an email). */
  readonly people = new Map<string, string | null>();
  readonly pages = new Set<string>();

  /** Record what one A2b read returned (its result exactly as the model receives it). */
  note(tool: string, result: unknown): void {
    const r = object(result);
    if (!r) return;
    const addTask = (t: unknown) => {
      const o = object(t);
      const id = str(o?.id);
      if (id) this.tasks.set(id, { updated_at: str(o!.updated_at), created_at: str(o!.created_at), title: str(o!.title) });
    };
    if (tool === "crm_list_tasks" && r.success === true && Array.isArray(r.tasks)) r.tasks.forEach(addTask);
    if (tool === "crm_get_task" && r.status === "available" && r.found === true) addTask(r.task);
    if (tool === "crm_list_team" && r.success === true && Array.isArray(r.members)) {
      for (const m of r.members) { const id = str(object(m)?.user_id); if (id) this.people.set(id, str(object(m)?.name)); }
    }
    if (tool === "growth_list" && r.success === true && Array.isArray(r.pages)) {
      for (const p of r.pages) { const id = str(object(p)?.id); if (id) this.pages.add(id); }
    }
  }

  /** The card's arguments, only from this turn's reads, or why nothing can be prepared. */
  check(tool: string, args: Record<string, unknown>): ProvenanceVerdict {
    // `confirm` and `idempotency_key` are never identity: the door, not the model, settles both.
    const keys = Object.keys(args).filter((k) => k !== "confirm" && k !== "idempotency_key");
    if (tool === "growth_page_publish") {
      if (keys.some((k) => k !== "page_id")) return NEEDS_INPUT("Only the page can go on this card. Nothing was prepared.");
      const page = str(args.page_id);
      if (!page || !this.pages.has(page)) return NEEDS_LOOKUP("the page (growth_list)");
      return { ok: true, callArgs: { page_id: page } };
    }
    if (tool === "crm_cancel_task" || tool === "crm_assign_task") {
      const allowed = tool === "crm_assign_task" ? ["task_id", "expected_updated_at", "patch"] : ["task_id", "expected_updated_at"];
      if (keys.some((k) => !allowed.includes(k))) {
        return NEEDS_INPUT(tool === "crm_assign_task" ? "Only the task, its version and the new assignee can go on this card. Nothing was prepared."
          : "Only the task and its version can go on this card. Nothing was prepared.");
      }
      const id = str(args.task_id);
      const row = id ? this.tasks.get(id) : undefined;
      if (!id || !row) return NEEDS_LOOKUP("the task (crm_list_tasks or crm_get_task)");
      // The version is the row's own updated_at (created_at only when updated_at is null), as the
      // read returned it. A guessed or remembered version is never accepted.
      const version = row.updated_at ?? row.created_at;
      if (!version || args.expected_updated_at !== version) return NEEDS_LOOKUP("the task again (its version must be the one the read returned)");
      if (tool === "crm_cancel_task") return { ok: true, callArgs: { task_id: id, expected_updated_at: version } };
      const patch = object(args.patch);
      if (!patch || Object.keys(patch).length !== 1 || !("assignee_user_id" in patch)) {
        return NEEDS_INPUT("The hand-over needs exactly one new assignee, as patch.assignee_user_id. Nothing was prepared.");
      }
      const person = str(patch.assignee_user_id);
      if (!person || !UUID.test(person) || !this.people.has(person)) return NEEDS_LOOKUP("the person (crm_list_team)");
      return { ok: true, callArgs: { task_id: id, expected_updated_at: version, patch: { assignee_user_id: person } } };
    }
    return NEEDS_INPUT("That can't go on a card here. Nothing was prepared.");
  }

  /**
   * The card's own sentence, written by the server from what this turn's reads returned: the task by its
   * title and the person by their name, so a card never shows a bare id (compliance, A2b). Only for
   * arguments `check` accepted. Null for a page (the publish door's own sentence already names the page
   * and its address) or when a read gave no title, so the card falls back to the door's own summary.
   */
  summary(tool: string, callArgs: CardCallArgs, askerId: string): string | null {
    if (tool !== "crm_assign_task" && tool !== "crm_cancel_task") return null;
    const id = str(callArgs.task_id);
    const title = id ? this.tasks.get(id)?.title : null;
    if (!title) return null;
    const named = `\u201c${oneLine(title, 120)}\u201d`;
    if (tool === "crm_cancel_task") return `Cancel ${named}.`;
    const person = str(object(callArgs.patch)?.assignee_user_id);
    if (!person) return null;
    const who = person.toLowerCase() === askerId.toLowerCase() ? "you" : this.people.get(person) ? oneLine(this.people.get(person)!, 80) : null;
    return who ? `Hand ${named} over to ${who}.` : null;
  }
}

/** Text for one line of a card: whitespace collapsed, at most `cap` characters (an ellipsis when cut). */
function oneLine(text: string, cap: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > cap ? `${chars.slice(0, cap - 1).join("").trimEnd()}\u2026` : flat;
}

// ---------------------------------------------------------------- the reads

type RpcClient = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }> };
// deno-lint-ignore no-explicit-any
type FromClient = { from(table: string): any };
export type CardReadContext = {
  /** The asker's own session. */
  caller: RpcClient;
  /** The service role (the task list reads as the chat does: service role, explicitly tenant-pinned). */
  service: RpcClient & FromClient;
  tenantId: string;
  userId: string;
  /** Distinguishes this turn's receipts (the accepted turn's id). */
  turnRef: string;
  signal?: AbortSignal;
  /** Fresh verified actor/workspace/DM/role/roster scope, never the offer-time snapshot. */
  isCurrent: () => Promise<boolean>;
};

const READ_UNAVAILABLE = { status: "unavailable", message: "That read didn't work just now. Say plainly that you couldn't look it up; never guess." };

/** One A2b read, for the model. Every one is the chat's own read from its one home, never a second query. */
export async function runCardRead(ctx: CardReadContext, tool: string, args: Record<string, unknown>, callId: string): Promise<Record<string, unknown>> {
  try {
    if (ctx.signal?.aborted || !await ctx.isCurrent()) return READ_UNAVAILABLE;
    const result = await readCardData(ctx, tool, args, callId);
    return !ctx.signal?.aborted && await ctx.isCurrent() ? result : READ_UNAVAILABLE;
  } catch { return READ_UNAVAILABLE; }
}

async function readCardData(ctx: CardReadContext, tool: string, args: Record<string, unknown>, callId: string): Promise<Record<string, unknown>> {
  try {
    if (tool === "crm_list_tasks") {
      // D15: the person filter needs an auth-user lookup by email, which Team Hub never makes.
      if (args.assignee_email !== undefined) return { status: "needs_input", message: "Filter by person isn't available here. List the tasks without it." };
      return await listCrmTasks(ctx.service, ctx.tenantId, args, {}) as unknown as Record<string, unknown>;
    }
    if (tool === "crm_list_team") return await listCrmTeam(ctx.caller, ctx.tenantId) as unknown as Record<string, unknown>;
    if (tool === "growth_list") return await listGrowthPages(ctx.caller as unknown as FromClient, ctx.service, ctx.tenantId) as unknown as Record<string, unknown>;
    if (tool === "crm_get_task") {
      const caller = ctx.caller as unknown as Partial<OperationsTaskReadCaller>;
      if (typeof caller.auth?.getUser !== "function") return READ_UNAVAILABLE;
      const identity = { actorId: ctx.userId, tenantId: ctx.tenantId, workspaceId: ctx.tenantId, role: "team_hub_dm",
        actAsClientId: null, accountShape: "solo" as const, scopeEpoch: ctx.turnRef };
      const result = await readOperationsTask(identity, {
        caller: caller as OperationsTaskReadCaller,
        currentIdentity: () => ctx.signal?.aborted ? null : identity,
        // Fresh, not the turn's snapshot: still this person's active workspace, and still its owner/admin.
        revalidateScope: async () => (await a2bAuthority(ctx.caller, ctx.service, ctx.userId, ctx.tenantId)).workspaceAdmin === true,
        signal: ctx.signal,
      }, args);
      if (result.status === "available") {
        await recordCapabilityRun(ctx.service, { tenantId: ctx.tenantId, actorId: ctx.userId, capabilityKey: tool, outcome: "capability_succeeded",
          runId: await stableRunId([tool, ctx.tenantId, `team_hub_agent:${ctx.turnRef}:${callId}`]),
          detail: { channel: "team_hub_agent", tool } }).catch(() => false);
      }
      return result as unknown as Record<string, unknown>;
    }
  } catch { return READ_UNAVAILABLE; }
  return READ_UNAVAILABLE;
}

// ---------------------------------------------------------------- prepare (plan section 3)

export type DoorInvoke = (name: string, body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
export type PrepareContext = {
  service: FromClient;
  /** A door call AS THE ASKER (their own JWT), injected by paige-ai-chat. */
  invokeAs: DoorInvoke;
  tenantId: string;
  userId: string;
  /** The asking message: the CRM door's retry identity is anchored on it, never on transcript text. */
  sourceMessageId: string;
  /** When the accept door accepted this turn. A proposal issued before it is never this turn's card. */
  acceptedAt: string | null;
};
export type PreparedCard = { confirmationId: string; kind: string; tool: string; expiresAt: string | null;
  /** The card's own sentence (CardProvenance.summary), or null to show the door's. */
  summary: string | null };
export type PrepareResult = { result: Record<string, unknown>; card?: PreparedCard };

/** Read a door's answer, 2xx (data) or not (an error carrying the body), as the chat's door branches do. */
async function answerOf(reply: { data: unknown; error: unknown } | null): Promise<Record<string, unknown> | null> {
  if (!reply) return null;
  let data = reply.data;
  if (reply.error) {
    const ctx = (reply.error as { context?: { json?: () => Promise<unknown> } }).context;
    if (!ctx || typeof ctx.json !== "function") return null;
    try { data = await ctx.json(); } catch { return null; }
  }
  return object(data);
}

const NOT_PREPARED = "Nothing was prepared and nothing was changed.";
/** D11: the copy for a proposal another surface already left waiting. */
export const ALREADY_WAITING: Readonly<Record<string, string>> = Object.freeze({
  page_publish: "That page is already waiting for an Approve somewhere else in Paige. Nothing new was prepared.",
  task_handover: "That task change is already waiting for an Approve somewhere else in Paige. Nothing new was prepared.",
  task_cancel: "That task change is already waiting for an Approve somewhere else in Paige. Nothing new was prepared.",
});
/** D11, when the proposal already waiting is a Team Hub card's (an earlier DM turn's, in this DM or another). */
export const ALREADY_ON_A_CARD: Readonly<Record<string, string>> = Object.freeze({
  page_publish: "That page already has a card waiting for an Approve in Team Hub. Nothing new was prepared; point to that card.",
  task_handover: "That task change already has a card waiting for an Approve in Team Hub. Nothing new was prepared; point to that card.",
  task_cancel: "That task change already has a card waiting for an Approve in Team Hub. Nothing new was prepared; point to that card.",
});

/**
 * Is this proposal a Team Hub card's? Fail open to "no" (the general copy) on a read that did not answer:
 * the copy is the only thing it changes, and both say nothing new was prepared.
 */
async function linkedToCard(service: FromClient, confirmationId: string): Promise<boolean> {
  try {
    const read = await service.from("team_hub_message_cards").select("message_id").eq("confirmation_id", confirmationId).maybeSingle();
    return !read?.error && !!object(read?.data);
  } catch { return false; }
}

/**
 * Ask the card's own door to propose the act with NOTHING approved, then read back the row it minted
 * with that door's own live-row predicate. The door, never this module, decides and stores the proposal;
 * a `high` act always proposes. The result for the model never carries the stored arguments or the
 * fingerprint (the fingerprint is what Approve sends; only the card read hands it to the asker).
 */
export async function prepareCard(ctx: PrepareContext, tool: string, callArgs: CardCallArgs, cardSummary: string | null = null): Promise<PrepareResult> {
  const kind = CARD_KIND[tool];
  if (!kind) return { result: { status: "unavailable", message: `That can't go on a card here. ${NOT_PREPARED}` } };
  let fingerprint: string | null = null;
  if (tool === "growth_page_publish") {
    const dispatched = await dispatchGrowthPublishChat({ tenantId: ctx.tenantId, userId: ctx.userId, toolName: tool, args: callArgs,
      approved: new Set<string>(), sameToolCalls: 1 }, {
      admin: { from: (name: string) => ({ select: (columns: string) => ctx.service.from(name).select(columns) as GrowthPublishApprovalQuery }) },
      invoke: (body) => ctx.invokeAs("growth-publish-command", body),
    });
    const c = dispatched.content;
    if (c.needs_confirm === true && typeof c.confirm_fingerprint === "string" && /^[0-9a-f]{16}$/.test(c.confirm_fingerprint)) fingerprint = c.confirm_fingerprint;
    // Anything else is the door's own answer (not ready, refused, unknown), already written for the model.
    else return { result: { status: "not_prepared", ...c } };
  } else {
    const action = CRM_TOOL_TO_ACTION[tool as keyof typeof CRM_TOOL_TO_ACTION];
    const source = { action, ...callArgs };
    const command = canonicalizeCrmCommand(source);
    // Anchored on the asking message, never the transcript: a retry of the same turn proposes the same act once.
    const keys = await crmCommandFallbackIdempotencyKeys(command, source, { thread_id: null, user_turn_ordinal: 1,
      user_turn: `team_hub:${ctx.sourceMessageId}`, tool_name: tool });
    let answer: Record<string, unknown> | null = null;
    try { answer = await answerOf(await ctx.invokeAs("crm-command", { command, expected_tenant_id: ctx.tenantId, idempotency_key: keys.current })); }
    catch { answer = null; }
    if (!answer) return { result: { status: "unavailable", message: "I couldn't prepare that card just now. Nothing was changed; say so plainly and offer to try again." } };
    if (answer.outcome === "approval_required" && typeof answer.fingerprint === "string" && /^[0-9a-f]{16}$/.test(answer.fingerprint)) fingerprint = answer.fingerprint;
    else if (answer.ok === true) {
      // A high act never runs without a card; if the door ever says it did, report only what it said.
      return { result: { status: "ran_without_card", success: true, message: "The workspace ran this directly, with no card. Say only that it was done as the workspace reported, nothing more." } };
    } else {
      return { result: { status: "not_prepared", not_applied: answer.outcome_unknown !== true,
        message: typeof answer.message === "string" ? answer.message : `That couldn't be prepared. ${NOT_PREPARED}` } };
    }
  }

  // The row the door just minted (or reused): its own live-row predicate, this person, this workspace,
  // outside any chat thread and client focus. One live row per (person, fingerprint) by its unique index.
  let row: Record<string, unknown> | null = null;
  try {
    const read = await ctx.service.from("paige_pending_confirmations").select("id,fingerprint,tool_name,summary,expires_at,server_issued_at")
      .eq("user_id", ctx.userId).eq("tenant_id", ctx.tenantId).eq("tool_name", tool).eq("fingerprint", fingerprint)
      .is("thread_id", null).is("scoped_client_id", null).is("consumed_at", null)
      .not("server_issued_at", "is", null).not("issued_in_request", "is", null)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    row = read?.error ? null : object(read?.data);
  } catch { row = null; }
  const id = str(row?.id);
  if (!row || !id || !UUID.test(id)) return { result: { status: "unavailable", message: "I couldn't prepare that card just now. Nothing was changed; say so plainly and offer to try again." } };
  // D11: a proposal issued before this turn was accepted is not this turn's: another surface (Studio,
  // PAIGE chat) left it waiting, and the door handed it back. It is never carded here (the post door
  // refuses it too).
  const issued = typeof row.server_issued_at === "string" ? Date.parse(row.server_issued_at) : NaN;
  const accepted = ctx.acceptedAt ? Date.parse(ctx.acceptedAt) : NaN;
  if (!Number.isFinite(issued) || !Number.isFinite(accepted) || issued < accepted) {
    return { result: { status: "already_waiting", message: (await linkedToCard(ctx.service, id) ? ALREADY_ON_A_CARD : ALREADY_WAITING)[kind] } };
  }
  const summary = cardSummary ?? (typeof row.summary === "string" ? row.summary : null);
  return {
    card: { confirmationId: id.toLowerCase(), kind, tool, expiresAt: str(row.expires_at), summary: cardSummary },
    result: { status: "prepared", card: KIND_LABEL[kind], summary,
      expires_at: str(row.expires_at),
      note: "A card with Approve and Not now will show under your reply in this DM. Nothing has changed yet, and nothing will until the person presses Approve. Say in one short line what the card will do; never say it is done." },
  };
}
